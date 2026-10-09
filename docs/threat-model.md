# Threat model

## Protected assets

- Store authenticated sessions, personal ownership/ignore data, performance
  notes, and the correctness of purchase guidance.

## Trust boundaries

- Store DOM and responses are untrusted and unstable.
- Content scripts are more exposed than extension pages and receive a read-only library view.
- Background runtime messages are validated; state-changing operations also validate sender origin
  or require an extension page.
- Current network requests are restricted to store import and public metadata endpoints.

## Primary abuse cases

1. A compromised store page forges a message to replace the other store's library.
   Mitigation: the browser-supplied sender URL must match the snapshot store's exact HTTPS origin,
   without credentials, a different port, or a lookalike domain. Payload and tab URLs do not replace
   this check.
2. A selector or endpoint change returns an empty/partial library and erases ownership.
   Mitigation: adapters reject suspicious empty/partial snapshots; merge occurs after validation in
   one storage write.
3. Untrusted game titles inject markup or script.
   Mitigation: render with `textContent`; no remote code or `innerHTML`.
4. Approximate title matching marks the wrong edition as owned.
   Mitigation: exact normalized match only; explicit aliases/manual reconciliation for ambiguity.
5. A personal library leaks through logs, repository files, telemetry, or exports.
   Mitigation: no telemetry, no secret logging, ignored `.env`, no credentials collected, and no
   committed personal exports.
6. Scheduled work runs concurrently or replaces a newer snapshot with a delayed capture.
   Mitigation: shared in-flight captures, started-at timestamps that reject stale commits, and
   durable attempt receipts that retain the last successful sync separately from failures.
7. A compatibility database calls a game “supported” while hiding CPU/API translation, unstable
   pacing, or generated frames.
   Mitigation: launch paths and performance evidence are device-specific; native/community ports,
   compatibility layers, render/output FPS, upscaling, frame generation, and VRR remain separate.
8. A content script abuses public-catalog access as an arbitrary network proxy or substitutes app IDs.
   Mitigation: require the exact HTTPS Steam Store sender, validate at most 100 positive unique IDs,
   construct fixed Valve/optional SteamCMD API endpoints, omit credentials, strip unrelated response fields, and reject
   missing, repeated, or substituted results before committing. A redirected game must be resolved
   against the original owned ID's public record. API-host access is optional.
9. An unsupported saved schema is mistaken for an empty library and overwritten.
   Mitigation: create defaults only when the storage key is absent; reject unsupported existing
   data without saving. Frozen legacy schemas prevent future provider data from being reinterpreted.
10. Store text includes the extension's badge and corrupts a later title match, or badge writes
    trigger the extension's own observer indefinitely.
    Mitigation: exclude only extension-owned badges from parsed text and disconnect the observer
    during decoration. Fictional DOM fixtures exercise both paths.

11. A Battle.net collector reads classic license keys or mistakes an absent classic card for an empty library.
    Mitigation: no classic API request, no aggregate document/row/cell text, no account-name siblings or page framework state. Only exact public title descendants and icon filenames are selected. Both rendered lists must be complete; malformed, absent, loading, empty, inconsistent or oversized lists reject the snapshot. Trial cannot create ownership, and known expansions cannot establish base/remaster ownership.

## Non-goals for the first release

- Protecting data after compromise of the Firefox profile or operating system.
- Guaranteeing undocumented store endpoints remain available.
- Automatically proving game performance from hardware names alone.
