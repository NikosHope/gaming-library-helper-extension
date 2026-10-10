# Firefox release procedure

CI produces an **unsigned** extension ZIP, reviewer source ZIP and SHA-256 checksums. These are
build evidence and cannot be installed as a signed public release on normal Firefox. Publishing the
repository does not publish the add-on to AMO.

1. Prepare a focused release PR: update version and CHANGELOG, confirm provider limitations,
   review migrations, permissions/data consent, license notices and the threat model.
2. Pass all required PR checks and resolve review threads. Keep the branch current with `main`.
3. Test the actual Firefox extension manually: connect supported providers, verify exact IDs,
   interrupt pagination/auth, revoke permissions, restart the signed test build, check alarms and
   confirm failures preserve the last good snapshot. Check keyboard use and visible error messages.
4. Merge, then build the exact main commit with the locked Node/pnpm versions. Run `pnpm verify`,
   `pnpm check:audit`, `pnpm zip:firefox` and `pnpm check:package`.
5. Inspect both ZIP file lists. Reproduce from the source ZIP in a clean directory before submission.
6. Create a version tag matching `package.json`; publish release notes referencing the commit and
   checksums. Tags matching `v*` cannot be force-updated or deleted under the repository ruleset.
7. Submit extension ZIP and source ZIP to Mozilla, using a developer account and signing credentials
   supplied privately at release time. Never add them to source, issue text or build artifacts.
8. Verify the resulting signed XPI, install it in normal Firefox, repeat restart/permission/snapshot
   checks and only then mark the release available. Keep the source ZIP and checksum with that release.

Mozilla requires signing for normal Firefox distribution and readable, reproducible sources for
bundled builds: [signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/),
[source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/),
[add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/).

Pushing a protected `v*` tag runs the release workflow. It checks that the tag is on `main` and
matches the package/manifest version, runs all local gates and the full audit, reproduces the source
ZIP, and publishes a GitHub **prerelease** with both ZIPs, checksums and build metadata. No signing
credentials are available to this workflow. Publishing the prerelease does not satisfy steps 3, 7
or 8. See [0.2.0 acceptance and limitations](releases/v0.2.0.md).

Mozilla signing and AMO publication still require private developer credentials. Use `web-ext sign`
with credentials supplied through the documented environment variables, never command-line arguments
or checked-in files. Verify the signed artifact before promoting a prerelease.
