/**
 * chordDetectorDSP.ts
 * Motor DSP Local de Detección Armónica Cromática y Sincronización de Grilla en RAM.
 * Funciona 100% en el navegador sobre cualquier AudioBuffer (Master o Stem armónico)
 * sin depender de servidores externos.
 */

import { repairAndRelockBeatGrid } from './beatGridDSP';

export interface DetectedChordItem {
  time: number;
  chord: string;
}

export interface LocalChordDetectionResult {
  bpm: number;
  firstBeatOffset: number;
  beatTimes: number[];
  downbeats: number[];
  key: string;
  chords: DetectedChordItem[];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const CHROMATIC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHROMATIC_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function transposeSingleNote(note: string, semitones: number, preferFlatsHint?: boolean): string {
  let idx = CHROMATIC_SHARP.indexOf(note);
  const preferFlats = preferFlatsHint ?? note.includes('b');
  if (idx === -1) idx = CHROMATIC_FLAT.indexOf(note);
  if (idx === -1) return note;
  const nextIdx = (((idx + semitones) % 12) + 12) % 12;
  return preferFlats ? CHROMATIC_FLAT[nextIdx] : CHROMATIC_SHARP[nextIdx];
}

/**
 * Transpone un símbolo de acorde (ej. "Cmaj7", "CMAJ7", "F#m7b5/C#", "Ebdim", "Gadd9")
 * afectando únicamente la fundamental inicial y el bajo opcional tras '/', sin corromper
 * letras A-G que formen parte del sufijo ("MAJ", "DIM", "AUG", "ADD").
 */
export function transposeChordSymbol(chord: string, semitones: number): string {
  if (!chord) return chord;
  const trimmed = chord.trim();
  if (!trimmed || trimmed === 'N' || trimmed === 'NC') return chord;
  const preferFlats = trimmed.includes('b');
  return trimmed.replace(
    /^([A-G][#b]?)(.*?)(\/([A-G][#b]?))?$/,
    (_full, root: string, quality: string, slashPart?: string, bassNote?: string) => {
      const nextRoot = transposeSingleNote(root, semitones, preferFlats);
      const nextSlash =
        slashPart && bassNote
          ? `/${transposeSingleNote(bassNote, semitones, preferFlats)}`
          : slashPart || '';
      return `${nextRoot}${quality}${nextSlash}`;
    }
  );
}

interface ChordTemplate {
  suffix: string;
  intervals: number[];
  weights: number[];
  bias: number;
}

const CHORD_TEMPLATES: ChordTemplate[] = [
  { suffix: '', intervals: [0, 4, 7], weights: [1.0, 0.85, 0.9], bias: 1.04 },
  { suffix: 'm', intervals: [0, 3, 7], weights: [1.0, 0.88, 0.9], bias: 1.03 },
  { suffix: '7', intervals: [0, 4, 7, 10], weights: [1.0, 0.8, 0.75, 0.75], bias: 0.96 },
  { suffix: 'm7', intervals: [0, 3, 7, 10], weights: [1.0, 0.82, 0.75, 0.72], bias: 0.96 },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], weights: [1.0, 0.8, 0.75, 0.72], bias: 0.95 },
  { suffix: 'sus4', intervals: [0, 5, 7], weights: [1.0, 0.85, 0.88], bias: 0.94 },
  { suffix: 'dim', intervals: [0, 3, 6], weights: [1.0, 0.88, 0.88], bias: 0.92 },
  { suffix: 'add9', intervals: [0, 4, 7, 2], weights: [1.0, 0.82, 0.8, 0.68], bias: 0.91 },
];

// Perfiles Krumhansl-Kessler para estimar tonalidad global y favorecer acordes diatónicos
const MAJOR_KEY_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_KEY_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Calcula la energía espectral en una frecuencia exacta (DTFT / Generalized Goertzel) con ventana Hann,
 * evitando la cuantización de bin entero que colapsaba semitonos graves en la octava 2.
 */
function goertzelMagnitude(
  samples: Float32Array,
  startIdx: number,
  length: number,
  targetFreq: number,
  sampleRate: number
): number {
  if (targetFreq <= 20 || targetFreq >= sampleRate * 0.48 || length < 32) return 0;
  const omega = (2 * Math.PI * targetFreq) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;

  for (let i = 0; i < length; i++) {
    // Ventana Hann rápida
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
    const x = samples[startIdx + i] * w;
    const s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / length;
}

/**
 * Extrae el vector cromático de 12 notas (C..B) en una ventana de audio [startSec, endSec].
 * Evalúa hasta 2 sub-ventanas (evitando el ataque percusivo inicial) para robustez ante articulaciones.
 */
export function computeChromaVector(
  monoSamples: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number
): Float32Array {
  const chroma = new Float32Array(12);
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(monoSamples.length, Math.floor(endSec * sampleRate));
  const totalLen = endSample - startSample;
  if (totalLen < 512) return chroma;

  // Escalado proporcional a sampleRate (~0.34s) para resolver semitonos graves (C2 vs C#2 = 3.89 Hz) a 44.1/48 kHz
  const targetWindowSamples = Math.min(16384, Math.max(4096, Math.round(sampleRate * 0.34)));
  const analysisLen = Math.min(totalLen, targetWindowSamples);
  const offsets =
    totalLen > analysisLen * 1.4
      ? [
          startSample + Math.floor((totalLen - analysisLen) * 0.22),
          startSample + Math.floor((totalLen - analysisLen) * 0.62),
        ]
      : [startSample + Math.floor((totalLen - analysisLen) * 0.35)];

  let validSubWindows = 0;
  for (const offsetSample of offsets) {
    let rms = 0;
    for (let i = 0; i < analysisLen; i++) {
      const v = monoSamples[offsetSample + i];
      rms += v * v;
    }
    rms = Math.sqrt(rms / analysisLen);
    if (rms < 1e-4) continue;
    validSubWindows++;

    // Evaluar octavas 2, 3, 4 y 5 (MIDI 36 = C2 a MIDI 83 = B5)
    for (let pc = 0; pc < 12; pc++) {
      let pcEnergy = 0;
      for (let octave = 2; octave <= 5; octave++) {
        const midi = (octave + 1) * 12 + pc;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const octWeight = octave === 3 || octave === 4 ? 1.0 : 0.65;
        const magFund = goertzelMagnitude(monoSamples, offsetSample, analysisLen, freq, sampleRate);
        pcEnergy += magFund * octWeight;
      }
      chroma[pc] += pcEnergy;
    }
  }

  if (validSubWindows === 0) return chroma;

  // Normalización L2
  let norm = 0;
  for (let i = 0; i < 12; i++) norm += chroma[i] * chroma[i];
  norm = Math.sqrt(norm);
  if (norm > 1e-6) {
    for (let i = 0; i < 12; i++) chroma[i] /= norm;
  }

  return chroma;
}

/**
 * Estima la tonalidad global (ej. "C", "Am") y devuelve las clases de altura diatónicas a partir del cromagrama acumulado.
 */
function estimateGlobalKey(globalChroma: Float32Array): { keyName: string; rootPc: number; isMinor: boolean; diatonicSet: Set<number> } {
  let bestScore = -Infinity;
  let bestRoot = 0;
  let bestMinor = false;

  for (let root = 0; root < 12; root++) {
    let majScore = 0;
    let minScore = 0;
    for (let i = 0; i < 12; i++) {
      const pc = (root + i) % 12;
      majScore += globalChroma[pc] * MAJOR_KEY_PROFILE[i];
      minScore += globalChroma[pc] * MINOR_KEY_PROFILE[i];
    }
    if (majScore > bestScore) {
      bestScore = majScore;
      bestRoot = root;
      bestMinor = false;
    }
    if (minScore > bestScore) {
      bestScore = minScore;
      bestRoot = root;
      bestMinor = true;
    }
  }

  const scaleIntervals = bestMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const diatonicSet = new Set<number>(scaleIntervals.map((iv) => (bestRoot + iv) % 12));
  const keyName = `${NOTE_NAMES[bestRoot]}${bestMinor ? 'm' : ''}`;

  return { keyName, rootPc: bestRoot, isMinor: bestMinor, diatonicSet };
}

/**
 * Clasifica el mejor acorde para un vector cromático dado, considerando el contexto diatónico.
 */
function classifyChordFromChroma(
  chroma: Float32Array,
  diatonicSet: Set<number>
): string {
  let energySum = 0;
  for (let i = 0; i < 12; i++) energySum += chroma[i];
  if (energySum < 0.05) return '';

  let bestChord = '';
  let bestScore = -Infinity;

  for (let root = 0; root < 12; root++) {
    const isDiatonicRoot = diatonicSet.has(root);

    for (const tpl of CHORD_TEMPLATES) {
      let matchSum = 0;
      let weightSum = 0;
      const chordPcs = new Set<number>();

      for (let idx = 0; idx < tpl.intervals.length; idx++) {
        const pc = (root + tpl.intervals[idx]) % 12;
        chordPcs.add(pc);
        const w = tpl.weights[idx];
        matchSum += chroma[pc] * w;
        weightSum += w;
      }

      // Penalizar energía fuera de las notas del acorde
      let penalty = 0;
      for (let pc = 0; pc < 12; pc++) {
        if (!chordPcs.has(pc)) {
          penalty += chroma[pc] * 0.22;
        }
      }

      const thirdPc = (root + tpl.intervals[1]) % 12;
      const fifthPc = (root + tpl.intervals[2]) % 12;
      const isDiatonicTriad = isDiatonicRoot && diatonicSet.has(thirdPc) && diatonicSet.has(fifthPc);
      const diatonicBonus = isDiatonicTriad ? 1.07 : isDiatonicRoot ? 1.02 : 0.96;

      const rawScore = ((matchSum / weightSum) - penalty / 12) * tpl.bias * diatonicBonus;
      if (rawScore > bestScore) {
        bestScore = rawScore;
        bestChord = `${NOTE_NAMES[root]}${tpl.suffix}`;
      }
    }
  }

  return bestChord;
}

/**
 * Analiza un AudioBuffer localmente en RAM y extrae BPM, firstBeatOffset, beatTimes y acordes cuantizados.
 */
export function detectChordsAndBeatsLocalDSP(
  audioBuffer: AudioBuffer,
  existingPrompterData?: {
    bpm?: number;
    timeSignature?: string;
    firstBeatOffset?: number;
    beatTimes?: number[];
  }
): LocalChordDetectionResult {
  const sr = audioBuffer.sampleRate;
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  const mono = new Float32Array(ch0.length);

  for (let i = 0; i < ch0.length; i++) {
    mono[i] = ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i];
  }

  const timeSignature = existingPrompterData?.timeSignature || '4/4';
  const beatsPerBar = parseInt(timeSignature.split('/')[0], 10) || 4;
  const initialBpm = Number(existingPrompterData?.bpm) || 120;

  const repaired = repairAndRelockBeatGrid({
    rawBeats: existingPrompterData?.beatTimes || [],
    rawDownbeats:
      existingPrompterData?.firstBeatOffset !== undefined
        ? [Number(existingPrompterData.firstBeatOffset)]
        : [],
    rawBpm: initialBpm,
    timeSignature,
    masterBuffer: audioBuffer,
    referenceTrackName: 'Master Local DSP',
  });

  const bpm = repaired.bpm > 0 ? repaired.bpm : initialBpm;
  const beatTimes =
    repaired.beatTimes && repaired.beatTimes.length > 1
      ? repaired.beatTimes
      : (() => {
          const interval = 60 / bpm;
          const list: number[] = [];
          for (let t = repaired.firstBeatOffset || 0; t < audioBuffer.duration; t += interval) {
            list.push(Number(t.toFixed(4)));
          }
          return list;
        })();

  // Paso 1: Construir ventanas de análisis armónico cada 2 pulsos (medio compás en 4/4) o cada compás
  const stepBeats = Math.max(1, Math.floor(beatsPerBar / 2));
  const windowPoints: { time: number; endTime: number; chroma: Float32Array }[] = [];
  const globalChroma = new Float32Array(12);

  for (let i = 0; i < beatTimes.length; i += stepBeats) {
    const startSec = beatTimes[i];
    const nextIdx = Math.min(beatTimes.length - 1, i + stepBeats);
    const endSec =
      nextIdx > i
        ? beatTimes[nextIdx]
        : Math.min(audioBuffer.duration, startSec + (60 / bpm) * stepBeats);

    if (endSec - startSec < 0.12) continue;
    const chroma = computeChromaVector(mono, sr, startSec, endSec);
    for (let pc = 0; pc < 12; pc++) {
      globalChroma[pc] += chroma[pc];
    }
    windowPoints.push({ time: startSec, endTime: endSec, chroma });
  }

  const { keyName, diatonicSet } = estimateGlobalKey(globalChroma);

  // Paso 2: Clasificar cada ventana y aplicar filtro de estabilidad temporal
  const rawLabels = windowPoints.map((w) => classifyChordFromChroma(w.chroma, diatonicSet));
  const smoothedLabels = rawLabels.map((lbl, idx, arr) => {
    if (!lbl) return '';
    const prev = idx > 0 ? arr[idx - 1] : lbl;
    const next = idx < arr.length - 1 ? arr[idx + 1] : lbl;
    // Si una ventana aislada cambia y vuelve inmediatamente al acorde anterior, suavizar el parpadeo
    if (prev && prev === next && lbl !== prev) {
      return prev;
    }
    return lbl;
  });

  const chords: DetectedChordItem[] = [];
  let lastChord = '';
  for (let i = 0; i < windowPoints.length; i++) {
    const chord = smoothedLabels[i];
    if (!chord) continue;
    if (chord !== lastChord) {
      chords.push({
        time: Number(windowPoints[i].time.toFixed(3)),
        chord,
      });
      lastChord = chord;
    }
  }

  return {
    bpm,
    firstBeatOffset: repaired.firstBeatOffset,
    beatTimes,
    downbeats: repaired.downbeats,
    key: keyName,
    chords,
  };
}
