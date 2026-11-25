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
  ensureSongMp3CachedInDevice,
  formatBytesCompact,
  inspectRawEncryptedVaultBuffer,
  readCachedPracticeCatalog,
  readDecryptedTrackArrayBuffer,
  readLocalMp3Blob,
  renewMusicianOfflineLease,
  resetMusicianVaultMemoryForTests,
  resolvePreferredMp3Source,
  saveCachedPracticeCatalog,
  wipeAudioArrayBufferInRam,
} from '../musicianLocalAudioVault';

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
});
