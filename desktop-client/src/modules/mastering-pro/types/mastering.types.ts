export type PresetCategory =
  | 'Rock'
  | 'Pop'
  | 'Acoustic'
  | 'Funk'
  | 'AI-Restore'
  | 'Worship';

export type SaturationType = 'tape' | 'tube' | 'transformer' | 'softclip';

export type EQBandChannel = 'stereo' | 'mid' | 'side';

export interface EQBandConfig {
  id: string;
  label: string;
  freq: number;
  gainDb: number;
  q: number;
  type: BiquadFilterType;
  channel: EQBandChannel;
  enabled?: boolean;
}

export interface SpectralResonanceNode {
  id: string;
  freqHz: number;
  gainCutDb: number;
  q: number;
  label: string;
  enabled: boolean;
  source: 'ai-detected' | 'user-clicked';
}

export type AntiSunoCqtMode =
  | 'a432_detune'
  | 'detune_down'
  | 'drop_semitone'
  | 'macro_rubato_440';

export interface ForensicHumanizerConfig {
  enabled: boolean;
  /** Controla el exceso de energía sub-grave para bajar el Bass Concentration del ~60% al ~36% (0.0 a 1.0) */
  bassConcentrationCap: number;
  /** Reconstruye armónicos reales entre 14kHz y 22kHz para borrar el corte de ladrillo de IA (0.0 a 1.0) */
  highFreqExciterAmount: number;
  /** Desplaza micro-fases con filtros All-Pass asimétricos y micro-modulación de cinta (0.0 a 1.0) */
  analogPhaseAndDrift: number;
  /** Inyecta ruido térmico real de consola (Pink/Tape Floor) + Dither TPDF (-85 a -62 dBFS) */
  analogConsoleNoiseDb: number;
  /** Micro-reflexión acústica de estudio para dar coherencia física entre canal L y R (0.0 a 0.15) */
  studioRoomCoherence: number;
  /** Reconstruye el ataque físico de micro-transientes borroneadas (0.0 a 1.0) */
  transientMicroExpand: number;
  /** Purga ultrasónica 8º orden (>17.4kHz) + 5 notches Bark/EnCodec ANTES de reconstruir armónicos */
  sunoUltrasonicPurge?: boolean;
  /** Modo de desplazamiento CQT + Time-Warp cúbico Catmull-Rom para romper la rejilla de 20ms (50Hz) de Suno */
  cqtDeQuantizeMode?: AntiSunoCqtMode;
  /** De-Cuantizador Zero-Sum de formantes RVQ (700-1350Hz / 2400-4100Hz) + Swapper de constelación de 6 bandas */
  rvqFormantDeQuantizer?: boolean;
  /** Escudo de cancelación en Downmix Mono (12-stage All-Pass + Micro-Warp opuesto >380Hz para 0.5*(L+R)) */
  monoDownmixCanceller?: boolean;
}

export interface ForensicSignatureReport {
  /** 0% (100% Natural/Analógico) a 100% (Alta densidad de artefactos espectrales en entrada) */
  estimatedAiSignatureScore: number;
  /** Índice espectral proyectado tras la restauración armónica y dinámica */
  projectedPostAiSignatureScore: number;
  /** Concentración real de energía en graves (<140Hz) medida vía FFT */
  bassEnergyConcentrationPct: number;
  /** Concentración de graves proyectada tras el Re-Balanceador Sub-Grave */
  projectedPostBassConcentrationPct: number;
  /** Ancho de banda crudo medido en entrada (Hz) antes de excitador */
  measuredBandwidthHz?: number;
  /** Frecuencia de ancho de banda proyectada tras el excitador (Hz) */
  highFreqCutoffDetectedHz: number;
  /** Índice de rigidez de fase estéreo (0 a 1) */
  phaseRigidityIndex: number;
  /** Índice real de aspereza/dureza en 2.9kHz-4.8kHz (0 a 100) */
  harshnessIndex?: number;
  /** Indica si la medición proviene de FFT completo (sin submuestreo con aliasing) */
  isRealSpectralMeasurement?: boolean;
}

export type DrumKitStyle =
  | 'stadium-rock'
  | 'tight-pop-funk'
  | 'warm-acoustic'
  | 'arena-worship';

export interface DrumHitEvent {
  timeSec: number;
  type: 'kick' | 'snare';
  velocity: number; // 0.1 a 1.0
}

export interface DrumLayeringConfig {
  enabled: boolean;
  kickMix: number; // 0.0 a 1.0
  snareMix: number; // 0.0 a 1.0
  kickSensitivity: number; // 0.1 a 1.0
  snareSensitivity: number; // 0.1 a 1.0
  drumStyle: DrumKitStyle;
  suppressOriginalMud: boolean;
  humanizeRoundRobin: boolean;
  /** Reemplazo real de transientes: atenúa (-8.5dB por 18-22ms) el golpe sintético original al disparar el sample acústico */
  duckOriginalTransients?: boolean;
}

export interface CompressorConfig {
  thresholdDb: number;
  ratio: number;
  attackSec: number;
  releaseSec: number;
  kneeDb: number;
  makeupGainDb: number;
  /** 0.0 to 1.0 (0% to 100% Parallel Bus Glue Mix) */
  parallelMix: number;
}

export interface SaturationConfig {
  type: SaturationType;
  /** 0.0 to 1.0 Analog Drive intensity */
  drive: number;
  /** Harmonic warmth tilt in dB (-3 to +3) */
  warmthTiltDb: number;
}

export interface StereoWidthConfig {
  /** Gain applied to the Side (L-R) channel in dB (-6 to +6 dB) */
  sideGainDb: number;
  /** Normalized width percentage (0% = Mono, 100% = Unity, 150% = Ultra Wide) */
  widthPct: number;
}

export interface LimiterConfig {
  /** Target Integrated Loudness (-14, -11, -9, -8.5 LUFS) */
  targetLufs: number;
  /** True Peak Brickwall Ceiling in dBTP (typically -1.0 dBTP for streaming) */
  ceilingDbTp: number;
  /** Lookahead window in ms (default 2.0ms) */
  lookaheadMs: number;
  /** Adaptive release base in ms (default 65ms) */
  releaseMs: number;
  /** Percentage of transient shaved by soft-clipper before brickwall limiter (0..1) */
  softClipPrePct: number;
}

export interface SpectralProfile {
  /** 20Hz - 160Hz energy in dBFS (normalized relative to full spectrum) */
  sub: number;
  /** 160Hz - 800Hz energy in dBFS */
  lowMid: number;
  /** 800Hz - 5500Hz energy in dBFS */
  presence: number;
  /** 5500Hz - 20000Hz energy in dBFS */
  air: number;
}

export interface MasteringDspChain {
  /** Macro intensity scaling factor (0.0 = true dry bypass, 1.0 = 100% nominal, 1.5 = hot) */
  intensityScale?: number;
  /** Stage 2: Subsonic High-Pass cutoff (20Hz - 45Hz) */
  highPassFreq: number;
  /** Stage 3: Side-channel High-Pass cutoff forcing bass to 100% Mono (60Hz - 200Hz) */
  monoMakerFreq: number;
  /** Surgical Mid/Side & Stereo EQ bands */
  eqBands: EQBandConfig[];
  /** Stage 2B: Ultra-Narrow Surgical Resonance Notches (Q=10..16 Line Killer) */
  resonanceNotches?: SpectralResonanceNode[];
  /** Stage 4A: Bus Glue Compressor */
  compressor: CompressorConfig;
  /** Stage 4B: 4x Oversampled Analog Saturator + DC Blocker */
  saturation: SaturationConfig;
  /** Stage 3B: Stereo Width & Side Gain */
  stereoWidth: StereoWidthConfig;
  /** Stage 5: Dual-Stage Maximizer & True Peak Brickwall Limiter */
  limiter: LimiterConfig;
  /** Stage 4C: Forensic De-Fingerprinting & Analog Humanizer */
  forensicHumanizer?: ForensicHumanizerConfig;
  /** Stage 1B: Sample-Accurate Acoustic Drum Re-Synthesis & Layering */
  drumLayering?: DrumLayeringConfig;
}

export interface MasteringPreset {
  id: string;
  name: string;
  subtitle: string;
  referenceArtists: string;
  category: PresetCategory;
  accentHex: string;
  tags: string[];
  description: string;
  targetSpectralProfile: SpectralProfile;
  dspChain: MasteringDspChain;
}

export interface AudioMetrics {
  inputLufs: number;
  outputLufs: number;
  momentaryLufs?: number;
  shortTermLufs: number;
  lraLu?: number;
  truePeakDb: number;
  inputPeakDb: number;
  gainReductionDb: number;
  compressorReductionDb?: number;
  limiterReductionDb: number;
  /** -1.0 (out of phase) to +1.0 (pure mono) */
  phaseCorrelation: number;
  crestFactorDb: number;
  clippedSamples?: number;
  /** False when transport is stopped/paused so UI displays '—' honestly instead of fake numbers */
  isMeteringActive?: boolean;
  spectralBalance: SpectralProfile;
  postSpectralBalance: SpectralProfile;
}

export interface ExportQaReport {
  inputLufs: number;
  outputLufs: number;
  targetLufs: number;
  lufsErrorLu: number;
  lraLu: number;
  finalTruePeakDbTp: number;
  samplePeakDb: number;
  plrDb: number;
  crestFactorDb: number;
  phaseCorrelation: number;
  maxCompressorGrDb: number;
  maxLimiterReductionDb: number;
  clippedSamples: number;
  grBudgetExceeded: boolean;
  grBudgetWarning?: string;
}

export interface SurgicalOverrides {
  highPassFreq: number;
  monoMakerFreq: number;
  midLowPunchDb: number;
  stereoMudCutDb: number;
  midPresenceDb: number;
  deHarshnessCutDb: number;
  sibilanceCutDb: number;
  sibilanceFreqHz: number;
  sideAirBoostDb: number;
  saturationType: SaturationType;
  tapeDrivePct: number;
  compressorThresholdDb: number;
  compressorRatio: number;
  compressorAttackMs: number;
  compressorReleaseMs: number;
  compressorKneeDb: number;
  compressorGlueMixPct: number;
  stereoWidthPct: number;
  targetLufs: number;
  ceilingDbTp: number;
  customEqBands: EQBandConfig[];
  resonanceNotches: SpectralResonanceNode[];
  resonanceKillerPct: number;
  forensicHumanizer: ForensicHumanizerConfig;
  drumLayering: DrumLayeringConfig;
}

export interface AiCriticalEqPoint {
  id: string;
  action: 'boost' | 'cut';
  title: string;
  zoneName: string;
  reason: string;
  freqHz: number;
  recommendedGainDb: number;
  recommendedQ: number;
  channel: EQBandChannel;
  filterType: BiquadFilterType;
  bandId: string;
  priority: 'critical' | 'recommended' | 'opportunity';
}

export interface AiFilterSuggestion {
  id:
    | 'de-esser'
    | 'de-harsh-notch'
    | 'anti-mud-filter'
    | 'mono-maker-lock'
    | 'subsonic-rumble'
    | 'harmonic-exciter'
    | 'spectral-line-killer';
  name: string;
  badge: string;
  detectedIssue: string;
  suggestionDetail: string;
  confidencePct: number;
  isRecommended: boolean;
  patchOverrides: Partial<SurgicalOverrides>;
}

export interface AiCompressionSuggestion {
  profileName: string;
  diagnosis: string;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  parallelMixPct: number;
}

export interface AiStereoWidthSuggestion {
  detectedStereoEnergyPct: number;
  detectedBassPhaseCorrelation: number;
  diagnosis: string;
  recommendedWidthPct: number;
  recommendedMonoMakerHz: number;
  recommendedSideAirDb: number;
}

export interface SpectralAdaptationReport {
  analyzedDurationSec: number;
  sampleRate: number;
  detectedInputLufs: number;
  detectedTruePeakDb: number;
  detectedCrestFactorDb: number;
  detectedPhaseCorrelation: number;
  inputSpectralProfile: SpectralProfile;
  recommendedPresetId: string;
  recommendationReason: string;
  /** 0 to 100 score estimating metallic/high-frequency AI synthesis artifacts */
  aiArtifactScore: number;
  /** 0 to 100 score estimating vocal sibilance & high-frequency harshness (5.5kHz - 8.5kHz) */
  sibilanceScore: number;
  deltaAdjustments: {
    subDeltaDb: number;
    lowMidDeltaDb: number;
    presenceDeltaDb: number;
    airDeltaDb: number;
    autoMakeupGainDb: number;
  };
  criticalEqPoints: AiCriticalEqPoint[];
  filterSuggestions: AiFilterSuggestion[];
  compressionSuggestion: AiCompressionSuggestion;
  stereoWidthSuggestion: AiStereoWidthSuggestion;
  detectedResonanceLines: SpectralResonanceNode[];
  forensicSignature: ForensicSignatureReport;
  detectedDrumHits: DrumHitEvent[];
}

export type StemBusRole = 'drums' | 'bass' | 'vocals' | 'other';

export interface StemTrackState {
  role: StemBusRole;
  label: string;
  fileName: string | null;
  audioBuffer: AudioBuffer | null;
  gainDb: number;
  pan: number;
  muted: boolean;
  solo: boolean;
}

export interface MasteringSessionRecord {
  id?: string;
  user_id?: string | null;
  song_id?: string | null;
  track_title: string;
  preset_id: string;
  preset_name: string;
  intensity_pct: number;
  target_lufs: number;
  input_lufs: number;
  output_lufs: number;
  true_peak_dbtp: number;
  phase_correlation: number;
  master_wav_url: string;
  file_size_bytes: number;
  duration_seconds: number;
  sample_rate: number;
  bit_depth: number;
  dsp_snapshot: MasteringDspChain;
  surgical_overrides: SurgicalOverrides;
  created_at?: string;
}

export interface StudioMasteringModuleProps {
  initialAudioUrl?: string;
  initialTitle?: string;
  songId?: string;
  onMasterSaved?: (record: MasteringSessionRecord) => void;
  onClose?: () => void;
}
