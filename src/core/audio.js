// All sound is synthesised with WebAudio: noise bursts, filters and envelopes.
// Deliberately no bell-like tones: clicks, thumps and filtered noise only.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
  }

  // Must be called from a user gesture.
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Simple reverb tail for the valley.
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.5, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.5) * 0.6;
    }
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.startAmbience();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  noiseBurst({ at = 0, dur = 0.2, type = 'lowpass', freq = 1000, q = 0.7, gain = 0.5, attack = 0.002, wet = 0, freqEnd = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    if (wet) {
      const w = ctx.createGain();
      w.gain.value = wet;
      g.connect(w).connect(this.reverb);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  thump({ at = 0, freq = 60, dur = 0.3, gain = 0.6 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  rifleShot() {
    this.noiseBurst({ dur: 0.35, type: 'lowpass', freq: 5000, freqEnd: 600, gain: 0.9, wet: 1.2 });
    this.noiseBurst({ dur: 0.08, type: 'highpass', freq: 2500, gain: 0.5 });
    this.thump({ freq: 45, dur: 0.45, gain: 0.9 });
    // Rolling echo off the hills.
    this.noiseBurst({ at: 0.35, dur: 1.6, type: 'lowpass', freq: 700, freqEnd: 200, gain: 0.18, attack: 0.15 });
  }

  pistolShot() {
    this.noiseBurst({ dur: 0.09, type: 'bandpass', freq: 1400, q: 1.2, gain: 0.35 });
    this.noiseBurst({ dur: 0.05, type: 'lowpass', freq: 500, gain: 0.25 });
  }

  click(at = 0, freq = 2400, gain = 0.25) {
    this.noiseBurst({ at, dur: 0.035, type: 'bandpass', freq, q: 3, gain });
  }

  bolt() {
    this.click(0.25, 1800, 0.3);
    this.click(0.42, 1200, 0.25);
    this.click(0.75, 2000, 0.3);
    this.click(0.9, 1500, 0.35);
  }

  reload(time) {
    this.click(0.2, 1500);
    for (let i = 0; i < 5; i++) this.click(0.6 + i * (time - 1.2) / 5, 2600, 0.2);
    this.click(time - 0.4, 1800, 0.35);
  }

  dryFire() { this.click(0, 3000, 0.3); }

  hitConfirm(kill, head = false) {
    // Meaty body hit: a wet slap, a low thud, and a heavier knock for kills.
    this.noiseBurst({ at: 0.02, dur: 0.07, type: 'bandpass', freq: head ? 2200 : 1500, q: 1.5, gain: 0.55 });
    this.noiseBurst({ at: 0.02, dur: 0.22, type: 'lowpass', freq: 320, gain: 1.0 });
    this.thump({ at: 0.03, freq: 55, dur: 0.25, gain: 0.7 });
    if (kill) {
      this.thump({ at: 0.09, freq: 42, dur: 0.4, gain: 0.6 });
      this.noiseBurst({ at: 0.45, dur: 0.25, type: 'lowpass', freq: 250, gain: 0.35 }); // body hits the ground
    }
  }

  impact(distance) {
    const delay = Math.min(distance / 343, 1.5); // distant impacts arrive late
    const gain = Math.max(0.08, 0.6 - distance / 1200);
    this.noiseBurst({ at: delay, dur: 0.2, type: 'lowpass', freq: 900, gain });
    this.thump({ at: delay, freq: 80, dur: 0.12, gain: gain * 0.6 });
  }

  // ---- masking sources ----
  // A distant artillery boom: arrives late, rolls on for seconds. No tonal ring.
  artillery(distance) {
    const at = Math.min(distance / 343, 5);
    const g = Math.max(0.25, 1.1 - distance / 3000);
    this.thump({ at, freq: 34, dur: 1.6, gain: g });
    this.noiseBurst({ at, dur: 2.6, type: 'lowpass', freq: 260, freqEnd: 70, gain: g * 0.8, attack: 0.05, wet: 0.8 });
  }

  // Continuous engine drones; level 0..1 sets how loud they are.
  drone(key, build) {
    if (!this.ctx) return null;
    if (!this[key]) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      build(g);
      g.connect(this.master);
      this[key] = g;
    }
    return this[key];
  }

  setPlane(level) {
    const g = this.drone('planeGain', (out) => {
      for (const [f, gain] of [[62, 0.5], [93, 0.35], [124, 0.2]]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 380;
        const og = this.ctx.createGain();
        og.gain.value = gain;
        o.connect(lp).connect(og).connect(out);
        o.start();
      }
      const n = this.ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      const nf = this.ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 500;
      const ng = this.ctx.createGain(); ng.gain.value = 0.6;
      n.connect(nf).connect(ng).connect(out); n.start();
    });
    if (g) g.gain.setTargetAtTime(level * level * 0.45, this.ctx.currentTime, 0.3);
  }

  setGenerator(level) {
    const g = this.drone('genGain', (out) => {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 50;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      o.connect(lp).connect(out); o.start();
      const n = this.ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 1.5;
      const ng = this.ctx.createGain(); ng.gain.value = 0.5;
      n.connect(bp).connect(ng).connect(out); n.start();
    });
    if (g) g.gain.setTargetAtTime(level * level * 0.25, this.ctx.currentTime, 0.2);
  }

  // ---- ambience ----
  // A small songbird: two to four quick, soft whistled slides. Short and breathy (filtered
  // noise shaped into a pitch sweep), never a ringing tone.
  birdCall() {
    if (!this.ctx) return;
    const n = 2 + Math.floor(Math.random() * 3), base = 2600 + Math.random() * 1400, far = 0.25 + Math.random() * 0.5;
    for (let i = 0; i < n; i++) {
      const f = base * (0.9 + Math.random() * 0.25);
      this.noiseBurst({ at: i * (0.09 + Math.random() * 0.05), dur: 0.07, type: 'bandpass', freq: f, freqEnd: f * (Math.random() < 0.5 ? 1.35 : 0.75), q: 18, gain: 0.5 * far, attack: 0.01 });
    }
  }

  // ---- weak spots ----
  // A bullet on metal: a dull knock with a short gritty scrape (no ring).
  metalHit(distance) {
    const at = Math.min(distance / 343, 1.2), k = Math.max(0.15, 1 - distance / 500);
    this.noiseBurst({ at, dur: 0.06, type: 'bandpass', freq: 1800, q: 1.2, gain: 0.45 * k });
    this.thump({ at, freq: 140, dur: 0.1, gain: 0.35 * k });
  }

  generatorDie() {
    this.noiseBurst({ dur: 0.5, type: 'lowpass', freq: 600, freqEnd: 120, gain: 0.35 });
    this.thump({ freq: 45, dur: 0.6, gain: 0.4 });
  }

  explosion(distance) {
    const at = Math.min(distance / 343, 2), k = Math.max(0.2, 1 - distance / 900);
    this.noiseBurst({ at, dur: 1.4, type: 'lowpass', freq: 2400 * k + 300, freqEnd: 120, gain: 1.0 * k, wet: 1.5 });
    this.thump({ at, freq: 34, dur: 1.2, gain: 1.0 * k });
    this.noiseBurst({ at: at + 0.4, dur: 2.5, type: 'lowpass', freq: 500, freqEnd: 120, gain: 0.3 * k, attack: 0.3 });
  }

  // A knife takedown: a muffled thump and a short scuffle of cloth.
  knife() {
    this.thump({ freq: 90, dur: 0.18, gain: 0.45 });
    this.noiseBurst({ dur: 0.12, type: 'lowpass', freq: 900, gain: 0.3 });
    this.noiseBurst({ at: 0.1, dur: 0.4, type: 'bandpass', freq: 1300, q: 0.8, gain: 0.12, attack: 0.05 });
  }

  // ---- combat ----
  // A guard's rifle shot heard from `distance` metres: later, duller and quieter far off.
  enemyShot(distance) {
    const at = Math.min(distance / 343, 1.2), k = Math.max(0.12, 1 - distance / 400);
    this.noiseBurst({ at, dur: 0.3, type: 'lowpass', freq: 600 + 3600 * k, freqEnd: 400, gain: 0.7 * k, wet: 1 });
    this.thump({ at, freq: 50, dur: 0.35, gain: 0.6 * k });
    this.noiseBurst({ at: at + 0.3, dur: 1.2, type: 'lowpass', freq: 600, freqEnd: 200, gain: 0.12 * k, attack: 0.15 });
  }

  // A bullet passing close: the supersonic crack, then a whizz.
  crack() {
    this.noiseBurst({ dur: 0.025, type: 'highpass', freq: 3000, gain: 0.55 });
    this.noiseBurst({ at: 0.01, dur: 0.16, type: 'bandpass', freq: 2200, freqEnd: 900, q: 1.5, gain: 0.18 });
  }

  // Being hit.
  hurt() {
    this.thump({ freq: 70, dur: 0.35, gain: 0.8 });
    this.noiseBurst({ dur: 0.25, type: 'lowpass', freq: 500, gain: 0.45 });
  }

  // Air-raid style wail, pitch rising and falling (no bells).
  setSiren(level) {
    const g = this.drone('sirenGain', (out) => {
      const lfo = this.ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = 0.2;
      const depth = this.ctx.createGain();
      depth.gain.value = 210;
      lfo.connect(depth);
      for (const det of [0, 5]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 480 + det;
        depth.connect(o.frequency);
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
        const og = this.ctx.createGain(); og.gain.value = 0.4;
        o.connect(lp).connect(og).connect(out);
        o.start();
      }
      lfo.start();
    });
    if (g) g.gain.setTargetAtTime(level * 0.2, this.ctx.currentTime, 0.6);
  }

  setTruck(level) {
    const g = this.drone('truckGain', (out) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 38;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      o.connect(lp).connect(out); o.start();
      const n = this.ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      const nf = this.ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 400;
      const ng = this.ctx.createGain(); ng.gain.value = 0.5;
      n.connect(nf).connect(ng).connect(out); n.start();
    });
    if (g) g.gain.setTargetAtTime(level * level * 0.35, this.ctx.currentTime, 0.3);
  }

  // A guard noticing something: a short muttered "huh" stand-in (filtered noise, no tone).
  alertCue(level) {
    this.noiseBurst({ dur: level > 1 ? 0.35 : 0.2, type: 'bandpass', freq: level > 1 ? 900 : 650, q: 2, gain: level > 1 ? 0.35 : 0.2 });
  }

  // ---- kill cam ----
  killcamWhoosh(dur) {
    // The bullet's slowed-down rush: a rising, filtered roar.
    this.noiseBurst({ dur: dur + 0.3, type: 'bandpass', freq: 180, freqEnd: 900, q: 1.2, gain: 0.35, attack: 0.25 });
    this.thump({ freq: 32, dur: 1.2, gain: 0.5 });
  }

  killcamImpact() {
    this.thump({ freq: 48, dur: 0.9, gain: 0.9 });
    this.noiseBurst({ dur: 0.5, type: 'lowpass', freq: 400, gain: 0.8 });
  }

  boneCrack() {
    this.noiseBurst({ dur: 0.06, type: 'bandpass', freq: 2600, q: 2, gain: 0.6 });
    this.noiseBurst({ at: 0.02, dur: 0.25, type: 'bandpass', freq: 900, q: 1.5, gain: 0.45 });
    this.thump({ at: 0.01, freq: 90, dur: 0.15, gain: 0.4 });
  }

  organHit() {
    this.noiseBurst({ dur: 0.35, type: 'lowpass', freq: 520, freqEnd: 160, gain: 0.7 });
    this.noiseBurst({ at: 0.03, dur: 0.2, type: 'bandpass', freq: 700, q: 0.8, gain: 0.3 });
  }

  // Cloth and webbing being rummaged through.
  rustle() {
    this.noiseBurst({ dur: 0.18, type: 'bandpass', freq: 1800 + Math.random() * 1500, q: 0.7, gain: 0.12, attack: 0.03 });
  }

  pickup() {
    this.click(0, 1600, 0.3);
    this.click(0.07, 2200, 0.25);
    this.noiseBurst({ at: 0.05, dur: 0.12, type: 'lowpass', freq: 600, gain: 0.25 });
  }

  step(stance) {
    const gain = stance === 'prone' ? 0.05 : stance === 'crouch' ? 0.09 : 0.14;
    this.noiseBurst({ dur: 0.09, type: 'bandpass', freq: 500 + Math.random() * 300, q: 0.8, gain });
  }

  breathIn() { this.noiseBurst({ dur: 0.5, type: 'bandpass', freq: 900, q: 0.6, gain: 0.06, attack: 0.2 }); }
  breathOut() { this.noiseBurst({ dur: 0.7, type: 'bandpass', freq: 600, q: 0.6, gain: 0.07, attack: 0.05 }); }

  startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    this.windFilter = f;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    this.windGain = g;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  // Wind ambience follows the actual wind speed.
  setWind(speed) {
    if (!this.windGain) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.025 + speed * 0.012, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(250 + speed * 80, t, 0.5);
  }
}
