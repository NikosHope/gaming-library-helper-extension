import { browser } from 'wxt/browser';
import { createDefaultState } from './defaults';
import { migrateLibraryState } from './migration';
import { LibraryStateSchema, type LibraryState } from './schema';

const STORAGE_KEY = 'gaming-library-helper/state';
let updateQueue: Promise<unknown> = Promise.resolve();

export async function loadState(): Promise<LibraryState> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY] === undefined) return createDefaultState();
  const migrated = migrateLibraryState(stored[STORAGE_KEY]);
  if (!migrated)
    throw new Error('Saved library has an unsupported format. Your existing data is unchanged.');
  return migrated;
}

export async function saveState(state: LibraryState): Promise<void> {
  const validated = LibraryStateSchema.parse(state);
  await browser.storage.local.set({ [STORAGE_KEY]: validated });
}

export function updateState(
  update: (state: LibraryState) => LibraryState | Promise<LibraryState>,
): Promise<LibraryState> {
  const operation = updateQueue.then(async () => {
    const current = await loadState();
    const next = LibraryStateSchema.parse(await update(current));
    await saveState(next);
    return next;
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}
