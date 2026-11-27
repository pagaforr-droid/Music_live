import React, { useRef, useState } from 'react';
import { Sliders, Waves, Filter, Sparkles, Radio, Upload } from 'lucide-react';
import type {
  PadVoiceParams,
  PlayMode,
  SamplePad,
  TexturePresetId,
  WarpMode,
} from '../types/sampler.types';

interface PadInspectorProps {
  pad: SamplePad;
  sourceBpm?: number;
  patternBpm?: number;
  onUpdateParams: (patch: Partial<PadVoiceParams>) => void;
  onUpdateLabel: (label: string) => void;
  onApplyTexturePreset: (presetId: TexturePresetId) => void;
  onAutoTuneToRoot: () => void;
  onUploadFileToSelectedPad?: (file: File) => void;
}

export const PadInspector: React.FC<PadInspectorProps> = ({
  pad,
  sourceBpm,
  patternBpm,
  onUpdateParams,
  onUpdateLabel,
  onApplyTexturePreset,
  onAutoTuneToRoot,
  onUploadFileToSelectedPad,
}) => {
  const [tab, setTab] = useState<'sample' | 'amp' | 'filter' | 'warp' | 'fx'>('sample');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const p = pad.params;

  // Compute clean SVG polyline for ADSR preview
  const buildAdsrPath = (aMs: number, dMs: number, sus: number, rMs: number) => {
    const tot = Math.max(100, aMs + dMs + rMs + 150);
    const xA = (aMs / tot) * 200;
    const xD = xA + (dMs / tot) * 200;
    const xS = xD + (150 / tot) * 200;
    const xR = Math.min(200, xS + (rMs / tot) * 200);
    const ySus = 56 - sus * 48;
    return `2,56 ${xA.toFixed(1)},8 ${xD.toFixed(1)},${ySus.toFixed(1)} ${xS.toFixed(1)},${ySus.toFixed(1)} ${xR.toFixed(1)},56`;
  };

  return (
    <div className="rounded-2xl bg-[#121215] border border-white/[0.08] p-4 flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.webm,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && onUploadFileToSelectedPad) onUploadFileToSelectedPad(f);
          e.target.value = '';
        }}
      />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: pad.colorHex }}
          />
          <input
            type="text"
            value={pad.label}
            onChange={(e) => onUpdateLabel(e.target.value)}
            className="bg-[#0B0B0D] border border-white/[0.08] rounded-lg px-2.5 py-1 text-xs font-semibold text-zinc-100 focus:border-white/25 focus:outline-none w-36 sm:w-44"
          />
          <span className="text-[10.5px] font-mono text-zinc-500">
            Pad {pad.index + 1} ({pad.keyboardKey})
          </span>
          {onUploadFileToSelectedPad && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 rounded-lg bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-zinc-100 text-[10.5px] font-medium flex items-center gap-1 cursor-pointer"
              title="Subir tu propio audio para reemplazar este Pad"
            >
              <Upload size={11} />
              <span>Subir Audio</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-0.5 bg-[#0B0B0D] border border-white/[0.07] rounded-xl p-0.5">
          {[
            { id: 'sample' as const, label: 'Sample', icon: Sliders },
            { id: 'amp' as const, label: 'ADSR', icon: Waves },
            { id: 'filter' as const, label: 'Filtro', icon: Filter },
            { id: 'warp' as const, label: 'Pitch/Warp', icon: Sparkles },
            { id: 'fx' as const, label: 'FX Sends', icon: Radio },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                  active
                    ? 'bg-zinc-100 text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Icon size={11} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: SAMPLE / MODE / CHOKE / GAIN */}
      {tab === 'sample' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="space-y-3 bg-[#0C0C0F] border border-white/[0.07] rounded-xl p-3.5">
            <div>
              <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                <span>Ganancia Pad</span>
                <span className="text-zinc-100 font-mono font-semibold">
                  {p.gainDb > 0 ? '+' : ''}
                  {p.gainDb.toFixed(1)} dB
                </span>
              </div>
              <input
                type="range"
                min={-36}
                max={12}
                step={0.5}
                value={p.gainDb}
                onChange={(e) => onUpdateParams({ gainDb: Number(e.target.value) })}
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                <span>Paneo L/R</span>
                <span className="text-zinc-100 font-mono font-semibold">
                  {p.pan === 0 ? 'Centro' : p.pan < 0 ? `L${Math.round(Math.abs(p.pan) * 100)}` : `R${Math.round(p.pan * 100)}`}
                </span>
              </div>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.02}
                value={p.pan}
                onChange={(e) => onUpdateParams({ pan: Number(e.target.value) })}
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <div className="flex justify-between text-[10.5px] text-zinc-500 mb-0.5">
                  <span>Fade In</span>
                  <span className="text-zinc-200 font-mono">{p.fadeInMs}ms</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={250}
                  step={1}
                  value={p.fadeInMs}
                  onChange={(e) => onUpdateParams({ fadeInMs: Number(e.target.value) })}
                  className="w-full accent-zinc-200 h-1 bg-zinc-800 rounded cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10.5px] text-zinc-500 mb-0.5">
                  <span>Fade Out</span>
                  <span className="text-zinc-200 font-mono">{p.fadeOutMs}ms</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={400}
                  step={1}
                  value={p.fadeOutMs}
                  onChange={(e) => onUpdateParams({ fadeOutMs: Number(e.target.value) })}
                  className="w-full accent-zinc-200 h-1 bg-zinc-800 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 bg-[#0C0C0F] border border-white/[0.07] rounded-xl p-3.5">
            <div>
              <span className="text-[10.5px] text-zinc-500 block mb-1.5">
                Modo de Disparo
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(['oneshot', 'gate', 'loop'] as PlayMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onUpdateParams({ playMode: m })}
                    className={`py-1 rounded-lg border text-[10px] font-mono uppercase font-semibold cursor-pointer ${
                      p.playMode === m
                        ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                        : 'bg-[#16161B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-400">Choke Group</span>
              <select
                value={p.chokeGroup ?? 0}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onUpdateParams({ chokeGroup: val === 0 ? null : val });
                }}
                className="bg-[#16161B] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-zinc-100"
              >
                <option value={0}>Ninguno</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((g) => (
                  <option key={g} value={g}>
                    Grupo {g}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={p.reverse}
                  onChange={(e) => onUpdateParams({ reverse: e.target.checked })}
                  className="accent-zinc-100"
                />
                <span>Reverse</span>
              </label>

              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={p.normalize}
                  onChange={(e) => onUpdateParams({ normalize: e.target.checked })}
                  className="accent-zinc-100"
                />
                <span>Normalizar (-1dB)</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AMP ADSR */}
      {tab === 'amp' && (
        <div className="bg-[#0C0C0F] border border-white/[0.07] rounded-xl p-3.5 flex flex-col gap-3">
          <svg viewBox="0 0 202 60" className="w-full h-14 bg-[#09090B] rounded-lg border border-white/[0.06]">
            <polyline
              fill="rgba(228,228,231,0.10)"
              stroke="#E4E4E7"
              strokeWidth="1.8"
              points={buildAdsrPath(p.amp.attackMs, p.amp.decayMs, p.amp.sustain, p.amp.releaseMs)}
            />
          </svg>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px]">
            {[
              { label: 'Attack', val: `${p.amp.attackMs}ms`, min: 2, max: 1500, step: 2, cur: p.amp.attackMs, key: 'attackMs' as const },
              { label: 'Decay', val: `${p.amp.decayMs}ms`, min: 10, max: 2000, step: 10, cur: p.amp.decayMs, key: 'decayMs' as const },
              { label: 'Sustain', val: `${Math.round(p.amp.sustain * 100)}%`, min: 0, max: 1, step: 0.02, cur: p.amp.sustain, key: 'sustain' as const },
              { label: 'Release', val: `${p.amp.releaseMs}ms`, min: 5, max: 3000, step: 5, cur: p.amp.releaseMs, key: 'releaseMs' as const },
            ].map((item) => (
              <div key={item.key}>
                <div className="flex justify-between text-zinc-500 mb-0.5">
                  <span>{item.label}</span>
                  <span className="text-zinc-100 font-mono font-semibold">{item.val}</span>
                </div>
                <input
                  type="range"
                  min={item.min}
                  max={item.max}
                  step={item.step}
                  value={item.cur}
                  onChange={(e) =>
                    onUpdateParams({
                      amp: { ...p.amp, [item.key]: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: FILTER + FILTER ENV */}
      {tab === 'filter' && (
        <div className="bg-[#0C0C0F] border border-white/[0.07] rounded-xl p-3.5 flex flex-col gap-3 text-[11px]">
          <div className="grid grid-cols-4 gap-1.5">
            {(['off', 'lowpass', 'highpass', 'bandpass'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onUpdateParams({ filter: { ...p.filter, type: t } })}
                className={`py-1 rounded-lg border font-mono uppercase font-semibold cursor-pointer ${
                  p.filter.type === t
                    ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                    : 'bg-[#16161B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex justify-between text-zinc-500 mb-0.5">
                <span>Cutoff</span>
                <span className="text-zinc-100 font-mono font-semibold">{p.filter.cutoffHz}Hz</span>
              </div>
              <input
                type="range"
                min={60}
                max={18000}
                step={20}
                value={p.filter.cutoffHz}
                onChange={(e) =>
                  onUpdateParams({
                    filter: { ...p.filter, cutoffHz: Number(e.target.value) },
                  })
                }
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-500 mb-0.5">
                <span>Resonance Q</span>
                <span className="text-zinc-100 font-mono font-semibold">{p.filter.q.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={14}
                step={0.1}
                value={p.filter.q}
                onChange={(e) =>
                  onUpdateParams({
                    filter: { ...p.filter, q: Number(e.target.value) },
                  })
                }
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-500 mb-0.5">
                <span>Env Depth</span>
                <span className="text-zinc-100 font-mono font-semibold">
                  {p.filter.envAmountOct > 0 ? '+' : ''}
                  {p.filter.envAmountOct.toFixed(1)} Oct
                </span>
              </div>
              <input
                type="range"
                min={-4}
                max={4}
                step={0.2}
                value={p.filter.envAmountOct}
                onChange={(e) =>
                  onUpdateParams({
                    filter: { ...p.filter, envAmountOct: Number(e.target.value) },
                  })
                }
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PITCH / TIME-STRETCH WARP / PAULSTRETCH / TEXTURES */}
      {tab === 'warp' && (
        <div className="bg-[#0C0C0F] border border-white/[0.07] rounded-xl p-3.5 flex flex-col gap-3 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { id: 'off', label: 'Normal' },
                  { id: 'varispeed', label: 'Varispeed' },
                  { id: 'wsola', label: 'WSOLA (Drums)' },
                  { id: 'phasevocoder', label: 'Vocoder (Tonal)' },
                  { id: 'granular', label: 'Granular' },
                  { id: 'paulstretch', label: 'Paulstretch' },
                ] as Array<{ id: WarpMode; label: string }>
              ).map((wm) => (
                <button
                  key={wm.id}
                  type="button"
                  onClick={() =>
                    onUpdateParams({ warp: { ...p.warp, mode: wm.id } })
                  }
                  className={`px-2 py-1 rounded-lg border text-[10.5px] font-medium cursor-pointer ${
                    p.warp.mode === wm.id
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100 font-semibold'
                      : 'bg-[#16161B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {wm.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onUpdateParams({
                    warp: { ...p.warp, syncToBpm: !p.warp.syncToBpm },
                  })
                }
                className={`px-2 py-1 rounded-lg border text-[10.5px] font-medium cursor-pointer transition-colors ${
                  p.warp.syncToBpm
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-[#16161B] border-white/[0.08] text-zinc-400 hover:text-white'
                }`}
                title="Adapta la velocidad/duración del audio al BPM del proyecto preservando el tono"
              >
                {p.warp.syncToBpm
                  ? sourceBpm && patternBpm && Math.abs(sourceBpm - patternBpm) >= 0.5
                    ? `Sync BPM: ${sourceBpm}→${patternBpm} (${(sourceBpm / patternBpm).toFixed(2)}x)`
                    : 'Sync BPM: ON'
                  : 'Sync BPM: OFF'}
              </button>
              <button
                type="button"
                onClick={onAutoTuneToRoot}
                className="px-2 py-1 rounded-lg bg-[#1A1A1F] hover:bg-[#24242C] border border-white/[0.1] text-emerald-300 text-[10.5px] font-medium cursor-pointer"
              >
                Auto-Afinar (YIN)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="flex justify-between text-zinc-500 mb-0.5">
                <span>Pitch (St)</span>
                <span className="text-zinc-100 font-mono font-semibold">
                  {p.pitchSemis > 0 ? '+' : ''}
                  {p.pitchSemis} st
                </span>
              </div>
              <input
                type="range"
                min={-24}
                max={24}
                step={1}
                value={p.pitchSemis}
                onChange={(e) => onUpdateParams({ pitchSemis: Number(e.target.value) })}
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-500 mb-0.5">
                <span>Fine (Cents)</span>
                <span className="text-zinc-100 font-mono font-semibold">
                  {p.fineCents > 0 ? '+' : ''}
                  {p.fineCents}c
                </span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={p.fineCents}
                onChange={(e) => onUpdateParams({ fineCents: Number(e.target.value) })}
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-500 mb-0.5">
                <span>Time Stretch</span>
                <span className="text-zinc-100 font-mono font-semibold">
                  {p.warp.timeStretchRatio.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.05}
                value={p.warp.timeStretchRatio}
                onChange={(e) =>
                  onUpdateParams({
                    warp: { ...p.warp, timeStretchRatio: Number(e.target.value) },
                  })
                }
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-zinc-500 mb-0.5">
                <span>Pad Stretch</span>
                <span className="text-zinc-100 font-mono font-semibold">
                  {p.granular.stretchFactor.toFixed(0)}x
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={20}
                step={1}
                value={p.granular.stretchFactor}
                onChange={(e) =>
                  onUpdateParams({
                    granular: { ...p.granular, stretchFactor: Number(e.target.value) },
                  })
                }
                className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>
          </div>

          {/* 1-Click Sound Design Texture Presets */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/[0.06]">
            <span className="text-[10.5px] text-zinc-500 mr-1">
              Presets de Textura:
            </span>
            {(
              [
                { id: 'pad-etereo', label: 'Pad Etéreo' },
                { id: 'riser-cinematico', label: 'Riser Cinemático' },
                { id: 'glitch-percusivo', label: 'Glitch Percusivo' },
                { id: 'tape-stop', label: 'Tape Stop' },
              ] as Array<{ id: TexturePresetId; label: string }>
            ).map((tp) => (
              <button
                key={tp.id}
                type="button"
                onClick={() => onApplyTexturePreset(tp.id)}
                className="px-2.5 py-1 rounded-lg bg-[#16161B] hover:bg-[#222229] border border-white/[0.08] text-[10.5px] text-zinc-200 cursor-pointer"
              >
                {tp.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: FX SENDS & VELOCITY */}
      {tab === 'fx' && (
        <div className="bg-[#0C0C0F] border border-white/[0.07] rounded-xl p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
          <div>
            <div className="flex justify-between text-zinc-500 mb-0.5">
              <span>Send Studio Reverb</span>
              <span className="text-zinc-100 font-mono font-semibold">
                {Math.round(p.sends.reverb * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={p.sends.reverb}
              onChange={(e) =>
                onUpdateParams({
                  sends: { ...p.sends, reverb: Number(e.target.value) },
                })
              }
              className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-zinc-500 mb-0.5">
              <span>Send Ping-Pong Delay</span>
              <span className="text-zinc-100 font-mono font-semibold">
                {Math.round(p.sends.delay * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={p.sends.delay}
              onChange={(e) =>
                onUpdateParams({
                  sends: { ...p.sends, delay: Number(e.target.value) },
                })
              }
              className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-zinc-500 mb-0.5">
              <span>Velocity Sensitivity</span>
              <span className="text-zinc-100 font-mono font-semibold">
                {Math.round(p.velocitySens * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={p.velocitySens}
              onChange={(e) =>
                onUpdateParams({ velocitySens: Number(e.target.value) })
              }
              className="w-full accent-zinc-100 h-1.5 bg-zinc-800 rounded cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
