import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
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
  Minimize2,
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
import { MidiTimelineWorkstation } from './MidiTimelineWorkstation';
import {
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
  { role: 'kick', label: 'Kick (Bombo)', shortLabel: 'KICK', gmNotes: 'GM 36', color: '#FF6B00' },
  { role: 'snare', label: 'Snare / Snake (Caja)', shortLabel: 'SNARE', gmNotes: 'GM 38/37', color: '#00E5FF' },
  { role: 'tom', label: 'Toms (High / Mid / Floor)', shortLabel: 'TOMS', gmNotes: 'GM 50/47/43', color: '#10B981' },
  { role: 'hat', label: 'Hi-Hats (Cerrado / Abierto)', shortLabel: 'HI-HAT', gmNotes: 'GM 42/46', color: '#F59E0B' },
  { role: 'crash', label: 'Crash / Ride (Platillos)', shortLabel: 'CRASH', gmNotes: 'GM 49/51', color: '#EC4899' },
];

const MODE_LABELS: Array<{ id: StemAnalysisMode; label: string; hint: string }> = [
  { id: 'drums', label: 'Batería (Golpes + MIDI)', hint: 'Kick · Snare/Snake · Toms · Hi-Hat · Crash/Ride' },
  { id: 'monophonic', label: 'Melódico Mono', hint: 'Bajo · Lead · 1 nota a la vez' },
  { id: 'polyphonic', label: 'Polifónico (Acordes)', hint: 'Guitarra · Piano · Keys+' },
];

const CATEGORY_BADGES: Record<CustomSampleCategory, { label: string; color: string }> = {
  kick: { label: 'KICK', color: '#FF6B00' },
  snare: { label: 'SNARE', color: '#00E5FF' },
  hat: { label: 'HI-HAT', color: '#F59E0B' },
  crash: { label: 'CRASH', color: '#EC4899' },
  tom: { label: 'TOMS', color: '#10B981' },
  melodic: { label: 'TONAL', color: '#A855F7' },
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
  const [melodicCategoryFilter, setMelodicCategoryFilter] = useState<'all' | 'bass' | 'keys-guitar'>('all');
  const [dragOverTarget, setDragOverTarget] = useState<DrumPieceRole | 'melodic' | 'bank' | 'stem-local' | 'master-ref' | null>(null);
  const [showBeatGrid, setShowBeatGrid] = useState(true);
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

  useEffect(() => {
    if (r.customSamples.length > 0) {
      setShowCustomBank(true);
    }
  }, [r.customSamples.length]);

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

  // Compute visible bar & beat grid markers for synchronized rendering inside the 5-lane Drum Editor
  const visibleGridLines = useMemo(() => {
    if (!showBeatGrid || duration <= 0) return [];
    const mem = r.importedMemory;
    const bpm = mem?.bpm ?? r.analysis?.bpm ?? 120;
    const gridBeats =
      mem?.beatTimes && mem.beatTimes.length >= 2
        ? mem.beatTimes
        : (() => {
            const step = 60 / Math.max(40, bpm || 120);
            const off = mem?.beatOffsetSec ?? r.analysis?.beatOffsetSec ?? 0;
            const arr: number[] = [];
            let t = off;
            while (t <= duration + step) {
              arr.push(t);
              t += step;
            }
            return arr;
          })();
    const dbs = mem?.downbeats ?? r.analysis?.downbeats;
    const downSet = new Set((dbs ?? []).map((d) => Math.round(d * 20)));
    const lines: Array<{
      sec: number;
      leftPct: number;
      isDownbeat: boolean;
      barNum?: number;
      beatInBar: number;
    }> = [];
    for (let idx = 0; idx < gridBeats.length; idx++) {
      const bt = gridBeats[idx];
      if (bt < viewStartSec - 0.005 || bt > viewEndSec + 0.005) continue;
      const leftPct = ((bt - viewStartSec) / Math.max(0.01, viewSpanSec)) * 100;
      const isDownbeat = dbs ? downSet.has(Math.round(bt * 20)) : idx % 4 === 0;
      const barNum = isDownbeat
        ? dbs
          ? Math.max(1, dbs.findIndex((d) => Math.abs(d - bt) < 0.06) + 1)
          : Math.floor(idx / 4) + 1
        : undefined;
      lines.push({
        sec: bt,
        leftPct,
        isDownbeat,
        barNum,
        beatInBar: (idx % 4) + 1,
      });
    }
    return lines;
  }, [
    showBeatGrid,
    duration,
    r.importedMemory,
    r.analysis?.bpm,
    r.analysis?.beatOffsetSec,
    r.analysis?.downbeats,
    viewStartSec,
    viewEndSec,
    viewSpanSec,
  ]);

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

    ctx.fillStyle = '#040711';
    ctx.fillRect(0, 0, w, h);

    const midY = h / 2;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (!r.originalBuffer || duration <= 0) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        '1. Elige una Canción arriba → 2. Selecciona 1 Stem (ej. Batería, Piano, Guitarra, Bajo)',
        w / 2,
        midY + 4
      );
      ctx.textAlign = 'left';
      return;
    }

    const secToX = (sec: number) => ((sec - viewStartSec) / viewSpanSec) * w;

    // 1. Draw waveform from pyramid
    const sr = r.originalBuffer.sampleRate;
    const s0 = Math.max(0, Math.floor(viewStartSec * sr));
    const s1 = Math.min(r.originalBuffer.length, Math.ceil(viewEndSec * sr));
    const visibleSamples = Math.max(1, s1 - s0);
    const samplesPerPx = visibleSamples / w;

    ctx.fillStyle =
      r.abMode === 'replaced' ? 'rgba(0, 229, 255, 0.35)' : 'rgba(148, 163, 184, 0.45)';
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

    // 1B. Overlay Stem Studio Beat Grid (`beatTimes` + `downbeats`) & Chord Progression Guide
    if (showBeatGrid && (r.importedMemory?.beatTimes?.length || (r.importedMemory?.bpm ?? 0) > 0)) {
      const mem = r.importedMemory!;
      const gridBeats =
        mem.beatTimes && mem.beatTimes.length >= 2
          ? mem.beatTimes
          : (() => {
              const step = 60 / Math.max(40, mem.bpm || 120);
              const off = mem.beatOffsetSec ?? 0;
              const arr: number[] = [];
              let t = off;
              while (t <= duration + step) {
                arr.push(t);
                t += step;
              }
              return arr;
            })();
      const dbs = mem.downbeats;
      const downSet = new Set((dbs ?? []).map((d) => Math.round(d * 20)));
      let lastBarLabelX = -999;

      for (let idx = 0; idx < gridBeats.length; idx++) {
        const bt = gridBeats[idx];
        if (bt < viewStartSec - 0.01 || bt > viewEndSec + 0.01) continue;
        const x = secToX(bt);
        const isDownbeat = dbs ? downSet.has(Math.round(bt * 20)) : idx % 4 === 0;
        ctx.strokeStyle = isDownbeat
          ? 'rgba(0, 229, 255, 0.44)'
          : 'rgba(0, 229, 255, 0.14)';
        ctx.lineWidth = isDownbeat ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();

        if (isDownbeat && x - lastBarLabelX >= 28 && x >= 2 && x < w - 22) {
          const barNum = dbs
            ? Math.max(1, dbs.findIndex((d) => Math.abs(d - bt) < 0.06) + 1)
            : Math.floor(idx / 4) + 1;
          ctx.fillStyle = 'rgba(0, 229, 255, 0.88)';
          ctx.font = 'bold 9px monospace';
          ctx.fillText(`C${barNum}`, x + 3, 11);
          lastBarLabelX = x;
        }
      }
      ctx.lineWidth = 1;

      if (mem.chords?.length) {
        let lastChordX = -999;
        for (const ch of mem.chords) {
          const cx0 = secToX(ch.startSec);
          const cx1 = secToX(ch.endSec);
          if (cx1 < 0 || cx0 > w) continue;
          if (cx0 >= 0 && cx0 <= w) {
            ctx.strokeStyle = 'rgba(167, 139, 250, 0.5)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(cx0, 0);
            ctx.lineTo(cx0, h);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (cx0 - lastChordX >= 30 && cx1 - cx0 >= 18 && cx0 >= -4 && cx0 < w - 24) {
            const boxW = Math.min(48, Math.max(20, ch.chord.length * 7 + 8));
            ctx.fillStyle = 'rgba(109, 40, 217, 0.85)';
            ctx.fillRect(Math.max(2, cx0 + 2), 14, boxW, 13);
            ctx.fillStyle = '#EDE9FE';
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
          kick: '#FF6B00',
          snare: '#00E5FF',
          hat: '#F59E0B',
          crash: '#EC4899',
          tom: '#10B981',
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

    // 3. Playhead
    if (r.currentTimeSec >= viewStartSec && r.currentTimeSec <= viewEndSec) {
      const px = secToX(r.currentTimeSec);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(px - 1, 0, 2, h);
    }
  }, [
    r.originalBuffer,
    r.waveformPyramid,
    r.importedMemory,
    r.analysis,
    r.currentTimeSec,
    r.abMode,
    showBeatGrid,
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
    const ro = new ResizeObserver(() => {
      setCanvasResizeTick((t) => (t + 1) & 0xffff);
    });
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
      const clampedZoom = Math.max(1, Math.min(48, nextZoomRaw));
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
        <button
          type="button"
          onClick={() => {
            uploadTargetRef.current = target;
            slotFileInputRef.current?.click();
          }}
          className="px-2.5 py-1 rounded-lg bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 border border-[#00E5FF]/55 text-[10px] font-mono font-bold text-[#00E5FF] flex items-center gap-1 cursor-pointer transition-all"
          title="Subir tu propio audio de reemplazo (WAV, MP3, FLAC, OGG, M4A)"
        >
          <Upload size={11} />
          <span>Subir Audio</span>
        </button>

        <button
          type="button"
          onClick={() => void r.toggleMicRecordingForSlot(target)}
          className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-all ${
            isRec
              ? 'bg-rose-500 border-rose-400 text-white animate-pulse'
              : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-rose-300'
          }`}
          title="Grabar muestra directamente desde tu micrófono o interfaz"
        >
          {isRec ? <Square size={10} className="fill-current" /> : <Mic size={11} />}
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
            className="bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-[10px] font-mono text-amber-300 cursor-pointer"
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
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[9.5px] font-mono text-emerald-300 cursor-pointer"
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
                    customSampleId: undefined,
                    customBuffer: undefined,
                    customName: undefined,
                  });
                } else {
                  r.updateDrumSlot(target, {
                    sourceType: 'preset',
                    customSampleId: undefined,
                    customBuffer: undefined,
                    customName: undefined,
                  });
                }
              }}
              className="px-1.5 py-1 rounded bg-slate-800 text-[10px] font-mono text-slate-400 hover:text-white cursor-pointer"
              title="Volver a muestra predeterminada de estudio"
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Song Folder Selector */}
        <div className="lg:col-span-5 rounded-2xl bg-slate-900/95 border border-slate-800/90 p-3.5 flex flex-col gap-2.5 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderOpen size={15} className="text-[#FF6B00]" />
              <span className="text-xs font-mono font-bold uppercase text-white">
                1. Elige Canción (Carpeta)
              </span>
            </div>
            <button
              type="button"
              onClick={() => void r.refreshSongs()}
              className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
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
            className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-[#00E5FF]"
          />

          <div className="max-h-40 overflow-y-auto studio-scrollbar-thin space-y-1 pr-1">
            {filteredSongs.length === 0 ? (
              <div className="text-[11px] font-mono text-slate-500 py-4 text-center">
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
                    className={`w-full px-2.5 py-1.5 rounded-xl border text-left font-mono text-xs flex items-center justify-between cursor-pointer transition-all ${
                      active
                        ? 'bg-[#FF6B00]/15 border-[#FF6B00] text-white font-bold'
                        : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="truncate">{song.title}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                      {song.bpm ? `${song.bpm}bpm · ` : ''}
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
          className={`lg:col-span-7 rounded-2xl border p-3.5 flex flex-col justify-between gap-2.5 shadow-lg transition-all ${
            dragOverTarget === 'stem-local'
              ? 'bg-[#00E5FF]/10 border-[#00E5FF] shadow-[0_0_24px_rgba(0,229,255,0.22)]'
              : 'bg-slate-900/95 border-slate-800/90'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers size={15} className="text-[#00E5FF]" />
              <span className="text-xs font-mono font-bold uppercase text-white">
                2. Selecciona 1 Stem a Samplear{' '}
                {r.selectedSong ? `(${r.selectedSong.title})` : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => stemFileInputRef.current?.click()}
                className="px-2.5 py-1 rounded-lg bg-[#00E5FF] hover:bg-cyan-300 text-slate-950 text-[11px] font-mono font-bold flex items-center gap-1 cursor-pointer"
                title="Sube un archivo WAV, MP3, FLAC, OGG o M4A directo desde tu PC para samplear y exportar"
              >
                <Upload size={12} />
                <span>Subir Archivo del PC</span>
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('drums')}
                className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-[#FF6B00] cursor-pointer"
              >
                Demo Batería
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('monophonic')}
                className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-emerald-400 cursor-pointer"
              >
                Demo Bajo
              </button>
              <button
                type="button"
                onClick={() => void r.loadDemoStem('polyphonic')}
                className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-[#00E5FF] cursor-pointer"
              >
                Demo Piano/Guitarra
              </button>
            </div>
          </div>

          {r.originalBuffer && !r.selectedStemId && (
            <div className="rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/45 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="min-w-0">
                <div className="font-bold text-white truncate">
                  Archivo Local PC: {r.stemTitle || 'Audio cargado'}
                </div>
                <div className="text-[10px] text-[#00E5FF]">
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
                    className="px-2.5 py-1 rounded-lg bg-[#FF6B00] hover:brightness-110 text-slate-950 text-[10.5px] font-black cursor-pointer"
                    title="Abrir este audio en el Creador 16 Pads para cortar slices, aplicar efectos y exportar"
                  >
                    Cortar en 16 Pads →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => stemFileInputRef.current?.click()}
                  className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[10.5px] text-slate-200 hover:text-white cursor-pointer"
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
                    className={`p-2.5 rounded-xl border text-left font-mono transition-all cursor-pointer flex flex-col justify-between gap-1 disabled:opacity-50 ${
                      isSelected
                        ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-white shadow-[0_0_16px_rgba(0,229,255,0.2)]'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold truncate">{st.name}</span>
                      {st.isMaster && (
                        <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">
                          MASTER
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
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
            <div className="rounded-xl bg-slate-950/70 border border-dashed border-slate-800 p-4 text-center text-xs font-mono text-slate-400">
              {r.isLoadingStem ? (
                <span className="inline-flex items-center gap-2 text-[#00E5FF]">
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
        className={`rounded-2xl border p-3.5 flex flex-col gap-2.5 shadow-lg transition-all font-mono text-xs ${
          dragOverTarget === 'master-ref'
            ? 'bg-amber-500/15 border-amber-400 shadow-[0_0_24px_rgba(245,158,11,0.25)]'
            : r.masterReferenceBuffer
            ? 'bg-gradient-to-r from-slate-900/95 via-amber-950/20 to-slate-900/95 border-amber-500/50'
            : 'bg-slate-900/95 border-slate-800/90'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-300 font-black text-[10.5px]">
              ★ AUDIO MASTER GUÍA
            </span>
            <span className="font-bold text-white text-xs">
              Ayuda de Detección 100% Precisa (Kick, Snare/Snake, Hi-Hat, Crash, Bajo y Acordes)
            </span>
            {r.masterReferenceBuffer && (
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold">
                ● GUÍA MASTER ACTIVA
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={r.isLoadingMasterRef}
              onClick={() => masterRefFileInputRef.current?.click()}
              className="px-2.5 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-all"
              title="Sube el audio Master (canción completa) desde tu PC para que el sistema identifique al 100% Batería, Bajo y Acordes y trabaje luego sobre tu archivo Solo Drums o Solo Bass"
            >
              {r.isLoadingMasterRef ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Upload size={12} />
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
                  className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-amber-500/20 border border-amber-500/50 text-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  title="Vincular la pista ★ Master guardada en esta canción como Guía de Detección"
                >
                  <Sparkles size={11} />
                  <span>Usar ★ Master de la Canción</span>
                </button>
              )}

            <label
              className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-slate-950 border border-slate-800 text-[10.5px] text-slate-300 cursor-pointer"
              title="Al elegir un stem (Drums o Bass) de una canción que tiene pista Master, vincula automáticamente el Master como guía de detección"
            >
              <input
                type="checkbox"
                checked={r.autoUseSongMaster}
                onChange={(e) => r.setAutoUseSongMaster(e.target.checked)}
                className="accent-amber-400"
              />
              <span>Auto-vincular Master de canción</span>
            </label>

            {r.masterReferenceBuffer && (
              <button
                type="button"
                onClick={() => void r.clearMasterReference()}
                className="px-2 py-1 rounded-xl bg-slate-950 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/50 text-slate-400 hover:text-rose-300 text-[10.5px] cursor-pointer"
                title="Quitar el Audio Master Guía y detectar únicamente desde el stem cargado"
              >
                Quitar Guía
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[11px]">
          {r.masterReferenceBuffer ? (
            <div className="flex flex-wrap items-center gap-2 text-slate-200">
              <span className="text-amber-300 font-bold">
                Guía cargada: {r.masterReferenceTitle}
              </span>
              <span className="text-slate-400">
                ({formatTime(r.masterReferenceBuffer.duration)} ·{' '}
                {r.masterReferenceMemory?.bpm ?? r.analysis?.bpm ?? 120} BPM · Tono{' '}
                {r.masterReferenceMemory?.musicalKey || 'Detectado'} ·{' '}
                {r.masterReferenceMemory?.chords.length ?? 0} acordes extraídos del Master)
              </span>
              <span className="text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                ✓ El sistema detecta en el Master y reemplaza/exporta SOLO sobre tu Stem ({r.stemTitle || 'Drums / Bass'})
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">
              💡 <strong className="text-amber-300">¿Tu stem de Batería o Bajo salió sucio o perdió golpes por separación IA?</strong> Agrega aquí el <strong className="text-white">Audio Master</strong>: el sistema identificará al 100% Kick, Snare/Snake, Hi-Hat, Crash, Bajo y Acordes desde el Master y trabajará luego sobre tu archivo de Solo Drums o Solo Bass.
            </span>
          )}

          {r.masterReferenceBuffer && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10.5px] text-slate-400">Modo Guía:</span>
              <select
                value={r.detectionSourceMode}
                onChange={(e) =>
                  void r.changeDetectionSourceMode(e.target.value as DetectionSourceMode)
                }
                className="bg-slate-950 border border-amber-500/50 rounded-lg px-2 py-1 text-[11px] text-amber-300 font-bold cursor-pointer"
                title="Elige cómo el Audio Master guía la detección sobre tu Stem de Batería o Bajo"
              >
                <option value="auto-hybrid">
                  Fusión Master + Stem (Recomendado · Rescata ataques y filtra voz)
                </option>
                <option value="master-only">
                  100% desde Master (Rescate total si el Stem está muy roto)
                </option>
                <option value="stem-only">Solo Stem Actual (Ignorar Master)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* STATUS & PROGRESS BANNER */}
      {(r.statusMessage || r.isAnalyzing || r.isLoadingStem || r.isTranscribingAi) && (
        <div className="rounded-xl bg-slate-900/90 border border-[#00E5FF]/35 px-3 py-2 text-xs font-mono text-[#00E5FF] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {(r.isAnalyzing || r.isLoadingStem || r.isRendering || r.isTranscribingAi) && (
              <Loader2 size={14} className="animate-spin shrink-0" />
            )}
            <span>
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
              className="text-slate-500 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* STORED PRE-IMPORT TEMPO & CHORDS MEMORY STRIP */}
      {r.importedMemory && (
        <div className="rounded-xl bg-slate-950/95 border border-violet-500/40 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-violet-300 font-bold mr-1">
              Tempo & Memoria:{' '}
            </span>
            <div className="inline-flex items-center gap-1 bg-slate-900 border border-[#00E5FF]/50 rounded-lg px-1.5 py-0.5">
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
                className="w-14 bg-transparent text-[#00E5FF] font-bold text-center focus:outline-none"
                title="BPM del stem (editable manualmente)"
              />
              <span className="text-[10px] text-[#00E5FF] font-bold">BPM</span>
            </div>
            <button
              type="button"
              onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm - 1)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
              title="Restar 1 BPM"
            >
              -1
            </button>
            <button
              type="button"
              onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm + 1)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
              title="Sumar 1 BPM"
            >
              +1
            </button>
            <button
              type="button"
              onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm * 0.5)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
              title="Mitad del tempo (÷2)"
            >
              ÷2
            </button>
            <button
              type="button"
              onClick={() => void r.updateImportedTempo(r.importedMemory!.bpm * 2)}
              className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 cursor-pointer"
              title="Doble tempo (×2)"
            >
              ×2
            </button>
            <button
              type="button"
              onClick={handleTapTempo}
              className="px-2 py-0.5 rounded bg-[#FF6B00]/15 hover:bg-[#FF6B00]/30 border border-[#FF6B00]/50 text-[#FF6B00] text-[10px] font-bold cursor-pointer"
              title="Pulsa 3 o más veces al ritmo de la batería para fijar el tempo"
            >
              Tap BPM
            </button>
            <button
              type="button"
              disabled={!r.originalBuffer || r.isAnalyzing}
              onClick={() => void r.reDetectTempoFromDrums()}
              className="px-2 py-0.5 rounded bg-[#00E5FF]/15 hover:bg-[#00E5FF]/30 border border-[#00E5FF]/50 text-[#00E5FF] text-[10px] font-bold cursor-pointer disabled:opacity-40"
              title="Aísla los golpes de Bombo y Caja eliminando suciedad/sangrado para recalcular el BPM exacto"
            >
              Re-Detectar Tempo Batería
            </button>{' '}
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-emerald-500/45 text-emerald-300 font-bold">
              Tono:{' '}
              {!r.importedMemory.isTonal ||
              r.importedMemory.musicalKey.endsWith('m') ||
              r.importedMemory.musicalKey.toLowerCase().includes('major')
                ? r.importedMemory.musicalKey
                : `${r.importedMemory.musicalKey} major`}
            </span>{' '}
            {r.importedMemory.camelotKey && (
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-amber-500/45 text-amber-300 font-bold">
                Camelot: {r.importedMemory.camelotKey}
              </span>
            )}{' '}
            {(r.importedMemory.downbeats?.length ?? 0) > 0 && (
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-cyan-500/35 text-cyan-200 font-bold">
                Grilla: {r.importedMemory.downbeats!.length} comp.
              </span>
            )}{' '}
            {r.importedMemory.chords.length > 0 ? (
              <>
                <span className="text-slate-400 ml-1">Acordes: </span>
                {r.importedMemory.chords.slice(0, 16).map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => r.seekToSec(ch.startSec)}
                    className="px-2 py-0.5 rounded bg-violet-500/15 hover:bg-violet-500/35 border border-violet-500/50 text-violet-200 font-bold cursor-pointer transition-colors"
                    title={`Ir a ${ch.chord} (${ch.startSec.toFixed(2)}s–${ch.endSec.toFixed(2)}s · Sub ${ch.rootName})`}
                  >
                    {ch.chord}
                  </button>
                ))}
              </>
            ) : (
              <span className="text-slate-400">· {r.importedMemory.chordProgressionSummary}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[10.5px]">
            <span className="text-slate-400">Cuantizar al Tempo:</span>
            <select
              value={r.quantizeMode}
              onChange={(e) =>
                void r.changeQuantizeModeAndReanalyze(
                  e.target.value as 'off' | 'soft' | 'grid-16' | 'grid-8'
                )
              }
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-[#00E5FF] font-bold cursor-pointer"
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
      <div
        className={
          editorSizeMode === 'fullscreen'
            ? 'fixed inset-0 z-50 bg-[#030611]/98 backdrop-blur-xl p-3 md:p-4 overflow-y-auto studio-scrollbar flex flex-col gap-2.5'
            : 'rounded-2xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.65)] flex flex-col gap-3.5 transition-[padding,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]'
        }
      >
        {editorSizeMode === 'fullscreen' && (
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800/90">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FF6B00] to-[#00E5FF] flex items-center justify-center text-slate-950 font-black">
                <Disc3 size={17} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm md:text-base font-mono font-black tracking-tight text-white">
                    WORKSTATION DE EDICIÓN DE BATERÍA & PARTES MIDI
                  </h2>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono font-bold">
                    MODO ESTUDIO PANTALLA COMPLETA
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-400">
                  {r.stemTitle || 'Pista activa'} · Edita cada Kick, Snare, Tom (High/Mid/Floor), Hi-Hat y Crash con precisión sub-milisegundo · Pulsa ESC para volver
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditorSizeMode('large')}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-[#00E5FF]/60 text-[#00E5FF] text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-[transform,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-95"
            >
              <Minimize2 size={13} />
              <span>Salir de Pantalla Completa (ESC)</span>
            </button>
          </div>
        )}

        {/* REPLICATE AI NEURAL AUDIO-TO-MIDI & BEAT BAR */}
        <div className="shrink-0 rounded-xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-[#00E5FF]/45 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2.5 text-[11px] font-mono shadow-md">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!r.originalBuffer || r.isTranscribingAi || r.isLoadingStem}
              onClick={() => void r.runReplicateAiMidiTranscription()}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] hover:brightness-110 text-slate-950 font-black flex items-center gap-1.5 cursor-pointer shadow-[0_0_18px_rgba(0,229,255,0.28)] disabled:opacity-40 transition-[transform,filter] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-95"
              title="Ejecuta Google Magenta MT3 (Audio → General MIDI Canal 10) + Harmonix All-In-One Beat AI en GPU NVIDIA A100 de Replicate y fusiona con picos acústicos 48kHz"
            >
              {r.isTranscribingAi ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              <span>
                {r.isTranscribingAi
                  ? 'Procesando MIDI con IA Replicate...'
                  : '✨ IA Replicate: Reconocer Batería → MIDI + Tempo (MT3)'}
              </span>
            </button>

            {r.stemMode === 'drums' && (
              <label
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-700 text-[10.5px] text-slate-200 cursor-pointer hover:border-[#00E5FF]/50"
                title="Si subiste una canción completa o mezcla muy sucia, Demucs v4 aísla la batería primero en Replicate antes de convertir cada golpe a MIDI con MT3"
              >
                <input
                  type="checkbox"
                  checked={r.isolateDrumsWithDemucs}
                  onChange={(e) => r.setIsolateDrumsWithDemucs(e.target.checked)}
                  className="accent-[#00E5FF]"
                />
                <span>Aislar Batería 1° (Demucs IA)</span>
              </label>
            )}

            {r.analysis?.analysisEngine && (
              <span
                className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold ${
                  r.analysis.analysisEngine === 'replicate-mt3'
                    ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                    : r.analysis.analysisEngine === 'midi-import'
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                    : 'bg-slate-950 border-slate-700 text-slate-300'
                }`}
              >
                {r.analysis.analysisEngine === 'replicate-mt3'
                  ? '✓ Motor: IA Replicate MT3 MIDI + Acústico 48kHz'
                  : r.analysis.analysisEngine === 'midi-import'
                  ? '✓ Motor: Archivo MIDI (.mid) Sincronizado'
                  : '⚡ Motor: DSP Polifónico 6-Bandas → MIDI'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={!r.analysis}
              onClick={() => r.exportCurrentMidiFile(saveStemName || r.stemTitle)}
              className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"
              title="Descargar archivo MIDI estándar (.mid) con Kick (36), Snare (38), Toms (43/47/50), Hi-Hat (42/46) y Crash (49)"
            >
              <Download size={12} />
              <span>Exportar MIDI (.mid)</span>
            </button>

            <button
              type="button"
              onClick={() => midiFileInputRef.current?.click()}
              className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-slate-800 border border-amber-500/50 text-amber-300 font-bold flex items-center gap-1 cursor-pointer"
              title="Importar un archivo .mid desde tu PC para disparar tus muestras propias de reemplazo"
            >
              <Upload size={12} />
              <span>Importar MIDI (.mid)</span>
            </button>

            <button
              type="button"
              onClick={() => setShowReplicateTokenBar((v) => !v)}
              className="px-2 py-1 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white cursor-pointer text-[10px]"
              title="Configurar o verificar tu API Token de Replicate (r8_...)"
            >
              {r.replicateApiKey || import.meta.env.VITE_REPLICATE_API_TOKEN
                ? '🔑 Replicate: Conectado'
                : '🔑 Configurar Replicate'}
            </button>
          </div>
        </div>

        {showReplicateTokenBar && (
          <div className="shrink-0 rounded-xl bg-slate-950 border border-[#00E5FF]/40 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <span className="text-slate-300">
              Token Replicate API (<code className="text-[#00E5FF]">r8_...</code> · o configurado en{' '}
              <code className="text-emerald-300">.env</code>):
            </span>
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <input
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder={
                  import.meta.env.VITE_REPLICATE_API_TOKEN
                    ? 'Usando VITE_REPLICATE_API_TOKEN de .env (opcional sobreescribir)...'
                    : 'Pega tu token r8_...'
                }
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:border-[#00E5FF] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  r.saveReplicateApiKey(tokenDraft);
                  setShowReplicateTokenBar(false);
                }}
                className="px-2.5 py-1 rounded-lg bg-[#00E5FF] text-slate-950 font-bold cursor-pointer"
              >
                Guardar
              </button>
            </div>
          </div>
        )}

        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {MODE_LABELS.map((m) => {
              const active = r.stemMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void r.changeStemModeAndReanalyze(m.id)}
                  className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-mono font-bold cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    active
                      ? 'bg-[#FF6B00] border-[#FF6B00] text-slate-950'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                  }`}
                  title={m.hint}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            {/* Workspace Size Selector (Compacta / Grande XL / Pantalla Completa DAW) */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-0.5">
              <span className="px-2 text-[10px] text-slate-400 hidden sm:inline">Ambiente:</span>
              {(
                [
                  { id: 'compact', label: 'Compacto' },
                  { id: 'large', label: 'Grande XL' },
                  { id: 'fullscreen', label: 'Pantalla Completa' },
                ] as const
              ).map((sz) => {
                const active = editorSizeMode === sz.id;
                return (
                  <button
                    key={sz.id}
                    type="button"
                    onClick={() => setEditorSizeMode(sz.id)}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold flex items-center gap-1 cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      active
                        ? 'bg-[#00E5FF] text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:text-white'
                    }`}
                    title={`Cambiar tamaño del ambiente de edición a ${sz.label}`}
                  >
                    {sz.id === 'fullscreen' && <Maximize2 size={10} />}
                    <span>{sz.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1">
              <span className="text-slate-400">Sensibilidad:</span>
              <input
                type="range"
                min={0.2}
                max={0.95}
                step={0.05}
                value={r.sensitivity}
                onChange={(e) => r.setSensitivity(Number(e.target.value))}
                className="w-16 accent-[#FF6B00] h-1 cursor-pointer"
              />
              <span className="text-[#FF6B00] tabular-nums">{Math.round(r.sensitivity * 100)}%</span>
            </div>

            {r.stemMode === 'polyphonic' && (
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1">
                <span className="text-slate-400">Polifonía máx:</span>
                <select
                  value={r.maxPolyphony}
                  onChange={(e) => r.setMaxPolyphony(Number(e.target.value))}
                  className="bg-transparent text-white font-bold focus:outline-none"
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n} className="bg-slate-950">
                      {n} notas
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowMidiRoll((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                showMidiRoll
                  ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
              title="Mostrar/ocultar Editor MIDI con Scroll Avanzado Horizontal y Vertical (Batería 5/9 Pistas o Piano Roll Melódico)"
            >
              Editor MIDI {showMidiRoll ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={() => setShowBeatGrid((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                showBeatGrid
                  ? 'bg-[#00E5FF]/15 border-[#00E5FF]/60 text-[#00E5FF]'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
              title="Mostrar/ocultar grilla musical de compases, pulsos y acordes sobre la forma de onda y pistas MIDI"
            >
              Grilla {showBeatGrid ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              disabled={!r.originalBuffer || r.isAnalyzing}
              onClick={() => void r.reanalyzeCurrentStem()}
              className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-[#00E5FF]/50 text-[#00E5FF] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <Activity size={12} />
              <span>Re-Analizar</span>
            </button>
          </div>
        </div>

        {/* Interactive Waveform & Detected Hits/Notes Overlay + Dedicated Horizontal Scrollbar */}
        <div className="shrink-0 w-full rounded-xl overflow-hidden border border-slate-800 bg-[#040711] flex flex-col">
          <div
            className={`relative w-full transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              editorSizeMode === 'fullscreen'
                ? 'h-36 md:h-44'
                : editorSizeMode === 'large'
                ? 'h-52'
                : 'h-40'
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
              <div className="absolute top-2.5 right-2.5 flex flex-wrap gap-1.5 pointer-events-none text-[10.5px] font-mono tabular-nums">
                <span className="px-2 py-0.5 rounded-md bg-slate-950/92 border border-slate-700 text-white font-bold shadow">
                  {r.analysis.bpm} BPM · {r.analysis.durationSec.toFixed(2)}s
                </span>
                {r.analysis.mode === 'drums' ? (
                  <>
                    <span className="px-2 py-0.5 rounded-md bg-slate-950/92 border border-[#FF6B00]/60 text-[#FF6B00] font-bold">
                      KICK: {r.analysis.counts.kick}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-950/92 border border-[#00E5FF]/60 text-[#00E5FF] font-bold">
                      SNARE: {r.analysis.counts.snare}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-950/92 border border-emerald-500/60 text-emerald-400 font-bold">
                      TOMS: {r.analysis.counts.tom}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-950/92 border border-amber-500/60 text-amber-400 font-bold">
                      HI-HAT: {r.analysis.counts.hat}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-950/92 border border-pink-500/60 text-pink-400 font-bold">
                      CRASH: {r.analysis.counts.crash}
                    </span>
                  </>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-slate-950/92 border border-emerald-500/50 text-emerald-300 font-bold">
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

        {/* LARGE MIDI WORKSTATION WITH ADVANCED HORIZONTAL & VERTICAL SCROLL + MINIMAP (DRUMS 5/9-GM & MELODIC PIANO ROLL) */}
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
          />
        )}

        {/* Playback Transport + Phase-Locked A/B Comparison + Zoom */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!r.originalBuffer}
              onClick={r.togglePlayback}
              className={`px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-all duration-200 ${
                r.isPlaying
                  ? 'bg-[#FF6B00] text-slate-950'
                  : 'bg-slate-950 hover:bg-slate-800 border border-[#FF6B00]/60 text-[#FF6B00]'
              }`}
            >
              {r.isPlaying ? (
                <Pause size={13} className="fill-current" />
              ) : (
                <Play size={13} className="fill-current" />
              )}
              <span>{r.isPlaying ? 'Detener' : 'Escuchar Pista'}</span>
            </button>

            <span className="text-xs font-mono text-slate-300 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 tabular-nums">
              {formatTime(r.currentTimeSec)} / {formatTime(duration)}
            </span>

            {/* Real-time A/B Toggle */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-0.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => r.setAbMode('original')}
                className={`px-3 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                  r.abMode === 'original'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                A: Stem Original
              </button>
              <button
                type="button"
                onClick={() => r.setAbMode('replaced')}
                className={`px-3 py-1 rounded-lg font-bold cursor-pointer transition-colors flex items-center gap-1 ${
                  r.abMode === 'replaced'
                    ? 'bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles size={11} />
                <span>B: Sampleado Mejorado</span>
              </button>
            </div>

            {/* Optional Master Context Audition in Laboratory (never mixed into export) */}
            {r.masterReferenceBuffer && (
              <div className="flex items-center gap-1.5 bg-slate-950 border border-amber-500/40 rounded-xl px-2.5 py-1 text-[11px] font-mono">
                <label
                  className="flex items-center gap-1.5 cursor-pointer text-amber-300 font-bold"
                  title="Escucha en el Laboratorio cómo empasta tu nuevo Stem de Batería o Bajo junto con el Master de referencia (el Master NO se incluye al exportar)"
                >
                  <input
                    type="checkbox"
                    checked={r.listenWithMasterContext}
                    onChange={(e) => r.setListenWithMasterContext(e.target.checked)}
                    className="accent-amber-400"
                  />
                  <span>🎧 Probar con Master</span>
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
                    <span className="text-[10px] text-amber-200 tabular-nums">
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
                className="px-2.5 py-1 rounded-xl bg-amber-500/20 border border-amber-500 text-amber-300 text-[10.5px] font-mono font-bold cursor-pointer"
                title="Haz clic para desactivar SOLO y escuchar todo el kit (al exportar siempre se exporta el kit completo)"
              >
                SOLO ACTIVO: {r.soloDrumRole.toUpperCase()} (Clic para Todo)
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs font-mono">
            <button
              type="button"
              onClick={() => applyHorizontalZoom(zoom / 1.5)}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
              title="Alejar zoom"
            >
              <ZoomOut size={13} />
            </button>
            <span className="px-1.5 text-[#00E5FF] font-bold tabular-nums">{zoom.toFixed(1)}x</span>
            <button
              type="button"
              onClick={() => applyHorizontalZoom(zoom * 1.5)}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
              title="Acercar zoom"
            >
              <ZoomIn size={13} />
            </button>
            {[2, 4, 8, 16].map((presetZ) => (
              <button
                key={presetZ}
                type="button"
                onClick={() => applyHorizontalZoom(presetZ)}
                className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                  Math.abs(zoom - presetZ) < 0.25
                    ? 'bg-[#00E5FF] text-slate-950 font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-white'
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
                className="px-1.5 py-0.5 rounded bg-slate-900 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                title="Restablecer zoom 1x"
              >
                1x
              </button>
            )}
          </div>
        </div>
      </div>

      {/* STEP 3 & 4: REPLACEMENT SAMPLE SLOTS + MIX & SUPABASE SAVE */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
        {/* Replacement Sample Selector (Drums 4 Slots OR Guitar/Piano/Bass Slot) */}
        <div className="xl:col-span-8 rounded-2xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-lg flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              {r.stemMode === 'drums' ? (
                <Disc3 size={16} className="text-[#FF6B00]" />
              ) : (
                <Guitar size={16} className="text-[#00E5FF]" />
              )}
              <h3 className="text-xs font-mono font-bold uppercase text-white">
                {r.stemMode === 'drums'
                  ? '3. Elige o Sube Tus Muestras de Reemplazo por Pieza'
                  : '3. Elige o Sube Tu Propio Instrumento / Muestra para Reemplazar Conservando Notas'}
              </h3>
            </div>

            {/* Professional Custom Sample Upload & Library Action Bar */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-mono">
              <button
                type="button"
                onClick={() => bankBatchFileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#00E5FF] to-emerald-400 hover:brightness-110 text-slate-950 font-black flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Sube 1 o varios audios propios (WAV, MP3, FLAC, OGG, M4A) a tu Banco y asígnalos automáticamente"
              >
                <Upload size={12} />
                <span>Subir Audios Propios</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCustomBank((v) => !v)}
                className={`px-2.5 py-1.5 rounded-xl border font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                  showCustomBank
                    ? 'bg-[#FF6B00]/15 border-[#FF6B00] text-[#FF6B00]'
                    : 'bg-slate-950 border-slate-700 text-slate-200 hover:border-[#00E5FF]/50'
                }`}
              >
                <FolderArchive size={12} />
                <span>Mi Banco ({r.customSamples.length})</span>
              </button>

              {r.songs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCloudSamplePicker((v) => !v)}
                  className={`px-2.5 py-1.5 rounded-xl border font-bold flex items-center gap-1 cursor-pointer transition-all ${
                    showCloudSamplePicker
                      ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-[#00E5FF]'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'
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
                  className="px-2 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white cursor-pointer"
                  title="Volver todas las piezas a muestras predeterminadas de estudio"
                >
                  Restablecer Predet.
                </button>
              )}
            </div>
          </div>

          {/* Cloud Song Stem -> Custom Sample Quick Importer */}
          {showCloudSamplePicker && (
            <div className="rounded-xl bg-slate-950 border border-[#00E5FF]/40 p-3 flex flex-col gap-2 text-xs font-mono">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#00E5FF] font-bold">
                  Importar Audio de Reemplazo desde Tus Canciones (Supabase)
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Asignar a:</span>
                  <select
                    value={cloudTargetRole}
                    onChange={(e) => setCloudTargetRole(e.target.value as CustomSampleCategory)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white"
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
                    className="text-slate-400 hover:text-white cursor-pointer"
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
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-[#00E5FF] text-left flex items-center justify-between gap-1 cursor-pointer"
                    >
                      <span className="truncate text-[10.5px] text-slate-200">
                        {song.title} · {st.name}
                      </span>
                      <Upload size={11} className="text-[#00E5FF] shrink-0" />
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
              className={`rounded-xl border p-3 flex flex-col gap-2.5 text-xs font-mono transition-all ${
                dragOverTarget === 'bank'
                  ? 'bg-[#00E5FF]/10 border-[#00E5FF]'
                  : 'bg-slate-950/90 border-slate-800'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderArchive size={14} className="text-[#FF6B00]" />
                  <span className="font-bold text-white text-[11px]">
                    BANCO DE TUS AUDIOS DE REEMPLAZO ({r.customSamples.length})
                  </span>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">
                    · Arrastra archivos WAV/MP3/FLAC aquí o asígnalos directo a cualquier pieza
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => bankBatchFileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-[#00E5FF]/50 text-[#00E5FF] text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Upload size={11} />
                  <span>+ Añadir Más Audios</span>
                </button>
              </div>

              {r.customSamples.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-slate-400 border border-dashed border-slate-800 rounded-lg">
                  Aún no has subido muestras propias. Pulsa{' '}
                  <span className="text-[#00E5FF] font-bold">Subir Audios Propios</span> o arrastra tus WAVs aquí.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto studio-scrollbar-thin space-y-1.5 pr-1">
                  {r.customSamples.map((sample) => {
                    const badge = CATEGORY_BADGES[sample.category];
                    return (
                      <div
                        key={sample.id}
                        className="rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => r.auditionCustomSample(sample.id)}
                            className="p-1.5 rounded-lg bg-slate-950 hover:bg-[#00E5FF] text-[#00E5FF] hover:text-slate-950 border border-slate-700 cursor-pointer shrink-0 transition-colors"
                            title="Escuchar muestra"
                          >
                            <Play size={10} className="fill-current" />
                          </button>

                          {/* Mini Peak Waveform Preview */}
                          <div className="hidden sm:flex items-center gap-[1.5px] h-5 w-16 shrink-0 bg-slate-950 rounded px-1 border border-slate-800/80">
                            {(sample.waveformPreview || []).slice(0, 18).map((pk, idx) => (
                              <span
                                key={idx}
                                className="w-[2px] rounded-full bg-[#00E5FF]/80"
                                style={{ height: `${Math.max(15, Math.round(pk * 100))}%` }}
                              />
                            ))}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-[9px] px-1.5 py-0.2 rounded font-bold text-slate-950 shrink-0"
                                style={{ backgroundColor: badge.color }}
                              >
                                {badge.label}
                              </span>
                              <span className="text-[11px] font-bold text-white truncate">
                                {sample.name}
                              </span>
                            </div>
                            <div className="text-[9.5px] text-slate-400">
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
                                      ? { backgroundColor: color, borderColor: color, color: '#020617' }
                                      : undefined
                                  }
                                  className={`px-1.5 py-0.5 rounded border text-[9.5px] font-bold cursor-pointer transition-all ${
                                    isAssigned
                                      ? ''
                                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-[#00E5FF] hover:text-white'
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
                              className={`px-2 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                                r.melodicSlot.sourceType !== 'preset' &&
                                r.melodicSlot.customSampleId === sample.id
                                  ? 'bg-[#00E5FF] border-[#00E5FF] text-slate-950'
                                  : 'bg-slate-950 border-slate-700 text-[#00E5FF] hover:bg-[#00E5FF]/15'
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
                            className="p-1 rounded bg-slate-950 border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-500/40 cursor-pointer"
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
              {/* Quick Clean Audio Upload Strip for Detected Drum Pieces in Tempo */}
              <div className="rounded-xl bg-slate-950/95 border border-[#00E5FF]/35 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  <span className="text-white font-bold">
                    {r.analysis
                      ? `Detectados en ${r.analysis.bpm} BPM:`
                      : 'Sube tu Audio Limpio para cada golpe:'}
                  </span>
                  <span className="text-slate-400">
                    Sube un audio limpio por pieza (Kick, Snare, Hi-Hat, Crash) para reemplazar cada golpe con realismo:
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
                        onClick={() => {
                          uploadTargetRef.current = role;
                          slotFileInputRef.current?.click();
                        }}
                        style={{ borderColor: `${color}88` }}
                        className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                        title={`Subir audio limpio para reemplazar los ${count} golpes de ${label}`}
                      >
                        <Upload size={10} style={{ color }} />
                        <span style={{ color }}>
                          {hasCustom ? '✓ ' : '+ '}
                          {role === 'hat' ? 'Hi-Hat' : role === 'snare' ? 'Snare' : role === 'crash' ? 'Crash' : role === 'kick' ? 'Kick' : 'Tom'}
                        </span>
                        <span className="text-slate-400">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {DRUM_ROLES.map(({ role, label, color }) => {
                const slot = r.drumSlots[role];
                const presets = DRUM_PRESET_CATALOG.filter((p) => p.category === role);
                const hitCount = r.analysis?.counts[role] ?? 0;
                const isDragOver = dragOverTarget === role;
                const selectVal =
                  slot.sourceType !== 'preset' && slot.customSampleId
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
                    className={`rounded-xl bg-slate-950/90 border p-3 flex flex-col gap-2.5 text-xs font-mono transition-all ${
                      isDragOver
                        ? 'border-[#00E5FF] bg-[#00E5FF]/10 shadow-[0_0_20px_rgba(0,229,255,0.22)]'
                        : slot.enabled
                        ? 'border-slate-700'
                        : 'border-slate-800/60 opacity-55'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer font-bold text-white">
                        <input
                          type="checkbox"
                          checked={slot.enabled}
                          onChange={(e) => r.updateDrumSlot(role, { enabled: e.target.checked })}
                          className="accent-[#FF6B00]"
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span>{label}</span>
                      </label>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">{hitCount} hits</span>
                        <button
                          type="button"
                          onClick={() => r.auditionSlotSample(slot)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[#00E5FF] text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <Volume2 size={10} />
                          Probar
                        </button>
                      </div>
                    </div>

                    {/* Unified selector: User's Uploaded Custom Samples + Studio Presets */}
                    <select
                      value={selectVal}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.startsWith('custom:')) {
                          r.assignCustomSampleToSlot(val.slice(7), role);
                        } else {
                          r.updateDrumSlot(role, {
                            sourceType: 'preset',
                            presetId: val as DefaultInstrumentId,
                            customSampleId: undefined,
                            customBuffer: undefined,
                            customName: undefined,
                          });
                        }
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white cursor-pointer"
                    >
                      {r.customSamples.length > 0 && (
                        <optgroup label="★ Mis Audios Propios Subidos">
                          {r.customSamples.map((cs) => (
                            <option key={cs.id} value={`custom:${cs.id}`}>
                              ★ {cs.name} ({cs.durationSec.toFixed(2)}s)
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Estudio Predeterminados">
                        {presets.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>

                    {slot.sourceType !== 'preset' && (
                      <div className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] flex items-center justify-between gap-2">
                        <span className="truncate">
                          Audio Propio: {slot.customName}
                        </span>
                        <span className="text-[9.5px] text-emerald-200/80 shrink-0">
                          Pico {((slot.customPeakOffsetSec ?? 0) * 1000).toFixed(1)}ms
                        </span>
                      </div>
                    )}

                    {renderCustomSourceControls(role, slot)}

                    <div className="grid grid-cols-2 gap-2 pt-1 text-[10px] text-slate-400">
                      <div>
                        <div className="flex justify-between">
                          <span>Nivel</span>
                          <span className="text-white">
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
                          className="w-full accent-[#FF6B00] h-1 cursor-pointer"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span>Afinación</span>
                          <span className="text-white">
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
                          className="w-full accent-[#00E5FF] h-1 cursor-pointer"
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
              className={`rounded-xl bg-slate-950/90 border p-3.5 flex flex-col gap-3 text-xs font-mono transition-all ${
                dragOverTarget === 'melodic'
                  ? 'border-[#00E5FF] bg-[#00E5FF]/10'
                  : 'border-slate-800'
              }`}
            >
              {/* Top Custom Upload / Selection Card for Melodic & Polyphonic */}
              <div className="rounded-xl bg-slate-900/90 border border-slate-700/80 p-3 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Music2 size={14} className="text-[#00E5FF]" />
                    <span className="font-bold text-white">
                      Tu Audio Propio o Timbre de Estudio (Se transpone a cada nota)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => r.auditionSlotSample(r.melodicSlot)}
                    className="px-2.5 py-1 rounded-lg bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Volume2 size={12} />
                    <span>
                      {r.melodicSlot.sourceType === 'preset' &&
                      isBassPresetId(r.melodicSlot.presetId)
                        ? 'Probar Muestra (C2 Bass)'
                        : 'Probar Muestra (C4)'}
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
                      className="bg-slate-950 border border-[#00E5FF]/40 rounded-lg px-2 py-1 text-[11px] text-white cursor-pointer max-w-[240px]"
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
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                    <div className="flex flex-wrap items-center gap-1.5">
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
                          className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all ${
                            melodicCategoryFilter === cat.id
                              ? 'bg-[#00E5FF] border-[#00E5FF] text-slate-950'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={r.toggleBassFocusMode}
                      className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-all ${
                        r.bassFocusMode
                          ? 'bg-[#FF6B00] border-[#FF6B00] text-slate-950 shadow-[0_0_12px_rgba(255,107,0,0.3)]'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-[#FF6B00]/50'
                      }`}
                      title="Extrae únicamente los graves (30–210 Hz) y la nota raíz de la progresión de acordes para dar peso sin tocar notas agudas"
                    >
                      {r.bassFocusMode ? '● Solo Graves / Progresión: ON' : 'Solo Graves / Progresión: OFF'}
                    </button>
                  </div>

                  {r.bassFocusMode && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-[#FF6B00]/10 border border-[#FF6B00]/40 text-[10px] text-amber-200 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong className="text-[#FF6B00]">Modo Solo Graves Activo:</strong>{' '}
                        Analizando los bajos y la raíz armónica de los acordes de tu audio para sumar peso subgrave sin invadir medios/agudos.
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
                              ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-white shadow-[0_0_14px_rgba(0,229,255,0.18)]'
                              : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="font-bold text-xs truncate">{pr.label}</div>
                            {pr.badge && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 ${
                                  isBass
                                    ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/40'
                                    : 'bg-slate-800 text-[#00E5FF] border border-slate-700'
                                }`}
                              >
                                {pr.badge}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                            {pr.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/40 p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-emerald-300">
                      Muestra Propia Activa: {r.melodicSlot.customName}
                    </div>
                    <div className="text-[10px] text-slate-300">
                      Nota raíz detectada (YIN):{' '}
                      {midiNoteToName(r.melodicSlot.customRootMidi ?? 60)} — Loop sustain cruzado sin clics:
                    </div>
                  </div>
                  <select
                    value={r.melodicSlot.customRootMidi ?? 60}
                    onChange={(e) =>
                      r.updateMelodicSlot({ customRootMidi: Number(e.target.value) })
                    }
                    className="bg-slate-900 border border-emerald-500/50 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    {Array.from({ length: 49 }, (_, idx) => 36 + idx).map((m) => (
                      <option key={m} value={m}>
                        Root {midiNoteToName(m)} (MIDI {m})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-[10.5px] text-slate-400">
                <div>
                  <div className="flex justify-between">
                    <span>Nivel Muestra</span>
                    <span className="text-white">{r.melodicSlot.gainDb} dB</span>
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
                    className="w-full accent-[#00E5FF] h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between">
                    <span>Octava / Tono</span>
                    <span className="text-[#FF6B00]">
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
                    className="w-full accent-[#FF6B00] h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between">
                    <span>Sustain Notas</span>
                    <span className="text-emerald-400">{r.mixOptions.sustainScale.toFixed(1)}x</span>
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
                    className="w-full accent-emerald-400 h-1 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between">
                    <span>Brillo Timbre</span>
                    <span className="text-white">{r.mixOptions.brightnessPct}%</span>
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
                    className="w-full accent-[#00E5FF] h-1 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Live Preview of Detected Notes/Chords */}
          {r.analysis && r.analysis.noteEvents.length > 0 && (
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 max-h-24 overflow-y-auto studio-scrollbar-thin flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
              <span className="text-slate-500 mr-1">
                Primeras notas detectadas
                {r.analysis.bassFocusApplied ? ' (Solo Graves / Progresión)' : ''}:
              </span>
              {r.analysis.noteEvents.slice(0, 64).map((ev) => (
                <span
                  key={ev.id}
                  onClick={() => r.seekToSec(ev.startSec)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[#00E5FF] cursor-pointer hover:border-[#FF6B00]"
                  title={`${ev.startSec.toFixed(2)}s · duración ${ev.durationSec.toFixed(2)}s`}
                >
                  {ev.noteName} ({ev.startSec.toFixed(1)}s)
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Blend, Export & Save Directly Back to Song Folder */}
        <div className="xl:col-span-4 rounded-2xl bg-slate-900/95 border border-slate-800/90 p-4 shadow-lg flex flex-col justify-between gap-3 text-xs font-mono">
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Sliders size={15} className="text-emerald-400" />
              <h3 className="font-bold uppercase text-white">
                4. Mezcla & Guardar en Canción
              </h3>
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-300">
                <span>Muestra Reemplazada</span>
                <span className="text-[#00E5FF] font-bold">{r.mixOptions.replacementPct}%</span>
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
                className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-300">
                <span>Stem Original (Blend)</span>
                <span className="text-[#FF6B00] font-bold">{r.mixOptions.originalPct}%</span>
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
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            {(r.stemMode === 'monophonic' || r.bassFocusMode) && (
              <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                <div className="text-[10px] text-slate-400">
                  {r.stemMode === 'polyphonic'
                    ? 'Peso Sub-Bass sobre la Canción:'
                    : 'Modos rápidos de Bajo / Empalme:'}
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('replace')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct === 0 && r.mixOptions.replacementPct === 100
                        ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-[#00E5FF]'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    100% Synth
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('layer-sub')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct >= 80 && r.mixOptions.replacementPct >= 50
                        ? 'bg-[#FF6B00]/20 border-[#FF6B00] text-[#FF6B00]'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-[#FF6B00]/50'
                    }`}
                    title="Empalma Monark/Sub-Bass debajo de un bajo acústico o eléctrico"
                  >
                    Empalmar Sub
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('hybrid')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct > 0 && r.mixOptions.originalPct < 80
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    Híbrido 70/55
                  </button>
                </div>
                <label
                  className="flex items-center gap-2 cursor-pointer pt-1 text-[10.5px] text-slate-300"
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
                    className="accent-[#00E5FF]"
                  />
                  <span>Crossover Bajo: Limpiar sub-grave sucio (&lt;185 Hz) al mezclar</span>
                </label>
              </div>
            )}

            {r.stemMode === 'drums' && (
              <div className="space-y-2 pt-1.5 border-t border-slate-800/80 text-[11px] text-slate-300">
                <div className="text-[10px] text-slate-400">Modo sobre Stem o Canción completa:</div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('replace')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct === 0 && r.mixOptions.replacementPct === 100
                        ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-[#00E5FF]'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    100% Batería
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('layer-drums')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct >= 80 && r.mixOptions.replacementPct >= 65
                        ? 'bg-[#FF6B00]/20 border-[#FF6B00] text-[#FF6B00]'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-[#FF6B00]/50'
                    }`}
                    title="Agrega la nueva batería orgánica encima de tu canción completa respetando el tempo"
                  >
                    Sumar a Canción
                  </button>
                  <button
                    type="button"
                    onClick={() => r.applyMixPreset('hybrid')}
                    className={`px-2 py-1.5 rounded-lg border font-bold cursor-pointer transition-all ${
                      r.mixOptions.originalPct > 0 && r.mixOptions.originalPct < 80
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    Híbrido 70/55
                  </button>
                </div>
                <label className="flex items-center gap-2 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={r.mixOptions.roundRobinHumanize}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, roundRobinHumanize: e.target.checked }))
                    }
                    className="accent-[#00E5FF]"
                  />
                  <span>Variación orgánica Round-Robin</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.mixOptions.duckOriginalTransients}
                    onChange={(e) =>
                      r.setMixOptions((p) => ({ ...p, duckOriginalTransients: e.target.checked }))
                    }
                    className="accent-[#FF6B00]"
                  />
                  <span>Limpiar transiente original al mezclar</span>
                </label>
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-800">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">
                Nombre del Stem mejorado (misma duración exacta):
              </label>
              <input
                type="text"
                value={saveStemName}
                onChange={(e) => setSaveStemName(e.target.value)}
                placeholder="Batería (Sampled Pro)"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-[#00E5FF] focus:outline-none"
              />
            </div>

            {saveFeedback && (
              <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-[10.5px] text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="shrink-0" />
                <span>{saveFeedback}</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={(!r.replacedBuffer && !r.originalBuffer) || r.isRendering || r.isExportingPc}
                onClick={() => void r.downloadReplacedAudio('wav', saveStemName)}
                className="py-2 px-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-[#00E5FF]/50 text-[#00E5FF] font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 text-[11px]"
                title="Exportar al PC en WAV 24-Bit sin compresión (48 kHz)"
              >
                {r.isExportingPc ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                <span>WAV 24-Bit</span>
              </button>

              <button
                type="button"
                disabled={(!r.replacedBuffer && !r.originalBuffer) || r.isRendering || r.isExportingPc}
                onClick={() => void r.downloadReplacedAudio('mp3', saveStemName)}
                className="py-2 px-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-[#FF6B00]/50 text-[#FF6B00] font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 text-[11px]"
                title="Exportar al PC en MP3 320 kbps"
              >
                {r.isExportingPc ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                <span>MP3 320k</span>
              </button>

              <button
                type="button"
                disabled={!r.analysis}
                onClick={() => r.exportCurrentMidiFile(saveStemName || r.stemTitle)}
                className="py-2 px-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-emerald-500/50 text-emerald-300 font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 text-[11px]"
                title="Exportar archivo MIDI estándar (.mid) con todos los golpes/notas detectados"
              >
                <Download size={12} />
                <span>MIDI (.mid)</span>
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
                className="w-full py-1.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-amber-300 font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                title="Enviar este audio a Creador 16 Pads para cortar por transientes/rejilla y exportar ZIP o slices"
              >
                <Wand2 size={12} />
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
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-[#00E5FF] hover:brightness-110 text-slate-950 font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
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

            <p className="text-[10px] text-slate-500 leading-snug">
              <Wand2 size={10} className="inline mr-1 text-[#FF6B00]" />
              Duración bloqueada al sample original ({duration.toFixed(2)}s) para encajar cuadrado con los demás stems del tema.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
