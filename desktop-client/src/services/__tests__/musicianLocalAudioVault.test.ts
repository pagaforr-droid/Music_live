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
  ensureSongMp3CachedInDevice,
  evaluateInEarPlaylistReadiness,
  formatBytesCompact,
  inspectRawEncryptedVaultBuffer,
  readCachedPracticeCatalog,
  readDecryptedTrackArrayBuffer,
  readLocalMp3Blob,
  readLocalVaultSummary,
  renewMusicianOfflineLease,
  resetMusicianVaultMemoryForTests,
  resolvePreferredMp3Source,
  saveCachedPracticeCatalog,
  wipeAudioArrayBufferInRam,
} from '../musicianLocalAudioVault';
import {
  computeFilteredNtpClockOffset,
  computePhaseLockedSlaveStart,
  computeSlaveDriftCorrection,
  countReadySlavePresences,
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
});
