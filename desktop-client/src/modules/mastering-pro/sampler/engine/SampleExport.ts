import { encodeAudioBufferToWav24Bit } from '../../engine/Wav24BitEncoder';
import { loadLameJs } from '../../../../utils/loadLameJs';
import type { SampleKit, SampleRegion } from '../types/sampler.types';

export interface WavMetadataChunks {
  rootMidiNote?: number;
  loopStartSample?: number;
  loopEndSample?: number;
  cueSamples?: number[];
}

/**
 * Appends standard RIFF 'smpl' (root MIDI note + loop points) and 'cue ' (slice markers)
 * chunks to a 24-bit WAV Blob so DAWs (Reaper, Ableton, Logic) recognize loops & root notes.
 */
export async function encodeBufferToWav24WithMetadata(
  buffer: AudioBuffer,
  meta?: WavMetadataChunks
): Promise<Blob> {
  const baseBlob = encodeAudioBufferToWav24Bit(buffer, true);
  if (
    !meta ||
    (meta.rootMidiNote === undefined &&
      meta.loopStartSample === undefined &&
      (!meta.cueSamples || meta.cueSamples.length === 0))
  ) {
    return baseBlob;
  }

  const baseBuf = await baseBlob.arrayBuffer();
  const extraChunks: Uint8Array[] = [];

  // 1. Optional 'smpl' chunk (36 bytes header + 24 bytes per sample loop)
  if (meta.rootMidiNote !== undefined || meta.loopStartSample !== undefined) {
    const hasLoop =
      meta.loopStartSample !== undefined &&
      meta.loopEndSample !== undefined &&
      meta.loopEndSample > meta.loopStartSample;
    const chunkPayloadSize = 36 + (hasLoop ? 24 : 0);
    const smpl = new Uint8Array(8 + chunkPayloadSize);
    const dv = new DataView(smpl.buffer);
    smpl[0] = 0x73; smpl[1] = 0x6d; smpl[2] = 0x70; smpl[3] = 0x6c; // 'smpl'
    dv.setUint32(4, chunkPayloadSize, true);
    dv.setUint32(8, 0, true); // manufacturer
    dv.setUint32(12, 0, true); // product
    dv.setUint32(16, Math.round(1e9 / buffer.sampleRate), true); // sample period ns
    dv.setUint32(20, Math.max(0, Math.min(127, meta.rootMidiNote ?? 60)), true); // MIDI unity note
    dv.setUint32(24, 0, true); // MIDI pitch fraction
    dv.setUint32(28, 0, true); // SMPTE format
    dv.setUint32(32, 0, true); // SMPTE offset
    dv.setUint32(36, hasLoop ? 1 : 0, true); // num sample loops
    dv.setUint32(40, 0, true); // sampler data
    if (hasLoop) {
      dv.setUint32(44, 0, true); // cue point ID
      dv.setUint32(48, 0, true); // loop type forward
      dv.setUint32(52, Math.max(0, Math.round(meta.loopStartSample!)), true);
      dv.setUint32(56, Math.max(0, Math.round(meta.loopEndSample!)), true);
      dv.setUint32(60, 0, true); // fraction
      dv.setUint32(64, 0, true); // play count (infinite)
    }
    extraChunks.push(smpl);
  }

  // 2. Optional 'cue ' chunk (4 bytes count + 24 bytes per cue)
  if (meta.cueSamples && meta.cueSamples.length > 0) {
    const count = meta.cueSamples.length;
    const cuePayloadSize = 4 + count * 24;
    const cue = new Uint8Array(8 + cuePayloadSize);
    const dv = new DataView(cue.buffer);
    cue[0] = 0x63; cue[1] = 0x75; cue[2] = 0x65; cue[3] = 0x20; // 'cue '
    dv.setUint32(4, cuePayloadSize, true);
    dv.setUint32(8, count, true);
    meta.cueSamples.forEach((samplePos, idx) => {
      const off = 12 + idx * 24;
      dv.setUint32(off, idx + 1, true); // ID
      dv.setUint32(off + 4, samplePos, true); // position
      cue[off + 8] = 0x64; cue[off + 9] = 0x61; cue[off + 10] = 0x74; cue[off + 11] = 0x61; // 'data'
      dv.setUint32(off + 12, 0, true);
      dv.setUint32(off + 16, 0, true);
      dv.setUint32(off + 20, samplePos, true);
    });
    extraChunks.push(cue);
  }

  const totalExtra = extraChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(baseBuf.byteLength + totalExtra);
  out.set(new Uint8Array(baseBuf), 0);

  let writePos = baseBuf.byteLength;
  for (const chunk of extraChunks) {
    out.set(chunk, writePos);
    writePos += chunk.byteLength;
  }

  // Update RIFF total chunk size (total length - 8)
  const outView = new DataView(out.buffer);
  outView.setUint32(4, out.byteLength - 8, true);

  return new Blob([out], { type: 'audio/wav' });
}

export async function encodeBufferToMp3(
  buffer: AudioBuffer,
  kbps = 320
): Promise<Blob> {
  const lamejs = await loadLameJs();
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sr = buffer.sampleRate;
  const encoder = new lamejs.Mp3Encoder(numChannels, sr, kbps);

  const floatToInt16 = (f: Float32Array): Int16Array => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    return out;
  };

  const left = floatToInt16(buffer.getChannelData(0));
  const right =
    numChannels > 1 ? floatToInt16(buffer.getChannelData(1)) : left;

  const blockSize = 1152;
  const mp3Parts: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const lChunk = left.subarray(i, i + blockSize);
    const rChunk = right.subarray(i, i + blockSize);
    const encoded: Int8Array =
      numChannels > 1
        ? encoder.encodeBuffer(lChunk, rChunk)
        : encoder.encodeBuffer(lChunk);
    if (encoded.length > 0) {
      mp3Parts.push(new Uint8Array(encoded));
    }
  }
  const flush: Int8Array = encoder.flush();
  if (flush.length > 0) mp3Parts.push(new Uint8Array(flush));

  return new Blob(mp3Parts as BlobPart[], { type: 'audio/mpeg' });
}

export async function exportSlicePackZip(params: {
  kit: SampleKit;
  regions: SampleRegion[];
  renderRegion: (region: SampleRegion) => AudioBuffer;
  rootMidiNote?: number;
}): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  const manifestItems: Array<{
    file: string;
    regionId: string;
    name: string;
    startSec: number;
    endSec: number;
    durationSec: number;
  }> = [];

  for (let i = 0; i < params.regions.length; i++) {
    const reg = params.regions[i];
    const buf = params.renderRegion(reg);
    const wavBlob = await encodeBufferToWav24WithMetadata(buf, {
      rootMidiNote: params.rootMidiNote ?? 60,
    });
    const clean = reg.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || `slice_${i + 1}`;
    const fileName = `${String(i + 1).padStart(2, '0')}_${clean}.wav`;
    zip.file(fileName, wavBlob);
    manifestItems.push({
      file: fileName,
      regionId: reg.id,
      name: reg.name,
      startSec: reg.startSec,
      endSec: reg.endSec,
      durationSec: Number(buf.duration.toFixed(4)),
    });
  }

  zip.file(
    'kit.json',
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        kitName: params.kit.name,
        kit: params.kit,
        slices: manifestItems,
      },
      null,
      2
    )
  );

  return zip.generateAsync({ type: 'blob' });
}

export function triggerFileDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
