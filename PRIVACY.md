# Privacy

Gaming Library Helper is local-first and contains no analytics or telemetry.

## Stored locally

- Store product identifiers and titles imported by the user. The schema supports Steam, GOG,
  Epic, Amazon Games, and Battle.net; current collectors cover all five providers.
- Public Steam metadata imported from a user-authorized anonymous Valve lookup: version-1 local original-app-ID/type/name/source/check-time cache. It is metadata only, never an ownership source. Cache import is restricted to extension pages, validates identity/version, and never reads account credentials. No Valve PICS client is shipped in the extension.
- A separate version-1 public SteamDB evidence catalog records shared package membership for 24 unknown app IDs, with associated app/package identities, source URLs and observation dates. It is bundled data with no runtime SteamDB requests or new host access. It never supplies ownership, an app's own title/type, or a parent relationship; matching uses an existing owned Steam ID only.
- Explicit aliases, ignored state, display preferences and device-specific
  performance assessments.
- If Amazon Games is explicitly connected: version-1 access/refresh credentials in a separate extension-local key. They are used only by the background for Amazon authorization refresh and library reads. They are never included in library views, runtime status responses, exports, repository files, or logs.
- Amazon PKCE verifier/state and the one extension-created sign-in tab ID are kept in browser session storage for a ten-minute sign-in flow; they are not persisted to disk.
- Disabled-by-default sync settings and attempt receipts (time, outcome, last successful count).

## Never collected

- Store passwords, cookie values, existing browser session tokens, CD keys, browser history, personal communications, or payment details. Amazon OAuth credentials generated for the explicitly enabled connection are the separate exception described above.

## Required access

- `storage`: persist the library, settings, and local sync receipts.
- `alarms`: wake the Firefox background event page to check a user-enabled sync schedule.
  It gives no access to account credentials or browsing history.
- Scheduled sync queries only existing matching Steam/GOG/Epic/Battle.net tabs under the granted host access.
  It excludes private tabs and requires one source tab per store. Amazon capture runs directly in the background through its explicitly authorized credentials and needs no source tab. Automatic and manual sync attempts open and focus no tabs.
- The explicit Open-store buttons reuse a matching nonprivate tab or open the store.
  They do not read credentials or change window focus. No broad tabs permission is requested.
- Steam/GOG host access: run the importer and annotate those stores. Requests use the user's
  already authenticated store tab; the extension does not read cookies.

## Optional access

- `https://account.battle.net/*`: requested when connecting Battle.net or syncing an enabled Battle.net connection. Its dedicated content script runs only on the exact `/games` route, performs one bounded same-origin `/api/games-and-subs` read, and selects only rendered title spans, icon filenames, and modern statuses. It never requests `/api/classic-games` or reads account-name siblings, CD-key cells, cookies, page storage, or page framework objects. Only public product identities and titles enter library storage. Trial accounts are excluded. Modern Active accounts do not prove paid expansions or a particular edition. Missing/empty classic cards, unknown products, changed selectors or incomplete lists reject the whole capture; no complete-empty classic snapshot is inferred.

- `https://api.steampowered.com/*`: public Valve catalog names and application types for already
  owned Steam app IDs. Requested by Sync now or when enabling Auto sync for Steam. Denying access
  preserves Steam's last snapshot; manual GOG capture can still run. Background requests use a
  fixed GetItems endpoint, at most 100 validated app IDs per message, and omit credentials.
  No API key, account identifier, password, cookie, or session token is read or sent by this path.
- `https://store.epicgames.com/*`: requested when the user connects Epic, or runs/enables a sync
  that includes Epic. It allows a fixed, read-only Library GraphQL query using the existing store
  session. No OAuth token extraction, credential headers, or account IDs are accepted from callers.
  Denied access preserves the prior library. Epic pages receive no ownership decoration.

- `https://api.steamcmd.net/*`: optional public metadata for unavailable or redirected Steam app IDs. Requested by Sync now or when enabling Steam Auto sync. SteamCMD API is a community service separate from Valve; it receives individual public app IDs, without cookies, tokens, account identifiers, or library titles. Requests use the fixed `/v1/info/:id` route with credentials omitted and at most four concurrent reads. Its metadata can resolve only the original ID already owned in Steam. Without this permission, unknown Steam entries stay unresolved.

- Amazon optional hosts `https://www.amazon.com/*`, `https://api.amazon.com/*`, and `https://gaming.amazon.com/*`: requested only by Amazon Connect. Sign-in runs in one new tab without logging out or deleting cookies. The background checks only its own tab callback, the exact HTTPS Amazon origin/path, a cryptographic nonce, and PKCE. It requests bearer credentials only; no customer/profile extension or native-device fingerprint is requested. Codes and tokens are sent only to fixed Amazon endpoints with redirects rejected and browser cookies omitted. Refresh credentials are kept only in extension-local storage.
- Firefox optional data consent `authenticationInfo`: required before Amazon authorization or token-backed reads. Optional `websiteContent`: required before sending Steam app IDs to the community SteamCMD metadata service. Both features stop using those data paths when consent is absent. The required data-consent declaration remains `none` for the default local-only flow.

## Network activity

Steam/GOG/Epic account endpoints are used for import. Valve's public StoreBrowse catalog receives only
Steam app IDs and fixed language/country parameters. Catalog responses are reduced to identifiers,
names, types, and result codes before reaching the content script.
If a game catalog result points to a different app ID, a separate public Steam Store appdetails
request checks only the original owned ID, with credentials omitted. A redirect never establishes
ownership of the destination game. Consistent redirects retain the original unresolved ID. With optional SteamCMD API access, unavailable records are enriched with public names/types, while empty or unclassified metadata stays unresolved.
There is no price service, analytics, telemetry, or transmission to the extension author.
No API keys are needed by the current implementation. Amazon OAuth uses the native Games device-auth contract, adapted from the documented MIT community integration; authorization registration, token refresh, and read-only distribution entitlements are implemented. Only LIVE Sonic:Game app products are committed; external codes and non-live licenses are excluded. Unknown live product categories or incomplete pages preserve the saved library. No authorization URL/code/token is returned to the options page or source-inspection output.

## Existing-data cleanup

Library schema v5 adds conservative product classification and preserves v4 provider records; v4 migrates v1/v2/v3 library records without changing ownership IDs, annotations,
devices, or snapshots. Old price-provider configuration, API keys, and cached quotes are removed
when migrated state is saved. Sync settings/receipts v2 migrate their separate v1 keys without
enabling new providers. Unsupported existing library data is preserved and reported as an error;
it is never silently replaced with an empty default library.

## Packaging

Private artifacts/local exports and previews are explicitly excluded from WXT source archives; .gitignore alone does not control source ZIP content. Temporary acceptance pages and local metadata assets are also excluded from extension ZIPs. Archive file lists must be checked before any signing/upload. No archive containing a personal export has been uploaded.
