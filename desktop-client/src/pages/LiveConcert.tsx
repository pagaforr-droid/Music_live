import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Prompter, getSectionSolidStyle } from '../components/Prompter';
import { LyricVisualizer } from '../components/LyricVisualizer';
import { Play, Pause, Square, SkipBack, SkipForward, Music, LayoutList, Wifi, Type, Columns, ExternalLink, Repeat, Volume2, Headphones, Maximize2, RefreshCw, Check, Radio, Lock, Sliders, Activity, Zap, CloudDownload, HardDrive, Loader2, Smartphone } from 'lucide-react';
import { useSyncMaster } from '../hooks/useSyncMaster';
import {
  type LocalMp3TrackMeta,
  type PracticeSongItem,
  computeSongChannelSignature,
  downloadInEarPlaylistToLocalVault,
  ensureSongMp3CachedInDevice,
  evaluateInEarPlaylistReadiness,
  evaluateSongVaultState,
  formatBytesCompact,
  readDecryptedTrackArrayBuffer,
  readLocalTrackMeta,
  readLocalVaultSummary,
  requestPersistentDeviceStorage,
  resolvePreferredMp3Source,
  wipeAudioArrayBufferInRam,
} from '../services/musicianLocalAudioVault';
import { StageEqualizerConsole, LoadedStemSummary } from '../components/StageEqualizerConsole';
import { detectInstrumentCategory, InstrumentCategory } from '../utils/instrumentIcons';
import {
  CUE_NAMES,
  CueBuffersMap,
  CueOffsetsMap,
  loadCueBuffers,
  synthesizeLiveCueBuffer,
  shouldSynthesizeLiveCueInRam,
  resolveEffectivePreRoll,
  resolveEffectivePreRollBars,
  resolveEffectivePlaybackBounds,
  resolveLyricsTimeMapping,
} from '../utils/cueEngine';
import {
  STAGE_EQ_18_BANDS,
  StageEqProfile,
  StageBusDspNodes,
  MultiChannelPatchConfig,
  EqMemoryScope,
  StemBusGroupId,
  LIVE_STORAGE_KEYS,
  DEFAULT_STAGE_EQ_PROFILE,
  analyzeStagePatch,
  computeCueBalanceGains,
  createStageSafetySoftClipCurve,
  createStageBusDspNodes,
  applyProfileToStageBusDspNodes,
  resolveConsoleTarget,
  resolvePairIndices,
  resolveCueIndices,
  resolveStemConsoleTarget,
  computeRequiredMergerChannels,
  mapInstrumentCategoryToBusGroup,
  loadStoredJson,
  loadNormalizedMultiChannelPatch,
  loadStoredEqScope,
  loadStoredRoutingMode,
  notifyStageIoUpdated,
  subscribeStageIoUpdates,
} from '../utils/liveConsoleDSP';

interface DecodedStemBuffer {
  id: string;
  name: string;
  category: InstrumentCategory;
  group: StemBusGroupId;
  volume: number;
  pan: number;
  buffer: AudioBuffer;
}

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

interface PcRamCachedSongEntry {
  fohBuffer: AudioBuffer;
  cueBuffer: AudioBuffer;
  cueSource: 'mix' | 'ram';
}

// Cachés persistentes a nivel de módulo: sobreviven al cambiar a otros módulos de la app y volver a Live Concert (0ms, sin pantalla de carga)
const MODULE_PC_RAM_AUDIO_CACHE = new Map<string, PcRamCachedSongEntry>();
const MODULE_VOICE_CUE_BUFFERS: CueBuffersMap = {};
const MODULE_VOICE_CUE_OFFSETS: CueOffsetsMap = {};
const moduleLiveConcertSnapshot: {
  selectedSetlistId: string | null;
  setlists: any[];
  songs: any[];
  currentSongIndex: number;
  pcVaultTracksBySongId: Record<string, LocalMp3TrackMeta>;
  dirtyFromStudio: boolean;
} = {
  selectedSetlistId: null,
  setlists: [],
  songs: [],
  currentSongIndex: 0,
  pcVaultTracksBySongId: {},
  dirtyFromStudio: false,
};

function invalidateSongInModuleRamCache(songId: string) {
  if (!songId) return;
  for (const key of Array.from(MODULE_PC_RAM_AUDIO_CACHE.keys())) {
    if (key.startsWith(`${songId}|`)) {
      MODULE_PC_RAM_AUDIO_CACHE.delete(key);
    }
  }
}

// Escuchar cambios hechos en Studio Prompter / Lyric Studio incluso cuando el usuario salió temporalmente de Live Concert
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    const bgSyncChannel = new BroadcastChannel('tandu_stage_sync');
    bgSyncChannel.onmessage = (event) => {
      const msgType = event.data?.type;
      const songId = event.data?.songId;
      if (
        songId &&
        (msgType === 'LIVE_MIX_EXPORTED' ||
          msgType === 'PROMPTER_UPDATED' ||
          msgType === 'SONG_LYRICS_UPDATED')
      ) {
        moduleLiveConcertSnapshot.dirtyFromStudio = true;
        if (msgType === 'LIVE_MIX_EXPORTED' || msgType === 'PROMPTER_UPDATED') {
          invalidateSongInModuleRamCache(songId);
        }
      }
    };
  } catch {}
}

export default function LiveConcert() {
  const navigate = useNavigate();
  // Detectar si esta ventana fue abierta como Proyector Externo HDMI (?projector=1)
  const isProjectorWindow = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('projector') === '1';
  const [projectorState, setProjectorState] = useState<{
    currentTime: number;
    isPlaying: boolean;
    title: string;
    lyrics: any[];
    settings?: any;
    bpm?: number;
    firstBeatOffset?: number;
    beatTimes?: number[];
    background?: any;
  }>({
    currentTime: 0,
    isPlaying: false,
    title: 'TANDU STAGE',
    lyrics: [],
  });

  const projectorChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('tandu_stage_projector');
    projectorChannelRef.current = ch;

    if (isProjectorWindow) {
      ch.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'PROJECTOR_SYNC') {
          setProjectorState(ev.data.payload);
        }
      };
    }

    return () => {
      ch.close();
    };
  }, [isProjectorWindow]);

  const [setlists, setSetlists] = useState<any[]>(() => moduleLiveConcertSnapshot.setlists);
  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(() => {
    return (
      sessionStorage.getItem('tandu_active_setlist_id') ||
      moduleLiveConcertSnapshot.selectedSetlistId
    );
  });
  const [viewMode, setViewMode] = useState<'dual' | 'prompter' | 'lyrics'>('dual');

  const [songs, setSongs] = useState<any[]>(() => {
    const activeId =
      sessionStorage.getItem('tandu_active_setlist_id') ||
      moduleLiveConcertSnapshot.selectedSetlistId;
    return activeId && moduleLiveConcertSnapshot.selectedSetlistId === activeId
      ? moduleLiveConcertSnapshot.songs
      : [];
  });
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(() => {
    const activeId =
      sessionStorage.getItem('tandu_active_setlist_id') ||
      moduleLiveConcertSnapshot.selectedSetlistId;
    return activeId && moduleLiveConcertSnapshot.selectedSetlistId === activeId
      ? moduleLiveConcertSnapshot.currentSongIndex
      : 0;
  });
  const currentSong = songs[currentSongIndex] || null;
  const currentHasLyrics = Boolean(currentSong?.prompter_data?.lyrics && currentSong.prompter_data.lyrics.length > 0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioTime, setAudioTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const totalDurationRef = useRef<number>(0);
  const [skipPreRoll, setSkipPreRoll] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('tandu_live_skip_preroll') === '1';
    } catch {
      return false;
    }
  });
  const skipPreRollRef = useRef<boolean>(skipPreRoll);
  useEffect(() => {
    skipPreRollRef.current = skipPreRoll;
    try {
      sessionStorage.setItem('tandu_live_skip_preroll', skipPreRoll ? '1' : '0');
    } catch {}
  }, [skipPreRoll]);
  const isApplyingExternalIoSyncRef = useRef(false);
  const [routingMode, setRoutingMode] = useState<'StereoInEar' | 'StereoSplit' | 'MultiChannel'>(() => loadStoredRoutingMode());
  const routingModeRef = useRef<'StereoInEar' | 'StereoSplit' | 'MultiChannel'>(routingMode);
  useEffect(() => {
    routingModeRef.current = routingMode;
    try { localStorage.setItem(LIVE_STORAGE_KEYS.ROUTING_MODE, routingMode); } catch {}
    if (!isApplyingExternalIoSyncRef.current) {
      notifyStageIoUpdated('live_concert');
    }
  }, [routingMode]);

  // Console DSP: Ecualizador de 18 Bandas + Matriz Multicanal
  const [isEqDrawerOpen, setIsEqDrawerOpen] = useState<boolean>(false);
  const isEqDrawerOpenRef = useRef<boolean>(false);
  useEffect(() => { isEqDrawerOpenRef.current = isEqDrawerOpen; }, [isEqDrawerOpen]);

  const [eqMemoryScope, setEqMemoryScope] = useState<EqMemoryScope>(() => loadStoredEqScope());
  const handleChangeMemoryScope = (scope: EqMemoryScope) => {
    setEqMemoryScope(scope);
    try { localStorage.setItem(LIVE_STORAGE_KEYS.EQ_SCOPE, scope); } catch {}
    notifyStageIoUpdated('live_concert');
  };

  const [globalEqProfile, setGlobalEqProfile] = useState<StageEqProfile>(() =>
    loadStoredJson<StageEqProfile>(LIVE_STORAGE_KEYS.EQ_GLOBAL, DEFAULT_STAGE_EQ_PROFILE)
  );
  const [songEqProfiles, setSongEqProfiles] = useState<Record<string, StageEqProfile>>(() => {
    try {
      const raw = localStorage.getItem(LIVE_STORAGE_KEYS.EQ_SONGS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const activeEqProfile: StageEqProfile =
    eqMemoryScope === 'per_song' && currentSong?.id && songEqProfiles[currentSong.id]
      ? songEqProfiles[currentSong.id]
      : globalEqProfile;
  const activeEqProfileRef = useRef<StageEqProfile>(activeEqProfile);
  useEffect(() => { activeEqProfileRef.current = activeEqProfile; }, [activeEqProfile]);

  const updateActiveEqProfile = (updater: (prev: StageEqProfile) => StageEqProfile) => {
    if (eqMemoryScope === 'per_song' && currentSong?.id) {
      const songId = currentSong.id;
      setSongEqProfiles((prevMap) => {
        const base = prevMap[songId] || globalEqProfile;
        const next = updater(base);
        const updatedMap = { ...prevMap, [songId]: next };
        try { localStorage.setItem(LIVE_STORAGE_KEYS.EQ_SONGS, JSON.stringify(updatedMap)); } catch {}
        notifyStageIoUpdated('live_concert');
        return updatedMap;
      });
    } else {
      setGlobalEqProfile((prev) => {
        const next = updater(prev);
        try { localStorage.setItem(LIVE_STORAGE_KEYS.EQ_GLOBAL, JSON.stringify(next)); } catch {}
        notifyStageIoUpdated('live_concert');
        return next;
      });
    }
  };

  const [multiChannelPatch, setMultiChannelPatch] = useState<MultiChannelPatchConfig>(() =>
    loadNormalizedMultiChannelPatch()
  );
  const multiChannelPatchRef = useRef<MultiChannelPatchConfig>(multiChannelPatch);
  useEffect(() => {
    multiChannelPatchRef.current = multiChannelPatch;
    try { localStorage.setItem(LIVE_STORAGE_KEYS.MC_PATCH, JSON.stringify(multiChannelPatch)); } catch {}
    if (!isApplyingExternalIoSyncRef.current) {
      notifyStageIoUpdated('live_concert');
    }
  }, [multiChannelPatch]);

  // Escuchar cambios externos (StageSoundcheck u otra ventana) evitando auto-eco
  useEffect(() => {
    if (isProjectorWindow) return;
    return subscribeStageIoUpdates(
      () => {
        isApplyingExternalIoSyncRef.current = true;
        setRoutingMode(loadStoredRoutingMode());
        setMultiChannelPatch(loadNormalizedMultiChannelPatch());
        setEqMemoryScope(loadStoredEqScope());
        setGlobalEqProfile(loadStoredJson<StageEqProfile>(LIVE_STORAGE_KEYS.EQ_GLOBAL, DEFAULT_STAGE_EQ_PROFILE));
        try {
          const rawSongsEq = localStorage.getItem(LIVE_STORAGE_KEYS.EQ_SONGS);
          if (rawSongsEq) setSongEqProfiles(JSON.parse(rawSongsEq));
        } catch {}
        window.setTimeout(() => {
          isApplyingExternalIoSyncRef.current = false;
        }, 0);
      },
      { ignoreSource: 'live_concert' }
    );
  }, [isProjectorWindow]);

  const [hardwareMaxChannels, setHardwareMaxChannels] = useState<number>(2);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [sinkSwitchError, setSinkSwitchError] = useState<boolean>(false);
  const hardwareLatencyMsRef = useRef<number>(0);
  const [loadedStemsSummary, setLoadedStemsSummary] = useState<LoadedStemSummary[]>([]);
  const [isLoadingStems, setIsLoadingStems] = useState<boolean>(false);

  const [isRefreshingSong, setIsRefreshingSong] = useState(false);


  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Modo Concierto (Stage Lock / Key Arms)
  const [isConcertMode, setIsConcertMode] = useState<boolean>(false);
  const isConcertModeRef = useRef<boolean>(false);
  useEffect(() => { isConcertModeRef.current = isConcertMode; }, [isConcertMode]);

  // Stage OSD Feedback Flotante
  const [stageOsd, setStageOsd] = useState<{
    type: 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'mode_on' | 'mode_off';
    label: string;
    sublabel?: string;
  } | null>(null);
  const osdTimeoutRef = useRef<any>(null);

  const triggerStageOsd = (
    type: 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'mode_on' | 'mode_off',
    label: string,
    sublabel?: string
  ) => {
    if (osdTimeoutRef.current) clearTimeout(osdTimeoutRef.current);
    setStageOsd({ type, label, sublabel });
    osdTimeoutRef.current = setTimeout(() => {
      setStageOsd(null);
    }, 850);
  };

  const toggleConcertMode = () => {
    (document.activeElement as HTMLElement)?.blur();
    setIsConcertMode((prev) => {
      const next = !prev;
      if (next) {
        triggerStageOsd(
          'mode_on',
          'MODO CONCIERTO ARMADO',
          'Barra espaciadora y pedales listos para el show'
        );
      } else {
        triggerStageOsd(
          'mode_off',
          'MODO EDICIÓN / REPOSO',
          'Atajos en reposo (Seguro contra disparos accidentales)'
        );
      }
      return next;
    });
  };

  // Faders Independientes: Salida Público (FOH - R), Salida Músicos (CUE - L) y Master
  const [masterVolume] = useState<number>(1.0);
  const [fohVolume, setFohVolume] = useState<number>(1.0);
  const [cueVolume, setCueVolume] = useState<number>(1.0);
  const [muteCueEmergency, setMuteCueEmergency] = useState<boolean>(false);

  // Vamp Loop en Vivo
  const [isVamping, setIsVamping] = useState<boolean>(false);
  const vampRangeRef = useRef<{ active: boolean; start: number; end: number }>({ active: false, start: 0, end: 0 });

  const [playbackMode, setPlaybackMode] = useState<'LIVE' | 'REHEARSAL'>(() => {
    try {
      return sessionStorage.getItem('tandu_live_playback_mode') === 'REHEARSAL'
        ? 'REHEARSAL'
        : 'LIVE';
    } catch {
      return 'LIVE';
    }
  });
  const playbackModeRef = useRef<'LIVE' | 'REHEARSAL'>(playbackMode);
  useEffect(() => {
    playbackModeRef.current = playbackMode;
    try {
      sessionStorage.setItem('tandu_live_playback_mode', playbackMode);
    } catch {}
  }, [playbackMode]);

  // Memoria Local Persistente de la PC (IndexedDB MP3 Vault) + Caché LRU de AudioBuffers en RAM a nivel de módulo
  const [pcVaultTracksBySongId, setPcVaultTracksBySongId] = useState<
    Record<string, LocalMp3TrackMeta>
  >(() => moduleLiveConcertSnapshot.pcVaultTracksBySongId);
  const pcVaultTracksBySongIdRef = useRef<Record<string, LocalMp3TrackMeta>>(
    moduleLiveConcertSnapshot.pcVaultTracksBySongId
  );
  useEffect(() => {
    pcVaultTracksBySongIdRef.current = pcVaultTracksBySongId;
    moduleLiveConcertSnapshot.pcVaultTracksBySongId = pcVaultTracksBySongId;
  }, [pcVaultTracksBySongId]);
  const [isDownloadingSetlistToPc, setIsDownloadingSetlistToPc] =
    useState<boolean>(false);
  const [pcDownloadProgressMsg, setPcDownloadProgressMsg] = useState<string>('');
  const [redownloadingSongId, setRedownloadingSongId] = useState<string | null>(
    null
  );
  const pcRamAudioCacheRef = useRef<Map<string, PcRamCachedSongEntry>>(
    MODULE_PC_RAM_AUDIO_CACHE
  );

  // Network Sync (Para In-Ears de Práctica por Wi-Fi)
  const [broadcastEnabled, setBroadcastEnabled] = useState(false);
  const broadcastEnabledRef = useRef<boolean>(false);
  const connectionsRef = useRef<number>(0);
  const selectedSetlistIdRef = useRef<string | null>(selectedSetlistId);
  useEffect(() => { broadcastEnabledRef.current = broadcastEnabled; }, [broadcastEnabled]);
  useEffect(() => { selectedSetlistIdRef.current = selectedSetlistId; }, [selectedSetlistId]);

  const getNextSongInSetlist = () => {
    const idx = currentSongIndexRef.current;
    const all = songsRef.current;
    return idx >= 0 && idx + 1 < all.length ? all[idx + 1] : null;
  };

  const buildMasterSyncSnapshot = () => {
    const curSong = currentSongRef.current || currentSong;
    const nextSong = getNextSongInSetlist();
    if (!curSong) {
      return {
        type: 'STATE_SNAPSHOT' as const,
        setlistId: selectedSetlistIdRef.current,
        nextSongData: nextSong,
        isPlaying: false,
      };
    }
    const ctx = audioCtxRef.current;
    const playingNow = Boolean(broadcastEnabledRef.current && isPlayingRef.current && ctx);
    const curGlobalOffset = playingNow && ctx
      ? Math.max(0, ctx.currentTime - startTimeRef.current)
      : Math.max(0, pauseTimeRef.current);
    const syncCompMs = Math.round(
      (hardwareLatencyMsRef.current || 0) + (multiChannelPatchRef.current.syncOffsetMs || 0)
    );
    return {
      type: 'STATE_SNAPSHOT' as const,
      setlistId: selectedSetlistIdRef.current,
      songId: curSong.id,
      songData: curSong,
      nextSongData: nextSong,
      isPlaying: playingNow,
      startAt: Date.now() + syncCompMs,
      offset: curGlobalOffset,
    };
  };

  const {
    broadcast,
    connections,
    readyClients,
    scanDevices,
    isScanning,
    channelStatus: inEarChannelStatus,
  } = useSyncMaster(isProjectorWindow ? '' : FAKE_BAND_ID, {
    getStateSnapshot: buildMasterSyncSnapshot,
  });
  useEffect(() => { connectionsRef.current = connections; }, [connections]);

  const [isInEarRadarOpen, setIsInEarRadarOpen] = useState(false);
  const inEarRadarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isInEarRadarOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (inEarRadarRef.current && !inEarRadarRef.current.contains(event.target as Node)) {
        setIsInEarRadarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isInEarRadarOpen]);

  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [localSliderTime, setLocalSliderTime] = useState(0);

  // Audio Context & Nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const fohSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const cueSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const stemSourcesRef = useRef<{ id: string; name: string; category: InstrumentCategory; source: AudioBufferSourceNode; gainNode: GainNode; pannerNode: StereoPannerNode; baseVolume: number; group: StemBusGroupId }[]>([]);

  // Buffers loaded in RAM
  const fohBufferRef = useRef<AudioBuffer | null>(null);
  const cueBufferRef = useRef<AudioBuffer | null>(null);
  const stemCacheRef = useRef<Map<string, DecodedStemBuffer[]>>(new Map());
  const stemInflightPromisesRef = useRef<Map<string, Promise<DecodedStemBuffer[]>>>(new Map());
  const activeStemsRef = useRef<DecodedStemBuffer[]>([]);

  // Persistent DSP & Routing Nodes
  const masterGainRef = useRef<GainNode | null>(null);
  const fohGainRef = useRef<GainNode | null>(null);
  const cueGainRef = useRef<GainNode | null>(null);

  // FOH 18-Band EQ + HPF + Headroom + Safety Soft-Clip Limiter + Analyser
  const fohHpfRef = useRef<BiquadFilterNode | null>(null);
  const fohEqNodesRef = useRef<BiquadFilterNode[]>([]);
  const fohHeadroomGainRef = useRef<GainNode | null>(null);
  const fohShaperRef = useRef<WaveShaperNode | null>(null);
  const fohAnalyserRef = useRef<AnalyserNode | null>(null);
  const safetyCurveRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  // CUE In-Ear Tone + Analyser
  const cueToneLowpassRef = useRef<BiquadFilterNode | null>(null);
  const cueTonePeakRef = useRef<BiquadFilterNode | null>(null);
  const cueAnalyserRef = useRef<AnalyserNode | null>(null);

  // Routing Tail Nodes
  const fohPannerRef = useRef<StereoPannerNode | null>(null);
  const cuePannerRef = useRef<StereoPannerNode | null>(null);
  const fohSplitterRef = useRef<ChannelSplitterNode | null>(null);
  const cueSplitterRef = useRef<ChannelSplitterNode | null>(null);
  const cueMonoSumGainRef = useRef<GainNode | null>(null);
  const mergerRef = useRef<ChannelMergerNode | null>(null);
  const stemTailNodesRef = useRef<AudioNode[]>([]);
  const stemBusDspChainsRef = useRef<StageBusDspNodes[]>([]);

  const fohVolumeRef = useRef<number>(fohVolume);
  const cueVolumeRef = useRef<number>(cueVolume);
  const muteCueEmergencyRef = useRef<boolean>(muteCueEmergency);
  const masterVolumeRef = useRef<number>(masterVolume);
  useEffect(() => { fohVolumeRef.current = fohVolume; }, [fohVolume]);
  useEffect(() => { cueVolumeRef.current = cueVolume; }, [cueVolume]);
  useEffect(() => { muteCueEmergencyRef.current = muteCueEmergency; }, [muteCueEmergency]);
  useEffect(() => { masterVolumeRef.current = masterVolume; }, [masterVolume]);

  // Time tracking
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const animationFrameRef = useRef(0);
  const isPlayingRef = useRef(false);

  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState('');
  const [liveCueSource, setLiveCueSource] = useState<'mix' | 'ram'>('mix');

  // Caché global en RAM de las 11 Voces Guía (WAV PCM prioritario) compartido a nivel de módulo
  const cueBuffersCacheRef = useRef<CueBuffersMap>(MODULE_VOICE_CUE_BUFFERS);
  const cueOffsetsCacheRef = useRef<CueOffsetsMap>(MODULE_VOICE_CUE_OFFSETS);
  const cueLoadPromiseRef = useRef<Promise<number> | null>(null);
  const activeCueSignatureRef = useRef<string>('');

  // Pre-carga silenciosa de la SIGUIENTE canción (indexada por songId + playbackMode + URLs + firma CUE para evitar cruces)
  const prefetchedSongRef = useRef<{
    songId: string;
    playbackMode: 'LIVE' | 'REHEARSAL';
    fohUrl: string;
    cueUrl: string;
    cueSignature: string;
    cueSource: 'mix' | 'ram';
    fohBuffer: AudioBuffer;
    cueBuffer: AudioBuffer;
  } | null>(null);
  const isPrefetchingRef = useRef(false);
  const loadRequestIdRef = useRef<number>(0);
  const loadAbortControllerRef = useRef<AbortController | null>(null);
  const autoPlayOnLoadRef = useRef(false);
  const songsRef = useRef<any[]>([]);
  const currentSongIndexRef = useRef<number>(0);
  const currentSongRef = useRef<any>(null);
  const isLoadingRef = useRef<boolean>(false);

  const playRef = useRef<() => void>(() => {});
  const pauseRef = useRef<(silent?: boolean) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  const nextSongRef = useRef<() => void>(() => {});
  const prevSongRef = useRef<() => void>(() => {});

  const getSafetyCurve = () => {
    if (!safetyCurveRef.current) {
      safetyCurveRef.current = createStageSafetySoftClipCurve(-0.3);
    }
    return safetyCurveRef.current;
  };

  const ensureDspGraph = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    if (!masterGainRef.current) {
      masterGainRef.current = ctx.createGain();
      masterGainRef.current.gain.value = masterVolumeRef.current;
      masterGainRef.current.connect(ctx.destination);
    }

    if (!fohGainRef.current) {
      fohGainRef.current = ctx.createGain();
      fohGainRef.current.gain.value = fohVolumeRef.current;

      const chain = createStageBusDspNodes(ctx, getSafetyCurve());
      fohHpfRef.current = chain.hpf;
      fohEqNodesRef.current = chain.eqBands;
      fohHeadroomGainRef.current = chain.headroomGain;
      fohShaperRef.current = chain.shaper;

      fohAnalyserRef.current = ctx.createAnalyser();
      fohAnalyserRef.current.fftSize = 1024;
      fohAnalyserRef.current.smoothingTimeConstant = 0.78;

      fohGainRef.current.connect(chain.hpf);
      chain.output.connect(fohAnalyserRef.current);
    }

    if (!cueGainRef.current) {
      cueGainRef.current = ctx.createGain();
      cueGainRef.current.gain.value = muteCueEmergencyRef.current ? 0 : cueVolumeRef.current;

      cueToneLowpassRef.current = ctx.createBiquadFilter();
      cueToneLowpassRef.current.type = 'lowpass';
      cueToneLowpassRef.current.frequency.value = 20000;
      cueToneLowpassRef.current.Q.value = 0.707;

      cueTonePeakRef.current = ctx.createBiquadFilter();
      cueTonePeakRef.current.type = 'peaking';
      cueTonePeakRef.current.frequency.value = 1800;
      cueTonePeakRef.current.Q.value = 1.2;
      cueTonePeakRef.current.gain.value = 0;

      cueAnalyserRef.current = ctx.createAnalyser();
      cueAnalyserRef.current.fftSize = 256;
      cueAnalyserRef.current.smoothingTimeConstant = 0.78;

      cueGainRef.current.connect(cueToneLowpassRef.current);
      cueToneLowpassRef.current.connect(cueTonePeakRef.current);
      cueTonePeakRef.current.connect(cueAnalyserRef.current);
    }
  };

  const applyAllDspParams = (profile: StageEqProfile) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    ensureDspGraph();
    const curve = getSafetyCurve();

    if (
      fohHpfRef.current &&
      fohEqNodesRef.current.length === STAGE_EQ_18_BANDS.length &&
      fohHeadroomGainRef.current &&
      fohShaperRef.current
    ) {
      applyProfileToStageBusDspNodes(
        ctx,
        {
          hpf: fohHpfRef.current,
          eqBands: fohEqNodesRef.current,
          headroomGain: fohHeadroomGainRef.current,
          shaper: fohShaperRef.current,
          output: fohShaperRef.current,
        },
        profile,
        curve
      );
    }

    // Actualizar cadenas DSP de stems si el modo Multitrack Stems está activo
    stemBusDspChainsRef.current.forEach((chain) => {
      applyProfileToStageBusDspNodes(ctx, chain, profile, curve);
    });

    // Tono In-Ear del canal MÚSICOS (CUE)
    if (cueToneLowpassRef.current && cueTonePeakRef.current) {
      const now = ctx.currentTime;
      if (profile.cueTone === 'warm_wood') {
        cueToneLowpassRef.current.frequency.setTargetAtTime(3400, now, 0.02);
        cueTonePeakRef.current.frequency.setTargetAtTime(650, now, 0.02);
        cueTonePeakRef.current.gain.setTargetAtTime(2.5, now, 0.02);
      } else if (profile.cueTone === 'clear_voice') {
        cueToneLowpassRef.current.frequency.setTargetAtTime(12000, now, 0.02);
        cueTonePeakRef.current.frequency.setTargetAtTime(2100, now, 0.02);
        cueTonePeakRef.current.gain.setTargetAtTime(4.0, now, 0.02);
      } else {
        cueToneLowpassRef.current.frequency.setTargetAtTime(20000, now, 0.02);
        cueTonePeakRef.current.frequency.setTargetAtTime(1800, now, 0.02);
        cueTonePeakRef.current.gain.setTargetAtTime(0, now, 0.02);
      }
    }
  };

  const refreshHardwareDevices = async () => {
    const ctx = audioCtxRef.current;
    if (ctx) {
      setHardwareMaxChannels(ctx.destination.maxChannelCount || 2);
      const rawLat = ((ctx as any).baseLatency || 0) + ((ctx as any).outputLatency || 0);
      hardwareLatencyMsRef.current = Math.round(rawLat * 1000);
    }
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter((d) => d.kind === 'audiooutput');
        setAudioOutputs(outputs);

        const patchNow = multiChannelPatchRef.current;
        if (patchNow.sinkLabel && !outputs.some((d) => d.deviceId === patchNow.sinkId)) {
          const matched = outputs.find(
            (d) => d.label && d.label.toLowerCase() === patchNow.sinkLabel?.toLowerCase()
          );
          if (matched) {
            setMultiChannelPatch((prev) => ({ ...prev, sinkId: matched.deviceId }));
          }
        }
      }
    } catch {}
  };

  const getSongCueSignature = (song: any): string => {
    const pd = song?.prompter_data || {};
    return JSON.stringify({
      v: pd.liveMixMeta?.version ?? 0,
      exp: pd.liveMixMeta?.exportedAt ?? '',
      upd: pd.sectionsUpdatedAt ?? '',
      cnt: Array.isArray(pd.sections) ? pd.sections.length : 0,
      secHash: Array.isArray(pd.sections)
        ? pd.sections
            .map((s: any) => `${s?.name || s?.section || ''}:${s?.time ?? ''}:${s?.cueEnabled !== false ? 1 : 0}`)
            .join('|')
        : '',
      bpm: pd.bpm ?? 0,
      ts: pd.timeSignature ?? '4/4',
      firstBeat: pd.firstBeatOffset ?? 0,
      click: pd.mixConfig?.click ?? null,
      cues: pd.mixConfig?.cues ?? null,
    });
  };

  const ensureLiveCueBuffersLoaded = async (ctx: AudioContext): Promise<number> => {
    if (!ctx || ctx.state === 'closed') return Object.keys(cueBuffersCacheRef.current).length;
    const existing = Object.keys(cueBuffersCacheRef.current).length;
    if (existing >= CUE_NAMES.length) return existing;
    if (cueLoadPromiseRef.current) return cueLoadPromiseRef.current;

    const promise = (async () => {
      try {
        const loaded = await loadCueBuffers(ctx);
        Object.assign(MODULE_VOICE_CUE_BUFFERS, loaded.cueBuffers);
        Object.assign(MODULE_VOICE_CUE_OFFSETS, loaded.cueOffsets);
        cueBuffersCacheRef.current = MODULE_VOICE_CUE_BUFFERS;
        cueOffsetsCacheRef.current = MODULE_VOICE_CUE_OFFSETS;
        return Object.keys(cueBuffersCacheRef.current).length;
      } catch (err) {
        console.warn('[LiveConcert] Error precargando voces guía en RAM:', err);
        return Object.keys(cueBuffersCacheRef.current).length;
      } finally {
        cueLoadPromiseRef.current = null;
      }
    })();

    cueLoadPromiseRef.current = promise;
    return promise;
  };

  const resolveCueBufferForSong = async (
    song: any,
    decodedFoh: AudioBuffer,
    decodedCue: AudioBuffer | null,
    forceRam = false
  ): Promise<{ buffer: AudioBuffer; source: 'mix' | 'ram' } | null> => {
    const ctx = audioCtxRef.current;
    const needsRam = forceRam || !decodedCue || shouldSynthesizeLiveCueInRam(song);
    if (!needsRam && decodedCue) {
      return { buffer: decodedCue, source: 'mix' };
    }

    if (ctx && Number(song?.prompter_data?.bpm) > 0) {
      try {
        const loadedCount = await ensureLiveCueBuffersLoaded(ctx);
        if (loadedCount > 0 || !decodedCue) {
          const savedClick = song?.prompter_data?.mixConfig?.click;
          const savedCues = song?.prompter_data?.mixConfig?.cues;
          const synthBuf = await synthesizeLiveCueBuffer(
            ctx,
            song.prompter_data,
            decodedFoh.duration,
            cueBuffersCacheRef.current,
            cueOffsetsCacheRef.current,
            0.85,
            {
              exactPreRollSec: resolveEffectivePreRoll(song),
              clickVolume:
                typeof savedClick?.volume === 'number' && Number.isFinite(savedClick.volume)
                  ? savedClick.volume
                  : 0.8,
              clickPan:
                typeof savedClick?.pan === 'number' && Number.isFinite(savedClick.pan)
                  ? savedClick.pan
                  : 0,
              clickMuted: savedClick?.muted === true,
              cueVolume:
                typeof savedCues?.volume === 'number' && Number.isFinite(savedCues.volume)
                  ? savedCues.volume
                  : 0.85,
              cuePan:
                typeof savedCues?.pan === 'number' && Number.isFinite(savedCues.pan)
                  ? savedCues.pan
                  : 0,
              cueMuted: savedCues?.muted === true,
            }
          );
          return { buffer: synthBuf, source: 'ram' };
        }
      } catch (err) {
        console.warn('[LiveConcert] Fallo síntesis de Voz Guía en RAM, usando CUE exportado:', err);
      }
    }

    return decodedCue ? { buffer: decodedCue, source: 'mix' } : null;
  };

  const refreshActiveCueInRam = async (updatedSong: any) => {
    if (!audioCtxRef.current || !fohBufferRef.current || !updatedSong?.id) return;
    if (currentSongRef.current?.id !== updatedSong.id) return;
    const nextSig = `${updatedSong.id}|${getSongCueSignature(updatedSong)}`;
    if (nextSig === activeCueSignatureRef.current) return;
    if (!shouldSynthesizeLiveCueInRam(updatedSong)) return;

    const resolved = await resolveCueBufferForSong(
      updatedSong,
      fohBufferRef.current,
      cueBufferRef.current,
      true
    );
    if (resolved && currentSongRef.current?.id === updatedSong.id) {
      cueBufferRef.current = resolved.buffer;
      activeCueSignatureRef.current = nextSig;
      setLiveCueSource(resolved.source);
    }
  };

  useEffect(() => {
    if (isProjectorWindow) return;

    // Solo consultar setlists en Supabase si aún no están en memoria de sesión o hubo cambios en Studio
    if (
      moduleLiveConcertSnapshot.setlists.length === 0 ||
      moduleLiveConcertSnapshot.dirtyFromStudio
    ) {
      void fetchSetlists();
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtxRef.current = new AudioContextClass();
    ensureDspGraph();
    applyAllDspParams(activeEqProfileRef.current);
    refreshHardwareDevices();
    void ensureLiveCueBuffersLoaded(audioCtxRef.current);
    void requestPersistentDeviceStorage();
    readLocalVaultSummary()
      .then((sum) => setPcVaultTracksBySongId(sum.tracksBySongId))
      .catch(() => {});

    let deviceChangeTimer: number | null = null;
    const handleDeviceChange = () => {
      if (deviceChangeTimer) window.clearTimeout(deviceChangeTimer);
      deviceChangeTimer = window.setTimeout(() => {
        deviceChangeTimer = null;
        refreshHardwareDevices();
        buildRoutingGraph();
      }, 350);
    };
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);

    return () => {
      if (deviceChangeTimer) window.clearTimeout(deviceChangeTimer);
      loadAbortControllerRef.current?.abort();
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
      pauseRef.current(true);
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [isProjectorWindow]);

  // Aplicar Sink ID de interfaz USB Multicanal cuando cambia en el Patchbay
  useEffect(() => {
    if (isProjectorWindow) return;
    const ctx = audioCtxRef.current as any;
    if (!ctx || typeof ctx.setSinkId !== 'function') return;
    const targetSink = multiChannelPatch.sinkId || '';
    ctx
      .setSinkId(targetSink)
      .then(() => {
        setSinkSwitchError(false);
        if (audioCtxRef.current) {
          setHardwareMaxChannels(audioCtxRef.current.destination.maxChannelCount || 2);
          const rawLat =
            ((audioCtxRef.current as any).baseLatency || 0) +
            ((audioCtxRef.current as any).outputLatency || 0);
          hardwareLatencyMsRef.current = Math.round(rawLat * 1000);
          buildRoutingGraph();
        }
      })
      .catch((err: any) => {
        setSinkSwitchError(true);
        console.warn('[LiveConcert] setSinkId no disponible o rechazado:', err);
      });
  }, [multiChannelPatch.sinkId, isProjectorWindow]);

  useEffect(() => {
    if (isProjectorWindow) return;
    prefetchedSongRef.current = null;
    if (selectedSetlistId) {
      sessionStorage.setItem('tandu_active_setlist_id', selectedSetlistId);
      // Si ya tenemos las canciones de este Setlist en memoria y no hubo cambios en Studio, reutilizarlas al instante (0 queries)
      if (
        moduleLiveConcertSnapshot.selectedSetlistId === selectedSetlistId &&
        moduleLiveConcertSnapshot.songs.length > 0 &&
        !moduleLiveConcertSnapshot.dirtyFromStudio
      ) {
        if (songs.length === 0) {
          setSongs(moduleLiveConcertSnapshot.songs);
          setCurrentSongIndex(moduleLiveConcertSnapshot.currentSongIndex);
        }
        return;
      }
      moduleLiveConcertSnapshot.selectedSetlistId = selectedSetlistId;
      moduleLiveConcertSnapshot.dirtyFromStudio = false;
      void fetchSetlistSongs(selectedSetlistId, {
        preserveCurrentSong:
          moduleLiveConcertSnapshot.selectedSetlistId === selectedSetlistId,
      });
    } else {
      moduleLiveConcertSnapshot.selectedSetlistId = null;
      moduleLiveConcertSnapshot.songs = [];
      moduleLiveConcertSnapshot.currentSongIndex = 0;
      setSongs([]);
      setCurrentSongIndex(0);
    }
  }, [selectedSetlistId, isProjectorWindow]);

  useEffect(() => {
    songsRef.current = songs;
    if (selectedSetlistId) {
      moduleLiveConcertSnapshot.selectedSetlistId = selectedSetlistId;
      moduleLiveConcertSnapshot.songs = songs;
    }
  }, [songs, selectedSetlistId]);
  useEffect(() => {
    currentSongIndexRef.current = currentSongIndex;
    moduleLiveConcertSnapshot.currentSongIndex = currentSongIndex;
  }, [currentSongIndex]);
  useEffect(() => {
    moduleLiveConcertSnapshot.setlists = setlists;
  }, [setlists]);
  useEffect(() => { currentSongRef.current = currentSong; }, [currentSong]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // Limpiar caché de prefetch al alternar CONSOLA VIVO ↔ MODO PRÁCTICA
  useEffect(() => {
    prefetchedSongRef.current = null;
  }, [playbackMode]);

  // Cargar audio al cambiar canción, URLs exportadas o modo (SIN cortar por alternar Wi-Fi In-Ear)
  useEffect(() => {
    if (isProjectorWindow) return;
    if (currentSong) {
      setIsVamping(false);
      vampRangeRef.current = { active: false, start: 0, end: 0 };
      loadSongAudio(currentSong, autoPlayOnLoadRef.current);
      autoPlayOnLoadRef.current = false;
    }
  }, [
    currentSongIndex,
    currentSong?.id,
    currentSong?.foh_mix_url,
    currentSong?.cue_mix_url,
    currentSong?.foh_mobile_url,
    currentSong?.cue_mobile_url,
    playbackMode,
    isProjectorWindow,
  ]);

  // Efecto no destructivo: notificar canción y estado activo a esclavos Wi-Fi sin interrumpir audio local
  useEffect(() => {
    if (isProjectorWindow || !broadcastEnabled || !currentSong) return;
    const snap = buildMasterSyncSnapshot();
    if (snap.isPlaying) {
      broadcast(snap);
    } else {
      broadcast({
        type: 'LOAD_SONG',
        setlistId: selectedSetlistId,
        songId: currentSong.id,
        songData: currentSong,
        nextSongData: getNextSongInSetlist(),
        offset: pauseTimeRef.current,
      });
    }
  }, [broadcastEnabled, currentSong?.id, selectedSetlistId, isProjectorWindow]);

  // Pulso periódico de fase (Heartbeat cada 3s) mientras reproduce con Wi-Fi activo para re-enganchar esclavos tardíos o con deriva
  useEffect(() => {
    if (isProjectorWindow || !broadcastEnabled || !isPlaying) return;
    const timer = window.setInterval(() => {
      if (!isPlayingRef.current || !broadcastEnabledRef.current || !audioCtxRef.current) return;
      const curSong = currentSongRef.current;
      if (!curSong) return;
      const curGlobalOffset = Math.max(0, audioCtxRef.current.currentTime - startTimeRef.current);
      const syncCompMs = Math.round(
        (hardwareLatencyMsRef.current || 0) + (multiChannelPatchRef.current.syncOffsetMs || 0)
      );
      broadcast({
        type: 'HEARTBEAT',
        setlistId: selectedSetlistIdRef.current,
        songId: curSong.id,
        songData: curSong,
        nextSongData: getNextSongInSetlist(),
        isPlaying: true,
        startAt: Date.now() + syncCompMs,
        offset: curGlobalOffset,
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [isPlaying, broadcastEnabled, isProjectorWindow, broadcast]);

  // Sincronizar DSP (EQ 18 Bandas, HPF, Limiter, Cue Tone) en vivo con cero clics
  useEffect(() => {
    if (isProjectorWindow) return;
    applyAllDspParams(activeEqProfile);
  }, [activeEqProfile, isProjectorWindow]);

  // Actualizar ganancias en tiempo real (Master, FOH Público y CUE Músicos)
  useEffect(() => {
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setTargetAtTime(masterVolume, audioCtxRef.current.currentTime, 0.03);
    }
  }, [masterVolume]);

  useEffect(() => {
    if (audioCtxRef.current) {
      const now = audioCtxRef.current.currentTime;
      if (fohGainRef.current) {
        fohGainRef.current.gain.setTargetAtTime(fohVolume, now, 0.03);
      }
      stemSourcesRef.current.forEach((entry) => {
        entry.gainNode.gain.setTargetAtTime(entry.baseVolume * fohVolume, now, 0.03);
      });
    }
  }, [fohVolume]);

  useEffect(() => {
    if (cueGainRef.current && audioCtxRef.current) {
      const effectiveCue = muteCueEmergency ? 0 : cueVolume;
      cueGainRef.current.gain.setTargetAtTime(effectiveCue, audioCtxRef.current.currentTime, 0.03);
    }
  }, [cueVolume, muteCueEmergency]);

  const headerFohMeterRef = useRef<HTMLDivElement | null>(null);
  const headerCueMeterRef = useRef<HTMLDivElement | null>(null);

  // Reconstruir matriz de ruteo en vivo al cambiar modo o parche multicanal
  useEffect(() => {
    if (isProjectorWindow) return;
    buildRoutingGraph();
  }, [routingMode, multiChannelPatch, hardwareMaxChannels, isProjectorWindow]);

  // Mini medidores VU de barra superior sin re-renders en React (0 setState en 60 FPS)
  useEffect(() => {
    if (isProjectorWindow || !isPlaying) {
      if (headerFohMeterRef.current) headerFohMeterRef.current.style.width = '0%';
      if (headerCueMeterRef.current) headerCueMeterRef.current.style.width = '0%';
      return;
    }
    let rafId = 0;
    let fohHold = 0;
    let cueHold = 0;
    const fohBuf = new Uint8Array(1024);
    const cueBuf = new Uint8Array(256);

    const tickHeaderMeters = () => {
      if (fohAnalyserRef.current && headerFohMeterRef.current) {
        fohAnalyserRef.current.getByteTimeDomainData(fohBuf);
        let peak = 0;
        for (let i = 0; i < fohBuf.length; i += 2) {
          const v = Math.abs((fohBuf[i] - 128) / 128);
          if (v > peak) peak = v;
        }
        fohHold = peak > fohHold ? peak : fohHold * 0.85 + peak * 0.15;
        headerFohMeterRef.current.style.width = `${Math.min(100, Math.round(fohHold * 100))}%`;
      }
      if (cueAnalyserRef.current && headerCueMeterRef.current) {
        cueAnalyserRef.current.getByteTimeDomainData(cueBuf);
        let peak = 0;
        for (let i = 0; i < cueBuf.length; i++) {
          const v = Math.abs((cueBuf[i] - 128) / 128);
          if (v > peak) peak = v;
        }
        cueHold = peak > cueHold ? peak : cueHold * 0.85 + peak * 0.15;
        headerCueMeterRef.current.style.width = `${Math.min(100, Math.round(cueHold * 100))}%`;
      }
      rafId = requestAnimationFrame(tickHeaderMeters);
    };

    rafId = requestAnimationFrame(tickHeaderMeters);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isProjectorWindow]);

  // Sincronizar con ventana de Proyector Externo HDMI usando reloj unificado de letras
  useEffect(() => {
    if (isProjectorWindow || !projectorChannelRef.current || !currentSong) return;
    const { lyricReferencePreRollSec } = resolveLyricsTimeMapping(currentSong);
    const syncedLyricTime = Math.max(0, currentTime + lyricReferencePreRollSec);
    const rawBeatTimes = Array.isArray(currentSong.prompter_data?.beatTimes)
      ? currentSong.prompter_data.beatTimes.map((t: number) => Number(t) + lyricReferencePreRollSec)
      : undefined;
    projectorChannelRef.current.postMessage({
      type: 'PROJECTOR_SYNC',
      payload: {
        currentTime: syncedLyricTime,
        isPlaying,
        title: currentSong.title,
        lyrics: currentSong.prompter_data?.lyrics || [],
        settings: currentSong.prompter_data?.lyric_settings,
        bpm: currentSong.prompter_data?.bpm || 120,
        firstBeatOffset: (Number(currentSong.prompter_data?.firstBeatOffset) || 0) + lyricReferencePreRollSec,
        beatTimes: rawBeatTimes,
        background: currentSong.prompter_data?.background,
      },
    });
  }, [currentTime, audioTime, isPlaying, currentSong, isProjectorWindow]);

  const openExternalProjector = () => {
    window.open(
      `${window.location.pathname}?projector=1`,
      'TanduStageProjector',
      'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no'
    );
  };

  const fetchSetlists = async () => {
    const { data } = await supabase.from('setlists').select('*').eq('band_id', FAKE_BAND_ID).order('created_at', { ascending: false });
    if (data) {
      setSetlists(data);
      const savedId = sessionStorage.getItem('tandu_active_setlist_id');
      if (savedId && data.some((s: any) => s.id === savedId)) {
        setSelectedSetlistId(savedId);
      } else if (!selectedSetlistId && data.length > 0) {
        setSelectedSetlistId(data[0].id);
      }
    }
  };

  const fetchSetlistSongs = async (
    setId: string,
    options?: { preserveCurrentSong?: boolean }
  ): Promise<any[]> => {
    const [res, vaultSum] = await Promise.all([
      supabase
        .from('setlist_songs')
        .select(`
          position,
          song:songs (id, title, foh_mix_url, cue_mix_url, foh_mobile_url, cue_mobile_url, prompter_data)
        `)
        .eq('setlist_id', setId)
        .order('position', { ascending: true }),
      readLocalVaultSummary().catch(() => null),
    ]);

    if (vaultSum) {
      setPcVaultTracksBySongId(vaultSum.tracksBySongId);
    }

    if (res.error) {
      console.error(res.error);
      return [];
    }

    const mapped = (res.data || [])
      .filter((item) => Boolean(item.song))
      .map((item) => ({
        position: item.position,
        ...(item.song as any),
      }));

    const prevActiveId = currentSongRef.current?.id;
    setSongs(mapped);

    if (options?.preserveCurrentSong && prevActiveId) {
      const keptIdx = mapped.findIndex((s) => s.id === prevActiveId);
      setCurrentSongIndex(keptIdx >= 0 ? keptIdx : 0);
    } else {
      setCurrentSongIndex(0);
    }
    return mapped;
  };

  // Actualizar Setlist completo desde Supabase (detecta cambios hechos en Stem Studio / Studio Prompter / Setlist Builder)
  const handleRefreshSetlistFromStudio = async () => {
    if (isRefreshingSong) return;
    setIsRefreshingSong(true);
    try {
      await fetchSetlists();
      if (selectedSetlistId) {
        const prevSongSnap = currentSongRef.current;
        const updatedList = await fetchSetlistSongs(selectedSetlistId, {
          preserveCurrentSong: true,
        });
        prefetchedSongRef.current = null;
        pcRamAudioCacheRef.current.clear();

        const nextActive =
          updatedList.find((s) => s.id === prevSongSnap?.id) ||
          updatedList[0] ||
          null;

        if (nextActive && !isPlayingRef.current) {
          await loadSongAudio(nextActive, false);
        }
        setSyncFeedback('¡Setlist actualizado con los cambios de Studio!');
        setTimeout(() => setSyncFeedback(null), 2800);
      }
    } catch (err) {
      console.warn('[LiveConcert] Error actualizando setlist:', err);
    } finally {
      setIsRefreshingSong(false);
    }
  };

  // Descargar en la memoria local de la PC (MP3) solo las canciones del Setlist que aún falten
  const handleDownloadPendingSetlistToPc = useCallback(
    async (targetSongs?: any[], silent = false) => {
      const list = (targetSongs || songsRef.current || []) as PracticeSongItem[];
      if (list.length === 0 || isDownloadingSetlistToPc) return;

      const readiness = evaluateInEarPlaylistReadiness(
        list,
        pcVaultTracksBySongIdRef.current
      );
      if (readiness.pendingSongs.length === 0) {
        if (!silent) {
          setSyncFeedback('¡Todas las canciones del Setlist ya están en la memoria del PC!');
          setTimeout(() => setSyncFeedback(null), 2500);
        }
        return;
      }

      setIsDownloadingSetlistToPc(true);
      try {
        const res = await downloadInEarPlaylistToLocalVault({
          songs: list,
          tracksBySongId: pcVaultTracksBySongIdRef.current,
          onSongProgress: ({ currentIndex, totalToDownload, songTitle }) => {
            setPcDownloadProgressMsg(
              `Guardando en PC (${currentIndex}/${totalToDownload}): ${songTitle}`
            );
          },
        });
        setPcVaultTracksBySongId(res.summary.tracksBySongId);
        if (!silent && res.downloadedCount > 0) {
          setSyncFeedback(
            `¡${res.downloadedCount} ${
              res.downloadedCount === 1 ? 'canción guardada' : 'canciones guardadas'
            } en la memoria local del PC!`
          );
          setTimeout(() => setSyncFeedback(null), 2800);
        }
      } catch (err) {
        console.warn('[LiveConcert] Error guardando setlist en memoria local PC:', err);
      } finally {
        setIsDownloadingSetlistToPc(false);
        setPcDownloadProgressMsg('');
      }
    },
    [isDownloadingSetlistToPc]
  );

  // Forzar re-descarga desde la nube (Volver a Descargar) de todo el Setlist o de una canción individual
  const handleForceRedownloadSetlistToPc = async () => {
    const list = (songsRef.current || []) as PracticeSongItem[];
    if (list.length === 0 || isDownloadingSetlistToPc) return;

    setIsDownloadingSetlistToPc(true);
    try {
      prefetchedSongRef.current = null;
      pcRamAudioCacheRef.current.clear();

      const exportable = list.filter(
        (s) =>
          Boolean(
            s.foh_mobile_url || s.foh_mix_url || s.cue_mobile_url || s.cue_mix_url
          )
      );

      for (let i = 0; i < exportable.length; i++) {
        const s = exportable[i];
        setPcDownloadProgressMsg(
          `Re-descargando (${i + 1}/${exportable.length}): ${s.title}...`
        );
        const meta = await ensureSongMp3CachedInDevice({
          song: s,
          includeCue: true,
          forceRefresh: true,
        });
        setPcVaultTracksBySongId((prev) => ({ ...prev, [s.id]: meta }));
      }

      const freshSummary = await readLocalVaultSummary();
      setPcVaultTracksBySongId(freshSummary.tracksBySongId);

      if (currentSongRef.current && !isPlayingRef.current) {
        await loadSongAudio(currentSongRef.current, false);
      }
      setSyncFeedback('¡Setlist re-descargado y actualizado en la memoria del PC!');
      setTimeout(() => setSyncFeedback(null), 2800);
    } catch (err: any) {
      console.warn('[LiveConcert] Error re-descargando setlist:', err);
    } finally {
      setIsDownloadingSetlistToPc(false);
      setPcDownloadProgressMsg('');
    }
  };

  const handleRedownloadSingleSongToPc = async (
    song: any,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    if (!song?.id || redownloadingSongId) return;

    setRedownloadingSongId(song.id);
    try {
      // Consultar versión más reciente de la canción en Supabase antes de re-descargar el audio
      const { data: freshRow } = await supabase
        .from('songs')
        .select('id, title, foh_mix_url, cue_mix_url, foh_mobile_url, cue_mobile_url, prompter_data')
        .eq('id', song.id)
        .single();

      const targetSong = freshRow ? { ...song, ...freshRow } : song;
      if (freshRow) {
        setSongs((prev) =>
          prev.map((s) => (s.id === song.id ? targetSong : s))
        );
      }

      // Invalidar entradas en RAM para esta canción
      for (const key of Array.from(pcRamAudioCacheRef.current.keys())) {
        if (key.startsWith(`${song.id}|`)) {
          pcRamAudioCacheRef.current.delete(key);
        }
      }
      if (prefetchedSongRef.current?.songId === song.id) {
        prefetchedSongRef.current = null;
      }

      const meta = await ensureSongMp3CachedInDevice({
        song: targetSong,
        includeCue: true,
        forceRefresh: true,
      });
      setPcVaultTracksBySongId((prev) => ({ ...prev, [song.id]: meta }));

      if (currentSongRef.current?.id === song.id && !isPlayingRef.current) {
        await loadSongAudio(targetSong, false);
      }
      setSyncFeedback(`¡"${targetSong.title}" re-descargada en la memoria del PC!`);
      setTimeout(() => setSyncFeedback(null), 2500);
    } catch (err) {
      console.warn('[LiveConcert] Error re-descargando canción:', err);
    } finally {
      setRedownloadingSongId(null);
    }
  };

  const refreshSongData = async (targetSongId?: string, silent = false) => {
    const songId = targetSongId || currentSong?.id;
    if (!songId) return;

    if (!silent) setIsRefreshingSong(true);
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('id, title, foh_mix_url, cue_mix_url, foh_mobile_url, cue_mobile_url, prompter_data')
        .eq('id', songId)
        .single();

      if (error) throw error;
      if (data) {
        const prevMatch = songsRef.current.find((s) => s.id === songId) || (currentSongRef.current?.id === songId ? currentSongRef.current : null);
        const mergedUpdatedSong = prevMatch ? { ...prevMatch, ...data } : data;
        setSongs((prevSongs) =>
          prevSongs.map((s) => (s.id === songId ? { ...s, ...data } : s))
        );
        if (mergedUpdatedSong && currentSongRef.current?.id === songId) {
          const urlsChanged =
            mergedUpdatedSong.foh_mix_url !== prevMatch?.foh_mix_url ||
            mergedUpdatedSong.cue_mix_url !== prevMatch?.cue_mix_url ||
            mergedUpdatedSong.foh_mobile_url !== prevMatch?.foh_mobile_url ||
            mergedUpdatedSong.cue_mobile_url !== prevMatch?.cue_mobile_url;
          if (!urlsChanged) {
            void refreshActiveCueInRam(mergedUpdatedSong);
          }
        }
        setSyncFeedback('¡Letras sincronizadas!');
        setTimeout(() => setSyncFeedback(null), 2500);
      }
    } catch (err: any) {
      console.warn('[LiveConcert] Error refreshing song data:', err);
    } finally {
      if (!silent) setIsRefreshingSong(false);
    }
  };

  // Escucha instantánea de cambios guardados en Lyric Studio / Studio Prompter (Cero Latencia <1ms en la misma máquina)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('tandu_stage_sync');
    bc.onmessage = (event) => {
      const msgType = event.data?.type;
      const incomingData = event.data?.prompter_data || event.data?.prompterData;
      if (
        (msgType === 'SONG_LYRICS_UPDATED' ||
          msgType === 'PROMPTER_UPDATED' ||
          msgType === 'LIVE_MIX_EXPORTED') &&
        event.data.songId &&
        incomingData
      ) {
        const { songId } = event.data;
        if (msgType === 'LIVE_MIX_EXPORTED' || msgType === 'PROMPTER_UPDATED') {
          invalidateSongInModuleRamCache(songId);
          if (prefetchedSongRef.current?.songId === songId) {
            prefetchedSongRef.current = null;
          }
        }
        const prevMatch = songsRef.current.find((s) => s.id === songId) || (currentSongRef.current?.id === songId ? currentSongRef.current : null);
        const updatedSongForCue = prevMatch
          ? {
              ...prevMatch,
              prompter_data: incomingData || prevMatch.prompter_data,
              ...(event.data.foh_mix_url ? { foh_mix_url: event.data.foh_mix_url } : {}),
              ...(event.data.cue_mix_url ? { cue_mix_url: event.data.cue_mix_url } : {}),
              ...(event.data.foh_mobile_url ? { foh_mobile_url: event.data.foh_mobile_url } : {}),
              ...(event.data.cue_mobile_url ? { cue_mobile_url: event.data.cue_mobile_url } : {}),
            }
          : null;
        setSongs((prevSongs) =>
          prevSongs.map((s) =>
            s.id === songId
              ? {
                  ...s,
                  prompter_data: incomingData || s.prompter_data,
                  ...(event.data.foh_mix_url ? { foh_mix_url: event.data.foh_mix_url } : {}),
                  ...(event.data.cue_mix_url ? { cue_mix_url: event.data.cue_mix_url } : {}),
                  ...(event.data.foh_mobile_url ? { foh_mobile_url: event.data.foh_mobile_url } : {}),
                  ...(event.data.cue_mobile_url ? { cue_mobile_url: event.data.cue_mobile_url } : {}),
                }
              : s
          )
        );
        if (msgType === 'PROMPTER_UPDATED' && updatedSongForCue && currentSongRef.current?.id === songId) {
          void refreshActiveCueInRam(updatedSongForCue);
        }
        setSyncFeedback(
          msgType === 'LIVE_MIX_EXPORTED'
            ? '¡Mix En Vivo actualizado desde Studio!'
            : msgType === 'PROMPTER_UPDATED'
            ? '¡Prompter actualizado desde Studio!'
            : '¡Letras actualizadas en vivo!'
        );
        setTimeout(() => setSyncFeedback(null), 2500);
      }
    };

    return () => {
      bc.close();
    };
  }, []);

  // Supabase Realtime channel para sincronización entre diferentes computadoras/músicos
  useEffect(() => {
    if (isProjectorWindow) return;
    const channel = supabase
      .channel('live_concert_songs_sync')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'songs' },
        (payload) => {
          if (payload.new && payload.new.id) {
            const updated = payload.new as any;
            if (prefetchedSongRef.current?.songId === updated.id) {
              prefetchedSongRef.current = null;
            }
            const prevMatch = songsRef.current.find((s) => s.id === updated.id) || (currentSongRef.current?.id === updated.id ? currentSongRef.current : null);
            const updatedSongForCue = prevMatch
              ? {
                  ...prevMatch,
                  prompter_data: updated.prompter_data || prevMatch.prompter_data,
                  title: updated.title || prevMatch.title,
                  ...(updated.foh_mix_url ? { foh_mix_url: updated.foh_mix_url } : {}),
                  ...(updated.cue_mix_url ? { cue_mix_url: updated.cue_mix_url } : {}),
                  ...(updated.foh_mobile_url ? { foh_mobile_url: updated.foh_mobile_url } : {}),
                  ...(updated.cue_mobile_url ? { cue_mobile_url: updated.cue_mobile_url } : {}),
                }
              : null;
            setSongs((prevSongs) =>
              prevSongs.map((s) =>
                s.id === updated.id
                  ? {
                      ...s,
                      prompter_data: updated.prompter_data || s.prompter_data,
                      title: updated.title || s.title,
                      ...(updated.foh_mix_url ? { foh_mix_url: updated.foh_mix_url } : {}),
                      ...(updated.cue_mix_url ? { cue_mix_url: updated.cue_mix_url } : {}),
                      ...(updated.foh_mobile_url ? { foh_mobile_url: updated.foh_mobile_url } : {}),
                      ...(updated.cue_mobile_url ? { cue_mobile_url: updated.cue_mobile_url } : {}),
                    }
                  : s
              )
            );
            if (updatedSongForCue && currentSongRef.current?.id === updated.id) {
              const urlsChanged =
                updatedSongForCue.foh_mix_url !== prevMatch?.foh_mix_url ||
                updatedSongForCue.cue_mix_url !== prevMatch?.cue_mix_url ||
                updatedSongForCue.foh_mobile_url !== prevMatch?.foh_mobile_url ||
                updatedSongForCue.cue_mobile_url !== prevMatch?.cue_mobile_url;
              if (!urlsChanged) {
                void refreshActiveCueInRam(updatedSongForCue);
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isProjectorWindow]);

  // Revalidar canción al regresar el foco a la ventana de Live Concert
  useEffect(() => {
    if (isProjectorWindow) return;
    const onFocus = () => {
      if (currentSong?.id) {
        refreshSongData(currentSong.id, true);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [currentSong?.id, isProjectorWindow]);

  const loadSongStemsForMultitrack = async (songId: string): Promise<DecodedStemBuffer[]> => {
    if (!audioCtxRef.current || !songId) return [];

    const cached = stemCacheRef.current.get(songId);
    if (cached) {
      if (currentSongRef.current?.id === songId) {
        activeStemsRef.current = cached;
        setLoadedStemsSummary(
          cached.map((st) => ({ id: st.id, name: st.name, group: st.group, volume: st.volume }))
        );
      }
      return cached;
    }

    const inflight = stemInflightPromisesRef.current.get(songId);
    if (inflight) {
      return inflight;
    }

    const promise = (async () => {
      setIsLoadingStems(true);
      try {
        const { data: rows, error } = await supabase
          .from('stems')
          .select('*')
          .eq('song_id', songId)
          .order('name');

        if (error || !rows || rows.length === 0) {
          if (currentSongRef.current?.id === songId) {
            activeStemsRef.current = [];
            setLoadedStemsSummary([]);
          }
          return [];
        }

        const hasSeparated = rows.length > 1 && rows.some((r: any) => !r.metadata?.is_master);
        const candidateRows = rows.filter((r: any) => {
          const lower = (r.name || '').toLowerCase();
          const isClickOrCue =
            lower.includes('click') || lower.includes('metronomo') || lower.includes('cue') || lower.includes('guia');
          if (isClickOrCue) return false;
          if (hasSeparated && r.metadata?.is_master) return false;
          return Boolean(r.file_url);
        });
        const hasAnySolo = candidateRows.some((r: any) => r.metadata?.solo === true);
        const activeRows = candidateRows.filter((r: any) => {
          if (r.metadata?.muted === true) return false;
          if (hasAnySolo && r.metadata?.solo !== true) return false;
          return true;
        });

        const decodedList: DecodedStemBuffer[] = [];
        await Promise.all(
          activeRows.map(async (row: any) => {
            try {
              const res = await fetch(row.file_url);
              if (!res.ok) return;
              const arr = await res.arrayBuffer();
              if (!audioCtxRef.current) return;
              const buf = await audioCtxRef.current.decodeAudioData(arr);
              const cat = detectInstrumentCategory(row.name || '', row.metadata?.instrument_icon);
              const group = mapInstrumentCategoryToBusGroup(cat);
              decodedList.push({
                id: row.id,
                name: row.name,
                category: cat,
                group,
                volume: row.metadata?.volume !== undefined ? Number(row.metadata.volume) : 0.8,
                pan: row.metadata?.pan !== undefined ? Number(row.metadata.pan) : 0,
                buffer: buf,
              });
            } catch (err) {
              console.warn('[LiveConcert] Stem decode skipped:', row.name, err);
            }
          })
        );

        if (stemCacheRef.current.size >= 2) {
          const oldestKey = stemCacheRef.current.keys().next().value;
          if (oldestKey) stemCacheRef.current.delete(oldestKey);
        }
        stemCacheRef.current.set(songId, decodedList);
        if (currentSongRef.current?.id === songId) {
          activeStemsRef.current = decodedList;
          setLoadedStemsSummary(
            decodedList.map((st) => ({ id: st.id, name: st.name, group: st.group, volume: st.volume }))
          );
        }
        return decodedList;
      } catch (err) {
        console.warn('[LiveConcert] Error cargando stems multitrack:', err);
        if (currentSongRef.current?.id === songId) {
          activeStemsRef.current = [];
          setLoadedStemsSummary([]);
        }
        return [];
      } finally {
        stemInflightPromisesRef.current.delete(songId);
        setIsLoadingStems(false);
      }
    })();

    stemInflightPromisesRef.current.set(songId, promise);
    return promise;
  };

  // Cargar stems automáticamente cuando el usuario activa Modo Multitrack Stems Separados
  useEffect(() => {
    if (isProjectorWindow || !currentSong?.id) return;
    if (routingMode === 'MultiChannel' && multiChannelPatch.consoleBusMode === 'multitrack_stems') {
      loadSongStemsForMultitrack(currentSong.id).then(() => {
        if (isPlayingRef.current) {
          pause(true);
          setTimeout(() => playRef.current(), 35);
        } else {
          buildRoutingGraph();
        }
      });
    } else if (isPlayingRef.current && stemSourcesRef.current.length > 0) {
      // Volvió de Multitrack Stems a Bus FOH mientras sonaba
      pause(true);
      setTimeout(() => playRef.current(), 35);
    }
  }, [multiChannelPatch.consoleBusMode, routingMode, currentSong?.id, isProjectorWindow]);

  const getPreRoll = (song: any) => {
    const s = song || currentSongRef.current || currentSong;
    return resolveEffectivePreRoll(s);
  };

  const getInitialPositionsForSong = (song: any) => {
    const preRoll = getPreRoll(song);
    if (skipPreRollRef.current && preRoll > 0) {
      return { globalOffset: preRoll, visualTime: 0 };
    }
    return { globalOffset: 0, visualTime: -preRoll };
  };

  const handleToggleSkipPreRoll = () => {
    (document.activeElement as HTMLElement)?.blur();
    setSkipPreRoll((prev) => {
      const next = !prev;
      skipPreRollRef.current = next;
      const curSong = currentSongRef.current;
      if (curSong && !isPlayingRef.current) {
        const preRoll = getPreRoll(curSong);
        // Si estamos en reposo al inicio de la canción (en zona pre-roll o en 0), reposicionar de inmediato
        if (pauseTimeRef.current <= preRoll + 0.05) {
          const nextGlobal = next ? preRoll : 0;
          const nextVisual = next ? 0 : -preRoll;
          pauseTimeRef.current = nextGlobal;
          setCurrentTime(nextVisual);
          setAudioTime(nextGlobal);
        }
      }
      return next;
    });
  };

  const getPcRamCacheKey = (song: any): string => {
    const fohSig = computeSongChannelSignature(song as PracticeSongItem, 'foh');
    const cueSig = computeSongChannelSignature(song as PracticeSongItem, 'cue');
    return `${song?.id || ''}|${getSongCueSignature(song)}|${fohSig}|${cueSig}`;
  };

  const storeInPcRamCache = (
    key: string,
    entry: PcRamCachedSongEntry
  ) => {
    if (!key) return;
    if (pcRamAudioCacheRef.current.size >= 16 && !pcRamAudioCacheRef.current.has(key)) {
      const oldestKey = pcRamAudioCacheRef.current.keys().next().value;
      if (oldestKey) {
        pcRamAudioCacheRef.current.delete(oldestKey);
      }
    }
    pcRamAudioCacheRef.current.set(key, entry);
  };

  /**
   * Motor unificado Local-First para LiveConcert (aplica tanto en CONSOLA VIVO como en MODO PRÁCTICA):
   * 1. Revisa Caché RAM persistente a nivel de módulo (`MODULE_PC_RAM_AUDIO_CACHE`) -> 0.0 ms, sin pantalla de carga al cambiar de módulo.
   * 2. Revisa la Memoria Local Persistente de la PC (IndexedDB `readLocalTrackMeta` + `readDecryptedTrackArrayBuffer`) -> lee desde el disco del PC con 0 bytes de internet.
   * 3. SOLO si la canción no está aún guardada en la PC (o fue re-exportada en Studio), la descarga UNA vez y la guarda permanentemente en el PC.
   */
  const resolveAndDecodeSongBuffers = async (
    song: any,
    _mode: 'LIVE' | 'REHEARSAL',
    signal?: AbortSignal,
    onStatus?: (msg: string) => void
  ): Promise<PcRamCachedSongEntry | null> => {
    const ctx = audioCtxRef.current;
    if (!ctx || !song?.id) return null;

    const ramKey = getPcRamCacheKey(song);
    const ramCached = pcRamAudioCacheRef.current.get(ramKey);
    if (ramCached) {
      return ramCached;
    }

    const cueSrc = resolvePreferredMp3Source(song as PracticeSongItem, 'cue');
    const wantsRamCue = !cueSrc.url || shouldSynthesizeLiveCueInRam(song);

    // Consultar directamente el índice de IndexedDB (evita condiciones de carrera al montar el componente)
    const storedMeta =
      (await readLocalTrackMeta(song.id)) ||
      pcVaultTracksBySongIdRef.current[song.id];
    const ev = evaluateSongVaultState(song as PracticeSongItem, storedMeta);

    let fohBytes = await readDecryptedTrackArrayBuffer(song.id, 'foh');
    let cueBytes = !wantsRamCue
      ? await readDecryptedTrackArrayBuffer(song.id, 'cue')
      : null;

    const needsVaultDownload =
      !fohBytes ||
      ev.status === 'update_available' ||
      (!wantsRamCue && (!cueBytes || ev.cueNeedsDownload));

    if (needsVaultDownload) {
      onStatus?.(
        `Descargando "${song.title}" y guardando en Memoria Local del PC...`
      );
      const [updatedMeta] = await Promise.all([
        ensureSongMp3CachedInDevice({
          song: song as PracticeSongItem,
          includeCue: true,
          signal,
          onProgress: (msg) => {
            if (msg) onStatus?.(msg);
          },
        }),
        wantsRamCue ? ensureLiveCueBuffersLoaded(ctx) : Promise.resolve(0),
      ]);
      if (signal?.aborted) return null;
      setPcVaultTracksBySongId((prev) => ({
        ...prev,
        [song.id]: updatedMeta,
      }));
      fohBytes = await readDecryptedTrackArrayBuffer(song.id, 'foh');
      if (!wantsRamCue) {
        cueBytes = await readDecryptedTrackArrayBuffer(song.id, 'cue');
      }
    } else {
      onStatus?.('Preparando pista desde Memoria Local del PC (Sin Internet)...');
      if (wantsRamCue) {
        await ensureLiveCueBuffersLoaded(ctx);
      }
    }

    if (signal?.aborted || !audioCtxRef.current || !fohBytes) return null;

    const decodedFoh = await ctx.decodeAudioData(fohBytes.slice(0));
    wipeAudioArrayBufferInRam(fohBytes);
    if (signal?.aborted || !audioCtxRef.current) return null;

    let resolvedCue: { buffer: AudioBuffer; source: 'mix' | 'ram' } | null =
      null;

    if (wantsRamCue) {
      resolvedCue = await resolveCueBufferForSong(song, decodedFoh, null, true);
    }

    if (!resolvedCue) {
      if (!cueBytes) {
        cueBytes = await readDecryptedTrackArrayBuffer(song.id, 'cue');
      }
      if (!cueBytes && cueSrc.url) {
        const updatedMeta = await ensureSongMp3CachedInDevice({
          song: song as PracticeSongItem,
          includeCue: true,
          signal,
        });
        setPcVaultTracksBySongId((prev) => ({
          ...prev,
          [song.id]: updatedMeta,
        }));
        cueBytes = await readDecryptedTrackArrayBuffer(song.id, 'cue');
      }
      if (cueBytes && audioCtxRef.current) {
        const decodedCue = await ctx.decodeAudioData(cueBytes.slice(0));
        wipeAudioArrayBufferInRam(cueBytes);
        resolvedCue = await resolveCueBufferForSong(
          song,
          decodedFoh,
          decodedCue,
          false
        );
      }
    } else {
      wipeAudioArrayBufferInRam(cueBytes);
    }

    if (!resolvedCue) {
      throw new Error('No se pudo preparar el canal CUE de músicos.');
    }

    const result: PcRamCachedSongEntry = {
      fohBuffer: decodedFoh,
      cueBuffer: resolvedCue.buffer,
      cueSource: resolvedCue.source,
    };
    storeInPcRamCache(ramKey, result);
    return result;
  };

  const loadSongAudio = async (song: any, shouldAutoPlay = false) => {
    if (!audioCtxRef.current) return;

    const reqId = ++loadRequestIdRef.current;
    loadAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    loadAbortControllerRef.current = abortController;

    pause(true);
    const { globalOffset: initGlobal, visualTime: initVisual } =
      getInitialPositionsForSong(song);
    setCurrentTime(initVisual);
    setAudioTime(initGlobal);
    pauseTimeRef.current = initGlobal;
    activeStemsRef.current = [];
    setLoadedStemsSummary([]);

    const mode = playbackModeRef.current;
    const targetFohUrl =
      mode === 'REHEARSAL' && song.foh_mobile_url
        ? song.foh_mobile_url
        : song.foh_mix_url;
    const targetCueUrl =
      mode === 'REHEARSAL' && song.cue_mobile_url
        ? song.cue_mobile_url
        : song.cue_mix_url;
    const songCueSig = getSongCueSignature(song);
    const fullCueSig = `${song.id}|${songCueSig}`;
    const ramKey = getPcRamCacheKey(song);

    // 1. Verificar Caché RAM o Prefetch de la siguiente canción (Transición en 0ms sin red ni espera)
    const ramCached = pcRamAudioCacheRef.current.get(ramKey);
    const prefetched = prefetchedSongRef.current;
    const matchedPrefetch =
      prefetched &&
      prefetched.songId === song.id &&
      prefetched.playbackMode === mode &&
      prefetched.fohUrl === targetFohUrl &&
      prefetched.cueUrl === (targetCueUrl || '') &&
      prefetched.cueSignature === songCueSig
        ? prefetched
        : null;

    const instantHit =
      ramCached ||
      (matchedPrefetch
        ? {
            fohBuffer: matchedPrefetch.fohBuffer,
            cueBuffer: matchedPrefetch.cueBuffer,
            cueSource: matchedPrefetch.cueSource,
          }
        : null);

    if (instantHit) {
      if (matchedPrefetch) {
        storeInPcRamCache(ramKey, instantHit);
        prefetchedSongRef.current = null;
      }
      fohBufferRef.current = instantHit.fohBuffer;
      cueBufferRef.current = instantHit.cueBuffer;
      activeCueSignatureRef.current = fullCueSig;
      setLiveCueSource(instantHit.cueSource);
      const dur = instantHit.fohBuffer.duration;
      totalDurationRef.current = dur;
      setTotalDuration(dur);
      setLoadStatus('');

      const nextInSetlist = getNextSongInSetlist();
      if (broadcastEnabledRef.current) {
        broadcast({
          type: 'LOAD_SONG',
          setlistId: selectedSetlistIdRef.current,
          songId: song.id,
          songData: song,
          nextSongData: nextInSetlist,
          offset: initGlobal,
        });
      }

      if (
        routingModeRef.current === 'MultiChannel' &&
        multiChannelPatchRef.current.consoleBusMode === 'multitrack_stems'
      ) {
        await loadSongStemsForMultitrack(song.id);
        if (loadRequestIdRef.current !== reqId) return;
      }

      if (nextInSetlist) {
        void prefetchNextSong(nextInSetlist);
      }

      if (shouldAutoPlay) {
        setTimeout(() => {
          if (loadRequestIdRef.current === reqId) playRef.current();
        }, 20);
      }
      return;
    }

    if (
      prefetched &&
      (prefetched.songId === song.id || prefetched.playbackMode !== mode)
    ) {
      prefetchedSongRef.current = null;
    }

    fohBufferRef.current = null;
    cueBufferRef.current = null;
    activeCueSignatureRef.current = '';
    setLiveCueSource('mix');
    totalDurationRef.current = 0;
    setTotalDuration(0);

    const canSynthesizeRamCue = Number(song?.prompter_data?.bpm) > 0;
    if (!targetFohUrl || (!targetCueUrl && !canSynthesizeRamCue)) {
      setIsLoading(false);
      setLoadStatus(
        'Falta exportar el Mix En Vivo de esta canción en Studio Prompter.'
      );
      return;
    }

    setIsLoading(true);
    setLoadStatus('Preparando pista desde Memoria Local del PC...');

    try {
      const resolved = await resolveAndDecodeSongBuffers(
        song,
        mode,
        abortController.signal,
        (msg) => {
          if (loadRequestIdRef.current === reqId) setLoadStatus(msg);
        }
      );
      if (loadRequestIdRef.current !== reqId || !resolved) return;

      fohBufferRef.current = resolved.fohBuffer;
      cueBufferRef.current = resolved.cueBuffer;
      activeCueSignatureRef.current = fullCueSig;
      setLiveCueSource(resolved.cueSource);
      totalDurationRef.current = resolved.fohBuffer.duration;
      setTotalDuration(resolved.fohBuffer.duration);

      if (
        routingModeRef.current === 'MultiChannel' &&
        multiChannelPatchRef.current.consoleBusMode === 'multitrack_stems'
      ) {
        setLoadStatus('Cargando stems discretos multicanal para consola...');
        await loadSongStemsForMultitrack(song.id);
        if (loadRequestIdRef.current !== reqId) return;
      }

      setLoadStatus('');

      const nextInSetlist = getNextSongInSetlist();
      if (broadcastEnabledRef.current) {
        broadcast({
          type: 'LOAD_SONG',
          setlistId: selectedSetlistIdRef.current,
          songId: song.id,
          songData: song,
          nextSongData: nextInSetlist,
          offset: initGlobal,
        });
      }

      // Pre-decodificar inmediatamente la siguiente canción en RAM (PC + Celulares In-Ear) sin esperar a los últimos 30s
      if (nextInSetlist) {
        void prefetchNextSong(nextInSetlist);
      }

      // Guardar silenciosamente en la memoria local del PC cualquier canción pendiente del Setlist (tanto en LIVE como en REHEARSAL)
      window.setTimeout(() => {
        void handleDownloadPendingSetlistToPc(songsRef.current, true);
      }, 450);

      if (shouldAutoPlay) {
        setTimeout(() => {
          if (loadRequestIdRef.current === reqId) playRef.current();
        }, 25);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || loadRequestIdRef.current !== reqId) return;
      console.error(e);
      setLoadStatus('Error al cargar audio: ' + e.message);
    } finally {
      if (loadRequestIdRef.current === reqId) {
        setIsLoading(false);
      }
    }
  };

  const prefetchNextSong = async (nextSong: any) => {
    if (!audioCtxRef.current || isPrefetchingRef.current || !nextSong?.id)
      return;
    const mode = playbackModeRef.current;
    const targetFohUrl =
      mode === 'REHEARSAL' && nextSong.foh_mobile_url
        ? nextSong.foh_mobile_url
        : nextSong.foh_mix_url;
    const targetCueUrl =
      mode === 'REHEARSAL' && nextSong.cue_mobile_url
        ? nextSong.cue_mobile_url
        : nextSong.cue_mix_url;
    const canSynthesizeRamCue = Number(nextSong?.prompter_data?.bpm) > 0;

    if (!targetFohUrl || (!targetCueUrl && !canSynthesizeRamCue)) return;

    const cueSignature = getSongCueSignature(nextSong);

    // Notificar a los celulares In-Ear para que también pre-decodifiquen la siguiente canción en RAM
    if (broadcastEnabledRef.current) {
      broadcast({
        type: 'PREFETCH_SONG',
        setlistId: selectedSetlistIdRef.current,
        songId: nextSong.id,
        nextSongData: nextSong,
      });
    }

    isPrefetchingRef.current = true;
    try {
      const resolved = await resolveAndDecodeSongBuffers(nextSong, mode);
      if (!resolved || playbackModeRef.current !== mode) return;
      prefetchedSongRef.current = {
        songId: nextSong.id,
        playbackMode: mode,
        fohUrl: targetFohUrl,
        cueUrl: targetCueUrl || '',
        cueSignature,
        cueSource: resolved.cueSource,
        fohBuffer: resolved.fohBuffer,
        cueBuffer: resolved.cueBuffer,
      };
    } catch {
      prefetchedSongRef.current = null;
    } finally {
      isPrefetchingRef.current = false;
    }
  };

  const isUsingMultitrackStems = (): boolean => {
    const ctx = audioCtxRef.current;
    if (!ctx) return false;
    const maxCh = ctx.destination.maxChannelCount || 2;
    return (
      routingModeRef.current === 'MultiChannel' &&
      maxCh >= 4 &&
      multiChannelPatchRef.current.consoleBusMode === 'multitrack_stems' &&
      activeStemsRef.current.length > 0
    );
  };

  const buildRoutingGraph = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    ensureDspGraph();
    applyAllDspParams(activeEqProfileRef.current);

    // Desconectar únicamente la cola de ruteo (sin cortar sources activos -> cambio de ruteo sin glitch)
    try { fohAnalyserRef.current?.disconnect(); } catch {}
    try { cueAnalyserRef.current?.disconnect(); } catch {}
    try { fohPannerRef.current?.disconnect(); } catch {}
    try { cuePannerRef.current?.disconnect(); } catch {}
    try { fohSplitterRef.current?.disconnect(); } catch {}
    try { cueSplitterRef.current?.disconnect(); } catch {}
    try { cueMonoSumGainRef.current?.disconnect(); } catch {}
    try { mergerRef.current?.disconnect(); } catch {}
    try { masterGainRef.current?.disconnect(); } catch {}

    stemSourcesRef.current.forEach((st) => {
      try { st.pannerNode.disconnect(); } catch {}
    });
    stemTailNodesRef.current.forEach((n) => {
      try { n.disconnect(); } catch {}
    });
    stemTailNodesRef.current = [];
    stemBusDspChainsRef.current = [];

    const maxChannels = ctx.destination.maxChannelCount || 2;
    setHardwareMaxChannels(maxChannels);

    const reqRoutingMode = routingModeRef.current;
    const patch = multiChannelPatchRef.current;
    // PROTECCIÓN CRÍTICA DE ESCENARIO: Si el hardware tiene <4 canales, jamás caer a StereoInEar (filtraría Click al público) -> usar StereoSplit (L=CUE, R=FOH)
    let actualRoutingMode: 'StereoInEar' | 'StereoSplit' | 'MultiChannel' = reqRoutingMode;
    if (reqRoutingMode === 'MultiChannel' && maxChannels < 4) {
      actualRoutingMode = 'StereoSplit';
    }

    if (actualRoutingMode === 'MultiChannel') {
      const targetChannels = computeRequiredMergerChannels(
        patch,
        maxChannels,
        activeStemsRef.current
      );

      try {
        ctx.destination.channelInterpretation = 'discrete';
        ctx.destination.channelCountMode = 'explicit';
        ctx.destination.channelCount = targetChannels;
      } catch (err) {
        console.warn('[LiveConcert] Error configurando destino multicanal discreto:', err);
      }

      if (masterGainRef.current) {
        masterGainRef.current.channelCount = targetChannels;
        masterGainRef.current.channelCountMode = 'explicit';
        masterGainRef.current.channelInterpretation = 'discrete';
        masterGainRef.current.gain.value = masterVolumeRef.current;
        masterGainRef.current.connect(ctx.destination);
      }

      mergerRef.current = ctx.createChannelMerger(targetChannels);
      mergerRef.current.channelInterpretation = 'discrete';
      mergerRef.current.connect(masterGainRef.current!);

      // 1. Conectar Bus MÚSICOS (CUE = Click + Guía) con Balance L/R independiente
      cueSplitterRef.current = ctx.createChannelSplitter(2);
      cueAnalyserRef.current!.connect(cueSplitterRef.current);
      const { leftGain: cueLVol, rightGain: cueRVol } = computeCueBalanceGains(patch.cueBalance);
      const cueBalL = ctx.createGain();
      cueBalL.gain.value = cueLVol;
      const cueBalR = ctx.createGain();
      cueBalR.gain.value = cueRVol;
      stemTailNodesRef.current.push(cueBalL, cueBalR);
      cueSplitterRef.current.connect(cueBalL, 0);
      cueSplitterRef.current.connect(cueBalR, 1);

      const cuePatch = resolveCueIndices(patch.cueRouting, targetChannels);
      if (cuePatch.isMono) {
        cueMonoSumGainRef.current = ctx.createGain();
        cueMonoSumGainRef.current.gain.value = 0.707;
        cueBalL.connect(cueMonoSumGainRef.current);
        cueBalR.connect(cueMonoSumGainRef.current);
        cueMonoSumGainRef.current.connect(mergerRef.current, 0, cuePatch.leftIdx);
      } else {
        cueBalL.connect(mergerRef.current, 0, cuePatch.leftIdx);
        cueBalR.connect(mergerRef.current, 0, cuePatch.rightIdx);
      }

      const connectStereoPairWithPolarity = (
        splitter: ChannelSplitterNode,
        leftIdx: number,
        rightIdx: number,
        invertR: boolean
      ) => {
        splitter.connect(mergerRef.current!, 0, leftIdx);
        if (invertR) {
          const invGain = ctx.createGain();
          invGain.gain.value = -1;
          splitter.connect(invGain, 1);
          invGain.connect(mergerRef.current!, 0, rightIdx);
          stemTailNodesRef.current.push(invGain);
        } else {
          splitter.connect(mergerRef.current!, 1, rightIdx);
        }
      };

      // 2. Conectar Música hacia Consola (Multitrack Stems Separados OR Bus Estéreo FOH)
      if (patch.consoleBusMode === 'multitrack_stems' && stemSourcesRef.current.length > 0) {
        // Agrupar stems por destino físico (reglas globales + overrides + grupo)
        const targetBusInputs = new Map<string, GainNode>();

        stemSourcesRef.current.forEach((entry) => {
          const { target } = resolveStemConsoleTarget(
            { id: entry.id, name: entry.name, group: entry.group, category: entry.category },
            patch
          );
          let busInput = targetBusInputs.get(target);
          if (!busInput) {
            busInput = ctx.createGain();
            busInput.gain.value = 1.0;
            targetBusInputs.set(target, busInput);
            stemTailNodesRef.current.push(busInput);

            let signalEnd: AudioNode = busInput;
            if (patch.applyEqToStems) {
              const curve = getSafetyCurve();
              const chain = createStageBusDspNodes(ctx, curve);
              applyProfileToStageBusDspNodes(ctx, chain, activeEqProfileRef.current, curve);
              busInput.connect(chain.hpf);
              signalEnd = chain.output;
              stemBusDspChainsRef.current.push(chain);
              stemTailNodesRef.current.push(chain.hpf, ...chain.eqBands, chain.headroomGain, chain.shaper);
            }

            // Tap pasivo al analizador FOH (sin salida a merger) para mantener vivo el espectro FFT y VU meter
            const meterTap = ctx.createGain();
            meterTap.gain.value = 0.45;
            signalEnd.connect(meterTap);
            meterTap.connect(fohAnalyserRef.current!);
            stemTailNodesRef.current.push(meterTap);

            const resolved = resolveConsoleTarget(target, targetChannels);
            const splitter = ctx.createChannelSplitter(2);
            signalEnd.connect(splitter);
            stemTailNodesRef.current.push(splitter);

            if (resolved.isMono) {
              const monoSum = ctx.createGain();
              monoSum.gain.value = 0.707;
              splitter.connect(monoSum, 0);
              splitter.connect(monoSum, 1);
              monoSum.connect(mergerRef.current!, 0, resolved.leftIdx);
              stemTailNodesRef.current.push(monoSum);
            } else {
              connectStereoPairWithPolarity(
                splitter,
                resolved.leftIdx,
                resolved.rightIdx,
                Boolean(patch.fohPolarityInvertR)
              );
            }
          }
          entry.pannerNode.connect(busInput);
        });
      } else {
        // Bus FOH Estéreo Real L/R (Split explícito de 2 canales para no colapsar estéreo a mono!)
        fohSplitterRef.current = ctx.createChannelSplitter(2);
        fohAnalyserRef.current!.connect(fohSplitterRef.current);
        const [fohL, fohR] = resolvePairIndices(patch.fohPair, targetChannels);
        connectStereoPairWithPolarity(
          fohSplitterRef.current,
          fohL,
          fohR,
          Boolean(patch.fohPolarityInvertR)
        );
      }
      return;
    }

    // MODO ESTÉREO (StereoInEar o StereoSplit Seguro)
    try {
      ctx.destination.channelInterpretation = 'speakers';
      ctx.destination.channelCountMode = 'explicit';
      ctx.destination.channelCount = Math.min(2, maxChannels);
    } catch {}

    if (masterGainRef.current) {
      masterGainRef.current.channelCount = 2;
      masterGainRef.current.channelCountMode = 'max';
      masterGainRef.current.channelInterpretation = 'speakers';
      masterGainRef.current.gain.value = masterVolumeRef.current;
      masterGainRef.current.connect(ctx.destination);
    }

    fohPannerRef.current = ctx.createStereoPanner();
    fohPannerRef.current.pan.value = actualRoutingMode === 'StereoSplit' ? 1 : 0;
    if (patch.fohPolarityInvertR && actualRoutingMode === 'StereoInEar') {
      const fSp = ctx.createChannelSplitter(2);
      const fMg = ctx.createChannelMerger(2);
      const invR = ctx.createGain();
      invR.gain.value = -1;
      fohAnalyserRef.current!.connect(fSp);
      fSp.connect(fMg, 0, 0);
      fSp.connect(invR, 1);
      invR.connect(fMg, 0, 1);
      fMg.connect(fohPannerRef.current);
      stemTailNodesRef.current.push(fSp, fMg, invR);
    } else {
      fohAnalyserRef.current!.connect(fohPannerRef.current);
    }
    fohPannerRef.current.connect(masterGainRef.current!);

    cuePannerRef.current = ctx.createStereoPanner();
    cuePannerRef.current.pan.value = actualRoutingMode === 'StereoSplit' ? -1 : 0;
    if (patch.cueBalance && Math.abs(patch.cueBalance) > 0.01) {
      const { leftGain, rightGain } = computeCueBalanceGains(patch.cueBalance);
      const cSp = ctx.createChannelSplitter(2);
      const cMg = ctx.createChannelMerger(2);
      const gL = ctx.createGain();
      gL.gain.value = leftGain;
      const gR = ctx.createGain();
      gR.gain.value = rightGain;
      cueAnalyserRef.current!.connect(cSp);
      cSp.connect(gL, 0);
      cSp.connect(gR, 1);
      gL.connect(cMg, 0, 0);
      gR.connect(cMg, 0, 1);
      cMg.connect(cuePannerRef.current);
      stemTailNodesRef.current.push(cSp, cMg, gL, gR);
    } else {
      cueAnalyserRef.current!.connect(cuePannerRef.current);
    }
    cuePannerRef.current.connect(masterGainRef.current!);
  };

  const play = async () => {
    if (!audioCtxRef.current || !fohBufferRef.current || !cueBufferRef.current) return;

    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    // Limpiar nodos previos si existieran
    if (fohSourceRef.current) {
      try { fohSourceRef.current.stop(); fohSourceRef.current.disconnect(); } catch {}
      fohSourceRef.current = null;
    }
    if (cueSourceRef.current) {
      try { cueSourceRef.current.stop(); cueSourceRef.current.disconnect(); } catch {}
      cueSourceRef.current = null;
    }
    stemSourcesRef.current.forEach((st) => {
      try { st.source.stop(); st.source.disconnect(); st.gainNode.disconnect(); st.pannerNode.disconnect(); } catch {}
    });
    stemSourcesRef.current = [];

    ensureDspGraph();
    const maxOffset = Math.max(0, (fohBufferRef.current.duration || 0) - 0.05);
    const offset = Math.max(0, Math.min(pauseTimeRef.current, maxOffset));
    const hasActiveWifiSlaves = broadcastEnabledRef.current && connectionsRef.current > 0;
    const delayMs = hasActiveWifiSlaves ? 450 : 25;
    const T_start = Date.now() + delayMs;
    const startAudioContextTime = audioCtxRef.current.currentTime + delayMs / 1000;
    const useMultitrack = isUsingMultitrackStems();

    if (useMultitrack) {
      const preRoll = getPreRoll(currentSongRef.current || currentSong);
      stemSourcesRef.current = activeStemsRef.current.map((stem) => {
        const src = audioCtxRef.current!.createBufferSource();
        src.buffer = stem.buffer;
        const gainNode = audioCtxRef.current!.createGain();
        gainNode.gain.value = stem.volume * fohVolumeRef.current;
        const pannerNode = audioCtxRef.current!.createStereoPanner();
        pannerNode.pan.value = stem.pan || 0;
        src.connect(gainNode);
        gainNode.connect(pannerNode);
        return {
          id: stem.id,
          name: stem.name,
          category: stem.category,
          source: src,
          gainNode,
          pannerNode,
          baseVolume: stem.volume,
          group: stem.group,
        };
      });

      buildRoutingGraph();

      stemSourcesRef.current.forEach((entry) => {
        if (offset < preRoll) {
          entry.source.start(startAudioContextTime + (preRoll - offset), 0);
        } else {
          const stemOffset = offset - preRoll;
          if (stemOffset < (entry.source.buffer?.duration || 0)) {
            entry.source.start(startAudioContextTime, stemOffset);
          }
        }
      });
    } else {
      buildRoutingGraph();

      fohSourceRef.current = audioCtxRef.current.createBufferSource();
      fohSourceRef.current.buffer = fohBufferRef.current;
      fohSourceRef.current.connect(fohGainRef.current!);
      fohSourceRef.current.start(startAudioContextTime, offset);
    }

    cueSourceRef.current = audioCtxRef.current.createBufferSource();
    cueSourceRef.current.buffer = cueBufferRef.current;
    cueSourceRef.current.connect(cueGainRef.current!);
    cueSourceRef.current.start(startAudioContextTime, offset);

    if (broadcastEnabledRef.current) {
      const curSong = currentSongRef.current || currentSong;
      const syncCompMs = Math.round(
        (hardwareLatencyMsRef.current || 0) + (multiChannelPatchRef.current.syncOffsetMs || 0)
      );
      broadcast({
        type: 'PLAY',
        setlistId: selectedSetlistIdRef.current,
        songId: curSong?.id,
        songData: curSong,
        nextSongData: getNextSongInSetlist(),
        startAt: T_start + syncCompMs,
        offset: offset,
      });
    }

    startTimeRef.current = startAudioContextTime - offset;
    setIsPlaying(true);
    isPlayingRef.current = true;
    updateTime();
    triggerStageOsd('play', 'LANZANDO SHOW', (currentSongRef.current || currentSong)?.title || '');
  };

  const pause = (silent = false) => {
    if (!audioCtxRef.current || !isPlayingRef.current) return;

    if (fohSourceRef.current) {
      try { fohSourceRef.current.stop(); fohSourceRef.current.disconnect(); } catch {}
      fohSourceRef.current = null;
    }
    if (cueSourceRef.current) {
      try { cueSourceRef.current.stop(); cueSourceRef.current.disconnect(); } catch {}
      cueSourceRef.current = null;
    }
    stemSourcesRef.current.forEach((st) => {
      try { st.source.stop(); st.source.disconnect(); st.gainNode.disconnect(); st.pannerNode.disconnect(); } catch {}
    });
    stemSourcesRef.current = [];

    const clampedPauseGlobal = Math.max(0, audioCtxRef.current.currentTime - startTimeRef.current);
    pauseTimeRef.current = clampedPauseGlobal;
    const curSong = currentSongRef.current || currentSong;
    setAudioTime(clampedPauseGlobal);
    setCurrentTime(clampedPauseGlobal - getPreRoll(curSong));
    setIsPlaying(false);
    isPlayingRef.current = false;
    cancelAnimationFrame(animationFrameRef.current);

    if (broadcastEnabledRef.current) {
      broadcast({
        type: 'PAUSE',
        setlistId: selectedSetlistIdRef.current,
        songId: curSong?.id,
        offset: clampedPauseGlobal,
      });
    }

    if (!silent) {
      triggerStageOsd(
        'pause',
        'SHOW EN PAUSA',
        isConcertModeRef.current ? 'Presiona [ESPACIO] para reanudar' : 'Haz clic para reanudar'
      );
    }
  };

  const updateTime = () => {
    if (!audioCtxRef.current || !isPlayingRef.current) return;
    
    const rawGlobalTime = audioCtxRef.current.currentTime - startTimeRef.current;
    const globalTime = Math.max(0, rawGlobalTime);
    const curSong = currentSongRef.current || currentSong;
    const curTotalDur = totalDurationRef.current;
    const { preRollSec: preRoll, autoAdvanceAtGlobalSec } = resolveEffectivePlaybackBounds(curSong, curTotalDur);
    const visualTime = globalTime - preRoll;
    const remaining = autoAdvanceAtGlobalSec - globalTime;

    // Verificar Vamp Loop activo en vivo
    if (vampRangeRef.current.active && visualTime >= vampRangeRef.current.end) {
      seekTo(vampRangeRef.current.start);
      return;
    }

    // Pre-carga silenciosa de la siguiente canción cuando quedan ~30 seg
    if (remaining <= 30 && remaining > 0) {
      const idx = currentSongIndexRef.current;
      const allSongs = songsRef.current;
      if (idx < allSongs.length - 1) {
        const next = allSongs[idx + 1];
        const hasValidPrefetch =
          prefetchedSongRef.current &&
          prefetchedSongRef.current.songId === next?.id &&
          prefetchedSongRef.current.playbackMode === playbackModeRef.current;
        if (next && !hasValidPrefetch && !isPrefetchingRef.current) {
          prefetchNextSong(next);
        }
      }
    }

    // Fin de canción: auto-avance al siguiente track usando duración musical real (sin cola muerta de 5s)
    if (autoAdvanceAtGlobalSec > 0 && globalTime >= autoAdvanceAtGlobalSec) {
      pause(true);
      const idx = currentSongIndexRef.current;
      const allSongs = songsRef.current;
      if (idx < allSongs.length - 1) {
        autoPlayOnLoadRef.current = true;
        setCurrentSongIndex(idx + 1);
      } else {
        const { globalOffset: initGlobal, visualTime: initVisual } = getInitialPositionsForSong(curSong);
        pauseTimeRef.current = initGlobal;
        setCurrentTime(initVisual);
        setAudioTime(initGlobal);
      }
      return;
    }

    setAudioTime(globalTime);
    setCurrentTime(visualTime);
    animationFrameRef.current = requestAnimationFrame(updateTime);
  };

  const seekTo = (newVisualTime: number) => {
    if (!audioCtxRef.current) return;
    const wasPlaying = isPlayingRef.current;
    
    if (wasPlaying) pause(true);
    
    const curSong = currentSongRef.current || currentSong;
    const preRoll = getPreRoll(curSong);
    const curTotalDur = totalDurationRef.current;
    const maxGlobal = curTotalDur > 0 ? curTotalDur : Math.max(0, newVisualTime + preRoll);
    const globalTime = Math.max(0, Math.min(newVisualTime + preRoll, maxGlobal));
    const clampedVisual = globalTime - preRoll;
    
    pauseTimeRef.current = globalTime;
    setCurrentTime(clampedVisual);
    setAudioTime(globalTime);
    
    if (broadcastEnabledRef.current) {
       broadcast({ type: 'SEEK', offset: globalTime });
    }
    
    if (wasPlaying) {
      setTimeout(() => playRef.current(), 35);
    }
  };

  const handleToggleVampSection = (start: number, end: number) => {
    if (isVamping) {
      setIsVamping(false);
      vampRangeRef.current = { active: false, start: 0, end: 0 };
    } else {
      setIsVamping(true);
      vampRangeRef.current = { active: true, start, end };
    }
  };

  const stop = () => {
    pause(true);
    const curSong = currentSongRef.current || currentSong;
    const { globalOffset: initGlobal, visualTime: initVisual } = getInitialPositionsForSong(curSong);
    pauseTimeRef.current = initGlobal;
    setCurrentTime(initVisual);
    setAudioTime(initGlobal);
    if (broadcastEnabledRef.current) {
      broadcast({
        type: 'STOP',
        setlistId: selectedSetlistIdRef.current,
        songId: curSong?.id,
        offset: initGlobal,
      });
    }
    triggerStageOsd(
      'stop',
      'SHOW DETENIDO',
      initGlobal > 0 ? 'Rebobinado al Inicio Directo (00:00)' : 'Rebobinado al Conteo Pre-Roll'
    );
  };

  const nextSong = () => {
    if (currentSongIndex < songs.length - 1) {
      const nextIdx = currentSongIndex + 1;
      setCurrentSongIndex(nextIdx);
      triggerStageOsd('next', 'SIGUIENTE CANCIÓN', songs[nextIdx]?.title || '');
    }
  };

  const prevSong = () => {
    if (currentSongIndex > 0) {
      const prevIdx = currentSongIndex - 1;
      setCurrentSongIndex(prevIdx);
      triggerStageOsd('prev', 'CANCIÓN ANTERIOR', songs[prevIdx]?.title || '');
    }
  };

  useEffect(() => {
    playRef.current = play;
    pauseRef.current = pause;
    stopRef.current = stop;
    nextSongRef.current = nextSong;
    prevSongRef.current = prevSong;
  });

  // Atajos de Teclado y Pedales de Escenario (Armados EXCLUSIVAMENTE en Modo Concierto)
  useEffect(() => {
    if (isProjectorWindow) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEqDrawerOpenRef.current && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsEqDrawerOpen(false);
        return;
      }

      // 1. Si Modo Concierto está apagado, no intervenir en absoluto
      if (!isConcertModeRef.current) return;

      // 2. Si el usuario está escribiendo en un campo de texto, textarea o elemento editable, no interferir
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target &&
        ((target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isTextInput) return;

      // 3. Ignorar repeticiones por mantener tecla o pedal presionado
      if (e.repeat) return;

      const code = e.code;
      const key = e.key;

      // ESPACIO: Play / Pause toggle
      if (code === 'Space' || key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement)?.blur();

        const curSong = currentSongRef.current;
        if (isLoadingRef.current || !curSong || !curSong.foh_mix_url) return;

        if (isPlayingRef.current) {
          pauseRef.current();
        } else {
          playRef.current();
        }
        return;
      }

      // S o Escape: Stop
      if (code === 'KeyS' || key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement)?.blur();
        stopRef.current();
        return;
      }

      // Flecha Derecha o N: Siguiente canción
      if (code === 'ArrowRight' || code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement)?.blur();
        nextSongRef.current();
        return;
      }

      // Flecha Izquierda o P: Canción anterior
      if (code === 'ArrowLeft' || code === 'KeyP') {
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement)?.blur();
        prevSongRef.current();
        return;
      }

      // M: Silenciar / Restaurar CUE de Músicos
      if (code === 'KeyM') {
        e.preventDefault();
        e.stopPropagation();
        setMuteCueEmergency((prev) => !prev);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isConcertModeRef.current) return;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isProjectorWindow]);

  const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00.00';
    const isNeg = time < 0;
    const absTime = Math.abs(time);
    const mins = Math.floor(absTime / 60);
    const secs = Math.floor(absTime % 60);
    const ms = Math.floor((absTime % 1) * 100);
    return `${isNeg ? '-' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // Si es la ventana externa del Proyector HDMI, renderizar únicamente el visualizador limpio a pantalla completa
  if (isProjectorWindow) {
    return (
      <div className="w-screen h-screen bg-black overflow-hidden select-none relative">
        <LyricVisualizer
          currentTime={projectorState.currentTime}
          lyrics={projectorState.lyrics}
          isPlaying={projectorState.isPlaying}
          settings={projectorState.settings}
          bpm={projectorState.bpm}
          firstBeatOffset={projectorState.firstBeatOffset}
          beatTimes={projectorState.beatTimes}
          background={projectorState.background}
        />
      </div>
    );
  }

  const songSections = currentSong?.prompter_data?.sections || [];
  const playbackBounds = resolveEffectivePlaybackBounds(currentSong, totalDuration);
  const activePreRoll = playbackBounds.preRollSec;
  const activePreRollBars = resolveEffectivePreRollBars(currentSong);
  const displayMusicDuration = playbackBounds.musicDurationSec;
  const sliderVisualValue = isDraggingSlider ? localSliderTime : currentTime;
  const sliderTotalSpan = Math.max(0.001, displayMusicDuration + activePreRoll);
  const sliderProgressPct =
    currentSong && totalDuration > 0
      ? Math.max(0, Math.min(100, ((sliderVisualValue + activePreRoll) / sliderTotalSpan) * 100))
      : 0;
  const lyricMapping = resolveLyricsTimeMapping(currentSong);
  const syncedLyricTime = Math.max(0, currentTime + lyricMapping.lyricReferencePreRollSec);
  const syncedLyricFirstBeatOffset =
    (Number(currentSong?.prompter_data?.firstBeatOffset) || 0) + lyricMapping.lyricReferencePreRollSec;
  const syncedLyricBeatTimes = Array.isArray(currentSong?.prompter_data?.beatTimes)
    ? currentSong.prompter_data.beatTimes.map((t: number) => Number(t) + lyricMapping.lyricReferencePreRollSec)
    : undefined;

  return (
    <div className="h-screen bg-white text-zinc-900 flex flex-col font-sans overflow-hidden select-none relative">
      {/* Indicador luminoso superior de MODO CONCIERTO ARMADO */}
      {isConcertMode && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#e11d48] z-50 shadow-[0_0_12px_#e11d48] animate-pulse" />
      )}

      {/* HEADER / CONSOLA MAESTRA DE ESCENARIO (Azul Claro Suave + Auto-Wrap Responsivo) */}
      <header className="min-h-[82px] px-4 py-2.5 flex flex-wrap items-center justify-between shrink-0 z-20 gap-2.5 bg-gradient-to-b from-[#D7E6FA] to-[#E5EFFB] border-b border-[#B9D0EE] shadow-[0_2px_10px_rgba(30,64,124,0.08)]">
        {/* ISLA 1: Identidad del Show, Setlist, Modo & Armado de Concierto */}
        <div className="apple-glass-island p-1.5 rounded-2xl flex flex-wrap items-center gap-1.5 bg-white/95 border border-[#C6DAF3] shadow-xs max-w-full">
          {/* Live Stage Badge Sólido */}
          <div className="ruby-pill-accent text-white font-semibold px-3.5 py-1.5 rounded-full uppercase tracking-[0.14em] text-[10.5px] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            LIVE STAGE
          </div>

          {/* Setlist Selector + Quick Refresh from Stem Studio */}
          <div className="relative flex items-center gap-1">
            <select
              disabled={isConcertMode}
              className={`bg-transparent hover:bg-zinc-100 focus:bg-white text-zinc-900 px-3 py-1.5 rounded-full outline-none font-medium text-xs transition-all cursor-pointer max-w-[180px] border border-transparent focus:border-zinc-300 ${
                isConcertMode ? 'opacity-60 cursor-not-allowed' : ''
              }`}
              value={selectedSetlistId || ''}
              onChange={(e) => setSelectedSetlistId(e.target.value)}
              title={isConcertMode ? "Repertorio bloqueado durante Modo Concierto" : "Seleccionar Setlist"}
            >
              <option value="" className="bg-white text-zinc-900">Cargar Setlist...</option>
              {setlists.map(sl => (
                <option key={sl.id} value={sl.id} className="bg-white text-zinc-900">{sl.title}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={isConcertMode || isRefreshingSong || isPlaying}
              onClick={() => void handleRefreshSetlistFromStudio()}
              className="p-1.5 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 hover:text-zinc-950 border border-zinc-200 transition-all disabled:opacity-40 cursor-pointer"
              title="Actualizar Setlist (traer cambios recientes de Stem Studio / Studio Prompter)"
            >
              <RefreshCw size={12} className={isRefreshingSong ? 'animate-spin text-[#e11d48]' : ''} />
            </button>
          </div>

          {/* Mode Toggle Pill */}
          <div
            onClick={() => {
              if (isPlaying) return;
              setPlaybackMode(prev => prev === 'LIVE' ? 'REHEARSAL' : 'LIVE');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all cursor-pointer text-[10px] font-semibold uppercase tracking-wider ${
              playbackMode === 'LIVE'
                ? 'bg-rose-50 text-rose-700 border border-rose-300'
                : 'bg-amber-50 text-amber-800 border border-amber-300'
            } ${isPlaying ? 'opacity-40 cursor-not-allowed' : 'hover:brightness-105'}`}
            title={playbackMode === 'LIVE' ? "Modo Concierto En Vivo (Audio WAV de Consola)" : "Modo Práctica / Ensayo (Audio Ligero MP3)"}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${playbackMode === 'LIVE' ? 'bg-[#e11d48]' : 'bg-[#f59e0b]'}`} />
            <span>{playbackMode === 'LIVE' ? 'CONSOLA VIVO' : 'MODO PRÁCTICA'}</span>
          </div>

          {/* Botón Maestro "MODO CONCIERTO" */}
          <button
            type="button"
            onClick={toggleConcertMode}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all cursor-pointer text-[10px] font-bold uppercase tracking-wider select-none ${
              isConcertMode
                ? 'bg-[#e11d48] text-white shadow-sm ring-2 ring-[#e11d48]/25 hover:bg-[#be123c]'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 border border-zinc-200'
            }`}
            title={
              isConcertMode
                ? "MODO CONCIERTO ARMADO: Barra espaciadora y pedales activos"
                : "Activar Modo Concierto para armar la barra espaciadora y pedales"
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isConcertMode ? 'bg-white animate-ping' : 'bg-zinc-400'
              }`}
            />
            {isConcertMode ? (
              <>
                <Radio size={11} className="animate-pulse" />
                <span>EN CONCIERTO</span>
              </>
            ) : (
              <>
                <Lock size={10} />
                <span>MODO CONCIERTO: OFF</span>
              </>
            )}
          </button>
        </div>

        {/* ISLA 2: Reloj Digital, Título & Scrubber de Escenario */}
        <div className="apple-glass-island px-4 py-2 rounded-2xl flex flex-col items-center flex-1 min-w-[280px] max-w-[560px] bg-white/95 border border-[#C6DAF3] shadow-xs">
          <div className="w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1.5 px-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13.5px] font-bold text-zinc-900 truncate max-w-[210px] tracking-tight">
                {currentSong ? currentSong.title : 'Sin canción activa'}
              </span>
              {currentSong?.prompter_data?.key && (
                <span className="kapuha-contrast-pill text-[10px] font-mono px-2.5 py-0.5 rounded-full">
                  {currentSong.prompter_data.key}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-3xl leading-none font-mono font-medium text-black tracking-tight tabular-nums">
                {formatTime(currentTime)}
              </span>
              {currentSong?.prompter_data?.bpm && (
                <span className="text-[10.5px] font-mono font-medium px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-800 border border-zinc-200 tabular-nums">
                  {Math.round(currentSong.prompter_data.bpm)} BPM &bull; {currentSong.prompter_data?.timeSignature || '4/4'}
                </span>
              )}
              {activePreRoll > 0 && (
                <button
                  type="button"
                  onClick={handleToggleSkipPreRoll}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                    skipPreRoll
                      ? 'bg-sky-600 text-white border-sky-600 shadow-2xs'
                      : 'bg-zinc-100 text-zinc-700 border-zinc-200 hover:bg-zinc-200'
                  }`}
                  title={
                    skipPreRoll
                      ? 'Inicio Directo ACTIVO: Salta el Pre-Roll y arranca directo en 00:00'
                      : `Pre-Roll activo (${activePreRollBars}C · ${activePreRoll.toFixed(1)}s). Clic para saltar al inicio directo`
                  }
                >
                  <Zap size={10} />
                  <span>{skipPreRoll ? 'Directo' : `PRE ${activePreRollBars}C`}</span>
                </button>
              )}
            </div>
          </div>

          <div className="w-full flex items-center gap-2.5 group">
            <input
              type="range"
              min={-activePreRoll}
              max={displayMusicDuration > 0 ? displayMusicDuration : 100}
              step="0.1"
              value={sliderVisualValue}
              onPointerDown={() => {
                setLocalSliderTime(currentTime);
                setIsDraggingSlider(true);
              }}
              onPointerUp={(e) => {
                const nextVal = parseFloat(e.currentTarget.value);
                setIsDraggingSlider(false);
                seekTo(nextVal);
              }}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setLocalSliderTime(val);
                if (!isPlaying) {
                  seekTo(val);
                }
              }}
              disabled={isLoading || !currentSong}
              className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-30 group-hover:h-2 transition-all"
              style={{
                background:
                  currentSong && totalDuration > 0
                    ? `linear-gradient(to right, #e11d48 ${sliderProgressPct}%, #e2e8f0 ${sliderProgressPct}%)`
                    : '#e2e8f0',
              }}
            />
            {displayMusicDuration > 0 && (
              <span className="text-[10px] font-mono font-normal text-zinc-600 shrink-0 tabular-nums">
                {formatTime(displayMusicDuration).slice(0, 5)}
              </span>
            )}
          </div>
        </div>

        {/* ISLA 3: Rack de Audio, Faders Táctiles Duales, EQ 18 Bandas y Ruteo Multicanal */}
        <div className="apple-glass-island px-3.5 py-2 rounded-2xl flex flex-wrap items-center gap-x-3 gap-y-2 bg-white/95 border border-[#C6DAF3] shadow-xs max-w-full">
          {/* Fader Público FOH (R) + Mini Medidor VU */}
          <div className="flex flex-col min-w-[108px] w-28">
            <div className="flex justify-between items-center gap-1.5 mb-1">
              <span className="text-[9px] text-[#e11d48] font-bold uppercase tracking-wider flex items-center gap-1 whitespace-nowrap">
                <Volume2 size={11} /> PÚBLICO (R)
              </span>
              <span className="text-[10.5px] font-mono font-medium text-zinc-900 tabular-nums shrink-0">{Math.round(fohVolume * 100)}%</span>
            </div>
            <input
              type="range" min="0" max="1.3" step="0.01"
              value={fohVolume}
              onChange={(e) => setFohVolume(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #e11d48 ${(fohVolume / 1.3) * 100}%, #e2e8f0 ${(fohVolume / 1.3) * 100}%)`
              }}
              title="Volumen hacia Consola Principal / Público"
            />
            <div className="w-full h-[3px] bg-zinc-200 rounded-full overflow-hidden mt-1">
              <div
                ref={headerFohMeterRef}
                className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-[#e11d48]"
                style={{ width: '0%' }}
              />
            </div>
          </div>

          <div className="hidden sm:block w-px h-7 bg-slate-200" />

          {/* Fader Músicos CUE (L) + Mini Medidor VU */}
          <div className="flex flex-col min-w-[128px] w-32">
            <div className="flex justify-between items-center gap-1.5 mb-1">
              <span
                className="text-[9px] text-[#b45309] font-bold uppercase tracking-wider flex items-center gap-1 whitespace-nowrap"
                title={
                  liveCueSource === 'ram'
                    ? 'Click y Voz Guía sintetizados en RAM desde las secciones actualizadas'
                    : 'Click y Voz Guía reproducidos desde el Mix CUE exportado'
                }
              >
                <Headphones size={11} /> MÚSICOS
                {liveCueSource === 'ram' && (
                  <span className="text-[7px] px-1 py-0 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold">
                    IA
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setMuteCueEmergency(v => !v)}
                className={`text-[9.5px] font-mono font-medium px-1.5 py-0.5 rounded-md transition-all tabular-nums shrink-0 ${
                  muteCueEmergency
                    ? 'bg-[#e11d48] text-white font-bold'
                    : 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200 border border-zinc-200'
                }`}
                title="Silenciar Click/Guía de emergencia"
              >
                {muteCueEmergency ? 'MUTE' : `${Math.round(cueVolume * 100)}%`}
              </button>
            </div>
            <input
              type="range" min="0" max="1.3" step="0.01"
              value={muteCueEmergency ? 0 : cueVolume}
              onChange={(e) => {
                setMuteCueEmergency(false);
                setCueVolume(parseFloat(e.target.value));
              }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #f59e0b ${(((muteCueEmergency ? 0 : cueVolume) / 1.3) * 100)}%, #e2e8f0 ${(((muteCueEmergency ? 0 : cueVolume) / 1.3) * 100)}%)`
              }}
              title="Volumen de Click y Voz Guía hacia Monitores / In-Ears"
            />
            <div className="w-full h-[3px] bg-zinc-200 rounded-full overflow-hidden mt-1">
              <div
                ref={headerCueMeterRef}
                className="h-full bg-gradient-to-r from-emerald-500 to-amber-500"
                style={{ width: '0%' }}
              />
            </div>
          </div>

          {(multiChannelPatch.cueBalance ?? 0) <= -0.8 && (
            <button
              type="button"
              onClick={() => {
                (document.activeElement as HTMLElement)?.blur();
                setIsEqDrawerOpen(true);
              }}
              className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-[9px] font-extrabold uppercase tracking-wider hover:bg-amber-100 transition-all cursor-pointer"
              title="El Balance CUE está cargado al canal L (Solo Click) y puede atenuar la Voz Guía (R). Haz clic para ajustarlo en EQ 18B / Matriz."
            >
              ⚠️ Solo Click (L)
            </button>
          )}

          <div className="hidden sm:block w-px h-7 bg-slate-200" />

          {/* Selector de Ruteo Físico */}
          <div className="flex flex-col">
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-zinc-500 font-medium uppercase tracking-wider">Ruteo</span>
              {routingMode === 'MultiChannel' && (
                <span
                  className={`text-[8px] font-mono px-1 rounded font-bold ${
                    hardwareMaxChannels >= 4
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {hardwareMaxChannels >= 4 ? `${hardwareMaxChannels}ch` : 'Split'}
                </span>
              )}
            </div>
            <select
              className="bg-transparent text-[11px] font-semibold outline-none text-zinc-800 cursor-pointer hover:text-black max-w-[140px]"
              value={routingMode}
              onChange={(e) => setRoutingMode(e.target.value as 'StereoInEar' | 'StereoSplit' | 'MultiChannel')}
            >
              <option value="StereoInEar" className="bg-white text-zinc-900">🎧 In-Ear Estéreo</option>
              <option value="StereoSplit" className="bg-white text-zinc-900">🔀 Split L/R (Cable Y)</option>
              <option value="MultiChannel" className="bg-white text-zinc-900">🎛️ USB Multi (4+ Ch)</option>
            </select>
          </div>

          {/* Botón Semáforo Verificador Soundcheck & I/O */}
          {(() => {
            const selectedOut = audioOutputs.find((d) => d.deviceId === multiChannelPatch.sinkId);
            const sinkMissing = Boolean(
              multiChannelPatch.sinkId &&
                multiChannelPatch.sinkId !== 'default' &&
                audioOutputs.length > 0 &&
                !selectedOut
            );
            const activeOutLabel =
              selectedOut?.label ||
              audioOutputs.find((d) => d.deviceId === 'default')?.label ||
              audioOutputs[0]?.label ||
              multiChannelPatch.sinkLabel ||
              '';

            const iifeAnalysis = analyzeStagePatch(
              routingMode,
              multiChannelPatch,
              hardwareMaxChannels,
              loadedStemsSummary.map((s) => ({
                id: s.id,
                name: s.name,
                group: s.group,
                category: detectInstrumentCategory(s.name),
              })),
              {
                activeDeviceLabel: activeOutLabel,
                activeDeviceLatencyMs: Math.round(hardwareLatencyMsRef.current),
                sinkMissingOrRejected: sinkSwitchError || sinkMissing,
              }
            );

            const isCritical = iifeAnalysis.preflightLevel === 'critical';
            const isWarning = iifeAnalysis.preflightLevel === 'warning';
            const badgeText =
              sinkSwitchError || sinkMissing
                ? 'I/O USB !'
                : iifeAnalysis.cueFohConflicts.length > 0
                ? 'I/O COLISIÓN'
                : iifeAnalysis.outOfRangeIssues.length > 0
                ? 'I/O !'
                : iifeAnalysis.isFallbackSplit
                ? 'I/O Split'
                : iifeAnalysis.isBluetoothRisk
                ? 'I/O BT !'
                : routingMode === 'MultiChannel'
                ? `I/O ${hardwareMaxChannels}ch`
                : routingMode === 'StereoSplit'
                ? 'I/O L/R'
                : 'I/O';

            return (
              <button
                type="button"
                onClick={() => {
                  (document.activeElement as HTMLElement)?.blur();
                  navigate('/soundcheck');
                }}
                className={`px-2.5 py-2 rounded-xl transition-all flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider cursor-pointer border ${
                  isCritical
                    ? 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100 animate-pulse'
                    : isWarning
                    ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                    : routingMode === 'MultiChannel'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                    : 'bg-zinc-100 text-zinc-800 border-zinc-200 hover:bg-zinc-900 hover:text-white hover:border-zinc-900'
                }`}
                title={
                  sinkSwitchError || sinkMissing
                    ? 'Interfaz USB desconectada o rechazada. Clic para revisar en Soundcheck & I/O.'
                    : iifeAnalysis.cueFohConflicts.length > 0
                    ? `Colisión CUE/FOH en ${iifeAnalysis.cueFohConflicts.map((c) => `CH ${c.chNum}`).join(', ')}. Clic para corregir.`
                    : iifeAnalysis.outOfRangeIssues.length > 0
                    ? `Canales fuera de rango (${iifeAnalysis.outOfRangeIssues.map((o) => `${o.busLabel} → ${o.target}`).join(', ')}).`
                    : iifeAnalysis.isFallbackSplit
                    ? 'Interfaz <4 canales: Protección Split L/R activa. Clic para abrir Soundcheck & I/O.'
                    : 'Abrir Verificador de Hardware & Soundcheck Canal por Canal (Pre-Show)'
                }
              >
                <Activity
                  size={13}
                  className={
                    isCritical
                      ? 'text-rose-600'
                      : isWarning
                      ? 'text-amber-600'
                      : routingMode === 'MultiChannel'
                      ? 'text-emerald-600'
                      : 'text-[#e11d48]'
                  }
                />
                <span>{badgeText}</span>
              </button>
            );
          })()}

          {/* Botón Rack Ecualizador 18 Bandas + Matriz Multicanal */}
          <button
            type="button"
            onClick={() => {
              (document.activeElement as HTMLElement)?.blur();
              refreshHardwareDevices();
              setIsEqDrawerOpen((v) => !v);
            }}
            className={`px-2.5 py-2 rounded-xl transition-all flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider cursor-pointer border ${
              isEqDrawerOpen
                ? 'bg-zinc-950 text-white border-zinc-950 shadow-sm'
                : activeEqProfile.enabled &&
                  (activeEqProfile.hpfFreq > 0 || activeEqProfile.gains.some((g) => Math.abs(g) > 0.05))
                ? 'bg-rose-50 text-[#e11d48] border-rose-300 hover:bg-rose-100'
                : 'bg-zinc-100 text-zinc-700 border-zinc-200 hover:text-black hover:bg-zinc-200'
            }`}
            title="Abrir Ecualizador Quirúrgico de 18 Bandas, Presets de Ensayo y Matriz Multicanal"
          >
            <Sliders size={13} />
            <span>EQ 18B</span>
            {activeEqProfile.enabled &&
              (activeEqProfile.hpfFreq > 0 || activeEqProfile.gains.some((g) => Math.abs(g) > 0.05)) && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#e11d48] animate-pulse" />
              )}
          </button>

          {/* In-Ear Sync Beacon + Buscador Rápido RPC */}
          <div ref={inEarRadarRef} className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                (document.activeElement as HTMLElement)?.blur();
                const next = !broadcastEnabled;
                setBroadcastEnabled(next);
                if (next) {
                  scanDevices();
                }
              }}
              className={`px-2.5 py-2 rounded-xl transition-all flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider cursor-pointer border ${
                broadcastEnabled
                  ? 'bg-blue-600 text-white border-blue-700 shadow-sm hover:bg-blue-700'
                  : connections > 0
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-zinc-100 text-zinc-700 hover:text-zinc-950 border-zinc-200 hover:bg-zinc-200'
              }`}
              title={`Transmitir In-Ear WiFi a celulares para ensayos (${connections} ${connections === 1 ? 'conectado' : 'conectados'})`}
            >
              <Wifi size={13} />
              <span>IN-EAR</span>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-mono font-bold tabular-nums ${
                  broadcastEnabled
                    ? connections > 0
                      ? 'bg-emerald-400/25 text-emerald-100 border border-emerald-300/40'
                      : 'bg-white/20 text-white'
                    : connections > 0
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-200 text-zinc-700'
                }`}
              >
                {connections > 0 && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                      broadcastEnabled ? 'bg-emerald-300' : 'bg-white'
                    }`}
                  />
                )}
                {connections}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                (document.activeElement as HTMLElement)?.blur();
                scanDevices();
                setIsInEarRadarOpen((prev) => !prev);
              }}
              className={`p-2 rounded-xl transition-all flex items-center justify-center cursor-pointer border ${
                isInEarRadarOpen
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-zinc-100 text-zinc-700 hover:text-zinc-950 border-zinc-200 hover:bg-zinc-200'
              }`}
              title="Buscar dispositivos In-Ear conectados al instante (RPC) y ver detalle"
            >
              <RefreshCw size={13} className={isScanning ? 'animate-spin text-blue-600' : ''} />
            </button>

            {isInEarRadarOpen && (
              <div className="absolute left-0 xl:left-auto xl:right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-[#B9D0EE] rounded-2xl shadow-2xl p-3.5 z-50 text-zinc-900">
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-zinc-200">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Smartphone size={14} className="text-blue-600 shrink-0" />
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-900 truncate">
                        Celulares In-Ear ({connections})
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-semibold">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          inEarChannelStatus === 'connected'
                            ? 'bg-emerald-500'
                            : inEarChannelStatus === 'connecting'
                            ? 'bg-amber-400 animate-pulse'
                            : 'bg-rose-500'
                        }`}
                      />
                      <span className="text-zinc-500">
                        {inEarChannelStatus === 'connected'
                          ? 'Radar RPC Activo (<50ms)'
                          : inEarChannelStatus === 'connecting'
                          ? 'Conectando canal Realtime...'
                          : 'Canal desconectado'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      (document.activeElement as HTMLElement)?.blur();
                      scanDevices();
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1 cursor-pointer shrink-0 transition-all"
                    title="Lanzar búsqueda rápida RPC a todos los celulares"
                  >
                    <RefreshCw size={11} className={isScanning ? 'animate-spin' : ''} />
                    <span>{isScanning ? 'Buscando...' : 'Buscar RPC'}</span>
                  </button>
                </div>

                {/* Estado de transmisión */}
                <div className="flex items-center justify-between gap-2 py-2 border-b border-zinc-100">
                  <span className="text-[10.5px] font-semibold text-zinc-600">
                    Transmisión Sync Wi-Fi:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      (document.activeElement as HTMLElement)?.blur();
                      const next = !broadcastEnabled;
                      setBroadcastEnabled(next);
                      if (next) scanDevices();
                    }}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider cursor-pointer transition-all border ${
                      broadcastEnabled
                        ? 'bg-blue-600 text-white border-blue-700'
                        : 'bg-zinc-100 text-zinc-700 border-zinc-300 hover:bg-zinc-200'
                    }`}
                  >
                    {broadcastEnabled ? 'ACTIVA (ON)' : 'EN PAUSA (OFF)'}
                  </button>
                </div>

                {/* Lista viva de celulares conectados */}
                <div className="mt-2.5 max-h-52 overflow-y-auto space-y-1.5">
                  {readyClients.length === 0 ? (
                    <div className="rounded-xl bg-zinc-50 border border-dashed border-zinc-200 p-3 text-center">
                      <p className="text-[11px] font-semibold text-zinc-600">
                        Sin celulares conectados en este momento
                      </p>
                      <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                        En el celular, abre <strong>In-Ear Monitor</strong> y pulsa{' '}
                        <strong>&ldquo;2. Conectar y Sincronizar&rdquo;</strong>. Aparecerá al instante.
                      </p>
                    </div>
                  ) : (
                    readyClients.map((client) => (
                      <div
                        key={client.clientId}
                        className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-emerald-50/70 border border-emerald-200/80"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-zinc-900 truncate">
                              {client.deviceLabel || 'Músico In-Ear'}
                            </p>
                            <p className="text-[9.5px] font-semibold text-zinc-500 flex items-center gap-1.5">
                              <span
                                className={
                                  client.songReady
                                    ? 'text-emerald-700 font-bold'
                                    : 'text-amber-700 font-semibold'
                                }
                              >
                                {client.songReady ? '✓ Listo en RAM' : 'Esperando tema'}
                              </span>
                              {typeof client.rttMs === 'number' && client.rttMs > 0 && (
                                <span className="font-mono text-[9px] px-1.5 py-0 rounded bg-white border border-zinc-200 text-zinc-700">
                                  {client.rttMs} ms
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <span className="text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white shrink-0">
                          ONLINE
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-[#08090c]/90 z-40 flex flex-col items-center justify-center backdrop-blur-2xl">
            <div className="relative w-16 h-16 flex items-center justify-center mb-5">
              <div className="absolute inset-0 border-4 border-rose-500/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-rose-500 border-t-transparent rounded-full animate-spin shadow-[0_0_20px_rgba(244,63,94,0.5)]" />
              <Music size={22} className="text-rose-400" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-1.5 tracking-tight">{currentSong?.title}</h2>
            <p className="text-zinc-400 font-mono text-xs uppercase tracking-widest">{loadStatus}</p>
          </div>
        )}

        {/* SETLIST SIDEBAR (Fondo Blanco, Letras Negras) */}
        <div className="w-84 bg-[#f8f9fa] border-r border-zinc-200 flex flex-col z-10 shrink-0">
          {(() => {
            const setlistReadiness = evaluateInEarPlaylistReadiness(
              songs as PracticeSongItem[],
              pcVaultTracksBySongId
            );
            const pendingCount = setlistReadiness.pendingSongs.length;
            const readyCount = setlistReadiness.readySongs.length;
            const totalExportable = setlistReadiness.exportableSongs.length;

            return (
              <div className="px-4 py-3 border-b border-zinc-200 bg-white space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold flex items-center text-zinc-900 text-xs uppercase tracking-wider">
                    <LayoutList size={15} className="mr-2 text-[#e11d48]" /> Repertorio En Vivo
                  </h2>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[9.5px] font-mono font-bold text-emerald-800 tabular-nums flex items-center gap-1"
                      title={`Canciones guardadas en la memoria local del PC: ${readyCount}/${totalExportable}${
                        setlistReadiness.totalCachedBytes > 0
                          ? ` (${formatBytesCompact(setlistReadiness.totalCachedBytes)})`
                          : ''
                      }`}
                    >
                      <HardDrive size={10} className="text-emerald-600" />
                      <span>
                        {readyCount}/{totalExportable} PC
                      </span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] font-mono font-medium text-zinc-800 tabular-nums">
                      {songs.length} {songs.length === 1 ? 'TEMA' : 'TEMAS'}
                    </span>
                  </div>
                </div>

                {/* Botonera: Actualizar Setlist (desde Stem Studio) + Guardar / Volver a Descargar MP3 en PC */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={isRefreshingSong || isDownloadingSetlistToPc || isPlaying}
                    onClick={() => void handleRefreshSetlistFromStudio()}
                    className="px-2.5 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-200 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 cursor-pointer"
                    title="Actualizar Setlist con los últimos cambios hechos en Stem Studio o Studio Prompter"
                  >
                    <RefreshCw
                      size={11}
                      className={isRefreshingSong ? 'animate-spin text-[#e11d48]' : 'text-zinc-700'}
                    />
                    <span>Actualizar Setlist</span>
                  </button>

                  {pendingCount > 0 ? (
                    <button
                      type="button"
                      disabled={isDownloadingSetlistToPc || totalExportable === 0}
                      onClick={() => void handleDownloadPendingSetlistToPc(songs, false)}
                      className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 border border-amber-600/30 text-[10px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 cursor-pointer shadow-2xs"
                      title={`Descargar y guardar en la memoria local del PC las ${pendingCount} canciones pendientes en MP3`}
                    >
                      {isDownloadingSetlistToPc ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <CloudDownload size={12} />
                      )}
                      <span>Guardar en PC ({pendingCount})</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isDownloadingSetlistToPc || totalExportable === 0 || isPlaying}
                      onClick={() => void handleForceRedownloadSetlistToPc()}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 cursor-pointer"
                      title="Volver a descargar desde la nube todas las canciones del Setlist y actualizar la memoria local del PC"
                    >
                      {isDownloadingSetlistToPc ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <CloudDownload size={12} className="text-emerald-700" />
                      )}
                      <span>Volver a Descargar</span>
                    </button>
                  )}
                </div>

                {pcDownloadProgressMsg && (
                  <div className="text-[10px] font-mono font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 truncate">
                    {pcDownloadProgressMsg}
                  </div>
                )}
                {syncFeedback && (
                  <div className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1 truncate flex items-center gap-1">
                    <Check size={11} className="text-emerald-600 shrink-0" />
                    <span className="truncate">{syncFeedback}</span>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
            {songs.map((s, idx) => {
              const hasMix = Boolean(s.foh_mix_url && (s.cue_mix_url || Number(s.prompter_data?.bpm) > 0));
              const hasLyrics = Boolean(s.prompter_data?.lyrics?.length > 0);
              const isSelected = idx === currentSongIndex;
              const songVaultEv = evaluateSongVaultState(
                s as PracticeSongItem,
                pcVaultTracksBySongId[s.id]
              );
              const isCachedInPc =
                songVaultEv.status === 'offline_ready' &&
                !songVaultEv.cueNeedsDownload;
              const isRedownloadingThis = redownloadingSongId === s.id;

              // Variantes de tema multi-color inspiradas en Uiverse (Emerald, Blue, Amber, Rose, Purple)
              const themeClasses = [
                'track-theme-emerald',
                'track-theme-blue',
                'track-theme-amber',
                'track-theme-rose',
                'track-theme-purple',
              ];
              const themeClass = themeClasses[idx % themeClasses.length];

              // Progreso interactivo del track cuando está reproduciéndose
              const trackProgress = isSelected && totalDuration > 0
                ? sliderProgressPct
                : 0;

              return (
                <div
                  key={s.id || idx}
                  onClick={() => setCurrentSongIndex(idx)}
                  className={`group live-track-card ${themeClass} ${isSelected ? 'is-selected' : ''}`}
                >
                  {/* Barra de progreso inferior reactiva al audio en vivo */}
                  <div
                    className="live-track-progress"
                    style={{
                      width: isSelected ? `${trackProgress}%` : '0%',
                      opacity: isSelected && trackProgress > 0 ? 1 : 0,
                    }}
                  />

                  {/* Index Badge or Animated Equalizer Bars */}
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-mono tabular-nums mr-3 shrink-0 transition-transform group-hover:scale-105 font-bold shadow-xs"
                    style={{
                      backgroundColor: 'var(--badge-bg)',
                      color: 'var(--badge-text)',
                    }}
                  >
                    {isSelected && isPlaying ? (
                      <div className="flex items-end gap-[2px] h-3.5">
                        <span className="w-[2.5px] bg-white rounded-full animate-eq-1" />
                        <span className="w-[2.5px] bg-white rounded-full animate-eq-2" />
                        <span className="w-[2.5px] bg-white rounded-full animate-eq-3" />
                        <span className="w-[2.5px] bg-white rounded-full animate-eq-4" />
                      </div>
                    ) : (
                      String(idx + 1).padStart(2, '0')
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p
                        className="truncate text-[13.5px] tracking-tight font-bold"
                        style={{ color: 'var(--title-color)' }}
                      >
                        {s.title}
                      </p>
                      {s.prompter_data?.key && (
                        <span
                          className="text-[9.5px] font-mono px-2 py-0.5 rounded-full shrink-0 font-bold bg-white/80 border shadow-xs"
                          style={{
                            color: 'var(--content-color)',
                            borderColor: 'var(--border-active)',
                          }}
                        >
                          {s.prompter_data.key}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {!hasMix ? (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-rose-100/90 text-rose-800 border border-rose-300 font-semibold uppercase tracking-wider">
                          Sin Mix
                        </span>
                      ) : isCachedInPc ? (
                        <span
                          className="text-[9px] px-2 py-0.5 rounded-full bg-white/90 text-emerald-800 border border-emerald-300 font-bold uppercase tracking-wide flex items-center gap-1 shadow-xs"
                          title="Audio MP3 guardado en la memoria local del PC (Carga instantánea sin internet)"
                        >
                          <Check size={9} className="text-emerald-600" /> En PC
                        </span>
                      ) : (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/90 text-amber-800 border border-amber-300 font-bold uppercase tracking-wide flex items-center gap-1 shadow-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Mix Nube
                        </span>
                      )}
                      {hasLyrics && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/90 text-zinc-800 border border-zinc-200 font-semibold uppercase tracking-wide shadow-xs">
                          Lyrics
                        </span>
                      )}
                      {s.prompter_data?.bpm && (
                        <span
                          className="text-[9.5px] font-mono font-bold tabular-nums"
                          style={{ color: 'var(--content-color)' }}
                        >
                          {Math.round(s.prompter_data.bpm)} BPM
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Botón individual: Volver a descargar esta canción en el PC */}
                  {hasMix && (
                    <button
                      type="button"
                      disabled={isRedownloadingThis || isDownloadingSetlistToPc || isPlaying}
                      onClick={(e) => void handleRedownloadSingleSongToPc(s, e)}
                      className="ml-1.5 w-7 h-7 rounded-lg flex items-center justify-center bg-white/75 hover:bg-white border border-black/10 text-zinc-700 hover:text-zinc-950 opacity-75 group-hover:opacity-100 transition-all shrink-0 cursor-pointer disabled:opacity-35"
                      title={
                        isCachedInPc
                          ? `Volver a descargar "${s.title}" desde la nube`
                          : `Descargar y guardar "${s.title}" en la memoria local del PC`
                      }
                    >
                      {isRedownloadingThis ? (
                        <Loader2 size={12} className="animate-spin text-[#e11d48]" />
                      ) : (
                        <CloudDownload size={13} />
                      )}
                    </button>
                  )}

                  {/* Icono temático Uiverse de estado */}
                  <div
                    className="ml-2 w-6 h-6 rounded-lg flex items-center justify-center opacity-65 group-hover:opacity-100 transition-opacity shrink-0"
                    style={{ color: 'var(--content-color)' }}
                    title={isSelected ? "Pista seleccionada en vivo" : "Hacer clic para activar pista"}
                  >
                    {idx % 5 === 0 && (
                      <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M8.5 11.5 11 14l4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    )}
                    {idx % 5 === 1 && (
                      <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M10 11h2v5m-2 0h4m-2.592-8.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    )}
                    {idx % 5 === 2 && (
                      <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 13V8m0 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    )}
                    {idx % 5 === 3 && (
                      <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="m15 9-6 6m0-6 6 6m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    )}
                    {idx % 5 === 4 && (
                      <svg className="w-4 h-4" aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
            {songs.length === 0 && (
              <div className="text-center text-zinc-500 py-14 px-6 text-xs font-normal bg-white rounded-2xl border border-dashed border-zinc-200">
                Selecciona un Setlist en la barra superior para cargar las canciones del show.
              </div>
            )}
          </div>

          {/* CONTROLES DE TRANSPORTE DE ESCENARIO */}
          <div className="p-4 bg-white border-t border-zinc-200 grid grid-cols-3 gap-2.5">
            {/* Header de Modo Concierto & Teclado Armado */}
            <div className="col-span-3 flex items-center justify-between pb-2 mb-0.5 border-b border-zinc-100">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isConcertMode ? 'bg-[#e11d48] animate-ping' : 'bg-zinc-400'
                  }`}
                />
                <span className="text-[10px] font-bold tracking-wider uppercase text-zinc-700">
                  {isConcertMode ? 'TECLADO / PEDAL ARMADO' : 'MODO REPOSO'}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleConcertMode}
                className={`px-2.5 py-1 rounded-full text-[9.5px] font-bold tracking-wider uppercase transition-all flex items-center gap-1 cursor-pointer ${
                  isConcertMode
                    ? 'bg-[#e11d48] text-white shadow-xs hover:bg-[#be123c]'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 border border-zinc-200'
                }`}
                title="Conmutar Modo Concierto para armar o desarmar atajos de teclado y pedales"
              >
                {isConcertMode ? (
                  <>
                    <Radio size={10} className="animate-pulse" />
                    <span>EN CONCIERTO</span>
                  </>
                ) : (
                  <>
                    <Lock size={10} />
                    <span>ACTIVAR</span>
                  </>
                )}
              </button>
            </div>

            <button
              onClick={(e) => {
                (e.currentTarget as HTMLElement)?.blur();
                prevSong();
              }}
              disabled={currentSongIndex === 0}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-700 hover:text-black transition-all disabled:opacity-30 relative group"
              title={isConcertMode ? "Canción Anterior [Flecha Izq / P]" : "Canción Anterior"}
            >
              <SkipBack size={18} />
              {isConcertMode && (
                <span className="absolute bottom-1 text-[8px] font-mono text-zinc-400 group-hover:text-zinc-600">
                  ◀
                </span>
              )}
            </button>
            <button
              onClick={(e) => {
                (e.currentTarget as HTMLElement)?.blur();
                stop();
              }}
              disabled={!currentSong}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-700 hover:text-black transition-all disabled:opacity-30 relative group"
              title={isConcertMode ? "Detener y volver al Conteo Pre-Roll [S / Escape]" : "Detener y volver al Conteo Pre-Roll"}
            >
              <Square size={16} fill="currentColor" />
              {isConcertMode && (
                <span className="absolute bottom-1 text-[8px] font-mono text-zinc-400 group-hover:text-zinc-600">
                  ESC
                </span>
              )}
            </button>
            <button
              onClick={(e) => {
                (e.currentTarget as HTMLElement)?.blur();
                nextSong();
              }}
              disabled={currentSongIndex === songs.length - 1}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-700 hover:text-black transition-all disabled:opacity-30 relative group"
              title={isConcertMode ? "Siguiente Canción [Flecha Der / N]" : "Siguiente Canción"}
            >
              <SkipForward size={18} />
              {isConcertMode && (
                <span className="absolute bottom-1 text-[8px] font-mono text-zinc-400 group-hover:text-zinc-600">
                  ▶
                </span>
              )}
            </button>

            <button
              onClick={(e) => {
                (e.currentTarget as HTMLElement)?.blur();
                if (isPlaying) {
                  pause();
                } else {
                  play();
                }
              }}
              disabled={isLoading || !currentSong || !currentSong.foh_mix_url}
              className={`col-span-3 py-3.5 rounded-2xl flex items-center justify-center text-xs font-semibold transition-all tracking-widest uppercase border ${
                isPlaying
                  ? 'bg-black text-white border-black hover:bg-zinc-800'
                  : 'ruby-pill-accent text-white border-transparent hover:brightness-105 active:scale-[0.98]'
              } disabled:opacity-30`}
            >
              <div className="flex items-center justify-center gap-2">
                {isPlaying ? (
                  <Pause size={19} fill="currentColor" className="mr-0.5" />
                ) : (
                  <Play size={19} fill="currentColor" className="mr-0.5 ml-0.5" />
                )}
                <span>{isPlaying ? 'PAUSAR SHOW' : 'LANZAR CANCIÓN'}</span>
                {isConcertMode && (
                  <kbd className="ml-2 text-[9px] font-mono px-2 py-0.5 rounded-md bg-white/20 border border-white/30 text-white tracking-widest font-bold">
                    ESPACIO
                  </kbd>
                )}
              </div>
            </button>
          </div>
        </div>

        {/* ÁREA PRINCIPAL DE PROYECCIÓN Y MONITOREO EN VIVO */}
        <div className="flex-1 bg-white flex flex-col relative overflow-hidden">
          {/* Barra Superior del Escenario: Salto Rápido de Secciones + Selector de Vista + Proyector HDMI */}
          <div className="min-h-[52px] bg-[#EAF2FC] border-b border-[#C4D7F0] px-4 py-2 flex flex-wrap items-center justify-between gap-2.5 z-30 shrink-0">
            {/* Botonera de Salto Rápido a Secciones (Auto-Wrap en múltiples líneas si es necesario) */}
            <div className="flex flex-wrap items-center gap-1.5 py-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mr-1 shrink-0">
                Secciones:
              </span>
              {songSections.length === 0 ? (
                <span className="text-[11px] text-slate-500 italic">Sin marcadores configurados</span>
              ) : (
                songSections.map((sec: any, sIdx: number) => {
                  const nextSec = songSections[sIdx + 1];
                  const secEnd = (typeof sec.duration === 'number' && sec.duration > 0) ? sec.time + sec.duration : (nextSec ? nextSec.time : totalDuration);
                  const isSecActive = currentTime >= sec.time && currentTime < secEnd;
                  const secStyle = getSectionSolidStyle(sec.name || sec.section || '');
                  return (
                    <button
                      key={sIdx}
                      onClick={(e) => {
                        (e.currentTarget as HTMLElement)?.blur();
                        seekTo(sec.time);
                      }}
                      className={`px-3 py-1 rounded-full text-[10.5px] uppercase tracking-wider transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                        isSecActive
                          ? `${secStyle.bg} text-white font-bold shadow-xs ring-2 ring-black`
                          : 'bg-white/90 hover:bg-white text-slate-800 border border-[#C6DAF3] font-semibold shadow-2xs'
                      }`}
                      title={`Saltar a ${sec.name || sec.section}`}
                    >
                      <span className="text-[10px]">{secStyle.emoji}</span>
                      <span>{sec.name || sec.section}</span>
                    </button>
                  );
                })
              )}
              {isVamping && (
                <button
                  onClick={() => handleToggleVampSection(0, 0)}
                  className="px-3 py-1 rounded-full text-[10px] font-semibold uppercase ruby-pill-accent text-white flex items-center gap-1 shrink-0 ml-1"
                >
                  <Repeat size={11} /> Salir Loop
                </button>
              )}
            </div>

            {/* Apple Segmented View Mode Control + External Projector */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="apple-segmented-control flex items-center">
                <button
                  onClick={() => setViewMode('dual')}
                  className={`apple-segment-item ${viewMode === 'dual' ? 'active' : ''}`}
                  title="Ver Acordes y Proyección simultáneamente"
                >
                  <Columns size={12} />
                  <span>Stage Dual</span>
                </button>
                <button
                  onClick={() => setViewMode('prompter')}
                  className={`apple-segment-item ${viewMode === 'prompter' ? 'active' : ''}`}
                >
                  <Music size={12} />
                  <span>Solo Acordes</span>
                </button>
                <button
                  onClick={() => setViewMode('lyrics')}
                  className={`apple-segment-item ${viewMode === 'lyrics' ? 'active' : ''}`}
                >
                  <Type size={12} />
                  <span>Solo Letras</span>
                </button>
              </div>

              <button
                type="button"
                onClick={openExternalProjector}
                className="apple-glass-card px-3.5 py-1.5 rounded-full text-zinc-800 hover:text-black text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5 transition-all hover:border-[#e11d48]"
                title="Abrir ventana limpia de Proyección de Letras para arrastrar a pantalla LED / HDMI externo"
              >
                <ExternalLink size={12} className="text-[#e11d48]" />
                <span>Proyector HDMI</span>
              </button>

              <button
                type="button"
                onClick={() => refreshSongData()}
                disabled={!currentSong || isRefreshingSong}
                className={`apple-glass-card px-3.5 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5 transition-all cursor-pointer ${
                  syncFeedback
                    ? 'border-emerald-500 text-emerald-600 bg-emerald-50/50'
                    : 'text-zinc-800 hover:text-black hover:border-zinc-400'
                }`}
                title="Sincronizar letras y cambios guardados recientemente en Lyric Studio"
              >
                {syncFeedback ? (
                  <>
                    <Check size={12} className="text-emerald-500" />
                    <span>{syncFeedback}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw
                      size={12}
                      className={`text-[#e11d48] ${isRefreshingSong ? 'animate-spin' : ''}`}
                    />
                    <span>{isRefreshingSong ? 'Sincronizando...' : 'Sincronizar'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 p-4 overflow-hidden flex flex-col relative">
            {currentSong ? (
              viewMode === 'dual' ? (
                <div className="h-full w-full flex flex-col gap-3.5 overflow-hidden">
                  {/* Mitad Superior: Grilla de Compases, Acordes y Voz Guía */}
                  <div className="h-[46%] w-full rounded-2xl overflow-hidden border border-zinc-200 bg-white">
                    <Prompter
                      currentTime={currentTime}
                      totalDuration={displayMusicDuration > 0 ? displayMusicDuration : undefined}
                      preRollDuration={activePreRoll}
                      preRollBars={activePreRollBars}
                      lyricsTimeOffset={lyricMapping.prompterLyricsOffsetSec}
                      bpm={currentSong.prompter_data?.bpm || 0}
                      timeSignature={currentSong.prompter_data?.timeSignature}
                      baseOffset={currentSong.prompter_data?.firstBeatOffset}
                      beatTimes={currentSong.prompter_data?.beatTimes}
                      chords={currentSong.prompter_data?.chords || []}
                      sections={currentSong.prompter_data?.sections || []}
                      lyrics={currentSong.prompter_data?.lyrics || []}
                      isVamping={isVamping}
                      onVampTrigger={handleToggleVampSection}
                      onSeek={(t) => seekTo(t)}
                      isEditing={false}
                    />
                  </div>
                  {/* Mitad Inferior: Proyección de Letras o Aviso Elegante sin Letras */}
                  {currentHasLyrics ? (
                    <div className="flex-1 w-full rounded-2xl overflow-hidden border border-zinc-200 bg-black relative">
                      <LyricVisualizer
                        currentTime={syncedLyricTime}
                        lyrics={currentSong.prompter_data?.lyrics || []}
                        isPlaying={isPlaying}
                        settings={currentSong.prompter_data?.lyric_settings}
                        bpm={currentSong.prompter_data?.bpm || 120}
                        firstBeatOffset={syncedLyricFirstBeatOffset}
                        beatTimes={syncedLyricBeatTimes}
                        background={currentSong.prompter_data?.background}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 w-full rounded-2xl overflow-hidden border border-zinc-200 bg-white flex flex-col items-center justify-center p-8 text-center relative shadow-xs">
                      <div className="w-14 h-14 rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center mb-3 shadow-xs">
                        <Type size={26} className="text-zinc-600" />
                      </div>
                      <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">
                        Canción sin letras sincronizadas
                      </h3>
                      <p className="text-xs text-zinc-500 max-w-md mt-1.5 leading-relaxed font-normal">
                        Esta pista aún no tiene lírica cargada o acaba de ser configurada en Lyric Studio.
                      </p>
                      <div className="flex items-center gap-2 mt-4">
                        <button
                          type="button"
                          onClick={() => refreshSongData()}
                          disabled={isRefreshingSong}
                          className="px-4 py-2.5 rounded-xl border border-zinc-300 hover:bg-zinc-100 text-zinc-800 font-bold text-xs uppercase tracking-wider transition-all shadow-xs flex items-center gap-2 cursor-pointer active:scale-95"
                        >
                          <RefreshCw size={13} className={isRefreshingSong ? 'animate-spin text-[#e11d48]' : 'text-[#e11d48]'} />
                          <span>{isRefreshingSong ? 'Buscando letras...' : 'Sincronizar ahora'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('prompter')}
                          className="px-4 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
                        >
                          <Maximize2 size={13} />
                          <span>Maximizar a 'Solo Acordes'</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : viewMode === 'prompter' ? (
                <div className="h-full relative z-10 w-full rounded-2xl overflow-hidden border border-zinc-200 bg-white">
                  <Prompter
                    currentTime={currentTime}
                    totalDuration={displayMusicDuration > 0 ? displayMusicDuration : undefined}
                    preRollDuration={activePreRoll}
                    preRollBars={activePreRollBars}
                    lyricsTimeOffset={lyricMapping.prompterLyricsOffsetSec}
                    bpm={currentSong.prompter_data?.bpm || 0}
                    timeSignature={currentSong.prompter_data?.timeSignature}
                    baseOffset={currentSong.prompter_data?.firstBeatOffset}
                    beatTimes={currentSong.prompter_data?.beatTimes}
                    chords={currentSong.prompter_data?.chords || []}
                    sections={currentSong.prompter_data?.sections || []}
                    lyrics={currentSong.prompter_data?.lyrics || []}
                    isVamping={isVamping}
                    onVampTrigger={handleToggleVampSection}
                    onSeek={(t) => seekTo(t)}
                    isEditing={false}
                  />
                </div>
              ) : (
                <div className="h-full relative z-10 w-full rounded-2xl overflow-hidden border border-zinc-200 bg-black">
                  {currentHasLyrics ? (
                    <LyricVisualizer
                      currentTime={syncedLyricTime}
                      lyrics={currentSong.prompter_data?.lyrics || []}
                      isPlaying={isPlaying}
                      settings={currentSong.prompter_data?.lyric_settings}
                      bpm={currentSong.prompter_data?.bpm || 120}
                      firstBeatOffset={syncedLyricFirstBeatOffset}
                      beatTimes={syncedLyricBeatTimes}
                      background={currentSong.prompter_data?.background}
                    />
                  ) : (
                    <div className="h-full w-full bg-white flex flex-col items-center justify-center p-8 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center mb-3 shadow-xs">
                        <Type size={28} className="text-zinc-600" />
                      </div>
                      <h3 className="text-base font-bold text-zinc-900 uppercase tracking-widest">
                        Sin letras para proyectar
                      </h3>
                      <p className="text-xs text-zinc-500 max-w-sm mt-1.5 font-normal">
                        Esta pista aún no tiene lírica cargada o acaba de ser configurada en Lyric Studio.
                      </p>
                      <div className="flex items-center gap-2 mt-4">
                        <button
                          type="button"
                          onClick={() => refreshSongData()}
                          disabled={isRefreshingSong}
                          className="px-4 py-2 rounded-xl border border-zinc-300 hover:bg-zinc-100 text-zinc-800 font-bold text-xs uppercase tracking-wider transition-all shadow-xs flex items-center gap-2 cursor-pointer active:scale-95"
                        >
                          <RefreshCw size={13} className={isRefreshingSong ? 'animate-spin text-[#e11d48]' : 'text-[#e11d48]'} />
                          <span>{isRefreshingSong ? 'Buscando letras...' : 'Sincronizar ahora'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('prompter')}
                          className="px-4 py-2 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
                        >
                          <Maximize2 size={13} />
                          <span>Ver Acordes del Show</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                <div className="w-16 h-16 rounded-2xl bg-white border border-zinc-200 flex items-center justify-center mb-4 shadow-sm">
                  <Music size={28} className="text-[#e11d48]" />
                </div>
                <span className="text-zinc-900 text-base font-bold tracking-[0.25em] uppercase">
                  CONSOLA EN ESPERA DE SETLIST
                </span>
                <span className="text-zinc-500 text-xs mt-2 font-normal">
                  Selecciona un repertorio en la parte superior para iniciar el show en vivo
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* HUD OSD Flotante de Escenario (Feedback táctil instantáneo a distancia) */}
      {stageOsd && (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
          <div className="apple-glass-card bg-black/90 backdrop-blur-md text-white border border-white/15 px-8 py-5 rounded-3xl shadow-2xl flex items-center gap-4 transition-all">
            {stageOsd.type === 'play' && (
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shrink-0">
                <Play size={24} fill="currentColor" className="ml-1" />
              </div>
            )}
            {stageOsd.type === 'pause' && (
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 shrink-0">
                <Pause size={24} fill="currentColor" />
              </div>
            )}
            {stageOsd.type === 'stop' && (
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center text-rose-400 shrink-0">
                <Square size={20} fill="currentColor" />
              </div>
            )}
            {(stageOsd.type === 'next' || stageOsd.type === 'prev') && (
              <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400 shrink-0">
                {stageOsd.type === 'next' ? <SkipForward size={22} /> : <SkipBack size={22} />}
              </div>
            )}
            {stageOsd.type === 'mode_on' && (
              <div className="w-12 h-12 rounded-2xl bg-[#e11d48]/25 border border-[#e11d48]/50 flex items-center justify-center text-[#e11d48] shrink-0">
                <Radio size={24} className="animate-pulse" />
              </div>
            )}
            {stageOsd.type === 'mode_off' && (
              <div className="w-12 h-12 rounded-2xl bg-zinc-700/40 border border-zinc-600/50 flex items-center justify-center text-zinc-300 shrink-0">
                <Lock size={22} />
              </div>
            )}
            <div className="flex flex-col text-left min-w-0">
              <span className="text-sm font-bold tracking-wider uppercase text-white">
                {stageOsd.label}
              </span>
              {stageOsd.sublabel && (
                <span className="text-xs text-zinc-400 max-w-sm truncate font-medium mt-0.5">
                  {stageOsd.sublabel}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Rack DSP: Ecualizador de 18 Bandas & Matriz de Salida Multicanal */}
      <StageEqualizerConsole
        isOpen={isEqDrawerOpen}
        onClose={() => setIsEqDrawerOpen(false)}
        profile={activeEqProfile}
        onChangeProfile={updateActiveEqProfile}
        memoryScope={eqMemoryScope}
        onChangeMemoryScope={handleChangeMemoryScope}
        currentSongTitle={currentSong?.title}
        routingMode={routingMode}
        onChangeRoutingMode={setRoutingMode}
        multiChannelPatch={multiChannelPatch}
        onChangeMultiChannelPatch={setMultiChannelPatch}
        hardwareMaxChannels={hardwareMaxChannels}
        audioOutputs={audioOutputs}
        fohAnalyser={fohAnalyserRef.current}
        cueAnalyser={cueAnalyserRef.current}
        sinkSwitchError={sinkSwitchError}
        loadedStems={loadedStemsSummary}
        isLoadingStems={isLoadingStems}
        onOpenSoundcheck={() => {
          setIsEqDrawerOpen(false);
          navigate('/soundcheck');
        }}
      />
    </div>
  );
}
