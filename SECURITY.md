# Security policy

The development version on `main` is the only supported version until a signed release is published.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/NikosHope/gaming-library-helper-extension/security/advisories/new).
Include affected version, reproducible steps with fictional data, impact and a suggested fix if available.
Do not post exploit details or credentials in a public issue. The maintainer will investigate and
coordinate a fix and disclosure; no response-time guarantee is offered for this personal project.

Priority classes include credential exposure, cross-context message abuse, untrusted DOM injection,
excessive host permissions, silent library deletion and incorrect ownership claims.
Never share passwords, cookies, tokens, API keys, authorization URLs, account IDs, CD keys or a personal
library export. Secret scanners mask values but are not proof that every kind of sensitive data is absent.

Dependencies, full Git history and JavaScript/TypeScript are scanned in CI and weekly.
Any accepted dependency exception must be specific, documented, development-only and time-limited;
see `config/security-exceptions.json` and [development controls](docs/development.md).
