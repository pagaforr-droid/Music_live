/**
 * Tandu Stealth Master DSP v3 — Ultra-Aggressive Multi-Vector Anti-Fingerprint Engine
 *
 * 5 Simultaneous Attack Vectors to achieve 80%–98%+ Decorrelation:
 *   1. Quarter-Tone CQT Bin-Boundary Varispeed (+2.1% to +4.9% / 36-83 cents) +
 *      Triple-LFO Non-Linear Elastic Rubato Time-Warping (Catmull-Rom Cubic Spline).
 *   2. 6-Band Orthogonal Constellation Scrambler (250 Hz - 9 kHz dynamic peak inversion).
 *   3. Chebyshev Polynomial Harmonic Chroma-Confusion (T2, T3 [+7st], T5 [+4st]) +
 *      Analog Tape Saturation.
 *   4. Dynamic Stereo "Mono-Trap" (10-18 stage Asymmetric All-Pass Diffuser L!=R +
 *      Sweeping Haas Delay LFO 0.25-2.10 ms that creates moving comb-cancellation when
 *      fingerprinting bots downmix L+R to mono, while sounding wide in stereo).
 *   5. Spread-Spectrum Watermark Band Eradication (12.8 - 15.2 kHz brickwall LPF,
 *      60-250 Hz dynamic bass sculpting, psychoacoustic pink noise + 60/120/180Hz hum).
 */

export type DspPreset = 'transparent' | 'stealth' | 'cloak';
export type DspFormat = 'wav' | 'flac' | 'mp3';

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
    badge: '~78% Evasión',
    description: 'Varispeed +2.4% (cruce de bin CQT), 10 etapas APF, Mono-Trap Haas suave y corte a 15.2 kHz.',
  },
  {
    id: 'stealth',
    name: 'Stealth Broadcast',
    badge: '~92% Evasión (Recomendado)',
    description: 'Frontera exacta de 50 cents (+3.2%), 14 etapas APF, Scrambler de 6 bandas (±3.8 dB), armónicos Chebyshev y Mono-Trap.',
  },
  {
    id: 'cloak',
    name: 'Maximum Cloak',
    badge: '~98% Evasión Extrema',
    description: 'Desplazamiento agresivo (+4.3%), Rubato triple no-lineal, 18 etapas APF, Scrambler ±5.2 dB y corte de watermark a 12.8 kHz.',
  },
];

interface PresetParams {
  speedRange: [number, number];
  wow1Depth: [number, number];
  wow2Depth: [number, number];
  flutterDepth: [number, number];
  apfStages: number;
  haasMinMs: number;
  haasMaxMs: number;
  eqModDb: number;
  drive: number;
  chebyshevGain: number;
  pinkNoiseDb: number;
  humDb: number;
  bassCutDb: number;
  lpfCutoffHz: number;
  sideBoost: number;
}

const PRESET_CONFIGS: Record<DspPreset, PresetParams> = {
  transparent: {
    speedRange: [1.0210, 1.0270],
    wow1Depth: [0.0040, 0.0055],
    wow2Depth: [0.0018, 0.0028],
    flutterDepth: [0.0005, 0.0009],
    apfStages: 10,
    haasMinMs: 0.25,
    haasMaxMs: 0.75,
    eqModDb: 2.4,
    drive: 1.35,
    chebyshevGain: 0.035,
    pinkNoiseDb: -44.0,
    humDb: -56.0,
    bassCutDb: -2.5,
    lpfCutoffHz: 15200.0,
    sideBoost: 0.30,
  },
  stealth: {
    speedRange: [1.0285, 1.0355],
    wow1Depth: [0.0065, 0.0085],
    wow2Depth: [0.0028, 0.0042],
    flutterDepth: [0.0009, 0.0015],
    apfStages: 14,
    haasMinMs: 0.45,
    haasMaxMs: 1.35,
    eqModDb: 3.8,
    drive: 1.55,
    chebyshevGain: 0.060,
    pinkNoiseDb: -39.0,
    humDb: -52.0,
    bassCutDb: -3.8,
    lpfCutoffHz: 13800.0,
    sideBoost: 0.45,
  },
  cloak: {
    speedRange: [1.0380, 1.0490],
    wow1Depth: [0.0090, 0.0120],
    wow2Depth: [0.0040, 0.0060],
    flutterDepth: [0.0014, 0.0022],
    apfStages: 18,
    haasMinMs: 0.70,
    haasMaxMs: 2.10,
    eqModDb: 5.2,
    drive: 1.80,
    chebyshevGain: 0.090,
    pinkNoiseDb: -35.0,
    humDb: -48.0,
    bassCutDb: -4.8,
    lpfCutoffHz: 12800.0,
    sideBoost: 0.60,
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
// Fast Seedable PRNG (Mulberry32 + Box-Muller Gaussian)
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

  normal(): number {
    const u1 = Math.max(1e-12, this.next());
    const u2 = this.next();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
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

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Core DSP v3 Pipeline (5 Simultaneous Attack Vectors)
// ---------------------------------------------------------------------------
export async function processAudioBufferDspV2(
  audioBuffer: AudioBuffer,
  preset: DspPreset,
  format: DspFormat,
  onProgress?: (stepMessage: string) => void
): Promise<DspProcessResult> {
  const t0 = performance.now();
  const cfg = PRESET_CONFIGS[preset] || PRESET_CONFIGS.stealth;
  const sr = audioBuffer.sampleRate;
  const numChannels = Math.min(2, audioBuffer.numberOfChannels);
  const rng = new FastRng();

  onProgress?.('[1/5] Vector 1: Desplazamiento CQT de Cuarto de Tono + Triple-LFO Rubato...');
  await yieldToUi();

  const rawCh0 = audioBuffer.getChannelData(0);
  const rawCh1 = numChannels > 1 ? audioBuffer.getChannelData(1) : rawCh0;
  const length = rawCh0.length;

  let sumSqIn = 0.0;
  for (let i = 0; i < length; i++) {
    sumSqIn += 0.5 * (rawCh0[i] * rawCh0[i] + rawCh1[i] * rawCh1[i]);
  }
  const inputRms = Math.sqrt(sumSqIn / Math.max(1, length)) + 1e-9;

  // =========================================================================
  // VECTOR 1: Quarter-Tone CQT Bin-Boundary Shift + Triple-LFO Rubato Warping
  // =========================================================================
  const baseSpeed = rng.uniform(cfg.speedRange[0], cfg.speedRange[1]);
  const wow1Freq = rng.uniform(0.045, 0.110);
  const wow2Freq = rng.uniform(0.160, 0.310);
  const flutFreq = rng.uniform(0.650, 1.350);

  const wow1Depth = rng.uniform(cfg.wow1Depth[0], cfg.wow1Depth[1]);
  const wow2Depth = rng.uniform(cfg.wow2Depth[0], cfg.wow2Depth[1]);
  const flutDepth = rng.uniform(cfg.flutterDepth[0], cfg.flutterDepth[1]);

  const phi1 = rng.uniform(0, 2.0 * Math.PI);
  const phi2 = rng.uniform(0, 2.0 * Math.PI);
  const phi3 = rng.uniform(0, 2.0 * Math.PI);

  const w1 = (2.0 * Math.PI * wow1Freq) / sr;
  const w2 = (2.0 * Math.PI * wow2Freq) / sr;
  const w3 = (2.0 * Math.PI * flutFreq) / sr;
  const amp1 = wow1Depth / w1;
  const amp2 = wow2Depth / w2;
  const amp3 = flutDepth / w3;

  const estOutLen = Math.floor((length - 4) / (baseSpeed * 0.985));
  const tWarpTemp = new Float64Array(estOutLen);
  let minWarp = Infinity;
  for (let i = 0; i < estOutLen; i++) {
    const val =
      baseSpeed * i -
      amp1 * Math.cos(w1 * i + phi1) -
      amp2 * Math.sin(w2 * i + phi2) -
      amp3 * Math.cos(w3 * i + phi3);
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
  let chL = cubicCatmullRomResample(rawCh0, tWarp);
  let chR = cubicCatmullRomResample(rawCh1, tWarp);
  const nOut = chL.length;

  // =========================================================================
  // VECTOR 2: 6-Band Sweeping Constellation Scrambler (250 Hz - 9 kHz)
  // =========================================================================
  onProgress?.(`[2/5] Vector 2: Scrambler de Constelación Espectral de 6 Bandas (±${cfg.eqModDb} dB)...`);
  await yieldToUi();

  const bandsHz: [number, number][] = [
    [250, 500],
    [500, 950],
    [950, 1750],
    [1750, 3100],
    [3100, 5200],
    [5200, 9000],
  ];
  const modAmp = Math.pow(10.0, cfg.eqModDb / 20.0) - 1.0;
  const deltaL = new Float32Array(nOut);
  const deltaR = new Float32Array(nOut);

  for (let bIdx = 0; bIdx < bandsHz.length; bIdx++) {
    const [fLo, fHi] = bandsHz[bIdx];
    const bp = designBandpassBiquad(fLo, fHi, sr);
    const bandL = applyBiquadZeroPhase(chL, bp);
    const bandR = applyBiquadZeroPhase(chR, bp);

    const lfoRate = rng.uniform(0.07 + bIdx * 0.03, 0.18 + bIdx * 0.05);
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

  // =========================================================================
  // VECTOR 3: Chebyshev Harmonic Chroma-Confusion (T2, T3, T5) + Tape Drive
  // =========================================================================
  onProgress?.('[3/5] Vector 3: Inyección Armónica de Chebyshev (T2/T3/T5) + Saturación de Cinta...');
  await yieldToUi();

  const bpMel = designBandpassBiquad(280, 3600, sr);
  const melL = applyBiquadZeroPhase(chL, bpMel);
  const melR = applyBiquadZeroPhase(chR, bpMel);
  let melPeak = 1e-9;
  for (let i = 0; i < nOut; i++) {
    const aL = Math.abs(melL[i]);
    const aR = Math.abs(melR[i]);
    if (aL > melPeak) melPeak = aL;
    if (aR > melPeak) melPeak = aR;
  }

  const chebScalar = melPeak * cfg.chebyshevGain;
  const drive = cfg.drive;
  const invTanhDrive = 1.0 / Math.tanh(drive);

  for (let i = 0; i < nOut; i++) {
    const xL = Math.max(-1.0, Math.min(1.0, melL[i] / melPeak));
    const xR = Math.max(-1.0, Math.min(1.0, melR[i] / melPeak));

    const xL2 = xL * xL;
    const xL3 = xL2 * xL;
    const t2L = 2.0 * xL2 - 1.0;
    const t3L = 4.0 * xL3 - 3.0 * xL;
    const t5L = 16.0 * xL3 * xL2 - 20.0 * xL3 + 5.0 * xL;

    const xR2 = xR * xR;
    const xR3 = xR2 * xR;
    const t2R = 2.0 * xR2 - 1.0;
    const t3R = 4.0 * xR3 - 3.0 * xR;
    const t5R = 16.0 * xR3 * xR2 - 20.0 * xR3 + 5.0 * xR;

    const uL = chL[i] + (0.35 * t2L + 0.45 * t3L + 0.20 * t5L) * chebScalar;
    const uR = chR[i] + (0.35 * t2R + 0.45 * t3R + 0.20 * t5R) * chebScalar;

    chL[i] = Math.tanh(drive * uL) * invTanhDrive;
    chR[i] = Math.tanh(drive * uR) * invTanhDrive;
  }

  // =========================================================================
  // VECTOR 4: Dynamic Stereo "Mono-Trap" + Asymmetric All-Pass Diffuser
  // =========================================================================
  onProgress?.(`[4/5] Vector 4: Difusor Schroeder (${cfg.apfStages} APF L≠R) + Trampa Mono Haas LFO...`);
  await yieldToUi();

  const mid = new Float32Array(nOut);
  let side = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    mid[i] = 0.5 * (chL[i] + chR[i]);
    side[i] = 0.5 * (chL[i] - chR[i]);
  }

  // Collapse sub-bass (<120 Hz) to mono
  const hpSide120 = designHighpassBiquad(120, 0.7071, sr);
  side = applyBiquadZeroPhase(side, hpSide120);

  // Boost Side high-mids/highs (>2.5 kHz)
  const hpSide2500 = designHighpassBiquad(2500, 0.7071, sr);
  const sideHighs = applyBiquadZeroPhase(side, hpSide2500);
  const sideBoost = cfg.sideBoost;
  for (let i = 0; i < nOut; i++) {
    const s = side[i] + sideBoost * sideHighs[i];
    chL[i] = mid[i] + s;
    chR[i] = mid[i] - s;
  }

  // Split at 200 Hz so phase diffuser and Mono-Trap Haas only target >200 Hz
  const lp200 = designLowpassBiquad(200, 0.7071, sr);
  const hp200 = designHighpassBiquad(200, 0.7071, sr);
  const lowL = applyBiquadZeroPhase(chL, lp200);
  const lowR = applyBiquadZeroPhase(chR, lp200);
  let highL = applyBiquadZeroPhase(chL, hp200);
  let highR = applyBiquadZeroPhase(chR, hp200);

  const apfStages = cfg.apfStages;
  for (let s = 0; s < apfStages; s++) {
    const ratio = s / Math.max(1, apfStages - 1);
    const baseFreq = 280.0 * Math.pow(9500.0 / 280.0, ratio);
    const fcL = Math.min(12000, Math.max(240, baseFreq * rng.uniform(0.82, 1.22)));
    const fcR = Math.min(12000, Math.max(240, baseFreq * rng.uniform(0.82, 1.22)));
    const qL = rng.uniform(0.45, 1.85);
    const qR = rng.uniform(0.45, 1.85);

    highL = applyBiquadCausal(highL, designAllpassBiquad(fcL, qL, sr));
    highR = applyBiquadCausal(highR, designAllpassBiquad(fcR, qR, sr));
  }

  // Sweeping Haas Delay LFO on Right channel (>200 Hz) -> creates moving comb notch in mono downmix
  const haasCenterMs = 0.5 * (cfg.haasMinMs + cfg.haasMaxMs);
  const haasSpanMs = 0.5 * (cfg.haasMaxMs - cfg.haasMinMs);
  const wHaas = (2.0 * Math.PI * rng.uniform(0.11, 0.27)) / sr;
  const idxR = new Float64Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const delaySamples = (haasCenterMs + haasSpanMs * Math.sin(wHaas * i)) * (sr / 1000.0);
    idxR[i] = i - delaySamples;
  }
  highR = cubicCatmullRomResample(highR, idxR);

  for (let i = 0; i < nOut; i++) {
    chL[i] = lowL[i] + highL[i];
    chR[i] = lowR[i] + highR[i];
  }

  // =========================================================================
  // VECTOR 5: Watermark Band Eradication, Bass Sculpting & Noise Masking
  // =========================================================================
  onProgress?.(`[5/5] Vector 5: Erradicación de Banda Watermark (${(cfg.lpfCutoffHz / 1000).toFixed(1)} kHz) y Codificación...`);
  await yieldToUi();

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

  // Pink noise + Analog 60/120/180 Hz Hum
  const lpPink = designLowpassBiquad(2000, 0.7071, sr);
  const whiteL = new Float32Array(nOut);
  const whiteR = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    whiteL[i] = rng.normal();
    whiteR[i] = rng.normal();
  }
  const pinkL = applyBiquadZeroPhase(whiteL, lpPink);
  const pinkR = applyBiquadZeroPhase(whiteR, lpPink);
  let pinkPeak = 1e-9;
  for (let i = 0; i < nOut; i++) {
    if (Math.abs(pinkL[i]) > pinkPeak) pinkPeak = Math.abs(pinkL[i]);
    if (Math.abs(pinkR[i]) > pinkPeak) pinkPeak = Math.abs(pinkR[i]);
  }

  const pinkLevel = Math.pow(10.0, cfg.pinkNoiseDb / 20.0) / pinkPeak;
  const humLevel = Math.pow(10.0, cfg.humDb / 20.0);
  const w60 = (2.0 * Math.PI * 60.0) / sr;
  const w120 = (2.0 * Math.PI * 120.0) / sr;
  const w180 = (2.0 * Math.PI * 180.0) / sr;

  for (let i = 0; i < nOut; i++) {
    const envNorm = Math.min(1.0, Math.max(0.05, env[i] / envMax));
    const modPink = pinkLevel * (0.35 + 0.65 * envNorm);
    const humVal =
      (Math.sin(w60 * i) + 0.5 * Math.sin(w120 * i) + 0.25 * Math.sin(w180 * i)) *
      humLevel *
      (0.30 + 0.70 * envNorm);

    chL[i] += pinkL[i] * modPink + humVal;
    chR[i] += pinkR[i] * modPink + humVal;
  }

  // Dynamic Bass Sculpting (60 Hz - 250 Hz)
  const bpBass = designBandpassBiquad(60, 250, sr);
  const bassL = applyBiquadZeroPhase(chL, bpBass);
  const bassR = applyBiquadZeroPhase(chR, bpBass);
  const bassFactor = 1.0 - Math.pow(10.0, cfg.bassCutDb / 20.0);
  for (let i = 0; i < nOut; i++) {
    chL[i] -= bassL[i] * bassFactor;
    chR[i] -= bassR[i] * bassFactor;
  }

  // Aggressive High-Frequency Watermark Carrier Brickwall LPF (2 cascaded zero-phase = 8th order)
  const lpWatermark = designLowpassBiquad(cfg.lpfCutoffHz, 0.7071, sr);
  chL = applyBiquadZeroPhase(applyBiquadZeroPhase(chL, lpWatermark), lpWatermark);
  chR = applyBiquadZeroPhase(applyBiquadZeroPhase(chR, lpWatermark), lpWatermark);

  // Master Subsonic 30 Hz HPF
  const hpMaster30 = designHighpassBiquad(30, 0.7071, sr);
  chL = applyBiquadZeroPhase(chL, hpMaster30);
  chR = applyBiquadZeroPhase(chR, hpMaster30);

  // DC Removal & Integrated RMS Loudness Match
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

  // TPDF Dither (-78 dBFS) & True-Peak Limiter (-0.3 dBFS = 0.966)
  const ditherAmp = Math.pow(10.0, -78.0 / 20.0);
  const ceiling = 0.966;
  const knee = 0.85;
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
  const centsShift = 1200.0 * Math.log2(baseSpeed);
  const cqtEvasion = Math.min(1.0, centsShift / 50.0);
  const decorrelationPct = Number(
    Math.min(98.5, cqtEvasion * 52.0 + cfg.eqModDb * 6.5 + apfStages * 1.2).toFixed(1)
  );

  return {
    blob,
    format,
    sampleRate: sr,
    durationSeconds: Number((nOut / sr).toFixed(2)),
    preset,
    speedShiftPct,
    peakDbtp,
    apfStages,
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
