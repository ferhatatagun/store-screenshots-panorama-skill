#!/usr/bin/env node
/*
Measure a screenshot for data-crop: draws a labelled pixel grid over it, and the boxes
you are trying, so a crop can be read off the picture instead of guessed.

Usage:
    node grid.mjs raw/02.png [--step 100] [--box x,y,w,h ...] [--out grid.png]

Without --out it writes <name>.grid.png in the current directory. Coordinates are the screenshot's own pixels, as in data-crop. PNG only.
Needs a Chromium-based browser, like render.mjs (CHROME_PATH if not found).
*/

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const COMMANDS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
const findBrowser = () => process.env.CHROME_PATH || BROWSERS.find(b => fs.existsSync(b))
  || (process.env.PATH || '').split(path.delimiter).flatMap(d => COMMANDS.map(c => path.join(d, c))).find(b => fs.existsSync(b));

const args = process.argv.slice(2);
if (!args[0] || args[0] === '-h' || args[0] === '--help') {
  const source = fs.readFileSync(new URL(import.meta.url), 'utf8');
  console.log(source.slice(source.indexOf('/*') + 3, source.indexOf('*/')).trim());
  process.exit(args[0] ? 0 : 1);
}
const file = path.resolve(args[0]);
let step = 100, out = null;
const boxes = [];
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--step') step = Number(args[++i]);
  else if (args[i] === '--out') out = path.resolve(args[++i]);
  else if (args[i] === '--box') boxes.push(args[++i].split(',').map(Number));
}
out ??= path.resolve(path.basename(file).replace(/\.png$/i, '') + '.grid.png');

const header = fs.readFileSync(file).subarray(0, 24);
if (header.toString('ascii', 1, 4) !== 'PNG') { console.error('PNG only'); process.exit(1); }
const W = header.readUInt32BE(16), H = header.readUInt32BE(20);

const lines = [];
for (let x = 0; x <= W; x += step) {
  const major = x % (step * 5) === 0;
  lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${major ? '#ff0055' : '#00b3ff'}" stroke-width="${major ? 3 : 1.5}" opacity=".75"/>`);
  lines.push(`<text x="${x + 4}" y="28" class="t">${x}</text>`);
}
for (let y = 0; y <= H; y += step) {
  const major = y % (step * 5) === 0;
  lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${major ? '#ff0055' : '#00b3ff'}" stroke-width="${major ? 3 : 1.5}" opacity=".75"/>`);
  lines.push(`<text x="4" y="${y - 6}" class="t">${y}</text>`);
}
for (const [x, y, w, h] of boxes) {
  lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255,230,0,.18)" stroke="#ffe600" stroke-width="6"/>`);
  lines.push(`<text x="${x + 10}" y="${y + h - 14}" class="t box">${x},${y},${w},${h}</text>`);
}
const page = `<!doctype html><html><body style="margin:0">
<img src="${pathToFileURL(file).href}" style="display:block;width:${W}px;height:${H}px">
<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0">
<style>.t{font:700 22px Menlo,monospace;fill:#fff;paint-order:stroke;stroke:#000;stroke-width:5px}.box{font-size:30px;fill:#ffe600}</style>
${lines.join('\n')}</svg></body></html>`;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-'));
const pagePath = path.join(work, 'grid.html');
fs.writeFileSync(pagePath, page);
fs.rmSync(out, { force: true });
const browser = findBrowser();
if (!browser) { console.error('No Chromium-based browser found. Set CHROME_PATH.'); process.exit(1); }
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  `--user-data-dir=${path.join(work, 'profile')}`, '--force-device-scale-factor=1', `--window-size=${W},${H}`,
  `--screenshot=${out}`, pathToFileURL(pagePath).href], { stdio: 'ignore' });
// Chrome doesn't always exit by itself: wait for the file to stop growing.
let last = -1, same = 0;
for (let i = 0; i < 240 && same < 3; i++) {
  await new Promise(r => setTimeout(r, 250));
  const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
  same = size > 0 && size === last ? same + 1 : 0;
  last = size;
}
proc.kill('SIGKILL');
fs.rmSync(work, { recursive: true, force: true });
if (!fs.existsSync(out)) { console.error('browser produced no image'); process.exit(1); }
console.log(JSON.stringify({ out, size: [W, H], step, boxes }));
