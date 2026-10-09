# Gaming Library Helper agent guide

## Mission

Build a local-first Firefox WebExtension that helps one person browse Steam and GOG without
buying duplicates. The extension imports owned-game snapshots, matches titles conservatively,
highlights cross-store ownership, can hide cross-owned or ignored games, and keeps library data local.

Read `docs/architecture.md` before changing boundaries or storage. Use the repo skill
`firefox-extension-development` for manifest, content-script, store-adapter, permission,
privacy, and release work.

## Commands

- Install: `pnpm install`
- Develop in Firefox: `pnpm dev:firefox`
- Verify everything: `pnpm verify`
- Unit tests: `pnpm test`
- Build Firefox MV3: `pnpm build:firefox`
- Package: `pnpm zip:firefox`

## Architecture rules

- Keep domain logic in `src/core`; it must not depend on DOM or WebExtension globals.
- Keep Steam and GOG parsing in separate adapters under `src/adapters`.
- Treat store HTML and undocumented endpoints as unstable. Parse unknown input defensively and
  fail with a user-visible, actionable message.
- Import each store as an atomic snapshot. Never erase the last good snapshot after a partial or
  failed sync.
- Auto-merge only exact normalized titles or explicit aliases. Fuzzy matches are suggestions and
  require confirmation; false ownership is worse than a missed match.
- Store provider IDs alongside canonical IDs. Never use a display title as the sole durable ID.
- Version every persisted schema and add migration tests before changing it.
- Keep performance assessments evidence-based and device-specific. Distinguish native FPS,
  frame pacing, VRR, upscaling, and frame generation.

## Privacy and security rules

- Never read, copy, log, export, or persist Steam/GOG cookies, passwords, session tokens, or page
  storage. Fetch library data only from an already authenticated store tab or an explicit API key.
- Keep library data local by default. No analytics or telemetry.
- Request the narrowest host/API/data-collection permissions, at the moment the user enables the
  related feature. Document every permission in `PRIVACY.md`.
- Never ship remote executable code, `eval`, dynamic script injection, or secrets in `.env` files.
- Render untrusted store/API text with `textContent`; do not assign it to `innerHTML`.
- Validate runtime messages and network responses. Content scripts are untrusted callers.
- Respect store rate limits and bound retries during library sync.
- Do not copy code from a third-party repository until its license is recorded in
  `docs/research.md` and compatibility with this MIT project is confirmed. GPL projects are
  reference-only unless the repository license is intentionally changed.

## Change discipline

- Prefer a narrow vertical slice with tests over broad scaffolding without behavior.
- Update docs when permissions, data flows, matching rules, or store contracts change.
- Add fixtures for selector/parser changes. Never make live store pages the only test oracle.
- Run `pnpm verify` before declaring a change complete.
- Review the generated `.output/firefox-mv3/manifest.json` after manifest or entrypoint changes.
- Do not commit generated `.output`, `.wxt`, coverage, credentials, or personal library exports.

## Done means

- Requested behavior is implemented and covered at the core/adapter level.
- Lint, typecheck, tests, and Firefox MV3 build pass.
- Failure states preserve existing data and tell the user what to do next.
- Permission, privacy, and license impact has been reviewed.
