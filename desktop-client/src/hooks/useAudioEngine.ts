import { useRef, useState, useEffect, useCallback } from 'react';

export type StemType = 'Click' | 'Cues' | 'Instrument';
export type RoutingMode = 'StereoSplit' | 'MultiChannel';

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

const generateClickBuffer = (ctx: AudioContext, frequency: number) => {
  const sampleRate = ctx.sampleRate;
  const duration = 0.05;
  const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 80); 
    // Usamos Math.cos para generar un transitorio (transient) instantáneo en t=0 (pico máximo inicial)
    data[i] = Math.cos(2 * Math.PI * frequency * t) * env * 0.8;
  }
  return buffer;
};

export const useAudioEngine = (initialStems: StemTrack[]) => {
  const audioContext = useRef<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('StereoSplit');
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
    
    // --- AUTO-ADAPTACIÓN RÍTMICA (COMPENSACIÓN DE LATENCIA EN NAVEGADOR) ---
    const drumStem = activeStemsArray.find(s => s.name.toLowerCase().includes('drum') || s.name.toLowerCase().includes('bater') || s.name.toLowerCase().includes('perc'));
    if (drumStem && buffers.current.has(drumStem.id) && prompterData && prompterData.beatTimes && prompterData.beatTimes.length > 0) {
        try {
            setLoadProgress({ loaded: activeStemsArray.length, total: activeStemsArray.length, currentFile: `Sincronizando transitorios...` });
            const drumBuffer = buffers.current.get(drumStem.id)!;
            const data = drumBuffer.getChannelData(0);
            const sr = drumBuffer.sampleRate;
            const windowSamples = Math.floor(0.1 * sr); // Ventana de ±100ms
            
            let offsets: number[] = [];
            // Analizamos los primeros 16 golpes para calcular el offset global (padding del MP3 en Chrome)
            const beatsToAnalyze = Math.min(16, prompterData.beatTimes.length);
            
            for (let i = 0; i < beatsToAnalyze; i++) {
                const originalTime = prompterData.beatTimes[i];
                const centerSample = Math.floor(originalTime * sr);
                const startSample = Math.max(0, centerSample - windowSamples);
                const endSample = Math.min(data.length, centerSample + windowSamples);
                
                let maxEnergy = 0;
                let peakSample = centerSample;
                
                // Encontrar el pico exacto de energía (ataque del transitorio)
                for (let j = startSample; j < endSample; j++) {
                    const energy = Math.abs(data[j]);
                    if (energy > maxEnergy) {
                        maxEnergy = energy;
                        peakSample = j;
                    }
                }
                
                // Si el pico es lo suficientemente fuerte como para ser considerado un golpe
                if (maxEnergy > 0.1) {
                    offsets.push((peakSample - centerSample) / sr);
                }
            }
            
            if (offsets.length > 0) {
                // Tomar la mediana de los offsets para ignorar anomalías (fills) y obtener el padding exacto
                offsets.sort((a, b) => a - b);
                const medianOffset = offsets[Math.floor(offsets.length / 2)];
                
                console.log(`[Auto-Sync] Compensación de latencia de decodificación aplicada: ${medianOffset * 1000}ms`);
                
                // Aplicar compensación a toda la grilla de la canción
                prompterData.beatTimes = prompterData.beatTimes.map((t: number) => t + medianOffset);
                if (prompterData.firstBeatOffset !== undefined) {
                    prompterData.firstBeatOffset += medianOffset;
                }
                if (prompterData.sections) {
                    prompterData.sections = prompterData.sections.map((s: any) => ({...s, time: s.time + medianOffset}));
                }
            }
        } catch (e) {
            console.error("[Auto-Sync] Error en compensación rítmica:", e);
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
      console.warn("Hardware interface only supports", maxChannels, "channels. Falling back to StereoSplit.");
      setRoutingMode('StereoSplit');
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
         if (routingMode === 'StereoSplit') {
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
      
      if (routingMode === 'StereoSplit') {
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

      prompterData.sections.forEach((section: any) => {
         const secTime = section.time + preRollDuration;
         let nearestBeatIdx = 0;
         let minDiff = Infinity;
         for (let i = 0; i < bTimes.length; i++) {
            const diff = Math.abs(bTimes[i] - secTime);
            if (diff < minDiff) { minDiff = diff; nearestBeatIdx = i; }
         }
         
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
         
         let sName = (section.name || section.section || '').toLowerCase();
         if (!cueBuffersRef.current[sName]) sName = '';
         
         if (section.time < 0.5) {
            if (sName) schedule(sName, 0);
            schedule('3', 1); schedule('2', 2); schedule('1', 3);
         } else if (minDiff < 1.0 && nearestBeatIdx >= 4) {
            if (sName) schedule(sName, nearestBeatIdx - 4);
            schedule('3', nearestBeatIdx - 3); schedule('2', nearestBeatIdx - 2); schedule('1', nearestBeatIdx - 1);
         }
      });
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
    const globalTime = Math.max(0, Math.min(newVisualTime + preRollDuration, totalDuration + preRollDuration));
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

    const renderMix = async (isFoh: boolean): Promise<Blob> => {
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

           prompterData.sections.forEach((section: any) => {
              const secTime = section.time + preRollDuration;
              let nearestBeatIdx = 0;
              let minDiff = Infinity;
              for (let i = 0; i < bTimes.length; i++) {
                 const diff = Math.abs(bTimes[i] - secTime);
                 if (diff < minDiff) { minDiff = diff; nearestBeatIdx = i; }
              }
              
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
              
              let sName = (section.name || section.section || '').toLowerCase();
              if (!cueBuffersRef.current[sName]) sName = '';
              
              if (section.time < 0.5) {
                 if (sName) schedule(sName, 0);
                 schedule('3', 1); schedule('2', 2); schedule('1', 3);
              } else if (minDiff < 1.0 && nearestBeatIdx >= 4) {
                 if (sName) schedule(sName, nearestBeatIdx - 4);
                 schedule('3', nearestBeatIdx - 3); schedule('2', nearestBeatIdx - 2); schedule('1', nearestBeatIdx - 1);
              }
           });
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

           prompterData.sections.forEach((section: any) => {
              const secTime = section.time + preRollDuration;
              let nearestBeatIdx = 0;
              let minDiff = Infinity;
              for (let j = 0; j < bTimes.length; j++) {
                 const diff = Math.abs(bTimes[j] - secTime);
                 if (diff < minDiff) { minDiff = diff; nearestBeatIdx = j; }
              }
              
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
              
              let sName = (section.name || section.section || '').toLowerCase();
              if (!cueBuffersRef.current[sName]) sName = '';
              
              if (section.time < 0.5) {
                 if (sName) schedule(sName, 0);
                 schedule('3', 1); schedule('2', 2); schedule('1', 3);
              } else if (minDiff < 1.0 && nearestBeatIdx >= 4) {
                 if (sName) schedule(sName, nearestBeatIdx - 4);
                 schedule('3', nearestBeatIdx - 3); schedule('2', nearestBeatIdx - 2); schedule('1', nearestBeatIdx - 1);
              }
           });
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

           prompterData.sections.forEach((section: any) => {
              const secTime = section.time + preRollDuration;
              let nearestBeatIdx = 0;
              let minDiff = Infinity;
              for (let j = 0; j < bTimes.length; j++) {
                 const diff = Math.abs(bTimes[j] - secTime);
                 if (diff < minDiff) { minDiff = diff; nearestBeatIdx = j; }
              }
              
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
              
              let sName = (section.name || section.section || '').toLowerCase();
              if (!cueBuffersRef.current[sName]) sName = '';
              
              if (section.time < 0.5) {
                 if (sName) schedule(sName, 0);
                 schedule('3', 1); schedule('2', 2); schedule('1', 3);
              } else if (minDiff < 1.0 && nearestBeatIdx >= 4) {
                 if (sName) schedule(sName, nearestBeatIdx - 4);
                 schedule('3', nearestBeatIdx - 3); schedule('2', nearestBeatIdx - 2); schedule('1', nearestBeatIdx - 1);
              }
           });
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
    getBuffer
  };
};
 
 e x p o r t   c o n s t   a u d i o B u f f e r T o M p 3 B l o b   =   a s y n c   ( r e n d e r e d B u f f e r :   A u d i o B u f f e r ,   b i t r a t e :   n u m b e r   =   1 9 2 ) :   P r o m i s e < B l o b >   = >   {  
     i f   ( ! ( w i n d o w   a s   a n y ) . l a m e j s )   {  
             c o n s t   l a m e j s S r c   =   a w a i t   i m p o r t ( ' l a m e j s / l a m e . a l l . j s ? r a w ' ) ;  
             c o n s t   s c r i p t   =   d o c u m e n t . c r e a t e E l e m e n t ( ' s c r i p t ' ) ;  
             s c r i p t . i n n e r H T M L   =   l a m e j s S r c . d e f a u l t   +   ' \ n w i n d o w . l a m e j s   =   l a m e j s ; ' ;  
             d o c u m e n t . h e a d . a p p e n d C h i l d ( s c r i p t ) ;  
     }  
     c o n s t   l a m e j s   =   ( w i n d o w   a s   a n y ) . l a m e j s ;  
     c o n s t   c h a n n e l s   =   r e n d e r e d B u f f e r . n u m b e r O f C h a n n e l s ;  
     c o n s t   s a m p l e R a t e M p 3   =   r e n d e r e d B u f f e r . s a m p l e R a t e ;  
     c o n s t   e n c o d e r   =   n e w   l a m e j s . M p 3 E n c o d e r ( c h a n n e l s ,   s a m p l e R a t e M p 3 ,   b i t r a t e ) ;  
     c o n s t   l e f t   =   r e n d e r e d B u f f e r . g e t C h a n n e l D a t a ( 0 ) ;  
     c o n s t   r i g h t   =   c h a n n e l s   >   1   ?   r e n d e r e d B u f f e r . g e t C h a n n e l D a t a ( 1 )   :   l e f t ;  
     c o n s t   s a m p l e B l o c k S i z e   =   1 1 5 2 ;  
     c o n s t   m p 3 D a t a :   I n t 8 A r r a y [ ]   =   [ ] ;  
     c o n s t   f l o a t T o 1 6 B i t P C M   =   ( i n p u t :   F l o a t 3 2 A r r a y ,   o u t p u t :   I n t 1 6 A r r a y ,   o f f s e t :   n u m b e r ,   l e n g t h :   n u m b e r )   = >   {  
             f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ;   i + + )   {  
                     c o n s t   s   =   M a t h . m a x ( - 1 ,   M a t h . m i n ( 1 ,   i n p u t [ o f f s e t   +   i ] ) ) ;  
                     o u t p u t [ i ]   =   s   <   0   ?   s   *   0 x 8 0 0 0   :   s   *   0 x 7 F F F ;  
             }  
     } ;  
     l e t   s a m p l e O f f s e t   =   0 ;  
     w h i l e   ( s a m p l e O f f s e t   <   l e f t . l e n g t h )   {  
             c o n s t   l e n g t h   =   M a t h . m i n ( s a m p l e B l o c k S i z e ,   l e f t . l e n g t h   -   s a m p l e O f f s e t ) ;  
             c o n s t   l e f t C h u n k 1 6   =   n e w   I n t 1 6 A r r a y ( l e n g t h ) ;  
             c o n s t   r i g h t C h u n k 1 6   =   n e w   I n t 1 6 A r r a y ( l e n g t h ) ;  
             f l o a t T o 1 6 B i t P C M ( l e f t ,   l e f t C h u n k 1 6 ,   s a m p l e O f f s e t ,   l e n g t h ) ;  
             f l o a t T o 1 6 B i t P C M ( r i g h t ,   r i g h t C h u n k 1 6 ,   s a m p l e O f f s e t ,   l e n g t h ) ;  
             c o n s t   m p 3 b u f   =   e n c o d e r . e n c o d e B u f f e r ( l e f t C h u n k 1 6 ,   r i g h t C h u n k 1 6 ) ;  
             i f   ( m p 3 b u f . l e n g t h   >   0 )   m p 3 D a t a . p u s h ( m p 3 b u f ) ;  
             s a m p l e O f f s e t   + =   s a m p l e B l o c k S i z e ;  
             i f   ( s a m p l e O f f s e t   %   ( s a m p l e B l o c k S i z e   *   1 0 0 )   = = =   0 )   a w a i t   n e w   P r o m i s e ( r e s o l v e   = >   s e t T i m e o u t ( r e s o l v e ,   0 ) ) ;  
     }  
     c o n s t   m p 3 b u f   =   e n c o d e r . f l u s h ( ) ;  
     i f   ( m p 3 b u f . l e n g t h   >   0 )   m p 3 D a t a . p u s h ( m p 3 b u f ) ;  
     r e t u r n   n e w   B l o b ( m p 3 D a t a ,   {   t y p e :   ' a u d i o / m p e g '   } ) ;  
 } ;  
 