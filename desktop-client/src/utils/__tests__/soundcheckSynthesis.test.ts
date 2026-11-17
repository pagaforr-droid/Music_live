import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAL_MINUS_18_DBFS_AMP, startTestSignalGenerator } from '../soundcheckSynthesis';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function createMockAudioContext() {
  const createdOscs: any[] = [];
  const createdBufSources: any[] = [];
  const createdGains: any[] = [];

  const ctx: any = {
    state: 'running',
    currentTime: 0,
    sampleRate: 48000,
    createGain: () => {
      const g = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      createdGains.push(g);
      return g;
    },
    createOscillator: () => {
      const osc: any = {
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      createdOscs.push(osc);
      return osc;
    },
    createBuffer: (_ch: number, len: number) => ({
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () => {
      const src: any = {
        buffer: null,
        loop: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      createdBufSources.push(src);
      return src;
    },
  };

  return { ctx, createdOscs, createdBufSources, createdGains };
}

describe('soundcheckSynthesis signal generator', () => {
  it('computes exact -18 dBFS linear amplitude (~0.12589) for console 0 VU lineup', () => {
    expect(CAL_MINUS_18_DBFS_AMP).toBeCloseTo(0.1258925, 6);
  });

  it('schedules -18 dBFS 1 kHz sine and stops/disconnects all nodes deterministically', () => {
    vi.stubGlobal('window', globalThis);
    const { ctx, createdOscs, createdGains } = createMockAudioContext();
    const dest = {} as AudioNode;

    const handle = startTestSignalGenerator(ctx, dest, 'cal_minus18', {
      isActive: () => true,
    });

    expect(createdOscs).toHaveLength(1);
    expect(createdOscs[0].frequency.setValueAtTime).toHaveBeenCalledWith(1000, 0);
    expect(createdGains[0].gain.setValueAtTime).toHaveBeenCalledWith(CAL_MINUS_18_DBFS_AMP, 0);

    handle.stop();
    expect(createdOscs[0].stop).toHaveBeenCalled();
    expect(createdOscs[0].disconnect).toHaveBeenCalled();
    expect(createdGains[0].disconnect).toHaveBeenCalled();
  });

  it('schedules channel-ID acoustic pips and clears pending delay/interval on stop()', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    const { ctx, createdOscs, createdGains } = createMockAudioContext();
    const dest = {} as AudioNode;

    const handle = startTestSignalGenerator(ctx, dest, 'tone', {
      channelNumber: 5, // 1 group-of-4 marker + 1 high pip
      includeChannelIdPips: true,
      isActive: () => true,
    });

    expect(createdOscs).toHaveLength(2);
    // Simulate natural end of first pip envelope -> O(1) cleanup of pip gain node
    createdOscs[0].onended?.();
    expect(createdGains[0].disconnect).toHaveBeenCalled();

    // Stopping before delayed tone prevents continuous oscillator spawn
    handle.stop();
    vi.advanceTimersByTime(5000);
    expect(createdOscs).toHaveLength(2);
  });
});
