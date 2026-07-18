import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../src/core/defaults';
import { findGameForPage, replaceStoreSnapshot } from '../src/core/library';
import type { StoreGameRef, StoreSnapshot } from '../src/core/schema';

const now = '2026-07-18T18:00:00.000Z';

function ref(
  store: 'steam' | 'gog',
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
  it('merges exact normalized titles across stores', () => {
    const steam = replaceStoreSnapshot(
      createDefaultState(),
      snapshot('steam', [ref('steam', '123', 'Baldur’s Gate 3')]),
    ).state;
    const merged = replaceStoreSnapshot(
      steam,
      snapshot('gog', [ref('gog', '456', "Baldur's Gate 3")]),
    ).state;

    expect(merged.games).toHaveLength(1);
    expect(merged.games[0]?.storeRefs.steam?.storeId).toBe('123');
    expect(merged.games[0]?.storeRefs.gog?.storeId).toBe('456');
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
  it('prefers provider ID and falls back to exact title', () => {
    const state = replaceStoreSnapshot(
      createDefaultState(),
      snapshot('gog', [ref('gog', '10', 'Disco Elysium')]),
    ).state;

    expect(findGameForPage(state, { store: 'gog', storeId: '10', title: 'wrong' })?.id).toBe(
      state.games[0]?.id,
    );
    expect(findGameForPage(state, { store: 'steam', title: 'Disco Elysium' })?.id).toBe(
      state.games[0]?.id,
    );
  });
});
