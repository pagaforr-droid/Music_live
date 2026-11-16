export { SampleLabPanel, SampleLabModule } from './components/SampleLabPanel';
export { StemReplacerPanel } from './components/StemReplacerPanel';
export { SampleWaveformEditor } from './components/SampleWaveformEditor';
export { SliceToolbar } from './components/SliceToolbar';
export { PadGrid } from './components/PadGrid';
export { PadInspector } from './components/PadInspector';
export { StepSequencer } from './components/StepSequencer';
export { SampleExportDialog } from './components/SampleExportDialog';
export { SaveToSupabaseModal } from './components/SaveToSupabaseModal';
export { KitLibraryModal } from './components/KitLibraryModal';

export { SamplerEngine } from './engine/SamplerEngine';
export { SampleLabHandoff } from './engine/SampleLabHandoff';
export { detectPitchYin, midiNoteToName } from './engine/PitchDetector';
export { sliceByTransients, sliceByBpmGrid } from './engine/Slicer';
export {
  analyzeDrumStemFull,
  analyzeMonophonicStemNotesFull,
  analyzePolyphonicStemNotesFull,
  inferStemModeFromName,
} from './engine/FullStemAnalyzer';
export {
  DRUM_PRESET_CATALOG,
  MELODIC_PRESET_CATALOG,
  getPresetZones,
  getPresetAuditionBuffer,
  prepareCustomReplacementSample,
} from './engine/StudioSampleBank';
export { renderFullStemReplacement } from './engine/StemReplacerEngine';
export { buildCrossfadedLoopArrays, measureLoopDiscontinuityDb } from './engine/LoopCrossfade';
export {
  encodeBufferToWav24WithMetadata,
  encodeBufferToMp3,
  exportSlicePackZip,
} from './engine/SampleExport';
export {
  saveKitTempToIndexedDb,
  loadKitTempFromIndexedDb,
  listSavedLocalKits,
} from './engine/KitStorage';

export { useStemReplacer } from './hooks/useStemReplacer';

export type * from './types/sampler.types';
