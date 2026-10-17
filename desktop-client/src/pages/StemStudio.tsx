import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Music, FolderPlus, Disc3, FileAudio, Loader2, Trash2, Sparkles, CheckCircle, RefreshCw, Play, Pause, Plus, Shield, Zap, Cloud, Star, ArrowRight, Edit3, Save } from 'lucide-react';

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
  const navigate = useNavigate();
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(() => {
    return sessionStorage.getItem('tandu_active_song_id');
  });
  const [stems, setStems] = useState<any[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [loadingStems, setLoadingStems] = useState(false);

  // AI Generator & Grid Metadata state
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [aiSuccessMessage, setAiSuccessMessage] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string>('');
  const [manualBpm, setManualBpm] = useState<string>('');
  const [timeSignature, setTimeSignature] = useState<string>('4/4');
  const [showSplitterComplement, setShowSplitterComplement] = useState<boolean>(false);

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
  
  // Audio Playback & Real Waveform State
  const [playingStemId, setPlayingStemId] = useState<string | null>(null);
  const [playProgress, setPlayProgress] = useState<{ current: number; duration: number }>({ current: 0, duration: 0 });
  const [waveformsMap, setWaveformsMap] = useState<Record<string, number[]>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const decodeWaveformForStem = async (stem: any) => {
    if (!stem?.id || !stem?.file_url || waveformsMap[stem.id]) return;
    try {
      const res = await fetch(stem.file_url);
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      try {
        const audioBuf = await ctx.decodeAudioData(buf.slice(0));
        const raw = audioBuf.getChannelData(0);
        const bars = 80;
        const blockSize = Math.max(1, Math.floor(raw.length / bars));
        const peaks: number[] = [];
        let maxPeak = 0.01;
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          const start = i * blockSize;
          const step = Math.max(1, Math.floor(blockSize / 64));
          let count = 0;
          for (let j = 0; j < blockSize && start + j < raw.length; j += step) {
            const v = Math.abs(raw[start + j]);
            if (v > sum) sum = v;
            count++;
          }
          peaks.push(sum);
          if (sum > maxPeak) maxPeak = sum;
        }
        const normalized = peaks.map(p => Math.max(8, Math.min(96, Math.round((p / maxPeak) * 92))));
        if (mountedRef.current) {
          setWaveformsMap(prev => ({ ...prev, [stem.id]: normalized }));
        }
      } finally {
        ctx.close().catch(() => {});
      }
    } catch {
      // Fallback silencioso si CORS o red impide decodificar
    }
  };

  const togglePlay = (stem: any) => {
    if (playingStemId === stem.id) {
      audioRef.current?.pause();
      setPlayingStemId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = stem.file_url;
        audioRef.current.play().catch(e => console.error("Playback failed", e));
        setPlayingStemId(stem.id);
        setPlayProgress({ current: 0, duration: stem.metadata?.duration_seconds || 0 });
        decodeWaveformForStem(stem);
      }
    }
  };

  const handleSeekAudio = (stem: any, e: React.MouseEvent<HTMLDivElement>) => {
    if (playingStemId !== stem.id || !audioRef.current || !audioRef.current.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * audioRef.current.duration;
    setPlayProgress({ current: audioRef.current.currentTime, duration: audioRef.current.duration });
  };

  useEffect(() => {
    fetchSongs();
  }, []);

  useEffect(() => {
    selectedSongRef.current = selectedSongId;
    if (selectedSongId) {
      sessionStorage.setItem('tandu_active_song_id', selectedSongId);
      fetchStems(selectedSongId);
      const activeSong = songs.find(s => s.id === selectedSongId);
      if (activeSong) {
        const pd = activeSong.prompter_data || {};
        setTimeSignature(pd.timeSignature || '4/4');
        setManualKey(pd.key || '');
        setManualBpm(pd.bpm ? String(Math.round(Number(pd.bpm))) : '');
      }
      if (audioRef.current) {
        audioRef.current.pause();
        setPlayingStemId(null);
      }
      if (!dspBusyRef.current) {
        setWatermarkJobStatus('idle');
        setCleanAudioUrl(null);
        setDspMessage(null);
        setDspTelemetry(null);
      }
    } else {
      setStems([]);
    }
  }, [selectedSongId, songs]);

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

  const handleRenameProject = async (song: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextTitle = prompt("Nuevo nombre del proyecto:", song.title);
    if (!nextTitle || nextTitle.trim() === song.title) return;
    const { error } = await supabase.from('songs').update({ title: nextTitle.trim() }).eq('id', song.id);
    if (error) {
      alert("Error al renombrar: " + error.message);
      return;
    }
    fetchSongs();
  };

  const handleDeleteProject = async (song: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`¿Eliminar el proyecto "${song.title}" y todas sus pistas asociadas?`)) return;
    await supabase.from('stems').delete().eq('song_id', song.id);
    const { error } = await supabase.from('songs').delete().eq('id', song.id);
    if (error) {
      alert("Error al eliminar proyecto: " + error.message);
      return;
    }
    if (selectedSongId === song.id) {
      setSelectedSongId(null);
      sessionStorage.removeItem('tandu_active_song_id');
    }
    fetchSongs();
  };

  const toggleMasterStem = async (targetStem: any) => {
    if (!selectedSongId) return;
    const willBeMaster = !(targetStem.metadata?.is_master === true);
    try {
      for (const s of stems) {
        const nextIsMaster = s.id === targetStem.id ? willBeMaster : false;
        if (Boolean(s.metadata?.is_master) !== nextIsMaster) {
          const nextMeta = { ...(s.metadata || {}), is_master: nextIsMaster };
          await supabase.from('stems').update({ metadata: nextMeta }).eq('id', s.id);
        }
      }
      await fetchStems(selectedSongId);
    } catch (err: any) {
      alert("Error al actualizar pista Master: " + err.message);
    }
  };

  const handleSaveGridMeta = async () => {
    if (!selectedSongId) return;
    setIsSavingMeta(true);
    try {
      const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
      const currentPrompterData = songData?.prompter_data || {};
      const parsedBpm = Number(manualBpm);
      const nextPrompterData = {
        ...currentPrompterData,
        timeSignature: timeSignature || '4/4',
        key: manualKey.trim(),
        ...(parsedBpm > 20 && parsedBpm < 300 ? { bpm: parsedBpm } : {}),
      };
      const { error } = await supabase.from('songs').update({ prompter_data: nextPrompterData }).eq('id', selectedSongId);
      if (error) throw error;
      setAiSuccessMessage("Parámetros de Compás, Tonalidad y Tempo guardados.");
      fetchSongs();
      setTimeout(() => setAiSuccessMessage(null), 3500);
    } catch (err: any) {
      alert("Error guardando parámetros: " + err.message);
    } finally {
      setIsSavingMeta(false);
    }
  };

  const fetchSongs = async () => {
    setLoadingSongs(true);
    const { data } = await supabase
      .from('songs')
      .select('*')
      .order('title');
    if (data) {
      setSongs(data);
      const savedId = sessionStorage.getItem('tandu_active_song_id');
      if (savedId && data.some((s: any) => s.id === savedId)) {
        setSelectedSongId(savedId);
      }
    }
    setLoadingSongs(false);
  };

  const fetchStems = async (songId: string) => {
    setLoadingStems(true);
    const { data } = await supabase
      .from('stems')
      .select('*')
      .eq('song_id', songId)
      .order('name');
    if (data) {
      setStems(data);
      // Pre-decodificar ondas en segundo plano para las primeras pistas
      data.slice(0, 6).forEach((s: any) => decodeWaveformForStem(s));
    }
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
      const masterStem = stems.find(s => s.metadata?.is_master === true);
      const refName = masterStem ? `★ ${masterStem.name} (Master)` : (stems[0]?.name || 'Stems');
      setAiSuccessMessage(`Paso 1/2: Analizando Tempo y Compás desde ${refName}...`);

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

      setAiSuccessMessage(`Tempo (${Math.round(beatsPrompterData.bpm)} BPM) detectado. Guardando grilla...`);
      
      const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
      const currentPrompterData = songData?.prompter_data || {};
      
      const finalPrompterData = {
        ...currentPrompterData,
        bpm: beatsPrompterData.bpm,
        timeSignature: timeSignature || currentPrompterData.timeSignature || '4/4',
        key: manualKey.trim() || currentPrompterData.key || '',
        beatTimes: beatsPrompterData.beatTimes,
        firstBeatOffset: beatsPrompterData.firstBeatOffset,
        sections: beatsPrompterData.sections.length > 0 ? beatsPrompterData.sections : currentPrompterData.sections,
        lastAiDetection: new Date().toLocaleString('es-PE')
      };

      const { error: updateError } = await supabase.from('songs').update({ prompter_data: finalPrompterData }).eq('id', selectedSongId);
      if (updateError) throw new Error(updateError.message);

      setManualBpm(String(Math.round(Number(beatsPrompterData.bpm))));
      setAiSuccessMessage(`¡Tempo (${Math.round(beatsPrompterData.bpm)} BPM), Compás (${finalPrompterData.timeSignature}) y Grilla guardados!`);
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
    setSplitMessage("Preparando destino para los Stems...");
    
    try {
      // Si ya hay un proyecto abierto, depositar dentro del proyecto actual; si no, crear uno nuevo
      let targetSongId = selectedSongId;
      if (!targetSongId) {
        const newSongName = file.name.split('.').slice(0, -1).join('.') || file.name;
        const { data: newSongData, error: songError } = await supabase
          .from('songs')
          .insert({ band_id: FAKE_BAND_ID, title: newSongName })
          .select('id')
          .single();
          
        if (songError) throw new Error("No se pudo crear la canción: " + songError.message);
        targetSongId = newSongData.id;
        setSelectedSongId(targetSongId);
        await fetchSongs();
      }

      setSplitMessage("Subiendo archivo original...");
      
      const storagePath = `${FAKE_BAND_ID}/temp/${Date.now()}_${sanitizeFileName(file.name)}`;
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
              else continue;
              
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
            if (targetSongId) fetchStems(targetSongId);

            await supabase.storage.from('audios').remove([storagePath]);
            setIsSplitting(false);
          } else {
            setSplitMessage(`Procesando... intento ${pollCount}`);
            pollCount++;
            setTimeout(poll, 5000);
          }
        } catch (error: any) {
          console.error("Error en poll:", error);
          alert("Error: " + error.message);
          setSplitMessage("Error al procesar las pistas.");
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
      if (e.target) e.target.value = '';
    }
  };

  const formatMmSs = (sec: number) => {
    if (!sec || !Number.isFinite(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const activeSongObj = songs.find(s => s.id === selectedSongId);
  const currentMasterStem = stems.find(s => s.metadata?.is_master === true);

  return (
    <div className="h-full flex flex-col bg-[#08090c] overflow-hidden text-zinc-300 select-none relative">
      {/* Subtle Concentric Hero Stage Rings */}
      <div className="pointer-events-none absolute -top-60 right-1/4 w-[620px] h-[620px] rounded-full border border-white/[0.03]" />
      <div className="pointer-events-none absolute -top-44 right-1/4 w-[440px] h-[440px] rounded-full border border-white/[0.04]" />

      {/* Hidden Audio Player for Previews */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setPlayProgress({
              current: audioRef.current.currentTime,
              duration: audioRef.current.duration || playProgress.duration || 0,
            });
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            setPlayProgress({
              current: audioRef.current.currentTime,
              duration: audioRef.current.duration || 0,
            });
          }
        }}
        onEnded={() => setPlayingStemId(null)}
        onError={() => {
          console.error("Audio playback error");
          setPlayingStemId(null);
        }}
      />

      {/* Header - TANDU /STAGE Studio Header */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-[#0d0f14]/95 backdrop-blur-2xl border-b border-white/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.45)] shrink-0 z-20">
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#ef4444]/25 to-[#ef4444]/5 border border-[#ef4444]/35 flex items-center justify-center shadow-[0_0_16px_rgba(239,68,68,0.25)]">
            <Disc3 className="text-[#ef4444]" size={18} strokeWidth={2.5} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-black text-white tracking-[0.18em] uppercase">1. Stem Studio &bull; Master Grid</h1>
              <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-white/[0.06] text-gray-300 border border-white/10">
                STAGE RACK
              </span>
            </div>
            <p className="text-[11px] text-[#8e96a4] mt-0.5">Carga de Stems Separados + Pista Master para Tempo y Compás IA</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {activeSongObj && (
            <button
              onClick={() => navigate('/editor')}
              className="px-4 py-2 rounded-full bg-gradient-to-r from-[#ef4444] to-[#dc2626] hover:brightness-110 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 shadow-[0_4px_20px_rgba(239,68,68,0.35)] border border-white/15 transition-all"
              title="Continuar al Paso 2: Configurar Acordes, Voz Guía y Exportar Mezcla En Vivo"
            >
              <span>Paso 2: Abrir en Studio Prompter</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Sidebar - Project/Song Browser (Music-1 Dashboard + Musiko.io Style) */}
        <div className="w-76 flex flex-col bg-[#0b0d13]/95 border-r border-white/[0.06] shrink-0 z-10 shadow-[8px_0_30px_rgba(0,0,0,0.4)]">
          <div className="px-4 py-3.5 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Music size={14} className="text-[#ef4444]" />
              <h2 className="text-[11px] font-extrabold text-white uppercase tracking-[0.16em]">Proyectos ({songs.length})</h2>
            </div>
            <button
              onClick={handleCreateNewProject}
              className="stage-tactile-btn px-3 py-1 flex items-center gap-1 rounded-full bg-gradient-to-r from-[#ef4444]/20 to-[#ef4444]/10 hover:from-[#ef4444]/30 hover:to-[#ef4444]/20 border border-[#ef4444]/35 text-red-300 text-[10px] font-black uppercase tracking-wider transition-all"
              title="Crear Nueva Canción"
            >
              <Plus size={11} />
              <span>Nuevo</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5 space-y-1.5">
            {loadingSongs ? (
              <div className="flex items-center gap-2.5 text-[#8e96a4] p-4">
                <Loader2 size={14} className="animate-spin text-[#ef4444]" />
                <span className="text-xs font-medium">Cargando proyectos...</span>
              </div>
            ) : songs.length === 0 ? (
              <div className="text-[#64748b] text-xs p-6 text-center rounded-2xl border border-dashed border-white/[0.06] bg-white/[0.01]">
                No hay proyectos aún. Crea uno nuevo o sube tus stems.
              </div>
            ) : (
              songs.map((song, sIdx) => {
                const pd = song.prompter_data || {};
                const hasGrid = Boolean(pd.bpm || (pd.beatTimes && pd.beatTimes.length > 0));
                const hasChords = Boolean(pd.chords && pd.chords.length > 0);
                const hasLyrics = Boolean(pd.lyrics && pd.lyrics.length > 0);
                const hasLiveMix = Boolean((song.foh_mix_url && song.cue_mix_url) || pd.live_mix_url);
                const isSelected = selectedSongId === song.id;

                return (
                  <div
                    key={song.id}
                    onClick={() => setSelectedSongId(song.id)}
                    className={`w-full text-left p-3 rounded-2xl text-xs transition-all duration-200 cursor-pointer group border relative ${
                      isSelected
                        ? 'bg-gradient-to-r from-[#ef4444]/20 via-[#ef4444]/8 to-[#141722] text-white font-semibold border-[#ef4444]/40 shadow-[0_8px_24px_rgba(239,68,68,0.14)]'
                        : 'bg-[#12151e]/60 text-gray-300 border-white/[0.04] hover:bg-[#171b26] hover:border-white/10 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-mono font-black shrink-0 ${
                            isSelected
                              ? 'bg-[#ef4444] text-white shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                              : 'bg-[#090b10] text-[#8e96a4] border border-white/[0.06]'
                          }`}
                        >
                          {String(sIdx + 1).padStart(2, '0')}
                        </span>
                        <div className="truncate font-bold text-[13px] tracking-tight">{song.title}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleRenameProject(song, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-white/10 hover:text-white text-[#8e96a4] transition-all"
                          title="Renombrar proyecto"
                        >
                          <Edit3 size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteProject(song, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/20 hover:text-red-400 text-[#8e96a4] transition-all"
                          title="Eliminar proyecto"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-2 pl-8">
                      {pd.bpm && (
                        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#090b10] text-gray-300 border border-white/[0.07]">
                          {Math.round(Number(pd.bpm))} BPM
                        </span>
                      )}
                      <span
                        className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${
                          hasGrid
                            ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                            : 'bg-[#090b10]/60 text-[#64748b] border-white/[0.05]'
                        }`}
                      >
                        Grilla
                      </span>
                      <span
                        className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${
                          hasChords
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                            : 'bg-[#090b10]/60 text-[#64748b] border-white/[0.05]'
                        }`}
                      >
                        Acordes
                      </span>
                      <span
                        className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${
                          hasLyrics
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-[#090b10]/60 text-[#64748b] border-white/[0.05]'
                        }`}
                      >
                        Lyrics
                      </span>
                      {hasLiveMix && (
                        <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          Mix Listo
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-y-auto bg-[#08090c] custom-scrollbar relative">
          {!selectedSongId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-6">
              <div className="max-w-lg w-full">
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
              <div className="flex flex-col xl:flex-row gap-5 shrink-0">
                {/* 1. CARGA PRINCIPAL DE STEMS SEPARADOS + COMPLEMENTO IA SPLITTER */}
                <div className="stage-glass-panel flex-1 rounded-2xl p-5 flex flex-col justify-between gap-3.5">
                  <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-lg bg-[#ef4444]/15 border border-[#ef4444]/30 flex items-center justify-center">
                        <FolderPlus size={13} className="text-[#ef4444]" />
                      </div>
                      <h3 className="text-[11px] font-extrabold text-white uppercase tracking-[0.14em]">
                        Paso 1: Cargar Stems Separados + Pista Master
                      </h3>
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#ef4444]/15 text-red-300 border border-[#ef4444]/30">
                      Flujo Principal
                    </span>
                  </div>

                  <div className="flex flex-col gap-3">
                    <StemUploader
                      songId={selectedSongId}
                      bandId={FAKE_BAND_ID}
                      onUploadComplete={handleUploadComplete}
                      compact={true}
                    />

                    {/* Complemento: Separador IA desde 1 archivo */}
                    <div className="border-t border-white/[0.06] pt-2.5 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setShowSplitterComplement(v => !v)}
                          className="text-[10px] font-bold text-[#8e96a4] hover:text-white flex items-center gap-1.5 transition-colors"
                        >
                          <Sparkles size={12} className="text-amber-400" />
                          <span>Complemento: ¿No tienes los stems separados? Extraer desde 1 canción con IA</span>
                          <span className="text-[9px] text-[#64748b] ml-1">{showSplitterComplement ? '▲' : '▼'}</span>
                        </button>
                        {isSplitting && (
                          <span className="text-[10px] text-amber-400 font-semibold animate-pulse">{splitMessage}</span>
                        )}
                      </div>

                      {(showSplitterComplement || isSplitting) && (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 bg-[#090b10] p-3 rounded-xl border border-white/[0.07]">
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Salida:</span>
                            <select
                              value={splitFormat}
                              onChange={(e) => setSplitFormat(e.target.value as 'mp3' | 'wav')}
                              disabled={isSplitting}
                              className="bg-[#12151e] text-xs text-gray-200 border border-white/10 rounded-lg px-2.5 py-1 outline-none cursor-pointer"
                            >
                              <option value="mp3">MP3 320k (Ligero)</option>
                              <option value="wav">WAV (Sin pérdida)</option>
                            </select>
                          </div>
                          <div className="relative flex-1 h-[34px] group bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/35 rounded-xl flex items-center justify-center px-3 cursor-pointer transition-all overflow-hidden">
                            <input type="file" accept="audio/mpeg, audio/wav, audio/mp3" onChange={handleSplitMP3} disabled={isSplitting} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10" />
                            <div className="flex items-center gap-2 pointer-events-none z-0">
                              {isSplitting ? <RefreshCw size={13} className="animate-spin text-amber-400" /> : <Sparkles size={13} className="text-amber-400" />}
                              <span className="text-xs font-bold text-amber-200 truncate">
                                {isSplitting ? splitMessage : "Subir 1 Archivo Completo para Separar en Stems"}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. GRILLA GLOBAL Y TEMPO (DESDE EL ARCHIVO MASTER) */}
                <div className="stage-glass-panel flex-1 rounded-2xl p-5 flex flex-col justify-between gap-3.5">
                  <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse shadow-[0_0_8px_#a855f7]" />
                      <h3 className="text-[11px] font-extrabold text-white uppercase tracking-[0.14em]">
                        Paso 2: Grilla Global, Compás y Tempo
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {currentMasterStem ? (
                        <span className="flex items-center gap-1 text-[9px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/35 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
                          <Star size={10} className="fill-amber-400 text-amber-400" />
                          Fuente IA: {currentMasterStem.name}
                        </span>
                      ) : stems.length > 0 ? (
                        <span className="text-[9px] font-bold px-2.5 py-0.5 rounded-full bg-[#151822] text-[#8e96a4] border border-white/10" title="Haz clic en la estrella ★ de una pista abajo para designarla como Master">
                          Sin ★ Master explícito (Usará {stems[0]?.name})
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-bold text-[#8e96a4] uppercase tracking-wider">Compás</label>
                      <select value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)} className="h-[36px] bg-[#090b10] border border-white/[0.08] rounded-xl text-xs text-white font-bold px-3 focus:border-purple-500 focus:outline-none">
                        <option value="4/4">4/4</option>
                        <option value="3/4">3/4</option>
                        <option value="6/8">6/8</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-bold text-[#8e96a4] uppercase tracking-wider">Tempo (BPM)</label>
                      <input
                        type="number"
                        value={manualBpm}
                        onChange={(e) => setManualBpm(e.target.value)}
                        placeholder="Auto IA"
                        className="h-[36px] bg-[#090b10] border border-white/[0.08] rounded-xl text-xs text-white font-mono font-bold px-3 focus:border-purple-500 focus:outline-none placeholder:text-[#64748b]"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-bold text-[#8e96a4] uppercase tracking-wider">Tonalidad (Key)</label>
                      <input
                        type="text"
                        value={manualKey}
                        onChange={(e) => setManualKey(e.target.value)}
                        placeholder="Ej. Do Mayor / Am"
                        className="h-[36px] bg-[#090b10] border border-white/[0.08] rounded-xl text-xs text-white font-bold px-3 focus:border-purple-500 focus:outline-none placeholder:text-[#64748b]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleSaveGridMeta}
                      disabled={isSavingMeta}
                      className="stage-tactile-btn h-[36px] px-4 bg-[#151822] hover:bg-[#1c202e] border border-white/10 text-gray-200 text-[11px] font-bold rounded-full flex items-center justify-center gap-1.5 transition-all shrink-0"
                      title="Guardar Compás, BPM manual y Tonalidad"
                    >
                      <Save size={13} />
                      <span>Guardar</span>
                    </button>
                    <button
                      onClick={handleGenerateChordsAI}
                      disabled={isGeneratingAI || stems.length === 0}
                      className="stage-tactile-btn flex-1 h-[36px] bg-gradient-to-r from-purple-600/25 to-[#ef4444]/20 hover:from-purple-600/35 hover:to-[#ef4444]/30 border border-purple-500/40 text-purple-200 text-xs font-black uppercase tracking-wider rounded-full flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                    >
                      {isGeneratingAI ? <RefreshCw className="animate-spin" size={14} /> : <Sparkles size={14} className="text-amber-400" />}
                      {isGeneratingAI ? "Analizando Master..." : "Capturar Tempo y Crear Grilla (IA)"}
                    </button>
                  </div>
                  {aiSuccessMessage && (
                    <div className="text-[10px] text-emerald-300 bg-emerald-950/40 px-3 py-1.5 rounded-xl border border-emerald-500/30 font-semibold truncate">
                      {aiSuccessMessage}
                    </div>
                  )}
                </div>
              </div>

              {/* Tracks / Stems Section (DAW Hardware Rack Style) */}
              <div className="stage-glass-panel flex flex-col rounded-2xl overflow-hidden shrink-0">
                {/* Tracks Header */}
                <div className="flex items-center px-5 py-3 bg-[#0d1017]/90 border-b border-white/[0.06]">
                  <div className="w-[330px] text-[10px] font-extrabold text-[#8e96a4] uppercase tracking-[0.16em] shrink-0">
                    Pista / Stem ({stems.length})
                  </div>
                  <div className="flex-1 text-[10px] font-extrabold text-[#8e96a4] uppercase tracking-[0.16em] pl-4">
                    Forma de Onda Real (Clic para adelantar/retroceder al reproducir)
                  </div>
                  <div className="w-[185px] text-[10px] font-extrabold text-[#8e96a4] uppercase tracking-[0.16em] text-right pr-2 shrink-0">
                    Master IA / Controles
                  </div>
                </div>

                {loadingStems ? (
                  <div className="flex items-center justify-center py-16 text-[#8e96a4]">
                    <Loader2 size={20} className="animate-spin mr-3 text-[#ef4444]" />
                    <span className="text-sm font-medium">Cargando stems...</span>
                  </div>
                ) : stems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 bg-[#090b10]/60">
                    <div className="w-13 h-13 rounded-2xl bg-[#131620] border border-white/10 flex items-center justify-center mb-3 shadow-inner">
                      <FileAudio size={22} className="text-[#64748b]" />
                    </div>
                    <p className="text-sm text-gray-300 font-bold">Esta canción aún no tiene Stems</p>
                    <p className="text-xs text-[#64748b] mt-1">Sube tus stems separados arriba (incluyendo el archivo Master) para comenzar.</p>
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-white/[0.05]">
                    {stems.map((stem, stemIdx) => {
                      const isThisDecorrelating = decorrelatingStemId === stem.id;
                      const isDspBusy = watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark;
                      const isDspTrack = Boolean(stem.metadata?.dsp_watermark);
                      const isMasterTrack = Boolean(stem.metadata?.is_master);
                      const isPlayingThis = playingStemId === stem.id;
                      const waveformBars = waveformsMap[stem.id];
                      const progressRatio = isPlayingThis && playProgress.duration > 0
                        ? Math.min(1, Math.max(0, playProgress.current / playProgress.duration))
                        : 0;

                      return (
                        <div
                          key={stem.id}
                          className={`flex min-h-[70px] transition-all duration-200 group ${
                            isMasterTrack
                              ? 'bg-gradient-to-r from-amber-500/[0.07] via-amber-500/[0.02] to-transparent hover:from-amber-500/[0.12]'
                              : isPlayingThis
                              ? 'bg-gradient-to-r from-emerald-500/[0.08] to-transparent'
                              : 'bg-[#090b10]/70 hover:bg-[#121622]/90'
                          }`}
                        >
                          {/* Track Info */}
                          <div className="w-[330px] px-5 py-3 flex flex-col justify-center border-r border-white/[0.05] bg-[#0c0e14]/60 shrink-0">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center ${
                                  isMasterTrack
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                                    : isDspTrack
                                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                    : 'bg-[#151822] text-gray-400 border border-white/[0.06]'
                                }`}
                              >
                                {isPlayingThis ? (
                                  <div className="flex items-end gap-[1.5px] h-3">
                                    <span className="w-[2px] bg-emerald-400 rounded-full animate-eq-1" />
                                    <span className="w-[2px] bg-emerald-400 rounded-full animate-eq-2" />
                                    <span className="w-[2px] bg-emerald-400 rounded-full animate-eq-3" />
                                  </div>
                                ) : isMasterTrack ? (
                                  <Star size={12} className="fill-amber-400" />
                                ) : isDspTrack ? (
                                  <Shield size={12} />
                                ) : (
                                  <FileAudio size={12} />
                                )}
                              </div>
                              <span className="text-[13px] font-bold text-white leading-snug whitespace-normal break-words tracking-tight">
                                {stem.name}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 pl-8 mt-1.5">
                              {isMasterTrack ? (
                                <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  ★ MASTER (Fuente Tempo / Acordes IA)
                                </span>
                              ) : (
                                <span className="text-[9px] text-[#8e96a4] uppercase tracking-wider font-bold">{stem.type || 'Stem'}</span>
                              )}
                              {isDspTrack && (
                                <span className="text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/25">
                                  DSP {stem.metadata?.dsp_preset ? String(stem.metadata.dsp_preset).toUpperCase() : 'CLEAN'}
                                </span>
                              )}
                              {isPlayingThis && (
                                <span className="text-[9px] font-mono text-emerald-400 font-bold ml-auto">
                                  {formatMmSs(playProgress.current)} / {formatMmSs(playProgress.duration)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Real / Interactive Waveform area */}
                          <div className="flex-1 flex items-center px-4 py-2 relative">
                            <div
                              onClick={(e) => handleSeekAudio(stem, e)}
                              className={`stage-tactile-pressed absolute inset-y-2 left-4 right-4 bg-[#08090c] border rounded-xl flex items-center justify-center overflow-hidden transition-all ${
                                isPlayingThis ? 'border-emerald-500/45 cursor-pointer shadow-[0_0_16px_rgba(16,185,129,0.12)]' : 'border-white/[0.05]'
                              }`}
                            >
                              {isPlayingThis && (
                                <div
                                  className="absolute inset-y-0 left-0 bg-emerald-500/10 border-r-2 border-emerald-400 pointer-events-none z-10 transition-all duration-100"
                                  style={{ width: `${progressRatio * 100}%` }}
                                />
                              )}
                              <div className={`w-full h-full flex items-center gap-[1.5px] px-2 transition-opacity duration-300 ${isPlayingThis ? 'opacity-95' : 'opacity-50 group-hover:opacity-75'}`}>
                                {Array.from({ length: 80 }).map((_, i) => {
                                  const barHeight = waveformBars
                                    ? waveformBars[i] || 15
                                    : 12 + ((i * (29 + stemIdx * 7) + stemIdx * 19) % 76);
                                  const isPlayedBar = isPlayingThis && (i / 80) <= progressRatio;
                                  return (
                                    <div
                                      key={i}
                                      className={`flex-1 rounded-full transition-all ${
                                        isPlayedBar
                                          ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                                          : isMasterTrack
                                          ? 'bg-amber-400/80'
                                          : isDspTrack
                                          ? 'bg-blue-400/80'
                                          : 'bg-[#64748b]'
                                      }`}
                                      style={{ height: `${barHeight}%` }}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* Controls (Right) */}
                          <div className="w-[185px] flex items-center justify-end px-4 gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => toggleMasterStem(stem)}
                              className={`stage-tactile-btn h-7 px-2.5 rounded-full flex items-center gap-1 text-[9px] font-black uppercase tracking-wider border transition-all ${
                                isMasterTrack
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                                  : 'bg-[#131620] text-[#8e96a4] border-white/[0.08] hover:text-amber-300 hover:border-amber-500/40'
                              }`}
                              title={isMasterTrack ? "Esta es la pista Master que lee la IA para el Tempo y Acordes" : "Marcar esta pista como el archivo Master para la IA"}
                            >
                              <Star size={11} className={isMasterTrack ? "fill-amber-400 text-amber-400" : ""} />
                              <span>Master</span>
                            </button>
                            <button
                              onClick={() => togglePlay(stem)}
                              className={`stage-tactile-btn w-8 h-8 flex items-center justify-center rounded-full border transition-all ${
                                isPlayingThis
                                  ? 'bg-emerald-500 text-[#08090c] border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                                  : 'bg-[#131620] text-gray-300 border-white/[0.08] hover:text-emerald-400 hover:border-emerald-500/40'
                              }`}
                              title={isPlayingThis ? "Pausar" : "Escuchar pista"}
                            >
                              {isPlayingThis ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
                            </button>
                            <button
                              onClick={() => handleDecorrelateExistingStem(stem)}
                              disabled={isDspBusy}
                              className={`stage-tactile-btn w-8 h-8 flex items-center justify-center rounded-full border transition-all ${
                                isThisDecorrelating
                                  ? 'text-blue-300 bg-blue-500/20 border-blue-500/40'
                                  : 'bg-[#131620] text-gray-400 border-white/[0.08] hover:text-blue-400 hover:border-blue-500/40 disabled:opacity-40 disabled:cursor-not-allowed'
                              }`}
                              title={`Decorrelacionar "${stem.name}" con preset ${PRESET_SHORT_LABEL[dspPreset]}`}
                            >
                              {isThisDecorrelating ? <Loader2 size={13} className="animate-spin" /> : <Shield size={13} />}
                            </button>
                            <button
                              onClick={() => deleteStem(stem.id)}
                              className="stage-tactile-btn w-8 h-8 flex items-center justify-center bg-[#131620] text-[#8e96a4] hover:text-red-400 hover:border-red-500/40 border border-white/[0.08] rounded-full transition-all"
                              title="Eliminar pista"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* DSP Watermark Module (Stealth Master DSP v4) */}
              <div className="stage-glass-panel flex-1 rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.7)]" />
                    <h3 className="text-[11px] font-extrabold text-white uppercase tracking-[0.14em]">
                      Stealth Master DSP v4 — Pure Studio Clarity Anti-Fingerprint
                    </h3>
                  </div>

                  {/* Dual-Engine Switcher */}
                  <div className="stage-tactile-pressed flex items-center bg-[#08090c] p-1 rounded-full border border-white/[0.07]">
                    <button
                      type="button"
                      onClick={() => setDspEngine('local')}
                      disabled={watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${
                        dspEngine === 'local'
                          ? 'bg-blue-600/25 text-blue-300 border border-blue-500/40 shadow-sm'
                          : 'text-[#8e96a4] hover:text-white'
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
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${
                        dspEngine === 'cloud'
                          ? 'bg-purple-600/25 text-purple-300 border border-purple-500/40 shadow-sm'
                          : 'text-[#8e96a4] hover:text-white'
                      }`}
                      title="Ejecuta en el worker remoto de Replicate (con fallback local automático)"
                    >
                      <Cloud size={11} />
                      Cloud Worker
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-4 flex-1 justify-between">
                  <p className="text-[11px] text-[#8e96a4] leading-relaxed">
                    Ataque psicoacústico quirúrgico sin ensuciar el audio: <code className="text-blue-400">🎹 Ghost MIDI Sub-Bass (55-185 Hz, máscara Fletcher-Munson)</code>, <code className="text-blue-400">🎯 Constellation Poisoning (Gabor 350-4800 Hz con máscara Bark)</code>, <code className="text-blue-400">Desplazamiento CQT (+2.0% a +4.35%)</code> y <code className="text-blue-400">🛡️ Dispersión All-Pass Estática (0.0 dB plana, cero flanger)</code> manteniendo agudos cristalinos hasta 18.8 kHz.
                  </p>

                  {/* 3 Preset Selector Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {DSP_PRESETS.map((p) => {
                      const active = dspPreset === p.id;
                      const isBusy = watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={isBusy}
                          onClick={() => setDspPreset(p.id)}
                          className={`text-left p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-1.5 ${
                            active
                              ? 'bg-gradient-to-br from-blue-950/35 to-[#121622] border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
                              : 'bg-[#0b0d13] border-white/[0.06] hover:border-white/15 hover:bg-[#121620]'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs font-extrabold ${active ? 'text-blue-300' : 'text-gray-200'}`}>
                              {p.name}
                            </span>
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                active
                                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                  : 'bg-[#141720] text-[#8e96a4] border-white/[0.06]'
                              }`}
                            >
                              {p.badge}
                            </span>
                          </div>
                          <p className="text-[10px] text-[#8e96a4] leading-snug">{p.description}</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Psychoacoustic & Stealth Countermeasures Toggles */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-[9px] font-bold text-[#64748b] uppercase tracking-widest mr-1">
                      Módulos Activos:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPitchMode((m) =>
                          m === 'a432_detune' ? 'lock_440' : m === 'lock_440' ? 'varispeed_up' : 'a432_detune'
                        )
                      }
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        pitchMode === 'a432_detune'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                          : pitchMode === 'lock_440'
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                      }`}
                      title={
                        pitchMode === 'a432_detune'
                          ? 'Afinación maestra A=432 Hz (-31.8 cents) 100% coherente en fase estéreo y sin variación de volumen. Voz más cálida y con cuerpo (sin acelerar ni sonar chillona) y destrucción de la huella espectral de Riffusion/Suno.'
                          : pitchMode === 'lock_440'
                          ? 'Mantiene la afinación A=440 Hz al 100% idéntica al original (0.0 cents).'
                          : 'Acelera la canción (+2% a +4% / +50 cents).'
                      }
                    >
                      <span>
                        {pitchMode === 'a432_detune'
                          ? '🎻 A=432 Hz (Fase Pura)'
                          : pitchMode === 'lock_440'
                          ? '🔒 Tono 440 Hz (Exacto)'
                          : '⚡ Varispeed (+50 Cents)'}
                      </span>
                      <span className="text-[8px] uppercase">
                        {pitchMode === 'a432_detune'
                          ? '-31.8 CENTS'
                          : pitchMode === 'lock_440'
                          ? '0.0 CENTS'
                          : '+50 CENTS'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseAntiSuno((v) => !v)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useAntiSuno
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.15)]'
                          : 'bg-[#090b10] text-[#64748b] border-white/[0.07]'
                      }`}
                      title="Neutralizador Forense Anti-Suno v2: Corte ultrasónico 8º orden a 17.8 kHz, 5 notches quirúrgicos (8.8k-17.1k), De-Cuantizador de Formantes Vocales RVQ de Suma Cero (700 Hz-6.8 kHz) y micro-jitter de 3 osciladores."
                    >
                      <span>🛡️ Anti-Suno Shield v2</span>
                      <span className="text-[8px] uppercase">{useAntiSuno ? 'HUMANIZADO' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseTransientPunch((v) => !v)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useTransientPunch
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                          : 'bg-[#090b10] text-[#64748b] border-white/[0.07]'
                      }`}
                      title="Micro-Articulación Acústica Humana: Realza el micro-ataque rápido (<5ms) de la percusión y consonantes en frecuencias altas sin modular ni multiplicar el volumen del tema, garantizando estabilidad total de volumen (0.0 dB pumping)."
                    >
                      <span>🥁 Pegada Acústica (Crest Factor)</span>
                      <span className="text-[8px] uppercase">{useTransientPunch ? 'HUMANO (ESTABLE)' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseTapeBed((v) => !v)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useTapeBed
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : 'bg-[#090b10] text-[#64748b] border-white/[0.07]'
                      }`}
                      title="Capa acústica orgánica de calidez de cinta analógica a -39.5 dBFS con compuerta de envolvente dinámica (0 en silencios). Rellena los valles inter-transientes sin generar soplido continuo de difusión."
                    >
                      <span>🎛️ Cinta Analógica (-39.5 dB)</span>
                      <span className="text-[8px] uppercase">{useTapeBed ? 'ON' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseSideBloom((v) => !v)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useSideBloom
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                          : 'bg-[#090b10] text-[#64748b] border-white/[0.07]'
                      }`}
                      title="Difusión espacial Schroeder en canal Side (L-R) por encima de 220 Hz. Destruye el downmix mono (L+R)/2 de Shazam y ContentID mientras crea amplitud 3D natural en estéreo con afinación intacta."
                    >
                      <span>🌐 Bloom Espacial Side (L-R)</span>
                      <span className="text-[8px] uppercase">{useSideBloom ? 'ON' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseGhostMidiBass((v) => !v)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useGhostMidiBass
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.18)]'
                          : 'bg-[#090b10] text-[#64748b] border-white/[0.07]'
                      }`}
                      title="Ghost MIDI Sub-Bass 3x Turbo Key-Locked: Rastrea la nota fundamental real del bajo de la canción (zero-crossings) e inyecta un sintetizador Moog analógico de 6 armónicos (55-850 Hz) con Overlap-Add Hann del 50% (volumen 100% constante, +10 dB de potencia)."
                    >
                      <span>🎹 Ghost MIDI Sub-Bass 3x (55-850 Hz)</span>
                      <span className="text-[8px] uppercase">{useGhostMidiBass ? 'TURBO KEY-LOCK' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseConstellationPoison((v) => !v)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useConstellationPoison
                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/40'
                          : 'bg-[#090b10] text-[#64748b] border-white/[0.07]'
                      }`}
                      title="Micro-ráfagas Gabor por salto de frecuencia (350-4.8 kHz). Desactivado por defecto para evitar que clasificadores confundan los chirps con ruido de difusión de Riffusion."
                    >
                      <span>🎯 Gabor Chirps</span>
                      <span className="text-[8px] uppercase">{useConstellationPoison ? 'ON' : 'OFF (ANTI-DIFFUSION)'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseConstellationTilt((v) => !v)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        useConstellationTilt
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : 'bg-[#090b10] text-[#64748b] border-white/[0.07]'
                      }`}
                      title="Tilt Espectral Multiplicativo de Suma Cero: Intercambia la dominancia de picos espectrales en 3 pares complementarios (±1.3 dB) donde la suma de energía es estrictamente 0.00 dB, garantizando un volumen constante e invariable."
                    >
                      <span>🎛️ Tilt Espectral (Suma Cero)</span>
                      <span className="text-[8px] uppercase">{useConstellationTilt ? 'ESTABLE' : 'OFF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUsePhaseDispersion((v) => !v)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                        usePhaseDispersion
                          ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                          : 'bg-[#090b10] text-[#64748b] border-white/[0.07]'
                      }`}
                      title="Red All-Pass estática + Micro-Warp Estéreo Opuesto de 1-Tap (>380 Hz): Respuesta de 0.00 dB exacta en estéreo (cero fluctuaciones de volumen ni cancelación de graves), pero destruye los armónicos de Suno cuando el bot suma 0.5*(L+R) a mono."
                    >
                      <span>🛡️ Dispersión de Fase Estática (0.0 dB)</span>
                      <span className="text-[8px] uppercase">{usePhaseDispersion ? 'ON' : 'OFF'}</span>
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 pt-1">
                    {cleanAudioUrl && (
                      <div className="flex flex-col gap-2 bg-[#090b10] border border-white/[0.08] rounded-2xl p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                            <CheckCircle size={12} />
                            Master Decorrelacionado Listo
                          </span>
                          {dspTelemetry && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider">
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                {dspTelemetry.decorrelationPct}% Evasión
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                {dspTelemetry.preset}
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-[#131620] text-gray-300 border border-white/10">
                                +{dspTelemetry.speedShiftPct}% Varispeed
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-[#131620] text-gray-300 border border-white/10">
                                {dspTelemetry.peakDbtp} dBTP
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-[#131620] text-[#8e96a4] border border-white/10">
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
                      <div className="flex items-center justify-between sm:justify-start gap-2 bg-[#090b10] border border-white/[0.08] rounded-full px-4 py-1.5 shrink-0">
                        <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-widest">Formato Salida:</span>
                        <select
                          value={dspFormat}
                          onChange={(e) => setDspFormat(e.target.value as DspFormat)}
                          disabled={watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark}
                          className="bg-transparent text-xs text-gray-200 font-semibold outline-none cursor-pointer"
                        >
                          <option value="wav" className="bg-[#090b10]">WAV 16-bit (Máxima compatibilidad)</option>
                          <option value="flac" className="bg-[#090b10]">FLAC 24-bit (Sin pérdida Studio)</option>
                          <option value="mp3" className="bg-[#090b10]">MP3 320k CBR (Ahorra espacio)</option>
                        </select>
                      </div>

                      <div className="stage-tactile-btn relative flex-1 h-[38px] group bg-gradient-to-r from-blue-600/20 to-indigo-600/20 hover:from-blue-600/30 hover:to-indigo-600/30 border border-blue-500/40 text-blue-200 rounded-full flex items-center justify-center transition-all overflow-hidden">
                        <input
                          type="file"
                          accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
                          onChange={handleUploadAndProcessWatermark}
                          disabled={watermarkJobStatus === 'pending' || watermarkJobStatus === 'processing' || isUploadingWatermark}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                        />
                        <div className="flex items-center gap-2 pointer-events-none z-0 text-xs font-extrabold tracking-wide">
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
                      <div className={`text-[10px] px-3.5 py-2 rounded-xl border break-words font-medium ${watermarkJobStatus === 'failed' ? 'bg-red-900/15 text-red-300 border-red-500/30' : watermarkJobStatus === 'completed' ? 'bg-emerald-900/15 text-emerald-300 border-emerald-500/30' : 'bg-blue-900/15 text-blue-300 border-blue-500/30'}`}>
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
