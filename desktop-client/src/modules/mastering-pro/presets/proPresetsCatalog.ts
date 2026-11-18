import type {
  DrumKitStyle,
  MasteringDspChain,
  MasteringPreset,
  SurgicalOverrides,
} from '../types/mastering.types';
import { DEFAULT_DRUM_LAYERING_CONFIG } from '../engine/DrumTransientReplacerDSP';
import { DEFAULT_FORENSIC_HUMANIZER_CONFIG } from '../engine/ForensicHumanizerDSP';

export const PRO_PRESETS_CATALOG: MasteringPreset[] = [
  {
    id: 'stadium-pop-rock',
    name: 'Stadium Pop-Rock & Anthem',
    subtitle: 'Pegada de estadio, graves centrados y apertura tridimensional',
    referenceArtists: 'Imagine Dragons · OneRepublic · Coldplay',
    category: 'Rock',
    accentHex: '#FF6B00',
    tags: ['Punch 60Hz', 'Bus Glue 2.8:1', 'Side Air 12kHz', '-10.0 LUFS'],
    description:
      'Empuje calibrado en el sub-bajo central, limpieza quirúrgica de barro en 320Hz, ataque vocal al frente y aire abierto en los lados preservando el punch transiente.',
    targetSpectralProfile: {
      sub: -13.5,
      lowMid: -16.8,
      presence: -14.2,
      air: -18.0,
    },
    dspChain: {
      highPassFreq: 28,
      monoMakerFreq: 110,
      eqBands: [
        {
          id: 'mid-sub-punch',
          label: 'Mid Sub Punch',
          freq: 60,
          gainDb: 2.0,
          q: 0.9,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-mud-cut',
          label: 'Anti-Mud Cut',
          freq: 320,
          gainDb: -1.8,
          q: 2.0,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'mid-vocal-bite',
          label: 'Mid Presence',
          freq: 2800,
          gainDb: 1.5,
          q: 1.1,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-de-harsh',
          label: 'De-Harshness 3.8k',
          freq: 3800,
          gainDb: -0.6,
          q: 3.5,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'stereo-sibilance',
          label: 'De-Sibilance 6.2k',
          freq: 6200,
          gainDb: -0.4,
          q: 3.2,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'side-air-shelf',
          label: 'Side Air Shelf',
          freq: 12000,
          gainDb: 2.5,
          q: 0.7071,
          type: 'highshelf',
          channel: 'side',
          enabled: true,
        },
      ],
      compressor: {
        thresholdDb: -18,
        ratio: 2.8,
        attackSec: 0.03,
        releaseSec: 0.11,
        kneeDb: 6,
        makeupGainDb: 0,
        parallelMix: 0.85,
      },
      saturation: {
        type: 'softclip',
        drive: 0.16,
        warmthTiltDb: 0.4,
      },
      stereoWidth: {
        sideGainDb: 1.4,
        widthPct: 117,
      },
      limiter: {
        targetLufs: -10.0,
        ceilingDbTp: -1.0,
        lookaheadMs: 5.0,
        releaseMs: 65,
        softClipPrePct: 0.25,
      },
    },
  },
  {
    id: 'nu-disco-funk',
    name: 'Nu-Disco & Modern Funk',
    subtitle: 'Groove elástico, bajo articulado y transientes cristalinos',
    referenceArtists: 'Daft Punk · Bruno Mars · Parcels',
    category: 'Funk',
    accentHex: '#00E5FF',
    tags: ['Tight 55Hz', 'Fast Glue 2.5:1', 'Transformer Drive', '-10.0 LUFS'],
    description:
      'Mono Maker alto a 135Hz para un bajo funk ultra enfocado, recorte de congestión en 250Hz y saturación de transformador para realzar el slap y el bombo.',
    targetSpectralProfile: {
      sub: -12.8,
      lowMid: -17.5,
      presence: -14.0,
      air: -17.2,
    },
    dspChain: {
      highPassFreq: 30,
      monoMakerFreq: 135,
      eqBands: [
        {
          id: 'mid-sub-punch',
          label: 'Mid Funk Bass',
          freq: 55,
          gainDb: 2.5,
          q: 1.0,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-mud-cut',
          label: 'Boxiness Cut',
          freq: 250,
          gainDb: -2.2,
          q: 2.2,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'mid-vocal-bite',
          label: 'Snap & Attack',
          freq: 3500,
          gainDb: 1.5,
          q: 1.2,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'stereo-de-harsh',
          label: 'De-Harshness 3.8k',
          freq: 3800,
          gainDb: -0.5,
          q: 3.5,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'stereo-sibilance',
          label: 'De-Sibilance 6.2k',
          freq: 6200,
          gainDb: -0.5,
          q: 3.2,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'side-air-shelf',
          label: 'Side Silk Air',
          freq: 14000,
          gainDb: 2.0,
          q: 0.7071,
          type: 'highshelf',
          channel: 'side',
          enabled: true,
        },
      ],
      compressor: {
        thresholdDb: -16.5,
        ratio: 2.5,
        attackSec: 0.015,
        releaseSec: 0.065,
        kneeDb: 5,
        makeupGainDb: 0,
        parallelMix: 0.82,
      },
      saturation: {
        type: 'transformer',
        drive: 0.16,
        warmthTiltDb: 0.5,
      },
      stereoWidth: {
        sideGainDb: 1.3,
        widthPct: 116,
      },
      limiter: {
        targetLufs: -10.0,
        ceilingDbTp: -1.0,
        lookaheadMs: 5.0,
        releaseMs: 55,
        softClipPrePct: 0.25,
      },
    },
  },
  {
    id: '90s-acoustic-country',
    name: '90s Acoustic & Country-Rock',
    subtitle: 'Calidez orgánica a válvulas, rango dinámico natural y maderas nobles',
    referenceArtists: 'Crowder · Needtobreathe · MTV Unplugged',
    category: 'Acoustic',
    accentHex: '#F59E0B',
    tags: ['Warm 140Hz', 'Gentle 1.8:1', 'Tube Harmonics', '-12.0 LUFS'],
    description:
      'Preserva la respiración de guitarras acústicas y voces íntimas. Cuerpo cálido en 140Hz, doma de dureza de cuerdas en 3.2kHz y aire sedoso a 15kHz.',
    targetSpectralProfile: {
      sub: -15.8,
      lowMid: -15.2,
      presence: -15.0,
      air: -18.5,
    },
    dspChain: {
      highPassFreq: 24,
      monoMakerFreq: 85,
      eqBands: [
        {
          id: 'mid-sub-punch',
          label: 'Acoustic Body',
          freq: 140,
          gainDb: 1.2,
          q: 0.85,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-mud-cut',
          label: 'Low-Mid Clean',
          freq: 290,
          gainDb: -0.8,
          q: 1.8,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'mid-vocal-bite',
          label: 'Vocal Intimacy',
          freq: 2100,
          gainDb: 0.8,
          q: 1.0,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-de-harsh',
          label: 'String Harshness Cut',
          freq: 3200,
          gainDb: -2.0,
          q: 2.5,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'stereo-sibilance',
          label: 'Pick Click Control',
          freq: 6200,
          gainDb: -0.8,
          q: 3.0,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'side-air-shelf',
          label: 'Acoustic Shimmer',
          freq: 15000,
          gainDb: 1.8,
          q: 0.7071,
          type: 'highshelf',
          channel: 'side',
          enabled: true,
        },
      ],
      compressor: {
        thresholdDb: -20,
        ratio: 1.8,
        attackSec: 0.035,
        releaseSec: 0.25,
        kneeDb: 8,
        makeupGainDb: 0,
        parallelMix: 0.72,
      },
      saturation: {
        type: 'tube',
        drive: 0.12,
        warmthTiltDb: 0.7,
      },
      stereoWidth: {
        sideGainDb: 0.7,
        widthPct: 108,
      },
      limiter: {
        targetLufs: -12.0,
        ceilingDbTp: -1.0,
        lookaheadMs: 5.0,
        releaseMs: 90,
        softClipPrePct: 0.15,
      },
    },
  },
  {
    id: 'modern-worship-arena',
    name: 'Modern Worship & Arena Ballad',
    subtitle: 'Voz pastoral al centro, pads envolventes y grandeza atmosférica',
    referenceArtists: 'Jeremy Camp · Elevation · Hillsong United',
    category: 'Worship',
    accentHex: '#38BDF8',
    tags: ['Vocal Focus 1.8k', 'Tape Glue', 'Wide Halo +1.8dB', '-11.0 LUFS'],
    description:
      'Diseñado para adoración moderna y baladas de arena: cimiento profundo en 50Hz, foco vocal nítido en el canal Mid a 1.8kHz y un halo estéreo inmersivo en 10kHz.',
    targetSpectralProfile: {
      sub: -14.0,
      lowMid: -16.2,
      presence: -14.5,
      air: -17.6,
    },
    dspChain: {
      highPassFreq: 26,
      monoMakerFreq: 100,
      eqBands: [
        {
          id: 'mid-sub-punch',
          label: 'Arena Sub Foundation',
          freq: 50,
          gainDb: 1.8,
          q: 0.85,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-mud-cut',
          label: 'Pad Mud Cleanup',
          freq: 280,
          gainDb: -1.4,
          q: 2.0,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'mid-vocal-bite',
          label: 'Mid Vocal Focus',
          freq: 1800,
          gainDb: 1.2,
          q: 1.2,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-de-harsh',
          label: 'Cymbal Smooth 3.8k',
          freq: 3800,
          gainDb: -1.0,
          q: 3.2,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'stereo-sibilance',
          label: 'Vocal De-Ess 6.2k',
          freq: 6200,
          gainDb: -0.9,
          q: 3.4,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'side-air-shelf',
          label: 'Side Arena Halo',
          freq: 10000,
          gainDb: 2.4,
          q: 0.7071,
          type: 'highshelf',
          channel: 'side',
          enabled: true,
        },
      ],
      compressor: {
        thresholdDb: -18,
        ratio: 2.2,
        attackSec: 0.028,
        releaseSec: 0.18,
        kneeDb: 7,
        makeupGainDb: 0,
        parallelMix: 0.8,
      },
      saturation: {
        type: 'tape',
        drive: 0.15,
        warmthTiltDb: 0.6,
      },
      stereoWidth: {
        sideGainDb: 1.8,
        widthPct: 123,
      },
      limiter: {
        targetLufs: -11.0,
        ceilingDbTp: -1.0,
        lookaheadMs: 5.0,
        releaseMs: 75,
        softClipPrePct: 0.2,
      },
    },
  },
  {
    id: 'de-ai-studio-rescue',
    name: 'De-AI Studio Rescue (Suno / Udio)',
    subtitle: 'Cirugía anti-artefactos metálicos, reconstrucción analógica y cinta Studer',
    referenceArtists: 'AI-to-Analog Mastering · Studer A800 Emulation',
    category: 'AI-Restore',
    accentHex: '#10B981',
    tags: ['-3.2dB @ 3.8kHz', '-2.5dB @ 6.2kHz', 'Studer Tape 24%', '-11.5 LUFS'],
    description:
      'Elimina quirúrgicamente la resonancia metálica en 3.8kHz, el aliasing sibilante en 6.2kHz y el barro sintético en 280Hz, devolviendo peso analógico en 95Hz y calidez de cinta.',
    targetSpectralProfile: {
      sub: -13.8,
      lowMid: -16.8,
      presence: -15.4,
      air: -18.2,
    },
    dspChain: {
      highPassFreq: 32,
      monoMakerFreq: 125,
      eqBands: [
        {
          id: 'mid-sub-punch',
          label: 'Analog Body Restore',
          freq: 95,
          gainDb: 1.6,
          q: 0.95,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-mud-cut',
          label: 'AI Low-Mid De-Mud',
          freq: 280,
          gainDb: -2.0,
          q: 2.0,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'mid-vocal-bite',
          label: 'Natural Chest Warmth',
          freq: 1450,
          gainDb: 0.7,
          q: 1.1,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-de-harsh',
          label: 'De-AI Metallic Notch',
          freq: 3800,
          gainDb: -3.2,
          q: 4.0,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'stereo-sibilance',
          label: 'De-Aliasing 6.2kHz',
          freq: 6200,
          gainDb: -2.5,
          q: 3.5,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'side-air-shelf',
          label: 'Analog Silk Air',
          freq: 13000,
          gainDb: 1.5,
          q: 0.7071,
          type: 'highshelf',
          channel: 'side',
          enabled: true,
        },
      ],
      compressor: {
        thresholdDb: -17,
        ratio: 2.0,
        attackSec: 0.028,
        releaseSec: 0.14,
        kneeDb: 6,
        makeupGainDb: 0,
        parallelMix: 0.82,
      },
      saturation: {
        type: 'tape',
        drive: 0.24,
        warmthTiltDb: 1.0,
      },
      stereoWidth: {
        sideGainDb: 1.6,
        widthPct: 120,
      },
      limiter: {
        targetLufs: -11.5,
        ceilingDbTp: -1.0,
        lookaheadMs: 5.0,
        releaseMs: 70,
        softClipPrePct: 0.2,
      },
    },
  },
  {
    id: 'crisp-latin-pop',
    name: 'Crisp Latin Pop & Sub-Punch',
    subtitle: 'Sub-bajo de impacto en 48Hz, voz ultra presente y brillo comercial',
    referenceArtists: 'Camilo · Morat · Pop Urbano Moderno',
    category: 'Pop',
    accentHex: '#F43F5E',
    tags: ['Sub +2.8dB @ 48Hz', 'Mono 140Hz', 'Air +3.0dB', '-9.5 LUFS'],
    description:
      'Calibrado para competir al máximo nivel comercial: Mono Maker firme a 140Hz, golpe profundo en 48Hz, claridad vocal en 4.5kHz y aire ultra cristalino en 14kHz.',
    targetSpectralProfile: {
      sub: -12.2,
      lowMid: -17.2,
      presence: -13.8,
      air: -16.8,
    },
    dspChain: {
      highPassFreq: 32,
      monoMakerFreq: 140,
      eqBands: [
        {
          id: 'mid-sub-punch',
          label: 'Sub-Punch 48Hz',
          freq: 48,
          gainDb: 2.8,
          q: 0.95,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-mud-cut',
          label: 'Clean 300Hz Pocket',
          freq: 300,
          gainDb: -1.8,
          q: 2.1,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'mid-vocal-bite',
          label: 'Crisp Vocal Presence',
          freq: 4500,
          gainDb: 1.8,
          q: 1.15,
          type: 'peaking',
          channel: 'mid',
          enabled: true,
        },
        {
          id: 'stereo-de-harsh',
          label: 'Harsh Control 3.8k',
          freq: 3800,
          gainDb: -0.9,
          q: 3.6,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'stereo-sibilance',
          label: 'Sibilance Polish',
          freq: 6400,
          gainDb: -1.1,
          q: 3.4,
          type: 'peaking',
          channel: 'stereo',
          enabled: true,
        },
        {
          id: 'side-air-shelf',
          label: 'Commercial Diamond Air',
          freq: 14000,
          gainDb: 3.0,
          q: 0.7071,
          type: 'highshelf',
          channel: 'side',
          enabled: true,
        },
      ],
      compressor: {
        thresholdDb: -15.5,
        ratio: 3.0,
        attackSec: 0.018,
        releaseSec: 0.075,
        kneeDb: 5,
        makeupGainDb: 0,
        parallelMix: 0.85,
      },
      saturation: {
        type: 'softclip',
        drive: 0.18,
        warmthTiltDb: 0.4,
      },
      stereoWidth: {
        sideGainDb: 1.4,
        widthPct: 117,
      },
      limiter: {
        targetLufs: -9.5,
        ceilingDbTp: -1.0,
        lookaheadMs: 5.0,
        releaseMs: 55,
        softClipPrePct: 0.3,
      },
    },
  },
];

export function getPresetById(presetId: string): MasteringPreset {
  return (
    PRO_PRESETS_CATALOG.find((p) => p.id === presetId) ?? PRO_PRESETS_CATALOG[0]
  );
}

export function extractSurgicalOverridesFromPreset(
  preset: MasteringPreset
): SurgicalOverrides {
  const { dspChain } = preset;
  const findBand = (id: string) => dspChain.eqBands.find((b) => b.id === id);
  const findGain = (id: string, fallback: number): number =>
    findBand(id)?.gainDb ?? fallback;

  return {
    highPassFreq: dspChain.highPassFreq,
    monoMakerFreq: dspChain.monoMakerFreq,
    midLowPunchDb: findGain('mid-sub-punch', 1.8),
    stereoMudCutDb: findGain('stereo-mud-cut', -1.8),
    midPresenceDb: findGain('mid-vocal-bite', 1.2),
    deHarshnessCutDb: findGain('stereo-de-harsh', -1.0),
    sibilanceCutDb: findGain('stereo-sibilance', -0.8),
    sibilanceFreqHz: findBand('stereo-sibilance')?.freq ?? 6200,
    sideAirBoostDb: findGain('side-air-shelf', 2.0),
    saturationType: dspChain.saturation.type,
    tapeDrivePct: Math.round(dspChain.saturation.drive * 100),
    compressorThresholdDb: dspChain.compressor.thresholdDb,
    compressorRatio: dspChain.compressor.ratio,
    compressorAttackMs: Math.round(dspChain.compressor.attackSec * 1000),
    compressorReleaseMs: Math.round(dspChain.compressor.releaseSec * 1000),
    compressorKneeDb: dspChain.compressor.kneeDb,
    compressorGlueMixPct: Math.round(dspChain.compressor.parallelMix * 100),
    stereoWidthPct: dspChain.stereoWidth.widthPct,
    targetLufs: dspChain.limiter.targetLufs,
    ceilingDbTp: dspChain.limiter.ceilingDbTp,
    customEqBands: dspChain.eqBands.map((b) => ({ ...b })),
    resonanceNotches: [],
    resonanceKillerPct: 100,
    forensicHumanizer: {
      ...DEFAULT_FORENSIC_HUMANIZER_CONFIG,
      enabled: true,
      cqtDeQuantizeMode: 'macro_rubato_440',
      bassConcentrationCap: preset.id === 'de-ai-studio-rescue' ? 0.82 : 0.72,
      highFreqExciterAmount: preset.id === 'de-ai-studio-rescue' ? 0.55 : 0.42,
    },
    drumLayering: {
      ...DEFAULT_DRUM_LAYERING_CONFIG,
      drumStyle: (preset.id === 'nu-disco-funk'
        ? 'tight-pop-funk'
        : preset.id === '90s-acoustic-country'
        ? 'warm-acoustic'
        : preset.id === 'modern-worship-arena'
        ? 'arena-worship'
        : 'stadium-rock') as DrumKitStyle,
    },
  };
}

/**
 * Sincroniza bidireccionalmente los valores de ganancia/frecuencia de SurgicalOverrides
 * con el arreglo customEqBands para que cualquier ajuste en la Consola Quirúrgica,
 * el Ecualizador Paramétrico o el Asistente IA se refleje al 100% en vivo y al exportar.
 */
export function syncSurgicalOverridesEqBands(
  overrides: SurgicalOverrides
): SurgicalOverrides {
  const syncedBands = (overrides.customEqBands || []).map((band) => {
    if (band.id === 'mid-sub-punch') {
      return { ...band, gainDb: overrides.midLowPunchDb };
    }
    if (band.id === 'stereo-mud-cut') {
      return { ...band, gainDb: overrides.stereoMudCutDb };
    }
    if (band.id === 'mid-vocal-bite') {
      return { ...band, gainDb: overrides.midPresenceDb };
    }
    if (band.id === 'stereo-de-harsh') {
      return { ...band, gainDb: overrides.deHarshnessCutDb };
    }
    if (band.id === 'stereo-sibilance') {
      return {
        ...band,
        gainDb: overrides.sibilanceCutDb,
        freq: overrides.sibilanceFreqHz || band.freq,
      };
    }
    if (band.id === 'side-air-shelf') {
      return { ...band, gainDb: overrides.sideAirBoostDb };
    }
    return band;
  });

  return {
    ...overrides,
    customEqBands: syncedBands,
  };
}

/**
 * Combines base preset DSP chain + Macro Intensity (0%..150%) + Surgical Overrides
 * into a final deterministic MasteringDspChain ready for both live WebAudio and Offline WAV export.
 */
export function buildEffectiveDspChain(
  basePreset: MasteringPreset,
  intensityPct: number,
  overrides: SurgicalOverrides,
  deltaAdjustments?: {
    subDeltaDb: number;
    lowMidDeltaDb: number;
    presenceDeltaDb: number;
    airDeltaDb: number;
  } | null
): MasteringDspChain {
  const scale = Math.max(0, Math.min(1.5, intensityPct / 100));
  const isTrueBypass = scale <= 0.005;

  // Subtle spectral delta assist when Auto-Adapt is active (capped to ±0.8 dB so it never fights manual sliders)
  const clampDelta = (d: number) => Math.max(-0.8, Math.min(0.8, d * 0.25));
  const subDelta = deltaAdjustments ? clampDelta(deltaAdjustments.subDeltaDb) * scale : 0;
  const lowMidDelta = deltaAdjustments
    ? clampDelta(deltaAdjustments.lowMidDeltaDb) * scale
    : 0;
  const presenceDelta = deltaAdjustments
    ? clampDelta(deltaAdjustments.presenceDeltaDb) * scale
    : 0;
  const airDelta = deltaAdjustments ? clampDelta(deltaAdjustments.airDeltaDb) * scale : 0;

  const clampGain = (val: number, min = -12, max = 12) =>
    Math.max(min, Math.min(max, Number(val.toFixed(2))));

  const sourceBands =
    overrides.customEqBands && overrides.customEqBands.length > 0
      ? overrides.customEqBands
      : basePreset.dspChain.eqBands;

  const eqBands = sourceBands.map((band) => {
    let rawGain = band.gainDb;
    let freq = band.freq;

    if (band.id === 'mid-sub-punch') {
      rawGain = overrides.midLowPunchDb * scale + subDelta;
    } else if (band.id === 'stereo-mud-cut') {
      // Only let negative lowMidDelta deepen mud cleanup; never let positive delta
      // flip a subtractive mud cut into a 285Hz boost.
      const effectiveMudDelta =
        overrides.stereoMudCutDb <= 0 ? Math.min(0, lowMidDelta) : lowMidDelta * 0.5;
      rawGain = overrides.stereoMudCutDb * scale + effectiveMudDelta;
    } else if (band.id === 'mid-vocal-bite') {
      rawGain = overrides.midPresenceDb * scale + presenceDelta;
    } else if (band.id === 'stereo-de-harsh') {
      // Keep surgical 3.8kHz de-harshness cut independent of broad presence boost
      rawGain = overrides.deHarshnessCutDb * scale;
    } else if (band.id === 'stereo-sibilance') {
      rawGain = overrides.sibilanceCutDb * scale;
      freq = overrides.sibilanceFreqHz || band.freq;
    } else if (band.id === 'side-air-shelf') {
      rawGain = overrides.sideAirBoostDb * scale + airDelta;
    } else {
      rawGain = band.gainDb * scale;
    }

    return {
      ...band,
      freq: Math.max(20, Math.min(20000, freq)),
      gainDb: isTrueBypass || band.enabled === false ? 0 : clampGain(rawGain),
    };
  });

  // Width percentage (0% = true Mono -60dB side => 0.0 gain, 100% = 0dB side, 150% = +3.5dB side)
  const effectiveWidthPct = isTrueBypass
    ? 100
    : 100 + (overrides.stereoWidthPct - 100) * Math.min(1.25, scale);
  const sideGainDb =
    effectiveWidthPct <= 0.5
      ? -60
      : clampGain(20 * Math.log10(Math.max(0.01, effectiveWidthPct / 100)), -36, 6);

  // Saturation drive scaled linearly by Macro Intensity (0% => 0 drive)
  const effectiveDrive = isTrueBypass
    ? 0
    : Math.max(0, Math.min(0.95, (overrides.tapeDrivePct / 100) * scale));

  // Compressor ratio & parallel mix scaled cleanly (0% => parallelMix = 0)
  const effectiveRatio = isTrueBypass
    ? 1.0
    : Math.max(
        1.05,
        1 + (overrides.compressorRatio - 1) * Math.min(1.25, scale)
      );

  const killerScale = isTrueBypass
    ? 0
    : Math.max(0, Math.min(1.5, (overrides.resonanceKillerPct ?? 100) / 100)) * scale;
  const resonanceNotches = (overrides.resonanceNotches || []).map((n) => ({
    ...n,
    gainCutDb: clampGain(n.gainCutDb * killerScale, -14, 0),
  }));

  const rawHumanizer = overrides.forensicHumanizer
    ? { ...overrides.forensicHumanizer }
    : { ...DEFAULT_FORENSIC_HUMANIZER_CONFIG };
  const isPureMono = effectiveWidthPct <= 0.5;
  const scaledHumanizer = isTrueBypass
    ? { ...rawHumanizer, enabled: false }
    : {
        ...rawHumanizer,
        bassConcentrationCap: Math.min(1, rawHumanizer.bassConcentrationCap * scale),
        highFreqExciterAmount: Math.min(1, rawHumanizer.highFreqExciterAmount * scale),
        analogPhaseAndDrift: Math.min(1, rawHumanizer.analogPhaseAndDrift * scale),
        transientMicroExpand: Math.min(
          1,
          (rawHumanizer.transientMicroExpand ?? 0.35) * scale
        ),
        studioRoomCoherence: isPureMono
          ? 0
          : Math.min(0.15, rawHumanizer.studioRoomCoherence * scale),
        analogConsoleNoiseDb: isPureMono ? -90 : rawHumanizer.analogConsoleNoiseDb,
      };

  const rawDrum = overrides.drumLayering
    ? { ...overrides.drumLayering }
    : { ...DEFAULT_DRUM_LAYERING_CONFIG };
  const scaledDrum = isTrueBypass
    ? { ...rawDrum, enabled: false }
    : {
        ...rawDrum,
        kickMix: Math.min(1, rawDrum.kickMix * Math.min(1.2, scale)),
        snareMix: Math.min(1, rawDrum.snareMix * Math.min(1.2, scale)),
      };

  return {
    intensityScale: scale,
    highPassFreq: isTrueBypass
      ? 18
      : Math.max(
          18,
          Math.min(60, overrides.highPassFreq || basePreset.dspChain.highPassFreq)
        ),
    monoMakerFreq: isTrueBypass
      ? 30
      : Math.max(30, Math.min(220, overrides.monoMakerFreq)),
    eqBands,
    resonanceNotches,
    compressor: {
      ...basePreset.dspChain.compressor,
      thresholdDb: overrides.compressorThresholdDb,
      ratio: Number(effectiveRatio.toFixed(2)),
      attackSec: Math.max(
        0.001,
        Math.min(0.25, (overrides.compressorAttackMs || 25) / 1000)
      ),
      releaseSec: Math.max(
        0.015,
        Math.min(1.0, (overrides.compressorReleaseMs || 120) / 1000)
      ),
      kneeDb: Math.max(0, Math.min(24, overrides.compressorKneeDb ?? 6)),
      makeupGainDb: 0,
      parallelMix: isTrueBypass
        ? 0
        : Math.max(
            0,
            Math.min(1, (overrides.compressorGlueMixPct / 100) * Math.min(1.0, scale))
          ),
    },
    saturation: {
      type: overrides.saturationType,
      drive: Number(effectiveDrive.toFixed(3)),
      warmthTiltDb: isTrueBypass
        ? 0
        : Number((basePreset.dspChain.saturation.warmthTiltDb * scale).toFixed(2)),
    },
    stereoWidth: {
      sideGainDb,
      widthPct: Math.round(effectiveWidthPct),
    },
    limiter: {
      ...basePreset.dspChain.limiter,
      targetLufs: overrides.targetLufs,
      ceilingDbTp: overrides.ceilingDbTp,
    },
    forensicHumanizer: scaledHumanizer,
    drumLayering: scaledDrum,
  };
}
