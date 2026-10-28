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

// Mapear estilos sólidos de alta visibilidad para músicos y cantantes (Solid DAW Pro Style)
export interface SectionSolidStyle {
  bg: string;
  border: string;
  text: string;
  name: string;
  emoji: string;
}

export const getSectionSolidStyle = (name: string): SectionSolidStyle => {
  const lower = (name || '').toLowerCase();
  if (lower.includes('intro')) {
    return {
      bg: 'bg-indigo-600',
      border: 'border-indigo-700',
      text: 'text-white',
      name: 'INTRO',
      emoji: '🔊',
    };
  }
  if (lower.includes('verso') || lower.includes('verse')) {
    return {
      bg: 'bg-sky-600',
      border: 'border-sky-700',
      text: 'text-white',
      name: 'VERSO',
      emoji: '🎙️',
    };
  }
  if (lower.includes('pre-coro') || lower.includes('precoro') || lower.includes('pre chorus') || lower.includes('prechorus')) {
    return {
      bg: 'bg-amber-600',
      border: 'border-amber-700',
      text: 'text-white',
      name: 'PRE-CORO',
      emoji: '⚡',
    };
  }
  if (lower.includes('coro') || lower.includes('chorus')) {
    return {
      bg: 'bg-rose-600',
      border: 'border-rose-700',
      text: 'text-white',
      name: 'CORO',
      emoji: '🔥',
    };
  }
  if (lower.includes('puente') || lower.includes('bridge')) {
    return {
      bg: 'bg-purple-600',
      border: 'border-purple-700',
      text: 'text-white',
      name: 'PUENTE',
      emoji: '🌉',
    };
  }
  if (lower.includes('solo') || lower.includes('inter') || lower.includes('instr')) {
    return {
      bg: 'bg-emerald-600',
      border: 'border-emerald-700',
      text: 'text-white',
      name: 'SOLO / INSTR',
      emoji: '🎸',
    };
  }
  if (lower.includes('final') || lower.includes('outro') || lower.includes('coda')) {
    return {
      bg: 'bg-zinc-800',
      border: 'border-zinc-900',
      text: 'text-white',
      name: 'FINAL',
      emoji: '🏁',
    };
  }
  return {
    bg: 'bg-slate-700',
    border: 'border-slate-800',
    text: 'text-white',
    name: (name || 'SECCIÓN').toUpperCase(),
    emoji: '🎵',
  };
};

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
    const isPreRoll = rel < 0;
    // En pre-roll de 2 compases: totalBeats < -beatsPerBar es Compás 1 (-2), totalBeats >= -beatsPerBar es Compás 2 (-1)
    const preRollBarIndex = totalBeats < -beatsPerBar ? 1 : 2;
    return { beatInBar, barNumber, isPreRoll, preRollBarIndex };
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
    <div className="prompter-container bg-white text-zinc-900 p-0 rounded-2xl overflow-hidden h-full w-full relative border border-zinc-200 select-none">
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 bg-white border-b border-zinc-200 px-6 py-3 z-20 flex justify-between items-center pointer-events-none">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#e11d48]" />
              <h2 className="text-base font-bold text-black uppercase tracking-[0.14em] leading-none">
                {currentTime < 0 ? (currentBeatInfo.preRollBarIndex === 1 ? 'CONTEO PRE-ROLL (TEMPO)' : 'CONTEO PRE-ROLL (VOZ GUÍA)') : activeSection ? (activeSection.name || activeSection.section) : 'EN ESPERA'}
              </h2>
            </div>
            <p className="text-[10px] text-zinc-500 font-mono mt-1.5 uppercase tracking-wider pl-4">
              GRILLA DE COMPASES, ACORDES Y VOZ GUÍA {onEditChord ? '• DOBLE CLIC EN UN ACORDE PARA EDITAR' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 pointer-events-auto">
          {/* Indicador de Pulso del Compás en Tiempo Real (Fondo Blanco) */}
          <div className="apple-glass-island flex items-center gap-1.5 p-1 px-3 rounded-full bg-zinc-100 border border-zinc-200">
            <span className="text-[10px] font-mono font-semibold text-zinc-700 uppercase mr-1 tracking-wider tabular-nums">
              {currentTime < 0 ? `PRE ${currentBeatInfo.preRollBarIndex}/2` : `COMPÁS ${Math.max(1, currentBeatInfo.barNumber)}`}
            </span>
            {Array.from({ length: beatsPerBar }).map((_, bIdx) => {
              const beatNum = bIdx + 1;
              const isCurrentBeat = currentBeatInfo.beatInBar === beatNum;
              return (
                <div
                  key={beatNum}
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono font-bold transition-all tabular-nums ${
                    isCurrentBeat
                      ? beatNum === 1
                        ? 'ruby-pill-accent text-white scale-110 font-bold'
                        : 'bg-black text-white scale-105 font-bold'
                      : 'bg-white text-zinc-700 border border-zinc-300 font-semibold'
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
              className={`px-3.5 py-1.5 rounded-full font-semibold text-[11px] uppercase tracking-wide transition-all ${
                isVamping
                  ? 'ruby-pill-accent text-white'
                  : 'apple-glass-card text-zinc-800 hover:text-black hover:bg-zinc-100'
              }`}
              title="Repetir en bucle la sección actual (Vamp Loop)"
            >
              {isVamping ? '🔁 VAMP ACTIVO' : '🔁 VAMP SECCIÓN'}
            </button>
          )}
        </div>

        {/* Cheat Sheet Flotante (Solo Edición) */}
        {isEditing && (
          <div className="apple-glass-island absolute bottom-4 left-1/2 transform -translate-x-1/2 border border-zinc-300 bg-white rounded-full px-5 py-2 z-50 flex space-x-5 items-center pointer-events-auto shadow-md">
            <div className="text-[#e11d48] font-bold text-[11px] uppercase tracking-widest flex items-center shrink-0">
              <span className="w-2 h-2 bg-[#e11d48] rounded-full animate-pulse mr-2" />
              Voz Guía Al Vuelo
            </div>
            <div className="flex space-x-2.5 text-[10px] text-zinc-700 font-mono">
              <div><span className="bg-zinc-100 text-black px-2 py-0.5 rounded-full border border-zinc-300 font-bold">I</span> Intro</div>
              <div><span className="bg-zinc-100 text-black px-2 py-0.5 rounded-full border border-zinc-300 font-bold">V</span> Verso</div>
              <div><span className="bg-zinc-100 text-black px-2 py-0.5 rounded-full border border-zinc-300 font-bold">P</span> Pre-Coro</div>
              <div><span className="bg-zinc-100 text-black px-2 py-0.5 rounded-full border border-zinc-300 font-bold">C</span> Coro</div>
              <div><span className="bg-zinc-100 text-black px-2 py-0.5 rounded-full border border-zinc-300 font-bold">B</span> Puente</div>
              <div><span className="bg-zinc-100 text-black px-2 py-0.5 rounded-full border border-zinc-300 font-bold">S</span> Solo</div>
              <div><span className="bg-zinc-100 text-black px-2 py-0.5 rounded-full border border-zinc-300 font-bold">F</span> Final</div>
            </div>
          </div>
        )}
      </div>

      {/* Modal / Popover de Edición Rápida de Acorde */}
      {editingChordIdx !== null && (
        <div className="apple-glass-card absolute top-16 left-36 z-50 border border-amber-500/40 rounded-2xl p-4 shadow-[0_24px_60px_rgba(0,0,0,0.95)] w-84 pointer-events-auto backdrop-blur-2xl">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-400">
              Editar Acorde #{editingChordIdx + 1}
            </span>
            <button
              type="button"
              onClick={() => setEditingChordIdx(null)}
              className="w-6 h-6 rounded-full bg-white/[0.06] hover:bg-white/15 text-zinc-400 hover:text-white text-xs font-bold flex items-center justify-center transition-colors"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={editingChordValue}
              onChange={(e) => setEditingChordValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitChordEdit();
                if (e.key === 'Escape') setEditingChordIdx(null);
              }}
              autoFocus
              className="flex-1 bg-black/40 border border-white/15 focus:border-amber-400/80 rounded-xl px-3 py-1.5 text-lg font-bold text-white outline-none"
              placeholder="Ej. Cm7, G/B..."
            />
            <button
              type="button"
              onClick={commitChordEdit}
              className="px-3.5 py-2 rounded-full amber-pill-accent text-zinc-950 font-bold text-xs uppercase tracking-wider"
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
                className="px-2.5 py-2 rounded-full bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/40 font-bold text-xs transition-colors"
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
                  className="py-1 rounded-lg bg-white/[0.04] hover:bg-white/15 border border-white/[0.06] text-[11px] font-semibold text-zinc-200 transition-colors"
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
                    className="py-1 rounded-lg bg-white/[0.03] hover:bg-amber-500/20 hover:border-amber-400/40 border border-white/[0.04] text-[10px] font-mono text-zinc-300 transition-colors"
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
        <div
          className="absolute inset-0 z-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(90deg, #333 1px, transparent 1px), linear-gradient(90deg, #666 2px, transparent 2px)`,
            backgroundSize: `${PIXELS_PER_BEAT}px 100%, ${PIXELS_PER_BEAT * beatsPerBar}px 100%`,
            backgroundPosition: `calc(120px - ${(currentTime * pixelsPerSecond) - ((baseOffset !== undefined ? baseOffset : (chords.length > 0 ? chords[0].time : 0)) + (gridOffset || 0)) * pixelsPerSecond}px) 0`,
          }}
        />
      ) : (
        <div className="absolute inset-0 z-0 opacity-30">
          {beatTimes.filter(t => t >= currentTime - 5 && t <= currentTime + 15).map((time, i) => {
            const isDownbeat = beatTimes.indexOf(time) % beatsPerBar === 0;
            const adjustedTime = time + (gridOffset || 0);
            return (
              <div
                key={`beat-${i}`}
                className={`absolute top-0 bottom-0 ${isDownbeat ? 'bg-zinc-300 w-[2px]' : 'bg-zinc-200 w-[1px]'}`}
                style={{
                  left: `calc(120px + ${(adjustedTime - currentTime) * pixelsPerSecond}px)`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* BPM & Time Signature Indicator */}
      <div className="absolute bottom-3 left-4 z-40 flex items-center gap-2">
        {bpm && (
          <div className="bg-white border border-zinc-300 text-zinc-800 px-3.5 py-1 rounded-full text-xs font-mono font-medium flex items-center tabular-nums shadow-sm">
            <div className="w-2 h-2 bg-[#f59e0b] rounded-full mr-2" />
            BPM: {Math.round(bpm)} &bull; {timeSignature}
          </div>
        )}
      </div>

      {/* Scrolling Content (Horizontal) */}
      <div className="relative h-full w-full flex items-center">
        {/* Playhead Line (Fixed) - Sólido de Alta Precisión */}
        <div className="absolute top-0 bottom-0 w-[2px] bg-[#e11d48] z-30" style={{ left: '120px' }}>
          <div className="absolute -top-2 -left-[5px] w-3 h-3 bg-[#e11d48] rounded-full border border-white" />
          <div className="absolute -bottom-2 -left-[5px] w-3 h-3 bg-[#e11d48] rounded-full border border-white" />
        </div>

        {/* Tracks Container */}
        <div ref={containerRef} className="absolute left-0 h-72 flex flex-col justify-center gap-2.5 transition-transform duration-75 ease-linear z-10 will-change-transform">
          {/* Carril 1: Secciones y Voz Guía (Colores Sólidos de Alta Visibilidad Pro) */}
          <div className="relative h-11 w-full mt-5">
            {sectionBlocks.map((block, i) => {
              const isActive = currentTime >= block.time && currentTime < block.time + block.duration;
              const isPast = currentTime >= block.time + block.duration;
              const secStyle = getSectionSolidStyle(block.name || block.section || "");
              const widthPx = Math.max(block.duration * pixelsPerSecond - 4, 38);

              return (
                <div
                  key={`sec-${i}`}
                  onClick={() => onSeek && onSeek(block.time)}
                  className={`absolute h-full flex items-center justify-between px-3.5 border ${secStyle.bg} ${secStyle.border} ${secStyle.text} ${
                    isActive
                      ? 'ring-2 ring-black shadow-md z-30 font-black scale-[1.01]'
                      : isPast
                      ? 'opacity-40 z-10 grayscale-[30%]'
                      : 'opacity-100 z-10 shadow-xs hover:brightness-105'
                  } transition-all cursor-pointer rounded-xl select-none`}
                  style={{
                    left: `${block.time * pixelsPerSecond}px`,
                    width: `${widthPx}px`,
                  }}
                  title={`Sección Voz Guía: ${block.name || block.section} (${Math.floor(block.time / 60)}:${String(Math.floor(block.time % 60)).padStart(2, '0')})`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs shrink-0 drop-shadow-xs">{secStyle.emoji}</span>
                    <span className="text-xs font-black uppercase tracking-wider truncate drop-shadow-xs">
                      {block.name || block.section}
                    </span>
                    {isActive && (
                      <span className="px-1.5 py-0.5 rounded bg-white text-black text-[9px] font-black uppercase tracking-widest shrink-0 shadow-xs">
                        EN VIVO
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className="text-[10px] font-mono font-bold opacity-90 tabular-nums">
                      {Math.floor(block.time / 60)}:{String(Math.floor(block.time % 60)).padStart(2, '0')}
                    </span>
                    {isEditing && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveSection && onRemoveSection(i); }}
                        className="bg-black/60 text-white w-5 h-5 flex items-center justify-center rounded-full hover:bg-rose-500 hover:scale-110 transition z-50 shrink-0 ml-1 shadow-lg text-xs"
                      >
                        ✕
                      </button>
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
                  className={`absolute h-full flex flex-col justify-center ${
                    block.isActive
                      ? 'border-l-4 border-amber-500 bg-amber-50 z-20 shadow-sm'
                      : isPast
                      ? 'border-l-2 border-zinc-200 bg-zinc-100 opacity-60'
                      : 'border-l-2 border-zinc-300 bg-white hover:bg-zinc-50 shadow-sm'
                  } transition-all duration-150 cursor-pointer rounded-r-xl`}
                  style={{
                    left: `${block.time * pixelsPerSecond}px`,
                    width: `${Math.max(block.duration * pixelsPerSecond - 2, 24)}px`,
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
                    <span
                      className={`${lyricBlocks.length > 0 ? 'text-3xl' : 'text-4xl'} font-bold block tracking-tight ${
                        block.isActive
                          ? 'text-amber-950 font-black'
                          : isPast
                          ? 'text-zinc-400'
                          : 'text-black font-black'
                      } transition-all origin-left truncate`}
                    >
                      {block.chord}
                    </span>
                    <span className="text-[10px] font-mono font-normal text-zinc-500 mt-1 block opacity-85 tabular-nums">
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
                    className={`absolute h-full flex items-center px-3.5 rounded-r-xl border-l-2 transition-all cursor-pointer overflow-hidden ${
                      lb.isActive
                        ? 'bg-rose-50 border-[#e11d48] text-rose-950 font-bold z-20'
                        : isPast
                        ? 'bg-zinc-100 border-zinc-200 text-zinc-400 opacity-50'
                        : 'bg-white border-zinc-300 text-zinc-800 hover:bg-zinc-50'
                    }`}
                    style={{
                      left: `${lb.time * pixelsPerSecond}px`,
                      width: `${Math.max(lb.duration * pixelsPerSecond - 2, 40)}px`,
                    }}
                    title={lb.text}
                  >
                    <span className="text-xs font-medium truncate">🎤 {lb.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sombra difuminada limpia en los bordes */}
      <div className="absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-white to-transparent z-20 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-28 bg-gradient-to-l from-white to-transparent z-20 pointer-events-none" />
    </div>
  );
};
