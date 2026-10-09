import { describe, expect, it } from 'vitest';
import {
  SteamMetadataSnapshotSchema,
  parseSteamMetadataCache,
  mergeSteamMetadata,
  cachedSteamMetadataItem,
} from '../src/core/steam-metadata';
import { captureSteamSnapshot } from '../src/adapters/steam';
const checkedAt = '2026-10-08T16:00:00.000Z';
const source = {
  version: 1 as const,
  source: 'valve-pics-anonymous' as const,
  checkedAt,
  apps: [
    { id: 10, type: 'game' as const, name: 'Fictional Alpha' },
    { id: 20, type: 'dlc' as const, name: 'Fictional Alpha Extra' },
  ],
};
const now = Date.parse(checkedAt);
describe('verified Steam metadata cache', () => {
  it.each([
    { ...source, version: 2 },
    { ...source, source: 'unverified' },
    { ...source, apps: [{ id: 10, type: 'game' }] },
    { ...source, apps: [{ id: 10, type: 'unknown' }] },
    { ...source, apps: [source.apps[0], source.apps[0]] },
    { ...source, authenticationToken: 'synthetic' },
    { ...source, apps: [{ ...source.apps[0], authenticationToken: 'synthetic' }] },
  ])('rejects unsupported versions, unknown types, duplicates, and credential fields', (raw) => {
    expect(SteamMetadataSnapshotSchema.safeParse(raw).success).toBe(false);
  });
  it('preserves newer evidence and stores source/time beside durable IDs', () => {
    const cache = mergeSteamMetadata(parseSteamMetadataCache(undefined), source, now);
    const before = structuredClone(cache);
    const older = {
      ...source,
      checkedAt: '2026-10-07T16:00:00.000Z',
      apps: [{ id: 10, type: 'game' as const, name: 'Older Title' }],
    };
    expect(mergeSteamMetadata(cache, older, now)).toEqual(before);
    expect(cache.apps[0]).toMatchObject({
      id: 10,
      name: 'Fictional Alpha',
      source: source.source,
      checkedAt,
    });
    expect(cachedSteamMetadataItem(cache, 20)).toMatchObject({ id: 20, success: 1, type: 4 });
    expect(cachedSteamMetadataItem(cache, 30)).toEqual({ id: 30, item_type: 0, success: 2 });
    expect(cache).toEqual(before);
  });
  it('refuses future evidence and unsupported existing cache versions', () => {
    expect(() =>
      mergeSteamMetadata(
        parseSteamMetadataCache(undefined),
        { ...source, checkedAt: '2026-10-09T16:00:00.000Z' },
        now,
      ),
    ).toThrow(/future/u);
    expect(() => parseSteamMetadataCache({ version: 2, apps: [] })).toThrow(/preserved/u);
  });
  it('joins names only to independently owned IDs and preserves confirmed DLC as a component', async () => {
    const cache = mergeSteamMetadata(
      parseSteamMetadataCache(undefined),
      { ...source, apps: [...source.apps, { id: 777, type: 'game', name: 'Not Owned' }] },
      now,
    );
    const fetcher = (() =>
      Promise.resolve(
        Response.json({ rgOwnedApps: [10, 20, 30], rgIgnoredApps: {} }),
      )) as typeof fetch;
    const refs = await captureSteamSnapshot(fetcher, (ids) =>
      Promise.resolve({
        response: { store_items: ids.map((id) => cachedSteamMetadataItem(cache, id)) },
      }),
    );
    expect(refs.map((ref) => ref.storeId)).toEqual(['10', '20', '30']);
    expect(refs[0]).toMatchObject({ title: 'Fictional Alpha', titleStatus: 'resolved' });
    expect(refs[1]).toMatchObject({
      storeId: '20',
      title: 'Fictional Alpha Extra',
      titleStatus: 'resolved',
      classification: { kind: 'component', componentType: 'dlc' },
    });
    expect(refs[2]).toMatchObject({ titleStatus: 'unresolved' });
    expect(refs.some((ref) => ref.storeId === '777')).toBe(false);
  });
});
