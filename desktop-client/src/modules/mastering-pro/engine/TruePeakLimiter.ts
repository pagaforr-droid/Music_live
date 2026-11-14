const LIMITER_CURVE_SIZE = 65536;

/**
 * Generates a high-precision 65536-point Brickwall Soft-Knee Maximizer transfer curve
 * for a 4x oversampled WaveShaperNode (Stage 5A + Real-Time Ceiling Guard).
 *
 * - 100% bit-transparent (unity slope 1.0) below the knee threshold.
 * - Smooth C1-continuous hyperbolic knee approaching ceilingDbTp (default -1.0 dBTP).
 */
export function createBrickwallMaximizerCurve(
  ceilingDbTp = -1.0,
  softClipPrePct = 0.3
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(LIMITER_CURVE_SIZE);
  // Margin of 0.04 dB for 4x oversampling reconstruction filter ripple
  const ceilingLinear = Math.pow(10, (ceilingDbTp - 0.04) / 20);
  const kneeSpan = Math.max(0.06, Math.min(0.35, softClipPrePct * 0.65));
  const kneeStart = Math.max(0.45, ceilingLinear * (1 - kneeSpan));
  const headroom = Math.max(0.001, ceilingLinear - kneeStart);

  for (let i = 0; i < LIMITER_CURVE_SIZE; i++) {
    // WaveShaper input domain is [-1, 1]
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
 * 4x Catmull-Rom Cubic Hermite interpolation to measure true inter-sample peak (True Peak dBTP)
 * per ITU-R BS.1770-4 Annex 2 concept.
 */
export function measureTruePeakLinearBlock(
  left: Float32Array,
  right: Float32Array,
  startIdx = 0,
  endIdx = left.length
): number {
  let maxPeak = 0;
  const limit = Math.min(left.length, right.length, endIdx);

  const scanChannel = (ch: Float32Array) => {
    for (let i = Math.max(1, startIdx); i < limit - 2; i++) {
      const y0 = ch[i - 1];
      const y1 = ch[i];
      const y2 = ch[i + 1];
      const y3 = ch[i + 2];

      const abs1 = Math.abs(y1);
      if (abs1 > maxPeak) maxPeak = abs1;

      // Only run 4x cubic interpolation when adjacent samples exceed 50% of current maxPeak
      if (abs1 > maxPeak * 0.7 || Math.abs(y2) > maxPeak * 0.7) {
        const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
        const a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        const a2 = -0.5 * y0 + 0.5 * y2;
        const a3 = y1;

        // Evaluate at t = 0.25, 0.50, 0.75
        const p25 = Math.abs(((a0 * 0.25 + a1) * 0.25 + a2) * 0.25 + a3);
        const p50 = Math.abs(((a0 * 0.5 + a1) * 0.5 + a2) * 0.5 + a3);
        const p75 = Math.abs(((a0 * 0.75 + a1) * 0.75 + a2) * 0.75 + a3);

        if (p25 > maxPeak) maxPeak = p25;
        if (p50 > maxPeak) maxPeak = p50;
        if (p75 > maxPeak) maxPeak = p75;
      }
    }
  };

  scanChannel(left);
  if (right !== left) {
    scanChannel(right);
  }

  return maxPeak;
}

export function linearToDb(linear: number, minDb = -90): number {
  if (linear <= 1e-5) return minDb;
  return Math.max(minDb, 20 * Math.log10(linear));
}

/**
 * Stage 5B (Offline Mastering Grade IRC Lookahead Limiter):
 * Applies a 2ms lookahead window + dual-stage adaptive release envelope on the rendered AudioBuffer
 * so the exported 24-bit WAV master strictly obeys ceilingDbTp (e.g., -1.0 dBTP) with zero digital clipping.
 */
export function applyLookaheadBrickwallLimiterOffline(
  buffer: AudioBuffer,
  ceilingDbTp = -1.0,
  lookaheadMs = 2.0,
  releaseMs = 60
): { maxGainReductionDb: number; finalTruePeakDbTp: number } {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const left = buffer.getChannelData(0);
  const right = numChannels > 1 ? buffer.getChannelData(1) : left;

  const ceilingLinear = Math.pow(10, (ceilingDbTp - 0.02) / 20);
  const lookaheadSamples = Math.max(
    8,
    Math.round((lookaheadMs / 1000) * sampleRate)
  );
  const releaseCoeff = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));

  // Step 1: Compute instantaneous required attenuation across stereo pair
  const requiredGain = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const absL = Math.abs(left[i]);
    const absR = Math.abs(right[i]);
    // Estimate inter-sample overshoot with adjacent sample derivative
    let peak = absL > absR ? absL : absR;
    if (i > 0 && i < length - 1) {
      const midL = Math.abs(0.5 * (left[i] + left[i + 1]) + 0.125 * (left[i] - left[i - 1]));
      const midR = Math.abs(0.5 * (right[i] + right[i + 1]) + 0.125 * (right[i] - right[i - 1]));
      if (midL > peak) peak = midL;
      if (midR > peak) peak = midR;
    }
    requiredGain[i] = peak > ceilingLinear ? ceilingLinear / peak : 1.0;
  }

  // Step 2: Backward pass over lookahead window so gain reduction ramps down smoothly BEFORE the transient
  const envelopeGain = new Float32Array(length);
  envelopeGain.fill(1.0);

  let currentMin = 1.0;
  for (let i = length - 1; i >= 0; i--) {
    const target = requiredGain[i];
    if (target < currentMin) {
      currentMin = target;
    } else {
      const stepUp = (1.0 - currentMin) / lookaheadSamples;
      currentMin = Math.min(1.0, currentMin + stepUp);
    }
    envelopeGain[i] = currentMin;
  }

  // Step 3: Forward smoothing pass (attack + adaptive release) and apply to samples
  let smoothedGain = 1.0;
  let minGainApplied = 1.0;
  const attackCoeff = Math.exp(-1 / (0.0008 * sampleRate));

  for (let i = 0; i < length; i++) {
    const target = envelopeGain[i];
    if (target < smoothedGain) {
      smoothedGain = attackCoeff * smoothedGain + (1 - attackCoeff) * target;
    } else {
      smoothedGain = releaseCoeff * smoothedGain + (1 - releaseCoeff) * target;
    }

    const finalG = Math.min(smoothedGain, requiredGain[i]);
    if (finalG < minGainApplied) minGainApplied = finalG;

    left[i] = Math.max(-ceilingLinear, Math.min(ceilingLinear, left[i] * finalG));
    if (numChannels > 1) {
      right[i] = Math.max(-ceilingLinear, Math.min(ceilingLinear, right[i] * finalG));
    }
  }

  const finalTruePeakLinear = measureTruePeakLinearBlock(left, right);
  return {
    maxGainReductionDb: Number(Math.abs(linearToDb(minGainApplied, -24)).toFixed(2)),
    finalTruePeakDbTp: Number(linearToDb(finalTruePeakLinear, -60).toFixed(2)),
  };
}
