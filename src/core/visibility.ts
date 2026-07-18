import { otherStore, type PageCandidate } from './library';
import type { CanonicalGame, Settings } from './schema';

export interface VisibilityDecision {
  hide: boolean;
  reason?: 'ignored' | 'owned-on-other-store';
  highlight: boolean;
  otherStoreOwned: boolean;
}

export function decideVisibility(
  game: CanonicalGame | undefined,
  candidate: PageCandidate,
  settings: Settings,
): VisibilityDecision {
  if (!game) return { hide: false, highlight: false, otherStoreOwned: false };

  const opposite = otherStore(candidate.store);
  const otherStoreOwned = Boolean(game.storeRefs[opposite]?.owned);
  const ignored = game.ignored || Boolean(game.storeRefs[candidate.store]?.ignoredAtSource);

  if (ignored && settings.hideIgnored) {
    return { hide: true, reason: 'ignored', highlight: false, otherStoreOwned };
  }
  if (otherStoreOwned && settings.hideOwnedOnOtherStore) {
    return { hide: true, reason: 'owned-on-other-store', highlight: false, otherStoreOwned };
  }
  return {
    hide: false,
    highlight: otherStoreOwned && settings.highlightOwnedOnOtherStore,
    otherStoreOwned,
  };
}
