import { buildCrossfadedLoopArrays } from './LoopCrossfade';
import { detectPitchYin, midiNoteToName } from './PitchDetector';
import {
  arraysToAudioBuffer,
  normalizeStereoInPlace,
  removeDcOffsetInPlace,
} from './SampleBufferOps';
import { synthesizeProBassZone, type ProBassPresetId } from './SynthBassDsp';
import type {
  CustomSampleCategory,
  DefaultDrumPresetId,
  DefaultInstrumentId,
  DefaultMelodicPresetId,
  DrumPieceRole,
} from '../types/sampler.types';

export interface PresetCatalogEntry {
  id: DefaultInstrumentId;
  label: string;
  category: DrumPieceRole | 'melodic';
  description: string;
  group?: 'bass' | 'keys-guitar';
  badge?: string;
}

export const DRUM_PRESET_CATALOG: PresetCatalogEntry[] = [
  { id: 'drum-kick-punch', label: 'Kick Punch Estudio', category: 'kick', description: 'Sub 50Hz sólido + pegada limpia' },
  { id: 'drum-kick-acoustic', label: 'Kick Acústico Madera', category: 'kick', description: 'Bombo orgánico cálido de estudio' },
  { id: 'drum-kick-808', label: 'Kick Sub 808', category: 'kick', description: 'Subgrave profundo sostenido' },
  { id: 'drum-snare-studio', label: 'Snare Crack Estudio', category: 'snare', description: 'Caja con ataque 2.6kHz y bordona nítida' },
  { id: 'drum-snare-warm', label: 'Snare Madera Cálido', category: 'snare', description: 'Cuerpo acústico 180Hz natural' },
  { id: 'drum-snare-tight', label: 'Snare Seco Funk/Pop', category: 'snare', description: 'Rápido y articulado sin cola larga' },
  { id: 'drum-hat-crisp', label: 'Hi-Hat Cristal Acústico', category: 'hat', description: 'Parciales metálicos nítidos sin estridencia' },
  { id: 'drum-hat-tight', label: 'Hi-Hat Cerrado Tight', category: 'hat', description: 'Ultra corto 65ms preciso' },
  { id: 'drum-tom-deep', label: 'Tom Acústico Profundo', category: 'tom', description: 'Resonancia de parche natural' },
];

export const MELODIC_PRESET_CATALOG: PresetCatalogEntry[] = [
  { id: 'inst-piano-grand', label: 'Grand Piano Estudio', category: 'melodic', group: 'keys-guitar', badge: 'PIANO', description: 'Armónicos inarmónicos naturales y ataque de martillo' },
  { id: 'inst-piano-rhodes', label: 'Rhodes Eléctrico', category: 'melodic', group: 'keys-guitar', badge: 'RHODES', description: 'Tine suave + cuerpo cálido estéreo' },
  { id: 'inst-guitar-acoustic', label: 'Guitarra Acústica (Física)', category: 'melodic', group: 'keys-guitar', badge: 'ACÚSTICA', description: 'Cuerda punteada Karplus-Strong con caja acústica' },
  { id: 'inst-guitar-electric', label: 'Guitarra Eléctrica Limpia', category: 'melodic', group: 'keys-guitar', badge: 'ELÉCTRICA', description: 'Pastilla mástil cálida y sustain dulce' },
  { id: 'inst-synth-warm', label: 'Synth Teclado Cálido', category: 'melodic', group: 'keys-guitar', badge: 'SYNTH', description: 'Voces estéreo detune suavizadas' },
  { id: 'inst-bass-finger', label: 'Bajo Eléctrico Finger', category: 'melodic', group: 'bass', badge: 'FINGER', description: 'Cuerda grave cálida con ataque de dedo' },
  { id: 'inst-bass-sub808', label: 'Bajo Sub 808 Limpio', category: 'melodic', group: 'bass', badge: 'SUB 808', description: 'Fundamental pura con calidez analógica' },
  { id: 'inst-bass-astra-sub', label: 'Astra Hybrid Sub-Bass', category: 'melodic', group: 'bass', badge: 'ASTRA FM', description: 'Sub pesado limpio FM + wavetable con presencia moderna' },
  { id: 'inst-bass-astra-pluck', label: 'Astra Hybrid FM Pluck', category: 'melodic', group: 'bass', badge: 'ASTRA PLUCK', description: 'Pluck moderno FM + VA/wavetable que corta la mezcla' },
  { id: 'inst-bass-sh101-funk', label: 'SH-101 Disco-Funk Pluck', category: 'melodic', group: 'bass', badge: 'SH-101', description: 'Sinte mono icónico Disco-Funk / Pop con filtro OTA punchy' },
  { id: 'inst-bass-juno-chorus', label: 'Juno-106 Analog Chorus', category: 'melodic', group: 'bass', badge: 'JUNO-106', description: 'DCO analógico pop retro con chorus BBD estéreo mono-safe' },
  { id: 'inst-bass-jupiter-fat', label: 'Jupiter-8 Fat Pop Bass', category: 'melodic', group: 'bass', badge: 'JUPITER-8', description: 'Doble VCO analógico ancho para pop retro y synthwave' },
  { id: 'inst-bass-monark-sub', label: 'Monark Ladder Sub Grueso', category: 'melodic', group: 'bass', badge: 'MONARK', description: 'Emulación Ladder 3-VCO denso ideal para empalmar bajo acústico' },
  { id: 'inst-bass-90s-pad', label: 'Pad de Bajo Años 90', category: 'melodic', group: 'bass', badge: '90s PAD', description: 'Pad organ-sub cálido estilo 90s House/R&B con sustain continuo' },
  { id: 'inst-bass-autowah', label: 'Funk Auto-Wah Envelope', category: 'melodic', group: 'bass', badge: 'AUTO-WAH', description: 'Filtro resonante dinámico Auto-Wah con núcleo sub firme' },
  { id: 'inst-bass-suboctave', label: 'Sub-Octava Analógica', category: 'melodic', group: 'bass', badge: 'SUB-OCT', description: 'Refuerzo -1 octava analógico para engordar bajos finos' },
];

export const BASS_PRESET_CATALOG: PresetCatalogEntry[] = MELODIC_PRESET_CATALOG.filter(
  (entry) => entry.group === 'bass'
);

export function isBassPresetId(id: DefaultInstrumentId): boolean {
  return id.startsWith('inst-bass-');
}

const PRO_BASS_IDS = new Set<string>([
  'inst-bass-astra-sub',
  'inst-bass-astra-pluck',
  'inst-bass-sh101-funk',
  'inst-bass-juno-chorus',
  'inst-bass-jupiter-fat',
  'inst-bass-monark-sub',
  'inst-bass-90s-pad',
  'inst-bass-autowah',
  'inst-bass-suboctave',
]);

export interface ZoneSampleBuffer {
  rootMidi: number;
  left: Float32Array;
  right: Float32Array;
  peakOffsetSamples: number;
  loopStartSample?: number;
  loopEndSample?: number;
}

const presetCache = new Map<string, ZoneSampleBuffer[]>();

function createPrng(seedInit: number): () => number {
  let s = seedInit >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function buildDrumPresetArrays(
  id: DefaultDrumPresetId,
  sr: number
): ZoneSampleBuffer {
  const rand = createPrng(0x9e3779b1 + id.length * 131);

  if (id.startsWith('drum-kick')) {
    const dur = id === 'drum-kick-808' ? 0.48 : id === 'drum-kick-acoustic' ? 0.34 : 0.28;
    const len = Math.floor(sr * dur);
    const L = new Float32Array(len);
    const R = new Float32Array(len);
    const fStart = id === 'drum-kick-acoustic' ? 132 : id === 'drum-kick-808' ? 128 : 168;
    const fEnd = id === 'drum-kick-808' ? 43 : id === 'drum-kick-acoustic' ? 56 : 49;
    const decay = id === 'drum-kick-808' ? 6.2 : id === 'drum-kick-acoustic' ? 11.2 : 13.0;
    let phase = 0;
    let hpf = 0;
    const hpfAlpha = (2 * Math.PI * 30) / (sr + 2 * Math.PI * 30);

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f = fEnd + (fStart - fEnd) * Math.exp(-t * 40);
      phase += (2 * Math.PI * f) / sr;
      const body = Math.sin(phase) * Math.exp(-t * decay) + 0.16 * Math.sin(phase * 2) * Math.exp(-t * 24);
      const clickAmt = id === 'drum-kick-808' ? 0.18 : id === 'drum-kick-acoustic' ? 0.32 : 0.46;
      const click = (rand() * 0.45 + Math.sin(2 * Math.PI * 2900 * t) * 0.55) * Math.exp(-t * 260) * clickAmt;
      const fade = i > len - 160 ? (len - i) / 160 : 1;
      const raw = Math.tanh((body + click) * 1.15) * fade;
      hpf += hpfAlpha * (raw - hpf);
      const v = raw - hpf;
      L[i] = v;
      R[i] = v;
    }
    normalizeStereoInPlace(L, R, -1.0);
    // Find peak within first 20ms
    let peakIdx = 0;
    let maxA = 0;
    const lim = Math.min(len, Math.round(sr * 0.02));
    for (let i = 0; i < lim; i++) {
      if (Math.abs(L[i]) > maxA) {
        maxA = Math.abs(L[i]);
        peakIdx = i;
      }
    }
    return { rootMidi: 36, left: L, right: R, peakOffsetSamples: peakIdx };
  }

  if (id.startsWith('drum-snare')) {
    const dur = id === 'drum-snare-tight' ? 0.2 : id === 'drum-snare-warm' ? 0.36 : 0.3;
    const len = Math.floor(sr * dur);
    const L = new Float32Array(len);
    const R = new Float32Array(len);
    const f1Base = id === 'drum-snare-warm' ? 178 : id === 'drum-snare-tight' ? 218 : 200;
    const f2Base = id === 'drum-snare-warm' ? 286 : id === 'drum-snare-tight' ? 355 : 332;
    const wireDecay = id === 'drum-snare-tight' ? 22 : id === 'drum-snare-warm' ? 12.5 : 15.5;
    let p1 = 0;
    let p2 = 0;
    let lpL = 0;
    let lpR = 0;
    const lpAlpha = (2 * Math.PI * (id === 'drum-snare-warm' ? 6800 : 10500)) / (sr + 2 * Math.PI * 10500);

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      p1 += (2 * Math.PI * (f1Base + 85 * Math.exp(-t * 58))) / sr;
      p2 += (2 * Math.PI * (f2Base + 55 * Math.exp(-t * 48))) / sr;
      const shell = (0.64 * Math.sin(p1) + 0.36 * Math.sin(p2)) * Math.exp(-t * 23);
      const crack = Math.sin(2 * Math.PI * 2550 * t) * Math.exp(-t * 300) * 0.48;
      const nL = rand();
      const nR = rand();
      lpL += lpAlpha * (nL - lpL);
      lpR += lpAlpha * (nR - lpR);
      const wireEnv = Math.exp(-t * wireDecay) * 0.54;
      const fade = i > len - 160 ? (len - i) / 160 : 1;
      L[i] = Math.tanh((shell + crack + lpL * wireEnv) * 1.1) * fade;
      R[i] = Math.tanh((shell + crack + lpR * wireEnv) * 1.1) * fade;
    }
    normalizeStereoInPlace(L, R, -1.0);
    return { rootMidi: 38, left: L, right: R, peakOffsetSamples: Math.round(sr * 0.002) };
  }

  if (id.startsWith('drum-hat')) {
    const dur = id === 'drum-hat-tight' ? 0.075 : 0.19;
    const len = Math.floor(sr * dur);
    const L = new Float32Array(len);
    const R = new Float32Array(len);
    // TR metallic inharmonic partial cluster + HF air
    const ratios = [205.3, 304.6, 369.8, 522.7, 540.4, 800.2];
    const decayRate = id === 'drum-hat-tight' ? 56 : 24;
    let hp1L = 0, hp2L = 0, hp1R = 0, hp2R = 0;
    const hpAlpha = 0.86;
    let prevInL = 0, prevInR = 0;

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let metal = 0;
      for (let k = 0; k < ratios.length; k++) {
        metal += Math.sin(2 * Math.PI * ratios[k] * t) > 0 ? 0.14 : -0.14;
      }
      const inL = (metal * 0.65 + rand() * 0.35);
      const inR = (metal * 0.65 + rand() * 0.35);
      // 2-pole HPF for silky shimmer without low-mid ring
      hp1L = hpAlpha * (hp1L + inL - prevInL);
      prevInL = inL;
      hp2L = hpAlpha * (hp2L + hp1L);
      hp1R = hpAlpha * (hp1R + inR - prevInR);
      prevInR = inR;
      hp2R = hpAlpha * (hp2R + hp1R);

      const env = Math.exp(-t * decayRate) * Math.min(1, i / (sr * 0.0008));
      const fade = i > len - 96 ? (len - i) / 96 : 1;
      L[i] = (inL - hp2L * 0.1) * 0.55 * env * fade + hp1L * 0.55 * env * fade;
      R[i] = (inR - hp2R * 0.1) * 0.55 * env * fade + hp1R * 0.55 * env * fade;
    }
    normalizeStereoInPlace(L, R, -1.5);
    return { rootMidi: 42, left: L, right: R, peakOffsetSamples: Math.round(sr * 0.001) };
  }

  // drum-tom-deep
  const len = Math.floor(sr * 0.42);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 92 + 78 * Math.exp(-t * 28);
    phase += (2 * Math.PI * f) / sr;
    const body = (Math.sin(phase) * 0.8 + Math.sin(phase * 1.52) * 0.2) * Math.exp(-t * 8.2);
    const stick = rand() * Math.exp(-t * 180) * 0.28;
    const fade = i > len - 180 ? (len - i) / 180 : 1;
    const v = Math.tanh((body + stick) * 1.1) * fade;
    L[i] = v;
    R[i] = v;
  }
  normalizeStereoInPlace(L, R, -1.0);
  return { rootMidi: 45, left: L, right: R, peakOffsetSamples: Math.round(sr * 0.002) };
}

/**
 * Physical Modeling & Additive Multi-Zone Tonal Synthesizer (C2, C3, C4, C5 zones).
 * Generates genuinely warm acoustic/electric Guitar, Piano, Rhodes, Bass, and Synth tones.
 */
function buildMelodicZoneArrays(
  id: DefaultMelodicPresetId,
  midiRoot: number,
  sr: number
): ZoneSampleBuffer {
  if (PRO_BASS_IDS.has(id)) {
    return synthesizeProBassZone(id as ProBassPresetId, midiRoot, sr);
  }

  const f0 = 440 * Math.pow(2, (midiRoot - 69) / 12);
  const durSec = id.startsWith('inst-bass') ? 2.4 : 2.8;
  const len = Math.floor(sr * durSec);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const rand = createPrng(0x51f15a2d + midiRoot * 17 + id.length);

  if (id === 'inst-guitar-acoustic' || id === 'inst-guitar-electric' || id === 'inst-bass-finger') {
    // Karplus-Strong physical waveguide plucked string
    const periodSamples = Math.max(8, Math.round(sr / f0));
    const delayBuf = new Float32Array(periodSamples);
    const isElectric = id === 'inst-guitar-electric';
    const isBass = id === 'inst-bass-finger';

    // Shape pick excitation (smoother for bass & neck-pickup electric guitar)
    let lpExcite = 0;
    const exciteSmooth = isBass ? 0.22 : isElectric ? 0.35 : 0.62;
    for (let i = 0; i < periodSamples; i++) {
      const n = rand();
      lpExcite += exciteSmooth * (n - lpExcite);
      // Mix pure fundamental impulse + filtered noise burst for solid bottom pitch
      delayBuf[i] = lpExcite * 0.72 + Math.sin((2 * Math.PI * i) / periodSamples) * 0.28;
    }

    const dampCoeff = isBass ? 0.9965 : isElectric ? 0.9968 : 0.9942;
    const brightness = isBass ? 0.28 : isElectric ? 0.42 : 0.56;
    let bodyRes = 0;
    const bodyAlpha = (2 * Math.PI * (isBass ? 110 : 185)) / (sr + 2 * Math.PI * 185);
    const panSkew = Math.max(-0.12, Math.min(0.12, (midiRoot - 60) / 180));

    let ptr = 0;
    for (let i = 0; i < len; i++) {
      const prevPtr = (ptr + periodSamples - 1) % periodSamples;
      const nextVal = delayBuf[ptr];
      const prevVal = delayBuf[prevPtr];
      // Asymmetric string damping filter
      delayBuf[ptr] = dampCoeff * (brightness * nextVal + (1 - brightness) * prevVal);
      ptr = (ptr + 1) % periodSamples;

      // Subtle wooden body resonance filter on low-mids
      bodyRes += bodyAlpha * (nextVal - bodyRes);
      const outSample = nextVal * 0.85 + bodyRes * 0.28;

      const fadeOut = i > len - sr * 0.08 ? (len - i) / (sr * 0.08) : 1;
      const env = Math.min(1, i / (sr * 0.003)) * fadeOut;
      L[i] = outSample * env * (1 - panSkew);
      R[i] = outSample * env * (1 + panSkew);
    }
    removeDcOffsetInPlace(L, R);
    normalizeStereoInPlace(L, R, -2.5);
    return {
      rootMidi: midiRoot,
      left: L,
      right: R,
      peakOffsetSamples: Math.round(sr * 0.002),
    };
  }

  if (id === 'inst-piano-grand') {
    // Inharmonic acoustic piano partial model + felt hammer impulse
    const partials = [1.0, 0.58, 0.34, 0.22, 0.14, 0.09, 0.055, 0.032];
    const inharmB = 0.00024;
    const nyquist = sr * 0.43;
    const panWidth = (midiRoot - 58) / 110;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let val = 0;
      for (let h = 1; h <= partials.length; h++) {
        const fh = f0 * h * Math.sqrt(1 + inharmB * h * h);
        if (fh > nyquist) break;
        const harmDecay = Math.exp(-t * (1.25 + h * 0.72));
        val += Math.sin(2 * Math.PI * fh * t) * partials[h - 1] * harmDecay;
      }
      // Felt hammer transient (~4ms soft thump)
      const hammer = rand() * Math.exp(-t * 280) * 0.12;
      const atk = Math.min(1, i / (sr * 0.0035));
      const fadeOut = i > len - sr * 0.1 ? (len - i) / (sr * 0.1) : 1;
      const sample = (val * 0.42 + hammer) * atk * fadeOut;
      L[i] = sample * (1 - panWidth * 0.18);
      R[i] = sample * (1 + panWidth * 0.18);
    }
    normalizeStereoInPlace(L, R, -2.0);
    return { rootMidi: midiRoot, left: L, right: R, peakOffsetSamples: Math.round(sr * 0.003) };
  }

  if (id === 'inst-piano-rhodes') {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const body = Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t * 1.35);
      const tine2 = Math.sin(2 * Math.PI * (f0 * 2) * t) * Math.exp(-t * 2.8) * 0.28;
      const bell4 = Math.sin(2 * Math.PI * (f0 * 4) * t) * Math.exp(-t * 14) * 0.14;
      const bell7 = Math.sin(2 * Math.PI * (f0 * 7) * t) * Math.exp(-t * 36) * 0.08;
      const atk = Math.min(1, i / (sr * 0.004));
      const fade = i > len - sr * 0.1 ? (len - i) / (sr * 0.1) : 1;
      const tremL = 0.92 + 0.08 * Math.sin(2 * Math.PI * 3.2 * t);
      const tremR = 0.92 + 0.08 * Math.sin(2 * Math.PI * 3.2 * t + 1.2);
      const s = Math.tanh((body + tine2 + bell4 + bell7) * 0.72) * atk * fade;
      L[i] = s * tremL;
      R[i] = s * tremR;
    }
    normalizeStereoInPlace(L, R, -2.0);
    return { rootMidi: midiRoot, left: L, right: R, peakOffsetSamples: Math.round(sr * 0.003) };
  }

  if (id === 'inst-bass-sub808') {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const body = Math.sin(2 * Math.PI * f0 * t) + 0.18 * Math.sin(2 * Math.PI * f0 * 2 * t) * Math.exp(-t * 5);
      const atk = Math.min(1, i / (sr * 0.005));
      const dec = Math.exp(-t * 0.9);
      const fade = i > len - sr * 0.08 ? (len - i) / (sr * 0.08) : 1;
      const s = Math.tanh(body * 0.9) * atk * dec * fade;
      L[i] = s;
      R[i] = s;
    }
    normalizeStereoInPlace(L, R, -1.5);
    return { rootMidi: midiRoot, left: L, right: R, peakOffsetSamples: Math.round(sr * 0.004) };
  }

  // inst-synth-warm
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f1 = f0 * 0.9965;
    const f2 = f0 * 1.0035;
    const saw1 = 2 * ((f1 * t) % 1) - 1;
    const saw2 = 2 * ((f2 * t) % 1) - 1;
    const sub = Math.sin(2 * Math.PI * f0 * t) * 0.5;
    const cut = f0 * (2.0 + 4.0 * Math.exp(-t * 3.5));
    const alpha = Math.min(0.85, (2 * Math.PI * cut) / (sr + 2 * Math.PI * cut));
    lpL += alpha * ((saw1 * 0.45 + saw2 * 0.25 + sub) - lpL);
    lpR += alpha * ((saw2 * 0.45 + saw1 * 0.25 + sub) - lpR);
    const atk = Math.min(1, i / (sr * 0.012));
    const fade = i > len - sr * 0.12 ? (len - i) / (sr * 0.12) : 1;
    L[i] = lpL * atk * fade;
    R[i] = lpR * atk * fade;
  }
  normalizeStereoInPlace(L, R, -2.5);
  const synthLoopStart = Math.round(sr * 0.45);
  const synthLoopEnd = Math.round(sr * 1.8);
  const synthXf = buildCrossfadedLoopArrays(L, R, sr, synthLoopStart, synthLoopEnd, 36);
  L.set(synthXf.left, synthLoopStart);
  R.set(synthXf.right, synthLoopStart);
  return {
    rootMidi: midiRoot,
    left: L,
    right: R,
    peakOffsetSamples: Math.round(sr * 0.01),
    loopStartSample: synthLoopStart,
    loopEndSample: synthLoopEnd,
  };
}

export function getPresetZones(
  presetId: DefaultInstrumentId,
  sampleRate = 48000
): ZoneSampleBuffer[] {
  const key = `${presetId}@${sampleRate}`;
  const cached = presetCache.get(key);
  if (cached) return cached;

  let zones: ZoneSampleBuffer[];
  if (presetId.startsWith('drum-')) {
    zones = [buildDrumPresetArrays(presetId as DefaultDrumPresetId, sampleRate)];
  } else {
    // 5 octave zones (C1..C5) for basses so sub-register notes (E1..B1) track cleanly; 4 zones (C2..C5) for keys/guitars
    const zoneRoots = isBassPresetId(presetId) ? [24, 36, 48, 60, 72] : [36, 48, 60, 72];
    zones = zoneRoots.map((r) =>
      buildMelodicZoneArrays(presetId as DefaultMelodicPresetId, r, sampleRate)
    );
  }
  presetCache.set(key, zones);
  return zones;
}

export function getPresetAuditionBuffer(
  ctx: BaseAudioContext,
  presetId: DefaultInstrumentId
): AudioBuffer {
  const zones = getPresetZones(presetId, ctx.sampleRate);
  const targetMidi = isBassPresetId(presetId) ? 36 : 60; // C2 for basses, C4 for keys/guitars
  const chosen =
    zones.find((z) => z.rootMidi === targetMidi) ??
    (zones.length > 1 ? zones[Math.min(zones.length - 1, 2)] : zones[0]);
  return arraysToAudioBuffer(ctx, chosen.left, chosen.right, ctx.sampleRate);
}

/**
 * Infers which drum piece or melodic target a user-uploaded filename belongs to.
 */
export function inferReplacementCategoryFromName(name: string): CustomSampleCategory {
  const n = (name || '').toLowerCase();
  if (/(kick|bombo|bd|sub_hit|808_kick)/.test(n)) return 'kick';
  if (/(snare|caja|tarola|redoblante|sd|rimshot|clap)/.test(n)) return 'snare';
  if (/(hihat|hi-hat|hi_hat|hat|hh|plato|cymbal|crash|ride|shaker)/.test(n)) return 'hat';
  if (/(tom|perc|conga|bongo|timbal|floor)/.test(n)) return 'tom';
  return 'melodic';
}

/**
 * Generates compact normalized peak bars (0..1) for sample bank mini-waveform previews.
 */
export function computeMiniWaveformPreview(
  left: Float32Array,
  right: Float32Array,
  bars = 32
): number[] {
  const n = left.length;
  if (n === 0 || bars <= 0) return Array(Math.max(1, bars)).fill(0.1);
  const step = Math.max(1, Math.floor(n / bars));
  const out: number[] = [];
  let maxVal = 0.001;
  for (let b = 0; b < bars; b++) {
    const start = b * step;
    const end = Math.min(n, start + step);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      if (a > peak) peak = a;
    }
    if (peak > maxVal) maxVal = peak;
    out.push(peak);
  }
  return out.map((v) => Number(Math.max(0.06, Math.min(1, v / maxVal)).toFixed(3)));
}

/**
 * Prepares a user-recorded or uploaded sample for accurate full-track replacement:
 * - Auto-trims dead leading silence (below -40 dB) so notes/drums NEVER drag behind the beat
 * - Optional studio peak normalization (-1.0 dBFS) for quiet mic recordings or raw exports
 * - Detects transient peak offset for phase/peak alignment on drum replacements
 * - Detects musical root MIDI note via YIN for melodic pitch-following replacement
 */
export function prepareCustomReplacementSample(
  buffer: AudioBuffer,
  options?: { normalize?: boolean }
): {
  trimmedBuffer: AudioBuffer;
  peakOffsetSec: number;
  detectedRootMidi: number;
  detectedNoteName: string;
  waveformPreview: number[];
} {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

  let globalMax = 0;
  for (let i = 0; i < ch0.length; i++) {
    const a = Math.max(Math.abs(ch0[i]), Math.abs(ch1[i]));
    if (a > globalMax) globalMax = a;
  }

  const trimThresh = Math.max(1e-4, globalMax * Math.pow(10, -40 / 20));
  let startIdx = 0;
  for (let i = 0; i < ch0.length; i++) {
    if (Math.max(Math.abs(ch0[i]), Math.abs(ch1[i])) >= trimThresh) {
      startIdx = Math.max(0, i - Math.round(sr * 0.002));
      break;
    }
  }

  let endIdx = ch0.length;
  for (let i = ch0.length - 1; i > startIdx + Math.round(sr * 0.03); i--) {
    if (Math.max(Math.abs(ch0[i]), Math.abs(ch1[i])) >= trimThresh * 0.5) {
      endIdx = Math.min(ch0.length, i + Math.round(sr * 0.04));
      break;
    }
  }

  const outLen = Math.max(64, endIdx - startIdx);
  const left = new Float32Array(ch0.subarray(startIdx, startIdx + outLen));
  const right = new Float32Array(ch1.subarray(startIdx, startIdx + outLen));
  removeDcOffsetInPlace(left, right);

  if (options?.normalize !== false) {
    normalizeStereoInPlace(left, right, -1.0);
  }

  // De-click 2ms fade-in and 4ms tail fade-out
  const fadeIn = Math.min(Math.floor(outLen / 4), Math.round(sr * 0.002));
  for (let i = 0; i < fadeIn; i++) {
    const g = i / Math.max(1, fadeIn);
    left[i] *= g;
    right[i] *= g;
  }
  const fadeOut = Math.min(Math.floor(outLen / 4), Math.round(sr * 0.004));
  for (let i = 0; i < fadeOut; i++) {
    const g = i / Math.max(1, fadeOut);
    left[outLen - 1 - i] *= g;
    right[outLen - 1 - i] *= g;
  }

  // Peak offset in first 25ms
  let peakIdx = 0;
  let peakA = 0;
  const searchEnd = Math.min(outLen, Math.round(sr * 0.025));
  for (let i = 0; i < searchEnd; i++) {
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (a > peakA) {
      peakA = a;
      peakIdx = i;
    }
  }

  // YIN root note detection
  const mono = new Float32Array(Math.min(outLen, sr * 2));
  for (let i = 0; i < mono.length; i++) {
    mono[i] = 0.5 * (left[i] + right[i]);
  }
  const pitch = detectPitchYin(mono, sr, 40, 1800);
  const rootMidi = pitch.confidence >= 0.42 ? pitch.midiNote : 60;
  const waveformPreview = computeMiniWaveformPreview(left, right, 32);

  const trimmedBuffer = new AudioBuffer({
    length: outLen,
    numberOfChannels: 2,
    sampleRate: sr,
  });
  trimmedBuffer.copyToChannel(left, 0);
  trimmedBuffer.copyToChannel(right, 1);

  return {
    trimmedBuffer,
    peakOffsetSec: Number((peakIdx / sr).toFixed(5)),
    detectedRootMidi: rootMidi,
    detectedNoteName: midiNoteToName(rootMidi),
    waveformPreview,
  };
}
