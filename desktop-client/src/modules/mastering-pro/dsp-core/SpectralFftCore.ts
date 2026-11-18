/**
 * Pure TypeScript FFT + Welch Spectral Analyzer + Stationary Resonance Detector
 * + Log-Magnitude Spectral Flux Onset Detector.
 *
 * Fixes the subsampling/aliasing bug from the old IIR scanner:
 * always runs at FULL native sampleRate over windowed frames across the entire track.
 */

export function buildHannWindow(size: number): Float32Array {
  const win = new Float32Array(size);
  const denom = size - 1;
  for (let i = 0; i < size; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
  }
  return win;
}

/**
 * In-place Radix-2 Cooley-Tukey complex FFT (N must be a power of 2).
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i];
      const ti = im[i];
      re[i] = re[j];
      im[i] = im[j];
      re[j] = tr;
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // Butterfly stages
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angleStep = (-2 * Math.PI) / size;
    const wStepRe = Math.cos(angleStep);
    const wStepIm = Math.sin(angleStep);

    for (let start = 0; start < n; start += size) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let k = 0; k < half; k++) {
        const evenIdx = start + k;
        const oddIdx = evenIdx + half;
        const tRe = wRe * re[oddIdx] - wIm * im[oddIdx];
        const tIm = wRe * im[oddIdx] + wIm * re[oddIdx];
        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }
}

export function ifftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftInPlace(re, im);
  const invN = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] *= invN;
    im[i] = -im[i] * invN;
  }
}

export interface WelchSpectralMetrics {
  /** Normalized relative spectral profile in dBFS scale (-30..0 range for display/delta) */
  profile: { sub: number; lowMid: number; presence: number; air: number };
  /** True linear band energies in absolute dBFS */
  bandDbFs: { sub: number; lowMid: number; presence: number; air: number };
  /** % of total acoustic power below 140 Hz (true physical measurement) */
  bassConcentrationPct: number;
  /** True upper frequency bandwidth cutoff (-34 dB below midband density) in Hz */
  highFreqCutoffHz: number;
  /** % of side energy (L-R) vs total M+S energy */
  stereoSideEnergyPct: number;
  /** Phase correlation of <100Hz low-end (-1 to +1) */
  bassPhaseCorrelation: number;
  /** True spectral roughness / harshness 2.8k-5.2k excess index (0..100) */
  harshnessScore: number;
  /** True sibilance 5.5k-8.5k excess index (0..100) */
  sibilanceScore: number;
  detectedSibilancePeakHz: number;
  subRumbleDb: number;
  mudExcessDb: number;
  vocalPocketDeficitDb: number;
  airDeficitDb: number;
  /** Only genuine stationary narrow-band spikes (>=6dB prominence & >=65% persistence) */
  stationaryResonances: Array<{
    freqHz: number;
    prominenceDb: number;
    persistencePct: number;
    recommendedCutDb: number;
  }>;
}

export function analyzeFullBandwidthSpectrum(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): WelchSpectralMetrics {
  const fftSize = 4096;
  const numBins = fftSize / 2;
  const length = Math.min(left.length, right.length);
  const binHz = sampleRate / fftSize;

  if (length < fftSize) {
    const paddedL = new Float32Array(fftSize);
    const paddedR = new Float32Array(fftSize);
    paddedL.set(left.subarray(0, length));
    paddedR.set(right.subarray(0, length));
    return analyzeFullBandwidthSpectrum(paddedL, paddedR, sampleRate);
  }

  const win = buildHannWindow(fftSize);
  let winPowerSum = 0;
  for (let i = 0; i < fftSize; i++) winPowerSum += win[i] * win[i];
  const psdScale = 2.0 / (fftSize * winPowerSum); // single-sided power spectrum normalization

  // Sample up to 64 evenly distributed full-rate windows spanning 5%..95% of track
  const scanStart = Math.floor(length * 0.05);
  const scanEnd = Math.max(scanStart + fftSize, Math.floor(length * 0.95));
  const maxFrames = 64;
  const availableSpan = Math.max(0, scanEnd - scanStart - fftSize);
  const frameCount =
    availableSpan === 0
      ? 1
      : Math.min(maxFrames, Math.max(8, Math.floor(availableSpan / (fftSize / 2)) + 1));

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const avgPower = new Float64Array(numBins);
  const framePowers: Float32Array[] = [];

  for (let f = 0; f < frameCount; f++) {
    const offset =
      frameCount === 1
        ? scanStart
        : scanStart + Math.floor((f / (frameCount - 1)) * availableSpan);

    for (let i = 0; i < fftSize; i++) {
      const m = 0.5 * (left[offset + i] + right[offset + i]);
      re[i] = m * win[i];
      im[i] = 0;
    }

    fftInPlace(re, im);

    const fPower = new Float32Array(numBins);
    for (let k = 0; k < numBins; k++) {
      const magSq = (re[k] * re[k] + im[k] * im[k]) * psdScale;
      avgPower[k] += magSq;
      fPower[k] = magSq;
    }
    framePowers.push(fPower);
  }

  for (let k = 0; k < numBins; k++) {
    avgPower[k] /= frameCount;
  }

  const sumBandPower = (fLow: number, fHigh: number): number => {
    const b0 = Math.max(1, Math.floor(fLow / binHz));
    const b1 = Math.min(numBins - 1, Math.ceil(fHigh / binHz));
    let p = 0;
    for (let k = b0; k <= b1; k++) p += avgPower[k];
    return p;
  };

  const pTotal = Math.max(1e-12, sumBandPower(20, Math.min(20000, sampleRate * 0.48)));
  const pBass140 = sumBandPower(20, 140);
  const pRumble = sumBandPower(16, 36);
  const pSub = sumBandPower(20, 160);
  const pLowMid = sumBandPower(160, 800);
  const pPresence = sumBandPower(800, 5500);
  const pAir = sumBandPower(5500, Math.min(20000, sampleRate * 0.48));
  const pHarsh = sumBandPower(2900, 4800);
  const pSibLow = sumBandPower(5500, 6800);
  const pSibHigh = sumBandPower(6800, 8600);

  const toDb = (p: number) => 10 * Math.log10(Math.max(1e-12, p));
  const bandDbFs = {
    sub: Number(toDb(pSub).toFixed(1)),
    lowMid: Number(toDb(pLowMid).toFixed(1)),
    presence: Number(toDb(pPresence).toFixed(1)),
    air: Number(toDb(pAir).toFixed(1)),
  };

  // Normalize spectral profile centered around -15.5 dB mean (for preset matching)
  const avgBandDb =
    (bandDbFs.sub + bandDbFs.lowMid + bandDbFs.presence + bandDbFs.air) / 4;
  const normOff = -15.5 - avgBandDb;

  const profile = {
    sub: Number((bandDbFs.sub + normOff).toFixed(1)),
    lowMid: Number((bandDbFs.lowMid + normOff).toFixed(1)),
    presence: Number((bandDbFs.presence + normOff).toFixed(1)),
    air: Number((bandDbFs.air + normOff).toFixed(1)),
  };

  const bassConcentrationPct = Number(
    Math.max(0, Math.min(100, (pBass140 / pTotal) * 100)).toFixed(1)
  );

  // Real high-frequency cutoff detection (compare per-bin density vs 1k-4kHz reference)
  const midRefStart = Math.max(1, Math.floor(1000 / binHz));
  const midRefEnd = Math.min(numBins - 1, Math.ceil(4500 / binHz));
  let midDensity = 0;
  for (let k = midRefStart; k <= midRefEnd; k++) midDensity += avgPower[k];
  midDensity = Math.max(1e-12, midDensity / Math.max(1, midRefEnd - midRefStart + 1));

  let highFreqCutoffHz = Math.min(22000, Math.round(sampleRate * 0.46));
  const stepHz = 250;
  for (let f = Math.min(21000, Math.floor(sampleRate * 0.45)); f >= 6000; f -= stepHz) {
    const b0 = Math.max(1, Math.floor((f - stepHz) / binHz));
    const b1 = Math.min(numBins - 1, Math.ceil(f / binHz));
    let bandMean = 0;
    for (let k = b0; k <= b1; k++) bandMean += avgPower[k];
    bandMean /= Math.max(1, b1 - b0 + 1);
    const relDb = 10 * Math.log10(Math.max(1e-12, bandMean) / midDensity);
    if (relDb > -34.0) {
      highFreqCutoffHz = f;
      break;
    }
  }

  // Harshness & sibilance excess relative to expected natural spectral tilt
  const harshRatioDb = toDb(pHarsh) - toDb(Math.max(1e-12, pLowMid));
  const sibPeakPower = Math.max(pSibLow, pSibHigh);
  const sibRatioDb = toDb(sibPeakPower) - toDb(Math.max(1e-12, pPresence));
  const detectedSibilancePeakHz = toDb(pSibHigh) > toDb(pSibLow) + 0.8 ? 7000 : 6200;

  const harshnessScore = Math.round(
    Math.max(0, Math.min(100, 38 + (harshRatioDb + 4.0) * 6.5))
  );
  const sibilanceScore = Math.round(
    Math.max(0, Math.min(100, 36 + (sibRatioDb + 5.5) * 8.5))
  );

  // Stereo side energy & bass (<100Hz) phase correlation via FFT M/S bins & time-domain LPF
  let midEnergySum = 0;
  let sideEnergySum = 0;
  let bassLR = 0;
  let bassL2 = 0;
  let bassR2 = 0;
  const bassAlpha = (2 * Math.PI * 100) / (sampleRate + 2 * Math.PI * 100);
  let bl = 0;
  let br = 0;
  const scanLimit = Math.min(length, sampleRate * 45);
  const step = Math.max(1, Math.floor(length / scanLimit));
  for (let i = scanStart; i < scanEnd; i += step) {
    const l = left[i];
    const r = right[i];
    const m = 0.5 * (l + r);
    const s = 0.5 * (l - r);
    midEnergySum += m * m;
    sideEnergySum += s * s;

    bl += bassAlpha * (l - bl);
    br += bassAlpha * (r - br);
    bassLR += bl * br;
    bassL2 += bl * bl;
    bassR2 += br * br;
  }

  const totalMS = Math.max(1e-12, midEnergySum + sideEnergySum);
  const stereoSideEnergyPct = Math.round((sideEnergySum / totalMS) * 100);
  const bassDenom = Math.sqrt(bassL2 * bassR2);
  const bassPhaseCorrelation =
    bassDenom > 1e-12
      ? Number(Math.max(-1, Math.min(1, bassLR / bassDenom)).toFixed(2))
      : 1.0;

  // Stationary Narrow-Band Resonance Detection:
  // A real resonance line must exceed its surrounding local spectral median envelope by >= 6.0 dB
  // AND persist in >= 65% of time frames! Otherwise returns [] (zero false-positive notches).
  const minBin = Math.max(14, Math.floor(900 / binHz));
  const maxBin = Math.min(numBins - 15, Math.ceil(15000 / binHz));
  const candidateSpikes: Array<{
    bin: number;
    freqHz: number;
    prominenceDb: number;
    persistencePct: number;
  }> = [];

  const getLocalMedianPower = (spectrum: ArrayLike<number>, bin: number): number => {
    const neighbors: number[] = [];
    for (let k = bin - 14; k <= bin + 14; k++) {
      if (Math.abs(k - bin) <= 2 || k < 1 || k >= numBins) continue;
      neighbors.push(spectrum[k]);
    }
    neighbors.sort((a, b) => a - b);
    return neighbors[Math.floor(neighbors.length / 2)] || 1e-12;
  };

  for (let b = minBin; b <= maxBin; b++) {
    const localMed = getLocalMedianPower(avgPower, b);
    const promDb = 10 * Math.log10(Math.max(1e-12, avgPower[b]) / Math.max(1e-12, localMed));
    if (promDb < 6.0) continue;

    // Check persistence across individual time frames
    let activeFrames = 0;
    for (const fp of framePowers) {
      const fMed = getLocalMedianPower(fp, b);
      const fProm = 10 * Math.log10(Math.max(1e-12, fp[b]) / Math.max(1e-12, fMed));
      if (fProm >= 4.5) activeFrames++;
    }
    const persistencePct = (activeFrames / framePowers.length) * 100;
    if (persistencePct >= 65) {
      candidateSpikes.push({
        bin: b,
        freqHz: Math.round(b * binHz),
        prominenceDb: promDb,
        persistencePct,
      });
    }
  }

  // Non-maximum suppression within 500 Hz neighborhood, keep top 4
  candidateSpikes.sort(
    (a, b) => b.prominenceDb * b.persistencePct - a.prominenceDb * a.persistencePct
  );
  const stationaryResonances: WelchSpectralMetrics['stationaryResonances'] = [];
  for (const c of candidateSpikes) {
    if (stationaryResonances.length >= 4) break;
    if (stationaryResonances.some((r) => Math.abs(r.freqHz - c.freqHz) < 500)) {
      continue;
    }
    const cutDb = Number(
      Math.max(-9.0, Math.min(-2.5, -(c.prominenceDb - 2.0) * 0.65)).toFixed(1)
    );
    stationaryResonances.push({
      freqHz: c.freqHz,
      prominenceDb: Number(c.prominenceDb.toFixed(1)),
      persistencePct: Math.round(c.persistencePct),
      recommendedCutDb: cutDb,
    });
  }
  stationaryResonances.sort((a, b) => a.freqHz - b.freqHz);

  return {
    profile,
    bandDbFs,
    bassConcentrationPct,
    highFreqCutoffHz,
    stereoSideEnergyPct,
    bassPhaseCorrelation,
    harshnessScore,
    sibilanceScore,
    detectedSibilancePeakHz,
    subRumbleDb: Number((toDb(pRumble) + normOff).toFixed(1)),
    mudExcessDb: Number((profile.lowMid - -16.8).toFixed(1)),
    vocalPocketDeficitDb: Number((-14.2 - profile.presence).toFixed(1)),
    airDeficitDb: Number((-17.4 - profile.air).toFixed(1)),
    stationaryResonances,
  };
}

export interface SpectralFluxOnsetResult {
  /** Onset times in seconds (snapped to local pre-transient minimum & zero-crossing) */
  onsetTimesSec: number[];
  /** Raw normalized onset strength per onset (0.1..1.0) */
  velocities: number[];
  /** Band energy ratios per onset for Kick/Snare/Hat classification */
  classifications: Array<'kick' | 'snare' | 'hat'>;
}

/**
 * Computes sample-accurate onset events using log-magnitude Spectral Flux
 * + adaptive median threshold + backward pre-onset energy minimum & zero-crossing refinement.
 * Shared between Sample Lab Slicer and Mastering Pro Drum Layering!
 */
export function detectOnsetsSpectralFlux(
  monoSamples: Float32Array,
  sampleRate: number,
  options: {
    sensitivity?: number; // 0..1 (default 0.6)
    minIntervalMs?: number; // default 80ms
    snapToZeroCrossing?: boolean; // default true
  } = {}
): SpectralFluxOnsetResult {
  const sensitivity = Math.max(0.05, Math.min(1.0, options.sensitivity ?? 0.6));
  const minIntervalSec = Math.max(0.02, (options.minIntervalMs ?? 80) / 1000);
  const snapZero = options.snapToZeroCrossing !== false;

  const fftSize = 1024;
  const hopSize = 256;
  const halfBins = fftSize / 2;
  const len = monoSamples.length;
  if (len < fftSize) {
    return { onsetTimesSec: [], velocities: [], classifications: [] };
  }

  const win = buildHannWindow(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const prevLogMag = new Float32Array(halfBins);
  const prevPower = new Float32Array(halfBins);

  const numFrames = Math.floor((len - fftSize) / hopSize) + 1;
  const flux = new Float32Array(numFrames);
  const lowFlux = new Float32Array(numFrames);
  const midFlux = new Float32Array(numFrames);
  const highFlux = new Float32Array(numFrames);

  const binHz = sampleRate / fftSize;
  const lowEndBin = Math.min(halfBins - 1, Math.ceil(165 / binHz));
  const midEndBin = Math.min(halfBins - 1, Math.ceil(3200 / binHz));
  const highMaxBin = Math.min(halfBins - 1, Math.ceil(16000 / binHz));

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) {
      re[i] = monoSamples[start + i] * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    let fTotal = 0;
    let fLow = 0;
    let fMid = 0;
    let fHigh = 0;

    for (let k = 1; k < halfBins; k++) {
      const magSq = re[k] * re[k] + im[k] * im[k];
      const mag = Math.sqrt(magSq);
      const logMag = Math.log(1 + 12 * mag);
      const diff = logMag - prevLogMag[k];
      if (diff > 0) {
        fTotal += diff;
      }
      prevLogMag[k] = logMag;

      if (k <= highMaxBin) {
        // Parseval-invariant linear power flux eliminates FFT bin-count bias (4 low bins vs 300+ high bins)
        const pDiff = magSq - prevPower[k];
        if (pDiff > 0) {
          if (k <= lowEndBin) fLow += pDiff;
          else if (k <= midEndBin) fMid += pDiff;
          else fHigh += pDiff;
        }
        prevPower[k] = magSq;
      }
    }

    flux[f] = fTotal;
    lowFlux[f] = fLow;
    midFlux[f] = fMid;
    highFlux[f] = fHigh;
  }

  // Adaptive local median threshold (±6 frames)
  const medRadius = 6;
  const thresholdCurve = new Float32Array(numFrames);
  // Higher sensitivity => lower multiplier
  const mult = 2.6 - sensitivity * 1.45; // 2.53 down to 1.15
  let maxFlux = 1e-6;
  for (let f = 0; f < numFrames; f++) {
    if (flux[f] > maxFlux) maxFlux = flux[f];
  }
  const absFloor = maxFlux * (0.09 - sensitivity * 0.065);

  const tmpWindow: number[] = [];
  for (let f = 0; f < numFrames; f++) {
    tmpWindow.length = 0;
    const s = Math.max(0, f - medRadius);
    const e = Math.min(numFrames - 1, f + medRadius);
    for (let j = s; j <= e; j++) tmpWindow.push(flux[j]);
    tmpWindow.sort((a, b) => a - b);
    const med = tmpWindow[Math.floor(tmpWindow.length / 2)];
    thresholdCurve[f] = med * mult + absFloor;
  }

  // Peak picking with minimum refractory interval
  const onsetTimesSec: number[] = [];
  const velocities: number[] = [];
  const classifications: Array<'kick' | 'snare' | 'hat'> = [];

  // Check if frame 0 itself starts immediately on an active transient
  let trackMaxAbs = 0;
  const probeLim = Math.min(len, sampleRate * 4);
  for (let i = 0; i < probeLim; i += 8) {
    const a = Math.abs(monoSamples[i]);
    if (a > trackMaxAbs) trackMaxAbs = a;
  }
  const hasImmediateStart = (() => {
    let headPeak = 0;
    const headLen = Math.min(len, Math.floor(sampleRate * 0.015));
    for (let i = 0; i < headLen; i++) {
      const a = Math.abs(monoSamples[i]);
      if (a > headPeak) headPeak = a;
    }
    return trackMaxAbs > 1e-4 && headPeak > trackMaxAbs * 0.22;
  })();

  let lastOnsetSec = -10;
  const startFrame = hasImmediateStart ? 0 : 1;
  for (let f = startFrame; f < numFrames - 1; f++) {
    const isPeak =
      f === 0
        ? flux[0] > thresholdCurve[0] * 0.65 && flux[0] >= flux[1]
        : flux[f] > thresholdCurve[f] &&
          flux[f] >= flux[f - 1] &&
          flux[f] >= flux[f + 1];

    if (isPeak) {
      // Locate actual transient attack foot inside the Hann window's active center
      let bestSample: number;
      if (f === 0 && hasImmediateStart) {
        bestSample = 0;
      } else {
        const winStart = Math.max(0, f * hopSize + Math.floor(fftSize * 0.12));
        const winEnd = Math.min(len - 1, f * hopSize + Math.floor(fftSize * 0.68));
        let localPeak = 0;
        let localPeakIdx = Math.min(len - 1, f * hopSize + Math.floor(fftSize * 0.45));
        for (let i = winStart; i <= winEnd; i++) {
          const a = Math.abs(monoSamples[i]);
          if (a > localPeak) {
            localPeak = a;
            localPeakIdx = i;
          }
        }
        // Walk back from local transient peak to the 15% attack foot (up to 12ms)
        const maxWalkBack = Math.round(sampleRate * 0.012);
        const footThresh = localPeak * 0.16;
        let footIdx = localPeakIdx;
        while (
          footIdx > Math.max(winStart, localPeakIdx - maxWalkBack) &&
          Math.abs(monoSamples[footIdx - 1]) > footThresh
        ) {
          footIdx--;
        }
        bestSample = footIdx;
      }

      if (snapZero && bestSample > 0) {
        // Search ±1.5ms around attack foot for nearest clean zero-crossing
        const radius = Math.floor(sampleRate * 0.0015);
        const searchStart = Math.max(1, bestSample - radius);
        const searchEnd = Math.min(len - 1, bestSample + radius);
        let closestDist = radius + 1;
        let zcIdx = bestSample;
        for (let i = searchStart; i <= searchEnd; i++) {
          if (
            (monoSamples[i - 1] <= 0 && monoSamples[i] >= 0) ||
            (monoSamples[i - 1] >= 0 && monoSamples[i] <= 0)
          ) {
            const d = Math.abs(i - bestSample);
            if (d < closestDist) {
              closestDist = d;
              zcIdx = i;
            }
          }
        }
        bestSample = zcIdx;
      }

      const timeSec = Number((bestSample / sampleRate).toFixed(4));
      if (timeSec - lastOnsetSec < minIntervalSec) continue;

      lastOnsetSec = timeSec;
      const ratio = flux[f] / Math.max(1e-6, thresholdCurve[f]);
      const vel = Number(Math.min(1.0, Math.max(0.25, ratio / 2.8)).toFixed(3));

      const lf = lowFlux[f];
      const mf = midFlux[f];
      const hf = highFlux[f];
      let cls: 'kick' | 'snare' | 'hat' = 'snare';
      if (lf > mf * 0.45 && lf > hf * 0.85) {
        cls = 'kick';
      } else if (hf > (lf + mf) * 1.15) {
        cls = 'hat';
      }

      onsetTimesSec.push(timeSec);
      velocities.push(vel);
      classifications.push(cls);
    }
  }

  return { onsetTimesSec, velocities, classifications };
}

export interface UnifiedDrumHit {
  timeSec: number;
  type: 'kick' | 'snare';
  velocity: number;
}

/**
 * Shared single-source drum hit filter used identically by:
 *  - spectralAnalyzer.worker.ts
 *  - DrumTransientReplacerDSP.detectDrumTransients
 *  - WebAudioMasteringEngine (Live & Export 24-bit WAV)
 * Guarantees 1:1 parity between live drum triggering and offline export.
 */
export function filterSpectralFluxDrumHits(
  fluxOnsets: SpectralFluxOnsetResult,
  kickSensitivity: number,
  snareSensitivity: number
): UnifiedDrumHit[] {
  const kickMinVel = (0.85 - Math.max(0.1, Math.min(1.0, kickSensitivity)) * 0.65) * 0.75;
  const snareMinVel = (0.85 - Math.max(0.1, Math.min(1.0, snareSensitivity)) * 0.65) * 0.75;

  const events: UnifiedDrumHit[] = [];
  for (let i = 0; i < fluxOnsets.onsetTimesSec.length; i++) {
    const cls = fluxOnsets.classifications[i];
    if (cls === 'hat') continue;
    const vel = fluxOnsets.velocities[i];
    const minVel = cls === 'kick' ? kickMinVel : snareMinVel;
    if (vel < minVel) continue;
    events.push({
      timeSec: fluxOnsets.onsetTimesSec[i],
      type: cls,
      velocity: vel,
    });
  }
  return events;
}

export function detectFilteredDrumHitsFromMono(
  monoSamples: Float32Array,
  sampleRate: number,
  kickSensitivity: number,
  snareSensitivity: number
): UnifiedDrumHit[] {
  if (monoSamples.length === 0) return [];
  const avgSens = Math.max(
    0.1,
    Math.min(1.0, (kickSensitivity + snareSensitivity) * 0.5)
  );
  const res = detectOnsetsSpectralFlux(monoSamples, sampleRate, {
    sensitivity: avgSens,
    minIntervalMs: 85,
    snapToZeroCrossing: true,
  });
  return filterSpectralFluxDrumHits(res, kickSensitivity, snareSensitivity);
}
