# Terrain kit: hand-over, 11 Nov 2026

New code that no mission uses yet: a map built as before is built exactly as before. Nothing committed.
Sheets: `tasks/landforms-sample.jpg` (the sample valley, six views), `tasks/landforms-biomes.jpg` (the same land under coast, heath, bocage, limestone), `tasks/biome-plants-preview.jpg` (the new plants in Blender).

## New map fields (all optional), one example each

```js
import { compose, rolling, valley, ridge, riverBed, lakeBasin, marshFlat, roadBed, rim, fall } from '../world/landforms.js';

const land = compose(rolling({ amp: 24, level: 72, seed: 5 }), [valley({ path: [[-720, 40], [720, 0]], depth: 40, floor: 110, width: 230 })]);
const river = riverBed({ path: STREAM, width: 7, depth: 1, levels: fall(land, STREAM, { end: LAKE_LEVEL }) });
const heightAt = compose(land, [river, lakeBasin({ x: 370, z: 0, r: 85, level: LAKE_LEVEL }), roadBed({ path: ROAD })]);

const map = {
  size: { x: 1400, z: 700 },                 // per-axis size in metres (instead of `half`); playSize likewise (default 25 m in)
  playArea: { poly: [[-675, -325], [0, -325], [0, 0], [675, 0], [675, 325], [-675, 325]] },   // the walkable outline: an L here; or a box { x0, x1, z0, z1 } or a circle
  heightAt,                                  // from compose(); heightAt.steep(bounds, { maxSlope }) and .reach(start, …) check it
  biome: { kind: 'alpine', treeLine: 116, snowLine: 134 },   // or just 'alpine' | 'coast' | 'heath' | 'bocage' | 'limestone' ('tuscan' / none: today's)
  roads: [{ id: 'valley', kind: 'road', width: 5, path: [[-700, 115], [700, 85]] }, { id: 'alp', kind: 'track', path: [[-100, 100], [150, -200]] }],
  waters: heightAt.waters,                   // or by hand: [{ kind: 'pond', level: 27, area: { x: 370, z: 0, r: 120 } }, { kind: 'river', path, width: 7, from: 93, to: 27 }]
  waterLevel: 0,                             // the old single sheet still works, alone or under `waters` (the sea below)
  wade: 0.9,                                 // how deep you can wade (a body can set its own `wade`)
  hedges: [[[-650, 150], [-200, 150]]],      // bocage: hedge sections along these lines (solid)
  cover: {                                   // built cover (world/cover.js); the site calls buildCover(b)
    walls: [[[-380, 100], [-250, 10], [-150, 40]]],        // dry-stone walls, chest high, gaps where a road crosses
    crates: [[140, -196, 5]],                              // [x, z, how many]
    ruins: [{ x: -235, z: 62, w: 9, d: 6.5, fallen: 1 }],  // a shell with a ladder to boards in its standing corner
    windmills: [{ x: 252, z: 196 }],                       // round stone tower mill: doorway, ladder inside, loft 5.8 m up, a window each way; `face` turns the sails
    grass: [{ x: -520, z: 120, r: 11 }],                   // tall-grass patches where you want them
  },
};
// in the mission's site:
//   const { ladders, perches } = buildCover(b);     // return the ladders in the site's `ladders`; perches: { x, y, z, kind }
```

## Cover (added after the owner asked whether there is enough to hide in)

- What hides you (crouched or prone, as tall grass does): tall-grass patches, and now a biome's reeds, gorse, juniper, marram and the foot of a hedge (`vegetation.js` `inBrush`, filled by `ground.js`). Heather is too low to count.
- Tall-grass patches: 46 on the old maps as before; on a map with `size` or a `biome`, 82 per km² of playable ground times the biome's `cover` (coast 2, heath 2.2, bocage 1.6, limestone 2).
- What you get behind: trunks, boulders, stumps, hedges (already solid), and `cover` walls, crates, ruins, the mill.
- High ground: the mill's loft and each ruin's boards, reached by ladder; plus what the land gives (plateau, cliffBand top, quarry rim, embankment).
- `tools/landforms-sample.js` reports it (`cover`, `perches`). On the sample valley, share of dry playable ground with some cover within reach (a hiding place within 15 m, a trunk or boulder within 8 m, or built cover within 12 m): alpine 83%, heath 74%, bocage 39%. Bocage is thin because the sample has only five hedge lines: a real bocage map needs a hedge round every field.

- Queries: `terrain.js` `waterAt(x, z)` (surface or null), `waterSurfaceAt`, `waterBodyAt`, `nearestRoad(x, z)` → `{ id, kind, width, d, on, x, z, t, dx, dz }`, `roadList()`, `inPlayArea`, `clampToPlay`, `MAP_HALF_X/Z`, `PLAY_HALF_X/Z`; `world.waterHere(x, z)` → `{ level, wade }`, `world.waterAt`.
- Built cover: `cover.js` `buildCover(b)`, `stoneWall`, `windmill`, `ruin`.
- Pieces in `landforms.js`: ridge, valley, terraces, cliffBand, ravine, plateau, riverBed, lakeBasin, marshFlat, quarry, sunkenLane, ditch, embankment (`cut: true` for a railway cutting), roadBed, coast, rim; `rolling` for the base; `region`, `makePath`, `locator`, `pointAt`, `fall`, `steep`, `reach`.
- A map with its own `forest` or `ground` keeps them; the biome then only supplies what the map doesn't say (ground colours, grass). Biome counts are per km².
- A full worked map: `tools/landforms-sample-map.js`. Render it: `npx vite --port 5183 --strictPort`, then `node tools/landforms-sheet.mjs [url] [out.jpg] [biome]`.

## Not done, for whoever wires a mission to it

- `src/ai/nav.js` and `src/mission/approaches.js` still read only `world.waterLevel` (the sheet): guards will route through a pond or river of `waters`, and starts can land in one. They should ask `world.waterAt(x, z)`. Both files were off limits here.
- `src/ui/map.js` and the guards' grid still think in squares: on a 1400 × 700 map they get the longer half (`MAP_HALF` = 700), so the paper map shows the land with empty bands north and south. `seashore.js` likewise scans the square.
- `roadCenterZ(x)` on a map with `roads` answers for the first road only, and only where that road crosses the x asked for. The truck and car patrol still drive that one road.
- The cover numbers come from the sample page, not from play: nobody has yet crouched behind one of these walls or climbed the mill in the game itself. Guards don't know the perches (a mission must post a look-out there itself).
- No minefield border: borders are land (ridge, cliffBand, rim) or water (coast, a lake).
- Only the alpine biome was looked at closely. Coast, heath, bocage and limestone build and look different from each other, but their counts and colours were set once and want tuning on the mission that uses them (heather is only drawn within 110 m, so far heath reads as pale grass).
- The new trees (larch, birch) carry no `_snow` attribute, like the fir, beech and olive. Their far cards show a few dark patches (seen in the Blender preview).
- The player wades and is stopped by `waters` (player.js, camera-rig.js, driving.js ask `world.waterHere`), but this was exercised only through the sample page and the unit tests, not by walking it in the game.
- `main.js` loads a biome's trees and `ground_biome.glb` only for a map that asks for them (`plantProps(map)`).
