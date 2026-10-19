import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Prompter } from '../components/Prompter';
import { LyricVisualizer } from '../components/LyricVisualizer';
import { Play, Pause, Square, SkipBack, SkipForward, Music, LayoutList, Wifi, Type, Columns, ExternalLink, Repeat, Volume2, Headphones } from 'lucide-react';
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
    <div className="h-screen stage-aurora-bg text-white flex flex-col font-sans overflow-hidden select-none relative">
      {/* Kapuha Tri-Tone Atmospheric Lighting (Blanco Luminous + Negro Intenso + Colores Rojo) */}
      {/* 1. Luminous White Zenith Light Beam */}
      <div className="pointer-events-none absolute -top-36 left-1/2 -translate-x-1/2 w-[840px] h-[320px] rounded-full bg-white/[0.12] blur-[115px] -z-0" />
      {/* 2. Kapuha Ruby Upper Atmospheric Flare */}
      <div className="pointer-events-none absolute -top-24 right-0 w-[620px] h-[620px] rounded-full bg-rose-500/[0.24] blur-[150px] -z-0" />
      {/* 3. Kapuha Coral Scarlet Lower Stage Bloom */}
      <div className="pointer-events-none absolute -bottom-36 left-0 w-[680px] h-[580px] rounded-full bg-rose-600/[0.20] blur-[160px] -z-0" />
      {/* 4. Center-Stage Atmospheric Ruby Pulse */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[380px] rounded-full bg-rose-500/[0.08] blur-[140px] -z-0" />

      {/* HEADER / CONSOLA MAESTRA FLOTANTE DE ESCENARIO (Apple Liquid Glass) */}
      <header className="h-[90px] px-6 py-2.5 flex items-center justify-between shrink-0 z-20 gap-4 bg-[#05070c]/85 backdrop-blur-3xl border-b border-white/10 shadow-[0_16px_45px_rgba(0,0,0,0.7)]">
        {/* ISLA 1: Identidad del Show, Setlist & Modo */}
        <div className="apple-glass-island p-1.5 rounded-full flex items-center gap-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)] shrink-0">
          {/* Live Stage Badge with soft breathing glow */}
          <div className="ruby-pill-accent text-white font-semibold px-3.5 py-1.5 rounded-full uppercase tracking-[0.14em] text-[10.5px] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse shadow-[0_0_8px_#fff]" />
            LIVE STAGE
          </div>

          {/* Setlist Selector */}
          <div className="relative">
            <select
              className="bg-transparent hover:bg-white/[0.05] focus:bg-[#12151e] text-zinc-200 px-3 py-1.5 rounded-full outline-none font-medium text-xs transition-all cursor-pointer max-w-[190px] border border-transparent focus:border-white/15"
              value={selectedSetlistId || ''}
              onChange={(e) => setSelectedSetlistId(e.target.value)}
            >
              <option value="" className="bg-[#0d0f14]">Cargar Setlist...</option>
              {setlists.map(sl => (
                <option key={sl.id} value={sl.id} className="bg-[#0d0f14]">{sl.title}</option>
              ))}
            </select>
          </div>

          {/* Mode Toggle Pill */}
          <div
            onClick={() => {
              if (isPlaying) return;
              setPlaybackMode(prev => prev === 'LIVE' ? 'REHEARSAL' : 'LIVE');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all cursor-pointer text-[10px] font-medium uppercase tracking-wider ${
              playbackMode === 'LIVE'
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.2)]'
                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
            } ${isPlaying ? 'opacity-40 cursor-not-allowed' : 'hover:scale-[1.02]'}`}
            title={playbackMode === 'LIVE' ? "Modo Concierto En Vivo (Audio WAV de Consola)" : "Modo Práctica / Ensayo (Audio Ligero MP3)"}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${playbackMode === 'LIVE' ? 'bg-rose-400 shadow-[0_0_6px_#f43f5e]' : 'bg-amber-400'}`} />
            <span>{playbackMode === 'LIVE' ? 'CONSOLA VIVO' : 'MODO PRÁCTICA'}</span>
          </div>
        </div>

        {/* ISLA 2: Reloj Digital de Titanio, Título & Scrubber de Escenario */}
        <div className="apple-glass-island px-5 py-2 rounded-2xl flex flex-col items-center flex-1 max-w-[560px] shadow-[0_8px_32px_rgba(0,0,0,0.55)]">
          <div className="w-full flex items-center justify-between mb-1.5 px-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13.5px] font-semibold text-white truncate max-w-[210px] tracking-tight drop-shadow-sm">
                {currentSong ? currentSong.title : 'Sin canción activa'}
              </span>
              {currentSong?.prompter_data?.key && (
                <span className="kapuha-contrast-pill text-[10px] font-mono px-2.5 py-0.5 rounded-full">
                  {currentSong.prompter_data.key}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-3xl leading-none font-mono font-extralight text-white tracking-tight tabular-nums drop-shadow-[0_0_20px_rgba(255,255,255,0.6)]">
                {formatTime(currentTime)}
              </span>
              {currentSong?.prompter_data?.bpm && (
                <span className="text-[10.5px] font-mono font-medium px-2.5 py-0.5 rounded-full bg-white/[0.08] text-zinc-200 border border-white/20 shadow-inner tabular-nums">
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
                  ? `linear-gradient(to right, #f43f5e ${((currentTime + getPreRoll(currentSong)) / totalDuration) * 100}%, rgba(255,255,255,0.08) ${((currentTime + getPreRoll(currentSong)) / totalDuration) * 100}%)`
                  : 'rgba(255,255,255,0.08)'
              }}
            />
            {totalDuration > 0 && (
              <span className="text-[10px] font-mono font-normal text-zinc-400 shrink-0 tabular-nums">
                {formatTime(Math.max(0, totalDuration - (getPreRoll(currentSong) || 0))).slice(0, 5)}
              </span>
            )}
          </div>
        </div>

        {/* ISLA 3: Rack de Audio, Faders Táctiles Duales e In-Ear */}
        <div className="apple-glass-island px-4 py-2 rounded-2xl flex items-center gap-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)] shrink-0">
          {/* Fader Público FOH (R) */}
          <div className="flex flex-col w-26">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-rose-400 font-medium uppercase tracking-wider flex items-center gap-1">
                <Volume2 size={11} /> PÚBLICO (R)
              </span>
              <span className="text-[10.5px] font-mono font-normal text-zinc-200 tabular-nums">{Math.round(fohVolume * 100)}%</span>
            </div>
            <input
              type="range" min="0" max="1.3" step="0.01"
              value={fohVolume}
              onChange={(e) => setFohVolume(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #f43f5e ${(fohVolume / 1.3) * 100}%, rgba(255,255,255,0.08) ${(fohVolume / 1.3) * 100}%)`
              }}
              title="Volumen hacia Consola Principal / Público (Canal Derecho R)"
            />
          </div>

          <div className="w-px h-7 bg-white/[0.08]" />

          {/* Fader Músicos CUE (L) */}
          <div className="flex flex-col w-26">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-amber-400 font-medium uppercase tracking-wider flex items-center gap-1">
                <Headphones size={11} /> MÚSICOS (L)
              </span>
              <button
                type="button"
                onClick={() => setMuteCueEmergency(v => !v)}
                className={`text-[9.5px] font-mono font-medium px-1.5 py-0.5 rounded-md transition-all tabular-nums ${
                  muteCueEmergency
                    ? 'bg-rose-500 text-white shadow-[0_0_10px_rgba(244,63,94,0.6)]'
                    : 'bg-white/[0.06] text-zinc-300 hover:text-white'
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
                background: `linear-gradient(to right, #fbbf24 ${(((muteCueEmergency ? 0 : cueVolume) / 1.3) * 100)}%, rgba(255,255,255,0.08) ${(((muteCueEmergency ? 0 : cueVolume) / 1.3) * 100)}%)`
              }}
              title="Volumen de Click y Voz Guía hacia Consola de Músicos (Canal Izquierdo L)"
            />
          </div>

          <div className="w-px h-7 bg-white/[0.08]" />

          {/* Selector de Ruteo Físico */}
          <div className="flex flex-col">
            <span className="text-[8px] text-zinc-500 font-medium uppercase tracking-wider">Ruteo</span>
            <select
              className="bg-transparent text-[11px] font-medium outline-none text-zinc-300 cursor-pointer hover:text-white"
              value={routingMode}
              onChange={(e) => setRoutingMode(e.target.value as 'StereoSplit' | 'MultiChannel')}
            >
              <option value="StereoSplit" className="bg-[#0d0f14]">Stereo Split</option>
              <option value="MultiChannel" className="bg-[#0d0f14]">USB Multi</option>
            </select>
          </div>

          {/* In-Ear Sync Beacon */}
          <button
            type="button"
            onClick={() => setBroadcastEnabled(!broadcastEnabled)}
            className={`p-2 rounded-xl transition-all flex items-center gap-1.5 ${
              broadcastEnabled
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/35 shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                : 'bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.08]'
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

        {/* SETLIST SIDEBAR (Kapuha Media Cards + Floating Glass) */}
        <div className="w-84 bg-[#05070c]/90 backdrop-blur-3xl border-r border-white/10 flex flex-col z-10 shrink-0 shadow-[14px_0_40px_rgba(0,0,0,0.65)]">
          <div className="px-5 py-4 border-b border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent flex items-center justify-between">
            <h2 className="font-semibold flex items-center text-white text-xs uppercase tracking-wider">
              <LayoutList size={15} className="mr-2 text-rose-500" /> Repertorio En Vivo
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-white/[0.08] border border-white/15 text-[10px] font-mono font-medium text-zinc-200 tabular-nums">
              {songs.length} {songs.length === 1 ? 'TEMA' : 'TEMAS'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
            {songs.map((s, idx) => {
              const hasMix = Boolean(s.foh_mix_url && s.cue_mix_url);
              const hasLyrics = Boolean(s.prompter_data?.lyrics?.length > 0);
              const isSelected = idx === currentSongIndex;
              return (
                <div
                  key={idx}
                  onClick={() => setCurrentSongIndex(idx)}
                  className={`group p-3 rounded-2xl flex items-center cursor-pointer transition-all duration-200 ${
                    isSelected
                      ? 'hero-card-active'
                      : 'apple-glass-card hover:bg-white/[0.06]'
                  }`}
                >
                  {/* Index Badge or Animated Equalizer Bars (Kapuha Music Style) */}
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-mono tabular-nums mr-3.5 shrink-0 transition-all ${
                      isSelected
                        ? 'ruby-pill-accent text-white font-bold'
                        : 'bg-white/[0.06] text-zinc-300 font-medium group-hover:text-white group-hover:bg-white/10'
                    }`}
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
                      <p className={`truncate text-[13.5px] tracking-tight ${isSelected ? 'text-white font-bold drop-shadow-sm' : 'text-zinc-100 font-medium group-hover:text-white'}`}>
                        {s.title}
                      </p>
                      {s.prompter_data?.key && (
                        <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full shrink-0 ${isSelected ? 'kapuha-contrast-pill' : 'bg-white/10 text-white border border-white/15'}`}>
                          {s.prompter_data.key}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {!hasMix ? (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 font-medium uppercase tracking-wider">
                          Sin Mix
                        </span>
                      ) : (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium uppercase tracking-wide flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" /> Mix OK
                        </span>
                      )}
                      {hasLyrics && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-white/10 text-white border border-white/20 font-medium uppercase tracking-wide">
                          Lyrics
                        </span>
                      )}
                      {s.prompter_data?.bpm && (
                        <span className="text-[9.5px] font-mono font-medium text-zinc-300 tabular-nums">
                          {Math.round(s.prompter_data.bpm)} BPM
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {songs.length === 0 && (
              <div className="text-center text-[#64748b] py-14 px-6 text-xs font-normal bg-white/[0.01] rounded-2xl border border-dashed border-white/[0.06]">
                Selecciona un Setlist en la barra superior para cargar las canciones del show.
              </div>
            )}
          </div>

          {/* CONTROLES DE TRANSPORTE DE ESCENARIO (Apple Tactile Pod) */}
          <div className="p-4 bg-[#0a0c12]/90 border-t border-white/[0.05] grid grid-cols-3 gap-2.5">
            <button
              onClick={prevSong}
              disabled={currentSongIndex === 0}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-300 hover:text-white transition-all disabled:opacity-30"
              title="Canción Anterior"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={stop}
              disabled={!currentSong}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-300 hover:text-white transition-all disabled:opacity-30"
              title="Detener y volver al Conteo Pre-Roll"
            >
              <Square size={16} fill="currentColor" />
            </button>
            <button
              onClick={nextSong}
              disabled={currentSongIndex === songs.length - 1}
              className="stage-tactile-btn py-3 rounded-xl flex items-center justify-center text-zinc-300 hover:text-white transition-all disabled:opacity-30"
              title="Siguiente Canción"
            >
              <SkipForward size={18} />
            </button>

            <button
              onClick={isPlaying ? pause : play}
              disabled={isLoading || !currentSong || !currentSong.foh_mix_url}
              className={`col-span-3 py-3.5 rounded-2xl flex items-center justify-center text-xs font-semibold transition-all tracking-widest uppercase border ${
                isPlaying
                  ? 'bg-white text-zinc-950 border-white shadow-[0_0_32px_rgba(255,255,255,0.45)] hover:bg-zinc-100'
                  : 'ruby-pill-accent text-white border-white/20 hover:brightness-110 active:scale-[0.98]'
              } disabled:opacity-30 disabled:shadow-none`}
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
        <div className="flex-1 bg-[#06070a]/60 flex flex-col relative overflow-hidden backdrop-blur-md">
          {/* Barra Superior del Escenario: Salto Rápido de Secciones + Selector de Vista + Proyector HDMI */}
          <div className="h-14 bg-[#0a0c12]/75 backdrop-blur-2xl border-b border-white/[0.05] px-6 flex items-center justify-between gap-4 z-30 shrink-0">
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
                  return (
                    <button
                      key={sIdx}
                      onClick={() => seekTo(sec.time)}
                      className={`px-3 py-1 rounded-full text-[10.5px] uppercase tracking-wider transition-all shrink-0 ${
                        isSecActive
                          ? 'amber-pill-accent text-zinc-950 font-semibold'
                          : 'apple-glass-card text-zinc-300 font-medium hover:text-white'
                      }`}
                      title={`Saltar a ${sec.name || sec.section}`}
                    >
                      {sec.name || sec.section}
                    </button>
                  );
                })
              )}
              {isVamping && (
                <button
                  onClick={() => handleToggleVampSection(0, 0)}
                  className="px-3 py-1 rounded-full text-[10px] font-semibold uppercase ruby-pill-accent text-white animate-pulse flex items-center gap-1 shrink-0 ml-1"
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
                className="apple-glass-card px-3.5 py-1.5 rounded-full text-zinc-200 hover:text-white text-[11px] font-medium uppercase tracking-wide flex items-center gap-1.5 transition-all hover:border-rose-500/40"
                title="Abrir ventana limpia de Proyección de Letras para arrastrar a pantalla LED / HDMI externo"
              >
                <ExternalLink size={12} className="text-rose-400" />
                <span>Proyector HDMI</span>
              </button>
            </div>
          </div>

          <div className="flex-1 p-4 overflow-hidden flex flex-col relative">
            {currentSong ? (
              viewMode === 'dual' ? (
                <div className="h-full w-full flex flex-col gap-3.5 overflow-hidden">
                  {/* Mitad Superior: Grilla de Compases, Acordes y Voz Guía */}
                  <div className="h-[46%] w-full rounded-3xl overflow-hidden border border-white/[0.06] shadow-[0_16px_40px_rgba(0,0,0,0.7)] bg-[#080a0f]/90">
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
                  {/* Mitad Inferior: Proyección de Letras al Compás y Tiempo Exacto */}
                  <div className="flex-1 w-full rounded-3xl overflow-hidden border border-white/[0.06] shadow-[0_20px_50px_rgba(0,0,0,0.8)] bg-black/90 relative">
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
                </div>
              ) : viewMode === 'prompter' ? (
                <div className="h-full relative z-10 w-full rounded-3xl overflow-hidden border border-white/[0.06] shadow-[0_20px_50px_rgba(0,0,0,0.7)] bg-[#080a0f]/90">
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
                <div className="h-full relative z-10 w-full rounded-2xl overflow-hidden border border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,0.75)] bg-black">
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
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center relative overflow-hidden rounded-3xl border border-white/[0.05] bg-gradient-to-b from-[#0b0d14] to-[#07080c]">
                <div className="pointer-events-none absolute w-[420px] h-[420px] rounded-full border border-white/[0.03]" />
                <div className="pointer-events-none absolute w-[280px] h-[280px] rounded-full border border-[#ef4444]/10" />
                <div className="w-16 h-16 rounded-2xl bg-[#131620] border border-white/10 flex items-center justify-center mb-4 shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
                  <Music size={28} className="text-[#ef4444]" />
                </div>
                <span className="text-zinc-300 text-lg font-black tracking-[0.35em] uppercase">
                  CONSOLA EN ESPERA DE SETLIST
                </span>
                <span className="text-[#64748b] text-xs mt-2 font-medium">
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
