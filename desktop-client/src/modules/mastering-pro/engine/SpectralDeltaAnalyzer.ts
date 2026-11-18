import type {
  AiCompressionSuggestion,
  AiCriticalEqPoint,
  AiFilterSuggestion,
  AiStereoWidthSuggestion,
  DrumHitEvent,
  MasteringPreset,
  SpectralAdaptationReport,
  SpectralProfile,
  SpectralResonanceNode,
} from '../types/mastering.types';
import {
  PRO_PRESETS_CATALOG,
  getPresetById,
} from '../presets/proPresetsCatalog';
import {
  DEFAULT_DRUM_LAYERING_CONFIG,
  DrumTransientReplacerDSP,
} from './DrumTransientReplacerDSP';
import {
  DEFAULT_FORENSIC_HUMANIZER_CONFIG,
  calculateForensicSignature,
} from './ForensicHumanizerDSP';
import {
  computeFullLoudnessReport,
  downmixToStereoArrays,
  type LoudnessReport,
} from '../dsp-core/KWeightingLufs';
import {
  analyzeFullBandwidthSpectrum,
  filterSpectralFluxDrumHits,
  type SpectralFluxOnsetResult,
  type WelchSpectralMetrics,
} from '../dsp-core/SpectralFftCore';
import SpectralAnalyzerWorker from './workers/spectralAnalyzer.worker.ts?worker';

/**
 * Exact ITU-R BS.1770-4 Integrated Loudness (LUFS) with K-Weighting
 * and two-stage gating (-70 LUFS / -10 LU), 75% block overlap, and multi-channel support.
 */
export function computeIntegratedLufsBs1770(buffer: AudioBuffer): number {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  return computeFullLoudnessReport(channels, buffer.sampleRate).integratedLufs;
}

export function computeBufferPhaseCorrelation(buffer: AudioBuffer): number {
  if (buffer.numberOfChannels < 2) return 1.0;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const step = Math.max(1, Math.floor(left.length / 96000));

  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  for (let i = 0; i < left.length; i += step) {
    const l = left[i];
    const r = right[i];
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
  }

  const denom = Math.sqrt(sumL2 * sumR2);
  if (denom <= 1e-9) return 1.0;
  return Number(Math.max(-1, Math.min(1, sumLR / denom)).toFixed(2));
}

export interface DeepDiagnosticScan {
  profile: SpectralProfile;
  aiArtifactScore: number;
  sibilanceScore: number;
  subRumbleDb: number;
  mudExcessDb: number;
  vocalPocketDeficitDb: number;
  airDeficitDb: number;
  detectedSibilancePeakHz: number;
  stereoSideEnergyPct: number;
  bassPhaseCorrelation: number;
  bassConcentrationPct: number;
  highFreqCutoffHz: number;
  detectedResonanceLines: SpectralResonanceNode[];
}

function buildDiagnosticScanFromWelch(
  welch: WelchSpectralMetrics
): DeepDiagnosticScan {
  const detectedResonanceLines: SpectralResonanceNode[] =
    welch.stationaryResonances.map((r) => ({
      id: `line-killer-${r.freqHz}`,
      freqHz: r.freqHz,
      gainCutDb: r.recommendedCutDb,
      q: 12.0,
      label: `Notch ${r.freqHz}Hz (+${r.prominenceDb}dB, ${r.persistencePct}%)`,
      enabled: true,
      source: 'ai-detected',
    }));

  return {
    profile: welch.profile,
    aiArtifactScore: welch.harshnessScore,
    sibilanceScore: welch.sibilanceScore,
    subRumbleDb: welch.subRumbleDb,
    mudExcessDb: welch.mudExcessDb,
    vocalPocketDeficitDb: welch.vocalPocketDeficitDb,
    airDeficitDb: welch.airDeficitDb,
    detectedSibilancePeakHz: welch.detectedSibilancePeakHz,
    stereoSideEnergyPct: welch.stereoSideEnergyPct,
    bassPhaseCorrelation: welch.bassPhaseCorrelation,
    bassConcentrationPct: welch.bassConcentrationPct,
    highFreqCutoffHz: welch.highFreqCutoffHz,
    detectedResonanceLines,
  };
}

export function analyzeSpectralProfileAndAiScore(
  buffer: AudioBuffer
): DeepDiagnosticScan {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  const { left, right } = downmixToStereoArrays(channels);
  const welch = analyzeFullBandwidthSpectrum(left, right, buffer.sampleRate);
  return buildDiagnosticScanFromWelch(welch);
}

function buildDiagnosticSuggestions(
  scan: DeepDiagnosticScan,
  targetPreset: MasteringPreset,
  detectedCrestFactorDb: number,
  detectedPhaseCorrelation: number
): {
  criticalEqPoints: AiCriticalEqPoint[];
  filterSuggestions: AiFilterSuggestion[];
  compressionSuggestion: AiCompressionSuggestion;
  stereoWidthSuggestion: AiStereoWidthSuggestion;
} {
  const { profile } = scan;
  const target = targetPreset.targetSpectralProfile;

  const findPresetBandGain = (id: string, fallback: number) =>
    targetPreset.dspChain.eqBands.find((b) => b.id === id)?.gainDb ?? fallback;

  const subGap = target.sub - profile.sub;
  const subExcess = subGap < -0.9;
  const subRecommendedGain = subExcess
    ? Number(Math.max(-3.0, Math.min(-0.4, subGap * 0.55)).toFixed(1))
    : Number(
        Math.max(
          0.2,
          Math.min(2.8, findPresetBandGain('mid-sub-punch', 1.8) * 0.45 + subGap * 0.55)
        ).toFixed(1)
      );

  const presGap = target.presence - profile.presence;
  const presExcess = presGap < -0.9;
  const vocalRecommendedGain = presExcess
    ? Number(Math.max(-2.6, Math.min(-0.4, presGap * 0.5)).toFixed(1))
    : Number(
        Math.max(
          0.2,
          Math.min(2.4, findPresetBandGain('mid-vocal-bite', 1.2) * 0.45 + presGap * 0.55)
        ).toFixed(1)
      );

  const airGap = target.air - profile.air;
  const airExcess = airGap < -1.0 && scan.highFreqCutoffHz >= 18000;
  const airRecommendedGain = airExcess
    ? Number(Math.max(-2.8, Math.min(-0.4, airGap * 0.45)).toFixed(1))
    : Number(
        Math.max(
          0.2,
          Math.min(3.0, findPresetBandGain('side-air-shelf', 2.0) * 0.45 + airGap * 0.55)
        ).toFixed(1)
      );

  const mudCutRecommended = Number(
    Math.max(-3.2, Math.min(-0.6, -1.2 - Math.max(0, scan.mudExcessDb * 0.5))).toFixed(1)
  );
  const harshCutRecommended = Number(
    Math.max(
      -3.5,
      Math.min(-0.5, -(0.5 + (scan.aiArtifactScore / 100) * 2.4))
    ).toFixed(1)
  );
  const deEsserCutRecommended = Number(
    Math.max(
      -3.2,
      Math.min(-0.5, -(0.5 + (scan.sibilanceScore / 100) * 2.2))
    ).toFixed(1)
  );

  const criticalEqPoints: AiCriticalEqPoint[] = [
    {
      id: 'boost-mid-sub',
      action: subExcess ? 'cut' : 'boost',
      title: subExcess
        ? 'Controlar Exceso de Sub-Graves (Mid)'
        : 'Subir Pegada de Sub-Graves (Mid)',
      zoneName: '55 Hz – 65 Hz · Canal MID',
      reason: subExcess
        ? `Exceso medido de +${Math.abs(subGap).toFixed(1)} dB en sub-graves frente al objetivo de ${targetPreset.name}. Atenuar limpia headroom.`
        : subGap > 0
        ? `Déficit medido de ${subGap.toFixed(1)} dB en fundamentales de bombo y bajo respecto a ${targetPreset.name}.`
        : 'Refuerzo controlado en el centro para dar peso sin ensuciar los lados.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'mid-sub-punch')
          ?.freq ?? 58,
      recommendedGainDb: subRecommendedGain,
      recommendedQ: 0.9,
      channel: 'mid',
      filterType: 'peaking',
      bandId: 'mid-sub-punch',
      priority: Math.abs(subGap) > 1.5 ? 'critical' : 'opportunity',
    },
    {
      id: 'boost-mid-vocal',
      action: presExcess ? 'cut' : 'boost',
      title: presExcess
        ? 'Suavizar Exceso de Presencia Media (Mid)'
        : 'Subir Claridad y Presencia Vocal (Mid)',
      zoneName: '1.8 kHz – 3.2 kHz · Canal MID',
      reason: presExcess
        ? `La mezcla supera en +${Math.abs(presGap).toFixed(1)} dB la referencia tonal de ${targetPreset.name}. Controlar evita fatiga.`
        : 'Realza la inteligibilidad de la voz líder e instrumentos principales en el centro sin fatiga.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'mid-vocal-bite')
          ?.freq ?? 2400,
      recommendedGainDb: vocalRecommendedGain,
      recommendedQ: 1.15,
      channel: 'mid',
      filterType: 'peaking',
      bandId: 'mid-vocal-bite',
      priority: Math.abs(presGap) > 1.4 ? 'critical' : 'recommended',
    },
    {
      id: 'boost-side-air',
      action: airExcess ? 'cut' : 'boost',
      title: airExcess
        ? 'Domar Exceso de Brillo Lateral (Side)'
        : 'Subir Brillo y Aire Tridimensional (Side)',
      zoneName: '12 kHz – 15 kHz · Canal SIDE',
      reason: airExcess
        ? `Brillo superior excedido (+${Math.abs(airGap).toFixed(1)} dB sobre ${targetPreset.name}). Suavizar en Side evita aspereza.`
        : scan.highFreqCutoffHz < 17500
        ? `Ancho de banda detectado hasta ${(scan.highFreqCutoffHz / 1000).toFixed(1)} kHz. Realzar aire en Side aporta apertura sin afectar el centro.`
        : 'Abre el escenario estéreo con un High-Shelf sedoso solo en los lados.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'side-air-shelf')
          ?.freq ?? 13000,
      recommendedGainDb: airRecommendedGain,
      recommendedQ: 0.7071,
      channel: 'side',
      filterType: 'highshelf',
      bandId: 'side-air-shelf',
      priority: scan.highFreqCutoffHz < 17500 || airExcess ? 'critical' : 'opportunity',
    },
    {
      id: 'cut-stereo-mud',
      action: 'cut',
      title: 'Cortar Congestión y Barro (Anti-Mud)',
      zoneName: '250 Hz – 320 Hz · Estéreo',
      reason:
        scan.mudExcessDb > 0
          ? `Acumulación de +${scan.mudExcessDb} dB en medios-bajos que resta definición.`
          : 'Limpieza de bolsillo en 285Hz para separar bajo y medios.',
      freqHz: 285,
      recommendedGainDb: mudCutRecommended,
      recommendedQ: 2.1,
      channel: 'stereo',
      filterType: 'peaking',
      bandId: 'stereo-mud-cut',
      priority: scan.mudExcessDb > 1.0 ? 'critical' : 'recommended',
    },
    {
      id: 'cut-de-harsh',
      action: 'cut',
      title: 'Suavizar Dureza / Aspereza (3.8 kHz)',
      zoneName: '3,800 Hz · Notch Q:3.8',
      reason:
        scan.aiArtifactScore >= 55
          ? `Índice real de aspereza en 2.9–4.8 kHz elevado (${scan.aiArtifactScore}%). Suaviza timbre metálico sin apagar la voz.`
          : 'Controla picos agresivos en guitarras, sintetizadores y voces.',
      freqHz: 3800,
      recommendedGainDb: harshCutRecommended,
      recommendedQ: 3.8,
      channel: 'stereo',
      filterType: 'peaking',
      bandId: 'stereo-de-harsh',
      priority: scan.aiArtifactScore >= 55 ? 'critical' : 'recommended',
    },
    {
      id: 'cut-de-esser',
      action: 'cut',
      title: `Filtro De-Esser (${scan.detectedSibilancePeakHz} Hz)`,
      zoneName: `${scan.detectedSibilancePeakHz} Hz · Control de Sibilancia`,
      reason: `Controla consonantes "S/T" y platos punzantes (energía medida 5.5–8.5 kHz: ${scan.sibilanceScore}%).`,
      freqHz: scan.detectedSibilancePeakHz,
      recommendedGainDb: deEsserCutRecommended,
      recommendedQ: 3.5,
      channel: 'stereo',
      filterType: 'peaking',
      bandId: 'stereo-sibilance',
      priority: scan.sibilanceScore >= 58 ? 'critical' : 'recommended',
    },
  ];

  const recommendedMonoHz =
    scan.bassPhaseCorrelation < 0.78
      ? 135
      : targetPreset.dspChain.monoMakerFreq;
  const recommendedHpfHz = scan.subRumbleDb > -24 ? 32 : 26;

  const filterSuggestions: AiFilterSuggestion[] = [
    {
      id: 'de-esser',
      name: `De-Esser Quirúrgico @ ${scan.detectedSibilancePeakHz} Hz`,
      badge: 'DE-ESSER / SIBILANCIA',
      detectedIssue: `Energía sibilante real medida al ${scan.sibilanceScore}% en 5.5–8.5 kHz.`,
      suggestionDetail: `Aplicar filtro Peaking Q=3.5 en ${scan.detectedSibilancePeakHz} Hz con ${deEsserCutRecommended} dB.`,
      confidencePct: Math.max(60, Math.min(98, scan.sibilanceScore + 15)),
      isRecommended: scan.sibilanceScore >= 45,
      patchOverrides: {
        sibilanceFreqHz: scan.detectedSibilancePeakHz,
        sibilanceCutDb: deEsserCutRecommended,
      },
    },
    {
      id: 'de-harsh-notch',
      name: 'Filtro Anti-Fatiga / De-Harsh (3.8 kHz)',
      badge: 'SUAVIZADO ESPECTRAL',
      detectedIssue: `Aspereza en medios-altos (2.9–4.8 kHz): ${scan.aiArtifactScore}%.`,
      suggestionDetail: `Atenuar ${harshCutRecommended} dB @ 3800 Hz (Q=3.8) y aplicar saturación suave de cinta.`,
      confidencePct: Math.max(60, Math.min(98, scan.aiArtifactScore + 15)),
      isRecommended: scan.aiArtifactScore >= 48,
      patchOverrides: {
        deHarshnessCutDb: harshCutRecommended,
        saturationType:
          scan.aiArtifactScore >= 60
            ? 'tape'
            : targetPreset.dspChain.saturation.type,
        tapeDrivePct:
          scan.aiArtifactScore >= 60
            ? 24
            : Math.round(targetPreset.dspChain.saturation.drive * 100),
      },
    },
    {
      id: 'mono-maker-lock',
      name: `Mono Maker Butterworth @ ${recommendedMonoHz} Hz`,
      badge: 'FASE & SUB-GRAVES',
      detectedIssue: `Correlación de fase en graves (<100Hz): ${scan.bassPhaseCorrelation}.`,
      suggestionDetail: `High-Pass Butterworth (Q=0.7071) en el canal Side a ${recommendedMonoHz} Hz para anclar el sub-bajo al centro.`,
      confidencePct: 94,
      isRecommended: true,
      patchOverrides: {
        monoMakerFreq: recommendedMonoHz,
      },
    },
    {
      id: 'subsonic-rumble',
      name: `Filtro Subsonic Rumble HPF @ ${recommendedHpfHz} Hz`,
      badge: 'HEADROOM / HPF',
      detectedIssue: `Energía infrasónica (<36Hz) medida en ${scan.subRumbleDb} dB relativos.`,
      suggestionDetail: `Cortar frecuencias sub-sónicas por debajo de ${recommendedHpfHz} Hz para proteger el headroom del limitador.`,
      confidencePct: 91,
      isRecommended: true,
      patchOverrides: {
        highPassFreq: recommendedHpfHz,
      },
    },
    {
      id: 'anti-mud-filter',
      name: 'Filtro Anti-Barro (Low-Mid Clean 285 Hz)',
      badge: 'CLARIDAD TONAL',
      detectedIssue: `Densidad medida en 160–800 Hz: ${profile.lowMid} dB.`,
      suggestionDetail: `Atenuar ${mudCutRecommended} dB en 285 Hz para abrir espacio entre bajo, guitarras y voz.`,
      confidencePct: 87,
      isRecommended: true,
      patchOverrides: {
        stereoMudCutDb: mudCutRecommended,
      },
    },
    {
      id: 'harmonic-exciter',
      name: 'Saturación Armónica 4x + Side Air Shelf',
      badge: 'ARMÓNICOS & AIRE',
      detectedIssue: `Banda aire (>5.5kHz): ${profile.air} dB · Corte BW: ${(scan.highFreqCutoffHz / 1000).toFixed(1)} kHz.`,
      suggestionDetail: `Realzar ${airRecommendedGain > 0 ? `+${airRecommendedGain}` : airRecommendedGain} dB en canal Side y aplicar ${Math.round(targetPreset.dspChain.saturation.drive * 100)}% de saturación ${targetPreset.dspChain.saturation.type.toUpperCase()}.`,
      confidencePct: 88,
      isRecommended: true,
      patchOverrides: {
        sideAirBoostDb: airRecommendedGain,
        saturationType: targetPreset.dspChain.saturation.type,
        tapeDrivePct: Math.round(targetPreset.dspChain.saturation.drive * 100),
      },
    },
    ...(scan.detectedResonanceLines.length > 0
      ? [
          {
            id: 'spectral-line-killer' as const,
            name: `Spectral Line Killer (${scan.detectedResonanceLines
              .map((n) => `${n.freqHz}Hz`)
              .join(' · ')})`,
            badge: 'RESONANCIAS DETECTADAS Q=12',
            detectedIssue: `Se detectaron ${scan.detectedResonanceLines.length} resonancias estacionarias reales (>=6 dB sobre entorno, >=65% persistencia).`,
            suggestionDetail: `Insertar ${scan.detectedResonanceLines.length} filtros Notch (Q=12) para atenuar picos estacionarios sin apagar la mezcla.`,
            confidencePct: 95,
            isRecommended: true,
            patchOverrides: {
              resonanceNotches: scan.detectedResonanceLines,
              resonanceKillerPct: 100,
            },
          },
        ]
      : []),
  ];

  let compressionSuggestion: AiCompressionSuggestion;
  if (detectedCrestFactorDb >= 13.0) {
    compressionSuggestion = {
      profileName: 'Dynamic Glue (Rango Dinámico Amplio)',
      diagnosis: `Crest Factor real de ${detectedCrestFactorDb} dB. Compresión suave 2.2:1 con ataque 28ms y Sidechain HPF 90Hz para cohesionar sin aplastar.`,
      thresholdDb: -19.5,
      ratio: 2.2,
      attackMs: 28,
      releaseMs: 140,
      kneeDb: 7,
      parallelMixPct: 82,
    };
  } else if (detectedCrestFactorDb <= 8.5) {
    compressionSuggestion = {
      profileName: 'Transparent Micro-Glue (Mezcla Densa)',
      diagnosis: `Pista ya comprimida (${detectedCrestFactorDb} dB Crest). Ratio ligero 1.5:1, ataque lento 35ms y paralelo al 65% para conservar pegada.`,
      thresholdDb: -16.0,
      ratio: 1.5,
      attackMs: 35,
      releaseMs: 160,
      kneeDb: 8,
      parallelMixPct: 65,
    };
  } else {
    compressionSuggestion = {
      profileName: 'Bus Punch & Glue (Equilibrado)',
      diagnosis: `Crest Factor equilibrado (${detectedCrestFactorDb} dB). Ataque 24ms, release 90ms y ratio 2.6:1 para cohesión firme.`,
      thresholdDb: -17.5,
      ratio: 2.6,
      attackMs: 24,
      releaseMs: 90,
      kneeDb: 6,
      parallelMixPct: 82,
    };
  }

  let recommendedWidthPct = targetPreset.dspChain.stereoWidth.widthPct;
  let widthDiagnosis = '';
  const airSignStr = airRecommendedGain >= 0 ? `+${airRecommendedGain}` : `${airRecommendedGain}`;

  if (scan.stereoSideEnergyPct < 18) {
    recommendedWidthPct = Math.max(targetPreset.dspChain.stereoWidth.widthPct, 126);
    widthDiagnosis = `Mezcla estrecha (${scan.stereoSideEnergyPct}% Side). Apertura al ${recommendedWidthPct}% segura (Fase ${detectedPhaseCorrelation}).`;
  } else if (scan.stereoSideEnergyPct > 42 || detectedPhaseCorrelation < 0.35) {
    recommendedWidthPct = Math.min(targetPreset.dspChain.stereoWidth.widthPct, 104);
    widthDiagnosis = `Mezcla muy abierta (${scan.stereoSideEnergyPct}% Side, Fase ${detectedPhaseCorrelation}). Moderamos a ${recommendedWidthPct}% con Mono Maker @ ${recommendedMonoHz}Hz.`;
  } else {
    recommendedWidthPct = targetPreset.dspChain.stereoWidth.widthPct;
    widthDiagnosis = `Balance estéreo saludable (${scan.stereoSideEnergyPct}% Side, Fase ${detectedPhaseCorrelation >= 0 ? `+${detectedPhaseCorrelation}` : detectedPhaseCorrelation}). Apertura calibrada a ${recommendedWidthPct}% con ${airSignStr}dB de Side Air.`;
  }

  const stereoWidthSuggestion: AiStereoWidthSuggestion = {
    detectedStereoEnergyPct: scan.stereoSideEnergyPct,
    detectedBassPhaseCorrelation: scan.bassPhaseCorrelation,
    diagnosis: widthDiagnosis,
    recommendedWidthPct,
    recommendedMonoMakerHz: recommendedMonoHz,
    recommendedSideAirDb: airRecommendedGain,
  };

  return {
    criticalEqPoints,
    filterSuggestions,
    compressionSuggestion,
    stereoWidthSuggestion,
  };
}

function finalizeReportFromRaw(
  loudness: LoudnessReport,
  welch: WelchSpectralMetrics,
  durationSec: number,
  sampleRate: number,
  fluxOnsets: SpectralFluxOnsetResult | null,
  buffer: AudioBuffer | null,
  currentPresetId?: string,
  kickSensitivity = DEFAULT_DRUM_LAYERING_CONFIG.kickSensitivity,
  snareSensitivity = DEFAULT_DRUM_LAYERING_CONFIG.snareSensitivity
): SpectralAdaptationReport {
  const scan = buildDiagnosticScanFromWelch(welch);
  const { profile, aiArtifactScore, sibilanceScore } = scan;

  let recommendedPresetId = 'stadium-pop-rock';
  let recommendationReason =
    'Balance energético equilibrado para Pop-Rock moderno con pegada definida.';

  if (aiArtifactScore >= 62 || scan.highFreqCutoffHz <= 16500) {
    recommendedPresetId = 'de-ai-studio-rescue';
    recommendationReason = `Se detectó dureza en 2.9–4.8 kHz (${aiArtifactScore}%) o techo en ${(scan.highFreqCutoffHz / 1000).toFixed(1)} kHz. Se recomienda De-AI Studio Rescue para suavizar y reconstruir aire.`;
  } else if (loudness.crestFactorDb >= 13.5 && profile.sub < -15.0) {
    recommendedPresetId = '90s-acoustic-country';
    recommendationReason = `Amplio rango dinámico (${loudness.crestFactorDb} dB Crest). Ideal para saturación cálida a válvulas preservando dinámica.`;
  } else if (profile.sub >= -13.0 && profile.presence >= -14.2) {
    recommendedPresetId = 'crisp-latin-pop';
    recommendationReason =
      'Fuerte presencia de sub-graves y articulación moderna; Crisp Latin Pop optimizará el impacto comercial.';
  } else if (profile.lowMid <= -16.8 && loudness.crestFactorDb >= 10.5) {
    recommendedPresetId = 'nu-disco-funk';
    recommendationReason =
      'Transientes limpias y medios despejados; Nu-Disco & Modern Funk realzará el groove.';
  } else if (profile.air >= -17.8 && loudness.phaseCorrelation >= 0.65) {
    recommendedPresetId = 'modern-worship-arena';
    recommendationReason =
      'Buena apertura espacial y centro definido; Modern Worship & Arena expandirá el halo estéreo.';
  }

  const targetPreset: MasteringPreset = getPresetById(
    currentPresetId || recommendedPresetId
  );
  const target = targetPreset.targetSpectralProfile;

  const clampDelta = (d: number) =>
    Number(Math.max(-2.0, Math.min(2.0, d * 0.4)).toFixed(2));

  const subDeltaDb = clampDelta(target.sub - profile.sub);
  const lowMidDeltaDb = clampDelta(target.lowMid - profile.lowMid);
  const presenceDeltaDb = clampDelta(target.presence - profile.presence);
  const airDeltaDb = clampDelta(target.air - profile.air);

  const desiredTargetLufs = targetPreset.dspChain.limiter.targetLufs;
  const autoMakeupGainDb = Number(
    Math.max(-8, Math.min(16, desiredTargetLufs - loudness.integratedLufs)).toFixed(2)
  );

  const diagnostics = buildDiagnosticSuggestions(
    scan,
    targetPreset,
    loudness.crestFactorDb,
    loudness.phaseCorrelation
  );

  const forensicSignature = calculateForensicSignature(
    profile,
    loudness.phaseCorrelation,
    DEFAULT_FORENSIC_HUMANIZER_CONFIG,
    DEFAULT_DRUM_LAYERING_CONFIG,
    {
      bassConcentrationPct: scan.bassConcentrationPct,
      highFreqCutoffHz: scan.highFreqCutoffHz,
      harshnessScore: aiArtifactScore,
    }
  );

  let detectedDrumHits: DrumHitEvent[] = [];
  if (fluxOnsets) {
    detectedDrumHits = filterSpectralFluxDrumHits(
      fluxOnsets,
      kickSensitivity,
      snareSensitivity
    );
  } else if (buffer) {
    const drumScanner = new DrumTransientReplacerDSP();
    detectedDrumHits = drumScanner.detectDrumTransients(buffer, {
      ...DEFAULT_DRUM_LAYERING_CONFIG,
      kickSensitivity,
      snareSensitivity,
    });
  }

  return {
    analyzedDurationSec: Number(durationSec.toFixed(2)),
    sampleRate,
    detectedInputLufs: loudness.integratedLufs,
    detectedTruePeakDb: loudness.truePeakDbTp,
    detectedCrestFactorDb: loudness.crestFactorDb,
    detectedPhaseCorrelation: loudness.phaseCorrelation,
    inputSpectralProfile: profile,
    recommendedPresetId,
    recommendationReason,
    aiArtifactScore,
    sibilanceScore,
    subRumbleDb: scan.subRumbleDb,
    detectedResonanceLines: scan.detectedResonanceLines,
    forensicSignature,
    detectedDrumHits,
    deltaAdjustments: {
      subDeltaDb,
      lowMidDeltaDb,
      presenceDeltaDb,
      airDeltaDb,
      autoMakeupGainDb,
    },
    ...diagnostics,
  };
}

/**
 * Synchronous full-bandwidth FFT + BS.1770-4 analyzer (used in headless audits and tests).
 */
export function analyzeTrackAndComputeAdaptation(
  buffer: AudioBuffer,
  currentPresetId?: string,
  kickSensitivity = DEFAULT_DRUM_LAYERING_CONFIG.kickSensitivity,
  snareSensitivity = DEFAULT_DRUM_LAYERING_CONFIG.snareSensitivity
): SpectralAdaptationReport {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  const loudness = computeFullLoudnessReport(channels, buffer.sampleRate);
  const { left, right } = downmixToStereoArrays(channels);
  const welch = analyzeFullBandwidthSpectrum(left, right, buffer.sampleRate);

  return finalizeReportFromRaw(
    loudness,
    welch,
    buffer.duration,
    buffer.sampleRate,
    null,
    buffer,
    currentPresetId,
    kickSensitivity,
    snareSensitivity
  );
}

let workerReqSeq = 1;

/**
 * Asynchronous off-main-thread analyzer via Web Worker so 5-minute WAV tracks
 * never stutter or freeze the UI while decoding/scanning.
 */
export async function analyzeTrackAndComputeAdaptationAsync(
  buffer: AudioBuffer,
  currentPresetId?: string,
  kickSensitivity = DEFAULT_DRUM_LAYERING_CONFIG.kickSensitivity,
  snareSensitivity = DEFAULT_DRUM_LAYERING_CONFIG.snareSensitivity
): Promise<SpectralAdaptationReport> {
  if (typeof Worker === 'undefined') {
    return analyzeTrackAndComputeAdaptation(
      buffer,
      currentPresetId,
      kickSensitivity,
      snareSensitivity
    );
  }

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  const { left, right } = downmixToStereoArrays(channels);
  const leftCopy = new Float32Array(left);
  const rightCopy = new Float32Array(right);

  return new Promise<SpectralAdaptationReport>((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = new SpectralAnalyzerWorker();
    } catch {
      resolve(analyzeTrackAndComputeAdaptation(buffer, currentPresetId));
      return;
    }

    const reqId = workerReqSeq++;
    const timeoutId = setTimeout(() => {
      worker?.terminate();
      resolve(analyzeTrackAndComputeAdaptation(buffer, currentPresetId));
    }, 15000);

    worker.onmessage = (
      ev: MessageEvent<{
        id: number;
        success: boolean;
        loudness?: LoudnessReport;
        spectral?: WelchSpectralMetrics;
        fluxOnsets?: SpectralFluxOnsetResult;
      }>
    ) => {
      if (ev.data?.id !== reqId) return;
      clearTimeout(timeoutId);
      worker?.terminate();

      if (ev.data.success && ev.data.loudness && ev.data.spectral) {
        resolve(
          finalizeReportFromRaw(
            ev.data.loudness,
            ev.data.spectral,
            buffer.duration,
            buffer.sampleRate,
            ev.data.fluxOnsets ?? null,
            buffer,
            currentPresetId,
            kickSensitivity,
            snareSensitivity
          )
        );
      } else {
        resolve(analyzeTrackAndComputeAdaptation(buffer, currentPresetId));
      }
    };

    worker.onerror = () => {
      clearTimeout(timeoutId);
      worker?.terminate();
      resolve(analyzeTrackAndComputeAdaptation(buffer, currentPresetId));
    };

    worker.postMessage(
      {
        id: reqId,
        left: leftCopy,
        right: rightCopy,
        sampleRate: buffer.sampleRate,
        kickSensitivity,
        snareSensitivity,
      },
      [leftCopy.buffer, rightCopy.buffer]
    );
  });
}

export function recomputeDeltasForPreset(
  report: SpectralAdaptationReport,
  preset: MasteringPreset
): SpectralAdaptationReport {
  const target = preset.targetSpectralProfile;
  const profile = report.inputSpectralProfile;
  const clampDelta = (d: number) =>
    Number(Math.max(-2.0, Math.min(2.0, d * 0.4)).toFixed(2));

  const autoMakeupGainDb = Number(
    Math.max(
      -8,
      Math.min(16, preset.dspChain.limiter.targetLufs - report.detectedInputLufs)
    ).toFixed(2)
  );

  const detectedSibilancePeakHz =
    report.filterSuggestions.find((f) => f.id === 'de-esser')?.patchOverrides
      .sibilanceFreqHz ?? 6200;

  const reconstructedScan: DeepDiagnosticScan = {
    profile,
    aiArtifactScore: report.aiArtifactScore,
    sibilanceScore: report.sibilanceScore,
    subRumbleDb: report.subRumbleDb ?? -26,
    mudExcessDb: Number((profile.lowMid - -16.8).toFixed(1)),
    vocalPocketDeficitDb: Number((-14.2 - profile.presence).toFixed(1)),
    airDeficitDb: Number((-17.4 - profile.air).toFixed(1)),
    detectedSibilancePeakHz,
    stereoSideEnergyPct: report.stereoWidthSuggestion.detectedStereoEnergyPct,
    bassPhaseCorrelation:
      report.stereoWidthSuggestion.detectedBassPhaseCorrelation,
    bassConcentrationPct: report.forensicSignature.bassEnergyConcentrationPct,
    highFreqCutoffHz:
      report.forensicSignature.measuredBandwidthHz ??
      report.forensicSignature.highFreqCutoffDetectedHz,
    detectedResonanceLines: report.detectedResonanceLines,
  };

  const diagnostics = buildDiagnosticSuggestions(
    reconstructedScan,
    preset,
    report.detectedCrestFactorDb,
    report.detectedPhaseCorrelation
  );

  return {
    ...report,
    ...diagnostics,
    deltaAdjustments: {
      subDeltaDb: clampDelta(target.sub - profile.sub),
      lowMidDeltaDb: clampDelta(target.lowMid - profile.lowMid),
      presenceDeltaDb: clampDelta(target.presence - profile.presence),
      airDeltaDb: clampDelta(target.air - profile.air),
      autoMakeupGainDb,
    },
  };
}

export { PRO_PRESETS_CATALOG };
