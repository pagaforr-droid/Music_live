import { detectPitchYin } from '../engine/PitchDetector';
import { sliceByTransients } from '../engine/Slicer';
import {
  analyzeBassProgressionFull,
  analyzeDrumStemFull,
  analyzeMonophonicStemNotesFull,
  analyzePolyphonicStemNotesFull,
} from '../engine/FullStemAnalyzer';
import { analyzeImportedAudioFirst } from '../engine/PreImportAnalyzer';
import type {
  DetectedChordSegment,
  FullStemAnalysisResult,
  StemAnalysisMode,
} from '../types/sampler.types';

export interface SamplerAnalysisRequest {
  id: number;
  kind: 'slice-transients' | 'detect-pitch' | 'analyze-full-stem' | 'pre-analyze-audio';
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
  lockedBpm?: number;
  maxPolyphony?: number;
  signature?: string;
  musicalKey?: string;
  detectedChords?: DetectedChordSegment[];
  beatOffsetSec?: number;
  precomputedPoly?: FullStemAnalysisResult;
}

self.onmessage = (ev: MessageEvent<SamplerAnalysisRequest>) => {
  try {
    const req = ev.data;
    if (req.kind === 'detect-pitch') {
      const pitch = detectPitchYin(req.mono, req.sampleRate);
      self.postMessage({ id: req.id, success: true, kind: req.kind, pitch });
      return;
    }

    if (req.kind === 'pre-analyze-audio') {
      const entry = analyzeImportedAudioFirst(req.mono, req.sampleRate, {
        bpmHint: req.bpmHint,
        sensitivity: req.sensitivity,
        signature: req.signature,
      });
      self.postMessage({
        id: req.id,
        success: true,
        kind: req.kind,
        preAnalysis: entry.memory,
        polyResult: entry.polyResult,
      });
      return;
    }

    if (req.kind === 'analyze-full-stem') {
      const mode = req.stemMode ?? 'drums';
      const bassFocus = Boolean(req.bassFocus);
      const effectiveBpm = req.lockedBpm ?? req.bpmHint;
      const result =
        mode === 'drums'
          ? analyzeDrumStemFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              minIntervalMs: req.minSpacingMs,
              bpmHint: req.bpmHint,
              lockedBpm: req.lockedBpm,
              musicalKey: req.musicalKey,
              detectedChords: req.detectedChords,
              beatOffsetSec: req.beatOffsetSec,
            })
          : mode === 'polyphonic' && bassFocus
          ? analyzeBassProgressionFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              maxPolyphony: req.maxPolyphony,
              bpmHint: effectiveBpm,
              precomputedPoly: req.precomputedPoly,
              precomputedChords: req.detectedChords,
              musicalKey: req.musicalKey,
              beatOffsetSec: req.beatOffsetSec,
            })
          : mode === 'monophonic'
          ? analyzeMonophonicStemNotesFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              bpmHint: req.bpmHint,
              lockedBpm: req.lockedBpm,
              bassOnly: bassFocus,
              musicalKey: req.musicalKey,
              detectedChords: req.detectedChords,
              beatOffsetSec: req.beatOffsetSec,
            })
          : req.precomputedPoly && !bassFocus
          ? {
              ...req.precomputedPoly,
              bpm: req.lockedBpm ?? req.precomputedPoly.bpm,
              musicalKey: req.musicalKey ?? req.precomputedPoly.musicalKey,
              detectedChords: req.detectedChords ?? req.precomputedPoly.detectedChords,
              beatOffsetSec: req.beatOffsetSec ?? req.precomputedPoly.beatOffsetSec,
            }
          : analyzePolyphonicStemNotesFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              maxPolyphony: req.maxPolyphony,
              bpmHint: req.bpmHint,
              lockedBpm: req.lockedBpm,
              musicalKey: req.musicalKey,
              detectedChords: req.detectedChords,
              beatOffsetSec: req.beatOffsetSec,
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
