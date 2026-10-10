# Gaming Library Helper

[![CI](https://github.com/NikosHope/gaming-library-helper-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/NikosHope/gaming-library-helper-extension/actions/workflows/ci.yml)
[![Security](https://github.com/NikosHope/gaming-library-helper-extension/actions/workflows/security.yml/badge.svg)](https://github.com/NikosHope/gaming-library-helper-extension/actions/workflows/security.yml)
[![CodeQL](https://github.com/NikosHope/gaming-library-helper-extension/actions/workflows/codeql.yml/badge.svg)](https://github.com/NikosHope/gaming-library-helper-extension/actions/workflows/codeql.yml)

A local-first Firefox extension that helps you avoid buying games you already own. It imports
owned-game snapshots from Steam, GOG, Epic, Amazon Games and Battle.net, and highlights or hides
cross-owned and ignored games while you browse Steam and GOG.

**Development preview.** There is no published, Mozilla-signed release yet. Store endpoints and
markup can change. See [provider support and limitations](docs/library-sync.md).

## Release builds

[GitHub releases](https://github.com/NikosHope/gaming-library-helper-extension/releases) provide
checked Firefox MV3 and reviewer-source ZIPs, checksums and the exact source commit. Version 0.2.0
is an **unsigned prerelease**: use `about:debugging` for temporary developer installation. Normal
Firefox installation requires Mozilla signing. See [release acceptance](docs/releases/v0.2.0.md).

## Features

- Conservative catalog matching: verified IGDB/RAWG IDs; title candidates require human review.
- Atomic imports: an incomplete or failed sync keeps your last successful snapshot.
- Local storage, no analytics, no telemetry, and optional provider access requested when enabled.
- Disabled-by-default automatic sync while Firefox is running, with per-provider receipts.
- Separate games, DLC, tools and unknown products. Catalog metadata never creates ownership.
- Optional local Native Messaging runner for PICS/catalog enrichment and agent-assisted reconciliation.
- Device-specific performance records that distinguish native builds, translation, base FPS,
  generated FPS, frame pacing, upscaling and VRR.

Steam/GOG/Epic/Battle.net use an existing signed-in store tab without reading cookie values.
Amazon Games uses an explicit OAuth connection; its credentials stay in a separate extension-local
key and are excluded from library views and exports. See [PRIVACY.md](PRIVACY.md).

## Develop

Use Node.js 24 LTS (Node.js 22.22+ also supported) and the exact pnpm version in `package.json`.

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm dev:firefox
```

WXT opens a separate Firefox development profile with a temporary extension. Temporary installation
does not establish persistence after Firefox restarts.

```bash
pnpm verify         # policy, secrets, formatting, lint, types, tests, coverage, build, add-on lint
pnpm check:audit    # current dependency vulnerabilities and bounded exceptions
pnpm zip:firefox
pnpm check:package  # archive paths, required sources and CRCs
```

Git hooks are installed by `pnpm install`: pre-commit checks the exact staged files for private data
and secrets; pre-push runs `pnpm verify`. GitHub independently requires CI checks before merging.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [development controls](docs/development.md),
[architecture](docs/architecture.md) and [release procedure](docs/releasing.md).
See [local reconciliation workflow](docs/reconciliation.md) for Cursor/ChatGPT, Keychain setup,
versioned exchange and the prepared scheduling prompt.

## Security and licensing

Report vulnerabilities through [private vulnerability reporting](https://github.com/NikosHope/gaming-library-helper-extension/security/advisories/new).
Never post credentials, account identifiers or personal library exports in public issues.

The project is [MIT licensed](LICENSE). Compatible third-party contract adaptations and retained
notices are documented in [docs/research.md](docs/research.md). GPL projects are reference-only.
