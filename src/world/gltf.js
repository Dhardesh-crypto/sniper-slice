// Loading the game's .glb models. They're meshopt-compressed (tools/compress-models.mjs): small
// 8–16 bit normals, UVs and weights, some of them interleaved. Once decoded, every vertex
// attribute is turned back into a plain float32 one, so code that clones, transforms, merges or
// reads a mesh's arrays works on the same data it did before compression.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const KEEP = new Set(['skinIndex']);   // bone numbers: integers in the shader

function plain(a) {
  if (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array) return a;
  const n = a.itemSize, out = new Float32Array(a.count * n);
  const get = [a.getX, a.getY, a.getZ, a.getW];   // (these undo the normalization)
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = get[c].call(a, i);
  return new THREE.BufferAttribute(out, n);
}

function floatAttributes(scene) {
  const done = new Set();
  scene.traverse(o => {
    const g = o.geometry;
    if (!g || done.has(g)) return;
    done.add(g);
    for (const [k, a] of Object.entries(g.attributes)) if (!KEEP.has(k)) g.setAttribute(k, plain(a));
    for (const list of Object.values(g.morphAttributes)) list.forEach((a, i) => { list[i] = plain(a); });
  });
}

let loader;
export async function loadGLB(url) {
  if (!loader) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  floatAttributes(gltf.scene);
  return gltf;
}
