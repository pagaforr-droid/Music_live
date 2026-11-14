/**
 * Single-flight dynamic loader for minified lamejs (`lame.min.js` ~156 kB vs `lame.all.js` 530 kB).
 * Executes in global script scope once to bypass Vite ESM strict mode constraints.
 */
let lameLoadPromise: Promise<any> | null = null;

export async function loadLameJs(): Promise<any> {
  const existing = (window as any).lamejs;
  if (existing && typeof existing.Mp3Encoder === 'function') {
    return existing;
  }

  if (!lameLoadPromise) {
    lameLoadPromise = (async () => {
      const lamejsSrc = await import('lamejs/lame.min.js?raw');
      const script = document.createElement('script');
      script.textContent = `${lamejsSrc.default}\nwindow.lamejs = lamejs;`;
      document.head.appendChild(script);
      return (window as any).lamejs;
    })().catch((err) => {
      lameLoadPromise = null;
      throw err;
    });
  }

  return lameLoadPromise;
}
