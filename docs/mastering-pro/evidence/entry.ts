// Audit harness: runs the REAL Mastering Pro engine in headless Chromium and measures objective results.
import { WebAudioMasteringEngine } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/engine/WebAudioMasteringEngine';
import { buildMasteringDspGraph } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/engine/MasteringGraphBuilder';
import { PRO_PRESETS_CATALOG, buildEffectiveDspChain, extractSurgicalOverridesFromPreset, syncSurgicalOverridesEqBands } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/presets/proPresetsCatalog';
import { computeIntegratedLufsBs1770 } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/engine/SpectralDeltaAnalyzer';
import { measureTruePeakLinearBlock, linearToDb } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/engine/TruePeakLimiter';
import { encodeAudioBufferToWav24Bit } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/engine/Wav24BitEncoder';

const results: Record<string, unknown> = {};

function stats(buf: AudioBuffer) {
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  let peak = 0, sumSq = 0, nearCeil = 0, clipped = 0;
  for (let i = 0; i < l.length; i++) {
    const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    if (a > peak) peak = a;
    sumSq += 0.5 * (l[i] * l[i] + r[i] * r[i]);
  }
  const thr = peak * 0.98;
  for (let i = 0; i < l.length; i++) {
    const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    if (a >= thr) nearCeil++;
    if (a >= 0.9999) clipped++;
  }
  const rms = Math.sqrt(sumSq / l.length);
  return {
    lufs: computeIntegratedLufsBs1770(buf),
    samplePeakDb: +linearToDb(peak, -90).toFixed(2),
    truePeakDb: +linearToDb(measureTruePeakLinearBlock(l, r), -90).toFixed(2),
    rmsDb: +(20 * Math.log10(rms + 1e-12)).toFixed(2),
    crestDb: +(linearToDb(peak, -90) - 20 * Math.log10(rms + 1e-12)).toFixed(2),
    pctSamplesWithin2pctOfPeak: +((nearCeil / l.length) * 100).toFixed(3),
    clippedSamples: clipped,
  };
}

// ---- Test A: native DynamicsCompressorNode behaviour (auto make-up + lookahead latency) ----
async function testCompressor() {
  const sr = 48000;
  const out: Record<string, unknown> = {};
  for (const [thr, ratio] of [[-18, 2], [-24, 3], [-12, 1.5]] as const) {
    const off = new OfflineAudioContext(1, sr, sr);
    const osc = off.createOscillator();
    osc.frequency.value = 1000;
    const g = off.createGain();
    g.gain.value = Math.pow(10, -40 / 20); // -40 dBFS, far below threshold
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = thr; comp.ratio.value = ratio; comp.knee.value = 6;
    comp.attack.value = 0.025; comp.release.value = 0.12;
    osc.connect(g); g.connect(comp); comp.connect(off.destination); osc.start();
    const rendered = await off.startRendering();
    const d = rendered.getChannelData(0);
    let s = 0; for (let i = sr / 2; i < sr; i++) s += d[i] * d[i];
    const rmsDb = 10 * Math.log10(s / (sr / 2));
    const inRmsDb = -40 - 3.0103;
    out[`thr${thr}_ratio${ratio}`] = { gainThroughCompressorWhenBelowThresholdDb: +(rmsDb - inRmsDb).toFixed(2) };
  }
  // latency
  const off2 = new OfflineAudioContext(1, 4800, sr);
  const buf = off2.createBuffer(1, 4800, sr); buf.getChannelData(0)[100] = 0.05;
  const src = off2.createBufferSource(); src.buffer = buf;
  const comp2 = off2.createDynamicsCompressor();
  src.connect(comp2); comp2.connect(off2.destination); src.start();
  const r2 = (await off2.startRendering()).getChannelData(0);
  let maxI = 0, maxV = 0; for (let i = 0; i < r2.length; i++) if (Math.abs(r2[i]) > maxV) { maxV = Math.abs(r2[i]); maxI = i; }
  out.compressorLatencyMs = +(((maxI - 100) / sr) * 1000).toFixed(2);
  return out;
}

// ---- Test B: full export of the real engine vs. preset target ----
function makeMusicLikeBuffer(ctx: BaseAudioContext, durationSec: number, targetRmsDb: number): AudioBuffer {
  // Dense pseudo-mix: sub bass + chords + noise-ish hats + kick/snare, dynamics similar to AI-generated pop
  const sr = ctx.sampleRate;
  const len = Math.floor(durationSec * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const bpm = 120, beat = 60 / bpm;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff * 2 - 1; };
  const roots = [55, 65.4, 73.4, 49];
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const bar = Math.floor(t / (beat * 4)) % 4;
    const bf = t % beat;
    const bass = Math.sin(2 * Math.PI * roots[bar] * t) * 0.35;
    const kick = bf < 0.2 && (Math.floor(t / beat) % 2 === 0) ? Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-bf * 40)) * bf) * Math.exp(-bf * 12) * 0.6 : 0;
    const sn = bf < 0.15 && (Math.floor(t / beat) % 2 === 1) ? (rnd() * 0.3 + Math.sin(2 * Math.PI * 200 * bf) * 0.25) * Math.exp(-bf * 25) : 0;
    const hat = (t % (beat / 2)) < 0.04 ? rnd() * 0.1 * Math.exp(-(t % (beat / 2)) * 80) : 0;
    const f0 = roots[bar] * 4;
    const pad = (Math.sin(2 * Math.PI * f0 * t) + Math.sin(2 * Math.PI * f0 * 1.26 * t) + Math.sin(2 * Math.PI * f0 * 1.5 * t)) * 0.07;
    const pad2 = (Math.sin(2 * Math.PI * f0 * 1.005 * t + 1) + Math.sin(2 * Math.PI * f0 * 1.27 * t + 2)) * 0.07;
    const lead = Math.sin(2 * Math.PI * (f0 * 3 + Math.sin(t * 5) * 4) * t) * 0.09;
    const air = rnd() * 0.02;
    L[i] = bass + kick + sn + hat + pad + lead + air;
    R[i] = bass + kick + sn + hat * 1.2 + pad2 + lead + air * -1;
  }
  // scale to target RMS
  let s = 0; for (let i = 0; i < len; i++) s += 0.5 * (L[i] * L[i] + R[i] * R[i]);
  const rms = Math.sqrt(s / len);
  const g = Math.pow(10, targetRmsDb / 20) / rms;
  for (let i = 0; i < len; i++) { L[i] *= g; R[i] *= g; }
  return buf;
}

async function wavFileFromBuffer(buf: AudioBuffer): Promise<File> {
  const blob = encodeAudioBufferToWav24Bit(buf, false);
  return new File([blob], 'test.wav', { type: 'audio/wav' });
}

async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

async function testExports() {
  const out: Record<string, unknown> = {};
  const scenarios = [
    { inRms: -20, presetIdx: 0 },
    { inRms: -14, presetIdx: 0 },
    { inRms: -20, presetIdx: 1 },
    { inRms: -14, presetIdx: 3 },
    { inRms: -14, presetIdx: 5 },
  ];
  for (const sc of scenarios) {
    const preset = PRO_PRESETS_CATALOG[sc.presetIdx];
    const overrides = extractSurgicalOverridesFromPreset(preset);
    const chain = buildEffectiveDspChain(preset, 100, overrides, null);
    const engine = new WebAudioMasteringEngine(chain);
    const off = new OfflineAudioContext(2, 48000, 48000);
    const input = makeMusicLikeBuffer(off, 14, sc.inRms);
    const file = await wavFileFromBuffer(input);
    const { report } = await engine.loadAudioFile(file);
    const decodedIn = engine.getAudioBuffer()!;
    const inStats = stats(decodedIn);
    const res = await engine.exportMasterToWav24Bit(undefined, chain);
    const outBuf = await decodeBlob(res.blob);
    const outStats = stats(outBuf);
    out[`${preset.id}@in${sc.inRms}`] = {
      targetLufs: chain.limiter.targetLufs,
      ceiling: chain.limiter.ceilingDbTp,
      makeupDbUsed: +engine.computeTargetMakeupGainDb(chain).toFixed(2),
      reportInputLufs: report.detectedInputLufs,
      inStats,
      outStats,
      engineReportedTruePeak: res.finalTruePeakDbTp,
      engineReportedMaxGR: res.maxLimiterReductionDb,
      lufsErrorVsTarget: +(outStats.lufs - chain.limiter.targetLufs).toFixed(2),
    };
    engine.dispose();
  }
  return out;
}

// ---- Test C: parallel-compression comb filtering (dry vs delayed wet) ----
async function testCombFilter() {
  const sr = 48000;
  const off = new OfflineAudioContext(1, sr * 2, sr);
  const buf = off.createBuffer(1, sr * 2, sr);
  const d = buf.getChannelData(0);
  let seed = 7; for (let i = 0; i < d.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 0xffffffff * 2 - 1) * 0.05; }
  const src = off.createBufferSource(); src.buffer = buf;
  const comp = off.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 2; comp.knee.value = 6; comp.attack.value = 0.025; comp.release.value = 0.12;
  const wet = off.createGain(); wet.gain.value = 0.5; const dry = off.createGain(); dry.gain.value = 0.5;
  const sum = off.createGain();
  src.connect(comp); comp.connect(wet); wet.connect(sum); src.connect(dry); dry.connect(sum); sum.connect(off.destination);
  src.start();
  const out = (await off.startRendering()).getChannelData(0);
  // spectral magnitude ratio out/in at 1/(2*6ms)=83Hz multiples: compute with a simple DFT at selected freqs
  const dft = (x: Float32Array, f: number) => { let re = 0, im = 0; for (let i = sr / 2; i < x.length; i++) { const a = 2 * Math.PI * f * i / sr; re += x[i] * Math.cos(a); im -= x[i] * Math.sin(a); } return Math.hypot(re, im); };
  const res: Record<string, number> = {};
  for (const f of [40, 83, 100, 166, 250, 333, 500, 1000, 2000, 4000]) {
    res[`${f}Hz`] = +(20 * Math.log10(dft(out, f) / dft(d, f))).toFixed(2);
  }
  return res;
}


function goertzelDb(x: Float32Array, f: number, sr: number): number {
  let re = 0, im = 0;
  const step = 1;
  for (let i = 0; i < x.length; i += step) { const a = 2 * Math.PI * f * i / sr; re += x[i] * Math.cos(a); im -= x[i] * Math.sin(a); }
  return 20 * Math.log10(Math.hypot(re, im) / x.length + 1e-12);
}
function bandProfile(buf: AudioBuffer) {
  const l = buf.getChannelData(0), r = buf.getChannelData(1);
  const n = Math.min(l.length, 48000 * 6);
  const mid = new Float32Array(n), side = new Float32Array(n);
  for (let i = 0; i < n; i++) { mid[i] = 0.5 * (l[i] + r[i]); side[i] = 0.5 * (l[i] - r[i]); }
  const freqs = [60, 320, 1000, 2800, 3800, 6200, 12000];
  const o: Record<string, number> = {};
  // per-band energy: average of 3 neighbouring Goertzel bins around centre
  for (const f of freqs) {
    const m = [0.97, 1, 1.03].map((k) => Math.pow(10, goertzelDb(mid, f * k, 48000) / 10)).reduce((a, b) => a + b, 0);
    const s = [0.97, 1, 1.03].map((k) => Math.pow(10, goertzelDb(side, f * k, 48000) / 10)).reduce((a, b) => a + b, 0);
    o[`mid${f}`] = +(10 * Math.log10(m)).toFixed(1);
    o[`side${f}`] = +(10 * Math.log10(s)).toFixed(1);
  }
  return o;
}

async function exportWith(patch: (o: any) => any, inRms = -18, presetIdx = 0) {
  const preset = PRO_PRESETS_CATALOG[presetIdx];
  let ov = extractSurgicalOverridesFromPreset(preset);
  ov = syncSurgicalOverridesEqBands(patch(ov));
  const chain = buildEffectiveDspChain(preset, 100, ov, null);
  const engine = new WebAudioMasteringEngine(chain);
  const off = new OfflineAudioContext(2, 48000, 48000);
  const input = makeMusicLikeBuffer(off, 8, inRms);
  await engine.loadAudioFile(await wavFileFromBuffer(input));
  const res = await engine.exportMasterToWav24Bit(undefined, chain);
  const outBuf = await decodeBlob(res.blob);
  engine.dispose();
  return { outBuf, chain };
}

async function testSensitivity() {
  const base = await exportWith((o) => o);
  const baseProf = bandProfile(base.outBuf);
  const baseStats = stats(base.outBuf);
  const variants: Record<string, (o: any) => any> = {
    'midLowPunchDb +6 (60Hz mid)': (o) => ({ ...o, midLowPunchDb: 6 }),
    'stereoMudCutDb -6 (320Hz)': (o) => ({ ...o, stereoMudCutDb: -6 }),
    'midPresenceDb +6 (2.8k mid)': (o) => ({ ...o, midPresenceDb: 6 }),
    'deHarshnessCutDb -6 (3.8k)': (o) => ({ ...o, deHarshnessCutDb: -6 }),
    'sibilanceCutDb -6 (6.2k)': (o) => ({ ...o, sibilanceCutDb: -6 }),
    'sideAirBoostDb +6 (12k side)': (o) => ({ ...o, sideAirBoostDb: 6 }),
    'stereoWidthPct 0 (mono)': (o) => ({ ...o, stereoWidthPct: 0 }),
    'stereoWidthPct 150': (o) => ({ ...o, stereoWidthPct: 150 }),
    'monoMakerFreq 250': (o) => ({ ...o, monoMakerFreq: 250 }),
    'highPassFreq 60': (o) => ({ ...o, highPassFreq: 60 }),
    'tapeDrivePct 95 tape': (o) => ({ ...o, tapeDrivePct: 95, saturationType: 'tape' }),
    'comp glue mix 0%': (o) => ({ ...o, compressorGlueMixPct: 0 }),
    'comp thr -35 ratio 8': (o) => ({ ...o, compressorThresholdDb: -35, compressorRatio: 8 }),
    'targetLufs -14': (o) => ({ ...o, targetLufs: -14 }),
    'targetLufs -8': (o) => ({ ...o, targetLufs: -8 }),
    'ceiling -3': (o) => ({ ...o, ceilingDbTp: -3 }),
    'humanizer disabled': (o) => ({ ...o, forensicHumanizer: { ...o.forensicHumanizer, enabled: false } }),
    'cqt a432_detune': (o) => ({ ...o, forensicHumanizer: { ...o.forensicHumanizer, cqtDeQuantizeMode: 'a432_detune' } }),
    'drum layering ON': (o) => ({ ...o, drumLayering: { ...o.drumLayering, enabled: true, kickMix: 0.9, snareMix: 0.9 } }),
  };
  const out: Record<string, unknown> = { baseline: { stats: baseStats } };
  for (const [name, fn] of Object.entries(variants)) {
    const { outBuf } = await exportWith(fn);
    const prof = bandProfile(outBuf);
    const st = stats(outBuf);
    const delta: Record<string, number> = {};
    for (const k of Object.keys(prof)) delta[k] = +(prof[k] - baseProf[k]).toFixed(1);
    out[name] = {
      lufs: st.lufs, tp: st.truePeakDb, crest: st.crestDb, durationSec: +outBuf.duration.toFixed(3),
      deltaVsBaseline_dB: delta,
    };
  }
  return out;
}

async function testLiveGraphVsExport() {
  const preset = PRO_PRESETS_CATALOG[0];
  const ov = extractSurgicalOverridesFromPreset(preset);
  const chain = buildEffectiveDspChain(preset, 100, ov, null);
  const engine = new WebAudioMasteringEngine(chain);
  const off0 = new OfflineAudioContext(2, 48000, 48000);
  const input = makeMusicLikeBuffer(off0, 10, -14);
  const { report } = await engine.loadAudioFile(await wavFileFromBuffer(input));
  const dec = engine.getAudioBuffer()!;
  const makeup = engine.computeTargetMakeupGainDb(chain);
  // what the LIVE graph produces (same builder, no cloak, no offline limiter)
  const off = new OfflineAudioContext(2, dec.length, 48000);
  const g = buildMasteringDspGraph(off, chain, makeup);
  g.applyDspChain(chain, makeup, 0);
  const src = off.createBufferSource(); src.buffer = dec; src.connect(g.inputNode); g.outputNode.connect(off.destination); src.start(0);
  const liveLike = await off.startRendering();
  const exp = await decodeBlob((await engine.exportMasterToWav24Bit(undefined, chain, makeup)).blob);
  // residual between them
  const a = liveLike.getChannelData(0), b = exp.getChannelData(0);
  let se = 0, sa = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; se += d * d; sa += a[i] * a[i]; }
  engine.dispose();
  return { liveEquivalentGraph: stats(liveLike), export: stats(exp), residualVsLiveDb: +(10 * Math.log10(se / sa)).toFixed(2), inputLufs: report.detectedInputLufs };
}
(async () => {
  try {
    results.compressor = await testCompressor();
    results.parallelCompFreqResponseDb = await testCombFilter();
    results.exports = await testExports();
    results.sensitivity = await testSensitivity();
    results.liveVsExport = await testLiveGraphVsExport();
  } catch (e) {
    results.error = String(e && (e as Error).stack || e);
  }
  await fetch('/result', { method: 'POST', body: JSON.stringify(results, null, 2) });
})();

