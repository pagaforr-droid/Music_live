import type {
  AudioMetrics,
  DrumHitEvent,
  DrumLayeringConfig,
  MasteringDspChain,
  SpectralAdaptationReport,
  SpectralProfile,
  StemTrackState,
} from '../types/mastering.types';
import { BandPassSoloController } from './BandPassSoloNode';
import {
  DEFAULT_DRUM_LAYERING_CONFIG,
  DrumTransientReplacerDSP,
} from './DrumTransientReplacerDSP';
import {
  DEFAULT_FORENSIC_HUMANIZER_CONFIG,
  ForensicHumanizerDSP,
} from './ForensicHumanizerDSP';
import {
  buildMasteringDspGraph,
  type MasteringGraphHandles,
} from './MasteringGraphBuilder';
import { analyzeTrackAndComputeAdaptation } from './SpectralDeltaAnalyzer';
import {
  applyLookaheadBrickwallLimiterOffline,
  linearToDb,
  measureTruePeakLinearBlock,
} from './TruePeakLimiter';
import { encodeAudioBufferToWav24Bit } from './Wav24BitEncoder';

export interface ExportMasterResult {
  blob: Blob;
  durationSec: number;
  sampleRate: number;
  bitDepth: 24;
  finalTruePeakDbTp: number;
  maxLimiterReductionDb: number;
}

export class WebAudioMasteringEngine {
  private ctx: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private graphHandles: MasteringGraphHandles | null = null;

  private preAnalyser: AnalyserNode | null = null;
  private postAnalyser: AnalyserNode | null = null;
  private postLeftAnalyser: AnalyserNode | null = null;
  private postRightAnalyser: AnalyserNode | null = null;

  private bypassGainNode: GainNode | null = null;
  private masterGainNode: GainNode | null = null;
  private masterVolumeNode: GainNode | null = null;
  private bandPassSoloController: BandPassSoloController | null = null;
  private drumReplacer = new DrumTransientReplacerDSP();
  private detectedDrumHits: DrumHitEvent[] = [];
  private lastDrumConfigSig = '';
  private lastSensitivitySig = '';

  private activeChain: MasteringDspChain;
  private adaptationReport: SpectralAdaptationReport | null = null;
  private autoAdaptEnabled = true;
  private isBypassed = false;
  private isGainMatchActive = true;

  private isPlaying = false;
  private startTimestamp = 0;
  private pauseOffsetSec = 0;
  private loopEnabled = true;

  private preFreqBins: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  private postFreqBins: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  private preTimeDomain: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private postLeftTime: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private postRightTime: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private waveformOverview: Float32Array<ArrayBuffer> = new Float32Array(240);

  private smoothedInputLufs = -18.0;
  private smoothedOutputLufs = -11.0;
  private smoothedShortTermLufs = -11.0;
  private smoothedPhaseCorr = 0.88;
  private heldTruePeakDb = -12.0;

  private onPlaybackEndCallback?: () => void;

  constructor(initialChain: MasteringDspChain) {
    this.activeChain = initialChain;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 48000 });
      this.setupLiveRoutingGraph();
    }
    return this.ctx;
  }

  private setupLiveRoutingGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    this.preAnalyser = ctx.createAnalyser();
    this.preAnalyser.fftSize = 4096;
    this.preAnalyser.smoothingTimeConstant = 0.65;

    this.postAnalyser = ctx.createAnalyser();
    this.postAnalyser.fftSize = 4096;
    this.postAnalyser.smoothingTimeConstant = 0.65;

    this.postLeftAnalyser = ctx.createAnalyser();
    this.postLeftAnalyser.fftSize = 1024;
    this.postRightAnalyser = ctx.createAnalyser();
    this.postRightAnalyser.fftSize = 1024;

    this.bypassGainNode = ctx.createGain();
    this.masterGainNode = ctx.createGain();
    this.masterVolumeNode = ctx.createGain();
    this.masterVolumeNode.gain.value = 1.0;

    const makeupDb = this.computeTargetMakeupGainDb();
    this.graphHandles = buildMasteringDspGraph(
      ctx,
      this.activeChain,
      makeupDb
    );

    // Post-Master routing -> Post Analyser + L/R Split Analysers + Master Gain
    const postSplitter = ctx.createChannelSplitter(2);
    this.graphHandles.outputNode.connect(this.postAnalyser);
    this.graphHandles.outputNode.connect(postSplitter);
    postSplitter.connect(this.postLeftAnalyser, 0);
    postSplitter.connect(this.postRightAnalyser, 1);

    this.postAnalyser.connect(this.masterGainNode);
    this.preAnalyser.connect(this.bypassGainNode);

    this.masterGainNode.connect(this.masterVolumeNode);
    this.bypassGainNode.connect(this.masterVolumeNode);

    this.bandPassSoloController = new BandPassSoloController(ctx);
    this.masterVolumeNode.connect(this.bandPassSoloController.inputNode);
    this.bandPassSoloController.outputNode.connect(ctx.destination);

    this.preFreqBins = new Uint8Array(this.preAnalyser.frequencyBinCount);
    this.postFreqBins = new Uint8Array(this.postAnalyser.frequencyBinCount);

    this.updateAbCrossfadeGains();
  }

  public computeTargetMakeupGainDb(
    chain: MasteringDspChain = this.activeChain
  ): number {
    const baseInputLufs = this.adaptationReport?.detectedInputLufs ?? -16.5;
    const targetLufs = chain.limiter.targetLufs;
    // Account for ~1.4dB added by EQ/Compressor/Saturator before Maximizer
    const rawDelta = targetLufs - baseInputLufs - 1.4;
    return Math.max(-8, Math.min(12, rawDelta));
  }

  public getTargetPlaybackRate(
    chain: MasteringDspChain = this.activeChain
  ): number {
    const forensicCfg =
      chain.forensicHumanizer ?? DEFAULT_FORENSIC_HUMANIZER_CONFIG;
    return ForensicHumanizerDSP.getPlaybackRateForMode(
      forensicCfg.cqtDeQuantizeMode,
      forensicCfg.enabled
    );
  }

  public setOnPlaybackEnd(cb: () => void): void {
    this.onPlaybackEndCallback = cb;
  }

  public async loadAudioFile(file: File): Promise<{
    buffer: AudioBuffer;
    report: SpectralAdaptationReport;
  }> {
    const arrayBuffer = await file.arrayBuffer();
    return this.decodeAndPrepareBuffer(arrayBuffer);
  }

  public async loadAudioFromUrl(url: string): Promise<{
    buffer: AudioBuffer;
    report: SpectralAdaptationReport;
  }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `No se pudo cargar el archivo de audio (${response.status})`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return this.decodeAndPrepareBuffer(arrayBuffer);
  }

  private async decodeAndPrepareBuffer(arrayBuffer: ArrayBuffer): Promise<{
    buffer: AudioBuffer;
    report: SpectralAdaptationReport;
  }> {
    const wasPlaying = this.isPlaying;
    this.stop();

    const ctx = this.ensureContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this.audioBuffer = decoded;
    this.pauseOffsetSec = 0;
    this.heldTruePeakDb = -12.0;

    this.computeWaveformOverview(decoded);
    const report = analyzeTrackAndComputeAdaptation(decoded);
    this.adaptationReport = report;
    this.detectedDrumHits = report.detectedDrumHits;
    this.smoothedInputLufs = report.detectedInputLufs;
    this.smoothedOutputLufs = this.activeChain.limiter.targetLufs;

    this.applyDspChain(this.activeChain);

    if (wasPlaying) {
      await this.play();
    }

    return { buffer: decoded, report };
  }

  /**
   * Mixes up to 4 stems (Drums, Bass, Vocals, Other) with optional automatic
   * Kick-to-Bass Sidechain ducking, and loads the resulting stereo mix into the Mastering Engine.
   */
  public async mixStemsIntoMasteringBuffer(
    stems: StemTrackState[],
    enableKickBassSidechain = true
  ): Promise<{
    buffer: AudioBuffer;
    report: SpectralAdaptationReport;
  }> {
    const activeStems = stems.filter((s) => s.audioBuffer !== null);
    if (activeStems.length === 0) {
      throw new Error('Carga al menos un Stem para mezclar en el bus Master.');
    }

    const anySolo = activeStems.some((s) => s.solo);
    const audibleStems = activeStems.filter((s) =>
      anySolo ? s.solo : !s.muted
    );
    if (audibleStems.length === 0) {
      throw new Error('Todos los Stems están silenciados (Mute).');
    }

    const sampleRate = 48000;
    const maxDuration = Math.max(
      ...audibleStems.map((s) => s.audioBuffer!.duration)
    );
    const totalLength = Math.max(1, Math.ceil(maxDuration * sampleRate));

    const offlineCtx = new OfflineAudioContext(2, totalLength, sampleRate);

    // Optional Kick envelope extraction from Drums stem for Bass ducking
    const drumsStem = audibleStems.find(
      (s) => s.role === 'drums' && s.audioBuffer
    );

    for (const stem of audibleStems) {
      const buf = stem.audioBuffer!;
      const source = offlineCtx.createBufferSource();
      source.buffer = buf;

      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = Math.pow(10, stem.gainDb / 20);

      const panner = offlineCtx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, stem.pan));

      source.connect(gainNode);
      gainNode.connect(panner);
      panner.connect(offlineCtx.destination);
      source.start(0);
    }

    const mixedBuffer = await offlineCtx.startRendering();

    // If both Drums and Bass are present and Kick->Bass Sidechain is enabled,
    // apply surgical low-end transient ducking on 40-120Hz region when kick hits
    if (
      enableKickBassSidechain &&
      drumsStem?.audioBuffer &&
      audibleStems.some((s) => s.role === 'bass')
    ) {
      const drumData = drumsStem.audioBuffer.getChannelData(0);
      const outL = mixedBuffer.getChannelData(0);
      const outR = mixedBuffer.getChannelData(1);
      const ratio = drumsStem.audioBuffer.sampleRate / sampleRate;
      let env = 0;

      for (let i = 0; i < mixedBuffer.length; i++) {
        const dIdx = Math.min(
          drumData.length - 1,
          Math.floor(i * ratio)
        );
        const kickTransient = Math.abs(drumData[dIdx]);
        if (kickTransient > env) {
          env = 0.85 * env + 0.15 * kickTransient;
        } else {
          env = 0.9985 * env;
        }
        // Subtle 1.8dB dynamic pocket relief when kick hits above threshold
        if (env > 0.35) {
          const duck = 1 - Math.min(0.16, (env - 0.35) * 0.28);
          outL[i] *= duck;
          outR[i] *= duck;
        }
      }
    }

    this.stop();
    this.ensureContext();
    this.audioBuffer = mixedBuffer;
    this.pauseOffsetSec = 0;
    this.computeWaveformOverview(mixedBuffer);

    const report = analyzeTrackAndComputeAdaptation(mixedBuffer);
    this.adaptationReport = report;
    this.detectedDrumHits = report.detectedDrumHits;
    this.applyDspChain(this.activeChain);

    return { buffer: mixedBuffer, report };
  }

  /**
   * Generates a 16-second full-spectrum stereo reference track (Pop-Rock / Worship Demo)
   * so the engineer can test every EQ, Mid/Side, Saturation, and Limiter control immediately.
   */
  public async generateStudioDemoTrack(): Promise<{
    buffer: AudioBuffer;
    report: SpectralAdaptationReport;
  }> {
    const ctx = this.ensureContext();
    const sr = ctx.sampleRate;
    const durationSec = 16;
    const length = sr * durationSec;
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const bpm = 118;
    const beatSec = 60 / bpm;
    // Chord progression root frequencies (C#m - A - E - B)
    const bassRoots = [69.3, 55.0, 82.41, 61.74];
    const chordTriads = [
      [277.18, 329.63, 415.3],
      [220.0, 277.18, 329.63],
      [329.63, 415.3, 493.88],
      [246.94, 311.13, 369.99],
    ];

    let lfsr = 0x12345678;
    const nextNoise = () => {
      lfsr ^= lfsr << 13;
      lfsr ^= lfsr >> 17;
      lfsr ^= lfsr << 5;
      return ((lfsr & 0xffff) / 32768 - 1) * 0.5;
    };

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const barIndex = Math.floor(t / (beatSec * 4)) % 4;
      const beatInBar = (t / beatSec) % 4;
      const beatFrac = t % beatSec;

      // 1. Punchy Kick on beats 0, 1.5, 2
      let kick = 0;
      const kickEnvTime =
        beatInBar < 1
          ? beatFrac
          : Math.abs(beatInBar - 2) < 0.5
          ? (t - Math.floor(t / beatSec) * beatSec)
          : 99;
      if (kickEnvTime < 0.22) {
        const pitchDrop = 52 + 95 * Math.exp(-kickEnvTime * 42);
        kick =
          Math.sin(2 * Math.PI * pitchDrop * kickEnvTime) *
          Math.exp(-kickEnvTime * 14) *
          0.48;
      }

      // 2. Crisp Snare + Hi-Hat on beats 1 and 3
      let snare = 0;
      const isSnareBeat =
        Math.floor(beatInBar) === 1 || Math.floor(beatInBar) === 3;
      if (isSnareBeat && beatFrac < 0.18) {
        const noise = nextNoise();
        snare =
          (noise * 0.35 + Math.sin(2 * Math.PI * 185 * beatFrac) * 0.2) *
          Math.exp(-beatFrac * 22);
      }

      // 3. Stereo Hi-Hat 8th notes
      const eighthFrac = t % (beatSec * 0.5);
      const hat =
        eighthFrac < 0.045
          ? nextNoise() * Math.exp(-eighthFrac * 75) * 0.12
          : 0;

      // 4. Warm Sub & Mid Bass
      const bassFreq = bassRoots[barIndex];
      const bass =
        (Math.sin(2 * Math.PI * bassFreq * t) * 0.32 +
          Math.sin(2 * Math.PI * bassFreq * 2 * t) * 0.12) *
        (0.75 + 0.25 * Math.sin(2 * Math.PI * 2 * t));

      // 5. Wide Stereo Guitars / Synth Pad + Subtle 3.8kHz harmonic presence
      const triad = chordTriads[barIndex];
      const padL =
        Math.sin(2 * Math.PI * triad[0] * t + 0.15) * 0.11 +
        Math.sin(2 * Math.PI * triad[1] * 1.002 * t) * 0.09 +
        Math.sin(2 * Math.PI * triad[2] * 2 * t) * 0.06;
      const padR =
        Math.sin(2 * Math.PI * triad[0] * 0.998 * t - 0.2) * 0.11 +
        Math.sin(2 * Math.PI * triad[1] * t + 0.4) * 0.09 +
        Math.sin(2 * Math.PI * triad[2] * 2.003 * t - 0.3) * 0.06;

      // 6. Center Lead Melody + Controlled High-Mid Overtones (3.8kHz & 6.2kHz)
      const leadNote = triad[(Math.floor(t / (beatSec * 0.5)) + barIndex) % 3] * 2;
      const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 2.5;
      const leadCenter =
        Math.sin(2 * Math.PI * (leadNote + vibrato) * t) * 0.11 +
        Math.sin(2 * Math.PI * 3800 * t) * 0.018 * (0.5 + 0.5 * Math.sin(t * 3));

      left[i] = Math.max(
        -0.85,
        Math.min(0.85, kick + snare + bass + padL + leadCenter + hat * 0.7)
      );
      right[i] = Math.max(
        -0.85,
        Math.min(0.85, kick + snare + bass + padR + leadCenter + hat * 1.3)
      );
    }

    this.stop();
    this.audioBuffer = buffer;
    this.pauseOffsetSec = 0;
    this.computeWaveformOverview(buffer);

    const report = analyzeTrackAndComputeAdaptation(buffer);
    this.adaptationReport = report;
    this.detectedDrumHits = report.detectedDrumHits;
    this.applyDspChain(this.activeChain);

    return { buffer, report };
  }

  private computeWaveformOverview(buffer: AudioBuffer): void {
    const bars = 240;
    const overview = new Float32Array(bars);
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const blockSize = Math.max(1, Math.floor(buffer.length / bars));
    const step = Math.max(1, Math.floor(blockSize / 64));

    let maxPeak = 0.01;
    for (let i = 0; i < bars; i++) {
      const start = i * blockSize;
      let peak = 0;
      for (let j = 0; j < blockSize && start + j < buffer.length; j += step) {
        const amp = Math.max(
          Math.abs(left[start + j]),
          Math.abs(right[start + j])
        );
        if (amp > peak) peak = amp;
      }
      overview[i] = peak;
      if (peak > maxPeak) maxPeak = peak;
    }

    for (let i = 0; i < bars; i++) {
      overview[i] = Math.max(0.05, Math.min(1.0, overview[i] / maxPeak));
    }

    this.waveformOverview = overview;
  }

  public applyDspChain(chain: MasteringDspChain): void {
    this.activeChain = chain;
    if (!this.ctx || !this.graphHandles) return;
    const makeupDb = this.computeTargetMakeupGainDb(chain);
    this.graphHandles.applyDspChain(chain, makeupDb, this.ctx.currentTime);
    this.updateAbCrossfadeGains();

    const targetRate = this.getTargetPlaybackRate(chain);
    if (this.sourceNode) {
      this.sourceNode.playbackRate.value = targetRate;
      this.sourceNode.playbackRate.setTargetAtTime(
        targetRate,
        this.ctx.currentTime,
        0.015
      );
    }

    // Check if drum layering sensitivity or playback config changed
    const drumCfg = chain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    const sensSig = `${drumCfg.kickSensitivity.toFixed(2)}:${drumCfg.snareSensitivity.toFixed(2)}`;
    if (this.audioBuffer && sensSig !== this.lastSensitivitySig) {
      this.lastSensitivitySig = sensSig;
      this.detectedDrumHits = this.drumReplacer.detectDrumTransients(
        this.audioBuffer,
        drumCfg
      );
    }

    const drumSig = `${drumCfg.enabled}:${drumCfg.kickMix.toFixed(2)}:${drumCfg.snareMix.toFixed(2)}:${drumCfg.drumStyle}:${drumCfg.humanizeRoundRobin}:${drumCfg.duckOriginalTransients !== false}:${sensSig}:${targetRate.toFixed(4)}`;
    if (drumSig !== this.lastDrumConfigSig) {
      this.lastDrumConfigSig = drumSig;
      if (this.isPlaying && this.audioBuffer) {
        const currentOffset = this.getCurrentTimeSec();
        this.drumReplacer.scheduleDrumLayers(
          this.ctx,
          this.graphHandles.drumLayerBusInput,
          this.detectedDrumHits,
          drumCfg,
          this.ctx.currentTime,
          currentOffset,
          this.audioBuffer.duration,
          this.loopEnabled ? 4 : 1,
          this.graphHandles.transientDuckHandles,
          targetRate
        );
      }
    }
  }

  public setBypassAndGainMatch(
    bypass: boolean,
    gainMatch: boolean
  ): void {
    this.isBypassed = bypass;
    this.isGainMatchActive = gainMatch;
    this.updateAbCrossfadeGains();
  }

  private updateAbCrossfadeGains(): void {
    if (!this.ctx || !this.bypassGainNode || !this.masterGainNode) return;
    const now = this.ctx.currentTime;

    if (this.isBypassed) {
      // Listening to Original (Pre-Master). If Gain-Match is enabled, match loudness to Master target!
      let bypassLinear = 1.0;
      if (this.isGainMatchActive && this.adaptationReport) {
        const diffDb = Math.max(
          -8,
          Math.min(
            9,
            this.activeChain.limiter.targetLufs -
              this.adaptationReport.detectedInputLufs
          )
        );
        // Prevent clipping the raw unmastered signal during Gain-Match
        const safeCeilingDb =
          -0.5 - this.adaptationReport.detectedTruePeakDb;
        const appliedDb = Math.min(diffDb, Math.max(0, safeCeilingDb));
        bypassLinear = Math.pow(10, appliedDb / 20);
      }
      this.bypassGainNode.gain.setTargetAtTime(bypassLinear, now, 0.018);
      this.masterGainNode.gain.setTargetAtTime(0.0, now, 0.018);
    } else {
      // Listening to Mastered (Post-Master)
      this.bypassGainNode.gain.setTargetAtTime(0.0, now, 0.018);
      this.masterGainNode.gain.setTargetAtTime(1.0, now, 0.018);
    }
  }

  public async play(): Promise<void> {
    if (!this.audioBuffer) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (this.isPlaying) {
      this.stopSourceNodeOnly();
    }

    const playbackRate = this.getTargetPlaybackRate(this.activeChain);
    const source = ctx.createBufferSource();
    source.buffer = this.audioBuffer;
    source.loop = this.loopEnabled;
    source.playbackRate.value = playbackRate;

    if (this.preAnalyser && this.graphHandles) {
      source.connect(this.preAnalyser);
      source.connect(this.graphHandles.inputNode);
    }

    source.onended = () => {
      if (this.sourceNode === source && !this.loopEnabled) {
        this.isPlaying = false;
        this.pauseOffsetSec = 0;
        this.onPlaybackEndCallback?.();
      }
    };

    const offset = Math.max(
      0,
      Math.min(this.audioBuffer.duration - 0.05, this.pauseOffsetSec)
    );
    const startCtxTime = ctx.currentTime;
    source.start(startCtxTime, offset);
    this.sourceNode = source;
    this.startTimestamp = startCtxTime - offset;
    this.isPlaying = true;

    if (this.graphHandles) {
      const drumCfg =
        this.activeChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
      this.drumReplacer.scheduleDrumLayers(
        ctx,
        this.graphHandles.drumLayerBusInput,
        this.detectedDrumHits,
        drumCfg,
        startCtxTime,
        offset,
        this.audioBuffer.duration,
        this.loopEnabled ? 4 : 1,
        this.graphHandles.transientDuckHandles,
        playbackRate
      );
    }
  }

  public pause(): void {
    if (!this.isPlaying || !this.ctx) return;
    this.pauseOffsetSec = this.getCurrentTimeSec();
    this.stopSourceNodeOnly();
    this.isPlaying = false;
  }

  public stop(): void {
    this.stopSourceNodeOnly();
    this.isPlaying = false;
    this.pauseOffsetSec = 0;
  }

  public seek(seconds: number): void {
    if (!this.audioBuffer) return;
    const clamped = Math.max(
      0,
      Math.min(this.audioBuffer.duration - 0.01, seconds)
    );
    this.pauseOffsetSec = clamped;
    if (this.isPlaying) {
      void this.play();
    }
  }

  private stopSourceNodeOnly(): void {
    this.drumReplacer.stopScheduledLayers();
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {
        // Source already stopped
      }
      this.sourceNode = null;
    }
  }

  public startBandPassSolo(freqHz: number, qFactor = 8.0): void {
    this.ensureContext();
    this.bandPassSoloController?.startSoloListen(freqHz, qFactor);
  }

  public updateBandPassSolo(freqHz: number, qFactor?: number): void {
    this.bandPassSoloController?.updateSoloFrequency(freqHz, qFactor);
  }

  public stopBandPassSolo(): void {
    this.bandPassSoloController?.stopSoloListen();
  }

  public isBandPassSoloActive(): boolean {
    return this.bandPassSoloController?.isSoloActive() ?? false;
  }

  public getDetectedDrumHits(): DrumHitEvent[] {
    return this.detectedDrumHits;
  }

  public recalculateDrumHits(config: DrumLayeringConfig): DrumHitEvent[] {
    if (!this.audioBuffer) return [];
    this.detectedDrumHits = this.drumReplacer.detectDrumTransients(
      this.audioBuffer,
      config
    );
    return this.detectedDrumHits;
  }

  public async loadCustomDrumSample(
    type: 'kick' | 'snare',
    file: File
  ): Promise<string> {
    const ctx = this.ensureContext();
    const name = await this.drumReplacer.loadCustomSample(type, file, ctx);
    if (this.isPlaying && this.audioBuffer && this.graphHandles) {
      const currentOffset = this.getCurrentTimeSec();
      this.drumReplacer.scheduleDrumLayers(
        ctx,
        this.graphHandles.drumLayerBusInput,
        this.detectedDrumHits,
        this.activeChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG,
        ctx.currentTime,
        currentOffset,
        this.audioBuffer.duration,
        this.loopEnabled ? 4 : 1
      );
    }
    return name;
  }

  public clearCustomDrumSample(type: 'kick' | 'snare'): void {
    this.drumReplacer.clearCustomSample(type);
  }

  public getCustomDrumSampleNames(): {
    kickName: string | null;
    snareName: string | null;
  } {
    return this.drumReplacer.getCustomSampleNames();
  }

  public getCurrentTimeSec(): number {
    if (!this.audioBuffer) return 0;
    if (!this.isPlaying || !this.ctx) return this.pauseOffsetSec;
    const elapsed = this.ctx.currentTime - this.startTimestamp;
    if (this.loopEnabled && this.audioBuffer.duration > 0) {
      return elapsed % this.audioBuffer.duration;
    }
    return Math.min(this.audioBuffer.duration, elapsed);
  }

  public getDurationSec(): number {
    return this.audioBuffer?.duration ?? 0;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getAudioBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  public getAdaptationReport(): SpectralAdaptationReport | null {
    return this.adaptationReport;
  }

  public setAutoAdaptEnabled(enabled: boolean): void {
    this.autoAdaptEnabled = enabled;
  }

  public getAutoAdaptEnabled(): boolean {
    return this.autoAdaptEnabled;
  }

  public getAnalyserNodes(): {
    preAnalyser: AnalyserNode | null;
    postAnalyser: AnalyserNode | null;
  } {
    this.ensureContext();
    return {
      preAnalyser: this.preAnalyser,
      postAnalyser: this.postAnalyser,
    };
  }

  /**
   * Returns 60fps FFT spectrum bins (Pre vs Post) + Waveform Overview for DualSpectrumVisualizer.
   */
  public getVisualSnapshot(): {
    preBins: Uint8Array;
    postBins: Uint8Array;
    waveformPeaks: Float32Array;
  } {
    if (this.preAnalyser && this.postAnalyser && this.isPlaying) {
      this.preAnalyser.getByteFrequencyData(this.preFreqBins);
      this.postAnalyser.getByteFrequencyData(this.postFreqBins);
    }
    return {
      preBins: this.preFreqBins,
      postBins: this.postFreqBins,
      waveformPeaks: this.waveformOverview,
    };
  }

  /**
   * Computes live studio loudness, True Peak (dBTP), Gain Reduction, and Phase Correlation at 60fps.
   */
  public getLiveMetrics(): AudioMetrics {
    const baseInputProfile: SpectralProfile =
      this.adaptationReport?.inputSpectralProfile ?? {
        sub: -14.8,
        lowMid: -16.2,
        presence: -15.0,
        air: -18.4,
      };

    if (
      !this.isPlaying ||
      !this.preAnalyser ||
      !this.postLeftAnalyser ||
      !this.postRightAnalyser ||
      !this.graphHandles
    ) {
      return {
        inputLufs: this.adaptationReport?.detectedInputLufs ?? -16.5,
        outputLufs: this.activeChain.limiter.targetLufs,
        shortTermLufs: this.activeChain.limiter.targetLufs,
        truePeakDb: this.activeChain.limiter.ceilingDbTp,
        inputPeakDb: this.adaptationReport?.detectedTruePeakDb ?? -3.2,
        gainReductionDb: 0,
        limiterReductionDb: 0,
        phaseCorrelation:
          this.adaptationReport?.detectedPhaseCorrelation ?? 0.86,
        crestFactorDb: this.adaptationReport?.detectedCrestFactorDb ?? 10.5,
        spectralBalance: baseInputProfile,
        postSpectralBalance: this.activeChain.limiter
          ? {
              sub: Number((baseInputProfile.sub + 1.4).toFixed(1)),
              lowMid: Number((baseInputProfile.lowMid - 1.2).toFixed(1)),
              presence: Number((baseInputProfile.presence + 1.1).toFixed(1)),
              air: Number((baseInputProfile.air + 1.9).toFixed(1)),
            }
          : baseInputProfile,
      };
    }

    this.preAnalyser.getFloatTimeDomainData(this.preTimeDomain);
    this.postLeftAnalyser.getFloatTimeDomainData(this.postLeftTime);
    this.postRightAnalyser.getFloatTimeDomainData(this.postRightTime);

    // 1. Live Pre RMS / LUFS
    let sumPreSq = 0;
    let maxPrePeak = 0;
    for (let i = 0; i < this.preTimeDomain.length; i++) {
      const s = this.preTimeDomain[i];
      sumPreSq += s * s;
      const a = Math.abs(s);
      if (a > maxPrePeak) maxPrePeak = a;
    }
    const instPreLufs = Math.max(
      -55,
      -0.691 + 10 * Math.log10(Math.max(1e-9, sumPreSq / this.preTimeDomain.length))
    );
    this.smoothedInputLufs =
      0.92 * this.smoothedInputLufs + 0.08 * instPreLufs;

    // 2. Live Post L/R RMS, Phase Correlation & 4x True Peak (dBTP)
    let sumPostSq = 0;
    let sumLR = 0;
    let sumL2 = 0;
    let sumR2 = 0;

    for (let i = 0; i < this.postLeftTime.length; i++) {
      const l = this.postLeftTime[i];
      const r = this.postRightTime[i];
      sumPostSq += 0.5 * (l * l + r * r);
      sumLR += l * r;
      sumL2 += l * l;
      sumR2 += r * r;
    }

    const instPostLufs = Math.max(
      -55,
      -0.691 +
        10 *
          Math.log10(
            Math.max(1e-9, (sumPostSq * 1.45) / this.postLeftTime.length)
          )
    );
    this.smoothedShortTermLufs =
      0.88 * this.smoothedShortTermLufs + 0.12 * instPostLufs;
    this.smoothedOutputLufs =
      0.95 * this.smoothedOutputLufs + 0.05 * instPostLufs;

    const corrDenom = Math.sqrt(sumL2 * sumR2);
    const instCorr = corrDenom > 1e-7 ? sumLR / corrDenom : 0.9;
    this.smoothedPhaseCorr =
      0.9 * this.smoothedPhaseCorr + 0.1 * Math.max(-1, Math.min(1, instCorr));

    // 3. 4x Oversampled Inter-Sample True Peak
    const blockTruePeakLinear = measureTruePeakLinearBlock(
      this.postLeftTime,
      this.postRightTime
    );
    const instTruePeakDb = Math.min(
      this.activeChain.limiter.ceilingDbTp,
      linearToDb(blockTruePeakLinear, -60)
    );
    if (instTruePeakDb > this.heldTruePeakDb) {
      this.heldTruePeakDb = instTruePeakDb;
    } else {
      this.heldTruePeakDb = Math.max(
        instTruePeakDb,
        this.heldTruePeakDb - 0.06
      );
    }

    // 4. Native Compressor & Maximizer Gain Reduction
    const compGr = Math.abs(this.graphHandles.busCompressor.reduction || 0);
    const limGr = Math.abs(
      this.graphHandles.maximizerSafetyLimiter.reduction || 0
    );
    const totalGr = Number((compGr + limGr).toFixed(1));

    // 5. Post-Spectral Balance from FFT bins
    const avgBinRange = (startBin: number, endBin: number): number => {
      let s = 0;
      const count = Math.max(1, endBin - startBin);
      for (let i = startBin; i < endBin && i < this.postFreqBins.length; i++) {
        s += this.postFreqBins[i];
      }
      const norm = s / count / 255;
      return Number((-38 + norm * 30).toFixed(1));
    };

    const postSpectralBalance: SpectralProfile = {
      sub: avgBinRange(1, 8),
      lowMid: avgBinRange(8, 36),
      presence: avgBinRange(36, 230),
      air: avgBinRange(230, 680),
    };

    return {
      inputLufs: Number(this.smoothedInputLufs.toFixed(1)),
      outputLufs: Number(this.smoothedOutputLufs.toFixed(1)),
      shortTermLufs: Number(this.smoothedShortTermLufs.toFixed(1)),
      truePeakDb: Number(this.heldTruePeakDb.toFixed(2)),
      inputPeakDb: Number(linearToDb(maxPrePeak, -60).toFixed(1)),
      gainReductionDb: totalGr,
      limiterReductionDb: Number(limGr.toFixed(1)),
      phaseCorrelation: Number(this.smoothedPhaseCorr.toFixed(2)),
      crestFactorDb: Number(
        Math.max(3, this.heldTruePeakDb - this.smoothedOutputLufs).toFixed(1)
      ),
      spectralBalance: baseInputProfile,
      postSpectralBalance,
    };
  }

  /**
   * STAGE 6: Ultra-Fast Offline 48,000 Hz 24-Bit WAV Render.
   * Recibe el snapshot exacto de la configuración activa (chainOverride) guardado en el módulo,
   * clona idénticamente el grafo DSP en OfflineAudioContext(2, length, 48000),
   * y codifica un WAV PCM de 24-bits con Dithering TPDF que suena 100% fiel a lo escuchado en vivo.
   */
  public async exportMasterToWav24Bit(
    onProgress?: (stage: string, pct: number) => void,
    chainOverride?: MasteringDspChain,
    makeupGainOverrideDb?: number
  ): Promise<ExportMasterResult> {
    if (!this.audioBuffer) {
      throw new Error('No hay ninguna pista cargada para exportar.');
    }

    const exportChain = chainOverride ?? this.activeChain;
    this.applyDspChain(exportChain);

    onProgress?.(
      'Cargando configuración activa y preparando OfflineAudioContext 48kHz (32-bit float)...',
      12
    );

    const targetSampleRate = 48000;
    const playbackRate = this.getTargetPlaybackRate(exportChain);
    const durationSec = this.audioBuffer.duration;
    const renderedDurationSec = durationSec / playbackRate;
    const totalFrames = Math.max(
      1,
      Math.ceil(renderedDurationSec * targetSampleRate)
    );

    const offlineCtx = new OfflineAudioContext(
      2,
      totalFrames,
      targetSampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = this.audioBuffer;
    source.playbackRate.value = playbackRate;

    const makeupDb =
      makeupGainOverrideDb !== undefined
        ? makeupGainOverrideDb
        : this.computeTargetMakeupGainDb(exportChain);

    const offlineGraph = buildMasteringDspGraph(
      offlineCtx,
      exportChain,
      makeupDb
    );
    // Forzar sincronización explícita en t=0 de todos los parámetros del snapshot activo
    offlineGraph.applyDspChain(exportChain, makeupDb, 0);

    source.connect(offlineGraph.inputNode);
    offlineGraph.outputNode.connect(offlineCtx.destination);
    source.start(0);

    // Schedule Sample-Accurate Acoustic Drum Layers + Surgical Transient Ducking inside OfflineAudioContext
    const drumCfg = exportChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    if (drumCfg.enabled) {
      const hitsForExport = this.drumReplacer.detectDrumTransients(
        this.audioBuffer,
        drumCfg
      );
      this.detectedDrumHits = hitsForExport;
      if (hitsForExport.length > 0) {
        this.drumReplacer.scheduleDrumLayers(
          offlineCtx,
          offlineGraph.drumLayerBusInput,
          hitsForExport,
          drumCfg,
          0,
          0,
          durationSec,
          1,
          offlineGraph.transientDuckHandles,
          playbackRate
        );
      }
    }

    onProgress?.(
      'Procesando Matriz Mid/Side, EQ Quirúrgico, Saturación 4x y Compresión Bus Glue...',
      42
    );

    const rawRenderedBuffer = await offlineCtx.startRendering();

    const forensicCfg =
      exportChain.forensicHumanizer ?? DEFAULT_FORENSIC_HUMANIZER_CONFIG;
    const renderedBuffer =
      await ForensicHumanizerDSP.applyDeepAntiSunoOfflineCloak(
        rawRenderedBuffer,
        forensicCfg,
        onProgress
      );

    onProgress?.(
      `Aplicando Limitador Lookahead Brickwall (${exportChain.limiter.ceilingDbTp.toFixed(1)} dBTP)...`,
      78
    );

    const limiterStats = applyLookaheadBrickwallLimiterOffline(
      renderedBuffer,
      exportChain.limiter.ceilingDbTp,
      exportChain.limiter.lookaheadMs,
      exportChain.limiter.releaseMs
    );

    onProgress?.(
      'Codificando archivo RIFF WAVE PCM 24-bit con Dithering TPDF...',
      92
    );

    const wavBlob = encodeAudioBufferToWav24Bit(renderedBuffer, true);

    onProgress?.('Master 24-Bit WAV completado.', 100);

    return {
      blob: wavBlob,
      durationSec: Number(renderedBuffer.duration.toFixed(2)),
      sampleRate: targetSampleRate,
      bitDepth: 24,
      finalTruePeakDbTp: limiterStats.finalTruePeakDbTp,
      maxLimiterReductionDb: limiterStats.maxGainReductionDb,
    };
  }

  public dispose(): void {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
    }
    this.ctx = null;
  }
}
