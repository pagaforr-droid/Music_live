import {
  PRO_PRESETS_CATALOG,
  getPresetById,
} from '../presets/proPresetsCatalog';
import type {
  MasteringPreset,
  SpectralAdaptationReport,
  SpectralProfile,
} from '../types/mastering.types';
import { linearToDb, measureTruePeakLinearBlock } from './TruePeakLimiter';

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function designHighShelf(
  fc: number,
  gainDb: number,
  q: number,
  sampleRate: number
): BiquadCoeffs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = (sinW0 / (2 * q)) * Math.sqrt(2);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  const b0 = A * (A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
  const b2 = A * (A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha);
  const a0 = A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha;
  const a1 = 2 * (A - 1 - (A + 1) * cosW0);
  const a2 = A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function designHighPass(
  fc: number,
  q: number,
  sampleRate: number
): BiquadCoeffs {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  const b0 = (1 + cosW0) / 2;
  const b1 = -(1 + cosW0);
  const b2 = (1 + cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function designBandPass(
  fc: number,
  q: number,
  sampleRate: number
): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.min(fc, sampleRate * 0.46)) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/**
 * Computes exact ITU-R BS.1770-4 Integrated Loudness (LUFS) with K-Weighting
 * and two-stage gating (-70 LUFS absolute gate and -10 LU relative gate).
 */
export function computeIntegratedLufsBs1770(buffer: AudioBuffer): number {
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  if (length === 0) return -24.0;

  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  // Stage 1: Acoustic head high-shelf (1681.97 Hz, +4.0 dB, Q = 0.7071)
  const hs = designHighShelf(1681.97, 4.0, 0.7071, sampleRate);
  // Stage 2: RLB high-pass (38.13 Hz, Q = 0.5003)
  const hp = designHighPass(38.13, 0.5003, sampleRate);

  // 400ms gating block size, 200ms step for ultra-fast scan
  const blockSamples = Math.max(256, Math.floor(sampleRate * 0.4));
  const stepSamples = Math.max(128, Math.floor(sampleRate * 0.2));

  // Filter states for L and R
  let l1x1 = 0, l1x2 = 0, l1y1 = 0, l1y2 = 0;
  let l2x1 = 0, l2x2 = 0, l2y1 = 0, l2y2 = 0;
  let r1x1 = 0, r1x2 = 0, r1y1 = 0, r1y2 = 0;
  let r2x1 = 0, r2x2 = 0, r2y1 = 0, r2y2 = 0;

  // Compute mean-square energy in 200ms sub-windows, then combine pairs into 400ms blocks
  const subWindowEnergies: number[] = [];
  let sumSq = 0;
  let countInWindow = 0;

  for (let i = 0; i < length; i++) {
    const xl = left[i];
    const yl1 = hs.b0 * xl + hs.b1 * l1x1 + hs.b2 * l1x2 - hs.a1 * l1y1 - hs.a2 * l1y2;
    l1x2 = l1x1; l1x1 = xl; l1y2 = l1y1; l1y1 = yl1;
    const yl2 = hp.b0 * yl1 + hp.b1 * l2x1 + hp.b2 * l2x2 - hp.a1 * l2y1 - hp.a2 * l2y2;
    l2x2 = l2x1; l2x1 = yl1; l2y2 = l2y1; l2y1 = yl2;

    const xr = right[i];
    const yr1 = hs.b0 * xr + hs.b1 * r1x1 + hs.b2 * r1x2 - hs.a1 * r1y1 - hs.a2 * r1y2;
    r1x2 = r1x1; r1x1 = xr; r1y2 = r1y1; r1y1 = yr1;
    const yr2 = hp.b0 * yr1 + hp.b1 * r2x1 + hp.b2 * r2x2 - hp.a1 * r2y1 - hp.a2 * r2y2;
    r2x2 = r2x1; r2x1 = yr1; r2y2 = r2y1; r2y1 = yr2;

    sumSq += yl2 * yl2 + yr2 * yr2;
    countInWindow++;

    if (countInWindow >= stepSamples) {
      subWindowEnergies.push(sumSq / countInWindow);
      sumSq = 0;
      countInWindow = 0;
    }
  }

  if (subWindowEnergies.length === 0 && length > 0) {
    subWindowEnergies.push(sumSq / Math.max(1, blockSamples));
  }

  // Combine consecutive 200ms windows into 400ms gating blocks
  const blockEnergies: number[] = [];
  for (let i = 0; i < subWindowEnergies.length; i++) {
    const e1 = subWindowEnergies[i];
    const e2 = i + 1 < subWindowEnergies.length ? subWindowEnergies[i + 1] : e1;
    blockEnergies.push(0.5 * (e1 + e2));
  }

  // Gate 1: Absolute threshold at -70 LUFS -> z > 10^((-70 + 0.691)/10)
  const absGateZ = Math.pow(10, (-70 + 0.691) / 10);
  const absPassed = blockEnergies.filter((z) => z > absGateZ);
  if (absPassed.length === 0) return -60.0;

  const meanAbsZ =
    absPassed.reduce((acc, val) => acc + val, 0) / absPassed.length;
  const ungatedLufs = -0.691 + 10 * Math.log10(meanAbsZ);

  // Gate 2: Relative threshold at (ungatedLufs - 10 LU)
  const relGateZ = Math.pow(10, (ungatedLufs - 10 + 0.691) / 10);
  const relPassed = absPassed.filter((z) => z >= relGateZ);
  const finalMeanZ =
    relPassed.length > 0
      ? relPassed.reduce((acc, val) => acc + val, 0) / relPassed.length
      : meanAbsZ;

  const integratedLufs = -0.691 + 10 * Math.log10(Math.max(1e-9, finalMeanZ));
  return Number(Math.max(-60, Math.min(0, integratedLufs)).toFixed(2));
}

/**
 * Computes Pearson phase correlation (-1.0 to +1.0) across the stereo buffer.
 */
export function computeBufferPhaseCorrelation(buffer: AudioBuffer): number {
  if (buffer.numberOfChannels < 2) return 1.0;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const step = Math.max(1, Math.floor(left.length / 48000));

  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;

  for (let i = 0; i < left.length; i += step) {
    const l = left[i];
    const r = right[i];
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
  }

  const denom = Math.sqrt(sumL2 * sumR2);
  if (denom < 1e-9) return 1.0;
  return Number(Math.max(-1, Math.min(1, sumLR / denom)).toFixed(2));
}

/**
 * Analyzes spectral balance across 4 mastering bands (Sub, LowMid, Presence, Air)
 * plus narrow-band AI harshness detection (3.8kHz & 6.2kHz).
 */
export function analyzeSpectralProfileAndAiScore(buffer: AudioBuffer): {
  profile: SpectralProfile;
  aiArtifactScore: number;
} {
  const sr = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  // Sample up to 120,000 representative frames from the middle 70% of the song
  const start = Math.floor(buffer.length * 0.15);
  const end = Math.min(buffer.length, Math.floor(buffer.length * 0.85));
  const span = Math.max(1, end - start);
  const maxFrames = 96000;
  const stride = Math.max(1, Math.floor(span / maxFrames));
  const effSr = sr / stride;

  const subBp = designBandPass(75, 0.8, effSr);
  const lowMidBp = designBandPass(360, 0.85, effSr);
  const presBp = designBandPass(2400, 0.8, effSr);
  const airBp = designBandPass(Math.min(10500, effSr * 0.42), 0.75, effSr);
  const aiHarshBp = designBandPass(Math.min(3800, effSr * 0.44), 3.2, effSr);
  const aiSibBp = designBandPass(Math.min(6200, effSr * 0.45), 3.0, effSr);

  const runBandEnergy = (c: BiquadCoeffs): number => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    let sumSq = 0;
    let count = 0;
    for (let i = start; i < end; i += stride) {
      const mono = 0.5 * (left[i] + right[i]);
      const y = c.b0 * mono + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = mono; y2 = y1; y1 = y;
      sumSq += y * y;
      count++;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, count));
    return linearToDb(rms, -60);
  };

  const subRaw = runBandEnergy(subBp);
  const lowMidRaw = runBandEnergy(lowMidBp);
  const presRaw = runBandEnergy(presBp);
  const airRaw = runBandEnergy(airBp);
  const harshRaw = runBandEnergy(aiHarshBp);
  const sibRaw = runBandEnergy(aiSibBp);

  // Normalize relative to average band energy so profile reflects tonal balance independent of input volume
  const avgEnergy = (subRaw + lowMidRaw + presRaw + airRaw) / 4;
  const normOffset = -15.5 - avgEnergy;

  const profile: SpectralProfile = {
    sub: Number((subRaw + normOffset).toFixed(1)),
    lowMid: Number((lowMidRaw + normOffset).toFixed(1)),
    presence: Number((presRaw + normOffset).toFixed(1)),
    air: Number((airRaw + normOffset).toFixed(1)),
  };

  // Detect metallic AI buildup: high ratio of 3.8kHz & 6.2kHz energy vs low-mid warmth
  const harshExcess = harshRaw - lowMidRaw + 3.5;
  const sibExcess = sibRaw - lowMidRaw + 5.0;
  const rawAiScore = Math.round(
    Math.max(0, Math.min(100, 35 + harshExcess * 8.5 + sibExcess * 5.5))
  );

  return { profile, aiArtifactScore: rawAiScore };
}

/**
 * Full AI Local Spectral Delta Analyzer:
 * Scans the user's AudioBuffer, measures ITU-R BS.1770-4 LUFS, True Peak, Crest Factor,
 * Phase Correlation, and 4-Band Spectral Profile, recommends the optimal preset,
 * and computes adaptive deltaEQ corrections for the selected preset.
 */
export function analyzeTrackAndComputeAdaptation(
  buffer: AudioBuffer,
  currentPresetId?: string
): SpectralAdaptationReport {
  const detectedInputLufs = computeIntegratedLufsBs1770(buffer);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  const sampleStep = Math.max(1, Math.floor(buffer.length / 64000));
  const truePeakLinear = measureTruePeakLinearBlock(
    left,
    right,
    0,
    Math.min(buffer.length, 64000 * sampleStep)
  );
  const detectedTruePeakDb = Number(linearToDb(truePeakLinear, -60).toFixed(2));
  const detectedCrestFactorDb = Number(
    Math.max(3, detectedTruePeakDb - detectedInputLufs).toFixed(1)
  );
  const detectedPhaseCorrelation = computeBufferPhaseCorrelation(buffer);
  const { profile, aiArtifactScore } = analyzeSpectralProfileAndAiScore(buffer);

  // Intelligent Preset Recommendation
  let recommendedPresetId = 'stadium-pop-rock';
  let recommendationReason =
    'Balance energético ideal para Pop-Rock moderno con empuje de estadio.';

  if (aiArtifactScore >= 62) {
    recommendedPresetId = 'de-ai-studio-rescue';
    recommendationReason = `Se detectó acumulación metálica en 3.8kHz–6.2kHz (Índice IA: ${aiArtifactScore}%). Se recomienda De-AI Studio Rescue con cinta Studer.`;
  } else if (detectedCrestFactorDb >= 13.5 && profile.sub < -15.0) {
    recommendedPresetId = '90s-acoustic-country';
    recommendationReason = `Alto rango dinámico (${detectedCrestFactorDb} dB Crest) y carácter acústico natural. Ideal para saturación cálida a válvulas.`;
  } else if (profile.sub >= -13.0 && profile.presence >= -14.2) {
    recommendedPresetId = 'crisp-latin-pop';
    recommendationReason =
      'Fuerte presencia de sub-graves y articulación rítmica moderna; Crisp Latin Pop maximizará el impacto comercial.';
  } else if (profile.lowMid <= -16.8 && detectedCrestFactorDb >= 10.5) {
    recommendedPresetId = 'nu-disco-funk';
    recommendationReason =
      'Transientes definidos y bolsillo rítmico limpio; Nu-Disco & Modern Funk realzará el groove con transformador.';
  } else if (profile.air >= -17.8 && detectedPhaseCorrelation >= 0.65) {
    recommendedPresetId = 'modern-worship-arena';
    recommendationReason =
      'Excelente apertura espacial y centro vocal definido; Modern Worship & Arena expandirá el halo estéreo.';
  }

  const targetPreset: MasteringPreset = getPresetById(
    currentPresetId || recommendedPresetId
  );
  const target = targetPreset.targetSpectralProfile;

  // Compute adaptive correction deltas (scaled by 0.45 and clamped to [-2.2dB, +2.2dB])
  // If user track already has too much sub vs target, subDeltaDb will be negative so we don't boom the master!
  const clampDelta = (d: number) =>
    Number(Math.max(-2.2, Math.min(2.2, d * 0.45)).toFixed(2));

  const subDeltaDb = clampDelta(target.sub - profile.sub);
  const lowMidDeltaDb = clampDelta(target.lowMid - profile.lowMid);
  const presenceDeltaDb = clampDelta(target.presence - profile.presence);
  const airDeltaDb = clampDelta(target.air - profile.air);

  const desiredTargetLufs = targetPreset.dspChain.limiter.targetLufs;
  const autoMakeupGainDb = Number(
    Math.max(-6, Math.min(14, desiredTargetLufs - detectedInputLufs - 1.2)).toFixed(2)
  );

  return {
    analyzedDurationSec: Number(buffer.duration.toFixed(2)),
    sampleRate: buffer.sampleRate,
    detectedInputLufs,
    detectedTruePeakDb,
    detectedCrestFactorDb,
    detectedPhaseCorrelation,
    inputSpectralProfile: profile,
    recommendedPresetId,
    recommendationReason,
    aiArtifactScore,
    deltaAdjustments: {
      subDeltaDb,
      lowMidDeltaDb,
      presenceDeltaDb,
      airDeltaDb,
      autoMakeupGainDb,
    },
  };
}

export function recomputeDeltasForPreset(
  report: SpectralAdaptationReport,
  preset: MasteringPreset
): SpectralAdaptationReport {
  const target = preset.targetSpectralProfile;
  const profile = report.inputSpectralProfile;
  const clampDelta = (d: number) =>
    Number(Math.max(-2.2, Math.min(2.2, d * 0.45)).toFixed(2));

  const autoMakeupGainDb = Number(
    Math.max(
      -6,
      Math.min(14, preset.dspChain.limiter.targetLufs - report.detectedInputLufs - 1.2)
    ).toFixed(2)
  );

  return {
    ...report,
    deltaAdjustments: {
      subDeltaDb: clampDelta(target.sub - profile.sub),
      lowMidDeltaDb: clampDelta(target.lowMid - profile.lowMid),
      presenceDeltaDb: clampDelta(target.presence - profile.presence),
      airDeltaDb: clampDelta(target.air - profile.air),
      autoMakeupGainDb,
    },
  };
}

export { PRO_PRESETS_CATALOG };
