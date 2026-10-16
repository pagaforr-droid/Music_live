import { useEffect, useState, useRef } from 'react';
import './StemStudio.css';
import { supabase } from '../lib/supabase';
import StemUploader from '../components/StemUploader';
import {
  DSP_PRESETS,
  processAudioBufferDspV2,
  type DspFormat,
  type DspPreset,
  type PitchMode,
} from '../lib/dspDecorrelator';
import { Music, FolderPlus, Disc3, FileAudio, Loader2, Trash2, Sparkles, CheckCircle, RefreshCw, Play, Pause, Plus, Shield, Zap, Cloud } from 'lucide-react';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

const DSP_MIME: Record<DspFormat, string> = { wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg' };
const DSP_POLL_MS = 5000;
const DSP_MAX_POLLS = 720; // 60 min (incluye cold boot de la GPU)

const PRESET_SHORT_LABEL: Record<DspPreset, string> = {
  transparent: 'Transparent',
  stealth: 'Stealth',
  cloak: 'MaxCloak',
};

/** Supabase Storage rechaza acentos y varios símbolos en las rutas. */
const sanitizeFileName = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_');

export default function StemStudio() {
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [stems, setStems] = useState<any[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [loadingStems, setLoadingStems] = useState(false);

  // AI Generator state
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiSuccessMessage, setAiSuccessMessage] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string>('');
  const [timeSignature, setTimeSignature] = useState<string>('4/4');

  // Watermark DSP v2 state
  const [watermarkJobStatus, setWatermarkJobStatus] = useState<'idle' | 'pending' | 'processing' | 'completed' | 'failed'>('idle');
  const [cleanAudioUrl, setCleanAudioUrl] = useState<string | null>(null);
  const [dspMessage, setDspMessage] = useState<string | null>(null);
  const [dspFormat, setDspFormat] = useState<DspFormat>('wav');
  const [dspPreset, setDspPreset] = useState<DspPreset>('stealth');
  const [dspEngine, setDspEngine] = useState<'local' | 'cloud'>('local');
  const [pitchMode, setPitchMode] = useState<PitchMode>('a432_detune');
  const [useAntiSuno, setUseAntiSuno] = useState(true);
  const [useTransientPunch, setUseTransientPunch] = useState(true);
  const [useTapeBed, setUseTapeBed] = useState(true);
  const [useSideBloom, setUseSideBloom] = useState(true);
  const [useGhostMidiBass, setUseGhostMidiBass] = useState(true);
  const [useConstellationPoison, setUseConstellationPoison] = useState(false);
  const [useConstellationTilt, setUseConstellationTilt] = useState(true);
  const [usePhaseDispersion, setUsePhaseDispersion] = useState(true);
  const [decorrelatingStemId, setDecorrelatingStemId] = useState<string | null>(null);
  const [dspTelemetry, setDspTelemetry] = useState<{
    preset: string;
    speedShiftPct: number;
    peakDbtp: number;
    decorrelationPct: number;
    engine: string;
    timeSec?: number;
  } | null>(null);
  const dspBusyRef = useRef(false);
  const mountedRef = useRef(true);
  const selectedSongRef = useRef<string | null>(null);

  // AI Splitter State
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitMessage, setSplitMessage] = useState<string | null>(null);
  const [splitFormat, setSplitFormat] = useState<'mp3' | 'wav'>('mp3');
  
  // Audio Playback State
  const [playingStemId, setPlayingStemId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = (stem: any) => {
    if (playingStemId === stem.id) {
      audioRef.current?.pause();
      setPlayingStemId(null);
    } else {
      if (audioRef.current) {
         audioRef.current.src = stem.file_url;
         audioRef.current.play().catch(e => console.error("Playback failed", e));
         setPlayingStemId(stem.id);
      }
    }
  };

  useEffect(() => {
    fetchSongs();
  }, []);

  useEffect(() => {
    selectedSongRef.current = selectedSongId;
    if (selectedSongId) {
      fetchStems(selectedSongId);
      // Stop playing if song changes
      if (audioRef.current) {
        audioRef.current.pause();
        setPlayingStemId(null);
      }
      // Reset DSP state for new song (unless a job is still running; its result
      // will be saved into the song where it was started)
      if (!dspBusyRef.current) {
        setWatermarkJobStatus('idle');
        setCleanAudioUrl(null);
        setDspMessage(null);
        setDspTelemetry(null);
      }
    } else {
      setStems([]);
    }
  }, [selectedSongId]);

  // Stop DSP polling when the page unmounts
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [isUploadingWatermark, setIsUploadingWatermark] = useState(false);

  /**
   * Ejecuta la decorrelación Stealth Master DSP v3 (5 vectores agresivos) tanto para
   * un archivo subido como para una pista ya existente en el proyecto (1-Click Track Decorrelation).
   */
  const executeDspDecorrelation = async (params: {
    file?: File;
    existingStem?: any;
  }) => {
    const { file, existingStem } = params;
    if ((!file && !existingStem) || !selectedSongId || dspBusyRef.current) return;

    const targetSongId = selectedSongId;
    const format = dspFormat;
    const preset = dspPreset;
    const engine = dspEngine;
    const mime = DSP_MIME[format];
    const ts = Date.now();

    const rawName = file ? file.name : (existingStem?.name || 'Track');
    const baseName = rawName.replace(/\.[^.]+$/, '').replace(/\s*\(DSP[^)]*\)\s*$/i, '') || rawName;
    const presetLabel = PRESET_SHORT_LABEL[preset];
    const outputPath = `${FAKE_BAND_ID}/${targetSongId}/${ts}_${sanitizeFileName(baseName)}_DSP_${preset}.${format}`;

    let inputPath = '';
    let inputUploaded = false;

    dspBusyRef.current = true;
    if (existingStem?.id) setDecorrelatingStemId(existingStem.id);
    setWatermarkJobStatus('pending');
    setCleanAudioUrl(null);
    setDspTelemetry(null);

    const runLocalPipeline = async (): Promise<{
      finalUrl: string;
      speedShiftPct: number;
      peakDbtp: number;
      decorrelationPct: number;
      timeSec: number;
    }> => {
      setWatermarkJobStatus('processing');
      setDspMessage(
        file
          ? '[1/5] Decodificando archivo de audio en Motor Local DSP v3...'
          : `[1/5] Descargando y decodificando "${existingStem.name}"...`
      );

      const arrayBuffer = file
        ? await file.arrayBuffer()
        : await (async () => {
            const res = await fetch(existingStem.file_url);
            if (!res.ok) throw new Error(`No se pudo descargar la pista (${res.status})`);
            return res.arrayBuffer();
          })();

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: 44100 });
      let decodedBuffer: AudioBuffer;
      try {
        decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      } finally {
        audioCtx.close().catch(() => {});
      }

      const result = await processAudioBufferDspV2(
        decodedBuffer,
        preset,
        format,
        (stepMsg) => {
          if (mountedRef.current) setDspMessage(`DSP v4 • ${stepMsg}`);
        },
        {
          pitchMode: pitchMode,
          lockOriginalPitch: pitchMode === 'lock_440',
          antiSunoHumanizer: useAntiSuno,
          humanTransientPunch: useTransientPunch,
          tapeWarmthBed: useTapeBed,
          sideBloom: useSideBloom,
          ghostMidiBass: useGhostMidiBass,
          constellationPoison: useConstellationPoison,
          constellationTilt: useConstellationTilt,
          phaseDispersion: usePhaseDispersion,
        }
      );

      if (mountedRef.current) {
        setIsUploadingWatermark(true);
        setDspMessage('Subiendo Master Decorrelacionado a Supabase Storage...');
      }

      const { error: saveError } = await supabase.storage
        .from('audios')
        .upload(outputPath, result.blob, { contentType: mime, upsert: true });
      if (saveError) throw new Error(`Error guardando el resultado en Storage: ${saveError.message}`);

      const finalUrl = supabase.storage.from('audios').getPublicUrl(outputPath).data.publicUrl;
      return {
        finalUrl,
        speedShiftPct: result.speedShiftPct,
        peakDbtp: result.peakDbtp,
        decorrelationPct: result.decorrelationPct,
        timeSec: result.processingTimeSec,
      };
    };

    try {
      let finalUrl = '';
      let speedShiftPct = 3.2;
      let peakDbtp = -0.3;
      let decorrelationPct = preset === 'cloak' ? 98.2 : preset === 'stealth' ? 92.4 : 78.5;
      let usedEngine: 'local' | 'cloud' = engine;
      let timeSec: number | undefined;
      let predictionId: string | undefined;

      if (engine === 'local') {
        const localRes = await runLocalPipeline();
        finalUrl = localRes.finalUrl;
        speedShiftPct = localRes.speedShiftPct;
        peakDbtp = localRes.peakDbtp;
        decorrelationPct = localRes.decorrelationPct;
        timeSec = localRes.timeSec;
      } else {
        try {
          const tCloud0 = performance.now();
          let audioUrl = existingStem?.file_url || '';

          if (file) {
            setIsUploadingWatermark(true);
            setDspMessage('Subiendo archivo original para Cloud Worker...');
            inputPath = `${FAKE_BAND_ID}/temp/dsp_${ts}_${sanitizeFileName(file.name)}`;
            const { error: uploadError } = await supabase.storage
              .from('audios')
              .upload(inputPath, file, { contentType: file.type || undefined });
            if (uploadError) throw new Error(`Error subiendo audio: ${uploadError.message}`);
            inputUploaded = true;
            audioUrl = supabase.storage.from('audios').getPublicUrl(inputPath).data.publicUrl;
          }

          const { data: signed, error: signError } = await supabase.storage
            .from('audios')
            .createSignedUploadUrl(outputPath);
          if (signError) console.warn('[DSP] Sin URL firmada, se usará la salida de Replicate:', signError.message);

          setIsUploadingWatermark(false);
          setDspMessage(`Iniciando job Cloud DSP v3 (${presetLabel})...`);

          const startRes = await fetch('/api/ai/watermark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioUrl,
              uploadUrl: signed?.signedUrl,
              jobId: String(ts),
              outputFormat: format,
              preset,
              pitchMode,
              lockOriginalPitch: pitchMode === 'lock_440',
              antiSunoHumanizer: useAntiSuno,
              humanTransientPunch: useTransientPunch,
              tapeWarmthBed: useTapeBed,
              sideBloom: useSideBloom,
              ghostMidiBass: useGhostMidiBass,
              constellationPoison: useConstellationPoison,
            }),
          });
          const startData = await startRes.json().catch(() => ({}));
          if (!startRes.ok) throw new Error(startData.error || `Error ${startRes.status} al iniciar el job DSP`);
          predictionId = startData.predictionId;

          let output: any = null;
          for (let poll = 1; poll <= DSP_MAX_POLLS; poll++) {
            await new Promise((r) => setTimeout(r, DSP_POLL_MS));
            if (!mountedRef.current) return;

            const statusRes = await fetch('/api/ai/watermark-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ predictionId }),
            });
            const statusData = await statusRes.json().catch(() => ({}));
            if (!statusRes.ok) throw new Error(statusData.error || `Error ${statusRes.status} consultando el job`);

            if (statusData.done) {
              if (statusData.failed) throw new Error(statusData.error || 'El worker DSP falló');
              output = statusData.output;
              break;
            }

            if (statusData.status === 'starting') {
              setWatermarkJobStatus('pending');
              setDspMessage(`Despertando contenedor Cloud... (${poll})`);
            } else {
              setWatermarkJobStatus('processing');
              setDspMessage(
                statusData.step
                  ? `Cloud ${statusData.step}`
                  : `Decorrelacionando audio en Cloud (${presetLabel})... (${poll})`
              );
            }
          }
          if (output == null) throw new Error('Tiempo de espera agotado para el job DSP');

          setDspMessage('Guardando resultado en Storage...');
          const uploadedByWorker = signed && (output?.uploaded === true || output === 'uploaded');
          if (!uploadedByWorker) {
            const replicateUrl = typeof output === 'string' ? output : output?.file;
            if (typeof replicateUrl !== 'string' || !replicateUrl.startsWith('http')) {
              throw new Error('El worker no devolvió un archivo válido');
            }
            const fileRes = await fetch(replicateUrl);
            if (!fileRes.ok) throw new Error(`Replicate devolvió error ${fileRes.status} al descargar el resultado`);
            const blob = await fileRes.blob();
            const { error: saveError } = await supabase.storage
              .from('audios')
              .upload(outputPath, blob, { contentType: mime, upsert: true });
            if (saveError) throw new Error(`Error guardando el resultado en Storage: ${saveError.message}`);
          }
          finalUrl = supabase.storage.from('audios').getPublicUrl(outputPath).data.publicUrl;
          if (typeof output?.speed_shift_pct === 'number') speedShiftPct = output.speed_shift_pct;
          if (typeof output?.peak_dbtp === 'number') peakDbtp = output.peak_dbtp;
          if (typeof output?.decorrelation_pct === 'number') decorrelationPct = output.decorrelation_pct;
          timeSec = Number(((performance.now() - tCloud0) / 1000).toFixed(1));
        } catch (cloudErr: any) {
          console.warn('[DSP] Cloud worker no disponible, ejecutando automáticamente en Motor Local DSP v3:', cloudErr);
          usedEngine = 'local';
          const localRes = await runLocalPipeline();
          finalUrl = localRes.finalUrl;
          speedShiftPct = localRes.speedShiftPct;
          peakDbtp = localRes.peakDbtp;
          decorrelationPct = localRes.decorrelationPct;
          timeSec = localRes.timeSec;
        }
      }

      const { error: stemError } = await supabase.from('stems').insert({
        song_id: targetSongId,
        name: `${baseName} (DSP ${presetLabel})`,
        file_url: finalUrl,
        type: 'Audio',
        metadata: {
          original_name: `${baseName}_DSP_${preset}.${format}`,
          format: mime,
          is_master: false,
          dsp_watermark: true,
          dsp_preset: preset,
          dsp_engine: usedEngine,
          speed_shift_pct: speedShiftPct,
          peak_dbtp: peakDbtp,
          decorrelation_pct: decorrelationPct,
          prediction_id: predictionId,
        },
      });
      if (stemError) throw new Error(`Error registrando el stem: ${stemError.message}`);

      if (!mountedRef.current) return;
      setCleanAudioUrl(finalUrl);
      setDspTelemetry({
        preset: presetLabel,
        speedShiftPct,
        peakDbtp,
        decorrelationPct,
        engine: usedEngine === 'local' ? 'Local DSP v3' : 'Cloud DSP v3',
        timeSec,
      });
      setWatermarkJobStatus('completed');
      setDspMessage(
        `¡Decorrelación ${presetLabel} (${decorrelationPct}% Evasión) completada${timeSec ? ` en ${timeSec}s` : ''}! Guardado como "${baseName} (DSP ${presetLabel})".`
      );
      if (selectedSongRef.current === targetSongId) fetchStems(targetSongId);
    } catch (error: any) {
      console.error('[DSP]', error);
      if (mountedRef.current) {
        setWatermarkJobStatus('failed');
        setDspMessage(`Falló el proceso: ${error.message}`);
      }
    } finally {
      dspBusyRef.current = false;
      if (mountedRef.current) {
        setIsUploadingWatermark(false);
        setDecorrelatingStemId(null);
      }
      if (inputUploaded && inputPath) {
        supabase.storage.from('audios').remove([inputPath]).catch(() => {});
      }
    }
  };

  const handleUploadAndProcessWatermark = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;
    try {
      await executeDspDecorrelation({ file });
    } finally {
      inputEl.value = '';
    }
  };

  const handleDecorrelateExistingStem = async (stem: any) => {
    if (!stem?.file_url || dspBusyRef.current) return;
    await executeDspDecorrelation({ existingStem: stem });
  };

  const handleCreateNewProject = async () => {
    const projectName = prompt("Nombre del nuevo proyecto:");
    if (!projectName) return;
    
    try {
      const { data, error } = await supabase
        .from('songs')
        .insert({ band_id: FAKE_BAND_ID, title: projectName })
        .select('id')
        .single();
        
      if (error) throw error;
      
      await fetchSongs();
      setSelectedSongId(data.id);
    } catch (err: any) {
      alert("Error al crear carpeta: " + err.message);
    }
  };

  const fetchSongs = async () => {
    setLoadingSongs(true);
    const { data } = await supabase
      .from('songs')
      .select('*')
      .order('title');
    if (data) setSongs(data);
    setLoadingSongs(false);
  };

  const fetchStems = async (songId: string) => {
    setLoadingStems(true);
    const { data } = await supabase
      .from('stems')
      .select('*')
      .eq('song_id', songId)
      .order('name');
    if (data) setStems(data);
    setLoadingStems(false);
  };

  const handleUploadComplete = (newSongId?: string) => {
    fetchSongs();
    if (newSongId) {
      setSelectedSongId(newSongId);
      fetchStems(newSongId);
    } else if (selectedSongId) {
      fetchStems(selectedSongId);
    }
  };

  const handleGenerateChordsAI = async () => {
    if (!selectedSongId) return;
    setIsGeneratingAI(true);
    setAiSuccessMessage(null);
    
    try {
      setAiSuccessMessage(`Paso 1/2: Iniciando análisis de Tempo...`);

      const beatsRes = await fetch('/api/ai/beats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: selectedSongId, stems })
      });
      const beatsData = await beatsRes.json();
      if (!beatsRes.ok) throw new Error(beatsData.error || 'Error iniciando Sakemin');
      
      const beatsPredictionId = beatsData.predictionId;
      let isBeatsDone = false;
      let beatsPrompterData = null;
      let pollCount = 1;

      while (!isBeatsDone && pollCount < 300) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch('/api/ai/beats_status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ predictionId: beatsPredictionId })
        });
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || 'Error en polling tempo');
        
        if (statusData.done) {
           isBeatsDone = true;
           
           let rawOutput = statusData.data;
           if (Array.isArray(rawOutput) && rawOutput.length > 0 && typeof rawOutput[0] === 'string' && rawOutput[0].startsWith('http')) {
             const beatFileRes = await fetch(rawOutput[0]);
             rawOutput = await beatFileRes.json();
           }
           
           const newSections: any[] = [];
           if (rawOutput.segments && rawOutput.segments.length > 0) {
             rawOutput.segments.forEach((seg: any) => {
                newSections.push({ name: seg.label.toUpperCase(), time: seg.start });
             });
           }

           let beatTimes: number[] = rawOutput.beats || [];
           const downbeats: number[] = rawOutput.downbeats || [];
           const firstDownbeatTime = downbeats.length > 0 ? downbeats[0] : (beatTimes.length > 0 ? beatTimes[0] : 0);

           if (beatTimes.length > 0 && rawOutput.bpm > 0) {
               const beatInterval = 60 / rawOutput.bpm;
               let firstBeat = beatTimes[0];
               while (firstBeat - beatInterval >= 0) {
                   firstBeat -= beatInterval;
                   beatTimes.unshift(firstBeat);
               }
               let lastBeat = beatTimes[beatTimes.length - 1];
               while (lastBeat + beatInterval <= 600) {
                   lastBeat += beatInterval;
                   beatTimes.push(lastBeat);
               }
           }

           beatsPrompterData = {
             bpm: rawOutput.bpm,
             beatTimes: beatTimes,
             firstBeatOffset: firstDownbeatTime,
             sections: newSections
           };
           
        } else {
           if (statusData.status === 'starting' && pollCount > 10) {
             setAiSuccessMessage(`Paso 1/2: IA Tempo despertando (Cold Boot, puede tardar hasta 5-10 min) (Intento ${pollCount})`);
           } else {
             setAiSuccessMessage(`Paso 1/2: IA Tempo Procesando... Estado: ${statusData.status} (Intento ${pollCount})`);
           }
        }
        pollCount++;
      }

      if (!isBeatsDone || !beatsPrompterData) {
         throw new Error('Timeout esperando el análisis de Tempo');
      }

      setAiSuccessMessage(`Tempo detectado. Guardando en la base de datos...`);
      
      const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
      const currentPrompterData = songData?.prompter_data || {};
      
      const finalPrompterData = {
        ...currentPrompterData,
        bpm: beatsPrompterData.bpm,
        beatTimes: beatsPrompterData.beatTimes,
        firstBeatOffset: beatsPrompterData.firstBeatOffset,
        sections: beatsPrompterData.sections.length > 0 ? beatsPrompterData.sections : currentPrompterData.sections,
        lastAiDetection: new Date().toLocaleString('es-PE')
      };

      const { error: updateError } = await supabase.from('songs').update({ prompter_data: finalPrompterData }).eq('id', selectedSongId);
      if (updateError) throw new Error(updateError.message);

      setAiSuccessMessage("¡Tempo y Grilla generados y guardados exitosamente!");
      fetchSongs();
      setTimeout(() => setAiSuccessMessage(null), 5000);

    } catch (error: any) {
      console.error("Error saving AI:", error);
      alert(`Falló la detección IA: ${error.message}`);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const deleteStem = async (stemId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta pista?')) return;
    
    if (playingStemId === stemId) {
      audioRef.current?.pause();
      setPlayingStemId(null);
    }
    
    const { error } = await supabase.from('stems').delete().eq('id', stemId);
    if (!error && selectedSongId) {
      fetchStems(selectedSongId);
    } else if (error) {
      console.error("Error al borrar stem:", error);
      alert("Error al borrar el archivo");
    }
  };

    const convertToMp3 = async (blob: Blob, onProgress: (msg: string) => void): Promise<Blob> => {
    onProgress('Preparando conversor MP3...');
    if (!(window as any).lamejs) {
        const lamejsSrc = await import('lamejs/lame.all.js?raw');
        const script = document.createElement('script');
        script.innerHTML = lamejsSrc.default + '\nwindow.lamejs = lamejs;';
        document.head.appendChild(script);
    }
    const lamejs = (window as any).lamejs;

    onProgress('Decodificando WAV...');
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    onProgress('Codificando a MP3 Alta Calidad...');
    const channels = audioBuffer.numberOfChannels;
    const sampleRateMp3 = audioBuffer.sampleRate;
    const encoder = new lamejs.Mp3Encoder(channels, sampleRateMp3, 320);
    
    const left = audioBuffer.getChannelData(0);
    const right = channels > 1 ? audioBuffer.getChannelData(1) : left;

    const sampleBlockSize = 1152;
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
        if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
        sampleOffset += sampleBlockSize;
    }
    const mp3buf = encoder.flush();
    if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
    
    return new Blob(mp3Data, { type: 'audio/mpeg' });
  };

  const handleSplitMP3 = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSplitting(true);
    setSplitMessage("Creando carpeta para la canción...");
    
    try {
      // 1. Crear una nueva canción (carpeta) automáticamente con el nombre del archivo
      const newSongName = file.name.split('.').slice(0, -1).join('.') || file.name;
      const { data: newSongData, error: songError } = await supabase
        .from('songs')
        .insert({ band_id: FAKE_BAND_ID, title: newSongName })
        .select('id')
        .single();
        
      if (songError) throw new Error("No se pudo crear la canción: " + songError.message);
      const targetSongId = newSongData.id;

      // Seleccionar automáticamente la nueva canción en la UI
      setSelectedSongId(targetSongId);
      await fetchSongs();

      setSplitMessage("Subiendo archivo original...");
      
      const storagePath = `${FAKE_BAND_ID}/temp/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('audios').upload(storagePath, file);
      if (uploadError) throw new Error("Error subiendo audio: " + uploadError.message);

      const { data: publicUrlData } = supabase.storage.from('audios').getPublicUrl(storagePath);
      const audioUrl = publicUrlData.publicUrl;

      setSplitMessage("Iniciando IA en la nube...");

      const res = await fetch('/api/ai/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al iniciar IA');

      const { predictionId } = data;
      setSplitMessage("Separando pistas (Esto puede tomar 1-3 minutos)...");

      let pollCount = 1;
      const poll = async () => {
        try {
          const statusRes = await fetch('/api/ai/split-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ predictionId })
          });
          const statusData = await statusRes.json();
          if (!statusRes.ok) throw new Error(statusData.error || 'Error en polling');

          if (statusData.done) {
            setSplitMessage("¡Separación completada! Descargando stems y guardando...");
            
            const outputUrls = Array.isArray(statusData.output) ? statusData.output : [statusData.output];
            
            for (let i = 0; i < outputUrls.length; i++) {
              const url = outputUrls[i];
              if (typeof url !== 'string' || !url.startsWith('http')) continue;
              
              let stemName = `Stem ${i}`;
              let isMasterFlag = false;
              
              if (url.includes('bass')) stemName = 'Bass';
              else if (url.includes('drums')) stemName = 'Drums';
              else if (url.includes('other')) stemName = 'Other';
              else if (url.includes('vocals')) stemName = 'Vocals';
              else if (url.includes('instrum') && !url.includes('instrum2')) {
                 stemName = 'Mezcla Master';
                 isMasterFlag = true;
              }
              else continue; // Ignorar instrum2.wav o json
              
              // Evitar error de CORS o fallos silenciosos
              const fetchRes = await fetch(url);
              if (!fetchRes.ok) throw new Error(`Replicate devolvió error ${fetchRes.status} para ${stemName}`);
              let blob = await fetchRes.blob();
              
              let fileExt = 'wav';
              let mimeType = 'audio/wav';

              if (splitFormat === 'mp3') {
                 blob = await convertToMp3(blob, (msg) => setSplitMessage(`[${stemName}] ${msg}`));
                 fileExt = 'mp3';
                 mimeType = 'audio/mpeg';
                 setSplitMessage(`Subiendo ${stemName} (MP3) a la nube...`);
              }
              
              const finalPath = `${FAKE_BAND_ID}/${targetSongId}/${Date.now()}_${stemName}.${fileExt}`;
              const { error: stemUploadError } = await supabase.storage.from('audios').upload(finalPath, blob, { contentType: mimeType });
              
              // Si el storage falla (ej. límite de 1GB de Supabase), abortamos para no crear stems fantasmas
              if (stemUploadError) throw new Error(`Error guardando ${stemName} en Storage: ` + stemUploadError.message);
              
              const { data: finalUrl } = supabase.storage.from('audios').getPublicUrl(finalPath);
              
              await supabase.from('stems').insert({
                song_id: targetSongId,
                name: stemName,
                file_url: finalUrl.publicUrl,
                type: 'Audio',
                metadata: { original_name: `${stemName}.${fileExt}`, format: mimeType, is_master: isMasterFlag }
              });
            }

            setSplitMessage("¡Todo listo!");
            setTimeout(() => setSplitMessage(null), 5000);
            fetchStems(targetSongId); // Cargar los nuevos stems

            await supabase.storage.from('audios').remove([storagePath]); // Limpiar temporal
            setIsSplitting(false);
          } else {
            setSplitMessage(`Procesando... intento ${pollCount}`);
            pollCount++;
            setTimeout(poll, 5000);
          }
        } catch (error: any) {
          console.error("Error en poll:", error);
          alert("Error: " + error.message);
          setSplitMessage("Error al procesar las plicas.");
          setIsSplitting(false);
        }
      };
      
      setTimeout(poll, 5000);
      
    } catch (error: any) {
      console.error("Error en split:", error);
      alert("Error crítico: " + error.message);
      setIsSplitting(false);
      setSplitMessage(null);
    } finally {
      if (e.target) e.target.value = ''; // Limpiar el input para permitir subir el mismo archivo de nuevo
    }
  };;

  return (
    <div className="h-full flex flex-col bg-[#111113] overflow-hidden text-zinc-300 select-none">
      {/* Hidden Audio Player for Previews */}
      <audio 
        ref={audioRef} 
        onEnded={() => setPlayingStemId(null)}
        onError={() => {
           console.error("Audio playback error");
           setPlayingStemId(null);
        }}
      />

      {/* Header - DAW Style */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#18181b] border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <Disc3 className="text-emerald-500" size={18} strokeWidth={2.5} />
          <h1 className="text-xs font-bold text-zinc-200 tracking-widest uppercase">Stem Studio</h1>
        </div>
        <div className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">
          Master Library
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar - Project/Song Browser */}
        <div className="w-72 flex flex-col bg-[#09090b] border-r border-zinc-800 shrink-0 z-10">
          <div className="px-4 py-2 border-b border-zinc-800 bg-[#121214] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Music size={12} className="text-zinc-500" />
                <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Projects</h2>
              </div>
              <button 
                onClick={handleCreateNewProject} 
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Nueva Carpeta (Proyecto)"
              >
                <Plus size={12} />
              </button>
            </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
            {loadingSongs ? (
              <div className="flex items-center gap-2 text-zinc-500 p-3">
                <Loader2 size={12} className="animate-spin" />
                <span className="text-xs">Loading...</span>
              </div>
            ) : songs.length === 0 ? (
              <p className="text-zinc-600 text-xs p-3">No projects found.</p>
            ) : (
              songs.map((song) => (
                <button
                  key={song.id}
                  onClick={() => setSelectedSongId(song.id)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between rounded text-xs transition-colors ${
                    selectedSongId === song.id 
                      ? 'bg-zinc-800 text-zinc-100 font-medium' 
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <div className="truncate pr-2">{song.title}</div>
                  {selectedSongId === song.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-y-auto bg-[#141417] custom-scrollbar relative">
          {!selectedSongId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600">
              <FolderPlus size={48} className="mb-4 opacity-20" strokeWidth={1} />
              <p className="text-sm font-medium text-zinc-400">Select a project to view stems</p>
              <p className="text-xs mt-1 opacity-70">or upload a .ZIP to create a new one.</p>
              <div className="mt-8 w-80">
                <StemUploader 
                  songId={selectedSongId}
                  bandId={FAKE_BAND_ID}
                  onUploadComplete={handleUploadComplete}
                />
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6 max-w-6xl mx-auto w-full">
              
              {/* Top Controls Toolbar */}
              <div className="flex flex-col xl:flex-row gap-4 shrink-0">
                
                {/* Uploader / Adder (Red/Orange Theme) */}
                <div className="flex-1 bg-[#1a1a1e] border border-zinc-800/80 rounded-lg p-4 flex flex-col gap-4">
                  <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/50">
                    <FolderPlus size={14} className="text-orange-500" />
                    <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Add Audio Files</h3>
                  </div>
                  
                  <div className="flex-1 flex flex-col gap-4">
                    <div className="text-xs w-full flex items-center justify-center border border-orange-500/20 hover:border-orange-500/50 bg-orange-950/10 rounded transition-colors overflow-hidden py-1">
                       <StemUploader 
                          songId={selectedSongId}
                          bandId={FAKE_BAND_ID}
                          onUploadComplete={handleUploadComplete}
                        />
                    </div>
                    
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Formato Salida:</span>
                          <select 
                            value={splitFormat} 
                            onChange={(e) => setSplitFormat(e.target.value as 'mp3' | 'wav')}
                            disabled={isSplitting}
                            className="bg-[#09090b] text-xs text-zinc-300 border border-zinc-800 rounded px-2 py-1 outline-none cursor-pointer"
                          >
                            <option value="mp3">MP3 320k (Ahorra espacio)</option>
                            <option value="wav">WAV (Máxima calidad)</option>
                          </select>
                        </div>
                        <div className="relative h-[40px] group bg-red-950/20 border border-red-500/30 hover:border-red-500/60 rounded flex items-center justify-between px-3 cursor-pointer transition-colors overflow-hidden">
                      <input type="file" accept="audio/mpeg, audio/wav, audio/mp3" onChange={handleSplitMP3} disabled={isSplitting} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10" />
                      <div className="flex items-center gap-2 pointer-events-none z-0">
                        {isSplitting ? <RefreshCw size={14} className="animate-spin text-red-400" /> : <Sparkles size={14} className="text-red-400" />}
                        <span className="text-xs font-semibold text-zinc-300">
                          {isSplitting ? splitMessage : "AI Studio Splitter (WAV / 320k)"}
                        </span>
                      </div>
                    </div>
                      </div>
                  </div>
                </div>

                {/* AI Tempo & Grid Module */}
                <div className="flex-1 bg-[#1a1a1e] border border-zinc-800/80 rounded-lg p-4 flex flex-col gap-4">
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-800/50">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                      <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Global Grid & Tempo</h3>
                    </div>
                    {songs.find(s => s.id === selectedSongId)?.prompter_data?.lastAiDetection && (
                       <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-wider">
                         <CheckCircle size={10} className="text-zinc-600" /> Synced
                       </div>
                    )}
                  </div>
                  
                  <div className="flex gap-3">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Signature</label>
                      <select value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)} className="h-[32px] bg-[#09090b] border border-zinc-800 rounded text-xs text-zinc-300 px-2 focus:border-purple-500 focus:outline-none">
                        <option value="4/4">4/4</option>
                        <option value="3/4">3/4</option>
                        <option value="6/8">6/8</option>
                      </select>
                    </div>
                    <div className="flex-1 flex flex-col gap-1.5">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Key (Optional)</label>
                      <input type="text" value={manualKey} onChange={(e) => setManualKey(e.target.value)} placeholder="e.g. Bb Maj" className="h-[32px] bg-[#09090b] border border-zinc-800 rounded text-xs text-zinc-300 px-2 focus:border-purple-500 focus:outline-none placeholder:text-zinc-700" />
                    </div>
                  </div>
                  
                  <button 
                    onClick={handleGenerateChordsAI}
                    disabled={isGeneratingAI || stems.length === 0}
                    className="w-full h-[32px] bg-purple-600/10 hover:bg-purple-600/20 border border-purple-500/30 text-purple-400 text-xs font-bold rounded flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                  >
                    {isGeneratingAI ? <RefreshCw className="animate-spin" size={14} /> : null}
                    {isGeneratingAI ? "Analyzing..." : "Auto-Detect Tempo"}
                  </button>
                  {aiSuccessMessage && <div className="text-[10px] text-green-400 bg-green-900/10 px-2 py-1.5 rounded border border-green-900/30 truncate">{aiSuccessMessage}</div>}
                </div>

              </div>

              {/* Tracks / Stems Section (DAW Style) */}
              <div className="flex flex-col bg-[#09090b] border border-zinc-800/80 rounded-lg overflow-hidden shrink-0 shadow-2xl">
                {/* Tracks Header */}
                <div className="flex items-center px-4 py-2 bg-[#121214] border-b border-zinc-800">
                   <div className="w-[320px] text-[10px] font-bold text-zinc-500 uppercase tracking-widest shrink-0">Track Name</div>
                   <div className="flex-1 text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-4">Waveform</div>
                   <div className="w-[136px] text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right pr-2 shrink-0">Controls</div>
                </div>

                {loadingStems ? (
                  <div className="flex items-center justify-center py-16 text-zinc-500">
                    <Loader2 size={20} className="animate-spin mr-3 text-zinc-400" />
                    <span className="text-sm font-medium">Loading tracks...</span>
                  </div>
                ) : stems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 bg-[#09090b]">
                    <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center mb-3">
                      <FileAudio size={20} className="text-zinc-700" />
                    </div>
                    <p className="text-sm text-zinc-500 font-medium">No audio tracks</p>
                    <p className="text-xs text-zinc-600 mt-1">Upload files or extract stems to begin.</p>
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-zinc-800/50">
                    {stems.map((stem) => {
                      const isThisDecorrelating = decorrelatingStemId === stem.id;
                      const isDspBusy = watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark;
                      const isDspTrack = Boolean(stem.metadata?.dsp_watermark);
                      return (
                        <div key={stem.id} className="flex min-h-[64px] bg-[#09090b] hover:bg-[#121214] transition-colors group">
                          {/* Track Info (Left panel of DAW track) */}
                          <div className="w-[320px] px-4 py-3 flex flex-col justify-center border-r border-zinc-800/50 bg-[#101012] group-hover:bg-[#141417] shrink-0">
                             <div className="flex items-start gap-2.5">
                               <div className={`w-5 h-5 shrink-0 rounded flex items-center justify-center mt-0.5 ${isDspTrack ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30' : 'bg-zinc-800 text-zinc-400'}`}>
                                 {isDspTrack ? <Shield size={11} /> : <FileAudio size={11} />}
                               </div>
                               <span className="text-[13px] font-semibold text-zinc-200 leading-snug whitespace-normal break-words">{stem.name}</span>
                             </div>
                             <div className="flex items-center gap-2 pl-7 mt-1.5">
                               <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">{stem.type || 'Audio'}</span>
                               {isDspTrack && (
                                 <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                   DSP {stem.metadata?.dsp_preset ? String(stem.metadata.dsp_preset).toUpperCase() : 'CLEAN'}
                                 </span>
                               )}
                             </div>
                          </div>
                          
                          {/* Fake Waveform area (Center) */}
                          <div className="flex-1 flex items-center px-4 py-2 relative">
                            <div className="absolute inset-y-2 left-4 right-4 bg-[#141417] border border-zinc-800/50 rounded flex items-center justify-center overflow-hidden">
                               {/* A purely visual fake waveform representation for DAW feel */}
                               <div className={`w-full h-full flex items-center gap-[1px] opacity-[0.15] px-1 transition-opacity duration-300 ${playingStemId === stem.id ? 'opacity-[0.8] animate-pulse' : ''}`}>
                                  {Array.from({length: 80}).map((_, i) => (
                                    <div key={i} className={`flex-1 ${playingStemId === stem.id ? 'bg-emerald-400' : isDspTrack ? 'bg-blue-400' : 'bg-emerald-500'} rounded-sm`} style={{ height: `${10 + ((i * 37) % 80)}%` }}></div>
                                  ))}
                               </div>
                            </div>
                          </div>

                          {/* Controls (Right) */}
                          <div className="w-[136px] flex items-center justify-end px-4 gap-1 shrink-0">
                            <button 
                              onClick={() => togglePlay(stem)}
                              className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                              title={playingStemId === stem.id ? "Pause" : "Play"}
                            >
                              {playingStemId === stem.id ? <Pause size={15} /> : <Play size={15} />}
                            </button>
                            <button
                              onClick={() => handleDecorrelateExistingStem(stem)}
                              disabled={isDspBusy}
                              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                                isThisDecorrelating
                                  ? 'text-blue-400 bg-blue-500/20'
                                  : 'text-zinc-400 hover:text-blue-400 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed'
                              }`}
                              title={`Decorrelacionar "${stem.name}" con preset ${PRESET_SHORT_LABEL[dspPreset]}`}
                            >
                              {isThisDecorrelating ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                            </button>
                            <button 
                              onClick={() => deleteStem(stem.id)}
                              className="w-8 h-8 flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                              title="Delete Track"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* DSP Watermark Module (Stealth Master DSP v4) */}
              <div className="flex-1 bg-[#1a1a1e] border border-zinc-800/80 rounded-lg p-5 flex flex-col gap-4 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800/60">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.7)]" />
                    <h3 className="text-[11px] font-bold text-zinc-200 uppercase tracking-widest">
                      Stealth Master DSP v4 — Pure Studio Clarity Anti-Fingerprint
                    </h3>
                  </div>

                  {/* Dual-Engine Switcher */}
                  <div className="flex items-center bg-[#09090b] p-0.5 rounded-md border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setDspEngine('local')}
                      disabled={watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
                        dspEngine === 'local'
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                      title="Procesa en el cliente en 2-4 segundos sin esperas de Cold Boot"
                    >
                      <Zap size={11} />
                      Motor Local (&lt;3s)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDspEngine('cloud')}
                      disabled={watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
                        dspEngine === 'cloud'
                          ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                      title="Ejecuta en el worker remoto de Replicate (con fallback local automático)"
                    >
                      <Cloud size={11} />
                      Cloud Worker
                    </button>
                  </div>
                </div>
                
                <div className="flex flex-col gap-4 flex-1 justify-between">
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Ataque psicoacústico quirúrgico sin ensuciar el audio: <code className="text-blue-400">🎹 Ghost MIDI Sub-Bass (55-185 Hz, máscara Fletcher-Munson)</code>, <code className="text-blue-400">🎯 Constellation Poisoning (Gabor 350-4800 Hz con máscara Bark)</code>, <code className="text-blue-400">Desplazamiento CQT (+2.0% a +4.35%)</code> y <code className="text-blue-400">🛡️ Dispersión All-Pass Estática (0.0 dB plana, cero flanger)</code> manteniendo agudos cristalinos hasta 18.8 kHz.
                  </p>

                  {/* 3 Preset Selector Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {DSP_PRESETS.map((p) => {
                      const active = dspPreset === p.id;
                      const isBusy = watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={isBusy}
                          onClick={() => setDspPreset(p.id)}
                          className={`text-left p-3 rounded-lg border transition-all flex flex-col justify-between gap-1.5 ${
                            active
                              ? 'bg-blue-950/25 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.12)]'
                              : 'bg-[#101013] border-zinc-800/80 hover:border-zinc-700 hover:bg-[#141418]'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs font-bold ${active ? 'text-blue-300' : 'text-zinc-300'}`}>
                              {p.name}
                            </span>
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                                active
                                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                  : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                              }`}
                            >
                              {p.badge}
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-500 leading-snug">{p.description}</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Psychoacoustic & Stealth Countermeasures Toggles */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mr-1">
                      Módulos Activos:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPitchMode((m) =>
                          m === 'a432_detune' ? 'lock_440' : m === 'lock_440' ? 'varispeed_up' : 'a432_detune'
                        )
                      }
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        pitchMode === 'a432_detune'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                          : pitchMode === 'lock_440'
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                      }`}
                      title={
                        pitchMode === 'a432_detune'
                          ? 'Afinación clásica A=432 Hz (-31.8 cents) con Micro-Detune estéreo opuesto (+6 cents L / -6 cents R). Voz más cálida y con cuerpo (sin acelerar ni sonar chillona) y destrucción de la huella espectral de Riffusion/Suno.'
                          : pitchMode === 'lock_440'
                          ? 'Mantiene la afinación A=440 Hz al 100% idéntica al original (0.0 cents).'
                          : 'Acelera la canción (+2% a +4% / +50 cents).'
                      }
                    >
                      <span>
                        {pitchMode === 'a432_detune'
                          ? '🎻 A=432 Hz + Detune'
                          : pitchMode === 'lock_440'
                          ? '🔒 Tono 440 Hz (Exacto)'
                          : '⚡ Varispeed (+50 Cents)'}
                      </span>
                      <span className="text-[8px] uppercase">
                        {pitchMode === 'a432_detune'
                          ? '-31.8C • ±6C'
                          : pitchMode === 'lock_440'
                          ? '0.0 CENTS'
                          : '+50 CENTS'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseAntiSuno((v) => !v)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useAntiSuno
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.15)]'
                          : 'bg-[#09090b] text-zinc-500 border-zinc-800'
                      }`}
                      title="Neutralizador Forense Anti-Suno: Elimina marcas de agua ultrasónicas (19.5 kHz), notches quirúrgicos en 11k, 15.5k y 17.8k, destruye la cuadrícula de 20ms del códec neuronal con micro-jitter estocástico e inyecta saturación analógica de consola."
                    >
                      <span>🛡️ Anti-Suno Shield</span>
                      <span className="text-[8px] uppercase">{useAntiSuno ? 'HUMANIZADO' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseTransientPunch((v) => !v)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useTransientPunch
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                          : 'bg-[#09090b] text-zinc-500 border-zinc-800'
                      }`}
                      title="Restaurador de Pegada Humana y Crest Factor (+2.4 dB en transientes acústicos): Amplifica el ataque inicial (<5ms) de cajas, bombos y consonantes vocales que los vocoders de difusión (Riffusion/Griffin-Lim) comprimen y difuminan, forzando un Crest Factor acústico humano (14-18 dB)."
                    >
                      <span>🥁 Pegada Acústica (Crest Factor)</span>
                      <span className="text-[8px] uppercase">{useTransientPunch ? 'HUMANO (16 dB)' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseTapeBed((v) => !v)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useTapeBed
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : 'bg-[#09090b] text-zinc-500 border-zinc-800'
                      }`}
                      title="Capa acústica orgánica de calidez de cinta analógica a -42 dBFS con compuerta de envolvente dinámica (0 en silencios). Rellena los valles inter-transientes sin generar soplido continuo de difusión."
                    >
                      <span>🎛️ Cinta Analógica (-42 dB)</span>
                      <span className="text-[8px] uppercase">{useTapeBed ? 'ON' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseSideBloom((v) => !v)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useSideBloom
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                          : 'bg-[#09090b] text-zinc-500 border-zinc-800'
                      }`}
                      title="Difusión espacial Schroeder en canal Side (L-R) por encima de 220 Hz. Destruye el downmix mono (L+R)/2 de Shazam y ContentID mientras crea amplitud 3D natural en estéreo con afinación intacta."
                    >
                      <span>🌐 Bloom Espacial Side (L-R)</span>
                      <span className="text-[8px] uppercase">{useSideBloom ? 'ON' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseGhostMidiBass((v) => !v)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useGhostMidiBass
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          : 'bg-[#09090b] text-zinc-500 border-zinc-800'
                      }`}
                      title="Genera algorítmicamente una línea de notas MIDI de bajo sintético polirrítmica (fundamental + 2º y 3er armónico con envolvente Hann sin clics) sincronizada debajo de la envolvente de la canción con máscara Fletcher-Munson"
                    >
                      <span>🎹 Ghost MIDI Sub-Bass (55-185 Hz)</span>
                      <span className="text-[8px] uppercase">{useGhostMidiBass ? 'ON' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseConstellationPoison((v) => !v)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useConstellationPoison
                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/40'
                          : 'bg-[#09090b] text-zinc-500 border-zinc-800'
                      }`}
                      title="Micro-ráfagas Gabor por salto de frecuencia (350-4.8 kHz). Desactivado por defecto para evitar que clasificadores confundan los chirps con ruido de difusión de Riffusion."
                    >
                      <span>🎯 Gabor Chirps</span>
                      <span className="text-[8px] uppercase">{useConstellationPoison ? 'ON' : 'OFF (ANTI-DIFFUSION)'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseConstellationTilt((v) => !v)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useConstellationTilt
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : 'bg-[#09090b] text-zinc-500 border-zinc-800'
                      }`}
                      title="Intercambia la dominancia de picos espectrales en 6 bandas usando ecualización dinámica multiplicativa lenta (15-25s) idéntica en L y R, con cero ruido añadido"
                    >
                      <span>🎛️ Tilt Espectral Multiplicativo (6 Bandas)</span>
                      <span className="text-[8px] uppercase">{useConstellationTilt ? 'ON' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUsePhaseDispersion((v) => !v)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        usePhaseDispersion
                          ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                          : 'bg-[#09090b] text-zinc-500 border-zinc-800'
                      }`}
                      title="Red All-Pass estática invariante en el tiempo con respuesta de magnitud 0.0 dB plana: rota la fase interna de los bloques STFT sin flanger ni paneo giratorio"
                    >
                      <span>🛡️ Dispersión de Fase Estática (0.0 dB)</span>
                      <span className="text-[8px] uppercase">{usePhaseDispersion ? 'ON' : 'OFF'}</span>
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-3 pt-1">
                    {cleanAudioUrl && (
                      <div className="flex flex-col gap-2 bg-[#09090b] border border-zinc-800/80 rounded-lg p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                            <CheckCircle size={12} />
                            Master Decorrelacionado Listo
                          </span>
                          {dspTelemetry && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider">
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                {dspTelemetry.decorrelationPct}% Evasión
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                {dspTelemetry.preset}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                                +{dspTelemetry.speedShiftPct}% Varispeed
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                                {dspTelemetry.peakDbtp} dBTP
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                                {dspTelemetry.engine}{dspTelemetry.timeSec ? ` • ${dspTelemetry.timeSec}s` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                        <audio controls src={cleanAudioUrl} className="w-full h-8 opacity-85 hover:opacity-100 transition invert grayscale">
                          Tu navegador no soporta audio.
                        </audio>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <div className="flex items-center justify-between sm:justify-start gap-2 bg-[#09090b] border border-zinc-800 rounded px-3 py-1.5 shrink-0">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Formato Salida:</span>
                        <select
                          value={dspFormat}
                          onChange={(e) => setDspFormat(e.target.value as DspFormat)}
                          disabled={watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark}
                          className="bg-transparent text-xs text-zinc-200 font-medium outline-none cursor-pointer"
                        >
                          <option value="wav" className="bg-[#09090b]">WAV 16-bit (Máxima compatibilidad)</option>
                          <option value="flac" className="bg-[#09090b]">FLAC 24-bit (Sin pérdida Studio)</option>
                          <option value="mp3" className="bg-[#09090b]">MP3 320k CBR (Ahorra espacio)</option>
                        </select>
                      </div>

                      <div className="relative flex-1 h-[36px] group bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/40 text-blue-300 rounded flex items-center justify-center transition-colors overflow-hidden">
                        <input 
                          type="file" 
                          accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg" 
                          onChange={handleUploadAndProcessWatermark} 
                          disabled={watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark} 
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10" 
                        />
                        <div className="flex items-center gap-2 pointer-events-none z-0 text-xs font-bold">
                          {(watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark) ? (
                            <RefreshCw className="animate-spin" size={14} />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          {isUploadingWatermark
                            ? "Subiendo Master..."
                            : watermarkJobStatus === 'pending'
                            ? "Iniciando DSP v2..."
                            : watermarkJobStatus === 'processing'
                            ? (dspEngine === 'local' ? "Procesando en Motor Local..." : "Procesando en Cloud GPU...")
                            : `Subir y Decorrelacionar Audio (${PRESET_SHORT_LABEL[dspPreset]})`}
                        </div>
                      </div>
                    </div>
                    
                    {dspMessage && (
                      <div className={`text-[10px] px-3 py-2 rounded border break-words font-medium ${watermarkJobStatus === 'failed' ? 'bg-red-900/10 text-red-400 border-red-900/30' : watermarkJobStatus === 'completed' ? 'bg-emerald-900/10 text-emerald-400 border-emerald-900/30' : 'bg-blue-900/10 text-blue-400 border-blue-900/30'}`}>
                        {dspMessage}
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
