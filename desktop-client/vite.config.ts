import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Replicate from "replicate";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const MT3_VERSION = "159965ec81a23b88d50e4636f9539f2cbb6f50503d8f14e915069526b4a9edfb";
const ALL_IN_ONE_BEATS_VERSION = "001b4137be6ac67bdc28cb5cffacf128b874f530258d033de23121e785cb7290";
const BASIC_PITCH_VERSION = "a7cf33cf63fca9c71f2235332af5a9fdfb7d23c459a0dc429daa203ff8e80c78";
const DEMUCS_VERSION = "ff5ad47d2685b27c0f820ee134c4394140804f08fa755cb20c846459faa4b337";

function createLocalReplicateApiPlugin(env: Record<string, string>): Plugin {
  const readJsonBody = (req: any): Promise<any> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });

  const sendJson = (res: any, status: number, payload: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  };

  const resolveToken = (req: any): string | undefined => {
    const hdr =
      req.headers?.["x-replicate-token"] ||
      (typeof req.headers?.authorization === "string"
        ? req.headers.authorization.replace(/^Bearer\s+/i, "")
        : undefined);
    if (typeof hdr === "string" && hdr.trim().length > 5) return hdr.trim();
    return (
      env.REPLICATE_API_TOKEN ||
      env.VITE_REPLICATE_API_TOKEN ||
      env.REPLICATE_API_STEMS ||
      env.VITE_REPLICATE_API_STEMS
    );
  };

  return {
    name: "tandao-local-replicate-api",
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        const url = req.url || "";
        if (
          !url.startsWith("/api/ai/drum-transcribe") &&
          !url.startsWith("/api/replicate-predict") &&
          !url.startsWith("/api/replicate-poll")
        ) {
          return next();
        }

        if (req.method === "OPTIONS") {
          res.statusCode = 200;
          return res.end();
        }

        const token = resolveToken(req);
        if (!token) {
          return sendJson(res, 500, {
            error: "Falta REPLICATE_API_TOKEN en .env o en Sample Lab.",
          });
        }

        try {
          const replicate = new Replicate({ auth: token });

          if (url.startsWith("/api/ai/drum-transcribe-status")) {
            const body = await readJsonBody(req);
            const { mt3PredictionId, beatsPredictionId, demucsPredictionId } = body || {};

            if (demucsPredictionId && !mt3PredictionId) {
              const demucsPred = await replicate.predictions.get(demucsPredictionId);
              if (demucsPred.status === "failed" || demucsPred.status === "canceled") {
                return sendJson(res, 200, {
                  done: true,
                  failed: true,
                  error: `Demucs falló: ${demucsPred.error || "Cancelado"}`,
                });
              }
              if (demucsPred.status !== "succeeded") {
                return sendJson(res, 200, {
                  done: false,
                  stage: "demucs-isolating",
                  status: demucsPred.status,
                  demucsPredictionId,
                  mt3PredictionId: null,
                  beatsPredictionId,
                });
              }

              const drumsOut =
                typeof demucsPred.output === "object" && demucsPred.output !== null
                  ? (demucsPred.output as Record<string, string>).drums
                  : typeof demucsPred.output === "string"
                  ? demucsPred.output
                  : null;

              if (!drumsOut) {
                return sendJson(res, 200, {
                  done: true,
                  failed: true,
                  error: "Demucs no devolvió la pista aislada de batería.",
                });
              }

              let mt3Input: Buffer | string = drumsOut;
              if (drumsOut.startsWith("data:")) {
                const clean = drumsOut.includes(",") ? drumsOut.split(",")[1] : drumsOut;
                mt3Input = Buffer.from(clean, "base64");
              }

              const nextMt3 = await replicate.predictions.create({
                version: MT3_VERSION,
                input: { audio_file: mt3Input, model_type: "mt3" },
              });

              return sendJson(res, 200, {
                done: false,
                stage: "transcribing-midi",
                status: nextMt3.status,
                demucsPredictionId,
                mt3PredictionId: nextMt3.id,
                beatsPredictionId,
              });
            }

            if (!mt3PredictionId) {
              return sendJson(res, 400, { error: "Falta mt3PredictionId" });
            }

            const mt3Pred = await replicate.predictions.get(mt3PredictionId);
            if (mt3Pred.status === "failed" || mt3Pred.status === "canceled") {
              return sendJson(res, 200, {
                done: true,
                failed: true,
                error: `MT3 falló: ${mt3Pred.error || "Cancelado"}`,
              });
            }
            if (mt3Pred.status !== "succeeded") {
              return sendJson(res, 200, {
                done: false,
                stage: "transcribing-midi",
                status: mt3Pred.status,
                mt3PredictionId,
                beatsPredictionId,
              });
            }

            const midiUrl =
              typeof mt3Pred.output === "string"
                ? mt3Pred.output
                : Array.isArray(mt3Pred.output)
                ? mt3Pred.output[0]
                : (mt3Pred.output as any)?.midi || (mt3Pred.output as any)?.file;

            let midiBase64 = "";
            if (typeof midiUrl === "string" && midiUrl.startsWith("data:")) {
              midiBase64 = midiUrl.includes(",") ? midiUrl.split(",")[1] : midiUrl;
            } else if (typeof midiUrl === "string") {
              const midiRes = await fetch(midiUrl);
              const arrBuf = await midiRes.arrayBuffer();
              midiBase64 = Buffer.from(arrBuf).toString("base64");
            }

            let beatData: any = null;
            if (beatsPredictionId) {
              try {
                const beatsPred = await replicate.predictions.get(beatsPredictionId);
                if (beatsPred.status === "succeeded" && beatsPred.output) {
                  const beatJsonUrl = Array.isArray(beatsPred.output)
                    ? beatsPred.output.find((u: unknown) => typeof u === "string" && u.endsWith(".json")) ??
                      beatsPred.output[0]
                    : typeof beatsPred.output === "string"
                    ? beatsPred.output
                    : null;
                  if (typeof beatJsonUrl === "string" && beatJsonUrl.startsWith("http")) {
                    const bRes = await fetch(beatJsonUrl);
                    if (bRes.ok) beatData = await bRes.json();
                  }
                }
              } catch {
                // optional beat data
              }
            }

            return sendJson(res, 200, {
              done: true,
              failed: false,
              status: "succeeded",
              midiBase64,
              midiUrl,
              beatData,
            });
          }

          if (url.startsWith("/api/ai/drum-transcribe")) {
            const body = await readJsonBody(req);
            const {
              audioBase64,
              audioUrl,
              mode = "drums",
              isolateDrumsFirst = false,
              includeBeats = true,
              preferBasicPitch = false,
            } = body || {};

            let audioInput: Buffer | string;
            if (audioBase64 && typeof audioBase64 === "string") {
              const clean = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
              audioInput = Buffer.from(clean, "base64");
            } else if (audioUrl && typeof audioUrl === "string") {
              audioInput = audioUrl;
            } else {
              return sendJson(res, 400, { error: "Falta audioBase64 o audioUrl" });
            }

            let beatsPredictionId: string | null = null;
            if (includeBeats) {
              try {
                const beatsPred = await replicate.predictions.create({
                  version: ALL_IN_ONE_BEATS_VERSION,
                  input: {
                    music_input: audioInput,
                    model: "harmonix-all",
                    include_embeddings: false,
                    include_activations: false,
                  },
                });
                beatsPredictionId = beatsPred.id;
              } catch {
                // optional beats
              }
            }

            if (isolateDrumsFirst && mode === "drums") {
              const demucsPred = await replicate.predictions.create({
                version: DEMUCS_VERSION,
                input: { audio: audioInput, isolate_stem: "drums", format: "wav" },
              });
              return sendJson(res, 200, {
                success: true,
                stage: "demucs-isolating",
                demucsPredictionId: demucsPred.id,
                mt3PredictionId: null,
                beatsPredictionId,
              });
            }

            const useBasicPitch = mode === "monophonic" && preferBasicPitch === true;
            const mt3Pred = await replicate.predictions.create({
              version: useBasicPitch ? BASIC_PITCH_VERSION : MT3_VERSION,
              input: useBasicPitch
                ? { audio_file: audioInput }
                : { audio_file: audioInput, model_type: "mt3" },
            });

            return sendJson(res, 200, {
              success: true,
              stage: "transcribing-midi",
              demucsPredictionId: null,
              mt3PredictionId: mt3Pred.id,
              beatsPredictionId,
            });
          }

          return next();
        } catch (err: any) {
          return sendJson(res, 500, { error: err?.message || "Error Replicate local middleware" });
        }
      });
    },
  };
}

function resolveDrumKit1400Root(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "..", "1400 Samples Drum Kit"),
    path.resolve(process.cwd(), "1400 Samples Drum Kit"),
    "C:\\Users\\usuario\\Downloads\\PROYECTOS_GITHUB_2026\\tandao_live_hub\\1400 Samples Drum Kit",
    "C:\\Users\\usuario\\Downloads\\tandao_live_hub\\1400 Samples Drum Kit",
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // continue checking next candidate
    }
  }
  return null;
}

function attachDrumKit1400Middleware(middlewares: any) {
  middlewares.use((req: any, res: any, next: () => void) => {
    const rawUrl = (req.url || "").split("?")[0];
    if (!rawUrl.startsWith("/api/drum-kit-1400/")) {
      return next();
    }

    const kitRoot = resolveDrumKit1400Root();
    if (!kitRoot) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ available: false, error: "Carpeta 1400 Samples Drum Kit no encontrada localmente." }));
      return;
    }

    if (rawUrl === "/api/drum-kit-1400/manifest") {
      try {
        const folders: Record<string, string[]> = {};
        for (const entry of fs.readdirSync(kitRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const subDir = path.join(kitRoot, entry.name);
          const files = fs
            .readdirSync(subDir)
            .filter((f) => /\.(wav|mp3|flac|ogg|aiff|aif)$/i.test(f));
          folders[entry.name] = files;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-cache");
        res.end(JSON.stringify({ available: true, rootPath: kitRoot, folders }));
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ available: false, error: err?.message || "Error leyendo manifest" }));
      }
      return;
    }

    const relPart = rawUrl.slice("/api/drum-kit-1400/".length);
    const segments = relPart.split("/").filter(Boolean).map((s: string) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

    if (segments.length < 2 || segments.some((s: string) => s === ".." || s.includes("\\") || s.includes("/"))) {
      res.statusCode = 400;
      res.end("Ruta inválida");
      return;
    }

    const resolvedRoot = path.resolve(kitRoot);
    const targetFile = path.resolve(resolvedRoot, ...segments);
    if (!targetFile.startsWith(resolvedRoot + path.sep)) {
      res.statusCode = 403;
      res.end("Acceso denegado");
      return;
    }

    if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      res.statusCode = 404;
      res.end("Sample no encontrado");
      return;
    }

    const stat = fs.statSync(targetFile);
    const ext = path.extname(targetFile).toLowerCase();
    const mime =
      ext === ".mp3"
        ? "audio/mpeg"
        : ext === ".flac"
        ? "audio/flac"
        : ext === ".ogg"
        ? "audio/ogg"
        : "audio/wav";

    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(targetFile).pipe(res);
  });
}

function createLocalDrumKit1400Plugin(): Plugin {
  return {
    name: "tandao-local-drum-kit-1400",
    configureServer(server) {
      attachDrumKit1400Middleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachDrumKit1400Middleware(server.middlewares);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  // @ts-expect-error process is a nodejs global
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      tailwindcss(),
      createLocalDrumKit1400Plugin(),
      createLocalReplicateApiPlugin(env),
    ],

    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-supabase": ["@supabase/supabase-js"],
            "vendor-motion": ["framer-motion"],
            "vendor-icons": ["lucide-react"],
          },
        },
      },
    },

    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
