/**
 * Web Worker computing a multi-resolution min/max waveform peak pyramid
 * so rendering and zooming long tracks stays >= 60fps on the UI thread.
 */

export interface WaveformPyramid {
  sampleRate: number;
  length: number;
  durationSec: number;
  levels: Array<{
    bucketSize: number;
    mins: Float32Array;
    maxs: Float32Array;
  }>;
}

const BUCKET_SIZES = [64, 256, 1024, 4096];

self.onmessage = (
  ev: MessageEvent<{ id: number; left: Float32Array; right: Float32Array; sampleRate: number }>
) => {
  try {
    const { id, left, right, sampleRate } = ev.data;
    const len = left.length;
    const levels: WaveformPyramid['levels'] = [];
    const transfers: ArrayBuffer[] = [];

    for (const bucketSize of BUCKET_SIZES) {
      const count = Math.max(1, Math.ceil(len / bucketSize));
      const mins = new Float32Array(count);
      const maxs = new Float32Array(count);

      for (let b = 0; b < count; b++) {
        const s0 = b * bucketSize;
        const s1 = Math.min(len, s0 + bucketSize);
        let mn = 1.0;
        let mx = -1.0;
        for (let i = s0; i < s1; i++) {
          const val = 0.5 * (left[i] + right[i]);
          if (val < mn) mn = val;
          if (val > mx) mx = val;
        }
        mins[b] = mn > mx ? 0 : mn;
        maxs[b] = mx < mn ? 0 : mx;
      }

      levels.push({ bucketSize, mins, maxs });
      transfers.push(mins.buffer, maxs.buffer);
    }

    (self as unknown as Worker).postMessage(
      {
        id,
        success: true,
        pyramid: {
          sampleRate,
          length: len,
          durationSec: len / sampleRate,
          levels,
        } satisfies WaveformPyramid,
      },
      transfers
    );
  } catch (err) {
    self.postMessage({
      id: ev.data?.id,
      success: false,
      error: err instanceof Error ? err.message : 'Waveform worker error',
    });
  }
};
