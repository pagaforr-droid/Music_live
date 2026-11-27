import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRUM_KIT_1400_BY_ROLE,
  DRUM_KIT_1400_CATALOG,
  getDrumKit1400EntriesByFolder,
  getDrumKit1400EntryById,
  getDrumKit1400ForRole,
} from '../engine/DrumKit1400Catalog';

describe('1400 Samples Drum Kit — Default Catalog & Role Routing', () => {
  it('indexes all 1,400 WAV samples across Kicks (500), Snares (500), Hats (350) and Claps (50)', () => {
    expect(DRUM_KIT_1400_CATALOG.length).toBe(1400);
    expect(getDrumKit1400EntriesByFolder('Kicks').length).toBe(500);
    expect(getDrumKit1400EntriesByFolder('Snares').length).toBe(500);
    expect(getDrumKit1400EntriesByFolder('Hats').length).toBe(350);
    expect(getDrumKit1400EntriesByFolder('Claps').length).toBe(50);
  });

  it('prioritizes signature NATURAL studio samples first and provides bundled fallbacks for defaults', () => {
    const defKick = getDrumKit1400EntryById(DEFAULT_DRUM_KIT_1400_BY_ROLE.kick!);
    const defSnare = getDrumKit1400EntryById(DEFAULT_DRUM_KIT_1400_BY_ROLE.snare!);
    const defHat = getDrumKit1400EntryById(DEFAULT_DRUM_KIT_1400_BY_ROLE.hat!);

    expect(defKick).toBeDefined();
    expect(defKick?.fileName).toBe('Kick_NATURAL.wav');
    expect(defKick?.hasBundledFallback).toBe(true);

    expect(defSnare).toBeDefined();
    expect(defSnare?.fileName).toBe('Snare NATURAL.wav');
    expect(defSnare?.hasBundledFallback).toBe(true);

    expect(defHat).toBeDefined();
    expect(defHat?.fileName).toBe('Hat 12.wav');
    expect(defHat?.hasBundledFallback).toBe(true);

    const kicks = getDrumKit1400EntriesByFolder('Kicks');
    expect(kicks[0].fileName).toBe('Kick_NATURAL.wav');
    // Natural numeric sort: Kick 2 comes before Kick 10
    const idx2 = kicks.findIndex((k) => k.fileName === 'Kick 2.wav');
    const idx10 = kicks.findIndex((k) => k.fileName === 'Kick 10.wav');
    expect(idx2).toBeGreaterThan(0);
    expect(idx10).toBeGreaterThan(idx2);
  });

  it('routes Kicks, Snares + Claps, and Hats accurately per drum piece role and supports dynamic new files', () => {
    const snarePack = getDrumKit1400ForRole('snare');
    expect(snarePack.primaryFolder).toBe('Snares');
    expect(snarePack.primaryEntries.length).toBe(500);
    expect(snarePack.secondaryFolder).toBe('Claps');
    expect(snarePack.secondaryEntries?.length).toBe(50);

    const dynKicks = getDrumKit1400EntriesByFolder('Kicks', {
      Kicks: ['Kick_Custom_Nuevo.wav'],
    });
    expect(dynKicks.length).toBe(501);
    expect(dynKicks[0].fileName).toBe('Kick_Custom_Nuevo.wav');
    expect(dynKicks[0].localApiUrl).toContain(encodeURIComponent('Kick_Custom_Nuevo.wav'));
  });
});
