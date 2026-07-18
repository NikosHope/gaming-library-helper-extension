import { z } from 'zod/v3';
import { LibraryStateSchema, type LibraryState, type Platform } from './schema';

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

  return LibraryStateSchema.parse({ ...legacy.data, version: 2, games: upgradedGames });
}
