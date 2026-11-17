import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUE_ROUTING_OPTIONS,
  DEFAULT_MULTICHANNEL_PATCH,
  HardwareProbeReport,
  MultiChannelPatchConfig,
  StageStemInput,
  VenueRigProfile,
  analyzeStagePatch,
  computeCueBalanceGains,
  computeEqAutoHeadroomGain,
  computeRequiredMergerChannels,
  detectOutOfRangeAssignments,
  detectStemRuleKey,
  detectWdmPairGroups,
  extractTrailingParenGroup,
  findMatchingVenueProfile,
  isBluetoothAudioLabel,
  isDeviceBluetoothSuspect,
  normalizeMultiChannelPatch,
  notifyStageIoUpdated,
  parseImportedVenueProfilesJson,
  probeAudioHardware,
  resolveConsoleTarget,
  resolveCueIndices,
  resolveStemConsoleTarget,
  serializeVenueProfilesJson,
  subscribeStageIoUpdates,
} from '../liveConsoleDSP';

function makePatch(overrides: Partial<MultiChannelPatchConfig> = {}): MultiChannelPatchConfig {
  return normalizeMultiChannelPatch({
    ...DEFAULT_MULTICHANNEL_PATCH,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Channel target & CUE index resolution', () => {
  it('maps stereo pairs and mono channels to 0-based merger indices safely', () => {
    expect(resolveConsoleTarget('1-2', 8)).toEqual({
      leftIdx: 0,
      rightIdx: 1,
      isMono: false,
      requiredChannels: 2,
    });
    expect(resolveConsoleTarget('7-8', 8)).toEqual({
      leftIdx: 6,
      rightIdx: 7,
      isMono: false,
      requiredChannels: 8,
    });
    expect(resolveConsoleTarget('ch-5', 8)).toEqual({
      leftIdx: 4,
      rightIdx: 4,
      isMono: true,
      requiredChannels: 5,
    });
    // Clamps out-of-range targets safely without producing negative or NaN indices
    expect(resolveConsoleTarget('15-16', 4)).toEqual({
      leftIdx: 2,
      rightIdx: 3,
      isMono: false,
      requiredChannels: 4,
    });
  });

  it('resolves all CUE_ROUTING_OPTIONS including extended mono outputs 5..14', () => {
    for (const opt of CUE_ROUTING_OPTIONS) {
      const resolved = resolveCueIndices(opt.value, 16);
      expect(resolved.leftIdx).toBeGreaterThanOrEqual(0);
      expect(resolved.rightIdx).toBeLessThan(16);
      expect(resolved.requiredChannels).toBe(opt.minChannels);
    }
    expect(resolveCueIndices('5-mono', 8)).toEqual({
      leftIdx: 4,
      rightIdx: 4,
      isMono: true,
      requiredChannels: 5,
    });
    expect(resolveCueIndices('14-mono', 16)).toEqual({
      leftIdx: 13,
      rightIdx: 13,
      isMono: true,
      requiredChannels: 14,
    });
  });
});

describe('Declarative multi-repertoire stem rules & precedence', () => {
  it('detects normalized role keys regardless of Spanish/English naming or accents', () => {
    expect(detectStemRuleKey('Bombo Electrónico')).toBe('kick');
    expect(detectStemRuleKey('Kick In')).toBe('kick');
    expect(detectStemRuleKey('Caja Redoblante')).toBe('snare');
    expect(detectStemRuleKey('Bajo 5 Cuerdas', 'bass')).toBe('bass');
    expect(detectStemRuleKey('Piano Acústico', 'piano')).toBe('piano');
    expect(detectStemRuleKey('Guit. Eléctrica Lead', 'electric_guitar')).toBe('electric_guitar');
    expect(detectStemRuleKey('Coros Soprano', 'vocals')).toBe('vocals');
  });

  it('applies exact precedence: stemOverrides > stemRoleRules > stemGroupTargets', () => {
    const patch = makePatch({
      consoleBusMode: 'multitrack_stems',
      stemGroupTargets: {
        ...DEFAULT_MULTICHANNEL_PATCH.stemGroupTargets,
        drums_perc: '1-2',
      },
      stemRoleRules: {
        kick: 'ch-1',
        snare: 'ch-2',
      },
      stemOverrides: {
        'stem-kick-uuid': 'ch-8',
      },
    });

    expect(
      resolveStemConsoleTarget(
        { id: 'stem-kick-uuid', name: 'Kick', group: 'drums_perc' },
        patch
      )
    ).toEqual({ target: 'ch-8', source: 'stem_override' });

    expect(
      resolveStemConsoleTarget(
        { id: 'another-song-kick', name: 'Bombo', group: 'drums_perc' },
        patch
      )
    ).toEqual({ target: 'ch-1', source: 'role_rule' });

    expect(
      resolveStemConsoleTarget(
        { id: 'other-perc', name: 'Main Mixer', group: 'drums_perc' },
        patch
      )
    ).toEqual({ target: '1-2', source: 'group' });
  });
});

describe('CUE Click/Guide balance gains & EQ headroom', () => {
  it('keeps 1.0/1.0 passthrough at center and attenuates opposite channel off-center', () => {
    expect(computeCueBalanceGains(0)).toEqual({ leftGain: 1, rightGain: 1 });
    expect(computeCueBalanceGains(-0.6)).toEqual({ leftGain: 1, rightGain: 0.4 });
    expect(computeCueBalanceGains(0.75)).toEqual({ leftGain: 0.25, rightGain: 1 });
    expect(computeCueBalanceGains(-10)).toEqual({ leftGain: 1, rightGain: 0 });
  });

  it('reduces headroom trim proportionally when positive boosts exceed 1.5 dB', () => {
    const flat = new Array(18).fill(0);
    expect(computeEqAutoHeadroomGain(flat, true)).toBe(1);
    const boosted = new Array(18).fill(6);
    expect(computeEqAutoHeadroomGain(boosted, true)).toBeLessThan(0.75);
    expect(computeEqAutoHeadroomGain(boosted, false)).toBe(1);
  });
});

describe('Unified analyzeStagePatch & anti-leak guardrails', () => {
  it('enforces StereoSplit fallback whenever hardware has fewer than 4 channels', () => {
    const patch = makePatch({ consoleBusMode: 'multitrack_stems' });
    const res = analyzeStagePatch('MultiChannel', patch, 2, []);
    expect(res.isFallbackSplit).toBe(true);
    expect(res.effectiveRoutingMode).toBe('StereoSplit');
    expect(res.channelAssignments[0].roles[0]).toEqual({ label: 'MÚSICOS (Click/Guía)', kind: 'cue' });
    expect(res.channelAssignments[1].roles[0]).toEqual({ label: 'PÚBLICO (FOH Mono)', kind: 'foh' });
    expect(res.preflightLevel).toBe('warning');
  });

  it('avoids false conflicts/out-of-range warnings when a stem group has no stems or all overridden', () => {
    const patch = makePatch({
      consoleBusMode: 'multitrack_stems',
      cueRouting: '5-6',
      stemGroupTargets: {
        drums_perc: '1-2',
        bass: 'ch-3',
        keys_synth: 'ch-4',
        guitars: 'ch-5', // would collide with 5-6 ONLY if guitars actually route there
        vocals_other: '15-16', // empty group in this song; must NOT trigger 8ch out-of-range
      },
      stemOverrides: {
        'gtr-1': 'ch-4',
      },
    });
    const stems: StageStemInput[] = [
      { id: 'drm-1', name: 'Drums', group: 'drums_perc' },
      { id: 'bs-1', name: 'Bass', group: 'bass' },
      { id: 'gtr-1', name: 'Guitar', group: 'guitars' },
    ];

    const res = analyzeStagePatch('MultiChannel', patch, 8, stems);
    expect(res.cueFohConflicts).toEqual([]);
    expect(res.outOfRangeIssues).toEqual([]);
    expect(res.preflightLevel).toBe('ready');
    expect(computeRequiredMergerChannels(patch, 8, stems)).toBe(6);
  });

  it('flags critical CUE <-> FOH collisions and disconnected interfaces', () => {
    const patch = makePatch({
      consoleBusMode: 'multitrack_stems',
      cueRouting: '3-4',
      stemGroupTargets: {
        ...DEFAULT_MULTICHANNEL_PATCH.stemGroupTargets,
        bass: 'ch-3',
      },
    });
    const stems: StageStemInput[] = [{ id: 'bs-1', name: 'Bass', group: 'bass' }];

    const res = analyzeStagePatch('MultiChannel', patch, 8, stems);
    expect(res.cueFohConflicts).toHaveLength(1);
    expect(res.cueFohConflicts[0].chNum).toBe(3);
    expect(res.preflightLevel).toBe('critical');

    const cleanPatch = makePatch({ cueRouting: '7-8', fohPair: '1-2' });
    const sinkErr = analyzeStagePatch('MultiChannel', cleanPatch, 8, [], {
      sinkMissingOrRejected: true,
    });
    expect(sinkErr.preflightLevel).toBe('critical');

    expect(detectOutOfRangeAssignments('MultiChannel', makePatch({ cueRouting: '7-8' }), 4, [])).toHaveLength(1);
  });
});

describe('Hardware probing heuristics (WDM nested parens, USB headsets, failed setSinkId)', () => {
  it('extracts balanced trailing parenthetical hardware names cleanly', () => {
    expect(extractTrailingParenGroup('Altavoces (Realtek(R) Audio)')).toBe('Realtek(R) Audio');
    expect(extractTrailingParenGroup('Out 1-2 (Behringer UMC (USB Audio))')).toBe('Behringer UMC (USB Audio)');
    expect(extractTrailingParenGroup('Built-in Output')).toBeNull();
  });

  it('detects genuine split WDM pairs while ignoring unrelated HDMI endpoints', () => {
    const wdm = detectWdmPairGroups([
      { label: 'Line 1-2 (Behringer UMC (USB))', groupId: 'g1' },
      { label: 'Line 3-4 (Behringer UMC (USB))', groupId: 'g1' },
      { label: 'HDMI Output (NVIDIA High Definition Audio)', groupId: 'g2' },
      { label: 'DisplayPort (NVIDIA High Definition Audio)', groupId: 'g2' },
    ]);
    expect(wdm).toEqual(['Behringer UMC (USB)']);
  });

  it('distinguishes wired USB headsets from Bluetooth audio and respects manual overrides', () => {
    expect(isBluetoothAudioLabel('Headset Earphone (Logitech USB Headset)')).toBe(false);
    expect(isBluetoothAudioLabel('AirPods Pro Hands-Free AG Audio')).toBe(true);
    expect(isBluetoothAudioLabel('WH-1000XM5 Stereo')).toBe(true);
    expect(isDeviceBluetoothSuspect('Sony WH-1000XM4', 25, ['Sony WH-1000XM4'])).toBe(false);
    expect(isDeviceBluetoothSuspect('Unknown Dongle', 130)).toBe(true);
  });

  it('does not leak maxChannelCount across devices when setSinkId fails during probeAudioHardware', async () => {
    class MockAudioContext {
      state: AudioContextState = 'running';
      sampleRate = 48000;
      baseLatency = 0.01;
      outputLatency = 0.005;
      destination = { maxChannelCount: 2 };
      async resume() {}
      async close() { this.state = 'closed'; }
      async setSinkId(id: string) {
        if (id === 'xr18') {
          this.destination.maxChannelCount = 18;
          return;
        }
        if (id === 'broken') {
          throw new Error('NotFoundError');
        }
        this.destination.maxChannelCount = 2;
      }
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('window', { AudioContext: MockAudioContext });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: 'audiooutput', deviceId: 'xr18', label: 'X-AIR XR18 Multi', groupId: 'x1' },
          { kind: 'audiooutput', deviceId: 'broken', label: 'Speakers (USB Audio)', groupId: 'b1' },
        ],
      },
    });

    const report = await probeAudioHardware({ unlockLabels: false });
    expect(report.bestMaxChannels).toBe(18);
    expect(report.rigTier).toBe('multichannel_pro');
    expect(report.devices[0].maxChannels).toBe(18);
    expect(report.devices[1].maxChannels).toBe(2);
  });
});

describe('Venue profiles import/export, matching & sync origin filtering', () => {
  it('serializes, validates and round-trips venue rig profiles cleanly', () => {
    const sample: VenueRigProfile = {
      id: 'rig_1',
      name: 'Auditorio Principal XR18',
      deviceLabel: 'X-AIR XR18',
      sinkId: 'xr18',
      routingMode: 'MultiChannel',
      patch: makePatch({ consoleBusMode: 'multitrack_stems', cueRouting: '7-8', syncOffsetMs: 15 }),
      eqPresetId: 'foh_concert_punch',
      updatedAt: '2026-11-17T10:00:00.000Z',
    };
    const raw = serializeVenueProfilesJson([sample]);
    const parsed = parseImportedVenueProfilesJson(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Auditorio Principal XR18');
    expect(parsed[0].patch.cueRouting).toBe('7-8');
    expect(parsed[0].patch.syncOffsetMs).toBe(15);

    expect(() => parseImportedVenueProfilesJson('{"profiles":[]}')).toThrow();
  });

  it('matches venue profile by exact label or unique normalized parenthetical alias', () => {
    const report: HardwareProbeReport = {
      scannedAt: '2026-11-17T10:00:00.000Z',
      platformSummary: 'Windows',
      supportsSetSinkId: true,
      labelsHidden: false,
      bestMaxChannels: 8,
      rigTier: 'multichannel_pro',
      wdmPairGroups: [],
      audioContextState: 'running',
      devices: [
        {
          deviceId: 'dev_focus',
          label: 'Out 1-8 (Focusrite Scarlett 18i20)',
          groupId: 'f1',
          isDefault: false,
          maxChannels: 8,
          sampleRate: 48000,
          latencyMs: 8,
          supportsSinkSwitch: true,
          isBluetoothSuspect: false,
        },
      ],
    };
    const profile: VenueRigProfile = {
      id: 'rig_focus',
      name: 'Tour Focusrite',
      deviceLabel: 'Focusrite Scarlett 18i20',
      sinkId: 'old_id',
      routingMode: 'MultiChannel',
      patch: makePatch({ sinkLabel: 'Focusrite Scarlett 18i20' }),
      updatedAt: '2026-11-17T10:00:00.000Z',
    };

    const match = findMatchingVenueProfile(report, [profile], makePatch(), 'StereoInEar');
    expect(match?.profile.id).toBe('rig_focus');
    expect(match?.device.deviceId).toBe('dev_focus');
  });

  it('filters self-origin updates in subscribeStageIoUpdates while relaying external updates', () => {
    const listeners = new Map<string, Set<(ev: any) => void>>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (ev: any) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (ev: any) => void) => {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent: (ev: any) => {
        listeners.get(ev.type)?.forEach((fn) => fn(ev));
        return true;
      },
    });
    vi.stubGlobal('CustomEvent', class {
      type: string;
      detail: any;
      constructor(type: string, init: { detail: any }) {
        this.type = type;
        this.detail = init.detail;
      }
    });

    const received: string[] = [];
    const unsub = subscribeStageIoUpdates((src) => received.push(src), { ignoreSource: 'soundcheck' });

    notifyStageIoUpdated('soundcheck');
    notifyStageIoUpdated('live_concert');

    expect(received).toEqual(['live_concert']);
    unsub();
  });
});
