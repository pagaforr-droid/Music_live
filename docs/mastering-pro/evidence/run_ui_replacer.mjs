import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(
  'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/package.json'
);
const esbuild = require('esbuild');

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));

const workerStubPlugin = {
  name: 'worker-stub',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, (args) => ({
      path: args.path,
      namespace: 'worker-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'worker-stub' }, () => ({
      // Return empty stub class so `new Worker()` fails cleanly and triggers synchronous fallback in isolated smoke bundle
      contents: 'export default function StubWorker() { throw new Error("stub"); }',
      loader: 'js',
    }));
  },
};

await esbuild.build({
  entryPoints: [`${dir}/entry_ui_replacer.tsx`],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: `${dir}/bundle_ui_replacer.js`,
  nodePaths: ['C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/node_modules'],
  plugins: [workerStubPlugin],
  define: {
    'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    }),
  },
});

const html = '<!doctype html><html><body><script src="/bundle_ui_replacer.js"></script></body></html>';
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      fs.writeFileSync(path.join(dir, 'ui_replacer_result.json'), body);
      res.end('ok');
      console.log('UI SMOKE RESULT RECEIVED');
      setTimeout(() => process.exit(0), 300);
    });
    return;
  }
  if (req.url === '/bundle_ui_replacer.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(fs.readFileSync(path.join(dir, 'bundle_ui_replacer.js')));
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(html);
});

server.listen(8772, () => {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const p = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--user-data-dir=' + path.join(dir, 'profile_ui'),
      'http://localhost:8772/',
    ],
    { stdio: 'ignore' }
  );
  p.on('exit', () => console.log('chrome exited'));
  setTimeout(() => {
    console.log('TIMEOUT');
    process.exit(2);
  }, 60000);
});
