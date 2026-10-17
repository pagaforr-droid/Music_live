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
  | 'liquid';

export type LyricFontFamily =
  | 'Montserrat'
  | 'Bebas Neue'
  | 'Outfit'
  | 'Playfair Display'
  | 'Roboto Slab'
  | 'Nexa Rust'
  | 'Northwell';

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
}

export interface LyricEffectPreset {
  id: LyricEffectType;
  name: string;
  badge: string;
  description: string;
  previewGradient: string;
  defaultAccent: string;
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
    name: 'Cyber Cut Glitch',
    badge: 'ELECTRO',
    description: 'Cortes digitales de alta frecuencia con desplazamiento de matriz.',
    previewGradient: 'from-purple-600/35 via-red-500/25 to-black',
    defaultAccent: '#a855f7',
  },
];

export const LYRIC_FONT_PRESETS: { id: LyricFontFamily; label: string; sampleClass: string }[] = [
  { id: 'Montserrat', label: 'Montserrat Black (Escenario)', sampleClass: 'font-sans font-black' },
  { id: 'Bebas Neue', label: 'Bebas Neue (Impacto Alto)', sampleClass: 'tracking-wider font-bold' },
  { id: 'Outfit', label: 'Outfit ExtraBold (Moderno)', sampleClass: 'font-extrabold' },
  { id: 'Playfair Display', label: 'Playfair Display (Editorial)', sampleClass: 'font-serif italic font-bold' },
  { id: 'Roboto Slab', label: 'Roboto Slab (Sólido)', sampleClass: 'font-serif font-black' },
];

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
