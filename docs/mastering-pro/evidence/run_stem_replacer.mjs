import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const esbuild = 'C:/Users/usuario/Downloads/PROYECTOS_GITHUB_2026/tandao_live_hub/desktop-client/node_modules/.bin/esbuild.cmd';
execSync(
  `"${esbuild}" "${dir}/entry_stem_replacer.ts" --bundle --format=iife --target=es2022 --outfile="${dir}/bundle_sr.js"`,
  { stdio: 'inherit' }
);

const html = '<!doctype html><html><body><script src="/bundle_sr.js"></script></body></html>';
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      fs.writeFileSync(path.join(dir, 'stem_replacer_verification.json'), body);
      res.end('ok');
      console.log('RESULT RECEIVED');
      setTimeout(() => process.exit(0), 300);
    });
    return;
  }
  if (req.url === '/bundle_sr.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(fs.readFileSync(path.join(dir, 'bundle_sr.js')));
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(html);
});

server.listen(8771, () => {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const p = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--user-data-dir=' + path.join(dir, 'profile_sr'),
      'http://localhost:8771/',
    ],
    { stdio: 'ignore' }
  );
  p.on('exit', () => console.log('chrome exited'));
  setTimeout(() => {
    console.log('TIMEOUT');
    process.exit(2);
  }, 120000);
});
