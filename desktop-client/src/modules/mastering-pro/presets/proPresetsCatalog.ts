import type {
  MasteringDspChain,
  MasteringPreset,
  SurgicalOverrides,
} from '../types/mastering.types';

export const PRO_PRESETS_CATALOG: MasteringPreset[] = [
  {
    id: 'stadium-pop-rock',
    name: 'Stadium Pop-Rock & Anthem',
    subtitle: 'Pegada de estadio, graves centrados y apertura tridimensional',
    referenceArtists: 'Imagine Dragons · OneRepublic · Coldplay',
    category: 'Rock',
    accentHex: '#FF6B00',
    tags: ['Punch 60Hz', 'Bus Glue 4:1', 'Side Air 12kHz', '-9.5 LUFS'],
    description:
      'Empuje masivo en el sub-bajo central, limpieza quirúrgica de barro en 320Hz, ataque vocal al frente y brillo abierto en los lados para coros de estadio.',
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
        ratio: 4.0,
        attackSec: 0.03,
        releaseSec: 0.1,
        kneeDb: 6,
        makeupGainDb: 2.2,
        parallelMix: 0.85,
      },
      saturation: {
        type: 'softclip',
        drive: 0.22,
        warmthTiltDb: 0.6,
      },
      stereoWidth: {
        sideGainDb: 1.8,
        widthPct: 123,
      },
      limiter: {
        targetLufs: -9.5,
        ceilingDbTp: -1.0,
        lookaheadMs: 2.0,
        releaseMs: 55,
        softClipPrePct: 0.35,
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
    tags: ['Tight 55Hz', 'Fast Glue 3:1', 'Transformer Drive', '-9.0 LUFS'],
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
        thresholdDb: -16,
        ratio: 3.0,
        attackSec: 0.012,
        releaseSec: 0.05,
        kneeDb: 5,
        makeupGainDb: 2.0,
        parallelMix: 0.88,
      },
      saturation: {
        type: 'transformer',
        drive: 0.2,
        warmthTiltDb: 0.8,
      },
      stereoWidth: {
        sideGainDb: 1.5,
        widthPct: 119,
      },
      limiter: {
        targetLufs: -9.0,
        ceilingDbTp: -1.0,
        lookaheadMs: 1.8,
        releaseMs: 45,
        softClipPrePct: 0.38,
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
    tags: ['Warm 140Hz', 'Gentle 1.8:1', 'Tube Harmonics', '-11.5 LUFS'],
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
        makeupGainDb: 1.4,
        parallelMix: 0.75,
      },
      saturation: {
        type: 'tube',
        drive: 0.14,
        warmthTiltDb: 1.1,
      },
      stereoWidth: {
        sideGainDb: 0.8,
        widthPct: 110,
      },
      limiter: {
        targetLufs: -11.5,
        ceilingDbTp: -1.0,
        lookaheadMs: 2.2,
        releaseMs: 85,
        softClipPrePct: 0.18,
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
    tags: ['Vocal Focus 1.8k', 'Tape Glue', 'Wide Halo +2.2dB', '-10.5 LUFS'],
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
        attackSec: 0.025,
        releaseSec: 0.18,
        kneeDb: 7,
        makeupGainDb: 1.8,
        parallelMix: 0.82,
      },
      saturation: {
        type: 'tape',
        drive: 0.18,
        warmthTiltDb: 0.9,
      },
      stereoWidth: {
        sideGainDb: 2.2,
        widthPct: 128,
      },
      limiter: {
        targetLufs: -10.5,
        ceilingDbTp: -1.0,
        lookaheadMs: 2.0,
        releaseMs: 70,
        softClipPrePct: 0.25,
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
    tags: ['-3.2dB @ 3.8kHz', '-2.5dB @ 6.2kHz', 'Studer Tape 30%', '-11.0 LUFS'],
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
        makeupGainDb: 1.9,
        parallelMix: 0.85,
      },
      saturation: {
        type: 'tape',
        drive: 0.3,
        warmthTiltDb: 1.5,
      },
      stereoWidth: {
        sideGainDb: 2.0,
        widthPct: 126,
      },
      limiter: {
        targetLufs: -11.0,
        ceilingDbTp: -1.0,
        lookaheadMs: 2.2,
        releaseMs: 65,
        softClipPrePct: 0.28,
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
    tags: ['Sub +2.8dB @ 48Hz', 'Mono 140Hz', 'Air +3.0dB', '-8.5 LUFS'],
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
        thresholdDb: -15,
        ratio: 4.0,
        attackSec: 0.015,
        releaseSec: 0.06,
        kneeDb: 5,
        makeupGainDb: 2.4,
        parallelMix: 0.9,
      },
      saturation: {
        type: 'softclip',
        drive: 0.25,
        warmthTiltDb: 0.5,
      },
      stereoWidth: {
        sideGainDb: 1.6,
        widthPct: 120,
      },
      limiter: {
        targetLufs: -8.5,
        ceilingDbTp: -1.0,
        lookaheadMs: 1.8,
        releaseMs: 42,
        softClipPrePct: 0.42,
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
  const findGain = (id: string, fallback: number): number =>
    dspChain.eqBands.find((b) => b.id === id)?.gainDb ?? fallback;

  return {
    monoMakerFreq: dspChain.monoMakerFreq,
    midLowPunchDb: findGain('mid-sub-punch', 1.8),
    stereoMudCutDb: findGain('stereo-mud-cut', -1.8),
    midPresenceDb: findGain('mid-vocal-bite', 1.2),
    deHarshnessCutDb: findGain('stereo-de-harsh', -1.0),
    sibilanceCutDb: findGain('stereo-sibilance', -0.8),
    sideAirBoostDb: findGain('side-air-shelf', 2.0),
    saturationType: dspChain.saturation.type,
    tapeDrivePct: Math.round(dspChain.saturation.drive * 100),
    compressorThresholdDb: dspChain.compressor.thresholdDb,
    compressorRatio: dspChain.compressor.ratio,
    compressorGlueMixPct: Math.round(dspChain.compressor.parallelMix * 100),
    stereoWidthPct: dspChain.stereoWidth.widthPct,
    targetLufs: dspChain.limiter.targetLufs,
    ceilingDbTp: dspChain.limiter.ceilingDbTp,
  };
}

/**
 * Combines base preset DSP chain + Macro Intensity (0%..150%) + Surgical Overrides + AI Spectral Deltas
 * into a final deterministic MasteringDspChain ready for the WebAudio graph.
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
  const subDelta = deltaAdjustments ? deltaAdjustments.subDeltaDb * scale : 0;
  const lowMidDelta = deltaAdjustments
    ? deltaAdjustments.lowMidDeltaDb * scale
    : 0;
  const presenceDelta = deltaAdjustments
    ? deltaAdjustments.presenceDeltaDb * scale
    : 0;
  const airDelta = deltaAdjustments ? deltaAdjustments.airDeltaDb * scale : 0;

  const clampGain = (val: number, min = -9, max = 9) =>
    Math.max(min, Math.min(max, Number(val.toFixed(2))));

  const eqBands = basePreset.dspChain.eqBands.map((band) => {
    let rawGain = band.gainDb;
    if (band.id === 'mid-sub-punch') {
      rawGain = overrides.midLowPunchDb * scale + subDelta;
    } else if (band.id === 'stereo-mud-cut') {
      rawGain = overrides.stereoMudCutDb * scale + lowMidDelta;
    } else if (band.id === 'mid-vocal-bite') {
      rawGain = overrides.midPresenceDb * scale + presenceDelta * 0.6;
    } else if (band.id === 'stereo-de-harsh') {
      rawGain = overrides.deHarshnessCutDb * scale + presenceDelta * 0.4;
    } else if (band.id === 'stereo-sibilance') {
      rawGain = overrides.sibilanceCutDb * scale;
    } else if (band.id === 'side-air-shelf') {
      rawGain = overrides.sideAirBoostDb * scale + airDelta;
    } else {
      rawGain = band.gainDb * scale;
    }

    return {
      ...band,
      gainDb: clampGain(rawGain),
    };
  });

  // Width percentage (0% = -24dB side, 100% = 0dB side, 150% = +4.5dB side)
  const effectiveWidthPct =
    100 + (overrides.stereoWidthPct - 100) * scale;
  const widthRatio = Math.max(0.02, effectiveWidthPct / 100);
  const sideGainDb = clampGain(20 * Math.log10(widthRatio), -18, 6);

  // Saturation drive scaled by Macro Intensity
  const effectiveDrive = Math.max(
    0,
    Math.min(0.95, (overrides.tapeDrivePct / 100) * (0.5 + 0.5 * scale))
  );

  // Compressor ratio scaled gently with intensity
  const effectiveRatio = Math.max(
    1.1,
    1 + (overrides.compressorRatio - 1) * Math.max(0.35, Math.min(1.25, scale))
  );

  return {
    highPassFreq: basePreset.dspChain.highPassFreq,
    monoMakerFreq: Math.max(40, Math.min(220, overrides.monoMakerFreq)),
    eqBands,
    compressor: {
      ...basePreset.dspChain.compressor,
      thresholdDb: overrides.compressorThresholdDb,
      ratio: Number(effectiveRatio.toFixed(2)),
      parallelMix: Math.max(
        0,
        Math.min(1, (overrides.compressorGlueMixPct / 100) * Math.min(1.1, scale || 0.01))
      ),
    },
    saturation: {
      type: overrides.saturationType,
      drive: Number(effectiveDrive.toFixed(3)),
      warmthTiltDb: Number(
        (basePreset.dspChain.saturation.warmthTiltDb * scale).toFixed(2)
      ),
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
  };
}
