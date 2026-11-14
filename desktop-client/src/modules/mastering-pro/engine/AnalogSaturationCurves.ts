import type { SaturationType } from '../types/mastering.types';

const CURVE_RESOLUTION = 65536;

/**
 * Generates a 65,536-point Float32Array transfer curve for a 4x oversampled WaveShaperNode.
 * Every curve is strictly zero-centered at x = 0 (curve[32768] = 0) to prevent static DC offset.
 */
export function generateAnalogSaturationCurve(
  type: SaturationType,
  drive: number
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_RESOLUTION);
  const clampedDrive = Math.max(0.001, Math.min(1.0, drive));

  // Precompute f(0) to subtract any asymmetric DC bias at rest
  const evalRaw = (x: number): number => {
    switch (type) {
      case 'tape': {
        // Studer A800 style: soft hyperbolic tangent + subtle 2nd harmonic asymmetry
        const k = 1.0 + clampedDrive * 3.4;
        const asym = 0.045 * clampedDrive * x * x;
        return Math.tanh(k * x + asym) / Math.tanh(k);
      }
      case 'tube': {
        // Warm triode valve: asymmetric soft saturation favoring even harmonics
        const k = 1.0 + clampedDrive * 3.8;
        if (x >= 0) {
          return (1 - Math.exp(-k * x)) / (1 - Math.exp(-k));
        } else {
          const kn = k * 0.82;
          return -(1 - Math.exp(kn * x)) / (1 - Math.exp(-kn));
        }
      }
      case 'transformer': {
        // Neve/API iron core: dense low-mid weight with algebraic S-curve saturation
        const k = 1.0 + clampedDrive * 4.2;
        const u = k * x;
        const thirdOrder = u / Math.sqrt(1 + u * u);
        const norm = k / Math.sqrt(1 + k * k);
        const evenBias = 0.03 * clampedDrive * (x * Math.abs(x));
        return Math.max(-0.995, Math.min(0.995, thirdOrder / norm + evenBias));
      }
      case 'softclip':
      default: {
        // Mastering-grade polynomial knee clipper: 100% linear in core, smooth ceiling
        const k = 1.0 + clampedDrive * 2.8;
        const u = k * x;
        if (Math.abs(u) <= 0.65) {
          return u / k;
        }
        const sign = u < 0 ? -1 : 1;
        const excess = Math.abs(u) - 0.65;
        const compressed = 0.65 + 0.35 * Math.tanh(excess / 0.35);
        return (sign * compressed) / Math.min(1.35, 0.65 + 0.35 * Math.tanh((k - 0.65) / 0.35));
      }
    }
  };

  const zeroBias = evalRaw(0);

  for (let i = 0; i < CURVE_RESOLUTION; i++) {
    const x = (i * 2) / (CURVE_RESOLUTION - 1) - 1;
    const y = evalRaw(x) - zeroBias;
    curve[i] = Math.max(-0.9999, Math.min(0.9999, y));
  }

  // Enforce exact zero at the center index
  curve[CURVE_RESOLUTION >> 1] = 0;
  return curve;
}

/**
 * Returns input drive gain and output compensation gain (linear) so increasing Drive
 * increases harmonic richness without artificially inflating loudness.
 */
export function computeSaturationGainStaging(
  type: SaturationType,
  drive: number
): { inputGainLinear: number; outputTrimLinear: number } {
  const d = Math.max(0, Math.min(1, drive));
  const driveDb =
    type === 'tape'
      ? d * 5.5
      : type === 'tube'
      ? d * 6.0
      : type === 'transformer'
      ? d * 5.0
      : d * 4.5;

  const inputGainLinear = Math.pow(10, driveDb / 20);
  // Compensate ~72% of the input drive in dB so perceived loudness stays balanced
  const compensationDb = -driveDb * 0.72;
  const outputTrimLinear = Math.pow(10, compensationDb / 20);

  return { inputGainLinear, outputTrimLinear };
}
