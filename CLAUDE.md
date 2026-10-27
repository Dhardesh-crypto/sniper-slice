# Sniper Slice: notes for Claude

A browser sniper game in the spirit of Sniper Elite 5 (three.js + Vite, Italy 1944). Eight
missions, picked in the menu: vineyard, town, harbour, forest, railway, bridge, airfield, radar
(`src/missions/*.js`, one file each; the shared compound is `src/world/compound.js`). The README
still describes only the first mission; `tasks/todo.md` is the full history of what was built, pass
by pass, and `tasks/lessons.md` the mistakes not to repeat. Read the relevant part of both before
changing a system.

Live: https://sniper-slice.netlify.app · repo: github.com/Dhardesh-crypto/sniper-slice (public).

## Running and checking

- Node 22: `export PATH=/Users/f.h.huisman/.nvm/versions/node/v22.19.0/bin:$PATH` (Node 20 fails to
  build). `npm test` (ballistics), `npx vite build`.
- Dev server: `npx vite --port 5179 --strictPort` (in the desktop app: the preview config
  "sniper-slice"). Other sessions may share it; their edits reload the page, so for long checks
  serve a static build (`vite build --outDir <tmp>` then `vite preview --outDir <tmp> --port 5181`).
- Pick a mission without the menu: `sessionStorage.setItem('sniper-slice.mission','town'); location.reload()`.
- `window.game` is the debug handle (world, player, arsenal, ai, guns, input, …):
  `game.advance(seconds)` runs the game synchronously (works with the tab hidden),
  `game.aimAt(x, y, z)`, `game.input.pressed.add('KeyE')` / `input.buttons.add('Mouse0')` to press.
- Dev tools in `tools/`: `snap.js` (render a free camera, POST to a receiver on 127.0.0.1:5199),
  `navcheck.js` (does furniture cut off guard paths), `sky-strip.js` (sample a mission's sky).
- Verify in the browser with numbers and pictures before calling something done.

## Assets

- 3D: Blender 5.2 headless scripts in `tools/blender/` (`blender -b -P script.py -- args`): the
  architecture and interior kits, horizon panoramas, tree LODs, anatomy. Prefer Blender or code over
  Higgsfield (Higgsfield costs credits; use it only when asked).
- Music: MusicGen (AudioCraft) per mission plus an alarm layer, `public/sounds/music_*.mp3`, credits
  in `public/sounds/CREDITS.md`. No bell-like timbres in the **music** (no chimes, glockenspiel); realistic metallic sound effects (brass cases landing) are fine.
- The fal.ai key is in `~/.config/fal/key`: never write it into the project (the repo is public).

## Rules the user has set

- Tanks: crews never spot you through walls (line of sight only), but their guns shoot through walls
  at where they last saw you (`src/world/turrets.js`).
- Guards and their rifles stay out of walls (`soldier.keepRifleClear`, `world.boxAlong`).
- Interiors: tables, beds and wardrobes are solid; the rest of the room dressing is decoration.
- MG nests are usable: E behind the gun mans it (`src/world/mgnest.js`, `Arsenal.mount`); once the
  alarm's up a guard mans each empty one (`GuardAI.gunner`).
- Guards route across floors: each upper floor has its own grid, joined by its stairs (`src/ai/nav.js`).
- Each mission's fog takes its horizon sky's colour; the panoramas are rendered with the same haze.
- Everyone riding a vehicle is a target (bullets and every explosive): tank commanders in their
  hatches, the truck's driver and the men in the back, the patrol car's and motorcycle's crews; a
  blast near a vehicle damages it by distance (explodes close, stalls further off). Hidden bullet
  blocks on vehicles stop at the bodywork so the men above them can be hit.

## Working style

- Match the code's style: dense, plain-English comments that say why, short names.
- Each pass gets a dated section in `tasks/todo.md`; corrections go in `tasks/lessons.md`.
- Commit only your own files, end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
  push to origin main when the user asks. Deploy (when asked): build to `dist-deploy`, then
  `netlify deploy --prod --dir dist-deploy --site dce0922d-ac4e-4d93-967f-7e61aab3689a`.
- Never kill processes you didn't start; stop your own servers when done.

## Open ideas, not yet done

- (none listed: see the latest sections of `tasks/todo.md` for what's in progress)
