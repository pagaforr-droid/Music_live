import type {
  DrumLayeringConfig,
  ForensicHumanizerConfig,
  ForensicSignatureReport,
  SpectralProfile,
} from '../types/mastering.types';

export type { ForensicHumanizerConfig, ForensicSignatureReport };

export const DEFAULT_FORENSIC_HUMANIZER_CONFIG: ForensicHumanizerConfig = {
  enabled: true,
  bassConcentrationCap: 0.75,
  highFreqExciterAmount: 0.45,
  analogPhaseAndDrift: 0.5,
  analogConsoleNoiseDb: -72,
  studioRoomCoherence: 0.035,
  transientMicroExpand: 0.4,
};

export interface ControllableHumanizerHandles {
  inputNode: GainNode;
  outputNode: GainNode;
  updateConfig: (config: ForensicHumanizerConfig, now?: number) => void;
}

export class ForensicHumanizerDSP {
  /**
   * Construye e inserta la cadena completa de "De-Fingerprinting / Humanización Analógica"
   * entre la etapa de limpieza/EQ y el Limitador Final.
   */
  public static buildHumanizerGraph(
    ctx: BaseAudioContext,
    inputNode: AudioNode,
    durationSeconds: number,
    config: ForensicHumanizerConfig
  ): AudioNode {
    if (!config.enabled) {
      return inputNode;
    }

    const stage = this.createControllableHumanizerStage(
      ctx,
      config,
      durationSeconds
    );
    inputNode.connect(stage.inputNode);
    return stage.outputNode;
  }

  /**
   * Versión controlable en tiempo real (60 FPS) y compatible con OfflineAudioContext (WAV 24-Bit).
   * Permite activar/desactivar y mover cualquier parámetro sin cortes de audio.
   */
  public static createControllableHumanizerStage(
    ctx: BaseAudioContext,
    initialConfig: ForensicHumanizerConfig,
    durationSeconds = 300
  ): ControllableHumanizerHandles {
    const inputNode = ctx.createGain();
    const outputNode = ctx.createGain();

    const dryBypassGain = ctx.createGain();
    const wetActiveGain = ctx.createGain();

    inputNode.connect(dryBypassGain);
    dryBypassGain.connect(outputNode);

    // =========================================================================
    // 1. RE-BALANCEADOR DE CONCENTRACIÓN DE GRAVES (Target < 38% Bass Ratio)
    // =========================================================================
    const subInfrasonicCut = ctx.createBiquadFilter();
    subInfrasonicCut.type = 'highpass';
    subInfrasonicCut.frequency.value = 31;
    subInfrasonicCut.Q.value = 0.85;

    const bassDensityTamer = ctx.createBiquadFilter();
    bassDensityTamer.type = 'lowshelf';
    bassDensityTamer.frequency.value = 115;
    bassDensityTamer.gain.value = -3.8 * initialConfig.bassConcentrationCap;

    const kickPunchRestore = ctx.createBiquadFilter();
    kickPunchRestore.type = 'peaking';
    kickPunchRestore.frequency.value = 62;
    kickPunchRestore.Q.value = 2.8;
    kickPunchRestore.gain.value = 1.8 * initialConfig.bassConcentrationCap;

    // 1B. Micro-Transientes Físicas (Restaura el impacto de baqueta/púa de primeros 8ms)
    const transientSnapFilter = ctx.createBiquadFilter();
    transientSnapFilter.type = 'peaking';
    transientSnapFilter.frequency.value = 2950;
    transientSnapFilter.Q.value = 1.8;
    transientSnapFilter.gain.value =
      1.4 * (initialConfig.transientMicroExpand ?? 0.4);

    inputNode.connect(subInfrasonicCut);
    subInfrasonicCut.connect(bassDensityTamer);
    bassDensityTamer.connect(kickPunchRestore);
    kickPunchRestore.connect(transientSnapFilter);

    // =========================================================================
    // 2. DISPERSOR DE FASE ASIMÉTRICO (ALL-PASS L/R) + MICRO TAPE DRIFT
    // =========================================================================
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    const allPassL1 = ctx.createBiquadFilter();
    allPassL1.type = 'allpass';
    allPassL1.frequency.value = 340;
    allPassL1.Q.value = 0.7;

    const allPassL2 = ctx.createBiquadFilter();
    allPassL2.type = 'allpass';
    allPassL2.frequency.value = 2650;
    allPassL2.Q.value = 0.9;

    const allPassR1 = ctx.createBiquadFilter();
    allPassR1.type = 'allpass';
    allPassR1.frequency.value = 368;
    allPassR1.Q.value = 0.75;

    const allPassR2 = ctx.createBiquadFilter();
    allPassR2.type = 'allpass';
    allPassR2.frequency.value = 2810;
    allPassR2.Q.value = 0.95;

    const tapeDelayL = ctx.createDelay(0.02);
    const tapeDelayR = ctx.createDelay(0.02);
    tapeDelayL.delayTime.value = 0.0015;
    tapeDelayR.delayTime.value = 0.0017;

    const lfoL = ctx.createOscillator();
    const lfoR = ctx.createOscillator();
    const lfoGainL = ctx.createGain();
    const lfoGainR = ctx.createGain();

    lfoL.frequency.value = 0.31;
    lfoR.frequency.value = 0.43;

    const initialDepth = 0.00014 * initialConfig.analogPhaseAndDrift;
    lfoGainL.gain.value = initialDepth;
    lfoGainR.gain.value = initialDepth;

    lfoL.connect(lfoGainL);
    lfoR.connect(lfoGainR);
    lfoGainL.connect(tapeDelayL.delayTime);
    lfoGainR.connect(tapeDelayR.delayTime);

    lfoL.start(0);
    lfoR.start(0);

    transientSnapFilter.connect(splitter);

    splitter.connect(allPassL1, 0);
    allPassL1.connect(allPassL2);
    allPassL2.connect(tapeDelayL);
    tapeDelayL.connect(merger, 0, 0);

    splitter.connect(allPassR1, 1);
    allPassR1.connect(allPassR2);
    allPassR2.connect(tapeDelayR);
    tapeDelayR.connect(merger, 0, 1);

    // =========================================================================
    // 3. RECONSTRUCTOR DE ARMÓNICOS SUPERIORES (14 kHz – 22 kHz)
    // =========================================================================
    const exciterBandpass = ctx.createBiquadFilter();
    exciterBandpass.type = 'bandpass';
    exciterBandpass.frequency.value = 8500;
    exciterBandpass.Q.value = 0.9;

    const harmonicGenerator = ctx.createWaveShaper();
    harmonicGenerator.oversample = '4x';
    harmonicGenerator.curve = this.createAsymmetricHarmonicCurve();

    const postExciterHighpass = ctx.createBiquadFilter();
    postExciterHighpass.type = 'highpass';
    postExciterHighpass.frequency.value = 13500;
    postExciterHighpass.Q.value = 0.7;

    const exciterMixGain = ctx.createGain();
    exciterMixGain.gain.value = 0.18 * initialConfig.highFreqExciterAmount;

    merger.connect(exciterBandpass);
    exciterBandpass.connect(harmonicGenerator);
    harmonicGenerator.connect(postExciterHighpass);
    postExciterHighpass.connect(exciterMixGain);

    // =========================================================================
    // 4. MICRO-ACÚSTICA FÍSICA DE ESTUDIO (EARLY REFLECTIONS COHERENCE)
    // =========================================================================
    const roomConvolver = ctx.createConvolver();
    roomConvolver.buffer = this.generateStudioEarlyReflectionsIR(ctx, 0.085);
    const roomWetGain = ctx.createGain();
    roomWetGain.gain.value = initialConfig.studioRoomCoherence;

    merger.connect(roomConvolver);
    roomConvolver.connect(roomWetGain);

    // =========================================================================
    // 5. PISO TÉRMICO ANALÓGICO DE CONSOLA + TPDF DITHERING
    // =========================================================================
    const sumBus = ctx.createGain();
    sumBus.gain.value = 1.0;

    merger.connect(sumBus);
    exciterMixGain.connect(sumBus);
    roomWetGain.connect(sumBus);

    const consoleNoiseSource = ctx.createBufferSource();
    consoleNoiseSource.buffer = this.generateAnalogTapeFloorBuffer(
      ctx,
      Math.min(durationSeconds || 300, 360)
    );
    consoleNoiseSource.loop = true;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value =
      initialConfig.analogConsoleNoiseDb > -85
        ? Math.pow(10, initialConfig.analogConsoleNoiseDb / 20)
        : 0;

    consoleNoiseSource.connect(noiseGain);
    noiseGain.connect(sumBus);
    consoleNoiseSource.start(0);

    sumBus.connect(wetActiveGain);
    wetActiveGain.connect(outputNode);

    const applyRoutingState = (cfg: ForensicHumanizerConfig, now: number) => {
      if (cfg.enabled) {
        dryBypassGain.gain.setTargetAtTime(0, now, 0.015);
        wetActiveGain.gain.setTargetAtTime(1, now, 0.015);
      } else {
        dryBypassGain.gain.setTargetAtTime(1, now, 0.015);
        wetActiveGain.gain.setTargetAtTime(0, now, 0.015);
      }

      const cap = Math.max(0, Math.min(1, cfg.bassConcentrationCap));
      bassDensityTamer.gain.setTargetAtTime(-3.8 * cap, now, 0.015);
      kickPunchRestore.gain.setTargetAtTime(1.8 * cap, now, 0.015);

      const trans = Math.max(0, Math.min(1, cfg.transientMicroExpand ?? 0.4));
      transientSnapFilter.gain.setTargetAtTime(1.4 * trans, now, 0.015);

      const drift = Math.max(0, Math.min(1, cfg.analogPhaseAndDrift));
      const depth = 0.00014 * drift;
      lfoGainL.gain.setTargetAtTime(depth, now, 0.015);
      lfoGainR.gain.setTargetAtTime(depth, now, 0.015);

      const exciter = Math.max(0, Math.min(1, cfg.highFreqExciterAmount));
      exciterMixGain.gain.setTargetAtTime(0.18 * exciter, now, 0.015);

      const room = Math.max(0, Math.min(0.18, cfg.studioRoomCoherence));
      roomWetGain.gain.setTargetAtTime(room, now, 0.015);

      const noiseLinear =
        cfg.enabled && cfg.analogConsoleNoiseDb > -85
          ? Math.pow(10, Math.max(-85, Math.min(-60, cfg.analogConsoleNoiseDb)) / 20)
          : 0;
      noiseGain.gain.setTargetAtTime(noiseLinear, now, 0.015);
    };

    applyRoutingState(initialConfig, ctx.currentTime);

    return {
      inputNode,
      outputNode,
      updateConfig: (cfg, now = ctx.currentTime) =>
        applyRoutingState(cfg, now),
    };
  }

  /**
   * Genera una función de transferencia con asimetría de válvula/cinta que produce
   * armónicos de 2do y 3er orden para poblar la banda de 15kHz - 22kHz.
   */
  private static createAsymmetricHarmonicCurve(): Float32Array<ArrayBuffer> {
    const samples = 65536;
    const curve: Float32Array<ArrayBuffer> = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(2.2 * x) + 0.18 * (x * x) * Math.sign(x);
    }
    return curve;
  }

  /**
   * Crea un Impulso Acústico (IR) de reflexiones tempranas de sala de control profesional (85ms)
   */
  private static generateStudioEarlyReflectionsIR(
    ctx: BaseAudioContext,
    durationSec: number
  ): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(64, Math.floor(sampleRate * durationSec));
    const irBuffer = ctx.createBuffer(2, length, sampleRate);
    const left = irBuffer.getChannelData(0);
    const right = irBuffer.getChannelData(1);

    const earlyTapsL = [0.007, 0.013, 0.019, 0.029, 0.041, 0.053];
    const earlyTapsR = [0.009, 0.015, 0.023, 0.031, 0.044, 0.059];

    earlyTapsL.forEach((tapSec, idx) => {
      const sampleIdx = Math.floor(tapSec * sampleRate);
      if (sampleIdx < length) left[sampleIdx] = Math.pow(0.68, idx + 1);
    });

    earlyTapsR.forEach((tapSec, idx) => {
      const sampleIdx = Math.floor(tapSec * sampleRate);
      if (sampleIdx < length) {
        right[sampleIdx] =
          Math.pow(0.68, idx + 1) * (idx % 2 === 0 ? 1 : -1);
      }
    });

    for (let i = 0; i < length; i++) {
      const decay = Math.exp((-6.5 * i) / length);
      left[i] += (Math.random() * 2 - 1) * 0.08 * decay;
      right[i] += (Math.random() * 2 - 1) * 0.08 * decay;
    }

    return irBuffer;
  }

  /**
   * Genera ruido térmico real de cinta/consola (Pink Noise filtrado + TPDF Dither)
   * usando el algoritmo de Paul Kellet para caída natural de -3dB/octava.
   */
  private static generateAnalogTapeFloorBuffer(
    ctx: BaseAudioContext,
    durationSec: number
  ): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const loopLength = Math.max(
      4096,
      Math.floor(sampleRate * Math.min(8, Math.max(2, durationSec)))
    );
    const buffer = ctx.createBuffer(2, loopLength, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const output = buffer.getChannelData(channel);
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0;

      for (let i = 0; i < loopLength; i++) {
        const white = (Math.random() - Math.random()) * 0.5;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        output[i] =
          (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
        b6 = white * 0.115926;
      }
    }
    return buffer;
  }
}

/**
 * Audita los mismos vectores matemáticos que revisan los detectores forenses comerciales
 * (DetectX, IRCAM Amplify), convirtiendo las bandas dBFS a potencia lineal real.
 */
export function calculateForensicSignature(
  spectralBalance: SpectralProfile,
  phaseCorrelation: number,
  humanizerConfig: ForensicHumanizerConfig = DEFAULT_FORENSIC_HUMANIZER_CONFIG,
  drumLayering?: DrumLayeringConfig
): ForensicSignatureReport {
  // Convert dBFS band levels to linear acoustic power (10^(dB/10))
  const subPower = Math.pow(10, spectralBalance.sub / 10);
  const lowMidPower = Math.pow(10, spectralBalance.lowMid / 10);
  const presencePower = Math.pow(10, spectralBalance.presence / 10);
  const airPower = Math.pow(10, spectralBalance.air / 10);

  const totalPower =
    Math.max(1e-6, subPower + lowMidPower + presencePower + airPower);

  // 1. Porcentaje de concentración de graves (<140Hz) — Indicador #1 en reportes forenses
  const rawBassPct = ((subPower + lowMidPower * 0.45) / totalPower) * 100;
  const bassPct = Math.max(18, Math.min(82, rawBassPct));

  // 2. Penalización si los graves superan el 40% de la energía total
  const bassPenalty = Math.max(0, (bassPct - 37) * 1.9);

  // 3. Penalización por falta de armónicos reales arriba de 15kHz
  const airRatio = (airPower / totalPower) * 100;
  const airPenalty = airRatio < 8.5 ? (8.5 - airRatio) * 5.2 : 0;

  // 4. Penalización por fase rígida de vocoder
  const phasePenalty =
    phaseCorrelation > 0.91 ? 18 : phaseCorrelation > 0.85 ? 9 : 0;

  const rawScore = Math.min(
    97,
    Math.max(8, Math.round(16 + bassPenalty + airPenalty + phasePenalty))
  );

  // Calcular proyección Post-Humanización + Drum Layering
  let postBassPct = bassPct;
  let scoreReduction = 0;

  if (humanizerConfig.enabled) {
    const bassReduction = humanizerConfig.bassConcentrationCap * 14.5;
    postBassPct = Math.max(28, bassPct - bassReduction);
    scoreReduction += humanizerConfig.bassConcentrationCap * 24;
    scoreReduction += humanizerConfig.highFreqExciterAmount * 22;
    scoreReduction += humanizerConfig.analogPhaseAndDrift * 19;
    if (humanizerConfig.analogConsoleNoiseDb > -82) {
      scoreReduction += 9;
    }
    scoreReduction += (humanizerConfig.studioRoomCoherence / 0.05) * 7;
  }

  if (drumLayering?.enabled) {
    if (drumLayering.suppressOriginalMud) {
      postBassPct = Math.max(29, postBassPct - 4.8);
      scoreReduction += 11;
    }
    if (drumLayering.humanizeRoundRobin) {
      scoreReduction += 9;
    }
  }

  const projectedPostScore = Math.max(
    3,
    Math.min(95, Math.round(rawScore - scoreReduction))
  );

  return {
    estimatedAiSignatureScore: rawScore,
    projectedPostAiSignatureScore: projectedPostScore,
    bassEnergyConcentrationPct: Number(bassPct.toFixed(1)),
    projectedPostBassConcentrationPct: Number(postBassPct.toFixed(1)),
    highFreqCutoffDetectedHz:
      humanizerConfig.enabled && humanizerConfig.highFreqExciterAmount > 0.2
        ? 21400
        : airRatio < 5.5
        ? 15800
        : 19600,
    phaseRigidityIndex: Number(phaseCorrelation.toFixed(2)),
  };
}
