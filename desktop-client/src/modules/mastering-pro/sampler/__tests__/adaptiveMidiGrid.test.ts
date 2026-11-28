import { describe, expect, it } from 'vitest';
import {
  buildAdaptiveMidiGrid,
  resolveSubdivisionsPerBeat,
  snapSecToAdaptiveGrid,
} from '../engine/adaptiveMidiGrid';

describe('adaptiveMidiGrid engine', () => {
  it('progressively increases grid density as horizontal zoom / viewport width expands', () => {
    const duration = 120; // 120s at 120 BPM = 240 beats (60 bars)

    // Zoom 1x on 960px (4px/beat) -> bars only so it stays clean
    const z1 = buildAdaptiveMidiGrid({
      duration,
      viewStartSec: 0,
      viewEndSec: 120,
      viewportWidthPx: 960,
      bpm: 120,
    });
    expect(z1.effectiveSubdivisionsPerBeat).toBe(0);
    expect(z1.effectiveResolutionLabel).toBe('1/1');
    expect(z1.lines.every((l) => l.level === 'bar')).toBe(true);

    // Zoom 8x on 960px (32px/beat) -> 1/8 subdivisions appear
    const z8 = buildAdaptiveMidiGrid({
      duration,
      viewStartSec: 0,
      viewEndSec: 15,
      viewportWidthPx: 960,
      bpm: 120,
    });
    expect(z8.effectiveSubdivisionsPerBeat).toBe(2);
    expect(z8.effectiveResolutionLabel).toBe('1/8');
    expect(z8.lines.some((l) => l.level === 'eighth')).toBe(true);

    // Same 15s span expanded to Fullscreen 1920px (64px/beat) -> automatically denser 1/16 grid!
    const z8Fullscreen = buildAdaptiveMidiGrid({
      duration,
      viewStartSec: 0,
      viewEndSec: 15,
      viewportWidthPx: 1920,
      bpm: 120,
    });
    expect(z8Fullscreen.effectiveSubdivisionsPerBeat).toBe(4);
    expect(z8Fullscreen.effectiveResolutionLabel).toBe('1/16');
    expect(z8Fullscreen.lines.some((l) => l.level === 'sixteenth')).toBe(true);
    expect(z8Fullscreen.lines.length).toBeGreaterThan(z8.lines.length);

    // Deep zoom (4s span on 1400px -> 175px/beat) -> 1/32 fusas
    const zDeep = buildAdaptiveMidiGrid({
      duration,
      viewStartSec: 10,
      viewEndSec: 14,
      viewportWidthPx: 1400,
      bpm: 120,
    });
    expect(zDeep.effectiveSubdivisionsPerBeat).toBe(8);
    expect(zDeep.effectiveResolutionLabel).toBe('1/32');
    expect(zDeep.lines.some((l) => l.level === 'thirtysecond')).toBe(true);

    // Ultra zoom (2s span on 1400px -> 350px/beat) -> 1/64 semifusas
    const zUltra = buildAdaptiveMidiGrid({
      duration,
      viewStartSec: 10,
      viewEndSec: 12,
      viewportWidthPx: 1400,
      bpm: 120,
    });
    expect(zUltra.effectiveSubdivisionsPerBeat).toBe(16);
    expect(zUltra.effectiveResolutionLabel).toBe('1/64');
    expect(zUltra.lines.some((l) => l.level === 'sixtyfourth')).toBe(true);
  });

  it('respects manual resolution modes while safeguarding against excessive density when zoomed out', () => {
    expect(resolveSubdivisionsPerBeat(120, '1/16')).toBe(4);
    expect(resolveSubdivisionsPerBeat(120, '1/32')).toBe(8);
    expect(resolveSubdivisionsPerBeat(120, '1/64')).toBe(16);
    // Zoomed out (16px/beat): 1/64 would be 1px apart, so safety guard steps down to 1/8 (8px apart)
    expect(resolveSubdivisionsPerBeat(16, '1/64')).toBe(2);
  });

  it('interpolates subdivisions accurately across non-uniform AI beatTimes and snaps cleanly', () => {
    const res = buildAdaptiveMidiGrid({
      duration: 10,
      viewStartSec: 0,
      viewEndSec: 2,
      viewportWidthPx: 1200,
      bpm: 120,
      beatTimes: [0.0, 0.52, 1.0, 1.5, 2.0],
      downbeats: [0.0, 2.0],
      resolutionMode: '1/16',
    });
    // Midpoint of first beat [0.0, 0.52] should be exactly 0.26s (eighth)
    const firstEighth = res.lines.find((l) => l.level === 'eighth' && l.sec > 0 && l.sec < 0.52);
    expect(firstEighth?.sec).toBeCloseTo(0.26, 4);

    // Magnetic snap finds nearest 1/16 line (0.13s)
    const snapped = snapSecToAdaptiveGrid(0.142, res.lines);
    expect(snapped).toBeCloseTo(0.13, 4);
  });
});
