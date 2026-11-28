import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Grid3X3,
  Hand,
  Headphones,
  Layers,
  Magnet,
  Maximize2,
  Minimize2,
  MousePointer,
  Pause,
  Pencil,
  Play,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  buildAdaptiveMidiGrid,
  snapSecToAdaptiveGrid,
  type MidiGridLine,
  type MidiGridResolutionMode,
} from '../engine/adaptiveMidiGrid';
import { midiNoteToName } from '../engine/PitchDetector';
import type { useStemReplacer } from '../hooks/useStemReplacer';
import type {
  DrumArticulation,
  DrumPieceRole,
  StemDrumHitEvent,
  StemNoteEvent,
} from '../types/sampler.types';
import {
  MAX_HORIZONTAL_ZOOM,
  TimelineHorizontalScrollbar,
  clampHorizontalScrollNorm,
  computeAnchoredHorizontalZoom,
} from './TimelineHorizontalScrollbar';

export type { MidiGridLine, MidiGridResolutionMode };

const getLaneGridLineClass = (level: MidiGridLine['level']): string => {
  switch (level) {
    case 'bar':
      return 'border-l-[1.5px] border-white/80';
    case 'beat':
      return 'border-l border-white/45';
    case 'eighth':
      return 'border-l border-white/28';
    case 'sixteenth':
      return 'border-l border-white/20';
    case 'thirtysecond':
      return 'border-l border-white/14';
    case 'sixtyfourth':
      return 'border-l border-white/10';
  }
};

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
    color: '#F472B6',
    defaultArticulation: 'crash',
    matchHit: (h) => h.role === 'crash',
  },
  {
    id: 'bus-hat',
    role: 'hat',
    title: 'HI-HATS',
    shortTag: 'HH',
    gmHint: 'GM 42/46',
    color: '#FBBF24',
    defaultArticulation: 'closed',
    matchHit: (h) => h.role === 'hat',
  },
  {
    id: 'bus-tom',
    role: 'tom',
    title: 'TOMS (H/M/L)',
    shortTag: 'TOM',
    gmHint: 'GM 50/47/43',
    color: '#34D399',
    defaultArticulation: 'floor-tom',
    matchHit: (h) => h.role === 'tom',
  },
  {
    id: 'bus-snare',
    role: 'snare',
    title: 'SNARE / SNAKE',
    shortTag: 'SN',
    gmHint: 'GM 38/37',
    color: '#22D3EE',
    defaultArticulation: 'closed',
    matchHit: (h) => h.role === 'snare',
  },
  {
    id: 'bus-kick',
    role: 'kick',
    title: 'KICK (BOMBO)',
    shortTag: 'KK',
    gmHint: 'GM 36',
    color: '#FB923C',
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
    color: '#F472B6',
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
    color: '#F9A8D4',
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
    color: '#FCD34D',
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
    color: '#6EE7B7',
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
    color: '#34D399',
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
    color: '#10B981',
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
    color: '#22D3EE',
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
    color: '#FB923C',
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

// Strictly linear & monotonic velocity (0.12..1.0) <-> visual heightPct (24%..94%)
// so dragging the bar height up/down tracks the mouse 1:1 with zero dead zones.
const MIN_HIT_VEL = 0.12;
const MAX_HIT_VEL = 1.0;
const MIN_BAR_HEIGHT_PCT = 24;
const MAX_BAR_HEIGHT_PCT = 94;

const velocityToHeightPct = (velocity: number): number => {
  const clamped = Math.max(MIN_HIT_VEL, Math.min(MAX_HIT_VEL, velocity));
  const norm = (clamped - MIN_HIT_VEL) / (MAX_HIT_VEL - MIN_HIT_VEL);
  return Math.round(MIN_BAR_HEIGHT_PCT + norm * (MAX_BAR_HEIGHT_PCT - MIN_BAR_HEIGHT_PCT));
};

interface HitDragSession {
  hitId: string;
  hitSnapshot: StemDrumHitEvent;
  laneId: string;
  initialMode: 'auto' | 'velocity';
  resolvedMode: 'pending' | 'move' | 'velocity';
  startClientX: number;
  startClientY: number;
  startTimeSec: number;
  startPeakTimeSec: number;
  startVelocity: number;
  laneWidth: number;
  laneHeight: number;
  laneBottomY: number;
  viewSpanSecSnapshot: number;
  moved: boolean;
}

interface HitDragPreview {
  hitId: string;
  laneId: string;
  mode: 'move' | 'velocity';
  peakTimeSec: number;
  timeSec: number;
  velocity: number;
  deltaMs: number;
}

interface MelodicNoteDragSession {
  noteId: string;
  noteSnapshot: StemNoteEvent;
  mode: 'move' | 'resize-right';
  startClientX: number;
  startSec: number;
  startDurationSec: number;
  laneWidth: number;
  viewSpanSecSnapshot: number;
  moved: boolean;
}

interface MelodicNoteDragPreview {
  noteId: string;
  mode: 'move' | 'resize-right';
  startSec: number;
  durationSec: number;
  deltaMs: number;
}

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
  showBeatGrid?: boolean;
  gridResolutionMode?: MidiGridResolutionMode;
  onChangeGridResolutionMode?: (mode: MidiGridResolutionMode) => void;
  editorSizeMode: 'compact' | 'large' | 'fullscreen';
  setEditorSizeMode: (mode: 'compact' | 'large' | 'fullscreen') => void;
  selectedHitId: string | null;
  setSelectedHitId: (id: string | null) => void;
  onRequestUploadForRole: (role: DrumPieceRole) => void;
  onRequestBrowseKit1400ForRole?: (role: DrumPieceRole) => void;
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
  showBeatGrid = true,
  gridResolutionMode: controlledGridMode,
  onChangeGridResolutionMode,
  editorSizeMode,
  setEditorSizeMode,
  selectedHitId,
  setSelectedHitId,
  onRequestUploadForRole,
  onRequestBrowseKit1400ForRole,
  autoFollowPlayhead: controlledAutoFollow,
  onToggleAutoFollowPlayhead,
  onManualHorizontalScroll,
}) => {
  const isDrums = r.stemMode === 'drums';
  const isFullscreen = editorSizeMode === 'fullscreen';

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
  const [internalGridMode, setInternalGridMode] = useState<MidiGridResolutionMode>('auto');
  const gridResolutionMode = controlledGridMode ?? internalGridMode;
  const setGridResolutionMode = onChangeGridResolutionMode ?? setInternalGridMode;
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [laneViewportWidthPx, setLaneViewportWidthPx] = useState<number>(960);
  const [minimapResizeTick, setMinimapResizeTick] = useState(0);

  // Vertical Zoom (scales lane height dynamically from 0.65x to 2.6x)
  const [verticalZoom, setVerticalZoom] = useState<number>(1.0);
  const [vScrollMetrics, setVScrollMetrics] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });
  const [isPanning2D, setIsPanning2D] = useState(false);

  // Direct 60fps Drag Preview State for Drum Hits (Move Position + Raise/Lower Volume Height)
  const [hitDragPreview, setHitDragPreview] = useState<HitDragPreview | null>(null);
  const hitDragSessionRef = useRef<HitDragSession | null>(null);
  const hitDragPreviewRef = useRef<HitDragPreview | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);

  // Direct 60fps Drag Preview State for Melodic Piano Roll Notes (Move Start + Resize Duration)
  const [noteDragPreview, setNoteDragPreview] = useState<MelodicNoteDragPreview | null>(null);
  const noteDragSessionRef = useRef<MelodicNoteDragSession | null>(null);
  const noteDragPreviewRef = useRef<MelodicNoteDragPreview | null>(null);

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

  // Lock body scroll while dedicated Fullscreen MIDI Editor portal is open
  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

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
    ? isFullscreen
      ? drumLaneMode === '9-gm'
        ? 78
        : 112
      : editorSizeMode === 'large'
      ? 72
      : 56
    : isFullscreen
    ? 28
    : 22;
  const laneHeightPx = Math.round(
    Math.max(isDrums ? 46 : 16, Math.min(isDrums ? 184 : 46, baseLaneHeightPx * verticalZoom))
  );

  // Fullscreen fills remaining screen height dynamically (`flex-1 min-h-0`); inline modes use clean fixed heights
  const viewportHeightClass = isFullscreen
    ? 'flex-1 min-h-0'
    : editorSizeMode === 'large'
    ? 'h-[404px]'
    : 'h-[272px]';

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
      const clampedZoom = Math.max(1, Math.min(MAX_HORIZONTAL_ZOOM, nextZoomRaw));
      setZoom(clampedZoom);
      setScrollNorm(clampHorizontalScrollNorm(nextScrollNorm, clampedZoom));
      if (isManual) notifyManualHorizontalScroll();
    },
    [setZoom, setScrollNorm, notifyManualHorizontalScroll]
  );

  // Adaptive high-precision white grid computed directly against the actual MIDI lane viewport width
  // so zooming in OR expanding to Large/Fullscreen automatically reveals denser subdivisions (1/8..1/64).
  const adaptiveMidiGrid = useMemo(() => {
    if (!showBeatGrid || duration <= 0) {
      return {
        lines: [] as MidiGridLine[],
        effectiveSubdivisionsPerBeat: 1,
        effectiveResolutionLabel: '1/4',
        pxPerBeat: 0,
      };
    }
    const mem = r.importedMemory;
    const bpm = mem?.bpm ?? r.analysis?.bpm ?? 120;
    const built = buildAdaptiveMidiGrid({
      duration,
      viewStartSec,
      viewEndSec,
      viewportWidthPx: laneViewportWidthPx,
      bpm,
      beatOffsetSec: mem?.beatOffsetSec ?? r.analysis?.beatOffsetSec ?? 0,
      beatTimes: mem?.beatTimes,
      downbeats: mem?.downbeats ?? r.analysis?.downbeats,
      resolutionMode: gridResolutionMode,
    });
    if (built.lines.length === 0 && visibleGridLines.length > 0) {
      return {
        ...built,
        lines: visibleGridLines,
      };
    }
    return built;
  }, [
    showBeatGrid,
    duration,
    r.importedMemory,
    r.analysis?.bpm,
    r.analysis?.beatOffsetSec,
    r.analysis?.downbeats,
    viewStartSec,
    viewEndSec,
    laneViewportWidthPx,
    gridResolutionMode,
    visibleGridLines,
  ]);

  const activeGridLines = adaptiveMidiGrid.lines;

  // Sync vertical scroll metrics AND actual horizontal lane viewport width on resize/expand
  const syncVerticalMetrics = useCallback(() => {
    const el = verticalScrollRef.current;
    if (!el) return;
    const headerOffset = isDrums ? (window.innerWidth >= 640 ? 256 : 208) : 112;
    const measuredLaneW = Math.max(240, Math.round(el.clientWidth - headerOffset));
    setLaneViewportWidthPx((prev) => (Math.abs(prev - measuredLaneW) >= 8 ? measuredLaneW : prev));
    setVScrollMetrics({
      scrollTop: el.scrollTop,
      scrollHeight: Math.max(1, el.scrollHeight),
      clientHeight: Math.max(1, el.clientHeight),
    });
  }, [isDrums]);

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

  // Global keyboard shortcuts for MIDI scroll, Play/Pause in fullscreen & selected note deletion
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!r.analysis || duration <= 0) return;

      if (e.code === 'Space' && isFullscreen) {
        e.preventDefault();
        r.togglePlayback();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isDrums && selectedNoteId) {
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
    isFullscreen,
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

    ctx.fillStyle = '#09090B';
    ctx.fillRect(0, 0, w, h);

    if (isDrums) {
      const laneOrder: Record<DrumPieceRole, { yNorm: number; color: string }> = {
        crash: { yNorm: 0.12, color: '#F472B6' },
        hat: { yNorm: 0.31, color: '#FBBF24' },
        tom: { yNorm: 0.5, color: '#34D399' },
        snare: { yNorm: 0.69, color: '#22D3EE' },
        kick: { yNorm: 0.88, color: '#FB923C' },
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
          ev.midiNote < 50 ? '#FB923C' : ev.midiNote < 64 ? '#22D3EE' : '#34D399';
        ctx.fillRect(x0, y - 1, bw, 2.2);
      }
    }
    // Playhead marker on minimap
    const px = (r.currentTimeSec / duration) * w;
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(px - 0.75, 0, 1.5, h);
  }, [r.analysis, r.currentTimeSec, duration, isDrums, editorSizeMode, minimapResizeTick]);

  // =========================================================================
  // DIRECT MOUSE DRAG-TO-MOVE (POSITION) & DRAG-TO-VOLUME (HEIGHT) FOR DRUM HITS
  // =========================================================================
  const beginDrumHitDrag = (
    e: React.PointerEvent<HTMLElement>,
    hit: StemDrumHitEvent,
    laneId: string,
    initialMode: 'auto' | 'velocity'
  ) => {
    // Only engage direct drag when in 'select' (Editar) mode with primary mouse button and no Alt (Alt+Drag = Pan 2D)
    if (editTool !== 'select' || e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    e.preventDefault();

    const laneEl = (e.currentTarget as HTMLElement).closest(
      '[data-drum-lane="true"]'
    ) as HTMLElement | null;
    if (!laneEl) return;
    const laneRect = laneEl.getBoundingClientRect();
    if (laneRect.width < 10 || laneRect.height < 10) return;

    setSelectedHitId(hit.id);

    hitDragSessionRef.current = {
      hitId: hit.id,
      hitSnapshot: hit,
      laneId,
      initialMode,
      resolvedMode: initialMode === 'velocity' ? 'velocity' : 'pending',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTimeSec: hit.timeSec,
      startPeakTimeSec: hit.peakTimeSec,
      startVelocity: hit.velocity,
      laneWidth: laneRect.width,
      laneHeight: laneRect.height,
      laneBottomY: laneRect.bottom - 4, // matches `bottom-1` (4px)
      viewSpanSecSnapshot: Math.max(0.01, viewSpanSec),
      moved: initialMode === 'velocity',
    };

    if (initialMode === 'velocity') {
      const initPreview: HitDragPreview = {
        hitId: hit.id,
        laneId,
        mode: 'velocity',
        peakTimeSec: hit.peakTimeSec,
        timeSec: hit.timeSec,
        velocity: hit.velocity,
        deltaMs: 0,
      };
      hitDragPreviewRef.current = initPreview;
      setHitDragPreview(initPreview);
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture unsupported
    }
  };

  const moveDrumHitDrag = (e: React.PointerEvent<HTMLElement>) => {
    const st = hitDragSessionRef.current;
    if (!st) return;
    e.stopPropagation();

    const dx = e.clientX - st.startClientX;
    const dy = e.clientY - st.startClientY;

    // Resolve drag direction cleanly once pointer clears 3px deadzone
    if (st.resolvedMode === 'pending') {
      const dist = Math.hypot(dx, dy);
      if (dist < 3) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.4 && Math.abs(dy) >= 5) {
        st.resolvedMode = 'velocity';
      } else {
        st.resolvedMode = 'move';
      }
      st.moved = true;
    }

    if (st.resolvedMode === 'move') {
      // Holding Shift gives ultra-fine 0.25x sub-millisecond timing control
      const speed = e.shiftKey ? 0.25 : 1.0;
      const rawDeltaSec = (dx / st.laneWidth) * st.viewSpanSecSnapshot * speed;
      // Keep both timeSec >= 0 and peakTimeSec <= duration - 0.005 locked in phase
      const minDelta = -Math.min(st.startTimeSec, st.startPeakTimeSec);
      const maxDelta = Math.max(0, duration - 0.005 - Math.max(st.startTimeSec, st.startPeakTimeSec));
      let clampedDelta = Math.max(minDelta, Math.min(maxDelta, rawDeltaSec));

      // Magnetic snap to active adaptive grid when enabled (holding Shift temporarily bypasses for free micro-nudge)
      if (snapToGrid && !e.shiftKey && activeGridLines.length > 0) {
        const candidatePeak = st.startPeakTimeSec + clampedDelta;
        const snappedPeak = snapSecToAdaptiveGrid(candidatePeak, activeGridLines);
        const snappedDelta = snappedPeak - st.startPeakTimeSec;
        clampedDelta = Math.max(minDelta, Math.min(maxDelta, snappedDelta));
      }

      const nextTimeSec = Number((st.startTimeSec + clampedDelta).toFixed(4));
      const nextPeakTimeSec = Number((st.startPeakTimeSec + clampedDelta).toFixed(5));
      const preview: HitDragPreview = {
        hitId: st.hitId,
        laneId: st.laneId,
        mode: 'move',
        peakTimeSec: nextPeakTimeSec,
        timeSec: nextTimeSec,
        velocity: st.startVelocity,
        deltaMs: Math.round(clampedDelta * 1000),
      };
      hitDragPreviewRef.current = preview;
      setHitDragPreview(preview);
    } else if (st.resolvedMode === 'velocity') {
      let nextVel: number;
      if (st.initialMode === 'velocity') {
        // Grabbing the top edge handle maps pointer Y directly 1:1 to bar height
        const heightFromBottomPx = st.laneBottomY - e.clientY;
        const heightPct = (heightFromBottomPx / st.laneHeight) * 100;
        const norm =
          (heightPct - MIN_BAR_HEIGHT_PCT) / (MAX_BAR_HEIGHT_PCT - MIN_BAR_HEIGHT_PCT);
        nextVel = MIN_HIT_VEL + Math.max(0, Math.min(1, norm)) * (MAX_HIT_VEL - MIN_HIT_VEL);
      } else {
        // Dragging vertically from bar body adjusts relative velocity smoothly
        const usablePx = Math.max(36, st.laneHeight * 0.72);
        const velDelta = (-dy / usablePx) * (MAX_HIT_VEL - MIN_HIT_VEL);
        nextVel = Math.max(MIN_HIT_VEL, Math.min(MAX_HIT_VEL, st.startVelocity + velDelta));
      }
      const roundedVel = Number(nextVel.toFixed(3));
      const preview: HitDragPreview = {
        hitId: st.hitId,
        laneId: st.laneId,
        mode: 'velocity',
        peakTimeSec: st.startPeakTimeSec,
        timeSec: st.startTimeSec,
        velocity: roundedVel,
        deltaMs: 0,
      };
      hitDragPreviewRef.current = preview;
      setHitDragPreview(preview);
    }
  };

  const endDrumHitDrag = (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const st = hitDragSessionRef.current;
    if (!st) return;
    e.stopPropagation();

    const preview = hitDragPreviewRef.current;
    hitDragSessionRef.current = null;
    hitDragPreviewRef.current = null;
    setHitDragPreview(null);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (!cancelled && st.moved && preview) {
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 60);

      if (preview.mode === 'move' && Math.abs(preview.timeSec - st.startTimeSec) >= 0.0005) {
        r.updateDrumHit(st.hitId, { timeSec: preview.timeSec });
        r.auditionDrumHit({
          ...st.hitSnapshot,
          timeSec: preview.timeSec,
          peakTimeSec: preview.peakTimeSec,
        });
      } else if (
        preview.mode === 'velocity' &&
        Math.abs(preview.velocity - st.startVelocity) >= 0.005
      ) {
        r.updateDrumHit(st.hitId, { velocity: preview.velocity });
        r.auditionDrumHit({
          ...st.hitSnapshot,
          velocity: preview.velocity,
        });
      }
    }
  };

  // =========================================================================
  // DIRECT MOUSE DRAG-TO-MOVE & DURATION RESIZE FOR MELODIC PIANO ROLL NOTES
  // =========================================================================
  const beginMelodicNoteDrag = (
    e: React.PointerEvent<HTMLElement>,
    ev: StemNoteEvent,
    mode: 'move' | 'resize-right'
  ) => {
    if (editTool !== 'select' || e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    e.preventDefault();

    const laneEl = (e.currentTarget as HTMLElement).closest(
      '[data-melodic-lane="true"]'
    ) as HTMLElement | null;
    if (!laneEl) return;
    const laneRect = laneEl.getBoundingClientRect();
    if (laneRect.width < 10) return;

    setSelectedNoteId(ev.id);

    noteDragSessionRef.current = {
      noteId: ev.id,
      noteSnapshot: ev,
      mode,
      startClientX: e.clientX,
      startSec: ev.startSec,
      startDurationSec: ev.durationSec,
      laneWidth: laneRect.width,
      viewSpanSecSnapshot: Math.max(0.01, viewSpanSec),
      moved: mode === 'resize-right',
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const moveMelodicNoteDrag = (e: React.PointerEvent<HTMLElement>) => {
    const st = noteDragSessionRef.current;
    if (!st) return;
    e.stopPropagation();

    const dx = e.clientX - st.startClientX;
    if (!st.moved && Math.abs(dx) < 3) return;
    st.moved = true;

    const speed = e.shiftKey ? 0.25 : 1.0;
    const deltaSec = (dx / st.laneWidth) * st.viewSpanSecSnapshot * speed;

    if (st.mode === 'move') {
      let rawNextStart = Math.max(0, Math.min(duration - 0.05, st.startSec + deltaSec));
      if (snapToGrid && !e.shiftKey && activeGridLines.length > 0) {
        rawNextStart = Math.max(
          0,
          Math.min(duration - 0.05, snapSecToAdaptiveGrid(rawNextStart, activeGridLines))
        );
      }
      const nextStart = Number(rawNextStart.toFixed(4));
      const preview: MelodicNoteDragPreview = {
        noteId: st.noteId,
        mode: 'move',
        startSec: nextStart,
        durationSec: st.startDurationSec,
        deltaMs: Math.round((nextStart - st.startSec) * 1000),
      };
      noteDragPreviewRef.current = preview;
      setNoteDragPreview(preview);
    } else {
      let rawNextEnd = Math.max(
        st.startSec + 0.05,
        Math.min(duration, st.startSec + st.startDurationSec + deltaSec)
      );
      if (snapToGrid && !e.shiftKey && activeGridLines.length > 0) {
        rawNextEnd = Math.max(
          st.startSec + 0.05,
          Math.min(duration, snapSecToAdaptiveGrid(rawNextEnd, activeGridLines))
        );
      }
      const nextDur = Number((rawNextEnd - st.startSec).toFixed(4));
      const preview: MelodicNoteDragPreview = {
        noteId: st.noteId,
        mode: 'resize-right',
        startSec: st.startSec,
        durationSec: nextDur,
        deltaMs: Math.round((nextDur - st.startDurationSec) * 1000),
      };
      noteDragPreviewRef.current = preview;
      setNoteDragPreview(preview);
    }
  };

  const endMelodicNoteDrag = (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const st = noteDragSessionRef.current;
    if (!st) return;
    e.stopPropagation();

    const preview = noteDragPreviewRef.current;
    noteDragSessionRef.current = null;
    noteDragPreviewRef.current = null;
    setNoteDragPreview(null);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (!cancelled && st.moved && preview) {
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 60);

      if (preview.mode === 'move' && Math.abs(preview.startSec - st.startSec) >= 0.001) {
        r.updateMelodicNote(st.noteId, { startSec: preview.startSec });
        r.auditionMelodicNote(st.noteSnapshot.midiNote, st.noteSnapshot.velocity);
      } else if (
        preview.mode === 'resize-right' &&
        Math.abs(preview.durationSec - st.startDurationSec) >= 0.005
      ) {
        r.updateMelodicNote(st.noteId, { durationSec: preview.durationSec });
      }
    }
  };

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

  const workstationContent = (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[120] w-screen h-screen bg-[#09090B] text-zinc-100 flex flex-col overflow-hidden select-none'
          : 'rounded-2xl border border-white/[0.08] bg-[#0B0B0E] overflow-hidden flex flex-col shadow-[0_18px_48px_rgba(0,0,0,0.6)]'
      }
    >
      {/* WORKSTATION TOP TOOLBAR (Title · 5/9 View · Edit Tools · Vertical Zoom · Dedicated Fullscreen Toggle) */}
      <div className="px-4 py-2.5 bg-[#121215] border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-2.5 text-[11px] shrink-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-zinc-100 font-semibold tracking-tight text-xs">
              {isDrums ? 'Editor MIDI Batería' : 'Piano Roll MIDI'}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-zinc-300 font-mono text-[10px] tabular-nums">
              {isDrums
                ? `${r.analysis.counts.total} golpes`
                : `${r.analysis.counts.notes} notas`}
            </span>
            {isFullscreen && r.stemTitle && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-zinc-400 truncate max-w-[260px]">
                <span className="text-zinc-600">·</span>
                <span className="truncate text-zinc-300">{r.stemTitle}</span>
                <span className="font-mono text-zinc-500 tabular-nums">{r.analysis.bpm} BPM</span>
              </span>
            )}
          </div>

          {isDrums && (
            <div className="flex items-center bg-[#0B0B0D] border border-white/[0.07] rounded-lg p-0.5 text-[10.5px]">
              <button
                type="button"
                onClick={() => setDrumLaneMode('5-buses')}
                className={`px-2.5 py-0.5 rounded-md font-medium cursor-pointer transition-all duration-150 ${
                  drumLaneMode === '5-buses'
                    ? 'bg-[#26262C] text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Vista agrupada en 5 buses principales"
              >
                5 Buses
              </button>
              <button
                type="button"
                onClick={() => setDrumLaneMode('9-gm')}
                className={`px-2.5 py-0.5 rounded-md font-medium flex items-center gap-1 cursor-pointer transition-all duration-150 ${
                  drumLaneMode === '9-gm'
                    ? 'bg-[#26262C] text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Expande las 9 piezas GM independientes (Crash, Ride, Open Hat, Closed Hat, High Tom, Mid Tom, Floor Tom, Snare, Kick)"
              >
                <Layers size={10} className="text-emerald-400" />
                <span>9 Piezas GM</span>
              </button>
            </div>
          )}

          {isDrums && r.soloDrumRole && (
            <button
              type="button"
              onClick={() => r.toggleSoloDrumRole(r.soloDrumRole!)}
              className="px-2 py-0.5 rounded-md bg-amber-400/90 text-zinc-950 font-mono font-bold text-[10px] cursor-pointer"
              title="Quitar modo SOLO y escuchar todas las piezas"
            >
              ● SOLO: {r.soloDrumRole.toUpperCase()} ✕
            </button>
          )}
        </div>

        {/* Editing Tools + Vertical Zoom + Always-Visible Fullscreen Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setEditTool('select')}
              className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1.5 cursor-pointer transition-all duration-150 ${
                editTool === 'select'
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title="Arrastra cualquier golpe izquierda/derecha para mover su posición exacta · Arrastra su borde superior arriba/abajo para subir/bajar volumen · Doble clic en espacio vacío para añadir"
            >
              <MousePointer size={11} />
              <span>Editar</span>
            </button>

            <button
              type="button"
              onClick={() => setEditTool('add')}
              className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 cursor-pointer transition-all duration-150 ${
                editTool === 'add'
                  ? 'bg-emerald-400 text-zinc-950 font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title="Clic en cualquier carril para insertar un golpe o nota MIDI"
            >
              <Pencil size={11} />
              <span>Añadir</span>
            </button>

            {isDrums && (
              <button
                type="button"
                onClick={() => setEditTool('convert-tom-kick')}
                className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 cursor-pointer transition-all duration-150 ${
                  editTool === 'convert-tom-kick'
                    ? 'bg-orange-400 text-zinc-950 font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100'
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
              className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 cursor-pointer transition-all duration-150 ${
                editTool === 'pan'
                  ? 'bg-[#2E2E36] text-white border border-white/15'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
              title="Arrastra en cualquier dirección (Horizontal + Vertical) dentro del editor MIDI (también con botón central del ratón o Alt+Arrastrar)"
            >
              <Hand size={11} />
              <span>Pan 2D</span>
            </button>

            <button
              type="button"
              onClick={() => setEditTool('erase')}
              className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 cursor-pointer transition-all duration-150 ${
                editTool === 'erase'
                  ? 'bg-rose-500/90 text-white font-semibold'
                  : 'text-zinc-400 hover:text-rose-300'
              }`}
              title="Clic sobre cualquier golpe o nota para borrarlo"
            >
              <Trash2 size={11} />
              <span>Borrar</span>
            </button>
          </div>

          {isDrums && (
            <div className="flex items-center gap-1 bg-[#18181C] border border-white/[0.08] rounded-xl px-2.5 py-1 text-[10.5px]">
              <span className="text-zinc-400">Tom:</span>
              <select
                value={tomInsertArticulation}
                onChange={(e) =>
                  setTomInsertArticulation(
                    e.target.value as 'floor-tom' | 'mid-tom' | 'high-tom'
                  )
                }
                className="bg-transparent text-zinc-100 font-medium focus:outline-none cursor-pointer"
              >
                <option value="floor-tom" className="bg-[#121215]">
                  Floor (43)
                </option>
                <option value="mid-tom" className="bg-[#121215]">
                  Mid (47)
                </option>
                <option value="high-tom" className="bg-[#121215]">
                  High (50)
                </option>
              </select>
            </div>
          )}

          {/* Adaptive Grid Precision Selector & Magnetic Snap */}
          <div className="flex items-center gap-1 bg-[#18181C] border border-white/[0.12] rounded-xl px-2 py-1 text-[10.5px]">
            <Grid3X3 size={11} className="text-white/80 shrink-0" />
            <span className="text-zinc-300 hidden xl:inline">Grilla</span>
            <select
              value={gridResolutionMode}
              onChange={(e) => setGridResolutionMode(e.target.value as MidiGridResolutionMode)}
              className="bg-transparent text-white font-mono font-semibold focus:outline-none cursor-pointer"
              title="Resolución de la grilla musical blanca (Auto aumenta subdivisiones automáticamente al expandir o hacer zoom)"
            >
              <option value="auto" className="bg-[#121215]">
                Auto ({adaptiveMidiGrid.effectiveResolutionLabel})
              </option>
              <option value="1/4" className="bg-[#121215]">
                1/4 (Negras)
              </option>
              <option value="1/8" className="bg-[#121215]">
                1/8 (Corcheas)
              </option>
              <option value="1/16" className="bg-[#121215]">
                1/16 (Semicorcheas)
              </option>
              <option value="1/32" className="bg-[#121215]">
                1/32 (Fusas)
              </option>
              <option value="1/64" className="bg-[#121215]">
                1/64 (Semifusas)
              </option>
            </select>
            <button
              type="button"
              onClick={() => setSnapToGrid((s) => !s)}
              className={`ml-0.5 px-1.5 py-0.5 rounded-md border text-[9.5px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                snapToGrid
                  ? 'bg-white text-zinc-950 border-white font-semibold'
                  : 'bg-[#0E0E11] border-white/[0.12] text-zinc-400 hover:text-white'
              }`}
              title="Ajuste magnético (Snap) a las líneas de la grilla al mover o añadir golpes (mantén Shift para movimiento libre)"
            >
              <Magnet size={10} />
              <span>Imán</span>
            </button>
          </div>

          {/* Vertical Zoom Stepper (Image 3 segmented stepper style) */}
          <div
            className="flex items-center gap-1 bg-[#18181C] border border-white/[0.08] rounded-xl px-2 py-1 text-[10.5px]"
            title="Zoom Vertical de altura de carriles (Alt + Rueda o arrastrar bordes del scroll vertical)"
          >
            <span className="text-zinc-400 mr-0.5">Alto</span>
            <button
              type="button"
              onClick={() =>
                setVerticalZoom((v) => Number(Math.max(0.65, v / 1.18).toFixed(3)))
              }
              className="w-5 h-5 rounded-md bg-[#0E0E11] hover:bg-[#27272E] text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
            >
              −
            </button>
            <span className="text-zinc-100 font-mono font-semibold tabular-nums w-9 text-center">
              {Math.round(verticalZoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() =>
                setVerticalZoom((v) => Number(Math.min(2.6, v * 1.18).toFixed(3)))
              }
              className="w-5 h-5 rounded-md bg-[#0E0E11] hover:bg-[#27272E] text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
            >
              +
            </button>
          </div>

          {/* ALWAYS-VISIBLE FULLSCREEN TOGGLE BUTTON */}
          <button
            type="button"
            onClick={() => setEditorSizeMode(isFullscreen ? 'large' : 'fullscreen')}
            className={`px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 cursor-pointer transition-all duration-150 ${
              isFullscreen
                ? 'bg-zinc-100 hover:bg-white text-zinc-950 font-semibold'
                : 'bg-[#1C1C21] hover:bg-[#27272E] border border-white/[0.12] text-zinc-100'
            }`}
            title={
              isFullscreen
                ? 'Salir de Pantalla Completa (ESC)'
                : 'Abrir Editor MIDI en Pantalla Completa para edición cómoda'
            }
          >
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            <span>{isFullscreen ? 'Salir (ESC)' : 'Pantalla Completa'}</span>
          </button>
        </div>
      </div>

      {/* PINNED TOP MUSICAL BAR & BEAT RULER (Aligned 1:1 with Lanes & Right Vertical Scrollbar) */}
      <div className="flex items-stretch h-7 bg-[#111115] border-b border-white/25 text-[10px] font-mono select-none shrink-0">
        <div
          className={`${
            isDrums ? 'w-52 sm:w-64' : 'w-24 sm:w-28'
          } shrink-0 px-3 border-r border-white/20 flex items-center justify-between text-zinc-400`}
        >
          <span className="font-semibold text-zinc-200 truncate font-sans text-[10.5px]">
            {isDrums ? 'Pistas · Mix' : 'Notas'}
          </span>
          {isDrums && (
            <span className="text-[9px] text-zinc-300 font-mono tabular-nums">
              {adaptiveMidiGrid.effectiveResolutionLabel}
            </span>
          )}
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
          title="Regla de Compases y Subdivisiones · Clic para saltar al segundo exacto"
        >
          {activeGridLines.map((gl, idx) => {
            const isMajor = gl.level === 'bar' || gl.level === 'beat';
            const tickClass =
              gl.level === 'bar'
                ? 'top-0 bottom-0 border-l-[1.5px] border-white/90'
                : gl.level === 'beat'
                ? 'top-0 bottom-0 border-l border-white/55'
                : gl.level === 'eighth'
                ? 'top-2 bottom-0 border-l border-white/38'
                : gl.level === 'sixteenth'
                ? 'top-3.5 bottom-0 border-l border-white/28'
                : gl.level === 'thirtysecond'
                ? 'top-4 bottom-0 border-l border-white/20'
                : 'top-5 bottom-0 border-l border-white/15';

            return (
              <div
                key={`ruler-g-${idx}`}
                style={{ left: `${gl.leftPct}%` }}
                className={`absolute pointer-events-none ${tickClass}`}
              >
                {gl.level === 'bar' && gl.barNum !== undefined && (
                  <span className="pl-1.5 text-[10px] font-bold text-white tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                    C{gl.barNum}
                  </span>
                )}
                {gl.level === 'beat' && gl.subLabel && (
                  <span className="pl-1 text-[9px] font-semibold text-zinc-200 tabular-nums">
                    {gl.subLabel}
                  </span>
                )}
                {!isMajor && gl.subLabel && (
                  <span className="pl-1 text-[8px] text-zinc-300/85 tabular-nums leading-none block -mt-1">
                    {gl.subLabel}
                  </span>
                )}
              </div>
            );
          })}
          {r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec && (
            <div
              style={{
                left: `${((r.currentTimeSec - viewStartSec) / viewSpanSec) * 100}%`,
              }}
              className="absolute top-0 bottom-0 w-[2px] bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.9)] z-20 pointer-events-none"
            >
              <span className="absolute -top-0.5 -left-[4px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#00E5FF]" />
            </div>
          )}
        </div>

        {/* Right Top Corner above Vertical Scrollbar */}
        <div className="w-7 shrink-0 border-l border-white/20 bg-[#121215] flex items-center justify-center text-[9px] text-zinc-400 font-semibold">
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
            <div className="divide-y divide-white/25">
              {activeDrumLanes.map((lane) => {
                const slot = r.drumSlots[lane.role];
                const isSolo = r.soloDrumRole === lane.role;
                const isMutedByOtherSolo =
                  r.soloDrumRole !== null && r.soloDrumRole !== lane.role;
                const laneAllHits = r.analysis!.drumHits.filter(lane.matchHit);
                const visibleLaneHits = laneAllHits.filter((h) => {
                  const effPeak =
                    hitDragPreview && hitDragPreview.hitId === h.id
                      ? hitDragPreview.peakTimeSec
                      : h.peakTimeSec;
                  return effPeak >= viewStartSec - 0.04 && effPeak <= viewEndSec + 0.04;
                });
                const activeDragInLane =
                  hitDragPreview && hitDragPreview.laneId === lane.id ? hitDragPreview : null;

                return (
                  <div
                    key={lane.id}
                    style={{ height: `${laneHeightPx}px` }}
                    className={`flex items-stretch text-[11px] transition-[opacity] duration-150 ${
                      !slot.enabled || isMutedByOtherSolo ? 'opacity-40' : ''
                    }`}
                  >
                    {/* Left Track Controls */}
                    <div className="w-52 sm:w-64 shrink-0 px-3 bg-[#111114] border-r border-white/[0.07] flex flex-col justify-center gap-1.5">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: slot.enabled ? lane.color : '#3F3F46',
                            }}
                          />
                          <span className="font-semibold text-zinc-100 truncate tracking-tight text-[11px]">
                            {lane.title}
                          </span>
                        </div>
                        <span
                          style={{
                            borderColor: `${lane.color}40`,
                            color: lane.color,
                          }}
                          className="px-1.5 py-0.2 rounded-md bg-[#0B0B0D] border text-[9.5px] font-mono font-semibold tabular-nums shrink-0"
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
                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold border cursor-pointer transition-colors ${
                              slot.enabled
                                ? 'bg-[#1A1A1F] border-white/[0.09] text-emerald-400 hover:border-emerald-400/50'
                                : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                            }`}
                            title={`Activar/Silenciar ${lane.title}`}
                          >
                            {slot.enabled ? 'ON' : 'MUTE'}
                          </button>
                          <button
                            type="button"
                            onClick={() => r.toggleSoloDrumRole(lane.role)}
                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold border cursor-pointer transition-colors ${
                              isSolo
                                ? 'bg-amber-400 border-amber-300 text-zinc-950'
                                : 'bg-[#1A1A1F] border-white/[0.09] text-zinc-400 hover:text-amber-300'
                            }`}
                            title={`SOLO ${lane.role.toUpperCase()}`}
                          >
                            S
                          </button>
                          <button
                            type="button"
                            onClick={() => r.auditionSlotSample(slot)}
                            className="px-1.5 py-0.5 rounded-md bg-[#1A1A1F] hover:bg-[#27272E] border border-white/[0.09] text-zinc-200 cursor-pointer transition-colors"
                            title={`Probar sonido de ${lane.title}`}
                          >
                            <Volume2 size={9.5} />
                          </button>
                          {onRequestBrowseKit1400ForRole && (
                            <button
                              type="button"
                              onClick={() => onRequestBrowseKit1400ForRole(lane.role)}
                              className="px-1.5 py-0.5 rounded-md bg-orange-500/15 hover:bg-orange-500/25 border border-orange-400/35 text-orange-300 hover:text-white text-[9px] font-semibold cursor-pointer transition-colors"
                              title={`Elegir muestra de 1400 Samples Drum Kit para ${lane.title}`}
                            >
                              1400
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onRequestUploadForRole(lane.role)}
                            className="px-1.5 py-0.5 rounded-md bg-[#1A1A1F] hover:bg-[#27272E] border border-white/[0.09] text-zinc-300 hover:text-white text-[9px] font-medium flex items-center gap-0.5 cursor-pointer transition-colors"
                            title={`Subir tu propio sample para ${lane.title}`}
                          >
                            <Upload size={8.5} />
                            <span className="hidden sm:inline">PC</span>
                          </button>
                        </div>
                        <span className="text-[8.5px] font-mono text-zinc-500 truncate max-w-[74px]">
                          {slot.sourceType !== 'preset' && slot.customName
                            ? `★ ${slot.customName}`
                            : lane.gmHint}
                        </span>
                      </div>
                    </div>

                    {/* Right Interactive Drum Lane */}
                    <div
                      data-drum-lane="true"
                      onClick={(e) => {
                        if (suppressNextClickRef.current) return;
                        if (editTool === 'pan') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const norm = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const rawClickedSec = viewStartSec + norm * viewSpanSec;
                        const clickedSec =
                          snapToGrid && activeGridLines.length > 0 && editTool === 'add'
                            ? snapSecToAdaptiveGrid(rawClickedSec, activeGridLines)
                            : rawClickedSec;
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
                          r.seekToSec(rawClickedSec);
                        }
                      }}
                      onDoubleClick={(e) => {
                        if (suppressNextClickRef.current) return;
                        if (editTool === 'pan') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const norm = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const rawClickedSec = viewStartSec + norm * viewSpanSec;
                        const clickedSec =
                          snapToGrid && activeGridLines.length > 0
                            ? snapSecToAdaptiveGrid(rawClickedSec, activeGridLines)
                            : rawClickedSec;
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
                      className={`relative flex-1 bg-[#09090B] hover:bg-[#0D0D10] overflow-hidden transition-colors ${
                        editTool === 'pan'
                          ? isPanning2D
                            ? 'cursor-grabbing'
                            : 'cursor-grab'
                          : editTool === 'add'
                          ? 'cursor-crosshair'
                          : 'cursor-pointer'
                      }`}
                    >
                      {/* High-Contrast Adaptive White Musical Grid (Bars, Beats, 1/8, 1/16, 1/32, 1/64) */}
                      {activeGridLines.map((gl, idx) => (
                        <div
                          key={`${lane.id}-g-${idx}`}
                          style={{ left: `${gl.leftPct}%` }}
                          className={`absolute top-0 bottom-0 pointer-events-none ${getLaneGridLineClass(
                            gl.level
                          )}`}
                        />
                      ))}

                      {/* Velocity Reference Midline (50% white dashed guide) */}
                      {laneHeightPx >= 64 && (
                        <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-white/15 pointer-events-none" />
                      )}

                      {/* Sub-Tier Guide Rows in 5-Bus mode for TOMS */}
                      {!lane.isSubLane && lane.role === 'tom' && laneHeightPx >= 64 && (
                        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between py-1 px-2 text-[8.5px] font-mono text-emerald-400/45">
                          <div className="border-b border-dashed border-emerald-400/25 pb-0.5">
                            HIGH TOM (GM 50 · +3st)
                          </div>
                          <div className="border-b border-dashed border-emerald-400/25 pb-0.5">
                            MID TOM (GM 47 · 0st)
                          </div>
                          <div>FLOOR TOM (GM 43 · -3st)</div>
                        </div>
                      )}

                      {/* Live Vertical Alignment Hairline while dragging a hit horizontally */}
                      {activeDragInLane && activeDragInLane.mode === 'move' && (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-white pointer-events-none z-20 shadow-[0_0_6px_rgba(255,255,255,0.8)]"
                          style={{
                            left: `${
                              ((activeDragInLane.peakTimeSec - viewStartSec) / viewSpanSec) * 100
                            }%`,
                          }}
                        />
                      )}

                      {/* Playhead (Cyan-White high-contrast cursor so it never blends with white bar grid lines) */}
                      {r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec && (
                        <div
                          className="absolute top-0 bottom-0 w-[2px] bg-[#00E5FF] pointer-events-none z-20 shadow-[0_0_10px_rgba(0,229,255,0.85)]"
                          style={{
                            left: `${((r.currentTimeSec - viewStartSec) / viewSpanSec) * 100}%`,
                          }}
                        />
                      )}

                      {/* Drum Hit Bars (Direct Mouse Position Move + Top-Handle Volume Height Resize) */}
                      {visibleLaneHits.map((hit) => {
                        const isDraggingThis = hitDragPreview?.hitId === hit.id;
                        const effPeakSec = isDraggingThis
                          ? hitDragPreview!.peakTimeSec
                          : hit.peakTimeSec;
                        const effVelocity = isDraggingThis
                          ? hitDragPreview!.velocity
                          : hit.velocity;

                        const leftPct = ((effPeakSec - viewStartSec) / viewSpanSec) * 100;
                        const heightPct = velocityToHeightPct(effVelocity);
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

                        const canDirectDrag = editTool === 'select';

                        return (
                          <div
                            key={hit.id}
                            role="button"
                            tabIndex={0}
                            onPointerDown={(e) => beginDrumHitDrag(e, hit, lane.id, 'auto')}
                            onPointerMove={moveDrumHitDrag}
                            onPointerUp={(e) => endDrumHitDrag(e, false)}
                            onPointerCancel={(e) => endDrumHitDrag(e, true)}
                            onClick={(e) => {
                              if (suppressNextClickRef.current) {
                                e.stopPropagation();
                                return;
                              }
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
                              backgroundColor: isSelected ? '#FAFAFA' : lane.color,
                              boxShadow: isDraggingThis
                                ? `0 0 18px ${lane.color}AA`
                                : isSelected
                                ? `0 0 14px ${lane.color}88`
                                : `0 2px 6px rgba(0,0,0,0.55)`,
                            }}
                            className={`group absolute bottom-1 -translate-x-1/2 min-w-[18px] sm:min-w-[22px] px-1 rounded-t-md flex flex-col items-center justify-between pb-0.5 pt-2 select-none touch-none ${
                              isDraggingThis
                                ? hitDragPreview?.mode === 'velocity'
                                  ? 'cursor-ns-resize ring-2 ring-white z-40 text-zinc-950'
                                  : 'cursor-grabbing ring-2 ring-white z-40 text-zinc-950'
                                : isSelected
                                ? `${
                                    canDirectDrag ? 'cursor-grab' : 'cursor-pointer'
                                  } ring-2 ring-white/95 z-30 text-zinc-950`
                                : `${
                                    canDirectDrag ? 'cursor-grab' : 'cursor-pointer'
                                  } hover:brightness-115 z-10 text-zinc-950`
                            }`}
                            title={
                              canDirectDrag
                                ? `${hit.subRoleLabel || lane.title} · ${effPeakSec.toFixed(
                                    3
                                  )}s · Vol ${Math.round(
                                    effVelocity * 100
                                  )}% — Arrastra el cuerpo izq/der para mover posición · Arrastra el borde superior arriba/abajo para cambiar volumen (Shift = precisión fina)`
                                : `${hit.subRoleLabel || lane.title} · ${effPeakSec.toFixed(
                                    3
                                  )}s · Vol ${Math.round(effVelocity * 100)}%`
                            }
                          >
                            {/* Top Volume / Height Resize Handle (1:1 ns-resize) */}
                            {canDirectDrag && (
                              <div
                                onPointerDown={(e) =>
                                  beginDrumHitDrag(e, hit, lane.id, 'velocity')
                                }
                                onPointerMove={moveDrumHitDrag}
                                onPointerUp={(e) => endDrumHitDrag(e, false)}
                                onPointerCancel={(e) => endDrumHitDrag(e, true)}
                                onClick={(e) => e.stopPropagation()}
                                className="absolute -top-1 left-0 right-0 h-3 cursor-ns-resize flex items-center justify-center z-20"
                                title="Arrastra arriba/abajo para ajustar la altura (volumen) de este golpe"
                              >
                                <span
                                  className={`w-3 h-[2.5px] rounded-full transition-opacity ${
                                    isDraggingThis && hitDragPreview?.mode === 'velocity'
                                      ? 'bg-zinc-950 opacity-100'
                                      : 'bg-zinc-950/65 opacity-35 group-hover:opacity-100'
                                  }`}
                                />
                              </div>
                            )}

                            {/* Live HUD Tooltip while Dragging Position or Volume */}
                            {isDraggingThis && hitDragPreview && (
                              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded-md bg-zinc-950/95 border border-white/25 text-[9px] font-mono font-bold text-zinc-100 shadow-xl z-50 tabular-nums">
                                {hitDragPreview.mode === 'velocity'
                                  ? `Vol ${Math.round(hitDragPreview.velocity * 100)}%`
                                  : `${hitDragPreview.peakTimeSec.toFixed(3)}s (${
                                      hitDragPreview.deltaMs >= 0 ? '+' : ''
                                    }${hitDragPreview.deltaMs}ms)`}
                              </div>
                            )}

                            <span className="text-[8.5px] font-mono font-black leading-none tracking-tighter pointer-events-none">
                              {shortBadge}
                            </span>
                            {laneHeightPx >= 54 && (
                              <span className="text-[7.5px] font-mono font-bold opacity-85 leading-none tabular-nums pointer-events-none">
                                {Math.round(effVelocity * 100)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* MELODIC / POLYPHONIC CHROMATIC MIDI PIANO ROLL WITH FULL HORIZONTAL & VERTICAL SCROLL */
            <div className="divide-y divide-white/[0.14]">
              {melodicRows.map((midiNote) => {
                const black = isBlackKey(midiNote);
                const isC = midiNote % 12 === 0;
                const rowNotes = r.analysis!.noteEvents.filter((n) => {
                  const effStart =
                    noteDragPreview?.noteId === n.id ? noteDragPreview.startSec : n.startSec;
                  const effDur =
                    noteDragPreview?.noteId === n.id ? noteDragPreview.durationSec : n.durationSec;
                  return (
                    n.midiNote === midiNote &&
                    effStart + effDur >= viewStartSec - 0.03 &&
                    effStart <= viewEndSec + 0.03
                  );
                });

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
                      className={`w-24 sm:w-28 shrink-0 px-2 border-r border-white/[0.07] flex items-center justify-between cursor-pointer transition-colors ${
                        black
                          ? 'bg-[#0C0C0F] text-zinc-500 hover:bg-[#1A1A20]'
                          : isC
                          ? 'bg-[#1B1B20] text-zinc-100 font-bold hover:bg-[#26262E]'
                          : 'bg-[#141418] text-zinc-300 hover:bg-[#1E1E24]'
                      }`}
                      title={`Escuchar nota ${midiNoteToName(midiNote)} (MIDI ${midiNote})`}
                    >
                      <span>{midiNoteToName(midiNote)}</span>
                      <span className="text-[8.5px] opacity-55 tabular-nums">{midiNote}</span>
                    </button>

                    {/* Right Piano Roll Grid Lane */}
                    <div
                      data-melodic-lane="true"
                      onClick={(e) => {
                        if (suppressNextClickRef.current) return;
                        if (editTool === 'pan') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const norm = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const rawClickedSec = viewStartSec + norm * viewSpanSec;
                        const clickedSec =
                          snapToGrid && activeGridLines.length > 0 && editTool === 'add'
                            ? snapSecToAdaptiveGrid(rawClickedSec, activeGridLines)
                            : rawClickedSec;
                        if (editTool === 'add') {
                          const stepSec = 60 / Math.max(40, r.analysis!.bpm || 120) / 2;
                          const added = r.addManualMelodicNote(midiNote, clickedSec, stepSec, 0.86);
                          if (added) {
                            setSelectedNoteId(added.id);
                            r.auditionMelodicNote(midiNote, 0.86);
                          }
                        } else {
                          r.seekToSec(rawClickedSec);
                        }
                      }}
                      onDoubleClick={(e) => {
                        if (suppressNextClickRef.current) return;
                        if (editTool === 'pan') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const norm = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const rawClickedSec = viewStartSec + norm * viewSpanSec;
                        const clickedSec =
                          snapToGrid && activeGridLines.length > 0
                            ? snapSecToAdaptiveGrid(rawClickedSec, activeGridLines)
                            : rawClickedSec;
                        const stepSec = 60 / Math.max(40, r.analysis!.bpm || 120) / 2;
                        const added = r.addManualMelodicNote(midiNote, clickedSec, stepSec, 0.86);
                        if (added) {
                          setSelectedNoteId(added.id);
                          r.auditionMelodicNote(midiNote, 0.86);
                        }
                      }}
                      className={`relative flex-1 overflow-hidden ${
                        black
                          ? 'bg-[#08080A]'
                          : isC
                          ? 'bg-[#121217] border-b border-white/25'
                          : 'bg-[#0B0B0E]'
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
                      {activeGridLines.map((gl, idx) => (
                        <div
                          key={`pr-${midiNote}-g-${idx}`}
                          style={{ left: `${gl.leftPct}%` }}
                          className={`absolute top-0 bottom-0 pointer-events-none ${getLaneGridLineClass(
                            gl.level
                          )}`}
                        />
                      ))}

                      {r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec && (
                        <div
                          className="absolute top-0 bottom-0 w-[2px] bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.85)] pointer-events-none z-20"
                          style={{
                            left: `${((r.currentTimeSec - viewStartSec) / viewSpanSec) * 100}%`,
                          }}
                        />
                      )}

                      {rowNotes.map((ev: StemNoteEvent) => {
                        const isDraggingNote = noteDragPreview?.noteId === ev.id;
                        const effStart = isDraggingNote ? noteDragPreview!.startSec : ev.startSec;
                        const effDur = isDraggingNote
                          ? noteDragPreview!.durationSec
                          : ev.durationSec;

                        const leftPct = Math.max(
                          0,
                          ((effStart - viewStartSec) / viewSpanSec) * 100
                        );
                        const rightPct = Math.min(
                          100,
                          ((effStart + effDur - viewStartSec) / viewSpanSec) * 100
                        );
                        const widthPct = Math.max(0.9, rightPct - leftPct);
                        const isSel = ev.id === selectedNoteId;
                        const noteColor =
                          ev.midiNote < 50 ? '#FB923C' : ev.midiNote < 64 ? '#22D3EE' : '#34D399';
                        const canDrag = editTool === 'select';

                        return (
                          <div
                            key={ev.id}
                            role="button"
                            tabIndex={0}
                            onPointerDown={(e) => beginMelodicNoteDrag(e, ev, 'move')}
                            onPointerMove={moveMelodicNoteDrag}
                            onPointerUp={(e) => endMelodicNoteDrag(e, false)}
                            onPointerCancel={(e) => endMelodicNoteDrag(e, true)}
                            onClick={(e) => {
                              if (suppressNextClickRef.current) {
                                e.stopPropagation();
                                return;
                              }
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
                              backgroundColor: isSel ? '#FAFAFA' : noteColor,
                            }}
                            className={`absolute top-0.5 bottom-0.5 rounded px-1 text-[8.5px] font-black text-zinc-950 truncate flex items-center select-none touch-none ${
                              isDraggingNote
                                ? 'ring-2 ring-white z-40 cursor-grabbing'
                                : isSel
                                ? `ring-2 ring-white z-30 ${canDrag ? 'cursor-grab' : 'cursor-pointer'}`
                                : `hover:brightness-115 z-10 ${canDrag ? 'cursor-grab' : 'cursor-pointer'}`
                            }`}
                            title={`${ev.noteName} · ${effStart.toFixed(2)}s · dur ${effDur.toFixed(
                              2
                            )}s · Vel ${Math.round(ev.velocity * 100)}%`}
                          >
                            <span className="truncate pointer-events-none">{ev.noteName}</span>
                            {canDrag && (
                              <div
                                onPointerDown={(e) => beginMelodicNoteDrag(e, ev, 'resize-right')}
                                onPointerMove={moveMelodicNoteDrag}
                                onPointerUp={(e) => endMelodicNoteDrag(e, false)}
                                onPointerCancel={(e) => endMelodicNoteDrag(e, true)}
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/25"
                                title="Arrastra el borde derecho para cambiar duración"
                              />
                            )}
                          </div>
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
        <div className="w-7 shrink-0 bg-[#121215] border-l border-white/[0.07] flex flex-col items-center select-none">
          <button
            type="button"
            onClick={() =>
              verticalScrollRef.current?.scrollBy({ top: -laneHeightPx * 1.5, behavior: 'smooth' })
            }
            className="w-full h-5 flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-[#1E1E24] border-b border-white/[0.07] cursor-pointer shrink-0"
            title="Desplazar pistas hacia arriba"
          >
            <ChevronUp size={12} />
          </button>

          <div
            ref={vScrollbarTrackRef}
            onPointerDown={(e) => onVBarPointerDown(e, 'track')}
            className="relative flex-1 w-full bg-[#09090B] cursor-pointer overflow-hidden"
            title="Scroll Vertical Avanzado · Arrastra la barra para subir/bajar o arrastra sus bordes superior/inferior para Zoom Vertical"
          >
            {/* Vertical Lane/Pitch Minimap Color Bands */}
            {isDrums ? (
              <div className="absolute inset-0 flex flex-col pointer-events-none opacity-35">
                {activeDrumLanes.map((l) => (
                  <div
                    key={`vmin-${l.id}`}
                    className="flex-1 w-full border-b border-black/50"
                    style={{ backgroundColor: `${l.color}30` }}
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
                          ? 'rgba(255,255,255,0.22)'
                          : isBlackKey(m)
                          ? 'rgba(24,24,27,0.75)'
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
              className="absolute left-0.5 right-0.5 rounded-md bg-white/[0.14] hover:bg-white/[0.22] border border-white/[0.32] cursor-grab active:cursor-grabbing flex flex-col justify-between"
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
                <span className="w-3 h-[2px] rounded-full bg-zinc-300 group-hover:bg-white" />
              </div>

              {/* Center Grip */}
              <div className="w-full flex flex-col items-center gap-[2px] pointer-events-none opacity-65">
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
                <span className="w-3 h-[2px] rounded-full bg-zinc-300 group-hover:bg-white" />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              verticalScrollRef.current?.scrollBy({ top: laneHeightPx * 1.5, behavior: 'smooth' })
            }
            className="w-full h-5 flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-[#1E1E24] border-t border-white/[0.07] cursor-pointer shrink-0"
            title="Desplazar pistas hacia abajo"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

      {/* ADVANCED HORIZONTAL MINIMAP SCROLLBAR & ZOOM BAR */}
      <div className="flex flex-wrap sm:flex-nowrap items-stretch bg-[#121215] border-t border-white/[0.07] text-[10px] font-mono select-none shrink-0">
        {/* Left Horizontal Scroll & Follow Controls */}
        <div
          className={`${
            isDrums ? 'sm:w-64' : 'sm:w-44'
          } w-full shrink-0 px-3 py-1.5 sm:border-r border-b sm:border-b-0 border-white/[0.07] flex items-center justify-between gap-1.5`}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
onClick={handleToggleFollow}
              className={`px-2 py-0.5 rounded-md border text-[9.5px] font-sans font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                autoFollowPlayhead
                  ? 'bg-white/[0.1] border-white/[0.2] text-zinc-100'
                  : 'bg-[#0B0B0D] border-white/[0.07] text-zinc-400 hover:text-zinc-200'
              }`}
              title="Desplaza automáticamente el editor horizontalmente para seguir el cabezal durante la reproducción"
            >
              <Crosshair size={10} />
              <span>Seguir</span>
            </button>

            <button
              type="button"
              onClick={() => applyHorizontalZoomAtCursor(zoom / 1.45, 0.5)}
              className="p-1 rounded-md bg-[#0B0B0D] hover:bg-[#222228] border border-white/[0.07] text-zinc-400 hover:text-white cursor-pointer"
              title="Alejar Zoom Horizontal"
            >
              <ZoomOut size={11} />
            </button>
            <span className="text-zinc-200 font-semibold tabular-nums px-0.5">
              {zoom.toFixed(1)}x
            </span>
            <button
              type="button"
              onClick={() => applyHorizontalZoomAtCursor(zoom * 1.45, 0.5)}
              className="p-1 rounded-md bg-[#0B0B0D] hover:bg-[#222228] border border-white/[0.07] text-zinc-400 hover:text-white cursor-pointer"
              title="Acercar Zoom Horizontal (Ctrl + Rueda)"
            >
              <ZoomIn size={11} />
            </button>
          </div>

          <span className="text-[9.5px] text-zinc-500 tabular-nums shrink-0">
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
        <div className="hidden sm:flex w-7 shrink-0 border-l border-white/[0.07] bg-[#0E0E12] items-center justify-center">
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
            <span className="text-[9px] text-zinc-600 font-bold" title="Scroll Horizontal">
              H
            </span>
          )}
        </div>

        </div>

      {/* LIVE SELECTED HIT / NOTE INSPECTOR BAR */}
      <div className="px-4 py-2.5 bg-[#0F0F12] border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3 text-[11px] shrink-0">
        {isDrums && selectedHit ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-lg bg-white/[0.07] border border-white/[0.12] text-zinc-100 font-mono font-semibold tabular-nums text-[10.5px]">
                {selectedHit.subRoleLabel || selectedHit.role.toUpperCase()} ·{' '}
                {(hitDragPreview?.hitId === selectedHit.id
                  ? hitDragPreview.peakTimeSec
                  : selectedHit.peakTimeSec
                ).toFixed(3)}
                s
              </span>
              <span className="text-zinc-500 text-[10.5px]">Mover a:</span>
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { label: 'Kick (36)', role: 'kick', midiNote: 36, art: 'closed', color: '#FB923C' },
                    { label: 'Floor Tom (43)', role: 'tom', midiNote: 43, art: 'floor-tom', color: '#10B981' },
                    { label: 'Mid Tom (47)', role: 'tom', midiNote: 47, art: 'mid-tom', color: '#34D399' },
                    { label: 'High Tom (50)', role: 'tom', midiNote: 50, art: 'high-tom', color: '#6EE7B7' },
                    { label: 'Snare (38)', role: 'snare', midiNote: 38, art: 'closed', color: '#22D3EE' },
                    { label: 'Hi-Hat (42)', role: 'hat', midiNote: 42, art: 'closed', color: '#F59E0B' },
                    { label: 'Open Hat (46)', role: 'hat', midiNote: 46, art: 'open', color: '#FCD34D' },
                    { label: 'Crash (49)', role: 'crash', midiNote: 49, art: 'crash', color: '#F472B6' },
                    { label: 'Ride (51)', role: 'crash', midiNote: 51, art: 'ride', color: '#F9A8D4' },
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
                          ? { backgroundColor: opt.color, borderColor: opt.color, color: '#09090B' }
                          : { borderColor: `${opt.color}40` }
                      }
                      className={`px-2 py-0.5 rounded-lg border text-[10px] font-medium cursor-pointer transition-all duration-150 ${
                        isCur
                          ? 'font-semibold shadow-sm'
                          : 'bg-[#17171B] text-zinc-300 hover:text-white hover:bg-[#222228]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 bg-[#17171B] border border-white/[0.08] rounded-lg px-2.5 py-1">
                <span className="text-zinc-400 text-[10px]">Volumen:</span>
                <input
                  type="range"
                  min={MIN_HIT_VEL}
                  max={MAX_HIT_VEL}
                  step={0.01}
                  value={
                    hitDragPreview?.hitId === selectedHit.id
                      ? hitDragPreview.velocity
                      : selectedHit.velocity
                  }
                  onChange={(e) =>
                    r.updateDrumHit(selectedHit.id, { velocity: Number(e.target.value) })
                  }
                  className="w-20 accent-zinc-100 h-1 cursor-pointer"
                />
                <span className="text-zinc-100 font-mono font-semibold tabular-nums text-[10px] w-7 text-right">
                  {Math.round(
                    (hitDragPreview?.hitId === selectedHit.id
                      ? hitDragPreview.velocity
                      : selectedHit.velocity) * 100
                  )}
                  %
                </span>
              </div>

              <div className="flex items-center gap-1 bg-[#17171B] border border-white/[0.08] rounded-lg px-1.5 py-0.5 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() =>
                    r.updateDrumHit(selectedHit.id, { timeSec: selectedHit.timeSec - 0.01 })
                  }
                  className="px-1.5 py-0.5 rounded bg-[#0E0E11] hover:bg-[#27272E] text-zinc-300 hover:text-white cursor-pointer"
                >
                  -10ms
                </button>
                <button
                  type="button"
                  onClick={() =>
                    r.updateDrumHit(selectedHit.id, { timeSec: selectedHit.timeSec + 0.01 })
                  }
                  className="px-1.5 py-0.5 rounded bg-[#0E0E11] hover:bg-[#27272E] text-zinc-300 hover:text-white cursor-pointer"
                >
                  +10ms
                </button>
              </div>

              <button
                type="button"
                onClick={() => r.auditionDrumHit(selectedHit)}
                className="px-2.5 py-1 rounded-lg bg-[#222228] hover:bg-[#2E2E36] border border-white/[0.1] text-zinc-100 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
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
                className="px-2.5 py-1 rounded-lg bg-rose-500/12 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
              >
                <Trash2 size={11} />
                <span>Eliminar</span>
              </button>
            </div>
          </>
        ) : !isDrums && selectedMelodicNote ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-lg bg-white/[0.07] border border-white/[0.12] text-zinc-100 font-mono font-semibold tabular-nums text-[10.5px]">
                Nota {selectedMelodicNote.noteName} (MIDI {selectedMelodicNote.midiNote}) ·{' '}
                {selectedMelodicNote.startSec.toFixed(2)}s
              </span>
              <div className="flex items-center gap-1 bg-[#17171B] border border-white/[0.08] rounded-lg p-0.5 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => {
                    const nextM = selectedMelodicNote.midiNote - 1;
                    r.updateMelodicNote(selectedMelodicNote.id, { midiNote: nextM });
                    r.auditionMelodicNote(nextM, selectedMelodicNote.velocity);
                  }}
                  className="px-2 py-0.5 rounded bg-[#0E0E11] hover:bg-[#27272E] text-zinc-200 cursor-pointer"
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
                  className="px-2 py-0.5 rounded bg-[#0E0E11] hover:bg-[#27272E] text-zinc-200 cursor-pointer"
                >
                  +1 st
                </button>
              </div>
              <div className="flex items-center gap-1 bg-[#17171B] border border-white/[0.08] rounded-lg p-0.5 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() =>
                    r.updateMelodicNote(selectedMelodicNote.id, {
                      durationSec: selectedMelodicNote.durationSec * 0.8,
                    })
                  }
                  className="px-2 py-0.5 rounded bg-[#0E0E11] hover:bg-[#27272E] text-zinc-300 cursor-pointer"
                >
                  Dur −
                </button>
                <button
                  type="button"
                  onClick={() =>
                    r.updateMelodicNote(selectedMelodicNote.id, {
                      durationSec: selectedMelodicNote.durationSec * 1.25,
                    })
                  }
                  className="px-2 py-0.5 rounded bg-[#0E0E11] hover:bg-[#27272E] text-zinc-300 cursor-pointer"
                >
                  Dur +
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  r.auditionMelodicNote(selectedMelodicNote.midiNote, selectedMelodicNote.velocity)
                }
                className="px-2.5 py-1 rounded-lg bg-[#222228] hover:bg-[#2E2E36] border border-white/[0.1] text-zinc-100 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
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
                className="px-2.5 py-1 rounded-lg bg-rose-500/12 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
              >
                <Trash2 size={11} />
                <span>Eliminar</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between w-full gap-2 text-zinc-400 text-[10.5px]">
            <span>
              <strong className="text-zinc-200 font-medium">Edición directa con mouse:</strong>{' '}
              Arrastra un golpe <span className="text-zinc-200">izq/der</span> para mover posición ·{' '}
              Arrastra su <span className="text-zinc-200">borde superior arriba/abajo</span> para cambiar volumen ·{' '}
              <span className="font-mono text-zinc-300">Ctrl+Rueda</span> Zoom H ·{' '}
              <span className="font-mono text-zinc-300">Alt+Rueda</span> Zoom V
            </span>
          </div>
        )}
      </div>

      {/* DEDICATED FULLSCREEN TRANSPORT & A/B STUDIO DOCK */}
      {isFullscreen && (
        <div className="px-4 py-2.5 bg-[#121215] border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={!r.originalBuffer}
              onClick={r.togglePlayback}
              className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-40 transition-all ${
                r.isPlaying
                  ? 'bg-zinc-100 text-zinc-950 shadow-md'
                  : 'bg-[#242429] hover:bg-[#32323A] border border-white/[0.12] text-zinc-100'
              }`}
              title="Reproducir / Pausar (Espacio)"
            >
              {r.isPlaying ? (
                <Pause size={14} className="fill-current" />
              ) : (
                <Play size={14} className="fill-current ml-0.5" />
              )}
            </button>

            <span className="text-xs font-mono text-zinc-300 px-2.5 py-1 rounded-lg bg-[#0B0B0D] border border-white/[0.07] tabular-nums">
              {formatTime(r.currentTimeSec)} <span className="text-zinc-600">/</span>{' '}
              {formatTime(duration)}
            </span>

            {/* Real-time A/B Toggle */}
            <div className="flex items-center bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => r.setAbMode('original')}
                className={`px-3 py-1 rounded-lg font-medium cursor-pointer transition-colors ${
                  r.abMode === 'original'
                    ? 'bg-[#26262C] text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                A: Original
              </button>
              <button
                type="button"
                onClick={() => r.setAbMode('replaced')}
                className={`px-3 py-1 rounded-lg font-medium cursor-pointer transition-colors flex items-center gap-1 ${
                  r.abMode === 'replaced'
                    ? 'bg-zinc-100 text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sparkles size={11} />
                <span>B: Sampleado</span>
              </button>
            </div>

            {r.masterReferenceBuffer && (
              <div className="flex items-center gap-2 bg-[#18181C] border border-white/[0.08] rounded-xl px-2.5 py-1 text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer text-amber-300/90 font-medium">
                  <input
                    type="checkbox"
                    checked={r.listenWithMasterContext}
                    onChange={(e) => r.setListenWithMasterContext(e.target.checked)}
                    className="accent-amber-400"
                  />
                  <span>Probar con Master</span>
                </label>
                {r.listenWithMasterContext && (
                  <>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      step={5}
                      value={r.masterContextVolumePct}
                      onChange={(e) => r.setMasterContextVolumePct(Number(e.target.value))}
                      className="w-16 accent-amber-400 h-1 cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                      {r.masterContextVolumePct}%
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-1 text-[10.5px] font-mono">
              {[1, 2, 4, 8, 16, 32, 64].map((presetZ) => (
                <button
                  key={`fs-z-${presetZ}`}
                  type="button"
                  onClick={() => {
                    if (presetZ === 1) {
                      setZoom(1);
                      setScrollNorm(0);
                    } else {
                      applyHorizontalZoomAtCursor(presetZ, 0.5);
                    }
                  }}
                  className={`px-2 py-0.5 rounded-lg cursor-pointer transition-colors ${
                    Math.abs(zoom - presetZ) < 0.25
                      ? 'bg-zinc-100 text-zinc-950 font-bold'
                      : 'text-zinc-400 hover:text-white hover:bg-[#1E1E24]'
                  }`}
                >
                  {presetZ}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isFullscreen && typeof document !== 'undefined') {
    return createPortal(workstationContent, document.body);
  }

  return workstationContent;
};
