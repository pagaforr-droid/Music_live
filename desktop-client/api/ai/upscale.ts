import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const token =
  process.env.REPLICATE_API_TOKEN ||
  process.env.VITE_REPLICATE_API_TOKEN ||
  process.env.REPLICATE_API_STEMS ||
  process.env.VITE_REPLICATE_API_STEMS;
const replicate = new Replicate({ auth: token });

const MODEL_CLARITY = 'nightmareai/real-esrgan';
const MODEL_CRYSTAL = 'sczhou/codeformer';

async function resolveVersion(modelName: string): Promise<string> {
  const [owner, name] = modelName.split('/');
  const model: any = await replicate.models.get(owner, name);
  const id = model?.latest_version?.id;
  if (!id) throw new Error(`El modelo ${modelName} no tiene versiones publicadas.`);
  return id;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!token) return res.status(500).json({ error: 'Falta REPLICATE_API_TOKEN' });

  try {
    const { imageUrl, mode, prompt, creativity } = req.body || {};
    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).json({ error: 'Falta imageUrl' });
    }

    const isPortrait = mode === 'portrait';
    const modelName = isPortrait ? MODEL_CRYSTAL : MODEL_CLARITY;
    const version = await resolveVersion(modelName);

    console.log(`[UPSCALE] Iniciando ${modelName} con modo ${mode}`);

    // Inputs adaptados a los modelos de philz1337x
    let input: Record<string, unknown> = {};

    if (isPortrait) {
      input = {
        image: imageUrl,
        upscale: 2,
        face_upsample: true,
        background_enhance: true,
        codeformer_fidelity: 0.5
      };
    } else {
      input = {
        image: imageUrl,
        scale: 4,
        face_enhance: true
      };
    }

    const prediction = await replicate.predictions.create({ version, input });

    return res.status(200).json({ success: true, predictionId: prediction.id });
  } catch (error: any) {
    console.error('[UPSCALE] Error en upscale.ts:', error);
    return res.status(500).json({ error: error?.message || 'Error iniciando upscale' });
  }
}
