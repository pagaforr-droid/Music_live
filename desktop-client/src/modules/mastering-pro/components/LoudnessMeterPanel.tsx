import React from 'react';
import { Activity, ShieldCheck, AlertTriangle, Gauge } from 'lucide-react';
import type { AudioMetrics } from '../types/mastering.types';

interface LoudnessMeterPanelProps {
  metrics: AudioMetrics;
  targetLufs: number;
  ceilingDbTp: number;
  monoMakerFreq: number;
}

export const LoudnessMeterPanel: React.FC<LoudnessMeterPanelProps> = ({
  metrics,
  targetLufs,
  ceilingDbTp,
  monoMakerFreq,
}) => {
  // Normalize helpers for vertical/horizontal LED bars
  const normLufs = (lufs: number) =>
    Math.max(0, Math.min(100, ((lufs + 36) / 36) * 100));
  const normPeak = (db: number) =>
    Math.max(0, Math.min(100, ((db + 36) / 36) * 100));
  const normGr = (grDb: number) =>
    Math.max(0, Math.min(100, (Math.abs(grDb) / 12) * 100));

  // Phase correlation position [-1..+1] -> [0%..100%]
  const phaseMarkerPct = Math.max(
    2,
    Math.min(98, ((metrics.phaseCorrelation + 1) / 2) * 100)
  );
  const isPhaseHealthy = metrics.phaseCorrelation >= 0.25;

  return (
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.65)] flex flex-col justify-between gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-[#FF6B00]" />
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
            ITU-R BS.1770-4 Metering Bridge
          </h3>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[#00E5FF]">
          Target {targetLufs.toFixed(1)} LUFS
        </span>
      </div>

      {/* Main Numerical Readouts Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-slate-950 border border-slate-800/90 p-2.5">
          <div className="text-[10px] font-mono uppercase text-slate-400">
            Output Loudness
          </div>
          <div className="text-xl font-mono font-bold text-[#00E5FF] mt-0.5">
            {metrics.outputLufs.toFixed(1)}{' '}
            <span className="text-[11px] font-normal text-slate-400">LUFS</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
            In: {metrics.inputLufs.toFixed(1)} LUFS · Δ{' '}
            {(metrics.outputLufs - metrics.inputLufs >= 0 ? '+' : '') +
              (metrics.outputLufs - metrics.inputLufs).toFixed(1)}{' '}
            LU
          </div>
        </div>

        <div className="rounded-xl bg-slate-950 border border-slate-800/90 p-2.5">
          <div className="text-[10px] font-mono uppercase text-slate-400">
            True Peak (4x)
          </div>
          <div
            className={`text-xl font-mono font-bold mt-0.5 ${
              metrics.truePeakDb > -0.3 ? 'text-rose-400' : 'text-[#FF6B00]'
            }`}
          >
            {metrics.truePeakDb.toFixed(2)}{' '}
            <span className="text-[11px] font-normal text-slate-400">dBTP</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
            Ceiling: {ceilingDbTp.toFixed(1)} dBTP · Crest {metrics.crestFactorDb}dB
          </div>
        </div>
      </div>

      {/* Vertical LED Bar Meters: IN LUFS | OUT LUFS | TRUE PEAK | GAIN REDUCTION */}
      <div className="grid grid-cols-4 gap-2.5 bg-slate-950/95 border border-slate-800/90 rounded-xl p-3">
        {/* IN LUFS */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-slate-400">IN LUFS</span>
          <div className="w-5 h-32 rounded-md bg-slate-900 border border-slate-800 relative overflow-hidden flex flex-col justify-end p-0.5">
            <div
              className="w-full rounded-sm bg-slate-500 transition-all duration-75"
              style={{ height: `${normLufs(metrics.inputLufs)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-300 font-semibold">
            {metrics.inputLufs.toFixed(1)}
          </span>
        </div>

        {/* OUT LUFS */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-[#00E5FF] font-bold">
            MASTER
          </span>
          <div className="w-5 h-32 rounded-md bg-slate-900 border border-slate-800 relative overflow-hidden flex flex-col justify-end p-0.5">
            {/* Target Line */}
            <div
              className="absolute left-0 right-0 h-0.5 bg-white z-10"
              style={{ bottom: `${normLufs(targetLufs)}%` }}
            />
            <div
              className="w-full rounded-sm bg-gradient-to-t from-[#00E5FF] via-cyan-300 to-[#FF6B00] transition-all duration-75"
              style={{ height: `${normLufs(metrics.outputLufs)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-[#00E5FF] font-bold">
            {metrics.outputLufs.toFixed(1)}
          </span>
        </div>

        {/* TRUE PEAK dBTP */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-[#FF6B00] font-bold">
            dBTP
          </span>
          <div className="w-5 h-32 rounded-md bg-slate-900 border border-slate-800 relative overflow-hidden flex flex-col justify-end p-0.5">
            <div
              className="w-full rounded-sm bg-gradient-to-t from-emerald-400 via-[#FF6B00] to-rose-500 transition-all duration-75"
              style={{ height: `${normPeak(metrics.truePeakDb)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-[#FF6B00] font-bold">
            {metrics.truePeakDb.toFixed(1)}
          </span>
        </div>

        {/* GAIN REDUCTION (Attenuation Top-Down) */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-amber-400 font-bold">
            GR dB
          </span>
          <div className="w-5 h-32 rounded-md bg-slate-900 border border-slate-800 relative overflow-hidden flex flex-col justify-start p-0.5">
            <div
              className="w-full rounded-sm bg-gradient-to-b from-amber-400 to-[#FF6B00] transition-all duration-75"
              style={{ height: `${normGr(metrics.gainReductionDb)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-amber-400 font-bold">
            -{metrics.gainReductionDb.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Phase Correlation Meter (-1.0 to +1.0) */}
      <div className="rounded-xl bg-slate-950 border border-slate-800/90 p-3">
        <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
          <span className="text-slate-300 flex items-center gap-1.5">
            <Activity size={12} className="text-[#00E5FF]" />
            CORRELACIÓN DE FASE
          </span>
          <span
            className={`font-bold flex items-center gap-1 ${
              isPhaseHealthy ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {isPhaseHealthy ? (
              <ShieldCheck size={12} />
            ) : (
              <AlertTriangle size={12} />
            )}
            {metrics.phaseCorrelation > 0 ? '+' : ''}
            {metrics.phaseCorrelation.toFixed(2)}
          </span>
        </div>

        <div className="relative w-full h-3 rounded-full bg-gradient-to-r from-rose-500/40 via-amber-400/40 to-emerald-500/50 border border-slate-800 overflow-hidden">
          {/* Center 0 mark */}
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-500" />
          {/* Live needle */}
          <div
            className="absolute top-0 bottom-0 w-2.5 rounded-full bg-[#00E5FF] shadow-[0_0_10px_#00E5FF] -translate-x-1/2 transition-all duration-75"
            style={{ left: `${phaseMarkerPct}%` }}
          />
        </div>

        <div className="flex justify-between text-[9.5px] font-mono text-slate-500 mt-1">
          <span>-1.0 Out of Phase</span>
          <span>0.0 Wide</span>
          <span className="text-emerald-400/90">
            +1.0 Mono Safe ({monoMakerFreq}Hz)
          </span>
        </div>
      </div>

      {/* 4-Band Spectral Distribution Summary */}
      <div className="rounded-xl bg-slate-950 border border-slate-800/90 p-2.5 grid grid-cols-4 gap-1.5 text-center">
        {[
          {
            label: 'SUB',
            val: metrics.postSpectralBalance.sub,
            color: 'text-[#FF6B00]',
          },
          {
            label: 'LOW-MID',
            val: metrics.postSpectralBalance.lowMid,
            color: 'text-emerald-400',
          },
          {
            label: 'PRESENCE',
            val: metrics.postSpectralBalance.presence,
            color: 'text-amber-300',
          },
          {
            label: 'AIR 12k+',
            val: metrics.postSpectralBalance.air,
            color: 'text-[#00E5FF]',
          },
        ].map((b) => (
          <div
            key={b.label}
            className="rounded-lg bg-slate-900/90 border border-slate-800/80 py-1.5 px-1"
          >
            <div className="text-[9px] font-mono text-slate-400">{b.label}</div>
            <div className={`text-[11px] font-mono font-bold ${b.color}`}>
              {b.val}dB
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
