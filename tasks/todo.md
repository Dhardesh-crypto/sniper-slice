# Sniper Slice: a Sniper Elite 5-style vertical slice (three.js)

One mission on one small open map, playable in the browser. The goal is the *feel*: a scope
that breathes, a bullet that drops and drifts, an X-ray kill cam that rewards a good shot,
and guards who hear and hunt you.

## Stack
- three.js r186 + Vite (npm), plain JavaScript ES modules. `npm run dev` → play at localhost.
- All geometry built in code (low-poly, stylised Italian countryside, SE5's tone). No paid assets.
- Sound synthesised with WebAudio: gunshot, suppressed pistol, footsteps, wind, planes, siren.
- Skills: threejs-scene-setup, threejs-materials-lighting, fps-shooter, game-ai, camera-systems, game-feel.

## The mission
Map of about 500 × 500 m: hills, vineyards, tall grass, a road, and a walled farmhouse compound
with two watchtowers, a generator shed and an airfield edge where planes take off every ~90 s.
**Target:** a German officer who walks a routine between the villa, the terrace and the radio
truck. **Optional:** sabotage the radio truck. **Exit:** reach the extraction point at the river.
Fail when you're killed. Mission end screen shows shots, accuracy, longest shot, and detections.

## Phase 1: Foundation
- [x] Vite project, renderer, resize, Timer loop, fixed-step simulation (60 Hz) apart from rendering
- [x] Terrain from a heightmap (noise + hand-placed hills), sky, fog, sun with shadows
- [x] First-person controller: walk / sprint / crouch / prone, pointer lock, gravity on terrain
- [x] Settings: mouse sensitivity, FOV, invert Y
- **Check:** walk the map at 30 and 144 fps; movement speed and look feel identical

## Phase 2: Ballistics and scope (the heart of it)
- [x] Bullet as a simulated projectile: muzzle velocity ~800 m/s, gravity, air drag, wind drift, sub-stepped ray per tick so it never tunnels
- [x] Wind: direction + strength per mission, shown by grass/flag sway and a HUD indicator
- [x] Scope: two zoom levels (4× / 8×) via FOV, mil-dot reticle overlay, vignette, zeroing 100–500 m in 50 m steps
- [x] Sway driven by heart rate (sprinting raises it, resting lowers it), stance (prone steadiest)
- [x] Hold breath (Shift): sway drops, "empty lung" marker shows where the bullet will land; limited breath meter
- [x] Binoculars to tag enemies and read range
- [x] Rifle: bolt-action, 5-round magazine, recoil kick + scope settle; suppressed pistol for close work
- [x] Hit zones: head, torso, limbs; head = kill, torso by distance/organ
- **Check:** shots at 100 / 300 / 500 m land on the predicted point when zeroed correctly; a shooting-range debug toggle shows the bullet's path

## Feel pass (requested after Phase 2)
- [x] Third-person character like SE5: over-the-shoulder camera with collision while moving; the rifle scope and binoculars switch to first person; the pistol aims over the shoulder
- [x] Animated low-poly player (walk, sprint, crouch, prone crawl, holding rifle/pistol)
- [x] Third-person shots leave the muzzle toward the point under the crosshair
- [x] Less scope sway (~45% less)
- [x] Heavier recoil (bigger kick, roll, scope jolt) and a visible bolt cycle in the scope
- [x] Easier ballistics: faster, flatter bullet, wind effect scaled to 60%, empty-lung marker visible whenever scoped (setting: always / holding breath / off)
- [x] Punchier hits: meatier hit sounds, bigger dust and blood, stronger hit marker, harder fall, short slow-mo on kills
- **Check:** walk/crouch/prone in third person, camera never ends up inside walls or terrain, all range shots still verified

## Phase 3: X-ray kill cam
- [x] Trigger rules: headshot, long range (>150 m), or organ hit, with a cooldown so it doesn't play every kill
- [x] Bullet-follow camera: slow-motion (time scale ~0.05), camera chases the bullet with smoothing, slight orbit
- [x] X-ray reveal on impact: enemy body goes translucent, skeleton + organs (skull, ribs, heart, lungs, liver, spine) visible via a fresnel see-through shader
- [x] Damage shown on the X-ray: bone fractures, organ rupture marks, exit path
- [x] Skip with a click; setting for "always / sometimes / off"
- **Check:** kill cam plays smoothly at 60 fps and returns control cleanly with no camera jump

## Graphics pass (requested after Phase 3)
Goal: far smoother, less blocky visuals, with real animated characters.

Characters (Higgsfield → Meshy, ~144 credits of 220):
- [x] Concept art for each character in an A-pose, no weapon in hand (generate_image)
- [x] Player sniper (Allied) and German guard: textured, PBR, auto-rigged GLB (44 each)
- [x] Animation clips made once and shared across both rigs (8 each): idle, walk, rifle sprint, crouch walk, crawl (backward clip played in reverse), shot-and-fall forward, shot-and-fall backward
- [x] Officer: guard model with a peaked cap and lighter tunic tint (no extra credits), or a third model (+44)
- [x] Rifle: keep the procedural model, smoothed (or a generated one, +25), attached to the right-hand bone
- [x] Load with GLTFLoader + AnimationMixer, cross-fade clips by speed/stance, death clips replace the tilt fall; hit zones follow the skinned bones; the X-ray skeleton/organs attach to bones

Rendering (code only, no credits):
- [x] Post-processing: SMAA, ambient occlusion (GTAO), gentle bloom, colour grade and vignette
- [x] Cascaded shadow maps so shadows reach far without blur
- [x] Smooth-shaded, higher-detail trees; textured terrain, plaster, stone and roof tiles (procedural textures)
- [x] Denser grass close to the camera
- **Check:** before/after screenshots of the same views; ≥60 fps; X-ray kill cam still lines up with the new bodies

## Map and supplies (requested after the graphics pass)
- [x] Full-screen map (M): drawn from the terrain (colours, hill shading, 5 m / 25 m contours), road, buildings, trees, tall-grass cover, A–H × 1–8 grid; shows you, tagged enemies, bodies (filled = still to search), waypoint; pauses the game; click sets a waypoint, right-click clears, M closes, Esc goes to the menu
- [x] Waypoint marker in the world with distance; pinned to the minimap rim when off-screen
- [x] Rotating minimap (bottom-left, 110 m radius, N/E/S/W rim)
- [x] Search bodies (hold E, 1.1 s, crouching over the body): guards carry 3–7 rifle rounds and sometimes 2–5 pistol rounds; officers 6–10 pistol rounds and papers (intel for Phase 6). Reserves cap at 40 rifle / 32 pistol. Range dummies can't be searched; a body can only be searched once
- **Verified:** map opens with markers and grid reference ("You are in C6"); killed the west gate guard, walked to him, searched: +6 rifle rounds, stance restored, second search gives nothing

## Visual polish (requested after map and supplies)
- [x] Map edge: rolling, uneven hills with drier grass up the slopes and rock only on steep ground (no more brown walls)
- [x] Horizon: three rings of distant ridgelines (900 / 1500 / 2300 m), each hazier, so the valley sits in a wider landscape
- [x] Sky: the Sky shader's own drifting clouds (slowed after feedback: ~0.03 noise units/s), lower warmer late-afternoon sun (~24°)
- [x] Both hands on the rifle: two-bone IK pulls the left hand onto the fore-end (the farthest point the arm can reach), elbow bent down and out; carries: port (player), low ready (alert guards), prone (forward)
- [x] Guard poses: 'alert' (gate and tower guards: legs idle, rifle at low ready in both hands) and 'easy' (yard/barn guards and range dummies: full relaxed idle, rifle slung upright beside the right shoulder). Player with the pistol out slings the rifle the same way
- [x] Fixed: character culling sphere was in the wrong units (the mesh node is in centimetres), which hid bodies from some angles
- [x] Distant soldiers (>120 m) animate a third as often
- Frame cost now (background pane, 2×): high 17.8 / medium 14.7 / low 5 ms to draw, ~4 ms game logic
- Fixed after feedback ("holds the gun really weird after a shot"): the spine-bend and forearm-twist hacks (wrong bone axes on the Meshy rig) are gone. After a shot or while aiming in third person the rifle is shouldered: butt in the right shoulder pocket, barrel exactly along the line of sight, right hand on the grip and left hand on the fore-end by IK, with a small kick on recoil and while working the bolt. Reloading, sprinting and prone keep the carry poses
- Fixed after feedback ("butt sticking forward, barrel pointing backwards"): the rifle model's muzzle end had been flipped on a misread screenshot. Now set from the mesh itself (the barrel end is 2 cm thick, the stock 20 cm) and verified on geometry in every pose: idle/walk carry, shouldered after a shot (barrel on the line of sight), prone, alert guard, slung
- Not done: the left hand rests up to ~8–13 cm from the rifle when the arm can't reach further (the generated arms are short for a long rifle)

## Binocular zoom (requested)
- [x] Binoculars zoom like the scope: mouse wheel steps 4× (7.5°) ↔ 8× (3.5°) with the same smooth zoom; the mil scale redraws for each level; "4× / 8× BINOCULARS" shown at the bottom; the scope keeps its own zoom setting
- **Verified:** B opens at 4×, wheel in → 8× (FOV 3.50°), extra wheel stays at 8×, scope zoom untouched

## Phase 4: Stealth and sound masking
- [x] Player noise radius from stance and speed (prone ≈ silent, sprint loud)
- [x] Visibility from stance, distance, light, and cover (tall grass/bushes hide you when crouched/prone)
- [x] Gunshot noise: rifle ~400 m radius, suppressed pistol ~10 m
- [x] Sound masking: generator (constant, local), plane takeoffs (periodic), artillery barrage (timed). Shooting while masked shrinks the gunshot radius; a HUD icon shows when you are masked
- [x] Bodies: guards who find a body raise suspicion/alarm; carry and hide bodies in grass (searched bodies are still bodies)
- **Check:** a masked shot near the airfield doesn't alert the compound; an unmasked one does

## Phase 5: Enemy AI and alarms
- [x] Guard FSM: Patrol → Suspicious (investigate noise / glimpse) → Search (last known position, spread out) → Combat → back to Patrol with raised wariness
- [x] Vision cones with a detection meter per guard (fills faster when close / in the open), shown as on-screen arrows (Phase 4)
- [x] Hearing: react to player noise and gunshots; gunshot direction is estimated, not perfect, from far away (Phase 4)
- [x] A* on a grid over the map, cached paths, repath on a timer; ~~guards climb watchtower ladders~~ (tower guards hold their platforms instead)
- [x] Alarm: a guard in combat runs to the siren post; siren = whole compound alerted + 4 reinforcements arrive by truck. Disable the siren by cutting its wire
- [x] Combat: guards take cover, fire with reaction delay and distance-based inaccuracy
- **Check:** watch guards with a debug overlay (state + path + vision cone); no guard stuck >5 s

## Phase 6: Mission, HUD, feel
- [x] Objectives, target routine, radio sabotage, extraction trigger, end screen
- [x] HUD: ammo, breath, heart rate, stance, masking icon, detection arrows, compass with tags
- [x] Game feel: recoil, scope shake on shot, hit confirm sound, ~~ragdoll-style fall~~ (shot-and-fall clips), dust/blood puffs
- [x] Ambient audio: wind, birds, distant artillery; no bell-like sounds
- [x] Main menu, pause, restart
- **Check:** play the mission start to finish, both quietly and loudly, in the browser pane

## Out of scope for the first version
Multiple missions, upgrades and weapon workbench, traps/mines, climbing anywhere, story cutscenes, multiplayer.

## Review

### Phases 1–2 (done, 2026-10-24)
Run: `nvm use` (Node 22.19; Vite 8 won't run on the system Node 20.1), `npm install`, `npm run dev`, open the URL.
`npm test` runs the ballistics tests. `window.game.advance(seconds, fps)` steps the game synchronously for testing.

Verified:
- Ballistics (unit tests): with a 100 m zero the bullet drops 0.49 m at 300 m and 1.97 m at 500 m; 0.77 s flight to 500 m, arriving at 543 m/s; a 4 m/s crosswind drifts it 0.54 m at 500 m.
- In game, zeroed to each target's range and holding breath: torso hits at 100/200/300/500 m; the 400 m shot missed 40 cm downwind because of the ~3 m/s crosswind (as intended). The empty-lung marker predicted each impact within 0.4–3.4 cm.
- Prone breath-held headshot at 200 m; pistol hits torso 3/3 at 20 m; reload, weapon switch, sprint (heart rate 96 → 160 bpm), prone, wall collision.
- Binocular range readout and tagging (a cone plus a line-of-sight check: the officer is correctly not taggable while hidden behind the radio truck).
- Same movement at 30, 60 and 144 fps (fixed 60 Hz step; 144 fps within 5 cm).
- World render ~2 ms (425 draw calls, ~950k triangles) at 1024×768 @2×.

### Feel pass (done, 2026-10-24)
- Third person: an animated low-poly player (walk, sprint, crouch, prone crawl, rifle at port arms or slung, pistol in hand). The over-the-shoulder camera has a collision arm: with your back to the compound wall it pulls in to 0.6 m and stays outside the wall. The body hides when the camera is that close. The rifle scope and binoculars blend to the eye; the pistol aims over the shoulder.
- Third-person shots leave the muzzle toward the point under the crosshair (7 cm error at 100 m with spread off). Hip fire hit 5/6 at 100 m; the pistol over the shoulder hit 4/4 at 20 m.
- Sway is about half (≈3 mrad standing). Without holding breath, standing shots beyond 100 m miss by up to ~1 m; holding breath hit 5/5 (one an arm hit at 400 m). The landing marker now shows whenever scoped (setting: whenever scoped / holding breath / off) and was within 13 cm of every impact.
- Flatter bullet: 850 m/s and less drag, so it drops 1.52 m at 500 m with a 100 m zero; bullets feel 60% of the displayed wind.
- Recoil is ~1.7× bigger, with roll and shake. The bolt (1.4 s) visibly moves the scope.
- Meatier hit and impact sounds, bigger dust and blood (with exit spray), muzzle flash and smoke, a bigger hit marker that pops (red and longer for kills), bodies knocked back. Kills drop to ~0.25× speed for about half a second.

### Steady scope (2026-10-24)
- The scope no longer sways at rest (measured 0 mrad at 74 bpm), as in Sniper Elite. Sway only appears above ~100 bpm: 2.6 mrad right after a 4 s sprint (131 bpm), gone again within 9 s.
- Standing, not holding breath: torso kills at 100–400 m within 1–11 cm of the chest; at 500 m the wind pushed it 21 cm into the arm.

### Phase 3: X-ray kill cam (done, 2026-10-24)
- Each shot is pre-simulated at the trigger pull. A lethal, worthy shot is handed to the kill cam instead of the live bullet sim, and the hit is applied at the moment of impact.
- Choreography: ride the bullet (1.2–2.6 s by range), swing round to the side (0.6 s), X-ray (1.9 s) as the bullet passes through, then the fall at half speed (1.3 s). The world runs at 2–3% speed during the flight. The side is chosen for a clear view of the target.
- X-ray: the world is washed dark blue; the body turns into a fresnel ghost, with a skeleton (skull, jaw, spine, ribs, sternum, collarbones, shoulder blades, pelvis, limb bones) and organs (brain, heart, lungs, liver, stomach, kidneys, gut). Bones crack and organs rupture in the order the bullet reaches them, with fragments and sounds. Kit and the slung rifle hide.
- Afterwards the message names what was hit, e.g. "HEADSHOT · SKULL · BRAIN · 201 m", "HEART · LUNG · 301 m".
- Setting: sometimes (default: headshots, chest/pelvis or 150 m+ kills, at least 6 s apart, long or head shots always, others 50%) / every kill / off. In "sometimes" mode 5 of 12 ordinary 100 m chest kills got a cam. Click or Space skips; the skip click doesn't fire a round.
- Verified: 300 m chest (heart, lung, ribs), 200 m headshot, a pistol headshot at 14 m from third person, a 265 m compound guard (lungs, heart, ribs, spine), skip, return to the scope afterwards. X-ray frame ~2.9 ms.
- Anatomy is attached to the soldier's body group, so it follows the fall; when Phase 5 animates limbs, attach limb bones to their limb parts.

### Graphics pass (done, 2026-10-24)
Higgsfield: 168.5 credits used (220 → 52). Downloads live in models-src/ (ignored by git); `npm run models` prepares public/models/ (WebP 1024 textures; animation files stripped to skeleton + clip), 6 MB total.
- Characters: player sniper and German guard from concept art (gpt_image_2_5) → Meshy 7 image-to-3D, textured, PBR, auto-rigged (identical 24-bone skeletons). Clips (shared by both): idle, casual walk, rifle charge (sprint), cautious crouch walk, crawl (backward clip played reversed), shot-and-fall forward/backward. Rifle: Meshy 6 text-to-3D.
- Meshy's idle stands side-on; its hip, spine and neck twist is stripped in code so characters face where they look.
- Arms hold the rifle on a separate layer (a frozen frame of the sprint clip) over leg-only idle/walk/crouch; the rifle sits in the right hand at a fixed port-arms angle (the clips' left hand doesn't line up with a rifle).
- Hit zones are invisible capsules on the bones, so hits follow the animation: chest kills 100–500 m, headshots to 300 m (400/500 m missed in the wind, as before).
- X-ray: anatomy rides the bone frames; the ghost is the real skinned body. Verified at 200 m: ribs, heart, lungs.
- Guards die with shot-and-fall-forward/backward depending on the bullet's direction; officers are the guard model in a lighter tunic, no rifle.
- Rendering: post chain (4× MSAA HDR, GTAO, bloom above sky brightness, warm grade + vignette), procedural plaster/stone/roof-tile/wood/ground textures with normal maps at world scale, leaf-card tree crowns, dense shader-placed grass in an 80 m window around the player.
- Graphics setting: high / medium (default) / low. Frame cost in the (background) pane at 2× pixel ratio: 14.4 / 11.8 / 3.6 ms.
- Not done: the distant mountain walls still look flat; the player's left hand doesn't touch the rifle; guards don't hold rifles naturally while idle (same port-arms carry).

### Phase 4: Stealth and sound masking (done, 2026-10-24)
- Noise: footsteps by stance and speed (prone 1.2 m, crouch 3.5 m, walk 8 m, sprint 20 m, less when masked); rifle 400 m, pistol 10 m; bullet impacts 14 m; a falling body 9 m. Near shots alert, far shots make guards suspicious with a rough bearing.
- Masking: generator (local, always on), planes crossing the valley every 80–110 s (masked within ~500 m of the flight path), artillery barrages on the far hills every ~2 min (8 booms, each masking for ~1.7 s). A masked shot carries 12% as far (rifle 48 m). HUD: "SOUND MASKED · AIRCRAFT/ARTILLERY/GENERATOR", plus "AIRCRAFT APPROACHING / ARTILLERY INCOMING" a few seconds ahead.
- Sight: 120 m vision cone (55° full, 90° peripheral at 30%), towers see 30% further, alerted guards 30% further and faster; visibility from stance, movement and tall grass (crouched in grass ×0.12, prone ×0.05). Line of sight is raycast a few times a second per guard.
- Awareness: calm → suspicious ("?", at 45%) → alerted ("!"); guards turn toward the news and raise their rifles, calm down after 14 s of quiet (alerted holds 45 s). An alerted guard alerts others within 40 m (shouts don't cascade further; the siren comes in Phase 5).
- Bodies: guards within 45 m and 70° who can see an exposed body become alerted ("A BODY HAS BEEN FOUND"). F drags a body (slow walk, no shooting); dropped or killed in tall grass it's hidden. Map: hidden bodies grey.
- HUD: detection arcs around the crosshair pointing at each guard (white → yellow → red), ?/! over heads, "ENEMIES ALERTED / SUSPICIOUS" top-right, minimap rings for your footsteps (white) and your last shot (red).
- Verified: unmasked shot from the hill → all 7 compound guards suspicious; the same shot under artillery or a plane (48 m) → all calm. Standing in the open at 60 m → spotted in 2.0 s; prone in the open at 60 m → never; dragged a body 72 m into grass → hidden; a tower guard found an exposed body and alerted the two guards within 40 m only. Stealth costs <0.1 ms per frame.
- Known: some leaf cards on umbrella pines show as pale squares up close.

Notes for later phases:
- Tower guards stand dead centre and hide behind a corner post when seen from the start hill: offset them when they get patrol routes.
- Real mouse play (pointer lock) has not been tested by me; the browser pane runs hidden, so the tests drive input through `window.game`.

### Extra: dropped rifles and climbing (done, 2026-10-24)
- [x] A guard's rifle leaves his hands when he dies, tumbles and lies flat on whatever is below (ground, tower platform)
- [x] Gravity, step-up (0.55 m) and falling for the player; standing on boxes (wall tops, platforms, crates)
- [x] Space: climb onto ledges up to 2.7 m (the compound wall, crates, sandbags, the truck)
- [x] South-west tower: working ladder (W/S climb, Space let go, climb down from the top); railing opening
- [x] North-east tower: a 33-step open stair flight; villa terrace gets steps and a gap in the balustrade
- [x] Climbing and hard landings make noise; no aiming or shooting while climbing; dragged bodies stay on platforms
**Review:** scripted tests: all six rifles came to rest 4 cm above their floor, axis level (towers: on the
platform); ladder up in 4.75 s and back down; stairs up and down; wall climb then drop inside; railing
holds; prone can't climb. No climbing animation yet (walk stride on the ladder, arms free).

### Extra: arrow keys and a real crouch (done, 2026-10-24)
- [x] Arrow keys move like WASD; while aiming ↑/↓ zero the scope (Page Up/Down always)
- [x] Crouch pose lowered with world-space leg IK: head top 1.34 → 0.94 m (under the 1.0 m tower railing), feet planted
- [x] Aiming from a crouch rises to peek over cover (eye 0.85 → 1.2); guards check your head as well as your chest
- [x] No climbing onto railings, posts or roofs overhead
**Review:** behind the west railing of the ladder tower, a guard 45 m away sees a standing player, nothing of a
crouched one, and only the head while peeking to aim.

### Phase 5: Enemy AI and alarms (done, 2026-10-24)
- `src/ai/nav.js`: 1 m grid over 220 × 220 m around the compound from the collision boxes (0.45 m clearance), A* (octile, binary heap, no corner cutting), string-pulled paths; straight lines in the open outside the grid.
- `src/ai/guards.js`: modes post / investigate / search / combat / alarm / flee (officer). Yard and barn guards patrol; tower guards hold their platforms and fire from there. Stuck check (2 s without progress → repath, 3× → give up). F3 draws paths.
- Combat: cover behind boxes ≥ 0.9 m within 16 m that actually hide them from you; duck between shots, rise and shoulder the rifle 1 s before firing. First shot after 0.9–1.6 s (×1.5 beyond 100 m), then every 2.1–3.3 s. Hit chance 0.48·e^(−d/85), ×stance (crouch 0.75, prone 0.5), ×moving (0.75, sprint 0.5), ×0.45 if only your head shows, rising 15% per shot to ×1.6. 24–34 damage; health regenerates after 8 s without hits. Misses throw dust near you and crack past.
- Alarm: the nearest free guard (≤ 90 m) runs to the siren and sounds it after 1.5 s; every guard is alerted toward a rough guess of where you were; a truck with 4 reinforcements comes up the road 12 s later (first alarm only). The siren stops after 60 s without anyone seeing you; wariness +20% per alarm. Hold E at the post to cut the wire: the runner finds it dead and only shouts.
- Player: health bar, red edge when hit, KILLED IN ACTION screen, click to restart (reloads).
- Verified by script: patrols walk their loops; seen at the gate → combat in 4 s, alarm at 8 s, truck unloads 4 at ~36 s, no guard still >1 s while moving (70 s run, 11 guards); wire cut → no alarm, no truck, one "found the siren cut"; after hiding, alarm off at ~60 s and all 11 guards calm and home by 90 s; guards' rifles point along their aim (muzzle 1.4 m ahead of the head). Logic ~1.7 ms per step.
- Not done: guards don't climb ladders; reinforcements stay after the alarm (they get posts in the yard); no grenades or flanking.

### Phase 6: Mission, HUD and feel (done, 2026-10-24)
- Operation Vineyard (`src/mission/mission.js`): kill Oberst Krause, who walks a routine (terrace 25 s → down the steps → his radio at the truck 16 s → yard → generator shed 10 s → terrace). Optional: wreck the field radio (hold E behind the truck; then the alarm can't call the truck) and take his papers (search his body). Then green smoke marks the extraction on the start hill; reaching it ends the mission.
- End screen: time, objectives, kills/headshots, longest kill, accuracy, times spotted, bodies found, alarms, and a rating (GHOST never spotted and no alarm · SHADOW no alarm · SOLDIER one alarm · LOUD more).
- HUD: objectives panel (top-left, below the compass on windows under 1000 px), compass strip with N/E/S/W and markers (target gold, radio blue, extraction green, waypoint, tagged enemies red), on-screen objective diamonds with distance. The target shows as "TARGET AREA" until you tag him with the binoculars.
- Menu: mission briefing; once started it is the pause screen (Esc): the world and the audio stop, "Resume" and "Restart mission". Restart and Play again reload the page.
- Ambience: birdsong (short breathy whistles from band-passed noise, no tones), silenced for 35 s by a gunshot and by the siren.
- Verified by script: quiet run: radio wrecked unseen, Oberst killed at 140 m under a plane/artillery mask with all guards calm, papers taken, extraction reached → MISSION COMPLETE, rating GHOST (0 spotted, 0 alarms). Loud run: spotted at the gate → alarm → truck unloaded (radio intact), Oberst killed while fleeing, extraction → rating SOLDIER. Officer routine checked over 120 s (on and off the terrace). Game frozen behind the menu.
- Not verified: real mouse play with pointer lock (the browser pane runs hidden), so pausing with Esc is untested by hand.

### Extra: weak spots (done, 2026-10-24)
- `src/world/hotspots.js`: siren horn (1 hit: the alarm can't sound, a runner finds it dead), generator (1 hit: its sound cover stops; once things are quiet the nearest calm guard walks over, kneels 8 s and restarts it: a lure), truck engines (1 hit: smoking, the reinforcement truck stalls and they get out on foot; 2 hits: explosion, 6.5 m kill radius, hurts you within 12 m, black smoke and fire for over a minute, the wreck goes black). The radio truck's explosion takes the radio with it (objective done, no reinforcements).
- Explosions alert every guard within 100 m and make the rest suspicious (pointed at the blast, not at you).
- The shot that blows up an engine gets its own kill cam: the bullet ride, then a slow-motion pull-back from the fireball.
- Binoculars tag weak spots too: orange warning triangle with name and hits left, on screen and on the compass.
- Verified by script: siren shot from 60 m; generator shot from 8 m and repaired by the yard guard; radio truck: smoke, then explosion with the kill cam, a guard beside it killed, radio objective done; reinforcement truck: stalled on the road by one shot (troops out on foot), destroyed by the second; tagging the generator and a truck.

### Extra: objectives on the map (done, 2026-10-24)
- Full map (M): target (a dashed search circle until tagged, then a diamond on him), radio, papers (on his body once he's dead), extraction (with its 10 m circle), tagged weak spots; labels stack with leader lines so the compound doesn't turn into a pile of text. Legend extended and wraps on narrow windows.
- Minimap: the same markers; objectives beyond its edge are pinned to the rim in their colour (as the waypoint already was).

### Extra: trackpad-friendly controls (done, 2026-10-24)
- Space fires while aiming (it still climbs when you're not aiming); = / − zoom in and out, V switches 4× / 8× (scope and binoculars).
- Menu setting "Aim (right mouse)": Hold (default) or Click to toggle.
- Verified by script: Space without aiming doesn't fire, while aiming it does; zoom keys on scope and binoculars; toggle aim on, fire with Space, off; Space still climbs the compound wall.

### Extra: concealment indicator (done, 2026-10-24)
- Crouched or prone in tall grass (on the ground, not sprinting): "CONCEALED" with a grass icon above the stance, in green, and a faint green edge to the view (not in the scope, map or kill cam). Standing in tall grass: a dim "IN TALL GRASS · CROUCH TO HIDE".
- Verified by script in a grass patch by the start hill: standing → hint, crouch and prone → concealed with the edge, outside the grass → nothing.
- Concealed look: the body (and rifle) fades to ~45% opacity with a white outline (an inflated back-face copy of the skinned body, 2 cm); a depth-only copy drawn after the opaque scene stops the far side of the body showing through. Eases in and out over ~0.3 s; excluded from the AO pass while see-through. Verified in the grass by the start hill: translucent with the grass visible behind, outline drawn; standing restores the normal body. No measurable frame cost.

### Extra: knife takedowns (done, 2026-10-24)
- Higgsfield (Meshy rigging + library clips, 8 credits each, 16 total; ~36 left): Thrust_Slash on the player model (`anim_takedown_atk`), Strangled_and_Fall_Forward on the guard model (`anim_takedown_vic`). `npm run models` / `node tools/prepare-models.mjs <files>` now takes file names.
- `src/player/takedown.js`: F within 1.7 m of a guard who isn't alerted: from behind (within 70° of his back) always, from the side/front only if he's calm. You slide in 1.45 m behind him (the clip lunges ~0.8 m and its thrust reaches 1.6 m), beat of slow motion, strike at 0.7 s; his clip starts at 2.6 s and plays 1.8× (sag to the knees, fall face down by ~2.5 s). Control returns after the lunge (clip 0–1.25 s at 1.3×) and you're moved to where the lunge left you. Knife mesh in the right hand during it.
- Quiet: 3 m noise at the strike, 2 m for the body (a shot body is 9 m). The AI and stealth ignore a guard being taken down. Counted as a kill and a takedown on the end screen. F prefers a takedown over dragging a body.
- Verified by script: prompt shows behind a calm guard; the barn guard on patrol taken down from behind: nobody heard it (only a tower guard later found the body in the open); you end beside the body, behind and facing him during the move (alignment 0.99 / 1.00). In the open next to the second gate guard you get seen, as you should.

### Fix: concealment really hides you (2026-10-24)
- Concealed (crouched/prone in tall grass): guards can't see you beyond 7 m crouched / 4 m prone (×1.5 while you move). Inside that, a faint glimpse only makes a calm guard wary toward a rough guess (±4 m); he has *spotted* you only with a clear look (detection ≥ 0.3/s) or within 2.5 m. The AI targets, fires and records your position only when spotted. Outside cover nothing changed.
- Verified: alerted guard staring from 15 m (crouched) or 6 m (prone) or 5 m (crouched): never spotted, 0 hits in 20 s; at 2 m he finds you; standing in the grass at 15 m: spotted at once. Standing in the open 60 m from a gate guard: alerted in 2.0 s, as before.

### Extra: ambush takedowns from hiding (done, 2026-10-24)
- Concealed in tall grass (crouched or prone), any guard who hasn't spotted you can be taken down from any side, calm, wary or searching after an alarm, within 2.8 m (1.7 m otherwise). He's spun to face away as you grab him (over the 0.22 s step-in).
- Reaction window: a guard who stumbles onto you in hiding is startled for 1 s ("?", turns to look) before he has spotted you; then he's alerted and can fire. F during the window is an ambush.
- Verified by script: calm guard at 2.2 m: startled, prompt, takedown, no shots; same without F: startled until ~1 s, then spotted and alerted; alerted searching guard 2.4 m in front of you prone in the grass: takedown.
