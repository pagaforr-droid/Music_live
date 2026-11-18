import { describe, it, expect } from 'vitest';
import {
  buildShiftedBeatGrid,
  computePhaseLockedPreRollSeconds,
  computePreRollSecondsForBars,
  resolveEffectivePreRoll,
  resolveEffectivePreRollBars,
  resolveEffectivePlaybackBounds,
  resolveLyricsTimeMapping,
  scheduleSectionVoiceCues,
} from '../cueEngine';

describe('Live Concert & Studio Prompter — Phase-Locked Pre-Roll, Cue Alignment & Sync Contract', () => {
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

  it('1. computePhaseLockedPreRollSeconds locks Bar 1 Beat 1 to an exact bar boundary (0 dead space, 0 orphan clicks)', () => {
    // 120 BPM (4/4): beat = 0.5s, bar = 2.0s; stem has 0.75s initial air before Bar 1
    const pd = { bpm: 120, timeSignature: '4/4', firstBeatOffset: 0.75 };

    expect(computePhaseLockedPreRollSeconds(pd, 0)).toBe(0);

    // 1C: preRoll = 2.0 - 0.75 = 1.25s => Bar 1 Beat 1 lands at 1.25 + 0.75 = 2.00s (Beat 0 at 0.00s!)
    const pre1 = computePhaseLockedPreRollSeconds(pd, 1);
    expect(pre1).toBeCloseTo(1.25, 4);

    // 2C: preRoll = 4.0 - 0.75 = 3.25s => Bar 1 Beat 1 lands at 3.25 + 0.75 = 4.00s (Beat 0 at 0.00s!)
    const pre2 = computePhaseLockedPreRollSeconds(pd, 2);
    expect(pre2).toBeCloseTo(3.25, 4);

    const grid1 = buildShiftedBeatGrid(pd, pre1, 30, 0);
    expect(grid1.firstActiveBeatIndex).toBe(0);
    expect(grid1.downbeatIndex).toBe(4);
    expect(grid1.shiftedBeatTimes[0]).toBeCloseTo(0, 3);
    expect(grid1.shiftedBeatTimes[grid1.downbeatIndex]).toBeCloseTo(2.0, 3);

    const grid2 = buildShiftedBeatGrid(pd, pre2, 30, 0);
    expect(grid2.firstActiveBeatIndex).toBe(0);
    expect(grid2.downbeatIndex).toBe(8);
    expect(grid2.shiftedBeatTimes[0]).toBeCloseTo(0, 3);
    expect(grid2.shiftedBeatTimes[grid2.downbeatIndex]).toBeCloseTo(4.0, 3);
  });

  it('2. computePhaseLockedPreRollSeconds handles fractional BPM (97 BPM), 3/4 meter, slow tempo cap & long firstBeatOffset', () => {
    // 97 BPM (4/4): beat = 0.618557s, bar = 2.474227s, firstBeatOffset = 0.75s
    const pd97 = { bpm: 97, timeSignature: '4/4', firstBeatOffset: 0.75 };
    const pre97 = computePhaseLockedPreRollSeconds(pd97, 1);
    const grid97 = buildShiftedBeatGrid(pd97, pre97, 20, 0);
    expect(grid97.firstActiveBeatIndex).toBe(0);
    expect(grid97.downbeatIndex).toBe(4);
    expect(grid97.shiftedBeatTimes[0]).toBeCloseTo(0, 2);
    expect(grid97.shiftedBeatTimes[4]).toBeCloseTo((60 / 97) * 4, 3);

    // 3/4 at 120 BPM: bar = 1.5s, firstBeatOffset = 0.5s => 1C preRoll = 1.0s
    const pd34 = { bpm: 120, timeSignature: '3/4', firstBeatOffset: 0.5 };
    const pre34 = computePhaseLockedPreRollSeconds(pd34, 1);
    expect(pre34).toBeCloseTo(1.0, 4);
    const grid34 = buildShiftedBeatGrid(pd34, pre34, 15, 0);
    expect(grid34.downbeatIndex).toBe(3);
    expect(grid34.firstActiveBeatIndex).toBe(0);

    // Slow 25 BPM (4/4): bar = 9.6s; 2C capped cleanly to 1 integer bar (9.6s) instead of 16s mid-bar cut
    const pdSlow = { bpm: 25, timeSignature: '4/4', firstBeatOffset: 0 };
    expect(computePhaseLockedPreRollSeconds(pdSlow, 2)).toBeCloseTo(9.6, 4);

    // Long stem intro firstBeatOffset = 2.5s (> 1 bar of 2.0s) with 1C => preRoll = 1.5s (total 2 full bars = 4.0s)
    const pdLongIntro = { bpm: 120, timeSignature: '4/4', firstBeatOffset: 2.5 };
    expect(computePhaseLockedPreRollSeconds(pdLongIntro, 1)).toBeCloseTo(1.5, 4);
  });

  it('3. Legacy non-phase-locked preRoll skips orphan partial-bar clicks via firstActiveBeatIndex', () => {
    const pd = { bpm: 120, timeSignature: '4/4', firstBeatOffset: 0.75 };
    // Non-phase-locked legacy preRoll = 4.0s => Bar 1 is at 4.75s (beat idx 9), beat 0 is 0.25s (beat 4 orphan!)
    const grid = buildShiftedBeatGrid(pd, 4.0, 20, 0);
    expect(grid.downbeatIndex).toBe(9);
    expect(grid.firstActiveBeatIndex).toBe(1); // Skips orphan beat 0, starts on Beat 1 (HIGH) at idx 1!
    expect((grid.downbeatIndex - grid.firstActiveBeatIndex) % 4).toBe(0);
  });

  it('4. scheduleSectionVoiceCues aligns opening INTRO cleanly to downbeatIndex with zero drift or double count-in', () => {
    const pd = { bpm: 120, timeSignature: '4/4', firstBeatOffset: 1.2 };
    const pre1 = computePhaseLockedPreRollSeconds(pd, 1); // 0.8s -> Bar 1 at 2.0s (idx 4)
    const { shiftedBeatTimes, downbeatIndex } = buildShiftedBeatGrid(pd, pre1, 30, 0);
    expect(downbeatIndex).toBe(4);

    // Case A: User placed INTRO at t = 0.0 while Bar 1 is at 1.2s
    const cuesCaseA: Array<{ cue: string; beatIdx: number }> = [];
    scheduleSectionVoiceCues(
      [
        { time: 0, name: 'INTRO', cueEnabled: true },
        { time: 9.2, name: 'VERSO 1', cueEnabled: true },
      ],
      shiftedBeatTimes,
      4,
      pre1,
      mockCueBuffers,
      (bufName, beatIdx) => cuesCaseA.push({ cue: bufName, beatIdx }),
      downbeatIndex
    );
    expect(cuesCaseA.slice(0, 4)).toEqual([
      { cue: 'intro', beatIdx: 0 },
      { cue: '2', beatIdx: 1 },
      { cue: '3', beatIdx: 2 },
      { cue: '4', beatIdx: 3 },
    ]);
    // Ensure NO duplicate count-in was emitted by the fallback
    expect(cuesCaseA.filter((c) => c.cue === 'intro').length).toBe(1);

    // Case B: User placed INTRO directly at firstBeatOffset = 1.2s
    const cuesCaseB: Array<{ cue: string; beatIdx: number }> = [];
    scheduleSectionVoiceCues(
      [{ time: 1.2, name: 'INTRO', cueEnabled: true }],
      shiftedBeatTimes,
      4,
      pre1,
      mockCueBuffers,
      (bufName, beatIdx) => cuesCaseB.push({ cue: bufName, beatIdx }),
      downbeatIndex
    );
    expect(cuesCaseB).toEqual([
      { cue: 'intro', beatIdx: 0 },
      { cue: '2', beatIdx: 1 },
      { cue: '3', beatIdx: 2 },
      { cue: '4', beatIdx: 3 },
    ]);

    // Case C: No opening section -> fallback triggers clean 1-bar count-in right before downbeatIndex
    const cuesCaseC: Array<{ cue: string; beatIdx: number }> = [];
    scheduleSectionVoiceCues(
      [{ time: 9.2, name: 'VERSO 1', cueEnabled: true }],
      shiftedBeatTimes,
      4,
      pre1,
      mockCueBuffers,
      (bufName, beatIdx) => cuesCaseC.push({ cue: bufName, beatIdx }),
      downbeatIndex
    );
    expect(cuesCaseC.filter((c) => c.beatIdx < 4)).toEqual([
      { cue: 'intro', beatIdx: 0 },
      { cue: '2', beatIdx: 1 },
      { cue: '3', beatIdx: 2 },
      { cue: '4', beatIdx: 3 },
    ]);
  });

  it('5. resolveEffectivePreRoll prioritizes persisted liveMixMeta over later BPM edits, with 100% legacy fallback', () => {
    // Exported at 120 BPM with 1C (preRollSec = 2.0), later halved BPM to 60 in Studio without re-exporting
    const exportedSong = {
      prompter_data: {
        bpm: 60,
        timeSignature: '4/4',
        liveMixMeta: {
          preRollSec: 2.0,
          preRollBars: 1,
          bpm: 120,
          timeSignature: '4/4',
          firstBeatOffset: 0,
          musicDurationSec: 185,
          totalDurationSec: 188.5,
          exportedAt: '2026-11-18T16:00:00Z',
          version: 2,
        },
      },
    };
    expect(resolveEffectivePreRoll(exportedSong)).toBe(2.0);
    expect(resolveEffectivePreRollBars(exportedSong)).toBe(1);

    // Exported with 0C (no pre-roll at all)
    const zeroPreRollSong = {
      prompter_data: {
        bpm: 120,
        timeSignature: '4/4',
        liveMixMeta: {
          preRollSec: 0,
          preRollBars: 0,
          bpm: 120,
          timeSignature: '4/4',
          firstBeatOffset: 0,
          musicDurationSec: 180,
          totalDurationSec: 181.5,
          exportedAt: '2026-11-18T16:00:00Z',
          version: 2,
        },
      },
    };
    expect(resolveEffectivePreRoll(zeroPreRollSong)).toBe(0);
    expect(resolveEffectivePreRollBars(zeroPreRollSong)).toBe(0);

    // Legacy song without liveMixMeta -> falls back to exact 2-bar formula (cap 16s)
    const legacySong = {
      prompter_data: { bpm: 120, timeSignature: '4/4' },
    };
    expect(resolveEffectivePreRoll(legacySong)).toBe(computePreRollSecondsForBars(legacySong, 2));
    expect(resolveEffectivePreRoll(legacySong)).toBe(4.0);
    expect(resolveEffectivePreRollBars(legacySong)).toBe(2);
  });

  it('6. resolveEffectivePlaybackBounds eliminates trailing dead tail on auto-advance', () => {
    const songWithMeta = {
      prompter_data: {
        bpm: 120,
        liveMixMeta: {
          preRollSec: 2.0,
          preRollBars: 1,
          bpm: 120,
          timeSignature: '4/4',
          firstBeatOffset: 0,
          musicDurationSec: 180.0,
          totalDurationSec: 183.5,
          exportedAt: '2026-11-18T16:00:00Z',
        },
      },
    };
    const bounds = resolveEffectivePlaybackBounds(songWithMeta, 183.5);
    expect(bounds.preRollSec).toBe(2.0);
    expect(bounds.musicDurationSec).toBe(180.0);
    expect(bounds.autoAdvanceAtGlobalSec).toBeCloseTo(182.35, 3);
  });

  it('7. resolveLyricsTimeMapping aligns LyricVisualizer & Prompter Lane 3 across stem, foh_mix, and re-exported mixes', () => {
    // Lyrics timed against pure Vocal stem
    const stemSynced = {
      prompter_data: {
        bpm: 120,
        liveMixMeta: { preRollSec: 2.0, preRollBars: 1 },
        lyricsSyncMeta: { reference: 'stem', preRollSec: 0 },
      },
    };
    expect(resolveLyricsTimeMapping(stemSynced)).toEqual({
      lyricReferencePreRollSec: 0,
      prompterLyricsOffsetSec: 0,
    });

    // Legacy lyrics timed on old 2C foh_mix (4.0s), then song re-exported with 1C (2.0s)
    const migratedLyrics = {
      prompter_data: {
        bpm: 120,
        liveMixMeta: { preRollSec: 2.0, preRollBars: 1 },
        lyricsSyncMeta: { reference: 'foh_mix', preRollSec: 4.0, migratedFromLegacy: true },
      },
    };
    expect(resolveLyricsTimeMapping(migratedLyrics)).toEqual({
      lyricReferencePreRollSec: 4.0,
      prompterLyricsOffsetSec: -4.0,
    });

    // Legacy song without lyricsSyncMeta defaults to effectivePreRoll (retrocompatible)
    const legacySong = {
      prompter_data: { bpm: 120, timeSignature: '4/4' },
    };
    expect(resolveLyricsTimeMapping(legacySong)).toEqual({
      lyricReferencePreRollSec: 4.0,
      prompterLyricsOffsetSec: -4.0,
    });
  });
});
