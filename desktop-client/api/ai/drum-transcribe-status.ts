import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const MT3_VERSION = '159965ec81a23b88d50e4636f9539f2cbb6f50503d8f14e915069526b4a9edfb';

function resolveReplicateToken(req: VercelRequest): string | undefined {
  const headerTok =
    (req.headers['x-replicate-token'] as string | undefined) ||
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : undefined);
  if (headerTok && headerTok.trim().length > 5) return headerTok.trim();
  return (
    process.env.REPLICATE_API_TOKEN ||
    process.env.VITE_REPLICATE_API_TOKEN ||
    process.env.REPLICATE_API_STEMS ||
    process.env.VITE_REPLICATE_API_STEMS ||
    process.env.REPLICATE_API_TOKENstems ||
    process.env.VITE_REPLICATE_API_TOKENstems
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = resolveReplicateToken(req);
    if (!token) {
      return res.status(500).json({ error: 'Falta REPLICATE_API_TOKEN.' });
    }

    const replicate = new Replicate({ auth: token });
    const {
      mt3PredictionId,
      beatsPredictionId,
      demucsPredictionId,
    } = req.body || {};

    // Stage 1: If Demucs v4 is isolating the drum stem first before MT3 MIDI transcription
    if (demucsPredictionId && !mt3PredictionId) {
      const demucsPred = await replicate.predictions.get(demucsPredictionId);
      if (demucsPred.status === 'failed' || demucsPred.status === 'canceled') {
        return res.status(200).json({
          done: true,
          failed: true,
          error: `Demucs falló en Replicate: ${demucsPred.error || 'Cancelado'}`,
        });
      }
      if (demucsPred.status !== 'succeeded') {
        return res.status(200).json({
          done: false,
          stage: 'demucs-isolating',
          status: demucsPred.status,
          demucsPredictionId,
          mt3PredictionId: null,
          beatsPredictionId,
        });
      }

      const drumsOut =
        typeof demucsPred.output === 'object' && demucsPred.output !== null
          ? (demucsPred.output as Record<string, string>).drums
          : typeof demucsPred.output === 'string'
          ? demucsPred.output
          : null;

      if (!drumsOut) {
        return res.status(200).json({
          done: true,
          failed: true,
          error: 'Demucs no devolvió la pista aislada de batería.',
        });
      }

      let mt3Input: Buffer | string = drumsOut;
      if (drumsOut.startsWith('data:')) {
        const clean = drumsOut.includes(',') ? drumsOut.split(',')[1] : drumsOut;
        mt3Input = Buffer.from(clean, 'base64');
      }

      const nextMt3 = await replicate.predictions.create({
        version: MT3_VERSION,
        input: {
          audio_file: mt3Input,
          model_type: 'mt3',
        },
      });

      return res.status(200).json({
        done: false,
        stage: 'transcribing-midi',
        status: nextMt3.status,
        demucsPredictionId,
        mt3PredictionId: nextMt3.id,
        beatsPredictionId,
      });
    }

    if (!mt3PredictionId) {
      return res.status(400).json({ error: 'Falta mt3PredictionId' });
    }

    const mt3Pred = await replicate.predictions.get(mt3PredictionId);
    if (mt3Pred.status === 'failed' || mt3Pred.status === 'canceled') {
      return res.status(200).json({
        done: true,
        failed: true,
        error: `MT3 falló en Replicate: ${mt3Pred.error || 'Cancelado'}`,
      });
    }

    if (mt3Pred.status !== 'succeeded') {
      return res.status(200).json({
        done: false,
        stage: 'transcribing-midi',
        status: mt3Pred.status,
        mt3PredictionId,
        beatsPredictionId,
      });
    }

    // MT3 succeeded! Download the generated .mid binary server-side so browser never hits CORS
    const midiUrl =
      typeof mt3Pred.output === 'string'
        ? mt3Pred.output
        : Array.isArray(mt3Pred.output)
        ? mt3Pred.output[0]
        : (mt3Pred.output as any)?.midi || (mt3Pred.output as any)?.file;

    if (!midiUrl || typeof midiUrl !== 'string') {
      return res.status(200).json({
        done: true,
        failed: true,
        error: 'Replicate MT3 no devolvió una URL MIDI válida.',
      });
    }

    let midiBase64 = '';
    if (midiUrl.startsWith('data:')) {
      midiBase64 = midiUrl.includes(',') ? midiUrl.split(',')[1] : midiUrl;
    } else {
      const midiRes = await fetch(midiUrl);
      if (!midiRes.ok) {
        throw new Error(`No se pudo descargar el MIDI generado (${midiRes.status})`);
      }
      const arrBuf = await midiRes.arrayBuffer();
      midiBase64 = Buffer.from(arrBuf).toString('base64');
    }

    // Also inspect Beats / Tempo prediction if present
    let beatData: {
      bpm?: number;
      beats?: number[];
      downbeats?: number[];
      beat_positions?: number[];
    } | null = null;

    if (beatsPredictionId) {
      try {
        const beatsPred = await replicate.predictions.get(beatsPredictionId);
        if (beatsPred.status === 'succeeded' && beatsPred.output) {
          const beatJsonUrl = Array.isArray(beatsPred.output)
            ? beatsPred.output.find((u: unknown) => typeof u === 'string' && u.endsWith('.json')) ??
              beatsPred.output[0]
            : typeof beatsPred.output === 'string'
            ? beatsPred.output
            : null;
          if (typeof beatJsonUrl === 'string' && beatJsonUrl.startsWith('http')) {
            const bRes = await fetch(beatJsonUrl);
            if (bRes.ok) {
              beatData = await bRes.json();
            }
          } else if (typeof beatsPred.output === 'object' && !Array.isArray(beatsPred.output)) {
            beatData = beatsPred.output as any;
          }
        }
      } catch (bErr: any) {
        console.warn('[SampleLab-AI] No se pudo obtener beatData complementario:', bErr?.message);
      }
    }

    return res.status(200).json({
      done: true,
      failed: false,
      status: 'succeeded',
      midiBase64,
      midiUrl,
      beatData,
    });
  } catch (error: any) {
    console.error('[SampleLab-AI] Error en drum-transcribe-status:', error);
    return res.status(500).json({
      error: error?.message || 'Error consultando estado de transcripción MIDI en Replicate',
    });
  }
}
