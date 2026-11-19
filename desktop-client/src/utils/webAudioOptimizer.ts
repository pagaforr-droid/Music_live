import { loadLameJs } from './loadLameJs';
import { formatSecondsToMMSS } from '../services/bandContentService';

export interface AudioOptimizationResult {
  file: File;
  duration: string;
  wasOptimized: boolean;
  originalBytes: number;
  finalBytes: number;
}

const VALID_MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

export function isLosslessOrHeavyAudio(file: File): boolean {
  const lower = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return (
    lower.endsWith('.wav') ||
    lower.endsWith('.wave') ||
    lower.endsWith('.aif') ||
    lower.endsWith('.aiff') ||
    lower.endsWith('.flac') ||
    type.includes('wav') ||
    type.includes('flac') ||
    type.includes('aiff')
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function resampleToSupportedRate(buffer: AudioBuffer): Promise<AudioBuffer> {
  if (VALID_MP3_SAMPLE_RATES.includes(buffer.sampleRate)) {
    return buffer;
  }
  const targetRate = buffer.sampleRate >= 48000 ? 48000 : 44100;
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const targetLength = Math.max(1, Math.ceil(buffer.duration * targetRate));
  const offline = new OfflineAudioContext(channels, targetLength, targetRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

function floatToInt16Chunk(
  input: Float32Array,
  output: Int16Array,
  offset: number,
  length: number
): void {
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, input[offset + i]));
    output[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
}

/**
 * Transcodes heavy studio WAV / AIFF / FLAC files into 320 kbps Hi-Fi MP3 directly
 * in the browser using lamejs, keeping the UI responsive via periodic macrotask yields.
 * Reduces typical 24-bit/48kHz WAV (~70 MB) to ~9 MB for instant web streaming and
 * compatibility with Supabase Storage's 50 MB per-object limit.
 */
export async function optimizeAudioForWeb(
  file: File,
  onStatus?: (stage: string, pct: number) => void
): Promise<AudioOptimizationResult> {
  const originalBytes = file.size;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AC) {
    throw new Error('Tu navegador no soporta AudioContext para convertir WAV a MP3.');
  }

  onStatus?.(`Leyendo archivo (${formatBytes(originalBytes)})...`, 4);
  const arrayBuffer = await file.arrayBuffer();

  onStatus?.('Decodificando audio de estudio...', 12);
  const audioCtx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    audioCtx.close().catch(() => {});
  }

  const duration = formatSecondsToMMSS(decoded.duration);
  const readyBuffer = await resampleToSupportedRate(decoded);

  onStatus?.('Cargando codificador MP3 320 kbps...', 20);
  const lamejs = await loadLameJs();

  const channels = Math.min(2, Math.max(1, readyBuffer.numberOfChannels));
  const sampleRate = readyBuffer.sampleRate;
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, 320);

  const left = readyBuffer.getChannelData(0);
  const right = channels > 1 ? readyBuffer.getChannelData(1) : left;

  const blockSize = 1152;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const left16 = new Int16Array(blockSize);
  const right16 = new Int16Array(blockSize);

  const totalSamples = left.length;
  let offset = 0;
  let blocksProcessed = 0;
  let lastReportedPct = 20;

  while (offset < totalSamples) {
    const len = Math.min(blockSize, totalSamples - offset);
    const lSlice = len === blockSize ? left16 : new Int16Array(len);
    floatToInt16Chunk(left, lSlice, offset, len);

    let encoded: Int8Array;
    if (channels > 1) {
      const rSlice = len === blockSize ? right16 : new Int16Array(len);
      floatToInt16Chunk(right, rSlice, offset, len);
      encoded = encoder.encodeBuffer(lSlice, rSlice);
    } else {
      encoded = encoder.encodeBuffer(lSlice);
    }

    if (encoded.length > 0) {
      const copy = new Uint8Array(new ArrayBuffer(encoded.length));
      copy.set(encoded);
      chunks.push(copy);
    }

    offset += len;
    blocksProcessed++;

    // Yield every 80 blocks so React can repaint progress smoothly without freezing the tab
    if (blocksProcessed % 80 === 0) {
      const pct = Math.min(96, 20 + Math.round((offset / totalSamples) * 76));
      if (pct !== lastReportedPct) {
        lastReportedPct = pct;
        onStatus?.(`Optimizando a MP3 320 kbps (${pct}%)...`, pct);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }

  const flushed: Int8Array = encoder.flush();
  if (flushed.length > 0) {
    const copy = new Uint8Array(new ArrayBuffer(flushed.length));
    copy.set(flushed);
    chunks.push(copy);
  }

  onStatus?.('Empaquetando MP3 320 kbps...', 99);
  const mp3Blob = new Blob(chunks, { type: 'audio/mpeg' });
  const mp3Name = file.name.replace(/\.[^/.]+$/, '') + '.mp3';
  const mp3File = new File([mp3Blob], mp3Name, { type: 'audio/mpeg' });

  return {
    file: mp3File,
    duration,
    wasOptimized: true,
    originalBytes,
    finalBytes: mp3File.size,
  };
}
