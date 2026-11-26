import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  SyncMessage,
  NtpPingSample,
  SLAVE_HEARTBEAT_INTERVAL_MS,
  acquireCleanRealtimeChannel,
  computeFilteredNtpClockOffset,
  nowSharedMs,
} from './useSyncMaster';

const SLAVE_CLIENT_ID_STORAGE_KEY = 'tandu_inear_slave_client_id_v1';

function getOrCreateStableSlaveClientId(): string {
  try {
    const existing = sessionStorage.getItem(SLAVE_CLIENT_ID_STORAGE_KEY);
    if (existing && existing.startsWith('slave-')) {
      return existing;
    }
    const generated = `slave-${Math.random().toString(36).slice(2, 11)}`;
    sessionStorage.setItem(SLAVE_CLIENT_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `slave-${Math.random().toString(36).slice(2, 11)}`;
  }
}

function getIncomingSongVersionKey(song: any): string {
  if (!song?.id) return '';
  const pd = song.prompter_data || {};
  return `${song.id}|${song.foh_mobile_url || ''}|${song.foh_mix_url || ''}|${
    song.cue_mobile_url || ''
  }|${song.cue_mix_url || ''}|${pd.sectionsUpdatedAt || ''}|${
    pd.liveMixMeta?.version ?? ''
  }`;
}

export interface MasterTransportState {
  kind: 'idle' | 'loaded' | 'playing' | 'paused' | 'stopped';
  sessionId: string;
  seq: number;
  commandId?: string;
  songId?: string;
  cueSig?: string;
  startAt?: number;
  offset: number;
  ts: number;
}

export interface MasterHeartbeatAnchor {
  sessionId: string;
  seq: number;
  startAt: number;
  offset: number;
  songId?: string;
  ts: number;
}

export const INITIAL_MASTER_TRANSPORT_STATE: MasterTransportState = {
  kind: 'idle',
  sessionId: '',
  seq: 0,
  offset: 0,
  ts: 0,
};

/**
 * Máquina de estados monotónica por `(sessionId, seq)` para el esclavo móvil:
 * garantiza que una pausa/carga de canción previa JAMÁS pise un `PLAY` más reciente cuando
 * los paquetes llegan en ráfaga (por ejemplo durante auto-avance o react batching).
 */
export function reduceSlaveTransportIntent(
  current: MasterTransportState,
  msg: SyncMessage,
  nowMs: number
): {
  nextTransport: MasterTransportState;
  heartbeatAnchorUpdate: MasterHeartbeatAnchor | null;
  ignoredAsStale: boolean;
} {
  if (!msg || msg.type === 'PREFETCH_SONG') {
    return {
      nextTransport: current,
      heartbeatAnchorUpdate: null,
      ignoredAsStale: false,
    };
  }

  const incomingSession = msg.sessionId || current.sessionId || '';
  const sessionChanged =
    Boolean(msg.sessionId && current.sessionId && msg.sessionId !== current.sessionId);

  const effectiveCurrentSeq = sessionChanged ? 0 : current.seq;
  const incomingSeq =
    typeof msg.seq === 'number' && Number.isFinite(msg.seq) && msg.seq > 0
      ? msg.seq
      : effectiveCurrentSeq + 1;

  // Descartar paquetes retrasados de una secuencia anterior
  if (!sessionChanged && incomingSeq < effectiveCurrentSeq) {
    return {
      nextTransport: current,
      heartbeatAnchorUpdate: null,
      ignoredAsStale: true,
    };
  }

  if (msg.type === 'HEARTBEAT') {
    if (msg.isPlaying && msg.startAt !== undefined && msg.offset !== undefined) {
      const anchor: MasterHeartbeatAnchor = {
        sessionId: incomingSession,
        seq: incomingSeq,
        startAt: msg.startAt,
        offset: msg.offset,
        songId: msg.songId || current.songId,
        ts: nowMs,
      };
      // Si el HEARTBEAT revela una orden PLAY más nueva que aún no llegó al celular, recuperarla
      if (incomingSeq > effectiveCurrentSeq || current.kind !== 'playing') {
        return {
          nextTransport: {
            kind: 'playing',
            sessionId: incomingSession,
            seq: incomingSeq,
            commandId: msg.commandId,
            songId: msg.songId || current.songId,
            cueSig: msg.cueSig ?? current.cueSig,
            startAt: msg.startAt,
            offset: msg.offset,
            ts: nowMs,
          },
          heartbeatAnchorUpdate: anchor,
          ignoredAsStale: false,
        };
      }
      return {
        nextTransport: current,
        heartbeatAnchorUpdate: anchor,
        ignoredAsStale: false,
      };
    }

    // Heartbeat en pausa si tenía seq mayor al conocido
    if (incomingSeq > effectiveCurrentSeq && msg.isPlaying === false) {
      return {
        nextTransport: {
          kind: 'paused',
          sessionId: incomingSession,
          seq: incomingSeq,
          commandId: msg.commandId,
          songId: msg.songId || current.songId,
          cueSig: msg.cueSig ?? current.cueSig,
          offset: typeof msg.offset === 'number' ? msg.offset : current.offset,
          ts: nowMs,
        },
        heartbeatAnchorUpdate: null,
        ignoredAsStale: false,
      };
    }

    return {
      nextTransport: current,
      heartbeatAnchorUpdate: null,
      ignoredAsStale: false,
    };
  }

  // Para comandos discretos con el MISMO seq en la misma sesión, no reprocesar duplicados (a menos que sea SEEK/SNAPSHOT nuevo)
  if (
    !sessionChanged &&
    incomingSeq === effectiveCurrentSeq &&
    msg.commandId &&
    msg.commandId === current.commandId
  ) {
    return {
      nextTransport: current,
      heartbeatAnchorUpdate: null,
      ignoredAsStale: true,
    };
  }

  switch (msg.type) {
    case 'LOAD_SONG': {
      return {
        nextTransport: {
          kind: 'loaded',
          sessionId: incomingSession,
          seq: incomingSeq,
          commandId: msg.commandId,
          songId: msg.songId,
          cueSig: msg.cueSig,
          offset: typeof msg.offset === 'number' ? msg.offset : 0,
          ts: nowMs,
        },
        heartbeatAnchorUpdate: null,
        ignoredAsStale: false,
      };
    }

    case 'PLAY': {
      if (msg.startAt === undefined || msg.offset === undefined) {
        return { nextTransport: current, heartbeatAnchorUpdate: null, ignoredAsStale: false };
      }
      return {
        nextTransport: {
          kind: 'playing',
          sessionId: incomingSession,
          seq: incomingSeq,
          commandId: msg.commandId,
          songId: msg.songId || current.songId,
          cueSig: msg.cueSig ?? current.cueSig,
          startAt: msg.startAt,
          offset: msg.offset,
          ts: nowMs,
        },
        heartbeatAnchorUpdate: {
          sessionId: incomingSession,
          seq: incomingSeq,
          startAt: msg.startAt,
          offset: msg.offset,
          songId: msg.songId || current.songId,
          ts: nowMs,
        },
        ignoredAsStale: false,
      };
    }

    case 'STATE_SNAPSHOT': {
      if (msg.isPlaying && msg.startAt !== undefined && msg.offset !== undefined) {
        return {
          nextTransport: {
            kind: 'playing',
            sessionId: incomingSession,
            seq: incomingSeq,
            commandId: msg.commandId,
            songId: msg.songId || current.songId,
            cueSig: msg.cueSig ?? current.cueSig,
            startAt: msg.startAt,
            offset: msg.offset,
            ts: nowMs,
          },
          heartbeatAnchorUpdate: {
            sessionId: incomingSession,
            seq: incomingSeq,
            startAt: msg.startAt,
            offset: msg.offset,
            songId: msg.songId || current.songId,
            ts: nowMs,
          },
          ignoredAsStale: false,
        };
      }
      return {
        nextTransport: {
          kind: 'paused',
          sessionId: incomingSession,
          seq: incomingSeq,
          commandId: msg.commandId,
          songId: msg.songId || current.songId,
          cueSig: msg.cueSig ?? current.cueSig,
          offset: typeof msg.offset === 'number' ? msg.offset : 0,
          ts: nowMs,
        },
        heartbeatAnchorUpdate: null,
        ignoredAsStale: false,
      };
    }

    case 'PAUSE': {
      return {
        nextTransport: {
          kind: 'paused',
          sessionId: incomingSession,
          seq: incomingSeq,
          commandId: msg.commandId,
          songId: msg.songId || current.songId,
          cueSig: msg.cueSig ?? current.cueSig,
          offset: typeof msg.offset === 'number' ? msg.offset : current.offset,
          ts: nowMs,
        },
        heartbeatAnchorUpdate: null,
        ignoredAsStale: false,
      };
    }

    case 'STOP': {
      return {
        nextTransport: {
          kind: 'stopped',
          sessionId: incomingSession,
          seq: incomingSeq,
          commandId: msg.commandId,
          songId: msg.songId || current.songId,
          cueSig: msg.cueSig ?? current.cueSig,
          offset: typeof msg.offset === 'number' ? msg.offset : 0,
          ts: nowMs,
        },
        heartbeatAnchorUpdate: null,
        ignoredAsStale: false,
      };
    }

    case 'SEEK': {
      if (msg.offset === undefined) {
        return { nextTransport: current, heartbeatAnchorUpdate: null, ignoredAsStale: false };
      }
      if (msg.isPlaying && msg.startAt !== undefined) {
        return {
          nextTransport: {
            kind: 'playing',
            sessionId: incomingSession,
            seq: incomingSeq,
            commandId: msg.commandId,
            songId: msg.songId || current.songId,
            cueSig: msg.cueSig ?? current.cueSig,
            startAt: msg.startAt,
            offset: msg.offset,
            ts: nowMs,
          },
          heartbeatAnchorUpdate: {
            sessionId: incomingSession,
            seq: incomingSeq,
            startAt: msg.startAt,
            offset: msg.offset,
            songId: msg.songId || current.songId,
            ts: nowMs,
          },
          ignoredAsStale: false,
        };
      }
      return {
        nextTransport: {
          kind: current.kind === 'playing' ? 'playing' : 'paused',
          sessionId: incomingSession,
          seq: incomingSeq,
          commandId: msg.commandId,
          songId: msg.songId || current.songId,
          cueSig: msg.cueSig ?? current.cueSig,
          startAt:
            msg.startAt ??
            (current.kind === 'playing' ? nowMs + 100 : undefined),
          offset: msg.offset,
          ts: nowMs,
        },
        heartbeatAnchorUpdate: null,
        ignoredAsStale: false,
      };
    }
  }

  return {
    nextTransport: current,
    heartbeatAnchorUpdate: null,
    ignoredAsStale: false,
  };
}

export interface UseSyncSlaveOptions {
  /**
   * Cuando es `false`, el dispositivo NO se suscribe ni anuncia presencia en el canal del Master.
   * Solo debe activarse (`true`) después de descargar la playlist en MP3 y presionar "Conectar y Sincronizar".
   */
  enabled?: boolean;
  deviceLabel?: string;
  setlistId?: string | null;
  songReady?: boolean;
  readySongId?: string | null;
  readyCueSig?: string | null;
  audioState?: 'running' | 'suspended' | 'interrupted' | 'closed';
  driftMs?: number;
}

export function useSyncSlave(bandId: string, options?: UseSyncSlaveOptions) {
  const enabled = options?.enabled ?? true;
  const deviceLabel = options?.deviceLabel;
  const setlistId = options?.setlistId ?? null;
  const songReady = options?.songReady ?? false;
  const readySongId = options?.readySongId ?? null;
  const readyCueSig = options?.readyCueSig ?? null;
  const audioState = options?.audioState ?? 'running';
  const driftMs = options?.driftMs;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const rtcPcRef = useRef<RTCPeerConnection | null>(null);
  const rtcTransportDcRef = useRef<RTCDataChannel | null>(null);
  const rtcNtpDcRef = useRef<RTCDataChannel | null>(null);
  const pendingIceCandidatesRef = useRef<any[]>([]);
  const rtcRetryAttemptRef = useRef<number>(0);
  const rtcRetryTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const clientIdRef = useRef<string>(getOrCreateStableSlaveClientId());
  const connectedAtRef = useRef<number>(Date.now());
  const ntpSamplesRef = useRef<NtpPingSample[]>([]);
  const isSubscribedRef = useRef<boolean>(false);
  const seenCommandIdsRef = useRef<Set<string>>(new Set());
  const transportStateRef = useRef<MasterTransportState>(INITIAL_MASTER_TRANSPORT_STATE);
  const clockOffsetLockedRef = useRef<number | undefined>(undefined);
  const currentSongIdRef = useRef<string | null>(null);

  const slaveMetaRef = useRef<{
    deviceLabel?: string;
    setlistId: string | null;
    songReady: boolean;
    readySongId: string | null;
    readyCueSig: string | null;
    audioState: 'running' | 'suspended' | 'interrupted' | 'closed';
    transportMode: 'lan_direct' | 'cloud_realtime';
    driftMs?: number;
    rttMs: number;
  }>({
    deviceLabel,
    setlistId,
    songReady,
    readySongId,
    readyCueSig,
    audioState,
    transportMode: 'cloud_realtime',
    driftMs,
    rttMs: 0,
  });
  slaveMetaRef.current.deviceLabel = deviceLabel;
  slaveMetaRef.current.setlistId = setlistId;
  slaveMetaRef.current.songReady = songReady;
  slaveMetaRef.current.readySongId = readySongId;
  slaveMetaRef.current.readyCueSig = readyCueSig;
  slaveMetaRef.current.audioState = audioState;
  slaveMetaRef.current.driftMs = driftMs;

  // Slave state
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [transportMode, setTransportMode] = useState<'lan_direct' | 'cloud_realtime'>(
    'cloud_realtime'
  );
  const [masterSetlistId, setMasterSetlistId] = useState<string | null>(null);
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [nextSongId, setNextSongId] = useState<string | null>(null);
  const [songData, setSongData] = useState<any>(null);
  const [nextSongData, setNextSongData] = useState<any>(null);
  const [masterTransport, setMasterTransport] = useState<MasterTransportState>(
    INITIAL_MASTER_TRANSPORT_STATE
  );
  const [heartbeatAnchor, setHeartbeatAnchor] = useState<MasterHeartbeatAnchor | null>(null);
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [rttMs, setRttMs] = useState<number>(0);

  const isPlaying = masterTransport.kind === 'playing';

  const updateActiveSongSafe = useCallback((incomingSongId?: string, incomingSongData?: any) => {
    if (incomingSongId) {
      currentSongIdRef.current = incomingSongId;
      setCurrentSongId((prev) => (prev !== incomingSongId ? incomingSongId : prev));
    }
    if (incomingSongData && incomingSongData.id) {
      currentSongIdRef.current = incomingSongData.id;
      setSongData((prev: any) => {
        if (!prev) return incomingSongData;
        return getIncomingSongVersionKey(prev) === getIncomingSongVersionKey(incomingSongData)
          ? prev
          : incomingSongData;
      });
    }
  }, []);

  const buildSlaveRpcPayload = useCallback((extra?: Record<string, any>) => {
    const meta = slaveMetaRef.current;
    return {
      clientId: clientIdRef.current,
      isMaster: false,
      ready: true,
      deviceLabel: meta.deviceLabel,
      setlistId: meta.setlistId,
      songReady: meta.songReady,
      readySongId: meta.readySongId,
      readyCueSig: meta.readyCueSig,
      audioState: meta.audioState,
      transportMode: meta.transportMode,
      driftMs:
        typeof meta.driftMs === 'number' && Number.isFinite(meta.driftMs)
          ? Math.round(meta.driftMs)
          : undefined,
      rttMs: meta.rttMs > 0 ? meta.rttMs : undefined,
      connectedAt: connectedAtRef.current,
      ts: Date.now(),
      ...extra,
    };
  }, []);

  const emitSlaveRpc = useCallback(
    (
      ch: RealtimeChannel | null,
      event: 'rpc_slave_announce' | 'rpc_slave_heartbeat',
      extra?: Record<string, any>
    ) => {
      if (!ch || channelRef.current !== ch || !isSubscribedRef.current) return;
      const payload = buildSlaveRpcPayload(extra);
      const dc = rtcTransportDcRef.current;
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(JSON.stringify({ event, payload }));
        } catch {}
      }
      void ch.send({
        type: 'broadcast',
        event,
        payload,
      });
    },
    [buildSlaveRpcPayload]
  );

  const sendNtpBurst = useCallback((ch: RealtimeChannel | null, count = 8) => {
    const targetCh = ch || channelRef.current;
    if (!targetCh) return;
    const clientId = clientIdRef.current;
    for (let i = 0; i < count; i++) {
      globalThis.setTimeout(() => {
        if (channelRef.current !== targetCh || !isSubscribedRef.current) return;
        const reqPayload = {
          t0: nowSharedMs(),
          clientId,
          ready: true,
          seq: i,
        };
        const ntpDc =
          rtcNtpDcRef.current?.readyState === 'open'
            ? rtcNtpDcRef.current
            : rtcTransportDcRef.current?.readyState === 'open'
            ? rtcTransportDcRef.current
            : null;
        if (ntpDc) {
          try {
            ntpDc.send(JSON.stringify({ event: 'sync_request', payload: reqPayload }));
          } catch {}
        }
        void targetCh.send({
          type: 'broadcast',
          event: 'sync_request',
          payload: reqPayload,
        });
      }, i * 55);
    }
  }, []);

  const triggerNtpRecalibration = useCallback(
    (count = 4) => {
      if (channelRef.current && isSubscribedRef.current) {
        sendNtpBurst(channelRef.current, count);
      }
    },
    [sendNtpBurst]
  );

  const requestMasterState = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !isSubscribedRef.current) return;
    emitSlaveRpc(ch, 'rpc_slave_announce');
    const reqPayload = buildSlaveRpcPayload({ t0: nowSharedMs() });
    const dc = rtcTransportDcRef.current;
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(JSON.stringify({ event: 'request_state', payload: reqPayload }));
      } catch {}
    }
    void ch.send({
      type: 'broadcast',
      event: 'request_state',
      payload: reqPayload,
    });
  }, [buildSlaveRpcPayload, emitSlaveRpc]);

  useEffect(() => {
    if (!bandId || !enabled) {
      isSubscribedRef.current = false;
      transportStateRef.current = INITIAL_MASTER_TRANSPORT_STATE;
      slaveMetaRef.current.transportMode = 'cloud_realtime';
      setMasterTransport(INITIAL_MASTER_TRANSPORT_STATE);
      setHeartbeatAnchor(null);
      setConnectionStatus('disconnected');
      setTransportMode('cloud_realtime');
      return;
    }

    let cancelled = false;
    let byeSent = false;
    let activeChannel: RealtimeChannel | null = null;
    let ntpIntervalId: ReturnType<typeof globalThis.setInterval> | null = null;
    let fastHeartbeatId: ReturnType<typeof globalThis.setInterval> | null = null;
    const timeouts: ReturnType<typeof globalThis.setTimeout>[] = [];

    const clientId = clientIdRef.current;
    connectedAtRef.current = Date.now();
    ntpSamplesRef.current = [];
    seenCommandIdsRef.current.clear();
    transportStateRef.current = INITIAL_MASTER_TRANSPORT_STATE;
    clockOffsetLockedRef.current = undefined;
    pendingIceCandidatesRef.current = [];
    rtcRetryAttemptRef.current = 0;
    setMasterTransport(INITIAL_MASTER_TRANSPORT_STATE);
    setHeartbeatAnchor(null);
    setConnectionStatus('connecting');
    setTransportMode('cloud_realtime');
    slaveMetaRef.current.transportMode = 'cloud_realtime';

    const closeSlaveRtc = () => {
      if (rtcRetryTimerRef.current) {
        globalThis.clearTimeout(rtcRetryTimerRef.current);
        rtcRetryTimerRef.current = null;
      }
      pendingIceCandidatesRef.current = [];
      try {
        rtcTransportDcRef.current?.close();
      } catch {}
      try {
        rtcNtpDcRef.current?.close();
      } catch {}
      try {
        rtcPcRef.current?.close();
      } catch {}
      rtcTransportDcRef.current = null;
      rtcNtpDcRef.current = null;
      rtcPcRef.current = null;
    };

    const sendByeImmediately = () => {
      if (byeSent || !activeChannel || !isSubscribedRef.current) return;
      byeSent = true;
      closeSlaveRtc();
      try {
        void activeChannel.send({
          type: 'broadcast',
          event: 'rpc_slave_bye',
          payload: {
            clientId,
            connectedAt: connectedAtRef.current,
            ts: Date.now(),
          },
        });
        void activeChannel.untrack();
      } catch {}
    };

    const handleResumeOrOnline = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState &&
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      if (activeChannel && channelRef.current === activeChannel && isSubscribedRef.current) {
        emitSlaveRpc(activeChannel, 'rpc_slave_announce', { needsSnapshot: true });
        sendNtpBurst(activeChannel, 6);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', sendByeImmediately);
      window.addEventListener('beforeunload', sendByeImmediately);
      window.addEventListener('online', handleResumeOrOnline);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleResumeOrOnline);
    }

    const handleIncomingSyncResponse = (payload: any) => {
      if (!payload || payload.clientId !== clientId) return;
      const t3 = nowSharedMs();
      const t0 = Number(payload.t0);
      const t1 = Number(payload.t1);
      const t2 = payload.t2 !== undefined ? Number(payload.t2) : t3;
      const sample: NtpPingSample =
        payload.t2 !== undefined
          ? { t0, t1, t2, t3 }
          : { t0, t1, t2: t3 };

      const updatedSamples = [...ntpSamplesRef.current.slice(-29), sample];
      ntpSamplesRef.current = updatedSamples;

      const filtered = computeFilteredNtpClockOffset(
        updatedSamples,
        clockOffsetLockedRef.current
      );
      if (filtered.sampleCount > 0) {
        if (filtered.sampleCount >= 6) {
          clockOffsetLockedRef.current = filtered.clockOffsetMs;
        }
        slaveMetaRef.current.rttMs = filtered.bestRttMs;
        setClockOffset(filtered.clockOffsetMs);
        setRttMs(filtered.bestRttMs);
      }
    };

    const handleIncomingTransport = (payload: any) => {
      const msg = payload as SyncMessage;
      if (!msg) return;
      if (msg.targetClientId && msg.targetClientId !== clientId) return;

      // Deduplicar tanto los pulsos idempotentes (+55ms / +125ms) como la doble vía (LAN + Nube)
      if (msg.commandId) {
        if (seenCommandIdsRef.current.has(msg.commandId)) {
          return;
        }
        seenCommandIdsRef.current.add(msg.commandId);
        if (seenCommandIdsRef.current.size > 128) {
          const oldest = seenCommandIdsRef.current.values().next().value;
          if (oldest) seenCommandIdsRef.current.delete(oldest);
        }
      }

      if (msg.setlistId !== undefined && msg.setlistId !== null) {
        setMasterSetlistId((prev) => (prev !== msg.setlistId ? msg.setlistId! : prev));
      }
      if (msg.nextSongId !== undefined) {
        setNextSongId((prev) =>
          prev !== (msg.nextSongId ?? null) ? msg.nextSongId ?? null : prev
        );
      }
      if (msg.nextSongData !== undefined) {
        setNextSongData((prev: any) => {
          if (!msg.nextSongData) return null;
          if (
            prev &&
            getIncomingSongVersionKey(prev) === getIncomingSongVersionKey(msg.nextSongData)
          ) {
            return prev;
          }
          return msg.nextSongData;
        });
      }

      const nowMs = nowSharedMs();

      if (msg.type === 'PREFETCH_SONG') {
        if (msg.songId) {
          setNextSongId((prev) => (prev !== msg.songId ? msg.songId! : prev));
        }
        if (msg.nextSongData || msg.songData) {
          const cand = msg.nextSongData || msg.songData;
          setNextSongData((prev: any) =>
            prev && getIncomingSongVersionKey(prev) === getIncomingSongVersionKey(cand)
              ? prev
              : cand
          );
        }
        return;
      }

      const reduced = reduceSlaveTransportIntent(
        transportStateRef.current,
        msg,
        nowMs
      );
      if (reduced.ignoredAsStale) {
        return;
      }

      updateActiveSongSafe(msg.songId, msg.songData);

      if (reduced.nextTransport !== transportStateRef.current) {
        transportStateRef.current = reduced.nextTransport;
        setMasterTransport(reduced.nextTransport);
      }
      if (reduced.heartbeatAnchorUpdate) {
        setHeartbeatAnchor(reduced.heartbeatAnchorUpdate);
      } else if (reduced.nextTransport.kind !== 'playing') {
        setHeartbeatAnchor(null);
      }
    };

    const connectLanWebRtcFastPath = async (channel: RealtimeChannel) => {
      if (cancelled || typeof RTCPeerConnection !== 'function') return;
      const existingPc = rtcPcRef.current;
      // Jamás interrumpir ni reiniciar una conexión WebRTC activa o en negociación
      if (
        existingPc &&
        (existingPc.connectionState === 'connected' ||
          existingPc.connectionState === 'connecting' ||
          existingPc.iceConnectionState === 'checking' ||
          existingPc.iceConnectionState === 'connected')
      ) {
        return;
      }

      try {
        closeSlaveRtc();
        const pc = new RTCPeerConnection({
          iceServers: [],
        });
        rtcPcRef.current = pc;

        const transportDc = pc.createDataChannel('tandu-transport', {
          ordered: true,
        });
        const ntpDc = pc.createDataChannel('tandu-ntp', {
          ordered: false,
          maxRetransmits: 0,
        });
        rtcTransportDcRef.current = transportDc;
        rtcNtpDcRef.current = ntpDc;

        const markLanConnected = () => {
          if (cancelled || rtcPcRef.current !== pc) return;
          rtcRetryAttemptRef.current = 0;
          slaveMetaRef.current.transportMode = 'lan_direct';
          setTransportMode('lan_direct');
          sendNtpBurst(channel, 10);
          emitSlaveRpc(channel, 'rpc_slave_announce');
        };

        transportDc.onopen = markLanConnected;
        ntpDc.onopen = () => {
          if (cancelled || rtcPcRef.current !== pc) return;
          if (transportDc.readyState === 'open') {
            sendNtpBurst(channel, 8);
          }
        };

        transportDc.onclose = () => {
          if (rtcTransportDcRef.current === transportDc) {
            slaveMetaRef.current.transportMode = 'cloud_realtime';
            setTransportMode('cloud_realtime');
          }
        };

        const onDcMessage = (msgEv: MessageEvent) => {
          if (cancelled) return;
          try {
            const env = JSON.parse(String(msgEv.data || '{}'));
            if (env?.event === 'transport' && env.payload) {
              handleIncomingTransport(env.payload);
            } else if (env?.event === 'sync_response' && env.payload) {
              handleIncomingSyncResponse(env.payload);
            } else if (env?.event === 'rpc_discover_slaves') {
              emitSlaveRpc(channel, 'rpc_slave_announce', {
                replyToRequestId: env?.payload?.requestId,
              });
              sendNtpBurst(channel, 3);
            }
          } catch {}
        };
        transportDc.onmessage = onDcMessage;
        ntpDc.onmessage = onDcMessage;

        pc.onconnectionstatechange = () => {
          if (cancelled || rtcPcRef.current !== pc) return;
          if (
            pc.connectionState === 'failed' ||
            pc.connectionState === 'disconnected' ||
            pc.connectionState === 'closed'
          ) {
            slaveMetaRef.current.transportMode = 'cloud_realtime';
            setTransportMode('cloud_realtime');
            if (!rtcRetryTimerRef.current && rtcRetryAttemptRef.current < 4) {
              const delayMs = 2000 * Math.pow(2, rtcRetryAttemptRef.current);
              rtcRetryAttemptRef.current += 1;
              rtcRetryTimerRef.current = globalThis.setTimeout(() => {
                rtcRetryTimerRef.current = null;
                if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
                  void connectLanWebRtcFastPath(channel);
                }
              }, delayMs);
            }
          }
        };

        pc.onicecandidate = (ev) => {
          if (!ev.candidate || cancelled || channelRef.current !== channel) return;
          void channel.send({
            type: 'broadcast',
            event: 'webrtc_signal',
            payload: {
              target: 'master',
              fromClientId: clientId,
              type: 'ice',
              candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate,
            },
          });
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (!cancelled && channelRef.current === channel && rtcPcRef.current === pc) {
          void channel.send({
            type: 'broadcast',
            event: 'webrtc_signal',
            payload: {
              target: 'master',
              fromClientId: clientId,
              type: 'offer',
              sdp: pc.localDescription,
            },
          });
        }
      } catch {}
    };

    void (async () => {
      const channel = await acquireCleanRealtimeChannel(
        `sync-${bandId}`,
        {
          broadcast: { self: false, ack: false },
          presence: { key: clientId, enabled: false },
        },
        () => cancelled
      );

      if (!channel || cancelled) {
        if (channel) {
          void supabase.removeChannel(channel);
        }
        return;
      }

      activeChannel = channel;
      channelRef.current = channel;

      channel.on('broadcast', { event: 'rpc_discover_slaves' }, ({ payload }) => {
        if (cancelled || channelRef.current !== channel) return;
        emitSlaveRpc(channel, 'rpc_slave_announce', {
          replyToRequestId: payload?.requestId,
        });
        sendNtpBurst(channel, 2);
        // Solo iniciar WebRTC si nunca se abrió o está cerrado/fallido
        const pcState = rtcPcRef.current?.connectionState;
        if (!rtcPcRef.current || pcState === 'failed' || pcState === 'closed') {
          void connectLanWebRtcFastPath(channel);
        }
      });

      channel.on('broadcast', { event: 'webrtc_signal' }, async ({ payload }) => {
        if (
          cancelled ||
          !payload ||
          payload.target !== 'slave' ||
          payload.targetClientId !== clientId ||
          !rtcPcRef.current
        ) {
          return;
        }
        const pc = rtcPcRef.current;
        try {
          if (payload.type === 'answer' && payload.sdp) {
            await pc.setRemoteDescription(payload.sdp);
            while (pendingIceCandidatesRef.current.length > 0) {
              const cand = pendingIceCandidatesRef.current.shift();
              if (cand) {
                await pc.addIceCandidate(cand).catch(() => {});
              }
            }
          } else if (payload.type === 'ice' && payload.candidate) {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(payload.candidate);
            } else {
              pendingIceCandidatesRef.current.push(payload.candidate);
            }
          }
        } catch {}
      });

      channel.on('broadcast', { event: 'transport' }, ({ payload }) => {
        handleIncomingTransport(payload);
      });

      channel.on('broadcast', { event: 'sync_response' }, ({ payload }) => {
        handleIncomingSyncResponse(payload);
      });

      channel.subscribe((status) => {
        if (cancelled || channelRef.current !== channel) return;
        if (status === 'SUBSCRIBED') {
          isSubscribedRef.current = true;
          byeSent = false;
          setConnectionStatus('connected');

          void channel.track(buildSlaveRpcPayload()).catch(() => {});

          emitSlaveRpc(channel, 'rpc_slave_announce', { needsSnapshot: true });
          void connectLanWebRtcFastPath(channel);
          sendNtpBurst(channel, 10);

          void channel.send({
            type: 'broadcast',
            event: 'request_state',
            payload: buildSlaveRpcPayload({ t0: nowSharedMs() }),
          });

          timeouts.push(
            globalThis.setTimeout(() => {
              if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
                emitSlaveRpc(channel, 'rpc_slave_announce');
              }
            }, 300)
          );
          timeouts.push(
            globalThis.setTimeout(() => {
              if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
                emitSlaveRpc(channel, 'rpc_slave_announce');
                void channel.send({
                  type: 'broadcast',
                  event: 'request_state',
                  payload: buildSlaveRpcPayload({ t0: nowSharedMs() }),
                });
              }
            }, 700)
          );

          for (const idleCheckMs of [1400, 2800]) {
            timeouts.push(
              globalThis.setTimeout(() => {
                if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
                  sendNtpBurst(channel, 4);
                }
              }, idleCheckMs)
            );
          }

          if (fastHeartbeatId !== null) globalThis.clearInterval(fastHeartbeatId);
          fastHeartbeatId = globalThis.setInterval(() => {
            if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
              emitSlaveRpc(channel, 'rpc_slave_heartbeat');
            }
          }, SLAVE_HEARTBEAT_INTERVAL_MS);

          if (ntpIntervalId !== null) globalThis.clearInterval(ntpIntervalId);
          ntpIntervalId = globalThis.setInterval(() => {
            if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
              sendNtpBurst(channel, 4);
            }
          }, 6000);
        } else if (
          status === 'CLOSED' ||
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT'
        ) {
          isSubscribedRef.current = false;
          setConnectionStatus('disconnected');
          setTransportMode('cloud_realtime');
          slaveMetaRef.current.transportMode = 'cloud_realtime';
        }
      });
    })();

    return () => {
      cancelled = true;
      for (const t of timeouts) globalThis.clearTimeout(t);
      if (fastHeartbeatId !== null) globalThis.clearInterval(fastHeartbeatId);
      if (ntpIntervalId !== null) globalThis.clearInterval(ntpIntervalId);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', sendByeImmediately);
        window.removeEventListener('beforeunload', sendByeImmediately);
        window.removeEventListener('online', handleResumeOrOnline);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleResumeOrOnline);
      }
      sendByeImmediately();
      closeSlaveRtc();
      isSubscribedRef.current = false;
      if (activeChannel) {
        if (channelRef.current === activeChannel) {
          channelRef.current = null;
        }
        void supabase.removeChannel(activeChannel);
      }
    };
  }, [bandId, enabled, buildSlaveRpcPayload, emitSlaveRpc, sendNtpBurst, updateActiveSongSafe]);

  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !enabled || !isSubscribedRef.current) return;
    emitSlaveRpc(ch, 'rpc_slave_announce');
    void ch.track(buildSlaveRpcPayload()).catch(() => {});
  }, [
    enabled,
    deviceLabel,
    setlistId,
    songReady,
    readySongId,
    readyCueSig,
    audioState,
    buildSlaveRpcPayload,
    emitSlaveRpc,
  ]);

  return {
    connectionStatus,
    transportMode,
    masterSetlistId,
    currentSongId,
    nextSongId,
    songData,
    nextSongData,
    isPlaying,
    masterTransport,
    heartbeatAnchor,
    clockOffset,
    rttMs,
    requestMasterState,
    triggerNtpRecalibration,
  };
}
