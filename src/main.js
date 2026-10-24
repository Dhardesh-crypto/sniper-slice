// Entry point: renderer, fixed-step simulation loop, menu and settings wiring.
import * as THREE from 'three';
import { World } from './world/world.js';
import { Player } from './player/player.js';
import { Avatar } from './player/avatar.js';
import { CameraRig } from './player/camera-rig.js';
import { Arsenal } from './weapons/arsenal.js';
import { Particles } from './fx/particles.js';
import { KillCam } from './fx/killcam.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { Hud } from './ui/hud.js';
import { Post } from './core/post.js';
import { loadAssets } from './world/characters.js';
import { MapView } from './ui/map.js';
import { Search } from './player/search.js';
import { Carry } from './player/carry.js';
import { Masking } from './stealth/masking.js';
import { Stealth } from './stealth/stealth.js';
import { GuardAI } from './ai/guards.js';
import { Mission } from './mission/mission.js';
import { Hotspots } from './world/hotspots.js';

const FIXED_DT = 1 / 60;

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
const settings = loadSettings();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 3000);
camera.rotation.order = 'YXZ';

// Characters and the rifle come from GLB files: load them before building the world.
const playBtn = document.getElementById('play');
playBtn.disabled = true;
await loadAssets((f) => { playBtn.textContent = `Loading ${Math.round(f * 100)}%`; });
playBtn.textContent = 'Click to play';
playBtn.disabled = false;

const input = new Input(canvas);
const audio = new Audio();
audio.volume = settings.volume;
const world = new World(scene, renderer);
const player = new Player(world, input, audio);
const avatar = new Avatar(scene);
const rig = new CameraRig(world);
const fx = new Particles(scene, 220);
const arsenal = new Arsenal({ world, player, input, audio, fx, settings });
arsenal.camera = camera;
arsenal.avatar = avatar;
const hud = new Hud();
const post = new Post(renderer, scene, camera);
const mapView = new MapView(world);
const search = new Search({ world, player, arsenal, input, audio, hud });
const carry = new Carry({ world, player, input, audio, hud });
const masking = new Masking({ scene, world, audio, fx });
const stealth = new Stealth({ world, player, arsenal, masking, audio, hud });
arsenal.onImpactNoise = (point) => stealth.noise(point, 14, 'impact');
player.onNoise = (pos, radius, kind) => stealth.noise(pos, radius, kind);
const ai = new GuardAI({ scene, world, player, stealth, audio, fx, hud });
const mission = new Mission({ world, player, arsenal, stealth, ai, search, input, audio, fx, hud });
const hotspots = new Hotspots({ scene, world, player, stealth, masking, audio, fx, hud, arsenal });
hotspots.ai = ai; hotspots.mission = mission;
ai.hotspots = hotspots;
arsenal.hotspots = hotspots;
mapView.mission = mission;
mapView.hotspots = hotspots;
arsenal.onShot = (origin, def) => { stealth.gunshot(origin, def); mission.onShot(); };
stealth.onRaise = (why) => mission.onRaise(why);
const endScreen = document.getElementById('end');
mission.onComplete = (sum) => {
  document.getElementById('rating').textContent = `RATING · ${sum.rating}`;
  document.getElementById('end-stats').innerHTML = sum.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  endScreen.classList.add('on');
  menu.classList.add('hidden');
  audio.setSiren(0);
  audio.setTruck(0);
  document.exitPointerLock?.();
};
document.getElementById('again').addEventListener('click', () => location.reload());
document.getElementById('restart').addEventListener('click', () => location.reload());

// Killed: the body falls, the cursor comes back, a click restarts the mission.
const deathScreen = document.getElementById('death');
deathScreen.addEventListener('click', () => location.reload());
post.setQuality(settings.quality);
arsenal.onHit = (e) => { hud.onHit(e); mission.onHit(e); };
arsenal.onTag = (s) => hud.message(`TAGGED · ${s.label ? s.label() : s.name.toUpperCase()}`);

// A beat of slow motion on every kill that doesn't get the full X-ray kill cam.
let timeScale = 1, slowmoT = 0;
arsenal.onKill = () => { if (!killCam.active) slowmoT = 0.55; };

// X-ray kill cam: the arsenal hands over lethal shots; the cam applies the hit on impact.
const killCam = new KillCam({ scene, camera, audio, world });
arsenal.onKillCam = (cine) => {
  killCam.start(cine, () => {
    cine.bullet.vel.copy(cine.vel);
    cine.bullet.time = cine.time;
    arsenal.lastTrajectory = cine.path;
    arsenal.resolveHit(cine.bullet, cine.hit);
  }, (r) => {
    if (r.zone === 'engine') { input.consume(); return; } // the explosion already posted its message
    const d = `${Math.round(r.distance)} m`;
    const what = r.parts.length ? r.parts.slice(0, 2).join(' · ') : r.zone.toUpperCase();
    hud.message(r.zone === 'head' ? `HEADSHOT · ${what} · ${d}` : `${what} · ${d}`, r.zone === 'head' ? 'head' : '');
    input.consume();
  });
};

// Debug: the last bullet's path as a line (toggle with T).
const trajLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff5533, fog: false }));
trajLine.frustumCulled = false;
trajLine.visible = false;
scene.add(trajLine);
let shownTrajectory = null;

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  hud.resize();
}
addEventListener('resize', onResize);

// ---- menu and settings ----
const menu = document.getElementById('menu');
const bind = (id, key, fmt = (v) => v) => {
  const el = document.getElementById(id);
  const out = el.parentElement.querySelector('output');
  const kind = el.type === 'checkbox' ? 'check' : el.tagName === 'SELECT' ? 'select' : 'number';
  if (kind === 'check') el.checked = settings[key]; else el.value = settings[key];
  const show = () => { if (out) out.textContent = fmt(settings[key]); };
  show();
  el.addEventListener('input', () => {
    settings[key] = kind === 'check' ? el.checked : kind === 'select' ? el.value : parseFloat(el.value);
    show();
    if (key === 'volume') audio.setVolume(settings.volume);
    if (key === 'quality') post.setQuality(settings.quality);
    saveSettings(settings);
  });
};
bind('set-sens', 'sensitivity', (v) => v.toFixed(2));
bind('set-fov', 'fov', (v) => `${v}°`);
bind('set-vol', 'volume', (v) => `${Math.round(v * 100)}%`);
bind('set-invert', 'invertY');
bind('set-lung', 'lungMarker', () => '');
bind('set-killcam', 'killCam', () => '');
bind('set-quality', 'quality', () => '');

document.getElementById('play').addEventListener('click', () => {
  audio.start();
  input.lock();
});
// The menu doubles as the pause screen once the mission has started.
let started = false;
canvas.addEventListener('click', () => { if (!input.locked) input.lock(); });
input.onLockChange = (locked) => {
  const over = player.dead || mission.done;
  menu.classList.toggle('hidden', locked || mapView.open || over);
  if (locked && !started) {
    started = true;
    document.body.classList.add('started');
    document.getElementById('play').textContent = 'Resume';
    document.querySelector('#menu .sub').textContent = 'Paused · Operation Vineyard';
  }
  // Pause while the menu is up (not for the map, which pauses on its own).
  menuPaused = !locked && !mapView.open && !over;
  if (audio.ctx) menuPaused ? audio.ctx.suspend() : audio.ctx.resume();
};
let birdT = 4;
let menuPaused = true;   // the world waits behind the menu until you click play
let forceRun = false;    // window.game.advance() steps even behind the menu

// Map (M): pauses the game and frees the cursor so you can click a waypoint.
function setMap(open, relock = true) {
  mapView.open = open;
  document.body.classList.toggle('mapopen', open);
  if (open) document.exitPointerLock?.();
  else if (relock) input.lock();
  else menu.classList.remove('hidden');
}

// ---- loop ----
let acc = 0;
let fps = 60;
const timer = new THREE.Timer();
timer.connect(document);
const lookAhead = new THREE.Vector3();
let paused = false;

function tick(dt) {
  if (input.wasPressed('F3')) ai.pathLines.visible = hud.debugOn = !hud.debugOn;
  if (input.wasPressed('KeyT')) trajLine.visible = !trajLine.visible;
  if (player.dead) { input.keys.clear(); input.buttons.clear(); input.pressed.clear(); }
  player.tick(dt, { aiming: arsenal.aiming });
  arsenal.tick(dt);
  search.tick(dt);
  carry.tick(dt);
  masking.update(dt, camera.position);
  stealth.tick(dt);
  ai.tick(dt);
  mission.tick(dt);
  hotspots.tick(dt);
  // Birdsong in the quiet; a gunshot or the siren silences it for a while.
  birdT -= dt;
  if (stealth.lastShot && stealth.time - stealth.lastShot.t < 0.05) birdT = 35;
  if (birdT <= 0) { birdT = 3 + Math.random() * 7; if (!stealth.alarm) audio.birdCall(); }
  world.tick(dt);
  if (player.dead && !deathScreen.classList.contains('on')) {
    deathScreen.classList.add('on');
    menu.classList.add('hidden');
    audio.setSiren(0);
    document.exitPointerLock?.();
  }
  input.consume();
}

function frame(time) {
  timer.update(time);
  step(Math.min(timer.getDelta(), 0.1));
}

function step(realDt, draw = true) {
  fps += (1 / Math.max(realDt, 1e-4) - fps) * 0.05;

  if (input.wasPressed('KeyM') && !killCam.active && (input.locked || mapView.open)) {
    input.pressed.delete('KeyM');
    setMap(!mapView.open);
  }
  if (mapView.open) {
    if (input.wasPressed('Escape')) setMap(false, false);
    input.consume();
    input.takeMouse();
    mapView.drawFull({ player });
    return;
  }

  // During the kill cam the player has no control; the world runs at the cam's pace.
  if (killCam.active) {
    if (input.wasPressed('Mouse0') || input.wasPressed('Space')) killCam.skip();
    input.consume();
    input.takeMouse();
    const ws = killCam.update(realDt);
    world.tick(realDt * ws);
    fx.update(realDt * ws);
    avatar.root.visible = false;
    if (!draw) return;
    killCam.render(renderer, post);
    hud.update(realDt, { camera, player, arsenal, world, fps });
    return;
  }

  // Kill slow-mo: drop to 25% speed, then ease back to full speed.
  if (slowmoT > 0) slowmoT = Math.max(0, slowmoT - realDt);
  const targetScale = slowmoT > 0.2 ? 0.25 : 1;
  timeScale += (targetScale - timeScale) * (1 - Math.exp(-(slowmoT > 0.2 ? 30 : 6) * realDt));
  const dt = realDt * timeScale;

  if (!paused && (!menuPaused || forceRun)) {
    acc += dt;
    while (acc >= FIXED_DT) {
      tick(FIXED_DT);
      acc -= FIXED_DT;
    }
  }
  const alpha = acc / FIXED_DT;

  // Look: raw mouse delta, scaled down with zoom so the scope isn't twitchy.
  const m = input.takeMouse();
  const zoomScale = Math.tan(THREE.MathUtils.degToRad(arsenal.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(settings.fov) / 2);
  player.look(m.x, m.y, settings.sensitivity * zoomScale, settings.invertY);
  arsenal.frame(dt);

  // Third person while moving; the rifle scope and binoculars go to the eye.
  const fpBlend = Math.max(arsenal.current === 'rifle' ? arsenal.aim : 0, arsenal.binocT ?? 0);
  rig.update(realDt, camera, player, {
    yaw: player.yaw + arsenal.sway.yaw,
    pitch: player.pitch + arsenal.sway.pitch + arsenal.recoil,
    roll: arsenal.roll,
    alpha,
    pistolAim: arsenal.current === 'pistol' && arsenal.aim > 0.3,
    fpBlend,
  });
  if (Math.abs(camera.fov - arsenal.fov) > 1e-3) {
    camera.fov = arsenal.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();

  avatar.update(dt, {
    pos: new THREE.Vector3().lerpVectors(player.prevPos, player.pos, alpha),
    lookYaw: player.yaw, lookPitch: player.pitch, moveYaw: player.moveYaw,
    stance: player.stance, speed: player.speed, sprinting: player.sprinting, climb: player.climb, climbRate: player.climbRate, dead: player.dead,
    weapon: arsenal.current, aiming: arsenal.aiming, ready: arsenal.readyT,
    boltT: arsenal.boltT, reloading: arsenal.reloadT > 0, kick: arsenal.viewKick,
    visible: fpBlend < 0.5 && rig.armLen > 0.9, // hide the body when a wall pushes the camera into it
  });

  // Shadows follow the look direction, reaching farther when zoomed in.
  const reach = 40 + 160 * fpBlend;
  lookAhead.set(0, 0, -reach).applyQuaternion(camera.quaternion).add(camera.position);
  world.focusShadows(lookAhead);
  world.nearGrass.update(player.pos.x, player.pos.z);
  world.viewer = camera.position;

  fx.update(dt);
  audio.setWind(world.windSpeed);

  if (trajLine.visible && arsenal.lastTrajectory && arsenal.lastTrajectory !== shownTrajectory) {
    shownTrajectory = arsenal.lastTrajectory;
    trajLine.geometry.dispose();
    trajLine.geometry = new THREE.BufferGeometry().setFromPoints(shownTrajectory);
  }

  if (!draw) return;
  post.draw();
  const st = stealth.state();
  const ss = search.state(), cs = carry.state(), co = player.climbOption(), cut = ai.sabotageOption(), rad = mission.radioOption();
  const prompts = carry.body ? [cs] : [cut, rad, ss, cs, co && { label: co.label, progress: 0 }].filter(Boolean);
  const prompt = prompts.length ? { label: prompts.map(p => p.label).join('   ·   '), progress: prompts[0].progress } : null;
  hud.update(realDt, { camera, player, arsenal, world, fps, search: prompt, waypoint: mapView.waypoint, stealth: st, mission, hotspots });
  mapView.drawMini({ player, stealth: st });
}
renderer.setAnimationLoop(frame);

// Debug handle for automated play-testing from the console.
window.game = {
  THREE, world, player, arsenal, avatar, rig, camera, settings, hud, renderer, input, killCam, post, mapView, search, setMap, carry, masking, stealth, ai, mission, hotspots,
  get timeScale() { return timeScale; },
  pause(v = true) { paused = v; },
  // Run the game synchronously for `seconds` at `rate` fps (for testing while the tab is in the background).
  advance(seconds, rate = 60) {
    renderer.setAnimationLoop(null);
    const n = Math.round(seconds * rate);
    forceRun = true;
    for (let i = 0; i < n; i++) step(1 / rate, i === n - 1);
    forceRun = false;
    renderer.setAnimationLoop(frame);
  },
  // Point the camera at a world position (sway still applies on top). In third person the
  // camera orbits as it turns, so refine a few times from its new position.
  aimAt(x, y, z) {
    const target = new THREE.Vector3(x, y, z);
    for (let i = 0; i < 4; i++) {
      const from = rig.firstPerson > 0.5 ? player.eyePosition(1, new THREE.Vector3()) : camera.position;
      const d = target.clone().sub(from);
      player.yaw = Math.atan2(-d.x, -d.z);
      player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      step(0, false);
    }
  },
};
