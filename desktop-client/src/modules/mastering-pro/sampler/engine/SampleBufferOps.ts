import type {
  PadVoiceParams,
  SamplePad,
  SamplerPattern,
  TexturePresetId,
} from '../types/sampler.types';

export const DEFAULT_PAD_COLORS = [
  '#FF6B00', '#F97316', '#F59E0B', '#EAB308',
  '#00E5FF', '#06B6D4', '#38BDF8', '#3B82F6',
  '#10B981', '#14B8A6', '#22C55E', '#84CC16',
  '#F43F5E', '#EC4899', '#A855F7', '#8B5CF6',
];

export const DEFAULT_QWERTY_KEYS = [
  '1', '2', '3', '4',
  'Q', 'W', 'E', 'R',
  'A', 'S', 'D', 'F',
  'Z', 'X', 'C', 'V',
];

export function createDefaultPadParams(): PadVoiceParams {
  return {
    gainDb: 0,
    pan: 0,
    pitchSemis: 0,
    fineCents: 0,
    reverse: false,
    normalize: false,
    fadeInMs: 2,
    fadeOutMs: 6,
    playMode: 'oneshot',
    chokeGroup: null,
    amp: {
      attackMs: 2,
      decayMs: 280,
      sustain: 1.0,
      releaseMs: 35,
    },
    filter: {
      type: 'off',
      cutoffHz: 14000,
      q: 1.0,
      envAmountOct: 0,
      env: {
        attackMs: 5,
        decayMs: 250,
        sustain: 0.4,
        releaseMs: 120,
      },
    },
    warp: {
      mode: 'off',
      timeStretchRatio: 1.0,
      formantPreserve: true,
    },
    granular: {
      grainSizeMs: 95,
      density: 8,
      pitchSpreadCents: 18,
      positionNorm: 0.5,
      stretchFactor: 6.0,
      freeze: false,
    },
    sends: {
      reverb: 0,
      delay: 0,
    },
    velocitySens: 0.75,
  };
}

export function createDefaultPads(): SamplePad[] {
  return Array.from({ length: 16 }, (_, index) => ({
    index,
    regionId: null,
    label: `Pad ${index + 1}`,
    colorHex: DEFAULT_PAD_COLORS[index % DEFAULT_PAD_COLORS.length],
    params: createDefaultPadParams(),
    midiNote: 36 + index,
    keyboardKey: DEFAULT_QWERTY_KEYS[index],
  }));
}

export function createDefaultPattern(bpm = 120, steps: 16 | 32 = 16): SamplerPattern {
  return {
    bpm,
    swing: 0,
    steps,
    lanes: Array.from({ length: 16 }, (_, padIndex) => ({
      padIndex,
      steps: Array.from({ length: steps }, () => ({
        on: false,
        velocity: 0.85,
        probability: 1.0,
      })),
    })),
  };
}

export function applyTexturePresetToPadParams(
  current: PadVoiceParams,
  presetId: TexturePresetId
): PadVoiceParams {
  switch (presetId) {
    case 'pad-etereo':
      return {
        ...current,
        playMode: 'gate',
        amp: { attackMs: 220, decayMs: 400, sustain: 0.9, releaseMs: 950 },
        filter: {
          ...current.filter,
          type: 'lowpass',
          cutoffHz: 5200,
          q: 1.2,
          envAmountOct: 1.5,
          env: { attackMs: 280, decayMs: 650, sustain: 0.5, releaseMs: 800 },
        },
        warp: { ...current.warp, mode: 'paulstretch', timeStretchRatio: 1.0 },
        granular: {
          ...current.granular,
          grainSizeMs: 240,
          density: 12,
          pitchSpreadCents: 25,
          stretchFactor: 8.0,
        },
        sends: { reverb: 0.65, delay: 0.35 },
      };
    case 'riser-cinematico':
      return {
        ...current,
        reverse: true,
        playMode: 'oneshot',
        amp: { attackMs: 350, decayMs: 120, sustain: 1.0, releaseMs: 450 },
        filter: {
          ...current.filter,
          type: 'bandpass',
          cutoffHz: 2600,
          q: 2.8,
          envAmountOct: 2.5,
          env: { attackMs: 450, decayMs: 200, sustain: 0.8, releaseMs: 200 },
        },
        sends: { reverb: 0.72, delay: 0.45 },
      };
    case 'glitch-percusivo':
      return {
        ...current,
        playMode: 'oneshot',
        warp: { ...current.warp, mode: 'granular', timeStretchRatio: 1.0 },
        granular: {
          ...current.granular,
          grainSizeMs: 32,
          density: 20,
          pitchSpreadCents: 700,
          stretchFactor: 2.5,
        },
        filter: {
          ...current.filter,
          type: 'highpass',
          cutoffHz: 320,
          q: 3.5,
        },
        sends: { reverb: 0.18, delay: 0.52 },
      };
    case 'tape-stop':
      return {
        ...current,
        playMode: 'oneshot',
        pitchSemis: -5,
        warp: { ...current.warp, mode: 'varispeed', timeStretchRatio: 1.0 },
        amp: { attackMs: 4, decayMs: 520, sustain: 0.35, releaseMs: 180 },
        filter: {
          ...current.filter,
          type: 'lowpass',
          cutoffHz: 2900,
          q: 0.9,
          envAmountOct: -2.0,
          env: { attackMs: 20, decayMs: 480, sustain: 0.15, releaseMs: 150 },
        },
        sends: { reverb: 0.25, delay: 0.12 },
      };
  }
}

export function extractRegionArrays(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): { left: Float32Array; right: Float32Array; sampleRate: number } {
  const sr = buffer.sampleRate;
  const s0 = Math.max(0, Math.min(buffer.length - 1, Math.floor(startSec * sr)));
  const s1 = Math.max(s0 + 1, Math.min(buffer.length, Math.ceil(endSec * sr)));
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

  return {
    left: new Float32Array(ch0.subarray(s0, s1)),
    right: new Float32Array(ch1.subarray(s0, s1)),
    sampleRate: sr,
  };
}

export function arraysToAudioBuffer(
  ctx: BaseAudioContext,
  left: Float32Array,
  right: Float32Array,
  sampleRate = ctx.sampleRate
): AudioBuffer {
  const len = Math.max(1, Math.min(left.length, right.length));
  const buf = ctx.createBuffer(2, len, sampleRate);
  buf.copyToChannel(new Float32Array(left.subarray(0, len)), 0);
  buf.copyToChannel(new Float32Array(right.subarray(0, len)), 1);
  return buf;
}

export function applyFadesInPlace(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  fadeInMs: number,
  fadeOutMs: number
): void {
  const n = left.length;
  const fadeInSamples = Math.min(Math.floor(n / 2), Math.round((fadeInMs / 1000) * sampleRate));
  const fadeOutSamples = Math.min(Math.floor(n / 2), Math.round((fadeOutMs / 1000) * sampleRate));

  for (let i = 0; i < fadeInSamples; i++) {
    const g = Math.sin((i / Math.max(1, fadeInSamples)) * (Math.PI / 2));
    left[i] *= g;
    right[i] *= g;
  }
  for (let i = 0; i < fadeOutSamples; i++) {
    const idx = n - 1 - i;
    const g = Math.sin((i / Math.max(1, fadeOutSamples)) * (Math.PI / 2));
    left[idx] *= g;
    right[idx] *= g;
  }
}

export function removeDcOffsetInPlace(left: Float32Array, right: Float32Array): void {
  const n = left.length;
  if (n === 0) return;
  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < n; i++) {
    sumL += left[i];
    sumR += right[i];
  }
  const meanL = sumL / n;
  const meanR = sumR / n;
  for (let i = 0; i < n; i++) {
    left[i] -= meanL;
    right[i] -= meanR;
  }
}

export function normalizeStereoInPlace(
  left: Float32Array,
  right: Float32Array,
  targetPeakDb = -1.0
): void {
  let maxPeak = 0;
  for (let i = 0; i < left.length; i++) {
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (a > maxPeak) maxPeak = a;
  }
  if (maxPeak < 1e-6) return;
  const targetLin = Math.pow(10, targetPeakDb / 20);
  const gain = Math.min(24.0, targetLin / maxPeak);
  for (let i = 0; i < left.length; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
}

export function reverseStereoInPlace(left: Float32Array, right: Float32Array): void {
  left.reverse();
  right.reverse();
}

export function snapSecToZeroCrossing(
  buffer: AudioBuffer,
  sec: number,
  radiusMs = 10
): number {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const target = Math.max(1, Math.min(buffer.length - 2, Math.round(sec * sr)));
  const radius = Math.max(4, Math.round((radiusMs / 1000) * sr));
  const start = Math.max(1, target - radius);
  const end = Math.min(buffer.length - 1, target + radius);

  let bestIdx = target;
  let bestScore = Infinity;

  for (let i = start; i <= end; i++) {
    const m0 = 0.5 * (ch0[i - 1] + ch1[i - 1]);
    const m1 = 0.5 * (ch0[i] + ch1[i]);
    if ((m0 <= 0 && m1 >= 0) || (m0 >= 0 && m1 <= 0)) {
      const dist = Math.abs(i - target);
      if (dist < bestScore) {
        bestScore = dist;
        bestIdx = i;
      }
    }
  }
  return Number((bestIdx / sr).toFixed(5));
}

export function detectSilenceBounds(
  buffer: AudioBuffer,
  thresholdDb = -48
): { startSec: number; endSec: number } {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const threshLin = Math.pow(10, thresholdDb / 20);
  let startIdx = 0;
  let endIdx = buffer.length - 1;

  for (let i = 0; i < buffer.length; i++) {
    if (Math.abs(ch0[i]) > threshLin || Math.abs(ch1[i]) > threshLin) {
      startIdx = Math.max(0, i - Math.round(sr * 0.002));
      break;
    }
  }
  for (let i = buffer.length - 1; i > startIdx; i--) {
    if (Math.abs(ch0[i]) > threshLin || Math.abs(ch1[i]) > threshLin) {
      endIdx = Math.min(buffer.length - 1, i + Math.round(sr * 0.005));
      break;
    }
  }
  return {
    startSec: Number((startIdx / sr).toFixed(4)),
    endSec: Number((endIdx / sr).toFixed(4)),
  };
}
