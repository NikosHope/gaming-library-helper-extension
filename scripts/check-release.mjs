import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const tag = process.env.RELEASE_TAG;
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^v\d+\.\d+\.\d+$/u.test(tag ?? '') || tag !== `v${version}`)
  throw new Error('Release tag must match package.json exactly');
const { version: manifestVersion } = JSON.parse(
  readFileSync('.output/firefox-mv3/manifest.json', 'utf8'),
);
if (manifestVersion !== version) throw new Error('Release manifest version mismatch');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== process.env.GITHUB_SHA) throw new Error('Unexpected release checkout');
execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
const taggedCommit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], {
  encoding: 'utf8',
}).trim();
if (taggedCommit !== commit) throw new Error('Release tag points to a different commit');
// Only reviewed, versioned release notes may be published.
readFileSync(`docs/releases/${tag}.md`, 'utf8');
writeFileSync(
  '.output/BUILD_INFO.json',
  JSON.stringify(
    {
      version,
      tag,
      commit,
      node: process.version,
      pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
      signed: false,
      distribution: 'github-prerelease',
    },
    null,
    2,
  ) + '\n',
);
console.log(`Unsigned prerelease ${tag}: reviewed main commit ${commit}`);
