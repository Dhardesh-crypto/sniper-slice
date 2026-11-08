// Dev tool: the look pass's fixed views of a mission, rendered through the whole post chain (AO,
// bloom, the grade, tone mapping: what the player sees, unlike shot.js and snap.js, which skip
// it), and POSTed to a receiver on 127.0.0.1:5199 that saves data URLs (see snap.js). Run it with
// the same code before and after a change and the pictures line up, because every view is worked
// out from the mission itself, not typed in:
//   A  from the spawn, eye height, toward the middle of the mission's pickups (where the work is);
//   B  from 35 m short of that middle, 9 m up, looking at it (the buildings and props close to);
//   C  from the spawn, 14 m up, a quarter turn from A, a little above level (the far hills).
// In the console of the running game (pick the mission first: CLAUDE.md):
//   const s = await import('/tools/look-shots.js'); await s.shots('before');   → the file names
// The views come out at 1200 × 750, drawn at that size and pixel ratio 1 whatever the window is
// (so before and after match), then the game's own size is put back.
export async function shots(tag = 'look', { W = 1200, H = 750 } = {}) {
  while (!window.game?.world?.spawn) await new Promise(r => setTimeout(r, 300));
  while (performance.now() < 15000) await new Promise(r => setTimeout(r, 300));   // (the skins and far country load late)
  document.getElementById('menu').style.display = 'none';
  const g = window.game, THREE = g.THREE, R = g.renderer, w = g.world;
  const mission = sessionStorage.getItem('sniper-slice.mission') ?? 'vineyard';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const sp = w.spawn.clone();
  const mid = V(0, 0, 0);
  for (const b of g.pickups.boxes) mid.add(b.at);
  mid.multiplyScalar(1 / Math.max(1, g.pickups.boxes.length));
  mid.y = w.floorAt(mid.x, mid.z, 500);
  const toMid = mid.clone().sub(sp).setY(0).normalize();
  const side = V(-toMid.z, 0, toMid.x);
  const floor = (p, up) => V(p.x, w.floorAt(p.x, p.z, 500) + up, p.z);
  const nearMid = mid.clone().addScaledVector(toMid, -35);
  const views = {
    A: { from: floor(sp, 1.7), to: floor(mid, 1.5), fov: 55 },
    B: { from: floor(nearMid, 9), to: floor(mid, 1.5), fov: 60 },
    C: { from: floor(sp, 14), to: floor(sp, 14).addScaledVector(side, 100).add(V(0, 4, 0)), fov: 45 },
  };
  // Put the player at the camera (so the shadows, tree culling and grass gather round it), run a
  // moment, then draw through the post chain with our own camera and put the game's back.
  const me = g.avatar.root;
  const names = [], pr0 = g.post.pixelRatio;
  g.post.setPixelRatio(1); R.setSize(W, H, false); g.post.setSize(W, H);
  for (const [k, v] of Object.entries(views)) {
    g.player.pos.copy(v.from).setY(w.floorAt(v.from.x, v.from.z, 500));
    g.advance(0.1);
    const cam = new THREE.PerspectiveCamera(v.fov, W / H, 0.05, 3000);
    cam.position.copy(v.from); cam.lookAt(v.to); cam.updateMatrixWorld();
    w.cullTrees?.(cam.position, Math.tan(THREE.MathUtils.degToRad(55) / 2) / Math.tan(THREE.MathUtils.degToRad(v.fov) / 2));
    w.focusShadows?.(v.to);
    me.visible = false;                               // (the player's own body would stand in view A)
    g.post.setCamera(cam);
    g.post.draw();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d').drawImage(R.domElement, 0, 0, W, H);
    g.post.setCamera(g.camera);
    me.visible = true;
    const name = `${tag}_${mission}_${k}`;
    await fetch('http://127.0.0.1:5199/?n=' + name, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) });
    names.push(name);
  }
  g.player.pos.copy(sp);
  R.setSize(innerWidth, innerHeight, false); g.post.setPixelRatio(pr0);
  return names;
}

// Fix what the run draws by chance, so the before and after views show the same day: the run's
// seed (4 draws the weather the mission was briefed with, on every map: conditions.js), summer,
// no first-time hints; then load the mission. The page reloads, so call shots() after it.
export function prepare(mission) {
  sessionStorage.setItem('sniper-slice.seed', '4');
  sessionStorage.setItem('sniper-slice.mission', mission);
  const k = 'sniper-slice.settings', s = JSON.parse(localStorage.getItem(k) || '{}');
  localStorage.setItem(k, JSON.stringify({ ...s, season: 'summer', hints: false }));
  location.reload();
}

// The frame time the same way bench.js measures it, at view A and B's places (ms per frame).
export async function frameTime() {
  const b = await import('/tools/bench.js');
  return b.bench();
}
