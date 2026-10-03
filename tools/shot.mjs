// Visual test harness: opens the game in headless Chromium (SwiftShader) and saves screenshots.
// usage: node tools/shot.mjs "<query>" out.png [waitSeconds] [width] [height] [jsToEvalAfterLoad]
import { chromium } from 'playwright-core';

const [,, query = '', out = 'shot.png', wait = '8', W = '960', H = '440', evalJs = ''] = process.argv;
const url = `http://localhost:5173/?${query}`;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/Download the React|DevTools/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
const t0 = Date.now();
await page.waitForTimeout(+wait * 1000);
if (evalJs) {
  try { const r = await page.evaluate(evalJs); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[evalerr] ' + e.message); }
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
console.log(logs.slice(0, 80).join('\n'));
console.log('elapsed', ((Date.now() - t0) / 1000).toFixed(1), 's');
await browser.close();
