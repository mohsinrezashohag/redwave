/**
 * gen-icons — rasterize the brand favicon into the app-icon set under public/.
 *
 * Source of truth: public/favicon.svg (the square, centred orange wave mark). Run `npm run gen:icons`
 * after the mark changes. Outputs (all in public/):
 *   - favicon.ico          (16 + 32, TRANSPARENT — reads on any tab bar)
 *   - apple-touch-icon.png (180, NAVY tile — iOS home screen)
 *   - icon-192.png         (192, NAVY — PWA/manifest)
 *   - icon-512.png         (512, NAVY — PWA/manifest)
 *
 * Pure JS pipeline (no system deps): @resvg/resvg-js (SVG→PNG) + to-ico (PNG→ICO).
 */
import { Resvg } from '@resvg/resvg-js';
import toIco from 'to-ico';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(here, '..', 'public');
const NAVY = '#13213d'; // --brand-900 (light) — the app-tile background

const svg = readFileSync(resolve(PUBLIC, 'favicon.svg'), 'utf8');

/** Render the favicon SVG to a square PNG buffer at `size`px, on `background` ('' = transparent). */
function png(size, background) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: background || 'rgba(0,0,0,0)',
  });
  return Buffer.from(resvg.render().asPng());
}

const out = (name, buf) => writeFileSync(resolve(PUBLIC, name), buf);

// Favicon .ico — transparent, the classic 16 + 32 sizes.
const ico = await toIco([png(16, ''), png(32, '')]);
out('favicon.ico', ico);

// App tiles — navy background + the orange mark (the SVG's padding centres it).
out('apple-touch-icon.png', png(180, NAVY));
out('icon-192.png', png(192, NAVY));
out('icon-512.png', png(512, NAVY));

console.log('Wrote favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png to public/');
