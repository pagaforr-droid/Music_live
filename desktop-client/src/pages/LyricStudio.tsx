import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Play, Pause, Save, Download, Type, Plus, Trash2, Settings2 } from 'lucide-react';

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
  const [isPlaying, setIsPlaying] = useState(false);
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

    sourceNodeRef.current = audioCtxRef.current.createBufferSource();
    sourceNodeRef.current.buffer = audioBufferRef.current;
    
    const gainNode = audioCtxRef.current.createGain();
    gainNode.gain.value = 1;
    sourceNodeRef.current.connect(gainNode);
    gainNode.connect(audioCtxRef.current.destination);

    sourceNodeRef.current.start(0, pauseTimeRef.current);
    startTimeRef.current = audioCtxRef.current.currentTime - pauseTimeRef.current;
    setIsPlaying(true);
    renderCanvas();
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e) {}
    }
    if (audioCtxRef.current) pauseTimeRef.current = audioCtxRef.current.currentTime - startTimeRef.current;
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
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
    lyrics.forEach(line => {
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

    if (isPlaying) {
      rafRef.current = requestAnimationFrame(renderCanvas);
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
            <option value="">Seleccionar Canción...</option>
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
            <button onClick={addLine} className="bg-white/10 hover:bg-white/20 p-2 rounded-lg text-white transition-colors">
              <Plus size={16} />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {lyrics.map((line, idx) => (
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
                    <span className="text-[9px] text-gray-500 font-bold uppercase mb-1">Duración (ms)</span>
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
                    <span className="text-[9px] text-gray-400 font-bold uppercase mb-1 flex items-center gap-1"><Type size={10}/> Tipografía</span>
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
    </div>
  );
}
