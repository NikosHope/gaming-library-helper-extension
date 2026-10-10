import { z } from 'zod/v3';
import { StoreSchema } from './store-schema';
import { importLibrary } from './backup';
import { contentHash, createInputSnapshot, verifyInputSnapshot } from './reconciliation';
import { InputSnapshotSchema, type InputSnapshot } from './reconciliation-schema';

const LegacyExportSchema = z.object({
  version: z.literal(5),
  exportedAt: z.string().datetime(),
  rows: z
    .array(
      z.object({
        store: StoreSchema,
        providerId: z.string().min(1).max(240),
        providerTitle: z.string().min(1).max(1000),
        titleStatus: z.enum(['resolved', 'unresolved']),
        importedAt: z.string().datetime(),
      }),
    )
    .max(50_000),
});
/** Import the previously retained row export without copying UUIDs, annotations or account fields. */
export async function inputFromLocalDocument(value: unknown): Promise<InputSnapshot> {
  if (typeof value === 'object' && value !== null && 'format' in value)
    return createInputSnapshot(importLibrary(JSON.stringify(value)));
  const legacy = LegacyExportSchema.safeParse(value);
  if (!legacy.success) return verifyInputSnapshot(value);
  const products = legacy.data.rows
    .map((row) => ({
      store: row.store,
      storeId: row.providerId,
      title: row.providerTitle,
      titleStatus: row.titleStatus,
      observedAt: row.importedAt,
      kind: 'unknown' as const,
    }))
    .sort((a, b) => `${a.store}:${a.storeId}`.localeCompare(`${b.store}:${b.storeId}`, 'en-US'));
  return InputSnapshotSchema.parse({
    version: 1,
    createdAt: legacy.data.exportedAt,
    inputHash: await contentHash(products),
    products,
  });
}
