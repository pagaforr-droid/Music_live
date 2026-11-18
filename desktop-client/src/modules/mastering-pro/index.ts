export {
  MasteringRack,
  StudioMasteringModule,
  default,
} from './components/MasteringRack';
export { ABComparisonBar } from './components/ABComparisonBar';
export { AiMasteringAssistantPanel } from './components/AiMasteringAssistantPanel';
export { DualSpectrumVisualizer } from './components/DualSpectrumVisualizer';
export { LoudnessMeterPanel } from './components/LoudnessMeterPanel';
export { MidSideSurgicalControls } from './components/MidSideSurgicalControls';
export { PresetSelectorGrid } from './components/PresetSelectorGrid';
export {
  SpectrogramHeatmapVisualizer,
  type ActiveFixMarker,
  type SpectrogramHeatmapProps,
} from './components/SpectrogramHeatmapVisualizer';

export {
  WebAudioMasteringEngine,
  applyKickBassSidechainToBassArrays,
} from './engine/WebAudioMasteringEngine';
export { buildMasteringDspGraph } from './engine/MasteringGraphBuilder';
export { createMidSideMatrix } from './engine/MidSideMatrix';
export {
  generateAnalogSaturationCurve,
  computeSaturationGainStaging,
} from './engine/AnalogSaturationCurves';
export {
  analyzeTrackAndComputeAdaptation,
  computeIntegratedLufsBs1770,
} from './engine/SpectralDeltaAnalyzer';
export {
  createBrickwallMaximizerCurve,
  applyLookaheadBrickwallLimiterOffline,
  measureTruePeakLinearBlock,
} from './engine/TruePeakLimiter';
export { encodeAudioBufferToWav24Bit } from './engine/Wav24BitEncoder';

export {
  PRO_PRESETS_CATALOG,
  getPresetById,
  extractSurgicalOverridesFromPreset,
  buildEffectiveDspChain,
} from './presets/proPresetsCatalog';

export {
  uploadAndSaveMasterSession,
  fetchMasteringSessionsHistory,
  fetchProjectAudioTracksForMastering,
  MASTERING_SESSIONS_MIGRATION_SQL,
} from './services/supabaseMasteringService';

export {
  SampleLabPanel,
  SampleLabModule,
  SamplerEngine,
  SampleLabHandoff,
} from './sampler';

export type * from './types/mastering.types';
export type * from './sampler/types/sampler.types';
