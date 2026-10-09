import { browser } from 'wxt/browser';
import {
  parseSteamMetadataCache,
  mergeSteamMetadata,
  type SteamMetadataSnapshot,
} from '../core/steam-metadata';
const KEY = 'gaming-library-helper/steam-metadata';
let importQueue: Promise<unknown> = Promise.resolve();

export async function loadSteamMetadata() {
  const stored = await browser.storage.local.get(KEY);
  return parseSteamMetadataCache(stored[KEY]);
}

export function importSteamMetadata(snapshot: SteamMetadataSnapshot) {
  const operation = importQueue.then(async () => {
    const cache = mergeSteamMetadata(await loadSteamMetadata(), snapshot, Date.now());
    await browser.storage.local.set({ [KEY]: cache });
    return { imported: snapshot.apps.length, cachedApps: cache.apps.length };
  });
  importQueue = operation.catch(() => undefined);
  return operation;
}
