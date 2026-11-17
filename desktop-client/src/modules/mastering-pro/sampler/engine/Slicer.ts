import { detectOnsetsSpectralFlux } from '../../dsp-core/SpectralFftCore';
import type { SamplePad, SampleRegion } from '../types/sampler.types';
import { DEFAULT_PAD_COLORS, createDefaultPadParams } from './SampleBufferOps';

export function buildMonoSliceFromBuffer(
  buffer: AudioBuffer,
  startSec = 0,
  endSec = buffer.duration
): Float32Array {
  const sr = buffer.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(buffer.length, Math.ceil(endSec * sr));
  const len = Math.max(1, s1 - s0);
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mono[i] = 0.5 * (ch0[s0 + i] + ch1[s0 + i]);
  }
  return mono;
}

export function sliceByTransients(
  sourceId: string,
  mono: Float32Array,
  sampleRate: number,
  rangeStartSec: number,
  rangeEndSec: number,
  sensitivity = 0.62,
  minSpacingMs = 95,
  maxSlices = 32
): SampleRegion[] {
  const res = detectOnsetsSpectralFlux(mono, sampleRate, {
    sensitivity,
    minIntervalMs: minSpacingMs,
    snapToZeroCrossing: true,
  });

  const boundaries: number[] = [rangeStartSec];
  for (let i = 0; i < res.onsetTimesSec.length; i++) {
    const absTime = Number((rangeStartSec + res.onsetTimesSec[i]).toFixed(4));
    if (absTime > rangeStartSec + 0.025 && absTime < rangeEndSec - 0.025) {
      boundaries.push(absTime);
    }
  }

  // Deduplicate and cap cleanly
  const unique = boundaries.slice(0, maxSlices);
  const regions: SampleRegion[] = [];

  for (let i = 0; i < unique.length; i++) {
    const startSec = unique[i];
    const endSec = i + 1 < unique.length ? unique[i + 1] : rangeEndSec;
    if (endSec - startSec < 0.02) continue;

    const cls = i > 0 ? res.classifications[i - 1] : undefined;
    const tagName =
      cls === 'kick'
        ? 'Kick'
        : cls === 'snare'
        ? 'Snare'
        : cls === 'hat'
        ? 'Hat'
        : 'Slice';

    regions.push({
      id: `reg-tr-${Date.now()}-${i}`,
      sourceId,
      name: `${tagName} ${i + 1}`,
      startSec,
      endSec,
      loopCrossfadeMs: 8,
      sliceSource: 'transient',
      classification: cls === 'kick' || cls === 'snare' || cls === 'hat' ? cls : 'melodic',
    });
  }

  return regions;
}

export type GridDivision = '1bar' | '1/2' | '1/4' | '1/8' | '1/16' | '1/8T';

export function sliceByBpmGrid(
  sourceId: string,
  rangeStartSec: number,
  rangeEndSec: number,
  bpm: number,
  division: GridDivision,
  maxSlices = 32,
  beatOffsetSec = 0,
  beatTimes?: number[]
): SampleRegion[] {
  // Prefer Stem Studio's island-repaired Beat Grid (`beatTimes[]`) when available!
  if (beatTimes && beatTimes.length >= 2) {
    const subsPerBeat =
      division === '1/8' ? 2 : division === '1/16' ? 4 : division === '1/8T' ? 3 : 1;
    const beatStep = division === '1bar' ? 4 : division === '1/2' ? 2 : 1;
    const cuts: number[] = [];
    for (let i = 0; i < beatTimes.length - 1; i += beatStep) {
      const b0 = beatTimes[i];
      const bNext = beatTimes[Math.min(beatTimes.length - 1, i + beatStep)];
      if (bNext <= rangeStartSec + 0.015) continue;
      if (b0 >= rangeEndSec - 0.015) break;
      if (subsPerBeat === 1) {
        const clamped = Math.max(rangeStartSec, Math.min(rangeEndSec, b0));
        if (cuts.length === 0 || clamped - cuts[cuts.length - 1] >= 0.025) {
          cuts.push(Number(clamped.toFixed(4)));
        }
      } else {
        const subStep = (bNext - b0) / subsPerBeat;
        for (let s = 0; s < subsPerBeat; s++) {
          const t = b0 + s * subStep;
          if (t < rangeStartSec - 0.01 || t >= rangeEndSec - 0.015) continue;
          const clamped = Math.max(rangeStartSec, t);
          if (cuts.length === 0 || clamped - cuts[cuts.length - 1] >= 0.025) {
            cuts.push(Number(clamped.toFixed(4)));
          }
        }
      }
      if (cuts.length > maxSlices + 2) break;
    }
    if (cuts.length >= 2) {
      const regions: SampleRegion[] = [];
      for (let i = 0; i < cuts.length && regions.length < maxSlices; i++) {
        const st = cuts[i];
        const fallbackBeat = 60 / Math.max(40, bpm || 120);
        const en = Math.min(
          rangeEndSec,
          i + 1 < cuts.length ? cuts[i + 1] : Number((st + (fallbackBeat * beatStep) / subsPerBeat).toFixed(4))
        );
        if (en - st < 0.02) continue;
        regions.push({
          id: `reg-grid-${Date.now()}-${i}`,
          sourceId,
          name: `Beat ${i + 1} (${division})`,
          startSec: st,
          endSec: Number(en.toFixed(4)),
          loopCrossfadeMs: 8,
          sliceSource: 'grid',
        });
      }
      if (regions.length > 0) return regions;
    }
  }

  const safeBpm = Math.max(40, Math.min(240, bpm || 120));
  const beatSec = 60 / safeBpm;
  const stepSec =
    division === '1bar'
      ? beatSec * 4
      : division === '1/2'
      ? beatSec * 2
      : division === '1/4'
      ? beatSec
      : division === '1/8'
      ? beatSec * 0.5
      : division === '1/16'
      ? beatSec * 0.25
      : beatSec / 3;

  // Phase-align cuts to the detected beatOffsetSec when chopping whole bars/tracks
  const beatMod = ((beatOffsetSec % stepSec) + stepSec) % stepSec;
  let cursor = rangeStartSec;
  if (beatMod > 0.01 && Math.abs(rangeStartSec - beatOffsetSec) > 0.01) {
    const k = Math.ceil((rangeStartSec - beatOffsetSec - 0.005) / stepSec);
    const alignedStart = beatOffsetSec + k * stepSec;
    if (alignedStart >= rangeStartSec && alignedStart < rangeEndSec - 0.03) {
      cursor = alignedStart;
    }
  }

  const regions: SampleRegion[] = [];
  let idx = 0;

  while (cursor < rangeEndSec - 0.015 && idx < maxSlices) {
    const next = Math.min(rangeEndSec, Number((cursor + stepSec).toFixed(4)));
    regions.push({
      id: `reg-grid-${Date.now()}-${idx}`,
      sourceId,
      name: `Beat ${idx + 1} (${division})`,
      startSec: Number(cursor.toFixed(4)),
      endSec: next,
      loopCrossfadeMs: 8,
      sliceSource: 'grid',
    });
    cursor = next;
    idx++;
  }

  return regions;
}

export function assignSlicesToPads(
  existingPads: SamplePad[],
  regions: SampleRegion[]
): SamplePad[] {
  const next = existingPads.map((p) => ({ ...p }));
  const count = Math.min(16, regions.length);

  for (let i = 0; i < count; i++) {
    const r = regions[i];
    const color =
      r.classification === 'kick'
        ? '#FF6B00'
        : r.classification === 'snare'
        ? '#00E5FF'
        : r.classification === 'hat'
        ? '#F59E0B'
        : DEFAULT_PAD_COLORS[i % DEFAULT_PAD_COLORS.length];

    const sliceDur = r.endSec - r.startSec;
    const baseWarp = next[i].params.warp ?? createDefaultPadParams().warp;
    next[i] = {
      ...next[i],
      regionId: r.id,
      label: r.name,
      colorHex: color,
      params: {
        ...createDefaultPadParams(),
        ...next[i].params,
        chokeGroup: r.classification === 'hat' ? 1 : next[i].params.chokeGroup,
        warp: {
          ...baseWarp,
          syncToBpm: sliceDur >= 0.42,
        },
      },
    };
  }

  return next;
}
