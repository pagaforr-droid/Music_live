import { buildHannWindow, fftInPlace, ifftInPlace } from './SpectralFftCore';

/**
 * Pure TypeScript Time-Stretch / Pitch-Shift / Granular Engines
 * shared by Sample Lab AudioWorklets and Offline Bounce Renderer.
 *
 * Includes:
 * 1. WSOLA (Waveform Similarity Overlap-Add) — crisp transient-preserving stretch for drums/loops.
 * 2. Phase Vocoder (STFT + peak phase locking) — smooth tonal time-stretch / pitch-shift.
 * 3. Granular / Paulstretch synthesizer — lush pads & sound-design textures from any slice.
 */

export function stretchAudioWsola(
  inputL: Float32Array,
  inputR: Float32Array,
  sampleRate: number,
  timeStretchRatio: number // > 1 = slower/longer, < 1 = faster/shorter
): { left: Float32Array; right: Float32Array } {
  const len = inputL.length;
  const ratio = Math.max(0.25, Math.min(4.0, timeStretchRatio));
  if (len === 0 || Math.abs(ratio - 1.0) < 0.005) {
    return { left: new Float32Array(inputL), right: new Float32Array(inputR) };
  }

  const outLen = Math.max(1, Math.round(len * ratio));
  const outL = new Float32Array(outLen);
  const outR = new Float32Array(outLen);
  const normBuf = new Float32Array(outLen);

  const winSize = Math.max(256, Math.round(sampleRate * 0.028)); // 28ms window
  const synHop = Math.floor(winSize / 2);
  const anaHop = synHop / ratio;
  const searchRadius = Math.floor(winSize * 0.35);

  const win = buildHannWindow(winSize);
  let prevOffset = 0;

  for (let outPos = 0; outPos < outLen; outPos += synHop) {
    const targetIn = Math.round((outPos / synHop) * anaHop);

    // Search best correlation match with tail of previous synthesis frame
    let bestIn = Math.max(0, Math.min(len - winSize, targetIn));
    if (outPos > 0) {
      const refStart = Math.max(0, Math.min(len - synHop, prevOffset + synHop));
      const sMin = Math.max(0, targetIn - searchRadius);
      const sMax = Math.min(len - winSize, targetIn + searchRadius);
      let bestCorr = -Infinity;

      for (let cand = sMin; cand <= sMax; cand += 4) {
        let dot = 0;
        let e1 = 0;
        let e2 = 0;
        for (let k = 0; k < synHop; k += 2) {
          const a = inputL[refStart + k] + inputR[refStart + k];
          const b = inputL[cand + k] + inputR[cand + k];
          dot += a * b;
          e1 += a * a;
          e2 += b * b;
        }
        const denom = Math.sqrt(e1 * e2) + 1e-9;
        const normCorr = dot / denom;
        if (normCorr > bestCorr) {
          bestCorr = normCorr;
          bestIn = cand;
        }
      }
    }

    prevOffset = bestIn;
    const copyLen = Math.min(winSize, outLen - outPos, len - bestIn);
    for (let k = 0; k < copyLen; k++) {
      const w = win[k];
      outL[outPos + k] += inputL[bestIn + k] * w;
      outR[outPos + k] += inputR[bestIn + k] * w;
      normBuf[outPos + k] += w;
    }
  }

  for (let i = 0; i < outLen; i++) {
    const n = normBuf[i];
    if (n > 1e-4) {
      outL[i] /= n;
      outR[i] /= n;
    }
  }

  return { left: outL, right: outR };
}

/**
 * Resamples audio with 4-point Catmull-Rom cubic interpolation for varispeed / post-stretch pitch shifting.
 */
export function resampleCubicStereo(
  inputL: Float32Array,
  inputR: Float32Array,
  playbackRate: number // > 1 = higher pitch / shorter
): { left: Float32Array; right: Float32Array } {
  const len = inputL.length;
  const rate = Math.max(0.125, Math.min(8.0, playbackRate));
  if (len < 4 || Math.abs(rate - 1.0) < 1e-5) {
    return { left: new Float32Array(inputL), right: new Float32Array(inputR) };
  }

  const outLen = Math.max(1, Math.round(len / rate));
  const outL = new Float32Array(outLen);
  const outR = new Float32Array(outLen);

  const sampleAt = (arr: Float32Array, pos: number): number => {
    const i1 = Math.floor(pos);
    const t = pos - i1;
    const i0 = Math.max(0, i1 - 1);
    const i1c = Math.max(0, Math.min(len - 1, i1));
    const i2 = Math.min(len - 1, i1 + 1);
    const i3 = Math.min(len - 1, i1 + 2);
    const y0 = arr[i0];
    const y1 = arr[i1c];
    const y2 = arr[i2];
    const y3 = arr[i3];
    const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const a2 = -0.5 * y0 + 0.5 * y2;
    return ((a0 * t + a1) * t + a2) * t + y1;
  };

  for (let i = 0; i < outLen; i++) {
    const pos = i * rate;
    outL[i] = sampleAt(inputL, pos);
    outR[i] = sampleAt(inputR, pos);
  }

  return { left: outL, right: outR };
}

/**
 * Phase Vocoder STFT Time-Stretch (2048 FFT, 512 hop, horizontal phase propagation).
 * Preserves pitch cleanly when stretching tonal / vocal / pad material.
 */
export function stretchAudioPhaseVocoder(
  inputL: Float32Array,
  inputR: Float32Array,
  timeStretchRatio: number
): { left: Float32Array; right: Float32Array } {
  const ratio = Math.max(0.25, Math.min(6.0, timeStretchRatio));
  if (inputL.length === 0 || Math.abs(ratio - 1.0) < 0.005) {
    return { left: new Float32Array(inputL), right: new Float32Array(inputR) };
  }

  const fftSize = 2048;
  const synHop = 512;
  const anaHop = synHop / ratio;
  const half = fftSize / 2;
  const win = buildHannWindow(fftSize);
  const twoPi = 2 * Math.PI;
  const omega = new Float32Array(half + 1);
  for (let k = 0; k <= half; k++) omega[k] = (twoPi * k) / fftSize;

  const stretchChannel = (ch: Float32Array): Float32Array => {
    const outLen = Math.max(fftSize, Math.round(ch.length * ratio));
    const out = new Float32Array(outLen + fftSize);
    const norm = new Float32Array(outLen + fftSize);

    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const prevPhase = new Float32Array(half + 1);
    const sumPhase = new Float32Array(half + 1);

    const numFrames = Math.ceil(outLen / synHop);
    for (let f = 0; f < numFrames; f++) {
      const inStart = Math.min(Math.max(0, Math.round(f * anaHop)), Math.max(0, ch.length - fftSize));
      const outStart = f * synHop;

      for (let i = 0; i < fftSize; i++) {
        re[i] = (inStart + i < ch.length ? ch[inStart + i] : 0) * win[i];
        im[i] = 0;
      }

      fftInPlace(re, im);

      for (let k = 0; k <= half; k++) {
        const r = re[k];
        const m = im[k];
        const mag = Math.hypot(r, m);
        const phase = Math.atan2(m, r);

        if (f === 0) {
          sumPhase[k] = phase;
        } else {
          let delta = phase - prevPhase[k] - omega[k] * anaHop;
          delta -= twoPi * Math.round(delta / twoPi);
          const trueFreq = omega[k] + delta / anaHop;
          sumPhase[k] += trueFreq * synHop;
        }
        prevPhase[k] = phase;

        re[k] = mag * Math.cos(sumPhase[k]);
        im[k] = mag * Math.sin(sumPhase[k]);
        if (k > 0 && k < half) {
          re[fftSize - k] = re[k];
          im[fftSize - k] = -im[k];
        }
      }

      ifftInPlace(re, im);

      for (let i = 0; i < fftSize; i++) {
        const w = win[i];
        out[outStart + i] += re[i] * w;
        norm[outStart + i] += w * w;
      }
    }

    const trimmed = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      trimmed[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
    }
    return trimmed;
  };

  return {
    left: stretchChannel(inputL),
    right: stretchChannel(inputR),
  };
}

/**
 * Paulstretch / Extreme Ambient Pad Stretch: randomizes FFT phases per overlap frame
 * so any short note or vocal snippet becomes an ultra-smooth lush texture.
 */
export function renderPaulstretchTexture(
  inputL: Float32Array,
  inputR: Float32Array,
  sampleRate: number,
  stretchFactor = 8.0,
  windowSec = 0.25
): { left: Float32Array; right: Float32Array } {
  const stretch = Math.max(1.5, Math.min(32.0, stretchFactor));
  // Pick largest power of 2 near windowSec * sampleRate (capped at 16384)
  let fftSize = 2048;
  const targetWin = Math.round(windowSec * sampleRate);
  while (fftSize * 2 <= targetWin && fftSize < 16384) fftSize *= 2;

  const synHop = fftSize / 4;
  const anaHop = synHop / stretch;
  const half = fftSize / 2;
  const win = buildHannWindow(fftSize);
  const twoPi = 2 * Math.PI;

  let seed = 0x9e3779b9;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const processChannel = (ch: Float32Array, chSeedOffset: number): Float32Array => {
    seed = (0x9e3779b9 + chSeedOffset) >>> 0;
    const outLen = Math.max(fftSize, Math.round(ch.length * stretch));
    const out = new Float32Array(outLen + fftSize);
    const norm = new Float32Array(outLen + fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    const numFrames = Math.ceil(outLen / synHop);
    for (let f = 0; f < numFrames; f++) {
      const inStart = Math.min(Math.max(0, Math.round(f * anaHop)), Math.max(0, ch.length - fftSize));
      const outStart = f * synHop;

      for (let i = 0; i < fftSize; i++) {
        re[i] = (inStart + i < ch.length ? ch[inStart + i] : 0) * win[i];
        im[i] = 0;
      }
      fftInPlace(re, im);

      for (let k = 1; k < half; k++) {
        const mag = Math.hypot(re[k], im[k]);
        const randPh = nextRand() * twoPi;
        re[k] = mag * Math.cos(randPh);
        im[k] = mag * Math.sin(randPh);
        re[fftSize - k] = re[k];
        im[fftSize - k] = -im[k];
      }
      im[0] = 0;
      im[half] = 0;

      ifftInPlace(re, im);
      for (let i = 0; i < fftSize; i++) {
        const w = win[i];
        out[outStart + i] += re[i] * w;
        norm[outStart + i] += w * w;
      }
    }

    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      res[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
    }
    return res;
  };

  return {
    left: processChannel(inputL, 0),
    right: processChannel(inputR, 7919),
  };
}
