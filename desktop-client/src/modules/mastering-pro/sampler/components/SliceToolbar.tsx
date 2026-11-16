import React, { useRef, useState } from 'react';
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
  showBpmGrid: boolean;
  isRecordingMic: boolean;
  isBusy: boolean;
  onLoadFile: (file: File) => void;
  onLoadProjectTrack: (track: ProjectAudioTrackItem) => void;
  onLoadDemoSource: () => void;
  onToggleMicRecording: () => void;
  onAutoSliceTransients: (sensitivity: number) => void;
  onAutoSliceGrid: (div: GridDivision) => void;
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
  showBpmGrid,
  isRecordingMic,
  isBusy,
  onLoadFile,
  onLoadProjectTrack,
  onLoadDemoSource,
  onToggleMicRecording,
  onAutoSliceTransients,
  onAutoSliceGrid,
  onUpdateSourceBpm,
  onChangeSnapMode,
  onToggleBpmGrid,
  onDetectPitch,
  onUpdateRegionCrossfade,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sensitivity, setSensitivity] = useState<number>(0.62);
  const [gridDiv, setGridDiv] = useState<GridDivision>('1/8');

  return (
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 p-3.5 shadow-lg flex flex-wrap items-center justify-between gap-3">
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,audio/*"
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
          className="px-3 py-1.5 rounded-xl bg-[#00E5FF] hover:bg-cyan-300 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
        >
          <Upload size={13} />
          <span>Cargar Audio</span>
        </button>

        <button
          type="button"
          onClick={onLoadDemoSource}
          className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-1.5 cursor-pointer"
        >
          <Disc3 size={13} className="text-[#FF6B00]" />
          <span>Demo Loop</span>
        </button>

        <button
          type="button"
          onClick={onToggleMicRecording}
          className={`px-2.5 py-1.5 rounded-xl border text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-all ${
            isRecordingMic
              ? 'bg-rose-500 text-white border-rose-400 animate-pulse'
              : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
          }`}
        >
          {isRecordingMic ? <Square size={12} className="fill-current" /> : <Mic size={13} className="text-rose-400" />}
          <span>{isRecordingMic ? 'Detener Rec' : 'Grabar Mic'}</span>
        </button>

        {projectTracks.length > 0 && (
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5">
            <FolderOpen size={12} className="text-[#00E5FF]" />
            <select
              defaultValue=""
              onChange={(e) => {
                const tr = projectTracks.find((t) => t.id === e.target.value);
                if (tr) onLoadProjectTrack(tr);
              }}
              className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none max-w-[175px]"
            >
              <option value="" disabled className="bg-slate-950">
                Pista del Proyecto...
              </option>
              {projectTracks.map((t) => (
                <option key={t.id} value={t.id} className="bg-slate-950">
                  {t.songTitle} · {t.stemName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Center: Slicing Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1">
          <Zap size={12} className="text-[#FF6B00]" />
          <span className="text-[10px] font-mono text-slate-400">Sens:</span>
          <input
            type="range"
            min={0.15}
            max={0.95}
            step={0.05}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="w-16 accent-[#FF6B00] h-1 bg-slate-800 rounded cursor-pointer"
          />
          <button
            type="button"
            disabled={!source || isBusy}
            onClick={() => onAutoSliceTransients(sensitivity)}
            className="px-2 py-1 rounded-lg bg-[#FF6B00]/20 hover:bg-[#FF6B00] text-[#FF6B00] hover:text-slate-950 text-[11px] font-mono font-bold transition-colors cursor-pointer disabled:opacity-40"
          >
            Auto-Slice Transientes
          </button>
        </div>

        <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1">
          <Grid size={12} className="text-[#00E5FF]" />
          <input
            type="number"
            min={40}
            max={240}
            value={source?.bpm ?? 120}
            onChange={(e) => onUpdateSourceBpm(Number(e.target.value) || 120)}
            className="w-11 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] font-mono text-white text-center"
            title="BPM de la fuente"
          />
          <select
            value={gridDiv}
            onChange={(e) => setGridDiv(e.target.value as GridDivision)}
            className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px] font-mono text-slate-200"
          >
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="1/16">1/16</option>
            <option value="1/8T">1/8T</option>
          </select>
          <button
            type="button"
            disabled={!source}
            onClick={() => onAutoSliceGrid(gridDiv)}
            className="px-2 py-1 rounded-lg bg-[#00E5FF]/20 hover:bg-[#00E5FF] text-[#00E5FF] hover:text-slate-950 text-[11px] font-mono font-bold transition-colors cursor-pointer disabled:opacity-40"
          >
            Rejilla
          </button>
        </div>
      </div>

      {/* Right: Snap, YIN Pitch & Loop Crossfade */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-[11px] font-mono">
          <Magnet size={12} className="text-emerald-400" />
          <select
            value={snapMode}
            onChange={(e) => onChangeSnapMode(e.target.value as SnapMode)}
            className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="zero-cross" className="bg-slate-950">Snap Cero</option>
            <option value="transient" className="bg-slate-950">Snap Transiente</option>
            <option value="grid" className="bg-slate-950">Snap Rejilla</option>
            <option value="none" className="bg-slate-950">Libre</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onToggleBpmGrid}
          className={`px-2 py-1.5 rounded-xl border text-[11px] font-mono cursor-pointer ${
            showBpmGrid
              ? 'bg-[#00E5FF]/15 border-[#00E5FF]/50 text-[#00E5FF]'
              : 'bg-slate-950 border-slate-800 text-slate-400'
          }`}
        >
          Grid
        </button>

        <button
          type="button"
          disabled={!selectedRegion}
          onClick={onDetectPitch}
          className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"
          title="Detectar tono fundamental (YIN) de la región seleccionada"
        >
          <Music size={12} />
          <span>Detectar Nota (YIN)</span>
        </button>

        {selectedRegion && (
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-[10px] font-mono text-slate-400">
            <span>Loop XF:</span>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={selectedRegion.loopCrossfadeMs}
              onChange={(e) => onUpdateRegionCrossfade(Number(e.target.value))}
              className="w-12 accent-emerald-400 h-1 bg-slate-800 rounded cursor-pointer"
            />
            <span className="text-emerald-400">{selectedRegion.loopCrossfadeMs}ms</span>
          </div>
        )}
      </div>
    </div>
  );
};
