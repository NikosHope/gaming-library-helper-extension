import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileContents, gitFiles } from './lib/publication.mjs';

const staged = process.argv.includes('--staged');
const directory = mkdtempSync(join(tmpdir(), 'glh-secret-check-'));
try {
  const paths = gitFiles(staged).map((file) => {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, fileContents(file, staged), { mode: 0o600 });
    return target;
  });
  // Scan the exact index blobs in hooks, including paths ignored by .gitignore.
  for (let offset = 0; offset < paths.length; offset += 50) {
    execFileSync(
      process.execPath,
      [
        resolve('node_modules/secretlint/bin/secretlint.js'),
        '--secretlintrc',
        resolve('.secretlintrc.json'),
        '--no-glob',
        '--no-gitignore',
        ...paths.slice(offset, offset + 50),
      ],
      { stdio: 'inherit' },
    );
  }
  console.log('Secretlint passed; secret values remain masked.');
} catch {
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
