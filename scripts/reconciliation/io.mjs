import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { verifyInputSnapshot } from '../../src/core/reconciliation.ts';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const privateRoot = join(repoRoot, 'artifacts/local/reconciliation/runtime');
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
export async function readJson(path, optional = false) {
  try {
    if ((await stat(path)).size > MAX_DOCUMENT_BYTES)
      throw new Error('Local document exceeds the size limit');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function atomicWrite(path, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES)
    throw new Error('Local document exceeds the size limit');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function withLock(root, name, action) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = join(root, `${name}.lock`);
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await readJson(join(lock, 'owner.json'), true);
    let alive = false;
    if (owner && Number.isSafeInteger(owner.pid)) {
      try {
        process.kill(owner.pid, 0);
        alive = true;
      } catch (failure) {
        alive = failure.code !== 'ESRCH';
      }
    }
    if (alive || Date.now() - (await stat(lock)).mtimeMs < 30_000)
      throw new Error('Another reconciliation is running; retry after it finishes', {
        cause: error,
      });
    await rm(lock, { recursive: true });
    return withLock(root, name, action);
  }
  try {
    await atomicWrite(join(lock, 'owner.json'), { pid: process.pid });
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export async function publishSnapshot(value, root = privateRoot) {
  const snapshot = await verifyInputSnapshot(value);
  return withLock(root, 'snapshot', async () => {
    const previous = await readJson(join(root, 'snapshot.json'), true);
    if (previous?.inputHash === snapshot.inputHash)
      return { inputHash: snapshot.inputHash, changed: false };
    if (previous && snapshot.createdAt < previous.createdAt)
      throw new Error('An older snapshot cannot replace the current input');
    await atomicWrite(join(root, 'snapshot.json'), snapshot);
    return { inputHash: snapshot.inputHash, changed: true };
  });
}
export async function currentInput(root = privateRoot) {
  const value = await readJson(join(root, 'snapshot.json'), true);
  if (!value)
    throw new Error(
      'No Firefox snapshot. Connect the local runner and refresh, or collect --input a local backup',
    );
  return verifyInputSnapshot(value);
}
export async function assertCurrent(hash, root = privateRoot) {
  if ((await currentInput(root)).inputHash !== hash)
    throw new Error(
      'Input changed during reconciliation; collect again. The last accepted result is unchanged',
    );
}
