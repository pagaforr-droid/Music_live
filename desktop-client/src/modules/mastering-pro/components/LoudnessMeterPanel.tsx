import React from 'react';
import { Activity, ShieldCheck, AlertTriangle, Gauge, CheckCircle2 } from 'lucide-react';
import type { AudioMetrics, ExportQaReport } from '../types/mastering.types';

interface LoudnessMeterPanelProps {
  metrics: AudioMetrics;
  targetLufs: number;
  ceilingDbTp: number;
  monoMakerFreq: number;
  lastExportQa?: ExportQaReport | null;
}

export const LoudnessMeterPanel: React.FC<LoudnessMeterPanelProps> = ({
  metrics,
  targetLufs,
  ceilingDbTp,
  monoMakerFreq,
  lastExportQa,
}) => {
  const active = Boolean(metrics.isMeteringActive);
  const finite = (v: number | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v);

  const fmt = (v: number | undefined, digits = 1, prefixPlus = false): string => {
    if (!finite(v)) return '—';
    const p = prefixPlus && v > 0 ? '+' : '';
    return `${p}${v.toFixed(digits)}`;
  };

  const normLufs = (lufs: number | undefined) =>
    finite(lufs) ? Math.max(0, Math.min(100, ((lufs + 36) / 36) * 100)) : 0;
  const normPeak = (db: number | undefined) =>
    finite(db) ? Math.max(0, Math.min(100, ((db + 36) / 36) * 100)) : 0;
  const normGr = (grDb: number) =>
    Math.max(0, Math.min(100, (Math.abs(grDb) / 12) * 100));

  const corrVal = finite(metrics.phaseCorrelation) ? metrics.phaseCorrelation : 0;
  const phaseMarkerPct = Math.max(
    2,
    Math.min(98, ((corrVal + 1) / 2) * 100)
  );
  const isPhaseHealthy = !finite(metrics.phaseCorrelation) || metrics.phaseCorrelation >= 0.25;
  const isTpHot = active && finite(metrics.truePeakDb) && metrics.truePeakDb > ceilingDbTp + 0.05;

  const deltaLu =
    active && finite(metrics.outputLufs) && finite(metrics.inputLufs)
      ? metrics.outputLufs - metrics.inputLufs
      : NaN;

  return (
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.65)] flex flex-col justify-between gap-3.5 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-[#FF6B00]" />
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
            ITU-R BS.1770-4 Metering Bridge
          </h3>
        </div>
        <span
          className={`text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border ${
            active
              ? 'border-[#00E5FF]/50 text-[#00E5FF]'
              : 'border-slate-800 text-slate-500'
          }`}
        >
          {active ? `● VIVO · Target ${targetLufs.toFixed(1)}` : `Target ${targetLufs.toFixed(1)} LUFS`}
        </span>
      </div>

      {/* Main Numerical Readouts Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-slate-950 border border-slate-800/90 p-2.5">
          <div className="text-[10px] font-mono uppercase text-slate-400">
            Output Loudness (Real)
          </div>
          <div className="text-xl font-mono font-bold text-[#00E5FF] mt-0.5">
            {active ? fmt(metrics.outputLufs, 1) : '—'}{' '}
            <span className="text-[11px] font-normal text-slate-400">LUFS</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
            In: {fmt(metrics.inputLufs, 1)} LUFS · Δ{' '}
            {finite(deltaLu) ? fmt(deltaLu, 1, true) : '—'} LU
          </div>
        </div>

        <div className="rounded-xl bg-slate-950 border border-slate-800/90 p-2.5">
          <div className="text-[10px] font-mono uppercase text-slate-400">
            True Peak (4x FIR)
          </div>
          <div
            className={`text-xl font-mono font-bold mt-0.5 ${
              isTpHot
                ? 'text-rose-400'
                : active
                ? 'text-[#FF6B00]'
                : 'text-slate-500'
            }`}
          >
            {active ? fmt(metrics.truePeakDb, 2) : '—'}{' '}
            <span className="text-[11px] font-normal text-slate-400">dBTP</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
            Ceil: {ceilingDbTp.toFixed(1)} · Crest{' '}
            {active ? fmt(metrics.crestFactorDb, 1) : fmt(metrics.crestFactorDb, 1)}dB
          </div>
        </div>
      </div>

      {/* Vertical LED Bar Meters */}
      <div className="grid grid-cols-4 gap-2.5 bg-slate-950/95 border border-slate-800/90 rounded-xl p-3">
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-slate-400">IN LUFS</span>
          <div className="w-5 h-28 rounded-md bg-slate-900 border border-slate-800 relative overflow-hidden flex flex-col justify-end p-0.5">
            <div
              className="w-full rounded-sm bg-slate-500 transition-all duration-75"
              style={{ height: `${normLufs(metrics.inputLufs)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-300 font-semibold">
            {fmt(metrics.inputLufs, 1)}
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-[#00E5FF] font-bold">
            MASTER
          </span>
          <div className="w-5 h-28 rounded-md bg-slate-900 border border-slate-800 relative overflow-hidden flex flex-col justify-end p-0.5">
            <div
              className="absolute left-0 right-0 h-0.5 bg-white z-10"
              style={{ bottom: `${normLufs(targetLufs)}%` }}
            />
            <div
              className="w-full rounded-sm bg-gradient-to-t from-[#00E5FF] via-cyan-300 to-[#FF6B00] transition-all duration-75"
              style={{
                height: `${active ? normLufs(metrics.outputLufs) : 0}%`,
              }}
            />
          </div>
          <span className="text-[10px] font-mono text-[#00E5FF] font-bold">
            {active ? fmt(metrics.outputLufs, 1) : '—'}
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-[#FF6B00] font-bold">
            dBTP
          </span>
          <div className="w-5 h-28 rounded-md bg-slate-900 border border-slate-800 relative overflow-hidden flex flex-col justify-end p-0.5">
            <div
              className={`w-full rounded-sm transition-all duration-75 ${
                isTpHot
                  ? 'bg-rose-500'
                  : 'bg-gradient-to-t from-emerald-400 via-[#FF6B00] to-rose-500'
              }`}
              style={{
                height: `${active ? normPeak(metrics.truePeakDb) : 0}%`,
              }}
            />
          </div>
          <span
            className={`text-[10px] font-mono font-bold ${
              isTpHot ? 'text-rose-400' : 'text-[#FF6B00]'
            }`}
          >
            {active ? fmt(metrics.truePeakDb, 1) : '—'}
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-amber-400 font-bold">
            GR dB
          </span>
          <div className="w-5 h-28 rounded-md bg-slate-900 border border-slate-800 relative overflow-hidden flex flex-col justify-start p-0.5">
            <div
              className="w-full rounded-sm bg-gradient-to-b from-amber-400 to-[#FF6B00] transition-all duration-75"
              style={{
                height: `${active ? normGr(metrics.gainReductionDb) : 0}%`,
              }}
            />
          </div>
          <span className="text-[10px] font-mono text-amber-400 font-bold">
            {active ? `-${metrics.gainReductionDb.toFixed(1)}` : '—'}
          </span>
        </div>
      </div>

      {/* Live Comp / Limiter / Clipped Telemetry Strip */}
      <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] font-mono">
        <div className="rounded-lg bg-slate-950 border border-slate-800/80 py-1 px-1.5">
          <span className="text-slate-500 block text-[9px]">COMP GR</span>
          <span className="text-amber-300 font-bold">
            {active && finite(metrics.compressorReductionDb)
              ? `-${metrics.compressorReductionDb.toFixed(1)}dB`
              : '—'}
          </span>
        </div>
        <div className="rounded-lg bg-slate-950 border border-slate-800/80 py-1 px-1.5">
          <span className="text-slate-500 block text-[9px]">LIMIT GR</span>
          <span className="text-[#FF6B00] font-bold">
            {active ? `-${metrics.limiterReductionDb.toFixed(1)}dB` : '—'}
          </span>
        </div>
        <div className="rounded-lg bg-slate-950 border border-slate-800/80 py-1 px-1.5">
          <span className="text-slate-500 block text-[9px]">SHORT-TERM</span>
          <span className="text-[#00E5FF] font-bold">
            {active ? `${fmt(metrics.shortTermLufs, 1)}` : '—'}
          </span>
        </div>
      </div>

      {/* Phase Correlation Meter */}
      <div className="rounded-xl bg-slate-950 border border-slate-800/90 p-2.5">
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
            {finite(metrics.phaseCorrelation)
              ? fmt(metrics.phaseCorrelation, 2, true)
              : '—'}
          </span>
        </div>

        <div className="relative w-full h-2.5 rounded-full bg-gradient-to-r from-rose-500/40 via-amber-400/40 to-emerald-500/50 border border-slate-800 overflow-hidden">
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-500" />
          {finite(metrics.phaseCorrelation) && (
            <div
              className="absolute top-0 bottom-0 w-2.5 rounded-full bg-[#00E5FF] shadow-[0_0_10px_#00E5FF] -translate-x-1/2 transition-all duration-75"
              style={{ left: `${phaseMarkerPct}%` }}
            />
          )}
        </div>

        <div className="flex justify-between text-[9px] font-mono text-slate-500 mt-1">
          <span>-1.0 Phase</span>
          <span>0.0 Wide</span>
          <span className="text-emerald-400/90">
            +1.0 Mono ({monoMakerFreq}Hz)
          </span>
        </div>
      </div>

      {/* Verified Last Export QA Badge (if available) */}
      {lastExportQa && (
        <div
          className={`rounded-xl border px-3 py-2 text-[10px] font-mono ${
            lastExportQa.grBudgetExceeded
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
              : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between font-bold mb-0.5">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={11} />
              QA EXPORT VERIFICADO (24-BIT)
            </span>
            <span>Clips: {lastExportQa.clippedSamples}</span>
          </div>
          <div className="text-slate-300">
            Out: <strong>{lastExportQa.outputLufs.toFixed(1)} LUFS</strong> · TP:{' '}
            <strong>{lastExportQa.finalTruePeakDbTp.toFixed(2)} dBTP</strong> ·
            LRA: {lastExportQa.lraLu.toFixed(1)} LU · PLR:{' '}
            {lastExportQa.plrDb.toFixed(1)} dB
          </div>
        </div>
      )}
    </div>
  );
};
