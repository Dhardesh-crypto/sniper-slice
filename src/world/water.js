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

const RES = 512;                 // the depth map: 512² over the map (about 2 m a texel)
const DEPTH_RANGE = [-2, 10];    // metres of depth the map holds (above the water: −; deeper: clamped)

function depthTexture(level) {
  const n = RES, half = MAP_HALF, data = new Uint8Array(n * n);
  const [lo, hi] = DEPTH_RANGE;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + (i + 0.5) / n * 2 * half, z = -half + (j + 0.5) / n * 2 * half;
    const d = level - heightAt(x, z);
    data[j * n + i] = Math.round(255 * THREE.MathUtils.clamp((d - lo) / (hi - lo), 0, 1));
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// calm: 1 for the open sea, less for a river in a gorge.
export function makeWater(scene, { level, size, calm = 1 }) {
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(3, 0) },
    uCalm: { value: calm },
    uDepth: { value: depthTexture(level) },
    uBox: { value: new THREE.Vector4(-MAP_HALF, -MAP_HALF, 2 * MAP_HALF, level) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, envMapIntensity: 1.1 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = `uniform float uTime, uCalm; uniform vec2 uWind; uniform sampler2D uDepth; uniform vec4 uBox;
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
        vec2 uv = (p - uBox.xy) / uBox.z;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float dep = mix(40.0, texture2D(uDepth, uv).r * ${(DEPTH_RANGE[1] - DEPTH_RANGE[0]).toFixed(1)} + ${DEPTH_RANGE[0].toFixed(1)}, inside);
        vec3 shallow = vec3(0.20, 0.47, 0.43), mid = vec3(0.05, 0.25, 0.29), deep = vec3(0.015, 0.09, 0.14);
        vec3 col = mix(shallow, mid, smoothstep(0.4, 3.5, dep));
        col = mix(col, deep, smoothstep(3.5, 20.0, dep));
        // Surf: bands of foam running in to the shore, broken up; whitecaps on crests in a wind.
        float n = vnoise(p * 0.35 + uTime * 0.05) * 0.6 + vnoise(p * 1.3 - uTime * 0.1) * 0.4;
        float shore = (1.0 - smoothstep(0.0, 1.1 + 0.5 * n, dep));
        float bands = smoothstep(0.35, 0.9, sin(dep * 7.0 + uTime * 1.4 + n * 3.0) * 0.5 + 0.5 + shore * 0.5);
        float crest = smoothstep(0.55, 0.95, h / max(amp, 1e-3) * 0.5 + 0.5) * smoothstep(0.45, 1.0, rough) * smoothstep(0.5, 0.8, n);
        wFoam = clamp(shore * bands + crest * 0.8, 0.0, 1.0) * step(0.0, dep);
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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
  mesh.position.y = level;
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
