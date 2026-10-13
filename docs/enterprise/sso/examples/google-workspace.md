# Google Workspace

Connect Open Archiver directly to Google Workspace so that people sign in with their Google account.

Google Workspace works with both protocols Open Archiver supports, but they are not equivalent. Choose before you start, because switching later means reconfiguring both sides.

|                                | OpenID Connect         | SAML 2.0                         |
| ------------------------------ | ---------------------- | -------------------------------- |
| Administrative rights required | A Google Cloud project | Google Workspace **super admin** |
| Group-based role assignment    | **Not available**      | Available                        |
| Typical setup time             | About 10 minutes       | About 25 minutes                 |

::: warning Google Workspace does not release group membership over OpenID Connect
Google publishes no group information in its OpenID Connect tokens, so group mappings can never match on an OpenID Connect connection and every user receives the default role. If directory groups must determine Open Archiver roles, use SAML 2.0 — or place [Okta in front of Google Workspace](./google-workspace-okta.md), which provides groups over either protocol.
:::

## Before you begin

| Requirement         | Detail                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| License             | Open Archiver Enterprise with the **SSO** feature enabled                                                                    |
| Open Archiver role  | Super Admin — single sign-on is configured under **Admin → Single Sign-On**                                                  |
| Google rights       | A Google Cloud project for OpenID Connect; Google Workspace **super admin** for SAML                                         |
| Application address | `APP_URL` must be set to the address people use to reach Open Archiver. Every address exchanged with Google derives from it. |

Open **Admin → Single Sign-On** in Open Archiver and start a new connection before configuring Google. The form displays the exact addresses to register, and copying them from the page is more reliable than retyping them from this document.

| Address                                  | Used by        | Example                                                           |
| ---------------------------------------- | -------------- | ----------------------------------------------------------------- |
| **Redirect URI**                         | OpenID Connect | `https://archive.example.com/signin/sso/callback`                 |
| **Service provider metadata URL**        | SAML 2.0       | `https://archive.example.com/api/v1/enterprise/sso/saml/metadata` |
| **Assertion consumer service (ACS) URL** | SAML 2.0       | `https://archive.example.com/signin/sso/callback/saml`            |

Throughout this document, `archive.example.com` stands for your own Open Archiver address and `example.com` for your own Workspace domain.

---

## OpenID Connect

### Part 1 — Create the OAuth client in Google Cloud

1. Open the [Google Cloud console](https://console.cloud.google.com/) and select or create a project.

2. Go to **APIs & Services → OAuth consent screen** and set **User type** to **Internal**.

    Internal restricts sign-in to accounts in your own Workspace domain and avoids Google's application verification review. External is not appropriate here.

3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:

    | Field                    | Value                                             |
    | ------------------------ | ------------------------------------------------- |
    | Application type         | **Web application**                               |
    | Name                     | For example, `Open Archiver`                      |
    | Authorised redirect URIs | `https://archive.example.com/signin/sso/callback` |

    The redirect URI must match the address shown in Open Archiver character for character, including the scheme and any trailing path. Google rejects a sign-in whose redirect URI differs in any way from a registered value.

4. Copy the **Client ID** and **Client secret**. The secret is shown once.

### Part 2 — Create the connection in Open Archiver

Complete all three sections of the connection form. Fields not listed here can keep their defaults.

**Identity provider**

| Field         | Value                                                               |
| ------------- | ------------------------------------------------------------------- |
| Protocol      | **OpenID Connect**                                                  |
| Display name  | `Google` — appears on the sign-in page as "Continue with Google"    |
| Issuer URL    | `https://accounts.google.com`                                       |
| Client ID     | From Part 1                                                         |
| Client secret | From Part 1. Stored encrypted and not displayed again after saving. |

**Accounts**

| Field                            | Value                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Allowed email domains            | `example.com` — your Workspace domain. At least one entry is required. Press Enter after each domain to add it.          |
| Create accounts on first sign-in | **On**, so people receive an account the first time they sign in. Turn it off to restrict access to accounts you create. |
| Link to existing accounts        | **On**, so a person who already has an Open Archiver account keeps it rather than being refused.                         |

**Roles**

| Field                         | Value                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Groups claim                  | Leave as `groups`. Google sends nothing here, so the value has no effect on this connection. |
| **Default role**              | **Required.** Every person signing in through this connection receives this role.            |
| Group mappings                | Leave empty — they cannot match on an OpenID Connect connection to Google.                   |
| Update roles on every sign-in | Has no effect without group mappings; either setting is acceptable.                          |

::: warning A default role is mandatory on this connection
Because Google sends no group information, no mapping can ever match. Open Archiver refuses to create an account that resolves to no role at all, rather than admitting someone who can see nothing — so without a default role, account creation fails on the first sign-in.
:::

### Part 3 — Test, then enable

1. Select **Test connection**. A successful test confirms Open Archiver can reach Google and read its configuration. Resolve any failure before continuing.
2. Turn on **Enable this connection**.
3. Save.

A **Continue with Google** button now appears on the sign-in page.

---

## SAML 2.0

Google requires an **HTTPS** assertion consumer service address, which any production deployment satisfies. You need Google Workspace **super admin** rights.

### Part 1 — Create the custom SAML application in Google

In the [Google Admin console](https://admin.google.com/), go to **Apps → Web and mobile apps → Add app → Add custom SAML app**.

1. **App details** — name the application, for example `Open Archiver`.

2. **Google Identity Provider details** — select **Download metadata** and keep the XML file. You will paste its contents into Open Archiver.

3. **Service provider details**:

    | Field          | Value                                                             |
    | -------------- | ----------------------------------------------------------------- |
    | ACS URL        | `https://archive.example.com/signin/sso/callback/saml`            |
    | Entity ID      | `https://archive.example.com/api/v1/enterprise/sso/saml/metadata` |
    | Name ID format | **EMAIL**                                                         |
    | Name ID        | **Basic Information → Primary email**                             |

    Leave **Signed response** at its default. Open Archiver validates the signature on the assertion.

4. **Attribute mapping** — add a **Group membership** mapping:

    | Field         | Value                                                  |
    | ------------- | ------------------------------------------------------ |
    | Google groups | Select the groups relevant to Open Archiver (up to 75) |
    | App attribute | `Groups`                                               |

    Note the capital G. The name you enter here must be reproduced exactly in Open Archiver.

5. **User access** — turn the application **ON for everyone**, or on for the organisational units that should have access. A person outside the enabled scope receives an access error from Google before reaching Open Archiver.

Google can take several minutes to make a newly created application available.

### Part 2 — Create the connection in Open Archiver

**Identity provider**

| Field            | Value                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Protocol         | **SAML 2.0**                                                                                                                       |
| Display name     | `Google`                                                                                                                           |
| IdP metadata URL | The metadata address from Google's console                                                                                         |
| IdP metadata XML | Paste the file downloaded in Part 1. When present, this takes precedence over the URL and is the more reliable option with Google. |

**Accounts** — as for OpenID Connect above.

**Roles**

| Field                         | Value                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Groups claim                  | `Groups` — exactly as entered in Part 1, including capitalisation                       |
| Group mappings                | The Google group's **email address** on the left, the Open Archiver role on the right   |
| Default role                  | Recommended, as the fallback for anyone matching no mapping                             |
| Update roles on every sign-in | **On**, so moving a person between Google groups updates their role at the next sign-in |

::: tip Google identifies groups by email address
Enter `engineering@example.com`, not `Engineering`. Matching is exact and case-sensitive. A sign-in that succeeds but grants the default role instead of the mapped one is almost always caused by a mismatch here.
:::

### Part 3 — Test, then enable

As for OpenID Connect. A successful SAML test reports the sign-in address and the number of signing certificates found in the metadata.

---

## Verify the first sign-in

Sign in from a private browser window, so an existing Google session does not mask the flow.

1. Open the Open Archiver sign-in page and select **Continue with Google**.
2. Complete Google's sign-in.
3. Confirm you arrive at the dashboard.

Then check the following as an administrator:

| Where                                 | What to confirm                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Settings → Users**                  | The account exists with the expected role — the mapped role on SAML, the default role on OpenID Connect |
| **Compliance → Audit Log**            | An account-creation entry for a first sign-in, and a sign-in entry for every sign-in                    |
| **Settings → Account** (as that user) | Password management is hidden for accounts created through single sign-on                               |

---

## Troubleshooting

Failed sign-ins show the same brief message to the person signing in. The explanation is recorded in **Compliance → Audit Log**, where each failed sign-in entry names the connection, the address the provider supplied, and the domains the connection permits.

| Symptom                                                          | Cause                                                               | Resolution                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Sign-in fails; audit log reports a domain that is not allowed    | The address Google supplied is not in **Allowed email domains**     | Add the domain shown in the audit entry, or correct the account being used           |
| Sign-in fails; audit log reports no role could be determined     | A new account matched no group mapping and no default role is set   | Set a **Default role**                                                               |
| Sign-in succeeds but the role is the default, not the mapped one | The groups claim name or the group values do not match              | Confirm **Groups claim** is `Groups`, and that mappings use group email addresses    |
| Google reports that the application is not available             | The application is off for that person's organisational unit        | In the Google Admin console, turn the application on for their organisational unit   |
| Google rejects the redirect address                              | The registered redirect URI differs from the one Open Archiver uses | Copy the redirect URI from the Open Archiver connection form and register it exactly |
| No sign-in button appears                                        | The connection is not enabled, or the license does not include SSO  | Enable the connection; confirm the license under **Admin → License**                 |

---

## Reference

- **Group limit.** Google includes at most 75 groups in a SAML response. Select only the groups relevant to Open Archiver.
- **Account selection.** Google offers whichever accounts the browser is already signed in to. The allowed-domain list is what prevents other accounts from gaining access, so a refusal occurs after Google's account chooser rather than before it.
- **Signing out.** Signing out of Open Archiver does not end the Google session. Use a private window when testing repeatedly.

For the roles model, running several providers at once, and requiring single sign-on, see the [SSO guide](../guide.md).
