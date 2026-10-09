import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../src/core/defaults';
import { exportLibrary, importLibrary } from '../src/core/backup';
import {
  countOwned,
  findGameForPage,
  ownedOnOtherStores,
  replaceStoreSnapshot,
} from '../src/core/library';
import { migrateLibraryState } from '../src/core/migration';
import { classifyRef, countProducts, groupLibrary, refKind } from '../src/core/products';
import type { Store, StoreGameRef } from '../src/core/schema';

const time = '2026-10-08T17:00:00.000Z';
function ref(id: string, title: string, store: Store = 'steam', resolved = true): StoreGameRef {
  return {
    store,
    storeId: id,
    title,
    titleStatus: resolved ? 'resolved' : 'unresolved',
    owned: true,
    ignoredAtSource: false,
    importedAt: time,
  };
}
function capture(refs: StoreGameRef[]) {
  return replaceStoreSnapshot(createDefaultState(), { store: 'steam', syncedAt: time, refs }).state;
}

describe('product identity and ownership', () => {
  it('does not count an unresolved record as a game even if a caller supplies that kind', () => {
    const record = ref('991', 'Steam app 991', 'steam', false);
    record.classification = {
      kind: 'game',
      source: 'store-metadata',
      confidence: 'primary',
      evidenceUrls: ['https://store.steampowered.com/app/991/'],
    };
    expect(countProducts(capture([record]))).toMatchObject({ game: 0, unknown: 1 });
  });
  it('counts RetroArch as a tool using the publisher description even when Steam calls it a game', () => {
    const state = capture([ref('1118310', 'RetroArch')]);
    expect(countProducts(state)).toMatchObject({ game: 0, tool: 1, records: 1 });
    expect(ownedOnOtherStores(state.games[0]!, 'gog')).toEqual([]);
    expect(state.games[0]?.storeRefs.steam?.classification).toMatchObject({
      source: 'reviewed-rule',
      confidence: 'primary',
      evidenceUrls: ['https://store.steampowered.com/app/1118310/RetroArch/'],
    });
  });
  it.each([
    ['520', '440', 'Team Fortress 2'],
    ['350470', '379720', 'DOOM'],
    ['223060', '200170', 'Worms Revolution'],
  ])('groups component %s only through its reviewed parent ID %s', (id, parent, title) => {
    const state = capture([ref(id, `Steam app ${id}`, 'steam', false), ref(parent, title)]);
    const groups = groupLibrary(state);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary?.storeRefs.steam?.storeId).toBe(parent);
    expect(groups[0]?.components[0]?.storeRefs.steam).toMatchObject({
      storeId: id,
      title: `Steam app ${id}`,
      titleStatus: 'unresolved',
      owned: true,
    });
    expect(countOwned(state, 'steam')).toBe(1);
    expect(countProducts(state)).toMatchObject({ game: 1, component: 1, records: 2 });
    expect(groupLibrary(state, id, 'component')).toHaveLength(1);
    expect(groupLibrary(state, '', 'game')[0]?.components).toHaveLength(0);
  });

  it('does not create or claim base ownership when only its beta is owned', () => {
    const state = capture([ref('350470', 'Steam app 350470', 'steam', false)]);
    expect(state.games).toHaveLength(1);
    expect(groupLibrary(state)[0]).toMatchObject({ title: 'DOOM', components: [state.games[0]] });
    expect(groupLibrary(state)[0]?.primary).toBeUndefined();
    expect(countOwned(state, 'steam')).toBe(0);
    expect(
      findGameForPage(state, { store: 'steam', storeId: '379720', title: 'DOOM' }),
    ).toBeUndefined();
    expect(ownedOnOtherStores(state.games[0]!, 'gog')).toEqual([]);
  });

  it('deduplicates the parent across stores while retaining every component ID', () => {
    const steam = capture([ref('379720', 'DOOM'), ref('350470', 'DOOM Open Beta')]);
    const state = replaceStoreSnapshot(steam, {
      store: 'gog',
      syncedAt: time,
      refs: [ref('42', 'DOOM', 'gog')],
    }).state;
    expect(state.games).toHaveLength(2);
    expect(countProducts(state).game).toBe(1);
    expect(groupLibrary(state)[0]?.components).toHaveLength(1);
    expect(
      ownedOnOtherStores(
        state.games.find((game) => game.storeRefs.steam?.storeId === '350470')!,
        'gog',
      ),
    ).toEqual([]);
    expect(
      findGameForPage(state, { store: 'steam', storeId: '520', title: 'DOOM' }),
    ).toBeUndefined();
  });

  it('never guesses a beta/mode from a title or an unknown parent from package context', () => {
    const state = capture([
      ref('991', 'A Game Beta'),
      ref('992', 'A Game'),
      ref('478730', 'Steam app 478730', 'steam', false),
      ref('231740', 'Knights of Pen and Paper'),
    ]);
    expect(countProducts(state)).toMatchObject({ game: 3, unknown: 1 });
    expect(groupLibrary(state)).toHaveLength(4);
    for (const id of ['478730', '550502', '849500', '3575130', '3575160', '3575340'])
      expect(refKind(classifyRef(ref(id, `Steam app ${id}`, 'steam', false)))).toBe('unknown');
  });

  it('labels supported community markers without confirming their name or a parent game', () => {
    const state = capture([ref('944280', 'Steam app 944280', 'steam', false)]);
    const entry = state.games[0]!.storeRefs.steam!;
    expect(entry).toMatchObject({
      storeId: '944280',
      titleStatus: 'unresolved',
      classification: {
        kind: 'auxiliary',
        source: 'community-rule',
        confidence: 'community',
        evidenceUrls: ['https://barter.vg/i/83118/json/'],
      },
    });
    expect(entry.classification?.parent).toBeUndefined();
    expect(countProducts(state)).toMatchObject({ game: 0, auxiliary: 1 });
  });

  it('keeps unconfirmed Dota/localization/emulator associations separate', () => {
    for (const id of ['503590', '407270', '1222636', '1227462', '1227466', '1227469']) {
      const entry = classifyRef(ref(id, `Steam app ${id}`, 'steam', false));
      expect(refKind(entry)).toBe('component');
      expect(entry.classification?.parent).toBeUndefined();
      expect(entry.titleStatus).toBe('unresolved');
    }
  });

  it('migrates v4 on a copy, preserves annotations/provenance, and round-trips a backup', () => {
    const legacy = capture([ref('350470', 'Steam app 350470', 'steam', false)]);
    const entry = legacy.games[0]!;
    entry.notes = 'My note';
    entry.aliases = ['Reviewed alias'];
    entry.ignored = true;
    delete entry.storeRefs.steam!.classification;
    const input = { ...legacy, version: 4 };
    const before = structuredClone(input);
    const state = migrateLibraryState(input)!;
    expect(input).toEqual(before);
    expect(state.version).toBe(5);
    expect(state.games[0]).toMatchObject({
      id: entry.id,
      notes: 'My note',
      aliases: ['Reviewed alias'],
      ignored: true,
    });
    expect(state.games[0]?.storeRefs.steam).toMatchObject({
      storeId: '350470',
      importedAt: time,
      owned: true,
      titleStatus: 'unresolved',
    });
    expect(importLibrary(exportLibrary(state))).toEqual(state);
    expect(migrateLibraryState(state)).toEqual(state);
  });

  it('splits a legacy false title merge without losing the primary identity or annotations', () => {
    const state = capture([ref('379720', 'DOOM')]);
    const game = state.games[0]!;
    game.notes = 'Keep note';
    game.storeRefs.gog = ref('42', 'DOOM', 'gog');
    game.storeRefs.steam = ref('350470', 'DOOM');
    const migrated = migrateLibraryState({ ...state, version: 4 })!;
    expect(migrated.games).toHaveLength(2);
    expect(migrated.games[0]).toMatchObject({
      id: game.id,
      notes: 'Keep note',
      storeRefs: { gog: { storeId: '42' } },
    });
    expect(migrated.games[0]?.storeRefs.steam).toBeUndefined();
    expect(countOwned(migrated, 'steam')).toBe(0);
    expect(ownedOnOtherStores(migrated.games[1]!, 'gog')).toEqual([]);
    expect(importLibrary(exportLibrary(migrated))).toEqual(migrated);
  });

  it('rejects future backup schemas and duplicate IDs', () => {
    const state = capture([ref('379720', 'DOOM')]);
    state.games.push(structuredClone(state.games[0]!));
    expect(() => importLibrary(exportLibrary(state))).toThrow(/Duplicate/u);
    expect(() =>
      importLibrary(
        JSON.stringify({ format: 'gaming-library-helper', version: 1, state: { version: 99 } }),
      ),
    ).toThrow(/Unsupported/u);
  });
});
