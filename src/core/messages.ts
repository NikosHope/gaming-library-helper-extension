import { z } from 'zod/v3';
import { SettingsSchema, StoreGameRefSchema, StoreSchema } from './schema';

export const RuntimeRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state:getAdmin') }),
  z.object({ type: z.literal('view:get') }),
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
  z.object({
    type: z.literal('price:get'),
    title: z.string().min(1),
    currentStore: StoreSchema,
    steamAppId: z.string().optional(),
  }),
]);
export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

export const CaptureRequestSchema = z.object({ type: z.literal('page:captureSnapshot') });
