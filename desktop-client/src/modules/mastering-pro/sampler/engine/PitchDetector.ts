/**
 * YIN Fundamental Pitch Detection algorithm (35 Hz - 2000 Hz)
 * with parabolic sub-sample interpolation, transient-skip steady-body sampling,
 * and octave-halving verification for accurate root-note assignment.
 */

export interface PitchEstimate {
  freqHz: number;
  midiNote: number;
  noteName: string;
  centsOffset: number;
  confidence: number; // 0..1
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiNoteToName(midi: number): string {
  const rounded = Math.max(0, Math.min(127, Math.round(midi)));
  const note = NOTE_NAMES[rounded % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${note}${octave}`;
}

function runYinSingleWindow(
  x: Float32Array,
  sampleRate: number,
  minFreqHz: number,
  maxFreqHz: number
): PitchEstimate {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreqHz));
  const tauMax = Math.min(Math.floor(x.length / 2) - 2, Math.ceil(sampleRate / minFreqHz));
  if (tauMax <= tauMin) {
    return { freqHz: 261.63, midiNote: 60, noteName: 'C4', centsOffset: 0, confidence: 0 };
  }

  const diff = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < tauMax; j++) {
      const d = x[j] - x[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalized difference function
  const cmndf = new Float32Array(tauMax + 1);
  cmndf[0] = 1.0;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 1e-12 ? (diff[tau] * tau) / runningSum : 1.0;
  }

  // Absolute threshold search (0.15 standard YIN threshold)
  const threshold = 0.15;
  let bestTau = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 <= tauMax && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  // Fallback to global minimum if threshold wasn't crossed
  if (bestTau === -1) {
    let minVal = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        bestTau = tau;
      }
    }
  }

  if (bestTau <= 0) {
    return { freqHz: 261.63, midiNote: 60, noteName: 'C4', centsOffset: 0, confidence: 0 };
  }

  // Octave-halving guard for plucked strings / bright harmonics:
  // If bestTau * 2 is also inside range and has dramatically deeper periodicity, prefer true fundamental
  const doubleTau = bestTau * 2;
  if (doubleTau + 1 < tauMax && cmndf[bestTau] > 0.05) {
    let localMinTau = doubleTau;
    for (let t = Math.max(tauMin, doubleTau - 2); t <= Math.min(tauMax, doubleTau + 2); t++) {
      if (cmndf[t] < cmndf[localMinTau]) localMinTau = t;
    }
    if (cmndf[localMinTau] < cmndf[bestTau] * 0.58) {
      bestTau = localMinTau;
    }
  }

  // Parabolic interpolation around bestTau
  let refinedTau = bestTau;
  if (bestTau > tauMin && bestTau < tauMax) {
    const s0 = cmndf[bestTau - 1];
    const s1 = cmndf[bestTau];
    const s2 = cmndf[bestTau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-9) {
      refinedTau += (s2 - s0) / denom;
    }
  }

  const freqHz = Number((sampleRate / Math.max(1, refinedTau)).toFixed(2));
  const exactMidi = 69 + 12 * Math.log2(freqHz / 440);
  const midiNote = Math.max(0, Math.min(127, Math.round(exactMidi)));
  const centsOffset = Math.round((exactMidi - midiNote) * 100);
  const confidence = Number(Math.max(0, Math.min(1, 1 - cmndf[bestTau])).toFixed(2));

  return {
    freqHz,
    midiNote,
    noteName: midiNoteToName(midiNote),
    centsOffset,
    confidence,
  };
}

export function detectPitchYin(
  monoSamples: Float32Array,
  sampleRate: number,
  minFreqHz = 35,
  maxFreqHz = 2000
): PitchEstimate {
  const maxWin = Math.min(
    monoSamples.length,
    Math.max(4096, Math.round(sampleRate * 0.09))
  );
  if (maxWin < 512) {
    return { freqHz: 261.63, midiNote: 60, noteName: 'C4', centsOffset: 0, confidence: 0 };
  }

  // Fast direct single-frame path for per-frame sliding analysis
  if (monoSamples.length <= maxWin + Math.round(sampleRate * 0.025)) {
    const startOff = Math.max(0, Math.floor((monoSamples.length - maxWin) * 0.5));
    return runYinSingleWindow(
      monoSamples.subarray(startOff, startOff + maxWin),
      sampleRate,
      minFreqHz,
      maxFreqHz
    );
  }

  // Multi-window steady-body consensus for full samples/regions:
  // Avoid noisy attack transient by picking active windows after the initial peak
  let globalMax = 0;
  let globalPeakIdx = 0;
  const probeLim = Math.min(monoSamples.length, Math.round(sampleRate * 0.6));
  for (let i = 0; i < probeLim; i++) {
    const a = Math.abs(monoSamples[i]);
    if (a > globalMax) {
      globalMax = a;
      globalPeakIdx = i;
    }
  }

  const attackSkip = Math.min(
    Math.max(0, monoSamples.length - maxWin),
    globalPeakIdx + Math.round(sampleRate * 0.022)
  );
  const availSpan = monoSamples.length - maxWin - attackSkip;

  const candidates: Array<{ est: PitchEstimate; score: number }> = [];
  const numOffsets = availSpan >= maxWin * 0.5 ? 3 : 1;
  for (let idx = 0; idx < numOffsets; idx++) {
    const off =
      numOffsets === 1
        ? attackSkip
        : attackSkip + Math.floor((idx / (numOffsets - 1)) * Math.min(availSpan, Math.round(sampleRate * 0.45)));
    const slice = monoSamples.subarray(off, off + maxWin);
    let sq = 0;
    for (let i = 0; i < maxWin; i += 4) sq += slice[i] * slice[i];
    const rms = Math.sqrt(sq / (maxWin / 4));
    if (rms < globalMax * 0.03) continue;
    const est = runYinSingleWindow(slice, sampleRate, minFreqHz, maxFreqHz);
    candidates.push({ est, score: est.confidence * (0.4 + 0.6 * Math.min(1, rms / Math.max(1e-4, globalMax))) });
  }

  if (candidates.length === 0) {
    // Fallback to highest-energy window if sustain decayed very fast
    let bestOffset = 0;
    let bestEnergy = -1;
    const step = Math.max(256, Math.floor((monoSamples.length - maxWin) / 8));
    for (let off = 0; off <= monoSamples.length - maxWin; off += step) {
      let e = 0;
      for (let i = 0; i < maxWin; i += 4) e += monoSamples[off + i] * monoSamples[off + i];
      if (e > bestEnergy) {
        bestEnergy = e;
        bestOffset = off;
      }
    }
    return runYinSingleWindow(
      monoSamples.subarray(bestOffset, bestOffset + maxWin),
      sampleRate,
      minFreqHz,
      maxFreqHz
    );
  }

  // Consensus voting by MIDI pitch (prevents transient glitch frame from winning)
  candidates.sort((a, b) => b.score - a.score);
  let bestGroupScore = -1;
  let winner = candidates[0].est;
  for (const c of candidates) {
    let grpScore = 0;
    for (const o of candidates) {
      if (Math.abs(o.est.midiNote - c.est.midiNote) <= 0) {
        grpScore += o.score;
      }
    }
    if (grpScore > bestGroupScore) {
      bestGroupScore = grpScore;
      winner = c.est;
    }
  }
  return winner;
}
