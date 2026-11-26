/**
 * Single-flight dynamic loader for minified lamejs (`lame.min.js` ~156 kB vs `lame.all.js` 530 kB).
 * Supports global script, Function evaluation, and Blob script URL fallbacks for mobile Safari/Chrome/WebViews.
 */
let lameLoadPromise: Promise<any> | null = null;

export async function loadLameJs(): Promise<any> {
  const globalObj: any = typeof globalThis !== 'undefined' ? globalThis : window;
  const existing = globalObj?.lamejs;
  if (existing && typeof existing.Mp3Encoder === 'function') {
    return existing;
  }

  if (!lameLoadPromise) {
    lameLoadPromise = (async () => {
      const lamejsSrc = await import('lamejs/lame.min.js?raw');
      const rawCode = lamejsSrc.default;

      // Estrategia 1: Evaluación aislada con Function (funciona en Node/Vitest, Safari iOS, Android Chrome y sin requerir DOM inline script)
      try {
        const factory = new Function(
          `${rawCode};\nreturn typeof lamejs !== "undefined" ? lamejs : null;`
        );
        const evaluated = factory();
        if (evaluated && typeof evaluated.Mp3Encoder === 'function') {
          globalObj.lamejs = evaluated;
          return evaluated;
        }
      } catch {
        // Fallback a inyección de script en DOM
      }

      // Estrategia 2: Inyección de <script> en DOM
      if (typeof document !== 'undefined' && document.head) {
        try {
          const script = document.createElement('script');
          script.textContent = `${rawCode}\nwindow.lamejs = lamejs;`;
          document.head.appendChild(script);
          if (globalObj.lamejs && typeof globalObj.lamejs.Mp3Encoder === 'function') {
            return globalObj.lamejs;
          }
        } catch {}

        // Estrategia 3: Blob URL script (compatible con CSP que bloquean inline pero permiten blob:)
        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
          const blob = new Blob([`${rawCode}\nwindow.lamejs = lamejs;`], {
            type: 'application/javascript',
          });
          const blobUrl = URL.createObjectURL(blob);
          try {
            await new Promise<void>((resolve, reject) => {
              const s = document.createElement('script');
              s.src = blobUrl;
              s.onload = () => resolve();
              s.onerror = () => reject(new Error('No se pudo cargar el codificador MP3'));
              document.head.appendChild(s);
            });
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        }
      }

      if (globalObj?.lamejs && typeof globalObj.lamejs.Mp3Encoder === 'function') {
        return globalObj.lamejs;
      }

      throw new Error('Codificador MP3 (lamejs) no disponible en este navegador');
    })().catch((err) => {
      lameLoadPromise = null;
      throw err;
    });
  }

  return lameLoadPromise;
}
