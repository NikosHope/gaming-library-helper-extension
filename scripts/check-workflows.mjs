import { readFileSync, readdirSync } from 'node:fs';

for (const file of readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name))) {
  const source = readFileSync(`.github/workflows/${file}`, 'utf8');
  if (/pull_request_target|write-all/.test(source))
    throw new Error(`${file}: unsafe workflow privilege`);
  for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    if (!/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(match[1]))
      throw new Error(`${file}: action must be pinned to a full commit SHA`);
  }
}
console.log('All actions are SHA-pinned; privileged PR triggers are absent.');
