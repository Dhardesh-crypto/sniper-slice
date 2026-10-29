// Compresses the geometry and animation in public/models/*.glb with meshoptimizer
// (EXT_meshopt_compression): normals and tangents to 8-bit directions, UVs, skin weights and
// colours to 8–16 bit, the rest packed losslessly. Positions stay float, so no node transform
// changes (full quantization would put a scale on every mesh's node, and code that measures a
// mesh in its own units, like the Panzer's turret, would get it wrong). The game decodes the files
// with three's MeshoptDecoder and turns every attribute back into float32 (gltf.js), so code that
// reads the meshes sees what it always did. Textures stay as they are (already WebP).
// Files already compressed are skipped, so run it after any tool that writes a model:
//   npm run compress [file.glb …]   (no names: every model)
import { readdirSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const DIR = 'public/models';
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const only = process.argv.slice(2);
let before = 0, after = 0;
for (const file of readdirSync(DIR).filter(f => f.endsWith('.glb') && (!only.length || only.includes(f)))) {
  const path = `${DIR}/${file}`;
  const doc = await io.read(path);
  if (doc.getRoot().listExtensionsUsed().some(e => e.extensionName === 'EXT_meshopt_compression')) continue;
  const size = statSync(path).size;
  if (doc.getRoot().listMeshes().length) {
    await doc.transform(
      reorder({ encoder: MeshoptEncoder, target: 'size' }),
      // (UVs outside 0–1, tiling textures, are left as they are)
      quantize({ pattern: /^(TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/, patternTargets: /^(TEXCOORD|NORMAL|TANGENT)(_\d+)?$/,
        quantizeTexcoord: 14, quantizeWeight: 8, quantizeColor: 8 }),
    );
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });   // normals: octahedral
  await io.write(path, doc);
  before += size; after += statSync(path).size;
  console.log(`${file}: ${(size / 1e3).toFixed(0)} → ${(statSync(path).size / 1e3).toFixed(0)} KB`);
}
if (before) console.log(`total ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} MB`);
