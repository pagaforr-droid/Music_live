import { detectPitchYin } from '../engine/PitchDetector';
import { sliceByTransients } from '../engine/Slicer';
import {
  analyzeBassProgressionFull,
  analyzeDrumStemFull,
  analyzeMonophonicStemNotesFull,
  analyzePolyphonicStemNotesFull,
  quantizeNoteEventsToTempo,
} from '../engine/FullStemAnalyzer';
import { analyzeImportedAudioFirst } from '../engine/PreImportAnalyzer';
import type {
  DetectedChordSegment,
  DetectionSourceMode,
  FullStemAnalysisResult,
  StemAnalysisMode,
  StemQuantizeMode,
} from '../types/sampler.types';

export interface SamplerAnalysisRequest {
  id: number;
  kind: 'slice-transients' | 'detect-pitch' | 'analyze-full-stem' | 'pre-analyze-audio';
  sourceId: string;
  mono: Float32Array;
  masterMono?: Float32Array;
  detectionSourceMode?: DetectionSourceMode;
  masterReferenceName?: string;
  isMasterInput?: boolean;
  sampleRate: number;
  rangeStartSec?: number;
  rangeEndSec?: number;
  sensitivity?: number;
  minSpacingMs?: number;
  stemMode?: StemAnalysisMode;
  bassFocus?: boolean;
  quantizeMode?: StemQuantizeMode;
  bpmHint?: number;
  lockedBpm?: number;
  maxPolyphony?: number;
  signature?: string;
  musicalKey?: string;
  camelotKey?: string;
  timeSignature?: string;
  detectedChords?: DetectedChordSegment[];
  beatOffsetSec?: number;
  beatTimes?: number[];
  downbeats?: number[];
  seedBeatTimes?: number[];
  seedDownbeats?: number[];
  seedKey?: string;
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
        timeSignature: req.timeSignature,
        seedBeatTimes: req.seedBeatTimes,
        seedDownbeats: req.seedDownbeats,
        seedKey: req.seedKey,
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
      const qMode: StemQuantizeMode = req.quantizeMode ?? (req.lockedBpm ? 'soft' : 'off');
      const durSec = req.mono.length / req.sampleRate;
      const result =
        mode === 'drums'
          ? analyzeDrumStemFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              minIntervalMs: req.minSpacingMs,
              bpmHint: req.bpmHint,
              lockedBpm: req.lockedBpm,
              musicalKey: req.musicalKey,
              camelotKey: req.camelotKey,
              detectedChords: req.detectedChords,
              beatOffsetSec: req.beatOffsetSec,
              beatTimes: req.beatTimes,
              downbeats: req.downbeats,
              quantizeMode: qMode,
              masterMono: req.masterMono,
              detectionSourceMode: req.detectionSourceMode,
              masterReferenceName: req.masterReferenceName,
              isMasterInput: req.isMasterInput,
            })
          : mode === 'polyphonic' && bassFocus
          ? analyzeBassProgressionFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              maxPolyphony: req.maxPolyphony,
              bpmHint: effectiveBpm,
              lockedBpm: req.lockedBpm,
              precomputedPoly: req.precomputedPoly,
              precomputedChords: req.detectedChords,
              musicalKey: req.musicalKey,
              camelotKey: req.camelotKey,
              beatOffsetSec: req.beatOffsetSec,
              beatTimes: req.beatTimes,
              downbeats: req.downbeats,
              quantizeMode: qMode,
              masterMono: req.masterMono,
              detectionSourceMode: req.detectionSourceMode,
              masterReferenceName: req.masterReferenceName,
            })
          : mode === 'monophonic'
          ? analyzeMonophonicStemNotesFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              bpmHint: req.bpmHint,
              lockedBpm: req.lockedBpm,
              bassOnly: bassFocus,
              musicalKey: req.musicalKey,
              camelotKey: req.camelotKey,
              detectedChords: req.detectedChords,
              beatOffsetSec: req.beatOffsetSec,
              beatTimes: req.beatTimes,
              downbeats: req.downbeats,
              quantizeMode: qMode,
              masterMono: req.masterMono,
              detectionSourceMode: req.detectionSourceMode,
              masterReferenceName: req.masterReferenceName,
            })
          : req.precomputedPoly && !bassFocus
          ? (() => {
              const targetBpm = req.lockedBpm ?? req.precomputedPoly.bpm;
              const activeBeats = req.beatTimes ?? req.precomputedPoly.beatTimes;
              const qNotes = quantizeNoteEventsToTempo(
                req.precomputedPoly.noteEvents,
                targetBpm,
                req.beatOffsetSec ?? req.precomputedPoly.beatOffsetSec ?? 0,
                durSec,
                qMode,
                false,
                activeBeats
              );
              return {
                ...req.precomputedPoly,
                quantizeMode: qMode,
                bpm: targetBpm,
                musicalKey: req.musicalKey ?? req.precomputedPoly.musicalKey,
                camelotKey: req.camelotKey ?? req.precomputedPoly.camelotKey,
                detectedChords: req.detectedChords ?? req.precomputedPoly.detectedChords,
                beatOffsetSec: req.beatOffsetSec ?? req.precomputedPoly.beatOffsetSec,
                beatTimes: activeBeats,
                downbeats: req.downbeats ?? req.precomputedPoly.downbeats,
                noteEvents: qNotes,
              };
            })()
          : analyzePolyphonicStemNotesFull(req.mono, req.sampleRate, {
              sensitivity: req.sensitivity,
              maxPolyphony: req.maxPolyphony,
              bpmHint: req.bpmHint,
              lockedBpm: req.lockedBpm,
              musicalKey: req.musicalKey,
              camelotKey: req.camelotKey,
              detectedChords: req.detectedChords,
              beatOffsetSec: req.beatOffsetSec,
              beatTimes: req.beatTimes,
              downbeats: req.downbeats,
              quantizeMode: qMode,
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
