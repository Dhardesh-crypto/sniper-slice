// Leaf textures that stay leafy far away (after Athenaion's vegetation/atlas.js, MIT, Leon Lin).
// The GPU's own mipmaps average alpha, so at a distance most texels of a leaf card fall under the
// alpha test and a crown thins out to a few sticks; and the transparent texels are black, so what
// is left goes dark. Here the mip chain is built by hand:
//  - the transparent texels take the leaves' average colour first (no dark fringes);
//  - colour is averaged in linear light;
//  - each level's alpha is scaled so the same share of texels passes the alpha test as at full size.
import * as THREE from 'three';

// sRGB byte → linear light (materials.js reads textures with it too).
export const toLin = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const LN = 4096, toS = new Uint8Array(LN + 1);
for (let i = 0; i <= LN; i++) { const l = i / LN; const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; toS[i] = Math.max(0, Math.min(255, Math.round(c * 255))); }

// A square, power-of-two canvas or image with alpha → a texture for an alphaTest of `ref`.
// flipY as the texture it replaces had it (a canvas texture's true, a glTF texture's false).
export function foliageTexture(src, ref = 0.5, flipY = true) {
  const S = src.width;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (flipY) { g.translate(0, S); g.scale(1, -1); }   // (a data texture's rows go up as given)
  g.drawImage(src, 0, 0, S, S);
  const d = new Uint8Array(g.getImageData(0, 0, S, S).data.buffer);
  const aRef = ref * 255;
  let r = 0, gr = 0, b = 0, n = 0, cov = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += toLin[d[i]]; gr += toLin[d[i + 1]]; b += toLin[d[i + 2]]; n++; }
  const avg = n ? [toS[(r / n * LN) | 0], toS[(gr / n * LN) | 0], toS[(b / n * LN) | 0]] : [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > aRef) cov++;
    if (a < 250) { const k = a / 255; for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * k + avg[c] * (1 - k); }
  }
  const target = cov / (S * S);
  const mips = [{ data: d, width: S, height: S }];
  const hist = new Uint32Array(256);
  let prev = d, ps = S;
  while (ps > 1) {
    const ns = ps >> 1, out = new Uint8Array(ns * ns * 4);
    for (let y = 0; y < ns; y++) {
      let i0 = y * 2 * ps * 4, i1 = (y * 2 + 1) * ps * 4, o = y * ns * 4;
      for (let x = 0; x < ns; x++, i0 += 8, i1 += 8, o += 4) {
        for (let c = 0; c < 3; c++) out[o + c] = toS[((toLin[prev[i0 + c]] + toLin[prev[i0 + 4 + c]] + toLin[prev[i1 + c]] + toLin[prev[i1 + 4 + c]]) * 0.25 * LN) | 0];
        out[o + 3] = (prev[i0 + 3] + prev[i0 + 7] + prev[i1 + 3] + prev[i1 + 7] + 2) >> 2;
      }
    }
    // the alpha level above which `target` of the texels lie → scaled to sit on the test's threshold
    if (ns >= 2 && target > 0.001 && target < 0.999) {
      hist.fill(0);
      for (let i = 3; i < out.length; i += 4) hist[out[i]]++;
      const want = target * ns * ns;
      let acc = 0, th = 255;
      for (let v = 255; v >= 1; v--) { acc += hist[v]; if (acc >= want) { th = v; break; } }
      const scale = aRef / Math.max(1, th - 0.5);
      for (let i = 3; i < out.length; i += 4) out[i] = Math.min(255, out[i] * scale);
    }
    mips.push({ data: out, width: ns, height: ns });
    prev = out; ps = ns;
  }
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
