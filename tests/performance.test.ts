import { describe, expect, it } from 'vitest';
import { classifyExecution, evaluatePerformanceTarget } from '../src/core/performance';
import type { LaunchPath, PerformanceAssessment } from '../src/core/schema';

const communityPort: LaunchPath = {
  id: 'mac-source-port',
  platform: 'macos',
  status: 'verified',
  executionKind: 'native-community-port',
  distributionChannel: 'Homebrew',
  buildArchitecture: 'native-device',
  cpuTranslationLayers: [],
  osCompatibilityLayers: [],
  graphicsTranslationLayers: [],
  notes: 'Open-source Apple silicon port.',
};

const steamDeckPath: LaunchPath = {
  id: 'deck-proton',
  platform: 'steamos',
  status: 'verified',
  executionKind: 'compatibility-layer',
  distributionChannel: 'Steam',
  buildArchitecture: 'x86_64',
  cpuTranslationLayers: [],
  osCompatibilityLayers: ['Proton'],
  graphicsTranslationLayers: ['DXVK'],
  notes: '',
};

const assessment: PerformanceAssessment = {
  deviceId: 'steam-deck-lcd-docked',
  launchPathId: steamDeckPath.id,
  status: 'verified',
  outputResolution: { width: 1920, height: 1080 },
  renderResolution: { width: 1280, height: 720 },
  baseFps: 40,
  presentedFps: 40,
  framePacing: 'stable',
  vrr: 'verified',
  upscaling: {
    enabled: true,
    technology: 'gamescope-fsr',
    integration: 'compositor',
    qualityMode: 'custom 720p to 1080p',
    notes: '',
  },
  frameGeneration: {
    enabled: false,
    technology: 'none',
    integration: 'none',
    notes: '',
  },
  settings: '40 FPS cap',
  confidence: 'high',
  notes: '',
};

describe('performance launch paths', () => {
  it('counts a Homebrew/open-source native build as native execution', () => {
    expect(classifyExecution(communityPort)).toBe('native');
  });

  it('can verify a 1080p 40 FPS VRR target through Proton and Gamescope FSR', () => {
    expect(
      evaluatePerformanceTarget(steamDeckPath, assessment, {
        outputResolution: { width: 1920, height: 1080 },
        minimumBaseFps: 40,
        requireStableFramePacing: true,
        requireVrr: true,
      }),
    ).toMatchObject({ verdict: 'meets', executionClass: 'layered' });
  });

  it('represents SteamOS LSFG through the community Vulkan layer', () => {
    const withLsfgVk: PerformanceAssessment = {
      ...assessment,
      presentedFps: 80,
      frameGeneration: {
        enabled: true,
        technology: 'lossless-scaling',
        integration: 'vulkan-layer',
        version: 'lsfg-vk',
        notes: 'Community Linux implementation; requires per-game verification.',
      },
    };

    expect(
      evaluatePerformanceTarget(steamDeckPath, withLsfgVk, {
        outputResolution: { width: 1920, height: 1080 },
        minimumBaseFps: 40,
        minimumPresentedFps: 80,
        requireStableFramePacing: true,
        requireVrr: true,
      }),
    ).toMatchObject({ verdict: 'meets', executionClass: 'layered' });
  });

  it('does not treat frame generation as proven when presented FPS is missing', () => {
    const withFrameGeneration: PerformanceAssessment = {
      ...assessment,
      presentedFps: undefined,
      frameGeneration: {
        enabled: true,
        technology: 'lossless-scaling',
        integration: 'external-app',
        notes: '',
      },
    };
    expect(
      evaluatePerformanceTarget(steamDeckPath, withFrameGeneration, {
        outputResolution: { width: 1920, height: 1080 },
        minimumBaseFps: 40,
        minimumPresentedFps: 80,
        requireStableFramePacing: true,
        requireVrr: true,
      }).verdict,
    ).toBe('insufficient-evidence');
  });

  it.each([
    ['virtual-machine', 'virtualized'],
    ['streaming', 'streamed'],
    ['unknown', 'unknown'],
  ] as const)('classifies %s paths as %s', (executionKind, expected) => {
    expect(classifyExecution({ ...communityPort, executionKind })).toBe(expected);
  });

  it('rejects an unavailable launch path before evaluating performance', () => {
    expect(
      evaluatePerformanceTarget({ ...steamDeckPath, status: 'unavailable' }, assessment, {
        outputResolution: { width: 1920, height: 1080 },
        minimumBaseFps: 40,
        requireStableFramePacing: false,
        requireVrr: false,
      }),
    ).toMatchObject({ verdict: 'does-not-meet', reasons: ['Launch path is unavailable.'] });
  });

  it('reports missing launch and device evidence', () => {
    expect(
      evaluatePerformanceTarget({ ...steamDeckPath, status: 'possible' }, undefined, {
        outputResolution: { width: 1920, height: 1080 },
        minimumBaseFps: 40,
        requireStableFramePacing: true,
        requireVrr: true,
      }),
    ).toMatchObject({ verdict: 'insufficient-evidence' });
  });

  it('rejects an assessment attached to another launch path', () => {
    expect(
      evaluatePerformanceTarget(
        steamDeckPath,
        { ...assessment, launchPathId: 'other' },
        {
          outputResolution: { width: 1920, height: 1080 },
          minimumBaseFps: 40,
          requireStableFramePacing: false,
          requireVrr: false,
        },
      ),
    ).toMatchObject({ verdict: 'insufficient-evidence' });
  });

  it('reports measured target failures instead of hiding them behind upscaling', () => {
    const failed: PerformanceAssessment = {
      ...assessment,
      outputResolution: { width: 1280, height: 720 },
      baseFps: 30,
      presentedFps: 60,
      framePacing: 'unstable',
      vrr: 'unsupported',
    };
    const result = evaluatePerformanceTarget(steamDeckPath, failed, {
      outputResolution: { width: 1920, height: 1080 },
      minimumBaseFps: 40,
      minimumPresentedFps: 80,
      requireStableFramePacing: true,
      requireVrr: true,
    });
    expect(result.verdict).toBe('does-not-meet');
    expect(result.reasons).toHaveLength(5);
  });

  it('keeps unknown measurements and an unverified assessment inconclusive', () => {
    const unknown: PerformanceAssessment = {
      ...assessment,
      status: 'possible',
      baseFps: undefined,
      framePacing: 'unknown',
      vrr: 'unknown',
    };
    const result = evaluatePerformanceTarget(steamDeckPath, unknown, {
      outputResolution: { width: 1920, height: 1080 },
      minimumBaseFps: 40,
      requireStableFramePacing: true,
      requireVrr: true,
    });
    expect(result.verdict).toBe('insufficient-evidence');
    expect(result.reasons).toContain('The performance result is not verified.');
  });
});
