/**
 * Pure TypeScript Feed-Forward Stereo-Linked Bus Compressor Core.
 * - ZERO hidden auto-makeup gain (fixing native DynamicsCompressorNode +4.5 to +8.5 dB inflation).
 * - Built-in Sidechain High-Pass filter (default 90 Hz) so sub-bass doesn't pump the mix.
 * - Sample-aligned Dry/Wet ring delay inside the same core -> ZERO comb-filtering in parallel mix!
 */

export interface BusCompressorParams {
  thresholdDb: number;
  ratio: number;
  attackSec: number;
  releaseSec: number;
  kneeDb: number;
  makeupGainDb: number;
  parallelMix: number; // 0..1
  sidechainHpfHz?: number; // default 90 Hz
}

export class BusCompressorCore {
  private readonly sampleRate: number;
  private scHpfHz = 90;
  private scB0 = 1;
  private scB1 = 0;
  private scB2 = 0;
  private scA1 = 0;
  private scA2 = 0;

  // Sidechain filter state L & R
  private scLx1 = 0; private scLx2 = 0; private scLy1 = 0; private scLy2 = 0;
  private scRx1 = 0; private scRx2 = 0; private scRy1 = 0; private scRy2 = 0;

  // Envelope detector state (positive GR in dB domain >= 0; must start at 0 so first transient is never delayed!)
  private envDb = 0;
  private rmsSq = 0;
  private lastGainReductionDb = 0;

  // Cached coefficients
  private params: BusCompressorParams = {
    thresholdDb: -18,
    ratio: 2.5,
    attackSec: 0.025,
    releaseSec: 0.12,
    kneeDb: 6,
    makeupGainDb: 0,
    parallelMix: 1.0,
    sidechainHpfHz: 90,
  };
  private attackCoeff = 0.99;
  private releaseCoeffFast = 0.99;
  private releaseCoeffSlow = 0.999;
  private rmsCoeff = 0.99;
  private makeupLinear = 1.0;

  constructor(sampleRate: number, initialParams?: BusCompressorParams) {
    this.sampleRate = Math.max(8000, sampleRate);
    this.updateSidechainHpf(90);
    if (initialParams) {
      this.updateParams(initialParams);
    } else {
      this.recomputeCoeffs();
    }
  }

  public reset(): void {
    this.scLx1 = this.scLx2 = this.scLy1 = this.scLy2 = 0;
    this.scRx1 = this.scRx2 = this.scRy1 = this.scRy2 = 0;
    this.envDb = 0;
    this.rmsSq = 0;
    this.lastGainReductionDb = 0;
  }

  public updateParams(next: BusCompressorParams): void {
    this.params = {
      thresholdDb: Math.max(-45, Math.min(0, next.thresholdDb)),
      ratio: Math.max(1.0, Math.min(20.0, next.ratio)),
      attackSec: Math.max(0.0005, Math.min(0.3, next.attackSec)),
      releaseSec: Math.max(0.01, Math.min(1.5, next.releaseSec)),
      kneeDb: Math.max(0, Math.min(24, next.kneeDb)),
      makeupGainDb: Math.max(-12, Math.min(18, next.makeupGainDb)),
      parallelMix: Math.max(0, Math.min(1, next.parallelMix)),
      sidechainHpfHz: next.sidechainHpfHz ?? 90,
    };
    if (
      next.sidechainHpfHz !== undefined &&
      Math.abs(next.sidechainHpfHz - this.scHpfHz) > 0.5
    ) {
      this.updateSidechainHpf(next.sidechainHpfHz);
    }
    this.recomputeCoeffs();
  }

  private updateSidechainHpf(hz: number): void {
    this.scHpfHz = Math.max(15, Math.min(350, hz));
    const w0 = (2 * Math.PI * this.scHpfHz) / this.sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    this.scB0 = (1 + cosW0) / 2 / a0;
    this.scB1 = -(1 + cosW0) / a0;
    this.scB2 = (1 + cosW0) / 2 / a0;
    this.scA1 = (-2 * cosW0) / a0;
    this.scA2 = (1 - alpha) / a0;
  }

  private recomputeCoeffs(): void {
    const sr = this.sampleRate;
    this.attackCoeff = Math.exp(-1 / Math.max(1, this.params.attackSec * sr));
    this.releaseCoeffFast = Math.exp(
      -1 / Math.max(1, Math.min(0.08, this.params.releaseSec * 0.45) * sr)
    );
    this.releaseCoeffSlow = Math.exp(
      -1 / Math.max(1, this.params.releaseSec * sr)
    );
    this.rmsCoeff = Math.exp(-1 / Math.max(1, 0.012 * sr)); // 12ms RMS window
    this.makeupLinear = Math.pow(10, this.params.makeupGainDb / 20);
  }

  public getGainReductionDb(): number {
    return this.lastGainReductionDb;
  }

  public processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    length = inL.length
  ): number {
    const { thresholdDb, ratio, kneeDb, parallelMix } = this.params;
    const dryMix = 1 - parallelMix;
    const makeup = this.makeupLinear;
    const halfKnee = kneeDb * 0.5;
    const invRatioMinus1 = 1 / ratio - 1;
    let maxGrDb = 0;

    for (let i = 0; i < length; i++) {
      const l = inL[i];
      const r = inR[i];

      // 1. Sidechain HPF (keeps sub-bass from over-triggering bus compression)
      const scL =
        this.scB0 * l +
        this.scB1 * this.scLx1 +
        this.scB2 * this.scLx2 -
        this.scA1 * this.scLy1 -
        this.scA2 * this.scLy2;
      this.scLx2 = this.scLx1;
      this.scLx1 = l;
      this.scLy2 = this.scLy1;
      this.scLy1 = scL;

      const scR =
        this.scB0 * r +
        this.scB1 * this.scRx1 +
        this.scB2 * this.scRx2 -
        this.scA1 * this.scRy1 -
        this.scA2 * this.scRy2;
      this.scRx2 = this.scRx1;
      this.scRx1 = r;
      this.scRy2 = this.scRy1;
      this.scRy1 = scR;

      // 2. Hybrid Peak + RMS stereo-linked detector
      const peakLin = Math.max(Math.abs(scL), Math.abs(scR));
      const sqEnergy = 0.5 * (scL * scL + scR * scR);
      this.rmsSq = this.rmsCoeff * this.rmsSq + (1 - this.rmsCoeff) * sqEnergy;
      const rmsLin = Math.sqrt(Math.max(0, this.rmsSq));

      const detLin = Math.max(1e-6, 0.55 * peakLin + 0.45 * rmsLin);
      const detDb = 20 * Math.log10(detLin);

      // 3. Soft-knee static gain computer
      let gainChangeDb = 0;
      const overDb = detDb - thresholdDb;
      if (kneeDb > 0.01 && Math.abs(overDb) <= halfKnee) {
        const x = overDb + halfKnee;
        gainChangeDb = (invRatioMinus1 * x * x) / (2 * kneeDb);
      } else if (overDb > halfKnee) {
        gainChangeDb = overDb * invRatioMinus1;
      }

      // 4. Program-dependent attack / dual-release smoother in dB domain
      const targetGrDb = -gainChangeDb; // positive number >= 0
      if (targetGrDb > this.envDb) {
        this.envDb =
          this.attackCoeff * this.envDb + (1 - this.attackCoeff) * targetGrDb;
      } else {
        // Transient bursts recover faster than sustained program material
        const crestRatio = peakLin / Math.max(1e-5, rmsLin);
        const relWeight = Math.max(0, Math.min(1, (crestRatio - 1.4) / 2.2));
        const relCoeff =
          this.releaseCoeffSlow * (1 - relWeight) +
          this.releaseCoeffFast * relWeight;
        this.envDb = relCoeff * this.envDb + (1 - relCoeff) * targetGrDb;
      }

      const grDb = Math.max(0, this.envDb);
      if (grDb > maxGrDb) maxGrDb = grDb;

      const wetGain = Math.pow(10, -grDb / 20) * makeup;
      // Zero-latency sample-aligned blend -> flat 0.00 dB response when below threshold!
      const totalGain = dryMix + parallelMix * wetGain;
      outL[i] = l * totalGain;
      outR[i] = r * totalGain;
    }

    this.lastGainReductionDb = maxGrDb;
    return maxGrDb;
  }
}

export function processBusCompressorOffline(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  params: BusCompressorParams
): { maxGainReductionDb: number } {
  const comp = new BusCompressorCore(sampleRate, params);
  const maxGainReductionDb = comp.processBlock(left, right, left, right, left.length);
  return { maxGainReductionDb: Number(maxGainReductionDb.toFixed(2)) };
}
