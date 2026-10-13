# Single Sign-On (SSO)

Single Sign-On lets people sign in to Open Archiver with your organisation's identity provider instead of a local password. Both **OpenID Connect (OIDC)** and **SAML 2.0** are supported, covering providers such as Okta, Microsoft Entra ID, Google Workspace, Keycloak, Authentik, Authelia, and ADFS.

## Overview

An administrator configures a connection to the identity provider under **Admin → Single Sign-On**. Once the connection is enabled, a "Continue with …" button appears on the sign-in page. Accounts can be created automatically on first sign-in (just-in-time provisioning), linked to existing accounts by email address, and assigned roles based on the person's directory groups.

Signing in through SSO produces exactly the same session as a password login. Multi-factor authentication for SSO users is the identity provider's responsibility; local TOTP continues to apply to password logins.

## Prerequisites

- Open Archiver Enterprise license with the **SSO** feature enabled.
- `APP_URL` set to the address users reach the application on — every URL exchanged with the identity provider derives from it.
- `ENCRYPTION_KEY` set — the OIDC client secret is stored encrypted with it.
- An application registered at your identity provider (see below).

## Examples

Step-by-step configuration for common identity providers is in [SSO Examples](./examples/):

- [Google Workspace](./examples/google-workspace.md)
- [Google Workspace via Okta](./examples/google-workspace-okta.md)
- [Microsoft 365 (Entra ID)](./examples/microsoft-365.md)
- [Microsoft 365 via Okta](./examples/microsoft-365-okta.md)

The two sections below describe the generic shape of each protocol; the examples give the exact
console steps for a specific provider.

## Setting up OpenID Connect

1. In your identity provider, create a **web application** using the authorization code flow.
2. Register the redirect URI shown on the Open Archiver SSO admin page: `{APP_URL}/signin/sso/callback`.
3. In Open Archiver, choose the **OpenID Connect** protocol and enter the provider's **issuer URL** (for Keycloak, `https://id.example.com/realms/<realm>`), the **client ID** and the **client secret**. The remaining endpoints are discovered automatically.
4. Add at least one **allowed email domain**. Sign-ins from other domains are refused, for new and existing accounts alike.
5. Use **Test connection** to confirm the issuer is reachable, then enable the connection.

PKCE is always used, and ID tokens are validated against the provider's published signing keys.

## Setting up SAML 2.0

1. In Open Archiver, choose the **SAML 2.0** protocol and enter the identity provider's **metadata URL** (for Keycloak, `https://id.example.com/realms/<realm>/protocol/saml/descriptor`). If the URL cannot be reached from the server, paste the metadata XML instead.
2. In your identity provider, import the Open Archiver **service provider metadata URL** shown on the admin page — it doubles as the SP entity ID — or configure the **ACS URL** (`{APP_URL}/signin/sso/callback/saml`) manually.
3. Configure the provider to release an email address (as the NameID or an email attribute) and, optionally, a group attribute.
4. Test and enable the connection as with OIDC.

Responses from the identity provider are always signature-checked against the certificate in its metadata. Sign-in requests are sent unsigned. IdP-initiated sign-in is not supported: every login starts at the Open Archiver sign-in page.

## Accounts and roles

- **Just-in-time provisioning** creates an account the first time a person signs in. The account has no password — it authenticates only through the identity provider.
- **Linking** attaches SSO to an existing account with the same email address. It can be turned off, in which case only pre-linked or provisioned accounts may sign in.
- **Group mappings** translate the provider's group values (from the configurable groups claim or attribute) into Open Archiver roles. With **Update roles on every sign-in** enabled, moving a person between directory groups changes their role at their next sign-in. Roles only change when a mapping actually matches — a sign-in that matches nothing leaves the account's existing roles untouched, so linking or signing in can never demote an existing user (an administrator included) to the default.
- The **default role** applies only when a brand-new account is created and no mapping matched; without one, an unmatched new user is refused.

## Multiple identity providers

An instance can run several connections at once. Each enabled connection becomes its own button on the sign-in page, so staff on one provider and a partner organisation on another can both sign in, and a migration from one provider to another can run with both live.

Accounts are bound to the specific connection they signed in through, so two providers never resolve to the same account even when they issue the same subject or use email-format identifiers.

## Requiring SSO

The **Require single sign-on** switch turns off password sign-in for ordinary users. Several safeguards apply:

- The switch stays unavailable until at least one sign-in has completed through the connection, so a configuration that has never worked cannot be enforced. Editing the connection's identity — its issuer, protocol, client ID or pasted metadata — clears that proof and switches enforcement off until a sign-in succeeds against the new configuration.
- **Super Admins always keep password sign-in.** This is the recovery path when the identity provider is down or misconfigured.
- Enforcement is **per connection**, not instance-wide, and only reaches users that connection could actually serve: a user whose email domain is outside every enforcing connection's allowed domains keeps password sign-in, since SSO would refuse them too and denying the password would close both doors. With several connections configured, you can require SSO for one and leave the other optional.

If the license lapses, SSO endpoints are disabled and password sign-in returns for everyone — nobody is locked out.

## Auditing

Every SSO sign-in (successful or failed), every just-in-time provisioning, and every configuration change is recorded in the audit log (`SSO_LOGIN`, `SSO_JIT_PROVISION`, `SSO_CONFIG_UPDATED`).
