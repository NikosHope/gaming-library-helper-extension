import { readFileSync } from 'node:fs';
import { inspectManifest } from './lib/manifest.mjs';

const manifest = JSON.parse(readFileSync('.output/firefox-mv3/manifest.json', 'utf8'));
const errors = inspectManifest(manifest);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Firefox MV3 permission and CSP policy passed.');
