# Architecture

## Shape

```text
Steam/GOG/Epic/Battle.net page (Amazon uses an explicit background OAuth flow)
  -> store content adapter (untrusted DOM / authenticated same-origin request)
  -> validated runtime message
  -> background event page
  -> atomic library merge + browser.storage.local
  -> read-only page projection
  -> badge / hide decision
```

The extension is split into four boundaries:

1. `src/core`: pure schemas, normalization, merge, visibility, and performance types.
2. `src/adapters`: defensive translators for Steam, GOG, Epic, Amazon Games, and Battle.net.
3. `src/entrypoints/background.ts`: disposable orchestration over persistent storage.
4. popup/options/content entrypoints: user gestures and rendering only.

## Identity and matching

Each canonical game has a stable internal ID and zero or one owned reference per store. A reference
contains the store product ID, title, URL, and import evidence. Exact normalized titles can merge
automatically. Explicit aliases can merge editions the user has reviewed. Fuzzy similarity produces
only a reconciliation candidate.

This intentionally prefers false negatives over false positives: missing a badge is inconvenient;
claiming ownership of the wrong edition can cause a bad purchase decision.

## Snapshot semantics

A sync builds and validates a complete candidate snapshot before changing durable state. On commit,
all previous references for that store are replaced in one storage write, while annotations and
references from other stores survive. Partial pagination or schema errors reject the candidate and
preserve the last successful snapshot.

Steam ownership comes from the authenticated store tab's complete owned-app array. Public Valve
StoreBrowse metadata is read by the background event page after optional API-host permission is
granted. The content script sends only batches of up to 100 positive, unique app IDs. The background
checks the browser-supplied HTTPS Steam Store sender and constructs the fixed API URL itself;
credentials are omitted. Every batch must return exactly the requested IDs. Confirmed non-game
types are retained as components (including mods and betas), tools or auxiliary records (including media, guides, hardware and advertising) and excluded from game ownership matching. Restricted/removed apps keep unresolved IDs; they cannot supply cross-store
ownership badges or hiding decisions. No unknown title or type is guessed.
Successful game records that redirect to a different app ID are checked against public appdetails
for the original ID. Consistent redirects remain unresolved rather than becoming ownership of the destination. Optional community SteamCMD API metadata can enrich only those original unavailable IDs, in at most four concurrent fixed-endpoint requests with credentials omitted. Both the outer response key and any appid/gameid must match the original ID. A confirmed original ID, known type, and game title are needed to resolve a game. Unknown types or empty metadata remain unresolved; invalid identity rejects the snapshot. An extension-page-only import can save verified anonymous Valve metadata in a separate version-1 cache. Strict ID/type/source/time checks and serialized writes preserve unknown versions and newer evidence. The fallback joins only current owned-app IDs, never creates owned references from metadata, and retains confirmed non-game types as separate product records. It sends no extra network request and bundles no PICS client.

Epic uses a fixed cookie-only Library GraphQL query with cursor pagination. Identical repeated
assets are deduplicated only after their selected metadata matches; conflicting repeats reject the
whole capture. Namespace/catalogItemId is the durable product identity. Confirmed non-game entries
are excluded and unknown products remain unresolved. Optional Epic host access is requested on
connection. Fictional tests cover cursor completion, repeated identities and conflicts.

Steam/GOG decoration derives ownership from resolved references in every other supported store.
DOM parsing removes the extension's own badges from a temporary clone. The observer is disconnected
while decorating, so badge writes do not schedule an endless sequence of refreshes. Epic has capture
support only and does not start that DOM observer.

## Performance model

Battle.net uses its own content script restricted to `/games`, with no decoration or document-wide text reads. A key-free games-and-subs response is compared with the rendered modern title/status list. Only Good/Active accounts are retained; Trial/Starter is excluded. Classic licenses are read from exact title descendants and icon filenames, mapped to reviewed public product IDs, and deduplicated without reading license keys. Known classic expansions are components, distinct from base/remastered products. The classic section must be present, nonempty and finished loading: absence cannot prove zero licenses. Unknown statuses/products, malformed rows, overflow or inconsistent lists reject the entire snapshot. This conservative collector does not yet support accounts with no classic licenses or non-English status/title labels.

Performance is not one boolean. A game first has one or more launch paths on each platform:

- official native build;
- native community/open-source port, including a Homebrew/source distribution;
- compatibility layer;
- virtual machine;
- streaming path.

“Native” describes execution, not the installer. A Homebrew formula can install a native Apple
silicon binary, while an official macOS release can still require Rosetta. Each launch path therefore
stores the distribution channel, build architecture, CPU translation, OS/API compatibility layers,
graphics translation, and evidence independently. Proton/Wine/CrossOver, Rosetta/FEX, and
DXVK/D3DMetal are not collapsed into one `runner` string.

A performance assessment belongs to `(game, launch path, device profile)`. It separately records
render and output resolution, base FPS, presented FPS, frame pacing, VRR, settings, upscaling, frame
generation, evidence, and confidence. Gamescope FSR, in-game FSR, MetalFX, Windows Lossless Scaling,
and community `lsfg-vk` are different integrations even if they produce the same output resolution.

Seed device profiles:

- Steam Deck LCD, docked: SteamOS profile plus external-display capabilities.
- Apple MacBook Pro M5, 24 GB: native Metal and compatibility-layer paths are distinct.

The target question “40 base FPS with stable pacing and VRR at 1080p” is answered per launch path
only when every required field is supported by evidence. A separate presented-FPS target can test
frame generation without treating generated frames as base performance. The Lossless Scaling app is
Windows-first, while the community `lsfg-vk` project exposes LSFG through a Vulkan layer on Linux and
SteamOS. The two are recorded separately, and neither generated FPS nor plugin availability proves
acceptable latency, pacing, VRR behavior, or image quality for a specific game.

Persisted state schema v2 introduces launch paths and migrates v1 `runner`/scaler strings into an
explicit, deliberately unverified path so older notes are preserved without inventing compatibility.

## Scheduled capture

The Firefox background event page restores an hourly alarm and evaluates persisted sync settings
and receipts. The backend only signals a single existing nonprivate source tab per enabled store.
It never reads account credentials or opens/focuses tabs during capture. Amazon is the explicitly authorized exception for extension-generated OAuth credentials: its background collector needs no source tab and receives the token only from its private refresh module. The approved options UI
persists intervals and can request a manual capture even with the schedule off; concurrent captures
share work. Explicit Open-store buttons reuse or create a store tab as a user action. Store capture is serialized within a tab;
started-at snapshot timestamps reject stale commits.

Sync settings and receipts use separate version-2 schemas and migrate their v1 records without
enabling additional providers. Library schema v5 adds conservative product classification and presentation grouping (see [product-model.md](product-model.md)); v4 adds provider identities while preserving v1/v2/v3
ownership and performance records and removing obsolete price data. Legacy provider schemas remain
restricted to their original Steam/GOG fields. Unsupported stored library data fails visibly instead
of being replaced with defaults. Scheduling defaults to disabled. See [library-sync.md](library-sync.md) for exact support
and pending live acceptance.

## Amazon authorization boundary

Amazon Connect has explicit user authorization for an OAuth credential path. It requests narrow optional Amazon hosts and Firefox authentication-data consent. Passwords and existing cookie/session-token values are never read. A cryptographic PKCE verifier, nonce, random device serial, one extension-created tab ID, and ten-minute expiry form a version-1 pending flow in storage.session, which is not exposed to content scripts by default. The top-level Firefox URL-change listener verifies the pending tab ID before accepting an exact Amazon root callback with its nonce. It clears the callback URL, exchanges the code through a fixed HTTPS endpoint with redirect forwarding disabled, and saves only bearer credentials under a separate version-1 local key. Failed/new sign-ins preserve the previous credential and every library snapshot. Status messages return booleans only.

The options page and every runtime Amazon action require the extension-page sender boundary. Amazon pages run no content script and receive no tokens. The background refreshes credentials and can perform bounded distribution-source inspection. Diagnostics return counts, public type/state categories, schema field types and a provider-ID hash only. The observed distribution response omits product.type and the terminal cursor. Complete cursor pagination accepts these optional fields while rejecting invalid fields, repeated cursors, conflicting licenses and conflicting product titles. The app collector accepts only LIVE Sonic:Game products, excludes external Twitch:FuelEntitlement and non-live licenses, and rejects unknown live categories. The scheduler commits a complete Amazon snapshot through the same atomic core merge; failures preserve every library snapshot. Successful explicit authorization enables Amazon in the existing schedule when its options page reads the completed connection.
