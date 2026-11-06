// Builds the crouched walk and the crawl from tools/blender/low_gaits.py's solved poses: the old
// clip's tracks go, a rotation track per bone and the hips' path come in. Run:
//   node tools/set-low-gaits.mjs <dir of .pose.json> [anim_crouch anim_crawl]
// Writes models-src/<clip>.glb; then node tools/prepare-models.mjs <clip>.glb for the game's copy.
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [dir, ...only] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const clip of only.length ? only : ['anim_crouch', 'anim_crawl']) {
  const { T, frames, bones, hips } = JSON.parse(readFileSync(`${dir}/${clip}.pose.json`));
  const doc = await io.read(`models-src/${clip}.glb`), root = doc.getRoot(), anim = root.listAnimations()[0];
  const buf = root.listBuffers()[0], node = n => root.listNodes().find(x => x.getName() === n);
  for (const c of anim.listChannels()) { const s = c.getSampler(); c.dispose(); s.dispose(); }
  const times = doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(Float32Array.from({ length: frames }, (_, i) => T * i / (frames - 1)));
  const track = (target, path, type, values) => {
    const s = doc.createAnimationSampler().setInput(times).setInterpolation('LINEAR')
      .setOutput(doc.createAccessor().setType(type).setBuffer(buf).setArray(new Float32Array(values.flat())));
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setSampler(s).setTargetPath(path).setTargetNode(target));
  };
  for (const [name, keys] of Object.entries(bones)) track(node(name), 'rotation', 'VEC4', keys);
  track(node('Hips'), 'translation', 'VEC3', hips);
  await io.write(`models-src/${clip}.glb`, doc);
  console.log(clip, frames, 'keys,', T, 's');
}
