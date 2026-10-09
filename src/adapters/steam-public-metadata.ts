import { z } from 'zod/v3';
import { STEAM_METADATA_APP_TYPES } from '../core/steam-app-types';
import { requestStoreJson } from './store-request';

export const STEAM_PUBLIC_METADATA_ORIGIN = 'https://api.steamcmd.net/*';
const IdSchema = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d*$/u)]);
const AppInfoSchema = z.object({
  status: z.literal('success'),
  data: z.record(
    z.string().regex(/^[1-9]\d*$/u),
    z.object({
      appid: IdSchema.optional(),
      common: z
        .object({
          gameid: IdSchema.optional(),
          name: z.string().trim().min(1).max(1_000).optional(),
          type: z.string().trim().min(1).max(80).optional(),
        })
        .optional(),
    }),
  ),
});

/** Public metadata only. The caller must join it to an independently owned original app ID. */
export async function requestSteamPublicAppInfo(appId: number, fetcher: typeof fetch = fetch) {
  if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error('Invalid Steam app ID');
  const parsed = AppInfoSchema.safeParse(
    await requestStoreJson(
      `https://api.steamcmd.net/v1/info/${appId}`,
      'Steam public app metadata',
      fetcher,
      'omit',
    ),
  );
  if (
    !parsed.success ||
    Object.keys(parsed.data.data).length !== 1 ||
    !Object.hasOwn(parsed.data.data, String(appId))
  ) {
    throw new Error(
      'Steam public app metadata is incomplete. Retry; the previous library is unchanged.',
    );
  }
  const app = parsed.data.data[String(appId)]!;
  if (
    (app.appid !== undefined && String(app.appid) !== String(appId)) ||
    (app.common?.gameid !== undefined && String(app.common.gameid) !== String(appId))
  ) {
    throw new Error(
      'Steam public app metadata has inconsistent IDs. Retry; the previous library is unchanged.',
    );
  }
  const typeName = app.common?.type?.toLowerCase();
  const type =
    typeName && Object.hasOwn(STEAM_METADATA_APP_TYPES, typeName)
      ? STEAM_METADATA_APP_TYPES[typeName]
      : undefined;
  const originalIdConfirmed = app.appid !== undefined || app.common?.gameid !== undefined;
  if (!originalIdConfirmed || type === undefined || (type === 0 && !app.common?.name)) {
    return { id: appId, item_type: 0 as const, success: 2 };
  }
  return {
    id: appId,
    appid: appId,
    item_type: 0 as const,
    success: 1,
    type,
    ...(app.common?.name ? { name: app.common.name } : {}),
  };
}
