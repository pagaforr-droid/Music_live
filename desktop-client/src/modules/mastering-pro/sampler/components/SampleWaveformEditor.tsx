import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Play,
  Rewind,
  SkipBack,
  Square,
  Repeat,
  Scissors,
  Upload,
} from 'lucide-react';
import type { SampleRegion, SampleSource } from '../types/sampler.types';
import type { WaveformPyramid } from '../workers/waveformPeaks.worker';
import { buildAdaptiveMidiGrid } from '../engine/adaptiveMidiGrid';
import { midiNoteToName } from '../engine/PitchDetector';

interface SampleWaveformEditorProps {
  source: SampleSource | null;
  regions: SampleRegion[];
  selectedRegion: SampleRegion | null;
  selectedPadIndex?: number;
  pyramid: WaveformPyramid | null;
  isAuditioning: boolean;
  loopAudition: boolean;
  showBpmGrid: boolean;
  onSelectRegion: (id: string) => void;
  onUpdateRegionBounds: (id: string, startSec: number, endSec: number) => void;
  onSnapSec: (rawSec: number) => number;
  onCreateSliceAtSec: (sec: number) => void;
  onToggleAudition: () => void;
  onToggleLoopAudition: () => void;
  onDropAudioFile?: (file: File) => void;
  onClickUploadAudio?: () => void;
  onAssignRegionToSelectedPad?: () => void;
  onQuickExportRegion?: () => void;
}

export const SampleWaveformEditor: React.FC<SampleWaveformEditorProps> = ({
  source,
  regions,
  selectedRegion,
  selectedPadIndex = 0,
  pyramid,
  isAuditioning,
  loopAudition,
  showBpmGrid,
  onSelectRegion,
  onUpdateRegionBounds,
  onSnapSec,
  onCreateSliceAtSec,
  onToggleAudition,
  onToggleLoopAudition,
  onDropAudioFile,
  onClickUploadAudio,
  onAssignRegionToSelectedPad,
  onQuickExportRegion,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [scrollNorm, setScrollNorm] = useState<number>(0); // 0..(1 - 1/zoom)
  const [dragMode, setDragMode] = useState<'none' | 'start' | 'end' | 'new'>('none');
  const [dragAnchorSec, setDragAnchorSec] = useState<number>(0);
  const [hoverSec, setHoverSec] = useState<number | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState<boolean>(false);

  const duration = source?.buffer.duration ?? 0;
  const viewSpanSec = duration > 0 ? duration / zoom : 1;
  const maxViewStart = Math.max(0, duration - viewSpanSec);
  const viewStartSec = Math.max(0, Math.min(maxViewStart, scrollNorm * duration));
  const viewEndSec = viewStartSec + viewSpanSec;

  // Reset zoom when source changes
  useEffect(() => {
    setZoom(1);
    setScrollNorm(0);
  }, [source?.id]);

  // High-DPI Waveform Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(150, rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Studio background (Image 3 obsidian dark)
    ctx.fillStyle = '#0A0A0C';
    ctx.fillRect(0, 0, w, h);

    const midY = h / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (!source || duration <= 0) {
      ctx.fillStyle = 'rgba(161, 161, 170, 0.65)';
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Arrastra un archivo WAV/MP3/FLAC o carga una pista de Mastering Pro / Proyecto',
        w / 2,
        midY + 4
      );
      ctx.textAlign = 'left';
      return;
    }

    const secToX = (sec: number) => ((sec - viewStartSec) / viewSpanSec) * w;

    // High-Contrast Adaptive White Musical Grid (Bars, Beats, 1/8, 1/16, 1/32, 1/64 as you zoom in)
    if (showBpmGrid && source.bpm > 0) {
      const grid = buildAdaptiveMidiGrid({
        duration,
        viewStartSec,
        viewEndSec,
        viewportWidthPx: w,
        bpm: source.bpm,
        beatOffsetSec: source.preAnalysis?.beatOffsetSec ?? 0,
        beatTimes: source.preAnalysis?.beatTimes,
        downbeats: source.preAnalysis?.downbeats,
        resolutionMode: 'auto',
      });
      let lastBarX = -999;
      for (const gl of grid.lines) {
        const x = Math.round(secToX(gl.sec)) + 0.5;
        if (x < -1 || x > w + 1) continue;
        if (gl.level === 'bar') {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.lineWidth = 1.5;
        } else if (gl.level === 'beat') {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
          ctx.lineWidth = 1;
        } else if (gl.level === 'eighth') {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1;
        } else if (gl.level === 'sixteenth') {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
          ctx.lineWidth = 1;
        } else if (gl.level === 'thirtysecond') {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 1;
        }
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();

        if (gl.isDownbeat && gl.barNum !== undefined && x - lastBarX >= 28 && x < w - 18) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
          ctx.font = 'bold 9.5px monospace';
          ctx.fillText(`C${gl.barNum}`, x + 3, h - 6);
          lastBarX = x;
        }
      }
      ctx.lineWidth = 1;
    }

    // Stored Pre-Import Chord Progression Overlay
    if (source.preAnalysis?.chords?.length) {
      for (const ch of source.preAnalysis.chords) {
        const cx0 = secToX(ch.startSec);
        const cx1 = secToX(ch.endSec);
        if (cx1 < 0 || cx0 > w) continue;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx0, 0);
        ctx.lineTo(cx0, h);
        ctx.stroke();
        ctx.setLineDash([]);

        if (cx1 - cx0 >= 28 && cx0 >= -10 && cx0 < w - 20) {
          ctx.fillStyle = 'rgba(39, 39, 42, 0.92)';
          ctx.fillRect(Math.max(2, cx0 + 3), 2, Math.min(54, Math.max(24, ch.chord.length * 8 + 10)), 14);
          ctx.fillStyle = '#F4F4F5';
          ctx.font = 'bold 9px monospace';
          ctx.fillText(ch.chord, Math.max(6, cx0 + 7), 12);
        }
      }
    }

    // Draw waveform from multi-res pyramid (or direct fallback)
    const sr = source.buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(viewStartSec * sr));
    const endSample = Math.min(source.buffer.length, Math.ceil(viewEndSec * sr));
    const visibleSamples = Math.max(1, endSample - startSample);
    const samplesPerPx = visibleSamples / w;

    ctx.fillStyle = 'rgba(228, 228, 231, 0.65)';
    const level =
      pyramid?.levels
        .slice()
        .reverse()
        .find((lvl) => lvl.bucketSize <= Math.max(1, samplesPerPx)) ??
      pyramid?.levels[0];

    if (level) {
      for (let x = 0; x < w; x++) {
        const s0 = startSample + x * samplesPerPx;
        const s1 = startSample + (x + 1) * samplesPerPx;
        const b0 = Math.max(0, Math.floor(s0 / level.bucketSize));
        const b1 = Math.min(level.mins.length - 1, Math.ceil(s1 / level.bucketSize));
        let mn = 1;
        let mx = -1;
        for (let b = b0; b <= b1; b++) {
          if (level.mins[b] < mn) mn = level.mins[b];
          if (level.maxs[b] > mx) mx = level.maxs[b];
        }
        const yTop = midY - mx * (h * 0.44);
        const yBot = midY - mn * (h * 0.44);
        ctx.fillRect(x, yTop, 1.2, Math.max(1.5, yBot - yTop));
      }
    } else {
      const ch0 = source.buffer.getChannelData(0);
      for (let x = 0; x < w; x++) {
        const s0 = Math.floor(startSample + x * samplesPerPx);
        const s1 = Math.min(ch0.length - 1, Math.ceil(startSample + (x + 1) * samplesPerPx));
        let mn = 0;
        let mx = 0;
        const step = Math.max(1, Math.floor((s1 - s0) / 16));
        for (let i = s0; i <= s1; i += step) {
          const v = ch0[i];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        const yTop = midY - mx * (h * 0.44);
        const yBot = midY - mn * (h * 0.44);
        ctx.fillRect(x, yTop, 1.2, Math.max(1.5, yBot - yTop));
      }
    }

    // Draw all regions & slice markers
    for (const reg of regions) {
      const rx0 = secToX(reg.startSec);
      const rx1 = secToX(reg.endSec);
      if (rx1 < 0 || rx0 > w) continue;

      const isSel = reg.id === selectedRegion?.id;
      if (isSel) {
        ctx.fillStyle = 'rgba(255, 107, 0, 0.17)';
        ctx.fillRect(rx0, 0, Math.max(2, rx1 - rx0), h);

        // Start & End handles
        ctx.fillStyle = '#FF6B00';
        ctx.fillRect(rx0 - 2, 0, 4, h);
        ctx.fillRect(rx1 - 2, 0, 4, h);

        ctx.fillStyle = '#FF6B00';
        ctx.fillRect(rx0, 0, 14, 16);
        ctx.fillRect(rx1 - 14, 0, 14, 16);
        ctx.fillStyle = '#020617';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('S', rx0 + 4, 11);
        ctx.fillText('E', rx1 - 10, 11);
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.moveTo(rx0, 0);
        ctx.lineTo(rx0, h);
        ctx.stroke();
      }
    }

    // Hover guide
    if (hoverSec !== null) {
      const hx = secToX(hoverSec);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [
    source,
    duration,
    pyramid,
    regions,
    selectedRegion,
    viewStartSec,
    viewEndSec,
    viewSpanSec,
    showBpmGrid,
    hoverSec,
  ]);

  const xToSec = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return 0;
    const rect = canvas.getBoundingClientRect();
    const norm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewStartSec + norm * viewSpanSec;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!source || duration <= 0) return;
    const clickSec = xToSec(e.clientX);
    const tolSec = viewSpanSec * 0.015;

    if (selectedRegion) {
      if (Math.abs(clickSec - selectedRegion.startSec) <= tolSec) {
        setDragMode('start');
        return;
      }
      if (Math.abs(clickSec - selectedRegion.endSec) <= tolSec) {
        setDragMode('end');
        return;
      }
    }

    // Select clicked region if holding Alt or single click inside another slice
    const hitReg = regions.find(
      (r) => clickSec >= r.startSec && clickSec <= r.endSec
    );
    if (hitReg && hitReg.id !== selectedRegion?.id && e.detail === 1) {
      onSelectRegion(hitReg.id);
    }

    if (selectedRegion && e.shiftKey) {
      setDragMode('new');
      setDragAnchorSec(onSnapSec(clickSec));
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!source || duration <= 0) return;
    const rawSec = xToSec(e.clientX);
    setHoverSec(rawSec);

    if (dragMode === 'none' || !selectedRegion) return;
    const snapped = onSnapSec(rawSec);

    if (dragMode === 'start') {
      onUpdateRegionBounds(
        selectedRegion.id,
        Math.min(snapped, selectedRegion.endSec - 0.02),
        selectedRegion.endSec
      );
    } else if (dragMode === 'end') {
      onUpdateRegionBounds(
        selectedRegion.id,
        selectedRegion.startSec,
        Math.max(snapped, selectedRegion.startSec + 0.02)
      );
    } else if (dragMode === 'new') {
      const s = Math.min(dragAnchorSec, snapped);
      const en = Math.max(dragAnchorSec, snapped);
      if (en - s >= 0.02) {
        onUpdateRegionBounds(selectedRegion.id, s, en);
      }
    }
  };

  const handleMouseUp = () => {
    setDragMode('none');
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!source || duration <= 0) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    const nextZoom = Math.max(1, Math.min(48, zoom * factor));
    const cursorSec = xToSec(e.clientX);
    const rect = e.currentTarget.getBoundingClientRect();
    const cursorNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nextSpan = duration / nextZoom;
    const nextStart = Math.max(
      0,
      Math.min(duration - nextSpan, cursorSec - cursorNorm * nextSpan)
    );
    setZoom(nextZoom);
    setScrollNorm(duration > 0 ? nextStart / duration : 0);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!source) return;
    onCreateSliceAtSec(xToSec(e.clientX));
  };

  return (
    <div className="rounded-2xl bg-[#121215] border border-white/[0.08] p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-[#0B0B0D] border border-white/[0.09] rounded-full p-1">
            <button
              type="button"
              disabled={!source || regions.length === 0}
              onClick={() => {
                setScrollNorm(0);
                if (regions.length > 0) {
                  onSelectRegion(regions[0].id);
                }
              }}
              className="px-2.5 py-1 rounded-full bg-[#18181E] hover:bg-[#272730] text-zinc-200 hover:text-white text-xs font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition-colors"
              title="Ir al inicio del audio (00:00.0)"
            >
              <SkipBack size={12} />
              <span>Inicio</span>
            </button>

            <button
              type="button"
              disabled={!source || regions.length === 0}
              onClick={() => {
                if (regions.length > 0 && selectedRegion) {
                  const curIdx = regions.findIndex((rg) => rg.id === selectedRegion.id);
                  const prevIdx = Math.max(0, curIdx - 1);
                  const prevReg = regions[prevIdx];
                  onSelectRegion(prevReg.id);
                  if (duration > 0 && prevReg.startSec < viewStartSec) {
                    setScrollNorm(Math.max(0, prevReg.startSec / duration));
                  }
                } else {
                  setScrollNorm((s) => Math.max(0, s - 0.15 / zoom));
                }
              }}
              className="px-2.5 py-1 rounded-full bg-[#18181E] hover:bg-[#272730] text-zinc-200 hover:text-white text-xs font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition-colors"
              title="Retroceder a la región anterior"
            >
              <Rewind size={12} />
              <span>Retroceso</span>
            </button>

            <button
              type="button"
              onClick={onToggleAudition}
              disabled={!selectedRegion}
              className={`px-3.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 ${
                isAuditioning
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'bg-[#24242A] hover:bg-[#313139] border border-white/[0.12] text-zinc-100'
              }`}
              title="Reproducir o detener región activa (Atajo predeterminado: Barra Espaciadora)"
            >
              {isAuditioning ? <Square size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
              <span>{isAuditioning ? 'Detener (Espacio)' : 'Play Región (Espacio)'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleLoopAudition}
            className={`px-2.5 py-1.5 rounded-xl text-xs border flex items-center gap-1 transition-all cursor-pointer ${
              loopAudition
                ? 'bg-[#222228] border-white/[0.2] text-zinc-100 font-medium'
                : 'bg-[#0B0B0D] border-white/[0.07] text-zinc-400 hover:text-zinc-200'
            }`}
            title="Activar bucle con crossfade sin clics (tecla L)"
          >
            <Repeat size={12} />
            <span>Loop (L)</span>
          </button>

          {selectedRegion && (
            <>
              <button
                type="button"
                onClick={() =>
                  onCreateSliceAtSec(
                    (selectedRegion.startSec + selectedRegion.endSec) / 2
                  )
                }
                className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.08] text-xs text-zinc-200 flex items-center gap-1 cursor-pointer"
                title="Dividir la región actual en 2 (o haz doble clic en la onda)"
              >
                <Scissors size={12} className="text-emerald-400" />
                <span>Cortar Mitad</span>
              </button>

              {onAssignRegionToSelectedPad && (
                <button
                  type="button"
                  onClick={onAssignRegionToSelectedPad}
                  className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-xs font-medium text-orange-300 cursor-pointer"
                  title={`Asignar la región seleccionada al Pad ${selectedPadIndex + 1}`}
                >
                  → Pad {selectedPadIndex + 1}
                </button>
              )}

              {onQuickExportRegion && (
                <button
                  type="button"
                  onClick={onQuickExportRegion}
                  className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-xs font-medium text-emerald-300 flex items-center gap-1 cursor-pointer"
                  title="Exportar esta región sampleada como WAV 24-bit directo a tu PC"
                >
                  <Download size={12} />
                  <span>Exportar Corte</span>
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono">
          {source && (
            <span className="px-2.5 py-1 rounded-xl bg-[#0B0B0D] border border-white/[0.07] text-zinc-300">
              {source.bpm} BPM · Root {midiNoteToName(source.rootNote)}
              {source.preAnalysis?.isTonal ? ` · ${source.preAnalysis.musicalKey}` : ''}
            </span>
          )}
          {selectedRegion && (
            <span className="px-2.5 py-1 rounded-xl bg-[#0B0B0D] border border-white/[0.07] text-zinc-300">
              {selectedRegion.startSec.toFixed(3)}s → {selectedRegion.endSec.toFixed(3)}s (
              {(selectedRegion.endSec - selectedRegion.startSec).toFixed(3)}s)
            </span>
          )}

          <div className="flex items-center bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
              className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              title="Alejar zoom"
            >
              <ZoomOut size={13} />
            </button>
            <span className="px-1.5 text-[10px] text-zinc-200">
              {zoom.toFixed(1)}x
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(48, z * 1.5))}
              className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              title="Acercar zoom"
            >
              <ZoomIn size={13} />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setScrollNorm(0);
              }}
              className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              title="Ver pista completa"
            >
              <Maximize2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Canvas (supports direct Drag & Drop of audio files from PC) */}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setIsFileDragOver(true);
          }
        }}
        onDragLeave={() => setIsFileDragOver(false)}
        onDrop={(e) => {
          const f = e.dataTransfer.files?.[0];
          if (f && onDropAudioFile) {
            e.preventDefault();
            setIsFileDragOver(false);
            onDropAudioFile(f);
          } else {
            setIsFileDragOver(false);
          }
        }}
        className={`relative w-full h-44 rounded-xl overflow-hidden border bg-[#0A0A0C] transition-all ${
          isFileDragOver
            ? 'border-white/35'
            : 'border-white/[0.07]'
        }`}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            handleMouseUp();
            setHoverSec(null);
          }}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
          className="w-full h-full block cursor-crosshair"
          title="Arrastra un archivo del PC aquí · Arrastra asas S/E · Doble clic para cortar slice · Rueda para Zoom"
        />

        {!source && onClickUploadAudio && (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-4">
            <button
              type="button"
              onClick={onClickUploadAudio}
              className="pointer-events-auto px-3.5 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Upload size={13} />
              <span>Subir Archivo del PC para Samplear</span>
            </button>
          </div>
        )}
      </div>

      {/* Horizontal Pan Scrollbar */}
      {duration > 0 && (
        <div className="flex items-center gap-2 bg-[#0B0B0D] border border-white/[0.07] rounded-xl px-2.5 py-1 text-[10px] font-mono">
          <button
            type="button"
            disabled={zoom <= 1.01}
            onClick={() => setScrollNorm((s) => Math.max(0, s - 0.12 / zoom))}
            className="p-0.5 rounded bg-[#18181C] border border-white/[0.07] text-zinc-400 hover:text-white cursor-pointer disabled:opacity-30"
            title="Desplazar onda a la izquierda"
          >
            <ChevronLeft size={12} />
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0.001, 1 - 1 / zoom)}
            step={0.001}
            disabled={zoom <= 1.01}
            value={Math.min(scrollNorm, Math.max(0, 1 - 1 / zoom))}
            onChange={(e) => setScrollNorm(Number(e.target.value))}
            className="flex-1 accent-zinc-200 h-1.5 bg-zinc-800 rounded-full cursor-pointer disabled:opacity-35"
            title="Barra de desplazamiento horizontal de la onda"
          />
          <button
            type="button"
            disabled={zoom <= 1.01}
            onClick={() =>
              setScrollNorm((s) => Math.min(Math.max(0, 1 - 1 / zoom), s + 0.12 / zoom))
            }
            className="p-0.5 rounded bg-[#18181C] border border-white/[0.07] text-zinc-400 hover:text-white cursor-pointer disabled:opacity-30"
            title="Desplazar onda a la derecha"
          >
            <ChevronRight size={12} />
          </button>
          <span className="text-zinc-500 shrink-0 tabular-nums">
            {viewStartSec.toFixed(1)}s–{Math.min(duration, viewEndSec).toFixed(1)}s
          </span>
        </div>
      )}

      {/* Regions / Slices Strip (draggable onto Pads!) */}
      {regions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 max-h-24 overflow-y-auto studio-scrollbar-thin pr-1">
          <span className="text-[10.5px] text-zinc-500 mr-1">
            Slices ({regions.length}) — Arrastra sobre un Pad:
          </span>
          {regions.slice(0, 48).map((reg) => {
            const active = reg.id === selectedRegion?.id;
            return (
              <button
                key={reg.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/sampler-region-id', reg.id);
                }}
                onClick={() => onSelectRegion(reg.id)}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-mono border cursor-grab active:cursor-grabbing transition-all ${
                  active
                    ? 'bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold'
                    : 'bg-[#0B0B0D] border-white/[0.08] text-zinc-300 hover:border-white/[0.2]'
                }`}
              >
                {reg.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
