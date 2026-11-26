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
  sessionId?: string;
  seq?: number;
  commandId?: string;
  cueSig?: string;
  setlistId?: string | null;
  songId?: string;
  nextSongId?: string | null;
  startAt?: number; // Exact Master shared-wall timestamp in ms when audio sound exits speakers/headphones at `offset`
  offset?: number; // Global audio time in seconds corresponding to `startAt` (or pause/seek position)
  isPlaying?: boolean;
  songData?: any;
  nextSongData?: any;
  sentAt?: number;
  targetClientId?: string;
}

export interface ReadySlaveClient {
  clientId: string;
  deviceLabel?: string;
  setlistId?: string | null;
  songReady?: boolean;
  readySongId?: string | null;
  readyCueSig?: string | null;
  audioState?: 'running' | 'suspended' | 'interrupted' | 'closed';
  transportMode?: 'lan_direct' | 'cloud_realtime';
  driftMs?: number;
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
  t0: number; // Esclavo envía
  t1: number; // Master recibe
  t2: number; // Master responde (o en modo 3-ts legacy, Esclavo recibe)
  t3?: number; // Esclavo recibe (modo 4-timestamps RFC 5905)
}

export interface AudioOutputClockMapping {
  /** `AudioContext.currentTime` de la muestra física que sale por el DAC en `sharedTimeMs` */
  heardContextTimeSec: number;
  /** Tiempo de reloj monotónico de pared (`performance.timeOrigin + ts.performanceTime`) en ms */
  sharedTimeMs: number;
  /** Latencia medida de pipeline `ctx.currentTime - audibleCtxTime` en ms */
  pipelineLatencyMs: number;
  /** `true` si `getOutputTimestamp()` devolvió timestamps de hardware no nulos */
  hasOutputTimestamp: boolean;
}

/**
 * Reloj monotónico de pared de alta resolución (`performance.timeOrigin + performance.now()`).
 * Evita saltos del reloj NTP del SO y mantiene resolución sub-milisegundo entre paquetes de audio.
 */
export function nowSharedMs(): number {
  if (
    typeof performance !== 'undefined' &&
    typeof performance.timeOrigin === 'number' &&
    Number.isFinite(performance.timeOrigin) &&
    typeof performance.now === 'function'
  ) {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

/**
 * Lee el mapeo exacto entre el reloj de muestras de hardware (`AudioContext.getOutputTimestamp().contextTime`)
 * y el reloj compartido de pared (`sharedTimeMs`), eliminando el error de granularidad de bloques (20-40ms)
 * que ocurre al mezclar `Date.now()` con `ctx.currentTime`.
 */
export function measureAudioOutputClockMapping(
  ctx: AudioContext | null | undefined
): AudioOutputClockMapping | null {
  if (!ctx || typeof (ctx as any).getOutputTimestamp !== 'function') {
    return null;
  }
  try {
    const ts = (ctx as any).getOutputTimestamp();
    if (
      !ts ||
      typeof ts.contextTime !== 'number' ||
      !Number.isFinite(ts.contextTime) ||
      ts.contextTime <= 0 ||
      typeof ts.performanceTime !== 'number' ||
      !Number.isFinite(ts.performanceTime) ||
      ts.performanceTime <= 0 ||
      ctx.currentTime < ts.contextTime
    ) {
      return null;
    }

    const perfOrigin =
      typeof performance !== 'undefined' &&
      typeof performance.timeOrigin === 'number' &&
      Number.isFinite(performance.timeOrigin)
        ? performance.timeOrigin
        : Date.now() - ts.performanceTime;
    const perfNow =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : ts.performanceTime;

    const elapsedSinceTsSec = Math.max(
      0,
      Math.min(0.15, (perfNow - ts.performanceTime) / 1000)
    );
    const audibleNowSec = ts.contextTime + elapsedSinceTsSec;
    const rawPipelineMs = (ctx.currentTime - audibleNowSec) * 1000;
    if (!Number.isFinite(rawPipelineMs) || rawPipelineMs < 0 || rawPipelineMs >= 350) {
      return null;
    }

    return {
      heardContextTimeSec: ts.contextTime,
      sharedTimeMs: perfOrigin + ts.performanceTime,
      pipelineLatencyMs: Math.round(rawPipelineMs),
      hasOutputTimestamp: true,
    };
  } catch {
    return null;
  }
}

/**
 * Calcula el timestamp exacto de reloj compartido (`startAt`) en el que el audio agendado
 * en `targetContextTimeSec` saldrá físicamente por los parlantes/consola del Master (PC).
 */
export function computeMasterStartAtForContextTime(
  ctx: AudioContext | null | undefined,
  targetContextTimeSec: number,
  extraOffsetMs: number = 0,
  fallbackLatencyMs: number = 0
): number {
  const mapping = measureAudioOutputClockMapping(ctx);
  if (mapping?.hasOutputTimestamp) {
    return (
      mapping.sharedTimeMs +
      (targetContextTimeSec - mapping.heardContextTimeSec) * 1000 +
      extraOffsetMs
    );
  }
  const ctxNow = ctx ? ctx.currentTime : 0;
  const hwLatMs = Math.max(fallbackLatencyMs, measureAudioContextOutputLatencyMs(ctx));
  return (
    nowSharedMs() +
    (targetContextTimeSec - ctxNow) * 1000 +
    hwLatMs +
    extraOffsetMs
  );
}

/** Intervalo de latido ultrarrápido de los celulares (ms) */
export const SLAVE_HEARTBEAT_INTERVAL_MS = 1800;
/** Tiempo sin latido antes de que el Master dispare un RPC silencioso de verificación */
export const SLAVE_PROBE_THRESHOLD_MS = 2400;
/** Tiempo máximo sin respuesta antes de expulsar un celular desconectado abruptamente */
export const SLAVE_HEARTBEAT_TTL_MS = 5000;

/**
 * Mide en vivo la latencia física real de salida (en ms) de un `AudioContext`
 * (`baseLatency + outputLatency` o `currentTime - getOutputTimestamp().contextTime`).
 * Permite alinear al milisegundo el instante en que el sonido sale físicamente en PC, Android e iPhone.
 */
export function measureAudioContextOutputLatencyMs(
  ctx: AudioContext | null | undefined
): number {
  if (!ctx) return 0;
  const rawBase = Number((ctx as any).baseLatency);
  const baseSec = Number.isFinite(rawBase) && rawBase > 0 ? rawBase : 0;

  const rawOut = Number((ctx as any).outputLatency);
  let outSec = Number.isFinite(rawOut) && rawOut > 0 ? rawOut : 0;

  if (outSec <= 0 && typeof (ctx as any).getOutputTimestamp === 'function') {
    try {
      const ts = (ctx as any).getOutputTimestamp();
      if (
        ts &&
        typeof ts.contextTime === 'number' &&
        ts.contextTime > 0 &&
        ctx.currentTime >= ts.contextTime
      ) {
        const perfNow =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : 0;
        const elapsedSinceTsSec =
          typeof ts.performanceTime === 'number' &&
          ts.performanceTime > 0 &&
          perfNow >= ts.performanceTime
            ? Math.min(0.1, (perfNow - ts.performanceTime) / 1000)
            : 0;
        const audibleContextTime = ts.contextTime + elapsedSinceTsSec;
        const pipelineDelay = ctx.currentTime - audibleContextTime;
        if (pipelineDelay > 0 && pipelineDelay < 0.3) {
          outSec = pipelineDelay;
        }
      }
    } catch {}
  }

  const totalSec = Math.max(0, Math.min(0.3, baseSec + outSec));
  return Math.round(totalSec * 1000);
}

/**
 * Estima la latencia física mínima no reportada únicamente cuando el navegador devuelve `0`
 * tanto en `AudioContext.outputLatency` como en `getOutputTimestamp()` (evita doble conteo).
 * Con `getOutputTimestamp()` activo en iOS/Android/Desktop, devuelve `0` extra porque el mapeo
 * hardware ya incluye la cola del DAC de salida de forma nativa.
 */
export function estimateSlaveAcousticOutputLatencyMs(
  ctx: AudioContext | null | undefined,
  userAgent?: string
): number {
  const mapping = measureAudioOutputClockMapping(ctx);
  if (mapping?.hasOutputTimestamp && mapping.pipelineLatencyMs >= 18) {
    return 0;
  }

  const rawOut = Number((ctx as any)?.outputLatency);
  if (Number.isFinite(rawOut) && rawOut >= 0.015) {
    return mapping?.hasOutputTimestamp ? 0 : Math.round(rawOut * 1000);
  }

  const ua =
    typeof userAgent === 'string'
      ? userAgent
      : typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '';

  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  const measuredMs = measureAudioContextOutputLatencyMs(ctx);

  // Solo si Chrome/WebView omitió completamente reportar buffer de OS (<18ms), usar piso conservador
  if (mapping?.hasOutputTimestamp) {
    if (isAndroid) return Math.max(0, 42 - mapping.pipelineLatencyMs);
    if (isIOS) return Math.max(0, 18 - mapping.pipelineLatencyMs);
    return 0;
  }

  if (isAndroid) {
    return Math.max(45, measuredMs);
  }
  if (isIOS) {
    return Math.max(20, measuredMs);
  }
  return measuredMs;
}

/**
 * Compacta drásticamente `songData` (~350 KB -> ~1.2 KB) antes de enviarlo por WebSocket Realtime.
 * Elimina arreglos masivos (`beatTimes`, `waveformPeaks`, `stems`, `chords`, `lyrics`) que saturaban
 * el límite de fan-out de Supabase Realtime cuando hay 2 o más celulares conectados; cada celular
 * fusiona automáticamente esos arreglos desde su catálogo local descargado en el Paso 1.
 */
export function stripHeavySongPayloadForRealtime(song: any): any {
  if (!song || typeof song !== 'object') return song ?? null;
  const pd = song.prompter_data;
  const compactPrompterData =
    pd && typeof pd === 'object'
      ? {
          bpm: pd.bpm,
          key: pd.key,
          timeSignature: pd.timeSignature,
          firstBeatOffset: pd.firstBeatOffset,
          sectionsUpdatedAt: pd.sectionsUpdatedAt,
          liveMixMeta: pd.liveMixMeta,
          lyricsSyncMeta: pd.lyricsSyncMeta,
          mixConfig: pd.mixConfig,
          sections: Array.isArray(pd.sections)
            ? pd.sections.map((s: any) => ({
                id: s?.id,
                name: s?.name,
                section: s?.section,
                time: s?.time,
                bars: s?.bars,
                cueEnabled: s?.cueEnabled,
              }))
            : undefined,
        }
      : undefined;

  return {
    id: song.id,
    title: song.title,
    position: song.position,
    foh_mobile_url: song.foh_mobile_url ?? null,
    cue_mobile_url: song.cue_mobile_url ?? null,
    foh_mix_url: song.foh_mix_url ?? null,
    cue_mix_url: song.cue_mix_url ?? null,
    ...(compactPrompterData ? { prompter_data: compactPrompterData } : {}),
  };
}

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
      readySongId: p.readySongId ?? null,
      readyCueSig: p.readyCueSig ?? null,
      audioState: p.audioState,
      transportMode: p.transportMode,
      driftMs:
        typeof p.driftMs === 'number' && Number.isFinite(p.driftMs)
          ? Math.round(p.driftMs)
          : undefined,
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

  registry.departedAtByClientId.delete(clientId);

  const connectedAt = Number(payload.connectedAt) || existing?.connectedAt || nowMs;
  const rttRaw = payload.rttMs;
  const parsedRtt =
    typeof rttRaw === 'number' && Number.isFinite(rttRaw) && rttRaw >= 0
      ? Math.round(rttRaw)
      : existing?.rttMs;
  const parsedDrift =
    typeof payload.driftMs === 'number' && Number.isFinite(payload.driftMs)
      ? Math.round(payload.driftMs)
      : existing?.driftMs;

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
    readySongId:
      payload.readySongId !== undefined ? payload.readySongId ?? null : existing?.readySongId ?? null,
    readyCueSig:
      payload.readyCueSig !== undefined ? payload.readyCueSig ?? null : existing?.readyCueSig ?? null,
    audioState: payload.audioState ?? existing?.audioState,
    transportMode: payload.transportMode ?? existing?.transportMode,
    driftMs: parsedDrift,
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
      if (!existing.deviceLabel && client.deviceLabel) {
        existing.deviceLabel = client.deviceLabel;
      }
      if (existing.setlistId == null && client.setlistId != null) {
        existing.setlistId = client.setlistId;
      }
      continue;
    }

    if (registry.seededPresenceTokens.has(token)) {
      continue;
    }
    const departedAt = registry.departedAtByClientId.get(client.clientId);
    if (departedAt !== undefined && (client.connectedAt ?? 0) <= departedAt) {
      registry.seededPresenceTokens.add(token);
      continue;
    }

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
 * Calcula el desfase de reloj NTP (Master - Esclavo en ms) usando 4 timestamps RFC 5905 (`t0, t1, t2, t3`)
 * con retrocompatibilidad 3-ts, filtro de mínimo RTT (elimina picos de router/DTIM) y slew-rate limit
 * opcional (±1.5ms máx por actualización) para evitar saltos bruscos mientras suena una canción.
 */
export function computeFilteredNtpClockOffset(
  samples: NtpPingSample[],
  prevLockedOffsetMs?: number
): {
  clockOffsetMs: number;
  bestRttMs: number;
  sampleCount: number;
} {
  const valid: Array<{ rtt: number; offset: number }> = [];

  for (const s of samples || []) {
    if (!s || !Number.isFinite(s.t0) || !Number.isFinite(s.t1) || !Number.isFinite(s.t2)) {
      continue;
    }
    if (typeof s.t3 === 'number' && Number.isFinite(s.t3) && s.t3 >= s.t0) {
      // Formato completo 4 timestamps: t0=slaveTx, t1=masterRx, t2=masterTx, t3=slaveRx
      const serverProc = Math.max(0, Math.min(250, s.t2 - s.t1));
      const rtt = Math.max(0, s.t3 - s.t0 - serverProc);
      const offset = (s.t1 - s.t0 + (s.t2 - s.t3)) / 2;
      valid.push({ rtt, offset });
    } else if (s.t2 >= s.t0) {
      // Formato 3 timestamps: t0=slaveTx, t1=master, t2=slaveRx
      const rtt = Math.max(0, s.t2 - s.t0);
      const offset = s.t1 + rtt / 2 - s.t2;
      valid.push({ rtt, offset });
    }
  }

  if (valid.length === 0) {
    return { clockOffsetMs: 0, bestRttMs: 0, sampleCount: 0 };
  }

  valid.sort((a, b) => a.rtt - b.rtt);
  const minRtt = valid[0].rtt;
  const maxAllowedRtt = minRtt + 6;
  const maxSliceSize = Math.max(1, Math.min(5, Math.ceil(valid.length * 0.3)));
  const bestSlice = valid
    .filter((item) => item.rtt <= maxAllowedRtt)
    .slice(0, maxSliceSize);
  const chosenSlice = bestSlice.length > 0 ? bestSlice : valid.slice(0, 1);

  const avgOffset =
    chosenSlice.reduce((sum, item) => sum + item.offset, 0) / chosenSlice.length;
  let finalOffsetMs = Math.round(avgOffset * 100) / 100;

  // Slew-rate limit progresivo una vez calibrado el reloj (mínimo 6 muestras) para inmunizar el audio
  if (
    typeof prevLockedOffsetMs === 'number' &&
    Number.isFinite(prevLockedOffsetMs) &&
    valid.length >= 6
  ) {
    const delta = finalOffsetMs - prevLockedOffsetMs;
    if (Math.abs(delta) <= 60) {
      const clampedDelta = Math.max(-1.5, Math.min(1.5, delta));
      finalOffsetMs = Math.round((prevLockedOffsetMs + clampedDelta) * 100) / 100;
    }
  }

  return {
    clockOffsetMs: finalOffsetMs,
    bestRttMs: Math.round(minRtt),
    sampleCount: valid.length,
  };
}

export interface SlavePllServoResult {
  mode: 'locked' | 'pll_rate' | 'hard_seek';
  targetPlaybackRate: number;
  driftMs: number;
  driftSec: number;
  expectedMasterGlobalSec: number;
}

/**
 * Micro-PLL Musical para sincronización continua sin cortes ni deformación de afinación/tempo:
 * - |drift| <= 8ms: Fase bloqueada (`playbackRate = 1.0000` clavado).
 * - 8ms < |drift| <= 40ms: Micro-ajuste inaudible (`0.9985 .. 1.0015`, ±0.15% = ±2.6 cents)
 *   que absorbe deriva de osciladores de cuarzo sin alterar el tempo del clic guía.
 * - |drift| > 40ms: Re-enganche limpio (`hard_seek` con micro-crossfade tras confirmación).
 */
export function computeSlavePllServoAdjustment(params: {
  masterStartAtMs: number;
  masterBaseOffsetSec: number;
  clientNowMs: number;
  clockOffsetMs: number;
  slaveCurrentGlobalSec: number;
  slaveOutputLatencyMs?: number;
  deadbandMs?: number;
  hardSeekThresholdMs?: number;
  maxRateDev?: number;
  outputMapping?: AudioOutputClockMapping | null;
  slaveAudioCtxCurrentTimeSec?: number;
}): SlavePllServoResult {
  const {
    masterStartAtMs,
    masterBaseOffsetSec,
    clientNowMs,
    clockOffsetMs,
    slaveCurrentGlobalSec,
    slaveOutputLatencyMs = 0,
    deadbandMs = 8,
    hardSeekThresholdMs = 40,
    maxRateDev = 0.0015,
    outputMapping,
    slaveAudioCtxCurrentTimeSec,
  } = params;

  const base = computeSlaveDriftCorrection({
    masterStartAtMs,
    masterBaseOffsetSec,
    clientNowMs,
    clockOffsetMs,
    slaveCurrentGlobalSec,
    slaveOutputLatencyMs,
    driftThresholdSec: deadbandMs / 1000,
    outputMapping,
    slaveAudioCtxCurrentTimeSec,
  });

  const absDriftMs = Math.abs(base.driftMs);

  if (absDriftMs <= deadbandMs) {
    return {
      mode: 'locked',
      targetPlaybackRate: 1.0,
      driftMs: base.driftMs,
      driftSec: base.driftSec,
      expectedMasterGlobalSec: base.expectedMasterGlobalSec,
    };
  }

  if (absDriftMs > hardSeekThresholdMs) {
    return {
      mode: 'hard_seek',
      targetPlaybackRate: 1.0,
      driftMs: base.driftMs,
      driftSec: base.driftSec,
      expectedMasterGlobalSec: base.expectedMasterGlobalSec,
    };
  }

  // Pull musical muy suave (máximo ±0.15% = ±0.15 BPM a 100 BPM): corrige ~1.5ms/seg imperceptiblemente
  const safeMaxDev = Math.max(0.0005, Math.min(0.005, maxRateDev));
  const proportionalPull = -base.driftSec * 0.08;
  const clampedPull = Math.max(-safeMaxDev, Math.min(safeMaxDev, proportionalPull));
  const targetPlaybackRate = Math.round((1.0 + clampedPull) * 10000) / 10000;

  return {
    mode: 'pll_rate',
    targetPlaybackRate,
    driftMs: base.driftMs,
    driftSec: base.driftSec,
    expectedMasterGlobalSec: base.expectedMasterGlobalSec,
  };
}

/**
 * Calcula el instante exacto de `AudioContext.currentTime` (`whenContextSec`) y el `startOffsetSec`
 * compensando el desfase NTP y la salida física de audio usando preferentemente `getOutputTimestamp()`
 * para anular la granularidad de bloques del OS.
 */
export function computePhaseLockedSlaveStart(params: {
  startAtMs: number;
  baseOffsetSec: number;
  clientNowMs: number;
  clockOffsetMs: number;
  audioCtxCurrentTimeSec: number;
  slaveOutputLatencyMs?: number;
  bufferDurationSec?: number;
  minScheduleLookaheadSec?: number;
  outputMapping?: AudioOutputClockMapping | null;
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
    slaveOutputLatencyMs = 0,
    bufferDurationSec,
    minScheduleLookaheadSec = 0.025,
    outputMapping,
  } = params;

  const safeBaseOffset = Math.max(0, Number(baseOffsetSec) || 0);
  const safeCtxNow = Math.max(0, Number(audioCtxCurrentTimeSec) || 0);
  const lookaheadSec = Math.max(0.005, minScheduleLookaheadSec);
  const slaveOutLatMs = Number.isFinite(slaveOutputLatencyMs) ? Number(slaveOutputLatencyMs) : 0;

  let whenContextSec: number;
  let startOffsetSec: number;
  let isLatePacket = false;
  let lateByMs = 0;

  if (outputMapping?.hasOutputTimestamp) {
    // El audio debe salir físicamente por audífonos cuando el reloj del celular marca `startAtMs - clockOffsetMs`
    const targetClientAudibleMs = startAtMs - (Number(clockOffsetMs) || 0) - slaveOutLatMs;
    const idealWhenCtxSec =
      outputMapping.heardContextTimeSec +
      (targetClientAudibleMs - outputMapping.sharedTimeMs) / 1000;
    const deltaCtxSec = idealWhenCtxSec - safeCtxNow;

    if (deltaCtxSec >= lookaheadSec) {
      whenContextSec = idealWhenCtxSec;
      startOffsetSec = safeBaseOffset;
    } else {
      isLatePacket = deltaCtxSec < 0;
      lateByMs = isLatePacket ? Math.round(-deltaCtxSec * 1000) : 0;
      whenContextSec = safeCtxNow + lookaheadSec;
      const elapsedPastTargetSec = whenContextSec - idealWhenCtxSec;
      startOffsetSec = Math.max(0, safeBaseOffset + elapsedPastTargetSec);
    }
  } else {
    const effectiveRenderStartAtMs = startAtMs - slaveOutLatMs;
    const masterNowMs = clientNowMs + (Number(clockOffsetMs) || 0);
    const timeUntilStartMs = effectiveRenderStartAtMs - masterNowMs;

    if (timeUntilStartMs >= lookaheadSec * 1000) {
      whenContextSec = safeCtxNow + timeUntilStartMs / 1000;
      startOffsetSec = safeBaseOffset;
    } else {
      isLatePacket = timeUntilStartMs < 0;
      lateByMs = isLatePacket ? Math.round(-timeUntilStartMs) : 0;
      whenContextSec = safeCtxNow + lookaheadSec;
      const elapsedAtScheduleSec =
        (masterNowMs - effectiveRenderStartAtMs) / 1000 + lookaheadSec;
      startOffsetSec = Math.max(0, safeBaseOffset + elapsedAtScheduleSec);
    }
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
 * Evalúa si el audio audible de un esclavo se ha desfasado respecto al reloj del Master
 * durante la reproducción continua.
 */
export function computeSlaveDriftCorrection(params: {
  masterStartAtMs: number;
  masterBaseOffsetSec: number;
  clientNowMs: number;
  clockOffsetMs: number;
  slaveCurrentGlobalSec: number;
  slaveOutputLatencyMs?: number;
  driftThresholdSec?: number;
  outputMapping?: AudioOutputClockMapping | null;
  slaveAudioCtxCurrentTimeSec?: number;
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
    slaveOutputLatencyMs = 0,
    driftThresholdSec = 0.018,
    outputMapping,
    slaveAudioCtxCurrentTimeSec,
  } = params;

  const slaveOutLatSec =
    (Number.isFinite(slaveOutputLatencyMs) ? Number(slaveOutputLatencyMs) : 0) / 1000;
  const masterNowMs = clientNowMs + (Number(clockOffsetMs) || 0);
  const expectedMasterGlobalSec = Math.max(
    0,
    (Number(masterBaseOffsetSec) || 0) + (masterNowMs - masterStartAtMs) / 1000
  );

  let slaveAudibleGlobalSec: number;
  if (
    outputMapping?.hasOutputTimestamp &&
    typeof slaveAudioCtxCurrentTimeSec === 'number' &&
    Number.isFinite(slaveAudioCtxCurrentTimeSec)
  ) {
    const heardCtxSec =
      outputMapping.heardContextTimeSec +
      (clientNowMs - outputMapping.sharedTimeMs) / 1000;
    const renderLeadSec = slaveAudioCtxCurrentTimeSec - heardCtxSec;
    slaveAudibleGlobalSec = slaveCurrentGlobalSec - renderLeadSec - slaveOutLatSec;
  } else {
    slaveAudibleGlobalSec = slaveCurrentGlobalSec - slaveOutLatSec;
  }

  const driftSec = slaveAudibleGlobalSec - expectedMasterGlobalSec;
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
        `${c.clientId}|${c.deviceLabel || ''}|${c.songReady ? 1 : 0}|${
          c.readySongId || ''
        }|${c.audioState || ''}|${c.transportMode || ''}|${c.driftMs ?? ''}|${
          c.rttMs ?? ''
        }|${c.setlistId || ''}`
    )
    .join(';');
}

function compactSyncPayload(
  msg: SyncMessage,
  commandId: string,
  sessionId: string,
  seq: number
): SyncMessage {
  const compactSong = msg.songData ? stripHeavySongPayloadForRealtime(msg.songData) : undefined;
  const compactNext = msg.nextSongData
    ? stripHeavySongPayloadForRealtime(msg.nextSongData)
    : undefined;
  const resolvedNextId =
    msg.nextSongId !== undefined ? msg.nextSongId : msg.nextSongData?.id ?? undefined;

  return {
    ...msg,
    sessionId,
    seq: msg.seq ?? seq,
    commandId,
    ...(resolvedNextId !== undefined ? { nextSongId: resolvedNextId } : {}),
    ...(compactSong !== undefined ? { songData: compactSong } : {}),
    ...(compactNext !== undefined ? { nextSongData: compactNext } : {}),
    sentAt: nowSharedMs(),
  };
}

interface MasterRtcPeerRecord {
  pc: RTCPeerConnection | null;
  transportDc: RTCDataChannel | null;
  ntpDc: RTCDataChannel | null;
  pendingIceCandidates: any[];
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
  const sessionIdRef = useRef<string>(
    `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  );
  const transportSeqRef = useRef<number>(0);
  const cmdSeqRef = useRef<number>(0);
  const repeatCmdTimersRef = useRef<ReturnType<typeof globalThis.setTimeout>[]>([]);
  const registryRef = useRef<SlavePeerRegistryState>(createSlavePeerRegistry());
  const lastRenderSigRef = useRef<string>('');
  const scanTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const rtcPeersRef = useRef<Map<string, MasterRtcPeerRecord>>(new Map());

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

  const closeRtcPeer = useCallback((clientId: string) => {
    const existing = rtcPeersRef.current.get(clientId);
    if (!existing) return;
    rtcPeersRef.current.delete(clientId);
    try {
      existing.transportDc?.close();
    } catch {}
    try {
      existing.ntpDc?.close();
    } catch {}
    try {
      existing.pc?.close();
    } catch {}
  }, []);

  const closeAllRtcPeers = useCallback(() => {
    for (const cid of Array.from(rtcPeersRef.current.keys())) {
      closeRtcPeer(cid);
    }
  }, [closeRtcPeer]);

  const sendViaLanDataChannels = useCallback(
    (
      envelope: { event: string; payload: any },
      targetClientId?: string,
      preferNtpChannel = false
    ) => {
      const serialized = JSON.stringify(envelope);
      const pickDc = (peer: MasterRtcPeerRecord): RTCDataChannel | null => {
        if (preferNtpChannel && peer.ntpDc?.readyState === 'open') {
          return peer.ntpDc;
        }
        if (peer.transportDc?.readyState === 'open') {
          return peer.transportDc;
        }
        if (peer.ntpDc?.readyState === 'open') {
          return peer.ntpDc;
        }
        return null;
      };

      if (targetClientId) {
        const peer = rtcPeersRef.current.get(targetClientId);
        const dc = peer ? pickDc(peer) : null;
        if (dc) {
          try {
            dc.send(serialized);
          } catch {}
        }
        return;
      }
      for (const peer of rtcPeersRef.current.values()) {
        const dc = pickDc(peer);
        if (dc) {
          try {
            dc.send(serialized);
          } catch {}
        }
      }
    },
    []
  );

  const commitClientsState = useCallback((clients: ReadySlaveClient[]) => {
    const sig = buildClientsRenderSignature(clients);
    if (sig !== lastRenderSigRef.current) {
      lastRenderSigRef.current = sig;
      setConnections(clients.length);
      setReadyClients(clients);
    }
  }, []);

  const sendDiscoverRpc = useCallback(
    (ch?: RealtimeChannel | null) => {
      const target = ch || channelRef.current;
      if (!target || !isSubscribedRef.current) return false;
      const discoverPayload = {
        requestId: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        masterTs: nowSharedMs(),
      };
      sendViaLanDataChannels({
        event: 'rpc_discover_slaves',
        payload: discoverPayload,
      });
      void target.send({
        type: 'broadcast',
        event: 'rpc_discover_slaves',
        payload: discoverPayload,
      });
      return true;
    },
    [sendViaLanDataChannels]
  );

  const sendSnapshotToClient = useCallback(
    (ch: RealtimeChannel, targetClientId?: string) => {
      if (!getStateSnapshotRef.current || !isSubscribedRef.current) return;
      const snap = getStateSnapshotRef.current();
      if (!snap) return;
      const cmdId = `snap-${Date.now()}-${++cmdSeqRef.current}`;
      const seq = Math.max(1, transportSeqRef.current || ++transportSeqRef.current);
      const wirePayload = compactSyncPayload(
        {
          ...snap,
          ...(targetClientId ? { targetClientId } : {}),
        },
        cmdId,
        sessionIdRef.current,
        seq
      );
      sendViaLanDataChannels(
        { event: 'transport', payload: wirePayload },
        targetClientId
      );
      void ch.send({
        type: 'broadcast',
        event: 'transport',
        payload: wirePayload,
      });
    },
    [sendViaLanDataChannels]
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
        .on('broadcast', { event: 'rpc_slave_announce' }, ({ payload }) => {
          if (cancelled) return;
          const res = upsertSlavePeerFromRpc(registryRef.current, payload, Date.now());
          commitClientsState(res.clients);
          if ((res.isNewPeer || payload?.needsSnapshot === true) && payload?.clientId) {
            sendSnapshotToClient(channel, String(payload.clientId));
          }
        })
        .on('broadcast', { event: 'rpc_slave_heartbeat' }, ({ payload }) => {
          if (cancelled) return;
          const res = upsertSlavePeerFromRpc(registryRef.current, payload, Date.now());
          commitClientsState(res.clients);
        })
        .on('broadcast', { event: 'rpc_slave_bye' }, ({ payload }) => {
          if (cancelled || !payload?.clientId) return;
          const cid = String(payload.clientId);
          closeRtcPeer(cid);
          const res = removeSlavePeerFromBye(
            registryRef.current,
            cid,
            Number(payload.connectedAt) || undefined,
            Date.now()
          );
          commitClientsState(res.clients);
        })
        .on('broadcast', { event: 'sync_request' }, ({ payload }) => {
          if (cancelled) return;
          const t1 = nowSharedMs();
          const t2 = nowSharedMs();
          const replyPayload = {
            t0: payload?.t0,
            t1,
            t2,
            clientId: payload?.clientId,
            seq: payload?.seq,
          };
          if (payload?.clientId) {
            sendViaLanDataChannels(
              { event: 'sync_response', payload: replyPayload },
              String(payload.clientId),
              true
            );
          }
          void channel.send({
            type: 'broadcast',
            event: 'sync_response',
            payload: replyPayload,
          });
          if (
            payload?.clientId &&
            (payload?.ready === true || registryRef.current.peers.has(String(payload.clientId)))
          ) {
            const res = upsertSlavePeerFromRpc(registryRef.current, payload, Date.now());
            commitClientsState(res.clients);
          }
        })
        .on('broadcast', { event: 'request_state' }, ({ payload }) => {
          if (cancelled) return;
          if (payload?.clientId && payload?.ready !== false) {
            const res = upsertSlavePeerFromRpc(registryRef.current, payload, Date.now());
            commitClientsState(res.clients);
          }
          sendSnapshotToClient(channel, payload?.clientId ? String(payload.clientId) : undefined);
        })
        .on('broadcast', { event: 'webrtc_signal' }, async ({ payload }) => {
          if (
            cancelled ||
            !payload ||
            payload.target !== 'master' ||
            !payload.fromClientId ||
            typeof RTCPeerConnection !== 'function'
          ) {
            return;
          }
          const fromClientId = String(payload.fromClientId);
          try {
            if (payload.type === 'offer' && payload.sdp) {
              const queuedFromStub =
                rtcPeersRef.current.get(fromClientId)?.pendingIceCandidates || [];
              closeRtcPeer(fromClientId);

              const pc = new RTCPeerConnection({
                iceServers: [],
              });
              const peerRecord: MasterRtcPeerRecord = {
                pc,
                transportDc: null,
                ntpDc: null,
                pendingIceCandidates: [...queuedFromStub],
              };
              rtcPeersRef.current.set(fromClientId, peerRecord);

              pc.onicecandidate = (ev) => {
                if (!ev.candidate || cancelled || channelRef.current !== channel) return;
                void channel.send({
                  type: 'broadcast',
                  event: 'webrtc_signal',
                  payload: {
                    target: 'slave',
                    targetClientId: fromClientId,
                    type: 'ice',
                    candidate: ev.candidate.toJSON
                      ? ev.candidate.toJSON()
                      : ev.candidate,
                  },
                });
              };

              pc.ondatachannel = (ev) => {
                const dc = ev.channel;
                if (dc.label === 'tandu-ntp') {
                  peerRecord.ntpDc = dc;
                } else {
                  peerRecord.transportDc = dc;
                }
                dc.onopen = () => {
                  if (cancelled) return;
                  const peer = registryRef.current.peers.get(fromClientId);
                  if (peer) {
                    peer.transportMode = 'lan_direct';
                    commitClientsState(
                      upsertSlavePeerFromRpc(registryRef.current, peer, Date.now()).clients
                    );
                  }
                };
                dc.onmessage = (msgEv) => {
                  if (cancelled) return;
                  const t1 = nowSharedMs();
                  try {
                    const env = JSON.parse(String(msgEv.data || '{}'));
                    const p = env?.payload;
                    if (env?.event === 'sync_request' && p) {
                      const reply = {
                        t0: p.t0,
                        t1,
                        t2: nowSharedMs(),
                        clientId: p.clientId || fromClientId,
                        seq: p.seq,
                        viaLan: true,
                      };
                      if (dc.readyState === 'open') {
                        dc.send(JSON.stringify({ event: 'sync_response', payload: reply }));
                      }
                      const res = upsertSlavePeerFromRpc(
                        registryRef.current,
                        {
                          ...p,
                          clientId: p.clientId || fromClientId,
                          ready: true,
                          transportMode: 'lan_direct',
                        },
                        Date.now()
                      );
                      commitClientsState(res.clients);
                    } else if (
                      (env?.event === 'rpc_slave_heartbeat' ||
                        env?.event === 'rpc_slave_announce') &&
                      p
                    ) {
                      const res = upsertSlavePeerFromRpc(
                        registryRef.current,
                        { ...p, transportMode: 'lan_direct' },
                        Date.now()
                      );
                      commitClientsState(res.clients);
                      if (env.event === 'rpc_slave_announce' && p.needsSnapshot) {
                        sendSnapshotToClient(channel, fromClientId);
                      }
                    } else if (env?.event === 'request_state') {
                      sendSnapshotToClient(channel, fromClientId);
                    }
                  } catch {}
                };
              };

              await pc.setRemoteDescription(payload.sdp);
              // Vaciar cola de candidatos ICE locales que llegaron mientras se negociaba la descripción remota
              while (peerRecord.pendingIceCandidates.length > 0) {
                const cand = peerRecord.pendingIceCandidates.shift();
                if (cand) {
                  await pc.addIceCandidate(cand).catch(() => {});
                }
              }

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              void channel.send({
                type: 'broadcast',
                event: 'webrtc_signal',
                payload: {
                  target: 'slave',
                  targetClientId: fromClientId,
                  type: 'answer',
                  sdp: pc.localDescription,
                },
              });
            } else if (payload.type === 'ice' && payload.candidate) {
              let peer = rtcPeersRef.current.get(fromClientId);
              if (!peer) {
                peer = {
                  pc: null,
                  transportDc: null,
                  ntpDc: null,
                  pendingIceCandidates: [],
                };
                rtcPeersRef.current.set(fromClientId, peer);
              }
              if (peer.pc && peer.pc.remoteDescription) {
                await peer.pc.addIceCandidate(payload.candidate);
              } else {
                peer.pendingIceCandidates.push(payload.candidate);
              }
            }
          } catch {}
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

            sendDiscoverRpc(channel);
            initialSecondPingTimeout = globalThis.setTimeout(() => {
              if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
                sendDiscoverRpc(channel);
              }
            }, 350);

            if (watchdogInterval) globalThis.clearInterval(watchdogInterval);
            watchdogInterval = globalThis.setInterval(() => {
              if (cancelled || channelRef.current !== channel || !isSubscribedRef.current) return;
              const pruned = pruneStaleSlavePeers(registryRef.current, Date.now());
              if (pruned.evictedIds.length > 0) {
                for (const evictedId of pruned.evictedIds) {
                  closeRtcPeer(evictedId);
                }
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
      closeAllRtcPeers();
      if (watchdogInterval) globalThis.clearInterval(watchdogInterval);
      if (initialSecondPingTimeout) globalThis.clearTimeout(initialSecondPingTimeout);
      if (scanTimerRef.current) globalThis.clearTimeout(scanTimerRef.current);
      for (const t of repeatCmdTimersRef.current) {
        globalThis.clearTimeout(t);
      }
      repeatCmdTimersRef.current = [];
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
  }, [
    bandId,
    closeAllRtcPeers,
    closeRtcPeer,
    commitClientsState,
    sendDiscoverRpc,
    sendSnapshotToClient,
    sendViaLanDataChannels,
  ]);

  const broadcast = useCallback(
    (msg: SyncMessage) => {
      const ch = channelRef.current;
      if (!ch || !isSubscribedRef.current) return;

      const isCriticalStateChange =
        msg.type === 'PLAY' ||
        msg.type === 'PAUSE' ||
        msg.type === 'STOP' ||
        msg.type === 'LOAD_SONG' ||
        msg.type === 'SEEK';

      // Incrementar secuencia monotónica solo en cambios reales de transporte (HEARTBEAT/SNAPSHOT conservan la actual)
      const nextSeq = isCriticalStateChange
        ? ++transportSeqRef.current
        : Math.max(1, transportSeqRef.current || ++transportSeqRef.current);

      const cmdId = msg.commandId || `cmd-${Date.now()}-${++cmdSeqRef.current}`;
      const wirePayload = compactSyncPayload(
        msg,
        cmdId,
        sessionIdRef.current,
        nextSeq
      );

      if (isCriticalStateChange && repeatCmdTimersRef.current.length > 0) {
        for (const t of repeatCmdTimersRef.current) {
          globalThis.clearTimeout(t);
        }
        repeatCmdTimersRef.current = [];
      }

      const dispatchWirePacket = (payloadToSend: SyncMessage) => {
        sendViaLanDataChannels(
          { event: 'transport', payload: payloadToSend },
          payloadToSend.targetClientId
        );
        void ch.send({
          type: 'broadcast',
          event: 'transport',
          payload: payloadToSend,
        });
      };

      dispatchWirePacket(wirePayload);

      // Triple pulso idempotente (0ms, +55ms y +125ms con el MISMO seq/commandId/startAt) por LAN WebRTC + Cloud
      // para garantizar recepción 100% determinista sin duplicar acciones ni pisar órdenes más nuevas
      if (isCriticalStateChange) {
        for (const delayOffsetMs of [55, 125]) {
          const timer = globalThis.setTimeout(() => {
            if (channelRef.current === ch && isSubscribedRef.current) {
              dispatchWirePacket({
                ...wirePayload,
                sentAt: nowSharedMs(),
              });
            }
          }, delayOffsetMs);
          repeatCmdTimersRef.current.push(timer);
        }
      }
    },
    [sendViaLanDataChannels]
  );

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
