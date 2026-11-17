import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyTexturePresetToPadParams,
  arraysToAudioBuffer,
  createDefaultPads,
  createDefaultPattern,
  detectSilenceBounds,
  snapSecToZeroCrossing,
} from '../engine/SampleBufferOps';
import {
  BASS_PRESET_CATALOG,
  getPresetAuditionBuffer,
  getPresetZones,
  isBassPresetId,
  MELODIC_PRESET_CATALOG,
} from '../engine/StudioSampleBank';
import {
  loadKitTempFromIndexedDb,
  saveKitTempToIndexedDb,
} from '../engine/KitStorage';
import {
  analyzeAudioBufferFirst,
  computeAudioMemorySignature,
  getCachedPreImportEntry,
  registerPreImportMemoryEntry,
  type PreImportMemoryEntry,
} from '../engine/PreImportAnalyzer';
import { detectPitchYin, type PitchEstimate } from '../engine/PitchDetector';
import { SampleLabHandoff } from '../engine/SampleLabHandoff';
import { SamplerEngine } from '../engine/SamplerEngine';
import {
  assignSlicesToPads,
  buildMonoSliceFromBuffer,
  sliceByBpmGrid,
  sliceByTransients,
  type GridDivision,
} from '../engine/Slicer';
import type {
  DefaultInstrumentId,
  FullStemAnalysisResult,
  ImportedAudioMemoryAnalysis,
  PadVoiceParams,
  SampleKit,
  SamplePad,
  SampleRegion,
  SampleSource,
  SamplerPattern,
  SnapMode,
  TexturePresetId,
} from '../types/sampler.types';
import type { WaveformPyramid } from '../workers/waveformPeaks.worker';
import WaveformPeaksWorker from '../workers/waveformPeaks.worker.ts?worker';
import SamplerAnalysisWorker from '../workers/samplerAnalysis.worker.ts?worker';
import MusicTempo from 'music-tempo';

function estimateBpmQuick(buffer: AudioBuffer): number {
  try {
    const ch = buffer.getChannelData(0);
    const maxLen = Math.min(ch.length, buffer.sampleRate * 45);
    const mt = new MusicTempo(Array.from(ch.subarray(0, maxLen)));
    let bpm = Math.round(Number(mt.tempo));
    if (bpm > 170) bpm = Math.round(bpm / 2);
    if (bpm >= 50 && bpm <= 200) return bpm;
  } catch {
    // ignore if silent or short slice
  }
  return 120;
}

export function useSamplerEngine() {
  const [kitId, setKitId] = useState<string>(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `kit-${Date.now()}`
  );
  const [kitName, setKitName] = useState<string>('Mi Kit de Sampleo');
  const [sources, setSources] = useState<SampleSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [regions, setRegions] = useState<SampleRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [pads, setPads] = useState<SamplePad[]>(() => createDefaultPads());
  const [selectedPadIndex, setSelectedPadIndex] = useState<number>(0);
  const padsRef = useRef<SamplePad[]>(pads);
  padsRef.current = pads;
  const selectedPadIndexRef = useRef<number>(selectedPadIndex);
  selectedPadIndexRef.current = selectedPadIndex;
  const [pattern, setPattern] = useState<SamplerPattern>(() => createDefaultPattern(120, 16));

  const [activePadSet, setActivePadSet] = useState<Set<number>>(new Set());
  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [isSequencerPlaying, setIsSequencerPlaying] = useState<boolean>(false);
  const [isSequencerRecording, setIsSequencerRecording] = useState<boolean>(false);
  const [isAuditioning, setIsAuditioning] = useState<boolean>(false);
  const [loopAudition, setLoopAudition] = useState<boolean>(true);
  const [snapMode, setSnapMode] = useState<SnapMode>('zero-cross');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isRecordingMic, setIsRecordingMic] = useState<boolean>(false);
  const [lastPitchEstimate, setLastPitchEstimate] = useState<PitchEstimate | null>(null);
  const [waveformPyramid, setWaveformPyramid] = useState<WaveformPyramid | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tempSavedAt, setTempSavedAt] = useState<string | null>(null);

  const engineRef = useRef<SamplerEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new SamplerEngine(
      pads,
      pattern,
      (step) => setCurrentStep(step),
      (activeSet) => setActivePadSet(new Set(activeSet))
    );
  }

  const activeSource = useMemo(
    () => sources.find((s) => s.id === activeSourceId) ?? sources[0] ?? null,
    [sources, activeSourceId]
  );

  const activeSourceRegions = useMemo(
    () =>
      activeSource
        ? regions
            .filter((r) => r.sourceId === activeSource.id)
            .sort((a, b) => a.startSec - b.startSec)
        : [],
    [regions, activeSource]
  );

  const selectedRegion = useMemo(
    () =>
      regions.find((r) => r.id === selectedRegionId) ??
      activeSourceRegions[0] ??
      null,
    [regions, selectedRegionId, activeSourceRegions]
  );

  const selectedPad = pads[selectedPadIndex] ?? pads[0];

  // Sync reactive state into audio engine
  useEffect(() => {
    engineRef.current?.syncState(sources, regions, pads, pattern);
  }, [sources, regions, pads, pattern]);

  // Compute waveform pyramid off main thread when activeSource changes
  useEffect(() => {
    if (!activeSource) {
      setWaveformPyramid(null);
      return;
    }
    const buf = activeSource.buffer;
    const ch0 = new Float32Array(buf.getChannelData(0));
    const ch1 =
      buf.numberOfChannels > 1
        ? new Float32Array(buf.getChannelData(1))
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
      { id: reqId, left: ch0, right: ch1, sampleRate: buf.sampleRate },
      [ch0.buffer, ch1.buffer]
    );

    return () => {
      worker?.terminate();
    };
  }, [activeSource]);

  const runPreImportForSampler = useCallback(
    async (
      buffer: AudioBuffer,
      bpmHint?: number
    ): Promise<ImportedAudioMemoryAnalysis> => {
      const cached = getCachedPreImportEntry(buffer);
      if (cached) return cached.memory;

      const mono = buildMonoSliceFromBuffer(buffer, 0, buffer.duration);
      const sig = computeAudioMemorySignature(mono, buffer.sampleRate);
      const runSync = (): PreImportMemoryEntry =>
        analyzeAudioBufferFirst(buffer, { bpmHint, sensitivity: 0.62 });

      if (typeof Worker !== 'undefined') {
        const entry = await new Promise<PreImportMemoryEntry>((resolve) => {
          let w: Worker | null = null;
          try {
            w = new SamplerAnalysisWorker();
          } catch {
            w = null;
          }
          if (!w) {
            resolve(runSync());
            return;
          }
          const reqId = Date.now() + Math.floor(Math.random() * 1000);
          const copy = new Float32Array(mono);
          w.onmessage = (
            ev: MessageEvent<{
              id: number;
              success: boolean;
              preAnalysis?: ImportedAudioMemoryAnalysis;
              polyResult?: FullStemAnalysisResult;
            }>
          ) => {
            if (ev.data?.id === reqId) {
              w?.terminate();
              if (ev.data.preAnalysis && ev.data.polyResult) {
                registerPreImportMemoryEntry(ev.data.preAnalysis, ev.data.polyResult);
                resolve({ memory: ev.data.preAnalysis, polyResult: ev.data.polyResult });
              } else {
                resolve(runSync());
              }
            }
          };
          w.onerror = () => {
            w?.terminate();
            resolve(runSync());
          };
          w.postMessage(
            {
              id: reqId,
              kind: 'pre-analyze-audio',
              sourceId: 'sampler-import',
              mono: copy,
              sampleRate: buffer.sampleRate,
              bpmHint,
              sensitivity: 0.62,
              signature: sig,
            },
            [copy.buffer]
          );
        });
        return entry.memory;
      }

      return runSync().memory;
    },
    []
  );

  const registerLoadedAudioBuffer = useCallback(
    (
      buffer: AudioBuffer,
      name: string,
      origin: SampleSource['origin'],
      provenance?: SampleSource['provenance'],
      targetPadIndex?: number,
      preAnalysis?: ImportedAudioMemoryAnalysis
    ) => {
      const srcId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const resolvedPre = preAnalysis ?? getCachedPreImportEntry(buffer)?.memory;
      const bpm = resolvedPre?.bpm ?? estimateBpmQuick(buffer);
      const monoForPitch = buildMonoSliceFromBuffer(
        buffer,
        0,
        Math.min(buffer.duration, 2.0)
      );
      const pitch = detectPitchYin(monoForPitch, buffer.sampleRate);

      const newSource: SampleSource = {
        id: srcId,
        name,
        origin,
        buffer,
        bpm,
        rootNote:
          pitch.confidence >= 0.45
            ? pitch.midiNote
            : resolvedPre?.isTonal
            ? resolvedPre.detectedRootMidi
            : 60,
        detectedPitchHz: pitch.freqHz,
        preAnalysis: resolvedPre,
        provenance,
      };

      const cleanBase = name.replace(/\.[^.]+$/, '');
      const bounds = detectSilenceBounds(buffer, -48);
      const safeEndSec = Math.min(
        buffer.duration,
        Math.max(bounds.startSec + Math.min(0.05, buffer.duration * 0.5), bounds.endSec)
      );
      const defaultRegion: SampleRegion = {
        id: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        sourceId: srcId,
        name: targetPadIndex !== undefined ? cleanBase : `${cleanBase} (Región 1)`,
        startSec: Math.min(bounds.startSec, Math.max(0, safeEndSec - 0.01)),
        endSec: Math.max(0.01, safeEndSec),
        loopCrossfadeMs: 10,
        sliceSource: 'manual',
      };

      setSources((prev) => [...prev, newSource]);
      setActiveSourceId(srcId);
      setRegions((prev) => [...prev, defaultRegion]);
      setSelectedRegionId(defaultRegion.id);
      setLastPitchEstimate(pitch);
      setPattern((prev) => ({ ...prev, bpm }));

      const memorySummary = resolvedPre?.isTonal
        ? ` · Tono ${resolvedPre.musicalKey}${resolvedPre.chords.length > 0 ? ` (${resolvedPre.chordProgressionSummary})` : ''}`
        : '';

      if (targetPadIndex !== undefined && targetPadIndex >= 0 && targetPadIndex < 16) {
        setPads((prev) => {
          const next = [...prev];
          next[targetPadIndex] = {
            ...next[targetPadIndex],
            regionId: defaultRegion.id,
            label: cleanBase.slice(0, 20),
          };
          return next;
        });
        setSelectedPadIndex(targetPadIndex);
        setStatusMessage(
          `Audio "${name}" asignado al Pad ${targetPadIndex + 1} (${bpm} BPM${memorySummary}).`
        );
      } else {
        const currentPads = padsRef.current;
        const curSel = selectedPadIndexRef.current;
        const autoPadIdx = !currentPads[curSel]?.regionId
          ? curSel
          : currentPads.findIndex((p) => !p.regionId);

        if (autoPadIdx >= 0) {
          setPads((prev) =>
            prev.map((p, idx) =>
              idx === autoPadIdx
                ? {
                    ...p,
                    regionId: defaultRegion.id,
                    label: cleanBase.slice(0, 18),
                  }
                : p
            )
          );
          setSelectedPadIndex(autoPadIdx);
          setStatusMessage(
            `Audio "${name}" cargado en Pad ${autoPadIdx + 1} (${bpm} BPM${memorySummary}).`
          );
        } else {
          setStatusMessage(
            `Audio "${name}" en memoria (${bpm} BPM${memorySummary}). Pulsa "Auto-Slice" o "Cortar Acordes".`
          );
        }
      }
    },
    []
  );

  // Restore temporary IndexedDB session OR consume handoff from Mastering Pro on mount
  useEffect(() => {
    const engine = engineRef.current!;
    let cancelled = false;

    void (async () => {
      const handoff = SampleLabHandoff.consumeAudioForSampleLab();
      if (handoff && !cancelled) {
        const pre = await runPreImportForSampler(handoff.buffer);
        if (!cancelled) {
          registerLoadedAudioBuffer(
            handoff.buffer,
            handoff.title,
            handoff.origin,
            {
              fileName: handoff.title,
              songId: handoff.songId,
            },
            undefined,
            pre
          );
        }
        return;
      }

      const ctx = engine.ensureContext();
      const restored = await loadKitTempFromIndexedDb(ctx);
      if (restored && !cancelled && restored.sources.length > 0) {
        setKitName(restored.kit.name || 'Mi Kit de Sampleo');
        setSources(restored.sources);
        setActiveSourceId(restored.sources[0].id);
        setRegions(restored.kit.regions);
        setSelectedRegionId(restored.kit.regions[0]?.id ?? null);
        setPads(restored.kit.pads);
        if (restored.kit.pattern) setPattern(restored.kit.pattern);
        setStatusMessage(
          `Sesión temporal restaurada (${restored.sources.length} fuente(s), ${restored.kit.regions.length} slices).`
        );
      }
    })();

    return () => {
      cancelled = true;
      engine.dispose();
    };
  }, [registerLoadedAudioBuffer]);

  // Auto-save temporarily to IndexedDB on edits (debounced 1500ms)
  useEffect(() => {
    if (sources.length === 0) return;
    const timer = setTimeout(() => {
      const kitSnapshot: SampleKit = {
        schemaVersion: 1,
        id: kitId,
        name: kitName,
        sources: [],
        regions,
        pads,
        pattern,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      void saveKitTempToIndexedDb(kitSnapshot, sources).then(() => {
        setTempSavedAt(new Date().toLocaleTimeString());
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [kitId, kitName, sources, regions, pads, pattern]);

  const loadExternalBufferForSampling = useCallback(
    (
      buffer: AudioBuffer,
      title: string,
      preAnalysis?: ImportedAudioMemoryAnalysis | null
    ) => {
      if (preAnalysis) {
        registerPreImportMemoryEntry(preAnalysis);
        registerLoadedAudioBuffer(
          buffer,
          title,
          'file',
          { fileName: title },
          undefined,
          preAnalysis
        );
        return;
      }
      const cached = getCachedPreImportEntry(buffer);
      if (cached) {
        registerLoadedAudioBuffer(
          buffer,
          title,
          'file',
          { fileName: title },
          undefined,
          cached.memory
        );
        return;
      }
      setIsBusy(true);
      setStatusMessage('Detectando tempo y acordes en memoria...');
      void runPreImportForSampler(buffer)
        .then((pre) => {
          registerLoadedAudioBuffer(
            buffer,
            title,
            'file',
            { fileName: title },
            undefined,
            pre
          );
        })
        .finally(() => setIsBusy(false));
    },
    [registerLoadedAudioBuffer, runPreImportForSampler]
  );

  const loadAudioFile = async (file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      setIsBusy(true);
      setStatusMessage('Paso previo: Detectando tempo y acordes en memoria...');
      const buf = await engine.decodeAudioFile(file);
      const pre = await runPreImportForSampler(buf);
      registerLoadedAudioBuffer(
        buf,
        file.name,
        'file',
        { fileName: file.name },
        undefined,
        pre
      );
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Error decodificando archivo de audio.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const loadAudioFileToPad = async (file: File, padIndex: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      setIsBusy(true);
      setStatusMessage('Paso previo: Detectando tempo y acordes en memoria...');
      const buf = await engine.decodeAudioFile(file);
      const pre = await runPreImportForSampler(buf);
      registerLoadedAudioBuffer(
        buf,
        file.name,
        'file',
        { fileName: file.name },
        padIndex,
        pre
      );
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Error decodificando archivo de audio.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const loadAudioFromUrl = async (
    url: string,
    title: string,
    songId?: string
  ) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      setIsBusy(true);
      setStatusMessage('Paso previo: Detectando tempo y acordes en memoria...');
      const buf = await engine.decodeAudioUrl(url);
      const pre = await runPreImportForSampler(buf);
      registerLoadedAudioBuffer(
        buf,
        title,
        'stem',
        {
          fileName: title,
          songId,
        },
        undefined,
        pre
      );
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Error cargando pista remota.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const generateDemoSource = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const ctx = engine.ensureContext();
    const sr = ctx.sampleRate;
    const bpm = 120;
    const beat = 60 / bpm;
    const dur = beat * 8; // 2 bars @ 120BPM
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);

    let seed = 0x55aa1234;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    const chords = [220, 261.63, 329.63, 392.0];
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const bf = t % beat;
      const eighth = t % (beat * 0.5);
      const beatIdx = Math.floor(t / beat);

      const kick =
        beatIdx % 2 === 0 && bf < 0.22
          ? Math.sin(2 * Math.PI * (52 + 110 * Math.exp(-bf * 38)) * bf) *
            Math.exp(-bf * 14) *
            0.55
          : 0;
      const snare =
        beatIdx % 2 === 1 && bf < 0.16
          ? (rnd() * 0.4 + Math.sin(2 * Math.PI * 195 * bf) * 0.25) *
            Math.exp(-bf * 22)
          : 0;
      const hat =
        eighth < 0.045 ? rnd() * Math.exp(-eighth * 75) * 0.16 : 0;

      const root = chords[Math.floor(beatIdx / 2) % chords.length];
      const stab =
        (bf < 0.18 ? 1 : 0.25) *
        (Math.sin(2 * Math.PI * root * t) * 0.15 +
          Math.sin(2 * Math.PI * root * 1.25 * t) * 0.1 +
          Math.sin(2 * Math.PI * root * 1.5 * t) * 0.1);

      L[i] = Math.max(-0.9, Math.min(0.9, kick + snare + hat * 0.8 + stab));
      R[i] = Math.max(-0.9, Math.min(0.9, kick + snare + hat * 1.2 + stab * 0.92));
    }

    const preEntry = analyzeAudioBufferFirst(buf, { bpmHint: 120, sensitivity: 0.62 });
    registerLoadedAudioBuffer(
      buf,
      'Loop Estudio 120 BPM (Demo)',
      'file',
      { fileName: 'Demo_120BPM.wav' },
      undefined,
      preEntry.memory
    );
  };

  const buildStudioPresetSourceAndRegion = useCallback(
    (ctx: AudioContext, presetId: DefaultInstrumentId) => {
      const sr = ctx.sampleRate;
      const zones = getPresetZones(presetId, sr);
      const isBass = isBassPresetId(presetId);
      const targetMidi = isBass ? 36 : 60;
      const zone =
        zones.find((z) => z.rootMidi === targetMidi) ??
        (zones.length > 1 ? zones[Math.min(zones.length - 1, 2)] : zones[0]);
      const buf = arraysToAudioBuffer(ctx, zone.left, zone.right, sr);
      const meta = MELODIC_PRESET_CATALOG.find((p) => p.id === presetId);
      const label = meta?.label ?? presetId;
      const srcId = `src-preset-${presetId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

      const src: SampleSource = {
        id: srcId,
        name: label,
        origin: 'file',
        buffer: buf,
        bpm: pattern.bpm || 120,
        rootNote: zone.rootMidi,
        detectedPitchHz: Number((440 * Math.pow(2, (zone.rootMidi - 69) / 12)).toFixed(2)),
        provenance: { fileName: `${presetId}.wav` },
      };

      const hasLoop =
        zone.loopStartSample !== undefined && zone.loopEndSample !== undefined;
      const reg: SampleRegion = {
        id: `reg-preset-${presetId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        sourceId: srcId,
        name: meta?.badge ? `${meta.badge} · ${label}` : label,
        startSec: 0,
        endSec: buf.duration,
        loopStartSec: hasLoop ? zone.loopStartSample! / sr : undefined,
        loopEndSec: hasLoop ? zone.loopEndSample! / sr : undefined,
        loopCrossfadeMs: hasLoop ? 36 : 10,
        sliceSource: 'manual',
        classification: 'melodic',
      };

      return { src, reg, meta, isBass, hasLoop };
    },
    [pattern.bpm]
  );

  const auditionStudioPreset = useCallback((presetId: DefaultInstrumentId) => {
    const engine = engineRef.current;
    if (!engine) return;
    const ctx = engine.ensureContext();
    const buf = getPresetAuditionBuffer(ctx, presetId);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.85;
    src.connect(g);
    g.connect(ctx.destination);
    src.start();
  }, []);

  const loadStudioPresetToPad = useCallback(
    (presetId: DefaultInstrumentId, padIndex?: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const ctx = engine.ensureContext();
      const targetIdx = padIndex ?? selectedPadIndex;
      const { src, reg, meta, isBass, hasLoop } = buildStudioPresetSourceAndRegion(
        ctx,
        presetId
      );

      setSources((prev) => [...prev, src]);
      setActiveSourceId(src.id);
      setRegions((prev) => [...prev, reg]);
      setSelectedRegionId(reg.id);
      setPads((prev) =>
        prev.map((p, idx) =>
          idx === targetIdx
            ? {
                ...p,
                regionId: reg.id,
                label: (meta?.badge || meta?.label || presetId).slice(0, 18),
                params: {
                  ...p.params,
                  playMode: hasLoop ? 'loop' : 'oneshot',
                  chokeGroup: isBass ? 1 : p.params.chokeGroup,
                  amp: {
                    ...p.params.amp,
                    attackMs: 2,
                    releaseMs: isBass ? 180 : 120,
                  },
                },
              }
            : p
        )
      );
      setSelectedPadIndex(targetIdx);
      setStatusMessage(
        `Sonido "${src.name}" cargado en Pad ${targetIdx + 1} (Root ${
          isBass ? 'C2' : 'C4'
        } · listo para Modo Cromático y Secuenciador).`
      );
    },
    [buildStudioPresetSourceAndRegion, selectedPadIndex]
  );

  const loadProBassPackToPads = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const ctx = engine.ensureContext();
    const built = BASS_PRESET_CATALOG.slice(0, 16).map((entry) =>
      buildStudioPresetSourceAndRegion(ctx, entry.id)
    );
    if (built.length === 0) return;

    setSources((prev) => [...prev, ...built.map((b) => b.src)]);
    setActiveSourceId(built[0].src.id);
    setRegions((prev) => [...prev, ...built.map((b) => b.reg)]);
    setSelectedRegionId(built[0].reg.id);
    setPads((prev) =>
      prev.map((p, idx) => {
        const item = built[idx];
        if (!item) return p;
        return {
          ...p,
          regionId: item.reg.id,
          label: (item.meta?.badge || item.meta?.label || `Bass ${idx + 1}`).slice(0, 18),
          params: {
            ...p.params,
            playMode: item.hasLoop ? 'loop' : 'oneshot',
            chokeGroup: 1,
            amp: {
              ...p.params.amp,
              attackMs: 2,
              releaseMs: 180,
            },
          },
        };
      })
    );
    setSelectedPadIndex(0);
    setKitName('Pack Bajos Pro (Disco-Funk · 90s · Monark · Astra)');
    setStatusMessage(
      `Pack de ${built.length} Bajos Profesionales cargado en Pads 1–${built.length} (Mono Choke 1 · Root C2).`
    );
  }, [buildStudioPresetSourceAndRegion]);

  const applySnapToSec = useCallback(
    (rawSec: number): number => {
      if (!activeSource) return rawSec;
      const clamped = Math.max(0, Math.min(activeSource.buffer.duration, rawSec));
      if (snapMode === 'zero-cross') {
        return snapSecToZeroCrossing(activeSource.buffer, clamped, 10);
      }
      if (snapMode === 'grid') {
        const stepSec = 60 / Math.max(40, activeSource.bpm || 120) / 4;
        return Math.min(
          activeSource.buffer.duration,
          Math.round(clamped / stepSec) * stepSec
        );
      }
      if (snapMode === 'transient' && activeSourceRegions.length > 0) {
        let best = clamped;
        let minD = 0.05;
        for (const r of activeSourceRegions) {
          const d = Math.abs(r.startSec - clamped);
          if (d < minD) {
            minD = d;
            best = r.startSec;
          }
        }
        return best;
      }
      return Number(clamped.toFixed(4));
    },
    [activeSource, snapMode, activeSourceRegions]
  );

  const updateRegionBounds = useCallback(
    (regionId: string, startSec: number, endSec: number) => {
      if (!activeSource) return;
      const s = Math.max(0, Math.min(activeSource.buffer.duration - 0.015, startSec));
      const e = Math.max(s + 0.015, Math.min(activeSource.buffer.duration, endSec));
      setRegions((prev) =>
        prev.map((r) =>
          r.id === regionId
            ? { ...r, startSec: Number(s.toFixed(5)), endSec: Number(e.toFixed(5)) }
            : r
        )
      );
    },
    [activeSource]
  );

  const updateRegionCrossfade = useCallback((regionId: string, loopCrossfadeMs: number) => {
    const clamped = Math.max(0, Math.min(200, Math.round(loopCrossfadeMs)));
    setRegions((prev) =>
      prev.map((r) => (r.id === regionId ? { ...r, loopCrossfadeMs: clamped } : r))
    );
  }, []);

  const createSliceAtSec = useCallback(
    (sec: number) => {
      if (!activeSource) return;
      const snapped = applySnapToSec(sec);
      const targetReg =
        activeSourceRegions.find(
          (r) => snapped > r.startSec + 0.02 && snapped < r.endSec - 0.02
        ) ?? selectedRegion;

      if (!targetReg || snapped <= targetReg.startSec + 0.02 || snapped >= targetReg.endSec - 0.02) {
        // Create standalone 0.5s slice if outside existing bounds
        const end = Math.min(activeSource.buffer.duration, snapped + 0.5);
        const nr: SampleRegion = {
          id: `reg-man-${Date.now()}`,
          sourceId: activeSource.id,
          name: `Slice ${activeSourceRegions.length + 1}`,
          startSec: snapped,
          endSec: end,
          loopCrossfadeMs: 8,
          sliceSource: 'manual',
        };
        setRegions((prev) => [...prev, nr]);
        setSelectedRegionId(nr.id);
        return;
      }

      const splitRight: SampleRegion = {
        id: `reg-man-${Date.now()}`,
        sourceId: activeSource.id,
        name: `Slice ${activeSourceRegions.length + 1}`,
        startSec: snapped,
        endSec: targetReg.endSec,
        loopCrossfadeMs: targetReg.loopCrossfadeMs,
        sliceSource: 'manual',
      };

      setRegions((prev) => [
        ...prev.map((r) =>
          r.id === targetReg.id ? { ...r, endSec: snapped } : r
        ),
        splitRight,
      ]);
      setSelectedRegionId(splitRight.id);
    },
    [activeSource, applySnapToSec, activeSourceRegions, selectedRegion]
  );

  const autoSliceByTransients = async (sensitivity = 0.62, minSpacingMs = 95) => {
    if (!activeSource) return;
    setIsBusy(true);
    try {
      const startSec = selectedRegion ? selectedRegion.startSec : 0;
      const endSec = selectedRegion
        ? selectedRegion.endSec
        : activeSource.buffer.duration;
      const mono = buildMonoSliceFromBuffer(activeSource.buffer, startSec, endSec);

      let sliced: SampleRegion[];
      if (typeof Worker !== 'undefined') {
        sliced = await new Promise<SampleRegion[]>((resolve) => {
          let w: Worker | null = null;
          try {
            w = new SamplerAnalysisWorker();
          } catch {
            resolve(
              sliceByTransients(
                activeSource.id,
                mono,
                activeSource.buffer.sampleRate,
                startSec,
                endSec,
                sensitivity,
                minSpacingMs
              )
            );
            return;
          }
          const reqId = Date.now();
          const monoCopy = new Float32Array(mono);
          w.onmessage = (
            ev: MessageEvent<{ id: number; success: boolean; regions?: SampleRegion[] }>
          ) => {
            if (ev.data?.id === reqId) {
              w?.terminate();
              resolve(ev.data.regions ?? []);
            }
          };
          w.onerror = () => {
            w?.terminate();
            resolve(
              sliceByTransients(
                activeSource.id,
                mono,
                activeSource.buffer.sampleRate,
                startSec,
                endSec,
                sensitivity,
                minSpacingMs
              )
            );
          };
          w.postMessage(
            {
              id: reqId,
              kind: 'slice-transients',
              sourceId: activeSource.id,
              mono: monoCopy,
              sampleRate: activeSource.buffer.sampleRate,
              rangeStartSec: startSec,
              rangeEndSec: endSec,
              sensitivity,
              minSpacingMs,
            },
            [monoCopy.buffer]
          );
        });
      } else {
        sliced = sliceByTransients(
          activeSource.id,
          mono,
          activeSource.buffer.sampleRate,
          startSec,
          endSec,
          sensitivity,
          minSpacingMs
        );
      }

      if (sliced.length > 0) {
        setRegions((prev) => [
          ...prev.filter((r) => r.sourceId !== activeSource.id),
          ...sliced,
        ]);
        setSelectedRegionId(sliced[0].id);
        setPads((prev) => assignSlicesToPads(prev, sliced));
        setStatusMessage(
          `Auto-Slice por transientes: ${sliced.length} golpes detectados y asignados a los Pads.`
        );
      }
    } finally {
      setIsBusy(false);
    }
  };

  const autoSliceByGrid = (division: GridDivision) => {
    if (!activeSource) return;
    const startSec = selectedRegion ? selectedRegion.startSec : 0;
    const endSec = selectedRegion
      ? selectedRegion.endSec
      : activeSource.buffer.duration;
    const sliced = sliceByBpmGrid(
      activeSource.id,
      startSec,
      endSec,
      activeSource.bpm,
      division
    );
    if (sliced.length > 0) {
      setRegions((prev) => [
        ...prev.filter((r) => r.sourceId !== activeSource.id),
        ...sliced,
      ]);
      setSelectedRegionId(sliced[0].id);
      setPads((prev) => assignSlicesToPads(prev, sliced));
      setStatusMessage(
        `Corte por rejilla (${division} @ ${activeSource.bpm} BPM): ${sliced.length} slices asignados.`
      );
    }
  };

  const autoSliceByChords = () => {
    if (!activeSource?.preAnalysis?.chords?.length) return;
    const chords = activeSource.preAnalysis.chords.slice(0, 16);
    const sliced: SampleRegion[] = chords.map((c, idx) => ({
      id: `reg-chord-${Date.now()}-${idx}`,
      sourceId: activeSource.id,
      name: `${c.chord} (${c.rootName})`,
      startSec: Number(Math.max(0, c.startSec).toFixed(4)),
      endSec: Number(
        Math.min(activeSource.buffer.duration, Math.max(c.startSec + 0.08, c.endSec)).toFixed(4)
      ),
      loopCrossfadeMs: 10,
      sliceSource: 'transient',
    }));
    if (sliced.length > 0) {
      setRegions((prev) => [
        ...prev.filter((r) => r.sourceId !== activeSource.id),
        ...sliced,
      ]);
      setSelectedRegionId(sliced[0].id);
      setPads((prev) => assignSlicesToPads(prev, sliced));
      setPattern((prev) => ({
        ...prev,
        bpm: activeSource.preAnalysis?.bpm ?? activeSource.bpm,
      }));
      setStatusMessage(
        `Corte por Acordes en Memoria (${activeSource.bpm} BPM · Tono ${activeSource.preAnalysis.musicalKey}): ${sliced.length} acordes (${chords.map((c) => c.chord).join(' · ')}) asignados a los Pads.`
      );
    }
  };

  const assignRegionToPad = useCallback((region: SampleRegion, padIndex: number) => {
    setPads((prev) =>
      prev.map((p, idx) =>
        idx === padIndex ? { ...p, regionId: region.id, label: region.name } : p
      )
    );
    setSelectedPadIndex(padIndex);
  }, []);

  const updatePadParams = useCallback(
    (padIndex: number, patch: Partial<PadVoiceParams>) => {
      setPads((prev) =>
        prev.map((p, idx) =>
          idx === padIndex ? { ...p, params: { ...p.params, ...patch } } : p
        )
      );
    },
    []
  );

  const updatePadLabelAndChoke = useCallback(
    (padIndex: number, label: string) => {
      setPads((prev) =>
        prev.map((p, idx) => (idx === padIndex ? { ...p, label } : p))
      );
    },
    []
  );

  const applyTexturePreset = useCallback(
    (padIndex: number, presetId: TexturePresetId) => {
      setPads((prev) =>
        prev.map((p, idx) =>
          idx === padIndex
            ? { ...p, params: applyTexturePresetToPadParams(p.params, presetId) }
            : p
        )
      );
      setStatusMessage(`Textura "${presetId}" aplicada al Pad ${padIndex + 1}.`);
    },
    []
  );

  const detectPitchForSelectedRegion = async () => {
    if (!activeSource || !selectedRegion) return;
    const mono = buildMonoSliceFromBuffer(
      activeSource.buffer,
      selectedRegion.startSec,
      selectedRegion.endSec
    );
    const est = detectPitchYin(mono, activeSource.buffer.sampleRate);
    setLastPitchEstimate(est);
    setSources((prev) =>
      prev.map((s) =>
        s.id === activeSource.id ? { ...s, rootNote: est.midiNote, detectedPitchHz: est.freqHz } : s
      )
    );
    setStatusMessage(
      `Nota detectada (YIN): ${est.noteName} (${est.freqHz} Hz, ${est.centsOffset >= 0 ? '+' : ''}${est.centsOffset}c · confianza ${Math.round(est.confidence * 100)}%).`
    );
    return est;
  };

  const autoTunePadToRoot = async (padIndex: number) => {
    const est = await detectPitchForSelectedRegion();
    if (!est) return;
    updatePadParams(padIndex, { fineCents: -est.centsOffset });
    setStatusMessage(`Pad ${padIndex + 1} afinado a ${est.noteName} (ajuste fino ${-est.centsOffset} cents).`);
  };

  const triggerPad = useCallback((padIndex: number, velocity01 = 0.9) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.triggerPad(padIndex, velocity01);
    const quantStep = eng.quantizeLiveHitIfRecording();
    if (quantStep !== null) {
      setPattern((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) =>
          lane.padIndex === padIndex
            ? {
                ...lane,
                steps: lane.steps.map((st, idx) =>
                  idx === quantStep ? { ...st, on: true, velocity: velocity01 } : st
                ),
              }
            : lane
        ),
      }));
    }
  }, []);

  const releasePad = useCallback((padIndex: number) => {
    engineRef.current?.releasePad(padIndex);
  }, []);

  const toggleAudition = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || !selectedRegion) return;
    if (isAuditioning) {
      eng.stopAudition();
      setIsAuditioning(false);
    } else {
      setIsAuditioning(true);
      eng.auditionRegion(selectedRegion, loopAudition, () => {
        setIsAuditioning(false);
      });
    }
  }, [selectedRegion, isAuditioning, loopAudition]);

  const toggleSequencer = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (isSequencerPlaying) {
      eng.stopSequencer();
      setIsSequencerPlaying(false);
    } else {
      eng.startSequencer();
      setIsSequencerPlaying(true);
    }
  }, [isSequencerPlaying]);

  const toggleStep = useCallback((padIndex: number, stepIndex: number) => {
    setPattern((prev) => ({
      ...prev,
      lanes: prev.lanes.map((lane) =>
        lane.padIndex === padIndex
          ? {
              ...lane,
              steps: lane.steps.map((c, sIdx) =>
                sIdx === stepIndex ? { ...c, on: !c.on } : c
              ),
            }
          : lane
      ),
    }));
  }, []);

  const startMicRecording = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    await eng.startMicrophoneRecording();
    setIsRecordingMic(true);
    setStatusMessage('Grabando entrada de audio / micrófono... Pulsa detener para samplear.');
  };

  const stopMicRecording = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    const buf = await eng.stopMicrophoneRecording();
    setIsRecordingMic(false);
    setStatusMessage('Detectando tempo y acordes de la grabación...');
    const pre = await runPreImportForSampler(buf);
    registerLoadedAudioBuffer(
      buf,
      `Grabación ${new Date().toLocaleTimeString()}`,
      'recording',
      undefined,
      undefined,
      pre
    );
  };

  const loadHydratedKit = useCallback(
    (kit: SampleKit, loadedSources: SampleSource[]) => {
      setKitId(kit.id);
      setKitName(kit.name);
      setSources(loadedSources);
      setActiveSourceId(loadedSources[0]?.id ?? null);
      setRegions(kit.regions);
      setSelectedRegionId(kit.regions[0]?.id ?? null);
      setPads(kit.pads);
      if (kit.pattern) setPattern(kit.pattern);
      setStatusMessage(`Kit "${kit.name}" cargado (${loadedSources.length} fuente(s)).`);
    },
    []
  );

  const buildCurrentKitObject = useCallback((): SampleKit => {
    return {
      schemaVersion: 1,
      id: kitId,
      name: kitName,
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        origin: s.origin,
        bpm: s.bpm,
        rootNote: s.rootNote,
        sampleRate: s.buffer.sampleRate,
        durationSec: s.buffer.duration,
        wavBlobKey: `src:${s.id}`,
        provenance: s.provenance,
      })),
      regions,
      pads,
      pattern,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, [kitId, kitName, sources, regions, pads, pattern]);

  return {
    engineRef,
    kitId,
    kitName,
    setKitName,
    sources,
    activeSource,
    activeSourceId,
    setActiveSourceId,
    setSources,
    regions,
    activeSourceRegions,
    selectedRegion,
    setSelectedRegionId,
    pads,
    setPads,
    selectedPadIndex,
    setSelectedPadIndex,
    selectedPad,
    pattern,
    setPattern,
    activePadSet,
    currentStep,
    isSequencerPlaying,
    isSequencerRecording,
    setIsSequencerRecording: (v: boolean) => {
      setIsSequencerRecording(v);
      engineRef.current?.setSequencerRecording(v);
    },
    isAuditioning,
    loopAudition,
    setLoopAudition,
    snapMode,
    setSnapMode,
    isBusy,
    isRecordingMic,
    lastPitchEstimate,
    waveformPyramid,
    statusMessage,
    setStatusMessage,
    tempSavedAt,
    loadAudioFile,
    loadAudioFileToPad,
    loadAudioFromUrl,
    loadExternalBufferForSampling,
    generateDemoSource,
    auditionStudioPreset,
    loadStudioPresetToPad,
    loadProBassPackToPads,
    applySnapToSec,
    updateRegionBounds,
    updateRegionCrossfade,
    createSliceAtSec,
    autoSliceByTransients,
    autoSliceByGrid,
    autoSliceByChords,
    assignRegionToPad,
    updatePadParams,
    updatePadLabelAndChoke,
    applyTexturePreset,
    detectPitchForSelectedRegion,
    autoTunePadToRoot,
    triggerPad,
    releasePad,
    toggleAudition,
    toggleSequencer,
    toggleStep,
    startMicRecording,
    stopMicRecording,
    loadHydratedKit,
    buildCurrentKitObject,
  };
}
