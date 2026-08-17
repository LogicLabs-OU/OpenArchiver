# Enterprise feature notice — contract for the Enterprise repository

The frontend is shared between the two editions, so this note describes a contract the enterprise
build has to keep. It matters because the open-source half of it is already done and the enterprise
half is not.

## What the open-source build does

The navigation is now identical in both editions. Every page is listed, including the seven that only
work under a licence:

`compliance/audit-log`, `compliance/retention-policies`, `compliance/retention-labels`,
`compliance/legal-holds`, `ingestions/journaling`, `admin/security`, `admin/license`.

In an OSS build, each of those loaders calls `enterpriseOnly()` from
`packages/frontend/src/lib/server/enterprise-gate.ts`, which throws:

```ts
error(403, {
	message: 'This feature is only available in the Enterprise Edition.',
	code: 'enterprise_only',
	featureKey: 'app.legal_holds.title',
	pitchKey: 'app.components.enterprise_feature_notice.pitch.legal_holds',
});
```

`routes/dashboard/+error.svelte` reads `code` and renders `EnterpriseFeatureNotice` instead of the
red failure alert. `featureKey` and `pitchKey` are **translation keys**, not text — the loader runs on
the server where `$t` is unavailable, so the component resolves them in the user's locale.

## The rule

**Decide from `code`, never from the 403 status.** A 403 means "refused", and refusal has two very
different causes:

| Cause                                                | What the user should see |
| ---------------------------------------------------- | ------------------------ |
| The edition or licence does not include this feature | The upgrade notice       |
| This account lacks the permission                    | The ordinary error       |

Answering a permission refusal with an upgrade pitch tells an administrator to buy something the
organisation already owns, and hides the real problem — that someone's role needs fixing. That is
worse than showing nothing, so the distinction has to be explicit rather than inferred.

## What the Enterprise build has to add

In an enterprise build `enterpriseMode` is true, so every guard above is dead code and none of this
fires. The equivalent case there is the **backend** refusing a request because the licence does not
cover that feature, and today that refusal is indistinguishable from a permission refusal by the time
it reaches the frontend.

Two pieces are needed:

1. **Backend.** When the enterprise API refuses for a licence reason, answer with a machine-readable
   marker in the body — for example `{ "code": "feature_not_licensed", "feature": "legal_holds" }` —
   distinct from anything a permission check returns. A human-readable `message` is not enough:
   matching on message text breaks the moment the wording or the locale changes.

2. **Loaders.** Where an enterprise loader handles a non-OK response, map **only** that marker onto
   `error(403, { code: 'enterprise_only', featureKey, pitchKey })`. Every other 403 keeps its current
   behaviour. `enterpriseOnly()` already builds the right shape, so the mapping is one call.

Until both are in place, an enterprise instance whose licence has lapsed or whose plan excludes a
feature shows the plain error, which is a worse experience than the open-source build gets. That is
the gap this note exists to close.

## Do not break

- `App.Error` in `packages/frontend/src/app.d.ts` is the interface between the repositories. Every
  field beyond `message` is optional, so removing or renaming one **will not fail the enterprise
  build** — the notice will simply stop appearing, silently. Treat a change there as a breaking
  change and check both repositories.
- `EnterpriseFeatureNotice` takes already-translated strings for `feature` and `instructions`. Passing
  a raw key renders the key.
- The pitch copy lives under `app.components.enterprise_feature_notice.pitch.*` in the shared
  translations. A new licensed feature needs a key there, or the notice appears without its
  explanatory line.
- `admin/license` is the one page with nothing to sell — an open-source instance has no licence to
  show, so its copy says exactly that instead of pitching. Keep that distinction if the page changes.
