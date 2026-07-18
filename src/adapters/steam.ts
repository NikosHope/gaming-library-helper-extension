import { z } from 'zod/v3';
import type { StoreGameRef } from '../core/schema';

const DynamicStoreSchema = z
  .object({
    rgOwnedApps: z.array(z.coerce.number().int().nonnegative()),
    rgIgnoredApps: z.record(z.string(), z.coerce.number().int()).default({}),
  })
  .passthrough();

const AppDetailsSchema = z.record(
  z.string(),
  z.object({
    success: z.boolean(),
    data: z
      .object({
        steam_appid: z.coerce.number().int().nonnegative(),
        name: z.string().min(1),
      })
      .optional(),
  }),
);

const STEAM_DETAILS_BATCH_SIZE = 40;

async function resolveSteamTitles(
  appIds: number[],
  fetcher: typeof fetch,
): Promise<Map<number, string>> {
  const titles = new Map<number, string>();

  for (let offset = 0; offset < appIds.length; offset += STEAM_DETAILS_BATCH_SIZE) {
    const batch = appIds.slice(offset, offset + STEAM_DETAILS_BATCH_SIZE);
    const url = new URL('https://store.steampowered.com/api/appdetails');
    url.searchParams.set('appids', batch.join(','));
    url.searchParams.set('filters', 'basic');
    const response = await fetcher(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) continue;

    const parsed = AppDetailsSchema.safeParse(await response.json());
    if (!parsed.success) continue;
    for (const [id, result] of Object.entries(parsed.data)) {
      if (result.success && result.data) titles.set(Number(id), result.data.name);
    }
  }

  return titles;
}

export async function captureSteamSnapshot(fetcher: typeof fetch = fetch): Promise<StoreGameRef[]> {
  const response = await fetcher('https://store.steampowered.com/dynamicstore/userdata', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Steam ownership request failed (${response.status})`);

  const parsed = DynamicStoreSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Steam ownership response has an unsupported shape');

  const appIds = [...new Set(parsed.data.rgOwnedApps)];
  if (appIds.length === 0) {
    throw new Error('Steam returned no owned games. Make sure this tab is signed in, then retry.');
  }

  const titles = await resolveSteamTitles(appIds, fetcher);
  const importedAt = new Date().toISOString();

  return appIds.map((appId) => {
    const title = titles.get(appId);
    return {
      store: 'steam',
      storeId: String(appId),
      title: title ?? `Steam app ${appId}`,
      titleStatus: title ? 'resolved' : 'unresolved',
      url: `https://store.steampowered.com/app/${appId}/`,
      owned: true,
      ignoredAtSource: Object.hasOwn(parsed.data.rgIgnoredApps, String(appId)),
      importedAt,
    };
  });
}
