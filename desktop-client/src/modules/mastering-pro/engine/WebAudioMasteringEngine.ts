import type {
  AudioMetrics,
  DrumHitEvent,
  DrumLayeringConfig,
  ExportQaReport,
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
  buildBusCompressorParams,
  buildLookaheadLimiterParams,
  buildMasteringDspGraph,
  buildPostCompressorStages,
  buildPreCompressorStages,
  ensureMasteringWorkletsRegistered,
  type MasteringGraphHandles,
} from './MasteringGraphBuilder';
import { analyzeTrackAndComputeAdaptationAsync } from './SpectralDeltaAnalyzer';
import { encodeAudioBufferToWav24Bit } from './Wav24BitEncoder';
import { processBusCompressorOffline } from '../dsp-core/BusCompressorCore';
import { applyTruePeakLookaheadLimiterOffline } from '../dsp-core/LookaheadLimiterCore';
import {
  computeFullLoudnessReport,
  downmixToStereoArrays,
} from '../dsp-core/KWeightingLufs';
import { linearToDbTp, measureTruePeakLinear4x } from '../dsp-core/TruePeakDetector';

export interface ExportMasterResult {
  blob: Blob;
  durationSec: number;
  sampleRate: number;
  bitDepth: 24;
  finalTruePeakDbTp: number;
  maxLimiterReductionDb: number;
  qaReport: ExportQaReport;
}

interface MeterWorkletSnapshot {
  momentaryLufs: number;
  shortTermLufs: number;
  integratedLufs: number;
  lraLu?: number;
  truePeakDbTp: number;
  phaseCorrelation: number;
  crestFactorDb: number;
  clippedSamples: number;
}

function deepCloneChain(chain: MasteringDspChain): MasteringDspChain {
  return JSON.parse(JSON.stringify(chain)) as MasteringDspChain;
}

/**
 * Surgical Kick -> Bass stem sidechain ducking in pure float arrays.
 * Detects low-passed (<115 Hz) kick energy from drums L/R and attenuates ONLY the bass stem arrays,
 * leaving drums, vocals, and instruments 100% untouched.
 */
export function applyKickBassSidechainToBassArrays(
  drumsL: Float32Array,
  drumsR: Float32Array,
  bassL: Float32Array,
  bassR: Float32Array,
  sampleRate: number,
  drumsLinearGain = 1.0
): void {
  const n = Math.min(bassL.length, bassR.length);
  const drumLen = Math.min(drumsL.length, drumsR.length);
  if (n === 0 || drumLen === 0) return;

  // 115 Hz low-pass detector so hi-hats/cymbals on the drum bus never pump the bass
  const lpAlpha = (2 * Math.PI * 115) / (sampleRate + 2 * Math.PI * 115);
  const atkCoeff = Math.exp(-1 / Math.max(1, 0.004 * sampleRate)); // 4ms attack
  const relCoeff = Math.exp(-1 / Math.max(1, 0.095 * sampleRate)); // 95ms musical recovery

  let lpL = 0;
  let lpR = 0;
  let maxDrumLowPeak = 0;
  const detectLen = Math.min(n, drumLen);
  for (let i = 0; i < detectLen; i++) {
    lpL += lpAlpha * (drumsL[i] * drumsLinearGain - lpL);
    lpR += lpAlpha * (drumsR[i] * drumsLinearGain - lpR);
    const pk = Math.max(Math.abs(lpL), Math.abs(lpR));
    if (pk > maxDrumLowPeak) maxDrumLowPeak = pk;
  }

  if (maxDrumLowPeak < 0.015) return; // Silent drum bus -> zero ducking

  const threshold = Math.max(0.06, maxDrumLowPeak * 0.28);
  const headroomSpan = Math.max(0.08, maxDrumLowPeak - threshold);

  lpL = 0;
  lpR = 0;
  let env = 0;

  for (let i = 0; i < n; i++) {
    if (i < drumLen) {
      lpL += lpAlpha * (drumsL[i] * drumsLinearGain - lpL);
      lpR += lpAlpha * (drumsR[i] * drumsLinearGain - lpR);
    } else {
      lpL *= 0.995;
      lpR *= 0.995;
    }
    const kickLevel = Math.max(Math.abs(lpL), Math.abs(lpR));
    if (kickLevel > env) {
      env = atkCoeff * env + (1 - atkCoeff) * kickLevel;
    } else {
      env = relCoeff * env + (1 - relCoeff) * kickLevel;
    }

    if (env > threshold) {
      const ratio = Math.min(1, (env - threshold) / headroomSpan);
      const duckGain = 1 - ratio * 0.34; // Up to ~3.6 dB tight kick pocket on Bass stem ONLY
      bassL[i] *= duckGain;
      bassR[i] *= duckGain;
    }
  }
}

export class WebAudioMasteringEngine {
  private ctx: AudioContext | null = null;
  private contextInitPromise: Promise<AudioContext> | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private graphHandles: MasteringGraphHandles | null = null;

  private preAnalyser: AnalyserNode | null = null;
  private postAnalyser: AnalyserNode | null = null;
  private preMeterNode: AudioWorkletNode | null = null;
  private postMeterNode: AudioWorkletNode | null = null;
  private preMeterSnapshot: MeterWorkletSnapshot | null = null;
  private postMeterSnapshot: MeterWorkletSnapshot | null = null;

  private bypassGainNode: GainNode | null = null;
  private bypassLatencyAlignDelay: DelayNode | null = null;
  private masterGainNode: GainNode | null = null;
  private masterVolumeNode: GainNode | null = null;
  private bandPassSoloController: BandPassSoloController | null = null;

  private drumReplacer = new DrumTransientReplacerDSP();
  private detectedDrumHits: DrumHitEvent[] = [];
  private lastDrumConfigSig = '';
  private lastSensitivitySig = '';
  private drumRescheduleTimer: ReturnType<typeof setInterval> | null = null;
  private lastLoopCycleScheduled = 0;
  private drumCycleOriginCtxTime = 0;

  private activeChain: MasteringDspChain;
  private calibratedLiveDriveDb = 0;
  private expectedLiveOutputLufs: number;
  private calibrationTimer: ReturnType<typeof setTimeout> | null = null;
  private calibrationSeq = 0;

  private adaptationReport: SpectralAdaptationReport | null = null;
  private autoAdaptEnabled = true;
  private isBypassed = false;
  private isGainMatchActive = true;

  private isPlaying = false;
  private startTimestamp = 0;
  private pauseOffsetSec = 0;
  private activePlaybackRate = 1.0;
  private loopEnabled = true;

  private preFreqBins: Uint8Array<ArrayBuffer> = new Uint8Array(2048);
  private postFreqBins: Uint8Array<ArrayBuffer> = new Uint8Array(2048);
  private waveformOverview: Float32Array<ArrayBuffer> = new Float32Array(240);

  private onPlaybackEndCallback?: () => void;

  constructor(initialChain: MasteringDspChain) {
    this.activeChain = deepCloneChain(initialChain);
    this.expectedLiveOutputLufs = initialChain.limiter.targetLufs;
  }

  private ensureContextSync(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
      this.setupLiveRoutingGraph(false);
    }
    return this.ctx;
  }

  private async ensureContextAsync(): Promise<AudioContext> {
    if (this.ctx && this.ctx.state !== 'closed' && this.graphHandles?.compWorkletNode) {
      return this.ctx;
    }
    if (this.contextInitPromise) {
      return this.contextInitPromise;
    }

    this.contextInitPromise = (async () => {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        this.ctx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
      }
      const { meteringReady } = await ensureMasteringWorkletsRegistered(this.ctx);
      this.rebuildLiveRoutingGraph(meteringReady);
      return this.ctx;
    })();

    try {
      return await this.contextInitPromise;
    } finally {
      this.contextInitPromise = null;
    }
  }

  private rebuildLiveRoutingGraph(meteringReady: boolean): void {
    if (!this.ctx) return;
    try {
      this.graphHandles?.dispose();
      this.preAnalyser?.disconnect();
      this.postAnalyser?.disconnect();
      this.preMeterNode?.disconnect();
      this.postMeterNode?.disconnect();
      this.bypassLatencyAlignDelay?.disconnect();
      this.bypassGainNode?.disconnect();
      this.masterGainNode?.disconnect();
    } catch {
      // ignore
    }
    this.setupLiveRoutingGraph(meteringReady);
  }

  private setupLiveRoutingGraph(meteringReady: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    if (!this.preAnalyser) {
      this.preAnalyser = ctx.createAnalyser();
      this.preAnalyser.fftSize = 4096;
      this.preAnalyser.smoothingTimeConstant = 0.65;
    }

    if (!this.postAnalyser) {
      this.postAnalyser = ctx.createAnalyser();
      this.postAnalyser.fftSize = 4096;
      this.postAnalyser.smoothingTimeConstant = 0.65;
    }

    this.bypassGainNode = ctx.createGain();
    this.bypassLatencyAlignDelay = ctx.createDelay(0.05);
    this.bypassLatencyAlignDelay.delayTime.value =
      this.computeLiveBypassLatencySec(this.activeChain, ctx.sampleRate);

    this.masterGainNode = ctx.createGain();
    if (!this.masterVolumeNode) {
      this.masterVolumeNode = ctx.createGain();
      this.masterVolumeNode.gain.value = 1.0;
    }

    this.graphHandles = buildMasteringDspGraph(
      ctx,
      this.activeChain,
      this.calibratedLiveDriveDb
    );

    if (meteringReady && typeof AudioWorkletNode !== 'undefined') {
      try {
        this.preMeterNode = new AudioWorkletNode(ctx, 'mastering-metering-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.preMeterNode.port.onmessage = (
          ev: MessageEvent<{ type: string; snapshot?: MeterWorkletSnapshot }>
        ) => {
          if (ev.data?.type === 'meter' && ev.data.snapshot) {
            this.preMeterSnapshot = ev.data.snapshot;
          }
        };

        this.postMeterNode = new AudioWorkletNode(ctx, 'mastering-metering-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.postMeterNode.port.onmessage = (
          ev: MessageEvent<{ type: string; snapshot?: MeterWorkletSnapshot }>
        ) => {
          if (ev.data?.type === 'meter' && ev.data.snapshot) {
            this.postMeterSnapshot = ev.data.snapshot;
          }
        };
      } catch {
        this.preMeterNode = null;
        this.postMeterNode = null;
      }
    }

    // Post route: graph -> postAnalyser -> (postMeterNode) -> masterGainNode -> masterVolume
    this.graphHandles.outputNode.connect(this.postAnalyser);
    if (this.postMeterNode) {
      this.postAnalyser.connect(this.postMeterNode);
      this.postMeterNode.connect(this.masterGainNode);
    } else {
      this.postAnalyser.connect(this.masterGainNode);
    }

    // Pre route: preAnalyser -> (preMeterNode) -> bypassDelay -> bypassGain -> masterVolume
    if (this.preMeterNode) {
      this.preAnalyser.connect(this.preMeterNode);
      this.preMeterNode.connect(this.bypassLatencyAlignDelay);
    } else {
      this.preAnalyser.connect(this.bypassLatencyAlignDelay);
    }
    this.bypassLatencyAlignDelay.connect(this.bypassGainNode);

    this.masterGainNode.connect(this.masterVolumeNode);
    this.bypassGainNode.connect(this.masterVolumeNode);

    if (!this.bandPassSoloController) {
      this.bandPassSoloController = new BandPassSoloController(ctx);
      this.masterVolumeNode.connect(this.bandPassSoloController.inputNode);
      this.bandPassSoloController.outputNode.connect(ctx.destination);
    }

    this.preFreqBins = new Uint8Array(this.preAnalyser.frequencyBinCount);
    this.postFreqBins = new Uint8Array(this.postAnalyser.frequencyBinCount);

    this.updateAbCrossfadeGains();
  }

  /** Returns underlying AudioContext (used by Sample Lab / BandPass solo) */
  public async getAudioContextAsync(): Promise<AudioContext> {
    return this.ensureContextAsync();
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public connectExternalSource(node: AudioNode): void {
    if (!this.preAnalyser || !this.graphHandles) {
      this.ensureContextSync();
    }
    if (this.preAnalyser && this.graphHandles) {
      node.connect(this.preAnalyser);
      node.connect(this.graphHandles.inputNode);
    }
  }

  public disconnectExternalSource(node: AudioNode): void {
    try {
      if (this.preAnalyser) node.disconnect(this.preAnalyser);
      if (this.graphHandles) node.disconnect(this.graphHandles.inputNode);
    } catch {
      // already disconnected
    }
  }

  public computeTargetMakeupGainDb(
    chain: MasteringDspChain = this.activeChain
  ): number {
    if ((chain.intensityScale ?? 1) <= 0.005) {
      return 0;
    }
    if (this.calibratedLiveDriveDb !== 0 || this.audioBuffer) {
      return Number(this.calibratedLiveDriveDb.toFixed(2));
    }
    const baseInputLufs = this.adaptationReport?.detectedInputLufs ?? -16.5;
    return Math.max(-12, Math.min(16, chain.limiter.targetLufs - baseInputLufs));
  }

  public getTargetPlaybackRate(
    chain: MasteringDspChain = this.activeChain
  ): number {
    if ((chain.intensityScale ?? 1) <= 0.005) return 1.0;
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

  public async loadAudioBuffer(rawBuffer: AudioBuffer): Promise<{
    buffer: AudioBuffer;
    report: SpectralAdaptationReport;
  }> {
    const wasPlaying = this.isPlaying;
    this.stop();

    const ctx = await this.ensureContextAsync();
    const decoded = this.normalizeBufferToStereo(ctx, rawBuffer);
    this.audioBuffer = decoded;
    this.pauseOffsetSec = 0;

    this.computeWaveformOverview(decoded);
    const drumCfg = this.activeChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    this.lastSensitivitySig = `${drumCfg.kickSensitivity.toFixed(2)}:${drumCfg.snareSensitivity.toFixed(2)}`;
    const report = await analyzeTrackAndComputeAdaptationAsync(
      decoded,
      undefined,
      drumCfg.kickSensitivity,
      drumCfg.snareSensitivity
    );
    this.adaptationReport = report;
    this.detectedDrumHits = report.detectedDrumHits;

    this.calibratedLiveDriveDb = Math.max(
      -12,
      Math.min(16, this.activeChain.limiter.targetLufs - report.detectedInputLufs)
    );
    await this.runLiveGainCalibration(this.activeChain);
    this.applyDspChain(this.activeChain);

    if (wasPlaying) {
      await this.play();
    }

    return { buffer: decoded, report };
  }

  private computeLiveBypassLatencySec(
    chain: MasteringDspChain,
    sampleRate: number
  ): number {
    const lookaheadMs = Math.max(3.5, chain.limiter.lookaheadMs || 5.0);
    const isTrueBypass = (chain.intensityScale ?? 1) <= 0.005;
    // Stage 4C inserts a stereo-linked 1.2ms tape delay when enabled
    const humanizerTapeDelaySec =
      !isTrueBypass && chain.forensicHumanizer?.enabled !== false ? 0.0012 : 0;
    return lookaheadMs / 1000 + 5 / sampleRate + humanizerTapeDelaySec;
  }

  private normalizeBufferToStereo(ctx: BaseAudioContext, raw: AudioBuffer): AudioBuffer {
    if (raw.numberOfChannels === 2) {
      return raw;
    }
    if (raw.numberOfChannels === 1) {
      // Explicit Mono -> Dual-Mono Stereo upmix so Mid/Side Matrix, LUFS & True Peak stay 100% consistent
      const ch0 = raw.getChannelData(0);
      const out = ctx.createBuffer(2, raw.length, raw.sampleRate);
      out.copyToChannel(new Float32Array(ch0), 0);
      out.copyToChannel(new Float32Array(ch0), 1);
      return out;
    }
    // >2 channels (e.g. 5.1 surround): ITU downmix to clean Stereo
    const chans: Float32Array[] = [];
    for (let c = 0; c < raw.numberOfChannels; c++) {
      chans.push(raw.getChannelData(c));
    }
    const { left, right } = downmixToStereoArrays(chans);
    const out = ctx.createBuffer(2, raw.length, raw.sampleRate);
    out.copyToChannel(new Float32Array(left), 0);
    out.copyToChannel(new Float32Array(right), 1);
    return out;
  }

  private async decodeAndPrepareBuffer(arrayBuffer: ArrayBuffer): Promise<{
    buffer: AudioBuffer;
    report: SpectralAdaptationReport;
  }> {
    const wasPlaying = this.isPlaying;
    this.stop();

    const ctx = await this.ensureContextAsync();
    const rawDecoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const decoded = this.normalizeBufferToStereo(ctx, rawDecoded);
    this.audioBuffer = decoded;
    this.pauseOffsetSec = 0;

    this.computeWaveformOverview(decoded);
    const drumCfg = this.activeChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    this.lastSensitivitySig = `${drumCfg.kickSensitivity.toFixed(2)}:${drumCfg.snareSensitivity.toFixed(2)}`;
    const report = await analyzeTrackAndComputeAdaptationAsync(
      decoded,
      undefined,
      drumCfg.kickSensitivity,
      drumCfg.snareSensitivity
    );
    this.adaptationReport = report;
    this.detectedDrumHits = report.detectedDrumHits;

    // Immediate calibrated drive estimate before fine snippet calibration
    this.calibratedLiveDriveDb = Math.max(
      -12,
      Math.min(16, this.activeChain.limiter.targetLufs - report.detectedInputLufs)
    );
    await this.runLiveGainCalibration(this.activeChain);
    this.applyDspChain(this.activeChain);

    if (wasPlaying) {
      await this.play();
    }

    return { buffer: decoded, report };
  }

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

    const drumsStem = audibleStems.find(
      (s) => s.role === 'drums' && s.audioBuffer
    );
    const bassStems = audibleStems.filter((s) => s.role === 'bass');
    const nonBassStems = audibleStems.filter((s) => s.role !== 'bass');

    const renderStemGroup = async (
      group: StemTrackState[]
    ): Promise<AudioBuffer> => {
      const oCtx = new OfflineAudioContext(2, totalLength, sampleRate);
      for (const stem of group) {
        const buf = stem.audioBuffer!;
        const source = oCtx.createBufferSource();
        source.buffer = buf;

        const gainNode = oCtx.createGain();
        gainNode.gain.value = Math.pow(10, stem.gainDb / 20);

        const panner = oCtx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, stem.pan));

        source.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(oCtx.destination);
        source.start(0);
      }
      return oCtx.startRendering();
    };

    let mixedBuffer: AudioBuffer;

    if (enableKickBassSidechain && drumsStem?.audioBuffer && bassStems.length > 0) {
      // Render non-bass stems & bass stems separately so kick sidechain ducks ONLY the bass bus!
      const [nonBassBuffer, bassBuffer, drumsRenderedBuffer] = await Promise.all([
        nonBassStems.length > 0
          ? renderStemGroup(nonBassStems)
          : new OfflineAudioContext(2, totalLength, sampleRate).startRendering(),
        renderStemGroup(bassStems),
        renderStemGroup([drumsStem]),
      ]);

      const bassL = bassBuffer.getChannelData(0);
      const bassR = bassBuffer.getChannelData(1);
      const drumsL = drumsRenderedBuffer.getChannelData(0);
      const drumsR = drumsRenderedBuffer.getChannelData(1);

      applyKickBassSidechainToBassArrays(drumsL, drumsR, bassL, bassR, sampleRate, 1.0);

      const nonBassL = nonBassBuffer.getChannelData(0);
      const nonBassR = nonBassBuffer.getChannelData(1);
      for (let i = 0; i < totalLength; i++) {
        nonBassL[i] += bassL[i];
        nonBassR[i] += bassR[i];
      }
      mixedBuffer = nonBassBuffer;
    } else {
      mixedBuffer = await renderStemGroup(audibleStems);
    }

    this.stop();
    await this.ensureContextAsync();
    this.audioBuffer = mixedBuffer;
    this.pauseOffsetSec = 0;
    this.computeWaveformOverview(mixedBuffer);

    const drumCfg = this.activeChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    this.lastSensitivitySig = `${drumCfg.kickSensitivity.toFixed(2)}:${drumCfg.snareSensitivity.toFixed(2)}`;
    const report = await analyzeTrackAndComputeAdaptationAsync(
      mixedBuffer,
      undefined,
      drumCfg.kickSensitivity,
      drumCfg.snareSensitivity
    );
    this.adaptationReport = report;
    this.detectedDrumHits = report.detectedDrumHits;
    this.calibratedLiveDriveDb = Math.max(
      -12,
      Math.min(16, this.activeChain.limiter.targetLufs - report.detectedInputLufs)
    );
    await this.runLiveGainCalibration(this.activeChain);
    this.applyDspChain(this.activeChain);

    return { buffer: mixedBuffer, report };
  }

  public async generateStudioDemoTrack(): Promise<{
    buffer: AudioBuffer;
    report: SpectralAdaptationReport;
  }> {
    const ctx = await this.ensureContextAsync();
    const sr = ctx.sampleRate;
    const durationSec = 16;
    const length = sr * durationSec;
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const bpm = 118;
    const beatSec = 60 / bpm;
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

      let kick = 0;
      const kickEnvTime =
        beatInBar < 1
          ? beatFrac
          : Math.abs(beatInBar - 2) < 0.5
          ? t - Math.floor(t / beatSec) * beatSec
          : 99;
      if (kickEnvTime < 0.22) {
        const pitchDrop = 52 + 95 * Math.exp(-kickEnvTime * 42);
        kick =
          Math.sin(2 * Math.PI * pitchDrop * kickEnvTime) *
          Math.exp(-kickEnvTime * 14) *
          0.48;
      }

      let snare = 0;
      const isSnareBeat =
        Math.floor(beatInBar) === 1 || Math.floor(beatInBar) === 3;
      if (isSnareBeat && beatFrac < 0.18) {
        const noise = nextNoise();
        snare =
          (noise * 0.35 + Math.sin(2 * Math.PI * 185 * beatFrac) * 0.2) *
          Math.exp(-beatFrac * 22);
      }

      const eighthFrac = t % (beatSec * 0.5);
      const hat =
        eighthFrac < 0.045
          ? nextNoise() * Math.exp(-eighthFrac * 75) * 0.12
          : 0;

      const bassFreq = bassRoots[barIndex];
      const bass =
        (Math.sin(2 * Math.PI * bassFreq * t) * 0.32 +
          Math.sin(2 * Math.PI * bassFreq * 2 * t) * 0.12) *
        (0.75 + 0.25 * Math.sin(2 * Math.PI * 2 * t));

      const triad = chordTriads[barIndex];
      const padL =
        Math.sin(2 * Math.PI * triad[0] * t + 0.15) * 0.11 +
        Math.sin(2 * Math.PI * triad[1] * 1.002 * t) * 0.09 +
        Math.sin(2 * Math.PI * triad[2] * 2 * t) * 0.06;
      const padR =
        Math.sin(2 * Math.PI * triad[0] * 0.998 * t - 0.2) * 0.11 +
        Math.sin(2 * Math.PI * triad[1] * t + 0.4) * 0.09 +
        Math.sin(2 * Math.PI * triad[2] * 2.003 * t - 0.3) * 0.06;

      const leadNote =
        triad[(Math.floor(t / (beatSec * 0.5)) + barIndex) % 3] * 2;
      const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 2.5;
      const leadCenter =
        Math.sin(2 * Math.PI * (leadNote + vibrato) * t) * 0.11 +
        Math.sin(2 * Math.PI * 3800 * t) * 0.014 * (0.5 + 0.5 * Math.sin(t * 3));

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

    const drumCfg = this.activeChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    this.lastSensitivitySig = `${drumCfg.kickSensitivity.toFixed(2)}:${drumCfg.snareSensitivity.toFixed(2)}`;
    const report = await analyzeTrackAndComputeAdaptationAsync(
      buffer,
      undefined,
      drumCfg.kickSensitivity,
      drumCfg.snareSensitivity
    );
    this.adaptationReport = report;
    this.detectedDrumHits = report.detectedDrumHits;
    this.calibratedLiveDriveDb = Math.max(
      -12,
      Math.min(16, this.activeChain.limiter.targetLufs - report.detectedInputLufs)
    );
    await this.runLiveGainCalibration(this.activeChain);
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

  /**
   * Shared unified Stage 1 -> Stage 4C offline renderer (used identically by Export and Live Calibration!).
   * Runs:
   *   Pass 1A: Stages 2 + 3 + Drum Layering (OfflineAudioContext)
   *   Stage 4A: BusCompressorCore in TS (bit-exact to Live AudioWorklet!)
   *   Pass 1B: Stages 4B (Saturation) + 4C (Restorer) (OfflineAudioContext)
   */
  private async renderPreLimiterBuffer(
    inputBuffer: AudioBuffer,
    chain: MasteringDspChain,
    playbackRate: number,
    drumHits: DrumHitEvent[],
    offsetSec = 0
  ): Promise<{ buffer: AudioBuffer; maxCompressorGrDb: number }> {
    const targetSampleRate = 48000;
    const renderedDurationSec = inputBuffer.duration / playbackRate;
    const totalFrames = Math.max(
      1,
      Math.ceil(renderedDurationSec * targetSampleRate)
    );

    // PASS 1A: Pre-Compressor Stages (HPF, EQ, Notches, Mid/Side, Drum Layering)
    const ctx1A = new OfflineAudioContext(2, totalFrames, targetSampleRate);
    const src1A = ctx1A.createBufferSource();
    src1A.buffer = inputBuffer;
    src1A.playbackRate.value = playbackRate;

    const preStages = buildPreCompressorStages(ctx1A, chain);
    preStages.updatePreCompressor(chain, 0);
    src1A.connect(preStages.inputNode);
    preStages.outputNode.connect(ctx1A.destination);
    src1A.start(0);

    const drumCfg = chain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    if (drumCfg.enabled && drumHits.length > 0) {
      const shiftedHits =
        offsetSec > 0
          ? drumHits
              .filter(
                (h) =>
                  h.timeSec >= offsetSec &&
                  h.timeSec <= offsetSec + inputBuffer.duration
              )
              .map((h) => ({ ...h, timeSec: h.timeSec - offsetSec }))
          : drumHits;

      this.drumReplacer.scheduleDrumLayers(
        ctx1A,
        preStages.drumLayerBusInput,
        shiftedHits,
        drumCfg,
        0,
        0,
        inputBuffer.duration,
        1,
        preStages.transientDuckHandles,
        playbackRate
      );
    }

    const preCompBuffer = await ctx1A.startRendering();

    // STAGE 4A: Exact same BusCompressorCore used by Live AudioWorklet!
    let maxCompressorGrDb = 0;
    const isTrueBypass = (chain.intensityScale ?? 1) <= 0.005;
    if (!isTrueBypass && chain.compressor.parallelMix > 0.005) {
      const compRes = processBusCompressorOffline(
        preCompBuffer.getChannelData(0),
        preCompBuffer.getChannelData(1),
        targetSampleRate,
        buildBusCompressorParams(chain)
      );
      maxCompressorGrDb = compRes.maxGainReductionDb;
    }

    // PASS 1B: Post-Compressor Stages (4x +8dB Saturation + DC Blocker + Tilt + Stage 4C Restorer)
    const ctx1B = new OfflineAudioContext(2, totalFrames, targetSampleRate);
    const src1B = ctx1B.createBufferSource();
    src1B.buffer = preCompBuffer;

    const postStages = buildPostCompressorStages(ctx1B, chain);
    postStages.updatePostCompressor(chain, 0);
    src1B.connect(postStages.inputNode);
    postStages.outputNode.connect(ctx1B.destination);
    src1B.start(0);

    try {
      const postBuffer = await ctx1B.startRendering();
      return { buffer: postBuffer, maxCompressorGrDb };
    } finally {
      postStages.dispose();
    }
  }

  /**
   * Calibrates the live Maximizer drive on a representative <=8s slice using the exact
   * same pipeline as Export, so Live playback matches Target LUFS accurately!
   */
  private async runLiveGainCalibration(chain: MasteringDspChain): Promise<void> {
    if (!this.audioBuffer) return;
    if ((chain.intensityScale ?? 1) <= 0.005) {
      this.calibratedLiveDriveDb = 0;
      this.expectedLiveOutputLufs = this.adaptationReport?.detectedInputLufs ?? -16.5;
      return;
    }

    const seq = ++this.calibrationSeq;
    try {
      const sr = this.audioBuffer.sampleRate;
      const maxSliceSec = 8.0;
      const fullDur = this.audioBuffer.duration;
      const sliceDur = Math.min(fullDur, maxSliceSec);
      const startSec = fullDur > maxSliceSec ? (fullDur - sliceDur) * 0.35 : 0;
      const startSample = Math.floor(startSec * sr);
      const sliceLen = Math.max(1024, Math.floor(sliceDur * sr));

      const tmpCtx = this.ctx ?? new OfflineAudioContext(2, 128, sr);
      const sliceBuf = tmpCtx.createBuffer(2, sliceLen, sr);
      const lIn = this.audioBuffer.getChannelData(0);
      const rIn =
        this.audioBuffer.numberOfChannels > 1
          ? this.audioBuffer.getChannelData(1)
          : lIn;
      sliceBuf.copyToChannel(lIn.subarray(startSample, startSample + sliceLen), 0);
      sliceBuf.copyToChannel(rIn.subarray(startSample, startSample + sliceLen), 1);

      const rate = this.getTargetPlaybackRate(chain);
      const { buffer: preLimiterSlice } = await this.renderPreLimiterBuffer(
        sliceBuf,
        chain,
        rate,
        this.detectedDrumHits,
        startSec
      );
      if (seq !== this.calibrationSeq) return;

      const L = preLimiterSlice.getChannelData(0);
      const R = preLimiterSlice.getChannelData(1);
      const preStats = computeFullLoudnessReport([L, R], 48000);

      let driveDb = Math.max(
        -16,
        Math.min(20, chain.limiter.targetLufs - preStats.integratedLufs)
      );

      // Single fast refinement step accounting for limiter reduction
      const testL = new Float32Array(L);
      const testR = new Float32Array(R);
      applyTruePeakLookaheadLimiterOffline(
        testL,
        testR,
        48000,
        buildLookaheadLimiterParams(chain, driveDb)
      );
      const postStats = computeFullLoudnessReport([testL, testR], 48000);
      const residual = chain.limiter.targetLufs - postStats.integratedLufs;
      if (Math.abs(residual) > 0.2) {
        driveDb = Math.max(-16, Math.min(20, driveDb + residual * 0.9));
      }

      if (seq !== this.calibrationSeq) return;
      this.calibratedLiveDriveDb = Number(driveDb.toFixed(2));
      this.expectedLiveOutputLufs = Number(
        Math.min(chain.limiter.targetLufs, postStats.integratedLufs + residual * 0.85).toFixed(2)
      );

      if (this.ctx && this.graphHandles) {
        this.graphHandles.applyDspChain(
          this.activeChain,
          this.calibratedLiveDriveDb,
          this.ctx.currentTime
        );
        this.updateAbCrossfadeGains();
      }
    } catch {
      // keep previous estimate
    }
  }

  private scheduleLiveGainCalibration(chain: MasteringDspChain): void {
    if (this.calibrationTimer) clearTimeout(this.calibrationTimer);
    this.calibrationTimer = setTimeout(() => {
      void this.runLiveGainCalibration(chain);
    }, 110);
  }

  public applyDspChain(chain: MasteringDspChain): void {
    const prevRate = this.activePlaybackRate;
    const nextRate = this.getTargetPlaybackRate(chain);

    // Re-anchor startTimestamp BEFORE changing playbackRate so playhead doesn't jump
    if (
      this.isPlaying &&
      this.ctx &&
      this.audioBuffer &&
      Math.abs(nextRate - prevRate) > 1e-4
    ) {
      const currentPos = this.getCurrentTimeSec();
      this.startTimestamp = this.ctx.currentTime - currentPos / nextRate;
    }

    this.activeChain = deepCloneChain(chain);
    this.activePlaybackRate = nextRate;

    if (!this.ctx || !this.graphHandles) {
      this.scheduleLiveGainCalibration(this.activeChain);
      return;
    }

    const makeupDb = this.computeTargetMakeupGainDb(this.activeChain);
    this.graphHandles.applyDspChain(
      this.activeChain,
      makeupDb,
      this.ctx.currentTime
    );
    if (this.bypassLatencyAlignDelay) {
      this.bypassLatencyAlignDelay.delayTime.setTargetAtTime(
        this.computeLiveBypassLatencySec(this.activeChain, this.ctx.sampleRate),
        this.ctx.currentTime,
        0.012
      );
    }
    this.updateAbCrossfadeGains();

    if (this.sourceNode) {
      this.sourceNode.playbackRate.setTargetAtTime(
        nextRate,
        this.ctx.currentTime,
        0.015
      );
    }

    // Re-detect drum hits if sensitivity changed
    const drumCfg = this.activeChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    const sensSig = `${drumCfg.kickSensitivity.toFixed(2)}:${drumCfg.snareSensitivity.toFixed(2)}`;
    if (this.audioBuffer && sensSig !== this.lastSensitivitySig) {
      this.lastSensitivitySig = sensSig;
      this.detectedDrumHits = this.drumReplacer.detectDrumTransients(
        this.audioBuffer,
        drumCfg
      );
    }

    const drumSig = `${drumCfg.enabled}:${drumCfg.kickMix.toFixed(2)}:${drumCfg.snareMix.toFixed(2)}:${drumCfg.drumStyle}:${drumCfg.humanizeRoundRobin}:${drumCfg.duckOriginalTransients !== false}:${sensSig}:${nextRate.toFixed(4)}`;
    if (drumSig !== this.lastDrumConfigSig) {
      this.lastDrumConfigSig = drumSig;
      if (this.isPlaying && this.audioBuffer && this.ctx && this.graphHandles) {
        const currentOffset = this.getCurrentTimeSec();
        const now = this.ctx.currentTime;
        this.drumCycleOriginCtxTime = now - currentOffset / Math.max(0.5, nextRate);
        this.drumReplacer.scheduleDrumLayers(
          this.ctx,
          this.graphHandles.drumLayerBusInput,
          this.detectedDrumHits,
          drumCfg,
          now,
          currentOffset,
          this.audioBuffer.duration,
          this.loopEnabled ? 3 : 1,
          this.graphHandles.transientDuckHandles,
          nextRate
        );
        this.lastLoopCycleScheduled = this.loopEnabled ? 2 : 0;
        if (this.loopEnabled && drumCfg.enabled) {
          this.startDrumRescheduler();
        } else {
          this.stopDrumRescheduler();
        }
      }
    }

    this.scheduleLiveGainCalibration(this.activeChain);
  }

  public setBypassAndGainMatch(bypass: boolean, gainMatch: boolean): void {
    this.isBypassed = bypass;
    this.isGainMatchActive = gainMatch;
    this.updateAbCrossfadeGains();
  }

  private updateAbCrossfadeGains(): void {
    if (!this.ctx || !this.bypassGainNode || !this.masterGainNode) return;
    const now = this.ctx.currentTime;

    if (this.isBypassed) {
      let bypassLinear = 1.0;
      if (this.isGainMatchActive && this.adaptationReport) {
        // Match against actual calibrated output loudness (fallback to targetLufs)
        const measuredPostLufs =
          this.isPlaying &&
          this.postMeterSnapshot &&
          this.postMeterSnapshot.integratedLufs > -55
            ? this.postMeterSnapshot.integratedLufs
            : this.expectedLiveOutputLufs;
        const diffDb = Math.max(
          -12,
          Math.min(12, measuredPostLufs - this.adaptationReport.detectedInputLufs)
        );
        const safeCeilingDb = -0.3 - this.adaptationReport.detectedTruePeakDb;
        const appliedDb = Math.min(diffDb, Math.max(-12, safeCeilingDb));
        bypassLinear = Math.pow(10, appliedDb / 20);
      }
      this.bypassGainNode.gain.setTargetAtTime(bypassLinear, now, 0.018);
      this.masterGainNode.gain.setTargetAtTime(0.0, now, 0.018);
    } else {
      this.bypassGainNode.gain.setTargetAtTime(0.0, now, 0.018);
      this.masterGainNode.gain.setTargetAtTime(1.0, now, 0.018);
    }
  }

  public async play(): Promise<void> {
    if (!this.audioBuffer) return;
    const ctx = await this.ensureContextAsync();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (this.isPlaying) {
      this.stopSourceNodeOnly();
    }

    this.preMeterNode?.port.postMessage({ type: 'reset' });
    this.postMeterNode?.port.postMessage({ type: 'reset' });
    this.graphHandles?.resetDynamics();
    this.preMeterSnapshot = null;
    this.postMeterSnapshot = null;

    const playbackRate = this.getTargetPlaybackRate(this.activeChain);
    this.activePlaybackRate = playbackRate;

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
        this.stopDrumRescheduler();
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
    this.startTimestamp = startCtxTime - offset / playbackRate;
    this.drumCycleOriginCtxTime = this.startTimestamp;
    this.isPlaying = true;
    this.lastLoopCycleScheduled = 0;

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
        this.loopEnabled ? 3 : 1,
        this.graphHandles.transientDuckHandles,
        playbackRate
      );
      this.lastLoopCycleScheduled = this.loopEnabled ? 2 : 0;
      if (this.loopEnabled && drumCfg.enabled) {
        this.startDrumRescheduler();
      }
    }
  }

  private startDrumRescheduler(): void {
    this.stopDrumRescheduler();
    this.drumRescheduleTimer = setInterval(() => {
      if (
        !this.isPlaying ||
        !this.loopEnabled ||
        !this.ctx ||
        !this.audioBuffer ||
        !this.graphHandles
      ) {
        return;
      }
      const drumCfg = this.activeChain.drumLayering;
      if (!drumCfg?.enabled) return;
      const elapsedDrumTrack =
        (this.ctx.currentTime - this.drumCycleOriginCtxTime) * this.activePlaybackRate;
      const dur = Math.max(0.1, this.audioBuffer.duration);
      const currentCycle = Math.floor(elapsedDrumTrack / dur);
      if (currentCycle >= this.lastLoopCycleScheduled - 1) {
        const nextCycle = this.lastLoopCycleScheduled + 1;
        this.lastLoopCycleScheduled = nextCycle;
        this.drumReplacer.scheduleDrumLayers(
          this.ctx,
          this.graphHandles.drumLayerBusInput,
          this.detectedDrumHits,
          drumCfg,
          this.drumCycleOriginCtxTime,
          0,
          dur,
          1,
          this.graphHandles.transientDuckHandles,
          this.activePlaybackRate,
          { clearExisting: false, startCycle: nextCycle }
        );
      }
    }, 500);
  }

  private stopDrumRescheduler(): void {
    if (this.drumRescheduleTimer) {
      clearInterval(this.drumRescheduleTimer);
      this.drumRescheduleTimer = null;
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
    this.stopDrumRescheduler();
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
    this.ensureContextSync();
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
    const ctx = await this.ensureContextAsync();
    const name = await this.drumReplacer.loadCustomSample(type, file, ctx);
    this.rescheduleDrumsIfPlaying();
    return name;
  }

  public setCustomDrumSampleFromBuffer(
    type: 'kick' | 'snare',
    buffer: AudioBuffer,
    name: string
  ): void {
    this.drumReplacer.setCustomSampleBuffer(type, buffer, name);
    this.rescheduleDrumsIfPlaying();
  }

  private rescheduleDrumsIfPlaying(): void {
    if (this.isPlaying && this.audioBuffer && this.graphHandles && this.ctx) {
      const currentOffset = this.getCurrentTimeSec();
      const rate = this.getTargetPlaybackRate(this.activeChain);
      const now = this.ctx.currentTime;
      this.drumCycleOriginCtxTime = now - currentOffset / Math.max(0.5, rate);
      this.drumReplacer.scheduleDrumLayers(
        this.ctx,
        this.graphHandles.drumLayerBusInput,
        this.detectedDrumHits,
        this.activeChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG,
        now,
        currentOffset,
        this.audioBuffer.duration,
        this.loopEnabled ? 3 : 1,
        this.graphHandles.transientDuckHandles,
        rate
      );
      this.lastLoopCycleScheduled = this.loopEnabled ? 2 : 0;
    }
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
    const elapsed =
      (this.ctx.currentTime - this.startTimestamp) * this.activePlaybackRate;
    if (this.loopEnabled && this.audioBuffer.duration > 0) {
      return elapsed % this.audioBuffer.duration;
    }
    return Math.min(this.audioBuffer.duration, Math.max(0, elapsed));
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
    this.ensureContextSync();
    return {
      preAnalyser: this.preAnalyser,
      postAnalyser: this.postAnalyser,
    };
  }

  public getAnalyserNodesReadOnly(): {
    preAnalyser: AnalyserNode | null;
    postAnalyser: AnalyserNode | null;
  } {
    return {
      preAnalyser: this.preAnalyser,
      postAnalyser: this.postAnalyser,
    };
  }

  public getVisualSnapshot(): {
    preBins: Uint8Array;
    postBins: Uint8Array;
    waveformPeaks: Float32Array;
    sampleRate: number;
  } {
    if (this.preAnalyser && this.postAnalyser && this.isPlaying) {
      this.preAnalyser.getByteFrequencyData(this.preFreqBins);
      this.postAnalyser.getByteFrequencyData(this.postFreqBins);
    }
    return {
      preBins: this.preFreqBins,
      postBins: this.postFreqBins,
      waveformPeaks: this.waveformOverview,
      sampleRate: this.ctx?.sampleRate ?? 48000,
    };
  }

  /**
   * Honest studio telemetry:
   * - When stopped: sets isMeteringActive=false so UI shows '—' for live meters instead of fabricated constants.
   * - When playing: reads real ITU-R BS.1770-4 K-weighted LUFS, unclamped 4x True Peak, real Phase Correlation,
   *   and real Worklet Bus Compressor & Lookahead Limiter Gain Reduction.
   */
  public getLiveMetrics(): AudioMetrics {
    const baseInputProfile: SpectralProfile =
      this.adaptationReport?.inputSpectralProfile ?? {
        sub: -16.0,
        lowMid: -16.0,
        presence: -16.0,
        air: -16.0,
      };

    if (!this.isPlaying || !this.graphHandles) {
      return {
        isMeteringActive: false,
        inputLufs: this.adaptationReport?.detectedInputLufs ?? NaN,
        outputLufs: NaN,
        momentaryLufs: NaN,
        shortTermLufs: NaN,
        truePeakDb: NaN,
        inputPeakDb: this.adaptationReport?.detectedTruePeakDb ?? NaN,
        gainReductionDb: 0,
        compressorReductionDb: 0,
        limiterReductionDb: 0,
        phaseCorrelation:
          this.adaptationReport?.detectedPhaseCorrelation ?? NaN,
        crestFactorDb: this.adaptationReport?.detectedCrestFactorDb ?? NaN,
        clippedSamples: 0,
        spectralBalance: baseInputProfile,
        postSpectralBalance: baseInputProfile,
      };
    }

    const postSnap = this.postMeterSnapshot;
    const preSnap = this.preMeterSnapshot;
    const { compGrDb, limGrDb } = this.graphHandles.getLiveGainReduction();
    const totalGr = Number((compGrDb + limGrDb).toFixed(1));

    // Compute real relative FFT band levels from postAnalyser bins (24kHz Nyquist / 2048 bins = 11.71Hz/bin)
    const sr = this.ctx?.sampleRate ?? 48000;
    const binHz = sr / (this.postAnalyser?.fftSize ?? 4096);
    const avgBandDb = (fMin: number, fMax: number): number => {
      const b0 = Math.max(1, Math.floor(fMin / binHz));
      const b1 = Math.min(this.postFreqBins.length - 1, Math.ceil(fMax / binHz));
      let s = 0;
      const cnt = Math.max(1, b1 - b0 + 1);
      for (let i = b0; i <= b1; i++) s += this.postFreqBins[i];
      const norm = s / cnt / 255;
      // Map AnalyserNode [minDecibels=-100 .. maxDecibels=-30] honestly
      const minDb = this.postAnalyser?.minDecibels ?? -100;
      const maxDb = this.postAnalyser?.maxDecibels ?? -30;
      return Number((minDb + norm * (maxDb - minDb)).toFixed(1));
    };

    const postSpectralBalance: SpectralProfile = {
      sub: avgBandDb(20, 160),
      lowMid: avgBandDb(160, 800),
      presence: avgBandDb(800, 5500),
      air: avgBandDb(5500, 18000),
    };

    const inputLufsVal =
      preSnap && preSnap.momentaryLufs > -68
        ? preSnap.integratedLufs > -68
          ? preSnap.integratedLufs
          : preSnap.momentaryLufs
        : this.adaptationReport?.detectedInputLufs ?? -16.5;

    const outputLufsVal =
      postSnap && postSnap.integratedLufs > -68
        ? postSnap.integratedLufs
        : postSnap && postSnap.momentaryLufs > -68
        ? postSnap.momentaryLufs
        : NaN;

    return {
      isMeteringActive: true,
      inputLufs: Number(inputLufsVal.toFixed(1)),
      outputLufs: Number.isFinite(outputLufsVal)
        ? Number(outputLufsVal.toFixed(1))
        : NaN,
      momentaryLufs:
        postSnap && postSnap.momentaryLufs > -68 ? postSnap.momentaryLufs : NaN,
      shortTermLufs:
        postSnap && postSnap.shortTermLufs > -68 ? postSnap.shortTermLufs : NaN,
      lraLu: postSnap?.lraLu,
      truePeakDb: postSnap?.truePeakDbTp ?? NaN, // Never artificially clamped!
      inputPeakDb:
        preSnap?.truePeakDbTp ??
        this.adaptationReport?.detectedTruePeakDb ??
        NaN,
      gainReductionDb: totalGr,
      compressorReductionDb: Number(compGrDb.toFixed(1)),
      limiterReductionDb: Number(limGrDb.toFixed(1)),
      phaseCorrelation: postSnap?.phaseCorrelation ?? NaN,
      crestFactorDb: postSnap?.crestFactorDb ?? NaN,
      clippedSamples: postSnap?.clippedSamples ?? 0,
      spectralBalance: baseInputProfile,
      postSpectralBalance,
    };
  }

  /**
   * STAGE 6: Two-Pass Verified Offline 48 kHz 24-Bit WAV Render.
   *
   * - Uses an immutable frozen snapshot of the chain (never mutates live playback state!).
   * - Pass 1 runs exact Stages 1-4C (including BusCompressorCore bit-exact to live worklet).
   * - Measures exact ITU-R BS.1770-4 LUFS of Pass 1.
   * - Pass 2 iteratively converges LookaheadLimiterCore drive to hit targetLufs within <= 0.25 LU
   *   and enforces ceilingDbTp using 4x Polyphase FIR True Peak detection.
   * - Returns verified ExportQaReport measured directly from the final WAV buffer.
   */
  public async exportMasterToWav24Bit(
    onProgress?: (stage: string, pct: number) => void,
    chainOverride?: MasteringDspChain,
    _makeupGainOverrideDb?: number
  ): Promise<ExportMasterResult> {
    if (!this.audioBuffer) {
      throw new Error('No hay ninguna pista cargada para exportar.');
    }

    // Freeze immutable job snapshot — NEVER mutates this.activeChain!
    const exportChain = Object.freeze(
      deepCloneChain(chainOverride ?? this.activeChain)
    );
    const targetSampleRate = 48000;
    const playbackRate = this.getTargetPlaybackRate(exportChain);
    const isTrueBypass = (exportChain.intensityScale ?? 1) <= 0.005;

    onProgress?.(
      'Pasada 1/2: Renderizando EQ, Mid/Side, Compresión Bus y Saturación 4x en 32-bit float...',
      15
    );

    const drumCfg = exportChain.drumLayering ?? DEFAULT_DRUM_LAYERING_CONFIG;
    const hitsForExport =
      drumCfg.enabled && !isTrueBypass
        ? this.drumReplacer.detectDrumTransients(this.audioBuffer, drumCfg)
        : [];

    const { buffer: pass1Buffer, maxCompressorGrDb } =
      await this.renderPreLimiterBuffer(
        this.audioBuffer,
        exportChain,
        playbackRate,
        hitsForExport,
        0
      );

    onProgress?.(
      'Pasada 1/2: Midiendo LUFS ITU-R BS.1770-4 reales para calibración de objetivo...',
      52
    );

    const pass1L = pass1Buffer.getChannelData(0);
    const pass1R = pass1Buffer.getChannelData(1);
    const pass1Stats = computeFullLoudnessReport([pass1L, pass1R], targetSampleRate);
    const inputReportStats = this.adaptationReport;
    const inputLufs = inputReportStats?.detectedInputLufs ?? pass1Stats.integratedLufs;

    const targetLufs = exportChain.limiter.targetLufs;
    const ceilingDbTp = exportChain.limiter.ceilingDbTp;

    let finalL = new Float32Array(pass1L);
    let finalR = new Float32Array(pass1R);
    let finalLimiterStats = { maxGainReductionDb: 0, finalTruePeakDbTp: pass1Stats.truePeakDbTp };
    let finalStats = pass1Stats;

    if (!isTrueBypass) {
      onProgress?.(
        `Pasada 2/2: Convergiendo Lookahead Limiter 4x FIR hacia ${targetLufs.toFixed(1)} LUFS (${ceilingDbTp.toFixed(1)} dBTP)...`,
        72
      );

      let driveDb = Math.max(-20, Math.min(28, targetLufs - pass1Stats.integratedLufs));

      for (let iter = 0; iter < 4; iter++) {
        finalL = new Float32Array(pass1L);
        finalR = new Float32Array(pass1R);
        finalLimiterStats = applyTruePeakLookaheadLimiterOffline(
          finalL,
          finalR,
          targetSampleRate,
          buildLookaheadLimiterParams(exportChain, driveDb)
        );
        finalStats = computeFullLoudnessReport([finalL, finalR], targetSampleRate);

        const errLu = targetLufs - finalStats.integratedLufs;
        if (Math.abs(errLu) <= 0.18) break;
        // Stop pushing drive if we are already hitting heavy GR ceiling wall (> 10 dB GR) and output stopped rising
        if (finalLimiterStats.maxGainReductionDb > 10.5 && errLu > 0 && iter > 0) {
          break;
        }
        driveDb = Math.max(-20, Math.min(28, driveDb + errLu * 0.92));
      }
    } else {
      // Even in 0% intensity dry bypass, guard against digital > -0.1 dBFS clips cleanly
      finalLimiterStats = {
        maxGainReductionDb: 0,
        finalTruePeakDbTp: Number(
          linearToDbTp(measureTruePeakLinear4x(finalL, finalR), -90).toFixed(2)
        ),
      };
    }

    const finalBuffer = new OfflineAudioContext(
      2,
      pass1Buffer.length,
      targetSampleRate
    ).createBuffer(2, pass1Buffer.length, targetSampleRate);
    finalBuffer.copyToChannel(finalL, 0);
    finalBuffer.copyToChannel(finalR, 1);

    const grBudgetExceeded = finalLimiterStats.maxGainReductionDb > 6.5;
    const grBudgetWarning = grBudgetExceeded
      ? `El limitador aplicó ${finalLimiterStats.maxGainReductionDb.toFixed(1)} dB de reducción para alcanzar ${targetLufs.toFixed(1)} LUFS. Para preservar mayor dinámica, prueba un Target LUFS más moderado.`
      : undefined;

    onProgress?.(
      'Codificando archivo RIFF WAVE PCM 24-bit con Dithering TPDF (±1 LSB)...',
      90
    );

    const wavBlob = encodeAudioBufferToWav24Bit(finalBuffer, true);

    const qaReport: ExportQaReport = {
      inputLufs,
      outputLufs: finalStats.integratedLufs,
      targetLufs,
      lufsErrorLu: Number((finalStats.integratedLufs - targetLufs).toFixed(2)),
      lraLu: finalStats.lraLu,
      finalTruePeakDbTp: finalLimiterStats.finalTruePeakDbTp,
      samplePeakDb: finalStats.samplePeakDb,
      plrDb: finalStats.plrDb,
      crestFactorDb: finalStats.crestFactorDb,
      phaseCorrelation: finalStats.phaseCorrelation,
      maxCompressorGrDb,
      maxLimiterReductionDb: finalLimiterStats.maxGainReductionDb,
      clippedSamples: finalStats.clippedSamples,
      grBudgetExceeded,
      grBudgetWarning,
    };

    onProgress?.('Master 24-Bit WAV verificado y completado.', 100);

    return {
      blob: wavBlob,
      durationSec: Number(finalBuffer.duration.toFixed(2)),
      sampleRate: targetSampleRate,
      bitDepth: 24,
      finalTruePeakDbTp: finalLimiterStats.finalTruePeakDbTp,
      maxLimiterReductionDb: finalLimiterStats.maxGainReductionDb,
      qaReport,
    };
  }

  public dispose(): void {
    if (this.calibrationTimer) {
      clearTimeout(this.calibrationTimer);
      this.calibrationTimer = null;
    }
    this.stop();
    try {
      this.graphHandles?.dispose();
    } catch {
      // ignore
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
    }
    this.ctx = null;
  }
}
