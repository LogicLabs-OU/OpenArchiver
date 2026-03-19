# Retention Labels: User Interface Guide

The retention labels management interface is located at **Dashboard → Compliance → Retention Labels**. It provides a comprehensive view of all configured labels and tools for creating, editing, deleting, and applying labels to individual archived emails.

## Overview

Retention labels provide item-level retention control, allowing administrators to override normal retention policies for specific emails with custom retention periods. This is particularly useful for legal holds, regulatory compliance, and preserving important business communications.

## Labels Table

The main page displays a table of all retention labels with the following columns:

- **Name:** The label name and its UUID displayed underneath for reference. If a description is provided, it appears below the name in smaller text.
- **Retention Period:** The number of days emails with this label are retained, displayed as "X days".
- **Status:** A badge indicating whether the label is:
    - **Enabled** (green badge): The label can be applied to new emails
    - **Disabled** (gray badge): The label cannot be applied to new emails but continues to govern already-labeled emails
- **Created At:** The date the label was created, displayed in local date format.
- **Actions:** Dropdown menu with Edit and Delete options for each label.

The table is sorted by creation date in ascending order by default.

## Creating a Label

Click the **"Create New"** button (with plus icon) above the table to open the creation dialog.

### Form Fields

- **Name** (Required): A unique, descriptive name for the label. Maximum 255 characters.
- **Description** (Optional): A detailed explanation of the label's purpose or usage. Maximum 1000 characters.
- **Retention Period (Days)** (Required): The number of days to retain emails with this label. Must be at least 1 day.

### Example Labels

- **Name:** "Legal Hold - Project Alpha"  
  **Description:** "Extended retention for emails related to ongoing litigation regarding Project Alpha intellectual property dispute"  
  **Retention Period:** 3650 days (10 years)

- **Name:** "Executive Communications"  
  **Description:** "Preserve important emails from C-level executives beyond normal retention periods"  
  **Retention Period:** 2555 days (7 years)

- **Name:** "Financial Records Q4 2025"  
  **Retention Period:** 2190 days (6 years)

### Success and Error Handling

- **Success**: The dialog closes and a green success notification appears confirming the label was created.
- **Name Conflict**: If a label with the same name already exists, an error notification will display.
- **Validation Errors**: Missing required fields or invalid values will show inline validation messages.

## Editing a Label

Click the **Edit** option from the actions dropdown on any label row to open the edit dialog.

### Editable Fields

- **Name**: Can always be modified (subject to uniqueness constraint)
- **Description**: Can always be modified
- **Retention Period**: Can only be modified if the label has never been applied to any emails

### Retention Period Restrictions

The edit dialog shows a warning message: "Retention period cannot be modified if this label is currently applied to emails." If you attempt to change the retention period for a label that's in use, the system will return a conflict error and display an appropriate error message.

This restriction prevents tampering with active retention schedules and ensures compliance integrity.

### Update Process

1. Modify the desired fields
2. Click **Save** to submit changes
3. The system validates the changes and updates the label
4. A success notification confirms the update

## Deleting a Label

Click the **Delete** option from the actions dropdown to open the deletion confirmation dialog.

### Smart Deletion Behavior

The system uses intelligent deletion logic:

#### Hard Delete

If the label has **never been applied** to any emails:

- The label is permanently removed from the system
- Success message: "Label deleted successfully"

#### Soft Disable

If the label is **currently applied** to one or more emails:

- The label is marked as "Disabled" instead of being deleted
- The label remains in the table with a "Disabled" status badge
- Existing emails keep their retention schedule based on this label
- The label cannot be applied to new emails
- Success message: "Label disabled successfully"

### Confirmation Dialog

The deletion dialog shows:

- **Title**: "Delete Retention Label"
- **Description**: Explains that this action cannot be undone and may disable the label if it's in use
- **Cancel** button to abort the operation
- **Confirm** button to proceed with deletion

## Applying Labels to Emails

Retention labels can be applied to individual archived emails through the email detail pages.

### From Email Detail Page

1. Navigate to an archived email by clicking on it from search results or the archived emails list
2. Look for the "Retention Label" section in the email metadata
3. If no label is applied, you'll see an "Apply Label" button (requires `delete:archive` permission)
4. If a label is already applied, you'll see:
    - The current label name and retention period
    - "Change Label" and "Remove Label" buttons

### Label Application Process

1. Click **"Apply Label"** or **"Change Label"**
2. A dropdown or dialog shows all available (enabled) labels
3. Select the desired label
4. Confirm the application
5. The system:
    - Removes any existing label from the email
    - Applies the new label
    - Records the action in the audit log
    - Updates the email's retention schedule

### One Label Per Email Rule

Each email can have at most one retention label. When you apply a new label to an email that already has a label, the previous label is automatically removed and replaced with the new one.

## Permissions Required

Different operations require different permission levels:

### Label Management

- **Create, Edit, Delete Labels**: Requires `manage:all` permission
- **View Labels Table**: Requires `manage:all` permission

### Email Label Operations

- **View Email Labels**: Requires `read:archive` permission
- **Apply/Remove Email Labels**: Requires `delete:archive` permission

## Status Indicators

### Enabled Labels (Green Badge)

- Can be applied to new emails
- Appears in label selection dropdowns
- Fully functional for all operations

### Disabled Labels (Gray Badge)

- Cannot be applied to new emails
- Does not appear in label selection dropdowns
- Continues to govern retention for already-labeled emails
- Can still be viewed and its details examined
- Results from attempting to delete a label that's currently in use

## Best Practices

### Naming Conventions

- Use descriptive names that indicate purpose: "Legal Hold - Case XYZ", "Executive - Q4 Review"
- Include time periods or case references where relevant
- Maintain consistent naming patterns across your organization

### Descriptions

- Always provide descriptions for complex or specialized labels
- Include the business reason or legal requirement driving the retention period
- Reference specific regulations, policies, or legal matters where applicable

### Retention Periods

- Consider your organization's legal and regulatory requirements
- Common periods:
    - **3 years (1095 days)**: Standard business records
    - **7 years (2555 days)**: Financial and tax records
    - **10 years (3650 days)**: Legal holds and critical business documents
    - **Permanent retention**: Use very large numbers (e.g., 36500 days = 100 years)

### Label Lifecycle

- Review labels periodically to identify unused or obsolete labels
- Disabled labels can accumulate over time - consider cleanup procedures
- Document the purpose and expected lifecycle of each label for future administrators

## Troubleshooting

### Cannot Edit Retention Period

**Problem**: Edit dialog shows retention period as locked or returns conflict error  
**Cause**: The label is currently applied to one or more emails  
**Solution**: Create a new label with the desired retention period instead of modifying the existing one

### Label Not Appearing in Email Application Dropdown

**Problem**: A label doesn't show up when trying to apply it to an email  
**Cause**: The label is disabled  
**Solution**: Check the labels table - disabled labels show a gray "Disabled" badge

### Cannot Delete Label

**Problem**: Deletion results in label being disabled instead of removed  
**Cause**: The label is currently applied to emails  
**Solution**: This is expected behavior to preserve retention integrity. The label can only be hard-deleted if it has never been used.

### Permission Denied Errors

**Problem**: Cannot access label management or apply labels to emails  
**Cause**: Insufficient permissions  
**Solution**: Contact your system administrator to verify you have the required permissions:

- `manage:all` for label management
- `delete:archive` for email label operations
