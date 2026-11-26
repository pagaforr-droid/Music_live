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
  const rtcPcRef = useRef<RTCPeerConnection | null>(null);
  const rtcDcRef = useRef<RTCDataChannel | null>(null);
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
  const [transportMode, setTransportMode] = useState<'lan_direct' | 'cloud_realtime'>(
    'cloud_realtime'
  );
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
      const payload = buildSlaveRpcPayload(extra);
      const dc = rtcDcRef.current;
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
          t0: Date.now(),
          clientId,
          ready: true,
          seq: i,
        };
        const dc = rtcDcRef.current;
        if (dc && dc.readyState === 'open') {
          try {
            dc.send(JSON.stringify({ event: 'sync_request', payload: reqPayload }));
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
    const reqPayload = buildSlaveRpcPayload({ t0: Date.now() });
    const dc = rtcDcRef.current;
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
      isPlayingInternalRef.current = false;
      setConnectionStatus('disconnected');
      setTransportMode('cloud_realtime');
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
    setTransportMode('cloud_realtime');

    const closeSlaveRtc = () => {
      try {
        rtcDcRef.current?.close();
      } catch {}
      try {
        rtcPcRef.current?.close();
      } catch {}
      rtcDcRef.current = null;
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
      const t2 = Date.now();
      const sample: NtpPingSample = {
        t0: Number(payload.t0),
        t1: Number(payload.t1),
        t2,
      };
      const updatedSamples = [...ntpSamplesRef.current.slice(-19), sample];
      ntpSamplesRef.current = updatedSamples;

      const filtered = computeFilteredNtpClockOffset(updatedSamples);
      if (filtered.sampleCount > 0) {
        slaveMetaRef.current.rttMs = filtered.bestRttMs;
        setClockOffset(filtered.clockOffsetMs);
        setRttMs(filtered.bestRttMs);
      }
    };

    const handleIncomingTransport = (payload: any) => {
      const msg = payload as SyncMessage;
      if (!msg) return;
      if (msg.targetClientId && msg.targetClientId !== clientId) return;

      // Deduplicar tanto los pulsos idempotentes (+55ms / +125ms) como la doble vía (LAN WebRTC + Cloud)
      if (msg.commandId) {
        if (seenCommandIdsRef.current.has(msg.commandId)) {
          return;
        }
        seenCommandIdsRef.current.add(msg.commandId);
        if (seenCommandIdsRef.current.size > 96) {
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
    };

    const connectLanWebRtcFastPath = async (channel: RealtimeChannel) => {
      if (cancelled || typeof RTCPeerConnection !== 'function') return;
      if (rtcDcRef.current && rtcDcRef.current.readyState === 'open') return;
      try {
        closeSlaveRtc();
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        rtcPcRef.current = pc;

        const dc = pc.createDataChannel('tandu-sync-lan', {
          ordered: false,
          maxRetransmits: 0,
        });
        rtcDcRef.current = dc;

        dc.onopen = () => {
          if (cancelled || rtcDcRef.current !== dc) return;
          setTransportMode('lan_direct');
          // Ráfaga NTP inmediata por LAN Directa (~2-6ms RTT) para clavar el reloj del celular con el PC
          sendNtpBurst(channel, 8);
          emitSlaveRpc(channel, 'rpc_slave_announce');
        };

        dc.onclose = () => {
          if (rtcDcRef.current === dc) {
            setTransportMode('cloud_realtime');
          }
        };

        dc.onmessage = (msgEv) => {
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
        if (!cancelled && channelRef.current === channel) {
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
        if (!rtcDcRef.current || rtcDcRef.current.readyState !== 'open') {
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
        try {
          if (payload.type === 'answer' && payload.sdp) {
            await rtcPcRef.current.setRemoteDescription(payload.sdp);
          } else if (payload.type === 'ice' && payload.candidate) {
            if (rtcPcRef.current.remoteDescription) {
              await rtcPcRef.current.addIceCandidate(payload.candidate);
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

          // 1. Anuncio RPC instantáneo al Master (<30ms) + solicitud de snapshot
          emitSlaveRpc(channel, 'rpc_slave_announce', { needsSnapshot: true });

          // 2. Iniciar canal directo LAN WebRTC P2P (~2-6ms RTT en la misma red Wi-Fi)
          void connectLanWebRtcFastPath(channel);

          // 3. Ráfaga inicial de 8 muestras NTP para calibrar reloj
          sendNtpBurst(channel, 8);

          // 4. Solicitar estado actual al Master inmediatamente
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
          // Ráfagas NTP secundarias cuando la CPU del celular ya terminó la carga inicial
          for (const idleCheckMs of [1400, 2800]) {
            timeouts.push(
              globalThis.setTimeout(() => {
                if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
                  sendNtpBurst(channel, 4);
                }
              }, idleCheckMs)
            );
          }

          // 5. Latido RPC ultrarrápido cada 1.8s
          if (fastHeartbeatId !== null) globalThis.clearInterval(fastHeartbeatId);
          fastHeartbeatId = globalThis.setInterval(() => {
            if (!cancelled && channelRef.current === channel && isSubscribedRef.current) {
              emitSlaveRpc(channel, 'rpc_slave_heartbeat');
            }
          }, SLAVE_HEARTBEAT_INTERVAL_MS);

          // 6. Re-calibración periódica de reloj NTP cada 6s para anular deriva térmica de osciladores móviles
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
  }, [enabled, deviceLabel, setlistId, songReady, buildSlaveRpcPayload, emitSlaveRpc]);

  return {
    connectionStatus,
    transportMode,
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
    triggerNtpRecalibration,
  };
}
