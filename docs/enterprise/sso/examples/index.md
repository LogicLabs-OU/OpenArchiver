# SSO Examples

Complete configuration procedures for the identity providers most Open Archiver customers use. Each example covers both supported protocols, from registering the application at the provider through to verifying the first sign-in and resolving common failures.

| Example                                                 | Protocols      | Group-based roles |
| ------------------------------------------------------- | -------------- | ----------------- |
| [Google Workspace](./google-workspace.md)               | OIDC, SAML 2.0 | SAML only         |
| [Google Workspace via Okta](./google-workspace-okta.md) | OIDC, SAML 2.0 | Both              |
| [Microsoft 365 (Entra ID)](./microsoft-365.md)          | OIDC, SAML 2.0 | Both              |
| [Microsoft 365 via Okta](./microsoft-365-okta.md)       | OIDC, SAML 2.0 | Both              |

## Choosing an example

**Connect to your identity provider directly** when it is the system that holds your user accounts. This is the shorter path and the usual choice.

**Connect through Okta** when Okta is already your organisation's identity provider, with Google Workspace or Microsoft 365 federated behind it. Okta also resolves one specific limitation: Google Workspace cannot send group membership over OpenID Connect, so if you want directory groups to determine roles and prefer OpenID Connect to SAML, Okta supplies what Google does not.

::: tip One connection per identity provider, not per directory
If Okta, or any other provider, brokers access to several directories, you need only one Open Archiver connection. Add the further directories inside that provider. Creating a separate connection for each directory behind the same provider will not work as expected, because every sign-in resolves to the same account at the brokering provider.
:::

## Choosing a protocol

Where a provider supports both, **OpenID Connect is the simpler choice**: the configuration amounts to one address and two credentials, and Open Archiver reads everything else from the provider automatically.

Choose SAML 2.0 when your organisation standardises on it, when a compliance requirement names it specifically, or when your provider's OpenID Connect implementation omits something you need — group membership from Google Workspace being the common case.

## Before you start any example

Each example lists its own prerequisites, but three apply throughout:

| Requirement         | Detail                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| License             | Open Archiver Enterprise with the **SSO** feature enabled. Confirm under **Admin → License**.                                          |
| Open Archiver role  | Super Admin. Single sign-on is configured under **Admin → Single Sign-On**.                                                            |
| Application address | `APP_URL` must be set to the address people use to reach Open Archiver. Every address you register with your provider derives from it. |

Open the connection form in Open Archiver before configuring your identity provider. It displays the exact addresses to register — the redirect URI for OpenID Connect, and the service provider metadata and assertion consumer service addresses for SAML. Copying them from the page avoids the transcription errors that cause most first-attempt failures.

## After configuring a connection

Every example ends with the same three steps, and none should be skipped:

1. **Test the connection** before enabling it. The test confirms Open Archiver can reach your provider and read its configuration, and it reports a specific reason when it cannot.
2. **Enable the connection**, which adds its button to the sign-in page.
3. **Verify a sign-in** from a private browser window, then confirm the resulting account and role under **Settings → Users**.

When a sign-in fails, the person signing in sees only a brief message. The explanation is recorded in **Compliance → Audit Log**, where each failed entry names the connection involved, the address the provider supplied, and the domains the connection permits — usually enough to identify the misconfiguration without further investigation.

## Related

- [SSO guide](../guide.md) — the accounts and roles model, running several providers at once, requiring single sign-on, and auditing.
