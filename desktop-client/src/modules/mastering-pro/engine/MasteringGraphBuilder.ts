import type { EQBandConfig, MasteringDspChain } from '../types/mastering.types';
import type { BusCompressorParams } from '../dsp-core/BusCompressorCore';
import type { LookaheadLimiterParams } from '../dsp-core/LookaheadLimiterCore';
import {
  computeSaturationGainStaging,
  generateAnalogSaturationCurve,
} from './AnalogSaturationCurves';
import type { TransientDuckHandles } from './DrumTransientReplacerDSP';
import {
  DEFAULT_FORENSIC_HUMANIZER_CONFIG,
  ForensicHumanizerDSP,
} from './ForensicHumanizerDSP';
import {
  createMidSideMatrix,
  type MidSideMatrixHandles,
} from './MidSideMatrix';
import { createBrickwallMaximizerCurve } from './TruePeakLimiter';
import dynamicsWorkletUrl from './worklets/mastering-dynamics.worklet.ts?worker&url';
import meteringWorkletUrl from './worklets/metering.worklet.ts?worker&url';

const registeredDynamicsCtx = new WeakSet<BaseAudioContext>();
const registeredMeteringCtx = new WeakSet<BaseAudioContext>();

export async function ensureMasteringWorkletsRegistered(
  ctx: BaseAudioContext
): Promise<{ dynamicsReady: boolean; meteringReady: boolean }> {
  let dynamicsReady = registeredDynamicsCtx.has(ctx);
  let meteringReady = registeredMeteringCtx.has(ctx);

  if (!ctx.audioWorklet) {
    return { dynamicsReady: false, meteringReady: false };
  }

  if (!dynamicsReady) {
    try {
      await ctx.audioWorklet.addModule(dynamicsWorkletUrl);
      registeredDynamicsCtx.add(ctx);
      dynamicsReady = true;
    } catch {
      dynamicsReady = false;
    }
  }

  if (!meteringReady) {
    try {
      await ctx.audioWorklet.addModule(meteringWorkletUrl);
      registeredMeteringCtx.add(ctx);
      meteringReady = true;
    } catch {
      meteringReady = false;
    }
  }

  return { dynamicsReady, meteringReady };
}

export interface MasteringGraphHandles {
  inputNode: GainNode;
  drumLayerBusInput: GainNode;
  transientDuckHandles: TransientDuckHandles;
  outputNode: GainNode;
  midSideMatrix: MidSideMatrixHandles;
  compWorkletNode: AudioWorkletNode | null;
  limiterWorkletNode: AudioWorkletNode | null;
  getLiveGainReduction: () => { compGrDb: number; limGrDb: number };
  resetDynamics: () => void;
  applyDspChain: (
    chain: MasteringDspChain,
    autoMakeupGainDb: number,
    now?: number
  ) => void;
  dispose: () => void;
}

function configureStereoFilterNode(
  node: BiquadFilterNode,
  band: EQBandConfig,
  now?: number
): void {
  const isActiveStereo = band.channel === 'stereo' && band.enabled !== false;
  const effectiveType: BiquadFilterType = isActiveStereo ? band.type : 'peaking';
  const clampedFreq = Math.max(20, Math.min(20000, band.freq));
  const clampedQ = Math.max(0.2, Math.min(24, band.q));
  const effectiveGain = isActiveStereo ? band.gainDb : 0;

  if (node.type !== effectiveType) {
    node.type = effectiveType;
  }
  node.frequency.value = clampedFreq;
  node.Q.value = clampedQ;
  node.gain.value = effectiveGain;

  if (now !== undefined) {
    node.frequency.setTargetAtTime(clampedFreq, now, 0.012);
    node.Q.setTargetAtTime(clampedQ, now, 0.012);
    node.gain.setTargetAtTime(effectiveGain, now, 0.012);
  }
}

export function buildBusCompressorParams(chain: MasteringDspChain): BusCompressorParams {
  return {
    thresholdDb: chain.compressor.thresholdDb,
    ratio: chain.compressor.ratio,
    attackSec: chain.compressor.attackSec,
    releaseSec: chain.compressor.releaseSec,
    kneeDb: chain.compressor.kneeDb,
    makeupGainDb: 0, // Zero hidden auto-makeup!
    parallelMix: Math.max(0, Math.min(1, chain.compressor.parallelMix)),
    sidechainHpfHz: 90,
  };
}

export function buildLookaheadLimiterParams(
  chain: MasteringDspChain,
  driveDb: number
): LookaheadLimiterParams {
  return {
    driveDb,
    ceilingDbTp: chain.limiter.ceilingDbTp,
    lookaheadMs: Math.max(3.5, chain.limiter.lookaheadMs || 5.0),
    releaseMs: chain.limiter.releaseMs || 65,
  };
}

/**
 * Builds Stage 2 -> Stage 3 -> Drum Layering Sum (Pre-Compressor).
 * Shared identically by full live graph and Offline Pass 1A!
 */
export function buildPreCompressorStages(
  ctx: BaseAudioContext,
  initialChain: MasteringDspChain
) {
  const inputNode = ctx.createGain();
  inputNode.channelCount = 2;
  inputNode.channelCountMode = 'explicit';

  const subsonicHpf = ctx.createBiquadFilter();
  subsonicHpf.type = 'highpass';
  subsonicHpf.frequency.value = Math.max(
    18,
    Math.min(60, initialChain.highPassFreq)
  );
  subsonicHpf.Q.value = Math.SQRT1_2;

  inputNode.connect(subsonicHpf);
  let lastStage2Node: AudioNode = subsonicHpf;

  const stereoBandFilters = new Map<string, BiquadFilterNode>();
  for (const band of initialChain.eqBands) {
    const filter = ctx.createBiquadFilter();
    configureStereoFilterNode(filter, band);
    lastStage2Node.connect(filter);
    lastStage2Node = filter;
    stereoBandFilters.set(band.id, filter);
  }

  const MAX_RESONANCE_NOTCHES = 6;
  const resonanceNotchFilters: BiquadFilterNode[] = [];
  const initialNotches = initialChain.resonanceNotches || [];
  for (let i = 0; i < MAX_RESONANCE_NOTCHES; i++) {
    const notchNode = ctx.createBiquadFilter();
    notchNode.type = 'peaking';
    const spec = initialNotches[i];
    notchNode.frequency.value = spec
      ? Math.max(120, Math.min(18000, spec.freqHz))
      : 3800 + i * 900;
    notchNode.Q.value = spec ? Math.max(4, Math.min(24, spec.q)) : 12.0;
    notchNode.gain.value =
      spec && spec.enabled && Math.abs(spec.gainCutDb) > 0.05
        ? Math.max(-14, Math.min(0, spec.gainCutDb))
        : 0;
    lastStage2Node.connect(notchNode);
    lastStage2Node = notchNode;
    resonanceNotchFilters.push(notchNode);
  }

  const drumMudSuppressFilter = ctx.createBiquadFilter();
  drumMudSuppressFilter.type = 'peaking';
  drumMudSuppressFilter.frequency.value = 78;
  drumMudSuppressFilter.Q.value = 1.65;
  drumMudSuppressFilter.gain.value =
    initialChain.drumLayering?.enabled &&
    initialChain.drumLayering?.suppressOriginalMud
      ? -1.6 * Math.max(0.25, initialChain.drumLayering.kickMix)
      : 0;
  lastStage2Node.connect(drumMudSuppressFilter);
  lastStage2Node = drumMudSuppressFilter;

  const midSideMatrix = createMidSideMatrix(
    ctx,
    initialChain.monoMakerFreq,
    initialChain.stereoWidth.sideGainDb,
    initialChain.eqBands
  );
  lastStage2Node.connect(midSideMatrix.inputNode);

  const kickDuckFilter = ctx.createBiquadFilter();
  kickDuckFilter.type = 'peaking';
  kickDuckFilter.frequency.value = 72;
  kickDuckFilter.Q.value = 1.35;
  kickDuckFilter.gain.value = 0;

  const snareDuckFilter = ctx.createBiquadFilter();
  snareDuckFilter.type = 'peaking';
  snareDuckFilter.frequency.value = 245;
  snareDuckFilter.Q.value = 1.15;
  snareDuckFilter.gain.value = 0;

  const drumLayerBusInput = ctx.createGain();
  drumLayerBusInput.gain.value = 1.0;
  const preGlueSumBus = ctx.createGain();
  preGlueSumBus.gain.value = 1.0;

  midSideMatrix.outputNode.connect(kickDuckFilter);
  kickDuckFilter.connect(snareDuckFilter);
  snareDuckFilter.connect(preGlueSumBus);
  drumLayerBusInput.connect(preGlueSumBus);

  const updatePreCompressor = (chain: MasteringDspChain, now: number) => {
    const clampedHpf = Math.max(18, Math.min(60, chain.highPassFreq));
    subsonicHpf.frequency.value = clampedHpf;
    subsonicHpf.frequency.setTargetAtTime(clampedHpf, now, 0.012);

    for (const band of chain.eqBands) {
      const stereoNode = stereoBandFilters.get(band.id);
      if (stereoNode) configureStereoFilterNode(stereoNode, band, now);
      midSideMatrix.updateBand(band, now);
    }

    const activeNotches = chain.resonanceNotches || [];
    for (let i = 0; i < MAX_RESONANCE_NOTCHES; i++) {
      const node = resonanceNotchFilters[i];
      const spec = activeNotches[i];
      if (spec && spec.enabled && Math.abs(spec.gainCutDb) > 0.05) {
        const f = Math.max(120, Math.min(18000, spec.freqHz));
        const q = Math.max(4, Math.min(24, spec.q));
        const g = Math.max(-14, Math.min(0, spec.gainCutDb));
        node.frequency.value = f;
        node.Q.value = q;
        node.gain.value = g;
        node.frequency.setTargetAtTime(f, now, 0.012);
        node.Q.setTargetAtTime(q, now, 0.012);
        node.gain.setTargetAtTime(g, now, 0.012);
      } else {
        node.gain.value = 0;
        node.gain.setTargetAtTime(0, now, 0.012);
      }
    }

    const mudSuppressDb =
      chain.drumLayering?.enabled && chain.drumLayering?.suppressOriginalMud
        ? -1.6 * Math.max(0.25, chain.drumLayering.kickMix)
        : 0;
    drumMudSuppressFilter.gain.value = mudSuppressDb;
    drumMudSuppressFilter.gain.setTargetAtTime(mudSuppressDb, now, 0.012);

    midSideMatrix.updateMonoMakerFreq(chain.monoMakerFreq, now);
    midSideMatrix.updateSideGainDb(chain.stereoWidth.sideGainDb, now);
  };

  return {
    inputNode,
    outputNode: preGlueSumBus,
    drumLayerBusInput,
    transientDuckHandles: { kickDuckFilter, snareDuckFilter },
    midSideMatrix,
    updatePreCompressor,
  };
}

/**
 * Builds Stage 4B (Click-Free Dual-WaveShaper 4x Saturator +8dB Headroom) -> Stage 4C (Analog Restorer).
 * Shared identically by live graph and Offline Pass 1B!
 */
export function buildPostCompressorStages(
  ctx: BaseAudioContext,
  initialChain: MasteringDspChain
) {
  const inputNode = ctx.createGain();
  const satInputGain = ctx.createGain();

  const waveShaperA = ctx.createWaveShaper();
  waveShaperA.oversample = '4x';
  const waveShaperB = ctx.createWaveShaper();
  waveShaperB.oversample = '4x';

  const shaperGainA = ctx.createGain();
  const shaperGainB = ctx.createGain();
  shaperGainA.gain.value = 1.0;
  shaperGainB.gain.value = 0.0;
  let activeSlot: 'A' | 'B' = 'A';

  const dcBlocker = ctx.createBiquadFilter();
  dcBlocker.type = 'highpass';
  dcBlocker.frequency.value = 18;
  dcBlocker.Q.value = Math.SQRT1_2;

  const warmthTilt = ctx.createBiquadFilter();
  warmthTilt.type = 'lowshelf';
  warmthTilt.frequency.value = 175;
  warmthTilt.gain.value = initialChain.saturation.warmthTiltDb;

  const satOutputTrim = ctx.createGain();

  let currentSatSignature = '';
  const updateSaturationState = (
    type: MasteringDspChain['saturation']['type'],
    drive: number,
    tiltDb: number,
    now: number,
    isInit = false
  ) => {
    const sig = `${type}:${drive.toFixed(3)}`;
    if (sig !== currentSatSignature) {
      const nextCurve = generateAnalogSaturationCurve(type, drive);
      if (isInit || now <= 0.001) {
        waveShaperA.curve = nextCurve;
        shaperGainA.gain.value = 1.0;
        shaperGainB.gain.value = 0.0;
        activeSlot = 'A';
      } else {
        // Crossfade smoothly over ~12ms on inactive WaveShaper so slider moves never click!
        if (activeSlot === 'A') {
          waveShaperB.curve = nextCurve;
          shaperGainA.gain.setTargetAtTime(0.0, now, 0.004);
          shaperGainB.gain.setTargetAtTime(1.0, now, 0.004);
          activeSlot = 'B';
        } else {
          waveShaperA.curve = nextCurve;
          shaperGainB.gain.setTargetAtTime(0.0, now, 0.004);
          shaperGainA.gain.setTargetAtTime(1.0, now, 0.004);
          activeSlot = 'A';
        }
      }
      currentSatSignature = sig;
    }

    const { inputGainLinear, outputTrimLinear } = computeSaturationGainStaging(
      type,
      drive
    );
    satInputGain.gain.value = inputGainLinear;
    satInputGain.gain.setTargetAtTime(inputGainLinear, now, 0.012);

    satOutputTrim.gain.value = outputTrimLinear;
    satOutputTrim.gain.setTargetAtTime(outputTrimLinear, now, 0.012);

    warmthTilt.gain.value = tiltDb;
    warmthTilt.gain.setTargetAtTime(tiltDb, now, 0.012);
  };

  updateSaturationState(
    initialChain.saturation.type,
    initialChain.saturation.drive,
    initialChain.saturation.warmthTiltDb,
    ctx.currentTime,
    true
  );

  inputNode.connect(satInputGain);
  satInputGain.connect(waveShaperA);
  satInputGain.connect(waveShaperB);
  waveShaperA.connect(shaperGainA);
  waveShaperB.connect(shaperGainB);
  shaperGainA.connect(dcBlocker);
  shaperGainB.connect(dcBlocker);
  dcBlocker.connect(warmthTilt);
  warmthTilt.connect(satOutputTrim);

  const humanizerStage = ForensicHumanizerDSP.createControllableHumanizerStage(
    ctx,
    initialChain.forensicHumanizer ?? DEFAULT_FORENSIC_HUMANIZER_CONFIG
  );
  satOutputTrim.connect(humanizerStage.inputNode);

  const updatePostCompressor = (chain: MasteringDspChain, now: number) => {
    updateSaturationState(
      chain.saturation.type,
      chain.saturation.drive,
      chain.saturation.warmthTiltDb,
      now,
      false
    );
    if (chain.forensicHumanizer) {
      humanizerStage.updateConfig(chain.forensicHumanizer, now);
    }
  };

  return {
    inputNode,
    outputNode: humanizerStage.outputNode,
    updatePostCompressor,
    dispose: () => humanizerStage.dispose(),
  };
}

/**
 * Builds the full live 6-stage Studio Mastering DSP graph using our pure-TS AudioWorklets
 * for Bus Compression (Stage 4A) and Lookahead True Peak Limiting (Stage 5).
 */
export function buildMasteringDspGraph(
  ctx: BaseAudioContext,
  initialChain: MasteringDspChain,
  initialMakeupDriveDb = 0
): MasteringGraphHandles {
  const preStages = buildPreCompressorStages(ctx, initialChain);
  const postStages = buildPostCompressorStages(ctx, initialChain);
  const outputNode = ctx.createGain();

  let compWorkletNode: AudioWorkletNode | null = null;
  let limiterWorkletNode: AudioWorkletNode | null = null;
  let compGrDb = 0;
  let limGrDb = 0;

  const canCreateWorklet =
    typeof AudioWorkletNode !== 'undefined' && registeredDynamicsCtx.has(ctx);

  if (canCreateWorklet) {
    try {
      const isInitBypass = (initialChain.intensityScale ?? 1) <= 0.005;
      compWorkletNode = new AudioWorkletNode(ctx, 'mastering-bus-compressor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          initialParams: buildBusCompressorParams(initialChain),
          initialBypass: isInitBypass || initialChain.compressor.parallelMix <= 0.005,
        },
      });
      compWorkletNode.port.onmessage = (
        ev: MessageEvent<{ type: string; grDb?: number }>
      ) => {
        if (ev.data?.type === 'gr' && typeof ev.data.grDb === 'number') {
          compGrDb = ev.data.grDb;
        }
      };

      limiterWorkletNode = new AudioWorkletNode(
        ctx,
        'mastering-lookahead-limiter',
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: {
            initialParams: buildLookaheadLimiterParams(initialChain, initialMakeupDriveDb),
            initialBypass: false,
          },
        }
      );
      limiterWorkletNode.port.onmessage = (
        ev: MessageEvent<{ type: string; grDb?: number }>
      ) => {
        if (ev.data?.type === 'gr' && typeof ev.data.grDb === 'number') {
          limGrDb = ev.data.grDb;
        }
      };
    } catch {
      compWorkletNode = null;
      limiterWorkletNode = null;
    }
  }

  // Fallback safety dynamics + brickwall clipper if worklet module isn't available yet
  const fallbackDriveGain = ctx.createGain();
  fallbackDriveGain.gain.value = Math.pow(10, Math.min(12, initialMakeupDriveDb) / 20);
  const fallbackSafetyComp = ctx.createDynamicsCompressor();
  fallbackSafetyComp.threshold.value = -2.0;
  fallbackSafetyComp.knee.value = 2.0;
  fallbackSafetyComp.ratio.value = 16;
  fallbackSafetyComp.attack.value = 0.001;
  fallbackSafetyComp.release.value = 0.06;
  const fallbackBrickwallShaper = ctx.createWaveShaper();
  fallbackBrickwallShaper.oversample = '4x';
  fallbackBrickwallShaper.curve = createBrickwallMaximizerCurve(
    initialChain.limiter.ceilingDbTp,
    initialChain.limiter.softClipPrePct ?? 0.25
  );
  let lastFallbackCeiling = initialChain.limiter.ceilingDbTp;

  if (compWorkletNode && limiterWorkletNode) {
    preStages.outputNode.connect(compWorkletNode);
    compWorkletNode.connect(postStages.inputNode);
    postStages.outputNode.connect(limiterWorkletNode);
    limiterWorkletNode.connect(outputNode);
  } else {
    preStages.outputNode.connect(postStages.inputNode);
    postStages.outputNode.connect(fallbackDriveGain);
    fallbackDriveGain.connect(fallbackSafetyComp);
    fallbackSafetyComp.connect(fallbackBrickwallShaper);
    fallbackBrickwallShaper.connect(outputNode);
  }

  const syncWorklets = (chain: MasteringDspChain, driveDb: number) => {
    const isTrueBypass = (chain.intensityScale ?? 1) <= 0.005;
    if (compWorkletNode) {
      compWorkletNode.port.postMessage({
        type: 'config',
        params: buildBusCompressorParams(chain),
        bypass: isTrueBypass || chain.compressor.parallelMix <= 0.005,
      });
    }
    if (limiterWorkletNode) {
      limiterWorkletNode.port.postMessage({
        type: 'config',
        params: buildLookaheadLimiterParams(chain, driveDb),
        bypass: false,
      });
    }
    fallbackDriveGain.gain.value = isTrueBypass
      ? 1.0
      : Math.pow(10, Math.max(-18, Math.min(16, driveDb)) / 20);
    if (
      !limiterWorkletNode &&
      Math.abs(chain.limiter.ceilingDbTp - lastFallbackCeiling) > 0.05
    ) {
      lastFallbackCeiling = chain.limiter.ceilingDbTp;
      fallbackBrickwallShaper.curve = createBrickwallMaximizerCurve(
        chain.limiter.ceilingDbTp,
        chain.limiter.softClipPrePct ?? 0.25
      );
    }
  };

  syncWorklets(initialChain, initialMakeupDriveDb);

  const applyDspChain = (
    chain: MasteringDspChain,
    driveDb: number,
    now = ctx.currentTime
  ) => {
    preStages.updatePreCompressor(chain, now);
    postStages.updatePostCompressor(chain, now);
    syncWorklets(chain, driveDb);
  };

  return {
    inputNode: preStages.inputNode,
    drumLayerBusInput: preStages.drumLayerBusInput,
    transientDuckHandles: preStages.transientDuckHandles,
    outputNode,
    midSideMatrix: preStages.midSideMatrix,
    compWorkletNode,
    limiterWorkletNode,
    getLiveGainReduction: () => ({ compGrDb, limGrDb }),
    resetDynamics: () => {
      compGrDb = 0;
      limGrDb = 0;
      compWorkletNode?.port.postMessage({ type: 'reset' });
      limiterWorkletNode?.port.postMessage({ type: 'reset' });
    },
    applyDspChain,
    dispose: () => {
      postStages.dispose();
      try {
        if (compWorkletNode) {
          compWorkletNode.port.onmessage = null;
          compWorkletNode.disconnect();
        }
        if (limiterWorkletNode) {
          limiterWorkletNode.port.onmessage = null;
          limiterWorkletNode.disconnect();
        }
        outputNode.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
