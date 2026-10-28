export type CueBuffersMap = Record<string, AudioBuffer>;
export type CueOffsetsMap = Record<string, number>;

export const CUE_NAMES = ['intro', 'verso', 'pre-coro', 'coro', 'puente', 'solo', 'final', '1', '2', '3', '4'];

// Genera un transitorio de clic puro en RAM
export const generateClickBuffer = (ctx: BaseAudioContext, frequency: number): AudioBuffer => {
  const sampleRate = ctx.sampleRate;
  const duration = 0.05;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 80);
    data[i] = Math.cos(2 * Math.PI * frequency * t) * env * 0.8;
  }
  return buffer;
};

// Resolver de forma inteligente el archivo de voz guía según el nombre de sección (Español / Inglés)
export const resolveCueBufferName = (rawName: string, cueBuffers: Record<string, any>): string => {
  const lower = (rawName || '').toLowerCase().trim();
  if (cueBuffers[lower]) return lower;
  if (lower.includes('intro') && cueBuffers['intro']) return 'intro';
  if ((lower.includes('pre-coro') || lower.includes('precoro') || lower.includes('pre chorus') || lower.includes('prechorus')) && cueBuffers['pre-coro']) return 'pre-coro';
  if ((lower.includes('coro') || lower.includes('chorus')) && cueBuffers['coro']) return 'coro';
  if ((lower.includes('verso') || lower.includes('verse')) && cueBuffers['verso']) return 'verso';
  if ((lower.includes('puente') || lower.includes('bridge')) && cueBuffers['puente']) return 'puente';
  if (lower.includes('solo') && cueBuffers['solo']) return 'solo';
  if ((lower.includes('final') || lower.includes('outro') || lower.includes('ending')) && cueBuffers['final']) return 'final';
  return '';
};

// Pre-cargar todas las voces de voz guía desde /cues/*.mp3
export const loadCueBuffers = async (audioCtx: BaseAudioContext): Promise<{ cueBuffers: CueBuffersMap; cueOffsets: CueOffsetsMap }> => {
  const cueBuffers: CueBuffersMap = {};
  const cueOffsets: CueOffsetsMap = {};

  await Promise.all(
    CUE_NAMES.map(async (name) => {
      try {
        const res = await fetch(`/cues/${name}.mp3`);
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          cueBuffers[name] = audioBuffer;

          // Auto-Trim: Detectar el inicio real de la voz para saltar el silencio (padding del MP3)
          const data = audioBuffer.getChannelData(0);
          let startSample = 0;
          for (let i = 0; i < data.length; i++) {
            if (Math.abs(data[i]) > 0.05) {
              startSample = Math.max(0, i - Math.floor(audioBuffer.sampleRate * 0.005));
              break;
            }
          }
          cueOffsets[name] = startSample / audioBuffer.sampleRate;
        }
      } catch (e) {
        console.warn(`[cueEngine] No se pudo cargar voz guía /cues/${name}.mp3:`, e);
      }
    })
  );

  return { cueBuffers, cueOffsets };
};

// Programador unificado de Guías de Voz: Coloca el conteo en el compás inmediatamente previo al inicio de la sección
export const scheduleSectionVoiceCues = (
  sections: any[] | undefined,
  bTimes: number[],
  beatsPerMeasure: number,
  preRollDuration: number,
  cueBuffers: Record<string, any>,
  schedule: (bufName: string, beatIndex: number) => void
) => {
  if (!bTimes || bTimes.length === 0 || beatsPerMeasure <= 0) return;

  const scheduledBeats = new Set<number>();

  // 1. Encontrar el índice de beat donde arranca físicamente la música (t = preRollDuration)
  let songStartBeatIdx = 0;
  let minStartDiff = Infinity;
  for (let i = 0; i < bTimes.length; i++) {
    const diff = Math.abs(bTimes[i] - preRollDuration);
    if (diff < minStartDiff) {
      minStartDiff = diff;
      songStartBeatIdx = i;
    }
  }

  // 2. Programar cues para todas las secciones válidas
  const validSections = (sections || []).filter((s: any) => typeof s.time === 'number');
  let hasHandledSongStart = false;

  validSections.forEach((section: any) => {
    const secTime = section.time + preRollDuration;
    let nearestBeatIdx = -1;
    let minDiff = Infinity;
    for (let i = 0; i < bTimes.length; i++) {
      const diff = Math.abs(bTimes[i] - secTime);
      if (diff < minDiff) {
        minDiff = diff;
        nearestBeatIdx = i;
      }
    }

    if (minDiff > 1.2 || nearestBeatIdx < beatsPerMeasure) return;

    // El compás de conteo previo inicia exactamente 1 compás antes del downbeat de la sección
    const leadInStartIdx = nearestBeatIdx - beatsPerMeasure;
    const resolvedName = resolveCueBufferName(section.name || section.section || '', cueBuffers);

    // Pulso 1 del compás de conteo: Nombre de sección (e.g. "Intro", "Coro") o '1' si no existe audio específico
    const beat1Cue = resolvedName || '1';
    if (!scheduledBeats.has(leadInStartIdx)) {
      schedule(beat1Cue, leadInStartIdx);
      scheduledBeats.add(leadInStartIdx);
    }

    // Pulsos 2 .. beatsPerMeasure en conteo progresivo natural: '2', '3', '4' hacia el golpe 1
    for (let b = 2; b <= beatsPerMeasure; b++) {
      const bIdx = leadInStartIdx + (b - 1);
      const cueNum = String(b);
      if (cueBuffers[cueNum] && !scheduledBeats.has(bIdx)) {
        schedule(cueNum, bIdx);
        scheduledBeats.add(bIdx);
      }
    }

    if (Math.abs(nearestBeatIdx - songStartBeatIdx) <= 1) {
      hasHandledSongStart = true;
    }
  });

  // 3. Fallback inteligente: Si no hay sección creada al inicio (t = preRollDuration),
  // programar el conteo previo para que el tema no comience en seco sin aviso
  if (!hasHandledSongStart && songStartBeatIdx >= beatsPerMeasure) {
    const leadInStartIdx = songStartBeatIdx - beatsPerMeasure;
    const defaultCue = cueBuffers['intro'] ? 'intro' : '1';
    if (!scheduledBeats.has(leadInStartIdx)) {
      schedule(defaultCue, leadInStartIdx);
      scheduledBeats.add(leadInStartIdx);
    }
    for (let b = 2; b <= beatsPerMeasure; b++) {
      const bIdx = leadInStartIdx + (b - 1);
      const cueNum = String(b);
      if (cueBuffers[cueNum] && !scheduledBeats.has(bIdx)) {
        schedule(cueNum, bIdx);
        scheduledBeats.add(bIdx);
      }
    }
  }
};

// Sintetizador en tiempo real de pista CUE (Clic + Voz Guía) en RAM
export const synthesizeLiveCueBuffer = async (
  audioCtx: AudioContext,
  prompterData: any,
  totalDuration: number,
  cueBuffers: Record<string, AudioBuffer>,
  cueOffsets: Record<string, number>,
  volume: number = 0.9
): Promise<AudioBuffer> => {
  const bpm = prompterData?.bpm || 120;
  const timeSignature = prompterData?.timeSignature || '4/4';
  const beatsPerMeasure = parseInt(timeSignature.split('/')[0]) || 4;
  const secondsPerBeat = 60 / bpm;
  const preRollDuration = Math.min((secondsPerBeat * beatsPerMeasure) * 2, 16);

  const sampleRate = audioCtx.sampleRate;
  const lengthSeconds = Math.max(totalDuration, preRollDuration + 5);
  const lengthSamples = Math.ceil(lengthSeconds * sampleRate);

  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);

  const clickHighBuffer = generateClickBuffer(offlineCtx, 1000);
  const clickLowBuffer = generateClickBuffer(offlineCtx, 600);

  const beatInterval = 60 / bpm;
  let shiftedBeatTimes: number[] = [];
  let unshiftedCount = 0;

  if (prompterData?.beatTimes && prompterData.beatTimes.length > 0) {
    let bTimes = [...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
    let firstBeat = bTimes[0];
    while (firstBeat - beatInterval >= 0) {
      firstBeat -= beatInterval;
      bTimes.unshift(firstBeat);
      unshiftedCount++;
    }
    let lastBeat = bTimes[bTimes.length - 1];
    while (lastBeat + beatInterval <= lengthSeconds + 2) {
      lastBeat += beatInterval;
      bTimes.push(lastBeat);
    }
    shiftedBeatTimes = bTimes;
  } else {
    const startOffset = (prompterData?.firstBeatOffset || 0);
    for (let t = 0; t <= lengthSeconds; t += beatInterval) {
      const adjusted = t + startOffset;
      if (adjusted >= 0) shiftedBeatTimes.push(adjusted);
    }
  }

  // 1. Programar Clics de Metrónomo
  let downbeatIndex = 0;
  if (prompterData?.beatTimes && prompterData.beatTimes.length > 0) {
    downbeatIndex = prompterData.beatTimes.findIndex((t: number) => Math.abs(t - (prompterData.firstBeatOffset || 0)) < 0.05);
    if (downbeatIndex === -1) downbeatIndex = 0;
    downbeatIndex += unshiftedCount;
  }

  let beatCount = 0;
  for (const time of shiftedBeatTimes) {
    if (time >= 0 && time < lengthSeconds) {
      const measureBeat = (beatCount - downbeatIndex) % beatsPerMeasure;
      const normalizedMeasureBeat = ((measureBeat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
      const isHigh = normalizedMeasureBeat === 0;
      const buffer = isHigh ? clickHighBuffer : clickLowBuffer;

      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      const gain = offlineCtx.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(offlineCtx.destination);
      source.start(time);
    }
    beatCount++;
  }

  // 2. Programar Guías de Voz (Secciones y Conteo)
  const scheduleCue = (bufName: string, bIdx: number) => {
    const buf = cueBuffers[bufName];
    const cueOffset = cueOffsets[bufName] || 0;
    if (buf && bIdx >= 0 && bIdx < shiftedBeatTimes.length) {
      const absoluteTime = shiftedBeatTimes[bIdx];
      if (absoluteTime >= 0 && absoluteTime < lengthSeconds) {
        const source = offlineCtx.createBufferSource();
        source.buffer = buf;
        const gain = offlineCtx.createGain();
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(offlineCtx.destination);
        source.start(absoluteTime, cueOffset);
      }
    }
  };

  scheduleSectionVoiceCues(
    prompterData?.sections,
    shiftedBeatTimes,
    beatsPerMeasure,
    preRollDuration,
    cueBuffers,
    scheduleCue
  );

  return await offlineCtx.startRendering();
};
