// Prepares the Higgsfield/Meshy downloads in models-src/ for the game (public/models/):
// characters and props get 1024 px WebP textures; anim_*.glb files keep only their
// skeleton and animation (mesh, skin and textures removed), so each clip is a few KB.
// Then compresses them (tools/compress-models.mjs).
// Run: node tools/prepare-models.mjs [file.glb …]   (no names: every file in models-src/)
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const SRC = 'models-src', OUT = 'public/models';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const only = process.argv.slice(2);
for (const file of readdirSync(SRC).filter(f => f.endsWith('.glb') && (!only.length || only.includes(f)))) {
  const src = `${SRC}/${file}`, out = `${OUT}/${file}`;
  if (file.startsWith('anim_')) {
    const doc = await io.read(src);
    for (const node of doc.getRoot().listNodes()) { node.setMesh(null); node.setSkin(null); }
    for (const m of doc.getRoot().listMeshes()) m.dispose();
    for (const t of doc.getRoot().listTextures()) t.dispose();
    for (const m of doc.getRoot().listMaterials()) m.dispose();
    await doc.transform(prune());
    await io.write(out, doc);
  } else {
    execFileSync('npx', ['gltf-transform', 'optimize', src, out, '--compress', 'false', '--simplify', 'false',
      '--texture-compress', 'webp', '--texture-size', '1024'], { stdio: 'inherit' });
  }
  console.log('prepared', out);
}
execFileSync('node', ['tools/compress-models.mjs'], { stdio: 'inherit' });   // meshopt, for the game
