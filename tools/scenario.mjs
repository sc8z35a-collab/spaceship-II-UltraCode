// Scenario runner: loads the game once, then runs steps from a JS module (array of
// { wait, eval, shot }) and saves screenshots. usage: node tools/scenario.mjs steps.mjs outDir [W] [H] [query]
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const [,, stepsFile, outDir = '.', W = '960', H = '440', query = 'autostart=new&spawn=cockpit'] = process.argv;
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const steps = (await import(path.resolve(stepsFile))).default;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/vite|DevTools|requestFullscreen/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
const t0 = Date.now();
await page.goto(`${BASE}?${query}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 240000 });
logs.push(`[runner] game running after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const [i, s] of steps.entries()) {
  if (s.goto) {
    await page.goto(`${BASE}?${s.goto}`, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 240000 });
    logs.push(`[runner] reloaded (${s.goto})`);
  }
  if (s.wait) await page.waitForTimeout(s.wait * 1000);
  if (s.eval) {
    try { const r = await page.evaluate(s.eval); if (r !== undefined) logs.push(`[step ${i}] ` + JSON.stringify(r)); } catch (e) { logs.push(`[step ${i} error] ` + e.message); }
  }
  if (s.shot) await page.screenshot({ path: path.join(outDir, s.shot) });
  if (logs.length) { console.log(logs.join('\n')); logs.length = 0; }
}
console.log('total', ((Date.now() - t0) / 1000).toFixed(1), 's');
await browser.close();
