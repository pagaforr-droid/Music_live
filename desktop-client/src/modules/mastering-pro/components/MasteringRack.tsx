import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Cpu,
  History,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Database,
  Download,
  Save,
  Upload,
  X,
  Grid,
} from 'lucide-react';
import {
  PRO_PRESETS_CATALOG,
  buildEffectiveDspChain,
  extractSurgicalOverridesFromPreset,
  getPresetById,
  syncSurgicalOverridesEqBands,
} from '../presets/proPresetsCatalog';
import {
  downloadMasteringConfigJsonFile,
  loadActiveMasteringConfigSnapshot,
  parseMasteringConfigJsonFile,
  saveActiveMasteringConfigSnapshot,
  type MasteringConfigurationFile,
} from '../engine/MasteringConfigStorage';
import {
  analyzeTrackAndComputeAdaptationAsync,
  recomputeDeltasForPreset,
} from '../engine/SpectralDeltaAnalyzer';
import { WebAudioMasteringEngine } from '../engine/WebAudioMasteringEngine';
import { SampleLabHandoff } from '../sampler/engine/SampleLabHandoff';
import {
  MASTERING_SESSIONS_MIGRATION_SQL,
  fetchMasteringSessionsHistory,
  fetchProjectAudioTracksForMastering,
  uploadAndSaveMasterSession,
  type ProjectAudioTrackItem,
} from '../services/supabaseMasteringService';
import type {
  AiCriticalEqPoint,
  AiFilterSuggestion,
  AudioMetrics,
  DrumHitEvent,
  DrumLayeringConfig,
  EQBandConfig,
  ExportQaReport,
  MasteringSessionRecord,
  SpectralAdaptationReport,
  StemBusRole,
  StemTrackState,
  StudioMasteringModuleProps,
  SurgicalOverrides,
} from '../types/mastering.types';
import { ABComparisonBar } from './ABComparisonBar';
import { AiMasteringAssistantPanel } from './AiMasteringAssistantPanel';
import { DrumLayeringRackPanel } from './DrumLayeringRackPanel';
import { DualSpectrumVisualizer } from './DualSpectrumVisualizer';
import { LoudnessMeterPanel } from './LoudnessMeterPanel';
import { MidSideSurgicalControls } from './MidSideSurgicalControls';
import { PresetSelectorGrid } from './PresetSelectorGrid';
import {
  SpectrogramHeatmapVisualizer,
  type ActiveFixMarker,
} from './SpectrogramHeatmapVisualizer';

const INITIAL_STEMS: StemTrackState[] = [
  {
    role: 'drums',
    label: '1. Drums & Perc',
    fileName: null,
    audioBuffer: null,
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
  },
  {
    role: 'bass',
    label: '2. Sub & Bass',
    fileName: null,
    audioBuffer: null,
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
  },
  {
    role: 'vocals',
    label: '3. Lead & BG Vocals',
    fileName: null,
    audioBuffer: null,
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
  },
  {
    role: 'other',
    label: '4. Guitars / Keys / Synths',
    fileName: null,
    audioBuffer: null,
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
  },
];

export const MasteringRack: React.FC<StudioMasteringModuleProps> = ({
  initialAudioUrl,
  initialTitle,
  songId: propSongId,
  onMasterSaved,
}) => {
  const navigate = useNavigate();
  const defaultPreset = PRO_PRESETS_CATALOG[0];
  const loadRequestIdRef = useRef(0);
  const initialSnapshotRef = useRef<MasteringConfigurationFile | null | undefined>(
    undefined
  );
  if (initialSnapshotRef.current === undefined) {
    initialSnapshotRef.current = loadActiveMasteringConfigSnapshot(propSongId);
  }
  const initialSnapshot = initialSnapshotRef.current;
  const initialPreset = initialSnapshot?.selectedPresetId
    ? getPresetById(initialSnapshot.selectedPresetId)
    : defaultPreset;

  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    initialPreset.id
  );
  const [intensityPct, setIntensityPct] = useState<number>(() => {
    const raw = initialSnapshot?.intensityPct;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 100;
  });
  const [overrides, setOverrides] = useState<SurgicalOverrides>(() => {
    const base = extractSurgicalOverridesFromPreset(initialPreset);
    if (!initialSnapshot?.surgicalOverrides) return base;
    return syncSurgicalOverridesEqBands({
      ...base,
      ...initialSnapshot.surgicalOverrides,
    });
  });

  const [trackTitle, setTrackTitle] = useState<string>(
    initialTitle || 'Sin pista cargada'
  );
  const [activeSongId, setActiveSongId] = useState<string | undefined>(
    propSongId
  );
  const [hasAudio, setHasAudio] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [durationSec, setDurationSec] = useState<number>(0);

  const [isBypassed, setIsBypassed] = useState<boolean>(false);
  const [isGainMatch, setIsGainMatch] = useState<boolean>(true);
  const [autoAdaptEnabled, setAutoAdaptEnabled] = useState<boolean>(
    initialSnapshot?.autoAdaptEnabled ?? true
  );
  const [adaptationReport, setAdaptationReport] =
    useState<SpectralAdaptationReport | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<{
    stage: string;
    pct: number;
  } | null>(null);
  const [isSavingCloud, setIsSavingCloud] = useState<boolean>(false);
  const [lastExportQa, setLastExportQa] = useState<ExportQaReport | null>(null);

  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Stems state
  const [stems, setStems] = useState<StemTrackState[]>(INITIAL_STEMS);
  const [kickBassSidechain, setKickBassSidechain] = useState<boolean>(
    initialSnapshot?.kickBassSidechain ?? true
  );
  const [isMixingStems, setIsMixingStems] = useState<boolean>(false);

  // Drum Layering & Custom Sample state
  const [detectedDrumHits, setDetectedDrumHits] = useState<DrumHitEvent[]>([]);
  const [customDrumSampleNames, setCustomDrumSampleNames] = useState<{
    kickName: string | null;
    snareName: string | null;
  }>({ kickName: null, snareName: null });

  // Project tracks & Sessions history
  const [projectTracks, setProjectTracks] = useState<ProjectAudioTrackItem[]>(
    []
  );
  const [sessionsHistory, setSessionsHistory] = useState<
    MasteringSessionRecord[]
  >([]);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [showSqlModal, setShowSqlModal] = useState<boolean>(false);
  const [visualizerView, setVisualizerView] = useState<
    'both' | 'fft' | 'heatmap'
  >('both');
  const [aiResetToken, setAiResetToken] = useState<number>(0);
  const [analyserNodes, setAnalyserNodes] = useState<{
    preAnalyser: AnalyserNode | null;
    postAnalyser: AnalyserNode | null;
  }>({ preAnalyser: null, postAnalyser: null });
  const configFileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPreset = useMemo(
    () => getPresetById(selectedPresetId),
    [selectedPresetId]
  );

  const effectiveDspChain = useMemo(() => {
    const deltas =
      autoAdaptEnabled && adaptationReport
        ? adaptationReport.deltaAdjustments
        : null;
    return buildEffectiveDspChain(
      selectedPreset,
      intensityPct,
      overrides,
      deltas
    );
  }, [selectedPreset, intensityPct, overrides, autoAdaptEnabled, adaptationReport]);

  const engineRef = useRef<WebAudioMasteringEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new WebAudioMasteringEngine(effectiveDspChain);
  }

  const [liveMetrics, setLiveMetrics] = useState<AudioMetrics>(() =>
    engineRef.current!.getLiveMetrics()
  );

  const syncAnalyserNodes = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const nodes = engine.getAnalyserNodesReadOnly();
    setAnalyserNodes((prev) =>
      prev.preAnalyser === nodes.preAnalyser &&
      prev.postAnalyser === nodes.postAnalyser
        ? prev
        : nodes
    );
  }, []);

  const buildCurrentConfigSnapshot = useCallback((): MasteringConfigurationFile => {
    const engine = engineRef.current;
    const makeupDb = engine
      ? engine.computeTargetMakeupGainDb(effectiveDspChain)
      : 0;
    return {
      schemaVersion: '1.0.0',
      savedAtIso: new Date().toISOString(),
      trackTitle,
      songId: activeSongId,
      selectedPresetId: selectedPreset.id,
      presetName: selectedPreset.name,
      intensityPct,
      autoAdaptEnabled,
      kickBassSidechain,
      autoMakeupGainDb: makeupDb,
      detectedInputLufs: adaptationReport?.detectedInputLufs ?? -16.5,
      surgicalOverrides: syncSurgicalOverridesEqBands(overrides),
      effectiveDspChain,
    };
  }, [
    effectiveDspChain,
    trackTitle,
    activeSongId,
    selectedPreset,
    intensityPct,
    autoAdaptEnabled,
    kickBassSidechain,
    adaptationReport,
    overrides,
  ]);

  // Sync DSP chain changes into live WebAudio graph + Auto-persist active configuration snapshot
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.applyDspChain(effectiveDspChain);
    setLiveMetrics(engine.getLiveMetrics());
    setDetectedDrumHits(engine.getDetectedDrumHits());
    saveActiveMasteringConfigSnapshot(buildCurrentConfigSnapshot());
  }, [effectiveDspChain, buildCurrentConfigSnapshot]);

  // Sync Bypass & Gain-Match into live WebAudio graph
  useEffect(() => {
    engineRef.current?.setBypassAndGainMatch(isBypassed, isGainMatch);
  }, [isBypassed, isGainMatch]);

  // Load project tracks & session history on mount
  useEffect(() => {
    const engine = engineRef.current!;
    engine.setOnPlaybackEnd(() => {
      setIsPlaying(false);
    });

    void fetchProjectAudioTracksForMastering().then(setProjectTracks);
    void fetchMasteringSessionsHistory(activeSongId).then(setSessionsHistory);

    // Check URL search params if opened via /mastering?audioUrl=...
    const params = new URLSearchParams(window.location.search);
    const urlFromQuery = params.get('audioUrl') || initialAudioUrl;
    const titleFromQuery = params.get('title') || initialTitle;
    const songIdFromQuery = params.get('songId') || propSongId;

    if (songIdFromQuery) {
      setActiveSongId(songIdFromQuery);
    }

    // Consume pending drum samples sent from Sample Lab
    const pendingDrums = SampleLabHandoff.consumePendingDrumSamples();
    if (pendingDrums.kick) {
      engine.setCustomDrumSampleFromBuffer(
        'kick',
        pendingDrums.kick.buffer,
        pendingDrums.kick.name
      );
    }
    if (pendingDrums.snare) {
      engine.setCustomDrumSampleFromBuffer(
        'snare',
        pendingDrums.snare.buffer,
        pendingDrums.snare.name
      );
    }
    if (pendingDrums.kick || pendingDrums.snare) {
      setCustomDrumSampleNames(engine.getCustomDrumSampleNames());
    }

    // Consume pending bounce sent from Sample Lab to master
    const pendingBounce = SampleLabHandoff.consumeBounceForMastering();
    if (pendingBounce) {
      const reqId = ++loadRequestIdRef.current;
      void (async () => {
        setIsAnalyzing(true);
        try {
          const { buffer, report: rep } = await engine.loadAudioBuffer(
            pendingBounce.buffer
          );
          if (reqId !== loadRequestIdRef.current) return;
          setTrackTitle(pendingBounce.title);
          if (pendingBounce.songId) setActiveSongId(pendingBounce.songId);
          setHasAudio(true);
          setDurationSec(buffer.duration);
          setCurrentTimeSec(0);
          setAdaptationReport(rep);
          setDetectedDrumHits(rep.detectedDrumHits);
          setLiveMetrics(engine.getLiveMetrics());
          syncAnalyserNodes();
          setStatusBanner({
            type: 'success',
            message: `"${pendingBounce.title}" recibido desde Sample Lab (${rep.detectedInputLufs} LUFS).`,
          });
        } finally {
          if (reqId === loadRequestIdRef.current) {
            setIsAnalyzing(false);
          }
        }
      })();
    }

    if (urlFromQuery) {
      void handleLoadAudioUrl(
        urlFromQuery,
        titleFromQuery || 'Pista del Proyecto'
      );
    } else if (!pendingBounce) {
      // Auto-generate studio reference track on initial boot so user can audition immediately
      void handleGenerateDemoTrack(true);
    }

    return () => {
      engine.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Throttled UI Telemetry Loop (~15Hz state updates while canvas renders 60fps directly via refs)
  useEffect(() => {
    let rafId = 0;
    let frameCount = 0;

    const tick = () => {
      const engine = engineRef.current;
      frameCount++;
      if (engine) {
        if (engine.getIsPlaying() && frameCount % 4 === 0) {
          setCurrentTimeSec(engine.getCurrentTimeSec());
        }
        if (frameCount % 5 === 0) {
          setLiveMetrics(engine.getLiveMetrics());
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const togglePlayRef = useRef<() => void>(() => {});

  // Keyboard shortcuts (Space = Play/Pause, B = Bypass toggle) - bound strictly ONCE on mount
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayRef.current();
      } else if (e.key === 'b' || e.key === 'B') {
        setIsBypassed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const applyPresetSelection = useCallback(
    (presetId: string, currentReport?: SpectralAdaptationReport | null) => {
      const preset = getPresetById(presetId);
      setSelectedPresetId(preset.id);
      setOverrides(extractSurgicalOverridesFromPreset(preset));
      const rep = currentReport ?? adaptationReport;
      if (rep) {
        setAdaptationReport(recomputeDeltasForPreset(rep, preset));
      }
    },
    [adaptationReport]
  );

  const handleFileSelected = async (file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    const reqId = ++loadRequestIdRef.current;
    try {
      setIsAnalyzing(true);
      setStatusBanner({
        type: 'info',
        message: `Decodificando y escaneando "${file.name}" en 32-bit float...`,
      });
      const { buffer, report } = await engine.loadAudioFile(file);
      if (reqId !== loadRequestIdRef.current) return;
      setTrackTitle(file.name);
      setHasAudio(true);
      setDurationSec(buffer.duration);
      setCurrentTimeSec(0);
      setAdaptationReport(report);
      setDetectedDrumHits(report.detectedDrumHits);
      setLastExportQa(null);
      setLiveMetrics(engine.getLiveMetrics());
      syncAnalyserNodes();
      setStatusBanner({
        type: 'success',
        message: `Análisis completado (${report.detectedInputLufs} LUFS, ${report.detectedTruePeakDb} dBTP). Preset recomendado: ${getPresetById(report.recommendedPresetId).name}.`,
      });
    } catch (err) {
      if (reqId !== loadRequestIdRef.current) return;
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Error al decodificar el archivo de audio.',
      });
    } finally {
      if (reqId === loadRequestIdRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  const handleLoadAudioUrl = async (url: string, title: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const reqId = ++loadRequestIdRef.current;
    try {
      setIsAnalyzing(true);
      setStatusBanner({
        type: 'info',
        message: `Cargando pista "${title}" desde el proyecto...`,
      });
      const { buffer, report } = await engine.loadAudioFromUrl(url);
      if (reqId !== loadRequestIdRef.current) return;
      setTrackTitle(title);
      setHasAudio(true);
      setDurationSec(buffer.duration);
      setCurrentTimeSec(0);
      setAdaptationReport(report);
      setDetectedDrumHits(report.detectedDrumHits);
      setLastExportQa(null);
      setLiveMetrics(engine.getLiveMetrics());
      syncAnalyserNodes();
      setStatusBanner({
        type: 'success',
        message: `"${title}" lista en el rack (${report.detectedInputLufs} LUFS).`,
      });
    } catch (err) {
      if (reqId !== loadRequestIdRef.current) return;
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el audio remoto.',
      });
    } finally {
      if (reqId === loadRequestIdRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  const handleGenerateDemoTrack = async (silent = false) => {
    const engine = engineRef.current;
    if (!engine) return;
    const reqId = ++loadRequestIdRef.current;
    try {
      setIsAnalyzing(true);
      const { buffer, report } = await engine.generateStudioDemoTrack();
      if (reqId !== loadRequestIdRef.current) return;
      setTrackTitle('Zitio Studio Reference Mix (118 BPM Stereo)');
      setHasAudio(true);
      setDurationSec(buffer.duration);
      setCurrentTimeSec(0);
      setAdaptationReport(report);
      setDetectedDrumHits(report.detectedDrumHits);
      setLastExportQa(null);
      setLiveMetrics(engine.getLiveMetrics());
      syncAnalyserNodes();
      if (!silent) {
        setStatusBanner({
          type: 'success',
          message:
            'Pista de referencia generada en 32-bit float. Presiona Play para probar los presets y el modo A/B.',
        });
      }
    } finally {
      if (reqId === loadRequestIdRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  const handleTogglePlay = () => {
    const engine = engineRef.current;
    if (!engine || !hasAudio) return;
    if (engine.getIsPlaying()) {
      engine.pause();
      setIsPlaying(false);
    } else {
      void engine.play().then(() => {
        syncAnalyserNodes();
        setIsPlaying(true);
      });
    }
  };
  togglePlayRef.current = handleTogglePlay;

  const handleStop = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.stop();
    setIsPlaying(false);
    setCurrentTimeSec(0);
  };

  const handleSeek = (sec: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.seek(sec);
    setCurrentTimeSec(sec);
  };

  const handleRunAiAnalysis = async () => {
    const engine = engineRef.current;
    const buffer = engine?.getAudioBuffer();
    if (!buffer && !adaptationReport) return;

    setIsAnalyzing(true);
    try {
      const freshReport = buffer
        ? await analyzeTrackAndComputeAdaptationAsync(buffer, selectedPresetId)
        : adaptationReport!;
      setAdaptationReport(freshReport);

      const recPreset = getPresetById(freshReport.recommendedPresetId);
      setSelectedPresetId(recPreset.id);

      const baseOverrides = extractSurgicalOverridesFromPreset(recPreset);
      const comp = freshReport.compressionSuggestion;
      const stereo = freshReport.stereoWidthSuggestion;

      const nextOverrides: SurgicalOverrides = {
        ...baseOverrides,
        compressorThresholdDb: comp.thresholdDb,
        compressorRatio: comp.ratio,
        compressorAttackMs: comp.attackMs,
        compressorReleaseMs: comp.releaseMs,
        compressorKneeDb: comp.kneeDb,
        compressorGlueMixPct: comp.parallelMixPct,
        stereoWidthPct: stereo.recommendedWidthPct,
        monoMakerFreq: stereo.recommendedMonoMakerHz,
        sideAirBoostDb: stereo.recommendedSideAirDb,
      };

      for (const filter of freshReport.filterSuggestions) {
        if (filter.isRecommended) {
          Object.assign(nextOverrides, filter.patchOverrides);
        }
      }

      setOverrides(syncSurgicalOverridesEqBands(nextOverrides));
      setIsBypassed(false);
      setAutoAdaptEnabled(true);
      setStatusBanner({
        type: 'success',
        message: `Diagnóstico espectral completado: Preset "${recPreset.name}", ${freshReport.criticalEqPoints.length} puntos de EQ, Compresión (${comp.ratio}:1) y Amplitud (${stereo.recommendedWidthPct}%) calibrados.`,
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyCriticalPoint = (point: AiCriticalEqPoint) => {
    setIsBypassed(false);
    setOverrides((prev) => {
      const next = { ...prev };
      if (point.bandId === 'mid-sub-punch') {
        next.midLowPunchDb = point.recommendedGainDb;
      } else if (point.bandId === 'stereo-mud-cut') {
        next.stereoMudCutDb = point.recommendedGainDb;
      } else if (point.bandId === 'mid-vocal-bite') {
        next.midPresenceDb = point.recommendedGainDb;
      } else if (point.bandId === 'stereo-de-harsh') {
        next.deHarshnessCutDb = point.recommendedGainDb;
      } else if (point.bandId === 'stereo-sibilance') {
        next.sibilanceCutDb = point.recommendedGainDb;
        next.sibilanceFreqHz = point.freqHz;
      } else if (point.bandId === 'side-air-shelf') {
        next.sideAirBoostDb = point.recommendedGainDb;
      }

      next.customEqBands = prev.customEqBands.map((b) =>
        b.id === point.bandId
          ? {
              ...b,
              freq: point.freqHz,
              gainDb: point.recommendedGainDb,
              q: point.recommendedQ,
              enabled: true,
            }
          : b
      );
      return syncSurgicalOverridesEqBands(next);
    });

    setStatusBanner({
      type: 'success',
      message: `Punto crítico aplicado: ${point.title} (${
        point.recommendedGainDb > 0 ? '+' : ''
      }${point.recommendedGainDb} dB @ ${point.freqHz} Hz).`,
    });
  };

  const handleApplyFilterSuggestion = (suggestion: AiFilterSuggestion) => {
    setIsBypassed(false);
    setOverrides((prev) =>
      syncSurgicalOverridesEqBands({
        ...prev,
        ...suggestion.patchOverrides,
      })
    );
    setStatusBanner({
      type: 'success',
      message: `Filtro activado: ${suggestion.name}.`,
    });
  };

  const handleApplyAiCompression = () => {
    if (!adaptationReport) return;
    setIsBypassed(false);
    const c = adaptationReport.compressionSuggestion;
    setOverrides((prev) => ({
      ...prev,
      compressorThresholdDb: c.thresholdDb,
      compressorRatio: c.ratio,
      compressorAttackMs: c.attackMs,
      compressorReleaseMs: c.releaseMs,
      compressorKneeDb: c.kneeDb,
      compressorGlueMixPct: c.parallelMixPct,
    }));
    setStatusBanner({
      type: 'success',
      message: `Compresión IA "${c.profileName}" aplicada (${c.ratio}:1, Attack ${c.attackMs}ms, Release ${c.releaseMs}ms).`,
    });
  };

  const handleApplyAiStereoWidth = () => {
    if (!adaptationReport) return;
    setIsBypassed(false);
    const s = adaptationReport.stereoWidthSuggestion;
    setOverrides((prev) =>
      syncSurgicalOverridesEqBands({
        ...prev,
        stereoWidthPct: s.recommendedWidthPct,
        monoMakerFreq: s.recommendedMonoMakerHz,
        sideAirBoostDb: s.recommendedSideAirDb,
      })
    );
    setStatusBanner({
      type: 'success',
      message: `Amplitud Estéreo IA aplicada (${s.recommendedWidthPct}% Width, Mono Maker @ ${s.recommendedMonoMakerHz} Hz).`,
    });
  };

  const handleUpdateCustomEqBand = (
    bandId: string,
    patch: Partial<EQBandConfig>
  ) => {
    setIsBypassed(false);
    setOverrides((prev) => {
      const next: SurgicalOverrides = {
        ...prev,
        customEqBands: prev.customEqBands.map((b) =>
          b.id === bandId ? { ...b, ...patch } : b
        ),
      };
      if (patch.gainDb !== undefined) {
        if (bandId === 'mid-sub-punch') next.midLowPunchDb = patch.gainDb;
        else if (bandId === 'stereo-mud-cut') next.stereoMudCutDb = patch.gainDb;
        else if (bandId === 'mid-vocal-bite') next.midPresenceDb = patch.gainDb;
        else if (bandId === 'stereo-de-harsh')
          next.deHarshnessCutDb = patch.gainDb;
        else if (bandId === 'stereo-sibilance')
          next.sibilanceCutDb = patch.gainDb;
        else if (bandId === 'side-air-shelf') next.sideAirBoostDb = patch.gainDb;
      }
      if (patch.freq !== undefined && bandId === 'stereo-sibilance') {
        next.sibilanceFreqHz = patch.freq;
      }
      return syncSurgicalOverridesEqBands(next);
    });
  };

  const handleChangeOverride = <K extends keyof SurgicalOverrides>(
    key: K,
    value: SurgicalOverrides[K]
  ) => {
    setIsBypassed(false);
    setOverrides((prev) => {
      const next: SurgicalOverrides = {
        ...prev,
        [key]: value,
      };
      return syncSurgicalOverridesEqBands(next);
    });
  };

  const handleStartBandPassSolo = useCallback(
    (freqHz: number, qFactor: number) => {
      engineRef.current?.startBandPassSolo(freqHz, qFactor);
    },
    []
  );

  const handleUpdateBandPassSolo = useCallback(
    (freqHz: number, qFactor: number) => {
      engineRef.current?.updateBandPassSolo(freqHz, qFactor);
    },
    []
  );

  const handleStopBandPassSolo = useCallback(() => {
    engineRef.current?.stopBandPassSolo();
  }, []);

  const handleChangeDrumConfig = useCallback((nextDrum: DrumLayeringConfig) => {
    setOverrides((prev) => ({
      ...prev,
      drumLayering: nextDrum,
    }));
  }, []);

  const handleLoadCustomDrumSample = useCallback(
    async (type: 'kick' | 'snare', file: File) => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        const name = await engine.loadCustomDrumSample(type, file);
        setCustomDrumSampleNames(engine.getCustomDrumSampleNames());
        setStatusBanner({
          type: 'success',
          message: `Sample acústico 24-bit "${name}" cargado en canal ${type.toUpperCase()}.`,
        });
      } catch {
        setStatusBanner({
          type: 'error',
          message: `No se pudo decodificar el sample "${file.name}".`,
        });
      }
    },
    []
  );

  const handleClearCustomDrumSample = useCallback((type: 'kick' | 'snare') => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.clearCustomDrumSample(type);
    setCustomDrumSampleNames(engine.getCustomDrumSampleNames());
    setStatusBanner({
      type: 'info',
      message: `Sample de ${type.toUpperCase()} restaurado al sintetizador físico de estudio.`,
    });
  }, []);

  const handleToggleResonanceNotchAtFreq = useCallback((freqHz: number) => {
    const clampedFreq = Math.max(80, Math.min(18000, Math.round(freqHz)));
    setOverrides((prev) => {
      const existingIdx = prev.resonanceNotches.findIndex(
        (n) => Math.abs(n.freqHz - clampedFreq) / Math.max(20, n.freqHz) < 0.045
      );
      if (existingIdx >= 0) {
        const removed = prev.resonanceNotches[existingIdx];
        setStatusBanner({
          type: 'info',
          message: `Filtro Line Killer Q=12 eliminado en ${removed.freqHz} Hz.`,
        });
        return {
          ...prev,
          resonanceNotches: prev.resonanceNotches.filter(
            (_, idx) => idx !== existingIdx
          ),
        };
      }

      const newNode = {
        id: `manual-notch-${clampedFreq}-${Date.now()}`,
        freqHz: clampedFreq,
        gainCutDb: -4.5,
        q: 12.0,
        label: `Manual Line Killer ${clampedFreq}Hz`,
        enabled: true,
        source: 'user-clicked' as const,
      };

      const nextList = [...prev.resonanceNotches, newNode]
        .slice(-6)
        .sort((a, b) => a.freqHz - b.freqHz);

      setStatusBanner({
        type: 'success',
        message: `Filtro Quirúrgico Line Killer (Q=12, -4.5 dB) insertado en ${clampedFreq} Hz para disolver línea horizontal.`,
      });

      return {
        ...prev,
        resonanceNotches: nextList,
      };
    });
  }, []);

  const handleLoadStemFile = async (role: StemBusRole, file: File) => {
    try {
      const arrayBuf = await file.arrayBuffer();
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const tempCtx = new AudioCtx({ sampleRate: 48000 });
      try {
        const decoded = await tempCtx.decodeAudioData(arrayBuf.slice(0));
        setStems((prev) =>
          prev.map((s) =>
            s.role === role
              ? { ...s, fileName: file.name, audioBuffer: decoded }
              : s
          )
        );
        setStatusBanner({
          type: 'info',
          message: `Stem "${file.name}" cargado en bus ${role.toUpperCase()}.`,
        });
      } finally {
        void tempCtx.close();
      }
    } catch {
      setStatusBanner({
        type: 'error',
        message: `No se pudo decodificar el stem "${file.name}".`,
      });
    }
  };

  const handleUpdateStemState = (
    role: StemBusRole,
    patch: Partial<StemTrackState>
  ) => {
    setStems((prev) =>
      prev.map((s) => (s.role === role ? { ...s, ...patch } : s))
    );
  };

  const handleMixStemsToMaster = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const reqId = ++loadRequestIdRef.current;
    try {
      setIsMixingStems(true);
      const { buffer, report } = await engine.mixStemsIntoMasteringBuffer(
        stems,
        kickBassSidechain
      );
      if (reqId !== loadRequestIdRef.current) return;
      setTrackTitle('Stem Mix Bus (Sidechain Bombo→Bajo Activo)');
      setHasAudio(true);
      setDurationSec(buffer.duration);
      setCurrentTimeSec(0);
      setAdaptationReport(report);
      setLastExportQa(null);
      setLiveMetrics(engine.getLiveMetrics());
      syncAnalyserNodes();
      setStatusBanner({
        type: 'success',
        message:
          'Stems sumados con Sidechain Bombo→Bajo e inyectados en la cadena Mid/Side.',
      });
    } catch (err) {
      if (reqId !== loadRequestIdRef.current) return;
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Error al mezclar los Stems.',
      });
    } finally {
      setIsMixingStems(false);
    }
  };

  const handleExportConfigFile = () => {
    const snapshot = saveActiveMasteringConfigSnapshot(
      buildCurrentConfigSnapshot()
    );
    downloadMasteringConfigJsonFile(snapshot);
    setStatusBanner({
      type: 'success',
      message: `Configuración activa de Mastering Pro guardada en archivo "${snapshot.selectedPresetId}.mastering.json".`,
    });
  };

  const handleImportConfigFile = async (file: File) => {
    try {
      const parsed = await parseMasteringConfigJsonFile(file);
      setSelectedPresetId(parsed.selectedPresetId);
      setIntensityPct(parsed.intensityPct ?? 100);
      setAutoAdaptEnabled(parsed.autoAdaptEnabled ?? true);
      setKickBassSidechain(parsed.kickBassSidechain ?? true);
      setOverrides(syncSurgicalOverridesEqBands(parsed.surgicalOverrides));
      setIsBypassed(false);
      saveActiveMasteringConfigSnapshot(parsed);
      setStatusBanner({
        type: 'success',
        message: `Configuración "${parsed.presetName}" cargada y aplicada al motor DSP y al exportador.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo leer el archivo de configuración.',
      });
    }
  };

  const handleOpenInSampleLab = () => {
    const buffer = engineRef.current?.getAudioBuffer();
    if (buffer) {
      SampleLabHandoff.sendAudioToSampleLab({
        buffer,
        title: trackTitle,
        songId: activeSongId,
        origin: 'mastering-buffer',
      });
    }
    navigate('/sample-lab');
  };

  const handleExportWav24 = async () => {
    const engine = engineRef.current;
    if (!engine || !hasAudio) return;
    try {
      setIsExporting(true);
      setIsBypassed(false);

      // Snapshot inmutable en memoria (sin round-trip por localStorage como fuente de verdad)
      const snapshot = saveActiveMasteringConfigSnapshot(
        buildCurrentConfigSnapshot()
      );

      const result = await engine.exportMasterToWav24Bit(
        (stage, pct) => {
          setExportProgress({ stage, pct });
        },
        snapshot.effectiveDspChain,
        snapshot.autoMakeupGainDb
      );

      setLastExportQa(result.qaReport);

      const cleanName =
        trackTitle.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_') ||
        'Master';
      const downloadName = `${cleanName}_${selectedPreset.id}_24bit_48kHz.wav`;

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      const qa = result.qaReport;
      setStatusBanner({
        type: qa.grBudgetExceeded ? 'info' : 'success',
        message: `Master WAV 24-Bit / 48kHz exportado (${(
          result.blob.size /
          (1024 * 1024)
        ).toFixed(1)} MB · Out: ${qa.outputLufs.toFixed(1)} LUFS · True Peak: ${qa.finalTruePeakDbTp.toFixed(2)} dBTP · Lim GR: -${qa.maxLimiterReductionDb.toFixed(1)}dB · Clips: ${qa.clippedSamples}).${qa.grBudgetWarning ? ` Aviso: ${qa.grBudgetWarning}` : ''}`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Error durante la exportación WAV de 24-bits.',
      });
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const handleSaveToCloud = async () => {
    const engine = engineRef.current;
    if (!engine || !hasAudio) return;
    try {
      setIsSavingCloud(true);
      setIsBypassed(false);
      setStatusBanner({
        type: 'info',
        message:
          'Renderizando Master WAV 24-Bit verificado (2 pasadas) y subiendo a Supabase Storage...',
      });

      const snapshot = saveActiveMasteringConfigSnapshot(
        buildCurrentConfigSnapshot()
      );

      const renderRes = await engine.exportMasterToWav24Bit(
        (stage, pct) => {
          setExportProgress({ stage, pct });
        },
        snapshot.effectiveDspChain,
        snapshot.autoMakeupGainDb
      );

      setLastExportQa(renderRes.qaReport);

      const savedRecord = await uploadAndSaveMasterSession({
        wavBlob: renderRes.blob,
        trackTitle,
        songId: activeSongId,
        presetId: selectedPreset.id,
        presetName: selectedPreset.name,
        intensityPct,
        targetLufs: overrides.targetLufs,
        inputLufs: renderRes.qaReport.inputLufs,
        outputLufs: renderRes.qaReport.outputLufs,
        truePeakDbTp: renderRes.qaReport.finalTruePeakDbTp,
        phaseCorrelation: renderRes.qaReport.phaseCorrelation,
        durationSeconds: renderRes.durationSec,
        sampleRate: renderRes.sampleRate,
        dspSnapshot: snapshot.effectiveDspChain,
        surgicalOverrides: snapshot.surgicalOverrides,
      });

      setSessionsHistory((prev) => [savedRecord, ...prev]);
      onMasterSaved?.(savedRecord);

      setStatusBanner({
        type: 'success',
        message: `Master 24-Bit guardado en Cloud (${savedRecord.preset_name} · ${renderRes.qaReport.outputLufs.toFixed(1)} LUFS · ${renderRes.qaReport.finalTruePeakDbTp.toFixed(2)} dBTP).`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Error guardando la sesión en Supabase.',
      });
    } finally {
      setIsSavingCloud(false);
      setExportProgress(null);
    }
  };

  const getVisualSnapshot = useCallback(() => {
    return (
      engineRef.current?.getVisualSnapshot() ?? {
        preBins: new Uint8Array(2048),
        postBins: new Uint8Array(2048),
        waveformPeaks: new Float32Array(240),
        sampleRate: 48000,
      }
    );
  }, []);

  const getLiveCurrentTimeSec = useCallback(() => {
    return engineRef.current?.getCurrentTimeSec() ?? 0;
  }, []);

  const aiFixMarkers = useMemo<ActiveFixMarker[]>(() => {
    return effectiveDspChain.eqBands
      .filter((band) => Math.abs(band.gainDb) >= 0.25)
      .map((band) => ({
        id: band.id,
        freqHz: band.freq,
        gainCutDb: band.gainDb,
        label: band.label,
        active: band.enabled !== false,
      }));
  }, [effectiveDspChain.eqBands]);

  return (
    <div className="w-full h-full overflow-y-auto studio-scrollbar-light bg-[#f4f7fb] text-slate-900 py-4 md:py-5 select-none">
      <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 2xl:px-10 mx-auto flex flex-col gap-5 pb-12">
        {/* Top Studio Hardware Rack Header */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 32 }}
          className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 rounded-2xl mastering-surface backdrop-blur-xl"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#0284c7] to-[#38bdf8] p-[1.5px] shadow-[0_6px_18px_rgba(14,165,233,0.22)] shrink-0">
              <div className="w-full h-full bg-white rounded-[14.5px] flex items-center justify-center">
                <Cpu size={20} className="text-sky-600" />
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[16px] font-bold tracking-tight text-slate-900">
                  Studio Mastering Pro
                </h1>
                <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700">
                  32-BIT FLOAT DSP · 24-BIT WAV
                </span>
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
                  M/S MATRIX + 4X OVERSAMPLING
                </span>
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-semibold">
                  ● CONFIG SINCRONIZADA 1:1 CON EXPORTADOR
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Suite de masterización inteligente con curva ITU-R BS.1770-4, Mono Maker Butterworth y Limitador Lookahead True Peak.
              </p>
            </div>
          </div>

          {/* Right Quick Actions: Save/Load Config, Load from Project, History, SQL Schema */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={configFileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportConfigFile(f);
                e.target.value = '';
              }}
            />

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={handleOpenInSampleLab}
              className="h-9 px-3.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-300 text-xs font-semibold text-sky-700 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Abrir Sample Lab (/sample-lab) para cortar, editar y crear sonidos desde esta pista"
            >
              <Grid size={13.5} className="text-sky-600" />
              <span>Sample Lab</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={handleExportConfigFile}
              className="h-9 px-3 rounded-xl bg-white hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-xs font-medium text-slate-700 hover:text-sky-800 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              title="Guardar toda la configuración actual del módulo en un archivo .mastering.json"
            >
              <Save size={13} className="text-sky-600" />
              <span>Guardar Config (.json)</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => configFileInputRef.current?.click()}
              className="h-9 px-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              title="Cargar un archivo .mastering.json con configuraciones guardadas"
            >
              <Upload size={13} className="text-sky-600" />
              <span>Cargar Config</span>
            </motion.button>

            {projectTracks.length > 0 && (
              <div className="h-9 flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 shadow-2xs">
                <FolderOpen size={13} className="text-sky-600 shrink-0" />
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const item = projectTracks.find(
                      (t) => t.id === e.target.value
                    );
                    if (item) {
                      setActiveSongId(item.songId);
                      void handleLoadAudioUrl(
                        item.fileUrl,
                        `${item.songTitle} - ${item.stemName}`
                      );
                    }
                  }}
                  className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none max-w-[210px] cursor-pointer"
                >
                  <option value="" disabled className="bg-white">
                    Cargar pista de tu Proyecto...
                  </option>
                  {projectTracks.map((t) => (
                    <option
                      key={t.id}
                      value={t.id}
                      className="bg-white text-slate-800"
                    >
                      {t.songTitle} · {t.stemName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setShowHistoryModal(true)}
              className="h-9 px-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            >
              <History size={13} className="text-blue-600" />
              <span>Historial ({sessionsHistory.length})</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setShowSqlModal(true)}
              className="h-9 px-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              title="Ver script SQL de migración para Supabase"
            >
              <Database size={13} className="text-sky-600" />
              <span>SQL Schema</span>
            </motion.button>
          </div>
        </motion.div>

        {/* Status Notification / Offline Render Progress Bar */}
        <AnimatePresence initial={false}>
          {(statusBanner || exportProgress) && (
            <motion.div
              key="mastering-status-banner"
              initial={{ opacity: 0, y: -6, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="rounded-xl mastering-surface px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
            >
              {exportProgress ? (
                <div className="w-full flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-mono text-sky-700 font-semibold">
                    <span>{exportProgress.stage}</span>
                    <span>{exportProgress.pct}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#0284c7] to-[#38bdf8] transition-all duration-150"
                      style={{ width: `${exportProgress.pct}%` }}
                    />
                  </div>
                </div>
              ) : (
                statusBanner && (
                  <>
                    <div className="flex items-center gap-2.5 text-xs">
                      {statusBanner.type === 'error' ? (
                        <AlertCircle size={15} className="text-rose-600 shrink-0" />
                      ) : (
                        <CheckCircle2
                          size={15}
                          className="text-sky-600 shrink-0"
                        />
                      )}
                      <span className="text-slate-800 font-medium">
                        {statusBanner.message}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStatusBanner(null)}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 1. Top Transport & A/B Comparison + Gain-Match + Target LUFS Bar */}
        <ABComparisonBar
          trackTitle={trackTitle}
          hasAudio={hasAudio}
          isPlaying={isPlaying}
          currentTimeSec={currentTimeSec}
          durationSec={durationSec}
          isBypassed={isBypassed}
          isGainMatch={isGainMatch}
          targetLufs={overrides.targetLufs}
          autoAdaptEnabled={autoAdaptEnabled}
          isAnalyzing={isAnalyzing}
          isExporting={isExporting}
          isSavingCloud={isSavingCloud}
          onTogglePlay={handleTogglePlay}
          onStop={handleStop}
          onFileSelected={handleFileSelected}
          onLoadDemoTrack={() => void handleGenerateDemoTrack(false)}
          onRunAiAnalysis={() => void handleRunAiAnalysis()}
          onToggleBypass={(bypass) => setIsBypassed(bypass)}
          onToggleGainMatch={() => setIsGainMatch((g) => !g)}
          onSelectTargetLufs={(lufs) =>
            handleChangeOverride('targetLufs', lufs)
          }
          onToggleAutoAdapt={() => setAutoAdaptEnabled((a) => !a)}
          onExportWav24={() => void handleExportWav24()}
          onSaveToCloud={() => void handleSaveToCloud()}
        />

        {/* 2. Main Visual & Metering Grid */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Modo de Monitoreo Espectral y Diagnóstico RX
          </span>
          <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1">
            {[
              { id: 'both' as const, label: 'Vista Dual (FFT + RX Heatmap)' },
              { id: 'heatmap' as const, label: 'Solo RX Spectral Heatmap 3D' },
              { id: 'fft' as const, label: 'Solo Analizador FFT Dual' },
            ].map((tab) => {
              const active = visualizerView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setVisualizerView(tab.id)}
                  className={`relative z-10 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'text-white font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="mastering-visualizer-view-pill"
                      transition={{
                        type: 'spring',
                        stiffness: 450,
                        damping: 34,
                        mass: 0.75,
                      }}
                      className="absolute inset-0 rounded-lg bg-[#0284c7] shadow-xs -z-10"
                    />
                  )}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
          <div className="xl:col-span-8 2xl:col-span-9 flex flex-col gap-5">
            {(visualizerView === 'both' || visualizerView === 'fft') && (
              <DualSpectrumVisualizer
                getVisualSnapshot={getVisualSnapshot}
                dspChain={effectiveDspChain}
                isPlaying={isPlaying}
                isBypassed={isBypassed}
                currentTimeSec={currentTimeSec}
                durationSec={durationSec}
                getCurrentTimeSec={getLiveCurrentTimeSec}
                onSeek={handleSeek}
              />
            )}

            {(visualizerView === 'both' || visualizerView === 'heatmap') && (
              <SpectrogramHeatmapVisualizer
                preAnalyserNode={analyserNodes.preAnalyser}
                postAnalyserNode={analyserNodes.postAnalyser}
                isPlaying={isPlaying}
                hasAudioLoaded={hasAudio}
                monoMakerFreqHz={effectiveDspChain.monoMakerFreq}
                aiFixMarkers={aiFixMarkers}
                resonanceNotches={effectiveDspChain.resonanceNotches}
                onToggleResonanceNotchAtFreq={handleToggleResonanceNotchAtFreq}
                onStartBandPassSolo={handleStartBandPassSolo}
                onUpdateBandPassSolo={handleUpdateBandPassSolo}
                onStopBandPassSolo={handleStopBandPassSolo}
                height={visualizerView === 'heatmap' ? 390 : 300}
              />
            )}
          </div>

          <div className="xl:col-span-4 2xl:col-span-3">
            <LoudnessMeterPanel
              metrics={liveMetrics}
              targetLufs={overrides.targetLufs}
              ceilingDbTp={overrides.ceilingDbTp}
              monoMakerFreq={overrides.monoMakerFreq}
              lastExportQa={lastExportQa}
            />
          </div>
        </div>

        {/* 2.5. AI Master Assistant & Customizer Panel */}
        <AiMasteringAssistantPanel
          report={adaptationReport}
          overrides={overrides}
          isAnalyzing={isAnalyzing}
          resetToken={aiResetToken}
          onRunFullAiOptimization={() => void handleRunAiAnalysis()}
          onApplyCriticalPoint={handleApplyCriticalPoint}
          onApplyFilterSuggestion={handleApplyFilterSuggestion}
          onApplyAiCompression={handleApplyAiCompression}
          onApplyAiStereoWidth={handleApplyAiStereoWidth}
          onChangeOverride={handleChangeOverride}
          onUpdateCustomEqBand={handleUpdateCustomEqBand}
        />

        {/* 2.75. Acoustic Drum Re-Synthesis & Analog Restorer Rack */}
        <DrumLayeringRackPanel
          drumConfig={overrides.drumLayering}
          forensicConfig={overrides.forensicHumanizer}
          detectedHits={detectedDrumHits}
          currentTimeSec={currentTimeSec}
          durationSec={durationSec}
          isPlaying={isPlaying}
          inputSpectralProfile={liveMetrics.spectralBalance}
          detectedPhaseCorrelation={
            adaptationReport?.detectedPhaseCorrelation ??
            (Number.isFinite(liveMetrics.phaseCorrelation)
              ? liveMetrics.phaseCorrelation
              : 0.85)
          }
          baselineForensicReport={adaptationReport?.forensicSignature}
          customSampleNames={customDrumSampleNames}
          onChangeDrumConfig={handleChangeDrumConfig}
          onChangeForensicConfig={(nextForensic) =>
            handleChangeOverride('forensicHumanizer', nextForensic)
          }
          onLoadCustomSample={(type, file) =>
            void handleLoadCustomDrumSample(type, file)
          }
          onClearCustomSample={handleClearCustomDrumSample}
        />

        {/* 3. 6 Pro Presets Grid + Macro Intensity Slider (0% - 150%) */}
        <PresetSelectorGrid
          presets={PRO_PRESETS_CATALOG}
          selectedPresetId={selectedPresetId}
          recommendedPresetId={adaptationReport?.recommendedPresetId}
          intensityPct={intensityPct}
          adaptationReport={adaptationReport}
          onSelectPreset={(id) => applyPresetSelection(id)}
          onChangeIntensity={setIntensityPct}
        />

        {/* 4. Surgical Mid/Side Controls & Stem Mastering Bus */}
        <MidSideSurgicalControls
          overrides={overrides}
          stems={stems}
          kickBassSidechain={kickBassSidechain}
          isMixingStems={isMixingStems}
          onChangeOverride={handleChangeOverride}
          onResetToPreset={() => {
            setOverrides(extractSurgicalOverridesFromPreset(selectedPreset));
            setAiResetToken((t) => t + 1);
          }}
          onLoadStemFile={(role, file) => void handleLoadStemFile(role, file)}
          onUpdateStemState={handleUpdateStemState}
          onToggleKickBassSidechain={() => setKickBassSidechain((v) => !v)}
          onMixStemsToMaster={() => void handleMixStemsToMaster()}
        />
      </div>

      {/* Modal: Sessions History */}
      <AnimatePresence>
        {showHistoryModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl flex flex-col gap-4 max-h-[80vh]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <History size={18} className="text-sky-600" />
                  <h3 className="text-sm font-semibold tracking-tight text-slate-900">
                    Historial de Masters 24-Bit WAV
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(false)}
                  className="text-slate-400 hover:text-slate-800 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="overflow-y-auto space-y-2.5 pr-1">
                {sessionsHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 py-8 text-center font-mono">
                    Aún no hay sesiones guardadas. Usa el botón "Guardar Cloud" para registrar tu primer Master 24-bit.
                  </p>
                ) : (
                  sessionsHistory.map((item) => (
                    <div
                      key={item.id || item.created_at}
                      className="rounded-xl mastering-subpanel p-3.5 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-semibold text-slate-900">
                          {item.track_title}
                        </div>
                        <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                          Preset: <span className="text-sky-700 font-semibold">{item.preset_name}</span> ({item.intensity_pct}%) · Out: {item.output_lufs} LUFS · {item.true_peak_dbtp} dBTP
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {item.master_wav_url && (
                          <a
                            href={item.master_wav_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-xs font-mono font-semibold flex items-center gap-1"
                          >
                            <Download size={12} />
                            WAV 24-Bit
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal: SQL Migration Script */}
      <AnimatePresence>
        {showSqlModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl flex flex-col gap-3 max-h-[82vh]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <Database size={18} className="text-sky-600" />
                  <h3 className="text-sm font-semibold tracking-tight text-slate-900">
                    Migración SQL Supabase (`mastering_sessions` + Bucket `masters`)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSqlModal(false)}
                  className="text-slate-400 hover:text-slate-800 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <pre className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-800 overflow-x-auto overflow-y-auto">
                {MASTERING_SESSIONS_MIGRATION_SQL}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const StudioMasteringModule = MasteringRack;
export default StudioMasteringModule;
