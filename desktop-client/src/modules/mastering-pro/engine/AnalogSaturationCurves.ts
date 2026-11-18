import type { SaturationType } from '../types/mastering.types';

const CURVE_RESOLUTION = 65536;

/**
 * +8 dB internal headroom scale so signals above 0 dBFS never hard-clip at WaveShaperNode's ±1.0 domain!
 * Input gain divides by SAT_HEADROOM_SCALE, curve evaluates at SAT_HEADROOM_SCALE * x,
 * and output trim multiplies back by SAT_HEADROOM_SCALE.
 */
export const SAT_HEADROOM_SCALE = 2.5;

/**
 * Generates a 65,536-point Float32Array transfer curve for a 4x oversampled WaveShaperNode.
 * Every curve has:
 * - Exact 1.0 small-signal unity slope at x = 0 (ZERO hidden volume boost!).
 * - Zero static DC offset (curve[32768] = 0).
 * - +8 dB peak headroom before curve domain saturation.
 */
export function generateAnalogSaturationCurve(
  type: SaturationType,
  drive: number
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_RESOLUTION);
  const d = Math.max(0, Math.min(1.0, drive));

  // At drive = 0 -> pure bit-transparent linear bypass
  if (d <= 0.002) {
    for (let i = 0; i < CURVE_RESOLUTION; i++) {
      curve[i] = (i * 2) / (CURVE_RESOLUTION - 1) - 1;
    }
    curve[CURVE_RESOLUTION >> 1] = 0;
    return curve;
  }

  const evalUnitSlope = (u: number): number => {
    switch (type) {
      case 'tape': {
        // Studer A800 style: hyperbolic tangent normalized so f'(0) = 1.0 + bounded 2nd harmonic warmth
        const k = 0.65 + d * 2.2;
        const asym = (0.032 * d * u * u) / (1 + 0.35 * u * u);
        return Math.tanh(k * u + asym) / k;
      }
      case 'tube': {
        // Warm triode valve: asymmetric soft knee normalized so f'(0) = 1.0
        const k = 0.7 + d * 2.5;
        if (u >= 0) {
          return (1 - Math.exp(-k * u)) / k;
        }
        const kn = k * 0.8;
        return -(1 - Math.exp(kn * u)) / kn;
      }
      case 'transformer': {
        // Neve/API iron core: algebraic S-curve + true even 2nd-harmonic term with exact slope 1.0 at zero
        const k = 0.75 + d * 2.6;
        const ku = k * u;
        const odd = u / Math.sqrt(1 + ku * ku);
        const evenBias = (0.028 * d * (u * u)) / (1 + u * u);
        return odd + evenBias;
      }
      case 'softclip':
      default: {
        // Mastering-grade knee soft-clip: strictly 1:1 linear core, smooth tanh ceiling above threshold
        const thresh = Math.max(0.28, 0.82 - d * 0.45);
        const absU = Math.abs(u);
        if (absU <= thresh) return u;
        const sign = u < 0 ? -1 : 1;
        const excess = absU - thresh;
        const kneeRoom = Math.max(0.18, 0.52 - d * 0.22);
        return sign * (thresh + kneeRoom * Math.tanh(excess / kneeRoom));
      }
    }
  };

  const zeroBias = evalUnitSlope(0);

  for (let i = 0; i < CURVE_RESOLUTION; i++) {
    const x = (i * 2) / (CURVE_RESOLUTION - 1) - 1;
    const u = x * SAT_HEADROOM_SCALE;
    const y = (evalUnitSlope(u) - zeroBias) / SAT_HEADROOM_SCALE;
    curve[i] = Math.max(-0.9999, Math.min(0.9999, y));
  }

  curve[CURVE_RESOLUTION >> 1] = 0;
  return curve;
}

/**
 * Returns input drive gain and output compensation gain (linear) including ±8dB headroom scaling,
 * so increasing Drive adds harmonic richness without distorting loudness or hard-clipping at ±1.0.
 */
export function computeSaturationGainStaging(
  type: SaturationType,
  drive: number
): { inputGainLinear: number; outputTrimLinear: number } {
  const d = Math.max(0, Math.min(1, drive));
  if (d <= 0.002) {
    return {
      inputGainLinear: 1 / SAT_HEADROOM_SCALE,
      outputTrimLinear: SAT_HEADROOM_SCALE,
    };
  }

  const driveDb =
    type === 'tape'
      ? d * 3.8
      : type === 'tube'
      ? d * 4.2
      : type === 'transformer'
      ? d * 3.5
      : d * 3.2;

  const inputGainLinear = Math.pow(10, driveDb / 20) / SAT_HEADROOM_SCALE;
  // Gentle compensation (-85% of drive) keeps RMS cohesive without jumping level
  const compensationDb = -driveDb * 0.85;
  const outputTrimLinear = Math.pow(10, compensationDb / 20) * SAT_HEADROOM_SCALE;

  return { inputGainLinear, outputTrimLinear };
}
