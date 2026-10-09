# Firefox source review

All extension JavaScript is built from the checked-in TypeScript sources. No remote executable code
or API key is needed to build. Compatible third-party notices are bundled under `licenses/`.

## Reproduce

Use Node.js 24 LTS and pnpm 11.19.0:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm verify
pnpm zip:firefox
pnpm check:package
```

The source ZIP preserves package manifests, the lockfile, build configuration, scripts, public assets,
fictional fixtures and permission policy. The unpacked extension is `.output/firefox-mv3`; extension
and source ZIPs are written to `.output`. Delete stale ZIPs before checking a different version.

When verifying an extracted source ZIP, run `git init && git add .` first: publication checks use
Git's file inventory. Husky installs hooks only in a Git checkout. The build itself does not need Git.
Personal exports and local diagnostics are excluded independently from both Git and WXT source ZIPs.
CI inspects archive paths and validates CRCs. See [release procedure](docs/releasing.md).
