import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CloudUpload,
  Download,
  FolderArchive,
  Grid,
  HardDrive,
  Layers,
  Music2,
  Scissors,
  Sliders,
  Sparkles,
  Upload,
  Usb,
  Volume2,
  Waves,
} from 'lucide-react';
import {
  fetchProjectAudioTracksForMastering,
  type ProjectAudioTrackItem,
} from '../../services/supabaseMasteringService';
import { createDefaultPadParams, createDefaultPattern } from '../engine/SampleBufferOps';
import {
  BASS_PRESET_CATALOG,
  isBassPresetId,
  MELODIC_PRESET_CATALOG,
} from '../engine/StudioSampleBank';
import type { DefaultInstrumentId } from '../types/sampler.types';
import {
  loadKitTempFromIndexedDb,
  saveKitTempToIndexedDb,
} from '../engine/KitStorage';
import { SampleLabHandoff } from '../engine/SampleLabHandoff';
import {
  encodeBufferToMp3,
  encodeBufferToWav24WithMetadata,
  exportSlicePackZip,
  sanitizeDownloadBaseName,
  triggerFileDownload,
} from '../engine/SampleExport';
import {
  addSampleToSongFolder,
  loadCloudKitSources,
  saveKitToSupabase,
} from '../services/supabaseSamplerService';
import { useMidiInput } from '../hooks/useMidiInput';
import { useSamplerEngine } from '../hooks/useSamplerEngine';
import { useSamplerKeyboard } from '../hooks/useSamplerKeyboard';
import { useStemReplacer } from '../hooks/useStemReplacer';
import { midiNoteToName } from '../engine/PitchDetector';
import { KitLibraryModal } from './KitLibraryModal';
import { PadGrid } from './PadGrid';
import { PadInspector } from './PadInspector';
import { SampleExportDialog } from './SampleExportDialog';
import { SampleWaveformEditor } from './SampleWaveformEditor';
import { SaveToSupabaseModal } from './SaveToSupabaseModal';
import { SliceToolbar } from './SliceToolbar';
import { StemReplacerPanel } from './StemReplacerPanel';
import { StepSequencer } from './StepSequencer';

export const SampleLabPanel: React.FC = () => {
  const navigate = useNavigate();
  const s = useSamplerEngine();
  const replacer = useStemReplacer();
  const [workspaceMode, setWorkspaceMode] = useState<'replacer' | 'pads'>('replacer');

  const [projectTracks, setProjectTracks] = useState<ProjectAudioTrackItem[]>([]);
  const [showBpmGrid, setShowBpmGrid] = useState<boolean>(true);
  const [chromaticMode, setChromaticMode] = useState<boolean>(false);
  const [chromaticBaseMidi, setChromaticBaseMidi] = useState<number>(48); // C3
  const [selectedStudioPresetId, setSelectedStudioPresetId] = useState<DefaultInstrumentId>(
    'inst-bass-sh101-funk'
  );

  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isSupabaseOpen, setIsSupabaseOpen] = useState<boolean>(false);
  const [isKitLibraryOpen, setIsKitLibraryOpen] = useState<boolean>(false);
  const pcUploadInputRef = useRef<HTMLInputElement | null>(null);

  // Load Supabase project tracks so the user can pull any Stem/Song directly into Sample Lab
  useEffect(() => {
    void fetchProjectAudioTracksForMastering()
      .then((items) => setProjectTracks(items))
      .catch(() => setProjectTracks([]));
  }, []);

  const handlePlayChromatic = (midiNote: number, vel = 0.9) => {
    s.engineRef.current?.playChromatic(midiNote, vel, s.selectedPadIndex);
  };

  const handleReleaseChromatic = () => {
    s.engineRef.current?.releasePad(s.selectedPadIndex);
  };

  // Web MIDI API hardware controller support
  const midi = useMidiInput({
    enabled: true,
    chromaticMode,
    pads: s.pads,
    onTriggerPad: s.triggerPad,
    onReleasePad: s.releasePad,
    onPlayChromatic: handlePlayChromatic,
    onReleaseChromatic: handleReleaseChromatic,
    onMidiCc: (cc, val01) => {
      // Standard CC mappings: CC74 -> Filter cutoff, CC71 -> Resonance, CC10 -> Pan
      if (cc === 74) {
        const cutoff = Math.round(80 * Math.pow(20000 / 80, val01));
        s.updatePadParams(s.selectedPadIndex, {
          filter: {
            ...s.selectedPad.params.filter,
            type:
              s.selectedPad.params.filter.type === 'off'
                ? 'lowpass'
                : s.selectedPad.params.filter.type,
            cutoffHz: cutoff,
          },
        });
      } else if (cc === 71) {
        s.updatePadParams(s.selectedPadIndex, {
          filter: {
            ...s.selectedPad.params.filter,
            q: Number((0.5 + val01 * 14).toFixed(2)),
          },
        });
      }
    },
  });

  // QWERTY Keyboard performance & editing shortcuts (only active in Pads workspace)
  useSamplerKeyboard({
    enabled:
      workspaceMode === 'pads' &&
      !isExportOpen &&
      !isSupabaseOpen &&
      !isKitLibraryOpen,
    chromaticMode,
    chromaticBaseMidi,
    onTriggerPad: (idx) => s.triggerPad(idx, 0.92),
    onReleasePad: (idx) => s.releasePad(idx),
    onPlayChromatic: (note) => handlePlayChromatic(note, 0.92),
    onReleaseChromatic: handleReleaseChromatic,
    onToggleAudition: s.toggleAudition,
    onToggleLoop: () => s.setLoopAudition((prev) => !prev),
    onCreateSliceAtCursor: () => {
      if (s.selectedRegion) {
        const mid = (s.selectedRegion.startSec + s.selectedRegion.endSec) / 2;
        s.createSliceAtSec(mid);
      }
    },
    onNudgeRegion: (deltaSamples) => {
      if (!s.selectedRegion || !s.activeSource) return;
      const dt = deltaSamples / s.activeSource.buffer.sampleRate;
      s.updateRegionBounds(
        s.selectedRegion.id,
        s.selectedRegion.startSec + dt,
        s.selectedRegion.endSec + dt
      );
    },
  });

  // Auto-select region when user clicks a pad with a mapped slice
  const handleSelectPad = (padIndex: number) => {
    s.setSelectedPadIndex(padIndex);
    const pad = s.pads[padIndex];
    if (pad?.regionId) {
      s.setSelectedRegionId(pad.regionId);
    }
  };

  // Export & Supabase helpers
  const renderExportAudioBuffer = async (
    kind: 'pad' | 'region' | 'bounce',
    bounceBars = 2,
    seamlessLoop = true
  ): Promise<{
    buffer: AudioBuffer;
    baseName: string;
    rootNote: number;
    loopStartSample?: number;
    loopEndSample?: number;
  }> => {
    const engine = s.engineRef.current;
    if (!engine) throw new Error('Motor de audio no inicializado.');

    if (kind === 'pad') {
      const buf = await engine.renderPadOffline(s.selectedPadIndex);
      const clean = sanitizeDownloadBaseName(s.selectedPad.label, 'pad_sample');
      const padReg = s.selectedPad.regionId
        ? s.regions.find((r) => r.id === s.selectedPad.regionId)
        : undefined;
      const padSrc = padReg
        ? s.sources.find((src) => src.id === padReg.sourceId)
        : s.activeSource;
      return {
        buffer: buf,
        baseName: clean,
        rootNote: padSrc?.rootNote ?? 60,
      };
    }

    if (kind === 'region') {
      if (!s.selectedRegion) throw new Error('No hay ninguna región seleccionada.');
      const buf = engine.renderRegionToBuffer(s.selectedRegion);
      const clean = sanitizeDownloadBaseName(s.selectedRegion.name, 'slice');
      const regSrc = s.sources.find((src) => src.id === s.selectedRegion?.sourceId) ?? s.activeSource;
      const hasLoop =
        s.selectedRegion.loopStartSec !== undefined &&
        s.selectedRegion.loopEndSec !== undefined &&
        s.selectedRegion.loopEndSec > s.selectedRegion.loopStartSec;
      const sr = buf.sampleRate;
      return {
        buffer: buf,
        baseName: clean,
        rootNote: regSrc?.rootNote ?? 60,
        loopStartSample: hasLoop
          ? Math.max(0, Math.round((s.selectedRegion.loopStartSec! - s.selectedRegion.startSec) * sr))
          : undefined,
        loopEndSample: hasLoop
          ? Math.min(buf.length, Math.round((s.selectedRegion.loopEndSec! - s.selectedRegion.startSec) * sr))
          : undefined,
      };
    }

    const buf = await engine.renderPatternBounceOffline(
      s.pattern,
      bounceBars,
      seamlessLoop
    );
    const cleanKit = sanitizeDownloadBaseName(s.kitName, 'sample_lab');
    return {
      buffer: buf,
      baseName: `${cleanKit}_loop_${s.pattern.bpm}bpm`,
      rootNote: s.activeSource?.rootNote ?? 60,
    };
  };

  const handleExportSingle = async (
    kind: 'pad' | 'region' | 'bounce',
    format: 'wav' | 'mp3',
    bars = 2,
    seamless = true
  ) => {
    const { buffer, baseName, rootNote, loopStartSample, loopEndSample } =
      await renderExportAudioBuffer(kind, bars, seamless);
    const blob =
      format === 'wav'
        ? await encodeBufferToWav24WithMetadata(buffer, {
            rootMidiNote: rootNote,
            loopStartSample,
            loopEndSample,
          })
        : await encodeBufferToMp3(buffer, 320);
    triggerFileDownload(blob, `${baseName}.${format}`);
    s.setStatusMessage(
      `Exportado al PC: ${baseName}.${format} (${buffer.duration.toFixed(2)}s).`
    );
  };

  const handleExportSlicesZip = async () => {
    const engine = s.engineRef.current;
    if (!engine || s.activeSourceRegions.length === 0) {
      throw new Error('No hay slices disponibles para empaquetar en ZIP.');
    }
    const zipBlob = await exportSlicePackZip({
      kit: s.buildCurrentKitObject(),
      regions: s.activeSourceRegions,
      renderRegion: (reg) => engine.renderRegionToBuffer(reg),
      rootMidiNote: s.activeSource?.rootNote ?? 60,
    });
    const clean = s.kitName.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'sample_pack';
    triggerFileDownload(zipBlob, `${clean}_slices.zip`);
    s.setStatusMessage(
      `Pack ZIP exportado (${s.activeSourceRegions.length} slices WAV 24-bit).`
    );
  };

  const handleSendBounceToMastering = async (bars: number) => {
    const { buffer, baseName } = await renderExportAudioBuffer('bounce', bars, true);
    SampleLabHandoff.sendBounceToMastering({
      buffer,
      title: `${baseName}.wav`,
      origin: 'sampler-bounce',
    });
    s.setStatusMessage('Bounce enviado a Mastering Pro. Abriendo módulo...');
    navigate('/mastering');
  };

  const handleSendPadToMasteringDrum = async (
    padIndex: number,
    type: 'kick' | 'snare'
  ) => {
    const engine = s.engineRef.current;
    if (!engine) return;
    const pad = s.pads[padIndex];
    if (!pad?.regionId) {
      s.setStatusMessage(`Pad ${padIndex + 1} vacío: asigna un slice primero.`);
      return;
    }
    const rendered = await engine.renderPadOffline(padIndex);
    SampleLabHandoff.sendPadToDrumLayering({
      type,
      buffer: rendered,
      name: `${pad.label} (Sample Lab)`,
    });
    s.setStatusMessage(
      `${pad.label} enviado como capa ${type.toUpperCase()} a Mastering Pro.`
    );
    navigate('/mastering');
  };

  return (
    <div className="w-full h-full overflow-y-auto overflow-x-auto studio-scrollbar bg-[#020617] text-slate-100 p-4 md:p-5">
      <input
        ref={pcUploadInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,.aiff,.aif,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            if (workspaceMode === 'replacer') {
              void replacer.loadLocalStemFile(f);
            } else {
              void s.loadAudioFile(f);
            }
          }
          e.target.value = '';
        }}
      />
      <div className="max-w-[1640px] mx-auto flex flex-col gap-3.5 pb-12">
      {/* Top Studio Header */}
      <header className="rounded-2xl bg-slate-900/95 border border-slate-800/90 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-[0_14px_40px_rgba(0,0,0,0.6)]">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/mastering')}
            className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono flex items-center gap-1.5 cursor-pointer"
            title="Volver a Studio Mastering Pro"
          >
            <ArrowLeft size={13} />
            <Sliders size={13} className="text-[#FF6B00]" />
            <span>Mastering Pro</span>
          </button>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FF6B00] to-[#00E5FF] flex items-center justify-center text-slate-950 shadow-md">
              <Scissors size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm md:text-base font-black tracking-tight text-white">
                  SAMPLE LAB
                </h1>
                <span className="px-1.5 py-0.5 rounded bg-[#00E5FF]/15 text-[#00E5FF] text-[9px] font-mono font-bold border border-[#00E5FF]/30">
                  PRO ENGINE 48kHz
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-400">
                Stem Replacer (Batería · Bajo · Guitarra/Piano+) · 16 Pads + Sequencer
              </p>
            </div>
          </div>

          {/* Primary Workspace Mode Switcher */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs font-mono">
            <button
              type="button"
              onClick={() => setWorkspaceMode('replacer')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                workspaceMode === 'replacer'
                  ? 'bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers size={13} />
              <span>Reemplazar Stem (Canción)</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode('pads')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                workspaceMode === 'pads'
                  ? 'bg-[#FF6B00] text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Grid size={13} />
              <span>Creador 16 Pads</span>
            </button>
          </div>
        </div>

        {workspaceMode === 'pads' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={s.kitName}
              onChange={(e) => s.setKitName(e.target.value)}
              placeholder="Nombre del Kit..."
              className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white w-40 md:w-48 focus:outline-none focus:border-[#00E5FF]"
            />

            {s.tempSavedAt && (
              <span
                className="hidden xl:inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400"
                title="Los cambios y audios se guardan automáticamente en IndexedDB local"
              >
                <HardDrive size={11} className="text-emerald-400" />
                Temp {s.tempSavedAt}
              </span>
            )}

            <button
              type="button"
              onClick={() => setIsKitLibraryOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono flex items-center gap-1.5 cursor-pointer"
            >
              <FolderArchive size={13} className="text-amber-400" />
              <span>Kits</span>
            </button>

            <button
              type="button"
              onClick={() => pcUploadInputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-[#00E5FF] hover:bg-cyan-300 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Subir archivo de audio desde tu PC para samplear y exportar"
            >
              <Upload size={13} />
              <span>Subir del PC</span>
            </button>

            <button
              type="button"
              onClick={() => setIsExportOpen(true)}
              disabled={s.sources.length === 0}
              className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <Download size={13} />
              <span>Exportar al PC...</span>
            </button>

            <button
              type="button"
              onClick={() => setIsSupabaseOpen(true)}
              disabled={s.sources.length === 0}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-[#00E5FF] hover:brightness-110 text-slate-950 text-xs font-mono font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
            >
              <CloudUpload size={14} />
              <span>Guardar en Supabase</span>
            </button>
          </div>
        )}
      </header>

      {workspaceMode === 'replacer' ? (
        <StemReplacerPanel
          replacer={replacer}
          padsFromCreator={s.pads}
          getBufferForPad={(padIdx) => {
            const eng = s.engineRef.current;
            const pad = s.pads[padIdx];
            if (!eng || !pad?.regionId) return null;
            const reg = s.regions.find((rg) => rg.id === pad.regionId);
            if (!reg) return null;
            return eng.getProcessedBufferForPad(eng.ensureContext(), reg, pad.params);
          }}
          onSendTo16Pads={(buf, title) => {
            s.loadExternalBufferForSampling(buf, title);
            setWorkspaceMode('pads');
          }}
        />
      ) : (
        <>

      {/* Sources Tabs + MIDI Device Bar + Status Notification */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {s.sources.length === 0 ? (
            <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
              <Music2 size={12} className="text-[#FF6B00]" />
              Carga un audio, elige una pista de Supabase, graba mic o crea un loop Demo para empezar.
            </span>
          ) : (
            s.sources.map((src) => {
              const active = src.id === s.activeSource?.id;
              return (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => s.setActiveSourceId(src.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono flex items-center gap-1.5 border cursor-pointer transition-all ${
                    active
                      ? 'bg-[#FF6B00]/15 border-[#FF6B00] text-white font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate max-w-[160px]">{src.name}</span>
                  <span className="text-[9.5px] text-slate-400">
                    {src.bpm} BPM · {midiNoteToName(src.rootNote ?? 60)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-mono">
          {s.lastPitchEstimate && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
              <Sparkles size={11} />
              Pitch: {s.lastPitchEstimate.noteName} ({s.lastPitchEstimate.freqHz} Hz)
            </span>
          )}

          {midi.supported && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
              <Usb size={12} className="text-[#00E5FF]" />
              <span>MIDI:</span>
              <select
                value={midi.selectedInputId}
                onChange={(e) => midi.setSelectedInputId(e.target.value)}
                className="bg-transparent text-[10.5px] font-mono text-white focus:outline-none"
              >
                <option value="all" className="bg-slate-950">
                  {midi.inputs.length > 0
                    ? `Todos (${midi.inputs.length})`
                    : 'Sin teclado MIDI'}
                </option>
                {midi.inputs.map((inp) => (
                  <option key={inp.id} value={inp.id} className="bg-slate-950">
                    {inp.name}
                  </option>
                ))}
              </select>
              {midi.lastMidiEvent && (
                <span className="text-[#00E5FF] text-[9.5px]">
                  {midi.lastMidiEvent}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {s.statusMessage && (
        <div className="rounded-xl bg-slate-900/90 border border-[#00E5FF]/35 px-3 py-1.5 text-[11px] font-mono text-[#00E5FF] flex items-center justify-between">
          <span>{s.statusMessage}</span>
          <button
            type="button"
            onClick={() => s.setStatusMessage(null)}
            className="text-slate-500 hover:text-white cursor-pointer ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Chop / Slicing Toolbar + High-DPI Interactive Waveform Editor */}
      <SliceToolbar
        source={s.activeSource}
        selectedRegion={s.selectedRegion}
        projectTracks={projectTracks}
        snapMode={s.snapMode}
        showBpmGrid={showBpmGrid}
        isRecordingMic={s.isRecordingMic}
        isBusy={s.isBusy}
        onLoadFile={(file) => void s.loadAudioFile(file)}
        onLoadProjectTrack={(track) =>
          void s.loadAudioFromUrl(track.fileUrl, `${track.songTitle} - ${track.stemName}`, track.songId)
        }
        onLoadDemoSource={s.generateDemoSource}
        onToggleMicRecording={() => {
          if (s.isRecordingMic) void s.stopMicRecording();
          else void s.startMicRecording();
        }}
        onAutoSliceTransients={(sens) => void s.autoSliceByTransients(sens)}
        onAutoSliceGrid={s.autoSliceByGrid}
        onUpdateSourceBpm={(bpm) => {
          if (!s.activeSource) return;
          s.setSources((prev) =>
            prev.map((src) =>
              src.id === s.activeSource?.id ? { ...src, bpm } : src
            )
          );
          s.setPattern((prev) => ({ ...prev, bpm }));
        }}
        onChangeSnapMode={s.setSnapMode}
        onToggleBpmGrid={() => setShowBpmGrid((prev) => !prev)}
        onDetectPitch={() => void s.detectPitchForSelectedRegion()}
        onUpdateRegionCrossfade={(ms) => {
          if (!s.selectedRegion) return;
          s.updateRegionCrossfade(s.selectedRegion.id, ms);
        }}
      />

      {/* Studio Bass & Synth Instrument Generator for 16 Pads + Chromatic Keyboard */}
      <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 px-3.5 py-2.5 shadow-lg flex flex-wrap items-center justify-between gap-2.5 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-[#FF6B00] font-bold">
            <Waves size={14} />
            <span>Bajos Synth & Estudio → Pads:</span>
          </div>

          <select
            value={selectedStudioPresetId}
            onChange={(e) =>
              setSelectedStudioPresetId(e.target.value as DefaultInstrumentId)
            }
            className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white focus:border-[#00E5FF] focus:outline-none max-w-[260px] cursor-pointer"
          >
            <optgroup label={`Bajos Profesionales (${BASS_PRESET_CATALOG.length})`}>
              {BASS_PRESET_CATALOG.map((bp) => (
                <option key={bp.id} value={bp.id}>
                  {bp.badge ? `[${bp.badge}] ` : ''}
                  {bp.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Teclados, Guitarras & Synth">
              {MELODIC_PRESET_CATALOG.filter((m) => m.group !== 'bass').map((mp) => (
                <option key={mp.id} value={mp.id}>
                  {mp.label}
                </option>
              ))}
            </optgroup>
          </select>

          <button
            type="button"
            onClick={() => s.auditionStudioPreset(selectedStudioPresetId)}
            className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[#00E5FF] font-bold flex items-center gap-1 cursor-pointer"
            title="Escuchar muestra de estudio antes de cargar"
          >
            <Volume2 size={13} />
            <span>Probar</span>
          </button>

          <button
            type="button"
            onClick={() => {
              s.loadStudioPresetToPad(selectedStudioPresetId, s.selectedPadIndex);
              if (isBassPresetId(selectedStudioPresetId)) {
                setChromaticBaseMidi(36);
              }
            }}
            className="px-3 py-1.5 rounded-xl bg-[#FF6B00] hover:brightness-110 text-slate-950 font-black flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Sparkles size={13} />
            <span>Cargar en Pad {s.selectedPadIndex + 1}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            s.loadProBassPackToPads();
            setChromaticBaseMidi(36);
          }}
          className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6B00]/20 to-[#00E5FF]/20 hover:from-[#FF6B00]/30 hover:to-[#00E5FF]/30 border border-[#00E5FF]/50 text-[#00E5FF] font-bold flex items-center gap-1.5 cursor-pointer"
          title="Carga los 11 bajos profesionales (SH-101, Juno-106, Jupiter-8, Monark, Astra, 90s Pad, Auto-Wah, Sub-Octava...) directo en Pads 1–11"
        >
          <Grid size={13} />
          <span>Cargar Pack {BASS_PRESET_CATALOG.length} Bajos Pro</span>
        </button>
      </div>

      <SampleWaveformEditor
        source={s.activeSource}
        regions={s.activeSourceRegions}
        selectedRegion={s.selectedRegion}
        selectedPadIndex={s.selectedPadIndex}
        pyramid={s.waveformPyramid}
        isAuditioning={s.isAuditioning}
        loopAudition={s.loopAudition}
        showBpmGrid={showBpmGrid}
        onSelectRegion={(id) => s.setSelectedRegionId(id)}
        onUpdateRegionBounds={s.updateRegionBounds}
        onSnapSec={s.applySnapToSec}
        onCreateSliceAtSec={s.createSliceAtSec}
        onToggleAudition={s.toggleAudition}
        onToggleLoopAudition={() => s.setLoopAudition((prev) => !prev)}
        onDropAudioFile={(file) => void s.loadAudioFile(file)}
        onClickUploadAudio={() => pcUploadInputRef.current?.click()}
        onAssignRegionToSelectedPad={() => {
          if (s.selectedRegion) {
            s.assignRegionToPad(s.selectedRegion, s.selectedPadIndex);
            s.setStatusMessage(
              `Región "${s.selectedRegion.name}" asignada al Pad ${s.selectedPadIndex + 1}.`
            );
          }
        }}
        onQuickExportRegion={() => {
          void handleExportSingle('region', 'wav').catch((err) =>
            s.setStatusMessage(
              err instanceof Error ? err.message : 'Error exportando región al PC.'
            )
          );
        }}
      />

      {/* Main Performance + Synthesis / Sound Design Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        <div className="lg:col-span-6">
          <PadGrid
            pads={s.pads}
            regions={s.regions}
            selectedPadIndex={s.selectedPadIndex}
            activePadSet={s.activePadSet}
            chromaticMode={chromaticMode}
            chromaticBaseMidi={chromaticBaseMidi}
            onSelectPad={handleSelectPad}
            onTriggerPad={s.triggerPad}
            onReleasePad={s.releasePad}
            onToggleChromaticMode={() => setChromaticMode((p) => !p)}
            onChangeChromaticOctave={(delta) =>
              setChromaticBaseMidi((prev) =>
                Math.max(24, Math.min(84, prev + delta))
              )
            }
            onPlayChromaticNote={(midiNote) => handlePlayChromatic(midiNote, 0.9)}
            onReleaseChromaticNote={handleReleaseChromatic}
            onDropRegionOnPad={(regionId, padIndex) => {
              const reg = s.regions.find((r) => r.id === regionId);
              if (reg) s.assignRegionToPad(reg, padIndex);
            }}
            onUploadFileToPad={(file, padIndex) => void s.loadAudioFileToPad(file, padIndex)}
            onClearPad={(padIndex) => {
              s.setPads((prev) =>
                prev.map((p, idx) =>
                  idx === padIndex
                    ? {
                        ...p,
                        regionId: null,
                        label: `Pad ${idx + 1}`,
                        params: createDefaultPadParams(),
                      }
                    : p
                )
              );
            }}
            onCopyPadToNext={(padIndex) => {
              const nextIdx = (padIndex + 1) % 16;
              const srcPad = s.pads[padIndex];
              s.setPads((prev) =>
                prev.map((p, idx) =>
                  idx === nextIdx
                    ? {
                        ...p,
                        regionId: srcPad.regionId,
                        label: `${srcPad.label} (Copy)`,
                        params: structuredClone(srcPad.params),
                      }
                    : p
                )
              );
              s.setSelectedPadIndex(nextIdx);
            }}
            onSendPadToMasteringDrum={(padIndex, type) =>
              void handleSendPadToMasteringDrum(padIndex, type)
            }
          />
        </div>

        <div className="lg:col-span-6">
          <PadInspector
            pad={s.selectedPad}
            onUpdateParams={(patch) => s.updatePadParams(s.selectedPadIndex, patch)}
            onUpdateLabel={(label) =>
              s.updatePadLabelAndChoke(s.selectedPadIndex, label)
            }
            onApplyTexturePreset={(presetId) =>
              s.applyTexturePreset(s.selectedPadIndex, presetId)
            }
            onAutoTuneToRoot={() => void s.autoTunePadToRoot(s.selectedPadIndex)}
            onUploadFileToSelectedPad={(file) =>
              void s.loadAudioFileToPad(file, s.selectedPadIndex)
            }
          />
        </div>
      </div>

      {/* 16/32-Step Pattern Sequencer */}
      <StepSequencer
        pads={s.pads}
        pattern={s.pattern}
        currentStep={s.currentStep}
        isPlaying={s.isSequencerPlaying}
        isRecording={s.isSequencerRecording}
        onTogglePlay={s.toggleSequencer}
        onToggleRecord={() =>
          s.setIsSequencerRecording(!s.isSequencerRecording)
        }
        onToggleStep={s.toggleStep}
        onChangeBpm={(bpm) => s.setPattern((prev) => ({ ...prev, bpm }))}
        onChangeSwing={(swing) => s.setPattern((prev) => ({ ...prev, swing }))}
        onClearPattern={() =>
          s.setPattern(createDefaultPattern(s.pattern.bpm, s.pattern.steps))
        }
      />
        </>
      )}

      {/* Export Dialog */}
      <SampleExportDialog
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        selectedPad={s.selectedPad}
        selectedRegion={s.selectedRegion}
        regionsCount={s.activeSourceRegions.length}
        onExportSinglePad={(fmt) => handleExportSingle('pad', fmt)}
        onExportRegion={(fmt) => handleExportSingle('region', fmt)}
        onExportSlicesZip={handleExportSlicesZip}
        onExportPatternBounce={(bars, loop, fmt) =>
          handleExportSingle('bounce', fmt, bars, loop)
        }
        onSendBounceToMastering={handleSendBounceToMastering}
      />

      {/* Save to Supabase Cloud & Song Folders ("Temas") Modal */}
      <SaveToSupabaseModal
        isOpen={isSupabaseOpen}
        onClose={() => setIsSupabaseOpen(false)}
        kitName={s.kitName}
        selectedPad={s.selectedPad}
        selectedRegion={s.selectedRegion}
        hasSources={s.sources.length > 0}
        onSaveKitToCloud={async (songId) => {
          const kitObj = s.buildCurrentKitObject();
          const saved = await saveKitToSupabase({
            kit: kitObj,
            sources: s.sources,
            songId,
          });
          s.setStatusMessage(
            `Kit "${saved.name}" guardado en la nube Supabase (listo para cargar o exportar).`
          );
        }}
        onAddSampleToSongFolder={async (opts) => {
          const { buffer } = await renderExportAudioBuffer(
            opts.sourceKind,
            opts.bounceBars,
            true
          );
          const wavBlob = await encodeBufferToWav24WithMetadata(buffer, {
            rootMidiNote: s.activeSource?.rootNote ?? 60,
          });
          const res = await addSampleToSongFolder({
            songId: opts.songId,
            bandId: opts.bandId,
            sampleName: opts.sampleName,
            wavBlob,
            durationSec: buffer.duration,
            originKind: opts.sourceKind,
            bpm: s.pattern.bpm,
            rootNote: s.activeSource?.rootNote ?? 60,
          });
          s.setStatusMessage(
            `Audio "${res.stemName}" añadido al Tema en Supabase como pista lista para Studio / Exportar.`
          );
          return { stemName: res.stemName };
        }}
      />

      {/* Local IndexedDB + Supabase Cloud Kit Library Modal */}
      <KitLibraryModal
        isOpen={isKitLibraryOpen}
        onClose={() => setIsKitLibraryOpen(false)}
        onSaveLocalSnapshot={async () => {
          const kitObj = s.buildCurrentKitObject();
          await saveKitTempToIndexedDb(kitObj, s.sources, kitObj.id);
          s.setStatusMessage(`Snapshot guardado localmente en IndexedDB.`);
        }}
        onLoadLocalKit={async (kit) => {
          const eng = s.engineRef.current;
          if (!eng) return;
          const ctx = eng.ensureContext();
          const hydrated = await loadKitTempFromIndexedDb(ctx, kit.id);
          if (hydrated) {
            s.loadHydratedKit(hydrated.kit, hydrated.sources);
          }
        }}
        onLoadCloudKit={async (rec) => {
          const eng = s.engineRef.current;
          if (!eng) return;
          const ctx = eng.ensureContext();
          const srcs = await loadCloudKitSources(rec, ctx);
          s.loadHydratedKit(rec.kit_json, srcs);
        }}
      />
      </div>
    </div>
  );
};

export const SampleLabModule = SampleLabPanel;
export default SampleLabPanel;
