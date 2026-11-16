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

  const subBoostNeeded = Number(
    Math.max(0.5, Math.min(2.8, (target.sub - profile.sub) * 0.55 + 1.2)).toFixed(1)
  );
  const vocalBoostNeeded = Number(
    Math.max(
      0.5,
      Math.min(2.4, (target.presence - profile.presence) * 0.55 + 1.0)
    ).toFixed(1)
  );
  const airBoostNeeded = Number(
    Math.max(0.8, Math.min(2.8, (target.air - profile.air) * 0.55 + 1.5)).toFixed(1)
  );

  const mudCutRecommended = Number(
    Math.max(-3.2, Math.min(-0.8, -1.4 - Math.max(0, scan.mudExcessDb * 0.5))).toFixed(1)
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
      action: 'boost',
      title: 'Subir Pegada de Sub-Graves (Mid)',
      zoneName: '55 Hz – 65 Hz · Canal MID',
      reason:
        profile.sub < target.sub
          ? `Déficit medido de ${(target.sub - profile.sub).toFixed(1)} dB en fundamentales de bombo y bajo respecto a ${targetPreset.name}.`
          : 'Refuerzo controlado en el centro para dar peso sin ensuciar los lados.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'mid-sub-punch')
          ?.freq ?? 58,
      recommendedGainDb: subBoostNeeded,
      recommendedQ: 0.9,
      channel: 'mid',
      filterType: 'peaking',
      bandId: 'mid-sub-punch',
      priority: profile.sub < target.sub - 1.5 ? 'critical' : 'opportunity',
    },
    {
      id: 'boost-mid-vocal',
      action: 'boost',
      title: 'Subir Claridad y Presencia Vocal (Mid)',
      zoneName: '1.8 kHz – 3.2 kHz · Canal MID',
      reason:
        'Realza la inteligibilidad de la voz líder e instrumentos principales en el centro sin fatiga.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'mid-vocal-bite')
          ?.freq ?? 2400,
      recommendedGainDb: vocalBoostNeeded,
      recommendedQ: 1.15,
      channel: 'mid',
      filterType: 'peaking',
      bandId: 'mid-vocal-bite',
      priority: 'recommended',
    },
    {
      id: 'boost-side-air',
      action: 'boost',
      title: 'Subir Brillo y Aire Tridimensional (Side)',
      zoneName: '12 kHz – 15 kHz · Canal SIDE',
      reason:
        scan.highFreqCutoffHz < 17500
          ? `Ancho de banda detectado hasta ${(scan.highFreqCutoffHz / 1000).toFixed(1)} kHz. Realzar aire en Side aporta apertura sin afectar el centro.`
          : 'Abre el escenario estéreo con un High-Shelf sedoso solo en los lados.',
      freqHz:
        targetPreset.dspChain.eqBands.find((b) => b.id === 'side-air-shelf')
          ?.freq ?? 13000,
      recommendedGainDb: airBoostNeeded,
      recommendedQ: 0.7071,
      channel: 'side',
      filterType: 'highshelf',
      bandId: 'side-air-shelf',
      priority: scan.highFreqCutoffHz < 17500 ? 'critical' : 'opportunity',
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
      suggestionDetail: `Realzar +${airBoostNeeded} dB en canal Side y aplicar ${Math.round(targetPreset.dspChain.saturation.drive * 100)}% de saturación ${targetPreset.dspChain.saturation.type.toUpperCase()}.`,
      confidencePct: 88,
      isRecommended: true,
      patchOverrides: {
        sideAirBoostDb: airBoostNeeded,
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

  if (scan.stereoSideEnergyPct < 18) {
    recommendedWidthPct = 128;
    widthDiagnosis = `Mezcla estrecha (${scan.stereoSideEnergyPct}% Side). Apertura al ${recommendedWidthPct}% segura (Fase ${detectedPhaseCorrelation}).`;
  } else if (scan.stereoSideEnergyPct > 42 || detectedPhaseCorrelation < 0.35) {
    recommendedWidthPct = 104;
    widthDiagnosis = `Mezcla muy abierta (${scan.stereoSideEnergyPct}% Side, Fase ${detectedPhaseCorrelation}). Moderamos a ${recommendedWidthPct}% con Mono Maker @ ${recommendedMonoHz}Hz.`;
  } else {
    recommendedWidthPct = 118;
    widthDiagnosis = `Balance estéreo saludable (${scan.stereoSideEnergyPct}% Side, Fase +${detectedPhaseCorrelation}). Apertura al ${recommendedWidthPct}% con +${airBoostNeeded}dB de Side Air.`;
  }

  const stereoWidthSuggestion: AiStereoWidthSuggestion = {
    detectedStereoEnergyPct: scan.stereoSideEnergyPct,
    detectedBassPhaseCorrelation: scan.bassPhaseCorrelation,
    diagnosis: widthDiagnosis,
    recommendedWidthPct,
    recommendedMonoMakerHz: recommendedMonoHz,
    recommendedSideAirDb: airBoostNeeded,
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
  currentPresetId?: string
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
    for (let i = 0; i < fluxOnsets.onsetTimesSec.length; i++) {
      const cls = fluxOnsets.classifications[i];
      if (cls === 'hat') continue;
      detectedDrumHits.push({
        timeSec: fluxOnsets.onsetTimesSec[i],
        type: cls,
        velocity: fluxOnsets.velocities[i],
      });
    }
  } else if (buffer) {
    const drumScanner = new DrumTransientReplacerDSP();
    detectedDrumHits = drumScanner.detectDrumTransients(
      buffer,
      DEFAULT_DRUM_LAYERING_CONFIG
    );
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
  currentPresetId?: string
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
    currentPresetId
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
    return analyzeTrackAndComputeAdaptation(buffer, currentPresetId);
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
            currentPresetId
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

  return {
    ...report,
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
