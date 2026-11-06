// Turns a retargeted walking clip (Kimodo → retarget.py, a few seconds of steady stride) into one
// seamless gait cycle for the game: finds the two frames that match best one cycle apart, cuts
// there, closes what's left of the seam by spreading it over the cycle, takes the travel out of
// the hips, and starts the cycle on the left heel strike so all gaits can cross-fade in step.
// Prints the clip's natural ground speed for CLIP_SPEED in src/player/avatar.js.
// Run: node tools/loop-gait.mjs in.glb models-src/anim_x.glb minCycleSeconds maxCycleSeconds [top=a.glb] [arms=b.glb] [swing=1.3] [elbow=3]
// top: another finished gait (same foot first) whose spine, head and arms replace this clip's,
// stretched to its cycle: the run is the rifle sprint's legs with the free jog's top half.
// arms: the same for the arms alone (Kimodo's own, with no prompt, stay bent up in front of the
// chest; the walk clip's swing properly). swing scales the upper arms' swing about their mean,
// elbow the forearms' bend away from the rig's straight rest.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [src, out, lo = 0.5, hi = 1.5, ...opts] = process.argv.slice(2);
const opt = Object.fromEntries(opts.map(o => o.split('=')));
const ARMS = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'];
const UPPER = ['Spine', 'Spine01', 'Spine02', 'neck', 'Head', ...ARMS];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const anim = doc.getRoot().listAnimations()[0];
for (const a of doc.getRoot().listAnimations().slice(1)) a.dispose();
const tracks = anim.listChannels().filter(c => ['rotation', 'translation'].includes(c.getTargetPath())).map(c => {
  const s = c.getSampler(), w = c.getTargetPath() === 'rotation' ? 4 : 3;
  return { c, s, w, node: c.getTargetNode(), t: [...s.getInput().getArray()], v: [...s.getOutput().getArray()], name: c.getTargetNode().getName(), rot: w === 4 };
}).filter(k => k.t.length > 2);
const hips = tracks.find(k => k.name === 'Hips' && !k.rot);
const n = hips.t.length, dt = (hips.t[n - 1] - hips.t[0]) / (n - 1);
const rots = tracks.filter(k => k.rot && k.t.length === n);
const quat = (k, f) => k.v.slice(f * 4, f * 4 + 4);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const qdiff = (f, g) => rots.reduce((s, k) => s + 1 - Math.abs(dot(quat(k, f), quat(k, g))), 0) / rots.length;
// (the steady middle of the clip: Kimodo starts and ends a path a little unsure of itself)
let best = null;
for (let i = Math.round(n * 0.25); i < n * 0.6; i++) for (let j = i + Math.round(lo / dt); j <= Math.min(n - 2, i + hi / dt); j++) {
  const cost = qdiff(i, j) * 1000 + qdiff(i + 1, j + 1) * 300 + Math.abs(hips.v[i * 3 + 1] - hips.v[j * 3 + 1]) * 0.02;
  if (!best || cost < best.cost) best = { cost, i, j };
}
best ??= { cost: 0, i: 0, j: n - 1 };   // (a clip that's a single cycle already)
const { i, j } = best, m = j - i, T = m * dt;
// Ground speed from the hips' travel (their units: the clips are in centimetres under a 0.01 node).
const dx = hips.v[j * 3] - hips.v[i * 3], dz = hips.v[j * 3 + 2] - hips.v[i * 3 + 2], travel = Math.hypot(dx, dz);
const fwd = travel > 5 ? [dx / travel, 0, dz / travel] : [0, 0, 1];   // (a clip already in place: the rig's own forward)
// One cycle, closed: frame m equals frame 0, the difference spread evenly.
for (const k of tracks) {
  if (k.t.length !== n) continue;
  const w = k.w, cyc = [];
  for (let f = 0; f <= m; f++) cyc.push(k.v.slice((i + f) * w, (i + f + 1) * w));
  if (k.rot) for (let f = 1; f <= m; f++) if (dot(cyc[f], cyc[f - 1]) < 0) cyc[f] = cyc[f].map(x => -x);
  const a = cyc[0], b = cyc[m];
  const sign = k.rot && dot(a, b) < 0 ? -1 : 1;
  cyc.forEach((q, f) => {
    const s = f / m;
    for (let c = 0; c < w; c++) q[c] += (a[c] * sign - b[c]) * s;
    if (k.rot) { const l = Math.hypot(...q); for (let c = 0; c < 4; c++) q[c] /= l; }
  });
  k.cyc = cyc;
}
// Left heel strike: the left thigh at its furthest forward.
const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const turn = (q, v) => { const p = mul(mul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]); return p.slice(0, 3); };
const qh = tracks.find(k => k.name === 'Hips' && k.rot), ql = tracks.find(k => k.name === 'LeftUpLeg' && k.rot);
const knee = doc.getRoot().listNodes().find(x => x.getName() === 'LeftLeg').getTranslation();
let k0 = 0, far = -Infinity;
for (let f = 0; f < m; f++) { const d = dot(turn(mul(qh.cyc[f], ql.cyc[f]), knee), fwd); if (d > far) { far = d; k0 = f; } }
// Everything else in the clip (scale keys, bones that never move) would keep it its old length.
const kept = new Set(tracks.filter(k => k.cyc).map(k => k.c));
for (const c of anim.listChannels()) if (!kept.has(c)) { const s = c.getSampler(); c.dispose(); s.dispose(); }
// The hips' place in the cycle: over the rig's own rest spot, the sway round it kept.
const mid = [0, 2].map(c => hips.cyc.slice(0, m).reduce((s, q) => s + q[c], 0) / m);   // (closing the seam took the travel out)
const rest = doc.getRoot().listNodes().find(x => x.getName() === 'Hips').getTranslation();
for (const k of tracks.filter(k => k.cyc)) {
  const v = [], t = [];
  for (let f = 0; f <= m; f++) {
    const q = k.cyc[(k0 + f) % m].slice();
    if (k === hips) { q[0] += rest[0] - mid[0]; q[2] += rest[2] - mid[1]; }
    v.push(...q); t.push(f * dt);
  }
  k.s.getInput().setArray(new Float32Array(t));
  k.s.getOutput().setArray(new Float32Array(v));
}
const conj = q => [-q[0], -q[1], -q[2], q[3]];
const qpow = (q, k) => {   // (the same turn, k times as far)
  const w = Math.min(1, Math.abs(q[3])), sgn = q[3] < 0 ? -1 : 1, half = Math.acos(w), sn = Math.sin(half);
  if (sn < 1e-6) return [0, 0, 0, 1];
  const f = Math.sin(half * k) / sn * sgn;
  return [q[0] * f, q[1] * f, q[2] * f, Math.cos(half * k)];
};
async function graft(file, bones) {
  const top = await io.read(file), a2 = top.getRoot().listAnimations()[0];
  for (const c of a2.listChannels()) {
    if (c.getTargetPath() !== 'rotation' || !bones.includes(c.getTargetNode().getName())) continue;
    const k = tracks.find(x => x.rot && x.cyc && x.name === c.getTargetNode().getName());
    if (!k) continue;
    const s2 = c.getSampler(), t2 = s2.getInput().getArray(), v2 = s2.getOutput().getArray(), n2 = t2.length - 1, v = [];
    for (let f = 0; f <= m; f++) {   // (nearest pair of keys, blended and normalised)
      const x = f / m * n2, a = Math.min(n2 - 1, Math.floor(x)), w = x - a, q = [0, 1, 2, 3].map(e => v2[a * 4 + e] * (1 - w) + v2[(a + 1) * 4 + e] * w), l = Math.hypot(...q);
      v.push(...q.map(e => e / l));
    }
    k.s.getOutput().setArray(new Float32Array(v));
  }
}
if (opt.top) await graft(opt.top, UPPER);
if (opt.arms) await graft(opt.arms, ARMS);
const reshape = (name, base, k) => {
  const t = tracks.find(x => x.rot && x.cyc && x.name === name), s = t.s, v = [...s.getOutput().getArray()], n3 = v.length / 4;
  const ref = base ?? (() => { const q = [0, 0, 0, 0]; for (let f = 0; f < n3; f++) for (let e = 0; e < 4; e++) q[e] += v[f * 4 + e] * Math.sign(dot(v.slice(f * 4, f * 4 + 4), v.slice(0, 4)) || 1); const l = Math.hypot(...q); return q.map(e => e / l); })();
  for (let f = 0; f < n3; f++) {
    const q = mul(ref, qpow(mul(conj(ref), v.slice(f * 4, f * 4 + 4)), k));
    for (let e = 0; e < 4; e++) v[f * 4 + e] = q[e];
  }
  s.getOutput().setArray(new Float32Array(v));
};
for (const side of ['Left', 'Right']) {
  if (opt.swing) reshape(side + 'Arm', null, +opt.swing);
  if (opt.elbow) reshape(side + 'ForeArm', doc.getRoot().listNodes().find(x => x.getName() === side + 'ForeArm').getRotation(), +opt.elbow);
}
await io.write(out, doc);
const unit = Math.abs(hips.v[1]) > 10 ? 100 : 1;   // (hips about 95 high: centimetres)
console.log(`${out}: frames ${i}-${j}, cycle ${T.toFixed(3)} s, seam cost ${best.cost.toFixed(2)}, travel ${(travel / unit).toFixed(2)} m, natural speed ${(travel / unit / T).toFixed(2)} m/s, left heel at frame ${k0}`);
