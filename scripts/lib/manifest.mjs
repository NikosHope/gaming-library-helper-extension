import { readFileSync } from 'node:fs';

const policy = JSON.parse(
  readFileSync(new URL('../../config/extension-policy.json', import.meta.url), 'utf8'),
);
const equalSet = (actual = [], expected = []) =>
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

export function inspectManifest(manifest) {
  const errors = [];
  if (manifest.manifest_version !== 3) errors.push('Firefox Manifest V3 is required');
  if (manifest.background?.service_worker || !manifest.background?.scripts?.length)
    errors.push('Firefox event-page background scripts are required');
  if (!equalSet(manifest.permissions, policy.permissions))
    errors.push('Required API permissions changed; update policy and PRIVACY.md after review');
  if (!equalSet(manifest.host_permissions, policy.host_permissions))
    errors.push('Required hosts changed; update policy and PRIVACY.md after review');
  if (!equalSet(manifest.optional_host_permissions, policy.optional_host_permissions))
    errors.push('Optional hosts changed; update policy and PRIVACY.md after review');
  if ((manifest.optional_permissions ?? []).length)
    errors.push('Optional API permissions require policy review');
  const gecko = manifest.browser_specific_settings?.gecko;
  if (gecko?.id !== policy.gecko_id || gecko?.strict_min_version !== policy.strict_min_version)
    errors.push('Firefox identity or minimum version changed');
  if (
    !equalSet(gecko?.data_collection_permissions?.required, ['none']) ||
    !equalSet(gecko?.data_collection_permissions?.optional, policy.optional_data)
  )
    errors.push('Data consent changed; update policy and PRIVACY.md after review');
  const csp =
    manifest.content_security_policy?.extension_pages ?? "script-src 'self'; object-src 'self'";
  if (!/script-src 'self'(?:;|$)/.test(csp) || /unsafe-eval|unsafe-inline|https?:|\*/.test(csp))
    errors.push('Extension CSP must allow only local scripts');
  if (manifest.externally_connectable || (manifest.web_accessible_resources ?? []).length)
    errors.push('Externally accessible extension surfaces require explicit review');
  for (const content of manifest.content_scripts ?? []) {
    if (content.world === 'MAIN') errors.push('Main-world content scripts require explicit review');
    if (content.js?.some((file) => /^(?:https?:|\/\/)/.test(file)))
      errors.push('Content scripts must be packaged locally');
    if (content.matches?.some((host) => !policy.content_matches.includes(host)))
      errors.push('Content script scope exceeds reviewed hosts');
  }
  return errors;
}
