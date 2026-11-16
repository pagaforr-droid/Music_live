import { StreamingLoudnessMeter } from '../../dsp-core/KWeightingLufs';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}
declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

/**
 * Real-time ITU-R BS.1770-4 K-Weighted Loudness + 4x True Peak + Phase Correlation Meter.
 * Passes audio through bit-transparently while emitting accurate telemetry to the UI.
 */
class MeteringProcessor extends AudioWorkletProcessor {
  private readonly meter: StreamingLoudnessMeter;
  private framesSincePost = 0;

  constructor() {
    super();
    this.meter = new StreamingLoudnessMeter(sampleRate);
    this.port.onmessage = (ev: MessageEvent<{ type: 'reset' }>) => {
      if (ev.data?.type === 'reset') {
        this.meter.reset();
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;

    if (!input || input.length === 0 || !input[0]) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : inL;

    // Bit-transparent passthrough
    outL.set(inL);
    if (outR !== outL) outR.set(inR);

    this.meter.processBlock(inL, inR);
    this.framesSincePost += outL.length;

    if (this.framesSincePost >= Math.round(sampleRate / 20)) {
      this.framesSincePost = 0;
      this.port.postMessage({
        type: 'meter',
        snapshot: this.meter.getSnapshot(),
      });
    }

    return true;
  }
}

registerProcessor('mastering-metering-processor', MeteringProcessor);
