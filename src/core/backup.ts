import { z } from 'zod/v3';
import { LibraryStateSchema, type LibraryState } from './schema';
import { migrateLibraryState } from './migration';
import { validateRegistry } from './reconciliation';

const BackupSchema = z
  .object({ format: z.literal('gaming-library-helper'), version: z.literal(1), state: z.unknown() })
  .strict();

/** Pure file serialization: no writes, network, auth data, or external catalog mapping. */
export function exportLibrary(state: LibraryState): string {
  return JSON.stringify(
    { format: 'gaming-library-helper', version: 1, state: LibraryStateSchema.parse(state) },
    null,
    2,
  );
}

export function importLibrary(json: string): LibraryState {
  const backup = BackupSchema.parse(JSON.parse(json) as unknown);
  const state = migrateLibraryState(backup.state);
  if (!state) throw new Error('Unsupported library backup. Existing data must be preserved.');
  validateRegistry(state.registry);
  const ids = new Set<string>();
  const refs = new Set<string>();
  for (const game of state.games) {
    if (ids.has(game.id)) throw new Error('Duplicate canonical ID');
    ids.add(game.id);
    for (const [store, ref] of Object.entries(game.storeRefs)) {
      const key = `${store}:${ref.storeId}`;
      if (store !== ref.store || refs.has(key))
        throw new Error('Duplicate or inconsistent store ID');
      if (
        ref.classification?.parent?.store === store &&
        ref.classification.parent.storeId === ref.storeId
      )
        throw new Error('A component cannot be its own parent');
      refs.add(key);
    }
  }
  return state;
}
