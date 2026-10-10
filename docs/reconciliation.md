# Local catalog reconciliation

Firefox imports ownership. A local Node runner enriches public product metadata. Cursor or
ChatGPT can propose disputed identities. Only verified external IDs or a separate human decision
can enter the accepted registry. Library projection requires a confirmed IGDB or RAWG ID and
standalone play. Catalog metadata and package neighbours never create ownership.

Current implementation status: the core, runner and optional background bridge are implemented.
The settings UI provides Games, Unknown and Technical panels, per-product provenance and official
OS, and optional runner controls. Its prepared design was implemented under the user's explicit
instruction to finish autonomously. The local Firefox exchange has passed live acceptance;
catalog matching and full release acceptance remain pending the catalog credentials below.

## Setup on macOS

From this repository, with its pinned Node/pnpm runtime:

```sh
pnpm install --frozen-lockfile
pnpm reconcile install-host
pnpm reconcile keys setup
pnpm reconcile status
```

`keys setup` must run in the user's interactive terminal. It hides input and writes directly to
macOS Keychain under service `Gaming Library Helper reconciliation`, with accounts
`igdb-client-id`, `igdb-client-secret`, and `rawg-key`. Blank input preserves an existing value.
Keys never enter argv, files, extension storage, the exchange, reports, or agent prompts. Status
returns presence booleans. Twitch app tokens exist only in runner memory. The tool never creates
accounts, accepts terms or purchases a catalog plan.

`status` also reports snapshot/result dates, the public input hash, source product count and whether
the accepted result belongs to the current input. Report these dates when using a retained snapshot.

Register an IGDB confidential Twitch client following [official IGDB instructions](https://api-docs.igdb.com/#account-creation).
RAWG keys and access limits are described in [RAWG API documentation](https://rawg.io/apidocs).
Store-link access may depend on the RAWG plan. A denied endpoint is a source-unavailable issue,
not evidence that a game is absent.

The host manifest is installed in
`~/Library/Application Support/Mozilla/NativeMessagingHosts/glh_reconciliation.json`.
Its only allowed extension is `gaming-library-helper@nikita.local`. The launcher points to the
current repository and Node executable. Re-run installation after moving the checkout or runtime.
No service, daemon or schedule is installed. Disconnect disables Firefox exchange without deleting
ownership or the last catalog registry. Removing the host manifest also disables communication.

Enable the optional local runner connection from the extension's settings. Firefox requires the
optional `nativeMessaging` permission at that gesture. Its background polls every 15 minutes and
on startup/manual refresh, and publishes after committed connector changes. It sends changed
footprints and imports accepted results, without executing repository commands. With Firefox
closed the runner can process the previously saved input; Firefox reads results after reopening.
Temporary developer add-ons must be reloaded after Firefox restarts.

## One workflow for Cursor and ChatGPT

1. Read this document and repository `AGENTS.md`. Check `pnpm reconcile status`. If local computer
   access is unavailable, report **skipped: Mac unavailable**. Do not substitute an empty library.
2. Publish the latest Firefox snapshot with Refresh. When Firefox is closed, report the retained
   snapshot's timestamp and explain that ownership was not refreshed. A previous local backup can
   bootstrap collection with `collect --input path`. The earlier version-5 row export is supported;
   missing types remain unverified and must be enriched. Never read a token dump or account storage.
3. Run `pnpm reconcile collect`. It reads all public Steam IDs through anonymous PICS, then IGDB
   external IDs and unresolved title candidates, then RAWG for the remainder. Use `--no-pics` if
   Valve collection is disabled or not authorized. `--packages 817628,12072` supplies explicit
   known package seeds. The runner does not discover every historical/private license package.
4. Read only `artifacts/local/reconciliation/runtime/review.json` for LLM research. It contains
   the unresolved remainder, source store/ID/type/title/date, public links, candidate IDs, and
   reasons, plus public metadata/OS/package observations and explicitly labelled neighbour footprints.
   A package neighbour without an owned footprint is never an owned game. `review.md` is a compact index.
   These files exclude UUIDs, account parameters, private
   aliases, personal notes, performance notes, cookies and credentials. Do not upload the full
   library or Keychain content. Use official APIs, permitted public sources and user-provided
   observations. Do not scrape SteamDB. SteamDB links are for human inspection only.
5. Put evidence-backed candidates in a private version-1 proposals file, copied from
   `proposals.json`. Keep its current `inputHash`. Each proposal has a UUID, store/storeId,
   `candidate: {provider: "igdb" | "rawg", id: positive integer}`, public `evidenceUrls`,
   rationale, and `origin: "llm"`. Optional `independence` proposes kind/dependency and evidence.
   Do not add `approved`, `confirmed`, ownership, commands, credentials or arbitrary fields.
6. Run `pnpm reconcile validate --proposals path`. It checks the snapshot, re-fetches every
   matched catalog ID and relationships, verifies automatic exact IDs/URLs, and verifies review
   ledger receipts. The LLM file only extends the review queue. Search candidates are not matched
   automatically, even when titles are identical. A catalog outage preserves the last accepted result.
   Confirmed deletion of an ID or a changed exact store link removes that match and leaves the source
   footprint in Unknown with an absence/conflict reason. Edition parents are fetched again; an absent
   parent invalidates dependent matches without inventing ownership or replacing them with title guesses.
7. Show the user the ambiguous source IDs, candidate IDs/URLs and reasons. Record only explicitly
   approved decisions using `pnpm reconcile approve --proposal UUID --human`, then run `validate`
   again. An agent must never invent a human decision. `--independence` additionally accepts the
   proposal's displayed launch evidence when the user explicitly approves it. This separate action
   creates a versioned review ledger receipt; proposal flags cannot do this.
8. Refresh in Firefox and verify import status, displayed counts, original provider IDs and retained
   annotations. Report confirmed games separately from Unknown and technical products. A local
   validated file does not prove that Firefox imported it.

## Formats and rules

Library storage is schema **v6**. The migration retains v5 UUIDs, owned references, annotations,
snapshots and performance records. The first v5 write saves a sanitized migration backup under
`gaming-library-helper/migration-backup-v5`. Existing legacy UUID containers remain intact. New
connector products are not merged by title. The catalog registry and Library projection are keyed
by `(store, storeId)` and support multiple products from the same store. A backup round trip retains
every original ID. Registry imports only update the metadata layer.
New Ignore decisions are private annotations keyed by `(store, storeId)`. They override the old UUID's
ignore flag for the selected products and preserve that old flag and its other annotations. Thus a
legacy UUID that projects to two catalog games cannot make Ignore affect an unrelated game. These
annotations are included in local backups and excluded from reconciliation inputs and LLM reports.

Input snapshot, proposal file, collected document, review ledger and accepted result use explicit
version-1 schemas. Accepted results carry input content SHA-256, creation date and rule version 1;
records carry public provenance, verification dates and confirmation methods. Data is stored in
ignored `artifacts/local/reconciliation/runtime/` with private file permissions. Atomic renames,
one runner lock, a separate snapshot commit lock and final hash checks prevent partial/stale commits.
The library input hash covers the ordered public footprints, including original observation dates.
LLM proposals are strict data, never instructions or executable code.

Native Messaging uses bounded UTF-8 frames with a four-byte native-endian length. Documents are
limited to 32 MiB and exchanged in 96,000-character chunks below Firefox's 1 MiB response limit.
Fixed operations are publish begin/chunk/commit, result read and a human review decision. Messages
cannot select file paths, launch shell commands, request credentials or read account storage.
Snapshot mismatch, host failure, revoked permission and malformed result leave the library intact.
Human review messages carry the current Firefox input hash; the host rejects an old snapshot before
writing a decision. Download library backup saves schema v6 and original source UUIDs, provider IDs,
annotations and registry locally. The backup contains private annotations and is not an LLM input.

Rules:

- Independently playable main games, standalone expansions, remakes and remasters are eligible.
  Mods require evidence of no paid base-game dependency; a free engine is permitted. Unproved
  launch requirements remain Unknown.
- Verified edition relationships collapse to the base catalog game. Remakes/remasters retain
  their own IDs. Title suffixes never prove an edition relationship. RAWG lacks a general edition
  contract: an unproved relation remains separate/Unknown.
- Original store type and computed role remain separate. Positive incompatible IDs/types yield
  Unknown. Missing credentials, unavailable sources and unconfirmed matches have distinct reasons.
  `catalog-not-found` is reserved for a previously known ID or parent that a catalog confirms absent;
  no configured catalog or an empty search cannot establish that absence.
  Source failures carry the affected provider and, when known, its catalog ID. An unrelated unavailable
  provider cannot turn a confirmed deletion into an outage. A separate human decision can resolve a
  changed automatic store link; other positive ID/type contradictions still remain Unknown.
- Complete Valve package membership containing several confirmed game families can infer a
  bundle-related technical role for an unknown Steam app. One family infers edition-or-component;
  unknown neighbours add no basis. Conflicting positive packages yield Unknown. Known games are
  not demoted because they are package members. Partial/manual associations are retained but do
  not establish completeness.
- App `3575160` keeps its own name/ID and package `817628` association. The package's three GTA
  apps do not become owned because the unknown app is owned. The package does not prove a DLC parent.
- OS metadata is recorded per store product. Catalog-wide platforms do not confer official support
  on a particular owned edition. Current PICS enrichment supplies Steam Windows/macOS/Linux flags;
  other products retain unknown OS until an official product observation is provided.
- Store browsing derives cross-ownership from exact verified provider IDs. Titles alone cannot
  hide a game. Existing ignored state can still apply to an exact owned provider ID.

IGDB uses the current `external_game_sources` and `game_type` tables, not deprecated numeric enums.
Steam numeric UIDs are checked against product URLs when present. Other providers need an exact
public product URL or human confirmation; GOG numeric IDs, Epic namespace/item IDs, Amazon distribution
IDs and custom Battle.net IDs are not guessed from unrelated catalog namespaces.

## Scheduled prompt (prepared, not activated)

Use a ChatGPT Work task with **Local computer access with Work Cloud** enabled for the connected Mac.
An ordinary web scheduled task has no automatic access to this repository. Availability and setup
are described in [ChatGPT Work](https://learn.chatgpt.com/docs/get-started-with-work) and
[scheduled tasks](https://learn.chatgpt.com/docs/automations).

Use the same workflow above. Suggested task text:

> Reconcile Gaming Library Helper using its local repository and docs/reconciliation.md. First
> verify local access to the connected Mac; if unavailable, report a skipped run without changing
> files or pretending ownership was refreshed. Run status, collect and validate. Research only the
> sanitized unresolved remainder and add evidence-backed proposals. Do not confirm ambiguous
> identities, alter ownership, scrape SteamDB or expose credentials/private notes. Publish only
> deterministic verified mappings and previously explicit human choices. Report new conflicts,
> failures and review decisions requiring my attention; stay quiet if nothing actionable changed.

Frequency and activation require a separate user instruction. The runner does not wake a powered-off
Mac or create a cloud copy of the library.

## Verification boundary

`pnpm verify` includes core/adapter/background tests and runner protocol/integration tests. Fictional
fixtures cover exact IDs, GTA/package rules, stale/concurrent/repeated runs, privacy, editions,
remakes/remasters/mods and host failures. Before release, additionally verify a full actual Firefox
snapshot → CLI → accepted result → Firefox import, current catalog access, retained annotations and
reconnection after Firefox restart. Passing local tests or installing a host does not establish
live acceptance. Future visual changes follow the rendered-design approval workflow unless the
user explicitly authorizes autonomous implementation for that change.

## Release acceptance status

Fictional core and runner tests cover the exchange, snapshot preservation, schema migration,
annotations, exact-ID validation and unavailable catalogs. A local Firefox exchange was also tested,
including repeated refresh, disconnect/reconnect, background restart and host failure recovery.
Personal acceptance reports and screenshots remain in ignored local artifacts.

Full live catalog acceptance still requires the user's IGDB/RAWG credentials. Without catalog
credentials, source products retain their original ownership and stay Unknown until identity is
verified; that state does not mean the library contains no games. A full Firefox application restart
and Mozilla-signed build acceptance remain release gates. The scheduled workflow is inactive.
