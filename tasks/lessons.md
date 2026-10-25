# Lessons

## Verify model orientation on geometry, not by eye (2026-10-24)
**What happened:** the generated rifle ended up held backwards (butt forward). I first measured the
muzzle end correctly from the mesh, then flipped it after misreading a screenshot taken from an odd angle,
and confirmed the flip only with my own muzzle marker, which was built on the same wrong assumption.
**Pattern:** when a 3D asset looks wrong, measure a physical property of the mesh itself (e.g. the barrel
end is thin, the stock thick) in the frame you care about, and check every pose that uses it. Never
"verify" with a reference point derived from the assumption being tested.

## Bone axes on generated rigs are unknown (2026-10-24)
**What happened:** rotating Meshy bones about their local X (spine bend, forearm twist) twisted the arm
and torso the wrong way after a shot.
**Pattern:** don't apply local-axis bone rotations on a rig whose axes you haven't inspected. Prefer
world-space solutions (IK to targets, world-space deltas) that don't depend on bone axis conventions.

## Check stance poses against the world's cover heights (2026-10-24)
**What happened:** the crouch used the generated crouch-walk clip as-is; its head stayed at 1.34 m, so
crouching couldn't hide you behind a 1.0 m railing, which is the point of crouching in a stealth game.
**Pattern:** for every stance, measure the posed head/chest heights and compare them with the cover the
level offers (railings, sandbags, walls). The eye height, the camera and the guards' sight points must all
come from the same numbers.

## A cover multiplier is not cover (2026-10-24)
**What happened:** tall grass only multiplied the detection rate down (×0.12 crouched), so any guard with a
line of sight still "saw" you a little. Every system that asked "does he see you?" took any non-zero rate
as yes: alerted guards got your exact position, went into combat and shot you while you were concealed.
**Pattern:** separate "noticing something" from "has spotted you". Decide what hiding guarantees (here:
invisible beyond a short range, unspottable unless a clear look or point blank) and make every consumer
(AI targeting, firing, last-seen position, alarm) use the spotted flag, not the raw rate.

## Line of sight isn't visibility (2026-10-25)
- A guard on the ground "saw" a body lying on an 8 m tower platform through the railing gaps, so a
  silent De Lisle kill alerted the yard. A raycast that reaches something doesn't mean a person
  could notice it: something lying flat on a raised floor is hidden from below.
- **Rule:** when adding a perception check, ask what a person at that height and angle would really
  see, not only whether a ray gets through.

## Adding a field to saved data (2026-10-25)
- I added `mission: 'vineyard'` to the save snapshot, but `mission` already held the objectives, so
  every new save lost them and loading crashed half-way: a black screen.
- **Rule:** before adding a key to a saved object, check the existing keys; and keep startup code
  that applies saved data inside try/catch so a bad save can never stop the game from starting.

## A generated model is solid where its picture shows openings (2026-10-25)
- The image-to-3D watchtower and hunting stand looked right, but their cabins are closed shells (the
  openings are only painted) and their decks sit higher than ours, so guards on the platforms vanished.
  Raycasts didn't catch it (models aren't ray targets) and a close, low screenshot looked like normal
  railing cover.
- **Rule:** when a generated model goes where someone stands, render the same view with the model on and
  off. If anyone disappears, keep only the part below them (cut the geometry) and build the rest plainly.

## A slope rule applies to every slope (2026-10-25)
- The cliff rule (no walking up ground steeper than maxSlope, and steep cells blocked for the guards) also caught the
  trenches I cut on the same map: their sides were steeper than the cliffs' limit, so the nav grid turned every trench
  into a wall (two guards stood still) and a player in a trench could never have climbed out.
- **Rule:** when a map gets a slope rule, check every other bit of ground shaped on that map (trenches, ramps,
  craters) against it, and limit a nav block to where it's meant to apply.

## Generated models are far denser than they look (2026-10-25)
Tripo models come out at 10–38k triangles each, and every one is drawn three times (scene, ambient
occlusion, shadows). Simplify them on import (gltf-transform weld + simplify --ratio 0.25 --error 0.005,
which keeps their look) and measure the frame (GPU-timed post.draw at a real screen size, compared with the
previous commit) after any graphics pass, before calling it done.

## A marker for a slow round must be honest about depth (2026-10-25)
The scope's impact marker showed where the shot lands, projected on screen. With the De Lisle (260 m/s)
the round falls steeply at 300 m, so a shot clearing a head by 0.25–1.5 m lands metres behind it at a spot
that looks as if it sits on the head: about half the "marker on the head" aims missed. The marker now
moves to where the bullet passes at the distance of whatever shows under it, and it flies the bullet's own
step (a 1/120 s step drifted a few cm by 300 m, enough to clip a parapet the real round cleared). Test a
marker against the real shot from many aims (marker on target ⇒ hit), not one lucky aim on a range.
