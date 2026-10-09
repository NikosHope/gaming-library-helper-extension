import type {
  CanonicalGame,
  LibraryState,
  ProductClassification,
  ProductKind,
  Store,
  StoreGameRef,
} from './schema';
import { normalizeTitle } from './normalize';

// Curated identities, never title regexes or package-neighbour guesses. See docs/product-model.md.
const reviewed: Readonly<
  Record<string, Omit<ProductClassification, 'source' | 'evidenceUrls' | 'confidence'>>
> = {
  '1118310': { kind: 'tool', label: 'RetroArch' },
  '520': {
    kind: 'component',
    componentType: 'beta',
    label: 'Team Fortress 2 Beta',
    parent: {
      store: 'steam',
      storeId: '440',
      title: 'Team Fortress 2',
      evidenceUrl: 'https://www.teamfortress.com/post.php?id=4721',
    },
  },
  '350470': {
    kind: 'component',
    componentType: 'beta',
    label: 'DOOM Open Beta',
    parent: {
      store: 'steam',
      storeId: '379720',
      title: 'DOOM',
      evidenceUrl: 'https://store.steampowered.com/oldnews/21368',
    },
  },
  '223060': {
    kind: 'component',
    componentType: 'mode',
    label: 'Worms Revolution - Single Player Access',
    parent: {
      store: 'steam',
      storeId: '200170',
      title: 'Worms Revolution',
      evidenceUrl: 'https://steamcommunity.com/app/200170/discussions/0/810922320185960359/',
    },
  },
  '407270': {
    kind: 'component',
    componentType: 'localization',
    label: 'Pillars of Eternity - The White March Korean Localization',
  },
  '503590': { kind: 'component', componentType: 'dlc', label: 'Dota VR' },
  '1222636': { kind: 'component', componentType: 'core', label: 'Play!' },
  '1227462': { kind: 'component', componentType: 'core', label: 'Game Music Emu' },
  '1227466': { kind: 'component', componentType: 'core', label: 'VBA Next' },
  '1227469': { kind: 'component', componentType: 'core', label: 'Tyrquake' },
  '2130210': { kind: 'tool', label: 'Steam Mobile App' },
};

const communityMarkers: Readonly<Record<string, string>> = {
  '944280': 'https://barter.vg/i/83118/json/',
  '947020': 'https://barter.vg/i/80610/json/',
  '947180': 'https://barter.vg/i/80612/json/',
  '947220': 'https://barter.vg/i/80613/json/',
  '2473901': 'https://barter.vg/i/349427/json/',
};

export function reviewedKind(store: Store, id: string): ProductKind | undefined {
  return store === 'steam' ? (communityMarkers[id] ? 'auxiliary' : reviewed[id]?.kind) : undefined;
}

export function classifyRef(ref: StoreGameRef): StoreGameRef {
  const marker = ref.store === 'steam' ? communityMarkers[ref.storeId] : undefined;
  if (marker)
    return {
      ...ref,
      classification: {
        kind: 'auxiliary',
        label: 'Package marker (community evidence)',
        source: 'community-rule',
        confidence: 'community',
        evidenceUrls: [marker],
      },
    };
  const rule = ref.store === 'steam' ? reviewed[ref.storeId] : undefined;
  if (!rule) return ref;
  return {
    ...ref,
    classification: {
      ...rule,
      source: 'reviewed-rule',
      confidence: rule.parent || ref.storeId === '1118310' ? 'primary' : 'community',
      evidenceUrls: [
        ref.storeId === '1118310'
          ? 'https://store.steampowered.com/app/1118310/RetroArch/'
          : `https://steamdb.info/app/${ref.storeId}/`,
        ...(rule.parent ? [rule.parent.evidenceUrl] : []),
      ],
    },
  };
}

export function refKind(ref: StoreGameRef): ProductKind {
  const kind = ref.classification?.kind ?? (ref.titleStatus === 'resolved' ? 'game' : 'unknown');
  return kind === 'game' && ref.titleStatus === 'unresolved' ? 'unknown' : kind;
}

export function isPrimaryRef(ref: StoreGameRef): boolean {
  return refKind(ref) === 'game' && ref.titleStatus === 'resolved';
}

/** Undo legacy cross-store title matches between a game and a component, preserving notes. */
export function separateProductKinds(state: LibraryState): LibraryState {
  const games: CanonicalGame[] = [];
  for (const game of state.games) {
    const refs = Object.values(game.storeRefs);
    const primary = refs.filter(isPrimaryRef);
    const other = refs.filter((ref) => !isPrimaryRef(ref));
    if (!primary.length || !other.length) {
      games.push(game);
      continue;
    }
    games.push({ ...game, storeRefs: Object.fromEntries(primary.map((ref) => [ref.store, ref])) });
    for (const ref of other)
      games.push({
        id: crypto.randomUUID(),
        displayTitle: ref.title,
        normalizedTitle: normalizeTitle(ref.title),
        aliases: [],
        ignored: ref.ignoredAtSource,
        notes: '',
        storeRefs: { [ref.store]: ref },
        launchPaths: [],
        performance: [],
      });
  }
  return { ...state, games };
}

export function gameKind(game: CanonicalGame): ProductKind {
  const refs = Object.values(game.storeRefs);
  return refs.some(isPrimaryRef) ? 'game' : (refs.map(refKind)[0] ?? 'unknown');
}

export function productTitle(game: CanonicalGame): string {
  return (
    Object.values(game.storeRefs).find((ref) => ref.classification?.label)?.classification?.label ??
    game.displayTitle
  );
}

export interface LibraryGroup {
  key: string;
  title: string;
  primary?: CanonicalGame;
  components: CanonicalGame[];
  kind: ProductKind;
}

/** A missing parent is a presentation header only: it has no canonical ID or ownership. */
export function groupLibrary(state: LibraryState, query = '', kind?: ProductKind): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();
  const primaryByRef = new Map<string, CanonicalGame>();
  for (const game of state.games) {
    for (const ref of Object.values(game.storeRefs)) {
      if (isPrimaryRef(ref)) primaryByRef.set(`${ref.store}:${ref.storeId}`, game);
    }
  }
  for (const game of state.games) {
    const parent =
      gameKind(game) === 'component'
        ? Object.values(game.storeRefs).find((ref) => ref.classification?.parent)?.classification
            ?.parent
        : undefined;
    if (parent) {
      const primary = primaryByRef.get(`${parent.store}:${parent.storeId}`);
      const key = primary?.id ?? `parent:${parent.store}:${parent.storeId}`;
      const group = groups.get(key) ?? {
        key,
        title: primary ? productTitle(primary) : parent.title,
        ...(primary ? { primary } : {}),
        components: [],
        kind: 'game' as const,
      };
      group.components.push(game);
      groups.set(key, group);
    } else {
      const existing = groups.get(game.id);
      groups.set(game.id, {
        key: game.id,
        title: productTitle(game),
        primary: game,
        components: existing?.components ?? [],
        kind: gameKind(game),
      });
    }
  }
  const needle = query.trim().toLocaleLowerCase();
  const matches = (game: CanonicalGame) =>
    [
      productTitle(game),
      game.displayTitle,
      ...Object.values(game.storeRefs).flatMap((ref) => [ref.title, ref.storeId]),
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  return [...groups.values()]
    .map((group) => ({
      ...group,
      components: group.components.filter(
        (game) =>
          (!kind || gameKind(game) === kind) &&
          (matches(game) || group.title.toLocaleLowerCase().includes(needle)),
      ),
    }))
    .filter((group) => {
      const records = [...(group.primary ? [group.primary] : []), ...group.components];
      return records.some(
        (game) =>
          (!kind || gameKind(game) === kind) &&
          (matches(game) || group.title.toLocaleLowerCase().includes(needle)),
      );
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function countProducts(
  state: LibraryState,
  store?: Store,
): Record<ProductKind, number> & { records: number } {
  const counts = { game: 0, component: 0, tool: 0, auxiliary: 0, unknown: 0, records: 0 };
  for (const game of state.games) {
    const refs = store
      ? [game.storeRefs[store]].filter((ref): ref is StoreGameRef => Boolean(ref?.owned))
      : Object.values(game.storeRefs).filter((ref) => ref.owned);
    if (!refs.length) continue;
    const kind = refs.some(isPrimaryRef) ? 'game' : refKind(refs[0]!);
    counts[kind] += 1;
    counts.records += 1;
  }
  return counts;
}
