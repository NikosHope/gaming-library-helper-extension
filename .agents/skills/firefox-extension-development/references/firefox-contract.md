# Firefox contract

## Platform baseline

- Build with `wxt -b firefox --mv3`; never rely on WXT's default Firefox MV2 target.
- Firefox MV3 uses `background.scripts` event pages and does not support
  `background.service_worker`. Store durable state in `browser.storage.local`.
- New Firefox extensions must declare transmitted data through
  `browser_specific_settings.gecko.data_collection_permissions`.
- Keep required collection at none. The current store-tab import has no external pricing or
  provider-credential collection.
- Do not load remote code. Bundle all executable JavaScript.

## Store boundaries

### Steam

- Import ownership IDs from `https://store.steampowered.com/dynamicstore/userdata` only while the
  user is signed in on Steam.
- Treat `rgOwnedApps`, `rgIgnoredApps`, and related fields as an undocumented, versioned adapter
  input. Validate before commit.
- Resolve titles through public store metadata in bounded batches. Missing metadata must remain an
  unresolved provider record, not disappear.
- Optional Steam Web API support requires a user-provided key and Steam ID; never embed a key.

### GOG

- Import the library from an authenticated `www.gog.com` tab using the paginated account product
  response. Do not read GOG cookies.
- Treat GOG endpoints and product markup as undocumented adapter inputs. Preserve the last good
  snapshot when fields or pagination change.
- Keep `embed.gog.com/user/data/games` as a provider-ID ownership cross-check, not the only title
  source.

## Matching

- Normalize Unicode, case, punctuation, whitespace, and trademark marks.
- Do not remove edition, remake, platform, or year qualifiers automatically.
- Merge exact normalized titles or explicit aliases only.
- Use provider IDs as strongest evidence within a store. Never compare Steam IDs to GOG IDs.
- Surface ambiguous/fuzzy candidates for manual confirmation.

## Performance evidence

- Record launch availability separately from measured performance. Official native and native
  community/open-source ports both classify as native execution, regardless of installer.
- Keep build architecture, CPU translation (Rosetta/FEX), OS compatibility (Proton/Wine/CrossOver),
  and graphics translation (DXVK/D3DMetal/DXMT) as separate launch-path fields.
- Record one assessment per canonical game, launch path, and device profile.
- Store render and output resolution, base FPS, presented FPS, frame pacing, VRR state, upscaling,
  frame generation, settings, evidence URL/date, and confidence.
- Do not infer native support from a store badge, Homebrew formula, or compatibility-layer success;
  verify the executable/API path.
- The primary Lossless Scaling application is Windows-first, but community `lsfg-vk` exposes LSFG
  through a Vulkan layer on Linux/SteamOS. Record these as separate integrations and require
  per-game evidence; Decky installation alone is not proof of compatibility or quality.
- Gamescope FSR, in-game FSR, MetalFX, and frame generation are different integrations. Generated
  FPS never substitutes for base FPS.
- Steam Deck LCD's built-in panel and a docked external display are separate display profiles.
