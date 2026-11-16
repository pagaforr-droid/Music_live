import React, { useState } from 'react';
import { Sliders, Waves, Filter, Sparkles, Radio } from 'lucide-react';
import type {
  PadVoiceParams,
  PlayMode,
  SamplePad,
  TexturePresetId,
  WarpMode,
} from '../types/sampler.types';

interface PadInspectorProps {
  pad: SamplePad;
  onUpdateParams: (patch: Partial<PadVoiceParams>) => void;
  onUpdateLabel: (label: string) => void;
  onApplyTexturePreset: (presetId: TexturePresetId) => void;
  onAutoTuneToRoot: () => void;
}

export const PadInspector: React.FC<PadInspectorProps> = ({
  pad,
  onUpdateParams,
  onUpdateLabel,
  onApplyTexturePreset,
  onAutoTuneToRoot,
}) => {
  const [tab, setTab] = useState<'sample' | 'amp' | 'filter' | 'warp' | 'fx'>('sample');
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
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800/90 p-3.5 shadow-[0_14px_40px_rgba(0,0,0,0.65)] flex flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: pad.colorHex }}
          />
          <input
            type="text"
            value={pad.label}
            onChange={(e) => onUpdateLabel(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-white focus:border-[#00E5FF] focus:outline-none w-44"
          />
          <span className="text-[10px] font-mono text-slate-400">
            Pad {pad.index + 1} ({pad.keyboardKey})
          </span>
        </div>

        <div className="flex flex-wrap gap-1 bg-slate-950 border border-slate-800 rounded-xl p-0.5">
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
                className={`px-2 py-1 rounded-lg text-[10.5px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                  active
                    ? 'bg-[#FF6B00] text-slate-950'
                    : 'text-slate-400 hover:text-white'
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
          <div className="space-y-2.5 bg-slate-950/90 border border-slate-800 rounded-xl p-3">
            <div>
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Ganancia Pad</span>
                <span className="text-[#FF6B00] font-bold">
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
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Paneo L/R</span>
                <span className="text-[#00E5FF] font-bold">
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
                className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Fade In</span>
                  <span className="text-white">{p.fadeInMs}ms</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={250}
                  step={1}
                  value={p.fadeInMs}
                  onChange={(e) => onUpdateParams({ fadeInMs: Number(e.target.value) })}
                  className="w-full accent-emerald-400 h-1 bg-slate-800 rounded cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Fade Out</span>
                  <span className="text-white">{p.fadeOutMs}ms</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={400}
                  step={1}
                  value={p.fadeOutMs}
                  onChange={(e) => onUpdateParams({ fadeOutMs: Number(e.target.value) })}
                  className="w-full accent-emerald-400 h-1 bg-slate-800 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2.5 bg-slate-950/90 border border-slate-800 rounded-xl p-3">
            <div>
              <span className="text-[10px] text-slate-400 block mb-1">
                Modo de Disparo
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(['oneshot', 'gate', 'loop'] as PlayMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onUpdateParams({ playMode: m })}
                    className={`py-1 rounded-lg border text-[10px] uppercase font-bold cursor-pointer ${
                      p.playMode === m
                        ? 'bg-[#00E5FF] text-slate-950 border-[#00E5FF]'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">Choke Group</span>
              <select
                value={p.chokeGroup ?? 0}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onUpdateParams({ chokeGroup: val === 0 ? null : val });
                }}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white"
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
              <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={p.reverse}
                  onChange={(e) => onUpdateParams({ reverse: e.target.checked })}
                  className="accent-[#FF6B00]"
                />
                <span>Reverse</span>
              </label>

              <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={p.normalize}
                  onChange={(e) => onUpdateParams({ normalize: e.target.checked })}
                  className="accent-[#00E5FF]"
                />
                <span>Normalizar (-1dB)</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AMP ADSR */}
      {tab === 'amp' && (
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col gap-3">
          <svg viewBox="0 0 202 60" className="w-full h-14 bg-slate-900/80 rounded-lg border border-slate-800">
            <polyline
              fill="rgba(0,229,255,0.14)"
              stroke="#00E5FF"
              strokeWidth="2"
              points={buildAdsrPath(p.amp.attackMs, p.amp.decayMs, p.amp.sustain, p.amp.releaseMs)}
            />
          </svg>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px] font-mono">
            {[
              { label: 'Attack', val: `${p.amp.attackMs}ms`, min: 2, max: 1500, step: 2, cur: p.amp.attackMs, key: 'attackMs' as const },
              { label: 'Decay', val: `${p.amp.decayMs}ms`, min: 10, max: 2000, step: 10, cur: p.amp.decayMs, key: 'decayMs' as const },
              { label: 'Sustain', val: `${Math.round(p.amp.sustain * 100)}%`, min: 0, max: 1, step: 0.02, cur: p.amp.sustain, key: 'sustain' as const },
              { label: 'Release', val: `${p.amp.releaseMs}ms`, min: 5, max: 3000, step: 5, cur: p.amp.releaseMs, key: 'releaseMs' as const },
            ].map((item) => (
              <div key={item.key}>
                <div className="flex justify-between text-slate-400">
                  <span>{item.label}</span>
                  <span className="text-[#00E5FF] font-bold">{item.val}</span>
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
                  className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded cursor-pointer"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: FILTER + FILTER ENV */}
      {tab === 'filter' && (
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col gap-3 text-[11px] font-mono">
          <div className="grid grid-cols-4 gap-1.5">
            {(['off', 'lowpass', 'highpass', 'bandpass'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onUpdateParams({ filter: { ...p.filter, type: t } })}
                className={`py-1 rounded-lg border uppercase font-bold cursor-pointer ${
                  p.filter.type === t
                    ? 'bg-[#FF6B00] text-slate-950 border-[#FF6B00]'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex justify-between text-slate-400">
                <span>Cutoff</span>
                <span className="text-[#00E5FF] font-bold">{p.filter.cutoffHz}Hz</span>
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
                className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-400">
                <span>Resonance Q</span>
                <span className="text-[#FF6B00] font-bold">{p.filter.q.toFixed(1)}</span>
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
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-400">
                <span>Env Depth</span>
                <span className="text-emerald-400 font-bold">
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
                className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PITCH / TIME-STRETCH WARP / PAULSTRETCH / TEXTURES */}
      {tab === 'warp' && (
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex flex-col gap-3 text-[11px] font-mono">
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
                  className={`px-2 py-1 rounded-lg border text-[10px] font-bold cursor-pointer ${
                    p.warp.mode === wm.id
                      ? 'bg-[#00E5FF] text-slate-950 border-[#00E5FF]'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  {wm.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onAutoTuneToRoot}
              className="px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold cursor-pointer"
            >
              Auto-Afinar (YIN)
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="flex justify-between text-slate-400">
                <span>Pitch (St)</span>
                <span className="text-[#FF6B00] font-bold">
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
                className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-400">
                <span>Fine (Cents)</span>
                <span className="text-[#00E5FF] font-bold">
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
                className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-400">
                <span>Time Stretch</span>
                <span className="text-emerald-400 font-bold">
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
                className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-400">
                <span>Pad Stretch</span>
                <span className="text-purple-400 font-bold">
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
                className="w-full accent-purple-400 h-1.5 bg-slate-800 rounded cursor-pointer"
              />
            </div>
          </div>

          {/* 1-Click Sound Design Texture Presets */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800">
            <span className="text-[10px] text-slate-500 mr-1">
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
                className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-[#00E5FF] cursor-pointer"
              >
                {tp.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: FX SENDS & VELOCITY */}
      {tab === 'fx' && (
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] font-mono">
          <div>
            <div className="flex justify-between text-slate-400">
              <span>Send Studio Reverb</span>
              <span className="text-[#00E5FF] font-bold">
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
              className="w-full accent-[#00E5FF] h-1.5 bg-slate-800 rounded cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-400">
              <span>Send Ping-Pong Delay</span>
              <span className="text-[#FF6B00] font-bold">
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
              className="w-full accent-[#FF6B00] h-1.5 bg-slate-800 rounded cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-400">
              <span>Velocity Sensitivity</span>
              <span className="text-emerald-400 font-bold">
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
              className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
