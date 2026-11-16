import {
  applyTruePeakLookaheadLimiterOffline,
} from '../dsp-core/LookaheadLimiterCore';
import {
  linearToDbTp,
  measureTruePeakLinear4x,
} from '../dsp-core/TruePeakDetector';

const LIMITER_CURVE_SIZE = 65536;

/**
 * Generates a high-precision 65,536-point Brickwall Soft-Knee Maximizer transfer curve.
 * Kept for backwards exports; Stage 5 runtime/export now uses LookaheadLimiterCore (4x FIR).
 */
export function createBrickwallMaximizerCurve(
  ceilingDbTp = -1.0,
  softClipPrePct = 0.3
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(LIMITER_CURVE_SIZE);
  const ceilingLinear = Math.pow(10, (ceilingDbTp - 0.04) / 20);
  const kneeSpan = Math.max(0.06, Math.min(0.35, softClipPrePct * 0.65));
  const kneeStart = Math.max(0.45, ceilingLinear * (1 - kneeSpan));
  const headroom = Math.max(0.001, ceilingLinear - kneeStart);

  for (let i = 0; i < LIMITER_CURVE_SIZE; i++) {
    const x = (i * 2) / (LIMITER_CURVE_SIZE - 1) - 1;
    const absX = Math.abs(x);
    const sign = x < 0 ? -1 : 1;

    if (absX <= kneeStart) {
      curve[i] = x;
    } else {
      const excess = absX - kneeStart;
      const shaped = kneeStart + headroom * Math.tanh(excess / headroom);
      curve[i] = sign * Math.min(ceilingLinear, shaped);
    }
  }

  curve[LIMITER_CURVE_SIZE >> 1] = 0;
  return curve;
}

/**
 * 4x Polyphase FIR Oversampling True Peak measurement per ITU-R BS.1770-4 Annex 2.
 */
export function measureTruePeakLinearBlock(
  left: Float32Array,
  right: Float32Array,
  startIdx = 0,
  endIdx = left.length
): number {
  return measureTruePeakLinear4x(left, right, startIdx, endIdx);
}

export function linearToDb(linear: number, minDb = -90): number {
  return linearToDbTp(linear, minDb);
}

/**
 * Stage 5 (Offline Mastering Grade True-Peak Lookahead Limiter):
 * Applies latency-compensated 5ms lookahead + 4x polyphase FIR True Peak detection + dual-stage release.
 */
export function applyLookaheadBrickwallLimiterOffline(
  buffer: AudioBuffer,
  ceilingDbTp = -1.0,
  lookaheadMs = 5.0,
  releaseMs = 65,
  driveDb = 0
): { maxGainReductionDb: number; finalTruePeakDbTp: number } {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  return applyTruePeakLookaheadLimiterOffline(left, right, buffer.sampleRate, {
    driveDb,
    ceilingDbTp,
    lookaheadMs,
    releaseMs,
  });
}
