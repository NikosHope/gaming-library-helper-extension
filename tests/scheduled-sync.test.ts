import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  stored: new Map<string, unknown>(),
  get: vi.fn(),
  set: vi.fn(),
  query: vi.fn(),
  send: vi.fn(),
  alarmGet: vi.fn(),
  alarmCreate: vi.fn(),
  alarmClear: vi.fn(),
  amazonCapture: vi.fn(),
}));
vi.mock('../src/background/amazon-capture', () => ({ captureAmazonLibrary: mock.amazonCapture }));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: mock.get, set: mock.set } },
    tabs: { query: mock.query, sendMessage: mock.send },
    alarms: { get: mock.alarmGet, create: mock.alarmCreate, clear: mock.alarmClear },
  },
}));
import {
  configureSync,
  getSyncStatus,
  restoreSyncAlarm,
  runScheduledSync,
  runSyncNow,
  SYNC_ALARM,
} from '../src/background/scheduled-sync';
import { DEFAULT_SYNC_SETTINGS } from '../src/core/sync';

beforeEach(() => {
  vi.clearAllMocks();
  mock.stored = new Map();
  mock.get.mockImplementation((key: string) => Promise.resolve({ [key]: mock.stored.get(key) }));
  mock.set.mockImplementation((values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) mock.stored.set(key, value);
    return Promise.resolve();
  });
  mock.query.mockResolvedValue([{ id: 123, incognito: false }]);
  mock.send.mockResolvedValue({ ok: true, gameCount: 42 });
  mock.alarmGet.mockResolvedValue(undefined);
  mock.alarmCreate.mockResolvedValue(undefined);
  mock.alarmClear.mockResolvedValue(true);
  mock.amazonCapture.mockResolvedValue({ ok: true, gameCount: 24 });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T20:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('Firefox scheduled sync orchestration', () => {
  async function enable(): Promise<void> {
    await configureSync({ ...DEFAULT_SYNC_SETTINGS, enabled: true, stores: ['gog'] });
  }

  it('does not request any tabs when disabled', async () => {
    await restoreSyncAlarm();
    await runScheduledSync();
    expect(mock.alarmClear).toHaveBeenCalledWith(SYNC_ALARM);
    expect(mock.query).not.toHaveBeenCalled();
  });

  it('persists settings, restores a missing alarm, and leaves an existing alarm intact', async () => {
    await enable();
    expect(mock.alarmCreate).toHaveBeenCalledWith(SYNC_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 60,
    });
    mock.alarmGet.mockResolvedValue({ name: SYNC_ALARM });
    await restoreSyncAlarm();
    expect(mock.alarmCreate).toHaveBeenCalledTimes(1);
    expect((await getSyncStatus()).settings.enabled).toBe(true);
  });

  it('only signals a single existing nonprivate source tab and records committed success', async () => {
    await enable();
    await runScheduledSync();
    expect(mock.query).toHaveBeenCalledWith({
      url: ['https://www.gog.com/*'],
      status: 'complete',
      discarded: false,
    });
    expect(mock.send).toHaveBeenCalledWith(123, { type: 'page:captureSnapshot' });
    expect((await getSyncStatus()).receipts.stores.gog).toMatchObject({
      outcome: 'success',
      gameCount: 42,
      lastSuccessAt: '2026-10-07T20:00:00.000Z',
    });
    await runScheduledSync();
    expect(mock.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    [[], 'source-tab-required'],
    [[{ id: 1, incognito: true }], 'source-tab-required'],
    [[{ id: 1 }, { id: 2 }], 'ambiguous-tabs'],
  ])('requires an unambiguous source tab', async (tabs, outcome) => {
    await enable();
    mock.query.mockResolvedValue(tabs);
    await runScheduledSync();
    expect(mock.send).not.toHaveBeenCalled();
    expect((await getSyncStatus()).receipts.stores.gog?.outcome).toBe(outcome);
  });

  it('keeps a last success separately from a new failure and does not persist raw error text', async () => {
    await enable();
    await runScheduledSync();
    vi.setSystemTime(new Date('2026-10-15T20:00:00Z'));
    mock.send.mockRejectedValue(new Error('synthetic-private-value'));
    await runScheduledSync();
    expect((await getSyncStatus()).receipts.stores.gog).toMatchObject({
      outcome: 'capture-failed',
      lastSuccessAt: '2026-10-07T20:00:00.000Z',
      gameCount: 42,
    });
    expect(JSON.stringify([...mock.stored])).not.toContain('synthetic-private-value');
  });

  it('shares overlapping alarm work instead of running concurrent captures', async () => {
    await enable();
    const first = runScheduledSync();
    const second = runScheduledSync();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(mock.send).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed capture acknowledgements', async () => {
    await enable();
    mock.send.mockResolvedValue({ ok: false, gameCount: 0 });
    await runScheduledSync();
    expect((await getSyncStatus()).receipts.stores.gog?.outcome).toBe('capture-failed');
    expect((await getSyncStatus()).receipts.stores.gog?.lastSuccessAt).toBeUndefined();
  });

  it('preserves unknown receipt versions without capturing or overwriting them', async () => {
    await enable();
    const futureHistory = { version: 99, stores: { gog: { opaque: 'future-state' } } };
    mock.stored.set('gaming-library-helper/sync-receipts', futureHistory);
    await expect(runScheduledSync()).rejects.toThrow(/Unsupported sync history/u);
    expect(mock.query).not.toHaveBeenCalled();
    expect(mock.stored.get('gaming-library-helper/sync-receipts')).toEqual(futureHistory);
  });

  it('does not recreate alarms for unknown config versions', async () => {
    mock.stored.set('gaming-library-helper/sync-settings', {
      ...DEFAULT_SYNC_SETTINGS,
      version: 99,
      enabled: true,
    });
    await restoreSyncAlarm();
    expect(mock.alarmCreate).not.toHaveBeenCalled();
  });

  it('runs explicitly while auto sync is off, without enabling an alarm', async () => {
    await configureSync({ ...DEFAULT_SYNC_SETTINGS, stores: ['gog'] });
    await runSyncNow();
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect((await getSyncStatus()).settings.enabled).toBe(false);
    expect(mock.alarmCreate).not.toHaveBeenCalled();
    expect((await getSyncStatus()).receipts.stores.gog?.outcome).toBe('success');
  });

  it('allows a manual refresh before the next due time and a manual retry without waiting an hour', async () => {
    await enable();
    await runScheduledSync();
    mock.send.mockRejectedValueOnce(new Error('synthetic-private-value'));
    await runSyncNow();
    expect((await getSyncStatus()).receipts.stores.gog?.outcome).toBe('capture-failed');
    await runSyncNow();
    expect(mock.send).toHaveBeenCalledTimes(3);
    expect((await getSyncStatus()).receipts.stores.gog?.outcome).toBe('success');
  });

  it('does not lose a manual request when an overlapping disabled alarm has nothing due', async () => {
    await configureSync({ ...DEFAULT_SYNC_SETTINGS, stores: ['gog'] });
    const scheduled = runScheduledSync();
    const manual = runSyncNow();
    const anotherManual = runSyncNow();
    await Promise.all([scheduled, manual, anotherManual]);
    expect(mock.send).toHaveBeenCalledTimes(1);
  });

  it('shares a manual capture with concurrent manual and alarm requests', async () => {
    await enable();
    const manual = runSyncNow();
    expect(runSyncNow()).toBe(manual);
    expect(runScheduledSync()).toBe(manual);
    await manual;
    expect(mock.send).toHaveBeenCalledTimes(1);
  });

  it('captures Epic only through one loaded nonprivate Epic source tab', async () => {
    await configureSync({ ...DEFAULT_SYNC_SETTINGS, stores: ['epic'] });
    await runSyncNow();
    expect(mock.query).toHaveBeenCalledWith({
      url: ['https://store.epicgames.com/*'],
      status: 'complete',
      discarded: false,
    });
    expect(mock.send).toHaveBeenCalledWith(123, { type: 'page:captureSnapshot' });
    expect((await getSyncStatus()).receipts.stores.epic?.outcome).toBe('success');
  });

  it('captures authorized Amazon directly in the background and schedules its durable result', async () => {
    await configureSync({ ...DEFAULT_SYNC_SETTINGS, stores: ['amazon'] });
    await runSyncNow();
    expect(mock.query).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.amazonCapture).toHaveBeenCalledTimes(1);
    expect((await getSyncStatus()).receipts.stores.amazon).toMatchObject({
      outcome: 'success',
      gameCount: 24,
    });
    mock.amazonCapture.mockRejectedValueOnce(new Error('synthetic-secret-error'));
    await runSyncNow();
    expect((await getSyncStatus()).receipts.stores.amazon?.outcome).toBe('capture-failed');
    expect((await getSyncStatus()).receipts.stores.amazon?.gameCount).toBe(24);
    expect(JSON.stringify([...mock.stored])).not.toContain('synthetic-secret-error');
  });

  it('captures Battle.net only from the exact account games route', async () => {
    await configureSync({ ...DEFAULT_SYNC_SETTINGS, stores: ['battlenet'] });
    await runSyncNow();
    expect(mock.query).toHaveBeenCalledWith({
      url: ['https://account.battle.net/games'],
      status: 'complete',
      discarded: false,
    });
    expect(mock.send).toHaveBeenCalledWith(123, { type: 'page:captureSnapshot' });
    expect((await getSyncStatus()).receipts.stores.battlenet?.outcome).toBe('success');
  });
});
