import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Prompter } from '../components/Prompter';
import { LyricVisualizer } from '../components/LyricVisualizer';
import { Play, Pause, Square, SkipBack, SkipForward, MonitorSpeaker, Music, LayoutList, Wifi, Users, Type } from 'lucide-react';
import { useSyncMaster } from '../hooks/useSyncMaster';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function LiveConcert() {
  const [setlists, setSetlists] = useState<any[]>([]);
  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'prompter' | 'lyrics'>('prompter');
  
  const [songs, setSongs] = useState<any[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(0);
  const currentSong = songs[currentSongIndex] || null;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [routingMode, setRoutingMode] = useState<'StereoSplit' | 'MultiChannel'>('StereoSplit');
  const [masterVolume, setMasterVolume] = useState<number>(1.0);
  const [playbackMode, setPlaybackMode] = useState<'LIVE' | 'REHEARSAL'>('LIVE');
  const playbackModeRef = useRef<'LIVE' | 'REHEARSAL'>('LIVE');
  useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);

  // Network Sync
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

  // 🎯 Pre-carga silenciosa de la SIGUIENTE canción
  const nextFohBufferRef = useRef<AudioBuffer | null>(null);
  const nextCueBufferRef = useRef<AudioBuffer | null>(null);
  const isPrefetchingRef = useRef(false);
  // Bandera para auto-play: cuando loadSongAudio termina y esta flag es true, arranca play automático
  const autoPlayOnLoadRef = useRef(false);
  // Ref estable de songs para evitar stale closures en callbacks async
  const songsRef = useRef<any[]>([]);
  const currentSongIndexRef = useRef<number>(0);


  useEffect(() => {
    fetchSetlists();
    
    // Initialize AudioContext on user interaction/mount
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtxRef.current = new AudioContextClass();
    
    return () => {
      pause();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (selectedSetlistId) {
      fetchSetlistSongs(selectedSetlistId);
    } else {
      setSongs([]);
      setCurrentSongIndex(0);
    }
  }, [selectedSetlistId]);

  // Mantener refs estables para evitar stale closures en callbacks async
  useEffect(() => { songsRef.current = songs; }, [songs]);
  useEffect(() => { currentSongIndexRef.current = currentSongIndex; }, [currentSongIndex]);

  // When song index changes, load the audio automatically
  useEffect(() => {
    if (currentSong) {
      // Si venimos de un auto-avance, arrancar play automáticamente al terminar la carga
      loadSongAudio(currentSong, autoPlayOnLoadRef.current);
      autoPlayOnLoadRef.current = false; // resetear bandera
    }
  }, [currentSongIndex, currentSong, broadcastEnabled]);


  useEffect(() => {
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setTargetAtTime(masterVolume, audioCtxRef.current.currentTime, 0.05);
    }
  }, [masterVolume]);

  const fetchSetlists = async () => {
    const { data } = await supabase.from('setlists').select('*').eq('band_id', FAKE_BAND_ID).order('created_at', { ascending: false });
    if (data) setSetlists(data);
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
      setCurrentSongIndex(0); // reset to first song
    }
  };

  const loadSongAudio = async (song: any, shouldAutoPlay = false) => {
    if (!audioCtxRef.current) return;
    
    // Stop current playback
    pause();
    setCurrentTime(-getPreRoll(song)); // Reset clock
    pauseTimeRef.current = 0;
    
    // ✅ Si la siguiente canción ya fue pre-cargada silenciosamente, usar esos buffers directamente
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
       setLoadStatus('Error: Faltan archivos exportados para esta canción en este modo.');
       return;
    }

    setIsLoading(true);
    setLoadStatus(mode === 'REHEARSAL' ? 'Descargando FOH Ligero (MP3)...' : 'Descargando FOH Mix...');
    
    try {
      // Load FOH
      const fohRes = await fetch(targetFohUrl);
      const fohArray = await fohRes.arrayBuffer();
      setLoadStatus(mode === 'REHEARSAL' ? 'Decodificando FOH Ligero...' : 'Decodificando FOH Mix...');
      fohBufferRef.current = await audioCtxRef.current.decodeAudioData(fohArray);
      
      // Load CUE
      setLoadStatus(mode === 'REHEARSAL' ? 'Descargando CUE Ligero (MP3)...' : 'Descargando CUE Mix...');
      const cueRes = await fetch(targetCueUrl);
      const cueArray = await cueRes.arrayBuffer();
      setLoadStatus(mode === 'REHEARSAL' ? 'Decodificando CUE Ligero...' : 'Decodificando CUE Mix...');
      cueBufferRef.current = await audioCtxRef.current.decodeAudioData(cueArray);
      
      setTotalDuration(fohBufferRef.current.duration);
      setLoadStatus('');
      
      if (broadcastEnabled) {
        broadcast({ type: 'LOAD_SONG', songId: song.id, songData: song });
      }

      // Auto-play si es un avance automático tras fin de canción
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

  /** Pre-carga silenciosa del siguiente track en RAM para transición instantánea */
  const prefetchNextSong = async (nextSong: any) => {
    if (!audioCtxRef.current || isPrefetchingRef.current) return;
    const mode = playbackModeRef.current;
    const targetFohUrl = mode === 'REHEARSAL' && nextSong.foh_mobile_url ? nextSong.foh_mobile_url : nextSong.foh_mix_url;
    const targetCueUrl = mode === 'REHEARSAL' && nextSong.cue_mobile_url ? nextSong.cue_mobile_url : nextSong.cue_mix_url;

    if (!targetFohUrl || !targetCueUrl) return;

    isPrefetchingRef.current = true;
    console.log('[LiveConcert] 🔄 Pre-cargando silenciosamente:', nextSong.title);

    try {
      const [fohRes, cueRes] = await Promise.all([
        fetch(targetFohUrl),
        fetch(targetCueUrl),
      ]);
      const [fohArray, cueArray] = await Promise.all([
        fohRes.arrayBuffer(),
        cueRes.arrayBuffer(),
      ]);
      // Sólo guardar si el AudioContext sigue vivo
      if (!audioCtxRef.current) return;
      const [fohBuf, cueBuf] = await Promise.all([
        audioCtxRef.current.decodeAudioData(fohArray),
        audioCtxRef.current.decodeAudioData(cueArray),
      ]);
      nextFohBufferRef.current = fohBuf;
      nextCueBufferRef.current = cueBuf;
      console.log('[LiveConcert] ✅ Pre-carga silenciosa completada:', nextSong.title);
    } catch (e) {
      console.warn('[LiveConcert] ⚠️ Error en pre-carga silenciosa:', e);
      nextFohBufferRef.current = null;
      nextCueBufferRef.current = null;
    } finally {
      isPrefetchingRef.current = false;
    }
  };

  const getPreRoll = (song: any) => {
    if (!song?.prompter_data?.bpm) return 0;
    const beatsPerMeasure = parseInt(song.prompter_data.timeSignature?.split('/')[0]) || 4;
    // 🛡️ Tope máximo de 16 segundos para evitar pre-rolls gigantes por tempo dividido
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
    cueGainRef.current = ctx.createGain();

    if (actualRoutingMode === 'StereoSplit') {
      // Stereo Split: CUE to Left (-1), FOH to Right (1)
      fohPannerRef.current = ctx.createStereoPanner();
      fohPannerRef.current.pan.value = 1; // FOH to Right
      fohGainRef.current.connect(fohPannerRef.current);
      fohPannerRef.current.connect(masterGainRef.current);

      cuePannerRef.current = ctx.createStereoPanner();
      cuePannerRef.current.pan.value = -1; // CUE to Left
      cueGainRef.current.connect(cuePannerRef.current);
      cuePannerRef.current.connect(masterGainRef.current);
    } else if (actualRoutingMode === 'MultiChannel' && mergerRef.current) {
      // FOH to Ch 0 & 1 (Stereo)
      fohGainRef.current.connect(mergerRef.current, 0, 0); // L -> 0
      fohGainRef.current.connect(mergerRef.current, 0, 1); // R -> 1
      
      // CUE to Ch 2
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
    
    const delayMs = 300; // Network propagation buffer
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

    // 🎯 Pre-carga silenciosa de la siguiente canción cuando quedan ~30 seg
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

    // 🏁 Fin de canción: auto-avance al siguiente track con reproducción automática
    if (totalDuration > 0 && globalTime >= totalDuration) {
      pause();
      const idx = currentSongIndexRef.current;
      const allSongs = songsRef.current;
      if (idx < allSongs.length - 1) {
        // Marcar que al terminar la carga debe arrancar play
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
      setTimeout(() => play(), 50);
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

  return (
    <div className="h-screen bg-[#050505] text-white flex flex-col font-sans overflow-hidden select-none">
      
      {/* HEADER / TRANSPORT */}
      <header className="h-[90px] bg-[#09090b]/90 backdrop-blur-xl border-b border-white/5 flex items-center px-8 justify-between shrink-0 z-20">
        <div className="flex items-center space-x-6">
          <div className="bg-gradient-to-br from-red-600 to-red-800 text-white font-black px-4 py-2 rounded-xl uppercase tracking-[0.2em] text-xs shadow-[0_0_20px_rgba(220,38,38,0.2)] flex items-center gap-2 border border-red-500/20">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse shadow-[0_0_8px_white]"></span>
            CONCERT LIVE
          </div>
          <div className="relative">
            <select 
              className="appearance-none bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 text-white px-5 py-2.5 pr-10 rounded-xl outline-none font-bold text-sm transition-colors cursor-pointer"
              value={selectedSetlistId || ''}
              onChange={(e) => setSelectedSetlistId(e.target.value)}
            >
              <option value="" className="bg-[#111]">Cargar Setlist...</option>
              {setlists.map(sl => (
                <option key={sl.id} value={sl.id} className="bg-[#111]">{sl.title}</option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
              ▼
            </div>
          </div>
          
          {/* Selector de Modo */}
          <div 
            onClick={() => {
              if (isPlaying) return; // No permitir cambio en plena reproducción
              setPlaybackMode(prev => prev === 'LIVE' ? 'REHEARSAL' : 'LIVE');
            }}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl border transition-all cursor-pointer ${
              playbackMode === 'LIVE' 
                ? 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20' 
                : 'bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20'
            } ${isPlaying ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={isPlaying ? "No se puede cambiar el modo mientras se reproduce" : "Cambiar entre alta calidad (WAV) y modo ligero (MP3)"}
          >
            <div className={`w-2 h-2 rounded-full ${playbackMode === 'LIVE' ? 'bg-red-500' : 'bg-yellow-500'}`}></div>
            <span className={`text-xs font-bold uppercase tracking-wider ${playbackMode === 'LIVE' ? 'text-red-400' : 'text-yellow-400'}`}>
              {playbackMode === 'LIVE' ? 'EN VIVO' : 'ENSAYO'}
            </span>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="flex flex-col items-center flex-1 max-w-[800px] px-10">
          <div className="flex items-baseline space-x-2 mb-1.5">
            <span className="text-[40px] leading-none font-mono font-bold text-white tracking-widest drop-shadow-md">
              {formatTime(currentTime)}
            </span>
          </div>
          
          <div className="w-full flex items-center space-x-3 group">
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
              className="flex-1 h-2 bg-[#222] rounded-full appearance-none cursor-pointer disabled:opacity-30 group-hover:h-3 transition-all duration-200"
              style={{
                background: currentSong && totalDuration > 0
                  ? `linear-gradient(to right, #ef4444 ${((currentTime + getPreRoll(currentSong)) / totalDuration) * 100}%, rgba(255,255,255,0.05) ${((currentTime + getPreRoll(currentSong)) / totalDuration) * 100}%)`
                  : 'rgba(255,255,255,0.05)'
              }}
            />
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Network Broadcast Toggle */}
          <div 
            onClick={() => setBroadcastEnabled(!broadcastEnabled)}
            className={`pressable flex items-center space-x-3 px-4 py-2.5 rounded-xl border transition-all duration-300 cursor-pointer ${
              broadcastEnabled 
                ? 'bg-blue-600/10 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
            }`}
          >
            <div className={`p-2 rounded-lg ${broadcastEnabled ? 'bg-blue-500/20' : 'bg-white/5'}`}>
              <Wifi size={18} className={broadcastEnabled ? 'text-blue-400' : 'text-gray-400'} />
            </div>
            <div className="flex flex-col">
              <span className={`text-[9px] font-bold uppercase tracking-widest ${broadcastEnabled ? 'text-blue-400' : 'text-gray-500'}`}>
                In-Ears Móviles
              </span>
              <span className="text-sm font-semibold text-gray-200">
                {broadcastEnabled ? 'Transmitiendo' : 'Desactivado'}
              </span>
            </div>
            {broadcastEnabled && (
              <div className="flex items-center ml-2 text-[10px] font-bold bg-blue-500/20 text-blue-300 px-2.5 py-1 rounded-full border border-blue-500/20">
                <Users size={12} className="mr-1.5" /> {connections}
              </div>
            )}
          </div>

           {/* Routing Mode */}
          <div className="flex items-center space-x-3 bg-white/[0.02] hover:bg-white/[0.04] px-4 py-2.5 rounded-xl border border-white/10 transition-colors">
            <div className="p-2 bg-white/5 rounded-lg">
              <MonitorSpeaker size={18} className="text-gray-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">Modo Salida</span>
              <select 
                className="bg-transparent text-sm font-semibold outline-none text-gray-200 appearance-none cursor-pointer"
                value={routingMode}
                onChange={(e) => setRoutingMode(e.target.value as 'StereoSplit' | 'MultiChannel')}
              >
                <option value="StereoSplit" className="bg-[#111]">Stereo Split (L:Cues R:FOH)</option>
                <option value="MultiChannel" className="bg-[#111]">Interfaz USB (Multi)</option>
              </select>
            </div>
          </div>
          
          {/* Master Volume */}
          <div className="flex items-center space-x-3 bg-white/[0.02] px-4 py-2.5 rounded-xl border border-white/10 w-44">
            <div className="flex flex-col w-full">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">Master</span>
                <span className="text-[10px] font-bold text-gray-300">{Math.round(masterVolume * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="0" max="1.5" step="0.01" 
                value={masterVolume} 
                onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer hover:h-2 transition-all"
              />
            </div>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/80 z-40 flex flex-col items-center justify-center backdrop-blur-xl">
            <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <h2 className="text-xl font-bold text-white mb-2 tracking-tight">{currentSong?.title}</h2>
            <p className="text-gray-400 font-mono text-sm uppercase tracking-widest">{loadStatus}</p>
          </div>
        )}

        {/* SETLIST SIDEBAR */}
        <div className="w-80 bg-[#09090b]/80 backdrop-blur-md border-r border-white/5 flex flex-col z-10">
          <div className="px-6 py-5 border-b border-white/5 bg-white/[0.02]">
            <h2 className="font-bold flex items-center text-gray-200 text-sm uppercase tracking-widest">
              <LayoutList size={16} className="mr-3 text-red-500" /> Setlist Oficial
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
            {songs.map((s, idx) => (
              <div 
                key={idx}
                onClick={() => setCurrentSongIndex(idx)}
                className={`pressable p-3 rounded-xl flex items-center cursor-pointer transition-all duration-300 ${
                  idx === currentSongIndex 
                    ? 'bg-gradient-to-r from-red-600/20 to-red-900/10 border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]' 
                    : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04] hover:border-white/5'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold mr-3 shrink-0 ${idx === currentSongIndex ? 'bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-white/5 text-gray-500'}`}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold truncate text-[14px] ${idx === currentSongIndex ? 'text-white' : 'text-gray-300'}`}>{s.title}</p>
                  {(!s.foh_mix_url || !s.cue_mix_url) && <p className="text-[9px] text-red-400/80 font-bold uppercase mt-1 tracking-wider">Audio No Disponible</p>}
                </div>
                {idx === currentSongIndex && isPlaying && <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_red] animate-pulse ml-2 shrink-0"></div>}
              </div>
            ))}
            {songs.length === 0 && (
              <div className="text-center text-gray-500 py-12 px-6 text-sm font-medium blur-transition">
                Selecciona un setlist arriba para comenzar.
              </div>
            )}
          </div>

          {/* LARGE TRANSPORT BUTTONS */}
          <div className="p-5 bg-white/[0.02] border-t border-white/5 grid grid-cols-3 gap-3">
            <button onClick={prevSong} disabled={currentSongIndex === 0} className="pressable bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-xl flex items-center justify-center py-4 transition-colors">
              <SkipBack size={22} className="text-gray-300" />
            </button>
            <button onClick={stop} disabled={!currentSong} className="pressable bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-xl flex items-center justify-center py-4 transition-colors">
              <Square size={20} fill="currentColor" className="text-gray-400" />
            </button>
            <button onClick={nextSong} disabled={currentSongIndex === songs.length - 1} className="pressable bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-xl flex items-center justify-center py-4 transition-colors">
              <SkipForward size={22} className="text-gray-300" />
            </button>
            
            <button 
              onClick={isPlaying ? pause : play} 
              disabled={isLoading || !currentSong || !currentSong.foh_mix_url}
              className={`pressable col-span-3 py-5 rounded-xl flex items-center justify-center text-xl font-black transition-all duration-300 tracking-wider ${
                isPlaying 
                ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:bg-gray-100' 
                : 'bg-red-600 text-white hover:bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]'
              } disabled:opacity-30 disabled:shadow-none`}
            >
              {isPlaying ? <Pause size={28} fill="currentColor" className="mr-3" /> : <Play size={28} fill="currentColor" className="mr-3 ml-2" />}
              {isPlaying ? 'PAUSA' : 'REPRODUCIR'}
            </button>
          </div>
        </div>

        {/* PROMPTER AREA */}
        <div className="flex-1 bg-black flex flex-col relative overflow-hidden">
          
          {/* View Mode Toggle */}
          <div className="absolute top-6 right-8 z-30 flex space-x-2 bg-white/5 p-1 rounded-xl backdrop-blur-md border border-white/10">
            <button 
              onClick={() => setViewMode('prompter')}
              className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${viewMode === 'prompter' ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'text-gray-400 hover:text-white'}`}
            >
              <div className="flex items-center space-x-2">
                <Music size={14} />
                <span>Acordes</span>
              </div>
            </button>
            <button 
              onClick={() => setViewMode('lyrics')}
              className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${viewMode === 'lyrics' ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]' : 'text-gray-400 hover:text-white'}`}
            >
              <div className="flex items-center space-x-2">
                <Type size={14} />
                <span>Visuals (Live)</span>
              </div>
            </button>
          </div>

          <div className="flex-1 p-8 overflow-hidden flex flex-col relative">
            {/* Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-900/10 rounded-full blur-[120px] pointer-events-none opacity-50"></div>
            
            {/* Background Logo */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02]">
              <Music size={400} />
            </div>

            {currentSong ? (
              <div className="h-full relative z-10 w-full max-w-7xl mx-auto rounded-3xl overflow-hidden border border-white/5 shadow-2xl bg-[#09090b]/80 backdrop-blur-sm">
                {viewMode === 'prompter' ? (
                  <Prompter 
                    currentTime={currentTime}
                    bpm={currentSong.prompter_data?.bpm || 0}
                    timeSignature={currentSong.prompter_data?.timeSignature}
                    baseOffset={currentSong.prompter_data?.firstBeatOffset}
                    beatTimes={currentSong.prompter_data?.beatTimes}
                    chords={currentSong.prompter_data?.chords || []}
                    sections={currentSong.prompter_data?.sections || []}
                    isVamping={false}
                    isEditing={false}
                  />
                ) : (
                  <LyricVisualizer 
                    currentTime={currentTime}
                    lyrics={currentSong.prompter_data?.lyrics || []}
                    isPlaying={isPlaying}
                  />
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500/50 text-2xl font-bold tracking-[0.5em] blur-transition">
                EN ESPERA
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}


