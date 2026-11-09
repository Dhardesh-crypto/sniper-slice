// Trees that move in the wind: the same wind that pushes your bullets (world.updateWind, its gusts
// and its slow turning), so a crown leaning and tossing tells you the wind before a long shot.
// After the Bodhi tree in the Sambodhaya project: done in the vertex shader, so it costs no draw
// calls and no work on the CPU.
//   sway     the whole tree bends away from the wind, more with height (the square of it: the trunk
//            hardly moves at the foot, the crown most), leaning with the wind's strength and rocking
//            on top of that, each tree on its own rhythm (from where it stands) and with the gusts
//   flutter  the leaves (crown and far cards only) shimmer and toss: a quick motion at a low spatial
//            frequency, so each card moves nearly as one piece
// The shadows move with them: each tree mesh gets a depth material with the same motion, or the
// crown would sway over a shadow standing still.
// Patched once per material (the instanced meshes of every chunk share them), chained after the
// material's own patches (crown shading, winter's snow, the fog) with its own program cache key.
import * as THREE from 'three';
import { windUniforms } from './vegetation.js';

// (an 11 m cypress in the game's usual 3 m/s: about 0.3 m at the top, rocking; the leaves a few cm)
const SWAY = 0.009;     // share of the tree's height it leans at the top, per m/s of wind
const FLUTTER = 0.03;   // m the leaves toss per m/s of wind

// The motion, in the space after the instance's own transform (metres, the world's axes).
const MOTION = (leaves) => /* glsl */`
  {
    vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float scale = length(instanceMatrix[1].xyz);
    float k = clamp((mvPosition.y - root.y) / (uTreeH * scale), 0.0, 1.4);
    k *= k;
    float ws = length(uWind);
    vec2 dir = ws > 0.01 ? uWind / ws : vec2(1.0, 0.0);
    float ph = uTime * 0.9 + root.x * 0.071 + root.z * 0.053;
    float gust = 0.65 + 0.35 * sin(uTime * 0.37 + root.x * 0.011 + root.z * 0.013);
    float rock = 0.55 + 0.3 * sin(ph) + 0.15 * sin(ph * 2.3 + 1.7);
    vec2 off = dir * ws * ${SWAY.toFixed(4)} * uTreeH * scale * k * rock * gust;
    ${leaves ? `
    vec3 wp = mvPosition.xyz;
    float f = sin(uTime * 4.7 + wp.x * 0.61 + wp.z * 0.47 + wp.y * 0.39) + 0.5 * sin(uTime * 7.3 + wp.y * 0.83 + wp.x * 0.29);
    float lk = clamp(k * 3.0, 0.0, 1.0) * ws * ${FLUTTER.toFixed(4)} * (0.6 + 0.6 * gust);
    off += dir * f * lk;
    mvPosition.y += 0.5 * f * lk;` : ''}
    mvPosition.xz += off;
  }`;

function patchShader(sh, height, leaves) {
  sh.uniforms.uTime = windUniforms.uTime;
  sh.uniforms.uWind = windUniforms.uWind;
  sh.uniforms.uTreeH = { value: height };
  sh.vertexShader = 'uniform float uTime;\nuniform vec2 uWind;\nuniform float uTreeH;\n' + sh.vertexShader.replace(
    '#include <project_vertex>',
    /* glsl */`vec4 mvPosition = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
    #endif
    ${MOTION(leaves)}
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;`);
}

// ?nowind in the address: trees stand still (to compare the frame time, tools/bench.js).
const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nowind');
const patched = new WeakMap();   // material → its depth material (patched once)

function windMaterial(mat, height, leaves) {
  if (patched.has(mat)) return patched.get(mat);
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); patchShader(sh, height, leaves); };
  mat.customProgramCacheKey = () => `${prevKey?.() ?? ''}|treewind${leaves ? 'L' : ''}${height.toFixed(2)}`;
  mat.needsUpdate = true;
  // The shadow's material: the same motion, and the cards cut out by their alpha as the crown is.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map ?? null, alphaTest: mat.alphaTest || 0, side: mat.side });
  depth.onBeforeCompile = (sh) => patchShader(sh, height, leaves);
  depth.customProgramCacheKey = () => `treewind-depth${leaves ? 'L' : ''}${height.toFixed(2)}`;
  patched.set(mat, depth);
  return depth;
}

// One tree mesh (instanced, one per chunk): `height` is the tree's own height in its model's units
// (the top of its crown); `leaves`: flutter too.
export function addTreeWind(mesh, height, leaves) {
  if (!mesh?.material || !(height > 0) || OFF) return;
  mesh.customDepthMaterial = windMaterial(mesh.material, height, leaves);
}

// A tree type's height, from its parts' geometry (the highest point of any of them).
export function treeHeight(...geos) {
  let h = 0;
  for (const g of geos) { if (!g) continue; g.computeBoundingBox?.(); h = Math.max(h, g.boundingBox?.max.y ?? 0); }
  return h;
}
