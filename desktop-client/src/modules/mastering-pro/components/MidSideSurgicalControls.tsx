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
      <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            className="flex items-center gap-2.5 text-left cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
              <Sliders size={15} />
            </div>
            <span className="text-[14px] font-semibold tracking-tight text-slate-900 group-hover:text-sky-700 transition-colors">
              Consola Quirúrgica Mid/Side & Stem Bus
            </span>
            {isOpen ? (
              <ChevronUp size={16} className="text-slate-500" />
            ) : (
              <ChevronDown size={16} className="text-slate-500" />
            )}
          </button>

          {/* Mode Tabs with Spring Sliding Pill */}
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1 ml-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('surgical');
                setIsOpen(true);
              }}
              className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'surgical'
                  ? 'text-white font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {activeTab === 'surgical' && (
                <motion.span
                  layoutId="surgical-console-mode-pill"
                  transition={SPRING_TAB}
                  className="absolute inset-0 rounded-lg bg-[#0284c7] shadow-xs -z-10"
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
                  ? 'text-white font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {activeTab === 'stems' && (
                <motion.span
                  layoutId="surgical-console-mode-pill"
                  transition={SPRING_TAB}
                  className="absolute inset-0 rounded-lg bg-[#0ea5e9] shadow-xs -z-10"
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
          className="h-9 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
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
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                  <Radio size={13} />
                  1. Matriz Mid/Side & Mono Maker
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  Butterworth Q=0.7071
                </span>
              </div>

              {/* Mono Maker Freq */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-700 font-sans font-medium">Mono Maker (Corte Side)</span>
                  <span className="text-blue-700 font-bold">
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
                <div className="text-[10.5px] text-slate-500 mt-1">
                  Centra el 100% del sub-bajo y bombo en Mono por debajo de{' '}
                  {overrides.monoMakerFreq}Hz.
                </div>
              </div>

              {/* Mid Sub Punch */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-700 font-sans font-medium">Mid Sub-Bass Punch</span>
                  <span className="text-blue-700 font-bold">
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
                  <span className="text-slate-700 font-sans font-medium">Mid Vocal Focus (Centro)</span>
                  <span className="text-blue-700 font-bold">
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
                  <span className="text-slate-700 font-sans font-medium">Side Air Boost (12k–15kHz)</span>
                  <span className="text-sky-700 font-bold">
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
                  <span className="text-slate-700 font-sans font-medium">Apertura Estéreo (Side Gain)</span>
                  <span className="text-sky-700 font-bold">
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
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Zap size={13} className="text-sky-600" />
                  2. Cirugía Sustractiva ("De-AI" & Anti-Mud)
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  High-Q Notches
                </span>
              </div>

              {/* Anti-Mud 280-320Hz */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-700 font-sans font-medium">Anti-Mud Cut (250–320Hz)</span>
                  <span className="text-sky-700 font-bold">
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
                  <span className="text-slate-700 font-sans font-medium">
                    De-Harshness (3.8kHz Metálico IA)
                  </span>
                  <span className="text-sky-700 font-bold">
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
                <div className="text-[10.5px] text-slate-500 mt-1">
                  Limpia la aspereza sintética típica de pistas generadas con IA (Suno/Udio).
                </div>
              </div>

              {/* De-Sibilance dinámico */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-700 font-sans font-medium">
                    De-Sibilance / Aliasing (
                    {((overrides.sibilanceFreqHz || 6200) / 1000).toFixed(1)}kHz)
                  </span>
                  <span className="text-sky-700 font-bold">
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
              <div className="pt-3 border-t border-slate-200 grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] font-medium text-slate-500">
                    Comp Thresh
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-900 mb-1.5">
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
                  <div className="text-[10px] font-medium text-slate-500">
                    SSL Ratio
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-900 mb-1.5">
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
                  <div className="text-[10px] font-medium text-slate-500">
                    Parallel Glue
                  </div>
                  <div className="text-xs font-mono font-bold text-sky-700 mb-1.5">
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
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-sky-700 flex items-center gap-1.5">
                  <Flame size={13} className="text-sky-600" />
                  3. Saturación Analógica 4x & Limiter
                </span>
                <span className="text-[10px] font-mono text-slate-500">
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
                          ? 'bg-sky-50 border-sky-400 text-slate-900 shadow-xs'
                          : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <div className={`text-xs font-semibold ${active ? 'text-sky-800' : ''}`}>
                        {mode.label}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">
                        {mode.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Tape / Harmonic Drive (%) */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-700 font-sans font-medium">
                    Analog Drive (Oversampling 4x)
                  </span>
                  <span className="text-sky-700 font-bold">
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
              <div className="pt-2.5 border-t border-slate-200">
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-700 font-sans font-medium">
                    Target Loudness (Maximizer Push)
                  </span>
                  <span className="text-blue-700 font-bold">
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
              <div className="pt-2.5 border-t border-slate-200">
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-slate-700 font-sans font-medium">
                    Brickwall Ceiling (True Peak)
                  </span>
                  <span className="text-sky-700 font-bold">
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
                <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1.5">
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
                <div className="text-xs font-semibold text-sky-700 uppercase tracking-wider">
                  Masterización por Stems con Sidechain Dinámico Bombo → Bajo
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Carga tus buses por separado (Batería, Bajo, Voces y Guitarras/Otros). El motor aplicará ducking inteligente en 40–120Hz y enviará la suma al procesador Mid/Side.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onToggleKickBassSidechain}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-mono font-semibold transition-colors cursor-pointer ${
                    kickBassSidechain
                      ? 'bg-sky-50 border-sky-300 text-sky-700'
                      : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  Sidechain Bombo/Bajo: {kickBassSidechain ? 'ACTIVO' : 'OFF'}
                </button>

                <button
                  type="button"
                  onClick={onMixStemsToMaster}
                  disabled={isMixingStems}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#0284c7] to-[#38bdf8] text-white font-semibold text-xs shadow-sm disabled:opacity-40 cursor-pointer"
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
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-900">
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
                            ? 'bg-rose-50 border-rose-300 text-rose-700'
                            : 'bg-white border-slate-200 text-slate-500'
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
                            ? 'bg-sky-100 border-sky-400 text-sky-800'
                            : 'bg-white border-slate-200 text-slate-500'
                        }`}
                      >
                        S
                      </button>
                    </div>
                  </div>

                  <label className="cursor-pointer rounded-xl border border-dashed border-slate-300 hover:border-sky-400 bg-white px-3 py-2 flex items-center justify-between text-xs text-slate-700 transition-colors">
                    <span className="truncate max-w-[160px] font-mono text-[11px]">
                      {stem.fileName || `Subir ${stem.label}...`}
                    </span>
                    <Upload size={13} className="text-sky-600 shrink-0" />
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
                    <div className="flex justify-between text-[10.5px] font-mono text-slate-500 mb-1">
                      <span>Nivel Bus</span>
                      <span className="text-slate-900 font-semibold">
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
                    <div className="flex justify-between text-[10.5px] font-mono text-slate-500 mb-1">
                      <span>Paneo (L / R)</span>
                      <span className="text-sky-700 font-semibold">
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
