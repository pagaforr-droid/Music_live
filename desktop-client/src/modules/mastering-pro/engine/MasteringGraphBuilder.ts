import type { MasteringDspChain } from '../types/mastering.types';
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
  subsonicHpf.frequency.value = initialChain.highPassFreq;
  subsonicHpf.Q.value = Math.SQRT1_2; // Butterworth 0.7071

  inputNode.connect(subsonicHpf);
  let lastStage2Node: AudioNode = subsonicHpf;

  const stereoBandFilters = new Map<string, BiquadFilterNode>();
  const stereoBands = initialChain.eqBands.filter(
    (b) => b.channel === 'stereo'
  );
  for (const band of stereoBands) {
    const filter = ctx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.freq;
    filter.Q.value = band.q;
    filter.gain.value = band.enabled === false ? 0 : band.gainDb;
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
    notchNode.frequency.value = spec ? spec.freqHz : 3800 + i * 900;
    notchNode.Q.value = spec ? spec.q : 12.0;
    notchNode.gain.value = spec && spec.enabled ? spec.gainCutDb : 0;
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

  const initialWet = Math.max(0, Math.min(1, initialChain.compressor.parallelMix));
  compMakeupGain.gain.value = Math.pow(
    10,
    initialChain.compressor.makeupGainDb / 20
  );
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
    satInputGain.gain.setTargetAtTime(inputGainLinear, now, 0.015);
    satOutputTrim.gain.setTargetAtTime(outputTrimLinear, now, 0.015);
    warmthTilt.gain.setTargetAtTime(tiltDb, now, 0.015);
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
  maximizerSafetyLimiter.threshold.value = -2.2;
  maximizerSafetyLimiter.knee.value = 3.0;
  maximizerSafetyLimiter.ratio.value = 14.0;
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
    maximizerDriveGain.gain.setTargetAtTime(
      Math.pow(10, clampedDriveDb / 20),
      now,
      0.015
    );
    maximizerSafetyLimiter.release.setTargetAtTime(
      Math.max(0.02, Math.min(0.4, releaseMs / 1000)),
      now,
      0.015
    );
  };

  updateLimiterState(
    initialChain.limiter.ceilingDbTp,
    initialChain.limiter.softClipPrePct,
    initialChain.limiter.releaseMs,
    initialAutoMakeupDb,
    ctx.currentTime
  );

  // =========================================================================
  // STAGE 4C: Forensic Anti-AI Humanizer (Sub-Energy Rebalancer, All-Pass Phase
  // Disperser, Studer Micro-Drift, 14-22kHz Harmonic Exciter, Early Reflections & Thermal Floor)
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
    // Stage 2: Subsonic HPF & Stereo Bands
    subsonicHpf.frequency.setTargetAtTime(chain.highPassFreq, now, 0.015);
    for (const band of chain.eqBands) {
      if (band.channel === 'stereo') {
        const node = stereoBandFilters.get(band.id);
        if (node) {
          if (node.type !== band.type) {
            node.type = band.type;
          }
          node.frequency.setTargetAtTime(band.freq, now, 0.015);
          node.Q.setTargetAtTime(band.q, now, 0.015);
          node.gain.setTargetAtTime(
            band.enabled === false ? 0 : band.gainDb,
            now,
            0.015
          );
        }
      } else {
        midSideMatrix.updateBand(band, now);
      }
    }

    // Stage 2B: Update Ultra-Narrow Surgical Resonance Notches
    const activeNotches = chain.resonanceNotches || [];
    for (let i = 0; i < MAX_RESONANCE_NOTCHES; i++) {
      const node = resonanceNotchFilters[i];
      const spec = activeNotches[i];
      if (spec && spec.enabled && Math.abs(spec.gainCutDb) > 0.05) {
        node.frequency.setTargetAtTime(
          Math.max(120, Math.min(18000, spec.freqHz)),
          now,
          0.015
        );
        node.Q.setTargetAtTime(Math.max(4, Math.min(24, spec.q)), now, 0.015);
        node.gain.setTargetAtTime(
          Math.max(-14, Math.min(0, spec.gainCutDb)),
          now,
          0.015
        );
      } else {
        node.gain.setTargetAtTime(0, now, 0.015);
      }
    }

    // Stage 2C: Sub-Mud Suppressor for Drum Layering
    const mudSuppressDb =
      chain.drumLayering?.enabled && chain.drumLayering?.suppressOriginalMud
        ? -3.2 * Math.max(0.35, chain.drumLayering.kickMix)
        : 0;
    drumMudSuppressFilter.gain.setTargetAtTime(mudSuppressDb, now, 0.015);

    // Stage 3: Mono Maker & Side Width
    midSideMatrix.updateMonoMakerFreq(chain.monoMakerFreq, now);
    midSideMatrix.updateSideGainDb(chain.stereoWidth.sideGainDb, now);

    // Stage 4A: Compressor
    busCompressor.threshold.setTargetAtTime(
      chain.compressor.thresholdDb,
      now,
      0.015
    );
    busCompressor.ratio.setTargetAtTime(chain.compressor.ratio, now, 0.015);
    busCompressor.attack.setTargetAtTime(
      chain.compressor.attackSec,
      now,
      0.015
    );
    busCompressor.release.setTargetAtTime(
      chain.compressor.releaseSec,
      now,
      0.015
    );
    busCompressor.knee.setTargetAtTime(chain.compressor.kneeDb, now, 0.015);

    const wet = Math.max(0, Math.min(1, chain.compressor.parallelMix));
    compMakeupGain.gain.setTargetAtTime(
      Math.pow(10, chain.compressor.makeupGainDb / 20),
      now,
      0.015
    );
    compWetMix.gain.setTargetAtTime(wet, now, 0.015);
    compDryMix.gain.setTargetAtTime(1 - wet, now, 0.015);

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
