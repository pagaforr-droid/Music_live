import React from 'react';
import { Play, Square, Circle, Trash2 } from 'lucide-react';
import type { SamplePad, SamplerPattern } from '../types/sampler.types';

interface StepSequencerProps {
  pads: SamplePad[];
  pattern: SamplerPattern;
  currentStep: number;
  isPlaying: boolean;
  isRecording: boolean;
  onTogglePlay: () => void;
  onToggleRecord: () => void;
  onToggleStep: (padIndex: number, stepIndex: number) => void;
  onChangeBpm: (bpm: number) => void;
  onChangeSwing: (swing: number) => void;
  onClearPattern: () => void;
}

export const StepSequencer: React.FC<StepSequencerProps> = ({
  pads,
  pattern,
  currentStep,
  isPlaying,
  isRecording,
  onTogglePlay,
  onToggleRecord,
  onToggleStep,
  onChangeBpm,
  onChangeSwing,
  onClearPattern,
}) => {
  // Show pads that either have a sample loaded or have active steps (minimum first 8)
  const visiblePads = pads.filter(
    (p, idx) =>
      idx < 8 ||
      Boolean(p.regionId) ||
      pattern.lanes[idx]?.steps.some((s) => s.on)
  );

  return (
    <div className="rounded-2xl bg-[#121215] border border-white/[0.08] p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
              isPlaying
                ? 'bg-zinc-100 text-zinc-950'
                : 'bg-[#24242A] hover:bg-[#313139] border border-white/[0.12] text-zinc-100'
            }`}
          >
            {isPlaying ? <Square size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
            <span>{isPlaying ? 'Stop Seq' : 'Play Seq'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleRecord}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1 cursor-pointer ${
              isRecording
                ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 animate-pulse'
                : 'bg-[#1A1A1F] border-white/[0.08] text-zinc-400 hover:text-white'
            }`}
            title="Graba golpes en tiempo real cuantizados a la rejilla de pasos"
          >
            <Circle size={10} className={isRecording ? 'fill-rose-500' : ''} />
            <span>Rec Quantize</span>
          </button>

          <span className="text-xs font-semibold tracking-tight text-zinc-100 ml-1">
            Secuenciador 16 Pasos
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 bg-[#0B0B0D] border border-white/[0.08] rounded-xl px-2.5 py-1">
            <span className="text-zinc-500">BPM:</span>
            <input
              type="number"
              min={40}
              max={240}
              value={pattern.bpm}
              onChange={(e) => onChangeBpm(Number(e.target.value) || 120)}
              className="w-12 bg-[#16161B] border border-white/[0.08] rounded px-1 py-0.5 font-mono text-zinc-100 text-center"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-[#0B0B0D] border border-white/[0.08] rounded-xl px-2.5 py-1">
            <span className="text-zinc-500">Swing:</span>
            <input
              type="range"
              min={0}
              max={0.75}
              step={0.05}
              value={pattern.swing}
              onChange={(e) => onChangeSwing(Number(e.target.value))}
              className="w-16 accent-zinc-200 h-1 bg-zinc-800 rounded cursor-pointer"
            />
            <span className="text-zinc-200 font-mono">{Math.round(pattern.swing * 100)}%</span>
          </div>

          <button
            type="button"
            onClick={onClearPattern}
            className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-rose-500/15 border border-white/[0.08] hover:border-rose-500/35 text-zinc-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Trash2 size={12} />
            <span>Limpiar</span>
          </button>
        </div>
      </div>

      {/* Step Grid */}
      <div className="overflow-x-auto studio-scrollbar-thin pb-1.5">
        <div className="min-w-[660px] space-y-1">
          {visiblePads.map((pad) => {
            const lane = pattern.lanes[pad.index];
            if (!lane) return null;
            return (
              <div key={pad.index} className="flex items-center gap-1.5">
                <div className="w-28 shrink-0 flex items-center gap-1.5 truncate text-[11px]">
                  <span
                    className="w-2 h-4 rounded-sm shrink-0"
                    style={{ backgroundColor: pad.colorHex }}
                  />
                  <span className="truncate text-zinc-300">{pad.label}</span>
                </div>

                <div
                  className="flex-1 grid gap-1"
                  style={{
                    gridTemplateColumns: `repeat(${lane.steps.length}, minmax(0, 1fr))`,
                  }}
                >
                  {lane.steps.map((cell, stepIdx) => {
                    const isBeatStart = stepIdx % 4 === 0;
                    const isCurrent = stepIdx === currentStep;
                    return (
                      <button
                        key={stepIdx}
                        type="button"
                        onClick={() => onToggleStep(pad.index, stepIdx)}
                        style={{
                          backgroundColor: cell.on ? pad.colorHex : undefined,
                        }}
                        className={`h-6 rounded-md border transition-all cursor-pointer ${
                          isCurrent
                            ? 'ring-2 ring-white border-white'
                            : cell.on
                            ? 'border-transparent shadow-sm'
                            : isBeatStart
                            ? 'bg-[#1C1C22] border-white/[0.1] hover:border-white/[0.22]'
                            : 'bg-[#0C0C0F] border-white/[0.06] hover:border-white/[0.16]'
                        }`}
                        title={`Pad ${pad.index + 1} · Paso ${stepIdx + 1}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
