# Privacy

Gaming Library Helper is local-first and contains no analytics or telemetry.

## Stored locally

- Steam and GOG product identifiers and titles imported by the user.
- Explicit aliases, ignored state, display preferences, cached prices, and device-specific
  performance assessments.
- Optional provider configuration. API keys are stored only in Firefox extension-local storage.

## Never collected

- Steam or GOG passwords, cookies, session tokens, browser history, personal communications, or
  payment details.

## Required access

- `storage`: persist the library and settings.
- Steam/GOG host access: run the importer and annotate those stores. Requests use the user's
  already authenticated store tab; the extension does not read cookies.

## Optional transmission

Price lookup or an explicit Steam Web API import may send game titles/IDs and a user-provided API
key to that provider. These features are disabled by default and require a user gesture, optional
host permission, and Firefox data-collection consent for `websiteContent` and
`authenticationInfo`. No data is sent to the extension author.

Provider terms and retention policies apply to provider requests. Cached responses can be removed
by clearing extension data or uninstalling the extension.
