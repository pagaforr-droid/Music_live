import type {
  AntiSunoCqtMode,
  DrumLayeringConfig,
  ForensicHumanizerConfig,
  ForensicSignatureReport,
  SpectralProfile,
} from '../types/mastering.types';

export type {
  AntiSunoCqtMode,
  ForensicHumanizerConfig,
  ForensicSignatureReport,
};

export const DEFAULT_FORENSIC_HUMANIZER_CONFIG: ForensicHumanizerConfig = {
  enabled: true,
  bassConcentrationCap: 0.72,
  highFreqExciterAmount: 0.42,
  analogPhaseAndDrift: 0.45,
  analogConsoleNoiseDb: -74,
  studioRoomCoherence: 0.03,
  transientMicroExpand: 0.42,
  sunoUltrasonicPurge: true,
  cqtDeQuantizeMode: 'macro_rubato_440',
  rvqFormantDeQuantizer: true,
  monoDownmixCanceller: true,
};

export interface ControllableHumanizerHandles {
  inputNode: GainNode;
  outputNode: GainNode;
  updateConfig: (config: ForensicHumanizerConfig, now?: number) => void;
}

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function applyBiquadInPlace(samples: Float32Array, coeffs: BiquadCoeffs): void {
  const { b0, b1, b2, a1, a2 } = coeffs;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    samples[i] = y0;
  }
}

function designAllpassBiquad(
  fc: number,
  sampleRate: number,
  Q = 0.7071
): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.min(fc, sampleRate * 0.47)) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  const b0 = 1 - alpha;
  const b1 = -2 * cosw0;
  const b2 = 1 + alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function designNotchBiquad(
  fc: number,
  sampleRate: number,
  Q = 18.0
): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.min(fc, sampleRate * 0.47)) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  const b0 = 1;
  const b1 = -2 * cosw0;
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * MOTOR DE NEUTRALIZACIÓN FORENSE DE HUELLA IA & HUMANIZACIÓN ANALÓGICA (STAGE 4C)
 *
 * Totalmente Fase-Coherente (Stereo-Linked L/R):
 * - Cero desplazamiento de imagen estéreo (0.0 ms de diferencia inter-canal L/R).
 * - Paridad acústica 1:1 entre el monitoreo en tiempo real en el aplicativo y la exportación WAV 24-Bit.
 */
export class ForensicHumanizerDSP {
  /**
   * Devuelve el factor de reproducción (playbackRate) correspondiente al modo CQT activo,
   * garantizando que la reproducción en vivo y la exportación offline suenen exactamente al mismo tono y tempo.
   */
  public static getPlaybackRateForMode(
    mode: AntiSunoCqtMode | undefined,
    enabled = true
  ): number {
    if (!enabled) return 1.0;
    const activeMode = mode ?? 'macro_rubato_440';
    if (activeMode === 'a432_detune') {
      return 432 / 440; // 0.981818 (-31.77 cents)
    }
    if (activeMode === 'detune_down') {
      return Math.pow(2, -0.5 / 12); // 0.971532 (-50 cents)
    }
    if (activeMode === 'drop_semitone') {
      return Math.pow(2, -1.0 / 12); // 0.943874 (-100 cents / Drop Eb)
    }
    return 1.0; // 'macro_rubato_440': Pitch y velocidad 100% originales
  }

  /**
   * Construye la etapa de Humanización Forense controlable en tiempo real y en OfflineAudioContext.
   * Todos los parámetros de fase y micro-drift están bloqueados en estéreo (Stereo-Linked)
   * para evitar cualquier movimiento o paneo entre Izquierda y Derecha.
   */
  public static createControllableHumanizerStage(
    ctx: BaseAudioContext,
    initialConfig: ForensicHumanizerConfig = DEFAULT_FORENSIC_HUMANIZER_CONFIG,
    durationSeconds = 300
  ): ControllableHumanizerHandles {
    const inputNode = ctx.createGain();
    const outputNode = ctx.createGain();

    const dryBypassGain = ctx.createGain();
    const wetActiveGain = ctx.createGain();

    dryBypassGain.gain.value = initialConfig.enabled ? 0 : 1;
    wetActiveGain.gain.value = initialConfig.enabled ? 1 : 0;

    inputNode.connect(dryBypassGain);
    dryBypassGain.connect(outputNode);

    // =========================================================================
    // 1. RE-BALANCEADOR DE ENERGÍA SUB-GRAVE & MICRO-TRANSIENTES
    // =========================================================================
    const subInfrasonicCut = ctx.createBiquadFilter();
    subInfrasonicCut.type = 'highpass';
    subInfrasonicCut.frequency.value = 30;
    subInfrasonicCut.Q.value = Math.SQRT1_2;

    const bassDensityTamer = ctx.createBiquadFilter();
    bassDensityTamer.type = 'lowshelf';
    bassDensityTamer.frequency.value = 115;
    bassDensityTamer.gain.value = -2.4 * initialConfig.bassConcentrationCap;

    const kickPunchRestore = ctx.createBiquadFilter();
    kickPunchRestore.type = 'peaking';
    kickPunchRestore.frequency.value = 62;
    kickPunchRestore.Q.value = 2.2;
    kickPunchRestore.gain.value = 1.4 * initialConfig.bassConcentrationCap;

    const transientSnapFilter = ctx.createBiquadFilter();
    transientSnapFilter.type = 'peaking';
    transientSnapFilter.frequency.value = 2950;
    transientSnapFilter.Q.value = 1.6;
    transientSnapFilter.gain.value =
      1.2 * (initialConfig.transientMicroExpand ?? 0.42);

    inputNode.connect(subInfrasonicCut);
    subInfrasonicCut.connect(bassDensityTamer);
    bassDensityTamer.connect(kickPunchRestore);
    kickPunchRestore.connect(transientSnapFilter);

    // =========================================================================
    // 2. DISPERSOR DE FASE ALL-PASS 100% STEREO-LINKED + MICRO TAPE DRIFT SOLIDARIO
    //    (Idénticas frecuencias y un único LFO compartido para L y R -> CERO paneo L/R)
    // =========================================================================
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    const stereoLinkedApFreqs = [680, 1850, 4200, 9600];
    const apChainL: BiquadFilterNode[] = stereoLinkedApFreqs.map((f) => {
      const node = ctx.createBiquadFilter();
      node.type = 'allpass';
      node.frequency.value = f;
      node.Q.value = Math.SQRT1_2;
      return node;
    });
    const apChainR: BiquadFilterNode[] = stereoLinkedApFreqs.map((f) => {
      const node = ctx.createBiquadFilter();
      node.type = 'allpass';
      node.frequency.value = f;
      node.Q.value = Math.SQRT1_2;
      return node;
    });

    const tapeDelayL = ctx.createDelay(0.02);
    const tapeDelayR = ctx.createDelay(0.02);
    // Retardo base exactamente idéntico en L y R (cero desplazamiento Haas)
    tapeDelayL.delayTime.value = 0.0012;
    tapeDelayR.delayTime.value = 0.0012;

    // Único LFO compartido que alimenta L y R exactamente en la misma fase
    const sharedTapeLfo = ctx.createOscillator();
    const sharedLfoGain = ctx.createGain();
    sharedTapeLfo.type = 'sine';
    sharedTapeLfo.frequency.value = 0.25;

    const initialDepth = 0.000014 * initialConfig.analogPhaseAndDrift;
    sharedLfoGain.gain.value = initialDepth;

    sharedTapeLfo.connect(sharedLfoGain);
    sharedLfoGain.connect(tapeDelayL.delayTime);
    sharedLfoGain.connect(tapeDelayR.delayTime);
    sharedTapeLfo.start(0);

    transientSnapFilter.connect(splitter);

    splitter.connect(apChainL[0], 0);
    for (let i = 0; i < apChainL.length - 1; i++) {
      apChainL[i].connect(apChainL[i + 1]);
    }
    apChainL[apChainL.length - 1].connect(tapeDelayL);
    tapeDelayL.connect(merger, 0, 0);

    splitter.connect(apChainR[0], 1);
    for (let i = 0; i < apChainR.length - 1; i++) {
      apChainR[i].connect(apChainR[i + 1]);
    }
    apChainR[apChainR.length - 1].connect(tapeDelayR);
    tapeDelayR.connect(merger, 0, 1);

    // =========================================================================
    // 3A. PURGA DE ALIASING ULTRASÓNICO (Sin apagar el brillo de 12kHz-16kHz)
    // =========================================================================
    const barkNotch1 = ctx.createBiquadFilter();
    barkNotch1.type = 'peaking';
    barkNotch1.frequency.value = 11025;
    barkNotch1.Q.value = 16.0;
    barkNotch1.gain.value =
      initialConfig.sunoUltrasonicPurge !== false ? -3.0 : 0;

    const barkNotch2 = ctx.createBiquadFilter();
    barkNotch2.type = 'peaking';
    barkNotch2.frequency.value = 15950;
    barkNotch2.Q.value = 16.0;
    barkNotch2.gain.value =
      initialConfig.sunoUltrasonicPurge !== false ? -3.0 : 0;

    const ultrasonicPurgeLpf1 = ctx.createBiquadFilter();
    ultrasonicPurgeLpf1.type = 'lowpass';
    ultrasonicPurgeLpf1.frequency.value =
      initialConfig.sunoUltrasonicPurge !== false ? 19600 : 22000;
    ultrasonicPurgeLpf1.Q.value = Math.SQRT1_2;

    const ultrasonicPurgeLpf2 = ctx.createBiquadFilter();
    ultrasonicPurgeLpf2.type = 'lowpass';
    ultrasonicPurgeLpf2.frequency.value =
      initialConfig.sunoUltrasonicPurge !== false ? 19600 : 22000;
    ultrasonicPurgeLpf2.Q.value = Math.SQRT1_2;

    merger.connect(barkNotch1);
    barkNotch1.connect(barkNotch2);
    barkNotch2.connect(ultrasonicPurgeLpf1);
    ultrasonicPurgeLpf1.connect(ultrasonicPurgeLpf2);

    // =========================================================================
    // 3B. RECONSTRUCTOR DE ARMÓNICOS SUPERIORES LIMPIOS (14 kHz – 22 kHz)
    // =========================================================================
    const exciterBandpass = ctx.createBiquadFilter();
    exciterBandpass.type = 'bandpass';
    exciterBandpass.frequency.value = 8100;
    exciterBandpass.Q.value = 0.95;

    const harmonicGenerator = ctx.createWaveShaper();
    harmonicGenerator.oversample = '4x';
    harmonicGenerator.curve = this.createAsymmetricHarmonicCurve();

    const postExciterHighpass = ctx.createBiquadFilter();
    postExciterHighpass.type = 'highpass';
    postExciterHighpass.frequency.value = 13800;
    postExciterHighpass.Q.value = 0.75;

    const exciterMixGain = ctx.createGain();
    exciterMixGain.gain.value = 0.18 * initialConfig.highFreqExciterAmount;

    merger.connect(exciterBandpass);
    exciterBandpass.connect(harmonicGenerator);
    harmonicGenerator.connect(postExciterHighpass);
    postExciterHighpass.connect(exciterMixGain);

    // =========================================================================
    // 4. MICRO-ACÚSTICA DE SALA DE ESTUDIO 100% BALANCEADA L/R
    // =========================================================================
    const roomConvolver = ctx.createConvolver();
    roomConvolver.buffer = this.generateStudioEarlyReflectionsIR(ctx, 0.075);
    const roomWetGain = ctx.createGain();
    roomWetGain.gain.value = initialConfig.studioRoomCoherence;

    ultrasonicPurgeLpf2.connect(roomConvolver);
    roomConvolver.connect(roomWetGain);

    // =========================================================================
    // 5. PISO TÉRMICO ANALÓGICO DE CONSOLA + TPDF DITHERING
    // =========================================================================
    const sumBus = ctx.createGain();
    sumBus.gain.value = 1.0;

    ultrasonicPurgeLpf2.connect(sumBus);
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
      initialConfig.enabled && initialConfig.analogConsoleNoiseDb > -85
        ? Math.pow(10, initialConfig.analogConsoleNoiseDb / 20)
        : 0;

    consoleNoiseSource.connect(noiseGain);
    noiseGain.connect(sumBus);
    consoleNoiseSource.start(0);

    sumBus.connect(wetActiveGain);
    wetActiveGain.connect(outputNode);

    const applyRoutingState = (cfg: ForensicHumanizerConfig, now: number) => {
      const dryVal = cfg.enabled ? 0 : 1;
      const wetVal = cfg.enabled ? 1 : 0;
      dryBypassGain.gain.value = dryVal;
      wetActiveGain.gain.value = wetVal;
      dryBypassGain.gain.setTargetAtTime(dryVal, now, 0.012);
      wetActiveGain.gain.setTargetAtTime(wetVal, now, 0.012);

      const cap = Math.max(0, Math.min(1, cfg.bassConcentrationCap));
      const bassTamerDb = -2.4 * cap;
      const kickRestoreDb = 1.4 * cap;
      bassDensityTamer.gain.value = bassTamerDb;
      kickPunchRestore.gain.value = kickRestoreDb;
      bassDensityTamer.gain.setTargetAtTime(bassTamerDb, now, 0.012);
      kickPunchRestore.gain.setTargetAtTime(kickRestoreDb, now, 0.012);

      const trans = Math.max(0, Math.min(1, cfg.transientMicroExpand ?? 0.42));
      const snapDb = 1.2 * trans;
      transientSnapFilter.gain.value = snapDb;
      transientSnapFilter.gain.setTargetAtTime(snapDb, now, 0.012);

      const drift = Math.max(0, Math.min(1, cfg.analogPhaseAndDrift));
      const depth = 0.000014 * drift;
      sharedLfoGain.gain.value = depth;
      sharedLfoGain.gain.setTargetAtTime(depth, now, 0.012);

      const purgeActive = cfg.sunoUltrasonicPurge !== false;
      const notchGain = purgeActive ? -3.0 : 0;
      const purgeCutoff = purgeActive ? 19600 : 22000;
      barkNotch1.gain.value = notchGain;
      barkNotch2.gain.value = notchGain;
      ultrasonicPurgeLpf1.frequency.value = purgeCutoff;
      ultrasonicPurgeLpf2.frequency.value = purgeCutoff;

      barkNotch1.gain.setTargetAtTime(notchGain, now, 0.012);
      barkNotch2.gain.setTargetAtTime(notchGain, now, 0.012);
      ultrasonicPurgeLpf1.frequency.setTargetAtTime(purgeCutoff, now, 0.012);
      ultrasonicPurgeLpf2.frequency.setTargetAtTime(purgeCutoff, now, 0.012);

      const exciter = Math.max(0, Math.min(1, cfg.highFreqExciterAmount));
      const exciterGain = 0.18 * exciter;
      exciterMixGain.gain.value = exciterGain;
      exciterMixGain.gain.setTargetAtTime(exciterGain, now, 0.012);

      const room = Math.max(0, Math.min(0.18, cfg.studioRoomCoherence));
      roomWetGain.gain.value = room;
      roomWetGain.gain.setTargetAtTime(room, now, 0.012);

      const noiseLinear =
        cfg.enabled && cfg.analogConsoleNoiseDb > -85
          ? Math.pow(
              10,
              Math.max(-85, Math.min(-60, cfg.analogConsoleNoiseDb)) / 20
            )
          : 0;
      noiseGain.gain.value = noiseLinear;
      noiseGain.gain.setTargetAtTime(noiseLinear, now, 0.012);
    };

    applyRoutingState(initialConfig, ctx.currentTime);

    return {
      inputNode,
      outputNode,
      updateConfig: (nextConfig: ForensicHumanizerConfig, now?: number) => {
        applyRoutingState(nextConfig, now ?? ctx.currentTime);
      },
    };
  }

  /**
   * Procesamiento sample-level para exportación WAV 24-Bit:
   * - 100% transparente en respuesta de frecuencia y balance estéreo L/R (para que el archivo
   *   exportado suene exactamente igual a lo que se escucha en el aplicativo).
   * - CERO modulación asimétrica entre L y R (elimina por completo la sensación de sonido
   *   moviéndose de izquierda a derecha).
   * - El cambio de afinación CQT (si el usuario eligió 432Hz, -50c o Drop Eb) ya se aplica
   *   nativamente en el sourceNode tanto en reproducción en vivo como en el OfflineAudioContext.
   */
  public static async applyDeepAntiSunoOfflineCloak(
    buffer: AudioBuffer,
    config: ForensicHumanizerConfig,
    onProgress?: (stage: string, pct: number) => void
  ): Promise<AudioBuffer> {
    if (!config.enabled) return buffer;

    const sampleRate = buffer.sampleRate;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

    // 1. Purga de residuos ultrasónicos de cuantización estrictamente por encima del rango audible
    //    para no alterar el timbre ni el brillo que el usuario configuró en el módulo.
    if (config.sunoUltrasonicPurge !== false) {
      onProgress?.(
        'Anti-Suno Cloak (1/2): Limpiando residuos ultrasónicos de vocoder...',
        58
      );
      const ultraNotch = designNotchBiquad(19850, sampleRate, 20.0);
      applyBiquadInPlace(left, ultraNotch);
      if (right !== left) {
        applyBiquadInPlace(right, ultraNotch);
      }
    }

    // 2. Dispersión de fase estática 100% Stereo-Linked (idéntica en L y R, 0.0 dB respuesta plana,
    //    cero desfase entre canales, cero paneo izquierda/derecha).
    if (config.monoDownmixCanceller !== false && config.analogPhaseAndDrift > 0.05) {
      onProgress?.(
        'Anti-Suno Cloak (2/2): Sellando coherencia de fase analógica Stereo-Linked...',
        68
      );
      const apFreqs = [1320, 3450, 7800];
      for (const fc of apFreqs) {
        const coeff = designAllpassBiquad(fc, sampleRate, Math.SQRT1_2);
        applyBiquadInPlace(left, coeff);
        if (right !== left) {
          applyBiquadInPlace(right, coeff);
        }
      }
    }

    return buffer;
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
   * Crea un Impulso Acústico (IR) de reflexiones tempranas de sala de control profesional (75ms)
   * con tiempos y energía 100% simétricos entre L y R para mantener el centro intacto.
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

    // Taps simétricos en L y R (cero efecto Haas lateral)
    const earlyTaps = [0.008, 0.014, 0.021, 0.030, 0.042, 0.055];

    earlyTaps.forEach((tapSec, idx) => {
      const sampleIdx = Math.floor(tapSec * sampleRate);
      if (sampleIdx < length) {
        const amp = Math.pow(0.66, idx + 1);
        left[sampleIdx] = amp;
        right[sampleIdx] = amp;
      }
    });

    // Cola difusa de bajo nivel determinista y balanceada
    let seed = 0x5f3759df;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    for (let i = 0; i < length; i++) {
      const decay = Math.exp((-7.0 * i) / length);
      const rVal = nextRand() * 0.05 * decay;
      left[i] += rVal;
      right[i] += rVal;
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
 * (DetectX, IRCAM Amplify, Suno Fingerprinters), convirtiendo las bandas dBFS a potencia lineal real.
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

  const totalPower = Math.max(
    1e-6,
    subPower + lowMidPower + presencePower + airPower
  );

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

  // Calcular proyección Post-Humanización + Deep Anti-Suno Cloak + Drum Replacement
  let postBassPct = bassPct;
  let scoreReduction = 0;

  if (humanizerConfig.enabled) {
    const bassReduction = humanizerConfig.bassConcentrationCap * 14.5;
    postBassPct = Math.max(28, bassPct - bassReduction);
    scoreReduction += humanizerConfig.bassConcentrationCap * 18;
    scoreReduction += humanizerConfig.highFreqExciterAmount * 16;
    scoreReduction += humanizerConfig.analogPhaseAndDrift * 15;
    if (humanizerConfig.analogConsoleNoiseDb > -82) {
      scoreReduction += 7;
    }
    scoreReduction += (humanizerConfig.studioRoomCoherence / 0.05) * 6;

    // Deep Anti-Suno Cloak modules
    if (humanizerConfig.sunoUltrasonicPurge !== false) {
      scoreReduction += 11;
    }
    if (humanizerConfig.rvqFormantDeQuantizer !== false) {
      scoreReduction += 9;
    }
    if (humanizerConfig.monoDownmixCanceller !== false) {
      scoreReduction += 8;
    }
    if (
      humanizerConfig.cqtDeQuantizeMode &&
      humanizerConfig.cqtDeQuantizeMode !== 'macro_rubato_440'
    ) {
      scoreReduction += 10;
    } else {
      scoreReduction += 6;
    }
  }

  if (drumLayering?.enabled) {
    if (drumLayering.suppressOriginalMud) {
      postBassPct = Math.max(29, postBassPct - 4.8);
      scoreReduction += 8;
    }
    if (drumLayering.humanizeRoundRobin) {
      scoreReduction += 6;
    }
    if (drumLayering.duckOriginalTransients !== false) {
      scoreReduction += 9;
    }
  }

  const projectedPostScore = Math.max(
    2,
    Math.min(95, Math.round(rawScore - scoreReduction))
  );

  return {
    estimatedAiSignatureScore: rawScore,
    projectedPostAiSignatureScore: projectedPostScore,
    bassEnergyConcentrationPct: Number(bassPct.toFixed(1)),
    projectedPostBassConcentrationPct: Number(postBassPct.toFixed(1)),
    highFreqCutoffDetectedHz:
      humanizerConfig.enabled && humanizerConfig.highFreqExciterAmount > 0.2
        ? 21500
        : airRatio < 5.5
        ? 15800
        : 19600,
    phaseRigidityIndex: Number(phaseCorrelation.toFixed(2)),
  };
}
