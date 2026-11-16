import {
  analyzeDrumStemFull,
  analyzeMonophonicStemNotesFull,
  analyzePolyphonicStemNotesFull,
} from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/sampler/engine/FullStemAnalyzer';
import {
  getPresetZones,
  prepareCustomReplacementSample,
} from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/sampler/engine/StudioSampleBank';
import { renderFullStemReplacement } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/sampler/engine/StemReplacerEngine';
import {
  linearToDbTp,
  measureTruePeakLinear4x,
} from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/dsp-core/TruePeakDetector';
import { encodeBufferToWav24WithMetadata } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/sampler/engine/SampleExport';

async function runTests() {
  const sr = 48000;
  const results: Record<string, unknown> = {};
  const checks: Record<string, boolean> = {};

  // =========================================================================
  // TEST 1: Full-Track Drum Stem (56 hits over 15s -> proves no 32-slice cap)
  // =========================================================================
  {
    const bpm = 120;
    const eighth = 60 / bpm / 2; // 0.25s
    const numHits = 56;
    const dur = 15.0;
    const len = Math.floor(sr * dur);
    const mono = new Float32Array(len);
    const L = new Float32Array(len);
    const R = new Float32Array(len);

    let seed = 0x123456;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    for (let idx = 0; idx < numHits; idx++) {
      const tSec = 0.2 + idx * eighth;
      const start = Math.floor(tSec * sr);
      const role: 'kick' | 'snare' | 'hat' =
        idx % 4 === 0 ? 'kick' : idx % 4 === 2 ? 'snare' : 'hat';

      for (let i = 0; i < Math.floor(sr * 0.16) && start + i < len; i++) {
        const t = i / sr;
        let v = 0;
        if (role === 'kick') {
          v = Math.sin(2 * Math.PI * (48 + 95 * Math.exp(-t * 36)) * t) * Math.exp(-t * 14) * 0.72;
        } else if (role === 'snare') {
          v = (rnd() * 0.45 + Math.sin(2 * Math.PI * 195 * t) * 0.4) * Math.exp(-t * 22) * 0.65;
        } else {
          v = rnd() * Math.exp(-t * 60) * 0.35;
          if (i > 0) v = v - (mono[start + i - 1] * 0.5);
        }
        mono[start + i] += v;
        L[start + i] += v;
        R[start + i] += v;
      }
    }

    const drumAnalysis = analyzeDrumStemFull(mono, sr, { sensitivity: 0.65, minIntervalMs: 80 });
    const origBuf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    origBuf.copyToChannel(L, 0);
    origBuf.copyToChannel(R, 1);

    const replacedDrum = renderFullStemReplacement({
      originalBuffer: origBuf,
      analysis: drumAnalysis,
      drumSlots: {
        kick: { roleOrTarget: 'kick', enabled: true, sourceType: 'preset', presetId: 'drum-kick-punch', gainDb: 0, pitchSemis: 0 },
        snare: { roleOrTarget: 'snare', enabled: true, sourceType: 'preset', presetId: 'drum-snare-studio', gainDb: 0, pitchSemis: 0 },
        hat: { roleOrTarget: 'hat', enabled: true, sourceType: 'preset', presetId: 'drum-hat-crisp', gainDb: -2, pitchSemis: 0 },
        tom: { roleOrTarget: 'tom', enabled: true, sourceType: 'preset', presetId: 'drum-tom-deep', gainDb: 0, pitchSemis: 0 },
      },
      melodicSlot: { roleOrTarget: 'melodic', enabled: true, sourceType: 'preset', presetId: 'inst-piano-grand', gainDb: 0, pitchSemis: 0 },
      mix: { replacementPct: 100, originalPct: 0, duckOriginalTransients: true, roundRobinHumanize: true, sustainScale: 1, brightnessPct: 0 },
    });

    const tpLin = measureTruePeakLinear4x(replacedDrum.getChannelData(0), replacedDrum.getChannelData(1));
    const tpDb = Number(linearToDbTp(tpLin).toFixed(2));
    const wavBlob = await encodeBufferToWav24WithMetadata(replacedDrum, { rootMidiNote: 36 });

    checks.T1_drums_beyond_32_limit = drumAnalysis.counts.total >= 50;
    checks.T1_drums_bpm_accurate = Math.abs(drumAnalysis.bpm - 120) <= 2;
    checks.T1_drums_exact_length = replacedDrum.length === origBuf.length;
    checks.T1_drums_true_peak_safe = tpDb <= -0.8;
    checks.T1_drums_wav_export_valid = wavBlob.size > 44 && wavBlob.type === 'audio/wav';

    results.test1_drums = {
      expectedHits: numHits,
      detectedTotal: drumAnalysis.counts.total,
      counts: drumAnalysis.counts,
      detectedBpm: drumAnalysis.bpm,
      exactSampleLengthMatch: replacedDrum.length === origBuf.length,
      truePeakDbTp: tpDb,
      wavSize: wavBlob.size,
    };
  }

  // =========================================================================
  // TEST 2: Monophonic Bass Stem Note Detection & Pitch-Following Replace
  // =========================================================================
  {
    const targetNotes = [33, 36, 38, 40, 43]; // A1, C2, D2, E2, G2
    const noteDur = 0.7;
    const dur = targetNotes.length * noteDur + 0.5;
    const len = Math.floor(sr * dur);
    const mono = new Float32Array(len);
    const L = new Float32Array(len);
    const R = new Float32Array(len);

    targetNotes.forEach((midi, idx) => {
      const start = Math.floor((0.15 + idx * noteDur) * sr);
      const nLen = Math.floor(noteDur * 0.85 * sr);
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      for (let i = 0; i < nLen && start + i < len; i++) {
        const t = i / sr;
        const env = Math.min(1, i / (sr * 0.008)) * Math.exp(-t * 1.8);
        const v = (Math.sin(2 * Math.PI * f0 * t) * 0.75 + 0.25 * Math.sin(2 * Math.PI * f0 * 2 * t)) * env * 0.6;
        mono[start + i] += v;
        L[start + i] += v;
        R[start + i] += v;
      }
    });

    const bassAnalysis = analyzeMonophonicStemNotesFull(mono, sr, { sensitivity: 0.62 });
    const detectedMidis = bassAnalysis.noteEvents.map((n) => n.midiNote);
    const matched = targetNotes.filter((m) => detectedMidis.includes(m));

    const origBuf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    origBuf.copyToChannel(L, 0);
    origBuf.copyToChannel(R, 1);

    const replacedBass = renderFullStemReplacement({
      originalBuffer: origBuf,
      analysis: bassAnalysis,
      drumSlots: {
        kick: { roleOrTarget: 'kick', enabled: false, sourceType: 'preset', presetId: 'drum-kick-punch', gainDb: 0, pitchSemis: 0 },
        snare: { roleOrTarget: 'snare', enabled: false, sourceType: 'preset', presetId: 'drum-snare-studio', gainDb: 0, pitchSemis: 0 },
        hat: { roleOrTarget: 'hat', enabled: false, sourceType: 'preset', presetId: 'drum-hat-crisp', gainDb: 0, pitchSemis: 0 },
        tom: { roleOrTarget: 'tom', enabled: false, sourceType: 'preset', presetId: 'drum-tom-deep', gainDb: 0, pitchSemis: 0 },
      },
      melodicSlot: { roleOrTarget: 'melodic', enabled: true, sourceType: 'preset', presetId: 'inst-bass-finger', gainDb: 0, pitchSemis: 0 },
      mix: { replacementPct: 100, originalPct: 0, duckOriginalTransients: false, roundRobinHumanize: false, sustainScale: 1.0, brightnessPct: 0 },
    });

    checks.T2_bass_all_notes_found = matched.length === targetNotes.length;
    checks.T2_bass_exact_length = replacedBass.length === origBuf.length;

    results.test2_bass = {
      targetNotes,
      detectedMidis,
      matchedCount: matched.length,
      eventsCount: bassAnalysis.noteEvents.length,
      exactSampleLengthMatch: replacedBass.length === origBuf.length,
    };
  }

  // =========================================================================
  // TEST 3: Polyphonic Piano/Guitar Chords + Custom Recorded Sample w/ Dead Air Trim
  // =========================================================================
  {
    const chords = [
      [45, 57, 60, 64], // Am
      [41, 53, 57, 60], // F
      [48, 60, 64, 67], // C
      [43, 55, 59, 62], // G
    ];
    const chordDur = 1.4;
    const dur = chords.length * chordDur + 0.4;
    const len = Math.floor(sr * dur);
    const mono = new Float32Array(len);
    const L = new Float32Array(len);
    const R = new Float32Array(len);

    chords.forEach((notes, idx) => {
      const start = Math.floor((0.15 + idx * chordDur) * sr);
      const cLen = Math.floor(chordDur * 0.9 * sr);
      notes.forEach((midi) => {
        const f0 = 440 * Math.pow(2, (midi - 69) / 12);
        for (let i = 0; i < cLen && start + i < len; i++) {
          const t = i / sr;
          const env = Math.min(1, i / (sr * 0.008)) * Math.exp(-t * 1.4);
          const v =
            (Math.sin(2 * Math.PI * f0 * t) +
              0.42 * Math.sin(2 * Math.PI * f0 * 2 * t) +
              0.2 * Math.sin(2 * Math.PI * f0 * 3 * t)) *
            env *
            0.22;
          mono[start + i] += v;
          L[start + i] += v;
          R[start + i] += v;
        }
      });
    });

    const polyAnalysis = analyzePolyphonicStemNotesFull(mono, sr, {
      sensitivity: 0.65,
      maxPolyphony: 5,
    });

    let totalExpected = 0;
    let totalMatched = 0;
    chords.forEach((notes, idx) => {
      const wStart = 0.15 + idx * chordDur - 0.12;
      const wEnd = 0.15 + (idx + 1) * chordDur - 0.12;
      const foundInChord = new Set(
        polyAnalysis.noteEvents
          .filter((ev) => ev.startSec >= wStart && ev.startSec < wEnd)
          .map((ev) => ev.midiNote)
      );
      totalExpected += notes.length;
      for (const n of notes) {
        if (foundInChord.has(n)) totalMatched++;
      }
    });

    // Simulate a custom microphone-recorded sample with 220ms dead leading silence at G3 (MIDI 55 = 196 Hz)
    const recLen = Math.floor(sr * 1.2);
    const recBuf = new AudioBuffer({ length: recLen, numberOfChannels: 2, sampleRate: sr });
    const recL = recBuf.getChannelData(0);
    const recR = recBuf.getChannelData(1);
    const deadSamples = Math.floor(sr * 0.22);
    const g3Freq = 440 * Math.pow(2, (55 - 69) / 12);
    for (let i = deadSamples; i < recLen; i++) {
      const t = (i - deadSamples) / sr;
      const env = Math.min(1, (i - deadSamples) / (sr * 0.004)) * Math.exp(-t * 2.1);
      const s = (Math.sin(2 * Math.PI * g3Freq * t) + 0.35 * Math.sin(2 * Math.PI * g3Freq * 2 * t)) * env * 0.65;
      recL[i] = s;
      recR[i] = s;
    }

    const prepCustom = prepareCustomReplacementSample(recBuf);

    const origBuf = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    origBuf.copyToChannel(L, 0);
    origBuf.copyToChannel(R, 1);

    const replacedGuitar = renderFullStemReplacement({
      originalBuffer: origBuf,
      analysis: polyAnalysis,
      drumSlots: {
        kick: { roleOrTarget: 'kick', enabled: false, sourceType: 'preset', presetId: 'drum-kick-punch', gainDb: 0, pitchSemis: 0 },
        snare: { roleOrTarget: 'snare', enabled: false, sourceType: 'preset', presetId: 'drum-snare-studio', gainDb: 0, pitchSemis: 0 },
        hat: { roleOrTarget: 'hat', enabled: false, sourceType: 'preset', presetId: 'drum-hat-crisp', gainDb: 0, pitchSemis: 0 },
        tom: { roleOrTarget: 'tom', enabled: false, sourceType: 'preset', presetId: 'drum-tom-deep', gainDb: 0, pitchSemis: 0 },
      },
      melodicSlot: {
        roleOrTarget: 'melodic',
        enabled: true,
        sourceType: 'recorded',
        presetId: 'inst-guitar-acoustic',
        customName: 'Mic_G3',
        customBuffer: prepCustom.trimmedBuffer,
        customRootMidi: prepCustom.detectedRootMidi,
        customPeakOffsetSec: prepCustom.peakOffsetSec,
        gainDb: 0,
        pitchSemis: 0,
      },
      mix: { replacementPct: 100, originalPct: 0, duckOriginalTransients: false, roundRobinHumanize: false, sustainScale: 1.0, brightnessPct: 0 },
    });

    const tpPoly = Number(linearToDbTp(measureTruePeakLinear4x(replacedGuitar.getChannelData(0), replacedGuitar.getChannelData(1))).toFixed(2));
    const guitarPresetZones = getPresetZones('inst-guitar-acoustic', sr);

    checks.T3_poly_chord_recall_ge_75pct = totalMatched / totalExpected >= 0.75;
    checks.T3_custom_silence_trimmed = prepCustom.trimmedBuffer.duration < recBuf.duration - 0.18;
    checks.T3_custom_yin_root_exact = prepCustom.detectedRootMidi === 55;
    checks.T3_poly_exact_length = replacedGuitar.length === origBuf.length;
    checks.T3_poly_true_peak_safe = tpPoly <= -0.8;
    checks.T3_guitar_multizone_ready = guitarPresetZones.length === 4;

    results.test3_polyphonic = {
      totalExpectedNotes: totalExpected,
      totalMatchedNotes: totalMatched,
      recallPct: Math.round((totalMatched / totalExpected) * 100),
      detectedEvents: polyAnalysis.noteEvents.slice(0, 20).map((e) => `${e.noteName}@${e.startSec.toFixed(2)}s`),
      customRawDur: Number(recBuf.duration.toFixed(3)),
      customTrimmedDur: Number(prepCustom.trimmedBuffer.duration.toFixed(3)),
      customDetectedRoot: `${prepCustom.detectedNoteName} (${prepCustom.detectedRootMidi})`,
      exactSampleLengthMatch: replacedGuitar.length === origBuf.length,
      truePeakDbTp: tpPoly,
    };
  }

  const allPassed = Object.values(checks).every(Boolean);
  await fetch('/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allPassed, checks, results }, null, 2),
  });
}

void runTests();
