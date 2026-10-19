import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Prompter, getSectionSolidStyle } from '../components/Prompter';
import { LyricVisualizer } from '../components/LyricVisualizer';
import { Play, Pause, Square, SkipBack, SkipForward, Music, LayoutList, Wifi, Type, Columns, ExternalLink, Repeat, Volume2, Headphones, Maximize2 } from 'lucide-react';
import { useSyncMaster } from '../hooks/useSyncMaster';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function LiveConcert() {
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

  const [setlists, setSetlists] = useState<any[]>([]);
  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(() => {
    return sessionStorage.getItem('tandu_active_setlist_id');
  });
  const [viewMode, setViewMode] = useState<'dual' | 'prompter' | 'lyrics'>('dual');
  
  const [songs, setSongs] = useState<any[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(0);
  const currentSong = songs[currentSongIndex] || null;
  const currentHasLyrics = Boolean(currentSong?.prompter_data?.lyrics && currentSong.prompter_data.lyrics.length > 0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [routingMode, setRoutingMode] = useState<'StereoSplit' | 'MultiChannel'>('StereoSplit');

  // Faders Independientes: Salida Público (FOH - R), Salida Músicos (CUE - L) y Master
  const [masterVolume] = useState<number>(1.0);
  const [fohVolume, setFohVolume] = useState<number>(1.0);
  const [cueVolume, setCueVolume] = useState<number>(1.0);
  const [muteCueEmergency, setMuteCueEmergency] = useState<boolean>(false);

  // Vamp Loop en Vivo
  const [isVamping, setIsVamping] = useState<boolean>(false);
  const vampRangeRef = useRef<{ active: boolean; start: number; end: number }>({ active: false, start: 0, end: 0 });

  const [playbackMode, setPlaybackMode] = useState<'LIVE' | 'REHEARSAL'>('LIVE');
  const playbackModeRef = useRef<'LIVE' | 'REHEARSAL'>('LIVE');
  useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);

  // Network Sync (Para In-Ears de Práctica por Wi-Fi)
  const { broadcast, connections } = useSyncMaster(FAKE_BAND_ID);
  const [broadcastEnabled, setBroadcastEnabled] = useState(false);

  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [localSliderTime, setLocalSliderTime] = useState(0);

  // Audio Context & Nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const fohSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const cueSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Buffers loaded in RAM
  const fohBufferRef = useRef<AudioBuffer | null>(null);
  const cueBufferRef = useRef<AudioBuffer | null>(null);
  
  // Nodes for routing
  const masterGainRef = useRef<GainNode | null>(null);
  const fohGainRef = useRef<GainNode | null>(null);
  const cueGainRef = useRef<GainNode | null>(null);
  const fohPannerRef = useRef<StereoPannerNode | null>(null);
  const cuePannerRef = useRef<StereoPannerNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const mergerRef = useRef<ChannelMergerNode | null>(null);

  // Time tracking
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const animationFrameRef = useRef(0);
  const isPlayingRef = useRef(false);

  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState('');

  // Pre-carga silenciosa de la SIGUIENTE canción
  const nextFohBufferRef = useRef<AudioBuffer | null>(null);
  const nextCueBufferRef = useRef<AudioBuffer | null>(null);
  const isPrefetchingRef = useRef(false);
  const autoPlayOnLoadRef = useRef(false);
  const songsRef = useRef<any[]>([]);
  const currentSongIndexRef = useRef<number>(0);

  useEffect(() => {
    if (isProjectorWindow) return;
    fetchSetlists();
    
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtxRef.current = new AudioContextClass();
    
    return () => {
      pause();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [isProjectorWindow]);

  useEffect(() => {
    if (isProjectorWindow) return;
    if (selectedSetlistId) {
      sessionStorage.setItem('tandu_active_setlist_id', selectedSetlistId);
      fetchSetlistSongs(selectedSetlistId);
    } else {
      setSongs([]);
      setCurrentSongIndex(0);
    }
  }, [selectedSetlistId, isProjectorWindow]);

  useEffect(() => { songsRef.current = songs; }, [songs]);
  useEffect(() => { currentSongIndexRef.current = currentSongIndex; }, [currentSongIndex]);

  // When song index changes, load the audio automatically
  useEffect(() => {
    if (isProjectorWindow) return;
    if (currentSong) {
      setIsVamping(false);
      vampRangeRef.current = { active: false, start: 0, end: 0 };
      loadSongAudio(currentSong, autoPlayOnLoadRef.current);
      autoPlayOnLoadRef.current = false;
    }
  }, [currentSongIndex, currentSong, broadcastEnabled, isProjectorWindow]);

  // Actualizar ganancias en tiempo real (Master, FOH Público y CUE Músicos)
  useEffect(() => {
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setTargetAtTime(masterVolume, audioCtxRef.current.currentTime, 0.03);
    }
  }, [masterVolume]);

  useEffect(() => {
    if (fohGainRef.current && audioCtxRef.current) {
      fohGainRef.current.gain.setTargetAtTime(fohVolume, audioCtxRef.current.currentTime, 0.03);
    }
  }, [fohVolume]);

  useEffect(() => {
    if (cueGainRef.current && audioCtxRef.current) {
      const effectiveCue = muteCueEmergency ? 0 : cueVolume;
      cueGainRef.current.gain.setTargetAtTime(effectiveCue, audioCtxRef.current.currentTime, 0.03);
    }
  }, [cueVolume, muteCueEmergency]);

  // Sincronizar con ventana de Proyector Externo HDMI
  useEffect(() => {
    if (isProjectorWindow || !projectorChannelRef.current || !currentSong) return;
    projectorChannelRef.current.postMessage({
      type: 'PROJECTOR_SYNC',
      payload: {
        currentTime,
        isPlaying,
        title: currentSong.title,
        lyrics: currentSong.prompter_data?.lyrics || [],
        settings: currentSong.prompter_data?.lyric_settings,
        bpm: currentSong.prompter_data?.bpm || 120,
        firstBeatOffset: currentSong.prompter_data?.firstBeatOffset || 0,
        beatTimes: currentSong.prompter_data?.beatTimes,
      },
    });
  }, [currentTime, isPlaying, currentSong, isProjectorWindow]);

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

  const fetchSetlistSongs = async (setId: string) => {
    const { data, error } = await supabase
      .from('setlist_songs')
      .select(`
        position,
        song:songs (id, title, foh_mix_url, cue_mix_url, foh_mobile_url, cue_mobile_url, prompter_data)
      `)
      .eq('setlist_id', setId)
      .order('position', { ascending: true });
      
    if (error) {
      console.error(error);
    } else {
      const mapped = (data || []).map(item => ({
        position: item.position,
        ...(item.song as any)
      }));
      setSongs(mapped);
      setCurrentSongIndex(0);
    }
  };

  const loadSongAudio = async (song: any, shouldAutoPlay = false) => {
    if (!audioCtxRef.current) return;
    
    pause();
    setCurrentTime(-getPreRoll(song));
    pauseTimeRef.current = 0;
    
    if (nextFohBufferRef.current && nextCueBufferRef.current) {
      console.log('[LiveConcert] ✅ Usando buffers pre-cargados en silencio.');
      fohBufferRef.current = nextFohBufferRef.current;
      cueBufferRef.current = nextCueBufferRef.current;
      nextFohBufferRef.current = null;
      nextCueBufferRef.current = null;
      setTotalDuration(fohBufferRef.current.duration);
      setLoadStatus('');
      if (broadcastEnabled) {
        broadcast({ type: 'LOAD_SONG', songId: song.id, songData: song });
      }
      if (shouldAutoPlay) {
        setTimeout(() => play(), 100);
      }
      return;
    }

    fohBufferRef.current = null;
    cueBufferRef.current = null;
    
    const mode = playbackModeRef.current;
    const targetFohUrl = mode === 'REHEARSAL' && song.foh_mobile_url ? song.foh_mobile_url : song.foh_mix_url;
    const targetCueUrl = mode === 'REHEARSAL' && song.cue_mobile_url ? song.cue_mobile_url : song.cue_mix_url;

    if (!targetFohUrl || !targetCueUrl) {
       setLoadStatus('Falta exportar el Mix En Vivo de esta canción en Studio Prompter.');
       return;
    }

    setIsLoading(true);
    setLoadStatus(mode === 'REHEARSAL' ? 'Cargando Audio Ligero de Práctica...' : 'Cargando Audio Master de Consola (FOH + Músicos)...');
    
    try {
      const [fohRes, cueRes] = await Promise.all([
        fetch(targetFohUrl),
        fetch(targetCueUrl),
      ]);
      const [fohArray, cueArray] = await Promise.all([
        fohRes.arrayBuffer(),
        cueRes.arrayBuffer(),
      ]);
      setLoadStatus('Decodificando canales en RAM (Cero Latencia)...');
      const [decodedFoh, decodedCue] = await Promise.all([
        audioCtxRef.current.decodeAudioData(fohArray),
        audioCtxRef.current.decodeAudioData(cueArray),
      ]);
      fohBufferRef.current = decodedFoh;
      cueBufferRef.current = decodedCue;
      
      setTotalDuration(fohBufferRef.current.duration);
      setLoadStatus('');
      
      if (broadcastEnabled) {
        broadcast({ type: 'LOAD_SONG', songId: song.id, songData: song });
      }

      if (shouldAutoPlay) {
        setTimeout(() => play(), 100);
      }
      
    } catch (e: any) {
      console.error(e);
      setLoadStatus('Error al cargar audio: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const prefetchNextSong = async (nextSong: any) => {
    if (!audioCtxRef.current || isPrefetchingRef.current) return;
    const mode = playbackModeRef.current;
    const targetFohUrl = mode === 'REHEARSAL' && nextSong.foh_mobile_url ? nextSong.foh_mobile_url : nextSong.foh_mix_url;
    const targetCueUrl = mode === 'REHEARSAL' && nextSong.cue_mobile_url ? nextSong.cue_mobile_url : nextSong.cue_mix_url;

    if (!targetFohUrl || !targetCueUrl) return;

    isPrefetchingRef.current = true;
    try {
      const [fohRes, cueRes] = await Promise.all([
        fetch(targetFohUrl),
        fetch(targetCueUrl),
      ]);
      const [fohArray, cueArray] = await Promise.all([
        fohRes.arrayBuffer(),
        cueRes.arrayBuffer(),
      ]);
      if (!audioCtxRef.current) return;
      const [fohBuf, cueBuf] = await Promise.all([
        audioCtxRef.current.decodeAudioData(fohArray),
        audioCtxRef.current.decodeAudioData(cueArray),
      ]);
      nextFohBufferRef.current = fohBuf;
      nextCueBufferRef.current = cueBuf;
    } catch (e) {
      nextFohBufferRef.current = null;
      nextCueBufferRef.current = null;
    } finally {
      isPrefetchingRef.current = false;
    }
  };

  const getPreRoll = (song: any) => {
    if (!song?.prompter_data?.bpm) return 0;
    const beatsPerMeasure = parseInt(song.prompter_data.timeSignature?.split('/')[0]) || 4;
    const raw = (60 / song.prompter_data.bpm) * beatsPerMeasure * 2;
    return Math.min(raw, 16);
  };

  const buildRoutingGraph = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    
    if (fohSourceRef.current) fohSourceRef.current.disconnect();
    if (cueSourceRef.current) cueSourceRef.current.disconnect();

    if (!masterGainRef.current) {
      masterGainRef.current = ctx.createGain();
    }
    masterGainRef.current.gain.value = masterVolume;
    masterGainRef.current.connect(ctx.destination);

    const maxChannels = ctx.destination.maxChannelCount;
    let actualRoutingMode = routingMode;
    if (routingMode === 'MultiChannel' && maxChannels < 4) {
      actualRoutingMode = 'StereoSplit';
    }

    if (actualRoutingMode === 'MultiChannel') {
      ctx.destination.channelCount = maxChannels;
      splitterRef.current = ctx.createChannelSplitter(maxChannels);
      mergerRef.current = ctx.createChannelMerger(maxChannels);
      mergerRef.current.connect(masterGainRef.current);
    }

    fohGainRef.current = ctx.createGain();
    fohGainRef.current.gain.value = fohVolume;

    cueGainRef.current = ctx.createGain();
    cueGainRef.current.gain.value = muteCueEmergency ? 0 : cueVolume;

    if (actualRoutingMode === 'StereoSplit') {
      // Stereo Split: CUE (Músicos) -> Left (-1), FOH (Público) -> Right (+1)
      fohPannerRef.current = ctx.createStereoPanner();
      fohPannerRef.current.pan.value = 1; // FOH to Right
      fohGainRef.current.connect(fohPannerRef.current);
      fohPannerRef.current.connect(masterGainRef.current);

      cuePannerRef.current = ctx.createStereoPanner();
      cuePannerRef.current.pan.value = -1; // CUE to Left
      cueGainRef.current.connect(cuePannerRef.current);
      cuePannerRef.current.connect(masterGainRef.current);
    } else if (actualRoutingMode === 'MultiChannel' && mergerRef.current) {
      fohGainRef.current.connect(mergerRef.current, 0, 0);
      fohGainRef.current.connect(mergerRef.current, 0, 1);
      cueGainRef.current.connect(mergerRef.current, 0, 2); 
    }
  };

  const play = async () => {
    if (!audioCtxRef.current || !fohBufferRef.current || !cueBufferRef.current) return;
    
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    buildRoutingGraph();

    fohSourceRef.current = audioCtxRef.current.createBufferSource();
    fohSourceRef.current.buffer = fohBufferRef.current;
    fohSourceRef.current.connect(fohGainRef.current!);

    cueSourceRef.current = audioCtxRef.current.createBufferSource();
    cueSourceRef.current.buffer = cueBufferRef.current;
    cueSourceRef.current.connect(cueGainRef.current!);

    const offset = pauseTimeRef.current;
    
    const delayMs = 300;
    const T_start = Date.now() + delayMs;
    
    if (broadcastEnabled) {
       broadcast({ type: 'PLAY', startAt: T_start, offset: offset });
    }

    const startAudioContextTime = audioCtxRef.current.currentTime + (delayMs / 1000);
    
    fohSourceRef.current.start(startAudioContextTime, offset);
    cueSourceRef.current.start(startAudioContextTime, offset);

    startTimeRef.current = startAudioContextTime - offset;
    setIsPlaying(true);
    isPlayingRef.current = true;
    updateTime();
  };

  const pause = () => {
    if (!audioCtxRef.current || !isPlayingRef.current) return;
    
    if (fohSourceRef.current) {
      try { fohSourceRef.current.stop(); } catch (e) {}
    }
    if (cueSourceRef.current) {
      try { cueSourceRef.current.stop(); } catch (e) {}
    }
    
    pauseTimeRef.current = audioCtxRef.current.currentTime - startTimeRef.current;
    setIsPlaying(false);
    isPlayingRef.current = false;
    cancelAnimationFrame(animationFrameRef.current);
    
    if (broadcastEnabled) {
       broadcast({ type: 'PAUSE' });
    }
  };

  const updateTime = () => {
    if (!audioCtxRef.current || !isPlayingRef.current) return;
    
    const globalTime = audioCtxRef.current.currentTime - startTimeRef.current;
    const preRoll = getPreRoll(currentSong);
    const visualTime = globalTime - preRoll;
    const remaining = totalDuration - globalTime;

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
        if (next && !nextFohBufferRef.current && !isPrefetchingRef.current) {
          prefetchNextSong(next);
        }
      }
    }

    // Fin de canción: auto-avance al siguiente track
    if (totalDuration > 0 && globalTime >= totalDuration) {
      pause();
      const idx = currentSongIndexRef.current;
      const allSongs = songsRef.current;
      if (idx < allSongs.length - 1) {
        autoPlayOnLoadRef.current = true;
        setCurrentSongIndex(idx + 1);
      }
      return;
    }

    setCurrentTime(visualTime);
    animationFrameRef.current = requestAnimationFrame(updateTime);
  };

  const seekTo = (newVisualTime: number) => {
    if (!audioCtxRef.current) return;
    const wasPlaying = isPlayingRef.current;
    
    if (wasPlaying) pause();
    
    const preRoll = getPreRoll(currentSong);
    const globalTime = Math.max(0, Math.min(newVisualTime + preRoll, totalDuration));
    
    pauseTimeRef.current = globalTime;
    setCurrentTime(newVisualTime);
    
    if (broadcastEnabled) {
       broadcast({ type: 'SEEK', offset: globalTime });
    }
    
    if (wasPlaying) {
      setTimeout(() => play(), 40);
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
    pause();
    pauseTimeRef.current = 0;
    setCurrentTime(-getPreRoll(currentSong));
  };

  const nextSong = () => {
    if (currentSongIndex < songs.length - 1) {
      setCurrentSongIndex(prev => prev + 1);
    }
  };

  const prevSong = () => {
    if (currentSongIndex > 0) {
      setCurrentSongIndex(prev => prev - 1);
    }
  };

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
        />
      </div>
    );
  }

  const songSections = currentSong?.prompter_data?.sections || [];

  return (
    <div className="h-screen bg-white text-zinc-900 flex flex-col font-sans overflow-hidden select-none relative">
      {/* HEADER / CONSOLA MAESTRA DE ESCENARIO (Entorno Blanco, Letras Negras) */}
      <header className="h-[90px] px-6 py-2.5 flex items-center justify-between shrink-0 z-20 gap-4 bg-white border-b border-zinc-200">
        {/* ISLA 1: Identidad del Show, Setlist & Modo */}
        <div className="apple-glass-island p-1.5 rounded-full flex items-center gap-2 shrink-0">
          {/* Live Stage Badge Sólido */}
          <div className="ruby-pill-accent text-white font-semibold px-3.5 py-1.5 rounded-full uppercase tracking-[0.14em] text-[10.5px] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            LIVE STAGE
          </div>

          {/* Setlist Selector */}
          <div className="relative">
            <select
              className="bg-transparent hover:bg-zinc-100 focus:bg-white text-zinc-900 px-3 py-1.5 rounded-full outline-none font-medium text-xs transition-all cursor-pointer max-w-[190px] border border-transparent focus:border-zinc-300"
              value={selectedSetlistId || ''}
              onChange={(e) => setSelectedSetlistId(e.target.value)}
            >
              <option value="" className="bg-white text-zinc-900">Cargar Setlist...</option>
              {setlists.map(sl => (
                <option key={sl.id} value={sl.id} className="bg-white text-zinc-900">{sl.title}</option>
              ))}
            </select>
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
        </div>

        {/* ISLA 2: Reloj Digital, Título & Scrubber de Escenario */}
        <div className="apple-glass-island px-5 py-2 rounded-2xl flex flex-col items-center flex-1 max-w-[560px]">
          <div className="w-full flex items-center justify-between mb-1.5 px-0.5">
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

            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-3xl leading-none font-mono font-medium text-black tracking-tight tabular-nums">
                {formatTime(currentTime)}
              </span>
              {currentSong?.prompter_data?.bpm && (
                <span className="text-[10.5px] font-mono font-medium px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-800 border border-zinc-200 tabular-nums">
                  {Math.round(currentSong.prompter_data.bpm)} BPM &bull; {currentSong.prompter_data?.timeSignature || '4/4'}
                </span>
              )}
            </div>
          </div>

          <div className="w-full flex items-center gap-2.5 group">
            <input
              type="range"
              min={-(getPreRoll(currentSong) || 0)}
              max={totalDuration - getPreRoll(currentSong) || 100}
              step="0.1"
              value={isDraggingSlider ? localSliderTime : currentTime}
              onPointerDown={() => setIsDraggingSlider(true)}
              onPointerUp={(e) => {
                setIsDraggingSlider(false);
                seekTo(parseFloat(e.currentTarget.value));
              }}
              onChange={(e) => {
                setLocalSliderTime(parseFloat(e.target.value));
                if (!isPlaying) {
                  seekTo(parseFloat(e.target.value));
                }
              }}
              disabled={isLoading || !currentSong}
              className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-30 group-hover:h-2 transition-all"
              style={{
                background: currentSong && totalDuration > 0
                  ? `linear-gradient(to right, #e11d48 ${((currentTime + getPreRoll(currentSong)) / totalDuration) * 100}%, #e2e8f0 ${((currentTime + getPreRoll(currentSong)) / totalDuration) * 100}%)`
                  : '#e2e8f0'
              }}
            />
            {totalDuration > 0 && (
              <span className="text-[10px] font-mono font-normal text-zinc-600 shrink-0 tabular-nums">
                {formatTime(Math.max(0, totalDuration - (getPreRoll(currentSong) || 0))).slice(0, 5)}
              </span>
            )}
          </div>
        </div>

        {/* ISLA 3: Rack de Audio, Faders Táctiles Duales e In-Ear */}
        <div className="apple-glass-island px-4 py-2 rounded-2xl flex items-center gap-3.5 shrink-0">
          {/* Fader Público FOH (R) */}
          <div className="flex flex-col w-26">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-[#e11d48] font-bold uppercase tracking-wider flex items-center gap-1">
                <Volume2 size={11} /> PÚBLICO (R)
              </span>
              <span className="text-[10.5px] font-mono font-medium text-zinc-900 tabular-nums">{Math.round(fohVolume * 100)}%</span>
            </div>
            <input
              type="range" min="0" max="1.3" step="0.01"
              value={fohVolume}
              onChange={(e) => setFohVolume(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #e11d48 ${(fohVolume / 1.3) * 100}%, #e2e8f0 ${(fohVolume / 1.3) * 100}%)`
              }}
              title="Volumen hacia Consola Principal / Público (Canal Derecho R)"
            />
          </div>

          <div className="w-px h-7 bg-zinc-200" />

          {/* Fader Músicos CUE (L) */}
          <div className="flex flex-col w-26">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-[#b45309] font-bold uppercase tracking-wider flex items-center gap-1">
                <Headphones size={11} /> MÚSICOS (L)
              </span>
              <button
                type="button"
                onClick={() => setMuteCueEmergency(v => !v)}
                className={`text-[9.5px] font-mono font-medium px-1.5 py-0.5 rounded-md transition-all tabular-nums ${
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
              title="Volumen de Click y Voz Guía hacia Consola de Músicos (Canal Izquierdo L)"
            />
          </div>

          <div className="w-px h-7 bg-zinc-200" />

          {/* Selector de Ruteo Físico */}
          <div className="flex flex-col">
            <span className="text-[8px] text-zinc-500 font-medium uppercase tracking-wider">Ruteo</span>
            <select
              className="bg-transparent text-[11px] font-medium outline-none text-zinc-800 cursor-pointer hover:text-black"
              value={routingMode}
              onChange={(e) => setRoutingMode(e.target.value as 'StereoSplit' | 'MultiChannel')}
            >
              <option value="StereoSplit" className="bg-white text-zinc-900">Stereo Split</option>
              <option value="MultiChannel" className="bg-white text-zinc-900">USB Multi</option>
            </select>
          </div>

          {/* In-Ear Sync Beacon */}
          <button
            type="button"
            onClick={() => setBroadcastEnabled(!broadcastEnabled)}
            className={`p-2 rounded-xl transition-all flex items-center gap-1.5 ${
              broadcastEnabled
                ? 'bg-blue-50 text-blue-700 border border-blue-300'
                : 'bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-zinc-200'
            }`}
            title={`Transmitir In-Ear WiFi a celulares para ensayos (${connections} conectados)`}
          >
            <Wifi size={14} />
            {broadcastEnabled && connections > 0 && (
              <span className="text-[10px] font-mono font-medium tabular-nums">{connections}</span>
            )}
          </button>
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
          <div className="px-5 py-4 border-b border-zinc-200 bg-white flex items-center justify-between">
            <h2 className="font-bold flex items-center text-zinc-900 text-xs uppercase tracking-wider">
              <LayoutList size={15} className="mr-2 text-[#e11d48]" /> Repertorio En Vivo
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] font-mono font-medium text-zinc-800 tabular-nums">
              {songs.length} {songs.length === 1 ? 'TEMA' : 'TEMAS'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
            {songs.map((s, idx) => {
              const hasMix = Boolean(s.foh_mix_url && s.cue_mix_url);
              const hasLyrics = Boolean(s.prompter_data?.lyrics?.length > 0);
              const isSelected = idx === currentSongIndex;

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
                ? Math.min(100, Math.max(0, ((currentTime + (getPreRoll(currentSong) || 0)) / totalDuration) * 100))
                : 0;

              return (
                <div
                  key={idx}
                  onClick={() => setCurrentSongIndex(idx)}
                  className={`group live-track-card ${themeClass} ${isSelected ? 'is-selected' : ''}`}
                >
                  {/* Barra de progreso inferior reactiva al audio en vivo */}
                  <div
                    className="live-track-progress"
                    style={{
                      width: isSelected
                        ? isPlaying
                          ? `${trackProgress}%`
                          : '100%'
                        : '0%',
                      opacity: isSelected ? 1 : 0,
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
                      ) : (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/90 text-emerald-800 border border-emerald-300 font-bold uppercase tracking-wide flex items-center gap-1 shadow-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Mix OK
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
            <button
              onClick={prevSong}
              disabled={currentSongIndex === 0}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-700 hover:text-black transition-all disabled:opacity-30"
              title="Canción Anterior"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={stop}
              disabled={!currentSong}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-700 hover:text-black transition-all disabled:opacity-30"
              title="Detener y volver al Conteo Pre-Roll"
            >
              <Square size={16} fill="currentColor" />
            </button>
            <button
              onClick={nextSong}
              disabled={currentSongIndex === songs.length - 1}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-700 hover:text-black transition-all disabled:opacity-30"
              title="Siguiente Canción"
            >
              <SkipForward size={18} />
            </button>

            <button
              onClick={isPlaying ? pause : play}
              disabled={isLoading || !currentSong || !currentSong.foh_mix_url}
              className={`col-span-3 py-3.5 rounded-2xl flex items-center justify-center text-xs font-semibold transition-all tracking-widest uppercase border ${
                isPlaying
                  ? 'bg-black text-white border-black hover:bg-zinc-800'
                  : 'ruby-pill-accent text-white border-transparent hover:brightness-105 active:scale-[0.98]'
              } disabled:opacity-30`}
            >
              {isPlaying ? (
                <Pause size={19} fill="currentColor" className="mr-2" />
              ) : (
                <Play size={19} fill="currentColor" className="mr-2 ml-0.5" />
              )}
              {isPlaying ? 'PAUSAR SHOW' : 'LANZAR CANCIÓN'}
            </button>
          </div>
        </div>

        {/* ÁREA PRINCIPAL DE PROYECCIÓN Y MONITOREO EN VIVO */}
        <div className="flex-1 bg-white flex flex-col relative overflow-hidden">
          {/* Barra Superior del Escenario: Salto Rápido de Secciones + Selector de Vista + Proyector HDMI */}
          <div className="h-14 bg-white border-b border-zinc-200 px-6 flex items-center justify-between gap-4 z-30 shrink-0">
            {/* Botonera de Salto Rápido a Secciones */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mr-1 shrink-0">
                Secciones:
              </span>
              {songSections.length === 0 ? (
                <span className="text-[11px] text-zinc-500 italic">Sin marcadores configurados</span>
              ) : (
                songSections.map((sec: any, sIdx: number) => {
                  const nextSec = songSections[sIdx + 1];
                  const secEnd = nextSec ? nextSec.time : totalDuration;
                  const isSecActive = currentTime >= sec.time && currentTime < secEnd;
                  const secStyle = getSectionSolidStyle(sec.name || sec.section || '');
                  return (
                    <button
                      key={sIdx}
                      onClick={() => seekTo(sec.time)}
                      className={`px-3 py-1 rounded-full text-[10.5px] uppercase tracking-wider transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                        isSecActive
                          ? `${secStyle.bg} text-white font-bold shadow-xs ring-2 ring-black`
                          : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-200 font-semibold'
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
            <div className="flex items-center gap-3 shrink-0">
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
                        currentTime={currentTime}
                        lyrics={currentSong.prompter_data?.lyrics || []}
                        isPlaying={isPlaying}
                        settings={currentSong.prompter_data?.lyric_settings}
                        bpm={currentSong.prompter_data?.bpm || 120}
                        firstBeatOffset={currentSong.prompter_data?.firstBeatOffset || 0}
                        beatTimes={currentSong.prompter_data?.beatTimes}
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
                        Esta pista no tiene proyección de lírica configurada en Lyric Studio. Puedes maximizar la vista de acordes para mayor comodidad en vivo.
                      </p>
                      <button
                        type="button"
                        onClick={() => setViewMode('prompter')}
                        className="mt-4 px-4 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
                      >
                        <Maximize2 size={13} />
                        <span>Maximizar a 'Solo Acordes'</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : viewMode === 'prompter' ? (
                <div className="h-full relative z-10 w-full rounded-2xl overflow-hidden border border-zinc-200 bg-white">
                  <Prompter
                    currentTime={currentTime}
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
                      currentTime={currentTime}
                      lyrics={currentSong.prompter_data?.lyrics || []}
                      isPlaying={isPlaying}
                      settings={currentSong.prompter_data?.lyric_settings}
                      bpm={currentSong.prompter_data?.bpm || 120}
                      firstBeatOffset={currentSong.prompter_data?.firstBeatOffset || 0}
                      beatTimes={currentSong.prompter_data?.beatTimes}
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
                        Esta pista no incluye letras sincronizadas. Cambia a la vista de acordes para seguir la progresión armónica.
                      </p>
                      <button
                        type="button"
                        onClick={() => setViewMode('prompter')}
                        className="mt-4 px-4 py-2 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
                      >
                        <Maximize2 size={13} />
                        <span>Ver Acordes del Show</span>
                      </button>
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
    </div>
  );
}
