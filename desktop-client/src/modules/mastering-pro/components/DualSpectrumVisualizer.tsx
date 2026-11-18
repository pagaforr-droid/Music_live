import React, { useEffect, useRef } from 'react';
import type { MasteringDspChain } from '../types/mastering.types';

interface DualSpectrumVisualizerProps {
  getVisualSnapshot: () => {
    preBins: Uint8Array;
    postBins: Uint8Array;
    waveformPeaks: Float32Array;
    sampleRate?: number;
  };
  dspChain: MasteringDspChain;
  isPlaying: boolean;
  isBypassed: boolean;
  currentTimeSec: number;
  durationSec: number;
  getCurrentTimeSec?: () => number;
  onSeek: (sec: number) => void;
}

const FREQ_MARKERS = [
  { freq: 30, label: '30' },
  { freq: 60, label: '60' },
  { freq: 120, label: '120' },
  { freq: 250, label: '250' },
  { freq: 500, label: '500' },
  { freq: 1000, label: '1k' },
  { freq: 2000, label: '2k' },
  { freq: 3800, label: '3.8k' },
  { freq: 6200, label: '6.2k' },
  { freq: 10000, label: '10k' },
  { freq: 16000, label: '16k' },
];

function freqToNormX(freq: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  return Math.max(0, Math.min(1, (Math.log10(Math.max(20, freq)) - minLog) / (maxLog - minLog)));
}

export const DualSpectrumVisualizer: React.FC<DualSpectrumVisualizerProps> = ({
  getVisualSnapshot,
  dspChain,
  isPlaying,
  isBypassed,
  currentTimeSec,
  durationSec,
  getCurrentTimeSec,
  onSeek,
}) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Keep dynamic props in refs so 60fps canvas rAF loop never tears down/re-mounts on slider drags
  const stateRef = useRef({
    dspChain,
    isPlaying,
    isBypassed,
    currentTimeSec,
    durationSec,
    getCurrentTimeSec,
  });
  stateRef.current = {
    dspChain,
    isPlaying,
    isBypassed,
    currentTimeSec,
    durationSec,
    getCurrentTimeSec,
  };

  // Unified 60fps Canvas Loop (Waveform Scrubber Playhead + Dual FFT Spectrum + EQ Curve)
  useEffect(() => {
    let rafId = 0;

    const renderFrame = () => {
      const {
        dspChain: chain,
        isPlaying: playing,
        isBypassed: bypassed,
        currentTimeSec: stateTimeSec,
        durationSec: totalDurSec,
        getCurrentTimeSec: getLiveTime,
      } = stateRef.current;

      const snapshot = getVisualSnapshot();
      const liveTime = getLiveTime ? getLiveTime() : stateTimeSec;

      // A. Draw Waveform Scrubbing Bar smoothly at 60fps
      const wfCanvas = waveformCanvasRef.current;
      if (wfCanvas) {
        const wfCtx = wfCanvas.getContext('2d');
        if (wfCtx) {
          const dpr = window.devicePixelRatio || 1;
          const rect = wfCanvas.getBoundingClientRect();
          const w = Math.max(300, rect.width);
          const h = Math.max(38, rect.height);
          if (wfCanvas.width !== Math.floor(w * dpr) || wfCanvas.height !== Math.floor(h * dpr)) {
            wfCanvas.width = Math.floor(w * dpr);
            wfCanvas.height = Math.floor(h * dpr);
          }
          wfCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          wfCtx.clearRect(0, 0, w, h);

          const { waveformPeaks } = snapshot;
          const numBars = waveformPeaks.length || 1;
          const progress = totalDurSec > 0 ? Math.max(0, Math.min(1, liveTime / totalDurSec)) : 0;
          const barGap = 1.5;
          const barWidth = Math.max(1.2, (w - numBars * barGap) / numBars);
          const midY = h / 2;

          for (let i = 0; i < numBars; i++) {
            const x = i * (barWidth + barGap);
            const norm = waveformPeaks[i] || 0.08;
            const preHalfH = Math.max(2, norm * (h * 0.36));
            const postBoost = bypassed ? 1.0 : 1.18;
            const postHalfH = Math.min(h * 0.46, preHalfH * postBoost);
            const isPlayed = i / numBars <= progress;

            wfCtx.fillStyle = 'rgba(148, 163, 184, 0.25)';
            wfCtx.fillRect(x, midY - preHalfH, barWidth, preHalfH * 2);

            if (isPlayed) {
              wfCtx.fillStyle = bypassed ? '#64748b' : i % 2 === 0 ? '#0284c7' : '#38bdf8';
            } else {
              wfCtx.fillStyle = bypassed
                ? 'rgba(148, 163, 184, 0.45)'
                : 'rgba(56, 189, 248, 0.36)';
            }
            wfCtx.fillRect(x, midY - postHalfH, barWidth, postHalfH * 2);
          }

          const playheadX = progress * w;
          wfCtx.strokeStyle = '#0284c7';
          wfCtx.lineWidth = 2;
          wfCtx.beginPath();
          wfCtx.moveTo(playheadX, 0);
          wfCtx.lineTo(playheadX, h);
          wfCtx.stroke();
        }
      }

      // B. Draw Dual FFT Spectrum + EQ Transfer Curve + Mono Maker Boundary
      const canvas = spectrumCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const rect = canvas.getBoundingClientRect();
          const w = Math.max(360, rect.width);
          const h = Math.max(210, rect.height);

          if (
            canvas.width !== Math.floor(w * dpr) ||
            canvas.height !== Math.floor(h * dpr)
          ) {
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
          }

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          // 1. Background Studio Light Grid (Porcelain-Ice canvas + thin slate grid lines)
          ctx.fillStyle = '#f8fbff';
          ctx.fillRect(0, 0, w, h);

          const dbLines = [-6, -12, -24, -36, -48];
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
          ctx.lineWidth = 1;
          ctx.font = '10px monospace';
          ctx.fillStyle = 'rgba(100, 116, 139, 0.85)';

          for (const db of dbLines) {
            const y = (Math.abs(db) / 60) * (h - 24) + 8;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.fillText(`${db}dB`, 6, y - 3);
          }

          for (const marker of FREQ_MARKERS) {
            const x = freqToNormX(marker.freq) * w;
            ctx.strokeStyle =
              marker.freq === 3800 || marker.freq === 6200
                ? 'rgba(14, 165, 233, 0.28)'
                : 'rgba(148, 163, 184, 0.25)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h - 18);
            ctx.stroke();

            ctx.fillStyle =
              marker.freq === 3800 || marker.freq === 6200
                ? 'rgba(2, 132, 199, 0.92)'
                : 'rgba(100, 116, 139, 0.85)';
            ctx.fillText(marker.label, x - 10, h - 5);
          }

          // 2. Mono Maker Sub-Bass Zone Shade + Vertical Cutoff Line
          const monoX = freqToNormX(chain.monoMakerFreq) * w;
          const monoGrad = ctx.createLinearGradient(0, 0, monoX, 0);
          monoGrad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
          monoGrad.addColorStop(1, 'rgba(56, 189, 248, 0.03)');
          ctx.fillStyle = monoGrad;
          ctx.fillRect(0, 0, monoX, h - 18);

          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(monoX, 0);
          ctx.lineTo(monoX, h - 18);
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = '#0369a1';
          ctx.font = 'bold 10px monospace';
          ctx.fillText(
            `MONO MAKER ${chain.monoMakerFreq}Hz`,
            Math.max(8, Math.min(w - 135, monoX + 6)),
            16
          );

          // 3. Sample Pre & Post FFT Bins (or draw idle ambient floor when paused)
          const { preBins, postBins, sampleRate } = snapshot;
          const numPoints = 128;
          const nyquist = (sampleRate || 48000) / 2;
          const usableHeight = h - 24;

          const computeCurvePoints = (
            bins: Uint8Array,
            isPost: boolean
          ): Array<{ x: number; y: number }> => {
            const pts: Array<{ x: number; y: number }> = [];
            for (let i = 0; i < numPoints; i++) {
              const normX = i / (numPoints - 1);
              const freq = 20 * Math.pow(1000, normX);
              const binFloat = (freq / nyquist) * (bins.length - 1);
              const idx0 = Math.max(0, Math.min(bins.length - 1, Math.floor(binFloat)));
              const idx1 = Math.min(bins.length - 1, idx0 + 1);
              const frac = binFloat - idx0;
              let val = (bins[idx0] * (1 - frac) + bins[idx1] * frac) / 255;

              if (!playing && val < 0.02) {
                const tilt = 0.58 - normX * 0.26;
                const eqInfluence = isPost
                  ? chain.eqBands.reduce((acc, b) => {
                      const distOct = Math.log2(freq / Math.max(20, b.freq));
                      return (
                        acc +
                        (b.gainDb / 28) *
                          Math.exp(-distOct * distOct * (b.q * 1.8))
                      );
                    }, 0.05)
                  : 0;
                val = Math.max(0.08, Math.min(0.92, tilt + eqInfluence));
              }

              const y = usableHeight - val * (usableHeight - 14) + 6;
              pts.push({ x: normX * w, y });
            }
            return pts;
          };

          const prePts = computeCurvePoints(preBins, false);
          const postPts = computeCurvePoints(postBins, true);

          // 4. Draw Pre-Master Curve (Cool Slate Gray)
          ctx.beginPath();
          ctx.moveTo(0, usableHeight);
          for (const p of prePts) {
            ctx.lineTo(p.x, p.y);
          }
          ctx.lineTo(w, usableHeight);
          ctx.closePath();
          ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
          ctx.fill();

          ctx.beginPath();
          for (let i = 0; i < prePts.length; i++) {
            if (i === 0) ctx.moveTo(prePts[i].x, prePts[i].y);
            else ctx.lineTo(prePts[i].x, prePts[i].y);
          }
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
          ctx.lineWidth = 1.4;
          ctx.stroke();

          // 5. Draw Post-Master Curve (Azure #0284c7 -> Sky Blue #38bdf8)
          if (!bypassed) {
            const fillGrad = ctx.createLinearGradient(0, 0, w, usableHeight);
            fillGrad.addColorStop(0, 'rgba(2, 132, 199, 0.22)');
            fillGrad.addColorStop(0.55, 'rgba(56, 189, 248, 0.18)');
            fillGrad.addColorStop(1, 'rgba(186, 230, 253, 0.06)');

            ctx.beginPath();
            ctx.moveTo(0, usableHeight);
            for (const p of postPts) {
              ctx.lineTo(p.x, p.y);
            }
            ctx.lineTo(w, usableHeight);
            ctx.closePath();
            ctx.fillStyle = fillGrad;
            ctx.fill();

            const strokeGrad = ctx.createLinearGradient(0, 0, w, 0);
            strokeGrad.addColorStop(0, '#0369a1');
            strokeGrad.addColorStop(0.5, '#0ea5e9');
            strokeGrad.addColorStop(1, '#38bdf8');

            ctx.beginPath();
            for (let i = 0; i < postPts.length; i++) {
              if (i === 0) ctx.moveTo(postPts[i].x, postPts[i].y);
              else ctx.lineTo(postPts[i].x, postPts[i].y);
            }
            ctx.strokeStyle = strokeGrad;
            ctx.lineWidth = 2.2;
            ctx.stroke();
          }

          // 6. Draw Surgical EQ Nodes Overlay
          const zeroDbY = usableHeight * 0.48;
          for (const band of chain.eqBands) {
            const bx = freqToNormX(band.freq) * w;
            const by = Math.max(
              14,
              Math.min(usableHeight - 10, zeroDbY - band.gainDb * 8.5)
            );
            const nodeColor =
              band.channel === 'mid'
                ? '#2563eb'
                : band.channel === 'side'
                ? '#0ea5e9'
                : '#475569';

            ctx.beginPath();
            ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = nodeColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.6;
            ctx.stroke();

            if (Math.abs(band.gainDb) >= 0.4) {
              ctx.fillStyle = nodeColor;
              ctx.font = 'bold 9px monospace';
              const sign = band.gainDb > 0 ? '+' : '';
              ctx.fillText(
                `${band.channel.toUpperCase()} ${sign}${band.gainDb.toFixed(1)}dB`,
                Math.max(4, Math.min(w - 75, bx - 24)),
                by - 8
              );
            }
          }
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [getVisualSnapshot]);

  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * durationSec);
  };

  return (
    <div className="rounded-2xl mastering-surface p-4 flex flex-col gap-3">
      {/* Header Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="inline-block w-2 h-2 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.45)]" />
          <span className="text-[13px] font-semibold tracking-tight text-slate-900">
            Dual FFT Real-Time Analyzer (60 FPS)
          </span>
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600">
            PRE (Gris) vs POST (Azul Claro #0284c7 → #38bdf8)
          </span>
        </div>

        <div className="flex items-center gap-3.5 text-[10.5px] font-mono">
          <span className="flex items-center gap-1.5 text-blue-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            MID (Voz/Sub)
          </span>
          <span className="flex items-center gap-1.5 text-sky-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-sky-500" />
            SIDE (Aire/Width {dspChain.stereoWidth.widthPct}%)
          </span>
          <span className="flex items-center gap-1.5 text-slate-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-slate-600" />
            SURGICAL STEREO
          </span>
        </div>
      </div>

      {/* Interactive Waveform Scrubber */}
      <div className="relative w-full h-11 rounded-xl bg-[#f8fbff] border border-slate-200/90 shadow-inner overflow-hidden px-2 py-1">
        <canvas
          ref={waveformCanvasRef}
          onClick={handleWaveformClick}
          className="w-full h-full cursor-pointer"
          title="Haz clic en cualquier punto de la forma de onda para saltar en la canción"
        />
      </div>

      {/* Main 60fps FFT Spectrum Canvas */}
      <div className="relative w-full h-60 2xl:h-64 rounded-xl bg-[#f8fbff] border border-slate-200/90 shadow-inner overflow-hidden">
        <canvas ref={spectrumCanvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
};
