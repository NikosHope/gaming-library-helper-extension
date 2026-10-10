import { normalizeTitle } from './normalize';
import { catalogKey, editionRoot, projectLibrary } from './reconciliation';
import { storeUrlKey } from './store-url';
import { productIgnoreIndex } from './annotations';
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

    const target = byId.get(previousByStoreId.get(ref.storeId) ?? '');
    const normalized = normalizeTitle(ref.title);

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
  url?: string;
}

/** Build once per page refresh; no title search can assert cross-store ownership. */
export function createPageLibrary(state: LibraryState): Map<string, CanonicalGame> {
  const ignored = productIgnoreIndex(state);
  const index = new Map<string, CanonicalGame>();
  const refs = new Map<string, StoreGameRef>();
  const sources = new Map(state.games.map((game) => [game.id, game]));
  for (const game of state.games)
    for (const ref of Object.values(game.storeRefs)) {
      const key = `${ref.store}:${ref.storeId}`;
      refs.set(key, ref);
      index.set(key, {
        ...game,
        ignored: ignored.get(key) ?? false,
        storeRefs: { [ref.store]: ref },
      });
      const urlKey = storeUrlKey(ref.url);
      if (urlKey?.startsWith(`${ref.store}:`)) {
        index.set(`url:${urlKey}`, index.get(key)!);
        refs.set(`url:${urlKey}`, ref);
      }
    }
  const recordIndex = new Map(
    state.registry.records.map((record) => [catalogKey(record.identity), record]),
  );
  // Candidate metadata can be inspected without changing browsing identity before acceptance.
  const acceptedRecords = new Set<string>();
  const pendingRecords = state.registry.matches.map((match) => catalogKey(match.catalog));
  while (pendingRecords.length) {
    const key = pendingRecords.pop()!;
    if (acceptedRecords.has(key)) continue;
    acceptedRecords.add(key);
    const record = recordIndex.get(key);
    for (const parent of [record?.versionParent, record?.parent])
      if (parent) pendingRecords.push(catalogKey(parent));
  }
  const matches = new Map<string, typeof state.registry.matches>();
  for (const match of state.registry.matches) {
    const key = `${match.store}:${match.storeId}`;
    const list = matches.get(key) ?? [];
    list.push(match);
    matches.set(key, list);
  }
  const rootGroups = new Map<string, Set<CanonicalGame>>();
  const candidates = new Map<string, Set<CanonicalGame>>();
  const add = (map: Map<string, Set<CanonicalGame>>, key: string, game: CanonicalGame) => {
    const values = map.get(key) ?? new Set<CanonicalGame>();
    values.add(game);
    map.set(key, values);
  };
  const projection = projectLibrary(state);
  const confirmed = new Set(
    projection.games.flatMap((game) =>
      game.products.map((item) => `${item.footprint.store}:${item.footprint.storeId}`),
    ),
  );
  for (const game of projection.games) {
    const source = sources.get(game.sourceRecordIds[0]!);
    if (!source) continue;
    const storeRefs: CanonicalGame['storeRefs'] = {};
    for (const item of game.products) {
      const key = `${item.footprint.store}:${item.footprint.storeId}`;
      const ref = refs.get(key);
      if (ref && !storeRefs[ref.store])
        storeRefs[ref.store] = {
          ...ref,
          titleStatus: 'resolved',
          classification: {
            kind: 'game',
            source: 'reviewed-rule',
            confidence: 'primary',
            evidenceUrls: [item.record!.url],
          },
        };
    }
    const view = {
      ...source,
      displayTitle: game.title,
      ignored: game.products.some((item) =>
        ignored.get(`${item.footprint.store}:${item.footprint.storeId}`),
      ),
      storeRefs,
    };
    add(rootGroups, game.key, view);
    for (const product of game.products) {
      const key = `${product.footprint.store}:${product.footprint.storeId}`;
      add(candidates, key, view);
      const urlKey = storeUrlKey(refs.get(key)?.url);
      if (urlKey?.startsWith(`${product.footprint.store}:`)) {
        add(candidates, `url:${urlKey}`, view);
        confirmed.add(`url:${urlKey}`);
      }
      for (const match of matches.get(key) ?? []) {
        const root = editionRoot(match.catalog, state.registry, recordIndex);
        if (root) add(rootGroups, catalogKey(root.identity), view);
      }
    }
  }
  for (const record of state.registry.records) {
    if (!acceptedRecords.has(catalogKey(record.identity))) continue;
    const root = editionRoot(record.identity, state.registry, recordIndex);
    if (!root) continue;
    for (const game of rootGroups.get(catalogKey(root.identity)) ?? [])
      for (const ref of record.externalRefs) {
        add(candidates, `${ref.store}:${ref.storeId}`, game);
        const urlKey = storeUrlKey(ref.url);
        if (urlKey?.startsWith(`${ref.store}:`)) add(candidates, `url:${urlKey}`, game);
      }
  }
  for (const [key, games] of candidates)
    if (games.size === 1) {
      const own = refs.get(key);
      // A source product classified outside Library cannot gain identity via neighbours.
      if (own && !confirmed.has(key)) continue;
      index.set(key, [...games][0]!);
    }
  return index;
}
export function findGameForPage(
  state: LibraryState,
  candidate: PageCandidate,
  index = createPageLibrary(state),
): CanonicalGame | undefined {
  if (!candidate.storeId && !candidate.url) return undefined;
  const kind = candidate.storeId ? reviewedKind(candidate.store, candidate.storeId) : undefined;
  if (kind && kind !== 'game') return undefined;
  const byId = candidate.storeId ? index.get(`${candidate.store}:${candidate.storeId}`) : undefined;
  const urlKey = storeUrlKey(candidate.url);
  const byUrl = urlKey?.startsWith(`${candidate.store}:`) ? index.get(`url:${urlKey}`) : undefined;
  if (byId && byUrl && byId !== byUrl) return undefined;
  return byId ?? byUrl;
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
