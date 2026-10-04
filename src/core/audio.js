// Procedural WebAudio engine: cabin bus (muffled by low pressure / vacuum), suit bus, HRTF
// positional sources in ship space, synthesized effects, alarms and a generative ambient radio.
import * as THREE from 'three';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.cabinLevel = 1;     // 0..1 audible through air
    this.loops = new Map();
    this.musicOn = false;
    this.listenerPos = new THREE.Vector3();
    this.listenerQuat = new THREE.Quaternion();
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    // reverb (small metal room)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 2.8);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.28;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    // cabin bus with air-dependent low-pass
    this.cabin = ctx.createGain();
    this.cabinLP = ctx.createBiquadFilter(); this.cabinLP.type = 'lowpass'; this.cabinLP.frequency.value = 18000;
    this.cabin.connect(this.cabinLP); this.cabinLP.connect(this.master); this.cabinLP.connect(this.reverb);
    // suit / direct bus (not muffled)
    this.direct = ctx.createGain(); this.direct.connect(this.master);
    // noise buffers
    this.white = this._noise('white');
    this.pink = this._noise('pink');
    this.brown = this._noise('brown');
    const L = ctx.listener;
    if (L.positionX) { L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0; }
    this.ready = true;
    // silent buffer to unlock iOS
    const b = ctx.createBufferSource(); b.buffer = ctx.createBuffer(1, 1, 22050); b.connect(ctx.destination); b.start();
  }

  _noise(type) {
    const ctx = this.ctx, len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w * 0.5;
      else if (type === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    }
    return buf;
  }

  _impulse(dur, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 + 0.5 * Math.sin(i * 0.013 + c));
      }
    }
    return buf;
  }

  /** positional panner (ship-local position) */
  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.8; p.maxDistance = 60; p.rolloffFactor = 1.2;
    this._setPannerPos(p, pos);
    return p;
  }

  _setPannerPos(p, pos) {
    // convert ship-local to listener space (sources the listener has left far behind — B-29's
    // machinery while Kaito flies H8 — are pushed out of earshot)
    const v = pos.clone().sub(this.listenerPos).applyQuaternion(this.listenerQuat.clone().invert());
    if (this.mutePred && this.mutePred(pos)) v.set(0, 0, 5000);
    if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; }
    else p.setPosition(v.x, v.y, v.z);
  }

  setListener(posLocal, quatLocal) {
    this.listenerPos.copy(posLocal);
    this.listenerQuat.copy(quatLocal);
    if (!this.ready) return;
    for (const L of this.loops.values()) if (L.panner && L.pos) this._setPannerPos(L.panner, L.pos);
  }

  /** air pressure in kPa where the listener is (0 = vacuum) and suit state */
  setAir(kPa, suit) {
    if (!this.ready) return;
    const k = Math.max(0, Math.min(1, kPa / 60));
    this.cabinLevel = k;
    const t = this.ctx.currentTime;
    this.cabin.gain.setTargetAtTime(suit ? 0.25 + 0.6 * k : 0.05 + 0.95 * k, t, 0.2);
    this.cabinLP.frequency.setTargetAtTime(suit ? 900 + 3000 * k : 300 + 17000 * k * k, t, 0.2);
  }

  // ---------------------------------------------------------------- loops
  loop(id, make) {
    if (!this.ready) return null;
    let L = this.loops.get(id);
    if (!L) { L = make(); this.loops.set(id, L); }
    return L;
  }

  stopLoop(id) {
    const L = this.loops.get(id);
    if (!L) return;
    const t = this.ctx.currentTime;
    L.gain.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => { try { L.nodes.forEach((n) => n.stop && n.stop()); } catch (e) {} }, 800);
    this.loops.delete(id);
  }

  /** continuous noise-based loop (fans, hiss, wind, water) */
  noiseLoop(id, { pos = null, type = 'pink', freq = 800, q = 0.7, gain = 0.2, filter = 'bandpass', direct = false } = {}) {
    return this.loop(id, () => {
      const ctx = this.ctx;
      const src = ctx.createBufferSource(); src.buffer = this[type]; src.loop = true;
      src.loopStart = Math.random(); src.playbackRate.value = 0.95 + Math.random() * 0.1;
      const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g);
      let panner = null;
      if (pos) { panner = this._panner(pos); g.connect(panner); panner.connect(direct ? this.direct : this.cabin); }
      else g.connect(direct ? this.direct : this.cabin);
      src.start();
      g.gain.setTargetAtTime(gain, ctx.currentTime, 0.3);
      return { nodes: [src], gain: g, filter: f, panner, pos, src };
    });
  }

  /** tonal hum loop (machinery) */
  humLoop(id, { pos = null, freq = 55, gain = 0.06, harm = [1, 0.5, 0.25, 0.12] } = {}) {
    return this.loop(id, () => {
      const ctx = this.ctx;
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const nodes = [];
      harm.forEach((a, i) => {
        const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = freq * (i + 1) * (1 + (Math.random() - 0.5) * 0.004);
        const og = ctx.createGain(); og.gain.value = a;
        o.connect(og); og.connect(lp); o.start(); nodes.push(o);
      });
      lp.connect(g);
      let panner = null;
      if (pos) { panner = this._panner(pos); g.connect(panner); panner.connect(this.cabin); } else g.connect(this.cabin);
      g.gain.setTargetAtTime(gain, ctx.currentTime, 0.5);
      return { nodes, gain: g, panner, pos, oscs: nodes, base: freq };
    });
  }

  setLoopGain(id, v, tc = 0.2) {
    const L = this.loops.get(id);
    if (L) L.gain.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  setLoopFreq(id, f) {
    const L = this.loops.get(id);
    if (!L) return;
    if (L.filter) L.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.1);
    if (L.oscs) L.oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * (i + 1), this.ctx.currentTime, 0.2));
  }

  setLoopPos(id, pos) {
    const L = this.loops.get(id);
    if (L && L.panner) { L.pos = pos; this._setPannerPos(L.panner, pos); }
  }

  // ---------------------------------------------------------------- one-shots
  _out(pos, direct) {
    if (pos) { const p = this._panner(pos); p.connect(direct ? this.direct : this.cabin); return p; }
    return direct ? this.direct : this.cabin;
  }

  beep(freq = 880, dur = 0.08, gain = 0.15, { pos = null, type = 'sine', direct = false, when = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006); g.gain.setValueAtTime(gain, t + dur - 0.02); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this._out(pos, direct));
    o.start(t); o.stop(t + dur + 0.05);
  }

  chime() {
    this.beep(1046, 0.18, 0.08, { direct: true });
    this.beep(1568, 0.3, 0.07, { direct: true, when: 0.12 });
  }

  click(pos, gain = 0.25) {
    if (!this.ready) return;
    this._burst(pos, { dur: 0.025, freq: 3200, q: 2, gain, type: 'white' });
    this.beep(2400, 0.015, gain * 0.3, { pos });
  }

  _burst(pos, { dur = 0.2, freq = 1000, q = 1, gain = 0.3, type = 'white', filter = 'bandpass', attack = 0.002, sweep = 0, direct = false } = {}) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this[type];
    s.loopStart = 0; const off = Math.random() * 2;
    const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(this._out(pos, direct));
    s.start(t, off, dur + 0.1);
  }

  /** hull impact: deep thump + debris rattle + metallic ring; size 0..1 */
  impact(pos, size = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // structure-borne: audible even in vacuum (through the hull) -> direct bus partially
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70 + 50 * (1 - size), t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * (0.3 + size), t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4 + size);
    o.connect(g); g.connect(this.direct); o.start(t); o.stop(t + 3);
    this._burst(null, { dur: 0.5 + size, freq: 400, q: 0.5, gain: 0.6 * (0.3 + size), type: 'brown', filter: 'lowpass', direct: true });
    this._burst(pos, { dur: 1.2 + size * 2, freq: 2500, q: 0.8, gain: 0.25 * (0.2 + size), type: 'white', sweep: 0.3 });
    // metallic ring (inharmonic partials)
    for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.3], [8.93, 0.18]]) {
      const r = ctx.createOscillator(); r.type = 'sine'; r.frequency.value = (180 + Math.random() * 80) * m;
      const rg = ctx.createGain(); rg.gain.setValueAtTime(0.06 * a * (0.3 + size), t); rg.gain.exponentialRampToValueAtTime(0.0005, t + 2.5 + size * 2);
      r.connect(rg); rg.connect(this._out(pos, false)); r.start(t); r.stop(t + 5);
    }
    // creaks afterwards
    for (let i = 0; i < 2 + size * 4; i++) setTimeout(() => this.creak(pos, size), 400 + Math.random() * 2500);
  }

  creak(pos, size = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 60 + Math.random() * 90;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (0.7 + Math.random() * 0.6), t + 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 900; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * (0.4 + size), t + 0.1); g.gain.linearRampToValueAtTime(0, t + 0.8);
    o.connect(bp); bp.connect(g); g.connect(this._out(pos, false)); o.start(t); o.stop(t + 1);
  }

  doorMotor(pos, open) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(open ? 90 : 110, t); o.frequency.linearRampToValueAtTime(open ? 140 : 80, t + 1.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.1); g.gain.setValueAtTime(0.07, t + 1.0); g.gain.linearRampToValueAtTime(0, t + 1.3);
    o.connect(lp); lp.connect(g); g.connect(this._out(pos)); o.start(t); o.stop(t + 1.4);
    this._burst(pos, { dur: 0.35, freq: 1800, q: 0.6, gain: 0.08, type: 'pink' }); // seal hiss
    setTimeout(() => this._burst(pos, { dur: 0.25, freq: 160, q: 0.8, gain: 0.25, type: 'brown', filter: 'lowpass' }), 1200);
  }

  denied(pos) {
    this.beep(220, 0.12, 0.12, { pos, type: 'square' });
    this.beep(180, 0.16, 0.12, { pos, type: 'square', when: 0.14 });
  }

  rcsPuff(pos, gain = 0.2) {
    if (!this.ready) return;
    this._burst(pos, { dur: 0.18, freq: 900, q: 0.4, gain: gain * this.cabinLevel * 0.5 + gain * 0.2, type: 'pink', direct: false });
  }

  splash(size = 1) {
    if (!this.ready) return;
    this._burst(null, { dur: 2.5, freq: 900, q: 0.4, gain: 0.8 * size, type: 'white', filter: 'lowpass', sweep: 0.2, direct: true });
  }

  // ---------------------------------------------------------------- alarm
  alarm(on, kind = 'master') {
    if (!this.ready) return;
    if (!on) { if (this._alarm) { this._alarm.stop(); this._alarm = null; } return; }
    if (this._alarm) return;
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.0;
    const o1 = ctx.createOscillator(); o1.type = 'square';
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth';
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 1.6;
    const lfoG = ctx.createGain(); lfoG.gain.value = 260;
    o1.frequency.value = 760; o2.frequency.value = 762;
    lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o2.frequency);
    const ws = ctx.createWaveShaper();
    const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); }
    ws.curve = curve;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.7;
    o1.connect(ws); o2.connect(ws); ws.connect(bp); bp.connect(g); g.connect(this.direct);
    const t = ctx.currentTime;
    g.gain.setTargetAtTime(0.16, t, 0.05);
    o1.start(); o2.start(); lfo.start();
    this._alarm = { stop: () => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => { o1.stop(); o2.stop(); lfo.stop(); }, 400); } };
  }

  // ---------------------------------------------------------------- music (5G radio)
  setMusic(on) {
    this.musicOn = on;
    if (!this.ready) return;
    if (on && !this._music) this._startMusic();
    if (!on && this._music) { this._music.stop(); this._music = null; }
  }

  _startMusic() {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0;
    const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.48;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    delay.connect(fb); fb.connect(delay);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    out.connect(lp); lp.connect(this.cabin); lp.connect(delay); delay.connect(this.cabin); lp.connect(this.reverb);
    out.gain.setTargetAtTime(0.22, ctx.currentTime, 2);
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    const roots = [45, 41, 48, 43]; // A, F, C, G (midi)
    let step = 0, chordIdx = 0;
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const pads = [];
    const playPad = (root) => {
      for (const p of pads.splice(0)) { p.g.gain.setTargetAtTime(0, ctx.currentTime, 1.5); setTimeout(() => p.o.forEach((o) => o.stop()), 5000); }
      for (const iv of [0, 7, 12, 16, 19]) {
        const g = ctx.createGain(); g.gain.value = 0;
        const os = [];
        for (const det of [-6, 5]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(root + iv); o.detune.value = det;
          o.connect(g); o.start(); os.push(o);
        }
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.3;
        g.disconnect(); g.connect(f); f.connect(out);
        g.gain.setTargetAtTime(0.022, ctx.currentTime, 2.5);
        pads.push({ g, o: os });
      }
    };
    playPad(roots[0]);
    const tick = () => {
      if (!this._music) return;
      const t = ctx.currentTime;
      if (step % 32 === 0) { chordIdx = (chordIdx + 1) % roots.length; playPad(roots[chordIdx]); }
      if (Math.random() < 0.55) {
        const n = roots[chordIdx] + 24 + scale[Math.floor(Math.random() * scale.length)];
        const o = ctx.createOscillator(); o.type = Math.random() < 0.5 ? 'sine' : 'triangle'; o.frequency.value = midi(n);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.2);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 2.4);
      }
      step++;
    };
    const iv = setInterval(tick, 480);
    this._music = { stop: () => { clearInterval(iv); out.gain.setTargetAtTime(0, ctx.currentTime, 1.2); setTimeout(() => pads.forEach((p) => p.o.forEach((o) => o.stop())), 4000); } };
  }

  // ---------------------------------------------------------------- body sounds
  heartbeat(rate) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (rate <= 0) return;
    if (this._hbNext && now < this._hbNext) return;
    this._hbNext = now + 60 / rate;
    this.beep(48, 0.12, 0.35, { direct: true });
    this.beep(42, 0.1, 0.25, { direct: true, when: 0.22 });
  }

  breath(active, rate = 0.25) {
    if (!this.ready) return;
    if (!active) { this.stopLoop('breath'); return; }
    const L = this.noiseLoop('breath', { type: 'pink', freq: 1200, q: 0.5, gain: 0.0, direct: true });
    const t = this.ctx.currentTime;
    const ph = (t * rate) % 1;
    L.gain.gain.setTargetAtTime(ph < 0.4 ? 0.07 * Math.sin(ph / 0.4 * Math.PI) : 0.02, t, 0.08);
  }
}
