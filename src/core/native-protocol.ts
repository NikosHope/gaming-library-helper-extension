import { z } from 'zod/v3';

export const NATIVE_HOST = 'glh_reconciliation';
export const CHUNK_CHARACTERS = 96_000;
export const MAX_EXCHANGE_BYTES = 32 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const offset = z.number().int().nonnegative().max(MAX_EXCHANGE_BYTES);
export const NativeRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('publish:begin'), inputHash: hash, characters: offset }).strict(),
  z
    .object({ op: z.literal('publish:chunk'), offset, data: z.string().max(CHUNK_CHARACTERS) })
    .strict(),
  z.object({ op: z.literal('publish:commit') }).strict(),
  z.object({ op: z.literal('result:read'), inputHash: hash, offset }).strict(),
  z
    .object({
      op: z.literal('review:approve'),
      inputHash: hash,
      proposalId: z.string().uuid(),
      independence: z.boolean(),
    })
    .strict(),
]);
export type NativeRequest = z.infer<typeof NativeRequestSchema>;
export const NativeResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ok'),
      changed: z.boolean().optional(),
      inputHash: hash.optional(),
    })
    .strict(),
  z.object({ status: z.literal('waiting') }).strict(),
  z
    .object({
      status: z.literal('chunk'),
      data: z.string().max(CHUNK_CHARACTERS),
      offset,
      total: offset,
      hash,
    })
    .strict(),
  z
    .object({
      status: z.literal('error'),
      code: z.enum(['invalid-message', 'stale-input', 'host-failed', 'review-failed']),
    })
    .strict(),
]);
export type NativeResponse = z.infer<typeof NativeResponseSchema>;
export const BridgeStatusSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean().default(false),
    outcome: z
      .enum(['disabled', 'connected', 'waiting', 'unavailable', 'stale', 'invalid-result'])
      .default('disabled'),
    publishedHash: hash.optional(),
    importedHash: hash.optional(),
    lastAttemptAt: z.string().datetime().optional(),
    lastImportAt: z.string().datetime().optional(),
  })
  .strict();
export type BridgeStatus = z.infer<typeof BridgeStatusSchema>;
