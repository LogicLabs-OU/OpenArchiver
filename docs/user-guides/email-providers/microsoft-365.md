# Connecting to Microsoft 365

This guide provides instructions for Microsoft 365 administrators to set up a connection that allows the archiving of all user mailboxes within their organization.

The connection uses the **Microsoft Graph API** and an **App Registration** in Microsoft Entra ID. This is a secure, standard method that grants the archiving service permission to read email data on your behalf without ever needing to handle user passwords.

## Prerequisites

- You must have one of the following administrator roles in your Microsoft 365 tenant: **Global Administrator**, **Application Administrator**, or **Cloud Application Administrator**.

## Setup Overview

The setup process involves four main parts, all performed within the Microsoft Entra admin center and the OpenArchiver application:

1.  Registering a new application identity for the archiver in Entra ID.
2.  Granting the application the specific permissions it needs to read mail.
3.  Creating a secure password (a client secret) for the application.
4.  Entering the generated credentials into the OpenArchiver application.

---

### Part 1: Register a New Application in Microsoft Entra ID

First, you will create an "App registration," which acts as an identity for the archiving service within your Microsoft 365 ecosystem.

1.  Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com).
2.  In the left-hand navigation pane, go to **Identity > Applications > App registrations**.
3.  Click the **+ New registration** button at the top of the page.
4.  On the "Register an application" screen:
    - **Name:** Give the application a descriptive name you will recognize, such as `OpenArchiver Service`.
    - **Supported account types:** Select **"Accounts in this organizational directory only (Default Directory only - Single tenant)"**. This is the most secure option.
    - **Redirect URI (optional):** You can leave this blank.
5.  Click the **Register** button. You will be taken to the application's main "Overview" page.

---

### Part 2: Grant API Permissions

Next, you must grant the application the specific permissions required to read user profiles and their mailboxes.

1.  From your new application's page, select **API permissions** from the left-hand menu.
2.  Click the **+ Add a permission** button.
3.  In the "Request API permissions" pane, select **Microsoft Graph**.
4.  Select **Application permissions**. This is critical as it allows the service to run in the background without a user being signed in.
5.  In the "Select permissions" search box, find and check the boxes for the following two permissions:
    - `Mail.Read`
    - `User.Read.All`
6.  Click the **Add permissions** button at the bottom.
7.  **Crucial Final Step:** You will now see the permissions in your list with a warning status. You must grant consent on behalf of your organization. Click the **"Grant admin consent for [Your Organization's Name]"** button located above the permissions table. Click **Yes** in the confirmation dialog. The status for both permissions should now show a green checkmark.

---

### Part 3: Create a Client Secret

The client secret is a password that the archiving service will use to authenticate. Treat this with the same level of security as an administrator's password.

1.  In your application's menu, navigate to **Certificates & secrets**.
2.  Select the **Client secrets** tab and click **+ New client secret**.
3.  In the pane that appears:
    - **Description:** Enter a clear description, such as `OpenArchiver Key`.
    - **Expires:** Select an expiry duration. We recommend **12 or 24 months**. Set a calendar reminder to renew it before it expires to prevent service interruption.
4.  Click **Add**.
5.  **IMMEDIATELY COPY THE SECRET:** The secret is now visible in the **"Value"** column. This is the only time it will be fully displayed. Copy this value now and store it in a secure password manager before navigating away. If you lose it, you must create a new one.

---

### Part 4: Connecting in OpenArchiver

You now have the three pieces of information required to configure the connection.

1.  **Navigate to Ingestion Sources:**
    In the OpenArchiver application, go to the **Ingestion Sources** page.

2.  **Create a New Source:**
    Click the **"Create New"** button.

3.  **Fill in the Configuration Details:**
    - **Name:** Give the source a name (e.g., "Microsoft 365 Archive").
    - **Provider:** Select **"Microsoft 365"** from the dropdown.
    - **Application (Client) ID:** Go to the **Overview** page of your app registration in the Entra admin center and copy this value.
    - **Directory (Tenant) ID:** This value is also on the **Overview** page.
    - **Client Secret Value:** Paste the secret **Value** (not the Secret ID) that you copied and saved in the previous step.

4.  **Save Changes:**
    Click **"Save changes"**.

## What Happens Next?

Once the connection is saved, the system will begin the archiving process:

1.  **User Discovery:** The service will connect to the Microsoft Graph API to get a list of all users in your organization.
2.  **Initial Import:** The system will begin a background job to import the mailboxes of all discovered users, folder by folder. The status will show as **"Importing"**. This can take a significant amount of time.
3.  **Continuous Sync:** After the initial import, the status will change to **"Active"**. The system will use Microsoft Graph's delta query feature to efficiently fetch only new or changed emails, ensuring the archive stays up-to-date.

### Messages Graph cannot render

With app-only access, Microsoft Graph refuses to produce the original MIME content for some items and answers `ErrorMimeContentConversionFailed` every time. This affects S/MIME-encrypted and opaque-signed messages (`IPM.Note.SMIME`) and non-delivery reports about signed mail (`REPORT.IPM.Note.SMIME.NDR`, `REPORT.IPM.Note.SMIME.MultipartSigned.NDR`). Clear-signed messages are not affected.

These items are skipped so the rest of the mailbox can be archived and its sync position saved. They are **not** in the archive. The ingestion worker logs each one at `warn` level with its message ID, the Graph error code and the message class, and logs one summary line per mailbox run with the count and sample IDs. Keep those log lines if you need a record of what the archive is missing.
