// The sea (and the river in the gorge). One flat sheet, which is what bullets splash into and the
// player wades against; everything that makes it look like water happens in its shader:
//   waves: ten wave trains running before the run's wind, long swells down to short chop (the
//     short ones fade out with distance, so far water doesn't shimmer), bending the surface
//     normal: the sky and the sun reflect off them through the ordinary PBR lighting;
//   depth: a map of how deep the water is over the land (baked once from the terrain) tints it
//     turquoise over sand in the shallows, green-blue further out, dark blue in deep water, and
//     lets you see the bottom near the shore;
//   foam: lines of surf running in onto every beach and round rocks, and whitecaps on the crests
//     when the wind is up.
import * as THREE from 'three';
import { heightAt, MAP_HALF } from './terrain.js';
import { pointAt } from './landforms.js';

const RES = 512;                 // the depth map: 512² over the map (about 2 m a texel)
const DEPTH_RANGE = [-2, 10];    // metres of depth the map holds (above the water: −; deeper: clamped)

// box: the ground the picture covers ({ x0, z0, w, d }; the whole map for the sea); levelAt(x, z):
// the surface there (one height for the sea or a pond, falling along a river).
function depthTexture(levelAt, box, n = RES) {
  const data = new Uint8Array(n * n);
  const [lo, hi] = DEPTH_RANGE;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = box.x0 + (i + 0.5) / n * box.w, z = box.z0 + (j + 0.5) / n * box.d;
    const d = levelAt(x, z) - heightAt(x, z);
    data[j * n + i] = Math.round(255 * THREE.MathUtils.clamp((d - lo) / (hi - lo), 0, 1));
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// calm: 1 for the open sea, less for a river in a gorge. The rest is for water that isn't the one
// sheet (makeWaterBody, below): its own mesh (geometry, already in place), the ground its depth
// picture covers (box) and its surface there (levelAt), how fine that picture is (res), how much
// surf it has (foam: 1 the sea's; a pond has none to speak of), and how deep it counts beyond the
// picture's edge (open: the sea goes on; a pond doesn't).
export function makeWater(scene, { level, size, calm = 1, geometry = null, box = null, levelAt = null, res = RES, foam = 1, open = 40 }) {
  box ??= { x0: -MAP_HALF, z0: -MAP_HALF, w: 2 * MAP_HALF, d: 2 * MAP_HALF };
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(3, 0) },
    uCalm: { value: calm },
    uDepth: { value: depthTexture(levelAt ?? (() => level), box, res) },
    uBox: { value: new THREE.Vector4(box.x0, box.z0, box.w, box.d) },
    uFoam: { value: new THREE.Vector2(foam, open) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, envMapIntensity: 1.1 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = `uniform float uTime, uCalm; uniform vec2 uWind, uFoam; uniform sampler2D uDepth; uniform vec4 uBox;
      varying vec3 vWPos;
      vec3 wN; float wFoam;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      ` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 p = vWPos.xz;
        float dist = length(cameraPosition - vWPos);
        float wl = length(uWind);
        vec2 wd = wl > 0.05 ? uWind / wl : vec2(1.0, 0.0);
        float rough = clamp(wl / 7.0, 0.18, 1.0) * uCalm;
        vec2 grad = vec2(0.0); float h = 0.0, amp = 0.0;
        for (int i = 0; i < 10; i++) {
          float fi = float(i);
          float ang = (fract(fi * 0.618034) - 0.5) * 1.9;               // (spread unevenly about the wind: no lattice)
          vec2 d = vec2(cos(ang) * wd.x - sin(ang) * wd.y, sin(ang) * wd.x + cos(ang) * wd.y);
          float L = 22.0 * pow(0.68, fi) * (0.8 + 0.4 * fract(fi * 0.4142));
          float k = 6.2831853 / L, c = sqrt(9.8 / k);
          float A = L * 0.010 * rough * (1.0 - smoothstep(L * 30.0, L * 110.0, dist))   // (short waves fade out far off)
                  * (0.45 + 1.1 * vnoise(p / (L * 6.0) + fi * 3.1 + uTime * 0.02));        // (and come in sets, stronger here than there)
          float ph = k * dot(d, p) - c * k * uTime + fi * 1.7;
          h += A * sin(ph); amp += A;
          grad += A * k * cos(ph) * d;
        }
        // Fine ripples close to: noise that drifts with the wind.
        float near = 1.0 - smoothstep(15.0, 60.0, dist);
        vec2 q = p * 1.7 - wd * uTime * 0.9;
        grad += near * 0.06 * rough * vec2(vnoise(q + vec2(0.3, 0.0)) - vnoise(q - vec2(0.3, 0.0)), vnoise(q + vec2(0.0, 0.3)) - vnoise(q - vec2(0.0, 0.3))) / 0.6;
        wN = normalize(vec3(-grad.x, 1.0, -grad.y));
        // How deep it is here (the baked map; beyond the map's edge, open sea).
        vec2 uv = (p - uBox.xy) / uBox.zw;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float dep = mix(uFoam.y, texture2D(uDepth, uv).r * ${(DEPTH_RANGE[1] - DEPTH_RANGE[0]).toFixed(1)} + ${DEPTH_RANGE[0].toFixed(1)}, inside);
        vec3 shallow = vec3(0.20, 0.47, 0.43), mid = vec3(0.05, 0.25, 0.29), deep = vec3(0.015, 0.09, 0.14);
        vec3 col = mix(shallow, mid, smoothstep(0.4, 3.5, dep));
        col = mix(col, deep, smoothstep(3.5, 20.0, dep));
        // Surf: bands of foam running in to the shore, broken up; whitecaps on crests in a wind.
        float n = vnoise(p * 0.35 + uTime * 0.05) * 0.6 + vnoise(p * 1.3 - uTime * 0.1) * 0.4;
        float shore = (1.0 - smoothstep(0.0, 1.1 + 0.5 * n, dep));
        float bands = smoothstep(0.35, 0.9, sin(dep * 7.0 + uTime * 1.4 + n * 3.0) * 0.5 + 0.5 + shore * 0.5);
        float crest = smoothstep(0.55, 0.95, h / max(amp, 1e-3) * 0.5 + 0.5) * smoothstep(0.45, 1.0, rough) * smoothstep(0.5, 0.8, n);
        wFoam = clamp(shore * bands + crest * 0.8, 0.0, 1.0) * step(0.0, dep) * uFoam.x;
        diffuseColor.rgb = mix(col, vec3(0.93, 0.95, 0.95), wFoam);
        // See-through over the sand near the shore, opaque further out.
        diffuseColor.a = max(mix(0.3, 0.94, smoothstep(0.0, 2.6, dep)), wFoam);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.8, wFoam);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'sea-water';
  const mesh = new THREE.Mesh(geometry ?? new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
  if (!geometry) mesh.position.y = level;
  else mat.side = THREE.DoubleSide;      // (an outline or a ribbon may be wound either way; its normal comes from the waves)
  mesh.receiveShadow = true;
  mesh.userData.noAO = true;
  mesh.userData.water = true;
  mesh.userData.noSnow = true;
  scene.add(mesh);
  return {
    mesh,
    tick(dt, wind) {
      uniforms.uTime.value += dt;
      if (wind) uniforms.uWind.value.set(wind.x, wind.z);
    },
  };
}

// One body of a map's `waters` (waters.js): a pond or a marsh as a flat sheet cut to its outline, a
// river as a ribbon along its line whose surface falls with it. The same water as the sea's, calmer
// (a pond's ripples, a stream's run) and without surf. Returns { mesh, tick } like makeWater.
const RIVER_STEP = 4;      // m between the ribbon's cross-sections
const OVER = 1.5;          // m the ribbon reaches past the river's width (under the banks, so no gap shows)
export function makeWaterBody(scene, body) {
  const b = body.box ?? { x0: -MAP_HALF, x1: MAP_HALF, z0: -MAP_HALF, z1: MAP_HALF };
  const box = { x0: b.x0, z0: b.z0, w: b.x1 - b.x0, d: b.z1 - b.z0 };
  let geometry;
  if (body.kind === 'river') {
    const P = body.path, n = Math.max(2, Math.ceil(P.length / RIVER_STEP)), w = body.width / 2 + OVER;
    const pos = new Float32Array((n + 1) * 6), idx = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n * P.length, q = pointAt(P, t), y = body.levelAt(t);
      pos.set([q.x + q.dz * w, y, q.z - q.dx * w, q.x - q.dz * w, y, q.z + q.dx * w], i * 6);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((n + 1) * 4), 2));
  } else {
    // Its outline (a circle, a polygon, or its box), flat at its level. The land round a lake
    // stands above the water (landforms.js lakeBasin), so the sheet's own edge is under ground.
    const spec = body.area?.spec ?? {};
    const shape = spec.poly ? new THREE.ShapeGeometry(new THREE.Shape(spec.poly.map(([x, z]) => new THREE.Vector2(x, -z))))
      : spec.r != null ? new THREE.CircleGeometry(spec.r, 64).translate(spec.x, -spec.z, 0)
        : new THREE.PlaneGeometry(box.w, box.d).translate(box.x0 + box.w / 2, -(box.z0 + box.d / 2), 0);
    geometry = shape.rotateX(-Math.PI / 2).translate(0, body.level, 0);
  }
  const river = body.kind === 'river';
  return makeWater(scene, { level: body.level, geometry, box, levelAt: body.surfaceNear, res: river ? 512 : 256,
    calm: body.calm ?? (river ? 0.3 : body.kind === 'marsh' ? 0.08 : 0.2), foam: body.foam ?? (river ? 0.25 : 0), open: 0.3 });
}
