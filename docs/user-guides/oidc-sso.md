# OpenID Connect Single Sign-On

Open Archiver can authenticate existing users through an OpenID Connect (OIDC) identity provider. Enabling OIDC adds a **Sign in with SSO** button to the sign-in page; local email and password login remains available.

## Before You Begin

- Complete the initial Open Archiver setup and create each user locally before they use SSO. OIDC does not automatically provision users.
- The email returned by the provider must match an existing Open Archiver user's email address.
- The provider must include an affirmative email-verification claim in the ID token. By default, Open Archiver requires the standard boolean claim `email_verified` to equal `true`.
- Use HTTPS in production.

## Register the OIDC Client

Create an OIDC client in your identity provider with the following settings:

| Setting            | Value                                                      |
| ------------------ | ---------------------------------------------------------- |
| Application type   | Web application (confidential), or public client with PKCE |
| Redirect URI       | `https://archive.example.com/api/v1/auth/oidc/callback`    |
| Authorization flow | Authorization Code                                         |
| PKCE               | S256                                                       |
| Scopes             | `openid profile email`                                     |

Replace `https://archive.example.com` with the public URL of your Open Archiver instance. The redirect URI must exactly match both the provider registration and `OIDC_REDIRECT_URI`, including its scheme, host, port, path, and trailing-slash behavior.

The provider's discovery document must be available at:

```text
<OIDC_ISSUER_URL>/.well-known/openid-configuration
```

Open Archiver reads the authorization endpoint, token endpoint, signing keys, and supported token endpoint authentication methods from this document. It supports `client_secret_basic`, `client_secret_post`, and `none`; when the provider omits this metadata, OIDC specifies `client_secret_basic` as the default.

## Configure Open Archiver

Add the following values to `.env`:

```env
OIDC_ISSUER_URL=https://idp.example.com/realms/openarchiver
OIDC_CLIENT_ID=openarchiver
OIDC_CLIENT_SECRET=replace-with-the-client-secret
OIDC_REDIRECT_URI=https://archive.example.com/api/v1/auth/oidc/callback
OIDC_SCOPES=openid profile email
OIDC_COOKIE_SECURE=true
```

`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_REDIRECT_URI` enable SSO. For a public client whose discovery metadata advertises the `none` authentication method, omit `OIDC_CLIENT_SECRET` entirely.

If the provider uses nonstandard claims, configure their names:

```env
OIDC_EMAIL_CLAIM=mail
OIDC_EMAIL_VERIFIED_CLAIM=mail_verified
```

The verification claim must be a boolean with the value `true`. Do not point `OIDC_EMAIL_VERIFIED_CLAIM` at a claim that does not reliably prove control of the email address.

Restart Open Archiver after changing its environment:

```bash
docker compose up -d
```

## Test the Integration

1. Ensure an Open Archiver user exists with the same email address as the provider account.
2. Open the Open Archiver sign-in page and select **Sign in with SSO**.
3. Authenticate with the provider.
4. Confirm that the provider redirects back to the dashboard.

If login fails, check the backend logs and verify the issuer URL, redirect URI, client authentication method, requested scopes, email claim, and email-verification claim. An unknown user, a missing email, or an email that is not affirmatively verified is rejected.

## Security Notes

- Open Archiver validates the authorization response state, PKCE verifier, ID token signature, issuer, audience, and nonce.
- OIDC sessions are mapped only to existing users by email; provider roles or groups do not change Open Archiver permissions.
- The identity provider should enforce any required MFA policy for SSO users.
- Keep `OIDC_CLIENT_SECRET` out of source control and rotate it according to your provider's policy.
