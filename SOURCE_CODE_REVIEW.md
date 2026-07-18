# Firefox source review

The extension contains no remote executable code. All JavaScript is bundled from the checked-in
TypeScript sources.

## Reproduce

Use Node.js 22 and pnpm 11.9.0:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm zip:firefox
```

The unpacked extension is written to `.output/firefox-mv3`. The package and source archives are
written to `.output`. No `.env` file or API key is required to build or test the extension.
