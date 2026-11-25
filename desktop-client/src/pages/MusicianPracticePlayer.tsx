import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CloudDownload,
  Disc3,
  Headphones,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Search,
  SkipBack,
  SkipForward,
  Smartphone,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
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
  ensureSongMp3CachedInDevice,
  evaluateSongVaultState,
  formatBytesCompact,
  readCachedPracticeCatalog,
  readLocalMp3Blob,
  readLocalVaultSummary,
  removeSongFromLocalVault,
  requestPersistentDeviceStorage,
  syncPracticeCatalogFromSupabase,
} from '../services/musicianLocalAudioVault';

const ALL_SONGS_FILTER_ID = '__all_live_songs__';
const ACTIVE_PRACTICE_SETLIST_KEY = 'tandu_practice_active_setlist_v1';
const PRACTICE_SKIP_PREROLL_KEY = 'tandu_practice_skip_preroll_v1';

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

export default function MusicianPracticePlayer() {
  // Online / Offline awareness
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
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

  // Batch / single download states
  const [downloadingSongId, setDownloadingSongId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    songTitle: string;
  } | null>(null);
  const [statusToast, setStatusToast] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(
    null
  );

  // Mobile layout view switcher ('playlist' | 'player')
  const [mobileTab, setMobileTab] = useState<'playlist' | 'player'>('playlist');
  const [studyPanelTab, setStudyPanelTab] = useState<'sections' | 'chords_lyrics'>('sections');

  // Active playback state
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPreparingAudio, setIsPreparingAudio] = useState<boolean>(false);
  const [prepareStatusText, setPrepareStatusText] = useState<string>('');
  const [globalTime, setGlobalTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Musician practice controls: Click/Voz Guía + Faders + Skip Pre-Roll + Loop
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

  // Refs for dual engine:
  // 1) Native <audio> for lock-screen / low-battery pure MP3 playback when Click/Guía is OFF
  // 2) Sample-accurate Web Audio Context when Click/Guía is ON (0ms drift + independent iOS faders)
  const nativeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
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

  const showNotice = useCallback((kind: 'info' | 'ok' | 'err', text: string) => {
    setStatusToast({ kind, text });
    window.setTimeout(() => {
      setStatusToast((prev) => (prev?.text === text ? null : prev));
    }, kind === 'err' ? 5000 : 3200);
  }, []);

  // Apply catalog snapshot cleanly
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

  // Online / Offline listeners
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

  // Boot sequence: 1) Read local IndexedDB immediately (<50ms, 0 network), 2) Request persistent storage, 3) Lightweight metadata sync
  useEffect(() => {
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
      const remoteSnap = await syncPracticeCatalogFromSupabase({ force: !cachedCatalog });
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
  }, [applyCatalogSnapshot, refreshVaultIndex]);

  // Persist selected setlist choice
  useEffect(() => {
    if (!selectedSetlistId) return;
    try {
      localStorage.setItem(ACTIVE_PRACTICE_SETLIST_KEY, selectedSetlistId);
    } catch {
      // ignore
    }
  }, [selectedSetlistId]);

  useEffect(() => {
    try {
      localStorage.setItem(PRACTICE_SKIP_PREROLL_KEY, skipPreRoll ? '1' : '0');
    } catch {
      // ignore
    }
  }, [skipPreRoll]);

  // Active song list based on selected Live Concert setlist or All Live Songs
  const activePlaylist = useMemo<PracticeSongItem[]>(() => {
    const base =
      selectedSetlistId === ALL_SONGS_FILTER_ID || !selectedSetlistId
        ? allLiveSongs
        : setlistSongsMap[selectedSetlistId] || [];

    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [allLiveSongs, searchQuery, selectedSetlistId, setlistSongsMap]);

  const activeSetlistRawSongs = useMemo<PracticeSongItem[]>(() => {
    if (selectedSetlistId === ALL_SONGS_FILTER_ID || !selectedSetlistId) {
      return allLiveSongs;
    }
    return setlistSongsMap[selectedSetlistId] || [];
  }, [allLiveSongs, selectedSetlistId, setlistSongsMap]);

  // Auto-select first song once catalog loads (preferring an already-cached local song if offline)
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

  // Sections normalized to global audio timeline
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

  // Chords & Lyrics for Study Panel
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

  // Vault stats for active setlist
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
  // AUDIO ENGINE HELPERS (Native <audio> + Sample-Accurate Web Audio)
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
    } catch {
      // Optional on unsupported browsers
    }
  }, []);

  const stopAllPlayback = useCallback(
    (resetToInitial = false) => {
      stopWebAudioSources();
      if (nativeAudioRef.current) {
        nativeAudioRef.current.pause();
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
      releaseWakeLock();

      if (resetToInitial) {
        const song = currentSongRef.current;
        const pRoll = resolveEffectivePreRoll(song);
        const startOffset = skipPreRoll && !cueEnabledRef.current && pRoll > 0 ? pRoll : 0;
        pauseGlobalTimeRef.current = startOffset;
        setGlobalTime(startOffset);
        if (nativeAudioRef.current) {
          try {
            nativeAudioRef.current.currentTime = startOffset;
          } catch {}
        }
      }
    },
    [releaseWakeLock, skipPreRoll, stopWebAudioSources]
  );

  // Sync volumes in real time
  useEffect(() => {
    if (nativeAudioRef.current) {
      nativeAudioRef.current.volume = Math.max(0, Math.min(1, fohVolume));
    }
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
      if (nativeAudioRef.current) {
        nativeAudioRef.current.pause();
      }

      const clampedOffset = Math.max(0, Math.min(offsetSec, Math.max(0, fohBuf.duration - 0.05)));
      const startAt = ctx.currentTime + 0.02;

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

        // Section Loop check
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
    [acquireWakeLock, ensureWebAudioGraph, stopWebAudioSources]
  );

  // Prepare local MP3 blobs (downloading once to IndexedDB if needed)
  const ensureSongReadyInVaultAndMemory = useCallback(
    async (
      song: PracticeSongItem,
      needCueDecoded: boolean
    ): Promise<{
      fohBlob: Blob;
      cueBlob: Blob | null;
      fohBuffer?: AudioBuffer;
      cueBuffer?: AudioBuffer | null;
    }> => {
      let fohBlob = await readLocalMp3Blob(song.id, 'foh');
      let cueBlob = needCueDecoded ? await readLocalMp3Blob(song.id, 'cue') : null;

      const evalState = evaluateSongVaultState(song, vaultMap[song.id]);
      const mustFetchFoh = !fohBlob;
      const mustFetchCue = needCueDecoded && !cueBlob && evalState.hasCloudCue;

      if (mustFetchFoh || mustFetchCue) {
        if (!isOnline) {
          if (!fohBlob) {
            throw new Error(
              'Sin internet y esta pista aún no fue guardada en la memoria de tu dispositivo.'
            );
          }
        } else {
          await ensureSongMp3CachedInDevice({
            song,
            includeCue: true,
            onProgress: (msg) => setPrepareStatusText(msg),
          });
          await refreshVaultIndex();
          fohBlob = await readLocalMp3Blob(song.id, 'foh');
          if (needCueDecoded) {
            cueBlob = await readLocalMp3Blob(song.id, 'cue');
          }
        }
      }

      if (!fohBlob) {
        throw new Error('No se encontró el audio MP3 de esta canción.');
      }

      if (!needCueDecoded) {
        return { fohBlob, cueBlob };
      }

      // Check decoded cache for instant Click ON/OFF switching on the same song
      if (
        decodedCacheRef.current &&
        decodedCacheRef.current.songId === song.id &&
        (decodedCacheRef.current.cueBuffer || !cueBlob)
      ) {
        return {
          fohBlob,
          cueBlob,
          fohBuffer: decodedCacheRef.current.fohBuffer,
          cueBuffer: decodedCacheRef.current.cueBuffer,
        };
      }

      setPrepareStatusText('Sincronizando Pista + Click/Voz Guía en memoria...');
      const ctx = ensureWebAudioGraph();
      const [fohArr, cueArr] = await Promise.all([
        fohBlob.arrayBuffer(),
        cueBlob ? cueBlob.arrayBuffer() : Promise.resolve(null),
      ]);

      const [fohBuffer, cueBuffer] = await Promise.all([
        ctx.decodeAudioData(fohArr.slice(0)),
        cueArr ? ctx.decodeAudioData(cueArr.slice(0)).catch(() => null) : Promise.resolve(null),
      ]);

      decodedCacheRef.current = {
        songId: song.id,
        fohBuffer,
        cueBuffer,
      };

      return { fohBlob, cueBlob, fohBuffer, cueBuffer };
    },
    [ensureWebAudioGraph, isOnline, refreshVaultIndex, vaultMap]
  );

  // Load native <audio> ObjectURL when song changes if already cached locally (0 network!)
  useEffect(() => {
    const token = ++loadTokenRef.current;
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

    // Pre-attach local blob URL if already in device memory (0 bytes from Supabase)
    void (async () => {
      const localFoh = await readLocalMp3Blob(currentSong.id, 'foh');
      if (loadTokenRef.current !== token || !localFoh || !nativeAudioRef.current) return;

      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
      }
      const nextUrl = URL.createObjectURL(localFoh);
      activeObjectUrlRef.current = nextUrl;
      nativeAudioRef.current.src = nextUrl;
      nativeAudioRef.current.currentTime = initialOffset;
    })();
  }, [currentSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      batchAbortRef.current?.abort();
      stopWebAudioSources();
      releaseWakeLock();
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
      }
      if (webAudioCtxRef.current && webAudioCtxRef.current.state !== 'closed') {
        webAudioCtxRef.current.close().catch(() => {});
      }
    };
  }, [releaseWakeLock, stopWebAudioSources]);

  // Play / Pause master handler
  const playSong = useCallback(
    async (targetSong?: PracticeSongItem, customStartOffset?: number) => {
      const song = targetSong || currentSongRef.current;
      if (!song) return;

      const token = ++loadTokenRef.current;
      setIsPreparingAudio(true);
      setPrepareStatusText('');

      try {
        const wantCue = cueEnabledRef.current;
        const prepared = await ensureSongReadyInVaultAndMemory(song, wantCue);
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

        if (wantCue && prepared.fohBuffer) {
          startWebAudioAtOffset(prepared.fohBuffer, prepared.cueBuffer || null, startOffset);
        } else if (nativeAudioRef.current) {
          stopWebAudioSources();
          if (activeObjectUrlRef.current) {
            URL.revokeObjectURL(activeObjectUrlRef.current);
          }
          const objUrl = URL.createObjectURL(prepared.fohBlob);
          activeObjectUrlRef.current = objUrl;

          const audioEl = nativeAudioRef.current;
          if (audioEl.src !== objUrl) {
            audioEl.src = objUrl;
          }
          audioEl.volume = Math.max(0, Math.min(1, fohVolume));

          await new Promise<void>((resolve) => {
            if (audioEl.readyState >= 1) {
              resolve();
              return;
            }
            const onMeta = () => {
              audioEl.removeEventListener('loadedmetadata', onMeta);
              resolve();
            };
            audioEl.addEventListener('loadedmetadata', onMeta, { once: true });
            window.setTimeout(resolve, 400);
          });

          if (loadTokenRef.current !== token) return;
          if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
            setDuration(audioEl.duration);
          }
          audioEl.currentTime = Math.max(0, startOffset);
          await audioEl.play();
          pauseGlobalTimeRef.current = startOffset;
          setGlobalTime(startOffset);
          setIsPlaying(true);
          isPlayingRef.current = true;
        }
      } catch (err: any) {
        showNotice('err', err?.message || 'Error al reproducir la pista.');
      } finally {
        if (loadTokenRef.current === token) {
          setIsPreparingAudio(false);
          setPrepareStatusText('');
        }
      }
    },
    [
      ensureSongReadyInVaultAndMemory,
      fohVolume,
      showNotice,
      skipPreRoll,
      startWebAudioAtOffset,
      stopWebAudioSources,
    ]
  );

  const pauseSong = useCallback(() => {
    if (cueEnabledRef.current && webAudioCtxRef.current && isPlayingRef.current) {
      const elapsed = Math.max(
        0,
        webAudioCtxRef.current.currentTime - webStartCtxTimeRef.current
      );
      pauseGlobalTimeRef.current = elapsed;
      setGlobalTime(elapsed);
    } else if (nativeAudioRef.current) {
      pauseGlobalTimeRef.current = nativeAudioRef.current.currentTime || pauseGlobalTimeRef.current;
      nativeAudioRef.current.pause();
    }
    stopWebAudioSources();
    releaseWakeLock();
    setIsPlaying(false);
    isPlayingRef.current = false;
  }, [releaseWakeLock, stopWebAudioSources]);

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
        if (nativeAudioRef.current && !cueEnabledRef.current) {
          try {
            nativeAudioRef.current.currentTime = clamped;
          } catch {}
        }
        return;
      }

      const cachedDecoded = decodedCacheRef.current;
      if (cueEnabledRef.current && cachedDecoded && cachedDecoded.songId === currentSongRef.current?.id) {
        startWebAudioAtOffset(cachedDecoded.fohBuffer, cachedDecoded.cueBuffer, clamped);
      } else if (nativeAudioRef.current) {
        nativeAudioRef.current.currentTime = clamped;
      }
    },
    [duration, startWebAudioAtOffset]
  );

  // Seamless toggle of Click / Voz Guía even mid-playback
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
      if (wasPlaying) {
        if (cueEnabledRef.current && webAudioCtxRef.current) {
          resumeAt = Math.max(0, webAudioCtxRef.current.currentTime - webStartCtxTimeRef.current);
        } else if (nativeAudioRef.current) {
          resumeAt = nativeAudioRef.current.currentTime || resumeAt;
        }
      } else if (enableCue && resumeAt <= resolveEffectivePreRoll(song) + 0.05) {
        // When stopped at start and turning ON Click/Guía, rewind to 0 so count-in ("1, 2, 3, 4") plays!
        resumeAt = 0;
        pauseGlobalTimeRef.current = 0;
        setGlobalTime(0);
      }

      setCueEnabled(enableCue);
      cueEnabledRef.current = enableCue;

      if (wasPlaying && song) {
        pauseSong();
        await playSong(song, resumeAt);
      }
    },
    [pauseSong, playSong, showNotice, vaultMap]
  );

  // Track selection & Next / Prev handlers
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
    const prevIdx =
      idx > 0 ? idx - 1 : Math.max(0, activeSetlistRawSongs.length - 1);
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
        // When offline, skip any uncached track gracefully
        if (!isOnline && !vaultMap[nextSong.id]?.hasFoh) {
          stopAllPlayback(true);
          return;
        }
        void selectAndPlaySong(nextSong, true);
      } else {
        stopAllPlayback(true);
      }
    };
  }, [activeSetlistRawSongs, isOnline, playSong, repeatMode, selectAndPlaySong, skipPreRoll, stopAllPlayback, vaultMap]);

  // Native <audio> timeupdate & Media Session API (for lock-screen controls on mobile/tablet)
  useEffect(() => {
    const audioEl = nativeAudioRef.current;
    if (!audioEl) return;

    const onTimeUpdate = () => {
      if (cueEnabledRef.current) return;
      const t = audioEl.currentTime || 0;

      const loop = loopRangeRef.current;
      if (loop && t >= loop.end - 0.06) {
        audioEl.currentTime = loop.start;
        pauseGlobalTimeRef.current = loop.start;
        setGlobalTime(loop.start);
        return;
      }

      const dur = Number.isFinite(audioEl.duration) ? audioEl.duration : duration;
      const bounds = resolveEffectivePlaybackBounds(currentSongRef.current, dur);
      if (bounds.autoAdvanceAtGlobalSec > 0 && t >= bounds.autoAdvanceAtGlobalSec) {
        audioEl.pause();
        handleTrackEndedRef.current();
        return;
      }

      pauseGlobalTimeRef.current = t;
      setGlobalTime(t);
    };

    const onLoadedMeta = () => {
      if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        setDuration(audioEl.duration);
      }
    };

    const onEnded = () => {
      if (!cueEnabledRef.current) {
        handleTrackEndedRef.current();
      }
    };

    audioEl.addEventListener('timeupdate', onTimeUpdate);
    audioEl.addEventListener('loadedmetadata', onLoadedMeta);
    audioEl.addEventListener('ended', onEnded);

    return () => {
      audioEl.removeEventListener('timeupdate', onTimeUpdate);
      audioEl.removeEventListener('loadedmetadata', onLoadedMeta);
      audioEl.removeEventListener('ended', onEnded);
    };
  }, [duration]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !currentSong) return;
    try {
      const activeSetlistTitle =
        setlists.find((s) => s.id === selectedSetlistId)?.title || 'Repertorio En Vivo';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: 'TANDU Músicos · Práctica Local MP3',
        album: activeSetlistTitle,
      });
      navigator.mediaSession.setActionHandler('play', () => void playSong());
      navigator.mediaSession.setActionHandler('pause', () => pauseSong());
      navigator.mediaSession.setActionHandler('previoustrack', () => goPrevSong());
      navigator.mediaSession.setActionHandler('nexttrack', () => goNextSong(true));
    } catch {
      // Optional in restricted webviews
    }
  }, [currentSong, goNextSong, goPrevSong, pauseSong, playSong, selectedSetlistId, setlists]);

  // ============================================================================
  // VAULT ACTIONS: SINGLE SAVE, BATCH SAVE SETLIST, REFRESH CATALOG, DELETE LOCAL
  // ============================================================================
  const handleManualSyncCatalog = async () => {
    if (!isOnline) {
      showNotice('info', 'Estás sin internet. Mostrando tu repertorio guardado en el dispositivo.');
      return;
    }
    setSyncingCatalog(true);
    const snap = await syncPracticeCatalogFromSupabase({ force: true });
    if (snap) {
      applyCatalogSnapshot(snap);
      showNotice('ok', 'Lista de canciones sincronizada.');
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
      showNotice('err', 'Conéctate a internet una vez para guardar este MP3 en tu dispositivo.');
      return;
    }
    if (downloadingSongId) return;

    setDownloadingSongId(song.id);
    try {
      await ensureSongMp3CachedInDevice({
        song,
        includeCue: true,
        forceRefresh,
      });
      if (decodedCacheRef.current?.songId === song.id) {
        decodedCacheRef.current = null;
      }
      await refreshVaultIndex();
      showNotice('ok', `"${song.title}" guardada en la memoria de tu dispositivo.`);
    } catch (err: any) {
      showNotice('err', err?.message || 'No se pudo guardar el audio.');
    } finally {
      setDownloadingSongId(null);
    }
  };

  const handleSaveEntireSetlistOffline = async () => {
    if (!isOnline) {
      showNotice('err', 'Necesitas conexión Wi-Fi o datos para descargar las pistas faltantes.');
      return;
    }
    if (batchProgress) {
      batchAbortRef.current?.abort();
      setBatchProgress(null);
      return;
    }

    const targets = setlistVaultStats.pendingSongs;
    if (targets.length === 0) {
      showNotice('ok', 'Todas las pistas de este repertorio ya están guardadas en tu memoria local.');
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
          includeCue: true,
          forceRefresh: st.status === 'update_available',
          signal: abortController.signal,
        });
        savedOk += 1;
        await refreshVaultIndex();
      }
      showNotice(
        'ok',
        `${savedOk} ${savedOk === 1 ? 'pista guardada' : 'pistas guardadas'} en memoria local. Ya puedes escuchar sin internet.`
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        showNotice('err', err?.message || 'Descarga interrumpida.');
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
  // RENDER
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
  const progressPct =
    duration > 0 ? Math.max(0, Math.min(100, (globalTime / duration) * 100)) : 0;

  return (
    <div className="flex h-full w-full flex-col bg-[#090b10] text-zinc-100 select-none overflow-hidden">
      {/* Hidden Native Audio Element for Battery-Friendly & Lock-Screen Pure MP3 Playback */}
      <audio ref={nativeAudioRef} preload="auto" playsInline className="hidden" />

      {/* Top Header Bar */}
      <header className="shrink-0 border-b border-white/[0.07] bg-[#0d1017] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Headphones size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-bold tracking-tight text-white sm:text-base">
                  Práctica Diaria · Pistas MP3
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-300">
                  <Smartphone size={11} />
                  <span>MEMORIA LOCAL{isPersisted ? ' PROTEGIDA' : ''}</span>
                </span>
              </div>
              <p className="truncate text-[11px] text-zinc-400">
                Repertorio de Live Concert guardado en tu celular o tablet ·{' '}
                <span className="font-mono font-medium text-emerald-400">
                  {formatBytesCompact(totalBytesUsed)} en dispositivo
                </span>
              </p>
            </div>
          </div>

          {/* Right Controls: Offline indicator, Setlist Selector & Batch Offline Save */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            {!isOnline && (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300">
                <WifiOff size={13} />
                <span>Modo Sin Internet</span>
              </div>
            )}

            <div className="flex items-center gap-2 flex-1 sm:flex-initial">
              <select
                value={selectedSetlistId}
                onChange={(e) => setSelectedSetlistId(e.target.value)}
                aria-label="Seleccionar Setlist de Live Concert"
                className="flex-1 sm:w-52 rounded-xl border border-white/10 bg-[#131722] px-3 py-2 text-xs font-semibold text-zinc-100 focus:border-[#e11d48] focus:outline-none"
              >
                {setlists.map((sl) => (
                  <option key={sl.id} value={sl.id}>
                    Setlist: {sl.title}
                  </option>
                ))}
                <option value={ALL_SONGS_FILTER_ID}>
                  Todas las Pistas ({allLiveSongs.length})
                </option>
              </select>

              <button
                type="button"
                onClick={handleManualSyncCatalog}
                disabled={syncingCatalog}
                title="Actualizar lista de canciones desde Live Concert"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#131722] text-zinc-300 hover:border-white/20 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={14} className={syncingCatalog ? 'animate-spin text-[#e11d48]' : ''} />
              </button>
            </div>

            {setlistVaultStats.playableTotal > 0 && (
              <button
                type="button"
                onClick={handleSaveEntireSetlistOffline}
                disabled={!isOnline && !batchProgress}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  batchProgress
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : setlistVaultStats.allCached
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20'
                      : 'bg-[#e11d48] text-white hover:bg-[#be123c]'
                } disabled:opacity-40`}
              >
                {batchProgress ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span className="font-mono tabular-nums">
                      Guardando {batchProgress.current}/{batchProgress.total}...
                    </span>
                  </>
                ) : setlistVaultStats.allCached ? (
                  <>
                    <Check size={14} />
                    <span>
                      Listo Offline ({setlistVaultStats.cachedCount}/{setlistVaultStats.playableTotal})
                    </span>
                  </>
                ) : (
                  <>
                    <CloudDownload size={14} />
                    <span>
                      Guardar Setlist ({setlistVaultStats.pendingSongs.length} MP3)
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Mobile View Switcher Tabs (< lg) */}
        <div className="mt-3 flex lg:hidden rounded-xl bg-[#131722] p-1 border border-white/[0.06]">
          <button
            type="button"
            onClick={() => setMobileTab('playlist')}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
              mobileTab === 'playlist'
                ? 'bg-[#e11d48] text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ListMusic size={14} />
            <span>Canciones ({activePlaylist.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('player')}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
              mobileTab === 'player'
                ? 'bg-[#e11d48] text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles size={14} />
            <span>Estudio · Click & Guía</span>
          </button>
        </div>
      </header>

      {/* Subtle Toast Banner */}
      {statusToast && (
        <div
          className={`shrink-0 px-4 py-2 text-center text-xs font-medium border-b ${
            statusToast.kind === 'err'
              ? 'bg-rose-500/15 text-rose-200 border-rose-500/30'
              : statusToast.kind === 'ok'
                ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
                : 'bg-sky-500/15 text-sky-200 border-sky-500/30'
          }`}
        >
          {statusToast.text}
        </div>
      )}

      {/* Main Split Workspace */}
      <div className="mx-auto flex flex-1 w-full max-w-[1600px] min-h-0 overflow-hidden lg:grid lg:grid-cols-12">
        {/* LEFT PANEL: Live Concert Repertorio & Offline Vault Status */}
        <section
          className={`${
            mobileTab === 'playlist' ? 'flex' : 'hidden'
          } lg:flex lg:col-span-5 xl:col-span-4 flex-col w-full min-h-0 border-r border-white/[0.07] bg-[#0b0e15]`}
        >
          {/* Search Input */}
          <div className="shrink-0 p-3.5 border-b border-white/[0.06]">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar canción del repertorio..."
                className="w-full rounded-xl border border-white/[0.08] bg-[#121621] py-2.5 pl-9 pr-3 text-xs text-white placeholder-zinc-500 focus:border-[#e11d48] focus:outline-none"
              />
            </div>
          </div>

          {/* Track List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
            {initialLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-2.5">
                <Loader2 size={22} className="animate-spin text-[#e11d48]" />
                <span className="text-xs">Cargando repertorio...</span>
              </div>
            ) : activePlaylist.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-zinc-500">
                <Disc3 size={36} className="mb-3 opacity-40" />
                <p className="text-sm font-semibold text-zinc-300">No hay pistas disponibles</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Cuando el administrador exporte las mezclas en Studio Prompter / Live Concert,
                  aparecerán aquí automáticamente en formato MP3 ligero.
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
                  <div
                    key={song.id}
                    onClick={() => {
                      if (evalSt.status === 'no_mix') return;
                      void selectAndPlaySong(song, true);
                    }}
                    className={`group flex items-center justify-between gap-3 rounded-xl px-3 py-3 transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] border ${
                      evalSt.status === 'no_mix'
                        ? 'opacity-50 cursor-not-allowed border-transparent bg-white/[0.01]'
                        : isSelected
                          ? 'cursor-pointer border-[#e11d48]/70 bg-[#1a1218]'
                          : 'cursor-pointer border-white/[0.04] bg-[#10141e] hover:border-white/15 hover:bg-[#151a27]'
                    }`}
                  >
                    {/* Track Index / Play Indicator */}
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold tabular-nums ${
                        isSelected
                          ? 'bg-[#e11d48] text-white'
                          : 'bg-[#181d2b] text-zinc-400 group-hover:text-white'
                      }`}
                    >
                      {isSelected && isPlaying ? (
                        <Pause size={15} />
                      ) : isSelected ? (
                        <Play size={15} className="ml-0.5" />
                      ) : (
                        String((song.position ?? idx) + 1).padStart(2, '0')
                      )}
                    </div>

                    {/* Title & Metadata Badges */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-zinc-100">
                        {song.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {evalSt.status === 'offline_ready' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300 border border-emerald-500/25">
                            <Check size={10} />
                            <span>
                              En Memoria ({formatBytesCompact(evalSt.localBytes)})
                              {evalSt.hasLocalCue ? ' · +Click' : ''}
                            </span>
                          </span>
                        )}
                        {evalSt.status === 'update_available' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300 border border-amber-500/30">
                            <span>En Memoria · Nueva mezcla disponible</span>
                          </span>
                        )}
                        {evalSt.status === 'cloud_only' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 font-medium text-zinc-400">
                            <span>Toca para guardar MP3</span>
                          </span>
                        )}
                        {evalSt.status === 'no_mix' && (
                          <span className="inline-flex items-center rounded-md bg-zinc-900 px-1.5 py-0.5 text-zinc-500">
                            Pendiente exportar Mix
                          </span>
                        )}

                        {bpmVal && (
                          <span className="font-mono text-zinc-400 tabular-nums">{bpmVal} BPM</span>
                        )}
                        {keyVal && (
                          <span className="font-mono font-semibold text-rose-300">{keyVal}</span>
                        )}
                      </div>
                    </div>

                    {/* Right Vault Action Button */}
                    <div className="flex shrink-0 items-center gap-1">
                      {evalSt.status === 'cloud_only' && (
                        <button
                          type="button"
                          onClick={(e) => void handleSaveSingleSongToDevice(song, false, e)}
                          disabled={isThisDownloading || !isOnline}
                          title="Guardar MP3 en la memoria del dispositivo"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#181d2b] text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300 transition-colors cursor-pointer disabled:opacity-40"
                        >
                          {isThisDownloading ? (
                            <Loader2 size={14} className="animate-spin text-emerald-400" />
                          ) : (
                            <CloudDownload size={14} />
                          )}
                        </button>
                      )}

                      {evalSt.status === 'update_available' && isOnline && (
                        <button
                          type="button"
                          onClick={(e) => void handleSaveSingleSongToDevice(song, true, e)}
                          disabled={isThisDownloading}
                          title="Actualizar a la última mezcla MP3"
                          className="flex h-8 px-2 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/25 cursor-pointer"
                        >
                          {isThisDownloading ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            'Actualizar'
                          )}
                        </button>
                      )}

                      {evalSt.hasLocalFoh && !isThisDownloading && (
                        <button
                          type="button"
                          onClick={(e) => void handleRemoveLocalSong(song, e)}
                          title="Liberar esta pista de la memoria local"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-rose-500/15 hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* RIGHT PANEL: Musician Practice Deck (Click/Guía Mixer + Sections Loop + Chords/Lyrics) */}
        <section
          className={`${
            mobileTab === 'player' ? 'flex' : 'hidden'
          } lg:flex lg:col-span-7 xl:col-span-8 flex-col w-full min-h-0 bg-[#090b10] overflow-y-auto custom-scrollbar`}
        >
          {currentSong ? (
            <div className="flex flex-1 flex-col p-4 sm:p-6 gap-6 max-w-4xl w-full mx-auto">
              {/* Song Header & Storage Status */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.07] pb-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {currentVaultEval.hasLocalFoh ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                        <Smartphone size={12} />
                        <span>Reproduciendo desde tu Memoria Local · 0 Datos</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 border border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300">
                        <CloudDownload size={12} />
                        <span>Se guardará en tu dispositivo automáticamente al reproducir</span>
                      </span>
                    )}
                  </div>

                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                    {currentSong.title}
                  </h2>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    {currentBpm && (
                      <span className="rounded-lg bg-[#141824] border border-white/[0.07] px-2.5 py-1 font-mono font-semibold text-zinc-200 tabular-nums">
                        {currentBpm} BPM
                      </span>
                    )}
                    <span className="rounded-lg bg-[#141824] border border-white/[0.07] px-2.5 py-1 font-mono text-zinc-300">
                      Compás {currentTimeSig}
                    </span>
                    {currentKey && (
                      <span className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 font-mono font-bold text-rose-300">
                        Tono: {currentKey}
                      </span>
                    )}
                  </div>
                </div>

                {/* Pre-Roll Toggle */}
                {preRollSec > 0.1 && (
                  <button
                    type="button"
                    onClick={() => setSkipPreRoll((v) => !v)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                      !skipPreRoll || cueEnabled
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : 'border-white/10 bg-[#131722] text-zinc-400 hover:text-white'
                    }`}
                    title="Define si al escuchar sin Click se salta el silencio de conteo inicial"
                  >
                    {!skipPreRoll || cueEnabled
                      ? 'Conteo Inicial: Incluido'
                      : 'Saltar Silencio Inicial'}
                  </button>
                )}
              </div>

              {/* Timeline Scrubber + Transport Controls */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div
                    onClick={(e) => {
                      if (duration <= 0) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      seekToGlobal(ratio * duration);
                    }}
                    className="group relative h-3 w-full cursor-pointer rounded-full bg-[#161b28] overflow-hidden"
                  >
                    {/* Loop highlight range */}
                    {loopSectionIndex !== null &&
                      normalizedSections[loopSectionIndex] &&
                      duration > 0 && (
                        <div
                          className="absolute inset-y-0 bg-amber-400/25 border-x border-amber-400"
                          style={{
                            left: `${(normalizedSections[loopSectionIndex].globalStart / duration) * 100}%`,
                            width: `${Math.max(
                              1,
                              ((normalizedSections[loopSectionIndex].globalEnd -
                                normalizedSections[loopSectionIndex].globalStart) /
                                duration) *
                                100
                            )}%`,
                          }}
                        />
                      )}
                    <div
                      className="h-full rounded-full bg-[#e11d48] transition-[width] duration-75"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between font-mono text-[11px] text-zinc-400 tabular-nums">
                    <span>{formatTimeDisplay(globalTime)}</span>
                    {isPreparingAudio ? (
                      <span className="flex items-center gap-1.5 text-amber-300 font-sans text-xs font-medium">
                        <Loader2 size={12} className="animate-spin" />
                        <span>{prepareStatusText || 'Preparando audio local...'}</span>
                      </span>
                    ) : loopSectionIndex !== null && normalizedSections[loopSectionIndex] ? (
                      <span className="text-amber-300 font-sans text-xs font-semibold">
                        Bucle activo: {normalizedSections[loopSectionIndex].label}
                      </span>
                    ) : (
                      <span className="text-zinc-500 font-sans text-xs">
                        {cueEnabled ? 'Modo Ensayo: Pista + Click/Guía' : 'Modo Escucha: Pista MP3'}
                      </span>
                    )}
                    <span>{formatTimeDisplay(duration)}</span>
                  </div>
                </div>

                {/* Main Tactile Transport Buttons */}
                <div className="flex items-center justify-center gap-4 sm:gap-6 py-1">
                  <button
                    type="button"
                    onClick={() => setRepeatMode((m) => (m === 'setlist' ? 'one' : 'setlist'))}
                    title={
                      repeatMode === 'one'
                        ? 'Repetir esta canción indefinidamente'
                        : 'Continuar con el Setlist'
                    }
                    className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                      repeatMode === 'one'
                        ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                        : 'border-white/10 bg-[#131722] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Repeat size={16} />
                  </button>

                  <button
                    type="button"
                    onClick={goPrevSong}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#131722] text-zinc-200 hover:bg-[#1a2030] active:scale-95 transition-all cursor-pointer"
                    title="Inicio / Canción anterior"
                  >
                    <SkipBack size={20} />
                  </button>

                  <button
                    type="button"
                    onClick={togglePlayPause}
                    disabled={isPreparingAudio || currentVaultEval.status === 'no_mix'}
                    className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e11d48] text-white shadow-lg shadow-[#e11d48]/25 hover:bg-[#be123c] active:scale-95 transition-all cursor-pointer disabled:opacity-40"
                    title={isPlaying ? 'Pausar' : 'Reproducir'}
                  >
                    {isPreparingAudio ? (
                      <Loader2 size={26} className="animate-spin" />
                    ) : isPlaying ? (
                      <Pause size={28} />
                    ) : (
                      <Play size={28} className="ml-1" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => goNextSong(true)}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#131722] text-zinc-200 hover:bg-[#1a2030] active:scale-95 transition-all cursor-pointer"
                    title="Siguiente canción"
                  >
                    <SkipForward size={20} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setLoopSectionIndex(null)}
                    disabled={loopSectionIndex === null}
                    title="Quitar bucle de sección"
                    className={`flex h-10 px-3 items-center justify-center rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                      loopSectionIndex !== null
                        ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                        : 'border-white/5 bg-[#131722]/50 text-zinc-600 cursor-default'
                    }`}
                  >
                    Loop Off
                  </button>
                </div>
              </div>

              {/* Pocket Mixer: Pista Musical + Click / Voz Guía MP3 */}
              <div className="rounded-2xl border border-white/[0.08] bg-[#10141e] p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                      Mezcla de Práctica Personal
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Escucha solo la música o activa el Click y la Voz Guía reales de Live Concert
                    </p>
                  </div>

                  {/* Quick Mode Presets */}
                  <div className="flex items-center gap-1.5 rounded-xl bg-[#090b10] p-1 border border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => void handleSetCueMode(false, { foh: 1.0, cue: cueVolume })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        !cueEnabled
                          ? 'bg-[#e11d48] text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Solo Música
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSetCueMode(true, { foh: 0.85, cue: 0.95 })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        cueEnabled && fohVolume > 0.05
                          ? 'bg-amber-500 text-zinc-950 font-bold'
                          : 'text-zinc-400 hover:text-amber-300'
                      }`}
                    >
                      + Click / Voz Guía
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSetCueMode(true, { foh: 0, cue: 1.0 })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        cueEnabled && fohVolume <= 0.05
                          ? 'bg-amber-500 text-zinc-950 font-bold'
                          : 'text-zinc-400 hover:text-amber-300'
                      }`}
                    >
                      Solo Click
                    </button>
                  </div>
                </div>

                {/* Volume Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  {/* FOH Music Slider */}
                  <div className="flex items-center gap-3 rounded-xl bg-[#0b0e15] px-3.5 py-2.5 border border-white/[0.05]">
                    <Music size={15} className="text-rose-400 shrink-0" />
                    <span className="text-xs font-semibold text-zinc-300 w-24 shrink-0">
                      Pista Musical
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={fohVolume}
                      onChange={(e) => setFohVolume(parseFloat(e.target.value))}
                      className="w-full accent-[#e11d48] h-1.5 cursor-pointer"
                    />
                    <span className="w-9 text-right font-mono text-[11px] text-zinc-400 tabular-nums">
                      {Math.round(fohVolume * 100)}%
                    </span>
                  </div>

                  {/* CUE Click / Guide Slider */}
                  <div
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 border transition-colors ${
                      cueEnabled
                        ? 'bg-amber-500/[0.07] border-amber-500/30'
                        : 'bg-[#0b0e15] border-white/[0.05] opacity-65'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void handleSetCueMode(!cueEnabled)}
                      className="shrink-0 text-amber-400 hover:text-amber-300 cursor-pointer"
                      title={cueEnabled ? 'Desactivar Click/Guía' : 'Activar Click/Guía'}
                    >
                      {cueEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                    <span className="text-xs font-semibold text-zinc-300 w-24 shrink-0">
                      Click & Guía
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={cueVolume}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCueVolume(val);
                        if (!cueEnabled && val > 0.05) {
                          void handleSetCueMode(true, { foh: fohVolume, cue: val });
                        }
                      }}
                      className="w-full accent-amber-400 h-1.5 cursor-pointer"
                    />
                    <span className="w-9 text-right font-mono text-[11px] text-amber-300 tabular-nums">
                      {cueEnabled ? `${Math.round(cueVolume * 100)}%` : 'OFF'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Study Aids: Section Jump / Loop + Chords & Lyrics */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-white/[0.07] pb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStudyPanelTab('sections')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                        studyPanelTab === 'sections'
                          ? 'bg-white/10 text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Estructura & Secciones ({normalizedSections.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStudyPanelTab('chords_lyrics')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                        studyPanelTab === 'chords_lyrics'
                          ? 'bg-white/10 text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Acordes & Letra
                    </button>
                  </div>

                  {studyPanelTab === 'sections' && normalizedSections.length > 0 && (
                    <span className="text-[11px] text-zinc-500 hidden sm:inline">
                      1 toque = saltar · icono ↻ = repetir sección en bucle
                    </span>
                  )}
                </div>

                {studyPanelTab === 'sections' ? (
                  normalizedSections.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {normalizedSections.map((sec) => {
                        const isActiveSec = activeSectionIndex === sec.index;
                        const isLoopingSec = loopSectionIndex === sec.index;
                        return (
                          <div
                            key={`${sec.index}-${sec.label}`}
                            className={`flex items-center justify-between rounded-xl border px-3 py-2.5 transition-all ${
                              isLoopingSec
                                ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                                : isActiveSec
                                  ? 'border-[#e11d48] bg-[#e11d48]/15 text-white'
                                  : 'border-white/[0.07] bg-[#10141e] text-zinc-300 hover:border-white/20'
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
                              <div className="font-mono text-[10px] text-zinc-400 tabular-nums">
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
                                  ? 'Desactivar bucle de esta sección'
                                  : `Repetir "${sec.label}" en bucle`
                              }
                              className={`ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                                isLoopingSec
                                  ? 'bg-amber-400 text-zinc-950'
                                  : 'bg-white/[0.05] text-zinc-400 hover:text-white'
                              }`}
                            >
                              <Repeat size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-xs text-zinc-500">
                      Esta canción no tiene marcadores de sección definidos en Studio Prompter.
                    </p>
                  )
                ) : (
                  <div className="space-y-4">
                    {/* Live Active Chord Strip */}
                    {chordsList.length > 0 && (
                      <div className="rounded-xl border border-white/[0.07] bg-[#10141e] p-3.5">
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          Progresión de Acordes (Toca para ir al compás)
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                          {chordsList.map((ch: any, idx: number) => {
                            const isCurrentChord = idx === activeChordIndex;
                            return (
                              <button
                                key={`${idx}-${ch.chord}-${ch.time}`}
                                type="button"
                                onClick={() => seekToGlobal(preRollSec + Math.max(0, Number(ch.time) || 0))}
                                className={`rounded-lg px-2.5 py-1 font-mono text-xs font-bold transition-colors cursor-pointer ${
                                  isCurrentChord
                                    ? 'bg-[#e11d48] text-white scale-105'
                                    : 'bg-[#171c2b] text-zinc-300 hover:bg-[#20273b]'
                                }`}
                              >
                                {ch.chord}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Synchronized Lyrics */}
                    {lyricsList.length > 0 ? (
                      <div className="rounded-xl border border-white/[0.07] bg-[#10141e] p-4 max-h-64 overflow-y-auto space-y-2 custom-scrollbar">
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
                              className={`block w-full text-left rounded-lg px-3 py-1.5 text-sm transition-colors cursor-pointer ${
                                isCurrentLine
                                  ? 'bg-white/[0.08] font-bold text-white'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {line.text}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      chordsList.length === 0 && (
                        <p className="py-6 text-center text-xs text-zinc-500">
                          No hay acordes ni letras registradas aún para esta pista.
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-zinc-500">
              <div>
                <Headphones size={42} className="mx-auto mb-3 opacity-35" />
                <p className="text-sm font-semibold text-zinc-300">
                  Selecciona una canción del repertorio para comenzar tu práctica
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Persistent Compact Mini-Player Bar on Mobile when browsing Playlist tab */}
      {mobileTab === 'playlist' && currentSong && (
        <div className="shrink-0 lg:hidden border-t border-white/10 bg-[#111520] px-3.5 py-2.5">
          <div className="mb-2 h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-[#e11d48] transition-[width] duration-100"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() => setMobileTab('player')}
              className="min-w-0 flex-1 text-left cursor-pointer"
            >
              <div className="truncate text-xs font-bold text-white">{currentSong.title}</div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                <span className="font-mono tabular-nums">
                  {formatTimeDisplay(globalTime)} / {formatTimeDisplay(duration)}
                </span>
                {cueEnabled && (
                  <span className="text-amber-300 font-semibold">· +Click/Guía</span>
                )}
              </div>
            </button>

            <button
              type="button"
              onClick={() => void handleSetCueMode(!cueEnabled)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold border transition-colors cursor-pointer ${
                cueEnabled
                  ? 'border-amber-400 bg-amber-500 text-zinc-950'
                  : 'border-white/15 bg-[#181e2d] text-zinc-300'
              }`}
            >
              {cueEnabled ? 'CLICK ON' : '+ CLICK'}
            </button>

            <button
              type="button"
              onClick={togglePlayPause}
              disabled={isPreparingAudio}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e11d48] text-white cursor-pointer"
            >
              {isPreparingAudio ? (
                <Loader2 size={17} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={18} />
              ) : (
                <Play size={18} className="ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => goNextSong(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#181e2d] text-zinc-200 cursor-pointer"
            >
              <SkipForward size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
