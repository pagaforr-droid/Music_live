import type { EQBandConfig, MasteringDspChain } from '../types/mastering.types';
import {
  computeSaturationGainStaging,
  generateAnalogSaturationCurve,
} from './AnalogSaturationCurves';
import {
  DEFAULT_FORENSIC_HUMANIZER_CONFIG,
  ForensicHumanizerDSP,
} from './ForensicHumanizerDSP';
import type { TransientDuckHandles } from './DrumTransientReplacerDSP';
import {
  createMidSideMatrix,
  type MidSideMatrixHandles,
} from './MidSideMatrix';
import { createBrickwallMaximizerCurve } from './TruePeakLimiter';

export interface MasteringGraphHandles {
  inputNode: GainNode;
  /** Bus de inyección para las capas acústicas de Kick/Snare (antes del Compresor Bus Glue) */
  drumLayerBusInput: GainNode;
  /** Filtros de Ducking Quirúrgico para atenuar la transiente sintética original en cada golpe */
  transientDuckHandles: TransientDuckHandles;
  outputNode: GainNode;
  busCompressor: DynamicsCompressorNode;
  maximizerSafetyLimiter: DynamicsCompressorNode;
  midSideMatrix: MidSideMatrixHandles;
  applyDspChain: (
    chain: MasteringDspChain,
    autoMakeupGainDb: number,
    now?: number
  ) => void;
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

function computeAdaptiveCompressorMakeupLinear(
  chain: MasteringDspChain
): number {
  const extraCompMakeupDb = Math.max(
    0,
    (-16 - chain.compressor.thresholdDb) *
      (1 - 1 / Math.max(1.1, chain.compressor.ratio)) *
      0.35
  );
  const totalMakeupDb = Math.max(
    0,
    Math.min(9, chain.compressor.makeupGainDb + extraCompMakeupDb)
  );
  return Math.pow(10, totalMakeupDb / 20);
}

/**
 * Builds the complete 6-stage Studio Mastering DSP chain on any BaseAudioContext
 * (works identically for live AudioContext and 48kHz OfflineAudioContext).
 */
export function buildMasteringDspGraph(
  ctx: BaseAudioContext,
  initialChain: MasteringDspChain,
  initialAutoMakeupDb = 0
): MasteringGraphHandles {
  const inputNode = ctx.createGain();
  const outputNode = ctx.createGain();

  // =========================================================================
  // STAGE 2: Subtractive Surgery (Subsonic HPF + Stereo De-Mud / De-AI Notches)
  // =========================================================================
  const subsonicHpf = ctx.createBiquadFilter();
  subsonicHpf.type = 'highpass';
  subsonicHpf.frequency.value = Math.max(
    18,
    Math.min(60, initialChain.highPassFreq)
  );
  subsonicHpf.Q.value = Math.SQRT1_2; // Butterworth 0.7071

  inputNode.connect(subsonicHpf);
  let lastStage2Node: AudioNode = subsonicHpf;

  // Pre-allocate all band IDs in stereoBandFilters so switching any band between
  // 'stereo', 'mid', and 'side' works 100% seamlessly in live playback and export.
  const stereoBandFilters = new Map<string, BiquadFilterNode>();
  for (const band of initialChain.eqBands) {
    const filter = ctx.createBiquadFilter();
    configureStereoFilterNode(filter, band);
    lastStage2Node.connect(filter);
    lastStage2Node = filter;
    stereoBandFilters.set(band.id, filter);
  }

  // Stage 2B: Bank of 4 Ultra-Narrow Surgical Resonance Notches ("Spectral Line Killer", Q=10..16)
  const MAX_RESONANCE_NOTCHES = 4;
  const resonanceNotchFilters: BiquadFilterNode[] = [];
  const initialNotches = initialChain.resonanceNotches || [];
  for (let i = 0; i < MAX_RESONANCE_NOTCHES; i++) {
    const notchNode = ctx.createBiquadFilter();
    notchNode.type = 'peaking';
    const spec = initialNotches[i];
    const freqVal = spec ? Math.max(120, Math.min(18000, spec.freqHz)) : 3800 + i * 900;
    const qVal = spec ? Math.max(4, Math.min(24, spec.q)) : 12.0;
    const gainVal =
      spec && spec.enabled && Math.abs(spec.gainCutDb) > 0.05
        ? Math.max(-14, Math.min(0, spec.gainCutDb))
        : 0;
    notchNode.frequency.value = freqVal;
    notchNode.Q.value = qVal;
    notchNode.gain.value = gainVal;
    lastStage2Node.connect(notchNode);
    lastStage2Node = notchNode;
    resonanceNotchFilters.push(notchNode);
  }

  // Stage 2C: Sub-Mud Suppressor when Drum Layering is active ("Suppress AI Sub-Mud")
  const drumMudSuppressFilter = ctx.createBiquadFilter();
  drumMudSuppressFilter.type = 'peaking';
  drumMudSuppressFilter.frequency.value = 78;
  drumMudSuppressFilter.Q.value = 1.65;
  drumMudSuppressFilter.gain.value =
    initialChain.drumLayering?.enabled &&
    initialChain.drumLayering?.suppressOriginalMud
      ? -3.2 * Math.max(0.35, initialChain.drumLayering.kickMix)
      : 0;
  lastStage2Node.connect(drumMudSuppressFilter);
  lastStage2Node = drumMudSuppressFilter;

  // =========================================================================
  // STAGE 3: True Mid/Side Matrix + Mono Maker + Mid/Side EQ + Stereo Width
  // =========================================================================
  const midSideMatrix = createMidSideMatrix(
    ctx,
    initialChain.monoMakerFreq,
    initialChain.stereoWidth.sideGainDb,
    initialChain.eqBands
  );

  lastStage2Node.connect(midSideMatrix.inputNode);

  // Filtros de Ducking Quirúrgico para Reemplazo Real de Transientes (Kick 72Hz / Snare 245Hz)
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

  // Bus where Sample-Accurate Acoustic Drum Layers (Kick/Snare) are injected
  // so they glue together with the mix inside Stage 4A Bus Compressor & Stage 4B Tape Saturator
  const drumLayerBusInput = ctx.createGain();
  drumLayerBusInput.gain.value = 1.0;
  const preGlueSumBus = ctx.createGain();
  preGlueSumBus.gain.value = 1.0;

  midSideMatrix.outputNode.connect(kickDuckFilter);
  kickDuckFilter.connect(snareDuckFilter);
  snareDuckFilter.connect(preGlueSumBus);
  drumLayerBusInput.connect(preGlueSumBus);

  // =========================================================================
  // STAGE 4A: SSL-Style Bus Glue Compressor with Parallel Dry/Wet Blend
  // =========================================================================
  const busCompressor = ctx.createDynamicsCompressor();
  busCompressor.threshold.value = initialChain.compressor.thresholdDb;
  busCompressor.ratio.value = initialChain.compressor.ratio;
  busCompressor.attack.value = initialChain.compressor.attackSec;
  busCompressor.release.value = initialChain.compressor.releaseSec;
  busCompressor.knee.value = initialChain.compressor.kneeDb;

  const compMakeupGain = ctx.createGain();
  const compWetMix = ctx.createGain();
  const compDryMix = ctx.createGain();
  const stage4ASum = ctx.createGain();

  const initialWet = Math.max(
    0,
    Math.min(1, initialChain.compressor.parallelMix)
  );
  compMakeupGain.gain.value = computeAdaptiveCompressorMakeupLinear(initialChain);
  compWetMix.gain.value = initialWet;
  compDryMix.gain.value = 1 - initialWet;

  preGlueSumBus.connect(busCompressor);
  busCompressor.connect(compMakeupGain);
  compMakeupGain.connect(compWetMix);
  compWetMix.connect(stage4ASum);

  preGlueSumBus.connect(compDryMix);
  compDryMix.connect(stage4ASum);

  // =========================================================================
  // STAGE 4B: 4x Oversampled Analog Saturator + Warmth Tilt + 18Hz DC Blocker
  // =========================================================================
  const satInputGain = ctx.createGain();
  const waveShaper = ctx.createWaveShaper();
  waveShaper.oversample = '4x';
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
    now: number
  ) => {
    const sig = `${type}:${drive.toFixed(3)}`;
    if (sig !== currentSatSignature) {
      waveShaper.curve = generateAnalogSaturationCurve(type, drive);
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
    ctx.currentTime
  );

  stage4ASum.connect(satInputGain);
  satInputGain.connect(waveShaper);
  waveShaper.connect(dcBlocker);
  dcBlocker.connect(warmthTilt);
  warmthTilt.connect(satOutputTrim);

  // =========================================================================
  // STAGE 5: Dual-Stage Maximizer & True Peak Ceiling Guard (-1.0 dBTP)
  // =========================================================================
  const maximizerDriveGain = ctx.createGain();
  const maximizerSafetyLimiter = ctx.createDynamicsCompressor();
  maximizerSafetyLimiter.threshold.value = Math.max(
    -6.0,
    initialChain.limiter.ceilingDbTp - 0.6
  );
  maximizerSafetyLimiter.knee.value = 2.5;
  maximizerSafetyLimiter.ratio.value = 16.0;
  maximizerSafetyLimiter.attack.value = 0.001;
  maximizerSafetyLimiter.release.value = Math.max(
    0.025,
    initialChain.limiter.releaseMs / 1000
  );

  const brickwallShaper = ctx.createWaveShaper();
  brickwallShaper.oversample = '4x';

  let currentLimiterSig = '';
  const updateLimiterState = (
    ceilingDbTp: number,
    softClipPrePct: number,
    releaseMs: number,
    totalDriveDb: number,
    now: number
  ) => {
    const sig = `${ceilingDbTp.toFixed(2)}:${softClipPrePct.toFixed(2)}`;
    if (sig !== currentLimiterSig) {
      brickwallShaper.curve = createBrickwallMaximizerCurve(
        ceilingDbTp,
        softClipPrePct
      );
      currentLimiterSig = sig;
    }
    const clampedDriveDb = Math.max(-9, Math.min(13, totalDriveDb));
    const driveLinear = Math.pow(10, clampedDriveDb / 20);
    const releaseSec = Math.max(0.02, Math.min(0.4, releaseMs / 1000));
    const safetyThreshDb = Math.max(-6.0, ceilingDbTp - 0.6);

    maximizerDriveGain.gain.value = driveLinear;
    maximizerDriveGain.gain.setTargetAtTime(driveLinear, now, 0.012);

    maximizerSafetyLimiter.threshold.value = safetyThreshDb;
    maximizerSafetyLimiter.threshold.setTargetAtTime(safetyThreshDb, now, 0.012);

    maximizerSafetyLimiter.release.value = releaseSec;
    maximizerSafetyLimiter.release.setTargetAtTime(releaseSec, now, 0.012);
  };

  updateLimiterState(
    initialChain.limiter.ceilingDbTp,
    initialChain.limiter.softClipPrePct,
    initialChain.limiter.releaseMs,
    initialAutoMakeupDb,
    ctx.currentTime
  );

  // =========================================================================
  // STAGE 4C: Forensic Anti-AI Humanizer (Sub-Energy Rebalancer, Stereo-Linked
  // All-Pass Phase Disperser, Studer Micro-Drift, 14-22kHz Harmonic Exciter,
  // Balanced Early Reflections & Thermal Floor)
  // =========================================================================
  const humanizerStage = ForensicHumanizerDSP.createControllableHumanizerStage(
    ctx,
    initialChain.forensicHumanizer ?? DEFAULT_FORENSIC_HUMANIZER_CONFIG
  );

  satOutputTrim.connect(humanizerStage.inputNode);
  humanizerStage.outputNode.connect(maximizerDriveGain);
  maximizerDriveGain.connect(maximizerSafetyLimiter);
  maximizerSafetyLimiter.connect(brickwallShaper);
  brickwallShaper.connect(outputNode);

  const applyDspChain = (
    chain: MasteringDspChain,
    autoMakeupGainDb: number,
    now = ctx.currentTime
  ) => {
    // Stage 2: Subsonic HPF & All EQ Bands (Stereo + Mid + Side)
    const clampedHpf = Math.max(18, Math.min(60, chain.highPassFreq));
    subsonicHpf.frequency.value = clampedHpf;
    subsonicHpf.frequency.setTargetAtTime(clampedHpf, now, 0.012);

    for (const band of chain.eqBands) {
      const stereoNode = stereoBandFilters.get(band.id);
      if (stereoNode) {
        configureStereoFilterNode(stereoNode, band, now);
      }
      midSideMatrix.updateBand(band, now);
    }

    // Stage 2B: Update Ultra-Narrow Surgical Resonance Notches
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

    // Stage 2C: Sub-Mud Suppressor for Drum Layering
    const mudSuppressDb =
      chain.drumLayering?.enabled && chain.drumLayering?.suppressOriginalMud
        ? -3.2 * Math.max(0.35, chain.drumLayering.kickMix)
        : 0;
    drumMudSuppressFilter.gain.value = mudSuppressDb;
    drumMudSuppressFilter.gain.setTargetAtTime(mudSuppressDb, now, 0.012);

    // Stage 3: Mono Maker & Side Width
    midSideMatrix.updateMonoMakerFreq(chain.monoMakerFreq, now);
    midSideMatrix.updateSideGainDb(chain.stereoWidth.sideGainDb, now);

    // Stage 4A: Compressor
    busCompressor.threshold.value = chain.compressor.thresholdDb;
    busCompressor.ratio.value = chain.compressor.ratio;
    busCompressor.attack.value = chain.compressor.attackSec;
    busCompressor.release.value = chain.compressor.releaseSec;
    busCompressor.knee.value = chain.compressor.kneeDb;

    busCompressor.threshold.setTargetAtTime(
      chain.compressor.thresholdDb,
      now,
      0.012
    );
    busCompressor.ratio.setTargetAtTime(chain.compressor.ratio, now, 0.012);
    busCompressor.attack.setTargetAtTime(
      chain.compressor.attackSec,
      now,
      0.012
    );
    busCompressor.release.setTargetAtTime(
      chain.compressor.releaseSec,
      now,
      0.012
    );
    busCompressor.knee.setTargetAtTime(chain.compressor.kneeDb, now, 0.012);

    const wet = Math.max(0, Math.min(1, chain.compressor.parallelMix));
    const makeupLinear = computeAdaptiveCompressorMakeupLinear(chain);
    compMakeupGain.gain.value = makeupLinear;
    compWetMix.gain.value = wet;
    compDryMix.gain.value = 1 - wet;

    compMakeupGain.gain.setTargetAtTime(makeupLinear, now, 0.012);
    compWetMix.gain.setTargetAtTime(wet, now, 0.012);
    compDryMix.gain.setTargetAtTime(1 - wet, now, 0.012);

    // Stage 4B: Saturator
    updateSaturationState(
      chain.saturation.type,
      chain.saturation.drive,
      chain.saturation.warmthTiltDb,
      now
    );

    // Stage 4C: Forensic Anti-AI Humanizer
    if (chain.forensicHumanizer) {
      humanizerStage.updateConfig(chain.forensicHumanizer, now);
    }

    // Stage 5: Maximizer & Brickwall Limiter
    updateLimiterState(
      chain.limiter.ceilingDbTp,
      chain.limiter.softClipPrePct,
      chain.limiter.releaseMs,
      autoMakeupGainDb,
      now
    );
  };

  return {
    inputNode,
    drumLayerBusInput,
    transientDuckHandles: { kickDuckFilter, snareDuckFilter },
    outputNode,
    busCompressor,
    maximizerSafetyLimiter,
    midSideMatrix,
    applyDspChain,
  };
}
