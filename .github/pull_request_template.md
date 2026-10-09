## Goal

<!-- What user-visible or architectural outcome does this change produce? -->

## Verification

- [ ] `pnpm verify`
- [ ] `pnpm check:audit` (any exception disclosed)
- [ ] `pnpm zip:firefox && pnpm check:package`
- [ ] Generated Firefox manifest reviewed if entrypoints or permissions changed
- [ ] Failure path preserves the last successful library snapshot
- [ ] Privacy/data-flow impact documented
- [ ] Third-party license impact reviewed

## Risk

<!-- Store selectors/endpoints, schema migrations, permissions, matching false positives, or none. -->
