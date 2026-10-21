import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Play,
  Pause,
  Save,
  Download,
  Type,
  Plus,
  Trash2,
  Wand2,
  Loader2,
  Music,
  Magnet,
  Scissors,
  Copy,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Layers,
  AlignCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  CheckCircle2,
  GripVertical,
  FileText,
  Radio,
  Volume2,
  Maximize2,
  CornerDownLeft,
  RotateCcw,
  Flame,
  Zap,
  Check,
} from 'lucide-react';
import {
  LyricLine,
  LyricFontCategory,
  LyricTextCase,
  LYRIC_EFFECT_PRESETS,
  LYRIC_FONT_PRESETS,
  LYRIC_FONT_CATEGORIES,
  computeWordTimings,
  parseRawLyricsToPills,
  buildBeatGridMs,
  snapTimeMs,
  extractAudioPeaks,
} from '../types/lyrics';
import { renderLyricCanvasFrame, ensureLyricFontsLoaded } from '../components/LyricVisualizer';

const FAKE_BAND_ID = '00000000-0000-0000-0000-000000000000';

interface AudioSourceOption {
  id: string;
  label: string;
  url: string;
  isVocal?: boolean;
}

interface ClipDragState {
  mode: 'move' | 'trim-left' | 'trim-right';
  lineId: string;
  initialMouseX: number;
  initialStartMs: number;
  initialDurationMs: number;
}

const SAMPLE_WORSHIP_LYRICS = `[INTRO]
TANDU MUSICOS STAGE
[VERSO 1]
EN LA OSCURIDAD BRILLA TU LUZ
CADA LATIDO CANTA TU NOMBRE
NO HAY TEMOR EN ESTE LUGAR
TU PRESENCIA LLENA EL ESCENARIO
[CORO]
LEVANTAMOS NUESTRA VOZ HOY
TODO EL CIELO SE UNE A CANTAR
FUEGO SANTO CAE AQUI
NADA NOS PODRA DETENER`;

export default function LyricStudio() {
  // Song & Audio State
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string>('');
  const [songData, setSongData] = useState<any>(null);
  const [audioSources, setAudioSources] = useState<AudioSourceOption[]>([]);
  const [selectedAudioUrl, setSelectedAudioUrl] = useState<string>('');
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [totalDurationMs, setTotalDurationMs] = useState<number>(180000);

  // Lyrics & Undo/Redo History State
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const lyricsRef = useRef<LyricLine[]>(lyrics);
  useEffect(() => {
    lyricsRef.current = lyrics;
  }, [lyrics]);

  const [historyPast, setHistoryPast] = useState<LyricLine[][]>([]);
  const [historyFuture, setHistoryFuture] = useState<LyricLine[][]>([]);

  // Selection & UI Workspace State
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<'pool' | 'paste'>('pool');
  const [poolFilter, setPoolFilter] = useState<'all' | 'unplaced' | 'placed'>('all');
  const [rawPasteText, setRawPasteText] = useState<string>('');
  const [saveFeedback, setSaveFeedback] = useState<boolean>(false);
  const [inspectorFontCategory, setInspectorFontCategory] = useState<'all' | LyricFontCategory>('all');
  const [inspectorEffectFilter, setInspectorEffectFilter] = useState<'all' | 'brutal' | 'classic'>('all');
  const [showAppliedToast, setShowAppliedToast] = useState<boolean>(false);

  // Timeline & CapCut Controls State
  const [pxPerSec, setPxPerSec] = useState<number>(80);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [showSafeZones, setShowSafeZones] = useState<boolean>(true);
  const [activeSnapMs, setActiveSnapMs] = useState<number | null>(null);
  const [dropPreviewMs, setDropPreviewMs] = useState<number | null>(null);
  const [draggingPoolLineId, setDraggingPoolLineId] = useState<string | null>(null);

  // Live "Hold-to-Sync" (CapCut Rhythm Mode) State
  const [liveSyncMode, setLiveSyncMode] = useState<boolean>(false);
  const [isHoldingSync, setIsHoldingSync] = useState<boolean>(false);
  const activeHoldLineIdRef = useRef<string | null>(null);
  const holdStartMsRef = useRef<number>(0);

  // 2D Canvas Direct Manipulation State
  const [isDraggingCanvas, setIsDraggingCanvas] = useState<boolean>(false);
  const [snapGuideX, setSnapGuideX] = useState<boolean>(false);
  const [snapGuideY, setSnapGuideY] = useState<boolean>(false);
  const boundingBoxesRef = useRef<Record<string, { x: number; y: number; width: number; height: number }>>({});

  // Transport & Export State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const currentTimeMsRef = useRef<number>(0);

  // Refs for Web Audio, Canvas & Timeline
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeSecRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const clipDragRef = useRef<ClipDragState | null>(null);

  // AI WhisperX Detection State
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [replicateKey, setReplicateKey] = useState<string>(
    () => localStorage.getItem('replicate_api_key') || ''
  );
  const [showTokenModal, setShowTokenModal] = useState<boolean>(false);

  // Commit changes to lyrics with Undo history support
  const commitLyrics = useCallback((updater: LyricLine[] | ((prev: LyricLine[]) => LyricLine[]), recordUndo = true) => {
    setLyrics((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (recordUndo) {
        setHistoryPast((h) => [...h.slice(-29), prev]);
        setHistoryFuture([]);
      }
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    setHistoryPast((past) => {
      if (past.length === 0) return past;
      const previous = past[past.length - 1];
      setHistoryFuture((future) => [lyricsRef.current, ...future]);
      setLyrics(previous);
      return past.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setHistoryFuture((future) => {
      if (future.length === 0) return future;
      const next = future[0];
      setHistoryPast((past) => [...past, lyricsRef.current]);
      setLyrics(next);
      return future.slice(1);
    });
  }, []);

  // Musical Beat Grid derived from songData.prompter_data
  const bpm = useMemo(() => Number(songData?.prompter_data?.bpm) || 120, [songData]);
  const firstBeatOffsetSec = useMemo(
    () => Number(songData?.prompter_data?.firstBeatOffset) || 0,
    [songData]
  );
  const beatTimesSec = useMemo(
    () => songData?.prompter_data?.beatTimes as number[] | undefined,
    [songData]
  );
  const songSections = useMemo(
    () => (songData?.prompter_data?.sections || []) as { name: string; startTime: number }[],
    [songData]
  );
  const songChords = useMemo(
    () => (songData?.prompter_data?.chords || []) as { chord: string; time: number }[],
    [songData]
  );

  const beatMarkers = useMemo(
    () => buildBeatGridMs(bpm, firstBeatOffsetSec, beatTimesSec, totalDurationMs, 4),
    [bpm, firstBeatOffsetSec, beatTimesSec, totalDurationMs]
  );

  // Selected lyric line object
  const selectedLine = useMemo(
    () => lyrics.find((l) => l.id === selectedLineId) || null,
    [lyrics, selectedLineId]
  );

  // Next unplaced (or sequential) line for Live "Hold-to-Sync"
  const nextSyncCandidate = useMemo(() => {
    const unplaced = lyrics.find((l) => l.placed === false);
    if (unplaced) return unplaced;
    if (selectedLineId) {
      return lyrics.find((l) => l.id === selectedLineId) || null;
    }
    return lyrics[0] || null;
  }, [lyrics, selectedLineId]);

  // Fetch songs on mount
  useEffect(() => {
    fetchSongs();
    ensureLyricFontsLoaded().catch(() => {});
    return () => {
      stopAudio();
    };
  }, []);

  const fetchSongs = async () => {
    const { data } = await supabase
      .from('songs')
      .select('*')
      .eq('band_id', FAKE_BAND_ID)
      .order('title', { ascending: true });
    if (data && data.length > 0) {
      setSongs(data);
      const savedId = sessionStorage.getItem('tandu_active_song_id');
      const target = savedId && data.some((s: any) => s.id === savedId) ? savedId : data[0].id;
      loadSong(target, data);
    }
  };

  // Decode audio from selected URL or generate synthetic rhythmic waveform fallback
  const loadAudioFromUrl = async (url: string, fallbackBpm = 120) => {
    stopAudio();
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    if (!url) {
      generateSyntheticBuffer(fallbackBpm);
      return;
    }

    setIsLoadingAudio(true);
    try {
      const res = await fetch(url);
      const arrayBuf = await res.arrayBuffer();
      const decoded = await audioCtxRef.current.decodeAudioData(arrayBuf);
      audioBufferRef.current = decoded;
      const durMs = Math.max(30000, Math.round(decoded.duration * 1000));
      setTotalDurationMs(durMs);
      setWaveformPeaks(extractAudioPeaks(decoded, Math.min(1800, Math.max(600, Math.floor(durMs / 100)))));
    } catch (err) {
      console.warn('Fallback to synthetic beat buffer:', err);
      generateSyntheticBuffer(fallbackBpm);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const generateSyntheticBuffer = (targetBpm: number) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    const durationSec = 120;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * durationSec, sampleRate);
    const data = buffer.getChannelData(0);
    const beatSec = 60 / Math.max(60, targetBpm || 120);

    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const beatPhase = (t % beatSec) / beatSec;
      const barPhase = (t % (beatSec * 4)) / (beatSec * 4);
      const click = beatPhase < 0.04 ? Math.sin(2 * Math.PI * (barPhase < 0.05 ? 880 : 440) * t) * Math.exp(-beatPhase * 60) * 0.25 : 0;
      const waveEnv = 0.15 + 0.35 * Math.abs(Math.sin(t * 1.7)) * Math.abs(Math.cos(t * 0.6));
      data[i] = click + (Math.random() * 2 - 1) * 0.02 * waveEnv;
    }

    audioBufferRef.current = buffer;
    setTotalDurationMs(durationSec * 1000);
    setWaveformPeaks(extractAudioPeaks(buffer, 900));
  };

  const loadSong = async (songId: string, songListInput?: any[]) => {
    const list = songListInput || songs;
    setSelectedSongId(songId);
    if (songId) sessionStorage.setItem('tandu_active_song_id', songId);
    stopAudio();
    pauseTimeSecRef.current = 0;
    setCurrentTimeMs(0);
    currentTimeMsRef.current = 0;

    const song = list.find((s) => s.id === songId);
    if (!song) return;
    setSongData(song);

    // Load existing lyrics or default starter lines
    const rawLyrics: LyricLine[] = song.prompter_data?.lyrics || [
      {
        id: 'starter-1',
        text: 'TANDU MUSICOS STAGE',
        sectionTag: 'INTRO',
        placed: true,
        startMs: 1000,
        durationMs: 2500,
        effect: 'capcut-karaoke',
        fontFamily: 'Montserrat',
        fontSize: 112,
        positionX: 0.5,
        positionY: 0.5,
        primaryColor: '#ffffff',
        accentColor: '#ef4444',
      },
      {
        id: 'starter-2',
        text: 'ARRASTRA LAS LETRAS AL RITMO',
        sectionTag: 'VERSO 1',
        placed: true,
        startMs: 4000,
        durationMs: 3000,
        effect: 'kinetic',
        fontFamily: 'Bebas Neue',
        fontSize: 120,
        positionX: 0.5,
        positionY: 0.5,
        primaryColor: '#ffffff',
        accentColor: '#ef4444',
      },
      {
        id: 'starter-3',
        text: 'SINCRONIZACION ESTILO CAPCUT PRO',
        sectionTag: 'CORO',
        placed: true,
        startMs: 7500,
        durationMs: 3200,
        effect: 'neon-stage',
        fontFamily: 'Montserrat',
        fontSize: 106,
        positionX: 0.5,
        positionY: 0.5,
        primaryColor: '#ffffff',
        accentColor: '#ef4444',
      },
    ];

    const normalizedLyrics: LyricLine[] = rawLyrics.map((l) => ({
      ...l,
      placed: l.placed !== undefined ? l.placed : true,
      effect: l.effect || 'capcut-karaoke',
      fontFamily: l.fontFamily || 'Montserrat',
      fontSize: l.fontSize || 108,
      positionX: l.positionX !== undefined ? l.positionX : 0.5,
      positionY: l.positionY !== undefined ? l.positionY : 0.5,
      primaryColor: l.primaryColor || '#ffffff',
      accentColor: l.accentColor || '#ef4444',
      words: computeWordTimings(l.text, l.durationMs, l.words),
    }));

    setLyrics(normalizedLyrics);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSelectedLineId(normalizedLyrics[0]?.id || null);

    // Fetch stems from Supabase so the user can choose Vocal stem or Full Mix
    const { data: stemsData } = await supabase
      .from('stems')
      .select('*')
      .eq('song_id', song.id);

    const sources: AudioSourceOption[] = [];
    if (song.foh_mix_url) {
      sources.push({
        id: 'foh_mix',
        label: 'Mezcla Principal (FOH Mix)',
        url: song.foh_mix_url,
      });
    }

    if (stemsData && stemsData.length > 0) {
      stemsData.forEach((st: any) => {
        const nameUpper = (st.name || '').toUpperCase();
        const isVocal =
          nameUpper.includes('VOCAL') ||
          nameUpper.includes('VOZ') ||
          nameUpper.includes('LEAD') ||
          nameUpper.includes('CORO') ||
          nameUpper.includes('GUIA');
        if (st.file_url) {
          sources.push({
            id: st.id,
            label: `${isVocal ? '🎤 ' : '🎵 '}Stem: ${st.name}`,
            url: st.file_url,
            isVocal,
          });
        }
      });
    }

    setAudioSources(sources);

    const preferred =
      sources.find((s) => s.id === 'foh_mix') ||
      sources.find((s) => s.isVocal) ||
      sources[0];

    const initialUrl = preferred?.url || '';
    setSelectedAudioUrl(initialUrl);
    await loadAudioFromUrl(initialUrl, Number(song.prompter_data?.bpm) || 120);
  };

  // Render 1920x1080 Stage Canvas
  const renderStageCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const timeMs =
      isPlayingRef.current && audioCtxRef.current
        ? (audioCtxRef.current.currentTime - startTimeRef.current) * 1000
        : pauseTimeSecRef.current * 1000;

    if (isPlayingRef.current && timeMs >= totalDurationMs) {
      stopAudio();
      return;
    }

    currentTimeMsRef.current = timeMs;
    setCurrentTimeMs(timeMs);

    // If holding spacebar in Live Sync Mode, expand the active line's duration in real time!
    if (activeHoldLineIdRef.current) {
      const holdId = activeHoldLineIdRef.current;
      const newDur = Math.max(250, Math.round(timeMs - holdStartMsRef.current));
      setLyrics((prev) =>
        prev.map((l) =>
          l.id === holdId
            ? {
                ...l,
                durationMs: newDur,
                words: computeWordTimings(l.text, newDur),
              }
            : l
        )
      );
    }

    boundingBoxesRef.current = {};
    renderLyricCanvasFrame(ctx, canvas.width, canvas.height, timeMs, lyricsRef.current, {
      showSafeZones,
      selectedLineId,
      snapGuideX,
      snapGuideY,
      bpm,
      onUpdateBoundingBox: (lineId, box) => {
        boundingBoxesRef.current[lineId] = box;
      },
    });

    // Auto-scroll timeline softly when playhead moves out of view during playback
    if (isPlayingRef.current && timelineScrollRef.current) {
      const container = timelineScrollRef.current;
      const playheadX = (timeMs / 1000) * pxPerSec;
      const viewLeft = container.scrollLeft;
      const viewRight = viewLeft + container.clientWidth;
      if (playheadX > viewRight - 120) {
        container.scrollLeft = playheadX - 180;
      }
    }

    if (isPlayingRef.current) {
      rafRef.current = requestAnimationFrame(renderStageCanvas);
    }
  }, [bpm, pxPerSec, selectedLineId, showSafeZones, snapGuideX, snapGuideY, totalDurationMs]);

  useEffect(() => {
    if (!isPlaying) {
      renderStageCanvas();
    }
  }, [lyrics, selectedLineId, showSafeZones, snapGuideX, snapGuideY, currentTimeMs, isPlaying, renderStageCanvas]);

  // Draw High-Density Audio Waveform Canvas on Timeline
  useEffect(() => {
    const wfCanvas = waveformCanvasRef.current;
    if (!wfCanvas) return;
    const ctx = wfCanvas.getContext('2d');
    if (!ctx) return;

    const totalWidthPx = Math.min(28000, Math.max(2400, Math.round((totalDurationMs / 1000) * pxPerSec)));
    const heightPx = 76;
    wfCanvas.width = totalWidthPx;
    wfCanvas.height = heightPx;

    ctx.clearRect(0, 0, totalWidthPx, heightPx);

    const peaks = waveformPeaks.length > 0 ? waveformPeaks : new Array(600).fill(0.15);
    const barCount = Math.min(peaks.length, Math.floor(totalWidthPx / 3));
    const stepPx = totalWidthPx / barCount;
    const centerY = heightPx / 2;

    const placedRanges = lyrics
      .filter((l) => l.placed !== false)
      .map((l) => [l.startMs, l.startMs + l.durationMs]);

    for (let i = 0; i < barCount; i++) {
      const peakIdx = Math.min(peaks.length - 1, Math.floor((i / barCount) * peaks.length));
      const amp = peaks[peakIdx];
      const barH = Math.max(3, amp * (heightPx * 0.84));
      const x = i * stepPx;
      const barTimeMs = (x / pxPerSec) * 1000;

      const isCoveredByLyric = placedRanges.some(
        ([s, e]) => barTimeMs >= s && barTimeMs <= e
      );

      ctx.fillStyle = isCoveredByLyric
        ? 'rgba(239, 68, 68, 0.72)'
        : 'rgba(148, 163, 184, 0.28)';
      ctx.beginPath();
      ctx.roundRect(x, centerY - barH / 2, Math.max(1.5, stepPx * 0.66), barH, 2);
      ctx.fill();
    }
  }, [waveformPeaks, totalDurationMs, pxPerSec, lyrics]);

  const playAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (!audioBufferRef.current) {
      generateSyntheticBuffer(bpm);
    }
    if (!audioBufferRef.current) return;

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    stopAudio();

    sourceNodeRef.current = audioCtxRef.current.createBufferSource();
    sourceNodeRef.current.buffer = audioBufferRef.current;

    const gainNode = audioCtxRef.current.createGain();
    gainNode.gain.value = 1;
    sourceNodeRef.current.connect(gainNode);
    gainNode.connect(audioCtxRef.current.destination);

    const offsetSec = Math.max(0, Math.min(audioBufferRef.current.duration - 0.05, pauseTimeSecRef.current));
    sourceNodeRef.current.start(0, offsetSec);
    startTimeRef.current = audioCtxRef.current.currentTime - offsetSec;

    setIsPlaying(true);
    isPlayingRef.current = true;
    rafRef.current = requestAnimationFrame(renderStageCanvas);
  };

  const stopAudio = () => {
    if (isPlayingRef.current && audioCtxRef.current) {
      pauseTimeSecRef.current = Math.max(0, audioCtxRef.current.currentTime - startTimeRef.current);
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {}
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  const seekToMs = useCallback(
    (targetMs: number) => {
      const clampedMs = Math.max(0, Math.min(totalDurationMs, targetMs));
      const wasPlaying = isPlayingRef.current;
      stopAudio();
      pauseTimeSecRef.current = clampedMs / 1000;
      currentTimeMsRef.current = clampedMs;
      setCurrentTimeMs(clampedMs);
      if (wasPlaying) {
        playAudio();
      } else {
        renderStageCanvas();
      }
    },
    [totalDurationMs, renderStageCanvas]
  );

  // Magnetic Snap helper for timeline edits
  const getSnappedTime = useCallback(
    (rawMs: number, excludeLineId?: string, disableSnapOverride?: boolean) => {
      if (!snapEnabled || disableSnapOverride) {
        return { timeMs: Math.max(0, Math.round(rawMs)), snapped: false };
      }
      const clipBoundaries: number[] = [Math.round(currentTimeMsRef.current)];
      lyricsRef.current.forEach((l) => {
        if (l.placed !== false && l.id !== excludeLineId) {
          clipBoundaries.push(l.startMs, l.startMs + l.durationMs);
        }
      });
      return snapTimeMs(rawMs, beatMarkers, clipBoundaries, 130);
    },
    [snapEnabled, beatMarkers]
  );

  // Live "Hold-to-Sync" Start & Release Handlers
  const startHoldSync = useCallback(() => {
    if (activeHoldLineIdRef.current) return;
    const candidate = nextSyncCandidate;
    if (!candidate) return;

    if (!isPlayingRef.current) {
      playAudio();
    }

    const nowMs = currentTimeMsRef.current;
    const snapped = getSnappedTime(nowMs, candidate.id);
    holdStartMsRef.current = snapped.timeMs;
    activeHoldLineIdRef.current = candidate.id;
    setIsHoldingSync(true);
    setSelectedLineId(candidate.id);

    setHistoryPast((h) => [...h.slice(-29), lyricsRef.current]);
    setHistoryFuture([]);

    setLyrics((prev) =>
      prev.map((l) =>
        l.id === candidate.id
          ? {
              ...l,
              placed: true,
              startMs: snapped.timeMs,
              durationMs: 350,
              words: computeWordTimings(l.text, 350),
            }
          : l
      )
    );
  }, [nextSyncCandidate, getSnappedTime]);

  const endHoldSync = useCallback(() => {
    const heldId = activeHoldLineIdRef.current;
    if (!heldId) return;

    const nowMs = currentTimeMsRef.current;
    const rawDuration = Math.max(450, nowMs - holdStartMsRef.current);
    const snappedEnd = getSnappedTime(holdStartMsRef.current + rawDuration, heldId);
    const finalDuration = Math.max(450, snappedEnd.timeMs - holdStartMsRef.current);

    activeHoldLineIdRef.current = null;
    setIsHoldingSync(false);

    setLyrics((prev) => {
      const updated = prev.map((l) =>
        l.id === heldId
          ? {
              ...l,
              placed: true,
              durationMs: finalDuration,
              words: computeWordTimings(l.text, finalDuration),
            }
          : l
      );

      const currentIdx = updated.findIndex((l) => l.id === heldId);
      const nextUnplaced = updated.find((l, idx) => idx > currentIdx && l.placed === false);
      const nextSequential = updated[currentIdx + 1];
      const nextTarget = nextUnplaced || nextSequential;
      if (nextTarget) {
        setSelectedLineId(nextTarget.id);
      }

      return updated;
    });
  }, [getSnappedTime]);

  // Global Keyboard Shortcuts (CapCut Workflow: Space, S to Split, Delete, Ctrl+Z / Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (liveSyncMode) {
          if (!e.repeat) startHoldSync();
        } else {
          if (isPlayingRef.current) stopAudio();
          else playAudio();
        }
        return;
      }

      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSplitAtPlayhead();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLineId) {
          e.preventDefault();
          removeLine(selectedLineId);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space' && liveSyncMode) {
        e.preventDefault();
        endHoldSync();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [liveSyncMode, selectedLineId, startHoldSync, endHoldSync, handleUndo, handleRedo]);

  // Pointer Move & Up listeners for Timeline Clip Dragging & Resizing (Trim Handles)
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      const drag = clipDragRef.current;
      if (!drag) return;

      const deltaPx = e.clientX - drag.initialMouseX;
      const deltaMs = (deltaPx / pxPerSec) * 1000;
      const disableSnap = e.altKey;

      if (drag.mode === 'move') {
        const candidateStart = Math.max(0, drag.initialStartMs + deltaMs);
        const snapped = getSnappedTime(candidateStart, drag.lineId, disableSnap);
        setActiveSnapMs(snapped.snapped ? snapped.timeMs : null);

        setLyrics((prev) =>
          prev.map((l) =>
            l.id === drag.lineId
              ? { ...l, placed: true, startMs: snapped.timeMs }
              : l
          )
        );
      } else if (drag.mode === 'trim-left') {
        const originalEndMs = drag.initialStartMs + drag.initialDurationMs;
        const maxStartMs = originalEndMs - 300;
        const candidateStart = Math.max(0, Math.min(maxStartMs, drag.initialStartMs + deltaMs));
        const snapped = getSnappedTime(candidateStart, drag.lineId, disableSnap);
        const clampedStart = Math.min(maxStartMs, snapped.timeMs);
        const newDuration = Math.max(300, originalEndMs - clampedStart);

        setActiveSnapMs(snapped.snapped ? clampedStart : null);
        setLyrics((prev) =>
          prev.map((l) =>
            l.id === drag.lineId
              ? {
                  ...l,
                  startMs: clampedStart,
                  durationMs: newDuration,
                  words: computeWordTimings(l.text, newDuration),
                }
              : l
          )
        );
      } else if (drag.mode === 'trim-right') {
        const candidateEnd = Math.max(
          drag.initialStartMs + 300,
          drag.initialStartMs + drag.initialDurationMs + deltaMs
        );
        const snapped = getSnappedTime(candidateEnd, drag.lineId, disableSnap);
        const newDuration = Math.max(300, snapped.timeMs - drag.initialStartMs);

        setActiveSnapMs(snapped.snapped ? snapped.timeMs : null);
        setLyrics((prev) =>
          prev.map((l) =>
            l.id === drag.lineId
              ? {
                  ...l,
                  durationMs: newDuration,
                  words: computeWordTimings(l.text, newDuration),
                }
              : l
          )
        );
      }
    };

    const handleWindowMouseUp = () => {
      if (clipDragRef.current) {
        clipDragRef.current = null;
        setActiveSnapMs(null);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [pxPerSec, getSnappedTime]);

  // Save to Supabase (100% compatible with LiveConcert.tsx)
  const handleSave = async () => {
    if (!songData) return;
    const newPrompterData = { ...songData.prompter_data, lyrics };
    const { error } = await supabase
      .from('songs')
      .update({ prompter_data: newPrompterData })
      .eq('id', songData.id);

    if (!error) {
      setSongData({ ...songData, prompter_data: newPrompterData });
      setSaveFeedback(true);
      setTimeout(() => setSaveFeedback(false), 2500);
    } else {
      alert(`Error al guardar: ${error.message}`);
    }
  };

  // Line CRUD & CapCut Operations
  const updateLine = (id: string, updates: Partial<LyricLine>, recordUndo = true) => {
    commitLyrics(
      (prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const next = { ...l, ...updates };
          if (updates.text !== undefined || updates.durationMs !== undefined) {
            next.words = computeWordTimings(next.text, next.durationMs);
          }
          return next;
        }),
      recordUndo
    );
  };

  const addLineAtPlayhead = () => {
    const snapped = getSnappedTime(currentTimeMsRef.current);
    const baseStyle = selectedLine || lyrics[lyrics.length - 1];
    const newLine: LyricLine = {
      id: `lyric-${Date.now()}`,
      text: 'NUEVA FRASE EN ESCENA',
      sectionTag: 'VERSO',
      placed: true,
      startMs: snapped.timeMs,
      durationMs: 2600,
      effect: baseStyle?.effect || 'capcut-karaoke',
      fontFamily: baseStyle?.fontFamily || 'Montserrat',
      fontSize: baseStyle?.fontSize || 108,
      positionX: baseStyle?.positionX ?? 0.5,
      positionY: baseStyle?.positionY ?? 0.5,
      primaryColor: baseStyle?.primaryColor || '#ffffff',
      accentColor: baseStyle?.accentColor || '#ef4444',
      letterSpacing: baseStyle?.letterSpacing,
      textCase: baseStyle?.textCase,
      strokeWidth: baseStyle?.strokeWidth,
      fxIntensity: baseStyle?.fxIntensity,
      ghostText: baseStyle?.ghostText,
      words: computeWordTimings('NUEVA FRASE EN ESCENA', 2600),
    };
    commitLyrics((prev) => [...prev, newLine]);
    setSelectedLineId(newLine.id);
  };

  const removeLine = (id: string) => {
    commitLyrics((prev) => prev.filter((l) => l.id !== id));
    if (selectedLineId === id) setSelectedLineId(null);
  };

  const placePillAtTime = (lineId: string, rawStartMs: number, customXY?: { x: number; y: number }) => {
    const snapped = getSnappedTime(rawStartMs, lineId);
    const oneBarMs = Math.max(1800, Math.min(4200, Math.round((60000 / bpm) * 4)));

    commitLyrics((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? {
              ...l,
              placed: true,
              startMs: snapped.timeMs,
              durationMs: l.durationMs || oneBarMs,
              positionX: customXY ? customXY.x : l.positionX ?? 0.5,
              positionY: customXY ? customXY.y : l.positionY ?? 0.5,
              words: computeWordTimings(l.text, l.durationMs || oneBarMs),
            }
          : l
      )
    );
    setSelectedLineId(lineId);
    seekToMs(snapped.timeMs + 120);
  };

  // CapCut Split Tool: Splits a lyric phrase in two at the playhead or midpoint
  const handleSplitLine = (targetLine: LyricLine, splitTimeMs?: number) => {
    const words = targetLine.text.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return;

    const cutRatio =
      splitTimeMs &&
      splitTimeMs > targetLine.startMs + 200 &&
      splitTimeMs < targetLine.startMs + targetLine.durationMs - 200
        ? (splitTimeMs - targetLine.startMs) / targetLine.durationMs
        : 0.5;

    const splitWordIdx = Math.max(1, Math.min(words.length - 1, Math.round(words.length * cutRatio)));
    const firstText = words.slice(0, splitWordIdx).join(' ');
    const secondText = words.slice(splitWordIdx).join(' ');

    const firstDur = Math.max(400, Math.round(targetLine.durationMs * cutRatio));
    const secondDur = Math.max(400, targetLine.durationMs - firstDur);

    const firstPart: LyricLine = {
      ...targetLine,
      text: firstText,
      durationMs: firstDur,
      words: computeWordTimings(firstText, firstDur),
    };

    const secondPart: LyricLine = {
      ...targetLine,
      id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      text: secondText,
      startMs: targetLine.startMs + firstDur,
      durationMs: secondDur,
      words: computeWordTimings(secondText, secondDur),
    };

    commitLyrics((prev) => {
      const idx = prev.findIndex((l) => l.id === targetLine.id);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy.splice(idx, 1, firstPart, secondPart);
      return copy;
    });
    setSelectedLineId(secondPart.id);
  };

  const handleSplitAtPlayhead = () => {
    const now = currentTimeMsRef.current;
    const active = lyrics.find(
      (l) => l.placed !== false && now >= l.startMs && now <= l.startMs + l.durationMs
    );
    if (active) {
      handleSplitLine(active, now);
    } else if (selectedLine) {
      handleSplitLine(selectedLine);
    }
  };

  const handleDuplicateSelected = () => {
    if (!selectedLine) return;
    const newStart = selectedLine.startMs + selectedLine.durationMs + 100;
    const snapped = getSnappedTime(newStart);
    const dup: LyricLine = {
      ...selectedLine,
      id: `dup-${Date.now()}`,
      placed: true,
      startMs: snapped.timeMs,
    };
    commitLyrics((prev) => [...prev, dup]);
    setSelectedLineId(dup.id);
  };

  // Process Bulk Pasted Lyrics into Draggable Pills
  const handleProcessPastedLyrics = (autoPlaceOnBars: boolean) => {
    if (!rawPasteText.trim()) return;
    const baseEffect = selectedLine?.effect || 'capcut-karaoke';
    const baseFont = selectedLine?.fontFamily || 'Montserrat';
    const oneBarMs = Math.max(1800, Math.min(4000, Math.round((60000 / bpm) * 4)));
    const newPills = parseRawLyricsToPills(rawPasteText, baseEffect, baseFont, oneBarMs);

    if (autoPlaceOnBars) {
      const downbeats = beatMarkers.filter((m) => m.isDownbeat);
      const placedPills = newPills.map((pill, idx) => {
        const start = downbeats[idx]?.timeMs ?? idx * oneBarMs;
        const nextStart = downbeats[idx + 1]?.timeMs ?? start + oneBarMs;
        const dur = Math.max(800, nextStart - start - 60);
        return {
          ...pill,
          placed: true,
          startMs: start,
          durationMs: dur,
          words: computeWordTimings(pill.text, dur),
        };
      });
      commitLyrics((prev) => [...prev, ...placedPills]);
      if (placedPills[0]) setSelectedLineId(placedPills[0].id);
    } else {
      commitLyrics((prev) => [...prev, ...newPills]);
      if (newPills[0]) setSelectedLineId(newPills[0].id);
    }

    setRawPasteText('');
    setLeftTab('pool');
    setPoolFilter(autoPlaceOnBars ? 'all' : 'unplaced');
  };

  // Apply style preset to ALL lyrics in 1 click
  const applyStyleToAll = () => {
    if (!selectedLine) return;
    commitLyrics((prev) =>
      prev.map((l) => ({
        ...l,
        effect: selectedLine.effect,
        fontFamily: selectedLine.fontFamily,
        fontSize: selectedLine.fontSize,
        positionX: selectedLine.positionX,
        positionY: selectedLine.positionY,
        primaryColor: selectedLine.primaryColor,
        accentColor: selectedLine.accentColor,
        letterSpacing: selectedLine.letterSpacing,
        textCase: selectedLine.textCase,
        strokeWidth: selectedLine.strokeWidth,
        fxIntensity: selectedLine.fxIntensity,
        ghostText: selectedLine.ghostText,
      }))
    );
    setShowAppliedToast(true);
    setTimeout(() => setShowAppliedToast(false), 2000);
  };

  // 2D Stage Canvas Direct Dragging (Position X/Y with Magnetic Center Guides)
  const handleCanvasPointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const boxes = boundingBoxesRef.current;
    const hitLineId = Object.keys(boxes).find((id) => {
      const b = boxes[id];
      return clickX >= b.x && clickX <= b.x + b.width && clickY >= b.y && clickY <= b.y + b.height;
    });

    if (hitLineId) {
      setSelectedLineId(hitLineId);
      setIsDraggingCanvas(true);
      setHistoryPast((h) => [...h.slice(-29), lyricsRef.current]);
      setHistoryFuture([]);
    }
  };

  const handleCanvasPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingCanvas || !selectedLineId || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    let normX = Math.max(0.1, Math.min(0.9, (e.clientX - rect.left) / rect.width));
    let normY = Math.max(0.1, Math.min(0.92, (e.clientY - rect.top) / rect.height));

    const snapX = Math.abs(normX - 0.5) < 0.025;
    const snapCenterY = Math.abs(normY - 0.5) < 0.025;
    const snapLowerThirdY = Math.abs(normY - 0.82) < 0.025;

    if (snapX) normX = 0.5;
    if (snapCenterY) normY = 0.5;
    else if (snapLowerThirdY) normY = 0.82;

    setSnapGuideX(snapX);
    setSnapGuideY(snapCenterY || snapLowerThirdY);

    updateLine(selectedLineId, { positionX: normX, positionY: normY }, false);
  };

  const handleCanvasPointerUp = () => {
    if (isDraggingCanvas) {
      setIsDraggingCanvas(false);
      setSnapGuideX(false);
      setSnapGuideY(false);
    }
  };

  // Export 60fps Video
  const startExport = async () => {
    if (!canvasRef.current) return;
    setIsRecording(true);
    await ensureLyricFontsLoaded();
    pauseTimeSecRef.current = 0;
    setCurrentTimeMs(0);

    const stream = canvasRef.current.captureStream(60);

    if (audioCtxRef.current && audioBufferRef.current) {
      const audioDest = audioCtxRef.current.createMediaStreamDestination();
      const exportSource = audioCtxRef.current.createBufferSource();
      exportSource.buffer = audioBufferRef.current;
      exportSource.connect(audioDest);
      exportSource.start(0);
      audioDest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    }

    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    recordedChunksRef.current = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${songData?.title || 'tandu_stage_lyrics'}.webm`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      setIsRecording(false);
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    playAudio();

    if (audioBufferRef.current) {
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          stopAudio();
          pauseTimeSecRef.current = 0;
        }
      }, audioBufferRef.current.duration * 1000);
    }
  };

  // WhisperX AI Auto-Detection (Supports Vocal Stem or Mix URL)
  const handleAutoDetect = async () => {
    const targetAudioUrl = selectedAudioUrl || songData?.foh_mix_url;
    if (!songData || !targetAudioUrl) {
      alert('Selecciona una canción con pista de audio o Stem Vocal primero.');
      return;
    }

    const envToken = import.meta.env.VITE_REPLICATE_API_TOKEN;
    const activeToken = envToken || replicateKey;
    if (!activeToken) {
      setShowTokenModal(true);
      return;
    }

    setIsDetecting(true);
    try {
      const response = await fetch('/api/replicate-predict', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: '84d2cb0a12d5fda904529d1a93eea14389fb13b19280d9ee6cc04a0e9803d366',
          input: {
            audio: targetAudioUrl,
            batch_size: 64,
            align_output: true,
          },
        }),
      });

      let prediction = await response.json();
      if (prediction.error) throw new Error(prediction.error);

      while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
        await new Promise((r) => setTimeout(r, 2000));
        const pollResponse = await fetch(`/api/replicate-poll?id=${prediction.id}`, {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        prediction = await pollResponse.json();
      }

      if (prediction.status === 'failed') {
        throw new Error('La transcripción falló en Replicate.');
      }

      const segments = prediction.output?.segments || [];
      const aiLyrics: LyricLine[] = segments.map((seg: any, idx: number) => {
        const text = (seg.text || '').trim().toUpperCase();
        const startMs = Math.round((seg.start || 0) * 1000);
        const durationMs = Math.max(500, Math.round(((seg.end || seg.start + 2) - (seg.start || 0)) * 1000));

        const alignedWords = Array.isArray(seg.words)
          ? seg.words
              .filter((w: any) => w.word)
              .map((w: any) => ({
                word: String(w.word).trim().toUpperCase(),
                startOffsetMs: Math.max(0, Math.round(((w.start ?? seg.start) - seg.start) * 1000)),
                durationMs: Math.max(80, Math.round(((w.end ?? (w.start + 0.25)) - (w.start ?? seg.start)) * 1000)),
              }))
          : computeWordTimings(text, durationMs);

        return {
          id: `ai-${Date.now()}-${idx}`,
          text,
          sectionTag: 'IA SYNC',
          placed: true,
          startMs,
          durationMs,
          effect: 'capcut-karaoke',
          fontFamily: 'Montserrat',
          fontSize: 108,
          positionX: 0.5,
          positionY: 0.5,
          primaryColor: '#ffffff',
          accentColor: '#ef4444',
          words: alignedWords,
        };
      });

      commitLyrics((prev) => [...prev, ...aiLyrics]);
      if (aiLyrics[0]) setSelectedLineId(aiLyrics[0].id);
    } catch (err: any) {
      alert(`Error al conectar con WhisperX IA: ${err.message}`);
      if (err.message?.includes('Token')) {
        localStorage.removeItem('replicate_api_key');
        setReplicateKey('');
      }
    } finally {
      setIsDetecting(false);
    }
  };

  // Filtered Lyric Pool items
  const filteredPoolLyrics = useMemo(() => {
    const sorted = [...lyrics].sort((a, b) => {
      if ((a.placed === false) !== (b.placed === false)) {
        return a.placed === false ? -1 : 1;
      }
      return a.startMs - b.startMs;
    });
    if (poolFilter === 'unplaced') return sorted.filter((l) => l.placed === false);
    if (poolFilter === 'placed') return sorted.filter((l) => l.placed !== false);
    return sorted;
  }, [lyrics, poolFilter]);

  const unplacedCount = useMemo(() => lyrics.filter((l) => l.placed === false).length, [lyrics]);
  const placedCount = useMemo(() => lyrics.filter((l) => l.placed !== false).length, [lyrics]);

  const timelineWidthPx = useMemo(
    () => Math.min(28000, Math.max(2400, Math.round((totalDurationMs / 1000) * pxPerSec))),
    [totalDurationMs, pxPerSec]
  );

  const formatTimecode = (ms: number) => {
    const totalSec = Math.max(0, ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    const tenths = Math.floor((totalSec % 1) * 10);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
  };

  return (
    <div className="h-screen bg-[#07090e] text-white flex flex-col font-sans select-none overflow-hidden">
      {/* 1. TOP STUDIO HEADER BAR */}
      <header className="h-14 bg-[#0b0e14] border-b border-white/[0.07] flex items-center px-5 justify-between z-30 shrink-0">
        {/* Left: Brand Badge + Song & Stem Selector */}
        <div className="flex items-center gap-3">
          <div className="bg-red-600/15 border border-red-500/30 text-white font-black px-3 py-1.5 rounded-lg uppercase tracking-wider text-[11px] flex items-center gap-2 shadow-[0_0_20px_rgba(239,68,68,0.15)]">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span>LYRIC STUDIO</span>
            <span className="text-red-500">/STAGE</span>
          </div>

          <select
            className="bg-[#121722] border border-white/10 hover:border-white/20 text-white px-3 py-1.5 rounded-lg outline-none font-semibold text-xs transition-colors cursor-pointer min-w-[180px]"
            value={selectedSongId}
            onChange={(e) => loadSong(e.target.value)}
          >
            <option value="">Seleccionar Canción...</option>
            {songs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} {s.prompter_data?.bpm ? `(${s.prompter_data.bpm} BPM)` : ''}
              </option>
            ))}
          </select>

          {/* Audio Source / Stem Selector (Vocal Isolation for Waveform) */}
          {audioSources.length > 0 && (
            <div className="flex items-center gap-1.5 bg-[#121722] border border-white/10 rounded-lg px-2.5 py-1">
              <Volume2 size={13} className="text-red-400 shrink-0" />
              <select
                className="bg-transparent text-[11px] font-medium text-gray-300 outline-none cursor-pointer max-w-[180px]"
                value={selectedAudioUrl}
                onChange={(e) => {
                  setSelectedAudioUrl(e.target.value);
                  loadAudioFromUrl(e.target.value, bpm);
                }}
              >
                {audioSources.map((src) => (
                  <option key={src.id} value={src.url} className="bg-[#0b0e14] text-white">
                    {src.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isLoadingAudio && (
            <span className="text-[11px] text-red-400 flex items-center gap-1.5 font-mono">
              <Loader2 size={13} className="animate-spin" /> Procesando onda...
            </span>
          )}
        </div>

        {/* Center: Transport & Timecode */}
        <div className="flex items-center gap-2 bg-[#11151f] border border-white/[0.08] px-3 py-1 rounded-xl">
          <button
            onClick={() => seekToMs(0)}
            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            title="Ir al inicio"
          >
            <RotateCcw size={14} />
          </button>

          <button
            onClick={isPlaying ? stopAudio : playAudio}
            disabled={isRecording}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-wider transition-all ${
              isPlaying
                ? 'bg-red-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.45)]'
                : 'bg-white text-black hover:bg-gray-200'
            }`}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} fill="currentColor" />}
            <span>{isPlaying ? 'Pausa' : 'Play'}</span>
          </button>

          <div className="px-3 py-0.5 border-l border-white/10 font-mono text-xs flex items-center gap-2">
            <span className="text-red-400 font-bold">{formatTimecode(currentTimeMs)}</span>
            <span className="text-gray-600">/</span>
            <span className="text-gray-400">{formatTimecode(totalDurationMs)}</span>
          </div>

          <div className="px-2.5 py-0.5 bg-red-500/10 border border-red-500/20 rounded-md text-[10px] font-mono font-bold text-red-400">
            {bpm} BPM
          </div>
        </div>

        {/* Right: Undo/Redo, Save & Export */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#121722] border border-white/10 rounded-lg p-0.5">
            <button
              onClick={handleUndo}
              disabled={historyPast.length === 0}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
              title="Deshacer (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyFuture.length === 0}
              className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
              title="Rehacer (Ctrl+Y)"
            >
              <Redo2 size={14} />
            </button>
          </div>

          <button
            onClick={handleSave}
            disabled={!songData}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-bold text-xs transition-all border ${
              saveFeedback
                ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40'
                : 'bg-white/[0.06] hover:bg-white/[0.12] text-white border-white/10'
            }`}
          >
            {saveFeedback ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Save size={14} />}
            <span>{saveFeedback ? '¡Guardado!' : 'Guardar en Canción'}</span>
          </button>

          <button
            onClick={startExport}
            disabled={isRecording}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white px-3.5 py-1.5 rounded-lg font-bold text-xs transition-all shadow-[0_0_20px_rgba(239,68,68,0.35)]"
          >
            <Download size={14} className={isRecording ? 'animate-bounce' : ''} />
            <span>{isRecording ? 'Renderizando 60fps...' : 'Exportar Video'}</span>
          </button>
        </div>
      </header>

      {/* 2. MIDDLE WORKSPACE: LEFT LYRIC POOL + CENTER 2D STAGE + RIGHT CAPCUT INSPECTOR */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT PANEL: SMART LYRIC POOL & BULK PASTE */}
        <aside className="w-[340px] bg-[#0b0e14] border-r border-white/[0.07] flex flex-col shrink-0">
          {/* Mode Switcher Tabs */}
          <div className="p-3 border-b border-white/[0.06] flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-1 bg-[#121722] p-1 rounded-xl border border-white/[0.06]">
              <button
                onClick={() => setLeftTab('pool')}
                className={`py-1.5 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                  leftTab === 'pool'
                    ? 'bg-red-600 text-white shadow-[0_2px_10px_rgba(239,68,68,0.3)]'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Layers size={13} />
                <span>Píldoras ({lyrics.length})</span>
              </button>
              <button
                onClick={() => setLeftTab('paste')}
                className={`py-1.5 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                  leftTab === 'paste'
                    ? 'bg-red-600 text-white shadow-[0_2px_10px_rgba(239,68,68,0.3)]'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <FileText size={13} />
                <span>Pegar Letra</span>
              </button>
            </div>

            {leftTab === 'pool' && (
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 text-[10px] font-bold">
                  <button
                    onClick={() => setPoolFilter('all')}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      poolFilter === 'all' ? 'bg-white/15 text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Todas ({lyrics.length})
                  </button>
                  <button
                    onClick={() => setPoolFilter('unplaced')}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      poolFilter === 'unplaced'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Bandeja ({unplacedCount})
                  </button>
                  <button
                    onClick={() => setPoolFilter('placed')}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      poolFilter === 'placed'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    En Pista ({placedCount})
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={handleAutoDetect}
                    disabled={isDetecting || !songData}
                    className="p-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/20 transition-colors disabled:opacity-40"
                    title="Auto-Sincronizar con WhisperX IA"
                  >
                    {isDetecting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                  </button>
                  <button
                    onClick={addLineAtPlayhead}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                    title="Añadir frase en el Playhead"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* TAB 1: DRAGGABLE LYRIC PILLS POOL */}
          {leftTab === 'pool' ? (
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {filteredPoolLyrics.map((line, index) => {
                const isSelected = line.id === selectedLineId;
                const isUnplaced = line.placed === false;
                const isCurrentlyPlaying =
                  line.placed !== false &&
                  currentTimeMs >= line.startMs &&
                  currentTimeMs <= line.startMs + line.durationMs;

                return (
                  <div
                    key={line.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', line.id);
                      setDraggingPoolLineId(line.id);
                    }}
                    onDragEnd={() => {
                      setDraggingPoolLineId(null);
                      setDropPreviewMs(null);
                    }}
                    onClick={() => {
                      setSelectedLineId(line.id);
                      if (line.placed !== false) {
                        seekToMs(line.startMs + 80);
                      }
                    }}
                    className={`group rounded-xl p-2.5 transition-all cursor-grab active:cursor-grabbing border ${
                      isSelected
                        ? 'bg-[#171c28] border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.12)]'
                        : isCurrentlyPlaying
                        ? 'bg-red-950/25 border-red-500/40'
                        : 'bg-[#11151f]/80 hover:bg-[#151a26] border-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <GripVertical size={13} className="text-gray-600 group-hover:text-gray-400 shrink-0" />
                        <span className="text-[10px] font-mono font-bold text-gray-500">
                          #{String(index + 1).padStart(2, '0')}
                        </span>
                        {line.sectionTag && (
                          <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-300">
                            {line.sectionTag}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {isUnplaced ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              placePillAtTime(line.id, currentTimeMsRef.current);
                            }}
                            className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-red-600 text-amber-300 hover:text-white border border-amber-500/30 text-[10px] font-bold flex items-center gap-1 transition-all"
                            title="Soltar ahora en la posición actual del Playhead"
                          >
                            <CornerDownLeft size={10} />
                            <span>Soltar aquí</span>
                          </button>
                        ) : (
                          <span className="text-[10px] font-mono text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                            {formatTimecode(line.startMs)} · {(line.durationMs / 1000).toFixed(1)}s
                          </span>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSplitLine(line);
                          }}
                          className="p-1 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Dividir frase en 2 píldoras"
                        >
                          <Scissors size={12} />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeLine(line.id);
                          }}
                          className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Eliminar frase"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={line.text}
                      onChange={(e) => updateLine(line.id, { text: e.target.value.toUpperCase() })}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-transparent text-xs font-extrabold text-white outline-none border-b border-transparent focus:border-red-500/60 pb-0.5 tracking-wide"
                      placeholder="ESCRIBE LA FRASE..."
                    />
                  </div>
                );
              })}

              {filteredPoolLyrics.length === 0 && (
                <div className="text-center py-12 px-4">
                  <p className="text-xs text-gray-400 font-semibold mb-2">
                    No hay píldoras en esta vista
                  </p>
                  <button
                    onClick={() => setLeftTab('paste')}
                    className="px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30 text-xs font-bold hover:bg-red-600 hover:text-white transition-all"
                  >
                    Pegar Letra Completa
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* TAB 2: BULK PASTE & SMART SPLITTER */
            <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">
                  Pegado Inteligente de Canción
                </span>
                <button
                  onClick={() => setRawPasteText(SAMPLE_WORSHIP_LYRICS)}
                  className="text-[10px] font-bold text-red-400 hover:text-red-300 underline"
                >
                  Cargar ejemplo
                </button>
              </div>

              <p className="text-[11px] text-gray-400 leading-relaxed">
                Pega toda la letra de la canción. Cada renglón se convertirá automáticamente en una{' '}
                <strong className="text-white">píldora arrastrable</strong> lista para soltar en la onda de audio o sincronizar con la barra espaciadora.
              </p>

              <textarea
                value={rawPasteText}
                onChange={(e) => setRawPasteText(e.target.value)}
                placeholder={`Ejemplo:\n[VERSO 1]\nEN LA OSCURIDAD BRILLA TU LUZ\nCADA LATIDO CANTA TU NOMBRE\n[CORO]\nLEVANTAMOS NUESTRA VOZ HOY`}
                className="flex-1 min-h-[220px] bg-[#11151f] border border-white/10 focus:border-red-500/60 rounded-xl p-3 text-xs font-mono text-white outline-none resize-none leading-relaxed"
              />

              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={() => handleProcessPastedLyrics(false)}
                  disabled={!rawPasteText.trim()}
                  className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all flex items-center justify-center gap-2"
                >
                  <Sparkles size={14} />
                  <span>Crear Píldoras en Bandeja (Para Arrastrar / Espacio)</span>
                </button>

                <button
                  onClick={() => handleProcessPastedLyrics(true)}
                  disabled={!rawPasteText.trim()}
                  className="w-full py-2 px-4 rounded-xl font-bold text-xs bg-white/[0.07] hover:bg-white/[0.14] disabled:opacity-40 text-gray-200 border border-white/10 transition-all flex items-center justify-center gap-2"
                >
                  <Magnet size={13} className="text-red-400" />
                  <span>Auto-Colocar en Compases del Timeline</span>
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* CENTER PANEL: 16:9 INTERACTIVE STAGE MONITOR + LIVE TAP-TO-SYNC DECK */}
        <main className="flex-1 flex flex-col bg-[#06080c] relative overflow-hidden">
          {/* Top Floating Stage Helper Bar */}
          <div className="h-11 border-b border-white/[0.06] bg-[#090c12] px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mr-2">
                Posición Escenario:
              </span>
              <button
                onClick={() =>
                  selectedLine && updateLine(selectedLine.id, { positionX: 0.5, positionY: 0.5 })
                }
                className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/10 text-[11px] font-semibold text-gray-300 flex items-center gap-1 transition-colors"
                title="Centrar en pantalla (50%, 50%)"
              >
                <AlignCenter size={12} /> Centro
              </button>
              <button
                onClick={() =>
                  selectedLine && updateLine(selectedLine.id, { positionX: 0.5, positionY: 0.82 })
                }
                className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/10 text-[11px] font-semibold text-gray-300 flex items-center gap-1 transition-colors"
                title="Modo Subtítulo de Concierto (Tercio Inferior 82%)"
              >
                <ArrowDownToLine size={12} /> Subtítulo Inferior
              </button>
              <button
                onClick={() =>
                  selectedLine && updateLine(selectedLine.id, { positionX: 0.5, positionY: 0.22 })
                }
                className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/10 text-[11px] font-semibold text-gray-300 flex items-center gap-1 transition-colors"
                title="Tercio Superior (22%)"
              >
                <ArrowUpToLine size={12} /> Superior
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSafeZones((v) => !v)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border transition-colors ${
                  showSafeZones
                    ? 'bg-red-500/15 text-red-300 border-red-500/30'
                    : 'bg-white/[0.04] text-gray-500 border-transparent'
                }`}
              >
                <Maximize2 size={11} /> Guías Seguras
              </button>
            </div>
          </div>

          {/* 16:9 Stage Preview Canvas Container (Supports Direct Drag & Drop from Pool + 2D Dragging) */}
          <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
            <div
              className="w-full max-w-4xl aspect-video bg-black rounded-2xl overflow-hidden shadow-[0_25px_70px_rgba(0,0,0,0.85)] border border-white/10 relative group"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const droppedId = e.dataTransfer.getData('text/plain') || draggingPoolLineId;
                if (!droppedId || !canvasRef.current) return;
                const rect = canvasRef.current.getBoundingClientRect();
                const normX = Math.max(0.15, Math.min(0.85, (e.clientX - rect.left) / rect.width));
                const normY = Math.max(0.15, Math.min(0.88, (e.clientY - rect.top) / rect.height));
                placePillAtTime(droppedId, currentTimeMsRef.current, { x: normX, y: normY });
                setDraggingPoolLineId(null);
              }}
            >
              <canvas
                ref={canvasRef}
                width={1920}
                height={1080}
                onMouseDown={handleCanvasPointerDown}
                onMouseMove={handleCanvasPointerMove}
                onMouseUp={handleCanvasPointerUp}
                onMouseLeave={handleCanvasPointerUp}
                className={`w-full h-full object-contain ${
                  isDraggingCanvas ? 'cursor-grabbing' : 'cursor-grab'
                }`}
              />

              {/* HUD Info Overlay on Monitor */}
              <div className="absolute top-3 left-3 pointer-events-none flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-black/65 backdrop-blur-md border border-white/10 text-[10px] font-mono text-gray-300">
                  1920×1080 · 60FPS · ARRASTRA EL TEXTO EN PANTALLA PARA MOVERLO
                </span>
              </div>

              {isRecording && (
                <div className="absolute top-3 right-3 flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-lg font-bold animate-pulse text-xs">
                  <div className="w-2 h-2 rounded-full bg-white" />
                  <span>EXPORTANDO 60FPS</span>
                </div>
              )}
            </div>
          </div>

          {/* CAPCUT LIVE "HOLD-TO-SYNC" BAR (Ultra-Fast One-Pass Song Sync) */}
          <div className="h-14 bg-[#0b0e14] border-t border-white/[0.07] px-5 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLiveSyncMode((v) => !v)}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-2 border transition-all ${
                  liveSyncMode
                    ? 'bg-red-600/20 text-red-300 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                    : 'bg-[#121722] text-gray-400 border-white/10 hover:text-white'
                }`}
              >
                <Radio size={14} className={liveSyncMode ? 'text-red-400 animate-pulse' : ''} />
                <span>Modo Sincronización en Vivo: {liveSyncMode ? 'ACTIVO' : 'OFF'}</span>
              </button>

              {nextSyncCandidate && (
                <div className="flex items-center gap-2 text-xs bg-[#121722] border border-white/[0.06] px-3 py-1.5 rounded-lg max-w-md truncate">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-red-400 shrink-0">
                    Siguiente Letra:
                  </span>
                  <span className="font-bold text-white truncate">{nextSyncCandidate.text}</span>
                </div>
              )}
            </div>

            <button
              onMouseDown={() => {
                setLiveSyncMode(true);
                startHoldSync();
              }}
              onMouseUp={endHoldSync}
              onMouseLeave={() => {
                if (isHoldingSync) endHoldSync();
              }}
              className={`px-5 py-2 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all select-none ${
                isHoldingSync
                  ? 'bg-red-500 text-white scale-[0.98] shadow-[0_0_30px_rgba(239,68,68,0.8)] ring-2 ring-white'
                  : 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)]'
              }`}
            >
              <Sparkles size={14} />
              <span>
                {isHoldingSync
                  ? '● GRABANDO DURACIÓN... (SUELTA AL TERMINAR LA FRASE)'
                  : 'MANTÉN PRESIONADO (O ESPACIO) MIENTRAS CANTAN LA FRASE'}
              </span>
            </button>
          </div>
        </main>

        {/* RIGHT PANEL: KINETIC & LUXURY TYPOGRAPHY INSPECTOR */}
        <aside className="w-[360px] bg-[#0b0e14] border-l border-white/[0.07] flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
          <div className="p-3.5 border-b border-white/[0.06] flex items-center justify-between sticky top-0 bg-[#0b0e14]/95 backdrop-blur-md z-10">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-amber-400" />
              <div>
                <h2 className="font-black text-xs uppercase tracking-wider text-white">
                  Inspector Kinetic
                </h2>
                <span className="text-[9px] font-semibold text-gray-500 block leading-tight">
                  HyperFrames & Lujo Visual
                </span>
              </div>
            </div>
            {selectedLine && (
              <button
                onClick={applyStyleToAll}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all border flex items-center gap-1.5 ${
                  showAppliedToast
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 scale-105'
                    : 'text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border-red-500/20'
                }`}
                title="Aplicar tipografía, efecto, tracking y estilo a todas las frases de la canción"
              >
                {showAppliedToast ? (
                  <>
                    <Check size={11} className="text-emerald-400" />
                    <span>¡Aplicado!</span>
                  </>
                ) : (
                  <span>Aplicar a Todas</span>
                )}
              </button>
            )}
          </div>

          {selectedLine ? (
            <div className="p-4 space-y-4">
              {/* 1. Active Phrase Quick Editor & Text Case */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Texto de la Frase
                  </label>
                  <span className="text-[9px] font-mono text-gray-500">
                    {selectedLine.text.length} caracteres
                  </span>
                </div>
                <input
                  type="text"
                  value={selectedLine.text}
                  onChange={(e) => updateLine(selectedLine.id, { text: e.target.value })}
                  className="w-full bg-[#121722] border border-white/10 focus:border-red-500 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none"
                  placeholder="Escribe la letra..."
                />

                {/* Text Case Selector */}
                <div className="flex items-center gap-1 bg-[#121722] p-1 rounded-lg border border-white/[0.06]">
                  {(
                    [
                      { id: 'upper', label: 'MAYÚSCULAS' },
                      { id: 'title', label: 'Título' },
                      { id: 'lower', label: 'minúsculas' },
                    ] as { id: LyricTextCase; label: string }[]
                  ).map((tc) => {
                    const active = (selectedLine.textCase || 'upper') === tc.id;
                    return (
                      <button
                        key={tc.id}
                        type="button"
                        onClick={() => updateLine(selectedLine.id, { textCase: tc.id })}
                        className={`flex-1 py-1 rounded text-[10px] font-bold transition-all ${
                          active
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {tc.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Animation Templates with HyperFrames Filter */}
              <div className="space-y-2.5 pt-3 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Efecto de Animación
                  </label>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                    {LYRIC_EFFECT_PRESETS.length} Efectos
                  </span>
                </div>

                {/* Filter Tabs: Todos | Brutal FX | Clásicos */}
                <div className="flex items-center gap-1 bg-[#121722] p-1 rounded-lg border border-white/[0.06]">
                  {[
                    { id: 'all', label: 'Todos' },
                    { id: 'brutal', label: '🔥 Brutal FX' },
                    { id: 'classic', label: 'Clásicos' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setInspectorEffectFilter(tab.id as any)}
                      className={`flex-1 py-1 rounded text-[10px] font-bold transition-all ${
                        inspectorEffectFilter === tab.id
                          ? 'bg-white/15 text-white shadow-sm'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-[260px] overflow-y-auto custom-scrollbar pr-1">
                  {LYRIC_EFFECT_PRESETS.filter((preset) => {
                    if (inspectorEffectFilter === 'brutal') return preset.group === 'brutal';
                    if (inspectorEffectFilter === 'classic') return preset.group !== 'brutal';
                    return true;
                  }).map((preset) => {
                    const active = selectedLine.effect === preset.id;
                    const isBrutal = preset.group === 'brutal';
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          updateLine(selectedLine.id, {
                            effect: preset.id,
                            accentColor: selectedLine.accentColor || preset.defaultAccent,
                          })
                        }
                        className={`p-2 rounded-xl text-left border transition-all relative overflow-hidden flex flex-col justify-between ${
                          active
                            ? isBrutal
                              ? 'bg-gradient-to-br ' +
                                preset.previewGradient +
                                ' border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.3)] ring-1 ring-amber-400/50'
                              : 'bg-gradient-to-br ' +
                                preset.previewGradient +
                                ' border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.25)] ring-1 ring-red-500/50'
                            : 'bg-[#121722] hover:bg-[#171d2b] border-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1 gap-1">
                          <span
                            className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                              isBrutal
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                : 'bg-black/50 text-red-400 border-white/10'
                            }`}
                          >
                            {preset.badge}
                          </span>
                          {isBrutal && (
                            <span className="text-[8px] text-amber-400 font-bold flex items-center gap-0.5">
                              <Zap size={9} /> HF
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-black text-white leading-tight">
                          {preset.name}
                        </div>
                        <div className="text-[9px] text-gray-400 mt-1 line-clamp-2 leading-snug">
                          {preset.description}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Brutalidad / Intensidad FX Slider */}
                <div className="bg-[#121722] border border-white/[0.06] rounded-xl p-2.5 space-y-1.5 mt-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    <span className="flex items-center gap-1 text-amber-400">
                      <Flame size={12} /> Brutalidad FX
                    </span>
                    <span className="font-mono text-amber-300">
                      {((selectedLine.fxIntensity ?? 1.0) * 100).toFixed(0)}% (
                      {(selectedLine.fxIntensity ?? 1.0).toFixed(1)}x)
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.0}
                    max={2.0}
                    step={0.1}
                    value={selectedLine.fxIntensity ?? 1.0}
                    onChange={(e) =>
                      updateLine(selectedLine.id, { fxIntensity: Number(e.target.value) }, false)
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[8px] text-gray-500 font-semibold">
                    <span>Sutil (0x)</span>
                    <span>Normal (1.0x)</span>
                    <span>Extremo (2.0x)</span>
                  </div>
                </div>
              </div>

              {/* 3. Luxury Typography Catalog & Visual Picker */}
              <div className="space-y-2.5 pt-3 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                    <Type size={12} className="text-red-400" /> Tipografía de Escenario
                  </label>
                  <span className="text-[9px] font-mono text-gray-500">
                    {LYRIC_FONT_PRESETS.length} Familias
                  </span>
                </div>

                {/* Category Tabs: Todas | Impacto | Lujo | Tech | Script */}
                <div className="flex items-center gap-1 bg-[#121722] p-1 rounded-lg border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setInspectorFontCategory('all')}
                    className={`flex-1 py-1 rounded text-[9px] font-bold transition-all ${
                      inspectorFontCategory === 'all'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Todas
                  </button>
                  {LYRIC_FONT_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setInspectorFontCategory(cat.id)}
                      className={`flex-1 py-1 rounded text-[9px] font-bold transition-all ${
                        inspectorFontCategory === cat.id
                          ? 'bg-red-600 text-white shadow-sm'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Visual Font List / Cards */}
                <div className="space-y-1.5 max-h-[240px] overflow-y-auto custom-scrollbar pr-1">
                  {LYRIC_FONT_PRESETS.filter((font) => {
                    if (inspectorFontCategory === 'all') return true;
                    return font.category === inspectorFontCategory;
                  }).map((font) => {
                    const active = selectedLine.fontFamily === font.id;
                    return (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => {
                          const updates: Partial<LyricLine> = { fontFamily: font.id };
                          if (
                            font.tracking !== undefined &&
                            selectedLine.letterSpacing === undefined
                          ) {
                            updates.letterSpacing = font.tracking;
                          }
                          if (font.defaultCase && selectedLine.textCase === undefined) {
                            updates.textCase = font.defaultCase;
                          }
                          updateLine(selectedLine.id, updates);
                        }}
                        className={`w-full p-2 rounded-xl text-left border transition-all flex items-center justify-between ${
                          active
                            ? 'bg-red-600/15 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.2)] ring-1 ring-red-500/50'
                            : 'bg-[#121722] hover:bg-[#171d2b] border-white/[0.06]'
                        }`}
                      >
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] font-black text-white truncate">
                              {font.label}
                            </span>
                            <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-white/5 text-gray-400 border border-white/10 uppercase">
                              {font.category}
                            </span>
                          </div>
                          <div
                            className="text-sm truncate text-gray-200"
                            style={{
                              fontFamily: font.cssStack,
                              fontWeight: font.weight,
                              fontStyle: font.italic ? 'italic' : 'normal',
                            }}
                          >
                            TANDU GLORIA
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-[9px] font-mono text-gray-500 block">
                            {font.weight} {font.italic ? 'Italic' : ''}
                          </span>
                          {active && (
                            <span className="inline-block w-2 h-2 rounded-full bg-red-500 mt-1" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Optical Adjustments: Size, Tracking, Stroke, Ghost */}
              <div className="space-y-3 pt-3 border-t border-white/[0.06]">
                {/* Size */}
                <div>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    <span>Tamaño en Lienzo</span>
                    <span className="text-red-400 font-mono">{selectedLine.fontSize || 108}px</span>
                  </div>
                  <input
                    type="range"
                    min={54}
                    max={170}
                    value={selectedLine.fontSize || 108}
                    onChange={(e) =>
                      updateLine(selectedLine.id, { fontSize: Number(e.target.value) }, false)
                    }
                    className="w-full accent-red-500 cursor-pointer"
                  />
                </div>

                {/* Letter-spacing / Tracking */}
                <div>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    <span>Tracking / Espaciado</span>
                    <span className="text-cyan-400 font-mono">
                      {((selectedLine.letterSpacing ?? 0) * 100).toFixed(0)}% (
                      {(selectedLine.letterSpacing ?? 0).toFixed(2)}em)
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-0.05}
                    max={0.2}
                    step={0.01}
                    value={selectedLine.letterSpacing ?? 0}
                    onChange={(e) =>
                      updateLine(selectedLine.id, { letterSpacing: Number(e.target.value) }, false)
                    }
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[8px] text-gray-500 font-semibold">
                    <span>Condensado (-0.05em)</span>
                    <span>Normal</span>
                    <span>Expandido (+0.20em)</span>
                  </div>
                </div>

                {/* Stroke Width / Outline */}
                <div>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    <span>Contorno / Trazo Exterior</span>
                    <span className="text-amber-400 font-mono">
                      {selectedLine.strokeWidth || 0}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    step={0.5}
                    value={selectedLine.strokeWidth || 0}
                    onChange={(e) =>
                      updateLine(selectedLine.id, { strokeWidth: Number(e.target.value) }, false)
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                {/* Background Ghost Text Switch */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#121722] border border-white/[0.06]">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-white flex items-center gap-1.5">
                      <Layers size={12} className="text-cyan-400" /> Texto Fantasma
                    </div>
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      Palabra gigante en fondo (6.5% drift)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateLine(selectedLine.id, { ghostText: !selectedLine.ghostText })
                    }
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all border ${
                      selectedLine.ghostText
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                        : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                    }`}
                  >
                    {selectedLine.ghostText ? 'ACTIVADO' : 'OFF'}
                  </button>
                </div>
              </div>

              {/* 5. Stage Color Swatches */}
              <div className="space-y-2.5 pt-3 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Color de Resaltado / Escenario
                  </label>
                  <span className="text-[9px] font-mono text-gray-500">
                    {selectedLine.accentColor || '#ef4444'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { color: '#ef4444', label: 'Stage Red' },
                    { color: '#ffffff', label: 'Pure White' },
                    { color: '#d4af37', label: 'Oro Escenario' },
                    { color: '#e5e7eb', label: 'Plata Cromo' },
                    { color: '#f59e0b', label: 'Gold Amber' },
                    { color: '#06b6d4', label: 'Cyan Neon' },
                    { color: '#10b981', label: 'Emerald' },
                    { color: '#ec4899', label: 'Rose Pink' },
                  ].map((sw) => (
                    <button
                      key={sw.color}
                      type="button"
                      onClick={() => updateLine(selectedLine.id, { accentColor: sw.color })}
                      className={`w-7 h-7 rounded-lg border-2 transition-transform relative ${
                        (selectedLine.accentColor || '#ef4444').toLowerCase() ===
                        sw.color.toLowerCase()
                          ? 'border-white scale-110 shadow-[0_0_12px_rgba(255,255,255,0.4)]'
                          : 'border-white/15 hover:scale-105'
                      }`}
                      style={{ backgroundColor: sw.color }}
                      title={sw.label}
                    />
                  ))}
                  {/* Custom Color Input */}
                  <label
                    className="w-7 h-7 rounded-lg border-2 border-white/15 hover:border-white/40 cursor-pointer overflow-hidden flex items-center justify-center bg-[#121722] hover:scale-105 transition-transform"
                    title="Color Personalizado"
                  >
                    <input
                      type="color"
                      value={selectedLine.accentColor || '#ef4444'}
                      onChange={(e) =>
                        updateLine(selectedLine.id, { accentColor: e.target.value })
                      }
                      className="opacity-0 w-0 h-0"
                    />
                    <Sparkles size={12} className="text-gray-300" />
                  </label>
                </div>
              </div>

              {/* 6. Word-by-Word Cadence Breakdown */}
              <div className="space-y-2 pt-3 border-t border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Palabras Sincronizadas ({(selectedLine.words || []).length})
                  </span>
                  <button
                    onClick={() => handleSplitLine(selectedLine)}
                    className="text-[10px] text-red-400 hover:text-red-300 font-bold flex items-center gap-1"
                  >
                    <Scissors size={11} /> Dividir Frase
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {computeWordTimings(
                    selectedLine.text,
                    selectedLine.durationMs,
                    selectedLine.words
                  ).map((w, idx) => (
                    <div
                      key={idx}
                      className="px-2 py-1 rounded-lg bg-[#121722] border border-white/[0.07] text-[10px] flex items-center gap-1.5"
                    >
                      <span className="font-bold text-white">{w.word}</span>
                      <span className="font-mono text-gray-500">
                        {(w.durationMs / 1000).toFixed(2)}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500 text-xs">
              Selecciona una píldora de letra o un clip en la línea de tiempo para personalizar su
              plantilla y estilo.
            </div>
          )}
        </aside>
      </div>

      {/* 3. BOTTOM CAPCUT MULTI-TRACK MAGNETIC TIMELINE DOCK */}
      <section className="h-[255px] bg-[#090c12] border-t border-white/10 flex flex-col shrink-0 select-none">
        {/* Timeline Action Toolbar */}
        <div className="h-10 bg-[#0d111a] border-b border-white/[0.06] px-4 flex items-center justify-between shrink-0">
          {/* Left Timeline Tools */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSnapEnabled((v) => !v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-all ${
                snapEnabled
                  ? 'bg-red-600/20 text-red-300 border-red-500/40'
                  : 'bg-white/[0.04] text-gray-400 border-white/10'
              }`}
              title="Imán automático a los pulsos de la canción (Mantén Alt al arrastrar para desactivar temporalmente)"
            >
              <Magnet size={13} className={snapEnabled ? 'text-red-400' : ''} />
              <span>Imán al Pulso (Beat Snap)</span>
            </button>

            <div className="h-4 w-px bg-white/10 mx-1" />

            <button
              onClick={handleSplitAtPlayhead}
              disabled={!selectedLine}
              className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/10 disabled:opacity-35 text-xs font-semibold text-gray-200 flex items-center gap-1.5 transition-colors"
              title="Dividir frase en dos (Atajo: Tecla S)"
            >
              <Scissors size={13} />
              <span>Dividir (S)</span>
            </button>

            <button
              onClick={handleDuplicateSelected}
              disabled={!selectedLine}
              className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/10 disabled:opacity-35 text-xs font-semibold text-gray-200 flex items-center gap-1.5 transition-colors"
              title="Duplicar clip seleccionado"
            >
              <Copy size={13} />
              <span>Duplicar</span>
            </button>

            <button
              onClick={() => selectedLineId && removeLine(selectedLineId)}
              disabled={!selectedLineId}
              className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-red-500/20 hover:text-red-300 disabled:opacity-35 text-xs font-semibold text-gray-300 flex items-center gap-1.5 transition-colors"
              title="Eliminar clip (Supr)"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Center Hint */}
          <div className="text-[11px] text-gray-400 hidden xl:flex items-center gap-2">
            <span>
              💡 <strong className="text-white">Arrastra píldoras</strong> desde la bandeja hacia la línea de tiempo o{' '}
              <strong className="text-white">estira los bordes</strong> de cada bloque sobre la onda vocal.
            </span>
          </div>

          {/* Right Zoom Slider */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPxPerSec((z) => Math.max(25, z - 20))}
              className="p-1 text-gray-400 hover:text-white"
              title="Alejar línea de tiempo"
            >
              <ZoomOut size={14} />
            </button>
            <input
              type="range"
              min={25}
              max={220}
              value={pxPerSec}
              onChange={(e) => setPxPerSec(Number(e.target.value))}
              className="w-28 accent-red-500 cursor-pointer"
            />
            <button
              onClick={() => setPxPerSec((z) => Math.min(220, z + 20))}
              className="p-1 text-gray-400 hover:text-white"
              title="Acercar línea de tiempo"
            >
              <ZoomIn size={14} />
            </button>
            <span className="text-[10px] font-mono text-gray-400 w-12 text-right">
              {pxPerSec}px/s
            </span>
          </div>
        </div>

        {/* Multi-Track Scrollable Timeline Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Fixed Track Headers Column */}
          <div className="w-[140px] bg-[#0b0e14] border-r border-white/[0.07] flex flex-col shrink-0 z-20">
            <div className="h-7 border-b border-white/[0.06] px-3 flex items-center text-[9px] font-bold uppercase tracking-widest text-gray-500">
              Compases / Secciones
            </div>
            <div className="h-[88px] border-b border-white/[0.06] px-3 flex flex-col justify-center">
              <div className="text-[11px] font-extrabold text-white flex items-center gap-1.5">
                <Type size={12} className="text-red-500" />
                <span>Pista Lyrics</span>
              </div>
              <span className="text-[9px] text-gray-500 mt-0.5">Drag & Trim</span>
            </div>
            <div className="flex-1 px-3 flex flex-col justify-center">
              <div className="text-[11px] font-extrabold text-gray-300 flex items-center gap-1.5">
                <Music size={12} className="text-red-400" />
                <span>Onda Audio</span>
              </div>
              <span className="text-[9px] text-gray-500 mt-0.5 truncate">
                {audioSources.find((s) => s.url === selectedAudioUrl)?.label || 'Referencia BPM'}
              </span>
            </div>
          </div>

          {/* Scrollable Tracks Canvas Area */}
          <div
            ref={timelineScrollRef}
            className="flex-1 relative overflow-x-auto overflow-y-hidden custom-scrollbar bg-[#07090e]"
            onDragOver={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const mouseX = e.clientX - rect.left + e.currentTarget.scrollLeft;
              const rawMs = (mouseX / pxPerSec) * 1000;
              const snapped = getSnappedTime(rawMs, draggingPoolLineId || undefined);
              setDropPreviewMs(snapped.timeMs);
            }}
            onDragLeave={() => setDropPreviewMs(null)}
            onDrop={(e) => {
              e.preventDefault();
              const droppedId = e.dataTransfer.getData('text/plain') || draggingPoolLineId;
              const rect = e.currentTarget.getBoundingClientRect();
              const mouseX = e.clientX - rect.left + e.currentTarget.scrollLeft;
              const rawMs = (mouseX / pxPerSec) * 1000;
              if (droppedId) {
                placePillAtTime(droppedId, rawMs);
              }
              setDropPreviewMs(null);
              setDraggingPoolLineId(null);
            }}
          >
            <div className="relative h-full" style={{ width: timelineWidthPx }}>
              {/* Vertical Beat & Downbeat Grid Lines */}
              {beatMarkers.map((bm, i) => {
                if (!bm.isDownbeat && pxPerSec < 55) return null;
                const leftPx = (bm.timeMs / 1000) * pxPerSec;
                return (
                  <div
                    key={i}
                    className={`absolute top-0 bottom-0 pointer-events-none ${
                      bm.isDownbeat ? 'border-l border-white/[0.11]' : 'border-l border-white/[0.03]'
                    }`}
                    style={{ left: leftPx }}
                  />
                );
              })}

              {/* TRACK 1: RULER (BARS, TIME, SONG SECTIONS & CHORDS) */}
              <div
                className="h-7 bg-[#0c1018] border-b border-white/[0.07] relative cursor-pointer"
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  seekToMs((clickX / pxPerSec) * 1000);
                }}
              >
                {beatMarkers
                  .filter((m) => m.isDownbeat)
                  .map((m) => (
                    <span
                      key={m.bar}
                      className="absolute top-1.5 text-[9px] font-mono font-bold text-gray-500 pointer-events-none pl-1.5"
                      style={{ left: (m.timeMs / 1000) * pxPerSec }}
                    >
                      Compás {m.bar} · {formatTimecode(m.timeMs)}
                    </span>
                  ))}

                {/* Song Section Markers from prompter_data */}
                {songSections.map((sec, i) => (
                  <div
                    key={i}
                    className="absolute top-0.5 px-2 py-0.5 rounded bg-red-600/30 border border-red-500/50 text-[9px] font-black uppercase text-red-200 pointer-events-none"
                    style={{ left: sec.startTime * pxPerSec }}
                  >
                    {sec.name}
                  </div>
                ))}

                {/* Chord Markers from prompter_data */}
                {songChords.slice(0, 120).map((ch, i) => (
                  <span
                    key={i}
                    className="absolute bottom-0.5 text-[9px] font-mono font-bold text-amber-400/80 pointer-events-none"
                    style={{ left: ch.time * pxPerSec + 2 }}
                  >
                    {ch.chord}
                  </span>
                ))}
              </div>

              {/* TRACK 2: CAPCUT INTERACTIVE LYRIC CLIPS TRACK */}
              <div
                className="h-[88px] border-b border-white/[0.06] relative bg-[#080b11]"
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget && e.button === 0) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    seekToMs((clickX / pxPerSec) * 1000);
                  }
                }}
                onDoubleClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const snapped = getSnappedTime((clickX / pxPerSec) * 1000);
                  const newLine: LyricLine = {
                    id: `dbl-${Date.now()}`,
                    text: 'NUEVA LETRA',
                    placed: true,
                    startMs: snapped.timeMs,
                    durationMs: 2500,
                    effect: 'capcut-karaoke',
                    fontFamily: 'Montserrat',
                    fontSize: 108,
                    positionX: 0.5,
                    positionY: 0.5,
                    primaryColor: '#ffffff',
                    accentColor: '#ef4444',
                    words: computeWordTimings('NUEVA LETRA', 2500),
                  };
                  commitLyrics((prev) => [...prev, newLine]);
                  setSelectedLineId(newLine.id);
                }}
              >
                {/* Drop Ghost Preview when dragging a pill from the left pool */}
                {dropPreviewMs !== null && (
                  <div
                    className="absolute top-2 bottom-2 rounded-xl bg-red-500/25 border-2 border-dashed border-red-500 z-30 pointer-events-none flex items-center justify-center px-3"
                    style={{
                      left: (dropPreviewMs / 1000) * pxPerSec,
                      width: Math.max(70, 2.6 * pxPerSec),
                    }}
                  >
                    <span className="text-[10px] font-black text-red-200 uppercase tracking-wider truncate">
                      Soltar en {formatTimecode(dropPreviewMs)}
                    </span>
                  </div>
                )}

                {/* Placed Lyric Clips */}
                {lyrics
                  .filter((l) => l.placed !== false)
                  .sort((a, b) => a.startMs - b.startMs)
                  .map((line, idx) => {
                    const leftPx = (line.startMs / 1000) * pxPerSec;
                    const widthPx = Math.max(28, (line.durationMs / 1000) * pxPerSec);
                    const isSelected = line.id === selectedLineId;
                    const isPlayingNow =
                      currentTimeMs >= line.startMs &&
                      currentTimeMs <= line.startMs + line.durationMs;
                    const lane = idx % 2;

                    return (
                      <div
                        key={line.id}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedLineId(line.id);
                          setHistoryPast((h) => [...h.slice(-29), lyricsRef.current]);
                          setHistoryFuture([]);
                          clipDragRef.current = {
                            mode: 'move',
                            lineId: line.id,
                            initialMouseX: e.clientX,
                            initialStartMs: line.startMs,
                            initialDurationMs: line.durationMs,
                          };
                        }}
                        className={`group absolute h-9 rounded-lg flex items-center select-none cursor-grab active:cursor-grabbing transition-shadow ${
                          isSelected
                            ? 'bg-gradient-to-r from-red-600 to-rose-600 text-white ring-2 ring-white shadow-[0_4px_20px_rgba(239,68,68,0.45)] z-20'
                            : isPlayingNow
                            ? 'bg-red-600/80 text-white border border-red-400 z-10'
                            : 'bg-[#1a2130] hover:bg-[#232c40] text-gray-100 border border-white/15 z-10'
                        }`}
                        style={{
                          left: leftPx,
                          width: widthPx,
                          top: lane === 0 ? 8 : 46,
                        }}
                      >
                        {/* Left Resize Trim Handle */}
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setSelectedLineId(line.id);
                            setHistoryPast((h) => [...h.slice(-29), lyricsRef.current]);
                            setHistoryFuture([]);
                            clipDragRef.current = {
                              mode: 'trim-left',
                              lineId: line.id,
                              initialMouseX: e.clientX,
                              initialStartMs: line.startMs,
                              initialDurationMs: line.durationMs,
                            };
                          }}
                          className="w-2.5 h-full cursor-ew-resize flex items-center justify-center rounded-l-lg bg-black/25 hover:bg-white/40 transition-colors shrink-0"
                          title="Arrastrar borde izquierdo para ajustar inicio"
                        >
                          <div className="w-0.5 h-4 bg-white/60 rounded-full" />
                        </div>

                        {/* Clip Content & Word Divisions */}
                        <div className="flex-1 px-2 overflow-hidden flex flex-col justify-center pointer-events-none">
                          <span className="text-[11px] font-extrabold tracking-wide whitespace-nowrap truncate">
                            {line.text}
                          </span>
                          <span className="text-[8px] font-mono opacity-75 truncate">
                            {line.effect} · {(line.durationMs / 1000).toFixed(1)}s
                          </span>
                        </div>

                        {/* Right Resize Trim Handle */}
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setSelectedLineId(line.id);
                            setHistoryPast((h) => [...h.slice(-29), lyricsRef.current]);
                            setHistoryFuture([]);
                            clipDragRef.current = {
                              mode: 'trim-right',
                              lineId: line.id,
                              initialMouseX: e.clientX,
                              initialStartMs: line.startMs,
                              initialDurationMs: line.durationMs,
                            };
                          }}
                          className="w-2.5 h-full cursor-ew-resize flex items-center justify-center rounded-r-lg bg-black/25 hover:bg-white/40 transition-colors shrink-0"
                          title="Arrastrar borde derecho para estirar o acortar duración"
                        >
                          <div className="w-0.5 h-4 bg-white/60 rounded-full" />
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* TRACK 3: REAL AUDIO WAVEFORM TRACK */}
              <div
                className="h-[76px] relative cursor-pointer flex items-center"
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  seekToMs((clickX / pxPerSec) * 1000);
                }}
              >
                <canvas
                  ref={waveformCanvasRef}
                  className="w-full h-full pointer-events-none"
                />
              </div>

              {/* Active Magnetic Snap Line Indicator */}
              {activeSnapMs !== null && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-[0_0_12px_#fbbf24] z-30 pointer-events-none"
                  style={{ left: (activeSnapMs / 1000) * pxPerSec }}
                />
              )}

              {/* RED STAGE PLAYHEAD */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-40 pointer-events-none shadow-[0_0_12px_#ef4444]"
                style={{ left: (currentTimeMs / 1000) * pxPerSec }}
              >
                <div className="w-3.5 h-3.5 bg-red-500 rotate-45 -ml-[6px] -mt-1 rounded-xs shadow-[0_0_10px_#ef4444]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* REPLICATE WHISPERX TOKEN MODAL */}
      {showTokenModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#0b0e14] border border-white/10 rounded-2xl p-7 max-w-md w-full shadow-2xl relative">
            <h3 className="text-lg font-bold text-white mb-1">
              Sincronización IA con WhisperX
            </h3>
            <p className="text-gray-400 text-xs mb-5 leading-relaxed">
              Ingresa tu token de Replicate para alinear las palabras automáticamente sobre la pista de voz.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                  Replicate API Token (r8_...)
                </label>
                <input
                  type="password"
                  value={replicateKey}
                  onChange={(e) => setReplicateKey(e.target.value)}
                  placeholder="r8_..."
                  className="w-full bg-[#121722] border border-white/10 rounded-xl p-3 text-xs text-white outline-none focus:border-red-500 transition-colors"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowTokenModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl font-bold text-xs bg-white/5 hover:bg-white/10 text-white transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (replicateKey) {
                      localStorage.setItem('replicate_api_key', replicateKey);
                      setShowTokenModal(false);
                      handleAutoDetect();
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl font-bold text-xs bg-red-600 hover:bg-red-500 text-white transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                >
                  Guardar y Sincronizar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
