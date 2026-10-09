import { z } from 'zod/v3';
import { STEAM_METADATA_APP_TYPES } from './steam-app-types';

export const SteamMetadataTypeSchema = z.enum([
  'game',
  'demo',
  'dlc',
  'application',
  'software',
  'music',
  'video',
  'tool',
  'config',
]);
const AppSchema = z
  .object({
    id: z.number().int().positive().max(0xffffffff),
    type: SteamMetadataTypeSchema,
    name: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .refine((app) => app.type !== 'game' || app.name !== undefined, 'Game title required');
export const SteamMetadataSnapshotSchema = z
  .object({
    version: z.literal(1),
    source: z.literal('valve-pics-anonymous'),
    checkedAt: z.string().datetime(),
    apps: z
      .array(AppSchema)
      .min(1)
      .max(10_000)
      .refine(
        (apps) => new Set(apps.map((app) => app.id)).size === apps.length,
        'Duplicate app IDs',
      ),
  })
  .strict();
const CachedAppSchema = z
  .object({
    id: z.number().int().positive().max(0xffffffff),
    type: SteamMetadataTypeSchema,
    name: z.string().trim().min(1).max(1_000).optional(),
    source: z.literal('valve-pics-anonymous'),
    checkedAt: z.string().datetime(),
  })
  .strict()
  .refine((app) => app.type !== 'game' || app.name !== undefined, 'Game title required');
export const SteamMetadataCacheSchema = z
  .object({
    version: z.literal(1),
    apps: z
      .array(CachedAppSchema)
      .max(10_000)
      .refine(
        (apps) => new Set(apps.map((app) => app.id)).size === apps.length,
        'Duplicate app IDs',
      ),
  })
  .strict();
export type SteamMetadataCache = z.infer<typeof SteamMetadataCacheSchema>;
export type SteamMetadataSnapshot = z.infer<typeof SteamMetadataSnapshotSchema>;

export function parseSteamMetadataCache(raw: unknown): SteamMetadataCache {
  if (raw === undefined) return { version: 1, apps: [] };
  const parsed = SteamMetadataCacheSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error('Unsupported saved Steam metadata. Existing data is preserved.');
  return parsed.data;
}

export function mergeSteamMetadata(
  cache: SteamMetadataCache,
  snapshot: SteamMetadataSnapshot,
  now: number,
): SteamMetadataCache {
  const imported = SteamMetadataSnapshotSchema.parse(snapshot);
  if (Date.parse(imported.checkedAt) > now + 60_000)
    throw new Error('Steam metadata has a future timestamp. Existing data is preserved.');
  const apps = new Map(SteamMetadataCacheSchema.parse(cache).apps.map((app) => [app.id, app]));
  for (const app of imported.apps) {
    const previous = apps.get(app.id);
    if (previous && Date.parse(previous.checkedAt) > Date.parse(imported.checkedAt)) continue;
    apps.set(app.id, {
      id: app.id,
      type: app.type,
      ...(app.name ? { name: app.name } : {}),
      source: imported.source,
      checkedAt: imported.checkedAt,
    });
  }
  return SteamMetadataCacheSchema.parse({
    version: 1,
    apps: [...apps.values()].sort((a, b) => a.id - b.id),
  });
}

export function cachedSteamMetadataItem(cache: SteamMetadataCache, id: number) {
  const app = cache.apps.find((app) => app.id === id);
  return app
    ? {
        id: app.id,
        appid: app.id,
        item_type: 0 as const,
        success: 1,
        type: STEAM_METADATA_APP_TYPES[app.type],
        ...(app.name ? { name: app.name } : {}),
      }
    : { id, item_type: 0 as const, success: 2 };
}
