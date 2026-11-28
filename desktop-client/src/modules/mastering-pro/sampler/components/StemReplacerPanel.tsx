import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudUpload,
  Crosshair,
  Disc3,
  Download,
  FolderArchive,
  FolderOpen,
  Guitar,
  Layers,
  Loader2,
  Maximize2,
  Mic,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { midiNoteToName } from '../engine/PitchDetector';
import {
  DEFAULT_DRUM_KIT_1400_BY_ROLE,
  getDrumKit1400ForRole,
  type DrumKit1400Folder,
} from '../engine/DrumKit1400Catalog';
import {
  BASS_PRESET_CATALOG,
  DRUM_PRESET_CATALOG,
  isBassPresetId,
  MELODIC_PRESET_CATALOG,
} from '../engine/StudioSampleBank';
import type { useStemReplacer } from '../hooks/useStemReplacer';
import type {
  CustomSampleCategory,
  DefaultInstrumentId,
  DetectionSourceMode,
  DrumPieceRole,
  ImportedAudioMemoryAnalysis,
  SamplePad,
  StemAnalysisMode,
} from '../types/sampler.types';
import {
  buildAdaptiveMidiGrid,
  type MidiGridResolutionMode,
} from '../engine/adaptiveMidiGrid';
import { DrumKit1400BrowserModal } from './DrumKit1400BrowserModal';
import { MidiTimelineWorkstation } from './MidiTimelineWorkstation';
import {
  MAX_HORIZONTAL_ZOOM,
  TimelineHorizontalScrollbar,
  clampHorizontalScrollNorm,
  computeAnchoredHorizontalZoom,
} from './TimelineHorizontalScrollbar';

interface StemReplacerPanelProps {
  replacer: ReturnType<typeof useStemReplacer>;
  padsFromCreator: SamplePad[];
  onAuditionCreatorPad?: (padIndex: number) => void;
  getBufferForPad?: (padIndex: number) => AudioBuffer | null;
  onSendTo16Pads?: (
    buffer: AudioBuffer,
    title: string,
    preAnalysis?: ImportedAudioMemoryAnalysis | null
  ) => void;
}

const DRUM_ROLES: Array<{ role: DrumPieceRole; label: string; shortLabel: string; gmNotes: string; color: string }> = [
  { role: 'kick', label: 'Kick (Bombo)', shortLabel: 'KICK', gmNotes: 'GM 36', color: '#FB923C' },
  { role: 'snare', label: 'Snare / Snake (Caja)', shortLabel: 'SNARE', gmNotes: 'GM 38/37', color: '#22D3EE' },
  { role: 'tom', label: 'Toms (High / Mid / Floor)', shortLabel: 'TOMS', gmNotes: 'GM 50/47/43', color: '#34D399' },
  { role: 'hat', label: 'Hi-Hats (Cerrado / Abierto)', shortLabel: 'HI-HAT', gmNotes: 'GM 42/46', color: '#FBBF24' },
  { role: 'crash', label: 'Crash / Ride (Platillos)', shortLabel: 'CRASH', gmNotes: 'GM 49/51', color: '#F472B6' },
];

const MODE_LABELS: Array<{ id: StemAnalysisMode; label: string; hint: string }> = [
  { id: 'drums', label: 'Batería (Golpes + MIDI)', hint: 'Kick · Snare/Snake · Toms · Hi-Hat · Crash/Ride' },
  { id: 'monophonic', label: 'Melódico Mono', hint: 'Bajo · Lead · 1 nota a la vez' },
  { id: 'polyphonic', label: 'Polifónico (Acordes)', hint: 'Guitarra · Piano · Keys+' },
];

const CATEGORY_BADGES: Record<CustomSampleCategory, { label: string; color: string }> = {
  kick: { label: 'KICK', color: '#FB923C' },
  snare: { label: 'SNARE', color: '#22D3EE' },
  hat: { label: 'HI-HAT', color: '#FBBF24' },
  crash: { label: 'CRASH', color: '#F472B6' },
  tom: { label: 'TOMS', color: '#34D399' },
  melodic: { label: 'TONAL', color: '#A78BFA' },
};

const formatTime = (sec: number) => {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
};

export const StemReplacerPanel: React.FC<StemReplacerPanelProps> = ({
  replacer,
  padsFromCreator,
  getBufferForPad,
  onSendTo16Pads,
}) => {
  const r = replacer;
  const stemFileInputRef = useRef<HTMLInputElement | null>(null);
  const masterRefFileInputRef = useRef<HTMLInputElement | null>(null);
  const slotFileInputRef = useRef<HTMLInputElement | null>(null);
  const bankBatchFileInputRef = useRef<HTMLInputElement | null>(null);
  const midiFileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<DrumPieceRole | 'melodic'>('melodic');

  const [songSearch, setSongSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [scrollNorm, setScrollNorm] = useState(0);
  const [autoFollowPlayhead, setAutoFollowPlayhead] = useState(true);
  const [canvasResizeTick, setCanvasResizeTick] = useState(0);
  const [isPanningWaveform, setIsPanningWaveform] = useState(false);
  const [saveStemName, setSaveStemName] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [showCustomBank, setShowCustomBank] = useState(false);
  const [showCloudSamplePicker, setShowCloudSamplePicker] = useState(false);
  const [cloudTargetRole, setCloudTargetRole] = useState<CustomSampleCategory>('kick');
  const [kit1400ModalState, setKit1400ModalState] = useState<{
    open: boolean;
    role: DrumPieceRole;
    folder?: DrumKit1400Folder;
  }>({ open: false, role: 'kick' });
  const [melodicCategoryFilter, setMelodicCategoryFilter] = useState<'all' | 'bass' | 'keys-guitar'>('all');
  const [dragOverTarget, setDragOverTarget] = useState<DrumPieceRole | 'melodic' | 'bank' | 'stem-local' | 'master-ref' | null>(null);
  const [showBeatGrid, setShowBeatGrid] = useState(true);
  const [gridResolutionMode, setGridResolutionMode] = useState<MidiGridResolutionMode>('auto');
  const [waveformWidthPx, setWaveformWidthPx] = useState<number>(1080);
  const [showMidiRoll, setShowMidiRoll] = useState(true);
  const [editorSizeMode, setEditorSizeMode] = useState<'compact' | 'large' | 'fullscreen'>('large');
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);
  const [showReplicateTokenBar, setShowReplicateTokenBar] = useState(false);
  const [tokenDraft, setTokenDraft] = useState(r.replicateApiKey || '');
  const [bpmDraft, setBpmDraft] = useState<string>('120');
  const tapTimesRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformOverviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastAutoFollowTimeRef = useRef<number>(-1);
  const waveformPanRef = useRef<{
    active: boolean;
    didDrag: boolean;
    startClientX: number;
    startScrollNorm: number;
    width: number;
  } | null>(null);

  // Keyboard shortcuts for Fullscreen Exit (Escape) & Selected Hit Deletion (Delete / Backspace)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape' && editorSizeMode === 'fullscreen') {
        setEditorSizeMode('large');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedHitId) {
        e.preventDefault();
        r.removeDrumHit(selectedHitId);
        setSelectedHitId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorSizeMode, selectedHitId, r]);

  useEffect(() => {
    if (r.importedMemory?.bpm) {
      setBpmDraft(String(r.importedMemory.bpm));
    }
  }, [r.importedMemory?.bpm]);

  const handleTapTempo = () => {
    const now = performance.now();
    const prev = tapTimesRef.current.filter((t) => now - t < 2800);
    const next = [...prev, now];
    tapTimesRef.current = next;
    if (next.length >= 3) {
      const diffs: number[] = [];
      for (let i = 1; i < next.length; i++) {
        diffs.push((next[i] - next[i - 1]) / 1000);
      }
      diffs.sort((a, b) => a - b);
      const medSec = diffs[Math.floor(diffs.length / 2)];
      if (medSec >= 0.27 && medSec <= 1.5) {
        const tappedBpm = Math.round((60 / medSec) * 10) / 10;
        setBpmDraft(String(tappedBpm));
        void r.updateImportedTempo(tappedBpm);
      }
    }
  };

  const userUploadedSamplesCount = useMemo(
    () => r.customSamples.filter((s) => s.sourceType !== 'kit-1400').length,
    [r.customSamples]
  );

  useEffect(() => {
    if (userUploadedSamplesCount > 0) {
      setShowCustomBank(true);
    }
  }, [userUploadedSamplesCount]);

  const syncedSampleIds = useMemo(() => {
    const ids = new Set<string>(r.cloudDrumSamples.map((c) => c.id));
    for (const cs of r.customSamples) {
      if (cs.supabaseSynced && cs.kit1400Id) {
        ids.add(cs.kit1400Id);
      }
    }
    return ids;
  }, [r.cloudDrumSamples, r.customSamples]);

  const activeKit1400ByRole = useMemo(
    () => ({
      kick: r.drumSlots.kick.kit1400Id,
      snare: r.drumSlots.snare.kit1400Id,
      hat: r.drumSlots.hat.kit1400Id,
      tom: r.drumSlots.tom.kit1400Id,
      crash: r.drumSlots.crash.kit1400Id,
    }),
    [r.drumSlots]
  );

  useEffect(() => {
    if (r.stemTitle) {
      setSaveStemName(`${r.stemTitle} (Sampled Pro)`);
    }
  }, [r.stemTitle]);

  useEffect(() => {
    setZoom(1);
    setScrollNorm(0);
  }, [r.originalBuffer]);

  const filteredSongs = useMemo(
    () =>
      r.songs.filter((s) =>
        s.title.toLowerCase().includes(songSearch.toLowerCase())
      ),
    [r.songs, songSearch]
  );

  const loadedCreatorPads = useMemo(
    () => padsFromCreator.filter((p) => Boolean(p.regionId)),
    [padsFromCreator]
  );

  // High-DPI Waveform + Detected Hits / Polyphonic Piano Roll Renderer
  const duration = r.originalBuffer?.duration ?? 0;
  const viewSpanSec = duration > 0 ? duration / zoom : 1;
  const maxViewStart = Math.max(0, duration - viewSpanSec);
  const viewStartSec = Math.max(0, Math.min(maxViewStart, scrollNorm * duration));
  const viewEndSec = viewStartSec + viewSpanSec;

  // Compute adaptive bar/beat/subdivision grid markers (1/4 -> 1/8 -> 1/16 -> 1/32 -> 1/64 as zoom/width expands)
  const adaptiveWaveformGrid = useMemo(() => {
    if (!showBeatGrid || duration <= 0) {
      return {
        lines: [],
        effectiveSubdivisionsPerBeat: 1,
        effectiveResolutionLabel: '1/4',
        pxPerBeat: 0,
      };
    }
    const mem = r.importedMemory;
    const bpm = mem?.bpm ?? r.analysis?.bpm ?? 120;
    return buildAdaptiveMidiGrid({
      duration,
      viewStartSec,
      viewEndSec,
      viewportWidthPx: waveformWidthPx,
      bpm,
      beatOffsetSec: mem?.beatOffsetSec ?? r.analysis?.beatOffsetSec ?? 0,
      beatTimes: mem?.beatTimes,
      downbeats: mem?.downbeats ?? r.analysis?.downbeats,
      resolutionMode: gridResolutionMode,
    });
  }, [
    showBeatGrid,
    duration,
    r.importedMemory,
    r.analysis?.bpm,
    r.analysis?.beatOffsetSec,
    r.analysis?.downbeats,
    viewStartSec,
    viewEndSec,
    waveformWidthPx,
    gridResolutionMode,
  ]);
  const visibleGridLines = adaptiveWaveformGrid.lines;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(170, rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0A0A0C';
    ctx.fillRect(0, 0, w, h);

    const midY = h / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (!r.originalBuffer || duration <= 0) {
      ctx.fillStyle = 'rgba(161, 161, 170, 0.72)';
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        '1. Elige una Canción arriba → 2. Selecciona 1 Stem (Batería, Piano, Guitarra, Bajo)',
        w / 2,
        midY + 4
      );
      ctx.textAlign = 'left';
      return;
    }

    const secToX = (sec: number) => ((sec - viewStartSec) / viewSpanSec) * w;

    // 1. Draw waveform from pyramid (Image 3 minimalist matte studio bar style)
    const sr = r.originalBuffer.sampleRate;
    const s0 = Math.max(0, Math.floor(viewStartSec * sr));
    const s1 = Math.min(r.originalBuffer.length, Math.ceil(viewEndSec * sr));
    const visibleSamples = Math.max(1, s1 - s0);
    const samplesPerPx = visibleSamples / w;

    ctx.fillStyle =
      r.abMode === 'replaced' ? 'rgba(228, 228, 231, 0.44)' : 'rgba(161, 161, 170, 0.36)';
    const level =
      r.waveformPyramid?.levels
        .slice()
        .reverse()
        .find((lvl) => lvl.bucketSize <= Math.max(1, samplesPerPx)) ??
      r.waveformPyramid?.levels[0];

    if (level) {
      for (let x = 0; x < w; x++) {
        const ps0 = s0 + x * samplesPerPx;
        const ps1 = s0 + (x + 1) * samplesPerPx;
        const b0 = Math.max(0, Math.floor(ps0 / level.bucketSize));
        const b1 = Math.min(level.mins.length - 1, Math.ceil(ps1 / level.bucketSize));
        let mn = 1;
        let mx = -1;
        for (let b = b0; b <= b1; b++) {
          if (level.mins[b] < mn) mn = level.mins[b];
          if (level.maxs[b] > mx) mx = level.maxs[b];
        }
        const yTop = midY - mx * (h * 0.43);
        const yBot = midY - mn * (h * 0.43);
        ctx.fillRect(x, yTop, 1.2, Math.max(1.5, yBot - yTop));
      }
    }

    // 1B. Overlay High-Contrast White Adaptive Musical Grid (Bars, Beats, 1/8, 1/16, 1/32, 1/64) & Chords
    if (showBeatGrid && visibleGridLines.length > 0) {
      let lastBarLabelX = -999;

      for (let idx = 0; idx < visibleGridLines.length; idx++) {
        const gl = visibleGridLines[idx];
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

        if (gl.isDownbeat && gl.barNum !== undefined && x - lastBarLabelX >= 28 && x >= 2 && x < w - 22) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
          ctx.font = 'bold 9.5px monospace';
          ctx.fillText(`C${gl.barNum}`, x + 3, 11);
          lastBarLabelX = x;
        }
      }
      ctx.lineWidth = 1;

      const mem = r.importedMemory;
      if (mem?.chords?.length) {
        let lastChordX = -999;
        for (const ch of mem.chords) {
          const cx0 = secToX(ch.startSec);
          const cx1 = secToX(ch.endSec);
          if (cx1 < 0 || cx0 > w) continue;
          if (cx0 >= 0 && cx0 <= w) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(cx0, 0);
            ctx.lineTo(cx0, h);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (cx0 - lastChordX >= 30 && cx1 - cx0 >= 18 && cx0 >= -4 && cx0 < w - 24) {
            const boxW = Math.min(48, Math.max(20, ch.chord.length * 7 + 8));
            ctx.fillStyle = 'rgba(39, 39, 42, 0.92)';
            ctx.fillRect(Math.max(2, cx0 + 2), 14, boxW, 13);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 9px monospace';
            ctx.fillText(ch.chord, Math.max(5, cx0 + 5), 24);
            lastChordX = cx0;
          }
        }
      }
    }

    // 2. Overlay Detected Drum Hits OR Detected Melodic/Polyphonic Notes!
    if (r.analysis) {
      if (r.analysis.mode === 'drums') {
        const colorMap: Record<DrumPieceRole, string> = {
          kick: '#FB923C',
          snare: '#22D3EE',
          hat: '#FBBF24',
          crash: '#F472B6',
          tom: '#34D399',
        };
        for (const hit of r.analysis.drumHits) {
          if (hit.peakTimeSec < viewStartSec || hit.peakTimeSec > viewEndSec) continue;
          const x = secToX(hit.peakTimeSec);
          const isSel = hit.id === selectedHitId;
          const barH = Math.max(14, hit.velocity * (h * 0.44));
          if (isSel) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
            ctx.fillRect(x - 6, 0, 12, h);
          }
          ctx.fillStyle = isSel ? '#FFFFFF' : colorMap[hit.role];
          if (hit.role === 'kick') {
            ctx.fillRect(x - (isSel ? 2 : 1.2), h - barH - 4, isSel ? 4 : 2.4, barH);
          } else if (hit.role === 'snare') {
            ctx.fillRect(x - (isSel ? 2 : 1.2), midY - barH * 0.6, isSel ? 4 : 2.4, barH);
          } else if (hit.role === 'crash') {
            ctx.fillRect(x - (isSel ? 2 : 1.3), 2, isSel ? 4 : 2.6, barH * 0.85);
            ctx.fillRect(x - 4, 2, 8, 3.5);
          } else if (hit.role === 'hat') {
            ctx.fillRect(x - (isSel ? 1.6 : 0.9), 4, isSel ? 3.2 : 1.8, barH * 0.65);
          } else {
            ctx.fillRect(x - (isSel ? 2.2 : 1.4), midY - barH * 0.2, isSel ? 4.4 : 2.8, barH * 0.78);
          }
        }
      } else {
        const minM = r.analysis.midiRange?.minMidi ?? 36;
        const maxM = Math.max(minM + 12, r.analysis.midiRange?.maxMidi ?? 72);
        const spanM = maxM - minM;
        for (const ev of r.analysis.noteEvents) {
          const evEnd = ev.startSec + ev.durationSec;
          if (evEnd < viewStartSec || ev.startSec > viewEndSec) continue;
          const x0 = Math.max(0, secToX(ev.startSec));
          const x1 = Math.min(w, secToX(evEnd));
          const bw = Math.max(3, x1 - x0);
          const normPitch = (ev.midiNote - minM) / spanM;
          const y = h - 18 - normPitch * (h - 32);

          ctx.fillStyle =
            ev.midiNote < 50
              ? 'rgba(255, 107, 0, 0.82)'
              : ev.midiNote < 64
              ? 'rgba(0, 229, 255, 0.82)'
              : 'rgba(16, 185, 129, 0.85)';
          ctx.fillRect(x0, y - 3, bw, 6);
        }
      }
    }

    // 3. Playhead (high-contrast cyan-white cursor so it stands out cleanly over white grid bars)
    if (r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec) {
      const px = secToX(r.currentTimeSec);
      ctx.save();
      ctx.shadowColor = 'rgba(0, 229, 255, 0.85)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#00E5FF';
      ctx.fillRect(px - 1, 0, 2, h);
      ctx.restore();
    }
  }, [
    r.originalBuffer,
    r.waveformPyramid,
    r.importedMemory,
    r.analysis,
    r.currentTimeSec,
    r.abMode,
    showBeatGrid,
    visibleGridLines,
    editorSizeMode,
    selectedHitId,
    duration,
    viewStartSec,
    viewEndSec,
    viewSpanSec,
    canvasResizeTick,
  ]);

  // Keep Waveform & Overview canvases crisp on resize or fullscreen transitions
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const syncWidth = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 40) {
        setWaveformWidthPx(Math.round(rect.width));
      }
      setCanvasResizeTick((t) => (t + 1) & 0xffff);
    };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render Full-Song Waveform + Hits Overview Canvas inside the Waveform Horizontal Scrollbar
  useEffect(() => {
    const canvas = waveformOverviewCanvasRef.current;
    if (!canvas || !r.originalBuffer || duration <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(140, rect.width);
    const h = Math.max(18, rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#03060F';
    ctx.fillRect(0, 0, w, h);

    const midY = h / 2;
    const totalSamples = r.originalBuffer.length;
    const samplesPerPx = Math.max(1, totalSamples / w);
    const level =
      r.waveformPyramid?.levels
        .slice()
        .reverse()
        .find((lvl) => lvl.bucketSize <= samplesPerPx) ?? r.waveformPyramid?.levels[0];

    if (level) {
      ctx.fillStyle =
        r.abMode === 'replaced' ? 'rgba(0, 229, 255, 0.5)' : 'rgba(148, 163, 184, 0.55)';
      for (let x = 0; x < w; x++) {
        const b0 = Math.max(0, Math.floor((x * samplesPerPx) / level.bucketSize));
        const b1 = Math.min(level.mins.length - 1, Math.ceil(((x + 1) * samplesPerPx) / level.bucketSize));
        let mn = 1;
        let mx = -1;
        for (let b = b0; b <= b1; b++) {
          if (level.mins[b] < mn) mn = level.mins[b];
          if (level.maxs[b] > mx) mx = level.maxs[b];
        }
        const yTop = midY - mx * (h * 0.44);
        const yBot = midY - mn * (h * 0.44);
        ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
      }
    }

    if (r.analysis?.mode === 'drums' && r.analysis.drumHits.length > 0) {
      for (const hit of r.analysis.drumHits) {
        if (hit.role !== 'kick' && hit.role !== 'snare' && hit.role !== 'crash') continue;
        const x = (hit.peakTimeSec / duration) * w;
        ctx.fillStyle =
          hit.role === 'kick'
            ? 'rgba(255, 107, 0, 0.72)'
            : hit.role === 'snare'
            ? 'rgba(0, 229, 255, 0.65)'
            : 'rgba(236, 72, 153, 0.65)';
        ctx.fillRect(x, hit.role === 'kick' ? h - 5 : 1, 1.2, 4);
      }
    } else if (r.analysis && r.analysis.noteEvents.length > 0) {
      const minM = r.analysis.midiRange?.minMidi ?? 36;
      const maxM = Math.max(minM + 12, r.analysis.midiRange?.maxMidi ?? 72);
      const spanM = maxM - minM;
      for (const ev of r.analysis.noteEvents) {
        const x0 = (ev.startSec / duration) * w;
        const bw = Math.max(1.5, (ev.durationSec / duration) * w);
        const y = h - 3 - ((ev.midiNote - minM) / spanM) * (h - 6);
        ctx.fillStyle =
          ev.midiNote < 50
            ? 'rgba(255, 107, 0, 0.78)'
            : ev.midiNote < 64
            ? 'rgba(0, 229, 255, 0.75)'
            : 'rgba(16, 185, 129, 0.78)';
        ctx.fillRect(x0, y - 1, bw, 2);
      }
    }
  }, [
    r.originalBuffer,
    r.waveformPyramid,
    r.analysis,
    r.abMode,
    duration,
    editorSizeMode,
    canvasResizeTick,
  ]);

  const handleManualHorizontalScroll = useCallback(() => {
    if (r.isPlaying) {
      setAutoFollowPlayhead(false);
    }
  }, [r.isPlaying]);

  const handleHorizontalScrollChange = useCallback(
    (nextNorm: number, isManualUserAction = false) => {
      setScrollNorm(clampHorizontalScrollNorm(nextNorm, zoom));
      if (isManualUserAction && r.isPlaying) {
        setAutoFollowPlayhead(false);
      }
    },
    [zoom, r.isPlaying]
  );

  const handleHorizontalZoomAndScroll = useCallback(
    (nextZoomRaw: number, nextScrollNorm: number, isManualUserAction = false) => {
      const clampedZoom = Math.max(1, Math.min(MAX_HORIZONTAL_ZOOM, nextZoomRaw));
      setZoom(clampedZoom);
      setScrollNorm(clampHorizontalScrollNorm(nextScrollNorm, clampedZoom));
      if (isManualUserAction && r.isPlaying) {
        setAutoFollowPlayhead(false);
      }
    },
    [r.isPlaying]
  );

  const applyHorizontalZoom = useCallback(
    (nextZoomRaw: number, anchorNorm01?: number) => {
      if (duration <= 0) return;
      let resolvedAnchor = anchorNorm01;
      if (resolvedAnchor === undefined) {
        if (r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec) {
          resolvedAnchor = (r.currentTimeSec - viewStartSec) / Math.max(0.001, viewSpanSec);
        } else {
          resolvedAnchor = 0.5;
        }
      }
      const next = computeAnchoredHorizontalZoom({
        duration,
        currentZoom: zoom,
        currentScrollNorm: scrollNorm,
        nextZoomRaw,
        anchorNorm01: resolvedAnchor,
      });
      setZoom(next.zoom);
      setScrollNorm(next.scrollNorm);
    },
    [duration, r.currentTimeSec, viewStartSec, viewEndSec, viewSpanSec, zoom, scrollNorm]
  );

  const handleToggleAutoFollowPlayhead = useCallback(() => {
    setAutoFollowPlayhead((prev) => {
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
  }, [zoom, duration, viewSpanSec, r.currentTimeSec]);

  // Auto-follow playhead during playback (only when currentTimeSec advances so manual horizontal scroll is never fought!)
  useEffect(() => {
    if (!r.isPlaying || !autoFollowPlayhead || zoom <= 1.02 || duration <= 0) {
      lastAutoFollowTimeRef.current = r.currentTimeSec;
      return;
    }
    const t = r.currentTimeSec;
    const prevT = lastAutoFollowTimeRef.current;
    lastAutoFollowTimeRef.current = t;
    if (Math.abs(t - prevT) < 0.0005) return;
    if (t > viewEndSec - viewSpanSec * 0.06 || t < viewStartSec - 0.02) {
      const targetStartSec = Math.max(
        0,
        Math.min(duration - viewSpanSec, t - viewSpanSec * 0.12)
      );
      setScrollNorm(clampHorizontalScrollNorm(targetStartSec / duration, zoom));
    }
  }, [
    r.isPlaying,
    r.currentTimeSec,
    autoFollowPlayhead,
    zoom,
    duration,
    viewStartSec,
    viewEndSec,
    viewSpanSec,
  ]);

  // Non-passive Wheel Handler on Waveform Canvas:
  // - Shift+Wheel or Trackpad Horizontal Swipe = Smooth Horizontal Scroll across the song
  // - Plain Wheel or Ctrl/Meta+Wheel = Anchored Horizontal Zoom at cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (!r.originalBuffer || duration <= 0) return;
      const isHorizontalIntent =
        e.shiftKey || (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 2);

      if (isHorizontalIntent) {
        if (zoom > 1.01) {
          e.preventDefault();
          const rawDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          const normDelta = (rawDelta / 900) * (1 / zoom);
          setScrollNorm((prev) => clampHorizontalScrollNorm(prev + normDelta, zoom));
          if (r.isPlaying) setAutoFollowPlayhead(false);
        }
        return;
      }

      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.3 : 0.77;
      const rect = canvas.getBoundingClientRect();
      const cursorNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const next = computeAnchoredHorizontalZoom({
        duration,
        currentZoom: zoom,
        currentScrollNorm: scrollNorm,
        nextZoomRaw: zoom * factor,
        anchorNorm01: cursorNorm,
      });
      setZoom(next.zoom);
      setScrollNorm(next.scrollNorm);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [r.originalBuffer, r.isPlaying, duration, zoom, scrollNorm]);

  const handleWaveformPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || duration <= 0) return;
    const isMiddle = e.button === 1;
    const isPrimary = e.button === 0;
    if (!isMiddle && !isPrimary) return;
    if (isMiddle) e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    waveformPanRef.current = {
      active: true,
      didDrag: false,
      startClientX: e.clientX,
      startScrollNorm: clampHorizontalScrollNorm(viewStartSec / duration, zoom),
      width: Math.max(120, rect.width),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleWaveformPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = waveformPanRef.current;
    if (!st || !st.active || zoom <= 1.01 || duration <= 0) return;
    const dx = e.clientX - st.startClientX;
    if (!st.didDrag && Math.abs(dx) >= 5) {
      st.didDrag = true;
      setIsPanningWaveform(true);
      if (r.isPlaying) setAutoFollowPlayhead(false);
    }
    if (st.didDrag) {
      const normDelta = -(dx / st.width) * (1 / zoom);
      setScrollNorm(clampHorizontalScrollNorm(st.startScrollNorm + normDelta, zoom));
    }
  };

  const handleWaveformPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = waveformPanRef.current;
    waveformPanRef.current = null;
    setIsPanningWaveform(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (!st || st.didDrag || e.button === 1 || !canvasRef.current || duration <= 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const norm = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    r.seekToSec(viewStartSec + norm * viewSpanSec);
  };

  const renderCustomSourceControls = (
    target: DrumPieceRole | 'melodic',
    slot: typeof r.melodicSlot
  ) => {
    const isRec = r.recordingTarget === target;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {target !== 'melodic' && (
          <button
            type="button"
            onClick={() => setKit1400ModalState({ open: true, role: target })}
            className="px-2.5 py-1 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-400/35 text-[10.5px] font-semibold text-orange-200 flex items-center gap-1 cursor-pointer transition-all"
            title="Explorar carpeta 1400 Samples Drum Kit (Kicks, Snares, Hats, Claps)"
          >
            <FolderOpen size={11} className="text-orange-400" />
            <span>Pack 1400</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            uploadTargetRef.current = target;
            slotFileInputRef.current?.click();
          }}
          className="px-2.5 py-1 rounded-lg bg-[#1C1C21] hover:bg-[#27272E] border border-white/[0.1] text-[10.5px] font-medium text-zinc-100 flex items-center gap-1 cursor-pointer transition-all"
          title="Subir tu propio audio de reemplazo (WAV, MP3, FLAC, OGG, M4A)"
        >
          <Upload size={11} />
          <span>Subir Audio</span>
        </button>

        <button
          type="button"
          onClick={() => void r.toggleMicRecordingForSlot(target)}
          className={`px-2 py-1 rounded-lg border text-[10.5px] font-medium flex items-center gap-1 cursor-pointer transition-all ${
            isRec
              ? 'bg-rose-500 border-rose-400 text-white animate-pulse'
              : 'bg-[#17171B] hover:bg-[#222228] border-white/[0.08] text-zinc-300 hover:text-rose-300'
          }`}
          title="Grabar muestra directamente desde tu micrófono o interfaz"
        >
          {isRec ? <Square size={10} className="fill-current" /> : <Mic size={11} className="text-rose-400" />}
          <span>{isRec ? 'Detener Mic' : 'Grabar Mic'}</span>
        </button>

        {loadedCreatorPads.length > 0 && getBufferForPad && (
          <select
            defaultValue=""
            onChange={(e) => {
              const pIdx = Number(e.target.value);
              const pad = padsFromCreator[pIdx];
              const buf = getBufferForPad(pIdx);
              if (pad && buf) {
                r.applyCustomBufferToSlot(target, buf, `Pad: ${pad.label}`, 'pad');
              }
              e.target.value = '';
            }}
            className="bg-[#0B0B0D] border border-white/[0.08] rounded-lg px-2 py-1 text-[10.5px] text-amber-300 cursor-pointer"
          >
            <option value="" disabled>
              Usar Pad...
            </option>
            {loadedCreatorPads.map((p) => (
              <option key={p.index} value={p.index}>
                Pad {p.index + 1}: {p.label}
              </option>
            ))}
          </select>
        )}

        {slot.sourceType !== 'preset' && (
          <>
            <label
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#17171B] border border-white/[0.08] text-[10px] text-emerald-300 cursor-pointer"
              title="Normalizar automáticamente tu muestra propia a -1.0 dBFS"
            >
              <input
                type="checkbox"
                checked={slot.normalizeCustom !== false}
                onChange={(e) => {
                  const nextNorm = e.target.checked;
                  if (target === 'melodic') {
                    r.updateMelodicSlot({ normalizeCustom: nextNorm });
                  } else {
                    r.updateDrumSlot(target, { normalizeCustom: nextNorm });
                  }
                }}
                className="accent-emerald-400"
              />
              <span>Norm</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (target === 'melodic') {
                  r.updateMelodicSlot({
                    sourceType: 'preset',
                    kit1400Id: undefined,
                    customSampleId: undefined,
                    customBuffer: undefined,
                    customName: undefined,
                  });
                } else {
                  const defaultKitId = DEFAULT_DRUM_KIT_1400_BY_ROLE[target];
                  if (defaultKitId && slot.kit1400Id !== defaultKitId) {
                    void r.selectDrumKit1400Sample(defaultKitId, target, {
                      audition: true,
                      saveToSupabase: true,
                    });
                  } else {
                    r.updateDrumSlot(target, {
                      sourceType: 'preset',
                      kit1400Id: undefined,
                      customSampleId: undefined,
                      customBuffer: undefined,
                      customName: undefined,
                    });
                  }
                }
              }}
              className="px-2 py-1 rounded-lg bg-[#1C1C21] hover:bg-[#27272E] text-[10px] text-zinc-400 hover:text-white cursor-pointer"
              title="Restablecer a muestra predeterminada"
            >
              Volver a Predet.
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3.5">
      <input
        ref={stemFileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,.aiff,.aif,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void r.loadLocalStemFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={masterRefFileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,.aiff,.aif,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void r.loadLocalMasterReferenceFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={slotFileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void r.loadCustomFileForSlot(uploadTargetRef.current, f);
          e.target.value = '';
        }}
      />
      <input
        ref={bankBatchFileInputRef}
        type="file"
        multiple
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void r.uploadCustomReplacementFiles(
              e.target.files,
              r.stemMode === 'drums' ? 'auto' : 'melodic'
            );
            setShowCustomBank(true);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={midiFileInputRef}
        type="file"
        accept=".mid,.midi,audio/midi"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void r.importMidiFileForReplacement(f);
          e.target.value = '';
        }}
      />

      {/* STEP 1: SONG FOLDER -> 1 STEM SELECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Song Folder Selector (Image 3 matte sidebar list feel) */}
        <div className="lg:col-span-5 rounded-2xl bg-[#121215] border border-white/[0.08] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderOpen size={15} className="text-orange-400" />
              <span className="text-xs font-semibold tracking-tight text-zinc-100">
                1. Elige Canción (Carpeta)
              </span>
            </div>
            <button
              type="button"
              onClick={() => void r.refreshSongs()}
              className="p-1.5 rounded-lg bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-zinc-400 hover:text-white cursor-pointer transition-colors"
              title="Actualizar lista de canciones"
            >
              <RefreshCw size={12} className={r.loadingSongs ? 'animate-spin' : ''} />
            </button>
          </div>

          <input
            type="text"
            value={songSearch}
            onChange={(e) => setSongSearch(e.target.value)}
            placeholder="Buscar canción..."
            className="w-full px-3 py-1.5 rounded-xl bg-[#0B0B0D] border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-white/25"
          />

          <div className="max-h-40 overflow-y-auto studio-scrollbar-thin space-y-1.5 pr-1">
            {filteredSongs.length === 0 ? (
              <div className="text-xs text-zinc-500 py-4 text-center">
                {r.loadingSongs
                  ? 'Cargando carpetas desde Supabase...'
                  : 'Sin canciones encontradas. Puedes cargar un stem local o usar una Demo.'}
              </div>
            ) : (
              filteredSongs.map((song) => {
                const active = song.id === r.selectedSongId;
                return (
                  <button
                    key={song.id}
                    type="button"
                    onClick={() => r.setSelectedSongId(song.id)}
                    className={`w-full px-3 py-2 rounded-xl border text-left text-xs flex items-center justify-between cursor-pointer transition-all ${
                      active
                        ? 'bg-[#1D1D23] border-white/[0.22] text-white font-medium'
                        : 'bg-[#0E0E11] border-white/[0.06] text-zinc-300 hover:bg-[#17171C] hover:border-white/[0.12]'
                    }`}
                  >
                    <span className="truncate">{song.title}</span>
                    <span className="text-[10.5px] font-mono text-zinc-500 shrink-0 ml-2">
                      {song.bpm ? `${song.bpm} bpm · ` : ''}
                      {song.stems.length} stems
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Single Stem Selector OR Direct PC Audio Upload (with Drag & Drop) */}
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setDragOverTarget('stem-local');
            }
          }}
          onDragLeave={() => setDragOverTarget((prev) => (prev === 'stem-local' ? null : prev))}
          onDrop={(e) => {
            const f = e.dataTransfer.files?.[0];
            setDragOverTarget(null);
            if (f) {
              e.preventDefault();
              void r.loadLocalStemFile(f);
            }
          }}
          className={`lg:col-span-7 rounded-2xl border p-4 flex flex-col justify-between gap-3 transition-all ${
            dragOverTarget === 'stem-local'
              ? 'bg-white/[0.05] border-white/30'
              : 'bg-[#121215] border-white/[0.08]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers size={15} className="text-zinc-300" />
              <span className="text-xs font-semibold tracking-tight text-zinc-100">
                2. Selecciona 1 Stem a Samplear{' '}
                {r.selectedSong ? (
                  <span className="text-zinc-400 font-normal">({r.selectedSong.title})</span>
                ) : null}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => stemFileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Sube un archivo WAV, MP3, FLAC, OGG o M4A directo desde tu PC para samplear y exportar"
              >
                <Upload size={12} />
                <span>Subir Archivo del PC</span>
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('drums')}
                className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-[10.5px] font-medium text-orange-300 cursor-pointer transition-colors"
              >
                Demo Batería
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('monophonic')}
                className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-[10.5px] font-medium text-emerald-300 cursor-pointer transition-colors"
              >
                Demo Bajo
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('polyphonic')}
                className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-[10.5px] font-medium text-zinc-200 cursor-pointer transition-colors"
              >
                Demo Piano/Guitarra
              </button>
            </div>
          </div>

          {r.originalBuffer && !r.selectedStemId && (
            <div className="rounded-xl bg-[#18181D] border border-white/[0.12] p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <div className="font-semibold text-zinc-100 truncate">
                  {r.stemTitle || 'Audio cargado'}
                </div>
                <div className="text-[11px] font-mono text-zinc-400">
                  {formatTime(r.originalBuffer.duration)} · {Math.round(r.originalBuffer.sampleRate / 1000)} kHz ·{' '}
                  {r.analysis ? `${r.analysis.bpm} BPM` : 'Analizando...'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {onSendTo16Pads && (
                  <button
                    type="button"
                    onClick={() =>
                      onSendTo16Pads(
                        r.replacedBuffer ?? r.originalBuffer!,
                        r.stemTitle || 'Sample_PC',
                        r.importedMemory
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-semibold cursor-pointer"
                    title="Abrir este audio en el Creador 16 Pads para cortar slices, aplicar efectos y exportar"
                  >
                    Cortar en 16 Pads →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => stemFileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-[#24242B] hover:bg-[#2E2E36] border border-white/[0.08] text-[11px] text-zinc-200 hover:text-white cursor-pointer"
                >
                  Cambiar Archivo
                </button>
              </div>
            </div>
          )}

          {r.selectedSong && r.selectedSong.stems.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto studio-scrollbar-thin pr-1">
              {r.selectedSong.stems.map((st) => {
                const isSelected = st.id === r.selectedStemId;
                return (
                  <button
                    key={st.id}
                    type="button"
                    disabled={r.isLoadingStem}
                    onClick={() => void r.loadSongStem(st, r.selectedSong ?? undefined)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1 disabled:opacity-50 ${
                      isSelected
                        ? 'bg-[#222229] border-white/[0.24] text-white'
                        : 'bg-[#0E0E11] border-white/[0.06] text-zinc-300 hover:bg-[#17171C] hover:border-white/[0.12]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-medium truncate">{st.name}</span>
                      {st.isMaster && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25">
                          MASTER
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                      <span>
                        {st.inferredMode === 'drums'
                          ? 'Golpes Batería'
                          : st.inferredMode === 'monophonic'
                          ? 'Notas Mono'
                          : 'Acordes Poli'}
                      </span>
                      {st.durationSec ? <span>{formatTime(st.durationSec)}</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : !r.originalBuffer ? (
            <div className="rounded-xl bg-[#0B0B0D] border border-dashed border-white/[0.1] p-5 text-center text-xs text-zinc-500">
              {r.isLoadingStem ? (
                <span className="inline-flex items-center gap-2 text-zinc-200">
                  <Loader2 size={14} className="animate-spin" /> Decodificando audio del PC / stem...
                </span>
              ) : (
                'Arrastra un archivo de tu PC aquí, pulsa Subir Archivo del PC, o elige una canción a la izquierda.'
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* MASTER REFERENCE AUDIO GUIDE FOR 100% ACCURATE DRUMS, BASS & CHORDS DETECTION */}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragOverTarget('master-ref');
          }
        }}
        onDragLeave={() => setDragOverTarget((prev) => (prev === 'master-ref' ? null : prev))}
        onDrop={(e) => {
          const f = e.dataTransfer.files?.[0];
          setDragOverTarget(null);
          if (f) {
            e.preventDefault();
            void r.loadLocalMasterReferenceFile(f);
          }
        }}
        className={`rounded-2xl border p-4 flex flex-col gap-2.5 transition-all text-xs ${
          dragOverTarget === 'master-ref'
            ? 'bg-amber-500/10 border-amber-400/50'
            : r.masterReferenceBuffer
            ? 'bg-[#141315] border-amber-500/25'
            : 'bg-[#121215] border-white/[0.08]'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono font-semibold text-[10px]">
              ★ AUDIO MASTER GUÍA
            </span>
            <span className="font-medium text-zinc-100 text-xs">
              Detección de Alta Precisión (Kick, Snare, Hi-Hat, Crash, Bajo y Acordes)
            </span>
            {r.masterReferenceBuffer && (
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/12 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono font-medium">
                ● Activa
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={r.isLoadingMasterRef}
              onClick={() => masterRefFileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-[#222228] hover:bg-[#2D2D35] border border-white/[0.12] text-zinc-100 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
              title="Sube el audio Master (canción completa) desde tu PC para que el sistema identifique al 100% Batería, Bajo y Acordes y trabaje luego sobre tu archivo Solo Drums o Solo Bass"
            >
              {r.isLoadingMasterRef ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Upload size={12} className="text-amber-400" />
              )}
              <span>
                {r.masterReferenceBuffer ? 'Cambiar Audio Master (PC)' : '+ Agregar Audio Master (PC)'}
              </span>
            </button>

            {r.selectedSong &&
              r.selectedSong.stems.some(
                (s) => s.isMaster || /\b(master|mezcla|mix|full)\b/i.test(s.name)
              ) && (
                <button
                  type="button"
                  disabled={r.isLoadingMasterRef}
                  onClick={() => void r.loadSongMasterAsReference()}
                  className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242B] border border-amber-500/30 text-amber-300 text-[11px] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  title="Vincular la pista ★ Master guardada en esta canción como Guía de Detección"
                >
                  <Sparkles size={11} />
                  <span>Usar Master de Canción</span>
                </button>
              )}

            <label
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#0B0B0D] border border-white/[0.07] text-[11px] text-zinc-400 cursor-pointer"
              title="Al elegir un stem (Drums o Bass) de una canción que tiene pista Master, vincula automáticamente el Master como guía de detección"
            >
              <input
                type="checkbox"
                checked={r.autoUseSongMaster}
                onChange={(e) => r.setAutoUseSongMaster(e.target.checked)}
                className="accent-amber-400"
              />
              <span>Auto-vincular Master</span>
            </label>

            {r.masterReferenceBuffer && (
              <button
                type="button"
                onClick={() => void r.clearMasterReference()}
                className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-rose-500/15 border border-white/[0.08] hover:border-rose-500/35 text-zinc-400 hover:text-rose-300 text-[11px] cursor-pointer"
                title="Quitar el Audio Master Guía y detectar únicamente desde el stem cargado"
              >
                Quitar Guía
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06] text-[11px]">
          {r.masterReferenceBuffer ? (
            <div className="flex flex-wrap items-center gap-2 text-zinc-300">
              <span className="text-zinc-100 font-medium">
                {r.masterReferenceTitle}
              </span>
              <span className="text-zinc-500 font-mono">
                {formatTime(r.masterReferenceBuffer.duration)} ·{' '}
                {r.masterReferenceMemory?.bpm ?? r.analysis?.bpm ?? 120} BPM ·{' '}
                {r.masterReferenceMemory?.musicalKey || 'Detectado'} ·{' '}
                {r.masterReferenceMemory?.chords.length ?? 0} acordes
              </span>
              <span className="text-[10.5px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                ✓ Detecta en Master · Exporta solo tu Stem ({r.stemTitle || 'Drums / Bass'})
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-zinc-500">
              ¿Tu stem de Batería o Bajo salió sucio o perdió golpes por separación IA? Agrega aquí el{' '}
              <strong className="text-zinc-300 font-medium">Audio Master</strong> para detectar con precisión y trabajar sobre tu stem aislado.
            </span>
          )}

          {r.masterReferenceBuffer && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10.5px] text-zinc-500">Modo Guía:</span>
              <select
                value={r.detectionSourceMode}
                onChange={(e) =>
                  void r.changeDetectionSourceMode(e.target.value as DetectionSourceMode)
                }
                className="bg-[#0B0B0D] border border-white/[0.1] rounded-lg px-2 py-1 text-[11px] text-zinc-200 font-medium cursor-pointer"
                title="Elige cómo el Audio Master guía la detección sobre tu Stem de Batería o Bajo"
              >
                <option value="auto-hybrid">
                  Fusión Master + Stem (Recomendado)
                </option>
                <option value="master-only">
                  100% desde Master (Rescate total)
                </option>
                <option value="stem-only">Solo Stem Actual (Ignorar Master)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* STATUS & PROGRESS BANNER */}
      {(r.statusMessage || r.isAnalyzing || r.isLoadingStem || r.isTranscribingAi) && (
        <div className="rounded-xl bg-[#141418] border border-white/[0.1] px-3.5 py-2 text-xs text-zinc-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {(r.isAnalyzing || r.isLoadingStem || r.isRendering || r.isTranscribingAi) && (
              <Loader2 size={14} className="animate-spin shrink-0 text-zinc-300" />
            )}
            <span className="font-mono text-[11.5px]">
              {r.isLoadingStem
                ? 'Cargando stem...'
                : r.isTranscribingAi
                ? r.aiStageMessage || 'Transcribiendo Batería y Tempo a MIDI con IA Replicate...'
                : r.isAnalyzing
                ? 'Analizando tempo y cada golpe/nota de toda la pista...'
                : r.statusMessage}
            </span>
          </div>
          {r.statusMessage && !r.isAnalyzing && !r.isTranscribingAi && (
            <button
              type="button"
              onClick={() => r.setStatusMessage(null)}
              className="text-zinc-500 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* STORED PRE-IMPORT TEMPO & CHORDS MEMORY STRIP */}
      {r.importedMemory && (
        <div className="rounded-2xl bg-[#121215] border border-white/[0.08] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-zinc-400 font-medium mr-1">
              Tempo & Armonía
            </span>
            <div className="inline-flex items-center gap-1 bg-[#0B0B0D] border border-white/[0.1] rounded-lg px-2 py-0.5 font-mono">
              <input
                type="number"
                min={40}
                max={220}
                step={0.5}
                value={bpmDraft}
                onChange={(e) => setBpmDraft(e.target.value)}
                onBlur={() => {
                  const n = Number(bpmDraft);
                  if (Number.isFinite(n) && n >= 40 && n <= 220) {
                    void r.updateImportedTempo(n);
                  } else {
                    setBpmDraft(String(r.importedMemory?.bpm ?? 120));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="w-12 bg-transparent text-zinc-100 font-semibold text-center focus:outline-none"
                title="BPM del stem (editable manualmente)"
              />
              <span className="text-[10px] text-zinc-500">BPM</span>
            </div>
            <div className="inline-flex items-center bg-[#0B0B0D] border border-white/[0.07] rounded-lg p-0.5 font-mono text-[10px]">
              <button
                type="button"
                onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm - 1)}
                className="px-1.5 py-0.5 rounded hover:bg-[#222228] text-zinc-400 hover:text-white cursor-pointer"
                title="Restar 1 BPM"
              >
                −1
              </button>
              <button
                type="button"
                onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm + 1)}
                className="px-1.5 py-0.5 rounded hover:bg-[#222228] text-zinc-400 hover:text-white cursor-pointer"
                title="Sumar 1 BPM"
              >
                +1
              </button>
              <button
                type="button"
                onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm * 0.5)}
                className="px-1.5 py-0.5 rounded hover:bg-[#222228] text-zinc-400 hover:text-white cursor-pointer"
                title="Mitad del tempo (÷2)"
              >
                ÷2
              </button>
              <button
                type="button"
                onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm * 2)}
                className="px-1.5 py-0.5 rounded hover:bg-[#222228] text-zinc-400 hover:text-white cursor-pointer"
                title="Doble tempo (×2)"
              >
                ×2
              </button>
            </div>
            <button
              type="button"
              onClick={handleTapTempo}
              className="px-2.5 py-1 rounded-lg bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-orange-300 text-[10.5px] font-medium cursor-pointer"
              title="Pulsa 3 o más veces al ritmo de la batería para fijar el tempo"
            >
              Tap BPM
            </button>
            <button
              type="button"
              disabled={!r.originalBuffer || r.isAnalyzing}
              onClick={() => void r.reDetectTempoFromDrums()}
              className="px-2.5 py-1 rounded-lg bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-zinc-200 text-[10.5px] font-medium cursor-pointer disabled:opacity-40"
              title="Aísla los golpes de Bombo y Caja eliminando suciedad/sangrado para recalcular el BPM exacto"
            >
              Re-Detectar Tempo
            </button>
            <span className="px-2 py-0.5 rounded-md bg-[#1A1A1F] border border-white/[0.07] text-zinc-200 font-mono text-[10.5px]">
              {!r.importedMemory.isTonal ||
              r.importedMemory.musicalKey.endsWith('m') ||
              r.importedMemory.musicalKey.toLowerCase().includes('major')
                ? r.importedMemory.musicalKey
                : `${r.importedMemory.musicalKey} major`}
            </span>
            {r.importedMemory.camelotKey && (
              <span className="px-2 py-0.5 rounded-md bg-[#1A1A1F] border border-white/[0.07] text-zinc-400 font-mono text-[10.5px]">
                {r.importedMemory.camelotKey}
              </span>
            )}
            {(r.importedMemory.downbeats?.length ?? 0) > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-[#1A1A1F] border border-white/[0.07] text-zinc-400 font-mono text-[10.5px]">
                {r.importedMemory.downbeats!.length} comp.
              </span>
            )}
            {r.importedMemory.chords.length > 0 ? (
              <>
                <span className="text-zinc-500 ml-1">Acordes:</span>
                {r.importedMemory.chords.slice(0, 16).map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => r.seekToSec(ch.startSec)}
                    className="px-2 py-0.5 rounded-md bg-[#1B1B22] hover:bg-[#282832] border border-white/[0.08] text-zinc-200 font-mono text-[10.5px] cursor-pointer transition-colors"
                    title={`Ir a ${ch.chord} (${ch.startSec.toFixed(2)}s–${ch.endSec.toFixed(2)}s · Sub ${ch.rootName})`}
                  >
                    {ch.chord}
                  </button>
                ))}
              </>
            ) : (
              <span className="text-zinc-500">· {r.importedMemory.chordProgressionSummary}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-zinc-500">Cuantizar:</span>
            <select
              value={r.quantizeMode}
              onChange={(e) =>
                void r.changeQuantizeModeAndReanalyze(
                  e.target.value as 'off' | 'soft' | 'grid-16' | 'grid-8'
                )
              }
              className="bg-[#0B0B0D] border border-white/[0.08] rounded-lg px-2 py-1 text-zinc-200 font-medium cursor-pointer"
              title="Alinea el sampleo de golpes/notas al tempo y fase detectados en memoria"
            >
              <option value="soft">Suave (Auto-Sync)</option>
              <option value="grid-16">Rejilla 1/16</option>
              <option value="grid-8">Rejilla 1/8</option>
              <option value="off">Libre (Sin Snap)</option>
            </select>
          </div>
        </div>
      )}

      {/* STEP 2: FULL-STEM ANALYSIS CONTROLS + REPLICATE AI MIDI + LARGE STUDIO WORKSTATION EDITOR */}
      <div className="rounded-2xl bg-[#121215] border border-white/[0.08] p-4 shadow-[0_14px_40px_rgba(0,0,0,0.45)] flex flex-col gap-3.5">
        {/* REPLICATE AI NEURAL AUDIO-TO-MIDI & BEAT BAR */}
        <div className="rounded-xl bg-[#0C0C0F] border border-white/[0.07] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!r.originalBuffer || r.isTranscribingAi || r.isLoadingStem}
              onClick={() => void r.runReplicateAiMidiTranscription()}
              className="px-3.5 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-all"
              title="Ejecuta Google Magenta MT3 (Audio → General MIDI Canal 10) + Harmonix All-In-One Beat AI en GPU NVIDIA A100 de Replicate y fusiona con picos acústicos 48kHz"
            >
              {r.isTranscribingAi ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              <span>
                {r.isTranscribingAi
                  ? 'Procesando MIDI con IA...'
                  : 'IA Replicate: Batería → MIDI + Tempo (MT3)'}
              </span>
            </button>

            {r.stemMode === 'drums' && (
              <label
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#16161B] border border-white/[0.07] text-[11px] text-zinc-300 cursor-pointer hover:border-white/[0.15]"
                title="Si subiste una canción completa o mezcla muy sucia, Demucs v4 aísla la batería primero en Replicate antes de convertir cada golpe a MIDI con MT3"
              >
                <input
                  type="checkbox"
                  checked={r.isolateDrumsWithDemucs}
                  onChange={(e) => r.setIsolateDrumsWithDemucs(e.target.checked)}
                  className="accent-zinc-100"
                />
                <span>Aislar Batería 1° (Demucs IA)</span>
              </label>
            )}

            {r.analysis?.analysisEngine && (
              <span
                className={`px-2.5 py-0.5 rounded-lg border text-[10.5px] font-mono ${
                  r.analysis.analysisEngine === 'replicate-mt3'
                    ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-300'
                    : r.analysis.analysisEngine === 'midi-import'
                    ? 'bg-amber-500/12 border-amber-500/30 text-amber-300'
                    : 'bg-[#17171C] border-white/[0.08] text-zinc-400'
                }`}
              >
                {r.analysis.analysisEngine === 'replicate-mt3'
                  ? '✓ Motor: IA Replicate MT3 + 48kHz'
                  : r.analysis.analysisEngine === 'midi-import'
                  ? '✓ Motor: Archivo MIDI (.mid)'
                  : '⚡ Motor: DSP 6-Bandas → MIDI'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={!r.analysis}
              onClick={() => r.exportCurrentMidiFile(saveStemName || r.stemTitle)}
              className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-zinc-200 font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition-colors"
              title="Descargar archivo MIDI estándar (.mid) con Kick (36), Snare (38), Toms (43/47/50), Hi-Hat (42/46) y Crash (49)"
            >
              <Download size={12} />
              <span>Exportar MIDI</span>
            </button>

            <button
              type="button"
              onClick={() => midiFileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.08] text-zinc-200 font-medium flex items-center gap-1 cursor-pointer transition-colors"
              title="Importar un archivo .mid desde tu PC para disparar tus muestras propias de reemplazo"
            >
              <Upload size={12} />
              <span>Importar MIDI</span>
            </button>

            <button
              type="button"
              onClick={() => setShowReplicateTokenBar((v) => !v)}
              className="px-2.5 py-1.5 rounded-xl bg-[#16161B] hover:bg-[#222228] border border-white/[0.07] text-zinc-400 hover:text-white cursor-pointer text-[10.5px]"
              title="Configurar o verificar tu API Token de Replicate (r8_...)"
            >
              {r.replicateApiKey || import.meta.env.VITE_REPLICATE_API_TOKEN
                ? 'Replicate: Conectado'
                : 'Configurar Replicate'}
            </button>
          </div>
        </div>

        {showReplicateTokenBar && (
          <div className="rounded-xl bg-[#0B0B0D] border border-white/[0.1] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-zinc-400">
              Token Replicate API (<code className="text-zinc-200">r8_...</code> · o en{' '}
              <code className="text-emerald-300">.env</code>):
            </span>
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <input
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder={
                  import.meta.env.VITE_REPLICATE_API_TOKEN
                    ? 'Usando VITE_REPLICATE_API_TOKEN de .env (opcional)...'
                    : 'Pega tu token r8_...'
                }
                className="flex-1 bg-[#141418] border border-white/[0.1] rounded-lg px-2.5 py-1 text-xs text-white focus:border-white/25 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  r.saveReplicateApiKey(tokenDraft);
                  setShowReplicateTokenBar(false);
                }}
                className="px-3 py-1 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-semibold cursor-pointer"
              >
                Guardar
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-1 bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-1">
            {MODE_LABELS.map((m) => {
              const active = r.stemMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void r.changeStemModeAndReanalyze(m.id)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all ${
                    active
                      ? 'bg-[#26262E] text-white font-semibold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title={m.hint}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {/* Workspace Size Selector (Compacto / Grande XL / Pantalla Completa MIDI) */}
            <div className="flex items-center bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-0.5">
              <span className="px-2 text-[10.5px] text-zinc-500 hidden sm:inline">Vista:</span>
              {(
                [
                  { id: 'compact', label: 'Compacto' },
                  { id: 'large', label: 'Grande' },
                  { id: 'fullscreen', label: 'Pantalla Completa' },
                ] as const
              ).map((sz) => {
                const active = editorSizeMode === sz.id;
                return (
                  <button
                    key={sz.id}
                    type="button"
                    onClick={() => {
                      if (sz.id === 'fullscreen') {
                        setShowMidiRoll(true);
                      }
                      setEditorSizeMode(sz.id);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium flex items-center gap-1 cursor-pointer transition-all ${
                      active
                        ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                    title={`Cambiar vista del editor MIDI a ${sz.label}`}
                  >
                    {sz.id === 'fullscreen' && <Maximize2 size={10} />}
                    <span>{sz.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 bg-[#0B0B0D] border border-white/[0.07] rounded-xl px-2.5 py-1">
              <span className="text-zinc-500">Sensibilidad:</span>
              <input
                type="range"
                min={0.2}
                max={0.95}
                step={0.05}
                value={r.sensitivity}
                onChange={(e) => r.setSensitivity(Number(e.target.value))}
                className="w-16 accent-zinc-200 h-1 cursor-pointer"
              />
              <span className="text-zinc-200 font-mono tabular-nums">{Math.round(r.sensitivity * 100)}%</span>
            </div>

            {r.stemMode === 'polyphonic' && (
              <div className="flex items-center gap-1 bg-[#0B0B0D] border border-white/[0.07] rounded-xl px-2.5 py-1">
                <span className="text-zinc-500">Polifonía:</span>
                <select
                  value={r.maxPolyphony}
                  onChange={(e) => r.setMaxPolyphony(Number(e.target.value))}
                  className="bg-transparent text-zinc-100 font-medium focus:outline-none"
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n} className="bg-[#121215]">
                      {n} notas
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowMidiRoll((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-medium cursor-pointer transition-all ${
                showMidiRoll
                  ? 'bg-[#222228] border-white/[0.16] text-zinc-100'
                  : 'bg-[#0B0B0D] border-white/[0.07] text-zinc-500 hover:text-zinc-200'
              }`}
              title="Mostrar/ocultar Editor MIDI con Scroll Avanzado Horizontal y Vertical"
            >
              Editor MIDI {showMidiRoll ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={() => setShowBeatGrid((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-medium cursor-pointer transition-all ${
                showBeatGrid
                  ? 'bg-[#222228] border-white/[0.16] text-zinc-100'
                  : 'bg-[#0B0B0D] border-white/[0.07] text-zinc-500 hover:text-zinc-200'
              }`}
              title="Mostrar/ocultar grilla musical de compases, pulsos y acordes"
            >
              Grilla {showBeatGrid ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              disabled={!r.originalBuffer || r.isAnalyzing}
              onClick={() => void r.reanalyzeCurrentStem()}
              className="px-2.5 py-1.5 rounded-xl bg-[#1A1A1F] hover:bg-[#24242B] border border-white/[0.1] text-zinc-200 font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <Activity size={12} />
              <span>Re-Analizar</span>
            </button>
          </div>
        </div>

        {/* Interactive Waveform & Detected Hits/Notes Overlay + Dedicated Horizontal Scrollbar */}
        <div className="shrink-0 w-full rounded-xl overflow-hidden border border-white/[0.08] bg-[#0A0A0C] flex flex-col">
          <div
            className={`relative w-full transition-[height] duration-200 ${
              editorSizeMode === 'large' ? 'h-48' : 'h-36'
            }`}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handleWaveformPointerDown}
              onPointerMove={handleWaveformPointerMove}
              onPointerUp={handleWaveformPointerUp}
              onPointerCancel={handleWaveformPointerUp}
              className={`w-full h-full block ${
                isPanningWaveform
                  ? 'cursor-grabbing'
                  : zoom > 1.01
                  ? 'cursor-grab'
                  : 'cursor-pointer'
              }`}
              title="Haz clic para saltar al segundo exacto · Arrastra para moverte cuando haya zoom · Rueda para Zoom · Shift+Rueda para Scroll Horizontal"
            />
            {r.analysis && (
              <div className="absolute top-2.5 right-2.5 flex flex-wrap gap-1.5 pointer-events-none text-[10px] font-mono tabular-nums">
                <span className="px-2 py-0.5 rounded-md bg-[#09090B]/90 border border-white/[0.1] text-zinc-200 font-medium">
                  {r.analysis.bpm} BPM · {r.analysis.durationSec.toFixed(2)}s
                </span>
                {r.analysis.mode === 'drums' ? (
                  <>
                    <span className="px-2 py-0.5 rounded-md bg-[#09090B]/90 border border-orange-400/35 text-orange-300 font-medium">
                      KICK {r.analysis.counts.kick}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-[#09090B]/90 border border-cyan-400/35 text-cyan-300 font-medium">
                      SNARE {r.analysis.counts.snare}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-[#09090B]/90 border border-emerald-400/35 text-emerald-300 font-medium">
                      TOMS {r.analysis.counts.tom}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-[#09090B]/90 border border-amber-400/35 text-amber-300 font-medium">
                      HAT {r.analysis.counts.hat}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-[#09090B]/90 border border-pink-400/35 text-pink-300 font-medium">
                      CRASH {r.analysis.counts.crash}
                    </span>
                  </>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-[#09090B]/90 border border-emerald-500/30 text-emerald-300 font-medium">
                    {r.analysis.counts.notes} notas{' '}
                    {r.analysis.midiRange
                      ? `(${r.analysis.midiRange.minName}–${r.analysis.midiRange.maxName})`
                      : ''}
                  </span>
                )}
              </div>
            )}
          </div>


          {/* Dedicated Always-Visible Horizontal Scrollbar for Waveform ("Batería (Golpes + MIDI)" / Melódico / Polifónico) */}
          {duration > 0 && (
            <div className="shrink-0 bg-slate-950/95 border-t border-slate-800/90 px-2.5 py-1.5 flex flex-wrap sm:flex-nowrap items-center gap-2 text-[10px] font-mono select-none">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="px-1.5 py-0.5 rounded bg-[#FF6B00]/15 border border-[#FF6B00]/45 text-[#FF6B00] font-bold text-[9.5px]">
                  {r.stemMode === 'drums'
                    ? 'Onda Batería'
                    : r.stemMode === 'monophonic'
                    ? 'Onda Mono'
                    : 'Onda Poli'}
                </span>
                <button
                  type="button"
                  onClick={() => applyHorizontalZoom(zoom / 1.45)}
                  className="p-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  title="Alejar zoom horizontal de la onda"
                >
                  <ZoomOut size={11} />
                </button>
                <span className="text-[#FF6B00] font-bold tabular-nums min-w-[30px] text-center">
                  {zoom.toFixed(1)}x
                </span>
                <button
                  type="button"
                  onClick={() => applyHorizontalZoom(zoom * 1.45)}
                  className="p-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  title="Acercar zoom horizontal de la onda"
                >
                  <ZoomIn size={11} />
                </button>
              </div>

              <TimelineHorizontalScrollbar
                duration={duration}
                zoom={zoom}
                viewStartSec={viewStartSec}
                viewEndSec={viewEndSec}
                currentTimeSec={r.currentTimeSec}
                onChangeScrollNorm={handleHorizontalScrollChange}
                onChangeZoomAndScroll={handleHorizontalZoomAndScroll}
                onSeekToSec={r.seekToSec}
                accent="orange"
                trackHeightClass="h-6"
                ariaLabel="Scroll horizontal de la forma de onda"
                trackTitle="Barra horizontal de la onda · Arrastra para recorrer toda la canción, arrastra bordes para Zoom o doble clic para 1x/4x"
                overviewContent={
                  <canvas
                    ref={waveformOverviewCanvasRef}
                    className="w-full h-full block pointer-events-none opacity-90"
                  />
                }
              />

              <div className="flex items-center gap-1.5 shrink-0">
                {(!showMidiRoll || !r.analysis) && (
                  <button
                    type="button"
                    onClick={handleToggleAutoFollowPlayhead}
                    className={`px-1.5 py-0.5 rounded border text-[9.5px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                      autoFollowPlayhead
                        ? 'bg-[#FF6B00]/15 border-[#FF6B00]/60 text-[#FF6B00]'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                    title="Seguir automáticamente el cabezal de reproducción"
                  >
                    <Crosshair size={10} />
                    <span>Seguir</span>
                  </button>
                )}
                <span className="text-[9.5px] text-slate-400 tabular-nums">
                  {formatTime(viewStartSec)}–{formatTime(Math.min(duration, viewEndSec))}
                  <span className="text-slate-600"> / {formatTime(duration)}</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* LARGE MIDI WORKSTATION WITH ADVANCED HORIZONTAL & VERTICAL SCROLL + MINIMAP + FULLSCREEN PORTAL */}
        {showMidiRoll && r.analysis && duration > 0 && (
          <MidiTimelineWorkstation
            replacer={r}
            duration={duration}
            zoom={zoom}
            setZoom={setZoom}
            scrollNorm={scrollNorm}
            setScrollNorm={setScrollNorm}
            viewStartSec={viewStartSec}
            viewEndSec={viewEndSec}
            viewSpanSec={viewSpanSec}
            visibleGridLines={visibleGridLines}
            showBeatGrid={showBeatGrid}
            gridResolutionMode={gridResolutionMode}
            onChangeGridResolutionMode={setGridResolutionMode}
            editorSizeMode={editorSizeMode}
            setEditorSizeMode={setEditorSizeMode}
            selectedHitId={selectedHitId}
            setSelectedHitId={setSelectedHitId}
            autoFollowPlayhead={autoFollowPlayhead}
            onToggleAutoFollowPlayhead={handleToggleAutoFollowPlayhead}
            onManualHorizontalScroll={handleManualHorizontalScroll}
            onRequestUploadForRole={(role) => {
              uploadTargetRef.current = role;
              slotFileInputRef.current?.click();
            }}
            onRequestBrowseKit1400ForRole={(role) =>
              setKit1400ModalState({ open: true, role })
            }
          />
        )}

        {/* Playback Transport + Phase-Locked A/B Comparison + Zoom */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={!r.originalBuffer}
              onClick={r.togglePlayback}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-40 transition-all duration-150 ${
                r.isPlaying
                  ? 'bg-zinc-100 text-zinc-950 shadow-md'
                  : 'bg-[#24242A] hover:bg-[#313139] border border-white/[0.12] text-zinc-100'
              }`}
            >
              {r.isPlaying ? (
                <Pause size={13} className="fill-current" />
              ) : (
                <Play size={13} className="fill-current" />
              )}
              <span>{r.isPlaying ? 'Detener' : 'Escuchar Pista'}</span>
            </button>

            <span className="text-xs font-mono text-zinc-300 px-2.5 py-1 rounded-xl bg-[#0B0B0D] border border-white/[0.07] tabular-nums">
              {formatTime(r.currentTimeSec)} <span className="text-zinc-600">/</span>{' '}
              {formatTime(duration)}
            </span>

            {/* Real-time A/B Toggle */}
            <div className="flex items-center bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-0.5 text-xs">
              <button
                type="button"
                onClick={() => r.setAbMode('original')}
                className={`px-3 py-1 rounded-lg font-medium cursor-pointer transition-colors ${
                  r.abMode === 'original'
                    ? 'bg-[#26262E] text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                A: Stem Original
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
                <span>B: Sampleado Mejorado</span>
              </button>
            </div>

            {/* Optional Master Context Audition in Laboratory (never mixed into export) */}
            {r.masterReferenceBuffer && (
              <div className="flex items-center gap-2 bg-[#17171C] border border-white/[0.08] rounded-xl px-2.5 py-1 text-[11px]">
                <label
                  className="flex items-center gap-1.5 cursor-pointer text-amber-300/90 font-medium"
                  title="Escucha en el Laboratorio cómo empasta tu nuevo Stem de Batería o Bajo junto con el Master de referencia (el Master NO se incluye al exportar)"
                >
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
                      className="w-14 accent-amber-400 h-1 cursor-pointer"
                      title="Volumen de referencia del Master en el Laboratorio"
                    />
                    <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                      {r.masterContextVolumePct}%
                    </span>
                  </>
                )}
              </div>
            )}

            {r.soloDrumRole && (
              <button
                type="button"
                onClick={() => r.toggleSoloDrumRole(r.soloDrumRole!)}
                className="px-2.5 py-1 rounded-xl bg-amber-400/15 border border-amber-400/40 text-amber-300 text-[11px] font-medium cursor-pointer"
                title="Haz clic para desactivar SOLO y escuchar todo el kit (al exportar siempre se exporta el kit completo)"
              >
                SOLO: {r.soloDrumRole.toUpperCase()} (Clic para Todo)
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-1 text-xs font-mono">
            <button
              type="button"
onClick={() => applyHorizontalZoom(zoom / 1.5)}
              className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              title="Alejar zoom"
            >
              <ZoomOut size={13} />
            </button>
            <span className="px-1.5 text-zinc-200 font-semibold tabular-nums">{zoom.toFixed(1)}x</span>
            <button
              type="button"
onClick={() => applyHorizontalZoom(zoom * 1.5)}
              className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              title="Acercar zoom"
            >
              <ZoomIn size={13} />
            </button>
            {[2, 4, 8, 16, 32].map((presetZ) => (
              <button
                key={presetZ}
                type="button"
onClick={() => applyHorizontalZoom(presetZ)}
                className={`px-1.5 py-0.5 rounded-md text-[10px] cursor-pointer transition-colors ${
                  Math.abs(zoom - presetZ) < 0.25
                    ? 'bg-zinc-100 text-zinc-950 font-bold'
                    : 'bg-[#17171B] text-zinc-400 hover:text-white'
                }`}
                title={`Zoom rápido ${presetZ}x para editar golpes con mayor separación`}
              >
                {presetZ}x
              </button>
            ))}
            {zoom > 1.05 && (
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setScrollNorm(0);
                }}
                className="px-1.5 py-0.5 rounded-md bg-[#17171B] text-[10px] text-zinc-300 hover:text-white cursor-pointer"
                title="Restablecer zoom 1x"
              >
                1x
              </button>
            )}
          </div>
        </div>
      </div>

      {/* STEP 3 & 4: REPLACEMENT SAMPLE SLOTS + MIX & SUPABASE SAVE */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Replacement Sample Selector (Drums 5 Slots OR Guitar/Piano/Bass Slot) */}
        <div className="xl:col-span-8 rounded-2xl bg-[#121215] border border-white/[0.08] p-4 flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
            <div className="flex items-center gap-2">
              {r.stemMode === 'drums' ? (
                <Disc3 size={16} className="text-orange-400" />
              ) : (
                <Guitar size={16} className="text-zinc-300" />
              )}
              <h3 className="text-xs font-semibold tracking-tight text-zinc-100">
                {r.stemMode === 'drums'
                  ? '3. Muestras de Reemplazo por Pieza'
                  : '3. Instrumento / Muestra de Reemplazo (Conservando Notas)'}
              </h3>
            </div>

            {/* Professional Custom Sample Upload & Library Action Bar */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {r.stemMode === 'drums' && (
                <>
                  <button
                    type="button"
                    onClick={() => setKit1400ModalState({ open: true, role: 'kick', folder: 'Kicks' })}
                    className="px-3 py-1.5 rounded-xl bg-orange-500/20 hover:bg-orange-500/30 border border-orange-400/45 text-orange-200 font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="Abrir biblioteca completa de 1400 Samples Drum Kit (Kicks, Snares/Snake, Hats, Claps)"
                  >
                    <FolderOpen size={12} className="text-orange-400" />
                    <span>1400 Samples Drum Kit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void r.syncCurrentDrumKitToSupabase()}
                    disabled={r.supabaseDrumSyncStatus === 'syncing'}
                    className={`px-2.5 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                      r.supabaseDrumSyncStatus === 'synced'
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25'
                        : r.supabaseDrumSyncStatus === 'pending-offline'
                        ? 'bg-amber-500/15 border-amber-500/35 text-amber-300 hover:bg-amber-500/25'
                        : 'bg-[#17171C] border-white/[0.08] text-zinc-200 hover:border-white/[0.18]'
                    }`}
                    title="Guardar y sincronizar en Supabase los sonidos seleccionados para cada pieza"
                  >
                    {r.supabaseDrumSyncStatus === 'syncing' ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : r.supabaseDrumSyncStatus === 'synced' ? (
                      <CheckCircle2 size={12} />
                    ) : (
                      <CloudUpload size={12} />
                    )}
                    <span>
                      {r.supabaseDrumSyncStatus === 'syncing'
                        ? 'Sincronizando...'
                        : r.supabaseDrumSyncStatus === 'synced'
                        ? 'Guardado en Supabase'
                        : 'Guardar en Supabase'}
                    </span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => bankBatchFileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Sube 1 o varios audios propios (WAV, MP3, FLAC, OGG, M4A) a tu Banco y asígnalos automáticamente"
              >
                <Upload size={12} />
                <span>Subir Audios Propios</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCustomBank((v) => !v)}
                className={`px-2.5 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 cursor-pointer transition-all ${
                  showCustomBank
                    ? 'bg-[#222228] border-white/[0.2] text-white'
                    : 'bg-[#17171C] border-white/[0.08] text-zinc-300 hover:border-white/[0.16]'
                }`}
              >
                <FolderArchive size={12} />
                <span>Mi Banco ({r.customSamples.length})</span>
              </button>

              {r.songs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCloudSamplePicker((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-xl border font-medium flex items-center gap-1 cursor-pointer transition-all ${
                    showCloudSamplePicker
                      ? 'bg-[#222228] border-white/[0.2] text-white'
                      : 'bg-[#17171C] border-white/[0.08] text-zinc-300 hover:text-white'
                  }`}
                  title="Importar una muestra o stem desde tus carpetas de Supabase como audio de reemplazo"
                >
                  <FolderOpen size={12} />
                  <span>Desde Nube</span>
                </button>
              )}

              {(r.melodicSlot.sourceType !== 'preset' ||
                Object.values(r.drumSlots).some((s) => s.sourceType !== 'preset')) && (
                <button
                  type="button"
                  onClick={r.resetAllSlotsToPresets}
                  className="px-2.5 py-1.5 rounded-xl bg-[#17171C] hover:bg-[#222228] border border-white/[0.08] text-zinc-400 hover:text-white cursor-pointer"
                  title="Volver todas las piezas a muestras predeterminadas de estudio"
                >
                  Restablecer Predet.
                </button>
              )}
            </div>
          </div>

          {/* Cloud Song Stem -> Custom Sample Quick Importer */}
          {showCloudSamplePicker && (
            <div className="rounded-xl bg-[#0B0B0D] border border-white/[0.1] p-3 flex flex-col gap-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-200 font-medium">
                  Importar Audio de Reemplazo desde Tus Canciones (Supabase)
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] text-zinc-500">Asignar a:</span>
                  <select
                    value={cloudTargetRole}
                    onChange={(e) => setCloudTargetRole(e.target.value as CustomSampleCategory)}
                    className="bg-[#16161B] border border-white/[0.1] rounded-lg px-2 py-1 text-[11px] text-zinc-100"
                  >
                    <option value="kick">Kick (Bombo)</option>
                    <option value="snare">Snare / Snake (Caja)</option>
                    <option value="hat">Hi-Hat (Hit-Hat)</option>
                    <option value="crash">Crash (Platillo)</option>
                    <option value="tom">Tom / Perc</option>
                    <option value="melodic">Instrumento Melódico / Acordes</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowCloudSamplePicker(false)}
                    className="text-zinc-500 hover:text-white cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="max-h-36 overflow-y-auto studio-scrollbar-thin grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pr-1">
                {r.songs.flatMap((song) =>
                  song.stems.map((st) => (
                    <button
                      key={`${song.id}-${st.id}`}
                      type="button"
                      onClick={() => {
                        void r.importCustomSampleFromUrl(
                          st.fileUrl,
                          `${song.title} · ${st.name}`,
                          cloudTargetRole
                        );
                        setShowCloudSamplePicker(false);
                        setShowCustomBank(true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-[#141418] hover:bg-[#1E1E24] border border-white/[0.07] hover:border-white/[0.18] text-left flex items-center justify-between gap-1 cursor-pointer"
                    >
                      <span className="truncate text-[11px] text-zinc-200">
                        {song.title} · {st.name}
                      </span>
                      <Upload size={11} className="text-zinc-400 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Persistent User Custom Replacement Sample Bank */}
          {showCustomBank && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverTarget('bank');
              }}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverTarget(null);
                if (e.dataTransfer.files?.length) {
                  void r.uploadCustomReplacementFiles(
                    e.dataTransfer.files,
                    r.stemMode === 'drums' ? 'auto' : 'melodic'
                  );
                }
              }}
              className={`rounded-xl border p-3.5 flex flex-col gap-2.5 text-xs transition-all ${
                dragOverTarget === 'bank'
                  ? 'bg-white/[0.05] border-white/30'
                  : 'bg-[#0C0C0F] border-white/[0.07]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderArchive size={14} className="text-orange-400" />
                  <span className="font-semibold text-zinc-100 text-[11.5px]">
                    Banco de Tus Audios ({r.customSamples.length})
                  </span>
                  <span className="text-[10.5px] text-zinc-500 hidden sm:inline">
                    · Arrastra WAV/MP3/FLAC aquí o asígnalos directo a cualquier pieza
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => bankBatchFileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-[#1C1C22] hover:bg-[#26262E] border border-white/[0.1] text-zinc-200 text-[10.5px] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Upload size={11} />
                  <span>+ Añadir Más Audios</span>
                </button>
              </div>

              {r.customSamples.length === 0 ? (
                <div className="py-4 text-center text-xs text-zinc-500 border border-dashed border-white/[0.09] rounded-xl">
                  Aún no has subido muestras propias. Pulsa{' '}
                  <span className="text-zinc-200 font-medium">Subir Audios Propios</span> o arrastra tus WAVs aquí.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto studio-scrollbar-thin space-y-1.5 pr-1">
                  {r.customSamples.map((sample) => {
                    const badge = CATEGORY_BADGES[sample.category];
                    return (
                      <div
                        key={sample.id}
                        className="rounded-xl bg-[#141418] border border-white/[0.07] px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => r.auditionCustomSample(sample.id)}
                            className="w-7 h-7 rounded-full bg-[#24242A] hover:bg-zinc-100 text-zinc-100 hover:text-zinc-950 border border-white/[0.1] flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                            title="Escuchar muestra"
                          >
                            <Play size={10} className="fill-current ml-0.5" />
                          </button>

                          {/* Mini Peak Waveform Preview (Image 3 fine vertical bars) */}
                          <div className="hidden sm:flex items-center gap-[1.5px] h-5 w-16 shrink-0 bg-[#0B0B0D] rounded-md px-1.5 border border-white/[0.06]">
                            {(sample.waveformPreview || []).slice(0, 18).map((pk, idx) => (
                              <span
                                key={idx}
                                className="w-[1.5px] rounded-full bg-zinc-400/80"
                                style={{ height: `${Math.max(15, Math.round(pk * 100))}%` }}
                              />
                            ))}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded font-bold text-zinc-950 shrink-0"
                                style={{ backgroundColor: badge.color }}
                              >
                                {badge.label}
                              </span>
                              <span className="text-xs font-medium text-zinc-100 truncate">
                                {sample.name}
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-zinc-500">
                              {sample.durationSec.toFixed(2)}s · Pico{' '}
                              {(sample.peakOffsetSec * 1000).toFixed(1)}ms · Root{' '}
                              {sample.detectedNoteName}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1 shrink-0">
                          {r.stemMode === 'drums' ? (
                            DRUM_ROLES.map(({ role, label, color }) => {
                              const isAssigned =
                                r.drumSlots[role].sourceType !== 'preset' &&
                                r.drumSlots[role].customSampleId === sample.id;
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => r.assignCustomSampleToSlot(sample.id, role)}
                                  style={
                                    isAssigned
                                      ? { backgroundColor: color, borderColor: color, color: '#09090B' }
                                      : undefined
                                  }
                                  className={`px-1.5 py-0.5 rounded-md border text-[9.5px] font-mono font-bold cursor-pointer transition-all ${
                                    isAssigned
                                      ? ''
                                      : 'bg-[#0E0E11] border-white/[0.08] text-zinc-400 hover:border-white/25 hover:text-white'
                                  }`}
                                  title={`Usar en ${label}`}
                                >
                                  {role.toUpperCase()}
                                </button>
                              );
                            })
                          ) : (
                            <button
                              type="button"
                              onClick={() => r.assignCustomSampleToSlot(sample.id, 'melodic')}
                              className={`px-2.5 py-1 rounded-lg border text-[10.5px] font-medium cursor-pointer ${
                                r.melodicSlot.sourceType !== 'preset' &&
                                r.melodicSlot.customSampleId === sample.id
                                  ? 'bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold'
                                  : 'bg-[#1A1A20] border-white/[0.1] text-zinc-200 hover:bg-[#24242C]'
                              }`}
                            >
                              {r.melodicSlot.sourceType !== 'preset' &&
                              r.melodicSlot.customSampleId === sample.id
                                ? '✓ Activo en Pista'
                                : 'Usar en Pista'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => r.deleteCustomSample(sample.id)}
                            className="p-1.5 rounded-lg bg-[#0E0E11] border border-white/[0.07] text-zinc-500 hover:text-rose-400 hover:border-rose-500/35 cursor-pointer"
                            title="Eliminar del banco"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {r.stemMode === 'drums' ? (
            <div className="flex flex-col gap-3">
              {/* Quick Access Strip for 1400 Samples Drum Kit + Custom Upload by Piece */}
              <div className="rounded-xl bg-[#0C0C0F] border border-white/[0.07] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  <span className="text-zinc-200 font-medium">
                    {r.analysis
                      ? `Detectados en ${r.analysis.bpm} BPM:`
                      : '1400 Samples Drum Kit activo:'}
                  </span>
                  <span className="text-zinc-500">
                    Selecciona cada sonido predeterminado (Kicks, Snares/Snake, Hats, Claps) o sube el tuyo:
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {DRUM_ROLES.map(({ role, label, color }) => {
                    const count = r.analysis?.counts[role] ?? 0;
                    const hasCustom = r.drumSlots[role].sourceType !== 'preset';
                    return (
                      <button
                        key={`quick-up-${role}`}
                        type="button"
                        onClick={() => setKit1400ModalState({ open: true, role })}
                        style={{ borderColor: `${color}55` }}
                        className="px-2 py-1 rounded-lg bg-[#16161B] hover:bg-[#222229] border text-[10.5px] font-medium flex items-center gap-1 cursor-pointer transition-all"
                        title={`Elegir muestra de 1400 Samples Drum Kit para ${label} (${count} golpes)`}
                      >
                        <FolderOpen size={10} style={{ color }} />
                        <span style={{ color }}>
                          {hasCustom ? '✓ ' : '+ '}
                          {role === 'hat'
                            ? 'Hi-Hat'
                            : role === 'snare'
                            ? 'Snare / Snake'
                            : role === 'crash'
                            ? 'Crash'
                            : role === 'kick'
                            ? 'Kick'
                            : 'Tom'}
                        </span>
                        <span className="text-zinc-500 font-mono">({count})</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setKit1400ModalState({ open: true, role: 'snare', folder: 'Claps' })
                    }
                    className="px-2 py-1 rounded-lg bg-[#16161B] hover:bg-[#222229] border border-purple-400/35 text-[10.5px] font-medium text-purple-300 flex items-center gap-1 cursor-pointer transition-all"
                    title="Elegir Claps de 1400 Samples Drum Kit (50 Claps)"
                  >
                    <FolderOpen size={10} className="text-purple-400" />
                    <span>Claps (50)</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {DRUM_ROLES.map(({ role, label, color }) => {
                const slot = r.drumSlots[role];
                const presets = DRUM_PRESET_CATALOG.filter((p) => p.category === role);
                const kit1400Pack = getDrumKit1400ForRole(role, r.kit1400DynamicManifest);
                const featuredIds = new Set(kit1400Pack.featured.map((f) => f.id));
                const primaryRest = kit1400Pack.primaryEntries.filter(
                  (e) => !featuredIds.has(e.id)
                );
                const secondaryRest = (kit1400Pack.secondaryEntries ?? []).filter(
                  (e) => !featuredIds.has(e.id)
                );
                const userSamplesForRole = r.customSamples.filter(
                  (cs) => cs.sourceType !== 'kit-1400' && cs.category === role
                );
                const userSamplesOther = r.customSamples.filter(
                  (cs) => cs.sourceType !== 'kit-1400' && cs.category !== role
                );

                const hitCount = r.analysis?.counts[role] ?? 0;
                const isDragOver = dragOverTarget === role;
                const isLoadingThisRole = r.loadingKit1400Role === role;
                const isSyncedInCloud = Boolean(
                  slot.cloudUrl || (slot.kit1400Id && syncedSampleIds.has(slot.kit1400Id))
                );

                const selectVal = slot.kit1400Id
                  ? `kit1400:${slot.kit1400Id}`
                  : slot.sourceType !== 'preset' && slot.customSampleId
                  ? `custom:${slot.customSampleId}`
                  : slot.presetId;

                return (
                  <div
                    key={role}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverTarget(role);
                    }}
                    onDragLeave={() => setDragOverTarget(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverTarget(null);
                      const f = e.dataTransfer.files?.[0];
                      if (f) void r.loadCustomFileForSlot(role, f);
                    }}
                    className={`rounded-xl bg-[#0D0D10] border p-3.5 flex flex-col gap-2.5 text-xs transition-all ${
                      isDragOver
                        ? 'border-white/35 bg-white/[0.04]'
                        : slot.enabled
                        ? 'border-white/[0.08] hover:border-white/[0.14]'
                        : 'border-white/[0.04] opacity-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer font-semibold text-zinc-100 min-w-0">
                        <input
                          type="checkbox"
                          checked={slot.enabled}
                          onChange={(e) => r.updateDrumSlot(role, { enabled: e.target.checked })}
                          className="accent-zinc-100"
                        />
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate">{label}</span>
                      </label>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-mono text-zinc-500">{hitCount}</span>
                        <button
                          type="button"
                          onClick={() => r.auditionSlotSample(slot)}
                          className="px-2 py-0.5 rounded-lg bg-[#1C1C22] hover:bg-[#282830] border border-white/[0.08] text-zinc-200 text-[10px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {isLoadingThisRole ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <Volume2 size={10} />
                          )}
                          Probar
                        </button>
                      </div>
                    </div>

                    {/* Unified Selector: Predetermined 1400 Samples Drum Kit + User Uploaded + Studio Presets + Prev/Next Stepper */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isLoadingThisRole}
                        onClick={() => void r.stepDrumKit1400Sample(role, -1)}
                        className="p-1.5 rounded-lg bg-[#16161B] hover:bg-[#24242C] border border-white/[0.08] text-zinc-400 hover:text-white cursor-pointer disabled:opacity-40 shrink-0"
                        title="Sonido anterior en 1400 Samples Drum Kit"
                      >
                        <ChevronLeft size={13} />
                      </button>

                      <select
                        value={selectVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val.startsWith('kit1400:')) {
                            void r.selectDrumKit1400Sample(val.slice(8), role, {
                              audition: true,
                              saveToSupabase: true,
                            });
                          } else if (val.startsWith('custom:')) {
                            r.assignCustomSampleToSlot(val.slice(7), role);
                          } else {
                            r.updateDrumSlot(role, {
                              sourceType: 'preset',
                              presetId: val as DefaultInstrumentId,
                              kit1400Id: undefined,
                              customSampleId: undefined,
                              customBuffer: undefined,
                              customName: undefined,
                            });
                          }
                        }}
                        className="flex-1 min-w-0 bg-[#151519] border border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-zinc-100 cursor-pointer focus:outline-none focus:border-white/25"
                      >
                        {slot.kit1400Id &&
                          !kit1400Pack.featured.some((e) => e.id === slot.kit1400Id) &&
                          !primaryRest.some((e) => e.id === slot.kit1400Id) &&
                          !secondaryRest.some((e) => e.id === slot.kit1400Id) && (
                            <optgroup label="★ Muestra 1400 Drum Kit Seleccionada">
                              <option value={`kit1400:${slot.kit1400Id}`}>
                                ★ {slot.customName || slot.kit1400Id.replace(/^dk1400:/, '')}
                              </option>
                            </optgroup>
                          )}

                        <optgroup label="★ 1400 Samples Drum Kit — Destacados">
                          {kit1400Pack.featured.map((item) => (
                            <option key={item.id} value={`kit1400:${item.id}`}>
                              {item.label}
                            </option>
                          ))}
                        </optgroup>

                        {primaryRest.length > 0 && (
                          <optgroup
                            label={`📁 1400 Samples Drum Kit — ${kit1400Pack.primaryFolder} (${kit1400Pack.primaryEntries.length})`}
                          >
                            {primaryRest.map((item) => (
                              <option key={item.id} value={`kit1400:${item.id}`}>
                                {item.label}
                              </option>
                            ))}
                          </optgroup>
                        )}

                        {kit1400Pack.secondaryFolder && secondaryRest.length > 0 && (
                          <optgroup
                            label={`📁 1400 Samples Drum Kit — ${kit1400Pack.secondaryFolder} (${
                              kit1400Pack.secondaryEntries?.length ?? 0
                            })`}
                          >
                            {secondaryRest.map((item) => (
                              <option key={item.id} value={`kit1400:${item.id}`}>
                                {item.label}
                              </option>
                            ))}
                          </optgroup>
                        )}

                        {userSamplesForRole.length > 0 && (
                          <optgroup label="★ Mis Audios Propios (Esta Pieza)">
                            {userSamplesForRole.map((cs) => (
                              <option key={cs.id} value={`custom:${cs.id}`}>
                                ★ {cs.name} ({cs.durationSec.toFixed(2)}s)
                              </option>
                            ))}
                          </optgroup>
                        )}

                        {userSamplesOther.length > 0 && (
                          <optgroup label="Mis Otros Audios Subidos">
                            {userSamplesOther.map((cs) => (
                              <option key={cs.id} value={`custom:${cs.id}`}>
                                {cs.name} ({cs.durationSec.toFixed(2)}s)
                              </option>
                            ))}
                          </optgroup>
                        )}

                        <optgroup label="Estudio Sintetizados">
                          {presets.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      <button
                        type="button"
                        disabled={isLoadingThisRole}
                        onClick={() => void r.stepDrumKit1400Sample(role, 1)}
                        className="p-1.5 rounded-lg bg-[#16161B] hover:bg-[#24242C] border border-white/[0.08] text-zinc-400 hover:text-white cursor-pointer disabled:opacity-40 shrink-0"
                        title="Siguiente sonido en 1400 Samples Drum Kit"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>

                    {slot.sourceType !== 'preset' && (
                      <div className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[10px] flex items-center justify-between gap-2">
                        <span className="truncate flex items-center gap-1.5">
                          <span>
                            {slot.sourceType === 'kit-1400' ? '1400 Kit:' : 'Propio:'}{' '}
                            {slot.customName}
                          </span>
                          {isSyncedInCloud && (
                            <span title="Guardado en Supabase Cloud" className="text-emerald-300 inline-flex items-center">
                              <Cloud size={10} />
                            </span>
                          )}
                        </span>
                        <span className="text-[9.5px] font-mono text-emerald-200/75 shrink-0">
                          {((slot.customPeakOffsetSec ?? 0) * 1000).toFixed(1)}ms
                        </span>
                      </div>
                    )}

                    {renderCustomSourceControls(role, slot)}

                    <div className="grid grid-cols-2 gap-2.5 pt-1 text-[10.5px] text-zinc-500">
                      <div>
                        <div className="flex justify-between mb-0.5">
                          <span>Nivel</span>
                          <span className="text-zinc-200 font-mono">
                            {slot.gainDb > 0 ? '+' : ''}
                            {slot.gainDb}dB
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-18}
                          max={12}
                          step={0.5}
                          value={slot.gainDb}
                          onChange={(e) =>
                            r.updateDrumSlot(role, { gainDb: Number(e.target.value) })
                          }
                          className="w-full accent-zinc-200 h-1 cursor-pointer"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between mb-0.5">
                          <span>Afinación</span>
                          <span className="text-zinc-200 font-mono">
                            {slot.pitchSemis > 0 ? '+' : ''}
                            {slot.pitchSemis} st
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={slot.pitchSemis}
                          onChange={(e) =>
                            r.updateDrumSlot(role, { pitchSemis: Number(e.target.value) })
                          }
                          className="w-full accent-zinc-200 h-1 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverTarget('melodic');
              }}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverTarget(null);
                const f = e.dataTransfer.files?.[0];
                if (f) void r.loadCustomFileForSlot('melodic', f);
              }}
              className={`rounded-xl bg-[#0D0D10] border p-3.5 flex flex-col gap-3 text-xs transition-all ${
                dragOverTarget === 'melodic'
                  ? 'border-white/35 bg-white/[0.04]'
                  : 'border-white/[0.08]'
              }`}
            >
              {/* Top Custom Upload / Selection Card for Melodic & Polyphonic */}
              <div className="rounded-xl bg-[#141418] border border-white/[0.07] p-3 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Music2 size={14} className="text-zinc-300" />
                    <span className="font-medium text-zinc-100">
                      Tu Audio Propio o Timbre de Estudio (Se transpone a cada nota)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => r.auditionSlotSample(r.melodicSlot)}
                    className="px-2.5 py-1 rounded-lg bg-[#222228] hover:bg-[#2D2D35] border border-white/[0.1] text-zinc-100 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Volume2 size={12} />
                    <span>
                      {r.melodicSlot.sourceType === 'preset' &&
                      isBassPresetId(r.melodicSlot.presetId)
                        ? 'Probar (C2 Bass)'
                        : 'Probar (C4)'}
                    </span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {renderCustomSourceControls('melodic', r.melodicSlot)}

                  {r.customSamples.length > 0 && (
                    <select
                      value={
                        r.melodicSlot.sourceType !== 'preset' && r.melodicSlot.customSampleId
                          ? r.melodicSlot.customSampleId
                          : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) {
                          r.assignCustomSampleToSlot(e.target.value, 'melodic');
                        }
                      }}
                      className="bg-[#0B0B0D] border border-white/[0.1] rounded-lg px-2 py-1 text-[11px] text-zinc-100 cursor-pointer max-w-[240px]"
                    >
                      <option value="" disabled>
                        Elegir de Mis Audios ({r.customSamples.length})...
                      </option>
                      {r.customSamples.map((cs) => (
                        <option key={cs.id} value={cs.id}>
                          ★ {cs.name} (Root {cs.detectedNoteName})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {r.melodicSlot.sourceType === 'preset' ? (
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10.5px]">
                    <div className="flex flex-wrap items-center gap-1 bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-0.5">
                      {(
                        [
                          { id: 'all', label: `Todos (${MELODIC_PRESET_CATALOG.length})` },
                          { id: 'bass', label: `Bajos Synth & Sub (${BASS_PRESET_CATALOG.length})` },
                          {
                            id: 'keys-guitar',
                            label: `Piano / Guitarra / Synth (${
                              MELODIC_PRESET_CATALOG.length - BASS_PRESET_CATALOG.length
                            })`,
                          },
                        ] as const
                      ).map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setMelodicCategoryFilter(cat.id)}
                          className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-all ${
                            melodicCategoryFilter === cat.id
                              ? 'bg-zinc-100 text-zinc-950 font-semibold'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={r.toggleBassFocusMode}
                      className={`px-2.5 py-1 rounded-xl border font-medium cursor-pointer transition-all ${
                        r.bassFocusMode
                          ? 'bg-orange-500/20 border-orange-400/50 text-orange-300'
                          : 'bg-[#16161B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                      }`}
                      title="Extrae únicamente los graves (30–210 Hz) y la nota raíz de la progresión de acordes para dar peso sin tocar notas agudas"
                    >
                      {r.bassFocusMode ? '● Solo Graves / Progresión: ON' : 'Solo Graves / Progresión: OFF'}
                    </button>
                  </div>

                  {r.bassFocusMode && (
                    <div className="px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/25 text-[11px] text-orange-200/90 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong className="text-orange-300 font-semibold">Modo Solo Graves Activo:</strong>{' '}
                        Analizando los bajos y la raíz armónica de los acordes para sumar peso subgrave sin invadir medios/agudos.
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto studio-scrollbar-thin pr-1">
                    {MELODIC_PRESET_CATALOG.filter((pr) =>
                      melodicCategoryFilter === 'all' ? true : pr.group === melodicCategoryFilter
                    ).map((pr) => {
                      const active = r.melodicSlot.presetId === pr.id;
                      const isBass = pr.group === 'bass';
                      return (
                        <button
                          key={pr.id}
                          type="button"
                          onClick={() =>
                            r.updateMelodicSlot({ presetId: pr.id, sourceType: 'preset' })
                          }
                          className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                            active
                              ? 'bg-[#222229] border-white/[0.24] text-white'
                              : 'bg-[#141418] border-white/[0.06] text-zinc-300 hover:bg-[#1A1A20] hover:border-white/[0.12]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="font-semibold text-xs truncate">{pr.label}</div>
                            {pr.badge && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold shrink-0 ${
                                  isBass
                                    ? 'bg-orange-500/15 text-orange-300 border border-orange-500/25'
                                    : 'bg-white/[0.06] text-zinc-300 border border-white/[0.08]'
                                }`}
                              >
                                {pr.badge}
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-zinc-500 mt-1 leading-snug">
                            {pr.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-emerald-300">
                      Muestra Propia Activa: {r.melodicSlot.customName}
                    </div>
                    <div className="text-[10.5px] text-zinc-400">
                      Nota raíz detectada (YIN):{' '}
                      {midiNoteToName(r.melodicSlot.customRootMidi ?? 60)} — Loop sustain cruzado sin clics
                    </div>
                  </div>
                  <select
                    value={r.melodicSlot.customRootMidi ?? 60}
                    onChange={(e) =>
                      r.updateMelodicSlot({ customRootMidi: Number(e.target.value) })
                    }
                    className="bg-[#0B0B0D] border border-white/[0.1] rounded-lg px-2 py-1 text-xs font-mono text-zinc-100"
                  >
                    {Array.from({ length: 49 }, (_, idx) => 36 + idx).map((m) => (
                      <option key={m} value={m}>
                        Root {midiNoteToName(m)} (MIDI {m})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-[10.5px] text-zinc-500">
                <div>
                  <div className="flex justify-between mb-0.5">
                    <span>Nivel Muestra</span>
                    <span className="text-zinc-200 font-mono">{r.melodicSlot.gainDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min={-18}
                    max={12}
                    step={0.5}
                    value={r.melodicSlot.gainDb}
                    onChange={(e) =>
                      r.updateMelodicSlot({ gainDb: Number(e.target.value) })
                    }
                    className="w-full accent-zinc-200 h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-0.5">
                    <span>Octava / Tono</span>
                    <span className="text-zinc-200 font-mono">
                      {r.melodicSlot.pitchSemis > 0 ? '+' : ''}
                      {r.melodicSlot.pitchSemis} st
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={r.melodicSlot.pitchSemis}
                    onChange={(e) =>
                      r.updateMelodicSlot({ pitchSemis: Number(e.target.value) })
                    }
                    className="w-full accent-zinc-200 h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-0.5">
                    <span>Sustain Notas</span>
                    <span className="text-zinc-200 font-mono">{r.mixOptions.sustainScale.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={1.8}
                    step={0.1}
                    value={r.mixOptions.sustainScale}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, sustainScale: Number(e.target.value) }))
                    }
                    className="w-full accent-zinc-200 h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-0.5">
                    <span>Brillo Timbre</span>
                    <span className="text-zinc-200 font-mono">{r.mixOptions.brightnessPct}%</span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={5}
                    value={r.mixOptions.brightnessPct}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, brightnessPct: Number(e.target.value) }))
                    }
                    className="w-full accent-zinc-200 h-1 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Live Preview of Detected Notes/Chords */}
          {r.analysis && r.analysis.noteEvents.length > 0 && (
            <div className="rounded-xl bg-[#0B0B0D] border border-white/[0.07] p-2.5 max-h-24 overflow-y-auto studio-scrollbar-thin flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
              <span className="text-zinc-500 mr-1">
                Primeras notas detectadas
                {r.analysis.bassFocusApplied ? ' (Solo Graves / Progresión)' : ''}:
              </span>
              {r.analysis.noteEvents.slice(0, 64).map((ev) => (
                <span
                  key={ev.id}
                  onClick={() => r.seekToSec(ev.startSec)}
                  className="px-1.5 py-0.5 rounded-md bg-[#16161B] border border-white/[0.08] text-zinc-200 cursor-pointer hover:border-white/25"
                  title={`${ev.startSec.toFixed(2)}s · duración ${ev.durationSec.toFixed(2)}s`}
                >
                  {ev.noteName} ({ev.startSec.toFixed(1)}s)
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Blend, Export & Save Directly Back to Song Folder */}
        <div className="xl:col-span-4 rounded-2xl bg-[#121215] border border-white/[0.08] p-4 flex flex-col justify-between gap-3.5 text-xs">
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3">
              <Sliders size={15} className="text-emerald-400" />
              <h3 className="font-semibold tracking-tight text-zinc-100">
                4. Mezcla & Exportar
              </h3>
            </div>

            <div>
              <div className="flex justify-between text-[11.5px] text-zinc-400 mb-1">
                <span>Muestra Reemplazada</span>
                <span className="text-zinc-100 font-mono font-semibold">{r.mixOptions.replacementPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={130}
                step={5}
                value={r.mixOptions.replacementPct}
                onChange={(e) =>
                  r.setMixOptions((p) => ({ ...p, replacementPct: Number(e.target.value) }))
                }
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11.5px] text-zinc-400 mb-1">
                <span>Stem Original (Blend)</span>
                <span className="text-zinc-100 font-mono font-semibold">{r.mixOptions.originalPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={r.mixOptions.originalPct}
                onChange={(e) =>
                  r.setMixOptions((p) => ({ ...p, originalPct: Number(e.target.value) }))
                }
                className="w-full accent-orange-400 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            {(r.stemMode === 'monophonic' || r.bassFocusMode) && (
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <div className="text-[10.5px] text-zinc-500">
                  {r.stemMode === 'polyphonic'
                    ? 'Peso Sub-Bass sobre la Canción:'
                    : 'Modos rápidos de Bajo / Empalme:'}
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('replace')}
                    className={`px-2 py-1.5 rounded-xl border font-medium cursor-pointer transition-all ${
                      r.mixOptions.originalPct === 0 && r.mixOptions.replacementPct === 100
                        ? 'bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold'
                        : 'bg-[#0C0C0F] border-white/[0.08] text-zinc-300 hover:border-white/[0.16]'
                    }`}
                  >
                    100% Synth
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('layer-sub')}
                    className={`px-2 py-1.5 rounded-xl border font-medium cursor-pointer transition-all ${
                      r.mixOptions.originalPct >= 80 && r.mixOptions.replacementPct >= 50
                        ? 'bg-orange-500/20 border-orange-400/50 text-orange-300'
                        : 'bg-[#0C0C0F] border-white/[0.08] text-zinc-300 hover:border-white/[0.16]'
                    }`}
                    title="Empalma Monark/Sub-Bass debajo de un bajo acústico o eléctrico"
                  >
                    Empalmar Sub
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('hybrid')}
                    className={`px-2 py-1.5 rounded-xl border font-medium cursor-pointer transition-all ${
                      r.mixOptions.originalPct > 0 && r.mixOptions.originalPct < 80
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-[#0C0C0F] border-white/[0.08] text-zinc-300 hover:border-white/[0.16]'
                    }`}
                  >
                    Híbrido 70/55
                  </button>
                </div>
                <label
                  className="flex items-center gap-2 cursor-pointer pt-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                  title="Filtra el sub-grave sucio (<185 Hz) del stem original cuando el nuevo bajo está sonando, conservando el ataque real de cuerdas/dedos (>185 Hz) del bajo original sin barro"
                >
                  <input
                    type="checkbox"
                    checked={r.mixOptions.bassCrossoverCleanLow !== false}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({
                        ...p,
                        bassCrossoverCleanLow: e.target.checked,
                      }))
                    }
                    className="accent-zinc-100"
                  />
                  <span>Crossover Bajo: Limpiar sub-grave sucio (&lt;185 Hz)</span>
                </label>
              </div>
            )}

            {r.stemMode === 'drums' && (
              <div className="space-y-2 pt-2 border-t border-white/[0.06] text-[11px] text-zinc-400">
                <div className="text-[10.5px] text-zinc-500">Modo sobre Stem o Canción:</div>
                <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('replace')}
                    className={`px-2 py-1.5 rounded-xl border font-medium cursor-pointer transition-all ${
                      r.mixOptions.originalPct === 0 && r.mixOptions.replacementPct === 100
                        ? 'bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold'
                        : 'bg-[#0C0C0F] border-white/[0.08] text-zinc-300 hover:border-white/[0.16]'
                    }`}
                  >
                    100% Batería
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('layer-drums')}
                    className={`px-2 py-1.5 rounded-xl border font-medium cursor-pointer transition-all ${
                      r.mixOptions.originalPct >= 80 && r.mixOptions.replacementPct >= 65
                        ? 'bg-orange-500/20 border-orange-400/50 text-orange-300'
                        : 'bg-[#0C0C0F] border-white/[0.08] text-zinc-300 hover:border-white/[0.16]'
                    }`}
                    title="Agrega la nueva batería orgánica encima de tu canción completa respetando el tempo"
                  >
                    Sumar a Canción
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('hybrid')}
                    className={`px-2 py-1.5 rounded-xl border font-medium cursor-pointer transition-all ${
                      r.mixOptions.originalPct > 0 && r.mixOptions.originalPct < 80
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-[#0C0C0F] border-white/[0.08] text-zinc-300 hover:border-white/[0.16]'
                    }`}
                  >
                    Híbrido 70/55
                  </button>
                </div>
                <label className="flex items-center gap-2 cursor-pointer pt-1 hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={r.mixOptions.roundRobinHumanize}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, roundRobinHumanize: e.target.checked }))
                    }
                    className="accent-zinc-100"
                  />
                  <span>Variación orgánica Round-Robin</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={r.mixOptions.duckOriginalTransients}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, duckOriginalTransients: e.target.checked }))
                    }
                    className="accent-orange-400"
                  />
                  <span>Limpiar transiente original al mezclar</span>
                </label>
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-3 border-t border-white/[0.06]">
            <div>
              <label className="text-[10.5px] text-zinc-500 block mb-1">
                Nombre del Stem mejorado (misma duración exacta):
              </label>
              <input
                type="text"
                value={saveStemName}
                onChange={(e) => setSaveStemName(e.target.value)}
                placeholder="Batería (Sampled Pro)"
                className="w-full bg-[#0B0B0D] border border-white/[0.08] rounded-xl px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
              />
            </div>

            {saveFeedback && (
              <div className="px-3 py-2 rounded-xl bg-emerald-500/12 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="shrink-0" />
                <span>{saveFeedback}</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={(!r.replacedBuffer && !r.originalBuffer) || r.isRendering || r.isExportingPc}
                onClick={() => void r.downloadReplacedAudio('wav', saveStemName)}
                className="py-2 px-2 rounded-xl bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-zinc-100 font-medium flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 text-[11px] transition-colors"
                title="Exportar al PC en WAV 24-Bit sin compresión (48 kHz)"
              >
                {r.isExportingPc ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                <span>WAV 24</span>
              </button>

              <button
                type="button"
                disabled={(!r.replacedBuffer && !r.originalBuffer) || r.isRendering || r.isExportingPc}
                onClick={() => void r.downloadReplacedAudio('mp3', saveStemName)}
                className="py-2 px-2 rounded-xl bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-zinc-100 font-medium flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 text-[11px] transition-colors"
                title="Exportar al PC en MP3 320 kbps"
              >
                {r.isExportingPc ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                <span>MP3 320k</span>
              </button>

              <button
                type="button"
                disabled={!r.analysis}
                onClick={() => r.exportCurrentMidiFile(saveStemName || r.stemTitle)}
                className="py-2 px-2 rounded-xl bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-zinc-100 font-medium flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 text-[11px] transition-colors"
                title="Exportar archivo MIDI estándar (.mid) con todos los golpes/notas detectados"
              >
                <Download size={12} />
                <span>MIDI</span>
              </button>
            </div>

            {onSendTo16Pads && (r.replacedBuffer || r.originalBuffer) && (
              <button
                type="button"
                onClick={() =>
                  onSendTo16Pads(
                    r.replacedBuffer ?? r.originalBuffer!,
                    saveStemName || r.stemTitle || 'Sample_PC',
                    r.importedMemory
                  )
                }
                className="w-full py-2 px-3 rounded-xl bg-[#18181D] hover:bg-[#222229] border border-white/[0.08] text-zinc-300 hover:text-white font-medium text-[11px] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                title="Enviar este audio a Creador 16 Pads para cortar por transientes/rejilla y exportar ZIP o slices"
              >
                <Wand2 size={12} className="text-orange-400" />
                <span>Cortar / Samplear en 16 Pads →</span>
              </button>
            )}

            <button
              type="button"
              disabled={!r.replacedBuffer || !r.selectedSong || r.isSavingCloud}
              onClick={() => {
                setSaveFeedback(null);
                void r
                  .saveReplacedStemToSong(saveStemName)
                  .then(() =>
                    setSaveFeedback(`¡Guardado en "${r.selectedSong?.title}" listo para usar!`)
                  )
                  .catch((err) =>
                    r.setStatusMessage(
                      err instanceof Error ? err.message : 'Error guardando en Supabase.'
                    )
                  );
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
            >
              {r.isSavingCloud ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CloudUpload size={14} />
              )}
              <span>
                {r.isSavingCloud
                  ? 'Subiendo WAV 24-Bit a Supabase...'
                  : `Guardar en Canción${r.selectedSong ? `: ${r.selectedSong.title.slice(0, 18)}` : ''}`}
              </span>
            </button>

            <p className="text-[10.5px] text-zinc-500 leading-snug">
              Duración bloqueada al sample original (<span className="font-mono text-zinc-400">{duration.toFixed(2)}s</span>) para encajar cuadrado con los demás stems del tema.
            </p>
          </div>
        </div>
      </div>
      <DrumKit1400BrowserModal
        isOpen={kit1400ModalState.open}
        onClose={() => setKit1400ModalState((prev) => ({ ...prev, open: false }))}
        mode="replacer"
        initialRole={kit1400ModalState.role}
        initialFolder={kit1400ModalState.folder}
        activeKit1400ByRole={activeKit1400ByRole}
        dynamicManifest={r.kit1400DynamicManifest}
        syncedSampleIds={syncedSampleIds}
        supabaseSyncStatus={r.supabaseDrumSyncStatus}
        onAuditionSample={r.auditionDrumKit1400Sample}
        onSelectForRole={(entryId, role) =>
          r.selectDrumKit1400Sample(entryId, role, {
            audition: true,
            saveToSupabase: true,
          })
        }
        onSyncToSupabase={r.syncCurrentDrumKitToSupabase}
      />
    </div>
  );
};
