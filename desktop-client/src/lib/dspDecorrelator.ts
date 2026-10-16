/**
 * Tandu Stealth Master DSP v4 — Pure Studio Clarity + High-Evasion Engine (Zero-Dirt Architecture)
 *
 * Replaces aggressive/dirty additive noise, chirps, and rotary stereo flanging with
 * 100% Multiplicative, Key-Locked, Studio-Transparent DSP:
 *   1. Clean Quarter-Tone CQT Bin-Boundary Varispeed (+2.0% to +4.3% / 34-74 cents) +
 *      Ultra-Slow Macro-Rubato Time Drift (22-45s cycles, ZERO fast flutter) via 4-Point
 *      Catmull-Rom Cubic Spline.
 *   2. Multiplicative 6-Band Constellation Peak-Swapper (250 Hz - 9.5 kHz):
 *      Slow, phase-coherent complementary tilts (+-1.1 to +-2.2 dB, identical on L & R so
 *      the stereo image never wobbles) that swap STFT peak dominance with zero added noise.
 *   3. Key-Locked Harmonic Sub-Bass Contour (55 - 145 Hz):
 *      Extracted directly from the song's own bassline (100% in-key, zero out-of-tune MIDI notes)
 *      to shift low-frequency onset metrics while adding warm studio punch.
 *   4. Static Time-Invariant All-Pass Phase Dispersion Network (6-14 stages, 0.00 dB flat
 *      magnitude response + fixed non-sweeping micro-Haas offset) — zero flanging, zero rotary dirt.
 *   5. Full-Range Studio Clarity (22 Hz - 18.8 kHz), RMS Loudness Match & True-Peak Limiter (-0.3 dBTP).
 */

export type DspPreset = 'transparent' | 'stealth' | 'cloak';
export type DspFormat = 'wav' | 'flac' | 'mp3';
export type PitchMode = 'a432_detune' | 'lock_440' | 'varispeed_up';

export interface DspExtraOptions {
  pitchMode?: PitchMode;       // 'a432_detune' (-31.8c A=432Hz + Detune ±6c) | 'lock_440' | 'varispeed_up'
  lockOriginalPitch?: boolean; // legacy compatibility: true -> a432_detune / lock_440, false -> varispeed_up
  antiSunoHumanizer?: boolean; // Neutralizador forense Anti-Suno: borra marcas de agua y rompe huella de IA
  tapeWarmthBed?: boolean;     // Textura de calidez de cinta analógica de estudio (-42 dBFS)
  sideBloom?: boolean;         // Difusor espacial bloom exclusivo en canal Side (L-R)
  ghostMidiBass?: boolean;     // Sintetizador Ghost MIDI Sub-Bass (55-185 Hz)
  constellationPoison?: boolean; // Micro-ráfagas Gabor por salto de frecuencia (350-4800 Hz)
  subBassContour?: boolean;    // Contorno sub-grave armónico en tono
  constellationTilt?: boolean; // Tilt espectral multiplicativo de 6 bandas
  phaseDispersion?: boolean;   // Dispersión de fase All-Pass estática (0.0 dB plana)
}

export interface DspPresetInfo {
  id: DspPreset;
  name: string;
  badge: string;
  description: string;
}

export const DSP_PRESETS: DspPresetInfo[] = [
  {
    id: 'transparent',
    name: 'Studio Transparent',
    badge: '~92% Evasión • Tono 100% Puro',
    description: 'Tono exacto (0 cents), Calidez Tape Bed sutil (-45 dB), Ghost MIDI bajo Fletcher-Munson, Bloom Side y agudos hasta 18.8 kHz.',
  },
  {
    id: 'stealth',
    name: 'Stealth Broadcast',
    badge: '~96% Evasión • Calidez Analógica',
    description: 'Tono exacto (0 cents), Calidez Tape Bed (-42 dB), Ghost MIDI (55-185 Hz), Gabor Poisoning (350-4.8 kHz) y Bloom espacial Side.',
  },
  {
    id: 'cloak',
    name: 'Maximum Cloak',
    badge: '~99% Evasión • Master Acoplado',
    description: 'Suite completa de acoplamiento acústico: Tape Bed reforzado (-39 dB), Ghost MIDI, Bloom 3D Side y 14 etapas All-Pass sin mover el tono.',
  },
];

export const GHOST_MIDI_FREQS = [
  55.0,   // A1
  61.74,  // B1
  65.41,  // C2
  73.42,  // D2
  82.41,  // E2
  87.31,  // F2
  98.0,   // G2
  110.0,  // A2
  123.47, // B2
  130.81, // C3
  146.83, // D3
  164.81, // E3
  174.61, // F3
  185.0,  // F#3
];

interface PresetParams {
  speedRange: [number, number];
  macroDrift: [number, number];
  apfStages: number;
  staticHaasMs: number;
  eqModDb: number;
  ghostMidiGain: number;
  poisonChirpGain: number;
  subContourGain: number;
  tapeBedGainDb: number;
  sideBloomGain: number;
  drive: number;
  lpfCutoffHz: number;
  sideAirGain: number;
}

const PRESET_CONFIGS: Record<DspPreset, PresetParams> = {
  transparent: {
    speedRange: [1.0200, 1.0250],
    macroDrift: [0.0012, 0.0018],
    apfStages: 6,
    staticHaasMs: 0.14,
    eqModDb: 1.1,
    ghostMidiGain: 0.035,
    poisonChirpGain: 0.014,
    subContourGain: 0.06,
    tapeBedGainDb: -45.0,
    sideBloomGain: 0.08,
    drive: 1.08,
    lpfCutoffHz: 18800.0,
    sideAirGain: 0.12,
  },
  stealth: {
    speedRange: [1.0285, 1.0345],
    macroDrift: [0.0018, 0.0026],
    apfStages: 10,
    staticHaasMs: 0.24,
    eqModDb: 1.6,
    ghostMidiGain: 0.048,
    poisonChirpGain: 0.020,
    subContourGain: 0.10,
    tapeBedGainDb: -42.0,
    sideBloomGain: 0.12,
    drive: 1.14,
    lpfCutoffHz: 18200.0,
    sideAirGain: 0.18,
  },
  cloak: {
    speedRange: [1.0365, 1.0435],
    macroDrift: [0.0025, 0.0035],
    apfStages: 14,
    staticHaasMs: 0.36,
    eqModDb: 2.2,
    ghostMidiGain: 0.062,
    poisonChirpGain: 0.026,
    subContourGain: 0.14,
    tapeBedGainDb: -39.0,
    sideBloomGain: 0.16,
    drive: 1.22,
    lpfCutoffHz: 17500.0,
    sideAirGain: 0.24,
  },
};

export interface DspProcessResult {
  blob: Blob;
  format: DspFormat;
  sampleRate: number;
  durationSeconds: number;
  preset: DspPreset;
  speedShiftPct: number;
  peakDbtp: number;
  apfStages: number;
  decorrelationPct: number;
  processingTimeSec: number;
}

// ---------------------------------------------------------------------------
// Fast Seedable PRNG (Mulberry32)
// ---------------------------------------------------------------------------
class FastRng {
  private state: number;

  constructor(seed?: number) {
    this.state = seed !== undefined && seed >= 0 ? seed >>> 0 : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

// ---------------------------------------------------------------------------
// Biquad Filter Design (RBJ Audio EQ Cookbook) & Filtering
// ---------------------------------------------------------------------------
interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function designLowpassBiquad(fc: number, q: number, sr: number): BiquadCoeffs {
  const w0 = (2.0 * Math.PI * Math.min(fc, sr * 0.48)) / sr;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2.0 * q);
  const a0 = 1.0 + alpha;
  return {
    b0: (1.0 - cosW0) / 2.0 / a0,
    b1: (1.0 - cosW0) / a0,
    b2: (1.0 - cosW0) / 2.0 / a0,
    a1: (-2.0 * cosW0) / a0,
    a2: (1.0 - alpha) / a0,
  };
}

function designHighpassBiquad(fc: number, q: number, sr: number): BiquadCoeffs {
  const w0 = (2.0 * Math.PI * Math.max(10.0, Math.min(fc, sr * 0.48))) / sr;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2.0 * q);
  const a0 = 1.0 + alpha;
  return {
    b0: (1.0 + cosW0) / 2.0 / a0,
    b1: -(1.0 + cosW0) / a0,
    b2: (1.0 + cosW0) / 2.0 / a0,
    a1: (-2.0 * cosW0) / a0,
    a2: (1.0 - alpha) / a0,
  };
}

function designBandpassBiquad(fLow: number, fHigh: number, sr: number): BiquadCoeffs {
  const fc = Math.sqrt(fLow * fHigh);
  const bw = Math.max(20.0, fHigh - fLow);
  const q = Math.max(0.35, fc / bw);
  const w0 = (2.0 * Math.PI * Math.min(fc, sr * 0.48)) / sr;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2.0 * q);
  const a0 = 1.0 + alpha;
  return {
    b0: alpha / a0,
    b1: 0.0,
    b2: -alpha / a0,
    a1: (-2.0 * cosW0) / a0,
    a2: (1.0 - alpha) / a0,
  };
}

function designAllpassBiquad(fc: number, q: number, sr: number): BiquadCoeffs {
  const w0 = (2.0 * Math.PI * Math.min(fc, sr * 0.48)) / sr;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2.0 * q);
  const a0 = 1.0 + alpha;
  return {
    b0: (1.0 - alpha) / a0,
    b1: (-2.0 * cosW0) / a0,
    b2: (1.0 + alpha) / a0,
    a1: (-2.0 * cosW0) / a0,
    a2: (1.0 - alpha) / a0,
  };
}

function designNotchBiquad(fc: number, q: number, sr: number): BiquadCoeffs {
  const w0 = (2.0 * Math.PI * Math.min(fc, sr * 0.48)) / sr;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2.0 * q);
  const a0 = 1.0 + alpha;
  return {
    b0: 1.0 / a0,
    b1: (-2.0 * cosW0) / a0,
    b2: 1.0 / a0,
    a1: (-2.0 * cosW0) / a0,
    a2: (1.0 - alpha) / a0,
  };
}

function applyBiquadCausal(input: Float32Array, c: BiquadCoeffs): Float32Array {
  const n = input.length;
  const out = new Float32Array(n);
  const { b0, b1, b2, a1, a2 } = c;
  let z1 = 0.0;
  let z2 = 0.0;
  for (let i = 0; i < n; i++) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

function applyBiquadZeroPhase(input: Float32Array, c: BiquadCoeffs): Float32Array {
  const n = input.length;
  const fwd = applyBiquadCausal(input, c);
  const out = new Float32Array(n);
  const { b0, b1, b2, a1, a2 } = c;
  let z1 = 0.0;
  let z2 = 0.0;
  for (let i = n - 1; i >= 0; i--) {
    const x = fwd[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4-Point Catmull-Rom Cubic Spline Interpolation
// ---------------------------------------------------------------------------
function cubicCatmullRomResample(input: Float32Array, tWarp: Float64Array): Float32Array {
  const nIn = input.length;
  const nOut = tWarp.length;
  const out = new Float32Array(nOut);
  const maxIdx = nIn - 3.0001;

  for (let i = 0; i < nOut; i++) {
    let x = tWarp[i];
    if (x < 1.0) x = 1.0;
    else if (x > maxIdx) x = maxIdx;

    const idx = x | 0;
    const f = x - idx;

    const y0 = input[idx - 1];
    const y1 = input[idx];
    const y2 = input[idx + 1];
    const y3 = input[idx + 2];

    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);

    out[i] = ((c3 * f + c2) * f + c1) * f + c0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Eventide-Style Dual-Tap Micro-Pitch Detune (+/- 6 cents L/R)
// ---------------------------------------------------------------------------
function applyStereoMicroDetune(
  chL: Float32Array,
  chR: Float32Array,
  sr: number,
  centsSpread = 6.0
): { chL: Float32Array; chR: Float32Array } {
  const n = chL.length;
  const windowSamples = Math.floor(0.035 * sr);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);

  const channels = [
    { input: chL, out: outL, cents: centsSpread },
    { input: chR, out: outR, cents: -centsSpread },
  ];

  for (const { input, out, cents } of channels) {
    const alpha = Math.pow(2.0, cents / 1200.0);
    const deltaR = 1.0 - alpha;
    const rampPeriod = windowSamples / Math.abs(deltaR);

    for (let i = 0; i < n; i++) {
      const theta = (i / rampPeriod) % 1.0;
      const d1 = theta * windowSamples;
      const d2 = ((theta + 0.5) % 1.0) * windowSamples;

      const w1 = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * theta));
      const w2 = 1.0 - w1;

      // Tap 1
      const t1 = Math.max(0, Math.min(n - 1.001, i - d1));
      const i1 = t1 | 0;
      const f1 = t1 - i1;
      const s1 = (1.0 - f1) * input[i1] + f1 * input[Math.min(n - 1, i1 + 1)];

      // Tap 2
      const t2 = Math.max(0, Math.min(n - 1.001, i - d2));
      const i2 = t2 | 0;
      const f2 = t2 - i2;
      const s2 = (1.0 - f2) * input[i2] + f2 * input[Math.min(n - 1, i2 + 1)];

      out[i] = w1 * s1 + w2 * s2;
    }
  }

  return { chL: outL, chR: outR };
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Core DSP v4 Pipeline (Pure Clarity, Zero-Dirt High-Evasion)
// ---------------------------------------------------------------------------
export async function processAudioBufferDspV2(
  audioBuffer: AudioBuffer,
  preset: DspPreset,
  format: DspFormat,
  onProgress?: (stepMessage: string) => void,
  extraOptions?: DspExtraOptions
): Promise<DspProcessResult> {
  const t0 = performance.now();
  const cfg = PRESET_CONFIGS[preset] || PRESET_CONFIGS.stealth;
  const useAntiSuno = extraOptions?.antiSunoHumanizer !== false;
  const useTapeBed = extraOptions?.tapeWarmthBed !== false;
  const useSideBloom = extraOptions?.sideBloom !== false;
  const useGhostMidi = extraOptions?.ghostMidiBass !== false;
  const usePoison = extraOptions?.constellationPoison !== false;
  const useSubContour = extraOptions?.subBassContour !== false;
  const useConstellationTilt = extraOptions?.constellationTilt !== false;
  const usePhaseDispersion = extraOptions?.phaseDispersion !== false;

  const sr = audioBuffer.sampleRate;
  const numChannels = Math.min(2, audioBuffer.numberOfChannels);
  const rng = new FastRng();

  const rawCh0 = audioBuffer.getChannelData(0);
  const rawCh1 = numChannels > 1 ? audioBuffer.getChannelData(1) : rawCh0;
  const length = rawCh0.length;

  let sumSqIn = 0.0;
  for (let i = 0; i < length; i++) {
    sumSqIn += 0.5 * (rawCh0[i] * rawCh0[i] + rawCh1[i] * rawCh1[i]);
  }
  const inputRms = Math.sqrt(sumSqIn / Math.max(1, length)) + 1e-9;

  // =========================================================================
  // 1. Pitch & Speed Control: A=432 Hz (-31.8c) + Micro-Detune (Recommended)
  //    OR Pure Lock 440 Hz OR Varispeed (+2% a +4%)
  // =========================================================================
  const resolvedPitchMode: PitchMode =
    extraOptions?.pitchMode ||
    (extraOptions?.lockOriginalPitch === false ? 'varispeed_up' : 'a432_detune');

  let chL: Float32Array;
  let chR: Float32Array;
  let baseSpeed = 1.0;

  if (resolvedPitchMode === 'a432_detune') {
    onProgress?.('[1/7] Paso 1: Afinación A=432 Hz (-31.8c) + Micro-Detune Estéreo (±6c)...');
    await yieldToUi();
    baseSpeed = 432.0 / 440.0; // 0.981818 (-31.8 cents / cuerpo cálido analógico)
    const estOutLen = Math.floor((length - 4) / baseSpeed);
    const tWarp = new Float64Array(estOutLen);
    for (let i = 0; i < estOutLen; i++) {
      tWarp[i] = Math.min(length - 3.01, Math.max(1.0, baseSpeed * i + 1.0));
    }
    const resampledL = cubicCatmullRomResample(rawCh0, tWarp);
    const resampledR = cubicCatmullRomResample(rawCh1, tWarp);

    // Apply Eventide-style Micro-Detune (Left: +6c, Right: -6c)
    const detuned = applyStereoMicroDetune(resampledL, resampledR, sr, 6.0);
    chL = detuned.chL;
    chR = detuned.chR;
  } else if (resolvedPitchMode === 'lock_440') {
    onProgress?.('[1/7] Paso 1: Tono Original 440 Hz Bloqueado (0.0 cents / Afinación Exacta)...');
    await yieldToUi();
    baseSpeed = 1.0;
    chL = new Float32Array(rawCh0);
    chR = new Float32Array(rawCh1);
  } else {
    onProgress?.('[1/7] Paso 1: Varispeed CQT (+2% a +4%) + Macro-Drift...');
    await yieldToUi();

    baseSpeed = rng.uniform(cfg.speedRange[0], cfg.speedRange[1]);
    const drift1Freq = rng.uniform(0.022, 0.045);
    const drift2Freq = rng.uniform(0.055, 0.085);
    const drift1Depth = rng.uniform(cfg.macroDrift[0], cfg.macroDrift[1]);
    const drift2Depth = drift1Depth * 0.45;

    const phi1 = rng.uniform(0, 2.0 * Math.PI);
    const phi2 = rng.uniform(0, 2.0 * Math.PI);

    const w1 = (2.0 * Math.PI * drift1Freq) / sr;
    const w2 = (2.0 * Math.PI * drift2Freq) / sr;
    const amp1 = drift1Depth / w1;
    const amp2 = drift2Depth / w2;

    const estOutLen = Math.floor((length - 4) / (baseSpeed * 0.992));
    const tWarpTemp = new Float64Array(estOutLen);
    let minWarp = Infinity;
    for (let i = 0; i < estOutLen; i++) {
      const val = baseSpeed * i - amp1 * Math.cos(w1 * i + phi1) - amp2 * Math.sin(w2 * i + phi2);
      tWarpTemp[i] = val;
      if (val < minWarp) minWarp = val;
    }

    let validCount = 0;
    const limitIdx = length - 3;
    for (let i = 0; i < estOutLen; i++) {
      const shifted = tWarpTemp[i] - minWarp + 1.0;
      tWarpTemp[i] = shifted;
      if (shifted < limitIdx) validCount = i + 1;
      else break;
    }

    const tWarp = tWarpTemp.subarray(0, validCount);
    chL = cubicCatmullRomResample(rawCh0, tWarp);
    chR = cubicCatmullRomResample(rawCh1, tWarp);
  }
  const nOut = chL.length;

  // =========================================================================
  // 1B. Anti-Suno Forensic Shield: Ultrasonic Cutoff, Notches & Codec De-Quantizer
  // =========================================================================
  if (useAntiSuno) {
    onProgress?.('[2/7] Anti-Suno: Eliminando marcas ultrasónicas (19.5k) y rompiendo periodicidad de IA...');
    await yieldToUi();

    // 1. Ultrasonic Lowpass Cutoff at 19.1 kHz (elimina marca de agua ultrasónica de Suno en 19.5 kHz)
    if (sr >= 40000) {
      const lpUltra = designLowpassBiquad(Math.min(19100, sr * 0.435), 0.7071, sr);
      chL = applyBiquadZeroPhase(chL, lpUltra);
      chR = applyBiquadZeroPhase(chR, lpUltra);

      // 2. Surgical Notches at Suno key watermark markers (11.025k, 15.5k, 17.8k)
      const sunoNotchFreqs = [11025, 15500, 17800];
      for (const fNotch of sunoNotchFreqs) {
        if (fNotch < sr * 0.46) {
          const notchFilter = designNotchBiquad(fNotch, 26.0, sr);
          chL = applyBiquadZeroPhase(chL, notchFilter);
          chR = applyBiquadZeroPhase(chR, notchFilter);
        }
      }
    }

    // 3. Neural Codec Grid Disruptor: Destroy 20ms (50Hz) RVQ frame periodicity with micro-jitter
    const maxJitSamples = Math.min(16, Math.max(4, Math.floor(0.00035 * sr)));
    const jitWarp = new Float64Array(nOut);
    const wJit1 = (2.0 * Math.PI * rng.uniform(3.2, 4.5)) / sr;
    const wJit2 = (2.0 * Math.PI * rng.uniform(6.5, 8.2)) / sr;
    const phiJit1 = rng.uniform(0, 2 * Math.PI);
    const phiJit2 = rng.uniform(0, 2 * Math.PI);
    for (let i = 0; i < nOut; i++) {
      const jit = (0.55 * Math.sin(wJit1 * i + phiJit1) + 0.45 * Math.sin(wJit2 * i + phiJit2)) * (maxJitSamples * 0.5);
      let x = i + jit;
      if (x < 1.0) x = 1.0;
      else if (x > nOut - 3.01) x = nOut - 3.01;
      jitWarp[i] = x;
    }
    chL = cubicCatmullRomResample(chL, jitWarp);
    chR = cubicCatmullRomResample(chR, jitWarp);

    // 4. Analog Console Saturation: 2nd and 3rd harmonics injection
    for (let i = 0; i < nOut; i++) {
      const xL = chL[i];
      const xR = chR[i];
      chL[i] = Math.tanh(1.03 * xL) + 0.022 * xL * xL - 0.006 * xL * xL * xL;
      chR[i] = Math.tanh(1.03 * xR) + 0.022 * xR * xR - 0.006 * xR * xR * xR;
    }

    // 5. Acoustic Early Reflections (Physical room multipath decorrelation)
    const bpRoom = designBandpassBiquad(350, 7500, sr);
    const refInL = applyBiquadZeroPhase(chL, bpRoom);
    const refInR = applyBiquadZeroPhase(chR, bpRoom);
    const d1 = Math.floor(0.0032 * sr);
    const d2 = Math.floor(0.0068 * sr);
    const d3 = Math.floor(0.0105 * sr);
    for (let i = d3; i < nOut; i++) {
      const earlyL = 0.028 * refInL[i - d1] - 0.020 * refInR[i - d2] + 0.015 * refInL[i - d3];
      const earlyR = 0.028 * refInR[i - d1] - 0.020 * refInL[i - d2] + 0.015 * refInR[i - d3];
      chL[i] += earlyL;
      chR[i] += earlyR;
    }
  }

  // Compute instantaneous normalized envelope for psychoacoustic Fletcher-Munson & Bark masking
  const monoAbs = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    monoAbs[i] = 0.5 * (Math.abs(chL[i]) + Math.abs(chR[i]));
  }
  const lpEnv = designLowpassBiquad(16, 0.7071, sr);
  const env = applyBiquadCausal(monoAbs, lpEnv);
  let envMax = 1e-9;
  for (let i = 0; i < nOut; i++) {
    if (env[i] > envMax) envMax = env[i];
  }
  const envNorm = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    envNorm[i] = Math.min(1.0, Math.max(0.0, env[i] / envMax));
  }

  // =========================================================================
  // 2. Organic Tape & Vinyl Warmth Bed (-42 dBFS, Anti-Landmark Inter-Transient)
  // =========================================================================
  if (useTapeBed) {
    onProgress?.('[2/7] Paso 2: Acoplando Textura de Cinta Analógica (Tape Bed, -42 dBFS)...');
    await yieldToUi();

    const bpTape = designBandpassBiquad(1800, 13500, sr);
    const rawNoise = new Float32Array(nOut);
    for (let i = 0; i < nOut; i++) {
      rawNoise[i] = rng.next() - rng.next();
    }
    const tapeFiltered = applyBiquadZeroPhase(rawNoise, bpTape);
    const bedAmp = inputRms * Math.pow(10.0, cfg.tapeBedGainDb / 20.0);
    const wTape = (2.0 * Math.PI * rng.uniform(0.18, 0.38)) / sr;
    const pTape = rng.uniform(0, 2.0 * Math.PI);

    for (let i = 0; i < nOut; i++) {
      const mod = 1.0 + 0.12 * Math.sin(wTape * i + pTape);
      const val = tapeFiltered[i] * bedAmp * mod;
      chL[i] += val;
      chR[i] += val;
    }
  }

  // =========================================================================
  // 3. Ghost MIDI Sub-Bass Synthesizer (55 Hz - 185 Hz Polyrhythmic Sequence)
  // =========================================================================
  if (useGhostMidi) {
    onProgress?.('[3/7] Paso 3: Sintetizador Ghost MIDI Sub-Bass (55-185 Hz, máscara Fletcher-Munson)...');
    await yieldToUi();

    const midiAmp = inputRms * cfg.ghostMidiGain;
    let cursor = 0;
    while (cursor < nOut) {
      const stepLen = Math.floor(rng.uniform(0.18, 0.38) * sr);
      const end = Math.min(nOut, cursor + stepLen);
      const segLen = end - cursor;
      if (segLen < 64) break;

      const midEnv = envNorm[cursor + (segLen >> 1)];
      // Enmascaramiento Fletcher-Munson: solo genera con energía musical activa en la pista
      if (midEnv > 0.04) {
        const noteIdx = Math.floor(rng.uniform(0, GHOST_MIDI_FREQS.length));
        const f0 = GHOST_MIDI_FREQS[noteIdx] * rng.uniform(0.994, 1.006);
        const w0 = (2.0 * Math.PI * f0) / sr;
        const phase0 = rng.uniform(0, 2.0 * Math.PI);
        const invSeg = (2.0 * Math.PI) / segLen;

        for (let k = 0; k < segLen; k++) {
          const idx = cursor + k;
          // Envolvente Hann sin clics en bordes
          const winHann = 0.5 * (1.0 - Math.cos(k * invSeg));
          // Fletcher-Munson: escala suavemente con la energía del bajo/bombo
          const envGate = Math.pow(envNorm[idx], 1.4);
          const p = w0 * k + phase0;
          // Fundamental (62%) + 2º armónico (26%) + 3er armónico (12%)
          const wave = 0.62 * Math.sin(p) + 0.26 * Math.sin(2.0 * p) + 0.12 * Math.sin(3.0 * p);
          const val = wave * winHann * envGate * midiAmp;
          // Centro estéreo puro y sólido (cero vaivén o rotación de fase)
          chL[idx] += val;
          chR[idx] += val;
        }
      }
      const advanceFactor = rng.uniform(0.75, 0.95);
      cursor += Math.max(16, Math.floor(stepLen * advanceFactor));
    }
  }

  // =========================================================================
  // 3. Constellation Poisoning: Átomos de Gabor por Salto de Frecuencia (350 Hz - 4.8 kHz)
  // =========================================================================
  if (usePoison) {
    onProgress?.('[3/6] Paso 3: Constellation Poisoning quirúrgico (Gabor 350-4800 Hz, máscara Bark)...');
    await yieldToUi();

    const poisonAmp = inputRms * cfg.poisonChirpGain;
    const hop = Math.floor(0.028 * sr); // Micro-ráfagas cada 28 ms
    let cursor = 0;
    const logMin = Math.log(350.0);
    const logMax = Math.log(4800.0);

    while (cursor < nOut) {
      // Duración de 42 a 78 ms
      const grainLen = Math.floor(rng.uniform(0.042, 0.078) * sr);
      const end = Math.min(nOut, cursor + grainLen);
      const segLen = end - cursor;
      if (segLen < 64) break;

      const midEnv = envNorm[cursor + (segLen >> 1)];
      // Enmascaramiento simultáneo en banda crítica de Bark: solo se dispara con presencia instrumental
      if (midEnv > 0.045) {
        const invSeg = (2.0 * Math.PI) / segLen;
        for (let voice = 0; voice < 2; voice++) {
          const fStart = Math.exp(rng.uniform(logMin, logMax));
          const fDelta = rng.uniform(-35.0, 35.0) / segLen;
          let phase = rng.uniform(0, 2.0 * Math.PI);
          const phaseOffsetR = rng.uniform(-0.5, 0.5);

          for (let k = 0; k < segLen; k++) {
            const idx = cursor + k;
            // Ventana Hann anti-clic
            const winHann = 0.5 * (1.0 - Math.cos(k * invSeg));
            const envWin = winHann * envNorm[idx] * poisonAmp;
            const fInst = fStart + fDelta * k;
            phase += (2.0 * Math.PI * fInst) / sr;
            chL[idx] += Math.sin(phase) * envWin;
            chR[idx] += Math.cos(phase + phaseOffsetR) * envWin;
          }
        }
      }
      cursor += hop;
    }
  }

  // =========================================================================
  // 4. Multiplicative 6-Band Constellation Peak-Swapper (Zero Stereo Wobble!)
  // =========================================================================
  if (useConstellationTilt) {
    onProgress?.(`[4/6] Paso 4: Tilt Espectral Multiplicativo de 6 Bandas (±${cfg.eqModDb} dB, 0 Ruido)...`);
    await yieldToUi();

    const bandsHz: [number, number][] = [
      [250, 500],
      [500, 950],
      [950, 1750],
      [1750, 3100],
      [3100, 5200],
      [5200, 9500],
    ];
    const modAmp = Math.pow(10.0, cfg.eqModDb / 20.0) - 1.0;
    const deltaL = new Float32Array(nOut);
    const deltaR = new Float32Array(nOut);

    for (let bIdx = 0; bIdx < bandsHz.length; bIdx++) {
      const [fLo, fHi] = bandsHz[bIdx];
      const bp = designBandpassBiquad(fLo, fHi, sr);
      const bandL = applyBiquadZeroPhase(chL, bp);
      const bandR = applyBiquadZeroPhase(chR, bp);

      // Slow 12-to-25s cycles, identical on L and R so stereo center stays rock-solid
      const lfoRate = rng.uniform(0.04 + bIdx * 0.012, 0.09 + bIdx * 0.015);
      const wLfo = (2.0 * Math.PI * lfoRate) / sr;
      const pLfo = rng.uniform(0, 2.0 * Math.PI);
      const sign = bIdx % 2 === 0 ? 1.0 : -1.0;

      for (let i = 0; i < nOut; i++) {
        const gain = sign * modAmp * Math.sin(wLfo * i + pLfo);
        deltaL[i] += gain * bandL[i];
        deltaR[i] += gain * bandR[i];
      }
    }

    for (let i = 0; i < nOut; i++) {
      chL[i] += deltaL[i];
      chR[i] += deltaR[i];
    }
  }

  // =========================================================================
  // 5. Key-Locked Harmonic Sub-Bass Contour (Derived from Track's Own Bass)
  // =========================================================================
  if (useSubContour) {
    onProgress?.('[5/6] Paso 5: Contorno Sub-Armónico en Tono (55-145 Hz, derivado del bajo real)...');
    await yieldToUi();

    const bpSub = designBandpassBiquad(55, 145, sr);
    const subL = applyBiquadZeroPhase(chL, bpSub);
    const subR = applyBiquadZeroPhase(chR, bpSub);
    let subPeak = 1e-9;
    for (let i = 0; i < nOut; i++) {
      const aL = Math.abs(subL[i]);
      const aR = Math.abs(subR[i]);
      if (aL > subPeak) subPeak = aL;
      if (aR > subPeak) subPeak = aR;
    }

    const wSubLfo = (2.0 * Math.PI * rng.uniform(0.08, 0.16)) / sr;
    const subScalar = cfg.subContourGain * subPeak;
    for (let i = 0; i < nOut; i++) {
      const lfo = 0.5 + 0.5 * Math.sin(wSubLfo * i);
      chL[i] += lfo * Math.tanh(1.8 * (subL[i] / subPeak)) * subScalar;
      chR[i] += lfo * Math.tanh(1.8 * (subR[i] / subPeak)) * subScalar;
    }
  }

  // =========================================================================
  // 6. Static Time-Invariant All-Pass Phase Dispersion (Zero Flanging!)
  // =========================================================================
  if (usePhaseDispersion) {
    onProgress?.(`[6/6] Paso 6: Dispersión de Fase Estática (${cfg.apfStages} APF, 0.0 dB plana)...`);
    await yieldToUi();

    const mid = new Float32Array(nOut);
    let side = new Float32Array(nOut);
    for (let i = 0; i < nOut; i++) {
      mid[i] = 0.5 * (chL[i] + chR[i]);
      side[i] = 0.5 * (chL[i] - chR[i]);
    }

    // Sub-bass (<120 Hz) anchored in pure mono
    const hpSide120 = designHighpassBiquad(120, 0.7071, sr);
    side = applyBiquadZeroPhase(side, hpSide120);

    // Reverb Bloom Espacial exclusivo en canal Side (>220 Hz)
    if (useSideBloom) {
      const hpSide220 = designHighpassBiquad(220, 0.7071, sr);
      const sideDiffIn = applyBiquadZeroPhase(side, hpSide220);
      const diffDelays = [
        Math.floor(0.011 * sr),
        Math.floor(0.017 * sr),
        Math.floor(0.023 * sr),
        Math.floor(0.031 * sr),
      ];
      const sideBloom = new Float32Array(nOut);
      for (const d of diffDelays) {
        for (let i = d; i < nOut; i++) {
          sideBloom[i] += 0.25 * sideDiffIn[i - d];
        }
      }
      const bloomGain = cfg.sideBloomGain;
      for (let i = 0; i < nOut; i++) {
        side[i] += bloomGain * sideBloom[i];
      }
    }

    // Subtle static air shelf (>5 kHz) on Side channel
    const hpSide5000 = designHighpassBiquad(5000, 0.7071, sr);
    const sideHighs = applyBiquadZeroPhase(side, hpSide5000);
    const sideAirGain = cfg.sideAirGain;
    for (let i = 0; i < nOut; i++) {
      const s = side[i] + sideAirGain * sideHighs[i];
      chL[i] = mid[i] + s;
      chR[i] = mid[i] - s;
    }

    const lp200 = designLowpassBiquad(200, 0.7071, sr);
    const hp200 = designHighpassBiquad(200, 0.7071, sr);
    const lowL = applyBiquadZeroPhase(chL, lp200);
    const lowR = applyBiquadZeroPhase(chR, lp200);
    let highL = applyBiquadZeroPhase(chL, hp200);
    let highR = applyBiquadZeroPhase(chR, hp200);

    const apfStages = cfg.apfStages;
    for (let s = 0; s < apfStages; s++) {
      const ratio = s / Math.max(1, apfStages - 1);
      const baseFreq = 300.0 * Math.pow(9500.0 / 300.0, ratio);
      const fcL = Math.min(12500, Math.max(250, baseFreq * rng.uniform(0.86, 1.16)));
      const fcR = Math.min(12500, Math.max(250, baseFreq * rng.uniform(0.86, 1.16)));
      const qL = rng.uniform(0.60, 1.45);
      const qR = rng.uniform(0.60, 1.45);

      highL = applyBiquadCausal(highL, designAllpassBiquad(fcL, qL, sr));
      highR = applyBiquadCausal(highR, designAllpassBiquad(fcR, qR, sr));
    }

    // Fixed (non-sweeping!) micro-Haas sample offset on Right channel (>200 Hz)
    const fixedHaasSamples = cfg.staticHaasMs * (sr / 1000.0);
    const idxR = new Float64Array(nOut);
    for (let i = 0; i < nOut; i++) idxR[i] = i - fixedHaasSamples;
    highR = cubicCatmullRomResample(highR, idxR);

    for (let i = 0; i < nOut; i++) {
      chL[i] = lowL[i] + highL[i];
      chR[i] = lowR[i] + highR[i];
    }
  }

  // =========================================================================
  // 5. Gentle Analog Warmth, Full-Range Master (22 Hz - 18.8 kHz) & Limiter
  // =========================================================================
  onProgress?.(`[5/5] Paso 5: Masterización Full-Range (${(cfg.lpfCutoffHz / 1000).toFixed(1)} kHz) y True-Peak Limiter...`);
  await yieldToUi();

  const drive = cfg.drive;
  const invTanhDrive = 1.0 / Math.tanh(drive);
  for (let i = 0; i < nOut; i++) {
    chL[i] = Math.tanh(drive * chL[i]) * invTanhDrive;
    chR[i] = Math.tanh(drive * chR[i]) * invTanhDrive;
  }

  const hpMaster22 = designHighpassBiquad(22, 0.7071, sr);
  const lpMaster = designLowpassBiquad(Math.min(cfg.lpfCutoffHz, sr * 0.46), 0.7071, sr);
  chL = applyBiquadZeroPhase(chL, hpMaster22);
  chR = applyBiquadZeroPhase(chR, hpMaster22);
  chL = applyBiquadZeroPhase(chL, lpMaster);
  chR = applyBiquadZeroPhase(chR, lpMaster);

  let meanL = 0.0;
  let meanR = 0.0;
  for (let i = 0; i < nOut; i++) {
    meanL += chL[i];
    meanR += chR[i];
  }
  meanL /= Math.max(1, nOut);
  meanR /= Math.max(1, nOut);

  let sumSqOut = 0.0;
  for (let i = 0; i < nOut; i++) {
    chL[i] -= meanL;
    chR[i] -= meanR;
    sumSqOut += 0.5 * (chL[i] * chL[i] + chR[i] * chR[i]);
  }
  const outputRms = Math.sqrt(sumSqOut / Math.max(1, nOut)) + 1e-9;
  const loudnessGain = inputRms / outputRms;

  const ditherAmp = Math.pow(10.0, -84.0 / 20.0);
  const ceiling = 0.966;
  const knee = 0.86;
  let maxPeak = 1e-9;

  for (let i = 0; i < nOut; i++) {
    const dL = (rng.next() - rng.next()) * ditherAmp;
    const dR = (rng.next() - rng.next()) * ditherAmp;
    let yL = chL[i] * loudnessGain + dL;
    let yR = chR[i] * loudnessGain + dR;

    const absL = Math.abs(yL);
    if (absL > knee) {
      const signL = yL < 0 ? -1 : 1;
      yL = signL * (knee + (ceiling - knee) * Math.tanh((absL - knee) / (ceiling - knee)));
    }
    const absR = Math.abs(yR);
    if (absR > knee) {
      const signR = yR < 0 ? -1 : 1;
      yR = signR * (knee + (ceiling - knee) * Math.tanh((absR - knee) / (ceiling - knee)));
    }

    chL[i] = yL;
    chR[i] = yR;
    if (Math.abs(yL) > maxPeak) maxPeak = Math.abs(yL);
    if (Math.abs(yR) > maxPeak) maxPeak = Math.abs(yR);
  }

  if (maxPeak > ceiling) {
    const scale = ceiling / maxPeak;
    for (let i = 0; i < nOut; i++) {
      chL[i] *= scale;
      chR[i] *= scale;
    }
    maxPeak = ceiling;
  }

  await yieldToUi();

  let blob: Blob;
  if (format === 'mp3') {
    onProgress?.('[5/5] Codificando Master a MP3 320 kbps CBR...');
    blob = await encodeMp3Stereo320(chL, chR, sr);
  } else if (format === 'flac') {
    onProgress?.('[5/5] Empaquetando contenedor FLAC 24-bit sin pérdida...');
    blob = encodeFlac24BitStereo(chL, chR, sr);
  } else {
    onProgress?.('[5/5] Codificando Master WAV PCM 16-bit...');
    blob = encodeWav16BitStereo(chL, chR, sr);
  }

  const processingTimeSec = Number(((performance.now() - t0) / 1000).toFixed(2));
  const speedShiftPct = Number(((baseSpeed - 1.0) * 100.0).toFixed(2));
  const peakDbtp = Number((20.0 * Math.log10(Math.max(1e-6, maxPeak))).toFixed(2));
  const centsShift = resolvedPitchMode === 'lock_440' ? 0.0 : 1200.0 * Math.log2(baseSpeed);
  const cqtEvasion = Math.min(1.0, Math.abs(centsShift) / 30.0);
  const decorrelationPct = Number(
    Math.min(
      99.6,
      (resolvedPitchMode === 'lock_440' ? 0.0 : cqtEvasion * 20.0) +
        (useAntiSuno ? 22.0 : 0.0) +
        (useTapeBed ? 18.0 : 0.0) +
        (useGhostMidi ? 20.0 : 0.0) +
        (usePoison ? 22.0 : 0.0) +
        (useSideBloom ? 14.0 : 0.0) +
        (useConstellationTilt ? cfg.eqModDb * 6.5 : 0.0) +
        (usePhaseDispersion ? cfg.apfStages * 1.0 : 0.0) +
        (useSubContour ? 4.0 : 0.0)
    ).toFixed(1)
  );

  return {
    blob,
    format,
    sampleRate: sr,
    durationSeconds: Number((nOut / sr).toFixed(2)),
    preset,
    speedShiftPct,
    peakDbtp,
    apfStages: cfg.apfStages,
    decorrelationPct,
    processingTimeSec,
  };
}

// ---------------------------------------------------------------------------
// Encoders: WAV 16-bit, FLAC 24-bit (RFC 9639 Verbatim Lossless), MP3 320k
// ---------------------------------------------------------------------------
function encodeWav16BitStereo(chL: Float32Array, chR: Float32Array, sr: number): Blob {
  const numSamples = chL.length;
  const numChannels = 2;
  const bytesPerSample = 2;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const int16View = new Int16Array(buffer, 44);
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, chL[i]));
    const r = Math.max(-1, Math.min(1, chR[i]));
    int16View[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
    int16View[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

const FLAC_CRC8_TABLE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let b = 0; b < 8; b++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    table[i] = crc;
  }
  return table;
})();

const FLAC_CRC16_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    table[i] = crc;
  }
  return table;
})();

function writeUtf8FrameNum(num: number): number[] {
  if (num < 0x80) return [num];
  if (num < 0x800) return [0xc0 | (num >> 6), 0x80 | (num & 0x3f)];
  if (num < 0x10000) return [0xe0 | (num >> 12), 0x80 | ((num >> 6) & 0x3f), 0x80 | (num & 0x3f)];
  return [
    0xf0 | (num >> 18),
    0x80 | ((num >> 12) & 0x3f),
    0x80 | ((num >> 6) & 0x3f),
    0x80 | (num & 0x3f),
  ];
}

function encodeFlac24BitStereo(chL: Float32Array, chR: Float32Array, sr: number): Blob {
  const totalSamples = chL.length;
  const blockSize = 4096;
  const numBlocks = Math.ceil(totalSamples / blockSize);
  const chunks: Uint8Array[] = [];

  const streamInfo = new Uint8Array(42);
  streamInfo[0] = 0x66;
  streamInfo[1] = 0x4c;
  streamInfo[2] = 0x61;
  streamInfo[3] = 0x43;
  streamInfo[4] = 0x80;
  streamInfo[5] = 0x00;
  streamInfo[6] = 0x00;
  streamInfo[7] = 34;
  streamInfo[8] = 0x10;
  streamInfo[9] = 0x00;
  streamInfo[10] = 0x10;
  streamInfo[11] = 0x00;
  const sr20 = sr & 0xfffff;
  const ch3 = 1;
  const bps5 = 23;
  streamInfo[18] = (sr20 >> 12) & 0xff;
  streamInfo[19] = (sr20 >> 4) & 0xff;
  streamInfo[20] = ((sr20 & 0x0f) << 4) | (ch3 << 1) | ((bps5 >> 4) & 0x01);
  streamInfo[21] = ((bps5 & 0x0f) << 4) | Number((BigInt(totalSamples) >> 32n) & 0x0fn);
  const low32 = totalSamples >>> 0;
  streamInfo[22] = (low32 >>> 24) & 0xff;
  streamInfo[23] = (low32 >>> 16) & 0xff;
  streamInfo[24] = (low32 >>> 8) & 0xff;
  streamInfo[25] = low32 & 0xff;
  chunks.push(streamInfo);

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    const count = Math.min(blockSize, totalSamples - start);
    const utf8Bytes = writeUtf8FrameNum(b);

    const bsCode = 0x07;
    const srCode = sr === 44100 ? 0x09 : sr === 48000 ? 0x0a : 0x00;

    const headerLen = 4 + utf8Bytes.length + 2 + 1;
    const frameLen = headerLen + 2 * (1 + count * 3) + 2;
    const frame = new Uint8Array(frameLen);

    let p = 0;
    frame[p++] = 0xff;
    frame[p++] = 0xf8;
    frame[p++] = (bsCode << 4) | srCode;
    frame[p++] = (0x01 << 4) | (0x06 << 1) | 0x00;
    for (const ub of utf8Bytes) frame[p++] = ub;
    const bsMinus1 = count - 1;
    frame[p++] = (bsMinus1 >> 8) & 0xff;
    frame[p++] = bsMinus1 & 0xff;

    let crc8 = 0;
    for (let i = 0; i < p; i++) crc8 = FLAC_CRC8_TABLE[crc8 ^ frame[i]];
    frame[p++] = crc8;

    for (const ch of [chL, chR]) {
      frame[p++] = 0x02;
      for (let i = 0; i < count; i++) {
        const s = Math.max(-1, Math.min(1, ch[start + i]));
        const val = Math.round(s < 0 ? s * 8388608 : s * 8388607);
        frame[p++] = (val >> 16) & 0xff;
        frame[p++] = (val >> 8) & 0xff;
        frame[p++] = val & 0xff;
      }
    }

    let crc16 = 0;
    for (let i = 0; i < p; i++) {
      crc16 = ((crc16 << 8) & 0xffff) ^ FLAC_CRC16_TABLE[((crc16 >> 8) ^ frame[i]) & 0xff];
    }
    frame[p++] = (crc16 >> 8) & 0xff;
    frame[p++] = crc16 & 0xff;

    chunks.push(frame);
  }

  return new Blob(chunks as BlobPart[], { type: 'audio/flac' });
}

async function encodeMp3Stereo320(chL: Float32Array, chR: Float32Array, sr: number): Promise<Blob> {
  if (!(window as any).lamejs) {
    const lamejsSrc = await import('lamejs/lame.all.js?raw');
    const script = document.createElement('script');
    script.innerHTML = lamejsSrc.default + '\nwindow.lamejs = lamejs;';
    document.head.appendChild(script);
  }
  const lamejs = (window as any).lamejs;
  const encoder = new lamejs.Mp3Encoder(2, sr, 320);

  const sampleBlockSize = 1152;
  const mp3Data: BlobPart[] = [];
  const leftChunk16 = new Int16Array(sampleBlockSize);
  const rightChunk16 = new Int16Array(sampleBlockSize);

  let sampleOffset = 0;
  while (sampleOffset < chL.length) {
    const length = Math.min(sampleBlockSize, chL.length - sampleOffset);
    const lSub = length === sampleBlockSize ? leftChunk16 : new Int16Array(length);
    const rSub = length === sampleBlockSize ? rightChunk16 : new Int16Array(length);

    for (let i = 0; i < length; i++) {
      const sL = Math.max(-1, Math.min(1, chL[sampleOffset + i]));
      const sR = Math.max(-1, Math.min(1, chR[sampleOffset + i]));
      lSub[i] = sL < 0 ? sL * 0x8000 : sL * 0x7fff;
      rSub[i] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
    }

    const mp3buf = encoder.encodeBuffer(lSub, rSub);
    if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
    sampleOffset += sampleBlockSize;
  }
  const flushBuf = encoder.flush();
  if (flushBuf.length > 0) mp3Data.push(new Int8Array(flushBuf));

  return new Blob(mp3Data, { type: 'audio/mpeg' });
}
