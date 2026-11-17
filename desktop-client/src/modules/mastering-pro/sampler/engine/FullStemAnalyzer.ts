import {
  buildHannWindow,
  detectOnsetsSpectralFlux,
  fftInPlace,
} from '../../dsp-core/SpectralFftCore';
import { detectPitchYin, midiNoteToName } from './PitchDetector';
import type {
  DrumPieceRole,
  FullStemAnalysisResult,
  StemAnalysisMode,
  StemDrumHitEvent,
  StemNoteEvent,
} from '../types/sampler.types';

export function inferStemModeFromName(rawName: string): StemAnalysisMode {
  const n = (rawName || '').toLowerCase();
  if (
    n.includes('drum') ||
    n.includes('bateria') ||
    n.includes('batería') ||
    n.includes('perc') ||
    n.includes('kick') ||
    n.includes('snare') ||
    n.includes('bombo') ||
    n.includes('caja')
  ) {
    return 'drums';
  }
  if (
    n.includes('bass') ||
    n.includes('bajo') ||
    n.includes('vocal') ||
    n.includes('voz') ||
    n.includes('lead') ||
    n.includes('sax') ||
    n.includes('solo')
  ) {
    return 'monophonic';
  }
  // Piano, Guitar, Keys, Strings, Synths, Other -> Polyphonic chord+melody analyzer
  return 'polyphonic';
}

export function estimateBpmFromOnsets(
  onsetTimesSec: number[],
  fallbackBpm = 120
): number {
  if (onsetTimesSec.length < 4) return fallbackBpm;
  const hist = new Map<number, number>();
  for (let i = 0; i < onsetTimesSec.length; i++) {
    for (let j = i + 1; j < Math.min(onsetTimesSec.length, i + 10); j++) {
      const dt = onsetTimesSec[j] - onsetTimesSec[i];
      if (dt < 0.25 || dt > 1.35) continue;
      let bpm = 60 / dt;
      while (bpm < 65) bpm *= 2;
      while (bpm > 175) bpm /= 2;
      const bucket = Math.round(bpm);
      hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
    }
  }
  let bestBpm = fallbackBpm;
  let bestCount = -1;
  for (const [b, c] of hist.entries()) {
    const score =
      c + (hist.get(b - 1) ?? 0) * 0.5 + (hist.get(b + 1) ?? 0) * 0.5;
    if (score > bestCount) {
      bestCount = score;
      bestBpm = b;
    }
  }
  return bestBpm;
}

/**
 * Classifies an acoustic transient window (~20ms) into kick / tom / snare / hat
 * using 512-pt FFT band ratios so drums in a full mix stem separate cleanly.
 */
function classifyDrumHitWindow(
  mono: Float32Array,
  sampleRate: number,
  onsetSample: number
): { role: DrumPieceRole; peakTimeSec: number; peakAmp: number } {
  const peakSearchEnd = Math.min(mono.length, onsetSample + Math.round(sampleRate * 0.02));
  let peakIdx = onsetSample;
  let peakAmp = 0;
  for (let i = Math.max(0, onsetSample); i < peakSearchEnd; i++) {
    const a = Math.abs(mono[i]);
    if (a > peakAmp) {
      peakAmp = a;
      peakIdx = i;
    }
  }

  const fftSize = 1024;
  const half = fftSize / 2;
  const start = Math.max(0, Math.min(mono.length - fftSize, onsetSample - 32));
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const win = buildHannWindow(fftSize);
  const avail = Math.min(fftSize, mono.length - start);
  for (let i = 0; i < avail; i++) {
    re[i] = mono[start + i] * win[i];
  }
  fftInPlace(re, im);

  const binHz = sampleRate / fftSize;
  let eSubKick = 0; // 28 - 135 Hz
  let eTomBody = 0; // 135 - 320 Hz
  let eSnareMid = 0; // 320 - 1800 Hz
  let eCrack = 0; // 1800 - 6000 Hz
  let eHat = 0; // 6000 - 17000 Hz

  for (let k = 1; k < half; k++) {
    const f = k * binHz;
    if (f < 28 || f > 17000) continue;
    const p = re[k] * re[k] + im[k] * im[k];
    if (f <= 135) eSubKick += p;
    else if (f <= 320) eTomBody += p;
    else if (f <= 1800) eSnareMid += p;
    else if (f <= 6000) eCrack += p;
    else eHat += p;
  }

  const total = Math.max(1e-12, eSubKick + eTomBody + eSnareMid + eCrack + eHat);
  const rKick = eSubKick / total;
  const rTom = eTomBody / total;
  const rCrackHat = (eCrack + eHat) / total;
  const rHat = eHat / total;

  let role: DrumPieceRole = 'snare';
  if (rHat > 0.34 && rKick < 0.14) {
    role = 'hat';
  } else if (rCrackHat > 0.56 && (rKick + rTom) < 0.18) {
    role = 'hat';
  } else if (rKick > 0.38 || (eSubKick > eTomBody * 1.1 && rKick > 0.24 && rCrackHat < 0.25)) {
    role = 'kick';
  } else if (rTom > 0.34 && rKick < 0.24 && rCrackHat < 0.24) {
    role = 'tom';
  } else {
    role = 'snare';
  }

  return {
    role,
    peakTimeSec: Number((peakIdx / sampleRate).toFixed(5)),
    peakAmp,
  };
}

/**
 * Analyzes an ENTIRE Drum stem without slice limits, preserving exact onset timestamps,
 * peak-to-peak phase positions, dynamic velocities, and kick/snare/hat/tom roles.
 */
export function analyzeDrumStemFull(
  mono: Float32Array,
  sampleRate: number,
  options: { sensitivity?: number; minIntervalMs?: number; bpmHint?: number } = {}
): FullStemAnalysisResult {
  const sensitivity = options.sensitivity ?? 0.62;
  const minIntervalMs = options.minIntervalMs ?? 65;
  const durationSec = mono.length / sampleRate;

  const res = detectOnsetsSpectralFlux(mono, sampleRate, {
    sensitivity,
    minIntervalMs,
    snapToZeroCrossing: true,
  });

  const rawHits: Array<{
    timeSec: number;
    peakTimeSec: number;
    role: DrumPieceRole;
    peakAmp: number;
  }> = [];

  for (let i = 0; i < res.onsetTimesSec.length; i++) {
    const timeSec = res.onsetTimesSec[i];
    const sampleIdx = Math.max(0, Math.round(timeSec * sampleRate));
    const classified = classifyDrumHitWindow(mono, sampleRate, sampleIdx);

    // Tail ripple guard: suppress weak random wire noise immediately inside decaying tail (<140ms) of a much louder hit
    const prev = rawHits[rawHits.length - 1];
    if (prev && timeSec - prev.timeSec < 0.145) {
      // Measure 25ms pre-onset RMS vs 15ms post-onset RMS to confirm genuine re-attack
      const preLen = Math.round(sampleRate * 0.025);
      const postLen = Math.round(sampleRate * 0.015);
      let preSq = 0;
      let postSq = 0;
      for (let k = Math.max(0, sampleIdx - preLen); k < sampleIdx; k++) {
        preSq += mono[k] * mono[k];
      }
      for (let k = sampleIdx; k < Math.min(mono.length, sampleIdx + postLen); k++) {
        postSq += mono[k] * mono[k];
      }
      const preRms = Math.sqrt(preSq / Math.max(1, preLen));
      const postRms = Math.sqrt(postSq / Math.max(1, postLen));
      if (postRms < preRms * 1.28 && classified.peakAmp < prev.peakAmp * 0.45) {
        continue;
      }
    }

    rawHits.push({
      timeSec,
      peakTimeSec: classified.peakTimeSec,
      role: classified.role,
      peakAmp: classified.peakAmp,
    });
  }

  // Normalize hit velocities relative to 95th percentile peak amplitude (preserves ghost notes!)
  const sortedAmps = rawHits.map((h) => h.peakAmp).sort((a, b) => a - b);
  const refAmp =
    sortedAmps.length > 0
      ? Math.max(1e-4, sortedAmps[Math.min(sortedAmps.length - 1, Math.floor(sortedAmps.length * 0.95))])
      : 1.0;

  let kickCount = 0;
  let snareCount = 0;
  let hatCount = 0;
  let tomCount = 0;

  const drumHits: StemDrumHitEvent[] = rawHits.map((h, idx) => {
    if (h.role === 'kick') kickCount++;
    else if (h.role === 'snare') snareCount++;
    else if (h.role === 'hat') hatCount++;
    else tomCount++;

    const vel = Number(Math.max(0.16, Math.min(1.0, h.peakAmp / refAmp)).toFixed(3));
    return {
      id: `dh-${idx}`,
      timeSec: h.timeSec,
      peakTimeSec: h.peakTimeSec,
      role: h.role,
      velocity: vel,
    };
  });

  const bpm = estimateBpmFromOnsets(
    drumHits.filter((h) => h.role === 'kick' || h.role === 'snare').map((h) => h.timeSec),
    options.bpmHint ?? 120
  );

  return {
    mode: 'drums',
    bpm,
    durationSec,
    drumHits,
    noteEvents: [],
    counts: {
      total: drumHits.length,
      kick: kickCount,
      snare: snareCount,
      hat: hatCount,
      tom: tomCount,
      notes: 0,
    },
  };
}

function getMedianNumber(vals: number[]): number {
  const c = [...vals].sort((a, b) => a - b);
  return c[Math.floor(c.length / 2)];
}

/**
 * Analyzes an entire monophonic melodic/bass stem (Bass, Solo Synth, Lead, Vocal)
 * using onset segmentation + sliding YIN fundamental tracking with median glitch rejection.
 */
export function analyzeMonophonicStemNotesFull(
  mono: Float32Array,
  sampleRate: number,
  options: { sensitivity?: number; minNoteMs?: number; bpmHint?: number; bassOnly?: boolean } = {}
): FullStemAnalysisResult {
  const durationSec = mono.length / sampleRate;
  const sensitivity = options.sensitivity ?? 0.62;
  const minNoteSec = (options.minNoteMs ?? 45) / 1000;
  const bassOnly = Boolean(options.bassOnly);
  const analysisSig = bassOnly ? filterBassIsolationBand(mono, sampleRate) : mono;

  const onsetsRes = detectOnsetsSpectralFlux(analysisSig, sampleRate, {
    sensitivity,
    minIntervalMs: 70,
    snapToZeroCrossing: false,
  });

  // Track peak RMS for adaptive silence gate
  let globalPeakRms = 1e-6;
  const hop = Math.max(512, Math.round(sampleRate * 0.022)); // ~22ms frame hop
  const winLen = Math.max(2048, Math.round(sampleRate * 0.064)); // ~64ms YIN window (covers down to ~35 Hz E1!)
  const numFrames = Math.max(1, Math.floor((analysisSig.length - winLen) / hop) + 1);
  const frameRms = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    let sumSq = 0;
    for (let i = 0; i < winLen; i += 2) {
      const v = analysisSig[off + i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / (winLen / 2));
    frameRms[f] = rms;
    if (rms > globalPeakRms) globalPeakRms = rms;
  }

  const rmsGate = globalPeakRms * 0.045;
  const rawMidi = new Int16Array(numFrames).fill(-1);
  const rawConf = new Float32Array(numFrames);
  const maxYinHz = bassOnly ? 240 : 1400;
  const maxAllowedMidi = bassOnly ? 55 : 96; // Clamp to G3 in bassOnly mode

  for (let f = 0; f < numFrames; f++) {
    if (frameRms[f] < rmsGate) continue;
    const off = f * hop;
    const slice = analysisSig.subarray(off, off + winLen);
    const est = detectPitchYin(slice, sampleRate, 35, maxYinHz);
    if (est.confidence >= 0.48 && est.midiNote >= 24 && est.midiNote <= maxAllowedMidi) {
      rawMidi[f] = est.midiNote;
      rawConf[f] = est.confidence;
    }
  }

  // 3-frame median filter to eliminate single-frame octave glitches
  const smoothedMidi = new Int16Array(numFrames).fill(-1);
  for (let f = 0; f < numFrames; f++) {
    if (rawMidi[f] < 0) continue;
    const winVals: number[] = [];
    for (let d = -1; d <= 1; d++) {
      const idx = f + d;
      if (idx >= 0 && idx < numFrames && rawMidi[idx] >= 0) {
        winVals.push(rawMidi[idx]);
      }
    }
    smoothedMidi[f] = winVals.length >= 2 ? getMedianNumber(winVals) : rawMidi[f];
  }

  // Onset lookup helper to split re-articulated identical pitches
  const onsetFrames = new Set<number>();
  for (const t of onsetsRes.onsetTimesSec) {
    onsetFrames.add(Math.round((t * sampleRate) / hop));
  }

  const noteEvents: StemNoteEvent[] = [];
  let curMidi = -1;
  let curStartFrame = 0;
  let curMaxRms = 0;
  let curConfSum = 0;
  let curFrames = 0;

  const flushNote = (endFrame: number) => {
    if (curMidi < 0 || curFrames === 0) return;
    const startSec = Number(((curStartFrame * hop) / sampleRate).toFixed(4));
    const endSec = Math.min(durationSec, Number(((endFrame * hop) / sampleRate).toFixed(4)));
    const durSec = Math.max(0.02, endSec - startSec);
    if (durSec < minNoteSec) return;

    // Snap startSec to nearest onset transient within ±35ms if available
    let snappedStart = startSec;
    for (const oSec of onsetsRes.onsetTimesSec) {
      if (Math.abs(oSec - startSec) < 0.038) {
        snappedStart = oSec;
        break;
      }
    }

    const vel = Number(Math.max(0.2, Math.min(1.0, curMaxRms / Math.max(1e-4, globalPeakRms * 0.8))).toFixed(3));
    noteEvents.push({
      id: `mn-${noteEvents.length}`,
      startSec: snappedStart,
      durationSec: Number(Math.max(0.03, endSec - snappedStart).toFixed(4)),
      midiNote: curMidi,
      noteName: midiNoteToName(curMidi),
      velocity: vel,
      clarity: Number((curConfSum / curFrames).toFixed(2)),
    });
  };

  for (let f = 0; f < numFrames; f++) {
    const m = smoothedMidi[f];
    const hasReAttack = f > curStartFrame + 2 && (onsetFrames.has(f) || onsetFrames.has(f - 1));

    if (m < 0) {
      flushNote(f);
      curMidi = -1;
      curFrames = 0;
      continue;
    }

    if (curMidi < 0) {
      curMidi = m;
      curStartFrame = f;
      curMaxRms = frameRms[f];
      curConfSum = rawConf[f];
      curFrames = 1;
    } else if (m !== curMidi || hasReAttack) {
      flushNote(f);
      curMidi = m;
      curStartFrame = f;
      curMaxRms = frameRms[f];
      curConfSum = rawConf[f];
      curFrames = 1;
    } else {
      curFrames++;
      if (frameRms[f] > curMaxRms) curMaxRms = frameRms[f];
      curConfSum += rawConf[f];
    }
  }
  flushNote(numFrames);

  let minMidi = 127;
  let maxMidi = 0;
  for (const n of noteEvents) {
    if (n.midiNote < minMidi) minMidi = n.midiNote;
    if (n.midiNote > maxMidi) maxMidi = n.midiNote;
  }

  const bpm = estimateBpmFromOnsets(
    noteEvents.map((n) => n.startSec),
    options.bpmHint ?? 120
  );

  return {
    mode: 'monophonic',
    bassFocusApplied: bassOnly || undefined,
    bpm,
    durationSec,
    drumHits: [],
    noteEvents,
    midiRange:
      noteEvents.length > 0
        ? {
            minMidi,
            maxMidi,
            minName: midiNoteToName(minMidi),
            maxName: midiNoteToName(maxMidi),
          }
        : undefined,
    counts: {
      total: noteEvents.length,
      kick: 0,
      snare: 0,
      hat: 0,
      tom: 0,
      notes: noteEvents.length,
    },
  };
}

/**
 * Polyphonic Pitch & Chord Transcription Engine for Guitar, Piano, Keys, Strings+
 * Uses 2x zero-padded 16384-pt FFT + Parabolic Spectral Peak Extraction (±38 cent harmonic matching)
 * + Fundamental-Anchored Iterative Harmonic Comb Subtraction (preserves octave/fifth chord notes!)
 * + Spectral Flux chord-onset snapping.
 */
export function analyzePolyphonicStemNotesFull(
  mono: Float32Array,
  sampleRate: number,
  options: { sensitivity?: number; maxPolyphony?: number; bpmHint?: number } = {}
): FullStemAnalysisResult {
  const durationSec = mono.length / sampleRate;
  const sensitivity = Math.max(0.1, Math.min(1.0, options.sensitivity ?? 0.62));
  const maxPolyphony = Math.max(1, Math.min(6, options.maxPolyphony ?? 5));

  // 1. High-resolution onset attacks for sharp chord/arpeggio timing
  const onsetsRes = detectOnsetsSpectralFlux(mono, sampleRate, {
    sensitivity,
    minIntervalMs: 55,
    snapToZeroCrossing: false,
  });

  // 2. Zero-padded 16384 FFT parameters (8192 Hann -> 2.93 Hz/bin at 48kHz)
  const frameLen = 8192;
  const fftSize = 16384;
  const halfBins = fftSize / 2;
  const hop = durationSec <= 75 ? 1024 : 2048;
  const numFrames = Math.max(1, Math.floor((mono.length - frameLen) / hop) + 1);
  const binHz = sampleRate / fftSize;

  // Frame center RMS (weighted in center 60% of window so boundary transients don't smear)
  const frameRms = new Float32Array(numFrames);
  let peakRms = 1e-6;
  const coreStart = Math.floor(frameLen * 0.2);
  const coreEnd = Math.floor(frameLen * 0.8);
  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    let sumSq = 0;
    for (let i = coreStart; i < coreEnd; i += 4) {
      const v = mono[off + i];
      sumSq += v * v;
    }
    const r = Math.sqrt(sumSq / ((coreEnd - coreStart) / 4));
    frameRms[f] = r;
    if (r > peakRms) peakRms = r;
  }

  const rmsGate = peakRms * (0.045 - sensitivity * 0.025);
  const minMidi = 28; // E1 (41.2 Hz)
  const maxMidi = 92; // G#6 (1661 Hz)
  const numNotes = maxMidi - minMidi + 1;
  const maxHarm = 6;
  // Expected harmonic amplitude decay template of a pitched note for peeling
  const harmWeights = [1.0, 0.68, 0.48, 0.34, 0.24, 0.16];
  const expectedPeelRatio = [1.0, 0.62, 0.42, 0.28, 0.18, 0.12];

  const midiFreqs = new Float32Array(numNotes);
  for (let m = 0; m < numNotes; m++) {
    midiFreqs[m] = 440 * Math.pow(2, (minMidi + m - 69) / 12);
  }

  const win = buildHannWindow(frameLen);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const mag = new Float32Array(halfBins);
  const cleanMag = new Float32Array(halfBins);

  const frameDetections: Array<Array<{ midi: number; strength: number }>> = Array.from(
    { length: numFrames },
    () => []
  );

  // Tolerance in frequency ratio for parabolic peak match (~±42 cents -> avoids neighbor semitone leakage!)
  const maxCentRatioHigh = Math.pow(2, 42 / 1200);
  const maxCentRatioLow = Math.pow(2, -42 / 1200);
  const polyRelThreshold = 0.34 - sensitivity * 0.14; // 0.32 down to 0.20

  // Hann mainlobe subtraction kernel for ±3 bins around harmonic bin
  const subtractKernel = [0.22, 0.6, 0.92, 1.0, 0.92, 0.6, 0.22];

  for (let f = 0; f < numFrames; f++) {
    if (frameRms[f] < rmsGate) continue;

    const off = f * hop;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < frameLen; i++) {
      re[i] = mono[off + i] * win[i];
    }
    fftInPlace(re, im);

    let frameMaxMag = 0;
    for (let k = 1; k < halfBins; k++) {
      const a = Math.hypot(re[k], im[k]);
      mag[k] = a;
      if (a > frameMaxMag) frameMaxMag = a;
    }
    if (frameMaxMag < 1e-4) continue;

    cleanMag.set(mag);

    const pickedInFrame: Array<{ midi: number; strength: number }> = [];
    let firstSalience = 0;

    for (let p = 0; p < maxPolyphony; p++) {
      // Extract TRUE local spectral peaks in cleanMag with parabolic sub-bin frequency estimation
      const peaks: Array<{ bin: number; freqHz: number; amp: number }> = [];
      const peakNoiseFloor = frameMaxMag * 0.015;
      for (let k = 8; k < halfBins - 8; k++) {
        const a = cleanMag[k];
        if (a > peakNoiseFloor && a >= cleanMag[k - 1] && a > cleanMag[k + 1]) {
          const s0 = cleanMag[k - 1];
          const s1 = a;
          const s2 = cleanMag[k + 1];
          const denom = s0 - 2 * s1 + s2;
          const delta = Math.abs(denom) > 1e-9 ? Math.max(-0.5, Math.min(0.5, 0.5 * (s0 - s2) / denom)) : 0;
          const exactFreq = (k + delta) * binHz;
          if (exactFreq >= 36 && exactFreq <= 8500) {
            peaks.push({ bin: k, freqHz: exactFreq, amp: s1 });
          }
        }
      }
      if (peaks.length === 0) break;

      const matchPeakAtFreq = (targetHz: number): number => {
        const loHz = targetHz * maxCentRatioLow;
        const hiHz = targetHz * maxCentRatioHigh;
        let bestAmp = 0;
        for (let i = 0; i < peaks.length; i++) {
          const pk = peaks[i];
          if (pk.freqHz > hiHz) break;
          if (pk.freqHz >= loHz) {
            // Weight slightly by closeness to exact pitch
            const ratioErr = Math.abs(Math.log2(pk.freqHz / targetHz) * 1200);
            const w = Math.max(0.25, 1 - ratioErr / 48);
            const score = pk.amp * w;
            if (score > bestAmp) bestAmp = score;
          }
        }
        return bestAmp;
      };

      let bestMidiIdx = -1;
      let bestSalience = 0;
      let bestAmp1 = 0;

      for (let m = 0; m < numNotes; m++) {
        const candMidi = minMidi + m;
        if (pickedInFrame.some((x) => Math.abs(x.midi - candMidi) <= 1)) {
          continue; // Do not pick same note or adjacent semitone smearing
        }

        const f0 = midiFreqs[m];
        const amp1 = matchPeakAtFreq(f0);
        if (amp1 < peakNoiseFloor * 1.4) continue; // Fundamental MUST actually exist as a true spectral peak!

        let salience = amp1 * harmWeights[0];
        let maxOverTone = 0;
        let matchingHarmonics = 1;

        for (let h = 2; h <= maxHarm; h++) {
          const fh = f0 * h;
          if (fh > 8200) break;
          const ah = matchPeakAtFreq(fh);
          if (ah > maxOverTone) maxOverTone = ah;
          if (ah > amp1 * 0.12) matchingHarmonics++;
          salience += ah * harmWeights[h - 1];
        }

        // Reject phantom sub-octaves where amp1 is tiny relative to an octave above
        if (amp1 < maxOverTone * 0.22) continue;
        // Favor full harmonic coincidence slightly over orphan sine artifacts
        if (matchingHarmonics >= 2) salience *= 1.15;

        if (salience > bestSalience) {
          bestSalience = salience;
          bestMidiIdx = m;
          bestAmp1 = amp1;
        }
      }

      if (bestMidiIdx < 0 || bestSalience <= peakNoiseFloor * 2.0) break;
      if (p === 0) {
        firstSalience = bestSalience;
      } else if (bestSalience < firstSalience * polyRelThreshold) {
        break;
      }

      const chosenMidi = minMidi + bestMidiIdx;
      const f0 = midiFreqs[bestMidiIdx];
      pickedInFrame.push({ midi: chosenMidi, strength: bestSalience });

      // Fundamental-Anchored Harmonic Subtraction:
      // Only peel up to `bestAmp1 * expectedPeelRatio[h]` (NEVER erase co-occurring octave/fifth chord notes!)
      for (let h = 1; h <= maxHarm; h++) {
        const fh = f0 * h;
        const bk = Math.round(fh / binHz);
        if (bk < 4 || bk >= halfBins - 4) continue;
        const binLocalMax = Math.max(cleanMag[bk - 1], cleanMag[bk], cleanMag[bk + 1]);
        const predictedMax = bestAmp1 * expectedPeelRatio[h - 1] * 1.15;
        const peelLevel = Math.min(binLocalMax * 0.94, predictedMax);
        for (let d = -3; d <= 3; d++) {
          cleanMag[bk + d] = Math.max(0, cleanMag[bk + d] - peelLevel * subtractKernel[d + 3]);
        }
      }
    }

    frameDetections[f] = pickedInFrame;
  }

  // Build onset-frame index for splitting re-strummed chords on the same notes
  const onsetSecList = onsetsRes.onsetTimesSec;
  const onsetAtFrame = new Set<number>();
  for (const t of onsetSecList) {
    onsetAtFrame.add(Math.round((t * sampleRate) / hop));
  }

  // Track each MIDI pitch line independently across frames -> merge into clean StemNoteEvent[]
  const rawEvents: StemNoteEvent[] = [];
  let maxStrengthOverall = 1e-4;
  for (const fd of frameDetections) {
    for (const item of fd) {
      if (item.strength > maxStrengthOverall) maxStrengthOverall = item.strength;
    }
  }

  for (let midi = minMidi; midi <= maxMidi; midi++) {
    let activeStartFrame = -1;
    let missGap = 0;
    let peakStrength = 0;
    let lastSeenFrame = -1;

    const commitEvent = (startF: number, endF: number, strVal: number) => {
      const spanFrames = endF - startF + 1;
      // Require >= 2 frames (~42ms+ tonal sustain) so single-frame broadband transient clicks / hard cutoffs are rejected!
      if (spanFrames < 2) return;

      // Align frame timestamp near Hann energy center (0.38 * frameLen) so chords snap accurately without pre-ring bias
      const rawStartSec = (startF * hop + frameLen * 0.38) / sampleRate;
      const rawEndSec = Math.min(
        durationSec,
        ((endF + 1) * hop + frameLen * 0.5) / sampleRate
      );

      // Snap startSec to nearest sharp onset attack within ±75ms
      let snappedStart = Math.max(0, rawStartSec);
      let backedByOnset = false;
      let bestOnsetDist = 0.075;
      for (const oSec of onsetSecList) {
        const d = Math.abs(oSec - rawStartSec);
        if (d <= bestOnsetDist) {
          bestOnsetDist = d;
          snappedStart = oSec;
          backedByOnset = true;
        }
      }

      const dur = Math.max(0.06, rawEndSec - snappedStart);

      rawEvents.push({
        id: '',
        startSec: Number(snappedStart.toFixed(4)),
        durationSec: Number(dur.toFixed(4)),
        midiNote: midi,
        noteName: midiNoteToName(midi),
        velocity: Number(
          Math.max(0.24, Math.min(1.0, strVal / (maxStrengthOverall * 0.65))).toFixed(3)
        ),
        clarity: backedByOnset ? 0.94 : 0.78,
      });
    };

    for (let f = 0; f < numFrames; f++) {
      const hit = frameDetections[f].find((x) => x.midi === midi);
      const isReAttack =
        activeStartFrame >= 0 &&
        f > activeStartFrame + 3 &&
        (onsetAtFrame.has(f) || onsetAtFrame.has(f - 1));

      if (hit) {
        if (activeStartFrame >= 0 && isReAttack) {
          commitEvent(activeStartFrame, f - 1, peakStrength);
          activeStartFrame = f;
          lastSeenFrame = f;
          peakStrength = hit.strength;
          missGap = 0;
        } else if (activeStartFrame < 0) {
          activeStartFrame = f;
          lastSeenFrame = f;
          peakStrength = hit.strength;
          missGap = 0;
        } else {
          lastSeenFrame = f;
          missGap = 0;
          if (hit.strength > peakStrength) peakStrength = hit.strength;
        }
      } else if (activeStartFrame >= 0) {
        missGap++;
        if (missGap > 1 || f === numFrames - 1) {
          commitEvent(activeStartFrame, lastSeenFrame, peakStrength);
          activeStartFrame = -1;
        }
      }
    }
    if (activeStartFrame >= 0) {
      commitEvent(activeStartFrame, lastSeenFrame, peakStrength);
    }
  }

  rawEvents.sort((a, b) => a.startSec - b.startSec || a.midiNote - b.midiNote);

  // Deduplicate/merge identical MIDI notes whose onset snap mapped to the exact same beat within 75ms
  const dedupedEvents: StemNoteEvent[] = [];
  for (const ev of rawEvents) {
    const existing = dedupedEvents.find(
      (prev) =>
        prev.midiNote === ev.midiNote &&
        Math.abs(prev.startSec - ev.startSec) <= 0.075
    );
    if (existing) {
      const endA = existing.startSec + existing.durationSec;
      const endB = ev.startSec + ev.durationSec;
      existing.durationSec = Number(Math.max(0.06, Math.max(endA, endB) - existing.startSec).toFixed(4));
      existing.velocity = Math.max(existing.velocity, ev.velocity);
    } else {
      dedupedEvents.push(ev);
    }
  }

  dedupedEvents.forEach((ev, idx) => {
    ev.id = `pn-${idx}`;
  });

  let minFound = 127;
  let maxFound = 0;
  for (const n of dedupedEvents) {
    if (n.midiNote < minFound) minFound = n.midiNote;
    if (n.midiNote > maxFound) maxFound = n.midiNote;
  }

  const bpm = estimateBpmFromOnsets(onsetsRes.onsetTimesSec, options.bpmHint ?? 120);

  return {
    mode: 'polyphonic',
    bpm,
    durationSec,
    drumHits: [],
    noteEvents: dedupedEvents,
    midiRange:
      dedupedEvents.length > 0
        ? {
            minMidi: minFound,
            maxMidi: maxFound,
            minName: midiNoteToName(minFound),
            maxName: midiNoteToName(maxFound),
          }
        : undefined,
    counts: {
      total: dedupedEvents.length,
      kick: 0,
      snare: 0,
      hat: 0,
      tom: 0,
      notes: dedupedEvents.length,
    },
  };
}

/**
 * Isolates the 30 Hz - 210 Hz bass band (2nd-order HPF + 4th-order Butterworth LPF)
 * so vocals, snares, guitars and cymbals don't mask low-end bass tracking in full songs.
 */
function filterBassIsolationBand(mono: Float32Array, sr: number): Float32Array {
  const out = new Float32Array(mono.length);
  // Stage 1: 2nd-order Butterworth HPF @ 30Hz
  const wH = (2 * Math.PI * 30) / sr;
  const cH = Math.cos(wH);
  const aH = Math.sin(wH) / (2 * Math.SQRT1_2);
  const a0H = 1 + aH;
  const hb0 = ((1 + cH) * 0.5) / a0H;
  const hb1 = -(1 + cH) / a0H;
  const ha1 = (-2 * cH) / a0H;
  const ha2 = (1 - aH) / a0H;

  // Stage 2 & 3: Cascaded 2nd-order Butterworth LPF @ 210Hz (24 dB/oct)
  const wL = (2 * Math.PI * 210) / sr;
  const cL = Math.cos(wL);
  const aL = Math.sin(wL) / (2 * Math.SQRT1_2);
  const a0L = 1 + aL;
  const lb0 = ((1 - cL) * 0.5) / a0L;
  const lb1 = (1 - cL) / a0L;
  const la1 = (-2 * cL) / a0L;
  const la2 = (1 - aL) / a0L;

  let hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
  let l1x1 = 0, l1x2 = 0, l1y1 = 0, l1y2 = 0;
  let l2x1 = 0, l2x2 = 0, l2y1 = 0, l2y2 = 0;

  for (let i = 0; i < mono.length; i++) {
    const x = mono[i];
    const hp = hb0 * x + hb1 * hx1 + hb0 * hx2 - ha1 * hy1 - ha2 * hy2;
    hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = hp;

    const lp1 = lb0 * hp + lb1 * l1x1 + lb0 * l1x2 - la1 * l1y1 - la2 * l1y2;
    l1x2 = l1x1; l1x1 = hp; l1y2 = l1y1; l1y1 = lp1;

    const lp2 = lb0 * lp1 + lb1 * l2x1 + lb0 * l2x2 - la1 * l2y1 - la2 * l2y2;
    l2x2 = l2x1; l2x1 = lp1; l2y2 = l2y1; l2y1 = lp2;

    out[i] = lp2;
  }
  return out;
}

function foldPitchClassToSubRegister(
  pitchClass: number,
  prevMidi: number | null,
  minBassMidi = 28, // E1 (41.2 Hz)
  maxBassMidi = 43  // G2 (98.0 Hz)
): number {
  const pc = ((pitchClass % 12) + 12) % 12;
  const anchor = prevMidi ?? 35; // B1 / C2 center
  let best = minBassMidi + ((pc - (minBassMidi % 12) + 12) % 12);
  let bestDist = Infinity;
  for (let m = minBassMidi; m <= maxBassMidi; m++) {
    if (m % 12 !== pc) continue;
    const d = Math.abs(m - anchor);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

function inferChordRootPitchClass(
  activeNotes: StemNoteEvent[],
  lowBandMidi: number
): number {
  const lowestNote = activeNotes.reduce(
    (best, n) => (n.midiNote < best.midiNote ? n : best),
    activeNotes[0]
  );
  if (activeNotes.length === 1) {
    return lowestNote.midiNote % 12;
  }

  const pcWeight = new Float32Array(12);
  for (const n of activeNotes) {
    const pc = n.midiNote % 12;
    pcWeight[pc] += Math.max(0.2, n.velocity);
  }

  const lowestPc = lowestNote.midiNote % 12;
  const lowBandPc = lowBandMidi >= 28 ? lowBandMidi % 12 : -1;

  let bestPc = lowestPc;
  let bestScore = -1;

  for (let pc = 0; pc < 12; pc++) {
    if (pcWeight[pc] <= 0) continue;
    let score = pcWeight[pc];
    // Major / Minor triad structural support
    const hasMaj3 = pcWeight[(pc + 4) % 12] > 0;
    const hasMin3 = pcWeight[(pc + 3) % 12] > 0;
    const hasFifth = pcWeight[(pc + 7) % 12] > 0;
    const hasMin7 = pcWeight[(pc + 10) % 12] > 0;

    if (hasMaj3 || hasMin3) score += 0.55;
    if (hasFifth) score += 0.85;
    if (hasMin7) score += 0.25;
    if (pc === lowestPc) score += 0.35;
    if (pc === lowBandPc) score += 0.45;

    if (score > bestScore) {
      bestScore = score;
      bestPc = pc;
    }
  }

  return bestPc;
}

/**
 * Bass-Focus Progression & Sub-Register Analyzer:
 * Extracts ONLY monophonic sub/bass notes (E1..G#2 / 41..104 Hz) from ANY full song,
 * chord progression (Piano/Guitar), or bass stem:
 * 1) Isolates the 30-210 Hz bass band via 16384-pt FFT to track existing basslines in full mixes.
 * 2) When the mix/stem has no low bassline (e.g. chords/guitar/piano), detects the harmonic chord
 *    progression and infers the root note folded smoothly into sub-bass register (E1..G2).
 * 3) Enforces strict non-overlapping monophonic bass note events.
 */
export function analyzeBassProgressionFull(
  mono: Float32Array,
  sampleRate: number,
  options: { sensitivity?: number; maxPolyphony?: number; bpmHint?: number } = {}
): FullStemAnalysisResult {
  const durationSec = mono.length / sampleRate;
  const sensitivity = Math.max(0.1, Math.min(1.0, options.sensitivity ?? 0.62));

  // 1. Detect polyphonic chords + full-band onsets so chord progressions without sub are tracked cleanly
  const poly = analyzePolyphonicStemNotesFull(mono, sampleRate, {
    sensitivity,
    maxPolyphony: options.maxPolyphony ?? 5,
    bpmHint: options.bpmHint,
  });

  // 2. Isolate 30-210 Hz bass band and analyze frame-by-frame low fundamentals
  const lowBand = filterBassIsolationBand(mono, sampleRate);
  const fullOnsets = detectOnsetsSpectralFlux(mono, sampleRate, {
    sensitivity,
    minIntervalMs: 75,
    snapToZeroCrossing: false,
  });
  const lowOnsets = detectOnsetsSpectralFlux(lowBand, sampleRate, {
    sensitivity: Math.min(0.95, sensitivity + 0.08),
    minIntervalMs: 85,
    snapToZeroCrossing: false,
  });

  const frameLen = 8192;
  const fftSize = 16384;
  const halfBins = fftSize / 2;
  const hop = durationSec <= 75 ? 1024 : 2048;
  const numFrames = Math.max(1, Math.floor((mono.length - frameLen) / hop) + 1);
  const binHz = sampleRate / fftSize;

  const lowRms = new Float32Array(numFrames);
  const fullRms = new Float32Array(numFrames);
  let peakLowRms = 1e-6;
  let peakFullRms = 1e-6;
  const coreStart = Math.floor(frameLen * 0.2);
  const coreEnd = Math.floor(frameLen * 0.8);

  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    let sumL = 0;
    let sumF = 0;
    for (let i = coreStart; i < coreEnd; i += 4) {
      const vl = lowBand[off + i];
      const vf = mono[off + i];
      sumL += vl * vl;
      sumF += vf * vf;
    }
    const rl = Math.sqrt(sumL / ((coreEnd - coreStart) / 4));
    const rf = Math.sqrt(sumF / ((coreEnd - coreStart) / 4));
    lowRms[f] = rl;
    fullRms[f] = rf;
    if (rl > peakLowRms) peakLowRms = rl;
    if (rf > peakFullRms) peakFullRms = rf;
  }

  const win = buildHannWindow(frameLen);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const mag = new Float32Array(halfBins);
  const maxLowBin = Math.min(halfBins - 4, Math.ceil(380 / binHz));
  const rawLowMidi = new Int16Array(numFrames).fill(-1);
  const lowGate = peakLowRms * (0.14 - sensitivity * 0.06);

  for (let f = 0; f < numFrames; f++) {
    if (lowRms[f] < lowGate) continue;
    const off = f * hop;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < frameLen; i++) {
      re[i] = lowBand[off + i] * win[i];
    }
    fftInPlace(re, im);

    let frameMax = 0;
    for (let k = 6; k <= maxLowBin; k++) {
      const a = Math.hypot(re[k], im[k]);
      mag[k] = a;
      if (a > frameMax) frameMax = a;
    }
    if (frameMax < 1e-4) continue;

    const peaks: Array<{ freqHz: number; amp: number }> = [];
    const floor = frameMax * 0.14;
    for (let k = 8; k < maxLowBin - 2; k++) {
      const a = mag[k];
      if (a > floor && a >= mag[k - 1] && a > mag[k + 1]) {
        const s0 = mag[k - 1];
        const s2 = mag[k + 1];
        const denom = s0 - 2 * a + s2;
        const delta = Math.abs(denom) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (s0 - s2)) / denom)) : 0;
        const freqHz = (k + delta) * binHz;
        if (freqHz >= 36 && freqHz <= 350) {
          peaks.push({ freqHz, amp: a });
        }
      }
    }
    if (peaks.length === 0) continue;

    const findPeak = (targetHz: number) => {
      const lo = targetHz * 0.975;
      const hi = targetHz * 1.026;
      let best = 0;
      for (let i = 0; i < peaks.length; i++) {
        if (peaks[i].freqHz > hi) break;
        if (peaks[i].freqHz >= lo && peaks[i].amp > best) best = peaks[i].amp;
      }
      return best;
    };

    let bestMidi = -1;
    let bestScore = 0;
    for (let m = 28; m <= 50; m++) {
      const f0 = 440 * Math.pow(2, (m - 69) / 12);
      const amp1 = findPeak(f0);
      if (amp1 < floor) continue;
      const amp2 = f0 * 2 <= 350 ? findPeak(f0 * 2) : 0;
      // Reject sub-octave artifacts when 2nd harmonic dwarfs fundamental below 62Hz
      if (f0 < 62 && amp1 < amp2 * 0.35) continue;
      const score = amp1 + amp2 * 0.45;
      if (score > bestScore) {
        bestScore = score;
        bestMidi = m;
      }
    }
    rawLowMidi[f] = bestMidi;
  }

  // 3-frame median filter on low-band MIDI to reject 1-frame kick-drum sweeps
  const smoothedLowMidi = new Int16Array(numFrames).fill(-1);
  for (let f = 0; f < numFrames; f++) {
    if (rawLowMidi[f] < 0) continue;
    const vals: number[] = [];
    for (let d = -1; d <= 1; d++) {
      const idx = f + d;
      if (idx >= 0 && idx < numFrames && rawLowMidi[idx] >= 0) {
        vals.push(rawLowMidi[idx]);
      }
    }
    smoothedLowMidi[f] = vals.length >= 2 ? getMedianNumber(vals) : -1;
  }

  // 3. Fuse low-band bass tracking + polyphonic chord-root extraction per frame
  const chosenFrameMidi = new Int16Array(numFrames).fill(-1);
  const fullGate = peakFullRms * 0.08;
  let lastBassMidi: number | null = null;

  for (let f = 0; f < numFrames; f++) {
    if (fullRms[f] < fullGate && lowRms[f] < peakLowRms * 0.12) continue;
    const tSec = (f * hop + frameLen * 0.38) / sampleRate;
    const activePoly = poly.noteEvents.filter(
      (ev) => ev.startSec <= tSec + 0.035 && ev.startSec + ev.durationSec >= tSec - 0.015
    );
    const lowMidi = smoothedLowMidi[f];
    const lowEnergyRatio = lowRms[f] / (fullRms[f] + 1e-6);

    const hasTrueSubBass =
      (lowMidi >= 28 && lowMidi <= 40 && (lowEnergyRatio >= 0.14 || activePoly.length === 0)) ||
      (lowMidi >= 28 && lowMidi <= 44 && activePoly.length <= 1);

    if (hasTrueSubBass) {
      chosenFrameMidi[f] = lowMidi;
      lastBassMidi = lowMidi;
      continue;
    }

    if (activePoly.length > 0) {
      const rootPc = inferChordRootPitchClass(activePoly, lowMidi);
      const folded: number = foldPitchClassToSubRegister(rootPc, lastBassMidi, 28, 40);
      chosenFrameMidi[f] = folded;
      lastBassMidi = folded;
      continue;
    }

    if (lowMidi >= 28 && fullRms[f] >= fullGate) {
      const folded: number =
        lowMidi <= 44
          ? lowMidi
          : foldPitchClassToSubRegister(lowMidi % 12, lastBassMidi, 28, 40);
      chosenFrameMidi[f] = folded;
      lastBassMidi = folded;
    }
  }

  // Smooth fused frame decisions
  const finalMidi = new Int16Array(numFrames).fill(-1);
  for (let f = 0; f < numFrames; f++) {
    if (chosenFrameMidi[f] < 0) continue;
    const vals: number[] = [];
    for (let d = -1; d <= 1; d++) {
      const idx = f + d;
      if (idx >= 0 && idx < numFrames && chosenFrameMidi[idx] >= 0) vals.push(chosenFrameMidi[idx]);
    }
    finalMidi[f] = vals.length >= 2 ? getMedianNumber(vals) : chosenFrameMidi[f];
  }

  const allOnsets = [...fullOnsets.onsetTimesSec, ...lowOnsets.onsetTimesSec].sort((a, b) => a - b);
  const onsetFrames = new Set<number>();
  for (const os of lowOnsets.onsetTimesSec) {
    onsetFrames.add(Math.round((os * sampleRate) / hop));
  }
  for (const ev of poly.noteEvents) {
    onsetFrames.add(Math.round((ev.startSec * sampleRate) / hop));
  }

  const noteEvents: StemNoteEvent[] = [];
  let curMidi = -1;
  let curStartF = 0;
  let curPeakRms = 0;
  let curFrames = 0;

  const flushBassNote = (endF: number) => {
    if (curMidi < 0 || curFrames < 3) return;
    const rawStartSec = Math.max(0, (curStartF * hop + frameLen * 0.35) / sampleRate);
    const rawEndSec = Math.min(durationSec, (endF * hop + frameLen * 0.5) / sampleRate);
    let snappedStart = rawStartSec;
    let bestD = 0.065;
    for (const oSec of allOnsets) {
      const d = Math.abs(oSec - rawStartSec);
      if (d <= bestD) {
        bestD = d;
        snappedStart = oSec;
      }
    }
    // Check polyphonic note start alignment too
    for (const ev of poly.noteEvents) {
      const d = Math.abs(ev.startSec - rawStartSec);
      if (d <= bestD) {
        bestD = d;
        snappedStart = ev.startSec;
      }
    }

    const dur = Math.max(0.05, rawEndSec - snappedStart);
    if (dur < 0.065) return;

    const vel = Number(
      Math.max(0.32, Math.min(1.0, curPeakRms / Math.max(1e-4, peakFullRms * 0.72))).toFixed(3)
    );
    noteEvents.push({
      id: '',
      startSec: Number(snappedStart.toFixed(4)),
      durationSec: Number(dur.toFixed(4)),
      midiNote: curMidi,
      noteName: midiNoteToName(curMidi),
      velocity: vel,
      clarity: 0.9,
    });
  };

  for (let f = 0; f < numFrames; f++) {
    const m = finalMidi[f];
    const frameEnergy = Math.max(lowRms[f], fullRms[f] * 0.7);
    const prevEnergy =
      f >= 2
        ? Math.min(
            Math.max(lowRms[f - 1], fullRms[f - 1] * 0.7),
            Math.max(lowRms[f - 2], fullRms[f - 2] * 0.7)
          )
        : frameEnergy;
    const reAttack =
      f > curStartF + 4 && onsetFrames.has(f) && frameEnergy > prevEnergy * 1.25;
    if (m < 0) {
      flushBassNote(f);
      curMidi = -1;
      curFrames = 0;
      continue;
    }
    if (curMidi < 0) {
      curMidi = m;
      curStartF = f;
      curPeakRms = frameEnergy;
      curFrames = 1;
    } else if (m !== curMidi || reAttack) {
      flushBassNote(f);
      curMidi = m;
      curStartF = f;
      curPeakRms = frameEnergy;
      curFrames = 1;
    } else {
      curFrames++;
      if (frameEnergy > curPeakRms) curPeakRms = frameEnergy;
    }
  }
  flushBassNote(numFrames);

  // Deduplicate/merge near-simultaneous notes & enforce strictly non-overlapping monophonic bass line
  noteEvents.sort((a, b) => a.startSec - b.startSec);
  const monoBass: StemNoteEvent[] = [];
  for (const ev of noteEvents) {
    const prev = monoBass[monoBass.length - 1];
    if (prev && Math.abs(ev.startSec - prev.startSec) < 0.045) {
      prev.durationSec = Math.max(prev.durationSec, ev.durationSec);
      prev.velocity = Math.max(prev.velocity, ev.velocity);
    } else {
      monoBass.push(ev);
    }
  }

  for (let i = 0; i < monoBass.length; i++) {
    monoBass[i].id = `bf-${i}`;
    if (i < monoBass.length - 1) {
      const maxDur = Math.max(0.04, monoBass[i + 1].startSec - monoBass[i].startSec - 0.008);
      if (monoBass[i].durationSec > maxDur) {
        monoBass[i].durationSec = Number(maxDur.toFixed(4));
      }
    }
  }

  let minFound = 127;
  let maxFound = 0;
  for (const n of monoBass) {
    if (n.midiNote < minFound) minFound = n.midiNote;
    if (n.midiNote > maxFound) maxFound = n.midiNote;
  }

  return {
    mode: poly.mode,
    bassFocusApplied: true,
    bpm: poly.bpm,
    durationSec,
    drumHits: [],
    noteEvents: monoBass,
    midiRange:
      monoBass.length > 0
        ? {
            minMidi: minFound,
            maxMidi: maxFound,
            minName: midiNoteToName(minFound),
            maxName: midiNoteToName(maxFound),
          }
        : undefined,
    counts: {
      total: monoBass.length,
      kick: 0,
      snare: 0,
      hat: 0,
      tom: 0,
      notes: monoBass.length,
    },
  };
}
