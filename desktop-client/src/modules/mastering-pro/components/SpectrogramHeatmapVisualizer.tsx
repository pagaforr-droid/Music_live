import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  Eye,
  Sparkles,
  Sliders,
  Activity,
  ZoomIn,
  Pause,
  Play,
  Gauge,
  Crosshair,
  Radio,
} from 'lucide-react';
import type { SpectralResonanceNode } from '../types/mastering.types';

export interface ActiveFixMarker {
  id: string;
  freqHz: number;
  gainCutDb: number;
  label: string;
  active: boolean;
  q?: number;
  kind?: 'eq' | 'line-killer';
}

export interface SpectrogramHeatmapProps {
  /** Nodo AnalyserNode conectado ANTES de la limpieza IA / Mastering (Original) */
  preAnalyserNode: AnalyserNode | null;
  /** Nodo AnalyserNode conectado DESPUÉS de la limpieza IA / Mastering (Procesado) */
  postAnalyserNode: AnalyserNode | null;
  /** Indica si el reproductor está corriendo */
  isPlaying: boolean;
  /** Indica si hay una pista real cargada en el motor (evita sobreescribir con la demo al pausar) */
  hasAudioLoaded?: boolean;
  /** Frecuencia actual del corte Mono Maker para dibujarla en el mapa */
  monoMakerFreqHz?: number;
  /** Lista de resonancias o limpiezas activas aplicadas por la IA para marcarlas en pantalla */
  aiFixMarkers?: ActiveFixMarker[];
  /** Lista de filtros Notch quirúrgicos Q=12 (Line Killer) activos */
  resonanceNotches?: SpectralResonanceNode[];
  /** Callback al hacer clic sobre una línea horizontal en el espectrograma para agregar/quitar un Notch Q=12 */
  onToggleResonanceNotchAtFreq?: (freqHz: number) => void;
  /** Altura del visualizador en píxeles */
  height?: number;
}

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const FREQ_GRID_LINES = [
  30, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

/**
 * Convierte una frecuencia en Hz a su nota musical más cercana (ej. 440Hz -> A4)
 */
function freqToMusicalNote(freq: number): string {
  if (freq <= 0) return '-';
  const noteStrings = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];
  const pitch = 12 * Math.log2(freq / 440) + 69;
  const roundedPitch = Math.round(pitch);
  const noteIndex = ((roundedPitch % 12) + 12) % 12;
  const octave = Math.floor(roundedPitch / 12) - 1;
  return `${noteStrings[noteIndex]}${octave}`;
}

/**
 * Interpolación Cúbica Catmull-Rom de 4 puntos entre bins FFT adyacentes.
 * Elimina las líneas horizontales escalonadas ("efecto ladrillo") en frecuencias bajas/medias.
 */
function sampleSpectrumCatmullRom(
  bins: Float32Array,
  exactBin: number,
  bufferLength: number
): number {
  const maxIdx = bufferLength - 1;
  const i1 = Math.max(0, Math.min(maxIdx, Math.floor(exactBin)));
  const i0 = Math.max(0, i1 - 1);
  const i2 = Math.min(maxIdx, i1 + 1);
  const i3 = Math.min(maxIdx, i1 + 2);

  const t = exactBin - i1;
  const t2 = t * t;
  const t3 = t2 * t;

  const p0 = bins[i0];
  const p1 = bins[i1];
  const p2 = bins[i2];
  const p3 = bins[i3];

  const val =
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);

  // Evitar overshoot fuera del rango local de los bins vecinos
  const localMin = Math.min(p0, p1, p2, p3);
  const localMax = Math.max(p0, p1, p2, p3);
  return Math.max(localMin, Math.min(localMax, val));
}

/**
 * Pre-calcula una tabla de color (LUT) de 256 niveles estilo iZotope RX + Estética Dark/Cyan/Orange
 * 0 = Silencio absoluto (-90dB) -> Negro profundo (#020617)
 * 64 = Ruido de fondo bajo (-65dB) -> Azul Marino / Violeta oscuro
 * 128 = Cuerpo musical medio (-40dB) -> Azul Cian (#00E5FF)
 * 192 = Energía alta / Resonancia (-18dB) -> Naranja Neón (#FF6B00)
 * 255 = Pico máximo (0dB) -> Blanco / Amarillo incandescente (#FFFFFF)
 */
function createThermalColorLUT(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const stops = [
    { pos: 0, r: 2, g: 6, b: 23 }, // #020617 (Fondo negro/slate-950)
    { pos: 45, r: 15, g: 23, b: 75 }, // Azul nocturno (Piso de ruido / Hiss)
    { pos: 95, r: 0, g: 110, b: 165 }, // Azul profundo
    { pos: 145, r: 0, g: 229, b: 255 }, // #00E5FF (Cian Neón - Presencia limpia)
    { pos: 195, r: 255, g: 107, b: 0 }, // #FF6B00 (Naranja Neón - Energía fuerte / Resonancias)
    { pos: 235, r: 255, g: 200, b: 40 }, // Ámbar brillante
    { pos: 255, r: 255, g: 255, b: 255 }, // Blanco puro (Transientes / Picos)
  ];

  for (let i = 0; i < 256; i++) {
    let startStop = stops[0];
    let endStop = stops[stops.length - 1];

    for (let s = 0; s < stops.length - 1; s++) {
      if (i >= stops[s].pos && i <= stops[s + 1].pos) {
        startStop = stops[s];
        endStop = stops[s + 1];
        break;
      }
    }

    const range = endStop.pos - startStop.pos || 1;
    const ratio = (i - startStop.pos) / range;

    lut[i * 4 + 0] = Math.round(
      startStop.r + (endStop.r - startStop.r) * ratio
    );
    lut[i * 4 + 1] = Math.round(
      startStop.g + (endStop.g - startStop.g) * ratio
    );
    lut[i * 4 + 2] = Math.round(
      startStop.b + (endStop.b - startStop.b) * ratio
    );
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

export const SpectrogramHeatmapVisualizer: React.FC<
  SpectrogramHeatmapProps
> = ({
  preAnalyserNode,
  postAnalyserNode,
  isPlaying,
  hasAudioLoaded = true,
  monoMakerFreqHz = 115,
  aiFixMarkers = [],
  resonanceNotches = [],
  onToggleResonanceNotchAtFreq,
  height = 310,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Controles de visualización para el ingeniero
  const [viewSource, setViewSource] = useState<'post' | 'pre' | 'delta'>(
    'post'
  );
  const [noiseFloorSensitivity, setNoiseFloorSensitivity] =
    useState<number>(-82); // -95dB a -55dB (Para revelar ruido oculto)
  const [scrollSpeed, setScrollSpeed] = useState<number>(2); // Píxeles por frame
  const [showAIOverlay, setShowAIOverlay] = useState<boolean>(true);
  const [isFrozen, setIsFrozen] = useState<boolean>(false);
  const [demoSignalWhenIdle, setDemoSignalWhenIdle] = useState<boolean>(false);
  const [canvasCssWidth, setCanvasCssWidth] = useState<number>(1100);

  // Estado del cursor inspector (Crosshair quirúrgico en coordenadas CSS)
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    freq: number;
    note: string;
    zoneLabel: string;
    nearNotch?: SpectralResonanceNode;
  } | null>(null);

  const colorLUT = useMemo(() => createThermalColorLUT(), []);

  // Combinar marcadores de EQ con los filtros Line Killer Q=12 activos
  const combinedMarkers = useMemo<ActiveFixMarker[]>(() => {
    const eqMarkers: ActiveFixMarker[] = aiFixMarkers.map((m) => ({
      ...m,
      kind: 'eq',
    }));
    const notchMarkers: ActiveFixMarker[] = resonanceNotches
      .filter((n) => n.enabled)
      .map((n) => ({
        id: n.id,
        freqHz: n.freqHz,
        gainCutDb: n.gainCutDb,
        label: n.label,
        active: n.enabled,
        q: n.q,
        kind: 'line-killer',
      }));
    return [...notchMarkers, ...eqMarkers];
  }, [aiFixMarkers, resonanceNotches]);

  // Conversión Matemática: Posición Y (0 arriba -> height abajo) <---> Frecuencia Logarítmica (20Hz abajo -> 20kHz arriba)
  const yToFreq = useCallback((y: number, canvasHeight: number): number => {
    const normalizedY = 1 - Math.max(0, Math.min(1, y / canvasHeight));
    const minLog = Math.log10(MIN_FREQ);
    const maxLog = Math.log10(MAX_FREQ);
    return Math.pow(10, minLog + normalizedY * (maxLog - minLog));
  }, []);

  const freqToY = useCallback((freq: number, canvasHeight: number): number => {
    const clampedFreq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq));
    const minLog = Math.log10(MIN_FREQ);
    const maxLog = Math.log10(MAX_FREQ);
    const normalized = (Math.log10(clampedFreq) - minLog) / (maxLog - minLog);
    return canvasHeight * (1 - normalized);
  }, []);

  const getAcousticZoneLabel = (freq: number): string => {
    if (freq < 60) return 'Sub-Bass (Rumble / Peso)';
    if (freq < 200) return 'Bass (Golpe Bombo / Bajo)';
    if (freq < 450) return 'Low-Mids (Zona de Barro / Mud)';
    if (freq < 2000) return 'Mids (Cuerpo Vocal / Instrumentos)';
    if (freq < 6000) return 'Upper-Mids (Presencia / Resonancias IA)';
    if (freq < 10000) return 'Highs (Sibilancia / Brillo)';
    return 'Air (Aire Analógico / Aliasing Digital)';
  };

  // Medir ancho real del contenedor para renderizado HiDPI sin estiramiento borroso
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const w = Math.max(640, Math.round(el.clientWidth));
      setCanvasCssWidth(w);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Inicializar fondo negro de estudio al montar o cambiar altura
  useEffect(() => {
    const heatmapCanvas = heatmapCanvasRef.current;
    if (!heatmapCanvas) return;
    const ctx = heatmapCanvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
  }, [height]);

  // Bucle Principal de Renderizado del Espectrograma (60 FPS con Interpolación Cúbica Catmull-Rom)
  useEffect(() => {
    const heatmapCanvas = heatmapCanvasRef.current;
    if (!heatmapCanvas) return;
    const ctx = heatmapCanvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const bufferLength =
      postAnalyserNode?.frequencyBinCount ||
      preAnalyserNode?.frequencyBinCount ||
      2048;
    const preData: Float32Array<ArrayBuffer> = new Float32Array(bufferLength);
    const postData: Float32Array<ArrayBuffer> = new Float32Array(bufferLength);
    const smoothedPre: Float32Array<ArrayBuffer> = new Float32Array(
      bufferLength
    ).fill(-95);
    const smoothedPost: Float32Array<ArrayBuffer> = new Float32Array(
      bufferLength
    ).fill(-95);

    const sampleRate =
      postAnalyserNode?.context.sampleRate ||
      preAnalyserNode?.context.sampleRate ||
      48000;
    const nyquist = sampleRate / 2;

    let demoPhase = 0;

    const renderLoop = () => {
      const width = heatmapCanvas.width;
      const cHeight = heatmapCanvas.height;

      const hasRealAudioPlaying = Boolean(
        isPlaying && (postAnalyserNode || preAnalyserNode)
      );
      // Auto-Freeze inteligente: si hay audio real cargado pero está en Pausa (y el usuario no activó Test Demo),
      // mantenemos el espectrograma real congelado en pantalla en vez de sobreescribirlo con barras sintéticas.
      const shouldAdvanceWaterfall =
        !isFrozen &&
        (hasRealAudioPlaying || !hasAudioLoaded || demoSignalWhenIdle);

      if (shouldAdvanceWaterfall) {
        if (hasRealAudioPlaying) {
          if (preAnalyserNode) preAnalyserNode.getFloatFrequencyData(preData);
          if (postAnalyserNode)
            postAnalyserNode.getFloatFrequencyData(postData);
        } else {
          // Generador de Test Sintético (solo cuando no hay pista cargada o el usuario activa "Test Señal")
          demoPhase += 0.05;
          const isPulseSilence = Math.sin(demoPhase * 0.7) < -0.35;

          for (let i = 0; i < bufferLength; i++) {
            const binFreq = (i / bufferLength) * nyquist;
            const rawNoise = -76 + Math.random() * 6;
            const musicalBody = isPulseSilence
              ? -86
              : -28 -
                Math.log2(Math.max(1, binFreq / 80)) * 4.5 +
                Math.sin(demoPhase * 2 + i * 0.05) * 8;

            const isMetallicSpike = Math.abs(binFreq - 3850) < 42 ? 18 : 0;
            const isMudBump = Math.abs(binFreq - 285) < 36 ? 9 : 0;

            preData[i] = Math.max(
              rawNoise,
              musicalBody + isMetallicSpike + isMudBump
            );

            const cleanedNoise = isPulseSilence ? -96 : -89;
            postData[i] = Math.max(
              cleanedNoise,
              musicalBody -
                (isMetallicSpike ? 3 : 0) -
                (isMudBump ? 3 : 0)
            );
          }
        }

        // Suavizado temporal ligero para eliminar parpadeo digital sin perder transientes
        for (let i = 0; i < bufferLength; i++) {
          const rawPre = Number.isFinite(preData[i]) ? preData[i] : -100;
          const rawPost = Number.isFinite(postData[i]) ? postData[i] : -100;
          smoothedPre[i] = smoothedPre[i] * 0.32 + rawPre * 0.68;
          smoothedPost[i] = smoothedPost[i] * 0.32 + rawPost * 0.68;
        }

        // Desplazar el canvas actual hacia la izquierda (Zero-Allocation Waterfall Scroll)
        ctx.drawImage(
          heatmapCanvas,
          scrollSpeed,
          0,
          width - scrollSpeed,
          cHeight,
          0,
          0,
          width - scrollSpeed,
          cHeight
        );

        // Crear la nueva columna vertical de píxeles en el borde derecho
        const columnImage = ctx.createImageData(scrollSpeed, cHeight);
        const pixels = columnImage.data;

        const minDb = noiseFloorSensitivity;
        const maxDb = -3;
        const dbRange = maxDb - minDb;

        for (let y = 0; y < cHeight; y++) {
          const freq = yToFreq(y, cHeight);
          const exactBin = (freq / nyquist) * bufferLength;

          let dbValue = -100;

          if (viewSource === 'post') {
            dbValue = sampleSpectrumCatmullRom(
              smoothedPost,
              exactBin,
              bufferLength
            );
          } else if (viewSource === 'pre') {
            dbValue = sampleSpectrumCatmullRom(
              smoothedPre,
              exactBin,
              bufferLength
            );
          } else if (viewSource === 'delta') {
            const preVal = sampleSpectrumCatmullRom(
              smoothedPre,
              exactBin,
              bufferLength
            );
            const postVal = sampleSpectrumCatmullRom(
              smoothedPost,
              exactBin,
              bufferLength
            );
            const removedEnergy = Math.max(0, Math.abs(preVal - postVal));
            dbValue = minDb + removedEnergy * 4.2;
          }

          const normalized = Math.max(
            0,
            Math.min(1, (dbValue - minDb) / dbRange)
          );
          const colorIndex = Math.floor(normalized * 255) * 4;

          const r = colorLUT[colorIndex];
          const g = colorLUT[colorIndex + 1];
          const b = colorLUT[colorIndex + 2];

          for (let xOffset = 0; xOffset < scrollSpeed; xOffset++) {
            const pixelPos = (y * scrollSpeed + xOffset) * 4;
            pixels[pixelPos] = r;
            pixels[pixelPos + 1] = g;
            pixels[pixelPos + 2] = b;
            pixels[pixelPos + 3] = 255;
          }
        }

        ctx.putImageData(columnImage, width - scrollSpeed, 0);
      }

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [
    preAnalyserNode,
    postAnalyserNode,
    isPlaying,
    hasAudioLoaded,
    isFrozen,
    demoSignalWhenIdle,
    viewSource,
    noiseFloorSensitivity,
    scrollSpeed,
    yToFreq,
    colorLUT,
  ]);

  // Dibujar el Overlay Quirúrgico en HiDPI (Retina) con Pastillas Laterales Sin Colisión (Estilo FabFilter Pro-Q3 / RX 11)
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetW = Math.round(canvasCssWidth * dpr);
    const targetH = Math.round(height * dpr);

    if (overlay.width !== targetW || overlay.height !== targetH) {
      overlay.width = targetW;
      overlay.height = targetH;
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    const width = canvasCssWidth;
    const cHeight = height;
    ctx.clearRect(0, 0, width, cHeight);

    // 1. Líneas de Grilla Logarítmica de Frecuencias (Ultra sutiles para no competir con el audio)
    ctx.font = '600 10px "JetBrains Mono", monospace';
    FREQ_GRID_LINES.forEach((freq) => {
      const y = Math.round(freqToY(freq, cHeight)) + 0.5;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.11)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      const label = freq >= 1000 ? `${freq / 1000}kHz` : `${freq}Hz`;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.72)';
      ctx.fillText(label, width - 46, y - 4);
    });

    // 2. Indicador del Filtro Mono-Maker (Zona Sub-Grave 100% en Fase/Mono)
    if (showAIOverlay && monoMakerFreqHz) {
      const monoY = Math.round(freqToY(monoMakerFreqHz, cHeight)) + 0.5;
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, monoY);
      ctx.lineTo(width, monoY);
      ctx.stroke();
      ctx.setLineDash([]);

      const monoLabel = `MONO LOCK <${monoMakerFreqHz}Hz`;
      const mw = ctx.measureText(monoLabel).width;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
      ctx.fillRect(width - mw - 66, monoY - 14, mw + 10, 13);
      ctx.fillStyle = 'rgba(0, 229, 255, 0.92)';
      ctx.fillText(monoLabel, width - mw - 61, monoY - 4);
    }

    // 3. Pastillas Quirúrgicas Laterales (Sin bandas naranjas anchas que manchen el espectrograma)
    if (showAIOverlay && combinedMarkers.length > 0) {
      // Ordenar de arriba a abajo (mayor frecuencia a menor frecuencia) y evitar colisiones verticales
      const activeItems = combinedMarkers
        .filter((m) => m.active)
        .map((m) => ({
          ...m,
          trueY: freqToY(m.freqHz, cHeight),
          pillY: freqToY(m.freqHz, cHeight),
        }))
        .sort((a, b) => a.trueY - b.trueY);

      const minGapPx = 18;
      for (let i = 1; i < activeItems.length; i++) {
        if (activeItems[i].pillY - activeItems[i - 1].pillY < minGapPx) {
          activeItems[i].pillY = Math.min(
            cHeight - 10,
            activeItems[i - 1].pillY + minGapPx
          );
        }
      }

      activeItems.forEach((marker) => {
        const isLineKiller = marker.kind === 'line-killer';
        const isBoost = marker.gainCutDb > 0;

        // Paleta Semántica Pro-Q3:
        // Rose (#F43F5E) = Notch Q=12 Line Killer | Esmeralda (#10B981) = Corte EQ | Cian (#00E5FF) = Realce EQ
        const strokeColor = isLineKiller
          ? '#F43F5E'
          : isBoost
          ? '#00E5FF'
          : '#10B981';

        const isHoveredNear =
          hoverInfo !== null && Math.abs(hoverInfo.y - marker.trueY) <= 16;

        // Solo trazamos la guía horizontal completa cuando el usuario acerca el mouse a esa frecuencia
        // o una micro-línea punteada muy sutil si es un Notch Line Killer activo
        if (isHoveredNear || isLineKiller) {
          ctx.strokeStyle = isHoveredNear
            ? strokeColor
            : 'rgba(244, 63, 94, 0.28)';
          ctx.lineWidth = isHoveredNear ? 1.2 : 0.85;
          ctx.setLineDash(isLineKiller ? [2, 4] : [4, 4]);
          ctx.beginPath();
          ctx.moveTo(0, marker.trueY);
          ctx.lineTo(width, marker.trueY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Conector corto en el margen izquierdo desde la frecuencia exacta (trueY) hasta la pastilla (pillY)
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(0, marker.trueY);
        ctx.lineTo(7, marker.trueY);
        ctx.lineTo(12, marker.pillY);
        ctx.stroke();

        // Punto nodo en el eje Y izquierdo
        ctx.fillStyle = strokeColor;
        ctx.beginPath();
        ctx.arc(3.5, marker.trueY, 2.5, 0, Math.PI * 2);
        ctx.fill();

        const sign = marker.gainCutDb > 0 ? '+' : '';
        const prefix = isLineKiller ? 'NOTCH Q12' : isBoost ? 'BOOST' : 'CUT';
        const badgeText = `${prefix}: ${marker.label} (${marker.freqHz}Hz | ${sign}${marker.gainCutDb.toFixed(1)}dB)`;
        const textWidth = ctx.measureText(badgeText).width;

        const pillX = 12;
        const pillH = 15;
        const pillTop = Math.max(2, Math.min(cHeight - pillH - 2, marker.pillY - pillH / 2));

        ctx.fillStyle = 'rgba(2, 6, 23, 0.90)';
        ctx.fillRect(pillX, pillTop, textWidth + 12, pillH);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isHoveredNear ? 1.3 : 0.9;
        ctx.strokeRect(pillX, pillTop, textWidth + 12, pillH);

        ctx.fillStyle = strokeColor;
        ctx.fillText(badgeText, pillX + 6, pillTop + 10.5);
      });
    }

    // 4. Cursor Quirúrgico Interactivo (Crosshair al pasar el mouse)
    if (hoverInfo) {
      ctx.strokeStyle = hoverInfo.nearNotch
        ? 'rgba(244, 63, 94, 0.85)'
        : 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, hoverInfo.y);
      ctx.lineTo(width, hoverInfo.y);
      ctx.moveTo(hoverInfo.x, 0);
      ctx.lineTo(hoverInfo.x, cHeight);
      ctx.stroke();
    }

    ctx.restore();
  }, [
    freqToY,
    monoMakerFreqHz,
    combinedMarkers,
    showAIOverlay,
    hoverInfo,
    canvasCssWidth,
    height,
  ]);

  // Manejador del Mouse para inspeccionar frecuencias con precisión de Hz
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const freq = Math.round(yToFreq(y, rect.height));

    const nearNotch = resonanceNotches.find(
      (n) => n.enabled && Math.abs(n.freqHz - freq) / Math.max(20, n.freqHz) < 0.045
    );

    setHoverInfo({
      x,
      y,
      freq,
      note: freqToMusicalNote(freq),
      zoneLabel: getAcousticZoneLabel(freq),
      nearNotch,
    });
  };

  const handleCanvasClick = () => {
    if (!hoverInfo || !onToggleResonanceNotchAtFreq) return;
    onToggleResonanceNotchAtFreq(hoverInfo.freq);
  };

  const isAutoPausedOnRealTrack =
    hasAudioLoaded && !isPlaying && !demoSignalWhenIdle && !isFrozen;

  return (
    <div
      ref={containerRef}
      className="w-full rounded-2xl bg-slate-950 border border-slate-800/90 shadow-[0_14px_40px_rgba(0,0,0,0.65)] overflow-hidden select-none"
    >
      {/* Barra de Herramientas del Espectrograma RX */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#FF6B00]/15 border border-[#FF6B00]/40 text-[#FF6B00]">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
              RX Spectral Heatmap (Rayos X 3D)
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-cyan-500/15 text-[#00E5FF] border border-cyan-500/30 font-mono">
                4096-FFT CATMULL-ROM
              </span>
              {resonanceNotches.filter((n) => n.enabled).length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-rose-500/15 text-rose-400 border border-rose-500/40 font-mono">
                  {resonanceNotches.filter((n) => n.enabled).length} LINE KILLER Q=12
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-400">
              Auditoría visual de piso de ruido y resonancias ·{' '}
              <span className="text-[#00E5FF] font-medium">
                Haz clic en cualquier línea horizontal para insertar/quitar un Notch Q=12
              </span>
            </p>
          </div>
        </div>

        {/* Selector de Vista: Original (Con Ruido) vs Post-IA (Limpio) vs Delta (Solo lo eliminado) */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setViewSource('pre')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
              viewSource === 'pre'
                ? 'bg-slate-800 text-amber-400 border border-amber-500/40 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            1. Original (Pre)
          </button>
          <button
            type="button"
            onClick={() => setViewSource('post')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
              viewSource === 'post'
                ? 'bg-[#00E5FF]/15 text-[#00E5FF] border border-[#00E5FF]/40 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            2. Master Limpio (Post)
          </button>
          <button
            type="button"
            onClick={() => setViewSource('delta')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 cursor-pointer ${
              viewSource === 'delta'
                ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/50 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Muestra únicamente la suciedad, ruido y resonancias que la cirugía DSP está modificando"
          >
            <Sparkles className="w-3 h-3" />
            3. Delta (Diferencia)
          </button>
        </div>

        {/* Controles de Sensibilidad de Ruido, Velocidad y Congelamiento */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Sliders className="w-3.5 h-3.5 text-[#00E5FF]" />
            <span className="text-[11px] text-slate-400">Piso:</span>
            <input
              type="range"
              min={-95}
              max={-55}
              step={1}
              value={noiseFloorSensitivity}
              onChange={(e) => setNoiseFloorSensitivity(Number(e.target.value))}
              className="w-20 accent-[#FF6B00] cursor-pointer"
            />
            <span className="font-mono text-[11px] text-[#00E5FF] w-11">
              {noiseFloorSensitivity}dB
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              setScrollSpeed((prev) => (prev === 1 ? 2 : prev === 2 ? 4 : 1))
            }
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
            title="Velocidad de barrido del espectrograma"
          >
            <Gauge className="w-3 h-3 text-[#00E5FF]" />
            <span>{scrollSpeed}x</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAIOverlay(!showAIOverlay)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors cursor-pointer ${
              showAIOverlay
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
            title="Mostrar/Ocultar pastillas quirúrgicas laterales de EQ y Line Killer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Nodos IA</span>
          </button>

          <button
            type="button"
            onClick={() => setDemoSignalWhenIdle((prev) => !prev)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors cursor-pointer ${
              demoSignalWhenIdle
                ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Generar señal sintética de prueba cuando el reproductor está en pausa"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Test Señal</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFrozen(!isFrozen)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors cursor-pointer ${
              isFrozen || isAutoPausedOnRealTrack
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
            title="Congelar imagen para inspeccionar resonancias"
          >
            {isFrozen ? (
              <Play className="w-3.5 h-3.5" />
            ) : (
              <Pause className="w-3.5 h-3.5" />
            )}
            <span>
              {isFrozen
                ? 'Reanudar'
                : isAutoPausedOnRealTrack
                ? 'En Pausa (Auto-Freeze)'
                : 'Congelar'}
            </span>
          </button>
        </div>
      </div>

      {/* Lienzo Dual (Heatmap en vivo + Overlay Quirúrgico HiDPI) */}
      <div className="relative w-full" style={{ height: `${height}px` }}>
        <canvas
          ref={heatmapCanvasRef}
          width={1100}
          height={height}
          className="w-full h-full block"
        />
        <canvas
          ref={overlayCanvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          onClick={handleCanvasClick}
          className="absolute inset-0 w-full h-full cursor-crosshair"
        />

        {/* Inspector Quirúrgico Flotante al mover el mouse */}
        {hoverInfo && (
          <div
            className="pointer-events-none absolute z-20 px-3 py-2 rounded-xl bg-slate-950/95 border border-[#00E5FF]/50 shadow-2xl text-xs flex items-center gap-3 backdrop-blur-md"
            style={{
              left: `${Math.min(62, (hoverInfo.x / Math.max(1, canvasCssWidth)) * 100)}%`,
              top: `${Math.max(6, (hoverInfo.y / height) * 100 - 15)}%`,
            }}
          >
            <div>
              <span className="text-slate-400 text-[10px] block">
                FRECUENCIA
              </span>
              <span className="font-mono font-bold text-[#00E5FF] text-sm">
                {hoverInfo.freq} Hz
              </span>
            </div>
            <div className="h-7 w-px bg-slate-800" />
            <div>
              <span className="text-slate-400 text-[10px] block">NOTA</span>
              <span className="font-mono font-bold text-[#FF6B00] text-sm">
                {hoverInfo.note}
              </span>
            </div>
            <div className="h-7 w-px bg-slate-800" />
            <div>
              <span className="text-slate-400 text-[10px] block">
                DIAGNÓSTICO DE ZONA
              </span>
              <span className="text-slate-200 font-medium text-[11px] block">
                {hoverInfo.zoneLabel}
              </span>
              {onToggleResonanceNotchAtFreq && (
                <span className="text-[10px] font-mono text-rose-400 flex items-center gap-1 mt-0.5">
                  <Crosshair className="w-2.5 h-2.5" />
                  {hoverInfo.nearNotch
                    ? `Clic: Quitar Line Killer (${hoverInfo.nearNotch.freqHz}Hz)`
                    : `Clic: Insertar Line Killer Q=12 @ ${hoverInfo.freq}Hz`}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Leyenda Térmica de Decibelios en el Pie del Visualizador */}
      <div className="px-4 py-2 bg-slate-900/95 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold text-slate-300 flex items-center gap-1">
            <ZoomIn className="w-3.5 h-3.5 text-[#FF6B00]" />
            Código Quirúrgico:
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
            <strong>NOTCH Q12:</strong> Supresor de Línea Horizontal
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            <strong>CUT:</strong> Limpieza de Barro/Dureza
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#00E5FF] inline-block" />
            <strong>BOOST:</strong> Realce Armónico/Aire
          </span>
        </div>

        {/* Escala de Color de Intensidad */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px]">-90dB (Silencio)</span>
          <div
            className="w-36 h-2.5 rounded-full border border-slate-700"
            style={{
              background:
                'linear-gradient(90deg, #020617 0%, #0f174b 20%, #006ea5 40%, #00E5FF 60%, #FF6B00 82%, #ffffff 100%)',
            }}
          />
          <span className="font-mono text-[10px] text-white font-semibold">
            0dB (Pico)
          </span>
        </div>
      </div>
    </div>
  );
};

export default SpectrogramHeatmapVisualizer;
