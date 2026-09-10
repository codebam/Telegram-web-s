/*
 * Writes the app's icons from the client's own mark.
 *
 *   node astro/scripts/generate-icons.mjs
 *
 * `astro/src/components/logoGeometry.ts` is the single source: this script turns
 * it into the standalone `public/icon.svg` (the favicon browsers prefer) and
 * rasterises the three PNGs the manifest and iOS ask for. Re-run it after the mark
 * changes — the tile is the client's default accent, because a static asset cannot
 * follow a user's colour choice the way the in-app mark does.
 *
 * Rasterising goes through Chrome rather than a sharp/resvg dependency: the repo
 * already drives a headless browser for its own checks (`scripts/test-browser.sh`),
 * and adding a native image library to the tree for three files is a poor trade.
 * Without a browser on the debug port the script still writes the SVG and says
 * what it skipped.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  LOGO_BUBBLE,
  LOGO_GRID,
  LOGO_LETTER,
  LOGO_LETTER_STROKE
} from '../src/components/logoGeometry.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = resolve(REPO, 'astro/public');
const require = createRequire(REPO + '/package.json');
const {chromium} = require('@playwright/test');

/** The client's default accent, and a lighter tint of it for the tile. */
const ACCENT = '#3390ec';
const ACCENT_LIGHT = '#5fb2f2';
const CDP_PORT = process.env.WEBS_TEST_CDP_PORT || '9222';

/**
 * The mark on its tile. `padding` is the share of the tile left around the mark —
 * a plain icon wants a squircle with margins, a maskable one a full bleed with the
 * mark inside Android's safe circle.
 */
function markSvg({size, padding, radius}) {
  const offset = size * padding;
  const scale = (size - offset * 2) / LOGO_GRID;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ACCENT_LIGHT}"/>
      <stop offset="1" stop-color="${ACCENT}"/>
    </linearGradient>
    <mask id="mark">
      <rect width="${LOGO_GRID}" height="${LOGO_GRID}" fill="#fff"/>
      <path d="${LOGO_LETTER}" fill="none" stroke="#000" stroke-width="${LOGO_LETTER_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>
    </mask>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#tile)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="${LOGO_BUBBLE}" fill="#fff" mask="url(#mark)"/>
  </g>
</svg>`;
}

const ICONS = [
  // The favicon and the manifest's `any` icon: a squircle, the shape a launcher
  // masks a plain icon into anyway.
  {file: 'icon.svg', size: 512, padding: 0.16, radius: 112},
  {file: 'icon-192.png', size: 192, padding: 0.16, radius: 42},
  {file: 'icon-512.png', size: 512, padding: 0.16, radius: 112},
  // Maskable: full bleed, mark well inside the safe circle, so no launcher shape
  // can clip the bubble.
  {file: 'icon-maskable.png', size: 512, padding: 0.24, radius: 0},
  // The mark the login QR code is painted with, at the path and in the shape
  // tweb's `paintQrCode` expects: a 160×160 box, one recolourable `fill:` in a
  // style block (it rewrites that declaration to the accent), everything else as
  // attributes. The letter is punched out, so the code shows through it.
  {file: 'assets/img/logo_padded.svg', qr: true}
];

/**
 * The QR logo. Same mark, no tile — and it has to be recolour-able the way
 * `paintQrCode` recolours it, so the only `fill:` in the file is the declaration
 * it rewrites, and the letter is a mask (drawn with attributes) rather than a
 * second colour that would then need rewriting too.
 */
function qrLogoSvg() {
  const scale = 5; // the 32-unit grid, at the 160×160 box the QR paints into

  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Web S: the client's own mark, drawn by astro/scripts/generate-icons.mjs. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
<style type="text/css">.st0{fill-rule:evenodd;clip-rule:evenodd;fill:${ACCENT};}</style>
<mask id="wsQrLogo" maskUnits="userSpaceOnUse" x="0" y="0" width="${LOGO_GRID}" height="${LOGO_GRID}">
<rect width="${LOGO_GRID}" height="${LOGO_GRID}" fill="#fff"/>
<path d="${LOGO_LETTER}" fill="none" stroke="#000" stroke-width="${LOGO_LETTER_STROKE}" stroke-linecap="round"/>
</mask>
<g transform="scale(${scale})">
<path class="st0" mask="url(#wsQrLogo)" d="${LOGO_BUBBLE}"/>
</g>
</svg>
`;
}

async function rasterise(jobs) {
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  } catch(err) {
    console.warn(
      `[icons] no browser on :${CDP_PORT} — the PNGs were not regenerated.\n` +
      '        start one with: bash scripts/test-browser.sh'
    );
    return;
  }

  const page = await (await browser.contexts())[0].newPage();
  const cdp = await page.context().newCDPSession(page);

  for(const {file, size, svg} of jobs) {
    // The viewport is the icon's own size, so the capture is pixel-exact.
    await page.setViewportSize({width: size, height: size});
    await page.setContent(`<body style="margin:0;overflow:hidden">${svg}</body>`, {waitUntil: 'load'});
    const {data} = await cdp.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
    writeFileSync(resolve(PUBLIC, file), Buffer.from(data, 'base64'));
    console.log(`[icons] wrote public/${file} (${size}×${size})`);
  }

  await page.close();
}

mkdirSync(PUBLIC, {recursive: true});

for(const icon of ICONS) {
  if(!icon.file.endsWith('.svg')) continue;
  const svg = icon.qr ? qrLogoSvg() : markSvg(icon);
  mkdirSync(dirname(resolve(PUBLIC, icon.file)), {recursive: true});
  writeFileSync(resolve(PUBLIC, icon.file), svg);
  console.log(`[icons] wrote public/${icon.file}`);
}

await rasterise(ICONS.filter((icon) => icon.file.endsWith('.png')).map((icon) => ({...icon, svg: markSvg(icon)})));

/*
 * The CDP socket to a browser this script did not launch keeps the event loop
 * alive, and that browser is the caller's (the repo's signed-in test browser), so
 * it is not ours to close either.
 */
process.exit(0);
