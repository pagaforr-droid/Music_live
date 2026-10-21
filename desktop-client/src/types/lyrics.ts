export interface LyricWordTiming {
  word: string;
  startOffsetMs: number; // Offset in ms from line.startMs
  durationMs: number;
}

export type LyricEffectType =
  | 'capcut-karaoke'
  | 'kinetic'
  | 'smooth-blur'
  | 'neon-stage'
  | 'stacked-impact'
  | 'chromatic-glow'
  | 'gradient-wipe'
  | 'glitch'
  | 'double-exposure'
  | 'write-on'
  | 'liquid'
  // Brutal FX (HyperFrames motion rules ported to the deterministic canvas renderer)
  | 'beat-slam'
  | 'decrypt'
  | 'depth-extrude'
  | 'waterfall'
  | 'luxe-chrome'
  | 'crash-zoom'
  | 'font-shuffle';

export type LyricFontFamily =
  | 'Montserrat'
  | 'Bebas Neue'
  | 'Outfit'
  | 'Playfair Display'
  | 'Roboto Slab'
  | 'Nexa Rust'
  | 'Northwell'
  // Luxury typography system
  | 'Anton'
  | 'Archivo Black'
  | 'Unbounded'
  | 'Bodoni Moda'
  | 'Fraunces'
  | 'Instrument Serif'
  | 'DM Serif Display'
  | 'Italiana'
  | 'Syncopate'
  | 'Space Grotesk'
  | 'Space Mono'
  | 'Monoton'
  | 'Kaushan Script'
  | 'Yellowtail';

export type LyricTextCase = 'upper' | 'title' | 'lower';

export interface LyricLine {
  id: string;
  text: string;
  sectionTag?: string;
  placed?: boolean; // undefined or true = placed on timeline; false = in lyric pool waiting to be dragged/tapped
  startMs: number;
  durationMs: number;
  effect: LyricEffectType;
  fontFamily: LyricFontFamily;
  fontSize?: number; // Base size in 1920x1080 canvas (default 110)
  positionX?: number; // Normalized 0.0 - 1.0 (default 0.5)
  positionY?: number; // Normalized 0.0 - 1.0 (default 0.5)
  primaryColor?: string; // Default '#ffffff'
  accentColor?: string; // Default '#ef4444' (TANDU Stage Red)
  words?: LyricWordTiming[];
  // Luxury typography controls (all optional — undefined reproduces the classic render)
  letterSpacing?: number; // Tracking in em (default: font preset tracking)
  textCase?: LyricTextCase; // Applied at draw time only (default 'upper')
  strokeWidth?: number; // Outline thickness in px at 1080p (default 0)
  fxIntensity?: number; // "Brutalidad" multiplier 0..2 (default 1)
  ghostText?: boolean; // Giant drifting ghost word behind the line
}

export interface LyricEffectPreset {
  id: LyricEffectType;
  name: string;
  badge: string;
  description: string;
  previewGradient: string;
  defaultAccent: string;
  group?: 'classic' | 'brutal';
}

export const LYRIC_EFFECT_PRESETS: LyricEffectPreset[] = [
  {
    id: 'capcut-karaoke',
    name: 'CapCut Karaoke Pro',
    badge: 'TOP SYNC',
    description: 'Resaltado activo palabra por palabra con física elástica y llenado de color.',
    previewGradient: 'from-red-600/40 via-red-500/20 to-black',
    defaultAccent: '#ef4444',
  },
  {
    id: 'kinetic',
    name: 'Kinetic Stage Slam',
    badge: 'IMPACTO',
    description: 'Entrada explosiva con rebote spring por palabra, ideal para coros potentes.',
    previewGradient: 'from-rose-600/35 via-orange-500/15 to-black',
    defaultAccent: '#f43f5e',
  },
  {
    id: 'smooth-blur',
    name: 'Cinematic Blur Reveal',
    badge: 'WORSHIP',
    description: 'Aparición etérea con desenfoque óptico progresivo y suavizado cinematográfico.',
    previewGradient: 'from-slate-500/30 via-zinc-700/20 to-black',
    defaultAccent: '#ffffff',
  },
  {
    id: 'neon-stage',
    name: 'Neon Pulse Arena',
    badge: 'ARENA LED',
    description: 'Doble trazo luminoso con halo de neón sincronizado al pulso del escenario.',
    previewGradient: 'from-red-500/40 via-fuchsia-600/20 to-black',
    defaultAccent: '#ef4444',
  },
  {
    id: 'stacked-impact',
    name: 'Stacked Poster 3D',
    badge: 'URBANO',
    description: 'Apila las palabras en bloques verticales de alto impacto visual estilo festival.',
    previewGradient: 'from-amber-500/35 via-red-600/20 to-black',
    defaultAccent: '#f59e0b',
  },
  {
    id: 'chromatic-glow',
    name: 'Chromatic RGB Split',
    badge: 'FX',
    description: 'Separación de canales rojo/azul con vibración armónica de concierto.',
    previewGradient: 'from-cyan-500/30 via-red-500/30 to-black',
    defaultAccent: '#06b6d4',
  },
  {
    id: 'gradient-wipe',
    name: 'Laser Wipe Sweep',
    badge: 'BARRIDO',
    description: 'Barrido horizontal de luz sobre texto metálico en alta definición.',
    previewGradient: 'from-emerald-500/30 via-teal-600/20 to-black',
    defaultAccent: '#10b981',
  },
  {
    id: 'glitch',
    name: 'Cyber Glitch RGB',
    badge: 'ELECTRO',
    description: 'Jitter RGB cuantizado + cortes horizontales que convergen y resuelven nítido.',
    previewGradient: 'from-purple-600/35 via-red-500/25 to-black',
    defaultAccent: '#a855f7',
  },
  // ───────── BRUTAL FX · HyperFrames motion rules (deterministic canvas ports) ─────────
  {
    id: 'beat-slam',
    name: 'Beat Slam Brutal',
    badge: 'BRUTAL',
    description: 'Cada palabra golpea con un eje distinto (escala+blur, latigazo, giro) y sacude el escenario.',
    previewGradient: 'from-orange-600/45 via-red-600/25 to-black',
    defaultAccent: '#ff5b2e',
    group: 'brutal',
  },
  {
    id: 'crash-zoom',
    name: 'Crash Zoom Impact',
    badge: 'DROP',
    description: 'Flash de impacto, líneas radiales de velocidad y entrada violenta desde 3x con ecos.',
    previewGradient: 'from-yellow-500/40 via-red-600/25 to-black',
    defaultAccent: '#facc15',
    group: 'brutal',
  },
  {
    id: 'decrypt',
    name: 'Hacker Decrypt 3D',
    badge: 'DECODE',
    description: 'Caracteres que giran en 3D barajando glifos hasta descifrar la palabra real.',
    previewGradient: 'from-emerald-500/40 via-lime-600/15 to-black',
    defaultAccent: '#22c55e',
    group: 'brutal',
  },
  {
    id: 'depth-extrude',
    name: '3D Depth Extrude',
    badge: 'POSTER 3D',
    description: 'Extrusión de 6 capas que crece al entrar y late al pulso del BPM.',
    previewGradient: 'from-pink-600/40 via-rose-600/20 to-black',
    defaultAccent: '#ec4899',
    group: 'brutal',
  },
  {
    id: 'waterfall',
    name: 'Waterfall Whip',
    badge: 'CASCADA',
    description: 'Las palabras suben en latigazo solapado, con peso según su longitud. Sin fundidos.',
    previewGradient: 'from-sky-500/40 via-blue-700/20 to-black',
    defaultAccent: '#38bdf8',
    group: 'brutal',
  },
  {
    id: 'luxe-chrome',
    name: 'Luxe Chrome Sweep',
    badge: 'LUJO',
    description: 'Banda especular metálica oro/cromo que barre el interior de las letras.',
    previewGradient: 'from-amber-400/45 via-yellow-700/20 to-black',
    defaultAccent: '#d4af37',
    group: 'brutal',
  },
  {
    id: 'font-shuffle',
    name: 'Font Shuffle Beat',
    badge: 'TIPO-RITMO',
    description: 'La frase se escribe palabra a palabra y la palabra clave cambia de fuente a cada beat.',
    previewGradient: 'from-fuchsia-500/40 via-violet-700/20 to-black',
    defaultAccent: '#d946ef',
    group: 'brutal',
  },
  {
    id: 'write-on',
    name: 'Write-On Outline Fill',
    badge: 'TRAZO',
    description: 'Se dibuja el contorno de cada palabra y se inunda de color de abajo hacia arriba.',
    previewGradient: 'from-teal-400/40 via-cyan-700/20 to-black',
    defaultAccent: '#2dd4bf',
    group: 'brutal',
  },
  {
    id: 'liquid',
    name: 'Liquid Wave',
    badge: 'FLUIDO',
    description: 'Ondulación líquida por carácter que se asienta al cantarse la palabra.',
    previewGradient: 'from-indigo-500/40 via-blue-600/20 to-black',
    defaultAccent: '#818cf8',
    group: 'brutal',
  },
  {
    id: 'double-exposure',
    name: 'Double Exposure',
    badge: 'CINE',
    description: 'Dos exposiciones desfasadas en escala y color que se funden en pantalla.',
    previewGradient: 'from-red-500/35 via-cyan-500/20 to-black',
    defaultAccent: '#f43f5e',
    group: 'brutal',
  },
];

export type LyricFontCategory = 'impact' | 'luxury' | 'tech' | 'script';

export interface LyricFontPreset {
  id: LyricFontFamily;
  label: string;
  sampleClass: string;
  category: LyricFontCategory;
  cssStack: string; // Canvas / CSS font-family stack
  weight: number; // REAL weight shipped by the font (no synthetic bold)
  italic?: boolean;
  tracking?: number; // Default letter-spacing in em
  defaultCase?: LyricTextCase;
}

export const LYRIC_FONT_PRESETS: LyricFontPreset[] = [
  // IMPACTO / ESCENARIO
  { id: 'Montserrat', label: 'Montserrat Black', sampleClass: 'font-sans font-black', category: 'impact', cssStack: '"Montserrat", "Inter", sans-serif', weight: 900, tracking: -0.02 },
  { id: 'Bebas Neue', label: 'Bebas Neue', sampleClass: 'tracking-wider font-bold', category: 'impact', cssStack: '"Bebas Neue", "Oswald", sans-serif', weight: 400, tracking: 0.02 },
  { id: 'Anton', label: 'Anton', sampleClass: '', category: 'impact', cssStack: '"Anton", "Bebas Neue", sans-serif', weight: 400, tracking: 0 },
  { id: 'Archivo Black', label: 'Archivo Black', sampleClass: '', category: 'impact', cssStack: '"Archivo Black", "Montserrat", sans-serif', weight: 400, tracking: -0.03 },
  { id: 'Unbounded', label: 'Unbounded Black', sampleClass: '', category: 'impact', cssStack: '"Unbounded", "Montserrat", sans-serif', weight: 900, tracking: -0.02 },
  { id: 'Outfit', label: 'Outfit Black', sampleClass: 'font-extrabold', category: 'impact', cssStack: '"Outfit", "Plus Jakarta Sans", sans-serif', weight: 900, tracking: -0.02 },
  // LUJO EDITORIAL
  { id: 'Bodoni Moda', label: 'Bodoni Moda (Fashion)', sampleClass: '', category: 'luxury', cssStack: '"Bodoni Moda", "Playfair Display", Georgia, serif', weight: 700, tracking: -0.01 },
  { id: 'Fraunces', label: 'Fraunces Black Italic', sampleClass: '', category: 'luxury', cssStack: '"Fraunces", Georgia, serif', weight: 900, italic: true, tracking: -0.02, defaultCase: 'title' },
  { id: 'Instrument Serif', label: 'Instrument Serif Italic', sampleClass: '', category: 'luxury', cssStack: '"Instrument Serif", Georgia, serif', weight: 400, italic: true, tracking: -0.01, defaultCase: 'title' },
  { id: 'DM Serif Display', label: 'DM Serif Display', sampleClass: '', category: 'luxury', cssStack: '"DM Serif Display", Georgia, serif', weight: 400, tracking: -0.01 },
  { id: 'Italiana', label: 'Italiana (Haute Couture)', sampleClass: '', category: 'luxury', cssStack: '"Italiana", "Playfair Display", serif', weight: 400, tracking: 0.12 },
  { id: 'Playfair Display', label: 'Playfair Display Italic', sampleClass: 'font-serif italic font-bold', category: 'luxury', cssStack: '"Playfair Display", Georgia, serif', weight: 900, italic: true, tracking: -0.01 },
  { id: 'Roboto Slab', label: 'Roboto Slab Black', sampleClass: 'font-serif font-black', category: 'luxury', cssStack: '"Roboto Slab", serif', weight: 900, tracking: -0.01 },
  // TECH / FUTURISTA
  { id: 'Syncopate', label: 'Syncopate Wide', sampleClass: '', category: 'tech', cssStack: '"Syncopate", "Unbounded", sans-serif', weight: 700, tracking: 0.08 },
  { id: 'Space Grotesk', label: 'Space Grotesk', sampleClass: '', category: 'tech', cssStack: '"Space Grotesk", "Inter", sans-serif', weight: 700, tracking: -0.03 },
  { id: 'Space Mono', label: 'Space Mono (Decrypt)', sampleClass: '', category: 'tech', cssStack: '"Space Mono", "JetBrains Mono", monospace', weight: 700, tracking: 0 },
  { id: 'Monoton', label: 'Monoton (Neón Retro)', sampleClass: '', category: 'tech', cssStack: '"Monoton", "Bebas Neue", sans-serif', weight: 400, tracking: 0.04 },
  // SCRIPT / FIRMA
  { id: 'Kaushan Script', label: 'Kaushan Script', sampleClass: '', category: 'script', cssStack: '"Kaushan Script", cursive', weight: 400, tracking: 0, defaultCase: 'title' },
  { id: 'Yellowtail', label: 'Yellowtail', sampleClass: '', category: 'script', cssStack: '"Yellowtail", cursive', weight: 400, tracking: 0, defaultCase: 'title' },
];

export const LYRIC_FONT_CATEGORIES: { id: LyricFontCategory; label: string }[] = [
  { id: 'impact', label: 'Impacto' },
  { id: 'luxury', label: 'Lujo' },
  { id: 'tech', label: 'Tech' },
  { id: 'script', label: 'Script' },
];

/** Resolves the font preset (falls back to Montserrat for legacy / unknown ids). */
export function getFontPreset(fontFamily?: string): LyricFontPreset {
  return (
    LYRIC_FONT_PRESETS.find((f) => f.id === fontFamily) ||
    LYRIC_FONT_PRESETS[0]
  );
}

/** Builds the exact CSS / canvas font shorthand using the font's REAL weight & style. */
export function buildFontString(fontFamily: string | undefined, sizePx: number): string {
  const p = getFontPreset(fontFamily);
  return `${p.italic ? 'italic ' : ''}${p.weight} ${Math.round(sizePx)}px ${p.cssStack}`;
}

/** Applies draw-time capitalisation without mutating the stored text (word timings stay intact). */
export function applyTextCase(text: string, textCase: LyricTextCase = 'upper'): string {
  if (textCase === 'lower') return text.toLocaleLowerCase('es');
  if (textCase === 'title') {
    return text
      .toLocaleLowerCase('es')
      .replace(/(^|\s)(\S)/g, (_m, sp: string, ch: string) => sp + ch.toLocaleUpperCase('es'));
  }
  return text.toLocaleUpperCase('es');
}

/**
 * Generates proportional word-level timings inside a line so every phrase
 * supports CapCut-style word-by-word highlight out of the box.
 */
export function computeWordTimings(
  text: string,
  totalDurationMs: number,
  existingWords?: LyricWordTiming[]
): LyricWordTiming[] {
  const cleanWords = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (cleanWords.length === 0) return [];

  // If existingWords match the exact word count and words, scale them proportionally to totalDurationMs
  if (
    existingWords &&
    existingWords.length === cleanWords.length &&
    existingWords.every((w, i) => w.word === cleanWords[i])
  ) {
    const lastEnd = existingWords.reduce(
      (max, w) => Math.max(max, w.startOffsetMs + w.durationMs),
      0
    );
    if (lastEnd > 0 && Math.abs(lastEnd - totalDurationMs) > 20) {
      const ratio = totalDurationMs / lastEnd;
      return existingWords.map((w) => ({
        word: w.word,
        startOffsetMs: Math.round(w.startOffsetMs * ratio),
        durationMs: Math.max(80, Math.round(w.durationMs * ratio)),
      }));
    }
    return existingWords;
  }

  // Weight each word slightly by character count (minimum weight 2) so short connectors ("DE", "Y") are faster than long words
  const weights = cleanWords.map((w) => Math.max(2, Math.min(12, w.length + 1)));
  const totalWeight = weights.reduce((acc, v) => acc + v, 0);
  const activeSpanMs = Math.max(200, totalDurationMs * 0.92); // Leave 8% tail hold on the final word

  let cursorMs = 0;
  return cleanWords.map((word, index) => {
    const share = (weights[index] / totalWeight) * activeSpanMs;
    const durationMs =
      index === cleanWords.length - 1
        ? Math.max(100, Math.round(totalDurationMs - cursorMs))
        : Math.max(80, Math.round(share));
    const item: LyricWordTiming = {
      word,
      startOffsetMs: Math.round(cursorMs),
      durationMs,
    };
    cursorMs += share;
    return item;
  });
}

/**
 * Parses a full song lyric text pasted by the user into draggable LyricLine pills.
 * Detects section headers like [Verso 1], [Coro], INTRO:, CORO:, etc.
 */
export function parseRawLyricsToPills(
  rawText: string,
  defaultEffect: LyricEffectType = 'capcut-karaoke',
  defaultFont: LyricFontFamily = 'Montserrat',
  defaultDurationMs = 2800
): LyricLine[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let currentSection = 'VERSO';
  const result: LyricLine[] = [];
  const sectionRegex = /^(\[.*\]|\(.*\)|(INTRO|VERSO|VERSE|PRE[\s-]?CORO|CORO|CHORUS|PUENTE|BRIDGE|OUTRO|FINAL|SOLO|INSTRUMENTAL)\s*\d*:?)$/i;

  lines.forEach((rawLine, idx) => {
    if (sectionRegex.test(rawLine) && rawLine.length <= 28) {
      currentSection = rawLine.replace(/[\[\]\(\):]/g, '').trim().toUpperCase();
      return;
    }

    const formattedText = rawLine.toUpperCase();
    result.push({
      id: `pill-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      text: formattedText,
      sectionTag: currentSection,
      placed: false, // Starts in the Unassigned Lyric Pool ready to drag or Tap-to-Sync
      startMs: idx * 3000,
      durationMs: defaultDurationMs,
      effect: defaultEffect,
      fontFamily: defaultFont,
      fontSize: 108,
      positionX: 0.5,
      positionY: 0.5,
      primaryColor: '#ffffff',
      accentColor: '#ef4444',
      words: computeWordTimings(formattedText, defaultDurationMs),
    });
  });

  return result;
}

export interface BeatMarker {
  timeMs: number;
  bar: number;
  beat: number; // 1-based beat within the bar (1 = downbeat)
  isDownbeat: boolean;
}

/**
 * Builds the musical beat grid in milliseconds from AI beatTimes or mathematical BPM.
 */
export function buildBeatGridMs(
  bpm: number = 120,
  firstBeatOffsetSec: number = 0,
  beatTimesSec?: number[],
  totalDurationMs: number = 240000,
  beatsPerBar: number = 4
): BeatMarker[] {
  const markers: BeatMarker[] = [];

  if (beatTimesSec && beatTimesSec.length > 2) {
    beatTimesSec.forEach((sec, idx) => {
      const bar = Math.floor(idx / beatsPerBar) + 1;
      const beat = (idx % beatsPerBar) + 1;
      markers.push({
        timeMs: Math.round(sec * 1000),
        bar,
        beat,
        isDownbeat: beat === 1,
      });
    });
    return markers;
  }

  const safeBpm = bpm > 20 && bpm < 300 ? bpm : 120;
  const beatDurationMs = 60000 / safeBpm;
  const startMs = Math.max(0, Math.round((firstBeatOffsetSec || 0) * 1000));
  let idx = 0;

  for (let t = startMs; t <= totalDurationMs; t += beatDurationMs) {
    const bar = Math.floor(idx / beatsPerBar) + 1;
    const beat = (idx % beatsPerBar) + 1;
    markers.push({
      timeMs: Math.round(t),
      bar,
      beat,
      isDownbeat: beat === 1,
    });
    idx++;
  }

  return markers;
}

/**
 * Snaps a candidate timestamp in ms to the closest beat marker or clip boundary.
 */
export function snapTimeMs(
  targetMs: number,
  beatMarkers: BeatMarker[],
  extraSnapPointsMs: number[] = [],
  thresholdMs: number = 140
): { timeMs: number; snapped: boolean; snapSource?: 'beat' | 'downbeat' | 'clip' } {
  let bestTime = Math.max(0, Math.round(targetMs));
  let minDiff = thresholdMs;
  let snapSource: 'beat' | 'downbeat' | 'clip' | undefined;

  // Priority 1: Clip boundaries (for seamless CapCut back-to-back lyric blocks)
  for (const pt of extraSnapPointsMs) {
    const diff = Math.abs(targetMs - pt);
    if (diff <= minDiff) {
      minDiff = diff;
      bestTime = Math.round(pt);
      snapSource = 'clip';
    }
  }

  // Priority 2: Beat Grid markers
  for (const marker of beatMarkers) {
    const diff = Math.abs(targetMs - marker.timeMs);
    if (diff <= minDiff) {
      minDiff = diff;
      bestTime = marker.timeMs;
      snapSource = marker.isDownbeat ? 'downbeat' : 'beat';
    }
  }

  return {
    timeMs: Math.max(0, bestTime),
    snapped: snapSource !== undefined,
    snapSource,
  };
}

/**
 * Extracts normalized waveform peak amplitudes [0.05..1.0] from a Web Audio AudioBuffer.
 */
export function extractAudioPeaks(audioBuffer: AudioBuffer, bucketCount: number = 900): number[] {
  const channel0 = audioBuffer.getChannelData(0);
  const channel1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  const totalSamples = channel0.length;
  const samplesPerBucket = Math.max(1, Math.floor(totalSamples / bucketCount));
  const peaks: number[] = new Array(bucketCount).fill(0);

  let globalMax = 0.01;
  for (let i = 0; i < bucketCount; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(totalSamples, start + samplesPerBucket);
    let maxInBucket = 0;
    // Sample every 8th frame inside the bucket for ultra-fast extraction
    const step = Math.max(1, Math.floor((end - start) / 64));
    for (let j = start; j < end; j += step) {
      const v0 = Math.abs(channel0[j]);
      const v1 = channel1 ? Math.abs(channel1[j]) : 0;
      const v = Math.max(v0, v1);
      if (v > maxInBucket) maxInBucket = v;
    }
    peaks[i] = maxInBucket;
    if (maxInBucket > globalMax) globalMax = maxInBucket;
  }

  return peaks.map((p) => Math.max(0.04, Math.min(1, p / globalMax)));
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMIZABLE STAGE BACKGROUND TYPES & PRESETS
// ─────────────────────────────────────────────────────────────────────────────

export type LyricBackgroundType =
  | 'obsidian-red'      // Default TANDU stage pulse
  | 'pure-black'        // Absolute #000000 for zero-emission LED screens
  | 'transparent'       // Alpha 0 for live OBS/vMix camera overlays
  | 'chroma-green'      // #00ff00 for hardware broadcast switchers
  | 'chroma-blue'       // #0000ff broadcast chroma
  | 'warm-gold'         // Warm amber worship glow
  | 'cyber-blue'        // Electric cyan arena glow
  | 'midnight-purple'   // Deep concert violet pulse
  | 'custom-solid'      // User-defined hex color
  | 'custom-image';     // Custom user image URL

export interface LyricBackgroundConfig {
  type: LyricBackgroundType;
  customColor?: string;      // Used when type === 'custom-solid'
  imageUrl?: string;         // Used when type === 'custom-image'
  particles?: boolean;       // Floating stage bokeh / dust reacting to BPM
  pulseWithBpm?: boolean;    // Ambient pulse toggle (default true)
}

export interface LyricBackgroundPreset {
  id: LyricBackgroundType;
  label: string;
  badge: string;
  description: string;
  previewBg: string; // CSS background for UI preview card
}

export const DEFAULT_LYRIC_BACKGROUND: LyricBackgroundConfig = {
  type: 'obsidian-red',
  particles: false,
  pulseWithBpm: true,
};

export const LYRIC_BACKGROUND_PRESETS: LyricBackgroundPreset[] = [
  {
    id: 'obsidian-red',
    label: 'Obsidian Red',
    badge: 'TANDU STAGE',
    description: 'Negro carbón con halo rojo reactivo al compás del BPM y línea de horizonte LED.',
    previewBg: 'radial-gradient(circle at center, rgba(239,68,68,0.5) 0%, #050608 80%)',
  },
  {
    id: 'pure-black',
    label: 'Negro Puro LED',
    badge: 'OLED / 0% EMISIÓN',
    description: 'Negro absoluto (#000000) para apagar los diodos de pantallas gigantes LED.',
    previewBg: '#000000',
  },
  {
    id: 'transparent',
    label: 'Transparente (Alpha)',
    badge: 'OBS / OVERLAYS',
    description: 'Canal alfa 0 para superponer letras sobre cámaras en vivo en OBS, vMix o ProPresenter.',
    previewBg: 'repeating-conic-gradient(#1f2937 0% 25%, #111827 0% 50%) 50% / 12px 12px',
  },
  {
    id: 'chroma-green',
    label: 'Chroma Verde',
    badge: 'BROADCAST',
    description: 'Verde puro (#00FF00) para switchers de video profesionales (Blackmagic ATEM).',
    previewBg: '#00ff00',
  },
  {
    id: 'warm-gold',
    label: 'Oro Worship',
    badge: 'CATEDRAL',
    description: 'Atmósfera dorada cálida con pulso ámbar para momentos de adoración y acústicos.',
    previewBg: 'radial-gradient(circle at center, rgba(212,175,55,0.55) 0%, #0a0804 80%)',
  },
  {
    id: 'cyber-blue',
    label: 'Cyber Arena',
    badge: 'ELECTRO / ROCK',
    description: 'Resplandor azul cian eléctrico con pulso percutivo de alta energía.',
    previewBg: 'radial-gradient(circle at center, rgba(6,182,212,0.55) 0%, #040812 80%)',
  },
  {
    id: 'midnight-purple',
    label: 'Midnight Violet',
    badge: 'FESTIVAL',
    description: 'Púrpura y fucsia profundo con halo de escenario místico.',
    previewBg: 'radial-gradient(circle at center, rgba(168,85,247,0.55) 0%, #080410 80%)',
  },
  {
    id: 'custom-solid',
    label: 'Color Personalizado',
    badge: 'SÓLIDO',
    description: 'Define cualquier color HEX fijo para adaptarse a la paleta del evento.',
    previewBg: 'linear-gradient(135deg, #374151 0%, #111827 100%)',
  },
  {
    id: 'custom-image',
    label: 'Imagen de Fondo',
    badge: 'TEXTURA / FOTO',
    description: 'Carga un fondo personalizado de luces, concierto o logo de la banda.',
    previewBg: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
  },
];
