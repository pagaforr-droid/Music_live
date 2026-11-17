export type PlayMode = 'oneshot' | 'gate' | 'loop';
export type WarpMode = 'off' | 'varispeed' | 'wsola' | 'phasevocoder' | 'granular' | 'paulstretch';
export type SliceSource = 'manual' | 'transient' | 'grid';
export type SnapMode = 'none' | 'zero-cross' | 'transient' | 'grid';
export type TexturePresetId = 'pad-etereo' | 'riser-cinematico' | 'glitch-percusivo' | 'tape-stop';

export interface DetectedChordSegment {
  id: string;
  startSec: number;
  endSec: number;
  chord: string;
  rootPitchClass: number;
  rootName: string;
  rootMidi: number; // Sub/Bass register MIDI (28..40, E1..E2)
  chordMidis: number[];
  confidence: number;
}

export interface ImportedAudioMemoryAnalysis {
  signature: string;
  bpm: number;
  bpmConfidence: number;
  beatOffsetSec: number;
  durationSec: number;
  musicalKey: string;
  keyConfidence: number;
  isTonal: boolean;
  chords: DetectedChordSegment[];
  chordProgressionSummary: string;
  detectedRootMidi: number;
  detectedRootName: string;
  polyNoteEvents: StemNoteEvent[];
  onsetTimesSec: number[];
  analyzedAt: number;
}

export interface SampleSource {
  id: string;
  name: string;
  origin: 'mastering-buffer' | 'file' | 'stem' | 'recording' | 'sampler-bounce';
  buffer: AudioBuffer;
  bpm: number;
  rootNote: number; // MIDI 0..127 (default 60 = C4)
  detectedPitchHz?: number;
  preAnalysis?: ImportedAudioMemoryAnalysis;
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

export type StemAnalysisMode = 'drums' | 'monophonic' | 'polyphonic';
export type DrumPieceRole = 'kick' | 'snare' | 'hat' | 'tom';

export type DefaultDrumPresetId =
  | 'drum-kick-punch'
  | 'drum-kick-acoustic'
  | 'drum-kick-808'
  | 'drum-snare-studio'
  | 'drum-snare-warm'
  | 'drum-snare-tight'
  | 'drum-hat-crisp'
  | 'drum-hat-tight'
  | 'drum-tom-deep';

export type DefaultMelodicPresetId =
  | 'inst-piano-grand'
  | 'inst-piano-rhodes'
  | 'inst-guitar-acoustic'
  | 'inst-guitar-electric'
  | 'inst-bass-finger'
  | 'inst-bass-sub808'
  | 'inst-bass-astra-sub'
  | 'inst-bass-astra-pluck'
  | 'inst-bass-sh101-funk'
  | 'inst-bass-juno-chorus'
  | 'inst-bass-jupiter-fat'
  | 'inst-bass-monark-sub'
  | 'inst-bass-90s-pad'
  | 'inst-bass-autowah'
  | 'inst-bass-suboctave'
  | 'inst-synth-warm';

export type DefaultInstrumentId = DefaultDrumPresetId | DefaultMelodicPresetId;

export interface StemDrumHitEvent {
  id: string;
  timeSec: number;
  peakTimeSec: number;
  role: DrumPieceRole;
  velocity: number; // 0.1..1.0
}

export interface StemNoteEvent {
  id: string;
  startSec: number;
  durationSec: number;
  midiNote: number; // 24..96
  noteName: string;
  velocity: number; // 0.1..1.0
  clarity: number; // 0..1
}

export interface FullStemAnalysisResult {
  mode: StemAnalysisMode;
  bassFocusApplied?: boolean;
  bpm: number;
  musicalKey?: string;
  detectedChords?: DetectedChordSegment[];
  beatOffsetSec?: number;
  durationSec: number;
  drumHits: StemDrumHitEvent[];
  noteEvents: StemNoteEvent[];
  midiRange?: { minMidi: number; maxMidi: number; minName: string; maxName: string };
  counts: {
    total: number;
    kick: number;
    snare: number;
    hat: number;
    tom: number;
    notes: number;
  };
}

export type CustomSampleCategory = DrumPieceRole | 'melodic';

export interface CustomReplacementSampleItem {
  id: string;
  name: string;
  category: CustomSampleCategory;
  sourceType: 'file' | 'recorded' | 'pad' | 'cloud';
  buffer: AudioBuffer;
  durationSec: number;
  peakOffsetSec: number;
  detectedRootMidi: number;
  detectedNoteName: string;
  waveformPreview: number[]; // normalized 0..1 mini peak bars for pro bank cards
  createdAt: string;
}

export interface ReplacementSlotConfig {
  roleOrTarget: DrumPieceRole | 'melodic';
  enabled: boolean;
  sourceType: 'preset' | 'recorded' | 'file' | 'pad' | 'stem-crop';
  presetId: DefaultInstrumentId;
  customSampleId?: string;
  customName?: string;
  customBuffer?: AudioBuffer;
  customRootMidi?: number; // detected or manually calibrated MIDI root for tonal samples
  customPeakOffsetSec?: number; // transient peak alignment offset for drums
  normalizeCustom?: boolean; // auto-normalize uploaded/recorded replacement sample to -1 dBFS
  gainDb: number; // -24..+12
  pitchSemis: number; // -12..+12
}

export interface StemReplaceMixOptions {
  replacementPct: number; // 0..100
  originalPct: number; // 0..100
  duckOriginalTransients: boolean;
  roundRobinHumanize: boolean;
  sustainScale: number; // 0.6..1.8 for melodic sustain/release feel
  brightnessPct: number; // -50..+50 tilt
}

export interface SongStemEntry {
  id: string;
  songId: string;
  name: string;
  fileUrl: string;
  isMaster: boolean;
  durationSec?: number;
  inferredMode: StemAnalysisMode;
}

export interface SongWithStemsFolder {
  id: string;
  title: string;
  bandId?: string;
  bpm?: number;
  musicalKey?: string;
  timeSignature?: string;
  stems: SongStemEntry[];
}
