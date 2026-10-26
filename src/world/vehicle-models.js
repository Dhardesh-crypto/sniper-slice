// Vehicle models from Higgsfield (SAM 3D): the Opel Blitz truck, the Kübelwagen staff car and
// the trimotor transport plane. Each arrives as one textured mesh in a unit box, facing some
// axis; vehicleModel() returns a copy turned to face +z, scaled to its real length, sitting on
// y = 0 and centred on its footprint. (Fronts measured from the geometry: the bonnet is the low
// end of a truck, the windscreen sits toward a car's front.)
import * as THREE from 'three';
import { assets } from './characters.js';

const SPECS = {
  truck: { key: 'opel', length: 6.0, front: '+z' },
  car: { key: 'kubel', length: 3.6, front: '-x', narrow: 0.82 },   // SAM made it a bit wide
  plane: { key: 'plane', length: 19, front: '+z' },               // tail fin at -z (the tall end), nose engine at +z
};

const prepared = new Map();

function source(spec) {
  if (prepared.has(spec.key)) return prepared.get(spec.key);
  let mesh = null;
  assets.models[spec.key]?.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  if (mesh) {
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    if (mesh.material.map) mesh.material.map.colorSpace = THREE.SRGBColorSpace;
    mesh.material.roughness = 0.8; mesh.material.metalness = 0.15;
    mesh.geometry.computeBoundingBox();
  }
  prepared.set(spec.key, mesh);
  return mesh;
}

// Rotation that turns the model's front to +z.
const TURN = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 };

export function vehicleModel(kind, { front } = {}) {
  const spec = SPECS[kind], src = source(spec);
  const outer = new THREE.Group();
  if (!src) return outer;
  const mesh = new THREE.Mesh(src.geometry, src.material.clone());   // own material: wrecks blacken one at a time
  mesh.castShadow = mesh.receiveShadow = true;
  const bb = src.geometry.boundingBox, size = bb.getSize(new THREE.Vector3());
  const axis = (front ?? spec.front ?? '+z').slice(1);
  const scale = spec.length / size[axis];
  const inner = new THREE.Group();
  inner.add(mesh);
  mesh.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  inner.scale.setScalar(scale);
  inner.rotation.y = TURN[front ?? spec.front ?? '+z'];
  if (spec.narrow) inner.scale[axis === 'x' ? 'z' : 'x'] *= spec.narrow;
  outer.add(inner);
  outer.userData.mesh = mesh;
  outer.userData.kind = kind;
  outer.userData.length = spec.length;
  if (kind === 'plane') addPropellers(mesh, outer);
  return outer;
}

// Spinning propeller blur discs on the plane's three engines (model units, measured: the nose
// engine on the centre line, the wing engines 18% of the span out, all a little ahead of the cowling).
function addPropellers(mesh, outer) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a18, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  const blade = new THREE.MeshBasicMaterial({ color: 0x222220, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  outer.userData.props = [];
  for (const [x, z] of [[0, 0.365], [-0.18, 0.305], [0.18, 0.305]]) {
    const hub = new THREE.Group();
    hub.position.set(x, 0.02, z);
    hub.add(new THREE.Mesh(new THREE.CircleGeometry(0.056, 24), mat));
    for (const a of [0, 2.09, 4.19]) {               // three blades, smeared by the spin
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.055).translate(0, 0.0275, 0.001), blade);
      b.rotation.z = a;
      hub.add(b);
    }
    mesh.add(hub);
    outer.userData.props.push(hub);
  }
}
