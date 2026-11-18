import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  Magnet,
  Scissors,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Volume2,
  VolumeX,
  Plus,
  Check,
  Sparkles,
  ArrowLeftRight,
  GripVertical,
  Play,
} from 'lucide-react';

export interface ChordEvent {
  chord: string;
  time: number;
}

export interface SectionEvent {
  id?: string;
  name?: string;
  section?: string;
  time: number;
  duration?: number;
  cueEnabled?: boolean;
}

export interface LyricCueItem {
  id?: string;
  time: number;
  startMs?: number;
  duration?: number;
  durationMs?: number;
  text: string;
  placed?: boolean;
}

export interface PrompterProps {
  currentTime: number;
  bpm?: number;
  timeSignature?: string;
  baseOffset?: number;
  beatTimes?: number[];
  chords: ChordEvent[];
  sections: SectionEvent[];
  lyrics?: LyricCueItem[];
  isVamping: boolean;
  gridOffset?: number;
  onVampTrigger?: (sectionStart: number, sectionEnd: number) => void;
  isEditing?: boolean;
  onRemoveSection?: (index: number) => void;
  onEditChord?: (index: number, newChord: string, newTime?: number) => void;
  onAddChord?: (time: number, newChord: string) => void;
  onRemoveChord?: (index: number) => void;
  onSeek?: (time: number) => void;
  // Capacidades CapCut Studio Prompter (Opcionales y 100% retrocompatibles)
  totalDuration?: number;
  waveformPeaks?: number[];
  onUpdateSections?: (nextSections: SectionEvent[], recordUndo?: boolean) => void;
  onPreviewVoiceCue?: (sectionName: string) => void;
  onSaveSections?: () => void;
  hasUnsavedChanges?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export interface SectionSolidStyle {
  bg: string;
  border: string;
  text: string;
  name: string;
  emoji: string;
  hex: string;
  leadInBg: string;
  leadInBorder: string;
}

export interface VoiceGuidePreset {
  id: string;
  name: string;
  shortcut: string;
  emoji: string;
  bg: string;
  border: string;
  hex: string;
}

export const VOICE_GUIDE_PRESETS: VoiceGuidePreset[] = [
  { id: 'intro', name: 'INTRO', shortcut: 'I', emoji: '🔊', bg: 'bg-indigo-600', border: 'border-indigo-400', hex: '#4f46e5' },
  { id: 'verso', name: 'VERSO', shortcut: 'V', emoji: '🎙️', bg: 'bg-sky-600', border: 'border-sky-400', hex: '#0284c7' },
  { id: 'pre-coro', name: 'PRE-CORO', shortcut: 'P', emoji: '⚡', bg: 'bg-amber-600', border: 'border-amber-400', hex: '#d97706' },
  { id: 'coro', name: 'CORO', shortcut: 'C', emoji: '🔥', bg: 'bg-rose-600', border: 'border-rose-400', hex: '#e11d48' },
  { id: 'puente', name: 'PUENTE', shortcut: 'B', emoji: '🌉', bg: 'bg-purple-600', border: 'border-purple-400', hex: '#9333ea' },
  { id: 'solo', name: 'SOLO', shortcut: 'S', emoji: '🎸', bg: 'bg-emerald-600', border: 'border-emerald-400', hex: '#059669' },
  { id: 'final', name: 'FINAL', shortcut: 'F', emoji: '🏁', bg: 'bg-zinc-800', border: 'border-zinc-500', hex: '#27272a' },
];

export const getSectionSolidStyle = (name: string): SectionSolidStyle => {
  const lower = (name || '').toLowerCase();
  if (lower.includes('intro')) {
    return {
      bg: 'bg-indigo-600',
      border: 'border-indigo-700',
      text: 'text-white',
      name: 'INTRO',
      emoji: '🔊',
      hex: '#4f46e5',
      leadInBg: 'bg-indigo-500/15',
      leadInBorder: 'border-indigo-500/50',
    };
  }
  if (lower.includes('verso') || lower.includes('verse')) {
    return {
      bg: 'bg-sky-600',
      border: 'border-sky-700',
      text: 'text-white',
      name: 'VERSO',
      emoji: '🎙️',
      hex: '#0284c7',
      leadInBg: 'bg-sky-500/15',
      leadInBorder: 'border-sky-500/50',
    };
  }
  if (lower.includes('pre-coro') || lower.includes('precoro') || lower.includes('pre chorus') || lower.includes('prechorus')) {
    return {
      bg: 'bg-amber-600',
      border: 'border-amber-700',
      text: 'text-white',
      name: 'PRE-CORO',
      emoji: '⚡',
      hex: '#d97706',
      leadInBg: 'bg-amber-500/15',
      leadInBorder: 'border-amber-500/50',
    };
  }
  if (lower.includes('coro') || lower.includes('chorus')) {
    return {
      bg: 'bg-rose-600',
      border: 'border-rose-700',
      text: 'text-white',
      name: 'CORO',
      emoji: '🔥',
      hex: '#e11d48',
      leadInBg: 'bg-rose-500/15',
      leadInBorder: 'border-rose-500/50',
    };
  }
  if (lower.includes('puente') || lower.includes('bridge')) {
    return {
      bg: 'bg-purple-600',
      border: 'border-purple-700',
      text: 'text-white',
      name: 'PUENTE',
      emoji: '🌉',
      hex: '#9333ea',
      leadInBg: 'bg-purple-500/15',
      leadInBorder: 'border-purple-500/50',
    };
  }
  if (lower.includes('solo') || lower.includes('inter') || lower.includes('instr')) {
    return {
      bg: 'bg-emerald-600',
      border: 'border-emerald-700',
      text: 'text-white',
      name: 'SOLO / INSTR',
      emoji: '🎸',
      hex: '#059669',
      leadInBg: 'bg-emerald-500/15',
      leadInBorder: 'border-emerald-500/50',
    };
  }
  if (lower.includes('final') || lower.includes('outro') || lower.includes('coda')) {
    return {
      bg: 'bg-zinc-800',
      border: 'border-zinc-900',
      text: 'text-white',
      name: 'FINAL',
      emoji: '🏁',
      hex: '#27272a',
      leadInBg: 'bg-zinc-500/15',
      leadInBorder: 'border-zinc-500/50',
    };
  }
  return {
    bg: 'bg-slate-700',
    border: 'border-slate-800',
    text: 'text-white',
    name: (name || 'SECCIÓN').toUpperCase(),
    emoji: '🎵',
    hex: '#334155',
    leadInBg: 'bg-slate-500/15',
    leadInBorder: 'border-slate-500/50',
  };
};

const DEFAULT_PIXELS_PER_BEAT_LIVE = 150;
const DEFAULT_PIXELS_PER_BEAT_STUDIO = 95;
const PLAYHEAD_ANCHOR_X = 140;

const QUICK_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const QUICK_QUALITIES = ['', 'm', '7', 'm7', 'maj7', 'sus4', 'add9', 'dim'];

interface NormalizedSectionBlock {
  id: string;
  originalIndex: number;
  name: string;
  time: number;
  duration: number;
  cueEnabled: boolean;
}

interface SectionDragState {
  mode: 'move' | 'trim-left' | 'trim-right';
  sectionIdx: number;
  sectionId: string;
  sectionName: string;
  initialClientX: number;
  initialStartTime: number;
  initialDuration: number;
  hasMoved: boolean;
}

export const Prompter: React.FC<PrompterProps> = ({
  currentTime,
  bpm,
  timeSignature = '4/4',
  baseOffset,
  beatTimes,
  chords,
  sections,
  lyrics = [],
  isVamping,
  gridOffset,
  onVampTrigger,
  isEditing,
  onRemoveSection,
  onEditChord,
  onAddChord,
  onRemoveChord,
  onSeek,
  totalDuration = 240,
  waveformPeaks = [],
  onUpdateSections,
  onPreviewVoiceCue,
  onSaveSections,
  hasUnsavedChanges = false,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}) => {
  const isStudioCapCutMode = Boolean(onUpdateSections);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);

  const [pixelsPerBeat, setPixelsPerBeat] = useState<number>(
    isStudioCapCutMode ? DEFAULT_PIXELS_PER_BEAT_STUDIO : DEFAULT_PIXELS_PER_BEAT_LIVE
  );
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [snapToDownbeatOnly, setSnapToDownbeatOnly] = useState<boolean>(false);
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number | null>(null);
  const [activeSnapTime, setActiveSnapTime] = useState<number | null>(null);
  const [dragHudInfo, setDragHudInfo] = useState<{
    label: string;
    sublabel: string;
    time: number;
  } | null>(null);

  // Drag & Drop from Top Voice Guide Pill Dock
  const [draggingPresetName, setDraggingPresetName] = useState<string | null>(null);
  const [dropPreviewTime, setDropPreviewTime] = useState<number | null>(null);

  // Ruler scrubbing state
  const isScrubbingRulerRef = useRef<boolean>(false);

  // Chord quick editor / adder state
  const [editingChordIdx, setEditingChordIdx] = useState<number | null>(null);
  const [addingChordTime, setAddingChordTime] = useState<number | null>(null);
  const [editingChordValue, setEditingChordValue] = useState<string>('');
  const [editingChordTime, setEditingChordTime] = useState<number>(0);

  // Custom section name inline input
  const [customLabelInput, setCustomLabelInput] = useState<string>('');

  const activeBpm = bpm && bpm > 0 ? bpm : 120;
  const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
  const beatDuration = 60 / activeBpm;
  const barDuration = beatDuration * beatsPerBar;
  const beatsPerSecond = activeBpm / 60;
  const pixelsPerSecond = beatsPerSecond * pixelsPerBeat;
  const scrollPosition = currentTime * pixelsPerSecond;

  const effectiveTotalDuration = useMemo(() => {
    const maxSecEnd = (sections || []).reduce(
      (acc, s) => Math.max(acc, (s.time || 0) + (s.duration || 16)),
      0
    );
    const maxChord = (chords || []).reduce((acc, c) => Math.max(acc, (c.time || 0) + 8), 0);
    return Math.max(totalDuration || 0, maxSecEnd + 16, maxChord + 16, 120);
  }, [totalDuration, sections, chords]);

  // Normalizar secciones garantizando `id`, `name`, `time`, `duration` explícita y `cueEnabled`
  const sectionBlocks: NormalizedSectionBlock[] = useMemo(() => {
    const defaultBarSpan = barDuration * 4;
    return (sections || []).map((sec, i, arr) => {
      const rawName = (sec.name || sec.section || 'SECCIÓN').toUpperCase();
      const nextSec = arr[i + 1];
      const fallbackDur = nextSec
        ? Math.max(beatDuration, nextSec.time - sec.time)
        : Math.max(beatDuration * 2, defaultBarSpan);
      const explicitDur =
        typeof sec.duration === 'number' && sec.duration >= beatDuration * 0.5
          ? sec.duration
          : fallbackDur;

      return {
        id: sec.id || `sec-${i}-${Math.round(sec.time * 100)}`,
        originalIndex: i,
        name: rawName,
        time: Math.max(0, sec.time),
        duration: explicitDur,
        cueEnabled: sec.cueEnabled !== false,
      };
    });
  }, [sections, barDuration, beatDuration]);

  const sectionBlocksRef = useRef<NormalizedSectionBlock[]>(sectionBlocks);
  useEffect(() => {
    sectionBlocksRef.current = sectionBlocks;
  }, [sectionBlocks]);

  // Mantener selección válida y sincronizar input de nombre
  useEffect(() => {
    if (selectedSectionIdx !== null) {
      const sel = sectionBlocks[selectedSectionIdx];
      if (!sel) {
        setSelectedSectionIdx(null);
      } else {
        setCustomLabelInput(sel.name);
      }
    }
  }, [sectionBlocks, selectedSectionIdx]);

  const selectedSection =
    selectedSectionIdx !== null && sectionBlocks[selectedSectionIdx]
      ? sectionBlocks[selectedSectionIdx]
      : null;

  // Construir grilla musical de Beats y Downbeats (Compases) para Snap Magnético y Renderizado
  const beatGrid = useMemo(() => {
    const baseFirstBeat =
      baseOffset !== undefined ? baseOffset : chords.length > 0 ? chords[0].time : 0;
    const effOffset = baseFirstBeat + (gridOffset || 0);

    const points: { time: number; isDownbeat: boolean; bar: number; beat: number }[] = [];

    if (beatTimes && beatTimes.length > 1) {
      const shiftedBeats = beatTimes.map((rawT) => rawT + (gridOffset || 0));
      let unshiftedCount = 0;
      let firstBeat = shiftedBeats[0];
      while (firstBeat - beatDuration >= -0.001) {
        firstBeat -= beatDuration;
        shiftedBeats.unshift(Math.max(0, firstBeat));
        unshiftedCount++;
      }
      let lastBeat = shiftedBeats[shiftedBeats.length - 1];
      while (lastBeat + beatDuration <= effectiveTotalDuration + barDuration * 2) {
        lastBeat += beatDuration;
        shiftedBeats.push(lastBeat);
      }

      let downbeatZeroIdx = shiftedBeats.findIndex(
        (t) => Math.abs(t - effOffset) < 0.06
      );
      if (downbeatZeroIdx === -1) downbeatZeroIdx = unshiftedCount;

      shiftedBeats.forEach((t, idx) => {
        const relIdx = idx - downbeatZeroIdx;
        const beatInBar = (((relIdx % beatsPerBar) + beatsPerBar) % beatsPerBar) + 1;
        const barNum = Math.floor(relIdx / beatsPerBar) + 1;
        points.push({
          time: t,
          isDownbeat: beatInBar === 1,
          bar: barNum,
          beat: beatInBar,
        });
      });
      return points;
    }

    const startBeatIdx = -Math.ceil(effOffset / beatDuration) - beatsPerBar * 2;
    const totalBeatsCount = Math.ceil(effectiveTotalDuration / beatDuration) + beatsPerBar * 4;

    for (let i = startBeatIdx; i <= totalBeatsCount; i++) {
      const t = effOffset + i * beatDuration;
      const beatInBar = (((i % beatsPerBar) + beatsPerBar) % beatsPerBar) + 1;
      const barNum = Math.floor(i / beatsPerBar) + 1;
      points.push({
        time: t,
        isDownbeat: beatInBar === 1,
        bar: barNum,
        beat: beatInBar,
      });
    }
    return points;
  }, [beatTimes, baseOffset, gridOffset, chords, beatsPerBar, beatDuration, barDuration, effectiveTotalDuration]);

  // Calcular el número de compás para cualquier timestamp en segundos sincronizado 1:1 con beatGrid
  const getBarNumberAtTime = useCallback(
    (timeSec: number): number => {
      if (beatGrid.length > 0) {
        let bestBar = 1;
        for (let i = 0; i < beatGrid.length; i++) {
          const pt = beatGrid[i];
          if (pt.time <= timeSec + 0.04) {
            if (pt.bar >= 1) bestBar = pt.bar;
          } else {
            break;
          }
        }
        return Math.max(1, bestBar);
      }
      const effOffset =
        (baseOffset !== undefined ? baseOffset : chords.length > 0 ? chords[0].time : 0) +
        (gridOffset || 0);
      const rel = timeSec - effOffset;
      return Math.max(1, Math.floor((rel + 0.02) / barDuration) + 1);
    },
    [beatGrid, baseOffset, gridOffset, chords, barDuration]
  );

  // Función de Imán Magnético Estilo CapCut (Compases, Pulsos, Bordes de Secciones y Playhead)
  const snapTimeSec = useCallback(
    (
      candidateTime: number,
      excludeSectionIdx?: number,
      disableSnapOverride?: boolean
    ): { time: number; snapped: boolean; source?: 'section' | 'playhead' | 'downbeat' | 'beat' } => {
      const clamped = Math.max(0, candidateTime);
      if (!snapEnabled || disableSnapOverride) {
        return { time: Number(clamped.toFixed(3)), snapped: false };
      }

      // Umbral dinámico en segundos según el nivel de zoom (~14px en pantalla)
      const thresholdSec = Math.min(0.45, Math.max(0.08, 14 / pixelsPerSecond));
      let bestTime = clamped;
      let minDiff = thresholdSec;
      let source: 'section' | 'playhead' | 'downbeat' | 'beat' | undefined;

      // 1. Prioridad Alta: Bordes de otras secciones (para encaje perfecto back-to-back estilo CapCut)
      sectionBlocksRef.current.forEach((sec, idx) => {
        if (idx === excludeSectionIdx) return;
        const startDiff = Math.abs(clamped - sec.time);
        if (startDiff <= minDiff) {
          minDiff = startDiff;
          bestTime = sec.time;
          source = 'section';
        }
        const end = sec.time + sec.duration;
        const endDiff = Math.abs(clamped - end);
        if (endDiff <= minDiff) {
          minDiff = endDiff;
          bestTime = end;
          source = 'section';
        }
      });

      // 2. Playhead actual
      if (currentTime >= 0 && Math.abs(clamped - currentTime) <= minDiff) {
        minDiff = Math.abs(clamped - currentTime);
        bestTime = currentTime;
        source = 'playhead';
      }

      // 3. Grilla Musical (Downbeats / Compases tienen prioridad magnética)
      const downbeatThreshold = snapToDownbeatOnly ? Math.max(thresholdSec * 1.8, barDuration * 0.35) : thresholdSec * 1.25;
      for (const pt of beatGrid) {
        if (pt.time < 0) continue;
        if (pt.isDownbeat) {
          const diff = Math.abs(clamped - pt.time);
          if (diff <= downbeatThreshold && diff <= minDiff * 1.25) {
            minDiff = diff;
            bestTime = pt.time;
            source = 'downbeat';
          }
        } else if (!snapToDownbeatOnly) {
          const diff = Math.abs(clamped - pt.time);
          if (diff <= minDiff) {
            minDiff = diff;
            bestTime = pt.time;
            source = 'beat';
          }
        }
      }

      return {
        time: Number(Math.max(0, bestTime).toFixed(3)),
        snapped: source !== undefined,
        source,
      };
    },
    [snapEnabled, snapToDownbeatOnly, pixelsPerSecond, currentTime, beatGrid, barDuration]
  );

  // Calcular compás y pulso actual para indicador visual de compás sincronizado con beatGrid
  const currentBeatInfo = useMemo(() => {
    const effOffset =
      (baseOffset !== undefined ? baseOffset : chords.length > 0 ? chords[0].time : 0) +
      (gridOffset || 0);
    const beatDur = 60 / activeBpm;
    const rel = currentTime - effOffset;
    const totalBeats = Math.floor(rel / beatDur);
    const isPreRoll = currentTime < 0;
    const preRollBarIndex = totalBeats < -beatsPerBar ? 1 : 2;

    if (!isPreRoll && beatGrid.length > 0) {
      let activePt = beatGrid[0];
      for (let i = 0; i < beatGrid.length; i++) {
        if (beatGrid[i].time <= currentTime + 0.025) {
          activePt = beatGrid[i];
        } else {
          break;
        }
      }
      if (activePt) {
        return {
          beatInBar: activePt.beat,
          barNumber: Math.max(1, activePt.bar),
          isPreRoll: false,
          preRollBarIndex,
        };
      }
    }

    const beatInBar = (((totalBeats % beatsPerBar) + beatsPerBar) % beatsPerBar) + 1;
    const barNumber = Math.max(1, Math.floor(totalBeats / beatsPerBar) + 1);
    return { beatInBar, barNumber, isPreRoll, preRollBarIndex };
  }, [currentTime, baseOffset, gridOffset, chords, activeBpm, beatsPerBar, beatGrid]);

  // Auto-scroll horizontal sincronizado con currentTime
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.transform = `translateX(calc(${PLAYHEAD_ANCHOR_X}px - ${scrollPosition}px))`;
    }
  }, [currentTime, pixelsPerSecond, scrollPosition]);

  // Dibujar Onda de Audio Real (Waveform) alineada 1:1 al Timeline CapCut sin límite de 28,000px
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !isStudioCapCutMode) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const timelineWidthPx = Math.max(2000, Math.round(effectiveTotalDuration * pixelsPerSecond));
    const bitmapWidth = Math.min(16384, timelineWidthPx);
    const heightPx = 64;
    if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
    if (canvas.height !== heightPx) canvas.height = heightPx;

    ctx.clearRect(0, 0, bitmapWidth, heightPx);

    const peaks = waveformPeaks && waveformPeaks.length > 0 ? waveformPeaks : [];
    if (peaks.length === 0) return;

    const audioSpanSec = totalDuration > 0 ? totalDuration : effectiveTotalDuration;
    const pxPerSecBitmap = bitmapWidth / Math.max(1, effectiveTotalDuration);
    const audioWidthBitmap = Math.min(bitmapWidth, audioSpanSec * pxPerSecBitmap);
    const barCount = Math.min(peaks.length, Math.max(60, Math.floor(audioWidthBitmap / 2.5)));
    const stepPx = audioWidthBitmap / barCount;
    const centerY = heightPx / 2;

    for (let i = 0; i < barCount; i++) {
      const peakIdx = Math.min(peaks.length - 1, Math.floor((i / barCount) * peaks.length));
      const amp = peaks[peakIdx];
      const barH = Math.max(3, amp * (heightPx * 0.85));
      const x = i * stepPx;
      const barTimeSec = (i / barCount) * audioSpanSec;

      const activeSec = sectionBlocks.find(
        (s) => barTimeSec >= s.time && barTimeSec <= s.time + s.duration
      );

      if (activeSec) {
        const st = getSectionSolidStyle(activeSec.name);
        ctx.fillStyle = st.hex + '55';
      } else {
        ctx.fillStyle = 'rgba(161, 161, 170, 0.32)';
      }

      ctx.beginPath();
      ctx.roundRect(x, centerY - barH / 2, Math.max(1.2, stepPx * 0.65), barH, 2);
      ctx.fill();
    }
  }, [waveformPeaks, totalDuration, effectiveTotalDuration, pixelsPerSecond, sectionBlocks, isStudioCapCutMode]);

  // Encontrar sección activa en el tiempo actual
  const activeSectionIndex = useMemo(() => {
    for (let i = sectionBlocks.length - 1; i >= 0; i--) {
      const s = sectionBlocks[i];
      if (currentTime >= s.time && currentTime < s.time + s.duration) {
        return i;
      }
    }
    return -1;
  }, [sectionBlocks, currentTime]);

  const activeSection = activeSectionIndex >= 0 ? sectionBlocks[activeSectionIndex] : null;

  // Acordes cuantizados
  const chordBlocks = useMemo(() => {
    const useRealGrid = beatTimes && beatTimes.length > 1;
    const defaultOffset = chords.length > 0 ? chords[0].time : 0;
    const baseOffsetTime = baseOffset !== undefined ? baseOffset : defaultOffset;
    const gridOffsetTime = baseOffsetTime + (gridOffset || 0);
    const beatDur = activeBpm > 0 ? 60 / activeBpm : 0.5;
    const eighthNoteDuration = beatDur / 2;

    let eighthGrid: number[] = [];
    if (useRealGrid) {
      eighthGrid = [];
      const shifted = beatTimes.map((t) => t + (gridOffset || 0));
      for (let i = 0; i < shifted.length - 1; i++) {
        eighthGrid.push(shifted[i]);
        eighthGrid.push((shifted[i] + shifted[i + 1]) / 2);
      }
      eighthGrid.push(shifted[shifted.length - 1]);
    } else {
      for (let i = -16; i < 2000; i++) {
        eighthGrid.push(gridOffsetTime + i * eighthNoteDuration);
        eighthGrid.push(gridOffsetTime + (i + 0.5) * eighthNoteDuration);
      }
    }

    const quantizedChords = chords
      .map((chord, originalIndex) => {
        let qTime = chord.time;
        if (useRealGrid && eighthGrid.length > 0) {
          let closest = eighthGrid[0];
          let minDiff = Math.abs(closest - chord.time);
          for (let i = 1; i < eighthGrid.length; i++) {
            const diff = Math.abs(eighthGrid[i] - chord.time);
            if (diff < minDiff) {
              minDiff = diff;
              closest = eighthGrid[i];
            }
          }
          if (minDiff < 0.25) {
            qTime = closest;
          }
        } else {
          if (activeBpm > 0 && chord.time !== gridOffsetTime) {
            const timeFromOffset = chord.time - gridOffsetTime;
            const eighthNotes = Math.round(timeFromOffset / eighthNoteDuration);
            const snappedTime = gridOffsetTime + eighthNotes * eighthNoteDuration;
            if (Math.abs(snappedTime - chord.time) < 0.25) {
              qTime = snappedTime;
            }
          }
        }
        return { ...chord, time: qTime, originalIndex };
      })
      .sort((a, b) => a.time - b.time || a.originalIndex - b.originalIndex);

    // Deduplicar acordes que colapsan al mismo pulso/corchea tras cuantizar (conservando el último)
    const dedupedChords: typeof quantizedChords = [];
    for (const c of quantizedChords) {
      const last = dedupedChords[dedupedChords.length - 1];
      if (last && Math.abs(c.time - last.time) < 0.015) {
        dedupedChords[dedupedChords.length - 1] = c;
      } else {
        dedupedChords.push(c);
      }
    }

    return dedupedChords.map((chord, index) => {
      const nextChord = dedupedChords[index + 1];
      const duration = nextChord ? Math.max(0.1, nextChord.time - chord.time) : 10;
      return {
        ...chord,
        duration,
        isActive: currentTime >= chord.time && currentTime < chord.time + duration,
      };
    });
  }, [chords, currentTime, activeBpm, gridOffset, beatTimes, baseOffset]);

  // Preparar cinta de letras sincronizadas (compatible con startMs/durationMs de LyricStudio y time/duration)
  const lyricBlocks = useMemo(() => {
    if (!lyrics || lyrics.length === 0) return [];
    const normalized = lyrics
      .filter((l) => l.placed !== false)
      .map((l) => ({
        ...l,
        time: typeof l.time === 'number' ? l.time : (l.startMs || 0) / 1000,
        duration:
          typeof l.duration === 'number' && l.duration > 0
            ? l.duration
            : typeof l.durationMs === 'number' && l.durationMs > 0
            ? l.durationMs / 1000
            : undefined,
      }));
    const sorted = [...normalized].sort((a, b) => a.time - b.time);
    return sorted.map((line, i) => {
      const next = sorted[i + 1];
      const dur =
        line.duration && line.duration > 0
          ? line.duration
          : next
          ? Math.max(0.5, Math.min(8, next.time - line.time))
          : 4;
      const isActive = currentTime >= line.time && currentTime < line.time + dur;
      return { ...line, duration: dur, isActive };
    });
  }, [lyrics, currentTime]);

  // Handler Vamp Loop (respeta la duración recortada/estirada en CapCut)
  const handleVamp = () => {
    if (onVampTrigger) {
      if (activeSectionIndex >= 0 && activeSection) {
        const start = activeSection.time;
        const end = start + activeSection.duration;
        onVampTrigger(start, end);
      } else {
        const barLen = barDuration * 4;
        onVampTrigger(Math.max(0, currentTime), Math.max(0, currentTime) + barLen);
      }
    }
  };

  const commitChordEdit = () => {
    const cleanVal = editingChordValue.trim();
    const cleanTime = Number(Math.max(0, editingChordTime).toFixed(3));
    if (cleanVal) {
      if (addingChordTime !== null && onAddChord) {
        onAddChord(cleanTime, cleanVal);
      } else if (editingChordIdx !== null && onEditChord) {
        onEditChord(editingChordIdx, cleanVal, cleanTime);
      }
    }
    setEditingChordIdx(null);
    setAddingChordTime(null);
  };

  // ============================================================================
  // OPERACIONES CAPCUT SOBRE SECCIONES Y VOZ GUÍA (INSERT, DRAG, TRIM, SPLIT)
  // ============================================================================

  const emitSectionsUpdate = useCallback(
    (nextList: NormalizedSectionBlock[], recordUndo = true) => {
      if (!onUpdateSections) return;
      const sorted = [...nextList].sort((a, b) => a.time - b.time);
      if (dragStateRef.current) {
        const activeDragIdx = sorted.findIndex((s) => s.id === dragStateRef.current?.sectionId);
        if (activeDragIdx !== -1) {
          setSelectedSectionIdx(activeDragIdx);
        }
      }
      const serialized: SectionEvent[] = sorted.map((s) => ({
        id: s.id,
        name: s.name,
        time: Number(Math.max(0, s.time).toFixed(3)),
        duration: Number(Math.max(beatDuration, s.duration).toFixed(3)),
        cueEnabled: s.cueEnabled,
      }));
      onUpdateSections(serialized, recordUndo);
    },
    [onUpdateSections, beatDuration]
  );

  // Insertar o soltar una sección en un tiempo dado (encajando limpiamente sin pisar la siguiente)
  const insertSectionAtTime = useCallback(
    (presetName: string, rawTargetTime: number, playPreview = true) => {
      if (!onUpdateSections) return;
      const snapped = snapTimeSec(Math.max(0, rawTargetTime));
      const startTime = snapped.time;
      const defaultDur = barDuration * 4; // 4 compases por defecto

      const current = [...sectionBlocksRef.current];
      // Si ya existe una sección exactamente en el mismo pulso (<0.25s), cambiarle el nombre
      const existingIdx = current.findIndex((s) => Math.abs(s.time - startTime) < 0.25);
      if (existingIdx !== -1) {
        current[existingIdx] = {
          ...current[existingIdx],
          name: presetName.toUpperCase(),
        };
        emitSectionsUpdate(current, true);
        setSelectedSectionIdx(existingIdx);
        if (playPreview && onPreviewVoiceCue) onPreviewVoiceCue(presetName);
        return;
      }

      // Si cae dentro de una sección anterior que se alargaba demasiado, recortar la anterior automáticamente (Auto-Trim CapCut)
      current.forEach((s, idx) => {
        if (s.time < startTime && s.time + s.duration > startTime) {
          current[idx] = {
            ...s,
            duration: Math.max(beatDuration, startTime - s.time),
          };
        }
      });

      // Ajustar duración para no solapar la siguiente sección
      const nextAfter = current
        .filter((s) => s.time > startTime + 0.1)
        .sort((a, b) => a.time - b.time)[0];
      const computedDur = nextAfter
        ? Math.min(defaultDur, Math.max(beatDuration, nextAfter.time - startTime))
        : defaultDur;

      const newBlock: NormalizedSectionBlock = {
        id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        originalIndex: current.length,
        name: presetName.toUpperCase(),
        time: startTime,
        duration: computedDur,
        cueEnabled: true,
      };

      const nextList = [...current, newBlock].sort((a, b) => a.time - b.time);
      const newIdx = nextList.findIndex((s) => s.id === newBlock.id);
      emitSectionsUpdate(nextList, true);
      setSelectedSectionIdx(newIdx !== -1 ? newIdx : null);

      if (playPreview && onPreviewVoiceCue) {
        onPreviewVoiceCue(presetName);
      }
    },
    [onUpdateSections, snapTimeSec, barDuration, beatDuration, emitSectionsUpdate, onPreviewVoiceCue]
  );

  // Drag & Trim Pointer Listeners (CapCut Move, Trim-Left, Trim-Right)
  const dragStateRef = useRef<SectionDragState | null>(null);

  useEffect(() => {
    if (!isStudioCapCutMode) return;

    const handleWindowPointerMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;

      const deltaPx = e.clientX - drag.initialClientX;
      if (Math.abs(deltaPx) <= 2 && !drag.hasMoved) return;
      const shouldRecordUndo = !drag.hasMoved;
      drag.hasMoved = true;

      const deltaSec = deltaPx / pixelsPerSecond;
      const disableSnap = e.altKey;
      const rippleAdjacent = e.shiftKey;
      const current = [...sectionBlocksRef.current];
      const targetIdx = current.findIndex((s) => s.id === drag.sectionId);
      if (targetIdx === -1) return;

      const target = current[targetIdx];
      const prevSec = targetIdx > 0 ? current[targetIdx - 1] : null;
      const nextSec = targetIdx < current.length - 1 ? current[targetIdx + 1] : null;

      if (drag.mode === 'move') {
        const rawStart = Math.max(0, drag.initialStartTime + deltaSec);
        const snapped = snapTimeSec(rawStart, targetIdx, disableSnap);
        const newStart = snapped.time;
        setActiveSnapTime(snapped.snapped ? newStart : null);

        const startBar = getBarNumberAtTime(newStart);
        const leadInBar = Math.max(1, startBar - 1);
        const barsCount = Math.max(0.25, Number((target.duration / barDuration).toFixed(1)));
        setDragHudInfo({
          label: `MOVIENDO ${target.name} → COMPÁS ${startBar}`,
          sublabel: target.cueEnabled
            ? `🎙️ Voz Guía cuenta en Compás ${leadInBar} • Duración: ${barsCount} compases`
            : `🔕 Voz Guía silenciada • Duración: ${barsCount} compases`,
          time: newStart,
        });

        current[targetIdx] = {
          ...target,
          time: newStart,
        };
        emitSectionsUpdate(current, shouldRecordUndo);
      } else if (drag.mode === 'trim-left') {
        const originalEnd = drag.initialStartTime + drag.initialDuration;
        const maxStart = originalEnd - beatDuration;
        const minStart = !rippleAdjacent && prevSec ? prevSec.time + beatDuration : 0;
        const rawStart = Math.max(minStart, Math.min(maxStart, drag.initialStartTime + deltaSec));
        const snapped = snapTimeSec(rawStart, targetIdx, disableSnap);
        const clampedStart = Math.max(minStart, Math.min(maxStart, snapped.time));
        const newDuration = Math.max(beatDuration, originalEnd - clampedStart);

        setActiveSnapTime(snapped.snapped ? clampedStart : null);

        // Si el usuario recorta hacia atrás pisando la cola de la sección anterior, o mantiene Shift, ajusta la anterior
        if (prevSec && (rippleAdjacent || prevSec.time + prevSec.duration > clampedStart)) {
          current[targetIdx - 1] = {
            ...prevSec,
            duration: Math.max(beatDuration, clampedStart - prevSec.time),
          };
        }

        const startBar = getBarNumberAtTime(clampedStart);
        const barsCount = Math.max(0.25, Number((newDuration / barDuration).toFixed(1)));
        setDragHudInfo({
          label: `RECORTANDO INICIO DE ${target.name} (COMPÁS ${startBar})`,
          sublabel: `Nueva duración: ${barsCount} compases (${newDuration.toFixed(1)}s)`,
          time: clampedStart,
        });

        current[targetIdx] = {
          ...target,
          time: clampedStart,
          duration: newDuration,
        };
        emitSectionsUpdate(current, shouldRecordUndo);
      } else if (drag.mode === 'trim-right') {
        const rawEnd = Math.max(
          drag.initialStartTime + beatDuration,
          drag.initialStartTime + drag.initialDuration + deltaSec
        );
        const snapped = snapTimeSec(rawEnd, targetIdx, disableSnap);
        let clampedEnd = Math.max(drag.initialStartTime + beatDuration, snapped.time);

        if (nextSec && !rippleAdjacent && clampedEnd > nextSec.time) {
          clampedEnd = nextSec.time;
        } else if (nextSec && rippleAdjacent && clampedEnd > nextSec.time) {
          const nextOrigEnd = nextSec.time + nextSec.duration;
          if (clampedEnd < nextOrigEnd - beatDuration) {
            current[targetIdx + 1] = {
              ...nextSec,
              time: clampedEnd,
              duration: Math.max(beatDuration, nextOrigEnd - clampedEnd),
            };
          }
        }

        const newDuration = Math.max(beatDuration, clampedEnd - drag.initialStartTime);
        setActiveSnapTime(snapped.snapped ? clampedEnd : null);

        const barsCount = Math.max(0.25, Number((newDuration / barDuration).toFixed(1)));
        setDragHudInfo({
          label: `ALARGANDO / RECORTANDO ${target.name}`,
          sublabel: `${barsCount} compases (${newDuration.toFixed(1)}s)`,
          time: clampedEnd,
        });

        current[targetIdx] = {
          ...target,
          duration: newDuration,
        };
        emitSectionsUpdate(current, shouldRecordUndo);
      }
    };

    const handleWindowPointerUp = () => {
      const drag = dragStateRef.current;
      if (drag) {
        if (drag.mode === 'move' && drag.hasMoved) {
          const sorted = [...sectionBlocksRef.current].sort((a, b) => a.time - b.time);
          let hasOverlapTrim = false;
          for (let i = 0; i < sorted.length - 1; i++) {
            const cur = sorted[i];
            const nxt = sorted[i + 1];
            if (cur.time + cur.duration > nxt.time + 0.02) {
              sorted[i] = {
                ...cur,
                duration: Math.max(beatDuration, nxt.time - cur.time),
              };
              hasOverlapTrim = true;
            }
          }
          if (hasOverlapTrim) {
            emitSectionsUpdate(sorted, false);
          }
        }
        dragStateRef.current = null;
        setActiveSnapTime(null);
        setDragHudInfo(null);
      }
      if (isScrubbingRulerRef.current) {
        isScrubbingRulerRef.current = false;
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
    };
  }, [
    isStudioCapCutMode,
    pixelsPerSecond,
    snapTimeSec,
    getBarNumberAtTime,
    barDuration,
    beatDuration,
    emitSectionsUpdate,
  ]);

  // Dividir Sección en el Playhead o a la mitad (Estilo CapCut Split 'S')
  const handleSplitSelectedSection = useCallback(() => {
    if (selectedSectionIdx === null || !sectionBlocks[selectedSectionIdx]) return;
    const target = sectionBlocks[selectedSectionIdx];
    if (target.duration < beatDuration * 2) return;

    const isPlayheadInside =
      currentTime > target.time + beatDuration * 0.5 &&
      currentTime < target.time + target.duration - beatDuration * 0.5;

    const rawSplitTime = isPlayheadInside ? currentTime : target.time + target.duration / 2;
    const snappedSplit = snapTimeSec(rawSplitTime, selectedSectionIdx);
    const splitPoint =
      snappedSplit.time > target.time + beatDuration * 0.5 &&
      snappedSplit.time < target.time + target.duration - beatDuration * 0.5
        ? snappedSplit.time
        : rawSplitTime;

    const firstDur = Math.max(beatDuration, splitPoint - target.time);
    const secondDur = Math.max(beatDuration, target.time + target.duration - splitPoint);

    const firstPart: NormalizedSectionBlock = {
      ...target,
      duration: firstDur,
    };
    const secondPart: NormalizedSectionBlock = {
      ...target,
      id: `sec-split-${Date.now()}`,
      time: splitPoint,
      duration: secondDur,
    };

    const next = [...sectionBlocks];
    next.splice(selectedSectionIdx, 1, firstPart, secondPart);
    emitSectionsUpdate(next, true);
    setSelectedSectionIdx(selectedSectionIdx + 1);
  }, [selectedSectionIdx, sectionBlocks, beatDuration, currentTime, snapTimeSec, emitSectionsUpdate]);

  // Duplicar Sección Seleccionada (con Ripple Shift automático para evitar solapamientos)
  const handleDuplicateSelectedSection = useCallback(() => {
    if (selectedSectionIdx === null || !sectionBlocks[selectedSectionIdx]) return;
    const target = sectionBlocks[selectedSectionIdx];
    const newStart = target.time + target.duration;
    const snappedStart = snapTimeSec(newStart, selectedSectionIdx).time;

    const dup: NormalizedSectionBlock = {
      ...target,
      id: `sec-dup-${Date.now()}`,
      time: snappedStart,
    };

    const nextFollowing = sectionBlocks[selectedSectionIdx + 1];
    const needsRipple = nextFollowing && nextFollowing.time < snappedStart + target.duration - 0.02;
    const rippleShift = needsRipple
      ? Math.max(beatDuration, snappedStart + target.duration - nextFollowing.time)
      : 0;

    const next = sectionBlocks.map((sec, idx) => {
      if (idx > selectedSectionIdx && rippleShift > 0) {
        return {
          ...sec,
          time: Number((sec.time + rippleShift).toFixed(3)),
        };
      }
      return sec;
    });

    next.splice(selectedSectionIdx + 1, 0, dup);
    emitSectionsUpdate(next, true);
    setSelectedSectionIdx(selectedSectionIdx + 1);
  }, [selectedSectionIdx, sectionBlocks, beatDuration, snapTimeSec, emitSectionsUpdate]);

  // Cambiar nombre o tipo de Voz Guía de la sección seleccionada
  const handleUpdateSelectedSection = useCallback(
    (updates: Partial<NormalizedSectionBlock>, recordUndo = true) => {
      if (selectedSectionIdx === null || !sectionBlocks[selectedSectionIdx]) return;
      const next = sectionBlocks.map((s, idx) =>
        idx === selectedSectionIdx ? { ...s, ...updates } : s
      );
      emitSectionsUpdate(next, recordUndo);
    },
    [selectedSectionIdx, sectionBlocks, emitSectionsUpdate]
  );

  // Ajustar duración de la sección seleccionada por número de compases (+1c, -1c, 4c, 8c)
  const handleChangeSelectedBars = useCallback(
    (deltaOrExactBars: number, isExact = false) => {
      if (selectedSectionIdx === null || !sectionBlocks[selectedSectionIdx]) return;
      const target = sectionBlocks[selectedSectionIdx];
      const nextDur = isExact
        ? barDuration * deltaOrExactBars
        : Math.max(beatDuration, target.duration + barDuration * deltaOrExactBars);
      handleUpdateSelectedSection({ duration: nextDur }, true);
    },
    [selectedSectionIdx, sectionBlocks, barDuration, beatDuration, handleUpdateSelectedSection]
  );

  // Encajar el final de la sección seleccionada exactamente al inicio de la siguiente (Fill Gap)
  const handleFitSelectedToNext = useCallback(() => {
    if (selectedSectionIdx === null || !sectionBlocks[selectedSectionIdx]) return;
    const target = sectionBlocks[selectedSectionIdx];
    const nextSec = sectionBlocks[selectedSectionIdx + 1];
    if (!nextSec) return;
    const gapDur = Math.max(beatDuration, nextSec.time - target.time);
    handleUpdateSelectedSection({ duration: gapDur }, true);
  }, [selectedSectionIdx, sectionBlocks, beatDuration, handleUpdateSelectedSection]);

  // Auto-Encajar TODAS las secciones consecutivamente (Lego / CapCut Magnetic Fit All)
  const handleMagneticFitAll = useCallback(() => {
    if (sectionBlocks.length === 0) return;
    const next = sectionBlocks.map((sec, idx, arr) => {
      const snappedStart = snapTimeSec(sec.time, idx).time;
      const following = arr[idx + 1];
      const nextSnappedStart = following ? snapTimeSec(following.time, idx + 1).time : null;
      const fittedDur =
        nextSnappedStart !== null && nextSnappedStart > snappedStart
          ? Math.max(beatDuration, nextSnappedStart - snappedStart)
          : sec.duration;
      return {
        ...sec,
        time: snappedStart,
        duration: fittedDur,
      };
    });
    emitSectionsUpdate(next, true);
  }, [sectionBlocks, snapTimeSec, beatDuration, emitSectionsUpdate]);

  // Eliminar sección seleccionada
  const handleDeleteSelectedSection = useCallback(() => {
    if (selectedSectionIdx === null) return;
    if (onUpdateSections) {
      const next = sectionBlocks.filter((_, idx) => idx !== selectedSectionIdx);
      emitSectionsUpdate(next, true);
    } else if (onRemoveSection) {
      onRemoveSection(selectedSectionIdx);
    }
    setSelectedSectionIdx(null);
  }, [selectedSectionIdx, onUpdateSections, sectionBlocks, emitSectionsUpdate, onRemoveSection]);

  // Convertir coordenada X del cliente dentro de trackAreaRef a segundos en la canción
  const clientXToSongTime = useCallback(
    (clientX: number): number => {
      if (!trackAreaRef.current) return Math.max(0, currentTime);
      const rect = trackAreaRef.current.getBoundingClientRect();
      const offsetFromPlayheadPx = clientX - rect.left - PLAYHEAD_ANCHOR_X;
      return Math.max(0, currentTime + offsetFromPlayheadPx / pixelsPerSecond);
    },
    [currentTime, pixelsPerSecond]
  );

  // Atajos de teclado CapCut cuando estamos en Studio Prompter (Delete/Backspace, S para dividir, Ctrl+D duplicar, Ctrl+Z/Y)
  useEffect(() => {
    if (!isStudioCapCutMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo?.();
        else onUndo?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        onRedo?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (selectedSectionIdx !== null) {
          e.preventDefault();
          handleDuplicateSelectedSection();
        }
        return;
      }
      if (!isEditing && e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (selectedSectionIdx !== null) {
          e.preventDefault();
          handleSplitSelectedSection();
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSectionIdx !== null) {
        e.preventDefault();
        handleDeleteSelectedSection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isStudioCapCutMode,
    isEditing,
    selectedSectionIdx,
    onUndo,
    onRedo,
    handleDuplicateSelectedSection,
    handleSplitSelectedSection,
    handleDeleteSelectedSection,
  ]);

  const formatMmSs = (sec: number) => {
    const abs = Math.max(0, sec);
    const m = Math.floor(abs / 60);
    const s = Math.floor(abs % 60);
    const d = Math.floor((abs % 1) * 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
  };

  return (
    <div className="prompter-container bg-white text-zinc-900 p-0 rounded-2xl overflow-hidden h-full w-full relative border border-zinc-200 select-none flex flex-col">
      {/* 1. HEADER OVERLAY / STUDIO PROMPTER TOP BAR */}
      <div className="bg-white border-b border-zinc-200 px-5 py-2.5 z-30 flex flex-wrap justify-between items-center gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#e11d48]" />
              <h2 className="text-sm font-bold text-black uppercase tracking-[0.14em] leading-none">
                {currentTime < 0
                  ? currentBeatInfo.preRollBarIndex === 1
                    ? 'CONTEO PRE-ROLL (TEMPO)'
                    : 'CONTEO PRE-ROLL (VOZ GUÍA)'
                  : activeSection
                  ? activeSection.name
                  : 'EN ESPERA'}
              </h2>
              {isStudioCapCutMode && (
                <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-[#e11d48] text-[9px] font-black uppercase tracking-wider">
                  CapCut Timeline Activo
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-500 font-mono mt-1 uppercase tracking-wider pl-4">
              {isStudioCapCutMode
                ? 'ARRASTRA PÍLDORAS AL COMPÁS • ESTIRA LOS BORDES [ ▌ ▐ ] PARA RECORTAR O ALARGAR CADA SECCIÓN'
                : `GRILLA DE COMPASES, ACORDES Y VOZ GUÍA ${
                    onEditChord ? '• DOBLE CLIC EN UN ACORDE PARA EDITAR' : ''
                  }`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Controles CapCut de Imán, Auto-Encaje, Undo/Redo y Zoom (Solo en Studio Prompter) */}
          {isStudioCapCutMode && (
            <div className="flex items-center gap-1.5 bg-zinc-100 border border-zinc-200 rounded-full p-1 px-2.5">
              <button
                type="button"
                onClick={() => setSnapEnabled((v) => !v)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer ${
                  snapEnabled
                    ? 'bg-zinc-900 text-white shadow-xs'
                    : 'bg-white text-zinc-500 border border-zinc-200 hover:text-zinc-900'
                }`}
                title="Imán automático a Compases, Pulsos y Bordes de Sección (Mantén Alt al arrastrar para mover libre)"
              >
                <Magnet size={11} className={snapEnabled ? 'text-amber-400' : ''} />
                <span>Imán</span>
              </button>

              {snapEnabled && (
                <button
                  type="button"
                  onClick={() => setSnapToDownbeatOnly((v) => !v)}
                  className={`px-2 py-1 rounded-full text-[9.5px] font-mono font-bold uppercase transition-all cursor-pointer ${
                    snapToDownbeatOnly
                      ? 'bg-amber-500 text-black'
                      : 'bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50'
                  }`}
                  title="Alternar entre Imán por Compás exacto (Golpe 1) o Imán por cada Pulso (1, 2, 3, 4)"
                >
                  {snapToDownbeatOnly ? '1/1 Compás' : '1/4 Pulso'}
                </button>
              )}

              <button
                type="button"
                onClick={handleMagneticFitAll}
                disabled={sectionBlocks.length === 0}
                className="px-2.5 py-1 rounded-full bg-white hover:bg-zinc-200 disabled:opacity-40 text-zinc-800 border border-zinc-200 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                title="Encajar magnéticamente todas las secciones una tras otra sin huecos (Auto-Fit)"
              >
                <Sparkles size={11} className="text-[#e11d48]" />
                <span>Encajar Todo</span>
              </button>

              <div className="w-px h-4 bg-zinc-300 mx-0.5" />

              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                className="p-1 rounded-full bg-white hover:bg-zinc-200 disabled:opacity-35 text-zinc-700 border border-zinc-200 cursor-pointer"
                title="Deshacer (Ctrl+Z)"
              >
                <Undo2 size={12} />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                className="p-1 rounded-full bg-white hover:bg-zinc-200 disabled:opacity-35 text-zinc-700 border border-zinc-200 cursor-pointer"
                title="Rehacer (Ctrl+Y)"
              >
                <Redo2 size={12} />
              </button>

              <div className="w-px h-4 bg-zinc-300 mx-0.5" />

              <button
                type="button"
                onClick={() => setPixelsPerBeat((z) => Math.max(40, z - 15))}
                className="p-1 text-zinc-600 hover:text-black cursor-pointer"
                title="Alejar vista (Ver más compases)"
              >
                <ZoomOut size={13} />
              </button>
              <input
                type="range"
                min={40}
                max={200}
                value={pixelsPerBeat}
                onChange={(e) => setPixelsPerBeat(Number(e.target.value))}
                className="w-20 accent-[#e11d48] cursor-pointer h-1"
                title="Zoom de la línea de tiempo"
              />
              <button
                type="button"
                onClick={() => setPixelsPerBeat((z) => Math.min(200, z + 15))}
                className="p-1 text-zinc-600 hover:text-black cursor-pointer"
                title="Acercar vista (Precisión por pulso)"
              >
                <ZoomIn size={13} />
              </button>
            </div>
          )}

          {/* Indicador de Pulso del Compás en Tiempo Real */}
          <div className="apple-glass-island flex items-center gap-1.5 p-1 px-3 rounded-full bg-zinc-100 border border-zinc-200">
            <span className="text-[10px] font-mono font-semibold text-zinc-700 uppercase mr-1 tracking-wider tabular-nums">
              {currentTime < 0
                ? `PRE ${currentBeatInfo.preRollBarIndex}/2`
                : `COMPÁS ${Math.max(1, currentBeatInfo.barNumber)}`}
            </span>
            {Array.from({ length: beatsPerBar }).map((_, bIdx) => {
              const beatNum = bIdx + 1;
              const isCurrentBeat = currentBeatInfo.beatInBar === beatNum;
              return (
                <div
                  key={beatNum}
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono font-bold transition-all tabular-nums ${
                    isCurrentBeat
                      ? beatNum === 1
                        ? 'ruby-pill-accent text-white scale-110 font-bold'
                        : 'bg-black text-white scale-105 font-bold'
                      : 'bg-white text-zinc-700 border border-zinc-300 font-semibold'
                  }`}
                >
                  {beatNum}
                </div>
              );
            })}
          </div>

          {onVampTrigger && (
            <button
              onClick={handleVamp}
              className={`px-3.5 py-1.5 rounded-full font-semibold text-[11px] uppercase tracking-wide transition-all cursor-pointer ${
                isVamping
                  ? 'ruby-pill-accent text-white'
                  : 'apple-glass-card text-zinc-800 hover:text-black hover:bg-zinc-100'
              }`}
              title="Repetir en bucle la sección actual respetando su duración recortada (Vamp Loop)"
            >
              {isVamping ? '🔁 VAMP ACTIVO' : '🔁 VAMP SECCIÓN'}
            </button>
          )}
        </div>
      </div>

      {/* 2. DOCK DE PÍLDORAS DE VOZ GUÍA + INSPECTOR CAPCUT DE SECCIÓN (Solo en Studio Prompter) */}
      {isStudioCapCutMode && (
        <div className="bg-zinc-50 border-b border-zinc-200 px-5 py-2 z-20 flex flex-col gap-2 shrink-0">
          {/* Fila A: Píldoras Arrastrables (Drag & Drop o 1 Clic para insertar en Playhead) */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mr-1 flex items-center gap-1">
                <span>🎙️ Píldoras Voz Guía:</span>
              </span>
              {VOICE_GUIDE_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', preset.name);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDraggingPresetName(preset.name);
                  }}
                  onDragEnd={() => {
                    setDraggingPresetName(null);
                    setDropPreviewTime(null);
                  }}
                  onClick={() => insertSectionAtTime(preset.name, Math.max(0, currentTime), true)}
                  className={`group flex items-center gap-1.5 px-3 py-1 rounded-xl text-white ${preset.bg} border ${preset.border} shadow-xs hover:brightness-110 active:scale-95 transition-all cursor-grab active:cursor-grabbing select-none`}
                  title={`Arrastra "${preset.name}" a la línea de tiempo o haz clic para insertarla en el cabezal actual (Atajo: Tecla ${preset.shortcut})`}
                >
                  <GripVertical size={11} className="opacity-70 -ml-1" />
                  <span className="text-xs">{preset.emoji}</span>
                  <span className="text-[11px] font-black uppercase tracking-wider">
                    {preset.name}
                  </span>
                  <kbd className="text-[9px] font-mono bg-black/25 px-1.5 py-0.2 rounded text-white/90 font-bold">
                    {preset.shortcut}
                  </kbd>
                  <Plus size={11} className="opacity-75 group-hover:scale-125 transition-transform" />
                </div>
              ))}
            </div>

              <div className="flex items-center gap-1.5">
                {onAddChord && (
                  <button
                    type="button"
                    onClick={() => {
                      const snapped = snapTimeSec(Math.max(0, currentTime));
                      setEditingChordIdx(null);
                      setAddingChordTime(snapped.time);
                      setEditingChordTime(snapped.time);
                      setEditingChordValue('C');
                    }}
                    className="px-3 py-1.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300/90 text-[10.5px] font-black uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                    title="Insertar un nuevo acorde en la posición del cabezal (También puedes hacer doble clic en el carril de acordes)"
                  >
                    <Plus size={12} className="text-amber-600" />
                    <span>+ Acorde</span>
                  </button>
                )}

                {onSaveSections && (
                  <button
                    type="button"
                    onClick={onSaveSections}
                    className={`px-3.5 py-1.5 rounded-full text-[10.5px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                      hasUnsavedChanges
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm ring-2 ring-emerald-500/30'
                        : 'bg-zinc-900 hover:bg-zinc-800 text-white'
                    }`}
                    title="Guardar la estructura y Voz Guía en la nube"
                  >
                    <Check size={12} />
                    <span>{hasUnsavedChanges ? 'Guardar Cambios de Voz Guía' : 'Voz Guía Sincronizada'}</span>
                  </button>
                )}
              </div>
          </div>

          {/* Fila B: Inspector Rápido CapCut cuando hay una sección seleccionada */}
          {selectedSection && selectedSectionIdx !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-zinc-200/90 rounded-xl px-3.5 py-1.5 shadow-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                  Editando Bloque #{selectedSectionIdx + 1}:
                </span>

                {/* Selector rápido para cambiar la voz guía del bloque seleccionado */}
                <div className="flex items-center gap-1">
                  {VOICE_GUIDE_PRESETS.map((p) => {
                    const isCurrentType = selectedSection.name.toUpperCase().startsWith(p.name);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          handleUpdateSelectedSection({ name: p.name }, true);
                          onPreviewVoiceCue?.(p.name);
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer ${
                          isCurrentType
                            ? `${p.bg} text-white shadow-xs scale-105`
                            : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
                        }`}
                        title={`Cambiar Voz Guía de esta sección a ${p.name}`}
                      >
                        {p.emoji} {p.name}
                      </button>
                    );
                  })}
                </div>

                {/* Etiqueta personalizada (Ej. VERSO 1, CORO 2) manteniendo la voz guía */}
                <input
                  type="text"
                  value={customLabelInput}
                  onChange={(e) => setCustomLabelInput(e.target.value.toUpperCase())}
                  onBlur={() => {
                    if (customLabelInput.trim() && customLabelInput.trim() !== selectedSection.name) {
                      handleUpdateSelectedSection({ name: customLabelInput.trim() }, true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-28 bg-zinc-50 border border-zinc-300 focus:border-[#e11d48] rounded-lg px-2 py-0.5 text-[11px] font-mono font-bold text-zinc-900 outline-none uppercase"
                  placeholder="Etiqueta..."
                  title="Personalizar texto (Ej. VERSO 1, CORO FINAL). La Voz Guía se detecta automáticamente por la palabra clave."
                />
              </div>

              {/* Herramientas de Recorte, Duración por Compases, División y Pre-escucha */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center gap-1 bg-zinc-100 border border-zinc-200 rounded-lg px-2 py-0.5 text-[10px] font-mono text-zinc-700">
                  <span className="font-bold text-zinc-900">
                    Compás {getBarNumberAtTime(selectedSection.time)}
                  </span>
                  <span>•</span>
                  <span>{formatMmSs(selectedSection.time)}</span>
                  <span>→</span>
                  <span>{formatMmSs(selectedSection.time + selectedSection.duration)}</span>
                  <span className="text-[#e11d48] font-bold">
                    ({Math.max(0.25, Number((selectedSection.duration / barDuration).toFixed(1)))} comp.)
                  </span>
                </div>

                {/* Botones rápidos de duración en compases */}
                <div className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-200 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => handleChangeSelectedBars(-1, false)}
                    className="px-1.5 py-0.5 rounded hover:bg-white text-[10px] font-mono font-bold text-zinc-700 cursor-pointer"
                    title="Recortar 1 compás (-1 Bar)"
                  >
                    -1c
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeSelectedBars(1, false)}
                    className="px-1.5 py-0.5 rounded hover:bg-white text-[10px] font-mono font-bold text-zinc-700 cursor-pointer"
                    title="Alargar 1 compás (+1 Bar)"
                  >
                    +1c
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeSelectedBars(4, true)}
                    className="px-1.5 py-0.5 rounded hover:bg-white text-[10px] font-mono font-bold text-zinc-700 cursor-pointer"
                    title="Fijar duración exacta de 4 compases"
                  >
                    4c
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeSelectedBars(8, true)}
                    className="px-1.5 py-0.5 rounded hover:bg-white text-[10px] font-mono font-bold text-zinc-700 cursor-pointer"
                    title="Fijar duración exacta de 8 compases"
                  >
                    8c
                  </button>
                  {selectedSectionIdx < sectionBlocks.length - 1 && (
                    <button
                      type="button"
                      onClick={handleFitSelectedToNext}
                      className="px-2 py-0.5 rounded bg-white hover:bg-rose-50 text-[#e11d48] border border-zinc-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                      title="Estirar o recortar automáticamente hasta encajar con el inicio de la siguiente sección"
                    >
                      <ArrowLeftRight size={10} />
                      <span>Encajar</span>
                    </button>
                  )}
                </div>

                {/* Probar Voz Guía / Saltar al Conteo Previo */}
                <button
                  type="button"
                  onClick={() => {
                    onPreviewVoiceCue?.(selectedSection.name);
                    if (onSeek) {
                      onSeek(Math.max(0, selectedSection.time - barDuration));
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Escuchar la Voz Guía y posicionar 1 compás antes para probar la entrada"
                >
                  <Play size={10} fill="currentColor" />
                  <span>Probar Conteo</span>
                </button>

                {/* Activar / Silenciar Voz Guía de esta sección */}
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSelectedSection(
                      { cueEnabled: !selectedSection.cueEnabled },
                      true
                    )
                  }
                  className={`px-2 py-1 rounded-lg border text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                    selectedSection.cueEnabled
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                  }`}
                  title={
                    selectedSection.cueEnabled
                      ? 'Voz Guía activa en esta sección (Clic para silenciar solo este aviso)'
                      : 'Voz Guía silenciada en esta sección (Clic para activar)'
                  }
                >
                  {selectedSection.cueEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
                  <span>{selectedSection.cueEnabled ? 'Guía ON' : 'Guía OFF'}</span>
                </button>

                {/* Dividir (Split) */}
                <button
                  type="button"
                  onClick={handleSplitSelectedSection}
                  className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Dividir sección en dos en el cabezal de reproducción (Atajo: Tecla S)"
                >
                  <Scissors size={11} />
                  <span>Dividir</span>
                </button>

                {/* Duplicar */}
                <button
                  type="button"
                  onClick={handleDuplicateSelectedSection}
                  className="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Duplicar sección a continuación (Atajo: Ctrl+D)"
                >
                  <Copy size={11} />
                  <span>Duplicar</span>
                </button>

                {/* Eliminar */}
                <button
                  type="button"
                  onClick={handleDeleteSelectedSection}
                  className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-200 text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                  title="Eliminar sección (Tecla Supr / Backspace)"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HUD Flotante durante Drag / Trim */}
      {dragHudInfo && (
        <div className="absolute top-28 left-1/2 -translate-x-1/2 z-50 bg-zinc-900/95 text-white px-4 py-2 rounded-2xl shadow-xl border border-white/15 pointer-events-none flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-amber-300">
              {dragHudInfo.label} ({formatMmSs(dragHudInfo.time)})
            </div>
            <div className="text-[10px] font-mono text-zinc-300">{dragHudInfo.sublabel}</div>
          </div>
        </div>
      )}

      {/* Modal / Popover de Edición o Inserción Rápida de Acorde (Apple Studio Light) */}
      {(editingChordIdx !== null || addingChordTime !== null) && (
        <div className="bg-white/98 absolute top-20 left-36 z-50 border border-slate-200 rounded-2xl p-4 shadow-[0_24px_56px_-12px_rgba(15,23,42,0.22)] w-84 pointer-events-auto backdrop-blur-2xl ring-1 ring-amber-400/40">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-amber-600">
              {addingChordTime !== null
                ? `Nuevo Acorde en ${formatMmSs(editingChordTime)} (C.${getBarNumberAtTime(editingChordTime)})`
                : `Editar Acorde #${(editingChordIdx ?? 0) + 1} · ${formatMmSs(editingChordTime)}`}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditingChordIdx(null);
                setAddingChordTime(null);
              }}
              className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 text-xs font-bold flex items-center justify-center transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center justify-between gap-1.5 mb-2.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-[10px] font-mono">
            <span className="text-slate-500 font-bold uppercase">Tiempo (s):</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setEditingChordTime((t) => Number(Math.max(0, t - beatDuration * 0.5).toFixed(3)))}
                className="px-1.5 py-0.5 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                title="Adelantar ½ pulso"
              >
                -½♪
              </button>
              <input
                type="number"
                step="0.05"
                min="0"
                value={Number(editingChordTime.toFixed(2))}
                onChange={(e) => setEditingChordTime(Math.max(0, Number(e.target.value) || 0))}
                className="w-16 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-center font-bold text-slate-900 outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => setEditingChordTime((t) => Number((t + beatDuration * 0.5).toFixed(3)))}
                className="px-1.5 py-0.5 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                title="Retrasar ½ pulso"
              >
                +½♪
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={editingChordValue}
              onChange={(e) => setEditingChordValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitChordEdit();
                if (e.key === 'Escape') {
                  setEditingChordIdx(null);
                  setAddingChordTime(null);
                }
              }}
              autoFocus
              className="flex-1 bg-slate-50 border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 rounded-xl px-3 py-1.5 text-lg font-black text-slate-900 outline-none"
              placeholder="Ej. Cm7, G/B..."
            />
            <button
              type="button"
              onClick={commitChordEdit}
              className="px-3.5 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs uppercase tracking-wider shadow-xs cursor-pointer transition-colors"
            >
              {addingChordTime !== null ? 'Añadir' : 'Guardar'}
            </button>
            {editingChordIdx !== null && onRemoveChord && (
              <button
                type="button"
                onClick={() => {
                  onRemoveChord(editingChordIdx);
                  setEditingChordIdx(null);
                  setAddingChordTime(null);
                }}
                className="px-2.5 py-2 rounded-full bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-200 font-bold text-xs transition-colors cursor-pointer"
                title="Eliminar acorde"
              >
                🗑
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-6 gap-1">
              {QUICK_ROOTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setEditingChordValue(r)}
                  className="py-1 rounded-lg bg-slate-100 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700 border border-slate-200 text-[11px] font-bold text-slate-800 transition-colors cursor-pointer"
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {QUICK_QUALITIES.map((q) => {
                const rootMatch = editingChordValue.match(/^[A-G][#b]?/)?.[0] || 'C';
                const target = `${rootMatch}${q}`;
                return (
                  <button
                    key={q || 'maj'}
                    type="button"
                    onClick={() => setEditingChordValue(target)}
                    className="py-1 rounded-lg bg-slate-50 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 border border-slate-200 text-[10px] font-mono font-semibold text-slate-700 transition-colors cursor-pointer"
                  >
                    {target}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3. ÁREA PRINCIPAL DEL TIMELINE HORIZONTAL */}
      <div
        ref={trackAreaRef}
        className="relative flex-1 w-full flex items-center overflow-hidden"
        onWheel={(e) => {
          if (!onSeek) return;
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 12 : -12;
            setPixelsPerBeat((z) => Math.max(40, Math.min(200, z + delta)));
          } else {
            const deltaSec = (e.deltaX !== 0 ? e.deltaX : e.deltaY) / pixelsPerSecond;
            onSeek(Math.max(0, Math.min(effectiveTotalDuration, currentTime + deltaSec)));
          }
        }}
        onDragOver={(e) => {
          if (!isStudioCapCutMode) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          const rawTime = clientXToSongTime(e.clientX);
          const snapped = snapTimeSec(rawTime, undefined, e.altKey);
          setDropPreviewTime(snapped.time);
        }}
        onDragLeave={() => {
          setDropPreviewTime(null);
        }}
        onDrop={(e) => {
          if (!isStudioCapCutMode) return;
          e.preventDefault();
          const presetName = e.dataTransfer.getData('text/plain') || draggingPresetName || 'VERSO';
          const rawTime = clientXToSongTime(e.clientX);
          insertSectionAtTime(presetName, rawTime, true);
          setDropPreviewTime(null);
          setDraggingPresetName(null);
        }}
      >
        {/* Grid Background (Dinámico vs Estático) */}
        {!beatTimes || beatTimes.length === 0 ? (
          <div
            className="absolute inset-0 z-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: `linear-gradient(90deg, #333 1px, transparent 1px), linear-gradient(90deg, #666 2px, transparent 2px)`,
              backgroundSize: `${pixelsPerBeat}px 100%, ${pixelsPerBeat * beatsPerBar}px 100%`,
              backgroundPosition: `calc(${PLAYHEAD_ANCHOR_X}px - ${
                currentTime * pixelsPerSecond -
                ((baseOffset !== undefined
                  ? baseOffset
                  : chords.length > 0
                  ? chords[0].time
                  : 0) +
                  (gridOffset || 0)) *
                  pixelsPerSecond
              }px) 0`,
            }}
          />
        ) : (
          <div className="absolute inset-0 z-0 opacity-35 pointer-events-none">
            {beatGrid
              .filter((pt) => pt.time >= currentTime - 10 && pt.time <= currentTime + 30)
              .map((pt, i) => {
                return (
                  <div
                    key={`beat-${i}-${pt.time.toFixed(3)}`}
                    className={`absolute top-0 bottom-0 ${
                      pt.isDownbeat ? 'bg-zinc-400 w-[2px]' : 'bg-zinc-200 w-[1px]'
                    }`}
                    style={{
                      left: `calc(${PLAYHEAD_ANCHOR_X}px + ${
                        (pt.time - currentTime) * pixelsPerSecond
                      }px)`,
                    }}
                  />
                );
              })}
          </div>
        )}

        {/* Playhead Line (Fixed) - Sólido de Alta Precisión */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-[#e11d48] z-30 pointer-events-none"
          style={{ left: `${PLAYHEAD_ANCHOR_X}px` }}
        >
          <div className="absolute -top-1 -left-[5px] w-3 h-3 bg-[#e11d48] rounded-full border border-white shadow-xs" />
          <div className="absolute -bottom-1 -left-[5px] w-3 h-3 bg-[#e11d48] rounded-full border border-white shadow-xs" />
        </div>

        {/* Scrolling Tracks Container */}
        <div
          ref={containerRef}
          className="absolute left-0 h-full flex flex-col justify-center gap-2 transition-transform duration-75 ease-linear z-10 will-change-transform"
        >
          {/* Onda de Audio Real (Waveform de Fondo en Modo Studio CapCut) */}
          {isStudioCapCutMode && waveformPeaks && waveformPeaks.length > 0 && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-16 opacity-60 pointer-events-none z-0">
              <canvas
                ref={waveformCanvasRef}
                className="h-full block"
                style={{ width: `${Math.max(2000, Math.round(effectiveTotalDuration * pixelsPerSecond))}px`, height: '64px' }}
              />
            </div>
          )}

          {/* Líneas de Compás Numeradas en la Regla Superior */}
          <div
            className={`relative h-6 w-full select-none ${
              onSeek ? 'cursor-ew-resize' : 'pointer-events-none'
            }`}
            style={{ width: `${Math.round(effectiveTotalDuration * pixelsPerSecond)}px` }}
            onPointerDown={(e) => {
              if (!onSeek || e.button !== 0) return;
              isScrubbingRulerRef.current = true;
              onSeek(clientXToSongTime(e.clientX));
            }}
            onPointerMove={(e) => {
              if (!isScrubbingRulerRef.current || !onSeek) return;
              onSeek(clientXToSongTime(e.clientX));
            }}
          >
            {beatGrid
              .filter(
                (pt) =>
                  pt.isDownbeat &&
                  pt.time >= currentTime - 10 &&
                  pt.time <= currentTime + Math.max(25, 1600 / pixelsPerSecond)
              )
              .map((pt) => (
                <div
                  key={`bar-lbl-${pt.bar}-${pt.time.toFixed(3)}`}
                  className="absolute top-0 bottom-0 border-l-2 border-zinc-300 pl-1.5 flex items-center gap-1 pointer-events-none"
                  style={{ left: `${pt.time * pixelsPerSecond}px` }}
                >
                  <span className="text-[9.5px] font-mono font-extrabold text-zinc-600 uppercase whitespace-nowrap">
                    {pt.bar <= 0 ? 'PRE' : `C.${pt.bar}`}
                  </span>
                  <span className="text-[8.5px] font-mono text-zinc-400 whitespace-nowrap">
                    {formatMmSs(pt.time)}
                  </span>
                </div>
              ))}
          </div>

          {/* CARRIL 1: SECCIONES Y VOZ GUÍA (CAPCUT DRAG, TRIM LEFT, TRIM RIGHT & LEAD-IN COUNTDOWN) */}
          <div
            className="relative h-14 w-full"
            style={{ width: `${Math.round(effectiveTotalDuration * pixelsPerSecond)}px` }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedSectionIdx(null);
              }
            }}
          >
            {/* Ghost Drop Preview al arrastrar una píldora desde el dock */}
            {isStudioCapCutMode && dropPreviewTime !== null && (
              <div
                className="absolute top-0 bottom-0 z-40 pointer-events-none flex items-center"
                style={{ left: `${dropPreviewTime * pixelsPerSecond}px` }}
              >
                {/* Pre-anuncio fantasma (-1 compás) */}
                {dropPreviewTime >= barDuration && (
                  <div
                    className="absolute top-2 bottom-2 right-full mr-0.5 rounded-l-xl border-2 border-dashed border-rose-400 bg-rose-500/10 flex items-center justify-center px-2"
                    style={{ width: `${Math.max(40, barDuration * pixelsPerSecond)}px` }}
                  >
                    <span className="text-[9px] font-mono font-black text-rose-700 uppercase truncate">
                      🗣️ {draggingPresetName || 'GUÍA'} · 2 · 3 · 4
                    </span>
                  </div>
                )}
                {/* Bloque principal fantasma */}
                <div
                  className="h-full rounded-xl border-2 border-dashed border-[#e11d48] bg-rose-500/20 flex items-center justify-between px-3 shadow-lg"
                  style={{ width: `${Math.max(80, barDuration * 4 * pixelsPerSecond)}px` }}
                >
                  <span className="text-xs font-black text-rose-950 uppercase tracking-wider truncate">
                    ➕ Soltar {draggingPresetName || 'SECCIÓN'} en Compás{' '}
                    {getBarNumberAtTime(dropPreviewTime)} ({formatMmSs(dropPreviewTime)})
                  </span>
                </div>
              </div>
            )}

            {sectionBlocks.map((block, i) => {
              const isActive =
                currentTime >= block.time && currentTime < block.time + block.duration;
              const isPast = currentTime >= block.time + block.duration;
              const isSelected = isStudioCapCutMode && selectedSectionIdx === i;
              const secStyle = getSectionSolidStyle(block.name);
              const widthPx = Math.max(block.duration * pixelsPerSecond - 2, 46);
              const startBar = getBarNumberAtTime(block.time);
              const barsSpan = Math.max(0.25, Number((block.duration / barDuration).toFixed(1)));

              // Cola de Pre-Anuncio de Voz Guía (-1 Compás antes del Downbeat de la sección)
              const leadInStartSec = block.time - barDuration;
              const prevSecEnd = i > 0 ? sectionBlocks[i - 1].time + sectionBlocks[i - 1].duration : 0;
              const showLeadInCueTail =
                block.cueEnabled &&
                leadInStartSec >= -0.05 &&
                barDuration * pixelsPerSecond >= 48;
              const isInLeadInNow =
                block.cueEnabled &&
                currentTime >= leadInStartSec &&
                currentTime < block.time;

              return (
                <React.Fragment key={block.id}>
                  {/* Cola Visual de Conteo Previo de Voz Guía (-1 Compás: [NOMBRE | 2 | 3 | 4]) */}
                  {showLeadInCueTail && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSeek) onSeek(Math.max(0, leadInStartSec));
                      }}
                      className={`absolute top-2.5 bottom-2.5 rounded-l-lg border border-dashed ${
                        secStyle.leadInBg
                      } ${secStyle.leadInBorder} flex items-center overflow-hidden transition-all cursor-pointer ${
                        isInLeadInNow
                          ? 'ring-2 ring-[#e11d48] z-30 opacity-100 scale-[1.01]'
                          : 'opacity-85 hover:opacity-100 z-15'
                      }`}
                      style={{
                        left: `${Math.max(0, leadInStartSec) * pixelsPerSecond}px`,
                        width: `${Math.max(36, barDuration * pixelsPerSecond - 2)}px`,
                      }}
                      title={`Compás de Conteo de Voz Guía (${formatMmSs(
                        Math.max(0, leadInStartSec)
                      )}): Dice "${block.name}, 2, 3, 4" antes de entrar en Compás ${startBar}. Haz clic para probar este conteo.`}
                    >
                      <div className="w-full h-full grid grid-cols-4 divide-x divide-zinc-400/30 text-[9px] font-mono font-extrabold text-zinc-800">
                        <div
                          className={`flex items-center justify-center px-1 truncate ${
                            isInLeadInNow && currentBeatInfo.beatInBar === 1
                              ? 'bg-[#e11d48] text-white'
                              : ''
                          }`}
                        >
                          🗣️{secStyle.name.slice(0, 5)}
                        </div>
                        <div
                          className={`flex items-center justify-center ${
                            isInLeadInNow && currentBeatInfo.beatInBar === 2
                              ? 'bg-zinc-900 text-white'
                              : ''
                          }`}
                        >
                          2
                        </div>
                        <div
                          className={`flex items-center justify-center ${
                            isInLeadInNow && currentBeatInfo.beatInBar === 3
                              ? 'bg-zinc-900 text-white'
                              : ''
                          }`}
                        >
                          3
                        </div>
                        <div
                          className={`flex items-center justify-center ${
                            isInLeadInNow && currentBeatInfo.beatInBar === 4
                              ? 'bg-zinc-900 text-white'
                              : ''
                          }`}
                        >
                          4
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bloque Principal de Sección Estilo CapCut */}
                  <div
                    onPointerDown={(e) => {
                      if (!isStudioCapCutMode) {
                        if (onSeek) onSeek(block.time);
                        return;
                      }
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      setSelectedSectionIdx(i);
                      dragStateRef.current = {
                        mode: 'move',
                        sectionIdx: i,
                        sectionId: block.id,
                        sectionName: block.name,
                        initialClientX: e.clientX,
                        initialStartTime: block.time,
                        initialDuration: block.duration,
                        hasMoved: false,
                      };
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isStudioCapCutMode && onSeek) {
                        onSeek(block.time);
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (onSeek) onSeek(block.time);
                    }}
                    className={`group absolute top-1 bottom-1 flex items-center justify-between border ${
                      secStyle.bg
                    } ${secStyle.border} ${secStyle.text} ${
                      isSelected
                        ? 'ring-3 ring-black shadow-[0_6px_20px_rgba(0,0,0,0.35)] z-35'
                        : isActive
                        ? 'ring-2 ring-black shadow-md z-30 font-black scale-[1.01]'
                        : isPast && !isStudioCapCutMode
                        ? 'opacity-45 z-10 grayscale-[25%]'
                        : 'opacity-95 hover:opacity-100 z-20 shadow-xs hover:brightness-105'
                    } ${
                      isStudioCapCutMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                    } rounded-xl select-none transition-shadow overflow-hidden`}
                    style={{
                      left: `${block.time * pixelsPerSecond}px`,
                      width: `${widthPx}px`,
                    }}
                    title={
                      isStudioCapCutMode
                        ? `${block.name} • Compás ${startBar} (${barsSpan} compases) • Arrastra el centro para mover o los bordes [ ▌ ▐ ] para recortar/alargar. Doble clic para llevar el Playhead aquí.`
                        : `Sección Voz Guía: ${block.name} (${formatMmSs(block.time)})`
                    }
                  >
                    {/* TIRADOR IZQUIERDO CAPCUT (Trim-Left Handle) */}
                    {isStudioCapCutMode && (
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedSectionIdx(i);
                          dragStateRef.current = {
                            mode: 'trim-left',
                            sectionIdx: i,
                            sectionId: block.id,
                            sectionName: block.name,
                            initialClientX: e.clientX,
                            initialStartTime: block.time,
                            initialDuration: block.duration,
                            hasMoved: false,
                          };
                        }}
                        className="w-3 h-full cursor-ew-resize bg-black/30 hover:bg-black/60 flex items-center justify-center shrink-0 transition-colors z-30 border-r border-white/20"
                        title="Arrastrar borde izquierdo para recortar o adelantar el inicio de la sección"
                      >
                        <div className="w-0.5 h-5 bg-white/80 rounded-full" />
                      </div>
                    )}

                    {/* CONTENIDO CENTRAL DEL BLOQUE */}
                    <div className="flex-1 flex items-center justify-between px-2.5 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs shrink-0 drop-shadow-xs">{secStyle.emoji}</span>
                        <div className="flex flex-col min-w-0 leading-tight">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black uppercase tracking-wider truncate drop-shadow-xs">
                              {block.name}
                            </span>
                            {!block.cueEnabled ? (
                              <span
                                className="px-1 py-0.2 rounded bg-black/35 text-[8px] font-mono uppercase"
                                title="Voz Guía silenciada en esta sección"
                              >
                                🔕
                              </span>
                            ) : leadInStartSec < -0.05 ? (
                              <span
                                className="px-1.5 py-0.2 rounded bg-black/30 border border-white/25 text-[8px] font-mono font-bold uppercase shrink-0"
                                title="Voz Guía activa para el Pre-Roll / Inicio del Compás 1"
                              >
                                🗣️ PRE-ROLL
                              </span>
                            ) : null}
                            {isActive && (
                              <span className="px-1.5 py-0.2 rounded bg-white text-black text-[8.5px] font-black uppercase tracking-widest shrink-0 shadow-xs">
                                EN VIVO
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-mono opacity-85 truncate">
                            C.{startBar} • {barsSpan} comp. ({block.duration.toFixed(1)}s)
                            {prevSecEnd === block.time && i > 0 ? ' • 🔗' : ''}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 ml-1.5">
                        {isStudioCapCutMode && (
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreviewVoiceCue?.(block.name);
                              if (onSeek) onSeek(block.time);
                            }}
                            className="bg-black/30 hover:bg-black/60 text-white w-5 h-5 flex items-center justify-center rounded-full transition text-[10px] cursor-pointer"
                            title="Escuchar Voz Guía y saltar al inicio de esta sección"
                          >
                            🔊
                          </button>
                        )}
                        <span className="text-[9.5px] font-mono font-bold opacity-90 tabular-nums hidden sm:inline">
                          {Math.floor(block.time / 60)}:
                          {String(Math.floor(block.time % 60)).padStart(2, '0')}
                        </span>
                        {(isEditing || isStudioCapCutMode) && (
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onUpdateSections) {
                                const next = sectionBlocks.filter((_, idx) => idx !== i);
                                emitSectionsUpdate(next, true);
                                if (selectedSectionIdx === i) setSelectedSectionIdx(null);
                              } else if (onRemoveSection) {
                                onRemoveSection(i);
                              }
                            }}
                            className="bg-black/45 text-white w-5 h-5 flex items-center justify-center rounded-full hover:bg-rose-500 hover:scale-110 transition z-40 shrink-0 ml-0.5 shadow-sm text-[10px] cursor-pointer"
                            title="Eliminar esta sección"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {/* TIRADOR DERECHO CAPCUT (Trim-Right / Lengthen Handle) */}
                    {isStudioCapCutMode && (
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedSectionIdx(i);
                          dragStateRef.current = {
                            mode: 'trim-right',
                            sectionIdx: i,
                            sectionId: block.id,
                            sectionName: block.name,
                            initialClientX: e.clientX,
                            initialStartTime: block.time,
                            initialDuration: block.duration,
                            hasMoved: false,
                          };
                        }}
                        className="w-3 h-full cursor-ew-resize bg-black/30 hover:bg-black/60 flex items-center justify-center shrink-0 transition-colors z-30 border-l border-white/20"
                        title="Arrastrar borde derecho para alargar o recortar la duración de la sección"
                      >
                        <div className="w-0.5 h-5 bg-white/80 rounded-full" />
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* CARRIL 2: ACORDES SINCRONIZADOS A LA GRILLA */}
          <div
            className={`relative ${
              lyricBlocks.length > 0 ? 'h-28' : 'h-36'
            } w-full flex items-center`}
            style={{ width: `${Math.round(effectiveTotalDuration * pixelsPerSecond)}px` }}
            onDoubleClick={(e) => {
              if (!onAddChord) return;
              if (e.target === e.currentTarget) {
                const rawTime = clientXToSongTime(e.clientX);
                const snapped = snapTimeSec(rawTime);
                setEditingChordIdx(null);
                setAddingChordTime(snapped.time);
                setEditingChordTime(snapped.time);
                setEditingChordValue('C');
              }
            }}
            title={
              onAddChord
                ? 'Doble clic en cualquier espacio vacío para insertar un nuevo acorde en ese compás/pulso'
                : undefined
            }
          >
            {chordBlocks.map((block, i) => {
              const isPast = currentTime >= block.time + block.duration;

              return (
                <div
                  key={`${block.originalIndex}-${block.time.toFixed(3)}-${i}`}
                  className={`absolute h-full flex flex-col justify-center ${
                    block.isActive
                      ? 'border-l-4 border-amber-500 bg-amber-50/95 z-20 shadow-sm'
                      : isPast
                      ? 'border-l-2 border-zinc-200 bg-zinc-100/80 opacity-60'
                      : 'border-l-2 border-zinc-300 bg-white/90 hover:bg-zinc-50 shadow-sm'
                  } transition-all duration-150 cursor-pointer rounded-r-xl`}
                  style={{
                    left: `${block.time * pixelsPerSecond}px`,
                    width: `${Math.max(block.duration * pixelsPerSecond - 2, 24)}px`,
                  }}
                  onClick={() => {
                    if (!onEditChord && onSeek) onSeek(block.time);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onEditChord) {
                      setAddingChordTime(null);
                      setEditingChordIdx(block.originalIndex);
                      setEditingChordTime(Number(chords[block.originalIndex]?.time ?? block.time));
                      setEditingChordValue(block.chord);
                    }
                  }}
                  title={
                    onEditChord
                      ? 'Doble clic para editar o borrar este acorde'
                      : `Acorde ${block.chord}`
                  }
                >
                  <div className="px-3.5">
                    <span
                      className={`${
                        lyricBlocks.length > 0 ? 'text-2xl' : 'text-3xl'
                      } font-bold block tracking-tight ${
                        block.isActive
                          ? 'text-amber-950 font-black'
                          : isPast
                          ? 'text-zinc-400'
                          : 'text-black font-black'
                      } transition-all origin-left truncate`}
                    >
                      {block.chord}
                    </span>
                    <span className="text-[10px] font-mono font-normal text-zinc-500 mt-0.5 block opacity-85 tabular-nums">
                      {Math.floor(block.time / 60)}:
                      {Math.floor(block.time % 60)
                        .toString()
                        .padStart(2, '0')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* CARRIL 3: CINTA GUÍA DE LETRAS SINCRONIZADAS */}
          {lyricBlocks.length > 0 && (
            <div
              className="relative h-9 w-full flex items-center"
              style={{ width: `${Math.round(effectiveTotalDuration * pixelsPerSecond)}px` }}
            >
              {lyricBlocks.map((lb, idx) => {
                const isPast = currentTime >= lb.time + lb.duration;
                return (
                  <div
                    key={lb.id || `lyr-${idx}`}
                    onClick={() => onSeek && onSeek(lb.time)}
                    className={`absolute h-full flex items-center px-3.5 rounded-r-xl border-l-2 transition-all cursor-pointer overflow-hidden ${
                      lb.isActive
                        ? 'bg-rose-50 border-[#e11d48] text-rose-950 font-bold z-20'
                        : isPast
                        ? 'bg-zinc-100 border-zinc-200 text-zinc-400 opacity-50'
                        : 'bg-white border-zinc-300 text-zinc-800 hover:bg-zinc-50'
                    }`}
                    style={{
                      left: `${lb.time * pixelsPerSecond}px`,
                      width: `${Math.max(lb.duration * pixelsPerSecond - 2, 40)}px`,
                    }}
                    title={lb.text}
                  >
                    <span className="text-xs font-medium truncate">🎤 {lb.text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Línea Vertical Ámbar de Snap Magnético Activo */}
          {activeSnapTime !== null && (
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-amber-500 shadow-[0_0_12px_#f59e0b] z-50 pointer-events-none"
              style={{ left: `${activeSnapTime * pixelsPerSecond}px` }}
            />
          )}
        </div>

        {/* Sombra difuminada limpia en los bordes */}
        <div className="absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-white to-transparent z-20 pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-white to-transparent z-20 pointer-events-none" />

        {/* BPM & Time Signature Indicator */}
        <div className="absolute bottom-3 left-4 z-30 flex items-center gap-2 pointer-events-none">
          {bpm && (
            <div className="bg-white/95 border border-zinc-300 text-zinc-800 px-3 py-1 rounded-full text-[11px] font-mono font-semibold flex items-center tabular-nums shadow-xs">
              <div className="w-2 h-2 bg-[#f59e0b] rounded-full mr-2" />
              BPM: {Math.round(bpm)} &bull; {timeSignature}
            </div>
          )}
        </div>
      </div>

      {/* 4. MINI-MAPA NAVEGADOR DE ESTRUCTURA COMPLETA (Estilo CapCut Overview Bar) */}
      {isStudioCapCutMode && (
        <div
          onClick={(e) => {
            if (!onSeek) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            onSeek(ratio * effectiveTotalDuration);
          }}
          className="h-7 bg-zinc-100 border-t border-zinc-200 px-2 relative flex items-center cursor-pointer shrink-0 z-30"
          title="Mapa completo de la canción: Haz clic en cualquier punto o sección para saltar instantáneamente"
        >
          {sectionBlocks.map((sec, i) => {
            const st = getSectionSolidStyle(sec.name);
            const leftPct = (sec.time / effectiveTotalDuration) * 100;
            const widthPct = Math.max(0.8, (sec.duration / effectiveTotalDuration) * 100);
            const isSelected = selectedSectionIdx === i;
            return (
              <div
                key={`mini-${sec.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSectionIdx(i);
                  if (onSeek) onSeek(sec.time);
                }}
                className={`absolute top-1 bottom-1 rounded ${st.bg} text-white text-[8.5px] font-black uppercase px-1.5 flex items-center truncate transition-all ${
                  isSelected ? 'ring-2 ring-black z-20' : 'opacity-85 hover:opacity-100 z-10'
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
                title={`${sec.name} (${formatMmSs(sec.time)})`}
              >
                {sec.name}
              </div>
            );
          })}
          {/* Playhead en el Mini-Mapa */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[#e11d48] z-30 pointer-events-none"
            style={{
              left: `${Math.max(0, Math.min(100, (currentTime / effectiveTotalDuration) * 100))}%`,
            }}
          />
        </div>
      )}
    </div>
  );
};
