import { z } from 'zod/v3';

export const StoreSchema = z.enum(['steam', 'gog']);
export type Store = z.infer<typeof StoreSchema>;

export const StoreGameRefSchema = z.object({
  store: StoreSchema,
  storeId: z.string().min(1),
  title: z.string().min(1),
  titleStatus: z.enum(['resolved', 'unresolved']).default('resolved'),
  url: z.string().url().optional(),
  owned: z.boolean().default(true),
  ignoredAtSource: z.boolean().default(false),
  importedAt: z.string().datetime(),
});
export type StoreGameRef = z.infer<typeof StoreGameRefSchema>;

export const DeviceProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hardware: z.string().min(1),
  memoryGb: z.number().positive().optional(),
  operatingSystems: z.array(z.string().min(1)).min(1),
  cpuArchitecture: z.enum(['x86_64', 'arm64', 'other', 'unknown']).default('unknown'),
  graphicsApis: z.array(z.string().min(1)).default([]),
  displayMode: z.enum(['internal', 'docked-external', 'either']),
  notes: z.string().default(''),
});
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;

export const PlatformSchema = z.enum(['steamos', 'linux', 'macos', 'windows', 'unknown']);
export type Platform = z.infer<typeof PlatformSchema>;

export const LaunchPathSchema = z.object({
  id: z.string().min(1),
  platform: PlatformSchema,
  status: z.enum(['unknown', 'unavailable', 'possible', 'verified']),
  executionKind: z.enum([
    'unknown',
    'native-official',
    'native-community-port',
    'compatibility-layer',
    'virtual-machine',
    'streaming',
  ]),
  distributionChannel: z.string().min(1).optional(),
  buildArchitecture: z.enum(['native-device', 'x86_64', 'arm64', 'universal', 'unknown']),
  cpuTranslationLayers: z.array(z.string().min(1)).default([]),
  osCompatibilityLayers: z.array(z.string().min(1)).default([]),
  graphicsTranslationLayers: z.array(z.string().min(1)).default([]),
  evidenceUrl: z.string().url().optional(),
  evidenceDate: z.string().date().optional(),
  notes: z.string().default(''),
});
export type LaunchPath = z.infer<typeof LaunchPathSchema>;

export const UpscalingSchema = z.object({
  enabled: z.boolean(),
  technology: z.enum([
    'none',
    'fsr',
    'gamescope-fsr',
    'metalfx',
    'dlss',
    'xess',
    'nis',
    'other',
    'unknown',
  ]),
  integration: z.enum([
    'none',
    'in-game',
    'compositor',
    'compatibility-layer',
    'external-app',
    'unknown',
  ]),
  version: z.string().optional(),
  qualityMode: z.string().optional(),
  notes: z.string().default(''),
});
export type Upscaling = z.infer<typeof UpscalingSchema>;

export const FrameGenerationSchema = z.object({
  enabled: z.boolean(),
  technology: z.enum(['none', 'fsr', 'lossless-scaling', 'metalfx', 'dlss', 'other', 'unknown']),
  integration: z.enum([
    'none',
    'in-game',
    'vulkan-layer',
    'compatibility-layer',
    'external-app',
    'unknown',
  ]),
  version: z.string().optional(),
  notes: z.string().default(''),
});
export type FrameGeneration = z.infer<typeof FrameGenerationSchema>;

export const PerformanceAssessmentSchema = z.object({
  deviceId: z.string().min(1),
  launchPathId: z.string().min(1),
  status: z.enum(['unknown', 'unlikely', 'possible', 'verified']),
  outputResolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  renderResolution: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional(),
  baseFps: z.number().positive().optional(),
  presentedFps: z.number().positive().optional(),
  framePacing: z.enum(['unknown', 'unstable', 'stable']),
  vrr: z.enum(['unknown', 'unsupported', 'available', 'verified']),
  upscaling: UpscalingSchema,
  frameGeneration: FrameGenerationSchema,
  settings: z.string().default(''),
  evidenceUrl: z.string().url().optional(),
  evidenceDate: z.string().date().optional(),
  confidence: z.enum(['low', 'medium', 'high']),
  notes: z.string().default(''),
});
export type PerformanceAssessment = z.infer<typeof PerformanceAssessmentSchema>;

export const CanonicalGameSchema = z.object({
  id: z.string().uuid(),
  displayTitle: z.string().min(1),
  normalizedTitle: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  ignored: z.boolean().default(false),
  notes: z.string().default(''),
  storeRefs: z.record(StoreSchema, StoreGameRefSchema).default({}),
  launchPaths: z.array(LaunchPathSchema).default([]),
  performance: z.array(PerformanceAssessmentSchema).default([]),
});
export type CanonicalGame = z.infer<typeof CanonicalGameSchema>;

export const PriceQuoteSchema = z.object({
  provider: z.literal('itad'),
  gameTitle: z.string().min(1),
  store: StoreSchema,
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  regularAmount: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  url: z.string().url(),
  fetchedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type PriceQuote = z.infer<typeof PriceQuoteSchema>;

export const SettingsSchema = z.object({
  highlightOwnedOnOtherStore: z.boolean().default(true),
  hideOwnedOnOtherStore: z.boolean().default(false),
  hideIgnored: z.boolean().default(true),
  prices: z.object({
    enabled: z.boolean().default(false),
    country: z.string().length(2).default('CA'),
    apiKey: z.string().default(''),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SnapshotMetaSchema = z.object({
  syncedAt: z.string().datetime(),
  gameCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
});

export const LibraryStateSchema = z.object({
  version: z.literal(2),
  games: z.array(CanonicalGameSchema),
  snapshots: z.record(StoreSchema, SnapshotMetaSchema),
  settings: SettingsSchema,
  devices: z.array(DeviceProfileSchema),
  priceCache: z.record(z.string(), PriceQuoteSchema),
});
export type LibraryState = z.infer<typeof LibraryStateSchema>;

export const StoreSnapshotSchema = z.object({
  store: StoreSchema,
  syncedAt: z.string().datetime(),
  refs: z.array(StoreGameRefSchema),
});
export type StoreSnapshot = z.infer<typeof StoreSnapshotSchema>;
