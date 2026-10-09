import { z } from 'zod/v3';
import type { StoreGameRef } from '../core/schema';
import { classifyRef } from '../core/products';
import { STEAM_METADATA_APP_TYPES } from '../core/steam-app-types';
import { requestStoreJson } from './store-request';

const AppIdSchema = z.number().int().positive().safe();
const DynamicStoreSchema = z.object({
  rgOwnedApps: z.array(
    z.union([
      AppIdSchema,
      z
        .string()
        .regex(/^[1-9]\d*$/u)
        .transform(Number)
        .pipe(AppIdSchema),
    ]),
  ),
  // Steam serializes an empty ignore map as [] (also observed in its anonymous response).
  // A nonempty array is not a verified ignore map and must not invent ignored app IDs.
  rgIgnoredApps: z
    .union([z.record(z.string(), z.coerce.number().int()), z.tuple([]).transform(() => ({}))])
    .default({}),
});
const StoreItemSchema = z.object({
  id: AppIdSchema,
  item_type: z.literal(0),
  appid: z.number().int().nonnegative().safe().optional(),
  success: z.number().int().positive(),
  type: z.number().int().nonnegative().optional(),
  name: z.string().optional(),
});
const StoreBrowseSchema = z.object({
  response: z.object({ store_items: z.array(StoreItemSchema) }),
});
const AppDetailsSchema = z.record(
  z.string().regex(/^[1-9]\d*$/u),
  z.discriminatedUnion('success', [
    z.object({ success: z.literal(false) }),
    z.object({
      success: z.literal(true),
      data: z.object({
        steam_appid: AppIdSchema,
        type: z.string().min(1).max(100),
        name: z.string().trim().min(1).max(1_000),
      }),
    }),
  ]),
);
type StoreItem = z.infer<typeof StoreItemSchema>;
export type SteamCatalogReader = (appIds: number[]) => Promise<unknown>;
export type SteamPublicMetadataReader = (appId: number) => Promise<StoreItem>;
export const STEAM_CATALOG_ORIGIN = 'https://api.steampowered.com/*';

const STEAM_BATCH_SIZE = 100;
const MAX_STEAM_APPS = 10_000;
const STEAM_METADATA_BUDGET_MS = 120_000;

async function resolveCatalogAlias(item: StoreItem, fetcher: typeof fetch): Promise<StoreItem> {
  const url = new URL('https://store.steampowered.com/api/appdetails');
  url.searchParams.set('appids', String(item.id));
  url.searchParams.set('filters', 'basic');
  const parsed = AppDetailsSchema.safeParse(
    await requestStoreJson(url, 'Steam original app metadata', fetcher, 'omit'),
  );
  if (!parsed.success || Object.keys(parsed.data).length !== 1 || !parsed.data[String(item.id)]) {
    throw new Error(
      'Steam original app metadata is inconsistent. Retry; the previous library is unchanged.',
    );
  }
  const details = parsed.data[String(item.id)]!;
  if (!details.success) return { id: item.id, item_type: 0, success: 2 };
  if (details.data.steam_appid !== item.id) {
    if (
      details.data.steam_appid === item.appid &&
      details.data.type === 'game' &&
      details.data.name === item.name
    ) {
      return { id: item.id, item_type: 0, success: 2 };
    }
    throw new Error(
      'Steam original app metadata has inconsistent IDs. Retry; the previous library is unchanged.',
    );
  }
  // A storefront redirect cannot establish ownership of its destination game.
  // Resolve only when the separate public record confirms the original owned app as a game.
  const type = Object.hasOwn(STEAM_METADATA_APP_TYPES, details.data.type)
    ? STEAM_METADATA_APP_TYPES[details.data.type]
    : undefined;
  if (type === undefined) return { id: item.id, item_type: 0, success: 2 };
  return { ...item, appid: item.id, name: details.data.name, type };
}

export async function requestSteamCatalog(
  appIds: number[],
  fetcher: typeof fetch = fetch,
  readPublicMetadata?: SteamPublicMetadataReader,
): Promise<z.infer<typeof StoreBrowseSchema>> {
  const url = new URL('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/');
  url.searchParams.set(
    'input_json',
    JSON.stringify({
      ids: appIds.map((appid) => ({ appid })),
      context: { country_code: 'US', language: 'english' },
      data_request: {},
    }),
  );
  const parsed = StoreBrowseSchema.safeParse(
    await requestStoreJson(url, 'Steam catalog', fetcher, 'omit'),
  );
  if (!parsed.success) {
    throw new Error(
      'Steam catalog returned incomplete metadata. Retry; the previous library is unchanged.',
    );
  }
  const expected = new Set(appIds);
  if (parsed.data.response.store_items.length !== expected.size) {
    throw new Error(
      'Steam catalog returned incomplete metadata. Retry; the previous library is unchanged.',
    );
  }
  if (parsed.data.response.store_items.some((item) => !expected.delete(item.id))) {
    throw new Error(
      'Steam catalog returned inconsistent app IDs. Retry; the previous library is unchanged.',
    );
  }
  const deadline = Date.now() + STEAM_METADATA_BUDGET_MS;
  for (const [index, item] of parsed.data.response.store_items.entries()) {
    if (item.success !== 1 || item.type !== 0 || item.appid === item.id) continue;
    if (Date.now() >= deadline) {
      throw new Error(
        'Steam original app metadata took too long. Retry; the previous library is unchanged.',
      );
    }
    parsed.data.response.store_items[index] = await resolveCatalogAlias(item, fetcher);
  }
  if (readPublicMetadata) {
    const unresolved = parsed.data.response.store_items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.success !== 1);
    let cursor = 0;
    let failed = false;
    await Promise.all(
      Array.from({ length: Math.min(4, unresolved.length) }, async () => {
        while (!failed && cursor < unresolved.length) {
          const { item, index } = unresolved[cursor++]!;
          if (Date.now() >= deadline) {
            throw new Error(
              'Steam public app metadata took too long. Retry; the previous library is unchanged.',
            );
          }
          let metadata: StoreItem;
          try {
            metadata = StoreItemSchema.parse(await readPublicMetadata(item.id));
          } catch (error) {
            failed = true;
            throw error;
          }
          if (metadata.id !== item.id) {
            failed = true;
            throw new Error(
              'Steam public app metadata has inconsistent IDs. The previous library is unchanged.',
            );
          }
          parsed.data.response.store_items[index] = metadata;
        }
      }),
    );
  }
  // Strip unrelated catalog fields before sending this response to a content script.
  return parsed.data;
}

/** Public catalog metadata is not ownership evidence. Join only to authenticated owned IDs. */
async function resolveSteamItems(
  appIds: number[],
  readCatalog: SteamCatalogReader,
): Promise<Map<number, StoreItem>> {
  const items = new Map<number, StoreItem>();
  const deadline = Date.now() + STEAM_METADATA_BUDGET_MS;
  for (let offset = 0; offset < appIds.length; offset += STEAM_BATCH_SIZE) {
    if (Date.now() >= deadline) {
      throw new Error(
        'Steam metadata took too long. Retry later; the previous library is unchanged.',
      );
    }
    const batch = appIds.slice(offset, offset + STEAM_BATCH_SIZE);
    const expected = new Set(batch);
    const parsed = StoreBrowseSchema.safeParse(await readCatalog(batch));
    if (!parsed.success || parsed.data.response.store_items.length !== batch.length) {
      throw new Error(
        'Steam catalog returned incomplete metadata. Retry; the previous library is unchanged.',
      );
    }
    for (const item of parsed.data.response.store_items) {
      if (
        !expected.delete(item.id) ||
        (item.success === 1 &&
          (item.type === undefined ||
            (item.type === 0 && (item.appid !== item.id || !item.name?.trim()))))
      ) {
        throw new Error(
          'Steam catalog returned inconsistent app IDs or types. Retry; the previous library is unchanged.',
        );
      }
      items.set(item.id, item);
    }
  }
  return items;
}

export async function captureSteamSnapshot(
  fetcher: typeof fetch = fetch,
  readCatalog: SteamCatalogReader = (appIds) => requestSteamCatalog(appIds, fetcher),
): Promise<StoreGameRef[]> {
  const parsed = DynamicStoreSchema.safeParse(
    await requestStoreJson(
      'https://store.steampowered.com/dynamicstore/userdata',
      'Steam',
      fetcher,
    ),
  );
  if (!parsed.success)
    throw new Error(
      'Steam ownership response has an unsupported shape. The previous library is unchanged.',
    );

  const appIds = [...new Set(parsed.data.rgOwnedApps)].sort((left, right) => left - right);
  if (appIds.length === 0 || appIds.length > MAX_STEAM_APPS) {
    throw new Error(
      'Steam returned no owned apps or exceeded the safety limit. Check sign-in, then retry. The previous library is unchanged.',
    );
  }

  const items = await resolveSteamItems(appIds, readCatalog);
  const importedAt = new Date().toISOString();
  const refs: StoreGameRef[] = [];
  for (const appId of appIds) {
    const item = items.get(appId)!;
    // Ownership applies to the original ID, including components and non-game records.
    const title = item.success === 1 ? item.name?.trim() || undefined : undefined;
    const kind =
      item.success !== 1
        ? 'unknown'
        : item.type === 0
          ? 'game'
          : [1, 2, 4, 12].includes(item.type!)
            ? 'component'
            : [6, 13].includes(item.type!)
              ? 'tool'
              : [3, 5, 7, 8, 9, 10, 11, 14].includes(item.type!)
                ? 'auxiliary'
                : 'unknown';
    refs.push(
      classifyRef({
        store: 'steam',
        storeId: String(appId),
        title: title ?? `Steam app ${appId}`,
        titleStatus: title ? 'resolved' : 'unresolved',
        url: `https://store.steampowered.com/app/${appId}/`,
        owned: true,
        ignoredAtSource: Object.hasOwn(parsed.data.rgIgnoredApps, String(appId)),
        importedAt,
        classification: {
          kind,
          ...(kind === 'component'
            ? {
                componentType:
                  item.type === 1
                    ? 'demo'
                    : item.type === 4
                      ? 'dlc'
                      : item.type === 12
                        ? 'beta'
                        : 'other',
              }
            : {}),
          source: 'store-metadata',
          confidence: 'primary',
          evidenceUrls: [`https://store.steampowered.com/app/${appId}/`],
        },
      }),
    );
  }
  if (refs.length === 0) {
    throw new Error(
      'Steam returned no games or unresolved apps. Check your account; the previous library is unchanged.',
    );
  }
  return refs;
}
