# Roadmap

## Phase 1 — local ownership overlay

- Import Steam and GOG snapshots from signed-in tabs.
- Resolve titles, merge exact matches, show counts and sync health.
- Highlight or hide cross-owned and ignored store cards.
- Export/import a redacted library backup.

## Phase 2 — library sync and reconciliation

- Manual alias/reconciliation queue for editions and ambiguous titles.
- Epic, Amazon Games and Battle.net collectors are implemented and fixture-tested. Broader Battle.net localization and empty-classic account support remain open.
- Firefox schedule controls, per-store last-success and attempt status.
- Request store access only when the related collector is enabled.

## Phase 3 — performance knowledge

- Edit performance assessments per game/device.
- Import Deck Verified and community evidence as labelled signals, not truth.
- Discover official native builds and community/open-source ports, including Homebrew/source paths.
- Track SteamOS native/Proton, macOS native/Rosetta/CrossOver/GPTK, ARM Linux FEX, and optional
  Windows paths as separate launch stacks.
- Keep CPU translation, OS compatibility, graphics translation, upscaling, and frame generation as
  independent layers.
- Track Windows Lossless Scaling and community SteamOS/Linux `lsfg-vk` as distinct integrations;
  optionally record the unofficial Decky installer separately from the Vulkan runtime.
- Answer target profiles such as 1080p / 40 FPS / VRR with confidence and evidence age.

## Phase 4 — release hardening

- Fixture-based DOM regression suite and Firefox integration tests.
- Accessibility and localization.
- Deterministic AMO source archive, privacy review, signing, and release automation.
