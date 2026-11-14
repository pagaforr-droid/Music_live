import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cpu,
  History,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Database,
  Download,
  X,
} from 'lucide-react';
import {
  PRO_PRESETS_CATALOG,
  buildEffectiveDspChain,
  extractSurgicalOverridesFromPreset,
  getPresetById,
} from '../presets/proPresetsCatalog';
import {
  analyzeTrackAndComputeAdaptation,
  recomputeDeltasForPreset,
} from '../engine/SpectralDeltaAnalyzer';
import { WebAudioMasteringEngine } from '../engine/WebAudioMasteringEngine';
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
  const defaultPreset = PRO_PRESETS_CATALOG[0];
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    defaultPreset.id
  );
  const [intensityPct, setIntensityPct] = useState<number>(100);
  const [overrides, setOverrides] = useState<SurgicalOverrides>(() =>
    extractSurgicalOverridesFromPreset(defaultPreset)
  );

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
  const [autoAdaptEnabled, setAutoAdaptEnabled] = useState<boolean>(true);
  const [adaptationReport, setAdaptationReport] =
    useState<SpectralAdaptationReport | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<{
    stage: string;
    pct: number;
  } | null>(null);
  const [isSavingCloud, setIsSavingCloud] = useState<boolean>(false);

  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Stems state
  const [stems, setStems] = useState<StemTrackState[]>(INITIAL_STEMS);
  const [kickBassSidechain, setKickBassSidechain] = useState<boolean>(true);
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

  // Sync DSP chain changes into live WebAudio graph
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.applyDspChain(effectiveDspChain);
    setLiveMetrics(engine.getLiveMetrics());
    setDetectedDrumHits(engine.getDetectedDrumHits());
  }, [effectiveDspChain]);

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

    if (urlFromQuery) {
      void handleLoadAudioUrl(
        urlFromQuery,
        titleFromQuery || 'Pista del Proyecto'
      );
    } else {
      // Auto-generate studio reference track on initial boot so user can audition immediately
      void handleGenerateDemoTrack(true);
    }

    return () => {
      engine.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 60fps UI Telemetry Loop
  useEffect(() => {
    let rafId = 0;
    let frameCount = 0;

    const tick = () => {
      const engine = engineRef.current;
      if (engine) {
        if (engine.getIsPlaying()) {
          setCurrentTimeSec(engine.getCurrentTimeSec());
        }
        frameCount++;
        if (frameCount % 3 === 0) {
          setLiveMetrics(engine.getLiveMetrics());
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Keyboard shortcuts (Space = Play/Pause, B = Bypass toggle)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'b' || e.key === 'B') {
        setIsBypassed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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
    try {
      setIsAnalyzing(true);
      setStatusBanner({
        type: 'info',
        message: `Decodificando y escaneando "${file.name}" en 32-bit float...`,
      });
      const { buffer, report } = await engine.loadAudioFile(file);
      setTrackTitle(file.name);
      setHasAudio(true);
      setDurationSec(buffer.duration);
      setCurrentTimeSec(0);
      setAdaptationReport(report);
      setDetectedDrumHits(report.detectedDrumHits);
      setOverrides((prev) => ({
        ...prev,
        resonanceNotches: report.detectedResonanceLines,
      }));
      setLiveMetrics(engine.getLiveMetrics());
      setStatusBanner({
        type: 'success',
        message: `Análisis completado (${report.detectedInputLufs} LUFS, ${report.detectedTruePeakDb} dBTP). Preset recomendado: ${getPresetById(report.recommendedPresetId).name}.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Error al decodificar el archivo de audio.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLoadAudioUrl = async (url: string, title: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      setIsAnalyzing(true);
      setStatusBanner({
        type: 'info',
        message: `Cargando pista "${title}" desde el proyecto...`,
      });
      const { buffer, report } = await engine.loadAudioFromUrl(url);
      setTrackTitle(title);
      setHasAudio(true);
      setDurationSec(buffer.duration);
      setCurrentTimeSec(0);
      setAdaptationReport(report);
      setDetectedDrumHits(report.detectedDrumHits);
      setOverrides((prev) => ({
        ...prev,
        resonanceNotches: report.detectedResonanceLines,
      }));
      setLiveMetrics(engine.getLiveMetrics());
      setStatusBanner({
        type: 'success',
        message: `"${title}" lista en el rack (${report.detectedInputLufs} LUFS).`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el audio remoto.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateDemoTrack = async (silent = false) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      setIsAnalyzing(true);
      const { buffer, report } = await engine.generateStudioDemoTrack();
      setTrackTitle('Zitio Studio Reference Mix (118 BPM Stereo)');
      setHasAudio(true);
      setDurationSec(buffer.duration);
      setCurrentTimeSec(0);
      setAdaptationReport(report);
      setDetectedDrumHits(report.detectedDrumHits);
      setOverrides((prev) => ({
        ...prev,
        resonanceNotches: report.detectedResonanceLines,
      }));
      setLiveMetrics(engine.getLiveMetrics());
      if (!silent) {
        setStatusBanner({
          type: 'success',
          message:
            'Pista de referencia generada en 32-bit float. Presiona Play para probar los presets y el modo A/B.',
        });
      }
    } finally {
      setIsAnalyzing(false);
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
        setIsPlaying(true);
      });
    }
  };

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

  const handleRunAiAnalysis = () => {
    const engine = engineRef.current;
    const buffer = engine?.getAudioBuffer();
    if (!buffer && !adaptationReport) return;

    setIsAnalyzing(true);
    setTimeout(() => {
      const freshReport = buffer
        ? analyzeTrackAndComputeAdaptation(buffer, selectedPresetId)
        : adaptationReport!;
      setAdaptationReport(freshReport);

      const recPreset = getPresetById(freshReport.recommendedPresetId);
      setSelectedPresetId(recPreset.id);

      const baseOverrides = extractSurgicalOverridesFromPreset(recPreset);
      const comp = freshReport.compressionSuggestion;
      const stereo = freshReport.stereoWidthSuggestion;

      // Apply full intelligent optimization from the AI scan
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

      setOverrides(nextOverrides);
      setAutoAdaptEnabled(true);
      setIsAnalyzing(false);
      setStatusBanner({
        type: 'success',
        message: `Diagnóstico IA completado: Preset "${recPreset.name}", ${freshReport.criticalEqPoints.length} puntos críticos de EQ, De-Esser (${freshReport.sibilanceScore}%), Compresión (${comp.ratio}:1) y Amplitud Estéreo (${stereo.recommendedWidthPct}%) calibrados.`,
      });
    }, 220);
  };

  const handleApplyCriticalPoint = (point: AiCriticalEqPoint) => {
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
      return next;
    });

    setStatusBanner({
      type: 'success',
      message: `Punto crítico aplicado: ${point.title} (${
        point.recommendedGainDb > 0 ? '+' : ''
      }${point.recommendedGainDb} dB @ ${point.freqHz} Hz).`,
    });
  };

  const handleApplyFilterSuggestion = (suggestion: AiFilterSuggestion) => {
    setOverrides((prev) => ({
      ...prev,
      ...suggestion.patchOverrides,
    }));
    setStatusBanner({
      type: 'success',
      message: `Filtro activado: ${suggestion.name}.`,
    });
  };

  const handleApplyAiCompression = () => {
    if (!adaptationReport) return;
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
    const s = adaptationReport.stereoWidthSuggestion;
    setOverrides((prev) => ({
      ...prev,
      stereoWidthPct: s.recommendedWidthPct,
      monoMakerFreq: s.recommendedMonoMakerHz,
      sideAirBoostDb: s.recommendedSideAirDb,
    }));
    setStatusBanner({
      type: 'success',
      message: `Amplitud Estéreo IA aplicada (${s.recommendedWidthPct}% Width, Mono Maker @ ${s.recommendedMonoMakerHz} Hz).`,
    });
  };

  const handleUpdateCustomEqBand = (
    bandId: string,
    patch: Partial<EQBandConfig>
  ) => {
    setOverrides((prev) => ({
      ...prev,
      customEqBands: prev.customEqBands.map((b) =>
        b.id === bandId ? { ...b, ...patch } : b
      ),
    }));
  };

  const handleChangeOverride = <K extends keyof SurgicalOverrides>(
    key: K,
    value: SurgicalOverrides[K]
  ) => {
    setOverrides((prev) => ({
      ...prev,
      [key]: value,
    }));
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
        .slice(-4)
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
    try {
      setIsMixingStems(true);
      const { buffer, report } = await engine.mixStemsIntoMasteringBuffer(
        stems,
        kickBassSidechain
      );
      setTrackTitle('Stem Mix Bus (Sidechain Bombo→Bajo Activo)');
      setHasAudio(true);
      setDurationSec(buffer.duration);
      setCurrentTimeSec(0);
      setAdaptationReport(report);
      setStatusBanner({
        type: 'success',
        message:
          'Stems sumados con Sidechain Bombo→Bajo e inyectados en la cadena Mid/Side.',
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Error al mezclar los Stems.',
      });
    } finally {
      setIsMixingStems(false);
    }
  };

  const handleExportWav24 = async () => {
    const engine = engineRef.current;
    if (!engine || !hasAudio) return;
    try {
      setIsExporting(true);
      const result = await engine.exportMasterToWav24Bit((stage, pct) => {
        setExportProgress({ stage, pct });
      });

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

      setStatusBanner({
        type: 'success',
        message: `Master WAV 24-Bit / 48kHz exportado (${(
          result.blob.size /
          (1024 * 1024)
        ).toFixed(1)} MB · True Peak: ${result.finalTruePeakDbTp} dBTP · Dither TPDF).`,
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
      setStatusBanner({
        type: 'info',
        message:
          'Renderizando Master WAV de 24-bits y subiendo a Supabase Storage...',
      });

      const renderRes = await engine.exportMasterToWav24Bit((stage, pct) => {
        setExportProgress({ stage, pct });
      });

      const savedRecord = await uploadAndSaveMasterSession({
        wavBlob: renderRes.blob,
        trackTitle,
        songId: activeSongId,
        presetId: selectedPreset.id,
        presetName: selectedPreset.name,
        intensityPct,
        targetLufs: overrides.targetLufs,
        inputLufs: liveMetrics.inputLufs,
        outputLufs: liveMetrics.outputLufs,
        truePeakDbTp: renderRes.finalTruePeakDbTp,
        phaseCorrelation: liveMetrics.phaseCorrelation,
        durationSeconds: renderRes.durationSec,
        sampleRate: renderRes.sampleRate,
        dspSnapshot: effectiveDspChain,
        surgicalOverrides: overrides,
      });

      setSessionsHistory((prev) => [savedRecord, ...prev]);
      onMasterSaved?.(savedRecord);

      setStatusBanner({
        type: 'success',
        message: `Master 24-Bit guardado en Cloud exitosamente (${savedRecord.preset_name}).`,
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
      }
    );
  }, []);

  const analyserNodes = useMemo(() => {
    return (
      engineRef.current?.getAnalyserNodes() ?? {
        preAnalyser: null,
        postAnalyser: null,
      }
    );
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
    <div className="w-full h-full overflow-y-auto bg-slate-950 text-slate-100 p-4 md:p-5 select-none">
      <div className="max-w-[1600px] mx-auto flex flex-col gap-4 pb-10">
        {/* Top Studio Hardware Rack Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-slate-900/90 border border-slate-800/90 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF6B00] to-[#00E5FF] p-0.5 shadow-[0_0_20px_rgba(255,107,0,0.3)]">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Cpu size={20} className="text-[#00E5FF]" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-wider uppercase text-white">
                  STUDIO MASTERING PRO
                </h1>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#FF6B00]/20 border border-[#FF6B00]/50 text-[#FF6B00]">
                  32-BIT FLOAT DSP · 24-BIT WAV
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00E5FF]/15 border border-[#00E5FF]/40 text-[#00E5FF]">
                  M/S MATRIX + 4X OVERSAMPLING
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Suite de masterización inteligente con curva ITU-R BS.1770-4, Mono Maker Butterworth y Limitador Lookahead True Peak.
              </p>
            </div>
          </div>

          {/* Right Quick Actions: Load from Project, History, SQL Schema */}
          <div className="flex flex-wrap items-center gap-2">
            {projectTracks.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5">
                <FolderOpen size={13} className="text-[#00E5FF]" />
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
                  className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none max-w-[210px]"
                >
                  <option value="" disabled className="bg-slate-950">
                    Cargar pista de tu Proyecto...
                  </option>
                  {projectTracks.map((t) => (
                    <option
                      key={t.id}
                      value={t.id}
                      className="bg-slate-950 text-slate-200"
                    >
                      {t.songTitle} · {t.stemName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-1.5 transition-colors"
            >
              <History size={13} className="text-[#FF6B00]" />
              <span>Historial ({sessionsHistory.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSqlModal(true)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
              title="Ver script SQL de migración para Supabase"
            >
              <Database size={13} className="text-[#00E5FF]" />
              <span>SQL Schema</span>
            </button>
          </div>
        </div>

        {/* Status Notification / Offline Render Progress Bar */}
        {(statusBanner || exportProgress) && (
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
            {exportProgress ? (
              <div className="w-full flex flex-col gap-1.5">
                <div className="flex justify-between text-xs font-mono text-[#00E5FF]">
                  <span>{exportProgress.stage}</span>
                  <span>{exportProgress.pct}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#FF6B00] to-[#00E5FF] transition-all duration-150"
                    style={{ width: `${exportProgress.pct}%` }}
                  />
                </div>
              </div>
            ) : (
              statusBanner && (
                <>
                  <div className="flex items-center gap-2 text-xs">
                    {statusBanner.type === 'error' ? (
                      <AlertCircle size={15} className="text-rose-400 shrink-0" />
                    ) : (
                      <CheckCircle2
                        size={15}
                        className="text-emerald-400 shrink-0"
                      />
                    )}
                    <span className="text-slate-200">
                      {statusBanner.message}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStatusBanner(null)}
                    className="text-slate-500 hover:text-slate-300"
                  >
                    <X size={14} />
                  </button>
                </>
              )
            )}
          </div>
        )}

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
          onRunAiAnalysis={handleRunAiAnalysis}
          onToggleBypass={(bypass) => setIsBypassed(bypass)}
          onToggleGainMatch={() => setIsGainMatch((g) => !g)}
          onSelectTargetLufs={(lufs) =>
            handleChangeOverride('targetLufs', lufs)
          }
          onToggleAutoAdapt={() => setAutoAdaptEnabled((a) => !a)}
          onExportWav24={() => void handleExportWav24()}
          onSaveToCloud={() => void handleSaveToCloud()}
        />

        {/* 2. Main Visual & Metering Grid: Left 8 Cols = Dual FFT + RX Heatmap, Right 4 Cols = Loudness & Phase Panel */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Modo de Monitoreo Espectral y Diagnóstico RX
          </span>
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
            {[
              { id: 'both' as const, label: 'Vista Dual (FFT + RX Heatmap)' },
              { id: 'heatmap' as const, label: 'Solo RX Spectral Heatmap 3D' },
              { id: 'fft' as const, label: 'Solo Analizador FFT Dual' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setVisualizerView(tab.id)}
                className={`px-3 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all ${
                  visualizerView === tab.id
                    ? 'bg-[#00E5FF] text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
          <div className="xl:col-span-8 flex flex-col gap-4">
            {(visualizerView === 'both' || visualizerView === 'fft') && (
              <DualSpectrumVisualizer
                getVisualSnapshot={getVisualSnapshot}
                dspChain={effectiveDspChain}
                isPlaying={isPlaying}
                isBypassed={isBypassed}
                currentTimeSec={currentTimeSec}
                durationSec={durationSec}
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
                height={visualizerView === 'heatmap' ? 370 : 290}
              />
            )}
          </div>

          <div className="xl:col-span-4">
            <LoudnessMeterPanel
              metrics={liveMetrics}
              targetLufs={overrides.targetLufs}
              ceilingDbTp={overrides.ceilingDbTp}
              monoMakerFreq={overrides.monoMakerFreq}
            />
          </div>
        </div>

        {/* 2.5. AI Master Assistant & Customizer Panel (Critical EQ Boost/Cut Points, De-Esser/Notch Filters, Custom EQ/Comp/Stereo) */}
        <AiMasteringAssistantPanel
          report={adaptationReport}
          overrides={overrides}
          isAnalyzing={isAnalyzing}
          onRunFullAiOptimization={handleRunAiAnalysis}
          onApplyCriticalPoint={handleApplyCriticalPoint}
          onApplyFilterSuggestion={handleApplyFilterSuggestion}
          onApplyAiCompression={handleApplyAiCompression}
          onApplyAiStereoWidth={handleApplyAiStereoWidth}
          onChangeOverride={handleChangeOverride}
          onUpdateCustomEqBand={handleUpdateCustomEqBand}
        />

        {/* 2.75. Acoustic Drum Re-Synthesis & Forensic Anti-AI De-Fingerprinting Rack */}
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
            liveMetrics.phaseCorrelation
          }
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
          onResetToPreset={() =>
            setOverrides(extractSurgicalOverridesFromPreset(selectedPreset))
          }
          onLoadStemFile={(role, file) => void handleLoadStemFile(role, file)}
          onUpdateStemState={handleUpdateStemState}
          onToggleKickBassSidechain={() => setKickBassSidechain((v) => !v)}
          onMixStemsToMaster={() => void handleMixStemsToMaster()}
        />
      </div>

      {/* Modal: Sessions History */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl flex flex-col gap-4 max-h-[80vh]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <History size={18} className="text-[#FF6B00]" />
                <h3 className="text-sm font-mono font-bold uppercase text-white">
                  Historial de Masters 24-Bit WAV
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2.5 pr-1">
              {sessionsHistory.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center font-mono">
                  Aún no hay sesiones guardadas. Usa el botón "Guardar Cloud" para registrar tu primer Master 24-bit.
                </p>
              ) : (
                sessionsHistory.map((item) => (
                  <div
                    key={item.id || item.created_at}
                    className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-bold text-white">
                        {item.track_title}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        Preset: <span className="text-[#FF6B00]">{item.preset_name}</span> ({item.intensity_pct}%) · Out: {item.output_lufs} LUFS · {item.true_peak_dbtp} dBTP
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.master_wav_url && (
                        <a
                          href={item.master_wav_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          className="px-2.5 py-1.5 rounded-lg bg-[#00E5FF]/15 border border-[#00E5FF]/40 text-[#00E5FF] text-xs font-mono flex items-center gap-1"
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
          </div>
        </div>
      )}

      {/* Modal: SQL Migration Script */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl flex flex-col gap-3 max-h-[82vh]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Database size={18} className="text-[#00E5FF]" />
                <h3 className="text-sm font-mono font-bold uppercase text-white">
                  Migración SQL Supabase (`mastering_sessions` + Bucket `masters`)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSqlModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto overflow-y-auto">
              {MASTERING_SESSIONS_MIGRATION_SQL}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export const StudioMasteringModule = MasteringRack;
export default StudioMasteringModule;
