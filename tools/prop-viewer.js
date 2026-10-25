// Dev tool: look at modelled props on their own, to check their turn and fit. In the browser
// console of the running game:
//   const v = await import('/tools/prop-viewer.js'); await v.view([['ship', { x: 72 }], ['crane', { y: 16 }]]);
// Each is drawn from the +z side, a little above, with a red dot on its −x end (its front).
// v.hide() puts the game back.
import * as THREE from 'three';
import { loadProps, propModel } from '/src/world/props.js';

export async function view(list) {
  const g = window.game;
  await loadProps(list.map(l => l[0]));
  const r0 = g.renderer, old = r0.getSize(new THREE.Vector2()), urls = [];
  for (const [key, size, turn = 0] of list) {
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0xdde3e6);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x667755, 1.2));
    const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(5, 10, 7); sc.add(d);
    sc.environment = g.world.scene.environment;
    const m = propModel(key, size, { turn });
    if (!m) { urls.push(''); continue; }
    sc.add(m);
    const bb = new THREE.Box3().setFromObject(m), c = bb.getCenter(new THREE.Vector3()), r = bb.getSize(new THREE.Vector3()).length();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(r * 0.03), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    dot.position.set(bb.min.x, c.y, bb.max.z); sc.add(dot);
    const cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 5000);
    cam.position.copy(c).add(new THREE.Vector3(0.35, 0.45, 1).normalize().multiplyScalar(r * (window.viewDist ?? 1.1))); cam.lookAt(c);
    r0.setSize(640, 360, false); r0.render(sc, cam);
    urls.push(r0.domElement.toDataURL('image/jpeg', 0.85));
  }
  r0.setSize(old.x, old.y, false);
  let box = document.getElementById('propview');
  if (!box) { box = document.createElement('div'); box.id = 'propview'; document.body.appendChild(box); }
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#222;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:33vh;gap:2px;';
  box.innerHTML = urls.map((u, i) => `<div style="position:relative"><img src="${u}" style="width:100%;height:100%;object-fit:contain"><span style="position:absolute;left:4px;top:2px;color:#fff;font:14px sans-serif">${list[i][0]}</span></div>`).join('');
  await new Promise(r => setTimeout(r, 400));
}

export function hide() { document.getElementById('propview')?.remove(); }
