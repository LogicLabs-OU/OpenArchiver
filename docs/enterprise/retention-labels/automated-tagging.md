# Retention Labels: Automated Application Guide

This guide explains how to use the API to automatically apply retention labels to archived emails, enabling automated compliance and retention management workflows.

## Overview

Automated retention label application allows external systems and services to programmatically tag emails with appropriate retention labels based on content analysis, business rules, or regulatory requirements. This eliminates manual tagging for large volumes of emails while ensuring consistent retention policy enforcement.

## Common Use Cases

### 1. Financial Document Classification

**Scenario**: Automatically identify and tag financial documents (invoices, receipts, payment confirmations) with extended retention periods for regulatory compliance.

**Implementation**:

- Monitor newly ingested emails for financial keywords in subject lines or attachment names
- Apply "Financial Records" label (typically 7+ years retention) to matching emails
- Use content analysis to identify financial document types

### 2. Legal and Compliance Tagging

**Scenario**: Apply legal hold labels to emails related to ongoing litigation or regulatory investigations.

**Implementation**:

- Scan emails for legal-related keywords or specific case references
- Tag emails from/to legal departments with "Legal Hold" labels
- Apply extended retention periods to preserve evidence

### 3. Executive Communication Preservation

**Scenario**: Ensure important communications involving executive leadership are retained beyond standard policies.

**Implementation**:

- Identify emails from C-level executives (CEO, CFO, CTO, etc.)
- Apply "Executive Communications" labels with extended retention
- Preserve strategic business communications for historical reference

### 4. Data Classification Integration

**Scenario**: Integrate with existing data classification systems to apply retention labels based on content sensitivity.

**Implementation**:

- Use AI/ML classification results to determine retention requirements
- Apply labels like "Confidential", "Public", or "Restricted" with appropriate retention periods
- Automate compliance with data protection regulations

### 5. Project-Based Retention

**Scenario**: Apply specific retention periods to emails related to particular projects or contracts.

**Implementation**:

- Identify project-related emails using subject line patterns or participant lists
- Tag with project-specific labels (e.g., "Project Alpha - 5 Year Retention")
- Ensure project documentation meets contractual retention requirements

## API Workflow

### Step 1: Authentication Setup

Create an API key with appropriate permissions:

- Navigate to **Dashboard → Admin → Roles/Users**
- Create a user with `read:archive` and `delete:archive` permissions (minimum required)
- Generate an API for the newly created user
- Securely store the API key for use in automated systems

### Step 2: Identify Target Emails

Use the archived emails API to find emails that need labeling:

**Get Recent Emails**:

```
GET /api/v1/archived-emails?limit=100&sort=archivedAt:desc
```

**Search for Specific Emails**:

```
GET /api/v1/archived-emails/search?query=subject:invoice&limit=50
```

### Step 3: Check Current Label Status

Before applying a new label, verify the email's current state:

**Check Email Label**:

```
GET /api/v1/enterprise/retention-policy/email/{emailId}/label
```

This returns `null` if no label is applied, or the current label information if one exists.

### Step 4: Apply Retention Label

Apply the appropriate label to the email:

**Apply Label**:

```
POST /api/v1/enterprise/retention-policy/email/{emailId}/label
Content-Type: application/json

{
  "labelId": "your-label-uuid-here"
}
```

### Step 5: Verify Application

Confirm the label was successfully applied by checking the response or making another GET request.

## Label Management

### Getting Available Labels

List all available retention labels to identify which ones to use:

```
GET /api/v1/enterprise/retention-policy/labels
```

This returns all labels with their IDs, names, retention periods, and status (enabled/disabled).

### Label Selection Strategy

- **Pre-create labels** through the UI with appropriate names and retention periods
- **Map business rules** to specific label IDs in your automation logic
- **Cache label information** to avoid repeated API calls
- **Handle disabled labels** gracefully (they cannot be applied to new emails)

## Implementation Patterns

### Pattern 1: Post-Ingestion Processing

Apply labels after emails have been fully ingested and indexed:

1. Monitor for newly ingested emails (via webhooks or polling)
2. Analyze email content and metadata
3. Determine appropriate retention label based on business rules
4. Apply the label via API

### Pattern 2: Batch Processing

Process emails in scheduled batches:

1. Query for unlabeled emails periodically (daily/weekly)
2. Process emails in manageable batches (50-100 emails)
3. Apply classification logic and labels
4. Log results for audit and monitoring

### Pattern 3: Event-Driven Tagging

React to specific events or triggers:

1. Receive notification of specific events (legal hold notice, project start, etc.)
2. Search for relevant emails based on criteria
3. Apply appropriate labels to all matching emails
4. Document the mass labeling action

## Authentication and Security

### API Key Management

- **Use dedicated API keys** for automated systems (not user accounts)
- **Assign minimal required permissions** (`delete:archive` for label application)
- **Rotate API keys regularly** as part of security best practices
- **Store keys securely** using environment variables or secret management systems

### Request Authentication

Include the API key in all requests:

```
Authorization: Bearer your-api-key-here
Content-Type: application/json
```

## Error Handling

### Common Error Scenarios

- **404 Email Not Found**: The specified email ID doesn't exist
- **404 Label Not Found**: The label ID is invalid or label has been deleted
- **409 Conflict**: Attempting to apply a disabled label
- **422 Validation Error**: Invalid request format or missing required fields

### Best Practices

- **Check response status codes** and handle errors appropriately
- **Implement retry logic** for temporary failures (5xx errors)
- **Log all operations** for audit trails and debugging
- **Continue processing** other emails even if some fail

## Performance Considerations

### Rate Limiting

- **Process emails in batches** rather than individually when possible
- **Add delays between API calls** to avoid overwhelming the server
- **Monitor API response times** and adjust batch sizes accordingly

### Efficiency Tips

- **Cache label information** to reduce API calls
- **Check existing labels** before applying new ones to avoid unnecessary operations
- **Use search API** to filter emails rather than processing all emails
- **Implement incremental processing** to handle only new or modified emails

## Monitoring and Auditing

### Logging Recommendations

- **Log all label applications** with email ID, label ID, and timestamp
- **Track success/failure rates** for monitoring system health
- **Record business rule matches** for compliance reporting

### Audit Trail

All automated label applications are recorded in the system audit log with:

- Actor identified as the API key name
- Target email and applied label details
- Timestamp of the operation

This ensures full traceability of automated retention decisions.

## Integration Examples

### Scenario: Invoice Processing System

1. **Trigger**: New email arrives with invoice attachment
2. **Analysis**: System identifies invoice keywords or attachment types
3. **Action**: Apply "Financial Records - 7 Year" label via API
4. **Result**: Email retained for regulatory compliance period

### Scenario: Legal Hold Implementation

1. **Trigger**: Legal department issues hold notice for specific matter
2. **Search**: Find all emails matching case criteria (participants, keywords, date range)
3. **Action**: Apply "Legal Hold - Matter XYZ" label to all matching emails
4. **Result**: All relevant emails preserved indefinitely

### Scenario: Data Classification Integration

1. **Trigger**: Content classification system processes new emails
2. **Analysis**: ML system categorizes email as "Confidential Financial Data"
3. **Mapping**: Business rules map category to "Financial Confidential - 10 Year" label
4. **Action**: Apply label via API
5. **Result**: Automatic compliance with data retention policies

## Getting Started

1. **Set up authentication** by creating an API key with appropriate permissions
2. **Identify your use cases** and create corresponding retention labels through the UI
3. **Test the API** with a few sample emails to understand the workflow
4. **Implement your business logic** to identify which emails need which labels
5. **Deploy your automation** with proper error handling and monitoring
6. **Monitor results** and adjust your classification rules as needed

This automated approach ensures consistent retention policy enforcement while reducing manual administrative overhead.
