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
