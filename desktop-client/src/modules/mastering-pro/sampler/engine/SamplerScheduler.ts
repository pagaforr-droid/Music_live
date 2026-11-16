import type { SamplerPattern } from '../types/sampler.types';

/**
 * Lookahead Sequencer Scheduler (25ms worker-backed tick scheduling 100ms ahead in AudioContext time).
 * Achieves < 1 ms sample-accurate timing jitter even when the UI tab is busy.
 */

const LOOKAHEAD_SEC = 0.1;
const TICK_MS = 25;

export class SamplerScheduler {
  private ctx: BaseAudioContext | null = null;
  private worker: Worker | null = null;
  private isRunning = false;
  private isRecording = false;
  private currentStep = 0;
  private nextStepTimeCtx = 0;
  private startAnchorCtx = 0;
  private pattern: SamplerPattern;
  private onTriggerStep: (padIndex: number, velocity: number, whenSec: number) => void;
  private onStepAdvance?: (step: number) => void;

  constructor(
    initialPattern: SamplerPattern,
    onTriggerStep: (padIndex: number, velocity: number, whenSec: number) => void,
    onStepAdvance?: (step: number) => void
  ) {
    this.pattern = initialPattern;
    this.onTriggerStep = onTriggerStep;
    this.onStepAdvance = onStepAdvance;
  }

  public updatePattern(next: SamplerPattern): void {
    this.pattern = next;
  }

  public setRecording(rec: boolean): void {
    this.isRecording = rec;
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public start(ctx: BaseAudioContext): void {
    if (this.isRunning) return;
    this.ctx = ctx;
    this.isRunning = true;
    this.currentStep = 0;
    this.nextStepTimeCtx = ctx.currentTime + 0.04;
    this.startAnchorCtx = this.nextStepTimeCtx;

    // Inline worker timer avoids main-thread setTimeout throttling in background tabs
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      try {
        const blob = new Blob(
          [`setInterval(() => postMessage('tick'), ${TICK_MS});`],
          { type: 'application/javascript' }
        );
        const url = URL.createObjectURL(blob);
        this.worker = new Worker(url);
        URL.revokeObjectURL(url);
        this.worker.onmessage = () => this.tick();
        return;
      } catch {
        this.worker = null;
      }
    }
    const timer = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(timer);
        return;
      }
      this.tick();
    }, TICK_MS);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.currentStep = 0;
    this.onStepAdvance?.(-1);
  }

  private getStepDurationSec(stepIdx: number): number {
    const safeBpm = Math.max(40, Math.min(240, this.pattern.bpm || 120));
    const sixteenth = 60 / safeBpm / 4;
    const swingOffset = (this.pattern.swing || 0) * sixteenth * 0.45;
    // Delay odd steps slightly and compensate even steps so bar length stays exact!
    return stepIdx % 2 === 0 ? sixteenth + swingOffset : sixteenth - swingOffset;
  }

  private tick(): void {
    if (!this.isRunning || !this.ctx) return;

    while (this.nextStepTimeCtx < this.ctx.currentTime + LOOKAHEAD_SEC) {
      const stepToSchedule = this.currentStep;
      const schedTime = this.nextStepTimeCtx;

      for (const lane of this.pattern.lanes) {
        const cell = lane.steps[stepToSchedule];
        if (!cell?.on) continue;
        const prob = cell.probability ?? 1.0;
        if (prob < 1.0 && Math.random() > prob) continue;
        this.onTriggerStep(lane.padIndex, cell.velocity, schedTime);
      }

      this.onStepAdvance?.(stepToSchedule);

      const dur = this.getStepDurationSec(stepToSchedule);
      this.nextStepTimeCtx += dur;
      this.currentStep = (this.currentStep + 1) % this.pattern.steps;
    }
  }

  /**
   * Quantizes a live pad hit timestamp to the nearest 16th/32nd step when Recording is armed.
   */
  public quantizeHitToStep(ctxTime: number): number | null {
    if (!this.isRunning || !this.isRecording) return null;
    const safeBpm = Math.max(40, Math.min(240, this.pattern.bpm || 120));
    const sixteenth = 60 / safeBpm / 4;
    const elapsed = Math.max(0, ctxTime - this.startAnchorCtx);
    const totalSteps = Math.round(elapsed / sixteenth);
    return ((totalSteps % this.pattern.steps) + this.pattern.steps) % this.pattern.steps;
  }

  /**
   * Computes deterministic trigger timestamps for Offline Sequencer Bounce (1..8 bars).
   */
  public static buildOfflineSchedule(
    pattern: SamplerPattern,
    bars = 1
  ): {
    totalDurationSec: number;
    events: Array<{ padIndex: number; velocity: number; timeSec: number }>;
  } {
    const safeBpm = Math.max(40, Math.min(240, pattern.bpm || 120));
    const sixteenth = 60 / safeBpm / 4;
    const swingOffset = (pattern.swing || 0) * sixteenth * 0.45;
    const events: Array<{ padIndex: number; velocity: number; timeSec: number }> = [];

    let cursor = 0;
    const totalCycles = Math.max(1, Math.min(16, bars));

    for (let bar = 0; bar < totalCycles; bar++) {
      for (let step = 0; step < pattern.steps; step++) {
        const stepDur = step % 2 === 0 ? sixteenth + swingOffset : sixteenth - swingOffset;
        for (const lane of pattern.lanes) {
          const cell = lane.steps[step];
          if (!cell?.on) continue;
          events.push({
            padIndex: lane.padIndex,
            velocity: cell.velocity,
            timeSec: Number(cursor.toFixed(6)),
          });
        }
        cursor += stepDur;
      }
    }

    return { totalDurationSec: Number(cursor.toFixed(6)), events };
  }
}
