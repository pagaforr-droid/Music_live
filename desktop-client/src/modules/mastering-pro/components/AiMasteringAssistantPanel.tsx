import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Sparkles,
  TrendingUp,
  Scissors,
  ShieldAlert,
  Sliders,
  CheckCircle2,
  Zap,
  Radio,
  Gauge,
  Wand2,
} from 'lucide-react';
import type {
  AiCriticalEqPoint,
  AiFilterSuggestion,
  EQBandConfig,
  SpectralAdaptationReport,
  SurgicalOverrides,
} from '../types/mastering.types';

interface AiMasteringAssistantPanelProps {
  report: SpectralAdaptationReport | null;
  overrides: SurgicalOverrides;
  isAnalyzing: boolean;
  resetToken?: number;
  onRunFullAiOptimization: () => void;
  onApplyCriticalPoint: (point: AiCriticalEqPoint) => void;
  onApplyFilterSuggestion: (suggestion: AiFilterSuggestion) => void;
  onApplyAiCompression: () => void;
  onApplyAiStereoWidth: () => void;
  onChangeOverride: <K extends keyof SurgicalOverrides>(
    key: K,
    value: SurgicalOverrides[K]
  ) => void;
  onUpdateCustomEqBand: (
    bandId: string,
    patch: Partial<EQBandConfig>
  ) => void;
}

const SPRING_TAB = {
  type: 'spring' as const,
  stiffness: 450,
  damping: 34,
  mass: 0.78,
};

export const AiMasteringAssistantPanel: React.FC<
  AiMasteringAssistantPanelProps
> = ({
  report,
  overrides,
  isAnalyzing,
  resetToken,
  onRunFullAiOptimization,
  onApplyCriticalPoint,
  onApplyFilterSuggestion,
  onApplyAiCompression,
  onApplyAiStereoWidth,
  onChangeOverride,
  onUpdateCustomEqBand,
}) => {
  const [activeTab, setActiveTab] = useState<
    'critical-points' | 'filters' | 'custom-eq' | 'comp-stereo'
  >('critical-points');
  const [appliedIds, setAppliedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setAppliedIds({});
  }, [report, resetToken]);

  if (!report) return null;

  const boostPoints = report.criticalEqPoints.filter(
    (p) => p.action === 'boost'
  );
  const cutPoints = report.criticalEqPoints.filter((p) => p.action === 'cut');

  const markApplied = (id: string) => {
    setAppliedIds((prev) => ({ ...prev, [id]: true }));
  };

  const formatSignedDb = (val: number) =>
    `${val > 0 ? '+' : ''}${val.toFixed(1)} dB`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.06 }}
      className="rounded-2xl mastering-surface overflow-hidden"
    >
      {/* Top Header: AI Master Assistant Overview + 1-Click Full Apply */}
      <div className="px-5 py-4 bg-slate-50/70 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shadow-2xs">
            <Sparkles size={18} className={isAnalyzing ? 'animate-spin' : ''} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-[14px] font-semibold tracking-tight text-slate-900">
                Asistente IA de Diagnóstico Quirúrgico & Personalización
              </h3>
              <span className="text-[10.5px] font-mono px-2.5 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 font-semibold">
                Sibilancia: {report.sibilanceScore}% · Aspereza 3.8k:{' '}
                {report.aiArtifactScore}%
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {report.recommendationReason}
            </p>
          </div>
        </div>

        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            onRunFullAiOptimization();
            markApplied('all-ai');
          }}
          className="h-10 px-4 rounded-xl bg-gradient-to-r from-[#0284c7] to-[#38bdf8] text-white font-semibold text-xs flex items-center gap-2 shadow-[0_4px_16px_rgba(14,165,233,0.28)] cursor-pointer"
        >
          <Wand2 size={14} />
          <span>Aplicar Optimización Completa IA (EQ + De-Esser + Comp + Width)</span>
        </motion.button>
      </div>

      {/* Navigation Sub-Tabs with Apple Segmented Spring Pill */}
      <div className="px-5 py-2.5 bg-slate-50/50 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200">
          {[
            {
              id: 'critical-points' as const,
              label: '1. Puntos Críticos (Dónde Subir / Cortar)',
              icon: TrendingUp,
            },
            {
              id: 'filters' as const,
              label: '2. Filtros Sugeridos (De-Esser / Notch / HPF)',
              icon: ShieldAlert,
            },
            {
              id: 'custom-eq' as const,
              label: '3. Personalizar Ecualización (Paramétrico M/S)',
              icon: Sliders,
            },
            {
              id: 'comp-stereo' as const,
              label: '4. Personalizar Compresión & Amplitud Estéreo',
              icon: Gauge,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  active
                    ? 'text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="ai-assistant-tab-pill"
                    transition={SPRING_TAB}
                    className="absolute inset-0 rounded-lg bg-[#0284c7] shadow-xs -z-10"
                  />
                )}
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5 text-[11px] font-mono text-slate-500">
          <span className="px-2.5 py-0.5 rounded-full bg-white border border-slate-200">
            Crest: <strong className="text-slate-800">{report.detectedCrestFactorDb} dB</strong>
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-white border border-slate-200">
            Stereo Side:{' '}
            <strong className="text-sky-700">
              {report.stereoWidthSuggestion.detectedStereoEnergyPct}%
            </strong>
          </span>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {/* TAB 1: PUNTOS CRÍTICOS (DÓNDE SUBIR vs DÓNDE CORTAR) */}
        {activeTab === 'critical-points' && (
          <motion.div
            key="tab-critical-points"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start"
          >
            {/* Left Column: Where to BOOST (Subir) */}
            <div className="rounded-xl mastering-subpanel p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold tracking-tight text-sky-700">
                  <TrendingUp size={15} />
                  <span>Puntos Donde Podemos SUBIR (Realce & Presencia)</span>
                </div>
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-sky-100 border border-sky-200 text-sky-700 font-semibold">
                  {boostPoints.length} zonas clave
                </span>
              </div>

              <div className="space-y-2.5">
                {boostPoints.map((pt) => {
                  const isDone = appliedIds[pt.id];
                  return (
                    <div
                      key={pt.id}
                      className="rounded-xl bg-white hover:bg-sky-50/40 border border-slate-200 hover:border-sky-300 p-3.5 flex flex-col gap-2 transition-colors shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900">
                              {pt.title}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-sky-700 font-semibold">
                              {pt.freqHz} Hz · Q:{pt.recommendedQ} ·{' '}
                              {pt.channel.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                            {pt.reason}
                          </p>
                        </div>

                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.96 }}
                          onClick={() => {
                            onApplyCriticalPoint(pt);
                            markApplied(pt.id);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold shrink-0 flex items-center gap-1 transition-colors cursor-pointer ${
                            isDone
                              ? 'bg-sky-100 border border-sky-300 text-sky-800'
                              : 'bg-sky-600 hover:bg-sky-700 text-white shadow-2xs'
                          }`}
                        >
                          {isDone && <CheckCircle2 size={12} />}
                          <span>
                            Subir +{pt.recommendedGainDb.toFixed(1)} dB
                          </span>
                        </motion.button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Where to CUT (Cortar / Limpiar) */}
            <div className="rounded-xl mastering-subpanel p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold tracking-tight text-blue-700">
                  <Scissors size={15} />
                  <span>Puntos Críticos Donde CORTAR (Barro, IA & Sibilancia)</span>
                </div>
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-semibold">
                  {cutPoints.length} resonancias
                </span>
              </div>

              <div className="space-y-2.5">
                {cutPoints.map((pt) => {
                  const isDone = appliedIds[pt.id];
                  return (
                    <div
                      key={pt.id}
                      className="rounded-xl bg-white hover:bg-blue-50/35 border border-slate-200 hover:border-blue-300 p-3.5 flex flex-col gap-2 transition-colors shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900">
                              {pt.title}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-blue-700 font-semibold">
                              {pt.freqHz} Hz · Q:{pt.recommendedQ}
                            </span>
                            {pt.priority === 'critical' && (
                              <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700">
                                CRÍTICO
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                            {pt.reason}
                          </p>
                        </div>

                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.96 }}
                          onClick={() => {
                            onApplyCriticalPoint(pt);
                            markApplied(pt.id);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold shrink-0 flex items-center gap-1 transition-colors cursor-pointer ${
                            isDone
                              ? 'bg-sky-100 border border-sky-300 text-sky-800'
                              : 'bg-slate-800 hover:bg-slate-900 text-white shadow-2xs'
                          }`}
                        >
                          {isDone && <CheckCircle2 size={12} />}
                          <span>
                            Cortar {pt.recommendedGainDb.toFixed(1)} dB
                          </span>
                        </motion.button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 2: SUGERENCIAS DE FILTROS INTELIGENTES (DE-ESSER, NOTCH IA, MONO MAKER, HPF, LINE KILLER Q=12) */}
        {activeTab === 'filters' && (
          <motion.div
            key="tab-filters"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="p-5 flex flex-col gap-4"
          >
            {/* Sub-panel: Spectral Line Killer Q=12 (Cazador de Líneas Horizontales RX) */}
            <div className="rounded-xl mastering-subpanel border-rose-200 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700">
                      SPECTRAL LINE KILLER · BANCO NOTCH Q=12
                    </span>
                    <span className="text-xs font-semibold text-slate-900">
                      Supresor Quirúrgico de Líneas Horizontales & Silbidos Estacionarios
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Elimina líneas horizontales continuas del espectrograma con hasta 6 filtros Notch ultra-estrechos (Q=12). También puedes hacer clic directo sobre cualquier línea en el espectrograma RX.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2.5 text-xs font-mono">
                    <span className="text-slate-600">Intensidad Line Killer:</span>
                    <input
                      type="range"
                      min={0}
                      max={150}
                      step={5}
                      value={overrides.resonanceKillerPct}
                      onChange={(e) =>
                        onChangeOverride(
                          'resonanceKillerPct',
                          Number(e.target.value)
                        )
                      }
                      className="w-28 mastering-fader fader-rose"
                    />
                    <span className="text-rose-700 font-bold w-10">
                      {overrides.resonanceKillerPct}%
                    </span>
                  </div>

                  {report.detectedResonanceLines.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onChangeOverride(
                          'resonanceNotches',
                          report.detectedResonanceLines
                        );
                        onChangeOverride('resonanceKillerPct', 100);
                        markApplied('spectral-line-killer');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 text-xs font-mono font-bold transition-colors cursor-pointer"
                    >
                      Cazar {report.detectedResonanceLines.length} Líneas IA
                    </button>
                  )}
                </div>
              </div>

              {overrides.resonanceNotches.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
                  {overrides.resonanceNotches.map((notch) => (
                    <div
                      key={notch.id}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-2 ${
                        notch.enabled
                          ? 'bg-white border-rose-200 text-rose-900 shadow-2xs'
                          : 'bg-slate-100 border-slate-200 text-slate-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={notch.enabled}
                        onChange={(e) =>
                          onChangeOverride(
                            'resonanceNotches',
                            overrides.resonanceNotches.map((n) =>
                              n.id === notch.id
                                ? { ...n, enabled: e.target.checked }
                                : n
                            )
                          )
                        }
                        className="accent-rose-600 cursor-pointer"
                      />
                      <span className="font-bold text-slate-900">
                        {notch.freqHz} Hz
                      </span>
                      <span className="text-rose-700">
                        {notch.gainCutDb.toFixed(1)} dB · Q:{notch.q}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onChangeOverride(
                            'resonanceNotches',
                            overrides.resonanceNotches.filter(
                              (n) => n.id !== notch.id
                            )
                          )
                        }
                        className="text-slate-400 hover:text-rose-600 ml-1 cursor-pointer"
                        title="Quitar este filtro Notch"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] font-mono text-slate-500">
                  No hay filtros Notch Q=12 activos. Pulsa "Cazar Líneas IA" o haz clic sobre una línea horizontal en el espectrograma RX.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {report.filterSuggestions.map((filter) => {
                const isDone = appliedIds[filter.id];
                return (
                  <div
                    key={filter.id}
                    className={`rounded-xl p-4 border flex flex-col justify-between gap-3 transition-colors bg-white shadow-2xs ${
                      filter.isRecommended
                        ? 'border-sky-300 bg-sky-50/30'
                        : 'border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700">
                          {filter.badge}
                        </span>
                        <span className="text-[10px] font-mono text-sky-700 font-semibold">
                          Confianza IA: {filter.confidencePct}%
                        </span>
                      </div>

                      <h4 className="text-xs font-semibold text-slate-900">
                        {filter.name}
                      </h4>
                      <p className="text-[11px] text-blue-700 font-mono mt-1">
                        Diagnóstico: {filter.detectedIssue}
                      </p>
                      <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                        {filter.suggestionDetail}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onApplyFilterSuggestion(filter);
                        markApplied(filter.id);
                      }}
                      className={`w-full py-2 rounded-lg text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        isDone
                          ? 'bg-sky-100 border border-sky-300 text-sky-800'
                          : 'bg-slate-100 hover:bg-sky-600 text-slate-800 hover:text-white border border-slate-200'
                      }`}
                    >
                      {isDone ? (
                        <>
                          <CheckCircle2 size={13} />
                          <span>Filtro Aplicado al Grafo DSP</span>
                        </>
                      ) : (
                        <>
                          <Zap size={13} />
                          <span>Activar / Ajustar Filtro Sugerido</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* TAB 3: PERSONALIZAR ECUALIZACIÓN PARAMÉTRICA (6 BANDAS MID/SIDE/STEREO + DE-ESSER) */}
        {activeTab === 'custom-eq' && (
          <motion.div
            key="tab-custom-eq"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="p-5 flex flex-col gap-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                  Ecualizador Paramétrico Personalizado Mid/Side & De-Esser
                </h4>
                <p className="text-[11px] text-slate-500">
                  Ajusta frecuencia exacta (Hz), ganancia (dB), ancho de banda (Q), tipo de filtro y canal (`MID`, `SIDE`, `STEREO`) en tiempo real.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-slate-600">
                  Filtro Subsonic HPF:{' '}
                  <strong className="text-sky-700">
                    {overrides.highPassFreq} Hz
                  </strong>
                </span>
                <input
                  type="range"
                  min={20}
                  max={50}
                  step={1}
                  value={overrides.highPassFreq}
                  onChange={(e) =>
                    onChangeOverride('highPassFreq', Number(e.target.value))
                  }
                  className="w-28 mastering-fader"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {overrides.customEqBands.map((band) => {
                const gainVal =
                  band.id === 'mid-sub-punch'
                    ? overrides.midLowPunchDb
                    : band.id === 'stereo-mud-cut'
                    ? overrides.stereoMudCutDb
                    : band.id === 'mid-vocal-bite'
                    ? overrides.midPresenceDb
                    : band.id === 'stereo-de-harsh'
                    ? overrides.deHarshnessCutDb
                    : band.id === 'stereo-sibilance'
                    ? overrides.sibilanceCutDb
                    : band.id === 'side-air-shelf'
                    ? overrides.sideAirBoostDb
                    : band.gainDb;

                const freqVal =
                  band.id === 'stereo-sibilance'
                    ? overrides.sibilanceFreqHz
                    : band.freq;

                return (
                  <div
                    key={band.id}
                    className={`rounded-xl p-3.5 flex flex-col gap-3 ${
                      band.enabled === false
                        ? 'mastering-subpanel opacity-55'
                        : 'mastering-subpanel'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={band.enabled !== false}
                          onChange={(e) =>
                            onUpdateCustomEqBand(band.id, {
                              enabled: e.target.checked,
                            })
                          }
                          className="accent-sky-600 cursor-pointer"
                        />
                        <span className="text-xs font-semibold text-slate-900">
                          {band.label}
                        </span>
                      </div>
                      <select
                        value={band.channel}
                        onChange={(e) =>
                          onUpdateCustomEqBand(band.id, {
                            channel: e.target.value as EQBandConfig['channel'],
                          })
                        }
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-md uppercase font-bold border cursor-pointer ${
                          band.channel === 'mid'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : band.channel === 'side'
                            ? 'bg-sky-50 text-sky-700 border-sky-200'
                            : 'bg-slate-200/70 text-slate-700 border-slate-300'
                        }`}
                      >
                        <option value="mid" className="bg-white text-slate-900">
                          MID
                        </option>
                        <option value="side" className="bg-white text-slate-900">
                          SIDE
                        </option>
                        <option
                          value="stereo"
                          className="bg-white text-slate-900"
                        >
                          STEREO
                        </option>
                      </select>
                    </div>

                    {/* Frequency Slider */}
                    <div>
                      <div className="flex justify-between text-[11px] font-mono text-slate-500 mb-1">
                        <span>Frecuencia</span>
                        <span className="text-sky-700 font-bold">
                          {freqVal} Hz
                        </span>
                      </div>
                      <input
                        type="range"
                        min={
                          band.id === 'mid-sub-punch'
                            ? 35
                            : band.id === 'stereo-mud-cut'
                            ? 160
                            : band.id === 'mid-vocal-bite'
                            ? 900
                            : band.id === 'stereo-de-harsh'
                            ? 2500
                            : band.id === 'stereo-sibilance'
                            ? 4800
                            : 8000
                        }
                        max={
                          band.id === 'mid-sub-punch'
                            ? 160
                            : band.id === 'stereo-mud-cut'
                            ? 550
                            : band.id === 'mid-vocal-bite'
                            ? 5000
                            : band.id === 'stereo-de-harsh'
                            ? 5500
                            : band.id === 'stereo-sibilance'
                            ? 9500
                            : 18000
                        }
                        step={5}
                        value={freqVal}
                        onChange={(e) => {
                          const nextF = Number(e.target.value);
                          if (band.id === 'stereo-sibilance') {
                            onChangeOverride('sibilanceFreqHz', nextF);
                          }
                          onUpdateCustomEqBand(band.id, { freq: nextF });
                        }}
                        className="mastering-fader fader-cyan"
                      />
                    </div>

                    {/* Gain Slider */}
                    <div>
                      <div className="flex justify-between text-[11px] font-mono text-slate-500 mb-1">
                        <span>Ganancia</span>
                        <span
                          className={`font-bold ${
                            gainVal >= 0 ? 'text-blue-700' : 'text-sky-700'
                          }`}
                        >
                          {formatSignedDb(gainVal)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-7}
                        max={7}
                        step={0.1}
                        value={gainVal}
                        onChange={(e) => {
                          const g = Number(e.target.value);
                          if (band.id === 'mid-sub-punch')
                            onChangeOverride('midLowPunchDb', g);
                          else if (band.id === 'stereo-mud-cut')
                            onChangeOverride('stereoMudCutDb', g);
                          else if (band.id === 'mid-vocal-bite')
                            onChangeOverride('midPresenceDb', g);
                          else if (band.id === 'stereo-de-harsh')
                            onChangeOverride('deHarshnessCutDb', g);
                          else if (band.id === 'stereo-sibilance')
                            onChangeOverride('sibilanceCutDb', g);
                          else if (band.id === 'side-air-shelf')
                            onChangeOverride('sideAirBoostDb', g);
                          onUpdateCustomEqBand(band.id, { gainDb: g });
                        }}
                        className="mastering-fader"
                      />
                    </div>

                    {/* Q Factor + Filter Shape */}
                    <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-slate-200">
                      <div className="flex-1">
                        <div className="flex justify-between text-[10px] font-mono text-slate-500 mb-1">
                          <span>Factor Q</span>
                          <span className="text-slate-900 font-semibold">{band.q.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0.4}
                          max={6.0}
                          step={0.1}
                          value={band.q}
                          onChange={(e) =>
                            onUpdateCustomEqBand(band.id, {
                              q: Number(e.target.value),
                            })
                          }
                          className="mastering-fader fader-emerald"
                        />
                      </div>

                      <select
                        value={band.type}
                        onChange={(e) =>
                          onUpdateCustomEqBand(band.id, {
                            type: e.target.value as BiquadFilterType,
                          })
                        }
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-700"
                      >
                        <option value="peaking">Peaking (Bell)</option>
                        <option value="highshelf">High-Shelf</option>
                        <option value="lowshelf">Low-Shelf</option>
                        <option value="notch">Notch Quirúrgico</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* TAB 4: PERSONALIZAR COMPRESIÓN & AMPLITUD ESTÉREO */}
        {activeTab === 'comp-stereo' && (
          <motion.div
            key="tab-comp-stereo"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5"
          >
            {/* Custom Compression Console */}
            <div className="rounded-xl mastering-subpanel p-4 flex flex-col justify-between gap-3.5">
              <div>
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Gauge size={15} className="text-sky-600" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
                      Personalizar Compresión Bus Glue
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onApplyAiCompression();
                      markApplied('ai-comp');
                    }}
                    className="px-3 py-1 rounded-lg bg-sky-50 hover:bg-sky-600 text-sky-700 hover:text-white border border-sky-200 text-[11px] font-mono font-bold transition-colors cursor-pointer"
                  >
                    Aplicar Sugerencia IA ({report.compressionSuggestion.ratio}:1)
                  </button>
                </div>

                <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                  <strong className="text-sky-700 font-mono">
                    IA ({report.compressionSuggestion.profileName}):
                  </strong>{' '}
                  {report.compressionSuggestion.diagnosis}
                </p>

                {/* Quick Compression Character Styles */}
                <div className="grid grid-cols-4 gap-1.5 mt-3">
                  {[
                    {
                      label: 'Punchy Fast',
                      t: -17,
                      r: 3.5,
                      a: 12,
                      rel: 55,
                      mix: 88,
                    },
                    {
                      label: 'SSL Bus Glue',
                      t: -18,
                      r: 4.0,
                      a: 30,
                      rel: 100,
                      mix: 85,
                    },
                    {
                      label: 'Vocal Smooth',
                      t: -19,
                      r: 2.0,
                      a: 25,
                      rel: 160,
                      mix: 78,
                    },
                    {
                      label: 'Transparent',
                      t: -20,
                      r: 1.6,
                      a: 38,
                      rel: 220,
                      mix: 68,
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        onChangeOverride('compressorThresholdDb', preset.t);
                        onChangeOverride('compressorRatio', preset.r);
                        onChangeOverride('compressorAttackMs', preset.a);
                        onChangeOverride('compressorReleaseMs', preset.rel);
                        onChangeOverride('compressorGlueMixPct', preset.mix);
                      }}
                      className="px-2 py-1.5 rounded-lg bg-white hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-[10px] font-mono text-slate-700 hover:text-sky-700 transition-colors cursor-pointer shadow-2xs"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 pt-2.5 border-t border-slate-200">
                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Threshold</span>
                    <span className="text-slate-900 font-bold">
                      {overrides.compressorThresholdDb} dB
                    </span>
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
                    className="mastering-fader"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Ratio</span>
                    <span className="text-slate-900 font-bold">
                      {overrides.compressorRatio.toFixed(1)}:1
                    </span>
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
                    className="mastering-fader"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Attack</span>
                    <span className="text-sky-700 font-bold">
                      {overrides.compressorAttackMs} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={80}
                    step={1}
                    value={overrides.compressorAttackMs}
                    onChange={(e) =>
                      onChangeOverride(
                        'compressorAttackMs',
                        Number(e.target.value)
                      )
                    }
                    className="mastering-fader fader-cyan"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Release</span>
                    <span className="text-sky-700 font-bold">
                      {overrides.compressorReleaseMs} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={25}
                    max={400}
                    step={5}
                    value={overrides.compressorReleaseMs}
                    onChange={(e) =>
                      onChangeOverride(
                        'compressorReleaseMs',
                        Number(e.target.value)
                      )
                    }
                    className="mastering-fader fader-cyan"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Soft Knee</span>
                    <span className="text-slate-900 font-bold">
                      {overrides.compressorKneeDb} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={18}
                    step={1}
                    value={overrides.compressorKneeDb}
                    onChange={(e) =>
                      onChangeOverride('compressorKneeDb', Number(e.target.value))
                    }
                    className="mastering-fader fader-emerald"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Parallel Mix</span>
                    <span className="text-blue-700 font-bold">
                      {overrides.compressorGlueMixPct}%
                    </span>
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
                    className="mastering-fader"
                  />
                </div>
              </div>
            </div>

            {/* Custom Stereo Width & Mid/Side Field Console */}
            <div className="rounded-xl mastering-subpanel p-4 flex flex-col justify-between gap-3.5">
              <div>
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Radio size={15} className="text-sky-600" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
                      Personalizar Amplitud Estéreo 3D & Fase M/S
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onApplyAiStereoWidth();
                      markApplied('ai-stereo');
                    }}
                    className="px-3 py-1 rounded-lg bg-sky-50 hover:bg-sky-600 text-sky-700 hover:text-white border border-sky-200 text-[11px] font-mono font-bold transition-colors cursor-pointer"
                  >
                    Aplicar Imagen IA (
                    {report.stereoWidthSuggestion.recommendedWidthPct}%)
                  </button>
                </div>

                <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                  <strong className="text-sky-700 font-mono">
                    Diagnóstico Espacial IA:
                  </strong>{' '}
                  {report.stereoWidthSuggestion.diagnosis}
                </p>

                {/* Quick Width Modes */}
                <div className="grid grid-cols-4 gap-1.5 mt-3">
                  {[
                    { label: 'Mono Check (0%)', w: 0, m: 150 },
                    { label: 'Natural (100%)', w: 100, m: 95 },
                    { label: 'Studio Wide (124%)', w: 124, m: 115 },
                    { label: 'Arena 3D (142%)', w: 142, m: 130 },
                  ].map((mode) => (
                    <button
                      key={mode.label}
                      type="button"
                      onClick={() => {
                        onChangeOverride('stereoWidthPct', mode.w);
                        onChangeOverride('monoMakerFreq', mode.m);
                      }}
                      className="px-2 py-1.5 rounded-lg bg-white hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-[10px] font-mono text-slate-700 hover:text-sky-700 transition-colors cursor-pointer shadow-2xs"
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2.5 border-t border-slate-200">
                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Amplitud Estéreo</span>
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

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Mono Maker (Graves)</span>
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
                </div>

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                    <span>Expansión Aire Side</span>
                    <span className="text-sky-700 font-bold">
                      {formatSignedDb(overrides.sideAirBoostDb)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-3}
                    max={6}
                    step={0.1}
                    value={overrides.sideAirBoostDb}
                    onChange={(e) =>
                      onChangeOverride('sideAirBoostDb', Number(e.target.value))
                    }
                    className="mastering-fader fader-cyan"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
