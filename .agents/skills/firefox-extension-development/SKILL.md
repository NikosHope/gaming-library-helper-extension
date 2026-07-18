---
name: firefox-extension-development
description: Build, change, debug, review, or release the Gaming Library Helper Firefox WebExtension. Use for WXT entrypoints, Manifest V3, content scripts, background event pages, Steam or GOG adapters, browser storage, runtime messaging, permissions, privacy declarations, DOM highlighting, price providers, AMO packaging, and extension security work in this repository.
---

# Firefox Extension Development

Use the current repository contracts to make Firefox-first changes that remain testable outside
the browser and safe around authenticated store sessions.

## Workflow

1. Read `AGENTS.md` and `docs/architecture.md`.
2. Identify the affected boundary: core, store adapter, browser orchestration, or UI.
3. For manifest/API/AMO behavior that may have changed, verify current Mozilla and WXT docs before
   editing. Record consequential decisions in `docs/research.md` or an ADR.
4. Implement pure domain behavior in `src/core` first and add unit tests.
5. Keep store-specific DOM and endpoint assumptions in `src/adapters`; add captured minimal
   fixtures for parser changes.
6. Wire the behavior through typed runtime messages. Validate all unknown payloads.
7. Run `pnpm verify` and inspect `.output/firefox-mv3/manifest.json` when entrypoints or permissions
   changed.

## Hard constraints

- Target Firefox Manifest V3 explicitly. Firefox uses an event page/background script rather than
  a service worker; do not assume service-worker globals or lifetime.
- Persist durable state before returning success from a sync. Treat the background context as
  disposable.
- Never access cookies or persist session credentials. Library sync runs inside an already signed-in
  Steam/GOG tab; optional API keys stay in extension-local storage and are never logged.
- Use minimal permissions. Any new host, API, or data-collection permission requires an explanation
  in `PRIVACY.md` and a generated-manifest review.
- Auto-match only exact normalized titles or explicit aliases. Put fuzzy candidates into a manual
  reconciliation flow.
- Use DOM `textContent`, not `innerHTML`, for provider-controlled values.
- Preserve the last successful snapshot when parsing or networking fails.
- Treat GPL repositories as reference-only under the current MIT license.

## Review checklist

- Does the core logic remain browser-independent?
- Can a compromised page forge a runtime message that changes unrelated state?
- Can a selector change silently empty a library?
- Is every network transmission opt-in, documented, cached, and bounded?
- Are ownership and performance claims traceable to a store ID or evidence record?
- Do tests cover failure, migration, duplicate-title, and false-match cases?

## Reference

Read `references/firefox-contract.md` for the current platform contract, source boundaries, and
selector/provider policy before editing manifest, adapters, or sync behavior.
