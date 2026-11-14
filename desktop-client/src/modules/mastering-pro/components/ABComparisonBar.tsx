import React, { useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Upload,
  Sparkles,
  Scale,
  Download,
  CloudUpload,
  Disc3,
  Radio,
  Volume2,
} from 'lucide-react';

interface ABComparisonBarProps {
  trackTitle: string;
  hasAudio: boolean;
  isPlaying: boolean;
  currentTimeSec: number;
  durationSec: number;
  isBypassed: boolean;
  isGainMatch: boolean;
  targetLufs: number;
  autoAdaptEnabled: boolean;
  isAnalyzing: boolean;
  isExporting: boolean;
  isSavingCloud: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onFileSelected: (file: File) => void;
  onLoadDemoTrack: () => void;
  onRunAiAnalysis: () => void;
  onToggleBypass: (bypass: boolean) => void;
  onToggleGainMatch: () => void;
  onSelectTargetLufs: (lufs: number) => void;
  onToggleAutoAdapt: () => void;
  onExportWav24: () => void;
  onSaveToCloud: () => void;
}

const TARGET_LUFS_OPTIONS: Array<{
  lufs: number;
  label: string;
  sub: string;
}> = [
  { lufs: -14, label: '-14 LUFS', sub: 'Streaming' },
  { lufs: -11, label: '-11 LUFS', sub: 'Studio Pro' },
  { lufs: -9, label: '-9 LUFS', sub: 'Club / Max' },
  { lufs: -8.5, label: '-8.5 LUFS', sub: 'Arena Loud' },
];

export function formatTimeMmSs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
}

export const ABComparisonBar: React.FC<ABComparisonBarProps> = ({
  trackTitle,
  hasAudio,
  isPlaying,
  currentTimeSec,
  durationSec,
  isBypassed,
  isGainMatch,
  targetLufs,
  autoAdaptEnabled,
  isAnalyzing,
  isExporting,
  isSavingCloud,
  onTogglePlay,
  onStop,
  onFileSelected,
  onLoadDemoTrack,
  onRunAiAnalysis,
  onToggleBypass,
  onToggleGainMatch,
  onSelectTargetLufs,
  onToggleAutoAdapt,
  onExportWav24,
  onSaveToCloud,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="w-full rounded-2xl bg-slate-900/95 border border-slate-800/90 px-4 py-3 shadow-[0_12px_35px_rgba(0,0,0,0.65)] backdrop-blur-md"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,audio/*"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Transport + Track Status + Drag & Drop Load */}
        <div className="flex items-center gap-2.5 min-w-[260px]">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!hasAudio}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all border ${
              !hasAudio
                ? 'bg-slate-800/60 border-slate-700/50 text-slate-600 cursor-not-allowed'
                : isPlaying
                ? 'bg-[#FF6B00] border-[#FF6B00] text-slate-950 shadow-[0_0_20px_rgba(255,107,0,0.45)]'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-white'
            }`}
            title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
          >
            {isPlaying ? (
              <Pause size={19} className="fill-current" />
            ) : (
              <Play size={19} className="fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onStop}
            disabled={!hasAudio}
            className="w-9 h-9 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/70 flex items-center justify-center text-slate-300 hover:text-white disabled:opacity-40 transition-colors"
            title="Volver al inicio"
          >
            <RotateCcw size={15} />
          </button>

          {/* Timecode + Track Info */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                <Radio
                  size={11}
                  className={
                    isPlaying
                      ? 'text-[#00E5FF] animate-pulse'
                      : 'text-slate-600'
                  }
                />
                <span className="truncate max-w-[165px] text-slate-200 font-semibold">
                  {trackTitle || 'Sin pista cargada'}
                </span>
              </div>
              <div className="text-xs font-mono text-[#00E5FF] tracking-wider mt-0.5">
                {formatTimeMmSs(currentTimeSec)}{' '}
                <span className="text-slate-600">/</span>{' '}
                <span className="text-slate-400">
                  {formatTimeMmSs(durationSec)}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 hover:border-[#00E5FF]/50 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-all"
            title="Subir archivo WAV, FLAC o MP3 (o arrastra aquí)"
          >
            <Upload size={14} className="text-[#00E5FF]" />
            <span>Cargar Audio</span>
          </button>

          <button
            type="button"
            onClick={onLoadDemoTrack}
            className="px-2.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-300 hover:text-[#FF6B00] flex items-center gap-1.5 transition-all"
            title="Generar pista de referencia de estudio en 32-bit para probar el rack"
          >
            <Disc3 size={13} className="text-[#FF6B00]" />
            <span>Demo Track</span>
          </button>
        </div>

        {/* Center: A/B Hardware Switch + Gain-Match + AI Auto-Analyze */}
        <div className="flex flex-wrap items-center gap-2">
          {/* A / B Segmented Switch */}
          <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => onToggleBypass(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all ${
                isBypassed
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              A · ORIGINAL
            </button>
            <button
              type="button"
              onClick={() => onToggleBypass(false)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                !isBypassed
                  ? 'bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] text-slate-950 shadow-[0_0_16px_rgba(0,229,255,0.3)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              B · MASTER PRO
            </button>
          </div>

          {/* Gain Match Toggle */}
          <button
            type="button"
            onClick={onToggleGainMatch}
            className={`px-2.5 py-2 rounded-xl border text-xs font-mono flex items-center gap-1.5 transition-all ${
              isGainMatch
                ? 'bg-[#00E5FF]/15 border-[#00E5FF]/60 text-[#00E5FF]'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Iguala automáticamente el volumen del audio Original al del Master para comparar calidad real sin engaño de volumen"
          >
            <Scale size={13} />
            <span>Gain-Match</span>
          </button>

          {/* Auto-Analyze AI Button */}
          <button
            type="button"
            onClick={onRunAiAnalysis}
            disabled={!hasAudio || isAnalyzing}
            className="px-3 py-2 rounded-xl bg-[#FF6B00]/15 hover:bg-[#FF6B00]/25 border border-[#FF6B00]/60 text-xs font-semibold text-[#FF6B00] flex items-center gap-1.5 disabled:opacity-40 transition-all"
            title="Escanea el espectro ITU-R BS.1770-4 y recomienda el preset + curva adaptativa ideal"
          >
            <Sparkles
              size={14}
              className={isAnalyzing ? 'animate-spin' : ''}
            />
            <span>{isAnalyzing ? 'Escaneando...' : 'Auto-Analyze AI'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleAutoAdapt}
            className={`px-2.5 py-2 rounded-xl border text-[11px] font-mono transition-all ${
              autoAdaptEnabled
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
            title="Activa/desactiva la corrección espectral adaptativa (deltaGain) sobre el preset"
          >
            Delta EQ: {autoAdaptEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Right: Target LUFS Selector + Export 24-Bit WAV + Cloud Save */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1">
            <Volume2 size={13} className="text-slate-400 ml-1.5 mr-0.5" />
            {TARGET_LUFS_OPTIONS.map((opt) => {
              const active = Math.abs(targetLufs - opt.lufs) < 0.3;
              return (
                <button
                  key={opt.lufs}
                  type="button"
                  onClick={() => onSelectTargetLufs(opt.lufs)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-mono leading-tight transition-all ${
                    active
                      ? 'bg-[#FF6B00] text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title={`${opt.label} (${opt.sub})`}
                >
                  <div>{opt.label}</div>
                  <div className="text-[8px] opacity-80">{opt.sub}</div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onExportWav24}
            disabled={!hasAudio || isExporting}
            className="px-3.5 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#ff7b1a] text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-[0_0_20px_rgba(255,107,0,0.35)] disabled:opacity-40 transition-all"
          >
            <Download size={14} />
            <span>
              {isExporting ? 'Renderizando 24-Bit...' : 'Exportar WAV 24-Bit'}
            </span>
          </button>

          <button
            type="button"
            onClick={onSaveToCloud}
            disabled={!hasAudio || isSavingCloud}
            className="px-3 py-2 rounded-xl bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 border border-[#00E5FF]/50 text-[#00E5FF] font-semibold text-xs flex items-center gap-1.5 disabled:opacity-40 transition-all"
            title="Guardar Master WAV 24-Bit en Supabase Storage y registrar sesión"
          >
            <CloudUpload size={14} />
            <span>{isSavingCloud ? 'Guardando...' : 'Guardar Cloud'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
