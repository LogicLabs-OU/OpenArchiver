# Microsoft 365 (Entra ID)

Connect Open Archiver directly to Microsoft Entra ID, the identity service behind Microsoft 365, so that people sign in with their work or school account.

Entra ID supports both protocols fully, including group membership over either. OpenID Connect requires fewer steps and is the recommended choice unless your organisation standardises on SAML.

## Before you begin

| Requirement         | Detail                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| License             | Open Archiver Enterprise with the **SSO** feature enabled                                                                      |
| Open Archiver role  | Super Admin — single sign-on is configured under **Admin → Single Sign-On**                                                    |
| Entra ID rights     | Permission to create app registrations or enterprise applications, typically Application Administrator or Global Administrator |
| Application address | `APP_URL` must be set to the address people use to reach Open Archiver. Every address exchanged with Entra ID derives from it. |

Open **Admin → Single Sign-On** and start a new connection before configuring Entra ID. The form displays the exact addresses to register; copy them from the page rather than retyping them.

| Address                                  | Used by        | Example                                                           |
| ---------------------------------------- | -------------- | ----------------------------------------------------------------- |
| **Redirect URI**                         | OpenID Connect | `https://archive.example.com/signin/sso/callback`                 |
| **Service provider metadata URL**        | SAML 2.0       | `https://archive.example.com/api/v1/enterprise/sso/saml/metadata` |
| **Assertion consumer service (ACS) URL** | SAML 2.0       | `https://archive.example.com/signin/sso/callback/saml`            |

Throughout this document, `archive.example.com` stands for your own Open Archiver address and `example.com` for your own Microsoft 365 domain.

---

## OpenID Connect

### Part 1 — Register the application in Entra ID

In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to **Identity → Applications → App registrations → New registration**.

1. Complete the registration:

    | Field                   | Value                                                                     |
    | ----------------------- | ------------------------------------------------------------------------- |
    | Name                    | For example, `Open Archiver`                                              |
    | Supported account types | **Accounts in this organizational directory only**                        |
    | Redirect URI            | Platform **Web**, value `https://archive.example.com/signin/sso/callback` |

2. From the **Overview** page, note the **Application (client) ID** and the **Directory (tenant) ID**.

3. Go to **Certificates & secrets → Client secrets → New client secret**. Set an expiry that matches your rotation policy, then copy the secret **Value** immediately — it is not shown again once you navigate away.

    Note the expiry date. Sign-in stops working when the secret expires, and the fix is to create a new secret and update the connection.

### Part 2 — Add the groups claim

Skip this part if you do not intend to assign roles from directory groups.

In the app registration, go to **Token configuration → Add groups claim**.

1. Select which groups to include. **Security groups** is the usual choice. **Groups assigned to the application** keeps tokens smaller and is preferable in large directories.

2. Expand **ID** under _Customize token properties by type_ and choose to emit **group names** rather than group IDs, if readable names are wanted.

::: warning Entra ID sends group IDs unless you change this
By default the groups claim contains directory object IDs such as `f8c1e0a2-…`, not names such as `Finance`. Whichever format you choose, the **Group mappings** in Open Archiver must use exactly that format. Name-based emission applies to cloud groups; groups synchronised from on-premises Active Directory are identified by `sAMAccountName`.
:::

### Part 3 — Verify the email claim

Open Archiver requires an email address in the token and refuses a sign-in without one.

Entra ID supplies an address for accounts whose **mail** attribute is populated. If some accounts in your directory leave it unset, add the claim explicitly: **Token configuration → Add optional claim → ID → `email`**.

### Part 4 — Create the connection in Open Archiver

**Identity provider**

| Field         | Value                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Protocol      | **OpenID Connect**                                                             |
| Display name  | `Microsoft 365` — appears on the sign-in page as "Continue with Microsoft 365" |
| Issuer URL    | `https://login.microsoftonline.com/<tenant-id>/v2.0`                           |
| Client ID     | The Application (client) ID from Part 1                                        |
| Client secret | The secret **Value** from Part 1                                               |

The issuer must include the `/v2.0` suffix and your own tenant ID. Omitting the suffix produces a configuration that cannot be read.

**Accounts**

| Field                            | Value                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Allowed email domains            | Your Microsoft 365 domain, for example `example.com`. At least one entry is required; press Enter after each domain. |
| Create accounts on first sign-in | **On**, so people receive an account the first time they sign in                                                     |
| Link to existing accounts        | **On**, so a person who already has an Open Archiver account keeps it                                                |

Enter the domain that appears in your users' email addresses. In tenants that use a vanity domain, this is that domain — not the `onmicrosoft.com` tenant name.

**Roles**

| Field                         | Value                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Groups claim                  | `groups`                                                                                                   |
| Group mappings                | The group name or object ID on the left — matching the format chosen in Part 2 — and the role on the right |
| Default role                  | Recommended, as the fallback for anyone matching no mapping                                                |
| Update roles on every sign-in | **On**, so directory group changes take effect at the next sign-in                                         |

### Part 5 — Test, then enable

1. Select **Test connection**. A successful test confirms Open Archiver can reach Entra ID and read its configuration.
2. Turn on **Enable this connection**.
3. Save.

---

## SAML 2.0

### Part 1 — Create the enterprise application

In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to **Identity → Applications → Enterprise applications → New application → Create your own application**. Select **Integrate any other application you don't find in the gallery**, name it, and create it.

Open **Single sign-on → SAML** and complete the sections below.

1. **Basic SAML Configuration**:

    | Field                                      | Value                                                             |
    | ------------------------------------------ | ----------------------------------------------------------------- |
    | Identifier (Entity ID)                     | `https://archive.example.com/api/v1/enterprise/sso/saml/metadata` |
    | Reply URL (Assertion Consumer Service URL) | `https://archive.example.com/signin/sso/callback/saml`            |

    Leave **Sign on URL** empty. Open Archiver always begins sign-in from its own sign-in page.

2. **Attributes & Claims** — confirm the unique user identifier (Name ID) is `user.mail` or `user.userprincipalname`, in email format.

    Then select **Add a group claim**, choose which groups to emit, and under the advanced options choose whether groups are identified by name or by object ID. Name the claim `groups`.

3. **SAML Certificates** — copy the **App Federation Metadata Url**.

4. **Users and groups** — assign the people or groups who should have access. Entra ID refuses sign-in for anyone not assigned.

### Part 2 — Create the connection in Open Archiver

**Identity provider**

| Field            | Value                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Protocol         | **SAML 2.0**                                                                                               |
| Display name     | `Microsoft 365`                                                                                            |
| IdP metadata URL | The **App Federation Metadata Url** from Part 1                                                            |
| IdP metadata XML | Leave empty. Entra ID's metadata address is reachable and keeps certificate changes current automatically. |

**Accounts** and **Roles** — as for OpenID Connect above, with **Groups claim** set to `groups`.

### Part 3 — Test, then enable

As for OpenID Connect. A successful SAML test reports the sign-in address and the number of signing certificates found in the metadata.

---

## Verify the first sign-in

Sign in from a private browser window, so an existing Microsoft session does not mask the flow.

1. Open the Open Archiver sign-in page and select **Continue with Microsoft 365**.
2. Complete Microsoft's sign-in.
3. Confirm you arrive at the dashboard.

Then check the following as an administrator:

| Where                                 | What to confirm                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| **Settings → Users**                  | The account exists with the role its groups should grant                         |
| **Compliance → Audit Log**            | An account-creation entry for a first sign-in, and a sign-in entry for every one |
| **Settings → Account** (as that user) | Password management is hidden for accounts created through single sign-on        |

---

## Troubleshooting

Failed sign-ins show the same brief message to the person signing in. The explanation is recorded in **Compliance → Audit Log**, where each failed sign-in entry names the connection, the address the provider supplied, and the domains the connection permits.

| Symptom                                                          | Cause                                                                             | Resolution                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Sign-in fails; audit log reports a domain that is not allowed    | The address Entra ID supplied is not in **Allowed email domains**                 | Add the domain shown in the audit entry. Check whether your tenant sends a vanity domain or an `onmicrosoft.com` address. |
| Sign-in fails; audit log reports a missing email address         | The account has no **mail** attribute and no `email` optional claim is configured | Populate the attribute, or add the `email` optional claim as described in Part 3                                          |
| Sign-in fails; audit log reports no role could be determined     | A new account matched no group mapping and no default role is set                 | Set a **Default role**                                                                                                    |
| Sign-in succeeds but the role is the default, not the mapped one | Mappings use names while the token carries object IDs, or the reverse             | Compare the format chosen in Part 2 against the values in **Group mappings**                                              |
| Sign-in worked previously and now fails for everyone             | The client secret has expired                                                     | Create a new secret in **Certificates & secrets** and update the connection                                               |
| Microsoft reports the user is not assigned                       | The person is not in the application's **Users and groups** list (SAML)           | Assign them, or the group they belong to                                                                                  |
| No sign-in button appears                                        | The connection is not enabled, or the license does not include SSO                | Enable the connection; confirm the license under **Admin → License**                                                      |

---

## Reference

- **Group limits.** Entra ID includes at most 200 groups in an OpenID Connect token and 150 in a SAML assertion, nested groups included. Where a person may exceed the limit, restrict the claim to **Groups assigned to the application**.
- **Certificate rollover.** Entra ID signing certificates expire, typically after three years. Because Open Archiver reads the metadata address rather than a stored copy, a rotated certificate is picked up without intervention. This is why the metadata URL is preferred over pasted XML.
- **Client secret expiry.** Unlike the certificate, an expired client secret must be replaced by hand. Record the expiry date when you create it.
- **Signing out.** Signing out of Open Archiver does not end the Microsoft session. Use a private window when testing repeatedly.

For the roles model, running several providers at once, and requiring single sign-on, see the [SSO guide](../guide.md).
