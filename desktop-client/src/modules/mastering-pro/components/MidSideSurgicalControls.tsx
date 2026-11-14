import React, { useState } from 'react';
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
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 shadow-[0_14px_40px_rgba(0,0,0,0.65)] overflow-hidden">
      {/* Header Bar */}
      <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            className="flex items-center gap-2 text-left"
          >
            <Sliders size={16} className="text-[#00E5FF]" />
            <span className="text-sm font-bold uppercase tracking-wide text-white">
              Consola Quirúrgica Mid/Side & Stem Bus
            </span>
            {isOpen ? (
              <ChevronUp size={16} className="text-slate-400" />
            ) : (
              <ChevronDown size={16} className="text-slate-400" />
            )}
          </button>

          {/* Mode Tabs */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 ml-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('surgical');
                setIsOpen(true);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
                activeTab === 'surgical'
                  ? 'bg-[#FF6B00] text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Cirugía Mid/Side + Analog
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('stems');
                setIsOpen(true);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'stems'
                  ? 'bg-[#00E5FF] text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers size={12} />
              Stem Mastering (4 Buses)
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onResetToPreset}
          className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-mono text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors"
          title="Restaurar parámetros originales del preset activo"
        >
          <RotateCcw size={12} />
          <span>Resetear al Preset</span>
        </button>
      </div>

      {isOpen && activeTab === 'surgical' && (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Column 1: Mid/Side Matrix & Mono Maker */}
          <div className="rounded-xl bg-slate-950/90 border border-slate-800/90 p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-mono font-bold uppercase text-[#FF6B00] flex items-center gap-1.5">
                <Radio size={13} />
                1. Matriz Mid/Side & Mono Maker
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                Butterworth Q=0.7071
              </span>
            </div>

            {/* Mono Maker Freq */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">Mono Maker (Corte Side)</span>
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
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="text-[10px] text-slate-500 mt-0.5">
                Centra el 100% del sub-bajo y bombo en Mono por debajo de{' '}
                {overrides.monoMakerFreq}Hz.
              </div>
            </div>

            {/* Mid Sub Punch */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">Mid Sub-Bass Punch</span>
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
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Mid Vocal Presence */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">Mid Vocal Focus (Centro)</span>
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
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Side Air Shelf Boost */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">Side Air Boost (12k–15kHz)</span>
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
                className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Stereo Width % */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">Apertura Estéreo (Side Gain)</span>
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
                className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Column 2: Surgical De-AI & Anti-Mud EQ */}
          <div className="rounded-xl bg-slate-950/90 border border-slate-800/90 p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-mono font-bold uppercase text-emerald-400 flex items-center gap-1.5">
                <Zap size={13} />
                2. Cirugía Sustractiva ("De-AI" & Anti-Mud)
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                High-Q Notches
              </span>
            </div>

            {/* Anti-Mud 280-320Hz */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">Anti-Mud Cut (250–320Hz)</span>
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
                className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* De-Harshness 3.8kHz */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">
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
                className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="text-[10px] text-slate-500 mt-0.5">
                Limpia la aspereza sintética típica de pistas generadas con IA (Suno/Udio).
              </div>
            </div>

            {/* De-Sibilance 6.2kHz */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">
                  De-Sibilance / Aliasing (6.2kHz)
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
                className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Bus Glue Compressor Controls */}
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] font-mono text-slate-400">
                  Comp Thresh
                </div>
                <div className="text-xs font-mono font-bold text-white mb-1">
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
                  className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="text-[10px] font-mono text-slate-400">
                  SSL Ratio
                </div>
                <div className="text-xs font-mono font-bold text-white mb-1">
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
                  className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="text-[10px] font-mono text-slate-400">
                  Parallel Glue
                </div>
                <div className="text-xs font-mono font-bold text-[#00E5FF] mb-1">
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
                  className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Column 3: Analog Saturation 4x & True Peak Brickwall Ceiling */}
          <div className="rounded-xl bg-slate-950/90 border border-slate-800/90 p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-mono font-bold uppercase text-[#00E5FF] flex items-center gap-1.5">
                <Flame size={13} className="text-[#FF6B00]" />
                3. Saturación Analógica 4x & Limiter
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                DC Blocker 18Hz
              </span>
            </div>

            {/* Saturation Curve Type Selector */}
            <div className="grid grid-cols-2 gap-1.5">
              {SATURATION_MODES.map((mode) => {
                const active = overrides.saturationType === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onChangeOverride('saturationType', mode.id)}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      active
                        ? 'bg-[#FF6B00]/15 border-[#FF6B00] text-white'
                        : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-mono font-bold">
                      {mode.label}
                    </div>
                    <div className="text-[9.5px] text-slate-400 truncate">
                      {mode.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Tape / Harmonic Drive (%) */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">
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
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* True Peak Ceiling dBTP */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-300">
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
                className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                <span>-1.0 dBTP (Estándar Spotify/Apple)</span>
                <span>Lookahead 2.0ms</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {isOpen && activeTab === 'stems' && (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/90 border border-slate-800 rounded-xl p-3">
            <div>
              <div className="text-xs font-mono font-bold text-[#00E5FF] uppercase">
                Masterización por Stems con Sidechain Dinámico Bombo → Bajo
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Carga tus buses por separado (Batería, Bajo, Voces y Guitarras/Otros). El motor aplicará ducking inteligente en 40–120Hz y enviará la suma al procesador Mid/Side.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleKickBassSidechain}
                className={`px-3 py-2 rounded-xl border text-xs font-mono font-semibold transition-all ${
                  kickBassSidechain
                    ? 'bg-[#FF6B00]/20 border-[#FF6B00] text-[#FF6B00]'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                Sidechain Bombo/Bajo: {kickBassSidechain ? 'ACTIVO' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={onMixStemsToMaster}
                disabled={isMixingStems}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] text-slate-950 font-bold text-xs shadow-lg disabled:opacity-40"
              >
                {isMixingStems
                  ? 'Mezclando Stems...'
                  : 'Inyectar Stems al Bus Master'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {stems.map((stem) => (
              <div
                key={stem.role}
                className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex flex-col gap-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold uppercase text-white">
                    {stem.label}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateStemState(stem.role, { muted: !stem.muted })
                      }
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        stem.muted
                          ? 'bg-rose-500/20 border-rose-500 text-rose-400'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateStemState(stem.role, { solo: !stem.solo })
                      }
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        stem.solo
                          ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      S
                    </button>
                  </div>
                </div>

                <label className="cursor-pointer rounded-lg border border-dashed border-slate-700 hover:border-[#00E5FF] bg-slate-900/60 px-2.5 py-2 flex items-center justify-between text-xs text-slate-300 transition-colors">
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
                  <div className="flex justify-between text-[10px] font-mono text-slate-400">
                    <span>Nivel Bus</span>
                    <span className="text-white">
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
                    className="w-full accent-[#FF6B00] h-1 bg-slate-800 rounded cursor-pointer"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
