import { z } from 'zod/v3';
import { StoreSchema, type Store } from './schema';

export const SyncSettingsSchema = z.object({
  version: z.literal(2),
  enabled: z.boolean(),
  intervalHours: z.union([z.literal(24), z.literal(168), z.literal(720)]),
  stores: z
    .array(StoreSchema)
    .min(1)
    .max(5)
    .refine((stores) => new Set(stores).size === stores.length),
});
export type SyncSettings = z.infer<typeof SyncSettingsSchema>;

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  version: 2,
  enabled: false,
  intervalHours: 168,
  stores: ['steam', 'gog'],
};

export const SyncReceiptSchema = z.object({
  lastAttemptAt: z.string().datetime(),
  lastSuccessAt: z.string().datetime().optional(),
  outcome: z.enum(['success', 'source-tab-required', 'ambiguous-tabs', 'capture-failed']),
  gameCount: z.number().int().nonnegative().optional(),
});
export type SyncReceipt = z.infer<typeof SyncReceiptSchema>;

export const SyncReceiptsSchema = z.object({
  version: z.literal(2),
  stores: z.record(StoreSchema, SyncReceiptSchema),
});
export type SyncReceipts = z.infer<typeof SyncReceiptsSchema>;

const LegacyStoreSchema = z.enum(['steam', 'gog']);
const LegacySyncSettingsSchema = SyncSettingsSchema.extend({
  version: z.literal(1),
  stores: z
    .array(LegacyStoreSchema)
    .min(1)
    .max(2)
    .refine((stores) => new Set(stores).size === stores.length),
});
const LegacySyncReceiptsSchema = SyncReceiptsSchema.extend({
  version: z.literal(1),
  stores: z.record(LegacyStoreSchema, SyncReceiptSchema),
});

export function migrateSyncSettings(value: unknown): SyncSettings | undefined {
  const current = SyncSettingsSchema.safeParse(value);
  if (current.success) return current.data;
  const old = LegacySyncSettingsSchema.safeParse(value);
  return old.success ? { ...old.data, version: 2 } : undefined;
}

export function migrateSyncReceipts(value: unknown): SyncReceipts | undefined {
  const current = SyncReceiptsSchema.safeParse(value);
  if (current.success) return current.data;
  const old = LegacySyncReceiptsSchema.safeParse(value);
  return old.success ? { ...old.data, version: 2 } : undefined;
}

export const SyncStatusSchema = z.object({
  settings: SyncSettingsSchema,
  receipts: SyncReceiptsSchema,
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

const FAILURE_RETRY_MS = 60 * 60 * 1_000;

export function dueSyncStores(
  settings: SyncSettings,
  receipts: SyncReceipts,
  snapshotTimes: Partial<Record<Store, string>>,
  now: number,
): Store[] {
  if (!settings.enabled) return [];
  return settings.stores.filter((store) => {
    const receipt = receipts.stores[store];
    const lastSuccess = Math.max(
      Date.parse(receipt?.lastSuccessAt ?? '') || 0,
      Date.parse(snapshotTimes[store] ?? '') || 0,
    );
    if (lastSuccess && now - lastSuccess < settings.intervalHours * 60 * 60 * 1_000) return false;
    return !receipt || now - Date.parse(receipt.lastAttemptAt) >= FAILURE_RETRY_MS;
  });
}

export function syncReceipt(
  previous: SyncReceipt | undefined,
  outcome: SyncReceipt['outcome'],
  completedAt: string,
  gameCount?: number,
): SyncReceipt {
  return SyncReceiptSchema.parse({
    lastAttemptAt: completedAt,
    lastSuccessAt: outcome === 'success' ? completedAt : previous?.lastSuccessAt,
    outcome,
    gameCount: outcome === 'success' ? gameCount : previous?.gameCount,
  });
}
