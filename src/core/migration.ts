import { z } from 'zod/v3';
import { classifyRef, separateProductKinds } from './products';
import {
  CanonicalGameSchema,
  StoreGameRefSchema,
  SnapshotMetaSchema,
  LibraryStateSchema,
  type LibraryState,
  type Platform,
} from './schema';

const LegacyStoreSchema = z.enum(['steam', 'gog']);
const LegacyLibraryStateV5Schema = LibraryStateSchema.omit({
  registry: true,
  productAnnotations: true,
}).extend({
  version: z.literal(5),
});
const LegacyLibraryStateV4Schema = LegacyLibraryStateV5Schema.extend({ version: z.literal(4) });
const LegacyGameSchema = CanonicalGameSchema.extend({
  storeRefs: z
    .record(LegacyStoreSchema, StoreGameRefSchema.extend({ store: LegacyStoreSchema }))
    .default({}),
});
const LegacyLibraryStateV3Schema = LegacyLibraryStateV5Schema.extend({
  version: z.literal(3),
  games: z.array(LegacyGameSchema),
  snapshots: z.record(LegacyStoreSchema, SnapshotMetaSchema),
});
const LegacyLibraryStateV2Schema = LegacyLibraryStateV3Schema.extend({ version: z.literal(2) });

const LegacyPerformanceAssessmentSchema = z
  .object({
    deviceId: z.string().min(1),
    status: z.enum(['unknown', 'unlikely', 'possible', 'verified']),
    resolution: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    baseFps: z.number().positive().optional(),
    presentedFps: z.number().positive().optional(),
    framePacing: z.enum(['unknown', 'unstable', 'stable']),
    vrr: z.enum(['unknown', 'unsupported', 'available', 'verified']),
    upscaler: z.string().optional(),
    frameGeneration: z.string().optional(),
    operatingSystem: z.string().min(1),
    runner: z.string().optional(),
    settings: z.string().default(''),
    evidenceUrl: z.string().url().optional(),
    evidenceDate: z.string().date().optional(),
    confidence: z.enum(['low', 'medium', 'high']),
    notes: z.string().default(''),
  })
  .passthrough();

const LegacyLibraryStateV1Schema = z
  .object({
    version: z.literal(1),
    games: z.array(
      z
        .object({
          performance: z.array(LegacyPerformanceAssessmentSchema).default([]),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function platformFromOperatingSystem(value: string): Platform {
  const normalized = value.toLocaleLowerCase();
  if (normalized.includes('steamos')) return 'steamos';
  if (normalized.includes('linux')) return 'linux';
  if (normalized.includes('mac')) return 'macos';
  if (normalized.includes('windows')) return 'windows';
  return 'unknown';
}

function legacyLaunchPathId(gameIndex: number, deviceId: string, assessmentIndex: number): string {
  return `legacy-${gameIndex}-${deviceId}-${assessmentIndex}`;
}

export function migrateLibraryState(value: unknown): LibraryState | undefined {
  const current = LibraryStateSchema.safeParse(value);
  if (current.success) return current.data;

  const v5 = LegacyLibraryStateV5Schema.safeParse(value);
  if (v5.success) return LibraryStateSchema.parse({ ...v5.data, version: 6 });

  const v4 = LegacyLibraryStateV4Schema.safeParse(value);
  if (v4.success) return upgrade(v4.data);

  const previous = LegacyLibraryStateV3Schema.safeParse(value);
  if (previous.success) return upgrade(previous.data);
  const older = LegacyLibraryStateV2Schema.safeParse(value);
  if (older.success) return upgrade(older.data);

  const legacy = LegacyLibraryStateV1Schema.safeParse(value);
  if (!legacy.success) return undefined;

  const upgradedGames = legacy.data.games.map((game, gameIndex) => {
    const launchPaths = game.performance.map((assessment, assessmentIndex) => {
      const id = legacyLaunchPathId(gameIndex, assessment.deviceId, assessmentIndex);
      return {
        id,
        platform: platformFromOperatingSystem(assessment.operatingSystem),
        status: assessment.status === 'unlikely' ? ('unknown' as const) : assessment.status,
        executionKind: assessment.runner ? ('compatibility-layer' as const) : ('unknown' as const),
        buildArchitecture: 'unknown' as const,
        cpuTranslationLayers: [],
        osCompatibilityLayers: assessment.runner ? [assessment.runner] : [],
        graphicsTranslationLayers: [],
        evidenceUrl: assessment.evidenceUrl,
        evidenceDate: assessment.evidenceDate,
        notes: 'Migrated from schema v1; verify the exact execution and translation layers.',
      };
    });

    const performance = game.performance.map((assessment, assessmentIndex) => ({
      deviceId: assessment.deviceId,
      launchPathId: legacyLaunchPathId(gameIndex, assessment.deviceId, assessmentIndex),
      status: assessment.status,
      outputResolution: assessment.resolution,
      baseFps: assessment.baseFps,
      presentedFps: assessment.presentedFps,
      framePacing: assessment.framePacing,
      vrr: assessment.vrr,
      upscaling: {
        enabled: Boolean(assessment.upscaler),
        technology: assessment.upscaler ? ('other' as const) : ('none' as const),
        integration: assessment.upscaler ? ('unknown' as const) : ('none' as const),
        notes: assessment.upscaler ?? '',
      },
      frameGeneration: {
        enabled: Boolean(assessment.frameGeneration),
        technology: assessment.frameGeneration ? ('other' as const) : ('none' as const),
        integration: assessment.frameGeneration ? ('unknown' as const) : ('none' as const),
        notes: assessment.frameGeneration ?? '',
      },
      settings: assessment.settings,
      evidenceUrl: assessment.evidenceUrl,
      evidenceDate: assessment.evidenceDate,
      confidence: assessment.confidence,
      notes: assessment.notes,
    }));

    return { ...game, launchPaths, performance };
  });

  const upgraded = LegacyLibraryStateV3Schema.parse({
    ...legacy.data,
    version: 3,
    games: upgradedGames,
  });
  return upgrade(upgraded);
}

function upgrade(
  value: Omit<LibraryState, 'version' | 'registry' | 'productAnnotations'> & { version: number },
): LibraryState {
  return separateProductKinds(
    LibraryStateSchema.parse({
      ...value,
      version: 6,
      games: value.games.map((game) => ({
        ...game,
        storeRefs: Object.fromEntries(
          Object.entries(game.storeRefs).map(([store, ref]) => [store, classifyRef(ref)]),
        ),
      })),
    }),
  );
}
