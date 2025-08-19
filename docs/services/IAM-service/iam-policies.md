# IAM Policies

This document provides a comprehensive guide to creating and managing IAM policies in Open Archiver. It is intended for developers and administrators who need to configure granular access control for users and roles.

## Policy Structure

IAM policies are defined as an array of JSON objects, where each object represents a single permission rule. The structure of a policy object is as follows:

```json
{
	"action": "action_name",
	"subject": "subject_name",
	"conditions": {
		"field_name": "value"
	}
}
```

- `action`: The action to be performed on the subject.
- `subject`: The resource or entity on which the action is to be performed.
- `conditions`: (Optional) A set of conditions that must be met for the permission to be granted.

## Actions

The following actions are available for use in IAM policies:

- `manage`: A wildcard action that grants all permissions on a subject.
- `create`: Allows the user to create a new resource.
- `read`: Allows the user to view a resource.
- `update`: Allows the user to modify an existing resource.
- `delete`: Allows the user to delete a resource.
- `search`: Allows the user to search for resources.
- `export`: Allows the user to export resources.
- `assign`: Allows the user to assign a resource to another user.
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

## Conditions

Conditions are used to create fine-grained access control rules. They are defined as a JSON object where the keys are the fields of the subject and the values are the conditions to be met.

Conditions support the following MongoDB-style operators:

- `$eq`: Equal to
- `$ne`: Not equal to
- `$in`: In an array of values
- `$nin`: Not in an array of values
- `$lt`: Less than
- `$lte`: Less than or equal to
- `$gt`: Greater than
- `$gte`: Greater than or equal to
- `$exists`: Field exists

## Dynamic Policies with Placeholders

To create dynamic policies that are specific to the current user, you can use the `${user.id}` placeholder in the `conditions` object. This placeholder will be replaced with the ID of the current user at runtime.

## Examples

### End-User Policy

This policy allows a user to create ingestions and manage their own resources.

```json
[
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
	}
]
```

### Auditor Policy

This policy allows a user to read all archived emails and ingestion sources, but not to modify or delete them.

```json
[
	{
		"action": "read",
		"subject": "archive"
	},
	{
		"action": "read",
		"subject": "ingestion"
	}
]
```

### Administrator Policy

This policy grants a user full access to all resources.

```json
[
	{
		"action": "manage",
		"subject": "all"
	}
]
```
