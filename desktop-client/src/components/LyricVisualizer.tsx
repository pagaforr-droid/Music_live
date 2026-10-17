import React, { useEffect, useRef } from 'react';
import { LyricLine, computeWordTimings } from '../types/lyrics';

export type { LyricLine } from '../types/lyrics';

interface LyricVisualizerProps {
  currentTime: number; // In seconds (from LiveConcert audio engine)
  lyrics: LyricLine[];
  isPlaying: boolean;
  settings?: any;
  bpm?: number;
  firstBeatOffset?: number;
  beatTimes?: number[];
}

export interface RenderLyricFrameOptions {
  showSafeZones?: boolean;
  selectedLineId?: string | null;
  snapGuideX?: boolean;
  snapGuideY?: boolean;
  bpm?: number;
  onUpdateBoundingBox?: (
    lineId: string,
    box: { x: number; y: number; width: number; height: number }
  ) => void;
}

// Emil Kowalski inspired spring & cubic-bezier easing helpers
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

function resolveFontFamily(fontFamily?: string): string {
  switch (fontFamily) {
    case 'Bebas Neue':
      return '"Bebas Neue", "Oswald", sans-serif';
    case 'Playfair Display':
      return '"Playfair Display", Georgia, serif';
    case 'Outfit':
      return '"Outfit", "Plus Jakarta Sans", sans-serif';
    case 'Roboto Slab':
      return '"Roboto Slab", serif';
    case 'Montserrat':
    default:
      return '"Montserrat", "Inter", sans-serif';
  }
}

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

/**
 * Master Deterministic 60fps Stage Canvas Renderer shared between LyricStudio and LiveConcert.
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

  // 1. Deep Obsidian & Stage Red Atmospheric Background
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const beatPeriodMs = 60000 / Math.max(40, Math.min(240, bpm || 120));
  const beatPulse = Math.pow(0.5 + 0.5 * Math.sin((timeMs / beatPeriodMs) * Math.PI * 2), 2);

  const centerGrad = ctx.createRadialGradient(
    canvasW * 0.5,
    canvasH * 0.52,
    10,
    canvasW * 0.5,
    canvasH * 0.52,
    canvasW * 0.68
  );
  centerGrad.addColorStop(0, `rgba(239, 68, 68, ${0.11 + beatPulse * 0.05})`);
  centerGrad.addColorStop(0.45, `rgba(25, 10, 16, ${0.22 + beatPulse * 0.04})`);
  centerGrad.addColorStop(1, '#050608');
  ctx.fillStyle = centerGrad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Subtle LED Stage Horizon Line
  const horizonGrad = ctx.createLinearGradient(0, 0, canvasW, 0);
  horizonGrad.addColorStop(0, 'rgba(239,68,68,0)');
  horizonGrad.addColorStop(0.5, `rgba(239,68,68,${0.12 + beatPulse * 0.08})`);
  horizonGrad.addColorStop(1, 'rgba(239,68,68,0)');
  ctx.fillStyle = horizonGrad;
  ctx.fillRect(0, canvasH - 6, canvasW, 6);
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

  placedLyrics.forEach((line) => {
    if (timeMs < line.startMs || timeMs > line.startMs + line.durationMs) return;

    const elapsedMs = timeMs - line.startMs;
    const progress = Math.max(0, Math.min(1, elapsedMs / Math.max(100, line.durationMs)));

    const fontFace = resolveFontFamily(line.fontFamily);
    const baseFontSize = line.fontSize || 108;
    const posX = (line.positionX !== undefined ? line.positionX : 0.5) * canvasW;
    const posY = (line.positionY !== undefined ? line.positionY : 0.5) * canvasH;
    const primaryColor = line.primaryColor || '#ffffff';
    const accentColor = line.accentColor || '#ef4444';

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${baseFontSize}px ${fontFace}`;

    const words = line.text
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) {
      ctx.restore();
      return;
    }

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
        ctx.fillText(item.word, 0, 0);

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
        ctx.fillText(item.word, 0, 0);
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
        ctx.fillText(item.word, 0, 0);
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
        ctx.lineWidth = isWordActive ? 6 : 3;
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
        ctx.fillText(item.word, 0, 0);
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
        ctx.fillText(item.word, 0, 0);

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

      // EFFECT 8: GLITCH (Digital Cut)
      else {
        ctx.translate(drawX, drawY);
        ctx.globalAlpha = lineEnvelope;
        const isGlitching = isWordActive && Math.sin(timeMs * 0.09 + item.wordIndex) > 0.55;
        if (isGlitching) {
          const shiftX = Math.sin(timeMs * 0.3) * 12;
          ctx.fillStyle = accentColor;
          ctx.fillText(item.word, shiftX, -4);
          ctx.fillStyle = '#06b6d4';
          ctx.fillText(item.word, -shiftX, 4);
        }
        ctx.fillStyle = primaryColor;
        ctx.fillText(item.word, 0, 0);
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

    ctx.restore();
  });
}

export const LyricVisualizer: React.FC<LyricVisualizerProps> = ({
  currentTime,
  lyrics,
  isPlaying,
  bpm,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const timeMs = currentTime * 1000;
      renderLyricCanvasFrame(ctx, canvas.width, canvas.height, timeMs, lyrics, { bpm });

      if (isPlaying) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [currentTime, lyrics, isPlaying, bpm]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-[#050608] relative overflow-hidden">
      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        className="w-full h-full object-contain shadow-2xl"
      />
    </div>
  );
};
