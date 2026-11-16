import { detectPitchYin } from '../engine/PitchDetector';
import { sliceByTransients } from '../engine/Slicer';

export interface SamplerAnalysisRequest {
  id: number;
  kind: 'slice-transients' | 'detect-pitch';
  sourceId: string;
  mono: Float32Array;
  sampleRate: number;
  rangeStartSec?: number;
  rangeEndSec?: number;
  sensitivity?: number;
  minSpacingMs?: number;
}

self.onmessage = (ev: MessageEvent<SamplerAnalysisRequest>) => {
  try {
    const req = ev.data;
    if (req.kind === 'detect-pitch') {
      const pitch = detectPitchYin(req.mono, req.sampleRate);
      self.postMessage({ id: req.id, success: true, kind: req.kind, pitch });
      return;
    }

    const regions = sliceByTransients(
      req.sourceId,
      req.mono,
      req.sampleRate,
      req.rangeStartSec ?? 0,
      req.rangeEndSec ?? req.mono.length / req.sampleRate,
      req.sensitivity ?? 0.62,
      req.minSpacingMs ?? 95
    );
    self.postMessage({ id: req.id, success: true, kind: req.kind, regions });
  } catch (err) {
    self.postMessage({
      id: ev.data?.id,
      success: false,
      error: err instanceof Error ? err.message : 'Sampler analysis error',
    });
  }
};
