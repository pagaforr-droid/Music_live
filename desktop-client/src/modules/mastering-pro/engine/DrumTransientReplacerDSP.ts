import type {
  DrumHitEvent,
  DrumKitStyle,
  DrumLayeringConfig,
} from '../types/mastering.types';

export type { DrumHitEvent, DrumKitStyle, DrumLayeringConfig };

export const DEFAULT_DRUM_LAYERING_CONFIG: DrumLayeringConfig = {
  enabled: false,
  kickMix: 0.45,
  snareMix: 0.4,
  kickSensitivity: 0.62,
  snareSensitivity: 0.58,
  drumStyle: 'stadium-rock',
  suppressOriginalMud: true,
  humanizeRoundRobin: true,
  duckOriginalTransients: true,
};

export interface TransientDuckHandles {
  kickDuckFilter: BiquadFilterNode;
  snareDuckFilter: BiquadFilterNode;
}

export class DrumTransientReplacerDSP {
  private customKickBuffer: AudioBuffer | null = null;
  private customSnareBuffer: AudioBuffer | null = null;
  private customKickName: string | null = null;
  private customSnareName: string | null = null;
  private synthCache = new Map<string, AudioBuffer>();
  private activeScheduledNodes: AudioScheduledSourceNode[] = [];

  public async loadCustomSample(
    type: 'kick' | 'snare',
    file: File,
    ctx: BaseAudioContext
  ): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    if (type === 'kick') {
      this.customKickBuffer = decoded;
      this.customKickName = file.name;
    } else {
      this.customSnareBuffer = decoded;
      this.customSnareName = file.name;
    }
    return file.name;
  }

  public clearCustomSample(type: 'kick' | 'snare'): void {
    if (type === 'kick') {
      this.customKickBuffer = null;
      this.customKickName = null;
    } else {
      this.customSnareBuffer = null;
      this.customSnareName = null;
    }
  }

  public getCustomSampleNames(): {
    kickName: string | null;
    snareName: string | null;
  } {
    return {
      kickName: this.customKickName,
      snareName: this.customSnareName,
    };
  }

  /**
   * Analiza matemáticamente el AudioBuffer (del stem de Drums o de la mezcla estéreo)
   * y detecta los milisegundos exactos donde golpean el Bombo (Kick) y la Caja (Snare).
   */
  public detectDrumTransients(
    audioBuffer: AudioBuffer,
    config: DrumLayeringConfig
  ): DrumHitEvent[] {
    const sampleRate = audioBuffer.sampleRate;
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 =
      audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    const length = ch0.length;
    if (length === 0) return [];

    // Medir pico global para normalizar el detector ante pistas con distinto volumen de entrada
    let peakAbs = 0.01;
    const scanStep = Math.max(1, Math.floor(length / 32000));
    for (let i = 0; i < length; i += scanStep) {
      const m = Math.abs((ch0[i] + ch1[i]) * 0.5);
      if (m > peakAbs) peakAbs = m;
    }
    const normGain = Math.min(4.0, 0.75 / peakAbs);

    // Ventana de análisis de 3 milisegundos para precisión sub-milisegundo de impacto
    const hopSize = Math.max(32, Math.floor(sampleRate * 0.003));
    const events: DrumHitEvent[] = [];

    // Estados de filtros IIR para aislar Sub-Kick (<105Hz) y Cuerpo/Ataque de Snare (200Hz - 4.5kHz)
    let lowPassState = 0;
    let midHighState = 0;
    const kickAlpha = (2 * Math.PI * 95) / (sampleRate + 2 * Math.PI * 95);
    const snareAlpha = (2 * Math.PI * 350) / (sampleRate + 2 * Math.PI * 350);

    let prevKickEnv = 0;
    let prevSnareEnv = 0;
    let lastKickTime = -1;
    let lastSnareTime = -1;

    // Umbrales dinámicos inversamente proporcionales a la sensibilidad elegida
    const kickSens = Math.max(0.1, Math.min(1.0, config.kickSensitivity));
    const snareSens = Math.max(0.1, Math.min(1.0, config.snareSensitivity));
    const kickThreshold = 0.052 * (1.18 - kickSens * 0.88);
    const snareThreshold = 0.042 * (1.18 - snareSens * 0.88);

    // Periodo refractario mínimo entre golpes (evita dobles disparos en un mismo impacto)
    const minKickIntervalSec = 0.095;
    const minSnareIntervalSec = 0.09;

    for (let i = 0; i < length - hopSize; i += hopSize) {
      let kickEnergySum = 0;
      let snareEnergySum = 0;

      for (let j = 0; j < hopSize; j++) {
        const monoSample = (ch0[i + j] + ch1[i + j]) * 0.5 * normGain;

        // Filtro paso-bajo para aislar el golpe fundamental del Bombo
        lowPassState += kickAlpha * (monoSample - lowPassState);
        const kickSample = lowPassState;

        // Filtro paso-alto/banda para aislar la Caja y su bordona
        const highPassed = monoSample - lowPassState;
        midHighState += snareAlpha * (highPassed - midHighState);
        const snareSample = highPassed - midHighState * 0.5;

        kickEnergySum += kickSample * kickSample;
        snareEnergySum += snareSample * snareSample;
      }

      const kickRms = Math.sqrt(kickEnergySum / hopSize);
      const snareRms = Math.sqrt(snareEnergySum / hopSize);

      // Derivada de primer orden (First-Order Energy Flux: ataque ascendente rápido)
      const kickFlux = Math.max(0, kickRms - prevKickEnv);
      const snareFlux = Math.max(0, snareRms - prevSnareEnv);

      prevKickEnv = kickRms * 0.85 + prevKickEnv * 0.15;
      prevSnareEnv = snareRms * 0.85 + prevSnareEnv * 0.15;

      const currentTimeSec = Number((i / sampleRate).toFixed(4));

      // Evaluar disparo de Bombo (Kick)
      if (
        kickFlux > kickThreshold &&
        currentTimeSec - lastKickTime >= minKickIntervalSec
      ) {
        const velocity = Number(
          Math.min(
            1.0,
            Math.max(0.25, kickFlux / (kickThreshold * 3.0))
          ).toFixed(3)
        );
        events.push({ timeSec: currentTimeSec, type: 'kick', velocity });
        lastKickTime = currentTimeSec;
      }

      // Evaluar disparo de Caja (Snare)
      if (
        snareFlux > snareThreshold &&
        snareRms > kickRms * 0.52 &&
        currentTimeSec - lastSnareTime >= minSnareIntervalSec
      ) {
        const velocity = Number(
          Math.min(
            1.0,
            Math.max(0.25, snareFlux / (snareThreshold * 3.0))
          ).toFixed(3)
        );
        events.push({ timeSec: currentTimeSec, type: 'snare', velocity });
        lastSnareTime = currentTimeSec;
      }
    }

    return events;
  }

  /**
   * Programa todos los golpes de batería detectados en sincronía sample-accurate
   * con el AudioContext (tiempo real) o el OfflineAudioContext (exportación WAV 24-bit).
   * Cuando duckOriginalTransients está activo, atenúa quirúrgicamente (-8.5dB por 20ms)
   * la transiente sintética original de Suno en el instante exacto del impacto acústico.
   */
  public scheduleDrumLayers(
    ctx: BaseAudioContext,
    destinationNode: AudioNode,
    events: DrumHitEvent[],
    config: DrumLayeringConfig,
    audioStartContextTime: number,
    playbackOffsetSec = 0,
    trackDurationSec = 0,
    loopCycles = 1,
    transientDuckHandles?: TransientDuckHandles,
    playbackRate = 1.0
  ): void {
    const isOffline =
      typeof OfflineAudioContext !== 'undefined' &&
      ctx instanceof OfflineAudioContext;
    if (!isOffline) {
      this.stopScheduledLayers();
    }

    if (transientDuckHandles) {
      try {
        transientDuckHandles.kickDuckFilter.gain.cancelScheduledValues(0);
        transientDuckHandles.kickDuckFilter.gain.setValueAtTime(0, 0);
        transientDuckHandles.snareDuckFilter.gain.cancelScheduledValues(0);
        transientDuckHandles.snareDuckFilter.gain.setValueAtTime(0, 0);
      } catch {
        // Ignore if context is at 0
      }
    }
    if (!config.enabled || events.length === 0) return;

    const safeRate = Math.max(0.5, Math.min(2.0, playbackRate || 1.0));
    const kickBuffer =
      this.customKickBuffer ||
      this.getOrSynthesizeKickBuffer(ctx, config.drumStyle);
    const snareBuffer =
      this.customSnareBuffer ||
      this.getOrSynthesizeSnareBuffer(ctx, config.drumStyle);

    const cycles = Math.max(1, Math.min(8, loopCycles));

    for (let cycle = 0; cycle < cycles; cycle++) {
      const cycleTimeOffset =
        cycle === 0 ? 0 : cycle * Math.max(0.1, trackDurationSec);

      events.forEach((hit, index) => {
        if (cycle === 0 && hit.timeSec < playbackOffsetSec - 0.005) return;

        const isKick = hit.type === 'kick';
        const mixAmount = isKick ? config.kickMix : config.snareMix;
        if (mixAmount <= 0.01) return;

        let triggerTime =
          audioStartContextTime +
          (hit.timeSec + cycleTimeOffset - playbackOffsetSec) / safeRate;

        // Ducking quirúrgico de la transiente sintética original (18-22ms)
        if (
          transientDuckHandles &&
          config.duckOriginalTransients !== false &&
          triggerTime >= 0.003
        ) {
          const duckParam = isKick
            ? transientDuckHandles.kickDuckFilter.gain
            : transientDuckHandles.snareDuckFilter.gain;
          const maxDuckDb =
            -8.8 * Math.min(1, mixAmount * 1.35) * Math.max(0.45, hit.velocity);
          const preTime = Math.max(0, triggerTime - 0.002);
          const peakTime = triggerTime + 0.0025;
          const releaseTime = triggerTime + (isKick ? 0.024 : 0.019);

          duckParam.setValueAtTime(0, preTime);
          duckParam.linearRampToValueAtTime(maxDuckDb, peakTime);
          duckParam.linearRampToValueAtTime(0, releaseTime);
        }

        const source = ctx.createBufferSource();
        source.buffer = isKick ? kickBuffer : snareBuffer;

        const hitGain = ctx.createGain();
        hitGain.gain.value = hit.velocity * mixAmount * 0.92;

        // Micro-Humanización Round-Robin (100% Centrada, CERO paneo lateral L/R)
        if (config.humanizeRoundRobin) {
          const seedIdx = index + cycle * 997;
          const pseudoRand1 = Math.sin(seedIdx * 12.9898) * 43758.5453;
          const frac1 = pseudoRand1 - Math.floor(pseudoRand1);
          const pseudoRand2 = Math.sin(seedIdx * 78.233) * 19341.7219;
          const frac2 = pseudoRand2 - Math.floor(pseudoRand2);

          // 1. Variación orgánica de afinación (±0.6%) sincronizada con el playbackRate global
          source.playbackRate.value = safeRate * (0.994 + frac1 * 0.012);

          // 2. Micro-desplazamiento de tiempo (±0.15 ms) idéntico en L y R
          triggerTime += (frac2 - 0.5) * 0.0003;

          // 3. Variación sutil de timbre (sin StereoPanner para mantener bombo y caja clavados al centro)
          const timbreFilter = ctx.createBiquadFilter();
          timbreFilter.type = 'peaking';
          timbreFilter.frequency.value = isKick
            ? 68 + frac1 * 20
            : 2350 + frac1 * 550;
          timbreFilter.Q.value = 1.4;
          timbreFilter.gain.value = (frac2 - 0.5) * 1.4;

          source.connect(timbreFilter);
          timbreFilter.connect(hitGain);
        } else {
          source.playbackRate.value = safeRate;
          source.connect(hitGain);
        }

        hitGain.connect(destinationNode);

        source.start(Math.max(0, triggerTime));
        if (!isOffline) {
          this.activeScheduledNodes.push(source);
        }
      });
    }
  }

  public stopScheduledLayers(): void {
    this.activeScheduledNodes.forEach((node) => {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Ignorar nodos que ya terminaron de sonar
      }
    });
    this.activeScheduledNodes = [];
  }

  private getOrSynthesizeKickBuffer(
    ctx: BaseAudioContext,
    style: DrumKitStyle
  ): AudioBuffer {
    const key = `kick:${ctx.sampleRate}:${style}`;
    const cached = this.synthCache.get(key);
    if (cached) return cached;
    const buf = this.synthesizeStudioKickBuffer(ctx, style);
    this.synthCache.set(key, buf);
    return buf;
  }

  private getOrSynthesizeSnareBuffer(
    ctx: BaseAudioContext,
    style: DrumKitStyle
  ): AudioBuffer {
    const key = `snare:${ctx.sampleRate}:${style}`;
    const cached = this.synthCache.get(key);
    if (cached) return cached;
    const buf = this.synthesizeStudioSnareBuffer(ctx, style);
    this.synthCache.set(key, buf);
    return buf;
  }

  /**
   * Genera un sample de Bombo Acústico de Estudio de alta definición (Punch en 52-60Hz + Clic de mazo en 3.2kHz)
   */
  private synthesizeStudioKickBuffer(
    ctx: BaseAudioContext,
    style: DrumKitStyle
  ): AudioBuffer {
    const sr = ctx.sampleRate;
    const duration = style === 'arena-worship' ? 0.36 : 0.31;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const startFreq =
      style === 'stadium-rock'
        ? 158
        : style === 'tight-pop-funk'
        ? 172
        : style === 'warm-acoustic'
        ? 132
        : 148;
    const endFreq =
      style === 'warm-acoustic'
        ? 56
        : style === 'tight-pop-funk'
        ? 53
        : 49;
    const bodyDecay =
      style === 'tight-pop-funk'
        ? 14.5
        : style === 'arena-worship'
        ? 9.8
        : 11.5;

    let phase = 0;
    let hpfState = 0;
    const hpfAlpha = (2 * Math.PI * 33) / (sr + 2 * Math.PI * 33);

    let seed = 0x13579bdf;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const currentFreq = endFreq + (startFreq - endFreq) * Math.exp(-t * 38);
      phase += (2 * Math.PI * currentFreq) / sr;

      const body =
        Math.sin(phase) * Math.exp(-t * bodyDecay) +
        0.19 * Math.sin(phase * 2) * Math.exp(-t * 22);

      const beaterClick =
        nextRand() * Math.exp(-t * 280) * 0.52 +
        Math.sin(2 * Math.PI * 3150 * t) * Math.exp(-t * 240) * 0.36;

      const raw = Math.tanh((body + beaterClick) * 1.35);
      // Corte limpio infrasónico debajo de 33Hz
      hpfState += hpfAlpha * (raw - hpfState);
      const cleanSample = raw - hpfState;

      left[i] = cleanSample;
      right[i] = cleanSample;
    }
    return buffer;
  }

  /**
   * Genera un sample de Caja (Snare) Acústica 100% centrada en fase con transiente real y cuerpo en 210Hz
   */
  private synthesizeStudioSnareBuffer(
    ctx: BaseAudioContext,
    style: DrumKitStyle
  ): AudioBuffer {
    const sr = ctx.sampleRate;
    const duration = style === 'arena-worship' ? 0.44 : 0.29;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    let phase1 = 0;
    let phase2 = 0;

    const baseF1 =
      style === 'tight-pop-funk'
        ? 222
        : style === 'warm-acoustic'
        ? 192
        : 205;
    const baseF2 =
      style === 'tight-pop-funk'
        ? 352
        : style === 'warm-acoustic'
        ? 310
        : 330;

    let seed = 0x2468ace0;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const f1 = baseF1 + 90 * Math.exp(-t * 55);
      const f2 = baseF2 + 60 * Math.exp(-t * 45);
      phase1 += (2 * Math.PI * f1) / sr;
      phase2 += (2 * Math.PI * f2) / sr;

      const shellBody =
        (0.65 * Math.sin(phase1) + 0.35 * Math.sin(phase2)) *
        Math.exp(-t * 24);

      const wireDecay =
        style === 'arena-worship'
          ? 10.5
          : style === 'tight-pop-funk'
          ? 19.5
          : 15.5;
      const wireMono = nextRand() * Math.exp(-t * wireDecay) * 0.65;

      const stickCrack =
        Math.sin(2 * Math.PI * 2450 * t) * Math.exp(-t * 310) * 0.62;

      const sample = Math.tanh((shellBody + stickCrack + wireMono) * 1.25);
      left[i] = sample;
      right[i] = sample;
    }
    return buffer;
  }
}
