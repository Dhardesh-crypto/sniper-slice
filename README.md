# Sniper Slice

A one-mission browser game in the spirit of Sniper Elite 5, built with three.js.

**Operation Vineyard, Tuscany 1944.** Oberst Krause runs the German post at a vineyard farm.
Kill him, optionally wreck his field radio and take his papers, then get back to the hill
you started from.

## Run it

```bash
nvm use        # Node 22.19 (Vite 8 needs Node 20.19+ or 22.12+)
npm install
npm run dev    # then open the URL Vite prints
```

`npm test` runs the ballistics tests. `npm run build` makes a static build in `dist/`.

## What's in it

- **Ballistics and scope:** bullet drop and wind drift (point-mass with drag), zeroing, 4×/8× scope,
  heart rate and breath, binoculars for ranging and tagging.
- **X-ray kill cam:** ride the bullet, see bones and organs break; engine shots get their own cam.
- **Stealth:** noise from footsteps and shots, sound masking (planes, artillery, generator),
  vision cones, cover and tall grass, bodies to hide.
- **Enemy AI:** patrols, investigating, searching, cover and return fire, an alarm siren and
  reinforcements by truck (A* over a nav grid).
- **Weak spots:** shoot the siren horn, the generator, or a truck's engine (two hits: it explodes).
- **Knife takedowns:** sneak up behind a guard and press F, or ambush one who comes too close to your
  hiding spot in the grass (Higgsfield thrust and grabbed-and-fall clips).
- **Kit:** an item wheel (hold Q) with grenades, bottles to distract, a whistle to lure, mines,
  remote TNT, satchel charges, bandages and medkits; three rifle ammo types (standard, subsonic, AP).
- **Vehicles:** Higgsfield models throughout: a Panzer IV that shells you when it sees you, Opel Blitz
  trucks (the radio truck, and reinforcements that drive up the road), a Kübelwagen staff car and a
  trimotor transport plane overhead; shoot engines, or plant a satchel.
- **Weapons and upgrades:** Springfield, Lee-Enfield, Welrod and P38 from the start; the Gewehr 43,
  M1 Carbine and De Lisle are hidden in weapon crates. Toolboxes hold parts (scopes, barrels,
  suppressor or muzzle brake, magazines, stock) that change reach, stability, noise and damage.
  What you find is kept across missions; fit it in the Loadout tab or at a workbench mid-mission.
  The Oberst carries a Luger P08.
- **Heavy weapons (key 3):** an M1897 trench gun, an MG42, and three anti-tank weapons (Panzerschreck,
  Panzerfaust, PIAT) in crates around the map, with heavy-ammunition caches for shells, belts,
  rockets and bombs. A direct rocket hit wrecks a vehicle; the Panzer takes two (the Panzerfaust one).
- **Supplies:** ammo boxes, medical boxes, explosives crates and bottle crates around the compound
  and the countryside (on your map once you've been near); soldiers carry ammo and sometimes a
  grenade, a bandage or a medkit.
- **Saving:** three save slots and checkpoint autosaves in the pause menu, plus quick save / load (F5 / F9).
- **Moving around:** third-person camera, crouch behind cover, climb walls and ladders, tower stairs.

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move |
| Shift | Sprint · hold breath while scoped |
| C / Z | Crouch / prone |
| Space | Fire while aiming · climb a wall or ladder otherwise |
| Right mouse | Aim / scope (hold, or click to toggle: a menu setting for trackpads) |
| Left mouse | Fire |
| Mouse wheel · = / − · V | Zoom the scope or binoculars (V switches 4× / 8×) |
| ↑ / ↓ while aiming, Page Up / Down | Zero the scope |
| B (hold) | Binoculars: range and tag |
| R | Reload |
| 1 / 2 | Rifle / suppressed pistol |
| E (hold) | Search bodies, cut the alarm wire, wreck the radio |
| Q (hold) | Item wheel |
| G | Use the item (hold to aim a throw, release to throw) |
| H | Heal |
| K | Detonate TNT and satchels |
| X | Switch rifle ammo |
| F5 / F9 | Quick save / quick load |
| F | Knife takedown (behind an unalerted guard, or from hiding in tall grass) · drag / drop a body |
| M | Map |
| Esc | Pause |

## Project layout

`src/core` loop helpers, input, audio, post-processing · `src/world` terrain, compound, characters,
weak spots · `src/weapons` ballistics and the rifle · `src/player` movement, climbing, camera ·
`src/stealth` noise, sight and masking · `src/ai` nav grid and guard behaviour ·
`src/mission` objectives and score · `src/ui` HUD and map · `tasks/` plan and notes.

Characters and the rifle were generated with Higgsfield (Meshy); `npm run models` prepares them
from the raw downloads in `models-src/` (not in the repository) into `public/models/`.
