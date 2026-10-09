import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Play, Pause, Save, Download, Type, Plus, Trash2, Settings2, Wand2, Loader2, Music } from 'lucide-react';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

interface LyricLine {
  id: string;
  text: string;
  startMs: number;
  durationMs: number;
  effect: 'smooth-blur' | 'kinetic' | 'double-exposure' | 'chromatic-glow' | 'gradient-wipe' | 'write-on' | 'glitch' | 'liquid';
  fontFamily: 'Montserrat' | 'Bebas Neue' | 'Playfair Display' | 'Roboto Slab' | 'Nexa Rust' | 'Northwell';
}

export default function LyricStudio() {
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string>('');
  const [songData, setSongData] = useState<any>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const lyricsRef = useRef(lyrics);
  useEffect(() => { lyricsRef.current = lyrics; }, [lyrics]);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    fetchSongs();
    return () => stopAudio();
  }, []);

  const fetchSongs = async () => {
    const { data } = await supabase.from('songs').select('*').eq('band_id', FAKE_BAND_ID);
    if (data) setSongs(data);
  };

  const loadSong = async (songId: string) => {
    setSelectedSongId(songId);
    stopAudio();
    const song = songs.find(s => s.id === songId);
    if (!song) return;
    setSongData(song);

    let initialLyrics = song.prompter_data?.lyrics || [
      { id: '1', text: "HELLO WORLD", startMs: 1000, durationMs: 2000, effect: 'smooth-blur', fontFamily: 'Playfair Display' },
      { id: '2', text: "KINETIC ENERGY", startMs: 3500, durationMs: 2500, effect: 'kinetic', fontFamily: 'Bebas Neue' },
      { id: '3', text: "CHROMATIC", startMs: 6500, durationMs: 3000, effect: 'chromatic-glow', fontFamily: 'Montserrat' }
    ];
    setLyrics(initialLyrics);

    if (song.foh_mix_url) {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      try {
        const res = await fetch(song.foh_mix_url);
        const arrayBuf = await res.arrayBuffer();
        audioBufferRef.current = await audioCtxRef.current.decodeAudioData(arrayBuf);
      } catch (e) {
        console.error("Error loading audio", e);
      }
    }
  };


  const playAudio = () => {
    if (!audioCtxRef.current || !audioBufferRef.current) return;
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();

    stopAudio(); // clear previous

    sourceNodeRef.current = audioCtxRef.current.createBufferSource();
    sourceNodeRef.current.buffer = audioBufferRef.current;
    
    const gainNode = audioCtxRef.current.createGain();
    gainNode.gain.value = 1;
    sourceNodeRef.current.connect(gainNode);
    gainNode.connect(audioCtxRef.current.destination);

    sourceNodeRef.current.start(0, pauseTimeRef.current);
    startTimeRef.current = audioCtxRef.current.currentTime - pauseTimeRef.current;
    
    setIsPlaying(true);
    isPlayingRef.current = true;
    renderCanvas();
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e) {}
    }
    if (audioCtxRef.current) pauseTimeRef.current = audioCtxRef.current.currentTime - startTimeRef.current;
    
    setIsPlaying(false);
    isPlayingRef.current = false;
    cancelAnimationFrame(rafRef.current);
  };

  const seek = (timeS: number) => {
    const wasPlaying = isPlaying;
    stopAudio();
    pauseTimeRef.current = timeS;
    setCurrentTime(timeS * 1000);
    if (wasPlaying) {
      playAudio();
    } else {
      renderCanvas(); // Update canvas instantly even if paused
    }
  };

  const startExport = () => {
    if (!canvasRef.current) return;
    setIsRecording(true);
    pauseTimeRef.current = 0;
    setCurrentTime(0);

    const stream = canvasRef.current.captureStream(60); 
    
    let audioDest: MediaStreamAudioDestinationNode | null = null;
    if (audioCtxRef.current && audioBufferRef.current) {
      audioDest = audioCtxRef.current.createMediaStreamDestination();
      const exportSource = audioCtxRef.current.createBufferSource();
      exportSource.buffer = audioBufferRef.current;
      exportSource.connect(audioDest);
      exportSource.start(0);
      audioDest.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    }

    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    recordedChunksRef.current = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${songData?.title || 'lyric_export'}.webm`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      setIsRecording(false);
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    playAudio();
    
    if (audioBufferRef.current) {
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
          stopAudio();
          pauseTimeRef.current = 0;
        }
      }, audioBufferRef.current.duration * 1000);
    }
  };

  // Advanced Elite Render Engine
  const renderCanvas = () => {
    if (!canvasRef.current || !audioCtxRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const canvasW = canvasRef.current.width;
    const canvasH = canvasRef.current.height;

    const timeMs = isPlaying 
      ? (audioCtxRef.current.currentTime - startTimeRef.current) * 1000 
      : pauseTimeRef.current * 1000;
    
    setCurrentTime(timeMs);

    // Dynamic Background
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvasW, canvasH);
    const pulse = Math.sin(timeMs / 500) * 0.1 + 0.9;
    const grad = ctx.createRadialGradient(canvasW/2, canvasH/2, 0, canvasW/2, canvasH/2, canvasW/1.5);
    grad.addColorStop(0, `rgba(40, 10, 20, ${0.3 * pulse})`);
    grad.addColorStop(1, '#050505');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw Lyrics (Elite Engine)
    lyricsRef.current.forEach(line => {
      if (timeMs >= line.startMs && timeMs <= line.startMs + line.durationMs) {
        const progress = (timeMs - line.startMs) / line.durationMs;
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Font Fallbacks mapping
        let fontFace = '"Inter", sans-serif';
        if (line.fontFamily === 'Bebas Neue') fontFace = '"Bebas Neue", "Alternate Gothic", sans-serif';
        if (line.fontFamily === 'Playfair Display') fontFace = '"Playfair Display", serif';
        if (line.fontFamily === 'Montserrat') fontFace = '"Montserrat", sans-serif';
        if (line.fontFamily === 'Roboto Slab') fontFace = '"Roboto Slab", serif';
        
        ctx.font = `900 130px ${fontFace}`;

        const words = line.text.split(' ');
        const wordSpacing = 50;
        
        let totalWidth = 0;
        const wordWidths = words.map(w => {
           const wWidth = ctx.measureText(w).width;
           totalWidth += wWidth;
           return wWidth;
        });
        totalWidth += wordSpacing * (words.length - 1);
        
        let currentX = -(totalWidth / 2);
        
        words.forEach((word, wordIndex) => {
           const staggerDelay = wordIndex * (0.3 / words.length); 
           let wordProgress = 0;
           if (progress > staggerDelay) {
              wordProgress = Math.min((progress - staggerDelay) * (1 / (1 - staggerDelay)), 1);
           }
           
           if (wordProgress > 0) {
              ctx.save();
              const wordCenterX = currentX + wordWidths[wordIndex] / 2;
              
              let scale = 1;
              let yOffset = 0;
              let opacity = 1;
              
              // 1. Smooth Blur Reveal
              if (line.effect === 'smooth-blur') {
                 if (wordProgress < 0.2) {
                    const p = wordProgress / 0.2;
                    opacity = p;
                    scale = 0.9 + p * 0.1;
                    ctx.filter = `blur(${20 * (1-p)}px)`;
                 } else if (wordProgress > 0.8) {
                    const p = (wordProgress - 0.8) / 0.2;
                    opacity = 1 - p;
                    scale = 1 + p * 0.1;
                    ctx.filter = `blur(${20 * p}px)`;
                 }
                 ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
              } 
              // 2. Kinetic Typography
              else if (line.effect === 'kinetic') {
                 if (wordProgress < 0.2) {
                    const p = wordProgress / 0.2;
                    scale = 0.2 + (Math.sin(p * Math.PI * 1.5) * p * 1.2); 
                    opacity = p;
                 } else if (wordProgress > 0.8) {
                    const p = (wordProgress - 0.8) / 0.2;
                    scale = 1 + Math.pow(p, 3);
                    opacity = 1 - p;
                 }
                 ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
              }
              // 3. Chromatic Glow
              else if (line.effect === 'chromatic-glow') {
                 if (wordProgress < 0.15) opacity = wordProgress / 0.15;
                 else if (wordProgress > 0.85) opacity = 1 - ((wordProgress - 0.85) / 0.15);
                 
                 const aberration = (Math.sin(timeMs / 100) * 5) * (1 - opacity) + 2;
                 
                 ctx.globalCompositeOperation = 'screen';
                 ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`;
                 ctx.fillText(word, -aberration, 0);
                 ctx.fillStyle = `rgba(0, 255, 0, ${opacity})`;
                 ctx.fillText(word, 0, 0);
                 ctx.fillStyle = `rgba(0, 0, 255, ${opacity})`;
                 ctx.fillText(word, aberration, 0);
                 ctx.globalCompositeOperation = 'source-over';
                 ctx.fillStyle = 'transparent'; // drawn above
              }
              // 4. Gradient Wipe
              else if (line.effect === 'gradient-wipe') {
                 if (wordProgress < 0.1) opacity = wordProgress / 0.1;
                 else if (wordProgress > 0.9) opacity = 1 - ((wordProgress - 0.9) / 0.1);
                 
                 // Base text
                 ctx.fillStyle = `rgba(50, 50, 50, ${opacity})`;
                 ctx.fillText(word, 0, 0);
                 
                 // Wipe mask
                 ctx.save();
                 ctx.beginPath();
                 const wipeX = -wordWidths[wordIndex]/2 + (wordWidths[wordIndex] * (wordProgress * 1.5));
                 ctx.rect(-wordWidths[wordIndex], -100, wipeX + wordWidths[wordIndex], 200);
                 ctx.clip();
                 const textGrad = ctx.createLinearGradient(-wordWidths[wordIndex]/2, 0, wordWidths[wordIndex]/2, 0);
                 textGrad.addColorStop(0, `rgba(255,255,255,${opacity})`);
                 textGrad.addColorStop(1, `rgba(255,255,255,${opacity*0.2})`);
                 ctx.fillStyle = textGrad;
                 ctx.fillText(word, 0, 0);
                 ctx.restore();
                 
                 ctx.fillStyle = 'transparent';
              }
              // 5. Glitch
              else if (line.effect === 'glitch') {
                 if (wordProgress < 0.1) opacity = wordProgress / 0.1;
                 else if (wordProgress > 0.9) opacity = 1 - ((wordProgress - 0.9) / 0.1);
                 
                 ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                 if (wordProgress > 0.3 && wordProgress < 0.7 && Math.random() > 0.8) {
                    ctx.transform(1, 0, (Math.random()-0.5)*0.5, 1, 0, 0);
                    ctx.fillText(word, (Math.random()-0.5)*20, (Math.random()-0.5)*10);
                 }
              }
              else {
                 // Fallback smooth
                 if (wordProgress < 0.2) opacity = wordProgress / 0.2;
                 else if (wordProgress > 0.8) opacity = 1 - ((wordProgress - 0.8) / 0.2);
                 ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
              }
              
              ctx.translate(canvasW/2 + wordCenterX, canvasH/2 + yOffset);
              ctx.scale(scale, scale);
              if (ctx.fillStyle !== 'transparent') {
                ctx.fillText(word, 0, 0);
              }
              ctx.restore();
           }
           currentX += wordWidths[wordIndex] + wordSpacing;
        });
      }
    });

    if (isPlayingRef.current) { rafRef.current = requestAnimationFrame(renderCanvas); }
  };

  const [isDetecting, setIsDetecting] = useState(false);
  const [replicateKey, setReplicateKey] = useState(() => localStorage.getItem('replicate_api_key') || '');
  const [showTokenModal, setShowTokenModal] = useState(false);

  const handleAutoDetect = async () => {
    if (!songData || !songData.foh_mix_url) {
      alert("Por favor selecciona una canción con un archivo de audio válido primero.");
      return;
    }
    
    const envToken = import.meta.env.VITE_REPLICATE_API_TOKEN;
    const activeToken = envToken || replicateKey;
    
    if (!activeToken) {
      setShowTokenModal(true);
      return;
    }
    
    setIsDetecting(true);
    
    try {
      const response = await fetch("/api/replicate-predict", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${activeToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          version: "84d2cb0a12d5fda904529d1a93eea14389fb13b19280d9ee6cc04a0e9803d366", // victor-upmeet/whisperx
          input: {
            audio: songData.foh_mix_url,
            batch_size: 64,
            align_output: true
          }
        })
      });

      let prediction = await response.json();
      if (prediction.error) throw new Error(prediction.error);

      // 2. Polling (Esperar a que termine de procesar)
      while (prediction.status !== "succeeded" && prediction.status !== "failed") {
        await new Promise(r => setTimeout(r, 2000));        const pollResponse = await fetch(`/api/replicate-poll?id=${prediction.id}`, {
          headers: { "Authorization": `Bearer ${activeToken}` }
        });
        prediction = await pollResponse.json();
      }

      if (prediction.status === "failed") throw new Error("La transcripción falló en Replicate.");

      // 3. Mapear los segmentos devueltos a nuestro motor de letras
      // WhisperX devuelve segments: [{ text: "...", start: 0.0, end: 2.0 }, ...]
      const segments = prediction.output?.segments || [];
      
      const aiLyrics: LyricLine[] = segments.map((seg: any, idx: number) => ({
        id: `ai-${Date.now()}-${idx}`,
        text: seg.text.trim().toUpperCase(),
        startMs: Math.round(seg.start * 1000),
        durationMs: Math.round((seg.end - seg.start) * 1000),
        // Alternamos efectos para dar un look dinámico automático
        effect: idx % 2 === 0 ? 'kinetic' : 'smooth-blur', 
        fontFamily: 'Montserrat'
      }));
      
      setLyrics([...lyrics, ...aiLyrics]);
      alert("¡Letras sincronizadas exitosamente vía Replicate (WhisperX)!");
      
    } catch (err: any) {
      alert(`Error al contactar a Replicate: ${err.message}`);
      if (err.message.includes("Token")) {
         localStorage.removeItem('replicate_api_key');
         setReplicateKey('');
      }
    } finally {
      setIsDetecting(false);
    }
  };

  const handleSave = async () => {
    if (!songData) return;
    const newPrompterData = { ...songData.prompter_data, lyrics };
    await supabase.from('songs').update({ prompter_data: newPrompterData }).eq('id', songData.id);
    alert('Lyrics saved!');
  };

  const addLine = () => {
    const startMs = lyrics.length > 0 ? lyrics[lyrics.length - 1].startMs + 3000 : 0;
    setLyrics([...lyrics, { id: Date.now().toString(), text: 'NEW LYRIC', startMs, durationMs: 2000, effect: 'kinetic', fontFamily: 'Montserrat' }]);
  };

  const updateLine = (id: string, updates: Partial<LyricLine>) => {
    setLyrics(lyrics.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const removeLine = (id: string) => {
    setLyrics(lyrics.filter(l => l.id !== id));
  };

  return (
    <div className="h-screen bg-[#050505] text-white flex flex-col font-sans">
      <header className="h-[70px] bg-[#09090b] border-b border-white/5 flex items-center px-6 justify-between z-20 shrink-0">
        <div className="flex items-center space-x-4">
          <div className="bg-gradient-to-br from-indigo-600 to-purple-800 text-white font-black px-3 py-1.5 rounded-lg uppercase tracking-widest text-[10px] shadow-[0_0_20px_rgba(79,70,229,0.2)] flex items-center gap-2">
            <Type size={14} /> LYRIC STUDIO ELITE
          </div>
          <select 
            className="bg-white/5 border border-white/10 text-white px-3 py-1.5 rounded-lg outline-none font-semibold text-xs"
            value={selectedSongId}
            onChange={(e) => loadSong(e.target.value)}
          >
            <option value="">Seleccionar CanciÃ³n...</option>
            {songs.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>

        <div className="flex items-center space-x-3">
          <button 
            onClick={isPlaying ? stopAudio : playAudio}
            disabled={!songData || isRecording}
            className="flex items-center space-x-2 bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-lg font-bold text-sm transition-all disabled:opacity-50"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            <span>{isPlaying ? 'Pausa' : 'Preview'}</span>
          </button>
          
          <button 
            onClick={handleSave}
            disabled={!songData}
            className="flex items-center space-x-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 px-4 py-1.5 rounded-lg font-bold text-sm transition-all border border-green-500/20"
          >
            <Save size={14} /> <span>Guardar</span>
          </button>

          <button 
            onClick={startExport}
            disabled={!songData || isRecording}
            className="flex items-center space-x-2 bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded-lg font-bold text-sm transition-all shadow-[0_0_15px_rgba(220,38,38,0.4)]"
          >
            <Download size={14} className={isRecording ? "animate-bounce" : ""} />
            <span>{isRecording ? 'Renderizando...' : 'Exportar MP4'}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Editor Sidebar */}
        <div className="w-[450px] bg-[#09090b] border-r border-white/5 flex flex-col">
                    <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
            <div>
              <h2 className="font-bold text-gray-200 uppercase tracking-widest text-xs">Secuencia de Letras</h2>
              <p className="text-[10px] text-gray-500 mt-0.5">Control por palabra, fuente y efecto</p>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={handleAutoDetect} 
                disabled={isDetecting || !songData}
                className="bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 p-2 rounded-lg transition-colors border border-indigo-500/20 disabled:opacity-50 flex items-center justify-center"
                title="Detectar con Inteligencia Artificial"
              >
                {isDetecting ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              </button>
              <button onClick={addLine} className="bg-white/10 hover:bg-white/20 p-2 rounded-lg text-white transition-colors" title="Agregar Frase Manual">
                <Plus size={16} />
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {lyrics.map((line) => (
              <div key={line.id} className="bg-white/[0.03] border border-white/10 rounded-xl p-4 flex flex-col gap-3 relative group">
                <button onClick={() => removeLine(line.id)} className="absolute top-3 right-3 text-red-500/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 size={14} />
                </button>
                
                <input 
                  type="text" 
                  value={line.text}
                  onChange={(e) => updateLine(line.id, { text: e.target.value })}
                  className="bg-transparent text-lg font-black text-white outline-none border-b border-white/10 pb-1 focus:border-indigo-500 placeholder-gray-700"
                  placeholder="Escribe la frase..."
                />
                
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-gray-500 font-bold uppercase mb-1">Inicio (ms)</span>
                    <input type="number" value={line.startMs} onChange={(e) => updateLine(line.id, { startMs: Number(e.target.value) })} className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs outline-none" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-gray-500 font-bold uppercase mb-1">DuraciÃ³n (ms)</span>
                    <input type="number" value={line.durationMs} onChange={(e) => updateLine(line.id, { durationMs: Number(e.target.value) })} className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs outline-none" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 bg-black/30 p-2 rounded-lg border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-gray-400 font-bold uppercase mb-1 flex items-center gap-1"><Settings2 size={10}/> Efecto Elite</span>
                    <select value={line.effect} onChange={(e) => updateLine(line.id, { effect: e.target.value as any })} className="bg-transparent border-none text-xs font-semibold text-indigo-300 outline-none cursor-pointer">
                      <option value="smooth-blur">Smooth Blur Reveal</option>
                      <option value="kinetic">Kinetic Typography</option>
                      <option value="chromatic-glow">Chromatic Glow</option>
                      <option value="gradient-wipe">Gradient Wipe</option>
                      <option value="glitch">Digital Glitch</option>
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] text-gray-400 font-bold uppercase mb-1 flex items-center gap-1"><Type size={10}/> TipografÃ­a</span>
                    <select value={line.fontFamily} onChange={(e) => updateLine(line.id, { fontFamily: e.target.value as any })} className="bg-transparent border-none text-xs font-semibold text-pink-300 outline-none cursor-pointer">
                      <option value="Montserrat">Montserrat (Black)</option>
                      <option value="Bebas Neue">Bebas Neue (Impact)</option>
                      <option value="Playfair Display">Playfair Display (Elegante)</option>
                      <option value="Roboto Slab">Roboto Slab</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
            {lyrics.length === 0 && <div className="text-center text-gray-600 text-xs py-10">Agrega tu primera frase...</div>}
          </div>
        </div>

        {/* Canvas Visualizer */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-black relative">
           <div className="w-full max-w-5xl aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10 relative">
              <canvas ref={canvasRef} width={1920} height={1080} className="w-full h-full object-cover" />
              
              <div className="absolute bottom-6 right-6 bg-black/60 px-4 py-2 rounded-lg font-mono text-xs border border-white/10 backdrop-blur-md text-red-400 flex flex-col items-end">
                <span className="text-[9px] text-white/50 uppercase tracking-widest mb-1">Timeline</span>
                <span className="font-bold text-sm">{(currentTime / 1000).toFixed(2)}s</span>
              </div>
              
              {isRecording && (
                <div className="absolute top-6 left-6 flex items-center space-x-2 bg-red-600 text-white px-4 py-2 rounded-lg font-bold animate-pulse text-xs">
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                  <span>GRABANDO 60FPS / 1080p</span>
                </div>
              )}
           </div>
           <p className="mt-6 text-gray-600 text-xs font-medium tracking-widest uppercase">Motor Generativo en Tiempo Real</p>
        </div>
      </div>

      {/* Timeline Grid Gráfico */}
      <div className="h-48 bg-[#09090b] border-t border-white/10 flex flex-col relative overflow-hidden shrink-0">
         <div className="p-2 border-b border-white/5 flex justify-between items-center bg-black/50">
           <span className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><Music size={12}/> Grilla de Sincronización Interactiva</span>
           <span className="text-[10px] text-gray-500">Haz clic en la línea de tiempo para desplazarte (1 click = mover playhead).</span>
         </div>
         
         <div 
           className="flex-1 relative overflow-x-auto overflow-y-hidden custom-scrollbar bg-[#050505]"
           onMouseDown={(e) => {
              if (e.button !== 0) return; // Only left click for seeking
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left + e.currentTarget.scrollLeft;
              const clickedTimeS = clickX / 50;
              seek(clickedTimeS);
           }}
           onContextMenu={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left + e.currentTarget.scrollLeft;
              const clickedTimeMs = (clickX / 50) * 1000;
              
              const newLine = {
                id: `lyric-${Date.now()}`,
                text: "NUEVA LETRA",
                startMs: clickedTimeMs,
                durationMs: 3000,
                effect: 'kinetic' as any,
                fontFamily: 'Montserrat' as any
              };
              
              setLyrics(prev => [...prev, newLine].sort((a, b) => a.startMs - b.startMs));
           }}
         >
           <div className="absolute top-0 bottom-0 h-full" style={{ width: Math.max(3000, 300 * 50) }}>
             
             {/* Background Grid (Segundos) */}
             <div className="absolute inset-0" style={{
               backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
               backgroundSize: `50px 100%, 10px 100%`
             }}></div>

             {/* Second Markers */}
             {Array.from({ length: 300 }).map((_, i) => (
               i % 5 === 0 && (
                 <span key={i} className="absolute top-1 text-[9px] text-gray-600 font-mono pointer-events-none" style={{ left: i * 50 + 4 }}>
                   00:{(i).toString().padStart(2, '0')}
                 </span>
               )
             ))}

             {/* Lyrics Blocks Tracks */}
             <div className="absolute top-8 bottom-6 left-0 right-0 pointer-events-none">
               {lyrics.map((line, idx) => (
                 <div 
                   key={line.id}
                   className="absolute h-8 bg-indigo-600/30 border border-indigo-500/50 rounded-md backdrop-blur-sm flex items-center px-2 shadow-lg"
                   style={{ 
                     left: (line.startMs / 1000) * 50,
                     width: Math.max(10, (line.durationMs / 1000) * 50),
                     top: (idx % 3) * 36
                   }}
                 >
                   <span className="text-[10px] font-bold text-white whitespace-nowrap truncate">{line.text}</span>
                 </div>
               ))}
             </div>

             {/* Playhead (Current Time) */}
             <div className="absolute top-0 bottom-0 w-px bg-red-500 z-30 pointer-events-none" style={{ left: (currentTime / 1000) * 50 }}>
               <div className="w-3 h-3 bg-red-500 absolute -top-1.5 -left-[5px] rounded-full shadow-[0_0_10px_red]"></div>
             </div>

           </div>
         </div>
      </div>      {showTokenModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#09090b] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl relative">
            <h3 className="text-xl font-bold text-white mb-2">Conexión con Replicate (IA)</h3>
            <p className="text-gray-400 text-sm mb-6">
              Para generar las letras automáticamente, necesitamos conectar con el modelo WhisperX de Replicate.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  API Token (r8_...)
                </label>
                <input 
                  type="password" 
                  value={replicateKey}
                  onChange={(e) => setReplicateKey(e.target.value)}
                  placeholder="r8_..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              
              <div className="flex space-x-3 pt-2">
                <button 
                  onClick={() => setShowTokenModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-bold text-sm bg-white/5 hover:bg-white/10 text-white transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => {
                    if (replicateKey) {
                      localStorage.setItem('replicate_api_key', replicateKey);
                      setShowTokenModal(false);
                      // Reintentar la detección automáticamente
                      handleAutoDetect();
                    }
                  }}
                  className="flex-1 px-4 py-3 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-[0_0_20px_rgba(79,70,229,0.3)]"
                >
                  Guardar y Detectar
                </button>
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-white/5 text-xs text-gray-500 text-center">
              Alternativa: Configura <code className="text-indigo-400">VITE_REPLICATE_API_TOKEN</code> en las variables de entorno de tu servidor (Vercel) para omitir este paso.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}










