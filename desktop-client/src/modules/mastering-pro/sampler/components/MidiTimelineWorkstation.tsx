import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Hand,
  Headphones,
  Layers,
  Maximize2,
  MousePointer,
  Pencil,
  Trash2,
  Upload,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { midiNoteToName } from '../engine/PitchDetector';
import type { useStemReplacer } from '../hooks/useStemReplacer';
import type {
  DrumArticulation,
  DrumPieceRole,
  StemDrumHitEvent,
  StemNoteEvent,
} from '../types/sampler.types';
import {
  TimelineHorizontalScrollbar,
  clampHorizontalScrollNorm,
  computeAnchoredHorizontalZoom,
} from './TimelineHorizontalScrollbar';

export interface MidiGridLine {
  sec: number;
  leftPct: number;
  isDownbeat: boolean;
  barNum?: number;
  beatInBar: number;
}

interface DrumLaneDescriptor {
  id: string;
  role: DrumPieceRole;
  title: string;
  shortTag: string;
  gmHint: string;
  color: string;
  defaultArticulation?: DrumArticulation;
  isSubLane?: boolean;
  matchHit: (hit: StemDrumHitEvent) => boolean;
}

const FIVE_BUS_LANES: DrumLaneDescriptor[] = [
  {
    id: 'bus-crash',
    role: 'crash',
    title: 'CRASH / RIDE',
    shortTag: 'CR',
    gmHint: 'GM 49/51',
    color: '#EC4899',
    defaultArticulation: 'crash',
    matchHit: (h) => h.role === 'crash',
  },
  {
    id: 'bus-hat',
    role: 'hat',
    title: 'HI-HATS',
    shortTag: 'HH',
    gmHint: 'GM 42/46',
    color: '#F59E0B',
    defaultArticulation: 'closed',
    matchHit: (h) => h.role === 'hat',
  },
  {
    id: 'bus-tom',
    role: 'tom',
    title: 'TOMS (H/M/L)',
    shortTag: 'TOM',
    gmHint: 'GM 50/47/43',
    color: '#10B981',
    defaultArticulation: 'floor-tom',
    matchHit: (h) => h.role === 'tom',
  },
  {
    id: 'bus-snare',
    role: 'snare',
    title: 'SNARE / SNAKE',
    shortTag: 'SN',
    gmHint: 'GM 38/37',
    color: '#00E5FF',
    defaultArticulation: 'closed',
    matchHit: (h) => h.role === 'snare',
  },
  {
    id: 'bus-kick',
    role: 'kick',
    title: 'KICK (BOMBO)',
    shortTag: 'KK',
    gmHint: 'GM 36',
    color: '#FF6B00',
    defaultArticulation: 'closed',
    matchHit: (h) => h.role === 'kick',
  },
];

const NINE_GM_LANES: DrumLaneDescriptor[] = [
  {
    id: 'gm-crash',
    role: 'crash',
    title: 'CRASH CYMBAL',
    shortTag: 'CR',
    gmHint: 'GM 49',
    color: '#EC4899',
    defaultArticulation: 'crash',
    isSubLane: true,
    matchHit: (h) =>
      h.role === 'crash' &&
      h.articulation !== 'ride' &&
      h.midiNote !== 51 &&
      h.midiNote !== 53 &&
      h.midiNote !== 59,
  },
  {
    id: 'gm-ride',
    role: 'crash',
    title: 'RIDE / BELL',
    shortTag: 'RD',
    gmHint: 'GM 51/53',
    color: '#F472B6',
    defaultArticulation: 'ride',
    isSubLane: true,
    matchHit: (h) =>
      h.role === 'crash' &&
      (h.articulation === 'ride' || h.midiNote === 51 || h.midiNote === 53 || h.midiNote === 59),
  },
  {
    id: 'gm-open-hat',
    role: 'hat',
    title: 'OPEN HI-HAT',
    shortTag: 'OH',
    gmHint: 'GM 46',
    color: '#FBBF24',
    defaultArticulation: 'open',
    isSubLane: true,
    matchHit: (h) => h.role === 'hat' && (h.articulation === 'open' || h.midiNote === 46),
  },
  {
    id: 'gm-closed-hat',
    role: 'hat',
    title: 'CLOSED HI-HAT',
    shortTag: 'HH',
    gmHint: 'GM 42/44',
    color: '#F59E0B',
    defaultArticulation: 'closed',
    isSubLane: true,
    matchHit: (h) => h.role === 'hat' && h.articulation !== 'open' && h.midiNote !== 46,
  },
  {
    id: 'gm-high-tom',
    role: 'tom',
    title: 'HIGH TOM (+3st)',
    shortTag: 'HT',
    gmHint: 'GM 50',
    color: '#34D399',
    defaultArticulation: 'high-tom',
    isSubLane: true,
    matchHit: (h) =>
      h.role === 'tom' && (h.articulation === 'high-tom' || h.midiNote === 50 || h.midiNote === 48),
  },
  {
    id: 'gm-mid-tom',
    role: 'tom',
    title: 'MID TOM (0st)',
    shortTag: 'MT',
    gmHint: 'GM 47',
    color: '#10B981',
    defaultArticulation: 'mid-tom',
    isSubLane: true,
    matchHit: (h) =>
      h.role === 'tom' &&
      h.articulation !== 'high-tom' &&
      h.articulation !== 'floor-tom' &&
      h.midiNote !== 50 &&
      h.midiNote !== 48 &&
      h.midiNote !== 43 &&
      h.midiNote !== 41,
  },
  {
    id: 'gm-floor-tom',
    role: 'tom',
    title: 'FLOOR TOM (-3st)',
    shortTag: 'FT',
    gmHint: 'GM 43/41',
    color: '#059669',
    defaultArticulation: 'floor-tom',
    isSubLane: true,
    matchHit: (h) =>
      h.role === 'tom' &&
      (h.articulation === 'floor-tom' || h.midiNote === 43 || h.midiNote === 41),
  },
  {
    id: 'gm-snare',
    role: 'snare',
    title: 'SNARE / SNAKE',
    shortTag: 'SN',
    gmHint: 'GM 38/37',
    color: '#00E5FF',
    defaultArticulation: 'closed',
    isSubLane: true,
    matchHit: (h) => h.role === 'snare',
  },
  {
    id: 'gm-kick',
    role: 'kick',
    title: 'KICK (BOMBO)',
    shortTag: 'KK',
    gmHint: 'GM 36',
    color: '#FF6B00',
    defaultArticulation: 'closed',
    isSubLane: true,
    matchHit: (h) => h.role === 'kick',
  },
];

const isBlackKey = (midi: number) => {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
};

const formatTime = (sec: number) => {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
};

export interface MidiTimelineWorkstationProps {
  replacer: ReturnType<typeof useStemReplacer>;
  duration: number;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  scrollNorm: number;
  setScrollNorm: React.Dispatch<React.SetStateAction<number>>;
  viewStartSec: number;
  viewEndSec: number;
  viewSpanSec: number;
  visibleGridLines: MidiGridLine[];
  editorSizeMode: 'compact' | 'large' | 'fullscreen';
  setEditorSizeMode: (mode: 'compact' | 'large' | 'fullscreen') => void;
  selectedHitId: string | null;
  setSelectedHitId: (id: string | null) => void;
  onRequestUploadForRole: (role: DrumPieceRole) => void;
  autoFollowPlayhead?: boolean;
  onToggleAutoFollowPlayhead?: () => void;
  onManualHorizontalScroll?: () => void;
}

export const MidiTimelineWorkstation: React.FC<MidiTimelineWorkstationProps> = ({
  replacer: r,
  duration,
  zoom,
  setZoom,
  scrollNorm,
  setScrollNorm,
  viewStartSec,
  viewEndSec,
  viewSpanSec,
  visibleGridLines,
  editorSizeMode,
  setEditorSizeMode,
  selectedHitId,
  setSelectedHitId,
  onRequestUploadForRole,
  autoFollowPlayhead: controlledAutoFollow,
  onToggleAutoFollowPlayhead,
  onManualHorizontalScroll,
}) => {
  const isDrums = r.stemMode === 'drums';
  const [editTool, setEditTool] = useState<
    'select' | 'add' | 'convert-tom-kick' | 'pan' | 'erase'
  >('select');
  const [drumLaneMode, setDrumLaneMode] = useState<'5-buses' | '9-gm'>('9-gm');
  const [tomInsertArticulation, setTomInsertArticulation] = useState<
    'floor-tom' | 'mid-tom' | 'high-tom'
  >('floor-tom');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [internalAutoFollow, setInternalAutoFollow] = useState(true);
  const autoFollowPlayhead = controlledAutoFollow ?? internalAutoFollow;
  const [minimapResizeTick, setMinimapResizeTick] = useState(0);

  // Vertical Zoom (scales lane height dynamically from 0.65x to 2.6x)
  const [verticalZoom, setVerticalZoom] = useState<number>(1.0);
  const [vScrollMetrics, setVScrollMetrics] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });
  const [isPanning2D, setIsPanning2D] = useState(false);

  const verticalScrollRef = useRef<HTMLDivElement | null>(null);
  const hMinimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vScrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const lastAutoFollowTimeRef = useRef<number>(-1);

  // Drag refs for 60fps pointer interactions without stale closures
  const pan2DRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startScrollNorm: number;
    startScrollTop: number;
    laneWidth: number;
  } | null>(null);

  const vBarDragRef = useRef<{
    mode: 'move' | 'top' | 'bottom';
    startClientY: number;
    startScrollTop: number;
    startVerticalZoom: number;
    trackHeight: number;
    scrollHeight: number;
    clientHeight: number;
  } | null>(null);

  const activeDrumLanes = drumLaneMode === '9-gm' ? NINE_GM_LANES : FIVE_BUS_LANES;

  // Melodic Piano Roll Pitch Rows (descending high-to-low MIDI notes)
  const melodicRows = useMemo(() => {
    if (isDrums || !r.analysis) return [];
    const rawMin = r.analysis.midiRange?.minMidi ?? 36;
    const rawMax = r.analysis.midiRange?.maxMidi ?? 72;
    const minM = Math.max(24, Math.min(rawMin - 4, rawMax - 24));
    const maxM = Math.min(96, Math.max(rawMax + 4, minM + 24));
    const rows: number[] = [];
    for (let m = maxM; m >= minM; m--) {
      rows.push(m);
    }
    return rows;
  }, [isDrums, r.analysis]);

  const selectedHit = useMemo(
    () => r.analysis?.drumHits.find((h) => h.id === selectedHitId) ?? null,
    [r.analysis?.drumHits, selectedHitId]
  );

  const selectedMelodicNote = useMemo(
    () => r.analysis?.noteEvents.find((n) => n.id === selectedNoteId) ?? null,
    [r.analysis?.noteEvents, selectedNoteId]
  );

  // Compute dynamic row/lane height from workspace mode + vertical zoom
  const baseLaneHeightPx = isDrums
    ? editorSizeMode === 'fullscreen'
      ? 86
      : editorSizeMode === 'large'
      ? 72
      : 54
    : editorSizeMode === 'fullscreen'
    ? 28
    : 22;
  const laneHeightPx = Math.round(
    Math.max(isDrums ? 42 : 16, Math.min(isDrums ? 184 : 46, baseLaneHeightPx * verticalZoom))
  );

  // Viewport height adapts cleanly in fullscreen so bottom horizontal scrollbar & inspector are NEVER clipped
  const viewportHeightClass =
    editorSizeMode === 'fullscreen'
      ? 'flex-1 min-h-[175px]'
      : editorSizeMode === 'large'
      ? 'h-[396px] shrink-0'
      : 'h-[268px] shrink-0';

  const notifyManualHorizontalScroll = useCallback(() => {
    if (onManualHorizontalScroll) {
      onManualHorizontalScroll();
    } else if (r.isPlaying) {
      setInternalAutoFollow(false);
    }
  }, [onManualHorizontalScroll, r.isPlaying]);

  const handleToggleFollow = useCallback(() => {
    if (onToggleAutoFollowPlayhead) {
      onToggleAutoFollowPlayhead();
      return;
    }
    setInternalAutoFollow((prev) => {
      const next = !prev;
      if (next && zoom > 1.02 && duration > 0) {
        const targetStartSec = Math.max(
          0,
          Math.min(duration - viewSpanSec, r.currentTimeSec - viewSpanSec * 0.15)
        );
        setScrollNorm(clampHorizontalScrollNorm(targetStartSec / duration, zoom));
      }
      return next;
    });
  }, [onToggleAutoFollowPlayhead, zoom, duration, viewSpanSec, r.currentTimeSec, setScrollNorm]);

  // Clamp horizontal scroll norm cleanly
  const clampScrollNorm = useCallback(
    (nextNorm: number, targetZoom = zoom) => clampHorizontalScrollNorm(nextNorm, targetZoom),
    [zoom]
  );

  const applyHorizontalZoomAtCursor = useCallback(
    (nextZoomRaw: number, anchorNorm01 = 0.5) => {
      if (duration <= 0) return;
      const next = computeAnchoredHorizontalZoom({
        duration,
        currentZoom: zoom,
        currentScrollNorm: scrollNorm,
        nextZoomRaw,
        anchorNorm01,
      });
      setZoom(next.zoom);
      setScrollNorm(next.scrollNorm);
    },
    [duration, zoom, scrollNorm, setZoom, setScrollNorm]
  );

  const handleMidiScrollbarChange = useCallback(
    (nextNorm: number, isManual = false) => {
      setScrollNorm(clampHorizontalScrollNorm(nextNorm, zoom));
      if (isManual) notifyManualHorizontalScroll();
    },
    [zoom, setScrollNorm, notifyManualHorizontalScroll]
  );

  const handleMidiScrollbarZoomAndScroll = useCallback(
    (nextZoomRaw: number, nextScrollNorm: number, isManual = false) => {
      const clampedZoom = Math.max(1, Math.min(48, nextZoomRaw));
      setZoom(clampedZoom);
      setScrollNorm(clampHorizontalScrollNorm(nextScrollNorm, clampedZoom));
      if (isManual) notifyManualHorizontalScroll();
    },
    [setZoom, setScrollNorm, notifyManualHorizontalScroll]
  );

  // Sync vertical scroll metrics whenever container resizes, lanes change, or verticalZoom changes
  const syncVerticalMetrics = useCallback(() => {
    const el = verticalScrollRef.current;
    if (!el) return;
    setVScrollMetrics({
      scrollTop: el.scrollTop,
      scrollHeight: Math.max(1, el.scrollHeight),
      clientHeight: Math.max(1, el.clientHeight),
    });
  }, []);

  useEffect(() => {
    const el = verticalScrollRef.current;
    if (!el) return;
    syncVerticalMetrics();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        syncVerticalMetrics();
        setMinimapResizeTick((t) => (t + 1) & 0xffff);
      });
      ro.observe(el);
    }
    const raf = requestAnimationFrame(syncVerticalMetrics);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [syncVerticalMetrics, laneHeightPx, drumLaneMode, editorSizeMode, melodicRows.length, isDrums]);

  // Fallback auto-follow playhead when component is used uncontrolled (when controlled, StemReplacerPanel owns it)
  useEffect(() => {
    if (controlledAutoFollow !== undefined) return;
    if (!r.isPlaying || !autoFollowPlayhead || zoom <= 1.02 || duration <= 0) {
      lastAutoFollowTimeRef.current = r.currentTimeSec;
      return;
    }
    const t = r.currentTimeSec;
    const prevT = lastAutoFollowTimeRef.current;
    lastAutoFollowTimeRef.current = t;
    if (Math.abs(t - prevT) < 0.0005) return;
    if (t > viewEndSec - viewSpanSec * 0.06 || t < viewStartSec - 0.02) {
      const targetStartSec = Math.max(0, Math.min(duration - viewSpanSec, t - viewSpanSec * 0.12));
      setScrollNorm(clampHorizontalScrollNorm(targetStartSec / duration, zoom));
    }
  }, [
    controlledAutoFollow,
    r.isPlaying,
    r.currentTimeSec,
    autoFollowPlayhead,
    zoom,
    duration,
    viewStartSec,
    viewEndSec,
    viewSpanSec,
    setScrollNorm,
  ]);

  // Non-passive Wheel Handler inside the MIDI Grid:
  // - Ctrl/Meta + Wheel = Horizontal Zoom anchored at cursor
  // - Alt + Wheel = Vertical Zoom (lane height)
  // - Shift + Wheel or Trackpad Horizontal Swipe = Smooth Horizontal Scroll
  // - Plain Wheel = Smooth Vertical Scroll through lanes/octaves
  useEffect(() => {
    const el = verticalScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (duration <= 0) return;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const headerOffset = isDrums ? (window.innerWidth >= 640 ? 256 : 208) : 96;
        const laneW = Math.max(120, rect.width - headerOffset);
        const anchorNorm = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left - headerOffset) / laneW)
        );
        const factor = e.deltaY < 0 ? 1.24 : 0.81;
        applyHorizontalZoomAtCursor(zoom * factor, anchorNorm);
        return;
      }

      if (e.altKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.14 : 0.88;
        setVerticalZoom((vz) => Number(Math.max(0.65, Math.min(2.6, vz * factor)).toFixed(3)));
        return;
      }

      const isHorizontalIntent =
        e.shiftKey || (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 2);

      if (isHorizontalIntent && zoom > 1.01) {
        e.preventDefault();
        const rawDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const normDelta = (rawDelta / 900) * (1 / zoom);
        setScrollNorm((prev) => clampScrollNorm(prev + normDelta));
        notifyManualHorizontalScroll();
        return;
      }

      // Vertical scroll inside MIDI lanes when vertical overflow exists
      const maxScrollTop = el.scrollHeight - el.clientHeight;
      if (maxScrollTop > 2) {
        const atTop = el.scrollTop <= 0 && e.deltaY < 0;
        const atBottom = el.scrollTop >= maxScrollTop - 1 && e.deltaY > 0;
        if (!atTop && !atBottom) {
          e.preventDefault();
          el.scrollTop = Math.max(0, Math.min(maxScrollTop, el.scrollTop + e.deltaY * 0.85));
          syncVerticalMetrics();
        }
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [
    duration,
    isDrums,
    zoom,
    applyHorizontalZoomAtCursor,
    clampScrollNorm,
    setScrollNorm,
    syncVerticalMetrics,
    notifyManualHorizontalScroll,
  ]);

  // Global keyboard shortcuts for MIDI scroll & selected note deletion
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!r.analysis || duration <= 0) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isDrums && selectedNoteId) {
        e.preventDefault();
        r.removeMelodicNote(selectedNoteId);
        setSelectedNoteId(null);
      } else if (e.key === 'ArrowLeft' && !e.altKey && zoom > 1.01) {
        e.preventDefault();
        const step = (e.shiftKey ? 0.28 : 0.1) / zoom;
        setScrollNorm((s) => clampScrollNorm(s - step));
        notifyManualHorizontalScroll();
      } else if (e.key === 'ArrowRight' && !e.altKey && zoom > 1.01) {
        e.preventDefault();
        const step = (e.shiftKey ? 0.28 : 0.1) / zoom;
        setScrollNorm((s) => clampScrollNorm(s + step));
        notifyManualHorizontalScroll();
      } else if (e.key === 'ArrowUp' && verticalScrollRef.current) {
        const el = verticalScrollRef.current;
        if (el.scrollHeight > el.clientHeight + 2) {
          e.preventDefault();
          el.scrollBy({ top: -laneHeightPx, behavior: 'smooth' });
        }
      } else if (e.key === 'ArrowDown' && verticalScrollRef.current) {
        const el = verticalScrollRef.current;
        if (el.scrollHeight > el.clientHeight + 2) {
          e.preventDefault();
          el.scrollBy({ top: laneHeightPx, behavior: 'smooth' });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    r,
    duration,
    isDrums,
    selectedNoteId,
    zoom,
    clampScrollNorm,
    setScrollNorm,
    laneHeightPx,
    notifyManualHorizontalScroll,
  ]);

  // Render High-DPI Horizontal MIDI Minimap Canvas (shows all drum hits or melodic notes across full song)
  useEffect(() => {
    const canvas = hMinimapCanvasRef.current;
    if (!canvas || !r.analysis || duration <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(160, rect.width);
    const h = Math.max(24, rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#03060F';
    ctx.fillRect(0, 0, w, h);

    if (isDrums) {
      const laneOrder: Record<DrumPieceRole, { yNorm: number; color: string }> = {
        crash: { yNorm: 0.12, color: '#EC4899' },
        hat: { yNorm: 0.31, color: '#F59E0B' },
        tom: { yNorm: 0.5, color: '#10B981' },
        snare: { yNorm: 0.69, color: '#00E5FF' },
        kick: { yNorm: 0.88, color: '#FF6B00' },
      };
      for (const hit of r.analysis.drumHits) {
        const x = (hit.peakTimeSec / duration) * w;
        const info = laneOrder[hit.role];
        const y = info.yNorm * h;
        ctx.fillStyle = info.color;
        ctx.fillRect(x - 0.8, y - 2, 1.8, 4);
      }
    } else {
      const minM = r.analysis.midiRange?.minMidi ?? 36;
      const maxM = Math.max(minM + 12, r.analysis.midiRange?.maxMidi ?? 72);
      const spanM = maxM - minM;
      for (const ev of r.analysis.noteEvents) {
        const x0 = (ev.startSec / duration) * w;
        const bw = Math.max(2, (ev.durationSec / duration) * w);
        const y = h - 3 - ((ev.midiNote - minM) / spanM) * (h - 6);
        ctx.fillStyle =
          ev.midiNote < 50 ? '#FF6B00' : ev.midiNote < 64 ? '#00E5FF' : '#10B981';
        ctx.fillRect(x0, y - 1, bw, 2.2);
      }
    }
  }, [r.analysis, duration, isDrums, editorSizeMode, minimapResizeTick]);

  // 2D Drag-to-Pan Handlers (Middle-Click, Alt+Drag, or Pan Tool)
  const begin2DPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const isMiddle = e.button === 1;
    const isPanTrigger = isMiddle || editTool === 'pan' || (e.button === 0 && e.altKey);
    if (!isPanTrigger) return;
    e.preventDefault();
    e.stopPropagation();
    const el = verticalScrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const headerOffset = isDrums ? (window.innerWidth >= 640 ? 256 : 208) : 96;
    pan2DRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startScrollNorm: clampScrollNorm(viewStartSec / Math.max(0.001, duration)),
      startScrollTop: el.scrollTop,
      laneWidth: Math.max(120, rect.width - headerOffset),
    };
    setIsPanning2D(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move2DPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = pan2DRef.current;
    if (!st || !st.active) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (zoom > 1.01 && Math.abs(dx) > 1) {
      const normDelta = -(dx / st.laneWidth) * (1 / zoom);
      setScrollNorm(clampScrollNorm(st.startScrollNorm + normDelta));
      notifyManualHorizontalScroll();
    }
    const el = verticalScrollRef.current;
    if (el && el.scrollHeight > el.clientHeight) {
      el.scrollTop = Math.max(
        0,
        Math.min(el.scrollHeight - el.clientHeight, st.startScrollTop - dy)
      );
      syncVerticalMetrics();
    }
  };

  const end2DPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pan2DRef.current?.active) return;
    pan2DRef.current = null;
    setIsPanning2D(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // Vertical Minimap Scrollbar Pointer Handlers (Drag Vertical Thumb + Drag Top/Bottom Edges for V-Zoom!)
  const vMaxScroll = Math.max(0, vScrollMetrics.scrollHeight - vScrollMetrics.clientHeight);
  const vThumbHeightPct = Math.max(
    14,
    Math.min(100, (vScrollMetrics.clientHeight / Math.max(1, vScrollMetrics.scrollHeight)) * 100)
  );
  const vThumbTopPct =
    vMaxScroll > 1
      ? (vScrollMetrics.scrollTop / vMaxScroll) * (100 - vThumbHeightPct)
      : 0;

  const onVBarPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'track' | 'move' | 'top' | 'bottom'
  ) => {
    const el = verticalScrollRef.current;
    const track = vScrollbarTrackRef.current;
    if (!el || !track) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = track.getBoundingClientRect();
    const trackH = Math.max(60, rect.height);

    if (mode === 'track') {
      const clickNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / trackH));
      const maxS = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top: clickNorm * maxS, behavior: 'smooth' });
      return;
    }

    vBarDragRef.current = {
      mode,
      startClientY: e.clientY,
      startScrollTop: el.scrollTop,
      startVerticalZoom: verticalZoom,
      trackHeight: trackH,
      scrollHeight: Math.max(1, el.scrollHeight),
      clientHeight: Math.max(1, el.clientHeight),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onVBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = vBarDragRef.current;
    const el = verticalScrollRef.current;
    if (!st || !el) return;
    const dy = e.clientY - st.startClientY;

    if (st.mode === 'move') {
      const maxS = Math.max(0, st.scrollHeight - st.clientHeight);
      if (maxS <= 0) return;
      const usableTrackPx = Math.max(
        16,
        st.trackHeight * (1 - st.clientHeight / Math.max(1, st.scrollHeight))
      );
      const nextTop = Math.max(0, Math.min(maxS, st.startScrollTop + (dy / usableTrackPx) * maxS));
      el.scrollTop = nextTop;
      syncVerticalMetrics();
    } else if (st.mode === 'bottom' || st.mode === 'top') {
      // Dragging vertical thumb edge adjusts Vertical Zoom (pulling smaller = zoom in taller lanes!)
      const sign = st.mode === 'bottom' ? -1 : 1;
      const scaleFactor = Math.pow(2, (dy * sign) / 95);
      const nextVz = Math.max(0.65, Math.min(2.6, st.startVerticalZoom * scaleFactor));
      setVerticalZoom(Number(nextVz.toFixed(3)));
    }
  };

  const onVBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!vBarDragRef.current) return;
    vBarDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  if (!r.analysis || duration <= 0) return null;

  return (
    <div
      className={`rounded-2xl border border-slate-800/90 bg-[#050914] overflow-hidden flex flex-col shadow-[0_12px_36px_rgba(0,0,0,0.55)] ${
        editorSizeMode === 'fullscreen' ? 'flex-1 min-h-[360px]' : 'shrink-0'
      }`}
    >
      {/* WORKSTATION TOP TOOLBAR (Tools · Drum 5/9 View · Vertical Zoom · Auto-Follow) */}
      <div className="shrink-0 px-4 py-2 bg-slate-950 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-2.5 text-[11px] font-mono">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[#00E5FF] font-bold tracking-tight">
            {isDrums
              ? `🎹 EDITOR MIDI BATERÍA (${r.analysis.counts.total} GOLPES)`
              : `🎹 PIANO ROLL MIDI (${r.analysis.counts.notes} NOTAS)`}
          </span>

          {isDrums && (
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setDrumLaneMode('5-buses')}
                className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  drumLaneMode === '5-buses'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Vista agrupada en 5 buses principales"
              >
                5 Buses
              </button>
              <button
                type="button"
                onClick={() => setDrumLaneMode('9-gm')}
                className={`px-2 py-0.5 rounded font-bold flex items-center gap-1 cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  drumLaneMode === '9-gm'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Expande las 9 piezas GM independientes (Crash, Ride, Open Hat, Closed Hat, High Tom, Mid Tom, Floor Tom, Snare, Kick) con scroll vertical"
              >
                <Layers size={10} />
                <span>9 Piezas GM</span>
              </button>
            </div>
          )}

          {isDrums && r.soloDrumRole && (
            <button
              type="button"
              onClick={() => r.toggleSoloDrumRole(r.soloDrumRole!)}
              className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black text-[10px] cursor-pointer animate-pulse"
              title="Quitar modo SOLO y escuchar todas las piezas"
            >
              ● SOLO: {r.soloDrumRole.toUpperCase()} ✕
            </button>
          )}
        </div>

        {/* Editing Tools + Vertical Zoom Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setEditTool('select')}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                editTool === 'select'
                  ? 'bg-[#00E5FF] text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Seleccionar, inspeccionar y editar golpes/notas (Doble clic en espacio vacío para añadir)"
            >
              <MousePointer size={11} />
              <span>Editar</span>
            </button>

            <button
              type="button"
              onClick={() => setEditTool('add')}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                editTool === 'add'
                  ? 'bg-emerald-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Clic en cualquier carril para insertar un golpe o nota MIDI"
            >
              <Pencil size={11} />
              <span>+ Añadir</span>
            </button>

            {isDrums && (
              <button
                type="button"
                onClick={() => setEditTool('convert-tom-kick')}
                className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  editTool === 'convert-tom-kick'
                    ? 'bg-[#FF6B00] text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Conversión rápida 1-Clic: convierte Kick ↔ Tom con un clic"
              >
                <ArrowLeftRight size={11} />
                <span>Kick↔Tom</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setEditTool('pan')}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                editTool === 'pan'
                  ? 'bg-violet-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Arrastra en cualquier dirección (Horizontal + Vertical) dentro del editor MIDI (también funciona con botón central del ratón o Alt+Arrastrar)"
            >
              <Hand size={11} />
              <span>Pan 2D</span>
            </button>

            <button
              type="button"
              onClick={() => setEditTool('erase')}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                editTool === 'erase'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Clic sobre cualquier golpe o nota para borrarlo"
            >
              <Trash2 size={11} />
              <span>Borrar</span>
            </button>
          </div>

          {isDrums && (
            <div className="flex items-center gap-1 bg-slate-900 border border-emerald-500/40 rounded-xl px-2 py-1 text-[10px]">
              <span className="text-emerald-400 font-bold">Tom:</span>
              <select
                value={tomInsertArticulation}
                onChange={(e) =>
                  setTomInsertArticulation(
                    e.target.value as 'floor-tom' | 'mid-tom' | 'high-tom'
                  )
                }
                className="bg-transparent text-white font-bold focus:outline-none cursor-pointer"
              >
                <option value="floor-tom" className="bg-slate-950">
                  Floor (43)
                </option>
                <option value="mid-tom" className="bg-slate-950">
                  Mid (47)
                </option>
                <option value="high-tom" className="bg-slate-950">
                  High (50)
                </option>
              </select>
            </div>
          )}

          {/* Vertical Zoom Control (V-Zoom) */}
          <div
            className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl px-2 py-1 text-[10px]"
            title="Zoom Vertical de altura de carriles (también Alt + Rueda del ratón o arrastrar bordes del scroll vertical)"
          >
            <span className="text-slate-400 font-bold">Alto V:</span>
            <button
              type="button"
              onClick={() =>
                setVerticalZoom((v) => Number(Math.max(0.65, v / 1.18).toFixed(3)))
              }
              className="px-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
            >
              −
            </button>
            <span className="text-[#00E5FF] font-bold tabular-nums w-8 text-center">
              {Math.round(verticalZoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() =>
                setVerticalZoom((v) => Number(Math.min(2.6, v * 1.18).toFixed(3)))
              }
              className="px-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* PINNED TOP MUSICAL BAR & BEAT RULER (Aligned 1:1 with Lanes & Right Vertical Scrollbar) */}
      <div className="flex items-stretch h-7 bg-[#070C1A] border-b border-slate-800/90 text-[10px] font-mono select-none shrink-0">
        <div
          className={`${
            isDrums ? 'w-52 sm:w-64' : 'w-24 sm:w-28'
          } shrink-0 px-3 border-r border-slate-800 flex items-center justify-between text-slate-400`}
        >
          <span className="font-bold text-slate-300 truncate">
            {isDrums ? 'PISTA / MIX' : 'NOTAS'}
          </span>
          {isDrums && <span className="text-[9px] text-slate-500">M · S · 🔊</span>}
        </div>

        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const norm = Math.max(
              0,
              Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
            );
            r.seekToSec(viewStartSec + norm * viewSpanSec);
          }}
          className="relative flex-1 overflow-hidden cursor-pointer"
          title="Regla de Compases y Tiempo · Clic para saltar al segundo exacto"
        >
          {visibleGridLines.map((gl, idx) => (
            <div
              key={`ruler-g-${idx}`}
              style={{ left: `${gl.leftPct}%` }}
              className={`absolute top-0 bottom-0 pointer-events-none ${
                gl.isDownbeat
                  ? 'border-l border-[#00E5FF]/55'
                  : 'border-l border-slate-800/75'
              }`}
            >
              {gl.isDownbeat && gl.barNum !== undefined && (
                <span className="pl-1.5 text-[9.5px] font-bold text-[#00E5FF] tabular-nums">
                  C{gl.barNum}
                </span>
              )}
              {!gl.isDownbeat && zoom >= 2.2 && (
                <span className="pl-1 text-[8.5px] text-slate-500 tabular-nums">
                  .{gl.beatInBar}
                </span>
              )}
            </div>
          ))}
          {r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec && (
            <div
              style={{
                left: `${((r.currentTimeSec - viewStartSec) / viewSpanSec) * 100}%`,
              }}
              className="absolute top-0 bottom-0 w-0.5 bg-white z-20 pointer-events-none"
            />
          )}
        </div>

        {/* Right Top Corner above Vertical Scrollbar */}
        <div className="w-7 shrink-0 border-l border-slate-800 bg-slate-950 flex items-center justify-center text-[9px] text-slate-500 font-bold">
          V
        </div>
      </div>

      {/* MAIN SCROLLABLE MIDI GRID VIEWPORT + ADVANCED RIGHT VERTICAL MINIMAP SCROLLBAR */}
      <div className={`flex items-stretch ${viewportHeightClass} overflow-hidden relative`}>
        {/* Left + Center Vertically Scrollable Lanes Container */}
        <div
          ref={verticalScrollRef}
          onScroll={syncVerticalMetrics}
          onPointerDown={begin2DPan}
          onPointerMove={move2DPan}
          onPointerUp={end2DPan}
          onPointerCancel={end2DPan}
          style={{ scrollbarWidth: 'none' }}
          className={`flex-1 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden select-none ${
            isPanning2D
              ? 'cursor-grabbing'
              : editTool === 'pan'
              ? 'cursor-grab'
              : ''
          }`}
        >
          {isDrums ? (
            <div className="divide-y divide-slate-800/80">
              {activeDrumLanes.map((lane) => {
                const slot = r.drumSlots[lane.role];
                const isSolo = r.soloDrumRole === lane.role;
                const isMutedByOtherSolo =
                  r.soloDrumRole !== null && r.soloDrumRole !== lane.role;
                const laneAllHits = r.analysis!.drumHits.filter(lane.matchHit);
                const visibleLaneHits = laneAllHits.filter(
                  (h) =>
                    h.peakTimeSec >= viewStartSec - 0.03 &&
                    h.peakTimeSec <= viewEndSec + 0.03
                );

                return (
                  <div
                    key={lane.id}
                    style={{ height: `${laneHeightPx}px` }}
                    className={`flex items-stretch text-[11px] font-mono transition-[opacity] duration-150 ${
                      !slot.enabled || isMutedByOtherSolo ? 'opacity-45' : ''
                    }`}
                  >
                    {/* Left Track Controls */}
                    <div className="w-52 sm:w-64 shrink-0 px-3 bg-slate-950/95 border-r border-slate-800 flex flex-col justify-center gap-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor: slot.enabled ? lane.color : '#475569',
                            }}
                          />
                          <span className="font-bold text-white truncate tracking-tight text-[10.5px]">
                            {lane.title}
                          </span>
                        </div>
                        <span
                          style={{
                            borderColor: `${lane.color}55`,
                            color: lane.color,
                          }}
                          className="px-1.5 py-0.2 rounded bg-slate-900 border text-[9.5px] font-bold tabular-nums shrink-0"
                        >
                          {laneAllHits.length}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              r.updateDrumSlot(lane.role, { enabled: !slot.enabled })
                            }
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black border cursor-pointer transition-colors ${
                              slot.enabled
                                ? 'bg-slate-900 border-slate-700 text-emerald-300 hover:border-emerald-400'
                                : 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                            }`}
                            title={`Activar/Silenciar ${lane.title}`}
                          >
                            {slot.enabled ? 'ON' : 'MUTE'}
                          </button>
                          <button
                            type="button"
                            onClick={() => r.toggleSoloDrumRole(lane.role)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black border cursor-pointer transition-colors ${
                              isSolo
                                ? 'bg-amber-400 border-amber-300 text-slate-950'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-amber-300'
                            }`}
                            title={`SOLO ${lane.role.toUpperCase()}`}
                          >
                            S
                          </button>
                          <button
                            type="button"
                            onClick={() => r.auditionSlotSample(slot)}
                            className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[#00E5FF] cursor-pointer"
                            title={`Probar sonido de ${lane.title}`}
                          >
                            <Volume2 size={9.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRequestUploadForRole(lane.role)}
                            className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[9px] font-bold flex items-center gap-0.5 cursor-pointer"
                            title={`Subir tu propio sample para ${lane.title}`}
                          >
                            <Upload size={8.5} />
                            <span className="hidden sm:inline">Sample</span>
                          </button>
                        </div>
                        <span className="text-[8.5px] text-slate-500 truncate max-w-[74px]">
                          {slot.sourceType !== 'preset' && slot.customName
                            ? `★ ${slot.customName}`
                            : lane.gmHint}
                        </span>
                      </div>
                    </div>

                    {/* Right Interactive Drum Lane */}
                    <div
                      onClick={(e) => {
                        if (editTool === 'pan') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const norm = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const clickedSec = viewStartSec + norm * viewSpanSec;
                        if (editTool === 'add') {
                          const art = lane.isSubLane
                            ? lane.defaultArticulation
                            : lane.role === 'tom'
                            ? tomInsertArticulation
                            : lane.defaultArticulation;
                          const added = r.addManualDrumHit(lane.role, clickedSec, 0.88, art);
                          if (added) {
                            setSelectedHitId(added.id);
                            r.auditionDrumHit(added);
                          }
                        } else {
                          r.seekToSec(clickedSec);
                        }
                      }}
                      onDoubleClick={(e) => {
                        if (editTool === 'pan') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const norm = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const clickedSec = viewStartSec + norm * viewSpanSec;
                        const art = lane.isSubLane
                          ? lane.defaultArticulation
                          : lane.role === 'tom'
                          ? tomInsertArticulation
                          : lane.defaultArticulation;
                        const added = r.addManualDrumHit(lane.role, clickedSec, 0.88, art);
                        if (added) {
                          setSelectedHitId(added.id);
                          r.auditionDrumHit(added);
                        }
                      }}
                      className={`relative flex-1 bg-[#040711] hover:bg-[#060B19] overflow-hidden transition-colors ${
                        editTool === 'pan'
                          ? isPanning2D
                            ? 'cursor-grabbing'
                            : 'cursor-grab'
                          : editTool === 'add'
                          ? 'cursor-crosshair'
                          : 'cursor-pointer'
                      }`}
                    >
                      {/* Beat & Downbeat Grid Lines */}
                      {visibleGridLines.map((gl, idx) => (
                        <div
                          key={`${lane.id}-g-${idx}`}
                          style={{ left: `${gl.leftPct}%` }}
                          className={`absolute top-0 bottom-0 pointer-events-none ${
                            gl.isDownbeat
                              ? 'border-l border-[#00E5FF]/28'
                              : 'border-l border-slate-800/45'
                          }`}
                        />
                      ))}

                      {/* Velocity Reference Midline (50% velocity guide when zoomed tall) */}
                      {laneHeightPx >= 70 && (
                        <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-slate-800/50 pointer-events-none" />
                      )}

                      {/* Sub-Tier Guide Rows in 5-Bus mode for TOMS */}
                      {!lane.isSubLane && lane.role === 'tom' && laneHeightPx >= 64 && (
                        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between py-1 px-2 text-[8.5px] font-mono text-emerald-400/35">
                          <div className="border-b border-dashed border-emerald-500/15 pb-0.5">
                            HIGH TOM (GM 50 · +3st)
                          </div>
                          <div className="border-b border-dashed border-emerald-500/15 pb-0.5">
                            MID TOM (GM 47 · 0st)
                          </div>
                          <div>FLOOR TOM (GM 43 · -3st)</div>
                        </div>
                      )}

                      {/* Playhead */}
                      {r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec && (
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-white/95 pointer-events-none z-20 shadow-[0_0_8px_rgba(255,255,255,0.75)]"
                          style={{
                            left: `${((r.currentTimeSec - viewStartSec) / viewSpanSec) * 100}%`,
                          }}
                        />
                      )}

                      {/* Drum Hit Nodes */}
                      {visibleLaneHits.map((hit) => {
                        const leftPct = ((hit.peakTimeSec - viewStartSec) / viewSpanSec) * 100;
                        const heightPct = Math.max(36, Math.round(hit.velocity * 92));
                        const isSelected = hit.id === selectedHitId;
                        const shortBadge =
                          hit.role === 'tom'
                            ? hit.articulation === 'high-tom' || hit.midiNote === 50
                              ? 'H'
                              : hit.articulation === 'floor-tom' ||
                                hit.midiNote === 43 ||
                                hit.midiNote === 41
                              ? 'F'
                              : 'M'
                            : hit.role === 'hat'
                            ? hit.articulation === 'open' || hit.midiNote === 46
                              ? 'OH'
                              : 'HH'
                            : hit.role === 'crash'
                            ? hit.articulation === 'ride' || hit.midiNote === 51
                              ? 'RD'
                              : 'CR'
                            : hit.role === 'kick'
                            ? 'K'
                            : 'S';

                        return (
                          <button
                            key={hit.id}
                            type="button"
                            onClick={(e) => {
                              if (editTool === 'pan') return;
                              e.stopPropagation();
                              if (editTool === 'erase') {
                                r.removeDrumHit(hit.id);
                                if (selectedHitId === hit.id) setSelectedHitId(null);
                                return;
                              }
                              if (editTool === 'convert-tom-kick') {
                                if (hit.role === 'kick') {
                                  r.updateDrumHit(hit.id, {
                                    role: 'tom',
                                    articulation: tomInsertArticulation,
                                  });
                                } else if (hit.role === 'tom') {
                                  r.updateDrumHit(hit.id, {
                                    role: 'kick',
                                    midiNote: 36,
                                    articulation: 'closed',
                                  });
                                } else {
                                  r.updateDrumHit(hit.id, {
                                    role: 'tom',
                                    articulation: tomInsertArticulation,
                                  });
                                }
                                setSelectedHitId(hit.id);
                                return;
                              }
                              setSelectedHitId(hit.id);
                              r.seekToSec(hit.peakTimeSec);
                              r.auditionDrumHit(hit);
                            }}
                            style={{
                              left: `${leftPct}%`,
                              height: `${heightPct}%`,
                              backgroundColor: isSelected ? '#FFFFFF' : lane.color,
                              boxShadow: isSelected
                                ? `0 0 16px ${lane.color}`
                                : `0 2px 6px rgba(0,0,0,0.45)`,
                            }}
                            className={`absolute bottom-1 -translate-x-1/2 min-w-[15px] sm:min-w-[19px] px-1 rounded-t-md flex flex-col items-center justify-between py-0.5 cursor-pointer transition-[transform,background-color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                              isSelected
                                ? 'ring-2 ring-white scale-110 z-30 text-slate-950'
                                : 'hover:brightness-125 hover:scale-110 z-10 text-slate-950'
                            }`}
                            title={`${hit.subRoleLabel || lane.title} · ${hit.peakTimeSec.toFixed(
                              3
                            )}s · Vel ${Math.round(hit.velocity * 100)}%`}
                          >
                            <span className="text-[8.5px] font-black leading-none tracking-tighter">
                              {shortBadge}
                            </span>
                            {laneHeightPx >= 86 && (
                              <span className="text-[7.5px] font-bold opacity-80 leading-none tabular-nums">
                                {Math.round(hit.velocity * 100)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* MELODIC / POLYPHONIC CHROMATIC MIDI PIANO ROLL WITH FULL HORIZONTAL & VERTICAL SCROLL */
            <div className="divide-y divide-slate-800/40">
              {melodicRows.map((midiNote) => {
                const black = isBlackKey(midiNote);
                const isC = midiNote % 12 === 0;
                const rowNotes = r.analysis!.noteEvents.filter(
                  (n) =>
                    n.midiNote === midiNote &&
                    n.startSec + n.durationSec >= viewStartSec - 0.02 &&
                    n.startSec <= viewEndSec + 0.02
                );

                return (
                  <div
                    key={`pr-row-${midiNote}`}
                    style={{ height: `${laneHeightPx}px` }}
                    className="flex items-stretch text-[10px] font-mono"
                  >
                    {/* Left Chromatic Piano Key Header */}
                    <button
                      type="button"
                      onClick={() => r.auditionMelodicNote(midiNote, 0.85)}
                      className={`w-24 sm:w-28 shrink-0 px-2 border-r border-slate-800 flex items-center justify-between cursor-pointer transition-colors ${
                        black
                          ? 'bg-slate-950 text-slate-400 hover:bg-slate-800'
                          : isC
                          ? 'bg-slate-800/90 text-[#00E5FF] font-bold hover:bg-slate-700'
                          : 'bg-slate-900/90 text-slate-200 hover:bg-slate-800'
                      }`}
                      title={`Escuchar nota ${midiNoteToName(midiNote)} (MIDI ${midiNote})`}
                    >
                      <span>{midiNoteToName(midiNote)}</span>
                      <span className="text-[8.5px] opacity-60 tabular-nums">{midiNote}</span>
                    </button>

                    {/* Right Piano Roll Grid Lane */}
                    <div
                      onClick={(e) => {
                        if (editTool === 'pan') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const norm = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const clickedSec = viewStartSec + norm * viewSpanSec;
                        if (editTool === 'add') {
                          const stepSec = 60 / Math.max(40, r.analysis!.bpm || 120) / 2;
                          const added = r.addManualMelodicNote(midiNote, clickedSec, stepSec, 0.86);
                          if (added) {
                            setSelectedNoteId(added.id);
                            r.auditionMelodicNote(midiNote, 0.86);
                          }
                        } else {
                          r.seekToSec(clickedSec);
                        }
                      }}
                      onDoubleClick={(e) => {
                        if (editTool === 'pan') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const norm = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const clickedSec = viewStartSec + norm * viewSpanSec;
                        const stepSec = 60 / Math.max(40, r.analysis!.bpm || 120) / 2;
                        const added = r.addManualMelodicNote(midiNote, clickedSec, stepSec, 0.86);
                        if (added) {
                          setSelectedNoteId(added.id);
                          r.auditionMelodicNote(midiNote, 0.86);
                        }
                      }}
                      className={`relative flex-1 overflow-hidden ${
                        black ? 'bg-[#03060E]' : isC ? 'bg-[#081022]' : 'bg-[#050915]'
                      } ${
                        editTool === 'pan'
                          ? isPanning2D
                            ? 'cursor-grabbing'
                            : 'cursor-grab'
                          : editTool === 'add'
                          ? 'cursor-crosshair'
                          : 'cursor-pointer'
                      }`}
                    >
                      {visibleGridLines.map((gl, idx) => (
                        <div
                          key={`pr-${midiNote}-g-${idx}`}
                          style={{ left: `${gl.leftPct}%` }}
                          className={`absolute top-0 bottom-0 pointer-events-none ${
                            gl.isDownbeat
                              ? 'border-l border-[#00E5FF]/24'
                              : 'border-l border-slate-800/40'
                          }`}
                        />
                      ))}

                      {r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec && (
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none z-20"
                          style={{
                            left: `${((r.currentTimeSec - viewStartSec) / viewSpanSec) * 100}%`,
                          }}
                        />
                      )}

                      {rowNotes.map((ev: StemNoteEvent) => {
                        const leftPct = Math.max(
                          0,
                          ((ev.startSec - viewStartSec) / viewSpanSec) * 100
                        );
                        const rightPct = Math.min(
                          100,
                          ((ev.startSec + ev.durationSec - viewStartSec) / viewSpanSec) * 100
                        );
                        const widthPct = Math.max(0.8, rightPct - leftPct);
                        const isSel = ev.id === selectedNoteId;
                        const noteColor =
                          ev.midiNote < 50 ? '#FF6B00' : ev.midiNote < 64 ? '#00E5FF' : '#10B981';

                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={(e) => {
                              if (editTool === 'pan') return;
                              e.stopPropagation();
                              if (editTool === 'erase') {
                                r.removeMelodicNote(ev.id);
                                if (selectedNoteId === ev.id) setSelectedNoteId(null);
                                return;
                              }
                              setSelectedNoteId(ev.id);
                              r.seekToSec(ev.startSec);
                              r.auditionMelodicNote(ev.midiNote, ev.velocity);
                            }}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              backgroundColor: isSel ? '#FFFFFF' : noteColor,
                            }}
                            className={`absolute top-0.5 bottom-0.5 rounded px-1 text-[8.5px] font-black text-slate-950 truncate flex items-center cursor-pointer transition-[transform,background-color] duration-150 ${
                              isSel ? 'ring-2 ring-white z-30' : 'hover:brightness-125 z-10'
                            }`}
                            title={`${ev.noteName} · ${ev.startSec.toFixed(2)}s · dur ${ev.durationSec.toFixed(
                              2
                            )}s · Vel ${Math.round(ev.velocity * 100)}%`}
                          >
                            {ev.noteName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ADVANCED RIGHT VERTICAL MINIMAP SCROLLBAR (Drag to Scroll · Drag Top/Bottom Edges to V-Zoom) */}
        <div className="w-7 shrink-0 bg-slate-950 border-l border-slate-800 flex flex-col items-center select-none">
          <button
            type="button"
            onClick={() =>
              verticalScrollRef.current?.scrollBy({ top: -laneHeightPx * 1.5, behavior: 'smooth' })
            }
            className="w-full h-5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-900 border-b border-slate-800/80 cursor-pointer shrink-0"
            title="Desplazar pistas hacia arriba"
          >
            <ChevronUp size={12} />
          </button>

          <div
            ref={vScrollbarTrackRef}
            onPointerDown={(e) => onVBarPointerDown(e, 'track')}
            className="relative flex-1 w-full bg-[#03060F] cursor-pointer overflow-hidden"
            title="Scroll Vertical Avanzado · Arrastra la barra para subir/bajar o arrastra sus bordes superior/inferior para Zoom Vertical"
          >
            {/* Vertical Lane/Pitch Minimap Color Bands */}
            {isDrums ? (
              <div className="absolute inset-0 flex flex-col pointer-events-none opacity-45">
                {activeDrumLanes.map((l) => (
                  <div
                    key={`vmin-${l.id}`}
                    className="flex-1 w-full border-b border-slate-950/60"
                    style={{ backgroundColor: `${l.color}38` }}
                  />
                ))}
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col pointer-events-none opacity-35">
                {melodicRows.map((m) => (
                  <div
                    key={`vpm-${m}`}
                    className="flex-1 w-full"
                    style={{
                      backgroundColor:
                        m % 12 === 0
                          ? 'rgba(0,229,255,0.45)'
                          : isBlackKey(m)
                          ? 'rgba(15,23,42,0.5)'
                          : 'transparent',
                    }}
                  />
                ))}
              </div>
            )}

            {/* Draggable & Edge-Resizable Vertical Viewport Thumb */}
            <div
              onPointerDown={(e) => onVBarPointerDown(e, 'move')}
              onPointerMove={onVBarPointerMove}
              onPointerUp={onVBarPointerUp}
              onPointerCancel={onVBarPointerUp}
              style={{
                top: `${vThumbTopPct}%`,
                height: `${vThumbHeightPct}%`,
              }}
              className="absolute left-0.5 right-0.5 rounded-md bg-[#00E5FF]/28 hover:bg-[#00E5FF]/40 border border-[#00E5FF]/80 shadow-[0_0_10px_rgba(0,229,255,0.22)] cursor-grab active:cursor-grabbing flex flex-col justify-between"
            >
              {/* Top V-Zoom Resize Handle */}
              <div
                onPointerDown={(e) => onVBarPointerDown(e, 'top')}
                onPointerMove={onVBarPointerMove}
                onPointerUp={onVBarPointerUp}
                onPointerCancel={onVBarPointerUp}
                className="w-full h-2 cursor-ns-resize flex items-center justify-center group"
                title="Arrastra para Zoom Vertical (altura de pistas)"
              >
                <span className="w-3 h-[2px] rounded-full bg-[#00E5FF] group-hover:bg-white" />
              </div>

              {/* Center Grip */}
              <div className="w-full flex flex-col items-center gap-[2px] pointer-events-none opacity-75">
                <span className="w-2.5 h-[1px] bg-white/80" />
                <span className="w-2.5 h-[1px] bg-white/80" />
              </div>

              {/* Bottom V-Zoom Resize Handle */}
              <div
                onPointerDown={(e) => onVBarPointerDown(e, 'bottom')}
                onPointerMove={onVBarPointerMove}
                onPointerUp={onVBarPointerUp}
                onPointerCancel={onVBarPointerUp}
                className="w-full h-2 cursor-ns-resize flex items-center justify-center group"
                title="Arrastra para Zoom Vertical (altura de pistas)"
              >
                <span className="w-3 h-[2px] rounded-full bg-[#00E5FF] group-hover:bg-white" />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              verticalScrollRef.current?.scrollBy({ top: laneHeightPx * 1.5, behavior: 'smooth' })
            }
            className="w-full h-5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-900 border-t border-slate-800/80 cursor-pointer shrink-0"
            title="Desplazar pistas hacia abajo"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

      {/* ADVANCED HORIZONTAL MINIMAP SCROLLBAR & ZOOM BAR (Bottom of MIDI Editor — Always Visible & Unclipped) */}
      <div className="shrink-0 flex flex-wrap sm:flex-nowrap items-stretch bg-slate-950 border-t border-slate-800/90 text-[10px] font-mono select-none">
        {/* Left Horizontal Scroll & Follow Controls */}
        <div
          className={`${
            isDrums ? 'sm:w-64' : 'sm:w-44'
          } w-full shrink-0 px-3 py-1.5 sm:border-r border-b sm:border-b-0 border-slate-800 flex items-center justify-between gap-1.5`}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleToggleFollow}
              className={`px-1.5 py-0.5 rounded border text-[9.5px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                autoFollowPlayhead
                  ? 'bg-[#00E5FF]/15 border-[#00E5FF]/60 text-[#00E5FF]'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
              }`}
              title="Desplaza automáticamente el editor horizontalmente para seguir el cabezal durante la reproducción"
            >
              <Crosshair size={10} />
              <span>Seguir</span>
            </button>

            <button
              type="button"
              onClick={() => applyHorizontalZoomAtCursor(zoom / 1.45, 0.5)}
              className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
              title="Alejar Zoom Horizontal"
            >
              <ZoomOut size={11} />
            </button>
            <span className="text-[#00E5FF] font-bold tabular-nums px-0.5">
              {zoom.toFixed(1)}x
            </span>
            <button
              type="button"
              onClick={() => applyHorizontalZoomAtCursor(zoom * 1.45, 0.5)}
              className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
              title="Acercar Zoom Horizontal (Ctrl + Rueda)"
            >
              <ZoomIn size={11} />
            </button>
          </div>

          <span className="text-[9.5px] text-slate-400 tabular-nums shrink-0">
            {formatTime(viewStartSec)}–{formatTime(Math.min(duration, viewEndSec))}
          </span>
        </div>

        {/* Interactive Horizontal MIDI Minimap + High-Visibility Draggable Scrollbar Thumb */}
        <div className="flex-1 flex items-center px-2 py-1.5 min-w-[200px]">
          <TimelineHorizontalScrollbar
            duration={duration}
            zoom={zoom}
            viewStartSec={viewStartSec}
            viewEndSec={viewEndSec}
            currentTimeSec={r.currentTimeSec}
            onChangeScrollNorm={handleMidiScrollbarChange}
            onChangeZoomAndScroll={handleMidiScrollbarZoomAndScroll}
            onSeekToSec={r.seekToSec}
            accent="cyan"
            trackHeightClass="h-8"
            ariaLabel="Scroll horizontal del Editor MIDI"
            trackTitle="Barra y Minimapa MIDI Horizontal · Arrastra para moverte por toda la canción, arrastra bordes para Zoom Horizontal o doble clic para 1x/4x"
            overviewContent={
              <canvas
                ref={hMinimapCanvasRef}
                className="w-full h-full block pointer-events-none opacity-90"
              />
            }
          />
        </div>

        {/* Bottom-Right Corner aligned with Right Vertical Scrollbar */}
        <div className="hidden sm:flex w-7 shrink-0 border-l border-slate-800 bg-slate-950 items-center justify-center">
          {zoom > 1.05 ? (
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setScrollNorm(0);
              }}
              className="text-[8.5px] font-bold text-[#00E5FF] hover:text-white cursor-pointer"
              title="Restablecer Zoom Horizontal a 1x (ver canción completa)"
            >
              1x
            </button>
          ) : (
            <span className="text-[9px] text-slate-500 font-bold" title="Scroll Horizontal">
              H
            </span>
          )}
        </div>
      </div>

      {/* LIVE SELECTED HIT / NOTE INSPECTOR BAR */}
      <div className="shrink-0 px-4 py-2 bg-slate-950/95 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
        {isDrums && selectedHit ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] font-bold tabular-nums">
                🎯 {selectedHit.subRoleLabel || selectedHit.role.toUpperCase()} ·{' '}
                {selectedHit.peakTimeSec.toFixed(3)}s
              </span>
              <span className="text-slate-400">Mover a:</span>
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { label: 'Kick (36)', role: 'kick', midiNote: 36, art: 'closed', color: '#FF6B00' },
                    { label: 'Floor Tom (43)', role: 'tom', midiNote: 43, art: 'floor-tom', color: '#10B981' },
                    { label: 'Mid Tom (47)', role: 'tom', midiNote: 47, art: 'mid-tom', color: '#10B981' },
                    { label: 'High Tom (50)', role: 'tom', midiNote: 50, art: 'high-tom', color: '#10B981' },
                    { label: 'Snare (38)', role: 'snare', midiNote: 38, art: 'closed', color: '#00E5FF' },
                    { label: 'Hi-Hat (42)', role: 'hat', midiNote: 42, art: 'closed', color: '#F59E0B' },
                    { label: 'Open Hat (46)', role: 'hat', midiNote: 46, art: 'open', color: '#F59E0B' },
                    { label: 'Crash (49)', role: 'crash', midiNote: 49, art: 'crash', color: '#EC4899' },
                    { label: 'Ride (51)', role: 'crash', midiNote: 51, art: 'ride', color: '#F472B6' },
                  ] as Array<{
                    label: string;
                    role: DrumPieceRole;
                    midiNote: number;
                    art: DrumArticulation;
                    color: string;
                  }>
                ).map((opt) => {
                  const isCur =
                    selectedHit.role === opt.role && (selectedHit.midiNote ?? 0) === opt.midiNote;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() =>
                        r.updateDrumHit(selectedHit.id, {
                          role: opt.role,
                          midiNote: opt.midiNote,
                          articulation: opt.art,
                        })
                      }
                      style={
                        isCur
                          ? { backgroundColor: opt.color, borderColor: opt.color, color: '#020617' }
                          : { borderColor: `${opt.color}55` }
                      }
                      className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold cursor-pointer transition-all duration-150 ${
                        isCur ? 'shadow-sm scale-105' : 'bg-slate-900 text-slate-200 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2 py-0.5">
                <span className="text-slate-400 text-[10px]">Fuerza:</span>
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.02}
                  value={selectedHit.velocity}
                  onChange={(e) =>
                    r.updateDrumHit(selectedHit.id, { velocity: Number(e.target.value) })
                  }
                  className="w-16 accent-[#00E5FF] h-1 cursor-pointer"
                />
                <span className="text-white font-bold tabular-nums text-[10px]">
                  {Math.round(selectedHit.velocity * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() =>
                    r.updateDrumHit(selectedHit.id, { timeSec: selectedHit.timeSec - 0.01 })
                  }
                  className="px-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 cursor-pointer"
                >
                  -10ms
                </button>
                <button
                  type="button"
                  onClick={() =>
                    r.updateDrumHit(selectedHit.id, { timeSec: selectedHit.timeSec + 0.01 })
                  }
                  className="px-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 cursor-pointer"
                >
                  +10ms
                </button>
              </div>

              <button
                type="button"
                onClick={() => r.auditionDrumHit(selectedHit)}
                className="px-2 py-0.5 rounded-lg bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 border border-[#00E5FF]/50 text-[#00E5FF] text-[10px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Headphones size={11} />
                <span>Escuchar</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  r.removeDrumHit(selectedHit.id);
                  setSelectedHitId(null);
                }}
                className="px-2 py-0.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/50 text-rose-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 size={11} />
                <span>Eliminar</span>
              </button>
            </div>
          </>
        ) : !isDrums && selectedMelodicNote ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] font-bold tabular-nums">
                🎵 Nota {selectedMelodicNote.noteName} (MIDI {selectedMelodicNote.midiNote}) ·{' '}
                {selectedMelodicNote.startSec.toFixed(2)}s
              </span>
              <button
                type="button"
                onClick={() => {
                  const nextM = selectedMelodicNote.midiNote - 1;
                  r.updateMelodicNote(selectedMelodicNote.id, { midiNote: nextM });
                  r.auditionMelodicNote(nextM, selectedMelodicNote.velocity);
                }}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[10px] cursor-pointer"
              >
                -1 st
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextM = selectedMelodicNote.midiNote + 1;
                  r.updateMelodicNote(selectedMelodicNote.id, { midiNote: nextM });
                  r.auditionMelodicNote(nextM, selectedMelodicNote.velocity);
                }}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[10px] cursor-pointer"
              >
                +1 st
              </button>
              <button
                type="button"
                onClick={() =>
                  r.updateMelodicNote(selectedMelodicNote.id, {
                    durationSec: selectedMelodicNote.durationSec * 0.8,
                  })
                }
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[10px] cursor-pointer"
              >
                Dur -
              </button>
              <button
                type="button"
                onClick={() =>
                  r.updateMelodicNote(selectedMelodicNote.id, {
                    durationSec: selectedMelodicNote.durationSec * 1.25,
                  })
                }
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[10px] cursor-pointer"
              >
                Dur +
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  r.auditionMelodicNote(selectedMelodicNote.midiNote, selectedMelodicNote.velocity)
                }
                className="px-2 py-0.5 rounded-lg bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] text-[10px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Headphones size={11} />
                <span>Escuchar</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  r.removeMelodicNote(selectedMelodicNote.id);
                  setSelectedNoteId(null);
                }}
                className="px-2 py-0.5 rounded-lg bg-rose-500/15 border border-rose-500/50 text-rose-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Trash2 size={11} />
                <span>Eliminar</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between w-full gap-2 text-slate-400 text-[10px]">
            <span>
              <strong className="text-white">Navegación Avanzada:</strong>{' '}
              <code className="text-[#00E5FF]">Rueda</code> = Scroll Vertical ·{' '}
              <code className="text-[#00E5FF]">Shift+Rueda</code> = Scroll Horizontal ·{' '}
              <code className="text-[#00E5FF]">Ctrl+Rueda</code> = Zoom H ·{' '}
              <code className="text-[#00E5FF]">Alt+Rueda</code> = Zoom V ·{' '}
              <code className="text-[#00E5FF]">Botón Central / Pan 2D</code> = Arrastrar en 2D
            </span>
            {editorSizeMode !== 'fullscreen' && (
              <button
                type="button"
                onClick={() => setEditorSizeMode('fullscreen')}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-[#00E5FF]/50 text-[#00E5FF] font-bold flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Maximize2 size={11} />
                <span>Pantalla Completa DAW</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
