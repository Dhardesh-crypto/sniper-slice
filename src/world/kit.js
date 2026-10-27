// Shared building blocks for every map: textured materials and the Builder, which keeps
// each solid mesh for bullet raycasts (`solids`) and its box for collision (`boxes`).
import * as THREE from 'three';
import { textures, worldUVs } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const T = textures();
// `tile` = metres per texture repeat (see worldUVs).
const textured = (tex, opts, tile) => Object.assign(new THREE.MeshStandardMaterial({ ...tex, ...opts }), { userData: { tile } });
export const M = {
  stone: textured(T.stone, { roughness: 0.95 }, 2.5),
  plaster: textured(T.plaster, { roughness: 0.92 }, 3.5),
  plaster2: textured(T.plaster2, { roughness: 0.92 }, 3.5),
  roof: textured(T.roof, { roughness: 0.8 }, 2.2),
  wood: textured(T.wood, { roughness: 0.85 }, 1.6),
  darkWood: textured(T.darkWood, { roughness: 0.85 }, 1.6),
  window: new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: 0.15, metalness: 0.4 }),
  shutter: textured(T.wood, { color: 0x6f9a6a, roughness: 0.8 }, 1.2),
  metal: new THREE.MeshStandardMaterial({ color: 0x4b5045, roughness: 0.55, metalness: 0.5 }),
  truck: new THREE.MeshStandardMaterial({ color: 0x55593f, roughness: 0.7, metalness: 0.2 }),
  canvas: new THREE.MeshStandardMaterial({ color: 0x6c6b4f, roughness: 1 }),
  sandbag: new THREE.MeshStandardMaterial({ color: 0x9c8c66, roughness: 1 }),
  crate: textured(T.wood, { color: 0xc9a46c, roughness: 0.9 }, 1.0),
  vine: new THREE.MeshStandardMaterial({ color: 0x4f6b2c, roughness: 0.95 }),
  earth: textured(T.ground, { color: 0x8a7552, roughness: 1 }, 2),
};

export class Builder {
  constructor(scene) {
    this.scene = scene;
    this.solids = [];
    this.boxes = [];
    this.group = new THREE.Group();
    scene.add(this.group);
  }
  // Axis-aligned box at world position (x, z), bottom at y. decor: a still, non-solid piece (a
  // window, a shutter) that the world merges with all the others of its material (mergeDecor).
  box(w, h, d, mat, x, y, z, { solid = true, rotY = 0, decor = false } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (mat.map) worldUVs(geo, mat.userData.tile);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    if (solid) this.addSolid(mesh);
    else if (decor) mesh.userData.decor = true;
    return mesh;
  }
  addSolid(mesh) {
    mesh.updateMatrixWorld(true);
    this.solids.push(mesh);
    this.boxes.push(new THREE.Box3().setFromObject(mesh));
  }
  // Gable roof as a triangular prism, ridge along x.
  gable(w, rise, d, mat, x, y, z, rotY = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2 - 0.4, 0);
    shape.lineTo(d / 2 + 0.4, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 0.8, bevelEnabled: false });
    geo.translate(0, 0, -(w + 0.8) / 2);
    geo.rotateY(Math.PI / 2);
    geo.computeVertexNormals();
    if (mat.map) worldUVs(geo, mat.userData.tile);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.addSolid(mesh);
    return mesh;
  }
  // Windows with shutters on the long faces of a building (decoration only).
  windows(cx, cz, w, d, y0, floors) {
    for (let f = 0; f < floors; f++) {
      const y = y0 + 1.2 + f * 3;
      for (let i = -1; i <= 1; i++) {
        for (const side of [-1, 1]) {
          const x = cx + i * (w / 3.5), z = cz + side * (d / 2 + 0.03);
          this.box(1.0, 1.4, 0.06, M.window, x, y, z, { solid: false, decor: true });
          this.box(0.45, 1.5, 0.08, M.shutter, x - 0.75, y - 0.05, z, { solid: false, decor: true });
          this.box(0.45, 1.5, 0.08, M.shutter, x + 0.75, y - 0.05, z, { solid: false, decor: true });
        }
      }
    }
  }
}

// Merge every decor piece (see Builder.box) into one mesh per material: a town's windows and
// shutters were some 2,300 meshes, each drawn three times a frame.
export function mergeDecor(scene) {
  scene.updateMatrixWorld(true);
  const byMat = new Map();
  scene.traverse(o => { if (o.isMesh && o.userData.decor && !o.children.length) { if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(o); } });
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const merged = new THREE.Mesh(mergeGeometries(list.map(o => o.geometry.clone().applyMatrix4(o.matrixWorld))), mat);
    merged.castShadow = merged.receiveShadow = true;
    for (const o of list) o.removeFromParent();
    scene.add(merged);
  }
}
