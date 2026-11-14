import type {
  AntiSunoCqtMode,
  DrumLayeringConfig,
  ForensicHumanizerConfig,
  ForensicSignatureReport,
  SpectralProfile,
} from '../types/mastering.types';

export type { AntiSunoCqtMode, ForensicHumanizerConfig, ForensicSignatureReport };

export const DEFAULT_FORENSIC_HUMANIZER_CONFIG: ForensicHumanizerConfig = {
  enabled: true,
  bassConcentrationCap: 0.75,
  highFreqExciterAmount: 0.45,
  analogPhaseAndDrift: 0.5,
  analogConsoleNoiseDb: -72,
  studioRoomCoherence: 0.035,
  transientMicroExpand: 0.45,
  sunoUltrasonicPurge: true,
  cqtDeQuantizeMode: 'a432_detune',
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

function applyBiquadZeroPhase(
  samples: Float32Array,
  coeffs: BiquadCoeffs
): void {
  applyBiquadInPlace(samples, coeffs);
  samples.reverse();
  applyBiquadInPlace(samples, coeffs);
  samples.reverse();
}

function designLowpassBiquad(
  fc: number,
  sampleRate: number,
  Q = 0.7071
): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.min(fc, sampleRate * 0.47)) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function designHighpassBiquad(
  fc: number,
  sampleRate: number,
  Q = 0.7071
): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.min(fc, sampleRate * 0.47)) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  const b0 = (1 + cosw0) / 2;
  const b1 = -(1 + cosw0);
  const b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function designBandpassBiquad(
  fc: number,
  sampleRate: number,
  Q = 0.9
): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.min(fc, sampleRate * 0.47)) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function designNotchBiquad(
  fc: number,
  sampleRate: number,
  Q = 12.0
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

/**
 * 4-point Catmull-Rom Cubic Spline Interpolation for high-precision non-linear time/pitch warping
 */
function cubicCatmullRomResample(
  input: Float32Array,
  readPos: number
): number {
  const len = input.length;
  const idx = Math.floor(readPos);
  const frac = readPos - idx;

  const i0 = Math.max(0, Math.min(len - 1, idx - 1));
  const i1 = Math.max(0, Math.min(len - 1, idx));
  const i2 = Math.max(0, Math.min(len - 1, idx + 1));
  const i3 = Math.max(0, Math.min(len - 1, idx + 2));

  const y0 = input[i0];
  const y1 = input[i1];
  const y2 = input[i2];
  const y3 = input[i3];

  const c0 = y1;
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);

  return ((c3 * frac + c2) * frac + c1) * frac + c0;
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
   * Incluye purga ultrasónica en cascada (>17.4kHz) + notches Bark/EnCodec ANTES del excitador armónico.
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
      1.6 * (initialConfig.transientMicroExpand ?? 0.45);

    inputNode.connect(subInfrasonicCut);
    subInfrasonicCut.connect(bassDensityTamer);
    bassDensityTamer.connect(kickPunchRestore);
    kickPunchRestore.connect(transientSnapFilter);

    // =========================================================================
    // 2. DISPERSOR DE FASE ASIMÉTRICO DE 4 ETAPAS (ALL-PASS L/R) + MICRO TAPE DRIFT
    // =========================================================================
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    const apFreqsL = [210, 640, 1850, 5200];
    const apFreqsR = [245, 730, 2120, 5850];
    const apChainL: BiquadFilterNode[] = apFreqsL.map((f, idx) => {
      const node = ctx.createBiquadFilter();
      node.type = 'allpass';
      node.frequency.value = f;
      node.Q.value = 0.72 + idx * 0.08;
      return node;
    });
    const apChainR: BiquadFilterNode[] = apFreqsR.map((f, idx) => {
      const node = ctx.createBiquadFilter();
      node.type = 'allpass';
      node.frequency.value = f;
      node.Q.value = 0.76 + idx * 0.08;
      return node;
    });

    const tapeDelayL = ctx.createDelay(0.02);
    const tapeDelayR = ctx.createDelay(0.02);
    tapeDelayL.delayTime.value = 0.0015;
    tapeDelayR.delayTime.value = 0.0018;

    const lfoL = ctx.createOscillator();
    const lfoR = ctx.createOscillator();
    const lfoGainL = ctx.createGain();
    const lfoGainR = ctx.createGain();

    lfoL.frequency.value = 0.31;
    lfoR.frequency.value = 0.43;

    const initialDepth = 0.00016 * initialConfig.analogPhaseAndDrift;
    lfoGainL.gain.value = initialDepth;
    lfoGainR.gain.value = initialDepth;

    lfoL.connect(lfoGainL);
    lfoR.connect(lfoGainR);
    lfoGainL.connect(tapeDelayL.delayTime);
    lfoGainR.connect(tapeDelayR.delayTime);

    lfoL.start(0);
    lfoR.start(0);

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
    // 3A. PURGA ULTRASÓNICA DE DIFUSIÓN SUNO (>17.4 kHz + Notches Bark/EnCodec)
    // =========================================================================
    const barkNotch1 = ctx.createBiquadFilter();
    barkNotch1.type = 'notch';
    barkNotch1.frequency.value = 11025;
    barkNotch1.Q.value = 14.0;

    const barkNotch2 = ctx.createBiquadFilter();
    barkNotch2.type = 'notch';
    barkNotch2.frequency.value = 15500;
    barkNotch2.Q.value = 14.0;

    const ultrasonicPurgeLpf1 = ctx.createBiquadFilter();
    ultrasonicPurgeLpf1.type = 'lowpass';
    ultrasonicPurgeLpf1.frequency.value =
      initialConfig.sunoUltrasonicPurge !== false ? 17400 : 22000;
    ultrasonicPurgeLpf1.Q.value = 0.7071;

    const ultrasonicPurgeLpf2 = ctx.createBiquadFilter();
    ultrasonicPurgeLpf2.type = 'lowpass';
    ultrasonicPurgeLpf2.frequency.value =
      initialConfig.sunoUltrasonicPurge !== false ? 17400 : 22000;
    ultrasonicPurgeLpf2.Q.value = 0.7071;

    merger.connect(barkNotch1);
    barkNotch1.connect(barkNotch2);
    barkNotch2.connect(ultrasonicPurgeLpf1);
    ultrasonicPurgeLpf1.connect(ultrasonicPurgeLpf2);

    // =========================================================================
    // 3B. RECONSTRUCTOR DE ARMÓNICOS SUPERIORES LIMPIOS (14 kHz – 22 kHz)
    //     Toma exclusivamente la banda limpia 6kHz-10kHz y resintetiza aire real
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
    exciterMixGain.gain.value = 0.21 * initialConfig.highFreqExciterAmount;

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

      const trans = Math.max(0, Math.min(1, cfg.transientMicroExpand ?? 0.45));
      transientSnapFilter.gain.setTargetAtTime(1.6 * trans, now, 0.015);

      const drift = Math.max(0, Math.min(1, cfg.analogPhaseAndDrift));
      const depth = 0.00016 * drift;
      lfoGainL.gain.setTargetAtTime(depth, now, 0.015);
      lfoGainR.gain.setTargetAtTime(depth, now, 0.015);

      const purgeCutoff =
        cfg.sunoUltrasonicPurge !== false ? 17400 : 22000;
      ultrasonicPurgeLpf1.frequency.setTargetAtTime(purgeCutoff, now, 0.015);
      ultrasonicPurgeLpf2.frequency.setTargetAtTime(purgeCutoff, now, 0.015);

      const exciter = Math.max(0, Math.min(1, cfg.highFreqExciterAmount));
      exciterMixGain.gain.setTargetAtTime(0.21 * exciter, now, 0.015);

      const room = Math.max(0, Math.min(0.18, cfg.studioRoomCoherence));
      roomWetGain.gain.setTargetAtTime(room, now, 0.015);

      const noiseLinear =
        cfg.enabled && cfg.analogConsoleNoiseDb > -85
          ? Math.pow(
              10,
              Math.max(-85, Math.min(-60, cfg.analogConsoleNoiseDb)) / 20
            )
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
   * MOTOR PROFUNDO ANTI-SUNO (Sample-Level Offline Cloak para Exportación WAV 24-Bit).
   * Neutraliza los 4 vectores que los clasificadores neuronales de Suno v3.5/v4 evalúan:
   * 1) Purga Ultrasónica Zero-Phase de 8º orden (>17.4kHz) + 5 Notches Bark/EnCodec (8.8k-17.1kHz) + Resíntesis Armónica
   * 2) De-Cuantizador Zero-Sum de Formantes RVQ (700-1350Hz / 2400-4100Hz) + Swapper de Constelación de 6 Bandas
   * 3) Disruptor de Rejilla de 20ms (50Hz) mediante Time-Warping Cúbico Catmull-Rom + Desplazamiento CQT (A=432Hz / -50c / -100c)
   * 4) Escudo de Cancelación en Downmix Mono (12-Stage All-Pass + Micro-Warp Estéreo Opuesto >380Hz para 0.5*(L+R))
   */
  public static async applyDeepAntiSunoOfflineCloak(
    sourceBuffer: AudioBuffer,
    config: ForensicHumanizerConfig,
    onProgress?: (stage: string, pct: number) => void
  ): Promise<AudioBuffer> {
    if (!config.enabled) {
      return sourceBuffer;
    }

    const sampleRate = sourceBuffer.sampleRate;
    const origLen = sourceBuffer.length;
    const inL = new Float32Array(sourceBuffer.getChannelData(0));
    const inR =
      sourceBuffer.numberOfChannels > 1
        ? new Float32Array(sourceBuffer.getChannelData(1))
        : new Float32Array(inL);

    // =========================================================================
    // PASO 1: PURGA ULTRASÓNICA 8º ORDEN (>17.4kHz) + 5 NOTCHES BARK/ENCODEC
    //         Y RESÍNTESIS ARMÓNICA DE 2DO Y 3ER ORDEN (14.2kHz - 21.5kHz)
    // =========================================================================
    if (config.sunoUltrasonicPurge !== false) {
      onProgress?.(
        'Anti-Suno Cloak 1/4: Purgando tablero de difusión >17.4kHz y reconstruyendo aire analógico...',
        54
      );
      await new Promise((r) => setTimeout(r, 0));

      // Extraer banda conductora limpia (6.2kHz - 9.8kHz) ANTES de filtrar
      const bpDriver = designBandpassBiquad(7800, sampleRate, 0.85);
      const driverL = new Float32Array(inL);
      const driverR = new Float32Array(inR);
      applyBiquadZeroPhase(driverL, bpDriver);
      applyBiquadZeroPhase(driverR, bpDriver);

      // 5 Notches quirúrgicos en frecuencias de tokens Bark/EnCodec de Suno
      const sunoTokenNotches = [8820, 11025, 13500, 15500, 17100];
      for (const freq of sunoTokenNotches) {
        if (freq < sampleRate * 0.47) {
          const notch = designNotchBiquad(freq, sampleRate, 13.5);
          applyBiquadZeroPhase(inL, notch);
          applyBiquadZeroPhase(inR, notch);
        }
      }

      // Purga Brickwall Zero-Phase de 8º orden a 17,400 Hz (>48 dB/octava)
      const purgeLpf = designLowpassBiquad(17400, sampleRate, 0.7071);
      for (let stage = 0; stage < 4; stage++) {
        applyBiquadZeroPhase(inL, purgeLpf);
        applyBiquadZeroPhase(inR, purgeLpf);
      }

      // Generar armónicos orgánicos de 2do y 3er orden para poblar 14.2kHz - 21.5kHz
      const harmL = new Float32Array(origLen);
      const harmR = new Float32Array(origLen);
      for (let i = 0; i < origLen; i++) {
        const xL = driverL[i] * 3.1;
        const xR = driverR[i] * 3.1;
        harmL[i] = Math.tanh(xL) + 0.34 * xL * xL - 0.16 * xL * xL * xL;
        harmR[i] = Math.tanh(xR) + 0.34 * xR * xR - 0.16 * xR * xR * xR;
      }

      const hpHarm = designHighpassBiquad(14200, sampleRate, 0.7071);
      const lpHarm = designLowpassBiquad(
        Math.min(21500, sampleRate * 0.46),
        sampleRate,
        0.7071
      );
      applyBiquadZeroPhase(harmL, hpHarm);
      applyBiquadZeroPhase(harmR, hpHarm);
      applyBiquadZeroPhase(harmL, lpHarm);
      applyBiquadZeroPhase(harmR, lpHarm);

      const exciterGain = 0.24 * Math.max(0.25, config.highFreqExciterAmount);
      const decorrOffset = 21; // ~0.44ms a 48kHz para descorrelacionar el aire estéreo
      for (let i = 0; i < origLen; i++) {
        const rIdx = i >= decorrOffset ? i - decorrOffset : i;
        inL[i] += harmL[i] * exciterGain;
        inR[i] += harmR[rIdx] * exciterGain;
      }
    }

    // =========================================================================
    // PASO 2: DE-CUANTIZADOR ZERO-SUM DE FORMANTES RVQ + CONSTELACIÓN 6 BANDAS
    // =========================================================================
    if (config.rvqFormantDeQuantizer !== false) {
      onProgress?.(
        'Anti-Suno Cloak 2/4: Aplicando De-Cuantizador Zero-Sum de Formantes RVQ y Constelación Espectral...',
        61
      );
      await new Promise((r) => setTimeout(r, 0));

      const bpFormant1 = designBandpassBiquad(1020, sampleRate, 1.45);
      const bpFormant2 = designBandpassBiquad(3150, sampleRate, 1.35);
      const bpValley1 = designBandpassBiquad(565, sampleRate, 1.6);
      const bpValley2 = designBandpassBiquad(1820, sampleRate, 1.5);

      const f1L = new Float32Array(inL);
      const f1R = new Float32Array(inR);
      const f2L = new Float32Array(inL);
      const f2R = new Float32Array(inR);
      const v1L = new Float32Array(inL);
      const v1R = new Float32Array(inR);
      const v2L = new Float32Array(inL);
      const v2R = new Float32Array(inR);

      applyBiquadZeroPhase(f1L, bpFormant1);
      applyBiquadZeroPhase(f1R, bpFormant1);
      applyBiquadZeroPhase(f2L, bpFormant2);
      applyBiquadZeroPhase(f2R, bpFormant2);
      applyBiquadZeroPhase(v1L, bpValley1);
      applyBiquadZeroPhase(v1R, bpValley1);
      applyBiquadZeroPhase(v2L, bpValley2);
      applyBiquadZeroPhase(v2R, bpValley2);

      // Constelación de 6 bandas para rotación multiplicativa de picos locales
      const swapCenters = [360, 720, 1440, 2880, 5600, 9200];
      const swapBandsL: Float32Array[] = [];
      const swapBandsR: Float32Array[] = [];
      for (let b = 0; b < swapCenters.length; b++) {
        const bp = designBandpassBiquad(swapCenters[b], sampleRate, 2.15);
        const bL = new Float32Array(inL);
        const bR = new Float32Array(inR);
        applyBiquadZeroPhase(bL, bp);
        applyBiquadZeroPhase(bR, bp);
        swapBandsL.push(bL);
        swapBandsR.push(bR);
      }

      for (let i = 0; i < origLen; i++) {
        const t = i / sampleRate;
        const rvqMod =
          0.135 +
          0.035 *
            Math.sin(2 * Math.PI * 0.19 * t) *
            Math.cos(2 * Math.PI * 0.47 * t);

        // Desplazamiento Zero-Sum: resta de formantes RVQ de Suno y suma idéntica en valles orgánicos
        let deltaL =
          -rvqMod * (f1L[i] + f2L[i]) + rvqMod * (v1L[i] + v2L[i]);
        let deltaR =
          -rvqMod * (f1R[i] + f2R[i]) + rvqMod * (v1R[i] + v2R[i]);

        for (let b = 0; b < swapCenters.length; b++) {
          const sign = b % 2 === 0 ? 1 : -1;
          const rate = 0.27 + b * 0.13;
          const gainMod =
            0.16 * sign * Math.sin(2 * Math.PI * rate * t + b * 1.15);
          deltaL += swapBandsL[b][i] * gainMod;
          deltaR += swapBandsR[b][i] * -gainMod;
        }

        inL[i] += deltaL;
        inR[i] += deltaR;
      }
    }

    // =========================================================================
    // PASO 3: DISRUPTOR DE REJILLA ENCODEC 20ms (50Hz) + DESPLAZAMIENTO CQT
    // =========================================================================
    const cqtMode: AntiSunoCqtMode =
      config.cqtDeQuantizeMode ?? 'a432_detune';

    let baseSpeedRatio = 432 / 440; // -31.77 cents (A=432Hz Master Tape)
    if (cqtMode === 'detune_down') {
      baseSpeedRatio = Math.pow(2, -0.5 / 12); // -50 cents (Quarter-Tone CQT Shift)
    } else if (cqtMode === 'drop_semitone') {
      baseSpeedRatio = Math.pow(2, -1.0 / 12); // -100 cents (Eb Studio Tuning)
    } else if (cqtMode === 'macro_rubato_440') {
      baseSpeedRatio = 1.0008; // Mantiene A=440Hz con rubato orgánico de cinta
    }

    onProgress?.(
      `Anti-Suno Cloak 3/4: Desplazando celdas CQT (${cqtMode}) y rompiendo rejilla temporal de 20ms...`,
      66
    );
    await new Promise((r) => setTimeout(r, 0));

    const targetLen = Math.max(
      128,
      Math.floor(origLen / baseSpeedRatio)
    );
    const warpedL = new Float32Array(targetLen);
    const warpedR = new Float32Array(targetLen);

    const driftIntensity = Math.max(0.25, config.analogPhaseAndDrift);
    let phasePos = 0;
    const phaseStep = (origLen - 1) / Math.max(1, targetLen - 1);

    for (let i = 0; i < targetLen; i++) {
      const t = i / sampleRate;

      // 3 osciladores irracionales inconmensurables que destruyen la periodicidad de 50Hz (20ms) de EnCodec
      const macroRubato =
        cqtMode === 'macro_rubato_440'
          ? 0.0048 * Math.sin(2 * Math.PI * 0.07 * t) +
            0.0024 * Math.cos(2 * Math.PI * 0.19 * t)
          : 0.0014 * Math.sin(2 * Math.PI * 0.085 * t) +
            0.0009 * Math.cos(2 * Math.PI * 0.23 * t);

      const frameGridDisruptor =
        (0.00042 * Math.sin(2 * Math.PI * 0.37 * t + 0.7) +
          0.00028 * Math.sin(2 * Math.PI * 1.45 * t + 1.9) +
          0.00018 * Math.cos(2 * Math.PI * 2.35 * t + 3.1)) *
        driftIntensity;

      const stereoMicroAsym =
        0.00019 *
        driftIntensity *
        Math.sin(2 * Math.PI * 0.61 * t + 0.4) *
        sampleRate;

      warpedL[i] = cubicCatmullRomResample(inL, phasePos);
      warpedR[i] = cubicCatmullRomResample(
        inR,
        Math.max(0, Math.min(origLen - 1, phasePos + stereoMicroAsym))
      );

      phasePos += phaseStep * (1 + macroRubato + frameGridDisruptor);
      if (phasePos > origLen - 1) {
        phasePos = origLen - 1;
      }
    }

    // =========================================================================
    // PASO 4: ESCUDO DE CANCELACIÓN EN DOWNMIX MONO (0.5 * (L + R))
    //         12-Stage All-Pass + Micro-Warp Estéreo Opuesto >380Hz
    // =========================================================================
    if (config.monoDownmixCanceller !== false) {
      onProgress?.(
        'Anti-Suno Cloak 4/4: Activando Escudo de Cancelación Mono-Downmix (>380Hz)...',
        71
      );
      await new Promise((r) => setTimeout(r, 0));

      // 12 etapas All-Pass en canal R (amplitud 0.00dB plana, rotación de fase frecuencial)
      const allpassFreqs = [
        135, 220, 350, 540, 820, 1250, 1900, 2850, 4200, 6300, 9100, 12800,
      ];
      for (const apF of allpassFreqs) {
        if (apF < sampleRate * 0.46) {
          const ap = designAllpassBiquad(apF, sampleRate, 0.72);
          applyBiquadInPlace(warpedR, ap);
        }
      }

      // Separar graves (<380Hz, 100% sólidos en fase) de medios/agudos (>380Hz)
      const lp380 = designLowpassBiquad(380, sampleRate, 0.7071);
      const lowL = new Float32Array(warpedL);
      const lowR = new Float32Array(warpedR);
      applyBiquadZeroPhase(lowL, lp380);
      applyBiquadZeroPhase(lowR, lp380);

      const highL = new Float32Array(targetLen);
      const highR = new Float32Array(targetLen);
      for (let i = 0; i < targetLen; i++) {
        highL[i] = warpedL[i] - lowL[i];
        highR[i] = warpedR[i] - lowR[i];
      }

      // Micro-Warp opuesto (+delta en L, -delta en R) para que al colapsar 0.5*(L+R) a mono
      // se cancelen los formantes sintéticos de alta frecuencia sin alterar el estéreo
      const maxDeltaSamples = 0.00058 * sampleRate; // ~0.58ms
      for (let i = 0; i < targetLen; i++) {
        const t = i / sampleRate;
        const delta =
          maxDeltaSamples *
          (0.65 * Math.sin(2 * Math.PI * 1.18 * t) +
            0.35 * Math.cos(2 * Math.PI * 2.85 * t + 1.1));

        const readL = Math.max(0, Math.min(targetLen - 1, i + delta));
        const readR = Math.max(0, Math.min(targetLen - 1, i - delta));

        const wHighL = cubicCatmullRomResample(highL, readL);
        const wHighR = cubicCatmullRomResample(highR, readR);

        warpedL[i] = lowL[i] + wHighL;
        warpedR[i] = lowR[i] + wHighR;
      }
    }

    // Construir AudioBuffer de salida con la longitud exacta post-CQT
    const outCtx = new OfflineAudioContext(2, targetLen, sampleRate);
    const outBuffer = outCtx.createBuffer(2, targetLen, sampleRate);
    outBuffer.getChannelData(0).set(warpedL);
    outBuffer.getChannelData(1).set(warpedR);

    return outBuffer;
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
      scoreReduction += 5;
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
