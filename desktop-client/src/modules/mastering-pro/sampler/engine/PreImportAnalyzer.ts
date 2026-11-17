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

function estimateAutocorrelationBpm(
  mono: Float32Array,
  sampleRate: number
): { bpm: number; strength: number } | null {
  const durationSec = mono.length / sampleRate;
  if (durationSec < 1.6) return null;

  const envHz = 100;
  const hop = Math.max(1, Math.round(sampleRate / envHz));
  const maxFrames = Math.min(4500, Math.floor(mono.length / hop));
  if (maxFrames < 140) return null;

  const flux = new Float32Array(maxFrames);
  let prevRms = 0;
  for (let f = 0; f < maxFrames; f++) {
    const off = f * hop;
    const end = Math.min(mono.length, off + hop);
    let sq = 0;
    for (let i = off; i < end; i++) {
      const v = mono[i];
      sq += v * v;
    }
    const rms = Math.sqrt(sq / Math.max(1, end - off));
    flux[f] = Math.max(0, rms - prevRms);
    prevRms = rms * 0.72 + prevRms * 0.28;
  }

  let mean = 0;
  for (let f = 0; f < maxFrames; f++) mean += flux[f];
  mean /= maxFrames;
  if (mean < 1e-5) return null;

  const minLag = Math.floor((60 / 168) * envHz); // ~35
  const maxLag = Math.min(maxFrames - 10, Math.ceil((60 / 68) * envHz)); // ~88
  let bestLag = -1;
  let bestCorr = 0;
  let totalEnergy = 0;
  for (let f = 0; f < maxFrames; f++) {
    const d = flux[f] - mean;
    totalEnergy += d * d;
  }
  if (totalEnergy <= 1e-8) return null;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let f = 0; f < maxFrames - lag; f++) {
      acc += (flux[f] - mean) * (flux[f + lag] - mean);
    }
    const norm = acc / totalEnergy;
    // Slight preference for common 85..148 BPM vs half/double extremes
    const bpmCand = (60 * envHz) / lag;
    const bandBias = bpmCand >= 82 && bpmCand <= 148 ? 1.06 : 0.94;
    const weighted = norm * bandBias;
    if (weighted > bestCorr) {
      bestCorr = weighted;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorr < 0.08) return null;
  const exactBpm = (60 * envHz) / bestLag;
  return { bpm: exactBpm, strength: Math.min(1, bestCorr) };
}

export function detectAccurateTempoAndPhase(
  mono: Float32Array,
  sampleRate: number,
  onsetTimesSec: number[],
  polyNoteEvents: StemNoteEvent[],
  bpmHint?: number
): { bpm: number; bpmConfidence: number; beatOffsetSec: number } {
  const durationSec = mono.length / sampleRate;
  const chordAttackTimes = extractSimultaneousAttackTimes(polyNoteEvents);
  const candidates: Array<{ bpm: number; weight: number }> = [];

  // 1. Inter-onset intervals (exact sample-rate timestamps, duple octave folded into 72..158 BPM)
  const addIntervalVotes = (times: number[], baseWeight: number, maxSkip: number) => {
    for (let i = 0; i < times.length; i++) {
      for (let j = i + 1; j < Math.min(times.length, i + 1 + maxSkip); j++) {
        const dt = times[j] - times[i];
        if (dt < 0.16 || dt > 5.0) continue;
        const skip = j - i;
        const rawBpm = 60 / dt;
        const folded = foldTempoIntoPreferredBand(rawBpm, 72, 158);
        if (folded < 60 || folded > 180) continue;
        const stepDecay = 1 / (1 + (skip - 1) * 0.35);
        const directBeatBonus = rawBpm >= 72 && rawBpm <= 160 ? 1.25 : 1.0;
        const bandBias = folded >= 84 && folded <= 146 ? 1.15 : 0.95;
        candidates.push({
          bpm: folded,
          weight: baseWeight * stepDecay * directBeatBonus * bandBias,
        });
      }
    }
  };

  addIntervalVotes(onsetTimesSec, 1.0, 8);
  // Chord changes are super reliable for slow chord progressions (e.g. 1 chord per 4 beats @ 112 BPM)
  const chordBoost = onsetTimesSec.length <= 16 ? 2.6 : 1.45;
  addIntervalVotes(chordAttackTimes, chordBoost, 4);

  // 2. Amplitude flux autocorrelation (rock solid for steady grooves)
  const ac = estimateAutocorrelationBpm(mono, sampleRate);
  if (ac) {
    candidates.push({
      bpm: foldTempoIntoPreferredBand(ac.bpm, 72, 158),
      weight: 2.2 * ac.strength + 0.6,
    });
  }

  // 3. MusicTempo analysis compensated for buffer sample rate vs 44100 Hz assumption
  try {
    let rmsSq = 0;
    const step = Math.max(1, Math.floor(mono.length / 4096));
    let cnt = 0;
    for (let i = 0; i < mono.length; i += step) {
      rmsSq += mono[i] * mono[i];
      cnt++;
    }
    const rms = Math.sqrt(rmsSq / Math.max(1, cnt));
    if (durationSec >= 1.25 && rms > 0.002) {
      const capSamples = Math.min(mono.length, Math.floor(sampleRate * 45));
      const mt = new MusicTempo(Array.from(mono.subarray(0, capSamples)));
      const mtTempoNum = Number(mt.tempo);
      if (Number.isFinite(mtTempoNum) && mtTempoNum > 20) {
        const srCompensated = mtTempoNum * (sampleRate / 44100);
        const foldedMt = foldTempoIntoPreferredBand(srCompensated, 72, 158);
        candidates.push({ bpm: foldedMt, weight: 1.5 });
      }
    }
  } catch {
    // Fallback cleanly when clip is short/tonally flat for beat-tracker
  }

  // 4. Soft metadata/song prior if provided
  if (bpmHint && Number.isFinite(bpmHint) && bpmHint >= 45 && bpmHint <= 220) {
    candidates.push({
      bpm: foldTempoIntoPreferredBand(bpmHint, 72, 158),
      weight: 1.35,
    });
  }

  if (candidates.length === 0) {
    return {
      bpm: bpmHint && bpmHint >= 45 && bpmHint <= 220 ? Math.round(bpmHint) : 120,
      bpmConfidence: 0.25,
      beatOffsetSec: 0,
    };
  }

  // Soft Gaussian kernel density voting over integer BPM bins 60..180
  const minBin = 60;
  const maxBin = 180;
  const scores = new Float32Array(maxBin + 1);
  let totalWeight = 0;
  for (const c of candidates) {
    totalWeight += c.weight;
    const center = Math.round(c.bpm);
    for (let b = Math.max(minBin, center - 3); b <= Math.min(maxBin, center + 3); b++) {
      const diff = c.bpm - b;
      scores[b] += c.weight * Math.exp(-(diff * diff) / 1.8);
    }
  }

  let peakBin = 120;
  let peakScore = -1;
  for (let b = minBin; b <= maxBin; b++) {
    if (scores[b] > peakScore) {
      peakScore = scores[b];
      peakBin = b;
    }
  }

  // Weighted average within +-2.2 BPM around winning peak
  let wSum = 0;
  let wBpmSum = 0;
  for (const c of candidates) {
    if (Math.abs(c.bpm - peakBin) <= 2.2) {
      wSum += c.weight;
      wBpmSum += c.bpm * c.weight;
    }
  }

  const rawEst = wSum > 0 ? wBpmSum / wSum : peakBin;
  const nearestInt = Math.round(rawEst);
  const resolvedBpm =
    Math.abs(rawEst - nearestInt) <= 0.45
      ? nearestInt
      : Math.round(rawEst * 10) / 10;

  const bpmConfidence = Number(
    Math.max(0.25, Math.min(0.99, wSum / Math.max(1e-3, totalWeight))).toFixed(3)
  );

  // Compute beat offset (phase alignment relative to beat grid)
  const beatDur = 60 / Math.max(40, resolvedBpm);
  const earliestAnchor =
    chordAttackTimes.length > 0 && onsetTimesSec.length > 0
      ? Math.min(chordAttackTimes[0], onsetTimesSec[0])
      : onsetTimesSec[0] ?? chordAttackTimes[0] ?? 0;

  let offset = earliestAnchor % beatDur;
  if (offset < 0.04 || beatDur - offset < 0.04) {
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
