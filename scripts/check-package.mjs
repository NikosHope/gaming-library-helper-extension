import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { forbiddenPath, gitFiles } from './lib/publication.mjs';

const archives = readdirSync('.output').filter((file) => file.endsWith('.zip'));
if (archives.length !== 2 || !archives.some((file) => file.endsWith('-sources.zip')))
  throw new Error('Expected one extension ZIP and one source ZIP; remove stale archives');
for (const archive of archives) {
  const files = execFileSync('unzip', ['-Z1', `.output/${archive}`], { encoding: 'utf8' })
    .trim()
    .split('\n');
  const bad = files.filter(
    (file) => file.startsWith('/') || file.split('/').includes('..') || forbiddenPath(file),
  );
  if (bad.length) throw new Error(`${archive}: forbidden archive paths: ${bad.join(', ')}`);
  const required = archive.endsWith('-sources.zip')
    ? [
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'SOURCE_CODE_REVIEW.md',
        'src/entrypoints/background.ts',
        '.secretlintrc.json',
        '.prettierrc.json',
        'config/extension-policy.json',
        ...gitFiles().filter((file) => /^(src|tests|scripts|config|public)\//.test(file)),
      ]
    : ['manifest.json', 'licenses/playnite-extensions-MIT.txt'];
  for (const file of required)
    if (!files.includes(file)) throw new Error(`${archive}: missing ${file}`);
  // Validate ZIP CRCs without printing file contents.
  execFileSync('unzip', ['-tqq', `.output/${archive}`], { stdio: 'inherit' });
  console.log(`${archive}: ${files.length} safe paths; CRC validation passed.`);
}
