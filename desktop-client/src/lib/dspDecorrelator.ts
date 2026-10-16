/**
 * Tandu Stealth Master DSP v2 — Local Instant Decorrelation Engine
 *
 * Implements the 5-stage psychoacoustic decorrelation pipeline directly in the client:
 *   1. 4-Point Catmull-Rom Cubic Spline Non-Linear Time Warping (Dual Irrational LFOs)
 *   2. Dynamic Spectral Constellation Perturbation (3-Band Orthogonal LFOs)
 *   3. Mid/Side Sub-Bass Mono Lock (<120 Hz) + Asymmetric Stereo All-Pass Network (L != R) + Micro-Haas
 *   4. Envelope-Gated Psychoacoustic Masking & Warm Asymmetrical Harmonic Exciter (zero noise in silence)
 *   5. Full-Range Master Protection (22 Hz - 19.2 kHz), RMS Loudness Match, TPDF Dither & True-Peak Limiter (-0.3 dBTP)
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
    badge: '99.8% Fidelidad',
    description: 'Micro-decorrelación sutil (+0.6% varispeed, 4 etapas APF). Ideal para directo y monitoreo crítico.',
  },
  {
    id: 'stealth',
    name: 'Stealth Broadcast',
    badge: 'Recomendado',
    description: 'Balance élite (+1.1% varispeed, 6 etapas APF asimétricas, enmascaramiento dinámico). Rompe huellas e IA manteniendo brillo.',
  },
  {
    id: 'cloak',
    name: 'Maximum Cloak',
    badge: 'Anti-ContentID Pro',
    description: 'Decorrelación profunda (+1.55% varispeed, 8 etapas APF, deriva espectral y Haas extendido) para máxima protección.',
  },
];

interface PresetParams {
  speedRange: [number, number];
  wow1Depth: [number, number];
  wow2Depth: [number, number];
  apfStages: number;
  haasMs: [number, number];
  eqModDb: number;
  drive: number;
  harmonicEven: number;
  maskedNoiseDb: number;
  sideAirGain: number;
}

const PRESET_CONFIGS: Record<DspPreset, PresetParams> = {
  transparent: {
    speedRange: [1.0045, 1.0075],
    wow1Depth: [0.0006, 0.0010],
    wow2Depth: [0.0002, 0.0005],
    apfStages: 4,
    haasMs: [0.06, 0.12],
    eqModDb: 0.55,
    drive: 1.12,
    harmonicEven: 0.008,
    maskedNoiseDb: -58.0,
    sideAirGain: 0.12,
  },
  stealth: {
    speedRange: [1.0085, 1.0125],
    wow1Depth: [0.0012, 0.0018],
    wow2Depth: [0.0005, 0.0009],
    apfStages: 6,
    haasMs: [0.12, 0.22],
    eqModDb: 0.95,
    drive: 1.25,
    harmonicEven: 0.014,
    maskedNoiseDb: -50.0,
    sideAirGain: 0.20,
  },
  cloak: {
    speedRange: [1.0130, 1.0175],
    wow1Depth: [0.0018, 0.0026],
    wow2Depth: [0.0008, 0.0013],
    apfStages: 8,
    haasMs: [0.18, 0.32],
    eqModDb: 1.35,
    drive: 1.42,
    harmonicEven: 0.022,
    maskedNoiseDb: -44.0,
    sideAirGain: 0.28,
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
// Biquad Filter Design (RBJ Audio EQ Cookbook) & Zero-Phase / Causal Filtering
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

/** Direct Form II Transposed causal Biquad filter (used for All-Pass phase rotation & noise shaping). */
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

/** Forward-backward zero-phase Biquad filter (equivalent to 4th-order scipy.signal.filtfilt). */
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
// Core DSP v2 Pipeline
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

  onProgress?.('[1/5] Analizando envolvente y energía RMS del master...');
  await yieldToUi();

  // Extract stereo channels (duplicate mono to stereo if input is 1ch so stereo phase network works)
  const rawCh0 = audioBuffer.getChannelData(0);
  const rawCh1 = numChannels > 1 ? audioBuffer.getChannelData(1) : rawCh0;
  const length = rawCh0.length;

  let sumSqIn = 0.0;
  for (let i = 0; i < length; i++) {
    sumSqIn += 0.5 * (rawCh0[i] * rawCh0[i] + rawCh1[i] * rawCh1[i]);
  }
  const inputRms = Math.sqrt(sumSqIn / Math.max(1, length)) + 1e-9;

  // -------------------------------------------------------------------------
  // Stage 1: Cubic Catmull-Rom Non-Linear Time Warping (Dual Irrational LFOs)
  // -------------------------------------------------------------------------
  onProgress?.(`[2/5] Time-Warping Polifásico Cubic Spline (${preset.toUpperCase()})...`);
  await yieldToUi();

  const baseSpeed = rng.uniform(cfg.speedRange[0], cfg.speedRange[1]);
  const wow1Freq = rng.uniform(0.031, 0.067);
  const wow2Freq = rng.uniform(0.103, 0.179);
  const wow1Depth = rng.uniform(cfg.wow1Depth[0], cfg.wow1Depth[1]);
  const wow2Depth = rng.uniform(cfg.wow2Depth[0], cfg.wow2Depth[1]);
  const phi1 = rng.uniform(0, 2.0 * Math.PI);
  const phi2 = rng.uniform(0, 2.0 * Math.PI);

  const w1 = (2.0 * Math.PI * wow1Freq) / sr;
  const w2 = (2.0 * Math.PI * wow2Freq) / sr;
  const amp1 = wow1Depth / w1;
  const amp2 = wow2Depth / w2;

  const estOutLen = Math.floor((length - 4) / baseSpeed);
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
  let chL = cubicCatmullRomResample(rawCh0, tWarp);
  let chR = cubicCatmullRomResample(rawCh1, tWarp);
  const nOut = chL.length;

  // -------------------------------------------------------------------------
  // Stage 2: Dynamic Spectral Constellation Perturbation (3-Band Orthogonal LFOs)
  // -------------------------------------------------------------------------
  onProgress?.('[3/5] Perturbación de Constelación Espectral (3 bandas dinámicas)...');
  await yieldToUi();

  const bpLowMid = designBandpassBiquad(240, 850, sr);
  const bpPresence = designBandpassBiquad(1100, 4200, sr);
  const bpAir = designBandpassBiquad(5200, 13500, sr);

  const modAmp = Math.pow(10.0, cfg.eqModDb / 20.0) - 1.0;
  const wLm = (2.0 * Math.PI * rng.uniform(0.04, 0.09)) / sr;
  const wPr = (2.0 * Math.PI * rng.uniform(0.06, 0.13)) / sr;
  const wAir = (2.0 * Math.PI * rng.uniform(0.08, 0.16)) / sr;
  const pLm = rng.uniform(0, 2.0 * Math.PI);
  const pPr = rng.uniform(0, 2.0 * Math.PI);
  const pAir = rng.uniform(0, 2.0 * Math.PI);

  for (const ch of [chL, chR]) {
    const bandLm = applyBiquadZeroPhase(ch, bpLowMid);
    const bandPr = applyBiquadZeroPhase(ch, bpPresence);
    const bandAir = applyBiquadZeroPhase(ch, bpAir);
    for (let i = 0; i < nOut; i++) {
      const lfoLm = Math.sin(wLm * i + pLm);
      const lfoPr = Math.cos(wPr * i + pPr);
      const lfoAir = Math.sin(wAir * i + pAir);
      ch[i] +=
        modAmp * lfoLm * bandLm[i] -
        modAmp * 0.85 * lfoPr * bandPr[i] +
        modAmp * 0.9 * lfoAir * bandAir[i];
    }
  }

  // -------------------------------------------------------------------------
  // Stage 3: Mid/Side Sub-Bass Mono Lock (<120Hz) + Asymmetric Stereo All-Pass Network
  // -------------------------------------------------------------------------
  onProgress?.(`[4/5] Dispersión de Fase Estéreo Asimétrica (${cfg.apfStages} etapas APF + Micro-Haas)...`);
  await yieldToUi();

  const mid = new Float32Array(nOut);
  let side = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    mid[i] = 0.5 * (chL[i] + chR[i]);
    side[i] = 0.5 * (chL[i] - chR[i]);
  }

  // Lock sub-bass (<120 Hz) in pure mono
  const hpSide120 = designHighpassBiquad(120, 0.7071, sr);
  side = applyBiquadZeroPhase(side, hpSide120);

  // Subtle high-frequency stereo air shelf (>5.5 kHz)
  const hpSideAir = designHighpassBiquad(5500, 0.7071, sr);
  const sideHighs = applyBiquadCausal(side, hpSideAir);
  const sideAirGain = cfg.sideAirGain;
  for (let i = 0; i < nOut; i++) {
    const s = side[i] + sideAirGain * sideHighs[i];
    chL[i] = mid[i] + s;
    chR[i] = mid[i] - s;
  }

  // Crossover at 200 Hz so asymmetric phase dispersion only affects >200 Hz
  const lp200 = designLowpassBiquad(200, 0.7071, sr);
  const hp200 = designHighpassBiquad(200, 0.7071, sr);

  const lowL = applyBiquadZeroPhase(chL, lp200);
  const lowR = applyBiquadZeroPhase(chR, lp200);
  let highL = applyBiquadZeroPhase(chL, hp200);
  let highR = applyBiquadZeroPhase(chR, hp200);

  // Decoupled All-Pass Cascades for L and R (L != R)
  const apfStages = cfg.apfStages;
  for (let s = 0; s < apfStages; s++) {
    const ratio = s / Math.max(1, apfStages - 1);
    const baseFreq = 320.0 * Math.pow(10500.0 / 320.0, ratio);
    const fcL = Math.min(14000, Math.max(260, baseFreq * rng.uniform(0.88, 1.14)));
    const fcR = Math.min(14000, Math.max(260, baseFreq * rng.uniform(0.88, 1.14)));
    const qL = rng.uniform(0.55, 1.65);
    const qR = rng.uniform(0.55, 1.65);

    highL = applyBiquadCausal(highL, designAllpassBiquad(fcL, qL, sr));
    highR = applyBiquadCausal(highR, designAllpassBiquad(fcR, qR, sr));
  }

  // Sub-millisecond Micro-Haas fractional delay on Right channel high band
  const haasSamples = rng.uniform(cfg.haasMs[0], cfg.haasMs[1]) * (sr / 1000.0);
  const idxR = new Float64Array(nOut);
  for (let i = 0; i < nOut; i++) idxR[i] = i - haasSamples;
  highR = cubicCatmullRomResample(highR, idxR);

  for (let i = 0; i < nOut; i++) {
    chL[i] = lowL[i] + highL[i];
    chR[i] = lowR[i] + highR[i];
  }

  // -------------------------------------------------------------------------
  // Stage 4 & 5: Envelope-Gated Psychoacoustic Masking, Warm Saturation & True-Peak Master
  // -------------------------------------------------------------------------
  onProgress?.('[5/5] Enmascaramiento Psicoacústico Dinámico, Master True-Peak y Codificación...');
  await yieldToUi();

  const monoAbs = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    monoAbs[i] = 0.5 * (Math.abs(chL[i]) + Math.abs(chR[i]));
  }
  const lpEnv = designLowpassBiquad(18, 0.7071, sr);
  const env = applyBiquadCausal(monoAbs, lpEnv);
  let envPeak = 1e-9;
  for (let i = 0; i < nOut; i++) {
    if (env[i] > envPeak) envPeak = env[i];
  }

  // Band-limited noise (180 Hz - 14 kHz)
  const bpNoise = designBandpassBiquad(180, 14000, sr);
  const noiseL = new Float32Array(nOut);
  const noiseR = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    noiseL[i] = rng.normal();
    noiseR[i] = rng.normal();
  }
  const shapedNoiseL = applyBiquadCausal(noiseL, bpNoise);
  const shapedNoiseR = applyBiquadCausal(noiseR, bpNoise);

  const drive = cfg.drive;
  const invTanhDrive = 1.0 / Math.tanh(drive);
  const evenK = cfg.harmonicEven;
  const noiseScalar = Math.pow(10.0, cfg.maskedNoiseDb / 20.0) * inputRms * 3.0;

  for (let i = 0; i < nOut; i++) {
    const envNorm = Math.min(1.0, Math.max(0.0, env[i] / envPeak));
    const gate = Math.min(1.0, Math.max(0.0, (monoAbs[i] - 0.0015) / 0.008));
    const envGated = envNorm * gate;

    const xL = chL[i];
    const xR = chR[i];
    chL[i] = Math.tanh(drive * xL) * invTanhDrive + evenK * xL * xL * envGated + shapedNoiseL[i] * envGated * noiseScalar;
    chR[i] = Math.tanh(drive * xR) * invTanhDrive + evenK * xR * xR * envGated + shapedNoiseR[i] * envGated * noiseScalar;
  }

  // Master protection filters: Subsonic 22 Hz HPF & Ultrasonic 19.2 kHz LPF
  const hpMaster22 = designHighpassBiquad(22, 0.7071, sr);
  const lpMaster19k = designLowpassBiquad(Math.min(19200, sr * 0.46), 0.7071, sr);
  chL = applyBiquadZeroPhase(chL, hpMaster22);
  chR = applyBiquadZeroPhase(chR, hpMaster22);
  chL = applyBiquadZeroPhase(chL, lpMaster19k);
  chR = applyBiquadZeroPhase(chR, lpMaster19k);

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

  // TPDF Triangular Dither (-84 dBFS) & True-Peak Soft-Knee Limiter at -0.3 dBFS (0.966)
  const ditherAmp = Math.pow(10.0, -84.0 / 20.0);
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

  // Encode to target format
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

  return {
    blob,
    format,
    sampleRate: sr,
    durationSeconds: Number((nOut / sr).toFixed(2)),
    preset,
    speedShiftPct,
    peakDbtp,
    apfStages,
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
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true); // 16-bit
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

// CRC-8 (poly 0x07) & CRC-16 (poly 0x8005) tables for RFC 9639 FLAC frames
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

  // 1. fLaC magic + STREAMINFO block (42 bytes)
  const streamInfo = new Uint8Array(42);
  streamInfo[0] = 0x66; // 'f'
  streamInfo[1] = 0x4c; // 'L'
  streamInfo[2] = 0x61; // 'a'
  streamInfo[3] = 0x43; // 'C'
  streamInfo[4] = 0x80; // Last metadata block + type 0 (STREAMINFO)
  streamInfo[5] = 0x00;
  streamInfo[6] = 0x00;
  streamInfo[7] = 34;   // Length = 34 bytes
  // min/max block size = 4096 (0x1000)
  streamInfo[8] = 0x10;
  streamInfo[9] = 0x00;
  streamInfo[10] = 0x10;
  streamInfo[11] = 0x00;
  // sample_rate (20 bits) | channels-1 (3 bits = 1) | bps-1 (5 bits = 23) | total_samples (36 bits)
  const sr20 = sr & 0xfffff;
  const ch3 = 1;  // 2 channels - 1
  const bps5 = 23; // 24 bits - 1
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

  // 2. Encode frames
  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    const count = Math.min(blockSize, totalSamples - start);
    const utf8Bytes = writeUtf8FrameNum(b);

    // Block size code: 0x06 means 8-bit (blockSize-1) follows, 0x07 means 16-bit (blockSize-1) follows
    const bsCode = 0x07;
    // Sample rate code: 0x09 = 44.1kHz, 0x0a = 48kHz, 0x00 = get from STREAMINFO
    const srCode = sr === 44100 ? 0x09 : sr === 48000 ? 0x0a : 0x00;

    const headerLen = 4 + utf8Bytes.length + 2 + 1; // sync(2) + desc(2) + utf8 + bs16(2) + crc8(1)
    const frameLen = headerLen + 2 * (1 + count * 3) + 2; // 2 verbatim subframes + crc16(2)
    const frame = new Uint8Array(frameLen);

    let p = 0;
    frame[p++] = 0xff;
    frame[p++] = 0xf8; // Fixed-blocksize stream sync
    frame[p++] = (bsCode << 4) | srCode;
    frame[p++] = (0x01 << 4) | (0x06 << 1) | 0x00; // Stereo (L,R) | 24-bit (0b110) | reserved 0
    for (const ub of utf8Bytes) frame[p++] = ub;
    const bsMinus1 = count - 1;
    frame[p++] = (bsMinus1 >> 8) & 0xff;
    frame[p++] = bsMinus1 & 0xff;

    let crc8 = 0;
    for (let i = 0; i < p; i++) crc8 = FLAC_CRC8_TABLE[crc8 ^ frame[i]];
    frame[p++] = crc8;

    // Subframe 0 (Left) & Subframe 1 (Right) — SUBFRAME_VERBATIM (header byte = 0x02)
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
