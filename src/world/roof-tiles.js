// Coppi roofs drawn in the shader (after Athenaion's materials/terracotta.js, MIT, Leon Lin): barrel
// tiles in cover and channel rows down the slope, each course a little proud of the one above it,
// tiles of mixed age and colour, lichen, moss in the channels, patchy weathering, and sun-bleached
// slopes. When a tile is smaller than a few pixels it all fades to the roof's average colour, so a
// far roof doesn't shimmer through the scope.
// No attributes needed: the rows follow the slope (u along the eave, v up the slope, from the world
// position and the normal), and the face says what it is: a slope is tiled, the underside is the
// rafters, a level top is a lime screed, a vertical edge is the tiles' ends.
import { proceduralHooks } from './procedural.js';

const HEAD = /* glsl */ `
uniform float uRoofBright;
vec3 roofTileBase(float s){
  float k = fract(s * 5.31);
  vec3 c;
  if (k < 0.26) c = vec3(0.40, 0.145, 0.07);       // red terracotta
  else if (k < 0.48) c = vec3(0.34, 0.13, 0.068);  // deep red-brown
  else if (k < 0.64) c = vec3(0.30, 0.145, 0.085); // brown
  else if (k < 0.78) c = vec3(0.44, 0.20, 0.10);   // orange, newer
  else if (k < 0.90) c = vec3(0.34, 0.20, 0.13);   // weathered, greyed brown
  else c = vec3(0.23, 0.115, 0.075);               // dark aged
  return c * (0.74 + 0.3 * fract(s * 17.3));
}
// barrel tile profile across u: covers (convex) every P, channels (concave) between; height and d/du
vec2 roofProfile(float u, float P){
  float x = fract(u / P) - 0.5, xm = x * P, cw = P * 0.24, h, dh;
  if (abs(xm) < cw) { float t = xm / cw; float s = sqrt(max(1.0 - t * t, 0.0)); h = 0.06 * s; dh = -0.06 * t / (cw * max(s, 0.15)); }
  else { float y = (abs(xm) - cw) / (P * 0.5 - cw); h = -0.028 * sin(y * 3.14159); dh = -0.028 * 3.14159 * cos(y * 3.14159) / (P * 0.5 - cw) * sign(xm); }
  return vec2(h, dh);
}
// the face's kind (0 slope, 2 edge, 3 underside, 4 level top) and its frame: T along the eave, B up the slope
int roofKind(vec3 n){ return n.y < -0.3 ? 3 : n.y > 0.97 ? 4 : n.y > 0.25 ? 0 : 2; }
void roofFrame(vec3 n, out vec3 T, out vec3 B){
  vec3 t = cross(vec3(0.0, 1.0, 0.0), n);
  T = length(t) > 0.01 ? normalize(t) : vec3(1.0, 0.0, 0.0);
  B = normalize(cross(n, T));
}
`;

const COLOR = /* glsl */ `
vec3 T, B; roofFrame(cgN, T, B);
int kind = roofKind(cgN);
float u = dot(cgP, T), v = dot(cgP, B), seed = cgSeed;
float hs = seed * 71.3;
vec3 base = roofTileBase(seed);
float age = fract(seed * 3.97);
float P = 0.31 + 0.06 * fract(seed * 9.1);
float C = 0.40;
float fw = max(fwidth(u), fwidth(v));
float detail = 1.0 - smoothstep(0.08, 0.22, fw / P);   // fade tiles when sub-pixel
vec3 col = base;
if (kind == 0 || kind == 2) {
  float ci0 = floor(u / P + 0.5);
  float uu = u + 0.035 * (cgVnoise2(vec2(v * 0.9, ci0 * 3.7 + hs)) - 0.5);   // rows laid by hand
  float ci = floor(uu / P + 0.5);
  float x = fract(uu / P + 0.5) - 0.5;
  float cwr = 0.23;
  bool cover = abs(x) < cwr;
  float colId = cover ? ci * 2.0 : ci * 2.0 + 1.0;
  float off = (cover ? 0.5 : 0.0) + 0.15 * cgHash12(vec2(colId, hs));
  float Ck = C * (0.94 + 0.1 * cgHash12(vec2(colId * 0.37, hs)));
  float k = floor(v / Ck + off);
  float fv = fract(v / Ck + off);
  float th = cgHash12(vec2(colId, k) + hs);
  float th2 = cgHash12(vec2(colId * 1.7, k * 3.1) + hs * 1.3);
  vec3 tc = base * (0.72 + 0.46 * th);
  tc *= mix(vec3(1.0), vec3(1.06, 0.95, 0.88), cgHash12(vec2(k, colId * 2.3) + hs));   // hue jitter
  tc = mix(tc, tc * vec3(1.14, 0.94, 0.82), step(0.9, th2));            // fresher replacement tiles
  tc = mix(tc, tc * vec3(0.62, 0.6, 0.58), step(th2, 0.07));            // dark old tiles
  // covers catch the sun and bleach, channels collect dirt; the covers' edges are shadowed
  float edge = cover ? smoothstep(cwr, cwr * 0.45, abs(x)) : 1.0;
  if (cover) tc = mix(tc, vec3(0.46, 0.33, 0.25), 0.2 * age) * mix(0.6, 1.0, edge);
  else tc *= 0.74 * mix(0.75, 1.0, smoothstep(cwr, 0.5, abs(x)));
  tc *= mix(0.42, 1.0, smoothstep(0.0, 0.2, fv));                       // the course above overhangs (its shadow: each tile's end reads)
  // lichen: grey-yellow crusts on the covers, dark in the channels; moss in the channels
  float lic = cgVfbm2(vec2(u, v) * 1.7 + hs, 3);
  float licM = smoothstep(0.62 - 0.12 * age, 0.70 - 0.12 * age, lic);
  tc = mix(tc, cover ? vec3(0.46, 0.43, 0.34) : vec3(0.09, 0.09, 0.05), licM * (0.3 + 0.5 * age));
  float moss = (cover ? 0.15 : 0.5) * smoothstep(0.45, 0.75, cgVnoise2(vec2(u * 1.3, v * 0.7) * 0.5 + hs));
  tc = mix(tc, vec3(0.07, 0.075, 0.04), moss * age);
  vec3 avg = base * 0.80 * mix(1.0, 0.9, age);                           // the far field
  col = mix(avg * (0.9 + 0.2 * cgVnoise2(vec2(u, v) * 0.25 + hs)), tc, detail);
  float big = cgVfbm2(vec2(u, v) * 0.18 + hs * 0.7, 3);                  // patchy weathering
  col *= 0.84 + 0.3 * big;
  col = mix(col, col * vec3(0.8, 0.8, 0.78) + vec3(0.05, 0.045, 0.04), smoothstep(0.55, 0.85, big) * age * 0.6);
  // sun-bleaching on the slopes facing the southern sky (+z), patchy along the courses
  float expo = smoothstep(-0.12, 0.42, 0.62 * cgN.z - 0.18 * cgN.x + 0.42 * cgN.y - 0.24);
  float bk = (0.18 + 0.82 * fract(seed * 7.77)) * expo * (0.75 + 0.5 * cgVnoise2(vec2(u * 0.6, v * 1.4) + hs * 1.7));
  vec3 bleached = vec3(0.47, 0.33, 0.255) * (0.9 + 0.2 * fract(seed * 23.1));
  col = mix(col, bleached * (0.82 + 0.36 * (col.r / max(base.r, 1e-3) - 0.8)), clamp(0.5 * bk, 0.0, 0.55));
  // dust and lime from the mortar dull every old roof a little
  float lumC = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, vec3(lumC) * vec3(1.14, 0.96, 0.84), 0.08 + 0.1 * age);   // (less than Athenaion's: in the game's light it went grey)
  if (kind == 2) col *= 0.7;                                             // the tiles' ends, in shade
} else if (kind == 3) {
  float r = smoothstep(0.08, 0.14, abs(fract(dot(cgP, vec3(1.0, 0.0, 1.0)) / 0.55) - 0.5));   // rafters
  col = mix(vec3(0.16, 0.10, 0.06), vec3(0.30, 0.24, 0.17), r);
} else {
  float sn = cgVfbm2(cgP.xz * 0.6 + hs, 4);                              // lime screed, stained, jointed
  col = vec3(0.60, 0.56, 0.48) * (0.78 + 0.35 * sn);
  float jt = smoothstep(0.0, 0.03, min(fract(cgP.x / 0.8), 1.0 - fract(cgP.x / 0.8))) * smoothstep(0.0, 0.03, min(fract(cgP.z / 0.8), 1.0 - fract(cgP.z / 0.8)));
  col *= mix(0.8, 1.0, mix(1.0, jt, detail));
}
diffuseColor.rgb = col * uRoofBright;
`;

const NORMAL = /* glsl */ `
if (roofKind(cgN) == 0) {
  vec3 T, B; roofFrame(cgN, T, B);
  float u = dot(cgP, T), v = dot(cgP, B), seed = cgSeed;
  float P = 0.31 + 0.06 * fract(seed * 9.1), C = 0.40;
  float detail = 1.0 - smoothstep(0.08, 0.22, max(fwidth(u), fwidth(v)) / P);
  float hs = seed * 71.3;
  float ci0 = floor(u / P + 0.5);
  float uu = u + 0.035 * (cgVnoise2(vec2(v * 0.9, ci0 * 3.7 + hs)) - 0.5);
  vec2 pr = roofProfile(uu, P);
  float x = fract(uu / P + 0.5) - 0.5;
  bool cover = abs(x) < 0.23;
  float colId = cover ? floor(uu / P + 0.5) * 2.0 : floor(uu / P + 0.5) * 2.0 + 1.0;
  float off = (cover ? 0.5 : 0.0) + 0.15 * cgHash12(vec2(colId, hs));
  float Ck = C * (0.94 + 0.1 * cgHash12(vec2(colId * 0.37, hs)));
  float fv = fract(v / Ck + off);
  // each course tilts a little more than the roof (a saw-tooth), with a slight random tilt and twist
  float tid = cgHash12(vec2(colId, floor(v / Ck + off)) + seed * 9.0);
  float tilt = 0.10 + 0.06 * (tid - 0.5);
  float dhv = -tilt * (1.0 - smoothstep(0.0, 0.12, fv)) * 3.0 + tilt * 0.4;
  float twist = 0.08 * (cgHash12(vec2(floor(v / Ck + off), colId * 1.3) + hs) - 0.5);
  cgBump = (-T * (pr.y * 0.75 + twist) - B * dhv) * detail;
}
`;

const AO = /* glsl */ `
{
  int kind3 = roofKind(cgN);
  if (kind3 == 0) {
    vec3 T, B; roofFrame(cgN, T, B);
    float u = dot(cgP, T), P = 0.31 + 0.06 * fract(cgSeed * 9.1);
    float x = fract(u / P + 0.5) - 0.5;
    float detail = 1.0 - smoothstep(0.08, 0.22, max(fwidth(u), fwidth(dot(cgP, B))) / P);
    cgAO = mix(0.85, abs(x * P) < P * 0.24 ? 1.0 : 0.7, detail);
  } else if (kind3 == 3) cgAO = 0.45;
}
`;

// Make `mat` (the kit's roof material) a coppi roof. bright: a multiplier for the game's light.
export function roofTiles(mat, bright = 1) {
  mat.normalMap = null;                     // (the photo's bumps don't match these tiles)
  mat.roughness = 0.88;
  mat.envMapIntensity = 0.3;                // (matte clay: a full sky sheen greyed the tiles)
  mat.color.set(0xffffff);
  const uniforms = mat.userData.uniforms = { uRoofBright: { value: bright } };
  return proceduralHooks(mat, {
    key: 'coppi',
    uniforms,
    head: HEAD, color: COLOR, normal: NORMAL, ao: AO,
  });
}
