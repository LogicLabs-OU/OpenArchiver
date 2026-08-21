# Connecting to Google Workspace

This guide provides instructions for Google Workspace administrators to set up a connection that allows the archiving of all user mailboxes within their organization.

The connection uses a **Google Cloud Service Account** with **Domain-Wide Delegation**. This is a secure method that grants the archiving service permission to access user data on behalf of the administrator, without requiring individual user passwords or consent.

## Prerequisites

- You must have **Super Administrator** privileges in your Google Workspace account.
- You must have access to the **Google Cloud Console** associated with your organization.

## Setup Overview

The setup process involves three main parts:

1.  Configuring the necessary permissions in the Google Cloud Console.
2.  Authorizing the service account in the Google Workspace Admin Console.
3.  Entering the generated credentials into the OpenArchiver application.

---

### Part 1: Google Cloud Console Setup

In this part, you will create a service account and enable the APIs it needs to function.

1.  **Create a Google Cloud Project:**
    - Go to the [Google Cloud Console](https://console.cloud.google.com/).
    - If you don't already have one, create a new project for the archiving service (e.g., "Email Archiver").

2.  **Enable Required APIs:**
    - In your selected project, navigate to the **"APIs & Services" > "Library"** section.
    - Search for and enable the following two APIs:
        - **Gmail API**
        - **Admin SDK API**

3.  **Create a Service Account:**
    - Navigate to **"IAM & Admin" > "Service Accounts"**.
    - Click **"Create Service Account"**.
    - Give the service account a name (e.g., `email-archiver-service`) and a description.
    - Click **"Create and Continue"**. You do not need to grant this service account any roles on the project. Click **"Done"**.

4.  **Generate a JSON Key:**
    - Find the service account you just created in the list.
    - Click the three-dot menu under **"Actions"** and select **"Manage keys"**.
    - Click **"Add Key"** > **"Create new key"**.
    - Select **JSON** as the key type and click **"Create"**.
    - A JSON file will be downloaded to your computer. **Keep this file secure, as it contains private credentials.** You will need the contents of this file in Part 3.

### Troubleshooting

#### Error: "iam.disableServiceAccountKeyCreation"

If you receive an error message stating `The organization policy constraint 'iam.disableServiceAccountKeyCreation' is enforced` when trying to create a JSON key, it means your Google Cloud organization has a policy preventing the creation of new service account keys.

To resolve this, you must have **Organization Administrator** permissions.

1.  **Navigate to your Organization:** In the Google Cloud Console, use the project selector at the top of the page to select your organization node (it usually has a building icon).
2.  **Go to IAM:** From the navigation menu, select **"IAM & Admin" > "IAM"**.
3.  **Edit Your Permissions:** Find your user account in the list and click the pencil icon to edit roles. Add the following two roles:
    - `Organization Policy Administrator`
    - `Organization Administrator`
      _Note: These roles are only available at the organization level, not the project level._
4.  **Modify the Policy:**
    - Navigate to **"IAM & Admin" > "Organization Policies"**.
    - In the filter box, search for the policy **"iam.disableServiceAccountKeyCreation"**.
    - Click on the policy to edit it.
    - You can either disable the policy entirely (if your security rules permit) or add a rule to exclude the specific project you are using for the archiver from this policy.
5.  **Retry Key Creation:** Once the policy is updated, return to your project and you should be able to generate the JSON key as described in Part 1.

---

### Part 2: Grant Domain-Wide Delegation

Now, you will authorize the service account you created to access data from your Google Workspace.

1.  **Get the Service Account's Client ID:**
    - Go back to the list of service accounts in the Google Cloud Console.
    - Click on the service account you created.
    - Under the **"Details"** tab, find and copy the **Unique ID** (this is the Client ID).

2.  **Authorize the Client in Google Workspace:**
    - Go to your **Google Workspace Admin Console** at [admin.google.com](https://admin.google.com).
    - Navigate to **Security > Access and data control > API controls**.
    - Under the "Domain-wide Delegation" section, click **"Manage Domain-wide Delegation"**.
    - Click **"Add new"**.

3.  **Enter Client Details and Scopes:**
    - In the **Client ID** field, paste the **Unique ID** you copied from the service account.
    - In the **OAuth scopes** field, paste the following two scopes exactly as they appear, separated by a comma:
        ```
        https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/gmail.readonly
        ```
    - Click **"Authorize"**.

The service account is now permitted to list users and read their email data across your domain.

---

### Part 3: Connecting in OpenArchiver

Finally, you will provide the generated credentials to the application.

1.  **Navigate to Ingestion Sources:**
    From the main dashboard, go to the **Ingestion Sources** page.

2.  **Create a New Source:**
    Click the **"Create New"** button.

3.  **Fill in the Configuration Details:**
    - **Name:** Give the source a name (e.g., "Google Workspace Archive").
    - **Provider:** Select **"Google Workspace"** from the dropdown.
    - **Service Account Key (JSON):** Open the JSON file you downloaded in Part 1. Copy the entire content of the file and paste it into this text area.
    - **Impersonated Admin Email:** Enter the email address of a Super Administrator in your Google Workspace (e.g., `admin@your-domain.com`). The service will use this user's authority to discover all other users.

4.  **Save Changes:**
    Click **"Save changes"**.

## What Happens Next?

Once the connection is saved and verified, the system will begin the archiving process:

1.  **User Discovery:** The service will first connect to the Admin SDK to get a list of all active users in your Google Workspace.
2.  **Initial Import:** The system will then start a background job to import the mailboxes of all discovered users. The status will show as **"Importing"**. This can take a significant amount of time depending on the number of users and the size of their mailboxes.
3.  **Continuous Sync:** After the initial import is complete, the status will change to **"Active"**. The system will then periodically check each user's mailbox for new emails and archive them automatically.

### Troubleshooting

#### `429` Too Many Requests - `RESOURCE_EXHAUSTED`

The Gmail API has strict per-user limits on the number of requests. If you have multiple non-admin users in your Google Workspace, and the `SYNC_FREQUENCY` in your `.env` file for OpenArchiver is left at its default, you may quickly encounter `429` HTTP errors.

You can set the `SYNC_FREQUENCY` when configuring your environment for OpenArchiver to reduce the number of requests. A sensible setting might be once every hour (`SYNC_FREQUENCY=0 * * * *`).
