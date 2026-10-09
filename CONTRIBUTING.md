# Contributing

Open a focused issue or pull request. Keep changes small enough to review and include a fictional
fixture when a store parser changes. Follow [AGENTS.md](AGENTS.md) and [architecture](docs/architecture.md).

## Before opening a PR

1. Use Node.js 24 and pnpm 11.19.0; run `pnpm install --frozen-lockfile`.
2. Create a branch (maintainer branches use `codex/`; external contributors can use a fork).
3. Implement behavior at the core/adapter boundary, with tests of failures and ambiguity.
4. Run `pnpm verify`, `pnpm check:audit`, then `pnpm zip:firefox && pnpm check:package`.
5. Explain the problem, changed behavior, verification and remaining risk in the PR template.

Do not auto-merge fuzzy title matches, erase good snapshots after incomplete reads, or expand
permissions without updating `PRIVACY.md` and `config/extension-policy.json`. Persisted schema changes
need migration tests. Keep domain logic independent of DOM and browser globals.

Never attach a real library export, credentials, authorization callback, cookies, CD keys, personal
paths or account identifiers. Fixtures must be fictional or public metadata with recorded provenance.
Use `textContent` for untrusted text. No telemetry, remote executable code, secrets, or unlicensed code.
GPL implementations are reference-only for this MIT project.

## Review and merge

All changes to `main` go through a PR with current required checks, resolved conversations and the
maintainer's code-owner review for external contributions. A sole maintainer can merge their own PR
after checks pass. Squash merge keeps the main history linear; GitHub deletes merged branches.
Never treat a local hook as enforcement: CI runs independently, including on forks with a read-only token.

Git hooks install automatically. Pre-commit scans the staged blobs rather than unstaged edits;
pre-push runs full verification. CI independently enforces coverage, secrets, manifest and packaging.
For hook/setup details and bounded audit exceptions, see [docs/development.md](docs/development.md).
