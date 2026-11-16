import {
  analyzeFullBandwidthSpectrum,
  detectOnsetsSpectralFlux,
} from '../../dsp-core/SpectralFftCore';
import { computeFullLoudnessReport } from '../../dsp-core/KWeightingLufs';

export interface SpectralWorkerRequest {
  id: number;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  kickSensitivity: number;
  snareSensitivity: number;
}

self.onmessage = (e: MessageEvent<SpectralWorkerRequest>) => {
  try {
    const { id, left, right, sampleRate, kickSensitivity, snareSensitivity } = e.data;
    const channels = [left, right];
    const loudness = computeFullLoudnessReport(channels, sampleRate);
    const spectral = analyzeFullBandwidthSpectrum(left, right, sampleRate);

    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      mono[i] = 0.5 * (left[i] + right[i]);
    }
    const fluxOnsets = detectOnsetsSpectralFlux(mono, sampleRate, {
      sensitivity: Math.max(kickSensitivity, snareSensitivity),
      minIntervalMs: 85,
      snapToZeroCrossing: true,
    });

    self.postMessage({
      id,
      success: true,
      loudness,
      spectral,
      fluxOnsets,
    });
  } catch (err) {
    self.postMessage({
      id: e.data?.id,
      success: false,
      error: err instanceof Error ? err.message : 'Worker analysis error',
    });
  }
};
