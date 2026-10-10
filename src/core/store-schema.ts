import { z } from 'zod/v3';

export const StoreSchema = z.enum(['steam', 'gog', 'epic', 'amazon', 'battlenet']);
export type Store = z.infer<typeof StoreSchema>;

export const ProductKindSchema = z.enum(['game', 'component', 'tool', 'auxiliary', 'unknown']);
export type ProductKind = z.infer<typeof ProductKindSchema>;
export const ProductClassificationSchema = z
  .object({
    kind: ProductKindSchema,
    componentType: z
      .enum(['beta', 'mode', 'dlc', 'demo', 'localization', 'core', 'other'])
      .optional(),
    label: z.string().min(1).optional(),
    source: z.enum(['store-metadata', 'reviewed-rule', 'community-rule']),
    confidence: z.enum(['primary', 'community']).default('primary'),
    evidenceUrls: z.array(z.string().url()).min(1),
    parent: z
      .object({
        store: StoreSchema,
        storeId: z.string().min(1),
        title: z.string().min(1),
        evidenceUrl: z.string().url(),
      })
      .optional(),
  })
  .refine(
    (value) => !value.parent || value.kind === 'component',
    'Only components can have a parent',
  );
export type ProductClassification = z.infer<typeof ProductClassificationSchema>;
