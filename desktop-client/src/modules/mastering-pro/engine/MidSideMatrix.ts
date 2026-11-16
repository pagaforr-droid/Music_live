import type { EQBandConfig } from '../types/mastering.types';

export interface MidSideMatrixHandles {
  inputNode: GainNode;
  outputNode: GainNode;
  monoMakerFilter: BiquadFilterNode;
  sideWidthGain: GainNode;
  midBandFilters: Map<string, BiquadFilterNode>;
  sideBandFilters: Map<string, BiquadFilterNode>;
  updateMonoMakerFreq: (freqHz: number, now: number) => void;
  updateSideGainDb: (sideGainDb: number, now: number) => void;
  updateBand: (band: EQBandConfig, now: number) => void;
}

function lockMonoDiscrete(node: AudioNode): void {
  node.channelCount = 1;
  node.channelCountMode = 'explicit';
  node.channelInterpretation = 'discrete';
}

function configureFilterForChannel(
  node: BiquadFilterNode,
  band: EQBandConfig,
  targetChannel: 'mid' | 'side',
  now?: number
): void {
  const isActiveOnChannel =
    band.channel === targetChannel && band.enabled !== false;
  const effectiveType: BiquadFilterType = isActiveOnChannel
    ? band.type
    : 'peaking';
  const clampedFreq = Math.max(20, Math.min(20000, band.freq));
  const clampedQ = Math.max(0.2, Math.min(24, band.q));
  const effectiveGain = isActiveOnChannel ? band.gainDb : 0;

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

/**
 * Builds a true studio Mid/Side encode -> process -> decode matrix on any BaseAudioContext.
 *
 * Mathematical Law:
 *   Mid  = 0.5 * L + 0.5 * R
 *   Side = 0.5 * L - 0.5 * R
 *   L_out = Mid + Side
 *   R_out = Mid - Side
 *
 * Includes a dedicated Butterworth (Q = 0.7071) High-Pass filter ("Mono Maker")
 * exclusively on the Side channel so all sub-bass energy below monoMakerFreq is 100% centered.
 */
export function createMidSideMatrix(
  ctx: BaseAudioContext,
  initialMonoMakerFreq: number,
  initialSideGainDb: number,
  eqBands: EQBandConfig[]
): MidSideMatrixHandles {
  const inputNode = ctx.createGain();
  inputNode.channelCount = 2;
  inputNode.channelCountMode = 'explicit';

  const outputNode = ctx.createGain();
  outputNode.channelCount = 2;
  outputNode.channelCountMode = 'explicit';

  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);

  // Encode network: L and R scaled by +0.5 / -0.5
  const lToMid = ctx.createGain();
  const rToMid = ctx.createGain();
  const lToSide = ctx.createGain();
  const rToSideInvert = ctx.createGain();

  lockMonoDiscrete(lToMid);
  lockMonoDiscrete(rToMid);
  lockMonoDiscrete(lToSide);
  lockMonoDiscrete(rToSideInvert);

  lToMid.gain.value = 0.5;
  rToMid.gain.value = 0.5;
  lToSide.gain.value = 0.5;
  rToSideInvert.gain.value = -0.5;

  const midSum = ctx.createGain();
  const sideSum = ctx.createGain();
  lockMonoDiscrete(midSum);
  lockMonoDiscrete(sideSum);

  inputNode.connect(splitter);
  // Channel 0 = Left, Channel 1 = Right
  splitter.connect(lToMid, 0);
  splitter.connect(rToMid, 1);
  splitter.connect(lToSide, 0);
  splitter.connect(rToSideInvert, 1);

  lToMid.connect(midSum);
  rToMid.connect(midSum);
  lToSide.connect(sideSum);
  rToSideInvert.connect(sideSum);

  // --- MID PROCESSING CHAIN (All Band IDs pre-allocated so channel switching is 100% seamless) ---
  const midBandFilters = new Map<string, BiquadFilterNode>();
  let lastMidNode: AudioNode = midSum;

  for (const band of eqBands) {
    const filter = ctx.createBiquadFilter();
    lockMonoDiscrete(filter);
    configureFilterForChannel(filter, band, 'mid');
    lastMidNode.connect(filter);
    lastMidNode = filter;
    midBandFilters.set(band.id, filter);
  }

  // --- SIDE PROCESSING CHAIN ---
  // 1. Mono Maker High-Pass Filter on Side channel only (Butterworth Q = 0.7071)
  const monoMakerFilter = ctx.createBiquadFilter();
  lockMonoDiscrete(monoMakerFilter);
  monoMakerFilter.type = 'highpass';
  monoMakerFilter.frequency.value = Math.max(
    30,
    Math.min(250, initialMonoMakerFreq)
  );
  monoMakerFilter.Q.value = Math.SQRT1_2; // 0.7071 Butterworth (zero resonant bump)

  sideSum.connect(monoMakerFilter);
  let lastSideNode: AudioNode = monoMakerFilter;

  // 2. Side EQ Bands (All Band IDs pre-allocated so channel switching is 100% seamless)
  const sideBandFilters = new Map<string, BiquadFilterNode>();
  for (const band of eqBands) {
    const filter = ctx.createBiquadFilter();
    lockMonoDiscrete(filter);
    configureFilterForChannel(filter, band, 'side');
    lastSideNode.connect(filter);
    lastSideNode = filter;
    sideBandFilters.set(band.id, filter);
  }

  // 3. Stereo Width Side Gain (-36dB or lower => true digital Mono 0.0)
  const sideWidthGain = ctx.createGain();
  lockMonoDiscrete(sideWidthGain);
  sideWidthGain.gain.value =
    initialSideGainDb <= -36
      ? 0.0
      : Math.pow(10, Math.max(-36, Math.min(9, initialSideGainDb)) / 20);
  lastSideNode.connect(sideWidthGain);

  // --- DECODE NETWORK: L = Mid + Side, R = Mid - Side ---
  const midToLeft = ctx.createGain();
  const sideToLeft = ctx.createGain();
  const midToRight = ctx.createGain();
  const sideToRightInvert = ctx.createGain();

  lockMonoDiscrete(midToLeft);
  lockMonoDiscrete(sideToLeft);
  lockMonoDiscrete(midToRight);
  lockMonoDiscrete(sideToRightInvert);

  midToLeft.gain.value = 1.0;
  sideToLeft.gain.value = 1.0;
  midToRight.gain.value = 1.0;
  sideToRightInvert.gain.value = -1.0;

  lastMidNode.connect(midToLeft);
  lastMidNode.connect(midToRight);
  sideWidthGain.connect(sideToLeft);
  sideWidthGain.connect(sideToRightInvert);

  // Merge back to Stereo L (input 0) and R (input 1)
  midToLeft.connect(merger, 0, 0);
  sideToLeft.connect(merger, 0, 0);
  midToRight.connect(merger, 0, 1);
  sideToRightInvert.connect(merger, 0, 1);

  merger.connect(outputNode);

  return {
    inputNode,
    outputNode,
    monoMakerFilter,
    sideWidthGain,
    midBandFilters,
    sideBandFilters,
    updateMonoMakerFreq: (freqHz: number, now: number) => {
      const clamped = Math.max(30, Math.min(250, freqHz));
      monoMakerFilter.frequency.value = clamped;
      monoMakerFilter.frequency.setTargetAtTime(clamped, now, 0.012);
    },
    updateSideGainDb: (sideGainDb: number, now: number) => {
      const linear =
        sideGainDb <= -36
          ? 0.0
          : Math.pow(10, Math.max(-36, Math.min(9, sideGainDb)) / 20);
      sideWidthGain.gain.value = linear;
      sideWidthGain.gain.setTargetAtTime(linear, now, 0.012);
    },
    updateBand: (band: EQBandConfig, now: number) => {
      const midNode = midBandFilters.get(band.id);
      if (midNode) {
        configureFilterForChannel(midNode, band, 'mid', now);
      }
      const sideNode = sideBandFilters.get(band.id);
      if (sideNode) {
        configureFilterForChannel(sideNode, band, 'side', now);
      }
    },
  };
}
