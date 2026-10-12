#!/usr/bin/env node
// Checks the demo build that dryasstudio.com embeds at /demos/flowobserve/.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../dist-demo/', import.meta.url));
const fail = [];
if (!existsSync(join(out, 'index.html'))) fail.push('dist-demo/index.html missing');
else {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  if (existsSync(join(out, 'sw.js'))) fail.push('sw.js shipped');
  if (existsSync(join(out, 'manifest.webmanifest'))) fail.push('manifest shipped');
  if (html.includes('rel="manifest"')) fail.push('manifest link in index.html');
  if (!html.includes('<meta name="robots" content="noindex">')) fail.push('noindex missing');
  for (const [, url] of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
    if (!url.startsWith('/demos/flowobserve/')) fail.push(`absolute URL outside base: ${url}`);
  }
  const js = readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.js'));
  const bundle = js.map((f) => readFileSync(join(out, 'assets', f), 'utf8')).join('\n');
  if (bundle.includes('serviceWorker.register')) fail.push('service worker registration in bundle');
  if (/peem/i.test(html + bundle)) fail.push('demo contains "Peem"');
}
if (fail.length) { console.error(fail.map((f) => `✗ ${f}`).join('\n')); process.exit(1); }
console.log('✓ demo build ok');
