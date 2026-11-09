// Which texels of a model's texture its surface actually uses: the UV triangles of every mesh,
// filled in on a size × size grid, written as a PGM greyscale image (255 = used). The building
// skins' 4096 atlases are mostly black gutter between the islands, and a plain average of the
// image is mostly that; region-palette.py measures and matches colour through this mask.
//   node tools/skins/uv-mask.mjs public/models/skin_town_80_-33.glb out.pgm [size=512]
// (glTF UVs: v down the image, as the image is stored; the models are meshopt-compressed, so
// they're read through gltf-transform with the decoder, as compress-models.mjs writes them.)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [file, out, sizeArg] = process.argv.slice(2);
const N = +(sizeArg ?? 512);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const mask = new Uint8Array(N * N);

// Fill one triangle (texel centres inside it, by edge functions over its bounding box).
function tri(a, b, c) {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(N - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const e = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const area = e(a, b, c[0], c[1]);
  if (!area) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = e(b, c, px, py) / area, w1 = e(c, a, px, py) / area, w2 = e(a, b, px, py) / area;
    if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) mask[y * N + x] = 255;     // (a hair over the edge: no seams)
  }
}

for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const uv = prim.getAttribute('TEXCOORD_0');
  if (!uv) continue;
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : uv.getCount();
  const at = (i) => { const v = uv.getElement(idx ? idx.getScalar(i) : i, []); return [v[0] * N, v[1] * N]; };
  for (let t = 0; t + 2 < n; t += 3) tri(at(t), at(t + 1), at(t + 2));
}
fs.writeFileSync(out, Buffer.concat([Buffer.from(`P5\n${N} ${N}\n255\n`), Buffer.from(mask)]));
let used = 0; for (const v of mask) if (v) used++;
console.log(`${file}: ${(100 * used / mask.length).toFixed(1)}% of the texture used`);
