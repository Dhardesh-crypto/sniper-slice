# Zones and alarms: 11 November 2026

Asked for by the owner ("Zones and alarms"), from section 1 of the approved plan. Kept out of `tasks/todo.md` because another session had that file open.

A mission's garrison is now in several places, each with its own men and its own telephone line (`src/mission/zones.js`; the alarm in `src/ai/guards.js`). A map declares `zones: [{ id, name, x, z, r, phone? }]`; a map without them is as before.

- [x] The siren wakes the place the alarm was raised over and the place the siren stands in. The places within earshot (220 m between their edges) send two men each and the rest of theirs stand to. The others hear nothing.
- [x] Twenty seconds later it is telephoned round and the whole garrison knows, as it used to at once.
- [x] Each place has its line on a pole with a grey box (hold E: "cut the telephone line"). A place whose line is cut is never telephoned and can't telephone: an alarm raised there stays there. A wrecked radio, or the Town's own line at the crossroads, cuts them all. Cut lines are kept in a saved game (mission flags).
- [x] The poles are on the paper map, the compass and the on-screen markers ("TELEPHONE · THE LODGE") until cut.
- [x] The briefing names the places and says how the alarm travels.
- [x] Zones on Forest (lodge, camp, meadow), Town (town, farm, crossroads, lookout), Harbour (quay, depot, mole), Bridge (camp, west bridgehead, east checkpoint), Radar (radar site, west battery, lighthouse), Airfield (apron, radar, gate, west dispersal), Flak (battery, west trench, east trench).

Checked headless, in the game:
- Forest, alarm over the meadow: meadow 1/1 and camp 8/8 (the siren's place) come, the lodge sends 2 of 8 and 6 stand to; after 24 s the lodge is 8/8. With the meadow's line cut (by the lever, as a player would): never telephoned, "the line is dead", the lodge's six calm down.
- The other six: men per zone, a pole placed in every zone, the same pattern at the siren and after the call (Airfield's gate, out of earshot of the west dispersal, hears nothing until the call).
- Unit tests for who is woken, sent, telephoned and deaf.

Not done:
- Vineyard (one compound) and Railway (no siren on that map, so no alarm ever sounds there) have no zones.
- No route grid per zone, no starts per zone edge, no locked starts, no slow tick for far guards (the rest of the plan's section 1).
- The escape phase still closes one pick-up for the whole map, not per zone.
- Not played by hand.
