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
    <div className="rounded-2xl bg-[#121215] border border-white/[0.08] p-4 flex flex-col gap-3">
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
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Volume2 size={15} className="text-orange-400" />
          <h3 className="text-xs font-semibold tracking-tight text-zinc-100">
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
              className="px-2.5 py-1 rounded-lg bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-zinc-100 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-all"
              title={`Subir audio propio directamente al Pad ${selectedPadIndex + 1}`}
            >
              <Upload size={12} />
              <span>Subir Audio al Pad {selectedPadIndex + 1}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleChromaticMode}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-all ${
              chromaticMode
                ? 'bg-zinc-100 text-zinc-950 border-zinc-100 font-semibold'
                : 'bg-[#0B0B0D] text-zinc-400 border-white/[0.08] hover:text-zinc-100'
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
                    ? '#FAFAFA'
                    : isSelected
                    ? pad.colorHex
                    : isActive
                    ? '#FFFFFF'
                    : undefined,
                  boxShadow: isActive
                    ? `0 0 18px ${pad.colorHex}66`
                    : isSelected
                    ? `0 0 10px ${pad.colorHex}28`
                    : undefined,
                }}
                className={`w-full h-20 rounded-xl border p-2 flex flex-col justify-between text-left transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-white/40 ${
                  reg
                    ? 'bg-[#0C0C0F] border-white/[0.1] hover:bg-[#17171C]'
                    : 'bg-[#0A0A0D] border-white/[0.05] opacity-60 hover:opacity-90'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span
                    className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-zinc-950"
                    style={{ backgroundColor: pad.colorHex }}
                  >
                    {pad.keyboardKey}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500">
                    M{pad.midiNote}
                  </span>
                </div>

                <div className="truncate text-[11px] font-semibold text-zinc-100 leading-tight">
                  {pad.label}
                </div>

                <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500">
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
                <div className="absolute z-30 top-full left-0 mt-1 w-52 rounded-xl bg-[#18181C] border border-white/[0.12] shadow-2xl p-1.5 flex flex-col gap-1 text-[11px]">
                  {onUploadFileToPad && (
                    <button
                      type="button"
                      onClick={() => {
                        targetPadRef.current = pad.index;
                        padFileInputRef.current?.click();
                        setContextMenuPad(null);
                      }}
                      className="px-2 py-1.5 rounded-lg hover:bg-white/[0.08] text-left text-zinc-100 font-medium flex items-center gap-1.5 cursor-pointer"
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
                    className="px-2 py-1.5 rounded-lg hover:bg-white/[0.08] text-left text-zinc-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy size={11} className="text-zinc-400" />
                    Duplicar al siguiente Pad
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSendPadToMasteringDrum(pad.index, 'kick');
                      setContextMenuPad(null);
                    }}
                    className="px-2 py-1.5 rounded-lg hover:bg-white/[0.08] text-left text-orange-300 flex items-center gap-1.5 cursor-pointer"
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
                    className="px-2 py-1.5 rounded-lg hover:bg-white/[0.08] text-left text-cyan-300 flex items-center gap-1.5 cursor-pointer"
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
                    className="px-2 py-1.5 rounded-lg hover:bg-rose-500/15 text-left text-rose-400 flex items-center gap-1.5 cursor-pointer"
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
        <div className="rounded-xl bg-[#0B0B0D] border border-white/[0.1] p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-200 font-medium">
              Teclado Cromático · Pad {selectedPadIndex + 1} (Base:{' '}
              <span className="font-mono text-zinc-100">{midiNoteToName(chromaticBaseMidi)}</span>)
            </span>
            <div className="flex items-center gap-1 font-mono">
              <button
                type="button"
                onClick={() => onChangeChromaticOctave(-12)}
                className="px-2 py-0.5 rounded-md bg-[#18181C] border border-white/[0.08] text-zinc-300 hover:text-white cursor-pointer"
              >
                -8va
              </button>
              <button
                type="button"
                onClick={() => onChangeChromaticOctave(12)}
                className="px-2 py-0.5 rounded-md bg-[#18181C] border border-white/[0.08] text-zinc-300 hover:text-white cursor-pointer"
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
                      ? 'bg-[#1A1A20] border-white/[0.12] text-zinc-200'
                      : 'bg-zinc-200 border-zinc-300 text-zinc-950'
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
