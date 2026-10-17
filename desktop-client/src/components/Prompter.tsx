import React, { useEffect, useRef, useMemo, useState } from 'react';

export interface ChordEvent {
  chord: string;
  time: number;
}

export interface SectionEvent {
  name?: string;
  section?: string;
  time: number;
}

export interface LyricCueItem {
  id?: string;
  time: number;
  duration?: number;
  text: string;
}

export interface PrompterProps {
  currentTime: number;
  bpm?: number;
  timeSignature?: string;
  baseOffset?: number;
  beatTimes?: number[];
  chords: ChordEvent[];
  sections: SectionEvent[];
  lyrics?: LyricCueItem[];
  isVamping: boolean;
  gridOffset?: number;
  onVampTrigger?: (sectionStart: number, sectionEnd: number) => void;
  isEditing?: boolean;
  onRemoveSection?: (index: number) => void;
  onEditChord?: (index: number, newChord: string) => void;
  onRemoveChord?: (index: number) => void;
  onSeek?: (time: number) => void;
}

const PIXELS_PER_BEAT = 150; // Ancho visual de cada golpe (beat)
const QUICK_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const QUICK_QUALITIES = ['', 'm', '7', 'm7', 'maj7', 'sus4', 'add9', 'dim'];

export const Prompter: React.FC<PrompterProps> = ({
  currentTime,
  bpm,
  timeSignature = '4/4',
  baseOffset,
  beatTimes,
  chords,
  sections,
  lyrics = [],
  isVamping,
  gridOffset,
  onVampTrigger,
  isEditing,
  onRemoveSection,
  onEditChord,
  onRemoveChord,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editingChordIdx, setEditingChordIdx] = useState<number | null>(null);
  const [editingChordValue, setEditingChordValue] = useState<string>('');

  // Mapear colores según el nombre de la sección
  const getSectionColor = (name: string) => {
    const lower = (name || '').toLowerCase();
    if (lower.includes('intro')) return 'bg-pink-500 border-pink-300 text-black';
    if (lower.includes('verso') || lower.includes('verse')) return 'bg-orange-500 border-orange-300 text-black';
    if (lower.includes('pre-coro') || lower.includes('precoro')) return 'bg-yellow-400 border-yellow-200 text-black';
    if (lower.includes('coro') || lower.includes('chorus')) return 'bg-blue-600 border-blue-400 text-white';
    if (lower.includes('puente') || lower.includes('bridge')) return 'bg-purple-600 border-purple-400 text-white';
    if (lower.includes('solo') || lower.includes('inter')) return 'bg-emerald-500 border-emerald-300 text-black';
    if (lower.includes('final') || lower.includes('outro')) return 'bg-red-600 border-red-400 text-white';
    return 'bg-zinc-600 border-zinc-400 text-white';
  };

  // Convertir sections a sectionBlocks con duración
  const sectionBlocks = (sections || []).map((sec, i, arr) => {
    const nextTime = arr[i + 1]?.time || (sec.time + 16);
    return {
      ...sec,
      duration: Math.max(nextTime - sec.time, 0.5)
    };
  });

  // Calculate pixel positions based on zoom basado en el BPM. Si no hay BPM, usa 120 por defecto.
  const activeBpm = bpm && bpm > 0 ? bpm : 120;
  const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4;
  const beatsPerSecond = activeBpm / 60;
  const pixelsPerSecond = beatsPerSecond * PIXELS_PER_BEAT;
  const scrollPosition = currentTime * pixelsPerSecond;

  // Calcular compás y pulso actual para indicador visual de compás
  const currentBeatInfo = useMemo(() => {
    const effOffset = (baseOffset || 0) + (gridOffset || 0);
    const beatDur = 60 / activeBpm;
    const rel = currentTime - effOffset;
    const totalBeats = Math.floor(rel / beatDur);
    const beatInBar = (((totalBeats % beatsPerBar) + beatsPerBar) % beatsPerBar) + 1;
    const barNumber = Math.floor(totalBeats / beatsPerBar) + 1;
    return { beatInBar, barNumber };
  }, [currentTime, baseOffset, gridOffset, activeBpm, beatsPerBar]);

  // Auto-scroll logic horizontal based on currentTime
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.transform = `translateX(calc(120px - ${scrollPosition}px))`;
    }
  }, [currentTime, pixelsPerSecond, scrollPosition]);

  // Find active section
  let activeSectionIndex = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].time <= currentTime) {
      activeSectionIndex = i;
      break;
    }
  }
  const activeSection = activeSectionIndex >= 0 ? sections[activeSectionIndex] : null;

  // Enhance chords with duration and AUTO-QUANTIZE for block rendering
  const chordBlocks = useMemo(() => {
    const useRealGrid = beatTimes && beatTimes.length > 1;
    const defaultOffset = chords.length > 0 ? chords[0].time : 0;
    const baseOffsetTime = baseOffset !== undefined ? baseOffset : defaultOffset;
    const gridOffsetTime = baseOffsetTime + (gridOffset || 0);
    const beatDuration = activeBpm > 0 ? 60 / activeBpm : 0.5;
    const eighthNoteDuration = beatDuration / 2;

    let eighthGrid: number[] = [];
    if (useRealGrid) {
      eighthGrid = [];
      for (let i = 0; i < beatTimes.length - 1; i++) {
        eighthGrid.push(beatTimes[i]);
        eighthGrid.push((beatTimes[i] + beatTimes[i + 1]) / 2);
      }
      eighthGrid.push(beatTimes[beatTimes.length - 1]);
    } else {
      for (let i = -16; i < 2000; i++) {
        eighthGrid.push(gridOffsetTime + i * eighthNoteDuration);
        eighthGrid.push(gridOffsetTime + (i + 0.5) * eighthNoteDuration);
      }
    }

    const quantizedChords = chords.map((chord, originalIndex) => {
      let qTime = chord.time;
      if (useRealGrid && eighthGrid.length > 0) {
        let closest = eighthGrid[0];
        let minDiff = Math.abs(closest - chord.time);
        for (let i = 1; i < eighthGrid.length; i++) {
          const diff = Math.abs(eighthGrid[i] - chord.time);
          if (diff < minDiff) {
            minDiff = diff;
            closest = eighthGrid[i];
          }
        }
        if (minDiff < 0.25) {
          qTime = closest;
        }
      } else {
        if (activeBpm > 0 && chord.time !== gridOffsetTime) {
          const timeFromOffset = chord.time - gridOffsetTime;
          const eighthNotes = Math.round(timeFromOffset / eighthNoteDuration);
          const snappedTime = gridOffsetTime + (eighthNotes * eighthNoteDuration);
          if (Math.abs(snappedTime - chord.time) < 0.25) {
            qTime = snappedTime;
          }
        }
      }
      return { ...chord, time: qTime, originalIndex };
    });

    return quantizedChords.map((chord, index) => {
      const nextChord = quantizedChords[index + 1];
      const duration = nextChord ? Math.max(0.1, nextChord.time - chord.time) : 10;
      return {
        ...chord,
        duration,
        isActive: currentTime >= chord.time && currentTime < chord.time + duration
      };
    });
  }, [chords, currentTime, activeBpm, gridOffset, beatTimes, baseOffset]);

  // Preparar cinta de letras sincronizadas
  const lyricBlocks = useMemo(() => {
    if (!lyrics || lyrics.length === 0) return [];
    const sorted = [...lyrics].sort((a, b) => a.time - b.time);
    return sorted.map((line, i) => {
      const next = sorted[i + 1];
      const dur = line.duration && line.duration > 0
        ? line.duration
        : next
        ? Math.max(0.5, Math.min(8, next.time - line.time))
        : 4;
      const isActive = currentTime >= line.time && currentTime < line.time + dur;
      return { ...line, duration: dur, isActive };
    });
  }, [lyrics, currentTime]);

  const handleVamp = () => {
    if (onVampTrigger) {
      if (activeSectionIndex >= 0 && activeSection) {
        const start = activeSection.time;
        const end = sections[activeSectionIndex + 1] ? sections[activeSectionIndex + 1].time : start + (60 / activeBpm) * beatsPerBar * 4;
        onVampTrigger(start, end);
      } else {
        const barLen = (60 / activeBpm) * beatsPerBar * 4;
        onVampTrigger(Math.max(0, currentTime), Math.max(0, currentTime) + barLen);
      }
    }
  };

  const commitChordEdit = () => {
    if (editingChordIdx !== null && editingChordValue.trim()) {
      if (onEditChord) {
        onEditChord(editingChordIdx, editingChordValue.trim());
      }
    }
    setEditingChordIdx(null);
  };

  return (
    <div className="prompter-container bg-[#050609] text-white p-0 rounded-xl overflow-hidden h-full w-full relative border border-white/[0.08] shadow-[inset_0_0_50px_rgba(0,0,0,0.85)] select-none">
      
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-[#0a0c12]/95 via-[#0a0c12]/60 to-transparent p-4 z-20 flex justify-between items-start pointer-events-none">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-amber-400 uppercase tracking-widest drop-shadow-lg leading-none">
              {currentTime < 0 ? 'CONTEO PRE-ROLL' : activeSection ? (activeSection.name || activeSection.section) : 'EN ESPERA'}
            </h2>
            <p className="text-[10px] text-zinc-400 font-mono mt-1 uppercase tracking-wider">
              GRILLA DE COMPASES, ACORDES Y VOZ GUÍA {onEditChord ? '• DOBLE CLIC EN UN ACORDE PARA EDITAR' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Indicador de Pulso del Compás en Tiempo Real */}
          <div className="flex items-center gap-1 bg-[#10131c]/90 border border-white/10 px-2.5 py-1.5 rounded-lg">
            <span className="text-[9px] font-mono text-zinc-400 uppercase mr-1">
              {currentTime < 0 ? 'PRE' : `COMPÁS ${Math.max(1, currentBeatInfo.barNumber)}`}
            </span>
            {Array.from({ length: beatsPerBar }).map((_, bIdx) => {
              const beatNum = bIdx + 1;
              const isCurrentBeat = currentBeatInfo.beatInBar === beatNum;
              return (
                <div
                  key={beatNum}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black font-mono transition-all ${
                    isCurrentBeat
                      ? beatNum === 1
                        ? 'bg-red-600 text-white shadow-[0_0_10px_rgba(239,68,68,0.9)] scale-110'
                        : 'bg-amber-400 text-black shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                      : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                  }`}
                >
                  {beatNum}
                </div>
              );
            })}
          </div>

          {onVampTrigger && (
            <button 
              onClick={handleVamp}
              className={`px-3.5 py-1.5 rounded-lg font-black text-xs uppercase tracking-wider shadow-lg transition border ${
                isVamping
                  ? 'bg-red-600 border-red-400 text-white animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.8)]'
                  : 'bg-[#141824] border-white/10 text-zinc-300 hover:bg-[#1e2436] hover:text-white'
              }`}
              title="Repetir en bucle la sección actual (Vamp Loop)"
            >
              {isVamping ? '🔁 VAMP ACTIVO (SALIR)' : '🔁 VAMP SECCIÓN'}
            </button>
          )}
        </div>

        {/* Cheat Sheet Flotante (Solo Edición) */}
        {isEditing && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-[#0e1118]/95 border border-red-500/50 rounded-xl px-5 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.8)] z-50 flex space-x-5 items-center pointer-events-auto">
             <div className="text-red-400 font-bold text-xs uppercase tracking-widest flex items-center shrink-0">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-2"></span>
                Voz Guía Al Vuelo
             </div>
             <div className="flex space-x-3 text-[10px] text-zinc-300 font-mono">
                <div><span className="bg-zinc-800 text-white px-1.5 py-0.5 rounded border border-zinc-600">I</span> Intro</div>
                <div><span className="bg-zinc-800 text-white px-1.5 py-0.5 rounded border border-zinc-600">V</span> Verso</div>
                <div><span className="bg-zinc-800 text-white px-1.5 py-0.5 rounded border border-zinc-600">P</span> Pre-Coro</div>
                <div><span className="bg-zinc-800 text-white px-1.5 py-0.5 rounded border border-zinc-600">C</span> Coro</div>
                <div><span className="bg-zinc-800 text-white px-1.5 py-0.5 rounded border border-zinc-600">B</span> Puente</div>
                <div><span className="bg-zinc-800 text-white px-1.5 py-0.5 rounded border border-zinc-600">S</span> Solo</div>
                <div><span className="bg-zinc-800 text-white px-1.5 py-0.5 rounded border border-zinc-600">F</span> Final</div>
             </div>
          </div>
        )}
      </div>

      {/* Modal / Popover de Edición Rápida de Acorde */}
      {editingChordIdx !== null && (
        <div className="absolute top-16 left-36 z-50 bg-[#10131c] border border-amber-500/50 rounded-xl p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.9)] w-80 pointer-events-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
              Editar Acorde #{editingChordIdx + 1}
            </span>
            <button
              type="button"
              onClick={() => setEditingChordIdx(null)}
              className="text-zinc-400 hover:text-white text-xs font-bold px-1.5"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 mb-2.5">
            <input
              type="text"
              value={editingChordValue}
              onChange={(e) => setEditingChordValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitChordEdit();
                if (e.key === 'Escape') setEditingChordIdx(null);
              }}
              autoFocus
              className="flex-1 bg-[#07090e] border border-zinc-700 focus:border-amber-400 rounded-lg px-3 py-1.5 text-lg font-black text-white outline-none"
              placeholder="Ej. Cm7, G/B..."
            />
            <button
              type="button"
              onClick={commitChordEdit}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-black text-xs uppercase"
            >
              Guardar
            </button>
            {onRemoveChord && (
              <button
                type="button"
                onClick={() => {
                  onRemoveChord(editingChordIdx);
                  setEditingChordIdx(null);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/40 font-bold text-xs"
                title="Eliminar acorde"
              >
                🗑
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-6 gap-1">
              {QUICK_ROOTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setEditingChordValue(r)}
                  className="py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-bold text-zinc-200"
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {QUICK_QUALITIES.map((q) => {
                const rootMatch = editingChordValue.match(/^[A-G][#b]?/)?.[0] || 'C';
                const target = `${rootMatch}${q}`;
                return (
                  <button
                    key={q || 'maj'}
                    type="button"
                    onClick={() => setEditingChordValue(target)}
                    className="py-1 rounded bg-zinc-900/70 hover:bg-amber-500/20 border border-zinc-800 text-[10px] font-mono text-zinc-300"
                  >
                    {target}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Grid Background (Dinámico vs Estático) */}
      {!beatTimes || beatTimes.length === 0 ? (
        <div className="absolute inset-0 z-0 opacity-20" 
             style={{
               backgroundImage: `linear-gradient(90deg, #333 1px, transparent 1px), linear-gradient(90deg, #666 2px, transparent 2px)`,
               backgroundSize: `${PIXELS_PER_BEAT}px 100%, ${PIXELS_PER_BEAT * beatsPerBar}px 100%`,
               backgroundPosition: `calc(120px - ${(currentTime * pixelsPerSecond) - ((baseOffset !== undefined ? baseOffset : (chords.length > 0 ? chords[0].time : 0)) + (gridOffset || 0)) * pixelsPerSecond}px) 0`,
             }}>
        </div>
      ) : (
        <div className="absolute inset-0 z-0 opacity-30">
          {beatTimes.filter(t => t >= currentTime - 5 && t <= currentTime + 15).map((time, i) => {
            const isDownbeat = beatTimes.indexOf(time) % beatsPerBar === 0;
            const adjustedTime = time + (gridOffset || 0);
            return (
              <div key={`beat-${i}`} 
                   className={`absolute top-0 bottom-0 ${isDownbeat ? 'bg-zinc-500 w-[2px]' : 'bg-zinc-800 w-[1px]'}`}
                   style={{
                     left: `calc(120px + ${(adjustedTime - currentTime) * pixelsPerSecond}px)`
                   }}
              />
            );
          })}
        </div>
      )}

      {/* BPM & Time Signature Indicator */}
      <div className="absolute bottom-3 left-4 z-40 flex items-center gap-2">
        {bpm && (
          <div className="bg-[#0e1118]/90 border border-white/10 text-zinc-300 px-3 py-1 rounded-md text-xs font-mono flex items-center shadow-lg">
            <div className="w-2 h-2 bg-amber-400 rounded-full mr-2 animate-pulse"></div>
            BPM: {Math.round(bpm)} &bull; {timeSignature}
          </div>
        )}
      </div>

      {/* Scrolling Content (Horizontal) */}
      <div className="relative h-full w-full flex items-center">
        
        {/* Playhead Line (Fixed) */}
        <div className="absolute top-0 bottom-0 w-1 bg-amber-400 z-30 shadow-[0_0_15px_rgba(251,191,36,1)]" style={{ left: '120px' }}>
          <div className="absolute -top-2 -left-2 w-5 h-5 bg-amber-400 rounded-full shadow-[0_0_10px_rgba(251,191,36,0.8)]"></div>
          <div className="absolute -bottom-2 -left-2 w-5 h-5 bg-amber-400 rounded-full shadow-[0_0_10px_rgba(251,191,36,0.8)]"></div>
        </div>
        
        {/* Tracks Container */}
        <div ref={containerRef} className="absolute left-0 h-72 flex flex-col justify-center gap-2.5 transition-transform duration-75 ease-linear z-10 will-change-transform">
          
          {/* Carril 1: Secciones y Voz Guía */}
          <div className="relative h-12 w-full mt-6">
            {sectionBlocks.map((block, i) => {
              const isActive = currentTime >= block.time && currentTime < block.time + block.duration;
              const isPast = currentTime >= block.time + block.duration;
              const colorClass = getSectionColor(block.name || block.section || "");
              
              return (
                <div 
                  key={`sec-${i}`}
                  onClick={() => onSeek && onSeek(block.time)}
                  className={`absolute h-full flex flex-col justify-center border-l-4 ${colorClass} ${isActive ? 'brightness-125 shadow-[0_0_20px_rgba(255,255,255,0.35)] z-20' : isPast ? 'opacity-50 z-10' : 'opacity-90 z-10'} transition-all cursor-pointer rounded-r-md hover:brightness-110`}
                  style={{
                    left: `${block.time * pixelsPerSecond}px`,
                    width: `${block.duration * pixelsPerSecond}px`
                  }}
                  title={`Sección Voz Guía: ${block.name || block.section} (${Math.floor(block.time / 60)}:${String(Math.floor(block.time % 60)).padStart(2, '0')})`}
                >
                  <div className="px-3 flex justify-between items-center w-full">
                    <span className={`text-sm font-black uppercase tracking-widest ${isActive ? 'scale-105' : ''} transition-transform origin-left truncate drop-shadow-md`}>
                      🔊 {block.name || block.section}
                    </span>
                    {isEditing && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onRemoveSection && onRemoveSection(i); }}
                        className="bg-black/60 text-white w-5 h-5 flex items-center justify-center rounded-full hover:bg-red-500 hover:scale-110 transition z-50 shrink-0 ml-2 shadow-lg text-xs"
                      >✖</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Carril 2: Acordes Sincronizados a la Grilla */}
          <div className={`relative ${lyricBlocks.length > 0 ? 'h-32' : 'h-40'} w-full flex items-center`}>
            {chordBlocks.map((block, i) => {
              const isPast = currentTime >= block.time + block.duration;
              
              return (
                <div 
                  key={i} 
                  className={`absolute h-full flex flex-col justify-center border-l-2 ${
                    block.isActive
                      ? 'border-amber-400 bg-amber-500/20 shadow-[inset_0_0_30px_rgba(251,191,36,0.2)]'
                      : isPast
                      ? 'border-zinc-800 bg-zinc-900/40'
                      : 'border-zinc-700 bg-[#0e1118]/90'
                  } transition-colors duration-200 cursor-pointer hover:bg-white/10 rounded-r-lg`}
                  style={{ 
                    left: `${block.time * pixelsPerSecond}px`, 
                    width: `${Math.max(block.duration * pixelsPerSecond - 2, 24)}px`
                  }}
                  onDoubleClick={() => {
                    if (onEditChord) {
                      setEditingChordIdx(block.originalIndex);
                      setEditingChordValue(block.chord);
                    } else {
                      const next = prompt(`Editar acorde (${block.chord}):`, block.chord);
                      if (next && next.trim()) {
                        // Fallback si no se pasó handler
                      }
                    }
                  }}
                  title="Doble clic para editar o borrar este acorde"
                >
                  <div className="px-3.5">
                    <span className={`${lyricBlocks.length > 0 ? 'text-4xl' : 'text-5xl'} font-black block ${
                      block.isActive
                        ? 'text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)] scale-105'
                        : isPast
                        ? 'text-zinc-600'
                        : 'text-zinc-200'
                    } transition-all origin-left truncate`}>
                      {block.chord}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500 mt-1 block opacity-60">
                      {Math.floor(block.time / 60)}:{Math.floor(block.time % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Carril 3: Cinta Guía de Letras Sincronizadas (cuando la canción ya tiene letras) */}
          {lyricBlocks.length > 0 && (
            <div className="relative h-10 w-full flex items-center">
              {lyricBlocks.map((lb, idx) => {
                const isPast = currentTime >= lb.time + lb.duration;
                return (
                  <div
                    key={lb.id || `lyr-${idx}`}
                    onClick={() => onSeek && onSeek(lb.time)}
                    className={`absolute h-full flex items-center px-3 rounded-r-md border-l-2 transition-all cursor-pointer overflow-hidden ${
                      lb.isActive
                        ? 'bg-red-600/30 border-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)] z-20'
                        : isPast
                        ? 'bg-zinc-900/40 border-zinc-800 text-zinc-600'
                        : 'bg-[#131722]/90 border-red-500/40 text-zinc-300 hover:bg-[#1a2030]'
                    }`}
                    style={{
                      left: `${lb.time * pixelsPerSecond}px`,
                      width: `${Math.max(lb.duration * pixelsPerSecond - 2, 40)}px`,
                    }}
                    title={lb.text}
                  >
                    <span className="text-xs font-bold truncate">
                      🎤 {lb.text}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>
      
      {/* Sombra difuminada en los bordes para dar efecto de profundidad */}
      <div className="absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-[#050609] to-transparent z-20 pointer-events-none"></div>
      <div className="absolute inset-y-0 right-0 w-28 bg-gradient-to-l from-[#050609] to-transparent z-20 pointer-events-none"></div>
    </div>
  );
};
