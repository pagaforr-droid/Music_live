function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encodes a stereo or mono AudioBuffer into a studio-grade 24-bit Linear PCM RIFF WAVE Blob
 * (3 bytes per sample, little-endian) with TPDF (Triangular Probability Density Function) Dithering.
 */
export function encodeAudioBufferToWav24Bit(
  buffer: AudioBuffer,
  applyTpdfDither = true
): Blob {
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 3; // 24-bit PCM = 3 bytes
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataByteLength = numFrames * blockAlign;
  const totalBufferLength = 44 + dataByteLength;

  const arrayBuffer = new ArrayBuffer(totalBufferLength);
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  // 1. RIFF Header (12 bytes)
  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAsciiString(view, 8, 'WAVE');

  // 2. "fmt " Sub-chunk (24 bytes)
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (Linear Integer PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true); // 24 bits per sample

  // 3. "data" Sub-chunk (8 bytes + PCM payload)
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  const left = buffer.getChannelData(0);
  const right = numChannels > 1 ? buffer.getChannelData(1) : left;

  const MAX_INT24 = 8388607; // 2^23 - 1
  const MIN_INT24 = -8388608; // -2^23
  let writeOffset = 44;

  for (let i = 0; i < numFrames; i++) {
    // Channel 0 (Left) — Exact ±1 LSB Triangular PDF Dither (sum of two uniform [-0.5, 0.5] variates)
    const ditherL = applyTpdfDither ? Math.random() - Math.random() : 0;
    const scaledL = Math.round(left[i] * MAX_INT24 + ditherL);
    const intL = scaledL > MAX_INT24 ? MAX_INT24 : scaledL < MIN_INT24 ? MIN_INT24 : scaledL;

    bytes[writeOffset] = intL & 0xff;
    bytes[writeOffset + 1] = (intL >> 8) & 0xff;
    bytes[writeOffset + 2] = (intL >> 16) & 0xff;
    writeOffset += 3;

    if (numChannels > 1) {
      // Channel 1 (Right)
      const ditherR = applyTpdfDither ? Math.random() - Math.random() : 0;
      const scaledR = Math.round(right[i] * MAX_INT24 + ditherR);
      const intR = scaledR > MAX_INT24 ? MAX_INT24 : scaledR < MIN_INT24 ? MIN_INT24 : scaledR;

      bytes[writeOffset] = intR & 0xff;
      bytes[writeOffset + 1] = (intR >> 8) & 0xff;
      bytes[writeOffset + 2] = (intR >> 16) & 0xff;
      writeOffset += 3;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
