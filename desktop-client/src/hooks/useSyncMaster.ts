import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface SyncMessage {
  type: 'LOAD_SONG' | 'PLAY' | 'PAUSE' | 'SEEK';
  songId?: string;
  startAt?: number; // timestamp in ms (future)
  offset?: number; // current time in seconds when played/seeked
  songData?: any; // Additional data for slave to load properly
}

export function useSyncMaster(bandId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [connections, setConnections] = useState(0);

  useEffect(() => {
    if (!bandId) return;

    // Create a unique channel per band
    const channel = supabase.channel(`sync-${bandId}`, {
      config: {
        presence: {
          key: 'master',
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        // Count total connections minus master (naive approach)
        const total = Object.keys(state).length;
        setConnections(Math.max(0, total - 1));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ isMaster: true });
        }
      });

    // NTP Time Synchronization (Master Side)
    channel.on('broadcast', { event: 'sync_request' }, ({ payload }) => {
      channel.send({
        type: 'broadcast',
        event: 'sync_response',
        payload: {
          t0: payload.t0,
          t1: Date.now(),
          clientId: payload.clientId
        }
      });
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bandId]);

  const broadcast = (msg: SyncMessage) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'transport',
        payload: msg
      });
    }
  };

  return { broadcast, connections };
}
