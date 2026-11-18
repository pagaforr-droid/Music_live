import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Sliders,
  RotateCcw,
  Layers,
  Upload,
  Zap,
  Flame,
  Radio,
} from 'lucide-react';
import type {
  SaturationType,
  StemBusRole,
  StemTrackState,
  SurgicalOverrides,
} from '../types/mastering.types';

interface MidSideSurgicalControlsProps {
  overrides: SurgicalOverrides;
  stems: StemTrackState[];
  kickBassSidechain: boolean;
  isMixingStems: boolean;
  onChangeOverride: <K extends keyof SurgicalOverrides>(
    key: K,
    value: SurgicalOverrides[K]
  ) => void;
  onResetToPreset: () => void;
  onLoadStemFile: (role: StemBusRole, file: File) => void;
  onUpdateStemState: (
    role: StemBusRole,
    patch: Partial<StemTrackState>
  ) => void;
  onToggleKickBassSidechain: () => void;
  onMixStemsToMaster: () => void;
}

const SATURATION_MODES: Array<{
  id: SaturationType;
  label: string;
  desc: string;
}> = [
  { id: 'tape', label: 'Studer Tape', desc: 'Cinta cálida + armónicos pares' },
  { id: 'tube', label: 'Triode Tube', desc: 'Válvula asimétrica orgánica' },
  { id: 'transformer', label: 'Iron Transf.', desc: 'Peso denso en graves/medios' },
  { id: 'softclip', label: 'Sigmoid Clip', desc: 'Techo limpio de transientes' },
];

const SPRING_TAB = {
  type: 'spring' as const,
  stiffness: 450,
  damping: 34,
  mass: 0.78,
};

export const MidSideSurgicalControls: React.FC<
  MidSideSurgicalControlsProps
> = ({
  overrides,
  stems,
  kickBassSidechain,
  isMixingStems,
  onChangeOverride,
  onResetToPreset,
  onLoadStemFile,
  onUpdateStemState,
  onToggleKickBassSidechain,
  onMixStemsToMaster,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'surgical' | 'stems'>('surgical');

  const formatSignedDb = (val: number) =>
    `${val > 0 ? '+' : ''}${val.toFixed(1)} dB`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.15 }}
      className="rounded-2xl mastering-surface overflow-hidden"
    >
      {/* Header Bar */}
      <div className="px-5 py-3.5 bg-white/[0.02] border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            className="flex items-center gap-2.5 text-left cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-xl bg-[#00E5FF]/12 border border-[#00E5FF]/30 flex items-center justify-center text-[#00E5FF]">
              <Sliders size={15} />
            </div>
            <span className="text-[14px] font-semibold tracking-tight text-white group-hover:text-[#00E5FF] transition-colors">
              Consola Quirúrgica Mid/Side & Stem Bus
            </span>
            {isOpen ? (
              <ChevronUp size={16} className="text-zinc-400" />
            ) : (
              <ChevronDown size={16} className="text-zinc-400" />
            )}
          </button>

          {/* Mode Tabs with Spring Sliding Pill */}
          <div className="flex items-center bg-[#05070b] border border-white/[0.07] rounded-xl p-1 ml-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('surgical');
                setIsOpen(true);
              }}
              className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'surgical'
                  ? 'text-slate-950 font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {activeTab === 'surgical' && (
                <motion.span
                  layoutId="surgical-console-mode-pill"
                  transition={SPRING_TAB}
                  className="absolute inset-0 rounded-lg bg-[#FF6B00] shadow-[0_2px_10px_rgba(255,107,0,0.35)] -z-10"
                />
              )}
              Cirugía Mid/Side + Analog
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('stems');
                setIsOpen(true);
              }}
              className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'stems'
                  ? 'text-slate-950 font-semibold'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {activeTab === 'stems' && (
                <motion.span
                  layoutId="surgical-console-mode-pill"
                  transition={SPRING_TAB}
                  className="absolute inset-0 rounded-lg bg-[#00E5FF] shadow-[0_2px_10px_rgba(0,229,255,0.35)] -z-10"
                />
              )}
              <Layers size={12} />
              Stem Mastering (4 Buses)
            </button>
          </div>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={onResetToPreset}
          className="h-9 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Restaurar parámetros originales del preset activo"
        >
          <RotateCcw size={12} />
          <span>Resetear al Preset</span>
        </motion.button>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {isOpen && activeTab === 'surgical' && (
          <motion.div
            key="surgical-tab"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5"
          >
            {/* Column 1: Mid/Side Matrix & Mono Maker */}
            <div className="rounded-xl mastering-subpanel p-4 flex flex-col gap-3.5">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#FF6B00] flex items-center gap-1.5">
                  <Radio size={13} />
                  1. Matriz Mid/Side & Mono Maker
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  Butterworth Q=0.7071
                </span>
              </div>

              {/* Mono Maker Freq */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">Mono Maker (Corte Side)</span>
                  <span className="text-[#FF6B00] font-bold">
                    {overrides.monoMakerFreq} Hz
                  </span>
                </div>
                <input
                  type="range"
                  min={40}
                  max={200}
                  step={1}
                  value={overrides.monoMakerFreq}
                  onChange={(e) =>
                    onChangeOverride('monoMakerFreq', Number(e.target.value))
                  }
                  className="mastering-fader"
                />
                <div className="text-[10.5px] text-zinc-500 mt-1">
                  Centra el 100% del sub-bajo y bombo en Mono por debajo de{' '}
                  {overrides.monoMakerFreq}Hz.
                </div>
              </div>

              {/* Mid Sub Punch */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">Mid Sub-Bass Punch</span>
                  <span className="text-[#FF6B00] font-bold">
                    {formatSignedDb(overrides.midLowPunchDb)}
                  </span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={6}
                  step={0.1}
                  value={overrides.midLowPunchDb}
                  onChange={(e) =>
                    onChangeOverride('midLowPunchDb', Number(e.target.value))
                  }
                  className="mastering-fader"
                />
              </div>

              {/* Mid Vocal Presence */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">Mid Vocal Focus (Centro)</span>
                  <span className="text-[#FF6B00] font-bold">
                    {formatSignedDb(overrides.midPresenceDb)}
                  </span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={6}
                  step={0.1}
                  value={overrides.midPresenceDb}
                  onChange={(e) =>
                    onChangeOverride('midPresenceDb', Number(e.target.value))
                  }
                  className="mastering-fader"
                />
              </div>

              {/* Side Air Shelf Boost */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">Side Air Boost (12k–15kHz)</span>
                  <span className="text-[#00E5FF] font-bold">
                    {formatSignedDb(overrides.sideAirBoostDb)}
                  </span>
                </div>
                <input
                  type="range"
                  min={-4}
                  max={6}
                  step={0.1}
                  value={overrides.sideAirBoostDb}
                  onChange={(e) =>
                    onChangeOverride('sideAirBoostDb', Number(e.target.value))
                  }
                  className="mastering-fader fader-cyan"
                />
              </div>

              {/* Stereo Width % */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">Apertura Estéreo (Side Gain)</span>
                  <span className="text-[#00E5FF] font-bold">
                    {overrides.stereoWidthPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={160}
                  step={1}
                  value={overrides.stereoWidthPct}
                  onChange={(e) =>
                    onChangeOverride('stereoWidthPct', Number(e.target.value))
                  }
                  className="mastering-fader fader-cyan"
                />
              </div>
            </div>

            {/* Column 2: Surgical De-AI & Anti-Mud EQ */}
            <div className="rounded-xl mastering-subpanel p-4 flex flex-col gap-3.5">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Zap size={13} />
                  2. Cirugía Sustractiva ("De-AI" & Anti-Mud)
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  High-Q Notches
                </span>
              </div>

              {/* Anti-Mud 280-320Hz */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">Anti-Mud Cut (250–320Hz)</span>
                  <span className="text-emerald-400 font-bold">
                    {formatSignedDb(overrides.stereoMudCutDb)}
                  </span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={2}
                  step={0.1}
                  value={overrides.stereoMudCutDb}
                  onChange={(e) =>
                    onChangeOverride('stereoMudCutDb', Number(e.target.value))
                  }
                  className="mastering-fader fader-emerald"
                />
              </div>

              {/* De-Harshness 3.8kHz */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">
                    De-Harshness (3.8kHz Metálico IA)
                  </span>
                  <span className="text-emerald-400 font-bold">
                    {formatSignedDb(overrides.deHarshnessCutDb)}
                  </span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={2}
                  step={0.1}
                  value={overrides.deHarshnessCutDb}
                  onChange={(e) =>
                    onChangeOverride('deHarshnessCutDb', Number(e.target.value))
                  }
                  className="mastering-fader fader-emerald"
                />
                <div className="text-[10.5px] text-zinc-500 mt-1">
                  Limpia la aspereza sintética típica de pistas generadas con IA (Suno/Udio).
                </div>
              </div>

              {/* De-Sibilance dinámico */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">
                    De-Sibilance / Aliasing (
                    {((overrides.sibilanceFreqHz || 6200) / 1000).toFixed(1)}kHz)
                  </span>
                  <span className="text-emerald-400 font-bold">
                    {formatSignedDb(overrides.sibilanceCutDb)}
                  </span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={2}
                  step={0.1}
                  value={overrides.sibilanceCutDb}
                  onChange={(e) =>
                    onChangeOverride('sibilanceCutDb', Number(e.target.value))
                  }
                  className="mastering-fader fader-emerald"
                />
              </div>

              {/* Bus Glue Compressor Controls */}
              <div className="pt-3 border-t border-white/[0.06] grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] font-medium text-zinc-400">
                    Comp Thresh
                  </div>
                  <div className="text-xs font-mono font-bold text-white mb-1.5">
                    {overrides.compressorThresholdDb} dB
                  </div>
                  <input
                    type="range"
                    min={-30}
                    max={-6}
                    step={0.5}
                    value={overrides.compressorThresholdDb}
                    onChange={(e) =>
                      onChangeOverride(
                        'compressorThresholdDb',
                        Number(e.target.value)
                      )
                    }
                    className="mastering-fader fader-cyan"
                  />
                </div>

                <div>
                  <div className="text-[10px] font-medium text-zinc-400">
                    SSL Ratio
                  </div>
                  <div className="text-xs font-mono font-bold text-white mb-1.5">
                    {overrides.compressorRatio.toFixed(1)}:1
                  </div>
                  <input
                    type="range"
                    min={1.2}
                    max={6.0}
                    step={0.1}
                    value={overrides.compressorRatio}
                    onChange={(e) =>
                      onChangeOverride('compressorRatio', Number(e.target.value))
                    }
                    className="mastering-fader fader-cyan"
                  />
                </div>

                <div>
                  <div className="text-[10px] font-medium text-zinc-400">
                    Parallel Glue
                  </div>
                  <div className="text-xs font-mono font-bold text-[#00E5FF] mb-1.5">
                    {overrides.compressorGlueMixPct}%
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={overrides.compressorGlueMixPct}
                    onChange={(e) =>
                      onChangeOverride(
                        'compressorGlueMixPct',
                        Number(e.target.value)
                      )
                    }
                    className="mastering-fader fader-cyan"
                  />
                </div>
              </div>
            </div>

            {/* Column 3: Analog Saturation 4x & True Peak Brickwall Ceiling */}
            <div className="rounded-xl mastering-subpanel p-4 flex flex-col gap-3.5">
              <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#00E5FF] flex items-center gap-1.5">
                  <Flame size={13} className="text-[#FF6B00]" />
                  3. Saturación Analógica 4x & Limiter
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  DC Blocker 18Hz
                </span>
              </div>

              {/* Saturation Curve Type Selector */}
              <div className="grid grid-cols-2 gap-2">
                {SATURATION_MODES.map((mode) => {
                  const active = overrides.saturationType === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onChangeOverride('saturationType', mode.id)}
                      className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#FF6B00]/15 border-[#FF6B00]/80 text-white shadow-[0_0_16px_rgba(255,107,0,0.18)]'
                          : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.07] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">
                        {mode.label}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                        {mode.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Tape / Harmonic Drive (%) */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">
                    Analog Drive (Oversampling 4x)
                  </span>
                  <span className="text-[#FF6B00] font-bold">
                    {overrides.tapeDrivePct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={1}
                  value={overrides.tapeDrivePct}
                  onChange={(e) =>
                    onChangeOverride('tapeDrivePct', Number(e.target.value))
                  }
                  className="mastering-fader"
                />
              </div>

              {/* Target Loudness LUFS */}
              <div className="pt-2.5 border-t border-white/[0.06]">
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">
                    Target Loudness (Maximizer Push)
                  </span>
                  <span className="text-[#FF6B00] font-bold">
                    {overrides.targetLufs.toFixed(1)} LUFS
                  </span>
                </div>
                <input
                  type="range"
                  min={-15.0}
                  max={-7.5}
                  step={0.5}
                  value={overrides.targetLufs}
                  onChange={(e) =>
                    onChangeOverride('targetLufs', Number(e.target.value))
                  }
                  className="mastering-fader"
                />
              </div>

              {/* True Peak Ceiling dBTP */}
              <div className="pt-2.5 border-t border-white/[0.06]">
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-zinc-300 font-sans">
                    Brickwall Ceiling (True Peak)
                  </span>
                  <span className="text-[#00E5FF] font-bold">
                    {overrides.ceilingDbTp.toFixed(1)} dBTP
                  </span>
                </div>
                <input
                  type="range"
                  min={-2.0}
                  max={-0.1}
                  step={0.1}
                  value={overrides.ceilingDbTp}
                  onChange={(e) =>
                    onChangeOverride('ceilingDbTp', Number(e.target.value))
                  }
                  className="mastering-fader fader-cyan"
                />
                <div className="flex justify-between text-[10px] font-mono text-zinc-500 mt-1.5">
                  <span>-1.0 dBTP (Estándar Spotify/Apple)</span>
                  <span>Lookahead 5.0ms 4x FIR</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {isOpen && activeTab === 'stems' && (
          <motion.div
            key="stems-tab"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="p-5 flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mastering-subpanel rounded-xl p-4">
              <div>
                <div className="text-xs font-semibold text-[#00E5FF] uppercase tracking-wider">
                  Masterización por Stems con Sidechain Dinámico Bombo → Bajo
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Carga tus buses por separado (Batería, Bajo, Voces y Guitarras/Otros). El motor aplicará ducking inteligente en 40–120Hz y enviará la suma al procesador Mid/Side.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onToggleKickBassSidechain}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-mono font-semibold transition-colors cursor-pointer ${
                    kickBassSidechain
                      ? 'bg-[#FF6B00]/15 border-[#FF6B00]/60 text-[#FF6B00]'
                      : 'bg-white/[0.03] border-white/[0.07] text-zinc-400'
                  }`}
                >
                  Sidechain Bombo/Bajo: {kickBassSidechain ? 'ACTIVO' : 'OFF'}
                </button>

                <button
                  type="button"
                  onClick={onMixStemsToMaster}
                  disabled={isMixingStems}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] text-slate-950 font-bold text-xs shadow-lg disabled:opacity-40 cursor-pointer"
                >
                  {isMixingStems
                    ? 'Mezclando Stems...'
                    : 'Inyectar Stems al Bus Master'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {stems.map((stem) => (
                <div
                  key={stem.role}
                  className="rounded-xl mastering-subpanel p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-white">
                      {stem.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateStemState(stem.role, { muted: !stem.muted })
                        }
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border cursor-pointer ${
                          stem.muted
                            ? 'bg-rose-500/20 border-rose-500 text-rose-400'
                            : 'bg-white/[0.04] border-white/[0.08] text-zinc-400'
                        }`}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateStemState(stem.role, { solo: !stem.solo })
                        }
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border cursor-pointer ${
                          stem.solo
                            ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                            : 'bg-white/[0.04] border-white/[0.08] text-zinc-400'
                        }`}
                      >
                        S
                      </button>
                    </div>
                  </div>

                  <label className="cursor-pointer rounded-xl border border-dashed border-white/[0.14] hover:border-[#00E5FF]/60 bg-white/[0.03] px-3 py-2 flex items-center justify-between text-xs text-zinc-300 transition-colors">
                    <span className="truncate max-w-[160px] font-mono text-[11px]">
                      {stem.fileName || `Subir ${stem.label}...`}
                    </span>
                    <Upload size={13} className="text-[#00E5FF] shrink-0" />
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onLoadStemFile(stem.role, f);
                      }}
                    />
                  </label>

                  <div>
                    <div className="flex justify-between text-[10.5px] font-mono text-zinc-400 mb-1">
                      <span>Nivel Bus</span>
                      <span className="text-white font-semibold">
                        {formatSignedDb(stem.gainDb)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-12}
                      max={6}
                      step={0.2}
                      value={stem.gainDb}
                      onChange={(e) =>
                        onUpdateStemState(stem.role, {
                          gainDb: Number(e.target.value),
                        })
                      }
                      className="mastering-fader"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10.5px] font-mono text-zinc-400 mb-1">
                      <span>Paneo (L / R)</span>
                      <span className="text-[#00E5FF] font-semibold">
                        {Math.abs(stem.pan) < 0.03
                          ? 'C'
                          : stem.pan < 0
                          ? `L ${Math.round(Math.abs(stem.pan) * 100)}%`
                          : `R ${Math.round(stem.pan * 100)}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={stem.pan}
                      onChange={(e) =>
                        onUpdateStemState(stem.role, {
                          pan: Number(e.target.value),
                        })
                      }
                      className="mastering-fader fader-cyan"
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
