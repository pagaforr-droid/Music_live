import {
  renderPaulstretchTexture,
  resampleCubicStereo,
  stretchAudioPhaseVocoder,
  stretchAudioWsola,
} from '../../dsp-core/TimeStretchCore';
import { applyTruePeakLookaheadLimiterOffline } from '../../dsp-core/LookaheadLimiterCore';
import type {
  PadVoiceParams,
  SamplePad,
  SampleRegion,
  SampleSource,
  SamplerPattern,
} from '../types/sampler.types';
import { buildCrossfadedLoopArrays } from './LoopCrossfade';
import {
  applyFadesInPlace,
  arraysToAudioBuffer,
  extractRegionArrays,
  normalizeStereoInPlace,
  removeDcOffsetInPlace,
  reverseStereoInPlace,
} from './SampleBufferOps';
import { SampleVoice, type VoiceHandle } from './SampleVoice';
import { SamplerScheduler } from './SamplerScheduler';
import { VoicePool } from './VoicePool';

/**
 * Sample Lab Audio Engine:
 * - Up to 32 polyphonic voices + 8 choke groups + click-free voice stealing
 * - Per-pad cached DSP buffer (Trim, DC-remove, Fade, Normalize, Reverse, Equal-Power Loop Crossfade, WSOLA / Phase Vocoder / Paulstretch)
 * - Global Kit Reverb & Ping-Pong Delay sends + Offline True-Peak Limiting on bounce
 * - Live Microphone / Line-In recording
 * - Bit-identical Offline rendering for single sample, slice pack, and full sequencer bounce
 */
export class SamplerEngine {
  private ctx: AudioContext | null = null;
  private sources = new Map<string, SampleSource>();
  private regions = new Map<string, SampleRegion>();
  private pads: SamplePad[] = [];
  private processedBufferCache = new Map<string, AudioBuffer>();

  private kitBus: GainNode | null = null;
  private reverbConvolver: ConvolverNode | null = null;
  private delayLeft: DelayNode | null = null;
  private delayRight: DelayNode | null = null;
  private delayInputNode: GainNode | null = null;

  private auditionSource: AudioBufferSourceNode | null = null;
  private readonly voicePool = new VoicePool(32);
  private pattern: SamplerPattern;
  private scheduler: SamplerScheduler;

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];

  constructor(
    initialPads: SamplePad[],
    initialPattern: SamplerPattern,
    onStepAdvance?: (step: number) => void,
    onActivePadsChange?: (pads: Set<number>) => void
  ) {
    this.pads = initialPads;
    this.pattern = initialPattern;
    if (onActivePadsChange) {
      this.voicePool.setOnCountChange(onActivePadsChange);
    }
    this.scheduler = new SamplerScheduler(
      initialPattern,
      (padIdx, vel, when) => {
        this.triggerPad(padIdx, vel, when);
      },
      onStepAdvance
    );
  }

  public ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
      this.setupKitRouting(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private setupKitRouting(ctx: BaseAudioContext, targetDest?: AudioNode): {
    kitBus: GainNode;
    reverbInput: ConvolverNode;
    delayInput: GainNode;
    outputGain: GainNode;
  } {
    const kitBus = ctx.createGain();
    kitBus.gain.value = 1.0;

    const outputGain = ctx.createGain();
    outputGain.gain.value = 0.92;

    // Algorithmic Studio Reverb IR (1.45s smooth stereo hall)
    const reverbConvolver = ctx.createConvolver();
    reverbConvolver.buffer = this.buildStudioReverbIr(ctx, 1.45);
    const reverbMasterGain = ctx.createGain();
    reverbMasterGain.gain.value = 0.72;

    // Ping-Pong Stereo Delay
    const delayInput = ctx.createGain();
    const delayLeft = ctx.createDelay(2.0);
    const delayRight = ctx.createDelay(2.0);
    delayLeft.delayTime.value = 0.25;
    delayRight.delayTime.value = 0.375;
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = 0.35;
    fbR.gain.value = 0.35;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 4800;

    const delayMerger = ctx.createChannelMerger(2);
    const delayMasterGain = ctx.createGain();
    delayMasterGain.gain.value = 0.65;

    delayInput.connect(delayLeft);
    delayLeft.connect(delayFilter);
    delayFilter.connect(delayRight);
    delayRight.connect(fbR);
    fbR.connect(delayLeft);
    delayLeft.connect(fbL);
    fbL.connect(delayFilter);

    delayLeft.connect(delayMerger, 0, 0);
    delayRight.connect(delayMerger, 0, 1);
    delayMerger.connect(delayMasterGain);

    kitBus.connect(outputGain);
    reverbConvolver.connect(reverbMasterGain);
    reverbMasterGain.connect(outputGain);
    delayMasterGain.connect(outputGain);

    // Safety soft limiter on live kit bus
    const safetyComp = ctx.createDynamicsCompressor();
    safetyComp.threshold.value = -2.0;
    safetyComp.knee.value = 3.0;
    safetyComp.ratio.value = 16.0;
    safetyComp.attack.value = 0.001;
    safetyComp.release.value = 0.05;

    outputGain.connect(safetyComp);
    safetyComp.connect(targetDest ?? ctx.destination);

    if (ctx === this.ctx) {
      this.kitBus = kitBus;
      this.reverbConvolver = reverbConvolver;
      this.delayLeft = delayLeft;
      this.delayRight = delayRight;
      this.delayInputNode = delayInput;
    }

    return { kitBus, reverbInput: reverbConvolver, delayInput, outputGain };
  }

  private getDelayInput(): GainNode | null {
    return this.delayInputNode;
  }

  private buildStudioReverbIr(ctx: BaseAudioContext, durationSec: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const ir = ctx.createBuffer(2, len, sr);
    const l = ir.getChannelData(0);
    const r = ir.getChannelData(1);

    let s = 0x4321abcd;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s / 0xffffffff) * 2 - 1;
    };

    let lpL = 0;
    let lpR = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.exp(-t * 4.8) * Math.min(1, i / (sr * 0.012));
      lpL = lpL * 0.45 + rand() * 0.55;
      lpR = lpR * 0.45 + rand() * 0.55;
      l[i] = lpL * env * 0.35;
      r[i] = lpR * env * 0.35;
    }
    return ir;
  }

  public syncState(
    sources: SampleSource[],
    regions: SampleRegion[],
    pads: SamplePad[],
    pattern: SamplerPattern
  ): void {
    this.sources.clear();
    for (const s of sources) this.sources.set(s.id, s);

    this.regions.clear();
    for (const r of regions) this.regions.set(r.id, r);

    this.pads = pads;
    this.pattern = pattern;
    this.scheduler.updatePattern(pattern);

    // Sync delay time to quarter/dotted-eighth BPM
    if (this.delayLeft && this.delayRight && this.ctx) {
      const beatSec = 60 / Math.max(40, Math.min(240, pattern.bpm || 120));
      this.delayLeft.delayTime.setTargetAtTime(beatSec * 0.5, this.ctx.currentTime, 0.02);
      this.delayRight.delayTime.setTargetAtTime(beatSec * 0.75, this.ctx.currentTime, 0.02);
    }

    // Prune stale processed buffers cleanly
    if (this.processedBufferCache.size > 48) {
      this.processedBufferCache.clear();
    }
  }

  public async decodeAudioFile(file: File): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    const raw = await file.arrayBuffer();
    return ctx.decodeAudioData(raw.slice(0));
  }

  public async decodeAudioUrl(url: string): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error descargando pista (${res.status})`);
    const raw = await res.arrayBuffer();
    return ctx.decodeAudioData(raw.slice(0));
  }

  private computeTempoSyncScale(
    src: SampleSource,
    params: PadVoiceParams,
    patternOverride?: SamplerPattern
  ): number {
    if (!params.warp.syncToBpm) return 1.0;
    const srcBpm = src.bpm;
    const targetBpm = params.warp.targetBpm ?? (patternOverride ?? this.pattern).bpm ?? srcBpm;
    if (!srcBpm || !targetBpm || srcBpm < 30 || targetBpm < 30) return 1.0;
    return Math.max(0.25, Math.min(4.0, srcBpm / targetBpm));
  }

  public getProcessedBufferForPad(
    ctx: BaseAudioContext,
    region: SampleRegion,
    params: PadVoiceParams,
    patternOverride?: SamplerPattern
  ): AudioBuffer | null {
    const src = this.sources.get(region.sourceId);
    if (!src) return null;

    const tempoStretchScale =
      params.warp.mode === 'varispeed'
        ? 1.0
        : this.computeTempoSyncScale(src, params, patternOverride);
    const activeTargetBpm = params.warp.syncToBpm
      ? (params.warp.targetBpm ?? (patternOverride ?? this.pattern).bpm ?? src.bpm)
      : 0;

    const cacheSig = [
      region.id,
      region.startSec.toFixed(4),
      region.endSec.toFixed(4),
      region.loopCrossfadeMs,
      params.reverse ? 1 : 0,
      params.normalize ? 1 : 0,
      params.fadeInMs,
      params.fadeOutMs,
      params.playMode,
      params.warp.mode,
      params.warp.syncToBpm ? 1 : 0,
      src.bpm.toFixed(2),
      activeTargetBpm.toFixed(2),
      params.warp.timeStretchRatio.toFixed(3),
      params.pitchSemis,
      params.fineCents,
      params.granular.stretchFactor.toFixed(1),
      ctx.sampleRate,
    ].join('|');

    const cached = this.processedBufferCache.get(cacheSig);
    if (cached && cached.sampleRate === ctx.sampleRate) {
      return cached;
    }

    let { left, right, sampleRate } = extractRegionArrays(
      src.buffer,
      region.startSec,
      region.endSec
    );

    removeDcOffsetInPlace(left, right);

    if (params.playMode === 'loop') {
      const xf = buildCrossfadedLoopArrays(
        src.buffer.getChannelData(0),
        src.buffer.numberOfChannels > 1
          ? src.buffer.getChannelData(1)
          : src.buffer.getChannelData(0),
        src.buffer.sampleRate,
        Math.round((region.loopStartSec ?? region.startSec) * src.buffer.sampleRate),
        Math.round((region.loopEndSec ?? region.endSec) * src.buffer.sampleRate),
        region.loopCrossfadeMs
      );
      left = xf.left;
      right = xf.right;
    }

    if (params.reverse) {
      reverseStereoInPlace(left, right);
    }

    // Apply time-stretch / BPM Tempo Sync / sound-design mode (identical math in Live AND Offline bounce!)
    const stretch = (params.warp.timeStretchRatio || 1.0) * tempoStretchScale;
    const pitchRatio = Math.pow(2, (params.pitchSemis + params.fineCents / 100) / 12);

    if (
      params.warp.mode === 'wsola' ||
      (params.warp.mode === 'off' && Math.abs(stretch - 1.0) > 0.008)
    ) {
      const stretched = stretchAudioWsola(left, right, sampleRate, stretch);
      // To shift pitch independently with WSOLA mode: stretch by pitchRatio
      if (params.warp.mode === 'wsola' && Math.abs(pitchRatio - 1.0) > 0.005) {
        const resampled = resampleCubicStereo(stretched.left, stretched.right, pitchRatio);
        const restoredLen = stretchAudioWsola(resampled.left, resampled.right, sampleRate, pitchRatio);
        left = restoredLen.left;
        right = restoredLen.right;
      } else {
        left = stretched.left;
        right = stretched.right;
      }
    } else if (params.warp.mode === 'phasevocoder') {
      const effectiveRatio = stretch * pitchRatio;
      const pv = stretchAudioPhaseVocoder(left, right, effectiveRatio);
      if (Math.abs(pitchRatio - 1.0) > 0.005) {
        const shifted = resampleCubicStereo(pv.left, pv.right, pitchRatio);
        left = shifted.left;
        right = shifted.right;
      } else {
        left = pv.left;
        right = pv.right;
      }
    } else if (params.warp.mode === 'paulstretch' || params.warp.mode === 'granular') {
      const factor =
        params.warp.mode === 'paulstretch'
          ? params.granular.stretchFactor
          : Math.max(1.5, params.granular.stretchFactor * 0.5);
      const winSec = Math.max(0.04, (params.granular.grainSizeMs || 120) / 1000);
      const tex = renderPaulstretchTexture(left, right, sampleRate, factor, winSec);
      left = tex.left;
      right = tex.right;
    }

    if (params.normalize) {
      normalizeStereoInPlace(left, right, -1.0);
    }

    if (params.playMode !== 'loop') {
      applyFadesInPlace(
        left,
        right,
        sampleRate,
        Math.max(2, params.fadeInMs),
        Math.max(2, params.fadeOutMs)
      );
    }

    const processed = arraysToAudioBuffer(ctx, left, right, sampleRate);
    this.processedBufferCache.set(cacheSig, processed);
    return processed;
  }

  public triggerPad(
    padIndex: number,
    velocity01 = 0.9,
    whenSec?: number
  ): VoiceHandle | null {
    const pad = this.pads[padIndex];
    if (!pad || !pad.regionId) return null;
    const region = this.regions.get(pad.regionId);
    if (!region) return null;

    const ctx = this.ensureContext();
    if (!this.kitBus) this.setupKitRouting(ctx);

    const buf = this.getProcessedBufferForPad(ctx, region, pad.params);
    if (!buf || !this.kitBus) return null;

    this.voicePool.prepareForTrigger(pad.params.chokeGroup, whenSec);

    const src = this.sources.get(region.sourceId);
    const varispeedSync =
      pad.params.warp.mode === 'varispeed' && pad.params.warp.syncToBpm && src
        ? (pad.params.warp.targetBpm ?? this.pattern.bpm ?? src.bpm) / Math.max(30, src.bpm)
        : 1.0;

    // If warp is already pre-pitch-shifted (wsola/phasevocoder), playbackRate stays 1.0!
    const usePlaybackRate =
      pad.params.warp.mode === 'off' ||
      pad.params.warp.mode === 'varispeed' ||
      pad.params.warp.mode === 'granular' ||
      pad.params.warp.mode === 'paulstretch';
    const rate =
      (usePlaybackRate
        ? Math.pow(2, (pad.params.pitchSemis + pad.params.fineCents / 100) / 12)
        : 1.0) * varispeedSync;

    const voice = new SampleVoice({
      ctx,
      buffer: buf,
      padIndex,
      params: pad.params,
      velocity01,
      playbackRate: rate,
      loop: pad.params.playMode === 'loop',
      mainDest: this.kitBus,
      reverbDest: this.reverbConvolver,
      delayDest: this.getDelayInput(),
      whenSec,
      onEnded: (id) => this.voicePool.remove(id),
    });

    this.voicePool.add(voice);
    return voice.toHandle();
  }

  public releasePad(padIndex: number, whenSec?: number): void {
    this.voicePool.releasePad(padIndex, whenSec);
  }

  public playChromatic(
    midiNote: number,
    velocity01: number,
    padIndex: number
  ): VoiceHandle | null {
    const pad = this.pads[padIndex];
    if (!pad || !pad.regionId) return null;
    const region = this.regions.get(pad.regionId);
    const src = region ? this.sources.get(region.sourceId) : undefined;
    if (!region || !src) return null;

    const rootMidi = src.rootNote ?? 60;
    const deltaSemis = midiNote - rootMidi;

    const ctx = this.ensureContext();
    if (!this.kitBus) this.setupKitRouting(ctx);
    const buf = this.getProcessedBufferForPad(ctx, region, pad.params);
    if (!buf || !this.kitBus) return null;

    this.voicePool.prepareForTrigger(pad.params.chokeGroup);
    const rate = Math.pow(
      2,
      (pad.params.pitchSemis + deltaSemis + pad.params.fineCents / 100) / 12
    );

    const voice = new SampleVoice({
      ctx,
      buffer: buf,
      padIndex,
      params: { ...pad.params, playMode: 'gate' },
      velocity01,
      playbackRate: rate,
      loop: pad.params.playMode === 'loop',
      mainDest: this.kitBus,
      reverbDest: this.reverbConvolver,
      delayDest: this.getDelayInput(),
      onEnded: (id) => this.voicePool.remove(id),
    });

    this.voicePool.add(voice);
    return voice.toHandle();
  }

  public auditionRegion(
    region: SampleRegion,
    loop: boolean,
    onEnded?: () => void
  ): void {
    this.stopAudition();
    const src = this.sources.get(region.sourceId);
    if (!src) return;
    const ctx = this.ensureContext();
    if (!this.kitBus) this.setupKitRouting(ctx);

    const ch0 = src.buffer.getChannelData(0);
    const ch1 =
      src.buffer.numberOfChannels > 1 ? src.buffer.getChannelData(1) : ch0;

    let left: Float32Array;
    let right: Float32Array;
    if (loop) {
      const xf = buildCrossfadedLoopArrays(
        ch0,
        ch1,
        src.buffer.sampleRate,
        Math.round(region.startSec * src.buffer.sampleRate),
        Math.round(region.endSec * src.buffer.sampleRate),
        region.loopCrossfadeMs
      );
      left = xf.left;
      right = xf.right;
    } else {
      const ext = extractRegionArrays(src.buffer, region.startSec, region.endSec);
      left = ext.left;
      right = ext.right;
      applyFadesInPlace(left, right, src.buffer.sampleRate, 2, 4);
    }

    const buf = arraysToAudioBuffer(ctx, left, right, src.buffer.sampleRate);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop = loop;
    node.connect(this.kitBus!);
    node.onended = () => {
      if (this.auditionSource === node) {
        this.auditionSource = null;
        onEnded?.();
      }
    };
    node.start();
    this.auditionSource = node;
  }

  public stopAudition(): void {
    if (this.auditionSource) {
      try {
        this.auditionSource.onended = null;
        this.auditionSource.stop();
        this.auditionSource.disconnect();
      } catch {
        // ignore
      }
      this.auditionSource = null;
    }
  }

  public stopAll(): void {
    this.stopAudition();
    this.voicePool.stopAll(0.01);
  }

  public startSequencer(): void {
    const ctx = this.ensureContext();
    if (!this.kitBus) this.setupKitRouting(ctx);
    this.scheduler.start(ctx);
  }

  public stopSequencer(): void {
    this.scheduler.stop();
  }

  public setSequencerRecording(rec: boolean): void {
    this.scheduler.setRecording(rec);
  }

  public quantizeLiveHitIfRecording(): number | null {
    if (!this.ctx) return null;
    return this.scheduler.quantizeHitToStep(this.ctx.currentTime);
  }

  public async startMicrophoneRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('La captura de audio/micrófono no está disponible en este navegador.');
    }
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recordChunks = [];
    this.mediaRecorder = new MediaRecorder(this.mediaStream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordChunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  public async stopMicrophoneRecording(): Promise<AudioBuffer> {
    const rec = this.mediaRecorder;
    if (!rec) throw new Error('No hay grabación activa.');
    return new Promise<AudioBuffer>((resolve, reject) => {
      rec.onstop = async () => {
        try {
          const blob = new Blob(this.recordChunks, { type: rec.mimeType || 'audio/webm' });
          this.mediaStream?.getTracks().forEach((t) => t.stop());
          this.mediaStream = null;
          this.mediaRecorder = null;
          const ctx = this.ensureContext();
          const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
          resolve(buf);
        } catch (err) {
          reject(err);
        }
      };
      rec.stop();
    });
  }

  /**
   * Offline renders a single Pad (with ADSR, Filter, Pitch, Warp, Normalize, Reverse, Sends) to 48kHz AudioBuffer.
   */
  public async renderPadOffline(padIndex: number): Promise<AudioBuffer> {
    const pad = this.pads[padIndex];
    if (!pad || !pad.regionId) throw new Error('El Pad seleccionado no tiene audio asignado.');
    const region = this.regions.get(pad.regionId);
    if (!region) throw new Error('Región no encontrada.');

    const sr = 48000;
    const tmpCtx = new OfflineAudioContext(2, 128, sr);
    const procBuf = this.getProcessedBufferForPad(tmpCtx, region, pad.params);
    if (!procBuf) throw new Error('Fuente de audio no disponible.');

    const tailSec =
      pad.params.sends.reverb > 0.05 || pad.params.sends.delay > 0.05 ? 1.5 : 0.1;
    const src = this.sources.get(region.sourceId);
    const varispeedSync =
      pad.params.warp.mode === 'varispeed' && pad.params.warp.syncToBpm && src
        ? (pad.params.warp.targetBpm ?? this.pattern.bpm ?? src.bpm) / Math.max(30, src.bpm)
        : 1.0;

    const useRate =
      pad.params.warp.mode === 'off' ||
      pad.params.warp.mode === 'varispeed' ||
      pad.params.warp.mode === 'granular' ||
      pad.params.warp.mode === 'paulstretch';
    const rate =
      (useRate
        ? Math.pow(2, (pad.params.pitchSemis + pad.params.fineCents / 100) / 12)
        : 1.0) * varispeedSync;

    const totalDur = procBuf.duration / rate + tailSec;
    const offlineCtx = new OfflineAudioContext(2, Math.max(256, Math.ceil(totalDur * sr)), sr);
    const routing = this.setupKitRouting(offlineCtx, offlineCtx.destination);

    const voice = new SampleVoice({
      ctx: offlineCtx,
      buffer: procBuf,
      padIndex,
      params: { ...pad.params, playMode: 'oneshot' },
      velocity01: 1.0,
      playbackRate: rate,
      loop: false,
      mainDest: routing.kitBus,
      reverbDest: routing.reverbInput,
      delayDest: routing.delayInput,
      whenSec: 0,
    });
    void voice;

    const rendered = await offlineCtx.startRendering();
    applyTruePeakLookaheadLimiterOffline(
      rendered.getChannelData(0),
      rendered.getChannelData(1),
      sr,
      { driveDb: 0, ceilingDbTp: -0.5, lookaheadMs: 4, releaseMs: 55 }
    );
    return rendered;
  }

  /**
   * Offline renders a cropped Region directly cleanly (48kHz stereo).
   */
  public renderRegionToBuffer(region: SampleRegion): AudioBuffer {
    const src = this.sources.get(region.sourceId);
    if (!src) throw new Error('Fuente de audio no encontrada.');
    const ctx = this.ensureContext();
    const { left, right, sampleRate } = extractRegionArrays(
      src.buffer,
      region.startSec,
      region.endSec
    );
    removeDcOffsetInPlace(left, right);
    applyFadesInPlace(left, right, sampleRate, 2, 4);
    return arraysToAudioBuffer(ctx, left, right, sampleRate);
  }

  /**
   * Bit-identical Offline Bounce of the Step Sequencer Pattern (1..8 bars, optional perfect loop trim).
   */
  public async renderPatternBounceOffline(
    pattern: SamplerPattern,
    bars = 2,
    seamlessLoop = true
  ): Promise<AudioBuffer> {
    const sr = 48000;
    const { totalDurationSec, events } = SamplerScheduler.buildOfflineSchedule(
      pattern,
      bars
    );
    const hasAudioEvents = events.some((ev) => Boolean(this.pads[ev.padIndex]?.regionId));
    if (!hasAudioEvents) {
      throw new Error(
        'El secuenciador no tiene pasos activos con pads cargados. Activa al menos 1 paso o exporta el Pad / Región.'
      );
    }
    const tailSec = seamlessLoop ? 0 : 1.6;
    const totalFrames = Math.max(256, Math.ceil((totalDurationSec + tailSec) * sr));

    const offlineCtx = new OfflineAudioContext(2, totalFrames, sr);
    const routing = this.setupKitRouting(offlineCtx, offlineCtx.destination);
    const activeByChoke = new Map<number, SampleVoice[]>();

    for (const ev of events) {
      const pad = this.pads[ev.padIndex];
      if (!pad || !pad.regionId) continue;
      const region = this.regions.get(pad.regionId);
      if (!region) continue;
      const buf = this.getProcessedBufferForPad(offlineCtx, region, pad.params, pattern);
      if (!buf) continue;

      if (pad.params.chokeGroup !== null) {
        const prevList = activeByChoke.get(pad.params.chokeGroup) ?? [];
        for (const prevV of prevList) {
          prevV.forceStopFade(0.008, ev.timeSec);
        }
        activeByChoke.set(pad.params.chokeGroup, []);
      }

      const src = this.sources.get(region.sourceId);
      const varispeedSync =
        pad.params.warp.mode === 'varispeed' && pad.params.warp.syncToBpm && src
          ? (pad.params.warp.targetBpm ?? pattern.bpm ?? src.bpm) / Math.max(30, src.bpm)
          : 1.0;

      const useRate =
        pad.params.warp.mode === 'off' ||
        pad.params.warp.mode === 'varispeed' ||
        pad.params.warp.mode === 'granular' ||
        pad.params.warp.mode === 'paulstretch';
      const rate =
        (useRate
          ? Math.pow(2, (pad.params.pitchSemis + pad.params.fineCents / 100) / 12)
          : 1.0) * varispeedSync;

      const voice = new SampleVoice({
        ctx: offlineCtx,
        buffer: buf,
        padIndex: ev.padIndex,
        params: pad.params,
        velocity01: ev.velocity,
        playbackRate: rate,
        loop: false,
        mainDest: routing.kitBus,
        reverbDest: routing.reverbInput,
        delayDest: routing.delayInput,
        whenSec: ev.timeSec,
      });

      if (pad.params.chokeGroup !== null) {
        const list = activeByChoke.get(pad.params.chokeGroup) ?? [];
        list.push(voice);
        activeByChoke.set(pad.params.chokeGroup, list);
      }
    }

    const rendered = await offlineCtx.startRendering();
    applyTruePeakLookaheadLimiterOffline(
      rendered.getChannelData(0),
      rendered.getChannelData(1),
      sr,
      { driveDb: 0, ceilingDbTp: -1.0, lookaheadMs: 5, releaseMs: 65 }
    );
    return rendered;
  }

  public dispose(): void {
    this.scheduler.stop();
    this.stopAll();
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
    }
    this.ctx = null;
  }
}
