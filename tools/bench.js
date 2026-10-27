// Dev tool: frame time, draw calls and triangles at the start and in the middle of the mission
// (where its pickups are), for before/after comparisons. In the console of the running game:
//   const b = await import('/tools/bench.js'); await b.bench();   → { spawn: [ms, calls, ktris], middle: […] }
// The ms are the whole frame run synchronously (simulation and render, waiting for the GPU).
export async function bench() {
  while (!window.game) await new Promise(r => setTimeout(r, 300));
  document.getElementById('menu').style.display = 'none';
  const g = window.game, R = g.renderer, gl = R.getContext(), px = new Uint8Array(4);
  g.stealth.wariness = 0;
  const one = () => {
    g.advance(0.3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < 90; i++) g.advance(1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / 90;
    R.info.autoReset = false; R.info.reset(); g.advance(1 / 60);
    const r = [+ms.toFixed(2), R.info.render.calls, Math.round(R.info.render.triangles / 1000)];
    R.info.autoReset = true;
    return r;
  };
  const P = g.pickups, c = new g.THREE.Vector3();
  for (const b of P.boxes) c.add(b.at);
  c.multiplyScalar(1 / P.boxes.length);
  const sp = g.world.spawn.clone(), out = { spawn: one() };
  g.player.pos.set(c.x, g.world.floorAt(c.x, c.z, 500), c.z);
  out.middle = one();
  g.player.pos.set(sp.x, g.world.floorAt(sp.x, sp.z, 500), sp.z);
  return out;
}

// Bench this mission, keep the result in localStorage under `bench-<label>-<mission id>`, then
// (with `next`) load that mission: run it once per mission to fill a table. `table(label)` reads it.
export async function benchAndGo(label, next) {
  const r = await bench();
  r.mission = document.querySelector('#menu')?.innerText.match(/Operation [^·\n]+/)?.[0]?.trim();
  localStorage.setItem(`bench-${label}-${sessionStorage.getItem('sniper-slice.mission') ?? 'vineyard'}`, JSON.stringify(r));
  if (next) { sessionStorage.setItem('sniper-slice.mission', next); setTimeout(() => location.reload(), 100); }
  return r;
}
export const table = (label) => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith(`bench-${label}-`)).map(k => [k.slice(label.length + 7), JSON.parse(localStorage.getItem(k))]));
