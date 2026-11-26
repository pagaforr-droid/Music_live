export type CueBuffersMap = Record<string, AudioBuffer>;
export type CueOffsetsMap = Record<string, number>;
export type PreRollBars = 0 | 1 | 2;

export interface LiveMixMeta {
  preRollSec: number;
  preRollBars: PreRollBars;
  bpm: number;
  timeSignature: string;
  firstBeatOffset: number;
  musicDurationSec: number;
  totalDurationSec: number;
  exportedAt: string;
  version?: number;
  cueVoiceCount?: number;
  sectionsUpdatedAt?: string;
}

export interface LoadCueBuffersResult {
  cueBuffers: CueBuffersMap;
  cueOffsets: CueOffsetsMap;
  loadedNames: string[];
  failedNames: string[];
}

export interface SynthesizeLiveCueOptions {
  preRollBars?: PreRollBars;
  exactPreRollSec?: number;
  clickVolume?: number;
  cueVolume?: number;
  clickPan?: number;
  cuePan?: number;
  clickMuted?: boolean;
  cueMuted?: boolean;
  /** 1 = mono (ahorra 50% de RAM en Modo Ensayo/Celulares), 2 = estéreo (default) */
  outputChannels?: 1 | 2;
}

export interface LyricsSyncMeta {
  reference: 'foh_mix' | 'stem';
  preRollSec: number;
  savedAt?: string;
  migratedFromLegacy?: boolean;
}

export const LIVE_EXPORT_TAIL_SECONDS = 1.5;

export const CUE_NAMES = ['intro', 'verso', 'pre-coro', 'coro', 'puente', 'solo', 'final', '1', '2', '3', '4'];

const extractPrompterData = (songOrPrompterData: any): any => {
  if (!songOrPrompterData) return null;
  if (songOrPrompterData.prompter_data !== undefined) {
    return songOrPrompterData.prompter_data;
  }
  return songOrPrompterData;
};

export const getBeatsPerMeasure = (timeSignature?: string): number => {
  const parsed = parseInt(String(timeSignature || '4/4').split('/')[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
};

export const getBaseFirstBeatOffset = (prompterData: any): number => {
  if (!prompterData) return 0;
  if (prompterData.firstBeatOffset !== undefined && Number.isFinite(Number(prompterData.firstBeatOffset))) {
    return Math.max(0, Number(prompterData.firstBeatOffset));
  }
  if (Array.isArray(prompterData.chords) && prompterData.chords.length > 0) {
    const firstChordTime = Number(prompterData.chords[0]?.time);
    if (Number.isFinite(firstChordTime)) return Math.max(0, firstChordTime);
  }
  return 0;
};

/**
 * Cálculo puro de duración de N compases de Pre-Roll (sin ajuste de fase por firstBeatOffset).
 * Usado también como fallback 100% retrocompatible (bars = 2) para mezclas legacy sin liveMixMeta.
 */
export const computePreRollSecondsForBars = (
  songOrPrompterData: any,
  bars: PreRollBars
): number => {
  if (bars === 0) return 0;
  const pd = extractPrompterData(songOrPrompterData);
  const bpm = Number(pd?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  const beatsPerMeasure = getBeatsPerMeasure(pd?.timeSignature);
  const secondsPerBeat = 60 / bpm;
  const raw = secondsPerBeat * beatsPerMeasure * bars;
  return Number(Math.min(raw, 16).toFixed(6));
};

/**
 * Cálculo de Pre-Roll con enganche de fase al Golpe 1 (Phase-Locked Pre-Roll).
 * Garantiza que (preRollSec + effectiveFirstBeat) sea un múltiplo entero de 1 compás,
 * logrando que el Pulso 1 (HIGH) del conteo arranque EXACTAMENTE en t = 0.000s sin
 * silencio muerto inicial ni clics huérfanos en compases parciales, preservando intacto
 * cualquier pickup o aire inicial (0..firstBeatOffset) dentro del stem original.
 */
export const computePhaseLockedPreRollSeconds = (
  songOrPrompterData: any,
  bars: PreRollBars,
  manualGridOffset: number = 0
): number => {
  if (bars === 0) return 0;
  const pd = extractPrompterData(songOrPrompterData);
  const bpm = Number(pd?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;

  const beatsPerMeasure = getBeatsPerMeasure(pd?.timeSignature);
  const barDur = (60 / bpm) * beatsPerMeasure;
  if (!Number.isFinite(barDur) || barDur <= 0) return 0;

  // Tope en compases enteros (máx 16s) para nunca cortar un compás por la mitad en tempos ultra-lentos
  const maxIntegerBars = barDur <= 16 ? Math.max(1, Math.floor(16 / barDur)) : 1;
  const targetBars = Math.min(bars, maxIntegerBars);
  const effectiveFirstBeat = Math.max(0, getBaseFirstBeatOffset(pd) + (Number(manualGridOffset) || 0));

  if (effectiveFirstBeat <= 0.001) {
    return Number(Math.min(barDur * targetBars, 16).toFixed(6));
  }

  const minBarsToCoverFirstBeat = Math.ceil((effectiveFirstBeat - 0.001) / barDur);
  const totalPreBars = Math.max(targetBars, minBarsToCoverFirstBeat);
  const preRollSec = Math.max(0, totalPreBars * barDur - effectiveFirstBeat);
  return Number(Math.min(preRollSec, 16).toFixed(6));
};

/**
 * Fuente única de verdad para conocer el Pre-Roll real horneado en un mix FOH/CUE exportado.
 * 1. Usa `prompter_data.liveMixMeta.preRollSec` cuando existe (inmune a cambios posteriores de BPM).
 * 2. Fallback legacy 100% retrocompatible para canciones exportadas antes de `liveMixMeta` (2 compases, tope 16s).
 */
export const resolveEffectivePreRoll = (songOrPrompterData: any): number => {
  const pd = extractPrompterData(songOrPrompterData);
  if (!pd) return 0;

  const metaPreRoll = pd?.liveMixMeta?.preRollSec;
  if (typeof metaPreRoll === 'number' && Number.isFinite(metaPreRoll) && metaPreRoll >= 0) {
    return metaPreRoll;
  }

  return computePreRollSecondsForBars(pd, 2);
};

/**
 * Devuelve cuántos compases de Pre-Roll (0, 1 o 2) corresponden a una canción exportada.
 */
export const resolveEffectivePreRollBars = (songOrPrompterData: any): PreRollBars => {
  const pd = extractPrompterData(songOrPrompterData);
  if (!pd) return 0;

  const metaBars = pd?.liveMixMeta?.preRollBars;
  if (metaBars === 0 || metaBars === 1 || metaBars === 2) {
    return metaBars;
  }

  const preRollSec = resolveEffectivePreRoll(pd);
  if (preRollSec <= 0.001) return 0;

  const bpm = Number(pd?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  const barDur = (60 / bpm) * getBeatsPerMeasure(pd?.timeSignature);
  const effFirstBeat = getBaseFirstBeatOffset(pd);
  const inferred = Math.round((preRollSec + effFirstBeat) / Math.max(0.25, barDur));
  return (inferred <= 1 ? 1 : 2) as PreRollBars;
};

/**
 * Resuelve la duración musical real (sin cola silenciosa extra) y el punto exacto de fin para auto-avance.
 */
export const resolveEffectivePlaybackBounds = (
  songOrPrompterData: any,
  decodedBufferDuration: number
): { preRollSec: number; musicDurationSec: number; autoAdvanceAtGlobalSec: number } => {
  const pd = extractPrompterData(songOrPrompterData);
  const preRollSec = resolveEffectivePreRoll(pd);
  const safeDecoded = Number.isFinite(decodedBufferDuration) && decodedBufferDuration > 0 ? decodedBufferDuration : 0;
  const metaMusicDur = pd?.liveMixMeta?.musicDurationSec;

  if (typeof metaMusicDur === 'number' && Number.isFinite(metaMusicDur) && metaMusicDur > 0) {
    const autoAdvanceAtGlobalSec = safeDecoded > 0
      ? Math.min(safeDecoded, preRollSec + metaMusicDur + 0.35)
      : preRollSec + metaMusicDur + 0.35;
    return {
      preRollSec,
      musicDurationSec: metaMusicDur,
      autoAdvanceAtGlobalSec,
    };
  }

  const fallbackMusicDur = Math.max(0, safeDecoded - preRollSec);
  return {
    preRollSec,
    musicDurationSec: fallbackMusicDur,
    autoAdvanceAtGlobalSec: safeDecoded,
  };
};

/**
 * Unifica el espacio temporal de Letras entre LyricStudio, LiveConcert (LyricVisualizer / HDMI)
 * y el Carril 3 de Prompter, evitando desfases cuando las letras fueron sincronizadas sobre
 * `foh_mix` (con preRoll) o sobre un stem vocal puro (sin preRoll).
 */
export const resolveLyricsTimeMapping = (
  songOrPrompterData: any
): { lyricReferencePreRollSec: number; prompterLyricsOffsetSec: number } => {
  const pd = extractPrompterData(songOrPrompterData);
  if (!pd) return { lyricReferencePreRollSec: 0, prompterLyricsOffsetSec: 0 };

  const syncMeta = pd?.lyricsSyncMeta as LyricsSyncMeta | undefined;
  if (syncMeta?.reference === 'stem') {
    return { lyricReferencePreRollSec: 0, prompterLyricsOffsetSec: 0 };
  }
  if (
    syncMeta?.reference === 'foh_mix' &&
    typeof syncMeta.preRollSec === 'number' &&
    Number.isFinite(syncMeta.preRollSec) &&
    syncMeta.preRollSec >= 0
  ) {
    return {
      lyricReferencePreRollSec: syncMeta.preRollSec,
      prompterLyricsOffsetSec: -syncMeta.preRollSec,
    };
  }

  // Fallback retrocompatible: históricamente LyricStudio prioriza `foh_mix_url`, que llevaba el Pre-Roll efectivo
  const currentPreRoll = resolveEffectivePreRoll(pd);
  return {
    lyricReferencePreRollSec: currentPreRoll,
    prompterLyricsOffsetSec: -currentPreRoll,
  };
};

// Genera un transitorio de clic puro en RAM
export const generateClickBuffer = (ctx: BaseAudioContext, frequency: number): AudioBuffer => {
  const sampleRate = ctx.sampleRate;
  const duration = 0.05;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 80);
    data[i] = Math.cos(2 * Math.PI * frequency * t) * env * 0.8;
  }
  return buffer;
};

const normalizeCueText = (raw: string): string =>
  (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

// Resolver de forma inteligente el archivo de voz guía según el nombre de sección (Español / Inglés)
export const resolveCueBufferName = (rawName: string, cueBuffers: Record<string, any>): string => {
  const lower = normalizeCueText(rawName);
  if (!lower) return '';
  if (cueBuffers[lower]) return lower;
  if (lower.includes('intro') && cueBuffers['intro']) return 'intro';
  if (
    (lower.includes('pre-coro') ||
      lower.includes('precoro') ||
      lower.includes('pre coro') ||
      lower.includes('pre-chorus') ||
      lower.includes('prechorus') ||
      lower.includes('pre chorus')) &&
    cueBuffers['pre-coro']
  ) {
    return 'pre-coro';
  }
  if ((lower.includes('coro') || lower.includes('chorus') || lower.includes('estribillo')) && cueBuffers['coro']) {
    return 'coro';
  }
  if ((lower.includes('verso') || lower.includes('verse') || lower.includes('estrofa')) && cueBuffers['verso']) {
    return 'verso';
  }
  if ((lower.includes('puente') || lower.includes('bridge')) && cueBuffers['puente']) {
    return 'puente';
  }
  if (lower.includes('solo') && cueBuffers['solo']) {
    return 'solo';
  }
  if (
    (lower.includes('final') ||
      lower.includes('outro') ||
      lower.includes('ending') ||
      lower.includes('coda') ||
      /\bend\b/.test(lower)) &&
    cueBuffers['final']
  ) {
    return 'final';
  }
  if (
    (lower.includes('instrumental') ||
      lower.includes('interludio') ||
      lower.includes('interlude') ||
      /\b(inst|instr)\b/.test(lower)) &&
    cueBuffers['solo']
  ) {
    return 'solo';
  }
  return '';
};

const getCueAssetBaseUrl = (): string => {
  try {
    const base = (import.meta as any)?.env?.BASE_URL;
    if (typeof base === 'string' && base.length > 0) {
      return base.endsWith('/') ? base : `${base}/`;
    }
  } catch {
    // Fallback outside Vite runtime (e.g. Node tests)
  }
  return '/';
};

/**
 * Decodificador PCM WAV nativo en JS puro (RIFF/WAVE 16-bit PCM o 32-bit Float).
 * Garantiza 100% de decodificación determinista incluso si el códec nativo o `decodeAudioData`
 * falla en WebView2 (Windows/Tauri), Safari o contextos suspendidos.
 */
export const parsePcmWavToAudioBuffer = (
  audioCtx: BaseAudioContext,
  arrayBuffer: ArrayBuffer
): AudioBuffer | null => {
  if (!arrayBuffer || arrayBuffer.byteLength < 44) return null;
  const view = new DataView(arrayBuffer);

  const readFourCC = (offset: number): string =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );

  if (readFourCC(0) !== 'RIFF' || readFourCC(8) !== 'WAVE') return null;

  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let pos = 12;
  while (pos + 8 <= view.byteLength) {
    const chunkId = readFourCC(pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkDataStart = pos + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkDataStart + 16 <= view.byteLength) {
      audioFormat = view.getUint16(chunkDataStart, true);
      numChannels = view.getUint16(chunkDataStart + 2, true);
      sampleRate = view.getUint32(chunkDataStart + 4, true);
      bitsPerSample = view.getUint16(chunkDataStart + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataStart;
      dataSize = Math.min(chunkSize, view.byteLength - chunkDataStart);
      break;
    }

    pos = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (
    dataOffset < 0 ||
    dataSize <= 0 ||
    numChannels < 1 ||
    numChannels > 8 ||
    sampleRate < 8000 ||
    sampleRate > 192000
  ) {
    return null;
  }

  const bytesPerSample = bitsPerSample / 8;
  if (
    !(audioFormat === 1 && bitsPerSample === 16) &&
    !(audioFormat === 3 && bitsPerSample === 32)
  ) {
    return null;
  }

  const frameSize = numChannels * bytesPerSample;
  const numFrames = Math.floor(dataSize / frameSize);
  if (numFrames <= 0) return null;

  const buffer = audioCtx.createBuffer(numChannels, numFrames, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    if (audioFormat === 1 && bitsPerSample === 16) {
      for (let i = 0; i < numFrames; i++) {
        const byteIdx = dataOffset + i * frameSize + ch * 2;
        channelData[i] = view.getInt16(byteIdx, true) / 32768;
      }
    } else {
      for (let i = 0; i < numFrames; i++) {
        const byteIdx = dataOffset + i * frameSize + ch * 4;
        channelData[i] = view.getFloat32(byteIdx, true);
      }
    }
  }

  return buffer;
};

const measureAudioBufferPeak = (audioBuffer: AudioBuffer): number => {
  if (!audioBuffer || audioBuffer.length === 0 || audioBuffer.duration <= 0) return 0;
  const data = audioBuffer.getChannelData(0);
  let maxPeak = 0;
  const step = data.length > 48000 ? 4 : 1;
  for (let i = 0; i < data.length; i += step) {
    const v = Math.abs(data[i]);
    if (v > maxPeak) maxPeak = v;
  }
  return maxPeak;
};

const computeSafeCueOffset = (audioBuffer: AudioBuffer, isPreTrimmedWav: boolean): number => {
  if (!audioBuffer || audioBuffer.duration <= 0.05) return 0;
  if (isPreTrimmedWav) return 0;

  const data = audioBuffer.getChannelData(0);
  let startSample = 0;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > 0.03) {
      startSample = Math.max(0, i - Math.floor(audioBuffer.sampleRate * 0.005));
      break;
    }
  }
  const rawOffset = startSample / audioBuffer.sampleRate;
  return Math.min(Math.max(0, rawOffset), Math.max(0, audioBuffer.duration - 0.12));
};

// Pre-cargar todas las voces de voz guía desde /cues/*.wav (PCM 16-bit prioritario) con fallback automático a /cues/*.mp3
export const loadCueBuffers = async (
  audioCtx: BaseAudioContext
): Promise<LoadCueBuffersResult> => {
  const cueBuffers: CueBuffersMap = {};
  const cueOffsets: CueOffsetsMap = {};
  const loadedNames: string[] = [];
  const failedNames: string[] = [];
  const baseUrl = getCueAssetBaseUrl();

  const tryDecodeSingleFormat = async (
    name: string,
    ext: 'wav' | 'mp3'
  ): Promise<{ buffer: AudioBuffer; isWav: boolean } | null> => {
    const url = `${baseUrl}cues/${name}.${ext}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();
    // Evitar tragar respuestas HTML 200 OK procedentes de rewrites SPA
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength < 44) return null;

    // Verificar firma rápida HTML ('<!DO' o '<htm') por si el servidor omitió Content-Type
    const headBytes = new Uint8Array(arrayBuffer, 0, Math.min(8, arrayBuffer.byteLength));
    if (headBytes[0] === 0x3c /* '<' */) {
      return null;
    }

    let decoded: AudioBuffer | null = null;
    try {
      decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      decoded = null;
    }

    if ((!decoded || measureAudioBufferPeak(decoded) < 0.001) && ext === 'wav') {
      decoded = parsePcmWavToAudioBuffer(audioCtx, arrayBuffer);
    }

    if (!decoded || decoded.duration <= 0.02 || measureAudioBufferPeak(decoded) < 0.001) {
      return null;
    }

    return { buffer: decoded, isWav: ext === 'wav' };
  };

  await Promise.all(
    CUE_NAMES.map(async (name) => {
      try {
        const result =
          (await tryDecodeSingleFormat(name, 'wav')) ||
          (await tryDecodeSingleFormat(name, 'mp3'));

        if (result) {
          cueBuffers[name] = result.buffer;
          cueOffsets[name] = computeSafeCueOffset(result.buffer, result.isWav);
          loadedNames.push(name);
        } else {
          failedNames.push(name);
          console.warn(`[cueEngine] Voz guía no disponible o inválida para "${name}" (.wav/.mp3)`);
        }
      } catch (e) {
        failedNames.push(name);
        console.warn(`[cueEngine] Error cargando voz guía "${name}":`, e);
      }
    })
  );

  return { cueBuffers, cueOffsets, loadedNames, failedNames };
};

/**
 * Determina si LiveConcert (Modo En Vivo WAV) debe sintetizar el bus CUE en RAM para garantizar
 * que la Voz Guía siempre esté presente y actualizada respecto a las secciones guardadas en Studio Prompter.
 */
export const shouldSynthesizeLiveCueInRam = (song: any): boolean => {
  if (!song) return false;
  const pd = extractPrompterData(song);
  const bpm = Number(pd?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return false;

  const clickMuted = pd?.mixConfig?.click?.muted === true;
  const cuesMuted = pd?.mixConfig?.cues?.muted === true;
  if (clickMuted && cuesMuted) return false;

  const meta = pd?.liveMixMeta as LiveMixMeta | undefined;
  // 1. Mezclas previas a v3 (exportadas antes del fix de WAV PCM + phase-locked cue grid)
  if (!meta || (meta.version ?? 0) < 3) return true;
  // 2. Mezcla exportada sin voces guía válidas cuando el canal de voz guía no estaba muteado
  if (!cuesMuted && typeof meta.cueVoiceCount === 'number' && meta.cueVoiceCount === 0) return true;
  // 3. Las secciones de Voz Guía se editaron en Studio Prompter después del último Exportar Mix En Vivo
  const sectionsUpdatedAt = pd?.sectionsUpdatedAt;
  if (sectionsUpdatedAt && meta.exportedAt) {
    const secTs = Date.parse(sectionsUpdatedAt);
    const expTs = Date.parse(meta.exportedAt);
    if (Number.isFinite(secTs) && Number.isFinite(expTs) && secTs > expTs + 1000) {
      return true;
    }
  }
  return false;
};

/**
 * Modo Ensayo MP3 (PC REHEARSAL + Celulares In-Ear):
 * Prioriza reproducir directamente `cue_mobile.mp3` cuando ya está descargado en la bóveda local,
 * garantizando paridad 1:1 de clic/voz guía y padding MP3 idéntico entre PC y celulares (~100 ms de carga),
 * sintetizando en RAM únicamente si falta el archivo CUE o si las secciones se editaron DESPUÉS de exportar.
 */
export const shouldSynthesizeCueInRehearsalMp3Mode = (
  song: any,
  hasDownloadedCueAudio: boolean
): boolean => {
  if (!song) return false;
  const pd = extractPrompterData(song);
  const bpm = Number(pd?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return false;

  const clickMuted = pd?.mixConfig?.click?.muted === true;
  const cuesMuted = pd?.mixConfig?.cues?.muted === true;
  if (clickMuted && cuesMuted) return false;

  if (!hasDownloadedCueAudio) {
    return true;
  }

  const meta = pd?.liveMixMeta as LiveMixMeta | undefined;
  const sectionsUpdatedAt = pd?.sectionsUpdatedAt;
  if (sectionsUpdatedAt && meta?.exportedAt) {
    const secTs = Date.parse(sectionsUpdatedAt);
    const expTs = Date.parse(meta.exportedAt);
    if (Number.isFinite(secTs) && Number.isFinite(expTs) && secTs > expTs + 1000) {
      return true;
    }
  }

  return false;
};

/**
 * Firma determinista única de la grilla CUE/Metrónomo de una canción (incluyendo hash de `beatTimes[]`),
 * usada por PC y celulares para verificar que ambos usan exactamente el mismo mapa de tiempo y clic.
 */
export const computeSongCueSignature = (song: any): string => {
  const pd = extractPrompterData(song) || {};
  const beats = Array.isArray(pd.beatTimes) ? pd.beatTimes : [];
  let beatsHash = 2166136261;
  for (let i = 0; i < beats.length; i++) {
    const q = Math.round((Number(beats[i]) || 0) * 1000);
    beatsHash ^= q & 0xffff;
    beatsHash = Math.imul(beatsHash, 16777619);
    beatsHash ^= (q >>> 16) & 0xffff;
    beatsHash = Math.imul(beatsHash, 16777619);
  }

  const secHash = Array.isArray(pd.sections)
    ? pd.sections
        .map((s: any) => `${s?.name || s?.section || ''}:${s?.time ?? ''}:${s?.cueEnabled !== false ? 1 : 0}`)
        .join('|')
    : '';

  const raw = JSON.stringify({
    v: pd.liveMixMeta?.version ?? 0,
    exp: pd.liveMixMeta?.exportedAt ?? '',
    upd: pd.sectionsUpdatedAt ?? '',
    cnt: Array.isArray(pd.sections) ? pd.sections.length : 0,
    secHash,
    bpm: pd.bpm ?? 0,
    ts: pd.timeSignature ?? '4/4',
    firstBeat: pd.firstBeatOffset ?? 0,
    beatsLen: beats.length,
    beatsHash: (beatsHash >>> 0).toString(16),
    click: pd.mixConfig?.click ?? null,
    cues: pd.mixConfig?.cues ?? null,
  });

  let fnv = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    fnv ^= raw.charCodeAt(i);
    fnv = Math.imul(fnv, 16777619);
  }
  return `cs1-${(fnv >>> 0).toString(16)}-${beats.length}-${Number(pd.bpm) || 0}`;
};

// Programador unificado de Guías de Voz: Coloca el conteo en el compás inmediatamente previo al inicio de la sección
export const scheduleSectionVoiceCues = (
  sections: any[] | undefined,
  bTimes: number[],
  beatsPerMeasure: number,
  preRollDuration: number,
  cueBuffers: Record<string, any>,
  schedule: (bufName: string, beatIndex: number) => void,
  downbeatIndex?: number
) => {
  if (!bTimes || bTimes.length === 0 || beatsPerMeasure <= 0) return;

  const scheduledBeats = new Set<number>();

  // 1. Encontrar el índice de beat donde arranca musicalmente el Compás 1 (downbeatIndex si existe)
  let songStartBeatIdx = 0;
  if (typeof downbeatIndex === 'number' && downbeatIndex >= 0 && downbeatIndex < bTimes.length) {
    songStartBeatIdx = downbeatIndex;
  } else {
    let minStartDiff = Infinity;
    for (let i = 0; i < bTimes.length; i++) {
      const diff = Math.abs(bTimes[i] - preRollDuration);
      if (diff < minStartDiff) {
        minStartDiff = diff;
        songStartBeatIdx = i;
      }
    }
  }

  const approxBeatDur =
    bTimes.length > 1
      ? Math.max(0.15, bTimes[Math.min(bTimes.length - 1, songStartBeatIdx + 1)] - bTimes[Math.max(0, songStartBeatIdx)])
      : 0.5;
  const approxBarDur = approxBeatDur * beatsPerMeasure;
  const songStartTime = bTimes[songStartBeatIdx] ?? preRollDuration;

  // 2. Programar cues para todas las secciones válidas (aceptando strings numéricos heredados)
  const validSections = (sections || [])
    .map((s: any) => ({
      ...s,
      time: typeof s?.time === 'number' ? s.time : Number(s?.time),
    }))
    .filter((s: any) => Number.isFinite(s.time))
    .sort((a: any, b: any) => a.time - b.time);

  // Detectar si ya existe una sección explícitamente posicionada sobre Compás 1
  const hasExplicitBar1Section = validSections.some(
    (s: any) => Math.abs((s.time + preRollDuration) - songStartTime) <= approxBeatDur * 0.6
  );

  let hasHandledSongStart = false;

  validSections.forEach((section: any, sIdx: number) => {
    const secTime = section.time + preRollDuration;
    let nearestBeatIdx = -1;
    let minDiff = Infinity;
    for (let i = 0; i < bTimes.length; i++) {
      const diff = Math.abs(bTimes[i] - secTime);
      if (diff < minDiff) {
        minDiff = diff;
        nearestBeatIdx = i;
      }
    }

    if (minDiff > 1.2 || nearestBeatIdx < 0) return;

    // Si es la sección de apertura colocada en t≈0 pero el Compás 1 real (firstBeatOffset) está
    // desplazado y no hay otra sección en Compás 1, anclar su conteo al Compás 1 real
    // para que "Intro, 2, 3, 4" caiga exactamente en fase con los downbeats y sin duplicar conteos.
    if (
      typeof downbeatIndex === 'number' &&
      sIdx === 0 &&
      !hasExplicitBar1Section &&
      secTime <= songStartTime + 0.15 &&
      (songStartTime - secTime < approxBarDur || section.time <= 0.15)
    ) {
      nearestBeatIdx = songStartBeatIdx;
    }

    if (Math.abs(nearestBeatIdx - songStartBeatIdx) <= 1) {
      hasHandledSongStart = true;
    }

    // Si el usuario silenció explícitamente la voz guía de esta sección, no programar audio
    if (section.cueEnabled === false) return;

    const resolvedName = resolveCueBufferName(section.name || section.section || '', cueBuffers);
    const beat1Cue = resolvedName || '1';

    // Si no caben todos los pulsos de un compás completo antes del downbeat (ej. preRollDuration === 0 en Compás 1),
    // anunciar la etiqueta de la sección directamente en su pulso de inicio para nunca perder el aviso vocal.
    if (nearestBeatIdx < beatsPerMeasure) {
      const directCue = resolvedName || (preRollDuration === 0 ? beat1Cue : '');
      if (directCue && !scheduledBeats.has(nearestBeatIdx)) {
        schedule(directCue, nearestBeatIdx);
        scheduledBeats.add(nearestBeatIdx);
      }
      return;
    }

    // El compás de conteo previo inicia exactamente 1 compás antes del downbeat de la sección
    const leadInStartIdx = nearestBeatIdx - beatsPerMeasure;

    // Pulso 1 del compás de conteo: Nombre de sección (e.g. "Intro", "Coro") o '1' si no existe audio específico
    if (!scheduledBeats.has(leadInStartIdx)) {
      schedule(beat1Cue, leadInStartIdx);
      scheduledBeats.add(leadInStartIdx);
    }

    // Pulsos 2 .. beatsPerMeasure en conteo progresivo natural: '2', '3', '4' hacia el golpe 1
    for (let b = 2; b <= beatsPerMeasure; b++) {
      const bIdx = leadInStartIdx + (b - 1);
      const cueNum = String(b);
      if (cueBuffers[cueNum] && !scheduledBeats.has(bIdx)) {
        schedule(cueNum, bIdx);
        scheduledBeats.add(bIdx);
      }
    }
  });

  // 3. Fallback inteligente: Si no hay sección creada al inicio (Compás 1),
  // programar el conteo previo para que el tema no comience en seco sin aviso
  if (!hasHandledSongStart && songStartBeatIdx >= beatsPerMeasure) {
    const leadInStartIdx = songStartBeatIdx - beatsPerMeasure;
    const defaultCue = cueBuffers['intro'] ? 'intro' : '1';
    if (!scheduledBeats.has(leadInStartIdx)) {
      schedule(defaultCue, leadInStartIdx);
      scheduledBeats.add(leadInStartIdx);
    }
    for (let b = 2; b <= beatsPerMeasure; b++) {
      const bIdx = leadInStartIdx + (b - 1);
      const cueNum = String(b);
      if (cueBuffers[cueNum] && !scheduledBeats.has(bIdx)) {
        schedule(cueNum, bIdx);
        scheduledBeats.add(bIdx);
      }
    }
  }
};

export interface ShiftedBeatGridResult {
  shiftedBeatTimes: number[];
  downbeatIndex: number;
  firstActiveBeatIndex: number;
}

/**
 * Construye la grilla global de pulsos (en segundos de AudioContext, incluyendo preRollDuration y manualGridOffset)
 * garantizando paridad 1:1 entre reproducción en vivo, hot-reload y exportación offline (con o sin beatTimes).
 */
export const buildShiftedBeatGrid = (
  prompterData: any,
  preRollDuration: number,
  maxSongDuration: number,
  manualGridOffset: number = 0
): ShiftedBeatGridResult => {
  const bpm = Number(prompterData?.bpm) || 120;
  const beatsPerMeasure = getBeatsPerMeasure(prompterData?.timeSignature);
  const beatInterval = 60 / Math.max(20, Math.min(300, bpm));
  const maxGlobalTime = preRollDuration + (maxSongDuration > 0 ? maxSongDuration : 600);
  const baseFirstBeat = getBaseFirstBeatOffset(prompterData);
  // Tolerancia de enganche al origen t=0 (absorbe drift de ±10..80ms de IA o Nudge negativo sin amputar el compás Pre-Roll)
  const startSnapTolerance = Math.min(0.08, beatInterval * 0.18);

  const computeFirstActiveBeatIndex = (downbeatIdx: number): number => {
    if (preRollDuration <= 0.001) return 0;
    // En modo Pre-Roll activo, comenzar siempre en un Pulso 1 (downbeat completo) para evitar clics huérfanos
    const rem = ((downbeatIdx % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
    return rem;
  };

  if (Array.isArray(prompterData?.beatTimes) && prompterData.beatTimes.length > 0) {
    const bTimes = prompterData.beatTimes.map(
      (t: number) => Number(t) + preRollDuration + manualGridOffset
    );
    if (bTimes[0] < 0 && bTimes[0] >= -startSnapTolerance) {
      bTimes[0] = 0;
    }
    let unshiftedCount = 0;
    let firstBeat = bTimes[0];
    while (firstBeat - beatInterval >= -startSnapTolerance && firstBeat > 0.015) {
      firstBeat -= beatInterval;
      const clampedBeat = Math.max(0, firstBeat);
      if (clampedBeat >= bTimes[0] - 0.001) break;
      bTimes.unshift(clampedBeat);
      unshiftedCount++;
    }
    let lastBeat = bTimes[bTimes.length - 1];
    while (lastBeat + beatInterval <= maxGlobalTime + 5) {
      lastBeat += beatInterval;
      bTimes.push(lastBeat);
    }

    const targetFirstBeatGlobal = Math.max(0, preRollDuration + baseFirstBeat + manualGridOffset);
    let downbeatIndex = -1;
    let bestDownbeatDiff = Math.min(0.15, beatInterval * 0.45);
    for (let i = 0; i < bTimes.length; i++) {
      const diff = Math.abs(bTimes[i] - targetFirstBeatGlobal);
      if (diff < bestDownbeatDiff) {
        bestDownbeatDiff = diff;
        downbeatIndex = i;
      }
    }
    if (downbeatIndex === -1) {
      downbeatIndex = unshiftedCount;
    }
    return {
      shiftedBeatTimes: bTimes,
      downbeatIndex,
      firstActiveBeatIndex: computeFirstActiveBeatIndex(downbeatIndex),
    };
  }

  // Fallback Grid cuando no hay beatTimes: Anclar el Golpe 1 del Compás 1 en (preRollDuration + baseFirstBeat + manualGridOffset)
  const anchorGlobalTime = Math.max(0, preRollDuration + baseFirstBeat + manualGridOffset);
  const bTimes: number[] = [anchorGlobalTime];
  let unshiftedCount = 0;

  let prevBeat = anchorGlobalTime;
  while (prevBeat - beatInterval >= -startSnapTolerance && prevBeat > 0.015) {
    prevBeat -= beatInterval;
    const clampedBeat = Math.max(0, prevBeat);
    if (clampedBeat >= bTimes[0] - 0.001) break;
    bTimes.unshift(clampedBeat);
    unshiftedCount++;
  }

  let nextBeat = anchorGlobalTime;
  while (nextBeat + beatInterval <= maxGlobalTime + 5) {
    nextBeat += beatInterval;
    bTimes.push(nextBeat);
  }

  return {
    shiftedBeatTimes: bTimes,
    downbeatIndex: unshiftedCount,
    firstActiveBeatIndex: computeFirstActiveBeatIndex(unshiftedCount),
  };
};

// Sintetizador en tiempo real de pista CUE (Clic + Voz Guía) en RAM
export const synthesizeLiveCueBuffer = async (
  audioCtx: AudioContext,
  prompterData: any,
  totalDuration: number,
  cueBuffers: Record<string, AudioBuffer>,
  cueOffsets: Record<string, number>,
  volume: number = 0.9,
  preRollOrOptions?: PreRollBars | SynthesizeLiveCueOptions
): Promise<AudioBuffer> => {
  const opts: SynthesizeLiveCueOptions =
    typeof preRollOrOptions === 'object' && preRollOrOptions !== null
      ? preRollOrOptions
      : preRollOrOptions !== undefined
      ? { preRollBars: preRollOrOptions }
      : {};

  const beatsPerMeasure = getBeatsPerMeasure(prompterData?.timeSignature);
  const effectiveBars: PreRollBars = opts.preRollBars ?? resolveEffectivePreRollBars(prompterData);
  const preRollDuration =
    typeof opts.exactPreRollSec === 'number' && Number.isFinite(opts.exactPreRollSec) && opts.exactPreRollSec >= 0
      ? opts.exactPreRollSec
      : opts.preRollBars !== undefined
      ? computePhaseLockedPreRollSeconds(prompterData, effectiveBars, 0)
      : resolveEffectivePreRoll(prompterData);

  const clickMuted = Boolean(opts.clickMuted);
  const cueMuted = Boolean(opts.cueMuted);
  const clickVol =
    typeof opts.clickVolume === 'number' && Number.isFinite(opts.clickVolume)
      ? Math.max(0, Math.min(1.5, opts.clickVolume))
      : volume;
  const cueVol =
    typeof opts.cueVolume === 'number' && Number.isFinite(opts.cueVolume)
      ? Math.max(0, Math.min(1.5, opts.cueVolume))
      : volume;
  const clickPan =
    typeof opts.clickPan === 'number' && Number.isFinite(opts.clickPan)
      ? Math.max(-1, Math.min(1, opts.clickPan))
      : 0;
  const cuePan =
    typeof opts.cuePan === 'number' && Number.isFinite(opts.cuePan)
      ? Math.max(-1, Math.min(1, opts.cuePan))
      : 0;

  const sampleRate = audioCtx.sampleRate;
  const lengthSeconds = Math.max(totalDuration, preRollDuration + LIVE_EXPORT_TAIL_SECONDS);
  const lengthSamples = Math.ceil(lengthSeconds * sampleRate);
  const numOutChannels: 1 | 2 = opts.outputChannels === 1 ? 1 : 2;

  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(numOutChannels, lengthSamples, sampleRate);

  const clickHighBuffer = generateClickBuffer(offlineCtx, 1200);
  const clickLowBuffer = generateClickBuffer(offlineCtx, 800);

  const { shiftedBeatTimes, downbeatIndex, firstActiveBeatIndex } = buildShiftedBeatGrid(
    prompterData,
    preRollDuration,
    Math.max(0, lengthSeconds - preRollDuration),
    0
  );

  // 1. Programar Clics de Metrónomo
  if (!clickMuted && clickVol > 0) {
    for (let beatCount = firstActiveBeatIndex; beatCount < shiftedBeatTimes.length; beatCount++) {
      const time = shiftedBeatTimes[beatCount];
      if (time >= 0 && time < lengthSeconds) {
        const measureBeat = (beatCount - downbeatIndex) % beatsPerMeasure;
        const normalizedMeasureBeat = ((measureBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
        const isHigh = normalizedMeasureBeat === 0;
        const buffer = isHigh ? clickHighBuffer : clickLowBuffer;

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        const gain = offlineCtx.createGain();
        gain.gain.value = clickVol;
        const panner = offlineCtx.createStereoPanner();
        panner.pan.value = clickPan;
        source.connect(gain);
        gain.connect(panner);
        panner.connect(offlineCtx.destination);
        source.start(time);
      }
    }
  }

  // 2. Programar Guías de Voz (Secciones y Conteo)
  if (!cueMuted && cueVol > 0) {
    const scheduleCue = (bufName: string, bIdx: number) => {
      const buf = cueBuffers[bufName];
      const cueOffset = cueOffsets[bufName] || 0;
      if (buf && bIdx >= firstActiveBeatIndex && bIdx < shiftedBeatTimes.length) {
        const absoluteTime = shiftedBeatTimes[bIdx];
        if (absoluteTime >= 0 && absoluteTime < lengthSeconds) {
          const source = offlineCtx.createBufferSource();
          source.buffer = buf;
          const gain = offlineCtx.createGain();
          gain.gain.value = cueVol;
          const panner = offlineCtx.createStereoPanner();
          panner.pan.value = cuePan;
          source.connect(gain);
          gain.connect(panner);
          panner.connect(offlineCtx.destination);
          source.start(absoluteTime, cueOffset);
        }
      }
    };

    scheduleSectionVoiceCues(
      prompterData?.sections,
      shiftedBeatTimes,
      beatsPerMeasure,
      preRollDuration,
      cueBuffers,
      scheduleCue,
      downbeatIndex
    );
  }

  return await offlineCtx.startRendering();
};
