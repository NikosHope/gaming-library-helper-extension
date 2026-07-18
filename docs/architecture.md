# Architecture

## Shape

```text
Steam/GOG page
  -> store content adapter (untrusted DOM / authenticated same-origin request)
  -> validated runtime message
  -> background event page
  -> atomic library merge + browser.storage.local
  -> read-only page projection
  -> badge / hide decision / optional cached price
```

The extension is split into four boundaries:

1. `src/core`: pure schemas, normalization, merge, visibility, pricing, and performance types.
2. `src/adapters`: defensive translators for Steam, GOG, and external price providers.
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

## Prices

Price lookup is a provider interface. IsThereAnyDeal is the first planned adapter because it can
resolve by title or Steam app ID and return shop-specific offers. It is opt-in because it requires an
API key, network transmission, Firefox consent, caching, and provider-term review. A quote is always
labelled with provider, shop, currency, and timestamp.

## Performance model

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
