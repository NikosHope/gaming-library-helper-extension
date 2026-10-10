import type { LibraryState, StoreGameRef, ProductKind } from './schema';
import { LibraryStateSchema } from './schema';
import { refKind } from './products';
import { storeUrlKey } from './store-url';
import {
  AcceptedResultSchema,
  InputSnapshotSchema,
  RegistrySchema,
  FootprintSchema,
  PublicEvidenceUrlSchema,
  type AcceptedResult,
  type CatalogIdentity,
  type CatalogRecord,
  type Footprint,
  type InputSnapshot,
  type Registry,
} from './reconciliation-schema';

export const productKey = (item: { store: string; storeId: string }): string =>
  `${item.store}:${item.storeId}`;
export const catalogKey = (item: CatalogIdentity): string => `${item.provider}:${item.id}`;
export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function publicProductUrl(ref: StoreGameRef): string | undefined {
  if (!ref.url) return undefined;
  const checked = PublicEvidenceUrlSchema.safeParse(ref.url);
  if (!checked.success) return undefined;
  const url = new URL(checked.data);
  const locator = storeUrlKey(ref.url);
  const accepted =
    locator?.startsWith(`${ref.store}:`) && (ref.store !== 'steam' || locator === productKey(ref));
  return accepted ? url.origin + url.pathname.replace(/\/$/u, '') : undefined;
}
export function sourceFootprints(state: LibraryState): Footprint[] {
  return state.games
    .flatMap((game) =>
      Object.values(game.storeRefs)
        .filter((ref) => ref.owned)
        .map((ref) => {
          const evidenceUrls =
            ref.classification?.evidenceUrls.filter(
              (url) => PublicEvidenceUrlSchema.safeParse(url).success,
            ) ?? [];
          const classification =
            ref.classification && evidenceUrls.length
              ? structuredClone({ ...ref.classification, evidenceUrls })
              : undefined;
          if (
            classification?.parent &&
            !PublicEvidenceUrlSchema.safeParse(classification.parent.evidenceUrl).success
          )
            delete classification.parent;
          const publicUrl = publicProductUrl(ref);
          return FootprintSchema.parse({
            store: ref.store,
            storeId: ref.storeId,
            title: ref.title,
            titleStatus: ref.titleStatus,
            observedAt: ref.importedAt,
            // A resolved title alone says nothing about whether this is a playable product.
            kind: classification ? refKind(ref) : 'unknown',
            ...(classification ? { classification } : {}),
            ...(ref.sourceType ? { sourceType: ref.sourceType } : {}),
            ...(publicUrl ? { publicUrl } : {}),
          });
        }),
    )
    .sort((left, right) => productKey(left).localeCompare(productKey(right), 'en-US'));
}
export async function createInputSnapshot(
  state: LibraryState,
  createdAt = new Date().toISOString(),
): Promise<InputSnapshot> {
  const products = sourceFootprints(state);
  return InputSnapshotSchema.parse({
    version: 1,
    createdAt,
    inputHash: await contentHash(products),
    products,
  });
}
export async function verifyInputSnapshot(value: unknown): Promise<InputSnapshot> {
  const snapshot = InputSnapshotSchema.parse(value);
  if (snapshot.inputHash !== (await contentHash(snapshot.products)))
    throw new Error('Snapshot content hash does not match its footprints');
  return snapshot;
}
function recordIndex(registry: Registry): Map<string, CatalogRecord> {
  return new Map(registry.records.map((record) => [catalogKey(record.identity), record]));
}
export function editionRoot(
  identity: CatalogIdentity,
  registry: Registry,
  index = recordIndex(registry),
): CatalogRecord | undefined {
  const seen = new Set<string>();
  let record = index.get(catalogKey(identity));
  while (record?.kind === 'edition') {
    const key = catalogKey(record.identity);
    if (seen.has(key)) return undefined;
    seen.add(key);
    if (!record.versionParent) return undefined;
    record = index.get(catalogKey(record.versionParent));
  }
  return record;
}
export function independentlyPlayable(record: CatalogRecord): boolean {
  if (['game', 'standalone-expansion', 'remake', 'remaster'].includes(record.kind))
    return record.dependency === 'none';
  return (
    record.kind === 'mod' &&
    ['none', 'free-engine'].includes(record.dependency) &&
    record.independenceEvidence.length > 0
  );
}
export function validateRegistry(value: unknown): Registry {
  const registry = RegistrySchema.parse(value);
  const keys = registry.records.map((record) => catalogKey(record.identity));
  if (new Set(keys).size !== keys.length)
    throw new Error('Conflicting or duplicate catalog records');
  const index = recordIndex(registry);
  const matches = new Set<string>();
  for (const match of registry.matches) {
    const record = index.get(catalogKey(match.catalog));
    if (!record) throw new Error('Catalog match references a missing record');
    const unique = `${productKey(match)}:${catalogKey(match.catalog)}`;
    if (matches.has(unique)) throw new Error('Duplicate catalog match');
    matches.add(unique);
    if (
      match.method !== 'human-review' &&
      !record.externalRefs.some((ref) => productKey(ref) === productKey(match))
    )
      throw new Error('Automatic match has no exact external identity');
    if (
      match.method === 'human-review' &&
      !registry.reviews.some(
        (review) =>
          review.reviewId === match.reviewId &&
          productKey(review) === productKey(match) &&
          catalogKey(review.catalog) === catalogKey(match.catalog),
      )
    )
      throw new Error('Human confirmation is missing from the review ledger');
  }
  for (const record of registry.records) {
    if (record.versionParent && !editionRoot(record.identity, registry, index))
      throw new Error('Edition parent is missing or cyclic');
    if (record.parent && !index.has(catalogKey(record.parent)))
      throw new Error('Catalog parent is missing');
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error('Catalog relationships are cyclic');
    if (visited.has(key)) return;
    visiting.add(key);
    const record = index.get(key);
    for (const parent of [record?.parent, record?.versionParent])
      if (parent) visit(catalogKey(parent));
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of keys) visit(key);
  return registry;
}
export async function applyAcceptedResult(
  state: LibraryState,
  value: unknown,
): Promise<LibraryState> {
  const result = AcceptedResultSchema.parse(value);
  if (result.inputHash !== (await createInputSnapshot(state)).inputHash)
    throw new Error(
      'Reconciliation result is stale. Collect the current snapshot; the last registry is unchanged.',
    );
  const registry = validateRegistry(result.registry);
  if (registry.reviews.some((review) => review.inputHash !== result.inputHash))
    throw new Error('Review receipt belongs to a different snapshot');
  return LibraryStateSchema.parse({ ...state, registry });
}
export type ProductRole = ProductKind | 'bundle-related' | 'edition-or-component';
export interface ProductDisposition {
  footprint: Footprint;
  role: ProductRole;
  reason: string;
  inferred: boolean;
  family?: string;
  record?: CatalogRecord;
  relatedFamilies: string[];
  packageIds: string[];
}
interface ReconciliationContext {
  records: Map<string, CatalogRecord>;
  roots: Map<string, CatalogRecord[]>;
  matches: Map<string, Registry['matches']>;
  products: Map<string, Registry['products']>;
  issues: Map<string, Registry['issues']>;
  footprints: Map<string, Footprint>;
  conflictingIdentities: Set<string>;
}
function contextFor(registry: Registry, footprints: Footprint[] = []): ReconciliationContext {
  const context: ReconciliationContext = {
    records: recordIndex(registry),
    roots: new Map(),
    matches: new Map(),
    products: new Map(),
    issues: new Map(),
    footprints: new Map(footprints.map((item) => [productKey(item), item])),
    conflictingIdentities: new Set(),
  };
  for (const match of registry.matches) {
    const key = productKey(match);
    const list = context.matches.get(key) ?? [];
    list.push(match);
    context.matches.set(key, list);
  }
  for (const product of registry.products) {
    const key = productKey(product);
    const list = context.products.get(key) ?? [];
    list.push(product);
    context.products.set(key, list);
  }
  for (const issue of registry.issues) {
    const key = productKey(issue);
    const list = context.issues.get(key) ?? [];
    list.push(issue);
    context.issues.set(key, list);
  }
  // Incompatible bridges must not silently pick a different catalog base for another store.
  const bridges = new Map<string, Set<string>>();
  for (const matches of context.matches.values()) {
    const roots = matchedRoots(matches[0]!, registry, context);
    for (const left of roots)
      for (const right of roots)
        if (left.identity.provider !== right.identity.provider) {
          const key = catalogKey(left.identity);
          const targets = bridges.get(key) ?? new Set<string>();
          targets.add(catalogKey(right.identity));
          bridges.set(key, targets);
        }
  }
  for (const [identity, targets] of bridges)
    if (targets.size > 1)
      for (const key of [identity, ...targets]) context.conflictingIdentities.add(key);
  return context;
}
function matchedRoots(
  item: { store: string; storeId: string },
  registry: Registry,
  context: ReconciliationContext,
): CatalogRecord[] {
  const key = productKey(item);
  const cached = context.roots.get(key);
  if (cached) return cached;
  const roots = (context.matches.get(key) ?? []).flatMap((match) => {
    const root = editionRoot(match.catalog, registry, context.records);
    return root ? [root] : [];
  });
  const result = [...new Map(roots.map((root) => [catalogKey(root.identity), root])).values()];
  context.roots.set(key, result);
  return result;
}

function conflictingRoots(roots: CatalogRecord[]): boolean {
  return (
    ['igdb', 'rawg'].some(
      (provider) => roots.filter((root) => root.identity.provider === provider).length > 1,
    ) || new Set(roots.map((root) => root.kind).filter((kind) => kind !== 'unknown')).size > 1
  );
}
function preferredRoot(roots: CatalogRecord[]): CatalogRecord | undefined {
  return [...roots].sort(
    (left, right) =>
      Number(right.kind !== 'unknown') - Number(left.kind !== 'unknown') ||
      (left.identity.provider === 'igdb' ? -1 : 1) -
        (right.identity.provider === 'igdb' ? -1 : 1) ||
      left.identity.id - right.identity.id,
  )[0];
}
function packageFamilies(
  appId: string,
  registry: Registry,
  context: ReconciliationContext,
): string[] {
  const key = `steam:${appId}`;
  const observation = context.products.get(key)?.[0];
  const footprint = context.footprints.get(key) ??
    observation ?? {
      store: 'steam' as const,
      storeId: appId,
      title: `Steam app ${appId}`,
      titleStatus: 'unresolved' as const,
      kind: 'unknown' as const,
    };
  if (matchedRoots(footprint, registry, context).length) {
    const disposition = classifyFootprint(footprint, registry, context);
    if (disposition.role === 'game' && disposition.family) return [disposition.family];
    return disposition.role === 'component'
      ? disposition.relatedFamilies.filter((family) => !context.conflictingIdentities.has(family))
      : [];
  }
  if (observation?.kind === 'component' && observation.parentStoreId) {
    const parentKey = `steam:${observation.parentStoreId}`;
    const parent = context.footprints.get(parentKey) ??
      context.products.get(parentKey)?.[0] ?? {
        ...footprint,
        storeId: observation.parentStoreId,
        kind: 'unknown' as const,
      };
    const roots = matchedRoots(parent, registry, context);
    if (roots.length) {
      const disposition = classifyFootprint(parent, registry, context);
      if (disposition.role === 'game' && disposition.family) return [disposition.family];
    }
  }
  return [];
}
export function classifyFootprint(
  footprint: Footprint,
  registry: Registry,
  context = contextFor(registry),
): ProductDisposition {
  const disposition: ProductDisposition = {
    footprint,
    role: 'unknown',
    reason: 'Waiting for catalog reconciliation',
    inferred: false,
    relatedFamilies: [],
    packageIds:
      footprint.store === 'steam'
        ? [
            ...new Set(
              registry.packages
                .filter((pkg) => pkg.appIds.includes(footprint.storeId))
                .map((pkg) => pkg.packageId),
            ),
          ]
        : [],
  };
  const issues = context.issues.get(productKey(footprint)) ?? [];
  const roots = matchedRoots(footprint, registry, context);
  if (
    conflictingRoots(roots) ||
    roots.some((root) => context.conflictingIdentities.has(catalogKey(root.identity))) ||
    issues.some((issue) => issue.reason === 'conflicting-evidence')
  )
    return { ...disposition, reason: 'Conflicting identity evidence' };
  const observations = context.products.get(productKey(footprint)) ?? [];
  const observedKinds = new Set(
    observations.map((item) => item.kind).filter((kind) => kind !== 'unknown'),
  );
  if (
    observedKinds.size > 1 ||
    (footprint.classification?.confidence === 'primary' &&
      footprint.kind !== 'unknown' &&
      observedKinds.size &&
      !observedKinds.has(footprint.kind))
  )
    return { ...disposition, reason: 'Conflicting product types' };
  const kind =
    footprint.kind === 'unknown' || !footprint.classification
      ? (observations.find((item) => item.kind !== 'unknown')?.kind ?? footprint.kind)
      : footprint.kind;
  const root = preferredRoot(roots);
  if (root && independentlyPlayable(root) && ['tool', 'auxiliary'].includes(kind))
    return { ...disposition, reason: 'Catalog game conflicts with a non-game source type' };
  if (['tool', 'auxiliary'].includes(kind))
    return { ...disposition, role: kind, reason: 'Confirmed non-game product' };
  if (
    root &&
    independentlyPlayable(root) &&
    kind === 'component' &&
    !['mod', 'standalone-expansion'].includes(root.kind)
  )
    return { ...disposition, reason: 'Catalog and store disagree on standalone play' };
  if (
    root &&
    independentlyPlayable(root) &&
    (kind !== 'component' || ['mod', 'standalone-expansion'].includes(root.kind))
  ) {
    const match = context.matches
      .get(productKey(footprint))
      ?.find((item) => item.catalog.provider === root.identity.provider);
    const record = match ? context.records.get(catalogKey(match.catalog)) : root;
    return {
      ...disposition,
      role: 'game',
      family: catalogKey(root.identity),
      ...(record ? { record } : {}),
      reason: 'Confirmed standalone catalog identity',
    };
  }
  if (root && kind === 'game' && ['component', 'tool', 'bundle'].includes(root.kind))
    return { ...disposition, reason: 'Catalog and store disagree on product type' };
  if (
    kind === 'component' ||
    root?.kind === 'component' ||
    root?.kind === 'tool' ||
    root?.kind === 'bundle'
  ) {
    const parent = root?.parent ? editionRoot(root.parent, registry, context.records) : undefined;
    return {
      ...disposition,
      role:
        root?.kind === 'tool' ? 'tool' : root?.kind === 'bundle' ? 'bundle-related' : 'component',
      ...(root ? { record: root } : {}),
      relatedFamilies: parent && independentlyPlayable(parent) ? [catalogKey(parent.identity)] : [],
      reason: 'Non-standalone product',
    };
  }
  if (root)
    return {
      ...disposition,
      record: root,
      reason: 'Standalone launch requirements are not confirmed',
    };
  // Package inference applies only to unknown products. A known game lacking a catalog is Unknown.
  if (kind === 'unknown' && footprint.store === 'steam') {
    const latest = new Map<string, Registry['packages'][number]>();
    for (const observation of registry.packages) {
      const previous = latest.get(observation.packageId);
      if (
        !previous ||
        observation.checkedAt > previous.checkedAt ||
        (observation.checkedAt === previous.checkedAt && observation.complete && !previous.complete)
      )
        latest.set(observation.packageId, observation);
    }
    const observations = [...latest.values()].filter(
      (pkg) => pkg.complete && pkg.appIds.includes(footprint.storeId),
    );
    const families = observations.map((pkg) =>
      [
        ...new Set(
          pkg.appIds.flatMap((id) =>
            id === footprint.storeId ? [] : packageFamilies(id, registry, context),
          ),
        ),
      ].sort(),
    );
    const positive = families.filter((items) => items.length > 0);
    disposition.relatedFamilies = [...new Set(positive.flat())];
    if (new Set(positive.map((items) => items.join('|'))).size > 1)
      return { ...disposition, reason: 'Conflicting package game families' };
    const basis = positive[0];
    if (basis?.length)
      return {
        ...disposition,
        role: basis.length > 1 ? 'bundle-related' : 'edition-or-component',
        inferred: true,
        reason:
          basis.length > 1
            ? 'Inferred from a complete package containing several game families'
            : 'Inferred from a complete package containing one known game family',
      };
  }
  return {
    ...disposition,
    reason:
      issues.map((issue) => issue.message).join('; ') ||
      (footprint.kind === 'unknown'
        ? 'Unknown product type or catalog identity'
        : 'No confirmed IGDB or RAWG identity'),
  };
}
export interface CatalogGameView {
  key: string;
  title: string;
  identity: CatalogIdentity;
  products: ProductDisposition[];
  components: ProductDisposition[];
  sourceRecordIds: string[];
}
export function classifyFootprints(
  footprints: Footprint[],
  registry: Registry,
): ProductDisposition[] {
  const context = contextFor(registry, footprints);
  return footprints.map((footprint) => classifyFootprint(footprint, registry, context));
}
export function projectFootprints(
  footprints: Footprint[],
  registry: Registry,
  sourceIds: ReadonlyMap<string, string[]> = new Map(),
): {
  games: CatalogGameView[];
  unknown: ProductDisposition[];
  technical: ProductDisposition[];
} {
  const context = contextFor(registry, footprints);
  const dispositions = footprints.map((footprint) =>
    classifyFootprint(footprint, registry, context),
  );
  // An exact same store product verified in both catalogs can bridge the two catalog identities.
  const aliases = new Map<string, string>();
  for (const item of dispositions.filter((entry) => entry.role === 'game')) {
    const roots = matchedRoots(item.footprint, registry, context);
    const preferred = preferredRoot(roots);
    if (preferred && !conflictingRoots(roots))
      for (const root of roots)
        aliases.set(catalogKey(root.identity), catalogKey(preferred.identity));
  }
  const groups = new Map<string, CatalogGameView>();
  for (const disposition of dispositions.filter((item) => item.role === 'game' && item.family)) {
    const key = aliases.get(disposition.family!) ?? disposition.family!;
    const root = context.records.get(key);
    if (!root) continue;
    const group = groups.get(key) ?? {
      key,
      title: root.title,
      identity: root.identity,
      products: [],
      components: [],
      sourceRecordIds: [],
    };
    group.products.push(disposition);
    group.sourceRecordIds.push(...(sourceIds.get(productKey(disposition.footprint)) ?? []));
    group.sourceRecordIds = [...new Set(group.sourceRecordIds)];
    groups.set(key, group);
  }
  const technical = dispositions.filter((item) => !['game', 'unknown'].includes(item.role));
  for (const component of technical)
    for (const family of component.relatedFamilies)
      groups.get(aliases.get(family) ?? family)?.components.push(component);
  return {
    games: [...groups.values()].sort((left, right) => left.title.localeCompare(right.title)),
    unknown: dispositions.filter((item) => item.role === 'unknown'),
    technical,
  };
}
export function projectLibrary(state: LibraryState): ReturnType<typeof projectFootprints> {
  const sourceIds = new Map<string, string[]>();
  for (const game of state.games)
    for (const ref of Object.values(game.storeRefs)) {
      const key = productKey(ref);
      const ids = sourceIds.get(key) ?? [];
      ids.push(game.id);
      sourceIds.set(key, ids);
    }
  return projectFootprints(sourceFootprints(state), state.registry, sourceIds);
}
export function acceptedResult(
  input: InputSnapshot,
  registry: Registry,
  createdAt = new Date().toISOString(),
): AcceptedResult {
  return AcceptedResultSchema.parse({
    version: 1,
    inputHash: input.inputHash,
    createdAt,
    ruleVersion: 1,
    registry: validateRegistry(registry),
  });
}
