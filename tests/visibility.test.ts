import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/defaults';
import { decideVisibility } from '../src/core/visibility';
import type { CanonicalGame } from '../src/core/schema';

const game: CanonicalGame = {
  id: '00000000-0000-4000-8000-000000000001',
  displayTitle: 'Hades',
  normalizedTitle: 'hades',
  aliases: [],
  ignored: false,
  notes: '',
  launchPaths: [],
  performance: [],
  storeRefs: {
    gog: {
      store: 'gog',
      storeId: '1',
      title: 'Hades',
      titleStatus: 'resolved',
      owned: true,
      ignoredAtSource: false,
      importedAt: '2026-07-18T18:00:00.000Z',
    },
  },
};

describe('decideVisibility', () => {
  it('highlights cross-owned games by default', () => {
    expect(
      decideVisibility(game, { store: 'steam', title: 'Hades' }, DEFAULT_SETTINGS),
    ).toMatchObject({ hide: false, highlight: true, otherStoreOwned: true });
  });

  it('hides cross-owned games when enabled', () => {
    const settings = { ...DEFAULT_SETTINGS, hideOwnedOnOtherStore: true };
    expect(decideVisibility(game, { store: 'steam', title: 'Hades' }, settings)).toMatchObject({
      hide: true,
      reason: 'owned-on-other-store',
    });
  });

  it('prioritizes ignored state', () => {
    const ignored = { ...game, ignored: true };
    expect(
      decideVisibility(ignored, { store: 'steam', title: 'Hades' }, DEFAULT_SETTINGS),
    ).toMatchObject({ hide: true, reason: 'ignored' });
  });

  it('does not hide or highlight from an unresolved Steam ref with an old canonical title', () => {
    const uncertain = structuredClone(game);
    uncertain.storeRefs.steam = {
      ...uncertain.storeRefs.gog!,
      store: 'steam',
      storeId: '10',
      title: 'Steam app 10',
      titleStatus: 'unresolved',
    };
    expect(
      decideVisibility(
        uncertain,
        { store: 'gog', title: 'Hades' },
        {
          ...DEFAULT_SETTINGS,
          hideOwnedOnOtherStore: true,
        },
      ),
    ).toEqual({ hide: false, highlight: false, otherStoreOwned: false });
  });

  it.each(['epic', 'amazon', 'battlenet'] as const)(
    'uses confirmed ownership on %s when browsing Steam',
    (store) => {
      const other = structuredClone(game);
      const ref = other.storeRefs.gog!;
      delete other.storeRefs.gog;
      other.storeRefs[store] = { ...ref, store };
      expect(
        decideVisibility(
          other,
          { store: 'steam', title: 'Hades' },
          { ...DEFAULT_SETTINGS, hideOwnedOnOtherStore: true },
        ),
      ).toMatchObject({ hide: true, otherStoreOwned: true });
      other.storeRefs[store].titleStatus = 'unresolved';
      expect(
        decideVisibility(
          other,
          { store: 'steam', title: 'Hades' },
          { ...DEFAULT_SETTINGS, hideOwnedOnOtherStore: true },
        ),
      ).toMatchObject({ hide: false, highlight: false, otherStoreOwned: false });
    },
  );
});
