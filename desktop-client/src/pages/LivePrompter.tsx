import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAudioEngine, StemTrack } from '../hooks/useAudioEngine';
import { Prompter, SectionEvent } from '../components/Prompter';
import { Play, Pause, Square, Mic, Edit3, Save, AlertCircle, Activity, Sparkles, Loader2, Disc3, ArrowRight, Check, PanelLeftClose, PanelLeftOpen, Sliders, ChevronDown, ChevronUp, Minimize2, Maximize2, X, RotateCcw } from 'lucide-react';
import {
  InstrumentCategory,
  SELECTABLE_INSTRUMENT_PRESETS,
  detectInstrumentCategory,
  extractCleanTrackLabel,
  getInstrumentPreset,
  InstrumentSvgIcon,
} from '../utils/instrumentIcons';
import '../App.css';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

const CHROMATIC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHROMATIC_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function transposeSingleNote(note: string, semitones: number): string {
  let idx = CHROMATIC_SHARP.indexOf(note);
  const preferFlats = note.includes('b');
  if (idx === -1) idx = CHROMATIC_FLAT.indexOf(note);
  if (idx === -1) return note;
  const nextIdx = (((idx + semitones) % 12) + 12) % 12;
  return preferFlats ? CHROMATIC_FLAT[nextIdx] : CHROMATIC_SHARP[nextIdx];
}

function transposeChordSymbol(chord: string, semitones: number): string {
  if (!chord || chord === 'N' || chord === 'NC') return chord;
  return chord.replace(/([A-G][#b]?)/g, (match) => transposeSingleNote(match, semitones));
}

export default function LivePrompter() {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(() => {
    return sessionStorage.getItem('tandu_active_song_id');
  });
  const {
    loadStems,
    play,
    pause,
    seekTo,
    isPlaying,
    currentTime,
    stems,
    setStems,
    setLoop,
    loadProgress,
    totalDuration,
    preRollDuration,
    exportLiveMix,
    exportMultitrackToZip,
    exportFullMixToMp3,
    getCompositePeaks,
    previewVoiceCue,
    syncPrompterData,
  } = useAudioEngine([]);
  
  const [prompterData, setPrompterData] = useState<{
    bpm?: number;
    timeSignature?: string;
    key?: string;
    firstBeatOffset?: number;
    beatTimes?: number[];
    chords: any[];
    sections: any[];
    lyrics?: any[];
    lyric_settings?: any;
    mixConfig?: any;
    lastAiDetection?: string;
  }>({ chords: [], sections: [], lyrics: [] });
  
  const [isDetectingChords, setIsDetectingChords] = useState(false);
  const [chordDetectionMsg, setChordDetectionMsg] = useState<string | null>(null);
  const [isVamping, setIsVamping] = useState(false);
  
  // Ref del tiempo para el editor en vivo (evitar stale closures y re-binds)
  const currentTimeRef = useRef(0);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  const [isEditingSections, setIsEditingSections] = useState(false);
  const [isEditingPrompter, setIsEditingPrompter] = useState(false);
  const [prompterText, setPrompterText] = useState('');
  
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [localSliderTime, setLocalSliderTime] = useState(0);

  const [isExporting, setIsExporting] = useState(false);
  const [isExportingMultitrack, setIsExportingMultitrack] = useState(false);
  const [isExportingMp3, setIsExportingMp3] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  
  // Stems as returned from Supabase
  const [dbStems, setDbStems] = useState<any[]>([]);
  
  // Error state for audio loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Grid Nudge State
  const [manualGridOffset, setManualGridOffset] = useState<number>(0);
  const [audioLoaded, setAudioLoaded] = useState(false);

  // CapCut Sections History, Waveform & Unsaved Indicator
  const [sectionsHistoryPast, setSectionsHistoryPast] = useState<SectionEvent[][]>([]);
  const [sectionsHistoryFuture, setSectionsHistoryFuture] = useState<SectionEvent[][]>([]);
  const [hasUnsavedSections, setHasUnsavedSections] = useState<boolean>(false);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [saveToastMsg, setSaveToastMsg] = useState<string | null>(null);

  // Apple Design Collapsible Track Console State
  const [isConsoleCollapsed, setIsConsoleCollapsed] = useState<boolean>(false);
  const [isCompactChannels, setIsCompactChannels] = useState<boolean>(false);
  const [collapsedTrackIds, setCollapsedTrackIds] = useState<Record<string, boolean>>({});
  const [editingTrackPopoverId, setEditingTrackPopoverId] = useState<string | null>(null);
  const [trackAliasDraft, setTrackAliasDraft] = useState<string>('');
  const [isSavingTrackMeta, setIsSavingTrackMeta] = useState<boolean>(false);

  const prompterDataRef = useRef(prompterData);
  useEffect(() => {
    prompterDataRef.current = prompterData;
    syncPrompterData(prompterData);
  }, [prompterData, syncPrompterData]);

  /**
   * Deep-Merge seguro para guardar en songs.prompter_data sin sobrescribir jamás
   * las letras sincronizadas (lyrics / lyric_settings) creadas en Lyric Studio.
   */
  const persistPrompterDataSafe = async (songId: string, nextLocalData: any) => {
    const { data: currentSongRow } = await supabase
      .from('songs')
      .select('prompter_data')
      .eq('id', songId)
      .single();
    const latestRemote = currentSongRow?.prompter_data || {};
    const merged = {
      ...latestRemote,
      ...nextLocalData,
      // Preservar siempre las letras de Lyric Studio si existen en remoto
      lyrics: latestRemote.lyrics ?? nextLocalData.lyrics ?? [],
      lyric_settings: latestRemote.lyric_settings ?? nextLocalData.lyric_settings,
    };
    const { error } = await supabase
      .from('songs')
      .update({ prompter_data: merged })
      .eq('id', songId);
    if (error) throw error;
    setPrompterData(merged);
    return merged;
  };

  // Fetch songs
  useEffect(() => {
    const fetchSongs = async () => {
      const { data } = await supabase.from('songs').select('*').eq('band_id', FAKE_BAND_ID).order('title');
      if (data) {
        setSongs(data);
        const savedId = sessionStorage.getItem('tandu_active_song_id');
        if (savedId && data.some((s: any) => s.id === savedId)) {
          setSelectedSongId(savedId);
        }
      }
    };
    fetchSongs();
  }, []);

  // Fetch stems and prompter data when a song is selected
  useEffect(() => {
    if (!selectedSongId) return;
    sessionStorage.setItem('tandu_active_song_id', selectedSongId);
    const fetchSongData = async () => {
      setAudioLoaded(false);
      setLoadError(null);
      setIsVamping(false);
      setSectionsHistoryPast([]);
      setSectionsHistoryFuture([]);
      setHasUnsavedSections(false);
      setWaveformPeaks([]);
      setSaveToastMsg(null);
      setEditingTrackPopoverId(null);
      setLoop(0, 0, false);
      pause(); // Stop any current playback
      
      // 1. Fetch Prompter Data
      const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
      const loadedPrompterData = songData?.prompter_data || {};
      if (songData && songData.prompter_data) {
        setPrompterData({
          chords: [],
          sections: [],
          lyrics: [],
          ...songData.prompter_data,
        });
        setPrompterText(stringifyPrompterData(songData.prompter_data));
      } else {
        setPrompterData({ chords: [], sections: [], lyrics: [] });
        setPrompterText(stringifyPrompterData({ chords: [], sections: [] }));
      }

      // 2. Fetch Stems
      const { data } = await supabase.from('stems').select('*').eq('song_id', selectedSongId).order('name');
      if (data && data.length > 0) {
        const playableStems = data;
        setDbStems(playableStems);

        // Detectar si existen stems separados además de la pista Master
        const hasSeparatedStems = playableStems.length > 1 && playableStems.some((s: any) => !s.metadata?.is_master);
        
        // Map database stems to Audio Engine format
        const engineStems: StemTrack[] = playableStems.map(stem => {
          const lowerName = stem.name.toLowerCase();
          const isMasterTrack = Boolean(stem.metadata?.is_master);
          let type: 'Click' | 'Cues' | 'Instrument' = 'Instrument';
          if (lowerName.includes('click') || lowerName.includes('metronomo')) type = 'Click';
          if (lowerName.includes('cue') || lowerName.includes('guia') || lowerName.includes('cues')) type = 'Cues';
          
          // Si hay stems separados y esta pista es el Master (Guía IA), entra en MUTE por defecto
          // para no duplicar instrumentos en la consola ni en la exportación FOH.
          const defaultMuted = isMasterTrack && hasSeparatedStems
            ? true
            : (stem.metadata?.muted !== undefined ? Boolean(stem.metadata.muted) : false);

          return {
            id: stem.id,
            name: stem.name,
            type: type,
            url: stem.file_url,
            volume: stem.metadata?.volume !== undefined ? Number(stem.metadata.volume) : 0.8,
            pan: stem.metadata?.pan !== undefined ? Number(stem.metadata.pan) : 0,
            muted: defaultMuted,
            solo: stem.metadata?.solo !== undefined ? Boolean(stem.metadata.solo) : false,
            targetOutputChannel: 0
          };
        });

        // Recuperar configuración persistida de Metrónomo y Cues (o balance seguro por defecto)
        const savedClick = loadedPrompterData?.mixConfig?.click;
        const savedCues = loadedPrompterData?.mixConfig?.cues;

        // Insertar el Metrónomo IA Sintético (paneo y volumen configurables, por defecto Centro 0)
        engineStems.push({
          id: 'synthetic-click',
          name: 'Metrónomo IA',
          type: 'Click',
          url: '', // Se genera matemáticamente en RAM
          volume: savedClick?.volume !== undefined ? Number(savedClick.volume) : 0.8,
          pan: savedClick?.pan !== undefined ? Number(savedClick.pan) : 0,
          muted: savedClick?.muted !== undefined ? Boolean(savedClick.muted) : false,
          solo: false,
          targetOutputChannel: 0
        });

        // Insertar las Guías IA Sintéticas (Voz Guía con paneo configurable, por defecto Centro 0)
        engineStems.push({
          id: 'synthetic-cues',
          name: 'Voz Guía IA',
          type: 'Cues',
          url: '', // Se genera matemáticamente en RAM
          volume: savedCues?.volume !== undefined ? Number(savedCues.volume) : 0.8,
          pan: savedCues?.pan !== undefined ? Number(savedCues.pan) : 0,
          muted: savedCues?.muted !== undefined ? Boolean(savedCues.muted) : false,
          solo: false,
          targetOutputChannel: 0
        });

        setStems(engineStems);
      } else {
        setDbStems([]);
        setStems([]);
      }
    };
    fetchSongData();
  }, [selectedSongId]);

  // Load Audio Buffers when stems are prepared
  const handleLoadAudio = async () => {
    setLoadError(null);
    setIsDownloading(true);
    try {
      const baseOffset = prompterData.firstBeatOffset !== undefined 
        ? prompterData.firstBeatOffset 
        : (prompterData.chords && prompterData.chords.length > 0 ? prompterData.chords[0].time : 0);
      await loadStems(prompterData.bpm || 120, baseOffset + manualGridOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData, stems);
      setWaveformPeaks(getCompositePeaks(900));
      setAudioLoaded(true);
    } catch (error: any) {
      setLoadError("Error descargando las pistas. Asegúrate de tener conexión y permisos CORS habilitados en el Bucket.");
      console.error(error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveMixConfig = async () => {
    if (!selectedSongId) return;
    try {
      const updates = stems.filter(s => s.id !== 'synthetic-click' && s.id !== 'synthetic-cues').map(async (s) => {
        const originalStem = dbStems.find((dbS: any) => dbS.id === s.id);
        const newMetadata = {
          ...(originalStem?.metadata || {}),
          volume: s.volume,
          pan: s.pan,
          muted: s.muted,
          solo: s.solo
        };
        const { error } = await supabase.from('stems').update({ metadata: newMetadata }).eq('id', s.id);
        if (error) throw error;
      });

      await Promise.all(updates);

      // Persistir configuración de Metrónomo IA y Voz Guía IA en prompter_data
      const clickStem = stems.find(s => s.id === 'synthetic-click');
      const cueStem = stems.find(s => s.id === 'synthetic-cues');
      const updatedPrompterData = {
        ...prompterData,
        mixConfig: {
          ...(prompterData.mixConfig || {}),
          click: clickStem
            ? { ...(prompterData.mixConfig?.click || {}), volume: clickStem.volume, pan: clickStem.pan, muted: clickStem.muted }
            : undefined,
          cues: cueStem
            ? { ...(prompterData.mixConfig?.cues || {}), volume: cueStem.volume, pan: cueStem.pan, muted: cueStem.muted }
            : undefined,
        }
      };
      setPrompterData(updatedPrompterData);
      await persistPrompterDataSafe(selectedSongId, updatedPrompterData);
      
      const { data } = await supabase.from('stems').select('*').eq('song_id', selectedSongId).order('name');
      if (data) setDbStems(data);

      alert('¡Configuración de faders, paneos y guías guardada exitosamente!');
    } catch (err: any) {
      alert(`Error al guardar configuración: ${err.message}`);
    }
  };

  /**
   * Actualiza y persiste quirúrgicamente el icono instrumental y/o alias corto de una pista
   * en metadata sin reiniciar ni recargar el motor de audio.
   */
  const handleUpdateTrackMeta = async (
    stemId: string,
    patch: { instrument_icon?: InstrumentCategory | null; display_name?: string | null }
  ) => {
    if (!selectedSongId) return;
    setIsSavingTrackMeta(true);
    try {
      if (stemId === 'synthetic-click' || stemId === 'synthetic-cues') {
        const key = stemId === 'synthetic-click' ? 'click' : 'cues';
        const prevSection = prompterData.mixConfig?.[key] || {};
        const nextSection: any = { ...prevSection };
        if ('instrument_icon' in patch) {
          if (patch.instrument_icon) nextSection.instrument_icon = patch.instrument_icon;
          else delete nextSection.instrument_icon;
        }
        if ('display_name' in patch) {
          if (patch.display_name && patch.display_name.trim()) nextSection.display_name = patch.display_name.trim();
          else delete nextSection.display_name;
        }
        const nextPrompterData = {
          ...prompterData,
          mixConfig: {
            ...(prompterData.mixConfig || {}),
            [key]: nextSection,
          },
        };
        await persistPrompterDataSafe(selectedSongId, nextPrompterData);
        return;
      }

      const originalStem = dbStems.find((dbS: any) => dbS.id === stemId);
      const nextMetadata: Record<string, any> = { ...(originalStem?.metadata || {}) };
      if ('instrument_icon' in patch) {
        if (patch.instrument_icon) nextMetadata.instrument_icon = patch.instrument_icon;
        else delete nextMetadata.instrument_icon;
      }
      if ('display_name' in patch) {
        if (patch.display_name && patch.display_name.trim()) nextMetadata.display_name = patch.display_name.trim();
        else delete nextMetadata.display_name;
      }

      // Actualización optimista en memoria
      setDbStems((prev: any[]) =>
        prev.map((d: any) => (d.id === stemId ? { ...d, metadata: nextMetadata } : d))
      );

      const { error } = await supabase
        .from('stems')
        .update({ metadata: nextMetadata })
        .eq('id', stemId);
      if (error) throw error;
    } catch (err: any) {
      console.error('Error guardando metadata de icono/alias de pista:', err);
    } finally {
      setIsSavingTrackMeta(false);
    }
  };

  const handleNudge = async (amount: number) => {
    const newOffset = manualGridOffset + amount;
    setManualGridOffset(newOffset);
    if (audioLoaded) {
      const baseOffset = prompterData.firstBeatOffset !== undefined 
        ? prompterData.firstBeatOffset 
        : (prompterData.chords && prompterData.chords.length > 0 ? prompterData.chords[0].time : 0);
      await loadStems(prompterData.bpm || 120, baseOffset + newOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData);
      
      if (isPlaying) {
        const current = currentTime;
        pause();
        setTimeout(() => {
          seekTo(current);
          play();
        }, 50);
      }
    }
  };

  const handleHalveTempo = async () => {
    if (!prompterData.bpm) return;
    const newBpm = prompterData.bpm / 2;
    let newBeatTimes = prompterData.beatTimes;
    if (newBeatTimes && newBeatTimes.length > 0) {
      newBeatTimes = newBeatTimes.filter((_, i) => i % 2 === 0);
    }
    const newData = { ...prompterData, bpm: newBpm, beatTimes: newBeatTimes };
    setPrompterData(newData);
    await loadStems(newBpm, (prompterData.firstBeatOffset || 0) + manualGridOffset, prompterData.timeSignature, newBeatTimes, newData);
    
    if (selectedSongId) {
      await persistPrompterDataSafe(selectedSongId, newData);
    }
  };

  const handleDoubleTempo = async () => {
    if (!prompterData.bpm) return;
    const newBpm = prompterData.bpm * 2;
    let newBeatTimes = prompterData.beatTimes;
    if (newBeatTimes && newBeatTimes.length > 0) {
      const doubled = [];
      for (let i = 0; i < newBeatTimes.length - 1; i++) {
        doubled.push(newBeatTimes[i]);
        doubled.push((newBeatTimes[i] + newBeatTimes[i+1]) / 2);
      }
      doubled.push(newBeatTimes[newBeatTimes.length - 1]);
      newBeatTimes = doubled;
    }
    const newData = { ...prompterData, bpm: newBpm, beatTimes: newBeatTimes };
    setPrompterData(newData);
    await loadStems(newBpm, (prompterData.firstBeatOffset || 0) + manualGridOffset, prompterData.timeSignature, newBeatTimes, newData);
    
    if (selectedSongId) {
      await persistPrompterDataSafe(selectedSongId, newData);
    }
  };

  const handleTransposeAllChords = async (semitones: number) => {
    if (!selectedSongId || !prompterData.chords || prompterData.chords.length === 0) return;
    const transposed = prompterData.chords.map((c: any) => ({
      ...c,
      chord: transposeChordSymbol(c.chord, semitones),
    }));
    const nextData = { ...prompterData, chords: transposed };
    setPrompterData(nextData);
    setPrompterText(stringifyPrompterData(nextData));
    await persistPrompterDataSafe(selectedSongId, nextData);
  };

  const handleEditSingleChord = async (index: number, newChord: string) => {
    if (!selectedSongId) return;
    const nextChords = [...(prompterData.chords || [])];
    if (!nextChords[index]) return;
    nextChords[index] = { ...nextChords[index], chord: newChord };
    const nextData = { ...prompterData, chords: nextChords };
    setPrompterData(nextData);
    setPrompterText(stringifyPrompterData(nextData));
    await persistPrompterDataSafe(selectedSongId, nextData);
  };

  const handleRemoveSingleChord = async (index: number) => {
    if (!selectedSongId) return;
    const nextChords = [...(prompterData.chords || [])];
    nextChords.splice(index, 1);
    const nextData = { ...prompterData, chords: nextChords };
    setPrompterData(nextData);
    setPrompterText(stringifyPrompterData(nextData));
    await persistPrompterDataSafe(selectedSongId, nextData);
  };

  const handleVampTrigger = (start: number, end: number) => {
    if (isVamping) {
      setIsVamping(false);
      setLoop(0, 0, false);
    } else {
      setIsVamping(true);
      setLoop(start, end, true);
    }
  };

  const handleClearBeatGrid = async () => {
    if (!prompterData.bpm) return;
    const newData = { ...prompterData, beatTimes: [] };
    setPrompterData(newData);
    await loadStems(prompterData.bpm, (prompterData.firstBeatOffset || 0) + manualGridOffset, prompterData.timeSignature, [], newData);
    
    if (selectedSongId) {
      await persistPrompterDataSafe(selectedSongId, newData);
    }
    alert("Grilla IA descartada. El metrónomo ahora es 100% matemático y rígido.");
  };

  const handleDetectChordsAI = async () => {
    if (!selectedSongId) {
      alert("Selecciona una canción primero.");
      return;
    }
    if (!dbStems || dbStems.length === 0) {
      alert("No hay stems en la base de datos para esta canción.");
      return;
    }

    setIsDetectingChords(true);
    setChordDetectionMsg("Buscando la pista ★ Master o mejor stem armónico...");

    try {
      // ✅ Prioridad ABSOLUTA al track MASTER para mayor solidez en los acordes
      let bestStem = dbStems.find((s: any) => s.metadata && s.metadata.is_master === true);

      if (!bestStem) {
        // Fallback si no hay master: Piano > Guitarra > etc.
        const EXCLUDED_KEYWORDS = ['drum', 'kick', 'snare', 'click', 'clave', 'bass', 'bajo', 'perc', 'hihat', 'cymbal'];
        const PREFERRED_KEYWORDS = ['master', 'mezcla', 'full', 'rhythm guitar', 'electric guitar', 'guitar', 'guitarra', 'piano', 'keys', 'teclado', 'strings', 'pad', 'synth', 'organ'];

        const instrumentStems = dbStems.filter((s: any) => {
          const name = (s.name || s.file_name || '').toLowerCase();
          return !EXCLUDED_KEYWORDS.some(kw => name.includes(kw));
        });

        for (const kw of PREFERRED_KEYWORDS) {
          const found = instrumentStems.find((s: any) => {
            const name = (s.name || s.file_name || '').toLowerCase();
            return name.includes(kw);
          });
          if (found) {
            bestStem = found;
            break;
          }
        }
        if (!bestStem) bestStem = instrumentStems[0];
      }

      if (!bestStem) bestStem = dbStems[0];

      const stemName = bestStem.name || bestStem.file_name || 'Stem';
      const stemUrl = bestStem.file_url;

      console.log(`[IA PRO] Stem seleccionado para análisis: ${stemName}`);
      setChordDetectionMsg(`Analizando acordes desde: ${stemName}...`);

      const res = await fetch('/api/ai/chords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId: selectedSongId,
          timeSignature: prompterData.timeSignature || "4/4",
          stems: [{ name: stemName, file_url: stemUrl, type: 'Instrument', metadata: { is_master: true } }],
          detectedBpm: prompterData.bpm,
          firstBeat: prompterData.firstBeatOffset || 0,
          beatTimes: prompterData.beatTimes || [],
          sections: prompterData.sections || []
        })
      });

      const responseText = await res.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Respuesta inválida del servidor: ${responseText.substring(0, 100)}`);
      }
      if (!res.ok) throw new Error(data.error || 'Error desconocido del servidor IA');

      const { predictionId, prompterData: pdFromApi } = data;
      setChordDetectionMsg(`IA procesando acordes desde ${stemName}... (toma 2-5 min)`);

      let chordsPollCount = 1;
      let isChordsDone = false;

      while (!isChordsDone && chordsPollCount < 300) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch('/api/ai/chords/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            predictionId,
            prompterData: {
              ...pdFromApi,
              lyrics: prompterData.lyrics || [],
              lyric_settings: prompterData.lyric_settings,
            },
            songId: selectedSongId
          })
        });

        const statusText = await statusRes.text();
        let statusData;
        try {
          statusData = JSON.parse(statusText);
        } catch (e) {
          console.error("Respuesta no-JSON del servidor (polling):", statusText);
          throw new Error(`Respuesta inválida del servidor al consultar el estado de la IA.`);
        }

        if (!statusRes.ok) throw new Error(statusData.error || `Error en polling acordes (HTTP ${statusRes.status})`);

        if (statusData.done) {
          isChordsDone = true;
          setChordDetectionMsg("¡Acordes generados exitosamente!");

          const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
          if (songData?.prompter_data) {
            setPrompterData(prev => ({
              ...songData.prompter_data,
              lyrics: songData.prompter_data.lyrics || prev.lyrics || [],
              lyric_settings: songData.prompter_data.lyric_settings || prev.lyric_settings,
            }));
          }
          setTimeout(() => setChordDetectionMsg(null), 5000);
        } else {
          if (statusData.status === 'starting' && chordsPollCount > 10) {
            setChordDetectionMsg(`IA despertando (cold boot)... puede tomar 5-10 min (Intento ${chordsPollCount})`);
          } else {
            setChordDetectionMsg(`IA procesando... Estado: ${statusData.status} (Intento ${chordsPollCount})`);
          }
        }
        chordsPollCount++;
      }

    } catch (error: any) {
      console.error("Error detecting chords AI:", error);
      alert(`Falló la detección IA: ${error.message}`);
      setChordDetectionMsg(null);
    } finally {
      setIsDetectingChords(false);
    }
  };


  const handleVolumeChange = (stemId: string, newVolume: number) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, volume: newVolume } : s));
  };

  const handlePanChange = (stemId: string, newPan: number) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, pan: newPan } : s));
  };

  const toggleMute = (stemId: string) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, muted: !s.muted } : s));
  };

  const toggleSolo = (stemId: string) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, solo: !s.solo } : s));
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

  // --- Prompter Parser Logic ---
  const stringifyPrompterData = (data: any) => {
    let text = '# SECCIONES\n';
    if (data?.sections) {
      data.sections.forEach((s: any) => {
        const mins = Math.floor(s.time / 60).toString().padStart(2, '0');
        const secs = (s.time % 60).toFixed(2).padStart(5, '0');
        const durTag = typeof s.duration === 'number' && s.duration > 0 ? ` [${s.duration.toFixed(2)}s]` : '';
        const muteTag = s.cueEnabled === false ? ' [MUTE]' : '';
        text += `${mins}:${secs} ${s.section || s.name}${durTag}${muteTag}\n`;
      });
    }
    text += '\n# ACORDES\n';
    if (data?.chords) {
      data.chords.forEach((c: any) => {
        const mins = Math.floor(c.time / 60).toString().padStart(2, '0');
        const secs = (c.time % 60).toFixed(2).padStart(5, '0');
        text += `${mins}:${secs} ${c.chord}\n`;
      });
    }
    return text;
  };

  const parsePrompterText = (text: string) => {
    const lines = text.split('\n');
    const result = { chords: [] as any[], sections: [] as any[] };
    let currentBlock = '';

    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('#')) {
        currentBlock = t.toUpperCase().includes('ACORD') ? 'chords' : 'sections';
        continue;
      }
      
      const match = t.match(/^(\d{2}):(\d{2}(?:\.\d+)?)\s+(.+)$/);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseFloat(match[2]);
        const time = minutes * 60 + seconds;
        let content = match[3].trim();

        if (currentBlock === 'chords') {
          result.chords.push({ time, chord: content });
        } else {
          let cueEnabled = true;
          if (/\[MUTE\]/i.test(content)) {
            cueEnabled = false;
            content = content.replace(/\[MUTE\]/ig, '').trim();
          }
          let duration: number | undefined = undefined;
          const durMatch = content.match(/\[(\d+(?:\.\d+)?)s\]/i);
          if (durMatch) {
            duration = parseFloat(durMatch[1]);
            content = content.replace(durMatch[0], '').trim();
          }
          result.sections.push({
            time,
            name: content,
            ...(duration !== undefined ? { duration } : {}),
            ...(cueEnabled === false ? { cueEnabled: false } : {})
          });
        }
      }
    }
    return result;
  };

  const handleSavePrompter = async () => {
    if (!selectedSongId) return;
    const parsedData = parsePrompterText(prompterText);
    const newData = { ...prompterData, chords: parsedData.chords, sections: parsedData.sections };
    setPrompterData(newData);
    setIsEditingPrompter(false);
    setHasUnsavedSections(false);
    
    await persistPrompterDataSafe(selectedSongId, newData);
    setSaveToastMsg('¡Texto de Acordes y Secciones guardado!');
    setTimeout(() => setSaveToastMsg(null), 3000);
  };

  // ==========================================
  // LÓGICA CAPCUT DE SECCIONES Y VOZ GUÍA (CON HISTORIAL UNDO/REDO)
  // ==========================================
  const handleUpdateSections = useCallback((nextSections: SectionEvent[], recordUndo = true) => {
    setPrompterData((prev: any) => {
      if (recordUndo) {
        const currentCopy = (prev.sections || []).map((s: any) => ({ ...s }));
        setSectionsHistoryPast((h) => [...h.slice(-39), currentCopy]);
        setSectionsHistoryFuture([]);
      }
      return { ...prev, sections: nextSections };
    });
    setHasUnsavedSections(true);
  }, []);

  const handleUndoSections = useCallback(() => {
    setSectionsHistoryPast((past) => {
      if (past.length === 0) return past;
      const previous = past[past.length - 1];
      setPrompterData((prev: any) => {
        const currentCopy = (prev.sections || []).map((s: any) => ({ ...s }));
        setSectionsHistoryFuture((f) => [currentCopy, ...f.slice(0, 39)]);
        return { ...prev, sections: previous };
      });
      setHasUnsavedSections(true);
      return past.slice(0, -1);
    });
  }, []);

  const handleRedoSections = useCallback(() => {
    setSectionsHistoryFuture((future) => {
      if (future.length === 0) return future;
      const next = future[0];
      setPrompterData((prev: any) => {
        const currentCopy = (prev.sections || []).map((s: any) => ({ ...s }));
        setSectionsHistoryPast((p) => [...p.slice(-39), currentCopy]);
        return { ...prev, sections: next };
      });
      setHasUnsavedSections(true);
      return future.slice(1);
    });
  }, []);

  // Atajos de teclado en vivo (Espacio = Play/Pause, I/V/P/C/B/S/F = Insertar Sección CapCut al Playhead, Ctrl+S = Guardar)
  useEffect(() => {
    if (!selectedSongId || isEditingPrompter) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        savePrompterData();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        isPlaying ? pause() : play();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const keyMap: Record<string, string> = {
        'i': 'INTRO',
        'v': 'VERSO',
        'p': 'PRE-CORO',
        'c': 'CORO',
        'b': 'PUENTE',
        's': 'SOLO',
        'f': 'FINAL'
      };
      
      // En modo CapCut, 's' sin selección o cuando se está en modo Live Tapping inserta SOLO
      // (Prompter maneja 's' para Dividir cuando hay un bloque seleccionado con stopPropagation)
      const sectionName = keyMap[e.key.toLowerCase()];
      if (sectionName) {
        let exactTime = Math.max(0, currentTimeRef.current);
        
        if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
          let closest = prompterData.beatTimes[0] + manualGridOffset;
          let minDiff = Math.abs(closest - exactTime);
          for (let i = 1; i < prompterData.beatTimes.length; i++) {
            const candidate = prompterData.beatTimes[i] + manualGridOffset;
            const diff = Math.abs(candidate - exactTime);
            if (diff < minDiff) {
              minDiff = diff;
              closest = candidate;
            }
          }
          if (minDiff < 0.45) {
            exactTime = Math.max(0, closest);
          }
        } else if ((prompterData.bpm || 0) > 0) {
          const beatDur = 60 / (prompterData.bpm || 120);
          const anchor = (prompterData.firstBeatOffset || 0) + manualGridOffset;
          const nearestBeat = anchor + Math.round((exactTime - anchor) / beatDur) * beatDur;
          if (Math.abs(nearestBeat - exactTime) < 0.35) {
            exactTime = Math.max(0, nearestBeat);
          }
        }
        exactTime = Number(exactTime.toFixed(3));

        const beatDur = (prompterData.bpm || 0) > 0 ? 60 / (prompterData.bpm || 120) : 0.5;
        const beatsPerBar = parseInt((prompterData.timeSignature || '4/4').split('/')[0], 10) || 4;
        const defaultBarDur = beatDur * beatsPerBar * 4; // 4 compases por defecto

        setPrompterData((prev: any) => {
          const currentSections = [...(prev.sections || [])];
          setSectionsHistoryPast((h) => [...h.slice(-39), currentSections.map((s: any) => ({ ...s }))]);
          setSectionsHistoryFuture([]);

          const filtered = currentSections.filter((s: any) => Math.abs(s.time - exactTime) > 0.25);
          const nextSec = filtered.find((s: any) => s.time > exactTime + 0.25);
          const duration = nextSec
            ? Number(Math.max(beatDur, Math.min(defaultBarDur, nextSec.time - exactTime)).toFixed(3))
            : Number(defaultBarDur.toFixed(3));

          filtered.push({
            id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: sectionName,
            section: sectionName,
            time: exactTime,
            duration,
            cueEnabled: true,
          });
          filtered.sort((a: any, b: any) => a.time - b.time);
          return { ...prev, sections: filtered };
        });
        setHasUnsavedSections(true);
        if (!isPlaying) {
          previewVoiceCue(sectionName);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSongId, isEditingPrompter, isPlaying, prompterData.beatTimes, prompterData.bpm, prompterData.firstBeatOffset, prompterData.timeSignature, manualGridOffset, previewVoiceCue]);

  const savePrompterData = async () => {
    if (!selectedSongId) return;
    try {
      const merged = await persistPrompterDataSafe(selectedSongId, prompterData);
      syncPrompterData(merged);
      setHasUnsavedSections(false);
      setIsEditingSections(false);

      const channel = new BroadcastChannel('tandu_stage_sync');
      channel.postMessage({
        type: 'PROMPTER_UPDATED',
        songId: selectedSongId,
        prompterData: merged
      });
      channel.close();

      setSaveToastMsg('¡Voz Guía y Secciones sincronizadas!');
      setTimeout(() => setSaveToastMsg(null), 3200);
    } catch (e: any) {
      console.error(e);
      alert('Error guardando: ' + e.message);
    }
  };

  const handleExportLiveMix = async () => {
    if (!selectedSongId) return;
    if (confirm('¿Exportar el Mix En Vivo con la distribución espacial estéreo actual?\n\n• Salida Público (FOH): Stems de instrumentos con balance y paneo estéreo real (L / C / R)\n• Salida Músicos (CUE): Metrónomo y Voz Guía balanceados (Centro o paneo configurado)\n• In-Ears de Práctica: Mezcla estéreo saludable para proteger los oídos de los músicos')) {
      setIsExporting(true);
      try {
        const clickStem = stems.find(s => s.id === 'synthetic-click');
        const cueStem = stems.find(s => s.id === 'synthetic-cues');
        const updatedPrompterData = {
          ...prompterData,
          mixConfig: {
            click: clickStem ? { volume: clickStem.volume, pan: clickStem.pan, muted: clickStem.muted } : undefined,
            cues: cueStem ? { volume: cueStem.volume, pan: cueStem.pan, muted: cueStem.muted } : undefined,
          }
        };
        const merged = await persistPrompterDataSafe(selectedSongId, updatedPrompterData);
        await exportLiveMix(selectedSongId, FAKE_BAND_ID, merged, setExportProgress);
        alert('¡Mix En Vivo (Público FOH Estéreo + Músicos CUE Balanceado) exportado y listo para el Setlist!');
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsExporting(false);
        setExportProgress('');
      }
    }
  };

  const handleExportMultitrackToZip = async () => {
    if (!selectedSongId) return;
    const song = songs.find(s => s.id === selectedSongId);
    const songName = song ? song.title : 'song';
    if (confirm('¿Estás seguro de que deseas exportar cada pista (stems, click, cues) en WAV separados dentro de un archivo ZIP? (Esto tomará unos minutos)')) {
      setIsExportingMultitrack(true);
      try {
        const merged = await persistPrompterDataSafe(selectedSongId, prompterData);
        await exportMultitrackToZip(songName, merged, setExportProgress);
        alert('¡Exportación Multitrack completada exitosamente!');
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsExportingMultitrack(false);
        setExportProgress('');
      }
    }
  };

  const handleExportFullMixMp3 = async () => {
    if (!selectedSongId) return;
    const song = songs.find(s => s.id === selectedSongId);
    const songName = song ? song.title : 'song';
    if (confirm('¿Deseas exportar la mezcla completa (todos los stems, click y cues) en formato MP3 (Alta Calidad 320kbps)?')) {
      setIsExportingMp3(true);
      try {
        const merged = await persistPrompterDataSafe(selectedSongId, prompterData);
        await exportFullMixToMp3(songName, merged, setExportProgress);
        alert('¡Exportación a MP3 completada exitosamente!');
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsExportingMp3(false);
        setExportProgress('');
      }
    }
  };

  return (
    <div className="h-screen bg-[#08090c] text-zinc-300 flex flex-col font-sans overflow-hidden select-none relative">
      
      {/* Error Alert */}
      {loadError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-950/90 backdrop-blur-xl border border-red-500/40 text-red-200 px-5 py-2.5 rounded-full shadow-[0_12px_30px_rgba(0,0,0,0.6)] flex items-center z-50 text-xs font-bold">
          <AlertCircle size={14} className="mr-2 text-red-400" />
          {loadError}
        </div>
      )}

      {/* HEADER / TRANSPORT (QClay + Musiko.io Sleek Studio Toolbar) */}
      <header className="h-16 bg-[#0d0f15]/95 backdrop-blur-xl border-b border-white/[0.06] flex items-center px-5 justify-between shrink-0 z-20 gap-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
        
        {/* Left: Branding & Song Loader */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-9 h-9 bg-gradient-to-br from-[#ef4444]/20 to-black text-[#ef4444] rounded-xl border border-[#ef4444]/30 shrink-0 shadow-[0_0_16px_rgba(239,68,68,0.18)]">
             <Disc3 size={17} />
          </div>
          <select 
            className="bg-[#08090c] border border-white/[0.08] text-white font-bold px-3.5 py-2 rounded-xl text-xs outline-none focus:border-[#ef4444]/50 w-[220px] shadow-[inset_0_2px_6px_rgba(0,0,0,0.65)] transition-colors"
            value={selectedSongId || ''}
            onChange={(e) => setSelectedSongId(e.target.value)}
          >
            <option value="">Seleccionar Canción...</option>
            {songs.map(song => (
              <option key={song.id} value={song.id}>{song.title}</option>
            ))}
          </select>
          {selectedSongId && !audioLoaded && (
            <button
              onClick={handleLoadAudio}
              className="bg-emerald-500 hover:bg-emerald-400 text-black px-3.5 py-2 rounded-full text-[10.5px] font-semibold uppercase tracking-wider transition-all whitespace-nowrap shadow-[0_0_20px_rgba(16,185,129,0.35)]"
            >
              ⚡ Cargar Stems a RAM
            </button>
          )}
        </div>

        {/* Center: Tactile Transport Pod & LED Time Readout */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#08090c] p-1.5 rounded-full border border-white/[0.07] shadow-[inset_0_2px_6px_rgba(0,0,0,0.75)]">
            <button 
              onClick={() => { pause(); seekTo(-(preRollDuration || 0)); }} 
              className="stage-tactile-btn w-8 h-8 flex items-center justify-center rounded-full text-zinc-400 hover:text-white"
              title="Reiniciar al Conteo Pre-Roll"
            >
              <Square fill="currentColor" size={11} />
            </button>
            <button 
              onClick={isPlaying ? pause : play} 
              disabled={!audioLoaded || loadError !== null}
              className={`w-11 h-8 flex items-center justify-center rounded-full transition-all disabled:opacity-40 ${
                isPlaying
                  ? 'bg-gradient-to-br from-[#ef4444] to-[#dc2626] text-white shadow-[0_0_18px_rgba(239,68,68,0.6)] border border-red-400/40'
                  : 'stage-tactile-btn text-zinc-200 hover:text-white'
              }`}
              title={isPlaying ? "Pausar" : "Reproducir"}
            >
              {isPlaying ? <Pause fill="currentColor" size={14} /> : <Play fill="currentColor" size={14} className="ml-0.5" />}
            </button>
          </div>

          <div className="bg-[#08090c] border border-white/[0.08] px-4 py-1.5 rounded-full flex items-center justify-center min-w-[112px] shadow-[inset_0_2px_6px_rgba(0,0,0,0.75)]">
            <span className="text-sm font-mono font-medium text-white tracking-tight tabular-nums">
              {formatTime(currentTime)}
            </span>
          </div>
        </div>

        {/* Right: AI Chords, Transposer, Tempo & Nudge */}
        <div className="flex items-center gap-2 justify-end">
          <div className="flex items-center gap-1 bg-[#08090c] rounded-full border border-white/[0.07] p-1 shadow-[inset_0_2px_6px_rgba(0,0,0,0.75)]">
            <button 
              onClick={handleDetectChordsAI}
              disabled={isDetectingChords || !selectedSongId}
              className="hover:bg-purple-500/25 bg-purple-500/15 text-purple-300 border border-purple-500/35 px-3 py-1 rounded-full text-[10.5px] font-medium uppercase tracking-wide transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-[0_0_12px_rgba(168,85,247,0.18)]"
              title="Detectar Acordes automáticamente desde la pista ★ Master"
            >
              <Activity size={11} className={isDetectingChords ? "animate-pulse" : ""} />
              {isDetectingChords ? 'Analizando...' : 'Acordes IA'}
            </button>
            <div className="w-px h-3.5 bg-white/[0.08] mx-0.5"></div>
            <span className="text-[9px] text-zinc-500 font-bold uppercase px-1">Tono:</span>
            <button
              onClick={() => handleTransposeAllChords(-1)}
              className="px-2 py-0.5 text-[10px] stage-tactile-btn text-zinc-300 hover:text-white rounded-full font-bold"
              title="Bajar todos los acordes 1 semitono"
            >
              -1
            </button>
            <button
              onClick={() => handleTransposeAllChords(1)}
              className="px-2 py-0.5 text-[10px] stage-tactile-btn text-zinc-300 hover:text-white rounded-full font-bold"
              title="Subir todos los acordes 1 semitono"
            >
              +1
            </button>
            <div className="w-px h-3.5 bg-white/[0.08] mx-0.5"></div>
            <button onClick={handleHalveTempo} className="px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-white font-bold transition-colors" title="Mitad de Tempo">÷2</button>
            <button onClick={handleDoubleTempo} className="px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-white font-bold transition-colors" title="Doble de Tempo">x2</button>
            <button onClick={handleClearBeatGrid} className="hover:bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-colors" title="Usar grilla matemática rígida">Fijar</button>
          </div>

          <div className="flex items-center gap-1.5 bg-[#08090c] rounded-full border border-white/[0.07] py-1 px-2.5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.75)]">
            <span className="text-[9px] text-zinc-500 font-bold uppercase">Nudge</span>
            <button onClick={() => handleNudge(-0.01)} className="text-zinc-400 hover:text-white text-xs px-1 font-bold">-</button>
            <span className="text-[10px] text-zinc-200 font-mono w-6 text-center tabular-nums">{(manualGridOffset * 1000).toFixed(0)}</span>
            <button onClick={() => handleNudge(0.01)} className="text-zinc-400 hover:text-white text-xs px-1 font-bold">+</button>
          </div>

          {selectedSongId && (
            <button
              onClick={() => navigate('/lyrics')}
              className="px-3 py-1.5 rounded-full stage-tactile-btn text-zinc-200 hover:text-white text-[10.5px] font-medium uppercase tracking-wide flex items-center gap-1.5 transition-all"
              title="Ir a Lyric Studio para sincronizar la letra de esta canción"
            >
              <span>Lyrics</span>
              <ArrowRight size={11} className="text-[#ef4444]" />
            </button>
          )}
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Progress Overlays */}
        {isDownloading && (
          <div className="absolute inset-0 bg-[#08090c]/90 z-40 flex flex-col items-center justify-center backdrop-blur-md">
            <Loader2 size={34} className="animate-spin text-emerald-500 mb-4" />
            <h2 className="text-sm font-black text-white tracking-widest uppercase mb-1">Cargando Stems en Memoria RAM</h2>
            <p className="text-xs text-zinc-400 mb-6 font-mono">{loadProgress.currentFile}</p>
            <div className="w-64 bg-[#11131a] border border-white/[0.06] rounded-full h-2 overflow-hidden">
              <div className="bg-emerald-500 h-full transition-all duration-300 shadow-[0_0_12px_rgba(16,185,129,0.6)]" style={{ width: `${(loadProgress.loaded / Math.max(1, loadProgress.total)) * 100}%` }}></div>
            </div>
          </div>
        )}

        {chordDetectionMsg && (
          <div className="absolute inset-0 bg-[#08090c]/90 z-40 flex flex-col items-center justify-center backdrop-blur-md">
            <Sparkles size={34} className="animate-pulse text-purple-400 mb-4" />
            <h2 className="text-sm font-black text-purple-300 tracking-widest uppercase mb-1">Análisis Armónico IA</h2>
            <p className="text-xs text-zinc-400 mb-6 font-mono">{chordDetectionMsg}</p>
            <div className="w-64 bg-[#11131a] border border-white/[0.06] rounded-full h-2 overflow-hidden">
              <div className="bg-purple-500 h-full w-full animate-pulse"></div>
            </div>
          </div>
        )}

        {/* MIXER SIDEBAR (Apple Design Collapsible Soft Surface Console) */}
        <aside
          className={`apple-console-font shrink-0 flex flex-col bg-[#F5F6F8] border-r border-slate-200/85 z-20 select-none transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] shadow-[4px_0_24px_rgba(15,23,42,0.04)] ${
            isConsoleCollapsed ? 'w-[76px]' : 'w-[368px] xl:w-[396px]'
          }`}
        >
          {/* Console Header (Sin truncamiento de título) */}
          <div className="h-12 border-b border-slate-200/80 flex items-center justify-between px-3 bg-white/90 backdrop-blur-md shrink-0 gap-2">
            {isConsoleCollapsed ? (
              <button
                type="button"
                onClick={() => setIsConsoleCollapsed(false)}
                className="w-9 h-9 mx-auto rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200/80 text-slate-700 flex items-center justify-center transition-all cursor-pointer"
                title="Desplegar Consola de Pistas"
              >
                <PanelLeftOpen size={16} />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200/80 flex items-center justify-center text-slate-700 shrink-0">
                    <Sliders size={13.5} />
                  </div>
                  <span className="text-[13px] font-semibold tracking-[-0.018em] text-slate-800 whitespace-nowrap">
                    Pistas
                  </span>
                  <span className="text-[11px] text-slate-500 font-semibold bg-slate-100 border border-slate-200/80 px-2 py-0.5 rounded-full tabular-nums shrink-0">
                    {stems.length}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {stems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsCompactChannels((prev) => !prev)}
                      className={`h-7 px-2.5 rounded-lg text-[11px] font-medium flex items-center gap-1 border transition-all cursor-pointer whitespace-nowrap ${
                        isCompactChannels
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-slate-100/90 hover:bg-slate-200/75 text-slate-600 border-slate-200/80'
                      }`}
                      title={isCompactChannels ? 'Mostrar faders completos' : 'Vista compacta de pistas'}
                    >
                      {isCompactChannels ? <Maximize2 size={11.5} /> : <Minimize2 size={11.5} />}
                      <span>{isCompactChannels ? 'Expandir' : 'Compactar'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setEditingTrackPopoverId(null);
                      setIsConsoleCollapsed(true);
                    }}
                    className="h-7 px-2.5 rounded-lg bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200/80 text-slate-600 hover:text-slate-900 flex items-center gap-1 text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap"
                    title="Plegar Consola de Pistas para ampliar el Studio Prompter"
                  >
                    <PanelLeftClose size={13} />
                    <span>Plegar</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Helper para resolver presentación limpia de cada pista */}
          {(() => {
            const allStemNames = stems.map((item) => item.name);

            const resolveTrackInfo = (stem: StemTrack) => {
              const dbMatch = dbStems.find((d: any) => d.id === stem.id);
              const isMasterRef = Boolean(dbMatch?.metadata?.is_master);
              const syntheticMeta =
                stem.id === 'synthetic-click'
                  ? prompterData.mixConfig?.click
                  : stem.id === 'synthetic-cues'
                  ? prompterData.mixConfig?.cues
                  : undefined;

              const savedIcon = (dbMatch?.metadata?.instrument_icon || syntheticMeta?.instrument_icon) as
                | InstrumentCategory
                | undefined;
              const savedAlias = (dbMatch?.metadata?.display_name || syntheticMeta?.display_name || '').trim();

              const autoCategory = detectInstrumentCategory(stem.name, stem.type, isMasterRef);
              const category: InstrumentCategory = savedIcon || autoCategory;
              const preset = getInstrumentPreset(category);
              const autoCleanName = extractCleanTrackLabel(stem.name, allStemNames);
              const displayName = savedAlias || autoCleanName;

              return {
                isMasterRef,
                savedIcon,
                savedAlias,
                autoCategory,
                category,
                preset,
                autoCleanName,
                displayName,
              };
            };

            if (isConsoleCollapsed) {
              return (
                <div className="flex-1 overflow-y-auto py-3 px-2 flex flex-col items-center gap-2.5 custom-scrollbar">
                  {stems.map((stem, sIdx) => {
                    const info = resolveTrackInfo(stem);
                    return (
                      <button
                        key={stem.id}
                        type="button"
                        onClick={() => setIsConsoleCollapsed(false)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          toggleMute(stem.id);
                        }}
                        className={`w-14 h-14 rounded-2xl border flex items-center justify-center relative transition-all cursor-pointer ${info.preset.badgeBg} ${info.preset.badgeText} ${info.preset.badgeBorder} hover:scale-[1.03] hover:brightness-95 shadow-2xs ${
                          stem.muted ? 'opacity-40 grayscale' : ''
                        } ${stem.solo ? 'ring-2 ring-amber-400' : ''}`}
                        title={`${String(sIdx + 1).padStart(2, '0')} · ${info.displayName} (${info.preset.label}) • Vol ${Math.round(stem.volume * 100)}%\nClic para desplegar · Clic derecho para Mute`}
                      >
                        <InstrumentSvgIcon category={info.category} size={28} />
                        <span className="absolute top-1 left-1.5 text-[9px] font-semibold tabular-nums leading-none opacity-65">
                          {String(sIdx + 1).padStart(2, '0')}
                        </span>
                        {stem.muted && (
                          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-rose-500 border-2 border-[#F5F6F8]" />
                        )}
                        {stem.solo && !stem.muted && (
                          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border-2 border-[#F5F6F8]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            }

            return (
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
                {stems.length === 0 ? (
                  <div className="text-slate-500 text-[12.5px] font-medium p-8 text-center rounded-2xl border border-dashed border-slate-300/80 bg-white/80">
                    No hay canales de audio cargados para esta canción.
                  </div>
                ) : (
                  stems.map((stem, sIdx) => {
                    const info = resolveTrackInfo(stem);
                    const panDisplay =
                      stem.pan === 0
                        ? 'C'
                        : stem.pan < 0
                        ? `L${Math.abs(Math.round(stem.pan * 100))}`
                        : `R${Math.round(stem.pan * 100)}`;

                    const isClick = info.category === 'click' || stem.type === 'Click';
                    const isCue = info.category === 'cue' || stem.type === 'Cues';
                    const routeLabel = info.isMasterRef
                      ? `Master · ${panDisplay}`
                      : isClick
                      ? `Cue Clic · ${panDisplay}`
                      : isCue
                      ? `Cue Guía · ${panDisplay}`
                      : `FOH · ${panDisplay}`;

                    const isTrackFolded = isCompactChannels || Boolean(collapsedTrackIds[stem.id]);
                    const isPopoverOpen = editingTrackPopoverId === stem.id;
                    const volPercent = Math.round(stem.volume * 100);
                    const panPercent = ((stem.pan + 1) / 2) * 100; // 0..100, center=50
                    const panFillStart = Math.min(50, panPercent);
                    const panFillEnd = Math.max(50, panPercent);
                    const panColor =
                      Math.abs(stem.pan) < 0.05 ? '#94a3b8' : stem.pan < 0 ? '#f59e0b' : '#10b981';

                    return (
                      <div
                        key={stem.id}
                        className={`w-full rounded-2xl bg-white p-3 flex flex-col transition-all duration-200 relative select-none border border-slate-200/80 shadow-[0_1px_4px_rgba(15,23,42,0.03)] hover:border-slate-300/90 hover:shadow-[0_4px_14px_rgba(15,23,42,0.05)] ${
                          stem.muted ? 'opacity-60' : 'opacity-100'
                        } ${stem.solo ? 'ring-2 ring-amber-400/90 border-amber-300' : ''}`}
                      >
                        {/* Cabecera Apple de 2 zonas: [Icono Grande Configurable + Nombre Limpio + Metadata] | [M] [S] [⌄] */}
                        <div className="flex items-center justify-between gap-2.5">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Botón de Icono Instrumental Grande */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isPopoverOpen) {
                                  setEditingTrackPopoverId(null);
                                } else {
                                  setTrackAliasDraft(info.savedAlias);
                                  setEditingTrackPopoverId(stem.id);
                                }
                              }}
                              className={`${
                                isTrackFolded ? 'w-[44px] h-[44px] rounded-xl' : 'w-[50px] h-[50px] rounded-2xl'
                              } border flex items-center justify-center shrink-0 transition-all cursor-pointer relative group ${info.preset.badgeBg} ${info.preset.badgeText} ${info.preset.badgeBorder} hover:scale-[1.04] active:scale-[0.97] shadow-2xs`}
                              title={`Icono: ${info.preset.label} (Clic para cambiar icono o etiqueta)`}
                            >
                              <InstrumentSvgIcon category={info.category} size={isTrackFolded ? 27 : 32} />
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                                  info.savedIcon ? 'bg-slate-700' : 'bg-slate-300 group-hover:bg-slate-500'
                                }`}
                              />
                            </button>

                            {/* Jerarquía de 2 Líneas: Nombre Limpio + Canal/Instrumento/Ruta */}
                            <div
                              className="min-w-0 flex-1 cursor-pointer"
                              onClick={() =>
                                setCollapsedTrackIds((prev) => ({
                                  ...prev,
                                  [stem.id]: !isTrackFolded,
                                }))
                              }
                              title={`${stem.name}\nClic para plegar o desplegar controles`}
                            >
                              <h3 className="text-slate-900 text-[13.5px] font-semibold tracking-[-0.016em] leading-tight truncate">
                                {info.displayName}
                              </h3>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400 font-medium truncate">
                                <span className="tabular-nums text-slate-500">
                                  {String(sIdx + 1).padStart(2, '0')}
                                </span>
                                <span>&middot;</span>
                                <span className={`${info.preset.badgeText} font-medium`}>
                                  {info.preset.shortLabel}
                                </span>
                                <span>&middot;</span>
                                <span className="truncate">{routeLabel}</span>
                              </div>
                            </div>
                          </div>

                          {/* Controles Derecha: [M] [S] [⌄] */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => toggleMute(stem.id)}
                              className={`w-6.5 h-6.5 rounded-lg flex items-center justify-center text-[10.5px] font-semibold transition-all cursor-pointer border ${
                                stem.muted
                                  ? 'bg-rose-500 text-white border-rose-500 shadow-[0_1px_4px_rgba(244,63,94,0.3)]'
                                  : 'bg-slate-100/90 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 border-slate-200/75'
                              }`}
                              title={stem.muted ? 'Canal Silenciado' : 'Silenciar Canal (Mute)'}
                            >
                              M
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleSolo(stem.id)}
                              className={`w-6.5 h-6.5 rounded-lg flex items-center justify-center text-[10.5px] font-semibold transition-all cursor-pointer border ${
                                stem.solo
                                  ? 'bg-amber-400 text-slate-950 border-amber-400 font-bold shadow-[0_1px_4px_rgba(245,158,11,0.3)]'
                                  : 'bg-slate-100/90 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 border-slate-200/75'
                              }`}
                              title="Escuchar en Solo"
                            >
                              S
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedTrackIds((prev) => ({
                                  ...prev,
                                  [stem.id]: !isTrackFolded,
                                }))
                              }
                              className="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
                              title={isTrackFolded ? 'Mostrar faders de canal' : 'Ocultar faders de canal'}
                            >
                              {isTrackFolded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                            </button>
                          </div>
                        </div>

                        {/* Popover Apple para Elegir Icono Instrumental + Alias */}
                        {isPopoverOpen && (
                          <div
                            className="mt-2.5 p-3 rounded-xl bg-[#F8FAFC] border border-slate-200/90 shadow-[0_8px_24px_rgba(15,23,42,0.08)] flex flex-col gap-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-slate-700 tracking-tight">
                                Icono de pista
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleUpdateTrackMeta(stem.id, { instrument_icon: null });
                                  }}
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
                                    !info.savedIcon
                                      ? 'bg-slate-800 text-white border-slate-800'
                                      : 'bg-white text-slate-600 hover:bg-slate-100 border-slate-200'
                                  }`}
                                  title="Volver a detección automática según el nombre"
                                >
                                  <RotateCcw size={10} />
                                  Auto
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingTrackPopoverId(null)}
                                  className="w-5 h-5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center cursor-pointer"
                                  title="Cerrar"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>

                            {/* Grid Visual de Instrumentos con Iconos Grandes */}
                            <div className="grid grid-cols-3 gap-1.5">
                              {SELECTABLE_INSTRUMENT_PRESETS.map((presetOpt) => {
                                const isActive = info.category === presetOpt.id;
                                return (
                                  <button
                                    key={presetOpt.id}
                                    type="button"
                                    disabled={isSavingTrackMeta}
                                    onClick={() =>
                                      handleUpdateTrackMeta(stem.id, { instrument_icon: presetOpt.id })
                                    }
                                    className={`px-1.5 py-2 rounded-xl border text-center flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                      isActive
                                        ? `${presetOpt.badgeBg} ${presetOpt.badgeText} ${presetOpt.badgeBorder} ring-1 ring-slate-300 font-semibold shadow-2xs`
                                        : 'bg-white hover:bg-slate-100/80 text-slate-700 border-slate-200/75 font-medium'
                                    }`}
                                  >
                                    <InstrumentSvgIcon category={presetOpt.id} size={23} className="shrink-0" />
                                    <span className="text-[10px] leading-tight truncate w-full">{presetOpt.label}</span>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Alias corto opcional */}
                            <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200/70">
                              <input
                                type="text"
                                value={trackAliasDraft}
                                onChange={(e) => setTrackAliasDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleUpdateTrackMeta(stem.id, { display_name: trackAliasDraft });
                                    setEditingTrackPopoverId(null);
                                  } else if (e.key === 'Escape') {
                                    setEditingTrackPopoverId(null);
                                  }
                                }}
                                placeholder={`Nombre corto (${info.autoCleanName})`}
                                className="flex-1 min-w-0 bg-white border border-slate-200/90 rounded-lg px-2 py-1 text-[11px] text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  handleUpdateTrackMeta(stem.id, { display_name: trackAliasDraft });
                                  setEditingTrackPopoverId(null);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[10.5px] font-medium transition-colors cursor-pointer shrink-0"
                              >
                                Aplicar
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Controles Desplegables (Volumen + Paneo Bipolar Apple) */}
                        {!isTrackFolded && (
                          <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-col gap-2">
                            {/* Fila Volumen */}
                            <div className="flex items-center gap-2.5">
                              <div className="w-14 shrink-0 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-slate-400">Vol</span>
                                <span className="font-semibold text-slate-700 tabular-nums">{volPercent}%</span>
                              </div>
                              <div className="flex-1 flex items-center">
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.01"
                                  value={stem.volume}
                                  onChange={(e) => handleVolumeChange(stem.id, parseFloat(e.target.value))}
                                  className="apple-studio-slider cursor-pointer"
                                  style={{
                                    background: `linear-gradient(to right, ${info.preset.accentColor} 0%, ${info.preset.accentColor} ${volPercent}%, #e2e8f0 ${volPercent}%, #e2e8f0 100%)`,
                                  }}
                                />
                              </div>
                            </div>

                            {/* Fila Paneo Bipolar (Referencia Central + Segmented Pill L | C | R) */}
                            <div className="flex items-center gap-2.5">
                              <div className="w-14 shrink-0 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-slate-400">Pan</span>
                                <span
                                  className={`font-semibold tabular-nums text-[10.5px] ${
                                    Math.abs(stem.pan) < 0.05
                                      ? 'text-slate-500'
                                      : stem.pan < 0
                                      ? 'text-amber-600'
                                      : 'text-emerald-600'
                                  }`}
                                >
                                  {panDisplay}
                                </span>
                              </div>

                              <div className="flex-1 flex items-center gap-2">
                                <div className="relative flex-1 flex items-center">
                                  {/* Marca sutil de centro (0) */}
                                  <span className="absolute left-1/2 -translate-x-1/2 w-[1.5px] h-2.5 bg-slate-300/90 rounded-full pointer-events-none" />
                                  <input
                                    type="range"
                                    min="-1"
                                    max="1"
                                    step="0.01"
                                    value={stem.pan}
                                    onChange={(e) => handlePanChange(stem.id, parseFloat(e.target.value))}
                                    className="apple-studio-slider cursor-pointer relative z-10"
                                    style={{
                                      background: `linear-gradient(to right, #e2e8f0 0%, #e2e8f0 ${panFillStart}%, ${panColor} ${panFillStart}%, ${panColor} ${panFillEnd}%, #e2e8f0 ${panFillEnd}%, #e2e8f0 100%)`,
                                    }}
                                  />
                                </div>

                                {/* Segmented Pill Apple L | C | R */}
                                <div className="flex items-center bg-slate-100/90 p-0.5 rounded-lg border border-slate-200/70 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handlePanChange(stem.id, -1)}
                                    className={`px-1.5 py-0.5 rounded-[5px] text-[9.5px] font-semibold transition-all cursor-pointer ${
                                      stem.pan <= -0.95
                                        ? 'bg-white text-amber-600 shadow-2xs'
                                        : 'text-slate-400 hover:text-slate-700'
                                    }`}
                                    title="Pan Izquierda (L 100%)"
                                  >
                                    L
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handlePanChange(stem.id, 0)}
                                    className={`px-1.5 py-0.5 rounded-[5px] text-[9.5px] font-semibold transition-all cursor-pointer ${
                                      Math.abs(stem.pan) < 0.05
                                        ? 'bg-white text-slate-800 shadow-2xs'
                                        : 'text-slate-400 hover:text-slate-700'
                                    }`}
                                    title="Centrar Audio (C 0% - Balanceado para In-Ears)"
                                  >
                                    C
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handlePanChange(stem.id, 1)}
                                    className={`px-1.5 py-0.5 rounded-[5px] text-[9.5px] font-semibold transition-all cursor-pointer ${
                                      stem.pan >= 0.95
                                        ? 'bg-white text-emerald-600 shadow-2xs'
                                        : 'text-slate-400 hover:text-slate-700'
                                    }`}
                                    title="Pan Derecha (R 100%)"
                                  >
                                    R
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })()}
        </aside>

        {/* PROMPTER VISUAL AREA */}
        <div className="flex-1 bg-[#08090c] flex flex-col relative overflow-hidden">
          {/* Prompter Header Toolbar */}
          <div className="h-12 border-b border-white/[0.06] flex items-center justify-between px-4 bg-[#0d1017]/90 backdrop-blur-md shrink-0">
             <div className="flex items-center gap-3">
               <div className="flex items-center gap-2">
                 <Mic size={14} className="text-[#ef4444]" />
                 <h2 className="text-[10px] font-black text-white uppercase tracking-[0.16em]">2. Studio Prompter &bull; Voz Guía y Exportación</h2>
               </div>
               
               <div className="w-px h-4 bg-white/[0.08] mx-1"></div>
               
               <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsEditingSections(!isEditingSections)}
                    className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                      isEditingSections
                        ? 'bg-[#ef4444]/20 text-red-300 border border-[#ef4444]/40 shadow-[0_0_12px_rgba(239,68,68,0.2)]'
                        : 'stage-tactile-btn text-zinc-300 hover:text-white'
                    }`}
                    title="El Timeline CapCut siempre está activo. Activa este modo para resaltar la grabación rápida con teclado (I, V, P, C, B, S, F)"
                  >
                    {isEditingSections ? 'Modo Tapping Activo' : '🎙️ Tapping Teclado'}
                    {isEditingSections && <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444] animate-pulse ml-1"></span>}
                  </button>
                  {(prompterData.sections?.length > 0) && (
                    <button
                      onClick={() => {
                        if (confirm('¿Borrar todas las secciones de Voz Guía? (Puedes deshacer con Ctrl+Z)')) {
                          handleUpdateSections([]);
                        }
                      }}
                      className="px-2 py-1 text-[9px] text-red-400 hover:text-red-300 uppercase tracking-widest font-bold"
                      title="Vaciar todos los bloques de sección"
                    >
                      Limpiar
                    </button>
                  )}
                  <button
                    onClick={savePrompterData}
                    disabled={!selectedSongId}
                    className={`px-3 py-1 text-[10px] rounded-full uppercase tracking-wider font-black transition-all flex items-center gap-1.5 ${
                      hasUnsavedSections
                        ? 'text-black bg-emerald-400 border border-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.5)] animate-pulse'
                        : 'text-emerald-300 bg-emerald-500/15 border border-emerald-500/35 hover:bg-emerald-500/25'
                    }`}
                    title="Guardar configuración de Voz Guía y Secciones en la nube (Ctrl+S)"
                  >
                    <Save size={11} />
                    {hasUnsavedSections ? 'Guardar Voz Guía *' : 'Guardar Voz Guía'}
                  </button>
                  
                  {!isEditingSections && (
                    isEditingPrompter ? (
                      <button onClick={handleSavePrompter} className="px-3 py-1 text-[10px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/35 rounded-full uppercase tracking-wider font-black hover:bg-emerald-500/25 flex items-center gap-1">
                        <Save size={11} /> Guardar Texto
                      </button>
                    ) : (
                      <button onClick={() => { setPrompterText(stringifyPrompterData(prompterData)); setIsEditingPrompter(true); }} disabled={!selectedSongId} className="px-3 py-1 text-[10px] stage-tactile-btn text-zinc-300 rounded-full uppercase tracking-wider font-bold hover:text-white flex items-center gap-1.5">
                        <Edit3 size={11} /> Editor Texto Acordes
                      </button>
                    )
                  )}

                  {saveToastMsg && (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                      <Check size={11} /> {saveToastMsg}
                    </span>
                  )}
               </div>
             </div>
             
             <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveMixConfig}
                  disabled={!selectedSongId}
                  className="px-3 py-1.5 stage-tactile-btn text-zinc-200 hover:text-white rounded-full text-[10px] font-bold uppercase tracking-wider transition-all"
                  title="Guardar volúmenes, paneos y mutes de todos los canales (incluye Metrónomo y Voz Guía)"
                >
                  Guardar Faders
                </button>

                {/* Botón Principal de Exportación para Show En Vivo */}
                <button
                  onClick={handleExportLiveMix}
                  disabled={isExporting || !audioLoaded}
                  className="px-4 py-1.5 bg-gradient-to-r from-[#ef4444] to-[#dc2626] hover:from-[#f87171] hover:to-[#ef4444] text-white rounded-full text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_24px_rgba(239,68,68,0.4)] border border-red-400/30 cursor-pointer"
                  title="Renderizar y subir la mezcla espacial optimizada (FOH en estéreo real + CUE balanceado para protección auditiva)"
                >
                  {isExporting ? (exportProgress || 'Exportando...') : '🚀 Exportar Mix En Vivo (FOH / CUE)'}
                </button>

                {/* Opciones secundarias de descarga local */}
                <div className="flex items-center gap-1 bg-[#08090c] p-1 rounded-full border border-white/[0.07]">
                  <button onClick={handleExportMultitrackToZip} disabled={isExportingMultitrack || !audioLoaded} className="px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors disabled:opacity-40">
                    {isExportingMultitrack ? (exportProgress || 'ZIP...') : 'ZIP'}
                  </button>
                  <div className="w-px h-3 bg-white/[0.08]"></div>
                  <button onClick={handleExportFullMixMp3} disabled={isExportingMp3 || !audioLoaded} className="px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors disabled:opacity-40">
                    {isExportingMp3 ? (exportProgress || 'MP3...') : 'MP3'}
                  </button>
                </div>
             </div>
          </div>
          
          {/* Playhead Timeline Scrubber */}
          <div className="h-6 bg-[#08090c] border-b border-white/[0.06] flex items-center px-4 relative group cursor-pointer z-20">
            <input 
              type="range" min={-(preRollDuration || 0)} max={totalDuration || 100} step="0.1" 
              value={isDraggingSlider ? localSliderTime : currentTime}
              onPointerDown={(e) => { setLocalSliderTime(parseFloat(e.currentTarget.value)); setIsDraggingSlider(true); }}
              onPointerUp={() => { setIsDraggingSlider(false); seekTo(localSliderTime); }}
              onChange={(e) => { const val = parseFloat(e.target.value); setLocalSliderTime(val); if (!isPlaying) seekTo(val); }}
              disabled={!audioLoaded}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-full h-1.5 bg-[#12151f] rounded-full relative pointer-events-none overflow-hidden">
              <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-[#ef4444] to-amber-500 rounded-full shadow-[0_0_12px_rgba(239,68,68,0.8)]" style={{ width: audioLoaded ? `${((currentTime + (preRollDuration || 0)) / Math.max(1, totalDuration + (preRollDuration || 0))) * 100}%` : '0%' }}></div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative">
            {isEditingPrompter ? (
              <div className="h-full flex flex-col p-5 bg-[#08090c]">
                <p className="text-xs text-zinc-400 mb-2 font-mono uppercase tracking-widest">Formato: <span className="text-amber-400">MM:SS Acorde o Sección</span></p>
                <textarea 
                  className="flex-1 bg-[#0d1017] border border-white/[0.08] rounded-2xl p-4 text-xs font-mono text-zinc-200 outline-none focus:border-[#ef4444]/50 resize-none leading-relaxed custom-scrollbar shadow-[inset_0_2px_10px_rgba(0,0,0,0.6)]"
                  value={prompterText}
                  onChange={(e) => setPrompterText(e.target.value)}
                  placeholder="# SECCIONES\n00:00 INTRO\n00:15 CORO\n\n# ACORDES\n00:05 Am\n00:10 C"
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="h-full relative flex flex-col justify-center">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#ef4444]/[0.05] via-[#08090c] to-[#08090c] pointer-events-none"></div>
                
                <Prompter 
                  currentTime={currentTime}
                  totalDuration={totalDuration}
                  bpm={prompterData.bpm || 0}
                  timeSignature={prompterData.timeSignature}
                  baseOffset={prompterData.firstBeatOffset}
                  beatTimes={prompterData.beatTimes}
                  chords={prompterData.chords || []}
                  sections={prompterData.sections || []}
                  lyrics={prompterData.lyrics || []}
                  waveformPeaks={waveformPeaks}
                  isVamping={isVamping}
                  onVampTrigger={handleVampTrigger}
                  isEditing={isEditingSections}
                  onRemoveSection={(index) => {
                     const next = [...(prompterData.sections || [])];
                     next.splice(index, 1);
                     handleUpdateSections(next);
                  }}
                  onUpdateSections={handleUpdateSections}
                  onPreviewVoiceCue={previewVoiceCue}
                  onSaveSections={savePrompterData}
                  hasUnsavedChanges={hasUnsavedSections}
                  canUndo={sectionsHistoryPast.length > 0}
                  canRedo={sectionsHistoryFuture.length > 0}
                  onUndo={handleUndoSections}
                  onRedo={handleRedoSections}
                  onEditChord={handleEditSingleChord}
                  onRemoveChord={handleRemoveSingleChord}
                  onSeek={(t) => seekTo(t)}
                  gridOffset={manualGridOffset}
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
