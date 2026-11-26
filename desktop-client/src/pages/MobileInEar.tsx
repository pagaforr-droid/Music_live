import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSyncSlave } from '../hooks/useSyncSlave';
import {
  computePhaseLockedSlaveStart,
  computeSlaveDriftCorrection,
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
  loadCueBuffers,
  synthesizeLiveCueBuffer,
  shouldSynthesizeLiveCueInRam,
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
  const [loadStatus, setLoadStatus] = useState<string>(
    'Sincronizado · Esperando canción del Administrador...'
  );

  // Caché de las 11 voces guía PCM WAV para síntesis en RAM si una canción requiere Voz Guía IA actualizada
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
    masterSetlistId,
    songData,
    nextSongData,
    isPlaying,
    playTrigger,
    pauseTrigger,
    seekTrigger,
    heartbeatTrigger,
    clockOffset,
    rttMs,
    requestMasterState,
  } = useSyncSlave(FAKE_BAND_ID, {
    enabled: hasInteracted,
    deviceLabel,
    setlistId: selectedSetlistId,
    songReady: isSongBuffersReady,
  });

  const isPlayingRef = useRef<boolean>(false);
  const clockOffsetRef = useRef<number>(0);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    clockOffsetRef.current = clockOffset;
  }, [clockOffset]);

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
  const isAudioNodePlayingRef = useRef<boolean>(false);
  const loadedSongSignatureRef = useRef<string>('');
  const loadRequestIdRef = useRef<number>(0);
  // Caché LRU en RAM de AudioBuffers ya decodificados (máx 4 canciones) para transición instantánea en 0ms entre temas
  const decodedRamCacheRef = useRef<
    Map<string, { fohBuffer: AudioBuffer; cueBuffer: AudioBuffer }>
  >(new Map());
  const inflightDecodeMapRef = useRef<
    Map<string, Promise<{ fohBuffer: AudioBuffer; cueBuffer: AudioBuffer } | null>>
  >(new Map());
  const pendingPlayTriggerRef = useRef<{
    startAt: number;
    offset: number;
    ts: number;
    songId?: string;
  } | null>(null);
  const lastExecutedTriggerTsRef = useRef<number>(0);

  const cueGainRef = useRef<GainNode | null>(null);
  const fohGainRef = useRef<GainNode | null>(null);
  const wakeLockRef = useRef<any>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const animationFrameRef = useRef(0);

  const [cueVolume, setCueVolume] = useState(1);
  const [bandVolume, setBandVolume] = useState(0.8);

  const stopActiveSources = useCallback(() => {
    try {
      cueSourceRef.current?.stop();
      cueSourceRef.current?.disconnect();
    } catch {}
    try {
      fohSourceRef.current?.stop();
      fohSourceRef.current?.disconnect();
    } catch {}
    cueSourceRef.current = null;
    fohSourceRef.current = null;
    isAudioNodePlayingRef.current = false;
    cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const cleanupAudioAndWakeLock = useCallback(() => {
    downloadAbortRef.current?.abort();
    stopActiveSources();
    if (wakeLockRef.current) {
      wakeLockRef.current.release?.().catch?.(() => {});
      wakeLockRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
  }, [stopActiveSources]);

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

  const handleDisconnectFromSession = () => {
    stopActiveSources();
    setHasInteracted(false);
    setIsSongBuffersReady(false);
    loadedSongSignatureRef.current = '';
  };

  // Paso 2: Inicializar AudioContext y conectarse a la sala de sincronización SOLO tras descargar la Playlist
  const handleConnect = async () => {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext =
      audioCtxRef.current && audioCtxRef.current.state !== 'closed'
        ? audioCtxRef.current
        : new AudioContextClass();

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }

    const cGain = ctx.createGain();
    cGain.connect(ctx.destination);
    cGain.gain.value = cueVolume;
    cueGainRef.current = cGain;

    const fGain = ctx.createGain();
    fGain.connect(ctx.destination);
    fGain.gain.value = bandVolume;
    fohGainRef.current = fGain;

    audioCtxRef.current = ctx;
    setAudioCtx(ctx);
    setHasInteracted(true);
    setLoadStatus('Sincronizando reloj NTP con el Administrador...');

    // Desbloquear salida de audio en iOS/Android Safari/Chrome
    const silentBuffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(ctx.destination);
    source.start();

    // Precargar las 11 voces guía WAV en RAM en segundo plano
    void ensureVoiceCueWavsLoaded(ctx);

    // Mantener la pantalla encendida para que iOS/Android no suspendan el AudioContext
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
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
        if (
          audioCtxRef.current &&
          audioCtxRef.current.state === 'suspended'
        ) {
          try {
            await audioCtxRef.current.resume();
          } catch {}
        }
        try {
          if ('wakeLock' in navigator && !wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request(
              'screen'
            );
          }
        } catch {}
        requestMasterState();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [hasInteracted, requestMasterState]);

  useEffect(() => {
    if (cueGainRef.current) cueGainRef.current.gain.value = cueVolume;
  }, [cueVolume]);

  useEffect(() => {
    if (fohGainRef.current) fohGainRef.current.gain.value = bandVolume;
  }, [bandVolume]);

  const getPreRoll = useCallback((song: any) => {
    return resolveEffectivePreRoll(song);
  }, []);

  const updateTime = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isAudioNodePlayingRef.current) return;

    const globalTime = Math.max(0, ctx.currentTime - startTimeRef.current);
    const preRoll = getPreRoll(songData);
    const visualTime = globalTime - preRoll;

    setCurrentTime(visualTime);
    animationFrameRef.current = requestAnimationFrame(updateTime);
  }, [getPreRoll, songData]);

  // Lanzamiento de reproducción sincronizada con compensación exacta de paquetes tardíos
  const startSynchronizedPlayback = useCallback(
    async (trigger: { startAt: number; offset: number; ts?: number }) => {
      const ctx = audioCtxRef.current;
      const cBuf = cueBufferRef.current;
      const fBuf = fohBufferRef.current;
      if (!ctx || !cBuf || !fBuf || !cueGainRef.current || !fohGainRef.current)
        return;

      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {}
      }

      stopActiveSources();

      const cSource = ctx.createBufferSource();
      cSource.buffer = cBuf;
      cSource.connect(cueGainRef.current);
      cueSourceRef.current = cSource;

      const fSource = ctx.createBufferSource();
      fSource.buffer = fBuf;
      fSource.connect(fohGainRef.current);
      fohSourceRef.current = fSource;

      const schedule = computePhaseLockedSlaveStart({
        startAtMs: trigger.startAt,
        baseOffsetSec: trigger.offset,
        clientNowMs: Date.now(),
        clockOffsetMs: clockOffsetRef.current,
        audioCtxCurrentTimeSec: ctx.currentTime,
        bufferDurationSec: fBuf.duration,
        minScheduleLookaheadSec: 0.025,
      });

      cSource.start(schedule.whenContextSec, schedule.startOffsetSec);
      fSource.start(schedule.whenContextSec, schedule.startOffsetSec);

      startTimeRef.current = schedule.whenContextSec - schedule.startOffsetSec;
      pauseOffsetRef.current = schedule.startOffsetSec;
      isAudioNodePlayingRef.current = true;
      if (trigger.ts) {
        lastExecutedTriggerTsRef.current = trigger.ts;
      }

      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(updateTime);
      setLoadStatus(
        schedule.isLatePacket
          ? `EN VIVO · FASE COMPENSADA (+${schedule.lateByMs}ms)`
          : 'REPRODUCIENDO EN SINCRONÍA'
      );
    },
    [stopActiveSources, updateTime]
  );

  const getInEarSongSignature = useCallback((song: any): string => {
    if (!song?.id) return '';
    const fohSig = computeSongChannelSignature(song, 'foh');
    const cueSig = computeSongChannelSignature(song, 'cue');
    const sectionsUpd = song?.prompter_data?.sectionsUpdatedAt || '';
    return `${song.id}|${fohSig}|${cueSig}|${sectionsUpd}`;
  }, []);

  // Decodificador compartido con deduplicación en vuelo y caché LRU en RAM (hasta 4 canciones listas para cambio en 0ms)
  const decodeSongBuffersToRamCache = useCallback(
    async (
      song: any,
      isForeground = false
    ): Promise<{ fohBuffer: AudioBuffer; cueBuffer: AudioBuffer } | null> => {
      const ctx = audioCtxRef.current;
      if (!ctx || !song?.id) return null;

      const targetSignature = getInEarSongSignature(song);
      const cached = decodedRamCacheRef.current.get(targetSignature);
      if (cached) {
        return cached;
      }

      const inflight = inflightDecodeMapRef.current.get(targetSignature);
      if (inflight) {
        return inflight;
      }

      const promise = (async () => {
        try {
          let fohBytes = await readDecryptedTrackArrayBuffer(song.id, 'foh');
          let cueBytes = await readDecryptedTrackArrayBuffer(song.id, 'cue');

          if (
            !fohBytes ||
            (!cueBytes && resolvePreferredMp3Source(song, 'cue').url)
          ) {
            if (isForeground) {
              setLoadStatus('Sincronizando MP3 faltante en memoria local...');
            }
            const updatedMeta = await ensureSongMp3CachedInDevice({
              song,
              includeCue: true,
            });
            setTracksBySongId((prev) => ({ ...prev, [song.id]: updatedMeta }));
            if (!fohBytes) {
              fohBytes = await readDecryptedTrackArrayBuffer(song.id, 'foh');
            }
            if (!cueBytes) {
              cueBytes = await readDecryptedTrackArrayBuffer(song.id, 'cue');
            }
          }

          if (!audioCtxRef.current || !fohBytes) {
            return null;
          }

          if (isForeground) {
            setLoadStatus('Decodificando MP3 en RAM (Cero Latencia)...');
          }
          const decodedFoh = await ctx.decodeAudioData(fohBytes.slice(0));
          wipeAudioArrayBufferInRam(fohBytes);

          let decodedCue: AudioBuffer | null = null;
          const needsRamCue = !cueBytes || shouldSynthesizeLiveCueInRam(song);

          if (needsRamCue && Number(song?.prompter_data?.bpm) > 0) {
            const loadedVoices = await ensureVoiceCueWavsLoaded(ctx);
            if (loadedVoices > 0 || !cueBytes) {
              const savedClick = song?.prompter_data?.mixConfig?.click;
              const savedCues = song?.prompter_data?.mixConfig?.cues;
              decodedCue = await synthesizeLiveCueBuffer(
                ctx,
                song.prompter_data,
                decodedFoh.duration,
                voiceCueBuffersRef.current,
                voiceCueOffsetsRef.current,
                0.85,
                {
                  exactPreRollSec: resolveEffectivePreRoll(song),
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
                }
              );
            }
          }

          if (!decodedCue && cueBytes) {
            decodedCue = await ctx.decodeAudioData(cueBytes.slice(0));
          }
          wipeAudioArrayBufferInRam(cueBytes);

          if (!decodedCue) {
            return null;
          }

          const entry = { fohBuffer: decodedFoh, cueBuffer: decodedCue };
          if (decodedRamCacheRef.current.size >= 4) {
            const oldestKey = decodedRamCacheRef.current.keys().next().value;
            if (oldestKey && oldestKey !== loadedSongSignatureRef.current) {
              decodedRamCacheRef.current.delete(oldestKey);
            }
          }
          decodedRamCacheRef.current.set(targetSignature, entry);
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
    [ensureVoiceCueWavsLoaded, getInEarSongSignature]
  );

  // Carga instantánea desde RAM Cache (0ms síncrono si fue pre-decodificada) o desde la Bóveda Local MP3
  const loadAudioForSong = useCallback(
    async (song: any) => {
      const ctx = audioCtxRef.current;
      if (!ctx || !song?.id) return;

      const targetSignature = getInEarSongSignature(song);

      // 1. Si ya es la canción activa en RAM, no hacer nada
      if (
        loadedSongSignatureRef.current === targetSignature &&
        fohBufferRef.current &&
        cueBufferRef.current
      ) {
        setIsSongBuffersReady(true);
        if (!isAudioNodePlayingRef.current) {
          setLoadStatus('Listo en RAM (Esperando Play del Administrador)');
        }
        return;
      }

      const reqId = ++loadRequestIdRef.current;
      stopActiveSources();

      // 2. FAST-PATH SÍNCRONO (<0.1ms, cero awaits): si la siguiente canción ya fue pre-decodificada en RAM, activarla al instante
      const preDecoded = decodedRamCacheRef.current.get(targetSignature);
      if (preDecoded) {
        fohBufferRef.current = preDecoded.fohBuffer;
        cueBufferRef.current = preDecoded.cueBuffer;
        loadedSongSignatureRef.current = targetSignature;
        setIsSongBuffersReady(true);
        const initialOffset = pauseOffsetRef.current || 0;
        setCurrentTime(initialOffset - getPreRoll(song));
        setLoadStatus('Listo en RAM · Cambio Instantáneo (0ms)');

        const pendingTrigger = pendingPlayTriggerRef.current;
        if (
          isPlayingRef.current &&
          pendingTrigger &&
          (!pendingTrigger.songId || pendingTrigger.songId === song.id) &&
          pendingTrigger.ts !== lastExecutedTriggerTsRef.current
        ) {
          pendingPlayTriggerRef.current = null;
          void startSynchronizedPlayback(pendingTrigger);
        }
        return;
      }

      // 3. Ruta asíncrona: decodificar desde IndexedDB (o reutilizar decodificación en vuelo)
      cueBufferRef.current = null;
      fohBufferRef.current = null;
      setIsSongBuffersReady(false);
      loadedSongSignatureRef.current = '';
      setLoadStatus('Cargando audio desde memoria local...');

      const decoded = await decodeSongBuffersToRamCache(song, true);
      if (loadRequestIdRef.current !== reqId) return;

      if (!decoded) {
        setLoadStatus('Error: No se pudo preparar el audio de la canción');
        return;
      }

      fohBufferRef.current = decoded.fohBuffer;
      cueBufferRef.current = decoded.cueBuffer;
      loadedSongSignatureRef.current = targetSignature;
      setIsSongBuffersReady(true);

      const initialOffset = pauseOffsetRef.current || 0;
      setCurrentTime(initialOffset - getPreRoll(song));
      setLoadStatus('Listo en RAM (Esperando Play del Administrador)');

      const pendingTrigger = pendingPlayTriggerRef.current;
      if (
        isPlayingRef.current &&
        pendingTrigger &&
        (!pendingTrigger.songId || pendingTrigger.songId === song.id) &&
        pendingTrigger.ts !== lastExecutedTriggerTsRef.current
      ) {
        pendingPlayTriggerRef.current = null;
        await startSynchronizedPlayback(pendingTrigger);
      }
    },
    [
      decodeSongBuffersToRamCache,
      getInEarSongSignature,
      getPreRoll,
      startSynchronizedPlayback,
      stopActiveSources,
    ]
  );

  // Pre-decodificar silenciosamente en RAM la SIGUIENTE canción mientras suena o espera la actual (cambio en 0ms al terminar)
  useEffect(() => {
    if (!hasInteracted || !audioCtx || !isSongBuffersReady) return;

    const candidateNext =
      nextSongData && nextSongData.id !== songData?.id
        ? nextSongData
        : (() => {
            if (!songData?.id || activePlaylistSongs.length === 0) return null;
            const curIdx = activePlaylistSongs.findIndex(
              (s) => s.id === songData.id
            );
            return curIdx >= 0 && curIdx + 1 < activePlaylistSongs.length
              ? activePlaylistSongs[curIdx + 1]
              : null;
          })();

    if (!candidateNext?.id) return;
    const timer = window.setTimeout(() => {
      void decodeSongBuffersToRamCache(candidateNext, false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    hasInteracted,
    audioCtx,
    isSongBuffersReady,
    songData?.id,
    nextSongData,
    activePlaylistSongs,
    decodeSongBuffersToRamCache,
  ]);

  // Cargar canción cuando el Master envía LOAD_SONG / STATE_SNAPSHOT / PLAY
  useEffect(() => {
    if (songData && audioCtx && hasInteracted) {
      void loadAudioForSong(songData);
    }
  }, [songData, audioCtx, hasInteracted, loadAudioForSong]);

  // Disparar reproducción al recibir PLAY (o guardar como pendiente si aún está decodificando)
  useEffect(() => {
    if (!playTrigger || !hasInteracted) return;
    if (playTrigger.ts === lastExecutedTriggerTsRef.current) return;

    const matchesLoadedSong =
      !playTrigger.songId ||
      !songData?.id ||
      playTrigger.songId === songData.id;

    if (
      audioCtxRef.current &&
      cueBufferRef.current &&
      fohBufferRef.current &&
      isSongBuffersReady &&
      matchesLoadedSong
    ) {
      pendingPlayTriggerRef.current = null;
      void startSynchronizedPlayback(playTrigger);
    } else {
      // Guardar trigger para ejecutarlo con compensación de fase apenas termine la decodificación en RAM
      pendingPlayTriggerRef.current = playTrigger;
    }
  }, [
    playTrigger,
    hasInteracted,
    isSongBuffersReady,
    songData?.id,
    startSynchronizedPlayback,
  ]);

  // Pausa enviada por el Master
  useEffect(() => {
    if (!pauseTrigger) return;
    pendingPlayTriggerRef.current = null;
    stopActiveSources();
    setLoadStatus(
      isSongBuffersReady
        ? 'En Pausa (Standby)'
        : 'Esperando canción del Administrador...'
    );
  }, [pauseTrigger, isSongBuffersReady, stopActiveSources]);

  // Seek o Stop enviado por el Master (reposiciona realmente el audio si estaba sonando)
  useEffect(() => {
    if (!seekTrigger) return;
    pauseOffsetRef.current = seekTrigger.offset;
    setCurrentTime(seekTrigger.offset - getPreRoll(songData));

    if (seekTrigger.isStop) {
      pendingPlayTriggerRef.current = null;
      stopActiveSources();
      setLoadStatus('Detenido · Listo en Inicio / Pre-Roll');
    } else if (isPlayingRef.current && isAudioNodePlayingRef.current) {
      void startSynchronizedPlayback({
        startAt: Date.now() + clockOffsetRef.current,
        offset: seekTrigger.offset,
      });
    }
  }, [seekTrigger, songData, getPreRoll, stopActiveSources, startSynchronizedPlayback]);

  // Heartbeat periódico del Master: engancha celulares que entraron a mitad de canción o corrige derivas >42ms
  useEffect(() => {
    if (!heartbeatTrigger || !hasInteracted || !isPlayingRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx || !cueBufferRef.current || !fohBufferRef.current || !isSongBuffersReady) {
      pendingPlayTriggerRef.current = heartbeatTrigger;
      return;
    }

    if (!isAudioNodePlayingRef.current) {
      void startSynchronizedPlayback(heartbeatTrigger);
      return;
    }

    const slaveCurrentGlobalSec = Math.max(
      0,
      ctx.currentTime - startTimeRef.current
    );
    const drift = computeSlaveDriftCorrection({
      masterStartAtMs: heartbeatTrigger.startAt,
      masterBaseOffsetSec: heartbeatTrigger.offset,
      clientNowMs: Date.now(),
      clockOffsetMs: clockOffsetRef.current,
      slaveCurrentGlobalSec,
      driftThresholdSec: 0.042,
    });

    if (drift.needsResync) {
      void startSynchronizedPlayback(heartbeatTrigger);
    }
  }, [
    heartbeatTrigger,
    hasInteracted,
    isSongBuffersReady,
    startSynchronizedPlayback,
  ]);

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
                  ? `SINCRONIZADO${rttMs > 0 ? ` · ${rttMs}ms` : ''}`
                  : 'CONECTANDO...'}
              </span>
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

      {/* Prompter Visual Area */}
      <div className="flex-1 relative overflow-hidden">
        {songData ? (
          <Prompter
            currentTime={currentTime}
            preRollDuration={getPreRoll(songData)}
            preRollBars={resolveEffectivePreRollBars(songData)}
            lyricsTimeOffset={
              resolveLyricsTimeMapping(songData).prompterLyricsOffsetSec
            }
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

        {!isPlaying && (
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
