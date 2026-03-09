# Retention Policy

The Retention Policy Engine is an enterprise-grade feature that automates the lifecycle management of archived emails. It enables organizations to define time-based retention rules that determine how long archived emails are kept before they are permanently deleted, ensuring compliance with data protection regulations and internal data governance policies.

## Core Principles

### 1. Policy-Based Automation

Email deletion is never arbitrary. Every deletion is governed by one or more explicitly configured retention policies that define the retention period in days, the conditions under which the policy applies, and the action to take when an email expires. The lifecycle worker processes emails in batches on a recurring schedule, ensuring continuous enforcement without manual intervention.

### 2. Condition-Based Targeting

Policies can target specific subsets of archived emails using a flexible condition builder. Conditions are evaluated against email metadata fields (sender, recipient, subject, attachment type) using a variety of string-matching operators. Conditions within a policy are grouped using AND/OR logic, allowing precise control over which emails a policy applies to.

### 3. Ingestion Scope

Each policy can optionally be scoped to one or more ingestion sources. When an ingestion scope is set, the policy only applies to emails that were archived from those specific sources. Policies with no ingestion scope (null) apply to all emails regardless of their source.

### 4. Priority and Max-Duration-Wins

When multiple policies match a single email, the system applies **max-duration-wins** logic: the longest matching retention period is used. This ensures that if any policy requires an email to be kept longer, that requirement is honored. The priority field on each policy provides an ordering mechanism for administrative purposes and future conflict-resolution enhancements.

### 5. Full Audit Trail

Every policy lifecycle event — creation, modification, deletion, and every automated email deletion — is recorded in the immutable [Audit Log](../audit-log/index.md). Automated deletions include the IDs of the governing policies in the audit log entry, ensuring full traceability from deletion back to the rule that triggered it.

### 6. Fail-Safe Behavior

The system is designed to err on the side of caution:

- If no policy matches an email, the email is **not** deleted.
- If the lifecycle worker encounters an error processing a specific email, it logs the error and continues with the remaining emails in the batch.
- Invalid regex patterns in `regex_match` rules are treated as non-matching rather than causing failures.

## Feature Requirements

The Retention Policy Engine requires:

- An active **Enterprise license** with the `RETENTION_POLICY` feature enabled.
- The `manage:all` permission for the authenticated user to access the policy management API and UI.

## Architecture Overview

The feature is composed of the following components:

| Component            | Location                                                              | Description                                                  |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Types                | `packages/types/src/retention.types.ts`                               | Shared TypeScript types for policies, rules, and evaluation. |
| Database Schema      | `packages/backend/src/database/schema/compliance.ts`                  | Drizzle ORM table definition for `retention_policies`.       |
| Retention Service    | `packages/enterprise/src/modules/retention-policy/RetentionService.ts`| CRUD operations and the evaluation engine.                   |
| API Controller       | `packages/enterprise/src/modules/retention-policy/retention-policy.controller.ts` | Express request handlers with Zod validation.    |
| API Routes           | `packages/enterprise/src/modules/retention-policy/retention-policy.routes.ts`     | Route registration with auth and feature guards. |
| Module               | `packages/enterprise/src/modules/retention-policy/retention-policy.module.ts`     | Enterprise module bootstrap.                     |
| Lifecycle Worker     | `packages/enterprise/src/workers/lifecycle.worker.ts`                 | BullMQ worker for automated retention enforcement.           |
| Frontend Page        | `packages/frontend/src/routes/dashboard/compliance/retention-policies/` | SvelteKit page for policy management and simulation.       |
