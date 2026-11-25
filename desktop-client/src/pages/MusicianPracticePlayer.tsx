import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  CloudDownload,
  Disc3,
  Headphones,
  ListMusic,
  Loader2,
  Lock,
  Music,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Search,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sliders,
  Smartphone,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isAdminUser } from '../services/userManagementService';
import {
  resolveEffectivePlaybackBounds,
  resolveEffectivePreRoll,
  resolveLyricsTimeMapping,
} from '../utils/cueEngine';
import {
  type LocalMp3TrackMeta,
  type PracticeCatalogSnapshot,
  type PracticeSetlistSummary,
  type PracticeSongItem,
  checkMusicianOfflineLease,
  ensureSongMp3CachedInDevice,
  evaluateSongVaultState,
  formatBytesCompact,
  isMobileOrTabletDevice,
  readCachedPracticeCatalog,
  readDecryptedTrackArrayBuffer,
  readLocalVaultSummary,
  removeSongFromLocalVault,
  renewMusicianOfflineLease,
  requestPersistentDeviceStorage,
  syncPracticeCatalogFromSupabase,
  wipeAudioArrayBufferInRam,
} from '../services/musicianLocalAudioVault';
import './MusicianPracticePlayer.css';

const ALL_SONGS_FILTER_ID = '__all_live_songs__';
const ACTIVE_PRACTICE_SETLIST_KEY = 'tandu_practice_active_setlist_v1';
const PRACTICE_SKIP_PREROLL_KEY = 'tandu_practice_skip_preroll_v1';

const SPRING_SNAPPY = { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.8 };
const SPRING_GENTLE = { type: 'spring' as const, stiffness: 300, damping: 28 };

interface NormalizedSection {
  index: number;
  label: string;
  musicalTime: number;
  globalStart: number;
  globalEnd: number;
}

function formatTimeDisplay(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const isNeg = sec < -0.05;
  const abs = Math.abs(sec);
  const mins = Math.floor(abs / 60);
  const secs = Math.floor(abs % 60);
  return `${isNeg ? '-' : ''}${mins}:${String(secs).padStart(2, '0')}`;
}

function buildDeterministicBars(seedStr: string, count = 44): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    hash ^= i + 0x9e3779b9;
    hash = Math.imul(hash, 2246822507);
    const norm = ((hash >>> 0) % 100) / 100;
    const envelope = Math.sin((Math.PI * (i + 2)) / (count + 3));
    const height = Math.round(24 + norm * 56 * (0.45 + 0.55 * envelope));
    bars.push(Math.max(20, Math.min(96, height)));
  }
  return bars;
}

/**
 * Genera un micro-WAV de 0.25s de silencio absoluto (0.000 PCM).
 * El elemento <audio> oculto SOLO reproduce este silencio para mantener vivos
 * los controles de pantalla bloqueada / Bluetooth (MediaSession), de modo que
 * cualquier extensión o grabador de DOM que intente descargar <audio src> solo obtenga silencio.
 */
function createSilentKeepAliveWavUrl(): string {
  const sampleRate = 8000;
  const numSamples = 2000; // 0.25s
  const byteLength = 44 + numSamples * 2;
  const buf = new ArrayBuffer(byteLength);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, byteLength - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export default function MusicianPracticePlayer() {
  const { userProfile } = useAuth();
  const isAdmin = useMemo(() => isAdminUser(userProfile), [userProfile]);
  const isMobileOrTablet = useMemo(() => isMobileOrTabletDevice(), []);
  const isDeviceAuthorized = isAdmin || isMobileOrTablet;

  // Online / Offline awareness
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  // Offline 15-day lease state
  const [leaseStatus, setLeaseStatus] = useState(() =>
    checkMusicianOfflineLease(userProfile?.email)
  );

  // Catalog & Vault state
  const [setlists, setSetlists] = useState<PracticeSetlistSummary[]>([]);
  const [setlistSongsMap, setSetlistSongsMap] = useState<Record<string, PracticeSongItem[]>>({});
  const [allLiveSongs, setAllLiveSongs] = useState<PracticeSongItem[]>([]);
  const [selectedSetlistId, setSelectedSetlistId] = useState<string>(() => {
    try {
      return (
        localStorage.getItem(ACTIVE_PRACTICE_SETLIST_KEY) ||
        sessionStorage.getItem('tandu_active_setlist_id') ||
        ''
      );
    } catch {
      return '';
    }
  });

  const [vaultMap, setVaultMap] = useState<Record<string, LocalMp3TrackMeta>>({});
  const [totalBytesUsed, setTotalBytesUsed] = useState<number>(0);
  const [isPersisted, setIsPersisted] = useState<boolean>(false);

  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [syncingCatalog, setSyncingCatalog] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Batch / single sync states
  const [downloadingSongId, setDownloadingSongId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    songTitle: string;
  } | null>(null);
  const [statusToast, setStatusToast] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(
    null
  );

  // Mobile/Tablet Portrait layout switcher ('playlist' | 'player')
  const [mobileTab, setMobileTab] = useState<'playlist' | 'player'>('playlist');
  const [studyPanelTab, setStudyPanelTab] = useState<'sections' | 'chords_lyrics'>('sections');

  // Active playback state
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPreparingAudio, setIsPreparingAudio] = useState<boolean>(false);
  const [prepareStatusText, setPrepareStatusText] = useState<string>('');
  const [globalTime, setGlobalTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Musician practice controls
  const [cueEnabled, setCueEnabled] = useState<boolean>(false);
  const [fohVolume, setFohVolume] = useState<number>(1.0);
  const [cueVolume, setCueVolume] = useState<number>(0.9);
  const [skipPreRoll, setSkipPreRoll] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(PRACTICE_SKIP_PREROLL_KEY);
      return stored === null ? true : stored === '1';
    } catch {
      return true;
    }
  });
  const [repeatMode, setRepeatMode] = useState<'setlist' | 'one'>('setlist');
  const [loopSectionIndex, setLoopSectionIndex] = useState<number | null>(null);

  // Volatile RAM Web Audio Engine + Silent MediaSession Keep-Alive <audio>
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const silentWavUrlRef = useRef<string | null>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const fohGainRef = useRef<GainNode | null>(null);
  const cueGainRef = useRef<GainNode | null>(null);
  const fohSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const cueSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const decodedCacheRef = useRef<{
    songId: string;
    fohBuffer: AudioBuffer;
    cueBuffer: AudioBuffer | null;
  } | null>(null);

  const webStartCtxTimeRef = useRef<number>(0);
  const pauseGlobalTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const cueEnabledRef = useRef<boolean>(false);
  const currentSongRef = useRef<PracticeSongItem | null>(null);
  const loopRangeRef = useRef<{ start: number; end: number } | null>(null);
  const loadTokenRef = useRef<number>(0);
  const batchAbortRef = useRef<AbortController | null>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    cueEnabledRef.current = cueEnabled;
  }, [cueEnabled]);

  // Block Ctrl+S / Cmd+S / Ctrl+U anti-piracy keyboard shortcuts on this view
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'u', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Keep offline lease updated when active user is online (0 extra Supabase queries)
  useEffect(() => {
    if (userProfile?.status === 'active' && isOnline) {
      setLeaseStatus(renewMusicianOfflineLease(userProfile.email));
    } else {
      setLeaseStatus(checkMusicianOfflineLease(userProfile?.email));
    }
  }, [isOnline, userProfile?.email, userProfile?.status]);

  const showNotice = useCallback((kind: 'info' | 'ok' | 'err', text: string) => {
    setStatusToast({ kind, text });
    window.setTimeout(() => {
      setStatusToast((prev) => (prev?.text === text ? null : prev));
    }, kind === 'err' ? 5000 : 3200);
  }, []);

  const applyCatalogSnapshot = useCallback((snap: PracticeCatalogSnapshot | null) => {
    if (!snap) return;
    setSetlists(snap.setlists || []);
    setSetlistSongsMap(snap.setlistSongsMap || {});
    setAllLiveSongs(snap.allLiveSongs || []);

    setSelectedSetlistId((prev) => {
      if (prev === ALL_SONGS_FILTER_ID) return prev;
      if (prev && snap.setlists.some((s) => s.id === prev)) return prev;
      if (snap.setlists.length > 0) return snap.setlists[0].id;
      return ALL_SONGS_FILTER_ID;
    });
  }, []);

  const refreshVaultIndex = useCallback(async () => {
    const summary = await readLocalVaultSummary();
    setVaultMap(summary.tracksBySongId);
    setTotalBytesUsed(summary.totalBytesUsed);
    if (summary.isPersistedStorage !== undefined) {
      setIsPersisted(summary.isPersistedStorage);
    }
    return summary;
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Boot sequence: 1) Local IndexedDB first (<50ms, 0 network), 2) 24h throttled delta catalog sync
  useEffect(() => {
    if (!isDeviceAuthorized) {
      setInitialLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      const [cachedCatalog] = await Promise.all([
        readCachedPracticeCatalog(),
        refreshVaultIndex(),
      ]);

      if (!mounted) return;
      if (cachedCatalog) {
        applyCatalogSnapshot(cachedCatalog);
        setInitialLoading(false);
      }

      requestPersistentDeviceStorage().then((res) => {
        if (mounted && res.persisted) setIsPersisted(true);
      });

      setSyncingCatalog(true);
      // force: false respects 24-hour local cooldown and delta prompter_data fetch
      const remoteSnap = await syncPracticeCatalogFromSupabase({ force: false });
      if (!mounted) return;
      if (remoteSnap) {
        applyCatalogSnapshot(remoteSnap);
      }
      setSyncingCatalog(false);
      setInitialLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [applyCatalogSnapshot, isDeviceAuthorized, refreshVaultIndex]);

  useEffect(() => {
    if (!selectedSetlistId) return;
    try {
      localStorage.setItem(ACTIVE_PRACTICE_SETLIST_KEY, selectedSetlistId);
    } catch {}
  }, [selectedSetlistId]);

  useEffect(() => {
    try {
      localStorage.setItem(PRACTICE_SKIP_PREROLL_KEY, skipPreRoll ? '1' : '0');
    } catch {}
  }, [skipPreRoll]);

  const activeSetlistRawSongs = useMemo<PracticeSongItem[]>(() => {
    if (selectedSetlistId === ALL_SONGS_FILTER_ID || !selectedSetlistId) {
      return allLiveSongs;
    }
    return setlistSongsMap[selectedSetlistId] || [];
  }, [allLiveSongs, selectedSetlistId, setlistSongsMap]);

  const activePlaylist = useMemo<PracticeSongItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeSetlistRawSongs;
    return activeSetlistRawSongs.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [activeSetlistRawSongs, searchQuery]);

  useEffect(() => {
    if (currentSongId && activeSetlistRawSongs.some((s) => s.id === currentSongId)) return;
    if (activeSetlistRawSongs.length === 0) {
      setCurrentSongId(null);
      return;
    }
    if (!isOnline) {
      const firstOffline = activeSetlistRawSongs.find((s) => vaultMap[s.id]?.hasFoh);
      if (firstOffline) {
        setCurrentSongId(firstOffline.id);
        return;
      }
    }
    setCurrentSongId(activeSetlistRawSongs[0].id);
  }, [activeSetlistRawSongs, currentSongId, isOnline, vaultMap]);

  const currentSong = useMemo<PracticeSongItem | null>(() => {
    if (!currentSongId) return null;
    return (
      activeSetlistRawSongs.find((s) => s.id === currentSongId) ||
      allLiveSongs.find((s) => s.id === currentSongId) ||
      null
    );
  }, [activeSetlistRawSongs, allLiveSongs, currentSongId]);

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  const preRollSec = useMemo(() => resolveEffectivePreRoll(currentSong), [currentSong]);
  const visualTime = globalTime - preRollSec;

  const waveformBars = useMemo(
    () => buildDeterministicBars(currentSong?.id || 'tandu-default', 46),
    [currentSong?.id]
  );

  const normalizedSections = useMemo<NormalizedSection[]>(() => {
    const rawSections = Array.isArray(currentSong?.prompter_data?.sections)
      ? currentSong!.prompter_data.sections
      : [];
    if (rawSections.length === 0) return [];

    const sorted = [...rawSections]
      .filter((s: any) => s && Number.isFinite(Number(s.time)))
      .sort((a: any, b: any) => Number(a.time) - Number(b.time));

    const effectiveEnd = duration > 0 ? duration : preRollSec + 300;

    return sorted.map((sec: any, idx: number) => {
      const musTime = Math.max(0, Number(sec.time) || 0);
      const gStart = preRollSec + musTime;
      const nextSec = sorted[idx + 1];
      const gEnd = nextSec
        ? Math.max(gStart + 0.5, preRollSec + Math.max(0, Number(nextSec.time) || 0))
        : effectiveEnd;

      return {
        index: idx,
        label: String(sec.name || sec.section || `Sección ${idx + 1}`),
        musicalTime: musTime,
        globalStart: gStart,
        globalEnd: gEnd,
      };
    });
  }, [currentSong, duration, preRollSec]);

  useEffect(() => {
    if (loopSectionIndex === null || !normalizedSections[loopSectionIndex]) {
      loopRangeRef.current = null;
    } else {
      const target = normalizedSections[loopSectionIndex];
      loopRangeRef.current = { start: target.globalStart, end: target.globalEnd };
    }
  }, [loopSectionIndex, normalizedSections]);

  const activeSectionIndex = useMemo<number>(() => {
    for (let i = normalizedSections.length - 1; i >= 0; i--) {
      if (globalTime + 0.08 >= normalizedSections[i].globalStart) {
        return i;
      }
    }
    return -1;
  }, [globalTime, normalizedSections]);

  const chordsList = useMemo(() => {
    const raw = Array.isArray(currentSong?.prompter_data?.chords)
      ? currentSong!.prompter_data.chords
      : [];
    return [...raw]
      .filter((c: any) => c && c.chord)
      .sort((a: any, b: any) => Number(a.time || 0) - Number(b.time || 0));
  }, [currentSong]);

  const lyricsList = useMemo(() => {
    const raw = Array.isArray(currentSong?.prompter_data?.lyrics)
      ? currentSong!.prompter_data.lyrics
      : [];
    return [...raw]
      .filter((l: any) => l && typeof l.text === 'string' && l.text.trim())
      .sort((a: any, b: any) => Number(a.time || 0) - Number(b.time || 0));
  }, [currentSong]);

  const lyricMapping = useMemo(() => resolveLyricsTimeMapping(currentSong), [currentSong]);
  const currentLyricTime = Math.max(0, visualTime + lyricMapping.lyricReferencePreRollSec);

  const activeChordIndex = useMemo(() => {
    for (let i = chordsList.length - 1; i >= 0; i--) {
      if (visualTime + 0.06 >= Number(chordsList[i].time || 0)) return i;
    }
    return -1;
  }, [chordsList, visualTime]);

  const activeLyricIndex = useMemo(() => {
    for (let i = lyricsList.length - 1; i >= 0; i--) {
      if (currentLyricTime + 0.08 >= Number(lyricsList[i].time || 0)) return i;
    }
    return -1;
  }, [currentLyricTime, lyricsList]);

  const setlistVaultStats = useMemo(() => {
    const playableSongs = activeSetlistRawSongs.filter(
      (s) => evaluateSongVaultState(s, vaultMap[s.id]).status !== 'no_mix'
    );
    const cachedCount = playableSongs.filter((s) => Boolean(vaultMap[s.id]?.hasFoh)).length;
    const pendingSongs = playableSongs.filter((s) => {
      const st = evaluateSongVaultState(s, vaultMap[s.id]);
      return st.status === 'cloud_only' || st.status === 'update_available';
    });
    return {
      playableTotal: playableSongs.length,
      cachedCount,
      pendingSongs,
      allCached: playableSongs.length > 0 && pendingSongs.length === 0,
    };
  }, [activeSetlistRawSongs, vaultMap]);

  // ============================================================================
  // VOLATILE RAM WEB AUDIO ENGINE + SILENT <AUDIO> TRAP (Zero MP3 URLs in DOM)
  // ============================================================================
  const stopWebAudioSources = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try {
      fohSourceRef.current?.stop();
      fohSourceRef.current?.disconnect();
    } catch {}
    try {
      cueSourceRef.current?.stop();
      cueSourceRef.current?.disconnect();
    } catch {}
    fohSourceRef.current = null;
    cueSourceRef.current = null;
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release?.().catch?.(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {}
  }, []);

  const startSilentMediaSessionKeepAlive = useCallback(() => {
    const audioEl = silentAudioRef.current;
    if (!audioEl) return;
    if (!silentWavUrlRef.current) {
      silentWavUrlRef.current = createSilentKeepAliveWavUrl();
    }
    if (audioEl.src !== silentWavUrlRef.current) {
      audioEl.src = silentWavUrlRef.current;
    }
    audioEl.play().catch(() => {});
  }, []);

  const stopSilentMediaSessionKeepAlive = useCallback(() => {
    try {
      silentAudioRef.current?.pause();
    } catch {}
  }, []);

  const stopAllPlayback = useCallback(
    (resetToInitial = false) => {
      stopWebAudioSources();
      stopSilentMediaSessionKeepAlive();
      setIsPlaying(false);
      isPlayingRef.current = false;
      releaseWakeLock();

      if (resetToInitial) {
        const song = currentSongRef.current;
        const pRoll = resolveEffectivePreRoll(song);
        const startOffset = skipPreRoll && !cueEnabledRef.current && pRoll > 0 ? pRoll : 0;
        pauseGlobalTimeRef.current = startOffset;
        setGlobalTime(startOffset);
      }
    },
    [releaseWakeLock, skipPreRoll, stopSilentMediaSessionKeepAlive, stopWebAudioSources]
  );

  useEffect(() => {
    if (fohGainRef.current && webAudioCtxRef.current) {
      fohGainRef.current.gain.setTargetAtTime(
        fohVolume,
        webAudioCtxRef.current.currentTime,
        0.02
      );
    }
  }, [fohVolume]);

  useEffect(() => {
    if (cueGainRef.current && webAudioCtxRef.current) {
      cueGainRef.current.gain.setTargetAtTime(
        cueEnabled ? cueVolume : 0,
        webAudioCtxRef.current.currentTime,
        0.02
      );
    }
  }, [cueEnabled, cueVolume]);

  const ensureWebAudioGraph = useCallback((): AudioContext => {
    if (!webAudioCtxRef.current || webAudioCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const fGain = ctx.createGain();
      const cGain = ctx.createGain();
      fGain.gain.value = fohVolume;
      cGain.gain.value = cueEnabledRef.current ? cueVolume : 0;
      fGain.connect(ctx.destination);
      cGain.connect(ctx.destination);
      webAudioCtxRef.current = ctx;
      fohGainRef.current = fGain;
      cueGainRef.current = cGain;
    }
    if (webAudioCtxRef.current.state === 'suspended') {
      webAudioCtxRef.current.resume().catch(() => {});
    }
    return webAudioCtxRef.current;
  }, [cueVolume, fohVolume]);

  const startWebAudioAtOffset = useCallback(
    (fohBuf: AudioBuffer, cueBuf: AudioBuffer | null, offsetSec: number) => {
      const ctx = ensureWebAudioGraph();
      stopWebAudioSources();
      startSilentMediaSessionKeepAlive();

      const clampedOffset = Math.max(0, Math.min(offsetSec, Math.max(0, fohBuf.duration - 0.05)));
      const startAt = ctx.currentTime + 0.015;

      const fSrc = ctx.createBufferSource();
      fSrc.buffer = fohBuf;
      fSrc.connect(fohGainRef.current!);
      fohSourceRef.current = fSrc;

      if (cueBuf) {
        const cSrc = ctx.createBufferSource();
        cSrc.buffer = cueBuf;
        cSrc.connect(cueGainRef.current!);
        cueSourceRef.current = cSrc;
        cSrc.start(startAt, Math.min(clampedOffset, Math.max(0, cueBuf.duration - 0.02)));
      }

      fSrc.start(startAt, clampedOffset);
      webStartCtxTimeRef.current = startAt - clampedOffset;
      pauseGlobalTimeRef.current = clampedOffset;
      setGlobalTime(clampedOffset);
      setDuration(fohBuf.duration);
      setIsPlaying(true);
      isPlayingRef.current = true;
      void acquireWakeLock();

      const bounds = resolveEffectivePlaybackBounds(currentSongRef.current, fohBuf.duration);

      const tick = () => {
        if (!isPlayingRef.current || !webAudioCtxRef.current) return;
        const elapsed = Math.max(0, webAudioCtxRef.current.currentTime - webStartCtxTimeRef.current);

        const loop = loopRangeRef.current;
        if (loop && elapsed >= loop.end - 0.04) {
          startWebAudioAtOffset(fohBuf, cueBuf, loop.start);
          return;
        }

        if (elapsed >= bounds.autoAdvanceAtGlobalSec || elapsed >= fohBuf.duration - 0.03) {
          handleTrackEndedRef.current();
          return;
        }

        pauseGlobalTimeRef.current = elapsed;
        setGlobalTime(elapsed);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [
      acquireWakeLock,
      ensureWebAudioGraph,
      startSilentMediaSessionKeepAlive,
      stopWebAudioSources,
    ]
  );

  /**
   * Descifra desde IndexedDB hacia un ArrayBuffer efímero, lo decodifica a PCM en AudioContext
   * y BORRA INMEDIATAMENTE con ceros (`fill(0)`) los bytes MP3 descifrados en RAM.
   * Si `needCue === false`, NO descarga el canal Click/Guía (ahorrando 50% de Storage Egress).
   */
  const ensureSongDecodedInVolatileRam = useCallback(
    async (
      song: PracticeSongItem,
      needCue: boolean
    ): Promise<{
      fohBuffer: AudioBuffer;
      cueBuffer: AudioBuffer | null;
    }> => {
      if (!leaseStatus.valid && !isOnline) {
        throw new Error(
          'Tu licencia offline de 15 días expiró. Conéctate un instante a internet para validar tu cuenta activa.'
        );
      }

      // Si ya tenemos el AudioBuffer PCM en RAM para la canción activa, reutilizar sin tocar disco ni red
      const cachedMem = decodedCacheRef.current;
      if (cachedMem && cachedMem.songId === song.id && (!needCue || cachedMem.cueBuffer)) {
        return {
          fohBuffer: cachedMem.fohBuffer,
          cueBuffer: cachedMem.cueBuffer,
        };
      }

      let fohPlainArr = await readDecryptedTrackArrayBuffer(song.id, 'foh');
      let cuePlainArr = needCue ? await readDecryptedTrackArrayBuffer(song.id, 'cue') : null;

      const evalState = evaluateSongVaultState(song, vaultMap[song.id]);
      const mustSyncFoh = !fohPlainArr;
      const mustSyncCue = needCue && !cuePlainArr && evalState.hasCloudCue;

      if (mustSyncFoh || mustSyncCue) {
        if (!isOnline) {
          if (!fohPlainArr) {
            throw new Error(
              'Sin internet y esta pista aún no fue sincronizada en la memoria interna de tu dispositivo.'
            );
          }
        } else {
          await ensureSongMp3CachedInDevice({
            song,
            includeCue: needCue,
            onProgress: (msg) => setPrepareStatusText(msg),
          });
          await refreshVaultIndex();
          if (!fohPlainArr) {
            fohPlainArr = await readDecryptedTrackArrayBuffer(song.id, 'foh');
          }
          if (needCue && !cuePlainArr) {
            cuePlainArr = await readDecryptedTrackArrayBuffer(song.id, 'cue');
          }
        }
      }

      if (!fohPlainArr) {
        throw new Error('No se encontró el audio cifrado de esta canción.');
      }

      setPrepareStatusText('Decodificando en memoria volátil segura...');
      const ctx = ensureWebAudioGraph();

      let fohBuffer: AudioBuffer;
      let cueBuffer: AudioBuffer | null = cachedMem?.songId === song.id ? cachedMem.cueBuffer : null;

      try {
        if (cachedMem && cachedMem.songId === song.id && cachedMem.fohBuffer) {
          fohBuffer = cachedMem.fohBuffer;
        } else {
          const fohCopy = fohPlainArr.slice(0);
          try {
            fohBuffer = await ctx.decodeAudioData(fohCopy);
          } finally {
            wipeAudioArrayBufferInRam(fohCopy);
          }
        }

        if (needCue && cuePlainArr && !cueBuffer) {
          const cueCopy = cuePlainArr.slice(0);
          try {
            cueBuffer = await ctx.decodeAudioData(cueCopy).catch(() => null);
          } finally {
            wipeAudioArrayBufferInRam(cueCopy);
          }
        }
      } finally {
        // Destruir inmediatamente los bytes MP3 descifrados en RAM
        wipeAudioArrayBufferInRam(fohPlainArr);
        wipeAudioArrayBufferInRam(cuePlainArr);
      }

      decodedCacheRef.current = {
        songId: song.id,
        fohBuffer,
        cueBuffer,
      };

      return { fohBuffer, cueBuffer };
    },
    [ensureWebAudioGraph, isOnline, leaseStatus.valid, refreshVaultIndex, vaultMap]
  );

  // Reset track state when selected song changes
  useEffect(() => {
    ++loadTokenRef.current;
    stopAllPlayback(false);
    setLoopSectionIndex(null);

    if (decodedCacheRef.current && decodedCacheRef.current.songId !== currentSong?.id) {
      decodedCacheRef.current = null;
    }

    if (!currentSong) {
      setDuration(0);
      setGlobalTime(0);
      pauseGlobalTimeRef.current = 0;
      return;
    }

    const pRoll = resolveEffectivePreRoll(currentSong);
    const initialOffset = skipPreRoll && !cueEnabledRef.current && pRoll > 0 ? pRoll : 0;
    pauseGlobalTimeRef.current = initialOffset;
    setGlobalTime(initialOffset);

    const metaDur = Number(currentSong?.prompter_data?.liveMixMeta?.totalDurationSec) || 0;
    if (metaDur > 0) setDuration(metaDur);
  }, [currentSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      batchAbortRef.current?.abort();
      stopWebAudioSources();
      stopSilentMediaSessionKeepAlive();
      releaseWakeLock();
      if (silentWavUrlRef.current) {
        URL.revokeObjectURL(silentWavUrlRef.current);
      }
      if (webAudioCtxRef.current && webAudioCtxRef.current.state !== 'closed') {
        webAudioCtxRef.current.close().catch(() => {});
      }
    };
  }, [releaseWakeLock, stopSilentMediaSessionKeepAlive, stopWebAudioSources]);

  const playSong = useCallback(
    async (targetSong?: PracticeSongItem, customStartOffset?: number) => {
      const song = targetSong || currentSongRef.current;
      if (!song) return;

      const token = ++loadTokenRef.current;
      setIsPreparingAudio(true);
      setPrepareStatusText('');

      try {
        const wantCue = cueEnabledRef.current;
        const prepared = await ensureSongDecodedInVolatileRam(song, wantCue);
        if (loadTokenRef.current !== token) return;

        const pRoll = resolveEffectivePreRoll(song);
        const startOffset =
          customStartOffset !== undefined
            ? customStartOffset
            : pauseGlobalTimeRef.current > 0
              ? pauseGlobalTimeRef.current
              : skipPreRoll && !wantCue && pRoll > 0
                ? pRoll
                : 0;

        startWebAudioAtOffset(prepared.fohBuffer, prepared.cueBuffer, startOffset);
      } catch (err: any) {
        showNotice('err', err?.message || 'Error al reproducir la pista.');
      } finally {
        if (loadTokenRef.current === token) {
          setIsPreparingAudio(false);
          setPrepareStatusText('');
        }
      }
    },
    [ensureSongDecodedInVolatileRam, showNotice, skipPreRoll, startWebAudioAtOffset]
  );

  const pauseSong = useCallback(() => {
    if (webAudioCtxRef.current && isPlayingRef.current) {
      const elapsed = Math.max(
        0,
        webAudioCtxRef.current.currentTime - webStartCtxTimeRef.current
      );
      pauseGlobalTimeRef.current = elapsed;
      setGlobalTime(elapsed);
    }
    stopWebAudioSources();
    stopSilentMediaSessionKeepAlive();
    releaseWakeLock();
    setIsPlaying(false);
    isPlayingRef.current = false;
  }, [releaseWakeLock, stopSilentMediaSessionKeepAlive, stopWebAudioSources]);

  const togglePlayPause = useCallback(() => {
    if (isPlayingRef.current) {
      pauseSong();
    } else {
      void playSong();
    }
  }, [pauseSong, playSong]);

  const seekToGlobal = useCallback(
    (nextGlobalSec: number) => {
      const maxDur = duration > 0 ? duration : 600;
      const clamped = Math.max(0, Math.min(nextGlobalSec, maxDur));
      pauseGlobalTimeRef.current = clamped;
      setGlobalTime(clamped);

      if (!isPlayingRef.current) {
        return;
      }

      const cachedDecoded = decodedCacheRef.current;
      if (cachedDecoded && cachedDecoded.songId === currentSongRef.current?.id) {
        startWebAudioAtOffset(cachedDecoded.fohBuffer, cachedDecoded.cueBuffer, clamped);
      }
    },
    [duration, startWebAudioAtOffset]
  );

  const handleSetCueMode = useCallback(
    async (enableCue: boolean, presetVolumes?: { foh: number; cue: number }) => {
      if (presetVolumes) {
        setFohVolume(presetVolumes.foh);
        setCueVolume(presetVolumes.cue);
      }

      const song = currentSongRef.current;
      if (enableCue && song) {
        const evalSt = evaluateSongVaultState(song, vaultMap[song.id]);
        if (!evalSt.hasCloudCue && !evalSt.hasLocalCue) {
          showNotice(
            'info',
            'Esta canción aún no tiene canal de Click/Voz Guía exportado en Live Concert.'
          );
          return;
        }
      }

      const wasPlaying = isPlayingRef.current;
      let resumeAt = pauseGlobalTimeRef.current;
      if (wasPlaying && webAudioCtxRef.current) {
        resumeAt = Math.max(0, webAudioCtxRef.current.currentTime - webStartCtxTimeRef.current);
      } else if (!wasPlaying && enableCue && resumeAt <= resolveEffectivePreRoll(song) + 0.05) {
        resumeAt = 0;
        pauseGlobalTimeRef.current = 0;
        setGlobalTime(0);
      }

      setCueEnabled(enableCue);
      cueEnabledRef.current = enableCue;

      if (wasPlaying && song) {
        const cachedDecoded = decodedCacheRef.current;
        // Si ya tenemos el CUE decodificado en RAM (o si se apaga CUE), el cambio es 0.00ms instantáneo por GainNode!
        if (!enableCue || (cachedDecoded && cachedDecoded.songId === song.id && cachedDecoded.cueBuffer)) {
          if (
            enableCue &&
            !cueSourceRef.current &&
            cachedDecoded &&
            cachedDecoded.songId === song.id
          ) {
            startWebAudioAtOffset(cachedDecoded.fohBuffer, cachedDecoded.cueBuffer, resumeAt);
          }
          return;
        }
        // Primera vez que activa Click/Guía en esta canción -> descarga bajo demanda solo CUE (~1.2 MB)
        pauseSong();
        await playSong(song, resumeAt);
      }
    },
    [pauseSong, playSong, showNotice, startWebAudioAtOffset, vaultMap]
  );

  const selectAndPlaySong = useCallback(
    async (song: PracticeSongItem, autoPlay = true) => {
      const sameSong = currentSongRef.current?.id === song.id;
      if (sameSong) {
        if (autoPlay) togglePlayPause();
        return;
      }

      stopAllPlayback(false);
      setLoopSectionIndex(null);
      setCurrentSongId(song.id);
      currentSongRef.current = song;

      const pRoll = resolveEffectivePreRoll(song);
      const startAt = skipPreRoll && !cueEnabledRef.current && pRoll > 0 ? pRoll : 0;
      pauseGlobalTimeRef.current = startAt;
      setGlobalTime(startAt);

      if (autoPlay) {
        window.setTimeout(() => {
          void playSong(song, startAt);
        }, 20);
      }
    },
    [playSong, skipPreRoll, stopAllPlayback, togglePlayPause]
  );

  const goNextSong = useCallback(
    (autoPlay = true) => {
      if (activeSetlistRawSongs.length === 0) return;
      const idx = activeSetlistRawSongs.findIndex((s) => s.id === currentSongRef.current?.id);
      const nextIdx = idx >= 0 ? (idx + 1) % activeSetlistRawSongs.length : 0;
      const nextSong = activeSetlistRawSongs[nextIdx];
      if (nextSong) {
        void selectAndPlaySong(nextSong, autoPlay);
      }
    },
    [activeSetlistRawSongs, selectAndPlaySong]
  );

  const goPrevSong = useCallback(() => {
    if (globalTime > preRollSec + 3.5) {
      const resetOffset = skipPreRoll && !cueEnabledRef.current && preRollSec > 0 ? preRollSec : 0;
      seekToGlobal(resetOffset);
      return;
    }
    if (activeSetlistRawSongs.length === 0) return;
    const idx = activeSetlistRawSongs.findIndex((s) => s.id === currentSongRef.current?.id);
    const prevIdx = idx > 0 ? idx - 1 : Math.max(0, activeSetlistRawSongs.length - 1);
    const prevSong = activeSetlistRawSongs[prevIdx];
    if (prevSong) {
      void selectAndPlaySong(prevSong, isPlayingRef.current);
    }
  }, [activeSetlistRawSongs, globalTime, preRollSec, seekToGlobal, selectAndPlaySong, skipPreRoll]);

  const handleTrackEndedRef = useRef<() => void>(() => {});
  useEffect(() => {
    handleTrackEndedRef.current = () => {
      const song = currentSongRef.current;
      const pRoll = resolveEffectivePreRoll(song);
      const startAt = skipPreRoll && !cueEnabledRef.current && pRoll > 0 ? pRoll : 0;

      if (repeatMode === 'one' && song) {
        void playSong(song, startAt);
        return;
      }

      const idx = activeSetlistRawSongs.findIndex((s) => s.id === song?.id);
      if (idx >= 0 && idx < activeSetlistRawSongs.length - 1) {
        const nextSong = activeSetlistRawSongs[idx + 1];
        if (!isOnline && !vaultMap[nextSong.id]?.hasFoh) {
          stopAllPlayback(true);
          return;
        }
        void selectAndPlaySong(nextSong, true);
      } else {
        stopAllPlayback(true);
      }
    };
  }, [
    activeSetlistRawSongs,
    isOnline,
    playSong,
    repeatMode,
    selectAndPlaySong,
    skipPreRoll,
    stopAllPlayback,
    vaultMap,
  ]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !currentSong) return;
    try {
      const activeSetlistTitle =
        setlists.find((s) => s.id === selectedSetlistId)?.title || 'Repertorio En Vivo';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: 'TANDU Músicos · Bóveda Cifrada',
        album: activeSetlistTitle,
      });
      navigator.mediaSession.setActionHandler('play', () => void playSong());
      navigator.mediaSession.setActionHandler('pause', () => pauseSong());
      navigator.mediaSession.setActionHandler('previoustrack', () => goPrevSong());
      navigator.mediaSession.setActionHandler('nexttrack', () => goNextSong(true));
    } catch {}
  }, [currentSong, goNextSong, goPrevSong, pauseSong, playSong, selectedSetlistId, setlists]);

  // ============================================================================
  // VAULT ACTIONS (Lazy CUE by default to save 50% Supabase Storage Egress)
  // ============================================================================
  const handleManualSyncCatalog = async () => {
    if (!isOnline) {
      showNotice('info', 'Modo sin internet activo. Usando repertorio cifrado en tu dispositivo.');
      return;
    }
    setSyncingCatalog(true);
    const snap = await syncPracticeCatalogFromSupabase({ force: true });
    if (snap) {
      applyCatalogSnapshot(snap);
      showNotice('ok', 'Repertorio sincronizado con Live Concert.');
    }
    setSyncingCatalog(false);
  };

  const handleSaveSingleSongToDevice = async (
    song: PracticeSongItem,
    forceRefresh = false,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    if (!isOnline) {
      showNotice('err', 'Conéctate una vez a internet para sincronizar esta pista en tu memoria.');
      return;
    }
    if (downloadingSongId) return;

    setDownloadingSongId(song.id);
    try {
      // Lazy CUE: solo descarga CUE si el músico tiene Click activo ahora mismo
      await ensureSongMp3CachedInDevice({
        song,
        includeCue: cueEnabledRef.current,
        forceRefresh,
      });
      if (decodedCacheRef.current?.songId === song.id) {
        decodedCacheRef.current = null;
      }
      await refreshVaultIndex();
      showNotice('ok', `"${song.title}" sincronizada en la bóveda cifrada de tu dispositivo.`);
    } catch (err: any) {
      showNotice('err', err?.message || 'No se pudo sincronizar el audio.');
    } finally {
      setDownloadingSongId(null);
    }
  };

  const handleSaveEntireSetlistOffline = async () => {
    if (!isOnline) {
      showNotice('err', 'Conéctate a Wi-Fi o datos para sincronizar las pistas pendientes.');
      return;
    }
    if (batchProgress) {
      batchAbortRef.current?.abort();
      setBatchProgress(null);
      return;
    }

    const targets = setlistVaultStats.pendingSongs;
    if (targets.length === 0) {
      showNotice('ok', 'Todo el repertorio ya está sincronizado en la bóveda de tu dispositivo.');
      return;
    }

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    let savedOk = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const song = targets[i];
        setBatchProgress({
          current: i + 1,
          total: targets.length,
          songTitle: song.title,
        });

        const st = evaluateSongVaultState(song, vaultMap[song.id]);
        await ensureSongMp3CachedInDevice({
          song,
          includeCue: cueEnabledRef.current,
          forceRefresh: st.status === 'update_available',
          signal: abortController.signal,
        });
        savedOk += 1;
        await refreshVaultIndex();
      }
      showNotice(
        'ok',
        `${savedOk} ${savedOk === 1 ? 'pista sincronizada' : 'pistas sincronizadas'} en memoria cifrada.`
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        showNotice('err', err?.message || 'Sincronización interrumpida.');
      }
    } finally {
      setBatchProgress(null);
      batchAbortRef.current = null;
    }
  };

  const handleRemoveLocalSong = async (song: PracticeSongItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentSongRef.current?.id === song.id && isPlayingRef.current) {
      pauseSong();
    }
    if (decodedCacheRef.current?.songId === song.id) {
      decodedCacheRef.current = null;
    }
    await removeSongFromLocalVault(song.id);
    await refreshVaultIndex();
    showNotice('info', `Se liberó "${song.title}" de la memoria del dispositivo.`);
  };

  // ============================================================================
  // PC / LAPTOP BLOCK SCREEN FOR NON-ADMIN USERS (Anti-Piracy Layer 1)
  // ============================================================================
  if (!isDeviceAuthorized) {
    return (
      <div
        onContextMenu={(e) => e.preventDefault()}
        className="mp-studio-root flex h-full w-full flex-col items-center justify-center p-6 select-none"
      >
        <div className="w-full max-w-lg">
          <div className="mp-console-bezel">
            <div className="mp-console-core p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#e84432]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f2b829]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f5efe4]" />
                  <span className="mp-mono ml-1 text-xs text-[#a39d93]">
                    ~/seguridad/boveda-movil
                  </span>
                </div>
                <span className="mp-gold-tag rounded-full px-3 py-0.5 text-[11px] font-bold">
                  Protección Activa
                </span>
              </div>

              <div className="flex items-center gap-3.5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#e84432] text-[#f5efe4]">
                  <Smartphone size={28} />
                </div>
                <div>
                  <span className="mp-mono text-xs font-bold text-[#f2b829]">
                    &gt; ACCESO EXCLUSIVO MÓVIL Y TABLET
                  </span>
                  <h1 className="mp-display-title text-xl sm:text-2xl uppercase text-[#f5efe4] mt-1">
                    USA TU CELULAR O TABLET
                  </h1>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-[#f5efe4]/85">
                Por políticas de protección contra piratería de las secuencias originales de la
                banda, la sincronización y reproducción en memoria interna está deshabilitada en
                computadoras de escritorio o laptops para cuentas de músico.
              </p>

              <div className="rounded-2xl bg-[#1e1e1c] border border-white/10 p-4 space-y-2 text-xs text-[#a39d93]">
                <div className="flex items-center gap-2 text-[#f2b829] font-bold">
                  <Lock size={14} />
                  <span>¿Cómo ensayar con tus pistas?</span>
                </div>
                <p>
                  Abre la aplicación desde tu <strong>celular (iPhone / Android)</strong> o{' '}
                  <strong>tablet (iPad / Android)</strong> con tu usuario. Las pistas se guardarán
                  cifradas en la memoria interna de tu equipo para escuchar todos los días sin
                  gastar datos y sin exponer archivos descargables.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // DERIVED UI METRICS
  // ============================================================================
  const currentVaultEval = evaluateSongVaultState(
    currentSong,
    currentSong ? vaultMap[currentSong.id] : undefined
  );
  const currentBpm = currentSong?.prompter_data?.bpm
    ? Math.round(Number(currentSong.prompter_data.bpm))
    : null;
  const currentKey = currentSong?.prompter_data?.key || null;
  const currentTimeSig = currentSong?.prompter_data?.timeSignature || '4/4';
  const progressRatio = duration > 0 ? Math.max(0, Math.min(1, globalTime / duration)) : 0;
  const activeSetlistName =
    selectedSetlistId === ALL_SONGS_FILTER_ID
      ? 'Catálogo Completo'
      : setlists.find((s) => s.id === selectedSetlistId)?.title || 'Setlist En Vivo';

  const activeModeKey: 'music' | 'both' | 'click' = !cueEnabled
    ? 'music'
    : fohVolume <= 0.05
      ? 'click'
      : 'both';

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="mp-studio-root flex h-full w-full flex-col select-none overflow-hidden"
    >
      {/* Hidden <audio> ONLY plays 0.25s of synthetic 0.000 silence to sustain lock-screen MediaSession */}
      <audio
        ref={silentAudioRef}
        loop
        playsInline
        controlsList="nodownload noplaybackrate"
        className="hidden"
      />

      {/* =====================================================================
          POSTER MASTHEAD (Vermilion Stage + Carbon Ink Pills + Solar Gold Tags)
      ====================================================================== */}
      <header className="mp-vermilion-stage shrink-0 border-b-2 border-[#111110]/15 px-4 pt-3.5 pb-3 sm:px-6 sm:pt-4 sm:pb-4">
        <div className="mx-auto max-w-[1560px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Title Lockup */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="mp-ink-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-tight">
                  <Lock size={11} className="text-[#f2b829]" />
                  <span>BÓVEDA CIFRADA</span>
                  <span className="text-[#f2b829] mp-mono">
                    {formatBytesCompact(totalBytesUsed)}
                  </span>
                </span>

                {isPersisted && (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[#111110]/12 px-2.5 py-0.5 text-[11px] font-bold text-[#111110]">
                    <ShieldCheck size={12} strokeWidth={2.3} />
                    <span>AES-256 · Sin archivo extraíble</span>
                  </span>
                )}

                {!isOnline && (
                  <span className="mp-ink-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-[#f2b829]">
                    <WifiOff size={12} />
                    <span>Offline ({leaseStatus.daysRemaining}d vigencia)</span>
                  </span>
                )}
              </div>

              <h1 className="mp-display-title text-2xl sm:text-3xl md:text-[34px] uppercase text-[#111110] truncate">
                ESTUDIO DE PRÁCTICA
              </h1>
            </div>

            {/* Right Controls: Setlist Picker + Batch Vault Sync Island CTA */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-1.5 flex-1 sm:flex-initial min-w-[190px]">
                <select
                  value={selectedSetlistId}
                  onChange={(e) => setSelectedSetlistId(e.target.value)}
                  aria-label="Seleccionar repertorio de Live Concert"
                  className="w-full sm:w-56 h-11 rounded-full bg-[#f5efe4] border-2 border-[#111110] px-4 text-xs font-bold text-[#111110] shadow-[0_3px_0_#111110] cursor-pointer"
                >
                  {setlists.map((sl) => (
                    <option key={sl.id} value={sl.id}>
                      Show: {sl.title}
                    </option>
                  ))}
                  <option value={ALL_SONGS_FILTER_ID}>
                    Todas las pistas ({allLiveSongs.length})
                  </option>
                </select>

                <button
                  type="button"
                  onClick={handleManualSyncCatalog}
                  disabled={syncingCatalog}
                  title="Sincronizar repertorio con Live Concert"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f5efe4] border-2 border-[#111110] text-[#111110] shadow-[0_3px_0_#111110] active:translate-y-[2px] active:shadow-none transition-transform cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={15} strokeWidth={2.2} className={syncingCatalog ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Island Button-in-Button CTA for Encrypted Local Vault Sync */}
              {setlistVaultStats.playableTotal > 0 && (
                <button
                  type="button"
                  onClick={handleSaveEntireSetlistOffline}
                  disabled={!isOnline && !batchProgress}
                  className="group flex h-11 items-center gap-2.5 rounded-full bg-[#111110] pl-4 pr-1.5 text-xs font-bold text-[#f5efe4] shadow-[0_4px_12px_rgba(17,17,16,0.28)] active:scale-[0.98] transition-transform cursor-pointer disabled:opacity-45"
                >
                  {batchProgress ? (
                    <>
                      <span className="mp-mono">
                        Sincronizando {batchProgress.current}/{batchProgress.total}
                      </span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f2b829] text-[#111110]">
                        <Loader2 size={14} className="animate-spin" />
                      </span>
                    </>
                  ) : setlistVaultStats.allCached ? (
                    <>
                      <span>
                        En Bóveda ({setlistVaultStats.cachedCount}/{setlistVaultStats.playableTotal})
                      </span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f2b829] text-[#111110]">
                        <Check size={15} strokeWidth={2.6} />
                      </span>
                    </>
                  ) : (
                    <>
                      <span>Sincronizar {setlistVaultStats.pendingSongs.length} en Memoria</span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f2b829] text-[#111110] transition-transform duration-200 group-hover:scale-105">
                        <CloudDownload size={15} strokeWidth={2.3} />
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Mobile & Tablet Portrait Segmented Switcher (< lg) */}
          <div className="mt-3 flex lg:hidden rounded-full bg-[#111110]/15 p-1">
            <button
              type="button"
              onClick={() => setMobileTab('playlist')}
              className={`relative flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                mobileTab === 'playlist' ? 'text-[#f5efe4]' : 'text-[#111110]/85'
              }`}
            >
              {mobileTab === 'playlist' && (
                <motion.span
                  layoutId="mpMobileTabPill"
                  transition={SPRING_SNAPPY}
                  className="absolute inset-0 rounded-full bg-[#111110]"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <ListMusic size={15} />
                <span>Repertorio ({activePlaylist.length})</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMobileTab('player')}
              className={`relative flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                mobileTab === 'player' ? 'text-[#f5efe4]' : 'text-[#111110]/85'
              }`}
            >
              {mobileTab === 'player' && (
                <motion.span
                  layoutId="mpMobileTabPill"
                  transition={SPRING_SNAPPY}
                  className="absolute inset-0 rounded-full bg-[#111110]"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Sliders size={15} />
                <span>Consola · Click & Guía</span>
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Contextual Notice Strip */}
      <AnimatePresence>
        {statusToast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING_GENTLE}
            className={`shrink-0 px-4 py-2 text-center text-xs font-bold border-b ${
              statusToast.kind === 'err'
                ? 'bg-[#111110] text-[#e84432] border-[#e84432]/40'
                : 'bg-[#111110] text-[#f2b829] border-[#f2b829]/30'
            }`}
          >
            {statusToast.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          ASYMMETRIC EDITORIAL WORKSPACE
      ====================================================================== */}
      <div className="mx-auto flex flex-1 w-full max-w-[1560px] min-h-0 overflow-hidden lg:grid lg:grid-cols-12">
        {/* LEFT COLUMN: Warm Alabaster Repertorio Sheet */}
        <section
          className={`${
            mobileTab === 'playlist' ? 'flex' : 'hidden'
          } lg:flex lg:col-span-5 xl:col-span-4 flex-col w-full min-h-0 border-r border-[#d8ccb8] bg-[#f5efe4]`}
        >
          {/* Search Bar */}
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-[#dfd4c3]">
            <label htmlFor="mp-song-search" className="sr-only">
              Buscar canción del repertorio
            </label>
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#4a4640]"
              />
              <input
                id="mp-song-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar pista en el repertorio..."
                className="w-full h-11 rounded-full border-1.5 border-[#cfc2ae] bg-[#fbf8f2] pl-10 pr-4 text-xs font-semibold text-[#111110] placeholder-[#787166] focus:border-[#111110]"
              />
            </div>
          </div>

          {/* Tracklist */}
          <div className="mp-scroll flex-1 overflow-y-auto px-3.5 py-3 space-y-2">
            {initialLoading ? (
              <div className="space-y-2.5 py-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="h-16 rounded-2xl bg-[#ebe2d3] animate-pulse border border-[#dfd4c3]"
                  />
                ))}
              </div>
            ) : activePlaylist.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e9dfd0] text-[#111110] mb-3">
                  <Disc3 size={26} />
                </div>
                <p className="text-sm font-bold text-[#111110]">Sin pistas en este repertorio</p>
                <p className="mt-1 text-xs text-[#4a4640] max-w-xs leading-relaxed">
                  Al exportar las mezclas en Studio Prompter hacia Live Concert, aparecerán aquí
                  listas para sincronizar en la bóveda cifrada de tu celular o tablet.
                </p>
              </div>
            ) : (
              activePlaylist.map((song, idx) => {
                const isSelected = currentSong?.id === song.id;
                const meta = vaultMap[song.id];
                const evalSt = evaluateSongVaultState(song, meta);
                const bpmVal = song.prompter_data?.bpm
                  ? Math.round(Number(song.prompter_data.bpm))
                  : null;
                const keyVal = song.prompter_data?.key || null;
                const isThisDownloading = downloadingSongId === song.id;

                return (
                  <motion.div
                    key={song.id}
                    whileTap={evalSt.status !== 'no_mix' ? { scale: 0.99 } : undefined}
                    onClick={() => {
                      if (evalSt.status === 'no_mix') return;
                      void selectAndPlaySong(song, true);
                    }}
                    className={`group flex items-center justify-between gap-3 rounded-2xl px-3.5 py-3 transition-colors border-2 ${
                      evalSt.status === 'no_mix'
                        ? 'opacity-45 cursor-not-allowed border-transparent bg-[#ece4d7]'
                        : isSelected
                          ? 'cursor-pointer border-[#111110] bg-[#141413] text-[#f5efe4] shadow-[0_8px_20px_rgba(17,17,16,0.16)]'
                          : 'cursor-pointer border-[#dfd4c3] bg-[#fbf8f2] text-[#111110] hover:border-[#111110]/50'
                    }`}
                  >
                    {/* Index / Play Pill */}
                    <div
                      className={`mp-mono flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                        isSelected
                          ? 'bg-[#e84432] text-[#f5efe4]'
                          : 'bg-[#e9dfd0] text-[#111110] group-hover:bg-[#111110] group-hover:text-[#f5efe4]'
                      } transition-colors`}
                    >
                      {isSelected && isPlaying ? (
                        <Pause size={17} />
                      ) : isSelected ? (
                        <Play size={17} className="ml-0.5" />
                      ) : (
                        String((song.position ?? idx) + 1).padStart(2, '0')
                      )}
                    </div>

                    {/* Song Title & Vault Security Tag Pills */}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`mp-heading truncate text-[15px] font-bold ${
                          isSelected ? 'text-[#f5efe4]' : 'text-[#111110]'
                        }`}
                      >
                        {song.title}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                        {evalSt.status === 'offline_ready' && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-bold ${
                              isSelected
                                ? 'bg-[#f2b829] text-[#111110]'
                                : 'bg-[#111110] text-[#f2b829]'
                            }`}
                          >
                            <Lock size={9} strokeWidth={2.8} />
                            <span>
                              EN BÓVEDA · {formatBytesCompact(evalSt.localBytes)}
                              {evalSt.hasLocalCue ? ' +CLICK' : ''}
                            </span>
                          </span>
                        )}

                        {evalSt.status === 'update_available' && (
                          <span className="inline-flex items-center rounded-md bg-[#f47b2a] px-2 py-0.5 font-bold text-[#111110]">
                            NUEVO MIX DISPONIBLE
                          </span>
                        )}

                        {evalSt.status === 'cloud_only' && (
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold ${
                              isSelected
                                ? 'bg-white/10 text-[#a39d93]'
                                : 'bg-[#e9dfd0] text-[#4a4640]'
                            }`}
                          >
                            Toca para sincronizar en memoria
                          </span>
                        )}

                        {evalSt.status === 'no_mix' && (
                          <span className="inline-flex items-center rounded-md bg-[#dfd4c3] px-2 py-0.5 font-semibold text-[#4a4640]">
                            Sin mezcla exportada
                          </span>
                        )}

                        {bpmVal && (
                          <span
                            className={`mp-mono font-bold ${
                              isSelected ? 'text-[#f5efe4]/80' : 'text-[#4a4640]'
                            }`}
                          >
                            {bpmVal} BPM
                          </span>
                        )}

                        {keyVal && (
                          <span
                            className={`mp-mono rounded px-1.5 py-0.5 font-bold ${
                              isSelected
                                ? 'bg-[#e84432]/25 text-[#f2b829]'
                                : 'bg-[#e84432]/12 text-[#a63629]'
                            }`}
                          >
                            {keyVal}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Vault Quick Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      {evalSt.status === 'cloud_only' && (
                        <button
                          type="button"
                          onClick={(e) => void handleSaveSingleSongToDevice(song, false, e)}
                          disabled={isThisDownloading || !isOnline}
                          title="Sincronizar en la bóveda cifrada del dispositivo"
                          className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors cursor-pointer disabled:opacity-40 ${
                            isSelected
                              ? 'border-white/15 bg-white/10 text-[#f2b829] hover:bg-[#f2b829] hover:text-[#111110]'
                              : 'border-[#cfc2ae] bg-[#f5efe4] text-[#111110] hover:bg-[#111110] hover:text-[#f2b829]'
                          }`}
                        >
                          {isThisDownloading ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <CloudDownload size={16} />
                          )}
                        </button>
                      )}

                      {evalSt.status === 'update_available' && isOnline && (
                        <button
                          type="button"
                          onClick={(e) => void handleSaveSingleSongToDevice(song, true, e)}
                          disabled={isThisDownloading}
                          title="Sincronizar nueva versión de la mezcla"
                          className="flex h-9 px-2.5 items-center justify-center rounded-xl bg-[#f2b829] text-[11px] font-bold text-[#111110] cursor-pointer"
                        >
                          {isThisDownloading ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            'Actualizar'
                          )}
                        </button>
                      )}

                      {evalSt.hasLocalFoh && !isThisDownloading && (
                        <button
                          type="button"
                          onClick={(e) => void handleRemoveLocalSong(song, e)}
                          title="Liberar esta pista de la bóveda interna"
                          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors cursor-pointer ${
                            isSelected
                              ? 'text-[#a39d93] hover:bg-[#e84432]/25 hover:text-[#f5efe4]'
                              : 'text-[#787166] hover:bg-[#e84432]/15 hover:text-[#c93322]'
                          }`}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: Obsidian Hardware Console + Warm Alabaster Study Sheet */}
        <section
          className={`${
            mobileTab === 'player' ? 'flex' : 'hidden'
          } lg:flex lg:col-span-7 xl:col-span-8 flex-col w-full min-h-0 bg-[#f5efe4] overflow-y-auto mp-scroll`}
        >
          {currentSong ? (
            <div className="flex flex-1 flex-col p-4 sm:p-6 gap-5 max-w-4xl w-full mx-auto pb-8">
              {/* ===============================================================
                  DOUBLE-BEZEL OBSIDIAN CONSOLE
              ================================================================ */}
              <div className="mp-console-bezel">
                <div className="mp-console-core p-4 sm:p-6 space-y-5">
                  {/* Console Window Header Bar */}
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#e84432] shrink-0" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#f2b829] shrink-0" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#f5efe4] shrink-0" />
                      <span className="mp-mono ml-1.5 truncate text-[11px] text-[#a39d93]">
                        ~/boveda-cifrada/{activeSetlistName.toLowerCase().replace(/\s+/g, '-')}
                      </span>
                    </div>

                    {currentVaultEval.hasLocalFoh ? (
                      <span className="mp-gold-tag shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-[11px] font-bold">
                        <Lock size={10} strokeWidth={2.6} />
                        <span>AES-256 · 0 Datos</span>
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-white/10 px-3 py-0.5 text-[11px] font-semibold text-[#f5efe4]">
                        Sincronización Automática
                      </span>
                    )}
                  </div>

                  {/* Active Track Title + Musical Telemetry */}
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#f2b829] mp-mono mb-1">
                        <span>&gt;</span>
                        <span>
                          {cueEnabled
                            ? 'RAM VOLÁTIL · PISTA + CLICK/GUÍA SINCRONIZADO'
                            : 'RAM VOLÁTIL · SOLO MÚSICA (SIN ARCHIVO EXTRAÍBLE)'}
                        </span>
                      </div>

                      <h2 className="mp-heading text-2xl sm:text-3xl font-bold text-[#f5efe4] break-words">
                        {currentSong.title}
                      </h2>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                        {currentBpm && (
                          <span className="mp-mono rounded-lg bg-[#1e1e1c] border border-white/10 px-2.5 py-1 font-bold text-[#f5efe4]">
                            {currentBpm} BPM
                          </span>
                        )}
                        <span className="mp-mono rounded-lg bg-[#1e1e1c] border border-white/10 px-2.5 py-1 text-[#a39d93]">
                          {currentTimeSig}
                        </span>
                        {currentKey && (
                          <span className="mp-mono rounded-lg bg-[#e84432] px-2.5 py-1 font-bold text-[#f5efe4]">
                            Tono {currentKey}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Skip Pre-Roll Button */}
                    {preRollSec > 0.1 && (
                      <button
                        type="button"
                        onClick={() => setSkipPreRoll((v) => !v)}
                        className={`h-10 rounded-full px-3.5 text-xs font-bold transition-colors cursor-pointer border ${
                          !skipPreRoll || cueEnabled
                            ? 'border-[#f2b829] bg-[#f2b829]/15 text-[#f2b829]'
                            : 'border-white/15 bg-[#1e1e1c] text-[#a39d93] hover:text-[#f5efe4]'
                        }`}
                      >
                        {!skipPreRoll || cueEnabled ? 'Conteo 1-2-3-4: ON' : 'Saltar silencio inicial'}
                      </button>
                    )}
                  </div>

                  {/* Tactile Waveform Scrubber */}
                  <div className="space-y-2 pt-1">
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label="Posición de reproducción"
                      aria-valuemin={0}
                      aria-valuemax={Math.round(duration)}
                      aria-valuenow={Math.round(globalTime)}
                      onClick={(e) => {
                        if (duration <= 0) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        seekToGlobal(ratio * duration);
                      }}
                      className="relative flex h-14 w-full cursor-pointer items-end gap-[3px] rounded-2xl bg-[#1b1b19] px-3 py-2.5 border border-white/[0.06] overflow-hidden"
                    >
                      {loopSectionIndex !== null &&
                        normalizedSections[loopSectionIndex] &&
                        duration > 0 && (
                          <div
                            className="pointer-events-none absolute inset-y-0 bg-[#f2b829]/20 border-x-2 border-[#f2b829]"
                            style={{
                              left: `${(normalizedSections[loopSectionIndex].globalStart / duration) * 100}%`,
                              width: `${Math.max(
                                1.5,
                                ((normalizedSections[loopSectionIndex].globalEnd -
                                  normalizedSections[loopSectionIndex].globalStart) /
                                  duration) *
                                  100
                              )}%`,
                            }}
                          />
                        )}

                      {waveformBars.map((barHeight, idx) => {
                        const barRatio = (idx + 0.5) / waveformBars.length;
                        const played = barRatio <= progressRatio;
                        return (
                          <div
                            key={idx}
                            className={`flex-1 rounded-full transition-colors duration-100 ${
                              played
                                ? cueEnabled
                                  ? 'bg-[#f2b829]'
                                  : 'bg-[#e84432]'
                                : 'bg-[#f5efe4]/18'
                            }`}
                            style={{ height: `${barHeight}%` }}
                          />
                        );
                      })}
                    </div>

                    <div className="mp-mono flex items-center justify-between text-xs text-[#a39d93]">
                      <span className="text-[#f5efe4] font-bold">{formatTimeDisplay(globalTime)}</span>
                      {isPreparingAudio ? (
                        <span className="flex items-center gap-1.5 text-[#f2b829] font-sans font-semibold">
                          <Loader2 size={13} className="animate-spin" />
                          <span>{prepareStatusText || 'Descifrando en RAM...'}</span>
                        </span>
                      ) : loopSectionIndex !== null && normalizedSections[loopSectionIndex] ? (
                        <span className="text-[#f2b829] font-sans font-bold">
                          Repetir sección: {normalizedSections[loopSectionIndex].label}
                        </span>
                      ) : (
                        <span className="font-sans text-[11px] text-[#a39d93]">
                          Reproducción protegida en memoria interna
                        </span>
                      )}
                      <span>{formatTimeDisplay(duration)}</span>
                    </div>
                  </div>

                  {/* Primary Hardware Transport Deck */}
                  <div className="flex items-center justify-center gap-3 sm:gap-5 py-1">
                    <button
                      type="button"
                      onClick={() => setRepeatMode((m) => (m === 'setlist' ? 'one' : 'setlist'))}
                      title={
                        repeatMode === 'one'
                          ? 'Repetir esta pista continuamente'
                          : 'Avanzar por el repertorio'
                      }
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors cursor-pointer ${
                        repeatMode === 'one'
                          ? 'border-[#f2b829] bg-[#f2b829] text-[#111110]'
                          : 'border-white/10 bg-[#1e1e1c] text-[#a39d93] hover:text-[#f5efe4]'
                      }`}
                    >
                      <Repeat size={18} />
                    </button>

                    <button
                      type="button"
                      onClick={goPrevSong}
                      className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-[#1e1e1c] text-[#f5efe4] hover:bg-[#282825] active:scale-95 transition-transform cursor-pointer"
                      title="Inicio / Pista anterior"
                    >
                      <SkipBack size={22} />
                    </button>

                    <motion.button
                      whileTap={{ scale: 0.94 }}
                      transition={SPRING_SNAPPY}
                      type="button"
                      onClick={togglePlayPause}
                      disabled={isPreparingAudio || currentVaultEval.status === 'no_mix'}
                      className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#e84432] text-[#f5efe4] border-2 border-[#f5efe4]/20 shadow-[0_10px_28px_rgba(232,68,50,0.45)] hover:bg-[#f04f3d] cursor-pointer disabled:opacity-40"
                      title={isPlaying ? 'Pausar' : 'Reproducir'}
                    >
                      {isPreparingAudio ? (
                        <Loader2 size={30} className="animate-spin" />
                      ) : isPlaying ? (
                        <Pause size={32} />
                      ) : (
                        <Play size={32} className="ml-1" />
                      )}
                    </motion.button>

                    <button
                      type="button"
                      onClick={() => goNextSong(true)}
                      className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-[#1e1e1c] text-[#f5efe4] hover:bg-[#282825] active:scale-95 transition-transform cursor-pointer"
                      title="Siguiente pista"
                    >
                      <SkipForward size={22} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setLoopSectionIndex(null)}
                      disabled={loopSectionIndex === null}
                      className={`flex h-12 px-3.5 items-center justify-center rounded-2xl border text-xs font-bold transition-colors cursor-pointer ${
                        loopSectionIndex !== null
                          ? 'border-[#f2b829] bg-[#f2b829]/20 text-[#f2b829]'
                          : 'border-white/5 bg-[#1e1e1c]/50 text-[#57534d] cursor-default'
                      }`}
                    >
                      Loop Off
                    </button>
                  </div>

                  {/* ===========================================================
                      GEOMETRIC TRIAD MODE SELECTOR + POCKET MIXER
                  ============================================================ */}
                  <div className="border-t border-white/[0.08] pt-4 space-y-4">
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      <button
                        type="button"
                        onClick={() => void handleSetCueMode(false, { foh: 1.0, cue: cueVolume })}
                        className={`flex flex-col sm:flex-row items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-bold transition-all cursor-pointer ${
                          activeModeKey === 'music'
                            ? 'border-[#f5efe4] bg-[#f5efe4] text-[#111110]'
                            : 'border-white/10 bg-[#1e1e1c] text-[#a39d93] hover:text-[#f5efe4]'
                        }`}
                      >
                        <span
                          className={`h-3.5 w-3.5 rounded-full shrink-0 ${
                            activeModeKey === 'music' ? 'bg-[#e84432]' : 'bg-[#f5efe4]'
                          }`}
                        />
                        <span>Solo Música</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleSetCueMode(true, { foh: 0.85, cue: 0.95 })}
                        className={`flex flex-col sm:flex-row items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-bold transition-all cursor-pointer ${
                          activeModeKey === 'both'
                            ? 'border-[#f2b829] bg-[#f2b829] text-[#111110]'
                            : 'border-white/10 bg-[#1e1e1c] text-[#a39d93] hover:text-[#f2b829]'
                        }`}
                      >
                        <span
                          className={`h-3.5 w-3.5 rounded-[4px] shrink-0 ${
                            activeModeKey === 'both' ? 'bg-[#111110]' : 'bg-[#a63629]'
                          }`}
                        />
                        <span>+ Click / Guía</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleSetCueMode(true, { foh: 0, cue: 1.0 })}
                        className={`flex flex-col sm:flex-row items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-bold transition-all cursor-pointer ${
                          activeModeKey === 'click'
                            ? 'border-[#f47b2a] bg-[#f47b2a] text-[#111110]'
                            : 'border-white/10 bg-[#1e1e1c] text-[#a39d93] hover:text-[#f47b2a]'
                        }`}
                      >
                        <span
                          className="inline-block shrink-0"
                          style={{
                            width: 0,
                            height: 0,
                            borderLeft: '7px solid transparent',
                            borderRight: '7px solid transparent',
                            borderBottom:
                              activeModeKey === 'click'
                                ? '12px solid #111110'
                                : '12px solid #f47b2a',
                          }}
                        />
                        <span>Solo Click</span>
                      </button>
                    </div>

                    {/* Independent Hardware Faders */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex items-center gap-3 rounded-2xl bg-[#1b1b19] px-4 py-2.5 border border-white/[0.06]">
                        <Music size={16} className="text-[#e84432] shrink-0" />
                        <span className="text-xs font-bold text-[#f5efe4] w-20 shrink-0">
                          Música
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.02"
                          aria-label="Volumen de pista musical"
                          value={fohVolume}
                          onChange={(e) => setFohVolume(parseFloat(e.target.value))}
                          className="mp-fader mp-fader-music"
                        />
                        <span className="mp-mono w-10 text-right text-xs font-bold text-[#f5efe4]">
                          {Math.round(fohVolume * 100)}%
                        </span>
                      </div>

                      <div
                        className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 border transition-colors ${
                          cueEnabled
                            ? 'bg-[#f2b829]/10 border-[#f2b829]/45'
                            : 'bg-[#1b1b19] border-white/[0.06] opacity-75'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleSetCueMode(!cueEnabled)}
                          className="shrink-0 text-[#f2b829] cursor-pointer"
                          title={cueEnabled ? 'Apagar Click/Guía' : 'Encender Click/Guía'}
                        >
                          {cueEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
                        </button>
                        <span className="text-xs font-bold text-[#f5efe4] w-20 shrink-0">
                          Click/Guía
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.02"
                          aria-label="Volumen de Click y Voz Guía"
                          value={cueVolume}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCueVolume(val);
                            if (!cueEnabled && val > 0.05) {
                              void handleSetCueMode(true, { foh: fohVolume, cue: val });
                            }
                          }}
                          className="mp-fader mp-fader-cue"
                        />
                        <span className="mp-mono w-10 text-right text-xs font-bold text-[#f2b829]">
                          {cueEnabled ? `${Math.round(cueVolume * 100)}%` : 'OFF'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ===============================================================
                  WARM ALABASTER EDITORIAL STUDY CARD
              ================================================================ */}
              <div className="mp-cream-card p-4 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfd4c3] pb-3.5">
                  <div className="flex items-center gap-2">
                    <span className="mp-ink-badge rounded-md px-2.5 py-1 text-xs font-bold text-[#f2b829]">
                      GUÍA DE ESTUDIO
                    </span>
                    <span className="text-sm font-bold text-[#111110]">
                      Navegación por partes y armonía
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 rounded-full bg-[#e9dfd0] p-1">
                    <button
                      type="button"
                      onClick={() => setStudyPanelTab('sections')}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                        studyPanelTab === 'sections'
                          ? 'bg-[#111110] text-[#f5efe4]'
                          : 'text-[#4a4640] hover:text-[#111110]'
                      }`}
                    >
                      Secciones ({normalizedSections.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStudyPanelTab('chords_lyrics')}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                        studyPanelTab === 'chords_lyrics'
                          ? 'bg-[#111110] text-[#f5efe4]'
                          : 'text-[#4a4640] hover:text-[#111110]'
                      }`}
                    >
                      Acordes y Letra
                    </button>
                  </div>
                </div>

                {studyPanelTab === 'sections' ? (
                  normalizedSections.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                      {normalizedSections.map((sec) => {
                        const isActiveSec = activeSectionIndex === sec.index;
                        const isLoopingSec = loopSectionIndex === sec.index;
                        return (
                          <div
                            key={`${sec.index}-${sec.label}`}
                            className={`flex items-center justify-between rounded-2xl border-2 px-3.5 py-3 transition-colors ${
                              isLoopingSec
                                ? 'border-[#111110] bg-[#f2b829] text-[#111110]'
                                : isActiveSec
                                  ? 'border-[#e84432] bg-[#e84432] text-[#f5efe4]'
                                  : 'border-[#dfd4c3] bg-[#f5efe4] text-[#111110] hover:border-[#111110]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                seekToGlobal(sec.globalStart);
                                if (!isPlayingRef.current) {
                                  void playSong(currentSong, sec.globalStart);
                                }
                              }}
                              className="min-w-0 flex-1 text-left cursor-pointer"
                            >
                              <div className="truncate text-xs font-bold">{sec.label}</div>
                              <div
                                className={`mp-mono text-[11px] font-bold ${
                                  isLoopingSec
                                    ? 'text-[#111110]/80'
                                    : isActiveSec
                                      ? 'text-[#f5efe4]/85'
                                      : 'text-[#4a4640]'
                                }`}
                              >
                                {formatTimeDisplay(sec.globalStart)}
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const nextLoop = isLoopingSec ? null : sec.index;
                                setLoopSectionIndex(nextLoop);
                                if (nextLoop !== null) {
                                  seekToGlobal(sec.globalStart);
                                }
                              }}
                              title={
                                isLoopingSec
                                  ? 'Quitar repetición de sección'
                                  : `Repetir "${sec.label}" en bucle`
                              }
                              className={`ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors cursor-pointer ${
                                isLoopingSec
                                  ? 'bg-[#111110] text-[#f2b829]'
                                  : isActiveSec
                                    ? 'bg-[#111110]/25 text-[#f5efe4]'
                                    : 'bg-[#e9dfd0] text-[#111110] hover:bg-[#111110] hover:text-[#f5efe4]'
                              }`}
                            >
                              <Repeat size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-xs font-medium text-[#4a4640]">
                      Esta pista aún no tiene marcadores de sección definidos en Studio Prompter.
                    </p>
                  )
                ) : (
                  <div className="space-y-4">
                    {chordsList.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-bold text-[#4a4640]">
                          Acordes del tema (toca cualquiera para saltar a ese compás)
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto mp-scroll pr-1">
                          {chordsList.map((ch: any, idx: number) => {
                            const isCurrentChord = idx === activeChordIndex;
                            return (
                              <button
                                key={`${idx}-${ch.chord}-${ch.time}`}
                                type="button"
                                onClick={() =>
                                  seekToGlobal(preRollSec + Math.max(0, Number(ch.time) || 0))
                                }
                                className={`mp-mono rounded-xl px-3 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
                                  isCurrentChord
                                    ? 'border-[#111110] bg-[#e84432] text-[#f5efe4]'
                                    : 'border-[#d8ccb8] bg-[#f5efe4] text-[#111110] hover:border-[#111110]'
                                }`}
                              >
                                {ch.chord}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {lyricsList.length > 0 ? (
                      <div className="rounded-2xl bg-[#f5efe4] border border-[#dfd4c3] p-4 max-h-64 overflow-y-auto space-y-1.5 mp-scroll">
                        {lyricsList.map((line: any, idx: number) => {
                          const isCurrentLine = idx === activeLyricIndex;
                          return (
                            <button
                              key={line.id || `${idx}-${line.time}`}
                              type="button"
                              onClick={() => {
                                const targetGlobal = Math.max(
                                  0,
                                  Number(line.time || 0) -
                                    lyricMapping.lyricReferencePreRollSec +
                                    preRollSec
                                );
                                seekToGlobal(targetGlobal);
                              }}
                              className={`block w-full text-left rounded-xl px-3.5 py-2 text-sm transition-colors cursor-pointer ${
                                isCurrentLine
                                  ? 'bg-[#141413] font-bold text-[#f2b829]'
                                  : 'font-medium text-[#4a4640] hover:text-[#111110]'
                              }`}
                            >
                              {line.text}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      chordsList.length === 0 && (
                        <p className="py-6 text-center text-xs font-medium text-[#4a4640]">
                          No hay acordes ni letras sincronizadas para esta canción todavía.
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div>
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#e9dfd0] text-[#111110]">
                  <Headphones size={26} />
                </div>
                <p className="text-sm font-bold text-[#111110]">
                  Selecciona una canción del repertorio para abrir la consola
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* =====================================================================
          FLOATING OBSIDIAN MINI-CONSOLE DOCK ON MOBILE/TABLET PORTRAIT (< lg)
      ====================================================================== */}
      {mobileTab === 'playlist' && currentSong && (
        <div className="shrink-0 lg:hidden bg-[#141413] text-[#f5efe4] border-t-2 border-[#111110] px-3.5 pt-2.5 mp-safe-bottom shadow-[0_-10px_28px_rgba(17,17,16,0.25)]">
          <div className="mb-2.5 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full w-full origin-left transition-transform duration-100 ${
                cueEnabled ? 'bg-[#f2b829]' : 'bg-[#e84432]'
              }`}
              style={{ transform: `scaleX(${progressRatio})` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() => setMobileTab('player')}
              className="min-w-0 flex-1 text-left cursor-pointer"
            >
              <div className="truncate text-sm font-bold text-[#f5efe4]">{currentSong.title}</div>
              <div className="mp-mono flex items-center gap-2 text-[11px] text-[#a39d93]">
                <span>
                  {formatTimeDisplay(globalTime)} / {formatTimeDisplay(duration)}
                </span>
                {cueEnabled && <span className="font-bold text-[#f2b829]">+CLICK</span>}
              </div>
            </button>

            <button
              type="button"
              onClick={() => void handleSetCueMode(!cueEnabled)}
              className={`h-10 rounded-full px-3.5 text-[11px] font-bold transition-colors cursor-pointer ${
                cueEnabled
                  ? 'bg-[#f2b829] text-[#111110]'
                  : 'border border-white/20 bg-[#1e1e1c] text-[#f5efe4]'
              }`}
            >
              {cueEnabled ? 'CLICK ON' : '+ CLICK'}
            </button>

            <button
              type="button"
              onClick={togglePlayPause}
              disabled={isPreparingAudio}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e84432] text-[#f5efe4] active:scale-95 transition-transform cursor-pointer"
            >
              {isPreparingAudio ? (
                <Loader2 size={18} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={19} />
              ) : (
                <Play size={19} className="ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => goNextSong(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1e1e1c] text-[#f5efe4] active:scale-95 transition-transform cursor-pointer"
            >
              <SkipForward size={17} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
