import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const token =
  process.env.REPLICATE_API_TOKEN ||
  process.env.VITE_REPLICATE_API_TOKEN ||
  process.env.REPLICATE_API_STEMS ||
  process.env.VITE_REPLICATE_API_STEMS;
const replicate = new Replicate({ auth: token });

// "owner/name" del modelo publicado por .github/workflows/replicate.yml
const MODEL = process.env.REPLICATE_WATERMARK_MODEL || 'pagaforr-droid/tandu-watermark';
// Opcional: fijar una versión concreta (si no, se usa la última publicada)
const PINNED_VERSION = process.env.REPLICATE_WATERMARK_VERSION;

const FORMATS = ['wav', 'flac', 'mp3'] as const;

async function resolveVersion(): Promise<string> {
  if (PINNED_VERSION) return PINNED_VERSION;
  const [owner, name] = MODEL.split('/');
  const model: any = await replicate.models.get(owner, name);
  const id = model?.latest_version?.id;
  if (!id) {
    throw new Error(`El modelo ${MODEL} no tiene versiones publicadas en Replicate. Ejecuta el workflow "Push to Replicate".`);
  }
  return id;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!token) return res.status(500).json({ error: 'Falta REPLICATE_API_TOKEN en las variables de entorno' });

  try {
    const { audioUrl, uploadUrl, jobId, outputFormat } = req.body || {};
    if (!audioUrl || typeof audioUrl !== 'string') {
      return res.status(400).json({ error: 'Falta audioUrl' });
    }
    const format = FORMATS.includes(outputFormat) ? outputFormat : 'wav';

    const version = await resolveVersion();
    console.log(`[DSP] Iniciando ${MODEL}@${version.slice(0, 8)} job=${jobId} formato=${format}`);

    const input: Record<string, unknown> = {
      audio_file: audioUrl,
      job_id: String(jobId || Date.now()),
      output_format: format,
    };
    if (uploadUrl) input.upload_url = uploadUrl;

    const prediction = await replicate.predictions.create({ version, input });

    return res.status(200).json({ success: true, predictionId: prediction.id });
  } catch (error: any) {
    console.error('[DSP] Error en watermark.ts:', error);
    return res.status(500).json({ error: error?.message || 'Error iniciando el job DSP' });
  }
}
