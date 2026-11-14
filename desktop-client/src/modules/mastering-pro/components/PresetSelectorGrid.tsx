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
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.65)] flex flex-col gap-4">
      {/* Top Row: Section Title + Macro Intensity Slider (0% - 150%) */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <Flame size={16} className="text-[#FF6B00]" />
            <h3 className="text-sm font-bold tracking-wide text-white uppercase">
              Estilos de Ingeniería & Macro Intensidad
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Perfiles matemáticos clonados de cadenas de masterización de estudio con matriz Mid/Side y saturación 4x.
          </p>
        </div>

        {/* Macro Intensity Slider Card */}
        <div className="flex-1 min-w-[290px] max-w-md bg-slate-950/90 border border-slate-800 rounded-xl px-3.5 py-2.5">
          <div className="flex items-center justify-between text-xs font-mono mb-1.5">
            <span className="text-slate-300 flex items-center gap-1.5 font-semibold">
              <Sliders size={13} className="text-[#00E5FF]" />
              MASTERING INTENSITY
            </span>
            <span className="px-2 py-0.5 rounded bg-[#FF6B00]/20 border border-[#FF6B00]/50 text-[#FF6B00] font-bold">
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
            className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />

          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mt-1">
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
                className={`hover:text-[#00E5FF] transition-colors ${
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
        <div className="rounded-xl bg-slate-950/90 border border-[#00E5FF]/30 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-200">
            <Sparkles size={15} className="text-[#00E5FF] shrink-0" />
            <span>
              <strong className="text-[#00E5FF] font-mono">
                IA SPECTRAL SCAN:
              </strong>{' '}
              {adaptationReport.recommendationReason}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
              In: {adaptationReport.detectedInputLufs} LUFS
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-emerald-400">
              Delta Sub: {adaptationReport.deltaAdjustments.subDeltaDb > 0 ? '+' : ''}
              {adaptationReport.deltaAdjustments.subDeltaDb}dB · Air:{' '}
              {adaptationReport.deltaAdjustments.airDeltaDb > 0 ? '+' : ''}
              {adaptationReport.deltaAdjustments.airDeltaDb}dB
            </span>
          </div>
        </div>
      )}

      {/* 6 Pro Presets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {presets.map((preset) => {
          const isSelected = preset.id === selectedPresetId;
          const isRecommended = preset.id === recommendedPresetId;

          return (
            <motion.button
              key={preset.id}
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onSelectPreset(preset.id)}
              className={`text-left rounded-xl p-3.5 border transition-all relative overflow-hidden flex flex-col justify-between gap-2.5 ${
                isSelected
                  ? 'bg-slate-950 border-[#FF6B00] shadow-[0_0_25px_rgba(255,107,0,0.22)]'
                  : 'bg-slate-950/60 hover:bg-slate-950/95 border-slate-800/90 hover:border-slate-700'
              }`}
            >
              {/* Top Bar: Category Badge + AI Recommended / Active Indicator */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border"
                  style={{
                    color: preset.accentHex,
                    borderColor: `${preset.accentHex}55`,
                    backgroundColor: `${preset.accentHex}15`,
                  }}
                >
                  {preset.category}
                </span>

                <div className="flex items-center gap-1.5">
                  {isRecommended && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] flex items-center gap-1">
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
              <div>
                <div className="text-sm font-bold text-white leading-snug">
                  {preset.name}
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                  {preset.referenceArtists}
                </div>
                <p className="text-[11px] text-slate-400/90 mt-1.5 line-clamp-2 leading-relaxed">
                  {preset.description}
                </p>
              </div>

              {/* Technical Spec Pills */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800/80">
                {preset.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
