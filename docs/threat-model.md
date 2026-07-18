# Threat model

## Protected assets

- Steam/GOG authenticated sessions, optional API keys, personal ownership/ignore data, performance
  notes, and the correctness of purchase guidance.

## Trust boundaries

- Store DOM and responses are untrusted and unstable.
- Content scripts are more exposed than extension pages and receive only a redacted state view.
- Background runtime messages are validated; state-changing operations also validate sender origin
  or require an extension page.
- ITAD and future providers are external processors reached only after explicit opt-in.

## Primary abuse cases

1. A compromised store page forges a message to replace the other store's library.
   Mitigation: sender hostname must match the snapshot store.
2. A selector or endpoint change returns an empty/partial library and erases ownership.
   Mitigation: adapters reject suspicious empty/partial snapshots; merge occurs after validation in
   one storage write.
3. Untrusted game titles inject markup or script.
   Mitigation: render with `textContent`; no remote code or `innerHTML`.
4. Approximate title matching marks the wrong edition as owned.
   Mitigation: exact normalized match only; explicit aliases/manual reconciliation for ambiguity.
5. A provider key or personal library leaks through logs, repository files, telemetry, or exports.
   Mitigation: no telemetry, no secret logging, ignored `.env`, extension-local key storage, redacted
   content-script view, and no committed personal exports.
6. Price lookups reveal browsing/library data without consent or become a tracking stream.
   Mitigation: disabled by default, optional Firefox data permission, product-detail lookups only,
   12-hour cache, and no author-controlled backend.
7. A compatibility database calls a game “supported” while hiding CPU/API translation, unstable
   pacing, or generated frames.
   Mitigation: launch paths and performance evidence are device-specific; native/community ports,
   compatibility layers, render/output FPS, upscaling, frame generation, and VRR remain separate.

## Non-goals for the first release

- Protecting data after compromise of the Firefox profile or operating system.
- Guaranteeing undocumented store endpoints remain available.
- Automatically proving game performance from hardware names alone.
