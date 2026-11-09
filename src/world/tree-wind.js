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

// An 11 m cypress in the game's usual 3 m/s: leaning about 0.2 m downwind at the top and swinging
// about 0.2 m either side of that, back and forth with the wind every 3 s or so, a little across
// it too; the leaves rustle a couple of centimetres, sideways only. (A first version bobbed the
// leaves up and down at about 1 Hz and that was most of what you saw: the trees "vibrated".)
const LEAN = 0.006;     // share of the tree's height it leans downwind at the top, per m/s of wind
const SWING = 0.006;    // share of its height it swings to and fro along the wind, per m/s
const CROSS = 0.0025;   // and across the wind
const RUSTLE = 0.008;   // m the leaves move sideways per m/s of wind

// The motion, in the space after the instance's own transform (metres, the world's axes).
const MOTION = (leaves) => /* glsl */`
  {
    vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float scale = length(instanceMatrix[1].xyz);
    float k = clamp((mvPosition.y - root.y) / (uTreeH * scale), 0.0, 1.4);
    k *= k;
    float ws = length(uWind);
    vec2 dir = ws > 0.01 ? uWind / ws : vec2(1.0, 0.0);
    vec2 across = vec2(-dir.y, dir.x);
    // Each tree on its own rhythm (from where it stands; a bigger tree a little slower), every
    // tree on the same gusts as they pass over the map.
    float slow = 1.0 / sqrt(max(0.5, uTreeH * scale / 8.0));
    float ph = uTime * 2.0 * slow + root.x * 0.071 + root.z * 0.053;
    float gust = 0.6 + 0.4 * sin(uTime * 0.31 - root.x * 0.012 - root.z * 0.009);
    float h = uTreeH * scale * k * ws;
    vec2 off = dir * h * (${LEAN.toFixed(4)} * gust + ${SWING.toFixed(4)} * gust * sin(ph))
             + across * h * ${CROSS.toFixed(4)} * sin(ph * 0.73 + 1.3);
    ${leaves ? `
    // The leaves: a small sideways rustle, slower than before, its timing varying gently across
    // the crown (a third of a turn per metre: a card moves nearly as one piece, with no seams
    // where a grid would tear it). No up and down.
    vec3 wp = mvPosition.xyz;
    float r = sin(uTime * 2.6 + wp.x * 0.35 + wp.y * 0.27 + wp.z * 0.31);
    off += (dir * 0.6 + across) * r * clamp(k * 3.0, 0.0, 1.0) * ws * ${RUSTLE.toFixed(4)} * gust;` : ''}
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
