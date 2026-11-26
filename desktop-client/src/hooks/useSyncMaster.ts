import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface SyncMessage {
  type:
    | 'LOAD_SONG'
    | 'PLAY'
    | 'PAUSE'
    | 'SEEK'
    | 'STOP'
    | 'STATE_SNAPSHOT'
    | 'HEARTBEAT'
    | 'PREFETCH_SONG';
  setlistId?: string | null;
  songId?: string;
  startAt?: number; // Master timestamp in ms when playback starts/started at `offset`
  offset?: number; // Global audio time in seconds corresponding to `startAt` (or pause/seek position)
  isPlaying?: boolean;
  songData?: any;
  nextSongData?: any; // Siguiente canción del setlist para pre-decodificación instantánea en RAM en los celulares
  sentAt?: number;
  targetClientId?: string;
}

export interface ReadySlaveClient {
  clientId: string;
  deviceLabel?: string;
  setlistId?: string | null;
  songReady?: boolean;
  rttMs?: number;
  connectedAt?: number;
  lastSeenAt?: number;
}

export interface LiveSlavePeerRecord extends ReadySlaveClient {
  lastSeenAt: number;
  lastProbeAt?: number;
}

export interface SlavePeerRegistryState {
  peers: Map<string, LiveSlavePeerRecord>;
  departedAtByClientId: Map<string, number>;
  seededPresenceTokens: Set<string>;
}

export interface NtpPingSample {
  t0: number;
  t1: number;
  t2: number;
}

/** Intervalo de latido ultrarrápido de los celulares (ms) */
export const SLAVE_HEARTBEAT_INTERVAL_MS = 1800;
/** Tiempo sin latido antes de que el Master dispare un RPC silencioso de verificación */
export const SLAVE_PROBE_THRESHOLD_MS = 2400;
/** Tiempo máximo sin respuesta antes de expulsar un celular desconectado abruptamente */
export const SLAVE_HEARTBEAT_TTL_MS = 5000;

export function createSlavePeerRegistry(): SlavePeerRegistryState {
  return {
    peers: new Map<string, LiveSlavePeerRecord>(),
    departedAtByClientId: new Map<string, number>(),
    seededPresenceTokens: new Set<string>(),
  };
}

function buildPresenceToken(clientId: string, connectedAt?: number): string {
  return `${clientId}:${Number(connectedAt) || 0}`;
}

function snapshotRegistryClients(registry: SlavePeerRegistryState): ReadySlaveClient[] {
  return Array.from(registry.peers.values())
    .sort((a, b) => {
      const aConn = a.connectedAt ?? 0;
      const bConn = b.connectedAt ?? 0;
      if (aConn !== bConn) return aConn - bConn;
      return a.clientId.localeCompare(b.clientId);
    })
    .map((p) => ({
      clientId: p.clientId,
      deviceLabel: p.deviceLabel,
      setlistId: p.setlistId ?? null,
      songReady: Boolean(p.songReady),
      rttMs: typeof p.rttMs === 'number' && Number.isFinite(p.rttMs) ? Math.round(p.rttMs) : undefined,
      connectedAt: p.connectedAt,
      lastSeenAt: p.lastSeenAt,
    }));
}

/**
 * Registra o refresca un celular a partir de un paquete RPC en tiempo real
 * (`rpc_slave_announce`, `rpc_slave_heartbeat` o `request_state`).
 */
export function upsertSlavePeerFromRpc(
  registry: SlavePeerRegistryState,
  payload: any,
  nowMs: number
): { isNewPeer: boolean; clients: ReadySlaveClient[] } {
  if (!payload || !payload.clientId) {
    return { isNewPeer: false, clients: snapshotRegistryClients(registry) };
  }
  if (payload.ready === false || payload.isMaster === true) {
    return { isNewPeer: false, clients: snapshotRegistryClients(registry) };
  }

  const clientId = String(payload.clientId);
  const existing = registry.peers.get(clientId);
  const isNewPeer = !existing;

  // Un paquete RPC vivo limpia cualquier marca previa de salida para este clientId
  registry.departedAtByClientId.delete(clientId);

  const connectedAt = Number(payload.connectedAt) || existing?.connectedAt || nowMs;
  const rttRaw = payload.rttMs;
  const parsedRtt =
    typeof rttRaw === 'number' && Number.isFinite(rttRaw) && rttRaw >= 0
      ? Math.round(rttRaw)
      : existing?.rttMs;

  registry.peers.set(clientId, {
    clientId,
    deviceLabel:
      typeof payload.deviceLabel === 'string' && payload.deviceLabel.trim()
        ? payload.deviceLabel.trim()
        : existing?.deviceLabel,
    setlistId:
      payload.setlistId !== undefined ? payload.setlistId ?? null : existing?.setlistId ?? null,
    songReady:
      payload.songReady !== undefined ? Boolean(payload.songReady) : Boolean(existing?.songReady),
    rttMs: parsedRtt,
    connectedAt,
    lastSeenAt: nowMs,
    lastProbeAt: undefined,
  });

  return {
    isNewPeer,
    clients: snapshotRegistryClients(registry),
  };
}

/**
 * Elimina un celular al instante (<30ms) cuando llega un RPC `rpc_slave_bye`
 * o un evento `presence leave`.
 */
export function removeSlavePeerFromBye(
  registry: SlavePeerRegistryState,
  clientId: string,
  connectedAt: number | undefined,
  nowMs: number
): { removed: boolean; clients: ReadySlaveClient[] } {
  if (!clientId) {
    return { removed: false, clients: snapshotRegistryClients(registry) };
  }
  const existing = registry.peers.get(clientId);
  const removed = registry.peers.delete(clientId);
  registry.departedAtByClientId.set(clientId, nowMs);

  const tokenConnAt = Number(connectedAt) || existing?.connectedAt || 0;
  registry.seededPresenceTokens.add(buildPresenceToken(clientId, tokenConnAt));

  return {
    removed,
    clients: snapshotRegistryClients(registry),
  };
}

/**
 * Reconcilia el estado de Presence con el registro RPC ultrarrápido sin resucitar
 * fantasmas de Phoenix Presence que ya salieron o expiraron por falta de latido.
 */
export function reconcilePresenceWithRegistry(
  registry: SlavePeerRegistryState,
  presenceState: Record<string, any[]> | null | undefined,
  nowMs: number
): { needsProbe: boolean; clients: ReadySlaveClient[] } {
  const summary = countReadySlavePresences(presenceState);
  let needsProbe = false;

  for (const client of summary.readyClients) {
    const token = buildPresenceToken(client.clientId, client.connectedAt);
    const existing = registry.peers.get(client.clientId);

    if (existing) {
      // Enriquecer metadatos faltantes sin sobreescribir el lastSeenAt del canal RPC
      if (!existing.deviceLabel && client.deviceLabel) {
        existing.deviceLabel = client.deviceLabel;
      }
      if (existing.setlistId == null && client.setlistId != null) {
        existing.setlistId = client.setlistId;
      }
      continue;
    }

    // Si este cliente ya envió `bye` o ya expiró su token de sesión anterior, NO resucitarlo desde Presence
    if (registry.seededPresenceTokens.has(token)) {
      continue;
    }
    const departedAt = registry.departedAtByClientId.get(client.clientId);
    if (departedAt !== undefined && (client.connectedAt ?? 0) <= departedAt) {
      registry.seededPresenceTokens.add(token);
      continue;
    }

    // Es una presencia nueva: sembrarla una sola vez y disparar un RPC de confirmación en vivo
    registry.seededPresenceTokens.add(token);
    registry.peers.set(client.clientId, {
      ...client,
      lastSeenAt: nowMs,
    });
    needsProbe = true;
  }

  return {
    needsProbe,
    clients: snapshotRegistryClients(registry),
  };
}

/**
 * Watchdog periódico: dispara una sonda RPC silenciosa a los 2.4s sin latido
 * y expulsa en <=5s cualquier celular desconectado abruptamente (Wi-Fi caído, batería, etc.).
 */
export function pruneStaleSlavePeers(
  registry: SlavePeerRegistryState,
  nowMs: number,
  ttlMs: number = SLAVE_HEARTBEAT_TTL_MS,
  probeThresholdMs: number = SLAVE_PROBE_THRESHOLD_MS
): { evictedIds: string[]; needsProbe: boolean; clients: ReadySlaveClient[] } {
  const evictedIds: string[] = [];
  let needsProbe = false;

  for (const [clientId, peer] of registry.peers.entries()) {
    const silentMs = nowMs - peer.lastSeenAt;
    if (silentMs > ttlMs) {
      registry.peers.delete(clientId);
      registry.departedAtByClientId.set(clientId, nowMs);
      registry.seededPresenceTokens.add(buildPresenceToken(clientId, peer.connectedAt));
      evictedIds.push(clientId);
    } else if (
      silentMs >= probeThresholdMs &&
      (!peer.lastProbeAt || nowMs - peer.lastProbeAt >= 1800)
    ) {
      peer.lastProbeAt = nowMs;
      needsProbe = true;
    }
  }

  return {
    evictedIds,
    needsProbe,
    clients: snapshotRegistryClients(registry),
  };
}

/**
 * Adquiere un `RealtimeChannel` 100% limpio para un topic dado, evitando la colisión
 * singleton de `@supabase/realtime-js` cuando React `<StrictMode>` o la navegación rápida
 * dejan un canal previo en estado `leaving`/`joining`.
 */
export async function acquireCleanRealtimeChannel(
  topic: string,
  config: Record<string, any>,
  isCancelled: () => boolean
): Promise<RealtimeChannel | null> {
  // Ceder 1 macrotask (0ms) para que el montaje desechable de React StrictMode se cancele antes de abrir socket
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
  if (isCancelled()) return null;

  const fullTopic = `realtime:${topic}`;
  const getChannelsSafe = () =>
    typeof supabase.getChannels === 'function' ? supabase.getChannels() : [];

  const staleChannels = getChannelsSafe().filter((ch) => ch.topic === fullTopic);
  for (const stale of staleChannels) {
    try {
      await Promise.race([
        supabase.removeChannel(stale),
        new Promise((resolve) => globalThis.setTimeout(resolve, 550)),
      ]);
    } catch {}
    if (getChannelsSafe().includes(stale)) {
      try {
        (stale as any).teardown?.();
        (supabase as any).realtime?._remove?.(stale);
      } catch {}
    }
  }

  if (isCancelled()) return null;
  return supabase.channel(topic, { config });
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
    if (presenceKey === 'master' || presenceKey.startsWith('master-') || !Array.isArray(entries)) {
      continue;
    }
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
          rttMs:
            typeof entry.rttMs === 'number' && Number.isFinite(entry.rttMs)
              ? Math.round(entry.rttMs)
              : undefined,
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

function buildClientsRenderSignature(clients: ReadySlaveClient[]): string {
  return clients
    .map(
      (c) =>
        `${c.clientId}|${c.deviceLabel || ''}|${c.songReady ? 1 : 0}|${c.rttMs ?? ''}|${
          c.setlistId || ''
        }`
    )
    .join(';');
}

export interface UseSyncMasterOptions {
  getStateSnapshot?: () => SyncMessage | null;
}

export function useSyncMaster(bandId: string, options?: UseSyncMasterOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribedRef = useRef<boolean>(false);
  const masterKeyRef = useRef<string>(
    `master-${Math.random().toString(36).slice(2, 9)}`
  );
  const registryRef = useRef<SlavePeerRegistryState>(createSlavePeerRegistry());
  const lastRenderSigRef = useRef<string>('');
  const scanTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  const [channelStatus, setChannelStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [connections, setConnections] = useState(0);
  const [readyClients, setReadyClients] = useState<ReadySlaveClient[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  const getStateSnapshotRef = useRef<(() => SyncMessage | null) | undefined>(
    options?.getStateSnapshot
  );

  useEffect(() => {
    getStateSnapshotRef.current = options?.getStateSnapshot;
  }, [options?.getStateSnapshot]);

  const commitClientsState = useCallback((clients: ReadySlaveClient[]) => {
    const sig = buildClientsRenderSignature(clients);
    if (sig !== lastRenderSigRef.current) {
      lastRenderSigRef.current = sig;
      setConnections(clients.length);
      setReadyClients(clients);
    }
  }, []);

  const sendDiscoverRpc = useCallback((ch?: RealtimeChannel | null) => {
    const target = ch || channelRef.current;
    if (!target || !isSubscribedRef.current) return false;
    void target.send({
      type: 'broadcast',
      event: 'rpc_discover_slaves',
      payload: {
        requestId: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        masterTs: Date.now(),
      },
    });
    return true;
  }, []);

  const sendSnapshotToClient = useCallback(
    (ch: RealtimeChannel, targetClientId?: string) => {
      if (!getStateSnapshotRef.current || !isSubscribedRef.current) return;
      const snap = getStateSnapshotRef.current();
      if (!snap) return;
      void ch.send({
        type: 'broadcast',
        event: 'transport',
        payload: {
          ...snap,
          ...(targetClientId ? { targetClientId } : {}),
          sentAt: Date.now(),
        },
      });
    },
    []
  );

  /**
   * Escaneo RPC ultrarrápido (<50ms): dispara un Roll-Call (`rpc_discover_slaves`)
   * por WebSocket directo y depura al instante dispositivos desconectados.
   */
  const scanDevices = useCallback(() => {
    const now = Date.now();
    setIsScanning(true);
    setLastScanAt(now);
    if (scanTimerRef.current) {
      globalThis.clearTimeout(scanTimerRef.current);
    }
    scanTimerRef.current = globalThis.setTimeout(() => {
      setIsScanning(false);
    }, 650);

    const ch = channelRef.current;
    if (!ch || !isSubscribedRef.current) return;

    const pruned = pruneStaleSlavePeers(registryRef.current, now);
    commitClientsState(pruned.clients);

    const reconciled = reconcilePresenceWithRegistry(
      registryRef.current,
      ch.presenceState(),
      now
    );
    commitClientsState(reconciled.clients);

    // Ráfaga RPC inmediata + segundo pulso corto para máxima fiabilidad sobre Wi-Fi
    sendDiscoverRpc(ch);
    globalThis.setTimeout(() => {
      if (channelRef.current === ch && isSubscribedRef.current) {
        sendDiscoverRpc(ch);
      }
    }, 180);
  }, [commitClientsState, sendDiscoverRpc]);

  useEffect(() => {
    if (!bandId) {
      isSubscribedRef.current = false;
      channelRef.current = null;
      registryRef.current = createSlavePeerRegistry();
      lastRenderSigRef.current = '';
      setChannelStatus('disconnected');
      setConnections(0);
      setReadyClients([]);
      return;
    }

    let cancelled = false;
    let activeChannel: RealtimeChannel | null = null;
    let watchdogInterval: ReturnType<typeof globalThis.setInterval> | null = null;
    let initialSecondPingTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;

    registryRef.current = createSlavePeerRegistry();
    lastRenderSigRef.current = '';
    setChannelStatus('connecting');
    setConnections(0);
    setReadyClients([]);

    const handleVisibilityOrOnline = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState &&
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      if (activeChannel && channelRef.current === activeChannel && isSubscribedRef.current) {
        sendDiscoverRpc(activeChannel);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrOnline);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleVisibilityOrOnline);
      window.addEventListener('focus', handleVisibilityOrOnline);
    }

    void (async () => {
      const channel = await acquireCleanRealtimeChannel(
        `sync-${bandId}`,
        {
          broadcast: { self: false, ack: false },
          presence: { key: masterKeyRef.current, enabled: true },
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

      const syncFromPresence = () => {
        if (cancelled || channelRef.current !== channel) return;
        const result = reconcilePresenceWithRegistry(
          registryRef.current,
          channel.presenceState(),
          Date.now()
        );
        commitClientsState(result.clients);
        if (result.needsProbe && isSubscribedRef.current) {
          sendDiscoverRpc(channel);
        }
      };

      channel
        .on('presence', { event: 'sync' }, syncFromPresence)
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          syncFromPresence();
          if (Array.isArray(newPresences)) {
            for (const p of newPresences as any[]) {
              if (p && p.isMaster === false && p.ready === true && p.clientId) {
                sendSnapshotToClient(channel, String(p.clientId));
              }
            }
          }
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          const now = Date.now();
          let updatedClients: ReadySlaveClient[] | null = null;
          if (Array.isArray(leftPresences) && leftPresences.length > 0) {
            for (const p of leftPresences as any[]) {
              if (!p || p.isMaster === true) continue;
              const cid = String(p.clientId || key || '');
              if (cid) {
                const res = removeSlavePeerFromBye(
                  registryRef.current,
                  cid,
                  Number(p.connectedAt) || undefined,
                  now
                );
                updatedClients = res.clients;
              }
            }
          } else if (key && !String(key).startsWith('master')) {
            const res = removeSlavePeerFromBye(registryRef.current, String(key), undefined, now);
            updatedClients = res.clients;
          }
          if (updatedClients) {
            commitClientsState(updatedClients);
          } else {
            syncFromPresence();
          }
        })
        // RPC 1: Anuncio inmediato al conectar, al responder Roll-Call o al cambiar estado RAM
        .on('broadcast', { event: 'rpc_slave_announce' }, ({ payload }) => {
          if (cancelled) return;
          const res = upsertSlavePeerFromRpc(registryRef.current, payload, Date.now());
          commitClientsState(res.clients);
          if ((res.isNewPeer || payload?.needsSnapshot === true) && payload?.clientId) {
            sendSnapshotToClient(channel, String(payload.clientId));
          }
        })
        // RPC 2: Latido ultrarrápido cada 1.8s para confirmar vida en tiempo real
        .on('broadcast', { event: 'rpc_slave_heartbeat' }, ({ payload }) => {
          if (cancelled) return;
          const res = upsertSlavePeerFromRpc(registryRef.current, payload, Date.now());
          commitClientsState(res.clients);
        })
        // RPC 3: Desconexión instantánea (<30ms) cuando el músico sale, cambia de playlist o cierra la pestaña
        .on('broadcast', { event: 'rpc_slave_bye' }, ({ payload }) => {
          if (cancelled || !payload?.clientId) return;
          const res = removeSlavePeerFromBye(
            registryRef.current,
            String(payload.clientId),
            Number(payload.connectedAt) || undefined,
            Date.now()
          );
          commitClientsState(res.clients);
        })
        // NTP Time Synchronization (Master Side)
        .on('broadcast', { event: 'sync_request' }, ({ payload }) => {
          if (cancelled) return;
          void channel.send({
            type: 'broadcast',
            event: 'sync_response',
            payload: {
              t0: payload?.t0,
              t1: Date.now(),
              clientId: payload?.clientId,
              seq: payload?.seq,
            },
          });
          // Refrescar lastSeen si el esclavo ya es conocido o declara ready=true
          if (
            payload?.clientId &&
            (payload?.ready === true || registryRef.current.peers.has(String(payload.clientId)))
          ) {
            const res = upsertSlavePeerFromRpc(registryRef.current, payload, Date.now());
            commitClientsState(res.clients);
          }
        })
        // Handshake explícito: Esclavo solicita canción / playlist / estado actual al conectarse
        .on('broadcast', { event: 'request_state' }, ({ payload }) => {
          if (cancelled) return;
          if (payload?.clientId && payload?.ready !== false) {
            const res = upsertSlavePeerFromRpc(registryRef.current, payload, Date.now());
            commitClientsState(res.clients);
          }
          sendSnapshotToClient(channel, payload?.clientId ? String(payload.clientId) : undefined);
        })
        .subscribe((status) => {
          if (cancelled || channelRef.current !== channel) return;
          if (status === 'SUBSCRIBED') {
            isSubscribedRef.current = true;
            setChannelStatus('connected');
            void channel.track({
              isMaster: true,
              connectedAt: Date.now(),
            });

            // Roll-Call RPC instantáneo apenas entra Live Concert para detectar celulares ya conectados
            sendDiscoverRpc(channel);
            initialSecondPingTimeout = globalThis.setTimeout(() => {
              if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
                sendDiscoverRpc(channel);
              }
            }, 350);

            // Watchdog rápido cada 1s: sonda RPC a los 2.4s y expulsión a los 5s si se cayó la red del celular
            if (watchdogInterval) globalThis.clearInterval(watchdogInterval);
            watchdogInterval = globalThis.setInterval(() => {
              if (cancelled || channelRef.current !== channel || !isSubscribedRef.current) return;
              const pruned = pruneStaleSlavePeers(registryRef.current, Date.now());
              if (pruned.evictedIds.length > 0) {
                commitClientsState(pruned.clients);
              }
              if (pruned.needsProbe) {
                sendDiscoverRpc(channel);
              }
            }, 1000);
          } else if (
            status === 'CLOSED' ||
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT'
          ) {
            isSubscribedRef.current = false;
            setChannelStatus('disconnected');
          }
        });
    })();

    return () => {
      cancelled = true;
      isSubscribedRef.current = false;
      if (watchdogInterval) globalThis.clearInterval(watchdogInterval);
      if (initialSecondPingTimeout) globalThis.clearTimeout(initialSecondPingTimeout);
      if (scanTimerRef.current) globalThis.clearTimeout(scanTimerRef.current);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleVisibilityOrOnline);
        window.removeEventListener('focus', handleVisibilityOrOnline);
      }
      if (activeChannel) {
        if (channelRef.current === activeChannel) {
          channelRef.current = null;
        }
        void supabase.removeChannel(activeChannel);
      }
    };
  }, [bandId, commitClientsState, sendDiscoverRpc, sendSnapshotToClient]);

  const broadcast = useCallback((msg: SyncMessage) => {
    if (channelRef.current && isSubscribedRef.current) {
      void channelRef.current.send({
        type: 'broadcast',
        event: 'transport',
        payload: {
          ...msg,
          sentAt: Date.now(),
        },
      });
    }
  }, []);

  return {
    broadcast,
    connections,
    readyClients,
    scanDevices,
    isScanning,
    lastScanAt,
    channelStatus,
  };
}
