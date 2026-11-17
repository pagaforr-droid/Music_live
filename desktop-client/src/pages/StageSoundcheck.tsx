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
  Headphones,
  Layers,
  MonitorSpeaker,
  Music,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Speaker,
  Square,
  Trash2,
  Unlock,
  Volume2,
  Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { detectInstrumentCategory } from '../utils/instrumentIcons';
import {
  ALL_CONSOLE_TARGET_OPTIONS,
  CONSOLE_PAIR_OPTIONS,
  CUE_ROUTING_OPTIONS,
  ConsoleTargetAssignment,
  DEFAULT_MULTICHANNEL_PATCH,
  DEFAULT_STAGE_EQ_PROFILE,
  HardwareProbeReport,
  LIVE_STORAGE_KEYS,
  MultiChannelPatchConfig,
  RoutingMode,
  STAGE_EQ_PRESETS,
  STEM_BUS_GROUPS,
  StageEqProfile,
  VenueRigProfile,
  computeRequiredMergerChannels,
  loadNormalizedMultiChannelPatch,
  loadStoredJson,
  loadStoredRoutingMode,
  loadVenueProfiles,
  mapInstrumentCategoryToBusGroup,
  notifyStageIoUpdated,
  probeAudioHardware,
  resolveConsoleTarget,
  resolveCueIndices,
  resolvePairIndices,
  saveVenueProfiles,
  subscribeStageIoUpdates,
} from '../utils/liveConsoleDSP';

type TestSignalType = 'tone' | 'click' | 'pink';

interface SongStemRow {
  id: string;
  name: string;
  group: ReturnType<typeof mapInstrumentCategoryToBusGroup>;
}

interface SongOption {
  id: string;
  title: string;
}

const FAKE_BAND_ID = '00000000-0000-0000-0000-000000000000';

export default function StageSoundcheck() {
  const navigate = useNavigate();

  const [routingMode, setRoutingMode] = useState<RoutingMode>(() => loadStoredRoutingMode());
  const [patch, setPatch] = useState<MultiChannelPatchConfig>(() => loadNormalizedMultiChannelPatch());
  const [eqProfile, setEqProfile] = useState<StageEqProfile>(() =>
    loadStoredJson<StageEqProfile>(LIVE_STORAGE_KEYS.EQ_GLOBAL, DEFAULT_STAGE_EQ_PROFILE)
  );

  const [probeReport, setProbeReport] = useState<HardwareProbeReport | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [ctxState, setCtxState] = useState<AudioContextState>('suspended');

  // Test Signal State
  const [signalType, setSignalType] = useState<TestSignalType>('tone');
  const [activeTestTarget, setActiveTestTarget] = useState<string | null>(null); // 'ch-0', 'cue-isolation', etc.
  const [testVolume, setTestVolume] = useState<number>(0.45);
  const [testLevelPulse, setTestLevelPulse] = useState<number>(0);

  // Venue Profiles
  const [venueProfiles, setVenueProfiles] = useState<VenueRigProfile[]>(() => loadVenueProfiles());
  const [newProfileName, setNewProfileName] = useState<string>('');
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Songs / Stems preview for individual stem overrides
  const [songs, setSongs] = useState<SongOption[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string>('');
  const [songStems, setSongStems] = useState<SongStemRow[]>([]);
  const [isLoadingStems, setIsLoadingStems] = useState<boolean>(false);

  const testCtxRef = useRef<AudioContext | null>(null);
  const testStopCleanupRef = useRef<(() => void) | null>(null);
  const pulseIntervalRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setStatusToast(msg);
    window.setTimeout(() => setStatusToast(null), 2600);
  };

  // Persist changes & broadcast immediately to Live Concert
  const commitRoutingMode = (next: RoutingMode) => {
    setRoutingMode(next);
    try {
      localStorage.setItem(LIVE_STORAGE_KEYS.ROUTING_MODE, next);
    } catch {}
    notifyStageIoUpdated('soundcheck');
  };

  const commitPatch = (updater: (prev: MultiChannelPatchConfig) => MultiChannelPatchConfig) => {
    setPatch((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(LIVE_STORAGE_KEYS.MC_PATCH, JSON.stringify(next));
      } catch {}
      notifyStageIoUpdated('soundcheck');
      return next;
    });
  };

  const commitEqPreset = (presetId: string) => {
    const found = STAGE_EQ_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setEqProfile((prev) => {
      const next: StageEqProfile = {
        ...prev,
        enabled: true,
        presetId: found.id,
        hpfFreq: found.hpfFreq,
        gains: [...found.gains],
      };
      try {
        localStorage.setItem(LIVE_STORAGE_KEYS.EQ_GLOBAL, JSON.stringify(next));
      } catch {}
      notifyStageIoUpdated('soundcheck');
      return next;
    });
    showToast(`Preset EQ "${found.name}" aplicado para Live Concert`);
  };

  // Listen to updates from LiveConcert if edited in another tab/view
  useEffect(() => {
    return subscribeStageIoUpdates(() => {
      setRoutingMode(loadStoredRoutingMode());
      setPatch(loadNormalizedMultiChannelPatch());
      setEqProfile(loadStoredJson<StageEqProfile>(LIVE_STORAGE_KEYS.EQ_GLOBAL, DEFAULT_STAGE_EQ_PROFILE));
    });
  }, []);

  const ensureTestContext = async (): Promise<AudioContext> => {
    if (!testCtxRef.current || testCtxRef.current.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      testCtxRef.current = new AudioContextClass();
    }
    const ctx = testCtxRef.current;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }
    if (typeof (ctx as any).setSinkId === 'function' && patch.sinkId !== undefined) {
      try {
        await (ctx as any).setSinkId(patch.sinkId === 'default' ? '' : patch.sinkId);
      } catch {}
    }
    setCtxState(ctx.state);
    return ctx;
  };

  const stopTestSignal = () => {
    if (testStopCleanupRef.current) {
      try {
        testStopCleanupRef.current();
      } catch {}
      testStopCleanupRef.current = null;
    }
    if (pulseIntervalRef.current) {
      window.clearInterval(pulseIntervalRef.current);
      pulseIntervalRef.current = null;
    }
    setActiveTestTarget(null);
    setTestLevelPulse(0);
  };

  const runHardwareScan = async (unlockLabels = false) => {
    setIsScanning(true);
    stopTestSignal();
    try {
      const report = await probeAudioHardware({ unlockLabels });
      setProbeReport(report);
      try {
        localStorage.setItem(LIVE_STORAGE_KEYS.LAST_SOUNDCHECK, JSON.stringify(report));
      } catch {}

      // Si el sinkId guardado ya no existe pero el sinkLabel coincide, re-vincular automáticamente
      if (patch.sinkLabel) {
        const byLabel = report.devices.find(
          (d) => d.label && d.label.toLowerCase() === patch.sinkLabel?.toLowerCase()
        );
        if (byLabel && byLabel.deviceId !== patch.sinkId) {
          commitPatch((prev) => ({ ...prev, sinkId: byLabel.deviceId }));
        }
      }
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    runHardwareScan(false);
    fetchAvailableSongs();

    const onDeviceChange = () => {
      runHardwareScan(false);
    };
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
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
          .map((r: any) => ({
            id: r.id,
            name: r.name,
            group: mapInstrumentCategoryToBusGroup(
              detectInstrumentCategory(r.name || '', r.metadata?.instrument_icon)
            ),
          }));
        setSongStems(filtered);
      } finally {
        if (!cancelled) setIsLoadingStems(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSongId]);

  const activeDevice =
    probeReport?.devices.find((d) => d.deviceId === patch.sinkId) ||
    probeReport?.devices.find((d) => d.isDefault) ||
    probeReport?.devices[0];
  const detectedMaxChannels = activeDevice?.maxChannels || 2;

  const unlockAudioDeviceNow = async () => {
    const ctx = await ensureTestContext();
    // Breve impulso silencioso para garantizar desbloqueo en iOS/Safari/Chrome
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
   * Genera señal de prueba quirúrgica (Tono, Click o Ruido Rosa) hacia canales discretos exactos
   */
  const playDiscreteTestSignal = async (
    targetKey: string,
    mode: 'single_channel' | 'cue_isolation',
    channelIdx0 = 0
  ) => {
    if (activeTestTarget === targetKey) {
      stopTestSignal();
      return;
    }
    stopTestSignal();

    const ctx = await ensureTestContext();
    const maxCh = ctx.destination.maxChannelCount || 2;

    const masterTestGain = ctx.createGain();
    masterTestGain.gain.value = testVolume;

    let merger: ChannelMergerNode | null = null;
    let panner: StereoPannerNode | null = null;

    if (mode === 'cue_isolation') {
      if (routingMode === 'MultiChannel' && maxCh >= 4) {
        const reqCh = Math.min(maxCh, computeRequiredMergerChannels(patch, maxCh));
        try {
          ctx.destination.channelInterpretation = 'discrete';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = reqCh;
        } catch {}
        merger = ctx.createChannelMerger(reqCh);
        merger.channelInterpretation = 'discrete';
        merger.connect(ctx.destination);

        const cuePatch = resolveCueIndices(patch.cueRouting, reqCh);
        masterTestGain.connect(merger, 0, cuePatch.leftIdx);
        if (!cuePatch.isMono && cuePatch.rightIdx !== cuePatch.leftIdx) {
          masterTestGain.connect(merger, 0, cuePatch.rightIdx);
        }
      } else {
        try {
          ctx.destination.channelInterpretation = 'speakers';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = Math.min(2, maxCh);
        } catch {}
        panner = ctx.createStereoPanner();
        panner.pan.value = routingMode === 'StereoSplit' ? -1 : 0;
        masterTestGain.connect(panner);
        panner.connect(ctx.destination);
      }
    } else {
      // Prueba de un solo canal físico discreto (CH 1..N)
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
        masterTestGain.connect(merger, 0, Math.min(channelIdx0, reqCh - 1));
      } else {
        try {
          ctx.destination.channelInterpretation = 'speakers';
          ctx.destination.channelCountMode = 'explicit';
          ctx.destination.channelCount = Math.min(2, maxCh);
        } catch {}
        panner = ctx.createStereoPanner();
        panner.pan.value = channelIdx0 % 2 === 0 ? -1 : 1;
        masterTestGain.connect(panner);
        panner.connect(ctx.destination);
      }
    }

    const activeStopFns: (() => void)[] = [];
    const chosenSignal: TestSignalType = mode === 'cue_isolation' ? 'click' : signalType;

    if (chosenSignal === 'pink') {
      // Buffer de Ruido Rosa (-18 dBFS suave, loop continuo sin clics)
      const len = ctx.sampleRate * 2;
      const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
      }
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.connect(masterTestGain);
      src.start();
      activeStopFns.push(() => {
        try { src.stop(); src.disconnect(); } catch {}
      });
      setTestLevelPulse(0.85);
    } else {
      let beatStep = 0;
      const firePulse = () => {
        if (!testCtxRef.current || testCtxRef.current.state !== 'running') return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();

        if (chosenSignal === 'click') {
          const isDownbeat = beatStep % 4 === 0;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(isDownbeat ? 1200 : 800, now);
          env.gain.setValueAtTime(0.0001, now);
          env.gain.exponentialRampToValueAtTime(isDownbeat ? 0.65 : 0.42, now + 0.004);
          env.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
          osc.connect(env);
          env.connect(masterTestGain);
          osc.start(now);
          osc.stop(now + 0.075);
          beatStep++;
        } else {
          // Tono armónico de identificación agradable (440 Hz -> 554 Hz suave)
          const freqs = [440, 554.37, 659.25, 554.37];
          const f = freqs[beatStep % freqs.length];
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, now);
          env.gain.setValueAtTime(0.0001, now);
          env.gain.linearRampToValueAtTime(0.45, now + 0.025);
          env.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
          osc.connect(env);
          env.connect(masterTestGain);
          osc.start(now);
          osc.stop(now + 0.48);
          beatStep++;
        }

        setTestLevelPulse(1);
        window.setTimeout(() => setTestLevelPulse(0.25), 140);
      };

      firePulse();
      pulseIntervalRef.current = window.setInterval(firePulse, chosenSignal === 'click' ? 500 : 650);
    }

    testStopCleanupRef.current = () => {
      activeStopFns.forEach((fn) => fn());
      try { masterTestGain.disconnect(); } catch {}
      try { merger?.disconnect(); } catch {}
      try { panner?.disconnect(); } catch {}
    };
    setActiveTestTarget(targetKey);
  };

  // Asistente de 4 Escenarios Universales
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
      const use8ChLayout = detectedMaxChannels >= 8;
      commitPatch((prev) => ({
        ...prev,
        consoleBusMode: 'multitrack_stems',
        cueRouting: use8ChLayout ? '7-8' : '3-4',
        stemGroupTargets: use8ChLayout
          ? {
              drums_perc: '1-2',
              bass: 'ch-3',
              keys_synth: 'ch-4',
              guitars: 'ch-5',
              vocals_other: 'ch-6',
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
        use8ChLayout
          ? 'Configurado: Stems Separados (Ch 1–6) + Click/Guía (Ch 7–8)'
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

  // Mapeo inverso: qué roles salen por cada canal físico (1..16) + detección de conflictos
  const channelCountToDisplay = Math.max(4, Math.min(16, detectedMaxChannels >= 4 ? detectedMaxChannels : 4));
  const channelAssignments: { roles: { label: string; kind: 'foh' | 'cue' | 'stem' }[] }[] = Array.from(
    { length: channelCountToDisplay },
    () => ({ roles: [] })
  );

  if (routingMode === 'StereoInEar') {
    channelAssignments[0].roles.push({ label: 'FOH L + CUE', kind: 'foh' });
    channelAssignments[1].roles.push({ label: 'FOH R + CUE', kind: 'foh' });
  } else if (routingMode === 'StereoSplit' || (routingMode === 'MultiChannel' && detectedMaxChannels < 4)) {
    channelAssignments[0].roles.push({ label: 'MÚSICOS (Click/Guía)', kind: 'cue' });
    channelAssignments[1].roles.push({ label: 'PÚBLICO (FOH Mono)', kind: 'foh' });
  } else {
    const cuePos = resolveCueIndices(patch.cueRouting, channelCountToDisplay);
    if (cuePos.isMono) {
      channelAssignments[cuePos.leftIdx]?.roles.push({ label: 'CUE (Click+Guía)', kind: 'cue' });
    } else {
      channelAssignments[cuePos.leftIdx]?.roles.push({ label: 'CUE L (Click)', kind: 'cue' });
      channelAssignments[cuePos.rightIdx]?.roles.push({ label: 'CUE R (Guía)', kind: 'cue' });
    }

    if (patch.consoleBusMode === 'stereo_bus') {
      const [fL, fR] = resolvePairIndices(patch.fohPair, channelCountToDisplay);
      channelAssignments[fL]?.roles.push({ label: 'FOH Público L', kind: 'foh' });
      channelAssignments[fR]?.roles.push({ label: 'FOH Público R', kind: 'foh' });
    } else {
      STEM_BUS_GROUPS.forEach((grp) => {
        const res = resolveConsoleTarget(patch.stemGroupTargets[grp.id], channelCountToDisplay);
        if (res.isMono) {
          channelAssignments[res.leftIdx]?.roles.push({ label: grp.label, kind: 'stem' });
        } else {
          channelAssignments[res.leftIdx]?.roles.push({ label: `${grp.label} (L)`, kind: 'stem' });
          channelAssignments[res.rightIdx]?.roles.push({ label: `${grp.label} (R)`, kind: 'stem' });
        }
      });
      songStems.forEach((st) => {
        const override = patch.stemOverrides?.[st.id];
        if (!override) return;
        const res = resolveConsoleTarget(override, channelCountToDisplay);
        if (res.isMono) {
          channelAssignments[res.leftIdx]?.roles.push({ label: `${st.name} (Solo)`, kind: 'stem' });
        } else {
          channelAssignments[res.leftIdx]?.roles.push({ label: `${st.name} (L)`, kind: 'stem' });
          channelAssignments[res.rightIdx]?.roles.push({ label: `${st.name} (R)`, kind: 'stem' });
        }
      });
    }
  }

  const cueFohConflicts = channelAssignments
    .map((ch, idx) => ({
      chNum: idx + 1,
      hasCue: ch.roles.some((r) => r.kind === 'cue'),
      hasMusic: ch.roles.some((r) => r.kind === 'foh' || r.kind === 'stem'),
    }))
    .filter((c) => c.hasCue && c.hasMusic);

  // Perfiles de Lugar
  const handleSaveVenueProfile = () => {
    const cleanName = newProfileName.trim() || `${activeDevice?.label || 'Escenario'} (${routingMode})`;
    const nextProfile: VenueRigProfile = {
      id: `rig_${Date.now()}`,
      name: cleanName,
      deviceLabel: activeDevice?.label || 'Predeterminado',
      sinkId: patch.sinkId,
      routingMode,
      patch,
      eqPresetId: eqProfile.presetId,
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
    const matchedDev = probeReport?.devices.find(
      (d) => d.label && prof.deviceLabel && d.label.toLowerCase() === prof.deviceLabel.toLowerCase()
    );
    commitRoutingMode(prof.routingMode);
    commitPatch(() => ({
      ...DEFAULT_MULTICHANNEL_PATCH,
      ...prof.patch,
      sinkId: matchedDev ? matchedDev.deviceId : prof.sinkId,
      sinkLabel: matchedDev ? matchedDev.label : prof.deviceLabel,
    }));
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

  const isFallbackSplitActive = routingMode === 'MultiChannel' && detectedMaxChannels < 4;

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
              Verifica el hardware conectado en el evento, prueba canal por canal sin fugas y deja listo Live Concert
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
        {/* FILA 1: SEMÁFORO PRE-SHOW & ASISTENTE DE 4 ESCENARIOS */}
        <div className="grid grid-cols-12 gap-4">
          {/* Semáforo de Estado en Vivo (4 cols) */}
          <div className="col-span-4 bg-white rounded-2xl border border-zinc-200 p-4 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-800 flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-[#e11d48]" /> Semáforo Pre-Show
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                  isFallbackSplitActive || (routingMode === 'MultiChannel' && cueFohConflicts.length > 0)
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                }`}
              >
                {isFallbackSplitActive
                  ? 'PROTECCIÓN SPLIT L/R'
                  : routingMode === 'MultiChannel' && cueFohConflicts.length > 0
                  ? 'REVISAR CRUCE DE CANAL'
                  : 'LISTO PARA ESCENARIO'}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100">
                <span className="text-zinc-500">Interfaz Activa:</span>
                <span className="font-bold text-zinc-900 truncate max-w-[200px]" title={activeDevice?.label}>
                  {activeDevice?.label || 'Sistema Predeterminado'}
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
                      ? 'Multitrack Stems Discreto'
                      : `Multicanal FOH (${patch.fohPair}) + CUE (${patch.cueRouting})`
                    : routingMode === 'StereoSplit'
                    ? 'Split L/R (Cable Y)'
                    : 'In-Ear Estéreo (Ensayo)'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-zinc-500">EQ 18B + Safety Limiter:</span>
                <span className="font-mono font-bold text-zinc-800">
                  {eqProfile.enabled ? eqProfile.presetId.toUpperCase() : 'BYPASS'} &bull;{' '}
                  {eqProfile.limiterEnabled ? 'Limiter ON (-0.3 dBFS)' : 'Limiter OFF'}
                </span>
              </div>
            </div>
          </div>

          {/* Asistente de Escenario en 1 Clic (8 cols) */}
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
                    <strong>Modo Windows WDM por Pares Estéreo ({probeReport.wdmPairGroups.join(', ') || 'Múltiples salidas de 2 ch'}):</strong> Windows dividió o limitó las salidas a 2 canales por puerto. En navegador web, el modo más seguro para concierto es <strong>Split L/R (Cable Y)</strong> o configurar la interfaz en 5.1/7.1 en el Panel de Sonido de Windows.
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
              return (
                <div
                  key={`${dev.deviceId}-${idx}`}
                  onClick={() => {
                    commitPatch((prev) => ({
                      ...prev,
                      sinkId: dev.deviceId === 'default' ? '' : dev.deviceId,
                      sinkLabel: dev.label,
                    }));
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
                      <div className="text-xs font-bold text-zinc-900 truncate" title={dev.label}>
                        {dev.label}
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

        {/* FILA 3: PROBADOR FÍSICO CANAL POR CANAL (CH 1..16) + PRUEBA ANTI-FUGA */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#e11d48] text-white flex items-center justify-center">
                <Volume2 size={16} />
              </div>
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                  2. Probador Físico Canal por Canal (Soundcheck en Consola)
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Envía una señal limpia a un solo canal físico a la vez para confirmar con el sonidista cada entrada de la consola
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Selector de tipo de señal */}
              <div className="flex items-center bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                {(
                  [
                    { id: 'tone', label: 'Tono Musical' },
                    { id: 'click', label: 'Pulso Click' },
                    { id: 'pink', label: 'Ruido Rosa (-18dB)' },
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

              {/* Nivel de prueba */}
              <div className="flex items-center gap-2 bg-zinc-50 px-3 py-1.5 rounded-xl border border-zinc-200">
                <span className="text-[10px] font-bold text-zinc-600 uppercase">Nivel:</span>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  value={testVolume}
                  onChange={(e) => setTestVolume(parseFloat(e.target.value))}
                  className="w-20 h-1.5 accent-[#e11d48] cursor-pointer"
                />
                <span className="text-[10px] font-mono font-bold text-zinc-800 tabular-nums">
                  {Math.round(testVolume * 100)}%
                </span>
              </div>

              {/* Botón Prueba Anti-Fuga */}
              <button
                type="button"
                onClick={() => playDiscreteTestSignal('cue-isolation', 'cue_isolation')}
                className={`px-3.5 py-2 rounded-xl text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer border transition-all ${
                  activeTestTarget === 'cue-isolation'
                    ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                    : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                }`}
                title="Envía Click exclusivamente a los canales de MÚSICOS para verificar que no se filtra al Público"
              >
                <Headphones size={13} />
                <span>
                  {activeTestTarget === 'cue-isolation'
                    ? 'Detener Prueba Anti-Fuga'
                    : 'Prueba Anti-Fuga (Solo CUE)'}
                </span>
              </button>

              {activeTestTarget && (
                <button
                  type="button"
                  onClick={stopTestSignal}
                  className="px-3 py-2 rounded-xl bg-zinc-950 text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Square size={12} fill="currentColor" />
                  <span>Silenciar</span>
                </button>
              )}
            </div>
          </div>

          {cueFohConflicts.length > 0 && routingMode === 'MultiChannel' && detectedMaxChannels >= 4 && (
            <div className="px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-center gap-2">
              <ShieldAlert size={16} className="text-[#e11d48] shrink-0" />
              <span>
                <strong>¡Alerta de Conflicto de Canal!</strong> El Click/Guía (CUE) y la Música comparten salida en:{' '}
                <strong>{cueFohConflicts.map((c) => `CH ${c.chNum}`).join(', ')}</strong>. Cambia el canal de CUE o del instrumento abajo para aislarlos antes del concierto.
              </span>
            </div>
          )}

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

                  {/* Barra de pulso visual cuando se está probando */}
                  <div className="w-full h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#e11d48] transition-all duration-100"
                      style={{ width: isTestingThis ? `${Math.round(testLevelPulse * 100)}%` : '0%' }}
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

        {/* FILA 4: PATCHBAY DETALLADO (GRUPOS + STEMS INDIVIDUALES) + PERFILES DE LUGAR */}
        <div className="grid grid-cols-12 gap-4">
          {/* Patchbay Detallado (8 cols) */}
          <div className="col-span-8 bg-white rounded-2xl border border-zinc-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                  3. Asignación de Canales a Consola & Pistas de Canción
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Todo lo que ajustes aquí se sincroniza en tiempo real con Live Concert
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={routingMode}
                  onChange={(e) => commitRoutingMode(e.target.value as RoutingMode)}
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
                                <option value="">Grupo ({patch.stemGroupTargets[st.group]})</option>
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
          </div>

          {/* Perfiles Guardados por Lugar / Consola (4 cols) */}
          <div className="col-span-4 bg-white rounded-2xl border border-zinc-200 p-5 shadow-2xs flex flex-col justify-between gap-3">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <BookmarkCheck size={16} className="text-[#e11d48]" />
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-900">
                  4. Perfiles de Lugar / Rig
                </h2>
              </div>
              <p className="text-[11px] text-zinc-500">
                Guarda la configuración de tu iglesia, auditorio o ensayo para aplicarla en 1 clic la próxima vez.
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

              <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1">
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
