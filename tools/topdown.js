// Dev tool: a top-down picture of the map around (cx, cz), `size` metres across, north up, with
// a grid every 10 m (brighter every 50 m, at round coordinates) to read positions off. In the console:
//   const t = await import('/tools/topdown.js'); await t.topdown(20, -30, 160);
import * as THREE from 'three';

export async function topdown(cx, cz, size = 160) {
  const g = window.game, r = g.renderer, scene = g.world.scene;
  const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 1, 2000);
  cam.position.set(cx, 600, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz);
  const lines = new THREE.Group();
  const mat = (c) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.7 });
  const x0 = Math.floor((cx - size / 2) / 10) * 10, z0 = Math.floor((cz - size / 2) / 10) * 10;
  for (let v = 0; v <= size + 20; v += 10) {
    const x = x0 + v, z = z0 + v, big = (n) => n % 50 === 0;
    lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 500, cz - size), new THREE.Vector3(x, 500, cz + size)]), mat(big(x) ? 0xff2020 : 0xffffff)));
    lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx - size, 500, z), new THREE.Vector3(cx + size, 500, z)]), mat(big(z) ? 0x2060ff : 0xffffff)));
  }
  for (const l of lines.children) l.renderOrder = 999;
  scene.add(lines);
  const old = r.getSize(new THREE.Vector2());
  r.setSize(900, 900, false); r.render(scene, cam);
  const url = r.domElement.toDataURL('image/jpeg', 0.85);
  r.setSize(old.x, old.y, false); scene.remove(lines);
  let im = document.getElementById('dbgshot');
  if (!im) { im = document.createElement('img'); im.id = 'dbgshot'; document.body.appendChild(im); }
  im.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;object-fit:contain;background:#000';
  im.src = url;
  await new Promise(res => setTimeout(res, 300));
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  return { x: [cx - size / 2, cx + size / 2], z: [cz - size / 2, cz + size / 2], red: 'x multiples of 50', blue: 'z multiples of 50' };
}
