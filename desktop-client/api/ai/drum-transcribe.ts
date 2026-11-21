import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const MT3_VERSION = '159965ec81a23b88d50e4636f9539f2cbb6f50503d8f14e915069526b4a9edfb';
const ALL_IN_ONE_BEATS_VERSION = '001b4137be6ac67bdc28cb5cffacf128b874f530258d033de23121e785cb7290';
const BASIC_PITCH_VERSION = 'a7cf33cf63fca9c71f2235332af5a9fdfb7d23c459a0dc429daa203ff8e80c78';
const DEMUCS_VERSION = 'ff5ad47d2685b27c0f820ee134c4394140804f08fa755cb20c846459faa4b337';

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

function parseAudioInput(audioBase64?: string, audioUrl?: string): Buffer | string {
  if (audioBase64 && typeof audioBase64 === 'string') {
    const clean = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    return Buffer.from(clean, 'base64');
  }
  if (audioUrl && typeof audioUrl === 'string') {
    return audioUrl;
  }
  throw new Error('Se requiere audioBase64 o audioUrl para iniciar la transcripción IA en Replicate.');
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
      return res.status(500).json({
        error: 'Falta REPLICATE_API_TOKEN. Configúralo en .env o ingresa tu token r8_... en Sample Lab.',
      });
    }

    const replicate = new Replicate({ auth: token });
    const {
      audioBase64,
      audioUrl,
      mode = 'drums',
      isolateDrumsFirst = false,
      includeBeats = true,
    } = req.body || {};

    const audioInput = parseAudioInput(audioBase64, audioUrl);

    let beatsPredictionId: string | null = null;
    if (includeBeats) {
      try {
        const beatsPred = await replicate.predictions.create({
          version: ALL_IN_ONE_BEATS_VERSION,
          input: {
            music_input: audioInput,
            model: 'harmonix-all',
            include_embeddings: false,
            include_activations: false,
          },
        });
        beatsPredictionId = beatsPred.id;
      } catch (beatErr: any) {
        console.warn('[SampleLab-AI] Warning starting beats analyzer:', beatErr?.message);
      }
    }

    if (isolateDrumsFirst && mode === 'drums') {
      const demucsPred = await replicate.predictions.create({
        version: DEMUCS_VERSION,
        input: {
          audio: audioInput,
          isolate_stem: 'drums',
          format: 'wav',
        },
      });
      return res.status(200).json({
        success: true,
        stage: 'demucs-isolating',
        demucsPredictionId: demucsPred.id,
        mt3PredictionId: null,
        beatsPredictionId,
        modelName: 'Demucs v4 + Google Magenta MT3 (Drums → MIDI)',
      });
    }

    // Primary transcription model: Google Magenta MT3 (turian/multi-task-music-transcription) for Drums & Polyphonic instruments,
    // or Spotify Basic-Pitch fallback if explicitly requested
    const useBasicPitch = mode === 'monophonic' && req.body?.preferBasicPitch === true;
    const mt3Pred = await replicate.predictions.create({
      version: useBasicPitch ? BASIC_PITCH_VERSION : MT3_VERSION,
      input: useBasicPitch
        ? { audio_file: audioInput }
        : { audio_file: audioInput, model_type: 'mt3' },
    });

    return res.status(200).json({
      success: true,
      stage: 'transcribing-midi',
      demucsPredictionId: null,
      mt3PredictionId: mt3Pred.id,
      beatsPredictionId,
      modelName: useBasicPitch
        ? 'Spotify Basic Pitch + Harmonix Beat AI'
        : 'Google Magenta MT3 (Multi-Track Drum & Music MIDI) + Harmonix Beat AI',
    });
  } catch (error: any) {
    console.error('[SampleLab-AI] Error en drum-transcribe:', error);
    return res.status(500).json({
      error: error?.message || 'Error iniciando transcripción MIDI en Replicate',
    });
  }
}
