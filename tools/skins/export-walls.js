// Step 1 of a building skin (world/skins.js): the builder's walls, slab and parapet around (x, z),
// as an OBJ relative to (x, ground, z), for stablegen-texture.py. Paste into the browser console
// with the mission loaded, then save the string it returns as <workdir>/farmhouse.obj:
//   copy(exportWalls(-150, 215, 6.5, 5))     // the Flak farmhouse: centre, half-width, half-depth
// Only the Builder's own boxes go in (not the merged trim, doors, props or people): the trim stays
// in the game over the skin, and anything else in front of a wall would hide that wall from the
// "seen from outside" test.
window.exportWalls = (x0, z0, hw, hd) => {
  const g = window.game, THREE = g.THREE;
  let root = g.avatar.root; while (root.parent) root = root.parent;
  const y0 = g.world.groundAt(x0, z0);
  const area = new THREE.Box3(new THREE.Vector3(x0 - hw, y0 - 2, z0 - hd), new THREE.Vector3(x0 + hw, y0 + 5, z0 + hd));
  const bb = new THREE.Box3(), v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const out = [`# walls around (${x0}, ${y0.toFixed(4)}, ${z0}), relative to it`];
  let base = 1, k = 0;
  const builderBox = o => { const p = o.parent; return p && p.type === 'Group' && p.parent === root && !p.name; };
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || !builderBox(o) || o.userData.decor) return;
    if ([].concat(o.material).some(m => m.isMeshBasicMaterial || !m.map)) return;
    bb.setFromObject(o);
    const s = bb.getSize(new THREE.Vector3());
    if (!bb.intersectsBox(area) || Math.max(s.x, s.z) > 2 * hw + 1) return;
    if (s.y > 2.1 && s.y < 2.3 && Math.min(s.x, s.z) < 0.12) return;         // (a door leaf)
    o.updateMatrixWorld(true); nm.getNormalMatrix(o.matrixWorld);
    const pos = o.geometry.attributes.position, nor = o.geometry.attributes.normal, idx = o.geometry.index;
    out.push(`o wall${k++}`);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push(`v ${(v.x - x0).toFixed(4)} ${(v.y - y0).toFixed(4)} ${(v.z - z0).toFixed(4)}`); }
    for (let i = 0; i < pos.count; i++) { n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); out.push(`vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}`); }
    const tris = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      const a = idx ? [idx.getX(3 * t), idx.getX(3 * t + 1), idx.getX(3 * t + 2)] : [3 * t, 3 * t + 1, 3 * t + 2];
      out.push('f ' + a.map(i => `${i + base}//${i + base}`).join(' '));
    }
    base += pos.count;
  });
  return out.join('\n');
};
