import {
  buildHannWindow,
  detectOnsetsSpectralFlux,
  fftInPlace,
} from '../../dsp-core/SpectralFftCore';
import { detectPitchYin, midiNoteToName } from './PitchDetector';
import type {
  DetectedChordSegment,
  DetectionSourceMode,
  DrumArticulation,
  DrumPieceRole,
  FullStemAnalysisResult,
  StemAnalysisMode,
  StemDrumHitEvent,
  StemNoteEvent,
  StemQuantizeMode,
} from '../types/sampler.types';

const TOKEN_TO_PC: Record<string, number> = {
  C: 0, 'B#': 0,
  'C#': 1, DB: 1,
  D: 2,
  'D#': 3, EB: 3,
  E: 4, FB: 4,
  F: 5, 'E#': 5,
  'F#': 6, GB: 6,
  G: 7,
  'G#': 8, AB: 8,
  A: 9,
  'A#': 10, BB: 10,
  B: 11, CB: 11,
};

export function parsePitchClassToken(raw: string): number {
  const m = (raw || '').trim().match(/^([A-Ga-g])([#b]?)/);
  if (!m) return -1;
  const tok = `${m[1].toUpperCase()}${(m[2] || '').toUpperCase()}`;
  return TOKEN_TO_PC[tok] ?? -1;
}

export function parseMusicalKeyInfo(musicalKey?: string): {
  tonicPc: number;
  isMinor: boolean;
  scalePcs: Set<number>;
} | null {
  if (!musicalKey) return null;
  const trimmed = musicalKey.trim();
  if (!trimmed || /^percusi/i.test(trimmed)) return null;
  const tonicPc = parsePitchClassToken(trimmed);
  if (tonicPc < 0) return null;
  const isMinor = /\bmin(or)?\b/i.test(trimmed) || /^[A-G][#b]?m(?:$|[^a-z])/i.test(trimmed);
  const intervals = isMinor
    ? [0, 2, 3, 5, 7, 8, 10, 11] // natural + harmonic minor
    : [0, 2, 4, 5, 7, 9, 11];
  const scalePcs = new Set<number>(intervals.map((semi) => (tonicPc + semi) % 12));
  return { tonicPc, isMinor, scalePcs };
}

export function getChordPitchClasses(chordSeg: DetectedChordSegment): Set<number> {
  const pcs = new Set<number>();
  const rootPc = ((chordSeg.rootPitchClass % 12) + 12) % 12;
  pcs.add(rootPc);
  const label = (chordSeg.chord || '').trim();
  const suffix = label.replace(/^[A-G][#b]?/i, '').toLowerCase();
  if (suffix === 'm') {
    pcs.add((rootPc + 3) % 12);
    pcs.add((rootPc + 7) % 12);
  } else if (suffix === 'm7') {
    pcs.add((rootPc + 3) % 12);
    pcs.add((rootPc + 7) % 12);
    pcs.add((rootPc + 10) % 12);
  } else if (suffix === '7') {
    pcs.add((rootPc + 4) % 12);
    pcs.add((rootPc + 7) % 12);
    pcs.add((rootPc + 10) % 12);
  } else if (suffix === 'maj7') {
    pcs.add((rootPc + 4) % 12);
    pcs.add((rootPc + 7) % 12);
    pcs.add((rootPc + 11) % 12);
  } else if (suffix === 'sus4') {
    pcs.add((rootPc + 5) % 12);
    pcs.add((rootPc + 7) % 12);
  } else if (suffix === 'sus2') {
    pcs.add((rootPc + 2) % 12);
    pcs.add((rootPc + 7) % 12);
  } else if (suffix === 'dim') {
    pcs.add((rootPc + 3) % 12);
    pcs.add((rootPc + 6) % 12);
  } else if (suffix === '5') {
    pcs.add((rootPc + 7) % 12);
  } else {
    // Major triad fallback
    pcs.add((rootPc + 4) % 12);
    pcs.add((rootPc + 7) % 12);
  }
  return pcs;
}

/**
 * Enforces harmonic consistency so detected melodic/polyphonic notes respect
 * the song's detected chords & musical key (eliminating ±1 semitone FFT smear
 * ghosts and out-of-key drum/noise artifacts).
 */
export function constrainNotesToDetectedHarmony(
  notes: StemNoteEvent[],
  detectedChords?: DetectedChordSegment[],
  musicalKey?: string,
  options: { isMonophonic?: boolean } = {}
): StemNoteEvent[] {
  if (notes.length === 0) return notes;
  const hasChords = Boolean(detectedChords && detectedChords.length > 0);
  const keyInfo = parseMusicalKeyInfo(musicalKey);
  if (!hasChords && !keyInfo) return notes;

  const findActiveChord = (tSec: number): DetectedChordSegment | undefined => {
    if (!detectedChords || detectedChords.length === 0) return undefined;
    const probeT = tSec + 0.02;
    for (const c of detectedChords) {
      if (probeT >= c.startSec && probeT < c.endSec) {
        return c;
      }
    }
    for (const c of detectedChords) {
      if (tSec >= c.startSec && tSec < c.endSec) {
        return c;
      }
    }
    // Nearest chord fallback
    let best = detectedChords[0];
    let bestDist = Infinity;
    for (const c of detectedChords) {
      const d = tSec < c.startSec ? c.startSec - tSec : tSec > c.endSec ? tSec - c.endSec : 0;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return bestDist <= 0.35 ? best : undefined;
  };

  // Pre-index existing note pitches near each timestamp so ±1 semitone ghost sidelobes
  // sitting next to an ALREADY-DETECTED chord tone are dropped rather than duplicated
  const hasNeighborChordNoteAtTime = (
    targetMidi: number,
    startSec: number,
    minVel: number
  ): boolean => {
    return notes.some(
      (o) =>
        o.midiNote === targetMidi &&
        Math.abs(o.startSec - startSec) <= 0.09 &&
        o.velocity >= minVel
    );
  };

  const out: StemNoteEvent[] = [];
  for (const ev of notes) {
    const pc = ((ev.midiNote % 12) + 12) % 12;
    const activeChord = findActiveChord(ev.startSec);
    const chordPcs = activeChord ? getChordPitchClasses(activeChord) : null;
    const inChord = chordPcs ? chordPcs.has(pc) : false;
    const inScale = keyInfo ? keyInfo.scalePcs.has(pc) : true;

    if (inChord) {
      out.push(ev);
      continue;
    }

    // Check ±1 semitone ghost artifact against active chord tones
    const upPc = (pc + 1) % 12;
    const dnPc = (pc + 11) % 12;
    const upInChord = chordPcs ? chordPcs.has(upPc) : false;
    const dnInChord = chordPcs ? chordPcs.has(dnPc) : false;

    if (upInChord || dnInChord) {
      // If the real chord note is already present at this beat, this ±1 semitone peak is spectral bleed -> drop!
      if (
        (upInChord && hasNeighborChordNoteAtTime(ev.midiNote + 1, ev.startSec, ev.velocity * 0.55)) ||
        (dnInChord && hasNeighborChordNoteAtTime(ev.midiNote - 1, ev.startSec, ev.velocity * 0.55))
      ) {
        continue;
      }
      // If out of scale OR in low accompaniment register (< C4 = 60), snap ±1 semitone to chord tone
      if (!inScale || ev.midiNote < 60 || options.isMonophonic) {
        const snappedMidi = upInChord ? ev.midiNote + 1 : ev.midiNote - 1;
        out.push({
          ...ev,
          midiNote: snappedMidi,
          noteName: midiNoteToName(snappedMidi),
        });
        continue;
      }
    }

    // Reject non-scale chromatic bleed completely unless ultra-high clarity melody in upper register
    if (!inScale) {
      if (ev.midiNote >= 62 && ev.clarity >= 0.92 && ev.durationSec >= 0.16 && ev.velocity >= 0.6) {
        out.push(ev);
      }
      continue;
    }

    // Note IS in the musical scale, but NOT in the active chord:
    // Keep genuine upper melody / sustained non-bleed bass motions, drop chord-register sidelobe ghosts
    if (ev.midiNote < 55 && chordPcs && activeChord && activeChord.confidence >= 0.45) {
      const hasSidelobeNeighbor =
        hasNeighborChordNoteAtTime(ev.midiNote + 2, ev.startSec, ev.velocity * 0.7) ||
        hasNeighborChordNoteAtTime(ev.midiNote - 2, ev.startSec, ev.velocity * 0.7);
      if (!hasSidelobeNeighbor && ev.durationSec >= 0.25 && ev.velocity >= 0.62 && ev.clarity >= 0.88) {
        out.push(ev);
      }
      continue;
    }
    if (ev.durationSec < 0.09 && ev.velocity < 0.45) {
      continue;
    }
    out.push(ev);
  }

  // Deduplicate identical MIDI notes whose onset snap/harmonic snap aligned within 70ms
  out.sort((a, b) => a.startSec - b.startSec || a.midiNote - b.midiNote);
  const deduped: StemNoteEvent[] = [];
  for (const ev of out) {
    const existing = deduped.find(
      (prev) => prev.midiNote === ev.midiNote && Math.abs(prev.startSec - ev.startSec) <= 0.07
    );
    if (existing) {
      const endA = existing.startSec + existing.durationSec;
      const endB = ev.startSec + ev.durationSec;
      existing.durationSec = Number(Math.max(0.05, Math.max(endA, endB) - existing.startSec).toFixed(4));
      existing.velocity = Math.max(existing.velocity, ev.velocity);
      existing.clarity = Math.max(existing.clarity, ev.clarity);
    } else {
      deduped.push({ ...ev });
    }
  }
  return deduped;
}

export function inferStemModeFromName(rawName: string): StemAnalysisMode {
  const n = (rawName || '').toLowerCase();
  if (
    n.includes('drum') ||
    n.includes('bateria') ||
    n.includes('batería') ||
    n.includes('perc') ||
    n.includes('kick') ||
    n.includes('snare') ||
    n.includes('bombo') ||
    n.includes('caja')
  ) {
    return 'drums';
  }
  if (
    n.includes('bass') ||
    n.includes('bajo') ||
    n.includes('vocal') ||
    n.includes('voz') ||
    n.includes('lead') ||
    n.includes('sax') ||
    n.includes('solo')
  ) {
    return 'monophonic';
  }
  // Piano, Guitar, Keys, Strings, Synths, Other -> Polyphonic chord+melody analyzer
  return 'polyphonic';
}

function findNearestGridTimeOnBeatGrid(
  rawSec: number,
  beatTimes: number[],
  fallbackBeatSec: number,
  divsPerBeat: number
): { targetSec: number; stepSec: number } {
  // Binary search insertion point in beatTimes
  let lo = 0;
  let hi = beatTimes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid] <= rawSec) lo = mid + 1;
    else hi = mid - 1;
  }
  const leftIdx = Math.max(0, Math.min(beatTimes.length - 1, hi));
  let b0: number;
  let b1: number;
  if (rawSec < beatTimes[0]) {
    const localBeat =
      beatTimes.length >= 2
        ? Math.max(0.25, Math.min(1.6, beatTimes[1] - beatTimes[0]))
        : fallbackBeatSec;
    const stepsBack = Math.ceil((beatTimes[0] - rawSec) / localBeat);
    b0 = beatTimes[0] - stepsBack * localBeat;
    b1 = b0 + localBeat;
  } else if (leftIdx >= beatTimes.length - 1) {
    const lastB = beatTimes[beatTimes.length - 1];
    const localBeat =
      beatTimes.length >= 2
        ? Math.max(0.25, Math.min(1.6, lastB - beatTimes[beatTimes.length - 2]))
        : fallbackBeatSec;
    const stepsFwd = Math.floor((rawSec - lastB) / localBeat);
    b0 = lastB + stepsFwd * localBeat;
    b1 = b0 + localBeat;
  } else {
    b0 = beatTimes[leftIdx];
    b1 = beatTimes[leftIdx + 1];
  }
  const span = Math.max(0.2, b1 - b0);
  const stepSec = span / divsPerBeat;
  const subIdx = Math.max(0, Math.min(divsPerBeat, Math.round((rawSec - b0) / stepSec)));
  return {
    targetSec: b0 + subIdx * stepSec,
    stepSec,
  };
}

function snapTimeToTempoGrid(
  rawSec: number,
  bpm: number,
  beatOffsetSec: number,
  durationSec: number,
  mode: StemQuantizeMode,
  beatTimes?: number[]
): number {
  if (mode === 'off' || !Number.isFinite(bpm) || bpm < 40 || bpm > 220) {
    return rawSec;
  }
  const beatSec = 60 / bpm;
  const divsPerBeat = mode === 'grid-8' ? 2 : 4;
  let rawTarget: number;
  let stepSec: number;
  if (beatTimes && beatTimes.length >= 2) {
    const res = findNearestGridTimeOnBeatGrid(rawSec, beatTimes, beatSec, divsPerBeat);
    rawTarget = res.targetSec;
    stepSec = res.stepSec;
  } else {
    stepSec = beatSec / divsPerBeat;
    const gridIdx = Math.round((rawSec - beatOffsetSec) / stepSec);
    rawTarget = beatOffsetSec + gridIdx * stepSec;
  }
  const target = Math.max(0, Math.min(durationSec - 0.015, rawTarget));
  const dist = Math.abs(target - rawSec);
  if (mode === 'soft') {
    if (dist > stepSec * 0.36) return rawSec;
    return Number((rawSec + (target - rawSec) * 0.78).toFixed(4));
  }
  return Number(target.toFixed(4));
}

export function quantizeDrumHitsToTempo(
  hits: StemDrumHitEvent[],
  bpm: number,
  beatOffsetSec: number,
  durationSec: number,
  mode: StemQuantizeMode,
  beatTimes?: number[]
): StemDrumHitEvent[] {
  if (mode === 'off' || hits.length === 0) return hits;
  const snapped = hits
    .map((h) => {
      const qTime = snapTimeToTempoGrid(h.timeSec, bpm, beatOffsetSec, durationSec, mode, beatTimes);
      const peakLead = Math.max(0, Math.min(0.018, h.peakTimeSec - h.timeSec));
      return {
        ...h,
        timeSec: qTime,
        peakTimeSec: Number(Math.max(qTime, Math.min(durationSec - 0.005, qTime + peakLead)).toFixed(4)),
      };
    })
    .sort((a, b) => a.timeSec - b.timeSec);

  // Prevent same-role double-flam collisions after grid snapping (keep stronger hit within 28ms)
  const deduped: StemDrumHitEvent[] = [];
  for (const h of snapped) {
    const dup = deduped.find(
      (prev) => prev.role === h.role && Math.abs(prev.timeSec - h.timeSec) < 0.028
    );
    if (dup) {
      if (h.velocity > dup.velocity) {
        dup.timeSec = h.timeSec;
        dup.peakTimeSec = h.peakTimeSec;
        dup.velocity = h.velocity;
      }
    } else {
      deduped.push({ ...h });
    }
  }
  deduped.forEach((h, i) => {
    h.id = `dh-${i}`;
  });
  return deduped;
}

export function quantizeNoteEventsToTempo(
  notes: StemNoteEvent[],
  bpm: number,
  beatOffsetSec: number,
  durationSec: number,
  mode: StemQuantizeMode,
  strictMonophonic = false,
  beatTimes?: number[]
): StemNoteEvent[] {
  if (mode === 'off' || notes.length === 0) return notes;
  const snapped = notes
    .map((n) => {
      const qStart = snapTimeToTempoGrid(n.startSec, bpm, beatOffsetSec, durationSec, mode, beatTimes);
      return {
        ...n,
        startSec: qStart,
        durationSec: Number(Math.max(0.04, Math.min(durationSec - qStart, n.durationSec)).toFixed(4)),
      };
    })
    .sort((a, b) => a.startSec - b.startSec || a.midiNote - b.midiNote);

  if (strictMonophonic) {
    const out: StemNoteEvent[] = [];
    for (const ev of snapped) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(ev.startSec - prev.startSec) < 0.03) {
        if (ev.velocity > prev.velocity) {
          prev.midiNote = ev.midiNote;
          prev.noteName = ev.noteName;
          prev.velocity = ev.velocity;
        }
        prev.durationSec = Math.max(prev.durationSec, ev.durationSec);
      } else {
        out.push(ev);
      }
    }
    for (let i = 0; i < out.length - 1; i++) {
      const maxDur = Math.max(0.04, out[i + 1].startSec - out[i].startSec - 0.008);
      if (out[i].durationSec > maxDur) {
        out[i].durationSec = Number(maxDur.toFixed(4));
      }
    }
    return out;
  }

  return snapped;
}

export function estimateBpmFromOnsets(
  onsetTimesSec: number[],
  fallbackBpm = 120
): number {
  if (onsetTimesSec.length < 4) return fallbackBpm;
  const minBpm = 60;
  const maxBpm = 184;
  const step = 0.5;
  const numBins = Math.round((maxBpm - minBpm) / step) + 1;
  const hist = new Float64Array(numBins);

  for (let i = 0; i < onsetTimesSec.length; i++) {
    for (let j = i + 1; j < Math.min(onsetTimesSec.length, i + 14); j++) {
      const dt = onsetTimesSec[j] - onsetTimesSec[i];
      if (dt < 0.18 || dt > 2.4) continue;
      const distWeight = 1 / (1 + (j - i - 1) * 0.22);
      // Evaluate 1x, 2x, 4x beat subdivisions per interval
      for (const mult of [0.5, 1, 2, 4]) {
        const candBpm = (60 * mult) / dt;
        if (candBpm < minBpm || candBpm > maxBpm) continue;
        const subWeight = mult === 1 ? 1.0 : mult === 2 ? 0.78 : mult === 0.5 ? 0.55 : 0.42;
        // Gentle musical groove prior centered around 110 BPM
        const prior = Math.exp(-Math.pow(Math.log2(candBpm / 110), 2) / 1.25);
        const w = distWeight * subWeight * (0.75 + 0.25 * prior);
        const centerBin = Math.round((candBpm - minBpm) / step);
        for (let d = -3; d <= 3; d++) {
          const bIdx = centerBin + d;
          if (bIdx >= 0 && bIdx < numBins) {
            hist[bIdx] += w * Math.exp(-(d * d) * 0.35);
          }
        }
      }
    }
  }

  let bestBin = -1;
  let bestScore = -1;
  for (let bIdx = 0; bIdx < numBins; bIdx++) {
    if (hist[bIdx] > bestScore) {
      bestScore = hist[bIdx];
      bestBin = bIdx;
    }
  }
  if (bestBin < 0) return fallbackBpm;
  return Math.round(minBpm + bestBin * step);
}

export function applyBiquadBandPassOrLp(
  mono: Float32Array,
  sr: number,
  hpHz: number | null,
  lpHz: number | null,
  stages = 1
): Float32Array {
  const n = mono.length;
  const out = new Float32Array(n);
  out.set(mono);

  const passes = Math.max(1, Math.min(4, stages));
  for (let pass = 0; pass < passes; pass++) {
    if (hpHz !== null && hpHz > 0 && hpHz < sr * 0.45) {
      const w = (2 * Math.PI * hpHz) / sr;
      const c = Math.cos(w);
      const a = Math.sin(w) / (2 * Math.SQRT1_2);
      const a0 = 1 + a;
      const b0 = ((1 + c) * 0.5) / a0;
      const b1 = -(1 + c) / a0;
      const b2 = b0;
      const a1 = (-2 * c) / a0;
      const a2 = (1 - a) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        const x = out[i];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        out[i] = y;
      }
    }

    if (lpHz !== null && lpHz > 0 && lpHz < sr * 0.45) {
      const w = (2 * Math.PI * lpHz) / sr;
      const c = Math.cos(w);
      const a = Math.sin(w) / (2 * Math.SQRT1_2);
      const a0 = 1 + a;
      const b0 = ((1 - c) * 0.5) / a0;
      const b1 = (1 - c) / a0;
      const b2 = b0;
      const a1 = (-2 * c) / a0;
      const a2 = (1 - a) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        const x = out[i];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        out[i] = y;
      }
    }
  }

  return out;
}

export interface TomResonanceEvaluation {
  isPitchedTom: boolean;
  freqHz: number;
  clarity: number;
  tomRms: number;
  subRms: number;
  crackRms: number;
  decayRatio: number;
  midiNote: number;
  subRoleLabel: string;
  articulation: DrumArticulation;
  pitchOffsetSemis: number;
}

/**
 * High-precision Acoustic Tom vs. Kick & Snare Discriminator.
 * Evaluates the settled resonant drum-head window [+22ms .. +88ms] (after the Kick's 0..22ms
 * beater pitch-chirp has already dropped below 72 Hz into the sub-bass, while a Floor/Mid/High Tom
 * continues ringing at its true 76..270 Hz shell fundamental).
 */
export function evaluateTomResonanceAtSample(params: {
  sampleIdx: number;
  sampleRate: number;
  subKickSig: Float32Array;
  tomSig: Float32Array;
  crackSig: Float32Array;
  lowBodySig?: Float32Array;
  isFullMix?: boolean;
}): TomResonanceEvaluation {
  const { sampleIdx, sampleRate, subKickSig, tomSig, crackSig, lowBodySig, isFullMix = false } = params;
  const totalLen = tomSig.length;
  const pitchSig = lowBodySig ?? tomSig;
  const fallback: TomResonanceEvaluation = {
    isPitchedTom: false,
    freqHz: 130,
    clarity: 0,
    tomRms: 0,
    subRms: 0,
    crackRms: 0,
    decayRatio: 1,
    midiNote: 47,
    subRoleLabel: 'Mid Tom (47)',
    articulation: 'mid-tom',
    pitchOffsetSemis: 0,
  };

  // Settled resonant body window [+22ms .. +86ms]:
  // By +22ms, a Kick Drum's beater chirp (140Hz -> 50Hz) has dropped below 74Hz into subKickSig,
  // whereas Floor Toms (78..120Hz), Mid Toms (122..168Hz), and High Toms (170..265Hz) ring above 78Hz!
  const wStart = Math.min(totalLen - 1, sampleIdx + Math.round(sampleRate * 0.022));
  const wEnd = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.086));
  const wLen = wEnd - wStart;
  if (wLen < Math.round(sampleRate * 0.022)) {
    return fallback;
  }

  // Also measure crackRms across [+6ms .. +58ms] so Snare wire rattle is captured in full
  const cStart = Math.min(totalLen - 1, sampleIdx + Math.round(sampleRate * 0.006));
  const cEnd = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.058));
  let sqCrack = 0;
  for (let k = cStart; k < cEnd; k++) {
    const cv = crackSig[k];
    sqCrack += cv * cv;
  }
  const crackRms = Math.sqrt(sqCrack / Math.max(1, cEnd - cStart));

  let sqTom = 0;
  let sqSub = 0;
  const zcTom: number[] = [];
  const zcBody: number[] = [];
  for (let k = wStart; k < wEnd; k++) {
    const tv = tomSig[k];
    const sv = subKickSig[k];
    const bv = pitchSig[k];
    sqTom += tv * tv;
    sqSub += sv * sv;
    if (k > wStart && tomSig[k - 1] <= 0 && tv > 0) {
      zcTom.push(k);
    }
    if (k > wStart && pitchSig[k - 1] <= 0 && bv > 0) {
      zcBody.push(k);
    }
  }
  const tomRms = Math.sqrt(sqTom / wLen);
  const subRms = Math.sqrt(sqSub / wLen);
  if (zcTom.length < 3 || tomRms < 1e-4) {
    return { ...fallback, tomRms, subRms, crackRms };
  }

  // Check unbiased full low-body (32..340 Hz) zero-crossing median frequency in [+22ms .. +86ms]:
  // On a Kick Drum, the full waveform zero-crossings in [+22ms..+86ms] are at 42..67 Hz!
  if (zcBody.length >= 2) {
    const bodyPeriods: number[] = [];
    for (let z = 1; z < zcBody.length; z++) {
      const p = zcBody[z] - zcBody[z - 1];
      const f = sampleRate / Math.max(1, p);
      if (f >= 36 && f <= 300) {
        bodyPeriods.push(p);
      }
    }
    if (bodyPeriods.length >= 2) {
      bodyPeriods.sort((a, b) => a - b);
      const bodyMedLag = bodyPeriods[Math.floor(bodyPeriods.length / 2)];
      const bodyFreqHz = sampleRate / Math.max(1, bodyMedLag);
      // If the unfiltered low-body fundamental in the tail is in the Sub-Kick zone (< 68 Hz), it is a Kick, NOT a Tom!
      if (bodyFreqHz < 68) {
        return { ...fallback, freqHz: bodyFreqHz, tomRms, subRms, crackRms };
      }
    }
  }

  // Measure pre-onset [-46ms .. -16ms] vs early body [+6ms .. +46ms] vs late decay [+70ms .. +138ms]
  // Using -46ms..-16ms ensures that even if sampleIdx is aligned to the transient peak (+10ms after onset),
  // the pre-window remains strictly before the drum hit attack!
  const preS = Math.max(0, sampleIdx - Math.round(sampleRate * 0.046));
  const preE = Math.max(preS, sampleIdx - Math.round(sampleRate * 0.016));
  let preTomRms = 0;
  if (preE > preS + 16) {
    let sqPre = 0;
    for (let k = preS; k < preE; k++) sqPre += tomSig[k] * tomSig[k];
    preTomRms = Math.sqrt(sqPre / (preE - preS));
  }

  const earlyS = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.008));
  const earlyE = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.046));
  let earlyTomRms = tomRms;
  if (earlyE > earlyS + 16) {
    let sqE = 0;
    for (let k = earlyS; k < earlyE; k++) sqE += tomSig[k] * tomSig[k];
    earlyTomRms = Math.sqrt(sqE / (earlyE - earlyS));
  }

  const lateWin = Math.max(16, Math.round(sampleRate * 0.016));
  const lateHop = Math.max(8, Math.round(sampleRate * 0.008));
  const lateRegionS = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.070));
  const lateRegionE = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.138));
  let minLateTomRms = earlyTomRms * 0.5;
  if (lateRegionE >= lateRegionS + lateWin) {
    minLateTomRms = Infinity;
    for (let s = lateRegionS; s + lateWin <= lateRegionE; s += lateHop) {
      let sqL = 0;
      for (let k = s; k < s + lateWin; k++) sqL += tomSig[k] * tomSig[k];
      const r = Math.sqrt(sqL / lateWin);
      if (r < minLateTomRms) minLateTomRms = r;
    }
  }
  const decayRatio = earlyTomRms / Math.max(1e-5, minLateTomRms);
  const attackStepRatio = earlyTomRms / Math.max(1e-5, preTomRms);

  const periods: number[] = [];
  for (let z = 1; z < zcTom.length; z++) {
    const p = zcTom[z] - zcTom[z - 1];
    const f = sampleRate / Math.max(1, p);
    if (f >= 68 && f <= 285) {
      periods.push(p);
    }
  }
  if (periods.length < 2) {
    return { ...fallback, tomRms, subRms, crackRms, decayRatio };
  }
  periods.sort((a, b) => a - b);
  const medLag = Math.round(periods[Math.floor(periods.length / 2)]);
  const minLag = Math.max(8, Math.floor(sampleRate / 285));
  const maxLag = Math.min(wLen - 8, Math.ceil(sampleRate / 68));

  // Search ±5 samples around zero-crossing median lag for peak autocorrelation clarity (handles dual-head overtones)
  let bestLag = Math.max(minLag, Math.min(maxLag, medLag));
  let bestClarity = -1;
  for (let lag = Math.max(minLag, medLag - 5); lag <= Math.min(maxLag, medLag + 5); lag++) {
    let acNum = 0;
    let acDenA = 0;
    let acDenB = 0;
    for (let k = wStart; k < wEnd - lag; k++) {
      const a = tomSig[k];
      const b = tomSig[k + lag];
      acNum += a * b;
      acDenA += a * a;
      acDenB += b * b;
    }
    const c = acNum / Math.max(1e-9, Math.sqrt(acDenA * acDenB));
    if (c > bestClarity) {
      bestClarity = c;
      bestLag = lag;
    }
  }
  const freqHz = sampleRate / Math.max(1, bestLag);
  const clarity = Math.max(0, bestClarity);

  let midiNote = 47;
  let subRoleLabel = 'Mid Tom (47)';
  let articulation: DrumArticulation = 'mid-tom';
  let pitchOffsetSemis = 0;
  if (freqHz >= 168) {
    midiNote = 50;
    subRoleLabel = 'High Tom (50)';
    articulation = 'high-tom';
    pitchOffsetSemis = 3;
  } else if (freqHz >= 122) {
    midiNote = 47;
    subRoleLabel = 'Mid Tom (47)';
    articulation = 'mid-tom';
    pitchOffsetSemis = 0;
  } else {
    midiNote = 43;
    subRoleLabel = 'Floor Tom (43)';
    articulation = 'floor-tom';
    pitchOffsetSemis = -3;
  }

  const minDecayRatio = isFullMix ? 1.52 : 1.15;
  const minCrackRatio = isFullMix ? 2.25 : 1.65;
  const isPitchedTom =
    freqHz >= 69 &&
    freqHz <= 275 &&
    clarity >= (isFullMix ? 0.58 : 0.48) &&
    attackStepRatio >= (isFullMix ? 1.52 : 1.25) &&
    decayRatio >= minDecayRatio &&
    tomRms > subRms * 1.16 &&
    tomRms > crackRms * minCrackRatio;

  return {
    isPitchedTom,
    freqHz,
    clarity,
    tomRms,
    subRms,
    crackRms,
    decayRatio,
    midiNote,
    subRoleLabel,
    articulation,
    pitchOffsetSemis,
  };
}

function computePercentileFloat(arr: Float32Array, pct: number): number {
  const vals: number[] = [];
  const step = Math.max(1, Math.floor(arr.length / 4096));
  for (let i = 0; i < arr.length; i += step) {
    if (arr[i] > 1e-6) vals.push(arr[i]);
  }
  if (vals.length === 0) return 1e-4;
  vals.sort((a, b) => a - b);
  return Math.max(1e-5, vals[Math.min(vals.length - 1, Math.floor(vals.length * pct))]);
}

/**
 * Evaluates Kick Drum beater pitch-chirp & sub-impulse signature at sampleIdx:
 * A real Kick Drum has a rapid downward pitch sweep in the first 18ms (beater impact ~105-190Hz)
 * settling into a 40-72Hz sub fundamental during +20..+75ms, unlike a steady-pitch Bass guitar note.
 */
function evaluateKickChirpSignature(
  sampleIdx: number,
  sampleRate: number,
  lowBodySig: Float32Array,
  subKickSig: Float32Array
): { isKickChirp: boolean; earlyFreqHz: number; lateFreqHz: number; subCrest: number } {
  const totalLen = lowBodySig.length;
  const eStart = Math.max(0, sampleIdx);
  const eEnd = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.020));
  const lStart = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.020));
  const lEnd = Math.min(totalLen, sampleIdx + Math.round(sampleRate * 0.078));

  if (lEnd - lStart < Math.round(sampleRate * 0.025)) {
    return { isKickChirp: false, earlyFreqHz: 60, lateFreqHz: 60, subCrest: 1 };
  }

  let earlyZc = 0;
  for (let i = eStart + 1; i < eEnd; i++) {
    if ((lowBodySig[i - 1] <= 0 && lowBodySig[i] > 0) || (lowBodySig[i - 1] >= 0 && lowBodySig[i] < 0)) {
      earlyZc++;
    }
  }
  const earlyDur = Math.max(0.005, (eEnd - eStart) / sampleRate);
  const earlyFreqHz = (earlyZc * 0.5) / earlyDur;

  const latePeriods: number[] = [];
  let prevCross = -1;
  let subPeak = 0;
  let subSq = 0;
  for (let i = lStart + 1; i < lEnd; i++) {
    const sv = Math.abs(subKickSig[i]);
    if (sv > subPeak) subPeak = sv;
    subSq += sv * sv;
    if (lowBodySig[i - 1] <= 0 && lowBodySig[i] > 0) {
      if (prevCross >= 0) {
        const p = i - prevCross;
        const f = sampleRate / Math.max(1, p);
        if (f >= 34 && f <= 160) latePeriods.push(p);
      }
      prevCross = i;
    }
  }
  const subRms = Math.sqrt(subSq / Math.max(1, lEnd - lStart));
  const subCrest = subPeak / Math.max(1e-5, subRms);
  let lateFreqHz = 58;
  if (latePeriods.length > 0) {
    latePeriods.sort((a, b) => a - b);
    lateFreqHz = sampleRate / Math.max(1, latePeriods[Math.floor(latePeriods.length / 2)]);
  }

  const isKickChirp =
    lateFreqHz <= 74 &&
    (earlyFreqHz >= lateFreqHz * 1.15 || subCrest >= 1.62);

  return { isKickChirp, earlyFreqHz, lateFreqHz, subCrest };
}

/**
 * Analyzes an ENTIRE Drum stem (clean or dirty AI-separated stem) OR Full Song Mix without slice limits,
 * isolating Kick / Snare / Hi-Hat / Crash / Tom percussive transients via 6-Band Butterworth decomposition
 * + Optional Master-Guided Hybrid Fusion (rescuing smeared/dropped Kick, Snare, Hi-Hat & Crash hits from the Master)
 * + Pre/Post Delta-Spectrum subtraction (canceling sustained bass/guitars/vocals/bleed)
 * + Continuous HF Tail Wash profiling (separating Crash/Ride cymbals from Closed/Open Hi-Hats and Snares).
 */
export function analyzeDrumStemFull(
  mono: Float32Array,
  sampleRate: number,
  options: {
    sensitivity?: number;
    minIntervalMs?: number;
    bpmHint?: number;
    lockedBpm?: number;
    musicalKey?: string;
    camelotKey?: string;
    detectedChords?: DetectedChordSegment[];
    beatOffsetSec?: number;
    beatTimes?: number[];
    downbeats?: number[];
    quantizeMode?: StemQuantizeMode;
    masterMono?: Float32Array;
    detectionSourceMode?: DetectionSourceMode;
    masterReferenceName?: string;
    isMasterInput?: boolean;
  } = {}
): FullStemAnalysisResult {
  const sensitivity = Math.max(0.1, Math.min(1.0, options.sensitivity ?? 0.62));
  const minIntervalMs = options.minIntervalMs ?? 60;
  const durationSec = mono.length / sampleRate;
  const sourceMode: DetectionSourceMode = options.detectionSourceMode ?? 'auto-hybrid';
  const hasMasterRef = Boolean(
    options.masterMono &&
      options.masterMono.length > 256 &&
      sourceMode !== 'stem-only'
  );

  // Build effective analysis waveform:
  // - 'master-only': analyze the Master directly (rescuing severely damaged stems 100% from Master)
  // - 'auto-hybrid': transient-enhanced fusion of Stem + Master (keeps Stem isolation while restoring Master transient snap, Snare wire crack, Hi-Hat ticks & Crash wash)
  // - 'stem-only': analyze the target stem buffer alone
  let workMono = mono;
  let stemConfirmMono: Float32Array | null = null;
  let detectionSourceUsed: FullStemAnalysisResult['detectionSourceUsed'] = 'stem-only';

  if (hasMasterRef && options.masterMono) {
    const mMono = options.masterMono;
    const len = mono.length;
    if (sourceMode === 'master-only') {
      if (mMono.length === len) {
        workMono = mMono;
      } else {
        workMono = new Float32Array(len);
        workMono.set(mMono.subarray(0, Math.min(len, mMono.length)));
      }
      stemConfirmMono = mono;
      detectionSourceUsed = 'master-only';
    } else {
      // 'auto-hybrid': normalize RMS levels and fuse Stem (62% body weight) + Master (38% intact transient/HF definition)
      // while keeping stemConfirmMono to verify drum presence and reject pure vocal consonants from the Master
      let sumStem = 0;
      let sumMaster = 0;
      const cmpLen = Math.min(len, mMono.length);
      const step = Math.max(1, Math.floor(cmpLen / 16384));
      for (let i = 0; i < cmpLen; i += step) {
        sumStem += mono[i] * mono[i];
        sumMaster += mMono[i] * mMono[i];
      }
      const rmsStem = Math.sqrt(sumStem / Math.max(1, Math.floor(cmpLen / step)));
      const rmsMaster = Math.sqrt(sumMaster / Math.max(1, Math.floor(cmpLen / step)));
      const masterScale = rmsMaster > 1e-5 && rmsStem > 1e-5 ? Math.min(2.2, Math.max(0.35, rmsStem / rmsMaster)) : 1.0;

      workMono = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const mv = i < mMono.length ? mMono[i] * masterScale : 0;
        workMono[i] = mono[i] * 0.62 + mv * 0.38;
      }
      stemConfirmMono = mono;
      detectionSourceUsed = 'master-guided-hybrid';
    }
  }

  const isFullMix = Boolean(
    options.isMasterInput ||
      detectionSourceUsed === 'master-only' ||
      (!stemConfirmMono &&
        ((options.detectedChords && options.detectedChords.length > 0) ||
          (options.musicalKey && !/^percusi/i.test(options.musicalKey))))
  );

  // 1. 6-Band Butterworth isolation for accurate drum peak timing & transient separation (resistant to dirty stem bleed)
  const subKickSig = applyBiquadBandPassOrLp(workMono, sampleRate, 28, 76, 1);
  const kickSig = applyBiquadBandPassOrLp(workMono, sampleRate, 32, 132, 1);
  const lowBodySig = applyBiquadBandPassOrLp(workMono, sampleRate, 32, 340, 1);
  const tomSig = applyBiquadBandPassOrLp(workMono, sampleRate, 80, 340, 1);
  const shellSig = applyBiquadBandPassOrLp(workMono, sampleRate, 155, 360, 1);
  const crackSig = applyBiquadBandPassOrLp(workMono, sampleRate, 1850, 6500, 1);
  const cymbalSig = applyBiquadBandPassOrLp(workMono, sampleRate, 2800, 12200, 1);
  const hatSig = applyBiquadBandPassOrLp(workMono, sampleRate, 6000, null, 1);

  // Optional Stem confirmation envelope (when using Master-Guided Hybrid or Master-Only with a target Drum Stem loaded)
  const envHz = 500;
  const envHop = Math.max(1, Math.round(sampleRate / envHz));
  const numEnv = Math.max(1, Math.floor(workMono.length / envHop));
  let envStemConfirm: Float32Array | null = null;
  let refStemConfirm = 1e-4;
  if (stemConfirmMono && stemConfirmMono.length > 256) {
    envStemConfirm = new Float32Array(numEnv);
    for (let f = 0; f < numEnv; f++) {
      const st = f * envHop;
      const en = Math.min(stemConfirmMono.length, st + envHop * 4);
      let sq = 0;
      for (let i = st; i < en; i++) {
        sq += stemConfirmMono[i] * stemConfirmMono[i];
      }
      envStemConfirm[f] = Math.sqrt(sq / Math.max(1, en - st));
    }
    refStemConfirm = computePercentileFloat(envStemConfirm, 0.90);
  }

  // 500Hz (2ms) band RMS envelopes smoothed with cycle-spanning windows (eliminates 50Hz bass zero-crossing ripple!)
  const psK = new Float64Array(numEnv + 1);
  const psT = new Float64Array(numEnv + 1);
  const psS = new Float64Array(numEnv + 1);
  const psC = new Float64Array(numEnv + 1);
  const psY = new Float64Array(numEnv + 1);
  const psH = new Float64Array(numEnv + 1);

  for (let f = 0; f < numEnv; f++) {
    const st = f * envHop;
    const en = Math.min(workMono.length, st + envHop);
    const inv = 1 / Math.max(1, en - st);
    let sqK = 0, sqT = 0, sqS = 0, sqC = 0, sqY = 0, sqH = 0;
    for (let i = st; i < en; i++) {
      const k = kickSig[i];
      const tm = tomSig[i];
      const s = shellSig[i];
      const c = crackSig[i];
      const y = cymbalSig[i];
      const h = hatSig[i];
      sqK += k * k;
      sqT += tm * tm;
      sqS += s * s;
      sqC += c * c;
      sqY += y * y;
      sqH += h * h;
    }
    psK[f + 1] = psK[f] + sqK * inv;
    psT[f + 1] = psT[f] + sqT * inv;
    psS[f + 1] = psS[f] + sqS * inv;
    psC[f + 1] = psC[f] + sqC * inv;
    psY[f + 1] = psY[f] + sqY * inv;
    psH[f + 1] = psH[f] + sqH * inv;
  }

  const buildCausalRms = (ps: Float64Array, backFrames: number, fwdFrames: number): Float32Array => {
    const out = new Float32Array(numEnv);
    for (let f = 0; f < numEnv; f++) {
      const a = Math.max(0, f - backFrames);
      const b = Math.min(numEnv, f + fwdFrames + 1);
      out[f] = Math.sqrt(Math.max(0, (ps[b] - ps[a]) / Math.max(1, b - a)));
    }
    return out;
  };

  // Strict causal/short-forward RMS envelopes (zero early pre-smearing before transient attacks!)
  const envKick = buildCausalRms(psK, 8, 2);   // ~22ms span, max +4ms lookahead
  const envTom = buildCausalRms(psT, 6, 2);    // ~18ms span for Floor/Mid/High Toms (84..340Hz)
  const envShell = buildCausalRms(psS, 5, 1);  // ~14ms span, max +2ms lookahead
  const envCrack = buildCausalRms(psC, 2, 1);  // ~8ms span
  const envCymbal = buildCausalRms(psY, 3, 1); // ~10ms span for Crash/Ride wash
  const envHat = buildCausalRms(psH, 2, 1);

  const refKickEnv = computePercentileFloat(envKick, 0.92);
  const refTomEnv = computePercentileFloat(envTom, 0.92);
  const refShellEnv = computePercentileFloat(envShell, 0.92);
  const refCrackEnv = computePercentileFloat(envCrack, 0.92);
  const refCymbalEnv = computePercentileFloat(envCymbal, 0.92);
  const refHatEnv = computePercentileFloat(envHat, 0.92);

  // 2. Collect onset candidates from Spectral Flux + ALL causal drum band step impulses
  const res = detectOnsetsSpectralFlux(workMono, sampleRate, {
    sensitivity,
    minIntervalMs,
    snapToZeroCrossing: false,
  });

  const bandCandidates: number[] = [];
  if (
    envKick[0] > refKickEnv * 0.26 ||
    envTom[0] > refTomEnv * 0.26 ||
    envCrack[0] > refCrackEnv * 0.26 ||
    envHat[0] > refHatEnv * 0.26
  ) {
    bandCandidates.push(0);
  }
  const collectBandPeaks = (env: Float32Array, refLevel: number, minRatio: number, minGapSec: number) => {
    const stepEnv = new Float32Array(numEnv);
    for (let f = 10; f < numEnv - 4; f++) {
      let pre = Infinity;
      for (let p = f - 10; p <= f - 3; p++) if (env[p] < pre) pre = env[p];
      let post = 0;
      for (let q = f; q <= f + 3; q++) if (env[q] > post) post = env[q];
      stepEnv[f] = Math.max(0, post - pre * 1.22);
    }
    const thresh = refLevel * (0.28 - sensitivity * 0.12);
    const minGapFrames = Math.round(minGapSec * envHz);
    let lastF = -minGapFrames;
    for (let f = 10; f < numEnv - 4; f++) {
      if (
        stepEnv[f] >= thresh &&
        stepEnv[f] >= stepEnv[f - 1] &&
        stepEnv[f] > stepEnv[f + 1] &&
        f - lastF >= minGapFrames
      ) {
        let pre = Infinity;
        for (let p = f - 10; p <= f - 3; p++) if (env[p] < pre) pre = env[p];
        let post = 0;
        for (let q = f; q <= f + 3; q++) if (env[q] > post) post = env[q];
        if (post / Math.max(1e-5, pre) >= minRatio) {
          // Refine forward from [f - 2 .. f + 2] to exact 45% rising edge so we never jump early before the drum hit
          const targetMid = pre + (post - pre) * 0.45;
          let onsetF = f;
          for (let s = Math.max(0, f - 2); s <= Math.min(numEnv - 1, f + 2); s++) {
            if (env[s] >= targetMid) {
              onsetF = s;
              break;
            }
          }
          bandCandidates.push(Number((onsetF / envHz).toFixed(4)));
          lastF = f;
        }
      }
    }
  };

  collectBandPeaks(envKick, refKickEnv, 1.45, 0.10);
  collectBandPeaks(envCrack, refCrackEnv, 1.55, 0.10);
  collectBandPeaks(envHat, refHatEnv, isFullMix ? 1.62 : 1.44, 0.068);
  collectBandPeaks(envCymbal, refCymbalEnv, 1.58, 0.14);
  if (!isFullMix) {
    collectBandPeaks(envShell, refShellEnv, 1.52, 0.095);
    collectBandPeaks(envTom, refTomEnv, 1.44, 0.085);
  }

  // Cluster candidates within 26ms so separate beats/offbeat hits stay distinct while collapsing double-triggers
  const tagged: Array<{ t: number; isFlux: boolean }> = [
    ...res.onsetTimesSec.map((t) => ({ t, isFlux: true })),
    ...bandCandidates.map((t) => ({ t, isFlux: false })),
  ].sort((a, b) => a.t - b.t);
  const candidateTimes: number[] = [];
  for (let i = 0; i < tagged.length; i++) {
    const cur = tagged[i];
    const prev = candidateTimes[candidateTimes.length - 1];
    if (prev !== undefined && cur.t - prev < 0.026) {
      if (cur.isFlux && cur.t - prev <= 0.02) {
        candidateTimes[candidateTimes.length - 1] = cur.t;
      }
      continue;
    }
    candidateTimes.push(cur.t);
  }

  // Helper to measure pitched Tom resonance (76..270 Hz) vs Sub-Kick Core (28..76 Hz) vs Snare Wire (1850..6200 Hz)
  const measureTomResonance = (sampleIdx: number): TomResonanceEvaluation =>
    evaluateTomResonanceAtSample({
      sampleIdx,
      sampleRate,
      subKickSig,
      tomSig,
      crackSig,
      lowBodySig,
      isFullMix,
    });

  // 3. Pre/Post Delta-Spectrum FFT Classifier (cancels sustaining guitars/bass/vocals/bleed!)
  const fftSize = 1024;
  const half = fftSize / 2;
  const binHz = sampleRate / fftSize;
  const win = buildHannWindow(fftSize);
  const rePost = new Float32Array(fftSize);
  const imPost = new Float32Array(fftSize);
  const rePre = new Float32Array(fftSize);
  const imPre = new Float32Array(fftSize);
  const crackBinPows = new Float32Array(half);
  const tailScratch: number[] = [];

  const rawHits: Array<{
    timeSec: number;
    peakTimeSec: number;
    role: DrumPieceRole;
    peakAmp: number;
    percScore: number;
    midiNote?: number;
    subRoleLabel?: string;
    articulation?: DrumArticulation;
    pitchOffsetSemis?: number;
  }> = [];

  const preGapSamples = Math.round(sampleRate * 0.005);
  let lastCrashSec = -10;

  // Measure pre [-28ms..-6ms] vs post [0..+24ms] band step-ups (handling t=0 head onset where pre-region is empty!)
  const getStep = (arr: Float32Array, eIdx: number) => {
    const preS = Math.max(0, eIdx - 14);
    const preE = Math.max(preS + 1, eIdx - 2);
    let preMin = Infinity;
    if (eIdx < 6) {
      preMin = 0;
    } else {
      for (let k = preS; k < preE; k++) if (arr[k] < preMin) preMin = arr[k];
      if (!Number.isFinite(preMin)) preMin = 0;
    }
    const postE = Math.min(numEnv, eIdx + 12);
    let postMax = 0;
    for (let k = eIdx; k < postE; k++) if (arr[k] > postMax) postMax = arr[k];
    return {
      pre: preMin,
      post: postMax,
      step: Math.max(0, postMax - preMin * 1.15),
      ratio: postMax / Math.max(1e-5, preMin),
    };
  };

  for (let i = 0; i < candidateTimes.length; i++) {
    const timeSec = candidateTimes[i];
    const sampleIdx = Math.max(0, Math.round(timeSec * sampleRate));
    const envIdx = Math.min(numEnv - 1, Math.round(timeSec * envHz));

    const kSt = getStep(envKick, envIdx);
    const tSt = getStep(envTom, envIdx);
    const sSt = getStep(envShell, envIdx);
    const cSt = getStep(envCrack, envIdx);
    const ySt = getStep(envCymbal, envIdx);
    const hSt = getStep(envHat, envIdx);

    // Measure post-kick sustain tail (+66ms..+112ms) to distinguish fast-decaying Kicks from sustained Bass notes/Pads!
    let kTailAvg = kSt.post;
    const tailS = Math.min(numEnv, envIdx + 33);
    const tailE = Math.min(numEnv, envIdx + 56);
    if (tailE > tailS + 2) {
      let sum = 0;
      for (let k = tailS; k < tailE; k++) sum += envKick[k];
      kTailAvg = sum / (tailE - tailS);
    }
    const kTailDrop = kSt.post / Math.max(1e-5, kTailAvg);

    // Measure continuous Cymbal/Crash wash tail (+44ms..+180ms = envIdx+22..envIdx+90):
    // Fits inside a single 8th-note interval so the next 8th-note hi-hat doesn't pollute the tail window.
    // A true Crash cymbal sustains continuously across this window (high 25th-percentile hold floor),
    // whereas a closed Hi-Hat or Snare wire snap drops near zero within 60-90ms!
    let cymTailAvg = 0;
    let cymHold25 = 0;
    const cymS = Math.min(numEnv, envIdx + 22);
    const cymE = Math.min(numEnv, envIdx + 90);
    if (cymE > cymS + 6) {
      tailScratch.length = 0;
      let sum = 0;
      for (let k = cymS; k < cymE; k++) {
        const v = Math.max(envCymbal[k], envHat[k] * 0.85);
        sum += v;
        tailScratch.push(v);
      }
      cymTailAvg = sum / (cymE - cymS);
      tailScratch.sort((a, b) => a - b);
      cymHold25 = tailScratch[Math.floor(tailScratch.length * 0.25)] ?? 0;
    }
    const cymPeakRef = Math.max(1e-5, ySt.post, hSt.post * 0.9);
    const cymTailRatio = cymTailAvg / cymPeakRef;
    const cymHoldRatio = cymHold25 / cymPeakRef;

    // Post-onset FFT [sampleIdx - 16 .. +1008] vs strictly pre-onset FFT [sampleIdx - 1024 - 5ms .. sampleIdx - 5ms]
    const postStart = Math.max(0, Math.min(workMono.length - fftSize, sampleIdx - 16));
    rePost.fill(0); imPost.fill(0);
    for (let k = 0; k < fftSize && postStart + k < workMono.length; k++) {
      rePost[k] = workMono[postStart + k] * win[k];
    }
    fftInPlace(rePost, imPost);

    const hasPre = sampleIdx >= fftSize + preGapSamples;
    if (hasPre) {
      const preStart = sampleIdx - fftSize - preGapSamples;
      rePre.fill(0); imPre.fill(0);
      for (let k = 0; k < fftSize; k++) {
        rePre[k] = workMono[preStart + k] * win[k];
      }
      fftInPlace(rePre, imPre);
    }

    let dSubKick = 0;
    let dTomBody = 0;
    let dSnareMid = 0;
    let dCrack = 0;
    let dHat = 0;
    let crackBinsTotal = 0;

    for (let k = 1; k < half; k++) {
      const f = k * binHz;
      if (f < 28 || f > 17000) continue;
      const mPost = Math.hypot(rePost[k], imPost[k]);
      const mPre = hasPre ? Math.hypot(rePre[k], imPre[k]) : 0;
      const dMag = Math.max(0, mPost - 0.8 * mPre);
      const p = dMag * dMag;

      if (f <= 135) dSubKick += p;
      else if (f <= 340) dTomBody += p;
      else if (f <= 1800) dSnareMid += p;
      else if (f <= 6000) {
        dCrack += p;
        if (crackBinsTotal < crackBinPows.length) {
          crackBinPows[crackBinsTotal++] = p;
        }
      } else {
        dHat += p;
      }
    }

    const totalDelta = Math.max(1e-12, dSubKick + dTomBody + dSnareMid + dCrack + dHat);
    const rKick = dSubKick / totalDelta;
    const rTom = dTomBody / totalDelta;
    const rSnareMid = dSnareMid / totalDelta;
    const rCrack = dCrack / totalDelta;
    const rCrackHat = (dCrack + dHat) / totalDelta;
    const rHat = dHat / totalDelta;

    // Exact Wiener spectral flatness over all 1800..6000Hz bins (snare wires / cymbals ~ 0.12..0.75, harmonic guitars < 0.08)
    let crackFlatness = 0;
    if (crackBinsTotal > 4 && dCrack > 1e-10) {
      const meanP = dCrack / crackBinsTotal;
      const floorP = Math.max(1e-12, meanP * 1e-4);
      let logSum = 0;
      for (let b = 0; b < crackBinsTotal; b++) {
        logSum += Math.log(crackBinPows[b] + floorP);
      }
      crackFlatness = Math.exp(logSum / crackBinsTotal) / meanP;
    }

    const kickStrength = kSt.step / Math.max(1e-4, refKickEnv);
    const tomStrength = tSt.step / Math.max(1e-4, refTomEnv);
    const shellStrength = sSt.step / Math.max(1e-4, refShellEnv);
    const crackStrength = cSt.step / Math.max(1e-4, refCrackEnv);
    const cymbalStrength = ySt.step / Math.max(1e-4, refCymbalEnv);
    const hatStrength = hSt.step / Math.max(1e-4, refHatEnv);

    const hasSnareWireNoise =
      crackStrength >= 0.22 &&
      cSt.ratio >= 1.28 &&
      crackFlatness >= 0.082 &&
      (rCrack >= 0.10 || crackStrength > tomStrength * 0.52 || shellStrength >= 0.26);

    // Evaluate Kick pitch-chirp signature (150Hz beater -> 50Hz sub body) to distinguish Kicks from Bass notes
    const kickChirp =
      kickStrength >= 0.22 && kSt.ratio >= 1.32
        ? evaluateKickChirpSignature(sampleIdx, sampleRate, lowBodySig, subKickSig)
        : { isKickChirp: false, earlyFreqHz: 60, lateFreqHz: 60, subCrest: 1 };

    // When Master-Guided Hybrid is used, check if the target Drum Stem has any percussive confirmation
    // (or if the Master hit itself is an unmistakable high-crest drum transient that was dropped by AI stem splitting)
    const stemConfirmLevel = envStemConfirm
      ? envStemConfirm[Math.min(envStemConfirm.length - 1, envIdx)] / Math.max(1e-5, refStemConfirm)
      : 1.0;

    // Evaluate pitched Tom resonance (Floor Tom 76-121Hz, Mid Tom 122-167Hz, High Tom 168-270Hz)
    // Always evaluated regardless of isFullMix so Tom fills are never misclassified as Kick Drums!
    const rawTomInfo: TomResonanceEvaluation =
      (tomStrength >= 0.22 || shellStrength >= 0.22 || kickStrength >= 0.24) &&
      Math.max(tSt.ratio, sSt.ratio, kSt.ratio) >= 1.32
        ? measureTomResonance(sampleIdx)
        : {
            isPitchedTom: false,
            freqHz: 130,
            clarity: 0,
            tomRms: 0,
            subRms: 0,
            crackRms: 0,
            decayRatio: 1,
            midiNote: 47,
            subRoleLabel: 'Mid Tom (47)',
            articulation: 'mid-tom',
            pitchOffsetSemis: 0,
          };
    const tomInfo: TomResonanceEvaluation =
      hasSnareWireNoise && rawTomInfo.tomRms < rawTomInfo.crackRms * 4.5
        ? { ...rawTomInfo, isPitchedTom: false }
        : rawTomInfo;

    // Dirty stem & Full-mix gating: reject intro pads, solo bass plucks, vocal syllables, and non-percussive bleed!
    if (isFullMix) {
      const hasKickPulse =
        kickStrength >= 0.32 - sensitivity * 0.12 &&
        kSt.ratio >= 1.42 &&
        dSubKick > totalDelta * 0.07 &&
        (kickChirp.isKickChirp || kTailDrop >= 1.28 || sSt.ratio >= 1.45 || cSt.ratio >= 1.42);
      const hasSnarePulse =
        (crackStrength >= 0.26 - sensitivity * 0.10 &&
          cSt.ratio >= 1.35 &&
          crackFlatness >= 0.088 &&
          (shellStrength >= 0.20 || (dSnareMid + dTomBody > dHat * 0.62 && rKick < 0.28))) ||
        // Rescue hollow/muffled snares when confirmed by drum stem energy
        (stemConfirmLevel >= 0.22 &&
          shellStrength >= 0.28 &&
          sSt.ratio >= 1.45 &&
          crackStrength >= 0.16 &&
          !tomInfo.isPitchedTom);
      const hasHatOrCrashPulse =
        (hatStrength >= 0.28 - sensitivity * 0.11 && hSt.ratio >= 1.40 && (rHat >= 0.16 || stemConfirmLevel >= 0.18)) ||
        (cymbalStrength >= 0.36 - sensitivity * 0.12 && ySt.ratio >= 1.48 && rCrackHat >= 0.25 && crackFlatness >= 0.095 && cymHoldRatio >= 0.21);
      const hasTomPulse =
        (tomInfo.isPitchedTom && Math.max(tSt.ratio, sSt.ratio, kSt.ratio) >= 1.38) ||
        (shellStrength >= 0.36 && sSt.ratio >= 1.65 && rTom >= 0.34 && crackFlatness < 0.095);
      if (!hasKickPulse && !hasSnarePulse && !hasHatOrCrashPulse && !hasTomPulse) {
        continue;
      }
    } else {
      // Dirty isolated drum stem / Hybrid Master+Stem bleed filter:
      const maxBandRatio = Math.max(kSt.ratio, tSt.ratio, sSt.ratio, cSt.ratio, ySt.ratio, hSt.ratio);
      const maxBandStrength = Math.max(kickStrength, tomStrength, shellStrength, crackStrength, cymbalStrength, hatStrength);
      if (maxBandRatio < 1.22 || maxBandStrength < 0.15 - sensitivity * 0.08) {
        continue;
      }
      // In Hybrid mode, if the target drum stem is completely silent (< 6% of reference) AND the Master hit lacks high percussive step ratio, reject vocal consonant bleed
      if (
        detectionSourceUsed === 'master-guided-hybrid' &&
        stemConfirmLevel < 0.06 &&
        maxBandRatio < 1.65 &&
        !kickChirp.isKickChirp
      ) {
        continue;
      }
      // Reject sustained bass guitar bleed (high low-end with flat tail and zero beater/shell attack)
      if (!tomInfo.isPitchedTom && !kickChirp.isKickChirp && rKick > 0.65 && kTailDrop < 1.12 && kSt.ratio < 1.55 && cSt.ratio < 1.3 && hSt.ratio < 1.3) {
        continue;
      }
    }

    // Detect Crash Cymbal signature:
    // Strong 2.8..12kHz metallic transient + continuous long sustain wash across +44..+180ms (cymHoldRatio >= 0.19 & cymTailRatio >= 0.26)
    const isCrashCandidate =
      timeSec - lastCrashSec >= 0.32 &&
      Math.max(cymbalStrength, hatStrength) >= 0.30 - sensitivity * 0.10 &&
      Math.max(ySt.ratio, hSt.ratio) >= 1.38 &&
      cymHoldRatio >= 0.19 &&
      cymTailRatio >= 0.26 &&
      ySt.post >= refCymbalEnv * 0.25 &&
      cymTailAvg >= refCymbalEnv * 0.11 &&
      (!isFullMix || crackFlatness >= 0.075);

    let role: DrumPieceRole = 'snare';
    const strongKickRise =
      kickStrength >= 0.29 &&
      kSt.ratio >= 1.40 &&
      dSubKick > totalDelta * 0.07 &&
      !tomInfo.isPitchedTom &&
      (kickChirp.isKickChirp || !isFullMix || kTailDrop >= 1.26 || cSt.ratio >= 1.40);
    // Rescue muffled snares from AI stem separation (where vocal carving weakened >2kHz wire crack but left 160-350Hz shell + broadband burst)
    const hollowStemSnare =
      !tomInfo.isPitchedTom &&
      shellStrength >= 0.26 &&
      sSt.ratio >= 1.40 &&
      (crackStrength >= 0.15 || cSt.ratio >= 1.20) &&
      (crackFlatness >= 0.068 || rSnareMid + rCrack >= 0.22) &&
      sSt.post > kSt.post * 0.72;
    const strongSnareCrack =
      (crackStrength >= 0.23 &&
        cSt.ratio >= 1.30 &&
        crackFlatness >= 0.082 &&
        !tomInfo.isPitchedTom &&
        (shellStrength >= 0.17 || dSnareMid + dTomBody > dHat * 0.62 || rCrack >= 0.18)) ||
      hollowStemSnare;

    // Standalone Crash vs Snare distinction:
    // A standalone Crash lacks a dominant decaying 180-320Hz snare shell thump OR its HF cymbal wash outlasts snare wire decay
    const isStandaloneCrash =
      isCrashCandidate &&
      !strongKickRise &&
      (rCrackHat >= 0.46 || (cymHoldRatio >= 0.32 && shellStrength < cymbalStrength * 0.85));

    if (strongKickRise && (dSubKick >= dCrack * 0.28 || rKick >= 0.24 || !strongSnareCrack)) {
      role = 'kick';
    } else if (isStandaloneCrash) {
      role = 'crash';
    } else if (tomInfo.isPitchedTom && !isCrashCandidate) {
      role = 'tom';
    } else if (strongSnareCrack || (!isFullMix && rCrack >= 0.13 && rSnareMid + rCrack > rKick && shellStrength >= 0.15 && !tomInfo.isPitchedTom)) {
      role = 'snare';
    } else if (rTom > 0.35 && rKick < 0.24 && rCrackHat < 0.24 && shellStrength >= 0.34) {
      role = 'tom';
    } else if (isCrashCandidate) {
      role = 'crash';
    } else if (hatStrength >= 0.20 && (rHat >= 0.14 || hSt.ratio >= 1.34)) {
      role = 'hat';
    } else {
      role = kickStrength > Math.max(crackStrength, hatStrength) * 1.15 ? 'kick' : 'hat';
    }

    // Measure exact band-filtered transient peak inside [sampleIdx - 2ms .. sampleIdx + 22ms]
    const bandSig =
      role === 'kick'
        ? kickSig
        : role === 'hat'
        ? hatSig
        : role === 'crash'
        ? cymbalSig
        : role === 'tom'
        ? tomSig
        : crackSig;
    const pSearchStart = Math.max(0, sampleIdx - Math.round(sampleRate * 0.002));
    const pSearchEnd = Math.min(workMono.length, sampleIdx + Math.round(sampleRate * 0.022));
    let peakIdx = sampleIdx;
    let bandPeakAmp = 0;
    let monoPeakAmp = 0;
    for (let k = pSearchStart; k < pSearchEnd; k++) {
      const ba = Math.abs(bandSig[k]);
      if (ba > bandPeakAmp) {
        bandPeakAmp = ba;
        peakIdx = k;
      }
      const ma = Math.abs(workMono[k]);
      if (ma > monoPeakAmp) monoPeakAmp = ma;
    }

    const roleAmp =
      role === 'kick'
        ? Math.max(kSt.post, bandPeakAmp)
        : role === 'snare'
        ? Math.max(cSt.post + sSt.post * 0.5, bandPeakAmp)
        : role === 'crash'
        ? Math.max(ySt.post, bandPeakAmp)
        : role === 'hat'
        ? Math.max(hSt.post, bandPeakAmp)
        : Math.max(tSt.post, sSt.post, bandPeakAmp);

    // Tail ripple / bass-rebound guard against decaying resonance inside 145ms of same non-hat hit
    const prevSame = [...rawHits].reverse().find((h) => h.role === role);
    const sameRoleThresh = role === 'kick' ? 0.72 : role === 'crash' ? 0.78 : role === 'tom' ? 0.44 : 0.48;
    const minSameRoleGap = role === 'crash' ? 0.32 : role === 'tom' ? 0.088 : 0.145;
    if (prevSame && timeSec - prevSame.timeSec < minSameRoleGap && role !== 'hat') {
      if (roleAmp < prevSame.peakAmp * sameRoleThresh) {
        continue;
      }
    }

    // Assign General MIDI attributes (Kick 36, Snare 38, Closed/Open Hat 42/46, High/Mid/Floor Tom 50/47/43, Crash 49)
    let midiNote = 38;
    let subRoleLabel = 'Acoustic Snare (38)';
    let articulation: DrumArticulation = 'closed';
    let pitchOffsetSemis = 0;

    if (role === 'kick') {
      midiNote = 36;
      subRoleLabel = 'Kick Drum 1 (36)';
      articulation = 'closed';
    } else if (role === 'snare') {
      midiNote = 38;
      subRoleLabel = 'Acoustic Snare (38)';
      articulation = 'closed';
    } else if (role === 'crash') {
      midiNote = 49;
      subRoleLabel = 'Crash Cymbal 1 (49)';
      articulation = 'crash';
    } else if (role === 'hat') {
      const isOpenHat = cymTailRatio >= 0.21 && hSt.post >= refHatEnv * 0.26;
      midiNote = isOpenHat ? 46 : 42;
      subRoleLabel = isOpenHat ? 'Open Hi-Hat (46)' : 'Closed Hi-Hat (42)';
      articulation = isOpenHat ? 'open' : 'closed';
    } else if (role === 'tom') {
      midiNote = tomInfo.midiNote;
      subRoleLabel = tomInfo.subRoleLabel;
      articulation = tomInfo.articulation;
      pitchOffsetSemis = tomInfo.pitchOffsetSemis;
    }

    // Prevent spurious overlapping duplicate detections inside 55ms (preserving distinct co-occurring drum pieces)
    const prevAny = rawHits[rawHits.length - 1];
    if (
      prevAny &&
      timeSec > prevAny.timeSec &&
      timeSec - prevAny.timeSec < 0.055 &&
      prevAny.role !== 'crash' &&
      !(role === 'tom' && prevAny.role === 'tom')
    ) {
      const curPercScore = Math.max(kickStrength, tomStrength, crackStrength, cymbalStrength, hatStrength);
      if (prevAny.role === role || curPercScore > prevAny.percScore * 1.15) {
        if (roleAmp > prevAny.peakAmp) {
          rawHits[rawHits.length - 1] = {
            timeSec,
            peakTimeSec: Number((peakIdx / sampleRate).toFixed(5)),
            role,
            peakAmp: roleAmp,
            percScore: curPercScore,
            midiNote,
            subRoleLabel,
            articulation,
            pitchOffsetSemis,
          };
        }
      }
      continue;
    }

    if (role === 'crash') {
      lastCrashSec = timeSec;
    }

    rawHits.push({
      timeSec,
      peakTimeSec: Number((peakIdx / sampleRate).toFixed(5)),
      role,
      peakAmp: Math.max(roleAmp, monoPeakAmp * 0.25),
      percScore: Math.max(kickStrength, tomStrength, crackStrength, cymbalStrength, hatStrength),
      midiNote,
      subRoleLabel,
      articulation,
      pitchOffsetSemis,
    });

    // Co-occurring Downbeat Crash detection:
    // In real drum stems, Crash cymbals are most often struck SIMULTANEOUSLY with a Kick (or Snare) on beat 1!
    let emittedCoCrash = false;
    if (
      (role === 'kick' || role === 'snare') &&
      isCrashCandidate &&
      Math.max(cymbalStrength, hatStrength) >= 0.38 &&
      Math.max(ySt.ratio, hSt.ratio) >= 1.48 &&
      cymHoldRatio >= 0.22 &&
      cymTailRatio >= 0.30
    ) {
      let cymPeakIdx = sampleIdx;
      let cymPeakAmp = 0;
      for (let k = pSearchStart; k < pSearchEnd; k++) {
        const ca = Math.abs(cymbalSig[k]);
        if (ca > cymPeakAmp) {
          cymPeakAmp = ca;
          cymPeakIdx = k;
        }
      }
      lastCrashSec = timeSec;
      emittedCoCrash = true;
      rawHits.push({
        timeSec,
        peakTimeSec: Number((cymPeakIdx / sampleRate).toFixed(5)),
        role: 'crash',
        peakAmp: Math.max(ySt.post, cymPeakAmp),
        percScore: cymbalStrength,
        midiNote: 49,
        subRoleLabel: 'Crash Cymbal 1 (49)',
        articulation: 'crash',
        pitchOffsetSemis: 0,
      });
    }

    // Co-occurring Simultaneous Hi-Hat detection on Kick / Snare beats (works on Drum stems, Hybrid Master+Stem, and Master mixes):
    if (
      !emittedCoCrash &&
      (role === 'kick' || role === 'snare') &&
      hatStrength >= (role === 'kick' ? (isFullMix ? 0.30 : 0.24) : (isFullMix ? 0.45 : 0.38)) &&
      hSt.ratio >= (role === 'kick' ? (isFullMix ? 1.46 : 1.36) : (isFullMix ? 1.60 : 1.50)) &&
      hSt.post >= refHatEnv * 0.22 &&
      (role === 'kick' || dHat > dCrack * 0.38)
    ) {
      let hatPeakIdx = sampleIdx;
      let hatPeakAmp = 0;
      for (let k = pSearchStart; k < pSearchEnd; k++) {
        const ha = Math.abs(hatSig[k]);
        if (ha > hatPeakAmp) {
          hatPeakAmp = ha;
          hatPeakIdx = k;
        }
      }
      const isOpen = cymTailRatio >= 0.21 && hSt.post >= refHatEnv * 0.28;
      rawHits.push({
        timeSec,
        peakTimeSec: Number((hatPeakIdx / sampleRate).toFixed(5)),
        role: 'hat',
        peakAmp: Math.max(hSt.post, hatPeakAmp),
        percScore: hatStrength,
        midiNote: isOpen ? 46 : 42,
        subRoleLabel: isOpen ? 'Open Hi-Hat (46)' : 'Closed Hi-Hat (42)',
        articulation: isOpen ? 'open' : 'closed',
        pitchOffsetSemis: 0,
      });
    }
  }

  // Normalize hit velocities per role / 92nd percentile so kicks, snares, hats, crashes & toms keep realistic musical dynamics
  const roleRefAmp: Record<DrumPieceRole, number> = {
    kick: 1e-4,
    snare: 1e-4,
    hat: 1e-4,
    crash: 1e-4,
    tom: 1e-4,
  };
  (['kick', 'snare', 'hat', 'crash', 'tom'] as DrumPieceRole[]).forEach((r) => {
    const amps = rawHits.filter((h) => h.role === r).map((h) => h.peakAmp).sort((a, b) => a - b);
    if (amps.length > 0) {
      roleRefAmp[r] = Math.max(1e-4, amps[Math.min(amps.length - 1, Math.floor(amps.length * 0.92))]);
    }
  });

  const drumHits: StemDrumHitEvent[] = rawHits.map((h, idx) => {
    const vel = Number(Math.max(0.2, Math.min(1.0, h.peakAmp / roleRefAmp[h.role])).toFixed(3));
    return {
      id: `dh-${idx}`,
      timeSec: h.timeSec,
      peakTimeSec: h.peakTimeSec,
      role: h.role,
      velocity: vel,
      midiNote: h.midiNote,
      subRoleLabel: h.subRoleLabel,
      articulation: h.articulation,
      pitchOffsetSemis: h.pitchOffsetSemis,
      sourceEngine: 'local-dsp',
    };
  });

  const bpm =
    options.lockedBpm && options.lockedBpm >= 45 && options.lockedBpm <= 220
      ? options.lockedBpm
      : estimateBpmFromOnsets(
          drumHits.filter((h) => h.role === 'kick' || h.role === 'snare').map((h) => h.timeSec),
          options.bpmHint ?? 120
        );

  const qMode: StemQuantizeMode =
    options.quantizeMode ?? (options.lockedBpm ? 'soft' : 'off');
  const finalDrumHits = quantizeDrumHitsToTempo(
    drumHits,
    bpm,
    options.beatOffsetSec ?? 0,
    durationSec,
    qMode,
    options.beatTimes
  );

  let kickCount = 0;
  let snareCount = 0;
  let hatCount = 0;
  let crashCount = 0;
  let tomCount = 0;
  for (const h of finalDrumHits) {
    if (h.role === 'kick') kickCount++;
    else if (h.role === 'snare') snareCount++;
    else if (h.role === 'hat') hatCount++;
    else if (h.role === 'crash') crashCount++;
    else tomCount++;
  }

  return {
    mode: 'drums',
    detectionSourceUsed,
    masterReferenceName: options.masterReferenceName,
    quantizeMode: qMode,
    bpm,
    musicalKey: options.musicalKey,
    camelotKey: options.camelotKey,
    detectedChords: options.detectedChords,
    beatOffsetSec: options.beatOffsetSec,
    beatTimes: options.beatTimes,
    downbeats: options.downbeats,
    durationSec,
    drumHits: finalDrumHits,
    noteEvents: [],
    counts: {
      total: finalDrumHits.length,
      kick: kickCount,
      snare: snareCount,
      hat: hatCount,
      crash: crashCount,
      tom: tomCount,
      notes: 0,
    },
  };
}

function getMedianNumber(vals: number[]): number {
  const c = [...vals].sort((a, b) => a - b);
  return c[Math.floor(c.length / 2)];
}

/**
 * Surgically attenuates short 0..30ms Kick Drum beater/sub transient spikes inside a Bass signal
 * while leaving sustained 70..600ms Bass notes untouched.
 * Prevents Kick drum bleed (in dirty AI-separated bass stems or Master tracks) from triggering false
 * low bass notes or pulling YIN / FFT pitch away from the true bass note on downbeats.
 */
function maskKickTransientsFromBassSignal(
  bassSig: Float32Array,
  sampleRate: number,
  kickRefMono: Float32Array
): Float32Array {
  const len = bassSig.length;
  if (len < 1024) return bassSig;
  const out = new Float32Array(len);
  out.set(bassSig);

  const subKick = applyBiquadBandPassOrLp(kickRefMono, sampleRate, 28, 76, 1);
  const lowBody = applyBiquadBandPassOrLp(kickRefMono, sampleRate, 32, 340, 1);
  const clickBand = applyBiquadBandPassOrLp(kickRefMono, sampleRate, 1850, 6200, 1);

  const hop = Math.max(1, Math.round(sampleRate * 0.004)); // 4ms frame
  const numF = Math.floor(Math.min(len, kickRefMono.length) / hop);
  if (numF < 16) return out;

  const subEnv = new Float32Array(numF);
  const clickEnv = new Float32Array(numF);
  for (let f = 0; f < numF; f++) {
    const st = f * hop;
    const en = Math.min(kickRefMono.length, st + hop);
    let sqS = 0;
    let sqC = 0;
    for (let i = st; i < en; i++) {
      sqS += subKick[i] * subKick[i];
      sqC += clickBand[i] * clickBand[i];
    }
    const inv = 1 / Math.max(1, en - st);
    subEnv[f] = Math.sqrt(sqS * inv);
    clickEnv[f] = Math.sqrt(sqC * inv);
  }

  const refSub = computePercentileFloat(subEnv, 0.92);
  const refClick = computePercentileFloat(clickEnv, 0.92);
  const minGapF = Math.max(1, Math.round(0.11 / 0.004));
  let lastKickF = -minGapF;

  for (let f = 4; f < numF - 18; f++) {
    if (f - lastKickF < minGapF) continue;
    const preSub = Math.min(subEnv[f - 4], subEnv[f - 3], subEnv[f - 2]);
    const postSub = Math.max(subEnv[f], subEnv[f + 1], subEnv[f + 2]);
    if (postSub < refSub * 0.30 || postSub / Math.max(1e-5, preSub) < 1.55) continue;

    // Compare immediate Kick spike [0..+24ms] vs post-kick bass sustain [+44ms..+72ms]
    let sustainSum = 0;
    for (let k = f + 11; k <= f + 18; k++) sustainSum += subEnv[k];
    const sustainSub = sustainSum / 8;

    const sampleIdx = f * hop;
    const chirp = evaluateKickChirpSignature(sampleIdx, sampleRate, lowBody, subKick);
    const hasBeaterClick =
      Math.max(clickEnv[f], clickEnv[f + 1]) >= refClick * 0.22 &&
      Math.max(clickEnv[f], clickEnv[f + 1]) > Math.min(clickEnv[f - 3], clickEnv[f - 2]) * 1.45;

    if ((chirp.isKickChirp || hasBeaterClick) && postSub > sustainSub * 1.25) {
      // Duck the 30ms Kick transient spike down toward the sustained bass level
      const maskStart = Math.max(0, sampleIdx - Math.round(sampleRate * 0.003));
      const maskLen = Math.round(sampleRate * 0.032);
      const targetGain = Math.max(0.12, Math.min(0.65, sustainSub / Math.max(1e-5, postSub)));
      for (let k = 0; k < maskLen && maskStart + k < len; k++) {
        const w = Math.sin((k / maskLen) * Math.PI);
        const g = 1 - (1 - targetGain) * w;
        out[maskStart + k] *= g;
      }
      lastKickF = f;
    }
  }

  return out;
}

/**
 * Checks whether a detected bass pitch in MIDI 40..55 (E2..G3) is actually the 2nd harmonic
 * of a sub-octave fundamental MIDI - 12 (28..43, E1..G2) by measuring normalized autocorrelation
 * at the double period tauSub = sr / (f0 / 2).
 */
function checkBassSubOctaveFundamental(
  slice: Float32Array,
  sampleRate: number,
  detectedMidi: number
): number {
  if (detectedMidi < 40 || detectedMidi > 55) return detectedMidi;
  const subMidi = detectedMidi - 12;
  const subHz = 440 * Math.pow(2, (subMidi - 69) / 12);
  const tauSub = Math.round(sampleRate / subHz);
  if (tauSub <= 8 || tauSub * 2 >= slice.length) return detectedMidi;

  let numSub = 0;
  let denA = 0;
  let denB = 0;
  const lim = slice.length - tauSub;
  for (let i = 0; i < lim; i += 2) {
    const a = slice[i];
    const b = slice[i + tauSub];
    numSub += a * b;
    denA += a * a;
    denB += b * b;
  }
  const corrSub = numSub / Math.max(1e-9, Math.sqrt(denA * denB));
  // If the full sub-period waveform repeats with high positive correlation (>= 0.68), the true fundamental is the sub-octave!
  if (corrSub >= 0.68) {
    return subMidi;
  }
  return detectedMidi;
}

/**
 * Analyzes an entire monophonic melodic/bass stem (Bass, Solo Synth, Lead, Vocal)
 * using onset segmentation + sliding YIN fundamental tracking with median glitch rejection,
 * Kick-bleed transient masking, Sub-Harmonic octave stabilization, and optional Master-Guided gap rescue.
 */
export function analyzeMonophonicStemNotesFull(
  mono: Float32Array,
  sampleRate: number,
  options: {
    sensitivity?: number;
    minNoteMs?: number;
    bpmHint?: number;
    bassOnly?: boolean;
    lockedBpm?: number;
    musicalKey?: string;
    camelotKey?: string;
    detectedChords?: DetectedChordSegment[];
    beatOffsetSec?: number;
    beatTimes?: number[];
    downbeats?: number[];
    quantizeMode?: StemQuantizeMode;
    masterMono?: Float32Array;
    detectionSourceMode?: DetectionSourceMode;
    masterReferenceName?: string;
  } = {}
): FullStemAnalysisResult {
  const durationSec = mono.length / sampleRate;
  const sensitivity = options.sensitivity ?? 0.62;
  const minNoteSec = (options.minNoteMs ?? 45) / 1000;
  const bassOnly = Boolean(options.bassOnly);
  const sourceMode: DetectionSourceMode = options.detectionSourceMode ?? 'auto-hybrid';
  const hasMasterRef = Boolean(
    options.masterMono &&
      options.masterMono.length > 256 &&
      sourceMode !== 'stem-only'
  );

  let detectionSourceUsed: FullStemAnalysisResult['detectionSourceUsed'] = 'stem-only';
  let baseMono = mono;
  let masterBassHelper: Float32Array | null = null;

  if (hasMasterRef && options.masterMono) {
    const mMono = options.masterMono;
    if (sourceMode === 'master-only') {
      baseMono = new Float32Array(mono.length);
      baseMono.set(mMono.subarray(0, Math.min(mono.length, mMono.length)));
      detectionSourceUsed = 'master-only';
    } else {
      detectionSourceUsed = 'master-guided-hybrid';
      // Build a Kick-masked 30-210Hz Master Bass helper buffer to rescue dropped notes or octave ambiguities in dirty Bass stems
      const mClamped = new Float32Array(mono.length);
      mClamped.set(mMono.subarray(0, Math.min(mono.length, mMono.length)));
      const mLow = filterBassIsolationBand(mClamped, sampleRate);
      masterBassHelper = maskKickTransientsFromBassSignal(mLow, sampleRate, mClamped);
    }
  }

  const rawFiltered =
    bassOnly || detectionSourceUsed === 'master-only'
      ? filterBassIsolationBand(baseMono, sampleRate)
      : baseMono;
  const analysisSig =
    bassOnly || detectionSourceUsed !== 'stem-only'
      ? maskKickTransientsFromBassSignal(
          rawFiltered,
          sampleRate,
          hasMasterRef && options.masterMono ? options.masterMono : baseMono
        )
      : rawFiltered;

  const onsetsRes = detectOnsetsSpectralFlux(analysisSig, sampleRate, {
    sensitivity,
    minIntervalMs: 70,
    snapToZeroCrossing: false,
  });

  // Track peak RMS for adaptive silence gate
  let globalPeakRms = 1e-6;
  const hop = Math.max(512, Math.round(sampleRate * 0.022)); // ~22ms frame hop
  const winLen = Math.max(2048, Math.round(sampleRate * 0.064)); // ~64ms YIN window (covers down to ~35 Hz E1!)
  const numFrames = Math.max(1, Math.floor((analysisSig.length - winLen) / hop) + 1);
  const frameRms = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    let sumSq = 0;
    for (let i = 0; i < winLen; i += 2) {
      const v = analysisSig[off + i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / (winLen / 2));
    frameRms[f] = rms;
    if (rms > globalPeakRms) globalPeakRms = rms;
  }

  const rmsGate = globalPeakRms * 0.045;
  const rawMidi = new Int16Array(numFrames).fill(-1);
  const rawConf = new Float32Array(numFrames);
  const maxYinHz = bassOnly || detectionSourceUsed === 'master-only' ? 240 : 1400;
  const maxAllowedMidi = bassOnly || detectionSourceUsed === 'master-only' ? 55 : 96; // Clamp to G3 in bassOnly mode

  let masterHelperPeakRms = 1e-6;
  if (masterBassHelper) {
    for (let f = 0; f < numFrames; f++) {
      const off = f * hop;
      let sumSq = 0;
      for (let i = 0; i < winLen && off + i < masterBassHelper.length; i += 2) {
        const v = masterBassHelper[off + i];
        sumSq += v * v;
      }
      const r = Math.sqrt(sumSq / (winLen / 2));
      if (r > masterHelperPeakRms) masterHelperPeakRms = r;
    }
  }

  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    if (frameRms[f] >= rmsGate) {
      const slice = analysisSig.subarray(off, off + winLen);
      const est = detectPitchYin(slice, sampleRate, 35, maxYinHz);
      if (est.confidence >= 0.48 && est.midiNote >= 24 && est.midiNote <= maxAllowedMidi) {
        const correctedMidi =
          bassOnly || est.midiNote <= 52
            ? checkBassSubOctaveFundamental(slice, sampleRate, est.midiNote)
            : est.midiNote;
        rawMidi[f] = correctedMidi;
        rawConf[f] = est.confidence;
        continue;
      }
    }

    // Master-Guided Bass Gap Rescue: when an AI-separated Bass stem has a dropout hole,
    // recover the missing bass pitch from the Kick-masked Master low band if present
    if (masterBassHelper && off + winLen <= masterBassHelper.length) {
      const mSlice = masterBassHelper.subarray(off, off + winLen);
      let sumSq = 0;
      for (let i = 0; i < winLen; i += 4) sumSq += mSlice[i] * mSlice[i];
      const mRms = Math.sqrt(sumSq / (winLen / 4));
      if (mRms >= masterHelperPeakRms * 0.14) {
        const mEst = detectPitchYin(mSlice, sampleRate, 35, 220);
        if (mEst.confidence >= 0.56 && mEst.midiNote >= 26 && mEst.midiNote <= 52) {
          rawMidi[f] = checkBassSubOctaveFundamental(mSlice, sampleRate, mEst.midiNote);
          rawConf[f] = mEst.confidence * 0.92;
          if (frameRms[f] < rmsGate) {
            frameRms[f] = Math.max(frameRms[f], globalPeakRms * 0.24 * (mRms / masterHelperPeakRms));
          }
        }
      }
    }
  }

  // 3-frame median filter to eliminate single-frame octave glitches
  const smoothedMidi = new Int16Array(numFrames).fill(-1);
  for (let f = 0; f < numFrames; f++) {
    if (rawMidi[f] < 0) continue;
    const winVals: number[] = [];
    for (let d = -1; d <= 1; d++) {
      const idx = f + d;
      if (idx >= 0 && idx < numFrames && rawMidi[idx] >= 0) {
        winVals.push(rawMidi[idx]);
      }
    }
    smoothedMidi[f] = winVals.length >= 2 ? getMedianNumber(winVals) : rawMidi[f];
  }

  // Onset lookup helper to split re-articulated identical pitches
  const onsetFrames = new Set<number>();
  for (const t of onsetsRes.onsetTimesSec) {
    onsetFrames.add(Math.round((t * sampleRate) / hop));
  }

  const noteEvents: StemNoteEvent[] = [];
  let curMidi = -1;
  let curStartFrame = 0;
  let curMaxRms = 0;
  let curConfSum = 0;
  let curFrames = 0;

  const flushNote = (endFrame: number) => {
    if (curMidi < 0 || curFrames === 0) return;
    const startSec = Number(((curStartFrame * hop) / sampleRate).toFixed(4));
    const endSec = Math.min(durationSec, Number(((endFrame * hop) / sampleRate).toFixed(4)));
    const durSec = Math.max(0.02, endSec - startSec);
    if (durSec < minNoteSec) return;

    // Snap startSec to nearest onset transient within ±35ms if available
    let snappedStart = startSec;
    for (const oSec of onsetsRes.onsetTimesSec) {
      if (Math.abs(oSec - startSec) < 0.038) {
        snappedStart = oSec;
        break;
      }
    }

    const vel = Number(Math.max(0.2, Math.min(1.0, curMaxRms / Math.max(1e-4, globalPeakRms * 0.8))).toFixed(3));
    noteEvents.push({
      id: `mn-${noteEvents.length}`,
      startSec: snappedStart,
      durationSec: Number(Math.max(0.03, endSec - snappedStart).toFixed(4)),
      midiNote: curMidi,
      noteName: midiNoteToName(curMidi),
      velocity: vel,
      clarity: Number((curConfSum / curFrames).toFixed(2)),
    });
  };

  for (let f = 0; f < numFrames; f++) {
    const m = smoothedMidi[f];
    const hasReAttack = f > curStartFrame + 2 && (onsetFrames.has(f) || onsetFrames.has(f - 1));

    if (m < 0) {
      flushNote(f);
      curMidi = -1;
      curFrames = 0;
      continue;
    }

    if (curMidi < 0) {
      curMidi = m;
      curStartFrame = f;
      curMaxRms = frameRms[f];
      curConfSum = rawConf[f];
      curFrames = 1;
    } else if (m !== curMidi || hasReAttack) {
      flushNote(f);
      curMidi = m;
      curStartFrame = f;
      curMaxRms = frameRms[f];
      curConfSum = rawConf[f];
      curFrames = 1;
    } else {
      curFrames++;
      if (frameRms[f] > curMaxRms) curMaxRms = frameRms[f];
      curConfSum += rawConf[f];
    }
  }
  flushNote(numFrames);

  const harmonizedMonoNotes = constrainNotesToDetectedHarmony(
    noteEvents,
    options.detectedChords,
    options.musicalKey,
    { isMonophonic: true }
  );

  const bpm =
    options.lockedBpm && options.lockedBpm >= 45 && options.lockedBpm <= 220
      ? options.lockedBpm
      : estimateBpmFromOnsets(
          harmonizedMonoNotes.map((n) => n.startSec),
          options.bpmHint ?? 120
        );

  const qMode: StemQuantizeMode =
    options.quantizeMode ?? (options.lockedBpm ? 'soft' : 'off');
  const finalMonoNotes = quantizeNoteEventsToTempo(
    harmonizedMonoNotes,
    bpm,
    options.beatOffsetSec ?? 0,
    durationSec,
    qMode,
    true,
    options.beatTimes
  );
  finalMonoNotes.forEach((ev, idx) => {
    ev.id = `mn-${idx}`;
  });

  let minMidi = 127;
  let maxMidi = 0;
  for (const n of finalMonoNotes) {
    if (n.midiNote < minMidi) minMidi = n.midiNote;
    if (n.midiNote > maxMidi) maxMidi = n.midiNote;
  }

  return {
    mode: 'monophonic',
    detectionSourceUsed,
    masterReferenceName: options.masterReferenceName,
    bassFocusApplied: bassOnly || undefined,
    quantizeMode: qMode,
    bpm,
    musicalKey: options.musicalKey,
    camelotKey: options.camelotKey,
    detectedChords: options.detectedChords,
    beatOffsetSec: options.beatOffsetSec,
    beatTimes: options.beatTimes,
    downbeats: options.downbeats,
    durationSec,
    drumHits: [],
    noteEvents: finalMonoNotes,
    midiRange:
      finalMonoNotes.length > 0
        ? {
            minMidi,
            maxMidi,
            minName: midiNoteToName(minMidi),
            maxName: midiNoteToName(maxMidi),
          }
        : undefined,
    counts: {
      total: finalMonoNotes.length,
      kick: 0,
      snare: 0,
      hat: 0,
      crash: 0,
      tom: 0,
      notes: finalMonoNotes.length,
    },
  };
}

/**
 * Polyphonic Pitch & Chord Transcription Engine for Guitar, Piano, Keys, Strings+
 * Uses 2x zero-padded 16384-pt FFT + Parabolic Spectral Peak Extraction (±38 cent harmonic matching)
 * + Fundamental-Anchored Iterative Harmonic Comb Subtraction (preserves octave/fifth chord notes!)
 * + Spectral Flux chord-onset snapping.
 */
export function analyzePolyphonicStemNotesFull(
  mono: Float32Array,
  sampleRate: number,
  options: { sensitivity?: number; maxPolyphony?: number; bpmHint?: number; lockedBpm?: number; musicalKey?: string; camelotKey?: string; detectedChords?: DetectedChordSegment[]; beatOffsetSec?: number; beatTimes?: number[]; downbeats?: number[]; quantizeMode?: StemQuantizeMode; hopOverride?: number } = {}
): FullStemAnalysisResult {
  const durationSec = mono.length / sampleRate;
  const sensitivity = Math.max(0.1, Math.min(1.0, options.sensitivity ?? 0.62));
  const maxPolyphony = Math.max(1, Math.min(6, options.maxPolyphony ?? 5));

  // 1. High-resolution onset attacks for sharp chord/arpeggio timing
  const onsetsRes = detectOnsetsSpectralFlux(mono, sampleRate, {
    sensitivity,
    minIntervalMs: 55,
    snapToZeroCrossing: false,
  });

  // 2. Zero-padded 16384 FFT parameters (8192 Hann -> 2.93 Hz/bin at 48kHz)
  const frameLen = 8192;
  const fftSize = 16384;
  const hop = options.hopOverride ?? (durationSec <= 75 ? 1024 : 2048);
  const numFrames = Math.max(1, Math.floor((mono.length - frameLen) / hop) + 1);
  const binHz = sampleRate / fftSize;

  // Frame center RMS (weighted in center 60% of window so boundary transients don't smear)
  const frameRms = new Float32Array(numFrames);
  let peakRms = 1e-6;
  const coreStart = Math.floor(frameLen * 0.2);
  const coreEnd = Math.floor(frameLen * 0.8);
  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    let sumSq = 0;
    for (let i = coreStart; i < coreEnd; i += 4) {
      const v = mono[off + i];
      sumSq += v * v;
    }
    const r = Math.sqrt(sumSq / ((coreEnd - coreStart) / 4));
    frameRms[f] = r;
    if (r > peakRms) peakRms = r;
  }

  const rmsGate = peakRms * (0.045 - sensitivity * 0.025);
  const minMidi = 28; // E1 (41.2 Hz)
  const maxMidi = 92; // G#6 (1661 Hz)
  const numNotes = maxMidi - minMidi + 1;
  const maxHarm = 6;
  // Expected harmonic amplitude decay template of a pitched note for peeling
  const harmWeights = [1.0, 0.68, 0.48, 0.34, 0.24, 0.16];
  const expectedPeelRatio = [1.0, 0.62, 0.42, 0.28, 0.18, 0.12];

  const midiFreqs = new Float32Array(numNotes);
  for (let m = 0; m < numNotes; m++) {
    midiFreqs[m] = 440 * Math.pow(2, (minMidi + m - 69) / 12);
  }

  // 2x decimated 8192-pt FFT when sampleRate >= 40kHz gives the exact same 2.93 Hz/bin resolution up to 8.5kHz at 2.5x speed
  const decimate2x = sampleRate >= 40000;
  const effFrameLen = decimate2x ? frameLen >> 1 : frameLen;
  const effFftSize = decimate2x ? fftSize >> 1 : fftSize;
  const effHalfBins = effFftSize >> 1;

  const win = buildHannWindow(effFrameLen);
  const re = new Float32Array(effFftSize);
  const im = new Float32Array(effFftSize);
  const mag = new Float32Array(effHalfBins);
  const cleanMag = new Float32Array(effHalfBins);
  const maxPeakBin = Math.min(effHalfBins - 8, Math.ceil(8500 / binHz));

  const frameDetections: Array<Array<{ midi: number; strength: number }>> = Array.from(
    { length: numFrames },
    () => []
  );

  // Tolerance in frequency ratio for parabolic peak match (~±42 cents -> avoids neighbor semitone leakage!)
  const maxCentRatioHigh = Math.pow(2, 42 / 1200);
  const maxCentRatioLow = Math.pow(2, -42 / 1200);
  const polyRelThreshold = 0.34 - sensitivity * 0.14; // 0.32 down to 0.20

  // Hann mainlobe subtraction kernel for ±5 bins around harmonic bin
  const subtractKernel = [0.04, 0.14, 0.36, 0.65, 0.9, 1.0, 0.9, 0.65, 0.36, 0.14, 0.04];

  for (let f = 0; f < numFrames; f++) {
    if (frameRms[f] < rmsGate) continue;

    const off = f * hop;
    re.fill(0);
    im.fill(0);
    if (decimate2x) {
      for (let i = 0; i < effFrameLen; i++) {
        const idx = off + (i << 1);
        re[i] = 0.5 * (mono[idx] + mono[idx + 1]) * win[i];
      }
    } else {
      for (let i = 0; i < effFrameLen; i++) {
        re[i] = mono[off + i] * win[i];
      }
    }
    fftInPlace(re, im);

    let frameMaxMag = 0;
    let magSum = 0;
    const tonalMaxBin = Math.min(effHalfBins - 1, Math.round(4500 / binHz));
    for (let k = 1; k <= maxPeakBin + 4 && k < effHalfBins; k++) {
      const a = Math.hypot(re[k], im[k]);
      mag[k] = a;
      if (a > frameMaxMag) frameMaxMag = a;
      if (k >= 6 && k <= tonalMaxBin) magSum += a;
    }
    if (frameMaxMag < 1e-4) continue;

    // Reject broadband percussive frames (snare cracks / hi-hat bursts) with flat spectrum
    const tonalMeanMag = magSum / Math.max(1, tonalMaxBin - 5);
    if (frameMaxMag / Math.max(1e-7, tonalMeanMag) < 3.6) continue;

    cleanMag.set(mag);

    const pickedInFrame: Array<{ midi: number; strength: number }> = [];
    let firstSalience = 0;

    for (let p = 0; p < maxPolyphony; p++) {
      // Extract TRUE local spectral peaks in cleanMag with parabolic sub-bin frequency estimation
      const peaks: Array<{ bin: number; freqHz: number; amp: number }> = [];
      const peakNoiseFloor = frameMaxMag * 0.028;
      for (let k = 8; k <= maxPeakBin; k++) {
        const a = cleanMag[k];
        if (a > peakNoiseFloor && a >= cleanMag[k - 1] && a > cleanMag[k + 1]) {
          const s0 = cleanMag[k - 1];
          const s1 = a;
          const s2 = cleanMag[k + 1];
          const denom = s0 - 2 * s1 + s2;
          const delta = Math.abs(denom) > 1e-9 ? Math.max(-0.5, Math.min(0.5, 0.5 * (s0 - s2) / denom)) : 0;
          const exactFreq = (k + delta) * binHz;
          if (exactFreq >= 36 && exactFreq <= 8500) {
            peaks.push({ bin: k, freqHz: exactFreq, amp: s1 });
          }
        }
      }
      if (peaks.length === 0) break;

      const matchPeakAtFreq = (targetHz: number): number => {
        const loHz = targetHz * maxCentRatioLow;
        const hiHz = targetHz * maxCentRatioHigh;
        let lo = 0;
        let hi = peaks.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (peaks[mid].freqHz < loHz) lo = mid + 1;
          else hi = mid - 1;
        }
        let bestAmp = 0;
        for (let i = lo; i < peaks.length; i++) {
          const pk = peaks[i];
          if (pk.freqHz > hiHz) break;
          const ratioErr = Math.abs(Math.log2(pk.freqHz / targetHz) * 1200);
          const w = Math.max(0.25, 1 - ratioErr / 48);
          const score = pk.amp * w;
          if (score > bestAmp) bestAmp = score;
        }
        return bestAmp;
      };

      let bestMidiIdx = -1;
      let bestSalience = 0;
      let bestAmp1 = 0;

      for (let m = 0; m < numNotes; m++) {
        const candMidi = minMidi + m;
        if (
          pickedInFrame.some(
            (x) =>
              Math.abs(x.midi - candMidi) <= 1 ||
              (candMidi < 55 && x.midi < 55 && Math.abs(x.midi - candMidi) <= 2)
          )
        ) {
          continue; // Do not pick same note, adjacent semitone smearing, or <200Hz ±2st shoulder overlap
        }

        const f0 = midiFreqs[m];
        const amp1 = matchPeakAtFreq(f0);
        if (amp1 < peakNoiseFloor * 1.4) continue; // Fundamental MUST actually exist as a true spectral peak!

        let salience = amp1 * harmWeights[0];
        let maxOverTone = 0;
        let matchingHarmonics = 1;

        for (let h = 2; h <= maxHarm; h++) {
          const fh = f0 * h;
          if (fh > 8200) break;
          const ah = matchPeakAtFreq(fh);
          if (ah > maxOverTone) maxOverTone = ah;
          if (ah > amp1 * 0.12) matchingHarmonics++;
          salience += ah * harmWeights[h - 1];
        }

        // Reject phantom sub-octaves where amp1 is tiny relative to an octave above
        if (amp1 < maxOverTone * 0.22) continue;
        // Favor full harmonic coincidence slightly over orphan sine artifacts
        if (matchingHarmonics >= 2) salience *= 1.15;

        if (salience > bestSalience) {
          bestSalience = salience;
          bestMidiIdx = m;
          bestAmp1 = amp1;
        }
      }

      if (bestMidiIdx < 0 || bestSalience <= peakNoiseFloor * 2.0) break;
      if (p === 0) {
        firstSalience = bestSalience;
      } else if (bestSalience < firstSalience * polyRelThreshold) {
        break;
      }

      const chosenMidi = minMidi + bestMidiIdx;
      const f0 = midiFreqs[bestMidiIdx];
      pickedInFrame.push({ midi: chosenMidi, strength: bestSalience });

      // Fundamental-Anchored Harmonic Subtraction:
      // Only peel up to `bestAmp1 * expectedPeelRatio[h]` (NEVER erase co-occurring octave/fifth chord notes!)
      for (let h = 1; h <= maxHarm; h++) {
        const fh = f0 * h;
        const bk = Math.round(fh / binHz);
        if (bk < 6 || bk >= effHalfBins - 6) continue;
        const binLocalMax = Math.max(cleanMag[bk - 1], cleanMag[bk], cleanMag[bk + 1]);
        const predictedMax = bestAmp1 * expectedPeelRatio[h - 1] * 1.15;
        const peelLevel = Math.min(binLocalMax * 0.94, predictedMax);
        for (let d = -5; d <= 5; d++) {
          cleanMag[bk + d] = Math.max(0, cleanMag[bk + d] - peelLevel * subtractKernel[d + 5]);
        }
      }
    }

    frameDetections[f] = pickedInFrame;
  }

  // Build onset-frame index for splitting re-strummed chords on the same notes
  const onsetSecList = onsetsRes.onsetTimesSec;
  const onsetAtFrame = new Set<number>();
  for (const t of onsetSecList) {
    onsetAtFrame.add(Math.round((t * sampleRate) / hop));
  }

  // Track each MIDI pitch line independently across frames -> merge into clean StemNoteEvent[]
  const rawEvents: StemNoteEvent[] = [];
  let maxStrengthOverall = 1e-4;
  for (const fd of frameDetections) {
    for (const item of fd) {
      if (item.strength > maxStrengthOverall) maxStrengthOverall = item.strength;
    }
  }

  for (let midi = minMidi; midi <= maxMidi; midi++) {
    let activeStartFrame = -1;
    let missGap = 0;
    let peakStrength = 0;
    let lastSeenFrame = -1;

    const commitEvent = (startF: number, endF: number, strVal: number) => {
      const spanFrames = endF - startF + 1;
      // Require >= 2 frames (~42ms+ tonal sustain) so single-frame broadband transient clicks / hard cutoffs are rejected!
      if (spanFrames < 2) return;

      // Align frame timestamp near Hann energy center (0.38 * frameLen) so chords snap accurately without pre-ring bias
      const rawStartSec = (startF * hop + frameLen * 0.38) / sampleRate;
      const rawEndSec = Math.min(
        durationSec,
        ((endF + 1) * hop + frameLen * 0.5) / sampleRate
      );

      // Snap startSec to nearest sharp onset attack within ±75ms
      let snappedStart = Math.max(0, rawStartSec);
      let backedByOnset = false;
      let bestOnsetDist = 0.075;
      for (const oSec of onsetSecList) {
        const d = Math.abs(oSec - rawStartSec);
        if (d <= bestOnsetDist) {
          bestOnsetDist = d;
          snappedStart = oSec;
          backedByOnset = true;
        }
      }

      const dur = Math.max(0.06, rawEndSec - snappedStart);

      rawEvents.push({
        id: '',
        startSec: Number(snappedStart.toFixed(4)),
        durationSec: Number(dur.toFixed(4)),
        midiNote: midi,
        noteName: midiNoteToName(midi),
        velocity: Number(
          Math.max(0.24, Math.min(1.0, strVal / (maxStrengthOverall * 0.65))).toFixed(3)
        ),
        clarity: backedByOnset ? 0.94 : 0.78,
      });
    };

    for (let f = 0; f < numFrames; f++) {
      const hit = frameDetections[f].find((x) => x.midi === midi);
      const isReAttack =
        activeStartFrame >= 0 &&
        f > activeStartFrame + 3 &&
        (onsetAtFrame.has(f) || onsetAtFrame.has(f - 1));

      if (hit) {
        if (activeStartFrame >= 0 && isReAttack) {
          commitEvent(activeStartFrame, f - 1, peakStrength);
          activeStartFrame = f;
          lastSeenFrame = f;
          peakStrength = hit.strength;
          missGap = 0;
        } else if (activeStartFrame < 0) {
          activeStartFrame = f;
          lastSeenFrame = f;
          peakStrength = hit.strength;
          missGap = 0;
        } else {
          lastSeenFrame = f;
          missGap = 0;
          if (hit.strength > peakStrength) peakStrength = hit.strength;
        }
      } else if (activeStartFrame >= 0) {
        missGap++;
        if (missGap > 1 || f === numFrames - 1) {
          commitEvent(activeStartFrame, lastSeenFrame, peakStrength);
          activeStartFrame = -1;
        }
      }
    }
    if (activeStartFrame >= 0) {
      commitEvent(activeStartFrame, lastSeenFrame, peakStrength);
    }
  }

  rawEvents.sort((a, b) => a.startSec - b.startSec || a.midiNote - b.midiNote);

  // Deduplicate/merge identical MIDI notes whose onset snap mapped to the exact same beat within 75ms
  const dedupedEvents: StemNoteEvent[] = [];
  for (const ev of rawEvents) {
    const existing = dedupedEvents.find(
      (prev) =>
        prev.midiNote === ev.midiNote &&
        Math.abs(prev.startSec - ev.startSec) <= 0.075
    );
    if (existing) {
      const endA = existing.startSec + existing.durationSec;
      const endB = ev.startSec + ev.durationSec;
      existing.durationSec = Number(Math.max(0.06, Math.max(endA, endB) - existing.startSec).toFixed(4));
      existing.velocity = Math.max(existing.velocity, ev.velocity);
    } else {
      dedupedEvents.push(ev);
    }
  }

  const harmonizedPolyEvents = constrainNotesToDetectedHarmony(
    dedupedEvents,
    options.detectedChords,
    options.musicalKey
  );

  const bpm =
    options.lockedBpm && options.lockedBpm >= 45 && options.lockedBpm <= 220
      ? options.lockedBpm
      : estimateBpmFromOnsets(onsetsRes.onsetTimesSec, options.bpmHint ?? 120);

  const qMode: StemQuantizeMode =
    options.quantizeMode ?? (options.lockedBpm ? 'soft' : 'off');
  const finalPolyNotes = quantizeNoteEventsToTempo(
    harmonizedPolyEvents,
    bpm,
    options.beatOffsetSec ?? 0,
    durationSec,
    qMode,
    false,
    options.beatTimes
  );
  finalPolyNotes.forEach((ev, idx) => {
    ev.id = `pn-${idx}`;
  });

  let minFound = 127;
  let maxFound = 0;
  for (const n of finalPolyNotes) {
    if (n.midiNote < minFound) minFound = n.midiNote;
    if (n.midiNote > maxFound) maxFound = n.midiNote;
  }

  return {
    mode: 'polyphonic',
    quantizeMode: qMode,
    bpm,
    musicalKey: options.musicalKey,
    camelotKey: options.camelotKey,
    detectedChords: options.detectedChords,
    beatOffsetSec: options.beatOffsetSec,
    beatTimes: options.beatTimes,
    downbeats: options.downbeats,
    durationSec,
    drumHits: [],
    noteEvents: finalPolyNotes,
    midiRange:
      finalPolyNotes.length > 0
        ? {
            minMidi: minFound,
            maxMidi: maxFound,
            minName: midiNoteToName(minFound),
            maxName: midiNoteToName(maxFound),
          }
        : undefined,
    counts: {
      total: finalPolyNotes.length,
      kick: 0,
      snare: 0,
      hat: 0,
      crash: 0,
      tom: 0,
      notes: finalPolyNotes.length,
    },
  };
}

/**
 * Isolates the 30 Hz - 210 Hz bass band (2nd-order HPF + 4th-order Butterworth LPF)
 * so vocals, snares, guitars and cymbals don't mask low-end bass tracking in full songs.
 */
export function filterBassIsolationBand(mono: Float32Array, sr: number): Float32Array {
  const out = new Float32Array(mono.length);
  // Stage 1: 2nd-order Butterworth HPF @ 30Hz
  const wH = (2 * Math.PI * 30) / sr;
  const cH = Math.cos(wH);
  const aH = Math.sin(wH) / (2 * Math.SQRT1_2);
  const a0H = 1 + aH;
  const hb0 = ((1 + cH) * 0.5) / a0H;
  const hb1 = -(1 + cH) / a0H;
  const ha1 = (-2 * cH) / a0H;
  const ha2 = (1 - aH) / a0H;

  // Stage 2 & 3: Cascaded 2nd-order Butterworth LPF @ 210Hz (24 dB/oct)
  const wL = (2 * Math.PI * 210) / sr;
  const cL = Math.cos(wL);
  const aL = Math.sin(wL) / (2 * Math.SQRT1_2);
  const a0L = 1 + aL;
  const lb0 = ((1 - cL) * 0.5) / a0L;
  const lb1 = (1 - cL) / a0L;
  const la1 = (-2 * cL) / a0L;
  const la2 = (1 - aL) / a0L;

  let hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
  let l1x1 = 0, l1x2 = 0, l1y1 = 0, l1y2 = 0;
  let l2x1 = 0, l2x2 = 0, l2y1 = 0, l2y2 = 0;

  for (let i = 0; i < mono.length; i++) {
    const x = mono[i];
    const hp = hb0 * x + hb1 * hx1 + hb0 * hx2 - ha1 * hy1 - ha2 * hy2;
    hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = hp;

    const lp1 = lb0 * hp + lb1 * l1x1 + lb0 * l1x2 - la1 * l1y1 - la2 * l1y2;
    l1x2 = l1x1; l1x1 = hp; l1y2 = l1y1; l1y1 = lp1;

    const lp2 = lb0 * lp1 + lb1 * l2x1 + lb0 * l2x2 - la1 * l2y1 - la2 * l2y2;
    l2x2 = l2x1; l2x1 = lp1; l2y2 = l2y1; l2y1 = lp2;

    out[i] = lp2;
  }
  return out;
}

export function foldPitchClassToSubRegister(
  pitchClass: number,
  prevMidi: number | null,
  minBassMidi = 28, // E1 (41.2 Hz)
  maxBassMidi = 43  // G2 (98.0 Hz)
): number {
  const pc = ((pitchClass % 12) + 12) % 12;
  const anchor = prevMidi ?? 35; // B1 / C2 center
  let best = minBassMidi + ((pc - (minBassMidi % 12) + 12) % 12);
  let bestDist = Infinity;
  for (let m = minBassMidi; m <= maxBassMidi; m++) {
    if (m % 12 !== pc) continue;
    const d = Math.abs(m - anchor);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

function inferChordRootPitchClass(
  activeNotes: StemNoteEvent[],
  lowBandMidi: number
): number {
  const lowestNote = activeNotes.reduce(
    (best, n) => (n.midiNote < best.midiNote ? n : best),
    activeNotes[0]
  );
  if (activeNotes.length === 1) {
    return lowestNote.midiNote % 12;
  }

  const pcWeight = new Float32Array(12);
  for (const n of activeNotes) {
    const pc = n.midiNote % 12;
    pcWeight[pc] += Math.max(0.2, n.velocity);
  }

  const lowestPc = lowestNote.midiNote % 12;
  const lowBandPc = lowBandMidi >= 28 ? lowBandMidi % 12 : -1;

  let bestPc = lowestPc;
  let bestScore = -1;

  for (let pc = 0; pc < 12; pc++) {
    if (pcWeight[pc] <= 0) continue;
    let score = pcWeight[pc];
    // Major / Minor triad structural support
    const hasMaj3 = pcWeight[(pc + 4) % 12] > 0;
    const hasMin3 = pcWeight[(pc + 3) % 12] > 0;
    const hasFifth = pcWeight[(pc + 7) % 12] > 0;
    const hasMin7 = pcWeight[(pc + 10) % 12] > 0;

    if (hasMaj3 || hasMin3) score += 0.55;
    if (hasFifth) score += 0.85;
    if (hasMin7) score += 0.25;
    if (pc === lowestPc) score += 0.35;
    if (pc === lowBandPc) score += 0.45;

    if (score > bestScore) {
      bestScore = score;
      bestPc = pc;
    }
  }

  return bestPc;
}

/**
 * Bass-Focus Progression & Sub-Register Analyzer:
 * Extracts ONLY monophonic sub/bass notes (E1..G#2 / 41..104 Hz) from ANY full song,
 * chord progression (Piano/Guitar), or bass stem:
 * 1) Isolates the 30-210 Hz bass band via 16384-pt FFT to track existing basslines in full mixes.
 * 2) When the mix/stem has no low bassline (e.g. chords/guitar/piano), detects the harmonic chord
 *    progression and infers the root note folded smoothly into sub-bass register (E1..G2).
 * 3) Enforces strict non-overlapping monophonic bass note events.
 */
export function analyzeBassProgressionFull(
  mono: Float32Array,
  sampleRate: number,
  options: {
    sensitivity?: number;
    maxPolyphony?: number;
    bpmHint?: number;
    lockedBpm?: number;
    precomputedPoly?: FullStemAnalysisResult;
    precomputedChords?: DetectedChordSegment[];
    musicalKey?: string;
    camelotKey?: string;
    beatOffsetSec?: number;
    beatTimes?: number[];
    downbeats?: number[];
    quantizeMode?: StemQuantizeMode;
    masterMono?: Float32Array;
    detectionSourceMode?: DetectionSourceMode;
    masterReferenceName?: string;
  } = {}
): FullStemAnalysisResult {
  const durationSec = mono.length / sampleRate;
  const sensitivity = Math.max(0.1, Math.min(1.0, options.sensitivity ?? 0.62));
  const sourceMode: DetectionSourceMode = options.detectionSourceMode ?? 'auto-hybrid';
  const hasMasterRef = Boolean(
    options.masterMono &&
      options.masterMono.length > 256 &&
      sourceMode !== 'stem-only'
  );
  let detectionSourceUsed: FullStemAnalysisResult['detectionSourceUsed'] = 'stem-only';
  let workMono = mono;
  if (hasMasterRef && options.masterMono) {
    const mMono = options.masterMono;
    if (sourceMode === 'master-only') {
      workMono = new Float32Array(mono.length);
      workMono.set(mMono.subarray(0, Math.min(mono.length, mMono.length)));
      detectionSourceUsed = 'master-only';
    } else {
      workMono = new Float32Array(mono.length);
      const cmpLen = Math.min(mono.length, mMono.length);
      for (let i = 0; i < mono.length; i++) {
        const mv = i < cmpLen ? mMono[i] : 0;
        workMono[i] = mono[i] * 0.65 + mv * 0.35;
      }
      detectionSourceUsed = 'master-guided-hybrid';
    }
  }

  // 1. Reuse pre-analyzed polyphonic notes + chords stored in memory when available
  const poly =
    options.precomputedPoly ??
    analyzePolyphonicStemNotesFull(workMono, sampleRate, {
      sensitivity,
      maxPolyphony: options.maxPolyphony ?? 5,
      bpmHint: options.bpmHint,
      lockedBpm: options.lockedBpm,
      detectedChords: options.precomputedChords,
      musicalKey: options.musicalKey,
      camelotKey: options.camelotKey,
      beatOffsetSec: options.beatOffsetSec,
      beatTimes: options.beatTimes,
      downbeats: options.downbeats,
      quantizeMode: options.quantizeMode,
    });
  const storedChords = options.precomputedChords ?? [];

  // 2. Isolate 30-210 Hz bass band (with surgical Kick transient masking) and analyze frame-by-frame low fundamentals
  const rawLowBand = filterBassIsolationBand(workMono, sampleRate);
  const lowBand = maskKickTransientsFromBassSignal(
    rawLowBand,
    sampleRate,
    hasMasterRef && options.masterMono ? options.masterMono : workMono
  );
  const fullOnsets = detectOnsetsSpectralFlux(workMono, sampleRate, {
    sensitivity,
    minIntervalMs: 75,
    snapToZeroCrossing: false,
  });
  const lowOnsets = detectOnsetsSpectralFlux(lowBand, sampleRate, {
    sensitivity: Math.min(0.95, sensitivity + 0.08),
    minIntervalMs: 85,
    snapToZeroCrossing: false,
  });

  const frameLen = 8192;
  const fftSize = 16384;
  const hop = durationSec <= 75 ? 1024 : 2048;
  const numFrames = Math.max(1, Math.floor((mono.length - frameLen) / hop) + 1);
  const binHz = sampleRate / fftSize;

  const lowRms = new Float32Array(numFrames);
  const fullRms = new Float32Array(numFrames);
  let peakLowRms = 1e-6;
  let peakFullRms = 1e-6;
  const coreStart = Math.floor(frameLen * 0.2);
  const coreEnd = Math.floor(frameLen * 0.8);

  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    let sumL = 0;
    let sumF = 0;
    for (let i = coreStart; i < coreEnd; i += 4) {
      const vl = lowBand[off + i];
      const vf = mono[off + i];
      sumL += vl * vl;
      sumF += vf * vf;
    }
    const rl = Math.sqrt(sumL / ((coreEnd - coreStart) / 4));
    const rf = Math.sqrt(sumF / ((coreEnd - coreStart) / 4));
    lowRms[f] = rl;
    fullRms[f] = rf;
    if (rl > peakLowRms) peakLowRms = rl;
    if (rf > peakFullRms) peakFullRms = rf;
  }

  // Since lowBand is 4th-order Butterworth low-passed at 210 Hz, 8x decimation to 2048-pt FFT
  // gives the exact same 2.93 Hz/bin resolution at 10x speed with zero aliasing!
  const decFactor = sampleRate >= 32000 ? 8 : 4;
  const decFrameLen = Math.floor(frameLen / decFactor);
  const decFftSize = Math.floor(fftSize / decFactor);
  const decHalfBins = decFftSize >> 1;
  const win = buildHannWindow(decFrameLen);
  const re = new Float32Array(decFftSize);
  const im = new Float32Array(decFftSize);
  const mag = new Float32Array(decHalfBins);
  const maxLowBin = Math.min(decHalfBins - 4, Math.ceil(380 / binHz));
  const rawLowMidi = new Int16Array(numFrames).fill(-1);
  const lowGate = peakLowRms * (0.14 - sensitivity * 0.06);

  for (let f = 0; f < numFrames; f++) {
    if (lowRms[f] < lowGate) continue;
    const off = f * hop;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < decFrameLen; i++) {
      re[i] = lowBand[off + i * decFactor] * win[i];
    }
    fftInPlace(re, im);

    let frameMax = 0;
    for (let k = 6; k <= maxLowBin; k++) {
      const a = Math.hypot(re[k], im[k]);
      mag[k] = a;
      if (a > frameMax) frameMax = a;
    }
    if (frameMax < 1e-4) continue;

    const peaks: Array<{ freqHz: number; amp: number }> = [];
    const floor = frameMax * 0.14;
    for (let k = 8; k < maxLowBin - 2; k++) {
      const a = mag[k];
      if (a > floor && a >= mag[k - 1] && a > mag[k + 1]) {
        const s0 = mag[k - 1];
        const s2 = mag[k + 1];
        const denom = s0 - 2 * a + s2;
        const delta = Math.abs(denom) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (s0 - s2)) / denom)) : 0;
        const freqHz = (k + delta) * binHz;
        if (freqHz >= 36 && freqHz <= 350) {
          peaks.push({ freqHz, amp: a });
        }
      }
    }
    if (peaks.length === 0) continue;

    const findPeak = (targetHz: number) => {
      const lo = targetHz * 0.975;
      const hi = targetHz * 1.026;
      let best = 0;
      for (let i = 0; i < peaks.length; i++) {
        if (peaks[i].freqHz > hi) break;
        if (peaks[i].freqHz >= lo && peaks[i].amp > best) best = peaks[i].amp;
      }
      return best;
    };

    let bestMidi = -1;
    let bestScore = 0;
    for (let m = 28; m <= 50; m++) {
      const f0 = 440 * Math.pow(2, (m - 69) / 12);
      const amp1 = findPeak(f0);
      const amp2 = f0 * 2 <= 350 ? findPeak(f0 * 2) : 0;
      const amp3 = f0 * 3 <= 365 ? findPeak(f0 * 3) : 0;
      // Allow real E1..B1 electric/acoustic bass notes whose 2nd & 3rd harmonics confirm the phantom fundamental
      const hasHarmonicSeriesSupport = amp1 >= floor * 0.55 && amp2 >= floor && amp3 >= amp2 * 0.16;
      if (amp1 < floor && !hasHarmonicSeriesSupport) continue;
      if (f0 < 62 && amp1 < amp2 * 0.22 && !hasHarmonicSeriesSupport) continue;
      const score = amp1 + amp2 * 0.45 + amp3 * 0.28;
      if (score > bestScore) {
        bestScore = score;
        bestMidi = m;
      }
    }
    rawLowMidi[f] = bestMidi;
  }

  // 3-frame median filter on low-band MIDI to reject 1-frame kick-drum sweeps
  const smoothedLowMidi = new Int16Array(numFrames).fill(-1);
  for (let f = 0; f < numFrames; f++) {
    if (rawLowMidi[f] < 0) continue;
    const vals: number[] = [];
    for (let d = -1; d <= 1; d++) {
      const idx = f + d;
      if (idx >= 0 && idx < numFrames && rawLowMidi[idx] >= 0) {
        vals.push(rawLowMidi[idx]);
      }
    }
    smoothedLowMidi[f] = vals.length >= 2 ? getMedianNumber(vals) : -1;
  }

  // 3. Fuse low-band bass tracking + polyphonic chord-root extraction per frame
  const chosenFrameMidi = new Int16Array(numFrames).fill(-1);
  const fullGate = peakFullRms * 0.08;
  let lastBassMidi: number | null = null;

  const findChordAt = (tSec: number): DetectedChordSegment | undefined => {
    if (storedChords.length === 0) return undefined;
    const probeT = tSec + 0.02;
    for (const c of storedChords) {
      if (probeT >= c.startSec && probeT < c.endSec) return c;
    }
    for (const c of storedChords) {
      if (tSec >= c.startSec && tSec < c.endSec) return c;
    }
    let best = storedChords[0];
    let bestDist = Infinity;
    for (const c of storedChords) {
      const d = tSec < c.startSec ? c.startSec - tSec : tSec > c.endSec ? tSec - c.endSec : 0;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return bestDist <= 0.35 ? best : undefined;
  };

  for (let f = 0; f < numFrames; f++) {
    if (fullRms[f] < fullGate && lowRms[f] < peakLowRms * 0.12) continue;
    const tSec = (f * hop + frameLen * 0.38) / sampleRate;
    const activePoly = poly.noteEvents.filter(
      (ev) => ev.startSec <= tSec + 0.035 && ev.startSec + ev.durationSec >= tSec - 0.015
    );
    const lowMidi = smoothedLowMidi[f];
    const lowEnergyRatio = lowRms[f] / (fullRms[f] + 1e-6);

    // When chord progression is detected, anchor sub-bass to detected chords so kick sweeps
    // and low-FFT bin jitter never emit non-chord/out-of-key bass notes
    const activeChord = findChordAt(tSec);
    if (activeChord) {
      const chordPcs = getChordPitchClasses(activeChord);
      const lowPc = lowMidi >= 28 ? ((lowMidi % 12) + 12) % 12 : -1;
      const isRootMatch = lowPc === activeChord.rootPitchClass;
      const isSteadyChordInversion =
        lowMidi >= 28 &&
        lowMidi <= 44 &&
        chordPcs.has(lowPc) &&
        Math.abs((lowPc - activeChord.rootPitchClass + 12) % 12) !== 1 &&
        Math.abs((activeChord.rootPitchClass - lowPc + 12) % 12) !== 1 &&
        lowEnergyRatio >= 0.17 &&
        f >= 2 &&
        smoothedLowMidi[f - 1] === lowMidi &&
        smoothedLowMidi[f - 2] === lowMidi;

      if (isRootMatch && lowMidi >= 28 && lowMidi <= 44) {
        chosenFrameMidi[f] = lowMidi;
        lastBassMidi = lowMidi;
      } else if (isSteadyChordInversion) {
        const folded = foldPitchClassToSubRegister(lowPc, lastBassMidi, 28, 40);
        chosenFrameMidi[f] = folded;
        lastBassMidi = folded;
      } else {
        const folded = foldPitchClassToSubRegister(
          activeChord.rootPitchClass,
          lastBassMidi,
          28,
          40
        );
        chosenFrameMidi[f] = folded;
        lastBassMidi = folded;
      }
      continue;
    }

    const hasTrueSubBass =
      (lowMidi >= 28 && lowMidi <= 40 && (lowEnergyRatio >= 0.14 || activePoly.length === 0)) ||
      (lowMidi >= 28 && lowMidi <= 44 && activePoly.length <= 1);

    if (hasTrueSubBass) {
      chosenFrameMidi[f] = lowMidi;
      lastBassMidi = lowMidi;
      continue;
    }

    if (activePoly.length > 0) {
      const rootPc = inferChordRootPitchClass(activePoly, lowMidi);
      const folded: number = foldPitchClassToSubRegister(rootPc, lastBassMidi, 28, 40);
      chosenFrameMidi[f] = folded;
      lastBassMidi = folded;
      continue;
    }

    if (lowMidi >= 28 && fullRms[f] >= fullGate) {
      const folded: number =
        lowMidi <= 44
          ? lowMidi
          : foldPitchClassToSubRegister(lowMidi % 12, lastBassMidi, 28, 40);
      chosenFrameMidi[f] = folded;
      lastBassMidi = folded;
    }
  }

  // Smooth fused frame decisions
  const finalMidi = new Int16Array(numFrames).fill(-1);
  for (let f = 0; f < numFrames; f++) {
    if (chosenFrameMidi[f] < 0) continue;
    const vals: number[] = [];
    for (let d = -1; d <= 1; d++) {
      const idx = f + d;
      if (idx >= 0 && idx < numFrames && chosenFrameMidi[idx] >= 0) vals.push(chosenFrameMidi[idx]);
    }
    finalMidi[f] = vals.length >= 2 ? getMedianNumber(vals) : chosenFrameMidi[f];
  }

  const allOnsets = [...fullOnsets.onsetTimesSec, ...lowOnsets.onsetTimesSec].sort((a, b) => a - b);
  const onsetFrames = new Set<number>();
  for (const os of lowOnsets.onsetTimesSec) {
    onsetFrames.add(Math.round((os * sampleRate) / hop));
  }
  for (const ev of poly.noteEvents) {
    onsetFrames.add(Math.round((ev.startSec * sampleRate) / hop));
  }

  const noteEvents: StemNoteEvent[] = [];
  let curMidi = -1;
  let curStartF = 0;
  let curPeakRms = 0;
  let curFrames = 0;

  const flushBassNote = (endF: number) => {
    if (curMidi < 0 || curFrames < 3) return;
    const rawStartSec = Math.max(0, (curStartF * hop + frameLen * 0.35) / sampleRate);
    const rawEndSec = Math.min(durationSec, (endF * hop + frameLen * 0.5) / sampleRate);
    let snappedStart = rawStartSec;
    let bestD = 0.065;
    for (const oSec of allOnsets) {
      const d = Math.abs(oSec - rawStartSec);
      if (d <= bestD) {
        bestD = d;
        snappedStart = oSec;
      }
    }
    // Check polyphonic note start alignment too
    for (const ev of poly.noteEvents) {
      const d = Math.abs(ev.startSec - rawStartSec);
      if (d <= bestD) {
        bestD = d;
        snappedStart = ev.startSec;
      }
    }

    const dur = Math.max(0.05, rawEndSec - snappedStart);
    if (dur < 0.065) return;

    const vel = Number(
      Math.max(0.32, Math.min(1.0, curPeakRms / Math.max(1e-4, peakFullRms * 0.72))).toFixed(3)
    );
    noteEvents.push({
      id: '',
      startSec: Number(snappedStart.toFixed(4)),
      durationSec: Number(dur.toFixed(4)),
      midiNote: curMidi,
      noteName: midiNoteToName(curMidi),
      velocity: vel,
      clarity: 0.9,
    });
  };

  for (let f = 0; f < numFrames; f++) {
    const m = finalMidi[f];
    const frameEnergy = Math.max(lowRms[f], fullRms[f] * 0.7);
    const prevEnergy =
      f >= 2
        ? Math.min(
            Math.max(lowRms[f - 1], fullRms[f - 1] * 0.7),
            Math.max(lowRms[f - 2], fullRms[f - 2] * 0.7)
          )
        : frameEnergy;
    const reAttack =
      f > curStartF + 4 && onsetFrames.has(f) && frameEnergy > prevEnergy * 1.25;
    if (m < 0) {
      flushBassNote(f);
      curMidi = -1;
      curFrames = 0;
      continue;
    }
    if (curMidi < 0) {
      curMidi = m;
      curStartF = f;
      curPeakRms = frameEnergy;
      curFrames = 1;
    } else if (m !== curMidi || reAttack) {
      flushBassNote(f);
      curMidi = m;
      curStartF = f;
      curPeakRms = frameEnergy;
      curFrames = 1;
    } else {
      curFrames++;
      if (frameEnergy > curPeakRms) curPeakRms = frameEnergy;
    }
  }
  flushBassNote(numFrames);

  // Deduplicate/merge near-simultaneous notes & enforce strictly non-overlapping monophonic bass line
  noteEvents.sort((a, b) => a.startSec - b.startSec);
  const monoBass: StemNoteEvent[] = [];
  for (const ev of noteEvents) {
    const prev = monoBass[monoBass.length - 1];
    if (prev && Math.abs(ev.startSec - prev.startSec) < 0.045) {
      prev.durationSec = Math.max(prev.durationSec, ev.durationSec);
      prev.velocity = Math.max(prev.velocity, ev.velocity);
    } else {
      monoBass.push(ev);
    }
  }

  for (let i = 0; i < monoBass.length; i++) {
    monoBass[i].id = `bf-${i}`;
    if (i < monoBass.length - 1) {
      const maxDur = Math.max(0.04, monoBass[i + 1].startSec - monoBass[i].startSec - 0.008);
      if (monoBass[i].durationSec > maxDur) {
        monoBass[i].durationSec = Number(maxDur.toFixed(4));
      }
    }
  }

  let minFound = 127;
  let maxFound = 0;
  for (const n of monoBass) {
    if (n.midiNote < minFound) minFound = n.midiNote;
    if (n.midiNote > maxFound) maxFound = n.midiNote;
  }

  const resolvedBpm =
    options.lockedBpm && options.lockedBpm >= 45 && options.lockedBpm <= 220
      ? options.lockedBpm
      : options.bpmHint && options.bpmHint >= 45 && options.bpmHint <= 220
        ? Math.round(options.bpmHint * 10) / 10
        : poly.bpm;

  const qMode: StemQuantizeMode =
    options.quantizeMode ?? (options.lockedBpm || options.bpmHint ? 'soft' : 'off');
  const effectiveBeatTimes = options.beatTimes ?? poly.beatTimes;
  const finalBassNotes = quantizeNoteEventsToTempo(
    monoBass,
    resolvedBpm,
    options.beatOffsetSec ?? poly.beatOffsetSec ?? 0,
    durationSec,
    qMode,
    true,
    effectiveBeatTimes
  );

  return {
    mode: poly.mode,
    detectionSourceUsed,
    masterReferenceName: options.masterReferenceName,
    bassFocusApplied: true,
    quantizeMode: qMode,
    bpm: resolvedBpm,
    musicalKey: options.musicalKey ?? poly.musicalKey,
    camelotKey: options.camelotKey ?? poly.camelotKey,
    detectedChords: options.precomputedChords ?? poly.detectedChords,
    beatOffsetSec: options.beatOffsetSec ?? poly.beatOffsetSec,
    beatTimes: effectiveBeatTimes,
    downbeats: options.downbeats ?? poly.downbeats,
    durationSec,
    drumHits: [],
    noteEvents: finalBassNotes,
    midiRange:
      finalBassNotes.length > 0
        ? {
            minMidi: minFound,
            maxMidi: maxFound,
            minName: midiNoteToName(minFound),
            maxName: midiNoteToName(maxFound),
          }
        : undefined,
    counts: {
      total: finalBassNotes.length,
      kick: 0,
      snare: 0,
      hat: 0,
      crash: 0,
      tom: 0,
      notes: finalBassNotes.length,
    },
  };
}
