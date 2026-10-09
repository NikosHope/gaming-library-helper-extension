import { captureAmazonSnapshot } from '../adapters/amazon';
import { replaceStoreSnapshot } from '../core/library';
import { updateState } from '../core/storage';
import { refreshAmazonAccess } from './amazon-auth';

export async function captureAmazonLibrary(): Promise<{ ok: true; gameCount: number }> {
  const syncedAt = new Date().toISOString();
  const refs = await captureAmazonSnapshot(await refreshAmazonAccess());
  const state = await updateState(
    (current) => replaceStoreSnapshot(current, { store: 'amazon', syncedAt, refs }).state,
  );
  return { ok: true, gameCount: state.snapshots.amazon?.gameCount ?? 0 };
}
