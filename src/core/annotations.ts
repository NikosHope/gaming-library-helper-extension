import type { LibraryState, Store } from './schema';

export interface StoreProduct {
  store: Store;
  storeId: string;
}
const key = (product: StoreProduct) => `${product.store}:${product.storeId}`;
export function isProductIgnored(state: LibraryState, product: StoreProduct): boolean {
  const override = state.productAnnotations.find((entry) => key(entry) === key(product));
  return (
    override?.ignored ??
    state.games.some(
      (game) =>
        game.ignored && Object.values(game.storeRefs).some((ref) => key(ref) === key(product)),
    )
  );
}
export function productIgnoreIndex(state: LibraryState): Map<string, boolean> {
  const index = new Map<string, boolean>();
  for (const game of state.games)
    for (const ref of Object.values(game.storeRefs))
      index.set(key(ref), (index.get(key(ref)) ?? false) || game.ignored);
  for (const annotation of state.productAnnotations) index.set(key(annotation), annotation.ignored);
  return index;
}
/** Keep legacy UUID annotations intact, even if one old container projects to different games. */
export function setIgnoredProducts(
  state: LibraryState,
  products: StoreProduct[],
  ignored: boolean,
): LibraryState {
  const selected = new Set(products.map(key));
  const known = new Set(
    state.games.flatMap((game) =>
      Object.values(game.storeRefs)
        .filter((ref) => ref.owned)
        .map(key),
    ),
  );
  if (
    !selected.size ||
    selected.size !== products.length ||
    products.some((product) => !known.has(key(product)))
  )
    throw new Error('Selected products changed. Refresh the library and retry.');
  const annotations = new Map(state.productAnnotations.map((entry) => [key(entry), entry]));
  for (const product of products) annotations.set(key(product), { ...product, ignored });
  return {
    ...state,
    productAnnotations: [...annotations.values()].sort((a, b) =>
      key(a).localeCompare(key(b), 'en-US'),
    ),
  };
}

/** Change annotations on existing UUIDs in one atomic library update. */
export function setIgnoredRecords(
  state: LibraryState,
  ids: string[],
  ignored: boolean,
): LibraryState {
  const selected = new Set(ids);
  const known = new Set(state.games.map((game) => game.id));
  if (!selected.size || selected.size !== ids.length || ids.some((id) => !known.has(id)))
    throw new Error('Selected source records changed. Refresh the library and retry.');
  return {
    ...state,
    games: state.games.map((game) => (selected.has(game.id) ? { ...game, ignored } : game)),
  };
}
