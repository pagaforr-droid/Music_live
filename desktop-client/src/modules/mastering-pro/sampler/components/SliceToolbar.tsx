import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Mic,
  Square,
  Zap,
  Grid,
  Disc3,
  Music,
  FolderOpen,
  Magnet,
} from 'lucide-react';
import type { SampleRegion, SampleSource, SnapMode } from '../types/sampler.types';
import type { GridDivision } from '../engine/Slicer';
import type { ProjectAudioTrackItem } from '../../services/supabaseMasteringService';

interface SliceToolbarProps {
  source: SampleSource | null;
  selectedRegion: SampleRegion | null;
  projectTracks: ProjectAudioTrackItem[];
  snapMode: SnapMode;
  patternBpm?: number;
  showBpmGrid: boolean;
  isRecordingMic: boolean;
  isBusy: boolean;
  onLoadFile: (file: File) => void;
  onLoadProjectTrack: (track: ProjectAudioTrackItem) => void;
  onLoadDemoSource: () => void;
  onToggleMicRecording: () => void;
  onAutoSliceTransients: (sensitivity: number) => void;
  onAutoSliceGrid: (div: GridDivision) => void;
  onAutoSliceChords?: () => void;
  onUpdateSourceBpm: (bpm: number) => void;
  onChangeSnapMode: (mode: SnapMode) => void;
  onToggleBpmGrid: () => void;
  onDetectPitch: () => void;
  onUpdateRegionCrossfade: (ms: number) => void;
}

export const SliceToolbar: React.FC<SliceToolbarProps> = ({
  source,
  selectedRegion,
  projectTracks,
  snapMode,
  patternBpm,
  showBpmGrid,
  isRecordingMic,
  isBusy,
  onLoadFile,
  onLoadProjectTrack,
  onLoadDemoSource,
  onToggleMicRecording,
  onAutoSliceTransients,
  onAutoSliceGrid,
  onAutoSliceChords,
  onUpdateSourceBpm,
  onChangeSnapMode,
  onToggleBpmGrid,
  onDetectPitch,
  onUpdateRegionCrossfade,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sensitivity, setSensitivity] = useState<number>(0.62);
  const [gridDiv, setGridDiv] = useState<GridDivision>('1/8');
  const [bpmDraft, setBpmDraft] = useState<string>(String(source?.bpm ?? 120));

  useEffect(() => {
    setBpmDraft(String(source?.bpm ?? 120));
  }, [source?.id, source?.bpm]);

  return (
    <div className="rounded-2xl bg-[#121215] border border-white/[0.08] p-3.5 flex flex-wrap items-center justify-between gap-3">
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,.aiff,.aif,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadFile(f);
          e.target.value = '';
        }}
      />

      {/* Left: Sources */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isBusy}
          className="px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
          title="Subir audio desde tu PC (WAV, MP3, FLAC, OGG, M4A, AAC)"
        >
          <Upload size={13} />
          <span>Subir del PC</span>
        </button>

        <button
          type="button"
          onClick={onLoadDemoSource}
          className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <Disc3 size={13} className="text-orange-400" />
          <span>Demo Loop</span>
        </button>

        <button
          type="button"
          onClick={onToggleMicRecording}
          className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-all ${
            isRecordingMic
              ? 'bg-rose-500 text-white border-rose-400 animate-pulse'
              : 'bg-[#1A1A1F] hover:bg-[#24242B] border-white/[0.08] text-zinc-300'
          }`}
        >
          {isRecordingMic ? <Square size={12} className="fill-current" /> : <Mic size={13} className="text-rose-400" />}
          <span>{isRecordingMic ? 'Detener Rec' : 'Grabar Mic'}</span>
        </button>

        {projectTracks.length > 0 && (
          <div className="flex items-center gap-1.5 bg-[#0B0B0D] border border-white/[0.08] rounded-xl px-2.5 py-1.5">
            <FolderOpen size={12} className="text-zinc-400" />
            <select
              defaultValue=""
              onChange={(e) => {
                const tr = projectTracks.find((t) => t.id === e.target.value);
                if (tr) onLoadProjectTrack(tr);
              }}
              className="bg-transparent text-xs text-zinc-200 focus:outline-none max-w-[175px]"
            >
              <option value="" disabled className="bg-[#121215]">
                Pista del Proyecto...
              </option>
              {projectTracks.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#121215]">
                  {t.songTitle} · {t.stemName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Center: Slicing Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 bg-[#0B0B0D] border border-white/[0.08] rounded-xl px-2.5 py-1">
          <Zap size={12} className="text-orange-400" />
          <span className="text-[10.5px] text-zinc-500">Sens:</span>
          <input
            type="range"
            min={0.15}
            max={0.95}
            step={0.05}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="w-16 accent-zinc-200 h-1 bg-zinc-800 rounded cursor-pointer"
          />
          <button
            type="button"
            disabled={!source || isBusy}
            onClick={() => onAutoSliceTransients(sensitivity)}
            className="px-2.5 py-1 rounded-lg bg-[#222228] hover:bg-zinc-100 text-zinc-100 hover:text-zinc-950 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40"
          >
            Auto-Slice Transientes
          </button>
        </div>

        <div className="flex items-center gap-1 bg-[#0B0B0D] border border-white/[0.08] rounded-xl px-2 py-1">
          <Grid size={12} className="text-zinc-400" />
          <input
            type="number"
            min={40}
            max={240}
            step={0.1}
            value={bpmDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setBpmDraft(raw);
              const parsed = Number(raw);
              if (Number.isFinite(parsed) && parsed >= 40 && parsed <= 240) {
                onUpdateSourceBpm(parsed);
              }
            }}
            onBlur={() => {
              const parsed = Number(bpmDraft);
              if (Number.isFinite(parsed) && parsed >= 40 && parsed <= 240) {
                onUpdateSourceBpm(parsed);
              } else {
                setBpmDraft(String(source?.bpm ?? 120));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="w-12 bg-[#16161B] border border-white/[0.08] rounded px-1 py-0.5 text-[11px] font-mono text-zinc-100 text-center"
            title="BPM original de la fuente de audio"
          />
          {source && (
            <>
              <button
                type="button"
                onClick={() => onUpdateSourceBpm(Math.max(40, Math.round((source.bpm * 0.5) * 10) / 10))}
                className="px-1.5 py-0.5 rounded bg-[#16161B] hover:bg-[#24242C] border border-white/[0.08] text-[9.5px] font-mono text-zinc-300 cursor-pointer"
                title="Dividir tempo ÷2"
              >
                ÷2
              </button>
              <button
                type="button"
                onClick={() => onUpdateSourceBpm(Math.min(220, Math.round((source.bpm * 2) * 10) / 10))}
                className="px-1.5 py-0.5 rounded bg-[#16161B] hover:bg-[#24242C] border border-white/[0.08] text-[9.5px] font-mono text-zinc-300 cursor-pointer"
                title="Multiplicar tempo ×2"
              >
                ×2
              </button>
            </>
          )}
          <select
            value={gridDiv}
            onChange={(e) => setGridDiv(e.target.value as GridDivision)}
            className="bg-[#16161B] border border-white/[0.08] rounded px-1.5 py-0.5 text-[11px] font-mono text-zinc-200"
          >
            <option value="1bar">1 Compás</option>
            <option value="1/2">1/2</option>
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="1/16">1/16</option>
            <option value="1/8T">1/8T</option>
          </select>
          <button
            type="button"
            disabled={!source}
            onClick={() => onAutoSliceGrid(gridDiv)}
            className="px-2.5 py-1 rounded-lg bg-[#222228] hover:bg-zinc-100 text-zinc-100 hover:text-zinc-950 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40"
          >
            Rejilla
          </button>
          {source && patternBpm && Math.abs(patternBpm - source.bpm) >= 0.5 && (
            <span
              className="px-1.5 py-0.5 rounded bg-emerald-500/12 border border-emerald-500/30 text-emerald-300 text-[9.5px] font-mono"
              title="Los pads con Sync Tempo activo estiran la duración de forma transparente"
            >
              Sync {source.bpm}→{patternBpm}
            </span>
          )}

          {onAutoSliceChords && source?.preAnalysis?.chords && source.preAnalysis.chords.length > 0 && (
            <button
              type="button"
              onClick={onAutoSliceChords}
              className="px-2 py-1 rounded-lg bg-[#22222B] hover:bg-zinc-100 text-zinc-200 hover:text-zinc-950 border border-white/[0.1] text-[11px] font-medium transition-colors cursor-pointer"
              title={`Cortar exactamente por los ${source.preAnalysis.chords.length} acordes detectados en memoria (${source.preAnalysis.chordProgressionSummary})`}
            >
              Cortar Acordes ({source.preAnalysis.chords.length})
            </button>
          )}
        </div>
      </div>

      {/* Right: Snap, YIN Pitch & Loop Crossfade */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-[#0B0B0D] border border-white/[0.08] rounded-xl px-2.5 py-1 text-[11px]">
          <Magnet size={12} className="text-emerald-400" />
          <select
            value={snapMode}
            onChange={(e) => onChangeSnapMode(e.target.value as SnapMode)}
            className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer"
          >
            <option value="zero-cross" className="bg-[#121215]">Snap Cero</option>
            <option value="transient" className="bg-[#121215]">Snap Transiente</option>
            <option value="grid" className="bg-[#121215]">Snap Rejilla</option>
            <option value="none" className="bg-[#121215]">Libre</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onToggleBpmGrid}
          className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-medium cursor-pointer transition-colors ${
            showBpmGrid
              ? 'bg-[#222228] border-white/[0.18] text-zinc-100'
              : 'bg-[#0B0B0D] border-white/[0.07] text-zinc-500'
          }`}
        >
          Grid
        </button>

        <button
          type="button"
          disabled={!selectedRegion}
          onClick={onDetectPitch}
          className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.08] text-zinc-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40"
          title="Detectar tono fundamental (YIN) de la región seleccionada"
        >
          <Music size={12} className="text-emerald-400" />
          <span>Detectar Nota (YIN)</span>
        </button>

        {selectedRegion && (
          <div className="flex items-center gap-1.5 bg-[#0B0B0D] border border-white/[0.08] rounded-xl px-2.5 py-1 text-[10.5px] text-zinc-500">
            <span>Loop XF:</span>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={selectedRegion.loopCrossfadeMs}
              onChange={(e) => onUpdateRegionCrossfade(Number(e.target.value))}
              className="w-12 accent-zinc-200 h-1 bg-zinc-800 rounded cursor-pointer"
            />
            <span className="text-zinc-200 font-mono">{selectedRegion.loopCrossfadeMs}ms</span>
          </div>
        )}
      </div>
    </div>
  );
};
