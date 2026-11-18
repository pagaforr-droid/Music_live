import {
  StreamingTruePeakDetector,
  linearToDbTp,
  measureTruePeakLinear4x,
} from './TruePeakDetector';

/**
 * Pure TypeScript ITU-R BS.1770-4 K-Weighting + Dual-Gated Integrated LUFS,
 * EBU R128 LRA, Short-Term (3s), Momentary (400ms), Phase Correlation, and RMS Crest Factor.
 * Shared identically between Metering AudioWorklet, Offline 2-Pass Render, and Analyzer.
 */

export interface KWeightingCoeffs {
  hs: { b0: number; b1: number; b2: number; a1: number; a2: number };
  hp: { b0: number; b1: number; b2: number; a1: number; a2: number };
}

export function getItuKWeightingCoeffs(sampleRate: number): KWeightingCoeffs {
  if (Math.abs(sampleRate - 48000) < 1) {
    // Exact ITU-R BS.1770-4 Table 1 & Table 2 coefficients for 48 kHz
    return {
      hs: {
        b0: 1.53512485958697,
        b1: -2.69169618940638,
        b2: 1.19839281085285,
        a1: -1.69065929318241,
        a2: 0.73248077421585,
      },
      hp: {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: -1.99004745483398,
        a2: 0.99007225036621,
      },
    };
  }

  // Exact bilinear prewarped analog prototype from ITU-R BS.1770-4 for arbitrary sample rates
  // Stage 1: High-shelf pre-filter
  const f0Shelf = 1681.974450955533;
  const gDbShelf = 3.999843853973347;
  const qShelf = 0.7071752369554196;
  const kShelf = Math.tan((Math.PI * f0Shelf) / sampleRate);
  const vh = Math.pow(10, gDbShelf / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0S = 1 + kShelf / qShelf + kShelf * kShelf;
  const hs = {
    b0: (vh + (vb * kShelf) / qShelf + kShelf * kShelf) / a0S,
    b1: (2 * (kShelf * kShelf - vh)) / a0S,
    b2: (vh - (vb * kShelf) / qShelf + kShelf * kShelf) / a0S,
    a1: (2 * (kShelf * kShelf - 1)) / a0S,
    a2: (1 - kShelf / qShelf + kShelf * kShelf) / a0S,
  };

  // Stage 2: RLB High-pass
  const f0Hp = 38.13547087602444;
  const qHp = 0.5003270373238773;
  const kHp = Math.tan((Math.PI * f0Hp) / sampleRate);
  const a0H = 1 + kHp / qHp + kHp * kHp;
  const hp = {
    b0: 1 / a0H,
    b1: -2 / a0H,
    b2: 1 / a0H,
    a1: (2 * (kHp * kHp - 1)) / a0H,
    a2: (1 - kHp / qHp + kHp * kHp) / a0H,
  };

  return { hs, hp };
}

export interface LoudnessReport {
  integratedLufs: number;
  shortTermMaxLufs: number;
  momentaryMaxLufs: number;
  lraLu: number;
  truePeakDbTp: number;
  samplePeakDb: number;
  rmsDb: number;
  crestFactorDb: number;
  plrDb: number;
  phaseCorrelation: number;
  clippedSamples: number;
}

function runKWeightingChannel(
  samples: Float32Array,
  coeffs: KWeightingCoeffs
): Float32Array {
  const out = new Float32Array(samples.length);
  const { hs, hp } = coeffs;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = hs.b0 * x + hs.b1 * x1 + hs.b2 * x2 - hs.a1 * y1 - hs.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;

    const h = hp.b0 * y + hp.b1 * hx1 + hp.b2 * hx2 - hp.a1 * hy1 - hp.a2 * hy2;
    hx2 = hx1;
    hx1 = y;
    hy2 = hy1;
    hy1 = h;
    out[i] = h;
  }
  return out;
}

/**
 * Downmix multi-channel (1, 2, or 5.1/surround) into ITU-weighted stereo + K-weighted power.
 */
export function downmixToStereoArrays(
  channels: Float32Array[]
): { left: Float32Array; right: Float32Array } {
  if (channels.length === 0) {
    return { left: new Float32Array(0), right: new Float32Array(0) };
  }
  if (channels.length === 1) {
    return { left: channels[0], right: channels[0] };
  }
  if (channels.length === 2) {
    return { left: channels[0], right: channels[1] };
  }
  // 5.1 / multi-channel ITU downmix (L, R, C, LFE ignored, Ls, Rs)
  const len = channels[0].length;
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  const L = channels[0];
  const R = channels[1];
  const C = channels[2];
  const Ls = channels[4] ?? null;
  const Rs = channels[5] ?? null;
  const invSqrt2 = Math.SQRT1_2;

  for (let i = 0; i < len; i++) {
    let lVal = L[i] + invSqrt2 * C[i];
    let rVal = R[i] + invSqrt2 * C[i];
    if (Ls) lVal += invSqrt2 * Ls[i];
    if (Rs) rVal += invSqrt2 * Rs[i];
    left[i] = lVal;
    right[i] = rVal;
  }
  return { left, right };
}

/**
 * Computes exact ITU-R BS.1770-4 Loudness Report with 75% overlapping 400ms blocks (100ms hop),
 * dual-stage gating (-70 LUFS / -10 LU), EBU LRA, 4x polyphase True Peak, RMS Crest Factor, and PLR.
 */
export function computeFullLoudnessReport(
  channels: Float32Array[],
  sampleRate: number
): LoudnessReport {
  if (channels.length === 0 || channels[0].length === 0) {
    return {
      integratedLufs: -60,
      shortTermMaxLufs: -60,
      momentaryMaxLufs: -60,
      lraLu: 0,
      truePeakDbTp: -90,
      samplePeakDb: -90,
      rmsDb: -90,
      crestFactorDb: 0,
      plrDb: 0,
      phaseCorrelation: 1,
      clippedSamples: 0,
    };
  }

  const length = channels[0].length;
  const isMono = channels.length === 1;
  const coeffs = getItuKWeightingCoeffs(sampleRate);

  // ITU channel weights: mono dual-routed to L+R = 2.0; stereo L=1, R=1; 5.1 C=1, LFE=0, Ls=1.41, Rs=1.41
  const ituWeights = isMono ? [2.0] : [1.0, 1.0, 1.0, 0.0, 1.41, 1.41];
  const weightedKwChannels: Array<{ data: Float32Array; weight: number }> = [];
  for (let ch = 0; ch < Math.min(channels.length, 6); ch++) {
    const w = ituWeights[ch] ?? 1.0;
    if (w > 0) {
      weightedKwChannels.push({
        data: runKWeightingChannel(channels[ch], coeffs),
        weight: w,
      });
    }
  }

  // Raw sample stats + phase correlation
  const { left, right } = downmixToStereoArrays(channels);
  let samplePeak = 0;
  let sumSq = 0;
  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  let clippedSamples = 0;

  for (let i = 0; i < length; i++) {
    const l = left[i];
    const r = right[i];
    const absL = Math.abs(l);
    const absR = Math.abs(r);
    const pk = absL > absR ? absL : absR;
    if (pk > samplePeak) samplePeak = pk;
    if (pk >= 0.9999) clippedSamples++;
    sumSq += 0.5 * (l * l + r * r);
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
  }

  const rms = Math.sqrt(sumSq / length);
  const rmsDb = linearToDbTp(rms, -90);
  const samplePeakDb = linearToDbTp(samplePeak, -90);
  const crestFactorDb = Math.max(0, samplePeakDb - rmsDb);
  const truePeakLinear = measureTruePeakLinear4x(left, right);
  const truePeakDbTp = linearToDbTp(truePeakLinear, -90);

  const corrDenom = Math.sqrt(sumL2 * sumR2);
  const phaseCorrelation = isMono
    ? 1.0
    : corrDenom > 1e-12
    ? Math.max(-1, Math.min(1, sumLR / corrDenom))
    : 1.0;

  // 100ms sub-windows (75% overlap for 400ms blocks)
  const subWinLen = Math.max(64, Math.round(sampleRate * 0.1));
  const subPowers: number[] = [];

  for (let start = 0; start < length; start += subWinLen) {
    const end = Math.min(length, start + subWinLen);
    const count = end - start;
    if (count < subWinLen * 0.25 && subPowers.length > 0) break;

    let zSum = 0;
    for (const ch of weightedKwChannels) {
      let chSq = 0;
      const d = ch.data;
      for (let i = start; i < end; i++) {
        chSq += d[i] * d[i];
      }
      zSum += ch.weight * (chSq / count);
    }
    subPowers.push(zSum);
  }

  if (subPowers.length === 0) {
    return {
      integratedLufs: -60,
      shortTermMaxLufs: -60,
      momentaryMaxLufs: -60,
      lraLu: 0,
      truePeakDbTp: Number(truePeakDbTp.toFixed(2)),
      samplePeakDb: Number(samplePeakDb.toFixed(2)),
      rmsDb: Number(rmsDb.toFixed(2)),
      crestFactorDb: Number(crestFactorDb.toFixed(2)),
      plrDb: 0,
      phaseCorrelation: Number(phaseCorrelation.toFixed(2)),
      clippedSamples,
    };
  }

  // Build 400ms (4 x 100ms) momentary blocks
  const block400Powers: number[] = [];
  if (subPowers.length < 4) {
    const avg = subPowers.reduce((a, b) => a + b, 0) / subPowers.length;
    block400Powers.push(avg);
  } else {
    for (let i = 0; i <= subPowers.length - 4; i++) {
      block400Powers.push(
        0.25 *
          (subPowers[i] + subPowers[i + 1] + subPowers[i + 2] + subPowers[i + 3])
      );
    }
  }

  let momentaryMaxLufs = -70;
  for (const z of block400Powers) {
    if (z > 1e-12) {
      const l = -0.691 + 10 * Math.log10(z);
      if (l > momentaryMaxLufs) momentaryMaxLufs = l;
    }
  }

  // Dual-stage ITU gating
  const absGateZ = Math.pow(10, (-70 + 0.691) / 10);
  const absPassed = block400Powers.filter((z) => z > absGateZ);
  let integratedLufs = -70.0;
  if (absPassed.length > 0) {
    const meanAbsZ =
      absPassed.reduce((acc, v) => acc + v, 0) / absPassed.length;
    const ungatedLufs = -0.691 + 10 * Math.log10(meanAbsZ);
    const relGateZ = Math.pow(10, (ungatedLufs - 10 + 0.691) / 10);
    const relPassed = absPassed.filter((z) => z >= relGateZ);
    const finalZ =
      relPassed.length > 0
        ? relPassed.reduce((acc, v) => acc + v, 0) / relPassed.length
        : meanAbsZ;
    integratedLufs = Math.max(-70, -0.691 + 10 * Math.log10(Math.max(1e-12, finalZ)));
  }

  // Short-Term (3s = 30 x 100ms) blocks for Short-Term Max & EBU R128 LRA
  const shortTermLufsList: number[] = [];
  if (subPowers.length < 30) {
    const avg = subPowers.reduce((a, b) => a + b, 0) / subPowers.length;
    if (avg > absGateZ) {
      shortTermLufsList.push(-0.691 + 10 * Math.log10(avg));
    }
  } else {
    let runningSum = 0;
    for (let i = 0; i < 30; i++) runningSum += subPowers[i];
    if (runningSum / 30 > absGateZ) {
      shortTermLufsList.push(-0.691 + 10 * Math.log10(runningSum / 30));
    }
    for (let i = 30; i < subPowers.length; i++) {
      runningSum += subPowers[i] - subPowers[i - 30];
      const z = runningSum / 30;
      if (z > absGateZ) {
        shortTermLufsList.push(-0.691 + 10 * Math.log10(z));
      }
    }
  }

  const shortTermMaxLufs =
    shortTermLufsList.length > 0 ? Math.max(...shortTermLufsList) : integratedLufs;

  // EBU R128 LRA: relative gate -20 LU below ungated ST average, 95th - 10th percentile
  let lraLu = 0;
  if (shortTermLufsList.length >= 2) {
    const stPowers = shortTermLufsList.map((l) => Math.pow(10, (l + 0.691) / 10));
    const meanStZ = stPowers.reduce((a, b) => a + b, 0) / stPowers.length;
    const ungatedSt = -0.691 + 10 * Math.log10(meanStZ);
    const lraGate = ungatedSt - 20;
    const gatedSt = shortTermLufsList.filter((l) => l >= lraGate).sort((a, b) => a - b);
    if (gatedSt.length >= 2) {
      const p10 = gatedSt[Math.floor((gatedSt.length - 1) * 0.1)];
      const p95 = gatedSt[Math.floor((gatedSt.length - 1) * 0.95)];
      lraLu = Math.max(0, p95 - p10);
    }
  }

  return {
    integratedLufs: Number(integratedLufs.toFixed(2)),
    shortTermMaxLufs: Number(shortTermMaxLufs.toFixed(2)),
    momentaryMaxLufs: Number(momentaryMaxLufs.toFixed(2)),
    lraLu: Number(lraLu.toFixed(2)),
    truePeakDbTp: Number(truePeakDbTp.toFixed(2)),
    samplePeakDb: Number(samplePeakDb.toFixed(2)),
    rmsDb: Number(rmsDb.toFixed(2)),
    crestFactorDb: Number(crestFactorDb.toFixed(2)),
    plrDb: Number(Math.max(0, truePeakDbTp - integratedLufs).toFixed(2)),
    phaseCorrelation: Number(phaseCorrelation.toFixed(2)),
    clippedSamples,
  };
}

/**
 * Streaming real-time ITU-R BS.1770-4 meter state for AudioWorkletProcessor.
 * Accumulates 100ms sub-windows cleanly and emits snapshots at ~15-30 Hz.
 */
export class StreamingLoudnessMeter {
  private readonly sampleRate: number;
  private readonly coeffs: KWeightingCoeffs;
  private readonly tpDetector = new StreamingTruePeakDetector();

  private readonly subWinSamples: number;
  private subAccumZ = 0;
  private subSampleCount = 0;

  // Ring of 30 x 100ms sub-windows (= 3.0s)
  private readonly subHistory = new Float32Array(30);
  private subHistoryPos = 0;
  private subHistoryFilled = 0;

  // Histogram of 400ms gated blocks in 0.1 LU bins from -70.0 to 0.0 (701 bins) for O(1) integrated LUFS
  private readonly intBins = new Uint32Array(701);
  private readonly intPowerBins = new Float64Array(701);

  // Histogram of 3s Short-Term blocks in 0.1 LU bins from -70.0 to 0.0 (701 bins) for live LRA
  private readonly stBins = new Uint32Array(701);
  private readonly stPowerBins = new Float64Array(701);

  // K-weighting biquad states L & R
  private lx1 = 0; private lx2 = 0; private ly1 = 0; private ly2 = 0;
  private lhx1 = 0; private lhx2 = 0; private lhy1 = 0; private lhy2 = 0;
  private rx1 = 0; private rx2 = 0; private ry1 = 0; private ry2 = 0;
  private rhx1 = 0; private rhx2 = 0; private rhy1 = 0; private rhy2 = 0;

  // Live block telemetry
  private heldTruePeakLin = 0;
  private blockSamplePeakLin = 0;
  private blockRmsSqSum = 0;
  private blockSumLR = 0;
  private blockSumL2 = 0;
  private blockSumR2 = 0;
  private blockSamples = 0;
  private totalClippedSamples = 0;

  private lastMomentaryLufs = -70;
  private lastShortTermLufs = -70;
  private lastIntegratedLufs = -70;
  private lastLraLu = 0;
  private lastPhaseCorr = 1.0;
  private lastCrestDb = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.coeffs = getItuKWeightingCoeffs(sampleRate);
    this.subWinSamples = Math.max(64, Math.round(sampleRate * 0.1));
  }

  public reset(): void {
    this.subAccumZ = 0;
    this.subSampleCount = 0;
    this.subHistory.fill(0);
    this.subHistoryPos = 0;
    this.subHistoryFilled = 0;
    this.intBins.fill(0);
    this.intPowerBins.fill(0);
    this.stBins.fill(0);
    this.stPowerBins.fill(0);
    this.tpDetector.reset();
    this.heldTruePeakLin = 0;
    this.totalClippedSamples = 0;
    this.lx1 = this.lx2 = this.ly1 = this.ly2 = 0;
    this.lhx1 = this.lhx2 = this.lhy1 = this.lhy2 = 0;
    this.rx1 = this.rx2 = this.ry1 = this.ry2 = 0;
    this.rhx1 = this.rhx2 = this.rhy1 = this.rhy2 = 0;
    this.lastMomentaryLufs = -70;
    this.lastShortTermLufs = -70;
    this.lastIntegratedLufs = -70;
    this.lastLraLu = 0;
    this.lastPhaseCorr = 1.0;
    this.lastCrestDb = 0;
    this.resetBlockStats();
  }

  public resetBlockStats(): void {
    this.blockSamplePeakLin = 0;
    this.blockRmsSqSum = 0;
    this.blockSumLR = 0;
    this.blockSumL2 = 0;
    this.blockSumR2 = 0;
    this.blockSamples = 0;
  }

  public processBlock(left: Float32Array, right: Float32Array): void {
    const { hs, hp } = this.coeffs;
    const n = left.length;
    const tpDecay = Math.pow(0.99993, n);
    this.heldTruePeakLin *= tpDecay;

    for (let i = 0; i < n; i++) {
      const l = left[i];
      const r = right[i];

      const absL = Math.abs(l);
      const absR = Math.abs(r);
      const sPk = absL > absR ? absL : absR;
      if (sPk > this.blockSamplePeakLin) this.blockSamplePeakLin = sPk;
      if (sPk >= 0.9999) this.totalClippedSamples++;

      const tp = this.tpDetector.processSample(l, r);
      if (tp > this.heldTruePeakLin) this.heldTruePeakLin = tp;

      this.blockRmsSqSum += 0.5 * (l * l + r * r);
      this.blockSumLR += l * r;
      this.blockSumL2 += l * l;
      this.blockSumR2 += r * r;
      this.blockSamples++;

      // K-weighting L
      const ly = hs.b0 * l + hs.b1 * this.lx1 + hs.b2 * this.lx2 - hs.a1 * this.ly1 - hs.a2 * this.ly2;
      this.lx2 = this.lx1; this.lx1 = l; this.ly2 = this.ly1; this.ly1 = ly;
      const lh = hp.b0 * ly + hp.b1 * this.lhx1 + hp.b2 * this.lhx2 - hp.a1 * this.lhy1 - hp.a2 * this.lhy2;
      this.lhx2 = this.lhx1; this.lhx1 = ly; this.lhy2 = this.lhy1; this.lhy1 = lh;

      // K-weighting R
      const ry = hs.b0 * r + hs.b1 * this.rx1 + hs.b2 * this.rx2 - hs.a1 * this.ry1 - hs.a2 * this.ry2;
      this.rx2 = this.rx1; this.rx1 = r; this.ry2 = this.ry1; this.ry1 = ry;
      const rh = hp.b0 * ry + hp.b1 * this.rhx1 + hp.b2 * this.rhx2 - hp.a1 * this.rhy1 - hp.a2 * this.rhy2;
      this.rhx2 = this.rhx1; this.rhx1 = ry; this.rhy2 = this.rhy1; this.rhy1 = rh;

      this.subAccumZ += lh * lh + rh * rh;
      this.subSampleCount++;

      if (this.subSampleCount >= this.subWinSamples) {
        const subMeanZ = this.subAccumZ / this.subSampleCount;
        this.subAccumZ = 0;
        this.subSampleCount = 0;

        this.subHistory[this.subHistoryPos] = subMeanZ;
        this.subHistoryPos = (this.subHistoryPos + 1) % 30;
        if (this.subHistoryFilled < 30) this.subHistoryFilled++;

        // 400ms Momentary (last 4 sub-windows)
        const mCount = Math.min(4, this.subHistoryFilled);
        let mSum = 0;
        for (let k = 0; k < mCount; k++) {
          const idx = (this.subHistoryPos - 1 - k + 30) % 30;
          mSum += this.subHistory[idx];
        }
        const mMean = mSum / mCount;
        if (mMean > 1e-12) {
          this.lastMomentaryLufs = Math.max(-70, -0.691 + 10 * Math.log10(mMean));
          // Feed integrated LUFS histogram once we have >= 400ms
          if (this.subHistoryFilled >= 4 && this.lastMomentaryLufs > -70) {
            const bin = Math.max(0, Math.min(700, Math.round((this.lastMomentaryLufs + 70) * 10)));
            this.intBins[bin]++;
            this.intPowerBins[bin] += mMean;
            this.recomputeIntegratedFromHistogram();
          }
        } else {
          this.lastMomentaryLufs = -70;
        }

        // 3s Short-term
        let sSum = 0;
        for (let k = 0; k < this.subHistoryFilled; k++) {
          sSum += this.subHistory[k];
        }
        const sMean = sSum / this.subHistoryFilled;
        this.lastShortTermLufs =
          sMean > 1e-12 ? Math.max(-70, -0.691 + 10 * Math.log10(sMean)) : -70;

        if (this.subHistoryFilled >= 30 && this.lastShortTermLufs > -70) {
          const stBin = Math.max(
            0,
            Math.min(700, Math.round((this.lastShortTermLufs + 70) * 10))
          );
          this.stBins[stBin]++;
          this.stPowerBins[stBin] += sMean;
          this.recomputeLraFromHistogram();
        }
      }
    }

    if (this.blockSamples >= Math.round(this.sampleRate * 0.04)) {
      const denom = Math.sqrt(this.blockSumL2 * this.blockSumR2);
      if (denom > 1e-10) {
        const instCorr = Math.max(-1, Math.min(1, this.blockSumLR / denom));
        this.lastPhaseCorr = 0.72 * this.lastPhaseCorr + 0.28 * instCorr;
      }
      const rms = Math.sqrt(this.blockRmsSqSum / this.blockSamples);
      if (rms > 1e-6 && this.blockSamplePeakLin > 1e-6) {
        const instCrest = 20 * Math.log10(this.blockSamplePeakLin / rms);
        this.lastCrestDb =
          this.lastCrestDb > 0
            ? 0.78 * this.lastCrestDb + 0.22 * instCrest
            : instCrest;
      }
      this.resetBlockStats();
    }
  }

  private recomputeIntegratedFromHistogram(): void {
    let totalCount = 0;
    let totalPower = 0;
    for (let b = 0; b <= 700; b++) {
      totalCount += this.intBins[b];
      totalPower += this.intPowerBins[b];
    }
    if (totalCount === 0 || totalPower <= 1e-12) return;
    const ungated = -0.691 + 10 * Math.log10(totalPower / totalCount);
    const relThreshBin = Math.max(0, Math.min(700, Math.ceil((ungated - 10 + 70) * 10)));

    let gatedCount = 0;
    let gatedPower = 0;
    for (let b = relThreshBin; b <= 700; b++) {
      gatedCount += this.intBins[b];
      gatedPower += this.intPowerBins[b];
    }
    if (gatedCount > 0 && gatedPower > 1e-12) {
      this.lastIntegratedLufs = Math.max(
        -70,
        -0.691 + 10 * Math.log10(gatedPower / gatedCount)
      );
    }
  }

  private recomputeLraFromHistogram(): void {
    let totalCount = 0;
    let totalPower = 0;
    for (let b = 0; b <= 700; b++) {
      totalCount += this.stBins[b];
      totalPower += this.stPowerBins[b];
    }
    if (totalCount < 2 || totalPower <= 1e-12) return;
    const ungated = -0.691 + 10 * Math.log10(totalPower / totalCount);
    const lraGateBin = Math.max(0, Math.min(700, Math.ceil((ungated - 20 + 70) * 10)));

    let gatedCount = 0;
    for (let b = lraGateBin; b <= 700; b++) {
      gatedCount += this.stBins[b];
    }
    if (gatedCount < 2) return;

    const p10Target = Math.floor((gatedCount - 1) * 0.1);
    const p95Target = Math.floor((gatedCount - 1) * 0.95);
    let cum = 0;
    let p10Lufs = -70;
    let p95Lufs = -70;
    let found10 = false;
    for (let b = lraGateBin; b <= 700; b++) {
      const cnt = this.stBins[b];
      if (cnt === 0) continue;
      cum += cnt;
      const valLufs = -70 + b * 0.1;
      if (!found10 && cum > p10Target) {
        p10Lufs = valLufs;
        found10 = true;
      }
      if (cum > p95Target) {
        p95Lufs = valLufs;
        break;
      }
    }
    this.lastLraLu = Math.max(0, p95Lufs - p10Lufs);
  }

  public getSnapshot() {
    return {
      momentaryLufs: Number(this.lastMomentaryLufs.toFixed(1)),
      shortTermLufs: Number(this.lastShortTermLufs.toFixed(1)),
      integratedLufs: Number(this.lastIntegratedLufs.toFixed(1)),
      lraLu: Number(this.lastLraLu.toFixed(1)),
      truePeakDbTp: Number(linearToDbTp(this.heldTruePeakLin, -70).toFixed(2)),
      phaseCorrelation: Number(this.lastPhaseCorr.toFixed(2)),
      crestFactorDb: Number(this.lastCrestDb.toFixed(1)),
      clippedSamples: this.totalClippedSamples,
    };
  }
}
