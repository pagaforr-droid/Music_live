import type { SampleVoice } from './SampleVoice';

export class VoicePool {
  private readonly maxVoices: number;
  private voices: SampleVoice[] = [];
  private onCountChange?: (activePadIndices: Set<number>) => void;

  constructor(maxVoices = 32, onCountChange?: (activePads: Set<number>) => void) {
    this.maxVoices = Math.max(4, maxVoices);
    this.onCountChange = onCountChange;
  }

  public setOnCountChange(cb: (activePads: Set<number>) => void): void {
    this.onCountChange = cb;
  }

  /**
   * Enforces choke groups (8ms fade) and voice cap (steals oldest releasing first, 5ms fade).
   */
  public prepareForTrigger(chokeGroup: number | null, whenSec?: number): void {
    if (chokeGroup !== null) {
      for (const v of this.voices) {
        if (v.chokeGroup === chokeGroup) {
          v.forceStopFade(0.008, whenSec);
        }
      }
    }

    if (this.voices.length >= this.maxVoices) {
      // Steal oldest releasing voice first; otherwise oldest active voice
      const releasing = this.voices
        .filter((v) => v.isReleasing)
        .sort((a, b) => a.startedAtCtx - b.startedAtCtx);
      const victim =
        releasing[0] ??
        [...this.voices].sort((a, b) => a.startedAtCtx - b.startedAtCtx)[0];
      if (victim) {
        victim.forceStopFade(0.005, whenSec);
        this.voices = this.voices.filter((v) => v.id !== victim.id);
      }
    }
  }

  public add(voice: SampleVoice): void {
    this.voices.push(voice);
    this.emitActive();
  }

  public remove(voiceId: number): void {
    this.voices = this.voices.filter((v) => v.id !== voiceId);
    this.emitActive();
  }

  public releasePad(padIndex: number, whenSec?: number): void {
    for (const v of this.voices) {
      if (v.padIndex === padIndex) {
        v.release(whenSec);
      }
    }
  }

  public stopAll(fadeSec = 0.01): void {
    for (const v of this.voices) {
      v.forceStopFade(fadeSec);
    }
    this.voices = [];
    this.emitActive();
  }

  public getActiveCount(): number {
    return this.voices.length;
  }

  public getActivePadSet(): Set<number> {
    const s = new Set<number>();
    for (const v of this.voices) s.add(v.padIndex);
    return s;
  }

  private emitActive(): void {
    this.onCountChange?.(this.getActivePadSet());
  }
}
