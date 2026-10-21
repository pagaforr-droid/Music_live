import React, { useEffect, useRef, useState } from 'react';
import {
  LyricLine,
  LyricFontFamily,
  LyricWordTiming,
  LyricBackgroundConfig,
  computeWordTimings,
  getFontPreset,
  buildFontString,
  applyTextCase,
  LYRIC_FONT_PRESETS,
} from '../types/lyrics';

export type { LyricLine } from '../types/lyrics';

interface LyricVisualizerProps {
  currentTime: number; // In seconds (from LiveConcert audio engine)
  lyrics: LyricLine[];
  isPlaying: boolean;
  settings?: any;
  bpm?: number;
  firstBeatOffset?: number;
  beatTimes?: number[];
  background?: LyricBackgroundConfig;
}

export interface RenderLyricFrameOptions {
  showSafeZones?: boolean;
  selectedLineId?: string | null;
  snapGuideX?: boolean;
  snapGuideY?: boolean;
  bpm?: number;
  background?: LyricBackgroundConfig;
  backgroundImageElement?: HTMLImageElement | null;
  onUpdateBoundingBox?: (
    lineId: string,
    box: { x: number; y: number; width: number; height: number }
  ) => void;
}

// ════════════════════════════════════════════════════════════════════════════
//  FONT PRELOADER
//  Canvas never triggers webfont downloads by itself: without this, the first
//  frames (and exported videos) silently fall back to a system font.
// ════════════════════════════════════════════════════════════════════════════
let fontsReadyPromise: Promise<void> | null = null;

export function ensureLyricFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !(document as any).fonts) return Promise.resolve();
  if (!fontsReadyPromise) {
    const loads = LYRIC_FONT_PRESETS.map((p) =>
      document.fonts.load(buildFontString(p.id, 64), 'AÁÑZaz09').catch(() => [])
    );
    fontsReadyPromise = Promise.all(loads).then(
      () => undefined,
      () => undefined
    );
  }
  return fontsReadyPromise;
}

// ════════════════════════════════════════════════════════════════════════════
//  EASING (Emil Kowalski / GSAP equivalents — never linear for UI motion)
// ════════════════════════════════════════════════════════════════════════════
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

function easeInCubic(x: number): number {
  return x * x * x;
}

/** GSAP power4.out — the hard "slam" landing. */
function easeOutQuint(x: number): number {
  return 1 - Math.pow(1 - x, 5);
}

/** GSAP expo.out — hardest snap (side-snaps, whip-ins, crash zooms). */
function easeOutExpo(x: number): number {
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Deterministic hash (HyperFrames `glitchHash`): pure function of its input so a
 * seek / export / live replay of the same timestamp always renders the same frame.
 * NEVER use Math.random() in this renderer.
 */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ════════════════════════════════════════════════════════════════════════════
//  COLOR HELPERS
// ════════════════════════════════════════════════════════════════════════════
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '#ffffff').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

/** Mixes a color toward white (amt > 0) or black (amt < 0). amt in -1..1 */
function shade(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = amt >= 0 ? 255 : 0;
  const t = Math.abs(amt);
  const mix = (c: number) => Math.round(c + (target - c) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ════════════════════════════════════════════════════════════════════════════
//  TEXT HELPERS
// ════════════════════════════════════════════════════════════════════════════
function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) {
    (ctx as any).letterSpacing = `${px.toFixed(2)}px`;
  }
}

/** Fill a word with an optional outer outline (stroke drawn first so it sits outside). */
function fillWord(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  strokeWidth: number,
  strokeColor: string
) {
  if (strokeWidth > 0) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = strokeWidth * 2;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
}

/** Per-character x offsets (left edge of each glyph) relative to the word's left edge. */
function charOffsets(ctx: CanvasRenderingContext2D, word: string): number[] {
  const chars = Array.from(word);
  const offsets: number[] = [];
  let prefix = '';
  for (const ch of chars) {
    offsets.push(prefix ? ctx.measureText(prefix).width : 0);
    prefix += ch;
  }
  return offsets;
}

const DECRYPT_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*@!?<>/=+';

const SHUFFLE_FONTS: LyricFontFamily[] = [
  'Bodoni Moda',
  'Space Mono',
  'Fraunces',
  'Anton',
  'Instrument Serif',
  'Syncopate',
  'Monoton',
  'Archivo Black',
];

interface WrappedWordItem {
  word: string;
  wordIndex: number;
  width: number;
  centerX: number; // Offset from line block center X
  centerY: number; // Offset from line block center Y
}

/**
 * Computes smart multi-line layout so long lyric phrases never overflow the 1920x1080 stage canvas.
 */
function layoutWordsMultiLine(
  ctx: CanvasRenderingContext2D,
  words: string[],
  maxLineWidth: number,
  wordSpacing: number,
  lineHeight: number
): { items: WrappedWordItem[]; blockWidth: number; blockHeight: number } {
  const rows: { words: { word: string; wordIndex: number; width: number }[]; totalWidth: number }[] = [];
  let currentRow: { word: string; wordIndex: number; width: number }[] = [];
  let currentRowWidth = 0;

  words.forEach((word, idx) => {
    const wWidth = ctx.measureText(word).width;
    const projectedWidth = currentRow.length === 0 ? wWidth : currentRowWidth + wordSpacing + wWidth;

    if (currentRow.length > 0 && projectedWidth > maxLineWidth) {
      rows.push({ words: currentRow, totalWidth: currentRowWidth });
      currentRow = [{ word, wordIndex: idx, width: wWidth }];
      currentRowWidth = wWidth;
    } else {
      currentRow.push({ word, wordIndex: idx, width: wWidth });
      currentRowWidth = projectedWidth;
    }
  });

  if (currentRow.length > 0) {
    rows.push({ words: currentRow, totalWidth: currentRowWidth });
  }

  const totalRows = rows.length;
  const blockHeight = totalRows * lineHeight;
  let maxRowWidth = 0;
  const items: WrappedWordItem[] = [];

  rows.forEach((row, rowIdx) => {
    if (row.totalWidth > maxRowWidth) maxRowWidth = row.totalWidth;
    const rowY = (rowIdx - (totalRows - 1) / 2) * lineHeight;
    let cursorX = -row.totalWidth / 2;

    row.words.forEach((w) => {
      items.push({
        word: w.word,
        wordIndex: w.wordIndex,
        width: w.width,
        centerX: cursorX + w.width / 2,
        centerY: rowY,
      });
      cursorX += w.width + wordSpacing;
    });
  });

  return { items, blockWidth: maxRowWidth, blockHeight };
}

/** Quantized, decaying screen-shake triggered on every word onset (kinetic-beat-slam chrome). */
function computeOnsetShake(
  elapsedMs: number,
  timings: LyricWordTiming[],
  amplitude: number,
  seed: number
): { x: number; y: number } {
  if (amplitude <= 0) return { x: 0, y: 0 };
  let lastOnset = -1;
  let onsetIndex = 0;
  for (let i = 0; i < timings.length; i++) {
    if (timings[i].startOffsetMs <= elapsedMs) {
      lastOnset = timings[i].startOffsetMs;
      onsetIndex = i;
    }
  }
  if (lastOnset < 0) return { x: 0, y: 0 };
  const dt = elapsedMs - lastOnset;
  if (dt > 260) return { x: 0, y: 0 };
  const decay = Math.exp(-dt / 70);
  const step = Math.floor(elapsedMs / 33); // ~30fps quantization = the digital stutter
  const amp = amplitude * (onsetIndex === 0 ? 1.4 : 1) * decay;
  return {
    x: (hash01(step * 13 + seed) * 2 - 1) * amp,
    y: (hash01(step * 29 + seed + 7) * 2 - 1) * amp * 0.6,
  };
}

/**
 * Master Deterministic 60fps Stage Canvas Renderer shared between LyricStudio and LiveConcert.
 * Pure function of `timeMs` — the same timestamp always yields the same frame (seek/export safe).
 */
export function renderLyricCanvasFrame(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  timeMs: number,
  lyrics: LyricLine[],
  options: RenderLyricFrameOptions = {}
) {
  const { showSafeZones, selectedLineId, snapGuideX, snapGuideY, bpm = 120, onUpdateBoundingBox } = options;

  // 1. Customizable Stage Background
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  const bgConfig = options.background || { type: 'obsidian-red', pulseWithBpm: true };
  const bgType = bgConfig.type || 'obsidian-red';
  const pulseEnabled = bgConfig.pulseWithBpm !== false;

  const beatPeriodMs = 60000 / Math.max(40, Math.min(240, bpm || 120));
  const beatPulse = pulseEnabled
    ? Math.pow(0.5 + 0.5 * Math.sin((timeMs / beatPeriodMs) * Math.PI * 2), 2)
    : 0;

  if (bgType === 'transparent') {
    ctx.clearRect(0, 0, canvasW, canvasH);
  } else if (bgType === 'pure-black') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (bgType === 'chroma-green') {
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (bgType === 'chroma-blue') {
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (bgType === 'custom-solid') {
    ctx.fillStyle = bgConfig.customColor || '#050608';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (bgType === 'custom-image' && options.backgroundImageElement) {
    const img = options.backgroundImageElement;
    const scale = Math.max(canvasW / img.width, canvasH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (canvasW - w) / 2;
    const y = (canvasH - h) / 2;
    ctx.drawImage(img, x, y, w, h);
    // Subtle dark cinematic tint so lyrics remain readable
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    // Atmospheric Presets (obsidian-red, warm-gold, cyber-blue, midnight-purple)
    let baseColor = '#050608';
    let r = 239, g = 68, b = 68; // default red
    if (bgType === 'warm-gold') {
      baseColor = '#090805';
      r = 212; g = 175; b = 55;
    } else if (bgType === 'cyber-blue') {
      baseColor = '#030812';
      r = 6; g = 182; b = 212;
    } else if (bgType === 'midnight-purple') {
      baseColor = '#080410';
      r = 168; g = 85; b = 247;
    }

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, canvasW, canvasH);

    const centerGrad = ctx.createRadialGradient(
      canvasW * 0.5,
      canvasH * 0.52,
      10,
      canvasW * 0.5,
      canvasH * 0.52,
      canvasW * 0.68
    );
    centerGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.11 + beatPulse * 0.05})`);
    centerGrad.addColorStop(
      0.45,
      `rgba(${Math.round(r * 0.15)}, ${Math.round(g * 0.15)}, ${Math.round(b * 0.15)}, ${
        0.22 + beatPulse * 0.04
      })`
    );
    centerGrad.addColorStop(1, baseColor);
    ctx.fillStyle = centerGrad;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Subtle LED Stage Horizon Line
    const horizonGrad = ctx.createLinearGradient(0, 0, canvasW, 0);
    horizonGrad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    horizonGrad.addColorStop(0.5, `rgba(${r},${g},${b},${0.12 + beatPulse * 0.08})`);
    horizonGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = horizonGrad;
    ctx.fillRect(0, canvasH - 6, canvasW, 6);
  }

  // 1.5. Stage Atmospheric Bokeh / Particles (Deterministic 60fps)
  if (bgConfig.particles && bgType !== 'transparent') {
    ctx.save();
    const particleCount = 28;
    for (let p = 0; p < particleCount; p++) {
      const seed = p * 197.33;
      const speed = 0.00015 + hash01(seed) * 0.00015;
      const px = ((hash01(seed + 1) + timeMs * speed * 0.3) % 1) * canvasW;
      const rawY = (hash01(seed + 2) - timeMs * speed) % 1;
      const py = (rawY < 0 ? rawY + 1 : rawY) * canvasH;
      const radius = 3 + hash01(seed + 3) * 9;
      const alpha = (0.08 + hash01(seed + 4) * 0.14) * (1 + beatPulse * 0.3);

      const radGrad = ctx.createRadialGradient(px, py, 0, px, py, radius * 2.5);
      radGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      radGrad.addColorStop(0.4, `rgba(255, 255, 255, ${alpha * 0.4})`);
      radGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.fillStyle = radGrad;
      ctx.beginPath();
      ctx.arc(px, py, radius * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();

  // 2. Optional Safe Zones & Magnetic Center Guides (Editor Mode)
  if (showSafeZones) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    const marginX = canvasW * 0.08;
    const marginY = canvasH * 0.08;
    ctx.strokeRect(marginX, marginY, canvasW - marginX * 2, canvasH - marginY * 2);

    // Subtitle lower-third guide (82% Y)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(marginX, canvasH * 0.82);
    ctx.lineTo(canvasW - marginX, canvasH * 0.82);
    ctx.stroke();
    ctx.restore();
  }

  if (snapGuideX) {
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvasW / 2, 0);
    ctx.lineTo(canvasW / 2, canvasH);
    ctx.stroke();
    ctx.restore();
  }

  if (snapGuideY) {
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvasH / 2);
    ctx.lineTo(canvasW, canvasH / 2);
    ctx.stroke();
    ctx.restore();
  }

  // 3. Render Placed Active Lyric Lines
  const placedLyrics = (lyrics || []).filter((l) => l.placed !== false);

  placedLyrics.forEach((line, lineIdx) => {
    if (timeMs < line.startMs || timeMs > line.startMs + line.durationMs) return;

    const elapsedMs = timeMs - line.startMs;
    const progress = Math.max(0, Math.min(1, elapsedMs / Math.max(100, line.durationMs)));

    const preset = getFontPreset(line.fontFamily);
    const baseFontSize = line.fontSize || 108;
    const fontString = buildFontString(line.fontFamily, baseFontSize);
    const posX = (line.positionX !== undefined ? line.positionX : 0.5) * canvasW;
    const posY = (line.positionY !== undefined ? line.positionY : 0.5) * canvasH;
    const primaryColor = line.primaryColor || '#ffffff';
    const accentColor = line.accentColor || '#ef4444';
    const trackingPx = (line.letterSpacing ?? preset.tracking ?? 0) * baseFontSize;
    const textCase = line.textCase ?? preset.defaultCase ?? 'upper';
    const strokeWidth = Math.max(0, line.strokeWidth || 0);
    const intensity = Math.max(0, Math.min(2, line.fxIntensity ?? 1));
    const seed = lineIdx * 1013 + Math.round(line.startMs);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontString;
    setLetterSpacing(ctx, trackingPx);

    const rawWords = line.text
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (rawWords.length === 0) {
      ctx.restore();
      return;
    }
    // Draw-time capitalisation per word keeps word count (and timings) perfectly aligned.
    const words = rawWords.map((w) => applyTextCase(w, textCase));

    const wordTimings = computeWordTimings(line.text, line.durationMs, line.words);
    const wordSpacing = Math.round(baseFontSize * 0.34);
    const lineHeight = Math.round(baseFontSize * 1.18);
    const maxLineWidth = line.effect === 'stacked-impact' ? baseFontSize * 5.2 : canvasW * 0.82;

    const { items, blockWidth, blockHeight } = layoutWordsMultiLine(
      ctx,
      words,
      maxLineWidth,
      wordSpacing,
      lineHeight
    );

    if (onUpdateBoundingBox) {
      onUpdateBoundingBox(line.id, {
        x: posX - blockWidth / 2 - 36,
        y: posY - blockHeight / 2 - 28,
        width: blockWidth + 72,
        height: blockHeight + 56,
      });
    }

    // Line-level envelope fade in/out for smooth transitions
    let lineEnvelope = 1;
    if (progress < 0.08) lineEnvelope = easeOutCubic(progress / 0.08);
    else if (progress > 0.9) lineEnvelope = 1 - easeInCubic((progress - 0.9) / 0.1);

    // ── LINE-LEVEL LAYER A: Ghost text (giant drifting word behind the phrase) ──
    if (line.ghostText) {
      const ghostWord = words.reduce((a, b) => (b.length > a.length ? b : a), words[0]);
      ctx.save();
      ctx.font = buildFontString(line.fontFamily, baseFontSize * 3.1);
      ctx.globalAlpha = 0.065 * lineEnvelope;
      ctx.fillStyle = primaryColor;
      ctx.fillText(ghostWord, posX + 90 - progress * 180, posY);
      ctx.restore();
    }

    // ── LINE-LEVEL LAYER B: Crash-zoom impact flash + radial speed lines ──
    if (line.effect === 'crash-zoom' && intensity > 0) {
      if (elapsedMs < 140) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.75, (1 - elapsedMs / 140) * 0.55 * intensity);
        ctx.fillStyle = shade(accentColor, 0.65);
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.restore();
      }
      if (elapsedMs < 420) {
        const p = elapsedMs / 420;
        const LINES = 30;
        ctx.save();
        ctx.lineCap = 'round';
        for (let i = 0; i < LINES; i++) {
          const angle = (i / LINES) * Math.PI * 2 + hash01(seed + i) * 0.18;
          const r0 = 140 + easeOutCubic(p) * canvasW * 0.42 + hash01(seed + i * 3) * 60;
          const len = (1 - p) * (160 + hash01(seed + i * 7) * 240) * Math.min(1.5, intensity);
          ctx.strokeStyle = rgba(i % 3 === 0 ? '#ffffff' : accentColor, (1 - p) * 0.85);
          ctx.lineWidth = 3 + hash01(seed + i * 11) * 6;
          ctx.beginPath();
          ctx.moveTo(posX + Math.cos(angle) * r0, posY + Math.sin(angle) * r0);
          ctx.lineTo(posX + Math.cos(angle) * (r0 + len), posY + Math.sin(angle) * (r0 + len));
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // ── LINE-LEVEL LAYER C: Onset screen-shake (applies to every word of the line) ──
    if (line.effect === 'beat-slam' || line.effect === 'crash-zoom') {
      const amp = (line.effect === 'crash-zoom' ? 30 : 20) * intensity;
      const shake = computeOnsetShake(elapsedMs, wordTimings, amp, seed);
      ctx.translate(shake.x, shake.y);
    }

    // Keyword (longest word) for the font-shuffle effect
    let keywordIndex = 0;
    if (line.effect === 'font-shuffle') {
      words.forEach((w, i) => {
        if (w.length > words[keywordIndex].length) keywordIndex = i;
      });
    }

    items.forEach((item) => {
      const wt = wordTimings[item.wordIndex] || {
        word: item.word,
        startOffsetMs: (item.wordIndex / words.length) * line.durationMs * 0.7,
        durationMs: line.durationMs / words.length,
      };

      const wordElapsed = elapsedMs - wt.startOffsetMs;
      const wordProgress = Math.max(0, Math.min(1, wordElapsed / Math.max(80, wt.durationMs)));
      const isWordActive = elapsedMs >= wt.startOffsetMs && elapsedMs <= wt.startOffsetMs + wt.durationMs;
      const isWordCompleted = elapsedMs > wt.startOffsetMs + wt.durationMs;

      const drawX = posX + item.centerX;
      const drawY = posY + item.centerY;

      ctx.save();

      // EFFECT 1: CAPCUT KARAOKE PRO (Word-by-Word Active Fill + Spring Bounce)
      if (line.effect === 'capcut-karaoke') {
        const bounce = isWordActive
          ? 1 + Math.sin(wordProgress * Math.PI) * 0.14
          : isWordCompleted
          ? 1.02
          : 0.96;
        const liftY = isWordActive ? -Math.sin(wordProgress * Math.PI) * 12 : 0;

        ctx.translate(drawX, drawY + liftY);
        ctx.scale(bounce, bounce);

        // Active word pill backdrop in Stage Red
        if (isWordActive) {
          ctx.save();
          ctx.fillStyle = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 32;
          const padX = 20;
          const padY = 10;
          ctx.beginPath();
          ctx.roundRect(
            -item.width / 2 - padX,
            -baseFontSize * 0.52 - padY / 2,
            item.width + padX * 2,
            baseFontSize * 0.98 + padY,
            18
          );
          ctx.fill();
          ctx.restore();
        }

        // Unsung base text (ghosted white)
        ctx.globalAlpha = lineEnvelope * (isWordCompleted ? 0.95 : 0.32);
        ctx.fillStyle = primaryColor;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);

        // Progressive wipe fill on active/completed word
        if (wordProgress > 0) {
          ctx.save();
          ctx.beginPath();
          const fillW = item.width * wordProgress;
          ctx.rect(-item.width / 2 - 10, -baseFontSize, fillW + 20, baseFontSize * 2);
          ctx.clip();
          ctx.globalAlpha = lineEnvelope;
          ctx.fillStyle = isWordActive ? '#ffffff' : primaryColor;
          if (!isWordActive && isWordCompleted) {
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 18;
          }
          ctx.fillText(item.word, 0, 0);
          ctx.restore();
        }
      }

      // EFFECT 2: KINETIC STAGE SLAM (Spring Physics Overshoot)
      else if (line.effect === 'kinetic') {
        if (wordProgress <= 0) {
          ctx.restore();
          return;
        }
        const entryP = Math.min(1, wordProgress / 0.35);
        const scale = entryP < 1 ? Math.max(0.2, easeOutBack(entryP)) : 1;
        const yOffset = (1 - easeOutCubic(entryP)) * 42;

        ctx.translate(drawX, drawY + yOffset);
        ctx.scale(scale, scale);
        ctx.globalAlpha = lineEnvelope * Math.min(1, entryP * 1.4);

        if (isWordActive) {
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 28;
          ctx.fillStyle = accentColor;
        } else {
          ctx.shadowColor = 'rgba(0,0,0,0.75)';
          ctx.shadowBlur = 16;
          ctx.fillStyle = primaryColor;
        }
        fillWord(ctx, item.word, 0, 0, strokeWidth, isWordActive ? primaryColor : accentColor);
      }

      // EFFECT 3: SMOOTH BLUR REVEAL (Cinematic Optical Focus)
      else if (line.effect === 'smooth-blur') {
        const staggerDelay = item.wordIndex * (0.28 / Math.max(1, words.length));
        const localP = Math.max(0, Math.min(1, (progress - staggerDelay) / (1 - staggerDelay)));
        if (localP <= 0) {
          ctx.restore();
          return;
        }

        let opacity = 1;
        let blurPx = 0;
        let scale = 1;

        if (localP < 0.25) {
          const p = easeOutCubic(localP / 0.25);
          opacity = p;
          blurPx = (1 - p) * 18;
          scale = 0.92 + p * 0.08;
        } else if (localP > 0.82) {
          const p = easeInCubic((localP - 0.82) / 0.18);
          opacity = 1 - p;
          blurPx = p * 16;
          scale = 1 + p * 0.06;
        }

        ctx.translate(drawX, drawY);
        ctx.scale(scale, scale);
        if (blurPx > 0.5) ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
        ctx.globalAlpha = opacity;
        ctx.fillStyle = primaryColor;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = isWordActive ? 24 : 8;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);
      }

      // EFFECT 4: NEON STAGE ARENA (Double Tube Glow + Pulse)
      else if (line.effect === 'neon-stage') {
        ctx.translate(drawX, drawY);
        const activeScale = isWordActive ? 1.07 : 1.0;
        ctx.scale(activeScale, activeScale);
        ctx.globalAlpha = lineEnvelope * (wordProgress > 0 ? 1 : 0.45);

        ctx.shadowColor = accentColor;
        ctx.shadowBlur = isWordActive ? 42 : 18;
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = (isWordActive ? 6 : 3) + strokeWidth;
        ctx.strokeText(item.word, 0, 0);

        ctx.fillStyle = isWordActive ? '#ffffff' : 'rgba(255,255,255,0.85)';
        ctx.fillText(item.word, 0, 0);
      }

      // EFFECT 5: STACKED POSTER 3D (Urban/Festival Vertical Block Impact)
      else if (line.effect === 'stacked-impact') {
        if (wordProgress <= 0) {
          ctx.restore();
          return;
        }
        const entry = easeOutBack(Math.min(1, wordProgress / 0.3));
        ctx.translate(drawX, drawY);
        ctx.scale(entry, entry);
        ctx.globalAlpha = lineEnvelope;

        // 3D Extrusion Shadow in Stage Red
        ctx.fillStyle = accentColor;
        ctx.fillText(item.word, 7, 7);

        ctx.fillStyle = primaryColor;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);
      }

      // EFFECT 6: CHROMATIC GLOW (RGB Split)
      else if (line.effect === 'chromatic-glow') {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope;
        const aberration = isWordActive ? 6 + Math.sin(timeMs / 55) * 3 : 2.5;

        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(239, 68, 68, ${0.9 * lineEnvelope})`;
        ctx.fillText(item.word, -aberration, 0);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * lineEnvelope})`;
        ctx.fillText(item.word, 0, 0);
        ctx.fillStyle = `rgba(6, 182, 212, ${0.88 * lineEnvelope})`;
        ctx.fillText(item.word, aberration, 0);
        ctx.globalCompositeOperation = 'source-over';
      }

      // EFFECT 7: GRADIENT WIPE (Laser Sweep)
      else if (line.effect === 'gradient-wipe') {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        fillWord(ctx, item.word, 0, 0, strokeWidth, rgba(accentColor, 0.5));

        ctx.save();
        ctx.beginPath();
        const wipeW = item.width * Math.min(1, wordProgress * 1.15);
        ctx.rect(-item.width / 2 - 8, -baseFontSize, wipeW + 16, baseFontSize * 2);
        ctx.clip();
        const grad = ctx.createLinearGradient(-item.width / 2, 0, item.width / 2, 0);
        grad.addColorStop(0, primaryColor);
        grad.addColorStop(0.75, primaryColor);
        grad.addColorStop(1, accentColor);
        ctx.fillStyle = grad;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 16;
        ctx.fillText(item.word, 0, 0);
        ctx.restore();
      }

      // EFFECT 8: CYBER GLITCH (HyperFrames `chromatic-glitch` — quantized RGB jitter + slices)
      else if (line.effect === 'glitch') {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope * (wordElapsed < 0 ? 0.35 : 1);

        // Envelope: violent at the onset (power3.in decay), plus one short emphasis burst mid-word.
        const GLITCH_DUR = 380;
        let amp = 0;
        if (wordElapsed >= 0 && wordElapsed < GLITCH_DUR) amp = 1 - Math.pow(wordElapsed / GLITCH_DUR, 3);
        const burstAt = wt.durationMs * 0.58;
        if (isWordActive && wordElapsed > burstAt && wordElapsed < burstAt + 140) {
          amp = Math.max(amp, 0.55 * (1 - (wordElapsed - burstAt) / 140));
        }
        amp *= intensity;

        const step = Math.floor(timeMs / 42); // quantized time — the stutter IS the effect
        if (amp > 0.02) {
          const jx = (hash01(step * 13 + item.wordIndex * 7) * 2 - 1) * 14 * amp;
          const jy = (hash01(step * 29 + item.wordIndex * 11) * 2 - 1) * 5 * amp;
          // RGB ghosts behind (warm + cool)
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = rgba(accentColor, 0.85);
          ctx.fillText(item.word, jx, jy);
          ctx.fillStyle = 'rgba(6, 182, 212, 0.85)';
          ctx.fillText(item.word, -jx, -jy);
          ctx.restore();
          // Slice displacement: horizontal bands converge back to 0
          const SLICES = 6;
          const top = -baseFontSize * 0.62;
          const bandH = (baseFontSize * 1.24) / SLICES;
          ctx.fillStyle = primaryColor;
          for (let b = 0; b < SLICES; b++) {
            const ox = (hash01(step * 17 + b * 31 + item.wordIndex * 5) * 2 - 1) * 64 * amp;
            ctx.save();
            ctx.beginPath();
            ctx.rect(-item.width / 2 - 120, top + b * bandH, item.width + 240, bandH + 1);
            ctx.clip();
            ctx.fillText(item.word, ox, 0);
            ctx.restore();
          }
        } else {
          // Clean resolve — bit-exact rest state
          ctx.fillStyle = primaryColor;
          if (isWordActive) {
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 22;
          }
          fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);
        }
      }

      // EFFECT 9: BEAT SLAM BRUTAL (HyperFrames `kinetic-beat-slam` — distinct entrance per word)
      else if (line.effect === 'beat-slam') {
        if (wordElapsed < 0) {
          ctx.restore();
          return;
        }
        const ENTRY = 420;
        const p = clamp01(wordElapsed / ENTRY);
        const mode = item.wordIndex % 3;
        let tx = 0;
        let ty = 0;
        let rot = 0;
        let scale = 1;
        let blurPx = 0;

        if (mode === 0) {
          // Scale + blur slam (power4.out)
          const e = easeOutQuint(p);
          scale = 1 + (1 - e) * 0.85 * intensity;
          blurPx = (1 - e) * 16 * intensity;
        } else if (mode === 1) {
          // Side snap (expo.out) — direction alternates deterministically
          const dir = hash01(seed + item.wordIndex) > 0.5 ? 1 : -1;
          tx = (1 - easeOutExpo(p)) * 340 * dir * intensity;
          blurPx = (1 - easeOutExpo(p)) * 8 * intensity;
        } else {
          // Rise + rotate (circ-like heavy rise)
          const e = easeOutCubic(p);
          ty = (1 - e) * 110 * intensity;
          rot = (1 - e) * 0.16 * intensity;
        }

        ctx.translate(drawX + tx, drawY + ty);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        if (blurPx > 0.5) ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
        ctx.globalAlpha = lineEnvelope * Math.min(1, p * 5);

        if (isWordActive) {
          ctx.fillStyle = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 34;
        } else {
          ctx.fillStyle = primaryColor;
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 14;
        }
        fillWord(ctx, item.word, 0, 0, strokeWidth, isWordActive ? primaryColor : accentColor);

        // White impact flash on the very first frames of the hit
        if (p < 0.12) {
          ctx.filter = 'none';
          ctx.globalAlpha = (1 - p / 0.12) * 0.9 * lineEnvelope;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(item.word, 0, 0);
        }
      }

      // EFFECT 10: CRASH ZOOM IMPACT (crash-zoom-in + motion echoes)
      else if (line.effect === 'crash-zoom') {
        if (wordElapsed < 0) {
          ctx.restore();
          return;
        }
        const ENTRY = 300;
        const p = clamp01(wordElapsed / ENTRY);
        const e = easeOutExpo(p);
        const scale = 1 + (1 - e) * 2.2 * Math.max(0.3, intensity);

        ctx.translate(drawX, drawY);
        // Motion echoes collapsing into the lead copy
        if (p < 1) {
          for (let k = 3; k >= 1; k--) {
            ctx.save();
            const s = scale * (1 + k * 0.16 * (1 - e));
            ctx.scale(s, s);
            ctx.globalAlpha = (0.22 * (1 - p)) / k * lineEnvelope;
            ctx.fillStyle = accentColor;
            ctx.fillText(item.word, 0, 0);
            ctx.restore();
          }
        }
        ctx.scale(scale, scale);
        ctx.globalAlpha = lineEnvelope * Math.min(1, p * 3);
        ctx.fillStyle = isWordActive ? '#ffffff' : primaryColor;
        ctx.shadowColor = isWordActive ? accentColor : 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = isWordActive ? 38 : 14;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);
      }

      // EFFECT 11: HACKER DECRYPT 3D (HyperFrames `hacker-flip-3d`)
      else if (line.effect === 'decrypt') {
        if (wordElapsed < 0) {
          ctx.restore();
          return;
        }
        const chars = Array.from(item.word);
        const offsets = charOffsets(ctx, item.word);
        const FLIP = 520;
        const stagger = Math.max(18, Math.min(55, (wt.durationMs * 0.5) / Math.max(1, chars.length)));
        const left = drawX - item.width / 2;
        const hingeY = drawY + baseFontSize * 0.42;
        ctx.textAlign = 'left';
        ctx.globalAlpha = lineEnvelope;

        chars.forEach((ch, ci) => {
          const cp = clamp01((wordElapsed - ci * stagger) / FLIP);
          if (cp <= 0) return;
          const angle = (1 - easeOutCubic(cp)) * (Math.PI / 2);
          const scaleY = Math.max(0.03, Math.cos(angle));
          const decoded = cp >= 0.62;
          const glyph = decoded
            ? ch
            : DECRYPT_GLYPHS[
                Math.floor(
                  hash01(ci * 1000 + item.wordIndex * 97 + Math.floor(timeMs / 50)) * DECRYPT_GLYPHS.length
                )
              ];
          ctx.save();
          ctx.translate(left + offsets[ci], hingeY);
          ctx.scale(1, scaleY);
          ctx.globalAlpha = lineEnvelope * Math.min(1, cp * 2);
          if (!decoded) {
            ctx.fillStyle = accentColor;
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 18 * intensity;
          } else if (isWordActive) {
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 24;
          } else {
            ctx.fillStyle = primaryColor;
          }
          fillWord(ctx, glyph, 0, -baseFontSize * 0.42, strokeWidth, accentColor);
          ctx.restore();
        });
      }

      // EFFECT 12: 3D DEPTH EXTRUDE (HyperFrames `3d-text-depth-layers` + beat pulse)
      else if (line.effect === 'depth-extrude') {
        if (wordElapsed < 0) {
          ctx.restore();
          return;
        }
        const LAYERS = 6;
        const grow = easeOutCubic(clamp01(wordElapsed / 500));
        const entry = easeOutBack(clamp01(wordElapsed / 300));
        const scale = (0.86 + 0.14 * entry) * (isWordActive ? 1.04 : 1);
        const off = 5 * Math.max(0.4, intensity) * (1 + beatPulse * 0.5) * grow;

        ctx.translate(drawX, drawY);
        ctx.scale(scale, scale);
        ctx.globalAlpha = lineEnvelope;
        // Back-to-front: translucent accent cast (light from upper-left)
        for (let i = LAYERS; i >= 1; i--) {
          ctx.fillStyle = rgba(accentColor, Math.max(0.85 - i * 0.12, 0.15));
          ctx.fillText(item.word, i * off, i * off);
        }
        ctx.fillStyle = primaryColor;
        fillWord(ctx, item.word, 0, 0, strokeWidth, shade(accentColor, -0.4));
      }

      // EFFECT 13: WATERFALL WHIP (HyperFrames `waterfall-entry` — binary opacity, weighted travel)
      else if (line.effect === 'waterfall') {
        const leadMs = 60; // lead the anchor so the word LANDS on its onset
        const arrival = wordElapsed + leadMs;
        if (arrival < 0) {
          ctx.restore();
          return;
        }
        const len = Array.from(item.word).length;
        const travel = (len >= 6 ? 80 : len >= 3 ? 48 : 34) * Math.max(0.4, intensity);
        const dur = len >= 6 ? 200 : len >= 3 ? 160 : 120;
        const p = clamp01(arrival / dur);
        const e = easeOutQuint(p);
        const y = (1 - e) * travel;

        ctx.translate(drawX, drawY + y);
        ctx.globalAlpha = lineEnvelope; // binary 0→1 — never fade an arrival
        if (p < 1) {
          // velocity smear echoes trailing below
          ctx.save();
          ctx.fillStyle = rgba(accentColor, 0.18 * (1 - p));
          ctx.fillText(item.word, 0, travel * (1 - e) * 0.5);
          ctx.fillText(item.word, 0, travel * (1 - e));
          ctx.restore();
        }
        if (isWordActive) {
          ctx.scale(1.04, 1.04);
          ctx.fillStyle = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 26;
        } else {
          ctx.fillStyle = primaryColor;
        }
        fillWord(ctx, item.word, 0, 0, strokeWidth, isWordActive ? primaryColor : accentColor);
      }

      // EFFECT 14: LUXE CHROME SWEEP (chrome-sweep / gradient-text-sweep inside the glyphs)
      else if (line.effect === 'luxe-chrome') {
        const started = wordElapsed >= 0;
        const entry = started ? easeOutCubic(clamp01(wordElapsed / 360)) : 0;
        const scale = 0.96 + 0.04 * entry;
        ctx.translate(drawX, drawY);
        ctx.scale(scale, scale);
        ctx.globalAlpha = lineEnvelope * (started ? 0.35 + 0.65 * entry : 0.28);

        // Metallic vertical gradient (light top, dark horizon, light bottom)
        const h = baseFontSize * 0.55;
        const metal = ctx.createLinearGradient(0, -h, 0, h);
        metal.addColorStop(0, shade(accentColor, 0.85));
        metal.addColorStop(0.42, shade(accentColor, 0.15));
        metal.addColorStop(0.5, shade(accentColor, -0.45));
        metal.addColorStop(0.58, shade(accentColor, 0.05));
        metal.addColorStop(1, shade(accentColor, 0.7));

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 6;
        ctx.fillStyle = metal;
        fillWord(ctx, item.word, 0, 0, strokeWidth, shade(accentColor, -0.55));
        ctx.restore();

        // Thin dark engraving line for definition
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = shade(accentColor, -0.6);
        ctx.strokeText(item.word, 0, 0);

        // Specular band sweeps once through the letters at the word onset, again on the beat
        if (started) {
          const sweepP = clamp01(wordElapsed / 650);
          const beatSweep = isWordActive ? (timeMs % beatPeriodMs) / beatPeriodMs : 1;
          const passes = sweepP < 1 ? [sweepP] : isWordActive ? [beatSweep] : [];
          passes.forEach((sp) => {
            const span = item.width + 400;
            const cx = -item.width / 2 - 200 + span * sp;
            const band = ctx.createLinearGradient(cx - 120, -h, cx + 120, h);
            band.addColorStop(0, 'rgba(255,255,255,0)');
            band.addColorStop(0.5, `rgba(255,255,255,${0.92 * Math.min(1, intensity)})`);
            band.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = band;
            ctx.fillText(item.word, 0, 0);
          });
        }
      }

      // EFFECT 15: FONT SHUFFLE BEAT (typewriter-phrase-keyword-shuffle)
      else if (line.effect === 'font-shuffle') {
        if (wordElapsed < 0) {
          ctx.restore();
          return;
        }
        const pop = easeOutBack(clamp01(wordElapsed / 110));
        ctx.translate(drawX, drawY + (1 - pop) * 6);
        ctx.globalAlpha = lineEnvelope * Math.min(1, wordElapsed / 60);

        if (item.wordIndex === keywordIndex) {
          const lockAt = line.durationMs * 0.74;
          let fontId: LyricFontFamily | undefined = line.fontFamily;
          if (elapsedMs < lockAt) {
            const beatIdx = Math.floor(wordElapsed / beatPeriodMs);
            if (beatIdx >= 1) fontId = SHUFFLE_FONTS[(beatIdx - 1 + item.wordIndex) % SHUFFLE_FONTS.length];
          }
          ctx.font = buildFontString(fontId, baseFontSize);
          // Fit the shuffled face into the keyword's original slot — no layout jump.
          const w = Math.max(1, ctx.measureText(item.word).width);
          const fit = Math.max(0.6, Math.min(1.35, item.width / w));
          ctx.scale(fit * (0.92 + 0.08 * pop), fit * (0.92 + 0.08 * pop));
          ctx.fillStyle = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = isWordActive ? 30 : 12;
          fillWord(ctx, item.word, 0, 0, strokeWidth, primaryColor);
        } else {
          ctx.scale(0.92 + 0.08 * pop, 0.92 + 0.08 * pop);
          ctx.fillStyle = primaryColor;
          if (isWordActive) {
            ctx.shadowColor = rgba(primaryColor, 0.6);
            ctx.shadowBlur = 20;
          }
          fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);
        }
      }

      // EFFECT 16: WRITE-ON OUTLINE FILL (outline-to-fill)
      else if (line.effect === 'write-on') {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope;
        const outlineW = Math.max(2, baseFontSize * 0.024);
        const halfW = item.width / 2 + 12;
        const fullH = baseFontSize * 1.3;

        if (wordElapsed < 0) {
          // Faint ghost outline waiting to be written
          ctx.strokeStyle = rgba(primaryColor, 0.18);
          ctx.lineWidth = outlineW;
          ctx.strokeText(item.word, 0, 0);
        } else {
          const traceDur = Math.min(420, wt.durationMs * 0.5);
          const fillDur = Math.min(380, wt.durationMs * 0.5);
          const traceP = easeOutCubic(clamp01(wordElapsed / traceDur));
          const fillP = easeOutCubic(clamp01((wordElapsed - traceDur * 0.6) / fillDur));

          // Phase A: contour drawn left → right
          ctx.save();
          ctx.beginPath();
          ctx.rect(-halfW, -fullH / 2, halfW * 2 * traceP, fullH);
          ctx.clip();
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = outlineW;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 14 * intensity;
          ctx.strokeText(item.word, 0, 0);
          ctx.restore();

          // Phase B: color floods bottom → top
          if (fillP > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(-halfW, fullH / 2 - fullH * fillP, halfW * 2, fullH * fillP);
            ctx.clip();
            ctx.fillStyle = isWordActive ? accentColor : primaryColor;
            if (isWordActive) {
              ctx.shadowColor = accentColor;
              ctx.shadowBlur = 24;
            }
            fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);
            ctx.restore();
          }
        }
      }

      // EFFECT 17: LIQUID WAVE (text-wave-distort per character)
      else if (line.effect === 'liquid') {
        const chars = Array.from(item.word);
        const offsets = charOffsets(ctx, item.word);
        const settle = isWordCompleted ? 0.12 : isWordActive ? 1 - wordProgress * 0.6 : 0.55;
        const A = baseFontSize * 0.16 * intensity * settle;
        const left = drawX - item.width / 2;
        ctx.textAlign = 'left';
        ctx.globalAlpha = lineEnvelope * (wordElapsed < 0 ? 0.45 : 1);
        if (isWordActive) {
          ctx.fillStyle = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 26;
        } else {
          ctx.fillStyle = primaryColor;
        }
        chars.forEach((ch, ci) => {
          const phase = timeMs * 0.006 + ci * 0.55 + item.wordIndex * 1.3;
          ctx.save();
          ctx.translate(left + offsets[ci], drawY + Math.sin(phase) * A);
          ctx.rotate(Math.cos(phase) * 0.09 * intensity * settle);
          fillWord(ctx, ch, 0, 0, strokeWidth, isWordActive ? primaryColor : accentColor);
          ctx.restore();
        });
      }

      // EFFECT 18: DOUBLE EXPOSURE (two offset screen-blended exposures converge on the word)
      else if (line.effect === 'double-exposure') {
        const spread = isWordCompleted ? 0 : isWordActive ? (1 - easeOutCubic(wordProgress)) * 0.45 : 1;
        const off = spread * 26 * Math.max(0.3, intensity);
        const breathe = 1 + 0.06 * spread * Math.sin(timeMs * 0.002 + item.wordIndex);
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.save();
        ctx.scale(breathe, breathe);
        ctx.fillStyle = rgba(accentColor, 0.8);
        ctx.fillText(item.word, -off, -off * 0.3);
        ctx.restore();
        ctx.fillStyle = 'rgba(34, 211, 238, 0.7)';
        ctx.fillText(item.word, off, off * 0.3);
        ctx.restore();
        // Resolve into the solid word as the exposures converge
        ctx.globalAlpha = lineEnvelope * (1 - spread);
        ctx.fillStyle = primaryColor;
        if (isWordActive) {
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 22;
        }
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);
      }

      // FALLBACK: clean fade (unknown / legacy effect ids never break the stage)
      else {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope * (wordElapsed < 0 ? 0.4 : 1);
        ctx.fillStyle = isWordActive ? accentColor : primaryColor;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor);
      }

      ctx.restore();
    });

    // 4. Draw CapCut 2D Transform Gizmo if this line is selected in LyricStudio
    if (selectedLineId && selectedLineId === line.id) {
      const boxX = posX - blockWidth / 2 - 36;
      const boxY = posY - blockHeight / 2 - 28;
      const boxW = blockWidth + 72;
      const boxH = blockHeight + 56;

      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Corner resize/transform handles
      const corners = [
        [boxX, boxY],
        [boxX + boxW, boxY],
        [boxX, boxY + boxH],
        [boxX + boxW, boxY + boxH],
      ];
      corners.forEach(([cx, cy]) => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }

    setLetterSpacing(ctx, 0);
    ctx.restore();
  });
}

export const LyricVisualizer: React.FC<LyricVisualizerProps> = ({
  currentTime,
  lyrics,
  isPlaying,
  bpm,
  background,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fontsTick, setFontsTick] = useState(0);

  // Re-render once every lyric webfont is available (avoids system-font fallback frames)
  useEffect(() => {
    let alive = true;
    ensureLyricFontsLoaded().then(() => {
      if (alive) setFontsTick((t) => t + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const timeMs = currentTime * 1000;
      renderLyricCanvasFrame(ctx, canvas.width, canvas.height, timeMs, lyrics, {
        bpm,
        background,
      });

      if (isPlaying) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [currentTime, lyrics, isPlaying, bpm, background, fontsTick]);

  const isTransparent = background?.type === 'transparent';

  return (
    <div
      className={`w-full h-full flex items-center justify-center relative overflow-hidden ${
        isTransparent ? 'bg-transparent' : 'bg-[#050608]'
      }`}
    >
      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        className="w-full h-full object-contain shadow-2xl"
      />
    </div>
  );
};
