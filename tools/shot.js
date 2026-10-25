// Dev tool: put the player somewhere, render one frame and show it full screen (the game's
// own loop may be paused behind the menu). In the console of the running game:
//   const s = await import('/tools/shot.js'); await s.ready(); await s.shot(x, z, yaw, pitch, y?);
// y defaults to the floor there; s.hide() removes the picture.
export async function ready() {
  while (!window.game) await new Promise(r => setTimeout(r, 300));
  document.getElementById('menu').style.display = 'none';
}

export async function shot(x, z, yaw, pitch = 0, y = null) {
  const g = window.game, p = g.player;
  const put = () => { p.pos.set(x, y ?? g.world.floorAt(x, z, 500), z); p.yaw = yaw; p.pitch = pitch; };
  put(); g.advance(0.02); put(); g.advance(0.01);
  g.world.cullTrees?.(g.camera.position);
  g.renderer.render(g.world.scene, g.camera);
  let im = document.getElementById('dbgshot');
  if (!im) { im = document.createElement('img'); im.id = 'dbgshot'; im.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;object-fit:cover'; document.body.appendChild(im); }
  im.src = g.renderer.domElement.toDataURL('image/jpeg', 0.85);
  im.style.display = 'block';
  await new Promise(r => setTimeout(r, 300));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

export function hide() { const im = document.getElementById('dbgshot'); if (im) im.style.display = 'none'; }
