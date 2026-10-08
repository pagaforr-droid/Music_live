import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SyncMessage } from './useSyncMaster';

export function useSyncSlave(bandId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  
  // Slave state
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [songData, setSongData] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Transport control signals triggered by Master
  const [playTrigger, setPlayTrigger] = useState<{ startAt: number, offset: number, ts: number } | null>(null);
  const [pauseTrigger, setPauseTrigger] = useState<{ ts: number } | null>(null);
  const [seekTrigger, setSeekTrigger] = useState<{ offset: number, ts: number } | null>(null);
  const [clockOffset, setClockOffset] = useState<number>(0);

  useEffect(() => {
    if (!bandId) return;

    const clientId = `slave-${Math.random().toString(36).substr(2, 9)}`;

    const channel = supabase.channel(`sync-${bandId}`, {
      config: {
        presence: {
          key: clientId,
        },
      },
    });

    channel
      .on('broadcast', { event: 'transport' }, ({ payload }) => {
        const msg = payload as SyncMessage;
        
        switch (msg.type) {
          case 'LOAD_SONG':
            if (msg.songId) {
              setCurrentSongId(msg.songId);
              setSongData(msg.songData);
              setIsPlaying(false);
              setPauseTrigger({ ts: Date.now() });
            }
            break;
          case 'PLAY':
            if (msg.startAt !== undefined && msg.offset !== undefined) {
              setPlayTrigger({ startAt: msg.startAt, offset: msg.offset, ts: Date.now() });
              setIsPlaying(true);
            }
            break;
          case 'PAUSE':
            setPauseTrigger({ ts: Date.now() });
            setIsPlaying(false);
            break;
          case 'SEEK':
            if (msg.offset !== undefined) {
              setSeekTrigger({ offset: msg.offset, ts: Date.now() });
            }
            break;
        }
      });

    // NTP Synchronization (Slave Side)
    channel.on('broadcast', { event: 'sync_response' }, ({ payload }) => {
      if (payload.clientId !== clientId) return; // FIX: Solo mi respuesta
      const t2 = Date.now();
      const rtt = t2 - payload.t0; // Round trip time
      const latency = rtt / 2; // One-way latency
      const masterTime = payload.t1 + latency;
      const offset = masterTime - Date.now();
      setClockOffset(offset);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({ isMaster: false });
        // Send initial sync ping
        channel.send({
          type: 'broadcast',
          event: 'sync_request',
          payload: { t0: Date.now(), clientId }
        });
        
        // Pings periódicos para mantener el offset fresco y preciso
        const intervalId = setInterval(() => {
           channel.send({
             type: 'broadcast',
             event: 'sync_request',
             payload: { t0: Date.now(), clientId }
           });
        }, 30000); // Cada 30s
        
        return () => clearInterval(intervalId);
      }
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bandId]);

  return { 
    currentSongId, 
    songData, 
    isPlaying,
    playTrigger,
    pauseTrigger,
    seekTrigger,
    clockOffset
  };
}
