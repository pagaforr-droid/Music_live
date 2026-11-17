import { applyTruePeakLookaheadLimiterOffline } from '../../dsp-core/LookaheadLimiterCore';
import { buildCrossfadedLoopArrays } from './LoopCrossfade';
import { normalizeStereoInPlace } from './SampleBufferOps';
import { getPresetZones, type ZoneSampleBuffer } from './StudioSampleBank';
import type {
  DrumPieceRole,
  FullStemAnalysisResult,
  ReplacementSlotConfig,
  StemReplaceMixOptions,
} from '../types/sampler.types';

function cubicSample(arr: Float32Array, pos: number): number {
  const len = arr.length;
  const i1 = Math.floor(pos);
  const t = pos - i1;
  const i0 = Math.max(0, i1 - 1);
  const i1c = Math.max(0, Math.min(len - 1, i1));
  const i2 = Math.min(len - 1, i1 + 1);
  const i3 = Math.min(len - 1, i1 + 2);

  const y0 = arr[i0];
  const y1 = arr[i1c];
  const y2 = arr[i2];
  const y3 = arr[i3];

  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  const a3 = y1;
  return ((a0 * t + a1) * t + a2) * t + a3;
}

function buildZoneFromCustomSlot(
  slot: ReplacementSlotConfig,
  outSampleRate: number
): ZoneSampleBuffer & { sampleRate: number } {
  const buf = slot.customBuffer!;
  const left = new Float32Array(buf.getChannelData(0));
  const right = new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : left);
  const sr = buf.sampleRate || outSampleRate;
  if (slot.normalizeCustom) {
    normalizeStereoInPlace(left, right, -1.0);
  }
  const peakOffsetSamples = Math.round((slot.customPeakOffsetSec ?? 0.002) * sr);
  const loopStart = Math.round(left.length * 0.28);
  const loopEnd = Math.round(left.length * 0.82);

  // Build click-free equal-power crossfade inside the sustain loop for melodic playback
  if (slot.roleOrTarget === 'melodic' && loopEnd - loopStart > Math.round(sr * 0.08)) {
    const xf = buildCrossfadedLoopArrays(left, right, sr, loopStart, loopEnd, 24);
    left.set(xf.left, loopStart);
    right.set(xf.right, loopStart);
  }

  return {
    rootMidi: slot.customRootMidi ?? 60,
    left,
    right,
    peakOffsetSamples,
    sampleRate: sr,
    loopStartSample: loopStart,
    loopEndSample: loopEnd,
  };
}

function pickNearestZone(
  zones: Array<ZoneSampleBuffer & { sampleRate?: number }>,
  targetMidi: number
): ZoneSampleBuffer & { sampleRate?: number } {
  let best = zones[0];
  let bestDist = Infinity;
  for (const z of zones) {
    const d = Math.abs(z.rootMidi - targetMidi);
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  return best;
}

export function renderFullStemReplacement(params: {
  originalBuffer: AudioBuffer;
  analysis: FullStemAnalysisResult;
  drumSlots: Record<DrumPieceRole, ReplacementSlotConfig>;
  melodicSlot: ReplacementSlotConfig;
  mix: StemReplaceMixOptions;
}): AudioBuffer {
  const { originalBuffer, analysis, drumSlots, melodicSlot, mix } = params;
  const sr = originalBuffer.sampleRate;
  const totalLen = originalBuffer.length;

  const origL = originalBuffer.getChannelData(0);
  const origR =
    originalBuffer.numberOfChannels > 1
      ? originalBuffer.getChannelData(1)
      : origL;

  const repL = new Float32Array(totalLen);
  const repR = new Float32Array(totalLen);

  // Ducking envelope over original track (only used for drums when blending Original + Replacement)
  const duckEnv = new Float32Array(totalLen);
  duckEnv.fill(1.0);

  if (analysis.mode === 'drums') {
    const zoneCache = new Map<DrumPieceRole, ZoneSampleBuffer & { sampleRate: number }>();

    (['kick', 'snare', 'hat', 'tom'] as DrumPieceRole[]).forEach((role) => {
      const slot = drumSlots[role];
      if (!slot || !slot.enabled) return;
      if (slot.sourceType !== 'preset' && slot.customBuffer) {
        zoneCache.set(role, buildZoneFromCustomSlot(slot, sr));
      } else {
        const z = getPresetZones(slot.presetId, sr)[0];
        zoneCache.set(role, { ...z, sampleRate: sr });
      }
    });

    for (let hIdx = 0; hIdx < analysis.drumHits.length; hIdx++) {
      const hit = analysis.drumHits[hIdx];
      const slot = drumSlots[hit.role];
      const zone = zoneCache.get(hit.role);
      if (!slot || !slot.enabled || !zone) continue;

      const srRatio = zone.sampleRate / sr;
      let semiShift = slot.pitchSemis;
      let ampScale = Math.pow(10, slot.gainDb / 20) * (0.25 + 0.75 * hit.velocity);

      if (mix.roundRobinHumanize) {
        const p1 = Math.sin((hIdx + 1) * 12.9898) * 43758.5453;
        const f1 = p1 - Math.floor(p1);
        const p2 = Math.sin((hIdx + 1) * 78.233) * 19341.7219;
        const f2 = p2 - Math.floor(p2);
        semiShift += (f1 - 0.5) * 0.14; // +/- 7 cents organic drum head feel
        ampScale *= 0.95 + f2 * 0.1; // +/- 5% micro velocity
      }

      const rate = Math.pow(2, semiShift / 12) * srRatio;
      const peakStartOut = Math.round(hit.peakTimeSec * sr);
      const alignedPeakSamples = Math.round(zone.peakOffsetSamples / rate);
      const startOut = Math.max(0, peakStartOut - alignedPeakSamples);

      // Apply brief 14ms transient duck on original stem when blending so kicks don't double-flam
      if (mix.duckOriginalTransients && mix.originalPct > 2) {
        const duckPre = Math.max(0, Math.round(hit.timeSec * sr) - Math.round(sr * 0.002));
        const duckLen = Math.round(sr * (hit.role === 'kick' ? 0.02 : 0.014));
        const depth = Math.min(0.85, 0.45 + 0.4 * hit.velocity);
        for (let k = 0; k < duckLen && duckPre + k < totalLen; k++) {
          const envShape = Math.sin((k / duckLen) * Math.PI);
          duckEnv[duckPre + k] = Math.min(duckEnv[duckPre + k], 1 - depth * envShape);
        }
      }

      const srcLen = zone.left.length;
      const maxOutFrames = Math.floor((srcLen - 1) / rate);
      const renderLen = Math.min(totalLen - startOut, maxOutFrames);
      const attackSamples = Math.max(16, Math.round(sr * 0.0012));

      for (let i = 0; i < renderLen; i++) {
        const srcPos = i * rate;
        const atk = i < attackSamples ? i / attackSamples : 1.0;
        if (Math.abs(rate - 1.0) < 1e-4) {
          const idx = Math.floor(srcPos);
          repL[startOut + i] += zone.left[idx] * ampScale * atk;
          repR[startOut + i] += zone.right[idx] * ampScale * atk;
        } else {
          repL[startOut + i] += cubicSample(zone.left, srcPos) * ampScale * atk;
          repR[startOut + i] += cubicSample(zone.right, srcPos) * ampScale * atk;
        }
      }
    }
  } else {
    // Monophonic or Polyphonic (Bass, Piano, Guitar, Keys, Synth)
    const zones: Array<ZoneSampleBuffer & { sampleRate: number }> =
      melodicSlot.sourceType !== 'preset' && melodicSlot.customBuffer
        ? [buildZoneFromCustomSlot(melodicSlot, sr)]
        : getPresetZones(melodicSlot.presetId, sr).map((z) => ({
            ...z,
            sampleRate: sr,
          }));

    const slotGain = Math.pow(10, melodicSlot.gainDb / 20);
    // Reduce gain slightly in polyphonic mode so 4-5 note chords stay headroom-balanced
    const polyScale = analysis.mode === 'polyphonic' ? 0.42 : 0.78;
    const attackSamples = Math.max(32, Math.round(sr * 0.005)); // 5ms click-free attack
    const baseReleaseSec = analysis.mode === 'monophonic' ? 0.08 : 0.16;

    for (let nIdx = 0; nIdx < analysis.noteEvents.length; nIdx++) {
      const ev = analysis.noteEvents[nIdx];
      const zone = pickNearestZone(zones, ev.midiNote + melodicSlot.pitchSemis);
      const srRatio = (zone.sampleRate ?? sr) / sr;
      const semiDiff = ev.midiNote + melodicSlot.pitchSemis - zone.rootMidi;
      const rate = Math.pow(2, semiDiff / 12) * srRatio;

      const startOut = Math.max(0, Math.round(ev.startSec * sr));
      if (startOut >= totalLen) continue;

      const holdSec = Math.max(0.04, ev.durationSec * mix.sustainScale);
      const relSec = baseReleaseSec * mix.sustainScale;
      const holdSamples = Math.round(holdSec * sr);
      const relSamples = Math.round(relSec * sr);
      const noteOutSamples = Math.min(totalLen - startOut, holdSamples + relSamples);
      const noteAmp = slotGain * polyScale * (0.28 + 0.72 * ev.velocity);

      const srcLen = zone.left.length;
      const loopStart = zone.loopStartSample ?? Math.floor(srcLen * 0.3);
      const loopEnd = Math.min(
        srcLen - 4,
        Math.max(loopStart + 256, zone.loopEndSample ?? Math.floor(srcLen * 0.8))
      );
      const loopLen = loopEnd - loopStart;
      const canLoopSustain = melodicSlot.sourceType !== 'preset' || loopLen > 256;

      let srcPos = 0;
      for (let i = 0; i < noteOutSamples; i++) {
        let env = 1.0;
        if (i < attackSamples) {
          env = i / attackSamples;
        } else if (i > holdSamples) {
          const rNorm = (i - holdSamples) / Math.max(1, relSamples);
          env = Math.cos(Math.min(1, rNorm) * Math.PI * 0.5);
        }

        const loopLimit = melodicSlot.sourceType !== 'preset' ? loopEnd : srcLen - 4;
        if (srcPos >= loopLimit) {
          if (canLoopSustain && loopLen > 64) {
            srcPos = loopStart + ((srcPos - loopStart) % loopLen);
          } else {
            break;
          }
        }

        const g = noteAmp * env;
        repL[startOut + i] += cubicSample(zone.left, srcPos) * g;
        repR[startOut + i] += cubicSample(zone.right, srcPos) * g;
        srcPos += rate;
      }
    }
  }

  // Optional subtle brightness high-shelf tilt on replacement signal (-50..+50)
  if (Math.abs(mix.brightnessPct) > 2) {
    const tiltAmt = (mix.brightnessPct / 50) * 0.42;
    let lpL = 0;
    let lpR = 0;
    const lpAlpha = (2 * Math.PI * 1600) / (sr + 2 * Math.PI * 1600);
    for (let i = 0; i < totalLen; i++) {
      lpL += lpAlpha * (repL[i] - lpL);
      lpR += lpAlpha * (repR[i] - lpR);
      const hiL = repL[i] - lpL;
      const hiR = repR[i] - lpR;
      repL[i] += hiL * tiltAmt;
      repR[i] += hiR * tiltAmt;
    }
  }

  // Final sample-exact mix: Original Stem Blend + Replaced Sample Signal
  const outL = new Float32Array(totalLen);
  const outR = new Float32Array(totalLen);
  const gOrig = Math.max(0, Math.min(1.2, mix.originalPct / 100));
  const gRep = Math.max(0, Math.min(1.5, mix.replacementPct / 100));

  for (let i = 0; i < totalLen; i++) {
    outL[i] = origL[i] * gOrig * duckEnv[i] + repL[i] * gRep;
    outR[i] = origR[i] * gOrig * duckEnv[i] + repR[i] * gRep;
  }

  // Gentle 26Hz DC/sub-rumble protection
  const hpfAlpha = (2 * Math.PI * 26) / (sr + 2 * Math.PI * 26);
  let hpStateL = 0;
  let hpStateR = 0;
  for (let i = 0; i < totalLen; i++) {
    hpStateL += hpfAlpha * (outL[i] - hpStateL);
    hpStateR += hpfAlpha * (outR[i] - hpStateR);
    outL[i] -= hpStateL;
    outR[i] -= hpStateR;
  }

  // True-Peak safety limiting so dense chords never clip
  applyTruePeakLookaheadLimiterOffline(outL, outR, sr, {
    driveDb: 0,
    ceilingDbTp: -1.0,
    lookaheadMs: 5,
    releaseMs: 65,
  });

  const outBuffer = new AudioBuffer({
    length: totalLen,
    numberOfChannels: 2,
    sampleRate: sr,
  });
  outBuffer.copyToChannel(outL, 0);
  outBuffer.copyToChannel(outR, 1);
  return outBuffer;
}
