import { z } from 'zod/v3';
import { StoreSchema, ProductKindSchema, ProductClassificationSchema } from './store-schema';

export const PublicEvidenceUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        !url.hostname.endsWith('.local') &&
        !url.username &&
        !url.password &&
        ![...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some(
          (key) =>
            /token|secret|password|session|auth|api.?key|account|email|cookie|nonce|steamid|user.?id|device.?id|^state$|^sid$|^code$/iu.test(
              key,
            ),
        )
      );
    } catch {
      return false;
    }
  }, 'Evidence must be a public HTTPS URL without credentials');
const IdSchema = z.string().min(1).max(240);
export const CatalogIdentitySchema = z
  .object({ provider: z.enum(['igdb', 'rawg']), id: z.number().int().positive().safe() })
  .strict();
export type CatalogIdentity = z.infer<typeof CatalogIdentitySchema>;
export const FootprintSchema = z
  .object({
    store: StoreSchema,
    storeId: IdSchema,
    title: z.string().min(1).max(1000),
    titleStatus: z.enum(['resolved', 'unresolved']),
    observedAt: z.string().datetime().optional(),
    kind: ProductKindSchema,
    classification: ProductClassificationSchema.optional(),
    sourceType: z.string().min(1).max(100).optional(),
    publicUrl: PublicEvidenceUrlSchema.optional(),
  })
  .strict();
export type Footprint = z.infer<typeof FootprintSchema>;
export const InputSnapshotSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.string().datetime(),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    products: z.array(FootprintSchema).max(50_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = value.products.map((item) => `${item.store}:${item.storeId}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate product footprint' });
  });
export type InputSnapshot = z.infer<typeof InputSnapshotSchema>;
export const CatalogRecordSchema = z
  .object({
    identity: CatalogIdentitySchema,
    title: z.string().min(1).max(1000),
    kind: z.enum([
      'game',
      'standalone-expansion',
      'mod',
      'edition',
      'remake',
      'remaster',
      'component',
      'tool',
      'bundle',
      'unknown',
    ]),
    versionParent: CatalogIdentitySchema.optional(),
    parent: CatalogIdentitySchema.optional(),
    dependency: z.enum(['none', 'free-engine', 'base-game', 'unknown']).default('unknown'),
    independenceEvidence: z.array(PublicEvidenceUrlSchema).max(20).default([]),
    url: PublicEvidenceUrlSchema,
    checkedAt: z.string().datetime(),
    externalRefs: z
      .array(
        z
          .object({
            store: StoreSchema,
            storeId: IdSchema,
            url: PublicEvidenceUrlSchema.optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.versionParent &&
      (value.kind !== 'edition' ||
        value.versionParent.provider !== value.identity.provider ||
        value.versionParent.id === value.identity.id)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Only an edition can have a distinct same-catalog version parent',
      });
  });
export type CatalogRecord = z.infer<typeof CatalogRecordSchema>;
export const CatalogMatchSchema = z
  .object({
    store: StoreSchema,
    storeId: IdSchema,
    catalog: CatalogIdentitySchema,
    method: z.enum(['external-id', 'store-url', 'human-review']),
    evidenceUrls: z.array(PublicEvidenceUrlSchema).min(1).max(20),
    verifiedAt: z.string().datetime(),
    reviewId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (match) => match.method !== 'human-review' || Boolean(match.reviewId),
    'Human review receipt is required',
  );
export type CatalogMatch = z.infer<typeof CatalogMatchSchema>;
export const PackageObservationSchema = z
  .object({
    packageId: z.string().regex(/^[1-9]\d*$/u),
    appIds: z
      .array(z.string().regex(/^[1-9]\d*$/u))
      .min(1)
      .max(10_000),
    source: z.enum(['valve-pics', 'valve-store', 'manual-observation']),
    complete: z.boolean(),
    evidenceUrl: PublicEvidenceUrlSchema,
    checkedAt: z.string().datetime(),
  })
  .strict()
  .refine((item) => new Set(item.appIds).size === item.appIds.length, 'Duplicate package members');
export type PackageObservation = z.infer<typeof PackageObservationSchema>;
export const ProductObservationSchema = FootprintSchema.extend({
  source: z.enum(['valve-pics', 'store-metadata', 'human-review']).default('store-metadata'),
  sourceUrl: PublicEvidenceUrlSchema,
  checkedAt: z.string().datetime(),
  parentStoreId: IdSchema.optional(),
}).strict();
export const PlatformObservationSchema = z
  .object({
    store: StoreSchema,
    storeId: IdSchema,
    windows: z.boolean().optional(),
    macos: z.boolean().optional(),
    linux: z.boolean().optional(),
    evidenceUrl: PublicEvidenceUrlSchema,
    checkedAt: z.string().datetime(),
  })
  .strict();
export const ProposalSchema = z
  .object({
    id: z.string().uuid(),
    store: StoreSchema,
    storeId: IdSchema,
    candidate: CatalogIdentitySchema,
    evidenceUrls: z.array(PublicEvidenceUrlSchema).min(1).max(20),
    rationale: z.string().min(1).max(2000),
    origin: z.enum(['catalog-search', 'llm']),
    independence: z
      .object({
        kind: z.enum(['game', 'standalone-expansion', 'mod']),
        dependency: z.enum(['none', 'free-engine']),
        evidenceUrls: z.array(PublicEvidenceUrlSchema).min(1).max(20),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Proposal = z.infer<typeof ProposalSchema>;
export const ProposalFileSchema = z
  .object({
    version: z.literal(1),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    proposals: z.array(ProposalSchema).max(50_000),
  })
  .strict();
export const ReviewReceiptSchema = z
  .object({
    reviewId: z.string().uuid(),
    proposalId: z.string().uuid(),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    approvedAt: z.string().datetime(),
    reviewer: z.literal('human'),
    store: StoreSchema,
    storeId: IdSchema,
    catalog: CatalogIdentitySchema,
    evidenceUrls: z.array(PublicEvidenceUrlSchema).min(1).max(20),
    dependency: z.enum(['none', 'free-engine', 'base-game', 'unknown']).optional(),
    kind: z.enum(['game', 'standalone-expansion', 'mod']).optional(),
  })
  .strict();
export const IssueSchema = z
  .object({
    provider: z.enum(['igdb', 'rawg', 'valve']).optional(),
    catalog: CatalogIdentitySchema.optional(),
    evidenceType: z.literal('exact-link-changed').optional(),
    store: StoreSchema,
    storeId: IdSchema,
    reason: z.enum([
      'catalog-not-configured',
      'catalog-not-found',
      'catalog-not-confirmed',
      'catalog-candidates',
      'source-unavailable',
      'unknown-type',
      'conflicting-evidence',
      'unproven-independence',
    ]),
    message: z.string().min(1).max(1000),
  })
  .strict();
export const RegistrySchema = z
  .object({
    version: z.literal(1),
    records: z.array(CatalogRecordSchema).max(50_000).default([]),
    matches: z.array(CatalogMatchSchema).max(100_000).default([]),
    products: z.array(ProductObservationSchema).max(50_000).default([]),
    packages: z.array(PackageObservationSchema).max(50_000).default([]),
    platforms: z.array(PlatformObservationSchema).max(50_000).default([]),
    proposals: z.array(ProposalSchema).max(50_000).default([]),
    candidateChecks: z
      .array(
        z
          .object({
            proposalId: z.string().uuid(),
            outcome: z.enum(['exists', 'missing', 'unavailable']),
            checkedAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(50_000)
      .default([]),
    issues: z.array(IssueSchema).max(100_000).default([]),
    reviews: z.array(ReviewReceiptSchema).max(10_000).default([]),
  })
  .strict();
export type Registry = z.infer<typeof RegistrySchema>;
export const AcceptedResultSchema = z
  .object({
    version: z.literal(1),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.string().datetime(),
    ruleVersion: z.literal(1),
    registry: RegistrySchema,
  })
  .strict();
export type AcceptedResult = z.infer<typeof AcceptedResultSchema>;
export const CollectedSchema = z
  .object({
    version: z.literal(1),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.string().datetime(),
    registry: RegistrySchema,
  })
  .strict();
