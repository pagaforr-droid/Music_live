import { describe, it, expect } from 'vitest';
import {
  buildShiftedBeatGrid,
  scheduleSectionVoiceCues,
  resolveCueBufferName,
} from '../cueEngine';

describe('Studio Prompter Engine & Cue Synchronization', () => {
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

    // Song start is at t = 4.0s (beat index 8), so lead-in for INTRO is at beats 4, 5, 6, 7
    expect(scheduled.slice(0, 4)).toEqual([
      { cue: 'intro', beatIdx: 4 },
      { cue: '2', beatIdx: 5 },
      { cue: '3', beatIdx: 6 },
      { cue: '4', beatIdx: 7 },
    ]);

    // VERSO 1 is at song time 4.0s -> global time 8.0s (beat index 16), so lead-in is at beats 12, 13, 14, 15
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
});
