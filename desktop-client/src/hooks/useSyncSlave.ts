import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  SyncMessage,
  NtpPingSample,
  SLAVE_HEARTBEAT_INTERVAL_MS,
  acquireCleanRealtimeChannel,
  computeFilteredNtpClockOffset,
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

export interface UseSyncSlaveOptions {
  /**
   * Cuando es `false`, el dispositivo NO se suscribe ni anuncia presencia en el canal del Master.
   * Solo debe activarse (`true`) después de descargar la playlist en MP3 y presionar "Conectar y Sincronizar".
   */
  enabled?: boolean;
  deviceLabel?: string;
  setlistId?: string | null;
  songReady?: boolean;
}

export function useSyncSlave(bandId: string, options?: UseSyncSlaveOptions) {
  const enabled = options?.enabled ?? true;
  const deviceLabel = options?.deviceLabel;
  const setlistId = options?.setlistId ?? null;
  const songReady = options?.songReady ?? false;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const clientIdRef = useRef<string>(getOrCreateStableSlaveClientId());
  const connectedAtRef = useRef<number>(Date.now());
  const ntpSamplesRef = useRef<NtpPingSample[]>([]);
  const isSubscribedRef = useRef<boolean>(false);
  const seenCommandIdsRef = useRef<Set<string>>(new Set());
  const currentSongIdRef = useRef<string | null>(null);
  const isPlayingInternalRef = useRef<boolean>(false);

  const slaveMetaRef = useRef<{
    deviceLabel?: string;
    setlistId: string | null;
    songReady: boolean;
    rttMs: number;
  }>({
    deviceLabel,
    setlistId,
    songReady,
    rttMs: 0,
  });
  slaveMetaRef.current.deviceLabel = deviceLabel;
  slaveMetaRef.current.setlistId = setlistId;
  slaveMetaRef.current.songReady = songReady;

  // Slave state
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [masterSetlistId, setMasterSetlistId] = useState<string | null>(null);
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [nextSongId, setNextSongId] = useState<string | null>(null);
  const [songData, setSongData] = useState<any>(null);
  const [nextSongData, setNextSongData] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Transport control signals triggered by Master
  const [playTrigger, setPlayTrigger] = useState<{
    commandId?: string;
    startAt: number;
    offset: number;
    ts: number;
    songId?: string;
  } | null>(null);
  const [pauseTrigger, setPauseTrigger] = useState<{ ts: number } | null>(null);
  const [seekTrigger, setSeekTrigger] = useState<{
    offset: number;
    ts: number;
    isStop?: boolean;
  } | null>(null);
  const [heartbeatTrigger, setHeartbeatTrigger] = useState<{
    startAt: number;
    offset: number;
    songId?: string;
    ts: number;
  } | null>(null);
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [rttMs, setRttMs] = useState<number>(0);

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
      void ch.send({
        type: 'broadcast',
        event,
        payload: buildSlaveRpcPayload(extra),
      });
    },
    [buildSlaveRpcPayload]
  );

  const sendNtpBurst = useCallback((ch: RealtimeChannel, count = 8) => {
    const clientId = clientIdRef.current;
    for (let i = 0; i < count; i++) {
      globalThis.setTimeout(() => {
        if (channelRef.current !== ch || !isSubscribedRef.current) return;
        void ch.send({
          type: 'broadcast',
          event: 'sync_request',
          payload: {
            t0: Date.now(),
            clientId,
            ready: true,
            seq: i,
          },
        });
      }, i * 65);
    }
  }, []);

  const requestMasterState = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !isSubscribedRef.current) return;
    emitSlaveRpc(ch, 'rpc_slave_announce');
    void ch.send({
      type: 'broadcast',
      event: 'request_state',
      payload: buildSlaveRpcPayload({ t0: Date.now() }),
    });
  }, [buildSlaveRpcPayload, emitSlaveRpc]);

  useEffect(() => {
    if (!bandId || !enabled) {
      isSubscribedRef.current = false;
      isPlayingInternalRef.current = false;
      setConnectionStatus('disconnected');
      setIsPlaying(false);
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
    setConnectionStatus('connecting');

    const sendByeImmediately = () => {
      if (byeSent || !activeChannel || !isSubscribedRef.current) return;
      byeSent = true;
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
        sendNtpBurst(activeChannel, 4);
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
        void channel.send({
          type: 'broadcast',
          event: 'sync_request',
          payload: { t0: Date.now(), clientId, ready: true, seq: 99 },
        });
      });

      channel.on('broadcast', { event: 'transport' }, ({ payload }) => {
        const msg = payload as SyncMessage;
        if (!msg) return;
        if (msg.targetClientId && msg.targetClientId !== clientId) return;

        // Deduplicar el segundo pulso idempotente (+85ms) del Master para ejecutar cada orden exactamente 1 vez
        if (msg.commandId && msg.type !== 'HEARTBEAT') {
          if (seenCommandIdsRef.current.has(msg.commandId)) {
            return;
          }
          seenCommandIdsRef.current.add(msg.commandId);
          if (seenCommandIdsRef.current.size > 64) {
            const oldest = seenCommandIdsRef.current.values().next().value;
            if (oldest) seenCommandIdsRef.current.delete(oldest);
          }
        }

        if (msg.setlistId !== undefined && msg.setlistId !== null) {
          setMasterSetlistId((prev) => (prev !== msg.setlistId ? msg.setlistId! : prev));
        }
        if (msg.nextSongId !== undefined) {
          setNextSongId((prev) => (prev !== (msg.nextSongId ?? null) ? msg.nextSongId ?? null : prev));
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

        const nowTs = Date.now();

        switch (msg.type) {
          case 'PREFETCH_SONG':
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
            break;

          case 'LOAD_SONG': {
            const songChanged = Boolean(msg.songId && msg.songId !== currentSongIdRef.current);
            updateActiveSongSafe(msg.songId, msg.songData);
            if (songChanged || isPlayingInternalRef.current) {
              isPlayingInternalRef.current = false;
              setIsPlaying(false);
              setPauseTrigger({ ts: nowTs });
            }
            if (typeof msg.offset === 'number') {
              setSeekTrigger({ offset: msg.offset, ts: nowTs });
            }
            break;
          }

          case 'STATE_SNAPSHOT':
            updateActiveSongSafe(msg.songId, msg.songData);
            if (msg.isPlaying && msg.startAt !== undefined && msg.offset !== undefined) {
              isPlayingInternalRef.current = true;
              setIsPlaying(true);
              setPlayTrigger({
                commandId: msg.commandId,
                startAt: msg.startAt,
                offset: msg.offset,
                songId: msg.songId,
                ts: nowTs,
              });
            } else {
              isPlayingInternalRef.current = false;
              setIsPlaying(false);
              if (typeof msg.offset === 'number') {
                setSeekTrigger({ offset: msg.offset, ts: nowTs });
              }
            }
            break;

          case 'PLAY':
            updateActiveSongSafe(msg.songId, msg.songData);
            if (msg.startAt !== undefined && msg.offset !== undefined) {
              isPlayingInternalRef.current = true;
              setIsPlaying(true);
              setPlayTrigger({
                commandId: msg.commandId,
                startAt: msg.startAt,
                offset: msg.offset,
                songId: msg.songId,
                ts: nowTs,
              });
            }
            break;

          case 'HEARTBEAT':
            updateActiveSongSafe(msg.songId, msg.songData);
            if (msg.isPlaying && msg.startAt !== undefined && msg.offset !== undefined) {
              isPlayingInternalRef.current = true;
              setIsPlaying(true);
              setHeartbeatTrigger({
                startAt: msg.startAt,
                offset: msg.offset,
                songId: msg.songId,
                ts: nowTs,
              });
            }
            break;

          case 'PAUSE':
            isPlayingInternalRef.current = false;
            setIsPlaying(false);
            setPauseTrigger({ ts: nowTs });
            if (typeof msg.offset === 'number') {
              setSeekTrigger({ offset: msg.offset, ts: nowTs });
            }
            break;

          case 'STOP':
            isPlayingInternalRef.current = false;
            setIsPlaying(false);
            setPauseTrigger({ ts: nowTs });
            setSeekTrigger({
              offset: typeof msg.offset === 'number' ? msg.offset : 0,
              ts: nowTs,
              isStop: true,
            });
            break;

          case 'SEEK':
            if (msg.offset !== undefined) {
              setSeekTrigger({ offset: msg.offset, ts: nowTs });
            }
            break;
        }
      });

      // NTP Synchronization (Slave Side) con ventana de 12 muestras y filtro de cuartil mínimo
      channel.on('broadcast', { event: 'sync_response' }, ({ payload }) => {
        if (!payload || payload.clientId !== clientId) return;
        const t2 = Date.now();
        const sample: NtpPingSample = {
          t0: Number(payload.t0),
          t1: Number(payload.t1),
          t2,
        };
        const updatedSamples = [...ntpSamplesRef.current.slice(-11), sample];
        ntpSamplesRef.current = updatedSamples;

        const filtered = computeFilteredNtpClockOffset(updatedSamples);
        if (filtered.sampleCount > 0) {
          slaveMetaRef.current.rttMs = filtered.bestRttMs;
          setClockOffset(filtered.clockOffsetMs);
          setRttMs(filtered.bestRttMs);
        }
      });

      channel.subscribe((status) => {
        if (cancelled || channelRef.current !== channel) return;
        if (status === 'SUBSCRIBED') {
          isSubscribedRef.current = true;
          byeSent = false;
          setConnectionStatus('connected');

          void channel.track(buildSlaveRpcPayload()).catch(() => {});

          // 1. Anuncio RPC instantáneo al Master (<30ms) + solicitud de snapshot
          emitSlaveRpc(channel, 'rpc_slave_announce', { needsSnapshot: true });

          // 2. Ráfaga inicial de 8 muestras NTP (cada 65ms = 0.5s) para calibrar reloj con precisión <3ms
          sendNtpBurst(channel, 8);

          // 3. Solicitar estado actual al Master inmediatamente
          void channel.send({
            type: 'broadcast',
            event: 'request_state',
            payload: buildSlaveRpcPayload({ t0: Date.now() }),
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
                  payload: buildSlaveRpcPayload({ t0: Date.now() }),
                });
              }
            }, 700)
          );

          // 4. Latido RPC ultrarrápido cada 1.8s
          if (fastHeartbeatId !== null) globalThis.clearInterval(fastHeartbeatId);
          fastHeartbeatId = globalThis.setInterval(() => {
            if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
              emitSlaveRpc(channel, 'rpc_slave_heartbeat');
            }
          }, SLAVE_HEARTBEAT_INTERVAL_MS);

          // 5. Re-calibración periódica de reloj NTP cada 10s para anular deriva térmica de osciladores móviles
          if (ntpIntervalId !== null) globalThis.clearInterval(ntpIntervalId);
          ntpIntervalId = globalThis.setInterval(() => {
            if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
              sendNtpBurst(channel, 3);
            }
          }, 10000);
        } else if (
          status === 'CLOSED' ||
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT'
        ) {
          isSubscribedRef.current = false;
          setConnectionStatus('disconnected');
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
  }, [enabled, deviceLabel, setlistId, songReady, buildSlaveRpcPayload, emitSlaveRpc]);

  return {
    connectionStatus,
    masterSetlistId,
    currentSongId,
    nextSongId,
    songData,
    nextSongData,
    isPlaying,
    playTrigger,
    pauseTrigger,
    seekTrigger,
    heartbeatTrigger,
    clockOffset,
    rttMs,
    requestMasterState,
  };
}
