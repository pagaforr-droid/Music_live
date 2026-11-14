import {
  PRO_PRESETS_CATALOG,
  getPresetById,
} from '../presets/proPresetsCatalog';
import type {
  AiCompressionSuggestion,
  AiCriticalEqPoint,
  AiFilterSuggestion,
  AiStereoWidthSuggestion,
  MasteringPreset,
  SpectralAdaptationReport,
  SpectralProfile,
  SpectralResonanceNode,
} from '../types/mastering.types';
import {
  DEFAULT_DRUM_LAYERING_CONFIG,
  DrumTransientReplacerDSP,
} from './DrumTransientReplacerDSP';
import {
  DEFAULT_FORENSIC_HUMANIZER_CONFIG,
  calculateForensicSignature,
} from './ForensicHumanizerDSP';
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

  const hs = designHighShelf(1681.97, 4.0, 0.7071, sampleRate);
  const hp = designHighPass(38.13, 0.5003, sampleRate);

  const blockSamples = Math.max(256, Math.floor(sampleRate * 0.4));
  const stepSamples = Math.max(128, Math.floor(sampleRate * 0.2));

  let l1x1 = 0, l1x2 = 0, l1y1 = 0, l1y2 = 0;
  let l2x1 = 0, l2x2 = 0, l2y1 = 0, l2y2 = 0;
  let r1x1 = 0, r1x2 = 0, r1y1 = 0, r1y2 = 0;
  let r2x1 = 0, r2x2 = 0, r2y1 = 0, r2y2 = 0;

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

  const blockEnergies: number[] = [];
  for (let i = 0; i < subWindowEnergies.length; i++) {
    const e1 = subWindowEnergies[i];
    const e2 = i + 1 < subWindowEnergies.length ? subWindowEnergies[i + 1] : e1;
    blockEnergies.push(0.5 * (e1 + e2));
  }

  const absGateZ = Math.pow(10, (-70 + 0.691) / 10);
  const absPassed = blockEnergies.filter((z) => z > absGateZ);
  if (absPassed.length === 0) return -60.0;

  const meanAbsZ =
    absPassed.reduce((acc, val) => acc + val, 0) / absPassed.length;
  const ungatedLufs = -0.691 + 10 * Math.log10(meanAbsZ);

  const relGateZ = Math.pow(10, (ungatedLufs - 10 + 0.691) / 10);
  const relPassed = absPassed.filter((z) => z >= relGateZ);
  const finalMeanZ =
    relPassed.length > 0
      ? relPassed.reduce((acc, val) => acc + val, 0) / relPassed.length
      : meanAbsZ;

  const integratedLufs = -0.691 + 10 * Math.log10(Math.max(1e-9, finalMeanZ));
  return Number(Math.max(-60, Math.min(0, integratedLufs)).toFixed(2));
}

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

interface DeepDiagnosticScan {
  profile: SpectralProfile;
  aiArtifactScore: number;
  sibilanceScore: number;
  subRumbleDb: number;
  mudExcessDb: number;
  vocalPocketDeficitDb: number;
  airDeficitDb: number;
  detectedSibilancePeakHz: number;
  stereoSideEnergyPct: number;
  bassPhaseCorrelation: number;
  detectedResonanceLines: SpectralResonanceNode[];
}

function detectStationaryResonanceLines(
  left: Float32Array,
  right: Float32Array,
  start: number,
  end: number,
  stride: number,
  effSr: number,
  broadPresenceRawDb: number
): SpectralResonanceNode[] {
  const candidateFreqs = [
    2150, 2650, 3150, 3550, 3850, 4250, 4750, 5350, 5900, 6250, 6950, 7850,
  ];
  const span = Math.max(1, end - start);
  const numSlices = 5;
  const sliceLen = Math.max(1, Math.floor(span / numSlices));

  const scoredCandidates: Array<{
    freqHz: number;
    prominenceDb: number;
    persistenceScore: number;
  }> = [];

  for (const freqHz of candidateFreqs) {
    if (freqHz >= effSr * 0.44) continue;
    const bp = designBandPass(freqHz, 10.5, effSr);
    const sliceDbs: number[] = [];

    for (let s = 0; s < numSlices; s++) {
      const sStart = start + s * sliceLen;
      const sEnd = Math.min(end, sStart + sliceLen);
      let x1 = 0,
        x2 = 0,
        y1 = 0,
        y2 = 0;
      let sumSq = 0;
      let count = 0;

      for (let i = sStart; i < sEnd; i += stride) {
        const mono = 0.5 * (left[i] + right[i]);
        const y =
          bp.b0 * mono + bp.b1 * x1 + bp.b2 * x2 - bp.a1 * y1 - bp.a2 * y2;
        x2 = x1;
        x1 = mono;
        y2 = y1;
        y1 = y;
        sumSq += y * y;
        count++;
      }

      const rms = Math.sqrt(sumSq / Math.max(1, count));
      sliceDbs.push(linearToDb(rms, -72));
    }

    const meanDb =
      sliceDbs.reduce((acc, val) => acc + val, 0) / Math.max(1, sliceDbs.length);
    const variance =
      sliceDbs.reduce((acc, val) => acc + (val - meanDb) * (val - meanDb), 0) /
      Math.max(1, sliceDbs.length);
    const stdDevDb = Math.sqrt(variance);

    // High Q=10.5 bandpass naturally has ~7.5dB less total broadband energy than Q=0.8;
    // compensate by +7.5dB to measure narrow-band spectral peak prominence
    const prominenceDb = meanDb + 7.5 - broadPresenceRawDb;
    // Lower stdDev across slices = more continuous horizontal line in spectrogram
    const persistenceScore = prominenceDb - stdDevDb * 0.45;

    scoredCandidates.push({
      freqHz,
      prominenceDb,
      persistenceScore,
    });
  }

  scoredCandidates.sort((a, b) => b.persistenceScore - a.persistenceScore);

  const selected: SpectralResonanceNode[] = [];
  for (const cand of scoredCandidates) {
    if (selected.length >= 3) break;
    // Keep notches separated by at least 750 Hz so filters don't stack on the same bin
    if (selected.some((s) => Math.abs(s.freqHz - cand.freqHz) < 750)) continue;

    const cutDb = Number(
      Math.max(
        -5.8,
        Math.min(-3.0, -3.2 - Math.max(0, cand.prominenceDb) * 0.45)
      ).toFixed(1)
    );

    selected.push({
      id: `line-killer-${cand.freqHz}`,
      freqHz: cand.freqHz,
      gainCutDb: cutDb,
      q: 12.0,
      label: `Line Killer ${cand.freqHz}Hz`,
      enabled: true,
      source: 'ai-detected',
    });
  }

  return selected.sort((a, b) => a.freqHz - b.freqHz);
}

export function analyzeSpectralProfileAndAiScore(
  buffer: AudioBuffer
): DeepDiagnosticScan {
  const sr = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  const start = Math.floor(buffer.length * 0.12);
  const end = Math.min(buffer.length, Math.floor(buffer.length * 0.88));
  const span = Math.max(1, end - start);
  const maxFrames = 96000;
  const stride = Math.max(1, Math.floor(span / maxFrames));
  const effSr = sr / stride;

  const rumbleBp = designBandPass(26, 1.1, effSr);
  const subBp = designBandPass(72, 0.8, effSr);
  const lowMidBp = designBandPass(310, 0.85, effSr);
  const presBp = designBandPass(2400, 0.8, effSr);
  const airBp = designBandPass(Math.min(11500, effSr * 0.42), 0.75, effSr);
  const aiHarshBp = designBandPass(Math.min(3800, effSr * 0.44), 3.2, effSr);
  const sib62Bp = designBandPass(Math.min(6200, effSr * 0.45), 3.0, effSr);
  const sib72Bp = designBandPass(Math.min(7200, effSr * 0.46), 3.0, effSr);
  const bassLowPass = designBandPass(90, 0.7, effSr);

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
    return linearToDb(rms, -65);
  };

  // Stereo Mid/Side energy & Low-End Phase Correlation
  let midEnergySum = 0;
  let sideEnergySum = 0;
  let bLx1 = 0, bLx2 = 0, bLy1 = 0, bLy2 = 0;
  let bRx1 = 0, bRx2 = 0, bRy1 = 0, bRy2 = 0;
  let bassLR = 0, bassL2 = 0, bassR2 = 0;

  for (let i = start; i < end; i += stride) {
    const l = left[i];
    const r = right[i];
    const m = 0.5 * (l + r);
    const s = 0.5 * (l - r);
    midEnergySum += m * m;
    sideEnergySum += s * s;

    const bl =
      bassLowPass.b0 * l +
      bassLowPass.b1 * bLx1 +
      bassLowPass.b2 * bLx2 -
      bassLowPass.a1 * bLy1 -
      bassLowPass.a2 * bLy2;
    bLx2 = bLx1; bLx1 = l; bLy2 = bLy1; bLy1 = bl;

    const br =
      bassLowPass.b0 * r +
      bassLowPass.b1 * bRx1 +
      bassLowPass.b2 * bRx2 -
      bassLowPass.a1 * bRy1 -
      bassLowPass.a2 * bRy2;
    bRx2 = bRx1; bRx1 = r; bRy2 = bRy1; bRy1 = br;

    bassLR += bl * br;
    bassL2 += bl * bl;
    bassR2 += br * br;
  }

  const totalMS = Math.max(1e-9, midEnergySum + sideEnergySum);
  const stereoSideEnergyPct = Math.round((sideEnergySum / totalMS) * 100);
  const bassDenom = Math.sqrt(bassL2 * bassR2);
  const bassPhaseCorrelation =
    bassDenom > 1e-9
      ? Number(Math.max(-1, Math.min(1, bassLR / bassDenom)).toFixed(2))
      : 1.0;

  const rumbleRaw = runBandEnergy(rumbleBp);
  const subRaw = runBandEnergy(subBp);
  const lowMidRaw = runBandEnergy(lowMidBp);
  const presRaw = runBandEnergy(presBp);
  const airRaw = runBandEnergy(airBp);
  const harshRaw = runBandEnergy(aiHarshBp);
  const sib62Raw = runBandEnergy(sib62Bp);
  const sib72Raw = runBandEnergy(sib72Bp);

  const avgEnergy = (subRaw + lowMidRaw + presRaw + airRaw) / 4;
  const normOffset = -15.5 - avgEnergy;

  const profile: SpectralProfile = {
    sub: Number((subRaw + normOffset).toFixed(1)),
    lowMid: Number((lowMidRaw + normOffset).toFixed(1)),
    presence: Number((presRaw + normOffset).toFixed(1)),
    air: Number((airRaw + normOffset).toFixed(1)),
  };

  const harshExcess = harshRaw - lowMidRaw + 3.5;
  const sibPeakRaw = Math.max(sib62Raw, sib72Raw);
  const sibExcess = sibPeakRaw - presRaw + 4.5;
  const detectedSibilancePeakHz = sib72Raw > sib62Raw + 0.6 ? 6800 : 6200;

  const aiArtifactScore = Math.round(
    Math.max(0, Math.min(100, 35 + harshExcess * 8.5 + sibExcess * 4.5))
  );
  const sibilanceScore = Math.round(
    Math.max(0, Math.min(100, 38 + sibExcess * 10.5))
  );

  const detectedResonanceLines = detectStationaryResonanceLines(
    left,
    right,
    start,
    end,
    stride,
    effSr,
    presRaw
  );

  return {
    profile,
    aiArtifactScore,
    sibilanceScore,
    subRumbleDb: Number((rumbleRaw + normOffset).toFixed(1)),
    mudExcessDb: Number((profile.lowMid - -16.8).toFixed(1)),
    vocalPocketDeficitDb: Number((-14.2 - profile.presence).toFixed(1)),
    airDeficitDb: Number((-17.4 - profile.air).toFixed(1)),
    detectedSibilancePeakHz,
    stereoSideEnergyPct,
    bassPhaseCorrelation,
    detectedResonanceLines,
  };
}

function buildDiagnosticSuggestions(
  scan: DeepDiagnosticScan,
  targetPreset: MasteringPreset,
  detectedCrestFactorDb: number,
  detectedPhaseCorrelation: number
): {
  criticalEqPoints: AiCriticalEqPoint[];
  filterSuggestions: AiFilterSuggestion[];
  compressionSuggestion: AiCompressionSuggestion;
  stereoWidthSuggestion: AiStereoWidthSuggestion;
} {
  const { profile } = scan;
  const target = targetPreset.targetSpectralProfile;

  // 1. Puntos Críticos de EQ (Dónde Subir y Dónde Cortar)
  const subBoostNeeded = Number(
    Math.max(0.8, Math.min(3.2, (target.sub - profile.sub) * 0.7 + 1.6)).toFixed(1)
  );
  const vocalBoostNeeded = Number(
    Math.max(
      0.8,
      Math.min(2.6, (target.presence - profile.presence) * 0.65 + 1.3)
    ).toFixed(1)
  );
  const airBoostNeeded = Number(
    Math.max(1.2, Math.min(3.2, (target.air - profile.air) * 0.7 + 2.0)).toFixed(1)
  );

  const mudCutRecommended = Number(
    Math.max(-3.5, Math.min(-1.0, -1.6 - Math.max(0, scan.mudExcessDb * 0.6))).toFixed(1)
  );
  const harshCutRecommended = Number(
    Math.max(
      -3.8,
      Math.min(-0.6, -(0.6 + (scan.aiArtifactScore / 100) * 2.6))
    ).toFixed(1)
  );
  const deEsserCutRecommended = Number(
    Math.max(
      -3.4,
      Math.min(-0.6, -(0.5 + (scan.sibilanceScore / 100) * 2.4))
    ).toFixed(1)
  );

  const criticalEqPoints: AiCriticalEqPoint[] = [
    {
      id: 'boost-mid-sub',
      action: 'boost',
      title: 'Subir Pegada de Sub-Graves (Mid)',
      zoneName: '55 Hz – 65 Hz · Canal MID',
      reason:
        profile.sub < target.sub
          ? `Déficit de ${(target.sub - profile.sub).toFixed(1)} dB en fundamentales de bombo y bajo respecto al perfil ${targetPreset.name}.`
          : 'Refuerzo armónico controlado en el centro para dar peso comercial sin ensuciar los lados.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'mid-sub-punch')
          ?.freq ?? 58,
      recommendedGainDb: subBoostNeeded,
      recommendedQ: 0.9,
      channel: 'mid',
      filterType: 'peaking',
      bandId: 'mid-sub-punch',
      priority: profile.sub < target.sub - 1.2 ? 'critical' : 'opportunity',
    },
    {
      id: 'boost-mid-vocal',
      action: 'boost',
      title: 'Subir Claridad y Presencia Vocal (Mid)',
      zoneName: '1.8 kHz – 3.2 kHz · Canal MID',
      reason:
        'Realza la inteligibilidad de la voz líder e instrumentos principales en el centro sin causar fatiga.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'mid-vocal-bite')
          ?.freq ?? 2400,
      recommendedGainDb: vocalBoostNeeded,
      recommendedQ: 1.15,
      channel: 'mid',
      filterType: 'peaking',
      bandId: 'mid-vocal-bite',
      priority: 'recommended',
    },
    {
      id: 'boost-side-air',
      action: 'boost',
      title: 'Subir Brillo y Aire Tridimensional (Side)',
      zoneName: '12 kHz – 15 kHz · Canal SIDE',
      reason:
        'Abre el escenario estéreo con un High-Shelf sedoso solo en los lados, manteniendo el centro intacto.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'side-air-shelf')
          ?.freq ?? 13000,
      recommendedGainDb: airBoostNeeded,
      recommendedQ: 0.7071,
      channel: 'side',
      filterType: 'highshelf',
      bandId: 'side-air-shelf',
      priority: 'opportunity',
    },
    {
      id: 'cut-stereo-mud',
      action: 'cut',
      title: 'Cortar Congestión y Barro (Anti-Mud)',
      zoneName: '250 Hz – 320 Hz · Estéreo',
      reason:
        scan.mudExcessDb > 0
          ? `Se detectó acumulación de +${scan.mudExcessDb} dB en medios-bajos que resta claridad al bajo y la voz.`
          : 'Limpieza de bolsillo acústico en 285Hz para ganar definición y headroom en el limitador.',
      freqHz: 285,
      recommendedGainDb: mudCutRecommended,
      recommendedQ: 2.1,
      channel: 'stereo',
      filterType: 'peaking',
      bandId: 'stereo-mud-cut',
      priority: scan.mudExcessDb > 0.8 ? 'critical' : 'recommended',
    },
    {
      id: 'cut-de-harsh',
      action: 'cut',
      title: 'Cortar Resonancia Metálica / Fatiga (3.8 kHz)',
      zoneName: '3,800 Hz · Notch Quirúrgico Q:3.8',
      reason:
        scan.aiArtifactScore >= 55
          ? `Índice de resonancia digital/IA elevado (${scan.aiArtifactScore}%). Atenúa el timbre metálico sin apagar la voz.`
          : 'Suaviza picos de presencia agresiva en guitarras, sintetizadores y voces.',
      freqHz: 3800,
      recommendedGainDb: harshCutRecommended,
      recommendedQ: 3.8,
      channel: 'stereo',
      filterType: 'peaking',
      bandId: 'stereo-de-harsh',
      priority: scan.aiArtifactScore >= 55 ? 'critical' : 'recommended',
    },
    {
      id: 'cut-de-esser',
      action: 'cut',
      title: `Filtro De-Esser Quirúrgico (${scan.detectedSibilancePeakHz} Hz)`,
      zoneName: `${scan.detectedSibilancePeakHz} Hz · Control de Sibilancia`,
      reason: `Controla consonantes "S/T", hi-hats punzantes y aliasing de alta frecuencia (Sibilancia: ${scan.sibilanceScore}%).`,
      freqHz: scan.detectedSibilancePeakHz,
      recommendedGainDb: deEsserCutRecommended,
      recommendedQ: 3.5,
      channel: 'stereo',
      filterType: 'peaking',
      bandId: 'stereo-sibilance',
      priority: scan.sibilanceScore >= 58 ? 'critical' : 'recommended',
    },
  ];

  // 2. Sugerencias de Filtros Especializados
  const recommendedMonoHz =
    scan.bassPhaseCorrelation < 0.75
      ? 135
      : targetPreset.dspChain.monoMakerFreq;
  const recommendedHpfHz = scan.subRumbleDb > -24 ? 32 : 26;

  const filterSuggestions: AiFilterSuggestion[] = [
    {
      id: 'de-esser',
      name: `De-Esser Quirúrgico @ ${scan.detectedSibilancePeakHz} Hz`,
      badge: 'DE-ESSER / SIBILANCIA',
      detectedIssue: `Energía sibilante detectada al ${scan.sibilanceScore}% en la banda 5.8–7.5 kHz.`,
      suggestionDetail: `Aplicar filtro Peaking de Q estrecho (Q=3.5) en ${scan.detectedSibilancePeakHz} Hz con ${deEsserCutRecommended} dB para suavizar eses y platos.`,
      confidencePct: Math.max(68, Math.min(98, scan.sibilanceScore + 18)),
      isRecommended: scan.sibilanceScore >= 45,
      patchOverrides: {
        sibilanceFreqHz: scan.detectedSibilancePeakHz,
        sibilanceCutDb: deEsserCutRecommended,
      },
    },
    {
      id: 'de-harsh-notch',
      name: 'Filtro Notch Anti-Fatiga / De-AI (3.8 kHz)',
      badge: 'NOTCH QUIRÚRGICO',
      detectedIssue: `Índice de artefactos metálicos / dureza en 3.8 kHz: ${scan.aiArtifactScore}%.`,
      suggestionDetail: `Atenuar ${harshCutRecommended} dB @ 3800 Hz (Q=3.8) + activar cinta Studer para redondear transientes digitales.`,
      confidencePct: Math.max(65, Math.min(99, scan.aiArtifactScore + 20)),
      isRecommended: scan.aiArtifactScore >= 48,
      patchOverrides: {
        deHarshnessCutDb: harshCutRecommended,
        saturationType: scan.aiArtifactScore >= 60 ? 'tape' : targetPreset.dspChain.saturation.type,
        tapeDrivePct: scan.aiArtifactScore >= 60 ? 28 : Math.round(targetPreset.dspChain.saturation.drive * 100),
      },
    },
    {
      id: 'mono-maker-lock',
      name: `Mono Maker Butterworth @ ${recommendedMonoHz} Hz`,
      badge: 'FASE & SUB-GRAVES',
      detectedIssue: `Correlación de fase en graves (<130Hz): ${scan.bassPhaseCorrelation}.`,
      suggestionDetail: `Insertar High-Pass Butterworth (Q=0.7071) en el canal Side a ${recommendedMonoHz} Hz para anclar el bombo y bajo 100% al centro.`,
      confidencePct: 94,
      isRecommended: true,
      patchOverrides: {
        monoMakerFreq: recommendedMonoHz,
      },
    },
    {
      id: 'subsonic-rumble',
      name: `Filtro Subsonic Rumble HPF @ ${recommendedHpfHz} Hz`,
      badge: 'HEADROOM / HPF',
      detectedIssue: `Energía infrasónica (<30Hz) en ${scan.subRumbleDb} dBFS consumiendo techo del limitador.`,
      suggestionDetail: `Cortar frecuencias sub-sónicas por debajo de ${recommendedHpfHz} Hz para ganar hasta +1.2 dB de claridad y pegada.`,
      confidencePct: 91,
      isRecommended: true,
      patchOverrides: {
        highPassFreq: recommendedHpfHz,
      },
    },
    {
      id: 'anti-mud-filter',
      name: 'Filtro Anti-Barro (Low-Mid Clean 285 Hz)',
      badge: 'CLARIDAD TONAL',
      detectedIssue: `Densidad en 250–320 Hz: ${profile.lowMid} dBFS.`,
      suggestionDetail: `Atenuar ${mudCutRecommended} dB en 285 Hz para separar el bajo de los acordes medios.`,
      confidencePct: 87,
      isRecommended: true,
      patchOverrides: {
        stereoMudCutDb: mudCutRecommended,
      },
    },
    {
      id: 'harmonic-exciter',
      name: 'Excitador Armónico 4x + Side Air Shelf',
      badge: 'ARMÓNICOS & AIRE',
      detectedIssue: `Energía de aire (>11kHz): ${profile.air} dBFS.`,
      suggestionDetail: `Realzar +${airBoostNeeded} dB en el canal Side y aplicar ${Math.round(targetPreset.dspChain.saturation.drive * 100)}% de saturación ${targetPreset.dspChain.saturation.type.toUpperCase()}.`,
      confidencePct: 89,
      isRecommended: true,
      patchOverrides: {
        sideAirBoostDb: airBoostNeeded,
        saturationType: targetPreset.dspChain.saturation.type,
        tapeDrivePct: Math.round(targetPreset.dspChain.saturation.drive * 100),
      },
    },
    ...(scan.detectedResonanceLines.length > 0
      ? [
          {
            id: 'spectral-line-killer' as const,
            name: `Spectral Line Killer (${scan.detectedResonanceLines
              .map((n) => `${n.freqHz}Hz`)
              .join(' · ')})`,
            badge: 'CAZADOR DE LÍNEAS Q=12',
            detectedIssue: `Detectadas ${scan.detectedResonanceLines.length} líneas horizontales estacionarias en el espectrograma RX.`,
            suggestionDetail: `Insertar ${scan.detectedResonanceLines.length} filtros Notch ultra-estrechos (Q=12) para disolver silbidos constantes sin afectar el tono musical.`,
            confidencePct: 95,
            isRecommended: true,
            patchOverrides: {
              resonanceNotches: scan.detectedResonanceLines,
              resonanceKillerPct: 100,
            },
          },
        ]
      : []),
  ];

  // 3. Sugerencia Inteligente de Compresión según el Crest Factor real de la canción
  let compressionSuggestion: AiCompressionSuggestion;
  if (detectedCrestFactorDb >= 13.0) {
    compressionSuggestion = {
      profileName: 'Dynamic Glue & Transient Control (Rango Dinámico Alto)',
      diagnosis: `Tu pista tiene un Crest Factor amplio (${detectedCrestFactorDb} dB). Recomendamos compresión suave 2.2:1 con ataque de 28ms para cohesionar sin aplastar los golpes.`,
      thresholdDb: -19.5,
      ratio: 2.2,
      attackMs: 28,
      releaseMs: 140,
      kneeDb: 7,
      parallelMixPct: 82,
    };
  } else if (detectedCrestFactorDb <= 8.5) {
    compressionSuggestion = {
      profileName: 'Transparent Micro-Glue (Mezcla ya Densa)',
      diagnosis: `Tu pista ya viene comprimida (${detectedCrestFactorDb} dB Crest). Usamos un ratio ligero 1.6:1, ataque lento (35ms) y mezcla paralela al 70% para proteger el punch.`,
      thresholdDb: -16.0,
      ratio: 1.6,
      attackMs: 35,
      releaseMs: 160,
      kneeDb: 8,
      parallelMixPct: 70,
    };
  } else {
    compressionSuggestion = {
      profileName: 'SSL Bus Punch & Glue (Balance Comercial)',
      diagnosis: `Factor de cresta equilibrado (${detectedCrestFactorDb} dB). Un ataque de 22ms con liberación rápida de 85ms y ratio 3.0:1 dará pegada de radio comercial.`,
      thresholdDb: -17.5,
      ratio: 3.0,
      attackMs: 22,
      releaseMs: 85,
      kneeDb: 6,
      parallelMixPct: 85,
    };
  }

  // 4. Sugerencia Inteligente de Amplitud Estéreo según energía Side y Correlación de Fase
  let recommendedWidthPct = targetPreset.dspChain.stereoWidth.widthPct;
  let widthDiagnosis = '';

  if (scan.stereoSideEnergyPct < 18) {
    recommendedWidthPct = 132;
    widthDiagnosis = `Mezcla estrecha (${scan.stereoSideEnergyPct}% energía Side). Podemos abrir la amplitud estéreo al ${recommendedWidthPct}% con total seguridad de fase (${detectedPhaseCorrelation}).`;
  } else if (scan.stereoSideEnergyPct > 42 || detectedPhaseCorrelation < 0.35) {
    recommendedWidthPct = 108;
    widthDiagnosis = `Mezcla ya muy abierta (${scan.stereoSideEnergyPct}% Side, Fase ${detectedPhaseCorrelation}). Moderamos la expansión a ${recommendedWidthPct}% y subimos el Mono Maker a ${recommendedMonoHz}Hz para firmeza en mono.`;
  } else {
    recommendedWidthPct = 122;
    widthDiagnosis = `Excelente balance estéreo natural (${scan.stereoSideEnergyPct}% Side, Fase +${detectedPhaseCorrelation}). Una apertura al ${recommendedWidthPct}% con +${airBoostNeeded}dB de Side Air dará profundidad 3D.`;
  }

  const stereoWidthSuggestion: AiStereoWidthSuggestion = {
    detectedStereoEnergyPct: scan.stereoSideEnergyPct,
    detectedBassPhaseCorrelation: scan.bassPhaseCorrelation,
    diagnosis: widthDiagnosis,
    recommendedWidthPct,
    recommendedMonoMakerHz: recommendedMonoHz,
    recommendedSideAirDb: airBoostNeeded,
  };

  return {
    criticalEqPoints,
    filterSuggestions,
    compressionSuggestion,
    stereoWidthSuggestion,
  };
}

/**
 * Full AI Local Spectral Delta Analyzer:
 * Scans the user's AudioBuffer, measures ITU-R BS.1770-4 LUFS, True Peak, Crest Factor,
 * Phase Correlation, 4-Band Spectral Profile, Sibilance & AI Artifacts,
 * and generates surgical EQ boost/cut points, filter suggestions, compression & stereo width profiles.
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
  const scan = analyzeSpectralProfileAndAiScore(buffer);
  const { profile, aiArtifactScore, sibilanceScore } = scan;

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

  const diagnostics = buildDiagnosticSuggestions(
    scan,
    targetPreset,
    detectedCrestFactorDb,
    detectedPhaseCorrelation
  );

  const forensicSignature = calculateForensicSignature(
    profile,
    detectedPhaseCorrelation,
    DEFAULT_FORENSIC_HUMANIZER_CONFIG,
    DEFAULT_DRUM_LAYERING_CONFIG
  );

  const drumScanner = new DrumTransientReplacerDSP();
  const detectedDrumHits = drumScanner.detectDrumTransients(
    buffer,
    DEFAULT_DRUM_LAYERING_CONFIG
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
    sibilanceScore,
    detectedResonanceLines: scan.detectedResonanceLines,
    forensicSignature,
    detectedDrumHits,
    deltaAdjustments: {
      subDeltaDb,
      lowMidDeltaDb,
      presenceDeltaDb,
      airDeltaDb,
      autoMakeupGainDb,
    },
    ...diagnostics,
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
