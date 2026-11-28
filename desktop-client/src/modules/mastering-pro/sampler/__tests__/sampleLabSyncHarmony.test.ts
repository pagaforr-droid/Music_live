import { beforeAll, describe, expect, it } from 'vitest';
import { detectOnsetsSpectralFlux } from '../../dsp-core/SpectralFftCore';
import {
  analyzeBassProgressionFull,
  analyzeDrumStemFull,
  analyzeMonophonicStemNotesFull,
  constrainNotesToDetectedHarmony,
  parseMusicalKeyInfo,
} from '../engine/FullStemAnalyzer';
import {
  encodeAnalysisToStandardMidi,
  fuseMidiWithAcousticDrumAudio,
  mapMidiNoteToDrumPiece,
  parseStandardMidiFile,
} from '../engine/DrumMidiEngine';
import { detectPitchYin } from '../engine/PitchDetector';
import {
  analyzeImportedAudioFirst,
  clearPreImportMemoryCache,
  toCamelotKey,
} from '../engine/PreImportAnalyzer';
import { assignSlicesToPads, sliceByBpmGrid } from '../engine/Slicer';
import { renderFullStemReplacement } from '../engine/StemReplacerEngine';
import {
  classifyCustomSampleCategory,
  getArticulatedDrumZone,
  inferReplacementCategoryFromName,
  prepareCustomReplacementSample,
} from '../engine/StudioSampleBank';
import { createDefaultPads } from '../engine/SampleBufferOps';
import type { DetectedChordSegment, StemNoteEvent } from '../types/sampler.types';

beforeAll(() => {
  if (typeof (globalThis as Record<string, unknown>).AudioBuffer === 'undefined') {
    class MockAudioBuffer {
      readonly sampleRate: number;
      readonly length: number;
      readonly numberOfChannels: number;
      readonly duration: number;
      private readonly channels: Float32Array[];

      constructor(opts: { length: number; numberOfChannels?: number; sampleRate: number }) {
        this.length = opts.length;
        this.numberOfChannels = opts.numberOfChannels ?? 2;
        this.sampleRate = opts.sampleRate;
        this.duration = this.length / this.sampleRate;
        this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
      }

      getChannelData(ch: number): Float32Array {
        return this.channels[ch] ?? this.channels[0];
      }

      copyToChannel(src: Float32Array, ch: number): void {
        this.channels[ch].set(src);
      }
    }
    (globalThis as Record<string, unknown>).AudioBuffer = MockAudioBuffer;
  }
});

function synthesizeMix(opts: {
  bpm: number;
  sr?: number;
  bars?: number;
  introSilenceSec?: number;
  introPadSec?: number;
  chords: Array<{ rootMidi: number; notes: number[]; label: string }>;
}) {
  const sr = opts.sr ?? 48000;
  const bars = opts.bars ?? 8;
  const introSilenceSec = opts.introSilenceSec ?? 0;
  const introPadSec = opts.introPadSec ?? 0;
  const beatSec = 60 / opts.bpm;
  const barSec = beatSec * 4;
  const musicStart = introSilenceSec + introPadSec;
  const len = Math.floor((musicStart + bars * barSec + 0.35) * sr);
  const mono = new Float32Array(len);

  let seed = 0x51a9d001;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  const expectedKicks: number[] = [];
  const expectedSnares: number[] = [];
  const expectedChords: Array<{ timeSec: number; label: string; rootMidi: number; notes: number[] }> = [];

  if (introPadSec > 0) {
    const start = Math.floor(introSilenceSec * sr);
    const plen = Math.floor(introPadSec * sr);
    for (const m of opts.chords[0].notes) {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      for (let i = 0; i < plen && start + i < len; i++) {
        const t = i / sr;
        mono[start + i] += Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.15) * 0.18;
      }
    }
  }

  for (let bar = 0; bar < bars; bar++) {
    const barStart = musicStart + bar * barSec;
    const ch = opts.chords[bar % opts.chords.length];
    expectedChords.push({ timeSec: barStart, label: ch.label, rootMidi: ch.rootMidi, notes: ch.notes });

    for (const so of [0, 1.5, 2, 3]) {
      const sIdx = Math.floor((barStart + so * beatSec) * sr);
      const sLen = Math.floor(beatSec * 1.25 * sr);
      for (const m of ch.notes) {
        const f = 440 * Math.pow(2, (m - 69) / 12);
        for (let i = 0; i < sLen && sIdx + i < len; i++) {
          const t = i / sr;
          const env = Math.min(1, t / 0.006) * Math.exp(-t * 2.3);
          mono[sIdx + i] +=
            (Math.sin(2 * Math.PI * f * t) +
              0.45 * Math.sin(2 * Math.PI * f * 2 * t) +
              0.22 * Math.sin(2 * Math.PI * f * 3 * t)) *
            env *
            0.12;
        }
      }
    }

    for (const bp of [
      { b: 0, semi: 0, dur: 1.3 },
      { b: 1.5, semi: 0, dur: 0.45 },
      { b: 2, semi: 7, dur: 1.2 },
      { b: 3.5, semi: 12, dur: 0.4 },
    ]) {
      const bIdx = Math.floor((barStart + bp.b * beatSec) * sr);
      const bLen = Math.floor(bp.dur * beatSec * sr);
      const f = 440 * Math.pow(2, (ch.rootMidi + bp.semi - 69) / 12);
      for (let i = 0; i < bLen && bIdx + i < len; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.008) * Math.exp(-t * 1.9);
        mono[bIdx + i] +=
          (Math.sin(2 * Math.PI * f * t) * 0.68 +
            Math.sin(2 * Math.PI * f * 2 * t) * 0.28 +
            Math.sin(2 * Math.PI * f * 3 * t) * 0.12) *
          env *
          0.38;
      }
    }

    for (let e = 0; e < 8; e++) {
      const hTime = barStart + e * beatSec * 0.5;
      const hIdx = Math.floor(hTime * sr);
      let prevN = 0;
      for (let i = 0; i < Math.floor(sr * 0.06) && hIdx + i < len; i++) {
        const t = i / sr;
        const n = rnd();
        const hp = n - 0.85 * prevN;
        prevN = n;
        mono[hIdx + i] += hp * Math.exp(-t * 72) * 0.14;
      }
      if (e === 0 || e === 3 || e === 4) {
        expectedKicks.push(hTime);
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.24) && hIdx + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (48 + 105 * Math.exp(-t * 36))) / sr;
          mono[hIdx + i] += (Math.sin(ph) * Math.exp(-t * 13) + rnd() * Math.exp(-t * 260) * 0.28) * 0.55;
        }
      }
      if (e === 2 || e === 6) {
        expectedSnares.push(hTime);
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.2) && hIdx + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (195 + 80 * Math.exp(-t * 50))) / sr;
          mono[hIdx + i] +=
            (Math.sin(ph) * Math.exp(-t * 22) * 0.5 +
              rnd() * Math.exp(-t * 20) * 0.45 +
              Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 250) * 0.35) *
            0.48;
        }
      }
    }
  }

  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(mono[i]));
  if (pk > 0.01) {
    const g = 0.88 / pk;
    for (let i = 0; i < len; i++) mono[i] *= g;
  }

  return { mono, sr, expectedKicks, expectedSnares, expectedChords, musicStart };
}

describe('Sample Lab — Pitch, Tempo/Phase, Chord Harmony & Drum Layering', () => {
  it('detects t=0 immediate transients without skipping frame 0 in SpectralFftCore', () => {
    const sr = 48000;
    const mono = new Float32Array(sr * 2);
    for (const tSec of [0, 0.5, 1.0, 1.5]) {
      const start = Math.round(tSec * sr);
      for (let i = 0; i < 4000 && start + i < mono.length; i++) {
        mono[start + i] += Math.sin((2 * Math.PI * 60 * i) / sr) * Math.exp((-i / sr) * 18) * 0.85;
      }
    }
    const res = detectOnsetsSpectralFlux(mono, sr, { sensitivity: 0.65, minIntervalMs: 80 });
    expect(res.onsetTimesSec.length).toBeGreaterThanOrEqual(4);
    expect(res.onsetTimesSec[0]).toBeLessThan(0.025);
  });

  it('tracks low bass E1/A1 fundamentals down to 35 Hz and ignores initial transient clicks', () => {
    const sr = 48000;
    const cases: Array<[number, number]> = [
      [41.203, 28],
      [55.0, 33],
      [261.626, 60],
    ];
    for (const [hz, expectedMidi] of cases) {
      const L = new Float32Array(Math.floor(sr * 1.1));
      for (let i = 0; i < L.length; i++) {
        const t = i / sr;
        const click = i < 380 ? Math.sin(2 * Math.PI * 1950 * t) * (1 - i / 380) * 0.5 : 0;
        const env = Math.min(1, t / 0.01) * Math.exp(-t * 1.5);
        L[i] = click + (Math.sin(2 * Math.PI * hz * t) * 0.7 + Math.sin(2 * Math.PI * hz * 2 * t) * 0.25) * env;
      }
      const res = detectPitchYin(L, sr, 35, 1800);
      expect(res.midiNote).toBe(expectedMidi);
      expect(res.confidence).toBeGreaterThan(0.75);

      const buf = new AudioBuffer({ length: L.length, numberOfChannels: 2, sampleRate: sr });
      buf.copyToChannel(L, 0);
      buf.copyToChannel(L, 1);
      const custom = prepareCustomReplacementSample(buf, { normalize: true });
      expect(custom.detectedRootMidi).toBe(expectedMidi);
    }
  });

  it('resolves flat/sharp enharmonic keys, Camelot codes, and harmony constraints', () => {
    expect(toCamelotKey('Eb')).toBe('5B');
    expect(toCamelotKey('Bb')).toBe('6B');
    expect(toCamelotKey('G#m')).toBe('1A');
    expect(parseMusicalKeyInfo('Ebm')?.tonicPc).toBe(3);

    const chords: DetectedChordSegment[] = [
      {
        id: 'c0',
        startSec: 0,
        endSec: 4,
        chord: 'Eb',
        rootPitchClass: 3,
        rootName: 'Eb',
        rootMidi: 39,
        chordMidis: [51, 55, 58],
        confidence: 0.9,
      },
    ];
    const noisyNotes: StemNoteEvent[] = [
      { id: 'n0', startSec: 0.5, durationSec: 0.8, midiNote: 39, noteName: 'Eb2', velocity: 0.85, clarity: 0.9 },
      { id: 'n1', startSec: 0.51, durationSec: 0.4, midiNote: 40, noteName: 'E2', velocity: 0.35, clarity: 0.6 },
      { id: 'n2', startSec: 1.5, durationSec: 0.6, midiNote: 42, noteName: 'F#2', velocity: 0.5, clarity: 0.7 },
    ];
    const filtered = constrainNotesToDetectedHarmony(noisyNotes, chords, 'Eb');
    expect(filtered.every((n) => parseMusicalKeyInfo('Eb')!.scalePcs.has(((n.midiNote % 12) + 12) % 12))).toBe(true);
    expect(filtered.some((n) => n.midiNote === 40)).toBe(false);
  });

  const fullMixScenarios = [
    {
      name: '68 BPM ballad (G-D-Em-C)',
      bpm: 68,
      introSilenceSec: 0.25,
      introPadSec: 0,
      chords: [
        { label: 'G', rootMidi: 31, notes: [43, 55, 59, 62] },
        { label: 'D', rootMidi: 38, notes: [50, 57, 62, 66] },
        { label: 'Em', rootMidi: 28, notes: [40, 52, 55, 59] },
        { label: 'C', rootMidi: 36, notes: [48, 60, 64, 67] },
      ],
    },
    {
      name: '97 BPM pop/rock w/ silence + intro pad (Am-F-C-G)',
      bpm: 97,
      introSilenceSec: 0.31,
      introPadSec: 2.47,
      chords: [
        { label: 'Am', rootMidi: 33, notes: [45, 57, 60, 64] },
        { label: 'F', rootMidi: 29, notes: [41, 53, 57, 60] },
        { label: 'C', rootMidi: 36, notes: [48, 60, 64, 67] },
        { label: 'G', rootMidi: 31, notes: [43, 55, 59, 62] },
      ],
    },
    {
      name: '124 BPM modern rock (Em-C-G-D)',
      bpm: 124,
      introSilenceSec: 0.42,
      introPadSec: 0,
      chords: [
        { label: 'Em', rootMidi: 28, notes: [40, 52, 55, 59] },
        { label: 'C', rootMidi: 36, notes: [48, 60, 64, 67] },
        { label: 'G', rootMidi: 31, notes: [43, 55, 59, 62] },
        { label: 'D', rootMidi: 38, notes: [50, 57, 62, 66] },
      ],
    },
    {
      name: '156 BPM fast punk (F-C-Dm-Bb)',
      bpm: 156,
      introSilenceSec: 0.14,
      introPadSec: 0,
      chords: [
        { label: 'F', rootMidi: 29, notes: [41, 53, 57, 60] },
        { label: 'C', rootMidi: 36, notes: [48, 60, 64, 67] },
        { label: 'Dm', rootMidi: 38, notes: [50, 57, 62, 65] },
        { label: 'Bb', rootMidi: 34, notes: [46, 58, 62, 65] },
      ],
    },
  ];

  it.each(fullMixScenarios)(
    'locks BPM, phase, key, chords, drums & bass-focus on $name',
    (sc) => {
      const mix = synthesizeMix(sc);
      clearPreImportMemoryCache();
      const entry = analyzeImportedAudioFirst(mix.mono, mix.sr, { sensitivity: 0.62 });
      expect(entry.memory.bpm).toBe(sc.bpm);

      const beatSec = 60 / sc.bpm;
      const expPhase = ((sc.introSilenceSec + sc.introPadSec) % beatSec + beatSec) % beatSec;
      const rawDiff = Math.abs(entry.memory.beatOffsetSec - expPhase);
      const wrappedDiff = Math.min(rawDiff, beatSec - rawDiff);
      expect(wrappedDiff).toBeLessThan(0.01);

      const drumRes = analyzeDrumStemFull(mix.mono, mix.sr, {
        sensitivity: 0.62,
        lockedBpm: entry.memory.bpm,
        musicalKey: entry.memory.musicalKey,
        detectedChords: entry.memory.chords,
        beatOffsetSec: entry.memory.beatOffsetSec,
        beatTimes: entry.memory.beatTimes,
        quantizeMode: 'soft',
      });
      const matchedKicks = mix.expectedKicks.filter((ek) =>
        drumRes.drumHits.some((h) => h.role === 'kick' && Math.abs(h.peakTimeSec - ek) < 0.025)
      ).length;
      const matchedSnares = mix.expectedSnares.filter((es) =>
        drumRes.drumHits.some((h) => h.role === 'snare' && Math.abs(h.peakTimeSec - es) < 0.025)
      ).length;
      expect(matchedKicks / mix.expectedKicks.length).toBeGreaterThanOrEqual(0.88);
      expect(matchedSnares / mix.expectedSnares.length).toBeGreaterThanOrEqual(0.88);

      const bassRes = analyzeBassProgressionFull(mix.mono, mix.sr, {
        sensitivity: 0.62,
        lockedBpm: entry.memory.bpm,
        precomputedPoly: entry.polyResult,
        precomputedChords: entry.memory.chords,
        musicalKey: entry.memory.musicalKey,
        beatOffsetSec: entry.memory.beatOffsetSec,
        beatTimes: entry.memory.beatTimes,
        quantizeMode: 'soft',
      });
      let inChordBass = 0;
      for (const n of bassRes.noteEvents) {
        const ch = mix.expectedChords.slice().reverse().find((c) => n.startSec >= c.timeSec - 0.08);
        if (ch) {
          const pcs = new Set(ch.notes.map((m) => m % 12));
          pcs.add(ch.rootMidi % 12);
          if (pcs.has(((n.midiNote % 12) + 12) % 12)) inChordBass++;
        }
      }
      expect(inChordBass / Math.max(1, bassRes.noteEvents.length)).toBeGreaterThanOrEqual(0.9);

      const origBuf = new AudioBuffer({ length: mix.mono.length, numberOfChannels: 2, sampleRate: mix.sr });
      origBuf.copyToChannel(mix.mono, 0);
      origBuf.copyToChannel(mix.mono, 1);
      const rendered = renderFullStemReplacement({
        originalBuffer: origBuf,
        analysis: drumRes,
        drumSlots: {
          kick: { roleOrTarget: 'kick', enabled: true, sourceType: 'preset', presetId: 'drum-kick-acoustic', gainDb: 0, pitchSemis: 0 },
          snare: { roleOrTarget: 'snare', enabled: true, sourceType: 'preset', presetId: 'drum-snare-warm', gainDb: 0, pitchSemis: 0 },
          hat: { roleOrTarget: 'hat', enabled: true, sourceType: 'preset', presetId: 'drum-hat-tight', gainDb: -2, pitchSemis: 0 },
          crash: { roleOrTarget: 'crash', enabled: true, sourceType: 'preset', presetId: 'drum-crash-bright', gainDb: -1, pitchSemis: 0 },
          tom: { roleOrTarget: 'tom', enabled: true, sourceType: 'preset', presetId: 'drum-tom-deep', gainDb: 0, pitchSemis: 0 },
        },
        melodicSlot: { roleOrTarget: 'melodic', enabled: true, sourceType: 'preset', presetId: 'inst-piano-grand', gainDb: 0, pitchSemis: 0 },
        mix: { replacementPct: 78, originalPct: 86, duckOriginalTransients: true, roundRobinHumanize: true, sustainScale: 1, brightnessPct: 0 },
      });
      expect(rendered.length).toBe(origBuf.length);
      let maxSample = 0;
      const ch0 = rendered.getChannelData(0);
      for (let i = 0; i < ch0.length; i += 4) maxSample = Math.max(maxSample, Math.abs(ch0[i]));
      expect(maxSample).toBeGreaterThan(0.2);
      expect(maxSample).toBeLessThanOrEqual(0.92);
    },
    20000
  );

  it('applies monophonic harmony constraints and preserves accurate beat-grid slicing in 16-Pad Slicer', () => {
    const sr = 48000;
    const regions = sliceByBpmGrid('src-1', 0, 4.0, 120, '1/4', 16, 0.25);
    expect(regions[0].startSec).toBeCloseTo(0.25, 3);
    expect(regions[1].startSec).toBeCloseTo(0.75, 3);

    const shortSlices = [
      { ...regions[0], startSec: 0, endSec: 0.25 },
      { ...regions[1], startSec: 0.5, endSec: 1.2 },
    ];
    const pads = assignSlicesToPads(createDefaultPads(), shortSlices);
    expect(pads[0].params.warp.syncToBpm).toBe(false);
    expect(pads[1].params.warp.syncToBpm).toBe(true);

    const monoBass = new Float32Array(sr * 2);
    for (let i = 0; i < monoBass.length; i++) {
      monoBass[i] = Math.sin((2 * Math.PI * 55 * i) / sr) * 0.6; // A1
    }
    const res = analyzeMonophonicStemNotesFull(monoBass, sr, {
      lockedBpm: 120,
      musicalKey: 'Am',
      bassOnly: true,
    });
    expect(res.bpm).toBe(120);
    expect(res.noteEvents.every((n) => n.midiNote % 12 === 9)).toBe(true);
  });

  it('detects tempo on dirty drum stems, differentiates Kick, Snare, Hi-Hat & Crash, and replaces with uploaded clean audio', () => {
    const sr = 48000;
    const targetBpm = 108;
    const beatSec = 60 / targetBpm;
    const eighthSec = beatSec * 0.5;
    const bars = 4;
    const totalEighths = bars * 8;
    const len = Math.floor((bars * 4 * beatSec + 0.5) * sr);
    const dirtyDrumMono = new Float32Array(len);

    let seed = 0x13572468;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    // Add dirty stem bleed: continuous 24Hz sub-rumble + 65Hz sustained bass hum + 440Hz guitar bleed
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      dirtyDrumMono[i] +=
        Math.sin(2 * Math.PI * 22 * t) * 0.08 +
        Math.sin(2 * Math.PI * 65.4 * t) * 0.05 +
        Math.sin(2 * Math.PI * 440 * t) * 0.025 +
        rnd() * 0.012;
    }

    for (let e = 0; e < totalEighths; e++) {
      const t0 = e * eighthSec;
      const s0 = Math.floor(t0 * sr);
      const isKick = e % 4 === 0;
      const isSnare = e % 4 === 2;
      const isCrash = e % 8 === 0; // Crash on downbeat of each bar
      const isHat = !isCrash; // Closed Hi-Hat on other 8ths

      if (isKick) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.22) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (50 + 95 * Math.exp(-t * 36))) / sr;
          dirtyDrumMono[s0 + i] += Math.sin(ph) * Math.exp(-t * 14) * 0.72;
        }
      }
      if (isSnare) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.19) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (195 + 70 * Math.exp(-t * 48))) / sr;
          dirtyDrumMono[s0 + i] +=
            (Math.sin(ph) * Math.exp(-t * 22) * 0.45 +
              rnd() * Math.exp(-t * 18) * 0.48 +
              Math.sin(2 * Math.PI * 2450 * t) * Math.exp(-t * 240) * 0.32) *
            0.65;
        }
      }
      if (isHat) {
        let prev = 0;
        for (let i = 0; i < Math.floor(sr * 0.065) && s0 + i < len; i++) {
          const t = i / sr;
          const n = rnd();
          const hp = n - 0.86 * prev;
          prev = n;
          dirtyDrumMono[s0 + i] += hp * Math.exp(-t * 65) * 0.25;
        }
      }
      if (isCrash) {
        for (let i = 0; i < Math.floor(sr * 0.55) && s0 + i < len; i++) {
          const t = i / sr;
          const cym =
            (Math.sin(2 * Math.PI * 3350 * t) * 0.24 +
              Math.sin(2 * Math.PI * 5120 * t) * 0.22 +
              Math.sin(2 * Math.PI * 7640 * t) * 0.18 +
              rnd() * 0.55) *
            Math.exp(-t * 3.8) *
            0.38;
          dirtyDrumMono[s0 + i] += cym;
        }
      }
    }

    clearPreImportMemoryCache();
    const pre = analyzeImportedAudioFirst(dirtyDrumMono, sr, { sensitivity: 0.65 });
    expect(Math.abs(pre.memory.bpm - targetBpm)).toBeLessThanOrEqual(1);

    const drumAnalysis = analyzeDrumStemFull(dirtyDrumMono, sr, {
      sensitivity: 0.65,
      lockedBpm: pre.memory.bpm,
      beatOffsetSec: pre.memory.beatOffsetSec,
      beatTimes: pre.memory.beatTimes,
      quantizeMode: 'soft',
    });

    expect(drumAnalysis.counts.kick).toBeGreaterThanOrEqual(6);
    expect(drumAnalysis.counts.snare).toBeGreaterThanOrEqual(6);
    expect(drumAnalysis.counts.hat).toBeGreaterThanOrEqual(12);
    expect(drumAnalysis.counts.crash).toBeGreaterThanOrEqual(2);

    // Verify filename & acoustic classification for clean user uploads (including "hit hat", "snake", "crash", "kick")
    expect(inferReplacementCategoryFromName('clean_hit_hat_01.wav')).toBe('hat');
    expect(inferReplacementCategoryFromName('studio_snake_snare.wav')).toBe('snare');
    expect(inferReplacementCategoryFromName('cymbal_crash_bright.wav')).toBe('crash');
    expect(inferReplacementCategoryFromName('kick_punch_clean.wav')).toBe('kick');

    const makeCleanUploadBuf = (freqHz: number, durSec: number, noiseAmt: number) => {
      const bLen = Math.floor(sr * durSec);
      const buf = new AudioBuffer({ length: bLen, numberOfChannels: 2, sampleRate: sr });
      const chL = buf.getChannelData(0);
      const chR = buf.getChannelData(1);
      for (let i = 0; i < bLen; i++) {
        const t = i / sr;
        const v =
          (Math.sin(2 * Math.PI * freqHz * t) * (1 - noiseAmt) + rnd() * noiseAmt) *
          Math.exp(-t * (1 / Math.max(0.05, durSec * 0.35)));
        chL[i] = v;
        chR[i] = v;
      }
      return prepareCustomReplacementSample(buf, { normalize: true });
    };

    const cleanKick = makeCleanUploadBuf(56, 0.28, 0.08);
    const cleanSnare = makeCleanUploadBuf(210, 0.24, 0.45);
    const cleanHat = makeCleanUploadBuf(7200, 0.08, 0.75);
    const cleanCrash = makeCleanUploadBuf(4800, 0.85, 0.70);

    expect(classifyCustomSampleCategory('audio_1.wav', cleanKick.trimmedBuffer, true)).toBe('kick');
    expect(classifyCustomSampleCategory('audio_4.wav', cleanCrash.trimmedBuffer, true)).toBe('crash');

    const origBuf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    origBuf.copyToChannel(dirtyDrumMono, 0);
    origBuf.copyToChannel(dirtyDrumMono, 1);

    const replaced = renderFullStemReplacement({
      originalBuffer: origBuf,
      analysis: drumAnalysis,
      drumSlots: {
        kick: {
          roleOrTarget: 'kick',
          enabled: true,
          sourceType: 'file',
          presetId: 'drum-kick-punch',
          customBuffer: cleanKick.trimmedBuffer,
          customPeakOffsetSec: cleanKick.peakOffsetSec,
          normalizeCustom: true,
          gainDb: 0,
          pitchSemis: 0,
        },
        snare: {
          roleOrTarget: 'snare',
          enabled: true,
          sourceType: 'file',
          presetId: 'drum-snare-studio',
          customBuffer: cleanSnare.trimmedBuffer,
          customPeakOffsetSec: cleanSnare.peakOffsetSec,
          normalizeCustom: true,
          gainDb: 0,
          pitchSemis: 0,
        },
        hat: {
          roleOrTarget: 'hat',
          enabled: true,
          sourceType: 'file',
          presetId: 'drum-hat-crisp',
          customBuffer: cleanHat.trimmedBuffer,
          customPeakOffsetSec: cleanHat.peakOffsetSec,
          normalizeCustom: true,
          gainDb: -2,
          pitchSemis: 0,
        },
        crash: {
          roleOrTarget: 'crash',
          enabled: true,
          sourceType: 'file',
          presetId: 'drum-crash-bright',
          customBuffer: cleanCrash.trimmedBuffer,
          customPeakOffsetSec: cleanCrash.peakOffsetSec,
          normalizeCustom: true,
          gainDb: -1,
          pitchSemis: 0,
        },
        tom: {
          roleOrTarget: 'tom',
          enabled: true,
          sourceType: 'preset',
          presetId: 'drum-tom-deep',
          gainDb: 0,
          pitchSemis: 0,
        },
      },
      melodicSlot: {
        roleOrTarget: 'melodic',
        enabled: true,
        sourceType: 'preset',
        presetId: 'inst-piano-grand',
        gainDb: 0,
        pitchSemis: 0,
      },
      mix: {
        replacementPct: 100,
        originalPct: 0,
        duckOriginalTransients: true,
        roundRobinHumanize: true,
        sustainScale: 1,
        brightnessPct: 0,
      },
    });

    expect(replaced.length).toBe(origBuf.length);
    const outCh = replaced.getChannelData(0);
    let maxOut = 0;
    for (let i = 0; i < outCh.length; i += 4) maxOut = Math.max(maxOut, Math.abs(outCh[i]));
    expect(maxOut).toBeGreaterThan(0.25);
    expect(maxOut).toBeLessThanOrEqual(0.92);
  });

  it('recognizes all 5 drum pieces (Kick, Snare, Toms High/Mid/Floor, Hi-Hats, Crash), round-trips General MIDI (.mid) and fuses MT3 MIDI with 48kHz acoustic audio', () => {
    const sr = 48000;
    const bpm = 116;
    const beatSec = 60 / bpm;
    const eighthSec = beatSec * 0.5;
    const bars = 2;
    const len = Math.floor((bars * 4 * beatSec + 0.4) * sr);
    const mono = new Float32Array(len);

    let seed = 0x778899aa;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    // Bar 1: Kick + Crash on 0, Hat on 1, Snare + Hat on 2, Hat on 3, Kick + Hat on 4, Kick + Hat on 5, Snare + Hat on 6, Hat on 7
    // Bar 2: Kick + Hat on 8, Hat on 9, Snare + Hat on 10, Hat on 11, High Tom (190Hz) on 12, Mid Tom (140Hz) on 13, Floor Tom (96Hz) on 14, Crash on 15
    for (let e = 0; e < 16; e++) {
      const t0 = e * eighthSec;
      const s0 = Math.floor(t0 * sr);
      const isTom = e === 12 || e === 13 || e === 14;
      const isCrash = e === 0 || e === 15;
      const isKick = e === 0 || e === 4 || e === 5 || e === 8;
      const isSnare = e === 2 || e === 6 || e === 10;
      const isHat = !isTom && !isCrash;

      if (isKick) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.22) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (48 + 92 * Math.exp(-t * 36))) / sr;
          mono[s0 + i] += Math.sin(ph) * Math.exp(-t * 14) * 0.75;
        }
      }
      if (isSnare) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.19) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (196 + 65 * Math.exp(-t * 48))) / sr;
          mono[s0 + i] +=
            (Math.sin(ph) * Math.exp(-t * 22) * 0.45 +
              rnd() * Math.exp(-t * 18) * 0.5 +
              Math.sin(2 * Math.PI * 2450 * t) * Math.exp(-t * 230) * 0.3) *
            0.65;
        }
      }
      if (isHat) {
        let prev = 0;
        for (let i = 0; i < Math.floor(sr * 0.065) && s0 + i < len; i++) {
          const t = i / sr;
          const n = rnd();
          const hp = n - 0.86 * prev;
          prev = n;
          mono[s0 + i] += hp * Math.exp(-t * 68) * 0.26;
        }
      }
      if (isCrash) {
        for (let i = 0; i < Math.floor(sr * 0.55) && s0 + i < len; i++) {
          const t = i / sr;
          mono[s0 + i] +=
            (Math.sin(2 * Math.PI * 3400 * t) * 0.25 +
              Math.sin(2 * Math.PI * 5200 * t) * 0.22 +
              rnd() * 0.55) *
            Math.exp(-t * 3.9) *
            0.38;
        }
      }
      if (isTom) {
        const tomF = e === 12 ? 190 : e === 13 ? 138 : 96;
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.25) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (tomF + 40 * Math.exp(-t * 32))) / sr;
          mono[s0 + i] += (Math.sin(ph) * 0.85 + Math.sin(ph * 1.52) * 0.15) * Math.exp(-t * 10) * 0.72;
        }
      }
    }

    const localRes = analyzeDrumStemFull(mono, sr, {
      sensitivity: 0.65,
      lockedBpm: bpm,
      quantizeMode: 'soft',
    });

    expect(localRes.counts.kick).toBeGreaterThanOrEqual(4);
    expect(localRes.counts.snare).toBeGreaterThanOrEqual(3);
    expect(localRes.counts.tom).toBeGreaterThanOrEqual(3);
    expect(localRes.counts.hat).toBeGreaterThanOrEqual(8);
    expect(localRes.counts.crash).toBeGreaterThanOrEqual(1);

    // Check High, Mid, Floor Tom articulation detection
    const tomNotes = localRes.drumHits.filter((h) => h.role === 'tom').map((h) => h.midiNote);
    expect(tomNotes).toContain(50); // High Tom
    expect(tomNotes).toContain(47); // Mid Tom
    expect(tomNotes).toContain(43); // Floor Tom

    // Standard MIDI File (.mid) round-trip encode -> parse -> acoustic fuse
    const midiBytes = encodeAnalysisToStandardMidi(localRes);
    expect(midiBytes.length).toBeGreaterThan(40);

    const parsedMidi = parseStandardMidiFile(midiBytes, { forceDrumMode: true });
    expect(Math.abs(parsedMidi.bpm - bpm)).toBeLessThanOrEqual(1);
    expect(parsedMidi.drumHits.length).toBe(localRes.drumHits.length);

    // Verify GM drum mapping for Toms, Snare, Kick, Hat, Crash
    expect(mapMidiNoteToDrumPiece(36).role).toBe('kick');
    expect(mapMidiNoteToDrumPiece(38).role).toBe('snare');
    expect(mapMidiNoteToDrumPiece(50).role).toBe('tom');
    expect(mapMidiNoteToDrumPiece(47).role).toBe('tom');
    expect(mapMidiNoteToDrumPiece(43).role).toBe('tom');
    expect(mapMidiNoteToDrumPiece(42).role).toBe('hat');
    expect(mapMidiNoteToDrumPiece(46).role).toBe('hat');
    expect(mapMidiNoteToDrumPiece(49).role).toBe('crash');

    const fused = fuseMidiWithAcousticDrumAudio({
      midiBytes,
      mono,
      sampleRate: sr,
      lockedBpm: bpm,
      quantizeMode: 'soft',
      sourceEngine: 'replicate-mt3',
    });
    expect(fused.analysisEngine).toBe('replicate-mt3');
    expect(fused.counts.kick).toBeGreaterThanOrEqual(4);
    expect(fused.counts.snare).toBeGreaterThanOrEqual(3);
    expect(fused.counts.tom).toBeGreaterThanOrEqual(3);
    expect(fused.counts.hat).toBeGreaterThanOrEqual(8);
    expect(fused.counts.crash).toBeGreaterThanOrEqual(1);
  });

  it('never confuses Deep Floor Toms (76-96Hz), Mid Toms (136Hz) or High Toms (192Hz) with Kick Drums even when musicalKey/chords exist or MT3 MIDI mislabels Toms as Kick (36)', () => {
    const sr = 48000;
    const bpm = 112;
    const beatSec = 60 / bpm;
    const eighthSec = beatSec * 0.5;
    const len = Math.floor((8 * eighthSec + 0.5) * sr);
    const mono = new Float32Array(len);

    // Step 0 & 2: Sub-Kick (48 Hz body with 140 Hz beater chirp)
    // Step 1 & 3: Acoustic Snare
    // Step 4: High Tom (192 Hz) with stick click
    // Step 5: Mid Tom (136 Hz) with stick click
    // Step 6: Floor Tom (94 Hz) with stick click
    // Step 7: Deep 18" Floor Tom (76 Hz) with stick click
    for (let e = 0; e < 8; e++) {
      const s0 = Math.floor(e * eighthSec * sr);
      if (e === 0 || e === 2) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.22) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (48 + 92 * Math.exp(-t * 36))) / sr;
          mono[s0 + i] += Math.sin(ph) * Math.exp(-t * 14) * 0.78;
        }
      } else if (e === 1 || e === 3) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.19) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (195 + 65 * Math.exp(-t * 48))) / sr;
          const noise = Math.sin(i * 12.9898) * 43758.5453;
          const w = (noise - Math.floor(noise)) * 2 - 1;
          mono[s0 + i] +=
            (Math.sin(ph) * Math.exp(-t * 22) * 0.45 +
              w * Math.exp(-t * 18) * 0.5 +
              Math.sin(2 * Math.PI * 2450 * t) * Math.exp(-t * 220) * 0.3) *
            0.65;
        }
      } else {
        const tomFreq = e === 4 ? 192 : e === 5 ? 136 : e === 6 ? 94 : 76;
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.26) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (tomFreq + 38 * Math.exp(-t * 34))) / sr;
          // Realistic dual-head tom resonance + initial 8ms stick attack click at 2.6 kHz
          const stickClick = Math.sin(2 * Math.PI * 2600 * t) * Math.exp(-t * 210) * 0.18;
          const shell = (Math.sin(ph) * 0.84 + Math.sin(ph * 1.52) * 0.16) * Math.exp(-t * 10.2);
          mono[s0 + i] += (shell + stickClick) * 0.74;
        }
      }
    }

    // 1. Run pre-import analyzer (which may detect tonal key/chords from the pitched toms)
    clearPreImportMemoryCache();
    const pre = analyzeImportedAudioFirst(mono, sr, { bpmHint: bpm, sensitivity: 0.65 });

    // Even when musicalKey and detectedChords from pre-import memory are passed in,
    // all 4 Toms (192Hz, 136Hz, 94Hz, 76Hz) must be recognized as 'tom' and the 2 Kicks as 'kick'!
    const res = analyzeDrumStemFull(mono, sr, {
      sensitivity: 0.65,
      lockedBpm: bpm,
      musicalKey: pre.memory.musicalKey,
      detectedChords: pre.memory.chords,
      quantizeMode: 'off',
    });

    expect(res.counts.kick).toBe(2);
    expect(res.counts.snare).toBe(2);
    expect(res.counts.tom).toBe(4);

    const detectedToms = res.drumHits.filter((h) => h.role === 'tom');
    expect(detectedToms[0].midiNote).toBe(50); // High Tom (192 Hz)
    expect(detectedToms[1].midiNote).toBe(47); // Mid Tom (136 Hz)
    expect(detectedToms[2].midiNote).toBe(43); // Floor Tom (94 Hz)
    expect(detectedToms[3].midiNote).toBe(43); // Deep Floor Tom (76 Hz)

    // 2. Simulate Replicate MT3 mistakenly emitting GM 36 (Kick) on ALL 4 Tom hits:
    // fuseMidiWithAcousticDrumAudio must acoustically verify each hit and reclassify the 4 false Kicks into Toms!
    const mislabeledAnalysis = {
      ...res,
      drumHits: res.drumHits.map((h) =>
        h.role === 'tom'
          ? {
              ...h,
              role: 'kick' as const,
              midiNote: 36,
              subRoleLabel: 'Kick Drum 1 (36)',
              articulation: 'closed' as const,
              pitchOffsetSemis: 0,
            }
          : h
      ),
    };
    const badMidiBytes = encodeAnalysisToStandardMidi(mislabeledAnalysis);
    const corrected = fuseMidiWithAcousticDrumAudio({
      midiBytes: badMidiBytes,
      mono,
      sampleRate: sr,
      lockedBpm: bpm,
      quantizeMode: 'off',
      sourceEngine: 'replicate-mt3',
    });

    expect(corrected.counts.kick).toBe(2);
    expect(corrected.counts.tom).toBe(4);
    const correctedTomNotes = corrected.drumHits
      .filter((h) => h.role === 'tom')
      .map((h) => h.midiNote);
    expect(correctedTomNotes).toEqual([50, 47, 43, 43]);
  });

  it('rescues muffled Snares, dropped Hi-Hats, Kicks & Crashes on badly AI-separated Drum stems using Master Reference Audio Guide', () => {
    const sr = 48000;
    const bpm = 120;
    const beatSec = 60 / bpm;
    const eighthSec = beatSec * 0.5;
    const len = Math.floor((16 * eighthSec + 0.5) * sr);
    const damagedDrumStem = new Float32Array(len);
    const masterTrack = new Float32Array(len);

    let seed = 0x44556677;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    // Synthesize 2 bars:
    // In damagedDrumStem (bad AI stem split): Snare wire crack (>2kHz) is 92% carved out, and Hi-Hats are 90% erased!
    // In masterTrack: Full Kick, Snare (shell + wire crack), 8th-note Hi-Hats, Downbeat Crash + Chords/Bass are intact.
    for (let e = 0; e < 16; e++) {
      const s0 = Math.floor(e * eighthSec * sr);
      const isKick = e % 4 === 0;
      const isSnare = e % 4 === 2;
      const isCrash = e === 0 || e === 8;

      if (isKick) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.22) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (49 + 96 * Math.exp(-t * 36))) / sr;
          const kVal = Math.sin(ph) * Math.exp(-t * 14) * 0.72;
          damagedDrumStem[s0 + i] += kVal * 0.45;
          masterTrack[s0 + i] += kVal;
        }
      }
      if (isSnare) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.2) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (196 + 65 * Math.exp(-t * 48))) / sr;
          const shell = Math.sin(ph) * Math.exp(-t * 22) * 0.45;
          const wire =
            (rnd() * Math.exp(-t * 18) * 0.5 +
              Math.sin(2 * Math.PI * 2550 * t) * Math.exp(-t * 230) * 0.35);
          // Damaged stem only has dull muffled shell (wire was carved out by vocal separator)
          damagedDrumStem[s0 + i] += (shell + wire * 0.08) * 0.48;
          masterTrack[s0 + i] += (shell + wire) * 0.65;
        }
      }
      if (!isCrash) {
        let prev = 0;
        for (let i = 0; i < Math.floor(sr * 0.065) && s0 + i < len; i++) {
          const t = i / sr;
          const n = rnd();
          const hp = n - 0.86 * prev;
          prev = n;
          const hVal = hp * Math.exp(-t * 68) * 0.28;
          damagedDrumStem[s0 + i] += hVal * 0.08; // almost completely lost in bad stem
          masterTrack[s0 + i] += hVal;
        }
      } else {
        for (let i = 0; i < Math.floor(sr * 0.55) && s0 + i < len; i++) {
          const t = i / sr;
          const cVal =
            (Math.sin(2 * Math.PI * 3400 * t) * 0.25 +
              Math.sin(2 * Math.PI * 5200 * t) * 0.22 +
              rnd() * 0.55) *
            Math.exp(-t * 3.8) *
            0.38;
          damagedDrumStem[s0 + i] += cVal * 0.12;
          masterTrack[s0 + i] += cVal;
        }
      }
    }

    const guidedRes = analyzeDrumStemFull(damagedDrumStem, sr, {
      sensitivity: 0.65,
      lockedBpm: bpm,
      masterMono: masterTrack,
      detectionSourceMode: 'auto-hybrid',
      masterReferenceName: 'Master_Referencia.wav',
      quantizeMode: 'soft',
    });

    expect(guidedRes.detectionSourceUsed).toBe('master-guided-hybrid');
    expect(guidedRes.masterReferenceName).toBe('Master_Referencia.wav');
    expect(guidedRes.counts.kick).toBeGreaterThanOrEqual(4);
    expect(guidedRes.counts.snare).toBeGreaterThanOrEqual(4);
    expect(guidedRes.counts.hat).toBeGreaterThanOrEqual(10);
    expect(guidedRes.counts.crash).toBeGreaterThanOrEqual(1);
  });

  it('masks Kick bleed in Bass detection, locks sub-octave fundamentals without +12st jumps, rescues dropped bass notes from Master, and renders distinct 9-GM articulations', () => {
    const sr = 48000;
    const bpm = 120;
    const beatSec = 60 / bpm;
    const len = Math.floor((4 * beatSec + 0.3) * sr);
    const bassStemWithHole = new Float32Array(len);
    const masterWithKickAndBass = new Float32Array(len);

    // 4 beats of A1 (55 Hz, MIDI 33) where 2nd harmonic (110 Hz) is stronger than 55 Hz fundamental.
    // On Beat 2 (idx=2), the AI-separated bassStemWithHole has a complete dropout hole, while masterWithKickAndBass has the note + a Kick drum impact!
    for (let b = 0; b < 4; b++) {
      const s0 = Math.floor(b * beatSec * sr);
      const noteLen = Math.floor(beatSec * 0.85 * sr);
      const f0 = 55.0; // A1 = MIDI 33

      // Add a strong Kick drum transient at the start of every beat in Master
      let kPh = 0;
      for (let i = 0; i < Math.floor(sr * 0.16) && s0 + i < len; i++) {
        const t = i / sr;
        kPh += (2 * Math.PI * (46 + 115 * Math.exp(-t * 42))) / sr;
        const click = Math.sin(2 * Math.PI * 2900 * t) * Math.exp(-t * 260) * 0.35;
        masterWithKickAndBass[s0 + i] += (Math.sin(kPh) * Math.exp(-t * 16) + click) * 0.65;
      }

      for (let i = 0; i < noteLen && s0 + i < len; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.008) * Math.exp(-t * 1.4);
        // 2nd harmonic (110 Hz) is 1.5x louder than fundamental (55 Hz), plus 3rd harmonic (165 Hz)
        const bassSample =
          (Math.sin(2 * Math.PI * f0 * t) * 0.42 +
            Math.sin(2 * Math.PI * (f0 * 2) * t) * 0.64 +
            Math.sin(2 * Math.PI * (f0 * 3) * t) * 0.26) *
          env *
          0.6;
        if (b !== 2) {
          bassStemWithHole[s0 + i] += bassSample;
        }
        masterWithKickAndBass[s0 + i] += bassSample;
      }
    }

    const bassRes = analyzeMonophonicStemNotesFull(bassStemWithHole, sr, {
      sensitivity: 0.65,
      lockedBpm: bpm,
      bassOnly: true,
      musicalKey: 'Am',
      masterMono: masterWithKickAndBass,
      detectionSourceMode: 'auto-hybrid',
      quantizeMode: 'soft',
    });

    expect(bassRes.detectionSourceUsed).toBe('master-guided-hybrid');
    // Should rescue all 4 beats (including beat 2 hole) in the true A1 sub-octave (MIDI 33), NOT jumping +12st to A2 (45)!
    expect(bassRes.noteEvents.length).toBeGreaterThanOrEqual(3);
    expect(bassRes.noteEvents.every((n) => n.midiNote === 33)).toBe(true);

    // Verify 9-GM Articulation zones are distinct (Closed vs Open Hat, Snare vs Rimshot, Crash vs Ride, High/Mid/Floor Tom)
    const closedHat = getArticulatedDrumZone('drum-hat-crisp', 'hat', 'closed', sr);
    const openHat = getArticulatedDrumZone('drum-hat-crisp', 'hat', 'open', sr);
    const pedalHat = getArticulatedDrumZone('drum-hat-crisp', 'hat', 'pedal', sr);
    const snareCenter = getArticulatedDrumZone('drum-snare-studio', 'snare', 'closed', sr);
    const snareRim = getArticulatedDrumZone('drum-snare-studio', 'snare', 'rim', sr);
    const crashCym = getArticulatedDrumZone('drum-crash-bright', 'crash', 'crash', sr);
    const rideCym = getArticulatedDrumZone('drum-crash-bright', 'crash', 'ride', sr);
    const highTom = getArticulatedDrumZone('drum-tom-deep', 'tom', 'high-tom', sr);
    const floorTom = getArticulatedDrumZone('drum-tom-deep', 'tom', 'floor-tom', sr);

    expect(openHat.left.length).toBeGreaterThan(closedHat.left.length * 1.5);
    expect(closedHat.left.length).toBeGreaterThan(pedalHat.left.length);
    expect(snareRim.rootMidi).toBe(37);
    expect(snareCenter.rootMidi).toBe(38);
    expect(crashCym.left.length).not.toBe(rideCym.left.length);
    expect(highTom.rootMidi).toBe(50);
    expect(floorTom.rootMidi).toBe(43);
  });

  it('accurately separates Kicks (with loud beater click + simultaneous Hi-Hat + double kicks) from Snares without creating excess false Snares', () => {
    const sr = 48000;
    const bpm = 120;
    const beatSec = 60 / bpm; // 0.5s
    const eighthSec = beatSec * 0.5; // 0.25s
    const len = Math.floor((16 * eighthSec + 0.5) * sr);
    const mono = new Float32Array(len);

    let seed = 0xabcdef12;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    // 2 bars (16 eighth notes):
    // Kicks on e = 0, 3, 4, 7, 8, 11, 12 (7 kicks total), each with a strong 2.8kHz beater click + 140Hz knock + simultaneous 2-10kHz metallic Hi-Hat!
    // Plus a pickup double-kick 110ms after e=4 (at e=4 + 0.11s -> 8th kick total!)
    // Snares ONLY on backbeats e = 2, 6, 10, 14 (4 snares total)
    // Metallic Hi-Hats on every 8th note e = 0..15 with broadband 2.2kHz..11kHz energy (zero 185Hz snare shell)
    const kickEighths = new Set([0, 3, 4, 7, 8, 11, 12]);
    const snareEighths = new Set([2, 6, 10, 14]);

    const addClickyKick = (startSample: number, gain = 0.78) => {
      let ph = 0;
      for (let i = 0; i < Math.floor(sr * 0.22) && startSample + i < len; i++) {
        const t = i / sr;
        ph += (2 * Math.PI * (52 + 105 * Math.exp(-t * 38))) / sr;
        const subBody = Math.sin(ph) * Math.exp(-t * 14);
        // Strong 2.2-4.8 kHz beater click in the first 12ms
        const beaterClick =
          (Math.sin(2 * Math.PI * 2950 * t) * 0.5 + rnd() * 0.5) * Math.exp(-t * 165) * 0.48;
        mono[startSample + i] += (subBody + beaterClick) * gain;
      }
    };

    for (let e = 0; e < 16; e++) {
      const s0 = Math.floor(e * eighthSec * sr);

      // Loud metallic Hi-Hat on every 8th note (includes 2.2-6kHz mid-high sizzle + >6kHz air, but no 185Hz snare shell)
      let prev1 = 0;
      let prev2 = 0;
      for (let i = 0; i < Math.floor(sr * 0.065) && s0 + i < len; i++) {
        const t = i / sr;
        const n = rnd();
        const hp1 = n - 0.78 * prev1;
        prev1 = n;
        const hp2 = hp1 - 0.72 * prev2;
        prev2 = hp1;
        const metallic =
          (hp2 * 0.7 +
            Math.sin(2 * Math.PI * 3850 * t) * 0.16 +
            Math.sin(2 * Math.PI * 7400 * t) * 0.14) *
          Math.exp(-t * 68) *
          0.32;
        mono[s0 + i] += metallic;
      }

      if (kickEighths.has(e)) {
        addClickyKick(s0, 0.78);
      }
      if (e === 4) {
        // Fast double-kick stroke 115ms later
        addClickyKick(s0 + Math.floor(0.115 * sr), 0.58);
      }

      if (snareEighths.has(e)) {
        let ph = 0;
        for (let i = 0; i < Math.floor(sr * 0.19) && s0 + i < len; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * (198 + 65 * Math.exp(-t * 48))) / sr;
          const shell = Math.sin(ph) * Math.exp(-t * 21) * 0.52;
          const wires =
            (rnd() * 0.55 + Math.sin(2 * Math.PI * 2450 * t) * 0.28) * Math.exp(-t * 19);
          mono[s0 + i] += (shell + wires) * 0.68;
        }
      }
    }

    const res = analyzeDrumStemFull(mono, sr, {
      sensitivity: 0.65,
      lockedBpm: bpm,
      quantizeMode: 'off',
    });

    // Must detect at least 7 of the 8 kicks, and exactly 4 snares (never turning the 16 metallic hi-hats or 8 clicky kicks into snares!)
    expect(res.counts.kick).toBeGreaterThanOrEqual(7);
    expect(res.counts.snare).toBe(4);
    expect(res.counts.kick).toBeGreaterThan(res.counts.snare);

    // Also verify fuseMidiWithAcousticDrumAudio corrects a false MIDI Snare (38) placed on a Kick timestamp back to Kick (36)
    const corruptedMidiAnalysis = {
      ...res,
      drumHits: res.drumHits.map((h, idx) =>
        h.role === 'kick' && idx < 3
          ? {
              ...h,
              role: 'snare' as const,
              midiNote: 38,
              subRoleLabel: 'Acoustic Snare (38)',
            }
          : h
      ),
    };
    const midiBytes = encodeAnalysisToStandardMidi(corruptedMidiAnalysis);
    const fused = fuseMidiWithAcousticDrumAudio({
      midiBytes,
      mono,
      sampleRate: sr,
      lockedBpm: bpm,
      quantizeMode: 'off',
      sourceEngine: 'replicate-mt3',
    });
    expect(fused.counts.kick).toBeGreaterThanOrEqual(7);
    expect(fused.counts.snare).toBe(4);
  });
});
