import { z } from 'zod/v3';
import type { StoreGameRef } from '../core/schema';
import { requestStoreJson } from './store-request';

// Identity/cursor contract adapted from MIT PlayniteExtensions response models.
// Copyright (c) 2020 Josef Nemec; see docs/licenses/playnite-extensions-MIT.txt.
// Cookie-only access to this read query still needs account acceptance; no OAuth token extraction.
export type EpicSnapshotRef = Omit<StoreGameRef, 'store'> & { store: 'epic' };

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const CatalogSchema = z.object({
  id: IdentifierSchema,
  namespace: IdentifierSchema,
  title: z.string().trim().max(1_000).nullable(),
  categories: z
    .array(z.object({ path: z.string().max(200) }))
    .max(100)
    .nullable(),
  mainGameItem: z.object({ id: IdentifierSchema }).nullable(),
});
const RecordSchema = z.object({
  catalogItemId: IdentifierSchema,
  namespace: IdentifierSchema,
  appName: IdentifierSchema,
  sandboxType: z.string().max(64).nullable(),
  catalogItem: CatalogSchema.nullable(),
});
const PageSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z
    .object({
      Library: z.object({
        libraryItems: z.object({
          records: z.array(RecordSchema).max(10_000),
          responseMetadata: z.object({ nextCursor: z.string().max(4_096).nullable() }),
        }),
      }),
    })
    .nullish(),
});

// These are read fields from the official storefront's Library contract.
// Do not accept caller-supplied queries, URLs, account IDs, or credential headers.
const LIBRARY_QUERY = `
query GamingLibraryHelperLibrary($cursor: String) {
  Library {
    libraryItems(cursor: $cursor, params: {includeMetadata: true}) {
      records {
        catalogItemId
        namespace
        appName
        sandboxType
        catalogItem(locale: "en-US") {
          id
          namespace
          title
          categories { path }
          mainGameItem { id }
        }
      }
      responseMetadata { nextCursor }
    }
  }
}`;
const MAX_EPIC_PAGES = 200;
const MAX_EPIC_ASSETS = 20_000;
const CAPTURE_BUDGET_MS = 120_000;
const NON_GAME_PREFIXES = ['mods', 'engines', 'plugins', 'assets', 'software', 'digitalextras'];

function productKind(
  catalog: z.infer<typeof CatalogSchema> | null | undefined,
): 'game' | 'non-game' | 'unresolved' {
  const paths = catalog?.categories?.map(({ path }) => path.toLowerCase()) ?? [];
  if (!paths.length) return 'unresolved';
  const nonGame = paths.some(
    (path) =>
      NON_GAME_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/')) ||
      /^games\/demos?(?:\/|$)/u.test(path),
  );
  if (nonGame) return 'non-game';
  // Catalog technical type "applications" includes games. It is not a software-only category.
  // Parent-game and digital-extra/plugin exclusions are adapted from the MIT integration.
  if (catalog?.mainGameItem) {
    return paths.includes('addons/launchable') ? 'unresolved' : 'non-game';
  }
  if (paths.some((path) => path === 'addons' || path.startsWith('addons/'))) return 'non-game';
  return paths.some(
    (path) => path === 'applications' || path === 'games' || path.startsWith('games/'),
  )
    ? 'game'
    : 'unresolved';
}

export async function captureEpicSnapshot(
  fetcher: typeof fetch = fetch,
): Promise<EpicSnapshotRef[]> {
  const refs = new Map<string, EpicSnapshotRef>();
  const assets = new Map<string, string>();
  const cursors = new Set<string>();
  const productEvidence = new Map<string, string>();
  const importedAt = new Date().toISOString();
  const deadline = Date.now() + CAPTURE_BUDGET_MS;
  let cursor: string | undefined;
  let recordCount = 0;

  for (let page = 1; page <= MAX_EPIC_PAGES; page += 1) {
    if (Date.now() >= deadline) {
      throw new Error(
        'Epic library took too long. Retry later; the previous library is unchanged.',
      );
    }
    const post: typeof fetch = (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Content-Type', 'application/json');
      return fetcher(url, {
        ...init,
        method: 'POST',
        headers,
        body: JSON.stringify({
          operationName: 'GamingLibraryHelperLibrary',
          query: LIBRARY_QUERY,
          variables: { cursor: cursor ?? null },
        }),
      });
    };
    const parsed = PageSchema.safeParse(
      await requestStoreJson('https://store.epicgames.com/graphql', 'Epic', post),
    );
    if (!parsed.success || parsed.data.errors?.length || !parsed.data.data) {
      throw new Error(
        'Epic library query was not accepted. Check store access; the previous library is unchanged.',
      );
    }
    const data = parsed.data.data.Library.libraryItems;
    if (!data.records.length && data.responseMetadata.nextCursor) {
      throw new Error(
        'Epic returned an empty intermediate page. Retry; the previous library is unchanged.',
      );
    }

    for (const record of data.records) {
      const id = record.namespace + ':' + record.catalogItemId;
      const assetId = id + ':' + record.appName;
      recordCount += 1;
      if (recordCount > MAX_EPIC_ASSETS) {
        throw new Error(
          'Epic exceeded the asset safety limit. Retry; the previous library is unchanged.',
        );
      }
      const fingerprint = JSON.stringify(record);
      const previousAsset = assets.get(assetId);
      if (previousAsset !== undefined) {
        if (previousAsset !== fingerprint) {
          throw new Error(
            'Epic asset metadata changed during pagination. Retry; the previous library is unchanged.',
          );
        }
        // The live Library endpoint repeats identical assets, including within its first page.
        // Compare all selected identity/catalog fields before deduplicating the same asset.
        continue;
      }
      assets.set(assetId, fingerprint);
      const catalog = record.catalogItem;
      if (
        catalog &&
        (catalog.id !== record.catalogItemId || catalog.namespace !== record.namespace)
      ) {
        throw new Error(
          'Epic catalog identity does not match the owned item. Retry; the previous library is unchanged.',
        );
      }
      if (record.namespace === 'ue' || record.sandboxType === 'PRIVATE') continue;
      const kind = record.sandboxType === 'PUBLIC' ? productKind(catalog) : 'unresolved';
      const title = kind === 'game' ? catalog?.title || undefined : undefined;
      const evidence = JSON.stringify({ kind, title });
      const prior = productEvidence.get(id);
      if (prior !== undefined && prior !== evidence) {
        throw new Error(
          'Epic product metadata changed during pagination. Retry; the previous library is unchanged.',
        );
      }
      productEvidence.set(id, evidence);
      if (kind === 'non-game') continue;
      refs.set(id, {
        store: 'epic',
        storeId: id,
        title: title ?? 'Epic item ' + id,
        titleStatus: title ? 'resolved' : 'unresolved',
        url: 'https://store.epicgames.com/en-US/',
        owned: true,
        ignoredAtSource: false,
        importedAt,
      });
    }

    const next = data.responseMetadata.nextCursor ?? undefined;
    if (!next) {
      if (!refs.size) {
        throw new Error(
          'Epic returned no game entries. Check sign-in; the previous library is unchanged.',
        );
      }
      return [...refs.values()].sort((left, right) =>
        left.storeId < right.storeId ? -1 : left.storeId > right.storeId ? 1 : 0,
      );
    }
    if (cursors.has(next)) {
      throw new Error(
        'Epic repeated a pagination cursor. Retry; the previous library is unchanged.',
      );
    }
    cursors.add(next);
    cursor = next;
  }
  throw new Error('Epic exceeded the page limit. Retry; the previous library is unchanged.');
}
