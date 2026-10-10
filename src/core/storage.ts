import { browser } from 'wxt/browser';
import { createDefaultState } from './defaults';
import { migrateLibraryState } from './migration';
import { LibraryStateSchema, type LibraryState } from './schema';

const STORAGE_KEY = 'gaming-library-helper/state';
const MIGRATION_BACKUP_KEY = 'gaming-library-helper/migration-backup-v5';
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
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const previous: unknown = stored[STORAGE_KEY];
  if (
    typeof previous === 'object' &&
    previous !== null &&
    'version' in previous &&
    previous.version === 5
  ) {
    const backup = migrateLibraryState(previous);
    if (!backup) throw new Error('Migration backup failed. Existing data is unchanged.');
    await browser.storage.local.set({
      [MIGRATION_BACKUP_KEY]: { version: 1, createdAt: new Date().toISOString(), state: backup },
    });
  }
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
