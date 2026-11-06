// Puts the arms solved by tools/blender/gait_arms.py into the gait clips: only the arm bones'
// rotation keys change. Run: node tools/set-gait-arms.mjs <dir of .arms.json> [clip ...]
// Writes models-src/<clip>.glb; then node tools/prepare-models.mjs <clip>.glb for the game's copy.
import { readFileSync, readdirSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [dir, ...only] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const clips = only.length ? only : readdirSync(dir).filter(f => f.endsWith('.arms.json')).map(f => f.replace('.arms.json', ''));
for (const clip of clips) {
  const { frames, bones } = JSON.parse(readFileSync(`${dir}/${clip}.arms.json`));
  const doc = await io.read(`models-src/${clip}.glb`), root = doc.getRoot(), anim = root.listAnimations()[0];
  // (Blender keys at 24 fps, the clips at 30: the arms get their own times over the same cycle)
  const clipTimes = anim.listChannels().find(c => c.getTargetNode().getName() === 'Hips').getSampler().getInput().getArray();
  const T = clipTimes[clipTimes.length - 1];
  const times = doc.createAccessor().setType('SCALAR').setBuffer(root.listBuffers()[0])
    .setArray(Float32Array.from({ length: frames }, (_, i) => T * i / (frames - 1)));
  for (const [name, keys] of Object.entries(bones)) {
    const out = new Float32Array(keys.flat());
    const ch = anim.listChannels().find(c => c.getTargetPath() === 'rotation' && c.getTargetNode().getName() === name);
    if (ch) {
      const s = ch.getSampler();
      s.setInput(times);
      s.setOutput(doc.createAccessor().setType('VEC4').setArray(out).setBuffer(root.listBuffers()[0]));
    } else {
      const s = doc.createAnimationSampler().setInput(times).setInterpolation('LINEAR')
        .setOutput(doc.createAccessor().setType('VEC4').setArray(out).setBuffer(root.listBuffers()[0]));
      anim.addSampler(s).addChannel(doc.createAnimationChannel().setSampler(s).setTargetPath('rotation').setTargetNode(root.listNodes().find(n => n.getName() === name)));
    }
  }
  await io.write(`models-src/${clip}.glb`, doc);
  console.log(clip, 'arms set,', frames, 'keys');
}
