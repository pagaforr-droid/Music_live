import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
        }),
        order: async () => ({ data: [], error: null }),
      }),
    }),
  },
}));

import {
  type PracticeSongItem,
  computeSongChannelSignature,
  ensureSongMp3CachedInDevice,
  evaluateSongVaultState,
  formatBytesCompact,
  readLocalMp3Blob,
  readLocalVaultSummary,
  removeSongFromLocalVault,
  resetMusicianVaultMemoryForTests,
  resolvePreferredMp3Source,
  saveCachedPracticeCatalog,
  readCachedPracticeCatalog,
} from '../musicianLocalAudioVault';

describe('Musician Local MP3 Audio Vault (Zero Repeated Supabase Egress)', () => {
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

  it('prioritizes lightweight foh_mobile_url and cue_mobile_url MP3 over heavy WAV mixes', () => {
    const foh = resolvePreferredMp3Source(sampleSong, 'foh');
    const cue = resolvePreferredMp3Source(sampleSong, 'cue');
    expect(foh.url).toBe('https://supa.example.com/audios/foh_mobile_100.mp3');
    expect(foh.isLikelyWav).toBe(false);
    expect(cue.url).toBe('https://supa.example.com/audios/cue_mobile_100.mp3');
    expect(cue.isLikelyWav).toBe(false);

    const legacySong: PracticeSongItem = {
      id: 'song-legacy',
      title: 'Canción Antigua',
      foh_mix_url: 'https://supa.example.com/audios/foh_old.wav',
      foh_mobile_url: null,
    };
    const legacyFoh = resolvePreferredMp3Source(legacySong, 'foh');
    expect(legacyFoh.url).toBe('https://supa.example.com/audios/foh_old.wav');
    expect(legacyFoh.isLikelyWav).toBe(true);
  });

  it('downloads MP3 once, stores in local vault, and performs ZERO network fetches on daily replays', async () => {
    const fakeFohMp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 1, 2, 3, 4, 5, 6]).buffer;
    const fakeCueMp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 9, 8, 7, 6]).buffer;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      const body = url.includes('cue_mobile') ? fakeCueMp3 : fakeFohMp3;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });

    // Initially cloud_only
    const initialSummary = await readLocalVaultSummary();
    expect(evaluateSongVaultState(sampleSong, initialSummary.tracksBySongId[sampleSong.id]).status).toBe(
      'cloud_only'
    );

    // 1st Save: fetches FOH MP3 + CUE MP3 once
    const savedMeta = await ensureSongMp3CachedInDevice({
      song: sampleSong,
      includeCue: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(savedMeta.hasFoh).toBe(true);
    expect(savedMeta.hasCue).toBe(true);
    expect(savedMeta.totalBytes).toBe(fakeFohMp3.byteLength + fakeCueMp3.byteLength);

    // Read local blobs
    const localFohBlob = await readLocalMp3Blob(sampleSong.id, 'foh');
    const localCueBlob = await readLocalMp3Blob(sampleSong.id, 'cue');
    expect(localFohBlob?.size).toBe(fakeFohMp3.byteLength);
    expect(localCueBlob?.size).toBe(fakeCueMp3.byteLength);

    // Evaluate state -> offline_ready
    const afterSummary = await readLocalVaultSummary();
    const evalReady = evaluateSongVaultState(sampleSong, afterSummary.tracksBySongId[sampleSong.id]);
    expect(evalReady.status).toBe('offline_ready');
    expect(evalReady.hasLocalCue).toBe(true);

    // 2nd, 3rd daily listens -> ZERO new network requests to Supabase!
    fetchSpy.mockClear();
    await ensureSongMp3CachedInDevice({ song: sampleSong, includeCue: true });
    await ensureSongMp3CachedInDevice({ song: sampleSong, includeCue: true });
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    // Lyrics/chords edit does NOT invalidate audio signature if mix URL & exportedAt did not change
    const lyricsEditedSong: PracticeSongItem = {
      ...sampleSong,
      prompter_data: {
        ...sampleSong.prompter_data,
        lyrics: [{ time: 5, text: 'Nueva línea de letra' }],
      },
    };
    expect(computeSongChannelSignature(lyricsEditedSong, 'foh')).toBe(
      computeSongChannelSignature(sampleSong, 'foh')
    );
    expect(
      evaluateSongVaultState(lyricsEditedSong, afterSummary.tracksBySongId[sampleSong.id]).status
    ).toBe('offline_ready');

    // Admin re-exports mix in Studio Prompter -> marks 'update_available' while preserving offline copy
    const reExportedSong: PracticeSongItem = {
      ...sampleSong,
      foh_mobile_url: 'https://supa.example.com/audios/foh_mobile_200.mp3',
      prompter_data: {
        ...sampleSong.prompter_data,
        liveMixMeta: {
          version: 3,
          exportedAt: '2026-11-26T10:00:00.000Z',
          preRollSec: 3.75,
        },
      },
    };
    const evalUpdated = evaluateSongVaultState(
      reExportedSong,
      afterSummary.tracksBySongId[sampleSong.id]
    );
    expect(evalUpdated.status).toBe('update_available');
    expect(evalUpdated.hasLocalFoh).toBe(true);

    // Removing song frees local storage cleanly
    await removeSongFromLocalVault(sampleSong.id);
    const clearedBlob = await readLocalMp3Blob(sampleSong.id, 'foh');
    expect(clearedBlob).toBeNull();
  });

  it('persists and restores the Live Concert setlist catalog for offline startup', async () => {
    await saveCachedPracticeCatalog({
      setlists: [{ id: 'sl-1', title: 'Domingo Central' }],
      setlistSongsMap: { 'sl-1': [sampleSong] },
      allLiveSongs: [sampleSong],
      syncedAt: '2026-11-25T16:00:00.000Z',
    });

    const restored = await readCachedPracticeCatalog();
    expect(restored?.setlists[0].title).toBe('Domingo Central');
    expect(restored?.setlistSongsMap['sl-1'][0].title).toBe('Fuego En El Altar');
    expect(formatBytesCompact(4.5 * 1024 * 1024)).toBe('4.5 MB');
  });
});
