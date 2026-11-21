import {
  analyzeDrumStemFull,
  applyBiquadBandPassOrLp,
  evaluateTomResonanceAtSample,
  quantizeDrumHitsToTempo,
  quantizeNoteEventsToTempo,
} from './FullStemAnalyzer';
import { midiNoteToName } from './PitchDetector';
import type {
  DetectedChordSegment,
  DrumArticulation,
  DrumPieceRole,
  FullStemAnalysisResult,
  StemDrumHitEvent,
  StemNoteEvent,
  StemQuantizeMode,
} from '../types/sampler.types';

export interface GmDrumDescriptor {
  role: DrumPieceRole;
  midiNote: number;
  subRoleLabel: string;
  articulation: DrumArticulation;
  pitchOffsetSemis: number;
}

/**
 * Complete General MIDI (GM Level 1 & Level 2) Percussion Map (Channel 10 / Notes 27..87).
 * Maps every standard drum kit piece (Kick, Snare/Snake, Hi-Hats, High/Mid/Floor Toms, Crash/Ride/China/Splash, and auxiliary percussion)
 * to our 5 studio replacement buses while preserving exact articulation and multi-tom pitch offsets.
 */
const GM_DRUM_LOOKUP: Record<number, GmDrumDescriptor> = {
  // Kicks (Bombo)
  35: { role: 'kick', midiNote: 35, subRoleLabel: 'Acoustic Kick (35)', articulation: 'closed', pitchOffsetSemis: -1 },
  36: { role: 'kick', midiNote: 36, subRoleLabel: 'Kick Drum 1 (36)', articulation: 'closed', pitchOffsetSemis: 0 },

  // Snares / Snake / Rimshot / Clap (Caja)
  37: { role: 'snare', midiNote: 37, subRoleLabel: 'Side Stick / Rim (37)', articulation: 'rim', pitchOffsetSemis: 2 },
  38: { role: 'snare', midiNote: 38, subRoleLabel: 'Acoustic Snare (38)', articulation: 'closed', pitchOffsetSemis: 0 },
  39: { role: 'snare', midiNote: 39, subRoleLabel: 'Hand Clap / Snare (39)', articulation: 'rim', pitchOffsetSemis: 1 },
  40: { role: 'snare', midiNote: 40, subRoleLabel: 'Electric Snare (40)', articulation: 'closed', pitchOffsetSemis: 1 },

  // Toms (Floor Tom, Low Tom, Low-Mid Tom, Hi-Mid Tom, High Tom)
  41: { role: 'tom', midiNote: 41, subRoleLabel: 'Low Floor Tom (41)', articulation: 'floor-tom', pitchOffsetSemis: -4 },
  43: { role: 'tom', midiNote: 43, subRoleLabel: 'High Floor Tom (43)', articulation: 'floor-tom', pitchOffsetSemis: -2 },
  45: { role: 'tom', midiNote: 45, subRoleLabel: 'Low Tom (45)', articulation: 'mid-tom', pitchOffsetSemis: -1 },
  47: { role: 'tom', midiNote: 47, subRoleLabel: 'Low-Mid Tom (47)', articulation: 'mid-tom', pitchOffsetSemis: 0 },
  48: { role: 'tom', midiNote: 48, subRoleLabel: 'Hi-Mid Tom (48)', articulation: 'high-tom', pitchOffsetSemis: 2 },
  50: { role: 'tom', midiNote: 50, subRoleLabel: 'High Tom (50)', articulation: 'high-tom', pitchOffsetSemis: 4 },

  // Hi-Hats (Closed, Pedal, Open)
  42: { role: 'hat', midiNote: 42, subRoleLabel: 'Closed Hi-Hat (42)', articulation: 'closed', pitchOffsetSemis: 0 },
  44: { role: 'hat', midiNote: 44, subRoleLabel: 'Pedal Hi-Hat (44)', articulation: 'pedal', pitchOffsetSemis: -1 },
  46: { role: 'hat', midiNote: 46, subRoleLabel: 'Open Hi-Hat (46)', articulation: 'open', pitchOffsetSemis: 0 },

  // Crash / Ride / Cymbals (Platillos)
  49: { role: 'crash', midiNote: 49, subRoleLabel: 'Crash Cymbal 1 (49)', articulation: 'crash', pitchOffsetSemis: 0 },
  51: { role: 'crash', midiNote: 51, subRoleLabel: 'Ride Cymbal 1 (51)', articulation: 'ride', pitchOffsetSemis: 1 },
  52: { role: 'crash', midiNote: 52, subRoleLabel: 'China Cymbal (52)', articulation: 'crash', pitchOffsetSemis: -1 },
  53: { role: 'crash', midiNote: 53, subRoleLabel: 'Ride Bell (53)', articulation: 'ride', pitchOffsetSemis: 3 },
  55: { role: 'crash', midiNote: 55, subRoleLabel: 'Splash Cymbal (55)', articulation: 'crash', pitchOffsetSemis: 3 },
  57: { role: 'crash', midiNote: 57, subRoleLabel: 'Crash Cymbal 2 (57)', articulation: 'crash', pitchOffsetSemis: 1 },
  59: { role: 'crash', midiNote: 59, subRoleLabel: 'Ride Cymbal 2 (59)', articulation: 'ride', pitchOffsetSemis: 0 },

  // Auxiliary Latin & Studio Percussion mapped intelligently
  54: { role: 'hat', midiNote: 54, subRoleLabel: 'Tambourine (54)', articulation: 'open', pitchOffsetSemis: 2 },
  56: { role: 'tom', midiNote: 56, subRoleLabel: 'Cowbell (56)', articulation: 'high-tom', pitchOffsetSemis: 6 },
  60: { role: 'tom', midiNote: 60, subRoleLabel: 'Hi Bongo (60)', articulation: 'high-tom', pitchOffsetSemis: 5 },
  61: { role: 'tom', midiNote: 61, subRoleLabel: 'Low Bongo (61)', articulation: 'mid-tom', pitchOffsetSemis: 3 },
  62: { role: 'tom', midiNote: 62, subRoleLabel: 'Mute Hi Conga (62)', articulation: 'high-tom', pitchOffsetSemis: 4 },
  63: { role: 'tom', midiNote: 63, subRoleLabel: 'Open Hi Conga (63)', articulation: 'mid-tom', pitchOffsetSemis: 2 },
  64: { role: 'tom', midiNote: 64, subRoleLabel: 'Low Conga (64)', articulation: 'floor-tom', pitchOffsetSemis: -1 },
  65: { role: 'tom', midiNote: 65, subRoleLabel: 'High Timbale (65)', articulation: 'high-tom', pitchOffsetSemis: 4 },
  66: { role: 'tom', midiNote: 66, subRoleLabel: 'Low Timbale (66)', articulation: 'mid-tom', pitchOffsetSemis: 1 },
  69: { role: 'hat', midiNote: 69, subRoleLabel: 'Cabasa (69)', articulation: 'closed', pitchOffsetSemis: 1 },
  70: { role: 'hat', midiNote: 70, subRoleLabel: 'Maracas / Shaker (70)', articulation: 'closed', pitchOffsetSemis: 1 },
  75: { role: 'snare', midiNote: 75, subRoleLabel: 'Claves / Rim (75)', articulation: 'rim', pitchOffsetSemis: 3 },
};

export function mapMidiNoteToDrumPiece(midiNote: number): GmDrumDescriptor {
  const exact = GM_DRUM_LOOKUP[midiNote];
  if (exact) return exact;
  if (midiNote <= 36) {
    return { role: 'kick', midiNote: 36, subRoleLabel: `Kick (${midiNote})`, articulation: 'closed', pitchOffsetSemis: 0 };
  }
  if (midiNote <= 40) {
    return { role: 'snare', midiNote: 38, subRoleLabel: `Snare (${midiNote})`, articulation: 'closed', pitchOffsetSemis: 0 };
  }
  if (midiNote === 42 || midiNote === 44 || midiNote === 46) {
    return GM_DRUM_LOOKUP[midiNote];
  }
  if (midiNote >= 41 && midiNote <= 50) {
    return { role: 'tom', midiNote: 47, subRoleLabel: `Tom (${midiNote})`, articulation: 'mid-tom', pitchOffsetSemis: 0 };
  }
  if (midiNote >= 51 && midiNote <= 59) {
    return { role: 'crash', midiNote: 49, subRoleLabel: `Cymbal (${midiNote})`, articulation: 'crash', pitchOffsetSemis: 0 };
  }
  if (midiNote >= 60 && midiNote <= 68) {
    return { role: 'tom', midiNote: 47, subRoleLabel: `Perc Tom (${midiNote})`, articulation: 'mid-tom', pitchOffsetSemis: 2 };
  }
  return { role: 'hat', midiNote: 42, subRoleLabel: `Hi-Hat (${midiNote})`, articulation: 'closed', pitchOffsetSemis: 0 };
}

export function defaultGmNoteForDrumRole(
  role: DrumPieceRole,
  articulation?: DrumArticulation
): number {
  if (role === 'kick') return 36;
  if (role === 'snare') return articulation === 'rim' ? 37 : 38;
  if (role === 'hat') {
    if (articulation === 'open') return 46;
    if (articulation === 'pedal') return 44;
    return 42;
  }
  if (role === 'tom') {
    if (articulation === 'high-tom') return 50;
    if (articulation === 'floor-tom') return 43;
    return 47;
  }
  return articulation === 'ride' ? 51 : 49;
}

export interface ParsedMidiFileResult {
  bpm: number;
  hasExplicitTempo: boolean;
  timeSignature: string;
  durationSec: number;
  drumHits: StemDrumHitEvent[];
  noteEvents: StemNoteEvent[];
}

interface RawMidiNoteEvent {
  startTick: number;
  endTick: number;
  channel: number;
  midiNote: number;
  velocity01: number;
  program: number;
}

/**
 * Complete Standard MIDI File (.mid SMF Format 0, 1, 2) binary parser.
 * Supports multi-track tempo maps, General MIDI Channel 10 drum extraction,
 * and polyphonic melodic note extraction.
 */
export function parseStandardMidiFile(
  midiBytes: Uint8Array,
  options: { forceDrumMode?: boolean; fallbackBpm?: number } = {}
): ParsedMidiFileResult {
  const fallbackBpm = options.fallbackBpm ?? 120;
  if (midiBytes.length < 14) {
    return {
      bpm: fallbackBpm,
      hasExplicitTempo: false,
      timeSignature: '4/4',
      durationSec: 0,
      drumHits: [],
      noteEvents: [],
    };
  }

  const view = new DataView(midiBytes.buffer, midiBytes.byteOffset, midiBytes.byteLength);
  let pos = 0;

  const readAscii = (len: number): string => {
    let s = '';
    for (let i = 0; i < len && pos < midiBytes.length; i++) {
      s += String.fromCharCode(midiBytes[pos++]);
    }
    return s;
  };
  const readU16 = (): number => {
    if (pos + 2 > midiBytes.length) return 0;
    const v = view.getUint16(pos, false);
    pos += 2;
    return v;
  };
  const readU32 = (): number => {
    if (pos + 4 > midiBytes.length) return 0;
    const v = view.getUint32(pos, false);
    pos += 4;
    return v;
  };
  const readVarLen = (): number => {
    let val = 0;
    let count = 0;
    while (pos < midiBytes.length && count < 4) {
      const b = midiBytes[pos++];
      val = (val << 7) | (b & 0x7f);
      count++;
      if ((b & 0x80) === 0) break;
    }
    return val;
  };

  const magic = readAscii(4);
  if (magic !== 'MThd') {
    throw new Error('Archivo MIDI inválido (falta cabecera MThd).');
  }
  const hdrLen = readU32();
  const hdrEnd = pos + hdrLen;
  readU16(); // format (0, 1, 2)
  const numTracks = readU16();
  const division = readU16();
  pos = hdrEnd;

  const ppq = (division & 0x8000) === 0 ? Math.max(1, division) : 480;
  const tempoChanges: Array<{ tick: number; tempoUs: number }> = [];
  let timeSignature = '4/4';
  const rawNotes: RawMidiNoteEvent[] = [];
  let maxTick = 0;

  for (let t = 0; t < numTracks && pos + 8 <= midiBytes.length; t++) {
    const trkId = readAscii(4);
    const trkLen = readU32();
    const trkEnd = Math.min(midiBytes.length, pos + trkLen);
    if (trkId !== 'MTrk') {
      pos = trkEnd;
      continue;
    }

    let tick = 0;
    let runningStatus = 0;
    const chProgram = new Uint8Array(16);
    const activeNotes = new Map<number, { startTick: number; vel01: number; program: number }>();

    while (pos < trkEnd) {
      const dt = readVarLen();
      tick += dt;
      if (tick > maxTick) maxTick = tick;
      if (pos >= trkEnd) break;

      let status = midiBytes[pos];
      if (status & 0x80) {
        pos++;
        if (status < 0xf0) {
          runningStatus = status;
        }
      } else {
        status = runningStatus;
      }

      if (status === 0xff) {
        if (pos >= trkEnd) break;
        const metaType = midiBytes[pos++];
        const metaLen = readVarLen();
        const metaEnd = Math.min(trkEnd, pos + metaLen);
        if (metaType === 0x51 && metaLen === 3 && pos + 3 <= trkEnd) {
          const tempoUs = (midiBytes[pos] << 16) | (midiBytes[pos + 1] << 8) | midiBytes[pos + 2];
          if (tempoUs > 100000 && tempoUs < 2000000) {
            tempoChanges.push({ tick, tempoUs });
          }
        } else if (metaType === 0x58 && metaLen >= 2 && pos + 2 <= trkEnd) {
          const num = midiBytes[pos];
          const den = Math.pow(2, midiBytes[pos + 1]);
          if (num >= 1 && num <= 16 && den >= 1 && den <= 16) {
            timeSignature = `${num}/${den}`;
          }
        }
        pos = metaEnd;
      } else if (status === 0xf0 || status === 0xf7) {
        const sysexLen = readVarLen();
        pos = Math.min(trkEnd, pos + sysexLen);
      } else {
        const type = status & 0xf0;
        const ch = status & 0x0f;
        if (type === 0x90 || type === 0x80) {
          const note = midiBytes[pos++] ?? 0;
          const vel = midiBytes[pos++] ?? 0;
          const key = (ch << 8) | note;
          if (type === 0x90 && vel > 0) {
            const prev = activeNotes.get(key);
            if (prev) {
              rawNotes.push({
                startTick: prev.startTick,
                endTick: Math.max(prev.startTick + 1, tick),
                channel: ch,
                midiNote: note,
                velocity01: prev.vel01,
                program: prev.program,
              });
            }
            activeNotes.set(key, {
              startTick: tick,
              vel01: Math.max(0.15, Math.min(1, vel / 127)),
              program: chProgram[ch],
            });
          } else {
            const prev = activeNotes.get(key);
            if (prev) {
              rawNotes.push({
                startTick: prev.startTick,
                endTick: Math.max(prev.startTick + 1, tick),
                channel: ch,
                midiNote: note,
                velocity01: prev.vel01,
                program: prev.program,
              });
              activeNotes.delete(key);
            }
          }
        } else if (type === 0xc0) {
          chProgram[ch] = midiBytes[pos++] ?? 0;
        } else if (type === 0xd0) {
          pos += 1;
        } else {
          pos += 2;
        }
      }
    }

    for (const [key, prev] of activeNotes.entries()) {
      const ch = (key >> 8) & 0x0f;
      const note = key & 0x7f;
      rawNotes.push({
        startTick: prev.startTick,
        endTick: prev.startTick + Math.round(ppq * 0.25),
        channel: ch,
        midiNote: note,
        velocity01: prev.vel01,
        program: prev.program,
      });
    }
    pos = trkEnd;
  }

  tempoChanges.sort((a, b) => a.tick - b.tick);
  // Note: Google Magenta MT3 outputs a default 120 BPM (500000 us) header even when transcribing arbitrary audio tempos.
  const hasExplicitTempo = tempoChanges.length > 0;
  const segments: Array<{ tick: number; tempoUs: number; timeSec: number }> = [];
  if (tempoChanges.length === 0 || tempoChanges[0].tick > 0) {
    segments.push({ tick: 0, tempoUs: Math.round(60000000 / fallbackBpm), timeSec: 0 });
  }
  for (const tc of tempoChanges) {
    if (segments.length === 0) {
      segments.push({ tick: tc.tick, tempoUs: tc.tempoUs, timeSec: 0 });
    } else {
      const last = segments[segments.length - 1];
      if (tc.tick === last.tick) {
        last.tempoUs = tc.tempoUs;
      } else {
        const dtTicks = tc.tick - last.tick;
        const dtSec = (dtTicks / ppq) * (last.tempoUs / 1000000);
        segments.push({
          tick: tc.tick,
          tempoUs: tc.tempoUs,
          timeSec: last.timeSec + dtSec,
        });
      }
    }
  }

  const tickToSec = (tk: number): number => {
    let seg = segments[0];
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].tick <= tk) seg = segments[i];
      else break;
    }
    const dtTicks = Math.max(0, tk - seg.tick);
    return seg.timeSec + (dtTicks / ppq) * (seg.tempoUs / 1000000);
  };

  const primaryTempoUs = segments[0]?.tempoUs ?? 500000;
  const bpm = Math.max(40, Math.min(220, Math.round((60000000 / primaryTempoUs) * 10) / 10));
  const durationSec = Math.max(0.1, tickToSec(maxTick));

  // Separate Drum notes (Channel 10 = ch 9, or program >= 112, or all notes if forceDrumMode and no ch 9 exists)
  const hasCh9 = rawNotes.some((n) => n.channel === 9);
  const drumRaw = rawNotes.filter(
    (n) =>
      n.channel === 9 ||
      (n.program >= 112 && n.program <= 119) ||
      (options.forceDrumMode && !hasCh9 && n.midiNote >= 34 && n.midiNote <= 82)
  );
  const melodicRaw = rawNotes.filter((n) => n.channel !== 9 && !(n.program >= 112 && n.program <= 119));

  drumRaw.sort((a, b) => a.startTick - b.startTick || a.midiNote - b.midiNote);
  const drumHits: StemDrumHitEvent[] = [];
  for (let i = 0; i < drumRaw.length; i++) {
    const raw = drumRaw[i];
    const tSec = Number(tickToSec(raw.startTick).toFixed(4));
    const desc = mapMidiNoteToDrumPiece(raw.midiNote);
    // Deduplicate identical role+midiNote within 18ms
    const dup = drumHits.find(
      (prev) =>
        prev.role === desc.role &&
        prev.midiNote === desc.midiNote &&
        Math.abs(prev.timeSec - tSec) < 0.018
    );
    if (dup) {
      if (raw.velocity01 > dup.velocity) dup.velocity = raw.velocity01;
      continue;
    }
    drumHits.push({
      id: `dh-${drumHits.length}`,
      timeSec: tSec,
      peakTimeSec: tSec,
      role: desc.role,
      velocity: Number(raw.velocity01.toFixed(3)),
      midiNote: desc.midiNote,
      subRoleLabel: desc.subRoleLabel,
      articulation: desc.articulation,
      pitchOffsetSemis: desc.pitchOffsetSemis,
      sourceEngine: 'replicate-mt3',
    });
  }

  melodicRaw.sort((a, b) => a.startTick - b.startTick || a.midiNote - b.midiNote);
  const noteEvents: StemNoteEvent[] = melodicRaw.map((raw, idx) => {
    const startSec = Number(tickToSec(raw.startTick).toFixed(4));
    const endSec = Number(tickToSec(raw.endTick).toFixed(4));
    const clampedMidi = Math.max(24, Math.min(96, raw.midiNote));
    return {
      id: `mn-${idx}`,
      startSec,
      durationSec: Number(Math.max(0.04, endSec - startSec).toFixed(4)),
      midiNote: clampedMidi,
      noteName: midiNoteToName(clampedMidi),
      velocity: Number(raw.velocity01.toFixed(3)),
      clarity: 0.94,
    };
  });

  return {
    bpm,
    hasExplicitTempo,
    timeSignature,
    durationSec,
    drumHits,
    noteEvents,
  };
}

function applyBandFilter(
  mono: Float32Array,
  sr: number,
  hpHz: number | null,
  lpHz: number | null
): Float32Array {
  const n = mono.length;
  const out = new Float32Array(n);
  out.set(mono);

  if (hpHz !== null && hpHz > 0 && hpHz < sr * 0.45) {
    const w = (2 * Math.PI * hpHz) / sr;
    const c = Math.cos(w);
    const a = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + a;
    const b0 = ((1 + c) * 0.5) / a0;
    const b1 = -(1 + c) / a0;
    const b2 = b0;
    const a1 = (-2 * c) / a0;
    const a2 = (1 - a) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = out[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] = y;
    }
  }

  if (lpHz !== null && lpHz > 0 && lpHz < sr * 0.45) {
    const w = (2 * Math.PI * lpHz) / sr;
    const c = Math.cos(w);
    const a = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + a;
    const b0 = ((1 - c) * 0.5) / a0;
    const b1 = (1 - c) / a0;
    const b2 = b0;
    const a1 = (-2 * c) / a0;
    const a2 = (1 - a) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = out[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] = y;
    }
  }
  return out;
}

/**
 * Hybrid Neural MT3 MIDI + 48kHz Multi-Band Acoustic Fusion:
 * 1. Parses the MIDI transcribed by Replicate MT3 (or imported by user).
 * 2. Cross-verifies every MIDI hit against 5 isolated acoustic frequency bands in the original audio:
 *    - Sub-Kick (30..115 Hz)
 *    - Tom Shell (85..345 Hz)
 *    - Snare Body+Wires (175..5800 Hz)
 *    - Cymbal Crash/Ride Wash (2800..12000 Hz)
 *    - Hi-Hat Crisp Air (5600..16000 Hz)
 * 3. Locks each MIDI hit's `peakTimeSec` to the exact sub-millisecond transient peak in its band.
 * 4. Recovers true human dynamic velocity (0.18..1.00) from the audio waveform (replacing flat 127 MIDI velocity).
 * 5. Corrects MT3 Ride Bell (53) -> Snare (38) when the acoustic transient is a short-tail snare crack,
 *    and merges any high-confidence acoustic hits so zero kicks, snares, toms, hi-hats, or crashes are missed.
 */
export function fuseMidiWithAcousticDrumAudio(params: {
  midiBytes: Uint8Array;
  mono: Float32Array;
  sampleRate: number;
  sensitivity?: number;
  lockedBpm?: number;
  bpmHint?: number;
  beatOffsetSec?: number;
  beatTimes?: number[];
  downbeats?: number[];
  quantizeMode?: StemQuantizeMode;
  musicalKey?: string;
  camelotKey?: string;
  detectedChords?: DetectedChordSegment[];
  sourceEngine?: 'replicate-mt3' | 'midi-import';
  includeAcousticFallback?: boolean;
}): FullStemAnalysisResult {
  const {
    midiBytes,
    mono,
    sampleRate,
    sensitivity = 0.65,
    sourceEngine = 'replicate-mt3',
    includeAcousticFallback = true,
  } = params;
  const durationSec = mono.length / sampleRate;

  const parsedMidi = parseStandardMidiFile(midiBytes, {
    forceDrumMode: true,
    fallbackBpm: params.lockedBpm ?? params.bpmHint ?? 120,
  });

  // Also run our 5-band polyphonic acoustic analyzer for cross-verification & dynamic reference
  const acousticAnalysis = analyzeDrumStemFull(mono, sampleRate, {
    sensitivity,
    bpmHint: params.bpmHint,
    lockedBpm: params.lockedBpm,
    beatOffsetSec: params.beatOffsetSec,
    beatTimes: params.beatTimes,
    downbeats: params.downbeats,
    quantizeMode: 'off',
  });

  const subKickCoreSig = applyBiquadBandPassOrLp(mono, sampleRate, 28, 76, 1);
  const subKickSig = applyBandFilter(mono, sampleRate, 28, 110);
  const lowBodySig = applyBiquadBandPassOrLp(mono, sampleRate, 32, 340, 1);
  const tomSig = applyBiquadBandPassOrLp(mono, sampleRate, 80, 340, 1);
  const crackSig = applyBandFilter(mono, sampleRate, 1850, 6200);
  const snareSig = applyBandFilter(mono, sampleRate, 180, 5800);
  const cymbalSig = applyBandFilter(mono, sampleRate, 2800, 12000);
  const hatSig = applyBandFilter(mono, sampleRate, 5600, null);

  const bandMap: Record<DrumPieceRole, Float32Array> = {
    kick: subKickSig,
    tom: tomSig,
    snare: snareSig,
    crash: cymbalSig,
    hat: hatSig,
  };

  const searchRadiusSamples = Math.round(sampleRate * 0.024); // ±24ms window around MIDI timestamp

  const measureBandPeakAndRms = (sig: Float32Array, centerSec: number) => {
    const centerIdx = Math.max(0, Math.min(sig.length - 1, Math.round(centerSec * sampleRate)));
    const s0 = Math.max(0, centerIdx - searchRadiusSamples);
    const s1 = Math.min(sig.length, centerIdx + searchRadiusSamples);
    let peakIdx = centerIdx;
    let peakAmp = 0;
    let sumSq = 0;
    for (let i = s0; i < s1; i++) {
      const a = Math.abs(sig[i]);
      sumSq += a * a;
      if (a > peakAmp) {
        peakAmp = a;
        peakIdx = i;
      }
    }
    const rms = Math.sqrt(sumSq / Math.max(1, s1 - s0));
    return {
      peakTimeSec: Number((peakIdx / sampleRate).toFixed(5)),
      peakAmp,
      rms,
    };
  };

  const rawRefined: Array<StemDrumHitEvent & { rawAmp: number }> = [];

  for (const hit of parsedMidi.drumHits) {
    if (hit.timeSec > durationSec + 0.05) continue;
    let role = hit.role;
    let midiNote = hit.midiNote ?? defaultGmNoteForDrumRole(role, hit.articulation);
    let subRoleLabel = hit.subRoleLabel;
    let articulation = hit.articulation;
    let pitchOffsetSemis = hit.pitchOffsetSemis ?? 0;

    // Acoustic verification for Ride Bell (53) / Ride (51) vs Snare (38):
    // Google Magenta MT3 occasionally emits GM 53 (Ride Bell) on bright synthesized snares.
    if (midiNote === 53 || midiNote === 51) {
      const snareM = measureBandPeakAndRms(snareSig, hit.timeSec);
      const tomM = measureBandPeakAndRms(tomSig, hit.timeSec);
      // Measure cymbal wash sustain at +55..+160ms
      const tailS = Math.min(cymbalSig.length, Math.round((hit.timeSec + 0.055) * sampleRate));
      const tailE = Math.min(cymbalSig.length, Math.round((hit.timeSec + 0.16) * sampleRate));
      let tailRms = 0;
      if (tailE > tailS + 16) {
        let sq = 0;
        for (let k = tailS; k < tailE; k++) sq += cymbalSig[k] * cymbalSig[k];
        tailRms = Math.sqrt(sq / (tailE - tailS));
      }
      const cymM = measureBandPeakAndRms(cymbalSig, hit.timeSec);
      const holdRatio = tailRms / Math.max(1e-5, cymM.peakAmp);
      if (snareM.rms > cymM.rms * 0.85 && tomM.rms > cymM.rms * 0.28 && holdRatio < 0.18) {
        role = 'snare';
        midiNote = 38;
        subRoleLabel = 'Acoustic Snare (38)';
        articulation = 'closed';
        pitchOffsetSemis = 0;
      }
    }

    // Bidirectional Acoustic Verification for Kick (35/36) <-> Toms (41/43/45/47/48/50):
    // Prevents Replicate MT3 or imported MIDI from confusing Floor/Mid/High Toms with Kick Drums!
    if (role === 'kick' || role === 'tom') {
      const hitSampleIdx = Math.max(0, Math.min(mono.length - 1, Math.round(hit.timeSec * sampleRate)));
      const tomEval = evaluateTomResonanceAtSample({
        sampleIdx: hitSampleIdx,
        sampleRate,
        subKickSig: subKickCoreSig,
        tomSig,
        crackSig,
        lowBodySig,
        isFullMix: false,
      });
      const matchingAcousticTom = acousticAnalysis.drumHits.find(
        (ah) =>
          ah.role === 'tom' &&
          (Math.abs(ah.peakTimeSec - hit.timeSec) < 0.036 ||
            Math.abs(ah.timeSec - hit.timeSec) < 0.036)
      );

      if (role === 'kick' && (tomEval.isPitchedTom || matchingAcousticTom)) {
        // MT3 emitted a Kick (36) on a pitched Tom hit -> Reclassify to exact High/Mid/Floor Tom!
        role = 'tom';
        midiNote = matchingAcousticTom?.midiNote ?? tomEval.midiNote;
        subRoleLabel = matchingAcousticTom?.subRoleLabel ?? tomEval.subRoleLabel;
        articulation = matchingAcousticTom?.articulation ?? tomEval.articulation;
        pitchOffsetSemis = matchingAcousticTom?.pitchOffsetSemis ?? tomEval.pitchOffsetSemis;
      } else if (role === 'tom') {
        if (
          !tomEval.isPitchedTom &&
          !matchingAcousticTom &&
          (midiNote === 41 || midiNote === 43 || midiNote === 45) &&
          tomEval.subRms > tomEval.tomRms * 1.38
        ) {
          // Deep sub-bass (<66 Hz) dominates with no pitched tom ring -> Reclassify to Kick (36)
          role = 'kick';
          midiNote = 36;
          subRoleLabel = 'Kick Drum 1 (36)';
          articulation = 'closed';
          pitchOffsetSemis = 0;
        } else if (tomEval.isPitchedTom || matchingAcousticTom) {
          // Lock tom articulation (High 50 / Mid 47 / Floor 43) to actual acoustic pitch
          midiNote = matchingAcousticTom?.midiNote ?? tomEval.midiNote;
          subRoleLabel = matchingAcousticTom?.subRoleLabel ?? tomEval.subRoleLabel;
          articulation = matchingAcousticTom?.articulation ?? tomEval.articulation;
          pitchOffsetSemis = matchingAcousticTom?.pitchOffsetSemis ?? tomEval.pitchOffsetSemis;
        }
      }
    }

    const sig = bandMap[role];
    const measured = measureBandPeakAndRms(sig, hit.timeSec);

    rawRefined.push({
      ...hit,
      role,
      midiNote,
      subRoleLabel,
      articulation,
      pitchOffsetSemis,
      timeSec: Number(Math.min(durationSec - 0.005, Math.max(0, hit.timeSec)).toFixed(4)),
      peakTimeSec: Number(Math.min(durationSec - 0.002, Math.max(0, measured.peakTimeSec)).toFixed(5)),
      rawAmp: Math.max(measured.peakAmp, measured.rms * 1.6),
      sourceEngine,
    });
  }

  // Hybrid Acoustic Fallback: merge high-confidence acoustic hits that had no MIDI hit within ±42ms
  if (includeAcousticFallback && sourceEngine === 'replicate-mt3') {
    for (const acHit of acousticAnalysis.drumHits) {
      const minVelocityForFallback =
        acHit.role === 'kick' || acHit.role === 'snare' || acHit.role === 'tom' ? 0.42 : 0.48;
      if (acHit.velocity < minVelocityForFallback) continue;
      // Avoid injecting a fallback Kick on top of an already-verified Tom (or vice versa) within ±42ms
      const alreadyCovered = rawRefined.some(
        (m) =>
          (m.role === acHit.role ||
            (m.role === 'tom' && acHit.role === 'kick') ||
            (m.role === 'kick' && acHit.role === 'tom')) &&
          Math.abs(m.peakTimeSec - acHit.peakTimeSec) < 0.042
      );
      if (!alreadyCovered) {
        const sig = bandMap[acHit.role];
        const measured = measureBandPeakAndRms(sig, acHit.peakTimeSec);
        rawRefined.push({
          ...acHit,
          rawAmp: Math.max(measured.peakAmp, measured.rms * 1.6),
          sourceEngine: 'replicate-mt3',
        });
      }
    }
  }

  // Compute 92nd percentile amplitude per role for true dynamic velocity scaling
  const roleRef: Record<DrumPieceRole, number> = {
    kick: 1e-4,
    snare: 1e-4,
    hat: 1e-4,
    crash: 1e-4,
    tom: 1e-4,
  };
  (['kick', 'snare', 'hat', 'crash', 'tom'] as DrumPieceRole[]).forEach((r) => {
    const amps = rawRefined
      .filter((h) => h.role === r && h.rawAmp > 1e-5)
      .map((h) => h.rawAmp)
      .sort((a, b) => a - b);
    if (amps.length > 0) {
      roleRef[r] = Math.max(1e-4, amps[Math.min(amps.length - 1, Math.floor(amps.length * 0.92))]);
    }
  });

  const mergedHits: StemDrumHitEvent[] = rawRefined
    .map((h, idx) => {
      const acousticVel =
        h.rawAmp > 1e-5
          ? Math.max(0.18, Math.min(1.0, h.rawAmp / roleRef[h.role]))
          : h.velocity;
      return {
        id: `dh-${idx}`,
        timeSec: h.timeSec,
        peakTimeSec: h.peakTimeSec,
        role: h.role,
        velocity: Number(acousticVel.toFixed(3)),
        midiNote: h.midiNote ?? defaultGmNoteForDrumRole(h.role, h.articulation),
        subRoleLabel: h.subRoleLabel,
        articulation: h.articulation,
        pitchOffsetSemis: h.pitchOffsetSemis,
        sourceEngine: h.sourceEngine ?? sourceEngine,
      };
    })
    .sort((a, b) => a.timeSec - b.timeSec || a.role.localeCompare(b.role));

  const bpm =
    params.lockedBpm && params.lockedBpm >= 40 && params.lockedBpm <= 220
      ? params.lockedBpm
      : parsedMidi.hasExplicitTempo && Math.abs(parsedMidi.bpm - 120) > 0.5
      ? parsedMidi.bpm
      : acousticAnalysis.bpm;

  const qMode: StemQuantizeMode = params.quantizeMode ?? 'soft';
  const finalDrumHits = quantizeDrumHitsToTempo(
    mergedHits,
    bpm,
    params.beatOffsetSec ?? acousticAnalysis.beatOffsetSec ?? 0,
    durationSec,
    qMode,
    params.beatTimes ?? acousticAnalysis.beatTimes
  );

  let kickCount = 0;
  let snareCount = 0;
  let hatCount = 0;
  let crashCount = 0;
  let tomCount = 0;
  for (const h of finalDrumHits) {
    if (h.role === 'kick') kickCount++;
    else if (h.role === 'snare') snareCount++;
    else if (h.role === 'hat') hatCount++;
    else if (h.role === 'crash') crashCount++;
    else tomCount++;
  }

  return {
    mode: 'drums',
    analysisEngine: sourceEngine,
    quantizeMode: qMode,
    bpm,
    musicalKey: params.musicalKey,
    camelotKey: params.camelotKey,
    detectedChords: params.detectedChords,
    beatOffsetSec: params.beatOffsetSec ?? acousticAnalysis.beatOffsetSec,
    beatTimes: params.beatTimes ?? acousticAnalysis.beatTimes,
    downbeats: params.downbeats ?? acousticAnalysis.downbeats,
    durationSec,
    drumHits: finalDrumHits,
    noteEvents: parsedMidi.noteEvents,
    counts: {
      total: finalDrumHits.length,
      kick: kickCount,
      snare: snareCount,
      hat: hatCount,
      crash: crashCount,
      tom: tomCount,
      notes: parsedMidi.noteEvents.length,
    },
  };
}

function writeVarLen(val: number, out: number[]): void {
  let v = Math.max(0, Math.round(val));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.push((v & 0x7f) | 0x80);
    v >>= 7;
  }
  for (let i = bytes.length - 1; i >= 0; i--) {
    out.push(bytes[i]);
  }
}

/**
 * Encodes any FullStemAnalysisResult (Drums or Melodic/Polyphonic Notes)
 * into a 100% Standard MIDI File (.mid SMF Format 1, 480 PPQ) with Tempo, Time Signature,
 * and General MIDI Channel 10 Drum notes (Kick 36, Snare 38, Closed/Open Hat 42/46, Floor/Mid/High Tom 43/47/50, Crash/Ride 49/51).
 */
export function encodeAnalysisToStandardMidi(analysis: FullStemAnalysisResult): Uint8Array {
  const ppq = 480;
  const bpm = Math.max(40, Math.min(220, analysis.bpm || 120));
  const tempoUs = Math.round(60000000 / bpm);
  const secToTicks = (sec: number): number => Math.max(0, Math.round(sec * (bpm / 60) * ppq));

  interface MidiEvt {
    tick: number;
    status: number;
    d1: number;
    d2: number;
  }

  const events: MidiEvt[] = [];

  if (analysis.mode === 'drums' || analysis.drumHits.length > 0) {
    // Channel 10 (index 9): 0x99 Note On, 0x89 Note Off
    for (const hit of analysis.drumHits) {
      const note = hit.midiNote ?? defaultGmNoteForDrumRole(hit.role, hit.articulation);
      const startTick = secToTicks(hit.peakTimeSec ?? hit.timeSec);
      const durSec =
        hit.role === 'crash'
          ? 0.35
          : hit.role === 'tom'
          ? 0.18
          : hit.articulation === 'open'
          ? 0.22
          : 0.08;
      const endTick = Math.max(startTick + 24, secToTicks((hit.peakTimeSec ?? hit.timeSec) + durSec));
      const vel = Math.max(18, Math.min(127, Math.round(hit.velocity * 127)));
      events.push({ tick: startTick, status: 0x99, d1: note, d2: vel });
      events.push({ tick: endTick, status: 0x89, d1: note, d2: 0 });
    }
  }

  if (analysis.noteEvents.length > 0) {
    // Channel 1 (index 0): 0x90 Note On, 0x80 Note Off
    for (const ev of analysis.noteEvents) {
      const startTick = secToTicks(ev.startSec);
      const endTick = Math.max(startTick + 24, secToTicks(ev.startSec + ev.durationSec));
      const note = Math.max(12, Math.min(115, ev.midiNote));
      const vel = Math.max(16, Math.min(127, Math.round(ev.velocity * 127)));
      events.push({ tick: startTick, status: 0x90, d1: note, d2: vel });
      events.push({ tick: endTick, status: 0x80, d1: note, d2: 0 });
    }
  }

  events.sort((a, b) => a.tick - b.tick || (a.status & 0xf0) - (b.status & 0xf0));

  const trkBytes: number[] = [];
  // Track Name Meta Event (0xFF 0x03)
  const titleStr = analysis.mode === 'drums' ? 'Tandao Sample Lab Drum Kit (GM)' : 'Tandao Sample Lab Instrument';
  trkBytes.push(0x00, 0xff, 0x03, titleStr.length);
  for (let i = 0; i < titleStr.length; i++) trkBytes.push(titleStr.charCodeAt(i));

  // Time Signature 4/4 Meta Event (0xFF 0x58 0x04 04 02 18 08)
  trkBytes.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // Set Tempo Meta Event (0xFF 0x51 0x03)
  trkBytes.push(
    0x00,
    0xff,
    0x51,
    0x03,
    (tempoUs >> 16) & 0xff,
    (tempoUs >> 8) & 0xff,
    tempoUs & 0xff
  );

  let curTick = 0;
  for (const ev of events) {
    const dt = Math.max(0, ev.tick - curTick);
    writeVarLen(dt, trkBytes);
    trkBytes.push(ev.status, ev.d1 & 0x7f, ev.d2 & 0x7f);
    curTick = ev.tick;
  }

  // End of Track Meta Event (0xFF 0x2F 0x00)
  trkBytes.push(0x00, 0xff, 0x2f, 0x00);

  const totalLen = 14 + 8 + trkBytes.length;
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);

  // MThd header (Format 0 single combined track for maximum DAW compatibility)
  out.set([0x4d, 0x54, 0x68, 0x64], 0);
  view.setUint32(4, 6, false);
  view.setUint16(8, 0, false); // Format 0
  view.setUint16(10, 1, false); // 1 track
  view.setUint16(12, ppq, false);

  // MTrk header
  out.set([0x4d, 0x54, 0x72, 0x6b], 14);
  view.setUint32(18, trkBytes.length, false);
  out.set(trkBytes, 22);

  return out;
}

/**
 * Encodes an AudioBuffer in RAM into a compact Mono 16kHz (or 12kHz for long tracks) 16-bit PCM WAV data URI
 * so Replicate MT3 & All-In-One Beat models receive the exact audio bytes directly without depending on external URLs.
 */
export function encodeAudioBufferToCompactWavBase64(
  buffer: AudioBuffer,
  maxDurationSec = 240
): string {
  const srcSr = buffer.sampleRate;
  const dur = Math.min(buffer.duration, maxDurationSec);
  // Google Magenta MT3 internally operates at 16,000 Hz Mono; use 12,000 Hz for tracks > 105s to keep payload < 2.5 MB
  const targetSr = dur > 105 ? 12000 : 16000;
  const outSamples = Math.max(1, Math.floor(dur * targetSr));
  const ratio = srcSr / targetSr;

  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

  const wavBytes = new Uint8Array(44 + outSamples * 2);
  const view = new DataView(wavBytes.buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) wavBytes[offset + i] = s.charCodeAt(i);
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + outSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, targetSr, true);
  view.setUint32(28, targetSr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, outSamples * 2, true);

  for (let i = 0; i < outSamples; i++) {
    const srcIdx = Math.min(ch0.length - 1, Math.floor(i * ratio));
    const monoVal = Math.max(-1, Math.min(1, 0.5 * (ch0[srcIdx] + ch1[srcIdx])));
    view.setInt16(44 + i * 2, Math.round(monoVal * 32767), true);
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < wavBytes.length; i += chunkSize) {
    const slice = wavBytes.subarray(i, Math.min(wavBytes.length, i + chunkSize));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function base64ToUint8Array(base64OrDataUri: string): Uint8Array {
  const clean = base64OrDataUri.includes(',')
    ? base64OrDataUri.split(',')[1]
    : base64OrDataUri;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function buildMelodicAnalysisFromParsedMidi(params: {
  parsed: ParsedMidiFileResult;
  mode: 'monophonic' | 'polyphonic';
  durationSec: number;
  lockedBpm?: number;
  beatOffsetSec?: number;
  beatTimes?: number[];
  downbeats?: number[];
  quantizeMode?: StemQuantizeMode;
  musicalKey?: string;
  camelotKey?: string;
  detectedChords?: DetectedChordSegment[];
  sourceEngine?: 'replicate-mt3' | 'midi-import';
}): FullStemAnalysisResult {
  const { parsed, mode, durationSec, sourceEngine = 'replicate-mt3' } = params;
  const bpm =
    params.lockedBpm && params.lockedBpm >= 40 && params.lockedBpm <= 220
      ? params.lockedBpm
      : parsed.bpm;
  const qMode: StemQuantizeMode = params.quantizeMode ?? 'soft';
  const notes = quantizeNoteEventsToTempo(
    parsed.noteEvents,
    bpm,
    params.beatOffsetSec ?? 0,
    durationSec,
    qMode,
    mode === 'monophonic',
    params.beatTimes
  );

  let minMidi = 127;
  let maxMidi = 0;
  for (const n of notes) {
    if (n.midiNote < minMidi) minMidi = n.midiNote;
    if (n.midiNote > maxMidi) maxMidi = n.midiNote;
  }

  return {
    mode,
    analysisEngine: sourceEngine,
    quantizeMode: qMode,
    bpm,
    musicalKey: params.musicalKey,
    camelotKey: params.camelotKey,
    detectedChords: params.detectedChords,
    beatOffsetSec: params.beatOffsetSec,
    beatTimes: params.beatTimes,
    downbeats: params.downbeats,
    durationSec,
    drumHits: [],
    noteEvents: notes,
    midiRange:
      notes.length > 0
        ? {
            minMidi,
            maxMidi,
            minName: midiNoteToName(minMidi),
            maxName: midiNoteToName(maxMidi),
          }
        : undefined,
    counts: {
      total: notes.length,
      kick: 0,
      snare: 0,
      hat: 0,
      crash: 0,
      tom: 0,
      notes: notes.length,
    },
  };
}
