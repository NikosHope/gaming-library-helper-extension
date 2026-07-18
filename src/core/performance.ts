import type { LaunchPath, PerformanceAssessment } from './schema';

export interface PerformanceTarget {
  outputResolution: { width: number; height: number };
  minimumBaseFps: number;
  minimumPresentedFps?: number;
  requireStableFramePacing: boolean;
  requireVrr: boolean;
}

export interface PerformanceTargetResult {
  verdict: 'meets' | 'does-not-meet' | 'insufficient-evidence';
  executionClass: 'native' | 'layered' | 'virtualized' | 'streamed' | 'unknown';
  reasons: string[];
}

export function classifyExecution(
  launchPath: LaunchPath,
): PerformanceTargetResult['executionClass'] {
  switch (launchPath.executionKind) {
    case 'native-official':
    case 'native-community-port':
      return 'native';
    case 'compatibility-layer':
      return 'layered';
    case 'virtual-machine':
      return 'virtualized';
    case 'streaming':
      return 'streamed';
    default:
      return 'unknown';
  }
}

export function evaluatePerformanceTarget(
  launchPath: LaunchPath,
  assessment: PerformanceAssessment | undefined,
  target: PerformanceTarget,
): PerformanceTargetResult {
  const executionClass = classifyExecution(launchPath);
  const reasons: string[] = [];
  let failed = false;
  let missing = false;

  if (launchPath.status === 'unavailable') {
    return { verdict: 'does-not-meet', executionClass, reasons: ['Launch path is unavailable.'] };
  }
  if (launchPath.status !== 'verified') {
    missing = true;
    reasons.push('Launch path has not been verified on this platform.');
  }
  if (!assessment) {
    return {
      verdict: 'insufficient-evidence',
      executionClass,
      reasons: [...reasons, 'No device-specific performance assessment exists.'],
    };
  }
  if (assessment.launchPathId !== launchPath.id) {
    return {
      verdict: 'insufficient-evidence',
      executionClass,
      reasons: ['The assessment belongs to a different launch path.'],
    };
  }

  if (
    assessment.outputResolution.width !== target.outputResolution.width ||
    assessment.outputResolution.height !== target.outputResolution.height
  ) {
    failed = true;
    reasons.push('The measured output resolution does not match the target.');
  }

  if (assessment.baseFps === undefined) {
    missing = true;
    reasons.push('Base FPS is missing.');
  } else if (assessment.baseFps < target.minimumBaseFps) {
    failed = true;
    reasons.push(`Base FPS is below ${target.minimumBaseFps}.`);
  }

  if (target.minimumPresentedFps !== undefined) {
    if (assessment.presentedFps === undefined) {
      missing = true;
      reasons.push('Presented FPS is missing.');
    } else if (assessment.presentedFps < target.minimumPresentedFps) {
      failed = true;
      reasons.push(`Presented FPS is below ${target.minimumPresentedFps}.`);
    }
  }

  if (target.requireStableFramePacing && assessment.framePacing !== 'stable') {
    const knownUnstable = assessment.framePacing === 'unstable';
    failed ||= knownUnstable;
    missing ||= !knownUnstable;
    reasons.push(
      knownUnstable ? 'Frame pacing is unstable.' : 'Stable frame pacing is unverified.',
    );
  }

  if (target.requireVrr && !['available', 'verified'].includes(assessment.vrr)) {
    const unsupported = assessment.vrr === 'unsupported';
    failed ||= unsupported;
    missing ||= !unsupported;
    reasons.push(unsupported ? 'VRR is unsupported.' : 'VRR availability is unverified.');
  }

  if (failed) return { verdict: 'does-not-meet', executionClass, reasons };
  if (missing || assessment.status !== 'verified') {
    if (assessment.status !== 'verified') reasons.push('The performance result is not verified.');
    return { verdict: 'insufficient-evidence', executionClass, reasons };
  }
  return {
    verdict: 'meets',
    executionClass,
    reasons: reasons.length > 0 ? reasons : ['All target requirements are verified.'],
  };
}
