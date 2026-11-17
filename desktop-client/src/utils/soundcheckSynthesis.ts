export type TestSignalType = 'tone' | 'click' | 'pink' | 'sweep' | 'cal_minus18';

export interface SignalGeneratorOptions {
  /** 1-based channel number used when announcing acoustic ID pips in Walk-Test */
  channelNumber?: number;
  /** Emits coded channel-ID pips inside the discrete bus before the continuous signal */
  includeChannelIdPips?: boolean;
  /** Guard evaluated before scheduling repeating intervals */
  isActive: () => boolean;
}

export interface SignalGeneratorHandle {
  stop: () => void;
}

/**
 * -18 dBFS exact amplitude (standard digital reference corresponding to 0 VU / +4 dBu on mixing consoles)
 */
export const CAL_MINUS_18_DBFS_AMP = Math.pow(10, -18 / 20);

function scheduleChannelIdPips(
  ctx: AudioContext,
  destNode: AudioNode,
  channelNumber: number,
  trackSource: (node: AudioScheduledSourceNode, associatedNode?: AudioNode) => void
): number {
  const safeCh = Math.max(1, Math.min(16, channelNumber));
  const groupsOfFour = Math.floor((safeCh - 1) / 4);
  const remainderPips = ((safeCh - 1) % 4) + 1;

  let cursor = ctx.currentTime + 0.02;

  for (let g = 0; g < groupsOfFour; g++) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, cursor);
    env.gain.setValueAtTime(0.0001, cursor);
    env.gain.linearRampToValueAtTime(0.42, cursor + 0.01);
    env.gain.setValueAtTime(0.42, cursor + 0.14);
    env.gain.exponentialRampToValueAtTime(0.0001, cursor + 0.17);
    osc.connect(env);
    env.connect(destNode);
    trackSource(osc, env);
    osc.start(cursor);
    osc.stop(cursor + 0.18);
    cursor += 0.24;
  }

  for (let p = 0; p < remainderPips; p++) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1760, cursor);
    env.gain.setValueAtTime(0.0001, cursor);
    env.gain.linearRampToValueAtTime(0.45, cursor + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, cursor + 0.09);
    osc.connect(env);
    env.connect(destNode);
    trackSource(osc, env);
    osc.start(cursor);
    osc.stop(cursor + 0.1);
    cursor += 0.16;
  }

  return Math.max(0, cursor - ctx.currentTime + 0.08);
}

/**
 * Generador WebAudio quirúrgico con limpieza determinista O(1) de todos los nodos programados.
 */
export function startTestSignalGenerator(
  ctx: AudioContext,
  destNode: AudioNode,
  signalType: TestSignalType,
  options: SignalGeneratorOptions
): SignalGeneratorHandle {
  const liveSources = new Set<AudioScheduledSourceNode>();
  const extraNodes = new Set<AudioNode>();
  let intervalId: number | null = null;
  let delayTimerId: number | null = null;
  let stopped = false;

  const trackSource = (node: AudioScheduledSourceNode, associatedNode?: AudioNode) => {
    liveSources.add(node);
    if (associatedNode) extraNodes.add(associatedNode);
    node.onended = () => {
      liveSources.delete(node);
      try { node.disconnect(); } catch {}
      if (associatedNode) {
        extraNodes.delete(associatedNode);
        try { associatedNode.disconnect(); } catch {}
      }
    };
  };

  const startOffsetSec =
    options.includeChannelIdPips && options.channelNumber
      ? scheduleChannelIdPips(ctx, destNode, options.channelNumber, trackSource)
      : 0;

  const beginContinuousSignal = () => {
    if (stopped || !options.isActive() || ctx.state !== 'running') return;

    if (signalType === 'cal_minus18') {
      const osc = ctx.createOscillator();
      const calGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      calGain.gain.setValueAtTime(CAL_MINUS_18_DBFS_AMP, ctx.currentTime);
      osc.connect(calGain);
      calGain.connect(destNode);
      extraNodes.add(calGain);
      trackSource(osc);
      osc.start();
      return;
    }

    if (signalType === 'pink') {
      const len = ctx.sampleRate * 2;
      const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
        b6 = white * 0.115926;
      }
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.connect(destNode);
      trackSource(src);
      src.start();
      return;
    }

    if (signalType === 'sweep') {
      const fireSweep = () => {
        if (stopped || !options.isActive() || ctx.state !== 'running') return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(40, now);
        osc.frequency.exponentialRampToValueAtTime(10000, now + 5.2);

        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.32, now + 0.15);
        env.gain.setValueAtTime(0.32, now + 5.0);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 5.35);

        osc.connect(env);
        env.connect(destNode);
        trackSource(osc, env);
        osc.start(now);
        osc.stop(now + 5.4);
      };
      fireSweep();
      intervalId = window.setInterval(fireSweep, 5700);
      return;
    }

    let beatStep = 0;
    const firePulse = () => {
      if (stopped || !options.isActive() || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      if (signalType === 'click') {
        const isDownbeat = beatStep % 4 === 0;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isDownbeat ? 1200 : 800, now);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.exponentialRampToValueAtTime(isDownbeat ? 0.65 : 0.42, now + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
        osc.connect(env);
        env.connect(destNode);
        trackSource(osc, env);
        osc.start(now);
        osc.stop(now + 0.075);
        beatStep++;
      } else {
        const freqs = [440, 554.37, 659.25, 554.37];
        const f = freqs[beatStep % freqs.length];
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now);
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.45, now + 0.025);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
        osc.connect(env);
        env.connect(destNode);
        trackSource(osc, env);
        osc.start(now);
        osc.stop(now + 0.48);
        beatStep++;
      }
    };

    firePulse();
    intervalId = window.setInterval(firePulse, signalType === 'click' ? 500 : 650);
  };

  if (startOffsetSec > 0.03) {
    delayTimerId = window.setTimeout(beginContinuousSignal, Math.round(startOffsetSec * 1000));
  } else {
    beginContinuousSignal();
  }

  return {
    stop: () => {
      stopped = true;
      if (delayTimerId !== null) {
        window.clearTimeout(delayTimerId);
        delayTimerId = null;
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      liveSources.forEach((src) => {
        try { src.stop(); } catch {}
        try { src.disconnect(); } catch {}
      });
      liveSources.clear();
      extraNodes.forEach((n) => {
        try { n.disconnect(); } catch {}
      });
      extraNodes.clear();
    },
  };
}
