# Provider support and sync contracts

This describes implemented behavior and known limitations. Synthetic tests and a successful build
do not prove that every account, locale or future store response is supported. Private account
acceptance reports and personal exports are not published.

| Provider     | Collection                                                                          | Limitations                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steam        | Complete owned-app IDs from an authenticated store tab; public original-ID metadata | Removed/restricted apps can retain unknown names or types. Non-games are kept separately. Redirects never transfer ownership.                      |
| GOG          | Authenticated, validated pagination and account availability                        | Unexpected counts, types, availability or pagination reject the snapshot.                                                                          |
| Epic         | Fixed read-only Library GraphQL query, cursor pagination                            | Conflicting repeated identities or changed response shapes reject capture. No page decoration.                                                     |
| Amazon Games | Explicit OAuth/PKCE connection; paginated LIVE Sonic:Game entitlements              | Prime claim history, external store codes and non-live licenses are excluded. Unknown live categories reject capture.                              |
| Battle.net   | Key-free modern account response and narrow classic-title/icon DOM reads            | English status/title mapping only; empty, absent or unfinished classic lists fail safely. Active modern accounts do not establish paid expansions. |

## Scheduling

Scheduling defaults to disabled. The options page supports manual sync, per-provider connection,
interval selection, attempt outcome and last-success receipts. Firefox's background restores an
hourly evaluation alarm and uses persisted configuration. The selected provider interval determines
when capture is due; an hourly alarm is not an hourly full import.

Steam/GOG/Epic/Battle.net need exactly one matching, loaded, non-private signed-in source tab.
Automatic capture never creates or focuses store tabs. Amazon uses its separately authorized
background credentials and needs no source tab. Explicit Open-store controls are user actions.
A missing tab, denied permission, authentication error or partial response preserves the old snapshot.

Background contexts are disposable. Successful capture is persisted before success is returned;
concurrent captures share work, and old started-at timestamps cannot overwrite newer snapshots.
Alarms and settings must be verified again after a browser restart. A temporarily loaded add-on is
not a durable installation.

## Defensive import

Store payloads are unknown input. Validate shape, identities, counts, cursors, URLs, product types
and duplicate consistency before commit. Requests have timeouts, bounded retries, rate limits and
sanitized errors. Empty unauthenticated responses do not establish an empty owned library.

Only resolved primary games participate in automatic cross-store matching. Retain unknown IDs and
confirmed components/tools without inventing a display title, parent, edition or ownership claim.
See [product-model.md](product-model.md).

## Verification

Parser tests use fictional fixtures. Boundary tests cover sender spoofing, optional consent,
credentials excluded from messages/exports, auth expiry, cursor conflicts, stale commits, denied
permissions and snapshot preservation. Repository CI also builds Firefox MV3, runs strict
`web-ext lint`, reviews permissions against `config/extension-policy.json` and inspects ZIP paths.

A release additionally needs manual Firefox testing: connect each supported provider, revoke
optional permissions, interrupt a sync, restart the signed add-on and confirm the last good snapshot
and configured alarm survive. See [releasing.md](releasing.md).
