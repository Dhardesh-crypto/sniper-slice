// Dev tool: render the scene from any point with a free camera (the player hidden) and post the
// picture to a local receiver (a small server on 127.0.0.1:5199 that saves POSTed data URLs).
//   const s = await import('/tools/snap.js'); await s.snap('name', [x, y, z], [tx, ty, tz], fov?);
export async function snap(name, from, to, fov = 55) {
  const g = window.game, THREE = g.THREE, R = g.renderer;
  g.world.scene.traverse(o => { if (o.isSkinnedMesh) o.visible = false; });
  const cam = new THREE.PerspectiveCamera(fov, 4 / 3, 0.05, 3000);
  cam.position.set(...from); cam.lookAt(...to); cam.updateMatrixWorld();
  g.world.cullTrees(cam.position, Math.tan(THREE.MathUtils.degToRad(55) / 2) / Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  R.setRenderTarget(null);
  R.render(g.world.scene, cam);
  const c = document.createElement('canvas'); c.width = 1000; c.height = 750;
  const src = R.domElement, sh = src.height, sw = sh * 4 / 3;
  c.getContext('2d').drawImage(src, (src.width - sw) / 2, 0, sw, sh, 0, 0, 1000, 750);
  const r = await fetch('http://127.0.0.1:5199/?n=' + name, { method: 'POST', body: c.toDataURL('image/jpeg', 0.88) });
  return r.text();
}
