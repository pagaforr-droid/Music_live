/**
 * YIN Fundamental Pitch Detection algorithm (50 Hz - 2000 Hz)
 * with parabolic sub-sample interpolation for accurate chromatic root-note assignment.
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

export function detectPitchYin(
  monoSamples: Float32Array,
  sampleRate: number,
  minFreqHz = 50,
  maxFreqHz = 2000
): PitchEstimate {
  const maxWin = Math.min(monoSamples.length, 4096);
  if (maxWin < 512) {
    return { freqHz: 261.63, midiNote: 60, noteName: 'C4', centsOffset: 0, confidence: 0 };
  }

  // Pick a high-energy window inside the region
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

  const x = monoSamples.subarray(bestOffset, bestOffset + maxWin);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreqHz));
  const tauMax = Math.min(Math.floor(maxWin / 2) - 2, Math.ceil(sampleRate / minFreqHz));
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

  // Absolute threshold search
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
