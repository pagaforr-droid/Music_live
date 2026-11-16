/**
 * Equal-Power Loop Crossfade builder so looped sample regions have zero boundary discontinuity clicks.
 */

export function buildCrossfadedLoopArrays(
  sourceLeft: Float32Array,
  sourceRight: Float32Array,
  sampleRate: number,
  loopStartSample: number,
  loopEndSample: number,
  crossfadeMs: number
): { left: Float32Array; right: Float32Array } {
  const start = Math.max(0, Math.min(sourceLeft.length - 2, loopStartSample));
  const end = Math.max(start + 2, Math.min(sourceLeft.length, loopEndSample));
  const loopLen = end - start;

  const outL = new Float32Array(sourceLeft.subarray(start, end));
  const outR = new Float32Array(sourceRight.subarray(start, end));

  const reqFadeSamples = Math.round((Math.max(0, crossfadeMs) / 1000) * sampleRate);
  const fadeSamples = Math.min(
    Math.floor(loopLen * 0.4),
    Math.min(reqFadeSamples, start) // need pre-loopStart tail to blend cleanly
  );

  if (fadeSamples < 8) {
    // Minimal 32-sample de-click taper if no pre-start margin
    const minTaper = Math.min(32, Math.floor(loopLen / 4));
    for (let i = 0; i < minTaper; i++) {
      const g = i / minTaper;
      outL[i] *= g;
      outR[i] *= g;
      outL[loopLen - 1 - i] *= g;
      outR[loopLen - 1 - i] *= g;
    }
    return { left: outL, right: outR };
  }

  // Blend pre-loopStart samples into tail with S-curve equal-power law (cos^2 + sin^2 = 1 AND zero endpoint slope kink)
  for (let i = 0; i < fadeSamples; i++) {
    const t = i / (fadeSamples - 1);
    const theta = (0.5 - 0.5 * Math.cos(Math.PI * t)) * Math.PI * 0.5;
    const fadeOutGain = Math.cos(theta);
    const fadeInGain = Math.sin(theta);

    const tailIdx = loopLen - fadeSamples + i;
    const preLoopIdx = start - fadeSamples + i;

    outL[tailIdx] = outL[tailIdx] * fadeOutGain + sourceLeft[preLoopIdx] * fadeInGain;
    outR[tailIdx] = outR[tailIdx] * fadeOutGain + sourceRight[preLoopIdx] * fadeInGain;
  }

  return { left: outL, right: outR };
}

/**
 * Verifies loop seam smoothness using second-order slope extrapolation across wraparound
 * against loop RMS (target <= -55 dB -> free of boundary click discontinuity).
 */
export function measureLoopDiscontinuityDb(samples: Float32Array): number {
  if (samples.length < 4) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const rms = Math.max(1e-7, Math.sqrt(sumSq / samples.length));
  const extrapolatedNext = 2 * samples[samples.length - 1] - samples[samples.length - 2];
  const seamJump = Math.abs(samples[0] - extrapolatedNext);
  return Number((20 * Math.log10(Math.max(1e-9, seamJump) / rms)).toFixed(1));
}
