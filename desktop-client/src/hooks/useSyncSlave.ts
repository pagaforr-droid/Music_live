import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  SyncMessage,
  NtpPingSample,
  computeFilteredNtpClockOffset,
} from './useSyncMaster';

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
  const clientIdRef = useRef<string>(
    `slave-${Math.random().toString(36).slice(2, 11)}`
  );
  const ntpSamplesRef = useRef<NtpPingSample[]>([]);
  const isSubscribedRef = useRef<boolean>(false);

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

  const sendNtpBurst = useCallback((ch: RealtimeChannel, count = 5) => {
    const clientId = clientIdRef.current;
    for (let i = 0; i < count; i++) {
      window.setTimeout(() => {
        if (channelRef.current !== ch) return;
        ch.send({
          type: 'broadcast',
          event: 'sync_request',
          payload: { t0: Date.now(), clientId, seq: i },
        });
      }, i * 110);
    }
  }, []);

  const requestMasterState = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !isSubscribedRef.current) return;
    ch.send({
      type: 'broadcast',
      event: 'request_state',
      payload: { clientId: clientIdRef.current, t0: Date.now() },
    });
  }, []);

  useEffect(() => {
    if (!bandId || !enabled) {
      isSubscribedRef.current = false;
      setConnectionStatus('disconnected');
      setIsPlaying(false);
      return;
    }

    const clientId = clientIdRef.current;
    ntpSamplesRef.current = [];
    setConnectionStatus('connecting');

    const channel = supabase.channel(`sync-${bandId}`, {
      config: {
        presence: {
          key: clientId,
        },
      },
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
        setClockOffset(filtered.clockOffsetMs);
        setRttMs(filtered.bestRttMs);
      }
    });

    let intervalId: number | null = null;

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        isSubscribedRef.current = true;
        setConnectionStatus('connected');
        channel.track({
          isMaster: false,
          ready: true,
          clientId,
          deviceLabel,
          setlistId,
          songReady,
          connectedAt: Date.now(),
        });

        // 1. Ráfaga inicial de 5 muestras NTP para calibrar reloj con precisión <10ms
        sendNtpBurst(channel, 5);

        // 2. Solicitar estado actual (canción, setlist y posición) al Master inmediatamente
        channel.send({
          type: 'broadcast',
          event: 'request_state',
          payload: { clientId, t0: Date.now() },
        });
        // Reintento corto a los 600ms por si la primera calibración NTP aún estaba en vuelo
        window.setTimeout(() => {
          if (channelRef.current === channel) {
            channel.send({
              type: 'broadcast',
              event: 'request_state',
              payload: { clientId, t0: Date.now() },
            });
          }
        }, 600);

        // 3. Re-calibración periódica cada 20s con mini-ráfaga de 3 muestras
        if (intervalId !== null) window.clearInterval(intervalId);
        intervalId = window.setInterval(() => {
          sendNtpBurst(channel, 3);
        }, 20000);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        isSubscribedRef.current = false;
        setConnectionStatus('disconnected');
      }
    });

    channelRef.current = channel;

    return () => {
      isSubscribedRef.current = false;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [bandId, enabled, sendNtpBurst]);

  // Actualizar metadatos de presencia cuando el esclavo termina de cargar la canción en RAM
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !enabled || !isSubscribedRef.current) return;
    ch.track({
      isMaster: false,
      ready: true,
      clientId: clientIdRef.current,
      deviceLabel,
      setlistId,
      songReady,
      connectedAt: Date.now(),
    }).catch(() => {});
  }, [enabled, deviceLabel, setlistId, songReady]);

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
