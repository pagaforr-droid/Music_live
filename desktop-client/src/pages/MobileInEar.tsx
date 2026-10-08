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
      // Usar los MP3 ligeros (Modo Ensayo) si existen, si no caer al WAV original
      const cueTarget = songData.cue_mobile_url || songData.cue_mix_url;
      const fohTarget = songData.foh_mobile_url || songData.foh_mix_url;
      loadAudio(cueTarget, fohTarget);
    }
  }, [songData, audioCtx]);

  const loadAudio = async (cueUrl: string, fohUrl: string) => {
    if (!audioCtx) return;
    setLoadStatus('Descargando multitrack...');
    try {
      // Download both files in parallel for speed
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
      
      setLoadStatus('Listo (Standby)');
      setCurrentTime(0);
    } catch (e: any) {
      setLoadStatus('Error: ' + e.message);
    }
  };

  // Handle Transport Triggers
  useEffect(() => {
    if (!audioCtx || !cueBuffer || !fohBuffer || !hasInteracted) return;

    if (playTrigger) {
      // Stop previous sources
      try { cueSourceRef.current?.stop(); } catch (e) {}
      try { fohSourceRef.current?.stop(); } catch (e) {}

      // Create new sources
      const cSource = audioCtx.createBufferSource();
      cSource.buffer = cueBuffer;
      cSource.connect(cueGainRef.current!);
      cueSourceRef.current = cSource;

      const fSource = audioCtx.createBufferSource();
      fSource.buffer = fohBuffer;
      fSource.connect(fohGainRef.current!);
      fohSourceRef.current = fSource;

      // Calculate when to start with NTP clock offset correction!
      const correctedClientTime = Date.now() + clockOffset;
      const timeUntilStartMs = Math.max(0, playTrigger.startAt - correctedClientTime);
      const exactContextTime = audioCtx.currentTime + (timeUntilStartMs / 1000);

      cSource.start(exactContextTime, playTrigger.offset);
      fSource.start(exactContextTime, playTrigger.offset);
      
      startTimeRef.current = exactContextTime - playTrigger.offset;
      
      cancelAnimationFrame(animationFrameRef.current);
      updateTime();
      setLoadStatus('EN VIVO');
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

  const getPreRoll = (song: any) => {
    if (!song?.prompter_data?.bpm) return 0;
    const beatsPerMeasure = parseInt(song.prompter_data.timeSignature?.split('/')[0]) || 4;
    return (60 / song.prompter_data.bpm) * beatsPerMeasure * 2;
  };

  // VIEW RENDERS
  if (!hasInteracted) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a] text-white">
        <div className="p-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-8 shadow-lg shadow-blue-500/20">
          <Headphones size={48} className="text-white" />
        </div>
        <h1 className="text-3xl font-black tracking-wider mb-2 text-center">IN-EAR MÓVIL</h1>
        <p className="text-gray-400 mb-12 text-center max-w-xs leading-relaxed">
          Sistema personal de monitoreo sin latencia.
        </p>
        <button 
          onClick={handleConnect}
          className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-5 px-14 rounded-full text-xl flex items-center shadow-[0_0_40px_rgba(37,99,235,0.4)] transition-all"
        >
          <Power className="mr-3" />
          CONECTAR
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white relative">
      
      {/* Top Header */}
      <div className="flex items-center justify-between p-3 bg-[#111] border-b border-[#222] z-20">
        <div className="flex items-center space-x-3 w-1/3">
          <div className="p-2 bg-blue-500/20 rounded-lg shrink-0">
            <Activity size={18} className="text-blue-400" />
          </div>
          <div className="overflow-hidden">
            <h2 className="font-bold text-xs leading-tight truncate">
              {songData ? songData.title : 'Esperando Master...'}
            </h2>
            <div className="text-[9px] uppercase font-bold tracking-widest text-gray-500 truncate">
              {loadStatus}
            </div>
          </div>
        </div>
        
        {/* Personal Mixer */}
        <div className="flex flex-col space-y-2 w-2/3 max-w-[200px] bg-black/40 p-2 rounded-lg border border-white/5">
          {/* CUE Volume */}
          <div className="flex items-center space-x-2">
            <Volume2 size={12} className="text-blue-400 shrink-0" />
            <span className="text-[10px] font-bold text-gray-400 w-12 shrink-0">CUE</span>
            <input 
              type="range" 
              min="0" max="1" step="0.05"
              value={cueVolume}
              onChange={e => setCueVolume(parseFloat(e.target.value))}
              className="w-full accent-blue-500 h-1"
            />
          </div>
          {/* FOH (Band) Volume */}
          <div className="flex items-center space-x-2">
            <Music size={12} className="text-purple-400 shrink-0" />
            <span className="text-[10px] font-bold text-gray-400 w-12 shrink-0">BANDA</span>
            <input 
              type="range" 
              min="0" max="1" step="0.05"
              value={bandVolume}
              onChange={e => setBandVolume(parseFloat(e.target.value))}
              className="w-full accent-purple-500 h-1"
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
              <Activity size={32} className="text-gray-600 mb-2 animate-pulse" />
              <p className="text-xl font-black tracking-[0.3em] text-white/50">STANDBY</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
