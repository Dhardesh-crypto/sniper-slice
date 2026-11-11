# Six ideas taken from "The Great Ryftening" write-up: 11 November 2026

Asked for by the owner after reading https://x.com/MindHash777/status/2119841578902491328 (ideas only, none of its code). Kept out of `tasks/todo.md` because another session had that file open.

- [x] **A death cry that carries.** A man shot anywhere but the head cries out as he falls: guards within 40 m come to look (`stealth.js` `deathCry`, `soldier.js` records `deathZone`). Head shots, takedowns, bleeding out and blasts stay quiet. Heard less far under a covering noise. Sound: the existing wounded-man call; there is no cry sample yet.
- [x] **Finds that pay off for good.** One partisan's cache hidden on each mission's map, in the tall-grass patch nearest the garrison that is still 60 m from every guard; not on the paper map. Nine perks, one per mission (`core/perks.js`): soft step, steady hands, deep breath, quick crawl, keen eye, quick hands, sure foot, calm heart, long legs. Kept in the profile.
- [x] **Weapon mastery.** At 10, 25 and 50 kills a weapon earns a part for its kind that you don't own yet (`profile.addKill`, message on the HUD).
- [x] **The escape as its own phase.** Once the pick-ups open (`mission.js` `tickEscape`): leave unheard and nothing changes. If the siren sounds or an alarm is raised, the pick-up nearest the garrison closes, more men are sent for after 40 s, and after 75 s the partisans open a last way out on the side furthest from the guards. The debrief has an Escape row.
- [x] **Recon by day, the shot at dusk.** A mission can say `def.evening: { at: seconds }`. On a run that began in its briefed daylight, a minute's warning, then a short fade: the light becomes the game's own dusk (`conditions.js` `duskOf`, `world.relight`), guards see a quarter less far, the searchlights and torches are lit. Vineyard is the pilot (seven minutes in). Other missions: add the one line to their def.
- [x] **An intro fly-over.** Fifteen seconds over the mission's own land from behind your start to the target, three captions, any key skips (`ui/flyover.js`). On a new mission only, not a loaded game; `?nofly` in the address leaves it out.

Checked headless on Vineyard (muted): fly-over runs and hides the HUD; the cache is 258 m from the start and 76 m from the nearest guard; mastery gave two scopes at 10 and 25 kills; a torso kill cried and a head shot did not; the alarm during the escape closed PICK-UP · NORTH, sent the truck and opened the partisans' way out; evening took sight from 1 to 0.75, the sun from 2.8 to 1.26, and lit 2 searchlights and 3 torches. Picture: `tasks/ideas-flyover-day-dusk.jpg`.

Not done or not checked:
- Nothing was played by hand. The death-cry check could not separate the cry from guards simply seeing the man fall (they were 12-21 m away).
- Perks are wired for all nine missions but only Vineyard's cache was looked at.
- Evening is on Vineyard only. The far hills and the sky's clouds are not re-made at nightfall (the far country keeps its day picture under dusk light).
- The escape closes a pick-up and calls men in; it does not yet spread the alarm zone by zone (zones are not built).
- The fly-over shows guards where they stand at the start.
