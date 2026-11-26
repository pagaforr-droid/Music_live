import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSyncSlave } from '../hooks/useSyncSlave';
import {
  computePhaseLockedSlaveStart,
  computeSlavePllServoAdjustment,
  estimateSlaveAcousticOutputLatencyMs,
  measureAudioOutputClockMapping,
  nowSharedMs,
} from '../hooks/useSyncMaster';
import {
  Volume2,
  Power,
  Music,
  Activity,
  Headphones,
  ArrowLeft,
  LogOut,
  CloudDownload,
  Check,
  RefreshCw,
  Loader2,
  ListMusic,
  Wifi,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { Prompter } from '../components/Prompter';
import { useAuth } from '../contexts/AuthContext';
import {
  APP_MODULES,
  getFirstAllowedPathForUser,
} from '../services/userManagementService';
import {
  CUE_NAMES,
  CueBuffersMap,
  CueOffsetsMap,
  computeSongCueSignature,
  loadCueBuffers,
  synthesizeLiveCueBuffer,
  shouldSynthesizeCueInRehearsalMp3Mode,
  resolveEffectivePreRoll,
  resolveEffectivePreRollBars,
  resolveLyricsTimeMapping,
} from '../utils/cueEngine';
import {
  type LocalMp3TrackMeta,
  type PracticeCatalogSnapshot,
  type PracticeSetlistSummary,
  type PracticeSongItem,
  computeSongChannelSignature,
  downloadInEarPlaylistToLocalVault,
  ensureSongMp3CachedInDevice,
  evaluateInEarPlaylistReadiness,
  evaluateSongVaultState,
  fetchFreshSongRowFromSupabase,
  formatBytesCompact,
  readCachedPracticeCatalog,
  readDecryptedTrackArrayBuffer,
  readLocalVaultSummary,
  requestPersistentDeviceStorage,
  resolvePreferredMp3Source,
  syncPracticeCatalogFromSupabase,
  wipeAudioArrayBufferInRam,
} from '../services/musicianLocalAudioVault';

const FAKE_BAND_ID = '00000000-0000-0000-0000-000000000000';
const INEAR_ACTIVE_SETLIST_KEY = 'tandu_inear_active_setlist_v1';
const HARD_SEEK_COOLDOWN_MS = 8000;
const UI_RENDER_INTERVAL_MS = 44; // ~22 FPS en el celular: UI fluida sin saturar el hilo principal de audio/red

function estimateAudioBufferRamBytes(buf: AudioBuffer | null | undefined): number {
  if (!buf) return 0;
  return (buf.length || 0) * (buf.numberOfChannels || 1) * 4;
}

export default function MobileInEar() {
  const navigate = useNavigate();
  const { userProfile, signOut } = useAuth();

  // Estado de conexión: el dispositivo NO se conecta ni anuncia presencia hasta descargar la Playlist y tocar "Conectar"
  const [hasInteracted, setHasInteracted] = useState(false);
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Catálogo de Playlists (Setlists) y Bóveda Local MP3 (IndexedDB)
  const [catalog, setCatalog] = useState<PracticeCatalogSnapshot | null>(null);
  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(INEAR_ACTIVE_SETLIST_KEY);
    } catch {
      return null;
    }
  });
  const [tracksBySongId, setTracksBySongId] = useState<
    Record<string, LocalMp3TrackMeta>
  >({});
  const [isSyncingCatalog, setIsSyncingCatalog] = useState<boolean>(false);
  const [isDownloadingPlaylist, setIsDownloadingPlaylist] =
    useState<boolean>(false);
  const [downloadProgressText, setDownloadProgressText] = useState<string>('');
  const [downloadProgressPct, setDownloadProgressPct] = useState<number>(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);

  // Estado de buffers de la canción activa en RAM
  const cueBufferRef = useRef<AudioBuffer | null>(null);
  const fohBufferRef = useRef<AudioBuffer | null>(null);
  const [isSongBuffersReady, setIsSongBuffersReady] = useState<boolean>(false);
  const [readySongId, setReadySongId] = useState<string | null>(null);
  const [readyCueSig, setReadyCueSig] = useState<string | null>(null);
  const [audioCtxState, setAudioCtxState] = useState<
    'running' | 'suspended' | 'interrupted' | 'closed'
  >('running');
  const [audioBlockedReason, setAudioBlockedReason] = useState<
    'suspended' | 'interrupted' | 'stalled' | null
  >(null);
  const [bluetoothRiskWarning, setBluetoothRiskWarning] = useState<boolean>(false);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [ramUsageMb, setRamUsageMb] = useState<number>(0);
  const [liveDriftMs, setLiveDriftMs] = useState<number>(0);
  const [livePllRate, setLivePllRate] = useState<number>(1.0);
  const [loadStatus, setLoadStatus] = useState<string>(
    'Sincronizado · Esperando canción del Administrador...'
  );

  // Sobreescrituras frescas desde Supabase si el PC anunció una firma cueSig distinta al catálogo local
  const [freshSongOverrides, setFreshSongOverrides] = useState<
    Record<string, PracticeSongItem>
  >({});

  // Caché de las 11 voces guía PCM WAV para síntesis de respaldo en RAM
  const voiceCueBuffersRef = useRef<CueBuffersMap>({});
  const voiceCueOffsetsRef = useRef<CueOffsetsMap>({});
  const voiceCueLoadPromiseRef = useRef<Promise<number> | null>(null);

  const deviceLabel = useMemo(() => {
    return (
      userProfile?.full_name ||
      userProfile?.email ||
      'Músico In-Ear'
    );
  }, [userProfile]);

  const {
    connectionStatus,
    transportMode,
    masterSetlistId,
    currentSongId,
    nextSongId,
    songData: wireSongData,
    nextSongData: wireNextSongData,
    isPlaying,
    masterTransport,
    heartbeatAnchor,
    clockOffset,
    rttMs,
    requestMasterState,
    triggerNtpRecalibration,
  } = useSyncSlave(FAKE_BAND_ID, {
    enabled: hasInteracted,
    deviceLabel,
    setlistId: selectedSetlistId,
    songReady: isSongBuffersReady && audioCtxState === 'running',
    readySongId,
    readyCueSig,
    audioState: audioCtxState,
    driftMs: liveDriftMs,
  });

  // Mapa O(1) de canciones completas en el catálogo local del celular (incluye chords, lyrics, beatTimes)
  const catalogSongsById = useMemo(() => {
    const map = new Map<string, PracticeSongItem>();
    if (!catalog) return map;
    for (const s of catalog.allLiveSongs || []) {
      if (s?.id) map.set(s.id, s);
    }
    for (const list of Object.values(catalog.setlistSongsMap || {})) {
      if (!Array.isArray(list)) continue;
      for (const s of list) {
        if (s?.id && !map.has(s.id)) map.set(s.id, s);
      }
    }
    return map;
  }, [catalog]);

  const mergeCatalogAndWireSong = useCallback(
    (songId: string | null | undefined, wireSong: any): any => {
      const resolvedId = wireSong?.id || songId || null;
      if (!resolvedId) return null;
      const freshOverride = freshSongOverrides[resolvedId];
      const localFull = freshOverride || catalogSongsById.get(resolvedId);
      if (!localFull) return wireSong || null;
      if (!wireSong) return localFull;
      return {
        ...localFull,
        ...wireSong,
        prompter_data: {
          ...(localFull.prompter_data || {}),
          ...(wireSong.prompter_data || {}),
          // Preservar arreglos visuales completos de la memoria local si el paquete Realtime vino compactado
          lyrics: wireSong.prompter_data?.lyrics ?? localFull.prompter_data?.lyrics,
          chords: wireSong.prompter_data?.chords ?? localFull.prompter_data?.chords,
          beatTimes: wireSong.prompter_data?.beatTimes ?? localFull.prompter_data?.beatTimes,
          sections: wireSong.prompter_data?.sections ?? localFull.prompter_data?.sections,
        },
      };
    },
    [catalogSongsById, freshSongOverrides]
  );

  const songData = useMemo(
    () => mergeCatalogAndWireSong(currentSongId, wireSongData),
    [currentSongId, wireSongData, mergeCatalogAndWireSong]
  );

  const nextSongData = useMemo(
    () => mergeCatalogAndWireSong(nextSongId, wireNextSongData),
    [nextSongId, wireNextSongData, mergeCatalogAndWireSong]
  );

  const songDataRef = useRef<any>(null);
  songDataRef.current = songData;

  const isPlayingRef = useRef<boolean>(false);
  const clockOffsetRef = useRef<number>(0);
  const masterTransportRef = useRef(masterTransport);
  masterTransportRef.current = masterTransport;
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    clockOffsetRef.current = clockOffset;
  }, [clockOffset]);

  // Ajuste fino opcional por celular (-120ms a +120ms) para compensar adaptadores USB-C / DAC específicos
  const [syncTrimMs, setSyncTrimMs] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('tandu_inear_sync_trim_ms_v1') || 0);
      return Number.isFinite(saved) ? Math.max(-120, Math.min(120, saved)) : 0;
    } catch {
      return 0;
    }
  });
  const syncTrimMsRef = useRef<number>(syncTrimMs);
  useEffect(() => {
    syncTrimMsRef.current = syncTrimMs;
    try {
      localStorage.setItem('tandu_inear_sync_trim_ms_v1', String(syncTrimMs));
    } catch {}
  }, [syncTrimMs]);

  // Si el Master informa un setlist activo, seleccionarlo automáticamente
  useEffect(() => {
    if (
      masterSetlistId &&
      catalog?.setlists.some((s) => s.id === masterSetlistId)
    ) {
      setSelectedSetlistId(masterSetlistId);
      try {
        localStorage.setItem(INEAR_ACTIVE_SETLIST_KEY, masterSetlistId);
      } catch {}
    }
  }, [masterSetlistId, catalog]);

  const cueSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fohSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const keepAliveSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const keepAliveGainRef = useRef<GainNode | null>(null);
  const isAudioNodePlayingRef = useRef<boolean>(false);
  const loadedSongSignatureRef = useRef<string>('');
  const loadRequestIdRef = useRef<number>(0);
  // Presupuesto estricto en RAM: máximo 2 canciones (actual + siguiente) con LRU real para cero OOM en celulares
  const decodedRamCacheRef = useRef<
    Map<
      string,
      {
        songId: string;
        cueSig: string;
        fohBuffer: AudioBuffer;
        cueBuffer: AudioBuffer;
        ramBytes: number;
      }
    >
  >(new Map());
  const inflightDecodeMapRef = useRef<
    Map<
      string,
      Promise<{
        songId: string;
        cueSig: string;
        fohBuffer: AudioBuffer;
        cueBuffer: AudioBuffer;
        ramBytes: number;
      } | null>
    >
  >(new Map());
  const masterTimelineAnchorRef = useRef<{
    startAt: number;
    offset: number;
    zeroOriginMs: number;
    songId?: string;
    seq: number;
  } | null>(null);
  const playbackClockRef = useRef<{
    whenContextSec: number;
    anchorContextSec: number;
    anchorBufferOffsetSec: number;
    currentRate: number;
    startedAtMs: number;
  }>({
    whenContextSec: 0,
    anchorContextSec: 0,
    anchorBufferOffsetSec: 0,
    currentRate: 1.0,
    startedAtMs: 0,
  });
  const activePlaySeqRef = useRef<number>(0);
  const activePlaySessionRef = useRef<string>('');
  const consecutiveHardDriftCountRef = useRef<number>(0);
  const lastHardSeekAtMsRef = useRef<number>(0);
  const lastUiTimeUpdateMsRef = useRef<number>(0);
  const calibratedFallbackTrimMsRef = useRef<number | null>(null);
  const cueGainRef = useRef<GainNode | null>(null);
  const fohGainRef = useRef<GainNode | null>(null);
  const fadeEnvelopeGainRef = useRef<GainNode | null>(null);
  const wakeLockRef = useRef<any>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const animationFrameRef = useRef(0);

  const [cueVolume, setCueVolume] = useState(1);
  const [bandVolume, setBandVolume] = useState(0.8);

  const stopKeepAliveNode = useCallback(() => {
    try {
      keepAliveSourceRef.current?.stop();
      keepAliveSourceRef.current?.disconnect();
    } catch {}
    try {
      keepAliveGainRef.current?.disconnect();
    } catch {}
    keepAliveSourceRef.current = null;
    keepAliveGainRef.current = null;
  }, []);

  const stopActiveSources = useCallback(() => {
    try {
      cueSourceRef.current?.stop();
      cueSourceRef.current?.disconnect();
    } catch {}
    try {
      fohSourceRef.current?.stop();
      fohSourceRef.current?.disconnect();
    } catch {}
    try {
      fadeEnvelopeGainRef.current?.disconnect();
    } catch {}
    cueSourceRef.current = null;
    fohSourceRef.current = null;
    fadeEnvelopeGainRef.current = null;
    isAudioNodePlayingRef.current = false;
    playbackClockRef.current.currentRate = 1.0;
    setLivePllRate(1.0);
    cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const cleanupAudioAndWakeLock = useCallback(() => {
    downloadAbortRef.current?.abort();
    stopActiveSources();
    stopKeepAliveNode();
    decodedRamCacheRef.current.clear();
    setRamUsageMb(0);
    if (wakeLockRef.current) {
      wakeLockRef.current.release?.().catch?.(() => {});
      wakeLockRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    setAudioCtxState('closed');
  }, [stopActiveSources, stopKeepAliveNode]);

  useEffect(() => {
    return () => {
      cleanupAudioAndWakeLock();
    };
  }, [cleanupAudioAndWakeLock]);

  // Cargar catálogo de Playlists y resumen de la bóveda local al entrar
  const loadCatalogAndVaultStatus = useCallback(async (forceRemote = false) => {
    setIsSyncingCatalog(true);
    setDownloadError(null);
    try {
      const [cachedCat, localSummary] = await Promise.all([
        readCachedPracticeCatalog(),
        readLocalVaultSummary(),
      ]);
      if (cachedCat) {
        setCatalog(cachedCat);
      }
      setTracksBySongId(localSummary.tracksBySongId);

      const syncedCat = await syncPracticeCatalogFromSupabase({
        force: forceRemote,
      });
      const finalCat = syncedCat || cachedCat;
      if (finalCat) {
        setCatalog(finalCat);
        setSelectedSetlistId((prev) => {
          if (prev && finalCat.setlists.some((s) => s.id === prev)) {
            return prev;
          }
          const firstId = finalCat.setlists[0]?.id || null;
          if (firstId) {
            try {
              localStorage.setItem(INEAR_ACTIVE_SETLIST_KEY, firstId);
            } catch {}
          }
          return firstId;
        });
      }

      const freshSummary = await readLocalVaultSummary();
      setTracksBySongId(freshSummary.tracksBySongId);
    } catch (err: any) {
      setDownloadError(
        err?.message || 'Error al verificar las playlists disponibles.'
      );
    } finally {
      setIsSyncingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void requestPersistentDeviceStorage();
    // En In-Ear Monitor sincronizar siempre el catálogo fresco al entrar para tener los últimos MP3 exportados
    void loadCatalogAndVaultStatus(true);
  }, [loadCatalogAndVaultStatus]);

  // Canciones de la Playlist seleccionada actualmente
  const activePlaylistSongs: PracticeSongItem[] = useMemo(() => {
    if (!catalog) return [];
    if (
      selectedSetlistId &&
      Array.isArray(catalog.setlistSongsMap[selectedSetlistId])
    ) {
      return catalog.setlistSongsMap[selectedSetlistId];
    }
    return catalog.allLiveSongs || [];
  }, [catalog, selectedSetlistId]);

  const playlistReadiness = useMemo(() => {
    return evaluateInEarPlaylistReadiness(activePlaylistSongs, tracksBySongId);
  }, [activePlaylistSongs, tracksBySongId]);

  const selectedSetlistTitle = useMemo(() => {
    if (!catalog || !selectedSetlistId) return 'Repertorio General';
    return (
      catalog.setlists.find((s) => s.id === selectedSetlistId)?.title ||
      'Playlist Seleccionada'
    );
  }, [catalog, selectedSetlistId]);

  // Descargar toda la Playlist seleccionada en MP3 a la bóveda local cifrada (IndexedDB)
  const handleDownloadPlaylistMp3 = async (forceRefresh = false) => {
    if (isDownloadingPlaylist) return;

    downloadAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    downloadAbortRef.current = abortCtrl;

    setIsDownloadingPlaylist(true);
    setDownloadError(null);
    setDownloadProgressPct(2);
    setDownloadProgressText('Verificando playlist y memoria local del celular...');

    try {
      void requestPersistentDeviceStorage();

      // Si alguna canción aparecía sin mezcla o se pide forzar, refrescar catálogo desde Supabase primero
      let targetSongs = activePlaylistSongs;
      if (
        forceRefresh ||
        playlistReadiness.exportableSongs.length === 0 ||
        playlistReadiness.noMixSongs.length > 0
      ) {
        const refreshed = await syncPracticeCatalogFromSupabase({ force: true });
        if (refreshed) {
          setCatalog(refreshed);
          targetSongs =
            selectedSetlistId && Array.isArray(refreshed.setlistSongsMap[selectedSetlistId])
              ? refreshed.setlistSongsMap[selectedSetlistId]
              : refreshed.allLiveSongs || [];
        }
      }

      const currentReadiness = evaluateInEarPlaylistReadiness(targetSongs, tracksBySongId);
      if (currentReadiness.exportableSongs.length === 0) {
        throw new Error(
          'Las canciones de esta playlist aún no tienen mezclas exportadas desde Studio.'
        );
      }

      const runDownloadBatch = async (songsBatch: PracticeSongItem[]) => {
        return downloadInEarPlaylistToLocalVault({
          songs: songsBatch,
          tracksBySongId,
          forceRefresh,
          signal: abortCtrl.signal,
          onTrackSaved: (songId, meta) => {
            setTracksBySongId((prev) => ({ ...prev, [songId]: meta }));
          },
          onSongProgress: ({ currentIndex, totalToDownload, detail }) => {
            setDownloadProgressText(detail);
            const pct = Math.min(
              99,
              Math.max(4, Math.round(((currentIndex - 0.35) / Math.max(1, totalToDownload)) * 100))
            );
            setDownloadProgressPct(pct);
          },
        });
      };

      let result;
      try {
        result = await runDownloadBatch(targetSongs);
      } catch (firstErr: any) {
        if (firstErr?.name === 'AbortError') throw firstErr;
        // Si falló por un URL antiguo en caché (HTTP 400/404), refrescar catálogo y reintentar automáticamente una vez
        if (/HTTP (400|403|404)/i.test(String(firstErr?.message || ''))) {
          setDownloadProgressText('Actualizando enlaces recientes desde la nube y reintentando...');
          const freshCat = await syncPracticeCatalogFromSupabase({ force: true });
          if (freshCat) {
            setCatalog(freshCat);
            const freshSongs =
              selectedSetlistId && Array.isArray(freshCat.setlistSongsMap[selectedSetlistId])
                ? freshCat.setlistSongsMap[selectedSetlistId]
                : freshCat.allLiveSongs || [];
            result = await runDownloadBatch(freshSongs);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }

      setTracksBySongId(result.summary.tracksBySongId);
      setDownloadProgressPct(100);
      setDownloadProgressText(
        result.downloadedCount > 0
          ? `¡Playlist guardada en el celular (${result.downloadedCount} descargadas${
              result.skippedCachedCount > 0
                ? `, ${result.skippedCachedCount} ya estaban en memoria`
                : ''
            })!`
          : `¡Playlist lista desde memoria local (${result.skippedCachedCount} canciones · 0 MB de red)!`
      );
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setDownloadError(
        err?.message || 'No se pudo completar la descarga de la playlist en el celular.'
      );
    } finally {
      setIsDownloadingPlaylist(false);
    }
  };

  const ensureVoiceCueWavsLoaded = useCallback(
    async (ctx: AudioContext): Promise<number> => {
      const existing = Object.keys(voiceCueBuffersRef.current).length;
      if (existing >= CUE_NAMES.length) return existing;
      if (voiceCueLoadPromiseRef.current) return voiceCueLoadPromiseRef.current;

      const promise = (async () => {
        try {
          const loaded = await loadCueBuffers(ctx);
          voiceCueBuffersRef.current = {
            ...voiceCueBuffersRef.current,
            ...loaded.cueBuffers,
          };
          voiceCueOffsetsRef.current = {
            ...voiceCueOffsetsRef.current,
            ...loaded.cueOffsets,
          };
          return Object.keys(voiceCueBuffersRef.current).length;
        } catch {
          return Object.keys(voiceCueBuffersRef.current).length;
        } finally {
          voiceCueLoadPromiseRef.current = null;
        }
      })();

      voiceCueLoadPromiseRef.current = promise;
      return promise;
    },
    []
  );

  const resolveMainMenuPath = (): string => {
    const preferred = getFirstAllowedPathForUser(userProfile);
    if (preferred && preferred !== '/mobile' && preferred !== '/login') {
      return preferred;
    }
    if (userProfile) {
      for (const modId of userProfile.allowed_modules) {
        if (modId === 'mobile_inear') continue;
        const found = APP_MODULES.find((m) => m.id === modId);
        if (found && found.primaryPath !== '/mobile') {
          return found.primaryPath;
        }
      }
    }
    return '/practice';
  };

  const handleGoToMainMenu = () => {
    cleanupAudioAndWakeLock();
    navigate(resolveMainMenuPath(), {
      replace: true,
      state: { openSidebar: true },
    });
  };

  const handleSignOut = async () => {
    cleanupAudioAndWakeLock();
    await signOut();
    navigate('/login', { replace: true });
  };

  const ensureKeepAliveRunning = useCallback((ctx: AudioContext) => {
    if (keepAliveSourceRef.current) return;
    try {
      const sr = ctx.sampleRate || 44100;
      const silentLoopBuffer = ctx.createBuffer(1, sr, sr);
      const kaSource = ctx.createBufferSource();
      kaSource.buffer = silentLoopBuffer;
      kaSource.loop = true;
      const kaGain = ctx.createGain();
      kaGain.gain.value = 0;
      kaSource.connect(kaGain);
      kaGain.connect(ctx.destination);
      kaSource.start();
      keepAliveSourceRef.current = kaSource;
      keepAliveGainRef.current = kaGain;
    } catch {}
  }, []);

  const evaluateBluetoothOutputRisk = useCallback(async (ctx: AudioContext | null) => {
    let btDetected = false;
    if (ctx && Number((ctx as any).outputLatency) > 0.11) {
      btDetected = true;
    }
    try {
      if (!btDetected && navigator.mediaDevices?.enumerateDevices) {
        const devs = await navigator.mediaDevices.enumerateDevices();
        btDetected = devs.some(
          (d) =>
            d.kind === 'audiooutput' &&
            /bluetooth|airpods|buds|hands-free|wireless|\bbt\b/i.test(d.label || '')
        );
      }
    } catch {}
    setBluetoothRiskWarning(btDetected);
  }, []);

  const handleDisconnectFromSession = () => {
    stopActiveSources();
    stopKeepAliveNode();
    masterTimelineAnchorRef.current = null;
    activePlaySeqRef.current = 0;
    activePlaySessionRef.current = '';
    setHasInteracted(false);
    setIsSongBuffersReady(false);
    setReadySongId(null);
    setReadyCueSig(null);
    setAudioBlockedReason(null);
    loadedSongSignatureRef.current = '';
  };

  // Paso 2: Inicializar AudioContext de baja latencia + iOS AudioSession playback + Keep-Alive DAC cálido
  const handleConnect = async () => {
    // Configurar iOS 17+ Web AudioSession en modo 'playback' para ignorar el switch físico de silencio
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).audioSession) {
        (navigator as any).audioSession.type = 'playback';
      }
    } catch {}

    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    let ctx: AudioContext;
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      ctx = audioCtxRef.current;
    } else {
      try {
        ctx = new AudioContextClass({ latencyHint: 'interactive' });
      } catch {
        ctx = new AudioContextClass();
      }
    }

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }

    if (!cueGainRef.current || cueGainRef.current.context !== ctx) {
      const cGain = ctx.createGain();
      cGain.connect(ctx.destination);
      cGain.gain.value = cueVolume;
      cueGainRef.current = cGain;
    }

    if (!fohGainRef.current || fohGainRef.current.context !== ctx) {
      const fGain = ctx.createGain();
      fGain.connect(ctx.destination);
      fGain.gain.value = bandVolume;
      fohGainRef.current = fGain;
    }

    stopKeepAliveNode();
    ensureKeepAliveRunning(ctx);
    calibratedFallbackTrimMsRef.current = null;

    audioCtxRef.current = ctx;
    setAudioCtx(ctx);
    setAudioCtxState((ctx.state as any) || 'running');
    setAudioBlockedReason(ctx.state === 'running' ? null : 'suspended');
    setHasInteracted(true);
    setLoadStatus('Sincronizando reloj de alta precisión con el Administrador...');

    void evaluateBluetoothOutputRisk(ctx);
    void ensureVoiceCueWavsLoaded(ctx);

    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('Wake Lock error:', err);
    }
  };

  // Re-activar AudioContext y WakeLock si el músico vuelve a la pestaña en su celular
  useEffect(() => {
    if (!hasInteracted) return;
    const onVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
          try {
            await ctx.resume();
          } catch {}
          const nextState = (ctx.state as any) || 'suspended';
          setAudioCtxState(nextState);
          setAudioBlockedReason(nextState === 'running' ? null : 'suspended');
        }
        try {
          if ('wakeLock' in navigator && !wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          }
        } catch {}
        requestMasterState();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [hasInteracted, requestMasterState]);

  // Watchdog activo cada 500ms: detecta suspensión, interrupción por llamada o congelamiento de `currentTime`
  useEffect(() => {
    if (!hasInteracted || !audioCtx) return;

    const handleStateChange = () => {
      const st = (audioCtx.state as any) || 'running';
      setAudioCtxState(st);
      if (st === 'running') {
        setAudioBlockedReason(null);
        ensureKeepAliveRunning(audioCtx);
      } else if (st === 'interrupted') {
        setAudioBlockedReason('interrupted');
      } else if (st === 'suspended') {
        setAudioBlockedReason('suspended');
      }
    };

    audioCtx.addEventListener?.('statechange', handleStateChange);
    handleStateChange();

    let prevCtxTime = audioCtx.currentTime;
    const watchdogId = window.setInterval(() => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const st = (ctx.state as any) || 'running';
      setAudioCtxState(st);
      if (st === 'interrupted') {
        setAudioBlockedReason('interrupted');
        prevCtxTime = ctx.currentTime;
        return;
      }
      if (st !== 'running') {
        setAudioBlockedReason('suspended');
        prevCtxTime = ctx.currentTime;
        return;
      }
      if (
        isAudioNodePlayingRef.current &&
        ctx.currentTime > playbackClockRef.current.whenContextSec + 0.35 &&
        ctx.currentTime <= prevCtxTime + 0.002
      ) {
        setAudioBlockedReason('stalled');
      } else {
        setAudioBlockedReason(null);
      }
      prevCtxTime = ctx.currentTime;
    }, 500);

    return () => {
      audioCtx.removeEventListener?.('statechange', handleStateChange);
      window.clearInterval(watchdogId);
    };
  }, [hasInteracted, audioCtx, ensureKeepAliveRunning]);

  useEffect(() => {
    if (cueGainRef.current) cueGainRef.current.gain.value = cueVolume;
  }, [cueVolume]);

  useEffect(() => {
    if (fohGainRef.current) fohGainRef.current.gain.value = bandVolume;
  }, [bandVolume]);

  const getPreRoll = useCallback((song: any) => {
    return resolveEffectivePreRoll(song);
  }, []);

  // Solo añade fallback congelado una vez cuando el navegador móvil no reporta latencia vía getOutputTimestamp()
  const getEffectiveSlaveExtraTrimMs = useCallback((ctx: AudioContext | null) => {
    if (calibratedFallbackTrimMsRef.current === null && ctx) {
      calibratedFallbackTrimMsRef.current = estimateSlaveAcousticOutputLatencyMs(ctx);
    }
    const baseFallback = calibratedFallbackTrimMsRef.current ?? 0;
    return baseFallback + (syncTrimMsRef.current || 0);
  }, []);

  const getCurrentSlaveBufferPositionSec = useCallback((ctxNow: number): number => {
    const clock = playbackClockRef.current;
    if (ctxNow <= clock.whenContextSec) {
      return Math.max(
        0,
        clock.anchorBufferOffsetSec - (clock.whenContextSec - ctxNow)
      );
    }
    const elapsedSinceAnchor = Math.max(0, ctxNow - clock.anchorContextSec);
    return Math.max(
      0,
      clock.anchorBufferOffsetSec + elapsedSinceAnchor * clock.currentRate
    );
  }, []);

  const applySlavePlaybackRate = useCallback((ctxNow: number, nextRate: number) => {
    const clock = playbackClockRef.current;
    const clampedRate = Math.max(0.998, Math.min(1.002, Number(nextRate) || 1.0));
    const effectiveNow = Math.max(ctxNow, clock.whenContextSec);
    if (effectiveNow > clock.anchorContextSec) {
      clock.anchorBufferOffsetSec +=
        (effectiveNow - clock.anchorContextSec) * clock.currentRate;
      clock.anchorContextSec = effectiveNow;
    }
    if (Math.abs(clock.currentRate - clampedRate) > 0.00005) {
      clock.currentRate = clampedRate;
      setLivePllRate(clampedRate);
      try {
        cueSourceRef.current?.playbackRate.setValueAtTime(clampedRate, ctxNow);
        fohSourceRef.current?.playbackRate.setValueAtTime(clampedRate, ctxNow);
      } catch {
        if (cueSourceRef.current) cueSourceRef.current.playbackRate.value = clampedRate;
        if (fohSourceRef.current) fohSourceRef.current.playbackRate.value = clampedRate;
      }
    }
    startTimeRef.current = effectiveNow - clock.anchorBufferOffsetSec;
  }, []);

  const updateTime = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isAudioNodePlayingRef.current) return;

    const nowMs = nowSharedMs();
    if (nowMs - lastUiTimeUpdateMsRef.current >= UI_RENDER_INTERVAL_MS) {
      lastUiTimeUpdateMsRef.current = nowMs;
      const mapping = measureAudioOutputClockMapping(ctx);
      const heardCtxSec = mapping?.hasOutputTimestamp
        ? mapping.heardContextTimeSec + (nowMs - mapping.sharedTimeMs) / 1000
        : ctx.currentTime;
      const extraTrimSec = getEffectiveSlaveExtraTrimMs(ctx) / 1000;
      const renderPosSec = getCurrentSlaveBufferPositionSec(heardCtxSec);
      const globalTime = Math.max(0, renderPosSec - extraTrimSec);
      const preRoll = getPreRoll(songDataRef.current);
      setCurrentTime(globalTime - preRoll);
    }

    animationFrameRef.current = requestAnimationFrame(updateTime);
  }, [getCurrentSlaveBufferPositionSec, getEffectiveSlaveExtraTrimMs, getPreRoll]);

  // Lanzamiento de reproducción sincronizada usando mapeo hardware `getOutputTimestamp()` y crossfade opcional
  const startSynchronizedPlayback = useCallback(
    async (trigger: {
      startAt: number;
      offset: number;
      ts?: number;
      songId?: string;
      seq?: number;
      sessionId?: string;
      withCrossfade?: boolean;
    }) => {
      const ctx = audioCtxRef.current;
      const cBuf = cueBufferRef.current;
      const fBuf = fohBufferRef.current;
      if (!ctx || !cBuf || !fBuf || !cueGainRef.current || !fohGainRef.current)
        return;

      if (ctx.state !== 'running') {
        try {
          await ctx.resume();
        } catch {}
        const resumedState = ctx.state as AudioContextState;
        if (resumedState !== 'running') {
          setAudioCtxState(resumedState || 'suspended');
          setAudioBlockedReason('suspended');
          setLoadStatus('Audio bloqueado por el sistema · Toca Reactivar');
          return;
        }
      }

      stopActiveSources();
      ensureKeepAliveRunning(ctx);
      setAudioCtxState('running');
      setAudioBlockedReason(null);

      const envCueGain = ctx.createGain();
      const envFohGain = ctx.createGain();
      envCueGain.connect(cueGainRef.current);
      envFohGain.connect(fohGainRef.current);
      fadeEnvelopeGainRef.current = envFohGain;

      const cSource = ctx.createBufferSource();
      cSource.buffer = cBuf;
      cSource.connect(envCueGain);
      cueSourceRef.current = cSource;

      const fSource = ctx.createBufferSource();
      fSource.buffer = fBuf;
      fSource.connect(envFohGain);
      fohSourceRef.current = fSource;

      // Limpieza de sub-nodo auxiliar cuando termine
      cSource.onended = () => {
        try { envCueGain.disconnect(); } catch {}
      };
      fSource.onended = () => {
        try { envFohGain.disconnect(); } catch {}
      };

      const outputMapping = measureAudioOutputClockMapping(ctx);
      const extraTrimMs = getEffectiveSlaveExtraTrimMs(ctx);
      const schedule = computePhaseLockedSlaveStart({
        startAtMs: trigger.startAt,
        baseOffsetSec: trigger.offset,
        clientNowMs: nowSharedMs(),
        clockOffsetMs: clockOffsetRef.current,
        audioCtxCurrentTimeSec: ctx.currentTime,
        slaveOutputLatencyMs: extraTrimMs,
        bufferDurationSec: fBuf.duration,
        minScheduleLookaheadSec: 0.025,
        outputMapping,
      });

      if (trigger.withCrossfade) {
        envCueGain.gain.setValueAtTime(0, schedule.whenContextSec);
        envCueGain.gain.linearRampToValueAtTime(1.0, schedule.whenContextSec + 0.012);
        envFohGain.gain.setValueAtTime(0, schedule.whenContextSec);
        envFohGain.gain.linearRampToValueAtTime(1.0, schedule.whenContextSec + 0.012);
      } else {
        envCueGain.gain.setValueAtTime(1.0, schedule.whenContextSec);
        envFohGain.gain.setValueAtTime(1.0, schedule.whenContextSec);
      }

      cSource.start(schedule.whenContextSec, schedule.startOffsetSec);
      fSource.start(schedule.whenContextSec, schedule.startOffsetSec);

      playbackClockRef.current = {
        whenContextSec: schedule.whenContextSec,
        anchorContextSec: schedule.whenContextSec,
        anchorBufferOffsetSec: schedule.startOffsetSec,
        currentRate: 1.0,
        startedAtMs: nowSharedMs(),
      };
      masterTimelineAnchorRef.current = {
        startAt: trigger.startAt,
        offset: trigger.offset,
        zeroOriginMs: trigger.startAt - trigger.offset * 1000,
        songId: trigger.songId || songDataRef.current?.id,
        seq: trigger.seq ?? activePlaySeqRef.current,
      };
      if (trigger.seq !== undefined) {
        activePlaySeqRef.current = trigger.seq;
      }
      if (trigger.sessionId !== undefined) {
        activePlaySessionRef.current = trigger.sessionId;
      }

      startTimeRef.current = schedule.whenContextSec - schedule.startOffsetSec;
      pauseOffsetRef.current = schedule.startOffsetSec;
      isAudioNodePlayingRef.current = true;
      consecutiveHardDriftCountRef.current = 0;
      setLiveDriftMs(0);
      setLivePllRate(1.0);

      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(updateTime);
      setLoadStatus(
        schedule.isLatePacket
          ? `EN VIVO · ENGANCHADO (+${schedule.lateByMs}ms)`
          : 'REPRODUCIENDO EN SINCRONÍA EXACTA'
      );
    },
    [ensureKeepAliveRunning, getEffectiveSlaveExtraTrimMs, stopActiveSources, updateTime]
  );

  const handleReactivateBlockedAudio = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      await ctx.resume();
    } catch {}
    const st = (ctx.state as any) || 'running';
    setAudioCtxState(st);
    if (st === 'running') {
      stopKeepAliveNode();
      ensureKeepAliveRunning(ctx);
      setAudioBlockedReason(null);
      triggerNtpRecalibration(4);
      const t = masterTransportRef.current;
      if (
        t.kind === 'playing' &&
        t.startAt !== undefined &&
        cueBufferRef.current &&
        fohBufferRef.current &&
        (!t.songId || t.songId === loadedSongSignatureRef.current.split('|')[0])
      ) {
        void startSynchronizedPlayback({
          startAt: t.startAt,
          offset: t.offset,
          songId: t.songId,
          seq: t.seq,
          sessionId: t.sessionId,
          withCrossfade: true,
        });
      }
    }
  }, [ensureKeepAliveRunning, startSynchronizedPlayback, stopKeepAliveNode, triggerNtpRecalibration]);

  const getInEarSongSignature = useCallback((song: any): string => {
    if (!song?.id) return '';
    const fohSig = computeSongChannelSignature(song, 'foh');
    const cueSig = computeSongCueSignature(song);
    return `${song.id}|${fohSig}|${cueSig}`;
  }, []);

  const refreshTotalRamMb = useCallback(() => {
    let totalBytes = 0;
    for (const v of decodedRamCacheRef.current.values()) {
      totalBytes += v.ramBytes;
    }
    setRamUsageMb(Math.round(totalBytes / (1024 * 1024)));
  }, []);

  // Decodificador paralelo con presupuesto estricto de RAM (máximo 2 canciones: actual + siguiente)
  const decodeSongBuffersToRamCache = useCallback(
    async (
      song: any,
      isForeground = false,
      expectedCueSig?: string
    ): Promise<{
      songId: string;
      cueSig: string;
      fohBuffer: AudioBuffer;
      cueBuffer: AudioBuffer;
      ramBytes: number;
    } | null> => {
      const ctx = audioCtxRef.current;
      if (!ctx || !song?.id) return null;

      let effectiveSong = song;
      let localCueSig = computeSongCueSignature(effectiveSong);

      // Si el PC anunció una grilla/CUE distinta a la del caché local del celular, refrescar esa canción antes de decodificar
      if (expectedCueSig && localCueSig !== expectedCueSig) {
        if (isForeground) {
          setLoadStatus('Actualizando grilla de clic desde la nube...');
        }
        const freshRow = await fetchFreshSongRowFromSupabase(effectiveSong.id);
        if (freshRow) {
          effectiveSong = { ...effectiveSong, ...freshRow };
          localCueSig = computeSongCueSignature(effectiveSong);
          setFreshSongOverrides((prev) => ({
            ...prev,
            [freshRow.id]: freshRow,
          }));
        }
      }

      const targetSignature = getInEarSongSignature(effectiveSong);
      const cached = decodedRamCacheRef.current.get(targetSignature);
      if (cached) {
        // LRU real: mover al final
        decodedRamCacheRef.current.delete(targetSignature);
        decodedRamCacheRef.current.set(targetSignature, cached);
        return cached;
      }

      const inflight = inflightDecodeMapRef.current.get(targetSignature);
      if (inflight) {
        return inflight;
      }

      const promise = (async () => {
        try {
          let [fohBytes, cueBytes] = await Promise.all([
            readDecryptedTrackArrayBuffer(effectiveSong.id, 'foh'),
            readDecryptedTrackArrayBuffer(effectiveSong.id, 'cue'),
          ]);

          if (
            !fohBytes ||
            (!cueBytes && resolvePreferredMp3Source(effectiveSong, 'cue').url)
          ) {
            if (isForeground) {
              setLoadStatus('Sincronizando MP3 faltante en memoria local...');
            }
            const updatedMeta = await ensureSongMp3CachedInDevice({
              song: effectiveSong,
              includeCue: true,
            });
            setTracksBySongId((prev) => ({
              ...prev,
              [effectiveSong.id]: updatedMeta,
            }));
            [fohBytes, cueBytes] = await Promise.all([
              fohBytes
                ? Promise.resolve(fohBytes)
                : readDecryptedTrackArrayBuffer(effectiveSong.id, 'foh'),
              cueBytes
                ? Promise.resolve(cueBytes)
                : readDecryptedTrackArrayBuffer(effectiveSong.id, 'cue'),
            ]);
          }

          if (!audioCtxRef.current || !fohBytes) {
            return null;
          }

          if (isForeground) {
            setLoadStatus('Decodificando MP3 en RAM (Cero Latencia)...');
          }

          // Regla de Modo Ensayo MP3: priorizar siempre el `cue_mobile.mp3` descargado cuando existe
          // y las secciones no se editaron después de exportar (evita síntesis pesada y garantiza 1:1 con PC)
          const needsRamCue = shouldSynthesizeCueInRehearsalMp3Mode(
            effectiveSong,
            Boolean(cueBytes && cueBytes.byteLength > 0)
          );

          let decodedFoh: AudioBuffer;
          let decodedCue: AudioBuffer | null = null;

          if (!needsRamCue && cueBytes) {
            const [fBuf, cBuf] = await Promise.all([
              ctx.decodeAudioData(fohBytes.slice(0)),
              ctx.decodeAudioData(cueBytes.slice(0)),
            ]);
            decodedFoh = fBuf;
            decodedCue = cBuf;
          } else {
            decodedFoh = await ctx.decodeAudioData(fohBytes.slice(0));
            if (needsRamCue && Number(effectiveSong?.prompter_data?.bpm) > 0) {
              const loadedVoices = await ensureVoiceCueWavsLoaded(ctx);
              if (loadedVoices > 0 || !cueBytes) {
                const savedClick = effectiveSong?.prompter_data?.mixConfig?.click;
                const savedCues = effectiveSong?.prompter_data?.mixConfig?.cues;
                decodedCue = await synthesizeLiveCueBuffer(
                  ctx,
                  effectiveSong.prompter_data,
                  decodedFoh.duration,
                  voiceCueBuffersRef.current,
                  voiceCueOffsetsRef.current,
                  0.85,
                  {
                    exactPreRollSec: resolveEffectivePreRoll(effectiveSong),
                    clickVolume:
                      typeof savedClick?.volume === 'number'
                        ? savedClick.volume
                        : 0.8,
                    clickPan:
                      typeof savedClick?.pan === 'number' ? savedClick.pan : 0,
                    clickMuted: savedClick?.muted === true,
                    cueVolume:
                      typeof savedCues?.volume === 'number'
                        ? savedCues.volume
                        : 0.85,
                    cuePan:
                      typeof savedCues?.pan === 'number' ? savedCues.pan : 0,
                    cueMuted: savedCues?.muted === true,
                    outputChannels: 1, // Mono en celular -> mitad de RAM
                  }
                );
              }
            }
            if (!decodedCue && cueBytes) {
              decodedCue = await ctx.decodeAudioData(cueBytes.slice(0));
            }
          }

          wipeAudioArrayBufferInRam(fohBytes);
          wipeAudioArrayBufferInRam(cueBytes);

          if (!decodedCue) {
            return null;
          }

          const ramBytes =
            estimateAudioBufferRamBytes(decodedFoh) +
            estimateAudioBufferRamBytes(decodedCue);
          const entry = {
            songId: effectiveSong.id,
            cueSig: localCueSig,
            fohBuffer: decodedFoh,
            cueBuffer: decodedCue,
            ramBytes,
          };

          // Expulsión LRU estricta: mantener MÁXIMO 2 canciones en RAM para no agotar memoria en celulares
          while (decodedRamCacheRef.current.size >= 2) {
            let evicted = false;
            for (const key of decodedRamCacheRef.current.keys()) {
              if (key !== loadedSongSignatureRef.current && key !== targetSignature) {
                decodedRamCacheRef.current.delete(key);
                evicted = true;
                break;
              }
            }
            if (!evicted) {
              const firstKey = decodedRamCacheRef.current.keys().next().value;
              if (firstKey && firstKey !== targetSignature) {
                decodedRamCacheRef.current.delete(firstKey);
              } else {
                break;
              }
            }
          }

          decodedRamCacheRef.current.set(targetSignature, entry);
          refreshTotalRamMb();
          return entry;
        } catch (err) {
          console.warn('[MobileInEar] Error decodificando canción en RAM:', err);
          return null;
        } finally {
          inflightDecodeMapRef.current.delete(targetSignature);
        }
      })();

      inflightDecodeMapRef.current.set(targetSignature, promise);
      return promise;
    },
    [ensureVoiceCueWavsLoaded, getInEarSongSignature, refreshTotalRamMb]
  );

  // Carga instantánea desde RAM Cache (2-song LRU) o desde la Bóveda Local MP3
  const loadAudioForSong = useCallback(
    async (song: any, expectedCueSig?: string) => {
      const ctx = audioCtxRef.current;
      if (!ctx || !song?.id) return;

      const localCueSig = computeSongCueSignature(song);
      const targetSignature = getInEarSongSignature(song);
      const sigMatchesExpected = !expectedCueSig || localCueSig === expectedCueSig;

      // 1. Si ya es la canción activa en RAM con misma firma de CUE, no recargar
      if (
        sigMatchesExpected &&
        loadedSongSignatureRef.current === targetSignature &&
        fohBufferRef.current &&
        cueBufferRef.current
      ) {
        setIsSongBuffersReady(true);
        setReadySongId(song.id);
        setReadyCueSig(localCueSig);
        if (!isAudioNodePlayingRef.current) {
          setLoadStatus('Listo en RAM (Esperando Play del Administrador)');
        }
        return;
      }

      const reqId = ++loadRequestIdRef.current;
      stopActiveSources();

      // 2. Fast-path síncrono (<0.1ms): si estaba pre-decodificada como "siguiente canción", activar de golpe
      const preDecoded = sigMatchesExpected
        ? decodedRamCacheRef.current.get(targetSignature)
        : undefined;
      if (preDecoded) {
        decodedRamCacheRef.current.delete(targetSignature);
        decodedRamCacheRef.current.set(targetSignature, preDecoded);
        fohBufferRef.current = preDecoded.fohBuffer;
        cueBufferRef.current = preDecoded.cueBuffer;
        loadedSongSignatureRef.current = targetSignature;
        setReadySongId(preDecoded.songId);
        setReadyCueSig(preDecoded.cueSig);
        setIsSongBuffersReady(true);
        const initialOffset = pauseOffsetRef.current || 0;
        setCurrentTime(initialOffset - getPreRoll(song));
        setLoadStatus('Listo en RAM · Cambio Instantáneo (0ms)');
        return;
      }

      // 3. Ruta asíncrona: decodificar desde IndexedDB (FOH + CUE MP3 en paralelo ~100ms)
      cueBufferRef.current = null;
      fohBufferRef.current = null;
      setIsSongBuffersReady(false);
      setReadySongId(null);
      setReadyCueSig(null);
      loadedSongSignatureRef.current = '';
      setLoadStatus('Cargando audio MP3 desde memoria local...');

      const decoded = await decodeSongBuffersToRamCache(song, true, expectedCueSig);
      if (loadRequestIdRef.current !== reqId) return;

      if (!decoded) {
        setLoadStatus('Error: No se pudo preparar el audio MP3 de la canción');
        return;
      }

      fohBufferRef.current = decoded.fohBuffer;
      cueBufferRef.current = decoded.cueBuffer;
      loadedSongSignatureRef.current = getInEarSongSignature({
        ...song,
        ...(freshSongOverrides[song.id] || {}),
      });
      setReadySongId(decoded.songId);
      setReadyCueSig(decoded.cueSig);
      setIsSongBuffersReady(true);

      // Re-calibrar NTP cuando termina la decodificación y la CPU móvil queda libre
      triggerNtpRecalibration(4);

      const initialOffset = pauseOffsetRef.current || 0;
      setCurrentTime(initialOffset - getPreRoll(song));
      setLoadStatus('Listo en RAM (Esperando Play del Administrador)');
    },
    [
      decodeSongBuffersToRamCache,
      freshSongOverrides,
      getInEarSongSignature,
      getPreRoll,
      stopActiveSources,
      triggerNtpRecalibration,
    ]
  );

  // Precargar en RAM ÚNICAMENTE la SIGUIENTE canción cuando el sistema está en calma (>4s tras arrancar o en espera)
  useEffect(() => {
    if (!hasInteracted || !audioCtx || !isSongBuffersReady) return;

    const candidateNext =
      nextSongData && nextSongData.id !== songData?.id
        ? nextSongData
        : (() => {
            if (!songData?.id || activePlaylistSongs.length === 0) return null;
            const curIdx = activePlaylistSongs.findIndex((s) => s.id === songData.id);
            return curIdx >= 0 && curIdx + 1 < activePlaylistSongs.length
              ? activePlaylistSongs[curIdx + 1]
              : null;
          })();

    if (!candidateNext?.id) return;
    const nextSig = getInEarSongSignature(candidateNext);
    if (decodedRamCacheRef.current.has(nextSig)) return;

    const waitMs = isPlaying ? 4500 : 400;
    const timer = window.setTimeout(() => {
      void decodeSongBuffersToRamCache(candidateNext, false);
    }, waitMs);
    return () => window.clearTimeout(timer);
  }, [
    hasInteracted,
    audioCtx,
    isSongBuffersReady,
    isPlaying,
    songData?.id,
    nextSongData,
    activePlaylistSongs,
    decodeSongBuffersToRamCache,
    getInEarSongSignature,
  ]);

  // Cargar canción cuando el Master envía canción activa o cambia cueSig
  const masterExpectedCueSig = masterTransport.cueSig;
  useEffect(() => {
    if (songData && audioCtx && hasInteracted) {
      void loadAudioForSong(songData, masterExpectedCueSig);
    }
  }, [songData, audioCtx, hasInteracted, masterExpectedCueSig, loadAudioForSong]);

  // RECONCILIADOR ÚNICO DEL ESTADO DE TRANSPORTE (imposible que una pausa previa pise un PLAY)
  useEffect(() => {
    if (!hasInteracted) return;

    const transport = masterTransport;
    if (transport.kind === 'idle') return;

    if (
      transport.kind === 'paused' ||
      transport.kind === 'stopped' ||
      transport.kind === 'loaded'
    ) {
      activePlaySeqRef.current = 0;
      masterTimelineAnchorRef.current = null;
      consecutiveHardDriftCountRef.current = 0;
      pauseOffsetRef.current = transport.offset || 0;
      stopActiveSources();
      setLiveDriftMs(0);
      setCurrentTime((transport.offset || 0) - getPreRoll(songDataRef.current));

      if (transport.kind === 'stopped') {
        setLoadStatus('Detenido · Listo en Inicio / Pre-Roll');
      } else if (cueBufferRef.current && fohBufferRef.current && isSongBuffersReady) {
        setLoadStatus(
          transport.kind === 'paused'
            ? 'En Pausa (Standby)'
            : 'Listo en RAM (Esperando Play del Administrador)'
        );
      }
      return;
    }

    if (transport.kind === 'playing') {
      const songMatchesLoaded =
        !transport.songId ||
        (Boolean(readySongId) && readySongId === transport.songId);

      if (
        !audioCtxRef.current ||
        !cueBufferRef.current ||
        !fohBufferRef.current ||
        !isSongBuffersReady ||
        !songMatchesLoaded
      ) {
        return;
      }

      if (audioCtxState !== 'running') {
        setLoadStatus('Audio pausado por el sistema · Toca Reactivar');
        return;
      }

      const alreadyRunningThisSeq =
        isAudioNodePlayingRef.current &&
        activePlaySeqRef.current === transport.seq &&
        activePlaySessionRef.current === transport.sessionId;

      if (!alreadyRunningThisSeq && transport.startAt !== undefined) {
        void startSynchronizedPlayback({
          startAt: transport.startAt,
          offset: transport.offset,
          songId: transport.songId,
          seq: transport.seq,
          sessionId: transport.sessionId,
          withCrossfade: isAudioNodePlayingRef.current,
        });
      }
    }
  }, [
    masterTransport,
    hasInteracted,
    isSongBuffersReady,
    readySongId,
    audioCtxState,
    getPreRoll,
    startSynchronizedPlayback,
    stopActiveSources,
  ]);

  // Micro-PLL Musical (±0.15% máx): absorbe deriva de osciladores de cuarzo sin cambiar tono ni tempo
  const evaluateAndApplyPllServo = useCallback(
    (anchor: { startAt: number; offset: number; songId?: string; seq: number }) => {
      const ctx = audioCtxRef.current;
      if (!ctx || !isAudioNodePlayingRef.current || ctx.state !== 'running') return;

      // Dejar que el audio arranque y se estabilice al menos 150ms antes de evaluar PLL
      if (ctx.currentTime < playbackClockRef.current.whenContextSec + 0.15) {
        return;
      }

      const slaveCurrentGlobalSec = getCurrentSlaveBufferPositionSec(ctx.currentTime);
      const outputMapping = measureAudioOutputClockMapping(ctx);
      const extraTrimMs = getEffectiveSlaveExtraTrimMs(ctx);

      const servo = computeSlavePllServoAdjustment({
        masterStartAtMs: anchor.startAt,
        masterBaseOffsetSec: anchor.offset,
        clientNowMs: nowSharedMs(),
        clockOffsetMs: clockOffsetRef.current,
        slaveCurrentGlobalSec,
        slaveOutputLatencyMs: extraTrimMs,
        deadbandMs: 8,
        hardSeekThresholdMs: 40,
        maxRateDev: 0.0015,
        outputMapping,
        slaveAudioCtxCurrentTimeSec: ctx.currentTime,
      });

      setLiveDriftMs(servo.driftMs);

      if (servo.mode === 'locked') {
        consecutiveHardDriftCountRef.current = 0;
        applySlavePlaybackRate(ctx.currentTime, 1.0);
        setLoadStatus('REPRODUCIENDO EN SINCRONÍA EXACTA');
      } else if (servo.mode === 'pll_rate') {
        consecutiveHardDriftCountRef.current = 0;
        applySlavePlaybackRate(ctx.currentTime, servo.targetPlaybackRate);
        setLoadStatus(
          `EN VIVO · FASE BLOQUEADA (${servo.driftMs > 0 ? `+${servo.driftMs}` : servo.driftMs}ms)`
        );
      } else if (servo.mode === 'hard_seek') {
        consecutiveHardDriftCountRef.current += 1;
        const nowMs = nowSharedMs();
        if (
          consecutiveHardDriftCountRef.current >= 3 &&
          nowMs - lastHardSeekAtMsRef.current >= HARD_SEEK_COOLDOWN_MS
        ) {
          consecutiveHardDriftCountRef.current = 0;
          lastHardSeekAtMsRef.current = nowMs;
          void startSynchronizedPlayback({
            startAt: anchor.startAt,
            offset: anchor.offset,
            songId: anchor.songId,
            seq: anchor.seq,
            withCrossfade: true,
          });
        }
      }
    },
    [
      applySlavePlaybackRate,
      getCurrentSlaveBufferPositionSec,
      getEffectiveSlaveExtraTrimMs,
      startSynchronizedPlayback,
    ]
  );

  // Heartbeat del Master cada 1.5s: actualiza el ancla suavizada sin reiniciar nodos activos
  useEffect(() => {
    if (!heartbeatAnchor || !hasInteracted) return;
    const transport = masterTransportRef.current;
    if (transport.kind !== 'playing' || !isAudioNodePlayingRef.current) return;
    if (heartbeatAnchor.seq !== activePlaySeqRef.current) return;

    const impliedZeroOriginMs =
      heartbeatAnchor.startAt - heartbeatAnchor.offset * 1000;
    const prevAnchor = masterTimelineAnchorRef.current;

    let smoothedAnchor: {
      startAt: number;
      offset: number;
      zeroOriginMs: number;
      songId?: string;
      seq: number;
    };

    if (
      prevAnchor &&
      prevAnchor.seq === heartbeatAnchor.seq &&
      (!heartbeatAnchor.songId || prevAnchor.songId === heartbeatAnchor.songId) &&
      Math.abs(impliedZeroOriginMs - prevAnchor.zeroOriginMs) < 90
    ) {
      // Suavizado exponencial (75/25) del origen Master para inmunizar contra jitter de paquetes individuales
      const blendedOrigin =
        prevAnchor.zeroOriginMs * 0.75 + impliedZeroOriginMs * 0.25;
      smoothedAnchor = {
        startAt: blendedOrigin + heartbeatAnchor.offset * 1000,
        offset: heartbeatAnchor.offset,
        zeroOriginMs: blendedOrigin,
        songId: heartbeatAnchor.songId || prevAnchor.songId,
        seq: heartbeatAnchor.seq,
      };
    } else {
      smoothedAnchor = {
        startAt: heartbeatAnchor.startAt,
        offset: heartbeatAnchor.offset,
        zeroOriginMs: impliedZeroOriginMs,
        songId: heartbeatAnchor.songId,
        seq: heartbeatAnchor.seq,
      };
    }

    masterTimelineAnchorRef.current = smoothedAnchor;
    evaluateAndApplyPllServo(smoothedAnchor);
  }, [heartbeatAnchor, hasInteracted, evaluateAndApplyPllServo]);

  // Bucle local de Micro-PLL cada 450ms para absorber deriva térmica de cristal sin cortes
  useEffect(() => {
    if (!hasInteracted || !isPlaying || !isSongBuffersReady) return;
    const intervalId = window.setInterval(() => {
      if (!isPlayingRef.current || !isAudioNodePlayingRef.current) return;
      const anchor = masterTimelineAnchorRef.current;
      if (!anchor) return;
      evaluateAndApplyPllServo(anchor);
    }, 450);
    return () => window.clearInterval(intervalId);
  }, [hasInteracted, isPlaying, isSongBuffersReady, evaluateAndApplyPllServo]);

  const activePreRollSec = useMemo(
    () => (songData ? getPreRoll(songData) : 0),
    [songData, getPreRoll]
  );
  const activePreRollBars = useMemo(
    () => (songData ? resolveEffectivePreRollBars(songData) : 0),
    [songData]
  );
  const prompterLyricsOffsetSec = useMemo(
    () =>
      songData
        ? resolveLyricsTimeMapping(songData).prompterLyricsOffsetSec
        : 0,
    [songData]
  );

  // ============================================================================
  // PANTALLA PREVIA A CONECTARSE: PASO 1 (DESCARGAR PLAYLIST MP3) -> PASO 2 (CONECTAR)
  // ============================================================================
  if (!hasInteracted) {
    const canConnectNow = playlistReadiness.isFullyCached && !isDownloadingPlaylist;

    return (
      <div className="relative flex flex-col items-center justify-center min-h-screen bg-[#07090e] text-white px-4 py-16 overflow-y-auto">
        {/* Barra superior de salida rápida: Menú Principal y Cerrar Sesión */}
        <div className="absolute top-4 inset-x-4 sm:top-6 sm:inset-x-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleGoToMainMenu}
            className="flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 px-4 py-2 text-xs font-semibold text-zinc-200 hover:text-white transition-all active:scale-95 cursor-pointer"
            title="Ir al menú principal"
          >
            <ArrowLeft size={15} />
            <span>Menú Principal</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex items-center gap-2 rounded-full bg-rose-500/15 hover:bg-rose-600 border border-rose-500/40 px-4 py-2 text-xs font-semibold text-rose-300 hover:text-white transition-all active:scale-95 cursor-pointer"
            title="Cerrar Sesión"
          >
            <LogOut size={14} />
            <span>Cerrar Sesión</span>
          </button>
        </div>

        <div className="p-3.5 bg-red-600/20 border border-red-500/40 rounded-2xl mb-4 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
          <Headphones size={40} className="text-red-500" />
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.22em] px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 mb-2">
          Monitoreo In-Ear Inalámbrico · Baja Latencia
        </span>
        <h1 className="text-2xl sm:text-3xl font-black tracking-wider mb-1.5 text-center">
          IN-EAR MONITOR
        </h1>
        <p className="text-zinc-400 mb-6 text-center max-w-md text-xs sm:text-sm leading-relaxed">
          Primero descarga la playlist en MP3 en tu celular (se guarda para futuros ensayos sin volver a descargar). Luego conéctate para sincronizar con el Administrador.
        </p>

        {/* TARJETA DE PREPARACIÓN DE PLAYLIST Y CONEXIÓN */}
        <div className="w-full max-w-md rounded-2xl bg-[#0c0f17] border border-white/10 p-5 shadow-2xl space-y-4">
          {/* Selector de Playlist / Setlist */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <ListMusic size={14} className="text-amber-400" />
                <span>Playlist del Ensayo</span>
              </label>
              <button
                type="button"
                onClick={() => void loadCatalogAndVaultStatus(true)}
                disabled={isSyncingCatalog || isDownloadingPlaylist}
                className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-white disabled:opacity-40 cursor-pointer"
                title="Actualizar lista de canciones desde la nube"
              >
                <RefreshCw
                  size={11}
                  className={isSyncingCatalog ? 'animate-spin' : ''}
                />
                <span>Actualizar</span>
              </button>
            </div>

            <select
              value={selectedSetlistId || ''}
              disabled={isDownloadingPlaylist || isSyncingCatalog}
              onChange={(e) => {
                const nextId = e.target.value || null;
                setSelectedSetlistId(nextId);
                if (nextId) {
                  try {
                    localStorage.setItem(INEAR_ACTIVE_SETLIST_KEY, nextId);
                  } catch {}
                }
              }}
              className="w-full rounded-xl bg-[#07090e] border border-white/15 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-white outline-none focus:border-amber-400 transition-all cursor-pointer"
            >
              {(catalog?.setlists || []).map((sl: PracticeSetlistSummary) => (
                <option key={sl.id} value={sl.id} className="bg-[#0c0f17]">
                  {sl.title} ({(catalog?.setlistSongsMap[sl.id] || []).length}{' '}
                  canciones)
                </option>
              ))}
              {(!catalog || catalog.setlists.length === 0) && (
                <option value="" className="bg-[#0c0f17]">
                  {isSyncingCatalog
                    ? 'Cargando playlists...'
                    : 'Repertorio General'}
                </option>
              )}
            </select>
          </div>

          {/* Resumen de Estado en Memoria Local */}
          <div className="rounded-xl bg-[#07090e] border border-white/[0.08] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 font-medium flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-400" />
                <span>Memoria Local MP3:</span>
              </span>
              <span className="font-mono font-bold text-white">
                {playlistReadiness.readySongs.length} /{' '}
                {playlistReadiness.exportableSongs.length} listas
                {playlistReadiness.totalCachedBytes > 0
                  ? ` (${formatBytesCompact(playlistReadiness.totalCachedBytes)})`
                  : ''}
              </span>
            </div>

            {/* Barra de progreso visual */}
            <div className="w-full h-2 bg-white/[0.07] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  playlistReadiness.isFullyCached
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                }`}
                style={{
                  width: `${
                    isDownloadingPlaylist
                      ? downloadProgressPct
                      : playlistReadiness.exportableSongs.length > 0
                      ? Math.round(
                          (playlistReadiness.readySongs.length /
                            playlistReadiness.exportableSongs.length) *
                            100
                        )
                      : 0
                  }%`,
                }}
              />
            </div>

            {/* Lista compacta de canciones de la playlist y su estado */}
            {activePlaylistSongs.length > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-1 pt-1 pr-1">
                {activePlaylistSongs.map((song, idx) => {
                  const ev = evaluateSongVaultState(
                    song,
                    tracksBySongId[song.id]
                  );
                  const isReady =
                    ev.status === 'offline_ready' && !ev.cueNeedsDownload;
                  const isNoMix = ev.status === 'no_mix';
                  return (
                    <div
                      key={song.id}
                      className="flex items-center justify-between text-[11px] py-1 px-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                    >
                      <span className="truncate text-zinc-200 font-medium pr-2">
                        {idx + 1}. {song.title}
                      </span>
                      {isReady ? (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                          <Check size={10} /> En Memoria
                        </span>
                      ) : isNoMix ? (
                        <span className="shrink-0 text-[10px] font-semibold text-zinc-500">
                          Sin Mix
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
                          Pendiente MP3
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {downloadProgressText && (
              <p className="text-[11px] font-semibold text-amber-300 pt-1">
                {downloadProgressText}
              </p>
            )}

            {downloadError && (
              <p className="text-[11px] font-semibold text-rose-400 pt-1">
                {downloadError}
              </p>
            )}
          </div>

          {/* PASO 1: Botón de Descarga de Playlist en MP3 */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void handleDownloadPlaylistMp3(false)}
              disabled={
                isDownloadingPlaylist ||
                isSyncingCatalog ||
                playlistReadiness.exportableSongs.length === 0 ||
                playlistReadiness.isFullyCached
              }
              className={`w-full py-3.5 px-5 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
                playlistReadiness.isFullyCached
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 cursor-default'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-[0_0_25px_rgba(245,158,11,0.35)] active:scale-95 disabled:opacity-40'
              }`}
            >
              {isDownloadingPlaylist ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  <span>Descargando Playlist MP3... ({downloadProgressPct}%)</span>
                </>
              ) : playlistReadiness.isFullyCached ? (
                <>
                  <Check size={17} />
                  <span>
                    1. Playlist MP3 Guardada en Memoria ({playlistReadiness.readySongs.length}/{playlistReadiness.exportableSongs.length})
                  </span>
                </>
              ) : (
                <>
                  <CloudDownload size={17} />
                  <span>
                    1. Descargar Playlist en MP3 ({playlistReadiness.pendingSongs.length}{' '}
                    {playlistReadiness.pendingSongs.length === 1
                      ? 'canción'
                      : 'canciones'}
                    )
                  </span>
                </>
              )}
            </button>

            {playlistReadiness.readySongs.length > 0 && !isDownloadingPlaylist && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleDownloadPlaylistMp3(true)}
                  disabled={isSyncingCatalog}
                  className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-zinc-400 hover:text-amber-300 transition-colors cursor-pointer disabled:opacity-40"
                  title="Volver a descargar todas las canciones de la playlist desde la nube"
                >
                  <RefreshCw size={11} />
                  <span>Volver a descargar MP3</span>
                </button>
              </div>
            )}
          </div>

          {/* PASO 2: Botón Conectar y Sincronizar al Ensayo (Habilitado solo tras descargar la Playlist) */}
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={!canConnectNow}
            className={`w-full py-4 px-6 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all ${
              canConnectNow
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_35px_rgba(239,68,68,0.45)] active:scale-95 cursor-pointer'
                : 'bg-white/[0.06] text-zinc-500 border border-white/10 cursor-not-allowed'
            }`}
            title={
              canConnectNow
                ? 'Conectarse a la sala y esperar que el Administrador lance las canciones'
                : 'Primero descarga la playlist en MP3 para habilitar la conexión sincronizada'
            }
          >
            <Power size={19} />
            <span>2. Conectar y Sincronizar al Ensayo</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleGoToMainMenu}
          className="mt-5 flex items-center gap-2 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-5 py-2.5 text-xs font-semibold text-zinc-200 hover:text-white transition-all active:scale-95 cursor-pointer"
        >
          <ArrowLeft size={14} />
          <span>Volver al menú principal</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#07090e] text-white relative">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 p-3 bg-[#0c0e14] border-b border-white/[0.08] z-20">
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          <div
            className={`p-2 rounded-lg shrink-0 border ${
              connectionStatus === 'connected'
                ? 'bg-emerald-500/15 border-emerald-500/35'
                : 'bg-amber-500/15 border-amber-500/35'
            }`}
          >
            <Wifi
              size={18}
              className={
                connectionStatus === 'connected'
                  ? 'text-emerald-400'
                  : 'text-amber-400 animate-pulse'
              }
            />
          </div>
          <div className="overflow-hidden">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border shrink-0 ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}
              >
                {connectionStatus === 'connected'
                  ? `${transportMode === 'lan_direct' ? 'LAN DIRECTO' : 'SINCRONIZADO'}${
                      rttMs > 0 ? ` · ${rttMs}ms` : ''
                    }${isPlaying ? ` · Δ${liveDriftMs >= 0 ? `+${liveDriftMs}` : liveDriftMs}ms` : ''}`
                  : 'CONECTANDO...'}
              </span>
              {bluetoothRiskWarning && (
                <span
                  className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded border shrink-0 bg-amber-500/20 text-amber-300 border-amber-500/40 flex items-center gap-1"
                  title="Audífonos Bluetooth detectados: añaden 150-300ms de retardo físico imposible de compensar. Usa cable o USB-C para ensayo exacto."
                >
                  <AlertTriangle size={9} /> Bluetooth · Usa Cable
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowDiagnostics((v) => !v)}
                className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border border-white/15 bg-white/[0.05] hover:bg-white/[0.12] text-zinc-300 cursor-pointer shrink-0"
                title="Mostrar u ocultar panel técnico de diagnóstico"
              >
                Diag
              </button>
              <h2 className="font-bold text-xs leading-tight truncate">
                {songData ? songData.title : `${selectedSetlistTitle} · Esperando Master...`}
              </h2>
            </div>
            <div className="text-[9px] uppercase font-bold tracking-widest text-zinc-400 truncate mt-0.5">
              {loadStatus}
            </div>
          </div>
        </div>

        {/* Personal Mixer + Navigation / Logout */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col space-y-2 w-36 sm:w-52 bg-[#07090e] p-2.5 rounded-lg border border-white/[0.07]">
            {/* CUE Volume */}
            <div className="flex items-center space-x-2">
              <Volume2 size={12} className="text-amber-400 shrink-0" />
              <span className="text-[9px] font-black text-zinc-300 w-14 shrink-0">
                CLIC/GUÍA
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={cueVolume}
                onChange={(e) => setCueVolume(parseFloat(e.target.value))}
                className="w-full accent-amber-400 h-1"
              />
            </div>
            {/* FOH (Band) Volume */}
            <div className="flex items-center space-x-2">
              <Music size={12} className="text-red-400 shrink-0" />
              <span className="text-[9px] font-black text-zinc-300 w-14 shrink-0">
                PISTAS
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={bandVolume}
                onChange={(e) => setBandVolume(parseFloat(e.target.value))}
                className="w-full accent-red-500 h-1"
              />
            </div>
            {/* Ajuste Fino de Fase por Celular (-80ms .. +80ms) */}
            <div className="flex items-center justify-between pt-0.5 border-t border-white/[0.06]">
              <span
                className="text-[8.5px] font-black uppercase tracking-wider text-emerald-300/90"
                title="Ajuste fino de fase para este celular/DAC"
              >
                FASE {syncTrimMs >= 0 ? `+${syncTrimMs}` : syncTrimMs}ms
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = Math.max(-100, syncTrimMs - 5);
                    setSyncTrimMs(next);
                  }}
                  className="px-1.5 py-0.5 rounded bg-white/[0.07] hover:bg-white/[0.15] text-[9px] font-bold text-zinc-200 cursor-pointer"
                  title="Adelantar 5ms"
                >
                  -5
                </button>
                <button
                  type="button"
                  onClick={() => setSyncTrimMs(0)}
                  className="px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.12] text-[8.5px] font-mono text-zinc-400 cursor-pointer"
                  title="Restablecer ajuste fino a 0ms"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = Math.min(100, syncTrimMs + 5);
                    setSyncTrimMs(next);
                  }}
                  className="px-1.5 py-0.5 rounded bg-white/[0.07] hover:bg-white/[0.15] text-[9px] font-bold text-zinc-200 cursor-pointer"
                  title="Compensar +5ms extra de salida en este celular"
                >
                  +5
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDisconnectFromSession}
            className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 px-2.5 sm:px-3 py-2.5 text-amber-200 hover:text-white transition-all active:scale-95 cursor-pointer shrink-0"
            title="Cambiar Playlist o verificar descargas MP3"
          >
            <CloudDownload size={15} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Playlist
            </span>
          </button>

          <button
            type="button"
            onClick={handleGoToMainMenu}
            className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.15] border border-white/15 px-2.5 sm:px-3 py-2.5 text-zinc-200 hover:text-white transition-all active:scale-95 cursor-pointer shrink-0"
            title="Volver al menú principal"
          >
            <ArrowLeft size={15} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Menú
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-600 border border-rose-500/40 px-2.5 sm:px-3 py-2.5 text-rose-300 hover:text-white transition-all active:scale-95 cursor-pointer shrink-0"
            title="Cerrar Sesión"
          >
            <LogOut size={15} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Salir
            </span>
          </button>
        </div>
      </div>

      {/* Panel Plegable de Diagnóstico Técnico en Vivo */}
      {showDiagnostics && (
        <div className="px-3 py-1.5 bg-[#090b10] border-b border-white/[0.08] text-[9.5px] font-mono text-zinc-300 flex flex-wrap items-center gap-x-3 gap-y-1 z-20">
          <span>
            RED:{' '}
            <strong className={transportMode === 'lan_direct' ? 'text-emerald-400' : 'text-amber-300'}>
              {transportMode === 'lan_direct' ? 'LAN P2P' : 'NUBE WS'}
            </strong>
          </span>
          <span>RTT: <strong>{rttMs}ms</strong></span>
          <span>Offset: <strong>{Math.round(clockOffset)}ms</strong></span>
          <span>
            AudioCtx:{' '}
            <strong className={audioCtxState === 'running' ? 'text-emerald-400' : 'text-rose-400'}>
              {audioCtxState}
            </strong>
          </span>
          <span>SR: <strong>{audioCtx?.sampleRate || 0}Hz</strong></span>
          <span>
            DAC:{' '}
            <strong>
              {measureAudioOutputClockMapping(audioCtx)?.pipelineLatencyMs ?? 'fallback'}ms
            </strong>
          </span>
          <span>Drift: <strong>{liveDriftMs}ms</strong></span>
          <span>Rate: <strong>{livePllRate.toFixed(4)}x</strong></span>
          <span>Seq: <strong>#{masterTransport.seq}</strong></span>
          <span>RAM: <strong>{ramUsageMb}MB</strong> (máx 2 temas)</span>
        </div>
      )}

      {/* Prompter Visual Area */}
      <div className="flex-1 relative overflow-hidden">
        {songData ? (
          <Prompter
            currentTime={currentTime}
            preRollDuration={activePreRollSec}
            preRollBars={activePreRollBars}
            lyricsTimeOffset={prompterLyricsOffsetSec}
            bpm={songData.prompter_data?.bpm || 0}
            timeSignature={songData.prompter_data?.timeSignature}
            baseOffset={songData.prompter_data?.firstBeatOffset}
            beatTimes={songData.prompter_data?.beatTimes}
            chords={songData.prompter_data?.chords || []}
            sections={songData.prompter_data?.sections || []}
            lyrics={songData.prompter_data?.lyrics || []}
            isVamping={false}
            isEditing={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
            <Headphones size={200} />
          </div>
        )}

        {audioBlockedReason && (
          <div className="absolute inset-0 bg-rose-950/90 flex items-center justify-center backdrop-blur-md z-40 p-6">
            <button
              type="button"
              onClick={() => void handleReactivateBlockedAudio()}
              className="w-full max-w-sm rounded-2xl bg-rose-600 hover:bg-rose-500 border-2 border-rose-300/60 p-6 text-center shadow-2xl active:scale-95 transition-all cursor-pointer"
            >
              <AlertTriangle size={40} className="mx-auto mb-3 text-white animate-bounce" />
              <div className="text-base sm:text-lg font-black tracking-wider uppercase text-white">
                AUDIO PAUSADO POR EL SISTEMA
              </div>
              <div className="text-xs text-rose-100 mt-1.5 leading-relaxed">
                {audioBlockedReason === 'interrupted'
                  ? 'Una llamada o notificación interrumpió el audio. Toca aquí para reanudar en sincronía.'
                  : 'El navegador suspendió el audio del celular. Toca aquí para reactivarlo al instante.'}
              </div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white text-rose-700 px-4 py-2 text-xs font-black uppercase tracking-wider">
                <Power size={14} /> TOCAR PARA REACTIVAR SINCRONÍA
              </div>
            </button>
          </div>
        )}

        {!isPlaying && !audioBlockedReason && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-[4px] z-30">
            <div className="flex flex-col items-center px-6 text-center">
              <Activity size={32} className="text-emerald-400 mb-2 animate-pulse" />
              <p className="text-lg sm:text-xl font-black tracking-[0.25em] text-white/80">
                {isSongBuffersReady
                  ? 'LISTO EN RAM · ESPERANDO PLAY'
                  : 'SINCRONIZADO · ESPERANDO CANCIÓN'}
              </p>
              <p className="text-xs text-zinc-400 mt-1.5">
                {songData
                  ? `"${songData.title}" cargada desde memoria local MP3 (0ms de red)`
                  : 'Cuando el Administrador seleccione o lance una canción, arrancará automáticamente.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
