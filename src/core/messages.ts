import { z } from 'zod/v3';
import { SettingsSchema, StoreGameRefSchema, StoreSchema, ProductLocatorSchema } from './schema';
import { SyncSettingsSchema } from './sync';
import { SteamMetadataSnapshotSchema } from './steam-metadata';

export const RuntimeRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('library:setProductsIgnored'),
      products: z
        .array(ProductLocatorSchema)
        .min(1)
        .max(10_000)
        .refine(
          (products) =>
            new Set(products.map((product) => `${product.store}:${product.storeId}`)).size ===
            products.length,
        ),
      ignored: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('reconciliation:status') }).strict(),
  z.object({ type: z.literal('reconciliation:refresh') }).strict(),
  z.object({ type: z.literal('reconciliation:configure'), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('reconciliation:approve'),
      proposalId: z.string().uuid(),
      independence: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('state:getAdmin') }),
  z.object({ type: z.literal('view:get') }),
  z.object({ type: z.literal('sync:getStatus') }),
  z.object({ type: z.literal('sync:runNow') }),
  z.object({ type: z.literal('amazon:startAuth') }),
  z.object({ type: z.literal('amazon:getAuthStatus') }),
  z.object({ type: z.literal('amazon:inspectSource') }),
  z.object({ type: z.literal('amazon:diagnoseSource') }),
  z.object({ type: z.literal('steam:importMetadata'), snapshot: SteamMetadataSnapshotSchema }),
  z.object({
    type: z.literal('steam:catalog'),
    appIds: z
      .array(z.number().int().positive().safe())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  z.object({ type: z.literal('sync:configure'), settings: SyncSettingsSchema }),
  z.object({
    type: z.literal('settings:update'),
    settings: SettingsSchema,
  }),
  z.object({
    type: z.literal('library:replaceSnapshot'),
    store: StoreSchema,
    syncedAt: z.string().datetime(),
    refs: z.array(StoreGameRefSchema),
  }),
  z.object({
    type: z.literal('library:setIgnored'),
    gameId: z.string().uuid(),
    ignored: z.boolean(),
  }),
  z
    .object({
      type: z.literal('library:setIgnoredMany'),
      gameIds: z
        .array(z.string().uuid())
        .min(1)
        .max(10_000)
        .refine((ids) => new Set(ids).size === ids.length),
      ignored: z.boolean(),
    })
    .strict(),
]);
export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

export const CaptureRequestSchema = z.object({ type: z.literal('page:captureSnapshot') });
