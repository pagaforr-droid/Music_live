/**
 * beatGridDSP.ts
 * Motor DSP de Re-Sincronización Multi-Isla y Puenteo de Silencios ("Smart Re-Lock & Silence Bridge")
 * Toma como referencia principal la pista "Master" (y opcionalmente "Drums" / "Batería" como microscopio de transitorios)
 * para detectar silencios prolongados o caídas rítmicas, recalcular el tempo/fase cuando la música vuelve a empezar,
 * y reconstruir los puentes de silencio manteniendo el pulso 1 (Downbeat) siempre en fase.
 */

export interface RhythmicIsland {
  index: number;
  startSec: number;
  endSec: number;
  reEntryTransientSec: number;
  isPostSilence: boolean;
  silenceDurationBeforeSec: number;
}

export interface BeatGridRepairResult {
  bpm: number;
  beatTimes: number[];
  downbeats: number[];
  firstBeatOffset: number;
  islandsDetected: number;
  silencesRepaired: number;
  referenceTrackName: string;
  usedDrumAssist: boolean;
  telemetrySummary: string;
}

const ISOLATED_STEM_KEYWORDS = [
  'drum', 'drums', 'bateria', 'batería', 'perc', 'percusion', 'percusión', 'kick', 'snare', 'bombo',
  'bass', 'bajo', 'vocal', 'vocals', 'voz', 'voces', 'coro', 'coros', 'bgv',
  'guitar', 'guitarra', 'acustica', 'acústica', 'electrica', 'eléctrica', 'egtr', 'agtr',
  'piano', 'keys', 'teclado', 'synth', 'sintetizador', 'pad', 'strings', 'cuerdas', 'brass', 'vientos',
  'click', 'metronomo', 'metrónomo', 'guia', 'guía', 'cue', 'cues', 'other', 'otros'
];

/**
 * Determina si el nombre de un archivo/stem corresponde a la pista "Master" de referencia.
 * Ignora pistas que provienen de un splitter donde el archivo base tenía "Master" pero termina en "(Drums)", "(Bass)", etc.
 */
export function isMasterTrackByName(rawName: string): boolean {
  if (!rawName) return false;
  const clean = rawName
    .replace(/\.(wav|mp3|ogg|flac|m4a|aac)$/i, '')
    .trim();
  const lower = clean.toLowerCase();

  // Si termina en un sufijo entre paréntesis o guion bajo de un instrumento aislado (ej. "Cancion_Master (Drums)")
  const parenMatch = lower.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const inside = parenMatch[1].trim();
    if (ISOLATED_STEM_KEYWORDS.some(k => inside.includes(k))) {
      return false;
    }
    if (inside === 'master' || inside.includes('mezcla') || inside.includes('full mix')) {
      return true;
    }
  }

  // Verificar si contiene explícitamente la palabra "master", "mezcla master", "full mix", "mixdown"
  const hasMasterWord = /(?:^|[\s_\-([.])(master|mezcla\s*master|full\s*mix|mixdown)(?:$|[\s_\-)\].])/i.test(clean)
    || lower === 'master'
    || lower.endsWith('master')
    || lower.endsWith('_master')
    || lower.endsWith('-master')
    || lower.includes('master');

  if (!hasMasterWord) return false;

  // Si además del texto "master" termina con el nombre de un instrumento aislado (ej. "Song_Master_Drums"), descartar
  const trailingToken = lower.split(/[\s_\-]+/).pop() || '';
  if (trailingToken !== 'master' && ISOLATED_STEM_KEYWORDS.some(k => trailingToken === k)) {
    return false;
  }

  return true;
}

/**
 * Encuentra de forma inteligente el stem "Master" de referencia y opcionalmente el stem de "Batería / Drums".
 * Prioridad para Master:
 *  1. s.metadata?.is_master === true
 *  2. Nombre con la palabra "Master" (sin ser un stem aislado de instrumento)
 *  3. Nombre que contenga "master", "mezcla", "full", "mix"
 */
export function findMasterAndDrumStems(stems: any[]): {
  masterStem: any | null;
  trueMasterStem: any | null;
  drumStem: any | null;
} {
  if (!stems || stems.length === 0) {
    return { masterStem: null, trueMasterStem: null, drumStem: null };
  }

  // Filtrar copias con marca de agua si existen originales disponibles
  const nonWatermarked = stems.filter(s => !s.name?.toUpperCase().includes('(WM)'));
  const pool = nonWatermarked.length > 0 ? nonWatermarked : stems;

  // 1. Explícitamente marcado con ★ Master en metadata
  let masterStem = pool.find(s => s.metadata?.is_master === true) || null;

  // 2. Detección inteligente por la palabra "Master" en el nombre del archivo
  if (!masterStem) {
    masterStem = pool.find(s => isMasterTrackByName(s.name || '')) || null;
  }

  // 3. Fallback si todos los archivos tenían algún sufijo pero uno contiene "master" o "mezcla"
  if (!masterStem) {
    masterStem = pool.find(s => {
      const n = (s.name || '').toLowerCase();
      return n.includes('master') || n.includes('mezcla') || n.includes('full mix');
    }) || null;
  }

  const trueMasterStem = masterStem;

  // Buscar pista de Batería / Drums aislada (distinta del Master) para asistir en transitorios
  const drumStem = pool.find(s => {
    if (masterStem && s.id === masterStem.id) return false;
    const n = (s.name || '').toLowerCase();
    const icon = (s.metadata?.instrument_icon || '').toLowerCase();
    return (
      icon === 'drums' ||
      n.includes('drum') ||
      n.includes('bateria') ||
      n.includes('batería') ||
      n.includes('kick') ||
      n.includes('snare') ||
      n.includes('bombo') ||
      n.includes('perc')
    );
  }) || null;

  // Si no había Master pero sí hay stems, usar drumStem o el primer stem como referencia primaria
  if (!masterStem) {
    masterStem = drumStem || pool[0] || null;
  }

  return { masterStem, trueMasterStem, drumStem };
}

/**
 * Decodifica un archivo de audio desde su URL en un AudioBuffer cerrando limpiamente el contexto temporal.
 */
export async function decodeAudioUrlToBuffer(url: string): Promise<AudioBuffer | null> {
  if (!url) return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;

  const tempCtx: AudioContext = new AudioCtx();
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuf);
    return audioBuffer;
  } catch (err) {
    console.warn('[beatGridDSP] No se pudo decodificar URL para DSP:', url, err);
    return null;
  } finally {
    try {
      if (tempCtx.state !== 'closed') {
        await tempCtx.close();
      }
    } catch (_) {
      // ignore close error
    }
  }
}

/**
 * Extrae el perfil rítmico de alta resolución (100 Hz = pasos de 10ms) combinando:
 * - Energía RMS de banda completa del Master (detecta silencios reales y pausas dramáticas)
 * - Flujo de Ataque Percusivo (Onset Flux) del Master (aísla golpes de batería/ataques rítmicos de pads o voces largas)
 * - Asistencia de Batería aislada (si existe en el proyecto) para máxima nitidez en re-entradas.
 */
function extractRhythmicProfile(
  masterBuffer: AudioBuffer,
  drumBuffer?: AudioBuffer | null,
  frameHz: number = 100
) {
  const sr = masterBuffer.sampleRate;
  const ch0 = masterBuffer.getChannelData(0);
  const ch1 = masterBuffer.numberOfChannels > 1 ? masterBuffer.getChannelData(1) : null;
  const totalSamples = ch0.length;
  const frameSamples = Math.max(1, Math.floor(sr / frameHz));
  const numFrames = Math.ceil(totalSamples / frameSamples);

  const drumCh0 = drumBuffer && drumBuffer.sampleRate === sr ? drumBuffer.getChannelData(0) : null;
  const drumCh1 = drumBuffer && drumBuffer.sampleRate === sr && drumBuffer.numberOfChannels > 1
    ? drumBuffer.getChannelData(1)
    : null;

  const masterRms = new Float32Array(numFrames);
  const masterDeriv = new Float32Array(numFrames);
  const drumRms = new Float32Array(numFrames);
  const onsetFlux = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * frameSamples;
    const end = Math.min(totalSamples, start + frameSamples);
    const count = end - start;
    if (count <= 0) continue;

    let sumSq = 0;
    let sumDiff = 0;
    let prevSample = start > 0 ? (ch1 ? 0.5 * (ch0[start - 1] + ch1[start - 1]) : ch0[start - 1]) : 0;

    for (let i = start; i < end; i++) {
      const s = ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i];
      sumSq += s * s;
      const diff = Math.abs(s - prevSample);
      sumDiff += diff;
      prevSample = s;
    }

    masterRms[f] = Math.sqrt(sumSq / count);
    masterDeriv[f] = sumDiff / count;

    if (drumCh0) {
      const dEnd = Math.min(drumCh0.length, end);
      const dCount = dEnd - start;
      if (dCount > 0) {
        let dSumSq = 0;
        for (let i = start; i < dEnd; i++) {
          const ds = drumCh1 ? 0.5 * (drumCh0[i] + drumCh1[i]) : drumCh0[i];
          dSumSq += ds * ds;
        }
        drumRms[f] = Math.sqrt(dSumSq / dCount);
      }
    }
  }

  // Calcular Flujo de Ataque Percusivo (Half-Wave Rectified Onset Flux)
  // Un pad o reverb sostenido tiene derivada temporal entre frames ~ 0, mientras que un golpe rítmico dispara el flux.
  for (let f = 1; f < numFrames; f++) {
    const rmsJump = Math.max(0, masterRms[f] - masterRms[f - 1]);
    const derivJump = Math.max(0, masterDeriv[f] - masterDeriv[f - 1]) * 3.5;
    let flux = rmsJump * 0.65 + derivJump * 0.35;

    if (drumCh0) {
      const drumJump = Math.max(0, drumRms[f] - drumRms[f - 1]);
      // Fusión híbrida: respeta partes melódicas del Master pero potencia los ataques de batería
      flux = flux * 0.45 + drumJump * 0.85;
    }
    onsetFlux[f] = flux;
  }

  return {
    sr,
    frameHz,
    numFrames,
    duration: masterBuffer.duration,
    masterRms,
    drumRms,
    onsetFlux,
    hasDrumAssist: Boolean(drumCh0)
  };
}

/**
 * Calcula un percentil sobre valores positivos de un Float32Array.
 */
function computePercentile(arr: Float32Array, percentile: number, minVal: number = 1e-5): number {
  const valid: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > minVal) valid.push(arr[i]);
  }
  if (valid.length === 0) return minVal;
  valid.sort((a, b) => a - b);
  const idx = Math.min(valid.length - 1, Math.max(0, Math.floor(valid.length * percentile)));
  return valid[idx];
}

/**
 * Detecta zonas de silencio prolongado (o caídas rítmicas sin pulso percusivo) y segmenta la canción
 * en Islas Rítmicas Activas.
 */
export function detectSilenceAndRhythmicIslands(
  profile: ReturnType<typeof extractRhythmicProfile>,
  approxBeatInterval: number
): RhythmicIsland[] {
  const { frameHz, numFrames, duration, masterRms, drumRms, onsetFlux, hasDrumAssist } = profile;

  const refRms = computePercentile(masterRms, 0.75, 0.003);
  const refFlux = computePercentile(onsetFlux, 0.80, 0.001);
  const refDrum = hasDrumAssist ? computePercentile(drumRms, 0.75, 0.003) : 0;

  // Ventana de suavizado corto (~250ms) para evaluar actividad local
  const smoothWin = Math.max(3, Math.round(0.25 * frameHz));
  const isFrameActive = new Uint8Array(numFrames);

  const silenceRmsThreshold = Math.max(0.004, refRms * 0.13);
  const activeFluxThreshold = Math.max(0.0008, refFlux * 0.16);
  const activeDrumThreshold = hasDrumAssist ? Math.max(0.003, refDrum * 0.12) : 0;

  for (let f = 0; f < numFrames; f++) {
    const s = Math.max(0, f - smoothWin);
    const e = Math.min(numFrames - 1, f + smoothWin);
    let maxLocalRms = 0;
    let maxLocalFlux = 0;
    let maxLocalDrum = 0;

    for (let k = s; k <= e; k++) {
      if (masterRms[k] > maxLocalRms) maxLocalRms = masterRms[k];
      if (onsetFlux[k] > maxLocalFlux) maxLocalFlux = onsetFlux[k];
      if (hasDrumAssist && drumRms[k] > maxLocalDrum) maxLocalDrum = drumRms[k];
    }

    // Un frame está en silencio prolongado / breakdown sin pulso si:
    // 1. El Master completo cayó en silencio (pausa total), O
    // 2. El flujo de ataque percusivo cayó por debajo del umbral (y la batería, si existe, también está en silencio)
    const isMasterSilent = maxLocalRms < silenceRmsThreshold;
    const isPercussionSilent = maxLocalFlux < activeFluxThreshold && (!hasDrumAssist || maxLocalDrum < activeDrumThreshold);

    isFrameActive[f] = !isMasterSilent && !isPercussionSilent ? 1 : 0;
  }

  // Duración mínima para considerar un silencio como "Silencio Prolongado" que requiere re-cálculo de fase/tempo:
  // Al menos 1.6 segundos o 3 pulsos completos.
  const minSilenceSec = Math.max(1.6, approxBeatInterval * 3.0);
  const minSilenceFrames = Math.round(minSilenceSec * frameHz);

  // Rellenar micro-huecos menores a minSilenceFrames (para no fragmentar silencios cortos de 1 o 2 tiempos del groove normal)
  let f = 0;
  while (f < numFrames) {
    if (isFrameActive[f] === 0) {
      let gapEnd = f;
      while (gapEnd < numFrames && isFrameActive[gapEnd] === 0) gapEnd++;
      const gapLen = gapEnd - f;
      if (f > 0 && gapEnd < numFrames && gapLen < minSilenceFrames) {
        for (let k = f; k < gapEnd; k++) isFrameActive[k] = 1;
      }
      f = gapEnd;
    } else {
      f++;
    }
  }

  // Extraer las Islas Rítmicas Activas (de al menos 1.2s de duración)
  const minIslandFrames = Math.round(Math.max(1.2, approxBeatInterval * 2) * frameHz);
  const rawIslands: { startFrame: number; endFrame: number }[] = [];

  f = 0;
  while (f < numFrames) {
    if (isFrameActive[f] === 1) {
      let islEnd = f;
      while (islEnd < numFrames && isFrameActive[islEnd] === 1) islEnd++;
      if (islEnd - f >= minIslandFrames) {
        rawIslands.push({ startFrame: f, endFrame: islEnd - 1 });
      }
      f = islEnd;
    } else {
      f++;
    }
  }

  if (rawIslands.length === 0) {
    return [
      {
        index: 0,
        startSec: 0,
        endSec: duration,
        reEntryTransientSec: 0,
        isPostSilence: false,
        silenceDurationBeforeSec: 0
      }
    ];
  }

  const islands: RhythmicIsland[] = [];
  for (let idx = 0; idx < rawIslands.length; idx++) {
    const current = rawIslands[idx];
    const startSec = current.startFrame / frameHz;
    const endSec = Math.min(duration, (current.endFrame + 1) / frameHz);
    const prevEndSec = idx > 0 ? rawIslands[idx - 1].endFrame / frameHz : 0;
    const silenceDurationBeforeSec = idx > 0 ? Math.max(0, startSec - prevEndSec) : 0;

    // Encontrar el transitorio exacto de re-entrada al inicio de la isla
    const searchStartF = Math.max(0, current.startFrame - Math.round(0.15 * frameHz));
    const searchEndF = Math.min(numFrames - 1, current.startFrame + Math.round(0.65 * frameHz));
    let maxPeakFlux = 0;
    for (let k = searchStartF; k <= searchEndF; k++) {
      if (onsetFlux[k] > maxPeakFlux) maxPeakFlux = onsetFlux[k];
    }

    let onsetFrame = current.startFrame;
    const triggerThreshold = Math.max(activeFluxThreshold, maxPeakFlux * 0.35);
    for (let k = searchStartF; k <= searchEndF; k++) {
      if (onsetFlux[k] >= triggerThreshold) {
        // Subir al máximo local inmediato del ataque (dentro de 40ms)
        let bestK = k;
        const localLimit = Math.min(searchEndF, k + Math.round(0.04 * frameHz));
        for (let m = k + 1; m <= localLimit; m++) {
          if (onsetFlux[m] > onsetFlux[bestK]) bestK = m;
        }
        onsetFrame = bestK;
        break;
      }
    }

    islands.push({
      index: idx,
      startSec,
      endSec,
      reEntryTransientSec: onsetFrame / frameHz,
      isPostSilence: idx > 0 && silenceDurationBeforeSec >= minSilenceSec * 0.85,
      silenceDurationBeforeSec
    });
  }

  return islands;
}

/**
 * Encuentra el pico exacto de ataque en las muestras crudas alrededor de un tiempo objetivo (±windowSec).
 */
function findExactTransientPeakSec(
  targetSec: number,
  windowSec: number,
  masterBuffer: AudioBuffer,
  drumBuffer?: AudioBuffer | null
): { peakSec: number; confidence: number } {
  const buf = drumBuffer || masterBuffer;
  const sr = buf.sampleRate;
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;

  const centerSample = Math.floor(targetSec * sr);
  const winSamples = Math.floor(windowSec * sr);
  const startSample = Math.max(1, centerSample - winSamples);
  const endSample = Math.min(ch0.length - 1, centerSample + winSamples);

  if (endSample <= startSample) {
    return { peakSec: targetSec, confidence: 0 };
  }

  // Buscar el pico de ataque combinando amplitud y derivada de alta frecuencia (transitorio percusivo)
  let maxScore = 0;
  let sumScore = 0;
  let peakSample = centerSample;

  for (let i = startSample; i < endSample; i++) {
    const s = ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i];
    const prev = ch1 ? 0.5 * (ch0[i - 1] + ch1[i - 1]) : ch0[i - 1];
    const amp = Math.abs(s);
    const attack = Math.abs(s - prev) * 4.0;
    const score = amp * 0.55 + attack * 0.45;
    sumScore += score;
    if (score > maxScore) {
      maxScore = score;
      peakSample = i;
    }
  }

  const meanScore = sumScore / Math.max(1, endSample - startSample);
  const snr = meanScore > 1e-5 ? maxScore / meanScore : 0;
  const confidence = maxScore > 0.04 && snr > 2.2 ? Math.min(1, (snr - 2.0) / 5.0) : 0;

  return {
    peakSec: peakSample / sr,
    confidence
  };
}

/**
 * Calcula el desfase circular óptimo (en segundos, dentro de [-beatInterval/2, +beatInterval/2])
 * de una isla rítmica comparando los picos reales de ataque del Master/Drums contra un ancla de referencia.
 * Esto permite que, después de un silencio de duración arbitraria, la grilla se re-enganche al 100%
 * sobre los golpes reales cuando la canción vuelve a empezar.
 */
function computeCircularPhaseOffsetForIsland(
  profile: ReturnType<typeof extractRhythmicProfile>,
  island: RhythmicIsland,
  anchorSec: number,
  beatInterval: number
): { phaseOffsetSec: number; strength: number } {
  const { frameHz, onsetFlux, numFrames } = profile;
  const startF = Math.max(1, Math.floor(island.startSec * frameHz));
  const endF = Math.min(numFrames - 2, Math.ceil(island.endSec * frameHz));

  // Analizar hasta los primeros 45 segundos de la isla (donde ocurre la re-entrada y se define el pulso)
  const analysisEndF = Math.min(endF, startF + Math.round(45 * frameHz));

  let localMax = 0;
  for (let f = startF; f <= analysisEndF; f++) {
    if (onsetFlux[f] > localMax) localMax = onsetFlux[f];
  }
  if (localMax <= 1e-5) {
    return { phaseOffsetSec: 0, strength: 0 };
  }

  const peakThreshold = localMax * 0.22;
  let sumCos = 0;
  let sumSin = 0;
  let totalWeight = 0;

  for (let f = startF; f <= analysisEndF; f++) {
    const val = onsetFlux[f];
    if (val >= peakThreshold && val >= onsetFlux[f - 1] && val >= onsetFlux[f + 1]) {
      const tSec = f / frameHz;
      const rel = (tSec - anchorSec) / beatInterval;
      const angle = 2 * Math.PI * rel;
      const weight = Math.pow(val / localMax, 1.3);
      sumCos += weight * Math.cos(angle);
      sumSin += weight * Math.sin(angle);
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0) {
    return { phaseOffsetSec: 0, strength: 0 };
  }

  const meanAngle = Math.atan2(sumSin, sumCos); // en [-PI, PI]
  const phaseOffsetSec = (meanAngle / (2 * Math.PI)) * beatInterval;
  const strength = Math.sqrt(sumCos * sumCos + sumSin * sumSin) / totalWeight;

  return { phaseOffsetSec, strength };
}

/**
 * Motor Principal: Repara, recalcula y re-sincroniza la grilla de beats tomando como referencia el Master
 * (y opcionalmente la Batería si está presente).
 */
export function repairAndRelockBeatGrid(params: {
  rawBeats: number[];
  rawDownbeats?: number[];
  rawBpm: number;
  timeSignature?: string;
  masterBuffer: AudioBuffer;
  drumBuffer?: AudioBuffer | null;
  referenceTrackName?: string;
}): BeatGridRepairResult {
  const {
    rawBeats,
    rawDownbeats = [],
    rawBpm,
    timeSignature = '4/4',
    masterBuffer,
    drumBuffer = null,
    referenceTrackName = 'Master'
  } = params;

  const beatsPerMeasure = Math.max(1, parseInt((timeSignature || '4/4').split('/')[0], 10) || 4);
  const duration = masterBuffer.duration || 600;
  const fallbackBpm = rawBpm > 0 ? rawBpm : 120;
  const approxBeatInterval = 60 / fallbackBpm;

  // 1. Extraer perfil rítmico del Master (+ Drums si existe) y detectar Islas Rítmicas separadas por Silencios Prolongados
  const profile = extractRhythmicProfile(masterBuffer, drumBuffer, 100);
  const islands = detectSilenceAndRhythmicIslands(profile, approxBeatInterval);

  // 2. Calcular el BPM real de estudio filtrando únicamente intervalos dentro de Islas Rítmicas Activas
  const sortedRawBeats = [...(rawBeats || [])].filter(t => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
  const validIntervals: number[] = [];

  for (let i = 1; i < sortedRawBeats.length; i++) {
    const t0 = sortedRawBeats[i - 1];
    const t1 = sortedRawBeats[i];
    const dt = t1 - t0;

    // Verificar que ambos beats pertenezcan a la misma Isla Rítmica Activa
    const inSameActiveIsland = islands.some(
      isl => t0 >= isl.startSec - 0.1 && t1 <= isl.endSec + 0.1
    );

    if (inSameActiveIsland && dt >= approxBeatInterval * 0.72 && dt <= approxBeatInterval * 1.32) {
      validIntervals.push(dt);
    }
  }

  let globalBeatInterval = approxBeatInterval;
  if (validIntervals.length >= 4) {
    validIntervals.sort((a, b) => a - b);
    // Media recortada intercuartil (25% - 75%) para máxima precisión de reloj
    const q1 = Math.floor(validIntervals.length * 0.25);
    const q3 = Math.ceil(validIntervals.length * 0.75);
    let sum = 0;
    let cnt = 0;
    for (let k = q1; k < q3; k++) {
      sum += validIntervals[k];
      cnt++;
    }
    if (cnt > 0) {
      globalBeatInterval = sum / cnt;
    }
  }

  // Si el BPM calculado está a menos de ±0.15 BPM de un entero o medio entero (ej. 119.94 -> 120.0), ajustarlo a reloj de estudio
  let trueBpm = 60 / globalBeatInterval;
  const nearestHalfBpm = Math.round(trueBpm * 2) / 2;
  if (Math.abs(trueBpm - nearestHalfBpm) <= 0.16) {
    trueBpm = nearestHalfBpm;
    globalBeatInterval = 60 / trueBpm;
  } else {
    trueBpm = Math.round(trueBpm * 100) / 100;
  }

  // 3. Re-calcular y Re-sincronizar CADA Isla Rítmica de forma independiente (Post-Silence Re-Lock)
  interface ProcessedIsland {
    island: RhythmicIsland;
    beats: number[];
    beatInterval: number;
    downbeatIndexInIsland: number;
  }

  const processedIslands: ProcessedIsland[] = [];
  const sortedRawDownbeats = [...rawDownbeats].filter(t => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);

  for (let idx = 0; idx < islands.length; idx++) {
    const isl = islands[idx];
    const islRawBeats = sortedRawBeats.filter(
      t => t >= isl.startSec - 0.18 && t <= isl.endSec + 0.18
    );

    // 3A. Calcular el intervalo de beat local de esta isla (por si hubo cambio de tempo tras el silencio)
    let islBeatInterval = globalBeatInterval;
    if (islRawBeats.length >= 6) {
      const localDts: number[] = [];
      for (let i = 1; i < islRawBeats.length; i++) {
        const dt = islRawBeats[i] - islRawBeats[i - 1];
        if (dt >= globalBeatInterval * 0.75 && dt <= globalBeatInterval * 1.28) {
          localDts.push(dt);
        }
      }
      if (localDts.length >= 4) {
        localDts.sort((a, b) => a - b);
        const mid = localDts[Math.floor(localDts.length / 2)];
        // Si difiere menos de 2.2% del tempo global de estudio, mantener el reloj maestro; si cambió de verdad, usar el nuevo tempo
        if (Math.abs(mid - globalBeatInterval) / globalBeatInterval > 0.022) {
          islBeatInterval = mid;
        }
      }
    }

    // 3B. Determinar el ancla de fase real dentro de la isla usando los transitorios físicos del Master/Drums
    let baseAnchor = islRawBeats.length > 0 ? islRawBeats[0] : isl.reEntryTransientSec;
    const { phaseOffsetSec, strength } = computeCircularPhaseOffsetForIsland(
      profile,
      isl,
      baseAnchor,
      islBeatInterval
    );

    if (strength > 0.12) {
      baseAnchor += phaseOffsetSec;
    }

    // Si es una isla post-silencio, verificar que el primer pulso cubra desde el transitorio exacto de re-entrada
    while (baseAnchor - islBeatInterval >= isl.reEntryTransientSec - islBeatInterval * 0.35) {
      baseAnchor -= islBeatInterval;
    }
    while (baseAnchor < isl.startSec - islBeatInterval * 0.35) {
      baseAnchor += islBeatInterval;
    }

    // Ajuste fino con los primeros 16 golpes físicos de la isla (ventana ±85ms)
    const fineOffsets: number[] = [];
    for (let k = 0; k < 16; k++) {
      const probeSec = baseAnchor + k * islBeatInterval;
      if (probeSec > isl.endSec) break;
      const { peakSec, confidence } = findExactTransientPeakSec(
        probeSec,
        Math.min(0.085, islBeatInterval * 0.22),
        masterBuffer,
        drumBuffer
      );
      if (confidence > 0.25) {
        fineOffsets.push(peakSec - probeSec);
      }
    }

    if (fineOffsets.length >= 2) {
      fineOffsets.sort((a, b) => a - b);
      const medianFineOffset = fineOffsets[Math.floor(fineOffsets.length / 2)];
      baseAnchor += medianFineOffset;
    } else if (isl.isPostSilence) {
      // Si la isla post-silencio empieza con un golpe claro, afinar sobre ese ataque inicial
      const { peakSec, confidence } = findExactTransientPeakSec(
        baseAnchor,
        Math.min(0.11, islBeatInterval * 0.28),
        masterBuffer,
        drumBuffer
      );
      if (confidence > 0.2) {
        baseAnchor = peakSec;
      }
    }

    // 3C. Construir los beats limpios y re-sincronizados de esta isla
    const islBeats: number[] = [];
    let tCursor = baseAnchor;
    while (tCursor <= isl.endSec + islBeatInterval * 0.15) {
      if (tCursor >= Math.max(0, isl.startSec - islBeatInterval * 0.25)) {
        // Micro-tracking híbrido: 75% reloj de estudio + 25% ataque físico local si hay alta confianza (±28ms)
        const { peakSec, confidence } = findExactTransientPeakSec(
          tCursor,
          0.028,
          masterBuffer,
          drumBuffer
        );
        const snapped = confidence > 0.45 ? tCursor * 0.75 + peakSec * 0.25 : tCursor;
        islBeats.push(snapped);
      }
      tCursor += islBeatInterval;
    }

    if (islBeats.length === 0) continue;

    // 3D. Determinar qué índice dentro de islBeats es el Pulso 1 (Downbeat) de esta isla
    let downbeatIndexInIsland = 0;
    const islRawDownbeats = sortedRawDownbeats.filter(
      d => d >= islBeats[0] - islBeatInterval * 0.5 && d <= islBeats[islBeats.length - 1] + islBeatInterval * 0.5
    );

    if (isl.isPostSilence) {
      // Cuando la canción vuelve a empezar tras un silencio prolongado:
      // Si Sakemin detectó downbeats en esta nueva isla, votar por el módulo de compás;
      // pero si el primer golpe de re-entrada (índice 0) es un ataque fuerte de inicio de sección, priorizar índice 0.
      const firstBeatTransient = findExactTransientPeakSec(islBeats[0], 0.05, masterBuffer, drumBuffer);
      if (firstBeatTransient.confidence >= 0.45 || islRawDownbeats.length === 0) {
        downbeatIndexInIsland = 0;
      } else {
        const modVotes = new Array(beatsPerMeasure).fill(0);
        for (const db of islRawDownbeats) {
          let nearestIdx = 0;
          let minDiff = Infinity;
          for (let bIdx = 0; bIdx < islBeats.length; bIdx++) {
            const diff = Math.abs(islBeats[bIdx] - db);
            if (diff < minDiff) {
              minDiff = diff;
              nearestIdx = bIdx;
            }
          }
          if (minDiff < islBeatInterval * 0.45) {
            modVotes[nearestIdx % beatsPerMeasure]++;
          }
        }
        let bestMod = 0;
        for (let m = 1; m < beatsPerMeasure; m++) {
          if (modVotes[m] > modVotes[bestMod]) bestMod = m;
        }
        downbeatIndexInIsland = bestMod;
      }
    } else if (islRawDownbeats.length > 0) {
      // Para la primera isla (inicio de la canción), usar el voto mayoritario de los downbeats de la IA
      const modVotes = new Array(beatsPerMeasure).fill(0);
      for (const db of islRawDownbeats) {
        let nearestIdx = 0;
        let minDiff = Infinity;
        for (let bIdx = 0; bIdx < islBeats.length; bIdx++) {
          const diff = Math.abs(islBeats[bIdx] - db);
          if (diff < minDiff) {
            minDiff = diff;
            nearestIdx = bIdx;
          }
        }
        if (minDiff < islBeatInterval * 0.45) {
          modVotes[nearestIdx % beatsPerMeasure]++;
        }
      }
      let bestMod = 0;
      for (let m = 1; m < beatsPerMeasure; m++) {
        if (modVotes[m] > modVotes[bestMod]) bestMod = m;
      }
      downbeatIndexInIsland = bestMod;
    }

    processedIslands.push({
      island: isl,
      beats: islBeats,
      beatInterval: islBeatInterval,
      downbeatIndexInIsland
    });
  }

  // Fallback de seguridad si no se pudo construir ninguna isla
  if (processedIslands.length === 0) {
    const fallbackBeats = sortedRawBeats.length > 0 ? [...sortedRawBeats] : [0];
    return {
      bpm: Math.round(trueBpm),
      beatTimes: fallbackBeats,
      downbeats: sortedRawDownbeats,
      firstBeatOffset: sortedRawDownbeats[0] || fallbackBeats[0] || 0,
      islandsDetected: 1,
      silencesRepaired: 0,
      referenceTrackName,
      usedDrumAssist: profile.hasDrumAssist,
      telemetrySummary: `Tempo ${Math.round(trueBpm)} BPM`
    };
  }

  // 4. Ensamblar todas las Islas Rítmicas y construir los Puentes de Silencio Matemáticos ("Silence Bridges")
  // Garantizando que al terminar cada silencio prolongado:
  //  - El compás de cuenta regresiva previo a la re-entrada (ej. "CORO, 2, 3, 4") esté al tempo exacto de la re-entrada.
  //  - El número total de pulsos mantenga la fase del compás (1-2-3-4) para que el Pulso 1 (clic agudo) nunca quede invertido.
  const finalBeats: number[] = [];
  let currentDownbeatMod = processedIslands[0].downbeatIndexInIsland % beatsPerMeasure;
  let silencesRepaired = 0;

  for (let pIdx = 0; pIdx < processedIslands.length; pIdx++) {
    const currentIsl = processedIslands[pIdx];

    if (pIdx === 0) {
      for (const b of currentIsl.beats) {
        finalBeats.push(b);
      }
      continue;
    }

    const prevBeat = finalBeats[finalBeats.length - 1];
    const nextFirstBeat = currentIsl.beats[0];
    const gap = nextFirstBeat - prevBeat;
    const bridgeInterval = currentIsl.beatInterval;

    if (gap <= bridgeInterval * 0.55) {
      // Islas prácticamente contiguas
      for (let k = 1; k < currentIsl.beats.length; k++) {
        finalBeats.push(currentIsl.beats[k]);
      }
      continue;
    }

    silencesRepaired++;

    // Fase de compás actual en prevBeat (0 = pulso 1, 1 = pulso 2, ...)
    const prevIdx = finalBeats.length - 1;
    const prevMeasureBeat = (((prevIdx - currentDownbeatMod) % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;

    // Queremos que el beat `currentIsl.beats[currentIsl.downbeatIndexInIsland]` sea Pulso 1 (measureBeat === 0),
    // lo cual equivale a que `nextFirstBeat` (índice 0 de currentIsl) tenga fase:
    const targetNextFirstMeasureBeat =
      (((-currentIsl.downbeatIndexInIsland) % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;

    const rawSteps = Math.max(1, Math.round(gap / bridgeInterval));

    // Buscar el número de pasos `alignedSteps >= 1` más cercano a `rawSteps` que preserve la fase 1-2-3-4
    let alignedSteps = rawSteps;
    let bestStepDiff = Infinity;
    for (let candidate = Math.max(1, rawSteps - beatsPerMeasure); candidate <= rawSteps + beatsPerMeasure; candidate++) {
      const resultingPhase = (prevMeasureBeat + candidate) % beatsPerMeasure;
      if (resultingPhase === targetNextFirstMeasureBeat) {
        const diff = Math.abs(candidate - rawSteps);
        if (diff < bestStepDiff) {
          bestStepDiff = diff;
          alignedSteps = candidate;
        }
      }
    }

    // Si el silencio es lo bastante largo para tener al menos 1 compás completo de puente + margen (> beatsPerMeasure + 2 pasos)
    // y hubo una pausa libre / no cuantizada en el Master, reservamos el último compás antes de `nextFirstBeat`
    // al tempo 100% exacto `bridgeInterval` (para que el conteo "1, 2, 3, 4" de re-entrada sea perfecto),
    // y distribuimos la diferencia de la pausa libre en la primera mitad del silencio donde nadie toca.
    const isExactGridSilence = Math.abs(gap - alignedSteps * bridgeInterval) <= 0.045;

    if (!isExactGridSilence && alignedSteps > beatsPerMeasure + 2 && gap > (beatsPerMeasure + 1.5) * bridgeInterval) {
      const leadInSteps = beatsPerMeasure;
      const leadInStartSec = nextFirstBeat - leadInSteps * bridgeInterval;
      const earlySilenceSteps = alignedSteps - leadInSteps;
      const earlyGap = leadInStartSec - prevBeat;

      // Primera parte del silencio (absorbe cualquier pausa libre del Master)
      for (let s = 1; s <= earlySilenceSteps; s++) {
        finalBeats.push(prevBeat + (s * earlyGap) / earlySilenceSteps);
      }
      // Último compás de cuenta regresiva antes de que empiece nuevamente la canción: tempo 100% exacto
      for (let s = 1; s < leadInSteps; s++) {
        finalBeats.push(leadInStartSec + s * bridgeInterval);
      }
    } else {
      // Interpolación limpia de `alignedSteps` pulsos a través del silencio
      for (let s = 1; s < alignedSteps; s++) {
        finalBeats.push(prevBeat + (s * gap) / alignedSteps);
      }
    }

    // Agregar todos los beats re-sincronizados de la nueva isla
    for (const b of currentIsl.beats) {
      finalBeats.push(b);
    }
  }

  // 5. Extrapolar limpiamente hacia el inicio (0.0s) y hacia el final de la canción
  const firstIslInterval = processedIslands[0].beatInterval;
  let unshiftedAtStart = 0;
  let firstBeat = finalBeats[0];
  while (firstBeat - firstIslInterval >= 0) {
    firstBeat -= firstIslInterval;
    finalBeats.unshift(firstBeat);
    unshiftedAtStart++;
  }

  const finalDownbeatIndex = (currentDownbeatMod + unshiftedAtStart) % beatsPerMeasure;

  const lastIslInterval = processedIslands[processedIslands.length - 1].beatInterval;
  let lastBeat = finalBeats[finalBeats.length - 1];
  const maxTargetSec = Math.max(duration + 10, 600);
  while (lastBeat + lastIslInterval <= maxTargetSec) {
    lastBeat += lastIslInterval;
    finalBeats.push(lastBeat);
  }

  // Construir el arreglo explícito de Downbeats (Pulso 1 de cada compás) y el firstBeatOffset
  const finalDownbeats: number[] = [];
  for (let i = 0; i < finalBeats.length; i++) {
    if (((i - finalDownbeatIndex) % beatsPerMeasure + beatsPerMeasure) % beatsPerMeasure === 0) {
      finalDownbeats.push(finalBeats[i]);
    }
  }

  const firstBeatOffset = finalDownbeats.length > 0 ? finalDownbeats[0] : (finalBeats[0] || 0);
  const roundedBpm = Math.round(trueBpm * 10) / 10;
  const displayBpm = Number.isInteger(roundedBpm) ? roundedBpm : Math.round(trueBpm);

  const assistTag = profile.hasDrumAssist ? `${referenceTrackName} + Drums` : referenceTrackName;
  const telemetrySummary =
    silencesRepaired > 0
      ? `¡Tempo (${displayBpm} BPM) y Grilla IA guardados! (${silencesRepaired} ${
          silencesRepaired === 1 ? 'silencio largo re-sincronizado' : 'silencios largos re-sincronizados'
        } con ${assistTag})`
      : `¡Tempo (${displayBpm} BPM) y Grilla de alta precisión sincronizados con ${assistTag}!`;

  return {
    bpm: displayBpm,
    beatTimes: finalBeats,
    downbeats: finalDownbeats,
    firstBeatOffset,
    islandsDetected: processedIslands.length,
    silencesRepaired,
    referenceTrackName,
    usedDrumAssist: profile.hasDrumAssist,
    telemetrySummary
  };
}

/**
 * Codifica dos canales estéreo Float32Array en un archivo WAV PCM de 16 bits.
 */
function encodeWav16Stereo(chL: Float32Array, chR: Float32Array, sr: number): Blob {
  const numSamples = chL.length;
  const numChannels = 2;
  const bytesPerSample = 2;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const int16View = new Int16Array(buffer, 44);
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, chL[i]));
    const r = Math.max(-1, Math.min(1, chR[i]));
    int16View[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
    int16View[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Codifica dos canales estéreo Float32Array en MP3 320 kbps usando lamejs (con fallback a WAV si falla).
 */
async function encodeMasterMp3OrWav(
  chL: Float32Array,
  chR: Float32Array,
  sr: number
): Promise<{ blob: Blob; mimeType: string; extension: 'mp3' | 'wav' }> {
  try {
    if (!(window as any).lamejs) {
      const lamejsSrc = await import('lamejs/lame.all.js?raw');
      const script = document.createElement('script');
      script.innerHTML = lamejsSrc.default + '\nwindow.lamejs = lamejs;';
      document.head.appendChild(script);
    }
    const lamejs = (window as any).lamejs;
    if (lamejs && lamejs.Mp3Encoder) {
      const encoder = new lamejs.Mp3Encoder(2, sr, 320);
      const sampleBlockSize = 1152;
      const mp3Data: BlobPart[] = [];
      const leftChunk16 = new Int16Array(sampleBlockSize);
      const rightChunk16 = new Int16Array(sampleBlockSize);

      let sampleOffset = 0;
      while (sampleOffset < chL.length) {
        const length = Math.min(sampleBlockSize, chL.length - sampleOffset);
        const lSub = length === sampleBlockSize ? leftChunk16 : new Int16Array(length);
        const rSub = length === sampleBlockSize ? rightChunk16 : new Int16Array(length);

        for (let i = 0; i < length; i++) {
          const sL = Math.max(-1, Math.min(1, chL[sampleOffset + i]));
          const sR = Math.max(-1, Math.min(1, chR[sampleOffset + i]));
          lSub[i] = sL < 0 ? sL * 0x8000 : sL * 0x7fff;
          rSub[i] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
        }

        const mp3buf = encoder.encodeBuffer(lSub, rSub);
        if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
        sampleOffset += sampleBlockSize;
      }

      const flushBuf = encoder.flush();
      if (flushBuf.length > 0) mp3Data.push(new Int8Array(flushBuf));

      return {
        blob: new Blob(mp3Data, { type: 'audio/mpeg' }),
        mimeType: 'audio/mpeg',
        extension: 'mp3'
      };
    }
  } catch (err) {
    console.warn('[beatGridDSP] Fallback a WAV en generación de Master:', err);
  }

  return {
    blob: encodeWav16Stereo(chL, chR, sr),
    mimeType: 'audio/wav',
    extension: 'wav'
  };
}

/**
 * Mezcla todos los tracks musicales del proyecto actual en un archivo Master 100% fiel
 * (mismo tempo, mismo tono, alineación exacta al sample 0 y normalización limpia a -0.5 dBFS)
 * ideal para proyectos que no cuentan con pista Master para el cálculo de Tempo, Grilla y Acordes IA.
 */
export async function mixProjectStemsToMasterBlob(
  stems: any[],
  onProgress?: (msg: string) => void
): Promise<{
  blob: Blob;
  mimeType: string;
  extension: 'mp3' | 'wav';
  durationSeconds: number;
  tracksMixed: number;
}> {
  // 1. Filtrar pistas válidas: excluir masters previos, copias DSP y pistas de clic/guía hablada
  const validStems = (stems || []).filter(s => s && (s.file_url || s.url) && !s.metadata?.dsp_watermark);
  const nonMasterStems = validStems.filter(
    s => !s.metadata?.is_master && !isMasterTrackByName(s.name || '')
  );
  const pool = nonMasterStems.length > 0 ? nonMasterStems : validStems;

  const musicalStems = pool.filter(s => {
    const n = (s.name || '').toLowerCase();
    const icon = (s.metadata?.instrument_icon || '').toLowerCase();
    if (icon === 'click' || icon === 'guide') return false;
    return !/\b(click|metronomo|metrónomo|guia|guía|cue|cues)\b/i.test(n);
  });

  const tracksToMix = musicalStems.length > 0 ? musicalStems : pool;
  if (tracksToMix.length === 0) {
    throw new Error('No hay pistas de audio válidas en el proyecto para mezclar.');
  }

  const targetSr = 44100;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx: AudioContext = new AudioCtx({ sampleRate: targetSr });

  let maxLen = 0;
  const decodedBuffers: AudioBuffer[] = [];

  try {
    for (let i = 0; i < tracksToMix.length; i++) {
      const st = tracksToMix[i];
      const url = st.file_url || st.url;
      onProgress?.(
        `Creando Master (1/3): Decodificando pista ${i + 1}/${tracksToMix.length} ("${st.name}")...`
      );
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`No se pudo descargar la pista "${st.name}" (${res.status})`);
      }
      const ab = await res.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(ab.slice(0));
      if (decoded.length > maxLen) maxLen = decoded.length;
      decodedBuffers.push(decoded);
    }
  } finally {
    try {
      if (audioCtx.state !== 'closed') await audioCtx.close();
    } catch (_) {
      // ignore
    }
  }

  if (maxLen === 0 || decodedBuffers.length === 0) {
    throw new Error('Las pistas decodificadas están vacías.');
  }

  onProgress?.(`Creando Master (2/3): Mezclando y balanceando ${decodedBuffers.length} pistas en estéreo...`);
  await new Promise(r => setTimeout(r, 15));

  const mixL = new Float32Array(maxLen);
  const mixR = new Float32Array(maxLen);

  for (const buf of decodedBuffers) {
    const bL = buf.getChannelData(0);
    const bR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : bL;
    const len = bL.length;
    for (let i = 0; i < len; i++) {
      mixL[i] += bL[i];
      mixR[i] += bR[i];
    }
  }

  // Normalización transparente de estudio a -0.5 dBFS (0.944) para evitar saturación al sumar múltiples pistas
  let maxPeak = 0;
  for (let i = 0; i < maxLen; i++) {
    const absL = Math.abs(mixL[i]);
    const absR = Math.abs(mixR[i]);
    if (absL > maxPeak) maxPeak = absL;
    if (absR > maxPeak) maxPeak = absR;
  }

  if (maxPeak > 1e-5) {
    const targetCeiling = 0.944; // -0.5 dBFS
    const normGain = targetCeiling / maxPeak;
    for (let i = 0; i < maxLen; i++) {
      mixL[i] *= normGain;
      mixR[i] *= normGain;
    }
  }

  onProgress?.(`Creando Master (3/3): Codificando archivo Master de referencia...`);
  await new Promise(r => setTimeout(r, 15));

  const encoded = await encodeMasterMp3OrWav(mixL, mixR, targetSr);
  const durationSeconds = Math.round(maxLen / targetSr);

  return {
    blob: encoded.blob,
    mimeType: encoded.mimeType,
    extension: encoded.extension,
    durationSeconds,
    tracksMixed: decodedBuffers.length
  };
}
