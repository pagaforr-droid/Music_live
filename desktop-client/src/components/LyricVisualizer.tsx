import React, { useEffect, useRef, useState } from 'react';
import {
  LyricLine,
  LyricFontFamily,
  LyricWordTiming,
  LyricWordRole,
  LyricLayoutMode,
  LyricTextTexture,
  LyricCameraMotion,
  LyricBackgroundConfig,
  SongRhythmState,
  computeWordTimings,
  assignAutoWordHierarchy,
  computeSongRhythmState,
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
  waveformPeaks?: number[];
  totalDurationMs?: number;
}

export interface RenderLyricFrameOptions {
  showSafeZones?: boolean;
  selectedLineId?: string | null;
  snapGuideX?: boolean;
  snapGuideY?: boolean;
  bpm?: number;
  firstBeatOffset?: number;
  beatTimes?: number[];
  waveformPeaks?: number[];
  totalDurationMs?: number;
  background?: LyricBackgroundConfig;
  backgroundImageElement?: HTMLImageElement | null;
  songTitle?: string;
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
function easeOutBack(x: number, overshoot = 1.70158): number {
  const c1 = overshoot;
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

/** GSAP expo.in — decisive acceleration exit. */
function easeInExpo(x: number): number {
  return x <= 0 ? 0 : Math.pow(2, 10 * x - 10);
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

function getLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ════════════════════════════════════════════════════════════════════════════
//  TEXT & GLYPH TEXTURE HELPERS
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
  strokeColor: string,
  texture: LyricTextTexture = 'solid',
  fontSize: number = 108,
  wordWidth: number = 220,
  seed: number = 1
) {
  if (texture === 'stroke-hollow') {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(3, (strokeWidth || 2.5) * 1.8);
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.strokeText(text, x, y);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = strokeColor || '#ffffff';
    ctx.strokeText(text, x + 2, y + 2);
    ctx.restore();
    return;
  }

  if (strokeWidth > 0) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = strokeWidth * 2;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(text, x, y);
    ctx.restore();
  }

  if (texture === 'metallic-bevel') {
    ctx.save();
    const baseHex = typeof ctx.fillStyle === 'string' && ctx.fillStyle.startsWith('#') ? ctx.fillStyle : '#ffffff';
    const h = fontSize * 0.55;
    const grad = ctx.createLinearGradient(x, y - h, x, y + h);
    grad.addColorStop(0, shade(baseHex, 0.75));
    grad.addColorStop(0.44, baseHex);
    grad.addColorStop(0.52, shade(baseHex, -0.45));
    grad.addColorStop(0.62, baseHex);
    grad.addColorStop(1, shade(baseHex, 0.65));
    ctx.fillStyle = grad;
    ctx.fillText(text, x, y);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.strokeText(text, x, y - 1);
    ctx.restore();
    return;
  }

  ctx.fillText(text, x, y);

  // Procedural deterministic internal textures (Grunge Distress & Halftone Ben-Day Dots)
  if (texture === 'grunge-distress') {
    ctx.save();
    const w = Math.max(80, wordWidth);
    const h = fontSize * 0.92;
    // Draw distressed scratch lines and carbon speckles inside the bounding box of the word
    ctx.strokeStyle = 'rgba(12, 12, 14, 0.36)';
    ctx.fillStyle = 'rgba(12, 12, 14, 0.34)';
    const scratches = 7;
    for (let s = 0; s < scratches; s++) {
      const sx = x - w * 0.46 + hash01(seed + s * 17) * w * 0.92;
      const sy = y - h * 0.42 + hash01(seed + s * 31) * h * 0.84;
      const len = 14 + hash01(seed + s * 43) * (fontSize * 0.34);
      const ang = (hash01(seed + s * 59) - 0.5) * 1.4;
      ctx.lineWidth = 1.4 + hash01(seed + s * 71) * 2.2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
      ctx.stroke();

      // Tiny carbon pinhole dot
      const dx = x - w * 0.42 + hash01(seed + s * 89) * w * 0.84;
      const dy = y - h * 0.36 + hash01(seed + s * 101) * h * 0.72;
      ctx.beginPath();
      ctx.arc(dx, dy, 1.5 + hash01(seed + s * 113) * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (texture === 'halftone-dots') {
    ctx.save();
    // Draw a subtle offset dot-screen outline accent over the glyphs (Pop-Art Ben-Day feel)
    ctx.lineWidth = Math.max(1.5, fontSize * 0.018);
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = strokeColor || 'rgba(0,0,0,0.45)';
    ctx.strokeText(text, x + 2.5, y + 2.5);
    ctx.restore();
  }
}

/** Draws a high-contrast stamped badge pill (like Fiverr `HEAD [IS] SPINNIN'`). */
function drawBadgeWord(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  wordWidth: number,
  badgeBgColor: string,
  rotationRad: number = -0.04
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotationRad);

  const padX = Math.max(14, fontSize * 0.28);
  const padY = Math.max(8, fontSize * 0.16);
  const boxW = wordWidth + padX * 2;
  const boxH = fontSize * 0.96 + padY * 2;

  // Hard brutalist offset shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.fillRect(-boxW / 2 + 5, -boxH / 2 + 6, boxW, boxH);

  // High-contrast badge plate
  ctx.fillStyle = badgeBgColor;
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);

  // Dark inner keyline border
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = getLuminance(badgeBgColor) > 135 ? '#09090b' : '#ffffff';
  ctx.strokeRect(-boxW / 2 + 3, -boxH / 2 + 3, boxW - 6, boxH - 6);

  // Contrast-locked text inside badge (WCAG AAA)
  ctx.fillStyle = getLuminance(badgeBgColor) > 135 ? '#09090b' : '#ffffff';
  ctx.shadowBlur = 0;
  ctx.fillText(text, 0, 1);
  ctx.restore();
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

export interface WrappedWordItem {
  word: string;
  wordIndex: number;
  role: LyricWordRole;
  fontSize: number;
  fontFamily: LyricFontFamily;
  width: number;
  centerX: number; // Offset from line block center X
  centerY: number; // Offset from line block center Y
  rowIndex: number;
  totalRows: number;
  columnSide?: 'left-anchor' | 'right-slot' | 'center';
}

/**
 * Resolves the effective scale multiplier and font family for a word based on its typographic role
 * and the active layout mode.
 */
function resolveWordTypography(
  role: LyricWordRole,
  customScale: number | undefined,
  baseFontSize: number,
  primaryFont: LyricFontFamily,
  secondaryFont: LyricFontFamily | undefined,
  layoutMode: LyricLayoutMode,
  totalWords: number
): { fontSize: number; fontFamily: LyricFontFamily } {
  const fallbackSecondary: LyricFontFamily =
    secondaryFont ||
    (getFontPreset(primaryFont).category === 'luxury' ? 'Kaushan Script' : 'Playfair Display');

  if (customScale !== undefined && customScale > 0) {
    return {
      fontSize: Math.round(baseFontSize * customScale),
      fontFamily: role === 'accent-script' ? fallbackSecondary : primaryFont,
    };
  }

  const densityDamp = totalWords >= 7 ? 0.85 : totalWords >= 5 ? 0.92 : 1.0;

  if (role === 'hero') {
    const mult =
      layoutMode === 'corner-frame'
        ? 2.15 * densityDamp
        : layoutMode === 'editorial-cascade' || layoutMode === 'poster-stack'
        ? 1.58 * densityDamp
        : 1.38 * densityDamp;
    return {
      fontSize: Math.round(baseFontSize * Math.max(1.15, mult)),
      fontFamily: primaryFont,
    };
  }
  if (role === 'accent-script') {
    return {
      fontSize: Math.round(baseFontSize * 1.42 * densityDamp),
      fontFamily: fallbackSecondary,
    };
  }
  if (role === 'badge') {
    return {
      fontSize: Math.round(baseFontSize * 0.56),
      fontFamily: primaryFont,
    };
  }
  if (role === 'whisper') {
    return {
      fontSize: Math.round(baseFontSize * 0.66),
      fontFamily: primaryFont,
    };
  }
  return {
    fontSize: Math.round(baseFontSize),
    fontFamily: primaryFont,
  };
}

/**
 * Multi-Scale Typographic Lockup Engine:
 * Supports 'smart-wrap', 'poster-stack', 'split-anchor', 'editorial-cascade', and 'corner-frame'.
 */
export function layoutWordsMultiLine(
  ctx: CanvasRenderingContext2D,
  words: string[],
  maxLineWidth: number,
  wordSpacing: number,
  lineHeight: number,
  options?: {
    wordTimings?: LyricWordTiming[];
    baseFontSize?: number;
    primaryFont?: LyricFontFamily;
    secondaryFont?: LyricFontFamily;
    layoutMode?: LyricLayoutMode;
    trackingEm?: number;
    autoHierarchy?: boolean;
  }
): { items: WrappedWordItem[]; blockWidth: number; blockHeight: number } {
  const baseFontSize = options?.baseFontSize || Math.round(lineHeight / 1.18) || 108;
  const primaryFont = options?.primaryFont || 'Montserrat';
  const secondaryFont = options?.secondaryFont;
  const layoutMode: LyricLayoutMode = options?.layoutMode || 'smart-wrap';
  const trackingEm = options?.trackingEm ?? 0;
  const useHierarchy = options?.autoHierarchy !== false;
  const timings = options?.wordTimings || [];

  // Measure each word at its role-adjusted font size & font family
  const measuredWords = words.map((word, idx) => {
    const wt = timings[idx];
    const role: LyricWordRole = useHierarchy ? wt?.role || 'normal' : 'normal';
    const { fontSize, fontFamily } = resolveWordTypography(
      role,
      wt?.customScale,
      baseFontSize,
      primaryFont,
      secondaryFont,
      layoutMode,
      words.length
    );
    ctx.save();
    ctx.font = buildFontString(fontFamily, fontSize);
    setLetterSpacing(ctx, trackingEm * fontSize);
    const width = Math.max(24, ctx.measureText(word).width + (role === 'badge' ? fontSize * 0.55 : 0));
    ctx.restore();
    return { word, wordIndex: idx, role, fontSize, fontFamily, width };
  });

  // ── MODE 1: SPLIT-ANCHOR (HyperFrames `split-anchor-word-slot` — Left Anchor Column + Right Tapes) ──
  if (layoutMode === 'split-anchor' && measuredWords.length >= 2) {
    const splitIdx = Math.max(1, Math.floor(measuredWords.length / 2));
    const leftCol = measuredWords.slice(0, splitIdx);
    const rightCol = measuredWords.slice(splitIdx);

    const colFontSize = Math.round(baseFontSize * (measuredWords.length > 5 ? 0.88 : 1.0));
    const rowH = Math.round(colFontSize * 1.04);

    let leftMaxW = 0;
    const leftMeasured = leftCol.map((w) => {
      ctx.save();
      ctx.font = buildFontString(primaryFont, colFontSize);
      setLetterSpacing(ctx, trackingEm * colFontSize);
      const mw = ctx.measureText(w.word).width * 1.12;
      ctx.restore();
      if (mw > leftMaxW) leftMaxW = mw;
      return { ...w, fontSize: colFontSize, fontFamily: primaryFont, width: mw };
    });

    let rightMaxW = 0;
    const rightMeasured = rightCol.map((w) => {
      ctx.save();
      ctx.font = buildFontString(primaryFont, colFontSize);
      setLetterSpacing(ctx, trackingEm * colFontSize);
      const mw = ctx.measureText(w.word).width * 1.12 + colFontSize * 0.45;
      ctx.restore();
      if (mw > rightMaxW) rightMaxW = mw;
      return { ...w, fontSize: colFontSize, fontFamily: primaryFont, width: mw };
    });

    const gapX = Math.round(colFontSize * 0.28);
    const totalW = leftMaxW + gapX + rightMaxW;
    const maxRows = Math.max(leftMeasured.length, rightMeasured.length);
    const totalH = maxRows * rowH;
    const leftEdge = -totalW / 2;
    const rightStart = leftEdge + leftMaxW + gapX;

    const items: WrappedWordItem[] = [];

    leftMeasured.forEach((w, rIdx) => {
      const cy = (rIdx - (leftMeasured.length - 1) / 2) * rowH;
      items.push({
        word: w.word,
        wordIndex: w.wordIndex,
        role: w.role,
        fontSize: w.fontSize,
        fontFamily: w.fontFamily,
        width: w.width,
        centerX: leftEdge + w.width / 2,
        centerY: cy,
        rowIndex: rIdx,
        totalRows: maxRows,
        columnSide: 'left-anchor',
      });
    });

    rightMeasured.forEach((w, rIdx) => {
      const stairOffset = [0, 18, 8, 26][rIdx % 4];
      const cy = (rIdx - (rightMeasured.length - 1) / 2) * rowH;
      items.push({
        word: w.word,
        wordIndex: w.wordIndex,
        role: w.role === 'normal' ? 'badge' : w.role,
        fontSize: w.fontSize,
        fontFamily: w.fontFamily,
        width: w.width,
        centerX: rightStart + stairOffset + w.width / 2,
        centerY: cy,
        rowIndex: rIdx,
        totalRows: maxRows,
        columnSide: 'right-slot',
      });
    });

    return { items, blockWidth: totalW + 32, blockHeight: totalH + 24 };
  }

  // ── MODE 2: POSTER-STACK (Fiverr `BOBBY / AND BIG / APOCALYPSE` — tight multi-scale rows) ──
  if (layoutMode === 'poster-stack') {
    // Group into 2 or 3 tight poster rows: Hero words get their own row, short connectors group together
    const rawRows: typeof measuredWords[] = [];
    let buf: typeof measuredWords = [];
    measuredWords.forEach((w) => {
      if (w.role === 'hero' || w.role === 'accent-script') {
        if (buf.length > 0) {
          rawRows.push(buf);
          buf = [];
        }
        rawRows.push([w]);
      } else {
        buf.push(w);
        if (buf.length >= 2) {
          rawRows.push(buf);
          buf = [];
        }
      }
    });
    if (buf.length > 0) rawRows.push(buf);

    // Cap at 3 rows max by merging smallest adjacent rows if needed
    while (rawRows.length > 3) {
      const merged = [...rawRows[0], ...rawRows[1]];
      rawRows.splice(0, 2, merged);
    }

    // Target poster block width so rows scale proportionally to form a solid graphic rectangle
    const targetPosterW = Math.min(maxLineWidth * 0.88, Math.max(baseFontSize * 4.4, 760));
    const items: WrappedWordItem[] = [];
    const rowMetrics: {
      words: typeof measuredWords;
      scaledWidths: number[];
      rowFontSize: number;
      rowW: number;
      rowH: number;
    }[] = [];

    rawRows.forEach((row) => {
      const isHeroRow = row.some((w) => w.role === 'hero' || w.role === 'accent-script');
      const baseRowW = row.reduce((acc, w) => acc + w.width, 0) + Math.max(0, row.length - 1) * wordSpacing;
      const desiredW = isHeroRow ? targetPosterW : targetPosterW * 0.84;
      const scaleFactor = Math.max(0.62, Math.min(1.85, desiredW / Math.max(60, baseRowW)));
      const rowFontSize = Math.round(row[0].fontSize * scaleFactor);

      const scaledWidths = row.map((w) => {
        ctx.save();
        ctx.font = buildFontString(w.fontFamily, rowFontSize);
        setLetterSpacing(ctx, trackingEm * rowFontSize);
        const sw = Math.max(24, ctx.measureText(w.word).width + (w.role === 'badge' ? rowFontSize * 0.5 : 0));
        ctx.restore();
        return sw;
      });
      const gap = Math.round(rowFontSize * 0.28);
      const rowW = scaledWidths.reduce((a, b) => a + b, 0) + Math.max(0, row.length - 1) * gap;
      const rowH = Math.round(rowFontSize * 0.94);
      rowMetrics.push({ words: row, scaledWidths, rowFontSize, rowW, rowH });
    });

    const totalH = rowMetrics.reduce((acc, r) => acc + r.rowH, 0);
    let maxW = 0;
    let cursorY = -totalH / 2;

    rowMetrics.forEach((rm, rIdx) => {
      if (rm.rowW > maxW) maxW = rm.rowW;
      const cy = cursorY + rm.rowH / 2;
      const gap = Math.round(rm.rowFontSize * 0.28);
      let cursorX = -rm.rowW / 2;

      rm.words.forEach((w, wIdx) => {
        const sw = rm.scaledWidths[wIdx];
        items.push({
          word: w.word,
          wordIndex: w.wordIndex,
          role: w.role,
          fontSize: rm.rowFontSize,
          fontFamily: w.fontFamily,
          width: sw,
          centerX: cursorX + sw / 2,
          centerY: cy,
          rowIndex: rIdx,
          totalRows: rowMetrics.length,
          columnSide: 'center',
        });
        cursorX += sw + gap;
      });

      cursorY += rm.rowH;
    });

    return { items, blockWidth: maxW, blockHeight: totalH };
  }

  // ── MODE 3: EDITORIAL-CASCADE (HyperFrames `intro-kinetic-cascade` — Stair-stepped left-to-right lines) ──
  if (layoutMode === 'editorial-cascade' && measuredWords.length >= 2) {
    const rawRows: typeof measuredWords[] = [];
    let buf: typeof measuredWords = [];
    measuredWords.forEach((w) => {
      if (w.role === 'hero' || w.role === 'accent-script') {
        if (buf.length > 0) {
          rawRows.push(buf);
          buf = [];
        }
        rawRows.push([w]);
      } else {
        buf.push(w);
        if (buf.length >= 2) {
          rawRows.push(buf);
          buf = [];
        }
      }
    });
    if (buf.length > 0) rawRows.push(buf);

    const rowHeights = rawRows.map((r) => Math.round(Math.max(...r.map((w) => w.fontSize)) * 0.98));
    const totalH = rowHeights.reduce((a, b) => a + b, 0);
    let cursorY = -totalH / 2;
    let maxW = 0;
    const items: WrappedWordItem[] = [];

    rawRows.forEach((row, rIdx) => {
      const rh = rowHeights[rIdx];
      const cy = cursorY + rh / 2;
      const gap = Math.round(baseFontSize * 0.3);
      const rowW = row.reduce((acc, w) => acc + w.width, 0) + Math.max(0, row.length - 1) * gap;
      // Progressive editorial indent (-140px, 0px, +140px)
      const indentOffset =
        rawRows.length === 1 ? 0 : (rIdx - (rawRows.length - 1) / 2) * Math.min(130, baseFontSize * 1.05);
      if (rowW + Math.abs(indentOffset) * 2 > maxW) maxW = rowW + Math.abs(indentOffset) * 2;

      let cursorX = -rowW / 2 + indentOffset;
      row.forEach((w) => {
        items.push({
          word: w.word,
          wordIndex: w.wordIndex,
          role: w.role,
          fontSize: w.fontSize,
          fontFamily: w.fontFamily,
          width: w.width,
          centerX: cursorX + w.width / 2,
          centerY: cy,
          rowIndex: rIdx,
          totalRows: rawRows.length,
          columnSide: 'center',
        });
        cursorX += w.width + gap;
      });
      cursorY += rh;
    });

    return { items, blockWidth: maxW, blockHeight: totalH };
  }

  // ── MODE 4 & DEFAULT: SMART-WRAP & CORNER-FRAME ──
  const rows: {
    words: typeof measuredWords;
    totalWidth: number;
    rowHeight: number;
  }[] = [];
  let currentRow: typeof measuredWords = [];
  let currentRowWidth = 0;
  let currentRowMaxFont = baseFontSize;

  measuredWords.forEach((w) => {
    const projectedWidth = currentRow.length === 0 ? w.width : currentRowWidth + wordSpacing + w.width;
    if (currentRow.length > 0 && projectedWidth > maxLineWidth) {
      rows.push({
        words: currentRow,
        totalWidth: currentRowWidth,
        rowHeight: Math.round(currentRowMaxFont * 1.12),
      });
      currentRow = [w];
      currentRowWidth = w.width;
      currentRowMaxFont = w.fontSize;
    } else {
      currentRow.push(w);
      currentRowWidth = projectedWidth;
      if (w.fontSize > currentRowMaxFont) currentRowMaxFont = w.fontSize;
    }
  });

  if (currentRow.length > 0) {
    rows.push({
      words: currentRow,
      totalWidth: currentRowWidth,
      rowHeight: Math.round(currentRowMaxFont * 1.12),
    });
  }

  const totalRows = rows.length;
  const blockHeight = rows.reduce((acc, r) => acc + r.rowHeight, 0);
  let maxRowWidth = 0;
  const items: WrappedWordItem[] = [];
  let cursorY = -blockHeight / 2;

  rows.forEach((row, rowIdx) => {
    if (row.totalWidth > maxRowWidth) maxRowWidth = row.totalWidth;
    const rowY = cursorY + row.rowHeight / 2;
    let cursorX = -row.totalWidth / 2;

    row.words.forEach((w) => {
      items.push({
        word: w.word,
        wordIndex: w.wordIndex,
        role: w.role,
        fontSize: w.fontSize,
        fontFamily: w.fontFamily,
        width: w.width,
        centerX: cursorX + w.width / 2,
        centerY: rowY,
        rowIndex: rowIdx,
        totalRows,
        columnSide: 'center',
      });
      cursorX += w.width + wordSpacing;
    });

    cursorY += row.rowHeight;
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
 * 2.5D Virtual Camera Transform (Build / Breathe / Resolve + Rhythm-Guided Beat Punch).
 * Pure function of `(progress, rhythm, cameraMotion, intensity, seed)`.
 */
function computeVirtualCameraPose(
  progress: number,
  rhythm: SongRhythmState,
  cameraMotion: LyricCameraMotion,
  intensity: number,
  seed: number
): { tx: number; ty: number; scale: number; rotRad: number; motionEchoAlpha: number } {
  if (cameraMotion === 'static') {
    return { tx: 0, ty: 0, scale: 1, rotRad: 0, motionEchoAlpha: 0 };
  }

  const react = Math.max(0.4, intensity);

  if (cameraMotion === 'cinema-drift') {
    // 3-phase HyperFrames motion structure: Build (0..0.22) -> Breathe (0.22..0.82) -> Resolve (0.82..1)
    let baseScale = 1.0;
    let ty = 0;
    if (progress < 0.22) {
      const p = easeOutCubic(progress / 0.22);
      baseScale = 0.93 + 0.07 * p;
      ty = (1 - p) * 24 * react;
    } else if (progress <= 0.82) {
      const breatheP = (progress - 0.22) / 0.6;
      baseScale = 1.0 + breatheP * 0.055 * react + rhythm.audioEnergy * 0.025;
      ty = Math.sin(breatheP * Math.PI * 2) * 8 * react;
    } else {
      const outP = easeInCubic((progress - 0.82) / 0.18);
      baseScale = 1.055 * react + outP * 0.08 * react;
      ty = -outP * 18 * react;
    }
    const tx = Math.cos(progress * Math.PI * 1.5 + seed) * 12 * react;
    const rotRad = Math.sin(progress * Math.PI * 2 + (seed % 7)) * 0.012 * react;
    return { tx, ty, scale: baseScale, rotRad, motionEchoAlpha: 0 };
  }

  if (cameraMotion === 'beat-punch') {
    // Guided directly by the song's Downbeat, Beat Impulse, and Audio Energy!
    const punch =
      rhythm.beatImpulse * 0.045 * react +
      rhythm.downbeatImpulse * 0.065 * react +
      rhythm.audioEnergy * 0.025 * react;
    const dir = rhythm.beatIndex % 2 === 0 ? 1 : -1;
    const rotRad = dir * rhythm.beatImpulse * 0.022 * react;
    const tx = (hash01(rhythm.beatIndex * 19 + seed) * 2 - 1) * 14 * rhythm.downbeatImpulse * react;
    const ty = -rhythm.beatImpulse * 10 * react;
    return {
      tx,
      ty,
      scale: 1 + punch,
      rotRad,
      motionEchoAlpha: rhythm.downbeatImpulse * 0.25,
    };
  }

  if (cameraMotion === 'whip-handoff') {
    const dir = seed % 2 === 0 ? 1 : -1;
    let tx = 0;
    let scale = 1 + rhythm.beatImpulse * 0.03 * react;
    let rotRad = 0;
    let echo = 0;

    if (progress < 0.16) {
      const p = easeOutExpo(progress / 0.16);
      tx = (1 - p) * 520 * dir * react;
      rotRad = (1 - p) * -0.08 * dir * react;
      echo = (1 - p) * 0.45;
    } else if (progress > 0.86) {
      const p = easeInExpo((progress - 0.86) / 0.14);
      tx = -p * 520 * dir * react;
      rotRad = p * 0.08 * dir * react;
      echo = p * 0.45;
    }
    return { tx, ty: 0, scale, rotRad, motionEchoAlpha: echo };
  }

  return { tx: 0, ty: 0, scale: 1, rotRad: 0, motionEchoAlpha: 0 };
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
  const {
    showSafeZones,
    selectedLineId,
    snapGuideX,
    snapGuideY,
    bpm = 120,
    firstBeatOffset = 0,
    beatTimes,
    waveformPeaks,
    totalDurationMs = 180000,
    onUpdateBoundingBox,
  } = options;

  const bgConfig = options.background || { type: 'obsidian-red', pulseWithBpm: true };
  const bgType = bgConfig.type || 'obsidian-red';
  const pulseEnabled = bgConfig.pulseWithBpm !== false;
  const reactivity = pulseEnabled ? bgConfig.rhythmReactivity ?? 1.0 : 0;

  // 0. Compute Real-Time Song Rhythm State (Beat, Downbeat, 16th Subdivisions & Waveform Energy)
  const rhythm = computeSongRhythmState(
    timeMs,
    bpm,
    firstBeatOffset,
    beatTimes,
    waveformPeaks,
    totalDurationMs,
    reactivity
  );
  const beatPeriodMs = rhythm.beatPeriodMs;
  const beatPulse = pulseEnabled ? rhythm.beatPulse : 0;

  // 1. Customizable Art-Directed Stage Background
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

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
    const baseHex = bgConfig.customColor || '#050608';
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, canvasW, canvasH);
    if (pulseEnabled && rhythm.beatImpulse > 0.05) {
      const pulseGrad = ctx.createRadialGradient(
        canvasW * 0.5,
        canvasH * 0.5,
        20,
        canvasW * 0.5,
        canvasH * 0.5,
        canvasW * 0.65
      );
      pulseGrad.addColorStop(0, `rgba(255,255,255,${0.08 * rhythm.beatImpulse})`);
      pulseGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pulseGrad;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
  } else if (bgType === 'crimson-grunge-poster') {
    // FIVERR SLIDE 1: Saturated Crimson Red + Tonal Split Panels + Grunge Texture
    const flashLift = rhythm.downbeatImpulse * 0.08;
    ctx.fillStyle = shade('#d91218', flashLift);
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Quadrant tonal split blocks (like Fiverr Slide 1 & 3)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, 0, canvasW * 0.48, canvasH * 0.58);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(canvasW * 0.48, canvasH * 0.36, canvasW * 0.52, canvasH * 0.42);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(canvasW * 0.64, canvasH * 0.54, canvasW * 0.36, canvasH * 0.46);

    // Procedural grunge paper scratches & ink distress
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    for (let i = 0; i < 42; i++) {
      const gx = hash01(i * 37.1) * canvasW;
      const gy = hash01(i * 73.7) * canvasH;
      const glen = 40 + hash01(i * 19.3) * 180;
      const gang = (hash01(i * 53.9) - 0.5) * 0.7;
      ctx.lineWidth = 1 + hash01(i * 11.7) * 2.5;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + Math.cos(gang) * glen, gy + Math.sin(gang) * glen);
      ctx.stroke();
    }
  } else if (bgType === 'emerald-split-denim') {
    // FIVERR SLIDE 3 (`KNOCK KNOCK`): Emerald/Teal Tonal Split Panels + Denim/Paper Scratch Grain
    const lift = rhythm.beatImpulse * 0.06;
    ctx.fillStyle = shade('#009c72', lift);
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Split tonal panels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(0, 0, canvasW * 0.48, canvasH * 0.62);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.11)';
    ctx.fillRect(canvasW * 0.68, canvasH * 0.44, canvasW * 0.32, canvasH * 0.56);

    // Diagonal denim/canvas weave hatch lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.065)';
    ctx.lineWidth = 1.2;
    for (let d = -canvasH; d < canvasW + canvasH; d += 26) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d - canvasH * 0.7, canvasH);
      ctx.stroke();
    }
    // Distressed light paper scuffs
    ctx.strokeStyle = 'rgba(255, 250, 220, 0.12)';
    for (let s = 0; s < 32; s++) {
      const sx = hash01(s * 41.3) * canvasW;
      const sy = hash01(s * 83.1) * canvasH;
      const slen = 60 + hash01(s * 29.7) * 220;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + slen, sy - slen * 0.18);
      ctx.stroke();
    }
  } else if (bgType === 'swiss-blueprint-grid') {
    // LEMO-OPUSCAR SWISS MOTION: 12-Column Grid + Registration Crosshairs + Beat Pulse
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const glow = ctx.createRadialGradient(
      canvasW * 0.5,
      canvasH * 0.5,
      40,
      canvasW * 0.5,
      canvasH * 0.5,
      canvasW * 0.65
    );
    glow.addColorStop(0, `rgba(30, 64, 175, ${0.18 + rhythm.beatImpulse * 0.12})`);
    glow.addColorStop(1, 'rgba(7, 10, 16, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvasW, canvasH);

    const marginX = 96;
    const usableW = canvasW - marginX * 2;
    const cols = 12;
    const colW = usableW / cols;

    ctx.strokeStyle = `rgba(255, 255, 255, ${0.055 + rhythm.downbeatImpulse * 0.04})`;
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      const x = Math.round(marginX + c * colW);
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.lineTo(x, canvasH - 64);
      ctx.stroke();
    }
    for (let r = 1; r <= 5; r++) {
      const y = Math.round((canvasH / 6) * r);
      ctx.beginPath();
      ctx.moveTo(marginX, y);
      ctx.lineTo(canvasW - marginX, y);
      ctx.stroke();
    }

    // Precision registration crosshairs (+)
    ctx.strokeStyle = `rgba(239, 68, 68, ${0.35 + rhythm.beatImpulse * 0.45})`;
    ctx.lineWidth = 1.5;
    for (let c = 0; c <= cols; c += 3) {
      for (let r = 1; r <= 5; r += 2) {
        const cx = Math.round(marginX + c * colW);
        const cy = Math.round((canvasH / 6) * r);
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy);
        ctx.lineTo(cx + 7, cy);
        ctx.moveTo(cx, cy - 7);
        ctx.lineTo(cx, cy + 7);
        ctx.stroke();
      }
    }
  } else if (bgType === 'vintage-paper-ink') {
    // LEMO-OPUSCAR RISOGRAPH PAPER STOCK (#F4EEE2)
    ctx.fillStyle = '#f4eee2';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Subtle warm paper mottle & fibers
    const paperGrad = ctx.createRadialGradient(
      canvasW * 0.5,
      canvasH * 0.5,
      100,
      canvasW * 0.5,
      canvasH * 0.5,
      canvasW * 0.72
    );
    paperGrad.addColorStop(0, 'rgba(255, 252, 245, 0.4)');
    paperGrad.addColorStop(1, 'rgba(214, 201, 178, 0.55)');
    ctx.fillStyle = paperGrad;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Double ink registration frame border
    const kickX = rhythm.downbeatImpulse * 4;
    ctx.strokeStyle = 'rgba(20, 20, 20, 0.22)';
    ctx.lineWidth = 3;
    ctx.strokeRect(42, 42, canvasW - 84, canvasH - 84);
    ctx.strokeStyle = 'rgba(228, 35, 43, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(42 + kickX, 42 + kickX, canvasW - 84, canvasH - 84);
  } else if (bgType === 'album-card-stage') {
    // FIVERR SLIDE 5 (`Real Love`): Blurred Backdrop + Framed Floating Album Art Card on Left
    if (options.backgroundImageElement) {
      const img = options.backgroundImageElement;
      const scale = Math.max(canvasW / img.width, canvasH / img.height) * 1.12;
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.save();
      ctx.filter = 'blur(26px)';
      ctx.drawImage(img, (canvasW - w) / 2, (canvasH - h) / 2, w, h);
      ctx.restore();
      ctx.fillStyle = 'rgba(10, 8, 16, 0.52)';
      ctx.fillRect(0, 0, canvasW, canvasH);
    } else {
      const bgGrad = ctx.createLinearGradient(0, 0, canvasW, canvasH);
      bgGrad.addColorStop(0, '#1e1028');
      bgGrad.addColorStop(0.5, '#3b1238');
      bgGrad.addColorStop(1, '#0c0814');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvasW, canvasH);

      const roseGlow = ctx.createRadialGradient(
        canvasW * 0.65,
        canvasH * 0.5,
        20,
        canvasW * 0.65,
        canvasH * 0.5,
        canvasW * 0.55
      );
      roseGlow.addColorStop(0, `rgba(244, 63, 94, ${0.22 + rhythm.beatImpulse * 0.08})`);
      roseGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = roseGlow;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    // Draw the Floating Double-Bezel Album Card on the Left Side (x: 340, y: 540)
    ctx.save();
    const cardCX = 350;
    const cardCY = 540 + Math.sin(timeMs * 0.002) * 8;
    const cardW = 420;
    const cardH = 540;
    const cardScale = 1 + rhythm.beatImpulse * 0.025;
    ctx.translate(cardCX, cardCY);
    ctx.rotate(-0.038 + rhythm.downbeatImpulse * 0.012);
    ctx.scale(cardScale, cardScale);

    // Outer glass shell (Double-Bezel)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 45;
    ctx.shadowOffsetY = 20;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.roundRect(-cardW / 2 - 12, -cardH / 2 - 12, cardW + 24, cardH + 24, 28);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner core frame
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 18);
    ctx.clip();

    if (options.backgroundImageElement) {
      const img = options.backgroundImageElement;
      const s = Math.max(cardW / img.width, cardH / img.height);
      ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
    } else {
      // Stylized Vinyl / Rose Gold Album Cover Artwork
      const artGrad = ctx.createLinearGradient(-cardW / 2, -cardH / 2, cardW / 2, cardH / 2);
      artGrad.addColorStop(0, '#be123c');
      artGrad.addColorStop(0.5, '#4c0519');
      artGrad.addColorStop(1, '#09090b');
      ctx.fillStyle = artGrad;
      ctx.fillRect(-cardW / 2, -cardH / 2, cardW, cardH);

      // Rotating vinyl disc inside the card
      ctx.save();
      ctx.translate(0, -30);
      ctx.rotate(timeMs * 0.0008);
      for (let r = 140; r >= 40; r -= 16) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = r === 140 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = r === 140 ? 3 : 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0, Math.PI * 2);
      ctx.fillStyle = '#f43f5e';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#09090b';
      ctx.fill();
      ctx.restore();

      // Album typography footer inside the card
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '900 26px "Montserrat", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((options.songTitle || 'TANDU STAGE').toUpperCase().slice(0, 18), 0, cardH / 2 - 64);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '600 14px "Space Mono", monospace';
      ctx.fillText(`OFFICIAL LYRIC VIDEO · ${rhythm.bpm} BPM`, 0, cardH / 2 - 34);
    }
    ctx.restore();
    ctx.restore();
  } else if (bgType === 'custom-image' && options.backgroundImageElement) {
    const img = options.backgroundImageElement;
    const kenBurns = 1 + (pulseEnabled ? Math.sin(timeMs * 0.0004) * 0.03 + rhythm.beatImpulse * 0.015 : 0);
    const scale = Math.max(canvasW / img.width, canvasH / img.height) * kenBurns;
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

    const dynamicPulse = beatPulse * 0.06 + rhythm.audioEnergy * 0.08 + rhythm.downbeatImpulse * 0.06;
    const centerGrad = ctx.createRadialGradient(
      canvasW * 0.5,
      canvasH * 0.52,
      10,
      canvasW * 0.5,
      canvasH * 0.52,
      canvasW * (0.66 + rhythm.beatImpulse * 0.06)
    );
    centerGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.12 + dynamicPulse})`);
    centerGrad.addColorStop(
      0.45,
      `rgba(${Math.round(r * 0.15)}, ${Math.round(g * 0.15)}, ${Math.round(b * 0.15)}, ${
        0.22 + dynamicPulse * 0.7
      })`
    );
    centerGrad.addColorStop(1, baseColor);
    ctx.fillStyle = centerGrad;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Subtle LED Stage Horizon Line reactive to beat
    const horizonGrad = ctx.createLinearGradient(0, 0, canvasW, 0);
    horizonGrad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    horizonGrad.addColorStop(0.5, `rgba(${r},${g},${b},${0.14 + dynamicPulse * 1.4})`);
    horizonGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = horizonGrad;
    ctx.fillRect(0, canvasH - 6, canvasW, 6);
  }

  // 1.5. Stage Atmospheric Bokeh / Particles (Deterministic 60fps, Rhythm-Accelerated)
  if (bgConfig.particles && bgType !== 'transparent') {
    ctx.save();
    const particleCount = 32;
    for (let p = 0; p < particleCount; p++) {
      const seed = p * 197.33;
      const speed = 0.00015 + hash01(seed) * 0.00015;
      const px = ((hash01(seed + 1) + timeMs * speed * 0.3) % 1) * canvasW;
      const rawY = (hash01(seed + 2) - timeMs * speed) % 1;
      const py = (rawY < 0 ? rawY + 1 : rawY) * canvasH;
      const radius = (3 + hash01(seed + 3) * 9) * (1 + rhythm.beatImpulse * 0.25);
      const alpha = (0.08 + hash01(seed + 4) * 0.15) * (1 + rhythm.audioEnergy * 0.45);

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
    ctx.strokeStyle = bgType === 'vintage-paper-ink' ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    const marginX = canvasW * 0.08;
    const marginY = canvasH * 0.08;
    ctx.strokeRect(marginX, marginY, canvasW - marginX * 2, canvasH - marginY * 2);

    // Subtitle lower-third guide (82% Y)
    ctx.strokeStyle = bgType === 'vintage-paper-ink' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)';
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
  const candidates = (lyrics || []).filter((l) => l.text && l.text.trim().length > 0);
  const placedLyrics = candidates.some((l) => l.placed !== false)
    ? candidates.filter((l) => l.placed !== false)
    : candidates;

  let activeLineCount = 0;

  placedLyrics.forEach((line, lineIdx) => {
    if (timeMs < line.startMs || timeMs > line.startMs + line.durationMs) return;
    activeLineCount++;

    const elapsedMs = timeMs - line.startMs;
    const progress = Math.max(0, Math.min(1, elapsedMs / Math.max(100, line.durationMs)));

    const preset = getFontPreset(line.fontFamily);
    const baseFontSize = line.fontSize || 108;
    const fontString = buildFontString(line.fontFamily, baseFontSize);

    // If using 'album-card-stage' and line is centered (0.5), offset to the right third (0.66) so it clears the left album card
    const rawNormX = line.positionX !== undefined ? line.positionX : 0.5;
    const effNormX =
      bgType === 'album-card-stage' && Math.abs(rawNormX - 0.5) < 0.03 ? 0.66 : rawNormX;
    const posX = effNormX * canvasW;
    const posY = (line.positionY !== undefined ? line.positionY : 0.5) * canvasH;

    const primaryColor = line.primaryColor || (bgType === 'vintage-paper-ink' ? '#141414' : '#ffffff');
    const accentColor = line.accentColor || '#ef4444';
    const trackingEm = line.letterSpacing ?? preset.tracking ?? 0;
    const trackingPx = trackingEm * baseFontSize;
    const textCase = line.textCase ?? preset.defaultCase ?? 'upper';
    const strokeWidth = Math.max(0, line.strokeWidth || 0);
    const intensity = Math.max(0, Math.min(2, line.fxIntensity ?? 1));
    const seed = lineIdx * 1013 + Math.round(line.startMs);

    // Resolve layoutMode, textTexture, and cameraMotion (using preset defaults when not explicitly overridden)
    const defaultLayoutForEffect: LyricLayoutMode =
      line.effect === 'ae-poster-spin'
        ? 'corner-frame'
        : line.effect === 'hf-split-tape'
        ? 'split-anchor'
        : line.effect === 'hf-kinetic-cascade' || line.effect === 'vhs-rec-freeze'
        ? 'editorial-cascade'
        : line.effect === 'knock-echo-matrix' ||
          line.effect === 'riso-pop-halftone' ||
          line.effect === 'laser-cage-drop'
        ? 'poster-stack'
        : 'smart-wrap';

    const layoutMode: LyricLayoutMode = line.layoutMode || defaultLayoutForEffect;
    const textTexture: LyricTextTexture =
      line.textTexture ||
      (line.effect === 'ae-poster-spin'
        ? 'grunge-distress'
        : line.effect === 'riso-pop-halftone'
        ? 'halftone-dots'
        : line.effect === 'luxe-chrome'
        ? 'metallic-bevel'
        : 'solid');
    const cameraMotion: LyricCameraMotion = line.cameraMotion || 'static';
    const autoHierarchy = line.autoHierarchy !== false;

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
    const words = rawWords.map((w) => applyTextCase(w, textCase));

    const baseTimings = computeWordTimings(line.text, line.durationMs, line.words);
    const hasExplicitRoles = baseTimings.some((w) => w.role && w.role !== 'normal');
    const wordTimings =
      autoHierarchy && !hasExplicitRoles
        ? assignAutoWordHierarchy(baseTimings, line.effect)
        : baseTimings;

    const wordSpacing = Math.round(baseFontSize * 0.34);
    const lineHeight = Math.round(baseFontSize * 1.18);
    const maxLineWidth =
      line.effect === 'stacked-impact'
        ? baseFontSize * 5.2
        : bgType === 'album-card-stage'
        ? canvasW * 0.54
        : canvasW * 0.82;

    const { items, blockWidth, blockHeight } = layoutWordsMultiLine(
      ctx,
      words,
      maxLineWidth,
      wordSpacing,
      lineHeight,
      {
        wordTimings,
        baseFontSize,
        primaryFont: line.fontFamily,
        secondaryFont: line.secondaryFontFamily,
        layoutMode,
        trackingEm,
        autoHierarchy,
      }
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

    // ── APPLY 2.5D VIRTUAL CAMERA TRANSFORM (Guided by Song Rhythm & Audio Energy) ──
    const camPose = computeVirtualCameraPose(progress, rhythm, cameraMotion, intensity, seed);
    ctx.translate(posX + camPose.tx, posY + camPose.ty);
    if (camPose.rotRad !== 0) ctx.rotate(camPose.rotRad);
    if (camPose.scale !== 1) ctx.scale(camPose.scale, camPose.scale);
    ctx.translate(-posX, -posY);

    // ── LINE-LEVEL LAYER A: Ghost text (giant drifting word behind the phrase) ──
    if (line.ghostText) {
      const ghostWord = words.reduce((a, b) => (b.length > a.length ? b : a), words[0]);
      ctx.save();
      ctx.font = buildFontString(line.fontFamily, baseFontSize * 3.1 * (1 + rhythm.beatImpulse * 0.04));
      ctx.globalAlpha = (0.065 + rhythm.audioEnergy * 0.03) * lineEnvelope;
      ctx.fillStyle = primaryColor;
      ctx.fillText(ghostWord, posX + 90 - progress * 180, posY);
      ctx.restore();
    }

    // ── LINE-LEVEL LAYER A2: 4-Corner Perimeter Tickers (Fiverr `HEAD IS SPINNIN'` / `corner-frame`) ──
    if (layoutMode === 'corner-frame' || line.effect === 'ae-poster-spin') {
      const tickerWord = words[words.length - 1] || words[0];
      const tickerFontSize = Math.max(26, Math.round(baseFontSize * 0.34));
      ctx.save();
      ctx.font = buildFontString(line.secondaryFontFamily || 'Space Grotesk', tickerFontSize);
      setLetterSpacing(ctx, tickerFontSize * 0.04);
      const tickerPulse = 1 + rhythm.beatImpulse * 0.12 * intensity;
      const padX = canvasW * 0.21;
      const padY = 58;
      const corners = [
        { x: padX, y: padY },
        { x: canvasW - padX, y: padY },
        { x: padX, y: canvasH - padY },
        { x: canvasW - padX, y: canvasH - padY },
      ];
      corners.forEach((c, cIdx) => {
        const isLit = (rhythm.sub8Index + cIdx) % 2 === 0;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(tickerPulse, tickerPulse);
        ctx.globalAlpha = lineEnvelope * (isLit ? 0.95 : 0.48);
        ctx.fillStyle = accentColor;
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 10;
        ctx.fillText(`${tickerWord}'`, 0, 0);
        ctx.restore();
      });
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

    // ── LINE-LEVEL LAYER B2: Vector Paint-Splash Graphic Backing for `hf-kinetic-cascade` ──
    if (line.effect === 'hf-kinetic-cascade') {
      ctx.save();
      const splashP = easeOutCubic(clamp01(elapsedMs / 450));
      const splashW = Math.min(canvasW * 0.72, blockWidth * 0.92) * splashP;
      const splashH = Math.max(70, baseFontSize * 0.85);
      ctx.translate(posX - blockWidth * 0.12, posY + baseFontSize * 0.08);
      ctx.rotate(-0.08);

      // Primary paint-splash wave ribbon (like Fiverr Slide 4 `BOBBY AND BIG APOCALYPSE`)
      ctx.fillStyle = rgba(accentColor, 0.28 * lineEnvelope);
      ctx.beginPath();
      ctx.roundRect(-splashW / 2, -splashH / 2, splashW, splashH, splashH / 2);
      ctx.fill();

      // High-contrast wave stroke ribbon
      ctx.strokeStyle = shade(accentColor, 0.35);
      ctx.lineWidth = 10 + rhythm.beatImpulse * 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const segs = 24;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const wx = -splashW / 2 + t * splashW;
        const wy = Math.sin(t * Math.PI * 3.5 + timeMs * 0.006) * (24 + rhythm.audioEnergy * 18);
        if (s === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ── LINE-LEVEL LAYER B3: 16th-Note Micro-Echo Matrix for `knock-echo-matrix` ──
    if (line.effect === 'knock-echo-matrix') {
      const echoPhrase = words.slice(0, 3).join(' ');
      const echoSize = Math.max(24, Math.round(baseFontSize * 0.32));
      ctx.save();
      ctx.font = buildFontString(line.fontFamily, echoSize);
      setLetterSpacing(ctx, echoSize * 0.05);
      const echoRows = 3;
      const echoBaseY = posY + blockHeight / 2 + echoSize * 1.45;
      for (let r = 0; r < echoRows; r++) {
        const activeRow = rhythm.sub16Index % echoRows === r;
        ctx.save();
        ctx.translate(posX, echoBaseY + r * (echoSize * 1.18));
        ctx.scale(activeRow ? 1.16 : 1.08, 0.96);
        ctx.globalAlpha = lineEnvelope * (activeRow ? 0.95 : 0.38);
        ctx.fillStyle = activeRow ? accentColor : primaryColor;
        ctx.fillText(echoPhrase, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    // ── LINE-LEVEL LAYER B4: Wet Asphalt Mirror Reflection for `neon-wet-street` ──
    if (line.effect === 'neon-wet-street') {
      ctx.save();
      const floorY = posY + blockHeight / 2 + baseFontSize * 0.55;
      // Wet horizon line
      const floorGrad = ctx.createLinearGradient(posX - blockWidth, floorY, posX + blockWidth, floorY);
      floorGrad.addColorStop(0, 'rgba(0,0,0,0)');
      floorGrad.addColorStop(0.5, rgba(accentColor, 0.35 + rhythm.beatImpulse * 0.25));
      floorGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = floorGrad;
      ctx.fillRect(posX - blockWidth, floorY, blockWidth * 2, 3);

      // Reflected upside-down puddle distortion bands
      items.forEach((it) => {
        const rx = posX + it.centerX + Math.sin(timeMs * 0.008 + it.wordIndex) * 8;
        const ry = floorY + (floorY - (posY + it.centerY)) * 0.42;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.scale(1.04, -0.42);
        ctx.font = buildFontString(it.fontFamily, it.fontSize);
        ctx.globalAlpha = lineEnvelope * (0.22 + rhythm.audioEnergy * 0.14);
        ctx.fillStyle = accentColor;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 28;
        ctx.fillText(it.word, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    }

    // ── LINE-LEVEL LAYER C: Onset screen-shake (applies to every word of the line) ──
    if (
      line.effect === 'beat-slam' ||
      line.effect === 'crash-zoom' ||
      line.effect === 'ae-poster-spin' ||
      line.effect === 'hf-split-tape'
    ) {
      const amp =
        (line.effect === 'crash-zoom' ? 30 : line.effect === 'hf-split-tape' ? 16 : 20) *
        intensity *
        (0.7 + rhythm.beatImpulse * 0.6);
      const shake = computeOnsetShake(elapsedMs, wordTimings, amp, seed);
      ctx.translate(shake.x, shake.y);
    }

    // Global base tilt (-3.5 deg) for HyperFrames `hf-split-tape`
    if (line.effect === 'hf-split-tape' || layoutMode === 'split-anchor') {
      ctx.translate(posX, posY);
      ctx.rotate(-0.061 + rhythm.downbeatImpulse * 0.025 * intensity);
      ctx.translate(-posX, -posY);
    }

    // Keyword (longest word) for the font-shuffle effect
    let keywordIndex = 0;
    words.forEach((w, i) => {
      if (w.length > words[keywordIndex].length) keywordIndex = i;
    });

    items.forEach((item) => {
      const wt = wordTimings[item.wordIndex] || {
        word: item.word,
        startOffsetMs: (item.wordIndex / words.length) * line.durationMs * 0.7,
        durationMs: line.durationMs / words.length,
        role: item.role,
      };

      const wordElapsed = elapsedMs - wt.startOffsetMs;
      const wordProgress = Math.max(0, Math.min(1, wordElapsed / Math.max(80, wt.durationMs)));
      const isWordActive = elapsedMs >= wt.startOffsetMs && elapsedMs <= wt.startOffsetMs + wt.durationMs;
      const isWordCompleted = elapsedMs > wt.startOffsetMs + wt.durationMs;

      const drawX = posX + item.centerX;
      const drawY = posY + item.centerY;
      const itemFontSize = item.fontSize || baseFontSize;
      const itemFontFamily = item.fontFamily || line.fontFamily;
      const itemRole = wt.role || item.role || 'normal';
      const itemColor = wt.customColor || primaryColor;

      ctx.save();
      ctx.font = buildFontString(itemFontFamily, itemFontSize);
      setLetterSpacing(ctx, trackingEm * itemFontSize);

      // ════════════════════════════════════════════════════════════════════════
      //  NEW STUDIO AE / HYPERFRAMES / LEMO-OPUSCAR PRO EFFECTS (1–8)
      // ════════════════════════════════════════════════════════════════════════

      // PRO EFFECT 1: AE POSTER SPIN (`HEAD [IS] SPINNIN'` — Fiverr Slide 1)
      if (line.effect === 'ae-poster-spin') {
        const entryP = clamp01((wordElapsed + 60) / 260);
        if (entryP <= 0) {
          ctx.restore();
          return;
        }
        const slamScale = easeOutBack(entryP, 2.1) * (1 + (isWordActive ? rhythm.beatImpulse * 0.08 : 0));
        ctx.translate(drawX, drawY);

        if (itemRole === 'badge') {
          ctx.scale(slamScale, slamScale);
          ctx.globalAlpha = lineEnvelope;
          drawBadgeWord(
            ctx,
            item.word,
            0,
            0,
            itemFontSize,
            item.width,
            accentColor,
            (item.wordIndex % 2 === 0 ? -1 : 1) * 0.045
          );
        } else {
          // Condensed brutalist poster scale (scaleX 0.85, massive height)
          const condX = itemRole === 'hero' ? 0.84 : 0.94;
          ctx.scale(slamScale * condX, slamScale * (itemRole === 'hero' ? 1.14 : 1.0));
          ctx.globalAlpha = lineEnvelope;
          ctx.fillStyle = itemColor;
          fillWord(
            ctx,
            item.word,
            0,
            0,
            strokeWidth,
            accentColor,
            textTexture === 'solid' ? 'grunge-distress' : textTexture,
            itemFontSize,
            item.width,
            seed + item.wordIndex * 41
          );
        }
      }

      // PRO EFFECT 2: HYPERFRAMES TORN-TAPE BRUTALIST (`split-anchor-word-slot`)
      else if (line.effect === 'hf-split-tape') {
        const isRightTape = item.columnSide === 'right-slot' || itemRole === 'badge' || item.wordIndex >= Math.ceil(words.length / 2);
        if (wordElapsed < -40) {
          ctx.restore();
          return;
        }
        const p = clamp01((wordElapsed + 40) / 240);

        if (!isRightTape) {
          // Left Anchor Column: Faux-extended width (scaleX 1.12) + punchy expo.out pop
          const e = easeOutExpo(p);
          ctx.translate(drawX, drawY + (1 - e) * 26);
          ctx.scale((0.75 + 0.37 * e) * (1 + rhythm.beatImpulse * 0.04), 0.86 + 0.14 * e);
          ctx.globalAlpha = lineEnvelope * e;
          ctx.fillStyle = itemColor;
          fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
        } else {
          // Right Torn-Paper Tape Strip: whips in from right with scaleX stretch
          const e = easeOutExpo(p);
          const whipX = (1 - e) * 165 * intensity;
          const stretchX = 1.12 + (1 - e) * 0.58 * intensity;
          const tapeRot = ([-2.1, 1.7, -1.1, 2.3][item.wordIndex % 4] * Math.PI) / 180;

          ctx.translate(drawX + whipX, drawY);
          ctx.rotate(tapeRot);
          ctx.scale(stretchX, 1 + (isWordActive ? rhythm.beatImpulse * 0.06 : 0));
          ctx.globalAlpha = lineEnvelope * Math.min(1, p * 4);

          const padX = itemFontSize * 0.22;
          const padY = itemFontSize * 0.12;
          const tw = item.width + padX * 2;
          const th = itemFontSize * 0.98 + padY * 2;

          // Torn tape shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.fillRect(-tw / 2 + 6, -th / 2 + 7, tw, th);

          // Torn paper polygon clip-path
          const invertOnDownbeat = rhythm.isDownbeat && isWordActive;
          ctx.fillStyle = invertOnDownbeat ? accentColor : '#f4f4f4';
          ctx.beginPath();
          ctx.moveTo(-tw / 2, -th / 2 + th * 0.06);
          ctx.lineTo(tw / 2 - tw * 0.02, -th / 2);
          ctx.lineTo(tw / 2, th / 2 - th * 0.08);
          ctx.lineTo(-tw / 2 + tw * 0.03, th / 2);
          ctx.closePath();
          ctx.fill();

          // Tape ink color
          const tapeInks = [accentColor, '#0a84ff', '#111111', '#e11d48'];
          const chosenInk = invertOnDownbeat
            ? '#0a0a0a'
            : getLuminance( tapeInks[item.wordIndex % tapeInks.length] ) > 180
            ? '#0a0a0a'
            : tapeInks[item.wordIndex % tapeInks.length];
          ctx.fillStyle = chosenInk;
          ctx.fillText(item.word, 0, 1);
        }
      }

      // PRO EFFECT 3: EDITORIAL KINETIC CASCADE + SHOCKWAVE (`intro-kinetic-cascade` + `BOBBY & BIG APOCALYPSE`)
      else if (line.effect === 'hf-kinetic-cascade') {
        if (wordElapsed < 0) {
          ctx.restore();
          return;
        }
        const p = clamp01(wordElapsed / 320);
        const e = itemRole === 'hero' ? easeOutBack(p, 2.2) : easeOutCubic(p);

        ctx.translate(drawX, drawY + (1 - e) * 34);
        ctx.scale(0.84 + 0.16 * e + (isWordActive ? rhythm.beatImpulse * 0.07 : 0), 0.84 + 0.16 * e);
        ctx.globalAlpha = lineEnvelope * Math.min(1, p * 2.5);

        if (itemRole === 'badge') {
          drawBadgeWord(ctx, item.word, 0, 0, itemFontSize, item.width, accentColor, -0.04);
        } else if (itemRole === 'hero' || itemRole === 'accent-script') {
          // Animated shockwave rings on Hero word onset
          if (wordProgress < 0.75) {
            const ringP = easeOutCubic(wordProgress / 0.75);
            for (let r = 0; r < 2; r++) {
              const rp = clamp01(ringP - r * 0.14);
              if (rp > 0 && rp < 1) {
                ctx.save();
                ctx.strokeStyle = rgba(accentColor, (1 - rp) * 0.65);
                ctx.lineWidth = (1 - rp) * 6 + 1.5;
                ctx.beginPath();
                ctx.arc(0, 0, itemFontSize * (0.4 + rp * 1.45), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
              }
            }
          }

          // Hero word with bold dark offset drop shadow + outline (Fiverr Slide 4 style)
          ctx.save();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
          ctx.fillText(item.word, 6, 8);
          ctx.restore();

          ctx.fillStyle = accentColor;
          fillWord(
            ctx,
            item.word,
            0,
            0,
            Math.max(2.5, strokeWidth),
            '#09090b',
            textTexture,
            itemFontSize,
            item.width,
            seed + item.wordIndex
          );
        } else {
          ctx.save();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
          ctx.fillText(item.word, 4, 6);
          ctx.restore();
          ctx.fillStyle = itemColor;
          fillWord(
            ctx,
            item.word,
            0,
            0,
            Math.max(1.5, strokeWidth),
            '#09090b',
            textTexture,
            itemFontSize,
            item.width,
            seed + item.wordIndex
          );
        }
      }

      // PRO EFFECT 4: KNOCK ECHO MATRIX 16TH (`KNOCK KNOCK` — Extended Geo + Rhythm Strobe)
      else if (line.effect === 'knock-echo-matrix') {
        const entry = easeOutExpo(clamp01((wordElapsed + 30) / 220));
        if (entry <= 0) {
          ctx.restore();
          return;
        }
        const pulseScale = 1 + (isWordActive ? rhythm.beatImpulse * 0.1 * intensity : 0);
        ctx.translate(drawX, drawY);
        // Extended wide geometric scaleX (1.18)
        ctx.scale(entry * 1.18 * pulseScale, entry * 0.96 * pulseScale);
        ctx.globalAlpha = lineEnvelope;

        if (isWordActive && rhythm.sub16Index % 2 === 0) {
          // 16th-note double outline echo behind the active word
          ctx.save();
          ctx.strokeStyle = rgba(accentColor, 0.55);
          ctx.lineWidth = 2.5;
          ctx.strokeText(item.word, 0, -14);
          ctx.strokeText(item.word, 0, 14);
          ctx.restore();
        }

        ctx.fillStyle = isWordActive ? accentColor : itemColor;
        fillWord(
          ctx,
          item.word,
          0,
          0,
          strokeWidth,
          accentColor,
          textTexture === 'solid' ? 'grunge-distress' : textTexture,
          itemFontSize,
          item.width,
          seed + item.wordIndex
        );
      }

      // PRO EFFECT 5: RISOGRAPH & POP-ART BEN-DAY (`lemo-opuscar/risograph` & `pop-art`)
      else if (line.effect === 'riso-pop-halftone') {
        if (wordElapsed < -20) {
          ctx.restore();
          return;
        }
        const p = clamp01((wordElapsed + 20) / 240);
        const stampScale = 1 + (1 - easeOutBack(p, 2.4)) * 0.22;

        // Misregistration plate kick on the beat (decays to ±3px fixed registration slip)
        const regKick = (3 + rhythm.beatImpulse * 9 * intensity) * (1 - p * 0.35);
        const plate2X = regKick * (item.wordIndex % 2 === 0 ? 1 : -1);
        const plate2Y = regKick * 0.75;

        ctx.translate(drawX, drawY);
        ctx.scale(stampScale, stampScale);
        ctx.globalAlpha = lineEnvelope;

        if (itemRole === 'badge') {
          drawBadgeWord(ctx, item.word, 0, 0, itemFontSize, item.width, '#ffd21f', -0.035);
        } else {
          // Plate 0: Paper-white knockout halo (4px)
          ctx.save();
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(8, itemFontSize * 0.08);
          ctx.strokeStyle = '#f8f2e2';
          ctx.strokeText(item.word, 0, 0);
          ctx.restore();

          // Plate 1: Offset Cyan / Yellow / Pink Riso Secondary Plate
          ctx.save();
          ctx.fillStyle = itemRole === 'hero' ? '#ffd21f' : '#0078bf';
          ctx.fillText(item.word, plate2X, plate2Y);
          ctx.restore();

          // Plate 2: Primary Spot Ink Fill + Halftone Ben-Day Dots
          ctx.fillStyle = itemRole === 'hero' ? accentColor : itemColor;
          fillWord(
            ctx,
            item.word,
            0,
            0,
            Math.max(2.5, strokeWidth || 3),
            '#141414',
            'halftone-dots',
            itemFontSize,
            item.width,
            seed + item.wordIndex
          );
        }
      }

      // PRO EFFECT 6: GLASS NEON & WET STREET (`lemo-opuscar/neon-tubes` — Real Strike Flicker)
      else if (line.effect === 'neon-wet-street') {
        ctx.translate(drawX, drawY);

        // Authentic gas-tube strike sequence on word onset:
        // 0..50ms: 100% strike -> 50..110ms: dark -> 110..160ms: 75% -> 160..240ms: full ignition
        let tubeLit = 0.18;
        if (wordElapsed >= 0) {
          if (wordElapsed < 50) tubeLit = 1.0;
          else if (wordElapsed < 110) tubeLit = 0.22;
          else if (wordElapsed < 160) tubeLit = 0.78;
          else tubeLit = 0.94 + Math.sin(timeMs * 0.09 + item.wordIndex) * 0.04 + rhythm.beatImpulse * 0.12;
        }

        const tubeColor = itemRole === 'hero' ? accentColor : isWordActive ? accentColor : itemColor;

        // 1. Dark backing board behind the glass tube
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(10, itemFontSize * 0.11);
        ctx.strokeStyle = 'rgba(8, 12, 22, 0.75)';
        ctx.strokeText(item.word, 0, 4);
        ctx.restore();

        // 2. Outer atmospheric bloom halo
        ctx.save();
        ctx.globalAlpha = lineEnvelope * Math.min(1, tubeLit);
        ctx.shadowColor = tubeColor;
        ctx.shadowBlur = (isWordActive ? 52 : 28) * intensity * (1 + rhythm.beatImpulse * 0.35);
        ctx.strokeStyle = tubeColor;
        ctx.lineWidth = Math.max(5, itemFontSize * 0.055);
        ctx.strokeText(item.word, 0, 0);
        ctx.restore();

        // 3. Saturated gas bore + hot white center filament
        ctx.save();
        ctx.globalAlpha = lineEnvelope * Math.max(0.28, Math.min(1, tubeLit));
        ctx.fillStyle = tubeLit > 0.5 ? '#ffffff' : 'rgba(200, 215, 230, 0.45)';
        ctx.shadowColor = tubeColor;
        ctx.shadowBlur = 16;
        ctx.fillText(item.word, 0, 0);
        ctx.restore();
      }

      // PRO EFFECT 7: CONCERT LASER RIG 6X (`embedded-captions/laser` + `text-spectral-rays`)
      else if (line.effect === 'laser-cage-drop') {
        // Dual laser beams converge onto the word 90ms BEFORE and 180ms AFTER its onset!
        const laserWindow = wordElapsed >= -90 && wordElapsed <= 220;
        if (laserWindow) {
          const lp = clamp01((wordElapsed + 90) / 310);
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          const beamAlpha = Math.sin(lp * Math.PI) * 0.9 * lineEnvelope;

          // Beam 1: Cyan/Green laser from top-left stage rig
          ctx.strokeStyle = `rgba(34, 211, 238, ${beamAlpha})`;
          ctx.shadowColor = '#22d3ee';
          ctx.shadowBlur = 24;
          ctx.lineWidth = 3.5 + rhythm.beatImpulse * 3;
          ctx.beginPath();
          ctx.moveTo(canvasW * 0.08, 0);
          ctx.lineTo(drawX, drawY);
          ctx.stroke();

          // Beam 2: Magenta/Red laser from top-right stage rig
          ctx.strokeStyle = `rgba(244, 63, 94, ${beamAlpha})`;
          ctx.shadowColor = '#f43f5e';
          ctx.shadowBlur = 24;
          ctx.beginPath();
          ctx.moveTo(canvasW * 0.92, 0);
          ctx.lineTo(drawX, drawY);
          ctx.stroke();

          // Ignition flare pop at convergence point
          const flareR = (18 + Math.sin(lp * Math.PI) * 46) * intensity;
          const flare = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, flareR);
          flare.addColorStop(0, `rgba(255, 255, 255, ${beamAlpha})`);
          flare.addColorStop(0.4, rgba(accentColor, beamAlpha * 0.7));
          flare.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = flare;
          ctx.beginPath();
          ctx.arc(drawX, drawY, flareR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // 6-Beam Laser Cage Fan behind the HERO word when active
        if (itemRole === 'hero' && wordElapsed >= 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          const fanP = easeOutCubic(clamp01(wordElapsed / 480));
          const beamCount = 6;
          for (let b = 0; b < beamCount; b++) {
            const normB = b / (beamCount - 1) - 0.5;
            const spreadAngle = normB * 1.15 * fanP + Math.sin(timeMs * 0.004 + b) * 0.06;
            const rayLen = canvasW * 0.55;
            ctx.strokeStyle = rgba(b % 2 === 0 ? accentColor : '#f43f5e', (0.28 + rhythm.beatImpulse * 0.35) * lineEnvelope);
            ctx.lineWidth = 2.5 + rhythm.downbeatImpulse * 4;
            ctx.beginPath();
            ctx.moveTo(drawX, drawY);
            ctx.lineTo(drawX + Math.sin(spreadAngle) * rayLen, drawY - Math.cos(spreadAngle) * rayLen);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (wordElapsed < -20) {
          ctx.restore();
          return;
        }
        const entry = easeOutBack(clamp01((wordElapsed + 20) / 220), 1.9);
        ctx.translate(drawX, drawY);
        ctx.scale(entry * (1 + (isWordActive ? rhythm.beatImpulse * 0.08 : 0)), entry);
        ctx.globalAlpha = lineEnvelope;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = isWordActive ? 38 : 14;
        ctx.fillStyle = isWordActive ? '#ffffff' : itemColor;
        fillWord(
          ctx,
          item.word,
          0,
          0,
          strokeWidth,
          accentColor,
          textTexture,
          itemFontSize,
          item.width,
          seed + item.wordIndex
        );
      }

      // PRO EFFECT 8: 90s VHS CAMCORDER REC-FREEZE (`embedded-captions/vhs` — 3 Sheared Tracking Bands)
      else if (line.effect === 'vhs-rec-freeze') {
        if (wordElapsed < 0) {
          ctx.restore();
          return;
        }
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope;

        const slamDur = 320;
        const p = clamp01(wordElapsed / slamDur);
        const e = easeOutExpo(p);
        const shearRemaining = (1 - e) * 140 * intensity + (isWordActive ? rhythm.beatImpulse * 10 : 0);

        // 3 Horizontal Tracking Bands that slam from opposite sides and snap into register
        const BANDS = 3;
        const top = -itemFontSize * 0.62;
        const bandH = (itemFontSize * 1.24) / BANDS;

        for (let b = 0; b < BANDS; b++) {
          const dir = b === 1 ? -1 : 1;
          const bandOffset = (b - 1) * shearRemaining * dir;
          ctx.save();
          ctx.beginPath();
          ctx.rect(-item.width / 2 - 180, top + b * bandH, item.width + 360, bandH + 1);
          ctx.clip();

          // Permanent VHS Red/Cyan chromatic misregistration fringe
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
          ctx.fillText(item.word, bandOffset - 3.5, 0);
          ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
          ctx.fillText(item.word, bandOffset + 3.5, 0);
          ctx.globalCompositeOperation = 'source-over';

          ctx.fillStyle = itemRole === 'hero' && isWordActive ? accentColor : itemColor;
          fillWord(
            ctx,
            item.word,
            bandOffset,
            0,
            strokeWidth,
            accentColor,
            textTexture,
            itemFontSize,
            item.width,
            seed + item.wordIndex
          );
          ctx.restore();
        }

        // VHS Head-Switching White Noise Bar on the first 90ms of Hero word hit
        if (itemRole === 'hero' && wordElapsed < 110) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(1 - wordElapsed / 110) * 0.75})`;
          ctx.fillRect(-item.width / 2 - 40, -6, item.width + 80, 12);
        }
      }

      // ════════════════════════════════════════════════════════════════════════
      //  CLASSIC & HYPERFRAMES BRUTAL EFFECTS (Preserved & Rhythm-Enhanced)
      // ════════════════════════════════════════════════════════════════════════

      // EFFECT 1: CAPCUT KARAOKE PRO (Word-by-Word Active Fill + Spring Bounce)
      else if (line.effect === 'capcut-karaoke') {
        const bounce = isWordActive
          ? 1 + Math.sin(wordProgress * Math.PI) * 0.14 + rhythm.beatImpulse * 0.04
          : isWordCompleted
          ? 1.02
          : 0.96;
        const liftY = isWordActive ? -Math.sin(wordProgress * Math.PI) * 12 : 0;

        ctx.translate(drawX, drawY + liftY);
        ctx.scale(bounce, bounce);

        if (itemRole === 'badge') {
          ctx.globalAlpha = lineEnvelope;
          drawBadgeWord(ctx, item.word, 0, 0, itemFontSize, item.width, accentColor, -0.03);
        } else {
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
              -itemFontSize * 0.52 - padY / 2,
              item.width + padX * 2,
              itemFontSize * 0.98 + padY,
              18
            );
            ctx.fill();
            ctx.restore();
          }

          // Unsung base text (ghosted white)
          ctx.globalAlpha = lineEnvelope * (isWordCompleted ? 0.95 : 0.32);
          ctx.fillStyle = itemColor;
          fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);

          // Progressive wipe fill on active/completed word
          if (wordProgress > 0) {
            ctx.save();
            ctx.beginPath();
            const fillW = item.width * wordProgress;
            ctx.rect(-item.width / 2 - 10, -itemFontSize, fillW + 20, itemFontSize * 2);
            ctx.clip();
            ctx.globalAlpha = lineEnvelope;
            ctx.fillStyle = isWordActive ? '#ffffff' : itemColor;
            if (!isWordActive && isWordCompleted) {
              ctx.shadowColor = accentColor;
              ctx.shadowBlur = 18;
            }
            fillWord(ctx, item.word, 0, 0, 0, accentColor, textTexture, itemFontSize, item.width, seed);
            ctx.restore();
          }
        }
      }

      // EFFECT 2: KINETIC STAGE SLAM (Spring Physics Overshoot)
      else if (line.effect === 'kinetic') {
        if (wordProgress <= 0) {
          ctx.restore();
          return;
        }
        const entryP = Math.min(1, wordProgress / 0.35);
        const scale =
          (entryP < 1 ? Math.max(0.2, easeOutBack(entryP)) : 1) *
          (1 + (isWordActive ? rhythm.beatImpulse * 0.05 : 0));
        const yOffset = (1 - easeOutCubic(entryP)) * 42;

        ctx.translate(drawX, drawY + yOffset);
        ctx.scale(scale, scale);
        ctx.globalAlpha = lineEnvelope * Math.min(1, entryP * 1.4);

        if (itemRole === 'badge') {
          drawBadgeWord(ctx, item.word, 0, 0, itemFontSize, item.width, accentColor, -0.04);
        } else {
          if (isWordActive) {
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 28;
            ctx.fillStyle = accentColor;
          } else {
            ctx.shadowColor = 'rgba(0,0,0,0.75)';
            ctx.shadowBlur = 16;
            ctx.fillStyle = itemColor;
          }
          fillWord(
            ctx,
            item.word,
            0,
            0,
            strokeWidth,
            isWordActive ? itemColor : accentColor,
            textTexture,
            itemFontSize,
            item.width,
            seed
          );
        }
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
        ctx.fillStyle = itemColor;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = isWordActive ? 24 : 8;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
      }

      // EFFECT 4: NEON STAGE ARENA (Double Tube Glow + Pulse)
      else if (line.effect === 'neon-stage') {
        ctx.translate(drawX, drawY);
        const activeScale = (isWordActive ? 1.07 : 1.0) * (1 + rhythm.beatImpulse * 0.04);
        ctx.scale(activeScale, activeScale);
        ctx.globalAlpha = lineEnvelope * (wordProgress > 0 ? 1 : 0.45);

        ctx.shadowColor = accentColor;
        ctx.shadowBlur = (isWordActive ? 42 : 18) * (1 + rhythm.beatImpulse * 0.3);
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

        ctx.fillStyle = itemColor;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
      }

      // EFFECT 6: CHROMATIC GLOW (RGB Split)
      else if (line.effect === 'chromatic-glow') {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope;
        const aberration =
          (isWordActive ? 6 + Math.sin(timeMs / 55) * 3 : 2.5) * (1 + rhythm.beatImpulse * 0.45);

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
        fillWord(ctx, item.word, 0, 0, strokeWidth, rgba(accentColor, 0.5), textTexture, itemFontSize, item.width, seed);

        ctx.save();
        ctx.beginPath();
        const wipeW = item.width * Math.min(1, wordProgress * 1.15);
        ctx.rect(-item.width / 2 - 8, -itemFontSize, wipeW + 16, itemFontSize * 2);
        ctx.clip();
        const grad = ctx.createLinearGradient(-item.width / 2, 0, item.width / 2, 0);
        grad.addColorStop(0, itemColor);
        grad.addColorStop(0.75, itemColor);
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

        const GLITCH_DUR = 380;
        let amp = 0;
        if (wordElapsed >= 0 && wordElapsed < GLITCH_DUR) amp = 1 - Math.pow(wordElapsed / GLITCH_DUR, 3);
        const burstAt = wt.durationMs * 0.58;
        if (isWordActive && wordElapsed > burstAt && wordElapsed < burstAt + 140) {
          amp = Math.max(amp, 0.55 * (1 - (wordElapsed - burstAt) / 140));
        }
        amp *= intensity * (1 + rhythm.downbeatImpulse * 0.35);

        const step = Math.floor(timeMs / 42);
        if (amp > 0.02) {
          const jx = (hash01(step * 13 + item.wordIndex * 7) * 2 - 1) * 14 * amp;
          const jy = (hash01(step * 29 + item.wordIndex * 11) * 2 - 1) * 5 * amp;
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = rgba(accentColor, 0.85);
          ctx.fillText(item.word, jx, jy);
          ctx.fillStyle = 'rgba(6, 182, 212, 0.85)';
          ctx.fillText(item.word, -jx, -jy);
          ctx.restore();
          const SLICES = 6;
          const top = -itemFontSize * 0.62;
          const bandH = (itemFontSize * 1.24) / SLICES;
          ctx.fillStyle = itemColor;
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
          ctx.fillStyle = itemColor;
          if (isWordActive) {
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 22;
          }
          fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
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
          const e = easeOutQuint(p);
          scale = 1 + (1 - e) * 0.85 * intensity;
          blurPx = (1 - e) * 16 * intensity;
        } else if (mode === 1) {
          const dir = hash01(seed + item.wordIndex) > 0.5 ? 1 : -1;
          tx = (1 - easeOutExpo(p)) * 340 * dir * intensity;
          blurPx = (1 - easeOutExpo(p)) * 8 * intensity;
        } else {
          const e = easeOutCubic(p);
          ty = (1 - e) * 110 * intensity;
          rot = (1 - e) * 0.16 * intensity;
        }

        ctx.translate(drawX + tx, drawY + ty);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        if (blurPx > 0.5) ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
        ctx.globalAlpha = lineEnvelope * Math.min(1, p * 5);

        if (itemRole === 'badge') {
          drawBadgeWord(ctx, item.word, 0, 0, itemFontSize, item.width, accentColor, -0.04);
        } else {
          if (isWordActive) {
            ctx.fillStyle = accentColor;
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 34;
          } else {
            ctx.fillStyle = itemColor;
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 14;
          }
          fillWord(
            ctx,
            item.word,
            0,
            0,
            strokeWidth,
            isWordActive ? itemColor : accentColor,
            textTexture,
            itemFontSize,
            item.width,
            seed
          );

          if (p < 0.12) {
            ctx.filter = 'none';
            ctx.globalAlpha = (1 - p / 0.12) * 0.9 * lineEnvelope;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(item.word, 0, 0);
          }
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
        if (p < 1) {
          for (let k = 3; k >= 1; k--) {
            ctx.save();
            const s = scale * (1 + k * 0.16 * (1 - e));
            ctx.scale(s, s);
            ctx.globalAlpha = ((0.22 * (1 - p)) / k) * lineEnvelope;
            ctx.fillStyle = accentColor;
            ctx.fillText(item.word, 0, 0);
            ctx.restore();
          }
        }
        ctx.scale(scale, scale);
        ctx.globalAlpha = lineEnvelope * Math.min(1, p * 3);
        ctx.fillStyle = isWordActive ? '#ffffff' : itemColor;
        ctx.shadowColor = isWordActive ? accentColor : 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = isWordActive ? 38 : 14;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
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
        const hingeY = drawY + itemFontSize * 0.42;
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
            ctx.fillStyle = itemColor;
          }
          fillWord(ctx, glyph, 0, -itemFontSize * 0.42, strokeWidth, accentColor);
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
        const off = 5 * Math.max(0.4, intensity) * (1 + beatPulse * 0.5 + rhythm.beatImpulse * 0.35) * grow;

        ctx.translate(drawX, drawY);
        ctx.scale(scale, scale);
        ctx.globalAlpha = lineEnvelope;
        for (let i = LAYERS; i >= 1; i--) {
          ctx.fillStyle = rgba(accentColor, Math.max(0.85 - i * 0.12, 0.15));
          ctx.fillText(item.word, i * off, i * off);
        }
        ctx.fillStyle = itemColor;
        fillWord(
          ctx,
          item.word,
          0,
          0,
          strokeWidth,
          shade(accentColor, -0.4),
          textTexture,
          itemFontSize,
          item.width,
          seed
        );
      }

      // EFFECT 13: WATERFALL WHIP (HyperFrames `waterfall-entry` — binary opacity, weighted travel)
      else if (line.effect === 'waterfall') {
        const leadMs = 60;
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
        ctx.globalAlpha = lineEnvelope;
        if (p < 1) {
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
          ctx.fillStyle = itemColor;
        }
        fillWord(
          ctx,
          item.word,
          0,
          0,
          strokeWidth,
          isWordActive ? itemColor : accentColor,
          textTexture,
          itemFontSize,
          item.width,
          seed
        );
      }

      // EFFECT 14: LUXE CHROME SWEEP (chrome-sweep / gradient-text-sweep inside the glyphs)
      else if (line.effect === 'luxe-chrome') {
        const started = wordElapsed >= 0;
        const entry = started ? easeOutCubic(clamp01(wordElapsed / 360)) : 0;
        const scale = 0.96 + 0.04 * entry;
        ctx.translate(drawX, drawY);
        ctx.scale(scale, scale);
        ctx.globalAlpha = lineEnvelope * (started ? 0.35 + 0.65 * entry : 0.28);

        const h = itemFontSize * 0.55;
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

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = shade(accentColor, -0.6);
        ctx.strokeText(item.word, 0, 0);

        if (started) {
          const sweepP = clamp01(wordElapsed / 650);
          const beatSweep = isWordActive ? rhythm.beatPhase : 1;
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
          let fontId: LyricFontFamily | undefined = itemFontFamily;
          if (elapsedMs < lockAt) {
            const beatIdx = Math.floor(wordElapsed / (beatPeriodMs * 0.5));
            if (beatIdx >= 1) fontId = SHUFFLE_FONTS[(beatIdx - 1 + item.wordIndex) % SHUFFLE_FONTS.length];
          }
          ctx.font = buildFontString(fontId, itemFontSize);
          const w = Math.max(1, ctx.measureText(item.word).width);
          const fit = Math.max(0.6, Math.min(1.35, item.width / w));
          ctx.scale(fit * (0.92 + 0.08 * pop), fit * (0.92 + 0.08 * pop));
          ctx.fillStyle = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = isWordActive ? 30 : 12;
          fillWord(ctx, item.word, 0, 0, strokeWidth, itemColor, textTexture, itemFontSize, item.width, seed);
        } else {
          ctx.scale(0.92 + 0.08 * pop, 0.92 + 0.08 * pop);
          ctx.fillStyle = itemColor;
          if (isWordActive) {
            ctx.shadowColor = rgba(itemColor, 0.6);
            ctx.shadowBlur = 20;
          }
          fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
        }
      }

      // EFFECT 16: WRITE-ON OUTLINE FILL (outline-to-fill)
      else if (line.effect === 'write-on') {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope;
        const outlineW = Math.max(2, itemFontSize * 0.024);
        const halfW = item.width / 2 + 12;
        const fullH = itemFontSize * 1.3;

        if (wordElapsed < 0) {
          ctx.strokeStyle = rgba(itemColor, 0.18);
          ctx.lineWidth = outlineW;
          ctx.strokeText(item.word, 0, 0);
        } else {
          const traceDur = Math.min(420, wt.durationMs * 0.5);
          const fillDur = Math.min(380, wt.durationMs * 0.5);
          const traceP = easeOutCubic(clamp01(wordElapsed / traceDur));
          const fillP = easeOutCubic(clamp01((wordElapsed - traceDur * 0.6) / fillDur));

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

          if (fillP > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(-halfW, fullH / 2 - fullH * fillP, halfW * 2, fullH * fillP);
            ctx.clip();
            ctx.fillStyle = isWordActive ? accentColor : itemColor;
            if (isWordActive) {
              ctx.shadowColor = accentColor;
              ctx.shadowBlur = 24;
            }
            fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
            ctx.restore();
          }
        }
      }

      // EFFECT 17: LIQUID WAVE (text-wave-distort per character)
      else if (line.effect === 'liquid') {
        const chars = Array.from(item.word);
        const offsets = charOffsets(ctx, item.word);
        const settle = isWordCompleted ? 0.12 : isWordActive ? 1 - wordProgress * 0.6 : 0.55;
        const A = itemFontSize * 0.16 * intensity * settle * (1 + rhythm.audioEnergy * 0.35);
        const left = drawX - item.width / 2;
        ctx.textAlign = 'left';
        ctx.globalAlpha = lineEnvelope * (wordElapsed < 0 ? 0.45 : 1);
        if (isWordActive) {
          ctx.fillStyle = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 26;
        } else {
          ctx.fillStyle = itemColor;
        }
        chars.forEach((ch, ci) => {
          const phase = timeMs * 0.006 + ci * 0.55 + item.wordIndex * 1.3;
          ctx.save();
          ctx.translate(left + offsets[ci], drawY + Math.sin(phase) * A);
          ctx.rotate(Math.cos(phase) * 0.09 * intensity * settle);
          fillWord(ctx, ch, 0, 0, strokeWidth, isWordActive ? itemColor : accentColor);
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
        ctx.globalAlpha = lineEnvelope * (1 - spread);
        ctx.fillStyle = itemColor;
        if (isWordActive) {
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 22;
        }
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
      }

      // FALLBACK: clean fade (unknown / legacy effect ids never break the stage)
      else {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope * (wordElapsed < 0 ? 0.4 : 1);
        ctx.fillStyle = isWordActive ? accentColor : itemColor;
        fillWord(ctx, item.word, 0, 0, strokeWidth, accentColor, textTexture, itemFontSize, item.width, seed);
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

  // 5. Post-Processing Overlays: Optical Vignette, Film Grain, VHS OSD & Tactical HUD Telemetry
  if (bgType !== 'transparent' && bgType !== 'chroma-green' && bgType !== 'chroma-blue') {
    // 5A. Optical Lens Vignette
    if (bgConfig.vignette !== false) {
      ctx.save();
      const vig = ctx.createRadialGradient(
        canvasW * 0.5,
        canvasH * 0.5,
        canvasW * 0.34,
        canvasW * 0.5,
        canvasH * 0.5,
        canvasW * 0.72
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, bgType === 'vintage-paper-ink' ? 'rgba(40,30,15,0.22)' : 'rgba(0,0,0,0.48)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    // 5B. Deterministic 24fps Film Grain / Print Speckles
    if (bgConfig.filmGrain) {
      ctx.save();
      const frameStep = Math.floor(timeMs / 42); // 24fps film grain boil
      const isLightPaper = bgType === 'vintage-paper-ink';
      ctx.fillStyle = isLightPaper ? 'rgba(20, 18, 14, 0.08)' : 'rgba(255, 255, 255, 0.065)';
      for (let g = 0; g < 65; g++) {
        const gx = hash01(frameStep * 13.7 + g * 31.1) * canvasW;
        const gy = hash01(frameStep * 29.3 + g * 47.9) * canvasH;
        const gs = 1.2 + hash01(frameStep * 7.1 + g * 19.3) * 2.2;
        ctx.fillRect(gx, gy, gs, gs);
      }
      ctx.restore();
    }

    // 5C. VHS Camcorder OSD Chrome when any active line uses `vhs-rec-freeze`
    const hasActiveVhs = placedLyrics.some(
      (l) =>
        l.effect === 'vhs-rec-freeze' &&
        timeMs >= l.startMs &&
        timeMs <= l.startMs + l.durationMs
    );
    if (hasActiveVhs) {
      ctx.save();
      // Scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
      for (let y = 0; y < canvasH; y += 6) {
        ctx.fillRect(0, y, canvasW, 2);
      }
      ctx.font = '700 26px "Space Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('▶ PLAY   SP', 84, 78);

      // Blinking REC dot
      if (rhythm.sub8Index % 2 === 0) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(canvasW - 210, 70, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillText('REC', canvasW - 190, 78);

      const totalSec = Math.max(0, timeMs / 1000);
      const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const secs = String(Math.floor(totalSec % 60)).padStart(2, '0');
      const frames = String(Math.floor((totalSec % 1) * 30)).padStart(2, '0');
      ctx.fillStyle = '#4ade80';
      ctx.fillText(`TC 00:${mins}:${secs}:${frames}`, 84, canvasH - 64);
      ctx.restore();
    }

    // 5D. Swiss / Industrial Rhythm HUD Telemetry (`hudTelemetry`)
    if (bgConfig.hudTelemetry) {
      ctx.save();
      const hudColor = bgType === 'vintage-paper-ink' ? 'rgba(20,20,20,0.65)' : 'rgba(255,255,255,0.55)';
      ctx.font = '700 16px "Space Mono", monospace';
      ctx.fillStyle = hudColor;
      ctx.textAlign = 'left';
      ctx.fillText(
        `[ BAR ${String(rhythm.barNumber).padStart(3, '0')} · BEAT ${rhythm.beatInBar}/4 · ${rhythm.bpm} BPM ]`,
        64,
        46
      );

      // Beat indicator bars on top-right
      const barStartX = canvasW - 190;
      for (let b = 1; b <= 4; b++) {
        const isCurrentBeat = rhythm.beatInBar === b;
        ctx.fillStyle = isCurrentBeat
          ? b === 1
            ? '#ef4444'
            : '#facc15'
          : bgType === 'vintage-paper-ink'
          ? 'rgba(0,0,0,0.15)'
          : 'rgba(255,255,255,0.18)';
        ctx.fillRect(barStartX + (b - 1) * 32, 34, 24, isCurrentBeat ? 12 : 8);
      }
      ctx.restore();
    }
  }

  // 6. Stage Intro & Interlude HUD Cue (Rhythmic entrance cue when no lyrics are currently singing)
  if (activeLineCount === 0 && placedLyrics.length > 0) {
    const upcoming = placedLyrics
      .filter((l) => l.startMs > timeMs)
      .sort((a, b) => a.startMs - b.startMs)[0];

    if (upcoming) {
      const msUntil = upcoming.startMs - timeMs;
      if (msUntil <= 25000 && msUntil > 0) {
        const firstLineStart = placedLyrics.reduce((min, l) => Math.min(min, l.startMs), Infinity);
        const isIntro = timeMs < firstLineStart;
        const secondsUntil = (msUntil / 1000).toFixed(1);
        const pulse = Math.sin(rhythm.beatPhase * Math.PI);

        ctx.save();
        const pillW = 640;
        const pillH = 136;
        const pillX = (canvasW - pillW) / 2;
        const pillY = canvasH * 0.74;

        ctx.fillStyle = 'rgba(8, 10, 14, 0.78)';
        ctx.strokeStyle = `rgba(225, 29, 72, ${0.4 + pulse * 0.4})`;
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        const r = 24;
        ctx.moveTo(pillX + r, pillY);
        ctx.lineTo(pillX + pillW - r, pillY);
        ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
        ctx.lineTo(pillX + pillW, pillY + pillH - r);
        ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH);
        ctx.lineTo(pillX + r, pillY + pillH);
        ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
        ctx.lineTo(pillX, pillY + r);
        ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#ef4444';
        const tagText = isIntro ? 'INTRO MUSICAL' : 'INTERLUDIO';
        ctx.fillText(`${tagText}  ·  ENTRA EN ${secondsUntil}s`, canvasW / 2, pillY + 36);

        ctx.font = '600 30px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        const previewRaw = upcoming.text.trim();
        const previewText = previewRaw.length > 38 ? previewRaw.substring(0, 36) + '...' : previewRaw;
        ctx.fillText(`"${previewText}"`, canvasW / 2, pillY + 78);

        const dotCount = 4;
        const dotSpacing = 24;
        const startDotX = canvasW / 2 - ((dotCount - 1) * dotSpacing) / 2;
        const activeDotIdx = rhythm.beatInBar - 1;

        for (let d = 0; d < dotCount; d++) {
          const dotX = startDotX + d * dotSpacing;
          const dotY = pillY + 112;
          const isDotActive = d === activeDotIdx;

          ctx.beginPath();
          ctx.arc(dotX, dotY, isDotActive ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isDotActive ? '#ef4444' : 'rgba(255, 255, 255, 0.28)';
          ctx.fill();
        }

        ctx.restore();
      }
    }
  }
}

export const LyricVisualizer: React.FC<LyricVisualizerProps> = ({
  currentTime,
  lyrics,
  isPlaying,
  bpm,
  firstBeatOffset,
  beatTimes,
  background,
  waveformPeaks,
  totalDurationMs,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fontsTick, setFontsTick] = useState(0);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

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
    if (!background?.imageUrl) {
      bgImageRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = background.imageUrl;
    img.onload = () => {
      bgImageRef.current = img;
      setFontsTick((t) => t + 1);
    };
  }, [background?.imageUrl]);

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
        firstBeatOffset,
        beatTimes,
        waveformPeaks,
        totalDurationMs,
        background,
        backgroundImageElement: bgImageRef.current,
      });

      if (isPlaying) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [
    currentTime,
    lyrics,
    isPlaying,
    bpm,
    firstBeatOffset,
    beatTimes,
    background,
    waveformPeaks,
    totalDurationMs,
    fontsTick,
  ]);

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
