// Natural rock drawn in the shader (after Athenaion's materials/stone.js, MIT, Leon Lin): weathered
// limestone in world space, pale cream to grey with buff stains, a lumpy crust, bedding grooves on
// steep faces, solution pits and angular fracture facets up close, rain streaks down the steep sides,
// black lichen colonies and pale crusts, moss on the tops. Every detail fades out once it is finer than
// a pixel, so a rock reads the same at 300 m through the scope as its average up close.
//   rockMaterial({ tint, moss, lichen, streaks, strata, ochre, scale, bump, variation, darkness })
// (each 0..1 but scale: features' size, 2 = half as big; tint multiplies the colour).
import * as THREE from 'three';
import { proceduralHooks } from './procedural.js';

// (stShade's loops read a uniform that is always 1, so the compiler doesn't unroll them: faster compiles)
const STONE_GLSL = /* glsl */ `
#ifndef ST_STONE_INCLUDED
#define ST_STONE_INCLUDED
// outputs of stShade()
vec3 stAlb; float stRgh; float stHgt; float stAO; vec3 stFN;   // stFN: base normal with the facet tilts (bump on top)
// loop bounds read a uniform (always 1) so the D3D compiler does not unroll them (much faster compiles)
uniform float uStOne;

// band-limited fbm (fades octaves finer than the pixel footprint fp, both in noise units)
float stFbm(vec3 p, int oct, float fp, float gain) {
  float s = 0.0, a = 0.5, n = 0.0, f = 1.0;
  int no = int(float(oct) * uStOne);
  for (int i = 0; i < no; i++) {
    float w = 1.0 - smoothstep(0.18, 0.5, fp * f);
    s += a * w * cgSnoise(p * f);
    n += a;
    f *= 2.07; a *= gain; p += vec3(3.71, 1.37, 5.13);
  }
  return s / n;
}

// 3D cellular: returns (F1, F2, cell hash); fpos = nearest feature point (cell space)
vec3 stCell(vec3 p, out vec3 fpos) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0; fpos = vec3(0.0);
  int L1 = int(uStOne);
  for (int z = -L1; z <= L1; z++) for (int y = -L1; y <= L1; y++) for (int x = -L1; x <= L1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = cgHash33(i + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = cgHash13(i + g); fpos = i + g + o; }
    else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}

// Surface-gradient bump (Mikkelsen): perturb n by a scalar height field h (metres) using screen derivatives.
vec3 stBumpNormal(vec3 p, vec3 n, float h) {
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 g = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - g);
}

// p: world position, n: world normal, seed: per-instance [0,1), cav: crevice 0..1,
// A = (scale, moss, lichen, streaks), B = (strata, wetBelow, bump, dressed), C = (variation, ochre, darkness, -)
void stShade(vec3 p, vec3 n, float seed, float cav, vec4 A, vec4 B, vec4 C) {
  float sc = A.x;
  vec3 q = p * sc;
  stFN = n;
  float fp = max(length(fwidth(p)) * sc, 1e-4);   // pixel footprint in (scaled) metres
  float vert = 1.0 - abs(n.y);
  float upw = clamp(n.y, 0.0, 1.0);
  float dressed = B.w;

  // ---------------- macro colour (coherent over tens of metres)
  float m1 = stFbm(q * 0.043 + seed * 13.1, 3, 0.0, 0.5);
  float m2 = stFbm(q * 0.16 + vec3(11.0, 3.0, 7.0), 3, 0.0, 0.5);
  float m3 = cgSnoise(q * 0.55 + 2.0);
  // weathered limestone: pale grey-cream (r5: lighter and less sandy — refs 3/8/9 foreground blocks are
  // pale grey-white with dark speckle, not beige), grey weathered masses, buff stains
  // (average kept within ~10 % of r4: other modules tuned their tints on it — bastion ×1.45, rapids ×1.35)
  vec3 cream = mix(vec3(0.385, 0.366, 0.326), vec3(0.500, 0.470, 0.405), dressed);
  vec3 grey  = mix(vec3(0.300, 0.298, 0.290), vec3(0.430, 0.420, 0.395), dressed);
  vec3 warm  = vec3(0.420, 0.310, 0.195);
  vec3 c = mix(cream, grey, smoothstep(-0.4, 0.5, m1) * (1.0 - 0.5 * dressed));
  c = mix(c, warm, smoothstep(0.25, 0.75, m2) * C.y * (0.35 + 0.65 * vert));
  // weathered darker grey patches on natural rock
  float m4 = stFbm(q * 0.09 + vec3(31.0, 7.0, 19.0), 3, 0.0, 0.5);
  c = mix(c, vec3(0.170, 0.168, 0.163), smoothstep(0.20, 0.75, m4) * (1.0 - dressed) * 0.55);
  // fresh white fracture faces
  c = mix(c, vec3(0.50, 0.488, 0.458), smoothstep(0.35, 0.7, -m4 + 0.4 * m3) * (1.0 - dressed) * 0.45);
  c *= 1.0 + 0.08 * m3;
  c *= 1.0 + (seed - 0.5) * C.x;
  // r5: micro mottling (salt-and-pepper grain of weathered limestone, 1–8 cm), band-limited
  float motW = 1.0 - smoothstep(0.03, 0.12, fp);
  if (motW > 0.0) {
    float mot = stFbm(q * 7.0 + 3.3, 3, fp * 7.0, 0.65);
    c *= 1.0 + (0.45 * mot) * motW * (1.0 - 0.3 * dressed);
  }

  // ---------------- relief (metres): lumpy weathered surface + bedding grooves + pits
  float amp = mix(0.15, 0.018, dressed) * B.z / sc;
  // (every bump term is band-limited to ≥ ~5 px wavelength: the screen-derivative bump is constant per
  //  2×2 pixel quad, so finer relief turns into blocky "pixel" shading)
  float h = amp * stFbm(q * mix(0.55, 1.6, dressed), 6, fp * mix(0.55, 1.6, dressed) * 2.6, mix(0.64, 0.56, dressed));   // r5: rougher fine octaves (natural rock)
  // r5: weathering crust — ridged micro relief (≈ 11 cm and 4 cm) that gives the refs' crusty, pitted
  // limestone surface at 2–10 m; lighter crust ridges, darker hollows; plus 10–40 cm tonal patches
  float crW = (1.0 - 0.35 * dressed) * (1.0 - smoothstep(0.008, 0.025, fp));
  if (crW > 0.0) {
    // billowed (rounded lumps with creases; ridged noise read as worms / hammered metal)
    float r1 = abs(cgSnoise(q * 7.0 + 1.1) + 0.5 * cgSnoise(q * 13.0 + 7.3));
    float r2 = abs(cgSnoise(q * 23.0 + 4.4));
    h += (0.009 * r1 + 0.0035 * r2 * (1.0 - smoothstep(0.003, 0.009, fp))) * crW / sc;
    c *= 1.0 + 0.22 * (smoothstep(0.0, 0.5, r1) - 0.6) * crW;
  }
  // 10–40 cm tonal patches: pale crust ↔ grey weathered (ref 3/8 foreground blocks are strongly blotched)
  float ptc = cgSnoise(q * 1.25 + 8.8) + 0.45 * cgSnoise(q * 3.1 + 2.2) + 0.2 * cgSnoise(q * 7.7 + 5.5);
  float ptW = (1.0 - smoothstep(0.04, 0.16, fp)) * (1.0 - 0.35 * dressed);   // (weathered ruin blocks are blotched too)
  c = mix(c, c * vec3(1.30, 1.28, 1.24), smoothstep(0.0, 0.35, ptc) * 0.85 * ptW);
  c = mix(c, c * vec3(0.70, 0.71, 0.73), smoothstep(-0.2, -0.6, ptc) * 0.85 * ptW * (1.0 - 0.6 * dressed));
  // bedding planes (natural rock, steep faces): thin horizontal grooves, warped
  float yb = q.y * 0.9 + 1.6 * cgSnoise(vec3(q.xz * 0.05, 3.3)) + 0.4 * cgSnoise(q * 0.3);
  float bedLine = abs(fract(yb * 0.5) - 0.5) * 2.0;           // 0 at the groove
  float bedW = 1.0 - smoothstep(0.0, 0.5, fp * 0.5);
  float groove = (1.0 - smoothstep(0.0, 0.10, bedLine)) * B.x * vert * bedW;
  h -= groove * 0.05 / sc * (1.0 - smoothstep(0.015, 0.05, fp));
  // banding colour along the strata
  float bandN = cgSnoise(vec3(q.x * 0.015, yb * 0.35, q.z * 0.015));
  c *= mix(1.0, 0.88 + 0.22 * smoothstep(-0.6, 0.6, bandN), B.x * vert);
  // pits / porosity (only resolved up close)
  // solution pits / honeycomb weathering (karst): warped cells at two scales, only where resolved
  float pitW = 1.0 - smoothstep(0.02, 0.07, fp);
  float pit = 0.0;
  if (pitW > 0.0) {
    vec3 wq = q + 0.18 * vec3(cgSnoise(q * 3.1), cgSnoise(q * 3.1 + 7.7), cgSnoise(q * 3.1 + 3.3));
    vec3 pfp; vec3 vr = stCell(wq * 3.2, pfp);
    float pz = smoothstep(-0.45, 0.35, cgSnoise(q * 0.7 + 5.0)) * (1.0 - dressed * 0.6);  // pitted zones (r5: more of them)
    float p1 = (1.0 - smoothstep(0.08, 0.30 + 0.12 * vr.z, vr.x)) * step(0.30, vr.z) * pz;
    vec3 vr2 = stCell(wq * 9.0 + 2.0, pfp);
    float p2 = (1.0 - smoothstep(0.05, 0.24, vr2.x)) * step(0.40, vr2.z) * (0.5 + 0.5 * pz);
    pit = clamp(p1 + 0.7 * p2, 0.0, 1.0) * pitW;
    h -= (p1 * 0.035 * (1.0 - smoothstep(0.008, 0.025, fp)) + p2 * 0.012 * (1.0 - smoothstep(0.003, 0.009, fp))) * pitW / sc;
  }

  // fracture facets (1–3 m angular planes with a crack network) — natural rock only, near/mid range
  float facW = (1.0 - dressed) * (1.0 - smoothstep(0.12, 0.45, fp * 0.55));
  if (facW > 0.0) {
    vec3 fq = q * vec3(0.55, 0.30, 0.55);
    vec3 fpos; vec3 cc = stCell(fq, fpos);
    // r5: facets tilt the shading NORMAL per cell (crisp planar faces with sharp edges). As a height term the
    // facet either jumped at the cell borders (dotted bright lines with the screen-derivative bump) or,
    // faded to 0 there, drew a V-groove along every border (a "dried mud" network).
    vec3 tilt = (cgHash33(fpos * 7.13 + 1.7) - 0.5) * vec3(1.0, 0.5, 1.0);
    stFN = normalize(stFN + (tilt - stFN * dot(tilt, stFN)) * 0.42 * facW);
    // a few crisp open joints along some cell borders, in fractured zones only (sparse: a full network reads
    // as crackle glaze); colour + crevice only (a bump on a 1–3 px line aliases into jagged strokes)
    float cw = 0.03 + fp * 0.55 * 1.6;
    float crkZ = smoothstep(-0.1, 0.4, cgSnoise(q * 0.21 + 6.6));
    float crk = (1.0 - smoothstep(0.0, cw, cc.y - cc.x)) * step(0.55, cgHash13(fpos * 3.1 + 0.7)) * crkZ;
    c *= 1.0 - 0.55 * crk * facW;
    c *= 1.0 + (cc.z - 0.5) * 0.22 * facW;
    cav = max(cav, crk * 0.6 * facW);
    // small chips (10–30 cm angular facets) where resolved: normal only, no lines
    float chW = facW * (1.0 - smoothstep(0.02, 0.06, fp));
    if (chW > 0.0) {
      vec3 fpos2; vec3 cc2 = stCell(q * vec3(4.0, 3.0, 4.0) + 9.0, fpos2);
      vec3 t2 = (cgHash33(fpos2 * 5.31 + 0.3) - 0.5);
      stFN = normalize(stFN + (t2 - stFN * dot(t2, stFN)) * 0.22 * chW);
      c *= 1.0 + (cc2.z - 0.5) * 0.12 * chW;
    }
  }

  // ---------------- colour weathering layers
  // vertical water / rain streaks on steep faces (dark grey-brown)
  float sk = cgSnoise(vec3(q.x * 0.55, q.y * 0.022, q.z * 0.55)) * 0.6 + cgSnoise(vec3(q.x * 1.7, q.y * 0.06, q.z * 1.7)) * 0.4;
  float streak = smoothstep(0.15, 0.65, sk) * A.w * smoothstep(0.25, 0.8, vert);
  c = mix(c, c * vec3(0.52, 0.52, 0.50), streak * 0.85);
  // crevices: darker, slightly green-brown
  float cv = clamp(cav, 0.0, 1.0);
  c *= 1.0 - 0.55 * cv * cv - 0.15 * cv;
  c = mix(c, vec3(0.085, 0.072, 0.050), cv * cv * 0.35);
  // pits: dark brown-grey interiors
  c = mix(c, c * vec3(0.38, 0.35, 0.31), pit);
  // lichen: dark grey-black speckle clusters (very characteristic of the references) + yellow-grey crusts
  float lichMask = smoothstep(0.05, 0.6, stFbm(q * 0.35 + 4.0, 3, 0.0, 0.5) + 0.3 * upw);
  float spk = cgSnoise(q * 9.0);
  float spkW = 1.0 - smoothstep(0.03, 0.10, fp);
  float lichDark = smoothstep(0.35, 0.75, spk) * lichMask * A.z * spkW;
  // r5: black lichen colonies (ref 8/9: clusters of dense dark dots, 10–60 cm) + pale grey crusts between
  float colony = smoothstep(0.15, 0.55, cgSnoise(q * 1.15 + 7.0) + 0.5 * cgSnoise(q * 3.1 + 1.0) * spkW) * lichMask;
  float dotW = 1.0 - smoothstep(0.012, 0.04, fp);
  float dots = smoothstep(0.15, 0.5, cgSnoise(q * 17.0 + 3.0)) * dotW;
  lichDark = max(lichDark, colony * mix(0.55, dots, dotW) * A.z * (1.0 - 0.55 * dressed));
  c = mix(c, vec3(0.075, 0.075, 0.072), clamp(lichDark, 0.0, 1.0) * 0.8);
  float crust = smoothstep(0.25, 0.65, stFbm(q * 0.75 + 14.0, 3, fp * 0.75, 0.55)) * (1.0 - colony) * A.z;
  c = mix(c, vec3(0.60, 0.595, 0.565), crust * 0.4 * (1.0 - dressed));
  // where too far to resolve speckles, average them in as a slight darkening
  c *= 1.0 - 0.18 * lichMask * A.z * (1.0 - spkW);
  float lichY = smoothstep(0.55, 0.8, cgSnoise(q * 2.3 + 9.0)) * lichMask * A.z;
  c = mix(c, vec3(0.52, 0.47, 0.30), lichY * 0.35);
  // moss on up-facing surfaces and in crevices
  float mossN = stFbm(q * 0.4 + 21.0, 3, 0.0, 0.5);
  float moss = smoothstep(0.25, 0.75, upw * 0.9 + cv * 0.6 + 0.45 * mossN) * A.y;
  vec3 mossC = mix(vec3(0.075, 0.095, 0.030), vec3(0.16, 0.16, 0.06), smoothstep(-0.3, 0.6, mossN));
  c = mix(c, mossC, moss * 0.85);
  h += moss * 0.01 / sc;

  // ---------------- wetness near water
  float wet = 1.0 - smoothstep(B.y - 0.05, B.y + 0.35, p.y + 0.12 * cgSnoise(q * 1.5));
  c = mix(c, c * vec3(0.42, 0.44, 0.42), wet);
  c = mix(c, vec3(0.06, 0.08, 0.04), wet * smoothstep(B.y - 0.3, B.y + 0.1, p.y) * 0.4); // algae band

  c *= 1.0 - C.z;
  stAlb = max(c, vec3(0.0));
  stRgh = mix(0.86 + 0.08 * m3, 0.30, wet) - 0.08 * dressed;
  stHgt = h;
  stAO = 1.0 - 0.75 * cv - 0.25 * moss * upw;
}
#endif
`;

const HEAD = /* glsl */ `
uniform vec3 uStTint;
uniform vec4 uStA;
uniform vec4 uStB;
uniform vec4 uStC;
${STONE_GLSL}
`;

const ROCK = { tint: 0xffffff, scale: 1, moss: 0.35, lichen: 0.7, streaks: 0.5, strata: 0.5, ochre: 0.5, bump: 1, variation: 0.18, darkness: 0, roughness: 0.95 };
const ONE = { value: 1 };
// The game's stones (ground.js's, the rock prop): weathered limestone, mossy tops, lichen.
export const ROCK_LOOK = { tint: 0xc4b8a6, darkness: 0.06, moss: 0.5, lichen: 0.6, streaks: 0.4, strata: 0.3, ochre: 0.4 };   // (warmer and darker than Athenaion's sunlit marble country)
let made = 0;

export function rockMaterial(opts = {}) {
  const o = { ...ROCK, ...opts };
  // (matte, little sky in it: like the other ground detail, props.js's modelParts)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.roughness, metalness: 0, envMapIntensity: 0.2 });
  return proceduralHooks(mat, {
    key: `rock${made++}`,
    uniforms: mat.userData.uniforms = {
      uStTint: { value: new THREE.Color(o.tint) },
      uStA: { value: new THREE.Vector4(o.scale, o.moss, o.lichen, o.streaks) },
      uStB: { value: new THREE.Vector4(o.strata, -1e4, o.bump, 0) },          // (never wet; natural, not dressed)
      uStC: { value: new THREE.Vector4(o.variation, o.ochre, o.darkness, 0) },
      uStOne: ONE,
    },
    head: HEAD,
    color: 'stShade(cgP, cgN, cgSeed, 0.0, uStA, uStB, uStC); diffuseColor.rgb = stAlb * uStTint * diffuseColor.rgb; cgAO = stAO;',
    roughness: 'roughnessFactor = clamp(stRgh * roughnessFactor / 0.88, 0.05, 1.0);',
    normal: 'cgBump = stBumpNormal(cgP, stFN, stHgt) - cgN;',
    ao: '/* (cgAO set with the colour) */',
  });
}
