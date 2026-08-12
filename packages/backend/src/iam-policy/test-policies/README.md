# Policy fixtures

Hand-written policies used when checking the IAM engine by hand. Each one is a valid value for
`roles.policies`, so it can be pasted into the JSON mode of the role form.

The shapes worth re-checking after any change to `FilterBuilder`, `mongoToDrizzle` or
`mongoToMeli`:

| Fixture                                     | What it exercises                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.json`                                | `manage all` — the filter builder must return no restriction at all.                                                                                      |
| `read-only-all.json`                        | Several subjects in one statement, no conditions.                                                                                                         |
| `auditor-specific-sources.json`             | `$in` on `ingestion.id`, so the source list is narrowed.                                                                                                  |
| `auditor-specific-mailbox.json`             | A conditional allow **plus** a deny. The deny has to be negated: the role must see the source's emails _except_ the named mailbox, not only that mailbox. |
| `search-only-archive.json`                  | An archive rule that grants `search` without `read`. Search results must still be narrowed by the rule's conditions.                                      |
| `deny-only-archive.json`                    | A deny with no matching allow. Nothing is visible, because a `cannot` rule only narrows an allow.                                                         |
| `end-user.json`                             | `${user.id}` interpolation on both `ingestion.userId` and `archive.ingestionSource.userId`.                                                               |
| `single-ingestion-access.json`              | A single-source scope; the per-record routes must reject every other source.                                                                              |
| `ingestion-admin.json`, `user-manager.json` | Coarse action/subject rules with no conditions.                                                                                                           |
