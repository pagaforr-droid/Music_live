import { analyzeTrackAndComputeAdaptation } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/engine/SpectralDeltaAnalyzer';

function make(sr: number, sec: number, withHF: boolean, withSib: boolean, withRes: boolean): AudioBuffer {
  const ctx = new OfflineAudioContext(2, 48000, sr);
  const len = sr * sec;
  const b = ctx.createBuffer(2, len, sr);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  let s = 99;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff * 2 - 1; };
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    lp += 0.05 * (rnd() - lp); // brown-ish noise bed
    let v = lp * 0.6 + Math.sin(2 * Math.PI * 110 * t) * 0.15 + Math.sin(2 * Math.PI * 440 * t) * 0.08;
    if (withHF) v += Math.sin(2 * Math.PI * 12000 * t) * 0.25;           // loud "air" tone
    if (withSib) v += Math.sin(2 * Math.PI * 6200 * t) * 0.25;           // loud sibilance-region tone
    if (withRes) v += Math.sin(2 * Math.PI * 3850 * t) * 0.3;            // strong stationary resonance line @3.85k
    L[i] = v; R[i] = v * 0.98;
  }
  return b;
}

const out: Record<string, unknown> = {};
for (const sec of [6, 20, 180]) {
  const clean = analyzeTrackAndComputeAdaptation(make(48000, sec, false, false, false));
  const loud = analyzeTrackAndComputeAdaptation(make(48000, sec, true, true, true));
  out[`${sec}s`] = {
    clean: { profile: clean.inputSpectralProfile, aiArtifactScore: clean.aiArtifactScore, sibilanceScore: clean.sibilanceScore, notches: clean.detectedResonanceLines.map((n) => `${n.freqHz}Hz ${n.gainCutDb}dB`) },
    withAir12k_Sib6k2_Res3k85: { profile: loud.inputSpectralProfile, aiArtifactScore: loud.aiArtifactScore, sibilanceScore: loud.sibilanceScore, notches: loud.detectedResonanceLines.map((n) => `${n.freqHz}Hz ${n.gainCutDb}dB`) },
  };
}
fetch('/result', { method: 'POST', body: JSON.stringify(out, null, 2) });
