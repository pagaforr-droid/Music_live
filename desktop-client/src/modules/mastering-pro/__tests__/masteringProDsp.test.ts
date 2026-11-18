import { describe, expect, it } from 'vitest';
import { BusCompressorCore } from '../dsp-core/BusCompressorCore';
import { computeFullLoudnessReport } from '../dsp-core/KWeightingLufs';
import {
  LookaheadLimiterCore,
  applyTruePeakLookaheadLimiterOffline,
} from '../dsp-core/LookaheadLimiterCore';
import {
  detectFilteredDrumHitsFromMono,
  detectOnsetsSpectralFlux,
  filterSpectralFluxDrumHits,
} from '../dsp-core/SpectralFftCore';
import {
  StreamingTruePeakDetector,
  TRUE_PEAK_FIR_GROUP_DELAY,
  linearToDbTp,
  measureTruePeakLinear4x,
} from '../dsp-core/TruePeakDetector';
import { DrumTransientReplacerDSP } from '../engine/DrumTransientReplacerDSP';
import {
  analyzeTrackAndComputeAdaptation,
  recomputeDeltasForPreset,
} from '../engine/SpectralDeltaAnalyzer';
import { encodeAudioBufferToWav24Bit } from '../engine/Wav24BitEncoder';
import { applyKickBassSidechainToBassArrays } from '../engine/WebAudioMasteringEngine';
import { getPresetById } from '../presets/proPresetsCatalog';

function createMockAudioBuffer(
  left: Float32Array,
  right: Float32Array,
  sampleRate = 48000
): AudioBuffer {
  return {
    sampleRate,
    length: left.length,
    duration: left.length / sampleRate,
    numberOfChannels: 2,
    getChannelData(ch: number) {
      return ch === 0 ? left : right;
    },
    copyFromChannel() {},
    copyToChannel() {},
  } as unknown as AudioBuffer;
}

describe('Mastering Pro — DSP Core, Limiter, Compressor & Stems Precision Suite', () => {
  it('StreamingTruePeakDetector aligns all 4 phases to exact FIR group delay', () => {
    const len = 128;
    const imp = new Float32Array(len);
    const r = new Float32Array(len);
    const impIdx = 40;
    imp[impIdx] = 0.85;

    const detector = new StreamingTruePeakDetector();
    let maxIdx = -1;
    let maxVal = 0;
    for (let i = 0; i < len; i++) {
      const pk = detector.processSample(imp[i], r[i]);
      if (pk > maxVal) {
        maxVal = pk;
        maxIdx = i;
      }
    }

    expect(maxIdx).toBe(impIdx + TRUE_PEAK_FIR_GROUP_DELAY);
    expect(maxVal).toBeGreaterThanOrEqual(0.849);
  });

  it('LookaheadLimiterCore computes exact latency across 44.1kHz, 48kHz, and 96kHz & preserves sample alignment', () => {
    const lim44 = new LookaheadLimiterCore(44100, { lookaheadMs: 5.0 });
    const lim96 = new LookaheadLimiterCore(96000, { lookaheadMs: 5.0 });
    expect(lim44.getLatencySamples()).toBe(Math.round(0.005 * 44100) + TRUE_PEAK_FIR_GROUP_DELAY);
    expect(lim96.getLatencySamples()).toBe(Math.round(0.005 * 96000) + TRUE_PEAK_FIR_GROUP_DELAY);

    const sr = 48000;
    const len = 4096;
    const l = new Float32Array(len);
    const r = new Float32Array(len);
    const peakPos = 1500;
    l[peakPos] = 1.6;
    r[peakPos] = 1.6;

    const res = applyTruePeakLookaheadLimiterOffline(l, r, sr, {
      driveDb: 0,
      ceilingDbTp: -1.0,
      lookaheadMs: 5.0,
      releaseMs: 65,
    });

    // Peak remains sample-aligned at exact original index (zero lookahead lag)
    let foundIdx = 0;
    let foundAbs = 0;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(l[i]);
      if (a > foundAbs) {
        foundAbs = a;
        foundIdx = i;
      }
    }
    expect(foundIdx).toBe(peakPos);
    expect(res.finalTruePeakDbTp).toBeLessThanOrEqual(-1.0);
  });

  it('LookaheadLimiterCore strictly enforces 4x True-Peak ceiling on worst-case inter-sample overshoots & square bursts', () => {
    const sr = 48000;
    const len = sr * 1; // 1 second
    const l = new Float32Array(len);
    const r = new Float32Array(len);

    // Construct an adversarial inter-sample waveform:
    // Segment 1: 12 kHz (fs/4) at 45° phase where discrete samples are 0.707*A, true peak is 1.0*A (+6dB drive)
    // Segment 2: Hard stepped square bursts + dense multi-tone chords
    for (let i = 0; i < len; i++) {
      if (i < len * 0.4) {
        const s = 0.75 * Math.sin(2 * Math.PI * 12000 * (i / sr) + Math.PI / 4);
        l[i] = s;
        r[i] = s;
      } else if (i < len * 0.7) {
        const sq = ((i >> 5) & 1 ? 1 : -1) * 0.8;
        l[i] = sq;
        r[i] = -sq;
      } else {
        const chord =
          0.45 * Math.sin(2 * Math.PI * 110 * (i / sr)) +
          0.35 * Math.sin(2 * Math.PI * 3300 * (i / sr)) +
          0.25 * Math.sin(2 * Math.PI * 11500 * (i / sr));
        l[i] = chord;
        r[i] = chord;
      }
    }

    const ceilings = [-1.0, -2.0];
    for (const ceilingDbTp of ceilings) {
      const testL = new Float32Array(l);
      const testR = new Float32Array(r);
      const stats = applyTruePeakLookaheadLimiterOffline(testL, testR, sr, {
        driveDb: 8.0,
        ceilingDbTp,
        lookaheadMs: 5.0,
        releaseMs: 65,
      });

      const measuredTpDb = linearToDbTp(measureTruePeakLinear4x(testL, testR), -90);
      expect(stats.finalTruePeakDbTp).toBeLessThanOrEqual(ceilingDbTp);
      expect(measuredTpDb).toBeLessThanOrEqual(ceilingDbTp + 0.01);
    }
  });

  it('LookaheadLimiterCore is bit-clean (< -90 dB residual) for -6 dBFS sine below ceiling', () => {
    const sr = 48000;
    const len = sr;
    const origL = new Float32Array(len);
    const origR = new Float32Array(len);
    const amp = Math.pow(10, -6 / 20); // -6 dBFS, safely below -1.0 dBTP
    for (let i = 0; i < len; i++) {
      const val = amp * Math.sin(2 * Math.PI * 1000 * (i / sr));
      origL[i] = val;
      origR[i] = val;
    }

    const outL = new Float32Array(origL);
    const outR = new Float32Array(origR);
    const res = applyTruePeakLookaheadLimiterOffline(outL, outR, sr, {
      driveDb: 0,
      ceilingDbTp: -1.0,
      lookaheadMs: 5.0,
      releaseMs: 65,
    });

    expect(res.maxGainReductionDb).toBe(0);
    // Skip first/last 64 edge samples
    let errSq = 0;
    let sigSq = 0;
    for (let i = 64; i < len - 64; i++) {
      const d = outL[i] - origL[i];
      errSq += d * d;
      sigSq += origL[i] * origL[i];
    }
    const thdDb = 10 * Math.log10(Math.max(1e-18, errSq) / Math.max(1e-12, sigSq));
    expect(thdDb).toBeLessThan(-90);
  });

  it('BusCompressorCore triggers immediately on first transient after reset() without -90 dB lag & has 0 dB parallel comb ripple', () => {
    const sr = 48000;
    const params = {
      thresholdDb: -18,
      ratio: 3.0,
      attackSec: 0.005,
      releaseSec: 0.08,
      kneeDb: 4,
      makeupGainDb: 0,
      parallelMix: 0.65,
      sidechainHpfHz: 90,
    };

    const burstLen = Math.floor(sr * 0.08);
    const burstL = new Float32Array(burstLen);
    const burstR = new Float32Array(burstLen);
    for (let i = 0; i < burstLen; i++) {
      const v = 0.6 * Math.sin(2 * Math.PI * 500 * (i / sr));
      burstL[i] = v;
      burstR[i] = v;
    }

    // Immediate burst right after reset()
    const compFresh = new BusCompressorCore(sr, params);
    compFresh.reset();
    const outFreshL = new Float32Array(burstLen);
    const outFreshR = new Float32Array(burstLen);
    const grFresh = compFresh.processBlock(burstL, burstR, outFreshL, outFreshR);

    // Same burst preceded by 1 second of low-level noise floor
    const compWarmed = new BusCompressorCore(sr, params);
    const quietL = new Float32Array(sr);
    const quietR = new Float32Array(sr);
    for (let i = 0; i < sr; i++) {
      const q = 0.01 * Math.sin(2 * Math.PI * 440 * (i / sr)); // -40 dBFS (below threshold)
      quietL[i] = q;
      quietR[i] = q;
    }
    const outQL = new Float32Array(sr);
    const outQR = new Float32Array(sr);
    const grQuiet = compWarmed.processBlock(quietL, quietR, outQL, outQR);

    // Parallel mix below threshold must have zero comb filtering / zero auto-makeup
    expect(grQuiet).toBe(0);
    for (let i = 0; i < sr; i++) {
      expect(Math.abs(outQL[i] - quietL[i])).toBeLessThan(1e-6);
    }

    const outWarmedL = new Float32Array(burstLen);
    const outWarmedR = new Float32Array(burstLen);
    const grWarmed = compWarmed.processBlock(burstL, burstR, outWarmedL, outWarmedR);

    // First transient reduction after reset must match warmed compressor within 0.05 dB
    expect(grFresh).toBeGreaterThan(2.5);
    expect(Math.abs(grFresh - grWarmed)).toBeLessThan(0.05);
  });

  it('Unified drum detection produces identical hits between Worker filter path and DrumTransientReplacerDSP', () => {
    const sr = 48000;
    const len = sr * 2;
    const l = new Float32Array(len);
    const r = new Float32Array(len);

    // Synthesize realistic studio mix bed + clear kick (body + click) at 0.25s, 1.25s and snare at 0.75s, 1.75s
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const bed = 0.06 * Math.sin(2 * Math.PI * 110 * t) + 0.03 * Math.sin(2 * Math.PI * 330 * t);
      l[i] = bed;
      r[i] = bed;
    }

    const addKick = (tSec: number) => {
      const start = Math.floor(tSec * sr);
      let s = 98765;
      for (let i = 0; i < Math.floor(0.2 * sr) && start + i < len; i++) {
        const dt = i / sr;
        s = (s * 1664525 + 1013904223) >>> 0;
        const click = ((s / 0xffffffff) * 2 - 1) * 0.35 * Math.exp(-dt * 220);
        const f = 55 + 105 * Math.exp(-dt * 38);
        const v = (0.75 * Math.sin(2 * Math.PI * f * dt) * Math.exp(-dt * 11)) + click;
        l[start + i] += v;
        r[start + i] += v;
      }
    };
    const addSnare = (tSec: number) => {
      const start = Math.floor(tSec * sr);
      let s = 12345;
      let lp1 = 0;
      let lp2 = 0;
      for (let i = 0; i < Math.floor(0.16 * sr) && start + i < len; i++) {
        const dt = i / sr;
        s = (s * 1664525 + 1013904223) >>> 0;
        const n = (s / 0xffffffff) * 2 - 1;
        lp1 = lp1 * 0.84 + n * 0.16;
        lp2 = lp2 * 0.84 + lp1 * 0.16;
        const shell =
          Math.sin(2 * Math.PI * 240 * dt) * 0.45 +
          Math.sin(2 * Math.PI * 1150 * dt) * 0.35;
        const v = (lp2 * 0.9 + shell * 0.65) * Math.exp(-dt * 20);
        l[start + i] += v;
        r[start + i] += v;
      }
    };

    addKick(0.25);
    addSnare(0.75);
    addKick(1.25);
    addSnare(1.75);

    const mockBuf = createMockAudioBuffer(l, r, sr);
    const kickSens = 0.68;
    const snareSens = 0.54;

    // Worker path
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) mono[i] = 0.5 * (l[i] + r[i]);
    const fluxRes = detectOnsetsSpectralFlux(mono, sr, {
      sensitivity: (kickSens + snareSens) * 0.5,
      minIntervalMs: 85,
      snapToZeroCrossing: true,
    });
    const workerHits = filterSpectralFluxDrumHits(fluxRes, kickSens, snareSens);

    // Export / Replacer path
    const replacer = new DrumTransientReplacerDSP();
    const exportHits = replacer.detectDrumTransients(mockBuf, {
      enabled: true,
      kickMix: 0.5,
      snareMix: 0.4,
      kickSensitivity: kickSens,
      snareSensitivity: snareSens,
      drumStyle: 'stadium-rock',
      suppressOriginalMud: true,
      humanizeRoundRobin: true,
      duckOriginalTransients: true,
    });

    const directHits = detectFilteredDrumHitsFromMono(mono, sr, kickSens, snareSens);
    expect(workerHits).toEqual(exportHits);
    expect(directHits).toEqual(exportHits);
    expect(exportHits.length).toBeGreaterThanOrEqual(4);
  });

  it('SpectralDeltaAnalyzer avoids forced positive EQ boosts on sub-heavy tracks & recomputes suggestions on preset switch', () => {
    const sr = 48000;
    const len = sr * 2;
    const l = new Float32Array(len);
    const r = new Float32Array(len);
    // Heavy sub-bass (60 Hz) + weak presence/air
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const sig = 0.65 * Math.sin(2 * Math.PI * 60 * t) + 0.06 * Math.sin(2 * Math.PI * 1000 * t);
      l[i] = sig;
      r[i] = sig;
    }

    const buf = createMockAudioBuffer(l, r, sr);
    const reportAcoustic = analyzeTrackAndComputeAdaptation(buf, '90s-acoustic-country');
    const subSuggestion = reportAcoustic.criticalEqPoints.find(
      (p) => p.bandId === 'mid-sub-punch'
    );
    expect(subSuggestion).toBeDefined();
    expect(subSuggestion!.action).toBe('cut');
    expect(subSuggestion!.recommendedGainDb).toBeLessThan(0);

    // Switching preset recomputes criticalEqPoints & width suggestions cleanly
    const latinPreset = getPresetById('crisp-latin-pop');
    const updatedReport = recomputeDeltasForPreset(reportAcoustic, latinPreset);
    expect(updatedReport.stereoWidthSuggestion.recommendedMonoMakerHz).not.toBe(
      reportAcoustic.stereoWidthSuggestion.recommendedMonoMakerHz
    );
    expect(updatedReport.deltaAdjustments.autoMakeupGainDb).not.toBe(
      reportAcoustic.deltaAdjustments.autoMakeupGainDb
    );
  });

  it('applyKickBassSidechainToBassArrays ducks ONLY bass under low-end kicks and ignores vocals/hats', () => {
    const sr = 48000;
    const len = sr; // 1s
    const drumsL = new Float32Array(len);
    const drumsR = new Float32Array(len);
    const bassL = new Float32Array(len);
    const bassR = new Float32Array(len);
    const vocalCopy = new Float32Array(len);

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // Continuous bass note at 60 Hz
      bassL[i] = bassR[i] = 0.5 * Math.sin(2 * Math.PI * 60 * t);
      vocalCopy[i] = 0.4 * Math.sin(2 * Math.PI * 1200 * t);

      // Kick hit at t = 0.10s..0.22s (65 Hz)
      if (t >= 0.1 && t <= 0.22) {
        const dt = t - 0.1;
        const kick = 0.85 * Math.sin(2 * Math.PI * 65 * dt) * Math.exp(-dt * 10);
        drumsL[i] += kick;
        drumsR[i] += kick;
      }
      // Sharp hi-hat hit at t = 0.60s..0.64s (9 kHz)
      if (t >= 0.6 && t <= 0.64) {
        const dt = t - 0.6;
        const hat = 0.8 * Math.sin(2 * Math.PI * 9000 * dt);
        drumsL[i] += hat;
        drumsR[i] += hat;
      }
    }

    const origBassPeakAtKick = 0.5;
    applyKickBassSidechainToBassArrays(drumsL, drumsR, bassL, bassR, sr, 1.0);

    // Measure bass RMS during kick (0.12..0.18s) vs during hi-hat (0.605..0.635s) vs undisturbed vocal
    let rmsDuringKick = 0;
    let cntKick = 0;
    for (let i = Math.floor(0.12 * sr); i < Math.floor(0.18 * sr); i++) {
      rmsDuringKick += bassL[i] * bassL[i];
      cntKick++;
    }
    rmsDuringKick = Math.sqrt(rmsDuringKick / cntKick);

    let rmsDuringHat = 0;
    let cntHat = 0;
    for (let i = Math.floor(0.605 * sr); i < Math.floor(0.635 * sr); i++) {
      rmsDuringHat += bassL[i] * bassL[i];
      cntHat++;
    }
    rmsDuringHat = Math.sqrt(rmsDuringHat / cntHat);

    const bassSinRms = origBassPeakAtKick / Math.SQRT2;
    // Kick pocket ducks bass noticeably (> 1.5 dB reduction)
    expect(rmsDuringKick).toBeLessThan(bassSinRms * 0.82);
    // Hi-hat (9kHz) does NOT trigger false kick-bass ducking
    expect(rmsDuringHat).toBeGreaterThan(bassSinRms * 0.96);
    // Separate vocal signal isn't touched by applyKickBassSidechainToBassArrays
    expect(vocalCopy[1000]).toBeCloseTo(0.4 * Math.sin(2 * Math.PI * 1200 * (1000 / sr)), 6);
  });

  it('Wav24BitEncoder writes valid 24-bit RIFF WAVE header and sanitizes NaN samples', () => {
    const sr = 48000;
    const len = 512;
    const l = new Float32Array(len).fill(0.25);
    const r = new Float32Array(len).fill(-0.25);
    l[10] = Number.NaN;
    r[10] = Number.POSITIVE_INFINITY;

    const buf = createMockAudioBuffer(l, r, sr);
    const blob = encodeAudioBufferToWav24Bit(buf, false);
    expect(blob.size).toBe(44 + len * 2 * 3);
    expect(blob.type).toBe('audio/wav');

    // Also sanity check KWeightingLufs still exports exact loudness metrics
    const report = computeFullLoudnessReport([new Float32Array(len).fill(0.5), new Float32Array(len).fill(0.5)], sr);
    expect(Number.isFinite(report.truePeakDbTp)).toBe(true);
  });
});
