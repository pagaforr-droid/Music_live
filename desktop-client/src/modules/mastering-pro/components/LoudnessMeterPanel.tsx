import React from 'react';
import { motion } from 'framer-motion';
import { Activity, ShieldCheck, AlertTriangle, Gauge, CheckCircle2 } from 'lucide-react';
import type { AudioMetrics, ExportQaReport } from '../types/mastering.types';

interface LoudnessMeterPanelProps {
  metrics: AudioMetrics;
  targetLufs: number;
  ceilingDbTp: number;
  monoMakerFreq: number;
  lastExportQa?: ExportQaReport | null;
}

const SCALE_TICKS = ['0', '-6', '-12', '-18', '-24', '-36'];

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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 340, damping: 30, delay: 0.04 }}
      className="rounded-2xl mastering-surface p-5 flex flex-col justify-between gap-4 h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#FF6B00]/15 border border-[#FF6B00]/35 flex items-center justify-center text-[#FF6B00]">
            <Gauge size={14} />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold tracking-tight text-white">
              ITU-R BS.1770-4 Metering Bridge
            </h3>
            <p className="text-[10.5px] text-zinc-400">
              Loudness K-Weighted · True Peak 4x FIR
            </p>
          </div>
        </div>
        <span
          className={`text-[10px] font-mono px-2.5 py-1 rounded-full bg-[#07090e] border ${
            active
              ? 'border-[#00E5FF]/45 text-[#00E5FF] shadow-[0_0_12px_rgba(0,229,255,0.18)]'
              : 'border-white/[0.07] text-zinc-400'
          }`}
        >
          {active ? `● VIVO · Target ${targetLufs.toFixed(1)}` : `Target ${targetLufs.toFixed(1)} LUFS`}
        </span>
      </div>

      {/* Main Numerical Readouts Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl mastering-subpanel p-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            Output Loudness (Real)
          </div>
          <div className="text-2xl font-mono font-bold text-[#00E5FF] tracking-tight mt-1">
            {active ? fmt(metrics.outputLufs, 1) : '—'}{' '}
            <span className="text-[11px] font-normal text-zinc-400">LUFS</span>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1 flex items-center justify-between">
            <span>In: {fmt(metrics.inputLufs, 1)}</span>
            <span>Δ {finite(deltaLu) ? fmt(deltaLu, 1, true) : '—'} LU</span>
          </div>
        </div>

        <div className="rounded-xl mastering-subpanel p-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            True Peak (4x FIR)
          </div>
          <div
            className={`text-2xl font-mono font-bold tracking-tight mt-1 ${
              isTpHot
                ? 'text-rose-400'
                : active
                ? 'text-[#FF6B00]'
                : 'text-zinc-500'
            }`}
          >
            {active ? fmt(metrics.truePeakDb, 2) : '—'}{' '}
            <span className="text-[11px] font-normal text-zinc-400">dBTP</span>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1 flex items-center justify-between">
            <span>Ceil: {ceilingDbTp.toFixed(1)}</span>
            <span>Crest {fmt(metrics.crestFactorDb, 1)}dB</span>
          </div>
        </div>
      </div>

      {/* Vertical Broadcast LED Bar Meters (Expands cleanly to fill bridge height) */}
      <div className="flex-1 min-h-[195px] mastering-subpanel rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-stretch justify-between gap-2 flex-1">
          {/* Scale Ruler */}
          <div className="flex flex-col justify-between py-5 pr-1 text-[9px] font-mono text-zinc-600 select-none">
            {SCALE_TICKS.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>

          {/* IN LUFS */}
          <div className="flex-1 flex flex-col items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-400 font-medium">
              IN LUFS
            </span>
            <div className="w-7 flex-1 min-h-[130px] rounded-lg bg-[#05070b] border border-white/[0.07] relative overflow-hidden flex flex-col justify-end p-1 shadow-inner">
              <div
                className="w-full rounded bg-gradient-to-t from-zinc-600 to-zinc-400 transition-all duration-75"
                style={{ height: `${normLufs(metrics.inputLufs)}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-zinc-300 font-semibold">
              {fmt(metrics.inputLufs, 1)}
            </span>
          </div>

          {/* MASTER LUFS */}
          <div className="flex-1 flex flex-col items-center gap-2">
            <span className="text-[10px] font-mono text-[#00E5FF] font-bold">
              MASTER
            </span>
            <div className="w-7 flex-1 min-h-[130px] rounded-lg bg-[#05070b] border border-white/[0.07] relative overflow-hidden flex flex-col justify-end p-1 shadow-inner">
              <div
                className="absolute left-0 right-0 h-0.5 bg-white/90 z-10 shadow-[0_0_6px_#ffffff]"
                style={{ bottom: `${normLufs(targetLufs)}%` }}
                title={`Target ${targetLufs.toFixed(1)} LUFS`}
              />
              <div
                className="w-full rounded bg-gradient-to-t from-[#00E5FF] via-cyan-300 to-[#FF6B00] transition-all duration-75"
                style={{
                  height: `${active ? normLufs(metrics.outputLufs) : 0}%`,
                }}
              />
            </div>
            <span className="text-[11px] font-mono text-[#00E5FF] font-bold">
              {active ? fmt(metrics.outputLufs, 1) : '—'}
            </span>
          </div>

          {/* TRUE PEAK dBTP */}
          <div className="flex-1 flex flex-col items-center gap-2">
            <span className="text-[10px] font-mono text-[#FF6B00] font-bold">
              dBTP
            </span>
            <div className="w-7 flex-1 min-h-[130px] rounded-lg bg-[#05070b] border border-white/[0.07] relative overflow-hidden flex flex-col justify-end p-1 shadow-inner">
              <div
                className={`w-full rounded transition-all duration-75 ${
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
              className={`text-[11px] font-mono font-bold ${
                isTpHot ? 'text-rose-400' : 'text-[#FF6B00]'
              }`}
            >
              {active ? fmt(metrics.truePeakDb, 1) : '—'}
            </span>
          </div>

          {/* GAIN REDUCTION dB */}
          <div className="flex-1 flex flex-col items-center gap-2">
            <span className="text-[10px] font-mono text-amber-400 font-bold">
              GR dB
            </span>
            <div className="w-7 flex-1 min-h-[130px] rounded-lg bg-[#05070b] border border-white/[0.07] relative overflow-hidden flex flex-col justify-start p-1 shadow-inner">
              <div
                className="w-full rounded bg-gradient-to-b from-amber-400 to-[#FF6B00] transition-all duration-75"
                style={{
                  height: `${active ? normGr(metrics.gainReductionDb) : 0}%`,
                }}
              />
            </div>
            <span className="text-[11px] font-mono text-amber-400 font-bold">
              {active ? `-${metrics.gainReductionDb.toFixed(1)}` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Live Comp / Limiter / Short-Term Telemetry Strip */}
      <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
        <div className="rounded-xl mastering-subpanel py-2 px-2">
          <span className="text-zinc-500 block text-[9px] tracking-wider">COMP GR</span>
          <span className="text-amber-300 font-bold text-xs mt-0.5 block">
            {active && finite(metrics.compressorReductionDb)
              ? `-${metrics.compressorReductionDb.toFixed(1)}dB`
              : '—'}
          </span>
        </div>
        <div className="rounded-xl mastering-subpanel py-2 px-2">
          <span className="text-zinc-500 block text-[9px] tracking-wider">LIMIT GR</span>
          <span className="text-[#FF6B00] font-bold text-xs mt-0.5 block">
            {active ? `-${metrics.limiterReductionDb.toFixed(1)}dB` : '—'}
          </span>
        </div>
        <div className="rounded-xl mastering-subpanel py-2 px-2">
          <span className="text-zinc-500 block text-[9px] tracking-wider">SHORT-TERM</span>
          <span className="text-[#00E5FF] font-bold text-xs mt-0.5 block">
            {active ? `${fmt(metrics.shortTermLufs, 1)}` : '—'}
          </span>
        </div>
      </div>

      {/* Phase Correlation Meter */}
      <div className="rounded-xl mastering-subpanel p-3">
        <div className="flex items-center justify-between text-[11px] font-mono mb-2">
          <span className="text-zinc-300 font-sans font-medium flex items-center gap-1.5">
            <Activity size={12} className="text-[#00E5FF]" />
            Correlación de Fase
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

        <div className="relative w-full h-2.5 rounded-full bg-gradient-to-r from-rose-500/35 via-amber-400/35 to-emerald-500/45 border border-white/[0.08] overflow-hidden">
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/25" />
          {finite(metrics.phaseCorrelation) && (
            <div
              className="absolute top-0 bottom-0 w-3 rounded-full bg-[#00E5FF] shadow-[0_0_10px_#00E5FF] -translate-x-1/2 transition-all duration-75"
              style={{ left: `${phaseMarkerPct}%` }}
            />
          )}
        </div>

        <div className="flex justify-between text-[9.5px] font-mono text-zinc-500 mt-1.5">
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
              ? 'bg-amber-500/10 border-amber-500/35 text-amber-200'
              : 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between font-bold mb-0.5">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={11} />
              QA EXPORT VERIFICADO (24-BIT)
            </span>
            <span>Clips: {lastExportQa.clippedSamples}</span>
          </div>
          <div className="text-zinc-300">
            Out: <strong>{lastExportQa.outputLufs.toFixed(1)} LUFS</strong> · TP:{' '}
            <strong>{lastExportQa.finalTruePeakDbTp.toFixed(2)} dBTP</strong> ·
            LRA: {lastExportQa.lraLu.toFixed(1)} LU · PLR:{' '}
            {lastExportQa.plrDb.toFixed(1)} dB
          </div>
        </div>
      )}
    </motion.div>
  );
};
