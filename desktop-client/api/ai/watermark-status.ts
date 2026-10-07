import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const token =
  process.env.REPLICATE_API_TOKEN ||
  process.env.VITE_REPLICATE_API_TOKEN ||
  process.env.REPLICATE_API_STEMS ||
  process.env.VITE_REPLICATE_API_STEMS;
const replicate = new Replicate({ auth: token });

/** Extrae el último mensaje útil de los logs del worker para mostrar progreso en la UI. */
function lastLogLine(logs?: string | null): string | null {
  if (!logs) return null;
  const lines = logs.split('\n').map(l => l.trim()).filter(l => /^\[\d\/\d\]/.test(l));
  return lines.length ? lines[lines.length - 1] : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { predictionId } = req.body || {};
    if (!predictionId) return res.status(400).json({ error: 'Falta predictionId' });

    const prediction: any = await replicate.predictions.get(predictionId);
    const step = lastLogLine(prediction.logs);

    if (prediction.status === 'succeeded') {
      return res.status(200).json({ done: true, status: prediction.status, output: prediction.output });
    }
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return res.status(200).json({
        done: true,
        failed: true,
        status: prediction.status,
        error: prediction.error || `El job terminó con estado ${prediction.status}`,
      });
    }
    return res.status(200).json({ done: false, status: prediction.status, step });
  } catch (error: any) {
    console.error('[DSP] Error en watermark-status.ts:', error);
    return res.status(500).json({ error: error?.message || 'Error consultando el job DSP' });
  }
}
