import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAudioEngine, StemTrack } from '../hooks/useAudioEngine';
import { Prompter } from '../components/Prompter';
import { Play, Pause, Square, Mic, Edit3, Save, AlertCircle, Music, Headphones, Activity, Sparkles, Loader2, Disc3, Star, ArrowRight } from 'lucide-react';
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
      setLoop(0, 0, false);
      pause(); // Stop any current playback
      
      // 1. Fetch Prompter Data
      const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
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

        // Insertar el Metrónomo IA Sintético
        engineStems.push({
          id: 'synthetic-click',
          name: 'Metrónomo IA',
          type: 'Click',
          url: '', // Se genera matemáticamente en RAM
          volume: 0.8,
          pan: 0,
          muted: false,
          solo: false,
          targetOutputChannel: 0
        });

        // Insertar las Guías IA Sintéticas (Voz Guía)
        engineStems.push({
          id: 'synthetic-cues',
          name: 'Voz Guía IA',
          type: 'Cues',
          url: '', // Se genera matemáticamente en RAM
          volume: 0.8,
          pan: 0,
          muted: false,
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
      
      const { data } = await supabase.from('stems').select('*').eq('song_id', selectedSongId).order('name');
      if (data) setDbStems(data);

      alert('¡Configuración de canales guardada exitosamente!');
    } catch (err: any) {
      alert(`Error al guardar configuración: ${err.message}`);
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
        text += `${mins}:${secs} ${s.section || s.name}\n`;
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
        const content = match[3].trim();

        if (currentBlock === 'chords') {
          result.chords.push({ time, chord: content });
        } else {
          result.sections.push({ time, name: content });
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
    
    await persistPrompterDataSafe(selectedSongId, newData);
  };

  // ==========================================
  // LÓGICA DE EDITOR DE SECCIONES (LIVE TAPPING)
  // ==========================================
  useEffect(() => {
    if (!isEditingSections) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        isPlaying ? pause() : play();
      }
      
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      const keyMap: Record<string, string> = {
        'i': 'INTRO',
        'v': 'VERSO',
        'p': 'PRE-CORO',
        'c': 'CORO',
        'b': 'PUENTE',
        's': 'SOLO',
        'f': 'FINAL'
      };
      
      const sectionName = keyMap[e.key.toLowerCase()];
      if (sectionName) {
        let exactTime = Math.max(0, currentTimeRef.current);
        
        if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
          let closest = prompterData.beatTimes[0];
          let minDiff = Math.abs(closest - exactTime);
          for (let i = 1; i < prompterData.beatTimes.length; i++) {
            const diff = Math.abs(prompterData.beatTimes[i] - exactTime);
            if (diff < minDiff) {
              minDiff = diff;
              closest = prompterData.beatTimes[i];
            }
          }
          if (minDiff < 0.5) {
            exactTime = closest;
          }
        }
        
        setPrompterData(prev => {
          const newSections = [...(prev.sections || [])];
          const filtered = newSections.filter(s => Math.abs(s.time - exactTime) > 0.3);
          filtered.push({ name: sectionName, time: exactTime });
          filtered.sort((a, b) => a.time - b.time);
          return { ...prev, sections: filtered };
        });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditingSections, prompterData.beatTimes]);

  const savePrompterData = async () => {
    if (!selectedSongId) return;
    try {
      const merged = await persistPrompterDataSafe(selectedSongId, prompterData);
      alert('¡Estructura y Voz Guía guardadas exitosamente!');
      setIsEditingSections(false);
      
      if (selectedSongId && dbStems.length > 0) {
         const baseOffset = merged.firstBeatOffset !== undefined 
            ? merged.firstBeatOffset 
            : (merged.chords && merged.chords.length > 0 ? merged.chords[0].time : 0);
         loadStems(merged.bpm || 120, baseOffset + manualGridOffset, merged.timeSignature, merged.beatTimes, merged);
      }
    } catch (e: any) {
      console.error(e);
      alert('Error guardando: ' + e.message);
    }
  };

  const handleExportLiveMix = async () => {
    if (!selectedSongId) return;
    if (confirm('¿Exportar el Mix En Vivo con los canales activos actuales?\n\n• Salida Público (FOH): Stems activos configurados\n• Salida Músicos (CUE): Metrónomo + Voz Guía\n• Versión Ligera MP3 para In-Ears de Práctica')) {
      setIsExporting(true);
      try {
        const merged = await persistPrompterDataSafe(selectedSongId, prompterData);
        await exportLiveMix(selectedSongId, FAKE_BAND_ID, merged, setExportProgress);
        alert('¡Mix En Vivo (Público FOH + Músicos CUE) exportado y listo para el Setlist!');
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
    <div className="h-screen bg-[#07090e] text-zinc-300 flex flex-col font-sans overflow-hidden select-none">
      
      {/* Error Alert */}
      {loadError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-950 border border-red-900 text-red-200 px-4 py-2 rounded-md shadow-2xl flex items-center z-50 text-xs font-medium">
          <AlertCircle size={14} className="mr-2 text-red-500" />
          {loadError}
        </div>
      )}

      {/* HEADER / TRANSPORT (Sleek TANDU /STAGE Toolbar) */}
      <header className="h-14 bg-[#0c0e14] border-b border-white/[0.07] flex items-center px-4 justify-between shrink-0 z-20 gap-3">
        
        {/* Left: Branding & Song Loader */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center justify-center w-7 h-7 bg-red-600/15 text-red-500 rounded-lg border border-red-500/30 shrink-0">
             <Disc3 size={15} />
          </div>
          <select 
            className="bg-[#07090e] border border-zinc-800 text-white font-bold px-2.5 py-1.5 rounded-lg text-xs outline-none focus:border-red-500/50 w-[210px]"
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
              className="bg-emerald-500 hover:bg-emerald-400 text-black px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-[0_0_15px_rgba(16,185,129,0.3)]"
            >
              ⚡ Cargar Stems a RAM
            </button>
          )}
        </div>

        {/* Center: Transport & Time */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[#07090e] p-1 rounded-lg border border-zinc-800/80">
            <button 
              onClick={() => { pause(); seekTo(-(preRollDuration || 0)); }} 
              className="bg-transparent hover:bg-zinc-800 w-8 h-7 flex items-center justify-center rounded transition-colors text-zinc-400 hover:text-white"
              title="Reiniciar al Conteo Pre-Roll"
            >
              <Square fill="currentColor" size={12} />
            </button>
            <button 
              onClick={isPlaying ? pause : play} 
              disabled={!audioLoaded || loadError !== null}
              className={`w-10 h-7 flex items-center justify-center rounded transition-colors disabled:opacity-40 ${
                isPlaying
                  ? 'bg-red-600 text-white shadow-[0_0_12px_rgba(239,68,68,0.6)]'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
              }`}
              title={isPlaying ? "Pausar" : "Reproducir"}
            >
              {isPlaying ? <Pause fill="currentColor" size={14} /> : <Play fill="currentColor" size={14} className="ml-0.5" />}
            </button>
          </div>

          <div className="bg-[#07090e] border border-zinc-800/80 px-3 py-1 rounded-lg flex items-center justify-center min-w-[105px]">
            <span className="text-sm font-mono font-black text-white tracking-wider">
              {formatTime(currentTime)}
            </span>
          </div>
        </div>

        {/* Right: AI Chords, Transposer, Tempo & Nudge */}
        <div className="flex items-center gap-2 justify-end">
          <div className="flex items-center gap-1 bg-[#07090e] rounded-lg border border-zinc-800/80 p-1">
            <button 
              onClick={handleDetectChordsAI}
              disabled={isDetectingChords || !selectedSongId}
              className="hover:bg-purple-500/20 bg-purple-500/10 text-purple-300 border border-purple-500/30 px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center gap-1"
              title="Detectar Acordes automáticamente desde la pista ★ Master"
            >
              <Activity size={11} className={isDetectingChords ? "animate-pulse" : ""} />
              {isDetectingChords ? 'Analizando...' : 'Acordes IA'}
            </button>
            <div className="w-px h-3.5 bg-zinc-800 mx-0.5"></div>
            <span className="text-[9px] text-zinc-500 font-bold uppercase px-1">Tono:</span>
            <button
              onClick={() => handleTransposeAllChords(-1)}
              className="px-1.5 py-0.5 text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded font-bold"
              title="Bajar todos los acordes 1 semitono"
            >
              -1
            </button>
            <button
              onClick={() => handleTransposeAllChords(1)}
              className="px-1.5 py-0.5 text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded font-bold"
              title="Subir todos los acordes 1 semitono"
            >
              +1
            </button>
            <div className="w-px h-3.5 bg-zinc-800 mx-0.5"></div>
            <button onClick={handleHalveTempo} className="px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-white font-bold transition-colors" title="Mitad de Tempo">÷2</button>
            <button onClick={handleDoubleTempo} className="px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-white font-bold transition-colors" title="Doble de Tempo">x2</button>
            <button onClick={handleClearBeatGrid} className="hover:bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors" title="Usar grilla matemática rígida">Fijar</button>
          </div>

          <div className="flex items-center gap-1.5 bg-[#07090e] rounded-lg border border-zinc-800/80 py-1 px-2">
            <span className="text-[9px] text-zinc-500 font-bold uppercase">Nudge</span>
            <button onClick={() => handleNudge(-0.01)} className="text-zinc-400 hover:text-white text-xs px-1 font-bold">-</button>
            <span className="text-[10px] text-zinc-200 font-mono w-6 text-center">{(manualGridOffset * 1000).toFixed(0)}</span>
            <button onClick={() => handleNudge(0.01)} className="text-zinc-400 hover:text-white text-xs px-1 font-bold">+</button>
          </div>

          {selectedSongId && (
            <button
              onClick={() => navigate('/lyrics')}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-all"
              title="Ir a Lyric Studio para sincronizar la letra de esta canción"
            >
              <span>Lyrics</span>
              <ArrowRight size={11} />
            </button>
          )}
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Progress Overlays */}
        {isDownloading && (
          <div className="absolute inset-0 bg-black/90 z-40 flex flex-col items-center justify-center backdrop-blur-sm">
            <Loader2 size={32} className="animate-spin text-emerald-500 mb-4" />
            <h2 className="text-sm font-bold text-zinc-200 tracking-widest uppercase mb-1">Cargando Stems en Memoria RAM</h2>
            <p className="text-xs text-zinc-500 mb-6 font-mono">{loadProgress.currentFile}</p>
            <div className="w-64 bg-zinc-900 rounded-full h-1.5 overflow-hidden">
              <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${(loadProgress.loaded / Math.max(1, loadProgress.total)) * 100}%` }}></div>
            </div>
          </div>
        )}

        {chordDetectionMsg && (
          <div className="absolute inset-0 bg-black/90 z-40 flex flex-col items-center justify-center backdrop-blur-sm">
            <Sparkles size={32} className="animate-pulse text-purple-500 mb-4" />
            <h2 className="text-sm font-bold text-purple-400 tracking-widest uppercase mb-1">Análisis Armónico IA</h2>
            <p className="text-xs text-zinc-400 mb-6 font-mono">{chordDetectionMsg}</p>
            <div className="w-64 bg-zinc-900 rounded-full h-1.5 overflow-hidden">
              <div className="bg-purple-500 h-full w-full animate-pulse"></div>
            </div>
          </div>
        )}

        {/* MIXER SIDEBAR (Consola de Configuración de Canales del Usuario) */}
        <div className="w-[330px] shrink-0 flex flex-col bg-[#0b0d13] border-r border-white/[0.07] z-10 shadow-2xl">
          <div className="h-9 border-b border-white/[0.06] flex items-center justify-between px-4 bg-[#10131c]">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Consola de Canales</span>
            <span className="text-[9px] text-zinc-500 font-mono">{stems.length} Canales</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 custom-scrollbar">
            {stems.map((stem) => {
              const nameLower = stem.name.toLowerCase();
              const dbMatch = dbStems.find((d: any) => d.id === stem.id);
              const isMasterRef = Boolean(dbMatch?.metadata?.is_master);
              let Icon = Music;
              let themeClass = 'text-zinc-400';
              
              if (isMasterRef) {
                Icon = Star; themeClass = 'text-amber-400';
              } else if (nameLower.includes('drum') || nameLower.includes('bater') || nameLower.includes('perc')) {
                Icon = Activity; themeClass = 'text-orange-400';
              } else if (nameLower.includes('vocal') || nameLower.includes('voz') || nameLower.includes('mic')) {
                Icon = Mic; themeClass = 'text-cyan-400';
              } else if (nameLower.includes('bass') || nameLower.includes('bajo')) {
                Icon = Music; themeClass = 'text-purple-400';
              } else if (nameLower.includes('guit')) {
                Icon = Music; themeClass = 'text-amber-400';
              } else if (nameLower.includes('key') || nameLower.includes('piano') || nameLower.includes('synth')) {
                Icon = Music; themeClass = 'text-pink-400';
              } else if (stem.type === 'Click') {
                Icon = Headphones; themeClass = 'text-emerald-500';
              } else if (stem.type === 'Cues') {
                Icon = Mic; themeClass = 'text-blue-400';
              }

              const routeBadge = stem.type === 'Instrument' ? 'FOH (R)' : 'MÚSICOS (L)';

              return (
                <div
                  key={stem.id}
                  className={`flex flex-col border rounded-lg overflow-hidden transition-colors ${
                    isMasterRef
                      ? 'bg-amber-950/10 border-amber-500/30'
                      : stem.muted
                      ? 'bg-[#0d0f15]/60 border-zinc-800/40 opacity-65'
                      : 'bg-[#12151f] border-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center p-2 border-b border-white/[0.04] gap-1.5">
                    <Icon size={12} className={`${themeClass} shrink-0`} />
                    <span className="text-[11px] font-bold text-zinc-200 truncate flex-1" title={stem.name}>
                      {stem.name}
                    </span>
                    {isMasterRef ? (
                      <span
                        className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0"
                        title="Pista Master de referencia para IA. Inicia silenciada (M) para no duplicar instrumentos al exportar tu mezcla."
                      >
                        ★ MASTER REF
                      </span>
                    ) : (
                      <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                        stem.type === 'Instrument'
                          ? 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                          : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                      }`}>
                        {routeBadge}
                      </span>
                    )}
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => toggleMute(stem.id)}
                        className={`w-6 h-5 flex items-center justify-center rounded text-[9px] font-black transition-colors ${
                          stem.muted
                            ? 'bg-red-600 text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                            : 'bg-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                        title={stem.muted ? "Canal Silenciado (No sonará en la exportación)" : "Silenciar Canal (Mute)"}
                      >
                        M
                      </button>
                      <button
                        onClick={() => toggleSolo(stem.id)}
                        className={`w-6 h-5 flex items-center justify-center rounded text-[9px] font-black transition-colors ${
                          stem.solo
                            ? 'bg-amber-400 text-black shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                            : 'bg-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                        title="Escuchar en Solo"
                      >
                        S
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex items-center px-2.5 py-2 gap-3 bg-[#0c0e15]">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-[8px] text-zinc-500 font-bold">VOL</span>
                      <input 
                        type="range" min="0" max="1" step="0.01" value={stem.volume} onChange={(e) => handleVolumeChange(stem.id, parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-red-500 hover:accent-red-400"
                      />
                    </div>
                    <div className="flex items-center gap-2 w-24">
                      <span className="text-[8px] text-zinc-500 font-bold">PAN</span>
                      <input 
                        type="range" min="-1" max="1" step="0.01" value={stem.pan} onChange={(e) => handlePanChange(stem.id, parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-zinc-400 hover:accent-zinc-200"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* PROMPTER VISUAL AREA */}
        <div className="flex-1 bg-[#07090e] flex flex-col relative overflow-hidden">
          {/* Prompter Header Toolbar */}
          <div className="h-12 border-b border-white/[0.07] flex items-center justify-between px-4 bg-[#0e1118] shrink-0">
             <div className="flex items-center gap-3">
               <div className="flex items-center gap-1.5">
                 <Mic size={14} className="text-red-500" />
                 <h2 className="text-[10px] font-black text-white uppercase tracking-widest">2. Studio Prompter &bull; Voz Guía y Exportación</h2>
               </div>
               
               <div className="w-px h-4 bg-zinc-800 mx-1"></div>
               
               <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsEditingSections(!isEditingSections)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                      isEditingSections
                        ? 'bg-red-600/20 text-red-300 border border-red-500/40'
                        : 'text-zinc-300 hover:text-white bg-[#07090e] border border-zinc-800'
                    }`}
                    title="Marcar secciones (Intro, Verso, Coro, Puente) con el teclado para generar la Voz Guía"
                  >
                    {isEditingSections ? 'Salir de Grabación de Voz Guía' : '🎙️ Marcar Secciones (Voz Guía)'}
                    {isEditingSections && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse ml-1"></span>}
                  </button>
                  {isEditingSections && (
                    <>
                      <button onClick={() => { if (confirm('¿Borrar todas las secciones de Voz Guía?')) setPrompterData(prev => ({ ...prev, sections: [] })); }} className="px-2 py-1 text-[9px] text-red-400 hover:text-red-300 uppercase tracking-widest font-bold">Limpiar</button>
                      <button onClick={savePrompterData} className="px-2.5 py-1 text-[10px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-lg uppercase tracking-wider font-black hover:bg-emerald-500/25">Guardar Voz Guía</button>
                    </>
                  )}
                  
                  {!isEditingSections && (
                    isEditingPrompter ? (
                      <button onClick={handleSavePrompter} className="px-2.5 py-1 text-[10px] text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-lg uppercase tracking-wider font-black hover:bg-emerald-500/25 flex items-center gap-1">
                        <Save size={11} /> Guardar Texto
                      </button>
                    ) : (
                      <button onClick={() => { setPrompterText(stringifyPrompterData(prompterData)); setIsEditingPrompter(true); }} disabled={!selectedSongId} className="px-2.5 py-1 text-[10px] text-zinc-300 bg-[#07090e] border border-zinc-800 rounded-lg uppercase tracking-wider font-bold hover:text-white flex items-center gap-1">
                        <Edit3 size={11} /> Editor Texto Acordes
                      </button>
                    )
                  )}
               </div>
             </div>
             
             <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveMixConfig}
                  disabled={!selectedSongId}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors"
                  title="Guardar volúmenes y mutes de los canales"
                >
                  Guardar Faders
                </button>

                {/* Botón Principal de Exportación para Show En Vivo */}
                <button
                  onClick={handleExportLiveMix}
                  disabled={isExporting || !audioLoaded}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                  title="Renderizar y subir la mezcla configurada (Salida Público FOH + Salida Músicos CUE) lista para usar en el Setlist En Vivo"
                >
                  {isExporting ? (exportProgress || 'Exportando...') : '🚀 Exportar Mix En Vivo (FOH / CUE)'}
                </button>

                {/* Opciones secundarias de descarga local */}
                <div className="flex items-center gap-1 bg-[#07090e] p-1 rounded-lg border border-zinc-800/80">
                  <button onClick={handleExportMultitrackToZip} disabled={isExportingMultitrack || !audioLoaded} className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors disabled:opacity-40">
                    {isExportingMultitrack ? (exportProgress || 'ZIP...') : 'ZIP'}
                  </button>
                  <div className="w-px h-3 bg-zinc-800"></div>
                  <button onClick={handleExportFullMixMp3} disabled={isExportingMp3 || !audioLoaded} className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors disabled:opacity-40">
                    {isExportingMp3 ? (exportProgress || 'MP3...') : 'MP3'}
                  </button>
                </div>
             </div>
          </div>
          
          {/* Playhead Timeline Scrubber */}
          <div className="h-6 bg-[#07090e] border-b border-white/[0.06] flex items-center px-4 relative group cursor-pointer z-20">
            <input 
              type="range" min={-(preRollDuration || 0)} max={totalDuration || 100} step="0.1" 
              value={isDraggingSlider ? localSliderTime : currentTime}
              onPointerDown={(e) => { setLocalSliderTime(parseFloat(e.currentTarget.value)); setIsDraggingSlider(true); }}
              onPointerUp={() => { setIsDraggingSlider(false); seekTo(localSliderTime); }}
              onChange={(e) => { const val = parseFloat(e.target.value); setLocalSliderTime(val); if (!isPlaying) seekTo(val); }}
              disabled={!audioLoaded}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-full h-1.5 bg-zinc-800/90 rounded-full relative pointer-events-none">
              <div className="absolute top-0 bottom-0 left-0 bg-red-500 rounded-full" style={{ width: audioLoaded ? `${((currentTime + (preRollDuration || 0)) / Math.max(1, totalDuration + (preRollDuration || 0))) * 100}%` : '0%' }}></div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative">
            {isEditingPrompter ? (
              <div className="h-full flex flex-col p-4 bg-[#07090e]">
                <p className="text-xs text-zinc-400 mb-2 font-mono uppercase tracking-widest">Formato: <span className="text-amber-400">MM:SS Acorde o Sección</span></p>
                <textarea 
                  className="flex-1 bg-[#0d1017] border border-zinc-800 rounded-xl p-4 text-xs font-mono text-zinc-200 outline-none focus:border-red-500/50 resize-none leading-relaxed custom-scrollbar"
                  value={prompterText}
                  onChange={(e) => setPrompterText(e.target.value)}
                  placeholder="# SECCIONES\n00:00 INTRO\n00:15 CORO\n\n# ACORDES\n00:05 Am\n00:10 C"
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="h-full relative flex flex-col justify-center">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-900/30 via-[#07090e] to-[#07090e] pointer-events-none"></div>
                
                <Prompter 
                  currentTime={currentTime}
                  bpm={prompterData.bpm || 0}
                  timeSignature={prompterData.timeSignature}
                  baseOffset={prompterData.firstBeatOffset}
                  beatTimes={prompterData.beatTimes}
                  chords={prompterData.chords || []}
                  sections={prompterData.sections || []}
                  lyrics={prompterData.lyrics || []}
                  isVamping={isVamping}
                  onVampTrigger={handleVampTrigger}
                  isEditing={isEditingSections}
                  onRemoveSection={(index) => {
                     setPrompterData(prev => {
                        const s = [...(prev.sections || [])];
                        s.splice(index, 1);
                        return { ...prev, sections: s };
                     });
                  }}
                  onEditChord={handleEditSingleChord}
                  onRemoveChord={handleRemoveSingleChord}
                  onSeek={(t) => audioLoaded && seekTo(t)}
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
