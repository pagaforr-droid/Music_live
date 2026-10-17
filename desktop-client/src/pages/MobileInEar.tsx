import { useEffect, useState, useRef } from 'react';
import { useSyncSlave } from '../hooks/useSyncSlave';
import { Volume2, Power, Music, Activity, Headphones } from 'lucide-react';
import { Prompter } from '../components/Prompter';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function MobileInEar() {
  const { songData, isPlaying, playTrigger, pauseTrigger, seekTrigger, clockOffset } = useSyncSlave(FAKE_BAND_ID);
  
  const [hasInteracted, setHasInteracted] = useState(false);
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  
  const [cueBuffer, setCueBuffer] = useState<AudioBuffer | null>(null);
  const [fohBuffer, setFohBuffer] = useState<AudioBuffer | null>(null);
  const [loadStatus, setLoadStatus] = useState<string>('Esperando Master...');
  
  const cueSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fohSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  const cueGainRef = useRef<GainNode | null>(null);
  const fohGainRef = useRef<GainNode | null>(null);
  
  const [currentTime, setCurrentTime] = useState(0);
  const startTimeRef = useRef(0);
  const animationFrameRef = useRef(0);
  
  const [cueVolume, setCueVolume] = useState(1);
  const [bandVolume, setBandVolume] = useState(0.8);

  // Initialize AudioContext on first tap
  const handleConnect = async () => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    
    const cGain = ctx.createGain();
    cGain.connect(ctx.destination);
    cGain.gain.value = cueVolume;
    cueGainRef.current = cGain;

    const fGain = ctx.createGain();
    fGain.connect(ctx.destination);
    fGain.gain.value = bandVolume;
    fohGainRef.current = fGain;
    
    setAudioCtx(ctx);
    setHasInteracted(true);
    
    // Play a tiny silent buffer to unlock audio on iOS
    const silentBuffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(ctx.destination);
    source.start();

    // Mantener la pantalla encendida para que iOS/Android no duerman el AudioContext
    try {
      if ('wakeLock' in navigator) {
        await (navigator as any).wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('Wake Lock error:', err);
    }
  };

  useEffect(() => {
    if (cueGainRef.current) cueGainRef.current.gain.value = cueVolume;
  }, [cueVolume]);

  useEffect(() => {
    if (fohGainRef.current) fohGainRef.current.gain.value = bandVolume;
  }, [bandVolume]);

  // Load new song when Master says LOAD_SONG
  useEffect(() => {
    if (songData && audioCtx) {
      const cueTarget = songData.cue_mobile_url || songData.cue_mix_url;
      const fohTarget = songData.foh_mobile_url || songData.foh_mix_url;
      loadAudio(cueTarget, fohTarget);
    }
  }, [songData, audioCtx]);

  const loadAudio = async (cueUrl: string, fohUrl: string) => {
    if (!audioCtx) return;
    setLoadStatus('Descargando pistas de práctica...');
    try {
      const [cueRes, fohRes] = await Promise.all([
        fetch(cueUrl),
        fetch(fohUrl)
      ]);
      
      const [cueArray, fohArray] = await Promise.all([
        cueRes.arrayBuffer(),
        fohRes.arrayBuffer()
      ]);

      setLoadStatus('Decodificando audio...');
      
      const [cBuffer, fBuffer] = await Promise.all([
        audioCtx.decodeAudioData(cueArray),
        audioCtx.decodeAudioData(fohArray)
      ]);
      
      setCueBuffer(cBuffer);
      setFohBuffer(fBuffer);
      
      setLoadStatus('Listo para Ensayo (Standby)');
      setCurrentTime(0);
    } catch (e: any) {
      setLoadStatus('Error: ' + e.message);
    }
  };

  // Handle Transport Triggers
  useEffect(() => {
    if (!audioCtx || !cueBuffer || !fohBuffer || !hasInteracted) return;

    if (playTrigger) {
      try { cueSourceRef.current?.stop(); } catch (e) {}
      try { fohSourceRef.current?.stop(); } catch (e) {}

      const cSource = audioCtx.createBufferSource();
      cSource.buffer = cueBuffer;
      cSource.connect(cueGainRef.current!);
      cueSourceRef.current = cSource;

      const fSource = audioCtx.createBufferSource();
      fSource.buffer = fohBuffer;
      fSource.connect(fohGainRef.current!);
      fohSourceRef.current = fSource;

      // Calculate when to start with NTP clock offset correction
      const correctedClientTime = Date.now() + clockOffset;
      const timeUntilStartMs = Math.max(0, playTrigger.startAt - correctedClientTime);
      const exactContextTime = audioCtx.currentTime + (timeUntilStartMs / 1000);

      cSource.start(exactContextTime, playTrigger.offset);
      fSource.start(exactContextTime, playTrigger.offset);
      
      startTimeRef.current = exactContextTime - playTrigger.offset;
      
      cancelAnimationFrame(animationFrameRef.current);
      updateTime();
      setLoadStatus('REPRODUCIENDO ENSAYO');
    }
  }, [playTrigger]);

  useEffect(() => {
    if (pauseTrigger) {
      try { cueSourceRef.current?.stop(); } catch (e) {}
      try { fohSourceRef.current?.stop(); } catch (e) {}
      cancelAnimationFrame(animationFrameRef.current);
      setLoadStatus('Pausado');
    }
  }, [pauseTrigger]);

  useEffect(() => {
    if (seekTrigger) {
      setCurrentTime(seekTrigger.offset);
    }
  }, [seekTrigger]);

  const updateTime = () => {
    if (!audioCtx) return;
    
    const globalTime = audioCtx.currentTime - startTimeRef.current;
    const preRoll = getPreRoll(songData);
    const visualTime = globalTime - preRoll;
    
    setCurrentTime(visualTime);
    animationFrameRef.current = requestAnimationFrame(updateTime);
  };

  // Exact match with LiveConcert.tsx & useAudioEngine.ts 16s cap
  const getPreRoll = (song: any) => {
    if (!song?.prompter_data?.bpm) return 0;
    const beatsPerMeasure = parseInt(song.prompter_data.timeSignature?.split('/')[0]) || 4;
    return Math.min((60 / song.prompter_data.bpm) * beatsPerMeasure * 2, 16);
  };

  if (!hasInteracted) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#07090e] text-white p-6">
        <div className="p-4 bg-red-600/20 border border-red-500/40 rounded-2xl mb-6 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
          <Headphones size={48} className="text-red-500" />
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.25em] px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 mb-3">
          Exclusivo para Prácticas y Ensayos (Wi-Fi)
        </span>
        <h1 className="text-3xl font-black tracking-wider mb-2 text-center">IN-EAR MÓVIL</h1>
        <p className="text-zinc-400 mb-10 text-center max-w-xs text-sm leading-relaxed">
          Monitoreo personal inalámbrico de Click, Voz Guía, Acordes y Letras para sesiones de práctica.
        </p>
        <button 
          onClick={handleConnect}
          className="bg-red-600 hover:bg-red-500 text-white font-black py-4 px-12 rounded-full text-lg flex items-center shadow-[0_0_40px_rgba(239,68,68,0.4)] transition-all uppercase tracking-wider"
        >
          <Power className="mr-3" size={20} />
          CONECTAR AL ENSAYO
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#07090e] text-white relative">
      
      {/* Top Header */}
      <div className="flex items-center justify-between p-3 bg-[#0c0e14] border-b border-white/[0.08] z-20">
        <div className="flex items-center space-x-3 w-1/3">
          <div className="p-2 bg-red-500/15 border border-red-500/30 rounded-lg shrink-0">
            <Activity size={18} className="text-red-400" />
          </div>
          <div className="overflow-hidden">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                MODO PRÁCTICA
              </span>
              <h2 className="font-bold text-xs leading-tight truncate">
                {songData ? songData.title : 'Esperando Master...'}
              </h2>
            </div>
            <div className="text-[9px] uppercase font-bold tracking-widest text-zinc-500 truncate mt-0.5">
              {loadStatus}
            </div>
          </div>
        </div>
        
        {/* Personal Mixer */}
        <div className="flex flex-col space-y-2 w-2/3 max-w-[220px] bg-[#07090e] p-2.5 rounded-lg border border-white/[0.07]">
          {/* CUE Volume */}
          <div className="flex items-center space-x-2">
            <Volume2 size={12} className="text-amber-400 shrink-0" />
            <span className="text-[9px] font-black text-zinc-300 w-14 shrink-0">CLIC/GUÍA</span>
            <input 
              type="range" 
              min="0" max="1" step="0.05"
              value={cueVolume}
              onChange={e => setCueVolume(parseFloat(e.target.value))}
              className="w-full accent-amber-400 h-1"
            />
          </div>
          {/* FOH (Band) Volume */}
          <div className="flex items-center space-x-2">
            <Music size={12} className="text-red-400 shrink-0" />
            <span className="text-[9px] font-black text-zinc-300 w-14 shrink-0">PISTAS</span>
            <input 
              type="range" 
              min="0" max="1" step="0.05"
              value={bandVolume}
              onChange={e => setBandVolume(parseFloat(e.target.value))}
              className="w-full accent-red-500 h-1"
            />
          </div>
        </div>
      </div>

      {/* Prompter Visual Area */}
      <div className="flex-1 relative overflow-hidden">
        {songData ? (
          <Prompter 
            currentTime={currentTime}
            bpm={songData.prompter_data?.bpm || 0}
            timeSignature={songData.prompter_data?.timeSignature}
            baseOffset={songData.prompter_data?.firstBeatOffset}
            beatTimes={songData.prompter_data?.beatTimes}
            chords={songData.prompter_data?.chords || []}
            sections={songData.prompter_data?.sections || []}
            lyrics={songData.prompter_data?.lyrics || []}
            isVamping={false}
            isEditing={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
            <Headphones size={200} />
          </div>
        )}
        
        {!isPlaying && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-[4px] z-30">
            <div className="flex flex-col items-center">
              <Activity size={32} className="text-zinc-500 mb-2 animate-pulse" />
              <p className="text-xl font-black tracking-[0.3em] text-white/60">STANDBY ENSAYO</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
