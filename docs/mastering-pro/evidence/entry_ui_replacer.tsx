import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SampleLabPanel } from 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/src/modules/mastering-pro/sampler/components/SampleLabPanel';

const runtimeErrors: string[] = [];
window.addEventListener('error', (e) => runtimeErrors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => runtimeErrors.push(String(e.reason)));

const rootEl = document.createElement('div');
document.body.appendChild(rootEl);

async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return pred();
}

async function runUiSmoke() {
  createRoot(rootEl).render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(SampleLabPanel)
    )
  );

  await waitFor(() => document.body.innerText.includes('Reemplazar Stem (Canción)'), 4000);
  const initialHasReplacerHeading = document.body.innerText.includes('1. Elige Canción (Carpeta)');
  const initialHasSingleStemStep = document.body.innerText.includes('2. Selecciona 1 Stem a Samplear');

  const findBtn = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(text)
    ) as HTMLButtonElement | undefined;

  // Click Demo Piano/Guitarra and verify polyphonic chords get analyzed
  const polyDemoBtn = findBtn('Demo Piano/Guitarra');
  polyDemoBtn?.click();
  const polyDone = await waitFor(
    () =>
      document.body.innerText.includes('notas (') &&
      document.body.innerText.includes('Primeras notas detectadas'),
    6000
  );

  // Switch instrument preset to Grand Piano Estudio
  findBtn('Grand Piano Estudio')?.click();
  await new Promise((r) => setTimeout(r, 220));

  // Click Demo Batería and verify drum hits analysis + 4 slot cards
  findBtn('Demo Batería')?.click();
  const drumsDone = await waitFor(
    () =>
      document.body.innerText.includes('Kick (Bombo)') &&
      document.body.innerText.includes('Snare (Caja)') &&
      document.body.innerText.includes('Hi-Hat / Platos') &&
      document.body.innerText.includes('golpes ('),
    6000
  );

  // Toggle A/B buttons
  findBtn('A: Stem Original')?.click();
  await new Promise((r) => setTimeout(r, 60));
  findBtn('B: Sampleado Mejorado')?.click();

  // Switch to secondary tab Creador 16 Pads
  findBtn('Creador 16 Pads')?.click();
  const padsDone = await waitFor(
    () =>
      document.body.innerText.includes('Banco de 16 Pads') &&
      document.body.innerText.includes('Secuenciador 16 Pasos'),
    4000
  );

  const checks = {
    ui_mounted_replacer_primary: initialHasReplacerHeading && initialHasSingleStemStep,
    ui_poly_demo_analyzed: polyDone,
    ui_drums_demo_analyzed: drumsDone,
    ui_secondary_pads_tab_works: padsDone,
    ui_zero_runtime_errors: runtimeErrors.length === 0,
  };

  await fetch('/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      {
        uiSmokePassed: Object.values(checks).every(Boolean),
        checks,
        runtimeErrors,
        buttonsRenderedInPadsTab: document.querySelectorAll('button').length,
      },
      null,
      2
    ),
  });
}

void runUiSmoke();
