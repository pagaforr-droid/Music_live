import React, { useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

export const MIN_HORIZONTAL_ZOOM = 1;
export const MAX_HORIZONTAL_ZOOM = 48;
export const MIN_THUMB_WIDTH_PCT = 6;

export interface HorizontalThumbMetrics {
  maxScrollNorm: number;
  rawWidthPct: number;
  visualWidthPct: number;
  visualLeftPct: number;
  scrollProgress: number;
  usableTrackFraction: number;
}

export function clampHorizontalScrollNorm(nextNorm: number, zoom: number): number {
  const safeZoom = Math.max(MIN_HORIZONTAL_ZOOM, zoom);
  const maxNorm = Math.max(0, 1 - 1 / safeZoom);
  if (!Number.isFinite(nextNorm)) return 0;
  return Math.max(0, Math.min(maxNorm, nextNorm));
}

export function computeAnchoredHorizontalZoom(params: {
  duration: number;
  currentZoom: number;
  currentScrollNorm: number;
  nextZoomRaw: number;
  anchorNorm01: number;
}): { zoom: number; scrollNorm: number } {
  const { duration, currentZoom, currentScrollNorm, nextZoomRaw, anchorNorm01 } = params;
  const nextZoom = Math.max(
    MIN_HORIZONTAL_ZOOM,
    Math.min(MAX_HORIZONTAL_ZOOM, Number.isFinite(nextZoomRaw) ? nextZoomRaw : 1)
  );
  if (duration <= 0 || nextZoom <= MIN_HORIZONTAL_ZOOM + 1e-4) {
    return { zoom: nextZoom <= 1.001 ? 1 : nextZoom, scrollNorm: 0 };
  }
  const safeCurZoom = Math.max(MIN_HORIZONTAL_ZOOM, currentZoom);
  const curSpan = duration / safeCurZoom;
  const curStart = Math.max(
    0,
    Math.min(Math.max(0, duration - curSpan), currentScrollNorm * duration)
  );
  const clampedAnchor = Math.max(0, Math.min(1, anchorNorm01));
  const anchorSec = curStart + clampedAnchor * curSpan;
  const nextSpan = duration / nextZoom;
  const nextStartSec = Math.max(
    0,
    Math.min(Math.max(0, duration - nextSpan), anchorSec - clampedAnchor * nextSpan)
  );
  return {
    zoom: nextZoom,
    scrollNorm: clampHorizontalScrollNorm(nextStartSec / duration, nextZoom),
  };
}

export function computeHorizontalThumbMetrics(
  duration: number,
  viewStartSec: number,
  zoom: number
): HorizontalThumbMetrics {
  const safeZoom = Math.max(MIN_HORIZONTAL_ZOOM, zoom);
  const maxScrollNorm = Math.max(0, 1 - 1 / safeZoom);
  const rawWidthPct = Math.min(100, (1 / safeZoom) * 100);
  const visualWidthPct = Math.max(MIN_THUMB_WIDTH_PCT, rawWidthPct);
  const startNorm =
    duration > 0 ? clampHorizontalScrollNorm(viewStartSec / duration, safeZoom) : 0;
  const scrollProgress =
    maxScrollNorm > 1e-6 ? Math.max(0, Math.min(1, startNorm / maxScrollNorm)) : 0;
  const usableTrackFraction = Math.max(0, (100 - visualWidthPct) / 100);
  const visualLeftPct = scrollProgress * (100 - visualWidthPct);
  return {
    maxScrollNorm,
    rawWidthPct,
    visualWidthPct,
    visualLeftPct,
    scrollProgress,
    usableTrackFraction,
  };
}

export interface TimelineHorizontalScrollbarProps {
  duration: number;
  zoom: number;
  viewStartSec: number;
  viewEndSec: number;
  currentTimeSec: number;
  onChangeScrollNorm: (nextNorm: number, isManualUserAction?: boolean) => void;
  onChangeZoomAndScroll: (
    nextZoom: number,
    nextScrollNorm: number,
    isManualUserAction?: boolean
  ) => void;
  onSeekToSec?: (sec: number) => void;
  /** Optional rendered background canvas/minimap placed behind the draggable thumb */
  overviewContent?: React.ReactNode;
  /** Height class for the interactive track (default: h-7) */
  trackHeightClass?: string;
  /** Accent color theme for the scrollbar thumb */
  accent?: 'cyan' | 'orange';
  /** Tooltip text for the overview track */
  trackTitle?: string;
  /** Optional compact aria label */
  ariaLabel?: string;
}

export const TimelineHorizontalScrollbar: React.FC<TimelineHorizontalScrollbarProps> = ({
  duration,
  zoom,
  viewStartSec,
  viewEndSec,
  currentTimeSec,
  onChangeScrollNorm,
  onChangeZoomAndScroll,
  onSeekToSec,
  overviewContent,
  trackHeightClass = 'h-7',
  accent = 'cyan',
  trackTitle = 'Barra de desplazamiento horizontal · Arrastra para moverte por toda la canción, arrastra los bordes para hacer Zoom o doble clic para 1x/4x',
  ariaLabel = 'Desplazamiento horizontal de la línea de tiempo',
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: 'move' | 'left' | 'right' | 'scrub-seek';
    startClientX: number;
    startNormStart: number;
    startNormEnd: number;
    startProgress: number;
    maxScrollNorm: number;
    usableTrackFraction: number;
    trackWidth: number;
    trackLeft: number;
  } | null>(null);

  const metrics = computeHorizontalThumbMetrics(duration, viewStartSec, zoom);
  const canScroll = duration > 0 && zoom > 1.01;
  const playheadPct =
    duration > 0 ? Math.max(0, Math.min(100, (currentTimeSec / duration) * 100)) : 0;

  const beginDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'track' | 'move' | 'left' | 'right'
  ) => {
    if (duration <= 0 || !trackRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = trackRef.current.getBoundingClientRect();
    const trackW = Math.max(80, rect.width);

    if (mode === 'track') {
      const clickNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / trackW));
      if (!canScroll) {
        if (onSeekToSec) {
          onSeekToSec(clickNorm * duration);
          dragRef.current = {
            mode: 'scrub-seek',
            startClientX: e.clientX,
            startNormStart: 0,
            startNormEnd: 1,
            startProgress: 0,
            maxScrollNorm: 0,
            usableTrackFraction: 0,
            trackWidth: trackW,
            trackLeft: rect.left,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        return;
      }

      const halfSpanNorm = 0.5 / Math.max(1, zoom);
      const jumpedNorm = clampHorizontalScrollNorm(clickNorm - halfSpanNorm, zoom);
      onChangeScrollNorm(jumpedNorm, true);

      const jumpedProgress =
        metrics.maxScrollNorm > 1e-6 ? jumpedNorm / metrics.maxScrollNorm : 0;
      dragRef.current = {
        mode: 'move',
        startClientX: e.clientX,
        startNormStart: jumpedNorm,
        startNormEnd: Math.min(1, jumpedNorm + 1 / Math.max(1, zoom)),
        startProgress: jumpedProgress,
        maxScrollNorm: metrics.maxScrollNorm,
        usableTrackFraction: metrics.usableTrackFraction,
        trackWidth: trackW,
        trackLeft: rect.left,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const startNormStart = clampHorizontalScrollNorm(viewStartSec / duration, zoom);
    const startNormEnd = Math.min(1, viewEndSec / duration);

    if (mode === 'move' && !canScroll) {
      if (onSeekToSec) {
        const clickNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / trackW));
        onSeekToSec(clickNorm * duration);
        dragRef.current = {
          mode: 'scrub-seek',
          startClientX: e.clientX,
          startNormStart: 0,
          startNormEnd: 1,
          startProgress: 0,
          maxScrollNorm: 0,
          usableTrackFraction: 0,
          trackWidth: trackW,
          trackLeft: rect.left,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }

    dragRef.current = {
      mode,
      startClientX: e.clientX,
      startNormStart,
      startNormEnd,
      startProgress: metrics.scrollProgress,
      maxScrollNorm: metrics.maxScrollNorm,
      usableTrackFraction: metrics.usableTrackFraction,
      trackWidth: trackW,
      trackLeft: rect.left,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragRef.current;
    if (!st || duration <= 0) return;

    if (st.mode === 'scrub-seek') {
      if (onSeekToSec) {
        const norm = Math.max(0, Math.min(1, (e.clientX - st.trackLeft) / st.trackWidth));
        onSeekToSec(norm * duration);
      }
      return;
    }

    const dNorm = (e.clientX - st.startClientX) / st.trackWidth;
    const minSpanNorm = 1 / MAX_HORIZONTAL_ZOOM;

    if (st.mode === 'move') {
      if (st.maxScrollNorm <= 1e-6) return;
      const denom = Math.max(0.01, st.usableTrackFraction);
      const nextProgress = Math.max(0, Math.min(1, st.startProgress + dNorm / denom));
      const nextStart = clampHorizontalScrollNorm(nextProgress * st.maxScrollNorm, zoom);
      onChangeScrollNorm(nextStart, true);
    } else if (st.mode === 'left') {
      const nextStart = Math.max(
        0,
        Math.min(st.startNormEnd - minSpanNorm, st.startNormStart + dNorm)
      );
      const nextSpan = Math.max(minSpanNorm, st.startNormEnd - nextStart);
      const nextZoom = Math.max(
        MIN_HORIZONTAL_ZOOM,
        Math.min(MAX_HORIZONTAL_ZOOM, 1 / nextSpan)
      );
      onChangeZoomAndScroll(nextZoom, clampHorizontalScrollNorm(nextStart, nextZoom), true);
    } else if (st.mode === 'right') {
      const nextEnd = Math.min(
        1,
        Math.max(st.startNormStart + minSpanNorm, st.startNormEnd + dNorm)
      );
      const nextSpan = Math.max(minSpanNorm, nextEnd - st.startNormStart);
      const nextZoom = Math.max(
        MIN_HORIZONTAL_ZOOM,
        Math.min(MAX_HORIZONTAL_ZOOM, 1 / nextSpan)
      );
      onChangeZoomAndScroll(
        nextZoom,
        clampHorizontalScrollNorm(st.startNormStart, nextZoom),
        true
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if capture already released
    }
  };

  const stepAmount = 0.18 / Math.max(1, zoom);
  const currentStartNorm =
    duration > 0 ? clampHorizontalScrollNorm(viewStartSec / duration, zoom) : 0;

  const isOrange = accent === 'orange';
  const thumbClasses = isOrange
    ? 'bg-[#FF6B00]/22 hover:bg-[#FF6B00]/32 border-[#FF6B00]/90 shadow-[0_0_12px_rgba(255,107,0,0.24)]'
    : 'bg-[#00E5FF]/22 hover:bg-[#00E5FF]/32 border-[#00E5FF]/90 shadow-[0_0_12px_rgba(0,229,255,0.24)]';
  const railBgClass = isOrange ? 'bg-[#FF6B00]' : 'bg-[#00E5FF]';
  const handleBarClass = isOrange
    ? 'bg-[#FF6B00] group-hover:bg-white'
    : 'bg-[#00E5FF] group-hover:bg-white';

  return (
    <div
      className="flex-1 flex items-center gap-1 min-w-[180px] select-none"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        disabled={!canScroll}
        onClick={() => onChangeScrollNorm(0, true)}
        className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer disabled:opacity-30 shrink-0"
        title="Ir al inicio de la canción"
      >
        <ChevronsLeft size={12} />
      </button>
      <button
        type="button"
        disabled={!canScroll}
        onClick={() =>
          onChangeScrollNorm(clampHorizontalScrollNorm(currentStartNorm - stepAmount, zoom), true)
        }
        className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer disabled:opacity-30 shrink-0"
        title="Desplazar horizontalmente a la izquierda (Shift + Rueda)"
      >
        <ChevronLeft size={12} />
      </button>

      {/* Interactive Overview Track + High-Visibility Draggable Scrollbar Thumb */}
      <div
        ref={trackRef}
        onPointerDown={(e) => beginDrag(e, 'track')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(e) => {
          if (duration <= 0 || !trackRef.current) return;
          if (zoom > 1.1) {
            onChangeZoomAndScroll(1, 0, true);
          } else {
            const rect = trackRef.current.getBoundingClientRect();
            const clickNorm = Math.max(
              0,
              Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
            );
            const next = computeAnchoredHorizontalZoom({
              duration,
              currentZoom: zoom,
              currentScrollNorm: currentStartNorm,
              nextZoomRaw: 4,
              anchorNorm01: clickNorm,
            });
            onChangeZoomAndScroll(next.zoom, next.scrollNorm, true);
          }
        }}
        className={`relative flex-1 ${trackHeightClass} rounded-lg overflow-hidden border border-slate-700/90 bg-[#03060F] cursor-pointer`}
        title={trackTitle}
      >
        {overviewContent}

        {/* Subtle Playhead Line across Full Song Overview */}
        {duration > 0 && (
          <div
            style={{ left: `${playheadPct}%` }}
            className="absolute top-0 bottom-0 w-[1.5px] bg-white/90 pointer-events-none z-10"
          />
        )}

        {/* Draggable Horizontal Viewport Thumb with Edge Zoom Handles & Grip */}
        <div
          onPointerDown={(e) => beginDrag(e, 'move')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            left: `${metrics.visualLeftPct}%`,
            width: `${metrics.visualWidthPct}%`,
          }}
          className={`absolute top-0 bottom-0 border rounded-md flex items-center justify-between transition-colors z-20 ${thumbClasses} ${
            canScroll ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
          }`}
        >
          {/* Left Edge Zoom Handle */}
          <div
            onPointerDown={(e) => beginDrag(e, 'left')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="w-2 h-full cursor-ew-resize flex items-center justify-center group shrink-0"
            title="Arrastra el borde izquierdo para hacer Zoom Horizontal"
          >
            <span className={`w-[2px] h-3.5 rounded-full ${handleBarClass}`} />
          </div>

          {/* Center Tactile Scrollbar Grip */}
          <div className="flex items-center gap-[2px] pointer-events-none opacity-85">
            <span className="w-[1.5px] h-2.5 rounded-full bg-white/85" />
            <span className="w-[1.5px] h-3.5 rounded-full bg-white" />
            <span className="w-[1.5px] h-2.5 rounded-full bg-white/85" />
          </div>

          {/* Right Edge Zoom Handle */}
          <div
            onPointerDown={(e) => beginDrag(e, 'right')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="w-2 h-full cursor-ew-resize flex items-center justify-center group shrink-0"
            title="Arrastra el borde derecho para hacer Zoom Horizontal"
          >
            <span className={`w-[2px] h-3.5 rounded-full ${handleBarClass}`} />
          </div>

          {/* Solid Bottom Scrollbar Rail for unmistakable horizontal scrollbar affordance */}
          <span
            className={`absolute left-1.5 right-1.5 bottom-[1.5px] h-[2.5px] rounded-full opacity-90 pointer-events-none ${railBgClass}`}
          />
        </div>
      </div>

      <button
        type="button"
        disabled={!canScroll}
        onClick={() =>
          onChangeScrollNorm(clampHorizontalScrollNorm(currentStartNorm + stepAmount, zoom), true)
        }
        className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer disabled:opacity-30 shrink-0"
        title="Desplazar horizontalmente a la derecha (Shift + Rueda)"
      >
        <ChevronRight size={12} />
      </button>
      <button
        type="button"
        disabled={!canScroll}
        onClick={() => onChangeScrollNorm(metrics.maxScrollNorm, true)}
        className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer disabled:opacity-30 shrink-0"
        title="Ir al final de la canción"
      >
        <ChevronsRight size={12} />
      </button>
    </div>
  );
};
