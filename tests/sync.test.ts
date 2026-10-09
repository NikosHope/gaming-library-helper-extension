import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNC_SETTINGS,
  dueSyncStores,
  syncReceipt,
  SyncSettingsSchema,
  migrateSyncSettings,
  migrateSyncReceipts,
} from '../src/core/sync';

const now = Date.parse('2026-10-07T20:00:00.000Z');
const old = '2026-09-01T20:00:00.000Z';

describe('sync scheduling rules', () => {
  it('defaults to disabled and rejects unsupported persisted versions', () => {
    expect(dueSyncStores(DEFAULT_SYNC_SETTINGS, { version: 2, stores: {} }, {}, now)).toEqual([]);
    expect(SyncSettingsSchema.safeParse({ ...DEFAULT_SYNC_SETTINGS, version: 99 }).success).toBe(
      false,
    );
    expect(
      SyncSettingsSchema.safeParse({ ...DEFAULT_SYNC_SETTINGS, stores: ['unknown'] }).success,
    ).toBe(false);
  });

  it('migrates old schedule and receipts without enabling another provider or losing successes', () => {
    const settings = { version: 1, enabled: true, intervalHours: 168, stores: ['steam', 'gog'] };
    const receipt = syncReceipt(undefined, 'success', old, 273);
    const receipts = { version: 1, stores: { gog: receipt } };
    expect(migrateSyncSettings(settings)).toEqual({ ...settings, version: 2 });
    expect(migrateSyncReceipts(receipts)).toEqual({ ...receipts, version: 2 });
    expect(settings.version).toBe(1);
    expect(receipts.version).toBe(1);
    expect(migrateSyncSettings({ ...settings, stores: ['epic'] })).toBeUndefined();
    expect(migrateSyncReceipts({ ...receipts, version: 99 })).toBeUndefined();
  });

  it('only runs configured stores when the last good snapshot is due', () => {
    const settings = { ...DEFAULT_SYNC_SETTINGS, enabled: true };
    expect(
      dueSyncStores(
        settings,
        { version: 2, stores: {} },
        { steam: new Date(now - 1_000).toISOString(), gog: old },
        now,
      ),
    ).toEqual(['gog']);
  });

  it('backs off failures for an hour without losing the last success', () => {
    const previous = syncReceipt(undefined, 'success', old, 42);
    const failed = syncReceipt(previous, 'capture-failed', new Date(now).toISOString());
    expect(failed).toMatchObject({ outcome: 'capture-failed', lastSuccessAt: old, gameCount: 42 });
    const settings = { ...DEFAULT_SYNC_SETTINGS, enabled: true, stores: ['gog'] as const };
    const configured = SyncSettingsSchema.parse(settings);
    const receipts = { version: 2 as const, stores: { gog: failed } };
    expect(dueSyncStores(configured, receipts, {}, now + 3_599_999)).toEqual([]);
    expect(dueSyncStores(configured, receipts, {}, now + 3_600_000)).toEqual(['gog']);
  });

  it('uses a manual successful snapshot to postpone the scheduled sync', () => {
    expect(
      dueSyncStores(
        { ...DEFAULT_SYNC_SETTINGS, enabled: true },
        { version: 2, stores: {} },
        { steam: new Date(now).toISOString() },
        now,
      ),
    ).toEqual(['gog']);
  });

  it('fails closed for duplicate or empty store selections and arbitrary intervals', () => {
    for (const override of [{ stores: [] }, { stores: ['steam', 'steam'] }, { intervalHours: 1 }]) {
      expect(SyncSettingsSchema.safeParse({ ...DEFAULT_SYNC_SETTINGS, ...override }).success).toBe(
        false,
      );
    }
  });
});
