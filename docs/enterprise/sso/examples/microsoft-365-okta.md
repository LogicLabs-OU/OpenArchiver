# Microsoft 365 via Okta

Use this arrangement when Okta is your organisation's identity provider and Microsoft 365 sits behind it. People continue to sign in with their Microsoft work or school account, but Okta is the provider Open Archiver connects to.

```
browser ──► Open Archiver ──OIDC/SAML──► Okta ──► Microsoft 365 (Entra ID)
```

Compared with connecting to Entra ID directly, this route consolidates every provider your organisation uses behind one connection, and it identifies groups by readable name rather than by directory object ID.

::: warning Okta identifies people by their Okta profile, not by their Microsoft account
Whichever provider sits behind Okta, the address Open Archiver receives is the one on the **Okta user profile**. If your Okta users have profile addresses at `example.com`, that is the domain to enter under **Allowed email domains** — not your Microsoft 365 tenant domain, if the two differ. A tenant name ending in `onmicrosoft.com` is very unlikely to be the correct value here.

This is the most common cause of a refused sign-in on a brokered connection, and it also means a single Okta connection covers every provider behind Okta. Configuring one Open Archiver connection per upstream provider is unnecessary and will not behave as expected, because all of them resolve to the same Okta user.
:::

## Before you begin

| Requirement         | Detail                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| License             | Open Archiver Enterprise with the **SSO** feature enabled                                                                  |
| Open Archiver role  | Super Admin — single sign-on is configured under **Admin → Single Sign-On**                                                |
| Okta rights         | Administrator access to your Okta organisation                                                                             |
| Entra ID rights     | Permission to create app registrations, only if Okta is not yet federated to Microsoft 365                                 |
| Application address | `APP_URL` must be set to the address people use to reach Open Archiver. Every address exchanged with Okta derives from it. |

Open **Admin → Single Sign-On** and start a new connection before configuring Okta. The form displays the exact addresses to register; copy them from the page rather than retyping them.

| Address                                  | Used by        | Example                                                           |
| ---------------------------------------- | -------------- | ----------------------------------------------------------------- |
| **Redirect URI**                         | OpenID Connect | `https://archive.example.com/signin/sso/callback`                 |
| **Service provider metadata URL**        | SAML 2.0       | `https://archive.example.com/api/v1/enterprise/sso/saml/metadata` |
| **Assertion consumer service (ACS) URL** | SAML 2.0       | `https://archive.example.com/signin/sso/callback/saml`            |

Throughout this document, `archive.example.com` stands for your own Open Archiver address and `your-org.okta.com` for your own Okta organisation.

---

## Part 1 — Federate Okta to Microsoft 365

Skip this part if Okta is already federated to Microsoft 365, or if your people authenticate against Okta directly.

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to **Identity → Applications → App registrations → New registration**:

    | Field                   | Value                                                                            |
    | ----------------------- | -------------------------------------------------------------------------------- |
    | Name                    | For example, `Okta federation`                                                   |
    | Supported account types | **Accounts in this organizational directory only**                               |
    | Redirect URI            | Platform **Web**, value `https://your-org.okta.com/oauth2/v1/authorize/callback` |

    The redirect address points at **Okta**, not at Open Archiver. Use your Okta custom domain instead if you have configured one.

2. Note the **Application (client) ID**, then create a secret under **Certificates & secrets → New client secret** and copy its **Value**.

3. In the Okta Admin Console, go to **Security → Identity Providers → Add identity provider → Microsoft** and enter the client ID and secret from the previous steps.

4. Go to **Security → Identity Providers → Routing Rules** and add a rule directing the relevant users to the Microsoft provider. Without a routing rule the Microsoft option never appears on the Okta sign-in page, even though the federation itself is correct.

Confirm this works before continuing: open your Okta sign-in page in a private window and complete a Microsoft sign-in.

---

## OpenID Connect

### Part 2 — Create the application in Okta

Go to **Applications → Applications → Create App Integration**, select **OIDC - OpenID Connect** and **Web Application**.

![Okta’s "Create a new app integration" dialog with the OIDC - OpenID Connect sign-in method and the Web Application type selected](/screenshots/sso/okta-create-app-integration.png)

| Field                 | Value                                             |
| --------------------- | ------------------------------------------------- |
| App integration name  | For example, `Open Archiver`                      |
| Grant type            | **Authorization Code**                            |
| Sign-in redirect URI  | `https://archive.example.com/signin/sso/callback` |
| Sign-out redirect URI | Leave blank                                       |

Copy the **Client ID** and **Client secret** from the application's General tab.

**About assignments.** New OpenID Connect applications use Okta's _Federation Broker Mode_, which assigns every user in the organisation implicitly. The Assignments tab shows a notice rather than an Assign button, and access is governed by the application's sign-on policy instead. This is the expected state and needs no action. If your application instead shows a conventional assignment list, assign the people or groups who should have access — the built-in `Everyone` group is a convenient choice.

### Part 3 — Release group membership

Okta offers two routes. Route A is recommended: it is purpose-built for groups and requires no expression syntax.

::: warning Older instructions describe a control that no longer exists
Many guides direct you to set a "Group claim type" and "Groups claim filter" on the application's Sign On tab. That control has been withdrawn from current Okta organisations, where the corresponding dialog contains only Issuer and Audience. Use one of the routes below instead.
:::

#### Route A — custom authorization server

With this route the issuer becomes `https://your-org.okta.com/oauth2/default`.

**Step 1 — Add the claim.** Go to **Security → API → Authorization Servers**, select `default`, then **Claims → Add Claim**:

| Field                 | Value                    |
| --------------------- | ------------------------ |
| Name                  | `groups`                 |
| Include in token type | **ID Token**, **Always** |
| Value type            | **Groups**               |
| Filter                | **Matches regex**, `.*`  |
| Include in            | **Any scope**            |

![Okta’s Edit Claim dialog showing a claim named groups, included in the ID token always, with value type Groups, a "Matches regex" filter of .*, and included in any scope](/screenshots/sso/okta-groups-claim.png)

**Include in: Any scope** matters. Open Archiver requests a fixed set of scopes and does not request a `groups` scope, so a claim restricted to one would never be released.

**Step 2 — Add an access policy _and_ a rule.** On the same authorization server, open **Access Policies**.

Some Okta organisations provide the `default` authorization server without an access policy. Where none exists, sign-in fails at Okta before the browser returns to Open Archiver, and no entry appears in the Open Archiver audit log because the request never arrives.

The two objects do different jobs, and both are required:

- A **policy** is a container. Its only decision is which applications it applies to.
- The **rules** inside it are what actually permit a sign-in. They are evaluated in order, and the first match applies.

**A newly created policy contains no rules and therefore permits nothing.** Select **Add Policy**, assign it to **All clients** or to this application, then **Add Rule** inside it. The template defaults are usually correct; confirm these:

| Field                | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| IF Grant type is     | **Authorization Code**, under _Client acting on behalf of a user_                |
| AND User is          | **Any user assigned the app** — under Federation Broker Mode this means everyone |
| AND Scopes requested | **Any scopes**                                                                   |
| THEN                 | Token lifetimes — defaults are appropriate                                       |

![Okta’s Edit Rule dialog for an authorization server access policy, with the Authorization Code grant checked, "Any user assigned the app" selected, and "Any scopes" requested](/screenshots/sso/okta-authorization-server-rule.png)

When this is correct, the Access Policies tab shows one policy containing one rule, with your application in its assignment list.

#### Route B — federated claims

With this route the issuer stays `https://your-org.okta.com`, and no access policy is required.

On the application's **Sign On** tab, in the **Token claims** section, select **Add expression**:

| Field      | Value                                          |
| ---------- | ---------------------------------------------- |
| Name       | `groups`                                       |
| Value      | `user.getGroups({'group.profile.name': '.*'})` |
| Include in | The **ID token**                               |

The value is an Okta Expression Language expression. Adjust the pattern to narrow which groups are released.

### Part 4 — Create the groups to map

Under **Directory → Groups**, create the groups that should correspond to Open Archiver roles — for example `archive-admins` and `archive-auditors` — and add the relevant people to them.

Where Microsoft 365 groups should drive these, Okta can import them through its Microsoft integration; otherwise maintain the groups in Okta directly. Either way, Open Archiver matches on the **Okta** group name.

### Part 5 — Create the connection in Open Archiver

**Identity provider**

| Field         | Value                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Protocol      | **OpenID Connect**                                                                                 |
| Display name  | `Okta` — appears on the sign-in page as "Continue with Okta"                                       |
| Issuer URL    | `https://your-org.okta.com/oauth2/default` for Route A, or `https://your-org.okta.com` for Route B |
| Client ID     | From Part 2                                                                                        |
| Client secret | From Part 2                                                                                        |

**Accounts**

| Field                            | Value                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Allowed email domains            | The domain of your **Okta profile** addresses — see the note at the top of this page |
| Create accounts on first sign-in | **On**, so people receive an account the first time they sign in                     |
| Link to existing accounts        | **On**, so a person who already has an Open Archiver account keeps it                |

**Roles**

| Field                         | Value                                                                    |
| ----------------------------- | ------------------------------------------------------------------------ |
| Groups claim                  | `groups`                                                                 |
| Group mappings                | The Okta group **name** on the left, the Open Archiver role on the right |
| Default role                  | Recommended, as the fallback for anyone matching no mapping              |
| Update roles on every sign-in | **On**, so moving a person between Okta groups updates their role        |

::: tip Okta identifies groups by name
Enter `archive-admins`, not a directory object ID — this differs from a direct Entra ID connection, which can identify groups by GUID. Matching is exact and case-sensitive: a group named `Everyone` is not matched by a mapping written as `everyone`.
:::

### Part 6 — Test, then enable

1. Select **Test connection**. A successful test confirms Open Archiver can reach Okta and read its configuration.
2. Turn on **Enable this connection**.
3. Save.

---

## SAML 2.0

### Part 2 — Create the application in Okta

Go to **Applications → Applications → Create App Integration** and select **SAML 2.0**.

**Configure SAML**:

| Field                       | Value                                                             |
| --------------------------- | ----------------------------------------------------------------- |
| Single sign-on URL          | `https://archive.example.com/signin/sso/callback/saml`            |
| Audience URI (SP Entity ID) | `https://archive.example.com/api/v1/enterprise/sso/saml/metadata` |
| Name ID format              | **EmailAddress**                                                  |
| Application username        | **Email**                                                         |

Then add a **Group Attribute Statement**:

| Name     | Filter                  |
| -------- | ----------------------- |
| `groups` | **Matches regex**, `.*` |

Finish the wizard. From the application's **Sign On** tab, copy the **Identity Provider metadata** address — it takes the form `https://your-org.okta.com/app/<app-id>/sso/saml/metadata`.

Finally, open the **Assignments** tab and assign the people or groups who should have access. SAML applications use conventional assignments, so this step is required even when your OpenID Connect application did not need it.

### Part 3 — Create the connection in Open Archiver

**Identity provider**

| Field            | Value                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Protocol         | **SAML 2.0**                                                                                           |
| Display name     | `Okta`                                                                                                 |
| IdP metadata URL | The Identity Provider metadata address from Part 2                                                     |
| IdP metadata XML | Leave empty. Okta's metadata address is reachable and keeps certificate changes current automatically. |

**Accounts** and **Roles** — as for OpenID Connect above, with **Groups claim** set to `groups`.

### Part 4 — Test, then enable

As for OpenID Connect. A successful SAML test reports the sign-in address and the number of signing certificates found in the metadata.

---

## Verify the first sign-in

Sign in from a private browser window, so existing Okta and Microsoft sessions do not mask the flow.

1. Open the Open Archiver sign-in page and select **Continue with Okta**.
2. On the Okta sign-in page, choose **Sign in with Microsoft** and authenticate with your work or school account.
3. Confirm you arrive at the dashboard.

Then check the following as an administrator:

| Where                                 | What to confirm                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| **Settings → Users**                  | The account exists, with the role its Okta group grants rather than the default role |
| **Compliance → Audit Log**            | An account-creation entry for a first sign-in, and a sign-in entry for every one     |
| **Settings → Account** (as that user) | Password management is hidden for accounts created through single sign-on            |

To confirm group mapping is live, move the test user to a different Okta group and sign in again. The role should follow at the next sign-in.

---

## Troubleshooting

Two federation steps make diagnosis harder. Check **Okta's Reports → System Log** first: it shows whether a failure occurred between Okta and Microsoft, or between Open Archiver and Okta. Only then consult the Open Archiver audit log.

Failed sign-ins show the same brief message to the person signing in. The explanation is recorded in **Compliance → Audit Log**, where each failed sign-in entry names the connection, the address the provider supplied, and the domains the connection permits.

| Symptom                                                               | Cause                                                                                                  | Resolution                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Sign-in fails; audit log reports a domain that is not allowed         | The address is the **Okta profile** address, whose domain differs from the tenant domain configured    | Add the domain shown in the audit entry — see the note at the top of this page                      |
| Sign-in fails at Okta; nothing appears in the Open Archiver audit log | The request never reached Open Archiver, usually a missing access policy rule (Route A, Step 2)        | Add a policy and a rule on the `default` authorization server                                       |
| Sign-in succeeds but the role is the default, not the mapped one      | The groups claim is absent or the group names do not match                                             | Confirm the claim configuration in Part 3, then compare Okta group names against **Group mappings** |
| The Microsoft option never appears on Okta's sign-in page             | No routing rule directs users to the Microsoft provider                                                | Add a routing rule under **Security → Identity Providers → Routing Rules**                          |
| Okta reports the user is not assigned                                 | The person is not assigned to the application (SAML, or an application without Federation Broker Mode) | Assign them, or the group they belong to, on the application's Assignments tab                      |
| Federation to Microsoft stops working                                 | The client secret created in Part 1 has expired                                                        | Create a new secret in Entra ID and update the identity provider configuration in Okta              |
| No sign-in button appears                                             | The connection is not enabled, or the license does not include SSO                                     | Enable the connection; confirm the license under **Admin → License**                                |

---

## Reference

- **One connection covers every upstream provider.** Because Okta brokers the sign-in, a single Open Archiver connection serves everyone Okta authenticates, whichever provider sits behind it. Add further providers inside Okta, not as additional Open Archiver connections.
- **Group matching is exact and case-sensitive**, and Okta identifies groups by name — not by the directory object IDs a direct Entra ID connection may send.
- **The `Everyone` group is present for every user**, so with a match-everything filter each person always carries at least one group.
- **Client secret expiry.** The secret created in Part 1 expires on the schedule you chose in Entra ID. Record the date; federation stops working when it lapses.
- **Signing out.** Signing out of Open Archiver ends neither the Okta nor the Microsoft session. Use a private window when testing repeatedly.

For the roles model, running several providers at once, and requiring single sign-on, see the [SSO guide](../guide.md).
