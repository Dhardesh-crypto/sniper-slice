// Materials drawn in their shaders, in world space, with no textures (after Athenaion's
// core/materials.js and core/glsl.js, MIT, Leon Lin). proceduralHooks() takes an ordinary
// MeshStandardMaterial and adds GLSL hooks to it; the hooks see:
//   vec3 cgP: world position   vec3 cgN: world normal   vec3 cgV: toward the camera
//   float cgSeed: per instance (InstancedMesh) or per object [0,1)
// and may set diffuseColor (color), roughnessFactor (roughness), vec3 cgBump (normal: a world-space
// change to the normal) and float cgAO (ao: multiplies the indirect light).
// Other patches (winter.js's snow) chain after these, so they still work.
import * as THREE from 'three';

export const NOISE_GLSL = /* glsl */ `
#ifndef CG_NOISE_INCLUDED
#define CG_NOISE_INCLUDED
float cgHash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cgHash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 cgHash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float cgVnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cgHash12(i), cgHash12(i + vec2(1,0)), u.x), mix(cgHash12(i + vec2(0,1)), cgHash12(i + vec2(1,1)), u.x), u.y);
}
float cgVfbm2(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * cgVnoise2(p); n += a; p = p * 2.02 + vec2(5.3, 1.7); a *= 0.5; }
  return s / n;
}
// simplex 3D (Ashima / stegu, MIT) → [-1, 1]
vec3 cgMod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 cgMod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 cgPermute(vec4 x){ return cgMod289(((x * 34.0) + 10.0) * x); }
vec4 cgTaylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float cgSnoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = cgMod289(i);
  vec4 p = cgPermute(cgPermute(cgPermute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = cgTaylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
#endif
`;

const VERT_HEAD = /* glsl */ `
varying vec3 vCgWorldPos;
varying vec3 vCgWorldNormal;
varying float vCgSeed;
`;
const VERT_WORLD = /* glsl */ `
{
  vec4 cgWP = vec4( transformed, 1.0 );
  vec3 cgWN = objectNormal;
  // per instance, else per object: from where it stands
  vec3 cgAt = modelMatrix[ 3 ].xyz;
  #ifdef USE_INSTANCING
    cgWP = instanceMatrix * cgWP; cgWN = mat3( instanceMatrix ) * cgWN;
    cgAt += instanceMatrix[ 3 ].xyz;
  #endif
  vCgWorldPos = ( modelMatrix * cgWP ).xyz;
  vCgWorldNormal = normalize( mat3( modelMatrix ) * cgWN );
  vCgSeed = fract( sin( dot( cgAt, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
}
`;
const FRAG_HEAD = /* glsl */ `
varying vec3 vCgWorldPos;
varying vec3 vCgWorldNormal;
varying float vCgSeed;
${NOISE_GLSL}
`;

let n = 0;
// Hooks on a lit (Standard) material. `key` names the variant for three's program cache.
export function proceduralHooks(mat, o) {
  const key = `proc:${o.key ?? ++n}`;
  const uniforms = o.uniforms ?? {};
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>\n${VERT_HEAD}\n${o.vertexHead ?? ''}`);
    if (o.vertexPre) vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n{\n${o.vertexPre}\n}`);
    vs = vs.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_WORLD}`);
    fs = fs.replace('#include <common>', `#include <common>\n${FRAG_HEAD}\n${o.head ?? ''}`);
    fs = fs.replace('void main() {', `void main() {
      vec3 cgP = vCgWorldPos; vec3 cgN = normalize(vCgWorldNormal); float cgSeed = vCgSeed;
      vec3 cgV = normalize(cameraPosition - vCgWorldPos); vec3 cgBump = vec3(0.0); float cgAO = 1.0;`);
    if (o.color) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n{\n${o.color}\n}`);
    if (o.roughness) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n{\n${o.roughness}\n}`);
    if (o.normal) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n{\n${o.normal}\n}\nnormal = normalize( normal + ( viewMatrix * vec4( cgBump, 0.0 ) ).xyz );`);
    if (o.ao) fs = fs.replace('#include <aomap_fragment>', `#include <aomap_fragment>\n{\n${o.ao}\n}\nreflectedLight.indirectDiffuse *= cgAO; reflectedLight.indirectSpecular *= mix(1.0, cgAO, 0.7);`);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}
