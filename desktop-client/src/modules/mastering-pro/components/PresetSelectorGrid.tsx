import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Sliders, CheckCircle2, Flame } from 'lucide-react';
import type {
  MasteringPreset,
  SpectralAdaptationReport,
} from '../types/mastering.types';

interface PresetSelectorGridProps {
  presets: MasteringPreset[];
  selectedPresetId: string;
  recommendedPresetId?: string | null;
  intensityPct: number;
  adaptationReport: SpectralAdaptationReport | null;
  onSelectPreset: (presetId: string) => void;
  onChangeIntensity: (pct: number) => void;
}

const SPRING_CARD = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 32,
  mass: 0.8,
};

export const PresetSelectorGrid: React.FC<PresetSelectorGridProps> = ({
  presets,
  selectedPresetId,
  recommendedPresetId,
  intensityPct,
  adaptationReport,
  onSelectPreset,
  onChangeIntensity,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.12 }}
      className="rounded-2xl mastering-surface p-5 flex flex-col gap-4"
    >
      {/* Top Row: Section Title + Macro Intensity Slider (0% - 150%) */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3.5 border-b border-white/[0.07]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#FF6B00]/15 border border-[#FF6B00]/35 flex items-center justify-center text-[#FF6B00]">
            <Flame size={17} />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight text-white">
              Estilos de Ingeniería & Macro Intensidad
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Perfiles matemáticos clonados de cadenas de masterización de estudio con matriz Mid/Side y saturación 4x.
            </p>
          </div>
        </div>

        {/* Macro Intensity Slider Card */}
        <div className="flex-1 min-w-[300px] max-w-md mastering-subpanel rounded-xl px-4 py-3">
          <div className="flex items-center justify-between text-xs font-mono mb-2">
            <span className="text-zinc-200 font-sans font-medium flex items-center gap-1.5">
              <Sliders size={13} className="text-[#00E5FF]" />
              Mastering Intensity
            </span>
            <span className="px-2 py-0.5 rounded-md bg-[#FF6B00]/15 border border-[#FF6B00]/40 text-[#FF6B00] font-bold">
              {intensityPct}%
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={150}
            step={1}
            value={intensityPct}
            onChange={(e) => onChangeIntensity(Number(e.target.value))}
            className="mastering-fader"
          />

          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mt-2">
            {[
              { label: '0% Dry', val: 0 },
              { label: '75% Soft', val: 75 },
              { label: '100% Studio', val: 100 },
              { label: '125% Hot', val: 125 },
              { label: '150% Max', val: 150 },
            ].map((mark) => (
              <button
                key={mark.val}
                type="button"
                onClick={() => onChangeIntensity(mark.val)}
                className={`hover:text-[#00E5FF] transition-colors cursor-pointer ${
                  intensityPct === mark.val ? 'text-[#00E5FF] font-bold' : ''
                }`}
              >
                {mark.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Adaptation Banner when available */}
      {adaptationReport && (
        <div className="rounded-xl mastering-subpanel px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-zinc-200">
            <Sparkles size={14} className="text-[#00E5FF] shrink-0" />
            <span>
              <strong className="text-[#00E5FF] font-mono text-[11px] uppercase tracking-wider">
                IA Spectral Scan:
              </strong>{' '}
              {adaptationReport.recommendationReason}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-zinc-300">
              In: {adaptationReport.detectedInputLufs} LUFS
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              Delta Sub:{' '}
              {adaptationReport.deltaAdjustments.subDeltaDb > 0 ? '+' : ''}
              {adaptationReport.deltaAdjustments.subDeltaDb}dB · Air:{' '}
              {adaptationReport.deltaAdjustments.airDeltaDb > 0 ? '+' : ''}
              {adaptationReport.deltaAdjustments.airDeltaDb}dB
            </span>
          </div>
        </div>
      )}

      {/* 6 Pro Presets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {presets.map((preset) => {
          const isSelected = preset.id === selectedPresetId;
          const isRecommended = preset.id === recommendedPresetId;

          return (
            <motion.button
              key={preset.id}
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.985 }}
              transition={SPRING_CARD}
              onClick={() => onSelectPreset(preset.id)}
              className={`text-left rounded-2xl p-4 border transition-colors relative overflow-hidden flex flex-col justify-between gap-3 cursor-pointer ${
                isSelected
                  ? 'bg-[#0b0e17] border-[#FF6B00]/80 shadow-[0_12px_32px_-8px_rgba(255,107,0,0.28)]'
                  : 'bg-[#080b12]/80 hover:bg-[#0c101a] border-white/[0.07] hover:border-white/[0.15]'
              }`}
            >
              {isSelected && (
                <motion.div
                  layoutId="preset-active-ring"
                  transition={SPRING_CARD}
                  className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#FF6B00] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]"
                />
              )}

              {/* Top Bar: Category Badge + AI Recommended / Active Indicator */}
              <div className="flex items-center justify-between gap-2 relative z-10">
                <span
                  className="text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full border"
                  style={{
                    color: preset.accentHex,
                    borderColor: `${preset.accentHex}45`,
                    backgroundColor: `${preset.accentHex}12`,
                  }}
                >
                  {preset.category}
                </span>

                <div className="flex items-center gap-1.5">
                  {isRecommended && (
                    <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-[#00E5FF]/12 border border-[#00E5FF]/40 text-[#00E5FF] flex items-center gap-1">
                      <Sparkles size={10} />
                      IA IDEAL
                    </span>
                  )}
                  {isSelected && (
                    <CheckCircle2 size={16} className="text-[#FF6B00]" />
                  )}
                </div>
              </div>

              {/* Title + Reference Artists */}
              <div className="relative z-10">
                <div className="text-[15px] font-semibold tracking-tight text-white leading-snug">
                  {preset.name}
                </div>
                <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                  {preset.referenceArtists}
                </div>
                <p className="text-xs text-zinc-400/90 mt-2 line-clamp-2 leading-relaxed">
                  {preset.description}
                </p>
              </div>

              {/* Technical Spec Pills */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-white/[0.06] relative z-10">
                {preset.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-zinc-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
};
