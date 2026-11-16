/**
 * Lightweight in-memory bridge allowing seamless 1-click audio handoff
 * between Studio Mastering Pro (/mastering) and Sample Lab (/sample-lab).
 */

export interface HandoffAudioPayload {
  buffer: AudioBuffer;
  title: string;
  songId?: string;
  origin: 'mastering-buffer' | 'sampler-bounce';
  createdAtMs: number;
}

export interface HandoffDrumSamplePayload {
  type: 'kick' | 'snare';
  buffer: AudioBuffer;
  name: string;
}

let pendingForSampleLab: HandoffAudioPayload | null = null;
let pendingForMastering: HandoffAudioPayload | null = null;
let pendingDrumKick: HandoffDrumSamplePayload | null = null;
let pendingDrumSnare: HandoffDrumSamplePayload | null = null;

export const SampleLabHandoff = {
  sendAudioToSampleLab(payload: Omit<HandoffAudioPayload, 'createdAtMs'>): void {
    pendingForSampleLab = { ...payload, createdAtMs: Date.now() };
  },

  peekAudioForSampleLab(): HandoffAudioPayload | null {
    return pendingForSampleLab;
  },

  consumeAudioForSampleLab(): HandoffAudioPayload | null {
    const val = pendingForSampleLab;
    pendingForSampleLab = null;
    return val;
  },

  sendBounceToMastering(payload: Omit<HandoffAudioPayload, 'createdAtMs'>): void {
    pendingForMastering = { ...payload, createdAtMs: Date.now() };
  },

  consumeBounceForMastering(): HandoffAudioPayload | null {
    const val = pendingForMastering;
    pendingForMastering = null;
    return val;
  },

  sendPadToDrumLayering(payload: HandoffDrumSamplePayload): void {
    if (payload.type === 'kick') pendingDrumKick = payload;
    else pendingDrumSnare = payload;
  },

  consumePendingDrumSamples(): {
    kick: HandoffDrumSamplePayload | null;
    snare: HandoffDrumSamplePayload | null;
  } {
    const kick = pendingDrumKick;
    const snare = pendingDrumSnare;
    pendingDrumKick = null;
    pendingDrumSnare = null;
    return { kick, snare };
  },
};
