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
  | '1-mono'
  | '2-mono'
  | '3-mono'
  | '4-mono'
  | '5-mono'
  | '6-mono'
  | '7-mono'
  | '8-mono'
  | '9-mono'
  | '10-mono'
  | '11-mono'
  | '12-mono'
  | '13-mono'
  | '14-mono'
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
  { value: '5-mono', label: 'Salida 5 Mono (Click+Guía)', minChannels: 5 },
  { value: '6-mono', label: 'Salida 6 Mono (Click+Guía)', minChannels: 6 },
  { value: '7-8', label: 'Salidas 7–8 (7=Click, 8=Guía)', minChannels: 8 },
  { value: '7-mono', label: 'Salida 7 Mono (Click+Guía)', minChannels: 7 },
  { value: '8-mono', label: 'Salida 8 Mono (Click+Guía)', minChannels: 8 },
  { value: '9-10', label: 'Salidas 9–10 (9=Click, 10=Guía)', minChannels: 10 },
  { value: '9-mono', label: 'Salida 9 Mono (Click+Guía)', minChannels: 9 },
  { value: '10-mono', label: 'Salida 10 Mono (Click+Guía)', minChannels: 10 },
  { value: '11-12', label: 'Salidas 11–12 (Estéreo CUE)', minChannels: 12 },
  { value: '11-mono', label: 'Salida 11 Mono (Click+Guía)', minChannels: 11 },
  { value: '12-mono', label: 'Salida 12 Mono (Click+Guía)', minChannels: 12 },
  { value: '13-14', label: 'Salidas 13–14 (Estéreo CUE)', minChannels: 14 },
  { value: '13-mono', label: 'Salida 13 Mono (Click+Guía)', minChannels: 13 },
  { value: '14-mono', label: 'Salida 14 Mono (Click+Guía)', minChannels: 14 },
  { value: '15-16', label: 'Salidas 15–16 (15=Click, 16=Guía)', minChannels: 16 },
  { value: '15-mono', label: 'Salida 15 Mono (Click+Guía)', minChannels: 15 },
  { value: '16-mono', label: 'Salida 16 Mono (Click+Guía)', minChannels: 16 },
  { value: '1-2', label: 'Salidas 1–2 (Monitoreo)', minChannels: 2 },
  { value: '1-mono', label: 'Salida 1 Mono (Click+Guía)', minChannels: 1 },
  { value: '2-mono', label: 'Salida 2 Mono (Click+Guía)', minChannels: 2 },
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

export type StemRuleKey =
  | 'kick'
  | 'snare'
  | 'percussion'
  | 'bass'
  | 'piano'
  | 'synth_pad'
  | 'electric_guitar'
  | 'acoustic_guitar'
  | 'brass_winds'
  | 'vocals'
  | 'fx';

export interface StemRoleRuleSpec {
  key: StemRuleKey;
  label: string;
  group: StemBusGroupId;
}

export const STEM_ROLE_RULES: StemRoleRuleSpec[] = [
  { key: 'kick',            label: 'Bombo (Kick)',        group: 'drums_perc' },
  { key: 'snare',           label: 'Caja / Redoblante',   group: 'drums_perc' },
  { key: 'percussion',      label: 'Toms / OH / Perc.',   group: 'drums_perc' },
  { key: 'bass',            label: 'Bajo / Sub Bass',     group: 'bass' },
  { key: 'piano',           label: 'Piano / Teclados',    group: 'keys_synth' },
  { key: 'synth_pad',       label: 'Pads / Synth / Strings', group: 'keys_synth' },
  { key: 'electric_guitar', label: 'Guitarra Eléctrica',  group: 'guitars' },
  { key: 'acoustic_guitar', label: 'Guitarra Acústica',   group: 'guitars' },
  { key: 'brass_winds',     label: 'Metales / Brass',     group: 'vocals_other' },
  { key: 'vocals',          label: 'Voces / Coros',       group: 'vocals_other' },
  { key: 'fx',              label: 'FX / Ambientes',      group: 'vocals_other' },
];

export interface MultiChannelPatchConfig {
  consoleBusMode: ConsoleBusMode;
  fohPair: ConsoleStereoPair;
  cueRouting: CueRoutingTarget;
  sinkId: string;
  sinkLabel?: string;
  applyEqToStems: boolean;
  fohPolarityInvertR?: boolean;
  cueBalance?: number; // -1 (Solo Click L) .. 0 (50/50) .. +1 (Solo Guía R)
  trustedWiredDeviceLabels?: string[];
  syncOffsetMs?: number;
  stemGroupTargets: Record<StemBusGroupId, ConsoleTargetAssignment>;
  stemRoleRules?: Partial<Record<StemRuleKey, ConsoleTargetAssignment>>;
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
  fohPolarityInvertR: false,
  cueBalance: 0,
  trustedWiredDeviceLabels: [],
  syncOffsetMs: 0,
  stemGroupTargets: {
    drums_perc: '1-2',
    bass: 'ch-3',
    keys_synth: 'ch-4',
    guitars: 'ch-5',
    vocals_other: 'ch-6',
  },
  stemRoleRules: {},
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

export function normalizeMultiChannelPatch(
  raw?: Partial<MultiChannelPatchConfig> | null
): MultiChannelPatchConfig {
  const loaded = raw || {};
  const rawBalance = typeof loaded.cueBalance === 'number' && Number.isFinite(loaded.cueBalance)
    ? Math.max(-1, Math.min(1, loaded.cueBalance))
    : 0;
  const rawSyncOffset = typeof loaded.syncOffsetMs === 'number' && Number.isFinite(loaded.syncOffsetMs)
    ? Math.max(-300, Math.min(500, Math.round(loaded.syncOffsetMs)))
    : 0;

  return {
    ...DEFAULT_MULTICHANNEL_PATCH,
    ...loaded,
    fohPolarityInvertR: Boolean(loaded.fohPolarityInvertR),
    cueBalance: rawBalance,
    trustedWiredDeviceLabels: Array.isArray(loaded.trustedWiredDeviceLabels)
      ? loaded.trustedWiredDeviceLabels.filter((x): x is string => typeof x === 'string')
      : [],
    syncOffsetMs: rawSyncOffset,
    stemGroupTargets: {
      ...DEFAULT_MULTICHANNEL_PATCH.stemGroupTargets,
      ...(loaded.stemGroupTargets || {}),
    },
    stemRoleRules: {
      ...(loaded.stemRoleRules || {}),
    },
    stemOverrides: {
      ...(loaded.stemOverrides || {}),
    },
  };
}

export function loadNormalizedMultiChannelPatch(): MultiChannelPatchConfig {
  const loaded = loadStoredJson<MultiChannelPatchConfig>(
    LIVE_STORAGE_KEYS.MC_PATCH,
    DEFAULT_MULTICHANNEL_PATCH
  );
  return normalizeMultiChannelPatch(loaded);
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

export function loadStoredEqScope(): EqMemoryScope {
  try {
    const saved = localStorage.getItem(LIVE_STORAGE_KEYS.EQ_SCOPE);
    return saved === 'per_song' ? 'per_song' : 'global';
  } catch {}
  return 'global';
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

export function serializeVenueProfilesJson(profiles: VenueRigProfile[]): string {
  return JSON.stringify(
    {
      schema: 'tandu_venue_rig_profiles_v1',
      exportedAt: new Date().toISOString(),
      profiles,
    },
    null,
    2
  );
}

export function parseImportedVenueProfilesJson(rawJson: string): VenueRigProfile[] {
  const parsed = JSON.parse(rawJson);
  const candidateList: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as any).profiles)
    ? (parsed as any).profiles
    : [];

  if (!Array.isArray(candidateList) || candidateList.length === 0) {
    throw new Error('El archivo no contiene perfiles de consola válidos.');
  }

  return candidateList
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object' && typeof (item as any).name === 'string'))
    .map((item, idx) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `rig_imp_${Date.now()}_${idx}`,
      name: item.name.trim(),
      deviceLabel: typeof item.deviceLabel === 'string' ? item.deviceLabel : 'Predeterminado',
      sinkId: typeof item.sinkId === 'string' ? item.sinkId : '',
      routingMode:
        item.routingMode === 'StereoSplit' || item.routingMode === 'MultiChannel'
          ? item.routingMode
          : 'StereoInEar',
      patch: normalizeMultiChannelPatch(item.patch),
      eqPresetId: typeof item.eqPresetId === 'string' ? item.eqPresetId : undefined,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    }));
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

export function subscribeStageIoUpdates(
  onUpdate: (source: string) => void,
  options?: { ignoreSource?: string }
): () => void {
  const ignoreSource = options?.ignoreSource;
  const dispatchIfExternal = (src: unknown) => {
    const source = typeof src === 'string' ? src : 'unknown';
    if (ignoreSource && source === ignoreSource) return;
    onUpdate(source);
  };

  const handleDom = (ev: Event) => {
    const detail = (ev as CustomEvent<{ source?: string }>)?.detail;
    dispatchIfExternal(detail?.source);
  };
  window.addEventListener(STAGE_IO_DOM_EVENT, handleDom);

  let bc: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel(STAGE_IO_CHANNEL);
    bc.onmessage = (ev) => {
      if (ev.data?.type === 'STAGE_IO_UPDATED') {
        dispatchIfExternal(ev.data.source);
      }
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

export interface StageStemInput {
  id: string;
  name?: string;
  group: StemBusGroupId;
  category?: InstrumentCategory;
}

function normalizeMatchText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Clasifica un stem en un rol semántico reutilizable entre canciones del repertorio.
 */
export function detectStemRuleKey(
  stemName: string,
  category?: InstrumentCategory
): StemRuleKey | null {
  const n = normalizeMatchText(stemName || '');

  if (/\b(kick|bombo|bd|bass\s*drum)\b/.test(n)) return 'kick';
  if (/\b(snare|redoblante|tarola|caja|sd|rim)\b/.test(n)) return 'snare';
  if (
    category === 'percussion' ||
    category === 'drums' ||
    /\b(perc|shaker|conga|bongo|timbal|pander|tambourine|toms?|hi.?hat|hh|overhead|oh|cymbal|platillo|drum|bat)\b/.test(n)
  ) {
    return 'percussion';
  }
  if (category === 'bass' || /\b(bass|bajo|sub\s*bass|808)\b/.test(n)) return 'bass';
  if (category === 'electric_guitar' || /\b(electric\s*(gtr|guitar)|guit\.?\s*electrica|eg\b)/.test(n)) {
    return 'electric_guitar';
  }
  if (category === 'acoustic_guitar' || /\b(acoustic\s*(gtr|guitar)|guit\.?\s*acustica|ag\b|nylon)\b/.test(n)) {
    return 'acoustic_guitar';
  }
  if (category === 'guitar' || /\b(guitar|guit|gtr)\b/.test(n)) return 'electric_guitar';
  if (category === 'piano' || category === 'accordion' || /\b(piano|keys?|teclad|rhodes|wurlitzer|organ|hammond|acordeon)\b/.test(n)) {
    return 'piano';
  }
  if (category === 'synth' || category === 'strings' || /\b(synth|pad|sinte|string|cuerda|arp|lead|atmos|shimmer)\b/.test(n)) {
    return 'synth_pad';
  }
  if (category === 'brass' || /\b(brass|metal|trumpet|trompeta|sax|trombone|horn)\b/.test(n)) {
    return 'brass_winds';
  }
  if (category === 'voice' || category === 'vocals' || /\b(voc|vox|coro|choir|bgv|backing|voz)\b/.test(n)) {
    return 'vocals';
  }
  if (/\b(fx|sfx|riser|impact|sweep|efecto)\b/.test(n)) return 'fx';

  return null;
}

/**
 * Resuelve el destino físico exacto de un stem aplicando precedencia única:
 * 1) Excepción específica por ID de pista (stemOverrides)
 * 2) Regla global por instrumento/rol (stemRoleRules)
 * 3) Destino de grupo general (stemGroupTargets)
 */
export function resolveStemConsoleTarget(
  stem: StageStemInput,
  patch: MultiChannelPatchConfig
): { target: ConsoleTargetAssignment; source: 'stem_override' | 'role_rule' | 'group' } {
  const override = patch.stemOverrides?.[stem.id];
  if (override) {
    return { target: override, source: 'stem_override' };
  }
  const ruleKey = detectStemRuleKey(stem.name || '', stem.category);
  if (ruleKey && patch.stemRoleRules?.[ruleKey]) {
    return { target: patch.stemRoleRules[ruleKey]!, source: 'role_rule' };
  }
  return {
    target: patch.stemGroupTargets[stem.group] || '1-2',
    source: 'group',
  };
}

/**
 * Calcula ganancia izquierda/derecha del bus CUE según balance Click (L) vs Guía (R).
 */
export function computeCueBalanceGains(cueBalance = 0): { leftGain: number; rightGain: number } {
  const b = Number.isFinite(cueBalance) ? Math.max(-1, Math.min(1, cueBalance)) : 0;
  return {
    leftGain: b > 0 ? Math.max(0, 1 - b) : 1,
    rightGain: b < 0 ? Math.max(0, 1 + b) : 1,
  };
}

function isStageStemObjectArray(
  items?: (string | StageStemInput)[]
): items is StageStemInput[] {
  return Array.isArray(items) && items.length > 0 && typeof items[0] === 'object' && items[0] !== null;
}

/**
 * Calcula la cantidad mínima de canales del ChannelMergerNode según el parcheo actual
 */
export function computeRequiredMergerChannels(
  patch: MultiChannelPatchConfig,
  maxHardwareChannels: number,
  activeStems?: (string | StageStemInput)[]
): number {
  const cueReq = resolveCueIndices(patch.cueRouting, maxHardwareChannels).requiredChannels;
  if (patch.consoleBusMode === 'stereo_bus') {
    const fohReq = resolveConsoleTarget(patch.fohPair, maxHardwareChannels).requiredChannels;
    return Math.min(maxHardwareChannels, Math.max(4, fohReq, cueReq));
  }

  let maxStemReq = 4;
  if (Array.isArray(activeStems) && activeStems.length === 0) {
    // Canción sin stems separados -> LiveConcert usa Bus FOH estéreo como respaldo
    const fohReq = resolveConsoleTarget(patch.fohPair, maxHardwareChannels).requiredChannels;
    return Math.min(maxHardwareChannels, Math.max(4, fohReq, cueReq));
  }

  if (isStageStemObjectArray(activeStems)) {
    activeStems.forEach((st) => {
      const { target } = resolveStemConsoleTarget(st, patch);
      const req = resolveConsoleTarget(target, maxHardwareChannels).requiredChannels;
      if (req > maxStemReq) maxStemReq = req;
    });
    return Math.min(maxHardwareChannels, Math.max(4, maxStemReq, cueReq));
  }

  // Modo heredado (IDs de string o sin info de canción cargada)
  const activeIds = Array.isArray(activeStems) ? activeStems : undefined;
  (Object.values(patch.stemGroupTargets) as ConsoleTargetAssignment[]).forEach((t) => {
    const req = resolveConsoleTarget(t, maxHardwareChannels).requiredChannels;
    if (req > maxStemReq) maxStemReq = req;
  });
  Object.entries(patch.stemOverrides || {}).forEach(([stemId, target]) => {
    if (activeIds && !activeIds.includes(stemId)) return;
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

function getTargetRequiredChannelCount(target: string): number {
  if (target.endsWith('-mono')) return parseInt(target.split('-')[0], 10) || 3;
  if (target.startsWith('ch-')) return parseInt(target.replace('ch-', ''), 10) || 1;
  const parts = target.split('-').map((n) => parseInt(n, 10));
  return Number.isFinite(parts[1]) ? parts[1] : 2;
}

/**
 * Detecta asignaciones cuyo canal excede la capacidad real de la interfaz conectada
 * (evita recortes silenciosos o colisiones ocultas).
 */
export function detectOutOfRangeAssignments(
  routingMode: RoutingMode,
  patch: MultiChannelPatchConfig,
  maxHardwareChannels: number,
  activeStems?: (string | StageStemInput)[]
): OutOfRangeAssignment[] {
  if (routingMode !== 'MultiChannel' || maxHardwareChannels < 4) return [];
  const issues: OutOfRangeAssignment[] = [];

  const cueReq = getTargetRequiredChannelCount(patch.cueRouting);
  if (cueReq > maxHardwareChannels) {
    issues.push({ busLabel: 'Bus MÚSICOS (CUE)', target: patch.cueRouting, requiredChannels: cueReq });
  }

  if (patch.consoleBusMode === 'stereo_bus') {
    const fohReq = getTargetRequiredChannelCount(patch.fohPair);
    if (fohReq > maxHardwareChannels) {
      issues.push({ busLabel: 'Bus PÚBLICO (FOH)', target: patch.fohPair, requiredChannels: fohReq });
    }
    return issues;
  }

  if (Array.isArray(activeStems) && activeStems.length === 0) {
    const fohReq = getTargetRequiredChannelCount(patch.fohPair);
    if (fohReq > maxHardwareChannels) {
      issues.push({ busLabel: 'Bus Respaldo FOH', target: patch.fohPair, requiredChannels: fohReq });
    }
    return issues;
  }

  if (isStageStemObjectArray(activeStems)) {
    const seenKeys = new Set<string>();
    activeStems.forEach((st) => {
      const resolved = resolveStemConsoleTarget(st, patch);
      const req = getTargetRequiredChannelCount(resolved.target);
      if (req > maxHardwareChannels) {
        const busLabel =
          resolved.source === 'group'
            ? STEM_BUS_GROUPS.find((g) => g.id === st.group)?.label || st.group
            : st.name || st.id.slice(0, 6);
        const dedupeKey = `${busLabel}::${resolved.target}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          issues.push({ busLabel, target: resolved.target, requiredChannels: req });
        }
      }
    });
    return issues;
  }

  const activeIds = Array.isArray(activeStems) ? activeStems : undefined;
  STEM_BUS_GROUPS.forEach((grp) => {
    const target = patch.stemGroupTargets[grp.id];
    const req = getTargetRequiredChannelCount(target);
    if (req > maxHardwareChannels) {
      issues.push({ busLabel: grp.label, target, requiredChannels: req });
    }
  });
  Object.entries(patch.stemOverrides || {}).forEach(([stemId, target]) => {
    if (activeIds && !activeIds.includes(stemId)) return;
    const req = getTargetRequiredChannelCount(target);
    if (req > maxHardwareChannels) {
      issues.push({ busLabel: `Pista (${stemId.slice(0, 6)})`, target, requiredChannels: req });
    }
  });

  return issues;
}

export interface ChannelRoleBadge {
  label: string;
  kind: 'foh' | 'cue' | 'stem';
}

export interface CueFohConflict {
  chNum: number;
  cueLabels: string[];
  musicLabels: string[];
}

export interface StagePatchAnalysis {
  effectiveRoutingMode: RoutingMode;
  isFallbackSplit: boolean;
  isMultitrackFallbackToFoh: boolean;
  channelCountToDisplay: number;
  channelAssignments: { roles: ChannelRoleBadge[] }[];
  cueFohConflicts: CueFohConflict[];
  outOfRangeIssues: OutOfRangeAssignment[];
  isBluetoothRisk: boolean;
  preflightLevel: 'ready' | 'warning' | 'critical';
}

/**
 * Fuente única de verdad para validar conflictos, rango hardware y mapa de canales
 * entre StageSoundcheck, StageEqualizerConsole y LiveConcert.
 */
export function analyzeStagePatch(
  routingMode: RoutingMode,
  patch: MultiChannelPatchConfig,
  maxHardwareChannels: number,
  stems?: StageStemInput[],
  options?: {
    activeDeviceLabel?: string;
    activeDeviceLatencyMs?: number;
    sinkMissingOrRejected?: boolean;
  }
): StagePatchAnalysis {
  const safeMaxCh = Math.max(2, maxHardwareChannels || 2);
  const isFallbackSplit = routingMode === 'MultiChannel' && safeMaxCh < 4;
  const effectiveRoutingMode: RoutingMode = isFallbackSplit ? 'StereoSplit' : routingMode;

  const channelCountToDisplay = Math.max(4, Math.min(16, safeMaxCh >= 4 ? safeMaxCh : 4));
  const channelAssignments: { roles: ChannelRoleBadge[] }[] = Array.from(
    { length: channelCountToDisplay },
    () => ({ roles: [] })
  );

  const hasKnownStemsList = Array.isArray(stems);
  const isMultitrackFallbackToFoh =
    routingMode === 'MultiChannel' &&
    safeMaxCh >= 4 &&
    patch.consoleBusMode === 'multitrack_stems' &&
    hasKnownStemsList &&
    stems.length === 0;

  if (effectiveRoutingMode === 'StereoInEar') {
    channelAssignments[0].roles.push({ label: 'FOH L + CUE', kind: 'foh' });
    channelAssignments[1].roles.push({ label: 'FOH R + CUE', kind: 'foh' });
  } else if (effectiveRoutingMode === 'StereoSplit') {
    channelAssignments[0].roles.push({ label: 'MÚSICOS (Click/Guía)', kind: 'cue' });
    channelAssignments[1].roles.push({ label: 'PÚBLICO (FOH Mono)', kind: 'foh' });
  } else {
    const cuePos = resolveCueIndices(patch.cueRouting, channelCountToDisplay);
    if (cuePos.isMono) {
      channelAssignments[cuePos.leftIdx]?.roles.push({ label: 'CUE (Click+Guía)', kind: 'cue' });
    } else {
      channelAssignments[cuePos.leftIdx]?.roles.push({ label: 'CUE L (Click)', kind: 'cue' });
      channelAssignments[cuePos.rightIdx]?.roles.push({ label: 'CUE R (Guía)', kind: 'cue' });
    }

    if (patch.consoleBusMode === 'stereo_bus' || isMultitrackFallbackToFoh) {
      const [fL, fR] = resolvePairIndices(patch.fohPair, channelCountToDisplay);
      channelAssignments[fL]?.roles.push({ label: 'FOH Público L', kind: 'foh' });
      channelAssignments[fR]?.roles.push({ label: 'FOH Público R', kind: 'foh' });
    } else if (hasKnownStemsList && stems.length > 0) {
      // Evaluar exclusivamente destinos con stems activos en esta canción (sin falsos positivos de grupos vacíos u ocultos)
      const groupBuckets = new Map<string, string>();
      const pushBadge = (target: ConsoleTargetAssignment, label: string) => {
        const res = resolveConsoleTarget(target, channelCountToDisplay);
        if (res.isMono) {
          channelAssignments[res.leftIdx]?.roles.push({ label, kind: 'stem' });
        } else {
          channelAssignments[res.leftIdx]?.roles.push({ label: `${label} (L)`, kind: 'stem' });
          channelAssignments[res.rightIdx]?.roles.push({ label: `${label} (R)`, kind: 'stem' });
        }
      };

      stems.forEach((st) => {
        const resolved = resolveStemConsoleTarget(st, patch);
        if (resolved.source === 'group') {
          const grpLabel = STEM_BUS_GROUPS.find((g) => g.id === st.group)?.label || st.group;
          const bucketKey = `${st.group}::${resolved.target}`;
          if (!groupBuckets.has(bucketKey)) {
            groupBuckets.set(bucketKey, grpLabel);
            pushBadge(resolved.target, grpLabel);
          }
        } else {
          const suffix = resolved.source === 'role_rule' ? 'Regla' : 'Solo';
          pushBadge(resolved.target, `${st.name || st.group} (${suffix})`);
        }
      });
    } else {
      // Sin lista de stems cargada aún: mostrar mapa general de grupos
      STEM_BUS_GROUPS.forEach((grp) => {
        const res = resolveConsoleTarget(patch.stemGroupTargets[grp.id], channelCountToDisplay);
        if (res.isMono) {
          channelAssignments[res.leftIdx]?.roles.push({ label: grp.label, kind: 'stem' });
        } else {
          channelAssignments[res.leftIdx]?.roles.push({ label: `${grp.label} (L)`, kind: 'stem' });
          channelAssignments[res.rightIdx]?.roles.push({ label: `${grp.label} (R)`, kind: 'stem' });
        }
      });
    }
  }

  const cueFohConflicts: CueFohConflict[] =
    effectiveRoutingMode === 'MultiChannel'
      ? channelAssignments
          .map((ch, idx) => {
            const cueLabels = ch.roles.filter((r) => r.kind === 'cue').map((r) => r.label);
            const musicLabels = ch.roles.filter((r) => r.kind === 'foh' || r.kind === 'stem').map((r) => r.label);
            return { chNum: idx + 1, cueLabels, musicLabels };
          })
          .filter((c) => c.cueLabels.length > 0 && c.musicLabels.length > 0)
      : [];

  const stemsInputForRange = hasKnownStemsList ? stems : undefined;
  const outOfRangeIssues = detectOutOfRangeAssignments(
    routingMode,
    patch,
    safeMaxCh,
    stemsInputForRange
  );

  const isBluetoothRisk = options?.activeDeviceLabel
    ? isDeviceBluetoothSuspect(
        options.activeDeviceLabel,
        options.activeDeviceLatencyMs || 0,
        patch.trustedWiredDeviceLabels
      )
    : false;

  let preflightLevel: 'ready' | 'warning' | 'critical' = 'ready';
  if (cueFohConflicts.length > 0 || options?.sinkMissingOrRejected) {
    preflightLevel = 'critical';
  } else if (isFallbackSplit || outOfRangeIssues.length > 0 || isBluetoothRisk) {
    preflightLevel = 'warning';
  }

  return {
    effectiveRoutingMode,
    isFallbackSplit,
    isMultitrackFallbackToFoh,
    channelCountToDisplay,
    channelAssignments,
    cueFohConflicts,
    outOfRangeIssues,
    isBluetoothRisk,
    preflightLevel,
  };
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
  if (/bluetooth|airpods|galaxy buds|hands-free|a2dp|wh-1000|bose qc|\bbt\b|wireless/i.test(label)) {
    return true;
  }
  // Evita falso positivo en diademas/auriculares cableados por USB ("USB Headset Earphone")
  if (/\bheadset\b/i.test(label) && !/\b(usb|type-c|wired|xlr)\b/i.test(label)) {
    return true;
  }
  return false;
}

export function isDeviceBluetoothSuspect(
  label: string,
  latencyMs: number,
  trustedWiredLabels?: string[]
): boolean {
  if (
    trustedWiredLabels &&
    trustedWiredLabels.some((trusted) => trusted.toLowerCase() === label.toLowerCase())
  ) {
    return false;
  }
  return isBluetoothAudioLabel(label) || latencyMs >= 95;
}

/**
 * Extrae el grupo padre final entre paréntesis respetando paréntesis internos
 * (ej. "Altavoces (Realtek(R) Audio)" -> "Realtek(R) Audio").
 */
export function extractTrailingParenGroup(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed.endsWith(')')) return null;

  let depth = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      depth--;
      if (depth === 0) {
        const inner = trimmed.slice(i + 1, trimmed.length - 1).trim();
        return inner || null;
      }
    }
  }
  return null;
}

export function detectWdmPairGroups(
  physicalEndpoints: Pick<ProbedAudioDevice, 'label' | 'groupId'>[]
): string[] {
  const buckets = new Map<string, Pick<ProbedAudioDevice, 'label' | 'groupId'>[]>();
  physicalEndpoints.forEach((d) => {
    const parentName = extractTrailingParenGroup(d.label);
    if (!parentName) return;
    if (/\b(hdmi|display\s*audio|nvidia high definition|amd high definition)\b/i.test(parentName)) {
      return;
    }
    const list = buckets.get(parentName) || [];
    list.push(d);
    buckets.set(parentName, list);
  });

  const wdmGroups: string[] = [];
  buckets.forEach((items, parentName) => {
    if (items.length < 2) return;
    const hasPairHints = items.some((it) =>
      /(\b\d+\s*[-/]\s*\d+\b|\bline\b|\bout(put)?\b|\bmain\b|\baux\b|\badat\b|\bch(annel)?\s*\d)/i.test(it.label)
    );
    const sameNonEmptyGroupId =
      Boolean(items[0].groupId) && items.every((it) => it.groupId === items[0].groupId);
    if (hasPairHints || sameNonEmptyGroupId) {
      wdmGroups.push(parentName);
    }
  });
  return wdmGroups;
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

  const AudioContextClass =
    (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) ||
    (globalThis as any).AudioContext ||
    (globalThis as any).webkitAudioContext;
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
  const wdmPairGroups = detectWdmPairGroups(physicalEndpoints);

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

function normalizeHardwareAlias(label: string): string {
  const parent = extractTrailingParenGroup(label);
  const base = (parent || label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return base;
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
    let matchDev = physicalDevices.find(
      (d) => d.label.toLowerCase() === prof.deviceLabel.toLowerCase()
    );
    if (!matchDev) {
      const profNorm = normalizeHardwareAlias(prof.deviceLabel);
      if (profNorm.length >= 4) {
        const aliasMatches = physicalDevices.filter(
          (d) => normalizeHardwareAlias(d.label) === profNorm
        );
        if (aliasMatches.length === 1) {
          matchDev = aliasMatches[0];
        }
      }
    }
    if (!matchDev) continue;

    const alreadyActive =
      currentRoutingMode === prof.routingMode &&
      (currentPatch.sinkLabel?.toLowerCase() === prof.deviceLabel.toLowerCase() ||
        currentPatch.sinkLabel?.toLowerCase() === matchDev.label.toLowerCase() ||
        currentPatch.sinkId === matchDev.deviceId);
    if (!alreadyActive) {
      return { profile: prof, device: matchDev };
    }
  }
  return null;
}
