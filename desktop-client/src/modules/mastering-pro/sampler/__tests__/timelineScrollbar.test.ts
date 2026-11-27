import { describe, expect, it } from 'vitest';
import {
  MAX_HORIZONTAL_ZOOM,
  MIN_THUMB_WIDTH_PCT,
  clampHorizontalScrollNorm,
  computeAnchoredHorizontalZoom,
  computeHorizontalThumbMetrics,
} from '../components/TimelineHorizontalScrollbar';

describe('TimelineHorizontalScrollbar geometry helpers', () => {
  it('clamps horizontal scrollNorm cleanly within [0, 1 - 1/zoom]', () => {
    expect(clampHorizontalScrollNorm(-0.2, 4)).toBe(0);
    expect(clampHorizontalScrollNorm(0.5, 4)).toBeCloseTo(0.5, 6);
    expect(clampHorizontalScrollNorm(0.95, 4)).toBeCloseTo(0.75, 6);
    expect(clampHorizontalScrollNorm(0.5, 1)).toBe(0);
    expect(clampHorizontalScrollNorm(Number.NaN, 8)).toBe(0);
  });

  it('keeps thumb inside 0..100% bounds across 1x, 8x and extreme 48x zoom', () => {
    const duration = 189.35;

    // 1x: full width thumb at left=0
    const m1 = computeHorizontalThumbMetrics(duration, 0, 1);
    expect(m1.visualLeftPct).toBe(0);
    expect(m1.visualWidthPct).toBe(100);
    expect(m1.maxScrollNorm).toBe(0);

    // 8x: 1:1 exact alignment with timeline
    const m8Mid = computeHorizontalThumbMetrics(duration, duration * 0.5, 8);
    expect(m8Mid.visualWidthPct).toBeCloseTo(12.5, 4);
    expect(m8Mid.visualLeftPct).toBeCloseTo(50, 4);

    // 8x at end of song: right edge hits exactly 100%
    const m8End = computeHorizontalThumbMetrics(duration, duration * (1 - 1 / 8), 8);
    expect(m8End.visualLeftPct + m8End.visualWidthPct).toBeCloseTo(100, 4);

    // 48x extreme zoom at end of song: enforces minimum grab width without overflowing 100%
    const m48End = computeHorizontalThumbMetrics(
      duration,
      duration * (1 - 1 / MAX_HORIZONTAL_ZOOM),
      MAX_HORIZONTAL_ZOOM
    );
    expect(m48End.visualWidthPct).toBe(MIN_THUMB_WIDTH_PCT);
    expect(m48End.visualLeftPct + m48End.visualWidthPct).toBeCloseTo(100, 4);
    expect(m48End.usableTrackFraction).toBeGreaterThan(0.9);
  });

  it('anchors horizontal zoom around cursor/playhead and clamps scrollNorm when zooming out', () => {
    const duration = 180;

    // Zooming in from 1x -> 8x anchored at 50% keeps 90s at the center of the new viewport
    const zoomedIn = computeAnchoredHorizontalZoom({
      duration,
      currentZoom: 1,
      currentScrollNorm: 0,
      nextZoomRaw: 8,
      anchorNorm01: 0.5,
    });
    expect(zoomedIn.zoom).toBe(8);
    const newStart = zoomedIn.scrollNorm * duration;
    const newSpan = duration / zoomedIn.zoom;
    expect(newStart + newSpan * 0.5).toBeCloseTo(90, 4);

    // Zooming out from 8x near the end -> 2x never leaves scrollNorm past 0.5
    const zoomedOut = computeAnchoredHorizontalZoom({
      duration,
      currentZoom: 8,
      currentScrollNorm: 0.875,
      nextZoomRaw: 2,
      anchorNorm01: 0.5,
    });
    expect(zoomedOut.zoom).toBe(2);
    expect(zoomedOut.scrollNorm).toBeLessThanOrEqual(0.5);
    expect(zoomedOut.scrollNorm).toBeGreaterThanOrEqual(0);

    // Zooming back to 1x resets scrollNorm to 0
    const reset = computeAnchoredHorizontalZoom({
      duration,
      currentZoom: 8,
      currentScrollNorm: 0.6,
      nextZoomRaw: 1,
      anchorNorm01: 0.5,
    });
    expect(reset.zoom).toBe(1);
    expect(reset.scrollNorm).toBe(0);
  });
});
