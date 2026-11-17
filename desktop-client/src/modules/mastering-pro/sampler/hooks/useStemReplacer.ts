import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  encodeBufferToMp3,
  encodeBufferToWav24WithMetadata,
  sanitizeDownloadBaseName,
  triggerFileDownload,
} from '../engine/SampleExport';
import {
  analyzeBassProgressionFull,
  analyzeDrumStemFull,
  analyzeMonophonicStemNotesFull,
  analyzePolyphonicStemNotesFull,
  inferStemModeFromName,
} from '../engine/FullStemAnalyzer';
import { buildMonoSliceFromBuffer } from '../engine/Slicer';
import { renderFullStemReplacement } from '../engine/StemReplacerEngine';
import {
  deleteCustomReplacementSampleFromIdb,
  loadAllCustomReplacementSamplesFromIdb,
  saveCustomReplacementSampleToIdb,
} from '../engine/KitStorage';
import {
  getPresetAuditionBuffer,
  inferReplacementCategoryFromName,
  isBassPresetId,
  prepareCustomReplacementSample,
} from '../engine/StudioSampleBank';
import {
  addSampleToSongFolder,
  fetchSongsWithStemsForSampler,
} from '../services/supabaseSamplerService';
import type {
  CustomReplacementSampleItem,
  CustomSampleCategory,
  DefaultInstrumentId,
  DrumPieceRole,
  FullStemAnalysisResult,
  ReplacementSlotConfig,
  SongStemEntry,
  SongWithStemsFolder,
  StemAnalysisMode,
  StemReplaceMixOptions,
} from '../types/sampler.types';
import SamplerAnalysisWorker from '../workers/samplerAnalysis.worker.ts?worker';
import type { WaveformPyramid } from '../workers/waveformPeaks.worker';
import WaveformPeaksWorker from '../workers/waveformPeaks.worker.ts?worker';

function createDefaultDrumSlots(): Record<DrumPieceRole, ReplacementSlotConfig> {
  return {
    kick: {
      roleOrTarget: 'kick',
      enabled: true,
      sourceType: 'preset',
      presetId: 'drum-kick-punch',
      gainDb: 0,
      pitchSemis: 0,
    },
    snare: {
      roleOrTarget: 'snare',
      enabled: true,
      sourceType: 'preset',
      presetId: 'drum-snare-studio',
      gainDb: 0,
      pitchSemis: 0,
    },
    hat: {
      roleOrTarget: 'hat',
      enabled: true,
      sourceType: 'preset',
      presetId: 'drum-hat-crisp',
      gainDb: -2,
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
  };
}

function createDefaultMelodicSlot(presetId: DefaultInstrumentId = 'inst-piano-grand'): ReplacementSlotConfig {
  return {
    roleOrTarget: 'melodic',
    enabled: true,
    sourceType: 'preset',
    presetId,
    gainDb: 0,
    pitchSemis: 0,
  };
}

function chooseDefaultMelodicPresetForName(stemName: string): DefaultInstrumentId {
  const n = (stemName || '').toLowerCase();
  if (n.includes('bass') || n.includes('bajo') || n.includes('sub')) {
    if (n.includes('808') || n.includes('sub')) return 'inst-bass-astra-sub';
    if (n.includes('moog') || n.includes('monark') || n.includes('analog')) return 'inst-bass-monark-sub';
    if (n.includes('juno') || n.includes('chorus')) return 'inst-bass-juno-chorus';
    if (n.includes('jupiter')) return 'inst-bass-jupiter-fat';
    if (n.includes('pad') || n.includes('90s')) return 'inst-bass-90s-pad';
    if (n.includes('wah')) return 'inst-bass-autowah';
    if (n.includes('synth') || n.includes('disco') || n.includes('funk')) return 'inst-bass-sh101-funk';
    return 'inst-bass-finger';
  }
  if (n.includes('guitar') || n.includes('guitarr') || n.includes('gtr')) return 'inst-guitar-acoustic';
  if (n.includes('rhodes') || n.includes('ep')) return 'inst-piano-rhodes';
  if (n.includes('synth') || n.includes('pad') || n.includes('string')) return 'inst-synth-warm';
  return 'inst-piano-grand';
}

export function useStemReplacer() {
  const [songs, setSongs] = useState<SongWithStemsFolder[]>([]);
  const [loadingSongs, setLoadingSongs] = useState<boolean>(false);
  const [selectedSongId, setSelectedSongId] = useState<string>('');
  const [selectedStemId, setSelectedStemId] = useState<string>('');

  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [replacedBuffer, setReplacedBuffer] = useState<AudioBuffer | null>(null);
  const [stemTitle, setStemTitle] = useState<string>('');
  const [waveformPyramid, setWaveformPyramid] = useState<WaveformPyramid | null>(null);

  const [stemMode, setStemMode] = useState<StemAnalysisMode>('drums');
  const [bassFocusMode, setBassFocusMode] = useState<boolean>(false);
  const [sensitivity, setSensitivity] = useState<number>(0.62);
  const [maxPolyphony, setMaxPolyphony] = useState<number>(5);
  const [analysis, setAnalysis] = useState<FullStemAnalysisResult | null>(null);
  const polyAutoWeightAppliedRef = useRef<boolean>(false);

  const [drumSlots, setDrumSlots] = useState<Record<DrumPieceRole, ReplacementSlotConfig>>(
    () => createDefaultDrumSlots()
  );
  const [melodicSlot, setMelodicSlot] = useState<ReplacementSlotConfig>(() =>
    createDefaultMelodicSlot('inst-piano-grand')
  );
  const [mixOptions, setMixOptions] = useState<StemReplaceMixOptions>({
    replacementPct: 100,
    originalPct: 0,
    duckOriginalTransients: true,
    roundRobinHumanize: true,
    sustainScale: 1.0,
    brightnessPct: 0,
  });

  const [customSamples, setCustomSamples] = useState<CustomReplacementSampleItem[]>([]);
  const [isLoadingStem, setIsLoadingStem] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [isExportingPc, setIsExportingPc] = useState<boolean>(false);
  const [isSavingCloud, setIsSavingCloud] = useState<boolean>(false);
  const [recordingTarget, setRecordingTarget] = useState<DrumPieceRole | 'melodic' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Seamless dual-source A/B playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [abMode, setAbMode] = useState<'original' | 'replaced'>('replaced');
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const origNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const repNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const origGainRef = useRef<GainNode | null>(null);
  const repGainRef = useRef<GainNode | null>(null);
  const playStartCtxRef = useRef<number>(0);
  const playOffsetRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);

  const ensureCtx = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctxRef.current = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
    }
    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  // Refresh song folders from Supabase
  const refreshSongs = useCallback(async () => {
    setLoadingSongs(true);
    try {
      const list = await fetchSongsWithStemsForSampler();
      setSongs(list);
      const savedSong = sessionStorage.getItem('tandu_active_song_id');
      if (savedSong && list.some((s) => s.id === savedSong)) {
        setSelectedSongId(savedSong);
      } else if (list.length > 0 && !selectedSongId) {
        const firstWithStems = list.find((s) => s.stems.length > 0) ?? list[0];
        setSelectedSongId(firstWithStems.id);
      }
    } finally {
      setLoadingSongs(false);
    }
  }, [selectedSongId]);

  useEffect(() => {
    void refreshSongs();
    let cancelled = false;
    void (async () => {
      try {
        if (typeof AudioContext === 'undefined') return;
        const ctx = ensureCtx();
        const saved = await loadAllCustomReplacementSamplesFromIdb(ctx);
        if (!cancelled && saved.length > 0) {
          setCustomSamples(saved);
        }
      } catch {
        // ignore if audio/IDB unavailable
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        origNodeRef.current?.stop();
        repNodeRef.current?.stop();
      } catch {
        // ignore
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        void ctxRef.current.close();
      }
    };
  }, []);

  const selectedSong = useMemo(
    () => songs.find((s) => s.id === selectedSongId) ?? null,
    [songs, selectedSongId]
  );

  // Stop playback helper
  const stopPlayback = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      if (origNodeRef.current) {
        origNodeRef.current.onended = null;
        origNodeRef.current.stop();
        origNodeRef.current.disconnect();
      }
      if (repNodeRef.current) {
        repNodeRef.current.onended = null;
        repNodeRef.current.stop();
        repNodeRef.current.disconnect();
      }
      origGainRef.current?.disconnect();
      repGainRef.current?.disconnect();
    } catch {
      // ignore
    }
    origNodeRef.current = null;
    repNodeRef.current = null;
    setIsPlaying(false);
  }, []);

  // Build waveform peaks off main thread when originalBuffer changes
  useEffect(() => {
    if (!originalBuffer) {
      setWaveformPyramid(null);
      return;
    }
    const ch0 = new Float32Array(originalBuffer.getChannelData(0));
    const ch1 =
      originalBuffer.numberOfChannels > 1
        ? new Float32Array(originalBuffer.getChannelData(1))
        : new Float32Array(ch0);
    let worker: Worker | null = null;
    try {
      worker = new WaveformPeaksWorker();
    } catch {
      worker = null;
    }
    if (!worker) return;
    const reqId = Date.now();
    worker.onmessage = (
      ev: MessageEvent<{ id: number; success: boolean; pyramid?: WaveformPyramid }>
    ) => {
      if (ev.data?.id === reqId && ev.data.success && ev.data.pyramid) {
        setWaveformPyramid(ev.data.pyramid);
      }
      worker?.terminate();
    };
    worker.postMessage(
      { id: reqId, left: ch0, right: ch1, sampleRate: originalBuffer.sampleRate },
      [ch0.buffer, ch1.buffer]
    );
    return () => worker?.terminate();
  }, [originalBuffer]);

  // Run full-track analysis (worker-backed so polyphonic 16384-pt FFT never blocks UI)
  const runAnalysis = useCallback(
    async (
      buf: AudioBuffer,
      mode: StemAnalysisMode,
      sens: number,
      poly: number,
      bpmHint?: number,
      bassFocus = bassFocusMode
    ) => {
      setIsAnalyzing(true);
      try {
        const mono = buildMonoSliceFromBuffer(buf, 0, buf.duration);
        const runSyncFallback = (): FullStemAnalysisResult => {
          if (mode === 'drums') {
            return analyzeDrumStemFull(mono, buf.sampleRate, { sensitivity: sens, bpmHint });
          }
          if (mode === 'polyphonic' && bassFocus) {
            return analyzeBassProgressionFull(mono, buf.sampleRate, {
              sensitivity: sens,
              maxPolyphony: poly,
              bpmHint,
            });
          }
          if (mode === 'monophonic') {
            return analyzeMonophonicStemNotesFull(mono, buf.sampleRate, {
              sensitivity: sens,
              bpmHint,
              bassOnly: bassFocus,
            });
          }
          return analyzePolyphonicStemNotesFull(mono, buf.sampleRate, {
            sensitivity: sens,
            maxPolyphony: poly,
            bpmHint,
          });
        };

        let result: FullStemAnalysisResult;

        if (typeof Worker !== 'undefined') {
          result = await new Promise<FullStemAnalysisResult>((resolve) => {
            let w: Worker | null = null;
            try {
              w = new SamplerAnalysisWorker();
            } catch {
              w = null;
            }
            if (!w) {
              resolve(runSyncFallback());
              return;
            }

            const reqId = Date.now() + Math.floor(Math.random() * 1000);
            const copy = new Float32Array(mono);
            w.onmessage = (
              ev: MessageEvent<{ id: number; success: boolean; result?: FullStemAnalysisResult }>
            ) => {
              if (ev.data?.id === reqId) {
                w?.terminate();
                if (ev.data.result) {
                  resolve(ev.data.result);
                } else {
                  resolve(runSyncFallback());
                }
              }
            };
            w.onerror = () => {
              w?.terminate();
              resolve(runSyncFallback());
            };
            w.postMessage(
              {
                id: reqId,
                kind: 'analyze-full-stem',
                sourceId: 'stem',
                mono: copy,
                sampleRate: buf.sampleRate,
                sensitivity: sens,
                stemMode: mode,
                bassFocus,
                bpmHint,
                maxPolyphony: poly,
              },
              [copy.buffer]
            );
          });
        } else {
          result = runSyncFallback();
        }

        setAnalysis(result);
        const rangeText = result.midiRange
          ? `${result.midiRange.minName} – ${result.midiRange.maxName}`
          : 'rango vacío';
        const summary =
          result.mode === 'drums'
            ? `Detectado: ${result.bpm} BPM · ${result.counts.total} golpes (${result.counts.kick} Kick · ${result.counts.snare} Snare · ${result.counts.hat} Hat · ${result.counts.tom} Tom)`
            : result.bassFocusApplied
            ? `Solo Graves (${result.bpm} BPM): ${result.counts.notes} notas de bajo (${rangeText}) siguiendo la progresión`
            : `Detectado: ${result.bpm} BPM · ${result.counts.notes} notas (${rangeText})`;
        setStatusMessage(summary);
      } finally {
        setIsAnalyzing(false);
      }
    },
    [bassFocusMode]
  );

  // Auto-render replaced buffer cleanly whenever analysis or replacement settings change
  useEffect(() => {
    if (!originalBuffer || !analysis) {
      setReplacedBuffer(null);
      return;
    }
    const timer = setTimeout(() => {
      setIsRendering(true);
      try {
        const rendered = renderFullStemReplacement({
          originalBuffer,
          analysis,
          drumSlots,
          melodicSlot,
          mix: mixOptions,
        });
        setReplacedBuffer(rendered);
      } finally {
        setIsRendering(false);
      }
    }, 140);
    return () => clearTimeout(timer);
  }, [originalBuffer, analysis, drumSlots, melodicSlot, mixOptions]);

  // Smooth real-time A/B gain crossfade while playing
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !origGainRef.current || !repGainRef.current) return;
    const now = ctx.currentTime;
    origGainRef.current.gain.setTargetAtTime(abMode === 'original' ? 1 : 0, now, 0.015);
    repGainRef.current.gain.setTargetAtTime(abMode === 'replaced' ? 1 : 0, now, 0.015);
  }, [abMode]);

  const startPlaybackAt = useCallback(
    (startSec = currentTimeSec) => {
      if (!originalBuffer) return;
      stopPlayback();
      const ctx = ensureCtx();
      const offset = Math.max(0, Math.min(originalBuffer.duration - 0.02, startSec));

      const oNode = ctx.createBufferSource();
      oNode.buffer = originalBuffer;
      const oGain = ctx.createGain();
      oGain.gain.value = abMode === 'original' ? 1 : 0;
      oNode.connect(oGain);
      oGain.connect(ctx.destination);

      const rNode = ctx.createBufferSource();
      rNode.buffer = replacedBuffer ?? originalBuffer;
      const rGain = ctx.createGain();
      rGain.gain.value = abMode === 'replaced' ? 1 : 0;
      rNode.connect(rGain);
      rGain.connect(ctx.destination);

      const t0 = ctx.currentTime + 0.02;
      playStartCtxRef.current = t0;
      playOffsetRef.current = offset;

      oNode.onended = () => {
        if (origNodeRef.current === oNode) {
          stopPlayback();
          setCurrentTimeSec(0);
        }
      };

      oNode.start(t0, offset);
      rNode.start(t0, offset);

      origNodeRef.current = oNode;
      repNodeRef.current = rNode;
      origGainRef.current = oGain;
      repGainRef.current = rGain;
      setIsPlaying(true);

      const updatePlayhead = () => {
        const elapsed = Math.max(0, ctx.currentTime - playStartCtxRef.current);
        const pos = Math.min(originalBuffer.duration, playOffsetRef.current + elapsed);
        setCurrentTimeSec(pos);
        if (pos < originalBuffer.duration - 0.01) {
          rafRef.current = requestAnimationFrame(updatePlayhead);
        }
      };
      rafRef.current = requestAnimationFrame(updatePlayhead);
    },
    [originalBuffer, replacedBuffer, abMode, currentTimeSec, ensureCtx, stopPlayback]
  );

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlaybackAt(currentTimeSec);
    }
  }, [isPlaying, stopPlayback, startPlaybackAt, currentTimeSec]);

  const seekToSec = useCallback(
    (sec: number) => {
      const clamped = originalBuffer
        ? Math.max(0, Math.min(originalBuffer.duration - 0.02, sec))
        : 0;
      setCurrentTimeSec(clamped);
      if (isPlaying) {
        startPlaybackAt(clamped);
      }
    },
    [originalBuffer, isPlaying, startPlaybackAt]
  );

  // Load 1 stem from Supabase song folder
  const loadSongStem = useCallback(
    async (stem: SongStemEntry, song?: SongWithStemsFolder) => {
      stopPlayback();
      setIsLoadingStem(true);
      setSelectedStemId(stem.id);
      setStemTitle(stem.name);
      try {
        const ctx = ensureCtx();
        const res = await fetch(stem.fileUrl);
        if (!res.ok) throw new Error(`No se pudo descargar el stem (${res.status})`);
        const arr = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr.slice(0));
        setOriginalBuffer(decoded);
        setCurrentTimeSec(0);

        const inferredMode = stem.inferredMode ?? inferStemModeFromName(stem.name);
        setStemMode(inferredMode);
        const chosenPreset = chooseDefaultMelodicPresetForName(stem.name);
        const nextFocus = inferredMode !== 'drums' && isBassPresetId(chosenPreset);
        setBassFocusMode(nextFocus);
        polyAutoWeightAppliedRef.current = false;
        if (inferredMode !== 'drums') {
          setMelodicSlot((prev) => ({
            ...prev,
            presetId: chosenPreset,
          }));
        }

        await runAnalysis(decoded, inferredMode, sensitivity, maxPolyphony, song?.bpm, nextFocus);
      } catch (err) {
        setStatusMessage(
          err instanceof Error ? err.message : 'Error cargando stem desde Supabase.'
        );
      } finally {
        setIsLoadingStem(false);
      }
    },
    [stopPlayback, ensureCtx, runAnalysis, sensitivity, maxPolyphony]
  );

  // Load local audio file directly as stem
  const loadLocalStemFile = useCallback(
    async (file: File) => {
      stopPlayback();
      setIsLoadingStem(true);
      try {
        const ctx = ensureCtx();
        const raw = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(raw.slice(0));
        setOriginalBuffer(decoded);
        setSelectedStemId('');
        setStemTitle(file.name.replace(/\.[^.]+$/, ''));
        setCurrentTimeSec(0);

        const inferredMode = inferStemModeFromName(file.name);
        setStemMode(inferredMode);
        const chosenPreset = chooseDefaultMelodicPresetForName(file.name);
        const nextFocus = inferredMode !== 'drums' && isBassPresetId(chosenPreset);
        setBassFocusMode(nextFocus);
        polyAutoWeightAppliedRef.current = false;
        if (inferredMode !== 'drums') {
          setMelodicSlot((prev) => ({
            ...prev,
            presetId: chosenPreset,
          }));
        }
        await runAnalysis(decoded, inferredMode, sensitivity, maxPolyphony, undefined, nextFocus);
      } catch (err) {
        setStatusMessage(
          err instanceof Error ? err.message : 'Error decodificando el stem.'
        );
      } finally {
        setIsLoadingStem(false);
      }
    },
    [stopPlayback, ensureCtx, runAnalysis, sensitivity, maxPolyphony]
  );

  // Load built-in realistic stem demos (Drums, Polyphonic Guitar/Piano Chords, Monophonic Bass)
  const loadDemoStem = useCallback(
    async (kind: StemAnalysisMode) => {
      stopPlayback();
      const ctx = ensureCtx();
      const sr = ctx.sampleRate;
      const bpm = 112;
      const beat = 60 / bpm;
      const dur = beat * 16; // 4 full bars cleanly aligned!
      const len = Math.floor(sr * dur);
      const buf = ctx.createBuffer(2, len, sr);
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);

      let seed = 0x99887766;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return (seed / 0xffffffff) * 2 - 1;
      };

      if (kind === 'drums') {
        const eighth = beat * 0.5;
        const totalEighths = 32;
        for (let e = 0; e < totalEighths; e++) {
          const hitTime = e * eighth;
          const start = Math.floor(hitTime * sr);
          const isKick = e % 4 === 0 || e % 8 === 6;
          const isSnare = e % 4 === 2;
          // Hat on every 8th
          for (let i = 0; i < Math.floor(sr * 0.08) && start + i < len; i++) {
            const t = i / sr;
            const hat = rnd() * Math.exp(-t * 68) * 0.16;
            L[start + i] += hat;
            R[start + i] += hat;
          }
          if (isKick) {
            for (let i = 0; i < Math.floor(sr * 0.22) && start + i < len; i++) {
              const t = i / sr;
              const v = Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-t * 34)) * t) * Math.exp(-t * 14) * 0.65;
              L[start + i] += v;
              R[start + i] += v;
            }
          }
          if (isSnare) {
            for (let i = 0; i < Math.floor(sr * 0.18) && start + i < len; i++) {
              const t = i / sr;
              const v = (rnd() * 0.42 + Math.sin(2 * Math.PI * 192 * t) * 0.35) * Math.exp(-t * 22) * 0.55;
              L[start + i] += v;
              R[start + i] += v;
            }
          }
        }
        setStemTitle('Demo Stem Batería 112 BPM');
      } else if (kind === 'monophonic') {
        // Bass progression: A1 (55Hz) -> F1 (43.65Hz) -> C2 (65.41Hz) -> G1 (49Hz)
        const bassSeq = [33, 33, 40, 33, 29, 29, 36, 29, 36, 36, 43, 36, 31, 31, 38, 31];
        const stepDur = beat;
        bassSeq.forEach((midi, idx) => {
          const start = Math.floor(idx * stepDur * sr);
          const noteLen = Math.floor(stepDur * 0.86 * sr);
          const f0 = 440 * Math.pow(2, (midi - 69) / 12);
          for (let i = 0; i < noteLen && start + i < len; i++) {
            const t = i / sr;
            const env = Math.min(1, i / (sr * 0.008)) * Math.exp(-t * 2.2);
            const s = (Math.sin(2 * Math.PI * f0 * t) * 0.72 + Math.sin(2 * Math.PI * f0 * 2 * t) * 0.28) * env * 0.55;
            L[start + i] += s;
            R[start + i] += s;
          }
        });
        setStemTitle('Demo Stem Bajo 112 BPM');
      } else {
        // Polyphonic 4-chord progression: Am -> F -> C -> G (piano/guitar triads!)
        const chords = [
          [45, 57, 60, 64], // Am
          [41, 53, 57, 60], // F
          [48, 60, 64, 67], // C
          [43, 55, 59, 62], // G
        ];
        const chordDur = beat * 4;
        chords.forEach((notes, cIdx) => {
          const baseStart = Math.floor(cIdx * chordDur * sr);
          const chordLen = Math.floor(chordDur * 0.92 * sr);
          notes.forEach((midi) => {
            const f0 = 440 * Math.pow(2, (midi - 69) / 12);
            for (let i = 0; i < chordLen && baseStart + i < len; i++) {
              const t = i / sr;
              const env = Math.min(1, i / (sr * 0.008)) * Math.exp(-t * 1.45);
              const sig =
                (Math.sin(2 * Math.PI * f0 * t) +
                  0.35 * Math.sin(2 * Math.PI * f0 * 2 * t) +
                  0.14 * Math.sin(2 * Math.PI * f0 * 3 * t)) *
                env *
                0.2;
              L[baseStart + i] += sig;
              R[baseStart + i] += sig;
            }
          });
        });
        setStemTitle('Demo Stem Acordes Guitarra/Piano 112 BPM');
      }

      setOriginalBuffer(buf);
      setStemMode(kind);
      const nextFocus = kind === 'monophonic';
      setBassFocusMode(nextFocus);
      polyAutoWeightAppliedRef.current = false;
      setMixOptions((p) => ({ ...p, originalPct: 0, replacementPct: 100 }));
      if (kind === 'monophonic') {
        setMelodicSlot((p) => ({ ...p, presetId: 'inst-bass-finger' }));
      } else if (kind === 'polyphonic') {
        setMelodicSlot((p) => ({ ...p, presetId: 'inst-guitar-acoustic' }));
      }
      setCurrentTimeSec(0);
      await runAnalysis(buf, kind, sensitivity, maxPolyphony, bpm, nextFocus);
    },
    [stopPlayback, ensureCtx, runAnalysis, sensitivity, maxPolyphony]
  );

  const applyBassFocusChange = useCallback(
    (nextBassFocus: boolean, targetMode = stemMode, buf = originalBuffer) => {
      setBassFocusMode(nextBassFocus);
      if (targetMode === 'polyphonic') {
        if (nextBassFocus && mixOptions.originalPct === 0) {
          setMixOptions((p) => ({ ...p, originalPct: 88, replacementPct: 60 }));
          polyAutoWeightAppliedRef.current = true;
        } else if (!nextBassFocus && polyAutoWeightAppliedRef.current) {
          setMixOptions((p) => ({ ...p, originalPct: 0, replacementPct: 100 }));
          polyAutoWeightAppliedRef.current = false;
        }
      }
      if (buf && targetMode !== 'drums') {
        void runAnalysis(
          buf,
          targetMode,
          sensitivity,
          maxPolyphony,
          selectedSong?.bpm,
          nextBassFocus
        );
      }
    },
    [
      stemMode,
      originalBuffer,
      mixOptions.originalPct,
      runAnalysis,
      sensitivity,
      maxPolyphony,
      selectedSong?.bpm,
    ]
  );

  const toggleBassFocusMode = useCallback(() => {
    applyBassFocusChange(!bassFocusMode);
  }, [applyBassFocusChange, bassFocusMode]);

  // Switch analysis mode and re-scan
  const changeStemModeAndReanalyze = useCallback(
    async (nextMode: StemAnalysisMode) => {
      setStemMode(nextMode);
      let nextFocus = bassFocusMode;
      if (nextMode === 'drums') {
        nextFocus = false;
      } else if (nextMode === 'monophonic') {
        if (!isBassPresetId(melodicSlot.presetId)) {
          setMelodicSlot((prev) => ({ ...prev, presetId: 'inst-bass-finger' }));
        }
        nextFocus = true;
      } else {
        nextFocus = isBassPresetId(melodicSlot.presetId);
      }
      setBassFocusMode(nextFocus);
      if (originalBuffer) {
        await runAnalysis(
          originalBuffer,
          nextMode,
          sensitivity,
          maxPolyphony,
          selectedSong?.bpm,
          nextFocus
        );
      }
    },
    [
      bassFocusMode,
      melodicSlot.presetId,
      originalBuffer,
      runAnalysis,
      sensitivity,
      maxPolyphony,
      selectedSong?.bpm,
    ]
  );

  const reanalyzeCurrentStem = useCallback(async () => {
    if (!originalBuffer) return;
    await runAnalysis(
      originalBuffer,
      stemMode,
      sensitivity,
      maxPolyphony,
      selectedSong?.bpm,
      bassFocusMode
    );
  }, [
    originalBuffer,
    runAnalysis,
    stemMode,
    sensitivity,
    maxPolyphony,
    selectedSong?.bpm,
    bassFocusMode,
  ]);

  const updateDrumSlot = useCallback(
    (role: DrumPieceRole, patch: Partial<ReplacementSlotConfig>) => {
      setDrumSlots((prev) => ({
        ...prev,
        [role]: { ...prev[role], ...patch },
      }));
    },
    []
  );

  const updateMelodicSlot = useCallback(
    (patch: Partial<ReplacementSlotConfig>) => {
      const nextSlot = { ...melodicSlot, ...patch };
      setMelodicSlot(nextSlot);

      if (stemMode !== 'drums' && ('presetId' in patch || 'sourceType' in patch)) {
        let nextFocus = bassFocusMode;
        if (nextSlot.sourceType === 'preset') {
          nextFocus = isBassPresetId(nextSlot.presetId);
        } else if (nextSlot.customName) {
          if (/(bass|bajo|sub|808|sh101|monark|juno|jupiter)/i.test(nextSlot.customName)) {
            nextFocus = true;
          }
        }
        if (nextFocus !== bassFocusMode) {
          applyBassFocusChange(nextFocus);
        }
      }
    },
    [melodicSlot, stemMode, bassFocusMode, applyBassFocusChange]
  );

  // Register a decoded sample in the persistent Custom Sample Bank and optionally assign to a slot
  const registerCustomSample = useCallback(
    (
      rawBuffer: AudioBuffer,
      label: string,
      category: CustomSampleCategory,
      sourceType: 'file' | 'recorded' | 'pad' | 'cloud',
      assignTarget?: DrumPieceRole | 'melodic'
    ): CustomReplacementSampleItem => {
      const prepared = prepareCustomReplacementSample(rawBuffer, { normalize: true });
      const item: CustomReplacementSampleItem = {
        id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: label,
        category,
        sourceType,
        buffer: prepared.trimmedBuffer,
        durationSec: prepared.trimmedBuffer.duration,
        peakOffsetSec: prepared.peakOffsetSec,
        detectedRootMidi: prepared.detectedRootMidi,
        detectedNoteName: prepared.detectedNoteName,
        waveformPreview: prepared.waveformPreview,
        createdAt: new Date().toISOString(),
      };
      setCustomSamples((prev) => [item, ...prev]);
      void saveCustomReplacementSampleToIdb(item);

      if (assignTarget) {
        const slotSource: ReplacementSlotConfig['sourceType'] =
          sourceType === 'cloud' ? 'file' : sourceType;
        const patch: Partial<ReplacementSlotConfig> = {
          enabled: true,
          sourceType: slotSource,
          customSampleId: item.id,
          customName: item.name,
          customBuffer: item.buffer,
          customRootMidi: item.detectedRootMidi,
          customPeakOffsetSec: item.peakOffsetSec,
          normalizeCustom: true,
        };
        if (assignTarget === 'melodic') {
          setMelodicSlot((prev) => ({ ...prev, ...patch }));
        } else {
          setDrumSlots((prev) => ({
            ...prev,
            [assignTarget]: { ...prev[assignTarget], ...patch },
          }));
        }
      }
      return item;
    },
    []
  );

  // Apply custom decoded sample buffer (recorded, uploaded, pad, or cropped hit)
  const applyCustomBufferToSlot = useCallback(
    (
      target: DrumPieceRole | 'melodic',
      rawBuffer: AudioBuffer,
      label: string,
      sourceType: 'recorded' | 'file' | 'pad' | 'stem-crop'
    ) => {
      const bankSource = sourceType === 'stem-crop' ? 'file' : sourceType;
      const item = registerCustomSample(rawBuffer, label, target, bankSource, target);
      if (target === 'melodic') {
        setStatusMessage(
          `Muestra "${item.name}" guardada en tu Banco y cargada para reemplazo tonal (Root YIN: ${item.detectedNoteName}).`
        );
      } else {
        setStatusMessage(
          `Muestra "${item.name}" guardada en tu Banco y asignada a ${target.toUpperCase()} (pico alineado a ${(
            item.peakOffsetSec * 1000
          ).toFixed(1)} ms).`
        );
      }
    },
    [registerCustomSample]
  );

  const loadCustomFileForSlot = useCallback(
    async (target: DrumPieceRole | 'melodic', file: File) => {
      try {
        const ctx = ensureCtx();
        const raw = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(raw.slice(0));
        applyCustomBufferToSlot(target, decoded, file.name, 'file');
      } catch (err) {
        setStatusMessage(
          err instanceof Error
            ? `No se pudo cargar "${file.name}": ${err.message}`
            : `No se pudo decodificar "${file.name}".`
        );
      }
    },
    [ensureCtx, applyCustomBufferToSlot]
  );

  const uploadCustomReplacementFiles = useCallback(
    async (files: FileList | File[], preferredTarget: CustomSampleCategory | 'auto' = 'auto') => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const ctx = ensureCtx();
      let loadedCount = 0;
      const assignedLabels: string[] = [];

      for (const file of list) {
        try {
          const raw = await file.arrayBuffer();
          const decoded = await ctx.decodeAudioData(raw.slice(0));
          const category: CustomSampleCategory =
            preferredTarget === 'auto'
              ? inferReplacementCategoryFromName(file.name)
              : preferredTarget;
          const assignTarget: DrumPieceRole | 'melodic' | undefined =
            preferredTarget !== 'auto'
              ? preferredTarget
              : stemMode === 'drums' && category !== 'melodic'
              ? category
              : stemMode !== 'drums' && category === 'melodic'
              ? 'melodic'
              : undefined;

          const item = registerCustomSample(decoded, file.name, category, 'file', assignTarget);
          loadedCount++;
          if (assignTarget) assignedLabels.push(`${item.name} → ${assignTarget.toUpperCase()}`);
        } catch {
          // continue loading remaining valid files
        }
      }

      if (loadedCount === 0) {
        setStatusMessage('No se pudo decodificar ninguno de los archivos de audio seleccionados.');
      } else if (assignedLabels.length > 0) {
        setStatusMessage(
          `${loadedCount} audio(s) propio(s) añadido(s) al Banco (${assignedLabels.join(' · ')}).`
        );
      } else {
        setStatusMessage(
          `${loadedCount} audio(s) propio(s) añadido(s) a tu Banco de Muestras Propias.`
        );
      }
    },
    [ensureCtx, registerCustomSample, stemMode]
  );

  const importCustomSampleFromUrl = useCallback(
    async (url: string, name: string, target: CustomSampleCategory) => {
      try {
        const ctx = ensureCtx();
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(raw.slice(0));
        const item = registerCustomSample(decoded, name, target, 'cloud', target);
        setStatusMessage(
          `Muestra "${item.name}" importada desde Canciones y asignada a ${target.toUpperCase()}.`
        );
      } catch (err) {
        setStatusMessage(
          err instanceof Error
            ? `Error importando "${name}": ${err.message}`
            : `Error importando "${name}".`
        );
      }
    },
    [ensureCtx, registerCustomSample]
  );

  const assignCustomSampleToSlot = useCallback(
    (sampleId: string, target: DrumPieceRole | 'melodic') => {
      const item = customSamples.find((s) => s.id === sampleId);
      if (!item) return;
      const slotSource: ReplacementSlotConfig['sourceType'] =
        item.sourceType === 'cloud' ? 'file' : item.sourceType;
      const patch: Partial<ReplacementSlotConfig> = {
        enabled: true,
        sourceType: slotSource,
        customSampleId: item.id,
        customName: item.name,
        customBuffer: item.buffer,
        customRootMidi: item.detectedRootMidi,
        customPeakOffsetSec: item.peakOffsetSec,
        normalizeCustom: true,
      };
      if (target === 'melodic') {
        setMelodicSlot((prev) => ({ ...prev, ...patch }));
        setStatusMessage(
          `Muestra propia "${item.name}" asignada al Timbre Tonal (Root ${item.detectedNoteName}).`
        );
      } else {
        setDrumSlots((prev) => ({
          ...prev,
          [target]: { ...prev[target], ...patch },
        }));
        setStatusMessage(
          `Muestra propia "${item.name}" asignada a ${target.toUpperCase()}.`
        );
      }
    },
    [customSamples]
  );

  const auditionCustomSample = useCallback(
    (sampleId: string) => {
      const item = customSamples.find((s) => s.id === sampleId);
      if (!item) return;
      const ctx = ensureCtx();
      const src = ctx.createBufferSource();
      src.buffer = item.buffer;
      src.connect(ctx.destination);
      src.start();
    },
    [customSamples, ensureCtx]
  );

  const deleteCustomSample = useCallback((sampleId: string) => {
    setCustomSamples((prev) => prev.filter((s) => s.id !== sampleId));
    void deleteCustomReplacementSampleFromIdb(sampleId);
    setDrumSlots((prev) => {
      const next = { ...prev };
      (['kick', 'snare', 'hat', 'tom'] as DrumPieceRole[]).forEach((role) => {
        if (next[role].customSampleId === sampleId) {
          next[role] = {
            ...next[role],
            sourceType: 'preset',
            customSampleId: undefined,
            customName: undefined,
            customBuffer: undefined,
          };
        }
      });
      return next;
    });
    setMelodicSlot((prev) =>
      prev.customSampleId === sampleId
        ? {
            ...prev,
            sourceType: 'preset',
            customSampleId: undefined,
            customName: undefined,
            customBuffer: undefined,
          }
        : prev
    );
  }, []);

  const resetAllSlotsToPresets = useCallback(() => {
    setDrumSlots(createDefaultDrumSlots());
    setMelodicSlot((prev) => ({
      ...prev,
      sourceType: 'preset',
      customSampleId: undefined,
      customName: undefined,
      customBuffer: undefined,
      gainDb: 0,
      pitchSemis: 0,
    }));
    setStatusMessage('Piezas y timbre restablecidos a predeterminados de estudio.');
  }, []);

  // Microphone recording directly into a replacement slot!
  const toggleMicRecordingForSlot = useCallback(
    async (target: DrumPieceRole | 'melodic') => {
      if (recordingTarget) {
        const rec = mediaRecRef.current;
        const activeTarget = recordingTarget;
        if (!rec) {
          setRecordingTarget(null);
          return;
        }
        rec.onstop = async () => {
          try {
            const blob = new Blob(recChunksRef.current, {
              type: rec.mimeType || 'audio/webm',
            });
            mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
            mediaStreamRef.current = null;
            mediaRecRef.current = null;
            setRecordingTarget(null);
            const ctx = ensureCtx();
            const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
            applyCustomBufferToSlot(
              activeTarget,
              buf,
              `Mic_${activeTarget}_${new Date().toLocaleTimeString()}`,
              'recorded'
            );
          } catch (err) {
            setStatusMessage(
              err instanceof Error ? err.message : 'Error decodificando grabación.'
            );
          }
        };
        rec.stop();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatusMessage('Captura de micrófono no disponible en este navegador.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecordingTarget(target);
      setStatusMessage(
        `Grabando muestra para ${target.toUpperCase()}... Toca 1 golpe o nota limpia y pulsa Detener.`
      );
    },
    [recordingTarget, ensureCtx, applyCustomBufferToSlot]
  );

  // Audition just the replacement sample slot (one clean hit / note C4)
  const auditionSlotSample = useCallback(
    (slot: ReplacementSlotConfig) => {
      const ctx = ensureCtx();
      const buf =
        slot.sourceType !== 'preset' && slot.customBuffer
          ? slot.customBuffer
          : getPresetAuditionBuffer(ctx, slot.presetId);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.pow(2, slot.pitchSemis / 12);
      const g = ctx.createGain();
      g.gain.value = Math.pow(10, slot.gainDb / 20);
      src.connect(g);
      g.connect(ctx.destination);
      src.start();
    },
    [ensureCtx]
  );

  // Export exact-length 24-bit WAV or MP3 320kbps directly to PC
  const downloadReplacedAudio = useCallback(
    async (format: 'wav' | 'mp3' = 'wav', customFileName?: string) => {
      const targetBuffer = replacedBuffer ?? originalBuffer;
      if (!targetBuffer) return;
      setIsExportingPc(true);
      try {
        const rawBase = (customFileName || stemTitle || 'stem_sampled_pro').trim();
        const clean = sanitizeDownloadBaseName(rawBase, 'stem_sampled_pro');
        const fileName = `${clean}.${format}`;
        const blob =
          format === 'wav'
            ? await encodeBufferToWav24WithMetadata(targetBuffer, {
                rootMidiNote: analysis?.midiRange?.minMidi ?? 60,
              })
            : await encodeBufferToMp3(targetBuffer, 320);
        triggerFileDownload(blob, fileName);
        setStatusMessage(
          `Exportado al PC: "${fileName}" (${targetBuffer.duration.toFixed(2)}s · ${
            format === 'wav' ? 'WAV 24-Bit' : 'MP3 320 kbps'
          }).`
        );
      } catch (err) {
        setStatusMessage(
          err instanceof Error ? err.message : 'Error exportando archivo al PC.'
        );
      } finally {
        setIsExportingPc(false);
      }
    },
    [replacedBuffer, originalBuffer, analysis, stemTitle]
  );

  const downloadReplacedWav24 = useCallback(
    async (customFileName?: string) => {
      await downloadReplacedAudio('wav', customFileName);
    },
    [downloadReplacedAudio]
  );

  // Save directly back into the Song Folder ("Carpeta de la Canción") in Supabase!
  const saveReplacedStemToSong = useCallback(
    async (customStemName?: string) => {
      if (!replacedBuffer || !selectedSong) {
        throw new Error('Selecciona una canción destino y procesa un stem primero.');
      }
      setIsSavingCloud(true);
      try {
        const nameToSave =
          (customStemName || `${stemTitle || 'Stem'} (Sampled Pro)`).trim();
        const wavBlob = await encodeBufferToWav24WithMetadata(replacedBuffer, {
          rootMidiNote: analysis?.midiRange?.minMidi ?? 60,
        });
        const res = await addSampleToSongFolder({
          songId: selectedSong.id,
          bandId: selectedSong.bandId,
          sampleName: nameToSave,
          wavBlob,
          durationSec: replacedBuffer.duration,
          bpm: analysis?.bpm ?? selectedSong.bpm,
          rootNote: analysis?.midiRange?.minMidi ?? 60,
          originKind: 'stem-replaced',
        });
        setStatusMessage(
          `Stem "${res.stemName}" guardado en la carpeta "${selectedSong.title}" (${replacedBuffer.duration.toFixed(
            2
          )}s exactos, listo para Stem Studio y Live Concert).`
        );
        await refreshSongs();
      } finally {
        setIsSavingCloud(false);
      }
    },
    [replacedBuffer, selectedSong, stemTitle, analysis, refreshSongs]
  );

  const applyMixPreset = useCallback(
    (mode: 'replace' | 'layer-sub' | 'hybrid') => {
      polyAutoWeightAppliedRef.current = false;
      if (mode === 'replace') {
        setMixOptions((p) => ({
          ...p,
          replacementPct: 100,
          originalPct: 0,
          brightnessPct: 0,
        }));
        setStatusMessage('Modo Mezcla: 100% Reemplazo limpio.');
        return;
      }
      if (mode === 'layer-sub') {
        setMixOptions((p) => ({
          ...p,
          replacementPct: 60,
          originalPct: 88,
          brightnessPct: -25,
        }));
        if (
          melodicSlot.sourceType === 'preset' &&
          (!isBassPresetId(melodicSlot.presetId) ||
            melodicSlot.presetId === 'inst-bass-finger')
        ) {
          setMelodicSlot((p) => ({
            ...p,
            sourceType: 'preset',
            presetId: 'inst-bass-monark-sub',
          }));
        }
        if (!bassFocusMode && stemMode !== 'drums') {
          setBassFocusMode(true);
          if (originalBuffer) {
            void runAnalysis(
              originalBuffer,
              stemMode,
              sensitivity,
              maxPolyphony,
              selectedSong?.bpm,
              true
            );
          }
        }
        setStatusMessage(
          'Empalme Sub Activo: Bajo Synth denso debajo del audio original (60% Sub / 88% Original).'
        );
        return;
      }
      setMixOptions((p) => ({
        ...p,
        replacementPct: 70,
        originalPct: 55,
        brightnessPct: 0,
      }));
      setStatusMessage('Modo Mezcla Híbrida: 70% Synth / 55% Original.');
    },
    [
      melodicSlot.presetId,
      melodicSlot.sourceType,
      bassFocusMode,
      stemMode,
      originalBuffer,
      runAnalysis,
      sensitivity,
      maxPolyphony,
      selectedSong?.bpm,
    ]
  );

  return {
    songs,
    loadingSongs,
    refreshSongs,
    selectedSongId,
    setSelectedSongId,
    selectedSong,
    selectedStemId,
    originalBuffer,
    replacedBuffer,
    stemTitle,
    waveformPyramid,
    stemMode,
    bassFocusMode,
    toggleBassFocusMode,
    sensitivity,
    setSensitivity,
    maxPolyphony,
    setMaxPolyphony,
    analysis,
    drumSlots,
    melodicSlot,
    customSamples,
    mixOptions,
    setMixOptions,
    applyMixPreset,
    isLoadingStem,
    isAnalyzing,
    isRendering,
    isExportingPc,
    isSavingCloud,
    recordingTarget,
    statusMessage,
    setStatusMessage,
    isPlaying,
    abMode,
    setAbMode,
    currentTimeSec,
    loadSongStem,
    loadLocalStemFile,
    loadDemoStem,
    changeStemModeAndReanalyze,
    reanalyzeCurrentStem,
    updateDrumSlot,
    updateMelodicSlot,
    applyCustomBufferToSlot,
    loadCustomFileForSlot,
    uploadCustomReplacementFiles,
    importCustomSampleFromUrl,
    assignCustomSampleToSlot,
    auditionCustomSample,
    deleteCustomSample,
    resetAllSlotsToPresets,
    toggleMicRecordingForSlot,
    auditionSlotSample,
    togglePlayback,
    seekToSec,
    downloadReplacedAudio,
    downloadReplacedWav24,
    saveReplacedStemToSong,
  };
}
