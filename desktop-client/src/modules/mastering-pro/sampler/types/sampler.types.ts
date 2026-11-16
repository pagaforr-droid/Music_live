export type PlayMode = 'oneshot' | 'gate' | 'loop';
export type WarpMode = 'off' | 'varispeed' | 'wsola' | 'phasevocoder' | 'granular' | 'paulstretch';
export type SliceSource = 'manual' | 'transient' | 'grid';
export type SnapMode = 'none' | 'zero-cross' | 'transient' | 'grid';
export type TexturePresetId = 'pad-etereo' | 'riser-cinematico' | 'glitch-percusivo' | 'tape-stop';

export interface SampleSource {
  id: string;
  name: string;
  origin: 'mastering-buffer' | 'file' | 'stem' | 'recording' | 'sampler-bounce';
  buffer: AudioBuffer;
  bpm: number;
  rootNote: number; // MIDI 0..127 (default 60 = C4)
  detectedPitchHz?: number;
  provenance?: {
    fileName?: string;
    songId?: string;
    stemRole?: string;
  };
}

export interface SampleRegion {
  id: string;
  sourceId: string;
  name: string;
  startSec: number;
  endSec: number;
  loopStartSec?: number;
  loopEndSec?: number;
  loopCrossfadeMs: number; // 0..50
  sliceSource: SliceSource;
  classification?: 'kick' | 'snare' | 'hat' | 'melodic';
}

export interface Adsr {
  attackMs: number;
  decayMs: number;
  sustain: number; // 0..1
  releaseMs: number;
}

export interface GranularParams {
  grainSizeMs: number; // 15..450
  density: number; // 1..24 grains/sec or stretch
  pitchSpreadCents: number; // 0..1200
  positionNorm: number; // 0..1
  stretchFactor: number; // 1..24 for paulstretch
  freeze: boolean;
}

export interface PadVoiceParams {
  gainDb: number; // -48..+12
  pan: number; // -1..+1
  pitchSemis: number; // -24..+24
  fineCents: number; // -100..+100
  reverse: boolean;
  normalize: boolean;
  fadeInMs: number;
  fadeOutMs: number;
  playMode: PlayMode;
  chokeGroup: number | null; // 1..8
  amp: Adsr;
  filter: {
    type: 'off' | 'lowpass' | 'highpass' | 'bandpass';
    cutoffHz: number;
    q: number;
    envAmountOct: number; // -4..+4
    env: Adsr;
  };
  warp: {
    mode: WarpMode;
    targetBpm?: number;
    timeStretchRatio: number; // 0.25..4.0
    formantPreserve: boolean;
  };
  granular: GranularParams;
  sends: {
    reverb: number; // 0..1
    delay: number; // 0..1
  };
  velocitySens: number; // 0..1
}

export interface SamplePad {
  index: number; // 0..15
  regionId: string | null;
  label: string;
  colorHex: string;
  params: PadVoiceParams;
  midiNote: number; // default 36 + index
  keyboardKey: string;
}

export interface StepCell {
  on: boolean;
  velocity: number; // 0.1..1.0
  probability?: number; // 0..1
}

export interface PatternLane {
  padIndex: number;
  steps: StepCell[];
}

export interface SamplerPattern {
  bpm: number;
  swing: number; // 0..0.75
  steps: 16 | 32;
  lanes: PatternLane[];
}

export interface SerializedSampleSource {
  id: string;
  name: string;
  origin: SampleSource['origin'];
  bpm: number;
  rootNote: number;
  sampleRate: number;
  durationSec: number;
  wavBlobKey: string;
  provenance?: SampleSource['provenance'];
}

export interface SampleKit {
  schemaVersion: 1;
  id: string;
  name: string;
  sources: SerializedSampleSource[];
  regions: SampleRegion[];
  pads: SamplePad[];
  pattern: SamplerPattern;
  createdAt: string;
  updatedAt: string;
}

export interface CloudSampleKitRecord {
  id: string;
  user_id?: string | null;
  song_id?: string | null;
  name: string;
  kit_json: SampleKit;
  total_bytes: number;
  created_at?: string;
  updated_at?: string;
}

export interface SongFolderItem {
  id: string;
  title: string;
  band_id?: string;
  stemCount?: number;
  created_at?: string;
}
