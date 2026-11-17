import MusicTempo from 'music-tempo';
import {
  buildHannWindow,
  detectOnsetsSpectralFlux,
  fftInPlace,
} from '../../dsp-core/SpectralFftCore';
import {
  analyzePolyphonicStemNotesFull,
  filterBassIsolationBand,
  foldPitchClassToSubRegister,
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
  hiNov: Float32Array;
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
  const maxFrames = Math.min(18000, Math.floor(mono.length / hop)); // up to 3 min
  const lowRms = new Float32Array(maxFrames);
  const hiRms = new Float32Array(maxFrames);

  // Zero-alloc 1-pole crossover @ 175Hz to separate kick/sub punch from snare/hat/guitar transients
  const lpAlpha = (2 * Math.PI * 175) / (sampleRate + 2 * Math.PI * 175);
  let lp = 0;
  const stride = sampleRate > 56000 ? 2 : 1;

  for (let f = 0; f < maxFrames; f++) {
    const start = f * hop;
    const end = Math.min(mono.length, start + hop);
    let sqL = 0;
    let sqH = 0;
    let count = 0;
    for (let i = start; i < end; i += stride) {
      const x = mono[i];
      lp += lpAlpha * (x - lp);
      const hi = x - lp;
      sqL += lp * lp;
      sqH += hi * hi;
      count++;
    }
    const inv = 1 / Math.max(1, count);
    lowRms[f] = Math.sqrt(sqL * inv);
    hiRms[f] = Math.sqrt(sqH * inv);
  }

  // Positive half-wave flux delta
  const lowFlux = new Float32Array(maxFrames);
  const hiFlux = new Float32Array(maxFrames);
  let prevL = lowRms[0] ?? 0;
  let prevH = hiRms[0] ?? 0;
  for (let f = 1; f < maxFrames; f++) {
    lowFlux[f] = Math.max(0, lowRms[f] - prevL);
    hiFlux[f] = Math.max(0, hiRms[f] - prevH);
    prevL = lowRms[f] * 0.65 + prevL * 0.35;
    prevH = hiRms[f] * 0.65 + prevH * 0.35;
  }

  // Subtract moving local floor (±0.22s = 22 frames) so sustained chords/vocals stay at 0
  const lowNov = new Float32Array(maxFrames);
  const hiNov = new Float32Array(maxFrames);
  const combinedNov = new Float32Array(maxFrames);

  const normalizeAdaptive = (src: Float32Array, dst: Float32Array) => {
    const rad = 22;
    let maxV = 1e-6;
    for (let f = 0; f < maxFrames; f++) {
      const s = Math.max(0, f - rad);
      const e = Math.min(maxFrames - 1, f + rad);
      let sum = 0;
      for (let k = s; k <= e; k++) sum += src[k];
      const mean = sum / (e - s + 1);
      const val = Math.max(0, src[f] - mean * 1.15);
      dst[f] = val;
      if (val > maxV) maxV = val;
    }
    const scale = maxV > 1e-6 ? 1 / maxV : 0;
    for (let f = 0; f < maxFrames; f++) dst[f] *= scale;
  };

  normalizeAdaptive(lowFlux, lowNov);
  normalizeAdaptive(hiFlux, hiNov);

  let percussivePeaks = 0;
  for (let f = 1; f < maxFrames - 1; f++) {
    combinedNov[f] = Math.min(1.8, lowNov[f] * 1.55 + hiNov[f] * 0.95);
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
    hiNov,
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
  halfBeatLeakRatio: number;
  strongSpacingSec: number;
  bestPhiFrames: number;
} {
  const { envHz, lowNov, combinedNov, grooveStartFrame, grooveEndFrame } = nov;
  const periodFrames = (60 * envHz) / Math.max(45, bpm);
  const span = grooveEndFrame - grooveStartFrame;
  if (span < periodFrames * 2) {
    return { combEnergy: 0, beatHitFrac: 0, halfBeatLeakRatio: 0, strongSpacingSec: 1, bestPhiFrames: 0 };
  }

  const sweepSteps = Math.max(24, Math.min(72, Math.round(periodFrames)));
  let bestPhi = 0;
  let bestComb = -1;
  let bestHits = 0;
  let bestTotal = 1;
  let bestHalfSum = 0;
  let bestBeatSum = 0;

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
    let hitCnt = 0;
    let totalBeats = 0;

    for (
      let pos = grooveStartFrame + phi;
      pos < grooveEndFrame - 2;
      pos += periodFrames
    ) {
      const peakC = sampleWeightedNear(combinedNov, pos, 3);
      const peakL = sampleWeightedNear(lowNov, pos, 3);
      beatSum += peakC + peakL * 0.45;
      totalBeats++;
      if (peakC >= 0.14 || peakL >= 0.14) hitCnt++;

      const halfPos = pos + periodFrames * 0.5;
      if (halfPos < grooveEndFrame - 2) {
        halfSum += Math.max(
          sampleWeightedNear(combinedNov, halfPos, 2),
          sampleWeightedNear(lowNov, halfPos, 2)
        );
      }
    }

    const avgBeat = beatSum / Math.max(1, totalBeats);
    if (avgBeat > bestComb) {
      bestComb = avgBeat;
      bestPhi = (grooveStartFrame + phi) % periodFrames;
      bestHits = hitCnt;
      bestTotal = Math.max(1, totalBeats);
      bestHalfSum = halfSum / Math.max(1, totalBeats);
      bestBeatSum = avgBeat;
    }
  }

  // Median interval between strong low-band kick/bass peaks inside the groove
  const strongLowTimes: number[] = [];
  const minGap = Math.round(0.24 * envHz);
  let lastIdx = -minGap;
  for (let f = grooveStartFrame + 1; f < grooveEndFrame - 1; f++) {
    if (
      lowNov[f] >= 0.24 &&
      lowNov[f] >= lowNov[f - 1] &&
      lowNov[f] > lowNov[f + 1] &&
      f - lastIdx >= minGap
    ) {
      strongLowTimes.push(f / envHz);
      lastIdx = f;
    }
  }
  let medianStrongGap = 0.5;
  if (strongLowTimes.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < strongLowTimes.length; i++) {
      gaps.push(strongLowTimes[i] - strongLowTimes[i - 1]);
    }
    gaps.sort((a, b) => a - b);
    medianStrongGap = gaps[Math.floor(gaps.length / 2)];
  }

  return {
    combEnergy: bestComb,
    beatHitFrac: bestHits / bestTotal,
    halfBeatLeakRatio: bestBeatSum > 1e-5 ? bestHalfSum / bestBeatSum : 0,
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
  const { envHz, combinedNov, grooveStartFrame, grooveEndFrame, isSparseHarmonic } = nov;
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

  // 2. Normalized multi-harmonic autocorrelation over the groove novelty curve (zero intro blur)
  const maxLag = Math.min(gLen - 16, Math.round(envHz * 1.15)); // down to ~52 BPM
  const acf = new Float32Array(maxLag + 1);
  if (gLen > 120) {
    let mean = 0;
    for (let f = grooveStartFrame; f < grooveEndFrame; f++) mean += combinedNov[f];
    mean /= gLen;
    let energy = 0;
    for (let f = grooveStartFrame; f < grooveEndFrame; f++) {
      const d = combinedNov[f] - mean;
      energy += d * d;
    }
    if (energy > 1e-8) {
      for (let lag = 16; lag <= maxLag; lag++) {
        let acc = 0;
        for (let f = grooveStartFrame; f < grooveEndFrame - lag; f++) {
          acc += (combinedNov[f] - mean) * (combinedNov[f + lag] - mean);
        }
        acf[lag] = Math.max(0, acc / energy);
      }
    }
  }

  const sampleAcf = (lagF: number): number => {
    const i0 = Math.floor(lagF);
    const i1 = i0 + 1;
    if (i0 < 16 || i1 > maxLag) return 0;
    const t = lagF - i0;
    return acf[i0] * (1 - t) + acf[i1] * t;
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
    const s =
      sampleAcf(lag) * 1.0 +
      sampleAcf(lag * 2) * 0.55 +
      sampleAcf(lag * 3) * 0.3 +
      sampleAcf(lag * 4) * 0.2;
    tempogram[k] = s;
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
  for (const pk of peakBpms.slice(0, 4)) {
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
        maxBeatInterval: 1.0,
      });
      const mtTempoNum = Number(mt.tempo);
      if (Number.isFinite(mtTempoNum) && mtTempoNum >= 50 && mtTempoNum <= 210) {
        candidates.push({ bpm: mtTempoNum, weight: isSparseHarmonic ? 0.6 : 2.1 });
      }
    }
  } catch {
    // Ignore when clip is short/tonal
  }

  // 4. Optional soft tiebreaker hint (low weight so wrong DB metadata never overrides real audio!)
  if (bpmHint && Number.isFinite(bpmHint) && bpmHint >= 45 && bpmHint <= 220) {
    candidates.push({ bpm: bpmHint, weight: isSparseHarmonic ? 1.0 : 0.65 });
  }

  if (candidates.length === 0) {
    return {
      bpm: bpmHint && bpmHint >= 45 && bpmHint <= 220 ? Math.round(bpmHint) : 120,
      bpmConfidence: 0.25,
      beatOffsetSec: 0,
    };
  }

  // Expand top unique candidates + their octave partners (b/2, 2*b) and score via Comb Occupancy
  const uniqueSeeds: number[] = [];
  for (const c of candidates) {
    for (const m of [c.bpm, c.bpm * 0.5, c.bpm * 2]) {
      if (m < 58 || m > 186) continue;
      if (!uniqueSeeds.some((u) => Math.abs(u - m) <= 1.2)) {
        uniqueSeeds.push(m);
      }
    }
  }

  let bestSeed = uniqueSeeds[0] ?? 120;
  let bestFinalScore = -1;
  let bestEval = evalCombGridForBpm(nov, bestSeed);

  for (const seedBpm of uniqueSeeds) {
    const ev = evalCombGridForBpm(nov, seedBpm);

    // Sum nearby candidate weight voting within +-2.2% of this tempo
    let voteWeight = 0;
    for (const c of candidates) {
      if (Math.abs(c.bpm - seedBpm) <= Math.max(1.8, seedBpm * 0.022)) {
        voteWeight += c.weight;
      } else if (
        Math.abs(c.bpm * 2 - seedBpm) <= 2.2 ||
        Math.abs(c.bpm * 0.5 - seedBpm) <= 2.2
      ) {
        voteWeight += c.weight * 0.28;
      }
    }

    // Octave disambiguation heuristic:
    // - Penalize half-tempo when offbeats (phi + 0.5*beat) carry >62% of beat energy (e.g. DnB 84 vs 168 where snares sit offbeat in 84)
    // - Favor slow half-time (e.g. 72 ballad) when low kicks are widely spaced (>0.78s) and half-beat peaks are missing
    let octaveFactor = 1.0;
    if (ev.halfBeatLeakRatio > 0.62) {
      octaveFactor *= Math.max(0.45, 1.15 - ev.halfBeatLeakRatio * 0.85);
    }
    if (ev.strongSpacingSec > 0.78 && seedBpm > 124 && ev.beatHitFrac < 0.62 && ev.halfBeatLeakRatio <= 0.45) {
      octaveFactor *= 0.58;
    }
    if (ev.strongSpacingSec < 0.48 && seedBpm < 88 && ev.beatHitFrac < 0.7) {
      octaveFactor *= 0.75;
    }

    // Gentle center curve around 108 BPM (broad bell across 65..172 so genuine slow/fast genres stay intact!)
    const octaveDist = Math.log2(seedBpm / 108);
    const broadHumanPrior = Math.exp(-(octaveDist * octaveDist) / 1.15);

    const score =
      (voteWeight * 0.55 + ev.combEnergy * 2.2) *
      (0.35 + 0.65 * ev.beatHitFrac) *
      octaveFactor *
      (0.82 + 0.18 * broadHumanPrior);

    if (score > bestFinalScore) {
      bestFinalScore = score;
      bestSeed = seedBpm;
      bestEval = ev;
    }
  }

  // Fine continuous 0.1 BPM comb refinement around bestSeed so MusicTempo frame jitter never pulls 96 to 95
  let refined = bestSeed;
  if (!isSparseHarmonic) {
    let bestFineScore = -1;
    let fineBpm = bestSeed;
    let fineEval = bestEval;
    for (let b = Math.max(52, bestSeed - 2.2); b <= Math.min(200, bestSeed + 2.2); b += 0.1) {
      const lag = (60 * envHz) / b;
      const acfComb =
        sampleAcf(lag) * 1.0 +
        sampleAcf(lag * 2) * 0.55 +
        sampleAcf(lag * 3) * 0.3;
      const evFine = evalCombGridForBpm(nov, b);
      const combTotal = acfComb * 1.5 + evFine.combEnergy * (0.4 + 0.6 * evFine.beatHitFrac);
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

  const bpmConfidence = Number(
    Math.max(
      0.3,
      Math.min(0.99, (wSum / Math.max(1e-3, totalCandWeight)) * 0.65 + bestEval.beatHitFrac * 0.35)
    ).toFixed(3)
  );

  // Exact phase alignment (`beatOffsetSec`) anchored via comb + earliest leading percussive attack!
  const beatDur = 60 / Math.max(40, resolvedBpm);
  let rawOffsetSec = bestEval.bestPhiFrames / envHz;
  if (isSparseHarmonic && (chordAttackTimes.length > 0 || onsetTimesSec.length > 0)) {
    const earliest = chordAttackTimes[0] ?? onsetTimesSec[0] ?? 0;
    rawOffsetSec = earliest % beatDur;
  } else {
    // Refine 10ms envelope phase against sample-level peak onset near beat 1
    const firstBeatTimeSec = rawOffsetSec % beatDur;
    const probeCenter = Math.round(firstBeatTimeSec * sampleRate);
    const searchWin = Math.round(0.03 * sampleRate);
    const sMin = Math.max(0, probeCenter - searchWin);
    const sMax = Math.min(mono.length - 1, probeCenter + searchWin);
    let maxAbs = 0;
    let maxIdx = probeCenter;
    for (let i = sMin; i <= sMax; i++) {
      const a = Math.abs(mono[i]);
      if (a > maxAbs) {
        maxAbs = a;
        maxIdx = i;
      }
    }
    // Walk back slightly from peak to attack transient foot
    if (maxAbs > 0.01) {
      let footIdx = maxIdx;
      const footThresh = maxAbs * 0.15;
      while (footIdx > sMin && Math.abs(mono[footIdx - 1]) > footThresh) {
        footIdx--;
      }
      rawOffsetSec = footIdx / sampleRate;
    }
  }

  let offset = ((rawOffsetSec % beatDur) + beatDur) % beatDur;
  if (offset < 0.022 || beatDur - offset < 0.022) {
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

function estimateMusicalKey(
  globalChroma: Float32Array,
  chords: DetectedChordSegment[]
): { musicalKey: string; keyConfidence: number } {
  const firstChord = chords[0];
  const lastChord = chords[chords.length - 1];

  let bestKey = 'C';
  let bestScore = -2;
  let secondScore = -2;

  for (let tonic = 0; tonic < 12; tonic++) {
    const majName = NOTE_CLASS_NAMES[tonic];
    const minName = `${NOTE_CLASS_NAMES[tonic]}m`;

    let majScore = pearsonCorrelation(globalChroma, KS_MAJOR_PROFILE, tonic);
    let minScore = pearsonCorrelation(globalChroma, KS_MINOR_PROFILE, tonic);

    // Structural tonic tie-breaker: resolve relative major/minor (e.g. Am vs C) from progression anchor
    if (firstChord && firstChord.rootPitchClass === tonic) {
      if (firstChord.chord.endsWith('m')) minScore += 0.14;
      else majScore += 0.12;
    }
    if (lastChord && lastChord.rootPitchClass === tonic) {
      if (lastChord.chord.endsWith('m')) minScore += 0.07;
      else majScore += 0.07;
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
  uniquePcs: number[]
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
    if (chroma[root] <= chromaSum * 0.04) continue;
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

      if (root === lowestPc) score += 0.34;
      if (root === lowBandRootPc) score += 0.28;

      if (score > bestScore) {
        bestScore = score;
        bestRoot = root;
        bestLabel = `${NOTE_CLASS_NAMES[root]}${tpl.suffix}`;
      }
    }
  }

  return {
    chord: bestLabel,
    rootPc: bestRoot,
    confidence: Number(Math.max(0.25, Math.min(0.99, bestScore)).toFixed(3)),
  };
}

function estimateLowBandRootsPerStep(
  mono: Float32Array,
  sampleRate: number,
  stepSec: number,
  numSteps: number
): Int16Array {
  const out = new Int16Array(numSteps).fill(-1);
  if (mono.length < Math.floor(sampleRate * 0.15)) return out;
  const low = filterBassIsolationBand(mono, sampleRate);
  const winLen = Math.min(low.length, Math.max(2048, Math.round(sampleRate * 0.09)));

  for (let s = 0; s < numSteps; s++) {
    const startSample = Math.floor(s * stepSec * sampleRate);
    if (startSample + 512 >= low.length) break;
    const endSample = Math.min(low.length, startSample + winLen);
    const slice = low.subarray(startSample, endSample);
    const yin = detectPitchYin(slice, sampleRate);
    if (yin.confidence >= 0.48 && yin.freqHz >= 36 && yin.freqHz <= 200) {
      out[s] = yin.midiNote % 12;
    }
  }
  return out;
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
  onsetTimesSec: number[]
): {
  isTonal: boolean;
  chords: DetectedChordSegment[];
  chordProgressionSummary: string;
  musicalKey: string;
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

  if (
    polyNoteEvents.length === 0 ||
    spectralTonality < 6.5 ||
    (tonalCoverage < 0.14 && polyNoteEvents.length < 3) ||
    (spectralTonality < 8.5 && tonalCoverage < 0.25)
  ) {
    return {
      isTonal: false,
      chords: [],
      chordProgressionSummary: 'Percusión / Sin progresión tonal',
      musicalKey: 'Percusión (Sin tono)',
      keyConfidence: 0,
      detectedRootMidi: 36,
      detectedRootName: 'C2',
    };
  }

  const beatSec = 60 / Math.max(40, bpm);
  const stepSec = Math.max(0.06, Math.min(0.14, beatSec / 4));
  const numSteps = Math.max(1, Math.ceil(durationSec / stepSec));
  const lowRoots = estimateLowBandRootsPerStep(mono, sampleRate, stepSec, numSteps);

  const globalChroma = new Float32Array(12);
  interface FrameChordObs {
    startSec: number;
    endSec: number;
    chord: string;
    rootPc: number;
    confidence: number;
    midis: number[];
  }
  const frameObs: FrameChordObs[] = [];

  for (let s = 0; s < numSteps; s++) {
    const fStart = s * stepSec;
    const fEnd = Math.min(durationSec, (s + 1) * stepSec);
    const fMid = (fStart + fEnd) * 0.5;

    const active = polyNoteEvents.filter(
      (ev) => ev.startSec <= fMid + 0.025 && ev.startSec + ev.durationSec >= fMid - 0.025
    );
    if (active.length === 0) continue;

    const chroma = new Float32Array(12);
    const pcSet = new Set<number>();
    const midiSet = new Set<number>();
    let lowestMidi = 127;

    for (const n of active) {
      const pc = ((n.midiNote % 12) + 12) % 12;
      pcSet.add(pc);
      midiSet.add(n.midiNote);
      if (n.midiNote < lowestMidi) lowestMidi = n.midiNote;

      const w = Math.max(0.15, n.velocity) * (0.45 + 0.55 * n.clarity);
      // Lower notes establish harmonic bass weight more strongly
      const regWeight = n.midiNote <= 52 ? 1.35 : 1.0;
      chroma[pc] += w * regWeight;
      globalChroma[pc] += w * regWeight * (fEnd - fStart);
    }

    const res = classifyChromaSegment(
      chroma,
      lowestMidi < 127 ? lowestMidi : -1,
      lowRoots[s],
      Array.from(pcSet)
    );
    if (res.confidence > 0) {
      frameObs.push({
        startSec: fStart,
        endSec: fEnd,
        chord: res.chord,
        rootPc: res.rootPc,
        confidence: res.confidence,
        midis: Array.from(midiSet).sort((a, b) => a - b),
      });
    }
  }

  if (frameObs.length === 0) {
    return {
      isTonal: false,
      chords: [],
      chordProgressionSummary: 'Percusión / Sin progresión tonal',
      musicalKey: 'Percusión (Sin tono)',
      keyConfidence: 0,
      detectedRootMidi: 36,
      detectedRootName: 'C2',
    };
  }

  // Merge consecutive frames sharing the same chord (bridging small silences <= 0.24s)
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
    if (prev && prev.chord === ob.chord && ob.startSec - prev.endSec <= 0.24) {
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

  // Absorb tiny micro-glitches (< 0.20s) into neighbor if both neighbors are longer
  const cleaned: RawSeg[] = [];
  for (let i = 0; i < merged.length; i++) {
    const cur = merged[i];
    const dur = cur.endSec - cur.startSec;
    if (dur < 0.20 && merged.length > 1) {
      if (cleaned.length > 0 && i < merged.length - 1) {
        // Extend previous up to next or current end if next has same chord
        const prev = cleaned[cleaned.length - 1];
        prev.endSec = cur.endSec;
        continue;
      }
    }
    const prevClean = cleaned[cleaned.length - 1];
    if (prevClean && prevClean.chord === cur.chord && cur.startSec - prevClean.endSec <= 0.26) {
      prevClean.endSec = cur.endSec;
      prevClean.confSum += cur.confSum;
      prevClean.count += cur.count;
      for (const m of cur.midiSet) prevClean.midiSet.add(m);
    } else {
      cleaned.push(cur);
    }
  }

  // Snap segment boundaries to nearest spectral onset within 70ms and fold voice-led sub roots (E1..E2)
  let prevSubMidi: number | null = null;
  const chords: DetectedChordSegment[] = cleaned.map((seg, idx) => {
    let snappedStart = seg.startSec;
    let bestD = 0.075;
    for (const oSec of onsetTimesSec) {
      const d = Math.abs(oSec - seg.startSec);
      if (d < bestD) {
        bestD = d;
        snappedStart = oSec;
      }
    }
    const rootMidi: number = foldPitchClassToSubRegister(seg.rootPc, prevSubMidi, 28, 40);
    prevSubMidi = rootMidi;
    return {
      id: `chord-${idx}`,
      startSec: Number(snappedStart.toFixed(4)),
      endSec: Number(seg.endSec.toFixed(4)),
      chord: seg.chord,
      rootPitchClass: seg.rootPc,
      rootName: NOTE_CLASS_NAMES[seg.rootPc],
      rootMidi,
      chordMidis: Array.from(seg.midiSet).sort((a, b) => a - b),
      confidence: Number((seg.confSum / Math.max(1, seg.count)).toFixed(3)),
    };
  });

  // Ensure strictly non-overlapping ordered chord bounds
  for (let i = 0; i < chords.length - 1; i++) {
    if (chords[i].endSec > chords[i + 1].startSec) {
      chords[i].endSec = chords[i + 1].startSec;
    }
  }

  const { musicalKey, keyConfidence } = estimateMusicalKey(globalChroma, chords);

  const firstChord = chords[0];
  const detectedRootMidi = firstChord ? firstChord.rootMidi : 36;
  const detectedRootName = firstChord ? midiNoteToName(detectedRootMidi) : 'C2';
  const summaryNames = chords.slice(0, 8).map((c) => c.chord);
  const chordProgressionSummary =
    chords.length > 8
      ? `${summaryNames.join(' → ')} (+${chords.length - 8})`
      : summaryNames.join(' → ') || musicalKey;

  return {
    isTonal: true,
    chords,
    chordProgressionSummary,
    musicalKey,
    keyConfidence,
    detectedRootMidi,
    detectedRootName,
  };
}

/**
 * FIRST-STEP Pre-Import Recognition & Memory Storage:
 * Runs automatically upon importing ANY audio file or stem into Sample Lab.
 * Extracts Tempo (BPM + beat offset), Musical Key, Named Chords, and Polyphonic Note map,
 * then caches the full result in memory so every downstream operation (Stem Replace, Solo Graves,
 * 16 Pads Grid, Chord Slicing) respects the stored Tempo & Chords without redetection mismatch.
 */
export function analyzeImportedAudioFirst(
  mono: Float32Array,
  sampleRate: number,
  options: { bpmHint?: number; sensitivity?: number; signature?: string } = {}
): PreImportMemoryEntry {
  const sig = options.signature ?? computeAudioMemorySignature(mono, sampleRate);
  const cached = preImportMemoryCache.get(sig);
  if (cached) {
    return cached;
  }

  const durationSec = mono.length / sampleRate;
  const sensitivity = options.sensitivity ?? 0.62;

  const onsetRes = detectOnsetsSpectralFlux(mono, sampleRate, {
    sensitivity: Math.max(0.54, sensitivity),
    minIntervalMs: 65,
    snapToZeroCrossing: false,
  });

  const rawPoly = analyzePolyphonicStemNotesFull(mono, sampleRate, {
    sensitivity,
    maxPolyphony: 5,
    bpmHint: options.bpmHint,
    hopOverride: durationSec > 60 ? 3072 : durationSec > 25 ? 2048 : undefined,
  });

  const tempoRes = detectAccurateTempoAndPhase(
    mono,
    sampleRate,
    onsetRes.onsetTimesSec,
    rawPoly.noteEvents,
    options.bpmHint
  );

  const harmonyRes = detectChordsAndKeyFromEvents(
    mono,
    sampleRate,
    rawPoly.noteEvents,
    durationSec,
    tempoRes.bpm,
    onsetRes.onsetTimesSec
  );

  const polyResult: FullStemAnalysisResult = {
    ...rawPoly,
    bpm: tempoRes.bpm,
    musicalKey: harmonyRes.musicalKey,
    detectedChords: harmonyRes.chords,
    beatOffsetSec: tempoRes.beatOffsetSec,
  };

  const memory: ImportedAudioMemoryAnalysis = {
    signature: sig,
    bpm: tempoRes.bpm,
    bpmConfidence: tempoRes.bpmConfidence,
    beatOffsetSec: tempoRes.beatOffsetSec,
    durationSec: Number(durationSec.toFixed(4)),
    musicalKey: harmonyRes.musicalKey,
    keyConfidence: harmonyRes.keyConfidence,
    isTonal: harmonyRes.isTonal,
    chords: harmonyRes.chords,
    chordProgressionSummary: harmonyRes.chordProgressionSummary,
    detectedRootMidi: harmonyRes.detectedRootMidi,
    detectedRootName: harmonyRes.detectedRootName,
    polyNoteEvents: rawPoly.noteEvents,
    onsetTimesSec: onsetRes.onsetTimesSec,
    analyzedAt: Date.now(),
  };

  const entry: PreImportMemoryEntry = { memory, polyResult };
  storeInMemoryCache(entry);
  return entry;
}

export function analyzeAudioBufferFirst(
  buffer: AudioBuffer,
  options: { bpmHint?: number; sensitivity?: number } = {}
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
