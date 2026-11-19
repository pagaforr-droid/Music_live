import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CUE_NAMES,
  buildShiftedBeatGrid,
  scheduleSectionVoiceCues,
  resolveCueBufferName,
  parsePcmWavToAudioBuffer,
  loadCueBuffers,
} from '../cueEngine';
import {
  detectChordsAndBeatsLocalDSP,
  computeChromaVector,
  transposeChordSymbol,
} from '../chordDetectorDSP';

describe('Studio Prompter Engine & Cue Synchronization (Pasada 1 & Pasada 2)', () => {
  const mockCueBuffers: Record<string, any> = {
    intro: {},
    verso: {},
    'pre-coro': {},
    coro: {},
    puente: {},
    solo: {},
    final: {},
    '1': {},
    '2': {},
    '3': {},
    '4': {},
  };

  it('1. buildShiftedBeatGrid aligns downbeatIndex exactly to (preRollDuration + firstBeatOffset + manualGridOffset) when beatTimes is empty', () => {
    const preRoll = 4.0; // 2 compases a 120 BPM (4/4)
    const firstBeatOffset = 0.75; // 0.75s de silencio inicial en la canción
    const manualNudge = 0.05; // +50ms nudge

    const { shiftedBeatTimes, downbeatIndex } = buildShiftedBeatGrid(
      { bpm: 120, timeSignature: '4/4', firstBeatOffset, beatTimes: [] },
      preRoll,
      30,
      manualNudge
    );

    const expectedAnchor = preRoll + firstBeatOffset + manualNudge; // 4.80s
    expect(shiftedBeatTimes[downbeatIndex]).toBeCloseTo(expectedAnchor, 4);
    expect(shiftedBeatTimes[0]).toBeGreaterThanOrEqual(0);
    expect(shiftedBeatTimes[0]).toBeLessThan(0.5);
  });

  it('2. buildShiftedBeatGrid shifts dynamic beatTimes by (preRollDuration + manualGridOffset) and extrapolates pre-roll beats', () => {
    const rawBeats = [0.2, 0.7, 1.2, 1.7, 2.2, 2.7, 3.2, 3.7];
    const preRoll = 4.0;
    const manualNudge = -0.02;

    const { shiftedBeatTimes, downbeatIndex } = buildShiftedBeatGrid(
      { bpm: 120, timeSignature: '4/4', firstBeatOffset: 0.2, beatTimes: rawBeats },
      preRoll,
      10,
      manualNudge
    );

    expect(shiftedBeatTimes[downbeatIndex]).toBeCloseTo(0.2 + preRoll + manualNudge, 4);
    expect(downbeatIndex).toBeGreaterThanOrEqual(8);
  });

  it('3. scheduleSectionVoiceCues announces Compás 1 section at beat 0 when preRollDuration === 0 instead of dropping it', () => {
    const { shiftedBeatTimes } = buildShiftedBeatGrid(
      { bpm: 120, timeSignature: '4/4', firstBeatOffset: 0 },
      0,
      16,
      0
    );

    const scheduled: Array<{ cue: string; beatIdx: number }> = [];
    scheduleSectionVoiceCues(
      [{ time: 0, name: 'INTRO', cueEnabled: true }],
      shiftedBeatTimes,
      4,
      0,
      mockCueBuffers,
      (bufName, beatIdx) => scheduled.push({ cue: bufName, beatIdx })
    );

    expect(scheduled.length).toBe(1);
    expect(scheduled[0]).toEqual({ cue: 'intro', beatIdx: 0 });
  });

  it('4. scheduleSectionVoiceCues schedules full 4-beat countdown ("intro, 2, 3, 4") 1 bar before song start when preRollDuration > 0', () => {
    const preRoll = 4.0; // 8 beats at 120 BPM
    const { shiftedBeatTimes } = buildShiftedBeatGrid(
      { bpm: 120, timeSignature: '4/4', firstBeatOffset: 0 },
      preRoll,
      16,
      0
    );

    const scheduled: Array<{ cue: string; beatIdx: number }> = [];
    scheduleSectionVoiceCues(
      [
        { time: 0, name: 'INTRO', cueEnabled: true },
        { time: 4.0, name: 'VERSO 1', cueEnabled: true },
      ],
      shiftedBeatTimes,
      4,
      preRoll,
      mockCueBuffers,
      (bufName, beatIdx) => scheduled.push({ cue: bufName, beatIdx })
    );

    expect(scheduled.slice(0, 4)).toEqual([
      { cue: 'intro', beatIdx: 4 },
      { cue: '2', beatIdx: 5 },
      { cue: '3', beatIdx: 6 },
      { cue: '4', beatIdx: 7 },
    ]);

    expect(scheduled.slice(4, 8)).toEqual([
      { cue: 'verso', beatIdx: 12 },
      { cue: '2', beatIdx: 13 },
      { cue: '3', beatIdx: 14 },
      { cue: '4', beatIdx: 15 },
    ]);
  });

  it('5. resolveCueBufferName resolves bilingual and numbered section names accurately', () => {
    expect(resolveCueBufferName('VERSO 1', mockCueBuffers)).toBe('verso');
    expect(resolveCueBufferName('Pre Chorus B', mockCueBuffers)).toBe('pre-coro');
    expect(resolveCueBufferName('CHORUS FINAL', mockCueBuffers)).toBe('coro');
    expect(resolveCueBufferName('Outro Instrumental', mockCueBuffers)).toBe('final');
  });

  it('6. detectChordsAndBeatsLocalDSP detects C -> Am -> F -> G progression and key in RAM without external server', () => {
    const sr = 22050;
    const durationSec = 8.0; // 4 bars at 120 BPM (2.0s per bar)
    const length = sr * durationSec;
    const ch0 = new Float32Array(length);

    // Chords per bar (2.0s each): C (C4,E4,G4), Am (A3,C4,E4), F (F3,A3,C4), G (G3,B3,D4)
    const progFreqs = [
      [261.63, 329.63, 392.00], // C
      [220.00, 261.63, 329.63], // Am
      [174.61, 220.00, 261.63], // F
      [196.00, 246.94, 293.66], // G
    ];

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const barIdx = Math.min(3, Math.floor(t / 2.0));
      const freqs = progFreqs[barIdx];
      let sample = 0;
      for (const f of freqs) {
        sample += 0.25 * Math.sin(2 * Math.PI * f * t);
      }
      // Añadir pulso percusivo cada 0.5s (120 BPM)
      const beatPhase = t % 0.5;
      if (beatPhase < 0.03) {
        sample += 0.35 * Math.sin(2 * Math.PI * 80 * beatPhase) * Math.exp(-beatPhase * 90);
      }
      ch0[i] = sample;
    }

    const fakeAudioBuffer = {
      sampleRate: sr,
      length,
      duration: durationSec,
      numberOfChannels: 1,
      getChannelData: () => ch0,
    } as unknown as AudioBuffer;

    const result = detectChordsAndBeatsLocalDSP(fakeAudioBuffer, {
      bpm: 120,
      timeSignature: '4/4',
      firstBeatOffset: 0,
      beatTimes: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5],
    });

    expect(result.chords.length).toBeGreaterThanOrEqual(4);
    const detectedNames = result.chords.map((c) => c.chord);
    expect(detectedNames).toContain('C');
    expect(detectedNames).toContain('Am');
    expect(detectedNames).toContain('F');
    expect(detectedNames).toContain('G');
  });

  it('7. transposeChordSymbol preserva sufijos complejos en mayúsculas y bajos invertidos', () => {
    expect(transposeChordSymbol('CMAJ7', 2)).toBe('DMAJ7');
    expect(transposeChordSymbol('CAUG', 2)).toBe('DAUG');
    expect(transposeChordSymbol('F#m7b5/C#', 1)).toBe('Gm7b5/D');
    expect(transposeChordSymbol('Ebdim', 3)).toBe('Gbdim');
    expect(transposeChordSymbol('Gadd9', -2)).toBe('Fadd9');
    expect(transposeChordSymbol('NC', 5)).toBe('NC');
    expect(transposeChordSymbol('N', -3)).toBe('N');
  });

  it('8. computeChromaVector separa frecuencias graves C2 (65.41 Hz) vs C#2 (69.30 Hz) sin cuantización de bin', () => {
    const sampleRate = 48000;
    const durationSec = 0.5;
    const length = Math.floor(sampleRate * durationSec);
    const makeTone = (freq: number) => {
      const buf = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        buf[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }
      return buf;
    };

    const chromaC2 = computeChromaVector(makeTone(65.406), sampleRate, 0, durationSec);
    const chromaCs2 = computeChromaVector(makeTone(69.296), sampleRate, 0, durationSec);

    // Pitch class 0 = C, Pitch class 1 = C#
    expect(chromaC2[0]).toBeGreaterThan(chromaC2[1] * 2);
    expect(chromaCs2[1]).toBeGreaterThan(chromaCs2[0] * 2);
  });

  it('9. buildShiftedBeatGrid genera beats pre-offset e indexa downbeats consistente con compás', () => {
    const { shiftedBeatTimes, downbeatIndex } = buildShiftedBeatGrid(
      { bpm: 120, timeSignature: '4/4', firstBeatOffset: 1.5, beatTimes: [1.5, 2.0, 2.5, 3.0, 3.5] },
      0,
      10,
      0
    );
    const preOffsetBeats = shiftedBeatTimes.filter((t) => t < 1.49);
    expect(preOffsetBeats.length).toBeGreaterThanOrEqual(2);
    expect(shiftedBeatTimes[downbeatIndex]).toBeCloseTo(1.5, 4);
    expect(downbeatIndex).toBeGreaterThanOrEqual(2);
    // Verificar monotonicidad temporal estricta en todo el grid
    for (let i = 1; i < shiftedBeatTimes.length; i++) {
      expect(shiftedBeatTimes[i]).toBeGreaterThan(shiftedBeatTimes[i - 1]);
    }
  });

  it('10. resolveCueBufferName resolves accented, hyphenated, and bilingual aliases without breaking precedence', () => {
    expect(resolveCueBufferName('PRE-CHORUS', mockCueBuffers)).toBe('pre-coro');
    expect(resolveCueBufferName('Pre Coro 2', mockCueBuffers)).toBe('pre-coro');
    expect(resolveCueBufferName('Estribillo', mockCueBuffers)).toBe('coro');
    expect(resolveCueBufferName('Estrofa 1', mockCueBuffers)).toBe('verso');
    expect(resolveCueBufferName('Instrumental', mockCueBuffers)).toBe('solo');
    expect(resolveCueBufferName('Interludio', mockCueBuffers)).toBe('solo');
    expect(resolveCueBufferName('Coda', mockCueBuffers)).toBe('final');
    expect(resolveCueBufferName('Introducción', mockCueBuffers)).toBe('intro');
    // Precedence invariants
    expect(resolveCueBufferName('Outro Instrumental', mockCueBuffers)).toBe('final');
    expect(resolveCueBufferName('CHORUS FINAL', mockCueBuffers)).toBe('coro');
  });

  const createMockAudioContext = (failDecodeAudioData = false) => {
    return {
      sampleRate: 44100,
      createBuffer: (channels: number, length: number, sampleRate: number) => {
        const channelData = Array.from({ length: channels }, () => new Float32Array(length));
        return {
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          getChannelData: (ch: number) => channelData[ch],
        } as unknown as AudioBuffer;
      },
      decodeAudioData: async () => {
        if (failDecodeAudioData) {
          throw new Error('Simulated codec failure');
        }
        throw new Error('Unexpected native decode in Node mock');
      },
    } as unknown as BaseAudioContext;
  };

  it('11. parsePcmWavToAudioBuffer decodes all 11 real public/cues/*.wav assets with valid duration and non-silent peak', () => {
    const cuesDir = path.resolve(__dirname, '../../../public/cues');
    const mockCtx = createMockAudioContext(true);

    for (const name of CUE_NAMES) {
      const wavPath = path.join(cuesDir, `${name}.wav`);
      expect(fs.existsSync(wavPath), `Missing WAV cue asset: ${wavPath}`).toBe(true);
      const fileBuf = fs.readFileSync(wavPath);
      const arrayBuf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);

      const decoded = parsePcmWavToAudioBuffer(mockCtx, arrayBuf);
      expect(decoded, `Failed to parse WAV for "${name}"`).not.toBeNull();
      expect(decoded!.sampleRate).toBe(44100);
      expect(decoded!.duration).toBeGreaterThan(0.25);

      const samples = decoded!.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
      }
      expect(peak).toBeGreaterThan(0.5);
    }
  });

  it('12. loadCueBuffers rejects SPA HTML 200 OK rewrites and recovers all 11 cues via pure-JS PCM WAV parser when decodeAudioData fails', async () => {
    const cuesDir = path.resolve(__dirname, '../../../public/cues');
    const mockCtx = createMockAudioContext(true);

    // Case A: All endpoints return SPA HTML 200 OK -> must reject all (0 loaded, 11 failed)
    const htmlPayload = new TextEncoder().encode('<!DOCTYPE html><html><body>SPA</body></html>').buffer;
    const htmlFetch = vi.fn(async () => ({
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      arrayBuffer: async () => htmlPayload.slice(0),
    }));
    vi.stubGlobal('fetch', htmlFetch);
    try {
      const htmlRes = await loadCueBuffers(mockCtx);
      expect(htmlRes.loadedNames.length).toBe(0);
      expect(htmlRes.failedNames.length).toBe(CUE_NAMES.length);
    } finally {
      vi.unstubAllGlobals();
    }

    // Case B: .wav serves real PCM WAV bytes while decodeAudioData throws -> pure-JS WAV parser rescues all 11
    const wavFetch = vi.fn(async (input: string | URL) => {
      const urlStr = String(input);
      const match = urlStr.match(/cues\/([^/]+)\.wav$/);
      if (!match) {
        return { ok: false, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      const wavPath = path.join(cuesDir, `${match[1]}.wav`);
      const fileBuf = fs.readFileSync(wavPath);
      const ab = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
      return {
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'audio/wav' : null) },
        arrayBuffer: async () => ab,
      };
    });
    vi.stubGlobal('fetch', wavFetch);
    try {
      const okRes = await loadCueBuffers(mockCtx);
      expect(okRes.loadedNames.length).toBe(CUE_NAMES.length);
      expect(okRes.failedNames.length).toBe(0);
      for (const name of CUE_NAMES) {
        expect(okRes.cueBuffers[name]).toBeDefined();
        expect(okRes.cueOffsets[name]).toBe(0); // Pre-trimmed WAVs start cleanly at 0
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
