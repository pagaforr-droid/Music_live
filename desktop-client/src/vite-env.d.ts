/// <reference types="vite/client" />

declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array | number[], params?: Record<string, unknown>);
    tempo: number | string;
    beats: number[];
  }
}
