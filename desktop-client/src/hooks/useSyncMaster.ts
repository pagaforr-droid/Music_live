import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface SyncMessage {
  type: 'LOAD_SONG' | 'PLAY' | 'PAUSE' | 'SEEK' | 'STOP' | 'STATE_SNAPSHOT' | 'HEARTBEAT';
  setlistId?: string | null;
  songId?: string;
  startAt?: number; // Master timestamp in ms when playback starts/started at `offset`
  offset?: number; // Global audio time in seconds corresponding to `startAt` (or pause/seek position)
  isPlaying?: boolean;
  songData?: any;
  sentAt?: number;
  targetClientId?: string;
}

export interface ReadySlaveClient {
  clientId: string;
  deviceLabel?: string;
  setlistId?: string | null;
  songReady?: boolean;
  connectedAt?: number;
}

export interface NtpPingSample {
  t0: number;
  t1: number;
  t2: number;
}

/**
 * Filtra el estado de presencia de Supabase Realtime para contar ÚNICAMENTE
 * los dispositivos esclavos que ya descargaron su playlist, desbloquearon AudioContext
 * y presionaron "Conectar y Sincronizar" (`isMaster === false && ready === true`).
 */
export function countReadySlavePresences(
  presenceState: Record<string, any[]> | null | undefined
): {
  readyCount: number;
  totalSlaves: number;
  readyClients: ReadySlaveClient[];
} {
  if (!presenceState || typeof presenceState !== 'object') {
    return { readyCount: 0, totalSlaves: 0, readyClients: [] };
  }

  const readyByClientId = new Map<string, ReadySlaveClient>();
  const allSlaveIds = new Set<string>();

  for (const [presenceKey, entries] of Object.entries(presenceState)) {
    if (presenceKey === 'master' || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || entry.isMaster === true) continue;
      const clientId = String(entry.clientId || presenceKey);
      allSlaveIds.add(clientId);
      if (entry.ready === true) {
        readyByClientId.set(clientId, {
          clientId,
          deviceLabel: entry.deviceLabel,
          setlistId: entry.setlistId ?? null,
          songReady: Boolean(entry.songReady),
          connectedAt: Number(entry.connectedAt) || undefined,
        });
      }
    }
  }

  const readyClients = Array.from(readyByClientId.values());
  return {
    readyCount: readyClients.length,
    totalSlaves: allSlaveIds.size,
    readyClients,
  };
}

/**
 * Calcula el desfase de reloj NTP (Master - Esclavo en ms) a partir de múltiples muestras,
 * descartando los outliers de alto RTT causados por picos de jitter Wi-Fi.
 */
export function computeFilteredNtpClockOffset(samples: NtpPingSample[]): {
  clockOffsetMs: number;
  bestRttMs: number;
  sampleCount: number;
} {
  const valid = (samples || [])
    .filter(
      (s) =>
        s &&
        Number.isFinite(s.t0) &&
        Number.isFinite(s.t1) &&
        Number.isFinite(s.t2) &&
        s.t2 >= s.t0
    )
    .map((s) => {
      const rtt = Math.max(0, s.t2 - s.t0);
      const latency = rtt / 2;
      const masterTimeAtT2 = s.t1 + latency;
      const offset = masterTimeAtT2 - s.t2;
      return { rtt, offset };
    });

  if (valid.length === 0) {
    return { clockOffsetMs: 0, bestRttMs: 0, sampleCount: 0 };
  }

  // Ordenar por menor RTT (las muestras con menor tiempo de ida y vuelta tienen menor congestión/jitter)
  valid.sort((a, b) => a.rtt - b.rtt);
  const keepCount = Math.max(1, Math.min(4, Math.ceil(valid.length / 2)));
  const bestSlice = valid.slice(0, keepCount);

  const avgOffset =
    bestSlice.reduce((sum, item) => sum + item.offset, 0) / bestSlice.length;

  return {
    clockOffsetMs: Math.round(avgOffset * 100) / 100,
    bestRttMs: Math.round(bestSlice[0].rtt),
    sampleCount: valid.length,
  };
}

/**
 * Calcula el instante exacto de `AudioContext.currentTime` (`whenContextSec`) y el `startOffsetSec`
 * compensado para que un esclavo entre SIEMPRE en fase exacta con el clic guía del Master,
 * incluso si el paquete WebSocket llegó tarde o la decodificación en RAM tomó tiempo extra.
 */
export function computePhaseLockedSlaveStart(params: {
  startAtMs: number;
  baseOffsetSec: number;
  clientNowMs: number;
  clockOffsetMs: number;
  audioCtxCurrentTimeSec: number;
  bufferDurationSec?: number;
  minScheduleLookaheadSec?: number;
}): {
  whenContextSec: number;
  startOffsetSec: number;
  isLatePacket: boolean;
  lateByMs: number;
} {
  const {
    startAtMs,
    baseOffsetSec,
    clientNowMs,
    clockOffsetMs,
    audioCtxCurrentTimeSec,
    bufferDurationSec,
    minScheduleLookaheadSec = 0.025,
  } = params;

  const safeBaseOffset = Math.max(0, Number(baseOffsetSec) || 0);
  const safeCtxNow = Math.max(0, Number(audioCtxCurrentTimeSec) || 0);
  const lookaheadSec = Math.max(0.005, minScheduleLookaheadSec);
  const masterNowMs = clientNowMs + (Number(clockOffsetMs) || 0);
  const timeUntilStartMs = startAtMs - masterNowMs;

  let whenContextSec: number;
  let startOffsetSec: number;
  let isLatePacket = false;
  let lateByMs = 0;

  if (timeUntilStartMs >= lookaheadSec * 1000) {
    // El inicio programado por el Master aún está en el futuro: agendar en el instante exacto
    whenContextSec = safeCtxNow + timeUntilStartMs / 1000;
    startOffsetSec = safeBaseOffset;
  } else {
    // El paquete llegó después del ventana de lookahead (o tarde):
    // Arrancar tras `lookaheadSec` y adelantar `startOffsetSec` exactamente el tiempo transcurrido en el Master
    isLatePacket = timeUntilStartMs < 0;
    lateByMs = isLatePacket ? Math.round(-timeUntilStartMs) : 0;
    whenContextSec = safeCtxNow + lookaheadSec;
    const elapsedAtScheduleSec = (masterNowMs - startAtMs) / 1000 + lookaheadSec;
    startOffsetSec = Math.max(0, safeBaseOffset + elapsedAtScheduleSec);
  }

  if (
    typeof bufferDurationSec === 'number' &&
    Number.isFinite(bufferDurationSec) &&
    bufferDurationSec > 0.05
  ) {
    startOffsetSec = Math.min(startOffsetSec, Math.max(0, bufferDurationSec - 0.02));
  }

  return {
    whenContextSec,
    startOffsetSec,
    isLatePacket,
    lateByMs,
  };
}

/**
 * Evalúa si el reproductor de un esclavo se ha desfasado respecto al reloj del Master
 * durante la reproducción continua (Heartbeat Drift Check).
 */
export function computeSlaveDriftCorrection(params: {
  masterStartAtMs: number;
  masterBaseOffsetSec: number;
  clientNowMs: number;
  clockOffsetMs: number;
  slaveCurrentGlobalSec: number;
  driftThresholdSec?: number;
}): {
  driftSec: number;
  driftMs: number;
  needsResync: boolean;
  expectedMasterGlobalSec: number;
} {
  const {
    masterStartAtMs,
    masterBaseOffsetSec,
    clientNowMs,
    clockOffsetMs,
    slaveCurrentGlobalSec,
    driftThresholdSec = 0.04,
  } = params;

  const masterNowMs = clientNowMs + (Number(clockOffsetMs) || 0);
  const expectedMasterGlobalSec = Math.max(
    0,
    (Number(masterBaseOffsetSec) || 0) + (masterNowMs - masterStartAtMs) / 1000
  );
  const driftSec = slaveCurrentGlobalSec - expectedMasterGlobalSec;
  const driftMs = Math.round(driftSec * 1000);

  return {
    driftSec,
    driftMs,
    needsResync: Math.abs(driftSec) > driftThresholdSec,
    expectedMasterGlobalSec,
  };
}

export interface UseSyncMasterOptions {
  getStateSnapshot?: () => SyncMessage | null;
}

export function useSyncMaster(bandId: string, options?: UseSyncMasterOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [connections, setConnections] = useState(0);
  const [readyClients, setReadyClients] = useState<ReadySlaveClient[]>([]);
  const getStateSnapshotRef = useRef<(() => SyncMessage | null) | undefined>(
    options?.getStateSnapshot
  );

  useEffect(() => {
    getStateSnapshotRef.current = options?.getStateSnapshot;
  }, [options?.getStateSnapshot]);

  useEffect(() => {
    if (!bandId) return;

    const channel = supabase.channel(`sync-${bandId}`, {
      config: {
        presence: {
          key: 'master',
        },
      },
    });

    const refreshPresenceState = () => {
      const state = channel.presenceState();
      const summary = countReadySlavePresences(state);
      setConnections(summary.readyCount);
      setReadyClients(summary.readyClients);
    };

    channel
      .on('presence', { event: 'sync' }, refreshPresenceState)
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        refreshPresenceState();
        // Si se acaba de unir un esclavo listo, enviarle automáticamente el snapshot actual del Master
        const hasReadySlave = Array.isArray(newPresences) &&
          newPresences.some((p: any) => p && p.isMaster === false && p.ready === true);
        if (hasReadySlave && getStateSnapshotRef.current) {
          const snap = getStateSnapshotRef.current();
          if (snap) {
            channel.send({
              type: 'broadcast',
              event: 'transport',
              payload: { ...snap, sentAt: Date.now() },
            });
          }
        }
      })
      .on('presence', { event: 'leave' }, refreshPresenceState)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ isMaster: true, connectedAt: Date.now() });
        }
      });

    // NTP Time Synchronization (Master Side)
    channel.on('broadcast', { event: 'sync_request' }, ({ payload }) => {
      channel.send({
        type: 'broadcast',
        event: 'sync_response',
        payload: {
          t0: payload?.t0,
          t1: Date.now(),
          clientId: payload?.clientId,
          seq: payload?.seq,
        },
      });
    });

    // Handshake explícito: Esclavo solicita canción / playlist / estado actual al conectarse
    channel.on('broadcast', { event: 'request_state' }, ({ payload }) => {
      if (!getStateSnapshotRef.current) return;
      const snap = getStateSnapshotRef.current();
      if (!snap) return;
      channel.send({
        type: 'broadcast',
        event: 'transport',
        payload: {
          ...snap,
          targetClientId: payload?.clientId,
          sentAt: Date.now(),
        },
      });
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bandId]);

  const broadcast = useCallback((msg: SyncMessage) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'transport',
        payload: {
          ...msg,
          sentAt: Date.now(),
        },
      });
    }
  }, []);

  return { broadcast, connections, readyClients };
}
