import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';

const execute = promisify(execFile);
const fields = ['igdb-client-id', 'igdb-client-secret', 'rawg-key'];
const service = 'Gaming Library Helper reconciliation';
export async function readCredential(field) {
  if (!fields.includes(field) || process.platform !== 'darwin')
    throw new Error('This credential requires macOS Keychain');
  try {
    const { stdout } = await execute(
      '/usr/bin/security',
      ['find-generic-password', '-s', service, '-a', field, '-w'],
      { timeout: 15_000 },
    );
    return stdout.trim();
  } catch {
    return undefined;
  }
}
export async function credentialStatus() {
  const status = {};
  for (const field of fields) status[field] = Boolean(await readCredential(field));
  return status;
}
// Run this interactively in the user's terminal. Values never enter argv, chat, files or logs.
export async function setupCredentials() {
  if (process.platform !== 'darwin' || !process.stdin.isTTY)
    throw new Error('Run pnpm reconcile keys setup in your own Mac terminal');
  for (const field of fields) {
    process.stdout.write(`${field} (blank keeps existing value): `);
    const value = await hiddenLine();
    process.stdout.write('\n');
    if (!value) continue;
    const quoted = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    if (/[\r\n\0]/u.test(value)) throw new Error('Invalid credential');
    await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] });
      child.once('error', () => reject(new Error('Keychain write failed')));
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Keychain write failed')),
      );
      child.stdin.end(`add-generic-password -U -s "${service}" -a "${field}" -w "${quoted}"\n`);
    });
    if ((await readCredential(field)) !== value)
      throw new Error('Keychain write could not be verified');
  }
  return credentialStatus();
}
function hiddenLine() {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => {
      process.stdin.off('data', listener);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const listener = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          finish();
          reject(new Error('Canceled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (char === '\u007f') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 4096) value += char;
      }
    };
    process.stdin.on('data', listener);
  });
}
