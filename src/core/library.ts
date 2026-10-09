import { isMatchableTitle, normalizeTitle } from './normalize';
import { classifyRef, isPrimaryRef, reviewedKind, separateProductKinds } from './products';
import {
  LibraryStateSchema,
  StoreSnapshotSchema,
  StoreSchema,
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
  const previousTime = current.snapshots[snapshot.store]?.syncedAt;
  if (previousTime && Date.parse(snapshot.syncedAt) < Date.parse(previousTime)) {
    throw new Error(
      'A newer snapshot has already been saved. Retry; the previous library is unchanged.',
    );
  }
  const state = LibraryStateSchema.parse(structuredClone(current));
  const previousByStoreId = new Map<string, string>();
  const previousRefs = new Map<string, StoreGameRef>();
  const seenStoreIds = new Set<string>();

  for (const game of state.games) {
    const previous = game.storeRefs[snapshot.store];
    if (previous) {
      previousByStoreId.set(previous.storeId, game.id);
      previousRefs.set(previous.storeId, previous);
    }
    delete game.storeRefs[snapshot.store];
  }

  const byId = new Map(state.games.map((game) => [game.id, game]));
  let added = 0;
  let matched = 0;

  for (const inputRef of snapshot.refs) {
    const ref = classifyRef(inputRef);
    if (ref.store !== snapshot.store) {
      throw new Error(`Snapshot for ${snapshot.store} contains a ${ref.store} reference`);
    }
    if (seenStoreIds.has(ref.storeId)) {
      throw new Error(`Duplicate ${snapshot.store} store ID: ${ref.storeId}`);
    }
    seenStoreIds.add(ref.storeId);

    let target = byId.get(previousByStoreId.get(ref.storeId) ?? '');
    const normalized = normalizeTitle(ref.title);

    if (!target && isPrimaryRef(ref) && isMatchableTitle(ref.title)) {
      target = state.games.find(
        (game) =>
          !game.storeRefs[snapshot.store] &&
          Object.values(game.storeRefs).some(isPrimaryRef) &&
          matchKeys(game).some((key) => key === normalized),
      );
    }

    if (target) {
      target.storeRefs[snapshot.store] = ref;
      const previousRef = previousRefs.get(ref.storeId);
      if (
        previousRef?.titleStatus === 'unresolved' &&
        ref.titleStatus === 'resolved' &&
        target.displayTitle === previousRef.title
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

  return { state: LibraryStateSchema.parse(separateProductKinds(state)), added, matched, removed };
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
    const kind = reviewedKind(candidate.store, candidate.storeId);
    if (kind && kind !== 'game') return undefined;
  }

  if (!isMatchableTitle(candidate.title)) return undefined;
  const normalized = normalizeTitle(candidate.title);
  return state.games.find(
    (game) =>
      Object.values(game.storeRefs).some(isPrimaryRef) && matchKeys(game).includes(normalized),
  );
}

export function ownedOnOtherStores(game: CanonicalGame, store: Store): Store[] {
  return StoreSchema.options.filter(
    (other) =>
      other !== store && game.storeRefs[other]?.owned && isPrimaryRef(game.storeRefs[other]),
  );
}

export function countOwned(state: LibraryState, store: Store): number {
  return state.games.filter(
    (game) => game.storeRefs[store]?.owned && isPrimaryRef(game.storeRefs[store]),
  ).length;
}

export function createStoreRef(store: Store, input: Omit<StoreGameRef, 'store'>): StoreGameRef {
  return { store, ...input };
}
