import React, { useRef } from 'react';
import { motion } from 'framer-motion';
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
  { lufs: -10, label: '-10 LUFS', sub: 'Radio Punch' },
  { lufs: -9, label: '-9 LUFS', sub: 'Club / Max' },
];

const SPRING_PILL = {
  type: 'spring' as const,
  stiffness: 460,
  damping: 34,
  mass: 0.75,
};

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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="w-full rounded-2xl mastering-surface px-4 py-3 backdrop-blur-xl"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,audio/*"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex flex-wrap items-center justify-between gap-3.5">
        {/* Left: Transport + Apple Logic Light LCD Readout + Drag & Drop Load */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-[280px]">
          <motion.button
            type="button"
            whileTap={hasAudio ? { scale: 0.94 } : undefined}
            onClick={onTogglePlay}
            disabled={!hasAudio}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors border ${
              !hasAudio
                ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                : isPlaying
                ? 'bg-gradient-to-b from-[#38bdf8] to-[#0284c7] border-[#0284c7] text-white shadow-[0_4px_16px_rgba(14,165,233,0.35)] cursor-pointer'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-900 text-white shadow-sm cursor-pointer'
            }`}
            title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
          >
            {isPlaying ? (
              <Pause size={18} className="fill-current" />
            ) : (
              <Play size={18} className="fill-current ml-0.5" />
            )}
          </motion.button>

          <motion.button
            type="button"
            whileTap={hasAudio ? { scale: 0.94 } : undefined}
            onClick={onStop}
            disabled={!hasAudio}
            className="w-10 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 disabled:opacity-40 transition-colors cursor-pointer"
            title="Volver al inicio"
          >
            <RotateCcw size={15} />
          </motion.button>

          {/* Timecode + Track Info Light Ice LCD Display */}
          <div className="px-3.5 py-1.5 rounded-xl bg-[#f0f7ff] border border-sky-200/80 shadow-inner flex items-center gap-3 min-w-[210px] sm:min-w-[245px]">
            <div className="w-full">
              <div className="text-[11px] font-medium tracking-tight text-slate-600 flex items-center gap-1.5">
                <Radio
                  size={11}
                  className={
                    isPlaying
                      ? 'text-sky-500 animate-pulse shrink-0'
                      : 'text-slate-400 shrink-0'
                  }
                />
                <span className="truncate max-w-[185px] sm:max-w-[230px] text-slate-900 font-semibold">
                  {trackTitle || 'Sin pista cargada'}
                </span>
              </div>
              <div className="text-xs font-mono font-bold text-sky-700 tracking-wider mt-0.5">
                {formatTimeMmSs(currentTimeSec)}{' '}
                <span className="text-slate-300">/</span>{' '}
                <span className="text-slate-500 font-normal">
                  {formatTimeMmSs(durationSec)}
                </span>
              </div>
            </div>
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => fileInputRef.current?.click()}
            className="h-10 px-3.5 rounded-xl bg-white hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-xs font-medium text-slate-700 hover:text-sky-800 flex items-center gap-2 shadow-2xs transition-colors cursor-pointer"
            title="Subir archivo WAV, FLAC o MP3 (o arrastra aquí)"
          >
            <Upload size={13.5} className="text-sky-600" />
            <span>Cargar Audio</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onLoadDemoTrack}
            className="h-10 px-3 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Generar pista de referencia de estudio en 32-bit para probar el rack"
          >
            <Disc3 size={13.5} className="text-sky-600" />
            <span>Demo Track</span>
          </motion.button>
        </div>

        {/* Center: A/B Hardware Switch + Gain-Match + AI Auto-Analyze */}
        <div className="flex flex-wrap items-center gap-2">
          {/* A / B Segmented Switch with Spring Layout Pill */}
          <div className="relative flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
            <button
              type="button"
              onClick={() => onToggleBypass(true)}
              className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                isBypassed
                  ? 'text-slate-900'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {isBypassed && (
                <motion.span
                  layoutId="ab-master-switch-pill"
                  transition={SPRING_PILL}
                  className="absolute inset-0 rounded-lg bg-white border border-slate-200 shadow-xs -z-10"
                />
              )}
              A · ORIGINAL
            </button>
            <button
              type="button"
              onClick={() => onToggleBypass(false)}
              className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                !isBypassed
                  ? 'text-white'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {!isBypassed && (
                <motion.span
                  layoutId="ab-master-switch-pill"
                  transition={SPRING_PILL}
                  className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#0284c7] to-[#38bdf8] shadow-[0_2px_12px_rgba(14,165,233,0.3)] -z-10"
                />
              )}
              B · MASTER PRO
            </button>
          </div>

          {/* Gain Match Toggle */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onToggleGainMatch}
            className={`h-9 px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              isGainMatch
                ? 'bg-sky-50 border-sky-300 text-sky-700'
                : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
            title="Iguala automáticamente el volumen del audio Original al del Master para comparar calidad real sin engaño de volumen"
          >
            <Scale size={13} />
            <span>Gain-Match</span>
          </motion.button>

          {/* Auto-Analyze AI Button */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onRunAiAnalysis}
            disabled={!hasAudio || isAnalyzing}
            className="h-9 px-3.5 rounded-xl bg-sky-100/80 hover:bg-sky-100 border border-sky-300 text-xs font-semibold text-sky-800 flex items-center gap-1.5 disabled:opacity-40 transition-colors cursor-pointer"
            title="Escanea el espectro ITU-R BS.1770-4 y recomienda el preset + curva adaptativa ideal"
          >
            <Sparkles
              size={13.5}
              className={isAnalyzing ? 'animate-spin text-sky-600' : 'text-sky-600'}
            />
            <span>{isAnalyzing ? 'Escaneando...' : 'Auto-Analyze AI'}</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onToggleAutoAdapt}
            className={`h-9 px-3 rounded-xl border text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
              autoAdaptEnabled
                ? 'bg-sky-50 border-sky-200 text-sky-700'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
            title="Activa/desactiva la corrección espectral adaptativa (deltaGain) sobre el preset"
          >
            Delta EQ: {autoAdaptEnabled ? 'ON' : 'OFF'}
          </motion.button>
        </div>

        {/* Right: Target LUFS Selector + Export 24-Bit WAV + Cloud Save */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1 gap-0.5">
            <Volume2 size={13} className="text-slate-500 ml-2 mr-1 shrink-0" />
            {TARGET_LUFS_OPTIONS.map((opt) => {
              const active = Math.abs(targetLufs - opt.lufs) < 0.3;
              return (
                <button
                  key={opt.lufs}
                  type="button"
                  onClick={() => onSelectTargetLufs(opt.lufs)}
                  className={`relative z-10 px-2.5 py-1 rounded-lg text-[10px] font-mono leading-tight transition-colors cursor-pointer ${
                    active
                      ? 'text-white font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title={`${opt.label} (${opt.sub})`}
                >
                  {active && (
                    <motion.span
                      layoutId="target-lufs-option-pill"
                      transition={SPRING_PILL}
                      className="absolute inset-0 rounded-lg bg-[#0284c7] shadow-xs -z-10"
                    />
                  )}
                  <div>{opt.label}</div>
                  <div className="text-[8.5px] opacity-85 font-sans">
                    {opt.sub}
                  </div>
                </button>
              );
            })}
          </div>

          <motion.button
            type="button"
            whileHover={hasAudio && !isExporting ? { y: -1 } : undefined}
            whileTap={hasAudio && !isExporting ? { scale: 0.97 } : undefined}
            onClick={onExportWav24}
            disabled={!hasAudio || isExporting}
            className="h-10 px-4 rounded-xl bg-gradient-to-b from-[#0ea5e9] to-[#0284c7] hover:from-[#38bdf8] hover:to-[#0ea5e9] text-white font-semibold text-xs flex items-center gap-1.5 shadow-[0_4px_16px_rgba(2,132,199,0.28)] disabled:opacity-40 transition-all cursor-pointer"
          >
            <Download size={14} />
            <span>
              {isExporting ? 'Renderizando 24-Bit...' : 'Exportar WAV 24-Bit'}
            </span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={hasAudio && !isSavingCloud ? { scale: 0.97 } : undefined}
            onClick={onSaveToCloud}
            disabled={!hasAudio || isSavingCloud}
            className="h-10 px-3.5 rounded-xl bg-white hover:bg-sky-50 border border-sky-300 text-sky-700 font-semibold text-xs flex items-center gap-1.5 shadow-2xs disabled:opacity-40 transition-colors cursor-pointer"
            title="Guardar Master WAV 24-Bit en Supabase Storage y registrar sesión"
          >
            <CloudUpload size={14} className="text-sky-600" />
            <span>{isSavingCloud ? 'Guardando...' : 'Guardar Cloud'}</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};
