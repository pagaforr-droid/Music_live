import { buildCrossfadedLoopArrays } from './LoopCrossfade';
import { normalizeStereoInPlace, removeDcOffsetInPlace } from './SampleBufferOps';

export type ProBassPresetId =
  | 'inst-bass-astra-sub'
  | 'inst-bass-astra-pluck'
  | 'inst-bass-sh101-funk'
  | 'inst-bass-juno-chorus'
  | 'inst-bass-jupiter-fat'
  | 'inst-bass-monark-sub'
  | 'inst-bass-90s-pad'
  | 'inst-bass-autowah'
  | 'inst-bass-suboctave';

export interface SynthBassZoneResult {
  rootMidi: number;
  left: Float32Array;
  right: Float32Array;
  peakOffsetSamples: number;
  loopStartSample?: number;
  loopEndSample?: number;
}

function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1.0;
  }
  if (t > 1.0 - dt) {
    const x = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0;
}

function blepSaw(phase: number, dt: number): number {
  return 2.0 * phase - 1.0 - polyBlep(phase, dt);
}

function blepPulse(phase: number, dt: number, duty: number): number {
  const dcComp = 2.0 * duty - 1.0;
  const raw = phase < duty ? 1.0 : -1.0;
  let shifted = phase + 1.0 - duty;
  if (shifted >= 1.0) shifted -= 1.0;
  return raw + polyBlep(phase, dt) - polyBlep(shifted, dt) - dcComp;
}

function triWave(phase: number): number {
  return phase < 0.5 ? 4.0 * phase - 1.0 : 3.0 - 4.0 * phase;
}

/**
 * 2x-Oversampled 4-Pole TPT/ZDF Nonlinear Moog-Style Ladder Filter
 * with exact DC passband gain compensation across resonance settings.
 */
class NonlinearLadderFilter {
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private s4 = 0;
  private readonly sr2: number;

  constructor(sampleRate: number) {
    this.sr2 = sampleRate * 2;
  }

  public process(
    input: number,
    cutoffHz: number,
    resonance01: number,
    drive = 1.25
  ): number {
    const fc = Math.max(25, Math.min(this.sr2 * 0.21, cutoffHz));
    const g = Math.tan((Math.PI * fc) / this.sr2);
    const G = g / (1 + g);
    const oneMinusG = 1 - G;
    const G2 = G * G;
    const G3 = G2 * G;
    const G4 = G2 * G2;
    const k = Math.max(0, Math.min(3.55, resonance01 * 3.55));
    const invDrive = 1 / Math.max(0.5, drive);

    let out = 0;
    for (let pass = 0; pass < 2; pass++) {
      const S = oneMinusG * (G3 * this.s1 + G2 * this.s2 + G * this.s3 + this.s4);
      const u = (input * (1 + k) - k * S) / (1 + k * G4);
      const satU = Math.tanh(u * drive) * invDrive;

      const v1 = (satU - this.s1) * G;
      const y1 = v1 + this.s1;
      this.s1 = y1 + v1;

      const v2 = (y1 - this.s2) * G;
      const y2 = v2 + this.s2;
      this.s2 = y2 + v2;

      const v3 = (y2 - this.s3) * G;
      const y3 = v3 + this.s3;
      this.s3 = y3 + v3;

      const v4 = (y3 - this.s4) * G;
      const y4 = v4 + this.s4;
      this.s4 = y4 + v4;
      out = y4;
    }
    return out;
  }
}

/**
 * Unconditionally stable Cytomic / TPT State-Variable Filter for Auto-Wah resonant sweeps.
 */
class CytomicSvfFilter {
  private ic1eq = 0;
  private ic2eq = 0;
  private readonly sr: number;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
  }

  public process(
    x: number,
    cutoffHz: number,
    q: number
  ): { low: number; band: number } {
    const fc = Math.max(30, Math.min(this.sr * 0.36, cutoffHz));
    const g = Math.tan((Math.PI * fc) / this.sr);
    const k = 1 / Math.max(0.5, q);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;

    const v3 = x - this.ic2eq;
    const v1 = a1 * this.ic1eq + a2 * v3;
    const v2 = this.ic2eq + a2 * this.ic1eq + a3 * v3;
    this.ic1eq = 2 * v1 - this.ic1eq;
    this.ic2eq = 2 * v2 - this.ic2eq;

    return { low: v2, band: v1 };
  }
}

/**
 * Dual-LFO Stereo BBD Analog Chorus with strictly mono phase-coherent sub (<125 Hz)
 * so club low-end never suffers stereo phase cancellation.
 */
function applyMonoSafeBbdChorus(
  mono: Float32Array,
  leftOut: Float32Array,
  rightOut: Float32Array,
  sr: number,
  options: {
    baseDelayMs: number;
    depthMs: number;
    lfoHzL: number;
    lfoHzR: number;
    wetMix: number;
  }
): void {
  const len = mono.length;
  const ringSize = 4096;
  const ring = new Float32Array(ringSize);
  const baseSamples = (options.baseDelayMs / 1000) * sr;
  const depthSamples = (options.depthMs / 1000) * sr;

  // 2-pole cascaded LPF at 125Hz for rock-solid mono sub split
  const subAlpha = (2 * Math.PI * 125) / (sr + 2 * Math.PI * 125);
  let lp1 = 0;
  let lp2 = 0;
  let writeIdx = 0;

  const readInterpolated = (delaySamples: number): number => {
    const clamped = Math.max(1, Math.min(ringSize - 3, delaySamples));
    const readPos = (writeIdx - clamped + ringSize) % ringSize;
    const i0 = Math.floor(readPos);
    const i1 = (i0 + 1) % ringSize;
    const frac = readPos - i0;
    return ring[i0] * (1 - frac) + ring[i1] * frac;
  };

  for (let i = 0; i < len; i++) {
    const x = mono[i];
    lp1 += subAlpha * (x - lp1);
    lp2 += subAlpha * (lp1 - lp2);
    const lowMono = lp2;
    const highMono = x - lowMono;

    ring[writeIdx] = highMono;
    const t = i / sr;
    const dL = baseSamples + depthSamples * Math.sin(2 * Math.PI * options.lfoHzL * t);
    const dR =
      baseSamples +
      depthSamples * Math.sin(2 * Math.PI * options.lfoHzR * t + Math.PI * 0.88);

    const wL = readInterpolated(dL);
    const wR = readInterpolated(dR);

    leftOut[i] = lowMono + highMono * (1 - options.wetMix * 0.35) + wL * options.wetMix;
    rightOut[i] = lowMono + highMono * (1 - options.wetMix * 0.35) + wR * options.wetMix;

    writeIdx = (writeIdx + 1) % ringSize;
  }
}

function findInitialPeakSample(
  left: Float32Array,
  right: Float32Array,
  sr: number
): number {
  const lim = Math.min(left.length, Math.round(sr * 0.025));
  let peakIdx = Math.round(sr * 0.003);
  let maxA = 0;
  for (let i = 0; i < lim; i++) {
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (a > maxA) {
      maxA = a;
      peakIdx = i;
    }
  }
  return peakIdx;
}

/**
 * 4th-order (24 dB/oct) M/S Bass Mono-Maker: strips Side energy below cutoffHz
 * so stereo basses (Juno-106 Chorus, 90s Pad, Astra Pluck, Jupiter-8) stay
 * phase-coherent in mono club PAs while keeping upper harmonics lush and wide.
 */
function applyStereoSubMonoMaker(
  left: Float32Array,
  right: Float32Array,
  sr: number,
  cutoffHz = 210
): void {
  const len = left.length;
  const w0 = (2 * Math.PI * cutoffHz) / sr;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = ((1 + cosW0) * 0.5) / a0;
  const b1 = -(1 + cosW0) / a0;
  const b2 = b0;
  const a1 = (-2 * cosW0) / a0;
  const a2 = (1 - alpha) / a0;

  let x1A = 0, x2A = 0, y1A = 0, y2A = 0;
  let x1B = 0, x2B = 0, y1B = 0, y2B = 0;

  for (let i = 0; i < len; i++) {
    const mid = 0.5 * (left[i] + right[i]);
    const side = 0.5 * (left[i] - right[i]);

    const sA = b0 * side + b1 * x1A + b2 * x2A - a1 * y1A - a2 * y2A;
    x2A = x1A;
    x1A = side;
    y2A = y1A;
    y1A = sA;

    const sB = b0 * sA + b1 * x1B + b2 * x2B - a1 * y1B - a2 * y2B;
    x2B = x1B;
    x1B = sA;
    y2B = y1B;
    y1B = sB;

    left[i] = mid + sB;
    right[i] = mid - sB;
  }
}

function finalizeZoneBuffers(
  left: Float32Array,
  right: Float32Array,
  midiRoot: number,
  sr: number,
  options: {
    targetDb: number;
    loopStartSec?: number;
    loopEndSec?: number;
  }
): SynthBassZoneResult {
  const len = left.length;
  applyStereoSubMonoMaker(left, right, sr, 135);

  // End de-click fade
  const fadeSamples = Math.min(Math.floor(len * 0.1), Math.round(sr * 0.08));
  for (let i = 0; i < fadeSamples; i++) {
    const g = i / Math.max(1, fadeSamples);
    left[len - 1 - i] *= g;
    right[len - 1 - i] *= g;
  }

  removeDcOffsetInPlace(left, right);
  normalizeStereoInPlace(left, right, options.targetDb);

  let loopStartSample: number | undefined;
  let loopEndSample: number | undefined;
  if (
    options.loopStartSec !== undefined &&
    options.loopEndSec !== undefined &&
    options.loopEndSec > options.loopStartSec + 0.2
  ) {
    loopStartSample = Math.round(options.loopStartSec * sr);
    loopEndSample = Math.min(len - 8, Math.round(options.loopEndSec * sr));
    const xf = buildCrossfadedLoopArrays(
      left,
      right,
      sr,
      loopStartSample,
      loopEndSample,
      36
    );
    left.set(xf.left, loopStartSample);
    right.set(xf.right, loopStartSample);
  }

  return {
    rootMidi: midiRoot,
    left,
    right,
    peakOffsetSamples: findInitialPeakSample(left, right, sr),
    loopStartSample,
    loopEndSample,
  };
}

/**
 * Synthesizes 48kHz multi-zone professional synth bass timbres covering:
 * - Astra-style FM + Wavetable Hybrid (Sub & Modern Mix-Cutting Pluck)
 * - Roland-style Classic Analog (SH-101 Disco-Funk, Juno-106 Chorus, Jupiter-8 Fat Pop, 90s Bass Pad)
 * - Monark/Minimoog-style 3-Oscillator Thick Ladder Sub (built to stack under acoustic basses)
 * - Auto-Wah Envelope Funk & Sub-Octave Analog FX Basses
 */
export function synthesizeProBassZone(
  id: ProBassPresetId,
  midiRoot: number,
  sr: number
): SynthBassZoneResult {
  const f0 = 440 * Math.pow(2, (midiRoot - 69) / 12);
  const nyquistSafe = sr * 0.43;
  const isSustained =
    id === 'inst-bass-astra-sub' ||
    id === 'inst-bass-juno-chorus' ||
    id === 'inst-bass-jupiter-fat' ||
    id === 'inst-bass-monark-sub' ||
    id === 'inst-bass-90s-pad' ||
    id === 'inst-bass-suboctave';

  const durSec = isSustained ? 2.6 : 2.35;
  const len = Math.floor(sr * durSec);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const mono = new Float32Array(len);

  const ladder = new NonlinearLadderFilter(sr);
  const ladderR = new NonlinearLadderFilter(sr);
  const svf = new CytomicSvfFilter(sr);

  let p1 = 0;
  let p2 = 0.17;
  let p3 = 0.43;
  let pSub = 0;

  if (id === 'inst-bass-astra-sub') {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const dt = f0 / sr;
      p1 = (p1 + dt) % 1;
      const modIdx = 1.65 * Math.exp(-t * 28);
      const fm = Math.sin(2 * Math.PI * p1 + modIdx * Math.sin(4 * Math.PI * p1));
      const cleanSub = Math.sin(2 * Math.PI * p1);
      // Controlled wavetable upper harmonic sheen (2nd + 3rd) so sub translates on small speakers
      const wtSheen =
        (0.24 * Math.sin(4 * Math.PI * p1) + 0.11 * Math.sin(6 * Math.PI * p1)) *
        (0.45 + 0.55 * Math.exp(-t * 6.5));
      const raw = cleanSub * 0.62 + fm * 0.28 + wtSheen;
      const filtered = ladder.process(
        raw,
        Math.min(nyquistSafe, f0 * (2.6 + 6.0 * Math.exp(-t * 18))),
        0.16,
        1.2
      );
      const atk = Math.min(1, i / (sr * 0.0025));
      const v = Math.tanh((cleanSub * 0.32 + filtered * 0.78) * 1.12) * atk;
      L[i] = v;
      R[i] = v;
    }
    return finalizeZoneBuffers(L, R, midiRoot, sr, {
      targetDb: -1.5,
      loopStartSec: 0.55,
      loopEndSec: 1.95,
    });
  }

  if (id === 'inst-bass-astra-pluck') {
    const dt0 = f0 / sr;
    const dt1 = (f0 * 0.9975) / sr;
    const dt2 = (f0 * 1.0025) / sr;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      p1 = (p1 + dt1) % 1;
      p2 = (p2 + dt2) % 1;
      pSub = (pSub + dt0) % 1;

      const fmIndex = 2.35 * Math.exp(-t * 21);
      const fmLayer = Math.sin(2 * Math.PI * pSub + fmIndex * Math.sin(4 * Math.PI * pSub));
      const wtL = blepSaw(p1, dt1) * 0.65 + blepPulse(p2, dt2, 0.34) * 0.35;
      const wtR = blepSaw(p2, dt2) * 0.65 + blepPulse(p1, dt1, 0.34) * 0.35;
      const subAnchor = Math.sin(2 * Math.PI * pSub) * 0.45;

      const cutoff = Math.min(nyquistSafe, f0 * (2.0 + 13.5 * Math.exp(-t * 14.5)));
      const fL = ladder.process(wtL * 0.55 + fmLayer * 0.35, cutoff, 0.28, 1.35);
      const fR = ladderR.process(wtR * 0.55 + fmLayer * 0.35, cutoff, 0.28, 1.35);

      const atk = Math.min(1, i / (sr * 0.002));
      const ampEnv = Math.exp(-t * 1.65);
      L[i] = Math.tanh((fL * 0.78 + subAnchor) * 1.15) * atk * ampEnv;
      R[i] = Math.tanh((fR * 0.78 + subAnchor) * 1.15) * atk * ampEnv;
    }
    return finalizeZoneBuffers(L, R, midiRoot, sr, { targetDb: -1.5 });
  }

  if (id === 'inst-bass-sh101-funk') {
    const dt = f0 / sr;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      p1 = (p1 + dt) % 1;
      const saw = blepSaw(p1, dt);
      const pulse = blepPulse(p1, dt, 0.36);
      const subSq = blepPulse(p1, dt, 0.5);
      const oscMix = saw * 0.48 + pulse * 0.26 + subSq * 0.32;

      const cutoff = Math.min(nyquistSafe, f0 * (1.95 + 10.5 * Math.exp(-t * 16.0)));
      const filtered = ladder.process(oscMix, cutoff, 0.44, 1.3);
      const subPunch = Math.sin(2 * Math.PI * p1) * 0.36;
      const atk = Math.min(1, i / (sr * 0.0022));
      const env = 0.22 + 0.78 * Math.exp(-t * 2.15);
      const v = Math.tanh((filtered * 0.8 + subPunch) * 1.15) * atk * env;
      L[i] = v;
      R[i] = v;
    }
    return finalizeZoneBuffers(L, R, midiRoot, sr, { targetDb: -1.5 });
  }

  if (id === 'inst-bass-juno-chorus') {
    const dt = f0 / sr;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      p1 = (p1 + dt) % 1;
      const duty = 0.46 + 0.14 * Math.sin(2 * Math.PI * 1.0 * t);
      const dco = blepSaw(p1, dt) * 0.5 + blepPulse(p1, dt, duty) * 0.34;
      const sub = Math.sin(2 * Math.PI * p1) * 0.42;
      const cutoff = Math.min(nyquistSafe, f0 * (3.15 + 5.2 * Math.exp(-t * 7.5)));
      const filtered = ladder.process(dco + sub * 0.45, cutoff, 0.22, 1.18);
      const atk = Math.min(1, i / (sr * 0.004));
      mono[i] = Math.tanh((filtered * 0.82 + sub * 0.35) * 1.08) * atk;
    }
    applyMonoSafeBbdChorus(mono, L, R, sr, {
      baseDelayMs: 5.8,
      depthMs: 2.1,
      lfoHzL: 0.714, // ~1 cycle per 1.4s loop window for clean wrap
      lfoHzR: 0.714,
      wetMix: 0.72,
    });
    return finalizeZoneBuffers(L, R, midiRoot, sr, {
      targetDb: -2.0,
      loopStartSec: 0.55,
      loopEndSec: 1.95,
    });
  }

  if (id === 'inst-bass-jupiter-fat') {
    const dt0 = f0 / sr;
    const dt1 = (f0 * 0.9955) / sr;
    const dt2 = (f0 * 1.0045) / sr;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      p1 = (p1 + dt1) % 1;
      p2 = (p2 + dt2) % 1;
      pSub = (pSub + dt0) % 1;

      const vco1 = blepSaw(p1, dt1) * 0.65 + blepPulse(p1, dt1, 0.42) * 0.35;
      const vco2 = blepSaw(p2, dt2) * 0.65 + blepPulse(p2, dt2, 0.42) * 0.35;
      const subAnchor = Math.sin(2 * Math.PI * pSub) * 0.45;
      const cutoff = Math.min(nyquistSafe, f0 * (2.5 + 7.2 * Math.exp(-t * 6.8)));

      const fL = ladder.process(vco1 * 0.62 + vco2 * 0.25 + subAnchor * 0.5, cutoff, 0.26, 1.32);
      const fR = ladderR.process(vco2 * 0.62 + vco1 * 0.25 + subAnchor * 0.5, cutoff, 0.26, 1.32);
      const atk = Math.min(1, i / (sr * 0.0045));
      L[i] = Math.tanh((fL * 0.8 + subAnchor * 0.35) * 1.1) * atk;
      R[i] = Math.tanh((fR * 0.8 + subAnchor * 0.35) * 1.1) * atk;
    }
    return finalizeZoneBuffers(L, R, midiRoot, sr, {
      targetDb: -2.0,
      loopStartSec: 0.55,
      loopEndSec: 1.95,
    });
  }

  if (id === 'inst-bass-monark-sub') {
    const dt0 = f0 / sr;
    const dt2 = (f0 * 0.997) / sr;
    const dt3 = (f0 * 1.0035) / sr;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      p1 = (p1 + dt0) % 1;
      p2 = (p2 + dt2) % 1;
      p3 = (p3 + dt3) % 1;

      const osc1 = triWave(p1) * 0.44 + Math.sin(2 * Math.PI * p1) * 0.56;
      const osc2 = blepSaw(p2, dt2);
      const osc3 = blepPulse(p3, dt3, 0.42);
      const stack = osc1 * 0.58 + osc2 * 0.34 + osc3 * 0.24;

      const cutoff = Math.min(nyquistSafe, f0 * (1.85 + 4.4 * Math.exp(-t * 8.2)));
      const laddered = ladder.process(stack, cutoff, 0.3, 1.65);
      const atk = Math.min(1, i / (sr * 0.0035));
      const v = Math.tanh((laddered * 0.85 + Math.sin(2 * Math.PI * p1) * 0.25) * 1.15) * atk;
      L[i] = v;
      R[i] = v;
    }
    return finalizeZoneBuffers(L, R, midiRoot, sr, {
      targetDb: -1.5,
      loopStartSec: 0.55,
      loopEndSec: 1.95,
    });
  }

  if (id === 'inst-bass-90s-pad') {
    const dt0 = f0 / sr;
    const dt1 = (f0 * 0.9965) / sr;
    const dt2 = (f0 * 1.0035) / sr;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      pSub = (pSub + dt0) % 1;
      p1 = (p1 + dt1) % 1;
      p2 = (p2 + dt2) % 1;

      const organCore =
        Math.sin(2 * Math.PI * pSub) * 0.62 +
        Math.sin(4 * Math.PI * pSub) * 0.26 +
        Math.sin(6 * Math.PI * pSub) * 0.1;
      const padSaws = (blepSaw(p1, dt1) + blepSaw(p2, dt2)) * 0.24;
      const swell = 1 - Math.exp(-t * 24);
      const cutoff = Math.min(nyquistSafe, f0 * (2.8 + 3.6 * swell * Math.exp(-t * 1.8)));
      const filtered = ladder.process(organCore * 0.6 + padSaws, cutoff, 0.18, 1.15);
      const atk = Math.min(1, i / (sr * 0.016));
      mono[i] = Math.tanh((filtered * 0.78 + organCore * 0.35) * 1.08) * atk;
    }
    applyMonoSafeBbdChorus(mono, L, R, sr, {
      baseDelayMs: 6.2,
      depthMs: 1.9,
      lfoHzL: 0.714,
      lfoHzR: 0.714,
      wetMix: 0.65,
    });
    return finalizeZoneBuffers(L, R, midiRoot, sr, {
      targetDb: -2.0,
      loopStartSec: 0.6,
      loopEndSec: 2.0,
    });
  }

  if (id === 'inst-bass-autowah') {
    const dt = f0 / sr;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      p1 = (p1 + dt) % 1;
      const src = blepSaw(p1, dt) * 0.58 + blepPulse(p1, dt, 0.48) * 0.42;
      const subClean = Math.sin(2 * Math.PI * p1) * 0.42;

      // Expressive funky "bwow" envelope sweep: brisk 18ms attack up, 165ms resonant squelch down
      const wahRise = 1 - Math.exp(-t * 145);
      const wahFall = Math.exp(-t * 7.2);
      const wahEnv = wahRise * wahFall;
      const wahCut = Math.min(nyquistSafe, f0 * (1.7 + 11.5 * wahEnv));

      const { low, band } = svf.process(src, wahCut, 4.4);
      const wahMix = low * 0.55 + band * 0.68;
      const atk = Math.min(1, i / (sr * 0.0025));
      const ampEnv = 0.25 + 0.75 * Math.exp(-t * 1.9);
      const v = Math.tanh((wahMix * 0.78 + subClean) * 1.18) * atk * ampEnv;
      L[i] = v;
      R[i] = v;
    }
    return finalizeZoneBuffers(L, R, midiRoot, sr, { targetDb: -1.5 });
  }

  // inst-bass-suboctave
  const dt = f0 / sr;
  const dtOct = (f0 * 0.5) / sr;
  // Attenuate -1 octave fundamental gracefully when sub frequency falls below 30Hz
  const subFreq = f0 * 0.5;
  const subSafeGain = 0.52 * (1 - Math.exp(-Math.pow(subFreq / 28, 2)));
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    p1 = (p1 + dt) % 1;
    pSub = (pSub + dtOct) % 1;

    const mainVoice = blepSaw(p1, dt) * 0.45 + Math.sin(2 * Math.PI * p1) * 0.55;
    const octDivider =
      (Math.sin(2 * Math.PI * pSub) * 0.72 + triWave(pSub) * 0.28) * subSafeGain;
    const cutoff = Math.min(nyquistSafe, f0 * (2.0 + 3.0 * Math.exp(-t * 9.0)));
    const filtered = ladder.process(mainVoice + octDivider, cutoff, 0.2, 1.38);
    const atk = Math.min(1, i / (sr * 0.003));
    const v = Math.tanh(filtered * 1.15) * atk;
    L[i] = v;
    R[i] = v;
  }
  return finalizeZoneBuffers(L, R, midiRoot, sr, {
    targetDb: -1.5,
    loopStartSec: 0.55,
    loopEndSec: 1.95,
  });
}
