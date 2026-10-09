import { browser } from 'wxt/browser';
import { z } from 'zod/v3';
import { loadState } from '../core/storage';
import type { Store } from '../core/schema';
import { captureAmazonLibrary } from './amazon-capture';
import {
  DEFAULT_SYNC_SETTINGS,
  dueSyncStores,
  syncReceipt,
  SyncReceiptsSchema,
  SyncSettingsSchema,
  migrateSyncSettings,
  migrateSyncReceipts,
  type SyncReceipts,
  type SyncSettings,
} from '../core/sync';

export const SYNC_ALARM = 'gaming-library-helper/sync';
const SETTINGS_KEY = 'gaming-library-helper/sync-settings';
const RECEIPTS_KEY = 'gaming-library-helper/sync-receipts';
const STORE_URLS: Partial<Record<Store, string[]>> = {
  steam: ['https://store.steampowered.com/*'],
  gog: ['https://www.gog.com/*'],
  epic: ['https://store.epicgames.com/*'],
  battlenet: ['https://account.battle.net/games'],
};
const CaptureResultSchema = z.object({
  ok: z.literal(true),
  gameCount: z.number().int().nonnegative(),
});
let running: Promise<void> | undefined;
let runningMode: 'scheduled' | 'manual' | undefined;
let alarmQueue: Promise<unknown> = Promise.resolve();
let receiptsQueue: Promise<unknown> = Promise.resolve();

export async function loadSyncSettings(): Promise<SyncSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return migrateSyncSettings(stored[SETTINGS_KEY]) ?? structuredClone(DEFAULT_SYNC_SETTINGS);
}

async function loadReceipts(): Promise<SyncReceipts> {
  const stored = await browser.storage.local.get(RECEIPTS_KEY);
  const parsed = migrateSyncReceipts(stored[RECEIPTS_KEY]);
  if (stored[RECEIPTS_KEY] === undefined) return { version: 2, stores: {} };
  if (!parsed) throw new Error('Unsupported sync history. Existing history has been preserved.');
  return parsed;
}

export async function getSyncStatus(): Promise<{
  settings: SyncSettings;
  receipts: SyncReceipts;
}> {
  return { settings: await loadSyncSettings(), receipts: await loadReceipts() };
}

async function performAlarmRestore(): Promise<void> {
  const settings = await loadSyncSettings();
  if (!settings.enabled) {
    await browser.alarms.clear(SYNC_ALARM);
    return;
  }
  if (!(await browser.alarms.get(SYNC_ALARM))) {
    await browser.alarms.create(SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: 60 });
  }
}

export function restoreSyncAlarm(): Promise<void> {
  const operation = alarmQueue.then(performAlarmRestore);
  alarmQueue = operation.catch(() => undefined);
  return operation;
}

export async function configureSync(input: SyncSettings): Promise<SyncSettings> {
  const settings = SyncSettingsSchema.parse(input);
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  await restoreSyncAlarm();
  return settings;
}

async function recordAttempt(
  store: Store,
  outcome: Parameters<typeof syncReceipt>[1],
  gameCount?: number,
): Promise<void> {
  const operation = receiptsQueue.then(async () => {
    const receipts = await loadReceipts();
    receipts.stores[store] = syncReceipt(
      receipts.stores[store],
      outcome,
      new Date().toISOString(),
      gameCount,
    );
    await browser.storage.local.set({ [RECEIPTS_KEY]: SyncReceiptsSchema.parse(receipts) });
  });
  receiptsQueue = operation.catch(() => undefined);
  await operation;
}

async function performSync(mode: 'scheduled' | 'manual'): Promise<void> {
  const settings = await loadSyncSettings();
  const receipts = await loadReceipts();
  const library = await loadState();
  const snapshotTimes = Object.fromEntries(
    Object.entries(library.snapshots).map(([store, snapshot]) => [store, snapshot.syncedAt]),
  );
  const due =
    mode === 'manual'
      ? settings.stores
      : dueSyncStores(settings, receipts, snapshotTimes, Date.now());

  for (const store of due) {
    const latest = await loadSyncSettings();
    if ((mode === 'scheduled' && !latest.enabled) || !latest.stores.includes(store)) continue;
    try {
      if (store === 'amazon') {
        const result = CaptureResultSchema.parse(await captureAmazonLibrary());
        await recordAttempt(store, 'success', result.gameCount);
        continue;
      }
      const sourceUrls = STORE_URLS[store];
      if (!sourceUrls) {
        await recordAttempt(store, 'capture-failed');
        continue;
      }
      const tabs = (
        await browser.tabs.query({
          url: sourceUrls,
          status: 'complete',
          discarded: false,
        })
      ).filter((tab) => !tab.incognito && tab.id !== undefined);
      if (tabs.length !== 1) {
        await recordAttempt(store, tabs.length ? 'ambiguous-tabs' : 'source-tab-required');
        continue;
      }
      const result = CaptureResultSchema.parse(
        await browser.tabs.sendMessage(tabs[0]!.id!, { type: 'page:captureSnapshot' }),
      );
      await recordAttempt(store, 'success', result.gameCount);
    } catch {
      // Never persist a page-controlled error, redirect URL, or response body.
      await recordAttempt(store, 'capture-failed');
    }
  }
}

function runSync(mode: 'scheduled' | 'manual'): Promise<void> {
  if (running) {
    // An explicit request must still run when an overlapping alarm had nothing due.
    if (mode === 'manual' && runningMode === 'scheduled') {
      return running.then(() => runSync('manual'));
    }
    return running;
  }
  runningMode = mode;
  running = performSync(mode).finally(() => {
    running = undefined;
    runningMode = undefined;
  });
  return running;
}

export function runScheduledSync(): Promise<void> {
  return runSync('scheduled');
}

export function runSyncNow(): Promise<void> {
  return runSync('manual');
}
