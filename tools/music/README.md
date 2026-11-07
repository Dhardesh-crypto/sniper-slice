# Music

Each mission has a calm loop and an alarm loop in the same key, tempo (64 bpm) and length (16 bars,
60 s), so `core/audio.js` can crossfade them in step when the siren sounds.

- `compose.py`: the score. One entry per mission in `MISSIONS` (key, chord progression, pad, bass
  and solo instruments, the solo's motif, extras like ostinato or timpani, a synth layer).
  `calm()` and `alarm()` turn an entry into notes.
- `render.scd`: plays a cue in SuperCollider offline: CC0 samples (VSCO 2 CE / VCSL) and the
  Salamander Grand Piano (CC BY 3.0: credit it), from
  lemo-opuscar's `core/audio/instruments`, picked and levelled by its `sampler.py` index) plus
  synth pads, air, hum and drive, through one hall reverb.
- `build.py`: compose, render, fold the tail onto the start, EQ, level (calm −24 LUFS, alarm
  −21 LUFS), write `public/sounds/music_<mission>.mp3` and `music_alarm_<mission>.mp3`.

```bash
~/Documents/Valexos/Research/lemo-opuscar-main/.venv/bin/python tools/music/build.py            # all 18
~/Documents/Valexos/Research/lemo-opuscar-main/.venv/bin/python tools/music/build.py town_calm  # one
```

Needs SuperCollider (`/opt/homebrew/bin/brew install --cask supercollider`) and the lemo-opuscar
`vsco2ce` and `vcsl` sample libraries. `build/` is scratch (git-ignored).

No bells in the music: no glockenspiel, tubular bells, vibraphone or chimes; the synths use no FM
or ringing sines.

The melodies and the alarms' top line are piano (the user disliked the violin and wind solos).
