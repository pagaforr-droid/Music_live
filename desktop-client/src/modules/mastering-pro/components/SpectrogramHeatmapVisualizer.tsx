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
} from 'lucide-react';

export interface ActiveFixMarker {
  id: string;
  freqHz: number;
  gainCutDb: number;
  label: string;
  active: boolean;
}

export interface SpectrogramHeatmapProps {
  /** Nodo AnalyserNode conectado ANTES de la limpieza IA / Mastering (Original) */
  preAnalyserNode: AnalyserNode | null;
  /** Nodo AnalyserNode conectado DESPUÉS de la limpieza IA / Mastering (Procesado) */
  postAnalyserNode: AnalyserNode | null;
  /** Indica si el reproductor está corriendo */
  isPlaying: boolean;
  /** Frecuencia actual del corte Mono Maker para dibujarla en el mapa */
  monoMakerFreqHz?: number;
  /** Lista de resonancias o limpiezas activas aplicadas por la IA para marcarlas en pantalla */
  aiFixMarkers?: ActiveFixMarker[];
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
  monoMakerFreqHz = 115,
  aiFixMarkers = [
    {
      id: 'res-1',
      freqHz: 3800,
      gainCutDb: -3.2,
      label: 'De-AI Metallic Notch',
      active: true,
    },
    {
      id: 'res-2',
      freqHz: 6200,
      gainCutDb: -2.5,
      label: 'Sibilance / Aliasing Clean',
      active: true,
    },
    {
      id: 'mud-1',
      freqHz: 280,
      gainCutDb: -2.0,
      label: 'Low-Mid Mud Cut',
      active: true,
    },
  ],
  height = 310,
}) => {
  // Referencias de Canvas: 1 para el mapa de calor acumulativo, 1 para el overlay vectorial (grilla, cursores y marcadores IA)
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

  // Estado del cursor inspector (Crosshair quirúrgico)
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    freq: number;
    note: string;
    zoneLabel: string;
  } | null>(null);

  const colorLUT = useMemo(() => createThermalColorLUT(), []);

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

  // Clasificador de zona acústica para ayudar en el diagnóstico visual
  const getAcousticZoneLabel = (freq: number): string => {
    if (freq < 60) return 'Sub-Bass (Rumble / Peso)';
    if (freq < 200) return 'Bass (Golpe Bombo / Bajo)';
    if (freq < 450) return 'Low-Mids (Zona de Barro / Mud)';
    if (freq < 2000) return 'Mids (Cuerpo Vocal / Instrumentos)';
    if (freq < 6000) return 'Upper-Mids (Presencia / Resonancias IA)';
    if (freq < 10000) return 'Highs (Sibilancia / Brillo)';
    return 'Air (Aire Analógico / Aliasing Digital)';
  };

  // Inicializar fondo negro de estudio al montar
  useEffect(() => {
    const heatmapCanvas = heatmapCanvasRef.current;
    if (!heatmapCanvas) return;
    const ctx = heatmapCanvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
  }, []);

  // Bucle Principal de Renderizado del Espectrograma (60 FPS)
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
    const sampleRate =
      postAnalyserNode?.context.sampleRate ||
      preAnalyserNode?.context.sampleRate ||
      48000;
    const nyquist = sampleRate / 2;

    let demoPhase = 0;

    const renderLoop = () => {
      const width = heatmapCanvas.width;
      const cHeight = heatmapCanvas.height;

      if (!isFrozen) {
        const hasRealAudioPlaying = Boolean(
          isPlaying && (postAnalyserNode || preAnalyserNode)
        );

        if (hasRealAudioPlaying) {
          if (preAnalyserNode) preAnalyserNode.getFloatFrequencyData(preData);
          if (postAnalyserNode)
            postAnalyserNode.getFloatFrequencyData(postData);
        } else {
          // Modo Demostración Visual / Reposo Activo: muestra cómo se ve una pista con ruido de fondo, sub-bass y una resonancia en 3.8kHz siendo limpiada
          demoPhase += 0.05;
          const isPulseSilence = Math.sin(demoPhase * 0.7) < -0.35;

          for (let i = 0; i < bufferLength; i++) {
            const binFreq = (i / bufferLength) * nyquist;
            const rawNoise = -74 + Math.random() * 8;
            const musicalBody = isPulseSilence
              ? -85
              : -28 -
                Math.log2(Math.max(1, binFreq / 80)) * 4.5 +
                Math.sin(demoPhase * 2 + i * 0.05) * 8;

            const isMetallicSpike = Math.abs(binFreq - 3800) < 48 ? 22 : 0;
            const isMudBump = Math.abs(binFreq - 280) < 40 ? 10 : 0;

            preData[i] = Math.max(
              rawNoise,
              musicalBody + isMetallicSpike + isMudBump
            );

            const cleanedNoise = isPulseSilence ? -96 : -88;
            postData[i] = Math.max(
              cleanedNoise,
              musicalBody -
                (isMetallicSpike ? 2 : 0) -
                (isMudBump ? 3 : 0)
            );
          }
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
          const binIndexLow = Math.max(
            0,
            Math.min(bufferLength - 1, Math.floor(exactBin))
          );
          const binIndexHigh = Math.max(
            0,
            Math.min(bufferLength - 1, Math.ceil(exactBin))
          );
          const frac = exactBin - binIndexLow;

          let dbValue = -100;

          if (viewSource === 'post') {
            const valLow = postData[binIndexLow];
            const valHigh = postData[binIndexHigh];
            dbValue = valLow + (valHigh - valLow) * frac;
          } else if (viewSource === 'pre') {
            const valLow = preData[binIndexLow];
            const valHigh = preData[binIndexHigh];
            dbValue = valLow + (valHigh - valLow) * frac;
          } else if (viewSource === 'delta') {
            // Modo DELTA: muestra la energía parásita/resonancias atenuadas por la cadena quirúrgica
            const preVal = preData[binIndexLow];
            const postVal = postData[binIndexLow];
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
    isFrozen,
    viewSource,
    noiseFloorSensitivity,
    scrollSpeed,
    yToFreq,
    colorLUT,
  ]);

  // Dibujar el Overlay Quirúrgico (Escala de Frecuencias, Marcadores de Cirugía IA y Crosshair del Mouse)
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    const width = overlay.width;
    const cHeight = overlay.height;
    ctx.clearRect(0, 0, width, cHeight);

    // 1. Líneas de Grilla Logarítmica de Frecuencias
    ctx.font = '10px "JetBrains Mono", monospace';
    FREQ_GRID_LINES.forEach((freq) => {
      const y = Math.round(freqToY(freq, cHeight)) + 0.5;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      const label = freq >= 1000 ? `${freq / 1000}kHz` : `${freq}Hz`;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
      ctx.fillText(label, width - 48, y - 4);
    });

    // 2. Indicador del Filtro Mono-Maker (Zona Sub-Grave 100% en Fase/Mono)
    if (showAIOverlay && monoMakerFreqHz) {
      const monoY = freqToY(monoMakerFreqHz, cHeight);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, monoY);
      ctx.lineTo(width, monoY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(0, 229, 255, 0.92)';
      ctx.fillText(`MONO BASS LOCK (<${monoMakerFreqHz}Hz)`, 12, monoY - 5);
    }

    // 3. Marcadores de Cirugía IA (Dónde la IA está eliminando resonancias metálicas o barro)
    if (showAIOverlay) {
      aiFixMarkers.forEach((marker) => {
        if (!marker.active) return;
        const y = freqToY(marker.freqHz, cHeight);

        const gradient = ctx.createLinearGradient(0, y - 8, 0, y + 8);
        gradient.addColorStop(0, 'rgba(255, 107, 0, 0)');
        gradient.addColorStop(0.5, 'rgba(255, 107, 0, 0.22)');
        gradient.addColorStop(1, 'rgba(255, 107, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, y - 8, width, 16);

        ctx.strokeStyle = '#FF6B00';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);

        const sign = marker.gainCutDb > 0 ? '+' : '';
        const badgeText = `AI FIX: ${marker.label} (${marker.freqHz}Hz | ${sign}${marker.gainCutDb.toFixed(1)}dB)`;
        const textWidth = ctx.measureText(badgeText).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fillRect(10, y - 15, textWidth + 12, 14);
        ctx.strokeStyle = 'rgba(255, 107, 0, 0.7)';
        ctx.strokeRect(10, y - 15, textWidth + 12, 14);

        ctx.fillStyle = '#FF6B00';
        ctx.fillText(badgeText, 16, y - 5);
      });
    }

    // 4. Cursor Quirúrgico Interactivo (Crosshair al pasar el mouse)
    if (hoverInfo) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, hoverInfo.y);
      ctx.lineTo(width, hoverInfo.y);
      ctx.moveTo(hoverInfo.x, 0);
      ctx.lineTo(hoverInfo.x, cHeight);
      ctx.stroke();
    }
  }, [freqToY, monoMakerFreqHz, aiFixMarkers, showAIOverlay, hoverInfo]);

  // Manejador del Mouse para inspeccionar frecuencias con precisión de Hz
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = e.currentTarget.width / rect.width;
    const scaleY = e.currentTarget.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const freq = Math.round(yToFreq(y, e.currentTarget.height));

    setHoverInfo({
      x,
      y,
      freq,
      note: freqToMusicalNote(freq),
      zoneLabel: getAcousticZoneLabel(freq),
    });
  };

  return (
    <div className="w-full rounded-2xl bg-slate-950 border border-slate-800/90 shadow-[0_14px_40px_rgba(0,0,0,0.65)] overflow-hidden select-none">
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
                4096-FFT LOG
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Auditoría visual de piso de ruido, sangrado de stems y resonancias metálicas de IA
            </p>
          </div>
        </div>

        {/* Selector de Vista: Original (Con Ruido) vs Post-IA (Limpio) vs Delta (Solo lo eliminado) */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setViewSource('pre')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
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
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
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
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
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
        <div className="flex flex-wrap items-center gap-2.5">
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
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 hover:text-white flex items-center gap-1"
            title="Velocidad de barrido del espectrograma"
          >
            <Gauge className="w-3 h-3 text-[#00E5FF]" />
            <span>{scrollSpeed}x</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAIOverlay(!showAIOverlay)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
              showAIOverlay
                ? 'bg-[#FF6B00]/15 border-[#FF6B00]/50 text-[#FF6B00]'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
            title="Mostrar/Ocultar marcadores de cirugía IA"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Rayos X IA</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFrozen(!isFrozen)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
              isFrozen
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
            <span>{isFrozen ? 'Reanudar' : 'Congelar'}</span>
          </button>
        </div>
      </div>

      {/* Lienzo Dual (Heatmap en vivo + Overlay Quirúrgico) */}
      <div className="relative w-full" style={{ height: `${height}px` }}>
        <canvas
          ref={heatmapCanvasRef}
          width={1100}
          height={height}
          className="w-full h-full block"
        />
        <canvas
          ref={overlayCanvasRef}
          width={1100}
          height={height}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          className="absolute inset-0 w-full h-full cursor-crosshair"
        />

        {/* Inspector Quirúrgico Flotante al mover el mouse */}
        {hoverInfo && (
          <div
            className="pointer-events-none absolute z-20 px-3 py-1.5 rounded-lg bg-slate-950/95 border border-[#00E5FF]/50 shadow-xl text-xs flex items-center gap-3"
            style={{
              left: `${Math.min(68, (hoverInfo.x / 1100) * 100)}%`,
              top: `${Math.max(8, (hoverInfo.y / height) * 100 - 12)}%`,
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
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <span className="text-slate-400 text-[10px] block">NOTA</span>
              <span className="font-mono font-bold text-[#FF6B00] text-sm">
                {hoverInfo.note}
              </span>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <span className="text-slate-400 text-[10px] block">
                DIAGNÓSTICO DE ZONA
              </span>
              <span className="text-slate-200 font-medium text-[11px]">
                {hoverInfo.zoneLabel}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Leyenda Térmica de Decibelios en el Pie del Visualizador */}
      <div className="px-4 py-2 bg-slate-900/95 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold text-slate-300 flex items-center gap-1">
            <ZoomIn className="w-3.5 h-3.5 text-[#FF6B00]" />
            Guía de Lectura Rápida:
          </span>
          <span>
            • <strong>Línea horizontal naranja continua:</strong> Resonancia metálica / IA
          </span>
          <span>
            • <strong>Neblina azul en silencios:</strong> Ruido de fondo / Bleed
          </span>
          <span>
            • <strong>Fondo Negro Puro:</strong> Silencio limpio de estudio
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
