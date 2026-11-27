// The developer panel (?dev, in the dev server or a `vite build --mode dev` build only; main.js
// leaves the import out of the normal build, so none of this ships). Sliders and switches over the
// values the game already keeps (the map's light and fog, the post chain, the camera rig, the
// haze), the switches to hunt a tint down effect by effect, and play tools: spawn and clear guards,
// god mode, refills, missions and checkpoints, time scale, sight cones and sound rings.
//
// Nothing here holds a number of its own: every control reads its starting value from where the
// game keeps it, writes back there, and remembers where that is (`where`), so "Copy values" can
// say which file and object each changed value belongs in. Saved tuning (localStorage) and the
// optional dev-overrides.json at the project root (the same format: "Download overrides" writes it)
// are put back on top at load: the file first, then what was saved in this browser.
//
// Keys: ` frees the cursor without the pause menu (the game keeps running; click the game to go
// back, Esc for the menu); \ hides or shows the panel.
import * as THREE from 'three';
import GUI, { ColorController } from 'lil-gui';
import { LIGHT } from '../world/world.js';
import { activeMap } from '../world/terrain.js';
import { setAtmosphere, ATMO } from '../world/atmosphere.js';
import { OFFSETS, PIVOT_H, RIG } from '../player/camera-rig.js';
import { SIGHT } from '../stealth/stealth.js';
import { Soldier, LIFE } from '../world/soldier.js';
import { STORM } from '../world/storm.js';
import { AMMO, HEAVY_AMMO } from '../weapons/defs.js';

const KEY = 'sniper-slice.dev.tuning';
const FILE = Object.values(import.meta.glob('/dev-overrides.json', { eager: true, import: 'default' }))[0] ?? null;
const TONE = { ACES: THREE.ACESFilmicToneMapping, AgX: THREE.AgXToneMapping, Neutral: THREE.NeutralToneMapping, Reinhard: THREE.ReinhardToneMapping, Cineon: THREE.CineonToneMapping, Linear: THREE.LinearToneMapping, None: THREE.NoToneMapping };
const TONE_NAME = Object.fromEntries(Object.entries(TONE).map(([k, v]) => [v, k]));

export function install(g) {
  const { world, scene, renderer, post, camera, player, arsenal, stealth, ai, input, settings, saves, missionId } = g;
  const map = activeMap();
  const missionFile = `src/missions/${g.missionFile ?? missionId}.js`;
  const dev = { cursor: false, timeScale: 1, freecam: false, frame, preStep };

  // ---- the registry: every saved control, where its value lives, and what it started as ----
  const reg = [];
  // scope 'map': kept per mission (the map's light and fog); 'global': one value for every mission.
  const track = (ctrl, id, where, scope = 'global', key = id.split('.').pop(), arr = null) => {
    reg.push({ ctrl, id, where, scope, key, arr, initial: structuredClone(ctrl.getValue()) });
    return ctrl;
  };

  const gui = new GUI({ title: `Dev · ${missionId}${g.conditions?.kind && g.conditions.kind !== 'briefed' ? ` · ${g.conditions.kind}` : ''}`, width: 320 });
  gui.domElement.style.zIndex = 80;
  // (typing in a field must not reach the game: 1/2/3 switch weapons, R reloads…)
  for (const t of ['keydown', 'keyup']) gui.domElement.addEventListener(t, (e) => { if (e.code !== 'Backquote' && e.code !== 'Backslash') e.stopPropagation(); });

  // ---- Look: the map's light (world.js LIGHT, overridden by the mission's map.light) ----
  map.light = { ...LIGHT, ...map.light };   // (every key there, so each has a slider; world.js reads it the same way)
  const L = map.light, u = world.sky.material.uniforms;
  const hunt = { atmosphere: true, fog: true, sky: true, reflections: true, shadowK: 1 };
  const applyLight = () => {
    world.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(L.zenith), THREE.MathUtils.degToRad(L.azimuth));
    u.sunPosition.value.copy(world.sunDir);
    u.turbidity.value = L.turbidity; u.rayleigh.value = L.rayleigh; u.cloudCoverage.value = L.clouds;
    renderer.toneMappingExposure = L.exposure;
    world.hemi.color.set(L.hemiSky); world.hemi.groundColor.set(L.hemiGround); world.hemi.intensity = L.hemi;
    world.sun.color.set(L.sun); world.sun.intensity = L.sunIntensity;
    setAtmosphere(world.sunDir, L.sun, hunt.atmosphere);
    post.setGrade(L.warmth, L.saturation);
    renderer.shadowMap.needsUpdate = true;
  };
  // The reflections are the sky baked into a cube: baked again when a slider that changes the sky
  // is let go. Materials keep their own envMap (materials.js), so each is moved to the new one.
  const applyEnv = () => {
    const k = hunt.reflections ? L.env : 0;
    scene.environmentIntensity = k;
    scene.traverse((o) => { for (const m of [].concat(o.material ?? [])) if (m.envMap && 'envMapIntensity' in m) m.envMapIntensity = (m.userData.look?.env ?? 1) * k; });
  };
  const rebake = () => {
    const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
    envScene.add(world.sky.clone());
    const old = scene.environment, tex = pmrem.fromScene(envScene, 0, 1, 5000).texture;
    pmrem.dispose();
    scene.environment = tex;
    scene.traverse((o) => { for (const m of [].concat(o.material ?? [])) if (m.envMap === old) m.envMap = tex; });
    old?.dispose?.();
    applyEnv();
  };
  const look = gui.addFolder('Look');
  const where = `${missionFile} · map.light`;
  const sun = look.addFolder('Sun');
  const lt = (f, key, ...a) => track(f.add(L, key, ...a).onChange(applyLight), `light.${key}`, where, 'map');
  const lc = (f, key) => track(f.addColor(L, key).onChange(applyLight), `light.${key}`, where, 'map');
  lt(sun, 'sunIntensity', 0, 8, 0.05).name('intensity');
  lc(sun, 'sun').name('colour');
  lt(sun, 'zenith', 0, 95, 0.5).name('from zenith °').onFinishChange(rebake);
  lt(sun, 'azimuth', 0, 360, 1).name('bearing °').onFinishChange(rebake);
  track(sun.add(world.sun.shadow, 'bias', -0.005, 0.005, 0.0001).name('shadow bias'), 'shadow.bias', 'src/world/world.js · setupSkyAndLight sun.shadow');
  track(sun.add(world.sun.shadow, 'normalBias', 0, 2, 0.01).name('shadow normal bias'), 'shadow.normalBias', 'src/world/world.js · setupSkyAndLight sun.shadow');
  sun.add(hunt, 'shadowK', 0, 1, 0.01).name('shadow strength (test)').onChange(v => { world.sun.shadow.intensity = v; renderer.shadowMap.needsUpdate = true; });
  const fill = look.addFolder('Sky fill and reflections');
  lt(fill, 'hemi', 0, 3, 0.01).name('hemisphere');
  lc(fill, 'hemiSky').name('hemi sky');
  lc(fill, 'hemiGround').name('hemi ground');
  lt(fill, 'env', 0, 2, 0.01).name('reflections (env)').onChange(applyEnv);
  const skyF = look.addFolder('Sky');
  lt(skyF, 'turbidity', 0, 20, 0.1).onFinishChange(rebake);
  lt(skyF, 'rayleigh', 0, 6, 0.05).onFinishChange(rebake);
  lt(skyF, 'clouds', 0, 1, 0.01).onFinishChange(rebake);
  skyF.add({ rebake }, 'rebake').name('Bake reflections again');

  // Fog: the map's own (map.fog: colour and near/far, or density). Shown in sRGB like the code's hex.
  const fogF = look.addFolder('Fog and haze');
  const fogWhere = `${missionFile} · map.fog`;
  map.fog ??= {};
  const F = { color: scene.fog.color.getHex(), near: scene.fog.near, far: scene.fog.far, density: scene.fog.density };
  const applyFog = () => {
    const f = scene.fog;
    f.color.setHex(F.color); map.fog.color = F.color;
    if (f.isFogExp2) { f.density = hunt.fog ? F.density : 0; map.fog.density = F.density; }
    else { f.near = hunt.fog ? F.near : 1e8; f.far = hunt.fog ? F.far : 1e8 + 1; map.fog.near = F.near; map.fog.far = F.far; }
  };
  track(fogF.addColor(F, 'color').name('fog colour').onChange(applyFog), 'fog.color', fogWhere, 'map');
  if (scene.fog.isFogExp2) track(fogF.add(F, 'density', 0, 0.02, 0.0001).onChange(applyFog), 'fog.density', fogWhere, 'map');
  else {
    track(fogF.add(F, 'near', 0, 2000, 5).onChange(applyFog), 'fog.near', fogWhere, 'map');
    track(fogF.add(F, 'far', 50, 6000, 10).onChange(applyFog), 'fog.far', fogWhere, 'map');
  }
  const atmoWhere = 'src/world/atmosphere.js · ATMO';
  track(fogF.add(ATMO, 'height', 20, 2000, 5).name('haze height (m)').onChange(applyLight), 'atmo.height', atmoWhere);
  track(fogF.add(ATMO, 'glow', 0, 0.3, 0.001).name('haze sun glow').onChange(applyLight), 'atmo.glow', atmoWhere);

  // Tone mapping and the post chain (core/post.js; the tone mapper is main.js's renderer).
  const tone = look.addFolder('Tone mapping and grade');
  const T = { mapper: TONE_NAME[renderer.toneMapping] ?? 'ACES' };
  track(tone.add(T, 'mapper', Object.keys(TONE)).name('tone mapping').onChange(v => { renderer.toneMapping = TONE[v]; }), 'tone.mapper', 'src/main.js · renderer.toneMapping');
  lt(tone, 'exposure', 0.1, 3, 0.01);
  lt(tone, 'warmth', -2, 3, 0.01).name('grade warmth');
  lt(tone, 'saturation', 0, 2, 0.01).name('grade saturation');
  const gu = post.grade.uniforms, gradeWhere = 'src/core/post.js · GradeShader.uniforms';
  track(tone.add(gu.uContrast, 'value', 0.5, 1.6, 0.01).name('grade contrast'), 'grade.uContrast', gradeWhere, 'global', 'uContrast');
  track(tone.add(gu.uVignette, 'value', 0, 1, 0.01).name('vignette'), 'grade.uVignette', gradeWhere, 'global', 'uVignette');
  track(tone.add(post.gtao, 'blendIntensity', 0, 2, 0.01).name('AO strength'), 'post.gtao.blendIntensity', 'src/core/post.js · this.gtao.blendIntensity', 'global', 'blendIntensity');
  track(tone.add(post.bloom, 'strength', 0, 2, 0.01).name('bloom strength'), 'post.bloom.strength', 'src/core/post.js · UnrealBloomPass(…, strength, radius, threshold)', 'global', 'strength');
  track(tone.add(post.bloom, 'radius', 0, 1.5, 0.01).name('bloom radius'), 'post.bloom.radius', 'src/core/post.js · UnrealBloomPass(…, strength, radius, threshold)', 'global', 'radius');

  // Find the tint: each effect off on its own (these switches are for looking, never saved).
  const tint = look.addFolder('Find the tint (switches)');
  tint.add(post.gtao, 'enabled').name('ambient occlusion');
  tint.add(post.bloom, 'enabled').name('bloom');
  tint.add(post.grade, 'enabled').name('colour grade');
  const outPass = post.composer.passes.at(-1);
  tint.add(outPass, 'enabled').name('output (tone map, sRGB)');
  tint.add(hunt, 'atmosphere').name('haze colour and height').onChange(applyLight);
  tint.add(hunt, 'fog').name('fog').onChange(applyFog);
  tint.add(hunt, 'reflections').name('sky reflections').onChange(applyEnv);
  tint.add(world.sky, 'visible').name('sky dome');
  tint.add(world.hemi, 'visible').name('hemisphere light');
  tint.add(world.sun, 'visible').name('sun light');
  // The scene's own parts by name (or kind), each switchable: the horizon, water, grass, trees…
  const layers = tint.addFolder('Scene parts').close();
  const groups = new Map();
  for (const o of scene.children) {
    if (o === world.sky || o.isLight) continue;
    const name = o.name || o.constructor.name;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(o);
  }
  for (const [name, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const st = { on: true };
    layers.add(st, 'on').name(`${name}${list.length > 1 ? ` ×${list.length}` : ''}`).onChange(v => { for (const o of list) o.visible = v; renderer.shadowMap.needsUpdate = true; });
  }
  look.close();

  // ---- Camera: the over-the-shoulder rig (player/camera-rig.js) ----
  const cam = gui.addFolder('Camera');
  track(cam.add(settings, 'fov', 40, 100, 1).name('field of view °'), 'settings.fov', 'src/core/settings.js · DEFAULTS (the player can change it in Settings)', 'global', 'fov');
  for (const st of ['stand', 'crouch', 'prone', 'pistolAim']) {
    const f = cam.addFolder(st === 'pistolAim' ? 'pistol aim' : st).close();
    ['right', 'up (height)', 'back (follow distance)'].forEach((label, i) =>
      track(f.add(OFFSETS[st], i, i === 2 ? 0.3 : -2, i === 2 ? 10 : 3, 0.01).name(label), `rig.OFFSETS.${st}.${i}`, 'src/player/camera-rig.js · OFFSETS', 'global', st, OFFSETS[st]));
    if (PIVOT_H[st] != null) track(f.add(PIVOT_H, st, 0.1, 3, 0.01).name('pivot height'), `rig.PIVOT_H.${st}`, 'src/player/camera-rig.js · PIVOT_H');
  }
  const ease = cam.addFolder('Smoothing (per second)').close();
  for (const [k, label] of [['follow', 'to the stance'], ['pivot', 'pivot height'], ['side', 'shoulder swap'], ['armOut', 'back out after a wall']])
    track(ease.add(RIG, k, 0.5, 40, 0.5).name(label), `rig.RIG.${k}`, 'src/player/camera-rig.js · RIG');
  const free = { speed: 12, yaw: 0, pitch: 0, pos: new THREE.Vector3() };
  cam.add(dev, 'freecam').name('free camera (WASD, Q/E, Shift)').onChange(v => {
    if (!v) return;
    free.pos.copy(camera.position);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    free.yaw = e.y; free.pitch = e.x;
  });
  cam.add(free, 'speed', 1, 200, 1).name('free camera speed');
  cam.close();

  // ---- Guards: their life between the clips (world/soldier.js LIFE) ----
  const life = gui.addFolder('Guards (life)').close(), lifeWhere = 'src/world/soldier.js · LIFE';
  for (const [k, lo, hi, step, label] of [['weightShift', 0, 0.12, 0.005, 'weight shift (rad)'], ['headLook', 0, 1.2, 0.05, 'head looks (rad)'], ['stretch', 0, 0.4, 0.01, 'stretch (rad)'],
    ['startle', 0, 0.6, 0.01, 'startle jolt (rad)'], ['startleDuck', 0, 2, 0.05, 'startle crouch (s)'], ['turnAccel', 2, 40, 1, 'turn pick-up (rad/s²)'],
    ['paceSpread', 0, 0.4, 0.01, 'pace spread (new men)'], ['pauseChance', 0, 1, 0.05, 'patrol stop chance'], ['pauseMin', 0, 10, 0.1, 'stop min (s)'], ['pauseMax', 0, 15, 0.1, 'stop max (s)'], ['dash', 1, 1.6, 0.05, 'dash to cover ×run']])
    track(life.add(LIFE, k, lo, hi, step).name(label), `life.${k}`, lifeWhere);

  // ---- Weather: force a run's conditions (restarts), and the storm's lightning (world/storm.js STORM) ----
  const wx = gui.addFolder('Weather').close();
  const W = { weather: sessionStorage.getItem('sniper-slice.weather') ?? 'as drawn', flashes: settings.flashes ?? 'full' };
  wx.add(W, 'weather', ['as drawn', 'briefed', 'overcast', 'rain', 'mist', 'dusk', 'storm']).name('weather (restarts)').onChange(v => {
    if (v === 'as drawn') sessionStorage.removeItem('sniper-slice.weather'); else sessionStorage.setItem('sniper-slice.weather', v);
    setTimeout(() => location.reload(), 60);
  });
  wx.add(W, 'flashes', ['full', 'reduced']).name('lightning flashes').onChange(v => { settings.flashes = v; });   // (the player's own setting: Settings)
  if (g.storm) {
    const stormWhere = 'src/world/storm.js · STORM';
    track(wx.add(STORM.every, 0, 1, 60, 0.5).name('strikes every (min s)'), 'storm.every.0', stormWhere, 'global', 'every', STORM.every);
    track(wx.add(STORM.every, 1, 1, 90, 0.5).name('strikes every (max s)'), 'storm.every.1', stormWhere, 'global', 'every', STORM.every);
    for (const [k, lo, hi, step, label] of [['closeShare', 0, 1, 0.05, 'close strikes share'], ['groundShare', 0, 1, 0.05, 'ground strikes (of close)'], ['flash', 0, 2, 0.05, 'flash brightness ×'],
      ['reveal', 0, 2, 0.05, 'flash: guards see further'], ['mask', 0, 6, 0.1, 'thunder covers a shot (s)'], ['rumble', 0, 1.5, 0.05, 'rumble bed level']])
      track(wx.add(STORM, k, lo, hi, step).name(label), `storm.${k}`, stormWhere);
    wx.add({ go() { g.storm.strike(); } }, 'go').name('Strike now');
    wx.add({ go() { const f = camera.getWorldDirection(new THREE.Vector3()); g.storm.strike(80 + Math.random() * 120, true, Math.atan2(f.z, f.x) + (Math.random() - 0.5) * 0.5); } }, 'go').name('Strike near, ahead (ground)');
  }

  // ---- Play ----
  const play = gui.addFolder('Play');
  const P = { god: false, cones: false, sounds: false, paused: false, mission: missionId, slot: '', includeTarget: false };
  // God mode: the game's one way to hurt you (player.damage: bullets, blasts, falls, fire) does nothing.
  const damage = player.damage.bind(player);
  player.damage = (...a) => (P.god ? undefined : damage(...a));
  play.add(P, 'god').name('god mode');
  play.add({ refill() {
    player.health = 100; player.hurtT = 99;
    const r = arsenal.weapons.rifle;
    for (const [k, a] of Object.entries(AMMO)) r.ammo[k] = Math.max(r.ammo[k] ?? 0, a.start);
    for (const slot of ['rifle', 'pistol', 'heavy']) { const w = arsenal.weapons[slot]; if (w?.def) w.mag = w.def.magazine; }
    arsenal.weapons.pistol.reserve = Math.max(arsenal.weapons.pistol.reserve, arsenal.weapons.pistol.def.reserve ?? 0);
    for (const [id, a] of Object.entries(HEAVY_AMMO)) arsenal.heavyAmmo[id] = Math.max(arsenal.heavyAmmo[id], a.max);
    g.hud.message('DEV · HEALTH AND AMMO REFILLED', '');
  } }, 'refill').name('Refill health and ammo');

  // Spawn a guard: where the crosshair points, or (with the cursor free) where you next click.
  const ray = new THREE.Raycaster();
  const groundHit = (from, dir) => {
    const hit = world.raycastSegment(from, from.clone().addScaledVector(dir, 1500));
    if (hit) return hit.point.clone();
    for (let t = 1; t < 1500; t += 1) { const p = from.clone().addScaledVector(dir, t); if (p.y < world.groundAt(p.x, p.z)) return p.setY(world.groundAt(p.x, p.z)); }
    return null;
  };
  const spawnAt = (p) => {
    if (!p) { g.hud.message('DEV · NO GROUND THERE', 'wound'); return; }
    p.y = world.floorAt(p.x, p.z, p.y + 0.3);
    const yaw = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);   // (facing you)
    // ('Reinforcement': a save puts him back as one, so a dev spawn never shifts the original men's order)
    const s = new Soldier({ position: p, yaw, name: 'Reinforcement' });
    world.addSoldier(s); stealth.enlist(s); ai.enlist(s);
    s.home = p.clone();
    g.hud.message(`DEV · GUARD SPAWNED ${Math.round(p.distanceTo(player.pos))} M AWAY`, '');
  };
  let arming = false, swallow = false;
  play.add({ crosshair() { const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); spawnAt(groundHit(camera.position.clone(), d)); } }, 'crosshair').name('Spawn guard at crosshair');
  play.add({ click() { arming = true; g.hud.message('DEV · CLICK THE GROUND TO PLACE A GUARD', ''); } }, 'click').name('Spawn guard where I click');
  const onDown = (e) => {
    if (!arming || e.target !== renderer.domElement) return;
    e.stopImmediatePropagation(); e.preventDefault();
    arming = false; swallow = true;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    spawnAt(groundHit(ray.ray.origin.clone(), ray.ray.direction));
  };
  addEventListener('mousedown', onDown, true);
  addEventListener('click', (e) => { if (swallow && e.target === renderer.domElement) { swallow = false; e.stopImmediatePropagation(); } }, true);
  // Clear: every living enemy dies quietly and is hidden (the game's own death, so nothing is left
  // half-removed). The mission's target is spared unless asked: his death completes the mission.
  play.add({ clear() {
    let n = 0;
    for (const s of world.soldiers) {
      if (!s.alive || (s.officer && !P.includeTarget)) continue;
      s.die(new THREE.Vector3(0, 0, 1), { quiet: true });
      s.root.visible = false; n++;
    }
    for (const d of g.dogs?.dogs ?? []) if (d.mode !== 'dead') { g.dogs.kill(d, true); d.a.root.visible = false; n++; }
    g.hud.message(`DEV · ${n} CLEARED`, '');
  } }, 'clear').name('Clear all enemies');
  play.add(P, 'includeTarget').name('…the target too');
  play.add(dev, 'timeScale', 0, 3, 0.05).name('time scale');
  play.add(P, 'paused').name('pause').onChange(v => g.pause(v));
  play.add(P, 'cones').name('sight cones').onChange(v => { cones.visible = v; });
  play.add(P, 'sounds').name('sound rings').onChange(v => { rings.visible = v; });
  play.add({ restart() { location.reload(); } }, 'restart').name('Restart mission');
  play.add(P, 'mission', g.missions).name('mission');
  play.add({ go() { g.chooseMission(P.mission); } }, 'go').name('Go to that mission');
  const slots = saves.list().filter(x => x.save).map(x => x.slot);
  if (slots.length) {
    P.slot = slots.includes('auto') ? 'auto' : slots[0];
    play.add(P, 'slot', slots).name('checkpoint / save');
    play.add({ load() { saves.load(P.slot); } }, 'load').name('Load it');
  }

  // ---- overlays: sight cones and sound rings ----
  const overlayMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const fan = (half) => {   // a flat fan of radius 1, its middle along +Z (a soldier's facing)
    const pts = [0, 0, 0], n = 24;
    for (let i = 0; i <= n; i++) { const a = -half + (2 * half * i) / n; pts.push(Math.sin(a), 0, Math.cos(a)); }
    const idx = [];
    for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)).setIndex(idx);
  };
  const coneGeo = fan(SIGHT.cone), sideGeo = fan(SIGHT.peripheral);
  // (the outline: the fan's rim and its two edges back to the guard; a dozen filled cones on top of
  // each other hid the ground, so the fill is faint and the line carries it)
  const rim = (half) => { const p = [0, 0, 0]; for (let i = 0; i <= 24; i++) { const a = -half + (2 * half * i) / 24; p.push(Math.sin(a), 0, Math.cos(a)); } return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); };
  const coneRim = rim(SIGHT.cone);
  const lineMat = (c, o) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false, fog: false });
  const STATE = { calm: 0x40d060, suspicious: 0xffc020, alerted: 0xff3020 };
  const cones = new THREE.Group(), rings = new THREE.Group();
  cones.visible = rings.visible = false;
  cones.renderOrder = rings.renderOrder = 999;
  scene.add(cones, rings);
  for (const o of [cones, rings]) o.userData.noAO = true;
  const coneOf = new Map();
  const ringGeo = new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2);
  const heard = [];
  const noise = stealth.noise.bind(stealth);
  stealth.noise = (pos, radius, kind) => { heard.push({ at: pos.clone(), radius, kind, t: performance.now() }); return noise(pos, radius, kind); };
  const steps = new THREE.Mesh(ringGeo, overlayMat(0x60c0ff, 0.8));
  steps.userData.noAO = true; rings.add(steps);
  function drawOverlays() {
    if (cones.visible) {
      const range = SIGHT.range * (map.sightScale ?? 1) * stealth.sightK;
      for (const s of world.soldiers) {
        let c = coneOf.get(s);
        if (!s.alive || s.range || s.takenDown || s.downed) { if (c) c.visible = false; continue; }
        if (!c) {
          c = new THREE.Group();
          c.add(new THREE.Mesh(coneGeo, overlayMat(STATE.calm, 0.035)), new THREE.Mesh(sideGeo, overlayMat(STATE.calm, 0.012)), new THREE.LineLoop(coneRim, lineMat(STATE.calm, 0.9)));
          c.traverse(o => { o.userData.noAO = true; o.renderOrder = 999; });
          cones.add(c); coneOf.set(s, c);
        }
        const st = s.aware?.state ?? 'calm';
        for (const m of c.children) m.material.color.setHex(STATE[st]);
        c.visible = true;
        c.position.copy(s.root.position).y += 0.15;
        c.rotation.y = s.root.rotation.y;
        c.scale.setScalar(range * (st === 'alerted' ? 1.3 : 1));   // (standing in the open: stealth.js canSee)
      }
    }
    if (rings.visible) {
      const now = performance.now();
      while (heard.length && now - heard[0].t > 3000) { const h = heard.shift(); if (h.mesh) { rings.remove(h.mesh); h.mesh.material.dispose(); } }
      for (const h of heard) {
        if (!h.mesh) { h.mesh = new THREE.Mesh(ringGeo, overlayMat(h.kind === 'shot' || h.kind === 'explosion' ? 0xff5040 : 0xffffff, 0.9)); h.mesh.renderOrder = 999; rings.add(h.mesh); }
        h.mesh.position.copy(h.at).y += 0.2;
        h.mesh.scale.setScalar(Math.max(0.1, h.radius));
        h.mesh.material.opacity = 0.9 * (1 - (now - h.t) / 3000);
      }
      steps.visible = stealth.noiseRadius > 0.1;
      steps.position.copy(player.pos).y += 0.1;
      steps.scale.setScalar(Math.max(0.1, stealth.noiseRadius));
    }
  }

  // ---- free camera ----
  const held = new Set();
  addEventListener('keydown', (e) => held.add(e.code));
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());
  const MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyC', 'KeyZ'];
  // Before the game's step: with the free camera on, the mouse and the moving keys are its, not yours.
  function preStep() {
    if (!dev.freecam) return;
    for (const k of MOVE) { input.keys.delete(k); input.pressed.delete(k); }
    free.yaw -= input.mouseDX * 0.0022; free.pitch = THREE.MathUtils.clamp(free.pitch - input.mouseDY * 0.0022, -1.55, 1.55);
    input.mouseDX = input.mouseDY = 0;
  }
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3();
  // After the camera rig: the free camera takes over the view; then the overlays follow.
  function frame(dt) {
    if (dev.freecam) {
      _q.setFromEuler(_e.set(free.pitch, free.yaw, 0));
      const k = free.speed * dt * (held.has('ShiftLeft') || held.has('ShiftRight') ? 4 : 1);
      _v.set((held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0), (held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0), (held.has('KeyS') ? 1 : 0) - (held.has('KeyW') ? 1 : 0));
      free.pos.addScaledVector(_v.applyQuaternion(_q), k);
      camera.position.copy(free.pos); camera.quaternion.copy(_q);
    }
    drawOverlays();
  }

  // ---- the free cursor: ` lets go of the mouse without the pause menu ----
  const lockChange = input.onLockChange;
  input.onLockChange = (locked) => { if (locked) dev.cursor = false; lockChange(locked); };
  addEventListener('keydown', (e) => {
    if (e.code === 'Backslash') gui.show(gui._hidden);
    if (e.code === 'Backquote' && input.locked) { dev.cursor = true; input.unlock(); }
    else if (e.code === 'Escape' && dev.cursor) { dev.cursor = false; lockChange(false); }   // (Esc with the cursor free: the menu, as usual)
  });

  // ---- saving ----
  const changed = () => reg.filter(r => JSON.stringify(r.ctrl.getValue()) !== JSON.stringify(r.initial));
  const pack = () => {
    const out = { global: {}, maps: {} };
    for (const r of changed()) (r.scope === 'map' ? (out.maps[missionId] ??= {}) : out.global)[r.id] = r.ctrl.getValue();
    return out;
  };
  const unpack = (data) => {
    if (!data) return;
    const vals = { ...data.global, ...data.maps?.[missionId] };
    for (const r of reg) if (r.id in vals) r.ctrl.setValue(vals[r.id]);
    if (Object.keys(vals).length) rebake();   // (once, for the sky's reflections)
  };
  // What moves into the code: each changed value under the file and object it belongs in (a camera
  // offset as its whole [right, up, back]); colours as 0x hex, like the code writes them.
  const forCode = () => {
    const code = {};
    for (const r of changed()) {
      const at = (code[r.where] ??= {});
      let v = r.arr ? [...r.arr] : r.ctrl.getValue();
      if (r.ctrl instanceof ColorController) v = `0x${v.toString(16).padStart(6, '0')}`;
      else if (typeof v === 'number') v = Math.round(v * 1e5) / 1e5;
      at[r.key] = v;
    }
    return { mission: missionId, conditions: g.conditions?.kind ?? 'briefed', changed: code };
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    }
  };
  const S = gui.addFolder('Save');
  S.add({ async copyValues() {
    const json = JSON.stringify(forCode(), null, 2);
    console.log('[dev] changed values\n' + json);
    g.hud.message((await copy(json)) ? `DEV · ${changed().length} CHANGED VALUES COPIED` : 'DEV · COPY FAILED: SEE THE CONSOLE', '');
  } }, 'copyValues').name('Copy values (JSON)');
  S.add({ save() {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* fresh */ }
    const p = pack();
    all.global = p.global;
    all.maps = { ...all.maps, [missionId]: p.maps[missionId] ?? {} };
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
    g.hud.message(`DEV · SAVED ${changed().length} VALUES IN THIS BROWSER`, '');
  } }, 'save').name('Save (this browser)');
  S.add({ reset() {
    for (const r of reg) r.ctrl.setValue(structuredClone(r.initial));
    rebake();
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || '{}');
      all.global = {}; if (all.maps) delete all.maps[missionId];
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage blocked */ }
    g.hud.message('DEV · BACK TO THE CODE\'S VALUES', '');
  } }, 'reset').name('Reset');
  S.add({ download() {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* fresh */ }
    const p = pack(), data = { global: p.global, maps: { ...all.maps, ...p.maps } };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'dev-overrides.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } }, 'download').name('Download overrides file');
  S.add({ note: FILE ? 'dev-overrides.json: applied' : 'no dev-overrides.json' }, 'note').name('file').disable();

  // The starting values are in (`initial` above); now the file, then this browser's saved tuning.
  unpack(FILE);
  try { unpack(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { /* nothing saved */ }
  if (changed().length) g.hud.message(`DEV · ${changed().length} TUNED VALUES PUT BACK`, '');
  dev.gui = gui; dev.free = free;   // (for scripted checks: gui.controllersRecursive(), the free camera)
  window.game.dev = dev;
  return dev;
}
