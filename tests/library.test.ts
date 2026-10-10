import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../src/core/defaults';
import { findGameForPage, replaceStoreSnapshot } from '../src/core/library';
import type { Store, StoreGameRef, StoreSnapshot } from '../src/core/schema';
import { RegistrySchema } from '../src/core/reconciliation-schema';

const now = '2026-07-18T18:00:00.000Z';

function ref(
  store: Store,
  storeId: string,
  title: string,
  overrides: Partial<StoreGameRef> = {},
): StoreGameRef {
  return {
    store,
    storeId,
    title,
    titleStatus: 'resolved',
    owned: true,
    ignoredAtSource: false,
    importedAt: now,
    ...overrides,
  };
}

function snapshot(store: 'steam' | 'gog', refs: StoreGameRef[]): StoreSnapshot {
  return { store, syncedAt: now, refs };
}

describe('replaceStoreSnapshot', () => {
  it('retains exact-title products separately until catalog identity is confirmed', () => {
    const steam = replaceStoreSnapshot(
      createDefaultState(),
      snapshot('steam', [ref('steam', '123', 'Baldur’s Gate 3')]),
    ).state;
    const merged = replaceStoreSnapshot(
      steam,
      snapshot('gog', [ref('gog', '456', "Baldur's Gate 3")]),
    ).state;

    expect(merged.games).toHaveLength(2);
    expect(merged.games[0]?.storeRefs.steam?.storeId).toBe('123');
    expect(merged.games[1]?.storeRefs.gog?.storeId).toBe('456');
  });

  it('does not merge distinct editions', () => {
    const steam = replaceStoreSnapshot(
      createDefaultState(),
      snapshot('steam', [ref('steam', '1', 'Control')]),
    ).state;
    const merged = replaceStoreSnapshot(
      steam,
      snapshot('gog', [ref('gog', '2', 'Control Ultimate Edition')]),
    ).state;

    expect(merged.games).toHaveLength(2);
  });

  it('preserves user annotations when a store removes a title', () => {
    const initial = replaceStoreSnapshot(
      createDefaultState(),
      snapshot('steam', [ref('steam', '1', 'Portal')]),
    ).state;
    initial.games[0]!.ignored = true;
    const replaced = replaceStoreSnapshot(initial, snapshot('steam', [])).state;

    expect(replaced.games).toHaveLength(1);
    expect(replaced.games[0]?.ignored).toBe(true);
  });

  it('rejects a delayed snapshot after a newer capture has committed', () => {
    const current = replaceStoreSnapshot(
      createDefaultState(),
      snapshot('steam', [ref('steam', '1', 'Portal')]),
    ).state;
    const before = structuredClone(current);
    expect(() =>
      replaceStoreSnapshot(current, {
        store: 'steam',
        syncedAt: '2026-07-17T18:00:00.000Z',
        refs: [],
      }),
    ).toThrow(/newer snapshot/u);
    expect(current).toEqual(before);
  });

  it('keeps canonical identities across repeated identical imports', () => {
    const source = snapshot('steam', [ref('steam', '1', 'Portal'), ref('steam', '2', 'Portal 2')]);
    const current = replaceStoreSnapshot(createDefaultState(), source).state;
    expect(replaceStoreSnapshot(current, source).state).toEqual(current);
  });

  it('rejects duplicate provider IDs before committing', () => {
    expect(() =>
      replaceStoreSnapshot(
        createDefaultState(),
        snapshot('steam', [ref('steam', '1', 'Portal'), ref('steam', '1', 'Portal 2')]),
      ),
    ).toThrow(/Duplicate steam store ID/u);
  });
});

describe('findGameForPage', () => {
  it('matches an exact catalog-backed GOG URL and rejects conflicting page ID/URL evidence', () => {
    const state = replaceStoreSnapshot(
      createDefaultState(),
      snapshot('steam', [ref('steam', '10', 'Alpha')]),
    ).state;
    state.registry = RegistrySchema.parse({
      version: 1,
      records: [
        {
          identity: { provider: 'igdb', id: 1 },
          title: 'Alpha',
          kind: 'game',
          dependency: 'none',
          url: 'https://www.igdb.com/games/alpha',
          checkedAt: now,
          externalRefs: [
            { store: 'steam', storeId: '10' },
            { store: 'gog', storeId: '20', url: 'https://www.gog.com/game/alpha' },
          ],
        },
      ],
      matches: [
        {
          store: 'steam',
          storeId: '10',
          catalog: { provider: 'igdb', id: 1 },
          method: 'external-id',
          evidenceUrls: ['https://www.igdb.com/games/alpha'],
          verifiedAt: now,
        },
      ],
    });
    expect(
      findGameForPage(state, {
        store: 'gog',
        title: 'Wrong display name',
        url: 'https://www.gog.com/en/game/alpha',
      })?.storeRefs.steam?.owned,
    ).toBe(true);
    expect(
      findGameForPage(state, {
        store: 'gog',
        title: 'Alpha',
        url: 'https://www.gog.com/game/other',
      }),
    ).toBeUndefined();
    state.registry.records.push({
      ...state.registry.records[0]!,
      identity: { provider: 'igdb', id: 2 },
      kind: 'edition',
      versionParent: { provider: 'igdb', id: 1 },
      externalRefs: [{ store: 'gog', storeId: '99', url: 'https://www.gog.com/game/alpha-deluxe' }],
    });
    state.registry.proposals.push({
      id: crypto.randomUUID(),
      store: 'steam',
      storeId: '10',
      candidate: { provider: 'igdb', id: 2 },
      origin: 'llm',
      evidenceUrls: ['https://www.igdb.com/games/alpha-deluxe'],
      rationale: 'Unconfirmed edition',
    });
    expect(
      findGameForPage(state, {
        store: 'gog',
        storeId: '99',
        title: 'Alpha Deluxe',
        url: 'https://www.gog.com/game/alpha-deluxe',
      }),
    ).toBeUndefined();
  });
  it('uses provider ID without asserting identity from an exact title', () => {
    const state = replaceStoreSnapshot(
      createDefaultState(),
      snapshot('gog', [ref('gog', '10', 'Disco Elysium')]),
    ).state;

    expect(findGameForPage(state, { store: 'gog', storeId: '10', title: 'wrong' })?.id).toBe(
      state.games[0]?.id,
    );
    expect(findGameForPage(state, { store: 'steam', title: 'Disco Elysium' })).toBeUndefined();
  });
});

describe('additional provider snapshots', () => {
  it('keeps annotations and canonical identity while adding Epic ownership', () => {
    const first = replaceStoreSnapshot(createDefaultState(), {
      store: 'gog',
      syncedAt: now,
      refs: [ref('gog', '20', 'Sample Space Game')],
    }).state;
    first.games[0]!.notes = 'My note';
    const canonicalId = first.games[0]!.id;
    const next = replaceStoreSnapshot(first, {
      store: 'epic',
      syncedAt: now,
      refs: [ref('epic', 'fictional:alpha', 'Sample Space Game')],
    }).state;
    expect(next.games).toHaveLength(2);
    expect(next.games[0]).toMatchObject({ id: canonicalId, notes: 'My note' });
    expect(next.games[1]?.storeRefs.epic?.storeId).toBe('fictional:alpha');
    expect(next.games[0]?.storeRefs.gog?.storeId).toBe('20');
    expect(first.games[0]?.storeRefs.epic).toBeUndefined();
  });

  it('upgrades an unresolved Epic title without replacing its canonical identity or notes', () => {
    const initial = replaceStoreSnapshot(createDefaultState(), {
      store: 'epic',
      syncedAt: now,
      refs: [
        ref('epic', 'fictional:alpha', 'Epic item fictional:alpha', { titleStatus: 'unresolved' }),
      ],
    }).state;
    initial.games[0]!.notes = 'Keep this';
    const next = replaceStoreSnapshot(initial, {
      store: 'epic',
      syncedAt: now,
      refs: [ref('epic', 'fictional:alpha', 'Sample Space Game')],
    }).state;
    expect(next.games[0]).toMatchObject({
      id: initial.games[0]!.id,
      displayTitle: 'Sample Space Game',
      normalizedTitle: 'sample space game',
      notes: 'Keep this',
    });
  });
});
