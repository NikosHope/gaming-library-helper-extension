# Development controls

Use Node.js 24 LTS and pnpm 11.19.0. CI verifies Node.js 22 and 24 on Ubuntu 24.04 using the frozen lockfile.
`pnpm install` permits only the reviewed esbuild dependency build script; `spawn-sync` is disabled.

| Control                           | Enforcement                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Private/generated file policy     | Pre-commit exact index blobs, `pnpm verify`, CI                                          |
| Secretlint recommended detectors  | Pre-commit exact index blobs and all publishable files in CI; masked output              |
| Full-history secret scan          | Gitleaks CLI in CI and weekly                                                            |
| Formatting, ESLint, strict types  | `pnpm verify`, pre-push and required PR checks                                           |
| Core/adapter/background coverage  | V8; statements/lines/functions 80%, branches 75%                                         |
| Firefox MV3 and add-on rules      | Build plus `web-ext lint --warnings-as-errors`                                           |
| Manifest/host/data-consent policy | Generated manifest checked against `config/extension-policy.json`                        |
| ZIP contents and integrity        | Required extension/reviewer files, forbidden paths, CRC validation and SHA-256           |
| Dependencies                      | Current audit, PR dependency review, weekly Dependabot and scheduled audit               |
| Static security analysis          | CodeQL security-extended on PRs/main and weekly                                          |
| Workflow supply chain             | Full action SHA pins, checksum-pinned CLI downloads, actionlint, read-only defaults      |
| Main branch                       | PR, current required checks, resolved threads, code-owner review, no force push/deletion |

Local hooks are convenience checks and can be skipped by Git. GitHub protection is the enforcement
boundary. Install without Git is allowed; run `pnpm prepare` after creating a checkout to install hooks.
No hook silently reformats or stages files. Pre-push needs the dev dependencies and can take a few minutes.

Workflows use `pull_request`, never `pull_request_target`. Checkout credentials are not retained.
Fork PRs receive no signing/store secrets. Only CodeQL has the scoped security-events write permission.
CI artifacts expire after 14 days and contain unsigned packages and fictional coverage data.

## Dependency remediation

Upstream development tools constrain older transitive dependencies. `pnpm-workspace.yaml` overrides
shell-quote, tmp, adm-zip, uuid and esbuild to published patched versions. Full tests, build and add-on
lint validate compatibility. Remove each override when upstream requirements and the lockfile converge
on safe versions. Do not replace an audit failure with `continue-on-error` or a broad ignored range.

One exact, expiring exception is retained for
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): node-forge 1.4.0 in the
development-only Android ADB dependencies of web-ext and WXT's web-ext-run. The advertised 1.4.1 patch
is not published in npm as of 2026-10-09. This Firefox project does not run Android ADB or ship node-forge.
The audit checks exact advisory, package/version, development-only flags, allowed dependency paths
and expiry (2026-11-09). A runtime dependency, new path, another high/critical advisory or expired
exception fails CI. Remove the exception as soon as the patch is available.

`pnpm check:audit` needs registry access and fails on an incomplete response. Raw `pnpm audit` still
reports the disclosed exception; it is not silently suppressed in pnpm configuration.

## Browser acceptance

Unit tests and static gates do not establish store availability or durable signed installation.
Manual Firefox checks are required for provider, sender, permission, schema or UI changes; document
sanitized results in the PR. Keep private exports and diagnostic reports under ignored `artifacts/local/`.
Source ZIPs independently exclude these files, even though WXT may include ignored non-hidden files.
