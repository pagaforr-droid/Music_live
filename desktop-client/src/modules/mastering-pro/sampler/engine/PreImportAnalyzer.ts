import MusicTempo from 'music-tempo';
import {
  buildHannWindow,
  detectOnsetsSpectralFlux,
  fftInPlace,
} from '../../dsp-core/SpectralFftCore';
import { repairAndRelockBeatGrid } from '../../../../utils/beatGridDSP';
import {
  analyzePolyphonicStemNotesFull,
  constrainNotesToDetectedHarmony,
  filterBassIsolationBand,
  foldPitchClassToSubRegister,
  parseMusicalKeyInfo,
} from './FullStemAnalyzer';
import { detectPitchYin, midiNoteToName } from './PitchDetector';
import { buildMonoSliceFromBuffer } from './Slicer';
import type {
  DetectedChordSegment,
  FullStemAnalysisResult,
  ImportedAudioMemoryAnalysis,
  StemNoteEvent,
} from '../types/sampler.types';

const NOTE_CLASS_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

export function toCamelotKey(musicalKey?: string): string | undefined {
  const info = parseMusicalKeyInfo(musicalKey);
  if (!info) return undefined;
  return info.isMinor ? CAMELOT_MINOR[info.tonicPc] : CAMELOT_MAJOR[info.tonicPc];
}

// Krumhansl-Schmuckler tonal key profiles
const KS_MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

interface ChordTemplateDef {
  suffix: string;
  intervals: number[];
  weights: number[];
  complexityPenalty: number;
  minUniquePcs: number;
}

const CHORD_TEMPLATES: ChordTemplateDef[] = [
  { suffix: '', intervals: [0, 4, 7], weights: [1.15, 0.95, 0.9], complexityPenalty: 0.0, minUniquePcs: 2 },
  { suffix: 'm', intervals: [0, 3, 7], weights: [1.15, 0.95, 0.9], complexityPenalty: 0.0, minUniquePcs: 2 },
  { suffix: '7', intervals: [0, 4, 7, 10], weights: [1.1, 0.9, 0.85, 0.8], complexityPenalty: 0.09, minUniquePcs: 3 },
  { suffix: 'm7', intervals: [0, 3, 7, 10], weights: [1.1, 0.9, 0.85, 0.8], complexityPenalty: 0.08, minUniquePcs: 3 },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], weights: [1.1, 0.9, 0.85, 0.8], complexityPenalty: 0.09, minUniquePcs: 3 },
  { suffix: 'sus4', intervals: [0, 5, 7], weights: [1.1, 0.85, 0.88], complexityPenalty: 0.11, minUniquePcs: 3 },
  { suffix: 'sus2', intervals: [0, 2, 7], weights: [1.1, 0.85, 0.88], complexityPenalty: 0.11, minUniquePcs: 3 },
  { suffix: 'dim', intervals: [0, 3, 6], weights: [1.1, 0.9, 0.9], complexityPenalty: 0.12, minUniquePcs: 3 },
  { suffix: '5', intervals: [0, 7], weights: [1.15, 0.9], complexityPenalty: 0.18, minUniquePcs: 1 },
];

export interface PreImportMemoryEntry {
  memory: ImportedAudioMemoryAnalysis;
  polyResult: FullStemAnalysisResult;
}

const MAX_MEMORY_ENTRIES = 24;
const preImportMemoryCache = new Map<string, PreImportMemoryEntry>();

function storeInMemoryCache(entry: PreImportMemoryEntry): void {
  const key = entry.memory.signature;
  if (preImportMemoryCache.has(key)) {
    preImportMemoryCache.delete(key);
  }
  preImportMemoryCache.set(key, entry);
  while (preImportMemoryCache.size > MAX_MEMORY_ENTRIES) {
    const oldest = preImportMemoryCache.keys().next().value;
    if (oldest !== undefined) preImportMemoryCache.delete(oldest);
    else break;
  }
}

export function clearPreImportMemoryCache(): void {
  preImportMemoryCache.clear();
}

export function registerPreImportMemoryEntry(
  memory: ImportedAudioMemoryAnalysis,
  polyResult?: FullStemAnalysisResult
): void {
  const synthPoly: FullStemAnalysisResult = polyResult ?? {
    mode: 'polyphonic',
    bpm: memory.bpm,
    musicalKey: memory.musicalKey,
    detectedChords: memory.chords,
    beatOffsetSec: memory.beatOffsetSec,
    durationSec: memory.durationSec,
    drumHits: [],
    noteEvents: memory.polyNoteEvents,
    counts: {
      total: memory.polyNoteEvents.length,
      kick: 0,
      snare: 0,
      hat: 0,
      tom: 0,
      notes: memory.polyNoteEvents.length,
    },
  };
  storeInMemoryCache({ memory, polyResult: synthPoly });
}

export function getPreImportCacheSize(): number {
  return preImportMemoryCache.size;
}

/**
 * Deterministic fast signature so switching modes or sending a stem to 16 Pads
 * reuses the pre-import Tempo + Key + Chords stored in memory without recomputing FFTs.
 */
export function computeAudioMemorySignature(
  mono: Float32Array,
  sampleRate: number
): string {
  const len = mono.length;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1;
  const step = Math.max(1, Math.floor(len / 96));
  let energySum = 0;
  for (let i = 0; i < len; i += step) {
    const v = mono[i];
    energySum += Math.abs(v);
    const q = Math.round(v * 32768) | 0;
    h1 = Math.imul(h1 ^ (q & 0xffff), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((q >> 4) & 0xffff), 0x85ebca6b) >>> 0;
  }
  const eQ = Math.round(energySum * 100);
  return `sig-${sampleRate}-${len}-${eQ}-${h1.toString(36)}-${h2.toString(36)}`;
}

export function getCachedPreImportEntry(
  buffer: AudioBuffer
): PreImportMemoryEntry | null {
  const mono = buildMonoSliceFromBuffer(buffer, 0, buffer.duration);
  const sig = computeAudioMemorySignature(mono, buffer.sampleRate);
  return preImportMemoryCache.get(sig) ?? null;
}

function foldTempoIntoPreferredBand(rawBpm: number, minBpm = 72, maxBpm = 158): number {
  if (!Number.isFinite(rawBpm) || rawBpm <= 0) return 120;
  let b = rawBpm;
  while (b < minBpm && b * 2 <= 188) b *= 2;
  while (b > maxBpm && b / 2 >= 56) b /= 2;
  return b;
}

function extractSimultaneousAttackTimes(noteEvents: StemNoteEvent[]): number[] {
  if (noteEvents.length === 0) return [];
  const sorted = [...noteEvents].sort((a, b) => a.startSec - b.startSec);
  const clusters: number[] = [];
  let sum = sorted[0].startSec;
  let count = 1;
  let anchor = sorted[0].startSec;
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i].startSec;
    if (t - anchor <= 0.068) {
      sum += t;
      count++;
    } else {
      clusters.push(sum / count);
      anchor = t;
      sum = t;
      count = 1;
    }
  }
  clusters.push(sum / count);
  return clusters;
}

interface DualBandNoveltyResult {
  envHz: number;
  numFrames: number;
  lowNov: Float32Array;
  snareNov: Float32Array;
  hiNov: Float32Array;
  bodyNov: Float32Array;
  combinedNov: Float32Array;
  grooveStartFrame: number;
  grooveEndFrame: number;
  isSparseHarmonic: boolean;
}

function buildDualBandNoveltyEnvelope(
  mono: Float32Array,
  sampleRate: number
): DualBandNoveltyResult {
  const envHz = 100;
  const hop = Math.max(1, Math.round(sampleRate / envHz));
  const maxFrames = Math.min(24000, Math.floor(mono.length / hop)); // up to 4 min
  const lowRms = new Float32Array(maxFrames);
  const snareRms = new Float32Array(maxFrames);
  const hiRms = new Float32Array(maxFrames);

  // Low-lag 3-band crossover (~2ms group delay): Kick (<135Hz), Snare Body+Crack (210..3800Hz), Hats/Air (>5200Hz)
  const lpLowAlpha = (2 * Math.PI * 135) / (sampleRate + 2 * Math.PI * 135);
  const lpSnareLoAlpha = (2 * Math.PI * 210) / (sampleRate + 2 * Math.PI * 210);
  const lpSnareHiAlpha = (2 * Math.PI * 3800) / (sampleRate + 2 * Math.PI * 3800);
  const lpMidAlpha = (2 * Math.PI * 5200) / (sampleRate + 2 * Math.PI * 5200);
  let lpLow = 0;
  let lpSnareLo = 0;
  let lpSnare = 0;
  let lpMid = 0;
  const stride = sampleRate > 56000 ? 2 : 1;

  for (let f = 0; f < maxFrames; f++) {
    const start = f * hop;
    const end = Math.min(mono.length, start + hop);
    let sqL = 0;
    let sqS = 0;
    let sqH = 0;
    let count = 0;
    for (let i = start; i < end; i += stride) {
      const x = mono[i];
      lpLow += lpLowAlpha * (x - lpLow);
      lpSnareLo += lpSnareLoAlpha * (x - lpSnareLo);
      lpSnare += lpSnareHiAlpha * (x - lpSnare);
      lpMid += lpMidAlpha * (x - lpMid);
      const snare = lpSnare - lpSnareLo;
      const hi = x - lpMid;
      sqL += lpLow * lpLow;
      sqS += snare * snare;
      sqH += hi * hi;
      count++;
    }
    const inv = 1 / Math.max(1, count);
    lowRms[f] = Math.sqrt(sqL * inv);
    snareRms[f] = Math.sqrt(sqS * inv);
    hiRms[f] = Math.sqrt(sqH * inv);
  }

  // Linear half-wave flux delta preserves natural Kick/Snare contrast vs quiet 8th-note hats/strums
  const lowFlux = new Float32Array(maxFrames);
  const snareFlux = new Float32Array(maxFrames);
  const hiFlux = new Float32Array(maxFrames);
  let prevL = lowRms[0] ?? 0;
  let prevS = snareRms[0] ?? 0;
  let prevH = hiRms[0] ?? 0;
  for (let f = 1; f < maxFrames; f++) {
    lowFlux[f] = Math.max(0, lowRms[f] - prevL);
    snareFlux[f] = Math.max(0, snareRms[f] - prevS);
    hiFlux[f] = Math.max(0, hiRms[f] - prevH);
    prevL = lowRms[f] * 0.65 + prevL * 0.35;
    prevS = snareRms[f] * 0.65 + prevS * 0.35;
    prevH = hiRms[f] * 0.65 + prevH * 0.35;
  }

  // Subtract moving local floor (±0.22s = 22 frames) and normalize by 99th percentile peak
  const lowNov = new Float32Array(maxFrames);
  const snareNov = new Float32Array(maxFrames);
  const hiNov = new Float32Array(maxFrames);
  const bodyNov = new Float32Array(maxFrames);
  const combinedNov = new Float32Array(maxFrames);

  const normalizeAdaptive = (src: Float32Array, dst: Float32Array) => {
    const rad = 22;
    const nonZero: number[] = [];
    let maxV = 1e-6;
    for (let f = 0; f < maxFrames; f++) {
      const s = Math.max(0, f - rad);
      const e = Math.min(maxFrames - 1, f + rad);
      let sum = 0;
      for (let k = s; k <= e; k++) sum += src[k];
      const mean = sum / (e - s + 1);
      const val = Math.max(0, src[f] - mean * 1.15);
      dst[f] = val;
      if (val > 1e-6) {
        nonZero.push(val);
        if (val > maxV) maxV = val;
      }
    }
    let refMax = maxV;
    if (nonZero.length >= 20) {
      nonZero.sort((a, b) => a - b);
      refMax = Math.max(1e-6, nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * 0.99))]);
    }
    const scale = refMax > 1e-6 ? 1 / refMax : 0;
    for (let f = 0; f < maxFrames; f++) {
      dst[f] = Math.min(1.2, dst[f] * scale);
    }
  };

  normalizeAdaptive(lowFlux, lowNov);
  normalizeAdaptive(snareFlux, snareNov);
  normalizeAdaptive(hiFlux, hiNov);

  let percussivePeaks = 0;
  for (let f = 1; f < maxFrames - 1; f++) {
    bodyNov[f] = Math.min(2.0, lowNov[f] * 1.35 + snareNov[f] * 1.05);
    combinedNov[f] = Math.min(2.0, lowNov[f] * 1.55 + snareNov[f] * 0.72 + hiNov[f] * 0.85);
    if (
      combinedNov[f] > 0.14 &&
      combinedNov[f] >= combinedNov[f - 1] &&
      combinedNov[f] > combinedNov[f + 1]
    ) {
      percussivePeaks++;
    }
  }

  // Select the most rhythmically active 36s groove window (skips quiet ambient/rubato intros & outros!)
  let grooveStartFrame = 0;
  let grooveEndFrame = maxFrames;
  const winFrames = Math.min(maxFrames, 36 * envHz);
  if (maxFrames > 44 * envHz) {
    let bestWindowScore = -1;
    for (let st = 0; st <= maxFrames - winFrames; st += 2 * envHz) {
      const en = st + winFrames;
      let sum = 0;
      let sumSq = 0;
      let peakCnt = 0;
      for (let f = st; f < en; f++) {
        const v = combinedNov[f];
        sum += v;
        sumSq += v * v;
        if (v > 0.18) peakCnt++;
      }
      const mean = sum / winFrames;
      const variance = Math.max(0, sumSq / winFrames - mean * mean);
      const sc = peakCnt * Math.sqrt(variance + 1e-6);
      if (sc > bestWindowScore) {
        bestWindowScore = sc;
        grooveStartFrame = st;
        grooveEndFrame = en;
      }
    }
  }

  const durSec = Math.max(1, maxFrames / envHz);
  const isSparseHarmonic = percussivePeaks / durSec < 1.35;

  return {
    envHz,
    numFrames: maxFrames,
    lowNov,
    snareNov,
    hiNov,
    bodyNov,
    combinedNov,
    grooveStartFrame,
    grooveEndFrame,
    isSparseHarmonic,
  };
}

function evalCombGridForBpm(
  nov: DualBandNoveltyResult,
  bpm: number
): {
  combEnergy: number;
  beatHitFrac: number;
  bodyBeatHitFrac: number;
  lowBeatCoverage: number;
  halfBeatLeakRatio: number;
  bodyHalfLeakRatio: number;
  tripletBodyLeakRatio: number;
  offbeatLowOrSnareFrac: number;
  bodyEvenOddRatio: number;
  kickSnareAlternation: number;
  strongSpacingSec: number;
  bestPhiFrames: number;
} {
  const { envHz, lowNov, snareNov, hiNov, bodyNov, combinedNov, grooveStartFrame, grooveEndFrame } = nov;
  const periodFrames = (60 * envHz) / Math.max(45, bpm);
  const span = grooveEndFrame - grooveStartFrame;
  if (span < periodFrames * 2) {
    return {
      combEnergy: 0,
      beatHitFrac: 0,
      bodyBeatHitFrac: 0,
      lowBeatCoverage: 0,
      halfBeatLeakRatio: 0,
      bodyHalfLeakRatio: 0,
      tripletBodyLeakRatio: 0,
      offbeatLowOrSnareFrac: 0,
      bodyEvenOddRatio: 1,
      kickSnareAlternation: 0,
      strongSpacingSec: 1,
      bestPhiFrames: 0,
    };
  }

  const sweepSteps = Math.max(48, Math.min(120, Math.round(periodFrames * 2)));
  let bestPhi = 0;
  let bestComb = -1;
  let bestHits = 0;
  let bestBodyHits = 0;
  let bestLowHits = 0;
  let bestOffLowSnareHits = 0;
  let bestHalfCnt = 1;
  let bestTotal = 1;
  let bestHalfSum = 0;
  let bestBeatSum = 0;
  let bestBodyHalfSum = 0;
  let bestBodyBeatSum = 0;
  let bestTripletBodySum = 0;
  let bestEvenBody = 0;
  let bestOddBody = 0;
  let bestAltScore = 0;

  const sampleWeightedNear = (arr: Float32Array, fCenter: number, radFrames = 3): number => {
    const i0 = Math.max(grooveStartFrame, Math.round(fCenter) - radFrames);
    const i1 = Math.min(grooveEndFrame - 1, Math.round(fCenter) + radFrames);
    let m = 0;
    for (let i = i0; i <= i1; i++) {
      const d = i - fCenter;
      const wVal = arr[i] * Math.exp(-(d * d) * 0.28);
      if (wVal > m) m = wVal;
    }
    return m;
  };

  for (let pIdx = 0; pIdx < sweepSteps; pIdx++) {
    const phi = (pIdx / sweepSteps) * periodFrames;
    let beatSum = 0;
    let halfSum = 0;
    let bodyBeatSum = 0;
    let bodyHalfSum = 0;
    let tripletBodySum = 0;
    let evenBodySum = 0;
    let oddBodySum = 0;
    let evenLowSum = 0;
    let oddLowSum = 0;
    let evenSnareSum = 0;
    let oddSnareSum = 0;
    let evenCnt = 0;
    let oddCnt = 0;
    let hitCnt = 0;
    let bodyHitCnt = 0;
    let lowHitCnt = 0;
    let offLowSnareHits = 0;
    let halfCnt = 0;
    let totalBeats = 0;

    for (
      let pos = grooveStartFrame + phi, bIdx = 0;
      pos < grooveEndFrame - 2;
      pos += periodFrames, bIdx++
    ) {
      const peakC = sampleWeightedNear(combinedNov, pos, 3);
      const peakL = sampleWeightedNear(lowNov, pos, 3);
      const peakS = sampleWeightedNear(snareNov, pos, 3);
      const peakB = sampleWeightedNear(bodyNov, pos, 3);
      beatSum += peakC + peakL * 0.45;
      bodyBeatSum += peakB;
      if ((bIdx & 1) === 0) {
        evenBodySum += peakB;
        evenLowSum += peakL;
        evenSnareSum += peakS;
        evenCnt++;
      } else {
        oddBodySum += peakB;
        oddLowSum += peakL;
        oddSnareSum += peakS;
        oddCnt++;
      }
      totalBeats++;
      if (peakC >= 0.14 || peakL >= 0.14 || peakS >= 0.14) hitCnt++;
      if (peakL >= 0.18 || peakS >= 0.18 || peakB >= 0.24) bodyHitCnt++;
      if (peakL >= 0.16) lowHitCnt++;

      const halfPos = pos + periodFrames * 0.5;
      if (halfPos < grooveEndFrame - 2) {
        halfCnt++;
        const hL = sampleWeightedNear(lowNov, halfPos, 2);
        const hS = sampleWeightedNear(snareNov, halfPos, 2);
        const hH = sampleWeightedNear(hiNov, halfPos, 2);
        const hC = sampleWeightedNear(combinedNov, halfPos, 2);
        const q1L = sampleWeightedNear(lowNov, pos + periodFrames * 0.25, 2);
        const q1S = sampleWeightedNear(snareNov, pos + periodFrames * 0.25, 2);
        const q3L = sampleWeightedNear(lowNov, pos + periodFrames * 0.75, 2);
        const q3S = sampleWeightedNear(snareNov, pos + periodFrames * 0.75, 2);
        halfSum += Math.max(hC, hL);
        bodyHalfSum += sampleWeightedNear(bodyNov, halfPos, 2);
        const t1B = sampleWeightedNear(bodyNov, pos + periodFrames / 3, 2);
        const t2B = sampleWeightedNear(bodyNov, pos + (periodFrames * 2) / 3, 2);
        tripletBodySum += Math.max(t1B, t2B);
        if (
          hL >= 0.24 ||
          (hS >= 0.26 && hH >= 0.22) ||
          Math.max(q1L, q1S, q3L, q3S) >= 0.36
        ) {
          offLowSnareHits++;
        }
      }
    }

    const avgBeat = beatSum / Math.max(1, totalBeats);
    if (avgBeat > bestComb) {
      bestComb = avgBeat;
      bestPhi = (grooveStartFrame + phi) % periodFrames;
      bestHits = hitCnt;
      bestBodyHits = bodyHitCnt;
      bestLowHits = lowHitCnt;
      bestOffLowSnareHits = offLowSnareHits;
      bestHalfCnt = Math.max(1, halfCnt);
      bestTotal = Math.max(1, totalBeats);
      bestHalfSum = halfSum / Math.max(1, totalBeats);
      bestBeatSum = avgBeat;
      bestBodyHalfSum = bodyHalfSum / Math.max(1, totalBeats);
      bestBodyBeatSum = bodyBeatSum / Math.max(1, totalBeats);
      bestTripletBodySum = tripletBodySum / Math.max(1, totalBeats);
      bestEvenBody = evenBodySum / Math.max(1, evenCnt);
      bestOddBody = oddBodySum / Math.max(1, oddCnt);
      const eLow = evenLowSum / Math.max(1, evenCnt);
      const oLow = oddLowSum / Math.max(1, oddCnt);
      const eSn = evenSnareSum / Math.max(1, evenCnt);
      const oSn = oddSnareSum / Math.max(1, oddCnt);
      bestAltScore = Math.max(0, (eLow - oLow) * (oSn - eSn), (oLow - eLow) * (eSn - oSn));
    }
  }

  // Median interval between isolated <145Hz Kick/Bass peaks AND Kick+Snare body peaks
  const sampleStrongPeaksMedianGap = (useSnareToo: boolean, thresh: number): number => {
    const times: number[] = [];
    const minGap = Math.round(0.22 * envHz);
    let last = -minGap;
    for (let f = grooveStartFrame + 1; f < grooveEndFrame - 1; f++) {
      const val = useSnareToo ? Math.max(lowNov[f], snareNov[f] * 0.85) : lowNov[f];
      const prev = useSnareToo ? Math.max(lowNov[f - 1], snareNov[f - 1] * 0.85) : lowNov[f - 1];
      const next = useSnareToo ? Math.max(lowNov[f + 1], snareNov[f + 1] * 0.85) : lowNov[f + 1];
      if (val >= thresh && val >= prev && val > next && f - last >= minGap) {
        times.push(f / envHz);
        last = f;
      }
    }
    if (times.length < 3) return 0.6;
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  };

  const medianStrongGap = sampleStrongPeaksMedianGap(true, 0.30);

  const maxEvenOdd = Math.max(1e-4, bestEvenBody, bestOddBody);
  const bodyEvenOddRatio = Math.min(bestEvenBody, bestOddBody) / maxEvenOdd;

  return {
    combEnergy: bestComb,
    beatHitFrac: bestHits / bestTotal,
    bodyBeatHitFrac: bestBodyHits / bestTotal,
    lowBeatCoverage: bestLowHits / bestTotal,
    halfBeatLeakRatio: bestBeatSum > 1e-5 ? bestHalfSum / bestBeatSum : 0,
    bodyHalfLeakRatio: bestBodyBeatSum > 1e-5 ? bestBodyHalfSum / bestBodyBeatSum : 0,
    tripletBodyLeakRatio: bestBodyBeatSum > 1e-5 ? bestTripletBodySum / bestBodyBeatSum : 0,
    offbeatLowOrSnareFrac: bestOffLowSnareHits / bestHalfCnt,
    bodyEvenOddRatio,
    kickSnareAlternation: bestAltScore,
    strongSpacingSec: medianStrongGap,
    bestPhiFrames: bestPhi,
  };
}

export function detectAccurateTempoAndPhase(
  mono: Float32Array,
  sampleRate: number,
  onsetTimesSec: number[],
  polyNoteEvents: StemNoteEvent[],
  bpmHint?: number
): { bpm: number; bpmConfidence: number; beatOffsetSec: number } {
  const chordAttackTimes = extractSimultaneousAttackTimes(polyNoteEvents);
  const nov = buildDualBandNoveltyEnvelope(mono, sampleRate);
  const { envHz, bodyNov, combinedNov, grooveStartFrame, grooveEndFrame, isSparseHarmonic } = nov;
  const gLen = Math.max(1, grooveEndFrame - grooveStartFrame);

  // 1. Sparse harmonic mode fallback (for slow chord pads/arpeggios without drums)
  const candidates: Array<{ bpm: number; weight: number }> = [];
  if (isSparseHarmonic) {
    const times = chordAttackTimes.length >= 2 ? chordAttackTimes : onsetTimesSec;
    for (let i = 0; i < times.length; i++) {
      for (let j = i + 1; j < Math.min(times.length, i + 4); j++) {
        const dt = times[j] - times[i];
        if (dt < 0.18 || dt > 5.0) continue;
        const b = foldTempoIntoPreferredBand(60 / dt, 66, 160);
        candidates.push({ bpm: b, weight: 2.5 / (1 + (j - i - 1) * 0.4) });
      }
    }
  }

  // 2. Normalized multi-harmonic autocorrelation over Kick+Snare bodyNov and combinedNov
  // Extended to 2.2s lag (captures 2x bar lag down to 56 BPM without triggering >2.5x subharmonics)
  const maxLag = Math.min(gLen - 16, Math.round(envHz * 2.2));
  const acf = new Float32Array(maxLag + 1);
  const bodyAcf = new Float32Array(maxLag + 1);
  if (gLen > 120) {
    let meanC = 0;
    let meanB = 0;
    for (let f = grooveStartFrame; f < grooveEndFrame; f++) {
      meanC += combinedNov[f];
      meanB += bodyNov[f];
    }
    meanC /= gLen;
    meanB /= gLen;
    let energyC = 0;
    let energyB = 0;
    for (let f = grooveStartFrame; f < grooveEndFrame; f++) {
      const dc = combinedNov[f] - meanC;
      const db = bodyNov[f] - meanB;
      energyC += dc * dc;
      energyB += db * db;
    }
    if (energyC > 1e-8 || energyB > 1e-8) {
      const invC = energyC > 1e-8 ? 1 / energyC : 0;
      const invB = energyB > 1e-8 ? 1 / energyB : 0;
      for (let lag = 16; lag <= maxLag; lag++) {
        let accC = 0;
        let accB = 0;
        for (let f = grooveStartFrame; f < grooveEndFrame - lag; f++) {
          accC += (combinedNov[f] - meanC) * (combinedNov[f + lag] - meanC);
          accB += (bodyNov[f] - meanB) * (bodyNov[f + lag] - meanB);
        }
        acf[lag] = Math.max(0, accC * invC);
        bodyAcf[lag] = Math.max(0, accB * invB);
      }
    }
  }

  const sampleAcf = (src: Float32Array, lagF: number): number => {
    const i0 = Math.floor(lagF);
    const i1 = i0 + 1;
    if (i0 < 16 || i1 > maxLag) return -1;
    const t = lagF - i0;
    return src[i0] * (1 - t) + src[i1] * t;
  };

  const evalHarmonicAcf = (lagF: number): number => {
    const harmonics: Array<[number, number]> = [
      [1, 1.0],
      [2, 0.72],
      [3, 0.35],
      [4, 0.32],
    ];
    let sum = 0;
    let wTot = 0;
    for (const [m, w] of harmonics) {
      const vC = sampleAcf(acf, lagF * m);
      const vB = sampleAcf(bodyAcf, lagF * m);
      if (vC >= 0 || vB >= 0) {
        const blend = Math.max(0, vC) * 0.48 + Math.max(0, vB) * 0.52;
        sum += blend * w;
        wTot += w;
      }
    }
    return wTot > 0 ? (sum / wTot) * 2.05 : 0;
  };

  // Evaluate continuous 0.25 BPM tempogram across 58..186 BPM
  const bpmMin = 58;
  const bpmMax = 186;
  const bpmStep = 0.25;
  const numBins = Math.round((bpmMax - bpmMin) / bpmStep) + 1;
  const tempogram = new Float32Array(numBins);

  for (let k = 0; k < numBins; k++) {
    const b = bpmMin + k * bpmStep;
    const lag = (60 * envHz) / b;
    tempogram[k] = evalHarmonicAcf(lag);
  }

  // Pick top local maxima separated by >= 3.5 BPM
  const peakBpms: Array<{ bpm: number; score: number }> = [];
  for (let k = 2; k < numBins - 2; k++) {
    const v = tempogram[k];
    if (
      v > 0.08 &&
      v >= tempogram[k - 1] &&
      v >= tempogram[k - 2] &&
      v > tempogram[k + 1] &&
      v > tempogram[k + 2]
    ) {
      const b = bpmMin + k * bpmStep;
      const nearby = peakBpms.find((p) => Math.abs(p.bpm - b) < 3.5);
      if (nearby) {
        if (v > nearby.score) {
          nearby.bpm = b;
          nearby.score = v;
        }
      } else {
        peakBpms.push({ bpm: b, score: v });
      }
    }
  }
  peakBpms.sort((a, b) => b.score - a.score);
  for (const pk of peakBpms.slice(0, 5)) {
    candidates.push({ bpm: pk.bpm, weight: 2.8 * Math.min(1.5, pk.score) });
  }

  // 3. MusicTempo on exact groove window with true sample-rate timing (hop = 10ms exact!)
  try {
    const grooveStartSample = Math.max(0, Math.floor((grooveStartFrame / envHz) * sampleRate));
    const grooveEndSample = Math.min(mono.length, Math.ceil((grooveEndFrame / envHz) * sampleRate));
    const grooveSlice = mono.subarray(grooveStartSample, grooveEndSample);
    let rmsSq = 0;
    const st = Math.max(1, Math.floor(grooveSlice.length / 4096));
    let cnt = 0;
    for (let i = 0; i < grooveSlice.length; i += st) {
      rmsSq += grooveSlice[i] * grooveSlice[i];
      cnt++;
    }
    const rms = Math.sqrt(rmsSq / Math.max(1, cnt));
    if (grooveSlice.length / sampleRate >= 1.25 && rms > 0.002) {
      const hopSamples = Math.max(1, Math.round(sampleRate * 0.01));
      const mt = new MusicTempo(Array.from(grooveSlice), {
        hopSize: hopSamples,
        timeStep: hopSamples / sampleRate,
        minBeatInterval: 0.31,
        maxBeatInterval: 1.05,
      });
      const mtTempoNum = Number(mt.tempo);
      if (Number.isFinite(mtTempoNum) && mtTempoNum >= 50 && mtTempoNum <= 210) {
        candidates.push({ bpm: mtTempoNum, weight: isSparseHarmonic ? 0.6 : 1.9 });
      }
    }
  } catch {
    // Ignore when clip is short/tonal
  }

  // 4. Optional soft tiebreaker hint (low weight so wrong DB metadata never overrides real audio!)
  if (bpmHint && Number.isFinite(bpmHint) && bpmHint >= 45 && bpmHint <= 220) {
    candidates.push({ bpm: bpmHint, weight: isSparseHarmonic ? 1.0 : 0.75 });
  }

  if (candidates.length === 0) {
    return {
      bpm: bpmHint && bpmHint >= 45 && bpmHint <= 220 ? Math.round(bpmHint) : 120,
      bpmConfidence: 0.25,
      beatOffsetSec: 0,
    };
  }

  // Expand top unique candidates + their octave partners (b/2, 2*b) and 1.5x partner (to escape 2/3 polyrhythm upward)
  const uniqueSeeds: number[] = [];
  for (const c of candidates) {
    for (const m of [c.bpm, c.bpm * 0.5, c.bpm * 2, c.bpm * 1.5]) {
      if (m < 58 || m > 186) continue;
      if (!uniqueSeeds.some((u) => Math.abs(u - m) <= 1.2)) {
        uniqueSeeds.push(m);
      }
    }
  }

  const evalCache = new Map<number, ReturnType<typeof evalCombGridForBpm>>();
  const getCombEval = (b: number) => {
    const key = Math.round(b * 10);
    let hit = evalCache.get(key);
    if (!hit) {
      hit = evalCombGridForBpm(nov, b);
      evalCache.set(key, hit);
    }
    return hit;
  };

  let bestSeed = uniqueSeeds[0] ?? 120;
  let bestFinalScore = -1;
  let bestEval = getCombEval(bestSeed);

  for (const seedBpm of uniqueSeeds) {
    const ev = getCombEval(seedBpm);

    // Sum nearby candidate weight voting within +-2.2% of this tempo
    let voteWeight = 0;
    for (const c of candidates) {
      if (Math.abs(c.bpm - seedBpm) <= Math.max(1.8, seedBpm * 0.022)) {
        voteWeight += c.weight;
      } else if (
        Math.abs(c.bpm * 2 - seedBpm) <= 2.2 ||
        Math.abs(c.bpm * 0.5 - seedBpm) <= 2.2
      ) {
        voteWeight += c.weight * 0.32;
      }
    }

    // Symmetric octave & 2/3 polyrhythm disambiguation using beat occupancy (`bodyBeatHitFrac`) + half-beat snare leak:
    let octaveFactor = 1.0;

    // 1. Subharmonic trap protection (e.g. 62 BPM on 124 BPM, 78 BPM on 156 BPM):
    //    If double-tempo fills >= 84% of beats with Kick/Snare (`evDouble.bodyBeatHitFrac >= 0.84`) AND this slow tempo
    //    leaks real backbeat snares/kicks onto its half-beat (`bodyHalfLeakRatio >= 0.20` or `offbeatLowOrSnareFrac >= 0.35`), it's half-time!
    if (seedBpm <= 96) {
      const doubleBpm = seedBpm * 2;
      const evDouble = doubleBpm <= 192 ? getCombEval(doubleBpm) : null;
      const isTrueDoubleGroove = Boolean(
        evDouble &&
          evDouble.bodyBeatHitFrac >= 0.84 &&
          (ev.bodyHalfLeakRatio >= 0.2 ||
            ev.offbeatLowOrSnareFrac >= 0.35 ||
            evDouble.kickSnareAlternation > ev.kickSnareAlternation * 1.15)
      );
      if (isTrueDoubleGroove) {
        octaveFactor *= 0.42;
      } else if (ev.strongSpacingSec < 0.45 && ev.bodyBeatHitFrac < 0.82) {
        octaveFactor *= 0.62;
      }
    }

    // 2. False double-time protection (e.g. 136 BPM on 68 BPM, 148 BPM on 74 BPM):
    //    False double-time leaves >22% of beats without Kick/Snare (`bodyBeatHitFrac < 0.78`) while its half-tempo fills >= 84%!
    if (seedBpm > 120) {
      const halfBpm = seedBpm * 0.5;
      const evHalf = halfBpm >= 58 ? getCombEval(halfBpm) : null;
      if (
        (ev.bodyBeatHitFrac < 0.78 && evHalf && evHalf.bodyBeatHitFrac >= 0.84) ||
        (ev.strongSpacingSec >= 1.15 && ev.lowBeatCoverage <= 0.34)
      ) {
        octaveFactor *= 0.40;
      }
    }

    // 3. 2/3 Polyrhythm trap protection (e.g. 104 BPM on 156 BPM, 83 BPM on 124 BPM):
    //    Real snares/kicks land at 1/3 & 2/3 of 2/3-tempo (`tripletBodyLeakRatio >= 0.44`) while 1.5*seed fills >= 78% of beats cleanly
    if (seedBpm >= 72 && seedBpm <= 128 && ev.tripletBodyLeakRatio >= 0.44) {
      const evThreeHalves = seedBpm * 1.5 <= 192 ? getCombEval(seedBpm * 1.5) : null;
      if (evThreeHalves && evThreeHalves.bodyBeatHitFrac >= 0.78) {
        octaveFactor *= 0.46;
      }
    }

    // 4. Slow backbeat protection (62..88 BPM) only when double-time isn't full-occupancy
    if (
      seedBpm >= 62 &&
      seedBpm <= 88 &&
      octaveFactor >= 0.9 &&
      ev.bodyBeatHitFrac >= 0.84
    ) {
      octaveFactor *= 1.16;
    }

    // Gentle musical prior around 108 BPM
    const octaveDist = Math.log2(seedBpm / 108);
    const broadHumanPrior = Math.exp(-(octaveDist * octaveDist) / 1.35);

    const score =
      (voteWeight * 0.55 + ev.combEnergy * 2.15) *
      (0.35 + 0.65 * ev.beatHitFrac) *
      octaveFactor *
      (0.84 + 0.16 * broadHumanPrior);

    if (score > bestFinalScore) {
      bestFinalScore = score;
      bestSeed = seedBpm;
      bestEval = ev;
    }
  }

  // Fine continuous 0.1 BPM comb refinement around bestSeed so frame jitter never pulls 74/96 to 73/95
  let refined = bestSeed;
  if (!isSparseHarmonic) {
    let bestFineScore = -1;
    let fineBpm = bestSeed;
    let fineEval = bestEval;
    for (let b = Math.max(52, bestSeed - 2.2); b <= Math.min(200, bestSeed + 2.2); b += 0.1) {
      const lag = (60 * envHz) / b;
      const acfComb = evalHarmonicAcf(lag);
      const evFine = evalCombGridForBpm(nov, b);
      const combTotal = acfComb * 1.35 + evFine.combEnergy * (0.4 + 0.6 * evFine.beatHitFrac);
      if (combTotal > bestFineScore) {
        bestFineScore = combTotal;
        fineBpm = b;
        fineEval = evFine;
      }
    }
    refined = fineBpm;
    bestEval = fineEval;
  } else {
    let wSum = 0;
    let wBpmSum = 0;
    for (const c of candidates) {
      if (Math.abs(c.bpm - bestSeed) <= Math.max(2.0, bestSeed * 0.025)) {
        wSum += c.weight;
        wBpmSum += c.bpm * c.weight;
      }
    }
    refined = wSum > 0 ? wBpmSum / wSum : bestSeed;
  }

  let wSum = 0;
  let totalCandWeight = 0;
  for (const c of candidates) {
    totalCandWeight += c.weight;
    if (Math.abs(c.bpm - refined) <= Math.max(2.0, refined * 0.025)) {
      wSum += c.weight;
    }
  }
  const nearestInt = Math.round(refined);
  const resolvedBpm =
    Math.abs(refined - nearestInt) <= 0.45
      ? nearestInt
      : Math.round(refined * 10) / 10;

  // Re-lock comb phase at exact resolvedBpm so rounding never introduces cumulative drift
  if (!isSparseHarmonic) {
    bestEval = evalCombGridForBpm(nov, resolvedBpm);
  }

  const bpmConfidence = Number(
    Math.max(
      0.3,
      Math.min(0.99, (wSum / Math.max(1e-3, totalCandWeight)) * 0.65 + bestEval.beatHitFrac * 0.35)
    ).toFixed(3)
  );

  // Exact phase alignment (`beatOffsetSec`) anchored via groove-wide median transient attack foot
  const beatDur = 60 / Math.max(40, resolvedBpm);
  let rawOffsetSec = bestEval.bestPhiFrames / envHz;
  if (isSparseHarmonic && (chordAttackTimes.length > 0 || onsetTimesSec.length > 0)) {
    const earliest = chordAttackTimes[0] ?? onsetTimesSec[0] ?? 0;
    rawOffsetSec = earliest % beatDur;
  } else {
    const grooveStartSec = grooveStartFrame / envHz;
    const grooveEndSec = grooveEndFrame / envHz;
    const residuals: number[] = [];
    const nMin = Math.max(0, Math.ceil((grooveStartSec - rawOffsetSec) / beatDur));
    const nMax = Math.floor((grooveEndSec - rawOffsetSec) / beatDur);
    const beatStep = Math.max(1, Math.floor((nMax - nMin + 1) / 36));
    const searchWin = Math.round(0.028 * sampleRate);
    const stepMs = Math.max(8, Math.round(0.0012 * sampleRate));

    for (let n = nMin; n <= nMax; n += beatStep) {
      const btSec = rawOffsetSec + n * beatDur;
      const fCenter = Math.round(btSec * envHz);
      let beatStrength = 0;
      for (let df = -3; df <= 3; df++) {
        const fi = fCenter + df;
        if (fi >= grooveStartFrame && fi < grooveEndFrame) {
          beatStrength = Math.max(beatStrength, bodyNov[fi], combinedNov[fi] * 0.85);
        }
      }
      if (beatStrength < 0.24) continue;

      const centerSamp = Math.round(btSec * sampleRate);
      const sMin = Math.max(2, centerSamp - searchWin);
      const sMax = Math.min(mono.length - 1, centerSamp + searchWin);
      if (sMax - sMin < stepMs * 4) continue;

      // High-frequency derivative transient (mono[i] - mono[i-2]) triggers at exact beater/stick impact (~1ms lag, zero 50Hz kick delay!)
      let bestRise = 0;
      let bestRiseIdx = -1;
      for (let idx = sMin + stepMs * 2; idx <= sMax - stepMs; idx += Math.max(2, Math.floor(stepMs / 4))) {
        let eBefore = 0;
        let eAfter = 0;
        for (let k = 0; k < stepMs; k++) {
          const db = mono[idx - stepMs + k] - mono[idx - stepMs + k - 2];
          const da = mono[idx + k] - mono[idx + k - 2];
          eBefore += db * db;
          eAfter += da * da;
        }
        const rmsB = Math.sqrt(eBefore / stepMs);
        const rmsA = Math.sqrt(eAfter / stepMs);
        const rise = rmsA - rmsB * 1.25;
        if (rise > bestRise) {
          bestRise = rise;
          bestRiseIdx = idx;
        }
      }
      if (bestRiseIdx >= 0 && bestRise > 0.002) {
        const resid = bestRiseIdx / sampleRate - btSec;
        if (Math.abs(resid) <= 0.028) {
          residuals.push(resid);
        }
      }
    }

    if (residuals.length >= 2) {
      residuals.sort((a, b) => a - b);
      rawOffsetSec += residuals[Math.floor(residuals.length / 2)];
    }
  }

  let offset = ((rawOffsetSec % beatDur) + beatDur) % beatDur;
  if (offset < 0.004 || beatDur - offset < 0.004) {
    offset = 0;
  }

  return {
    bpm: resolvedBpm,
    bpmConfidence,
    beatOffsetSec: Number(offset.toFixed(4)),
  };
}

function pearsonCorrelation(a: Float32Array | number[], b: number[], rotateBy: number): number {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < 12; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= 12;
  meanB /= 12;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < 12; i++) {
    const da = a[i] - meanA;
    const db = b[(i - rotateBy + 12) % 12] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 1e-9 ? num / den : 0;
}

function createWorkerSafeBufferView(mono: Float32Array, sampleRate: number): AudioBuffer {
  return {
    length: mono.length,
    duration: mono.length / Math.max(8000, sampleRate),
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => mono,
  } as unknown as AudioBuffer;
}

export function getBeatsPerMeasureFromSig(timeSignature = '4/4'): number {
  const num = parseInt(String(timeSignature).split('/')[0], 10);
  if (timeSignature.startsWith('6/8')) return 6;
  return num >= 2 && num <= 12 ? num : 4;
}

/**
 * Reuses Stem Studio's `repairAndRelockBeatGrid` DSP directly so Sample Lab gets
 * an exact multi-island beat grid (`beatTimes[]` & `downbeats[]`), silence-bridge repair,
 * and circular transient phase lock!
 */
export function rebuildBeatGridFromTempo(
  mono: Float32Array,
  sampleRate: number,
  bpm: number,
  beatOffsetSec = 0,
  timeSignature = '4/4',
  seedBeats?: number[],
  seedDownbeats?: number[]
): { bpm: number; beatOffsetSec: number; beatTimes: number[]; downbeats: number[] } {
  const safeBpm = Math.max(40, Math.min(220, bpm || 120));
  const beatDur = 60 / safeBpm;
  const durationSec = mono.length / Math.max(8000, sampleRate);
  const beatsPerMeasure = getBeatsPerMeasureFromSig(timeSignature);

  const initialBeats: number[] = [];
  if (seedBeats && seedBeats.length >= 4) {
    for (const b of seedBeats) {
      if (Number.isFinite(b) && b >= 0 && b <= durationSec + beatDur * 0.5) {
        initialBeats.push(b);
      }
    }
  }
  if (initialBeats.length < 4) {
    initialBeats.length = 0;
    let t = ((beatOffsetSec % beatDur) + beatDur) % beatDur;
    if (beatDur - t < 0.004) t = 0;
    while (t <= durationSec + beatDur * 0.25) {
      initialBeats.push(Number(t.toFixed(4)));
      t += beatDur;
    }
  }

  const initialDownbeats: number[] =
    seedDownbeats && seedDownbeats.length > 0
      ? seedDownbeats.filter((d) => Number.isFinite(d) && d >= 0 && d <= durationSec + beatDur)
      : initialBeats.filter((_, idx) => idx % beatsPerMeasure === 0);

  let beatTimes = initialBeats;
  let downbeats = initialDownbeats;
  let refinedOffset = initialDownbeats[0] ?? initialBeats[0] ?? beatOffsetSec;

  if (durationSec >= 1.5 && initialBeats.length >= 3) {
    try {
      const bufView = createWorkerSafeBufferView(mono, sampleRate);
      const gridRes = repairAndRelockBeatGrid({
        rawBeats: initialBeats,
        rawDownbeats: initialDownbeats,
        rawBpm: safeBpm,
        timeSignature,
        masterBuffer: bufView,
        referenceTrackName: 'Sample Lab Audio',
      });
      const maxTime = durationSec + beatDur * 0.25;
      const clippedBeats = gridRes.beatTimes
        .filter((t) => t >= -0.005 && t <= maxTime)
        .map((t) => Number(Math.max(0, t).toFixed(4)));
      const clippedDownbeats = gridRes.downbeats
        .filter((t) => t >= -0.005 && t <= maxTime)
        .map((t) => Number(Math.max(0, t).toFixed(4)));
      if (clippedBeats.length >= 2) {
        // Check whether repairAndRelockBeatGrid found a silence breakdown/tempo island vs simply lagging constant phase
        let hasBreakdownShift = false;
        const deltas: number[] = [];
        const compareCount = Math.min(clippedBeats.length, initialBeats.length);
        for (let bi = 1; bi < clippedBeats.length; bi++) {
          if (clippedBeats[bi] - clippedBeats[bi - 1] > beatDur * 1.4) {
            hasBreakdownShift = true;
            break;
          }
        }
        if (!hasBreakdownShift && (!seedBeats || seedBeats.length < 4)) {
          for (let i = 0; i < compareCount; i++) {
            deltas.push(clippedBeats[i] - initialBeats[i]);
          }
          if (deltas.length >= 3) {
            deltas.sort((a, b) => a - b);
            const medShift = deltas[Math.floor(deltas.length / 2)];
            // Only preserve median transient attack phase if grid stayed near-constant without breakdown
            if (Math.abs(medShift) > 0.005 && Math.abs(medShift) < 0.048) {
              for (let i = 0; i < clippedBeats.length; i++) {
                clippedBeats[i] = Number(Math.max(0, clippedBeats[i] - medShift).toFixed(4));
              }
              for (let i = 0; i < clippedDownbeats.length; i++) {
                clippedDownbeats[i] = Number(Math.max(0, clippedDownbeats[i] - medShift).toFixed(4));
              }
            }
          }
        }

        beatTimes = clippedBeats;
        downbeats =
          clippedDownbeats.length > 0
            ? clippedDownbeats
            : clippedBeats.filter((_, idx) => idx % beatsPerMeasure === 0);
        const rawMod = ((beatTimes[0] ?? refinedOffset) % beatDur + beatDur) % beatDur;
        refinedOffset = rawMod < 0.004 || beatDur - rawMod < 0.004 ? 0 : Number(rawMod.toFixed(4));
      }
    } catch {
      // Keep clean regular grid fallback
    }
  }

  // Align Downbeat bar phase (0..beatsPerMeasure-1) via low-end kick energy + active musical entry
  if ((!seedDownbeats || seedDownbeats.length === 0) && beatTimes.length >= beatsPerMeasure * 2) {
    let firstActiveBeatIdx = 0;
    const peakAmp = (() => {
      let m = 1e-4;
      for (let i = 0; i < mono.length; i += 64) {
        const a = Math.abs(mono[i]);
        if (a > m) m = a;
      }
      return m;
    })();
    for (let bi = 0; bi < beatTimes.length; bi++) {
      const st = Math.max(0, Math.round(beatTimes[bi] * sampleRate));
      const en = Math.min(mono.length, st + Math.round(Math.min(0.25, beatDur) * sampleRate));
      let locMax = 0;
      for (let i = st; i < en; i += 4) {
        const a = Math.abs(mono[i]);
        if (a > locMax) locMax = a;
      }
      if (locMax >= peakAmp * 0.22) {
        firstActiveBeatIdx = bi;
        break;
      }
    }

    const phaseScores = new Float64Array(beatsPerMeasure);
    const lpAlpha = (2 * Math.PI * 135) / (sampleRate + 2 * Math.PI * 135);
    for (let bi = 0; bi < beatTimes.length; bi++) {
      const bt = beatTimes[bi];
      const st = Math.max(0, Math.round(bt * sampleRate));
      const en = Math.min(mono.length, st + Math.round(0.085 * sampleRate));
      if (en <= st + 16) continue;
      let lp = 0;
      let sq = 0;
      for (let i = st; i < en; i++) {
        lp += lpAlpha * (mono[i] - lp);
        sq += lp * lp;
      }
      const lowE = Math.sqrt(sq / (en - st));
      const p = bi % beatsPerMeasure;
      phaseScores[p] += lowE;
      if (bi === firstActiveBeatIdx) {
        phaseScores[p] += peakAmp * 1.1;
      }
    }
    let bestPhase = 0;
    let bestPhaseScore = -1;
    for (let p = 0; p < beatsPerMeasure; p++) {
      if (phaseScores[p] > bestPhaseScore) {
        bestPhaseScore = phaseScores[p];
        bestPhase = p;
      }
    }
    downbeats = beatTimes.filter((_, idx) => idx % beatsPerMeasure === bestPhase);
  }

  return {
    bpm: Math.round(safeBpm * 10) / 10,
    beatOffsetSec: refinedOffset,
    beatTimes,
    downbeats,
  };
}

interface SpectralChromaFrame {
  timeSec: number;
  chroma: Float32Array;
  energy: number;
  tonalityRatio: number;
}

/**
 * Direct Whitened Spectral Chromagram (HPCP) across 62..1600 Hz using FFT magnitude +
 * log compression + spectral noise floor subtraction (ignores drums/cymbals/fuzz while
 * capturing true triads & bass roots on stadium rock/pop mixes!).
 */
function computeSpectralChromaFrames(
  mono: Float32Array,
  sampleRate: number
): {
  frames: SpectralChromaFrame[];
  globalSpectralChroma: Float32Array;
  medianTonalityRatio: number;
} {
  const globalSpectralChroma = new Float32Array(12);
  if (mono.length < 2048) {
    return { frames: [], globalSpectralChroma, medianTonalityRatio: 0 };
  }

  const winLen = Math.min(8192, mono.length);
  const fftSize = 16384;
  const win = buildHannWindow(winLen);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const binHz = sampleRate / fftSize;
  const minBin = Math.max(2, Math.floor(55 / binHz));
  const maxBin = Math.min(fftSize / 2 - 2, Math.ceil(1150 / binHz));
  const durationSec = mono.length / sampleRate;

  // Cap at ~1100 FFT frames across whole track so 270s WAV completes quickly
  const strideSec = Math.max(0.085, durationSec / 1100);
  const frames: SpectralChromaFrame[] = [];
  const tonalityRatios: number[] = [];

  const numBins = maxBin - minBin + 1;
  const mags = new Float32Array(numBins);
  const sortedMags: number[] = new Array(Math.ceil(numBins / 2));

  for (let tSec = 0.04; tSec < durationSec - 0.04; tSec += strideSec) {
    const center = Math.round(tSec * sampleRate);
    const start = Math.max(0, Math.min(mono.length - winLen, center - (winLen >> 1)));
    re.fill(0);
    im.fill(0);
    let sqSum = 0;
    for (let i = 0; i < winLen; i++) {
      const s = mono[start + i];
      sqSum += s * s;
      re[i] = s * win[i];
    }
    const frameRms = Math.sqrt(sqSum / winLen);
    if (frameRms < 0.0025) continue;

    fftInPlace(re, im);

    let peakMag = 0;
    let sIdx = 0;
    for (let idx = 0; idx < numBins; idx++) {
      const k = minBin + idx;
      const m = Math.hypot(re[k], im[k]);
      mags[idx] = m;
      if (m > peakMag) peakMag = m;
      if ((idx & 1) === 0 && sIdx < sortedMags.length) {
        sortedMags[sIdx++] = m;
      }
    }
    if (peakMag <= 1e-4) continue;

    const sampleSlice = sortedMags.slice(0, sIdx).sort((a, b) => a - b);
    const floorMag = Math.max(1e-6, sampleSlice[Math.floor(sampleSlice.length * 0.45)] ?? 1e-6);
    const tonalityRatio = peakMag / floorMag;
    tonalityRatios.push(tonalityRatio);

    const chroma = new Float32Array(12);
    const noiseGate = Math.max(floorMag * 1.45, peakMag * 0.025);
    let frameChromaSum = 0;
    // Extract true parabolic spectral local peaks so Hann mainlobe & neighbor bins never smear semitones
    for (let idx = 1; idx < numBins - 1; idx++) {
      const a = mags[idx];
      if (a <= noiseGate || a < mags[idx - 1] || a <= mags[idx + 1]) continue;
      const s0 = mags[idx - 1];
      const s2 = mags[idx + 1];
      const denom = s0 - 2 * a + s2;
      const delta =
        Math.abs(denom) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (s0 - s2)) / denom)) : 0;
      const exactFreq = (minBin + idx + delta) * binHz;
      if (exactFreq < 55 || exactFreq > 1150) continue;

      const midiFloat = 69 + 12 * Math.log2(exactFreq / 440);
      const nearestMidi = Math.round(midiFloat);
      const dev = Math.abs(midiFloat - nearestMidi);
      if (dev > 0.30) continue;

      const pc = ((nearestMidi % 12) + 12) % 12;
      const cleanMag = a - noiseGate;
      const devWeight = 1 - (dev / 0.34) * 0.5;
      // Weight fundamentals & 3rds (<520Hz) strongly and taper >580Hz so 5th harmonics don't flip min->maj
      const regWeight = exactFreq < 220 ? 1.65 : exactFreq < 520 ? 1.2 : 0.22;
      const magVal = Math.log1p(18 * (cleanMag / peakMag)) * devWeight * regWeight;
      chroma[pc] += magVal;
      frameChromaSum += magVal;
    }

    if (frameChromaSum > 1e-5) {
      const invSum = 1 / frameChromaSum;
      for (let pc = 0; pc < 12; pc++) {
        chroma[pc] *= invSum;
        globalSpectralChroma[pc] += chroma[pc] * Math.min(1.5, frameRms * 12);
      }
      frames.push({ timeSec: tSec, chroma, energy: frameRms, tonalityRatio });
    }
  }

  tonalityRatios.sort((a, b) => a - b);
  const medianTonalityRatio =
    tonalityRatios.length > 0 ? tonalityRatios[Math.floor(tonalityRatios.length / 2)] : 0;

  return { frames, globalSpectralChroma, medianTonalityRatio };
}

function getDiatonicChordSetForKey(musicalKey: string): Set<string> {
  const info = parseMusicalKeyInfo(musicalKey);
  const set = new Set<string>();
  if (!info) return set;
  const tonic = info.tonicPc;
  if (!info.isMinor) {
    // Major diatonic: I, ii, iii, IV, V, V7, vi, vii dim + common bVII rock borrow
    const degs: Array<[number, string[]]> = [
      [0, ['', 'maj7', 'sus4', 'sus2']],
      [2, ['m', 'm7']],
      [4, ['m', 'm7']],
      [5, ['', 'maj7', 'sus2']],
      [7, ['', '7', 'sus4']],
      [9, ['m', 'm7']],
      [11, ['dim']],
      [10, ['']],
    ];
    for (const [semi, sufs] of degs) {
      const n = NOTE_CLASS_NAMES[(tonic + semi) % 12];
      for (const s of sufs) set.add(`${n}${s}`);
    }
  } else {
    // Natural + harmonic minor diatonic: i, ii dim, III, iv, v, V, VI, VII
    const degs: Array<[number, string[]]> = [
      [0, ['m', 'm7']],
      [2, ['dim']],
      [3, ['', 'maj7']],
      [5, ['m', 'm7']],
      [7, ['m', '', '7']],
      [8, ['', 'maj7']],
      [10, ['', '7']],
    ];
    for (const [semi, sufs] of degs) {
      const n = NOTE_CLASS_NAMES[(tonic + semi) % 12];
      for (const s of sufs) set.add(`${n}${s}`);
    }
  }
  return set;
}

function estimateMusicalKey(
  globalChroma: Float32Array,
  chords: DetectedChordSegment[],
  bassRootCounts?: Float32Array
): { musicalKey: string; keyConfidence: number } {
  const firstChord = chords[0];
  const lastChord = chords[chords.length - 1];

  let bassTotal = 0;
  if (bassRootCounts) {
    for (let i = 0; i < 12; i++) bassTotal += bassRootCounts[i];
  }

  let bestKey = 'C';
  let bestScore = -2;
  let secondScore = -2;

  for (let tonic = 0; tonic < 12; tonic++) {
    const majName = NOTE_CLASS_NAMES[tonic];
    const minName = `${NOTE_CLASS_NAMES[tonic]}m`;

    let majScore = pearsonCorrelation(globalChroma, KS_MAJOR_PROFILE, tonic);
    let minScore = pearsonCorrelation(globalChroma, KS_MINOR_PROFILE, tonic);

    // Structural tonic & bass cadence disambiguation (resolves relative Am vs C & Cm vs Eb)
    if (firstChord && firstChord.rootPitchClass === tonic) {
      if (firstChord.chord.endsWith('m')) minScore += 0.2;
      else majScore += 0.16;
    }
    if (lastChord && lastChord.rootPitchClass === tonic) {
      if (lastChord.chord.endsWith('m')) minScore += 0.09;
      else majScore += 0.09;
    }
    if (bassRootCounts && bassTotal > 0) {
      const bassShare = bassRootCounts[tonic] / bassTotal;
      majScore += bassShare * 0.11;
      minScore += bassShare * 0.13;
    }

    // Gentle leading-tone B vs b7 Bb contrast protects C major against F major, without overriding relative minor
    const isRelMajorOfMinorAnchor = Boolean(
      firstChord &&
        firstChord.chord.endsWith('m') &&
        tonic === (firstChord.rootPitchClass + 3) % 12
    );
    const leadPc = (tonic + 11) % 12;
    const flatSevenPc = (tonic + 10) % 12;
    const chromaSum = globalChroma.reduce((a, b) => a + b, 1e-6);
    if (!isRelMajorOfMinorAnchor && globalChroma[leadPc] > globalChroma[flatSevenPc] * 1.15) {
      majScore += ((globalChroma[leadPc] - globalChroma[flatSevenPc]) / chromaSum) * 0.07;
    }

    const chordTonicHits = chords.filter((c) => c.rootPitchClass === tonic).length;
    if (chordTonicHits > 0) {
      const ratioBoost = (chordTonicHits / Math.max(1, chords.length)) * 0.08;
      if (chords.some((c) => c.rootPitchClass === tonic && c.chord.endsWith('m'))) {
        minScore += ratioBoost;
      } else {
        majScore += ratioBoost;
      }
    }

    for (const [label, sc] of [
      [majName, majScore] as const,
      [minName, minScore] as const,
    ]) {
      if (sc > bestScore) {
        secondScore = bestScore;
        bestScore = sc;
        bestKey = label;
      } else if (sc > secondScore) {
        secondScore = sc;
      }
    }
  }

  const conf = Math.max(0.2, Math.min(0.99, 0.5 + bestScore * 0.45 + (bestScore - secondScore) * 0.25));
  return { musicalKey: bestKey, keyConfidence: Number(conf.toFixed(3)) };
}

function classifyChromaSegment(
  chroma: Float32Array,
  lowestMidi: number,
  lowBandRootPc: number,
  uniquePcs: number[],
  diatonicChords?: Set<string>
): { chord: string; rootPc: number; confidence: number } {
  let chromaSum = 0;
  for (let i = 0; i < 12; i++) chromaSum += chroma[i];
  if (chromaSum <= 1e-5) {
    return { chord: 'N.C.', rootPc: 0, confidence: 0 };
  }

  const lowestPc = lowestMidi >= 0 ? lowestMidi % 12 : -1;

  // Monophonic single-note pass (e.g. solo bass or solo vocal): preserve honest root note name
  if (uniquePcs.length === 1) {
    const pc = uniquePcs[0];
    return {
      chord: NOTE_CLASS_NAMES[pc],
      rootPc: pc,
      confidence: 0.78,
    };
  }

  let bestLabel = NOTE_CLASS_NAMES[lowestPc >= 0 ? lowestPc : uniquePcs[0]];
  let bestRoot = lowestPc >= 0 ? lowestPc : uniquePcs[0];
  let bestScore = -10;

  for (let root = 0; root < 12; root++) {
    if (chroma[root] <= chromaSum * 0.05) continue;
    for (const tpl of CHORD_TEMPLATES) {
      if (uniquePcs.length < tpl.minUniquePcs) continue;
      let hitEnergy = 0;
      let weightTotal = 0;
      const inTpl = new Set<number>();

      for (let i = 0; i < tpl.intervals.length; i++) {
        const pc = (root + tpl.intervals[i]) % 12;
        inTpl.add(pc);
        hitEnergy += (chroma[pc] / chromaSum) * tpl.weights[i];
        weightTotal += tpl.weights[i];
      }

      // Penalty for strong notes present outside this chord template
      let outsideEnergy = 0;
      for (let pc = 0; pc < 12; pc++) {
        if (!inTpl.has(pc)) {
          outsideEnergy += chroma[pc] / chromaSum;
        }
      }

      let score = hitEnergy / Math.max(1, weightTotal * 0.55) - outsideEnergy * 0.45 - tpl.complexityPenalty;

      if (root === lowestPc) score += 0.30;
      if (root === lowBandRootPc) score += 0.28;

      const candLabel = `${NOTE_CLASS_NAMES[root]}${tpl.suffix}`;
      if (diatonicChords && diatonicChords.has(candLabel)) {
        score += 0.22;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRoot = root;
        bestLabel = candLabel;
      }
    }
  }

  return {
    chord: bestLabel,
    rootPc: bestRoot,
    confidence: Number(Math.max(0.25, Math.min(0.99, bestScore)).toFixed(3)),
  };
}

function measureSpectralTonalityRatio(
  mono: Float32Array,
  sampleRate: number,
  polyNoteEvents: StemNoteEvent[]
): number {
  if (polyNoteEvents.length === 0 || mono.length < 2048) return 0;
  const fftSize = 2048;
  const win = buildHannWindow(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const binHz = sampleRate / fftSize;
  const minBin = Math.max(2, Math.floor(60 / binHz));
  const maxBin = Math.min(fftSize / 2 - 2, Math.ceil(2400 / binHz));

  const ratios: number[] = [];
  const step = Math.max(1, Math.floor(polyNoteEvents.length / 8));
  for (let idx = 0; idx < polyNoteEvents.length && ratios.length < 8; idx += step) {
    const ev = polyNoteEvents[idx];
    const centerSec = ev.startSec + Math.min(0.12, ev.durationSec * 0.4);
    const start = Math.max(0, Math.min(mono.length - fftSize, Math.round(centerSec * sampleRate - fftSize * 0.5)));
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftSize; i++) {
      re[i] = mono[start + i] * win[i];
    }
    fftInPlace(re, im);
    const bandMags: number[] = [];
    let peak = 0;
    for (let k = minBin; k <= maxBin; k++) {
      const m = Math.hypot(re[k], im[k]);
      bandMags.push(m);
      if (m > peak) peak = m;
    }
    if (bandMags.length === 0 || peak < 1e-4) continue;
    bandMags.sort((a, b) => a - b);
    const median = Math.max(1e-6, bandMags[Math.floor(bandMags.length / 2)]);
    ratios.push(peak / median);
  }
  if (ratios.length === 0) return 0;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

export function detectChordsAndKeyFromEvents(
  mono: Float32Array,
  sampleRate: number,
  polyNoteEvents: StemNoteEvent[],
  durationSec: number,
  bpm: number,
  onsetTimesSec: number[],
  beatTimes: number[] = [],
  seedKey?: string
): {
  isTonal: boolean;
  chords: DetectedChordSegment[];
  chordProgressionSummary: string;
  musicalKey: string;
  camelotKey?: string;
  keyConfidence: number;
  detectedRootMidi: number;
  detectedRootName: string;
} {
  // Check tonal coverage + spectral harmonic salience: guard against drum-only / unpitched percussive stems
  const coveredIntervals = polyNoteEvents
    .filter((n) => n.clarity >= 0.35 && n.durationSec >= 0.06)
    .map((n) => [n.startSec, n.startSec + n.durationSec] as const)
    .sort((a, b) => a[0] - b[0]);

  let tonalSec = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of coveredIntervals) {
    if (curStart < 0) {
      curStart = s;
      curEnd = e;
    } else if (s <= curEnd + 0.02) {
      curEnd = Math.max(curEnd, e);
    } else {
      tonalSec += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  if (curStart >= 0) tonalSec += curEnd - curStart;

  const tonalCoverage = tonalSec / Math.max(0.25, durationSec);
  const spectralTonality = measureSpectralTonalityRatio(mono, sampleRate, polyNoteEvents);
  const spectralGrid = computeSpectralChromaFrames(mono, sampleRate);

  const hasDirectSpectralTone = spectralGrid.frames.length >= 6 && spectralGrid.medianTonalityRatio >= 4.2;

  if (
    !hasDirectSpectralTone &&
    (polyNoteEvents.length === 0 ||
      spectralTonality < 6.5 ||
      (tonalCoverage < 0.14 && polyNoteEvents.length < 3) ||
      (spectralTonality < 8.5 && tonalCoverage < 0.25))
  ) {
    return {
      isTonal: false,
      chords: [],
      chordProgressionSummary: 'Percusión / Sin progresión tonal',
      musicalKey: 'Percusión (Sin tono)',
      camelotKey: undefined,
      keyConfidence: 0,
      detectedRootMidi: 36,
      detectedRootName: 'C2',
    };
  }

  const beatSec = 60 / Math.max(40, bpm);
  // Build evaluation windows strictly from Beat Grid (`beatTimes[]`) if available,
  // matching Stem Studio's beat-synchronized harmony segmentation!
  const windows: Array<{ startSec: number; endSec: number }> = [];
  if (beatTimes.length >= 4) {
    for (let i = 0; i < beatTimes.length; i++) {
      const wStart = Math.max(0, beatTimes[i]);
      if (wStart >= durationSec - 0.04) break;
      const wEnd = Math.min(durationSec, beatTimes[i + 1] ?? wStart + beatSec);
      if (wEnd - wStart >= 0.12) {
        windows.push({ startSec: wStart, endSec: wEnd });
      }
    }
  }
  if (windows.length === 0) {
    const stepSec = Math.max(0.18, Math.min(0.45, beatSec * 0.5));
    for (let t = 0; t < durationSec - 0.05; t += stepSec) {
      windows.push({ startSec: t, endSec: Math.min(durationSec, t + stepSec) });
    }
  }

  // Track-level bass root detection along steady post-kick portion of beat windows
  const bassRootCounts = new Float32Array(12);
  const windowBassRoot = new Int16Array(windows.length).fill(-1);
  if (mono.length >= Math.floor(sampleRate * 0.15)) {
    const low = filterBassIsolationBand(mono, sampleRate);
    const yinWin = Math.min(low.length, Math.max(2048, Math.round(sampleRate * 0.095)));
    for (let wIdx = 0; wIdx < windows.length; wIdx++) {
      const wStart = windows[wIdx].startSec;
      const wEnd = windows[wIdx].endSec;
      const wDur = Math.max(0.05, wEnd - wStart);
      const probeSec = wStart + Math.min(wDur * 0.58, Math.max(wDur * 0.4, 0.065));
      const st = Math.max(0, Math.min(low.length - yinWin, Math.round(probeSec * sampleRate - yinWin * 0.25)));
      if (st + 512 >= low.length) continue;
      const yin = detectPitchYin(low.subarray(st, Math.min(low.length, st + yinWin)), sampleRate, 35, 220);
      if (yin.confidence >= 0.45 && yin.freqHz >= 35 && yin.freqHz <= 210) {
        const pc = ((yin.midiNote % 12) + 12) % 12;
        windowBassRoot[wIdx] = pc;
        bassRootCounts[pc] += wDur;
      }
    }
  }

  // Blend Direct Spectral Chromagram + Polyphonic Note Chromagram for track-level key
  const polyGlobalChroma = new Float32Array(12);
  for (const n of polyNoteEvents) {
    const pc = ((n.midiNote % 12) + 12) % 12;
    const regWeight = n.midiNote <= 52 ? 1.35 : 1.0;
    polyGlobalChroma[pc] += Math.max(0.15, n.velocity) * n.durationSec * regWeight;
  }

  const normalizeChroma12 = (c: Float32Array) => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += c[i];
    if (s > 1e-6) {
      for (let i = 0; i < 12; i++) c[i] /= s;
    }
  };
  const specGlobalNorm = new Float32Array(spectralGrid.globalSpectralChroma);
  const polyGlobalNorm = new Float32Array(polyGlobalChroma);
  normalizeChroma12(specGlobalNorm);
  normalizeChroma12(polyGlobalNorm);

  const globalChroma = new Float32Array(12);
  const hasSpec = spectralGrid.frames.length >= 4;
  for (let i = 0; i < 12; i++) {
    globalChroma[i] = hasSpec
      ? specGlobalNorm[i] * 0.78 + polyGlobalNorm[i] * 0.22
      : polyGlobalNorm[i];
  }

  // First-pass Key estimation (used to bias beat chord templates cleanly to diatonic harmony)
  const prelimKey = seedKey && !seedKey.startsWith('Percusi')
    ? { musicalKey: seedKey.replace(/\s*major$/i, ''), keyConfidence: 0.92 }
    : estimateMusicalKey(globalChroma, [], bassRootCounts);

  interface FrameChordObs {
    startSec: number;
    endSec: number;
    chord: string;
    rootPc: number;
    confidence: number;
    midis: number[];
    chroma: Float32Array;
    lowestMidi: number;
    lowPc: number;
    activePcs: number[];
  }

  const runBeatClassification = (diatonicSet: Set<string>): FrameChordObs[] => {
    const obs: FrameChordObs[] = [];
    for (let wIdx = 0; wIdx < windows.length; wIdx++) {
      const { startSec: wStart, endSec: wEnd } = windows[wIdx];
      const chroma = new Float32Array(12);
      const midiSet = new Set<number>();
      let lowestMidi = 127;

      // 1. Direct FFT Spectral Chromagram inside this beat window, strongly favoring steady sustain [wStart+75ms .. wEnd-40ms] over kick-sweep attack!
      if (hasSpec) {
        const wDur = Math.max(0.1, wEnd - wStart);
        const sustainLo = wStart + Math.min(0.08, wDur * 0.22);
        const sustainHi = wEnd - Math.min(0.04, wDur * 0.1);
        let spWeightSum = 0;
        for (const sf of spectralGrid.frames) {
          if (sf.timeSec >= sustainLo && sf.timeSec <= sustainHi) {
            const w = Math.max(0.25, Math.min(2.5, sf.energy * 16));
            for (let pc = 0; pc < 12; pc++) chroma[pc] += sf.chroma[pc] * w;
            spWeightSum += w;
          }
        }
        if (spWeightSum === 0) {
          for (const sf of spectralGrid.frames) {
            if (sf.timeSec >= wStart - 0.02 && sf.timeSec <= wEnd + 0.02) {
              const w = Math.max(0.2, Math.min(2.0, sf.energy * 14));
              for (let pc = 0; pc < 12; pc++) chroma[pc] += sf.chroma[pc] * w;
              spWeightSum += w;
            }
          }
        }
        if (spWeightSum > 0) {
          for (let pc = 0; pc < 12; pc++) chroma[pc] = (chroma[pc] / spWeightSum) * 1.45;
        }
      }

      // 2. Active Polyphonic Notes overlapping this beat window
      const active = polyNoteEvents.filter(
        (ev) => ev.startSec <= wEnd - 0.02 && ev.startSec + ev.durationSec >= wStart + 0.02
      );
      for (const n of active) {
        const pc = ((n.midiNote % 12) + 12) % 12;
        midiSet.add(n.midiNote);
        if (n.midiNote < lowestMidi) lowestMidi = n.midiNote;
        const overlap = Math.min(wEnd, n.startSec + n.durationSec) - Math.max(wStart, n.startSec);
        const w =
          Math.max(0.15, n.velocity) *
          (0.45 + 0.55 * n.clarity) *
          Math.max(0.25, overlap / Math.max(0.15, wEnd - wStart));
        const regWeight = n.midiNote <= 52 ? 1.35 : 1.0;
        chroma[pc] += w * regWeight * 0.7;
      }

      // 3. Add explicit YIN low bass root reinforcement
      const lowPc = windowBassRoot[wIdx];
      if (lowPc >= 0) {
        chroma[lowPc] += 0.36;
      }

      const activePcs: number[] = [];
      let cMax = 0;
      for (let pc = 0; pc < 12; pc++) if (chroma[pc] > cMax) cMax = chroma[pc];
      for (let pc = 0; pc < 12; pc++) {
        if (chroma[pc] > cMax * 0.24) activePcs.push(pc);
      }
      if (activePcs.length === 0) continue;

      const effLowestMidi = lowestMidi < 127 ? lowestMidi : -1;
      const res = classifyChromaSegment(chroma, effLowestMidi, lowPc, activePcs, diatonicSet);
      if (res.confidence > 0) {
        obs.push({
          startSec: wStart,
          endSec: wEnd,
          chord: res.chord,
          rootPc: res.rootPc,
          confidence: res.confidence,
          midis: Array.from(midiSet).sort((a, b) => a - b),
          chroma,
          lowestMidi: effLowestMidi,
          lowPc,
          activePcs,
        });
      }
    }
    return obs;
  };

  let frameObs = runBeatClassification(getDiatonicChordSetForKey(prelimKey.musicalKey));

  // Second-pass key/diatonic refinement so intro noise or tonic ambiguity cannot flip minor<->major triads
  if ((!seedKey || seedKey.startsWith('Percusi')) && frameObs.length >= 4) {
    const pass1Chords: DetectedChordSegment[] = frameObs.map((ob, i) => ({
      id: `p1-${i}`,
      startSec: ob.startSec,
      endSec: ob.endSec,
      chord: ob.chord,
      rootPitchClass: ob.rootPc,
      rootName: NOTE_CLASS_NAMES[ob.rootPc],
      rootMidi: 36 + ob.rootPc,
      chordMidis: [],
      confidence: ob.confidence,
    }));
    const refinedKey = estimateMusicalKey(globalChroma, pass1Chords, bassRootCounts);
    if (refinedKey.musicalKey !== prelimKey.musicalKey) {
      const diatonic2 = getDiatonicChordSetForKey(refinedKey.musicalKey);
      for (const ob of frameObs) {
        const res2 = classifyChromaSegment(ob.chroma, ob.lowestMidi, ob.lowPc, ob.activePcs, diatonic2);
        if (res2.confidence > 0) {
          ob.chord = res2.chord;
          ob.rootPc = res2.rootPc;
          ob.confidence = res2.confidence;
        }
      }
    }
  }

  // Beat-level contextual smoothing (eliminates 1-beat edge flicker, A-B-A glitches, and same-root major/minor flips)
  if (frameObs.length >= 3) {
    if (
      frameObs[0].chord !== frameObs[1].chord &&
      frameObs[1].chord === frameObs[2].chord &&
      frameObs[0].rootPc === frameObs[1].rootPc
    ) {
      frameObs[0].chord = frameObs[1].chord;
    }
    for (let i = 1; i < frameObs.length - 1; i++) {
      const prev = frameObs[i - 1];
      const cur = frameObs[i];
      const next = frameObs[i + 1];
      if (prev.chord === next.chord && cur.chord !== prev.chord) {
        cur.chord = prev.chord;
        cur.rootPc = prev.rootPc;
      } else if (cur.chord !== prev.chord && cur.chord !== next.chord) {
        if (cur.rootPc === prev.rootPc && i >= 2 && frameObs[i - 2].chord === prev.chord) {
          cur.chord = prev.chord;
        } else if (
          cur.rootPc === next.rootPc &&
          i + 2 < frameObs.length &&
          frameObs[i + 2].chord === next.chord
        ) {
          cur.chord = next.chord;
        }
      }
    }
  }

  if (frameObs.length === 0) {
    return {
      isTonal: false,
      chords: [],
      chordProgressionSummary: 'Percusión / Sin progresión tonal',
      musicalKey: 'Percusión (Sin tono)',
      camelotKey: undefined,
      keyConfidence: 0,
      detectedRootMidi: 36,
      detectedRootName: 'C2',
    };
  }

  // Merge consecutive beat slots sharing the same chord (bridging small silences <= 0.35s)
  interface RawSeg {
    startSec: number;
    endSec: number;
    chord: string;
    rootPc: number;
    confSum: number;
    count: number;
    midiSet: Set<number>;
  }
  const merged: RawSeg[] = [];
  for (const ob of frameObs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.chord === ob.chord && ob.startSec - prev.endSec <= 0.35) {
      prev.endSec = ob.endSec;
      prev.confSum += ob.confidence;
      prev.count++;
      for (const m of ob.midis) prev.midiSet.add(m);
    } else {
      merged.push({
        startSec: ob.startSec,
        endSec: ob.endSec,
        chord: ob.chord,
        rootPc: ob.rootPc,
        confSum: ob.confidence,
        count: 1,
        midiSet: new Set(ob.midis),
      });
    }
  }

  // Absorb single noisy 1-beat chord blips into same-root or flanking matching chords (never eat adjacent different-root bars!)
  const segDurs = merged.map((m) => m.endSec - m.startSec).sort((a, b) => a - b);
  const medianSegDur = segDurs.length > 0 ? segDurs[Math.floor(segDurs.length / 2)] : beatSec * 2;
  const maxBlipDur =
    medianSegDur >= beatSec * 1.75
      ? beatSec * 1.12
      : Math.min(0.85, beatSec * 0.95);

  // First pass: coerce any short <=1-beat segment forward into next segment when sharing same root (e.g. A@12.69 + Am@13.31 -> Am@12.69)
  for (let i = 0; i < merged.length - 1; i++) {
    const cur = merged[i];
    const next = merged[i + 1];
    if (cur.endSec - cur.startSec <= maxBlipDur && cur.rootPc === next.rootPc && cur.chord !== next.chord) {
      cur.chord = next.chord;
    } else if (next.endSec - next.startSec <= maxBlipDur && cur.rootPc === next.rootPc && cur.chord !== next.chord) {
      next.chord = cur.chord;
    }
  }

  // Re-merge after same-root coercion
  const reMerged: RawSeg[] = [];
  for (const seg of merged) {
    const prev = reMerged[reMerged.length - 1];
    if (prev && prev.chord === seg.chord && seg.startSec - prev.endSec <= 0.35) {
      prev.endSec = seg.endSec;
      prev.confSum += seg.confSum;
      prev.count += seg.count;
      for (const m of seg.midiSet) prev.midiSet.add(m);
    } else {
      reMerged.push(seg);
    }
  }

  const cleaned: RawSeg[] = [];
  for (let i = 0; i < reMerged.length; i++) {
    const cur = reMerged[i];
    const dur = cur.endSec - cur.startSec;
    const prevClean = cleaned[cleaned.length - 1];
    const nextSeg = reMerged[i + 1];
    const canAbsorbFlanked =
      reMerged.length > 2 &&
      dur <= maxBlipDur &&
      Boolean(prevClean) &&
      Boolean(nextSeg) &&
      (prevClean.chord === nextSeg.chord || cur.rootPc === prevClean.rootPc);
    if (canAbsorbFlanked) {
      prevClean.endSec = cur.endSec;
      continue;
    }
    if (prevClean && prevClean.chord === cur.chord && cur.startSec - prevClean.endSec <= 0.35) {
      prevClean.endSec = cur.endSec;
      prevClean.confSum += cur.confSum;
      prevClean.count += cur.count;
      for (const m of cur.midiSet) prevClean.midiSet.add(m);
    } else {
      cleaned.push(cur);
    }
  }

  // Stem Studio Chord Grid Snap (`SNAP_THRESHOLD = 0.15s` from api/ai/chords/status.js!):
  // Snaps each chord change boundary cleanly to `beatTimes[]` first, then onset fallback.
  const SNAP_THRESHOLD = 0.15;
  let prevSubMidi: number | null = null;
  const chords: DetectedChordSegment[] = cleaned.map((seg, idx) => {
    let snappedStart = seg.startSec;
    let bestBeatDiff = SNAP_THRESHOLD;
    for (const bt of beatTimes) {
      const d = Math.abs(bt - seg.startSec);
      if (d < bestBeatDiff) {
        bestBeatDiff = d;
        snappedStart = bt;
      }
    }
    if (bestBeatDiff === SNAP_THRESHOLD) {
      let bestOnsetDiff = 0.075;
      for (const oSec of onsetTimesSec) {
        const d = Math.abs(oSec - seg.startSec);
        if (d < bestOnsetDiff) {
          bestOnsetDiff = d;
          snappedStart = oSec;
        }
      }
    }

    const rootMidi: number = foldPitchClassToSubRegister(seg.rootPc, prevSubMidi, 28, 40);
    prevSubMidi = rootMidi;
    const fallbackMidis = Array.from(seg.midiSet).sort((a, b) => a - b);
    const tpl = CHORD_TEMPLATES.find((t) => `${NOTE_CLASS_NAMES[seg.rootPc]}${t.suffix}` === seg.chord);
    const triadMidis = tpl
      ? tpl.intervals.map((semi) => 48 + ((seg.rootPc + semi) % 12))
      : [48 + seg.rootPc];

    return {
      id: `chord-${idx}`,
      startSec: Number(snappedStart.toFixed(4)),
      endSec: Number(seg.endSec.toFixed(4)),
      chord: seg.chord,
      rootPitchClass: seg.rootPc,
      rootName: NOTE_CLASS_NAMES[seg.rootPc],
      rootMidi,
      chordMidis: fallbackMidis.length > 0 ? fallbackMidis : triadMidis,
      confidence: Number((seg.confSum / Math.max(1, seg.count)).toFixed(3)),
    };
  });

  // Ensure strictly non-overlapping ordered chord bounds
  for (let i = 0; i < chords.length - 1; i++) {
    if (chords[i].endSec > chords[i + 1].startSec) {
      chords[i].endSec = chords[i + 1].startSec;
    }
  }

  const finalKeyRes =
    seedKey && !seedKey.startsWith('Percusi')
      ? { musicalKey: seedKey.replace(/\s*major$/i, ''), keyConfidence: 0.94 }
      : estimateMusicalKey(globalChroma, chords, bassRootCounts);
  const camelotKey = toCamelotKey(finalKeyRes.musicalKey);

  const firstChord = chords[0];
  const detectedRootMidi = firstChord ? firstChord.rootMidi : 36;
  const detectedRootName = firstChord ? midiNoteToName(detectedRootMidi) : 'C2';
  const summaryNames = chords.slice(0, 8).map((c) => c.chord);
  const chordProgressionSummary =
    chords.length > 8
      ? `${summaryNames.join(' → ')} (+${chords.length - 8})`
      : summaryNames.join(' → ') || finalKeyRes.musicalKey;

  return {
    isTonal: true,
    chords,
    chordProgressionSummary,
    musicalKey: finalKeyRes.musicalKey,
    camelotKey,
    keyConfidence: finalKeyRes.keyConfidence,
    detectedRootMidi,
    detectedRootName,
  };
}

/**
 * FIRST-STEP Pre-Import Recognition & Memory Storage:
 * Runs automatically upon importing ANY audio file or stem into Sample Lab.
 * Extracts Tempo (BPM + beat offset), Stem Studio Beat Grid (`beatTimes[]` + `downbeats[]`),
 * Musical Key + Camelot code, Beat-Snapped Named Chords, and Polyphonic Note map,
 * then caches the full result in memory so every downstream operation (Stem Replace, Solo Graves,
 * 16 Pads Grid, Chord Slicing) follows the same grid & harmony without mismatch.
 */
export function analyzeImportedAudioFirst(
  mono: Float32Array,
  sampleRate: number,
  options: {
    bpmHint?: number;
    sensitivity?: number;
    signature?: string;
    timeSignature?: string;
    seedBeatTimes?: number[];
    seedDownbeats?: number[];
    seedKey?: string;
  } = {}
): PreImportMemoryEntry {
  const sig = options.signature ?? computeAudioMemorySignature(mono, sampleRate);
  const cached = preImportMemoryCache.get(sig);
  if (cached) {
    return cached;
  }

  const durationSec = mono.length / sampleRate;
  const sensitivity = options.sensitivity ?? 0.62;
  const timeSignature = options.timeSignature ?? '4/4';

  let effectiveBpmHint = options.bpmHint;
  if (
    (!effectiveBpmHint || !Number.isFinite(effectiveBpmHint)) &&
    options.seedBeatTimes &&
    options.seedBeatTimes.length >= 4
  ) {
    const diffs: number[] = [];
    for (let i = 1; i < options.seedBeatTimes.length; i++) {
      const d = options.seedBeatTimes[i] - options.seedBeatTimes[i - 1];
      if (d >= 0.24 && d <= 1.5) diffs.push(d);
    }
    if (diffs.length >= 2) {
      diffs.sort((a, b) => a - b);
      const medIbi = diffs[Math.floor(diffs.length / 2)];
      const derivedBpm = 60 / medIbi;
      if (derivedBpm >= 45 && derivedBpm <= 220) {
        effectiveBpmHint = Math.round(derivedBpm * 10) / 10;
      }
    }
  }

  const onsetRes = detectOnsetsSpectralFlux(mono, sampleRate, {
    sensitivity: Math.max(0.54, sensitivity),
    minIntervalMs: 65,
    snapToZeroCrossing: false,
  });

  const rawPoly = analyzePolyphonicStemNotesFull(mono, sampleRate, {
    sensitivity,
    maxPolyphony: 5,
    bpmHint: effectiveBpmHint,
    hopOverride: durationSec > 60 ? 3072 : durationSec > 25 ? 2048 : undefined,
  });

  const tempoRes = detectAccurateTempoAndPhase(
    mono,
    sampleRate,
    onsetRes.onsetTimesSec,
    rawPoly.noteEvents,
    effectiveBpmHint
  );

  // Build Stem Studio Beat Grid (`beatTimes[]` & `downbeats[]`) via `repairAndRelockBeatGrid`
  const grid = rebuildBeatGridFromTempo(
    mono,
    sampleRate,
    tempoRes.bpm,
    tempoRes.beatOffsetSec,
    timeSignature,
    options.seedBeatTimes,
    options.seedDownbeats
  );

  const harmonyRes = detectChordsAndKeyFromEvents(
    mono,
    sampleRate,
    rawPoly.noteEvents,
    durationSec,
    tempoRes.bpm,
    onsetRes.onsetTimesSec,
    grid.beatTimes,
    options.seedKey
  );

  const harmonizedPolyNotes = harmonyRes.isTonal
    ? constrainNotesToDetectedHarmony(
        rawPoly.noteEvents,
        harmonyRes.chords,
        harmonyRes.musicalKey
      )
    : rawPoly.noteEvents;
  harmonizedPolyNotes.forEach((ev, idx) => {
    ev.id = `pn-${idx}`;
  });
  let hMin = 127;
  let hMax = 0;
  for (const n of harmonizedPolyNotes) {
    if (n.midiNote < hMin) hMin = n.midiNote;
    if (n.midiNote > hMax) hMax = n.midiNote;
  }

  const polyResult: FullStemAnalysisResult = {
    ...rawPoly,
    bpm: tempoRes.bpm,
    musicalKey: harmonyRes.musicalKey,
    camelotKey: harmonyRes.camelotKey,
    detectedChords: harmonyRes.chords,
    beatOffsetSec: grid.beatOffsetSec,
    beatTimes: grid.beatTimes,
    downbeats: grid.downbeats,
    noteEvents: harmonizedPolyNotes,
    midiRange:
      harmonizedPolyNotes.length > 0
        ? {
            minMidi: hMin,
            maxMidi: hMax,
            minName: midiNoteToName(hMin),
            maxName: midiNoteToName(hMax),
          }
        : undefined,
    counts: {
      total: harmonizedPolyNotes.length,
      kick: 0,
      snare: 0,
      hat: 0,
      tom: 0,
      notes: harmonizedPolyNotes.length,
    },
  };

  const memory: ImportedAudioMemoryAnalysis = {
    signature: sig,
    bpm: tempoRes.bpm,
    bpmConfidence: tempoRes.bpmConfidence,
    beatOffsetSec: grid.beatOffsetSec,
    durationSec: Number(durationSec.toFixed(4)),
    musicalKey: harmonyRes.musicalKey,
    camelotKey: harmonyRes.camelotKey,
    keyConfidence: harmonyRes.keyConfidence,
    timeSignature,
    beatTimes: grid.beatTimes,
    downbeats: grid.downbeats,
    isTonal: harmonyRes.isTonal,
    chords: harmonyRes.chords,
    chordProgressionSummary: harmonyRes.chordProgressionSummary,
    detectedRootMidi: harmonyRes.detectedRootMidi,
    detectedRootName: harmonyRes.detectedRootName,
    polyNoteEvents: harmonizedPolyNotes,
    onsetTimesSec: onsetRes.onsetTimesSec,
    analyzedAt: Date.now(),
  };

  const entry: PreImportMemoryEntry = { memory, polyResult };
  storeInMemoryCache(entry);
  return entry;
}

export function analyzeAudioBufferFirst(
  buffer: AudioBuffer,
  options: {
    bpmHint?: number;
    sensitivity?: number;
    timeSignature?: string;
    seedBeatTimes?: number[];
    seedDownbeats?: number[];
    seedKey?: string;
  } = {}
): PreImportMemoryEntry {
  const mono = buildMonoSliceFromBuffer(buffer, 0, buffer.duration);
  const sig = computeAudioMemorySignature(mono, buffer.sampleRate);
  const cached = preImportMemoryCache.get(sig);
  if (cached) {
    return cached;
  }
  return analyzeImportedAudioFirst(mono, buffer.sampleRate, {
    ...options,
    signature: sig,
  });
}
