import {
  StreamingTruePeakDetector,
  TRUE_PEAK_FIR_GROUP_DELAY,
  linearToDbTp,
  measureTruePeakLinear4x,
} from './TruePeakDetector';

/**
 * Pure TypeScript Mastering-Grade True-Peak Lookahead Brickwall Limiter Core.
 *
 * Design principles:
 * - Zero static tanh distortion in the passband (100% linear below ceiling).
 * - 4x Polyphase FIR True-Peak detection (catches inter-sample overshoots accurately).
 * - O(1) monotonic deque sliding-window minimum over the lookahead horizon so gain dips
 *   smoothly BEFORE transients hit, eliminating clicks and harmonic distortion.
 * - Program-dependent adaptive dual release (fast transient recovery + smooth sustain).
 * - Runs bit-identically in Live AudioWorklet AND Offline 2-Pass Export.
 */

export interface LookaheadLimiterParams {
  driveDb: number;
  ceilingDbTp: number;
  lookaheadMs: number;
  releaseMs: number;
}

const MAX_DELAY_SAMPLES = 2048; // up to ~42ms @ 48kHz (well above max 15ms lookahead)

export class LookaheadLimiterCore {
  private readonly sampleRate: number;
  private readonly tpDetector = new StreamingTruePeakDetector();

  // Audio delay ring buffer
  private readonly delayL = new Float32Array(MAX_DELAY_SAMPLES);
  private readonly delayR = new Float32Array(MAX_DELAY_SAMPLES);
  // Delayed required gain ring (aligned with True Peak FIR group delay)
  private readonly reqGainDelay = new Float32Array(MAX_DELAY_SAMPLES);
  private writeIdx = 0;

  // Monotonic queue for O(1) sliding window minimum over lookaheadSamples
  private readonly dequeVal = new Float32Array(MAX_DELAY_SAMPLES);
  private readonly dequeIdx = new Int32Array(MAX_DELAY_SAMPLES);
  private dqHead = 0;
  private dqTail = 0;
  private sampleCounter = 0;

  private delaySamples = 240;
  private lookaheadSamples = 235;
  private driveLinear = 1.0;
  private ceilingLinear = Math.pow(10, -1.03 / 20);
  private attackCoeff = 0.92;
  private releaseCoeffFast = 0.99;
  private releaseCoeffSlow = 0.999;

  private smoothedGain = 1.0;
  private fastReleaseState = 1.0;
  private slowReleaseState = 1.0;
  private lastMaxGrDb = 0;

  private params: LookaheadLimiterParams = {
    driveDb: 0,
    ceilingDbTp: -1.0,
    lookaheadMs: 5.0,
    releaseMs: 65,
  };

  constructor(sampleRate: number, initialParams?: Partial<LookaheadLimiterParams>) {
    this.sampleRate = Math.max(8000, sampleRate);
    this.reqGainDelay.fill(1.0);
    this.updateParams({
      driveDb: initialParams?.driveDb ?? 0,
      ceilingDbTp: initialParams?.ceilingDbTp ?? -1.0,
      lookaheadMs: initialParams?.lookaheadMs ?? 5.0,
      releaseMs: initialParams?.releaseMs ?? 65,
    });
  }

  public reset(): void {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.reqGainDelay.fill(1.0);
    this.writeIdx = 0;
    this.dqHead = 0;
    this.dqTail = 0;
    this.sampleCounter = 0;
    this.smoothedGain = 1.0;
    this.fastReleaseState = 1.0;
    this.slowReleaseState = 1.0;
    this.lastMaxGrDb = 0;
    this.tpDetector.reset();
  }

  public updateParams(next: LookaheadLimiterParams): void {
    const clampedDrive = Math.max(-18, Math.min(24, next.driveDb));
    const clampedCeiling = Math.max(-12, Math.min(-0.05, next.ceilingDbTp));
    const clampedLookahead = Math.max(1.0, Math.min(15.0, next.lookaheadMs));
    const clampedRelease = Math.max(15, Math.min(500, next.releaseMs));

    const lookaheadChanged =
      Math.abs(clampedLookahead - this.params.lookaheadMs) > 0.1;

    this.params = {
      driveDb: clampedDrive,
      ceilingDbTp: clampedCeiling,
      lookaheadMs: clampedLookahead,
      releaseMs: clampedRelease,
    };

    this.driveLinear = Math.pow(10, clampedDrive / 20);
    // 0.03 dB guard margin ensures strict adherence under 4x FIR reconstruction
    this.ceilingLinear = Math.pow(10, (clampedCeiling - 0.03) / 20);

    if (lookaheadChanged || this.lookaheadSamples === 235) {
      this.lookaheadSamples = Math.max(
        16,
        Math.min(
          MAX_DELAY_SAMPLES - TRUE_PEAK_FIR_GROUP_DELAY - 8,
          Math.round((clampedLookahead / 1000) * this.sampleRate)
        )
      );
      this.delaySamples = this.lookaheadSamples + TRUE_PEAK_FIR_GROUP_DELAY;
    }

    // Attack time constant = lookahead / 5 so envelope reaches 99.3% of target before transient exits delay
    const attackSamples = Math.max(4, this.lookaheadSamples / 5);
    this.attackCoeff = Math.exp(-1 / attackSamples);

    const relSamples = Math.max(16, (clampedRelease / 1000) * this.sampleRate);
    this.releaseCoeffFast = Math.exp(-1 / Math.max(16, relSamples * 0.25));
    this.releaseCoeffSlow = Math.exp(-1 / relSamples);
  }

  public getLatencySamples(): number {
    return this.delaySamples;
  }

  public getGainReductionDb(): number {
    return this.lastMaxGrDb;
  }

  private pushMonotonicMin(idx: number, val: number): number {
    // Pop back elements >= val
    while (this.dqTail !== this.dqHead) {
      const back = (this.dqTail - 1 + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
      if (this.dequeVal[back] >= val) {
        this.dqTail = back;
      } else {
        break;
      }
    }
    this.dequeVal[this.dqTail] = val;
    this.dequeIdx[this.dqTail] = idx;
    this.dqTail = (this.dqTail + 1) % MAX_DELAY_SAMPLES;

    // Pop expired front elements outside lookahead window (+2 margin covers exact exit tap)
    const minValidIdx = idx - (this.lookaheadSamples + 2) + 1;
    while (this.dqHead !== this.dqTail && this.dequeIdx[this.dqHead] < minValidIdx) {
      this.dqHead = (this.dqHead + 1) % MAX_DELAY_SAMPLES;
    }
    return this.dequeVal[this.dqHead];
  }

  public processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    length = inL.length
  ): number {
    const drive = this.driveLinear;
    const ceiling = this.ceilingLinear;
    let minGainSeen = 1.0;

    for (let i = 0; i < length; i++) {
      const l = inL[i] * drive;
      const r = inR[i] * drive;

      // Write incoming audio into delay line
      this.delayL[this.writeIdx] = l;
      this.delayR[this.writeIdx] = r;

      // 4x Polyphase FIR True Peak measurement (center tap is 5 samples delayed)
      const tpLin = this.tpDetector.processSample(l, r);
      const reqGain = tpLin > ceiling ? ceiling / tpLin : 1.0;

      // Also track exact required gain at the FIR center tap aligned with delaySamples
      const firAlignedWriteIdx =
        (this.writeIdx - TRUE_PEAK_FIR_GROUP_DELAY + MAX_DELAY_SAMPLES) %
        MAX_DELAY_SAMPLES;
      this.reqGainDelay[firAlignedWriteIdx] = Math.min(
        this.reqGainDelay[firAlignedWriteIdx],
        reqGain
      );

      // Push into sliding lookahead window minimum
      const windowMinGain = this.pushMonotonicMin(this.sampleCounter, reqGain);

      // Read audio exiting the delay line
      const readIdx =
        (this.writeIdx - this.delaySamples + MAX_DELAY_SAMPLES) %
        MAX_DELAY_SAMPLES;
      const outSampleL = this.delayL[readIdx];
      const outSampleR = this.delayR[readIdx];
      const exitReqGain = this.reqGainDelay[readIdx];
      this.reqGainDelay[readIdx] = 1.0; // clear slot for reuse

      // Smooth attack + adaptive dual-stage release
      if (windowMinGain < this.smoothedGain) {
        this.smoothedGain =
          this.attackCoeff * this.smoothedGain +
          (1 - this.attackCoeff) * windowMinGain;
        this.fastReleaseState = Math.min(this.fastReleaseState, this.smoothedGain);
        this.slowReleaseState = Math.min(this.slowReleaseState, this.smoothedGain);
      } else {
        this.fastReleaseState =
          this.releaseCoeffFast * this.fastReleaseState +
          (1 - this.releaseCoeffFast) * windowMinGain;
        this.slowReleaseState =
          this.releaseCoeffSlow * this.slowReleaseState +
          (1 - this.releaseCoeffSlow) * windowMinGain;
        // Blend fast transient release & smooth sustain release
        this.smoothedGain =
          0.55 * this.fastReleaseState + 0.45 * this.slowReleaseState;
      }

      // Hard safety guard guarantees zero sample or inter-sample overshoot
      const appliedGain = Math.min(this.smoothedGain, exitReqGain);
      if (appliedGain < minGainSeen) minGainSeen = appliedGain;

      const scaledL = outSampleL * appliedGain;
      const scaledR = outSampleR * appliedGain;
      outL[i] =
        scaledL > ceiling ? ceiling : scaledL < -ceiling ? -ceiling : scaledL;
      outR[i] =
        scaledR > ceiling ? ceiling : scaledR < -ceiling ? -ceiling : scaledR;

      this.writeIdx = (this.writeIdx + 1) % MAX_DELAY_SAMPLES;
      this.sampleCounter++;
    }

    const maxGrDb = minGainSeen < 1.0 ? Math.abs(20 * Math.log10(minGainSeen)) : 0;
    this.lastMaxGrDb = maxGrDb;
    return maxGrDb;
  }
}

/**
 * Offline latency-compensated processing using LookaheadLimiterCore.
 * Trims the lookahead group delay so output remains 100% phase/sample-aligned with input.
 */
export function applyTruePeakLookaheadLimiterOffline(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  params: LookaheadLimiterParams
): { maxGainReductionDb: number; finalTruePeakDbTp: number } {
  const n = left.length;
  if (n === 0) {
    return { maxGainReductionDb: 0, finalTruePeakDbTp: -90 };
  }

  const limiter = new LookaheadLimiterCore(sampleRate, params);
  const latency = limiter.getLatencySamples();

  const tmpOutL = new Float32Array(n);
  const tmpOutR = new Float32Array(n);

  // Feed main audio
  let maxGr = limiter.processBlock(left, right, tmpOutL, tmpOutR, n);

  // Flush the delay tail to keep exact input length and alignment
  const tailInL = new Float32Array(latency);
  const tailInR = new Float32Array(latency);
  const tailOutL = new Float32Array(latency);
  const tailOutR = new Float32Array(latency);
  const tailGr = limiter.processBlock(tailInL, tailInR, tailOutL, tailOutR, latency);
  if (tailGr > maxGr) maxGr = tailGr;

  // Copy latency-compensated samples back in-place
  for (let i = 0; i < n; i++) {
    const srcIdx = i + latency;
    if (srcIdx < n) {
      left[i] = tmpOutL[srcIdx];
      right[i] = tmpOutR[srcIdx];
    } else {
      const tIdx = srcIdx - n;
      left[i] = tailOutL[tIdx];
      right[i] = tailOutR[tIdx];
    }
  }

  const finalTpLinear = measureTruePeakLinear4x(left, right);
  return {
    maxGainReductionDb: Number(maxGr.toFixed(2)),
    finalTruePeakDbTp: Number(linearToDbTp(finalTpLinear, -90).toFixed(2)),
  };
}
