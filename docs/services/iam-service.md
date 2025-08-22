# IAM Policies

This document provides a guide to creating and managing IAM policies in Open Archiver. It is intended for developers and administrators who need to configure granular access control for users and roles.

## Policy Structure

IAM policies are defined as an array of JSON objects, where each object represents a single permission rule. The structure of a policy object is as follows:

```json
{
	"action": "read" OR ["read", "create"],
	"subject": "ingestion" OR ["ingestion", "dashboard"],
	"conditions": {
		"field_name": "value"
	},
	"inverted": false OR true,
}
```

- `action`: The action(s) to be performed on the subject. Can be a single string or an array of strings.
- `subject`: The resource(s) or entity on which the action is to be performed. Can be a single string or an array of strings.
- `conditions`: (Optional) A set of conditions that must be met for the permission to be granted.
- `inverted`: (Optional) When set to `true`, this inverts the rule, turning it from a "can" rule into a "cannot" rule. This is useful for creating exceptions to broader permissions.

## Actions

The following actions are available for use in IAM policies:

- `manage`: A wildcard action that grants all permissions on a subject (`create`, `read`, `update`, `delete`, `search`, `sync`).
- `create`: Allows the user to create a new resource.
- `read`: Allows the user to view a resource.
- `update`: Allows the user to modify an existing resource.
- `delete`: Allows the user to delete a resource.
- `search`: Allows the user to search for resources.
- `sync`: Allows the user to synchronize a resource.

## Subjects

The following subjects are available for use in IAM policies:

- `all`: A wildcard subject that represents all resources.
- `archive`: Represents archived emails.
- `ingestion`: Represents ingestion sources.
- `settings`: Represents system settings.
- `users`: Represents user accounts.
- `roles`: Represents user roles.
- `dashboard`: Represents the dashboard.

## Advanced Conditions with MongoDB-Style Queries

Conditions are the key to creating fine-grained access control rules. They are defined as a JSON object where each key represents a field on the subject, and the value defines the criteria for that field.

All conditions within a single rule are implicitly joined with an **AND** logic. This means that for a permission to be granted, the resource must satisfy _all_ specified conditions.

The power of this system comes from its use of a subset of [MongoDB's query language](https://www.mongodb.com/docs/manual/), which provides a flexible and expressive way to define complex rules. These rules are translated into native queries for both the PostgreSQL database (via Drizzle ORM) and the Meilisearch engine.

### Supported Operators and Examples

Here is a detailed breakdown of the supported operators with examples.

#### `$eq` (Equal)

This is the default operator. If you provide a simple key-value pair, it is treated as an equality check.

```json
// This rule...
{ "status": "active" }

// ...is equivalent to this:
{ "status": { "$eq": "active" } }
```

**Use Case**: Grant access to an ingestion source only if its status is `active`.

#### `$ne` (Not Equal)

Matches documents where the field value is not equal to the specified value.

```json
{ "provider": { "$ne": "pst_import" } }
```

**Use Case**: Allow a user to see all ingestion sources except for PST imports.

#### `$in` (In Array)

Matches documents where the field value is one of the values in the specified array.

```json
{
	"id": {
		"$in": ["INGESTION_ID_1", "INGESTION_ID_2"]
	}
}
```

**Use Case**: Grant an auditor access to a specific list of ingestion sources.

#### `$nin` (Not In Array)

Matches documents where the field value is not one of the values in the specified array.

```json
{ "provider": { "$nin": ["pst_import", "eml_import"] } }
```

**Use Case**: Hide all manual import sources from a specific user role.

#### `$lt` / `$lte` (Less Than / Less Than or Equal)

Matches documents where the field value is less than (`$lt`) or less than or equal to (`$lte`) the specified value. This is useful for numeric or date-based comparisons.

```json
{ "sentAt": { "$lt": "2024-01-01T00:00:00.000Z" } }
```

#### `$gt` / `$gte` (Greater Than / Greater Than or Equal)

Matches documents where the field value is greater than (`$gt`) or greater than or equal to (`$gte`) the specified value.

```json
{ "sentAt": { "$lt": "2024-01-01T00:00:00.000Z" } }
```

#### `$exists`

Matches documents that have (or do not have) the specified field.

```json
// Grant access only if a 'lastSyncStatusMessage' exists
{ "lastSyncStatusMessage": { "$exists": true } }
```

## Inverted Rules: Creating Exceptions with `cannot`

By default, all rules are "can" rules, meaning they grant permissions. However, you can create a "cannot" rule by adding `"inverted": true` to a policy object. This is extremely useful for creating exceptions to broader permissions.

A common pattern is to grant broad access and then use an inverted rule to carve out a specific restriction.

**Use Case**: Grant a user access to all ingestion sources _except_ for one specific source.

This is achieved with two rules:

1.  A "can" rule that grants `read` access to the `ingestion` subject.
2.  An inverted "cannot" rule that denies `read` access for the specific ingestion `id`.

```json
[
	{
		"action": "read",
		"subject": "ingestion"
	},
	{
		"inverted": true,
		"action": "read",
		"subject": "ingestion",
		"conditions": {
			"id": "SPECIFIC_INGESTION_ID_TO_EXCLUDE"
		}
	}
]
```

## Policy Evaluation Logic

The system evaluates policies by combining all relevant rules for a user. The logic is simple:

- A user has permission if at least one `can` rule allows it.
- A permission is denied if a `cannot` (`"inverted": true`) rule explicitly forbids it, even if a `can` rule allows it. `cannot` rules always take precedence.

### Dynamic Policies with Placeholders

To create dynamic policies that are specific to the current user, you can use the `${user.id}` placeholder in the `conditions` object. This placeholder will be replaced with the ID of the current user at runtime.

## Special Permissions for User and Role Management

It is important to note that while `read` access to `users` and `roles` can be granted granularly, any actions that modify these resources (`create`, `update`, `delete`) are restricted to Super Admins.

A user must have the `{ "action": "manage", "subject": "all" }` permission (Typically a Super Admin role) to manage users and roles. This is a security measure to prevent unauthorized changes to user accounts and permissions.

## Policy Examples

Here are several examples based on the default roles in the system, demonstrating how to combine actions, subjects, and conditions to achieve specific access control scenarios.

### Administrator

This policy grants a user full access to all resources using wildcards.

```json
[
	{
		"action": "manage",
		"subject": "all"
	}
]
```

### End-User

This policy allows a user to view the dashboard, create new ingestion sources, and fully manage the ingestion sources they own.

```json
[
	{
		"action": "read",
		"subject": "dashboard"
	},
	{
		"action": "create",
		"subject": "ingestion"
	},
	{
		"action": "manage",
		"subject": "ingestion",
		"conditions": {
			"userId": "${user.id}"
		}
	},
	{
		"action": "manage",
		"subject": "archive",
		"conditions": {
			"ingestionSource.userId": "${user.id}" // also needs to give permission to archived emails created by the user
		}
	}
]
```

### Global Read-Only Auditor

This policy grants read and search access across most of the application's resources, making it suitable for an auditor who needs to view data without modifying it.

```json
[
	{
		"action": ["read", "search"],
		"subject": ["ingestion", "archive", "dashboard", "users", "roles"]
	}
]
```

### Ingestion Admin

This policy grants full control over all ingestion sources and archives, but no other resources.

```json
[
	{
		"action": "manage",
		"subject": "ingestion"
	}
]
```

### Auditor for Specific Ingestion Sources

This policy demonstrates how to grant access to a specific list of ingestion sources using the `$in` operator.

```json
[
	{
		"action": ["read", "search"],
		"subject": "ingestion",
		"conditions": {
			"id": {
				"$in": ["INGESTION_ID_1", "INGESTION_ID_2"]
			}
		}
	}
]
```

### Limit Access to a Specific Mailbox

This policy grants a user access to a specific ingestion source, but only allows them to see emails belonging to a single user within that source.

This is achieved by defining two specific `can` rules: The rule grants `read` and `search` access to the `archive` subject, but the `userEmail` must match.

```json
[
	{
		"action": ["read", "search"],
		"subject": "archive",
		"conditions": {
			"userEmail": "user1@example.com"
		}
	}
]
```
