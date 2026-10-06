// Photographs. The shutter (H8's camera controls, the camera tab, or the external cameras) takes
// the finished picture of the next frame — the outside as the cameras see it: none of the
// display's marks or tabs, none of the screen's buttons — and keeps it in this browser
// (IndexedDB, up to 300; without it, for this session only). The gallery shows them with when and
// where each was taken; any of them can be saved to the device or deleted.
const DB = 'b29-photos', STORE = 'photos', MAX = 300;

function idb() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const tx = (db, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
  const out = fn(s);
  t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
  t.onerror = () => rej(t.error);
});

export class Photos {
  constructor(game) {
    this.g = game;
    this.count = 0;
    this.pending = false;
    this.mem = [];
    this.db = null;
    this.urls = [];
    idb().then((db) => { this.db = db; return tx(db, 'readonly', (s) => s.count()); }).then((n) => { this.count = n || 0; }).catch(() => { this.db = null; });
  }

  /** take a picture of the next frame */
  shoot() {
    if (this.pending) return;
    const g = this.g;
    this.pending = true;
    g.engine.onFrame = (canvas) => this.capture(canvas);
    const A = g.audio;
    if (A && A.ready) {
      // a shutter: a dry click and the blades
      A._burst && A._burst(null, { dur: 0.035, freq: 3200, q: 0.9, gain: 0.12, type: 'white', filter: 'bandpass', direct: true });
      A._burst && A._burst(null, { dur: 0.05, freq: 1800, q: 0.7, gain: 0.08, type: 'white', filter: 'bandpass', direct: true, when: 0.07 });
    }
    if (g.h8 && g.h8.zoom) g.h8.zoom.flash = 1;
  }

  /** what is known about the picture: when, where, what of */
  meta() {
    const g = this.g, h8 = g.h8;
    const d = new Date(g.time + 9 * 3600e3);
    const when = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const v = g.playerVessel ? g.playerVessel() : g.flight;
    const alt = (v.pos.length() - 6371000) / 1000;
    const m = { when, alt: +alt.toFixed(1), from: h8 && h8.crew ? 'H8' : g.mode === 'camera' ? 'B-29 外部カメラ' : 'B-29' };
    const inH8 = h8 && g.player.seat === h8.seat;
    if (inH8 && h8.zoom) {
      m.zoom = +h8.zoom.z.toFixed(1); m.mm = Math.round(h8.zoom.focal());
      const F = h8.hud && h8.hud.primary();
      if (F) { m.target = F.c.name; m.dist = Math.round(F.c.dist); }
    }
    return m;
  }

  capture(canvas) {
    this.pending = false;
    const meta = this.meta();
    const w = canvas.width, h = canvas.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(canvas, 0, 0);
    const tw = 320, th = Math.max(1, Math.round(320 * h / w));
    const t = document.createElement('canvas');
    t.width = tw; t.height = th;
    t.getContext('2d').drawImage(c, 0, 0, tw, th);
    this.count++;
    this.toast(t, meta);
    const enc = (cv, q) => new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
    Promise.all([enc(c, 0.92), enc(t, 0.8)]).then(([blob, thumb]) => { if (blob) this.store({ blob, thumb, meta, w, h, at: Date.now() }); });
  }

  async store(rec) {
    if (!this.db) { this.mem.push(Object.assign({ id: this.mem.length + 1 }, rec)); return; }
    try {
      await tx(this.db, 'readwrite', (s) => s.add(rec));
      // the oldest go when there are too many
      const keys = await tx(this.db, 'readonly', (s) => s.getAllKeys());
      if (keys.length > MAX) await tx(this.db, 'readwrite', (s) => { for (const k of keys.slice(0, keys.length - MAX)) s.delete(k); });
      this.count = Math.min(keys.length, MAX);
    } catch (e) { this.mem.push(Object.assign({ id: 1e9 + this.mem.length }, rec)); }
  }

  async all() {
    let list = [];
    if (this.db) { try { list = await tx(this.db, 'readonly', (s) => s.getAll()); } catch (e) { list = []; } }
    return list.concat(this.mem).sort((a, b) => b.at - a.at);
  }

  async remove(id) {
    this.mem = this.mem.filter((r) => r.id !== id);
    if (this.db) { try { await tx(this.db, 'readwrite', (s) => s.delete(id)); } catch (e) { /* gone already */ } }
    this.count = Math.max(0, this.count - 1);
  }

  /** a small picture of what was taken, for a moment, top right */
  toast(thumb, meta) {
    let el = document.getElementById('photo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'photo-toast';
      document.getElementById('hud').appendChild(el);
    }
    el.innerHTML = '';
    const img = document.createElement('img');
    img.src = thumb.toDataURL('image/jpeg', 0.8);
    const tx2 = document.createElement('span');
    tx2.textContent = `保存しました（${this.count}）${meta.zoom ? `  ×${meta.zoom}` : ''}`;
    el.append(img, tx2);
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('on'), 2200);
  }

  // ------------------------------------------------------------------ the gallery
  async openGallery() {
    let el = document.getElementById('photo-gallery');
    if (!el) {
      el = document.createElement('div');
      el.id = 'photo-gallery';
      el.innerHTML = `<div class="pg-head"><span class="pg-title">写真</span><button class="pg-btn" data-a="close">閉じる</button></div><div class="pg-grid"></div><div class="pg-view hidden"><img alt=""><div class="pg-info"></div><div class="pg-row"><button class="pg-btn" data-a="save">端末に保存</button><button class="pg-btn danger" data-a="del">削除</button><button class="pg-btn" data-a="back">一覧へ</button></div></div>`;
      document.getElementById('app').appendChild(el);
      for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      el.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        const act = a.dataset.a;
        if (act === 'close') this.closeGallery();
        else if (act === 'back') this.showGrid();
        else if (act === 'save' && this.cur) this.download(this.cur);
        else if (act === 'del' && this.cur) { const id = this.cur.id; this.remove(id).then(() => this.openGallery()); }
        else if (act === 'open') { const r = this.list.find((x) => String(x.id) === a.dataset.id); if (r) this.view(r); }
      });
    }
    this.gallery = el;
    el.classList.remove('hidden');
    this.g.input && (this.g.input.enabled = false);
    this.list = await this.all();
    this.showGrid();
  }

  closeGallery() {
    if (this.gallery) this.gallery.classList.add('hidden');
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls.length = 0;
    this.cur = null;
    if (this.g.input && this.g.running) this.g.input.enabled = true;
  }

  url(blob) { const u = URL.createObjectURL(blob); this.urls.push(u); return u; }

  showGrid() {
    const el = this.gallery;
    el.querySelector('.pg-view').classList.add('hidden');
    const grid = el.querySelector('.pg-grid');
    grid.classList.remove('hidden');
    grid.innerHTML = '';
    el.querySelector('.pg-title').textContent = `写真 ${this.list.length} 枚`;
    if (!this.list.length) { grid.innerHTML = `<div class="pg-empty">まだ写真がありません。H8 の座席でズームし、シャッター（◉）で撮影できます。</div>`; return; }
    for (const r of this.list) {
      const b = document.createElement('button');
      b.className = 'pg-cell'; b.dataset.a = 'open'; b.dataset.id = String(r.id);
      const img = document.createElement('img');
      img.src = this.url(r.thumb || r.blob);
      const cap = document.createElement('span');
      cap.textContent = `${r.meta.when}${r.meta.zoom ? `  ×${r.meta.zoom}` : ''}`;
      b.append(img, cap);
      grid.appendChild(b);
    }
  }

  view(r) {
    const el = this.gallery;
    this.cur = r;
    el.querySelector('.pg-grid').classList.add('hidden');
    const v = el.querySelector('.pg-view');
    v.classList.remove('hidden');
    v.querySelector('img').src = this.url(r.blob);
    const m = r.meta;
    v.querySelector('.pg-info').textContent = [m.when + ' (JST)', m.from, `高度 ${m.alt} km`, m.zoom ? `×${m.zoom}（${m.mm.toLocaleString()} mm 相当）` : null, m.target ? `${m.target}  ${m.dist < 9500 ? m.dist + ' m' : (m.dist / 1000).toFixed(1) + ' km'}` : null, `${r.w}×${r.h}`].filter(Boolean).join('   ');
  }

  download(r) {
    const a = document.createElement('a');
    a.href = this.url(r.blob);
    a.download = `B-29_${r.meta.when.replace(/[.: ]/g, '')}_${r.id}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
