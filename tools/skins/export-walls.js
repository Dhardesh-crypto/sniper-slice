// Step 1 of a building skin (world/skins.js): a walk-in building's walls, slab and parapet, as an
// OBJ relative to its ground floor at its centre, for stablegen-texture.py. Load in the browser
// console with the mission running (the dev server serves it), then save what it returns:
//   await import('/tools/skins/export-walls.js'); const { built } = await import('/src/world/buildings.js');
//   copy(exportWalls(built[0]))          // buildings.js lists every walk-in building as it's made
// Only the Builder's own boxes go in, and only those whose middle is inside the building's footprint
// (not the merged trim, doors, props, people or the house next door): the trim stays in the game
// over the skin, and anything else in front of a wall would hide that wall from the "seen from
// outside" test. Each part is named for what it's made of (wall<k>_stone, _plaster, _wood,
// _concrete), by the material's tiling (kit.js), so the texturing knows what to ask for.
const KINDS = { 2.5: 'stone', 3.5: 'plaster', 1.6: 'wood', 3: 'concrete' };
window.exportWalls = ({ x, z, y, w, d, floors, h }) => {
  const g = window.game, THREE = g.THREE;
  let root = g.avatar.root; while (root.parent) root = root.parent;
  const inside = new THREE.Box3(new THREE.Vector3(x - w / 2 - 0.6, y - 3, z - d / 2 - 0.6), new THREE.Vector3(x + w / 2 + 0.6, y + floors * h + 2, z + d / 2 + 0.6));
  const bb = new THREE.Box3(), c = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const out = [`# walls of the building at (${x}, ${y}, ${z}), relative to it`];
  let base = 1, k = 0;
  const builderBox = o => { const p = o.parent; return p && p.type === 'Group' && p.parent === root && !p.name; };
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || !builderBox(o) || o.userData.decor) return;
    if (Array.isArray(o.material) || o.material.isMeshBasicMaterial || !o.material.map) return;   // (not roofs)
    const kind = KINDS[o.material.userData.tile];
    if (!kind) return;
    bb.setFromObject(o);
    if (!inside.containsPoint(bb.getCenter(c)) || !inside.containsBox(bb.clone().expandByScalar(-0.05))) return;
    const s = bb.getSize(new THREE.Vector3());
    if (s.y > 2.1 && s.y < 2.3 && Math.min(s.x, s.z) < 0.12) return;         // (a door leaf)
    o.updateMatrixWorld(true); nm.getNormalMatrix(o.matrixWorld);
    const pos = o.geometry.attributes.position, nor = o.geometry.attributes.normal, idx = o.geometry.index;
    out.push(`o wall${k++}_${kind}`);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push(`v ${(v.x - x).toFixed(4)} ${(v.y - y).toFixed(4)} ${(v.z - z).toFixed(4)}`); }
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
