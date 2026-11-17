import { detectPitchYin } from '../engine/PitchDetector';
import { sliceByTransients } from '../engine/Slicer';
import {
  analyzeBassProgressionFull,
  analyzeDrumStemFull,
  analyzeMonophonicStemNotesFull,
  analyzePolyphonicStemNotesFull,
} from '../engine/FullStemAnalyzer';
import type { StemAnalysisMode } from '../types/sampler.types';

export interface SamplerAnalysisRequest {
  id: number;
  kind: 'slice-transients' | 'detect-pitch' | 'analyze-full-stem';
  sourceId: string;
  mono: Float32Array;
  sampleRate: number;
  rangeStartSec?: number;
  rangeEndSec?: number;
  sensitivity?: number;
  minSpacingMs?: number;
  stemMode?: StemAnalysisMode;
  bassFocus?: boolean;
  bpmHint?: number;
  maxPolyphony?: number;
}

self.onmessage = (ev: MessageEvent<SamplerAnalysisRequest>) => {
  try {
    const req = ev.data;
    if (req.kind === 'detect-pitch') {
      const pitch = detectPitchYin(req.mono, req.sampleRate);
      self.postMessage({ id: req.id, success: true, kind: req.kind, pitch });
      return;
    }

    if (req.kind === 'analyze-full-stem') {
      const mode = req.stemMode ?? 'drums';
      const bassFocus = Boolean(req.bassFocus);
      const result =
        mode === 'drums'
          ? analyzeDrumStemFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              minIntervalMs: req.minSpacingMs,
              bpmHint: req.bpmHint,
            })
          : mode === 'polyphonic' && bassFocus
          ? analyzeBassProgressionFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              maxPolyphony: req.maxPolyphony,
              bpmHint: req.bpmHint,
            })
          : mode === 'monophonic'
          ? analyzeMonophonicStemNotesFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              bpmHint: req.bpmHint,
              bassOnly: bassFocus,
            })
          : analyzePolyphonicStemNotesFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              maxPolyphony: req.maxPolyphony,
              bpmHint: req.bpmHint,
            });

      self.postMessage({ id: req.id, success: true, kind: req.kind, result });
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
