export type MidiGridLevel =
  | 'bar'
  | 'beat'
  | 'eighth'
  | 'sixteenth'
  | 'thirtysecond'
  | 'sixtyfourth';

export type MidiGridResolutionMode = 'auto' | '1/4' | '1/8' | '1/16' | '1/32' | '1/64';

export interface MidiGridLine {
  sec: number;
  leftPct: number;
  level: MidiGridLevel;
  isDownbeat: boolean;
  barNum?: number;
  beatInBar: number;
  /** 0 on beat; 1..subdivisionsPerBeat-1 for fractional subdivisions inside a beat */
  subIndex: number;
  /** Effective subdivisions per quarter-note beat (0 = bars only, 1 = 1/4, 2 = 1/8, 4 = 1/16, 8 = 1/32, 16 = 1/64) */
  subdivisionsPerBeat: number;
  /** Short readable ruler annotation when space allows (e.g. 'C4', '.2', '&') */
  subLabel?: string;
}

export interface AdaptiveGridResult {
  lines: MidiGridLine[];
  effectiveSubdivisionsPerBeat: number;
  effectiveResolutionLabel: string;
  pxPerBeat: number;
}

export interface BuildAdaptiveGridParams {
  duration: number;
  viewStartSec: number;
  viewEndSec: number;
  viewportWidthPx: number;
  bpm: number;
  beatOffsetSec?: number;
  beatTimes?: number[];
  downbeats?: number[];
  resolutionMode?: MidiGridResolutionMode;
}

const MODE_TO_SUBS: Record<Exclude<MidiGridResolutionMode, 'auto'>, number> = {
  '1/4': 1,
  '1/8': 2,
  '1/16': 4,
  '1/32': 8,
  '1/64': 16,
};

export function subdivisionsToLabel(subdivisionsPerBeat: number): string {
  switch (subdivisionsPerBeat) {
    case 0:
      return '1/1';
    case 1:
      return '1/4';
    case 2:
      return '1/8';
    case 4:
      return '1/16';
    case 8:
      return '1/32';
    case 16:
      return '1/64';
    default:
      return subdivisionsPerBeat > 16 ? '1/64' : '1/4';
  }
}

/**
 * Picks the optimal musical subdivision density given the horizontal pixel budget per beat.
 * Automatically spawns finer subdivisions (1/8 -> 1/16 -> 1/32 -> 1/64) as the user
 * zooms in horizontally or expands the editor to Large / Fullscreen width.
 */
export function resolveSubdivisionsPerBeat(
  pxPerBeat: number,
  mode: MidiGridResolutionMode = 'auto'
): number {
  const safePx = Math.max(0.5, Number.isFinite(pxPerBeat) ? pxPerBeat : 24);

  if (mode !== 'auto') {
    const requested = MODE_TO_SUBS[mode];
    // Keep at least 7px between adjacent lines so manual fine grids never become a solid wall or lag DOM
    const candidates = [16, 8, 4, 2, 1];
    for (const c of candidates) {
      if (c <= requested && safePx / c >= 7) {
        return c;
      }
    }
    return safePx >= 6 ? 1 : 0;
  }

  if (safePx >= 224) return 16; // 1/64 (>= 14px per line)
  if (safePx >= 104) return 8;  // 1/32 (>= 13px per line)
  if (safePx >= 48) return 4;   // 1/16 (>= 12px per line)
  if (safePx >= 22) return 2;   // 1/8  (>= 11px per line)
  if (safePx >= 9) return 1;    // 1/4  (>= 9px per line)
  return 0;                     // Bars only when zoomed way out
}

function classifySubdivisionLevel(subIndex: number, subdivisionsPerBeat: number): MidiGridLevel {
  if (subIndex === 0) return 'beat';
  if (subIndex * 2 === subdivisionsPerBeat) return 'eighth';
  if ((subIndex * 4) % subdivisionsPerBeat === 0) return 'sixteenth';
  if ((subIndex * 8) % subdivisionsPerBeat === 0) return 'thirtysecond';
  return 'sixtyfourth';
}

function buildBeatTimeline(
  duration: number,
  bpm: number,
  beatOffsetSec: number,
  beatTimes?: number[]
): { beats: number[]; avgBeatSec: number } {
  const safeBpm = Math.max(30, Math.min(300, Number.isFinite(bpm) && bpm > 0 ? bpm : 120));
  const fallbackBeatSec = 60 / safeBpm;

  if (beatTimes && beatTimes.length >= 2) {
    const sorted = beatTimes
      .filter((t) => Number.isFinite(t) && t >= -0.05 && t <= duration + fallbackBeatSec)
      .slice()
      .sort((a, b) => a - b);

    if (sorted.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i] - sorted[i - 1];
        if (d > 0.12 && d < 2.5) diffs.push(d);
      }
      diffs.sort((a, b) => a - b);
      const avgBeatSec = diffs.length > 0 ? diffs[Math.floor(diffs.length / 2)] : fallbackBeatSec;

      // Extrapolate smoothly backward to 0 and forward past duration so edges never lack grid lines
      const extended: number[] = [];
      let head = sorted[0];
      while (head - avgBeatSec >= -0.001) {
        head -= avgBeatSec;
        extended.unshift(Math.max(0, head));
      }
      for (const b of sorted) {
        if (extended.length === 0 || b - extended[extended.length - 1] > 0.04) {
          extended.push(b);
        }
      }
      let tail = extended[extended.length - 1];
      while (tail < duration + avgBeatSec) {
        tail += avgBeatSec;
        extended.push(tail);
      }
      return { beats: extended, avgBeatSec };
    }
  }

  // Regular BPM-derived grid
  const safeOff = Number.isFinite(beatOffsetSec) ? beatOffsetSec % fallbackBeatSec : 0;
  let startT = safeOff >= 0 ? safeOff : safeOff + fallbackBeatSec;
  while (startT - fallbackBeatSec >= 0) {
    startT -= fallbackBeatSec;
  }
  const beats: number[] = [];
  let t = startT;
  const maxBeats = Math.ceil((duration + fallbackBeatSec * 2) / fallbackBeatSec) + 2;
  for (let i = 0; i < maxBeats && t <= duration + fallbackBeatSec; i++) {
    beats.push(t);
    t += fallbackBeatSec;
  }
  return { beats, avgBeatSec: fallbackBeatSec };
}

/**
 * Generates phase-locked adaptive musical grid lines (bars, beats, 1/8, 1/16, 1/32, 1/64)
 * visible inside [viewStartSec, viewEndSec].
 */
export function buildAdaptiveMidiGrid(params: BuildAdaptiveGridParams): AdaptiveGridResult {
  const {
    duration,
    viewStartSec,
    viewEndSec,
    viewportWidthPx,
    bpm,
    beatOffsetSec = 0,
    beatTimes,
    downbeats,
    resolutionMode = 'auto',
  } = params;

  const viewSpanSec = Math.max(0.01, viewEndSec - viewStartSec);
  if (duration <= 0 || viewSpanSec <= 0) {
    return {
      lines: [],
      effectiveSubdivisionsPerBeat: 1,
      effectiveResolutionLabel: '1/4',
      pxPerBeat: 0,
    };
  }

  const { beats, avgBeatSec } = buildBeatTimeline(duration, bpm, beatOffsetSec, beatTimes);
  if (beats.length === 0) {
    return {
      lines: [],
      effectiveSubdivisionsPerBeat: 1,
      effectiveResolutionLabel: '1/4',
      pxPerBeat: 0,
    };
  }

  const safeWidthPx = Math.max(200, Number.isFinite(viewportWidthPx) ? viewportWidthPx : 960);
  const visibleBeats = viewSpanSec / Math.max(0.08, avgBeatSec);
  const pxPerBeat = safeWidthPx / Math.max(0.001, visibleBeats);
  const subs = resolveSubdivisionsPerBeat(pxPerBeat, resolutionMode);

  const hasDownbeats = Boolean(downbeats && downbeats.length > 0);
  const downSet = hasDownbeats ? new Set(downbeats!.map((d) => Math.round(d * 20))) : null;

  // Determine bar-step decimation only when zoomed so far out that even 1-bar lines are < 10px apart
  const pxPerBar = pxPerBeat * 4;
  const barStep = subs === 0 && pxPerBar < 10 ? Math.max(1, Math.ceil(10 / Math.max(0.5, pxPerBar))) : 1;

  const lines: MidiGridLine[] = [];
  const padSec = Math.min(0.02, viewSpanSec * 0.005);

  let runningBarNum = 0;
  let runningBeatInBar = 0;

  for (let i = 0; i < beats.length; i++) {
    const bt = beats[i];
    const nextBt = i + 1 < beats.length ? beats[i + 1] : bt + avgBeatSec;

    const isDownbeat = hasDownbeats
      ? downSet!.has(Math.round(bt * 20))
      : i % 4 === 0;

    if (isDownbeat) {
      runningBarNum = hasDownbeats
        ? Math.max(1, downbeats!.findIndex((d) => Math.abs(d - bt) < 0.06) + 1)
        : Math.floor(i / 4) + 1;
      runningBeatInBar = 1;
    } else {
      runningBeatInBar = runningBeatInBar > 0 ? runningBeatInBar + 1 : (i % 4) + 1;
    }

    // Skip beat interval completely if entirely outside visible range
    if (nextBt < viewStartSec - padSec) continue;
    if (bt > viewEndSec + padSec) break;

    // 1. Primary Beat / Bar line
    if (bt >= viewStartSec - padSec && bt <= viewEndSec + padSec) {
      const includeThisBeat =
        subs > 0 || (isDownbeat && ((runningBarNum - 1) % barStep === 0));

      if (includeThisBeat) {
        const leftPct = ((bt - viewStartSec) / viewSpanSec) * 100;
        lines.push({
          sec: bt,
          leftPct,
          level: isDownbeat ? 'bar' : 'beat',
          isDownbeat,
          barNum: isDownbeat ? runningBarNum : undefined,
          beatInBar: runningBeatInBar,
          subIndex: 0,
          subdivisionsPerBeat: subs,
          subLabel: isDownbeat
            ? `C${runningBarNum}`
            : pxPerBeat >= 22
            ? `.${runningBeatInBar}`
            : undefined,
        });
      }
    }

    // 2. Fractional Subdivisions inside [bt, nextBt)
    if (subs > 1 && nextBt > bt + 0.01) {
      const beatSpan = nextBt - bt;
      for (let s = 1; s < subs; s++) {
        const subSec = bt + (s / subs) * beatSpan;
        if (subSec < viewStartSec - padSec || subSec > viewEndSec + padSec) continue;
        if (subSec > duration + 0.005) continue;

        const level = classifySubdivisionLevel(s, subs);
        const leftPct = ((subSec - viewStartSec) / viewSpanSec) * 100;
        const subLabel =
          level === 'eighth' && pxPerBeat >= 72
            ? `${runningBeatInBar}&`
            : level === 'sixteenth' && pxPerBeat >= 180
            ? `.${Math.round((s * 4) / subs)}`
            : undefined;

        lines.push({
          sec: subSec,
          leftPct,
          level,
          isDownbeat: false,
          beatInBar: runningBeatInBar,
          subIndex: s,
          subdivisionsPerBeat: subs,
          subLabel,
        });
      }
    }
  }

  return {
    lines,
    effectiveSubdivisionsPerBeat: subs,
    effectiveResolutionLabel: subdivisionsToLabel(subs),
    pxPerBeat,
  };
}

/**
 * Snaps a raw time in seconds to the nearest visible adaptive grid line when magnetic snap is enabled.
 */
export function snapSecToAdaptiveGrid(
  rawSec: number,
  gridLines: MidiGridLine[],
  maxDistanceSec?: number
): number {
  if (!gridLines.length) return rawSec;
  let bestSec = rawSec;
  let bestDist = maxDistanceSec ?? Number.POSITIVE_INFINITY;
  for (let i = 0; i < gridLines.length; i++) {
    const dist = Math.abs(gridLines[i].sec - rawSec);
    if (dist < bestDist) {
      bestDist = dist;
      bestSec = gridLines[i].sec;
    }
  }
  return bestSec;
}
