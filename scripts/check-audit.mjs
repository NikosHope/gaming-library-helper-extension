import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { evaluateAudit } from './lib/audit.mjs';

let output;
try {
  output = execFileSync('pnpm', ['audit', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
} catch (error) {
  if (!error.stdout)
    throw new Error('Dependency audit could not reach the registry; check connectivity', {
      cause: error,
    });
  output = error.stdout.toString();
}
const audit = JSON.parse(output);
const { exceptions } = JSON.parse(readFileSync('config/security-exceptions.json', 'utf8'));
const { failures, accepted } = evaluateAudit(audit, exceptions);
console.log(JSON.stringify(audit.metadata.vulnerabilities));
for (const message of accepted) console.warn(message);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Dependency audit passed with the disclosed exceptions above.');
