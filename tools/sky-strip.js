// Dev tool: sample the running mission's sky just above the horizon all the way round, as the
// renderer sees it before tone mapping (linear, exposure not applied), for tools/blender/horizon.py
// to wash its far country into (tools/blender/skies.json). In the console of the running game:
//   const s = await import('/tools/sky-strip.js'); JSON.stringify(await s.strip())
// Returns { id, lat, colours: [[r, g, b] every 5° of bearing, clockwise from north], fog: its fog's
// colour (linear), ground: the lit ground's mean (linear) round the start, for the sun's strength }.
export async function strip(lat = 2.5) {
  while (!window.game) await new Promise(r => setTimeout(r, 300));
  const g = window.game, THREE = g.THREE, R = g.renderer, scene = g.world.scene;
  const sky = g.world.sky;
  const hidden = [];
  scene.traverse(o => { if (o !== scene && o !== sky && o.visible && !o.isLight && o.parent === scene) { o.visible = false; hidden.push(o); } });
  const rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
  const cam = new THREE.PerspectiveCamera(4, 1, 0.1, 5000);
  const px = new Float32Array(8 * 8 * 4), colours = [];
  for (let b = 0; b < 360; b += 5) {
    const a = THREE.MathUtils.degToRad(b), e = THREE.MathUtils.degToRad(lat);
    cam.position.set(0, 0, 0);
    cam.lookAt(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    R.setRenderTarget(rt);
    R.render(scene, cam);
    R.readRenderTargetPixels(rt, 0, 0, 8, 8, px);
    const c = [0, 0, 0];
    for (let i = 0; i < 64; i++) for (let k = 0; k < 3; k++) c[k] += px[i * 4 + k] / 64;
    colours.push(c.map(v => +v.toFixed(4)));
  }
  for (const o of hidden) o.visible = true;
  // The ground round the start, looking down 8° every 90°.
  const t = await import('/src/world/terrain.js'), sp = t.START_HILL, y = t.heightAt(sp.x, sp.z) + 2, ground = [0, 0, 0];
  for (let b = 0; b < 360; b += 90) {
    const a = THREE.MathUtils.degToRad(b), e = THREE.MathUtils.degToRad(-8);
    cam.position.set(sp.x, y, sp.z);
    cam.lookAt(sp.x + Math.sin(a) * Math.cos(e), y + Math.sin(e), sp.z - Math.cos(a) * Math.cos(e));
    R.setRenderTarget(rt);
    R.render(scene, cam);
    R.readRenderTargetPixels(rt, 0, 0, 8, 8, px);
    for (let i = 0; i < 64; i++) for (let k = 0; k < 3; k++) ground[k] += px[i * 4 + k] / 256;
  }
  R.setRenderTarget(null);
  rt.dispose();
  const fog = scene.fog ? [scene.fog.color.r, scene.fog.color.g, scene.fog.color.b] : null;
  const round = (c) => c && c.map(v => +v.toFixed(4));
  return { id: t.activeMap().id, lat, colours, fog: round(fog), ground: round(ground) };
}
