import { useRef, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  generateClickBuffer,
  loadCueBuffers,
  resolveCueBufferName,
  scheduleSectionVoiceCues,
  buildShiftedBeatGrid
} from '../utils/cueEngine';
import { findMasterAndDrumStems, repairAndRelockBeatGrid } from '../utils/beatGridDSP';
import { loadLameJs } from '../utils/loadLameJs';

export type StemType = 'Click' | 'Cues' | 'Instrument';
export type RoutingMode = 'StereoInEar' | 'StereoSplit' | 'MultiChannel';

export interface StemTrack {
  id: string;
  name: string;
  type: StemType;
  url: string;
  volume: number; // 0.0 to 1.0
  pan: number; // -1.0 (L) to 1.0 (R)
  muted: boolean;
  solo: boolean;
  targetOutputChannel?: number; // Used in MultiChannel mode
}

export const useAudioEngine = (initialStems: StemTrack[]) => {
  const audioContext = useRef<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('StereoInEar');
  const [masterVolume, setMasterVolume] = useState<number>(1.0);
  const globalMasterGainNode = useRef<GainNode | null>(null);

  useEffect(() => {
    if (globalMasterGainNode.current && audioContext.current) {
      globalMasterGainNode.current.gain.setTargetAtTime(masterVolume, audioContext.current.currentTime, 0.05);
    }
  }, [masterVolume]);
  const [stems, setStems] = useState<StemTrack[]>(initialStems);
  const stemsRef = useRef<StemTrack[]>(initialStems);
  useEffect(() => {
    stemsRef.current = stems;
  }, [stems]);

  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0, currentFile: '' });
  const [totalDuration, setTotalDuration] = useState(0);
  const totalDurationRef = useRef<number>(0);
  useEffect(() => {
    totalDurationRef.current = totalDuration;
  }, [totalDuration]);
  
  const sourceNodes = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const gainNodes = useRef<Map<string, GainNode>>(new Map());
  const pannerNodes = useRef<Map<string, StereoPannerNode>>(new Map());
  const buffers = useRef<Map<string, AudioBuffer>>(new Map());

  // Limpiar RAM de canciones anteriores para evitar Out Of Memory
  useEffect(() => {
    const currentStemIds = new Set(stems.map(s => s.id));
    for (const id of buffers.current.keys()) {
      if (!currentStemIds.has(id)) {
        buffers.current.delete(id);
      }
    }
  }, [stems]);

  const splitterNode = useRef<ChannelSplitterNode | null>(null);
  const mergerNode = useRef<ChannelMergerNode | null>(null);

  const startTime = useRef<number>(0);
  const pauseTime = useRef<number>(0);
  const loopState = useRef<{ isLooping: boolean; start: number; end: number }>({ isLooping: false, start: 0, end: 0 });
  // Estado reactivo y referencia para la duración del Pre-Roll (Cuenta Regresiva de 2 compases)
  const [preRollEnabled, setPreRollEnabledState] = useState<boolean>(false);
  const preRollEnabledRef = useRef<boolean>(false);
  const [preRollDuration, setPreRollDurationState] = useState<number>(0);
  const preRollDurationRef = useRef(0);

  const computePreRollSeconds = useCallback((pd: any, enabled: boolean): number => {
    if (!enabled || !pd || !(Number(pd.bpm) > 0)) return 0;
    const beatsPerMeasure = parseInt(pd.timeSignature?.split('/')[0]) || 4;
    const secondsPerBeat = 60 / Number(pd.bpm);
    return Math.min(secondsPerBeat * beatsPerMeasure * 2, 16);
  }, []);
  
  // Referencias para programación en tiempo real
  const clickSources = useRef<AudioBufferSourceNode[]>([]);
  const clickHighBufferRef = useRef<AudioBuffer | null>(null);
  const clickLowBufferRef = useRef<AudioBuffer | null>(null);
  const cueSources = useRef<AudioBufferSourceNode[]>([]);
  const cueBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const cueOffsetsRef = useRef<Record<string, number>>({});
  
  // Referencias para el auto-play al buscar sin perder el estado en scrubbing continuo
  const prompterDataRef = useRef<any>(null);
  const manualGridOffsetRef = useRef<number>(0);
  const wasPlayingBeforeSeekRef = useRef<boolean>(false);
  
  const animationFrame = useRef<number>(0);
  const seekTimeoutRef = useRef<number | null>(null);

  // 1. Inicialización y Prevención de Desconexiones (Fail-Safe)
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioContext.current = new AudioContextClass();
    globalMasterGainNode.current = audioContext.current.createGain();
    globalMasterGainNode.current.gain.value = 1.0;
    globalMasterGainNode.current.connect(audioContext.current.destination);
    
    clickHighBufferRef.current = generateClickBuffer(audioContext.current, 1200);
    clickLowBufferRef.current = generateClickBuffer(audioContext.current, 800);
    
    const handleDeviceChange = async () => {
      console.warn("Hardware device change detected! Suspending audio to prevent bleeding.");
      if (audioContext.current?.state === 'running') {
        await audioContext.current.suspend();
        setIsPlaying(false);
        isPlayingRef.current = false;
        pauseTime.current = audioContext.current.currentTime - startTime.current;
      }
    };

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      cancelAnimationFrame(animationFrame.current);
      isPlayingRef.current = false;
      sourceNodes.current.forEach(src => { try { src.stop(); src.disconnect(); } catch {} });
      clickSources.current.forEach(src => { try { src.stop(); src.disconnect(); } catch {} });
      cueSources.current.forEach(src => { try { src.stop(); src.disconnect(); } catch {} });
      if (audioContext.current && audioContext.current.state !== 'closed') {
        try { audioContext.current.close(); } catch {}
      }
    };
  }, []);

  // 2. Cargar Buffers en Memoria
  const loadStems = async (_bpm: number, _gridOffsetTime: number = 0, _timeSignature: string = '4/4', _beatTimes: number[] = [], prompterData?: any, stemsToLoad?: StemTrack[]) => {
    if (!audioContext.current) return prompterData;
    
    // 🔑 FIX: Usar stemsToLoad si se pasa explícitamente (evita bug de closure de React
    // donde `stems` puede estar desactualizado cuando se llama loadStems justo después de setStems)
    const activeStemsArray = stemsToLoad ?? stems;
    
    console.log(`[AudioEngine] loadStems iniciado con ${activeStemsArray.length} pistas.`, activeStemsArray.map(s => s.name));
    
    // 🔥 FORZAR RESUME AQUÍ POR SI EL NAVEGADOR BLOQUEA EL DECODE
    if (audioContext.current.state === 'suspended') {
      try {
        await audioContext.current.resume();
        console.log('[AudioEngine] Contexto reanudado exitosamente antes de decodificar.');
      } catch (e) {
        console.warn('[AudioEngine] No se pudo reanudar el contexto:', e);
      }
    }
    
    setLoadProgress({ loaded: 0, total: activeStemsArray.length, currentFile: 'Iniciando descarga...' });
    let loadedCount = 0;
    let maxDuration = 0;

    for (const stem of activeStemsArray) {
      if (buffers.current.has(stem.id)) {
        const cachedBuf = buffers.current.get(stem.id);
        if (cachedBuf && cachedBuf.duration > maxDuration) {
          maxDuration = cachedBuf.duration;
        }
        loadedCount++;
        continue;
      }
      try {
        // Si es el metrónomo sintético o cues, no hacemos fetch
        if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
          loadedCount++;
          continue;
        }

        console.log(`[Cazador de Errores] Iniciando fetch para: ${stem.name}`, stem.url);
        const response = await fetch(stem.url);
        console.log(`[Cazador de Errores] Fetch HTTP Status para ${stem.name}:`, response.status);
        if (!response.ok) {
           alert(`Error HTTP al descargar ${stem.name}: ${response.status} ${response.statusText}`);
           throw new Error(`HTTP Error: ${response.status}`);
        }
        
        setLoadProgress({ loaded: loadedCount, total: activeStemsArray.length, currentFile: `Decodificando audio en RAM: ${stem.name}` });
        
        const arrayBuffer = await response.arrayBuffer();
        console.log(`[Cazador de Errores] ArrayBuffer descargado para ${stem.name}. Tamaño:`, arrayBuffer.byteLength);
        
        try {
          const audioBuffer = await audioContext.current.decodeAudioData(arrayBuffer);
          console.log(`[Cazador de Errores] Decodificación exitosa para ${stem.name}.`);
          buffers.current.set(stem.id, audioBuffer);
          if (audioBuffer.duration > maxDuration) {
            maxDuration = audioBuffer.duration;
          }
        } catch (decodeErr: any) {
          alert(`[ERROR CRÍTICO DE CODIFICACIÓN] El archivo ${stem.name} está corrupto o el navegador no lo soporta. Mensaje: ${decodeErr.message}`);
          console.error(`Error decodeAudioData para ${stem.name}:`, decodeErr);
          throw decodeErr;
        }
        
        loadedCount++;
        setLoadProgress({ loaded: loadedCount, total: activeStemsArray.length, currentFile: `Completado: ${stem.name}` });
      } catch (err: any) {
        console.error(`Error loading stem ${stem.name}:`, err);
        alert(`Fallo general al cargar ${stem.name}. Revisa la consola (F12). Error: ${err.message}`);
        throw err;
      }
    }
    
    // Si todos eran sintéticos pero ya había buffers en RAM, conservar la mayor duración existente
    if (maxDuration === 0 && buffers.current.size > 0) {
      buffers.current.forEach((buf) => {
        if (buf.duration > maxDuration) maxDuration = buf.duration;
      });
    }

    // --- AUTO-ADAPTACIÓN RÍTMICA Y RE-SINCRONIZACIÓN MULTI-ISLA (MASTER + DRUMS) ---
    if (prompterData && prompterData.beatTimes && prompterData.beatTimes.length > 0) {
      const hasAlreadyRepairedGrid = Array.isArray(prompterData.downbeats) && prompterData.downbeats.length > 0;
      if (!hasAlreadyRepairedGrid) {
        try {
          const { masterStem, drumStem } = findMasterAndDrumStems(activeStemsArray);
          const masterBuffer = masterStem ? buffers.current.get(masterStem.id) : null;
          const drumBuffer = drumStem ? buffers.current.get(drumStem.id) : null;
          const primaryBuffer = masterBuffer || drumBuffer;

          if (primaryBuffer) {
            setLoadProgress({
              loaded: activeStemsArray.length,
              total: activeStemsArray.length,
              currentFile: `Re-sincronizando silencios y transitorios con ${masterStem?.name || drumStem?.name || 'Master'}...`
            });
            const repaired = repairAndRelockBeatGrid({
              rawBeats: prompterData.beatTimes,
              rawDownbeats: prompterData.firstBeatOffset !== undefined ? [Number(prompterData.firstBeatOffset)] : [],
              rawBpm: Number(prompterData.bpm) || _bpm || 120,
              timeSignature: prompterData.timeSignature || _timeSignature || '4/4',
              masterBuffer: primaryBuffer,
              drumBuffer: masterBuffer && drumBuffer && drumStem?.id !== masterStem?.id ? drumBuffer : null,
              referenceTrackName: masterStem?.name || drumStem?.name || 'Master'
            });

            prompterData.beatTimes = repaired.beatTimes;
            prompterData.downbeats = repaired.downbeats;
            prompterData.firstBeatOffset = repaired.firstBeatOffset;
            if (repaired.bpm > 0) {
              prompterData.bpm = repaired.bpm;
            }
            console.log(`[Auto-Sync DSP] ${repaired.telemetrySummary}`);
          }
        } catch (e) {
          console.error('[Auto-Sync DSP] Error en re-sincronización rítmica:', e);
        }
      }
    }
    // ------------------------------------------------------------------------

    const nextPreRoll = computePreRollSeconds(prompterData, preRollEnabledRef.current);
    preRollDurationRef.current = nextPreRoll;
    setPreRollDurationState(nextPreRoll);
    if (maxDuration > 0) {
      setTotalDuration(maxDuration);
      totalDurationRef.current = maxDuration;
    }

    // Guardar para uso interno respetando fallback chords[0].time
    prompterDataRef.current = prompterData;
    const baseFirstBeat =
      prompterData?.firstBeatOffset !== undefined
        ? Number(prompterData.firstBeatOffset)
        : prompterData?.chords?.[0]?.time !== undefined
        ? Number(prompterData.chords[0].time)
        : 0;
    manualGridOffsetRef.current = _gridOffsetTime - baseFirstBeat;

    // Resetear el reloj visual al inicio del Pre-Roll
    setCurrentTime(-nextPreRoll);
    pauseTime.current = 0;
    
    // Pre-cargar todas las voces desde public/cues/ usando loadCueBuffers unificado (margen 5ms)
    if (Object.keys(cueBuffersRef.current).length < 11 && audioContext.current) {
      const loadedCues = await loadCueBuffers(audioContext.current);
      cueBuffersRef.current = { ...cueBuffersRef.current, ...loadedCues.cueBuffers };
      cueOffsetsRef.current = { ...cueOffsetsRef.current, ...loadedCues.cueOffsets };
    }

    setLoadProgress({ loaded: activeStemsArray.length, total: activeStemsArray.length, currentFile: '¡Todas las pistas cargadas en RAM!' });
    return prompterData;
  };




  // 3. Matriz de Ruteo (Routing Engine)
  const buildRoutingGraph = useCallback(() => {
    if (!audioContext.current) return;
    const ctx = audioContext.current;

    sourceNodes.current.forEach(node => { try { node.disconnect(); } catch {} });
    gainNodes.current.forEach(node => { try { node.disconnect(); } catch {} });
    pannerNodes.current.forEach(node => { try { node.disconnect(); } catch {} });
    try { mergerNode.current?.disconnect(); } catch {}
    try { globalMasterGainNode.current?.disconnect(); } catch {}

    const maxChannels = ctx.destination.maxChannelCount || 2;
    let effectiveMode = routingMode;
    if (routingMode === 'MultiChannel' && maxChannels < 4) {
      console.warn('Hardware interface only supports', maxChannels, 'channels. Falling back safely to StereoSplit (L=CUE, R=FOH).');
      effectiveMode = 'StereoSplit';
      setRoutingMode('StereoSplit');
    }

    if (effectiveMode === 'MultiChannel') {
      try {
        ctx.destination.channelInterpretation = 'discrete';
        ctx.destination.channelCountMode = 'explicit';
        ctx.destination.channelCount = maxChannels;
      } catch {}
      if (globalMasterGainNode.current) {
        globalMasterGainNode.current.channelCount = maxChannels;
        globalMasterGainNode.current.channelCountMode = 'explicit';
        globalMasterGainNode.current.channelInterpretation = 'discrete';
        globalMasterGainNode.current.connect(ctx.destination);
      }
      splitterNode.current = ctx.createChannelSplitter(maxChannels);
      mergerNode.current = ctx.createChannelMerger(maxChannels);
      mergerNode.current.channelInterpretation = 'discrete';
      mergerNode.current.connect(globalMasterGainNode.current!);
    } else {
      try {
        ctx.destination.channelInterpretation = 'speakers';
        ctx.destination.channelCountMode = 'explicit';
        ctx.destination.channelCount = Math.min(2, maxChannels);
      } catch {}
      if (globalMasterGainNode.current) {
        globalMasterGainNode.current.channelCount = 2;
        globalMasterGainNode.current.channelCountMode = 'max';
        globalMasterGainNode.current.channelInterpretation = 'speakers';
        globalMasterGainNode.current.connect(ctx.destination);
      }
    }

    const hasSolo = stems.some(s => s.solo);

    stems.forEach(stem => {
      const isMuted = stem.muted || (hasSolo && !stem.solo);
      const isClickOrCue = stem.type === 'Click' || stem.type === 'Cues';

      if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
        const gain = ctx.createGain();
        gain.gain.value = isMuted ? 0 : stem.volume;
        if (effectiveMode === 'StereoInEar' || effectiveMode === 'StereoSplit') {
          const panner = ctx.createStereoPanner();
          panner.pan.value = effectiveMode === 'StereoSplit' ? -1 : (stem.pan || 0);
          gain.connect(panner);
          panner.connect(globalMasterGainNode.current!);
          pannerNodes.current.set(stem.id, panner);
        } else if (effectiveMode === 'MultiChannel' && mergerNode.current) {
          // Click -> Salida 3 (idx 2), Cues -> Salida 4 (idx 3 o idx 2 si solo 3)
          const defaultCueCh = stem.type === 'Cues' && maxChannels >= 4 ? 3 : 2;
          const targetOutput = stem.targetOutputChannel && stem.targetOutputChannel >= 2
            ? Math.min(stem.targetOutputChannel, maxChannels - 1)
            : Math.min(defaultCueCh, maxChannels - 1);
          gain.connect(mergerNode.current, 0, targetOutput);
        } else {
          gain.connect(globalMasterGainNode.current!);
        }
        gainNodes.current.set(stem.id, gain);
        return;
      }

      const buffer = buffers.current.get(stem.id);
      if (!buffer) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gain = ctx.createGain();
      gain.gain.value = isMuted ? 0 : stem.volume;

      source.connect(gain);

      if (effectiveMode === 'StereoInEar' || effectiveMode === 'StereoSplit') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = effectiveMode === 'StereoSplit'
          ? (isClickOrCue ? -1 : 1)
          : (stem.pan || 0);
        gain.connect(panner);
        panner.connect(globalMasterGainNode.current!);
        pannerNodes.current.set(stem.id, panner);
      } else if (effectiveMode === 'MultiChannel' && mergerNode.current) {
        if (isClickOrCue) {
          const defaultCueCh = stem.type === 'Cues' && maxChannels >= 4 ? 3 : 2;
          const targetOutput = stem.targetOutputChannel && stem.targetOutputChannel >= 2
            ? Math.min(stem.targetOutputChannel, maxChannels - 1)
            : Math.min(defaultCueCh, maxChannels - 1);
          gain.connect(mergerNode.current, 0, targetOutput);
        } else if (stem.targetOutputChannel && stem.targetOutputChannel > 0) {
          const clampedOut = Math.min(stem.targetOutputChannel, maxChannels - 1);
          gain.connect(mergerNode.current, 0, clampedOut);
        } else {
          // Instrumento estéreo nativo: Split L -> Salida 1 (idx 0), R -> Salida 2 (idx 1)
          const stemSplitter = ctx.createChannelSplitter(2);
          gain.connect(stemSplitter);
          stemSplitter.connect(mergerNode.current, 0, 0);
          stemSplitter.connect(mergerNode.current, 1, 1);
        }
      }

      sourceNodes.current.set(stem.id, source);
      gainNodes.current.set(stem.id, gain);
    });
  }, [stems, routingMode]);

  // Programador unificado en tiempo real de Metrónomo (Click) + Voz Guía (Cues)
  const scheduleLiveClicksAndCues = useCallback(
    (prompterData: any, manualGridOffset: number, now: number, globalOffset: number) => {
      if (!audioContext.current) return;
      const preRollDuration = preRollDurationRef.current;

      // 1. Limpiar y reprogramar Click
      clickSources.current.forEach((src) => {
        try {
          src.stop();
        } catch {}
      });
      clickSources.current = [];

      // 2. Limpiar y reprogramar Cues
      cueSources.current.forEach((src) => {
        try {
          src.stop();
        } catch {}
      });
      cueSources.current = [];

      if (!prompterData || !prompterData.bpm) return;

      const currentStems = stemsRef.current;
      const currentTotalDuration = totalDurationRef.current;
      const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
      const { shiftedBeatTimes, downbeatIndex } = buildShiftedBeatGrid(
        prompterData,
        preRollDuration,
        currentTotalDuration,
        manualGridOffset
      );

      // A. Programar Clics conectados a gainNodes ('synthetic-click') para permitir Mute/Solo en vivo
      const clickGainNode = gainNodes.current.get('synthetic-click');
      const clickStem = currentStems.find((s) => s.id === 'synthetic-click');
      const isClickMuted = clickStem
        ? clickStem.muted || (currentStems.some((s) => s.solo) && !clickStem.solo)
        : false;

      if (clickGainNode || !isClickMuted) {
        let beatCount = 0;
        for (const adjustedTime of shiftedBeatTimes) {
          if (adjustedTime >= globalOffset) {
            const measureBeat = (beatCount - downbeatIndex) % beatsPerMeasure;
            const normalizedMeasureBeat =
              ((measureBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
            const isHigh = normalizedMeasureBeat === 0;
            const buffer = isHigh ? clickHighBufferRef.current : clickLowBufferRef.current;

            if (buffer && audioContext.current) {
              const source = audioContext.current.createBufferSource();
              source.buffer = buffer;

              if (clickGainNode) {
                source.connect(clickGainNode);
              } else {
                source.connect(globalMasterGainNode.current!);
              }

              source.start(now + (adjustedTime - globalOffset));
              clickSources.current.push(source);
            }
          }
          beatCount++;
        }
      }

      // B. Programar Voz Guía conectada a gainNodes ('synthetic-cues')
      const cueGainNode = gainNodes.current.get('synthetic-cues');
      const cueStem = currentStems.find((s) => s.id === 'synthetic-cues');
      const isCueMuted = cueStem
        ? cueStem.muted || (currentStems.some((s) => s.solo) && !cueStem.solo)
        : false;

      if (prompterData.sections && (cueGainNode || !isCueMuted)) {
        const schedule = (bufName: string, bIdx: number) => {
          const buf = cueBuffersRef.current[bufName];
          const cueOffset = cueOffsetsRef.current[bufName] || 0;
          if (buf && bIdx >= 0 && bIdx < shiftedBeatTimes.length && audioContext.current) {
            const absoluteTime = shiftedBeatTimes[bIdx];
            if (absoluteTime >= globalOffset) {
              const source = audioContext.current.createBufferSource();
              const gain = audioContext.current.createGain();
              source.buffer = buf;
              gain.gain.value = 1.0;
              source.connect(gain);

              if (cueGainNode) {
                gain.connect(cueGainNode);
              } else {
                gain.connect(globalMasterGainNode.current!);
              }

              source.start(now + (absoluteTime - globalOffset), cueOffset);
              cueSources.current.push(source);
            }
          }
        };

        scheduleSectionVoiceCues(
          prompterData.sections,
          shiftedBeatTimes,
          beatsPerMeasure,
          preRollDuration,
          cueBuffersRef.current,
          schedule
        );
      }
    },
    []
  );

  // 4. Playback Controls
  const play = async () => {
    if (!audioContext.current) return;
    
    const prompterData = prompterDataRef.current;
    const manualGridOffset = manualGridOffsetRef.current;
    
    if (audioContext.current.state === 'suspended') {
      await audioContext.current.resume();
    }

    buildRoutingGraph();
    
    const preRollDuration = preRollDurationRef.current;
    const globalOffset = pauseTime.current;
    const now = audioContext.current.currentTime;
    
    // A. Reproducir los Stems Musicales
    sourceNodes.current.forEach((source, _id) => {
      if (globalOffset < preRollDuration) {
        source.start(now + (preRollDuration - globalOffset), 0);
      } else {
        source.start(now, globalOffset - preRollDuration);
      }
    });
    
    // B & C. Programar Click y Voz Guía en Tiempo Real
    scheduleLiveClicksAndCues(prompterData, manualGridOffset, now, globalOffset);
    
    startTime.current = now - globalOffset;
    setIsPlaying(true);
    isPlayingRef.current = true;
    updateTime();
  };

  const pause = (isInternalSeek: unknown = false) => {
    if (!audioContext.current) return;
    if (isInternalSeek !== true) {
      if (seekTimeoutRef.current) {
        clearTimeout(seekTimeoutRef.current);
        seekTimeoutRef.current = null;
      }
      wasPlayingBeforeSeekRef.current = false;
    }
    sourceNodes.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    clickSources.current.forEach(src => { try { src.stop(); } catch (e) {} });
    cueSources.current.forEach(src => { try { src.stop(); } catch (e) {} });
    
    if (isPlayingRef.current) {
      pauseTime.current = audioContext.current.currentTime - startTime.current;
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
    cancelAnimationFrame(animationFrame.current);
  };

  // Resetea completamente el reloj, el estado de reproducción y los nodos al cambiar de canción
  const resetEngine = useCallback(() => {
    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current);
      seekTimeoutRef.current = null;
    }
    wasPlayingBeforeSeekRef.current = false;
    cancelAnimationFrame(animationFrame.current);
    sourceNodes.current.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    });
    clickSources.current.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    });
    cueSources.current.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    });
    clickSources.current = [];
    cueSources.current = [];
    sourceNodes.current.clear();
    gainNodes.current.clear();
    pannerNodes.current.clear();
    isPlayingRef.current = false;
    setIsPlaying(false);
    pauseTime.current = 0;
    startTime.current = 0;
    preRollDurationRef.current = 0;
    setPreRollDurationState(0);
    manualGridOffsetRef.current = 0;
    loopState.current = { isLooping: false, start: 0, end: 0 };
    setCurrentTime(0);
    setTotalDuration(0);
    totalDurationRef.current = 0;
  }, []);

  const updateTime = () => {
    if (!audioContext.current || !isPlayingRef.current) return;
    
    const globalTime = audioContext.current.currentTime - startTime.current;
    const visualTime = globalTime - preRollDurationRef.current;
    const currentTotalDur = totalDurationRef.current;
    
    // 5. Vamp / Loop Logic
    if (loopState.current.isLooping && visualTime >= loopState.current.end) {
      pause(true);
      pauseTime.current = Math.max(0, loopState.current.start + preRollDurationRef.current);
      void play();
      return;
    }

    // Auto-stop al final de la canción (usando totalDurationRef para evitar stale closure)
    if (currentTotalDur > 0 && globalTime >= currentTotalDur + preRollDurationRef.current) {
      pause();
      pauseTime.current = 0;
      setCurrentTime(-preRollDurationRef.current);
      return;
    }

    setCurrentTime(visualTime);
    if (isPlayingRef.current) {
      animationFrame.current = requestAnimationFrame(updateTime);
    }
  };

  const seekTo = (newVisualTime: number) => {
    if (!audioContext.current) return;
    if (isPlayingRef.current) {
      wasPlayingBeforeSeekRef.current = true;
      pause(true);
    }
    const shouldResume = wasPlayingBeforeSeekRef.current;
    const preRollDur = preRollDurationRef.current;
    const maxDur = totalDurationRef.current > 0 ? totalDurationRef.current : 600;
    const clampedVisual = Math.max(-preRollDur, Math.min(newVisualTime, maxDur));
    const globalTime = Math.max(0, Math.min(clampedVisual + preRollDur, maxDur + preRollDur));
    pauseTime.current = globalTime;
    setCurrentTime(clampedVisual);
    
    if (shouldResume) {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      seekTimeoutRef.current = window.setTimeout(() => {
        seekTimeoutRef.current = null;
        wasPlayingBeforeSeekRef.current = false;
        void play();
      }, 50);
    }
  };

  const togglePreRoll = useCallback((forceValue?: boolean) => {
    const nextEnabled = typeof forceValue === 'boolean' ? forceValue : !preRollEnabledRef.current;
    const oldPreRoll = preRollDurationRef.current;
    const currentVisual = isPlayingRef.current && audioContext.current
      ? (audioContext.current.currentTime - startTime.current) - oldPreRoll
      : pauseTime.current - oldPreRoll;

    preRollEnabledRef.current = nextEnabled;
    setPreRollEnabledState(nextEnabled);

    const nextPreRoll = computePreRollSeconds(prompterDataRef.current, nextEnabled);
    preRollDurationRef.current = nextPreRoll;
    setPreRollDurationState(nextPreRoll);

    if (!isPlayingRef.current && currentVisual <= 0.05) {
      pauseTime.current = 0;
      setCurrentTime(-nextPreRoll);
    } else {
      const nextVisual = Math.max(-nextPreRoll, currentVisual);
      seekTo(nextVisual);
    }
  }, [computePreRollSeconds]);

  const setLoop = (start: number, end: number, enable: boolean) => {
    loopState.current = { isLooping: enable, start, end };
  };

  // 6. Reactividad del Mixer (Volumen, Mute, Solo en Tiempo Real)
  useEffect(() => {
    if (!audioContext.current || !isPlaying) return;
    
    const hasSolo = stems.some(s => s.solo);
    
    stems.forEach(stem => {
      const gainNode = gainNodes.current.get(stem.id);
      if (gainNode) {
        const isMuted = stem.muted || (hasSolo && !stem.solo);
        // setTargetAtTime evita "clicks" o "pops" de audio al mover el fader bruscamente
        if (audioContext.current) {
          gainNode.gain.setTargetAtTime(isMuted ? 0 : stem.volume, audioContext.current.currentTime, 0.01);
        }
      }
      const pannerNode = pannerNodes.current.get(stem.id);
      if (pannerNode && audioContext.current) {
         pannerNode.pan.setTargetAtTime(stem.pan || 0, audioContext.current.currentTime, 0.01);
      }
    });
  }, [stems, isPlaying]);

  const exportLiveMix = async (songId: string, bandId: string, currentPrompterData: any, onProgress: (msg: string) => void) => {
    if (!audioContext.current) throw new Error("AudioContext not initialized");
    if (buffers.current.size === 0) throw new Error("Las pistas no están cargadas en memoria. Por favor presiona 'Cargar a RAM' primero.");
    await ensureCueBuffersLoaded();
    
    let maxBufDuration = totalDuration;
    buffers.current.forEach(buf => {
       if (buf.duration > maxBufDuration) maxBufDuration = buf.duration;
    });

    const prompterData = currentPrompterData || prompterDataRef.current;
    
    let calculatedPreRoll = 0;
    if (prompterData && prompterData.bpm > 0) {
       const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
       const secondsPerBeat = 60 / prompterData.bpm;
       // Tope 16s para evitar pre-rolls gigantes por tempo dividido
       calculatedPreRoll = Math.min((secondsPerBeat * beatsPerMeasure) * 2, 16);
    }
    
    const sampleRate = audioContext.current.sampleRate;
    const lengthSeconds = maxBufDuration + calculatedPreRoll + 5; // 5 seconds tail
    const lengthSamples = Math.ceil(lengthSeconds * sampleRate);
    const hasInstrumentSolo = stems.some((s) => s.type === 'Instrument' && s.solo);

    const renderMix = async (isFoh: boolean): Promise<{ buffer: AudioBuffer, blob: Blob }> => {
      onProgress(`Preparando renderizado ${isFoh ? 'FOH' : 'CUE'}...`);
      const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);
      
      const manualGridOffset = manualGridOffsetRef.current;
      const preRollDuration = calculatedPreRoll;

      // Render Stems
      stems.forEach(stem => {
        const isMusic = stem.type === 'Instrument';
        if (isFoh && !isMusic) return; // FOH only gets instruments
        if (!isFoh && isMusic) return; // CUE only gets click and cues

        const isMuted = stem.muted || (isMusic && hasInstrumentSolo && !stem.solo);
        if (isMuted) return;

        if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
           // handled below
           return;
        }

        const buffer = buffers.current.get(stem.id);
        if (!buffer) return;

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        
        const gain = offlineCtx.createGain();
        gain.gain.value = stem.volume;

        const panner = offlineCtx.createStereoPanner();
        panner.pan.value = stem.pan || 0;

        source.connect(gain);
        gain.connect(panner);
        panner.connect(offlineCtx.destination);
        
        source.start(preRollDuration);
      });

      // Render Clicks & Cues (Only for CUE) usando buildShiftedBeatGrid unificado
      if (!isFoh && prompterData && prompterData.bpm) {
        const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
        const { shiftedBeatTimes, downbeatIndex } = buildShiftedBeatGrid(
          prompterData,
          preRollDuration,
          maxBufDuration,
          manualGridOffset
        );

        const clickStem = stems.find(s => s.id === 'synthetic-click');
        if (!clickStem || !clickStem.muted) {
          let beatCount = 0;
          for (const adjustedTime of shiftedBeatTimes) {
            if (adjustedTime >= 0 && adjustedTime < lengthSeconds) {
              const measureBeat = (beatCount - downbeatIndex) % beatsPerMeasure;
              const normalizedMeasureBeat = ((measureBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
              const isHigh = normalizedMeasureBeat === 0;
              const buffer = isHigh ? clickHighBufferRef.current : clickLowBufferRef.current;

              if (buffer) {
                const source = offlineCtx.createBufferSource();
                source.buffer = buffer;
                const gain = offlineCtx.createGain();
                gain.gain.value = clickStem ? clickStem.volume : 0.8;
                const panner = offlineCtx.createStereoPanner();
                panner.pan.value = clickStem ? (clickStem.pan || 0) : 0;

                source.connect(gain);
                gain.connect(panner);
                panner.connect(offlineCtx.destination);
                source.start(adjustedTime);
              }
            }
            beatCount++;
          }
        }

        const cueStem = stems.find(s => s.id === 'synthetic-cues');
        if (prompterData.sections && (!cueStem || !cueStem.muted)) {
          const schedule = (bufName: string, bIdx: number) => {
            const buf = cueBuffersRef.current[bufName];
            const cueOffset = cueOffsetsRef.current[bufName] || 0;
            if (buf && bIdx >= 0 && bIdx < shiftedBeatTimes.length) {
              const absoluteTime = shiftedBeatTimes[bIdx];
              if (absoluteTime >= 0 && absoluteTime < lengthSeconds) {
                const source = offlineCtx.createBufferSource();
                source.buffer = buf;
                const gain = offlineCtx.createGain();
                gain.gain.value = cueStem ? cueStem.volume : 0.8;
                const panner = offlineCtx.createStereoPanner();
                panner.pan.value = cueStem ? (cueStem.pan || 0) : 0;

                source.connect(gain);
                gain.connect(panner);
                panner.connect(offlineCtx.destination);
                source.start(absoluteTime, cueOffset);
              }
            }
          };

          scheduleSectionVoiceCues(
            prompterData.sections,
            shiftedBeatTimes,
            beatsPerMeasure,
            preRollDuration,
            cueBuffersRef.current,
            schedule
          );
        }
      }

      onProgress(`Renderizando ${isFoh ? 'FOH' : 'CUE'}...`);
      const renderedBuffer = await offlineCtx.startRendering();
      
      onProgress(`Codificando WAV ${isFoh ? 'FOH' : 'CUE'}...`);
      const blob = audioBufferToWavBlob(renderedBuffer);
      return { buffer: renderedBuffer, blob };
    };

    try {
      const fohResult = await renderMix(true);
      const cueResult = await renderMix(false);

      const fohBlob = fohResult.blob;
      const cueBlob = cueResult.blob;

      const fohPath = `${bandId}/${songId}/mixes/foh_${Date.now()}.wav`;
      const { error: fohError } = await supabase.storage
        .from('audios')
        .upload(fohPath, fohBlob, { contentType: 'audio/wav', upsert: true });
      if (fohError) throw fohError;
      const fohUrl = supabase.storage.from('audios').getPublicUrl(fohPath).data.publicUrl;
      
      onProgress('Subiendo CUE a la nube...');
      const cuePath = `${bandId}/${songId}/mixes/cue_${Date.now()}.wav`;
      const { error: cueError } = await supabase.storage
        .from('audios')
        .upload(cuePath, cueBlob, { contentType: 'audio/wav', upsert: true });
      if (cueError) throw cueError;
      const cueUrl = supabase.storage.from('audios').getPublicUrl(cuePath).data.publicUrl;

      // MP3 Uploads (Versión Ligera Móvil)
      onProgress('Codificando MP3 FOH Ligero (Modo Ensayo)...');
      const fohMp3Blob = await audioBufferToMp3Blob(fohResult.buffer, 192);
      const fohMp3Path = `${bandId}/${songId}/mixes/foh_mobile_${Date.now()}.mp3`;
      await supabase.storage.from('audios').upload(fohMp3Path, fohMp3Blob, { contentType: 'audio/mpeg', upsert: true });
      const fohMobileUrl = supabase.storage.from('audios').getPublicUrl(fohMp3Path).data.publicUrl;

      onProgress('Codificando MP3 CUE Ligero (Modo Ensayo)...');
      const cueMp3Blob = await audioBufferToMp3Blob(cueResult.buffer, 192);
      const cueMp3Path = `${bandId}/${songId}/mixes/cue_mobile_${Date.now()}.mp3`;
      await supabase.storage.from('audios').upload(cueMp3Path, cueMp3Blob, { contentType: 'audio/mpeg', upsert: true });
      const cueMobileUrl = supabase.storage.from('audios').getPublicUrl(cueMp3Path).data.publicUrl;

      onProgress('Guardando URLs en la base de datos...');
      await supabase.from('songs').update({
        foh_mix_url: fohUrl,
        cue_mix_url: cueUrl,
        foh_mobile_url: fohMobileUrl,
        cue_mobile_url: cueMobileUrl
      }).eq('id', songId);

      onProgress('¡Exportación completada exitosamente!');
    } catch (err: any) {
      console.error(err);
      throw new Error(`Error en la exportación: ${err.message}`);
    }
  };

  // Helper para convertir AudioBuffer a WAV Blob
  const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);
    const channels = [];
    let offset = 0;
    let pos = 0;

    // write WAV header
    const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
    const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };
    const setString = (data: string) => { for (let i = 0; i < data.length; i++) { view.setUint8(pos, data.charCodeAt(i)); pos++; } };

    setString('RIFF');
    setUint32(length - 8);
    setString('WAVE');
    setString('fmt ');
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);
    setString('data');
    setUint32(length - pos - 4);

    // write interleaved data
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  const getBuffer = (stemId: string) => {
    return buffers.current.get(stemId);
  };

  // Extraer envolvente de onda combinada desde los buffers en RAM para visualización tipo CapCut
  const getCompositePeaks = useCallback((bucketCount: number = 900): number[] => {
    if (buffers.current.size === 0) return [];
    let preferredBuffer: AudioBuffer | undefined;

    for (const stem of stems) {
      const n = (stem.name || '').toLowerCase();
      if (n.includes('master') || n.includes('mezcla') || n.includes('full') || n.includes('drum') || n.includes('bater')) {
        const b = buffers.current.get(stem.id);
        if (b) {
          preferredBuffer = b;
          break;
        }
      }
    }

    const activeBuffers: AudioBuffer[] = preferredBuffer
      ? [preferredBuffer]
      : Array.from(buffers.current.values());

    if (activeBuffers.length === 0) return [];

    const maxSamples = Math.max(...activeBuffers.map((b) => b.length));
    if (maxSamples <= 0) return [];

    const samplesPerBucket = Math.max(1, Math.floor(maxSamples / bucketCount));
    const peaks = new Array<number>(bucketCount).fill(0);
    let globalMax = 0.01;

    for (let i = 0; i < bucketCount; i++) {
      const start = i * samplesPerBucket;
      const end = Math.min(maxSamples, start + samplesPerBucket);
      const step = Math.max(1, Math.floor((end - start) / 48));
      let maxInBucket = 0;

      for (const buf of activeBuffers) {
        const ch0 = buf.getChannelData(0);
        const limit = Math.min(end, ch0.length);
        for (let j = start; j < limit; j += step) {
          const v = Math.abs(ch0[j]);
          if (v > maxInBucket) maxInBucket = v;
        }
      }

      peaks[i] = maxInBucket;
      if (maxInBucket > globalMax) globalMax = maxInBucket;
    }

    return peaks.map((p) => Math.max(0.04, Math.min(1, p / globalMax)));
  }, [stems]);

  // Asegurar que los audios de voz guía estén cargados en RAM incluso antes de Cargar Stems (con margen 5ms)
  const ensureCueBuffersLoaded = useCallback(async () => {
    if (!audioContext.current) return;
    if (audioContext.current.state === 'suspended') {
      try { await audioContext.current.resume(); } catch {}
    }
    if (Object.keys(cueBuffersRef.current).length >= 11) return;
    const loadedCues = await loadCueBuffers(audioContext.current);
    cueBuffersRef.current = { ...cueBuffersRef.current, ...loadedCues.cueBuffers };
    cueOffsetsRef.current = { ...cueOffsetsRef.current, ...loadedCues.cueOffsets };
  }, []);

  // Pre-escucha inmediata de una etiqueta de Voz Guía (al soltar o hacer clic en 🔊)
  const previewVoiceCue = useCallback(async (sectionName: string) => {
    if (!audioContext.current) return;
    await ensureCueBuffersLoaded();
    const resolved = resolveCueBufferName(sectionName, cueBuffersRef.current);
    const buf = resolved ? cueBuffersRef.current[resolved] : undefined;
    if (!buf || !audioContext.current) return;

    const cueOffset = cueOffsetsRef.current[resolved] || 0;
    const source = audioContext.current.createBufferSource();
    const gain = audioContext.current.createGain();
    const cueStem = stems.find((s) => s.id === 'synthetic-cues');
    gain.gain.value = cueStem ? Math.max(0.35, cueStem.volume) : 0.85;
    source.buffer = buf;
    source.connect(gain);

    const masterGain = gainNodes.current.get('synthetic-cues');
    if (masterGain && cueStem && !cueStem.muted) {
      gain.connect(masterGain);
    } else if (globalMasterGainNode.current) {
      gain.connect(globalMasterGainNode.current);
    } else {
      gain.connect(audioContext.current.destination);
    }

    source.start(0, cueOffset);
  }, [ensureCueBuffersLoaded, stems]);

  // Sincronización en caliente de prompterData y manualGridOffset en RAM (reprograma Metrónomo + Voz Guía al vuelo sin cortar la música)
  const syncPrompterData = useCallback(
    (nextPrompterData: any, nextManualGridOffset?: number) => {
      prompterDataRef.current = nextPrompterData;
      if (typeof nextManualGridOffset === 'number') {
        manualGridOffsetRef.current = nextManualGridOffset;
      }
      if (preRollEnabledRef.current) {
        const oldPre = preRollDurationRef.current;
        const nextPre = computePreRollSeconds(nextPrompterData, true);
        if (Math.abs(nextPre - oldPre) > 0.001) {
          preRollDurationRef.current = nextPre;
          setPreRollDurationState(nextPre);
          if (isPlayingRef.current) {
            startTime.current -= nextPre - oldPre;
          } else if (pauseTime.current <= 0.001) {
            setCurrentTime(-nextPre);
          } else {
            pauseTime.current = Math.max(0, pauseTime.current + (nextPre - oldPre));
          }
        }
      }
      if (!isPlayingRef.current || !audioContext.current) return;

      const now = audioContext.current.currentTime;
      const globalOffset = now - startTime.current;
      scheduleLiveClicksAndCues(
        nextPrompterData,
        manualGridOffsetRef.current,
        now,
        globalOffset
      );
    },
    [scheduleLiveClicksAndCues, computePreRollSeconds]
  );

  const exportGhostBounce = async (onProgress: (msg: string) => void): Promise<Blob> => {
    if (!audioContext.current) throw new Error("AudioContext not initialized");
    if (buffers.current.size === 0) throw new Error("Las pistas no están cargadas en memoria. Por favor presiona 'Cargar a RAM' primero.");
    
    let maxBufDuration = totalDuration;
    buffers.current.forEach(buf => {
       if (buf.duration > maxBufDuration) maxBufDuration = buf.duration;
    });

    const prompterData = prompterDataRef.current;
    const calculatedPreRoll = computePreRollSeconds(prompterData, true);
    const sampleRate = audioContext.current.sampleRate;
    const lengthSeconds = maxBufDuration + calculatedPreRoll + 5; 
    const lengthSamples = Math.ceil(lengthSeconds * sampleRate);

    onProgress('Preparando Ghost Bounce...');
    const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);
    
    const preRollDur = calculatedPreRoll;
    const hasInstrumentSolo = stems.some((s) => s.type === 'Instrument' && s.solo);

    stems.forEach(stem => {
      const isMusic = stem.type === 'Instrument';
      if (!isMusic) return;
      if (stem.muted || (hasInstrumentSolo && !stem.solo)) return;

      const buffer = buffers.current.get(stem.id);
      if (!buffer) return;

      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      
      const gain = offlineCtx.createGain();
      gain.gain.value = 1.0; 

      const panner = offlineCtx.createStereoPanner();
      panner.pan.value = 0; 

      source.connect(gain);
      gain.connect(panner);
      panner.connect(offlineCtx.destination);
      
      source.start(preRollDur);
    });

    onProgress('Renderizando Ghost Bounce...');
    const renderedBuffer = await offlineCtx.startRendering();
    
    onProgress('Codificando WAV...');
    return audioBufferToWavBlob(renderedBuffer);
  };

  const exportMultitrackToZip = async (songName: string, currentPrompterData: any, onProgress: (msg: string) => void) => {
    if (!audioContext.current) throw new Error("AudioContext not initialized");
    if (buffers.current.size === 0) throw new Error("Las pistas no están cargadas en memoria. Por favor presiona 'Cargar a RAM' primero.");
    await ensureCueBuffersLoaded();
    
    let maxBufDuration = totalDuration;
    buffers.current.forEach(buf => {
       if (buf.duration > maxBufDuration) maxBufDuration = buf.duration;
    });

    const prompterData = currentPrompterData || prompterDataRef.current;
    
    let calculatedPreRoll = 0;
    if (prompterData && prompterData.bpm > 0) {
       const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
       const secondsPerBeat = 60 / prompterData.bpm;
       // Tope 16s para evitar pre-rolls gigantes por tempo dividido
       calculatedPreRoll = Math.min((secondsPerBeat * beatsPerMeasure) * 2, 16);
    }

    const sampleRate = audioContext.current.sampleRate;
    const lengthSeconds = maxBufDuration + calculatedPreRoll + 5; 
    const lengthSamples = Math.ceil(lengthSeconds * sampleRate);
    const preRollDuration = calculatedPreRoll;
    const JSZip = (await import('jszip')).default;
    const { saveAs } = await import('file-saver');

    const zip = new JSZip();
    const hasSolo = stems.some((s) => s.solo);
    const activeStems = stems.filter((s) => !(s.muted || (hasSolo && !s.solo)));
    const stemsToExport = activeStems.length > 0 ? activeStems : stems;

    for (let i = 0; i < stemsToExport.length; i++) {
      const stem = stemsToExport[i];
      onProgress(`Renderizando ${stem.name} (${i+1}/${stemsToExport.length})...`);
      
      const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);
      
      if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
        const prompterData = currentPrompterData || prompterDataRef.current;
        const manualGridOffset = manualGridOffsetRef.current;
        const beatsPerMeasure = parseInt(prompterData?.timeSignature?.split('/')[0]) || 4;
        const { shiftedBeatTimes, downbeatIndex } = buildShiftedBeatGrid(
          prompterData,
          preRollDuration,
          maxBufDuration,
          manualGridOffset
        );
        
        if (stem.id === 'synthetic-click' && prompterData && prompterData.bpm) {
           let beatCount = 0;
           for (const adjustedTime of shiftedBeatTimes) {
             if (adjustedTime >= 0 && adjustedTime < lengthSeconds) {
               const measureBeat = (beatCount - downbeatIndex) % beatsPerMeasure;
               const normalizedMeasureBeat = ((measureBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
               const isHigh = normalizedMeasureBeat === 0;
               const buffer = isHigh ? clickHighBufferRef.current : clickLowBufferRef.current;
               
               if (buffer) {
                 const source = offlineCtx.createBufferSource();
                 source.buffer = buffer;
                 const gain = offlineCtx.createGain();
                 gain.gain.value = stem.volume;
                 const panner = offlineCtx.createStereoPanner();
                 panner.pan.value = stem.pan || 0;
                 
                 source.connect(gain);
                 gain.connect(panner);
                 panner.connect(offlineCtx.destination);
                 source.start(adjustedTime);
               }
             }
             beatCount++;
           }
        } else if (stem.id === 'synthetic-cues' && prompterData && prompterData.sections && prompterData.bpm) {
           const schedule = (bufName: string, bIdx: number) => {
                 const buf = cueBuffersRef.current[bufName];
                 const cueOffset = cueOffsetsRef.current[bufName] || 0;
                 if (buf && bIdx >= 0 && bIdx < shiftedBeatTimes.length) {
                    const absoluteTime = shiftedBeatTimes[bIdx];
                    if (absoluteTime >= 0 && absoluteTime < lengthSeconds) {
                       const source = offlineCtx.createBufferSource();
                       source.buffer = buf;
                       const gain = offlineCtx.createGain();
                       gain.gain.value = stem.volume;
                       const panner = offlineCtx.createStereoPanner();
                       panner.pan.value = stem.pan || 0;
                       
                       source.connect(gain);
                       gain.connect(panner);
                       panner.connect(offlineCtx.destination);
                       source.start(absoluteTime, cueOffset);
                    }
                 }
              };

              scheduleSectionVoiceCues(
                 prompterData.sections,
                 shiftedBeatTimes,
                 beatsPerMeasure,
                 preRollDuration,
                 cueBuffersRef.current,
                 schedule
              );
        }
      } else {
        const buffer = buffers.current.get(stem.id);
        if (buffer) {
          const source = offlineCtx.createBufferSource();
          source.buffer = buffer;
          const gain = offlineCtx.createGain();
          gain.gain.value = stem.volume; 
          const panner = offlineCtx.createStereoPanner();
          panner.pan.value = stem.pan || 0; 
          source.connect(gain);
          gain.connect(panner);
          panner.connect(offlineCtx.destination);
          source.start(preRollDuration);
        }
      }

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWavBlob(renderedBuffer);
      const fileName = `${stem.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.wav`;
      zip.file(fileName, wavBlob);
    }
    
    onProgress('Empaquetando archivo ZIP (esto puede demorar)...');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        onProgress(`Empaquetando ZIP: ${Math.round(metadata.percent)}%`);
    });
    
    onProgress('Descargando archivo...');
    saveAs(zipBlob, `${songName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_stems.zip`);
    onProgress('');
  };

  const exportFullMixToMp3 = async (songName: string, currentPrompterData: any, onProgress: (msg: string) => void) => {
    if (!audioContext.current) throw new Error("AudioContext not initialized");
    if (buffers.current.size === 0) throw new Error("Las pistas no están cargadas en memoria. Por favor presiona 'Cargar a RAM' primero.");
    await ensureCueBuffersLoaded();
    
    let maxBufDuration = totalDuration;
    buffers.current.forEach(buf => {
       if (buf.duration > maxBufDuration) maxBufDuration = buf.duration;
    });
    
    const prompterData = currentPrompterData || prompterDataRef.current;
    
    let calculatedPreRoll = 0;
    if (prompterData && prompterData.bpm > 0) {
       const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
       const secondsPerBeat = 60 / prompterData.bpm;
       // Tope 16s para evitar pre-rolls gigantes por tempo dividido
       calculatedPreRoll = Math.min((secondsPerBeat * beatsPerMeasure) * 2, 16);
    }

    const sampleRate = audioContext.current.sampleRate;
    const lengthSeconds = maxBufDuration + calculatedPreRoll + 5; 
    const lengthSamples = Math.ceil(lengthSeconds * sampleRate);

    onProgress('Preparando renderizado Mezcla Completa...');
    const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);
    
    const manualGridOffset = manualGridOffsetRef.current;
    const preRollDuration = calculatedPreRoll;
    const beatsPerMeasure = parseInt(prompterData?.timeSignature?.split('/')[0]) || 4;
    const { shiftedBeatTimes, downbeatIndex } = buildShiftedBeatGrid(
      prompterData,
      preRollDuration,
      maxBufDuration,
      manualGridOffset
    );
    const hasSolo = stems.some((s) => s.solo);

    stems.forEach(stem => {
      const isMuted = stem.muted || (hasSolo && !stem.solo);
      if (isMuted) return;

      if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
         if (stem.id === 'synthetic-click' && prompterData && prompterData.bpm) {
           let beatCount = 0;
           for (const adjustedTime of shiftedBeatTimes) {
             if (adjustedTime >= 0 && adjustedTime < lengthSeconds) {
               const measureBeat = (beatCount - downbeatIndex) % beatsPerMeasure;
               const normalizedMeasureBeat = ((measureBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
               const isHigh = normalizedMeasureBeat === 0;
               const buffer = isHigh ? clickHighBufferRef.current : clickLowBufferRef.current;
               
               if (buffer) {
                 const source = offlineCtx.createBufferSource();
                 source.buffer = buffer;
                 const gain = offlineCtx.createGain();
                 gain.gain.value = stem.volume;
                 const panner = offlineCtx.createStereoPanner();
                 panner.pan.value = stem.pan || 0;
                 
                 source.connect(gain);
                 gain.connect(panner);
                 panner.connect(offlineCtx.destination);
                 source.start(adjustedTime);
               }
             }
             beatCount++;
           }
        } else if (stem.id === 'synthetic-cues' && prompterData && prompterData.sections && prompterData.bpm) {
           const schedule = (bufName: string, bIdx: number) => {
                 const buf = cueBuffersRef.current[bufName];
                 const cueOffset = cueOffsetsRef.current[bufName] || 0;
                 if (buf && bIdx >= 0 && bIdx < shiftedBeatTimes.length) {
                    const absoluteTime = shiftedBeatTimes[bIdx];
                    if (absoluteTime >= 0 && absoluteTime < lengthSeconds) {
                       const source = offlineCtx.createBufferSource();
                       source.buffer = buf;
                       const gain = offlineCtx.createGain();
                       gain.gain.value = stem.volume;
                       const panner = offlineCtx.createStereoPanner();
                       panner.pan.value = stem.pan || 0;
                       
                       source.connect(gain);
                       gain.connect(panner);
                       panner.connect(offlineCtx.destination);
                       source.start(absoluteTime, cueOffset);
                    }
                 }
              };

              scheduleSectionVoiceCues(
                 prompterData.sections,
                 shiftedBeatTimes,
                 beatsPerMeasure,
                 preRollDuration,
                 cueBuffersRef.current,
                 schedule
              );
        }
      } else {
        const buffer = buffers.current.get(stem.id);
        if (buffer) {
          const source = offlineCtx.createBufferSource();
          source.buffer = buffer;
          const gain = offlineCtx.createGain();
          gain.gain.value = stem.volume;
          const panner = offlineCtx.createStereoPanner();
          panner.pan.value = stem.pan || 0;
          source.connect(gain);
          gain.connect(panner);
          panner.connect(offlineCtx.destination);
          source.start(preRollDuration);
        }
      }
    });

    onProgress('Mezclando pistas de audio (Mixdown)...');
    const renderedBuffer = await offlineCtx.startRendering();

    onProgress('Codificando a MP3 Alta Calidad (320kbps)...');
    
    const lamejs = await loadLameJs();
    const { saveAs } = await import('file-saver');

    const channels = renderedBuffer.numberOfChannels;
    const sampleRateMp3 = renderedBuffer.sampleRate;
    const encoder = new lamejs.Mp3Encoder(channels, sampleRateMp3, 320);
    
    const left = renderedBuffer.getChannelData(0);
    const right = channels > 1 ? renderedBuffer.getChannelData(1) : left;

    const sampleBlockSize = 1152; // Must be a multiple of 576
    const mp3Data = [];

    const floatTo16BitPCM = (input: Float32Array, output: Int16Array, offset: number, length: number) => {
        for (let i = 0; i < length; i++) {
            const s = Math.max(-1, Math.min(1, input[offset + i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
    };

    let sampleOffset = 0;
    while (sampleOffset < left.length) {
        const length = Math.min(sampleBlockSize, left.length - sampleOffset);
        
        const leftChunk16 = new Int16Array(length);
        const rightChunk16 = new Int16Array(length);
        
        floatTo16BitPCM(left, leftChunk16, sampleOffset, length);
        floatTo16BitPCM(right, rightChunk16, sampleOffset, length);
        
        const mp3buf = encoder.encodeBuffer(leftChunk16, rightChunk16);
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }
        
        sampleOffset += sampleBlockSize;
        
        // Progress update trick to not block UI completely
        if (sampleOffset % (sampleBlockSize * 100) === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    const mp3buf = encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }
    
    const blob = new Blob(mp3Data, { type: 'audio/mp3' });
    onProgress('Descargando MP3...');
    saveAs(blob, `${songName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_mezcla_completa.mp3`);
    onProgress('');
  };

  return { masterVolume, setMasterVolume,
    loadStems,
    play,
    pause,
    seekTo,
    isPlaying,
    currentTime,
    routingMode,
    setRoutingMode,
    stems,
    setStems,
    setLoop,
    loadProgress,
    totalDuration,
    preRollDuration,
    preRollEnabled,
    togglePreRoll,
    exportLiveMix,
    exportGhostBounce,
    exportMultitrackToZip,
    exportFullMixToMp3,
    getBuffer,
    getCompositePeaks,
    previewVoiceCue,
    syncPrompterData,
    resetEngine
  };
};

export const audioBufferToMp3Blob = async (renderedBuffer: AudioBuffer, bitrate: number = 192): Promise<Blob> => {
    const lamejs = await loadLameJs();

    const channels = renderedBuffer.numberOfChannels;
    const sampleRateMp3 = renderedBuffer.sampleRate;
    const encoder = new lamejs.Mp3Encoder(channels, sampleRateMp3, bitrate);
    
    const left = renderedBuffer.getChannelData(0);
    const right = channels > 1 ? renderedBuffer.getChannelData(1) : left;

    const sampleBlockSize = 1152;
    const mp3Data: Int8Array[] = [];

    const floatTo16BitPCM = (input: Float32Array, output: Int16Array, offset: number, length: number) => {
        for (let i = 0; i < length; i++) {
            const s = Math.max(-1, Math.min(1, input[offset + i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
    };

    let sampleOffset = 0;
    while (sampleOffset < left.length) {
        const length = Math.min(sampleBlockSize, left.length - sampleOffset);
        
        const leftChunk16 = new Int16Array(length);
        const rightChunk16 = new Int16Array(length);
        
        floatTo16BitPCM(left, leftChunk16, sampleOffset, length);
        floatTo16BitPCM(right, rightChunk16, sampleOffset, length);
        
        const mp3buf = encoder.encodeBuffer(leftChunk16, rightChunk16);
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }
        
        sampleOffset += sampleBlockSize;
        
        if (sampleOffset % (sampleBlockSize * 100) === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    const mp3buf = encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }
    
    return new Blob(mp3Data, { type: 'audio/mpeg' });
};