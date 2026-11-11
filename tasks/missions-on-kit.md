# All nine missions on the terrain kit: 11 November 2026

Asked for by the owner: "all missions improved like the forest… after each improvement push and deploy". Each mission kept its site where it was (buildings, men, routes, boxes) and got new land, cover and high ground round it; each was checked headless, smoked, committed, pushed and deployed on its own.

| Mission | Commit | What it got |
|---|---|---|
| Forest | 126264e | a stream down a ravine through a bog to a lake, a scarp north of the lodge with a ruined chapel looking down a felled strip, two more ruins, walls, tracks, reeds |
| Vineyard | 722b3a2 | a windmill on a knoll due north of the compound (the 190 m shot), terraces, a ruined farmstead, a sunken lane, a pond, field walls |
| Bridge | 2637365 | alpine biome (larch, fir, scree, snow), a customs post on a knoll with a strip felled toward the bridge, a sunken lane to the west gully, a tarn, a shepherd's hut |
| Harbour | d32a58f | a bluff over the docks with a ruined house, a windmill on the hill behind, terraces, dunes with marram, a salt marsh |
| Radar | 38f500f | coast biome (gorse, heather), a windmill over the station, a sunken lane inland from the gully, a dew pond, two ruins |
| Railway | 2eb6e38 | bocage biome with hedges in rows, two sunken lanes, a windmill over the junction, a pond, a ruined farm |
| Airfield | 89c9b32 | heath biome, reed-lined ditches along the wire, a marsh, a windmill, a sunken lane, a ruined farm |
| Flak | d73f1ef | limestone biome, a scar that enfilades the fire trench, a quarry, a chapel on a knoll, a sunken lane, ten more shell holes |
| Town | (this commit) | a river down the valley, a windmill across it facing the east wall, terraces, a sunken lane to the east gate, a ruined farm |

Each mission's check (`forest.mjs` in the session scratchpad, not in the repo): nobody and nothing standing in water, every man, box, pick-up and ladder foot reachable on foot from the start under the map's own slope and wading limits, a guard's route found to the new places inside the guards' map, six pictures looked at. Sheets: `tasks/<mission>-rebuilt.jpg`.

Also changed on the way: guards' routes and starting points keep out of ponds and deep water (`nav.js`, `approaches.js`); `riverBed` banks widen with the depth of the cut; a biome's woods can be thinned (`biome: { kind, density }`).

Not done or not checked:
- Nothing was played by hand: no wall crouched behind, no mill climbed, no river waded in the game itself.
- The maps are still the same size and square; no mission is long or L-shaped yet, and none has zones.
- The guards' route map does not know hedges (Railway): a guard on a search may walk into one.
- Guards are not posted on the new perches and don't use them; the new places are yours alone.
- Places beyond each mission's guard map (`navHalf`) can't be reached by guards at all: the Forest lake, the Airfield mill, the Flak scar. That limit was there before.
- Evening falls on Vineyard only.
- The walk test ignores trees, hedges and walls; the white bands in Airfield pictures are that mission's own ground mist.
