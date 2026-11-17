import React, { useEffect, useRef, useState } from 'react';
import {
  Sliders,
  RotateCcw,
  ShieldCheck,
  Headphones,
  Volume2,
  Cpu,
  Sparkles,
  Check,
  X,
  Music,
  Globe,
  Layers,
  Activity,
} from 'lucide-react';
import {
  STAGE_EQ_18_BANDS,
  STAGE_EQ_PRESETS,
  STEM_BUS_GROUPS,
  CONSOLE_PAIR_OPTIONS,
  CUE_ROUTING_OPTIONS,
  ALL_CONSOLE_TARGET_OPTIONS,
  StageEqProfile,
  MultiChannelPatchConfig,
  HpfCutoffOption,
  CueToneMode,
  EqMemoryScope,
  ConsoleTargetAssignment,
  StemBusGroupId,
  DEFAULT_18_GAINS,
  analyzeStagePatch,
  computeEqAutoHeadroomGain,
  resolveStemConsoleTarget,
} from '../utils/liveConsoleDSP';
import { StageIoAlertsBanner } from './StageIoAlertsBanner';
import { detectInstrumentCategory } from '../utils/instrumentIcons';

export interface LoadedStemSummary {
  id: string;
  name: string;
  group: StemBusGroupId;
  volume: number;
}

interface StageEqualizerConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  profile: StageEqProfile;
  onChangeProfile: (updater: (prev: StageEqProfile) => StageEqProfile) => void;
  memoryScope: EqMemoryScope;
  onChangeMemoryScope: (scope: EqMemoryScope) => void;
  currentSongTitle?: string;
  routingMode: 'StereoInEar' | 'StereoSplit' | 'MultiChannel';
  onChangeRoutingMode: (mode: 'StereoInEar' | 'StereoSplit' | 'MultiChannel') => void;
  multiChannelPatch: MultiChannelPatchConfig;
  onChangeMultiChannelPatch: (updater: (prev: MultiChannelPatchConfig) => MultiChannelPatchConfig) => void;
  hardwareMaxChannels: number;
  audioOutputs: MediaDeviceInfo[];
  fohAnalyser: AnalyserNode | null;
  cueAnalyser?: AnalyserNode | null;
  fohMeterLevel?: number;
  cueMeterLevel?: number;
  sinkSwitchError?: boolean;
  loadedStems: LoadedStemSummary[];
  isLoadingStems: boolean;
  onOpenSoundcheck?: () => void;
}

const ZONE_COLORS: Record<string, { text: string; bar: string; badge: string }> = {
  SUB:      { text: 'text-rose-600',    bar: '#e11d48', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  BASS:     { text: 'text-orange-600',  bar: '#ea580c', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  LOW_MID:  { text: 'text-amber-600',   bar: '#d97706', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  MID:      { text: 'text-emerald-600', bar: '#059669', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  HIGH_MID: { text: 'text-teal-600',    bar: '#0d9488', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  PRESENCE: { text: 'text-blue-600',    bar: '#2563eb', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  AIR:      { text: 'text-violet-600',  bar: '#7c3aed', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
};

export const StageEqualizerConsole: React.FC<StageEqualizerConsoleProps> = ({
  isOpen,
  onClose,
  profile,
  onChangeProfile,
  memoryScope,
  onChangeMemoryScope,
  currentSongTitle,
  routingMode,
  onChangeRoutingMode,
  multiChannelPatch,
  onChangeMultiChannelPatch,
  hardwareMaxChannels,
  audioOutputs,
  fohAnalyser,
  cueAnalyser,
  fohMeterLevel = 0,
  cueMeterLevel = 0,
  sinkSwitchError = false,
  loadedStems,
  isLoadingStems,
  onOpenSoundcheck,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fohMeterBarRef = useRef<HTMLDivElement | null>(null);
  const cueMeterBarRef = useRef<HTMLDivElement | null>(null);
  const meterHoldRef = useRef<{ foh: number; cue: number }>({ foh: 0, cue: 0 });
  const [showStemOverrides, setShowStemOverrides] = useState(false);

  // Dibujar espectro FFT en vivo + curva de respuesta + medidores VU zero-re-render
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    let rafId = 0;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const freqData = new Uint8Array(fohAnalyser ? fohAnalyser.frequencyBinCount : 256);
    const fohTimeData = fohAnalyser ? new Uint8Array(fohAnalyser.fftSize) : null;
    const cueTimeData = cueAnalyser ? new Uint8Array(cueAnalyser.fftSize) : null;

    const render = () => {
      // Actualizar barras VU directamente por ref DOM (0 re-renders en React)
      if (fohAnalyser && fohTimeData && fohMeterBarRef.current) {
        fohAnalyser.getByteTimeDomainData(fohTimeData);
        let peak = 0;
        for (let i = 0; i < fohTimeData.length; i += 2) {
          const v = Math.abs((fohTimeData[i] - 128) / 128);
          if (v > peak) peak = v;
        }
        meterHoldRef.current.foh =
          peak > meterHoldRef.current.foh
            ? peak
            : meterHoldRef.current.foh * 0.85 + peak * 0.15;
        fohMeterBarRef.current.style.width = `${Math.min(100, Math.round(meterHoldRef.current.foh * 100))}%`;
      }
      if (cueAnalyser && cueTimeData && cueMeterBarRef.current) {
        cueAnalyser.getByteTimeDomainData(cueTimeData);
        let peak = 0;
        for (let i = 0; i < cueTimeData.length; i++) {
          const v = Math.abs((cueTimeData[i] - 128) / 128);
          if (v > peak) peak = v;
        }
        meterHoldRef.current.cue =
          peak > meterHoldRef.current.cue
            ? peak
            : meterHoldRef.current.cue * 0.85 + peak * 0.15;
        cueMeterBarRef.current.style.width = `${Math.min(100, Math.round(meterHoldRef.current.cue * 100))}%`;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Grilla de +12dB, +6dB, 0dB, -6dB, -12dB
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      for (const ratio of [0.15, 0.325, 0.5, 0.675, 0.85]) {
        const y = Math.round(h * ratio) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Línea central 0 dB
      ctx.strokeStyle = '#cbd5e1';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(h * 0.5) + 0.5);
      ctx.lineTo(w, Math.round(h * 0.5) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // Barras espectrales FFT en vivo
      if (fohAnalyser) {
        fohAnalyser.getByteFrequencyData(freqData);
        const sampleRate = fohAnalyser.context.sampleRate || 48000;
        const binCount = fohAnalyser.frequencyBinCount;

        ctx.fillStyle = 'rgba(225, 29, 72, 0.11)';
        STAGE_EQ_18_BANDS.forEach((b, idx) => {
          const bin = Math.min(binCount - 1, Math.max(1, Math.round((b.freq * binCount * 2) / sampleRate)));
          const val = freqData[bin] / 255;
          const colW = w / 18;
          const x = idx * colW + colW * 0.18;
          const barW = colW * 0.64;
          const barH = val * (h * 0.82);
          ctx.fillRect(x, h - barH, barW, barH);
        });
      }

      // Curva continua de las 18 bandas
      const points = STAGE_EQ_18_BANDS.map((_, idx) => {
        const colW = w / 18;
        const x = idx * colW + colW * 0.5;
        const gainDb = profile.enabled ? (profile.gains[idx] || 0) : 0;
        let hpfAtten = 0;
        if (profile.enabled && profile.hpfFreq > 0) {
          const freq = STAGE_EQ_18_BANDS[idx].freq;
          if (freq < profile.hpfFreq) {
            hpfAtten = -Math.min(12, ((profile.hpfFreq - freq) / profile.hpfFreq) * 14);
          }
        }
        const effectiveDb = Math.max(-12, Math.min(12, gainDb + hpfAtten));
        const y = h * 0.5 - (effectiveDb / 12) * (h * 0.38);
        return { x, y };
      });

      if (points.length > 1) {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(225, 29, 72, 0.22)');
        grad.addColorStop(0.5, 'rgba(225, 29, 72, 0.03)');
        grad.addColorStop(1, 'rgba(37, 99, 235, 0.18)');

        ctx.beginPath();
        ctx.moveTo(points[0].x, h * 0.5);
        ctx.lineTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.lineTo(points[points.length - 1].x, h * 0.5);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.strokeStyle = profile.enabled ? '#e11d48' : '#94a3b8';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [isOpen, fohAnalyser, cueAnalyser, profile]);

  if (!isOpen) return null;

  const selectedOutputDevice = audioOutputs.find((d) => d.deviceId === multiChannelPatch.sinkId);
  const activeOutputLabel =
    selectedOutputDevice?.label ||
    audioOutputs.find((d) => d.deviceId === 'default')?.label ||
    audioOutputs[0]?.label ||
    multiChannelPatch.sinkLabel ||
    'Predeterminado del Sistema';
  const isSavedSinkMissing = Boolean(
    multiChannelPatch.sinkId &&
      multiChannelPatch.sinkId !== 'default' &&
      audioOutputs.length > 0 &&
      !selectedOutputDevice
  );
  const modalSinkStatus: 'ok' | 'missing' | 'rejected' = sinkSwitchError
    ? 'rejected'
    : isSavedSinkMissing
    ? 'missing'
    : 'ok';

  const stemsForAnalysis = loadedStems.map((st) => ({
    id: st.id,
    name: st.name,
    group: st.group,
    category: detectInstrumentCategory(st.name),
  }));

  const patchAnalysis = analyzeStagePatch(
    routingMode,
    multiChannelPatch,
    hardwareMaxChannels,
    stemsForAnalysis,
    {
      activeDeviceLabel: activeOutputLabel,
      sinkMissingOrRejected: modalSinkStatus !== 'ok',
    }
  );

  const autoTrimGain = computeEqAutoHeadroomGain(profile.gains, profile.limiterEnabled);
  const autoTrimDb = 20 * Math.log10(autoTrimGain);

  const handleBandChange = (index: number, rawDb: number) => {
    const clamped = Math.round(Math.max(-12, Math.min(12, rawDb)) * 2) / 2;
    onChangeProfile((prev) => {
      const nextGains = [...prev.gains];
      nextGains[index] = clamped;
      return {
        ...prev,
        enabled: true,
        presetId: 'custom',
        gains: nextGains,
      };
    });
  };

  const applyZoneNudge = (zones: string[], deltaDb: number) => {
    onChangeProfile((prev) => {
      const nextGains = prev.gains.map((g, idx) => {
        const band = STAGE_EQ_18_BANDS[idx];
        if (!zones.includes(band.zone)) return g;
        return Math.round(Math.max(-12, Math.min(12, g + deltaDb)) * 2) / 2;
      });
      return {
        ...prev,
        enabled: true,
        presetId: 'custom',
        gains: nextGains,
      };
    });
  };

  const applyPreset = (presetId: string) => {
    const found = STAGE_EQ_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    onChangeProfile((prev) => ({
      ...prev,
      enabled: true,
      presetId: found.id,
      hpfFreq: found.hpfFreq,
      gains: [...found.gains],
    }));
  };

  const resetFlat = () => {
    onChangeProfile((prev) => ({
      ...prev,
      presetId: 'flat',
      hpfFreq: 0,
      gains: DEFAULT_18_GAINS(),
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-start justify-center pt-[84px] px-4 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1280px] bg-white border border-zinc-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-100px)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* TOP BAR */}
        <div className="px-6 py-3.5 bg-zinc-950 text-white flex items-center justify-between gap-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#e11d48] flex items-center justify-center shadow-sm">
              <Sliders size={17} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-extrabold uppercase tracking-[0.14em] text-white">
                  TANDU LIVE CONSOLE DSP &bull; ECUALIZADOR QUIRÚRGICO 18 BANDAS
                </h3>
                <span className="text-[9.5px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                  0.00ms LATENCIA (C++ BIQUAD)
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Moldea graves, medios y brillo en tiempo real y rutea salidas discretas multicanal a la consola física
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Selector de Memoria: Global de Sala vs Por Canción */}
            <div className="bg-zinc-900 p-1 rounded-xl border border-zinc-800 flex items-center gap-1">
              <button
                type="button"
                onClick={() => onChangeMemoryScope('global')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                  memoryScope === 'global'
                    ? 'bg-white text-zinc-950 shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="Mantener este mismo ajuste de EQ para todas las canciones del ensayo o sala"
              >
                <Globe size={11} />
                <span>Global (Sala/Ensayo)</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeMemoryScope('per_song')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                  memoryScope === 'per_song'
                    ? 'bg-[#e11d48] text-white shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="Guardar un ajuste de EQ personalizado para la canción actual"
              >
                <Music size={11} />
                <span className="max-w-[140px] truncate">
                  Por Canción {currentSongTitle ? `(${currentSongTitle})` : ''}
                </span>
              </button>
            </div>

            {/* Safety Limiter Anti-Clipping */}
            <button
              type="button"
              onClick={() =>
                onChangeProfile((prev) => ({ ...prev, limiterEnabled: !prev.limiterEnabled }))
              }
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 border transition-all cursor-pointer ${
                profile.limiterEnabled
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-white'
              }`}
              title="Limitador Brickwall a -0.3 dBFS + Auto-Headroom: Evita saturar o clippear la consola al subir frecuencias"
            >
              <ShieldCheck size={13} />
              <span>
                Safety Limiter: {profile.limiterEnabled ? 'ON' : 'OFF'}
                {profile.limiterEnabled && autoTrimDb < -0.1
                  ? ` (${autoTrimDb.toFixed(1)} dB)`
                  : ''}
              </span>
            </button>

            {/* EQ Master Enable / Bypass */}
            <button
              type="button"
              onClick={() => onChangeProfile((prev) => ({ ...prev, enabled: !prev.enabled }))}
              className={`px-3.5 py-1.5 rounded-xl text-[10.5px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                profile.enabled
                  ? 'bg-[#e11d48] text-white shadow-sm hover:bg-[#be123c]'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  profile.enabled ? 'bg-white animate-pulse' : 'bg-zinc-500'
                }`}
              />
              <span>{profile.enabled ? 'EQ ACTIVO' : 'BYPASS'}</span>
            </button>

            {/* Reset 0 dB */}
            <button
              type="button"
              onClick={resetFlat}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
              title="Restablecer las 18 bandas a 0 dB"
            >
              <RotateCcw size={12} />
              <span>Flat 0 dB</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 cursor-pointer"
              title="Cerrar panel DSP"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* CONTENIDO SCROLLABLE */}
        <div className="p-5 overflow-y-auto space-y-4 bg-[#f8fafc]">
          {/* FILA 1: Presets Inteligentes de Escenario/Ensayo + Controles Rápidos (HPF & Macros) */}
          <div className="grid grid-cols-12 gap-3.5">
            <div className="col-span-7 bg-white p-3.5 rounded-2xl border border-zinc-200 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-700 flex items-center gap-1.5">
                  <Sparkles size={12} className="text-[#e11d48]" /> Presets de Escenario y Práctica (1-Clic)
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  Doble clic en cualquier fader = 0 dB
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {STAGE_EQ_PRESETS.map((preset) => {
                  const isSelected = profile.presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-rose-50/80 border-[#e11d48] ring-1 ring-[#e11d48]/30'
                          : 'bg-zinc-50/70 hover:bg-zinc-100/80 border-zinc-200'
                      }`}
                      title={preset.description}
                    >
                      <div className="flex items-center justify-between gap-1 w-full">
                        <span className="text-[11px] font-bold text-zinc-900 truncate">
                          {preset.name}
                        </span>
                        <span
                          className={`text-[8.5px] font-mono px-1.5 py-0.5 rounded-md font-bold shrink-0 ${
                            isSelected
                              ? 'bg-[#e11d48] text-white'
                              : 'bg-zinc-200/80 text-zinc-700'
                          }`}
                        >
                          {preset.badge}
                        </span>
                      </div>
                      <p className="text-[9.5px] text-zinc-500 line-clamp-1 mt-1">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="col-span-5 bg-white p-3.5 rounded-2xl border border-zinc-200 shadow-2xs flex flex-col justify-between gap-2.5">
              {/* HPF Low-Cut Anti-Rumble */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-800 block">
                    Filtro HPF (Corte Sub-Graves)
                  </span>
                  <span className="text-[9.5px] text-zinc-500">
                    Limpia el retumbe cuando toca el bajista en vivo
                  </span>
                </div>
                <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                  {([0, 40, 80, 110] as HpfCutoffOption[]).map((freq) => (
                    <button
                      key={freq}
                      type="button"
                      onClick={() =>
                        onChangeProfile((prev) => ({
                          ...prev,
                          enabled: true,
                          hpfFreq: freq,
                        }))
                      }
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                        profile.hpfFreq === freq
                          ? 'bg-zinc-900 text-white shadow-2xs'
                          : 'text-zinc-600 hover:text-black'
                      }`}
                    >
                      {freq === 0 ? 'OFF' : `${freq}Hz`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-zinc-100" />

              {/* Empuje Rápido por Zonas */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-800">
                  Ajuste Rápido por Zonas:
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center bg-rose-50 border border-rose-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => applyZoneNudge(['SUB', 'BASS'], -1.5)}
                      className="px-2 py-1 text-[9.5px] font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                      title="Bajar Graves (-1.5 dB en 31–125 Hz)"
                    >
                      Graves -
                    </button>
                    <div className="w-px h-3.5 bg-rose-200" />
                    <button
                      type="button"
                      onClick={() => applyZoneNudge(['SUB', 'BASS'], 1.5)}
                      className="px-2 py-1 text-[9.5px] font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                      title="Subir Graves (+1.5 dB en 31–125 Hz)"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex items-center bg-emerald-50 border border-emerald-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => applyZoneNudge(['LOW_MID', 'MID', 'HIGH_MID'], -1.5)}
                      className="px-2 py-1 text-[9.5px] font-bold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                      title="Bajar Medios (-1.5 dB en 180 Hz–2.8 kHz)"
                    >
                      Medios -
                    </button>
                    <div className="w-px h-3.5 bg-emerald-200" />
                    <button
                      type="button"
                      onClick={() => applyZoneNudge(['LOW_MID', 'MID', 'HIGH_MID'], 1.5)}
                      className="px-2 py-1 text-[9.5px] font-bold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                      title="Subir Medios (+1.5 dB en 180 Hz–2.8 kHz)"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex items-center bg-violet-50 border border-violet-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => applyZoneNudge(['PRESENCE', 'AIR'], -1.5)}
                      className="px-2 py-1 text-[9.5px] font-bold text-violet-700 hover:bg-violet-100 cursor-pointer"
                      title="Bajar Agudos/Brillo (-1.5 dB en 4k–16k Hz)"
                    >
                      Agudos -
                    </button>
                    <div className="w-px h-3.5 bg-violet-200" />
                    <button
                      type="button"
                      onClick={() => applyZoneNudge(['PRESENCE', 'AIR'], 1.5)}
                      className="px-2 py-1 text-[9.5px] font-bold text-violet-700 hover:bg-violet-100 cursor-pointer"
                      title="Subir Agudos/Brillo (+1.5 dB en 4k–16k Hz)"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div className="h-px bg-zinc-100" />

              {/* Tono del Canal Músicos (CUE In-Ear) */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Headphones size={13} className="text-amber-600" />
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-800">
                    Tono CUE (Click / Guía):
                  </span>
                </div>
                <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                  {(
                    [
                      { id: 'normal', label: 'Original' },
                      { id: 'warm_wood', label: 'Click Suave (In-Ear)' },
                      { id: 'clear_voice', label: 'Guía Cristalina' },
                    ] as { id: CueToneMode; label: string }[]
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        onChangeProfile((prev) => ({ ...prev, cueTone: item.id }))
                      }
                      className={`px-2 py-1 rounded-lg text-[9.5px] font-bold transition-all cursor-pointer ${
                        profile.cueTone === item.id
                          ? 'bg-amber-500 text-white shadow-2xs'
                          : 'text-zinc-600 hover:text-black'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* FILA 2: RACK GRÁFICO DE 18 BANDAS CON ESPECTRO FFT Y CURVA DE RESPUESTA */}
          <div className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-2xs">
            <div className="relative h-24 w-full bg-zinc-50 rounded-xl border border-zinc-200/80 mb-3 overflow-hidden">
              <canvas
                ref={canvasRef}
                width={1180}
                height={96}
                className="w-full h-full block"
              />
              <div className="absolute left-2 top-1.5 bottom-1.5 flex flex-col justify-between pointer-events-none text-[8.5px] font-mono text-zinc-400">
                <span>+12 dB</span>
                <span>0 dB</span>
                <span>-12 dB</span>
              </div>
              <div className="absolute right-2.5 top-1.5 flex items-center gap-1.5 pointer-events-none">
                <span className="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                  SUB / GRAVES
                </span>
                <span className="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                  BARRO / CUERPO
                </span>
                <span className="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                  MEDIOS / POCKET VOCAL
                </span>
                <span className="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 font-bold">
                  PRESENCIA / AIRE
                </span>
              </div>
            </div>

            {/* Las 18 Bandas Verticales */}
            <div
              className="grid gap-1.5 pt-1"
              style={{ gridTemplateColumns: 'repeat(18, minmax(0, 1fr))' }}
            >
              {STAGE_EQ_18_BANDS.map((band, idx) => {
                const gain = profile.gains[idx] || 0;
                const zoneStyle = ZONE_COLORS[band.zone] || ZONE_COLORS.MID;
                const isBoost = gain > 0.05;
                const isCut = gain < -0.05;

                return (
                  <div
                    key={band.index}
                    className="flex flex-col items-center group select-none"
                    title={`${band.label} — ${band.hint} (Doble clic para 0 dB)`}
                  >
                    <span
                      className={`text-[9.5px] font-mono font-bold tabular-nums mb-1 px-1 py-0.5 rounded ${
                        isBoost
                          ? 'bg-rose-50 text-[#e11d48]'
                          : isCut
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-zinc-400'
                      }`}
                    >
                      {gain > 0 ? `+${gain.toFixed(1)}` : gain === 0 ? '0.0' : gain.toFixed(1)}
                    </span>

                    <div
                      className="relative h-36 w-9 rounded-xl bg-zinc-100/90 border border-zinc-200/90 flex items-center justify-center overflow-hidden group-hover:border-zinc-300 transition-colors"
                      onDoubleClick={() => handleBandChange(idx, 0)}
                    >
                      <div className="absolute left-1.5 right-1.5 top-1/2 h-[1.5px] bg-zinc-300 z-0" />
                      <div
                        className="absolute w-2.5 rounded-full transition-all duration-75 pointer-events-none"
                        style={{
                          backgroundColor: isBoost
                            ? zoneStyle.bar
                            : isCut
                            ? '#2563eb'
                            : 'transparent',
                          top:
                            gain >= 0
                              ? `${50 - (gain / 12) * 44}%`
                              : '50%',
                          height: `${(Math.abs(gain) / 12) * 44}%`,
                          opacity: profile.enabled ? 0.85 : 0.25,
                        }}
                      />
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        step="0.5"
                        value={gain}
                        onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                        onDoubleClick={() => handleBandChange(idx, 0)}
                        className="w-32 h-8 -rotate-90 appearance-none bg-transparent cursor-ns-resize z-10"
                        style={{
                          accentColor: zoneStyle.bar,
                        }}
                      />
                    </div>

                    <span
                      className={`mt-1.5 text-[10px] font-mono font-extrabold tracking-tight ${zoneStyle.text}`}
                    >
                      {band.shortLabel}
                    </span>
                    <span className="text-[8px] text-zinc-400 font-medium truncate max-w-[52px] text-center">
                      {band.zone === 'SUB'
                        ? 'Sub'
                        : band.zone === 'BASS'
                        ? 'Grave'
                        : band.zone === 'LOW_MID'
                        ? 'Cuerpo'
                        : band.zone === 'MID'
                        ? 'Medio'
                        : band.zone === 'HIGH_MID'
                        ? 'Pocket'
                        : band.zone === 'PRESENCE'
                        ? 'Brillo'
                        : 'Aire'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FILA 3: MATRIZ DE SALIDA MULTICANAL & STEMS DISCRETOS HACIA CONSOLA FÍSICA */}
          <div className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                  <Cpu size={15} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                      Matriz de Ruteo & Salida Multicanal Discreta a Consola
                    </h4>
                    <span
                      className={`text-[9.5px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                        hardwareMaxChannels >= 4
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-amber-50 text-amber-800 border-amber-300'
                      }`}
                    >
                      Hardware Detectado: {hardwareMaxChannels} Canales Discretos
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Modo discreto (<code className="text-[10px] font-mono">channelInterpretation: &apos;discrete&apos;</code>) con separación estéreo L/R real por <code className="text-[10px] font-mono">ChannelSplitter</code> sin mezcla surround
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {/* Medidores VU en Tiempo Real (Zero-Re-Render vía ref cuando hay Analyser) */}
                <div className="flex items-center gap-4 bg-zinc-50 px-3.5 py-2 rounded-xl border border-zinc-200">
                  <div className="flex items-center gap-2">
                    <Volume2 size={13} className="text-[#e11d48]" />
                    <span className="text-[9.5px] font-bold uppercase text-zinc-700">FOH OUT</span>
                    <div className="w-20 h-2 bg-zinc-200 rounded-full overflow-hidden">
                      <div
                        ref={fohMeterBarRef}
                        className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-[#e11d48]"
                        style={{ width: fohAnalyser ? '0%' : `${Math.min(100, Math.round(fohMeterLevel * 100))}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-px h-4 bg-zinc-300" />
                  <div className="flex items-center gap-2">
                    <Headphones size={13} className="text-amber-600" />
                    <span className="text-[9.5px] font-bold uppercase text-zinc-700">CUE OUT</span>
                    <div className="w-20 h-2 bg-zinc-200 rounded-full overflow-hidden">
                      <div
                        ref={cueMeterBarRef}
                        className="h-full bg-gradient-to-r from-emerald-500 to-amber-500"
                        style={{ width: cueAnalyser ? '0%' : `${Math.min(100, Math.round(cueMeterLevel * 100))}%` }}
                      />
                    </div>
                  </div>
                </div>

                {onOpenSoundcheck && (
                  <button
                    type="button"
                    onClick={onOpenSoundcheck}
                    className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
                    title="Abrir el Módulo Verificador de Hardware & Soundcheck Canal por Canal"
                  >
                    <Activity size={13} className="text-[#e11d48]" />
                    <span>Soundcheck & Probar Ch</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3 items-stretch">
              {/* 1. Modo de Salida */}
              <div className="col-span-3 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <label className="text-[9.5px] font-extrabold uppercase tracking-wider text-zinc-600 block mb-1">
                  1. Modo de Salida
                </label>
                <select
                  value={routingMode}
                  onChange={(e) =>
                    onChangeRoutingMode(
                      e.target.value as 'StereoInEar' | 'StereoSplit' | 'MultiChannel'
                    )
                  }
                  className="w-full bg-white border border-zinc-300 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-900 outline-none focus:border-[#e11d48]"
                >
                  <option value="StereoInEar">🎧 In-Ear Estéreo (Ensayo)</option>
                  <option value="StereoSplit">🔀 Split L/R (Cable Y)</option>
                  <option value="MultiChannel">🎛️ USB Multicanal (Consola)</option>
                </select>
              </div>

              {/* 2. Dispositivo USB */}
              <div className="col-span-3 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <label className="text-[9.5px] font-extrabold uppercase tracking-wider text-zinc-600 block mb-1">
                  2. Interfaz de Audio USB
                </label>
                <select
                  value={multiChannelPatch.sinkId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const found = audioOutputs.find((d) => d.deviceId === nextId);
                    onChangeMultiChannelPatch((prev) => ({
                      ...prev,
                      sinkId: nextId,
                      sinkLabel: found?.label || '',
                    }));
                  }}
                  className="w-full bg-white border border-zinc-300 rounded-lg px-2 py-1.5 text-xs font-semibold text-zinc-900 outline-none focus:border-[#e11d48]"
                >
                  <option value="">Predeterminado del Sistema</option>
                  {audioOutputs.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label || `Interfaz USB (${dev.deviceId.slice(0, 6)})`}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Tipo de Envío Multicanal (Bus Estéreo vs Stems Separados) */}
              <div className="col-span-3 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <label className="text-[9.5px] font-extrabold uppercase tracking-wider text-zinc-600 block mb-1">
                  3. Arquitectura de Consola
                </label>
                <div className="flex bg-white border border-zinc-300 rounded-lg p-0.5 gap-0.5">
                  <button
                    type="button"
                    disabled={routingMode !== 'MultiChannel'}
                    onClick={() =>
                      onChangeMultiChannelPatch((prev) => ({
                        ...prev,
                        consoleBusMode: 'stereo_bus',
                      }))
                    }
                    className={`flex-1 py-1 px-2 rounded-md text-[10px] font-bold transition-all cursor-pointer disabled:opacity-45 ${
                      multiChannelPatch.consoleBusMode === 'stereo_bus'
                        ? 'bg-zinc-900 text-white'
                        : 'text-zinc-600 hover:text-black'
                    }`}
                    title="Envía la mezcla musical FOH Estéreo en un par de canales y el Click/Guía en otros canales"
                  >
                    Bus FOH + CUE
                  </button>
                  <button
                    type="button"
                    disabled={routingMode !== 'MultiChannel'}
                    onClick={() =>
                      onChangeMultiChannelPatch((prev) => ({
                        ...prev,
                        consoleBusMode: 'multitrack_stems',
                      }))
                    }
                    className={`flex-1 py-1 px-2 rounded-md text-[10px] font-bold transition-all cursor-pointer disabled:opacity-45 flex items-center justify-center gap-1 ${
                      multiChannelPatch.consoleBusMode === 'multitrack_stems'
                        ? 'bg-[#e11d48] text-white'
                        : 'text-zinc-600 hover:text-black'
                    }`}
                    title="Envía cada instrumento/stem separado a su propio canal físico de la consola USB"
                  >
                    <Layers size={11} />
                    <span>Stems Separados</span>
                  </button>
                </div>
              </div>

              {/* 4. Salida CUE Músicos */}
              <div className="col-span-3 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <label className="text-[9.5px] font-extrabold uppercase tracking-wider text-amber-700 block mb-1">
                  4. Bus MÚSICOS (Click & Guía)
                </label>
                <select
                  disabled={routingMode !== 'MultiChannel'}
                  value={multiChannelPatch.cueRouting}
                  onChange={(e) =>
                    onChangeMultiChannelPatch((prev) => ({
                      ...prev,
                      cueRouting: e.target.value as MultiChannelPatchConfig['cueRouting'],
                    }))
                  }
                  className="w-full bg-white border border-zinc-300 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-900 outline-none disabled:opacity-50"
                >
                  {CUE_ROUTING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Panel específico según Modo Bus Estéreo vs Multitrack Stems Separados */}
            {routingMode === 'MultiChannel' && multiChannelPatch.consoleBusMode === 'stereo_bus' && (
              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#e11d48]">
                    Par Estéreo PÚBLICO (FOH L/R):
                  </span>
                  <select
                    value={multiChannelPatch.fohPair}
                    onChange={(e) =>
                      onChangeMultiChannelPatch((prev) => ({
                        ...prev,
                        fohPair: e.target.value as MultiChannelPatchConfig['fohPair'],
                      }))
                    }
                    className="bg-white border border-zinc-300 rounded-lg px-2.5 py-1 text-xs font-bold text-zinc-900 outline-none"
                  >
                    {CONSOLE_PAIR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="text-[10.5px] text-zinc-500">
                  Ideal para consolas con interfaz de 4+ salidas (ej. 1-2 Música FOH Estéreo + 3-4 Click y Guía).
                </span>
              </div>
            )}

            {routingMode === 'MultiChannel' && multiChannelPatch.consoleBusMode === 'multitrack_stems' && (
              <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200 space-y-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Layers size={14} className="text-[#e11d48]" />
                    <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-900">
                      Patchbay de Instrumentos Separados a Consola (Hasta 16 Ch)
                    </span>
                    {isLoadingStems && (
                      <span className="text-[10px] font-mono text-rose-600 animate-pulse">
                        Cargando stems en RAM...
                      </span>
                    )}
                    {!isLoadingStems && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white border border-zinc-300 text-zinc-700">
                        {loadedStems.length > 0
                          ? `${loadedStems.length} stems listos en esta canción`
                          : 'Sin stems separados (usando Bus FOH de respaldo)'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {loadedStems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowStemOverrides((v) => !v)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 cursor-pointer"
                      >
                        {showStemOverrides ? 'Ocultar Pistas Individuales' : `Asignar por Pista (${loadedStems.length})`}
                      </button>
                    )}

                    {/* Toggle: Aplicar EQ 18 Bandas a Stems vs Direct Out Puro */}
                    <button
                      type="button"
                      onClick={() =>
                        onChangeMultiChannelPatch((prev) => ({
                          ...prev,
                          applyEqToStems: !prev.applyEqToStems,
                        }))
                      }
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                        multiChannelPatch.applyEqToStems
                          ? 'bg-[#e11d48] text-white border-[#e11d48]'
                          : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-400'
                      }`}
                      title="Elige si los stems pasan por el EQ de 18 Bandas + Safety Limiter o salen en Direct Out crudo hacia la consola"
                    >
                      {multiChannelPatch.applyEqToStems
                        ? 'EQ 18B + Limiter: ACTIVO EN STEMS'
                        : 'DIRECT OUT PURO (Sin EQ en Stems)'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2">
                  {STEM_BUS_GROUPS.map((grp) => {
                    const countInSong = loadedStems.filter((st) => st.group === grp.id).length;
                    const targetVal = multiChannelPatch.stemGroupTargets[grp.id];
                    return (
                      <div
                        key={grp.id}
                        className="bg-white p-2.5 rounded-xl border border-zinc-200 flex flex-col justify-between gap-1.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`text-[9.5px] font-extrabold px-1.5 py-0.5 rounded border truncate ${grp.colorClass}`}
                          >
                            {grp.label}
                          </span>
                          <span className="text-[9px] font-mono text-zinc-500 shrink-0">
                            {countInSong}p
                          </span>
                        </div>
                        <select
                          value={targetVal}
                          onChange={(e) =>
                            onChangeMultiChannelPatch((prev) => ({
                              ...prev,
                              stemGroupTargets: {
                                ...prev.stemGroupTargets,
                                [grp.id]: e.target.value as ConsoleTargetAssignment,
                              },
                            }))
                          }
                          className="w-full bg-zinc-50 border border-zinc-300 rounded-lg px-2 py-1 text-[10.5px] font-mono font-bold text-zinc-900 outline-none"
                        >
                          {ALL_CONSOLE_TARGET_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

                {showStemOverrides && loadedStems.length > 0 && (
                  <div className="pt-2 border-t border-zinc-200 grid grid-cols-3 gap-2">
                    {loadedStems.map((st) => {
                      const overrideVal = multiChannelPatch.stemOverrides?.[st.id] || '';
                      const inherited = resolveStemConsoleTarget(
                        { id: st.id, name: st.name, group: st.group, category: detectInstrumentCategory(st.name) },
                        { ...multiChannelPatch, stemOverrides: {} }
                      );
                      return (
                        <div
                          key={st.id}
                          className="bg-white px-2.5 py-2 rounded-xl border border-zinc-200 flex items-center justify-between gap-2"
                        >
                          <span className="text-[10.5px] font-semibold text-zinc-800 truncate" title={st.name}>
                            {st.name}
                          </span>
                          <select
                            value={overrideVal}
                            onChange={(e) => {
                              const val = e.target.value;
                              onChangeMultiChannelPatch((prev) => {
                                const nextOverrides = { ...(prev.stemOverrides || {}) };
                                if (!val) delete nextOverrides[st.id];
                                else nextOverrides[st.id] = val as ConsoleTargetAssignment;
                                return { ...prev, stemOverrides: nextOverrides };
                              });
                            }}
                            className="bg-zinc-50 border border-zinc-300 rounded-lg px-1.5 py-1 text-[10px] font-mono font-bold text-zinc-900 outline-none max-w-[135px]"
                          >
                            <option value="">
                              {inherited.source === 'role_rule' ? 'Regla' : 'Grupo'} ({inherited.target})
                            </option>
                            {ALL_CONSOLE_TARGET_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Balance CUE (Click vs Guía) & Polaridad R */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-50 px-3 py-2 rounded-xl border border-zinc-200 flex items-center justify-between gap-3">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-700 shrink-0">
                  Mix CUE (Click ↔ Guía):
                </span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.1"
                  value={multiChannelPatch.cueBalance || 0}
                  onChange={(e) =>
                    onChangeMultiChannelPatch((prev) => ({
                      ...prev,
                      cueBalance: parseFloat(e.target.value),
                    }))
                  }
                  className="flex-1 h-1.5 accent-amber-600 cursor-pointer"
                />
                <span className="text-[10px] font-mono font-bold text-amber-800 w-12 text-right">
                  {(multiChannelPatch.cueBalance || 0) === 0
                    ? '50/50'
                    : (multiChannelPatch.cueBalance || 0) < 0
                    ? '+Click'
                    : '+Guía'}
                </span>
              </div>

              <div className="bg-zinc-50 px-3 py-2 rounded-xl border border-zinc-200 flex items-center justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-700">
                  Polaridad Canal Derecho (R):
                </span>
                <button
                  type="button"
                  disabled={routingMode === 'StereoSplit' || (routingMode === 'MultiChannel' && hardwareMaxChannels < 4)}
                  onClick={() =>
                    onChangeMultiChannelPatch((prev) => ({
                      ...prev,
                      fohPolarityInvertR: !prev.fohPolarityInvertR,
                    }))
                  }
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                    multiChannelPatch.fohPolarityInvertR
                      ? 'bg-violet-600 text-white border-violet-700'
                      : 'bg-white text-zinc-700 border-zinc-300'
                  }`}
                  title={
                    routingMode === 'StereoSplit' || (routingMode === 'MultiChannel' && hardwareMaxChannels < 4)
                      ? 'Disponible en salidas estéreo/multicanal (deshabilitado en Split L/R para evitar cancelación L+R)'
                      : 'Invierte la polaridad del canal Derecho (R) durante el show'
                  }
                >
                  {multiChannelPatch.fohPolarityInvertR ? '-Φ INVERTIDA' : '+Φ Normal'}
                </button>
              </div>
            </div>

            {/* Alertas unificadas (Colisiones CUE/FOH, BT, Fuera de Rango, Desconexión, Fallback Split) */}
            <StageIoAlertsBanner
              compact
              analysis={patchAnalysis}
              detectedMaxChannels={hardwareMaxChannels}
              fohPairLabel={multiChannelPatch.fohPair}
              activeDeviceLabel={activeOutputLabel}
              sinkStatus={modalSinkStatus}
              savedSinkLabel={multiChannelPatch.sinkLabel}
              onResetToDefaultSink={() =>
                onChangeMultiChannelPatch((prev) => ({
                  ...prev,
                  sinkId: '',
                  sinkLabel: audioOutputs[0]?.label || '',
                }))
              }
              onTrustWiredDevice={(label) =>
                onChangeMultiChannelPatch((prev) => ({
                  ...prev,
                  trustedWiredDeviceLabels: Array.from(
                    new Set([...(prev.trustedWiredDeviceLabels || []), label])
                  ),
                }))
              }
            />

            {/* Estado final cuando todo está en orden */}
            {patchAnalysis.preflightLevel === 'ready' && !patchAnalysis.isFallbackSplit && (
              <div className="px-3.5 py-2 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-900 text-[11px] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-600 shrink-0" />
                  <span>
                    {routingMode === 'MultiChannel' ? (
                      multiChannelPatch.consoleBusMode === 'multitrack_stems' ? (
                        <>
                          <strong>Multitrack Discreto Activo ({hardwareMaxChannels} Ch):</strong> Instrumentos separados saliendo por sus canales asignados en consola + Bus MÚSICOS (Click/Guía) aislado en{' '}
                          <strong>{multiChannelPatch.cueRouting}</strong>.
                        </>
                      ) : (
                        <>
                          <strong>Multicanal Estéreo Discreto Activo:</strong> Bus PÚBLICO (FOH Estéreo L/R con EQ 18 Bandas + Safety Limiter) en{' '}
                          <strong>Salidas {multiChannelPatch.fohPair}</strong> y Bus MÚSICOS (Click/Guía) en{' '}
                          <strong>Salidas {multiChannelPatch.cueRouting}</strong> sin mezcla cruzada.
                        </>
                      )
                    ) : routingMode === 'StereoSplit' ? (
                      <>
                        <strong>Modo Split L/R (Cable Y) Activo:</strong> Canal Izquierdo (L) ={' '}
                        <strong>Músicos (Click + Guía)</strong> &bull; Canal Derecho (R) ={' '}
                        <strong>Público (FOH con EQ 18 Bandas + Safety Limiter)</strong>. Aislamiento total para consolas de 2 canales.
                      </>
                    ) : (
                      <>
                        <strong>Modo In-Ear Estéreo Activo (Recomendado para Ensayos):</strong> Música Estéreo FOH (procesada por el EQ de 18 Bandas) + Click/Guía centrados en tus audífonos.
                      </>
                    )}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-emerald-700 font-bold shrink-0">
                  READY FOR STAGE
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
