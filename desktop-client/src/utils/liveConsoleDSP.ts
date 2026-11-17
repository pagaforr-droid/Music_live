import { InstrumentCategory } from './instrumentIcons';

export type EqBandZone = 'SUB' | 'BASS' | 'LOW_MID' | 'MID' | 'HIGH_MID' | 'PRESENCE' | 'AIR';

export interface StageEqBandSpec {
  index: number;
  freq: number;
  label: string;
  shortLabel: string;
  type: BiquadFilterType;
  q: number;
  zone: EqBandZone;
  hint: string;
}

/**
 * 18-Band Live Console Surgical & Graphic Equalizer (ISO / Touring Spec)
 * Cubre desde Sub-Graves (31 Hz) hasta Aire de Estudio (16 kHz)
 */
export const STAGE_EQ_18_BANDS: StageEqBandSpec[] = [
  { index: 0,  freq: 31,    label: '31 Hz',   shortLabel: '31',   type: 'lowshelf',  q: 0.707, zone: 'SUB',      hint: 'Sub-Grave Profundo (Infra-Rumble)' },
  { index: 1,  freq: 45,    label: '45 Hz',   shortLabel: '45',   type: 'peaking',   q: 2.15,  zone: 'SUB',      hint: 'Sub-Peso de Bombo y Synth Bass' },
  { index: 2,  freq: 63,    label: '63 Hz',   shortLabel: '63',   type: 'peaking',   q: 2.15,  zone: 'BASS',     hint: 'Fundamental de Bombo (Punch Grave)' },
  { index: 3,  freq: 90,    label: '90 Hz',   shortLabel: '90',   type: 'peaking',   q: 2.15,  zone: 'BASS',     hint: 'Cuerpo Principal del Bajo' },
  { index: 4,  freq: 125,   label: '125 Hz',  shortLabel: '125',  type: 'peaking',   q: 2.15,  zone: 'BASS',     hint: 'Calidez y Golpe de Piso' },
  { index: 5,  freq: 180,   label: '180 Hz',  shortLabel: '180',  type: 'peaking',   q: 2.15,  zone: 'LOW_MID',  hint: 'Grosor de Caja, Guitarras y Pianos' },
  { index: 6,  freq: 250,   label: '250 Hz',  shortLabel: '250',  type: 'peaking',   q: 2.15,  zone: 'LOW_MID',  hint: 'Zona de Congestión / Barro (Mud)' },
  { index: 7,  freq: 355,   label: '355 Hz',  shortLabel: '355',  type: 'peaking',   q: 2.15,  zone: 'LOW_MID',  hint: 'Sonido Encajonado / Cartón (Boxiness)' },
  { index: 8,  freq: 500,   label: '500 Hz',  shortLabel: '500',  type: 'peaking',   q: 2.15,  zone: 'MID',      hint: 'Cuerpo Medio y Plenitud Armónica' },
  { index: 9,  freq: 710,   label: '710 Hz',  shortLabel: '710',  type: 'peaking',   q: 2.15,  zone: 'MID',      hint: 'Definición de Medios y Teclados' },
  { index: 10, freq: 1000,  label: '1 kHz',   shortLabel: '1k',   type: 'peaking',   q: 2.15,  zone: 'MID',      hint: 'Centro Focal y Ataque Rítmico' },
  { index: 11, freq: 1400,  label: '1.4 kHz', shortLabel: '1.4k', type: 'peaking',   q: 2.15,  zone: 'HIGH_MID', hint: 'Presencia de Guitarras y Metales' },
  { index: 12, freq: 2000,  label: '2 kHz',   shortLabel: '2k',   type: 'peaking',   q: 2.15,  zone: 'HIGH_MID', hint: 'Mordida, Claridad y Proyección' },
  { index: 13, freq: 2800,  label: '2.8 kHz', shortLabel: '2.8k', type: 'peaking',   q: 2.15,  zone: 'HIGH_MID', hint: 'Pocket de Voz Principal y Voz Guía' },
  { index: 14, freq: 4000,  label: '4 kHz',   shortLabel: '4k',   type: 'peaking',   q: 2.15,  zone: 'PRESENCE', hint: 'Filo, Articulación y Fatiga In-Ear' },
  { index: 15, freq: 6300,  label: '6.3 kHz', shortLabel: '6.3k', type: 'peaking',   q: 2.15,  zone: 'PRESENCE', hint: 'Sibilancia, Platillos y Brillo Synth' },
  { index: 16, freq: 10000, label: '10 kHz',  shortLabel: '10k',  type: 'peaking',   q: 2.15,  zone: 'AIR',      hint: 'Brillo Fino de Alta Definición' },
  { index: 17, freq: 16000, label: '16 kHz',  shortLabel: '16k',  type: 'highshelf', q: 0.707, zone: 'AIR',      hint: 'Aire de Estudio y Apertura Estéreo' },
];

export type HpfCutoffOption = 0 | 40 | 80 | 110;
export type CueToneMode = 'normal' | 'warm_wood' | 'clear_voice';
export type EqMemoryScope = 'global' | 'per_song';
export type RoutingMode = 'StereoInEar' | 'StereoSplit' | 'MultiChannel';

export interface StageEqProfile {
  enabled: boolean;
  presetId: string;
  hpfFreq: HpfCutoffOption;
  gains: number[]; // 18 valores en dB (-12 a +12)
  limiterEnabled: boolean;
  cueTone: CueToneMode;
}

export type ConsoleBusMode = 'stereo_bus' | 'multitrack_stems';

export type ConsoleStereoPair =
  | '1-2'
  | '3-4'
  | '5-6'
  | '7-8'
  | '9-10'
  | '11-12'
  | '13-14'
  | '15-16';

export type ConsoleMonoChannel =
  | 'ch-1'
  | 'ch-2'
  | 'ch-3'
  | 'ch-4'
  | 'ch-5'
  | 'ch-6'
  | 'ch-7'
  | 'ch-8'
  | 'ch-9'
  | 'ch-10'
  | 'ch-11'
  | 'ch-12'
  | 'ch-13'
  | 'ch-14'
  | 'ch-15'
  | 'ch-16';

export type ConsoleTargetAssignment = ConsoleStereoPair | ConsoleMonoChannel;

export type CueRoutingTarget =
  | ConsoleStereoPair
  | '3-mono'
  | '4-mono'
  | '7-mono'
  | '8-mono'
  | '15-mono'
  | '16-mono'
  | ConsoleMonoChannel;

export const CONSOLE_PAIR_OPTIONS: { value: ConsoleStereoPair; label: string; minChannels: number }[] = [
  { value: '1-2', label: 'Out 1–2 (Estéreo L/R)', minChannels: 2 },
  { value: '3-4', label: 'Out 3–4 (Estéreo L/R)', minChannels: 4 },
  { value: '5-6', label: 'Out 5–6 (Estéreo L/R)', minChannels: 6 },
  { value: '7-8', label: 'Out 7–8 (Estéreo L/R)', minChannels: 8 },
  { value: '9-10', label: 'Out 9–10 (Estéreo L/R)', minChannels: 10 },
  { value: '11-12', label: 'Out 11–12 (Estéreo L/R)', minChannels: 12 },
  { value: '13-14', label: 'Out 13–14 (Estéreo L/R)', minChannels: 14 },
  { value: '15-16', label: 'Out 15–16 (Estéreo L/R)', minChannels: 16 },
];

export const CONSOLE_MONO_OPTIONS: { value: ConsoleMonoChannel; label: string; channelNum: number }[] = Array.from(
  { length: 16 },
  (_, idx) => ({
    value: `ch-${idx + 1}` as ConsoleMonoChannel,
    label: `Out ${idx + 1} (Mono)`,
    channelNum: idx + 1,
  })
);

export const ALL_CONSOLE_TARGET_OPTIONS: { value: ConsoleTargetAssignment; label: string; minChannels: number }[] = [
  ...CONSOLE_PAIR_OPTIONS,
  ...CONSOLE_MONO_OPTIONS.map((m) => ({
    value: m.value,
    label: m.label,
    minChannels: m.channelNum,
  })),
];

export const CUE_ROUTING_OPTIONS: { value: CueRoutingTarget; label: string; minChannels: number }[] = [
  { value: '3-4', label: 'Salidas 3–4 (3=Click, 4=Guía)', minChannels: 4 },
  { value: '3-mono', label: 'Salida 3 Mono (Click+Guía)', minChannels: 3 },
  { value: '4-mono', label: 'Salida 4 Mono (Click+Guía)', minChannels: 4 },
  { value: '5-6', label: 'Salidas 5–6 (5=Click, 6=Guía)', minChannels: 6 },
  { value: '7-8', label: 'Salidas 7–8 (7=Click, 8=Guía)', minChannels: 8 },
  { value: '7-mono', label: 'Salida 7 Mono (Click+Guía)', minChannels: 7 },
  { value: '8-mono', label: 'Salida 8 Mono (Click+Guía)', minChannels: 8 },
  { value: '9-10', label: 'Salidas 9–10 (Estéreo CUE)', minChannels: 10 },
  { value: '11-12', label: 'Salidas 11–12 (Estéreo CUE)', minChannels: 12 },
  { value: '13-14', label: 'Salidas 13–14 (Estéreo CUE)', minChannels: 14 },
  { value: '15-16', label: 'Salidas 15–16 (15=Click, 16=Guía)', minChannels: 16 },
  { value: '1-2', label: 'Salidas 1–2 (Monitoreo)', minChannels: 2 },
];

export type StemBusGroupId =
  | 'drums_perc'
  | 'bass'
  | 'keys_synth'
  | 'guitars'
  | 'vocals_other';

export interface StemBusGroupSpec {
  id: StemBusGroupId;
  label: string;
  description: string;
  colorClass: string;
}

export const STEM_BUS_GROUPS: StemBusGroupSpec[] = [
  { id: 'drums_perc',   label: 'Batería & Percusión', description: 'Drums, Kick, Snare, Loops, Percusión', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  { id: 'bass',         label: 'Bajo & Sub',          description: 'Bass eléctrico, Synth Bass',             colorClass: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  { id: 'keys_synth',   label: 'Pianos, Pads & Synths', description: 'Piano, Rhodes, Pads, Strings, Synth', colorClass: 'text-sky-700 bg-sky-50 border-sky-200' },
  { id: 'guitars',      label: 'Guitarras',           description: 'Eléctricas, Acústicas, Riffs',         colorClass: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  { id: 'vocals_other', label: 'Coros, Metales & FX', description: 'Voces, Coros, Brass, Otros stems',     colorClass: 'text-rose-700 bg-rose-50 border-rose-200' },
];

export function mapInstrumentCategoryToBusGroup(category: InstrumentCategory): StemBusGroupId {
  switch (category) {
    case 'drums':
    case 'percussion':
      return 'drums_perc';
    case 'bass':
      return 'bass';
    case 'piano':
    case 'synth':
    case 'strings':
    case 'accordion':
      return 'keys_synth';
    case 'electric_guitar':
    case 'acoustic_guitar':
    case 'guitar':
      return 'guitars';
    default:
      return 'vocals_other';
  }
}

export interface MultiChannelPatchConfig {
  consoleBusMode: ConsoleBusMode;
  fohPair: ConsoleStereoPair;
  cueRouting: CueRoutingTarget;
  sinkId: string;
  sinkLabel?: string;
  applyEqToStems: boolean;
  stemGroupTargets: Record<StemBusGroupId, ConsoleTargetAssignment>;
  stemOverrides: Record<string, ConsoleTargetAssignment>;
}

export interface VenueRigProfile {
  id: string;
  name: string;
  deviceLabel: string;
  sinkId: string;
  routingMode: RoutingMode;
  patch: MultiChannelPatchConfig;
  eqPresetId?: string;
  updatedAt: string;
}

export interface StageEqPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  hpfFreq: HpfCutoffOption;
  gains: number[]; // 18 bands
}

export const DEFAULT_18_GAINS = (): number[] => new Array(18).fill(0);

export const STAGE_EQ_PRESETS: StageEqPreset[] = [
  {
    id: 'flat',
    name: 'Flat (Consola Pura)',
    badge: '0 dB',
    description: 'Respuesta plana transparente sin coloración.',
    hpfFreq: 0,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'rehearsal_band',
    name: 'Ensayo con Banda Real',
    badge: 'PRÁCTICA',
    description: 'Recorta sub-graves y abre bolsillo en medios para no chocar con bajo, batería y voces reales en el ensayo.',
    hpfFreq: 80,
    gains: [-5.0, -4.0, -3.0, -2.0, -1.0, -0.5, -2.5, -2.0, 0, 0, -0.5, -1.5, -2.0, -2.5, -1.5, -0.5, 0, 0.5],
  },
  {
    id: 'inear_comfort',
    name: 'In-Ear Sin Fatiga',
    badge: 'IN-EAR',
    description: 'Domina frecuencias filosas (2.8k–10k Hz) para proteger el oído durante ensayos largos con audífonos In-Ear.',
    hpfFreq: 40,
    gains: [-1.5, 0, 1.5, 1.5, 1.0, 0, -1.5, -1.0, 0, 0, 0, -1.0, -1.5, -2.5, -3.5, -3.0, -2.0, -1.0],
  },
  {
    id: 'vocal_pocket',
    name: 'Pocket para Voces en Vivo',
    badge: 'VOCAL SPACE',
    description: 'Atenúa la región de presencia (1.4k–4k Hz) y barro (250 Hz) para que las voces en vivo y la Voz Guía sobresalgan.',
    hpfFreq: 40,
    gains: [0, 0, 1.0, 0.5, 0, -0.5, -2.0, -1.5, -0.5, 0, -1.0, -2.0, -2.5, -3.0, -2.0, 0, 1.0, 1.5],
  },
  {
    id: 'foh_concert_punch',
    name: 'Punch Concierto FOH',
    badge: 'PA LIVE',
    description: 'Curva de contorno profesional (Pultec Low-End + limpieza en 250–355 Hz + Aire en 10k–16k Hz) para sonar grande en PA.',
    hpfFreq: 40,
    gains: [-1.0, 1.5, 2.5, 2.0, 0.5, -1.0, -2.5, -2.0, -0.5, 0, 0, 0.5, 1.0, 1.0, 0.5, 1.0, 2.0, 2.5],
  },
  {
    id: 'anti_mud_hall',
    name: 'Salón con Eco (Anti-Barro)',
    badge: 'ACÚSTICA',
    description: 'Limpia la acumulación de graves-medios (125–500 Hz) típica de locales cerrados o iglesias reverberantes.',
    hpfFreq: 80,
    gains: [-4.0, -3.0, -1.5, -1.0, -2.5, -3.5, -4.0, -3.0, -1.5, 0, 0.5, 1.0, 1.5, 1.5, 1.0, 0.5, 1.0, 1.0],
  },
];

export const DEFAULT_STAGE_EQ_PROFILE: StageEqProfile = {
  enabled: true,
  presetId: 'flat',
  hpfFreq: 0,
  gains: DEFAULT_18_GAINS(),
  limiterEnabled: true,
  cueTone: 'normal',
};

export const DEFAULT_MULTICHANNEL_PATCH: MultiChannelPatchConfig = {
  consoleBusMode: 'stereo_bus',
  fohPair: '1-2',
  cueRouting: '3-4',
  sinkId: '',
  sinkLabel: '',
  applyEqToStems: true,
  stemGroupTargets: {
    drums_perc: '1-2',
    bass: 'ch-3',
    keys_synth: 'ch-4',
    guitars: 'ch-5',
    vocals_other: 'ch-6',
  },
  stemOverrides: {},
};

export const LIVE_STORAGE_KEYS = {
  EQ_GLOBAL: 'tandu_live_concert_eq_global_v1',
  EQ_SONGS: 'tandu_live_concert_eq_songs_v1',
  EQ_SCOPE: 'tandu_live_concert_eq_scope_v1',
  MC_PATCH: 'tandu_live_concert_mc_patch_v1',
  ROUTING_MODE: 'tandu_live_concert_routing_v1',
  VENUE_PROFILES: 'tandu_live_venue_profiles_v1',
  LAST_SOUNDCHECK: 'tandu_live_last_soundcheck_v1',
} as const;

export function loadStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function loadNormalizedMultiChannelPatch(): MultiChannelPatchConfig {
  const loaded = loadStoredJson<MultiChannelPatchConfig>(
    LIVE_STORAGE_KEYS.MC_PATCH,
    DEFAULT_MULTICHANNEL_PATCH
  );
  return {
    ...DEFAULT_MULTICHANNEL_PATCH,
    ...loaded,
    stemGroupTargets: {
      ...DEFAULT_MULTICHANNEL_PATCH.stemGroupTargets,
      ...(loaded.stemGroupTargets || {}),
    },
    stemOverrides: {
      ...(loaded.stemOverrides || {}),
    },
  };
}

export function loadStoredRoutingMode(): RoutingMode {
  try {
    const saved = localStorage.getItem(LIVE_STORAGE_KEYS.ROUTING_MODE);
    if (saved === 'StereoInEar' || saved === 'StereoSplit' || saved === 'MultiChannel') {
      return saved;
    }
  } catch {}
  return 'StereoInEar';
}

export function loadVenueProfiles(): VenueRigProfile[] {
  try {
    const raw = localStorage.getItem(LIVE_STORAGE_KEYS.VENUE_PROFILES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveVenueProfiles(profiles: VenueRigProfile[]): void {
  try {
    localStorage.setItem(LIVE_STORAGE_KEYS.VENUE_PROFILES, JSON.stringify(profiles));
  } catch {}
}

const STAGE_IO_CHANNEL = 'tandu_stage_io_sync';
const STAGE_IO_DOM_EVENT = 'tandu-stage-io-updated';

export function notifyStageIoUpdated(source: string): void {
  try {
    window.dispatchEvent(new CustomEvent(STAGE_IO_DOM_EVENT, { detail: { source, ts: Date.now() } }));
  } catch {}
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(STAGE_IO_CHANNEL);
      bc.postMessage({ type: 'STAGE_IO_UPDATED', source, ts: Date.now() });
      bc.close();
    }
  } catch {}
}

export function subscribeStageIoUpdates(onUpdate: () => void): () => void {
  const handleDom = () => onUpdate();
  window.addEventListener(STAGE_IO_DOM_EVENT, handleDom);

  let bc: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel(STAGE_IO_CHANNEL);
    bc.onmessage = (ev) => {
      if (ev.data?.type === 'STAGE_IO_UPDATED') onUpdate();
    };
  }

  return () => {
    window.removeEventListener(STAGE_IO_DOM_EVENT, handleDom);
    if (bc) bc.close();
  };
}

/**
 * Curva de transferencia Soft-Clip de seguridad a -0.3 dBFS (16,384 puntos)
 */
export function createStageSafetySoftClipCurve(ceilingDb = -0.3): Float32Array<ArrayBuffer> {
  const size = 16384;
  const curve = new Float32Array(size);
  const ceilingLin = Math.pow(10, ceilingDb / 20);
  const kneeStart = ceilingLin * 0.78;
  const headroom = Math.max(0.001, ceilingLin - kneeStart);

  for (let i = 0; i < size; i++) {
    const x = (i * 2) / (size - 1) - 1;
    const absX = Math.abs(x);
    const sign = x < 0 ? -1 : 1;
    if (absX <= kneeStart) {
      curve[i] = x;
    } else {
      const excess = absX - kneeStart;
      curve[i] = sign * Math.min(ceilingLin, kneeStart + headroom * Math.tanh(excess / headroom));
    }
  }
  curve[size >> 1] = 0;
  return curve;
}

/**
 * Compensación automática de headroom cuando se realzan múltiples bandas
 */
export function computeEqAutoHeadroomGain(gains: number[], limiterEnabled: boolean): number {
  if (!limiterEnabled) return 1.0;
  let positiveEnergy = 0;
  let maxBoost = 0;
  for (let i = 0; i < gains.length; i++) {
    const g = gains[i] || 0;
    if (g > 0) {
      positiveEnergy += g * g;
      if (g > maxBoost) maxBoost = g;
    }
  }
  const rmsBoost = Math.sqrt(positiveEnergy / gains.length);
  const effectiveBoostDb = Math.max(maxBoost * 0.45, rmsBoost * 1.15);
  if (effectiveBoostDb <= 1.5) return 1.0;
  const trimDb = -Math.min(6.0, (effectiveBoostDb - 1.5) * 0.65);
  return Math.pow(10, trimDb / 20);
}

/**
 * Convierte cualquier destino de consola ('1-2'..'15-16' o 'ch-1'..'ch-16') en índices base-0 para ChannelMergerNode
 */
export function resolveConsoleTarget(
  target: ConsoleTargetAssignment,
  maxHardwareChannels: number
): { leftIdx: number; rightIdx: number; isMono: boolean; requiredChannels: number } {
  const safeMax = Math.max(2, maxHardwareChannels);
  if (target.startsWith('ch-')) {
    const chNum = parseInt(target.replace('ch-', ''), 10) || 1;
    const clampedIdx = Math.min(Math.max(0, chNum - 1), safeMax - 1);
    return {
      leftIdx: clampedIdx,
      rightIdx: clampedIdx,
      isMono: true,
      requiredChannels: clampedIdx + 1,
    };
  }
  const parts = target.split('-').map((n) => parseInt(n, 10));
  const rawL = Number.isFinite(parts[0]) ? Math.max(0, parts[0] - 1) : 0;
  const rawR = Number.isFinite(parts[1]) ? Math.max(1, parts[1] - 1) : 1;
  const clampedL = Math.min(rawL, safeMax - 2);
  const clampedR = Math.min(rawR, safeMax - 1);
  return {
    leftIdx: clampedL,
    rightIdx: clampedR,
    isMono: false,
    requiredChannels: clampedR + 1,
  };
}

export function resolvePairIndices(
  pair: ConsoleStereoPair,
  maxHardwareChannels: number
): [number, number] {
  const resolved = resolveConsoleTarget(pair, maxHardwareChannels);
  return [resolved.leftIdx, resolved.rightIdx];
}

export function resolveCueIndices(
  cueRouting: CueRoutingTarget,
  maxHardwareChannels: number
): { leftIdx: number; rightIdx: number; isMono: boolean; requiredChannels: number } {
  const safeMax = Math.max(2, maxHardwareChannels);
  if (cueRouting.endsWith('-mono')) {
    const chNum = parseInt(cueRouting.split('-')[0], 10) || 3;
    const clamped = Math.min(Math.max(0, chNum - 1), safeMax - 1);
    return { leftIdx: clamped, rightIdx: clamped, isMono: true, requiredChannels: clamped + 1 };
  }
  return resolveConsoleTarget(cueRouting as ConsoleTargetAssignment, safeMax);
}

/**
 * Calcula la cantidad mínima de canales del ChannelMergerNode según el parcheo actual
 */
export function computeRequiredMergerChannels(
  patch: MultiChannelPatchConfig,
  maxHardwareChannels: number,
  activeStemIds?: string[]
): number {
  const cueReq = resolveCueIndices(patch.cueRouting, maxHardwareChannels).requiredChannels;
  if (patch.consoleBusMode === 'stereo_bus') {
    const fohReq = resolveConsoleTarget(patch.fohPair, maxHardwareChannels).requiredChannels;
    return Math.min(maxHardwareChannels, Math.max(4, fohReq, cueReq));
  }
  let maxStemReq = 4;
  (Object.values(patch.stemGroupTargets) as ConsoleTargetAssignment[]).forEach((t) => {
    const req = resolveConsoleTarget(t, maxHardwareChannels).requiredChannels;
    if (req > maxStemReq) maxStemReq = req;
  });
  const overrideEntries = Object.entries(patch.stemOverrides || {});
  overrideEntries.forEach(([stemId, target]) => {
    if (activeStemIds && !activeStemIds.includes(stemId)) return;
    const req = resolveConsoleTarget(target, maxHardwareChannels).requiredChannels;
    if (req > maxStemReq) maxStemReq = req;
  });
  return Math.min(maxHardwareChannels, Math.max(4, maxStemReq, cueReq));
}

export interface OutOfRangeAssignment {
  busLabel: string;
  target: string;
  requiredChannels: number;
}

/**
 * Detecta asignaciones cuyo canal excede la capacidad real de la interfaz conectada
 * (evita recortes silenciosos o colisiones ocultas).
 */
export function detectOutOfRangeAssignments(
  routingMode: RoutingMode,
  patch: MultiChannelPatchConfig,
  maxHardwareChannels: number,
  activeStemIds?: string[]
): OutOfRangeAssignment[] {
  if (routingMode !== 'MultiChannel' || maxHardwareChannels < 4) return [];
  const issues: OutOfRangeAssignment[] = [];

  const getReq = (target: string): number => {
    if (target.endsWith('-mono')) return parseInt(target.split('-')[0], 10) || 3;
    if (target.startsWith('ch-')) return parseInt(target.replace('ch-', ''), 10) || 1;
    const parts = target.split('-').map((n) => parseInt(n, 10));
    return Number.isFinite(parts[1]) ? parts[1] : 2;
  };

  const cueReq = getReq(patch.cueRouting);
  if (cueReq > maxHardwareChannels) {
    issues.push({ busLabel: 'Bus MÚSICOS (CUE)', target: patch.cueRouting, requiredChannels: cueReq });
  }

  if (patch.consoleBusMode === 'stereo_bus') {
    const fohReq = getReq(patch.fohPair);
    if (fohReq > maxHardwareChannels) {
      issues.push({ busLabel: 'Bus PÚBLICO (FOH)', target: patch.fohPair, requiredChannels: fohReq });
    }
  } else {
    STEM_BUS_GROUPS.forEach((grp) => {
      const target = patch.stemGroupTargets[grp.id];
      const req = getReq(target);
      if (req > maxHardwareChannels) {
        issues.push({ busLabel: grp.label, target, requiredChannels: req });
      }
    });
    Object.entries(patch.stemOverrides || {}).forEach(([stemId, target]) => {
      if (activeStemIds && !activeStemIds.includes(stemId)) return;
      const req = getReq(target);
      if (req > maxHardwareChannels) {
        issues.push({ busLabel: `Pista (${stemId.slice(0, 6)})`, target, requiredChannels: req });
      }
    });
  }

  return issues;
}

/**
 * Cadena DSP compartida para Bus FOH y Stems (HPF + 18 Bandas + Auto-Headroom + Safety Soft-Clip -0.3 dBFS)
 */
export interface StageBusDspNodes {
  hpf: BiquadFilterNode;
  eqBands: BiquadFilterNode[];
  headroomGain: GainNode;
  shaper: WaveShaperNode;
  output: AudioNode;
}

export function createStageBusDspNodes(
  ctx: AudioContext,
  safetyCurve: Float32Array<ArrayBuffer>
): StageBusDspNodes {
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 1;
  hpf.Q.value = 0.707;

  const eqBands = STAGE_EQ_18_BANDS.map((spec) => {
    const biquad = ctx.createBiquadFilter();
    biquad.type = spec.type;
    biquad.frequency.value = spec.freq;
    biquad.Q.value = spec.q;
    biquad.gain.value = 0;
    return biquad;
  });

  const headroomGain = ctx.createGain();
  headroomGain.gain.value = 1.0;

  const shaper = ctx.createWaveShaper();
  shaper.oversample = '2x';
  shaper.curve = safetyCurve;

  let prev: AudioNode = hpf;
  for (const band of eqBands) {
    prev.connect(band);
    prev = band;
  }
  prev.connect(headroomGain);
  headroomGain.connect(shaper);

  return { hpf, eqBands, headroomGain, shaper, output: shaper };
}

export function applyProfileToStageBusDspNodes(
  ctx: AudioContext,
  chain: StageBusDspNodes,
  profile: StageEqProfile,
  safetyCurve: Float32Array<ArrayBuffer>
): void {
  const now = ctx.currentTime;
  const hpfTarget = profile.enabled && profile.hpfFreq > 0 ? profile.hpfFreq : 1;
  chain.hpf.frequency.setTargetAtTime(hpfTarget, now, 0.015);

  chain.eqBands.forEach((node, idx) => {
    const targetGain = profile.enabled ? (profile.gains[idx] ?? 0) : 0;
    node.gain.setTargetAtTime(targetGain, now, 0.018);
  });

  const trimGain = profile.enabled
    ? computeEqAutoHeadroomGain(profile.gains, profile.limiterEnabled)
    : 1.0;
  chain.headroomGain.gain.setTargetAtTime(trimGain, now, 0.02);
  chain.shaper.curve = profile.limiterEnabled ? safetyCurve : null;
}

export function isBluetoothAudioLabel(label: string): boolean {
  return /bluetooth|airpods|galaxy buds|headset|hands-free|a2dp|wh-1000|bose qc|\bbt\b/i.test(label);
}

/**
 * Hardware Probe Universal: Inspecciona todas las salidas de audio disponibles
 * en cualquier dispositivo (Windows, Mac, Linux, Tablet) y mide sus canales discretos reales.
 */
export interface ProbedAudioDevice {
  deviceId: string;
  label: string;
  groupId: string;
  isDefault: boolean;
  maxChannels: number;
  sampleRate: number;
  latencyMs: number;
  supportsSinkSwitch: boolean;
  isBluetoothSuspect: boolean;
}

export type RigHardwareTier = 'multichannel_pro' | 'wdm_multi_pairs' | 'stereo_universal';

export interface HardwareProbeReport {
  scannedAt: string;
  platformSummary: string;
  supportsSetSinkId: boolean;
  labelsHidden: boolean;
  devices: ProbedAudioDevice[];
  bestMaxChannels: number;
  rigTier: RigHardwareTier;
  wdmPairGroups: string[];
  audioContextState: AudioContextState;
}

export async function probeAudioHardware(options?: { unlockLabels?: boolean }): Promise<HardwareProbeReport> {
  if (options?.unlockLabels && navigator.mediaDevices?.getUserMedia) {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());
    } catch {
      // El usuario rechazó el permiso o no hay micrófono; continuamos sin bloquear el escaneo
    }
  }

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const probeCtx = new AudioContextClass();
  if (probeCtx.state === 'suspended') {
    try {
      await probeCtx.resume();
    } catch {}
  }

  const defaultMaxCh = probeCtx.destination.maxChannelCount || 2;
  const defaultSampleRate = probeCtx.sampleRate || 48000;
  const defaultLatencyMs = Math.round(
    (((probeCtx as any).baseLatency || 0) + ((probeCtx as any).outputLatency || 0)) * 1000 * 10
  ) / 10;

  const supportsSetSinkId = typeof (probeCtx as any).setSinkId === 'function';
  let rawOutputs: MediaDeviceInfo[] = [];
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const all = await navigator.mediaDevices.enumerateDevices();
      rawOutputs = all.filter((d) => d.kind === 'audiooutput');
    }
  } catch {}

  const labelsHidden =
    rawOutputs.length > 0 && rawOutputs.every((d) => !d.label || d.label.trim() === '');

  const probedDevices: ProbedAudioDevice[] = [];
  let preCloseCtxState: AudioContextState = probeCtx.state;

  try {
    if (rawOutputs.length === 0) {
      probedDevices.push({
        deviceId: '',
        label: 'Salida de Audio Principal del Dispositivo',
        groupId: 'default',
        isDefault: true,
        maxChannels: defaultMaxCh,
        sampleRate: defaultSampleRate,
        latencyMs: defaultLatencyMs,
        supportsSinkSwitch: false,
        isBluetoothSuspect: false,
      });
    } else {
      for (let i = 0; i < rawOutputs.length; i++) {
        const dev = rawOutputs[i];
        let maxCh = defaultMaxCh;
        let sRate = defaultSampleRate;
        let latMs = defaultLatencyMs;

        if (supportsSetSinkId) {
          try {
            await (probeCtx as any).setSinkId(dev.deviceId === 'default' ? '' : dev.deviceId);
            maxCh = probeCtx.destination.maxChannelCount || 2;
            sRate = probeCtx.sampleRate || 48000;
            const rawLat = ((probeCtx as any).baseLatency || 0) + ((probeCtx as any).outputLatency || 0);
            latMs = Math.round(rawLat * 1000 * 10) / 10;
          } catch {
            // Restaurar valores base del sistema para jamás heredar canales de la iteración anterior
            maxCh = defaultMaxCh;
            sRate = defaultSampleRate;
            latMs = defaultLatencyMs;
          }
        }

        const label = dev.label || `Salida de Audio #${i + 1}`;
        probedDevices.push({
          deviceId: dev.deviceId,
          label,
          groupId: dev.groupId || '',
          isDefault: dev.deviceId === 'default' || (i === 0 && !rawOutputs.some((d) => d.deviceId === 'default')),
          maxChannels: maxCh,
          sampleRate: sRate,
          latencyMs: latMs,
          supportsSinkSwitch: supportsSetSinkId,
          isBluetoothSuspect: isBluetoothAudioLabel(label) || latMs >= 95,
        });
      }
    }
    preCloseCtxState = probeCtx.state;
  } finally {
    try {
      await probeCtx.close();
    } catch {}
  }

  const bestMaxChannels = probedDevices.reduce((max, d) => Math.max(max, d.maxChannels), 2);

  // Filtrar alias virtuales ('default', 'communications') antes de detectar pares WDM divididos
  const physicalEndpoints = probedDevices.filter(
    (d) => d.deviceId !== 'default' && d.deviceId !== 'communications'
  );
  const parenGroups = new Map<string, number>();
  physicalEndpoints.forEach((d) => {
    const match = d.label.match(/\(([^)]+)\)\s*$/);
    if (match && match[1]) {
      const parentName = match[1].trim();
      parenGroups.set(parentName, (parenGroups.get(parentName) || 0) + 1);
    }
  });
  const wdmPairGroups = Array.from(parenGroups.entries())
    .filter(([, count]) => count >= 2)
    .map(([name]) => name);

  let rigTier: RigHardwareTier = 'stereo_universal';
  if (bestMaxChannels >= 4) {
    rigTier = 'multichannel_pro';
  } else if (wdmPairGroups.length > 0) {
    rigTier = 'wdm_multi_pairs';
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const platformSummary = /Mac/i.test(ua)
    ? 'macOS CoreAudio'
    : /iPad|iPhone|iPod/i.test(ua)
    ? 'iOS / iPadOS'
    : /Android/i.test(ua)
    ? 'Android Audio'
    : /Windows/i.test(ua)
    ? 'Windows (WebAudio / WASAPI)'
    : 'Navegador Estándar';

  return {
    scannedAt: new Date().toISOString(),
    platformSummary,
    supportsSetSinkId,
    labelsHidden,
    devices: probedDevices,
    bestMaxChannels,
    rigTier,
    wdmPairGroups,
    audioContextState: preCloseCtxState,
  };
}

/**
 * Busca si existe un perfil de lugar guardado que coincida con algún dispositivo físico conectado
 * y sea diferente a la configuración actualmente activa.
 */
export function findMatchingVenueProfile(
  report: HardwareProbeReport | null,
  profiles: VenueRigProfile[],
  currentPatch: MultiChannelPatchConfig,
  currentRoutingMode: RoutingMode
): { profile: VenueRigProfile; device: ProbedAudioDevice } | null {
  if (!report || profiles.length === 0) return null;
  const physicalDevices = report.devices.filter(
    (d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label.trim() !== ''
  );

  for (const prof of profiles) {
    if (!prof.deviceLabel) continue;
    const matchDev = physicalDevices.find(
      (d) => d.label.toLowerCase() === prof.deviceLabel.toLowerCase()
    );
    if (!matchDev) continue;

    const alreadyActive =
      currentRoutingMode === prof.routingMode &&
      (currentPatch.sinkLabel?.toLowerCase() === prof.deviceLabel.toLowerCase() ||
        currentPatch.sinkId === matchDev.deviceId);
    if (!alreadyActive) {
      return { profile: prof, device: matchDev };
    }
  }
  return null;
}
