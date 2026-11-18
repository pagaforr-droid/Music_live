/**
 * Pure TypeScript 4x Polyphase FIR Oversampling True Peak Detector
 * modeled after ITU-R BS.1770-4 Annex 2 (48-tap windowed sinc kernel, 12 taps/phase).
 * Runs identically in AudioWorkletProcessor, Offline rendering, and unit tests.
 */

const TAPS_PER_PHASE = 12;
const HALF_TAPS = TAPS_PER_PHASE / 2; // 6

function besselI0(x: number): number {
  let sum = 1.0;
  let term = 1.0;
  const xHalf = x * 0.5;
  for (let k = 1; k <= 18; k++) {
    term *= (xHalf / k) * (xHalf / k);
    sum += term;
  }
  return sum;
}

function buildPolyphaseSincBank(): Float32Array[] {
  const beta = 5.2; // Kaiser window (~56 dB sidelobe attenuation, flat passband)
  const i0Beta = besselI0(beta);
  const cutoff = 0.90; // 0.90 * Nyquist to preserve full 20kHz spectrum without aliasing
  const phases: Float32Array[] = [];

  for (let p = 0; p < 4; p++) {
    const frac = p * 0.25;
    const coeffs = new Float32Array(TAPS_PER_PHASE);
    if (p === 0) {
      coeffs[HALF_TAPS - 1] = 1.0;
      phases.push(coeffs);
      continue;
    }

    let sum = 0;
    for (let k = 0; k < TAPS_PER_PHASE; k++) {
      // Sample position relative to interpolation point (center between index 5 and 6)
      const n = k - (HALF_TAPS - 1) - frac;
      const sincArg = Math.PI * cutoff * n;
      const sincVal =
        Math.abs(sincArg) < 1e-8 ? cutoff : (cutoff * Math.sin(sincArg)) / sincArg;

      // Kaiser window across full 12-tap support
      const winPos = (k + (1 - frac) - 0.5) / (TAPS_PER_PHASE - 1);
      const u = 2 * winPos - 1;
      const win =
        Math.abs(u) <= 1 ? besselI0(beta * Math.sqrt(Math.max(0, 1 - u * u))) / i0Beta : 0;

      const w = sincVal * win;
      coeffs[k] = w;
      sum += w;
    }

    if (Math.abs(sum) > 1e-9) {
      for (let k = 0; k < TAPS_PER_PHASE; k++) {
        coeffs[k] /= sum;
      }
    }
    phases.push(coeffs);
  }

  return phases;
}

export const POLYPHASE_4X_COEFFS = buildPolyphaseSincBank();

export const TRUE_PEAK_FIR_GROUP_DELAY = HALF_TAPS - 1; // 5 samples

/**
 * Stateful streaming 4x True Peak estimator for AudioWorklet / block processing.
 * Uses a 12-sample ring buffer per channel.
 */
export class StreamingTruePeakDetector {
  private readonly historyL = new Float32Array(TAPS_PER_PHASE);
  private readonly historyR = new Float32Array(TAPS_PER_PHASE);
  private writePos = 0;

  public reset(): void {
    this.historyL.fill(0);
    this.historyR.fill(0);
    this.writePos = 0;
  }

  /**
   * Feeds one stereo sample pair and returns the max absolute 4x oversampled peak
   * across phases {0, 0.25, 0.5, 0.75} for both L and R.
   */
  public processSample(l: number, r: number): number {
    this.historyL[this.writePos] = l;
    this.historyR[this.writePos] = r;

    // Integer sample peak at center tap (delay = TRUE_PEAK_FIR_GROUP_DELAY = 5 samples)
    // Evaluating all 4 polyphase outputs at the exact same group delay guarantees
    // sample-synchronized True Peak detection without early 0-delay jitter.
    const centerIdx = (this.writePos + TAPS_PER_PHASE - (HALF_TAPS - 1)) % TAPS_PER_PHASE;
    let peak = Math.max(
      Math.abs(this.historyL[centerIdx]),
      Math.abs(this.historyR[centerIdx])
    );

    const p1 = POLYPHASE_4X_COEFFS[1];
    const p2 = POLYPHASE_4X_COEFFS[2];
    const p3 = POLYPHASE_4X_COEFFS[3];

    let l1 = 0, l2 = 0, l3 = 0;
    let r1 = 0, r2 = 0, r3 = 0;

    // Convolve oldest -> newest
    for (let k = 0; k < TAPS_PER_PHASE; k++) {
      const idx = (this.writePos + 1 + k) % TAPS_PER_PHASE;
      const sl = this.historyL[idx];
      const sr = this.historyR[idx];
      const reverseK = TAPS_PER_PHASE - 1 - k;
      l1 += sl * p1[reverseK];
      l2 += sl * p2[reverseK];
      l3 += sl * p3[reverseK];
      r1 += sr * p1[reverseK];
      r2 += sr * p2[reverseK];
      r3 += sr * p3[reverseK];
    }

    peak = Math.max(
      peak,
      Math.abs(l1),
      Math.abs(l2),
      Math.abs(l3),
      Math.abs(r1),
      Math.abs(r2),
      Math.abs(r3)
    );

    this.writePos = (this.writePos + 1) % TAPS_PER_PHASE;
    return peak;
  }
}

/**
 * Computes exact 4x polyphase FIR True Peak linear amplitude over an audio block.
 */
export function measureTruePeakLinear4x(
  left: Float32Array,
  right: Float32Array,
  startIdx = 0,
  endIdx = left.length
): number {
  const limit = Math.min(left.length, right.length, endIdx);
  if (limit <= startIdx) return 0;

  const detector = new StreamingTruePeakDetector();
  let maxPeak = 0;

  for (let i = startIdx; i < limit; i++) {
    const p = detector.processSample(left[i], right[i]);
    if (p > maxPeak) maxPeak = p;
  }

  // Flush remaining center taps
  for (let k = 0; k < TAPS_PER_PHASE; k++) {
    const p = detector.processSample(0, 0);
    if (p > maxPeak) maxPeak = p;
  }

  return maxPeak;
}

export function linearToDbTp(linear: number, minDb = -90): number {
  if (!Number.isFinite(linear) || linear <= 1e-5) return minDb;
  return Math.max(minDb, 20 * Math.log10(linear));
}
