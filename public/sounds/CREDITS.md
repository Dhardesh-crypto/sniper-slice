# Sound credits

Most sounds here were generated with ElevenLabs Sound Effects (via fal.ai) for this game; the guards' voices (`vo_*.mp3`, and their small talk `chat_*.mp3`: voices George, Daniel and Bill) with ElevenLabs Multilingual v2 text-to-speech (German).

The air war (`bombers_drone`, `strafe_50cal`, `flak_burst`, `flak88_fire`, `plane_crash`, `radio_static`): ElevenLabs Sound Effects.

The campaign's story (`story_<mission>_intro.mp3` / `_outro.mp3`: Major Ellis's orders and reports) was read with ElevenLabs Multilingual v2 text-to-speech, voice George (English).

From Pixabay (Pixabay Content License: free to use in a game, no attribution required; not to be
redistributed as standalone sound files):
- `plane_flyover.mp3`: "Airplane Flyover" by freesound_community, https://pixabay.com/sound-effects/city-airplane-flyover-61082/ (the bomber stream's pass; trimmed to 20 s, levelled)
- `plane_lowpass.mp3`: "Low Airplane Fly By" by freesound_community, https://pixabay.com/sound-effects/film-special-effects-low-airplane-fly-by-90354/ (the Thunderbolts' pass; levelled)
- `plane_prop.mp3`: "Small propeller airplane" by Ahmed_Abdulaal, https://pixabay.com/sound-effects/film-special-effects-small-propeller-airplane-337002/ (the plane crossing the valley; levelled)
- `flak20_fire.mp3`: "antiair" by freesound_community, https://pixabay.com/sound-effects/film-special-effects-antiair-85147/ (the 2 cm flak guns firing; levelled)
- `bomb_fall.mp3`: "Falling Bomb" by freesound_community, https://pixabay.com/sound-effects/film-special-effects-falling-bomb-41038/ (a strike's bombs coming down; levelled)
- `plane_start.mp3`: "Airplane start propeller" by freesound_community, https://pixabay.com/sound-effects/city-airplane-start-propeller-94940/ (the airfield's engine run-up; levelled)

- `shot_trenchgun.mp3`: "Shotgun Firing (4)" by freesound_community, https://pixabay.com/sound-effects/film-special-effects-shotgun-firing-4-6746/ (trimmed, levelled)
- `pump.mp3`: the first full rack (back and forward) from "Pump Action Shotgun Cycle" by freesound_community, https://pixabay.com/sound-effects/film-special-effects-pump-action-shotgun-cycle-81021/ (cut, levelled)
- `tank_tracks.mp3`: "Tank Track Ratteling" by u_3rdmeaw7un, https://pixabay.com/sound-effects/film-special-effects-tank-track-ratteling-197409/ (cut into a seamless loop, levelled)
- `tank_turret.mp3`: "Tank Turret Rotate" by freesound_community, https://pixabay.com/sound-effects/film-special-effects-tank-turret-rotate-14879/ (cut into a seamless loop, levelled)
- `army_truck.mp3`: the steady middle of "A semi-truck drives by" by spinopel, https://pixabay.com/sound-effects/film-special-effects-a-semi-truck-drives-by-626428/ (cut into a seamless loop, levelled)
- `truck_start.mp3`: 3.5–12 s of "Truck start moving" by spinopel, https://pixabay.com/sound-effects/film-special-effects-truck-start-moving-290808/ (faded in and out, levelled)
- `siren.mp3`: "Air Raid Siren Sound Effect" by 11325622, https://pixabay.com/sound-effects/film-special-effects-air-raid-siren-sound-effect-241383/ (trimmed to one wind-up and wind-down, looped, levelled)
- `dog_bark_1.mp3`–`dog_bark_5.mp3`: five barks cut from "Dog Barking" by DRAGON-STUDIO, https://pixabay.com/sound-effects/nature-dog-barking-406629/ (cut at the silences, faded, levelled)
- `dog_bark_6.mp3`: "Free Dog Bark" by DRAGON-STUDIO, https://pixabay.com/sound-effects/nature-free-dog-bark-419014/ (trimmed, levelled)
- `dog_bark_7.mp3`–`dog_bark_11.mp3`: five barks cut from "German shepherd barking" by AudioPapkin, https://pixabay.com/sound-effects/nature-german-shepherd-barking-302356/ (cut at the silences, faded, levelled)
- `shot_mg42.mp3` and `mg42_tail.mp3`: the last round of the burst, and the echo after it, from "Machine Gun" by DennisH18, https://pixabay.com/sound-effects/film-special-effects-machine-gun-129929/ (cut, levelled to the clips they replace; the round plays once per shot at the gun's rate, the echo when the trigger's let go). Used for the MG42 you carry, the nests' guns (yours and the guards')
- `casing_1.mp3`–`casing_5.mp3`: five drops cut from ".30 Shell Bouncing" by freesound_community, https://pixabay.com/sound-effects/film-special-effects-30-shell-bouncing-87453/ (cut at the silences, faded, levelled)
- `casing_6.mp3`–`casing_11.mp3`: six drops cut from "Bouncing Shell Casings (Various Sizes)" by freesound_community, https://pixabay.com/sound-effects/film-special-effects-bouncing-shell-casings-various-sizes-32291/ (cut at the silences, faded, levelled)

## Music

`music_<mission>.mp3` (one per mission: vineyard, town, harbour, forest, railway, bridge, airfield,
radar) and `music_alarm.mp3` were generated for this game with Meta's MusicGen (`facebook/musicgen-medium`,
from AudioCraft, https://github.com/facebookresearch/audiocraft), run locally through Hugging Face
`transformers`: 30 s from a text prompt, continued once from its last 10 s, then EQ'd (rumble and the
2–4 kHz voice range pulled back), crossfaded end-into-start for a seamless loop, and levelled.

Licence: the MusicGen model weights are released under **CC-BY-NC 4.0** (non-commercial use only).
This music can't ship in a game that is sold; replace it (e.g. with a commercially licensed model or
composer) before any commercial release.

Prompts (each began "1940s war film score, slow, sparse, restrained and quiet, ambient underscore,"):
vineyard: warm low strings and a lonely solo clarinet; town: low pizzicato strings and a muted french horn;
harbour: deep cellos and bassoon; forest: alto flute over a soft dark string pad; railway: low string
ostinato and soft distant timpani; bridge: double basses and a solo oboe; airfield: muted trombones and
low strings; radar: low brass chorale and cellos. Alarm: "tense 1940s war film action score, driving
low string ostinato, staccato low brass, snare drum and timpani, urgent but dark".
