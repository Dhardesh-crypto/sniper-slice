// Sound is synthesised with WebAudio (noise bursts, filters and envelopes), except the
// weapons: each gun's shot (and the suppressed versions), the bolt and the reloads are
// recorded-style samples in public/sounds (made with ElevenLabs Sound Effects). Until they
// have loaded, or if they can't, the synthesised versions play instead.
// Deliberately no bell-like tones: clicks, thumps and filtered noise. The one pitched sound
// is the whistle, a lip whistle: a smooth, sustained gliding tone, nothing struck or ringing.

// Which sample each weapon fires, and how loud it plays (they're levelled by ear-ish: mean
// loudness, then rifles over pistols, suppressed well under both).
const SHOTS = {
  springfield: ['shot_springfield', 1.0], enfield: ['shot_enfield', 0.9], g43: ['shot_g43', 0.65],
  m1carbine: ['shot_m1carbine', 0.75], delisle: ['shot_delisle', 0.5], welrod: ['shot_welrod', 0.22],
  p38: ['shot_p38', 0.25], luger: ['shot_luger', 0.3],
  trenchgun: ['shot_trenchgun', 0.85], mg42: ['shot_mg42', 0.5], panzerschreck: ['shot_panzerschreck', 0.8],
  panzerfaust: ['shot_panzerfaust', 0.6], piat: ['shot_piat', 0.75],
};
const SUPPRESSED = { bolt: ['shot_rifle_suppressed', 0.1], semi: ['shot_semi_suppressed', 0.55], pistol: ['shot_pistol_suppressed', 0.2] };
const RELOADS = {
  springfield: 'reload_stripper', enfield: 'reload_stripper', g43: 'reload_g43', m1carbine: 'reload_m1carbine',
  delisle: 'reload_delisle', welrod: 'reload_welrod', p38: 'reload_pistol', luger: 'reload_pistol',
  trenchgun: 'reload_shotgun', mg42: 'reload_mg42', panzerschreck: 'reload_rocket', panzerfaust: 'reload_rocket', piat: 'reload_piat',
};
// For the sound check in the settings: every weapon sample, at the level it plays in the game.
export const SOUND_CHECK = [
  ['Springfield', ...SHOTS.springfield], ['Lee-Enfield', ...SHOTS.enfield], ['Gewehr 43', ...SHOTS.g43],
  ['M1 Carbine', ...SHOTS.m1carbine], ['De Lisle', ...SHOTS.delisle], ['Rifle + suppressor', ...SUPPRESSED.bolt],
  ['Semi-auto + suppressor', ...SUPPRESSED.semi], ['Walther P38', ...SHOTS.p38], ['Luger P08', ...SHOTS.luger],
  ['Welrod', ...SHOTS.welrod], ['Pistol + suppressor', ...SUPPRESSED.pistol], ['Bolt', 'bolt', 0.6],
  ['Reload: stripper clip', 'reload_stripper', 0.7], ['Reload: G43', 'reload_g43', 0.7], ['Reload: M1 Carbine', 'reload_m1carbine', 0.7],
  ['Reload: De Lisle', 'reload_delisle', 0.7], ['Reload: pistol', 'reload_pistol', 0.7], ['Reload: Welrod', 'reload_welrod', 0.7],
  ['Trench Gun', ...SHOTS.trenchgun], ['Shotgun pump', 'pump', 0.6], ['MG42', ...SHOTS.mg42], ['Panzerschreck', ...SHOTS.panzerschreck], ['Panzerfaust', ...SHOTS.panzerfaust],
  ['PIAT', ...SHOTS.piat], ['Explosion: grenade', 'explosion_grenade', 0.9], ['Explosion: vehicle', 'explosion_large', 1.0],
  ['Explosion: far off', 'explosion_far', 0.9], ['Guard: body found', 'vo_body_1', 0.7], ['Guard: spotted you', 'vo_spotted_1', 0.7],
  ['Guard: heard something', 'vo_suspicious_2', 0.5], ['Reload: shotgun', 'reload_shotgun', 0.7], ['Reload: MG42', 'reload_mg42', 0.7],
  ['Reload: rocket', 'reload_rocket', 0.7], ['Reload: PIAT', 'reload_piat', 0.7],
];
const EXTRA = ['explosion_grenade', 'explosion_large', 'explosion_far', 'mg42_tail', 'pump', 'tank_tracks', 'tank_turret', 'army_truck', 'truck_start', 'siren'];
// Guards' shouts (German, three voices each): finding a body, spotting you, hearing something.
const SHOUTS = { body: ['vo_body_1', 'vo_body_2', 'vo_body_3'], spotted: ['vo_spotted_1', 'vo_spotted_2', 'vo_spotted_3'], suspicious: ['vo_suspicious_1', 'vo_suspicious_2', 'vo_suspicious_3'] };
EXTRA.push(...Object.values(SHOUTS).flat());
// A guard dog's barks (Pixabay, cut from two recordings; see public/sounds/CREDITS.md).
const BARKS = Array.from({ length: 11 }, (_, i) => `dog_bark_${i + 1}`);   // (7–11: a German shepherd)
EXTRA.push(...BARKS);
// Spent brass landing (Pixabay: eleven drops of .30 and mixed-size cases bouncing; CREDITS.md).
const CASINGS = Array.from({ length: 11 }, (_, i) => `casing_${i + 1}`);
EXTRA.push(...CASINGS);
// The music's level under the effects at 100% on the music slider.
const MUSIC_LEVEL = 0.5;
const SAMPLES = [...new Set([...Object.values(SHOTS), ...Object.values(SUPPRESSED)].map(([n]) => n).concat(Object.values(RELOADS), ['bolt'], EXTRA))];

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicVolume = 0.5;
  }

  // Must be called from a user gesture. (An OfflineAudioContext can be passed in to render
  // sounds for checking; then there's no ambience.)
  start(offline = null) {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = offline ?? new AudioContext();
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
    if (!offline) this.startAmbience();
    this.samples = {};
    this.loading = this.loadSamples();
  }

  // The sound check: start the audio if needed, wait for the samples, play one.
  async check(name, gain) {
    this.start();
    await this.loading;
    this.sample(name, { gain });
  }

  async loadSamples() {
    await Promise.all(SAMPLES.map(async (name) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}sounds/${name}.mp3`);
        this.samples[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* missing or undecodable: the synthesised sound stays */ }
    }));
    if (this.sirenLevel > 0) { const l = this.sirenLevel; this.sirenLevel = 0; this.setSiren(l); }   // a siren already sounding takes the recording
  }

  // Play a sample; false if it isn't loaded (the caller then synthesises). rate: playback
  // speed; filter: a low-pass cutoff (distance); wet: how much goes to the valley reverb.
  sample(name, { at = 0, gain = 1, rate = 1, filter = null, wet = 0 } = {}) {
    const buf = this.samples?.[name];
    if (!this.ctx || !buf) return false;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);   // never quite the same twice
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = src;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; node = node.connect(f); }
    node.connect(g).connect(this.master);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w).connect(this.reverb); }
    src.start(t);
    return true;
  }

  // Your shot with this weapon (a built weapon def: its id, and whether a suppressor is on).
  weaponShot(def) {
    const own = SHOTS[def.id];
    const integral = def.id === 'welrod' || def.integralSuppressor;
    const [name, gain] = def.suppressor && !integral ? SUPPRESSED[def.slot === 'pistol' ? 'pistol' : def.semi ? 'semi' : 'bolt'] : own ?? SHOTS.springfield;
    if (this.sample(name, { gain, wet: def.suppressor ? 0 : 0.12 })) return;
    if (def.slot === 'pistol') def.suppressor ? this.pistolShot() : this.pistolLoud();
    else def.suppressor ? this.suppressedRifleShot() : this.rifleShot();
  }

  // A guard calls out (`kind`: body, spotted, suspicious) from `distance` m: louder and clearer
  // close by, gone beyond ~70 m, and never two at once (the rest just join in silently).
  shout(kind, distance) {
    const now = this.ctx?.currentTime ?? 0;
    if (now < (this.shoutUntil ?? 0) || distance > 70) return;
    const list = SHOUTS[kind], name = list[Math.floor(Math.random() * list.length)];
    const k = Math.max(0, 1 - distance / 70);
    if (this.sample(name, { at: distance / 343, gain: (kind === 'suspicious' ? 0.45 : 0.7) * k ** 0.8, filter: 2500 + 15000 * k, wet: 0.25 })) {
      this.shoutUntil = now + (this.samples[name]?.duration ?? 1.5);
    }
  }

  // Racking the shotgun's pump after a shot.
  pump() { this.sample('pump', { at: 0.25, gain: 0.6 }); }

  // The echo rolling away after a machine-gun burst.
  burstTail() { this.sample('mg42_tail', { gain: 0.8, wet: 0.2 }); }

  // The reload for this weapon, stretched a little to fit its reload time.
  reloadFor(def, time) {
    const name = RELOADS[def.id], buf = this.samples?.[name];
    if (buf && this.sample(name, { gain: 0.7, rate: Math.min(1.15, Math.max(0.85, buf.duration / (time * 0.92))) })) return;
    this.reload(time);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ---- music ----
  // Each mission has a quiet looping score (public/sounds/music_<mission>.mp3, made with
  // MusicGen) and shares one tense alarm loop; both play from the start, in step, and the
  // alarm fades in over the calm one while the siren sounds. The kill cam ducks the lot.
  // The music sits well under the effects so footsteps and the guards' voices stay clear.
  async startMusic(track) {
    if (!this.ctx || this.music) return;
    const ctx = this.ctx;
    const bus = ctx.createGain(); bus.gain.value = 0;
    const duck = ctx.createGain();
    bus.connect(duck).connect(this.master);
    this.music = { bus, duck, layers: {}, alarm: false, ducked: false };
    const load = async (name) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}sounds/music_${name}.mp3`);
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch { return null; }   // missing or undecodable: no music, the game plays on
    };
    const [calm, alarm] = await Promise.all([load(track), load('alarm')]);
    const t = ctx.currentTime + 0.05;
    for (const [key, buf] of [['calm', calm], ['alarm', alarm]]) {
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const g = ctx.createGain();
      g.gain.value = (key === 'alarm') === this.music.alarm ? 1 : 0;
      src.connect(g).connect(bus);
      src.start(t);
      this.music.layers[key] = { src, g };
    }
    bus.gain.setTargetAtTime(this.musicVolume * MUSIC_LEVEL, t, 1.5);   // eases in
  }

  // The siren is sounding: the alarm loop takes over quickly, and hands back slowly.
  setMusicAlarm(on) {
    const m = this.music;
    if (!m || m.alarm === on) return;
    m.alarm = on;
    const t = this.ctx.currentTime;
    m.layers.calm?.g.gain.setTargetAtTime(on ? 0 : 1, t, on ? 0.6 : 2.5);
    m.layers.alarm?.g.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.4 : 2.5);
  }

  // Under the kill cam the music drops right back.
  duckMusic(on) {
    const m = this.music;
    if (!m || m.ducked === on) return;
    m.ducked = on;
    m.duck.gain.setTargetAtTime(on ? 0.15 : 1, this.ctx.currentTime, on ? 0.15 : 0.8);
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music) this.music.bus.gain.setTargetAtTime(v * MUSIC_LEVEL, this.ctx.currentTime, 0.05);
  }

  // The mission is over (done, dead or failed): the music fades away.
  stopMusic() {
    if (this.music) this.music.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2);
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

  // A rifle through a suppressor (or the De Lisle): a muffled thump and the action, no crack.
  suppressedRifleShot() {
    this.noiseBurst({ dur: 0.12, type: 'bandpass', freq: 900, q: 1.1, gain: 0.45 });
    this.noiseBurst({ dur: 0.07, type: 'lowpass', freq: 400, gain: 0.35 });
    this.thump({ freq: 70, dur: 0.15, gain: 0.3 });
  }

  // An unsuppressed pistol (the P38): a sharp crack with a short tail.
  pistolLoud() {
    this.noiseBurst({ dur: 0.16, type: 'lowpass', freq: 4500, freqEnd: 800, gain: 0.6, wet: 0.6 });
    this.noiseBurst({ dur: 0.05, type: 'highpass', freq: 2500, gain: 0.35 });
    this.thump({ freq: 90, dur: 0.18, gain: 0.4 });
  }

  pistolShot() {
    this.noiseBurst({ dur: 0.09, type: 'bandpass', freq: 1400, q: 1.2, gain: 0.35 });
    this.noiseBurst({ dur: 0.05, type: 'lowpass', freq: 500, gain: 0.25 });
  }

  click(at = 0, freq = 2400, gain = 0.25) {
    this.noiseBurst({ at, dur: 0.035, type: 'bandpass', freq, q: 3, gain });
  }

  bolt() {
    if (this.sample('bolt', { at: 0.25, gain: 0.6 })) return;
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

  // ---- items ----
  // A two-note "fweet-fwoo" lip whistle, the way you'd call someone over.
  whistle() {
    const v = 0.97 + Math.random() * 0.06;        // never quite the same pitch twice
    this.whistleNote({ at: 0, dur: 0.24, pitch: [1250, 1900, 2150].map(f => f * v), gain: 0.22 });
    this.whistleNote({ at: 0.32, dur: 0.42, pitch: [2050, 2150, 1850, 1450].map(f => f * v), gain: 0.2 });
  }

  // One whistled note: a sine whose pitch follows `pitch` (Hz, spread over the note) with a
  // quick scoop into it, a light vibrato, a soft swell and fade, a faint breathy edge and a
  // little of the valley's echo.
  whistleNote({ at = 0, dur = 0.3, pitch = [1800, 2200], gain = 0.2 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueCurveAtTime(new Float32Array(pitch), t, dur);
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 5.5 + Math.random();
    depth.gain.value = pitch[pitch.length - 1] * 0.012;   // about a fifth of a semitone
    lfo.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.04);
    g.gain.setValueAtTime(gain, t + dur - 0.07);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    const w = ctx.createGain(); w.gain.value = 0.35;
    g.connect(w).connect(this.reverb);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
    // Breath: noise in a band around the note, far below the tone.
    this.noiseBurst({ at, dur, type: 'bandpass', freq: pitch[0] * 1.1, freqEnd: pitch[pitch.length - 1] * 1.1, q: 3, gain: gain * 0.12, attack: 0.03 });
  }

  bottleSmash(distance) {
    const at = Math.min(distance / 343, 1), k = Math.max(0.15, 1 - distance / 120);
    this.noiseBurst({ at, dur: 0.05, type: 'highpass', freq: 3500, gain: 0.6 * k });
    this.noiseBurst({ at: at + 0.02, dur: 0.4, type: 'bandpass', freq: 5000, freqEnd: 2500, q: 2, gain: 0.3 * k });
  }

  throwWhoosh() {
    this.noiseBurst({ dur: 0.25, type: 'bandpass', freq: 500, freqEnd: 1200, q: 1.5, gain: 0.15, attack: 0.05 });
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

  // An explosion heard from `distance` m (big: a vehicle or a heavy charge). Recorded blasts:
  // the close one fades into the distant rumble with range, arriving later (sound at 343 m/s).
  explosion(distance, big = false) {
    const at = Math.min(distance / 343, 2), k = Math.max(0.2, 1 - distance / 900);
    const far = Math.min(1, Math.max(0, (distance - 50) / 300));
    const near = this.sample(big ? 'explosion_large' : 'explosion_grenade', { at, gain: (big ? 1.0 : 0.9) * k * (1 - far * 0.75), filter: 700 + 17000 * (1 - far) ** 2, wet: 0.15 });
    const distant = this.sample('explosion_far', { at, gain: (0.25 + 0.75 * far) * k * (big ? 1 : 0.8), wet: 0.1 });
    if (near || distant) return;
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
    if (this.sample('shot_springfield', { at, gain: 0.85 * k, filter: 900 + 9000 * k * k, wet: 0.25 })) return;   // guards carry Springfields
    this.noiseBurst({ at, dur: 0.3, type: 'lowpass', freq: 600 + 3600 * k, freqEnd: 400, gain: 0.7 * k, wet: 1 });
    this.thump({ at, freq: 50, dur: 0.35, gain: 0.6 * k });
    this.noiseBurst({ at: at + 0.3, dur: 1.2, type: 'lowpass', freq: 600, freqEnd: 200, gain: 0.12 * k, attack: 0.15 });
  }

  // A round from a guard's machine gun (a nest's MG42) heard from `distance` metres.
  enemyBurstShot(distance) {
    const at = Math.min(distance / 343, 1.2), k = Math.max(0.12, 1 - distance / 450);
    if (this.sample('shot_mg42', { at, gain: 0.5 * k, filter: 1000 + 9000 * k * k, wet: 0.25 })) return;
    this.enemyShot(distance);
  }

  // A guard dog's bark from `distance` m: one of the recordings, fainter, duller and later with
  // distance; without them, two or three synthesised woofs (a voiced, falling tone through the
  // throat's formant, with breath on the attack).
  bark(distance) {
    if (!this.ctx) return;
    const k = Math.max(0.05, 1 - distance / 120), name = BARKS[Math.floor(Math.random() * BARKS.length)];
    if (this.sample(name, { at: Math.min(distance / 343, 0.4), gain: 0.75 * k ** 0.8, rate: 0.94 + Math.random() * 0.12, filter: 1200 + 14000 * k * k, wet: 0.3 })) return;
    // (the recordings not loaded: a synthesised bark)
    const ctx = this.ctx, n = Math.random() < 0.3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + Math.min(distance / 343, 0.4) + i * (0.17 + Math.random() * 0.05), f0 = 330 + Math.random() * 60;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + 0.12);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850 + Math.random() * 200; bp.Q.value = 1.6;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + 3000 * k;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * k, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(bp).connect(lp).connect(g).connect(this.master);
      const w = ctx.createGain(); w.gain.value = 0.35; g.connect(w).connect(this.reverb);
      o.start(t); o.stop(t + 0.2);
      this.noiseBurst({ at: t - ctx.currentTime, dur: 0.07, type: 'bandpass', freq: 1400, q: 1.2, gain: 0.18 * k });
    }
  }

  // A spent case landing `distance` m away (quiet: heard within 25 m or so). A burst drops them
  // faster than anyone could tell apart, so no more than one every 70 ms.
  casing(distance) {
    const now = this.ctx?.currentTime ?? 0;
    if (!this.ctx || distance > 25 || now < (this.casingUntil ?? 0)) return;
    this.casingUntil = now + 0.07;
    const k = Math.max(0, 1 - distance / 25);
    this.sample(CASINGS[Math.floor(Math.random() * CASINGS.length)], { gain: 0.5 * k * k, rate: 0.9 + Math.random() * 0.25, filter: 2500 + 15000 * k });
  }

  // A dog hit: a high yelp falling away.
  yelp(distance) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, k = Math.max(0.05, 1 - distance / 100);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1100, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.45);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35 * k, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.55);
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
  // The air-raid siren: the recording (winding up, holding, winding down, again and again) once it
  // has loaded; the synthesised wail until then. The level is kept, so a siren already sounding
  // switches to the recording when it arrives.
  setSiren(level) {
    const was = this.sirenLevel ?? 0;
    this.sirenLevel = level;
    if (this.samples?.siren) {
      // Each time it's set off it winds up from the start, as a real one does.
      if (level > 0 && was <= 0 && this.loops?.siren) { this.loops.siren.src.stop(); delete this.loops.siren; }
      this.loopSample('siren', 'siren', level * 0.55);
      if (this.sirenGain) this.sirenGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      return;
    }
    this.synthSiren(level);
  }

  synthSiren(level) {
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

  // A looped recording (a tank's tracks, a turret traversing): started once its sample has
  // loaded, then its level, speed and brightness follow the game (duller further off).
  loopSample(key, name, level, { rate = 1, dull = 0 } = {}) {
    const buf = this.samples?.[name];
    if (!this.ctx || !buf) return;
    this.loops ??= {};
    let v = this.loops[key];
    if (!v) {
      if (level <= 0) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(lp).connect(g).connect(this.master);
      src.start();
      v = this.loops[key] = { src, lp, g };
    }
    const t = this.ctx.currentTime;
    v.g.gain.setTargetAtTime(level, t, 0.12);
    v.src.playbackRate.setTargetAtTime(rate, t, 0.3);
    v.lp.frequency.setTargetAtTime(9000 - 8200 * dull, t, 0.3);
  }

  // The nearest moving tank's tracks rattling (level 0–1 by distance, speed 0–1).
  setTankTracks(level, speed = 1, dull = 0) { this.loopSample('tracks', 'tank_tracks', level * level * 0.8, { rate: 0.85 + 0.3 * speed, dull }); }
  // A turret traversing nearby: its motor whirring (level 0–1 by distance).
  setTurret(level, dull = 0) { this.loopSample('turret', 'tank_turret', level * level * 0.7, { dull }); }

  // A truck's engine on the move (the column, the reinforcements): the recording once it has
  // loaded, the synthesised engine until then.
  setTruck(level) {
    if (this.samples?.army_truck) { this.loopSample('truck', 'army_truck', level * level * 0.9, { dull: 1 - level }); return; }
    this.setEngine(level);
  }

  // A truck setting off: the engine revs and it pulls away (quieter and duller further off).
  truckStart(distance) {
    const k = Math.max(0, 1 - distance / 450);
    if (k > 0) this.sample('truck_start', { gain: k * k * 1.1, filter: 1200 + 7800 * k, wet: 0.1 });
  }

  // Rain: a steady hiss of filtered noise with a softer patter under it.
  setRain(level) {
    const g = this.drone('rainGain', (out) => {
      for (const [type, freq, q, gain] of [['bandpass', 3200, 0.5, 0.6], ['lowpass', 700, 0.7, 0.35]]) {
        const n = this.ctx.createBufferSource();
        n.buffer = this.noise; n.loop = true;
        const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const ng = this.ctx.createGain(); ng.gain.value = gain;
        n.connect(f).connect(ng).connect(out); n.start();
      }
    });
    if (g && Math.abs((this.rainSet ?? -1) - level) > 1e-3) { this.rainSet = level; g.gain.setTargetAtTime(level * 0.09, this.ctx.currentTime, 1); }
  }

  // A synthesised engine drone (the run-up on the airfield; a truck until its recording loads).
  setEngine(level) {
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
  // ---- a steam train ----
  // One chuff of the exhaust: a soft low burst, quieter and duller with distance.
  trainChuff(distance, gain = 1) {
    const k = Math.max(0, 1 - distance / 700) ** 2 * gain;
    if (k < 0.01) return;
    this.noiseBurst({ dur: 0.22, type: 'bandpass', freq: 380 - Math.min(250, distance * 0.4), q: 0.9, gain: 0.5 * k, attack: 0.01, wet: 0.15 });
    this.thump({ freq: 48, dur: 0.18, gain: 0.25 * k });
  }
  // The steam whistle: two breathy notes together (noise through narrow filters, no ringing tone).
  steamWhistle(distance, dur = 1.8) {
    const k = Math.max(0, 1 - distance / 1400) ** 1.5;
    if (k < 0.01) return;
    for (const freq of [560, 700]) this.noiseBurst({ dur, type: 'bandpass', freq, q: 22, gain: 1.6 * k, attack: 0.12, wet: 0.35 });
  }
  // Steam let off while it stands: a hiss.
  steamHiss(distance) {
    const k = Math.max(0, 1 - distance / 300) ** 2;
    if (k > 0.01) this.noiseBurst({ dur: 1.4, type: 'highpass', freq: 2500, q: 0.5, gain: 0.25 * k, attack: 0.2 });
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
