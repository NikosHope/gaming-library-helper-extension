import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, openSync, readFileSync, readlinkSync } from 'node:fs';

export function gitFiles(staged = false) {
  const args = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
  return [
    ...new Set(execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean)),
  ].filter((file) => staged || existsSync(file));
}

export function fileContents(file, staged = false) {
  if (staged) return execFileSync('git', ['show', `:${file}`]);
  let descriptor;
  try {
    // Inspect and read through one descriptor, never following a swapped symlink.
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    return readFileSync(descriptor);
  } catch (error) {
    if (error.code !== 'ELOOP') throw error;
    return Buffer.from(readlinkSync(file));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function allowedSymlink(file, target) {
  return (
    [
      '.claude/skills/firefox-extension-development',
      '.gemini/skills/firefox-extension-development',
    ].includes(file) && target === '../../.agents/skills/firefox-extension-development'
  );
}

export function forbiddenPath(file) {
  return (
    /(^|\/)(\.git|\.aws|\.codex|node_modules|\.output|\.wxt|coverage|artifacts|exports|downloads)(\/|$)/i.test(
      file,
    ) ||
    (/(^|\/)\.env(?:\..*)?$/.test(file) && !file.endsWith('.env.example')) ||
    /\.(zip|xpi|pem|key|log)$/i.test(file) ||
    /(^|\/)(verified-steam-metadata\.json|acceptance-[^/]*|\.web-extension-id|settings\.local\.json|CLAUDE\.local\.md)$/.test(
      file,
    )
  );
}

export function inspectPublicFile(file, bytes) {
  const errors = [];
  if (forbiddenPath(file)) errors.push('private or generated path');
  if (bytes.length > 5 * 1024 * 1024) errors.push('file exceeds 5 MiB; review before publishing');
  if (
    !bytes.includes(0) &&
    /(?:\/Users\/|C:\\Users\\|\/home\/)[\w.-]+[/\\]/.test(bytes.toString('utf8'))
  ) {
    errors.push('personal absolute filesystem path');
  }
  return errors;
}
