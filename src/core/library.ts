import { isMatchableTitle, normalizeTitle } from './normalize';
import {
  LibraryStateSchema,
  StoreSnapshotSchema,
  type CanonicalGame,
  type LibraryState,
  type Store,
  type StoreGameRef,
  type StoreSnapshot,
} from './schema';

export interface SnapshotMergeResult {
  state: LibraryState;
  added: number;
  matched: number;
  removed: number;
}

function hasUserAnnotations(game: CanonicalGame): boolean {
  return (
    game.ignored ||
    game.notes.length > 0 ||
    game.aliases.length > 0 ||
    game.launchPaths.length > 0 ||
    game.performance.length > 0
  );
}

function matchKeys(game: CanonicalGame): string[] {
  return [game.normalizedTitle, ...game.aliases.map(normalizeTitle)].filter(Boolean);
}

export function replaceStoreSnapshot(
  current: LibraryState,
  snapshotInput: StoreSnapshot,
): SnapshotMergeResult {
  const snapshot = StoreSnapshotSchema.parse(snapshotInput);
  const state = LibraryStateSchema.parse(structuredClone(current));
  const previousByStoreId = new Map<string, string>();
  const seenStoreIds = new Set<string>();

  for (const game of state.games) {
    const previous = game.storeRefs[snapshot.store];
    if (previous) previousByStoreId.set(previous.storeId, game.id);
    delete game.storeRefs[snapshot.store];
  }

  const byId = new Map(state.games.map((game) => [game.id, game]));
  let added = 0;
  let matched = 0;

  for (const ref of snapshot.refs) {
    if (ref.store !== snapshot.store) {
      throw new Error(`Snapshot for ${snapshot.store} contains a ${ref.store} reference`);
    }
    if (seenStoreIds.has(ref.storeId)) {
      throw new Error(`Duplicate ${snapshot.store} store ID: ${ref.storeId}`);
    }
    seenStoreIds.add(ref.storeId);

    let target = byId.get(previousByStoreId.get(ref.storeId) ?? '');
    const normalized = normalizeTitle(ref.title);

    if (!target && ref.titleStatus === 'resolved' && isMatchableTitle(ref.title)) {
      target = state.games.find(
        (game) =>
          !game.storeRefs[snapshot.store] && matchKeys(game).some((key) => key === normalized),
      );
    }

    if (target) {
      target.storeRefs[snapshot.store] = ref;
      if (
        target.displayTitle.startsWith('Steam app ') ||
        target.displayTitle.startsWith('GOG game ')
      ) {
        target.displayTitle = ref.title;
        target.normalizedTitle = normalized;
      }
      matched += 1;
      continue;
    }

    const game: CanonicalGame = {
      id: crypto.randomUUID(),
      displayTitle: ref.title,
      normalizedTitle: normalized,
      aliases: [],
      ignored: ref.ignoredAtSource,
      notes: '',
      storeRefs: { [snapshot.store]: ref },
      launchPaths: [],
      performance: [],
    };
    state.games.push(game);
    byId.set(game.id, game);
    added += 1;
  }

  const beforePrune = state.games.length;
  state.games = state.games.filter(
    (game) => Object.keys(game.storeRefs).length > 0 || hasUserAnnotations(game),
  );
  const removed = beforePrune - state.games.length;
  state.snapshots[snapshot.store] = {
    syncedAt: snapshot.syncedAt,
    gameCount: snapshot.refs.length,
    unresolvedCount: snapshot.refs.filter((ref) => ref.titleStatus === 'unresolved').length,
  };

  return { state: LibraryStateSchema.parse(state), added, matched, removed };
}

export interface PageCandidate {
  store: Store;
  storeId?: string;
  title: string;
}

export function findGameForPage(
  state: LibraryState,
  candidate: PageCandidate,
): CanonicalGame | undefined {
  if (candidate.storeId) {
    const byId = state.games.find(
      (game) => game.storeRefs[candidate.store]?.storeId === candidate.storeId,
    );
    if (byId) return byId;
  }

  if (!isMatchableTitle(candidate.title)) return undefined;
  const normalized = normalizeTitle(candidate.title);
  return state.games.find((game) => matchKeys(game).includes(normalized));
}

export function otherStore(store: Store): Store {
  return store === 'steam' ? 'gog' : 'steam';
}

export function countOwned(state: LibraryState, store: Store): number {
  return state.games.filter((game) => game.storeRefs[store]?.owned).length;
}

export function createStoreRef(store: Store, input: Omit<StoreGameRef, 'store'>): StoreGameRef {
  return { store, ...input };
}
