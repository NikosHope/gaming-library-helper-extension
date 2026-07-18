# Research log

Checked on 2026-07-18. Revalidate before relying on unstable endpoints or policy.

## Adopted

- [WXT](https://wxt.dev/) — MIT, TypeScript extension framework. Supports Firefox and explicit MV3
  builds. Its default Firefox target is MV2, so this repo always passes `--mv3`.
- [Mozilla WebExtensions documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
  — authoritative API baseline. Firefox MV3 currently uses background event pages/scripts rather
  than extension service workers.
- [`browser.storage.local`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage)
  — durable extension storage; preferred over page `localStorage`.
- [Zod](https://zod.dev/) — runtime validation for messages, persisted state, and provider payloads.

## Reference-only projects

- [Augmented Steam](https://github.com/IsThereAnyDeal/AugmentedSteam) — GPL-3.0-or-later. It already
  implements Steam ownership/ignore highlighting and IsThereAnyDeal pricing. We reuse concepts and
  documented endpoints, not its code, while this project remains MIT.
- [Heroic GOGDL](https://github.com/Heroic-Games-Launcher/heroic-gogdl) — GPL-3.0. Confirms GOG's
  `embed.gog.com/user/data/games` ownership-ID path and bearer-token client flows. Browser sync here
  avoids copying its code and avoids persisting GOG credentials.
- [Playnite](https://github.com/JosefNemec/Playnite) — MIT. Its separation between canonical game,
  provider game ID, source/plugin, hidden state, notes, and metadata informed the local model. Its C#
  implementation is not imported because it does not fit a WebExtension runtime.

## External services

- [IsThereAnyDeal API](https://docs.isthereanydeal.com/) supports lookup by title/Steam app ID and
  shop-specific prices. It requires an API key, caching, attribution, unchanged URLs/data, and may
  require contacting ITAD for private use. The adapter remains opt-in until the user has approved
  access.
- Direct Steam/GOG account endpoints are not stable public contracts. They stay isolated behind
  adapters, validated, bounded, and covered by fixtures.

## Firefox policy and release constraints

- [Firefox data collection consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
  is mandatory for new extensions since 2025-11-03. The manifest declares no required data
  transmission and optional website/authentication data for explicitly enabled providers.
- AMO source review must be able to reproduce the package. WXT recommends shipping documented build
  commands and verifying the source ZIP without secrets.

## Performance-source constraints

- [Lossless Scaling on Steam](https://store.steampowered.com/app/993090/Lossless_Scaling/) still
  lists Windows for the main application but now explicitly points Linux users to the community
  LSFG port. The Windows UI/runtime and the Linux frame-generation path are separate integrations.
- [`lsfg-vk`](https://github.com/PancakeTAS/lsfg-vk) — GPL-3.0, reference-only. It implements LSFG as
  a Vulkan layer on Linux, requires Lossless Scaling to be owned/downloaded through Steam, and calls
  out Steam Deck installation through an unofficial Decky plugin. This makes LSFG a valid SteamOS
  candidate, not an automatic compatibility claim for every game.
- [`decky-lsfg-vk`](https://github.com/xXJSONDeruloXx/decky-lsfg-vk) — community/unofficial Decky
  integration for SteamOS/Bazzite. It simplifies installation and configuration but does not turn
  the path into first-party Valve or Lossless Scaling support.
- [Valve's Steam Deck compatibility documentation](https://partner.steamgames.com/doc/steamhardware/compat)
  states that Windows builds run through Proton when no native Linux build is used. Native Linux and
  Proton results therefore remain separate launch paths.
- [Valve Gamescope](https://github.com/ValveSoftware/gamescope) supports compositor-level AMD FSR
  upscaling and distinct game/output resolutions. This is independent from in-game FSR and from
  frame generation.
- [FEX-Emu](https://fex-emu.com/) translates x86/x86-64 Linux applications on ARM64 Linux and can be
  combined with Wine/Proton. It is a relevant ARM Linux CPU-translation layer, not a normal Steam
  Deck LCD requirement because that device is already x86_64.
- [Apple Rosetta documentation](https://developer.apple.com/documentation/Apple-Silicon/about-the-rosetta-translation-environment)
  defines Rosetta as x86_64 instruction translation on Apple silicon. An Intel macOS build is
  therefore not labelled as a native-architecture result.
- [Apple Game Porting Toolkit](https://developer.apple.com/games/) helps evaluate and port Windows
  games to Apple silicon; evaluation through translation is not evidence of a native released port.
- [CodeWeavers' CrossOver guide](https://support.codeweavers.com/en_US/crossover-mac-user-guide)
  exposes distinct D3DMetal, DXMT, DXVK, and Wine graphics backends, so CrossOver alone is not a
  complete performance-path description.
- [Apple MetalFX](https://developer.apple.com/documentation/MetalFX) and
  [AMD FSR](https://gpuopen.com/fidelityfx-super-resolution-3/) both separate lower render
  resolution from output resolution. AMD also separates upscaling from optional frame generation;
  generated FPS must not replace measured base FPS.
- [Homebrew](https://brew.sh/) is a distribution mechanism. A Homebrew/open-source port counts as
  native in this project only when its actual binary/API path is native for the selected device.
