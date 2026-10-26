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

### Performance pass (done, 2026-10-24)
- Measured on a full-screen MacBook size (1512×945): GPU frame time High 26–43 ms, Medium 16–33 ms, Low 6–12 ms (this pane is noisy). Game logic ~3 ms. The cost is pixels (High renders 2× = ~6 Mpx with 4× MSAA), ambient occlusion (~16 ms at High) and bloom (~7 ms); the scene is 2.3 M visible triangles (grass 350k, terrain 320k, trees ~600k drawn for shadow, AO and image). Recent features add nothing steady.
- AO and bloom now run at half the render size (bloom blurs at a quarter): High 43 → 37 ms, Medium 33 → 28 ms in the same conditions; no visible change.
- Shadow map redrawn every other frame (~2 ms saved).
- Resolution scaler: the graphics setting is now a ceiling; while you play, average frame time over 1.5 s above 19 ms drops the render scale by 0.25 (down to 1×, 0.75× on Low), below 14 ms twice in a row raises it back. Paused behind the menu or map it holds; single hitches are ignored. F3 shows the current scale.

## Phase 7: Items, explosives, ammo and saving (done 2026-10-25)
Keys in use: WASD/arrows, Shift, C, Z, Space, B, R, 1, 2, M, E, F, T, V, = / −, F3, Esc, Page Up/Down.
New: **Q** (hold) item wheel · **G** use/throw/place the selected item · **H** heal · **X** switch rifle ammo · **K** detonate TNT.

1. **Inventory and item wheel**
   - [x] Inventory: bandages, medkits, grenades, bottles, mines, TNT, satchels, rifle ammo by type. Start loadout, more from searching bodies (and ammo crates).
   - [x] Hold Q: radial wheel, time slows (SE5); pick an item; G uses it. HUD shows the selected item and count.
2. **Healing**
   - [x] Health comes back on its own only up to the next quarter (25/50/75/100), not all the way.
   - [x] H: bandage (+35, 1.5 s, you can't shoot while bandaging) or a medkit (full, 3 s). Taking a hit interrupts.
3. **Throwables** (hold G to aim with a dotted arc, release to throw)
   - [x] Grenade: bounces, 4 s fuse, 5 m kill radius, loud; guards nearby dive or run.
   - [x] Bottle: shatters where it lands; guards hear it (25 m) and go to investigate, a distraction.
4. **Whistle** (a wheel item, unlimited)
   - [x] A noise around you (30 m) that brings the nearest guard to investigate: lure him into a trap or a takedown.
5. **Traps**
   - [x] Mine: placed at your feet; a guard (or a vehicle) stepping on it sets it off. Shown on the map.
   - [x] TNT: placed anywhere, detonated with K (remote) or by a shot; bigger blast.
   - [x] Guards can spot a mine or TNT in the open and become suspicious.
6. **Ammo types** (X cycles)
   - [x] Standard: as now.
   - [x] Subsonic (suppressed): heard at 40 m instead of 400 m, slower and drops more, less damage at range.
   - [x] Armour-piercing: goes through engine blocks and a tank's grille: one AP shot to an engine counts as two.
7. **Vehicles and satchels**
   - [x] A staff car (Kübelwagen) parked by the villa, with an engine weak spot.
   - [x] A Panzer IV parked in the yard: turret turns toward alerts and fires a shell at you if it spots you (lethal blast). Only a satchel on its engine deck or AP rounds into its grille can destroy it. Optional objective "Destroy the Panzer".
   - [x] Satchel: placed on a vehicle (or anywhere), 10 s fuse or K to detonate; wrecks any vehicle.
8. **Save and load**
   - [x] What's saved: player (position, stance, health, inventory, ammo), every soldier (alive or dead, position, pose, awareness, searched/hidden), weak spots and vehicles, traps placed, alarm, siren and radio state, mission objectives, stats and time, masking timers, waypoint.
   - [x] Manual saves in 3 slots from the pause menu, plus an autosave at each objective. No manual saving while guards are in combat with you (as SE5).
   - [x] Load from the pause menu or the main menu; restore rebuilds the world from the save (dead soldiers lie where they fell). Versioned JSON in localStorage, written atomically.
**Check:** script each item; full mission with a save mid-way, reload, finish; save/load round-trips compared field by field.

### Phase 7 review (2026-10-25)
- Panzer: Higgsfield `sam_3_3d` from a gpt_image_2_5 reference (1.25 credits; the textured Meshy route was 38, more than the balance). One mesh, 29k triangles; the turret and gun are cut out at load by where triangles sit (above the deck at y 0.08, inside the turret ring, or along the gun), so the turret traverses. Gun end measured from the geometry (+z end is 4 cm wide). Scale 7.5.
- Explosions are one module (`src/fx/explosions.js`): fireball, debris, kill radius (walls block it), hurt radius, noise (close guards alerted toward the blast), burning wrecks, chain reactions to engines and placed charges.
- Not done: guards don't notice placed mines/TNT; the whistle brings every guard within 28 m, not just the nearest; guards don't dive away from grenades; no throwing/placing animation.
- Also fixed: looking toward the sun washed the screen white (the bloom passed the sun's whole ~28,000 brightness); the bloom now takes only what's above 8, capped at 4.
- Verified by script: wheel pick by mouse direction; grenade arc landed 0.5 m from a guard and killed him; bottle and whistle lures (guards investigate); a patrolling guard walked onto a mine; TNT with K killed both gate guards; medkit/bandage, interrupted by a hit, regen only to the next quarter; ammo switching, subsonic heard at 40 m vs 400 m; AP one-shots the staff car; standard rounds ping off the Panzer, 2 AP hits or a satchel (10.5 s) destroy it (objective done); the Panzer turret laid on and fired every 9 s once you were spotted; save → load round trip identical (player, kit, traps, soldiers and their death poses, wrecks, tags, alarm, objectives, waypoint).

### Extra: vehicle models (done, 2026-10-25)
- Higgsfield SAM 3D from gpt_image_2_5 references (about 1.25 credits each, ~4 in total; the first plane prompt was blocked by the image filter and redone without "German"): Opel Blitz (radio truck + reinforcement truck), Kübelwagen (staff car, made 18% narrower: SAM widened it), trimotor transport (the masking plane).
- `src/world/vehicle-models.js` turns each to face +z, scales it to its real length, sits it on the ground. Fronts measured from the geometry (truck: the low bonnet end; car: the windscreen end; plane: the tall fin is the tail; engine noses found as the frontmost points on the centre line and 18% out on each wing).
- Invisible blocks fitted to each model do collision, bullets, nav and the engine weak spots; wrecks blacken the model. The reinforcement truck bounces, pitches and rolls on the road and throws up dust from the rear wheels; the plane's three propellers spin.
- Verified: sizes 2.4 × 2.8 × 6.0 m (truck), 1.6 × 1.6 × 3.6 m (car), 26.6 m span × 19.1 m (plane); flyover nose along the flight path; reinforcement truck drives, stalls on one hit, explodes on two; radio truck and staff car explode and blacken; radio objective still completes.

## Phase 8: Weapon upgrades, parts, loadout and workbenches (done 2026-10-25)
Upgrades change four things you can feel: **reach** (bullet speed, so less drop and wind; zoom), **stability**
(sway, breath, recoil), **noise** (how far a shot is heard) and **shot quality** (damage, accuracy).

1. **Parts** (per weapon; each slot has a stock part and two upgrades)
   - [x] Scope: Standard 4–8× · Marksman 4–10× (less sway) · Long-range 6–12× (steadiest, slower to raise)
   - [x] Barrel: Standard · Heavy (+12% bullet speed, less recoil, heavier) · Match (+20% speed, tighter spread, more damage at range)
   - [x] Muzzle: None · Suppressor (rifle heard at 120 m instead of 400, subsonic 15; −5% speed) · Muzzle brake (much less recoil, faster bolt; louder)
   - [x] Magazine: 5 rounds · 8 (extended) · 10 (large; slower reload)
   - [x] Stock: Standard · Cheek-rest (less sway, longer breath hold)
   - [x] Pistol: suppressor quality, magazine size, barrel (range)
2. **Collecting** (kept across missions: a profile saved in the browser, separate from mission saves)
   - [x] Parts are found in the mission: locked toolboxes around the compound (barn loft, generator shed, a watchtower, the villa terrace, behind the radio truck) and one on the Oberst. Each gives a part you don't have yet; hold E to open (a little noise).
   - [x] Picked-up parts are yours at once (even if you die), shown on the map and as "PART FOUND · MATCH BARREL".
3. **Loadout** (menu tab, before a mission starts): choose weapons and fit any collected parts; shows each weapon's stats as bars (reach, stability, noise, damage, magazine). During a mission it's read-only: find a workbench.
4. **Workbenches** in the mission (start hill and the barn): hold E to open the same screen with the game paused, to swap parts and weapons.
5. **Saving**: mission saves include the fitted loadout; the profile keeps collected parts.
**Check:** script each part's effect on the numbers (drop at 300 m, sway, noise radius, magazine), toolbox pickups persisting across a reload, loadout locked mid-mission, workbench swap.

### Phase 8 review (2026-10-25)
- Weapons: Springfield M1903, Lee-Enfield No.4, Welrod and Walther P38 at the start; Gewehr 43 (stairs tower), M1 Carbine (west wall crates), De Lisle (behind the barn) found in weapon crates. Noise on SE5's ratios (Kar98k 140 : G43 130 : M1 Carbine lower) on this game's 400 m scale: Springfield 400, G43 370, M1 Carbine 300, De Lisle 20 (built-in silencer; muzzle parts don't fit).
- Higgsfield models (SAM 3D, ~1.25 credits each, 5 weapons ≈ 6 credits): Lee-Enfield, Gewehr 43, M1 Carbine, De Lisle, P38. Muzzle ends measured from the geometry (the thin end), all scaled to real lengths. 16:9 image requests failed on the server; 1:1 worked.
- Parts (`buildWeapon` in defs.js): scope (zoom levels, sway), barrel (speed, recoil, spread, damage), muzzle (suppressor ×0.3 noise / brake ×0.55 recoil, louder), magazine (×1.6 / ×2), stock (sway, breath). Measured at 300 m with a 100 m zero: Springfield drops 39 cm, 24 cm with the match barrel; suppressor 400 → 120 m.
- Profile (`src/core/profile.js`, localStorage `sniper-slice.profile`): owned weapons, found parts, last loadout. Six toolboxes per mission (+ one part on the Oberst) give a random part you don't have; crates give the rare rifles. Kept even if you die or restart.
- Loadout tab (editable before the mission, read-only during) and two workbenches (start, behind the barn) that pause the game. Suppressor or brake visibly on the rifle; the P38 model in hand.
- Verified by script: part effects on the numbers above; toolbox + crate pickups saved to the profile and kept after a reload; workbench switch to the M1 Carbine + heavy barrel (600 → 672 m/s, 15-round mag, model swapped, game paused, profile updated); loadout tab locked once the mission starts; mission saves include the loadout and opened boxes; muzzle forward in the hands.
- Not done: scopes look the same on the model (only the zoom and steadiness change); guards still carry the Springfield; parts aren't per-weapon (any rifle part fits any rifle).

### Extra: supply caches (done, 2026-10-25)
- 16 caches (`src/world/pickups.js`): ammo boxes (rifle, pistol, subsonic, AP rounds), medical boxes (2 bandages, 40% a medkit), explosives crates (2 grenades + a mine, TNT or a satchel), bottle crates (3). Eight in and around the compound, eight in the countryside (road, start hill, fields). They show on your map once you've been within 35 m. If you can't carry any of it, the cache stays closed for later.
- Bodies carry a soldier's kit: rifle rounds, sometimes pistol or special rounds, 35% a grenade, 35% a bandage, 8% a medkit; the Oberst pistol rounds, papers, a part and 50% a medkit. Bottles, mines, TNT and satchels come only from caches. One shared `takeSupplies` applies the carry limits for bodies and caches.
- Saves keep which caches were opened and seen. Verified by script: each cache type's contents; a full kit leaves the cache closed; all 16 placed clear of walls with a walkable side.
- Explosives crates go off when shot (any gun) or caught in another blast, while still full: a satchel-sized blast (6 m kill radius, heavy) that sets off engines within 5.5 m, the Panzer included, plus mines, charges and other crates. Emptied crates are inert. Verified: the crate by the Panzer shot from 30 m killed a guard 3 m away and destroyed the tank (engine 4.6 m away); a grenade 2 m from a full crate set it off; an emptied crate didn't go off. Saves keep destroyed crates.
- Explosives crates can be tagged with the binoculars like the other weak spots: an orange marker "EXPLOSIVES CRATE · 1 hit" on the HUD, compass and map. The tag drops when the crate is blown or emptied. Saves match crates by title in order. Verified: tagged from 30 m, tag gone after the crate blew.
- Vehicle weak spots glow a faint red while you look through the scope or binoculars (truck and staff car engines, the Panzer grille), brighter when the crosshair is on them, so you know where a shot does damage. Only when nothing but the vehicle itself is in the way; gone once the vehicle is destroyed. Verified: truck through binoculars 0.16 → 0.32 under the crosshair, Panzer grille through the scope, staff car behind a wall stays dark, glow off when unscoped.
- The siren horn, the generator and full explosives crates glow the same way. A broken siren or generator (until repaired) and an emptied or blown crate stop glowing. Verified: siren 0.31 under the crosshair and dark once shot; generator 0.31; crate 0.16 off the crosshair.
- Binocular tagging works on anything partly in sight: with the crosshair over a soldier or object, it is tagged if any part shows (every hit zone of a soldier; the middle and corners of an object and its vehicle). Verified: a soldier with only his head over a wall (aiming at his hidden chest), a crate, the generator, the truck and the staff car with their middles hidden; a soldier fully hidden behind a building is not tagged.
- Belt grenades (`src/world/belt-grenades.js`): every other guard (3 of 6, not the Oberst) has a stick grenade at his left hip. Shooting it sets off a grenade blast (5 m) that kills him and anyone close; a blast within 2.5 m sets it off too. Taggable with the binoculars and glows when zoomed in. Searching the body gives you his grenade (bodies no longer give random grenades). Saves keep which are gone. Verified: one shot at 20 m killed the carrier, the guard 7.9 m away lived; a blast 1.5 m away set one off; searching took it (2 → 3 grenades, gone from the belt); save state restored on a fresh page.
- Item wheel icons (`src/ui/item-icons.js`): a drawn line icon per item (stick grenade, wine bottle, whistle, Teller mine, TNT bundle, satchel, bandage roll, medkit), amber when hovered.
- Loadout pictures (`src/ui/weapon-pictures.js`): each weapon rendered side-on from its own 3D model (with a fitted suppressor or brake in the large picture), shown in the weapon list and above the stats; weapons not found yet show as silhouettes. The Welrod got a better model (grip-magazine, trigger guard, bolt knob), used in the hands too.
- Luger P08 (Higgsfield model, `public/models/luger.glb`, muzzle at +x measured): the Oberst wears it in a brown holster at his right hip; searching his body gives it to you for good (profile). 8 rounds, 370 m/s, tighter hip spread than the P38, heard at 125 m; takes the pistol suppressor, barrel and magazine. Pistol models now share one loader (`PISTOLS` spec in characters.js). Verified: search gives it, it equips (8 rounds), points along the aim like the P38, loadout picture renders.
- Weapon sounds (`public/sounds`, 18 clips, 520 KB; ElevenLabs Sound Effects v2 on fal.ai, about $0.18 for 51 takes): a shot per weapon, suppressed shots for bolt rifles, semi-automatics and pistols, the bolt, and a reload per weapon type (stripper clip, G43, M1 Carbine, De Lisle, pistol magazine, Welrod), stretched a little to fit each reload time. Takes were picked from their waveforms (one clean report; reloads with separate steps); the M1 Carbine is the spare Springfield take pitched up 25% and shortened. Guards fire the Springfield sample, duller and later with distance. The synthesised sounds remain as the fallback. Verified: each weapon and suppressor maps to its sample; offline-rendered levels (rifles about -18 dB rms, pistols -21, suppressed -30 to -35); firing in game plays shot, bolt, reload.
- Settings → Testing: a test armoury switch (every weapon and part counts as yours, loadout editable during the mission; your real collection is untouched, and switching it off puts back what you do not own) and a sound check with a button per weapon sample at its game level. Verified: 8 of 8 weapons with 4 really owned; De Lisle + heavy barrel equipped, then back to the Springfield with the test part dropped when switched off; Luger and stripper-clip buttons play their samples.
- Pistol red dot: with a pistol out, the shot is simulated from the muzzle (drop and wind included, every third frame) and the crosshair dot turns red and larger when it would land on a guard where it kills: the head, or any part whose damage is at least his remaining health. Verified at 12 and 25 m: head red, chest and legs white, chest red on a wounded guard at 25 m.
- Animations (9 Meshy clips, 72 credits; root travel taken out in `inPlace`): ladder climb (paced to the climb, reversed going down), hauling up a ledge, throwing (the wind-up held while you aim G, the throw on release; a crouched throw when crouched), placing a mine/TNT/satchel, bandaging and medkits (kneeling, only when standing still), searching a body; guards reel from a non-lethal hit, look around when investigating or searching (legs and body, arms on the rifle), and kneel at work when repairing the generator. While any of these play the rifle is slung.
- The slung rifle now lies across the back (muzzle over the right shoulder, butt at the left hip, scope out), placed from the torso bones each frame, instead of hanging off the upper arm. Verified: each state picks its clip and returns to idle; wind-up, kneeling, ladder and sling checked on screen; a guard repaired the generator kneeling.
- More Germans (4 Meshy rigged models, 190 credits; all share the guard skeleton, so every clip plays on them): a soldier in a camouflage smock and netted helmet, a sergeant in a field cap, the Oberst now in a colonel's uniform (peaked cap, cross strap, holster), and a lieutenant. Three more guards: a sergeant walking the north-west yard, a lieutenant keeping near the Oberst, a camouflaged sentry on the south side; the barn guard and one tower guard wear the camouflage smock. Verified: all models load, 42/42 or 66/66 animation tracks bound on each, the three new guards walk their routes.
- Heavy slot (key 3; `src/weapons/rockets.js`, heavy entries in `defs.js`): M1897 Trench Gun (9 pellets in a 0.025 rad cone, pump), MG42 (hold the trigger, 20 rounds/s, 50-round belt), Panzerschreck (rocket, reload each shot), Panzerfaust (single-shot, short range, kills the Panzer in one), PIAT (quiet spring-fired bomb, high arc). Rockets fly an arc solved to land on the crosshair point, trail smoke, and a direct hit counts as AP hits on the vehicle (1 or 2; the Panzer needs 2). Ammo per weapon (HEAVY_AMMO start/max), saved. Five weapon crates (yard, north wall, south wall, road, start hill) that put the weapon straight in the slot with its first ammo, and six heavy-ammunition caches (ammo only for heavy weapons you have). Higgsfield models (sam_3_3d, measured +z muzzle), fal.ai sounds (shots and reloads). Verified: MG42 crate → equipped, burst of 8 in 0.5 s; trench gun killed 3 of 3 guards at 8 m; one Panzerschreck rocket blew up the radio truck, two the Panzer; one Panzerfaust killed the Panzer; one PIAT bomb blew up the staff car; a cache gave each owned heavy weapon its ammo; saves include heavy ammo.
- Heavy sounds redone (fal.ai, 4 takes each, field-recording prompts): trench gun, the launchers, and the MG42 now one real round cut from a recorded burst (played per round at the real 20/s) plus the burst's echo when you let go. Explosions are recorded blasts instead of synthesised noise: a grenade and a vehicle blast up close fading into a distant rumble with range, arriving at the speed of sound.
- Explosions look better: a white-hot flash (bloom) that briefly lights the surroundings (two reused point lights, kept at zero so nothing recompiles), a glowing fireball with rolling flames and sparks, black billows, debris, a dust ring racing along the ground, a lingering smoke column and a scorch mark that fades over a minute. Particles use a cloudy puff texture with random rotation; fire is additive. Verified on captured frames at 0.04, 0.3, 1.5 and 4.5 s.
- Shotgun redone: a new 12-gauge blast (best of 15 takes: hard transient, natural decay; low end boosted 7 dB at 85 Hz and compressed for weight) and the pump as its own sound, racked 0.3 s after each shot while rounds remain.
- Shotgun now a real recording from Pixabay (Pixabay Content License, see `public/sounds/CREDITS.md`): "Shotgun Firing (4)" (single shot, the deepest low end and a 1.1 s outdoor echo; chosen over Universfield's thinner cinematic blast and "Shotgun Firing (3)") and one rack cut from "Pump Action Shotgun Cycle".

## Phase 9: Campaign: eight missions, enterable buildings, safes and documents (planned 2026-10-25)
The game becomes a campaign of eight missions, each its own map in a different environment.
Built in steps, one commit per step, each playable when it lands.

Decisions (2026-10-25): missions unlock in order (the test armoury opens all); safes open with a found
combination or by slow, noisy cracking; new maps about 1 km across.
- Bodies on raised floors (tower platforms, upper storeys, roofs) are only noticed by guards at about the same height or above (more than 1.2 m above the eye and steeper than 1 in 12 is hidden). A silent kill on a tower no longer alerts the yard. Verified: both tower guards killed, nobody alerted in 20 s each.
- Guards call out in German instead of a noise burst (which stacked into a bang when a shout alerted several at once): "Alarm! Hier liegt einer!" for a body, "Da ist er!" when you're spotted, "Was war das?" for anything else; three voices each (ElevenLabs Multilingual v2 on fal.ai), from the guard's position (fainter, duller and later with distance, silent past 70 m), one at a time; the guards a shout reaches join in silently. Verified: a body found with 7 guards reacting played one line.
- The Panzer's crew sees like the guards: tall grass hides you crouched or prone, and its range shrinks with your visibility (standing ~300 m, crouched ~220 m, prone ~150 m; was 350 m whatever your stance, grass ignored). Verified with a guard forced to have you in sight: grass prone 220 m and crouched 100 m hidden, open prone 200 m hidden; standing 100–260 m and open prone 100 m seen.

### 9A. Engine (everything after builds on it)
- [x] Mission framework: each mission is a module (`src/missions/<id>.js`) with its terrain, sky and
      time of day, buildings, guards and routes, vehicles, pickups, objectives, spawn and extraction.
      `terrain.js`, `compound.js`, `guards.js`, `pickups.js` and `mission.js` stop assuming the vineyard.
- [x] Mission select in the menu (Mission tab; `src/missions/campaign.js`; only built missions are playable): the eight missions with a briefing each, progress kept in
      the profile; loading a mission rebuilds the world from its module.
- [x] A building kit for walk-in buildings (`src/world/buildings.js`, `kit.js`): rooms, doorways, doors you open with E, stairs between
      floors, windows to shoot through, roofs; guards path through doors and patrol inside (ground floor
      first, upper floors by stairs).
- [x] Safes (`src/world/interact.js`): hold E to crack (slow, noisy), or open at once with the combination found on the officer
      or in a document. Contents: documents, intel, rare parts, ammo.
- [x] Documents and intel: readable letters, orders and maps (some reveal a safe combination, a guard
      route or an optional target); a per-mission collection kept in the profile.
- [x] Objective engine (mission modules give objectives, target, extraction, markers and a tick): kill a target, destroy a thing, retrieve an item (from a safe or a body),
      sabotage, reach a place, plus the extraction; optional objectives.
- [x] The vineyard's villa walk-in (two floors, stairs, six doors, four documents, the Oberst's office safe with his orders; the Oberst walks into the hall on his rounds). Verified: front door, stairs up and down, the bedside note gives the combination, the safe opens in 1.4 s and completes the optional objective, the Oberst opens the door and spends ~18 s inside, saves keep doors/documents/safe.

### 9B. The missions (one step each)
1. [x] **Operation Vineyard** (Tuscan countryside): the existing mission, villa now walk-in.
2. [x] **Hill town** (`src/missions/town.js`, 1 km map): a walled town on a flattened hilltop, the road up to the west
       gate and gaps in the walls; piazza with fountain and siren; walk-in church; bell tower with a ladder inside to the
       belfry (railed hatch) and two spotters; walk-in town hall (guard room, radio room, the commander's office with
       the safe, records room); rows of terraced houses with alleys, two walk-in, flat roofs with ladders and a roof
       sentry; staff car and a truck (weak spots). Weiss walks town hall → piazza → church; four patrols. Seven
       documents in the town plus his papers. Verified: routines over 2 min, tower ladder up and down, town hall
       stairs, the memo gives the combination and the safe opens, a rooftop ladder, objectives through extraction,
       the profile marks the town done, a town save loads back into the town.
3. [x] **Harbour** (Operation Low Tide): fenced docks on a 1 km coast, quay with rails and cranes (one climbable,
   a sniper on another), warehouses (two walk-in), the harbourmaster's 2-floor office with the safe, a fuel depot
   of four tanks that set each other off, a mole with a flak gun, and the supply ship: a satchel on its engine-room
   skylight or two rockets sink it (it settles and rolls; deck guards go down with it). Water: no swimming, guards
   path round it, bullets splash, you climb out onto the quay. Extraction opens when the ship and depot are done.
   Verified by script: routes, ship by satchel and by rockets, depot chain, satchel on a tank's side, documents and
   safe placement, extraction, save/load with the ship sunk; vineyard and town still load and play.
4. [x] **Forest** (Operation Black Pine): 1 km of fir and beech forest (8,700 trees) in thick mist, a forest road
   to a logging camp (sawmill, log piles, crew hut, a fuel dump of drums that chain, a tanker, the siren) and on to
   Hauptmann Vogel's hunting lodge (2 floors, the safe upstairs, his Kübelwagen); a hay meadow; a firebreak; three
   hunting stands with counter-snipers. New in the engine: maps choose their trees, grass density, cover patches and
   fog (exponential mist hides the far hills); trees are split into chunks so off-screen and misted ones aren't
   drawn (21 → under 3 ms a frame); standing among trees makes you harder to see on a forest map.
   Verified by script: patrol routes, satchel on the drums, the three stands, Vogel, extraction, the stand ladder,
   save/load; vineyard, town and harbour still load and play.
5. [x] **Railway junction** (Operation Iron Road): the main line through a station (platform, 2-floor building with
   the stationmaster's safe), a signal box (ladder, lever upstairs), a water tower with a lookout, a yard of sidings
   with goods wagons, an engine shed, coal stage and goods shed, the town's edge, a branch line. The gun train keeps
   time: due at 5:00, stops at the water tower for 2:30, then leaves west (the mission fails if the gun gets away).
   The signal lever holds it (at the home signal if pulled early, else at the platform); a wrecked boiler stops it;
   the gun is armoured (satchel, AP, rockets) and the ammunition wagon in front of it sets it off. A moving train
   masks shots. Engine: hold-E levers, mission failure screen, map sound sources, module save/load hooks.
   Verified by script: on-time arrival and stop, departure and failure, lever before arrival (held at the signal
   past its departure), ammunition-wagon chain, satchel on the breech from the platform, boiler wreck while moving,
   save/load with the train moving, masking; the other four missions still load and patrol.
6. [x] **Bridge** (Operation Broken Span): a river gorge with cliffs you can't climb (map maxSlope; guards' nav
   avoids them too), banks under the cliffs, two gullies down, a footbridge downstream; a three-arch stone bridge on
   two piers (ladders up them), checkpoints at both ends, an MG nest and watchtower east, the engineers' camp west
   (hut with Hahn's safe, tents, the bridging truck, generator, siren). Piers are stone (heavyOnly hotspots: only a
   satchel or TNT at the foot); with both down the spans fall into the gorge with anyone and anything on them.
   The armoured column (2 Panzers, 3 lorries) arrives at 7:00; it stops at the rim if the bridge is down, falls in
   if it's on it, and the mission is lost if it gets across.
   Verified by script: cliffs block both sides, both gullies walkable, pier ladders, AP hits don't harm a pier,
   satchels on both piers and the collapse, the column crossing (failure), collapse under the column (4 fell, the
   last stopped at the rim), save/load mid-column and after the collapse, Hahn, the bridging truck, extraction;
   the other five missions still load and patrol.
7. [x] **Airfield** (Operation Night Owl): runway, taxiway and three earth pens, two hangars (open to the north),
   a two-floor control tower with a glass cab and the safe (the flight plans), a fuel park, the pilots' mess, a
   fenced radar rise, three flak pits, a watchtower, a perimeter fence cut in two places. Modelled from the start:
   Bf 110 and Ju 88 night fighters, the Würzburg radar, the hangars, fuel bowsers, searchlights (with the flak,
   drums, watchtower and generator models). Objectives: four planes, the radar, the plans (all three needed);
   Kessler and his papers optional. Engine run-ups on the apron mask shots near the hangars for 22 s every 95 s.
   Verified by script: patrols, run-up masking, planes and radar, the safe by its combination, extraction,
   save/load with two planes and the radar wrecked.
8. [x] **Coastal radar** (Operation Sea Wall): a headland 45 m above the sea; you land in the west cove and climb the
   gully or the iron ladder below the lighthouse (the cliffs can't be climbed: map maxSlope, cliff-only navBlocked).
   On top: the Freya and Würzburg radars, three casemated guns (armoured: AP rounds or a satchel at the magazine door),
   pillboxes, trenches you can drop into and climb out of, the command bunker (the codebooks, required), barracks,
   the lighthouse with a lookout on its gallery. The surf covers shots on the beach. Modelled from the start: Freya,
   casemate, lighthouse, Czech hedgehogs, Tobruk pits (with the Würzburg, flak, searchlight and generator models).
   Verified by script: the cliff stops you, the gully and the ladder get you up, patrols (after fixing trenches that
   walled the guards in), surf masking, normal rounds bounce off the guns and AP destroys them, both radars, the safe,
   extraction, save/load.
- New models where needed (Higgsfield): locomotive and wagons, boats and a ship, cranes, planes,
  furniture and safes; recorded sounds where needed.

### Check for each step
- [ ] Load the mission from the menu, walk its map, enter its buildings, open its safe, read its
      documents, complete every objective and extract; saves load back into the right mission.

## Graphics pass: modelled key elements (2026-10-25)
- [x] 23 props from Higgsfield (gpt_image_2_5 reference picture → Tripo H3.1 image-to-3D, detailed for the big
      ones), textures shrunk to 512–1024 px JPEG by `tools/shrink-glb.py` (about 25 MB for all 23, 0.4–1.9 MB each, down from about 9 MB each).
- [x] `src/world/props.js`: per-mission loading (`props` in each mission module; safe, siren and crates always),
      `propModel()` lays a prop along x and fits it into the space its collision blocks already take,
      `clipAbove()` cuts a prop off at a height, `dressSite()` dresses the shared siren and generator.
- [x] Railway: locomotive and tender, flak wagon, ammunition van, railway gun, coach (the train), red and grey
      goods wagons in the yard, the water tower. Harbour: the steamer, three portal cranes, the flak gun, the
      E-boat, the four fuel tanks. Forest: the hunting stands (model legs and ladder, our cabin), fuel drums, log
      piles, the saw bench. Vineyard: watchtowers (model legs, our platform), the generator. Town: the fountain,
      an MG nest at the gate. Everywhere: the safe (shut and open), the siren, crate stacks.
- [x] Gameplay unchanged: every model stands over the old blocks (collision, shots, weak spots, ladders); weak
      spots blacken their model when wrecked.
- [x] Bridge: one modelled three-arch stone bridge, split by `splitProp()` into the pieces that fall (the three
      spans in their groups, each pier's shaft on its crumbling block, the abutments fixed); the column led by a
      modelled Tiger with a halftrack in it (with the Panzer IV and trucks); the camp's tents and pontoon stacks,
      striped sentry boxes at the checkpoints, the MG nest, the east watchtower's legs, the generator.
      Verified: the bridge, the column, the camp; both piers blown with the Tiger on the deck (it and a truck fall,
      the rest stop); save/load after the collapse.

## Embellishment: textures, reused models, set dressing, light (2026-10-25)
- [x] Photo textures: plaster (two), stone, roof tiles, wood, dark wood and ground from Higgsfield pictures in
      `public/textures/`, swapped in by `usePhotoTextures()` with normal maps built from their brightness.
- [x] 13 new set-dressing models (sandbags, barbed wire, telegraph pole, signpost, barrels, cart, haystack, well,
      motorcycle, Pak 40, field kitchen, supplies, fishing boat), placed with the earlier models (tents, sentry
      boxes, MG nest, searchlight, drums, hedgehogs, Tobruk, bowser, halftrack, Tiger, trucks, cars) by
      `dressProps()` from a `dressing()` list in every mission. Each sits on a hidden block (wire stops
      the player, not bullets); a prop whose block would overlap the site is left out.
- [x] Light per mission (`light` in each map): late morning (vineyard), late afternoon (town), evening
      (harbour), misty morning (forest), overcast (railway), midday (bridge), dawn (airfield), dusk with haze (coast).
- [x] Verified: all eight missions load with no errors and no props left out; patrols still walk in all eight
      (the officers wait at their first post as before); looked at the vineyard, town, harbour, railway,
      airfield and coast. Forest and bridge were checked by script only.

## Performance fix: "the game is lagging" (2026-10-25)
- [x] Measured: on a 1512×945 Retina-sized view a frame took 21–26 ms at 2× and 11–13 ms at 1×. The
      embellishment added about 10% (200k triangles drawn three times: scene, ambient occlusion, shadows); the
      main cost was already there: 4× multisampling at 2× was about half the frame.
- [x] Every prop, vehicle and enemy soldier model simplified with meshoptimizer (gltf-transform weld +
      simplify, error 0.005): props and vehicles 1.0M → 0.36M triangles, soldiers 20k → 7–14k each (the
      player's own model kept). Checked side by side: the lattice models (cranes, radars, watchtower) and
      the soldiers look the same; the bridge still splits into its pieces.
- [x] Multisampling only at 1× pixel ratio (above that the pixels are fine enough): 2× now 5–8 ms a frame,
      and each step the resolution scaler takes down is cheaper than the last.
- [x] Every texture uploaded and every shader compiled while the mission loads, so nothing stalls the first
      time it comes into view.
- [x] All eight missions load with no errors.

## De Lisle misses at 300 m with the marker on the head (2026-10-25)
- [x] Cause: the marker showed the impact point; a slow round that clears a head lands well behind it at a
      point that looks as if it sits on the head (from four hill spots at 300 m, 12–22 of 27–41 head aims
      missed). Also the marker flew a coarser step than the bullet (a few cm apart at 300 m).
- [x] Fix (`updatePrediction`): the bullet's own step; when something nearer shows under the impact point,
      the marker moves to where the bullet passes at that distance; flight limit 2 s → 3.5 s (the De Lisle
      past 370 m). Also about 4× cheaper (2.7 ms instead of 9.9 per update).
- [x] Verified (frozen world, Oberst at the villa, four hill spots at 300 m, 369 aims each): marker on the
      head ⇒ head hit in every case with the De Lisle; Springfield likewise, except shots on the neck line
      that hit the torso (still a kill).

## Tank turrets that turn and fire (2026-10-26)
- [x] `src/world/turrets.js`: every tank's turret is crewed. Calm, it scans its sector slowly; alerted,
      faster and all round; when the crew sees you it lays the gun on you and fires an HE round from the
      barrel: muzzle flash and smoke, dust round the hull, the gun recoiling, a tracer flying to the impact.
- [x] Crews can't see through walls (line of sight from the turret), but the gun shoots through them:
      after losing you behind cover they fire at your last spot for 8 s; the round punches through the
      wall (dust and debris) and bursts behind it, wider than an aimed shot.
- [x] Turrets cut out of the Tiger model (bridge column, railway yard) and the column's Panzer IV, as the
      vineyard Panzer already was; the vineyard Panzer now uses the shared crew (saves keep its turret yaw).
- [x] Verified: calm scan in the vineyard and railway, the column's turrets turning while it drives, an
      aimed shot and a blind shot through the compound wall; all eight missions load and run.
- [x] Sounds: the tracks of a moving tank rattle ("Tank Track Ratteling", Pixabay; louder and brighter
      nearer, up to 350 m), a traversing turret whirs ("Tank Turret Rotate", Pixabay; up to 90 m). Both
      cut into seamless loops; silenced on death and the end screen.
- [x] Exhaust fumes (`src/world/exhaust.js`) from every vehicle with a crew and its engine running:
      the tanks, the bridge column's trucks and halftrack, the reinforcement truck. Thin idling,
      thicker driving; none from parked props or wrecks.
- [x] Ground marks (`src/world/groundmarks.js`): tread prints from tanks and the halftrack's tracks,
      tyre prints from trucks and the halftrack's front wheels, laid on the slope of the ground, not on
      the bridge deck; the newest 3,000 of each kind stay.
- [x] Truck sounds (Pixabay): a moving truck's engine is the steady middle of "A semi-truck drives by",
      looped (the column, the reinforcements; louder and brighter nearer); the reinforcement truck setting
      off revs and pulls away ("Truck start moving"). The airfield's engine run-up keeps its own
      synthesised engine.

## Realism pass with the new Higgsfield credits (done 2026-10-26; 709 credits spent, 336 left)
44 models: 45 reference pictures (gpt_image_2_5), 40 Tripo H3.1 models, 4 Meshy rigged characters. Every
model goes in through `tools/import-model.sh` (download, JPEG textures, weld + simplify at error 0.005).
- [x] F. Vineyard: the green hedge rows are now modelled vines on posts and wires (54 instances, two 9 m
      lengths per row). Modelled Italian cypresses and umbrella pines replace the drawn ones on every map
      (instanced in chunks, the trunk kept for bullets), boulders on the hills. The olive, oak and bush
      models failed (image-to-3D drops leafy crowns), so those stay the drawn leaf-card trees.
- [x] B. Wrecks: a destroyed truck, staff car, fuel bowser, halftrack, Tiger, Panzer or fighter is swapped
      for its burnt-out model (`swapForWreck` in hotspots.js; vehicles found by a kind/key tag on their
      model), the original meshes hidden in place so bullets still stop on them; the vineyard Panzer and
      the column vehicles that fall into the gorge too. Saves restore wrecks the same way.
- [x] E. Props: market stalls, café tables and a Fiat in the town; rowboats and cargo pallets in the
      harbour; felled trees and a horse cart in the forest; a water crane and a handcar at the railway; bomb
      trolleys, Kettenkrads, fuel trailers and a second (Würzburg) dish at the airfield; an assault boat
      and a pontoon section at the bridge camp; boulders and rowboats elsewhere.
- [x] D. Interiors: every desk, table, cabinet and bed is drawn by a model over its old blocks (desk or
      radio set; map table or dining set; locker or filing cabinet; bunk), mixed by position.
- [x] C. Animals (`src/world/animals.js`): cows and a horse (vineyard, town, railway), goats (coast), red
      deer (forest). They wander, graze head-down, and bolt from you walking up or from shots and blasts.
- [x] A. Uniforms: Luftwaffe ground crew at the airfield, Kriegsmarine sailors in the harbour, Pioniere at
      the bridge camp, and a tank commander in black standing in the hatch of every crewed tank (turns with
      the turret, gone when the tank is). The military policeman was refused by the image filter.
- [x] G. Weather (`src/world/weather.js`): rain in the forest (streaks, hiss, it masks a little noise, a
      grey sky), ground mist over the airfield at dawn, sea spray where the surf breaks on the coast.
- [x] Verified: all eight missions load and run with no errors; no dressing left out; frame at 1512×945
      8–11 ms (was 5–8; the 380 modelled cypresses and the vine rows, 3.4M triangles in view).

## X stopped switching ammunition (2026-10-26)
- [x] Cause: the weapon-switch timer counted down by subtraction and ended at −1.7e-16, not 0; X checked
      `!switchT`, so after the first weapon switch (pistol, heavy) X was ignored for the rest of the mission.
      Fixed: the timer clamps at 0 and X checks `switchT <= 0`. X with no other type now says
      "NO OTHER AMMUNITION" instead of doing nothing.
- [x] Verified: pistol and back, then X cycles standard → subsonic → armour-piercing → standard.

## Throw cancel, blocked-throw warning, bullets through bodies (2026-10-26)
- [x] Esc while aiming a grenade or bottle puts it away (the browser frees the mouse on Esc, so the game
      pauses; before, resuming threw it). Right-click cancels too, without pausing; G must be pressed afresh.
- [x] The throw arc and its ring turn red when the throw will strike something on the way (a wall, a
      tree, a vehicle, a man), white for a clean landing on ground, a floor or a roof.
- [x] Bullets go through bodies (`passThrough` in arsenal.js): a round still above ~230 m/s after the hit
      carries on at 55% of its speed (75% AP) and 80% damage, ignoring the man it went through, through at
      most two; slow rounds (pistol, subsonic, De Lisle) stop in the first body. A second kill by the same
      round shows DOUBLE KILL (three: TRIPLE KILL). Works after the kill cam too (it resolves its hit the
      same way).
- [x] Verified: Springfield head shot at 43 m killed the man in front (831 m/s) and the man 3 m behind
      (456 m/s), DOUBLE KILL shown; arc white over open ground, red at a wall 4 m off; Esc and right-click
      cancel with no grenade used.

## Throwable TNT, satchel fuses, shooting satchels (2026-10-26)
- [x] TNT is thrown like a grenade (same arc, red warning, Esc / right-click cancel); where it comes to
      rest it lies as a charge: K sets it off, and so does a shot.
- [x] Satchel fuse: L switches short (6 s) / long (20 s); shown in the item name and the wheel; K still
      blows it at once.
- [x] Shooting a satchel sets it off, also on a vehicle: a charge sits partly inside the engine's block,
      so a shot meeting the block first now goes to a charge within 0.8 m behind it (raycastSegment).
- [x] Verified: TNT thrown, landed, K detonated it; satchels placed with 6 s and 20 s; a shot set off one
      on the ground and one on the staff car (the car went up with it).
