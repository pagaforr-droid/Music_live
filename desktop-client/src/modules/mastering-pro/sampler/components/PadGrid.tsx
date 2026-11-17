import React, { useRef, useState } from 'react';
import { Keyboard, Drum, Trash2, Copy, Volume2, Upload } from 'lucide-react';
import type { SamplePad, SampleRegion } from '../types/sampler.types';
import { midiNoteToName } from '../engine/PitchDetector';

interface PadGridProps {
  pads: SamplePad[];
  regions: SampleRegion[];
  selectedPadIndex: number;
  activePadSet: Set<number>;
  chromaticMode: boolean;
  chromaticBaseMidi: number;
  onSelectPad: (index: number) => void;
  onTriggerPad: (index: number, vel?: number) => void;
  onReleasePad: (index: number) => void;
  onToggleChromaticMode: () => void;
  onChangeChromaticOctave: (deltaSemis: number) => void;
  onPlayChromaticNote: (midiNote: number) => void;
  onReleaseChromaticNote: () => void;
  onDropRegionOnPad: (regionId: string, padIndex: number) => void;
  onUploadFileToPad?: (file: File, padIndex: number) => void;
  onClearPad: (padIndex: number) => void;
  onCopyPadToNext: (padIndex: number) => void;
  onSendPadToMasteringDrum: (padIndex: number, type: 'kick' | 'snare') => void;
}

const CHROMATIC_NOTES = Array.from({ length: 17 }, (_, i) => i);
const IS_BLACK_KEY = (semi: number) => [1, 3, 6, 8, 10].includes(semi % 12);

export const PadGrid: React.FC<PadGridProps> = ({
  pads,
  regions,
  selectedPadIndex,
  activePadSet,
  chromaticMode,
  chromaticBaseMidi,
  onSelectPad,
  onTriggerPad,
  onReleasePad,
  onToggleChromaticMode,
  onChangeChromaticOctave,
  onPlayChromaticNote,
  onReleaseChromaticNote,
  onDropRegionOnPad,
  onUploadFileToPad,
  onClearPad,
  onCopyPadToNext,
  onSendPadToMasteringDrum,
}) => {
  const [contextMenuPad, setContextMenuPad] = useState<number | null>(null);
  const [dragPadIndex, setDragPadIndex] = useState<number | null>(null);
  const padFileInputRef = useRef<HTMLInputElement | null>(null);
  const targetPadRef = useRef<number>(selectedPadIndex);

  return (
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 p-3.5 shadow-[0_14px_40px_rgba(0,0,0,0.65)] flex flex-col gap-3">
      <input
        ref={padFileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && onUploadFileToPad) {
            onUploadFileToPad(f, targetPadRef.current);
          }
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Volume2 size={15} className="text-[#FF6B00]" />
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
            Banco de 16 Pads (QWERTY / MIDI)
          </h3>
        </div>

        <div className="flex items-center gap-1.5">
          {onUploadFileToPad && (
            <button
              type="button"
              onClick={() => {
                targetPadRef.current = selectedPadIndex;
                padFileInputRef.current?.click();
              }}
              className="px-2.5 py-1 rounded-lg bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 border border-[#00E5FF]/50 text-[#00E5FF] text-[11px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-all"
              title={`Subir audio propio directamente al Pad ${selectedPadIndex + 1}`}
            >
              <Upload size={12} />
              <span>Subir Audio al Pad {selectedPadIndex + 1}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleChromaticMode}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-all ${
              chromaticMode
                ? 'bg-[#00E5FF] text-slate-950 border-[#00E5FF]'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-[#00E5FF]/50'
            }`}
          >
            <Keyboard size={12} />
            <span>{chromaticMode ? 'Modo Cromático ON' : 'Modo Cromático'}</span>
          </button>
        </div>
      </div>

      {/* 4x4 Pad Matrix */}
      <div className="grid grid-cols-4 gap-2">
        {pads.map((pad) => {
          const isSelected = pad.index === selectedPadIndex;
          const isActive = activePadSet.has(pad.index);
          const isDragTarget = dragPadIndex === pad.index;
          const reg = pad.regionId
            ? regions.find((r) => r.id === pad.regionId)
            : undefined;
          const durStr = reg ? `${(reg.endSec - reg.startSec).toFixed(2)}s` : 'Vacío';

          return (
            <div key={pad.index} className="relative">
              <button
                type="button"
                role="button"
                aria-label={`Pad ${pad.index + 1}: ${pad.label}`}
                aria-pressed={isActive}
                onMouseDown={() => {
                  onSelectPad(pad.index);
                  onTriggerPad(pad.index, 0.92);
                }}
                onMouseUp={() => onReleasePad(pad.index)}
                onMouseLeave={() => {
                  if (isActive && pad.params.playMode === 'gate') {
                    onReleasePad(pad.index);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelectPad(pad.index);
                  setContextMenuPad(contextMenuPad === pad.index ? null : pad.index);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragPadIndex(pad.index);
                }}
                onDragLeave={() => setDragPadIndex(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragPadIndex(null);
                  const file = e.dataTransfer.files?.[0];
                  if (file && onUploadFileToPad) {
                    onUploadFileToPad(file, pad.index);
                    return;
                  }
                  const regionId = e.dataTransfer.getData('text/sampler-region-id');
                  if (regionId) onDropRegionOnPad(regionId, pad.index);
                }}
                style={{
                  borderColor: isDragTarget
                    ? '#00E5FF'
                    : isSelected
                    ? pad.colorHex
                    : isActive
                    ? '#FFFFFF'
                    : undefined,
                  boxShadow: isActive
                    ? `0 0 22px ${pad.colorHex}80`
                    : isSelected
                    ? `0 0 12px ${pad.colorHex}35`
                    : undefined,
                }}
                className={`w-full h-20 rounded-xl border p-2 flex flex-col justify-between text-left transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[#00E5FF] ${
                  reg
                    ? 'bg-slate-950/95 border-slate-700 hover:bg-slate-900'
                    : 'bg-slate-950/50 border-slate-800/70 opacity-65 hover:opacity-90'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span
                    className="text-[10px] font-mono font-extrabold px-1.5 py-0.5 rounded text-slate-950"
                    style={{ backgroundColor: pad.colorHex }}
                  >
                    {pad.keyboardKey}
                  </span>
                  <span className="text-[9px] font-mono text-slate-400">
                    M{pad.midiNote}
                  </span>
                </div>

                <div className="truncate text-[11px] font-bold text-white leading-tight">
                  {pad.label}
                </div>

                <div className="flex items-center justify-between text-[9px] font-mono text-slate-400">
                  <span>{durStr}</span>
                  <span>
                    {pad.params.playMode === 'loop'
                      ? 'LOOP'
                      : pad.params.playMode === 'gate'
                      ? 'GATE'
                      : '1-SHOT'}
                  </span>
                </div>
              </button>

              {contextMenuPad === pad.index && (
                <div className="absolute z-30 top-full left-0 mt-1 w-52 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 flex flex-col gap-1 text-[11px] font-mono">
                  {onUploadFileToPad && (
                    <button
                      type="button"
                      onClick={() => {
                        targetPadRef.current = pad.index;
                        padFileInputRef.current?.click();
                        setContextMenuPad(null);
                      }}
                      className="px-2 py-1 rounded hover:bg-slate-800 text-left text-[#00E5FF] font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload size={11} />
                      Subir Audio a este Pad
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onCopyPadToNext(pad.index);
                      setContextMenuPad(null);
                    }}
                    className="px-2 py-1 rounded hover:bg-slate-800 text-left text-slate-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy size={11} className="text-[#00E5FF]" />
                    Duplicar al siguiente Pad
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSendPadToMasteringDrum(pad.index, 'kick');
                      setContextMenuPad(null);
                    }}
                    className="px-2 py-1 rounded hover:bg-slate-800 text-left text-[#FF6B00] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Drum size={11} />
                    Enviar como Kick a Mastering
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSendPadToMasteringDrum(pad.index, 'snare');
                      setContextMenuPad(null);
                    }}
                    className="px-2 py-1 rounded hover:bg-slate-800 text-left text-[#00E5FF] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Drum size={11} />
                    Enviar como Snare a Mastering
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClearPad(pad.index);
                      setContextMenuPad(null);
                    }}
                    className="px-2 py-1 rounded hover:bg-rose-500/20 text-left text-rose-400 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 size={11} />
                    Limpiar Pad
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Chromatic Keyboard Strip */}
      {chromaticMode && (
        <div className="rounded-xl bg-slate-950 border border-[#00E5FF]/40 p-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-[#00E5FF] font-bold">
              TECLADO CROMÁTICO · Pad {selectedPadIndex + 1} (Base:{' '}
              {midiNoteToName(chromaticBaseMidi)})
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onChangeChromaticOctave(-12)}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                -8va
              </button>
              <button
                type="button"
                onClick={() => onChangeChromaticOctave(12)}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                +8va
              </button>
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto studio-scrollbar-thin pb-1.5">
            {CHROMATIC_NOTES.map((semi) => {
              const midi = Math.max(0, Math.min(127, chromaticBaseMidi + semi));
              const black = IS_BLACK_KEY(semi);
              return (
                <button
                  key={midi}
                  type="button"
                  onMouseDown={() => onPlayChromaticNote(midi)}
                  onMouseUp={onReleaseChromaticNote}
                  className={`min-w-[30px] h-14 rounded-lg border text-[10px] font-mono font-bold flex flex-col justify-end items-center pb-1.5 cursor-pointer transition-transform active:scale-95 ${
                    black
                      ? 'bg-slate-800 border-slate-600 text-[#00E5FF]'
                      : 'bg-slate-100 border-slate-300 text-slate-950'
                  }`}
                >
                  {midiNoteToName(midi)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
