// Dev tool: the look audit. Every model group the game loads (characters, weapons, vehicles,
// props, animals, foliage, the Blender kits, the building skins, the pickup crates) measured and
// drawn under one grey reference light, so assets from different sources can be compared on
// equal terms instead of each under its own mission's sun.
// Per asset it reports the average albedo (linear luminance of colour × map, over the model's
// surface), roughness and metalness (factor × map), the sky reflection strength the game gives it
// and its texture size, and flags albedo outside 0.04–0.8 (charcoal to fresh plaster: darker
// reads as a hole, lighter glows in the sun), plus metalness or roughness outside its kind's
// range (src/world/materials.js). `fix` is the brightness factor that would bring a flagged
// albedo into range: those go into src/world/materials.json.
// With the dev server up, in the console of the running game (any mission; it loads the rest):
//   const a = await import('/tools/look-audit.js'); const r = await a.audit('before');
//   r.out   → the flagged assets;   r.sheets → the contact sheets POSTed (see snap.js's receiver)
// The report itself is POSTed as look-audit-<tag>.json. Nothing in the game is changed (the
// reference render borrows the renderer and puts its size, exposure and env maps back).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { assets } from '/src/world/characters.js';
import { PROPS, loadProps } from '/src/world/props.js';
import { SKINNED } from '/src/world/skins.js';
import { loadGLB } from '/src/world/gltf.js';
import { KINDS, kindOf, surfaceStats, normalizeModel } from '/src/world/materials.js';

const ALB = [0.04, 0.8];
const TILE = 200, COLS = 8;
const POST = (name, body) => fetch('http://127.0.0.1:5199/?n=' + name, { method: 'POST', body });

// One asset's averages over its surface, and what's wrong with them.
function measure(root, key, kind) {
  root.updateMatrixWorld(true);
  let w = 0;
  const acc = { albedo: 0, roughness: 0, metalness: 0, env: 0, mapSize: 0 }, mats = [], users = new Map();
  root.traverse(o => {
    if (!o.isMesh || !o.material || o.visible === false) return;
    for (const m of [o.material].flat()) if ('roughness' in m) users.set(m, [...(users.get(m) ?? []), o]);
  });
  for (const [m, meshes] of users) {
    const st = surfaceStats(m, meshes), a = st.area || 1e-9;
    for (const k of ['albedo', 'roughness', 'metalness', 'env']) acc[k] += st[k] * a;
    acc.mapSize = Math.max(acc.mapSize, st.mapSize);
    w += a;
    mats.push({ name: m.name || meshes[0].name, ...round({ albedo: st.albedo, roughness: st.roughness, metalness: st.metalness, env: st.env, area: a }) });
  }
  if (!w) return null;
  for (const k of ['albedo', 'roughness', 'metalness', 'env']) acc[k] /= w;
  const K = KINDS[kind], flags = [];
  if (acc.albedo < ALB[0]) flags.push('dark');
  if (acc.albedo > ALB[1]) flags.push('bright');
  if (K.flat !== null && acc.metalness > K.metal + 0.02) flags.push('metal');
  if (K.flat !== null && (acc.roughness < K.rough[0] - 0.02 || acc.roughness > K.rough[1] + 0.02)) flags.push('rough');
  const fix = acc.albedo < ALB[0] ? 0.07 / acc.albedo : acc.albedo > ALB[1] ? 0.7 / acc.albedo : 1;
  return { key, kind, ...round(acc), flags, fix: +fix.toFixed(2), mats };
}
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]));

// The reference light: mid-grey surroundings, a soft white key from the upper left and a fill,
// a neutral room for reflections. Exposure 1, ACES as in the game.
function referenceScene(R) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0.18, 0.18, 0.18);
  const pm = new THREE.PMREMGenerator(R);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  s.environment = env; s.environmentIntensity = 0.5;
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-3, 4, 5);
  s.add(key, new THREE.HemisphereLight(0xffffff, 0x555555, 0.6));
  return { scene: s, env };
}

// Draw one asset into a tile: framed by its bounds, three-quarter view.
function drawTile(R, ref, root, ctx, x, y, row) {
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 1e-3);
  const cam = new THREE.PerspectiveCamera(30, 1, r / 50, r * 20);
  cam.position.copy(c).add(new THREE.Vector3(1, 0.6, 1.3).normalize().multiplyScalar(r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05));
  cam.lookAt(c);
  // The game's materials carry the mission's sky as their own env map: borrow the room's for the picture.
  const swapped = [];
  root.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) if (m.envMap) { swapped.push([m, m.envMap, m.envMapIntensity]); m.envMap = ref.env; m.envMapIntensity = 0.5 * (m.userData.look?.env ?? 1); } });
  const parent = root.parent;
  ref.scene.add(root);
  R.render(ref.scene, cam);
  ref.scene.remove(root);
  if (parent) parent.add(root);
  for (const [m, e, i] of swapped) { m.envMap = e; m.envMapIntensity = i; }
  ctx.drawImage(R.domElement, 0, 0, TILE, TILE, x, y, TILE, TILE);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y + TILE - 34, TILE, 34);
  ctx.font = '11px monospace'; ctx.fillStyle = row.flags.length ? '#ff6a5a' : '#e8e8e8';
  ctx.fillText(row.key.slice(0, 28), x + 4, y + TILE - 21);
  ctx.fillText(`a${row.albedo.toFixed(2)} r${row.roughness.toFixed(2)} m${row.metalness.toFixed(2)} e${row.env.toFixed(2)} ${row.mapSize}`, x + 4, y + TILE - 7);
}

export async function audit(tag = 'audit', { sheets = true } = {}) {
  while (!window.game?.world) await new Promise(r => setTimeout(r, 300));
  const g = window.game, R = g.renderer;
  // Everything the game can load: the props of every mission, every skin.
  await loadProps(Object.keys(PROPS));
  // (Skins get the material step only once the game gives it to them: a before audit sees them raw.)
  let live = false;
  for (const gl of Object.values(assets.models)) gl.scene.traverse(o => { if (o.material?.userData?.look) live = true; });
  const skins = {};
  await Promise.all([...SKINNED].map(async k => {
    const key = `skin_${k.replace('/', '_')}`;
    try { const sc = (await loadGLB(`/models/${key}.glb`)).scene; skins[key] = live ? normalizeModel(sc, key, 'skin') : sc; } catch { /* missing skin */ }
  }));
  const groups = { character: [], weapon: [], vehicle: [], prop: [], animal: [], foliage: [], kit: [], skin: [], pickup: [] };
  for (const [key, gl] of Object.entries(assets.models)) {
    // (Not drawn with their own materials: the x-ray's organs, rocks (stone.js's material), and the
    // far trees, which wear their near model's material: vegetation.js.)
    if (key === 'anatomy' || key === 'rock' || key.endsWith('Lod')) continue;
    groups[kindOf(key)].push([key, gl.scene]);
  }
  for (const [key, s] of Object.entries(skins)) groups.skin.push([key, s]);
  for (const [kind, k] of Object.entries(g.pickups?.models?.kinds ?? {})) {
    const grp = new THREE.Group();
    for (const { mesh } of k.parts) grp.add(mesh.clone());
    groups.pickup.push([`pickup_${kind}`, grp]);
  }
  const rows = [];
  for (const [kind, list] of Object.entries(groups)) for (const [key, root] of list) {
    const row = measure(root, key, kind);
    if (row) { row.root = root; rows.push(row); }
  }
  // Contact sheets, one per group.
  const out = [];
  if (sheets) {
    const size = R.getSize(new THREE.Vector2()), pr = R.getPixelRatio(), exp = R.toneMappingExposure;
    R.setPixelRatio(1); R.setSize(TILE, TILE, false); R.toneMappingExposure = 1;
    const ref = referenceScene(R);
    for (const kind of Object.keys(groups)) {
      const list = rows.filter(r => r.kind === kind);
      if (!list.length) continue;
      const c = document.createElement('canvas');
      c.width = TILE * Math.min(COLS, list.length); c.height = TILE * Math.ceil(list.length / COLS);
      const ctx = c.getContext('2d');
      list.forEach((row, i) => drawTile(R, ref, row.root, ctx, (i % COLS) * TILE, Math.floor(i / COLS) * TILE, row));
      const name = `look-audit-${tag}-${kind}`;
      await POST(name, c.toDataURL('image/jpeg', 0.88));
      out.push(name);
    }
    ref.env.dispose();
    R.setPixelRatio(pr); R.setSize(size.x, size.y, false); R.toneMappingExposure = exp;
  }
  for (const r of rows) delete r.root;
  const flagged = rows.filter(r => r.flags.length).map(r => ({ key: r.key, kind: r.kind, albedo: r.albedo, roughness: r.roughness, metalness: r.metalness, flags: r.flags, fix: r.fix }));
  const report = { tag, date: new Date().toISOString(), range: ALB, count: rows.length, out: flagged, rows };
  await POST(`look-audit-${tag}.json`, JSON.stringify(report, null, 1));
  return { count: rows.length, out: flagged, sheets: out };
}
