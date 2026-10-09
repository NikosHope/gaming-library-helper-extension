import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../src/core/defaults';
import {
  replaceStoreSnapshot,
  countOwned,
  findGameForPage,
  ownedOnOtherStores,
} from '../src/core/library';
import { countProducts } from '../src/core/products';
import {
  SteamPackageEvidenceCatalogSchema,
  steamPackageEvidenceCatalog,
  steamPackageEvidenceForRef,
  unknownSteamProducts,
} from '../src/core/steam-package-evidence';
import type { StoreGameRef } from '../src/core/schema';

const at = '2026-10-09T05:00:00.000Z';
function unknown(id: string): StoreGameRef {
  return {
    store: 'steam',
    storeId: id,
    title: `Steam app ${id}`,
    titleStatus: 'unresolved',
    owned: true,
    ignoredAtSource: false,
    importedAt: at,
  };
}
function capture(refs: StoreGameRef[]) {
  return replaceStoreSnapshot(createDefaultState(), { store: 'steam', syncedAt: at, refs }).state;
}

describe('Steam package co-membership evidence', () => {
  it('covers every reported ID without creating base-game ownership, names or parents', () => {
    const catalog = steamPackageEvidenceCatalog();
    expect(catalog.records).toHaveLength(24);
    const state = capture(catalog.records.map((record) => unknown(record.appId)));
    const before = structuredClone(state);
    const rows = unknownSteamProducts(state);
    expect(rows).toHaveLength(24);
    expect(
      rows.every(
        (row) =>
          row.titleStatus === 'unresolved' &&
          row.providerTitle === `Steam app ${row.appId}` &&
          row.evidence?.parentAppId === null,
      ),
    ).toBe(true);
    expect(countOwned(state, 'steam')).toBe(0);
    expect(countProducts(state)).toMatchObject({ game: 0, unknown: 24, records: 24 });
    for (const game of state.games) expect(ownedOnOtherStores(game, 'gog')).toEqual([]);
    expect(
      findGameForPage(state, {
        store: 'steam',
        storeId: '231740',
        title: 'Knights of Pen and Paper +1 Edition',
      }),
    ).toBeUndefined();
    expect(state).toEqual(before);
  });
  it('retains all co-members of multi-app products, with separate app and package namespaces', () => {
    const trilogy = steamPackageEvidenceForRef({ store: 'steam', storeId: '3575160' })!;
    expect(trilogy.evidencePackage).toMatchObject({ entity: 'package', id: '817628' });
    expect(trilogy.associatedApps.map((app) => app.id)).toEqual(['1546970', '1546990', '1547000']);
    expect(trilogy.associatedApps.every((app) => app.entity === 'app')).toBe(true);
    expect(trilogy.parentAppId).toBeNull();
    const party = steamPackageEvidenceForRef({ store: 'steam', storeId: '480200' })!;
    expect(party.associatedApps.map((app) => app.id)).toEqual([
      '73054',
      '73055',
      '73056',
      '813830',
    ]);
    expect(steamPackageEvidenceForRef({ store: 'gog', storeId: '3575160' })).toBeUndefined();
    expect(steamPackageEvidenceForRef({ store: 'steam', storeId: '817628' })).toBeUndefined();
  });
  it('searches associated titles/IDs without renaming the unknown or mutating the catalog', () => {
    const state = capture([unknown('3575160'), unknown('999901')]);
    expect(unknownSteamProducts(state, 'Vice City').map((row) => row.appId)).toEqual(['3575160']);
    expect(unknownSteamProducts(state, '817628')[0]?.providerTitle).toBe('Steam app 3575160');
    expect(
      unknownSteamProducts(state).find((row) => row.appId === '999901')?.evidence,
    ).toBeUndefined();
    const copy = steamPackageEvidenceCatalog();
    copy.records[0]!.associatedApps[0]!.title = 'Changed outside catalog';
    expect(steamPackageEvidenceCatalog()).not.toEqual(copy);
  });
  it('keeps historical membership when newer real app metadata resolves its title/type', () => {
    const history = steamPackageEvidenceForRef({ store: 'steam', storeId: '478730' });
    const state = capture([
      {
        ...unknown('478730'),
        title: 'New verified own title',
        titleStatus: 'resolved',
        classification: {
          kind: 'game',
          source: 'store-metadata',
          confidence: 'primary',
          evidenceUrls: ['https://store.steampowered.com/app/478730/'],
        },
      },
    ]);
    expect(unknownSteamProducts(state)).toEqual([]);
    expect(state.games[0]?.storeRefs.steam?.title).toBe('New verified own title');
    expect(steamPackageEvidenceForRef({ store: 'steam', storeId: '478730' })).toEqual(history);
  });
  it('rejects future versions, inferred parents/classifications, mismatched source IDs and credentials', () => {
    const base = steamPackageEvidenceCatalog();
    const row = base.records[0]!;
    const invalid = [
      { ...base, version: 2 },
      { ...base, records: [row, row] },
      { ...base, records: [{ ...row, parentAppId: row.associatedApps[0]!.id }] },
      { ...base, records: [{ ...row, classification: 'dlc' }] },
      { ...base, records: [{ ...row, evidenceUrl: 'https://steamdb.info/app/15726/' }] },
      { ...base, records: [{ ...row, sourceName: 'A guessed own title' }] },
      { ...base, records: [{ ...row, token: 'synthetic' }] },
    ];
    for (const value of invalid)
      expect(SteamPackageEvidenceCatalogSchema.safeParse(value).success).toBe(false);
  });
});
