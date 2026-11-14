import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const replicateToken = process.env.REPLICATE_API_TOKENstems || process.env.VITE_REPLICATE_API_TOKENstems || process.env.REPLICATE_API_TOKEN || process.env.VITE_REPLICATE_API_TOKEN;
const replicate = new Replicate({
  auth: replicateToken,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { songId, stems, ghostUrl } = req.body;
    
    if (!songId) return res.status(400).json({ error: 'Falta songId' });
    if (!stems || stems.length === 0) return res.status(404).json({ error: 'No stems' });

    let finalAudioUrl = ghostUrl;

    if (!finalAudioUrl) {
      const isolatedKeywords = [
        'drum', 'drums', 'bateria', 'batería', 'perc', 'kick', 'snare', 'bombo',
        'bass', 'bajo', 'vocal', 'vocals', 'voz', 'voces', 'guitar', 'guitarra',
        'piano', 'keys', 'teclado', 'synth', 'pad', 'strings', 'click', 'metronomo', 'guia', 'other'
      ];
      const isMasterByName = (rawName: string = '') => {
        const lower = rawName.replace(/\.(wav|mp3|ogg|flac|m4a|aac)$/i, '').trim().toLowerCase();
        const paren = lower.match(/\(([^)]+)\)\s*$/);
        if (paren && isolatedKeywords.some(k => paren[1].includes(k))) return false;
        if (!lower.includes('master') && !lower.includes('mezcla') && !lower.includes('full mix')) return false;
        const tail = lower.split(/[\s_\-]+/).pop() || '';
        if (tail !== 'master' && isolatedKeywords.some(k => tail === k)) return false;
        return true;
      };

      // Filtrar pistas con varispeed/DSP watermark para no alterar nunca el BPM real de la canción
      const cleanPool = stems.filter(
        (s: any) => !s.metadata?.dsp_watermark && !(s.name || '').includes('Master Remezclado')
      );
      const pool = cleanPool.length > 0 ? cleanPool : stems;

      // 1. Preferir siempre la pista Maestra (★ Master explícito o archivo con la palabra "Master")
      let selectedStem = pool.find((s: any) => s.metadata && s.metadata.is_master === true);
      if (!selectedStem) selectedStem = pool.find((s: any) => isMasterByName(s.name || ''));
      if (!selectedStem) selectedStem = pool.find((s: any) => (s.name || '').toLowerCase().includes('master') || (s.name || '').toLowerCase().includes('mezcla'));
      // 2. Fallback a batería o metrónomo si no hay master
      if (!selectedStem) selectedStem = pool.find((s: any) => (s.name || '').toLowerCase().includes('drum') || (s.name || '').toLowerCase().includes('bateria') || (s.name || '').toLowerCase().includes('batería'));
      if (!selectedStem) selectedStem = pool.find((s: any) => (s.name || '').toLowerCase().includes('click') || (s.name || '').toLowerCase().includes('metronomo'));
      // 3. Último recurso, cualquier pista
      if (!selectedStem) selectedStem = pool[0];
      finalAudioUrl = selectedStem.file_url || selectedStem.url;
      console.log(`[IA-Beats] Iniciando Replicate Async... Stem: ${selectedStem.name}`);
    } else {
      console.log(`[IA-Beats] Iniciando Replicate Async con Ghost Mix... URL: ${finalAudioUrl}`);
    }

    // Call Sakemin All-In-One model with retry logic for 502/503 errors
    let prediction;
    let retries = 3;
    while (retries > 0) {
      try {
        prediction = await replicate.predictions.create({
          version: "001b4137be6ac67bdc28cb5cffacf128b874f530258d033de23121e785cb7290", 
          input: {
            music_input: finalAudioUrl,
            include_embeddings: false,
            include_activations: false,
            model: "harmonix-all"
          }
        });
        break; // Success
      } catch (err: any) {
        if (err.message && err.message.includes('502') && retries > 1) {
          console.warn(`[IA-Beats] Replicate 502 error. Retrying in 3 seconds... (${retries - 1} retries left)`);
          await new Promise(res => setTimeout(res, 3000));
          retries--;
        } else {
          throw err;
        }
      }
    }

    if (!prediction) {
      throw new Error('No se pudo crear la predicción de beats');
    }

    return res.status(200).json({ 
      success: true, 
      predictionId: prediction.id,
      message: 'Iniciado el análisis de beats'
    });

  } catch (error: any) {
    console.error('[IA-Beats] Error en endpoint beats.ts:', error);
    return res.status(500).json({ error: error.message });
  }
}
