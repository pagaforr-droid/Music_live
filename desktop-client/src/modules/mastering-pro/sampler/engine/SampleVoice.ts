import type { PadVoiceParams } from '../types/sampler.types';

export interface VoiceHandle {
  id: number;
  padIndex: number;
  chokeGroup: number | null;
  startedAtCtx: number;
  isReleasing: boolean;
  release: (whenSec?: number) => void;
  forceStopFade: (fadeSec?: number, whenSec?: number) => void;
}

let voiceSeq = 1;

export class SampleVoice {
  public readonly id: number;
  public readonly padIndex: number;
  public readonly chokeGroup: number | null;
  public readonly startedAtCtx: number;
  public isReleasing = false;

  private readonly ctx: BaseAudioContext;
  private readonly source: AudioBufferSourceNode;
  private readonly filterNode: BiquadFilterNode | null = null;
  private readonly ampGain: GainNode;
  private readonly panNode: StereoPannerNode;
  private readonly reverbSend: GainNode | null = null;
  private readonly delaySend: GainNode | null = null;
  private readonly params: PadVoiceParams;
  private stopped = false;

  constructor(options: {
    ctx: BaseAudioContext;
    buffer: AudioBuffer;
    padIndex: number;
    params: PadVoiceParams;
    velocity01: number;
    playbackRate: number;
    loop: boolean;
    mainDest: AudioNode;
    reverbDest?: AudioNode | null;
    delayDest?: AudioNode | null;
    whenSec?: number;
    onEnded?: (voiceId: number) => void;
  }) {
    this.id = voiceSeq++;
    this.ctx = options.ctx;
    this.padIndex = options.padIndex;
    this.params = options.params;
    this.chokeGroup = options.params.chokeGroup;

    const now = options.whenSec ?? this.ctx.currentTime;
    this.startedAtCtx = now;

    this.source = this.ctx.createBufferSource();
    this.source.buffer = options.buffer;
    this.source.playbackRate.value = Math.max(0.125, Math.min(8.0, options.playbackRate));
    this.source.loop = options.loop;

    this.ampGain = this.ctx.createGain();
    this.panNode = this.ctx.createStereoPanner();
    this.panNode.pan.value = Math.max(-1, Math.min(1, this.params.pan));

    // Velocity-scaled peak gain (2ms minimum de-click attack)
    const velFactor =
      1 - this.params.velocitySens + this.params.velocitySens * Math.max(0.05, Math.min(1, options.velocity01));
    const peakLinear = Math.pow(10, this.params.gainDb / 20) * velFactor;
    const attackSec = Math.max(0.002, this.params.amp.attackMs / 1000);
    const decaySec = Math.max(0.005, this.params.amp.decayMs / 1000);
    const sustainLevel = Math.max(0.0001, peakLinear * Math.max(0, Math.min(1, this.params.amp.sustain)));

    this.ampGain.gain.setValueAtTime(0.0001, now);
    this.ampGain.gain.linearRampToValueAtTime(Math.max(0.0001, peakLinear), now + attackSec);
    if (this.params.playMode === 'gate' || this.params.playMode === 'loop') {
      this.ampGain.gain.setTargetAtTime(sustainLevel, now + attackSec, decaySec * 0.45);
    } else {
      // Oneshot: reach peak, then hold decay -> release naturally across sample or envelope
      if (this.params.amp.sustain < 0.99) {
        this.ampGain.gain.setTargetAtTime(sustainLevel, now + attackSec, decaySec * 0.45);
      }
    }

    let tailNode: AudioNode = this.source;
    if (this.params.filter.type !== 'off') {
      const f = this.ctx.createBiquadFilter();
      f.type = this.params.filter.type;
      f.Q.value = Math.max(0.3, Math.min(18, this.params.filter.q));
      const baseCut = Math.max(25, Math.min(19500, this.params.filter.cutoffHz));
      f.frequency.setValueAtTime(baseCut, now);

      if (Math.abs(this.params.filter.envAmountOct) > 0.05) {
        const peakCut = Math.max(
          25,
          Math.min(19500, baseCut * Math.pow(2, this.params.filter.envAmountOct))
        );
        const fAtk = Math.max(0.002, this.params.filter.env.attackMs / 1000);
        const fDec = Math.max(0.005, this.params.filter.env.decayMs / 1000);
        const fSusCut = Math.max(
          25,
          Math.min(
            19500,
            baseCut * Math.pow(2, this.params.filter.envAmountOct * this.params.filter.env.sustain)
          )
        );
        f.frequency.exponentialRampToValueAtTime(peakCut, now + fAtk);
        f.frequency.setTargetAtTime(fSusCut, now + fAtk, fDec * 0.45);
      }
      this.filterNode = f;
      tailNode.connect(f);
      tailNode = f;
    }

    tailNode.connect(this.ampGain);
    this.ampGain.connect(this.panNode);
    this.panNode.connect(options.mainDest);

    if (options.reverbDest && this.params.sends.reverb > 0.005) {
      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = Math.max(0, Math.min(1, this.params.sends.reverb));
      this.panNode.connect(this.reverbSend);
      this.reverbSend.connect(options.reverbDest);
    }

    if (options.delayDest && this.params.sends.delay > 0.005) {
      this.delaySend = this.ctx.createGain();
      this.delaySend.gain.value = Math.max(0, Math.min(1, this.params.sends.delay));
      this.panNode.connect(this.delaySend);
      this.delaySend.connect(options.delayDest);
    }

    this.source.onended = () => {
      this.cleanup();
      options.onEnded?.(this.id);
    };

    this.source.start(now);
  }

  public release(whenSec?: number): void {
    if (this.stopped || this.isReleasing) return;
    if (this.params.playMode === 'oneshot') return;
    this.isReleasing = true;

    const t = whenSec ?? this.ctx.currentTime;
    const relSec = Math.max(0.005, this.params.amp.releaseMs / 1000);
    try {
      this.ampGain.gain.cancelScheduledValues(t);
      this.ampGain.gain.setValueAtTime(Math.max(0.0001, this.ampGain.gain.value), t);
      this.ampGain.gain.linearRampToValueAtTime(0.0001, t + relSec);

      if (this.filterNode && Math.abs(this.params.filter.envAmountOct) > 0.05) {
        const fRel = Math.max(0.005, this.params.filter.env.releaseMs / 1000);
        this.filterNode.frequency.setTargetAtTime(
          Math.max(25, Math.min(19500, this.params.filter.cutoffHz)),
          t,
          fRel * 0.35
        );
      }

      this.source.stop(t + relSec + 0.01);
    } catch {
      this.cleanup();
    }
  }

  public forceStopFade(fadeSec = 0.006, whenSec?: number): void {
    if (this.stopped) return;
    this.isReleasing = true;
    const t = whenSec ?? this.ctx.currentTime;
    const f = Math.max(0.003, fadeSec);
    try {
      this.ampGain.gain.cancelScheduledValues(t);
      this.ampGain.gain.setValueAtTime(Math.max(0.0001, this.ampGain.gain.value), t);
      this.ampGain.gain.linearRampToValueAtTime(0.00001, t + f);
      this.source.stop(t + f + 0.004);
    } catch {
      this.cleanup();
    }
  }

  public toHandle(): VoiceHandle {
    return {
      id: this.id,
      padIndex: this.padIndex,
      chokeGroup: this.chokeGroup,
      startedAtCtx: this.startedAtCtx,
      isReleasing: this.isReleasing,
      release: (w) => this.release(w),
      forceStopFade: (f, w) => this.forceStopFade(f, w),
    };
  }

  private cleanup(): void {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.source.disconnect();
      this.filterNode?.disconnect();
      this.ampGain.disconnect();
      this.panNode.disconnect();
      this.reverbSend?.disconnect();
      this.delaySend?.disconnect();
    } catch {
      // ignore
    }
  }
}
