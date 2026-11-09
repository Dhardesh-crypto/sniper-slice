// Dev tool: before/after views of one kind of tree (the umbrella pines, the cypresses), drawn
// through the whole post chain like look-shots.js and POSTed to the receiver on 127.0.0.1:5199.
// The tree is found, not typed in: the instance of that kind nearest the spawn (its instanced
// meshes picked by material name), so the same tree is framed before and after a change.
//   up    12 m off, eye height, looking up into the crown against the sky (the underside);
//   side  30 m off, level with the crown (near version: closer than 55 m);
//   far   75 m off, 4 m up (the far version, past LOD_NEAR).
// In the console (after look-shots prepare(mission), so the day is the same):
//   const t = await import('/tools/tree-shots.js'); await t.treeShots('after');
// match: per kind, a test on the material name of its instanced meshes.
export async function treeShots(tag = 'trees', { W = 1000, H = 700, match = { pine: /^pine/, cypress: /^cypress/ } } = {}) {
  while (!window.game?.world?.spawn) await new Promise(r => setTimeout(r, 300));
  while (performance.now() < 15000) await new Promise(r => setTimeout(r, 300));
  document.getElementById('menu').style.display = 'none';
  const g = window.game, THREE = g.THREE, R = g.renderer, w = g.world;
  const mission = sessionStorage.getItem('sniper-slice.mission') ?? 'vineyard';
  const sp = w.spawn.clone(), m = new THREE.Matrix4(), p = new THREE.Vector3();
  const names = [], pr0 = g.post.pixelRatio;
  g.post.setPixelRatio(1); R.setSize(W, H, false); g.post.setSize(W, H);
  for (const [kind, re] of Object.entries(match)) {
    // The nearest instance to the spawn among every instanced mesh of this kind (any chunk).
    let best = null, bd = Infinity;
    w.scene.traverse(o => {
      if (!o.isInstancedMesh || !re.test(o.material?.name ?? '')) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); p.setFromMatrixPosition(m);
        const d = p.distanceTo(sp);
        if (d < bd && d > 25) { bd = d; best = p.clone(); }   // (not one standing on the spawn)
      }
    });
    if (!best) { console.warn('no tree', kind); continue; }
    const crown = best.clone().add(new THREE.Vector3(0, kind === 'pine' ? 9 : 6, 0));
    // Look from the spawn's side, so the same light falls the same way.
    const dir = sp.clone().sub(best).setY(0).normalize();
    const at = (dist, up) => { const q = best.clone().addScaledVector(dir, dist); q.y = w.floorAt(q.x, q.z, 500) + up; return q; };
    const views = { up: [at(12, 1.7), 60], side: [at(30, 6), 45], far: [at(75, 4), 35] };
    for (const [k, [from, fov]] of Object.entries(views)) {
      g.player.pos.copy(from).setY(w.floorAt(from.x, from.z, 500));
      g.advance(0.1);
      const cam = new THREE.PerspectiveCamera(fov, W / H, 0.05, 3000);
      cam.position.copy(from); cam.lookAt(k === 'up' ? crown : crown.clone().setY(crown.y - 2)); cam.updateMatrixWorld();
      w.cullTrees?.(cam.position, 1);          // (no scope zoom: the far view stays past LOD_NEAR)
      w.focusShadows?.(crown);
      g.avatar.root.visible = false;
      g.post.setCamera(cam); g.post.draw();
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(R.domElement, 0, 0, W, H);
      g.post.setCamera(g.camera); g.avatar.root.visible = true;
      const name = `${tag}_${mission}_${kind}_${k}`;
      await fetch('http://127.0.0.1:5199/?n=' + name, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) });
      names.push(name);
    }
  }
  g.player.pos.copy(sp);
  R.setSize(innerWidth, innerHeight, false); g.post.setPixelRatio(pr0);
  return names;
}
