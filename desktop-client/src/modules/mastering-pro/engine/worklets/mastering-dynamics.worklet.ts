import { BusCompressorCore, type BusCompressorParams } from '../../dsp-core/BusCompressorCore';
import { LookaheadLimiterCore, type LookaheadLimiterParams } from '../../dsp-core/LookaheadLimiterCore';

interface WorkletNodeInitOptions<TParams> {
  processorOptions?: {
    initialParams?: TParams;
    initialBypass?: boolean;
  };
}

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}
declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

export interface CompressorWorkletMsg {
  type: 'config';
  params: BusCompressorParams;
  bypass?: boolean;
}

export interface LimiterWorkletMsg {
  type: 'config';
  params: LookaheadLimiterParams;
  bypass?: boolean;
}

class MasteringBusCompressorProcessor extends AudioWorkletProcessor {
  private readonly core: BusCompressorCore;
  private bypass = false;
  private framesSincePost = 0;
  private peakGrDb = 0;

  constructor(options?: WorkletNodeInitOptions<BusCompressorParams>) {
    super(options);
    const init = options?.processorOptions;
    this.core = new BusCompressorCore(sampleRate, init?.initialParams);
    if (init?.initialBypass !== undefined) {
      this.bypass = init.initialBypass;
    }

    this.port.onmessage = (ev: MessageEvent<CompressorWorkletMsg | { type: 'reset' }>) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'reset') {
        this.core.reset();
        this.peakGrDb = 0;
        return;
      }
      if (msg.type === 'config') {
        this.core.updateParams(msg.params);
        if (msg.bypass !== undefined) this.bypass = msg.bypass;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;
    const len = outL.length;

    if (!input || input.length === 0 || !input[0]) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : inL;

    if (this.bypass) {
      outL.set(inL);
      if (outR !== outL) outR.set(inR);
      return true;
    }

    const gr = this.core.processBlock(inL, inR, outL, outR, len);
    if (gr > this.peakGrDb) this.peakGrDb = gr;

    this.framesSincePost += len;
    if (this.framesSincePost >= Math.round(sampleRate / 30)) {
      this.framesSincePost = 0;
      this.port.postMessage({
        type: 'gr',
        grDb: Number(this.peakGrDb.toFixed(2)),
      });
      this.peakGrDb *= 0.65;
    }
    return true;
  }
}

class MasteringLookaheadLimiterProcessor extends AudioWorkletProcessor {
  private readonly core: LookaheadLimiterCore;
  private bypass = false;
  private framesSincePost = 0;
  private peakGrDb = 0;

  constructor(options?: WorkletNodeInitOptions<LookaheadLimiterParams>) {
    super(options);
    const init = options?.processorOptions;
    this.core = new LookaheadLimiterCore(sampleRate, init?.initialParams);
    if (init?.initialBypass !== undefined) {
      this.bypass = init.initialBypass;
    }

    this.port.onmessage = (ev: MessageEvent<LimiterWorkletMsg | { type: 'reset' }>) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'reset') {
        this.core.reset();
        this.peakGrDb = 0;
        return;
      }
      if (msg.type === 'config') {
        this.core.updateParams(msg.params);
        if (msg.bypass !== undefined) this.bypass = msg.bypass;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;
    const len = outL.length;

    if (!input || input.length === 0 || !input[0]) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : inL;

    if (this.bypass) {
      outL.set(inL);
      if (outR !== outL) outR.set(inR);
      return true;
    }

    const gr = this.core.processBlock(inL, inR, outL, outR, len);
    if (gr > this.peakGrDb) this.peakGrDb = gr;

    this.framesSincePost += len;
    if (this.framesSincePost >= Math.round(sampleRate / 30)) {
      this.framesSincePost = 0;
      this.port.postMessage({
        type: 'gr',
        grDb: Number(this.peakGrDb.toFixed(2)),
      });
      this.peakGrDb *= 0.65;
    }
    return true;
  }
}

registerProcessor('mastering-bus-compressor', MasteringBusCompressorProcessor);
registerProcessor('mastering-lookahead-limiter', MasteringLookaheadLimiterProcessor);
