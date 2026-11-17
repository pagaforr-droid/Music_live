import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  Check,
  CheckCircle2,
  Cpu,
  Download,
  Headphones,
  Layers,
  MonitorSpeaker,
  Music,
  Play,
  Radio,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Smartphone,
  Speaker,
  Square,
  Trash2,
  Unlock,
  Upload,
  Volume2,
  Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { detectInstrumentCategory } from '../utils/instrumentIcons';
import { StageIoAlertsBanner } from '../components/StageIoAlertsBanner';
import {
  SignalGeneratorHandle,
  TestSignalType,
  startTestSignalGenerator,
} from '../utils/soundcheckSynthesis';
import {
  ALL_CONSOLE_TARGET_OPTIONS,
  CONSOLE_PAIR_OPTIONS,
  CUE_ROUTING_OPTIONS,
  ConsoleTargetAssignment,
  DEFAULT_STAGE_EQ_PROFILE,
  EqMemoryScope,
  HardwareProbeReport,
  LIVE_STORAGE_KEYS,
  MultiChannelPatchConfig,
  RoutingMode,
  STAGE_EQ_18_BANDS,
  STAGE_EQ_PRESETS,
  STEM_BUS_GROUPS,
  STEM_ROLE_RULES,
  StageBusDspNodes,
  StageEqProfile,
  StageStemInput,
  StemRuleKey,
  VenueRigProfile,
  analyzeStagePatch,
  applyProfileToStageBusDspNodes,
  computeRequiredMergerChannels,
  createStageBusDspNodes,
  createStageSafetySoftClipCurve,
  findMatchingVenueProfile,
  isDeviceBluetoothSuspect,
  loadNormalizedMultiChannelPatch,
  loadStoredEqScope,
  loadStoredJson,
  loadStoredRoutingMode,
  loadVenueProfiles,
  mapInstrumentCategoryToBusGroup,
  normalizeMultiChannelPatch,
  notifyStageIoUpdated,
  parseImportedVenueProfilesJson,
  probeAudioHardware,
  resolveConsoleTarget,
  resolveCueIndices,
  resolveStemConsoleTarget,
  saveVenueProfiles,
  serializeVenueProfilesJson,
  subscribeStageIoUpdates,
} from '../utils/liveConsoleDSP';

interface SongStemRow extends StageStemInput {
  id: string;
  name: string;
  group: ReturnType<typeof mapInstrumentCategoryToBusGroup>;
  category: ReturnType<typeof detectInstrumentCategory>;
}

interface SongOption {
  id: string;
  title: string;
}

const FAKE_BAND_ID = '00000000-0000-0000-0000-000000000000';

export default function StageSoundcheck() {
  const navigate = useNavigate();

  const [routingMode, setRoutingMode] = useState<RoutingMode>(() => loadStoredRoutingMode());
  const routingModeRef = useRef<RoutingMode>(routingMode);
  useEffect(() => { routingModeRef.current = routingMode; }, [routingMode]);

  const [patch, setPatch] = useState<MultiChannelPatchConfig>(() => loadNormalizedMultiChannelPatch());
  const patchRef = useRef<MultiChannelPatchConfig>(patch);
  useEffect(() => { patchRef.current = patch; }, [patch]);

  const [eqScope, setEqScope] = useState<EqMemoryScope>(() => loadStoredEqScope());
  const eqScopeRef = useRef<EqMemoryScope>(eqScope);
  useEffect(() => { eqScopeRef.current = eqScope; }, [eqScope]);

  const [globalEqProfile, setGlobalEqProfile] = useState<StageEqProfile>(() =>
    loadStoredJson<StageEqProfile>(LIVE_STORAGE_KEYS.EQ_GLOBAL, DEFAULT_STAGE_EQ_PROFILE)
  );
  const [songEqProfiles, setSongEqProfiles] = useState<Record<string, StageEqProfile>>(() => {
    try {
      const raw = localStorage.getItem(LIVE_STORAGE_KEYS.EQ_SONGS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // Songs / Stems preview
  const [songs, setSongs] = useState<SongOption[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string>('');
  const [songStems, setSongStems] = useState<SongStemRow[]>([]);
  const songStemsRef = useRef<SongStemRow[]>([]);
  useEffect(() => { songStemsRef.current = songStems; }, [songStems]);
  const [isLoadingStems, setIsLoadingStems] = useState<boolean>(false);

  const activeEqProfile: StageEqProfile =
    eqScope === 'per_song' && selectedSongId && songEqProfiles[selectedSongId]
      ? songEqProfiles[selectedSongId]
      : globalEqProfile;
  const eqProfileRef = useRef<StageEqProfile>(activeEqProfile);
  useEffect(() => { eqProfileRef.current = activeEqProfile; }, [activeEqProfile]);

  const [probeReport, setProbeReport] = useState<HardwareProbeReport | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [ctxState, setCtxState] = useState<AudioContextState>('suspended');
  const [sinkStatus, setSinkStatus] = useState<'idle' | 'ok' | 'missing' | 'rejected'>('idle');

  // Test Signal State (meter values mutate via DOM refs for zero-re-render 60 FPS performance)
  const [signalType, setSignalType] = useState<TestSignalType>('tone');
  const [activeTestTarget, setActiveTestTarget] = useState<string | null>(null);
  const [isWalkTestActive, setIsWalkTestActive] = useState<boolean>(false);
  const [testVolume, setTestVolume] = useState<number>(0.45);
  const [polarityInvertR, setPolarityInvertR] = useState<boolean>(false);

  // Venue Profiles & UI subpanels
  const [venueProfiles, setVenueProfiles] = useState<VenueRigProfile[]>(() => loadVenueProfiles());
  const [newProfileName, setNewProfileName] = useState<string>('');
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [dismissedMatchedRigId, setDismissedMatchedRigId] = useState<string | null>(null);
  const [showRoleRules, setShowRoleRules] = useState<boolean>(false);

  // Audio & Real-Time Metering Refs
  const testCtxRef = useRef<AudioContext | null>(null);
  const masterTestGainRef = useRef<GainNode | null>(null);
  const fohRightPolarityGainRef = useRef<GainNode | null>(null);
  const testFohDspRef = useRef<StageBusDspNodes | null>(null);
  const testSafetyCurveRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const testAnalyserRef = useRef<AnalyserNode | null>(null);
  const testLeftAnalyserRef = useRef<AnalyserNode | null>(null);
  const testRightAnalyserRef = useRef<AnalyserNode | null>(null);
  const testMeterRafRef = useRef<number>(0);
  const testStopCleanupRef = useRef<(() => void) | null>(null);
  const activeGeneratorRef = useRef<SignalGeneratorHandle | null>(null);
  const walkTestTimerRef = useRef<number | null>(null);
  const activeChannelBarRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const toastTimerRef = useRef<number | null>(null);
  const deviceChangeDebounceRef = useRef<number | null>(null);
  const profileImportInputRef = useRef<HTMLInputElement | null>(null);

  // Zero-re-render DOM refs for live instrumentation
  const meterBarRef = useRef<HTMLDivElement | null>(null);
  const peakHoldBarRef = useRef<HTMLDivElement | null>(null);
  const dbReadoutRef = useRef<HTMLSpanElement | null>(null);
  const clipBadgeRef = useRef<HTMLButtonElement | null>(null);
  const phaseBarRef = useRef<HTMLDivElement | null>(null);
  const phaseTextRef = useRef<HTMLSpanElement | null>(null);
  const rtaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakHoldStateRef = useRef<{ pct: number; holdUntil: number; clipped: boolean }>({
    pct: 0,
    holdUntil: 0,
    clipped: false,
  });

  const showToast = (msg: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setStatusToast(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setStatusToast(null);
      toastTimerRef.current = null;
    }, 2800);
  };

  // Persist changes cleanly outside React updater callbacks & ignore self-echoes
  const commitRoutingMode = (next: RoutingMode) => {
    routingModeRef.current = next;
    setRoutingMode(next);
    try {
      localStorage.setItem(LIVE_STORAGE_KEYS.ROUTING_MODE, next);
    } catch {}
    notifyStageIoUpdated('soundcheck');
  };

  const commitPatch = (updater: (prev: MultiChannelPatchConfig) => MultiChannelPatchConfig) => {
    const next = normalizeMultiChannelPatch(updater(patchRef.current));
    patchRef.current = next;
    setPatch(next);
    try {
      localStorage.setItem(LIVE_STORAGE_KEYS.MC_PATCH, JSON.stringify(next));
    } catch {}
    notifyStageIoUpdated('soundcheck');
  };

  const commitEqScope = (nextScope: EqMemoryScope) => {
    eqScopeRef.current = nextScope;
    setEqScope(nextScope);
    try {
      localStorage.setItem(LIVE_STORAGE_KEYS.EQ_SCOPE, nextScope);
    } catch {}
    notifyStageIoUpdated('soundcheck');
  };

  const commitEqPreset = (presetId: string) => {
    const found = STAGE_EQ_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    const base = eqProfileRef.current;
    const next: StageEqProfile = {
      ...base,
      enabled: true,
      presetId: found.id,
      hpfFreq: found.hpfFreq,
      gains: [...found.gains],
    };
    eqProfileRef.current = next;

    if (eqScopeRef.current === 'per_song' && selectedSongId) {
      const updatedMap = { ...songEqProfiles, [selectedSongId]: next };
      setSongEqProfiles(updatedMap);
      try {
        localStorage.setItem(LIVE_STORAGE_KEYS.EQ_SONGS, JSON.stringify(updatedMap));
      } catch {}
    } else {
      setGlobalEqProfile(next);
      try {
        localStorage.setItem(LIVE_STORAGE_KEYS.EQ_GLOBAL, JSON.stringify(next));
      } catch {}
    }
    notifyStageIoUpdated('soundcheck');
    showToast(`Preset EQ "${found.name}" aplicado para Live Concert`);
  };

  // Listen strictly to external updates (LiveConcert u otra ventana) evitando auto-eco síncrono
  useEffect(() => {
    return subscribeStageIoUpdates(
      () => {
        const nextMode = loadStoredRoutingMode();
        const nextPatch = loadNormalizedMultiChannelPatch();
        const nextScope = loadStoredEqScope();
        const nextGlobalEq = loadStoredJson<StageEqProfile>(
          LIVE_STORAGE_KEYS.EQ_GLOBAL,
          DEFAULT_STAGE_EQ_PROFILE
        );
        let nextSongMap: Record<string, StageEqProfile> = {};
        try {
          const raw = localStorage.getItem(LIVE_STORAGE_KEYS.EQ_SONGS);
          nextSongMap = raw ? JSON.parse(raw) : {};
        } catch {}

        routingModeRef.current = nextMode;
        patchRef.current = nextPatch;
        eqScopeRef.current = nextScope;
        setRoutingMode(nextMode);
        setPatch(nextPatch);
        setEqScope(nextScope);
        setGlobalEqProfile(nextGlobalEq);
        setSongEqProfiles(nextSongMap);
      },
      { ignoreSource: 'soundcheck' }
    );
  }, []);

  // Sincronizar nivel de prueba y polaridad R en tiempo real sin cortar el audio
  useEffect(() => {
    if (masterTestGainRef.current && testCtxRef.current && testCtxRef.current.state !== 'closed') {
      const targetGain = signalType === 'cal_minus18' ? 1.0 : testVolume;
      masterTestGainRef.current.gain.setTargetAtTime(targetGain, testCtxRef.current.currentTime, 0.02);
    }
  }, [testVolume, signalType]);

  useEffect(() => {
    if (fohRightPolarityGainRef.current && testCtxRef.current && testCtxRef.current.state !== 'closed') {
      fohRightPolarityGainRef.current.gain.setTargetAtTime(
        polarityInvertR ? -1 : 1,
        testCtxRef.current.currentTime,
        0.015
      );
    }
  }, [polarityInvertR]);

  // Actualizar el EQ de 18 bandas en vivo si está sonando "Probar Bus FOH (con EQ 18B)"
  useEffect(() => {
    if (testFohDspRef.current && testCtxRef.current && testCtxRef.current.state !== 'closed') {
      if (!testSafetyCurveRef.current) {
        testSafetyCurveRef.current = createStageSafetySoftClipCurve(-0.3);
      }
      applyProfileToStageBusDspNodes(
        testCtxRef.current,
        testFohDspRef.current,
        activeEqProfile,
        testSafetyCurveRef.current
      );
    }
  }, [activeEqProfile]);

  const ensureTestContext = async (): Promise<{ ctx: AudioContext; sinkApplied: boolean }> => {
    if (!testCtxRef.current || testCtxRef.current.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const newCtx = new AudioContextClass();
      newCtx.onstatechange = () => {
        setCtxState(newCtx.state);
      };
      testCtxRef.current = newCtx;
    }
    const ctx = testCtxRef.current;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }
    const sinkId = patchRef.current.sinkId;
    let sinkApplied = true;
    if (typeof (ctx as any).setSinkId === 'function' && sinkId !== undefined) {
      try {
        await (ctx as any).setSinkId(sinkId === 'default' ? '' : sinkId);
        setSinkStatus(sinkId ? 'ok' : 'idle');
      } catch {
        sinkApplied = false;
        setSinkStatus('rejected');
      }
    }
    setCtxState(ctx.state);
    return { ctx, sinkApplied };
  };

  const resetMeterDom = () => {
    peakHoldStateRef.current = { pct: 0, holdUntil: 0, clipped: false };
    if (meterBarRef.current) meterBarRef.current.style.width = '0%';
    if (peakHoldBarRef.current) peakHoldBarRef.current.style.left = '0%';
    if (dbReadoutRef.current) dbReadoutRef.current.textContent = '-∞ dBFS';
    if (clipBadgeRef.current) {
      clipBadgeRef.current.dataset.clipped = 'false';
      clipBadgeRef.current.classList.remove('bg-rose-600', 'text-white', 'border-rose-500');
      clipBadgeRef.current.classList.add('bg-zinc-800', 'text-zinc-500', 'border-zinc-700');
    }
    if (phaseBarRef.current) phaseBarRef.current.style.left = '50%';
    if (phaseTextRef.current) phaseTextRef.current.textContent = '+1.00';
    Object.values(activeChannelBarRefs.current).forEach((el) => {
      if (el) el.style.width = '0%';
    });
  };

  const stopTestSignal = (keepWalkTest = false) => {
    if (!keepWalkTest && walkTestTimerRef.current) {
      window.clearTimeout(walkTestTimerRef.current);
      walkTestTimerRef.current = null;
      setIsWalkTestActive(false);
    }
    if (testMeterRafRef.current) {
      cancelAnimationFrame(testMeterRafRef.current);
      testMeterRafRef.current = 0;
    }
    if (activeGeneratorRef.current) {
      try { activeGeneratorRef.current.stop(); } catch {}
      activeGeneratorRef.current = null;
    }
    if (testStopCleanupRef.current) {
      try {
        testStopCleanupRef.current();
      } catch {}
      testStopCleanupRef.current = null;
    }
    masterTestGainRef.current = null;
    fohRightPolarityGainRef.current = null;
    testFohDspRef.current = null;
    testAnalyserRef.current = null;
    testLeftAnalyserRef.current = null;
    testRightAnalyserRef.current = null;
    setActiveTestTarget(null);
    resetMeterDom();
  };

  const runHardwareScan = async (unlockLabels = false) => {
    setIsScanning(true);
    stopTestSignal();
    try {
      const report = await probeAudioHardware({ unlockLabels });
      setProbeReport(report);
      if (!testCtxRef.current || testCtxRef.current.state === 'closed') {
        setCtxState(report.audioContextState);
      } else {
        setCtxState(testCtxRef.current.state);
      }
      try {
        localStorage.setItem(LIVE_STORAGE_KEYS.LAST_SOUNDCHECK, JSON.stringify(report));
      } catch {}

      const currentPatch = patchRef.current;
      if (currentPatch.sinkId && currentPatch.sinkId !== 'default') {
        const existsById = report.devices.some((d) => d.deviceId === currentPatch.sinkId);
        if (existsById) {
          setSinkStatus('ok');
        } else if (currentPatch.sinkLabel) {
          const byLabel = report.devices.find(
            (d) => d.label && d.label.toLowerCase() === currentPatch.sinkLabel?.toLowerCase()
          );
          if (byLabel) {
            commitPatch((prev) => ({ ...prev, sinkId: byLabel.deviceId }));
            setSinkStatus('ok');
          } else {
            setSinkStatus('missing');
          }
        } else {
          setSinkStatus('missing');
        }
      } else {
        setSinkStatus('idle');
      }
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    runHardwareScan(false);
    fetchAvailableSongs();

    const onDeviceChange = () => {
      if (deviceChangeDebounceRef.current) {
        window.clearTimeout(deviceChangeDebounceRef.current);
      }
      deviceChangeDebounceRef.current = window.setTimeout(() => {
        deviceChangeDebounceRef.current = null;
        runHardwareScan(false);
      }, 350);
    };
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
      if (deviceChangeDebounceRef.current) window.clearTimeout(deviceChangeDebounceRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      stopTestSignal();
      if (testCtxRef.current && testCtxRef.current.state !== 'closed') {
        testCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const fetchAvailableSongs = async () => {
    try {
      const activeSetlistId = sessionStorage.getItem('tandu_active_setlist_id');
      if (activeSetlistId) {
        const { data } = await supabase
          .from('setlist_songs')
          .select('song:songs(id, title)')
          .eq('setlist_id', activeSetlistId)
          .order('position', { ascending: true });
        if (data && data.length > 0) {
          const list = data
            .map((r: any) => r.song)
            .filter(Boolean)
            .map((s: any) => ({ id: s.id, title: s.title }));
          setSongs(list);
          if (list.length > 0) setSelectedSongId(list[0].id);
          return;
        }
      }

      const { data: fallbackSongs } = await supabase
        .from('songs')
        .select('id, title')
        .eq('band_id', FAKE_BAND_ID)
        .order('title');
      if (fallbackSongs && fallbackSongs.length > 0) {
        setSongs(fallbackSongs);
        setSelectedSongId(fallbackSongs[0].id);
      }
    } catch {}
  };

  useEffect(() => {
    if (!selectedSongId) {
      setSongStems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoadingStems(true);
      try {
        const { data } = await supabase
          .from('stems')
          .select('id, name, metadata')
          .eq('song_id', selectedSongId)
          .order('name');
        if (cancelled) return;
        const rows = data || [];
        const hasSep = rows.length > 1 && rows.some((r: any) => !r.metadata?.is_master);
        const filtered: SongStemRow[] = rows
          .filter((r: any) => {
            const lower = (r.name || '').toLowerCase();
            if (lower.includes('click') || lower.includes('metronomo') || lower.includes('cue') || lower.includes('guia')) {
              return false;
            }
            if (hasSep && r.metadata?.is_master) return false;
            if (r.metadata?.muted === true) return false;
            return true;
          })
          .map((r: any) => {
            const category = detectInstrumentCategory(r.name || '', r.metadata?.instrument_icon);
            return {
              id: r.id,
              name: r.name,
              category,
              group: mapInstrumentCategoryToBusGroup(category),
            };
          });
        setSongStems(filtered);
      } finally {
        if (!cancelled) setIsLoadingStems(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSongId]);

  const savedDeviceFound =
    !patch.sinkId ||
    patch.sinkId === 'default' ||
    Boolean(probeReport?.devices.some((d) => d.deviceId === patch.sinkId));

  const activeDevice =
    probeReport?.devices.find((d) => d.deviceId === patch.sinkId) ||
    probeReport?.devices.find((d) => d.isDefault) ||
    probeReport?.devices[0];
  const detectedMaxChannels = activeDevice?.maxChannels || 2;
  const effectiveSinkStatus: 'idle' | 'ok' | 'missing' | 'rejected' =
    sinkStatus === 'rejected'
      ? 'rejected'
      : patch.sinkId && patch.sinkId !== 'default' && probeReport && !savedDeviceFound
      ? 'missing'
      : sinkStatus;

  const unlockAudioDeviceNow = async () => {
    const { ctx } = await ensureTestContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.03);
    setCtxState(ctx.state);
    showToast('Motor de audio activado y listo');
  };

  /**
   * Medición 60 FPS sin re-render de React: dBFS + Peak-Hold + Clip Latch + Correlación L/R + RTA 18B
   */
  const startRealMeterLoop = (
    analyser: AnalyserNode,
    targetKey: string,
    leftAnalyser?: AnalyserNode | null,
    rightAnalyser?: AnalyserNode | null
  ) => {
    const timeBuf = new Float32Array(analyser.fftSize);
    const freqBuf = new Uint8Array(analyser.frequencyBinCount);
    const leftBuf = leftAnalyser ? new Float32Array(leftAnalyser.fftSize) : null;
    const rightBuf = rightAnalyser ? new Float32Array(rightAnalyser.fftSize) : null;

    const tick = () => {
      analyser.getFloatTimeDomainData(timeBuf);
      let peak = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const a = Math.abs(timeBuf[i]);
        if (a > peak) peak = a;
      }

      const db = peak > 0.00003 ? Math.max(-90, 20 * Math.log10(peak)) : -90;
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      const nowMs = performance.now();

      const ph = peakHoldStateRef.current;
      if (pct >= ph.pct || nowMs > ph.holdUntil) {
        ph.pct = pct >= ph.pct ? pct : Math.max(0, ph.pct - 1.2);
        if (pct >= ph.pct) ph.holdUntil = nowMs + 1400;
      }
      if (db >= -0.15) ph.clipped = true;

      if (meterBarRef.current) {
        meterBarRef.current.style.width = `${pct.toFixed(1)}%`;
      }
      if (peakHoldBarRef.current) {
        peakHoldBarRef.current.style.left = `${Math.min(99, ph.pct).toFixed(1)}%`;
      }
      if (dbReadoutRef.current) {
        dbReadoutRef.current.textContent = db <= -89 ? '-∞ dBFS' : `${db.toFixed(1)} dBFS`;
        dbReadoutRef.current.classList.toggle('text-rose-400', db >= -1);
        dbReadoutRef.current.classList.toggle('text-emerald-400', db < -1);
      }
      if (clipBadgeRef.current && ph.clipped && clipBadgeRef.current.dataset.clipped !== 'true') {
        clipBadgeRef.current.dataset.clipped = 'true';
        clipBadgeRef.current.classList.remove('bg-zinc-800', 'text-zinc-500', 'border-zinc-700');
        clipBadgeRef.current.classList.add('bg-rose-600', 'text-white', 'border-rose-500');
      }

      const cardBar = activeChannelBarRefs.current[targetKey];
      if (cardBar) {
        cardBar.style.width = `${pct.toFixed(1)}%`;
      }

      // Medidor de Correlación de Fase Estéreo (+1 a -1)
      if (leftAnalyser && rightAnalyser && leftBuf && rightBuf && phaseBarRef.current && phaseTextRef.current) {
        leftAnalyser.getFloatTimeDomainData(leftBuf);
        rightAnalyser.getFloatTimeDomainData(rightBuf);
        let sumLR = 0;
        let sumL2 = 0;
        let sumR2 = 0;
        for (let i = 0; i < leftBuf.length; i++) {
          const l = leftBuf[i];
          const r = rightBuf[i];
          sumLR += l * r;
          sumL2 += l * l;
          sumR2 += r * r;
        }
        const denom = Math.sqrt(sumL2 * sumR2);
        const corr = denom > 1e-8 ? Math.max(-1, Math.min(1, sumLR / denom)) : 1;
        const leftPosPct = ((corr + 1) / 2) * 100;
        phaseBarRef.current.style.left = `${Math.max(4, Math.min(96, leftPosPct)).toFixed(1)}%`;
        phaseTextRef.current.textContent = `${corr >= 0 ? '+' : ''}${corr.toFixed(2)}`;
        phaseTextRef.current.classList.toggle('text-violet-400', corr < -0.2);
        phaseTextRef.current.classList.toggle('text-emerald-400', corr >= -0.2);
      }

      // Mini RTA 18 Bandas en vivo
      const canvas = rtaCanvasRef.current;
      if (canvas) {
        const c2d = canvas.getContext('2d');
        if (c2d) {
          analyser.getByteFrequencyData(freqBuf);
          const w = canvas.width;
          const h = canvas.height;
          c2d.clearRect(0, 0, w, h);

          c2d.strokeStyle = 'rgba(255,255,255,0.08)';
          c2d.lineWidth = 1;
          c2d.beginPath();
          c2d.moveTo(0, h * 0.5);
          c2d.lineTo(w, h * 0.5);
          c2d.stroke();

          const sampleRate = analyser.context.sampleRate || 48000;
          const binCount = analyser.frequencyBinCount;
          const colW = w / STAGE_EQ_18_BANDS.length;
          STAGE_EQ_18_BANDS.forEach((b, idx) => {
            const bin = Math.min(binCount - 1, Math.max(1, Math.round((b.freq * binCount * 2) / sampleRate)));
            const v = freqBuf[bin] / 255;
            const barH = Math.max(2, v * (h - 6));
            c2d.fillStyle = v > 0.78 ? '#fb7185' : '#34d399';
            c2d.fillRect(idx * colW + 2, h - barH, Math.max(3, colW - 4), barH);
          });
        }
      }

      testMeterRafRef.current = requestAnimationFrame(tick);
    };
    testMeterRafRef.current = requestAnimationFrame(tick);
  };

  /**
   * Genera señal de prueba quirúrgica hacia canales discretos exactos o Bus FOH + EQ 18B.
   */
  const playDiscreteTestSignal = async (
    targetKey: string,
    mode: 'single_channel' | 'cue_isolation' | 'foh_dsp',
    channelIdx0 = 0,
    opts?: { preserveWalkTest?: boolean; includeChannelIdPips?: boolean; overrideSignal?: TestSignalType }
  ): Promise<boolean> => {
    if (!opts?.preserveWalkTest && activeTestTarget === targetKey) {
      stopTestSignal();
      return false;
    }
    stopTestSignal(Boolean(opts?.preserveWalkTest));

    const { ctx, sinkApplied } = await ensureTestContext();
    const maxCh = ctx.destination.maxChannelCount || 2;
    if (mode === 'single_channel' && channelIdx0 >= maxCh) {
      showToast(
        sinkApplied
          ? `Hardware actual limitado a ${maxCh} canales (CH ${channelIdx0 + 1} no disponible)`
          : `No se pudo abrir ${channelIdx0 + 1}ch: hardware limitado a ${maxCh}ch`
      );
      return false;
    }

    const chosenSignal: TestSignalType =
      opts?.overrideSignal || (mode === 'cue_isolation' ? 'click' : signalType);

    const masterTestGain = ctx.createGain();
    masterTestGain.gain.value = chosenSignal === 'cal_minus18' ? 1.0 : testVolume;
    masterTestGainRef.current = masterTestGain;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    testAnalyserRef.current = analyser;

    let merger: ChannelMergerNode | null = null;
    let panner: StereoPannerNode | null = null;
    let fohRightPol: GainNode | null = null;
    let fohDspNodes: StageBusDspNodes | null = null;
    let leftAnalyser: AnalyserNode | null = null;
    let rightAnalyser: AnalyserNode | null = null;
    const extraCleanupNodes: AudioNode[] = [];

    const currentPatch = patchRef.current;
    const currentRouting = routingModeRef.current;
    const currentEq = eqProfileRef.current;

    if (mode === 'cue_isolation') {
      masterTestGain.connect(analyser);
      if (currentRouting === 'MultiChannel' && maxCh >= 4) {
        const reqCh = Math.min(
          maxCh,
          computeRequiredMergerChannels(currentPatch, maxCh, songStemsRef.current)
        );
        try {
          ctx.destination.channelInterpretation = 'discrete';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = reqCh;
        } catch {}
        merger = ctx.createChannelMerger(reqCh);
        merger.channelInterpretation = 'discrete';
        merger.connect(ctx.destination);

        const cuePatch = resolveCueIndices(currentPatch.cueRouting, reqCh);
        analyser.connect(merger, 0, cuePatch.leftIdx);
        if (!cuePatch.isMono && cuePatch.rightIdx !== cuePatch.leftIdx) {
          analyser.connect(merger, 0, cuePatch.rightIdx);
        }
      } else {
        try {
          ctx.destination.channelInterpretation = 'speakers';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = Math.min(2, maxCh);
        } catch {}
        panner = ctx.createStereoPanner();
        panner.pan.value = currentRouting === 'StereoSplit' ? -1 : 0;
        analyser.connect(panner);
        panner.connect(ctx.destination);
      }
    } else if (mode === 'foh_dsp') {
      if (!testSafetyCurveRef.current) {
        testSafetyCurveRef.current = createStageSafetySoftClipCurve(-0.3);
      }
      fohDspNodes = createStageBusDspNodes(ctx, testSafetyCurveRef.current);
      applyProfileToStageBusDspNodes(ctx, fohDspNodes, currentEq, testSafetyCurveRef.current);
      testFohDspRef.current = fohDspNodes;

      masterTestGain.connect(fohDspNodes.hpf);
      fohDspNodes.output.connect(analyser);

      fohRightPol = ctx.createGain();
      fohRightPol.gain.value = polarityInvertR ? -1 : 1;
      fohRightPolarityGainRef.current = fohRightPol;

      const leftPass = ctx.createGain();
      leftPass.gain.value = 1;
      const stereoMerger = ctx.createChannelMerger(2);

      leftAnalyser = ctx.createAnalyser();
      leftAnalyser.fftSize = 512;
      rightAnalyser = ctx.createAnalyser();
      rightAnalyser.fftSize = 512;
      testLeftAnalyserRef.current = leftAnalyser;
      testRightAnalyserRef.current = rightAnalyser;
      extraCleanupNodes.push(leftPass, stereoMerger, leftAnalyser, rightAnalyser);

      analyser.connect(leftPass);
      analyser.connect(fohRightPol);
      leftPass.connect(leftAnalyser);
      fohRightPol.connect(rightAnalyser);
      leftPass.connect(stereoMerger, 0, 0);
      fohRightPol.connect(stereoMerger, 0, 1);

      if (currentRouting === 'MultiChannel' && maxCh >= 4) {
        const reqCh = Math.min(
          maxCh,
          computeRequiredMergerChannels(currentPatch, maxCh, songStemsRef.current)
        );
        try {
          ctx.destination.channelInterpretation = 'discrete';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = reqCh;
        } catch {}
        merger = ctx.createChannelMerger(reqCh);
        merger.channelInterpretation = 'discrete';
        merger.connect(ctx.destination);

        const splitter = ctx.createChannelSplitter(2);
        stereoMerger.connect(splitter);
        extraCleanupNodes.push(splitter);

        const fohTestTarget: ConsoleTargetAssignment =
          currentPatch.consoleBusMode === 'multitrack_stems' && songStemsRef.current.length > 0
            ? resolveStemConsoleTarget(songStemsRef.current[0], currentPatch).target
            : currentPatch.fohPair;

        const resolvedFoh = resolveConsoleTarget(fohTestTarget, reqCh);
        if (resolvedFoh.isMono) {
          const monoSum = ctx.createGain();
          monoSum.gain.value = 0.707;
          splitter.connect(monoSum, 0);
          splitter.connect(monoSum, 1);
          monoSum.connect(merger, 0, resolvedFoh.leftIdx);
          extraCleanupNodes.push(monoSum);
        } else {
          splitter.connect(merger, 0, resolvedFoh.leftIdx);
          splitter.connect(merger, 1, resolvedFoh.rightIdx);
        }
      } else {
        try {
          ctx.destination.channelInterpretation = 'speakers';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = Math.min(2, maxCh);
        } catch {}
        panner = ctx.createStereoPanner();
        panner.pan.value = currentRouting === 'StereoSplit' ? 1 : 0;
        stereoMerger.connect(panner);
        panner.connect(ctx.destination);
      }
    } else {
      masterTestGain.connect(analyser);
      if (maxCh >= 4) {
        const reqCh = Math.min(maxCh, Math.max(4, channelIdx0 + 1));
        try {
          ctx.destination.channelInterpretation = 'discrete';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = reqCh;
        } catch {}
        merger = ctx.createChannelMerger(reqCh);
        merger.channelInterpretation = 'discrete';
        merger.connect(ctx.destination);
        analyser.connect(merger, 0, Math.min(channelIdx0, reqCh - 1));
      } else {
        try {
          ctx.destination.channelInterpretation = 'speakers';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = Math.min(2, maxCh);
        } catch {}
        panner = ctx.createStereoPanner();
        panner.pan.value = channelIdx0 % 2 === 0 ? -1 : 1;
        analyser.connect(panner);
        panner.connect(ctx.destination);
      }
    }

    const genHandle = startTestSignalGenerator(ctx, masterTestGain, chosenSignal, {
      channelNumber: channelIdx0 + 1,
      includeChannelIdPips: opts?.includeChannelIdPips,
      isActive: () => Boolean(testCtxRef.current && testCtxRef.current.state === 'running'),
    });
    activeGeneratorRef.current = genHandle;

    startRealMeterLoop(analyser, targetKey, leftAnalyser, rightAnalyser);

    testStopCleanupRef.current = () => {
      try { genHandle.stop(); } catch {}
      try { masterTestGain.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      try { fohRightPol?.disconnect(); } catch {}
      try { merger?.disconnect(); } catch {}
      try { panner?.disconnect(); } catch {}
      if (fohDspNodes) {
        try {
          fohDspNodes.hpf.disconnect();
          fohDspNodes.eqBands.forEach((b) => b.disconnect());
          fohDspNodes.headroomGain.disconnect();
          fohDspNodes.shaper.disconnect();
        } catch {}
      }
      extraCleanupNodes.forEach((n) => {
        try { n.disconnect(); } catch {}
      });
    };
    setActiveTestTarget(targetKey);
    return true;
  };

  /**
   * Walk-Test Secuencial Automático (CH 1..N) con pips identificadores dentro del canal discreto
   */
  const toggleWalkTest = async () => {
    if (isWalkTestActive) {
      stopTestSignal();
      showToast('Walk-Test detenido');
      return;
    }

    const totalCh = Math.max(2, Math.min(16, detectedMaxChannels));
    setIsWalkTestActive(true);
    let stepIdx = 0;

    const advanceWalkStep = async () => {
      const key = `ch-${stepIdx}`;
      const chNumber = stepIdx + 1;
      const started = await playDiscreteTestSignal(key, 'single_channel', stepIdx, {
        preserveWalkTest: true,
        includeChannelIdPips: true,
        overrideSignal: signalType === 'sweep' ? 'pink' : signalType,
      });

      if (!started) {
        stopTestSignal();
        return;
      }

      stepIdx = (stepIdx + 1) % totalCh;
      walkTestTimerRef.current = window.setTimeout(() => {
        advanceWalkStep();
      }, 3600);
      showToast(`Walk-Test: Probando Canal Físico CH ${chNumber} de ${totalCh}`);
    };

    await advanceWalkStep();
  };

  // Asistente de 4 Escenarios Universales (adaptado a 4ch, 6ch u 8+ ch)
  const applyScenarioWizard = (
    scenario: 'multichannel_bus' | 'multichannel_stems' | 'cable_y' | 'inear_rehearsal'
  ) => {
    stopTestSignal();
    if (scenario === 'multichannel_bus') {
      commitRoutingMode('MultiChannel');
      commitPatch((prev) => ({
        ...prev,
        consoleBusMode: 'stereo_bus',
        fohPair: '1-2',
        cueRouting: '3-4',
      }));
      showToast('Configurado: Consola Multicanal (1–2 FOH Estéreo + 3–4 CUE)');
    } else if (scenario === 'multichannel_stems') {
      commitRoutingMode('MultiChannel');
      const is8Plus = detectedMaxChannels >= 8;
      const is6Ch = detectedMaxChannels >= 6 && detectedMaxChannels < 8;

      commitPatch((prev) => ({
        ...prev,
        consoleBusMode: 'multitrack_stems',
        cueRouting: is8Plus ? '7-8' : is6Ch ? '5-6' : '3-4',
        stemGroupTargets: is8Plus
          ? {
              drums_perc: '1-2',
              bass: 'ch-3',
              keys_synth: 'ch-4',
              guitars: 'ch-5',
              vocals_other: 'ch-6',
            }
          : is6Ch
          ? {
              drums_perc: 'ch-1',
              bass: 'ch-2',
              keys_synth: 'ch-3',
              guitars: 'ch-4',
              vocals_other: 'ch-4',
            }
          : {
              drums_perc: 'ch-1',
              bass: 'ch-1',
              keys_synth: 'ch-2',
              guitars: 'ch-2',
              vocals_other: 'ch-2',
            },
      }));
      showToast(
        is8Plus
          ? 'Configurado: Stems Separados (Ch 1–6) + Click/Guía (Ch 7–8)'
          : is6Ch
          ? 'Configurado: Stems en Ch 1–4 + Click/Guía en Ch 5–6'
          : 'Configurado: Stems en Ch 1–2 + Click/Guía en Ch 3–4'
      );
    } else if (scenario === 'cable_y') {
      commitRoutingMode('StereoSplit');
      showToast('Configurado: Split L/R Seguro para Cable Y (L=Músicos, R=Público)');
    } else if (scenario === 'inear_rehearsal') {
      commitRoutingMode('StereoInEar');
      showToast('Configurado: In-Ear Estéreo para Prácticas / Ensayo');
    }
  };

  // Análisis unificado de canales, colisiones CUE/FOH, fuera de rango y BT
  const patchAnalysis = analyzeStagePatch(
    routingMode,
    patch,
    detectedMaxChannels,
    songStems,
    {
      activeDeviceLabel: activeDevice?.label,
      activeDeviceLatencyMs: activeDevice?.latencyMs,
      sinkMissingOrRejected: effectiveSinkStatus === 'missing' || effectiveSinkStatus === 'rejected',
    }
  );
  const {
    isFallbackSplit: isFallbackSplitActive,
    isMultitrackFallbackToFoh,
    channelAssignments,
    cueFohConflicts,
    outOfRangeIssues,
    isBluetoothRisk,
  } = patchAnalysis;

  const matchedRigSuggestion = findMatchingVenueProfile(
    probeReport,
    venueProfiles,
    patch,
    routingMode
  );

  // Perfiles de Lugar (Local + Export / Import JSON portable)
  const handleSaveVenueProfile = () => {
    const cleanName = newProfileName.trim() || `${activeDevice?.label || 'Escenario'} (${routingMode})`;
    const nextProfile: VenueRigProfile = {
      id: `rig_${Date.now()}`,
      name: cleanName,
      deviceLabel: activeDevice?.label || 'Predeterminado',
      sinkId: patch.sinkId,
      routingMode,
      patch,
      eqPresetId: activeEqProfile.presetId,
      updatedAt: new Date().toISOString(),
    };
    const nextList = [nextProfile, ...venueProfiles.filter((p) => p.name !== cleanName)].slice(0, 12);
    setVenueProfiles(nextList);
    saveVenueProfiles(nextList);
    setNewProfileName('');
    showToast(`Perfil "${cleanName}" guardado`);
  };

  const handleApplyVenueProfile = (prof: VenueRigProfile) => {
    stopTestSignal();
    const suggestionMatch =
      matchedRigSuggestion?.profile.id === prof.id ? matchedRigSuggestion.device : null;
    const matchedDev =
      suggestionMatch ||
      probeReport?.devices.find(
        (d) => d.label && prof.deviceLabel && d.label.toLowerCase() === prof.deviceLabel.toLowerCase()
      );
    commitRoutingMode(prof.routingMode);
    commitPatch(() =>
      normalizeMultiChannelPatch({
        ...prof.patch,
        sinkId: matchedDev ? matchedDev.deviceId : prof.sinkId,
        sinkLabel: matchedDev ? matchedDev.label : prof.deviceLabel,
      })
    );
    if (prof.eqPresetId) {
      commitEqPreset(prof.eqPresetId);
    }
    showToast(`Perfil "${prof.name}" cargado en Live Concert`);
  };

  const handleDeleteVenueProfile = (id: string) => {
    const nextList = venueProfiles.filter((p) => p.id !== id);
    setVenueProfiles(nextList);
    saveVenueProfiles(nextList);
  };

  const handleExportVenueProfiles = () => {
    if (venueProfiles.length === 0) {
      showToast('No hay perfiles guardados para exportar');
      return;
    }
    const json = serializeVenueProfilesJson(venueProfiles);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tandu-stage-rigs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${venueProfiles.length} perfil(es) exportado(s)`);
  };

  const handleImportVenueProfiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseImportedVenueProfilesJson(text);
      const merged = [
        ...imported,
        ...venueProfiles.filter((ex) => !imported.some((imp) => imp.name === ex.name)),
      ].slice(0, 16);
      setVenueProfiles(merged);
      saveVenueProfiles(merged);
      showToast(`${imported.length} perfil(es) importado(s)`);
    } catch (err: any) {
      showToast(err?.message || 'Archivo de perfiles inválido');
    }
  };

  const fohTestDestinationLabel =
    routingMode === 'MultiChannel' && detectedMaxChannels >= 4
      ? patch.consoleBusMode === 'multitrack_stems' && songStems.length > 0
        ? resolveStemConsoleTarget(songStems[0], patch).target
        : patch.fohPair
      : routingMode === 'StereoSplit'
      ? 'CH 2 (R)'
      : 'L/R';

  return (
    <div className="h-screen bg-[#f8fafc] text-zinc-900 flex flex-col font-sans overflow-hidden select-none">
      {/* HEADER */}
      <header className="h-[78px] px-6 bg-white border-b border-zinc-200 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-2xl bg-[#e11d48] text-white flex items-center justify-center shadow-sm">
            <Activity size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-extrabold uppercase tracking-[0.12em] text-zinc-950">
                STAGE I/O & SOUNDCHECK PRE-SHOW
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-700 font-bold">
                {probeReport?.platformSummary || 'Universal Web Audio'}
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              Verifica hardware real en cualquier dispositivo, prueba salidas sin fugas y calibra el PA antes del show
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {statusToast && (
            <div className="px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold flex items-center gap-1.5">
              <Check size={13} className="text-emerald-600" />
              <span>{statusToast}</span>
            </div>
          )}

          <button
            type="button"
            onClick={unlockAudioDeviceNow}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border cursor-pointer transition-all ${
              ctxState === 'running'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse'
            }`}
            title="Activa/Despierta la salida de audio del dispositivo (útil en iPad, móviles y laptops)"
          >
            {ctxState === 'running' ? <CheckCircle2 size={14} /> : <Zap size={14} />}
            <span>{ctxState === 'running' ? 'Audio Activo' : 'Activar Audio'}</span>
          </button>

          <button
            type="button"
            onClick={() => runHardwareScan(false)}
            disabled={isScanning}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-zinc-100 text-zinc-800 border border-zinc-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all"
          >
            <RefreshCw size={14} className={isScanning ? 'animate-spin text-[#e11d48]' : 'text-[#e11d48]'} />
            <span>{isScanning ? 'Escaneando...' : 'Re-Escanear Hardware'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopTestSignal();
              navigate('/');
            }}
            className="px-4 py-2 rounded-xl bg-zinc-950 hover:bg-black text-white text-xs font-extrabold uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-sm transition-all"
          >
            <span>Ir a Live Concert</span>
            <ArrowRight size={14} className="text-[#e11d48]" />
          </button>
        </div>
      </header>

      {/* BODY SCROLLABLE */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 max-w-[1440px] w-full mx-auto">
        {/* BANNER AUTO-SUGERENCIA PLUG & PLAY DE PERFIL DETECTADO */}
        {matchedRigSuggestion && matchedRigSuggestion.profile.id !== dismissedMatchedRigId && (
          <div className="px-4 py-3 rounded-2xl bg-zinc-950 text-white border border-zinc-800 flex items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#e11d48] flex items-center justify-center shrink-0">
                <Radio size={16} className="animate-pulse" />
              </div>
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider">
                  Interfaz conocida detectada: {matchedRigSuggestion.device.label}
                </div>
                <p className="text-[11px] text-zinc-300">
                  Tienes guardado el perfil <strong>&ldquo;{matchedRigSuggestion.profile.name}&rdquo;</strong> ({matchedRigSuggestion.profile.routingMode}) para esta consola/interfaz.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleApplyVenueProfile(matchedRigSuggestion.profile)}
                className="px-3.5 py-1.5 rounded-xl bg-[#e11d48] hover:bg-[#be123c] text-white text-xs font-extrabold uppercase tracking-wider cursor-pointer"
              >
                Aplicar Perfil en 1 Clic
              </button>
              <button
                type="button"
                onClick={() => setDismissedMatchedRigId(matchedRigSuggestion.profile.id)}
                className="px-2.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold cursor-pointer"
              >
                Ignorar
              </button>
            </div>
          </div>
        )}

        {/* FILA 1: SEMÁFORO PRE-SHOW & ASISTENTE DE 4 ESCENARIOS */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-4 bg-white rounded-2xl border border-zinc-200 p-4 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-800 flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-[#e11d48]" /> Semáforo Pre-Show
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                  effectiveSinkStatus === 'missing' ||
                  effectiveSinkStatus === 'rejected' ||
                  cueFohConflicts.length > 0
                    ? 'bg-rose-50 text-rose-800 border-rose-300'
                    : isFallbackSplitActive || outOfRangeIssues.length > 0 || isBluetoothRisk
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                }`}
              >
                {effectiveSinkStatus === 'missing' || effectiveSinkStatus === 'rejected'
                  ? 'INTERFAZ DESCONECTADA'
                  : cueFohConflicts.length > 0
                  ? 'COLISIÓN CUE ↔ FOH'
                  : isBluetoothRisk
                  ? 'LATENCIA BLUETOOTH'
                  : isFallbackSplitActive
                  ? 'PROTECCIÓN SPLIT L/R'
                  : outOfRangeIssues.length > 0
                  ? 'REVISAR CANALES'
                  : 'LISTO PARA ESCENARIO'}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100">
                <span className="text-zinc-500">Interfaz Activa:</span>
                <span
                  className={`font-bold truncate max-w-[200px] ${
                    effectiveSinkStatus === 'missing' ? 'text-rose-700' : 'text-zinc-900'
                  }`}
                  title={activeDevice?.label}
                >
                  {effectiveSinkStatus === 'missing'
                    ? `Fallback: ${activeDevice?.label || 'Sistema'}`
                    : activeDevice?.label || 'Sistema Predeterminado'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100">
                <span className="text-zinc-500">Capacidad Real:</span>
                <span className="font-mono font-bold text-zinc-900">
                  {detectedMaxChannels} Ch &bull; {((activeDevice?.sampleRate || 48000) / 1000).toFixed(1)} kHz &bull; ~{activeDevice?.latencyMs || 0} ms
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100">
                <span className="text-zinc-500">Modo Activo:</span>
                <span className="font-bold text-[#e11d48]">
                  {routingMode === 'MultiChannel'
                    ? isFallbackSplitActive
                      ? 'Split Seguro L/R (Fallback <4ch)'
                      : patch.consoleBusMode === 'multitrack_stems'
                      ? isMultitrackFallbackToFoh
                        ? `Stems (Respaldo FOH ${patch.fohPair})`
                        : 'Multitrack Stems Discreto'
                      : `Multicanal FOH (${patch.fohPair}) + CUE (${patch.cueRouting})`
                    : routingMode === 'StereoSplit'
                    ? 'Split L/R (Cable Y)'
                    : 'In-Ear Estéreo (Ensayo)'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-zinc-500">EQ 18B ({eqScope === 'per_song' ? 'Tema' : 'Global'}):</span>
                <span className="font-mono font-bold text-zinc-800">
                  {activeEqProfile.enabled ? activeEqProfile.presetId.toUpperCase() : 'BYPASS'} &bull;{' '}
                  {activeEqProfile.limiterEnabled ? 'Limiter ON' : 'Limiter OFF'}
                  {patch.fohPolarityInvertR ? ' • R -Φ' : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Asistente de Escenario en 1 Clic */}
          <div className="col-span-8 bg-white rounded-2xl border border-zinc-200 p-4 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                  Asistente Rápido: ¿Cómo te conectaste hoy al concierto o ensayo?
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Elige el escenario del lugar para configurar automáticamente el ruteo más seguro
                </p>
              </div>
              {detectedMaxChannels < 4 && (
                <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-bold">
                  Hardware actual: 2ch (Cable Y activo si eliges Multi)
                </span>
              )}
            </div>

            <div className="grid grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => applyScenarioWizard('multichannel_bus')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                  routingMode === 'MultiChannel' && patch.consoleBusMode === 'stereo_bus'
                    ? 'bg-rose-50/70 border-[#e11d48] ring-1 ring-[#e11d48]/30'
                    : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Speaker size={18} className="text-[#e11d48]" />
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white border border-zinc-200 font-bold">
                    4+ CH
                  </span>
                </div>
                <div>
                  <div className="text-xs font-bold text-zinc-900">Consola USB (FOH + CUE)</div>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Música estéreo en 1–2 y Click/Guía aislado en 3–4.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => applyScenarioWizard('multichannel_stems')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                  routingMode === 'MultiChannel' && patch.consoleBusMode === 'multitrack_stems'
                    ? 'bg-rose-50/70 border-[#e11d48] ring-1 ring-[#e11d48]/30'
                    : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Layers size={18} className="text-[#e11d48]" />
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white border border-zinc-200 font-bold">
                    6–16 CH
                  </span>
                </div>
                <div>
                  <div className="text-xs font-bold text-zinc-900">Multipista por Stems</div>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Batería, Bajo, Pianos, Guitarras y Click en canales separados.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => applyScenarioWizard('cable_y')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                  routingMode === 'StereoSplit'
                    ? 'bg-rose-50/70 border-[#e11d48] ring-1 ring-[#e11d48]/30'
                    : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <MonitorSpeaker size={18} className="text-amber-600" />
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white border border-zinc-200 font-bold">
                    2 CH
                  </span>
                </div>
                <div>
                  <div className="text-xs font-bold text-zinc-900">Cable Y / Split L-R</div>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Funciona en cualquier laptop o tablet: L=Músicos, R=Público.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => applyScenarioWizard('inear_rehearsal')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                  routingMode === 'StereoInEar'
                    ? 'bg-rose-50/70 border-[#e11d48] ring-1 ring-[#e11d48]/30'
                    : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Headphones size={18} className="text-emerald-600" />
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white border border-zinc-200 font-bold">
                    ENSAYO
                  </span>
                </div>
                <div>
                  <div className="text-xs font-bold text-zinc-900">In-Ear / Práctica</div>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Audífonos estéreo con música + click juntos para ensayar.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* FILA 2: ESCÁNER DE HARDWARE DETECTADO */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-2xs space-y-3.5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                <Cpu size={16} />
              </div>
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                  1. Verificación de Hardware de Audio Existente en este Dispositivo
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Inspecciona en vivo cuántas salidas discretas entrega cada tarjeta o interfaz USB conectada
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {probeReport?.labelsHidden && (
                <button
                  type="button"
                  onClick={() => runHardwareScan(true)}
                  className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
                  title="El navegador oculta los nombres USB hasta otorgar permiso de audio temporal"
                >
                  <Unlock size={13} />
                  <span>Desbloquear Nombres USB</span>
                </button>
              )}
              {!probeReport?.supportsSetSinkId && (
                <span className="text-[10px] font-mono px-2.5 py-1 rounded-lg bg-zinc-100 text-zinc-600 border border-zinc-200 flex items-center gap-1">
                  <Smartphone size={12} /> Este navegador usa la salida predeterminada del sistema
                </span>
              )}
            </div>
          </div>

          {/* Diagnóstico inteligente del hardware */}
          {probeReport && (
            <div
              className={`px-4 py-2.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                probeReport.rigTier === 'multichannel_pro'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : probeReport.rigTier === 'wdm_multi_pairs'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-sky-50 border-sky-200 text-sky-900'
              }`}
            >
              {probeReport.rigTier === 'multichannel_pro' ? (
                <Check size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              )}
              <div>
                {probeReport.rigTier === 'multichannel_pro' ? (
                  <span>
                    <strong>Hardware Multicanal Detectado ({probeReport.bestMaxChannels} Canales):</strong> Tu dispositivo permite enviar pistas discretas directamente hacia la consola sin adaptadores.
                  </span>
                ) : probeReport.rigTier === 'wdm_multi_pairs' ? (
                  <span>
                    <strong>Windows WDM dividido en pares estéreo ({probeReport.wdmPairGroups.join(', ')}):</strong> Windows dividió esta interfaz en varios puertos de 2 canales. Para concierto desde navegador usa <strong>Split L/R (Cable Y)</strong> o habilita modo 5.1/7.1 en el Panel de Sonido de Windows para desbloquear canales discretos en un solo dispositivo.
                  </span>
                ) : (
                  <span>
                    <strong>Dispositivo Estéreo Universal (2 Canales):</strong> Se detectaron 2 salidas físicas (`L` y `R`). Para concierto usa <strong>Split L/R (Cable Y)</strong> (Izquierda = Músicos, Derecha = Público); para practicar usa <strong>In-Ear Estéreo</strong>.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Lista de dispositivos detectados */}
          <div className="grid grid-cols-3 gap-3">
            {(probeReport?.devices || []).map((dev, idx) => {
              const isSelected =
                (patch.sinkId === '' && dev.isDefault) || patch.sinkId === dev.deviceId;
              const devBtSuspect = isDeviceBluetoothSuspect(
                dev.label,
                dev.latencyMs,
                patch.trustedWiredDeviceLabels
              );
              return (
                <div
                  key={`${dev.deviceId}-${idx}`}
                  onClick={() => {
                    stopTestSignal();
                    commitPatch((prev) => ({
                      ...prev,
                      sinkId: dev.deviceId === 'default' ? '' : dev.deviceId,
                      sinkLabel: dev.label,
                    }));
                    setSinkStatus('ok');
                    showToast(`Interfaz activa: ${dev.label}`);
                  }}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    isSelected
                      ? 'bg-rose-50/60 border-[#e11d48] ring-1 ring-[#e11d48]/30'
                      : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-zinc-900 truncate" title={dev.label}>
                          {dev.label}
                        </span>
                        {devBtSuspect && (
                          <span className="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold shrink-0">
                            BT
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                        {dev.isDefault ? 'Predeterminado del Sistema' : 'Puerto de Audio'}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold shrink-0 border ${
                        dev.maxChannels >= 4
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-white text-zinc-700 border-zinc-300'
                      }`}
                    >
                      {dev.maxChannels} Ch
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-200/70 text-[10px] font-mono text-zinc-600">
                    <span>
                      {(dev.sampleRate / 1000).toFixed(1)} kHz &bull; ~{dev.latencyMs} ms
                    </span>
                    <span className={`font-bold ${isSelected ? 'text-[#e11d48]' : 'text-zinc-500'}`}>
                      {isSelected ? '✓ SELECCIONADA' : 'Seleccionar'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* FILA 3: PROBADOR FÍSICO CANAL POR CANAL + BUS FOH EQ 18B + RTA + CHECK POLARIDAD */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#e11d48] text-white flex items-center justify-center">
                <Volume2 size={16} />
              </div>
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                  2. Probador Físico Canal por Canal, Bus FOH (EQ 18B) & Check Anti-Fuga
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Calibración 0 VU (-18 dBFS), Walk-Test Secuencial con ID acústico y RTA/Fase sin latencia UI
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Selector de tipo de señal */}
              <div className="flex items-center bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                {(
                  [
                    { id: 'tone', label: 'Tono' },
                    { id: 'cal_minus18', label: '-18 dBFS (0 VU)' },
                    { id: 'click', label: 'Click' },
                    { id: 'pink', label: 'Ruido Rosa' },
                    { id: 'sweep', label: 'Barrido Sala' },
                  ] as { id: TestSignalType; label: string }[]
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSignalType(s.id);
                      if (activeTestTarget) stopTestSignal();
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                      signalType === s.id
                        ? 'bg-zinc-900 text-white shadow-2xs'
                        : 'text-zinc-600 hover:text-black'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Nivel de prueba en vivo */}
              <div className="flex items-center gap-2 bg-zinc-50 px-3 py-1.5 rounded-xl border border-zinc-200">
                <span className="text-[10px] font-bold text-zinc-600 uppercase">Nivel:</span>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  disabled={signalType === 'cal_minus18'}
                  value={testVolume}
                  onChange={(e) => setTestVolume(parseFloat(e.target.value))}
                  className="w-20 h-1.5 accent-[#e11d48] cursor-pointer disabled:opacity-40"
                />
                <span className="text-[10px] font-mono font-bold text-zinc-800 tabular-nums">
                  {signalType === 'cal_minus18' ? '-18 dBFS' : `${Math.round(testVolume * 100)}%`}
                </span>
              </div>

              {/* Walk-Test Secuencial Automático */}
              <button
                type="button"
                onClick={toggleWalkTest}
                className={`px-3 py-2 rounded-xl text-[10.5px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer border transition-all ${
                  isWalkTestActive
                    ? 'bg-zinc-950 text-white border-zinc-950 shadow-sm'
                    : 'bg-zinc-50 text-zinc-800 border-zinc-300 hover:bg-zinc-100'
                }`}
                title="Recorre automáticamente CH 1 → CH N enviando tonos codificados de identificación para chequear cables desde la consola"
              >
                <Radio size={13} className={isWalkTestActive ? 'text-[#e11d48] animate-pulse' : ''} />
                <span>{isWalkTestActive ? 'Detener Walk-Test' : `Walk-Test CH 1→${detectedMaxChannels}`}</span>
              </button>

              {/* Invertir Fase R (Check Polaridad Estéreo) */}
              <button
                type="button"
                onClick={() => setPolarityInvertR((v) => !v)}
                className={`px-2.5 py-2 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border cursor-pointer transition-all ${
                  polarityInvertR
                    ? 'bg-violet-600 text-white border-violet-700 shadow-xs'
                    : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                }`}
                title={
                  routingMode === 'StereoSplit' || isFallbackSplitActive
                    ? 'En Split L/R (suma L+R a R), invertir R cancela la señal a -∞ dBFS como prueba de mono-compatibilidad'
                    : 'Invierte la polaridad del canal Derecho (R) durante Probar Bus FOH'
                }
              >
                Fase R (Test): {polarityInvertR ? '-Φ' : '+Φ'}
              </button>

              {/* Probar Bus FOH (con EQ 18 Bandas) */}
              <button
                type="button"
                onClick={() => playDiscreteTestSignal('foh-dsp', 'foh_dsp')}
                className={`px-3 py-2 rounded-xl text-[10.5px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer border transition-all ${
                  activeTestTarget === 'foh-dsp'
                    ? 'bg-[#e11d48] text-white border-[#e11d48] shadow-sm'
                    : 'bg-rose-50 text-[#e11d48] border-rose-300 hover:bg-rose-100'
                }`}
                title={`Prueba el EQ de 18 Bandas + Safety Limiter hacia ${fohTestDestinationLabel}`}
              >
                <Sliders size={13} />
                <span>
                  {activeTestTarget === 'foh-dsp'
                    ? 'Detener Bus FOH'
                    : `Probar EQ 18B (${fohTestDestinationLabel})`}
                </span>
              </button>

              {/* Botón Prueba Anti-Fuga */}
              <button
                type="button"
                onClick={() => playDiscreteTestSignal('cue-isolation', 'cue_isolation')}
                className={`px-3 py-2 rounded-xl text-[10.5px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer border transition-all ${
                  activeTestTarget === 'cue-isolation'
                    ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                    : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                }`}
                title="Envía Click exclusivamente a los canales de MÚSICOS para verificar que no se filtra al Público"
              >
                <Headphones size={13} />
                <span>{activeTestTarget === 'cue-isolation' ? 'Detener CUE' : 'Prueba Anti-Fuga (Solo CUE)'}</span>
              </button>

              {activeTestTarget && (
                <button
                  type="button"
                  onClick={() => stopTestSignal()}
                  className="px-3 py-2 rounded-xl bg-zinc-950 text-white text-[10.5px] font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Square size={12} fill="currentColor" />
                  <span>Silenciar</span>
                </button>
              )}
            </div>
          </div>

          {/* Aviso explicativo si Fase R invertida está probándose en modo Split */}
          {polarityInvertR &&
            (routingMode === 'StereoSplit' || isFallbackSplitActive) &&
            activeTestTarget === 'foh-dsp' && (
              <div className="px-3.5 py-2 rounded-xl bg-violet-50 border border-violet-300 text-violet-900 text-xs">
                <strong>Nota de Prueba de Fase en Split L/R:</strong> Al sumar `L` (+Φ) y `R` (-Φ) hacia una salida mono derecha, la señal se anula intencionalmente (`-∞ dBFS`). Usa `+Φ` normal para auditar nivel en Cable Y.
              </div>
            )}

          {/* Consola de Instrumentación Zero-Re-Render: Peak Hold, Clip Latch, Correlación Fase & RTA */}
          {activeTestTarget && (
            <div className="p-3.5 rounded-xl bg-zinc-950 text-white grid grid-cols-12 gap-4 items-center">
              <div className="col-span-5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#e11d48] animate-ping" />
                    <span className="font-bold uppercase tracking-wider truncate">
                      {activeTestTarget === 'foh-dsp'
                        ? `Bus FOH + EQ 18B (${fohTestDestinationLabel})`
                        : activeTestTarget === 'cue-isolation'
                        ? 'Solo Músicos (CUE Anti-Fuga)'
                        : activeTestTarget.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span ref={dbReadoutRef} className="font-mono font-bold tabular-nums text-emerald-400">
                      -∞ dBFS
                    </span>
                    <button
                      ref={clipBadgeRef}
                      type="button"
                      data-clipped="false"
                      onClick={() => {
                        peakHoldStateRef.current.clipped = false;
                        if (clipBadgeRef.current) {
                          clipBadgeRef.current.dataset.clipped = 'false';
                          clipBadgeRef.current.classList.remove('bg-rose-600', 'text-white', 'border-rose-500');
                          clipBadgeRef.current.classList.add('bg-zinc-800', 'text-zinc-500', 'border-zinc-700');
                        }
                      }}
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border bg-zinc-800 text-zinc-500 border-zinc-700 cursor-pointer"
                      title="Indicador de saturación (> -0.15 dBFS). Clic para limpiar"
                    >
                      CLIP
                    </button>
                  </div>
                </div>

                <div className="relative h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    ref={meterBarRef}
                    className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-[#e11d48]"
                    style={{ width: '0%' }}
                  />
                  <div
                    ref={peakHoldBarRef}
                    className="absolute top-0 bottom-0 w-0.5 bg-white/90"
                    style={{ left: '0%' }}
                  />
                </div>

                {activeTestTarget === 'foh-dsp' && (
                  <div className="flex items-center gap-2.5 pt-0.5 text-[10px] font-mono">
                    <span className="text-zinc-400 uppercase">Correlación L/R:</span>
                    <div className="relative flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-600" />
                      <div
                        ref={phaseBarRef}
                        className="absolute top-0 bottom-0 w-2 -ml-1 rounded-full bg-emerald-400"
                        style={{ left: '50%' }}
                      />
                    </div>
                    <span ref={phaseTextRef} className="w-11 text-right font-bold text-emerald-400">
                      +1.00
                    </span>
                  </div>
                )}
              </div>

              <div className="col-span-7 flex flex-col gap-1">
                <div className="flex items-center justify-between text-[9.5px] font-mono text-zinc-400">
                  <span>ANALIZADOR RTA 18 BANDAS (31 Hz – 16 kHz)</span>
                  <span>{activeEqProfile.enabled ? `EQ: ${activeEqProfile.presetId.toUpperCase()}` : 'BYPASS'}</span>
                </div>
                <canvas
                  ref={rtaCanvasRef}
                  width={540}
                  height={48}
                  className="w-full h-12 rounded-lg bg-zinc-900/90 border border-zinc-800"
                />
              </div>
            </div>
          )}

          {/* Banner unificado de Alertas de Escenario */}
          <StageIoAlertsBanner
            analysis={patchAnalysis}
            detectedMaxChannels={detectedMaxChannels}
            fohPairLabel={patch.fohPair}
            activeDeviceLabel={activeDevice?.label}
            activeDeviceLatencyMs={activeDevice?.latencyMs}
            sinkStatus={effectiveSinkStatus}
            savedSinkLabel={patch.sinkLabel}
            onResetToDefaultSink={() => {
              commitPatch((prev) => ({
                ...prev,
                sinkId: '',
                sinkLabel: activeDevice?.label || '',
              }));
              setSinkStatus('idle');
              showToast('Salida restablecida al dispositivo predeterminado');
            }}
            onTrustWiredDevice={(label) => {
              commitPatch((prev) => ({
                ...prev,
                trustedWiredDeviceLabels: Array.from(
                  new Set([...(prev.trustedWiredDeviceLabels || []), label])
                ),
              }));
              showToast(`"${label}" marcado como dispositivo cableado confiable`);
            }}
          />

          {/* Grid de Canales Físicos CH 1..N */}
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2.5">
            {channelAssignments.map((info, idx) => {
              const chNum = idx + 1;
              const isAvailable = chNum <= detectedMaxChannels;
              const key = `ch-${idx}`;
              const isTestingThis = activeTestTarget === key;

              return (
                <div
                  key={key}
                  className={`p-3 rounded-2xl border flex flex-col justify-between gap-2 transition-all ${
                    isTestingThis
                      ? 'bg-rose-50 border-[#e11d48] ring-2 ring-[#e11d48]/25'
                      : isAvailable
                      ? 'bg-zinc-50 border-zinc-200'
                      : 'bg-zinc-100/60 border-zinc-200/70 opacity-55'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-extrabold text-zinc-900">CH {chNum}</span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                        isAvailable
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-zinc-200 text-zinc-600'
                      }`}
                    >
                      {isAvailable ? 'DISPONIBLE' : 'NO EXP.'}
                    </span>
                  </div>

                  {/* Roles asignados en este canal */}
                  <div className="min-h-[34px] flex flex-wrap gap-1 items-start">
                    {info.roles.length === 0 ? (
                      <span className="text-[10px] text-zinc-400 italic">Libre</span>
                    ) : (
                      info.roles.map((r, rIdx) => (
                        <span
                          key={rIdx}
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border truncate max-w-full ${
                            r.kind === 'cue'
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : r.kind === 'foh'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-sky-50 text-sky-800 border-sky-200'
                          }`}
                          title={r.label}
                        >
                          {r.label}
                        </span>
                      ))
                    )}
                  </div>

                  {/* Barra real de dBFS en el canal activo (DOM ref sin re-render) */}
                  <div className="w-full h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      ref={(el) => {
                        activeChannelBarRefs.current[key] = el;
                      }}
                      className="h-full bg-[#e11d48]"
                      style={{ width: '0%' }}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={!isAvailable}
                    onClick={() => playDiscreteTestSignal(key, 'single_channel', idx)}
                    className={`w-full py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1 transition-all cursor-pointer disabled:cursor-not-allowed ${
                      isTestingThis
                        ? 'bg-[#e11d48] text-white'
                        : 'bg-white hover:bg-zinc-900 hover:text-white text-zinc-800 border border-zinc-300'
                    }`}
                    title={
                      isAvailable
                        ? `Enviar señal de prueba únicamente al Canal físico ${chNum}`
                        : `La interfaz actual solo expone ${detectedMaxChannels} canales`
                    }
                  >
                    {isTestingThis ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                    <span>{isTestingThis ? 'Detener' : `Probar CH ${chNum}`}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* FILA 4: PATCHBAY DETALLADO (GRUPOS, REGLAS GLOBALES Y STEMS) + PERFILES DE LUGAR */}
        <div className="grid grid-cols-12 gap-4">
          {/* Patchbay Detallado (8 cols) */}
          <div className="col-span-8 bg-white rounded-2xl border border-zinc-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                  3. Asignación de Canales a Consola & Pistas de Canción
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Todo ajuste se sincroniza en tiempo real con Live Concert sin cortar el audio
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={routingMode}
                  onChange={(e) => {
                    stopTestSignal();
                    commitRoutingMode(e.target.value as RoutingMode);
                  }}
                  className="bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-1.5 text-xs font-bold text-zinc-900 outline-none"
                >
                  <option value="StereoInEar">🎧 In-Ear Estéreo</option>
                  <option value="StereoSplit">🔀 Split L/R (Cable Y)</option>
                  <option value="MultiChannel">🎛️ USB Multicanal</option>
                </select>

                {routingMode === 'MultiChannel' && (
                  <select
                    value={patch.cueRouting}
                    onChange={(e) =>
                      commitPatch((prev) => ({
                        ...prev,
                        cueRouting: e.target.value as MultiChannelPatchConfig['cueRouting'],
                      }))
                    }
                    className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-1.5 text-xs font-bold text-amber-900 outline-none"
                    title="Canales de salida para Click + Voz Guía (Músicos)"
                  >
                    {CUE_ROUTING_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        CUE: {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={eqScope}
                  onChange={(e) => commitEqScope(e.target.value as EqMemoryScope)}
                  className="bg-zinc-50 border border-zinc-300 rounded-xl px-2.5 py-1.5 text-[11px] font-bold text-zinc-800 outline-none"
                  title="Define si el EQ 18B aplica igual a todo el show o se guarda por canción"
                >
                  <option value="global">EQ: Global Show</option>
                  <option value="per_song">EQ: Por Canción</option>
                </select>
              </div>
            </div>

            {routingMode === 'MultiChannel' ? (
              patch.consoleBusMode === 'stereo_bus' ? (
                <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center justify-between gap-4">
                  <div>
                    <span className="text-xs font-bold text-zinc-900 block">
                      Modo Bus FOH Estéreo + CUE
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      La mezcla musical pasa por el EQ de 18 Bandas y sale en estéreo hacia el par elegido.
                    </span>
                  </div>
                  <select
                    value={patch.fohPair}
                    onChange={(e) =>
                      commitPatch((prev) => ({
                        ...prev,
                        fohPair: e.target.value as MultiChannelPatchConfig['fohPair'],
                      }))
                    }
                    className="bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-bold text-zinc-900 outline-none"
                  >
                    {CONSOLE_PAIR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        FOH Público: {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-700">
                      Grupos de Stems hacia Salidas Físicas
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRoleRules((v) => !v)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border cursor-pointer ${
                          showRoleRules || Object.keys(patch.stemRoleRules || {}).length > 0
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        Reglas Multi-Repertorio ({Object.keys(patch.stemRoleRules || {}).length})
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          commitPatch((prev) => ({
                            ...prev,
                            applyEqToStems: !prev.applyEqToStems,
                          }))
                        }
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border cursor-pointer transition-all ${
                          patch.applyEqToStems
                            ? 'bg-[#e11d48] text-white border-[#e11d48]'
                            : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-400'
                        }`}
                        title="Elige si los stems pasan por el EQ de 18 Bandas + Safety Limiter o salen en Direct Out crudo hacia consola"
                      >
                        {patch.applyEqToStems
                          ? 'EQ 18B + Limiter: ACTIVO EN STEMS'
                          : 'DIRECT OUT PURO (Sin EQ)'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {STEM_BUS_GROUPS.map((grp) => (
                      <div
                        key={grp.id}
                        className="p-2.5 rounded-xl bg-zinc-50 border border-zinc-200 flex flex-col justify-between gap-1.5"
                      >
                        <span className={`text-[9.5px] font-extrabold px-1.5 py-0.5 rounded border truncate ${grp.colorClass}`}>
                          {grp.label}
                        </span>
                        <select
                          value={patch.stemGroupTargets[grp.id]}
                          onChange={(e) =>
                            commitPatch((prev) => ({
                              ...prev,
                              stemGroupTargets: {
                                ...prev.stemGroupTargets,
                                [grp.id]: e.target.value as ConsoleTargetAssignment,
                              },
                            }))
                          }
                          className="w-full bg-white border border-zinc-300 rounded-lg px-2 py-1 text-[10.5px] font-mono font-bold text-zinc-900 outline-none"
                        >
                          {ALL_CONSOLE_TARGET_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {/* Reglas globales por rol de instrumento (aplica a todo el setlist sin depender de UUIDs) */}
                  {showRoleRules && (
                    <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-800 block">
                            Reglas Declarativas por Rol (Todo el Repertorio)
                          </span>
                          <span className="text-[10.5px] text-zinc-500">
                            Se aplican automáticamente en cualquier canción según el nombre del stem (ej. Bombo, Bajo, Piano).
                          </span>
                        </div>
                        {Object.keys(patch.stemRoleRules || {}).length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              commitPatch((prev) => ({ ...prev, stemRoleRules: {} }))
                            }
                            className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                          >
                            Limpiar Reglas
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {STEM_ROLE_RULES.map((rule) => {
                          const curVal = patch.stemRoleRules?.[rule.key] || '';
                          return (
                            <div
                              key={rule.key}
                              className="bg-white px-2.5 py-1.5 rounded-xl border border-zinc-200 flex items-center justify-between gap-2"
                            >
                              <span className="text-[10.5px] font-semibold text-zinc-800 truncate">
                                {rule.label}
                              </span>
                              <select
                                value={curVal}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  commitPatch((prev) => {
                                    const nextRules = { ...(prev.stemRoleRules || {}) };
                                    if (!val) delete nextRules[rule.key as StemRuleKey];
                                    else nextRules[rule.key as StemRuleKey] = val as ConsoleTargetAssignment;
                                    return { ...prev, stemRoleRules: nextRules };
                                  });
                                }}
                                className="bg-zinc-50 border border-zinc-300 rounded-lg px-1.5 py-1 text-[10px] font-mono font-bold text-zinc-900 outline-none max-w-[125px]"
                              >
                                <option value="">Grupo ({patch.stemGroupTargets[rule.group]})</option>
                                {ALL_CONSOLE_TARGET_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Overrides por stem individual de una canción del repertorio */}
                  <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Music size={14} className="text-[#e11d48]" />
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-800">
                          Excepciones por Pista Individual (Opcional)
                        </span>
                      </div>
                      <select
                        value={selectedSongId}
                        onChange={(e) => setSelectedSongId(e.target.value)}
                        className="bg-white border border-zinc-300 rounded-lg px-2.5 py-1 text-xs font-semibold text-zinc-900 outline-none max-w-[240px]"
                      >
                        {songs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isLoadingStems ? (
                      <div className="text-[11px] text-zinc-500">Cargando pistas de la canción...</div>
                    ) : songStems.length === 0 ? (
                      <div className="text-[11px] text-zinc-500 italic">
                        Esta canción no tiene pistas separadas en Stem Studio (usará el Bus FOH Estéreo).
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {songStems.map((st) => {
                          const overrideVal = patch.stemOverrides?.[st.id] || '';
                          const inherited = resolveStemConsoleTarget(
                            { id: st.id, name: st.name, group: st.group, category: st.category },
                            { ...patch, stemOverrides: {} }
                          );
                          return (
                            <div
                              key={st.id}
                              className="bg-white px-2.5 py-2 rounded-xl border border-zinc-200 flex items-center justify-between gap-2"
                            >
                              <span className="text-[11px] font-semibold text-zinc-800 truncate" title={st.name}>
                                {st.name}
                              </span>
                              <select
                                value={overrideVal}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  commitPatch((prev) => {
                                    const nextOverrides = { ...(prev.stemOverrides || {}) };
                                    if (!val) delete nextOverrides[st.id];
                                    else nextOverrides[st.id] = val as ConsoleTargetAssignment;
                                    return { ...prev, stemOverrides: nextOverrides };
                                  });
                                }}
                                className="bg-zinc-50 border border-zinc-300 rounded-lg px-1.5 py-1 text-[10px] font-mono font-bold text-zinc-900 outline-none max-w-[130px]"
                              >
                                <option value="">
                                  {inherited.source === 'role_rule' ? 'Regla' : 'Grupo'} ({inherited.target})
                                </option>
                                {ALL_CONSOLE_TARGET_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-600">
                {routingMode === 'StereoSplit'
                  ? 'Modo Split L/R activo: Canal Izquierdo (CH 1 / L) = Músicos (Click + Voz Guía), Canal Derecho (CH 2 / R) = Público (Música FOH con EQ de 18 Bandas).'
                  : 'Modo In-Ear Estéreo activo: Tanto la música FOH como el Click/Guía salen centrados en tus audífonos L/R (ideal para ensayos).'}
              </div>
            )}

            {/* Barra de Calibración Live: Balance Click vs Guía, Polaridad Show & Offset Wi-Fi Sync */}
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-zinc-100">
              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-zinc-700">
                  <span>Balance CUE (Click ↔ Guía)</span>
                  <span className="font-mono text-amber-800">
                    {(patch.cueBalance || 0) === 0
                      ? '50/50'
                      : (patch.cueBalance || 0) < 0
                      ? `+Click`
                      : `+Guía`}
                  </span>
                </div>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.1"
                  value={patch.cueBalance || 0}
                  onChange={(e) =>
                    commitPatch((prev) => ({ ...prev, cueBalance: parseFloat(e.target.value) }))
                  }
                  className="w-full h-1.5 accent-amber-600 cursor-pointer"
                />
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-zinc-700">
                  <span>Compensación Wi-Fi Sync</span>
                  <span className="font-mono text-zinc-900">
                    {Math.round((activeDevice?.latencyMs || 0) + (patch.syncOffsetMs || 0))} ms total
                  </span>
                </div>
                <input
                  type="range"
                  min="-150"
                  max="250"
                  step="5"
                  value={patch.syncOffsetMs || 0}
                  onChange={(e) =>
                    commitPatch((prev) => ({
                      ...prev,
                      syncOffsetMs: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  className="w-full h-1.5 accent-zinc-900 cursor-pointer"
                />
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold uppercase text-zinc-700 block">
                    Polaridad R en Show
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    Corrige cable XLR invertido en vivo
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    commitPatch((prev) => ({
                      ...prev,
                      fohPolarityInvertR: !prev.fohPolarityInvertR,
                    }))
                  }
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold border cursor-pointer ${
                    patch.fohPolarityInvertR
                      ? 'bg-violet-600 text-white border-violet-700'
                      : 'bg-white text-zinc-700 border-zinc-300'
                  }`}
                >
                  {patch.fohPolarityInvertR ? '-Φ INV' : '+Φ NORM'}
                </button>
              </div>
            </div>
          </div>

          {/* Perfiles Guardados por Lugar / Consola (4 cols) */}
          <div className="col-span-4 bg-white rounded-2xl border border-zinc-200 p-5 shadow-2xs flex flex-col justify-between gap-3">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BookmarkCheck size={16} className="text-[#e11d48]" />
                  <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                    4. Perfiles de Lugar / Rig
                  </h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleExportVenueProfiles}
                    className="p-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 cursor-pointer"
                    title="Exportar perfiles (.json) para respaldo USB u otro portátil"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => profileImportInputRef.current?.click()}
                    className="p-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 cursor-pointer"
                    title="Importar perfiles (.json)"
                  >
                    <Upload size={13} />
                  </button>
                  <input
                    ref={profileImportInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportVenueProfiles}
                    className="hidden"
                  />
                </div>
              </div>
              <p className="text-[11px] text-zinc-500">
                Guarda o exporta la configuración de tu iglesia, auditorio o ensayo para aplicarla en 1 clic.
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Ej. Iglesia Principal XR18..."
                  className="flex-1 bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-1.5 text-xs text-zinc-900 outline-none focus:border-[#e11d48]"
                />
                <button
                  type="button"
                  onClick={handleSaveVenueProfile}
                  className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Save size={13} />
                  <span>Guardar</span>
                </button>
              </div>

              <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                {venueProfiles.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-zinc-200 text-center text-[11px] text-zinc-400">
                    Aún no tienes perfiles guardados en este dispositivo.
                  </div>
                ) : (
                  venueProfiles.map((prof) => {
                    const deviceConnected = probeReport?.devices.some(
                      (d) =>
                        d.label &&
                        prof.deviceLabel &&
                        d.label.toLowerCase() === prof.deviceLabel.toLowerCase()
                    );
                    return (
                      <div
                        key={prof.id}
                        className="p-2.5 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-zinc-900 truncate">{prof.name}</span>
                            {deviceConnected && (
                              <span className="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold shrink-0">
                                CONECTADA
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500 truncate">
                            {prof.routingMode} &bull; {prof.deviceLabel}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleApplyVenueProfile(prof)}
                            className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#e11d48] hover:text-white text-zinc-800 border border-zinc-300 text-[10px] font-bold cursor-pointer transition-all"
                          >
                            Aplicar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteVenueProfile(prof.id)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                            title="Eliminar perfil"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
