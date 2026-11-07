// Paint out sky that SDXL left on a building skin's walls (it sometimes paints the country seen
// through a doorway onto the stone round it: town/80_-87 had two such patches). Run in the browser
// console with the dev server up; it returns the repaired texture as a WebP data URL, which
// replace-texture.py puts back into the GLB:
//   await import('/tools/skins/patch-sky.js'); const r = await patchSky('town_80_-87'); r.found; copy(r.webp)
// How: the skin's own UV layout says which texels are wall. In 16-texel cells that are wall, a cell
// that is mostly cool and light (blue at least as strong as red) is sky; joined cells of 100 or more
// are a patch. Each patch is covered by a block of wall of the same size from beside it (left,
// right, above or below, wherever the wall is whole), blended in over its edge.
// Look at `found` before using the result: pale walls pass for sky too (white limestone, grey render,
// blue-grey timber, concrete). Run over all 20 skins on 7 November 2026, only town/80_-87 had real sky.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const B = 16, MIN_CELLS = 100, PAD = 12;

window.patchSky = async (name) => {
  const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
  const gl = await L.loadAsync(`/models/skin_${name}.glb?${Date.now()}`);
  let mesh; gl.scene.traverse(o => { if (o.isMesh) mesh = o; });
  const map = mesh.material.map, N = map.image.width;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'); x.drawImage(map.image, 0, 0);
  const D = x.getImageData(0, 0, N, N).data;
  // The wall's texels: the UV triangles filled in.
  const mc = document.createElement('canvas'); mc.width = mc.height = N;
  const mx = mc.getContext('2d'); mx.fillStyle = '#fff';
  const uv = mesh.geometry.attributes.uv, idx = mesh.geometry.index;
  const P = i => [uv.getX(i) * N, (map.flipY ? 1 - uv.getY(i) : uv.getY(i)) * N];
  for (let t = 0; t < idx.count; t += 3) {
    const a = P(idx.getX(t)), b = P(idx.getX(t + 1)), d = P(idx.getX(t + 2));
    mx.beginPath(); mx.moveTo(...a); mx.lineTo(...b); mx.lineTo(...d); mx.closePath(); mx.fill();
  }
  const M = mx.getImageData(0, 0, N, N).data;
  // Sky cells, and the patches they make.
  const gw = N / B, cells = new Uint8Array(gw * gw);
  for (let cy = 0; cy < gw; cy++) for (let cx = 0; cx < gw; cx++) {
    let used = 0, bad = 0;
    for (let y = cy * B; y < cy * B + B; y++) for (let xx = cx * B; xx < cx * B + B; xx++) {
      const p = (y * N + xx) * 4;
      if (M[p] < 128) continue;
      used++;
      if (D[p + 2] >= D[p] - 4 && D[p] + D[p + 1] + D[p + 2] > 360) bad++;
    }
    cells[cy * gw + cx] = used > B * B * 0.8 && bad > used * 0.5 ? 1 : 0;
  }
  const seen = new Uint8Array(gw * gw), found = [];
  for (let i = 0; i < gw * gw; i++) {
    if (!cells[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    while (st.length) {
      const k = st.pop(), cx = k % gw, cy = (k / gw) | 0; n++;
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, kk = ny * gw + nx;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gw && cells[kk] && !seen[kk]) { seen[kk] = 1; st.push(kk); }
      }
    }
    if (n >= MIN_CELLS) found.push({ x0: x0 * B, y0: y0 * B, x1: (x1 + 1) * B, y1: (y1 + 1) * B, cells: n });
  }
  // Each patch covered from beside it, where the wall is whole and isn't another patch.
  const whole = (sx, sy, w, h) => {
    if (sx < 0 || sy < 0 || sx + w > N || sy + h > N) return false;
    for (let y = sy; y < sy + h; y += 4) for (let xx = sx; xx < sx + w; xx += 4) if (M[(y * N + xx) * 4] < 128) return false;
    return !found.some(r => sx < r.x1 && sx + w > r.x0 && sy < r.y1 && sy + h > r.y0);
  };
  for (const r of found) {
    const x0 = r.x0 - PAD, y0 = r.y0 - PAD, w = r.x1 - r.x0 + 2 * PAD, h = r.y1 - r.y0 + 2 * PAD;
    const from = [[-w - 8, 0], [w + 8, 0], [0, -h - 8], [0, h + 8], [-w - 8, -h / 2], [w + 8, -h / 2], [-w / 2, -h - 8], [-w / 2, h + 8]]
      .map(([dx, dy]) => [x0 + dx, y0 + dy]).find(([sx, sy]) => whole(sx, sy, w, h));
    r.from = from ?? null;
    if (!from) continue;
    const S = x.getImageData(from[0], from[1], w, h), T = x.getImageData(x0, y0, w, h);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const k = Math.min(1, Math.min(xx, y, w - 1 - xx, h - 1 - y) / PAD), p = (y * w + xx) * 4;
      for (let ch = 0; ch < 3; ch++) T.data[p + ch] = T.data[p + ch] * (1 - k) + S.data[p + ch] * k;
    }
    x.putImageData(T, x0, y0);
  }
  return { found, webp: c.toDataURL('image/webp', 0.82) };
};
