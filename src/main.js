// Boot: WebGL check, title screen, fullscreen + landscape lock, asset loading, game start.
import { Engine } from './core/engine.js';
import { loadEarthAssets } from './world/earth/earthAssets.js';
import { Game } from './game.js';
import { QUALITY, QUALITY_JP } from './core/quality.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

function setProgress(p) {
  $('progress-bar').style.width = Math.round(p * 100) + '%';
}

function showError(msg) {
  const e = $('boot-err');
  e.textContent = msg;
  e.classList.remove('hidden');
}

function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth * 1.05;
  const touch = matchMedia('(pointer: coarse)').matches;
  $('rotate').classList.toggle('hidden', !(portrait && touch));
  return !portrait;
}

async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch (e) { /* iOS Safari: use Add to Home Screen (manifest is fullscreen/landscape) */ }
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* not supported */ }
}

async function boot() {
  window.addEventListener('resize', checkOrientation);
  checkOrientation();
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const canvas = $('gl');
  let engine;
  try {
    const test = document.createElement('canvas').getContext('webgl2');
    if (!test) throw new Error('WebGL2');
    engine = new Engine(canvas);
  } catch (e) {
    showError('この端末では WebGL2 が使えません。最新のブラウザでお試しください。');
    return;
  }
  setProgress(0.05);
  let earth;
  try {
    earth = await loadEarthAssets(engine.renderer, (p) => setProgress(0.05 + p * 0.6));
  } catch (e) {
    console.error(e);
    showError('データの読み込みに失敗しました。通信環境を確認して再読み込みしてください。');
    return;
  }
  const game = new Game(engine, earth, params);
  window.__game = game;
  try {
    await game.init((p) => setProgress(0.65 + p * 0.35));
  } catch (e) {
    console.error(e);
    showError('ゲームの起動に失敗しました。ページを再読み込みしてください。（' + String((e && e.message) || e).slice(0, 160) + '）');
    return;
  }
  setProgress(1);
  const hasSave = game.save.hasSave();
  $('btn-continue').classList.toggle('hidden', !hasSave);
  $('boot-btns').classList.remove('hidden');
  // graphics quality: high (full look) or low (about half the processing)
  const gfxLabel = () => {
    $('gfx-label').textContent = '画質：' + QUALITY_JP[QUALITY.level];
    $('gfx-note').textContent = QUALITY.level === 'low' ? '解像度と描画を下げて処理を約半分に（軽い・電池にやさしい）' : 'いちばんきれいな表示（重い）';
  };
  gfxLabel();
  $('boot-gfx').classList.remove('hidden');
  $('btn-gfx').addEventListener('click', () => { game.applyQuality(QUALITY.level === 'low' ? 'high' : 'low'); gfxLabel(); });
  $('progress').classList.add('hidden');
  $('boot').classList.add('ready');   // the live 3D scene shows through behind the title
  game.startIdle();

  const start = (cont) => {
    // audio + speech must be unlocked synchronously inside the tap (iOS)
    game.audio.unlock();
    if (game.asphalt) game.asphalt.unlock();
    enterFullscreen();
    $('boot').classList.add('fade');
    $('boot-gfx').classList.add('hidden');
    setTimeout(() => $('boot').classList.add('hidden'), 1300);
    $('hud').classList.remove('hidden');
    game.begin(cont);
  };
  $('btn-continue').addEventListener('click', () => start(true), { once: true });
  $('btn-new').addEventListener('click', () => start(false), { once: true });
  if (params.has('autostart')) start(params.get('autostart') !== 'new' && hasSave);
}

boot();
