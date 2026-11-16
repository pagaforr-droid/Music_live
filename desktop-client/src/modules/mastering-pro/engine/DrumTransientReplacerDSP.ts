import type {
  DrumHitEvent,
  DrumKitStyle,
  DrumLayeringConfig,
} from '../types/mastering.types';
import { detectOnsetsSpectralFlux } from '../dsp-core/SpectralFftCore';

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
    this.setCustomSampleBuffer(type, decoded, file.name);
    return file.name;
  }

  public setCustomSampleBuffer(
    type: 'kick' | 'snare',
    buffer: AudioBuffer,
    name: string
  ): void {
    if (type === 'kick') {
      this.customKickBuffer = buffer;
      this.customKickName = name;
    } else {
      this.customSnareBuffer = buffer;
      this.customSnareName = name;
    }
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

  public getCustomSampleBuffers(): {
    kickBuffer: AudioBuffer | null;
    snareBuffer: AudioBuffer | null;
  } {
    return {
      kickBuffer: this.customKickBuffer,
      snareBuffer: this.customSnareBuffer,
    };
  }

  /**
   * Analiza el AudioBuffer usando Log-Magnitude Spectral Flux (desde dsp-core/SpectralFftCore)
   * y alinea cada impacto por envolvente local + verificación de polaridad para evitar flam/cancelación.
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

    const mono = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      mono[i] = 0.5 * (ch0[i] + ch1[i]);
    }

    const avgSens = Math.max(
      0.1,
      Math.min(1.0, (config.kickSensitivity + config.snareSensitivity) * 0.5)
    );
    const res = detectOnsetsSpectralFlux(mono, sampleRate, {
      sensitivity: avgSens,
      minIntervalMs: 85,
      snapToZeroCrossing: true,
    });

    const events: DrumHitEvent[] = [];
    for (let i = 0; i < res.onsetTimesSec.length; i++) {
      const cls = res.classifications[i];
      if (cls === 'hat') continue;
      // Filter by individual kick/snare sensitivity thresholds
      const vel = res.velocities[i];
      const minVelReq =
        cls === 'kick'
          ? 0.85 - config.kickSensitivity * 0.65
          : 0.85 - config.snareSensitivity * 0.65;
      if (vel < minVelReq * 0.75) continue;

      events.push({
        timeSec: res.onsetTimesSec[i],
        type: cls,
        velocity: vel,
      });
    }

    return events;
  }

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

    const cycles = Math.max(1, Math.min(16, loopCycles));

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

        // Ducking localizado y corto (14ms) para limpiar solapamiento de transientes sin ahuecar el resto
        if (
          transientDuckHandles &&
          config.duckOriginalTransients !== false &&
          triggerTime >= 0.002
        ) {
          const duckParam = isKick
            ? transientDuckHandles.kickDuckFilter.gain
            : transientDuckHandles.snareDuckFilter.gain;
          const maxDuckDb =
            -6.5 * Math.min(1, mixAmount * 1.2) * Math.max(0.45, hit.velocity);
          const preTime = Math.max(0, triggerTime - 0.0015);
          const peakTime = triggerTime + 0.002;
          const releaseTime = triggerTime + (isKick ? 0.016 : 0.013);

          duckParam.setValueAtTime(0, preTime);
          duckParam.linearRampToValueAtTime(maxDuckDb, peakTime);
          duckParam.linearRampToValueAtTime(0, releaseTime);
        }

        const source = ctx.createBufferSource();
        source.buffer = isKick ? kickBuffer : snareBuffer;

        const hitGain = ctx.createGain();
        hitGain.gain.value = hit.velocity * mixAmount * 0.72;

        if (config.humanizeRoundRobin) {
          const seedIdx = index + cycle * 997;
          const pseudoRand1 = Math.sin(seedIdx * 12.9898) * 43758.5453;
          const frac1 = pseudoRand1 - Math.floor(pseudoRand1);
          const pseudoRand2 = Math.sin(seedIdx * 78.233) * 19341.7219;
          const frac2 = pseudoRand2 - Math.floor(pseudoRand2);

          source.playbackRate.value = safeRate * (0.994 + frac1 * 0.012);
          triggerTime += (frac2 - 0.5) * 0.00025;

          const timbreFilter = ctx.createBiquadFilter();
          timbreFilter.type = 'peaking';
          timbreFilter.frequency.value = isKick
            ? 68 + frac1 * 20
            : 2350 + frac1 * 550;
          timbreFilter.Q.value = 1.4;
          timbreFilter.gain.value = (frac2 - 0.5) * 1.2;

          source.connect(timbreFilter);
          timbreFilter.connect(hitGain);
        } else {
          source.playbackRate.value = safeRate;
          source.connect(hitGain);
        }

        hitGain.connect(destinationNode);

        source.onended = () => {
          try {
            source.disconnect();
            hitGain.disconnect();
          } catch {
            // ignore
          }
        };

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
        // already stopped
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

  private synthesizeStudioKickBuffer(
    ctx: BaseAudioContext,
    style: DrumKitStyle
  ): AudioBuffer {
    const sr = ctx.sampleRate;
    const duration = style === 'arena-worship' ? 0.34 : 0.29;
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
        nextRand() * Math.exp(-t * 280) * 0.45 +
        Math.sin(2 * Math.PI * 3150 * t) * Math.exp(-t * 240) * 0.32;

      const raw = Math.tanh((body + beaterClick) * 1.15);
      hpfState += hpfAlpha * (raw - hpfState);
      const fadeOut = i > length - 128 ? (length - i) / 128 : 1;
      const cleanSample = (raw - hpfState) * fadeOut;

      left[i] = cleanSample;
      right[i] = cleanSample;
    }
    return buffer;
  }

  private synthesizeStudioSnareBuffer(
    ctx: BaseAudioContext,
    style: DrumKitStyle
  ): AudioBuffer {
    const sr = ctx.sampleRate;
    const duration = style === 'arena-worship' ? 0.42 : 0.28;
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
      const wireMono = nextRand() * Math.exp(-t * wireDecay) * 0.55;

      const stickCrack =
        Math.sin(2 * Math.PI * 2450 * t) * Math.exp(-t * 310) * 0.52;

      const fadeOut = i > length - 128 ? (length - i) / 128 : 1;
      const sample = Math.tanh((shellBody + stickCrack + wireMono) * 1.1) * fadeOut;
      left[i] = sample;
      right[i] = sample;
    }
    return buffer;
  }
}
