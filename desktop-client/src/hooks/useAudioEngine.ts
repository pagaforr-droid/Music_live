import { useRef, useState, useEffect, useCallback } from 'react';
import { generateClickBuffer, resolveCueBufferName, scheduleSectionVoiceCues } from '../utils/cueEngine';
import { findMasterAndDrumStems, repairAndRelockBeatGrid } from '../utils/beatGridDSP';

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
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0, currentFile: '' });
  const [totalDuration, setTotalDuration] = useState(0);
  
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
  // Referencia para la duración del Pre-Roll (Cuenta Regresiva)
  const preRollDurationRef = useRef(0);
  
  // Referencias para programación en tiempo real
  const clickSources = useRef<AudioBufferSourceNode[]>([]);
  const clickHighBufferRef = useRef<AudioBuffer | null>(null);
  const clickLowBufferRef = useRef<AudioBuffer | null>(null);
  const cueSources = useRef<AudioBufferSourceNode[]>([]);
  const cueBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const cueOffsetsRef = useRef<Record<string, number>>({});
  
  // Referencias para el auto-play al buscar
  const prompterDataRef = useRef<any>(null);
  const manualGridOffsetRef = useRef<number>(0);
  
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
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
  }, []);

  // 2. Cargar Buffers en Memoria
  const loadStems = async (_bpm: number, _gridOffsetTime: number = 0, _timeSignature: string = '4/4', _beatTimes: number[] = [], prompterData?: any, stemsToLoad?: StemTrack[]) => {
    if (!audioContext.current) return;
    
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

    // Calcular preRollDuration basado en el BPM (1 compás extra)
    let preRollDuration = 0;
    preRollDurationRef.current = preRollDuration;
    setTotalDuration(maxDuration);

    // Guardar para uso interno
    prompterDataRef.current = prompterData;
    manualGridOffsetRef.current = _gridOffsetTime - (prompterData?.firstBeatOffset || 0);

    // Resetear el reloj visual al inicio del Pre-Roll
    setCurrentTime(-preRollDuration);
    pauseTime.current = 0;
    
    // Pre-cargar todas las voces desde public/cues/
    const cueNames = ['intro', 'verso', 'pre-coro', 'coro', 'puente', 'solo', 'final', '1', '2', '3', '4'];
    await Promise.all(cueNames.map(async (name) => {
       try {
         if (!cueBuffersRef.current[name]) {
             const res = await fetch(`/cues/${name}.mp3`);
             if (res.ok) {
               const arrayBuffer = await res.arrayBuffer();
               const audioBuffer = await audioContext.current!.decodeAudioData(arrayBuffer);
               cueBuffersRef.current[name] = audioBuffer;
               
               // Auto-Trim: Detectar el inicio real de la voz para saltar el silencio (padding del MP3)
               const data = audioBuffer.getChannelData(0);
               let startSample = 0;
               for (let i = 0; i < data.length; i++) {
                  if (Math.abs(data[i]) > 0.05) { startSample = i; break; }
               }
               cueOffsetsRef.current[name] = startSample / audioBuffer.sampleRate;
             }
         }
       } catch (e) {
         console.error("No se pudo cargar cue:", name);
       }
    }));

    setLoadProgress({ loaded: activeStemsArray.length, total: activeStemsArray.length, currentFile: '¡Todas las pistas cargadas en RAM!' });
  };




  // 3. Matriz de Ruteo (Routing Engine)
  const buildRoutingGraph = useCallback(() => {
    if (!audioContext.current) return;
    const ctx = audioContext.current;

    sourceNodes.current.forEach(node => node.disconnect());
    gainNodes.current.forEach(node => node.disconnect());
    pannerNodes.current.forEach(node => node.disconnect());

    const maxChannels = ctx.destination.maxChannelCount;
    if (routingMode === 'MultiChannel' && maxChannels < 4) {
      console.warn("Hardware interface only supports", maxChannels, "channels. Falling back to StereoInEar.");
      setRoutingMode('StereoInEar');
    }

    if (routingMode === 'MultiChannel') {
      ctx.destination.channelCount = maxChannels;
      splitterNode.current = ctx.createChannelSplitter(maxChannels);
      mergerNode.current = ctx.createChannelMerger(maxChannels);
      mergerNode.current.connect(globalMasterGainNode.current!);
    }

    const hasSolo = stems.some(s => s.solo);

    stems.forEach(stem => {
      const isMuted = stem.muted || (hasSolo && !stem.solo);

      if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
         const gain = ctx.createGain();
         gain.gain.value = isMuted ? 0 : stem.volume;
         if (routingMode === 'StereoInEar' || routingMode === 'StereoSplit') {
           const panner = ctx.createStereoPanner();
           panner.pan.value = stem.pan || 0;
           gain.connect(panner);
           panner.connect(globalMasterGainNode.current!);
           pannerNodes.current.set(stem.id, panner);
         } else if (routingMode === 'MultiChannel' && mergerNode.current) {
           const targetOutput = stem.targetOutputChannel ?? 0;
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
      
      if (routingMode === 'StereoInEar' || routingMode === 'StereoSplit') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = stem.pan || 0;
        gain.connect(panner);
        panner.connect(globalMasterGainNode.current!);
        pannerNodes.current.set(stem.id, panner);
      } else if (routingMode === 'MultiChannel' && mergerNode.current) {
        const targetOutput = stem.targetOutputChannel ?? 0;
        gain.connect(mergerNode.current, 0, targetOutput);
      }

      sourceNodes.current.set(stem.id, source);
      gainNodes.current.set(stem.id, gain);
    });
  }, [stems, routingMode]);

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
        source.start(0, globalOffset - preRollDuration);
      }
    });
    
    // B. Reproducir Click (Tiempo Real)
    clickSources.current.forEach(src => { try { src.stop(); } catch(e) {} });
    clickSources.current = [];
    
    // Obtener el nodo de Ganancia/Paneo del click
    const clickStem = stems.find(s => s.id === 'synthetic-click');
    const isClickMuted = clickStem ? clickStem.muted || (stems.some(s => s.solo) && !clickStem.solo) : false;
    
    if (prompterData && prompterData.bpm && !isClickMuted) {
      const beatInterval = 60 / prompterData.bpm;
      const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
      
      let shiftedBeatTimes: number[] = [];
      let unshiftedCount = 0;
      
      if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
         let bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
         
         // Extrapolar hacia atrás (para tener metrónomo antes de que entre la batería)
         let firstBeat = bTimes[0];
         while (firstBeat - beatInterval >= 0) {
             firstBeat -= beatInterval;
             bTimes.unshift(firstBeat);
             unshiftedCount++;
         }
         
         // Extrapolar hacia adelante (para tener metrónomo después de que termine la batería)
         let lastBeat = bTimes[bTimes.length - 1];
         const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
         while (lastBeat + beatInterval <= maxTime + 5) {
             lastBeat += beatInterval;
             bTimes.push(lastBeat);
         }
         
         shiftedBeatTimes = bTimes;
      } else {
         const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
         const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
         for (let t = preRollDuration; t <= maxTime; t += beatInterval) {
             const adjusted = t + startOffset;
             if (adjusted >= 0) shiftedBeatTimes.push(adjusted);
         }
      }

      const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? manualGridOffset : 0;
      
      let downbeatIndex = 0;
      if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
         downbeatIndex = prompterData.beatTimes.findIndex((t: number) => Math.abs(t - (prompterData.firstBeatOffset || 0)) < 0.05);
         if (downbeatIndex === -1) downbeatIndex = 0;
         downbeatIndex += unshiftedCount;
      }
      
      let beatCount = 0;
      for (const time of shiftedBeatTimes) {
        const adjustedTime = time + manualOffset;
        if (adjustedTime >= globalOffset) {
          const measureBeat = (beatCount - downbeatIndex) % beatsPerMeasure;
          const normalizedMeasureBeat = ((measureBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
          const isHigh = normalizedMeasureBeat === 0;
          const buffer = isHigh ? clickHighBufferRef.current : clickLowBufferRef.current;
          
          if (buffer && audioContext.current) {
            const source = audioContext.current.createBufferSource();
            source.buffer = buffer;
            
            const masterGain = gainNodes.current.get('synthetic-click');
            if (masterGain) source.connect(masterGain);
            else source.connect(globalMasterGainNode.current!);
            
            source.start(now + (adjustedTime - globalOffset));
            clickSources.current.push(source);
          }
        }
        beatCount++;
      }
    }
    
    // C. Reproducir Cues (Tiempo Real)
    cueSources.current.forEach(src => { try { src.stop(); } catch(e) {} });
    cueSources.current = [];
    
    const cueStem = stems.find(s => s.id === 'synthetic-cues');
    const isCueMuted = cueStem ? cueStem.muted || (stems.some(s => s.solo) && !cueStem.solo) : false;
    
    if (prompterData && prompterData.sections && !isCueMuted && prompterData.bpm) {
      const beatInterval = 60 / prompterData.bpm;
      
      let bTimes: number[] = [];
      
      if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
         bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
         
         // Extrapolar hacia atrás
         let firstBeat = bTimes[0];
         while (firstBeat - beatInterval >= 0) {
             firstBeat -= beatInterval;
             bTimes.unshift(firstBeat);
         }
         
         // Extrapolar hacia adelante
         let lastBeat = bTimes[bTimes.length - 1];
         const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
         while (lastBeat + beatInterval <= maxTime + 5) {
             lastBeat += beatInterval;
             bTimes.push(lastBeat);
         }
      } else {
         const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
         const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
         for (let t = preRollDuration; t <= maxTime; t += beatInterval) {
             const adjusted = t + startOffset;
             if (adjusted >= 0) bTimes.push(adjusted);
         }
      }

      const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? manualGridOffset : 0;

      const schedule = (bufName: string, bIdx: number) => {
            const buf = cueBuffersRef.current[bufName];
            const cueOffset = cueOffsetsRef.current[bufName] || 0;
            if (buf && bIdx >= 0 && bIdx < bTimes.length) {
               const absoluteTime = bTimes[bIdx] + manualOffset;
               if (absoluteTime >= globalOffset) {
                  const source = audioContext.current!.createBufferSource();
                  const gain = audioContext.current!.createGain();
                  source.buffer = buf;
                  gain.gain.value = 1.0;
                  source.connect(gain);
                  
                  const masterGain = gainNodes.current.get('synthetic-cues');
                  if (masterGain) gain.connect(masterGain);
                  else gain.connect(globalMasterGainNode.current!);
                  
                  // Iniciar la reproducción saltando exactamente el silencio detectado en el cueOffset
                  source.start(now + (absoluteTime - globalOffset), cueOffset);
                  cueSources.current.push(source);
               }
            }
         };

         const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
         scheduleSectionVoiceCues(
            prompterData.sections,
            bTimes,
            beatsPerMeasure,
            preRollDuration,
            cueBuffersRef.current,
            schedule
         );
    }
    
    startTime.current = now - globalOffset;
    setIsPlaying(true);
    isPlayingRef.current = true;
    updateTime();
  };

  const pause = () => {
    if (!audioContext.current) return;
    sourceNodes.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    clickSources.current.forEach(src => { try { src.stop(); } catch (e) {} });
    cueSources.current.forEach(src => { try { src.stop(); } catch (e) {} });
    
    pauseTime.current = audioContext.current.currentTime - startTime.current;
    setIsPlaying(false);
    isPlayingRef.current = false;
    cancelAnimationFrame(animationFrame.current);
  };

  const updateTime = () => {
    if (!audioContext.current || !isPlayingRef.current) return;
    
    const globalTime = audioContext.current.currentTime - startTime.current;
    const visualTime = globalTime - preRollDurationRef.current;
    
    // 5. Vamp / Loop Logic (Requiere adaptar globalTime vs visualTime si se usa)
    if (loopState.current.isLooping && visualTime >= loopState.current.end) {
      pause();
      pauseTime.current = loopState.current.start + preRollDurationRef.current;
      play();
      return;
    }

    // Auto-stop al final de la canción
    if (totalDuration > 0 && globalTime >= totalDuration + preRollDurationRef.current) {
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
    const wasPlaying = isPlayingRef.current;
    
    if (wasPlaying) {
      pause();
    }
    
    const preRollDuration = preRollDurationRef.current;
    // Permitir buscar desde -preRollDuration hasta totalDuration
    const globalTime = Math.max(0, Math.min(newVisualTime + preRollDuration, (totalDuration > 0 ? totalDuration : 600) + preRollDuration));
    pauseTime.current = globalTime;
    setCurrentTime(newVisualTime);
    
    if (wasPlaying) {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      seekTimeoutRef.current = window.setTimeout(() => play(), 50);
    }
  };

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

    const renderMix = async (isFoh: boolean): Promise<{ buffer: AudioBuffer, blob: Blob }> => {
      onProgress(`Preparando renderizado ${isFoh ? 'FOH' : 'CUE'}...`);
      const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);
      
      const manualGridOffset = manualGridOffsetRef.current;
      const preRollDuration = calculatedPreRoll;

      // Render Stems
      stems.forEach(stem => {
        // FOH: Only Music. CUE: Only Click & Cues (and maybe Music if they didn't mute it? No, user wants CUE to be click+cue, FOH to be music).
        // Actually, the user asked for FOH = Stereo Music, CUE = Stereo Click+Cue.
        // Let's filter:
        const isMusic = stem.type === 'Instrument';
        if (isFoh && !isMusic) return; // FOH only gets instruments
        if (!isFoh && isMusic) return; // CUE only gets click and cues

        const isMuted = stem.muted;
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

      // Render Clicks (Only for CUE)
      if (!isFoh && prompterData && prompterData.bpm) {
        const clickStem = stems.find(s => s.id === 'synthetic-click');
        if (!clickStem || !clickStem.muted) {
           const beatInterval = 60 / prompterData.bpm;
           const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
           let shiftedBeatTimes: number[] = [];
           let unshiftedCount = 0;
           
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              let bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
              
              // Extrapolar hacia atrás
              let firstBeat = bTimes[0];
              while (firstBeat - beatInterval >= 0) {
                  firstBeat -= beatInterval;
                  bTimes.unshift(firstBeat);
                  unshiftedCount++;
              }
              
              // Extrapolar hacia adelante
              let lastBeat = bTimes[bTimes.length - 1];
              const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
              while (lastBeat + beatInterval <= maxTime + 5) {
                  lastBeat += beatInterval;
                  bTimes.push(lastBeat);
              }
              
              shiftedBeatTimes = bTimes;
           } else {
              const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
              for (let t = 0; t <= lengthSeconds; t += beatInterval) {
                  const adjusted = t + startOffset;
                  if (adjusted >= 0) shiftedBeatTimes.push(adjusted);
              }
           }

           const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? manualGridOffset : 0;
           
           let downbeatIndex = 0;
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              downbeatIndex = prompterData.beatTimes.findIndex((t: number) => Math.abs(t - (prompterData.firstBeatOffset || 0)) < 0.05);
              if (downbeatIndex === -1) downbeatIndex = 0;
              downbeatIndex += unshiftedCount;
           }
           
           let beatCount = 0;
           for (const time of shiftedBeatTimes) {
             const adjustedTime = time + manualOffset;
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
      }

      // Render Cues (Only for CUE)
      if (!isFoh && prompterData && prompterData.sections && prompterData.bpm) {
        const cueStem = stems.find(s => s.id === 'synthetic-cues');
        if (!cueStem || !cueStem.muted) {
           const beatInterval = 60 / prompterData.bpm;
           
           let bTimes: number[] = [];
           
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
              
              // Extrapolar hacia atrás
              let firstBeat = bTimes[0];
              while (firstBeat - beatInterval >= 0) {
                  firstBeat -= beatInterval;
                  bTimes.unshift(firstBeat);
              }
              
              // Extrapolar hacia adelante
              let lastBeat = bTimes[bTimes.length - 1];
              const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
              while (lastBeat + beatInterval <= maxTime + 5) {
                  lastBeat += beatInterval;
                  bTimes.push(lastBeat);
              }
           } else {
              const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
              for (let t = 0; t <= lengthSeconds; t += beatInterval) {
                  const adjusted = t + startOffset;
                  if (adjusted >= 0) bTimes.push(adjusted);
              }
           }
           const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? manualGridOffset : 0;

           const schedule = (bufName: string, bIdx: number) => {
                 const buf = cueBuffersRef.current[bufName];
                 const cueOffset = cueOffsetsRef.current[bufName] || 0;
                 if (buf && bIdx >= 0 && bIdx < bTimes.length) {
                    const absoluteTime = bTimes[bIdx] + manualOffset;
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

              const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
              scheduleSectionVoiceCues(
                 prompterData.sections,
                 bTimes,
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
      const { error: fohError } = await import('../lib/supabase').then(m => m.supabase.storage
        .from('audios')
        .upload(fohPath, fohBlob, { contentType: 'audio/wav', upsert: true }));
      if (fohError) throw fohError;
      const fohUrl = await import('../lib/supabase').then(m => m.supabase.storage.from('audios').getPublicUrl(fohPath).data.publicUrl);
      
      onProgress('Subiendo CUE a la nube...');
      const cuePath = `${bandId}/${songId}/mixes/cue_${Date.now()}.wav`;
      const { error: cueError } = await import('../lib/supabase').then(m => m.supabase.storage
        .from('audios')
        .upload(cuePath, cueBlob, { contentType: 'audio/wav', upsert: true }));
      if (cueError) throw cueError;
      const cueUrl = await import('../lib/supabase').then(m => m.supabase.storage.from('audios').getPublicUrl(cuePath).data.publicUrl);

      // MP3 Uploads (Versión Ligera Móvil)
      onProgress('Codificando MP3 FOH Ligero (Modo Ensayo)...');
      const fohMp3Blob = await audioBufferToMp3Blob(fohResult.buffer, 192);
      const fohMp3Path = `${bandId}/${songId}/mixes/foh_mobile_${Date.now()}.mp3`;
      await import('../lib/supabase').then(m => m.supabase.storage.from('audios').upload(fohMp3Path, fohMp3Blob, { contentType: 'audio/mpeg', upsert: true }));
      const fohMobileUrl = await import('../lib/supabase').then(m => m.supabase.storage.from('audios').getPublicUrl(fohMp3Path).data.publicUrl);

      onProgress('Codificando MP3 CUE Ligero (Modo Ensayo)...');
      const cueMp3Blob = await audioBufferToMp3Blob(cueResult.buffer, 192);
      const cueMp3Path = `${bandId}/${songId}/mixes/cue_mobile_${Date.now()}.mp3`;
      await import('../lib/supabase').then(m => m.supabase.storage.from('audios').upload(cueMp3Path, cueMp3Blob, { contentType: 'audio/mpeg', upsert: true }));
      const cueMobileUrl = await import('../lib/supabase').then(m => m.supabase.storage.from('audios').getPublicUrl(cueMp3Path).data.publicUrl);

      onProgress('Guardando URLs en la base de datos...');
      await import('../lib/supabase').then(m => m.supabase.from('songs').update({
        foh_mix_url: fohUrl,
        cue_mix_url: cueUrl,
        foh_mobile_url: fohMobileUrl,
        cue_mobile_url: cueMobileUrl
      }).eq('id', songId));

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

  // Asegurar que los audios de voz guía estén cargados en RAM incluso antes de Cargar Stems
  const ensureCueBuffersLoaded = useCallback(async () => {
    if (!audioContext.current) return;
    if (audioContext.current.state === 'suspended') {
      try { await audioContext.current.resume(); } catch {}
    }
    const cueNames = ['intro', 'verso', 'pre-coro', 'coro', 'puente', 'solo', 'final', '1', '2', '3', '4'];
    const missing = cueNames.filter((n) => !cueBuffersRef.current[n]);
    if (missing.length === 0) return;

    await Promise.all(
      missing.map(async (name) => {
        try {
          const res = await fetch(`/cues/${name}.mp3`);
          if (res.ok && audioContext.current) {
            const arrayBuffer = await res.arrayBuffer();
            const audioBuffer = await audioContext.current.decodeAudioData(arrayBuffer);
            cueBuffersRef.current[name] = audioBuffer;
            const data = audioBuffer.getChannelData(0);
            let startSample = 0;
            for (let i = 0; i < data.length; i++) {
              if (Math.abs(data[i]) > 0.05) {
                startSample = i;
                break;
              }
            }
            cueOffsetsRef.current[name] = startSample / audioBuffer.sampleRate;
          }
        } catch {}
      })
    );
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

  // Sincronización en caliente de prompterData en RAM (reprograma Voz Guía al vuelo sin cortar la música)
  const syncPrompterData = useCallback((nextPrompterData: any) => {
    prompterDataRef.current = nextPrompterData;
    if (!isPlayingRef.current || !audioContext.current) return;

    cueSources.current.forEach((src) => {
      try { src.stop(); } catch {}
    });
    cueSources.current = [];

    const cueStem = stems.find((s) => s.id === 'synthetic-cues');
    const isCueMuted = cueStem ? cueStem.muted || (stems.some((s) => s.solo) && !cueStem.solo) : false;
    if (!nextPrompterData || !nextPrompterData.sections || isCueMuted || !nextPrompterData.bpm) return;

    const now = audioContext.current.currentTime;
    const globalOffset = now - startTime.current;
    const preRollDuration = preRollDurationRef.current;
    const manualGridOffset = manualGridOffsetRef.current;
    const beatInterval = 60 / nextPrompterData.bpm;
    let bTimes: number[] = [];

    if (nextPrompterData.beatTimes && nextPrompterData.beatTimes.length > 0) {
      bTimes = [...nextPrompterData.beatTimes.map((t: number) => t + preRollDuration)];
      let firstBeat = bTimes[0];
      while (firstBeat - beatInterval >= 0) {
        firstBeat -= beatInterval;
        bTimes.unshift(firstBeat);
      }
      let lastBeat = bTimes[bTimes.length - 1];
      const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
      while (lastBeat + beatInterval <= maxTime + 5) {
        lastBeat += beatInterval;
        bTimes.push(lastBeat);
      }
    } else {
      const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
      const startOffset = (nextPrompterData.firstBeatOffset || 0) + manualGridOffset;
      for (let t = preRollDuration; t <= maxTime; t += beatInterval) {
        const adjusted = t + startOffset;
        if (adjusted >= 0) bTimes.push(adjusted);
      }
    }

    const manualOffset = nextPrompterData.beatTimes && nextPrompterData.beatTimes.length > 0 ? manualGridOffset : 0;
    const schedule = (bufName: string, bIdx: number) => {
      const buf = cueBuffersRef.current[bufName];
      const cueOffset = cueOffsetsRef.current[bufName] || 0;
      if (buf && bIdx >= 0 && bIdx < bTimes.length && audioContext.current) {
        const absoluteTime = bTimes[bIdx] + manualOffset;
        if (absoluteTime >= globalOffset) {
          const source = audioContext.current.createBufferSource();
          const gain = audioContext.current.createGain();
          source.buffer = buf;
          gain.gain.value = 1.0;
          source.connect(gain);

          const masterGain = gainNodes.current.get('synthetic-cues');
          if (masterGain) gain.connect(masterGain);
          else gain.connect(globalMasterGainNode.current!);

          source.start(now + (absoluteTime - globalOffset), cueOffset);
          cueSources.current.push(source);
        }
      }
    };

    const beatsPerMeasure = parseInt(nextPrompterData.timeSignature?.split('/')[0]) || 4;
    scheduleSectionVoiceCues(
      nextPrompterData.sections,
      bTimes,
      beatsPerMeasure,
      preRollDuration,
      cueBuffersRef.current,
      schedule
    );
  }, [stems, totalDuration]);

  if (false) {
  };

  const exportGhostBounce = async (onProgress: (msg: string) => void): Promise<Blob> => {
    if (!audioContext.current) throw new Error("AudioContext not initialized");
    if (buffers.current.size === 0) throw new Error("Las pistas no están cargadas en memoria. Por favor presiona 'Cargar a RAM' primero.");
    
    let maxBufDuration = totalDuration;
    buffers.current.forEach(buf => {
       if (buf.duration > maxBufDuration) maxBufDuration = buf.duration;
    });

    const sampleRate = audioContext.current.sampleRate;
    const lengthSeconds = maxBufDuration + preRollDurationRef.current + 5; 
    const lengthSamples = Math.ceil(lengthSeconds * sampleRate);

    onProgress('Preparando Ghost Bounce...');
    const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);
    
    const preRollDuration = preRollDurationRef.current;

    stems.forEach(stem => {
      const isMusic = stem.type === 'Instrument';
      if (!isMusic) return; 

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
      
      source.start(preRollDuration);
    });

    onProgress('Renderizando Ghost Bounce...');
    const renderedBuffer = await offlineCtx.startRendering();
    
    onProgress('Codificando WAV...');
    return audioBufferToWavBlob(renderedBuffer);
  };

  const exportMultitrackToZip = async (songName: string, currentPrompterData: any, onProgress: (msg: string) => void) => {
    if (!audioContext.current) throw new Error("AudioContext not initialized");
    if (buffers.current.size === 0) throw new Error("Las pistas no están cargadas en memoria. Por favor presiona 'Cargar a RAM' primero.");
    
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

    for (let i = 0; i < stems.length; i++) {
      const stem = stems[i];
      onProgress(`Renderizando ${stem.name} (${i+1}/${stems.length})...`);
      
      const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);
      
      if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
        const prompterData = currentPrompterData || prompterDataRef.current;
        const manualGridOffset = manualGridOffsetRef.current;
        
        if (stem.id === 'synthetic-click' && prompterData && prompterData.bpm) {
           const beatInterval = 60 / prompterData.bpm;
           const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
           let shiftedBeatTimes: number[] = [];
           let unshiftedCount = 0;
           
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              let bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
              let firstBeat = bTimes[0];
              while (firstBeat - beatInterval >= 0) {
                  firstBeat -= beatInterval;
                  bTimes.unshift(firstBeat);
                  unshiftedCount++;
              }
              let lastBeat = bTimes[bTimes.length - 1];
              const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
              while (lastBeat + beatInterval <= maxTime + 5) {
                  lastBeat += beatInterval;
                  bTimes.push(lastBeat);
              }
              shiftedBeatTimes = bTimes;
           } else {
              const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
              for (let t = 0; t <= lengthSeconds; t += beatInterval) {
                  const adjusted = t + startOffset;
                  if (adjusted >= 0) shiftedBeatTimes.push(adjusted);
              }
           }

           const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? manualGridOffset : 0;
           
           let downbeatIndex = 0;
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              downbeatIndex = prompterData.beatTimes.findIndex((t: number) => Math.abs(t - (prompterData.firstBeatOffset || 0)) < 0.05);
              if (downbeatIndex === -1) downbeatIndex = 0;
              downbeatIndex += unshiftedCount;
           }
           
           let beatCount = 0;
           for (const time of shiftedBeatTimes) {
             const adjustedTime = time + manualOffset;
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
           const beatInterval = 60 / prompterData.bpm;
           let bTimes: number[] = [];
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
              let firstBeat = bTimes[0];
              while (firstBeat - beatInterval >= 0) {
                  firstBeat -= beatInterval;
                  bTimes.unshift(firstBeat);
              }
              let lastBeat = bTimes[bTimes.length - 1];
              const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
              while (lastBeat + beatInterval <= maxTime + 5) {
                  lastBeat += beatInterval;
                  bTimes.push(lastBeat);
              }
           } else {
              const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
              for (let t = 0; t <= lengthSeconds; t += beatInterval) {
                  const adjusted = t + startOffset;
                  if (adjusted >= 0) bTimes.push(adjusted);
              }
           }
           const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? manualGridOffset : 0;

           const schedule = (bufName: string, bIdx: number) => {
                 const buf = cueBuffersRef.current[bufName];
                 const cueOffset = cueOffsetsRef.current[bufName] || 0;
                 if (buf && bIdx >= 0 && bIdx < bTimes.length) {
                    const absoluteTime = bTimes[bIdx] + manualOffset;
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

              const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
              scheduleSectionVoiceCues(
                 prompterData.sections,
                 bTimes,
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

    stems.forEach(stem => {
      const isMuted = stem.muted;
      if (isMuted) return;

      if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
         if (stem.id === 'synthetic-click' && prompterData && prompterData.bpm) {
           const beatInterval = 60 / prompterData.bpm;
           const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
           let shiftedBeatTimes: number[] = [];
           let unshiftedCount = 0;
           
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              let bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
              let firstBeat = bTimes[0];
              while (firstBeat - beatInterval >= 0) {
                  firstBeat -= beatInterval;
                  bTimes.unshift(firstBeat);
                  unshiftedCount++;
              }
              let lastBeat = bTimes[bTimes.length - 1];
              const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
              while (lastBeat + beatInterval <= maxTime + 5) {
                  lastBeat += beatInterval;
                  bTimes.push(lastBeat);
              }
              shiftedBeatTimes = bTimes;
           } else {
              const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
              for (let t = 0; t <= lengthSeconds; t += beatInterval) {
                  const adjusted = t + startOffset;
                  if (adjusted >= 0) shiftedBeatTimes.push(adjusted);
              }
           }

           const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? manualGridOffset : 0;
           
           let downbeatIndex = 0;
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              downbeatIndex = prompterData.beatTimes.findIndex((t: number) => Math.abs(t - (prompterData.firstBeatOffset || 0)) < 0.05);
              if (downbeatIndex === -1) downbeatIndex = 0;
              downbeatIndex += unshiftedCount;
           }
           
           let beatCount = 0;
           for (const time of shiftedBeatTimes) {
             const adjustedTime = time + manualOffset;
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
           const beatInterval = 60 / prompterData.bpm;
           let bTimes: number[] = [];
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
              let firstBeat = bTimes[0];
              while (firstBeat - beatInterval >= 0) {
                  firstBeat -= beatInterval;
                  bTimes.unshift(firstBeat);
              }
              let lastBeat = bTimes[bTimes.length - 1];
              const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
              while (lastBeat + beatInterval <= maxTime + 5) {
                  lastBeat += beatInterval;
                  bTimes.push(lastBeat);
              }
           } else {
              const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
              for (let t = 0; t <= lengthSeconds; t += beatInterval) {
                  const adjusted = t + startOffset;
                  if (adjusted >= 0) bTimes.push(adjusted);
              }
           }
           const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? manualGridOffset : 0;

           const schedule = (bufName: string, bIdx: number) => {
                 const buf = cueBuffersRef.current[bufName];
                 const cueOffset = cueOffsetsRef.current[bufName] || 0;
                 if (buf && bIdx >= 0 && bIdx < bTimes.length) {
                    const absoluteTime = bTimes[bIdx] + manualOffset;
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

              const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
              scheduleSectionVoiceCues(
                 prompterData.sections,
                 bTimes,
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
    
    // Inject lame.all.js globally to bypass Vite strict mode and missing CommonJS requirements
    if (!(window as any).lamejs) {
        const lamejsSrc = await import('lamejs/lame.all.js?raw');
        const script = document.createElement('script');
        script.innerHTML = lamejsSrc.default + '\nwindow.lamejs = lamejs;';
        document.head.appendChild(script);
    }
    const lamejs = (window as any).lamejs;
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
    preRollDuration: preRollDurationRef.current,
    exportLiveMix,
    exportGhostBounce,
    exportMultitrackToZip,
    exportFullMixToMp3,
    getBuffer,
    getCompositePeaks,
    previewVoiceCue,
    syncPrompterData
  };
};

export const audioBufferToMp3Blob = async (renderedBuffer: AudioBuffer, bitrate: number = 192): Promise<Blob> => {
    if (!(window as any).lamejs) {
        const lamejsSrc = await import('lamejs/lame.all.js?raw');
        const script = document.createElement('script');
        script.innerHTML = lamejsSrc.default + '\nwindow.lamejs = lamejs;';
        document.head.appendChild(script);
    }
    const lamejs = (window as any).lamejs;

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