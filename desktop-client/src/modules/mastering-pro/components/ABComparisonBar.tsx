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
        {/* Left: Transport + Apple Logic LCD Readout + Drag & Drop Load */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-[280px]">
          <motion.button
            type="button"
            whileTap={hasAudio ? { scale: 0.94 } : undefined}
            onClick={onTogglePlay}
            disabled={!hasAudio}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors border ${
              !hasAudio
                ? 'bg-white/[0.03] border-white/[0.06] text-zinc-600 cursor-not-allowed'
                : isPlaying
                ? 'bg-gradient-to-b from-[#ff7a1a] to-[#FF6B00] border-[#ff8c3a] text-slate-950 shadow-[0_0_24px_rgba(255,107,0,0.4)] cursor-pointer'
                : 'bg-white/[0.06] hover:bg-white/[0.11] border-white/[0.12] text-white cursor-pointer'
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
            className="w-10 h-11 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-35 transition-colors cursor-pointer"
            title="Volver al inicio"
          >
            <RotateCcw size={15} />
          </motion.button>

          {/* Timecode + Track Info Apple LCD Display */}
          <div className="px-3.5 py-1.5 rounded-xl bg-[#07090e]/95 border border-white/[0.07] shadow-[inset_0_1px_3px_rgba(0,0,0,0.75)] flex items-center gap-3 min-w-[210px] sm:min-w-[245px]">
            <div className="w-full">
              <div className="text-[11px] font-medium tracking-tight text-zinc-400 flex items-center gap-1.5">
                <Radio
                  size={11}
                  className={
                    isPlaying
                      ? 'text-[#00E5FF] animate-pulse shrink-0'
                      : 'text-zinc-600 shrink-0'
                  }
                />
                <span className="truncate max-w-[185px] sm:max-w-[230px] text-zinc-100 font-semibold">
                  {trackTitle || 'Sin pista cargada'}
                </span>
              </div>
              <div className="text-xs font-mono text-[#00E5FF] tracking-wider mt-0.5">
                {formatTimeMmSs(currentTimeSec)}{' '}
                <span className="text-zinc-600">/</span>{' '}
                <span className="text-zinc-400">
                  {formatTimeMmSs(durationSec)}
                </span>
              </div>
            </div>
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => fileInputRef.current?.click()}
            className="h-10 px-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] hover:border-[#00E5FF]/40 text-xs font-medium text-zinc-100 flex items-center gap-2 transition-colors cursor-pointer"
            title="Subir archivo WAV, FLAC o MP3 (o arrastra aquí)"
          >
            <Upload size={13.5} className="text-[#00E5FF]" />
            <span>Cargar Audio</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onLoadDemoTrack}
            className="h-10 px-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.07] text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Generar pista de referencia de estudio en 32-bit para probar el rack"
          >
            <Disc3 size={13.5} className="text-[#FF6B00]" />
            <span>Demo Track</span>
          </motion.button>
        </div>

        {/* Center: A/B Hardware Switch + Gain-Match + AI Auto-Analyze */}
        <div className="flex flex-wrap items-center gap-2">
          {/* A / B Segmented Switch with Spring Layout Pill */}
          <div className="relative flex items-center p-1 rounded-xl bg-[#07090e] border border-white/[0.07]">
            <button
              type="button"
              onClick={() => onToggleBypass(true)}
              className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                isBypassed
                  ? 'text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {isBypassed && (
                <motion.span
                  layoutId="ab-master-switch-pill"
                  transition={SPRING_PILL}
                  className="absolute inset-0 rounded-lg bg-zinc-700/90 border border-white/15 shadow-sm -z-10"
                />
              )}
              A · ORIGINAL
            </button>
            <button
              type="button"
              onClick={() => onToggleBypass(false)}
              className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                !isBypassed
                  ? 'text-slate-950'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {!isBypassed && (
                <motion.span
                  layoutId="ab-master-switch-pill"
                  transition={SPRING_PILL}
                  className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] shadow-[0_0_16px_rgba(0,229,255,0.28)] -z-10"
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
                ? 'bg-[#00E5FF]/12 border-[#00E5FF]/45 text-[#00E5FF]'
                : 'bg-white/[0.03] border-white/[0.07] text-zinc-400 hover:text-zinc-200'
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
            className="h-9 px-3.5 rounded-xl bg-[#FF6B00]/12 hover:bg-[#FF6B00]/22 border border-[#FF6B00]/45 text-xs font-semibold text-[#FF6B00] flex items-center gap-1.5 disabled:opacity-40 transition-colors cursor-pointer"
            title="Escanea el espectro ITU-R BS.1770-4 y recomienda el preset + curva adaptativa ideal"
          >
            <Sparkles
              size={13.5}
              className={isAnalyzing ? 'animate-spin' : ''}
            />
            <span>{isAnalyzing ? 'Escaneando...' : 'Auto-Analyze AI'}</span>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onToggleAutoAdapt}
            className={`h-9 px-3 rounded-xl border text-[11px] font-mono font-medium transition-colors cursor-pointer ${
              autoAdaptEnabled
                ? 'bg-emerald-500/12 border-emerald-500/40 text-emerald-300'
                : 'bg-white/[0.03] border-white/[0.07] text-zinc-500'
            }`}
            title="Activa/desactiva la corrección espectral adaptativa (deltaGain) sobre el preset"
          >
            Delta EQ: {autoAdaptEnabled ? 'ON' : 'OFF'}
          </motion.button>
        </div>

        {/* Right: Target LUFS Selector + Export 24-Bit WAV + Cloud Save */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[#07090e] border border-white/[0.07] rounded-xl p-1 gap-0.5">
            <Volume2 size={13} className="text-zinc-500 ml-2 mr-1 shrink-0" />
            {TARGET_LUFS_OPTIONS.map((opt) => {
              const active = Math.abs(targetLufs - opt.lufs) < 0.3;
              return (
                <button
                  key={opt.lufs}
                  type="button"
                  onClick={() => onSelectTargetLufs(opt.lufs)}
                  className={`relative z-10 px-2.5 py-1 rounded-lg text-[10px] font-mono leading-tight transition-colors cursor-pointer ${
                    active
                      ? 'text-slate-950 font-bold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  title={`${opt.label} (${opt.sub})`}
                >
                  {active && (
                    <motion.span
                      layoutId="target-lufs-option-pill"
                      transition={SPRING_PILL}
                      className="absolute inset-0 rounded-lg bg-[#FF6B00] shadow-[0_2px_10px_rgba(255,107,0,0.35)] -z-10"
                    />
                  )}
                  <div>{opt.label}</div>
                  <div className="text-[8.5px] opacity-80 font-sans">
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
            className="h-10 px-4 rounded-xl bg-gradient-to-b from-[#ff7b1a] to-[#FF6B00] hover:from-[#ff872e] hover:to-[#ff6b00] text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-[0_4px_20px_rgba(255,107,0,0.32)] disabled:opacity-40 transition-all cursor-pointer"
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
            className="h-10 px-3.5 rounded-xl bg-[#00E5FF]/12 hover:bg-[#00E5FF]/20 border border-[#00E5FF]/40 text-[#00E5FF] font-semibold text-xs flex items-center gap-1.5 disabled:opacity-40 transition-colors cursor-pointer"
            title="Guardar Master WAV 24-Bit en Supabase Storage y registrar sesión"
          >
            <CloudUpload size={14} />
            <span>{isSavingCloud ? 'Guardando...' : 'Guardar Cloud'}</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};
