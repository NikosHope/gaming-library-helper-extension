import { execFileSync } from 'node:child_process';
import { allowedSymlink, fileContents, gitFiles, inspectPublicFile } from './lib/publication.mjs';

const staged = process.argv.includes('--staged');
const failures = [];
for (const file of gitFiles(staged)) {
  for (const reason of inspectPublicFile(file, fileContents(file, staged)))
    failures.push(`${file}: ${reason}`);
}
for (const record of execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split(
  '\0',
)) {
  if (record.startsWith('120000 ')) {
    const file = record.split('\t')[1];
    if (!allowedSymlink(file, fileContents(file, staged).toString()))
      failures.push(`${file}: symlinks require explicit review`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Public file policy passed (${staged ? 'Git index' : 'working tree'}).`);
