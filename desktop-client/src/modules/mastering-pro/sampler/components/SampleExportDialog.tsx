import React, { useState } from 'react';
import { Download, Archive, Disc, X, ArrowUpRight, Loader2 } from 'lucide-react';
import type { SamplePad, SampleRegion } from '../types/sampler.types';

interface SampleExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPad: SamplePad;
  selectedRegion: SampleRegion | null;
  regionsCount: number;
  onExportSinglePad: (format: 'wav' | 'mp3') => Promise<void>;
  onExportRegion: (format: 'wav' | 'mp3') => Promise<void>;
  onExportSlicesZip: () => Promise<void>;
  onExportPatternBounce: (bars: number, seamlessLoop: boolean, format: 'wav' | 'mp3') => Promise<void>;
  onSendBounceToMastering: (bars: number) => Promise<void>;
}

export const SampleExportDialog: React.FC<SampleExportDialogProps> = ({
  isOpen,
  onClose,
  selectedPad,
  selectedRegion,
  regionsCount,
  onExportSinglePad,
  onExportRegion,
  onExportSlicesZip,
  onExportPatternBounce,
  onSendBounceToMastering,
}) => {
  const [format, setFormat] = useState<'wav' | 'mp3'>('wav');
  const [bounceBars, setBounceBars] = useState<number>(2);
  const [seamlessLoop, setSeamlessLoop] = useState<boolean>(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!isOpen) return null;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error durante la exportación.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-[#121215] border border-white/[0.1] p-5 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-2">
            <Download size={17} className="text-zinc-300" />
            <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
              Exportar Muestras, Pack de Slices & Bounce
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Format Selector */}
        <div className="flex items-center justify-between bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-3 text-xs">
          <span className="text-zinc-400">Formato de Audio (48 kHz):</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setFormat('wav')}
              className={`px-3 py-1 rounded-lg border font-medium cursor-pointer ${
                format === 'wav'
                  ? 'bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold'
                  : 'bg-[#16161B] border-white/[0.08] text-zinc-400 hover:text-white'
              }`}
            >
              WAV 24-Bit (smpl/cue)
            </button>
            <button
              type="button"
              onClick={() => setFormat('mp3')}
              className={`px-3 py-1 rounded-lg border font-medium cursor-pointer ${
                format === 'mp3'
                  ? 'bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold'
                  : 'bg-[#16161B] border-white/[0.08] text-zinc-400 hover:text-white'
              }`}
            >
              MP3 320 kbps
            </button>
          </div>
        </div>

        {err && (
          <div className="px-3 py-2 rounded-xl bg-rose-500/12 border border-rose-500/35 text-xs text-rose-300">
            {err}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* 1. Export Single Pad */}
          <button
            type="button"
            disabled={!selectedPad.regionId || Boolean(busy)}
            onClick={() => void run('pad', () => onExportSinglePad(format))}
            className="p-3.5 rounded-xl bg-[#0D0D10] hover:bg-[#17171C] border border-white/[0.08] hover:border-white/[0.18] text-left flex flex-col gap-1 disabled:opacity-40 cursor-pointer transition-colors"
          >
            <div className="font-semibold text-zinc-100 flex items-center gap-1.5">
              <Download size={14} className="text-orange-400" />
              <span>Exportar Pad {selectedPad.index + 1}</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Renderiza "{selectedPad.label}" con ADSR, filtro, pitch, warp y FX.
            </p>
          </button>

          {/* 2. Export Selected Region */}
          <button
            type="button"
            disabled={!selectedRegion || Boolean(busy)}
            onClick={() => void run('region', () => onExportRegion(format))}
            className="p-3.5 rounded-xl bg-[#0D0D10] hover:bg-[#17171C] border border-white/[0.08] hover:border-white/[0.18] text-left flex flex-col gap-1 disabled:opacity-40 cursor-pointer transition-colors"
          >
            <div className="font-semibold text-zinc-100 flex items-center gap-1.5">
              <Disc size={14} className="text-zinc-300" />
              <span>Exportar Región Cruda</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Recorte limpio con fades anti-clic ({selectedRegion?.name ?? 'Sin región'}).
            </p>
          </button>

          {/* 3. Export ZIP Slice Pack */}
          <button
            type="button"
            disabled={regionsCount === 0 || Boolean(busy)}
            onClick={() => void run('zip', onExportSlicesZip)}
            className="sm:col-span-2 p-3.5 rounded-xl bg-[#0D0D10] hover:bg-[#17171C] border border-white/[0.08] hover:border-white/[0.18] text-left flex items-center justify-between disabled:opacity-40 cursor-pointer transition-colors"
          >
            <div>
              <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                <Archive size={14} />
                <span>Exportar Pack Completo de Slices (.ZIP + kit.json)</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Empaqueta los {regionsCount} slices en WAV 24-bit con metadatos de nota raíz y manifiesto JSON.
              </p>
            </div>
            {busy === 'zip' && <Loader2 size={16} className="animate-spin text-emerald-400" />}
          </button>
        </div>

        {/* 4. Sequencer Pattern Bounce */}
        <div className="rounded-xl bg-[#0D0D10] border border-white/[0.08] p-3.5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-100">
              Bounce Offline del Secuenciador
            </span>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-zinc-500">Compases:</span>
              <select
                value={bounceBars}
                onChange={(e) => setBounceBars(Number(e.target.value))}
                className="bg-[#16161B] border border-white/[0.08] rounded-lg px-2 py-0.5 text-zinc-100"
              >
                {[1, 2, 4, 8].map((b) => (
                  <option key={b} value={b}>
                    {b} {b === 1 ? 'compás' : 'compases'}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seamlessLoop}
                  onChange={(e) => setSeamlessLoop(e.target.checked)}
                  className="accent-zinc-100"
                />
                <span>Loop exacto</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void run('bounce', () =>
                  onExportPatternBounce(bounceBars, seamlessLoop, format)
                )
              }
              className="py-2 px-3 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
            >
              {busy === 'bounce' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>Descargar Bounce ({format.toUpperCase()})</span>
            </button>

            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void run('master', () => onSendBounceToMastering(bounceBars))
              }
              className="py-2 px-3 rounded-xl bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-zinc-100 font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
            >
              <ArrowUpRight size={14} />
              <span>Enviar Bounce a Mastering Pro</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
