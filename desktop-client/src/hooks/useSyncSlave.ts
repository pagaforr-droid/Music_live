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

  // Metadatos vivos en ref para que los RPC de anuncio/latido siempre lleven el estado más reciente
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
  const [songData, setSongData] = useState<any>(null);
  const [nextSongData, setNextSongData] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Transport control signals triggered by Master
  const [playTrigger, setPlayTrigger] = useState<{
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

  const sendNtpBurst = useCallback((ch: RealtimeChannel, count = 5) => {
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
      }, i * 110);
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
        sendNtpBurst(activeChannel, 2);
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

      // Responder a la velocidad de un rayo (<30ms) cuando el Master dispara un escaneo/Roll-Call RPC
      channel.on('broadcast', { event: 'rpc_discover_slaves' }, ({ payload }) => {
        if (cancelled || channelRef.current !== channel) return;
        emitSlaveRpc(channel, 'rpc_slave_announce', {
          replyToRequestId: payload?.requestId,
        });
        // Ping NTP rápido de 1 muestra para mantener rttMs y reloj actualizados
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

        if (msg.setlistId !== undefined && msg.setlistId !== null) {
          setMasterSetlistId(msg.setlistId);
        }
        if (msg.nextSongData !== undefined) {
          setNextSongData(msg.nextSongData);
        }

        switch (msg.type) {
          case 'PREFETCH_SONG':
            if (msg.nextSongData || msg.songData) {
              setNextSongData(msg.nextSongData || msg.songData);
            }
            break;

          case 'LOAD_SONG':
            if (msg.songId) {
              setCurrentSongId(msg.songId);
              setSongData(msg.songData);
              setIsPlaying(false);
              setPauseTrigger({ ts: Date.now() });
            }
            break;

          case 'STATE_SNAPSHOT':
            if (msg.songId && msg.songData) {
              setCurrentSongId(msg.songId);
              setSongData(msg.songData);
            }
            if (msg.isPlaying && msg.startAt !== undefined && msg.offset !== undefined) {
              setIsPlaying(true);
              setPlayTrigger({
                startAt: msg.startAt,
                offset: msg.offset,
                songId: msg.songId,
                ts: Date.now(),
              });
            } else {
              setIsPlaying(false);
              if (typeof msg.offset === 'number') {
                setSeekTrigger({ offset: msg.offset, ts: Date.now() });
              }
            }
            break;

          case 'PLAY':
            if (msg.songId && msg.songData) {
              setCurrentSongId(msg.songId);
              setSongData(msg.songData);
            }
            if (msg.startAt !== undefined && msg.offset !== undefined) {
              setPlayTrigger({
                startAt: msg.startAt,
                offset: msg.offset,
                songId: msg.songId,
                ts: Date.now(),
              });
              setIsPlaying(true);
            }
            break;

          case 'HEARTBEAT':
            if (msg.songId && msg.songData) {
              setCurrentSongId((prev) => (prev !== msg.songId ? msg.songId! : prev));
              setSongData((prev: any) =>
                !prev || prev.id !== msg.songId ? msg.songData : prev
              );
            }
            if (msg.isPlaying && msg.startAt !== undefined && msg.offset !== undefined) {
              setIsPlaying(true);
              setHeartbeatTrigger({
                startAt: msg.startAt,
                offset: msg.offset,
                songId: msg.songId,
                ts: Date.now(),
              });
            }
            break;

          case 'PAUSE':
            setPauseTrigger({ ts: Date.now() });
            setIsPlaying(false);
            if (typeof msg.offset === 'number') {
              setSeekTrigger({ offset: msg.offset, ts: Date.now() });
            }
            break;

          case 'STOP':
            setPauseTrigger({ ts: Date.now() });
            setIsPlaying(false);
            setSeekTrigger({
              offset: typeof msg.offset === 'number' ? msg.offset : 0,
              ts: Date.now(),
              isStop: true,
            });
            break;

          case 'SEEK':
            if (msg.offset !== undefined) {
              setSeekTrigger({ offset: msg.offset, ts: Date.now() });
            }
            break;
        }
      });

      // NTP Synchronization (Slave Side) con filtrado multi-muestra de jitter Wi-Fi
      channel.on('broadcast', { event: 'sync_response' }, ({ payload }) => {
        if (!payload || payload.clientId !== clientId) return;
        const t2 = Date.now();
        const sample: NtpPingSample = {
          t0: Number(payload.t0),
          t1: Number(payload.t1),
          t2,
        };
        const updatedSamples = [...ntpSamplesRef.current.slice(-7), sample];
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

          // 2. Ráfaga inicial de 5 muestras NTP para calibrar reloj con precisión <10ms
          sendNtpBurst(channel, 5);

          // 3. Solicitar estado actual (canción, setlist y posición) al Master inmediatamente
          void channel.send({
            type: 'broadcast',
            event: 'request_state',
            payload: buildSlaveRpcPayload({ t0: Date.now() }),
          });

          // Reintentos cortos con rttMs ya calibrado
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
            }, 750)
          );

          // 4. Latido RPC ultrarrápido cada 1.8s para que Live Concert detecte conexiones/caídas al instante
          if (fastHeartbeatId !== null) globalThis.clearInterval(fastHeartbeatId);
          fastHeartbeatId = globalThis.setInterval(() => {
            if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
              emitSlaveRpc(channel, 'rpc_slave_heartbeat');
            }
          }, SLAVE_HEARTBEAT_INTERVAL_MS);

          // 5. Re-calibración periódica cada 20s con mini-ráfaga de 3 muestras NTP
          if (ntpIntervalId !== null) globalThis.clearInterval(ntpIntervalId);
          ntpIntervalId = globalThis.setInterval(() => {
            if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
              sendNtpBurst(channel, 3);
            }
          }, 20000);
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
      // Enviar RPC de despedida instantánea ANTES de cerrar el canal
      sendByeImmediately();
      isSubscribedRef.current = false;
      if (activeChannel) {
        if (channelRef.current === activeChannel) {
          channelRef.current = null;
        }
        void supabase.removeChannel(activeChannel);
      }
    };
  }, [bandId, enabled, buildSlaveRpcPayload, emitSlaveRpc, sendNtpBurst]);

  // Actualizar metadatos (presencia + RPC inmediato) cuando cambia canción lista en RAM o etiqueta
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
