import React, { useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Drum,
  ShieldCheck,
  Upload,
  Sparkles,
  Activity,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  Waves,
} from 'lucide-react';
import type {
  AntiSunoCqtMode,
  DrumHitEvent,
  DrumKitStyle,
  DrumLayeringConfig,
  ForensicHumanizerConfig,
  ForensicSignatureReport,
  SpectralProfile,
} from '../types/mastering.types';
import { calculateForensicSignature } from '../engine/ForensicHumanizerDSP';

interface DrumLayeringRackPanelProps {
  drumConfig: DrumLayeringConfig;
  forensicConfig: ForensicHumanizerConfig;
  detectedHits: DrumHitEvent[];
  currentTimeSec: number;
  durationSec: number;
  isPlaying: boolean;
  inputSpectralProfile: SpectralProfile;
  detectedPhaseCorrelation: number;
  baselineForensicReport?: ForensicSignatureReport | null;
  customSampleNames: {
    kickName: string | null;
    snareName: string | null;
  };
  onChangeDrumConfig: (next: DrumLayeringConfig) => void;
  onChangeForensicConfig: (next: ForensicHumanizerConfig) => void;
  onLoadCustomSample: (type: 'kick' | 'snare', file: File) => void;
  onClearCustomSample: (type: 'kick' | 'snare') => void;
}

const DRUM_KIT_STYLES: Array<{
  id: DrumKitStyle;
  name: string;
  subtitle: string;
}> = [
  {
    id: 'stadium-rock',
    name: 'Stadium Pop-Rock',
    subtitle: 'Imagine Dragons Style · Punch 52Hz + Crack 3.1kHz',
  },
  {
    id: 'tight-pop-funk',
    name: 'Tight Funk / Disco',
    subtitle: 'Seco, rápido y articulado · Cero cola sub-grave',
  },
  {
    id: 'warm-acoustic',
    name: '90s Dry Acoustic',
    subtitle: 'Maderas orgánicas y bordona natural cálida',
  },
  {
    id: 'arena-worship',
    name: 'Arena Worship',
    subtitle: 'Bombo profundo y caja amplia con sala de estudio',
  },
];

export const DrumLayeringRackPanel: React.FC<DrumLayeringRackPanelProps> = ({
  drumConfig,
  forensicConfig,
  detectedHits,
  currentTimeSec,
  durationSec,
  isPlaying,
  inputSpectralProfile,
  detectedPhaseCorrelation,
  baselineForensicReport,
  customSampleNames,
  onChangeDrumConfig,
  onChangeForensicConfig,
  onLoadCustomSample,
  onClearCustomSample,
}) => {
  const kickInputRef = useRef<HTMLInputElement | null>(null);
  const snareInputRef = useRef<HTMLInputElement | null>(null);

  const kickHits = useMemo(
    () => detectedHits.filter((h) => h.type === 'kick'),
    [detectedHits]
  );
  const snareHits = useMemo(
    () => detectedHits.filter((h) => h.type === 'snare'),
    [detectedHits]
  );

  // Detectar si el playhead acaba de pasar por un golpe (<85ms) para iluminar el indicador en tiempo real
  const isKickFiringNow = useMemo(() => {
    if (!isPlaying || !drumConfig.enabled) return false;
    return kickHits.some((h) => Math.abs(h.timeSec - currentTimeSec) < 0.065);
  }, [isPlaying, drumConfig.enabled, kickHits, currentTimeSec]);

  const isSnareFiringNow = useMemo(() => {
    if (!isPlaying || !drumConfig.enabled) return false;
    return snareHits.some((h) => Math.abs(h.timeSec - currentTimeSec) < 0.065);
  }, [isPlaying, drumConfig.enabled, snareHits, currentTimeSec]);

  // Medición de calidad espectral FFT (Pre vs Post calculado sobre transferencia real)
  const forensicAudit = useMemo(
    () =>
      calculateForensicSignature(
        inputSpectralProfile,
        detectedPhaseCorrelation,
        forensicConfig,
        drumConfig,
        baselineForensicReport
          ? {
              bassConcentrationPct:
                baselineForensicReport.bassEnergyConcentrationPct,
              highFreqCutoffHz:
                baselineForensicReport.measuredBandwidthHz ??
                baselineForensicReport.highFreqCutoffDetectedHz,
              harshnessScore: baselineForensicReport.harshnessIndex,
            }
          : undefined
      ),
    [
      inputSpectralProfile,
      detectedPhaseCorrelation,
      forensicConfig,
      drumConfig,
      baselineForensicReport,
    ]
  );

  const updateDrum = <K extends keyof DrumLayeringConfig>(
    key: K,
    val: DrumLayeringConfig[K]
  ) => {
    onChangeDrumConfig({
      ...drumConfig,
      [key]: val,
    });
  };

  const updateForensic = <K extends keyof ForensicHumanizerConfig>(
    key: K,
    val: ForensicHumanizerConfig[K]
  ) => {
    onChangeForensicConfig({
      ...forensicConfig,
      [key]: val,
    });
  };

  const handleApplyMaxForensicNeutralization = () => {
    onChangeForensicConfig({
      enabled: true,
      bassConcentrationCap: 0.8,
      highFreqExciterAmount: 0.52,
      analogPhaseAndDrift: 0.58,
      analogConsoleNoiseDb: -71,
      studioRoomCoherence: 0.04,
      transientMicroExpand: 0.5,
      sunoUltrasonicPurge: true,
      cqtDeQuantizeMode: forensicConfig.cqtDeQuantizeMode ?? 'macro_rubato_440',
      rvqFormantDeQuantizer: true,
      monoDownmixCanceller: true,
    });
    onChangeDrumConfig({
      ...drumConfig,
      enabled: true,
      suppressOriginalMud: true,
      humanizeRoundRobin: true,
      duckOriginalTransients: true,
      kickMix: Math.max(0.45, drumConfig.kickMix),
      snareMix: Math.max(0.4, drumConfig.snareMix),
    });
  };

  const timelineHitsSample = useMemo(() => {
    if (detectedHits.length <= 260) return detectedHits;
    const step = Math.ceil(detectedHits.length / 260);
    return detectedHits.filter((_, idx) => idx % step === 0);
  }, [detectedHits]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.09 }}
      className="grid grid-cols-1 xl:grid-cols-12 gap-5"
    >
      {/* ===================================================================== */}
      {/* COLUMNA IZQUIERDA (7 COLS): ACOUSTIC DRUM RE-SYNTHESIS & LAYERING     */}
      {/* ===================================================================== */}
      <div className="xl:col-span-7 rounded-2xl mastering-surface p-5 flex flex-col justify-between gap-4">
        {/* Cabecera con Switch Maestro y Conteo Real de Transientes */}
        <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-white/[0.07]">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 transition-colors ${
                drumConfig.enabled
                  ? 'bg-[#FF6B00]/15 border-[#FF6B00]/60 text-[#FF6B00] shadow-[0_0_16px_rgba(255,107,0,0.28)]'
                  : 'bg-white/[0.03] border-white/[0.07] text-zinc-500'
              }`}
            >
              <Drum size={18} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-semibold tracking-tight text-white">
                  Acoustic Drum Re-Synthesis & Sample-Accurate Layering
                </h3>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#FF6B00]/12 border border-[#FF6B00]/30 text-[#FF6B00]">
                  {kickHits.length} Kick Hits Detectados
                </span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#00E5FF]/12 border border-[#00E5FF]/30 text-[#00E5FF]">
                  {snareHits.length} Snare Hits Detectados
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Reemplazo y refuerzo de transientes a 24-bits con variación orgánica Round-Robin y supresión de sub-barro IA
              </p>
            </div>
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => updateDrum('enabled', !drumConfig.enabled)}
            className={`h-9 px-3.5 rounded-xl text-xs font-mono font-bold uppercase tracking-wider border shrink-0 transition-colors cursor-pointer ${
              drumConfig.enabled
                ? 'bg-[#FF6B00] text-slate-950 border-[#FF6B00] shadow-[0_2px_16px_rgba(255,107,0,0.35)]'
                : 'bg-white/[0.04] text-zinc-300 border-white/[0.08] hover:text-white'
            }`}
          >
            {drumConfig.enabled ? 'DRUM LAYERING: ON' : 'ACTIVAR DRUM LAYERING'}
          </motion.button>
        </div>

        {/* Mini-Timeline de Transientes de Batería con Sincronía en Vivo */}
        <div className="rounded-xl mastering-subpanel p-3.5 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
            <div className="flex items-center gap-2 text-zinc-300 font-sans font-medium">
              <Activity size={13} className="text-[#00E5FF]" />
              <span>Mapa Sample-Accurate de Impacto Percusivo</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${
                  isKickFiringNow
                    ? 'bg-[#FF6B00] text-slate-950 shadow-[0_0_12px_#FF6B00]'
                    : 'bg-white/[0.03] text-[#FF6B00] border border-[#FF6B00]/30'
                }`}
              >
                ● KICK (45–110Hz)
              </span>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${
                  isSnareFiringNow
                    ? 'bg-[#00E5FF] text-slate-950 shadow-[0_0_12px_#00E5FF]'
                    : 'bg-white/[0.03] text-[#00E5FF] border border-[#00E5FF]/30'
                }`}
              >
                ● SNARE (200Hz + 3kHz)
              </span>
            </div>
          </div>

          <div className="relative w-full h-14 rounded-lg bg-[#04060b] border border-white/[0.06] overflow-hidden">
            {/* Línea central divisoria: Arriba Snare (#00E5FF), Abajo Kick (#FF6B00) */}
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.07]" />

            {durationSec > 0 &&
              timelineHitsSample.map((hit, idx) => {
                const leftPct = Math.max(
                  0,
                  Math.min(99.5, (hit.timeSec / durationSec) * 100)
                );
                const heightPct = Math.round(25 + hit.velocity * 23);
                const isKick = hit.type === 'kick';
                return (
                  <div
                    key={`${hit.type}-${hit.timeSec}-${idx}`}
                    style={{
                      left: `${leftPct}%`,
                      height: `${heightPct}%`,
                      bottom: isKick ? '2px' : undefined,
                      top: isKick ? undefined : '2px',
                    }}
                    className={`absolute w-[2px] rounded-full ${
                      isKick ? 'bg-[#FF6B00]/85' : 'bg-[#00E5FF]/85'
                    }`}
                  />
                );
              })}

            {/* Playhead actual */}
            {durationSec > 0 && (
              <div
                className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_#ffffff] pointer-events-none"
                style={{
                  left: `${Math.min(100, (currentTimeSec / durationSec) * 100)}%`,
                }}
              />
            )}
          </div>
        </div>

        {/* Selector de Kit Acústico de Estudio (4 Estilos) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {DRUM_KIT_STYLES.map((kit) => {
            const active = drumConfig.drumStyle === kit.id;
            return (
              <motion.button
                key={kit.id}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => updateDrum('drumStyle', kit.id)}
                className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#FF6B00]/12 border-[#FF6B00]/80 text-white shadow-[0_6px_20px_-6px_rgba(255,107,0,0.28)]'
                    : 'bg-white/[0.025] hover:bg-white/[0.05] border-white/[0.07] text-zinc-300'
                }`}
              >
                <div className="text-xs font-semibold flex items-center justify-between">
                  <span>{kit.name}</span>
                  {active && (
                    <span className="w-2 h-2 rounded-full bg-[#FF6B00]" />
                  )}
                </div>
                <p className="text-[10.5px] text-zinc-400 mt-1 line-clamp-2 leading-snug">
                  {kit.subtitle}
                </p>
              </motion.button>
            );
          })}
        </div>

        {/* Sliders de Mezcla y Sensibilidad + Carga de Samples Personalizados */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Columna Controles Kick */}
          <div className="rounded-xl mastering-subpanel p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-[#FF6B00] block">
                  1. Canal Bombo (Kick Layer)
                </span>
                <span className="text-[10px] font-mono text-emerald-400">
                  {customSampleNames.kickName
                    ? '● Sample Custom .WAV Activo'
                    : '● Motor Acústico Interno 24-Bit Activo'}
                </span>
              </div>
              <input
                ref={kickInputRef}
                type="file"
                accept="audio/wav,audio/x-wav,audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onLoadCustomSample('kick', file);
                  e.target.value = '';
                }}
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => kickInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[10px] font-mono text-zinc-200 flex items-center gap-1 cursor-pointer"
                  title="Opcional: El motor ya incluye Bombos de estudio de 24-bits. Sube un .WAV solo si deseas usar tu propio sample."
                >
                  <Upload size={11} className="text-[#FF6B00]" />
                  <span>
                    {customSampleNames.kickName
                      ? customSampleNames.kickName.slice(0, 14)
                      : 'Opcional: Kick .WAV'}
                  </span>
                </button>
                {customSampleNames.kickName && (
                  <button
                    type="button"
                    onClick={() => onClearCustomSample('kick')}
                    className="p-1 rounded-lg bg-white/[0.05] text-zinc-400 hover:text-rose-400 cursor-pointer"
                    title="Restaurar Kick Acústico Sintetizado"
                  >
                    <RotateCcw size={11} />
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-mono text-zinc-400 mb-1">
                <span className="font-sans">Kick Layer Mix (Refuerzo Acústico)</span>
                <span className="text-[#FF6B00] font-bold">
                  {Math.round(drumConfig.kickMix * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={drumConfig.kickMix}
                onChange={(e) => updateDrum('kickMix', Number(e.target.value))}
                className="mastering-fader"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-mono text-zinc-400 mb-1">
                <span className="font-sans">Sensibilidad Detector Kick</span>
                <span className="text-white font-bold">
                  {Math.round(drumConfig.kickSensitivity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.15}
                max={0.95}
                step={0.02}
                value={drumConfig.kickSensitivity}
                onChange={(e) =>
                  updateDrum('kickSensitivity', Number(e.target.value))
                }
                className="mastering-fader"
              />
            </div>
          </div>

          {/* Columna Controles Snare */}
          <div className="rounded-xl mastering-subpanel p-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-[#00E5FF] block">
                  2. Canal Caja (Snare Layer)
                </span>
                <span className="text-[10px] font-mono text-emerald-400">
                  {customSampleNames.snareName
                    ? '● Sample Custom .WAV Activo'
                    : '● Motor Acústico Interno 24-Bit Activo'}
                </span>
              </div>
              <input
                ref={snareInputRef}
                type="file"
                accept="audio/wav,audio/x-wav,audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onLoadCustomSample('snare', file);
                  e.target.value = '';
                }}
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => snareInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[10px] font-mono text-zinc-200 flex items-center gap-1 cursor-pointer"
                  title="Opcional: El motor ya incluye Cajas acústicas de 24-bits. Sube un .WAV solo si deseas usar tu propio sample."
                >
                  <Upload size={11} className="text-[#00E5FF]" />
                  <span>
                    {customSampleNames.snareName
                      ? customSampleNames.snareName.slice(0, 14)
                      : 'Opcional: Snare .WAV'}
                  </span>
                </button>
                {customSampleNames.snareName && (
                  <button
                    type="button"
                    onClick={() => onClearCustomSample('snare')}
                    className="p-1 rounded-lg bg-white/[0.05] text-zinc-400 hover:text-rose-400 cursor-pointer"
                    title="Restaurar Snare Acústica Sintetizada"
                  >
                    <RotateCcw size={11} />
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-mono text-zinc-400 mb-1">
                <span className="font-sans">Snare Layer Mix (Impacto & Bordona)</span>
                <span className="text-[#00E5FF] font-bold">
                  {Math.round(drumConfig.snareMix * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={drumConfig.snareMix}
                onChange={(e) => updateDrum('snareMix', Number(e.target.value))}
                className="mastering-fader fader-cyan"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-mono text-zinc-400 mb-1">
                <span className="font-sans">Sensibilidad Detector Snare</span>
                <span className="text-white font-bold">
                  {Math.round(drumConfig.snareSensitivity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.15}
                max={0.95}
                step={0.02}
                value={drumConfig.snareSensitivity}
                onChange={(e) =>
                  updateDrum('snareSensitivity', Number(e.target.value))
                }
                className="mastering-fader fader-cyan"
              />
            </div>
          </div>
        </div>

        {/* Toggles Quirúrgicos Anti-Huella en Batería */}
        <div className="flex flex-col gap-2 pt-3 border-t border-white/[0.07]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={drumConfig.duckOriginalTransients !== false}
                onChange={(e) =>
                  updateDrum('duckOriginalTransients', e.target.checked)
                }
                className="accent-emerald-400 cursor-pointer"
              />
              <span>
                <strong className="text-emerald-300">
                  Surgical Transient Ducking (-8.8dB / 20ms):
                </strong>{' '}
                Atenúa el golpe sintético de Suno en el instante exacto del impacto acústico
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={drumConfig.suppressOriginalMud}
                onChange={(e) =>
                  updateDrum('suppressOriginalMud', e.target.checked)
                }
                className="accent-[#FF6B00] cursor-pointer"
              />
              <span>
                <strong>Suppress AI Sub-Mud (50–105Hz):</strong> Atenúa el grave difuso original
              </span>
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={drumConfig.humanizeRoundRobin}
                onChange={(e) =>
                  updateDrum('humanizeRoundRobin', e.target.checked)
                }
                className="accent-[#00E5FF] cursor-pointer"
              />
              <span>
                <strong>Forensic Round-Robin Humanizer:</strong> Micro-variación (±0.8% Pitch/Fase) por golpe
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* COLUMNA DERECHA (5 COLS): FORENSIC ANTI-AI HUMANIZER & SIGNATURE AUDIT */}
      {/* ===================================================================== */}
      <div className="xl:col-span-5 rounded-2xl mastering-surface p-5 flex flex-col justify-between gap-4">
        {/* Cabecera del Motor Anti-Huella Forense */}
        <div className="flex items-start justify-between gap-2.5 pb-3.5 border-b border-white/[0.07]">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${
                forensicConfig.enabled
                  ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.22)]'
                  : 'bg-white/[0.03] border-white/[0.07] text-zinc-500'
              }`}
            >
              <ShieldCheck size={18} />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold tracking-tight text-white">
                Restaurador Analógico & Coherencia Espectral (Stage 4C)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Corrección física de sub-graves, excitador 12–20kHz y cohesión estéreo 1:1
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={handleApplyMaxForensicNeutralization}
              className="h-8 px-3 rounded-xl bg-gradient-to-r from-emerald-400 to-[#00E5FF] text-slate-950 font-mono font-bold text-[11px] flex items-center gap-1 shadow cursor-pointer"
              title="Calibra los 5 módulos de restauración espectral y humanización de batería"
            >
              <Sparkles size={12} />
              <span>Restauración Pro</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => updateForensic('enabled', !forensicConfig.enabled)}
              className={`h-8 px-2.5 rounded-xl text-[11px] font-mono font-bold border cursor-pointer ${
                forensicConfig.enabled
                  ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
                  : 'bg-white/[0.03] border-white/[0.07] text-zinc-400'
              }`}
            >
              {forensicConfig.enabled ? 'ACTIVO' : 'BYPASS'}
            </motion.button>
          </div>
        </div>

        {/* Métricas Reales de Calidad Espectral FFT (Pre vs Post) */}
        <div className="rounded-xl mastering-subpanel p-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
          <div className="p-2 rounded-lg bg-white/[0.025] border border-white/[0.05]">
            <span className="text-[9.5px] font-mono text-zinc-400 block">
              ÍNDICE DUREZA (IN)
            </span>
            <span
              className={`text-base font-mono font-extrabold ${
                forensicAudit.estimatedAiSignatureScore >= 55
                  ? 'text-rose-400'
                  : 'text-amber-300'
              }`}
            >
              {forensicAudit.estimatedAiSignatureScore}%
            </span>
          </div>

          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <span className="text-[9.5px] font-mono text-emerald-300 block">
              BALANCE POST-DSP
            </span>
            <span className="text-base font-mono font-extrabold text-emerald-400 flex items-center justify-center gap-1">
              <CheckCircle2 size={13} />
              {forensicAudit.projectedPostAiSignatureScore}%
            </span>
          </div>

          <div className="p-2 rounded-lg bg-white/[0.025] border border-white/[0.05]">
            <span className="text-[9.5px] font-mono text-zinc-400 block">
              BASS RATIO (&lt;140Hz)
            </span>
            <span className="text-xs font-mono font-bold text-[#00E5FF] block mt-0.5">
              {forensicAudit.bassEnergyConcentrationPct}% →{' '}
              <strong className="text-emerald-400">
                {forensicAudit.projectedPostBassConcentrationPct}%
              </strong>
            </span>
          </div>

          <div className="p-2 rounded-lg bg-white/[0.025] border border-white/[0.05]">
            <span className="text-[9.5px] font-mono text-zinc-400 block">
              ANCHO BANDA (BW)
            </span>
            <span className="text-xs font-mono font-bold text-[#FF6B00] block mt-0.5">
              {(forensicAudit.highFreqCutoffDetectedHz / 1000).toFixed(1)} kHz
            </span>
          </div>
        </div>

        {/* Los 5 Sliders de Neutralización Forense */}
        <div className="space-y-3">
          {/* Vector 1: Re-Balanceador de Concentración Sub-Grave */}
          <div>
            <div className="flex justify-between text-[11px] font-mono mb-1">
              <span className="text-zinc-300 font-sans flex items-center gap-1.5">
                <Sliders size={11} className="text-emerald-400" />
                1. Sub-Energy Rebalancer (31Hz HPF + 115Hz Tamer)
              </span>
              <span className="text-emerald-400 font-bold">
                {Math.round(forensicConfig.bassConcentrationCap * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={forensicConfig.bassConcentrationCap}
              onChange={(e) =>
                updateForensic('bassConcentrationCap', Number(e.target.value))
              }
              className="mastering-fader fader-emerald"
            />
          </div>

          {/* Vector 2: Reconstructor Armónico 14kHz - 22kHz */}
          <div>
            <div className="flex justify-between text-[11px] font-mono mb-1">
              <span className="text-zinc-300 font-sans flex items-center gap-1.5">
                <Waves size={11} className="text-[#00E5FF]" />
                2. Excitador Armónico 14–22kHz (Anti-Brickwall)
              </span>
              <span className="text-[#00E5FF] font-bold">
                {Math.round(forensicConfig.highFreqExciterAmount * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={forensicConfig.highFreqExciterAmount}
              onChange={(e) =>
                updateForensic('highFreqExciterAmount', Number(e.target.value))
              }
              className="mastering-fader fader-cyan"
            />
          </div>

          {/* Vector 3: Dispersor de Fase Asimétrico All-Pass + Micro-Drift Studer */}
          <div>
            <div className="flex justify-between text-[11px] font-mono mb-1">
              <span className="text-zinc-300 font-sans">
                3. Dispersor Fase All-Pass L/R + Micro-Drift Cinta
              </span>
              <span className="text-[#FF6B00] font-bold">
                {Math.round(forensicConfig.analogPhaseAndDrift * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={forensicConfig.analogPhaseAndDrift}
              onChange={(e) =>
                updateForensic('analogPhaseAndDrift', Number(e.target.value))
              }
              className="mastering-fader"
            />
          </div>

          {/* Vector 4 & 5 en fila doble: Piso Térmico Consola + Sala de Control */}
          <div className="grid grid-cols-2 gap-3.5 pt-1">
            <div>
              <div className="flex justify-between text-[10.5px] font-mono text-zinc-400 mb-1">
                <span className="font-sans">4. Piso Térmico + TPDF</span>
                <span className="text-emerald-400 font-bold">
                  {forensicConfig.analogConsoleNoiseDb} dBFS
                </span>
              </div>
              <input
                type="range"
                min={-85}
                max={-62}
                step={1}
                value={forensicConfig.analogConsoleNoiseDb}
                onChange={(e) =>
                  updateForensic('analogConsoleNoiseDb', Number(e.target.value))
                }
                className="mastering-fader fader-emerald"
              />
            </div>

            <div>
              <div className="flex justify-between text-[10.5px] font-mono text-zinc-400 mb-1">
                <span className="font-sans">5. Acústica Sala Estudio</span>
                <span className="text-[#00E5FF] font-bold">
                  {(forensicConfig.studioRoomCoherence * 100).toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.12}
                step={0.005}
                value={forensicConfig.studioRoomCoherence}
                onChange={(e) =>
                  updateForensic('studioRoomCoherence', Number(e.target.value))
                }
                className="mastering-fader fader-cyan"
              />
            </div>
          </div>
        </div>

        {/* Módulos de Afinación & Purga Unificados (Vivo + Export) */}
        <div className="rounded-xl mastering-subpanel border-emerald-500/25 p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wider">
              Afinación Tape + Limpieza Ultrasónica & Formantes
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-300 border border-emerald-500/30">
              Vivo = Export 1:1
            </span>
          </div>

          {/* Selector de Modo CQT / Time-Warp (Sincronizado en Vivo y Exportación) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {(
              [
                {
                  id: 'macro_rubato_440',
                  label: '440Hz Original',
                  desc: 'Tono 1:1 Exacto',
                },
                {
                  id: 'a432_detune',
                  label: 'A=432Hz (-31.8c)',
                  desc: 'Master Tape Shift',
                },
                {
                  id: 'detune_down',
                  label: 'Quarter (-50c)',
                  desc: 'Mitad Celda CQT',
                },
                {
                  id: 'drop_semitone',
                  label: 'Drop Eb (-100c)',
                  desc: 'Afinación Estudio',
                },
              ] as Array<{ id: AntiSunoCqtMode; label: string; desc: string }>
            ).map((mode) => {
              const active =
                (forensicConfig.cqtDeQuantizeMode ?? 'macro_rubato_440') ===
                mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => updateForensic('cqtDeQuantizeMode', mode.id)}
                  className={`px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-emerald-500/15 border-emerald-400/70 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                      : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.07] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="text-[10px] font-mono font-bold leading-tight">
                    {mode.label}
                  </div>
                  <div className="text-[9px] text-zinc-400 leading-tight mt-0.5">
                    {mode.desc}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono">
            <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={forensicConfig.sunoUltrasonicPurge !== false}
                onChange={(e) =>
                  updateForensic('sunoUltrasonicPurge', e.target.checked)
                }
                className="accent-emerald-400 cursor-pointer"
              />
              <span>Purga &gt;19.4kHz + Notches</span>
            </label>

            <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(forensicConfig.rvqFormantDeQuantizer)}
                onChange={(e) =>
                  updateForensic('rvqFormantDeQuantizer', e.target.checked)
                }
                className="accent-emerald-400 cursor-pointer"
              />
              <span>Suavizado Formantes Medios</span>
            </label>

            <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={forensicConfig.monoDownmixCanceller !== false}
                onChange={(e) =>
                  updateForensic('monoDownmixCanceller', e.target.checked)
                }
                className="accent-emerald-400 cursor-pointer"
              />
              <span>Coherencia Tape Stereo-Link</span>
            </label>
          </div>
        </div>

        <div className="px-3.5 py-2 rounded-xl bg-[#05070b] border border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-zinc-400">
          <span className="flex items-center gap-1.5">
            {forensicAudit.projectedPostBassConcentrationPct <= 42 ? (
              <CheckCircle2 size={12} className="text-emerald-400" />
            ) : (
              <AlertTriangle size={12} className="text-amber-400" />
            )}
            Balance Espectral FFT Real:
          </span>
          <span className="text-emerald-400 font-bold">
            Paridad Vivo ↔ WAV 24-Bit Verificada
          </span>
        </div>
      </div>
    </motion.div>
  );
};

export default DrumLayeringRackPanel;
