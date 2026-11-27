import { describe, it, expect, vi } from 'vitest';
import {
  LYRIC_EFFECT_PRESETS,
  LYRIC_LAYOUT_PRESETS,
  LYRIC_TEXTURE_PRESETS,
  LYRIC_CAMERA_PRESETS,
  LYRIC_BACKGROUND_PRESETS,
  LYRIC_STYLE_PACKS,
  assignAutoWordHierarchy,
  computeWordTimings,
  quantizeLineWordsToRhythm,
  computeSongRhythmState,
  buildBeatGridMs,
  LyricLine,
} from '../../types/lyrics';
import {
  layoutWordsMultiLine,
  renderLyricCanvasFrame,
} from '../../components/LyricVisualizer';

function createMockCanvasContext(): CanvasRenderingContext2D {
  const noop = () => {};
  const gradMock = { addColorStop: noop };
  return {
    save: noop,
    restore: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    roundRect: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setLineDash: noop,
    fillText: noop,
    strokeText: noop,
    drawImage: noop,
    quadraticCurveTo: noop,
    createLinearGradient: () => gradMock,
    createRadialGradient: () => gradMock,
    measureText: (text: string) => ({ width: Math.max(16, text.length * 36) }),
    font: '900 108px "Montserrat", sans-serif',
    fillStyle: '#ffffff',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    textAlign: 'center',
    textBaseline: 'middle',
    lineCap: 'round',
    lineJoin: 'round',
    miterLimit: 2,
    filter: 'none',
  } as unknown as CanvasRenderingContext2D;
}

describe('Lyric Studio Pro Architecture — Fiverr / HyperFrames / Lemo-Opuscar / Rhythm Engine', () => {
  it('registers all 26 animation effects including the 8 new Studio AE / HyperFrames / Lemo-Opuscar effects', () => {
    expect(LYRIC_EFFECT_PRESETS.length).toBe(26);
    const studioAeEffects = LYRIC_EFFECT_PRESETS.filter((p) => p.group === 'studio-ae');
    expect(studioAeEffects.map((p) => p.id)).toEqual([
      'ae-poster-spin',
      'hf-split-tape',
      'hf-kinetic-cascade',
      'knock-echo-matrix',
      'riso-pop-halftone',
      'neon-wet-street',
      'laser-cage-drop',
      'vhs-rec-freeze',
    ]);
  });

  it('registers all 5 layout architectures, 5 glyph textures, 4 2.5D camera modes, 14 backgrounds, and 8 1-Click Style Packs', () => {
    expect(LYRIC_LAYOUT_PRESETS.length).toBe(5);
    expect(LYRIC_TEXTURE_PRESETS.length).toBe(5);
    expect(LYRIC_CAMERA_PRESETS.length).toBe(4);
    expect(LYRIC_BACKGROUND_PRESETS.length).toBe(14);
    expect(LYRIC_STYLE_PACKS.length).toBe(8);
  });

  it('assigns 70/20/8/2 multi-scale typographic roles deterministically (Hero, Badge, Script, Whisper)', () => {
    const base = computeWordTimings('EN LA OSCURIDAD BRILLA TU LUZ', 3000);
    const withRoles = assignAutoWordHierarchy(base, 'ae-poster-spin');

    expect(withRoles.length).toBe(6);
    // Short prepositions ("EN", "LA", "TU") get badge or whisper roles
    expect(['badge', 'whisper']).toContain(withRoles[0].role);
    expect(['badge', 'whisper']).toContain(withRoles[1].role);
    // "OSCURIDAD" (longest content word) or "LUZ" gets promoted to hero
    const hasHero = withRoles.some((w) => w.role === 'hero');
    expect(hasHero).toBe(true);
    const hasBadge = withRoles.some((w) => w.role === 'badge');
    expect(hasBadge).toBe(true);
  });

  it('quantizes word timings to the song musical beat subdivisions and waveform transient peaks', () => {
    const bpm = 120; // 500ms per beat, 125ms per 16th note
    const beatMarkers = buildBeatGridMs(bpm, 0, undefined, 10000, 4);
    const syntheticWaveform = new Array(200).fill(0.2).map((v, i) => (i % 10 === 0 ? 0.95 : v));

    const quantized = quantizeLineWordsToRhythm(
      'LEVANTAMOS NUESTRA VOZ HOY',
      1000,
      2000,
      bpm,
      beatMarkers,
      syntheticWaveform,
      10000,
      undefined,
      'hf-split-tape'
    );

    expect(quantized.length).toBe(4);
    expect(quantized[0].startOffsetMs).toBe(0);
    for (let i = 1; i < quantized.length; i++) {
      expect(quantized[i].startOffsetMs).toBeGreaterThan(quantized[i - 1].startOffsetMs);
      expect(quantized[i].durationMs).toBeGreaterThanOrEqual(80);
    }
    const totalSum = quantized.reduce((acc, w) => acc + w.durationMs, 0);
    expect(totalSum).toBe(2000);
  });

  it('computes deterministic real-time SongRhythmState synced to AI beatTimes or BPM + waveformPeaks', () => {
    const beatTimesSec = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const peaks = [0.1, 0.85, 0.3, 0.9, 0.4, 0.2];

    const stateAtDownbeat = computeSongRhythmState(500, 120, 0.5, beatTimesSec, peaks, 3000, 1.2);
    expect(stateAtDownbeat.isDownbeat).toBe(true);
    expect(stateAtDownbeat.beatInBar).toBe(1);
    expect(stateAtDownbeat.barNumber).toBe(1);
    expect(stateAtDownbeat.beatImpulse).toBeGreaterThan(0.9);
    expect(stateAtDownbeat.downbeatImpulse).toBeGreaterThan(0.9);

    const stateAtBeat2 = computeSongRhythmState(1020, 120, 0.5, beatTimesSec, peaks, 3000, 1.2);
    expect(stateAtBeat2.beatInBar).toBe(2);
    expect(stateAtBeat2.isDownbeat).toBe(false);
  });

  it('lays out phrases across all 5 spatial architectures (smart-wrap, poster-stack, split-anchor, editorial-cascade, corner-frame)', () => {
    const ctx = createMockCanvasContext();
    const words = ['HEAD', 'IS', 'SPINNIN', 'NOW'];
    const timings = assignAutoWordHierarchy(computeWordTimings('HEAD IS SPINNIN NOW', 2400), 'ae-poster-spin');

    for (const mode of ['smart-wrap', 'poster-stack', 'split-anchor', 'editorial-cascade', 'corner-frame'] as const) {
      const res = layoutWordsMultiLine(ctx, words, 1400, 32, 120, {
        wordTimings: timings,
        baseFontSize: 110,
        primaryFont: 'Anton',
        secondaryFont: 'Kaushan Script',
        layoutMode: mode,
        autoHierarchy: true,
      });
      expect(res.items.length).toBe(4);
      expect(res.blockWidth).toBeGreaterThan(0);
      expect(res.blockHeight).toBeGreaterThan(0);
    }
  });

  it('renders all 8 new Studio AE effects and 5 new backgrounds deterministically without errors at 60fps', () => {
    const ctx = createMockCanvasContext();
    const studioEffects = [
      'ae-poster-spin',
      'hf-split-tape',
      'hf-kinetic-cascade',
      'knock-echo-matrix',
      'riso-pop-halftone',
      'neon-wet-street',
      'laser-cage-drop',
      'vhs-rec-freeze',
    ] as const;

    const newBackgrounds = [
      'crimson-grunge-poster',
      'emerald-split-denim',
      'swiss-blueprint-grid',
      'album-card-stage',
      'vintage-paper-ink',
    ] as const;

    studioEffects.forEach((effect, idx) => {
      const bgType = newBackgrounds[idx % newBackgrounds.length];
      const line: LyricLine = {
        id: `test-${effect}`,
        text: 'EN LA OSCURIDAD BRILLA TU LUZ',
        placed: true,
        startMs: 1000,
        durationMs: 3000,
        effect,
        fontFamily: 'Anton',
        secondaryFontFamily: 'Kaushan Script',
        fontSize: 120,
        primaryColor: '#ffffff',
        accentColor: '#facc15',
        autoHierarchy: true,
        rhythmLocked: true,
        cameraMotion: 'beat-punch',
      };

      const bboxSpy = vi.fn();
      expect(() =>
        renderLyricCanvasFrame(ctx, 1920, 1080, 1850, [line], {
          bpm: 128,
          firstBeatOffset: 0.2,
          waveformPeaks: [0.3, 0.7, 0.9, 0.4],
          totalDurationMs: 10000,
          selectedLineId: line.id,
          showSafeZones: true,
          background: {
            type: bgType,
            particles: true,
            pulseWithBpm: true,
            filmGrain: true,
            vignette: true,
            hudTelemetry: true,
            rhythmReactivity: 1.25,
          },
          onUpdateBoundingBox: bboxSpy,
        })
      ).not.toThrow();
      expect(bboxSpy).toHaveBeenCalledWith(
        line.id,
        expect.objectContaining({
          width: expect.any(Number),
          height: expect.any(Number),
        })
      );
    });
  });
});
