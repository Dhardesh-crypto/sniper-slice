// Winter (conditions.js: map.winter). Snow lies on whatever faces the sky: roofs, the tops of walls
// and sandbags, vehicles, rocks, the trees' crowns; done in the shaders, by how much each surface
// faces up, so it needs no models of its own. The far country goes pale under its snow, the ground
// is painted white where it's level (terrain.js), the grass is dead straw (vegetation.js), snow
// falls and breath clouds (weather.js).
import * as THREE from 'three';

const SNOW = 'vec3(0.9, 0.92, 0.96)';

// Snow on the up-facing side of a lit material (Standard, Physical, Lambert, Phong).
function snowOn(mat, amount, from = 0.35) {
  if (mat.userData.snowed) return;
  mat.userData.snowed = true;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { float upness = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
        diffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW}, smoothstep(${from.toFixed(2)}, ${(from + 0.5).toFixed(2)}, upness) * ${amount.toFixed(2)}); }`);
  };
  mat.customProgramCacheKey = () => (prevKey?.() ?? '') + '|snow';
  mat.needsUpdate = true;
}

// The far country (an unlit picture of summer hills): drained of colour and lifted, as if snowed on.
function paleOn(mat) {
  if (mat.userData.snowed) return;
  mat.userData.snowed = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l) * 1.3 + 0.1, 0.88); }`);
  };
  mat.customProgramCacheKey = () => '|pale';
  mat.needsUpdate = true;
}

// Everything in the scene once it's built (and whatever comes later: call again, it skips what's done).
export function applyWinter(scene) {
  scene.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || o.name === 'terrain' || o.userData.noSnow) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!mat || mat.visible === false) continue;
      if (o.renderOrder === -5 && mat.isMeshBasicMaterial && mat.map) { paleOn(mat); continue; }   // (the horizon)
      if (mat.transparent && !mat.alphaTest) continue;                // (glows, smoke, decals, glass)
      if (mat.vertexColors && mat.isMeshLambertMaterial) continue;    // (the grass: its own colours)
      if (mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial) snowOn(mat, mat.alphaTest ? 0.6 : 0.8, mat.alphaTest ? 0.0 : 0.35);   // (leaf cards: snow lies on more of a crown than its tops)
    }
  });
}

// The ground's detail texture in winter: snow, faintly mottled, a little blue in its hollows.
export function snowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#eef1f5'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? `rgba(200,210,226,${0.08 + Math.random() * 0.12})` : `rgba(255,255,255,${0.1 + Math.random() * 0.2})`;
    const r = 2 + Math.random() * 10;
    g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
