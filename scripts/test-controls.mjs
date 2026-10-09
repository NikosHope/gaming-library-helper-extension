import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectManifest } from './lib/manifest.mjs';
import { forbiddenPath, inspectPublicFile } from './lib/publication.mjs';
import { evaluateAudit } from './lib/audit.mjs';

test('publication guard rejects private, ignored and generated paths', () => {
  for (const path of [
    'artifacts/local/library.json',
    '.env',
    '.env.production',
    '.aws/config',
    '.output/manifest.json',
    'exports/games.csv',
    'public/acceptance-debug.js',
    'private.key',
  ])
    assert.equal(forbiddenPath(path), true, path);
  for (const path of [
    'src/core/library.ts',
    '.env.example',
    'tests/fixtures/amazon-app-library.json',
    '.github/workflows/ci.yml',
  ])
    assert.equal(forbiddenPath(path), false, path);
  assert.equal(
    inspectPublicFile('README.md', Buffer.from('/' + 'Users/example/project/')).length,
    1,
  );
  assert.equal(inspectPublicFile('huge.bin', Buffer.alloc(5 * 1024 * 1024 + 1)).length, 1);
});

test('manifest guard blocks permission escalation and weakened CSP', () => {
  const policy = JSON.parse(readFileSync('config/extension-policy.json', 'utf8'));
  const baseline = {
    manifest_version: 3,
    background: { scripts: ['background.js'] },
    permissions: policy.permissions,
    host_permissions: policy.host_permissions,
    optional_host_permissions: policy.optional_host_permissions,
    browser_specific_settings: {
      gecko: {
        id: policy.gecko_id,
        strict_min_version: policy.strict_min_version,
        data_collection_permissions: { required: ['none'], optional: policy.optional_data },
      },
    },
  };
  assert.deepEqual(inspectManifest(baseline), []);
  for (const patch of [
    { permissions: ['storage', 'alarms', 'cookies'] },
    { host_permissions: ['<all_urls>'] },
    { background: { service_worker: 'worker.js' } },
    { content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" } },
    { externally_connectable: { matches: ['*://*/*'] } },
    { content_scripts: [{ matches: ['https://example.com/*'], js: ['content.js'] }] },
  ])
    assert.ok(inspectManifest({ ...baseline, ...patch }).length > 0);
});

test('audit exceptions cannot hide runtime, changed-path or expired vulnerabilities', () => {
  const exception = {
    advisory: 'GHSA-test',
    module: 'test',
    version: '1.0.0',
    expires: '2026-11-09',
    paths: ['.>dev>test'],
    reason: 'Fictional test',
  };
  const finding = { version: '1.0.0', dev: true, paths: ['.>dev>test'] };
  const entry = {
    github_advisory_id: 'GHSA-test',
    module_name: 'test',
    severity: 'high',
    findings: [finding],
  };
  const makeAudit = (patch = {}) => ({
    metadata: { vulnerabilities: { high: 1 } },
    advisories: { test: { ...entry, ...patch } },
  });
  assert.equal(evaluateAudit(makeAudit(), [exception], '2026-10-09').failures.length, 0);
  assert.ok(evaluateAudit(makeAudit(), [exception], '2026-11-09').failures.length);
  assert.ok(
    evaluateAudit(makeAudit({ findings: [{ ...finding, dev: false }] }), [exception], '2026-10-09')
      .failures.length,
  );
  assert.ok(
    evaluateAudit(
      makeAudit({ findings: [{ ...finding, paths: ['.>runtime>test'] }] }),
      [exception],
      '2026-10-09',
    ).failures.length,
  );
  assert.ok(
    evaluateAudit(makeAudit({ github_advisory_id: 'GHSA-other' }), [exception], '2026-10-09')
      .failures.length,
  );
  assert.throws(() => evaluateAudit({ error: 'network failure' }, []));
});
