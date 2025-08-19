# IAM Policies Guide

This document provides a comprehensive guide to the Identity and Access Management (IAM) policies in Open Archiver. Our policy structure is inspired by AWS IAM, providing a powerful and flexible way to manage permissions.

## 1. Policy Structure

A policy is a JSON object that consists of one or more statements. Each statement includes an `Effect`, `Action`, and `Resource`.

```json
{
	"Effect": "Allow",
	"Action": ["archive:read", "archive:search"],
	"Resource": ["archive/*"]
}
```

- **`Effect`**: Specifies whether the statement results in an `Allow` or `Deny`. An explicit `Deny` always overrides an `Allow`.
- **`Action`**: A list of operations that the policy grants or denies permission to perform. Actions are formatted as `service:operation`.
- **`Resource`**: A list of resources to which the actions apply. Resources are specified in a hierarchical format. Wildcards (`*`) can be used.

## 2. Wildcard Support

Our IAM system supports wildcards (`*`) in both `Action` and `Resource` fields to provide flexible permission management, as defined in the `PolicyValidator`.

### Action Wildcards

You can use wildcards to grant broad permissions for actions:

- **Global Wildcard (`*`)**: A standalone `*` in the `Action` field grants permission for all possible actions across all services.
    ```json
    "Action": ["*"]
    ```
- **Service-Level Wildcard (`service:*`)**: A wildcard at the end of an action string grants permission for all actions within that specific service.
    ```json
    "Action": ["archive:*"]
    ```

### Resource Wildcards

Wildcards can also be used to specify resources:

- **Global Wildcard (`*`)**: A standalone `*` in the `Resource` field applies the policy to all resources in the system.
    ```json
    "Resource": ["*"]
    ```
- **Partial Wildcards**: Some services allow wildcards at specific points in the resource path to refer to all resources of a certain type. For example, to target all ingestion sources:
    ```json
    "Resource": ["ingestion-source/*"]
    ```

## 3. Actions and Resources by Service

The following sections define the available actions and resources, categorized by their respective services.

### Service: `archive`

The `archive` service pertains to all actions related to accessing and managing archived emails.

**Actions:**

| Action           | Description                                                            |
| :--------------- | :--------------------------------------------------------------------- |
| `archive:read`   | Grants permission to read the content and metadata of archived emails. |
| `archive:search` | Grants permission to perform search queries against the email archive. |
| `archive:export` | Grants permission to export search results or individual emails.       |

**Resources:**

| Resource                              | Description                                                                              |
| :------------------------------------ | :--------------------------------------------------------------------------------------- |
| `archive/*`                           | Represents the entire email archive.                                                     |
| `archive/ingestion-source/{sourceId}` | Scopes the action to emails from a specific ingestion source.                            |
| `archive/mailbox/{email}`             | Scopes the action to a single, specific mailbox, usually identified by an email address. |
| `archive/custodian/{custodianId}`     | Scopes the action to emails belonging to a specific custodian.                           |

---

### Service: `ingestion`

The `ingestion` service covers the management of email ingestion sources.

**Actions:**

| Action                   | Description                                                                  |
| :----------------------- | :--------------------------------------------------------------------------- |
| `ingestion:createSource` | Grants permission to create a new ingestion source.                          |
| `ingestion:readSource`   | Grants permission to view the details of ingestion sources.                  |
| `ingestion:updateSource` | Grants permission to modify the configuration of an ingestion source.        |
| `ingestion:deleteSource` | Grants permission to delete an ingestion source.                             |
| `ingestion:manageSync`   | Grants permission to trigger, pause, or force a sync on an ingestion source. |

**Resources:**

| Resource                      | Description                                               |
| :---------------------------- | :-------------------------------------------------------- |
| `ingestion-source/*`          | Represents all ingestion sources.                         |
| `ingestion-source/{sourceId}` | Scopes the action to a single, specific ingestion source. |

---

### Service: `system`

The `system` service is for managing system-level settings, users, and roles.

**Actions:**

| Action                  | Description                                         |
| :---------------------- | :-------------------------------------------------- |
| `system:readSettings`   | Grants permission to view system settings.          |
| `system:updateSettings` | Grants permission to modify system settings.        |
| `system:readUsers`      | Grants permission to list and view user accounts.   |
| `system:createUser`     | Grants permission to create new user accounts.      |
| `system:updateUser`     | Grants permission to modify existing user accounts. |
| `system:deleteUser`     | Grants permission to delete user accounts.          |
| `system:assignRole`     | Grants permission to assign roles to users.         |

**Resources:**

| Resource               | Description                                           |
| :--------------------- | :---------------------------------------------------- |
| `system/settings`      | Represents the system configuration.                  |
| `system/users`         | Represents all user accounts within the system.       |
| `system/user/{userId}` | Scopes the action to a single, specific user account. |

---

### Service: `dashboard`

The `dashboard` service relates to viewing analytics and overview information.

**Actions:**

| Action           | Description                                                     |
| :--------------- | :-------------------------------------------------------------- |
| `dashboard:read` | Grants permission to view all dashboard widgets and statistics. |

**Resources:**

| Resource      | Description                                 |
| :------------ | :------------------------------------------ |
| `dashboard/*` | Represents all components of the dashboard. |
