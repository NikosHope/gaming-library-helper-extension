# Research and third-party provenance

Source contracts were reviewed during development through 2026-10-09. Undocumented store APIs and
markup are unstable; adapters validate responses and retain the last good snapshot on failure.
Private account results and personal library counts are kept outside public source control.

## Adopted dependencies

- [WXT](https://wxt.dev/) — MIT. Firefox builds explicitly use `--mv3`; source and extension ZIP
  exclusions are separate from `.gitignore`.
- [Zod](https://zod.dev/) — MIT. Runtime validation of messages, state and provider input.
- [LinkeDOM](https://github.com/WebReflection/linkedom), 0.18.13 — ISC. Development-only fictional
  DOM fixtures; it is not bundled into the extension.
- Husky — MIT; Secretlint and its recommended rules — MIT; Gitleaks CLI — MIT; actionlint — MIT.
  These are development/security tools, excluded from the extension bundle. Gitleaks and actionlint
  downloads in CI have fixed versions and independently checked SHA-256 values. GitHub Actions are
  pinned to complete commit SHAs and updated through Dependabot.

## Compatible contract adaptations

[PlayniteExtensions](https://github.com/JosefNemec/PlayniteExtensions/tree/886468f65724e6fd104f3a09847a17ba57cfb430)
— MIT, Copyright (c) 2020 Josef Nemec. The full license is retained in
[licenses/playnite-extensions-MIT.txt](licenses/playnite-extensions-MIT.txt) and bundled under
`public/licenses`. Original TypeScript adapts its Epic identity/pagination models, Amazon device-auth
PKCE and entitlement contract, and public Battle.net product constants. Cookie deletion, logout,
XSRF harvesting, native credential files, machine fingerprints and weak random identifiers are excluded.

[SteamCMD API](https://github.com/steamcmd/api/tree/f0d2639a34a0d63f657143e63734fc4bf5f33539)
— MIT, Copyright (c) 2020 Jona Koudijs. Its license was reviewed before adapting the public fixed
`/v1/info/:id` response contract. No implementation code is copied. Optional requests omit credentials
and only enrich original IDs already owned; public metadata cannot create ownership.

## Reference-only projects

- [Augmented Steam](https://github.com/IsThereAnyDeal/AugmentedSteam) — GPL-3.0-or-later.
- [Heroic GOGDL](https://github.com/Heroic-Games-Launcher/heroic-gogdl) — GPL-3.0.
- [Nile](https://github.com/imLinguin/nile) — GPL-3.0.
- [Uni Game Launcher](https://github.com/zagumaar/uni-game-launcher) — GPL-3.0.
- [lsfg-vk](https://github.com/PancakeTAS/lsfg-vk) — GPL-3.0; [Decky integration](https://github.com/xXJSONDeruloXx/decky-lsfg-vk) is a separate community installer.
- [Playnite](https://github.com/JosefNemec/Playnite) — MIT; model concepts only.
- [node-steam-user](https://github.com/DoctorMcKay/node-steam-user/tree/e39d7cb8e0d4c83905f2d3896fb354b13f2591ec)
  (steam-user 5.3.0) — MIT; anonymous PICS in the local Node runner only, excluded from the browser bundle. Temporary websocket13 4.1.0
  was MIT and is not a project dependency. `missingToken` and `unknownApps` are different outcomes.
- [Austrum-lab catalogue](https://github.com/Austrum-lab/steam-appdb/tree/0823ff5fe804dd8a0efe4e112d87f37917434cf6)
  — no project license found; neither code nor dataset is redistributed.
- [SteamTokenDumper schema](https://github.com/SteamDatabase/SteamTokenDumper/blob/master/PayloadDump.cs)
  — schema reference only. No dump or access key is shipped or uploaded.
- [tsx](https://github.com/privatenumber/tsx/blob/master/LICENSE) — MIT; local TypeScript runner.
  Its license and steam-user's [MIT license](https://github.com/DoctorMcKay/node-steam-user/blob/master/LICENSE)
  were inspected before dependency use. Both are compatible with this MIT project.

## Firefox boundaries

[Mozilla MV3 guidance](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
requires Firefox background scripts/event pages rather than assuming Chromium service workers.
[MessageSender](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender)
provides the caller boundary. Privileged commands require this extension's own page; source pages are
untrusted callers. [storage.session](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session)
keeps pending PKCE state in memory; tokens use a separate extension-local key.
[Data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
is declared explicitly and checked before optional authentication/third-party data paths.
[Alarms](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms)
must be restored from durable configuration after startup.

## Store contract findings

- GOG pagination includes page/totalPages/totalProducts, product type and account availability.
  Conflicts or incomplete coverage reject the entire capture.
- Valve [StoreBrowse GetItems](https://api.steampowered.com/IStoreBrowseService/GetItems/v1/)
  supplies public app metadata. StoreBrowse types are ordinal, distinct from Steamworks EAppType
  flags; see the [tracked protocol](https://github.com/SteamTracking/Protobufs/blob/master/steam/steammessages_storebrowse.steamclient.proto).
  Redirected results are checked against the original app ID. PICS names for non-games remain
  separate product titles; unavailable metadata stays unknown.
- Epic uses namespace/catalogItemId as durable identity and a fixed cookie-only Library query.
  Repeated assets deduplicate only when selected metadata matches. No OAuth token extraction is used.
- Amazon's distribution response can omit product.type and a terminal nextToken. Original collectors
  accept only LIVE Sonic:Game products; conflicting licenses, cursors or titles reject capture.
  [Amazon state guidance](https://developer.amazon.com/docs/login-with-amazon/authorization-code-grant.html)
  informs cryptographic nonce, exact callback checks and expiry. Existing browser credentials are never read.
- Battle.net classic-games responses contain CD keys and are never fetched. Narrow title/icon DOM
  reads avoid aggregate cell text and account-name siblings. Missing classic cards do not establish
  zero ownership. [Lord of Destruction](https://classic.battle.net/diablo2exp/faq/expansion.shtml)
  and [Frozen Throne](https://worldofwarcraft.blizzard.com/en-gb/story/timeline/chapter-5)
  are explicit components, distinct from remasters or inferred paid editions.
- Public SteamDB package observations retain community source/date and unknown parent.
  [Valve packages](https://partner.steamgames.com/doc/store/application/packages) are license containers;
  co-membership is not the [DLC relationship](https://partner.steamgames.com/doc/store/application/dlc).

## Performance and future catalog boundaries

[Valve Deck compatibility](https://partner.steamgames.com/doc/steamhardware/compat),
[Gamescope](https://github.com/ValveSoftware/gamescope), [Rosetta](https://developer.apple.com/documentation/Apple-Silicon/about-the-rosetta-translation-environment),
[Game Porting Toolkit](https://developer.apple.com/games/), [CrossOver](https://support.codeweavers.com/en_US/crossover-mac-user-guide),
[FEX](https://fex-emu.com/), [MetalFX](https://developer.apple.com/documentation/MetalFX) and
[FSR](https://gpuopen.com/fidelityfx-super-resolution-3/) describe distinct execution/graphics layers.
Generated FPS, native architecture, installer channel and VRR are independent claims.

[IGDB](https://api-docs.igdb.com/#external-game) and [RAWG](https://rawg.io/apidocs) are optional local-runner metadata sources. IGDB uses Twitch confidential-client credentials; RAWG
requires a user key and available store-link endpoints. The browser ships no catalog credentials.
The runner checks exact external IDs/URLs; title searches are proposals only.
Catalog mappings cannot replace authenticated ownership; ambiguous editions require review.

[Native Messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
uses stdio frames and a per-user host manifest restricted by `allowed_extensions`.
[`optional_permissions`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_permissions)
allows requesting `nativeMessaging` at the user's connection gesture. Host responses remain below 1 MiB
through bounded chunks. Source-side API contracts and dates are retained independently from ownership.
