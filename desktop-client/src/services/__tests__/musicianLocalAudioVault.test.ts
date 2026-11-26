import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
          in: async () => ({ data: [], error: null }),
        }),
        order: async () => ({ data: [], error: null }),
      }),
    }),
  },
}));

import {
  type PracticeSongItem,
  checkMusicianOfflineLease,
  clearAllLocalMp3Vault,
  computeSongChannelSignature,
  downloadInEarPlaylistToLocalVault,
  encodeRiffWavBufferToMp3,
  ensureSongMp3CachedInDevice,
  evaluateInEarPlaylistReadiness,
  formatBytesCompact,
  inspectRawEncryptedVaultBuffer,
  readCachedPracticeCatalog,
  readDecryptedTrackArrayBuffer,
  readLocalMp3Blob,
  readLocalTrackMeta,
  readLocalVaultSummary,
  renewMusicianOfflineLease,
  resetMusicianVaultMemoryForTests,
  resolveCandidateAudioSources,
  resolvePreferredMp3Source,
  saveCachedPracticeCatalog,
  wipeAudioArrayBufferInRam,
} from '../musicianLocalAudioVault';
import {
  SLAVE_HEARTBEAT_TTL_MS,
  SLAVE_PROBE_THRESHOLD_MS,
  computeFilteredNtpClockOffset,
  computePhaseLockedSlaveStart,
  computeSlaveDriftCorrection,
  computeSlavePllServoAdjustment,
  countReadySlavePresences,
  createSlavePeerRegistry,
  estimateSlaveAcousticOutputLatencyMs,
  pruneStaleSlavePeers,
  reconcilePresenceWithRegistry,
  removeSlavePeerFromBye,
  stripHeavySongPayloadForRealtime,
  upsertSlavePeerFromRpc,
} from '../../hooks/useSyncMaster';

describe('Musician Encrypted Local Vault & Zero Supabase Egress Optimization', () => {
  beforeEach(() => {
    resetMusicianVaultMemoryForTests();
    vi.restoreAllMocks();
  });

  const sampleSong: PracticeSongItem = {
    id: 'song-001',
    title: 'Fuego En El Altar',
    foh_mix_url: 'https://supa.example.com/audios/foh_100.wav',
    cue_mix_url: 'https://supa.example.com/audios/cue_100.wav',
    foh_mobile_url: 'https://supa.example.com/audios/foh_mobile_100.mp3',
    cue_mobile_url: 'https://supa.example.com/audios/cue_mobile_100.mp3',
    prompter_data: {
      bpm: 128,
      key: 'Am',
      liveMixMeta: {
        version: 3,
        exportedAt: '2026-11-25T15:00:00.000Z',
        preRollSec: 3.75,
      },
    },
  };

  it('prioritizes lightweight foh_mobile_url and cue_mobile_url MP3 and hashes signatures so no raw URLs sit in index', () => {
    const foh = resolvePreferredMp3Source(sampleSong, 'foh');
    const cue = resolvePreferredMp3Source(sampleSong, 'cue');
    expect(foh.url).toBe('https://supa.example.com/audios/foh_mobile_100.mp3');
    expect(foh.isLikelyWav).toBe(false);
    expect(cue.url).toBe('https://supa.example.com/audios/cue_mobile_100.mp3');
    expect(cue.isLikelyWav).toBe(false);

    const sig = computeSongChannelSignature(sampleSong, 'foh');
    expect(sig.length).toBe(64);
    expect(sig.includes('http')).toBe(false);
    expect(sig.includes('.mp3')).toBe(false);
  });

  it('encrypts stored audio (never plaintext MP3 in storage), downloads CUE lazily on-demand (-50% Egress), and wipes RAM buffers', async () => {
    const plainFohBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 10, 20, 30, 40, 50, 60]);
    const plainCueBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 99, 88, 77, 66]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      const body = url.includes('cue_mobile')
        ? plainCueBytes.slice().buffer
        : plainFohBytes.slice().buffer;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });

    // 1. Default sync (includeCue omitted -> false): downloads ONLY FOH (1 request instead of 2!)
    const savedFohOnly = await ensureSongMp3CachedInDevice({
      song: sampleSong,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(savedFohOnly.hasFoh).toBe(true);
    expect(savedFohOnly.hasCue).toBe(false);
    expect(savedFohOnly.encrypted).toBe(true);

    // Verify raw bytes in vault are ENCRYPTED (do NOT start with plaintext ID3 0x49 0x44 0x33)
    const rawVaultInspection = await inspectRawEncryptedVaultBuffer(sampleSong.id, 'foh');
    expect(rawVaultInspection).not.toBeNull();
    const isPlainId3Header =
      rawVaultInspection!.rawCipherBytes[0] === 0x49 &&
      rawVaultInspection!.rawCipherBytes[1] === 0x44 &&
      rawVaultInspection!.rawCipherBytes[2] === 0x33;
    expect(isPlainId3Header).toBe(false);

    // Verify decryption in volatile RAM recovers the exact original bytes, and wipeAudioArrayBufferInRam zeros them
    const decryptedRam = await readDecryptedTrackArrayBuffer(sampleSong.id, 'foh');
    expect(decryptedRam).not.toBeNull();
    expect(Array.from(new Uint8Array(decryptedRam!))).toEqual(Array.from(plainFohBytes));

    wipeAudioArrayBufferInRam(decryptedRam);
    expect(Array.from(new Uint8Array(decryptedRam!)).every((b) => b === 0)).toBe(true);

    // 2. When musician activates Click/Guía (includeCue: true): FOH is NOT re-downloaded, ONLY CUE is fetched once!
    fetchSpy.mockClear();
    const savedWithCue = await ensureSongMp3CachedInDevice({
      song: sampleSong,
      includeCue: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(savedWithCue.hasFoh).toBe(true);
    expect(savedWithCue.hasCue).toBe(true);

    // 3. Subsequent daily plays make ZERO network requests to Supabase
    fetchSpy.mockClear();
    await ensureSongMp3CachedInDevice({ song: sampleSong, includeCue: true });
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    // 4. Kill-Switch (clearAllLocalMp3Vault on signOut / deactivation) wipes keys and encrypted blobs immediately
    await clearAllLocalMp3Vault();
    const afterWipe = await readLocalMp3Blob(sampleSong.id, 'foh');
    expect(afterWipe).toBeNull();
  });

  it('manages 15-day offline lease and catalog persistence without extra Supabase queries', async () => {
    const lease = renewMusicianOfflineLease('musico@tandu.com');
    expect(lease.valid).toBe(true);
    expect(lease.daysRemaining).toBe(15);

    const checked = checkMusicianOfflineLease('musico@tandu.com');
    expect(checked.valid).toBe(true);
    expect(checked.daysRemaining).toBeGreaterThanOrEqual(14);

    // Different user email invalidates previous user's lease
    const wrongUserCheck = checkMusicianOfflineLease('otro@tandu.com');
    expect(wrongUserCheck.valid).toBe(false);

    await saveCachedPracticeCatalog({
      setlists: [{ id: 'sl-1', title: 'Domingo Central' }],
      setlistSongsMap: { 'sl-1': [sampleSong] },
      allLiveSongs: [sampleSong],
      syncedAt: '2026-11-25T16:00:00.000Z',
    });

    const restored = await readCachedPracticeCatalog();
    expect(restored?.setlists[0].title).toBe('Domingo Central');
    expect(formatBytesCompact(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });

  it('evaluates and batch-downloads In-Ear Monitor playlist in MP3 (FOH + CUE) once, with 0 network requests on subsequent sessions', async () => {
    const song2: PracticeSongItem = {
      id: 'song-002',
      title: 'Ruge El León',
      foh_mobile_url: 'https://supa.example.com/audios/foh_mobile_200.mp3',
      cue_mobile_url: 'https://supa.example.com/audios/cue_mobile_200.mp3',
      prompter_data: {
        bpm: 140,
        liveMixMeta: { version: 3, exportedAt: '2026-11-25T15:10:00.000Z', preRollSec: 3.42 },
      },
    };
    const playlist = [sampleSong, song2];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04, 1, 2, 3, 4]).buffer, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });

    // If song-001 only has FOH cached (from /practice without CUE), In-Ear readiness still requires CUE
    await ensureSongMp3CachedInDevice({ song: sampleSong, includeCue: false });
    const summaryBefore = await readLocalVaultSummary();
    const readinessPartial = evaluateInEarPlaylistReadiness(playlist, summaryBefore.tracksBySongId);
    expect(readinessPartial.isFullyCached).toBe(false);
    expect(readinessPartial.readySongs.length).toBe(0);
    expect(readinessPartial.pendingSongs.length).toBe(2);

    // Step 1 Button: Download full playlist for In-Ear Monitor (fetches missing CUE for song-001 + FOH & CUE for song-002 = 3 fetches)
    fetchSpy.mockClear();
    const firstBatch = await downloadInEarPlaylistToLocalVault({ songs: playlist });
    expect(firstBatch.downloadedCount).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const readinessAfter = evaluateInEarPlaylistReadiness(playlist, firstBatch.summary.tracksBySongId);
    expect(readinessAfter.isFullyCached).toBe(true);
    expect(readinessAfter.readySongs.length).toBe(2);
    expect(readinessAfter.pendingSongs.length).toBe(0);

    // Next rehearsal session: 100% served from local vault (0 network requests to Supabase!)
    fetchSpy.mockClear();
    const secondBatch = await downloadInEarPlaylistToLocalVault({
      songs: playlist,
      tracksBySongId: firstBatch.summary.tracksBySongId,
    });
    expect(secondBatch.downloadedCount).toBe(0);
    expect(secondBatch.skippedCachedCount).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    // If a 3rd song is added to the setlist in Studio, ONLY the 3rd song is downloaded (2 fetches: FOH + CUE)
    const song3: PracticeSongItem = {
      id: 'song-003',
      title: 'Nuevo Tema',
      foh_mobile_url: 'https://supa.example.com/audios/foh_mobile_300.mp3',
      cue_mobile_url: 'https://supa.example.com/audios/cue_mobile_300.mp3',
    };
    fetchSpy.mockClear();
    const deltaBatch = await downloadInEarPlaylistToLocalVault({
      songs: [...playlist, song3],
      tracksBySongId: secondBatch.summary.tracksBySongId,
    });
    expect(deltaBatch.downloadedCount).toBe(1);
    expect(deltaBatch.skippedCachedCount).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // "Volver a Descargar" (forceRefresh: true) re-fetches and overwrites the local vault cleanly
    fetchSpy.mockClear();
    await ensureSongMp3CachedInDevice({
      song: song2,
      includeCue: true,
      forceRefresh: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Verify direct IndexedDB metadata lookup (`readLocalTrackMeta`) works without relying on React component state
    const directMeta = await readLocalTrackMeta(song2.id);
    expect(directMeta?.songId).toBe(song2.id);
    expect(directMeta?.hasFoh).toBe(true);
    expect(directMeta?.hasCue).toBe(true);
  });

  it('counts ONLY ready slave presences (eliminating false connected devices) and filters NTP Wi-Fi jitter spikes', () => {
    const mockPresenceState = {
      master: [{ isMaster: true }],
      'slave-unready-1': [{ isMaster: false, ready: false, clientId: 'slave-unready-1' }],
      'slave-legacy': [{ isMaster: false }],
      'slave-ready-a': [
        { isMaster: false, ready: true, clientId: 'slave-ready-a', deviceLabel: 'Batería', songReady: true },
        // Duplicate presence entry on reconnect should not double count
        { isMaster: false, ready: true, clientId: 'slave-ready-a', deviceLabel: 'Batería', songReady: true },
      ],
      'slave-ready-b': [
        { isMaster: false, ready: true, clientId: 'slave-ready-b', deviceLabel: 'Bajo', songReady: false },
      ],
    };

    const presenceSummary = countReadySlavePresences(mockPresenceState);
    expect(presenceSummary.readyCount).toBe(2);
    expect(presenceSummary.totalSlaves).toBe(4);
    expect(presenceSummary.readyClients.map((c) => c.deviceLabel)).toEqual(['Batería', 'Bajo']);

    // NTP multi-sample burst filter: true clock offset is +150ms, with two huge asymmetric Wi-Fi jitter spikes
    const ntpResult = computeFilteredNtpClockOffset([
      { t0: 1000, t1: 1162, t2: 1024 }, // RTT = 24ms, offset = 1162 + 12 - 1024 = +150ms
      { t0: 1120, t1: 1283, t2: 1146 }, // RTT = 26ms, offset = 1283 + 13 - 1146 = +150ms
      { t0: 1240, t1: 1690, t2: 1740 }, // Wi-Fi spike! RTT = 500ms, corrupted offset = +200ms (discarded!)
      { t0: 1360, t1: 1524, t2: 1388 }, // RTT = 28ms, offset = 1524 + 14 - 1388 = +150ms
      { t0: 1480, t1: 2100, t2: 2080 }, // Wi-Fi spike! RTT = 600ms, corrupted offset = +320ms (discarded!)
    ]);
    expect(ntpResult.bestRttMs).toBe(24);
    expect(ntpResult.clockOffsetMs).toBeCloseTo(150, 1);
  });

  it('compensates late PLAY packets so late phones enter in exact rhythmic phase with the Click Guide', () => {
    // Case A: PLAY packet arrives ON TIME (startAtMs is 300ms in the future)
    const onTime = computePhaseLockedSlaveStart({
      startAtMs: 10_300,
      baseOffsetSec: 2.0,
      clientNowMs: 9_900,
      clockOffsetMs: 100, // masterNowMs = 10_000 -> 300ms until start
      audioCtxCurrentTimeSec: 50.0,
      bufferDurationSec: 180.0,
      minScheduleLookaheadSec: 0.025,
    });
    expect(onTime.isLatePacket).toBe(false);
    expect(onTime.lateByMs).toBe(0);
    expect(onTime.whenContextSec).toBeCloseTo(50.3, 4);
    expect(onTime.startOffsetSec).toBeCloseTo(2.0, 4);

    // Case B: PLAY packet arrives 180ms LATE (e.g. Wi-Fi jitter or IndexedDB decode finished after startAtMs)
    // Master started at 10_000 at offset 2.0s; Master is now at 10_180 (audio pos = 2.180s).
    // Slave schedules at ctxNow + 0.025s (when Master will be at 10_205 -> audio pos = 2.205s!).
    const late = computePhaseLockedSlaveStart({
      startAtMs: 10_000,
      baseOffsetSec: 2.0,
      clientNowMs: 10_080,
      clockOffsetMs: 100, // masterNowMs = 10_180 -> 180ms late!
      audioCtxCurrentTimeSec: 50.0,
      bufferDurationSec: 180.0,
      minScheduleLookaheadSec: 0.025,
    });
    expect(late.isLatePacket).toBe(true);
    expect(late.lateByMs).toBe(180);
    expect(late.whenContextSec).toBeCloseTo(50.025, 4);
    expect(late.startOffsetSec).toBeCloseTo(2.205, 4);

    // Case C: Continuity at the lookahead boundary (timeUntilStartMs === 25ms)
    const boundary = computePhaseLockedSlaveStart({
      startAtMs: 10_025,
      baseOffsetSec: 4.0,
      clientNowMs: 9_900,
      clockOffsetMs: 100, // masterNowMs = 10_000 -> 25ms until start
      audioCtxCurrentTimeSec: 10.0,
      minScheduleLookaheadSec: 0.025,
    });
    expect(boundary.whenContextSec).toBeCloseTo(10.025, 4);
    expect(boundary.startOffsetSec).toBeCloseTo(4.0, 4);

    // Case D: Heartbeat drift check ignores tiny <42ms jitter and triggers resync when drifted >42ms
    const tightSync = computeSlaveDriftCorrection({
      masterStartAtMs: 20_000,
      masterBaseOffsetSec: 10.0,
      clientNowMs: 22_900,
      clockOffsetMs: 100, // masterNow = 23_000 -> expectedMasterGlobalSec = 13.0s
      slaveCurrentGlobalSec: 13.012, // +12ms
      driftThresholdSec: 0.042,
    });
    expect(tightSync.needsResync).toBe(false);

    const drifted = computeSlaveDriftCorrection({
      masterStartAtMs: 20_000,
      masterBaseOffsetSec: 10.0,
      clientNowMs: 22_900,
      clockOffsetMs: 100, // expectedMasterGlobalSec = 13.0s
      slaveCurrentGlobalSec: 12.88, // -120ms off the click!
      driftThresholdSec: 0.042,
    });
    expect(drifted.needsResync).toBe(true);
    expect(drifted.driftMs).toBe(-120);
  });

  it('tracks instant RPC connect, instant rpc_slave_bye disconnect, ignores stale Phoenix Presence ghosts, and evicts dropped phones in <=5s', () => {
    const registry = createSlavePeerRegistry();

    // 1. Instant RPC connect (<30ms) from phone announce
    const joinRes = upsertSlavePeerFromRpc(
      registry,
      {
        clientId: 'slave-phone-1',
        ready: true,
        deviceLabel: 'Guitarra In-Ear',
        setlistId: 'sl-1',
        songReady: false,
        rttMs: 22,
        connectedAt: 1000,
      },
      1020
    );
    expect(joinRes.isNewPeer).toBe(true);
    expect(joinRes.clients).toHaveLength(1);
    expect(joinRes.clients[0].deviceLabel).toBe('Guitarra In-Ear');
    expect(joinRes.clients[0].rttMs).toBe(22);

    // 2. Heartbeat updates songReady=true without duplicating peer
    const hbRes = upsertSlavePeerFromRpc(
      registry,
      {
        clientId: 'slave-phone-1',
        ready: true,
        songReady: true,
        rttMs: 16,
        connectedAt: 1000,
      },
      2800
    );
    expect(hbRes.isNewPeer).toBe(false);
    expect(hbRes.clients).toHaveLength(1);
    expect(hbRes.clients[0].songReady).toBe(true);
    expect(hbRes.clients[0].rttMs).toBe(16);

    // 3. Instant graceful disconnect via rpc_slave_bye
    const byeRes = removeSlavePeerFromBye(registry, 'slave-phone-1', 1000, 3100);
    expect(byeRes.removed).toBe(true);
    expect(byeRes.clients).toHaveLength(0);

    // 4. Stale Phoenix Presence still holding old connectedAt=1000 MUST NOT resurrect the departed phone
    const stalePresence = reconcilePresenceWithRegistry(
      registry,
      {
        'slave-phone-1': [
          {
            isMaster: false,
            ready: true,
            clientId: 'slave-phone-1',
            deviceLabel: 'Guitarra In-Ear',
            connectedAt: 1000,
          },
        ],
      },
      3400
    );
    expect(stalePresence.clients).toHaveLength(0);

    // 5. Same phone reconnects with new session (connectedAt=4000) -> immediately online again
    const rejoinRes = upsertSlavePeerFromRpc(
      registry,
      {
        clientId: 'slave-phone-1',
        ready: true,
        deviceLabel: 'Guitarra In-Ear',
        songReady: true,
        rttMs: 19,
        connectedAt: 4000,
      },
      4010
    );
    expect(rejoinRes.isNewPeer).toBe(true);
    expect(rejoinRes.clients).toHaveLength(1);

    // 6. Abrupt Wi-Fi drop: at +2.4s triggers silent RPC probe; at >5s evicts peer automatically
    const probeCheck = pruneStaleSlavePeers(
      registry,
      4010 + SLAVE_PROBE_THRESHOLD_MS,
      SLAVE_HEARTBEAT_TTL_MS,
      SLAVE_PROBE_THRESHOLD_MS
    );
    expect(probeCheck.needsProbe).toBe(true);
    expect(probeCheck.evictedIds).toHaveLength(0);
    expect(probeCheck.clients).toHaveLength(1);

    const evictCheck = pruneStaleSlavePeers(
      registry,
      4010 + SLAVE_HEARTBEAT_TTL_MS + 100,
      SLAVE_HEARTBEAT_TTL_MS,
      SLAVE_PROBE_THRESHOLD_MS
    );
    expect(evictCheck.evictedIds).toEqual(['slave-phone-1']);
    expect(evictCheck.clients).toHaveLength(0);
  });

  it('recovers on mobile when *_mobile_url returns 404 by falling back to *_mix_url WAV and streaming-encoding MP3 with zero AudioContext', async () => {
    // Build a valid 16-bit Stereo 44100 Hz RIFF PCM WAV buffer (2400 frames = ~54ms)
    const sampleRate = 44100;
    const numChannels = 2;
    const numFrames = 2400;
    const dataBytes = numFrames * numChannels * 2;
    const wavBuf = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(wavBuf);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataBytes, true);
    for (let i = 0; i < numFrames; i++) {
      const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 14000);
      view.setInt16(44 + i * 4, sample, true);
      view.setInt16(44 + i * 4 + 2, sample, true);
    }

    // Direct streaming WAV -> MP3 verification (no AudioContext exists in Vitest Node env!)
    const directMp3 = await encodeRiffWavBufferToMp3(wavBuf, 128, false);
    expect(directMp3.byteLength).toBeGreaterThan(200);

    const mobileBrokenSong: PracticeSongItem = {
      id: 'song-mobile-fallback-1',
      title: 'Eres la Esperanza Mobile Test',
      // Simulate broken 404 mobile MP3 URL + valid legacy WAV mix URL
      foh_mobile_url: 'https://supa.example.com/audios/missing_foh_404.mp3',
      foh_mix_url: 'https://supa.example.com/audios/valid_foh_mix.wav',
      // Simulate broken 404 CUE URL with valid BPM so RAM Cue fallback unlocks readiness instead of infinite Pendiente MP3
      cue_mobile_url: 'https://supa.example.com/audios/missing_cue_404.mp3',
      cue_mix_url: null,
      prompter_data: { bpm: 98, timeSignature: '4/4' },
    };

    expect(resolveCandidateAudioSources(mobileBrokenSong, 'foh').map((c) => c.url)).toEqual([
      'https://supa.example.com/audios/missing_foh_404.mp3',
      'https://supa.example.com/audios/valid_foh_mix.wav',
    ]);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('404')) {
        return new Response('{"statusCode":"404","error":"not_found"}', { status: 404 });
      }
      return new Response(wavBuf.slice(0), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      });
    });

    const dlResult = await downloadInEarPlaylistToLocalVault({
      songs: [mobileBrokenSong],
    });

    expect(dlResult.downloadedCount).toBe(1);
    const savedMeta = dlResult.summary.tracksBySongId[mobileBrokenSong.id];
    expect(savedMeta).toBeDefined();
    expect(savedMeta.hasFoh).toBe(true);
    expect(savedMeta.convertedFromWav).toBe(true);
    expect(savedMeta.cueSynthesizedFallback).toBe(true);

    // Readiness MUST be 100% ready (never stuck in Pendiente MP3!)
    const readinessAfter = evaluateInEarPlaylistReadiness(
      [mobileBrokenSong],
      dlResult.summary.tracksBySongId
    );
    expect(readinessAfter.isFullyCached).toBe(true);
    expect(readinessAfter.pendingSongs).toHaveLength(0);
    expect(readinessAfter.readySongs).toHaveLength(1);

    const decryptedMp3 = await readDecryptedTrackArrayBuffer(mobileBrokenSong.id, 'foh');
    expect(decryptedMp3).not.toBeNull();
    expect(decryptedMp3!.byteLength).toBeGreaterThan(200);
  });

  it('compacts multi-phone PLAY payloads by >95% and aligns PC + iPhone + Android acoustic DAC output to 0.000ms', () => {
    const heavySong = {
      id: 'song-sync-pro',
      title: 'Mi Corazón Tuyo Será',
      foh_mobile_url: 'https://supa.example.com/foh.mp3',
      cue_mobile_url: 'https://supa.example.com/cue.mp3',
      prompter_data: {
        bpm: 103,
        timeSignature: '4/4',
        firstBeatOffset: 0.12,
        sectionsUpdatedAt: '2026-11-26T10:00:00Z',
        liveMixMeta: { preRollSec: 2.33, version: 3 },
        sections: [{ id: 's1', name: 'INTRO', time: 0, cueEnabled: true }],
        beatTimes: Array.from({ length: 1200 }, (_, i) => i * 0.58),
        chords: Array.from({ length: 600 }, (_, i) => ({ time: i * 1.16, chord: 'G' })),
        lyrics: Array.from({ length: 200 }, (_, i) => ({ time: i * 2, text: `Línea ${i}` })),
        waveformPeaks: Array.from({ length: 2000 }, () => 0.5),
      },
    };

    const rawBytes = JSON.stringify(heavySong).length;
    const compact = stripHeavySongPayloadForRealtime(heavySong);
    const compactBytes = JSON.stringify(compact).length;

    expect(compactBytes).toBeLessThan(rawBytes * 0.05);
    expect(compact.prompter_data.bpm).toBe(103);
    expect(compact.prompter_data.sections).toHaveLength(1);
    expect(compact.prompter_data.beatTimes).toBeUndefined();
    expect(compact.prompter_data.chords).toBeUndefined();

    // Acoustic phase lock across PC (24ms DAC), iPhone (18ms DAC) and Android (58ms DAC)
    // Master schedules sound to exit PC speakers at Master T = 20_404ms (T_sched 20_380 + 24ms PC DAC)
    const masterAudibleStartAtMs = 20_404;

    // Phone 1 (iPhone, clockOffset = +50ms, clientNow = 19_950 -> masterNow = 20_000, DAC = 18ms)
    const iphoneSched = computePhaseLockedSlaveStart({
      startAtMs: masterAudibleStartAtMs,
      baseOffsetSec: 0,
      clientNowMs: 19_950,
      clockOffsetMs: 50,
      audioCtxCurrentTimeSec: 100.0,
      slaveOutputLatencyMs: 18,
    });
    // iPhone begins WebAudio render at masterNow + 386ms = 20_386ms -> +18ms DAC = 20_404ms audible!
    const iphoneAudibleMasterMs = 20_000 + (iphoneSched.whenContextSec - 100.0) * 1000 + 18;
    expect(iphoneAudibleMasterMs).toBeCloseTo(masterAudibleStartAtMs, 3);

    // Phone 2 (Android, clockOffset = -30ms, clientNow = 20_030 -> masterNow = 20_000, DAC = 58ms)
    const androidSched = computePhaseLockedSlaveStart({
      startAtMs: masterAudibleStartAtMs,
      baseOffsetSec: 0,
      clientNowMs: 20_030,
      clockOffsetMs: -30,
      audioCtxCurrentTimeSec: 200.0,
      slaveOutputLatencyMs: 58,
    });
    // Android begins WebAudio render at masterNow + 346ms = 20_346ms -> +58ms DAC = 20_404ms audible!
    const androidAudibleMasterMs = 20_000 + (androidSched.whenContextSec - 200.0) * 1000 + 58;
    expect(androidAudibleMasterMs).toBeCloseTo(masterAudibleStartAtMs, 3);

    // Verify drift check 3 seconds later (at Master T = 23_404ms -> expected audible pos = 3.000s)
    // Android render cursor is at 3.058s (because it started 58ms early), audible is 3.000s -> 0ms drift!
    const androidDrift = computeSlaveDriftCorrection({
      masterStartAtMs: masterAudibleStartAtMs,
      masterBaseOffsetSec: 0,
      clientNowMs: 23_434,
      clockOffsetMs: -30,
      slaveCurrentGlobalSec: 3.058,
      slaveOutputLatencyMs: 58,
      driftThresholdSec: 0.018,
    });
    expect(androidDrift.driftMs).toBe(0);
    expect(androidDrift.needsResync).toBe(false);

    // Verify Android AudioFlinger unreported outputLatency compensation (+68ms HAL floor)
    const mockAndroidCtx = { baseLatency: 0.012, outputLatency: 0, currentTime: 10 } as any;
    const androidAcousticMs = estimateSlaveAcousticOutputLatencyMs(
      mockAndroidCtx,
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36'
    );
    expect(androidAcousticMs).toBe(80); // 12ms baseLatency + 68ms Android AudioFlinger HAL

    const mockIphoneCtx = { baseLatency: 0.01, outputLatency: undefined, currentTime: 10 } as any;
    const iphoneAcousticMs = estimateSlaveAcousticOutputLatencyMs(
      mockIphoneCtx,
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    );
    expect(iphoneAcousticMs).toBe(28); // 10ms baseLatency + 18ms iOS CoreAudio HAL

    // Verify Phase-Locked Loop (PLL) playbackRate servo pulls lagging/leading phones smoothly without cutting audio
    const laggingPhonePll = computeSlavePllServoAdjustment({
      masterStartAtMs: 10_000,
      masterBaseOffsetSec: 0,
      clientNowMs: 15_000,
      clockOffsetMs: 0, // expectedMasterGlobalSec = 5.000s
      slaveCurrentGlobalSec: 5.035, // With 80ms Android DAC latency, audible is 4.955s (-45ms behind PC)
      slaveOutputLatencyMs: 80,
      deadbandMs: 6,
      hardSeekThresholdMs: 160,
    });
    expect(laggingPhonePll.mode).toBe('pll_rate');
    expect(laggingPhonePll.driftMs).toBe(-45);
    expect(laggingPhonePll.targetPlaybackRate).toBeGreaterThan(1.02);
    expect(laggingPhonePll.targetPlaybackRate).toBeLessThanOrEqual(1.045);

    const lockedPhonePll = computeSlavePllServoAdjustment({
      masterStartAtMs: 10_000,
      masterBaseOffsetSec: 0,
      clientNowMs: 15_000,
      clockOffsetMs: 0,
      slaveCurrentGlobalSec: 5.077, // With 80ms DAC latency, audible is 4.997s (-3ms -> inside 6ms deadband)
      slaveOutputLatencyMs: 80,
      deadbandMs: 6,
      hardSeekThresholdMs: 160,
    });
    expect(lockedPhonePll.mode).toBe('locked');
    expect(lockedPhonePll.targetPlaybackRate).toBe(1.0);
  });
});
