"""Render the storm's thunder in SuperCollider (thunder.scd) → level → public/sounds/*.mp3.
Close strikes (thunder_near_1..3), far rolls (thunder_far_1..4), ground strikes (lightning_strike_1..2)
and the storm bed (storm_bed: rumble and wind gusts, its tail folded onto its start so it loops).
All filtered noise: no tones, no bells.

usage: ~/Documents/Valexos/Research/lemo-opuscar-main/.venv/bin/python tools/music/thunder.py
"""
import os, subprocess
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt
from build import SCLANG, SR, SOUNDS, BUILD, lufs

HERE = os.path.dirname(os.path.abspath(__file__))
# name: (kind, seed, seconds, peak dBFS). Peaks set by ear against the shots: a close strike is the
# loudest thing in the game bar a blast; a far roll sits well under it (storm.js scales by distance).
FILES = {
    'thunder_near_1': ('near', 11, 8, -1.5), 'thunder_near_2': ('near', 23, 9, -1.5), 'thunder_near_3': ('near', 37, 7.5, -1.5),
    'thunder_far_1': ('far', 41, 10, -4), 'thunder_far_2': ('far', 53, 11, -4), 'thunder_far_3': ('far', 67, 9, -4), 'thunder_far_4': ('far', 79, 12, -4),
    'lightning_strike_1': ('strike', 83, 4, -1), 'lightning_strike_2': ('strike', 97, 4.5, -1),
}
BED, BED_LOOP, BED_FOLD = 'storm_bed', 30.0, 4.0


def render(name, kind, seed, dur):
    os.makedirs(BUILD, exist_ok=True)
    wav = os.path.join(BUILD, name + '.wav')
    env = dict(os.environ, KIND=kind, SEED=str(seed), DUR=str(dur), OUT_WAV=wav)
    p = subprocess.run([SCLANG, os.path.join(HERE, 'thunder.scd')], env=env, capture_output=True, text=True, timeout=300)
    if 'ALL DONE' not in p.stdout + p.stderr: raise RuntimeError(f'{name}: render failed\n' + (p.stdout + p.stderr)[-2000:])
    return wav


def write(name, y):
    final = os.path.join(BUILD, name + '_final.wav'); sf.write(final, y, SR, subtype='PCM_24')
    mp3 = os.path.join(SOUNDS, name + '.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', final, '-b:a', '160k', mp3], check=True)
    return mp3, lufs(final)


if __name__ == '__main__':
    for name, (kind, seed, dur, peak) in FILES.items():
        x, sr = sf.read(render(name, kind, seed, dur), dtype='float64'); assert sr == SR
        x = sosfilt(butter(2, 25, 'highpass', fs=SR, output='sos'), x, axis=0)
        fade = int(0.3 * SR); x[-fade:] *= np.linspace(1, 0, fade)[:, None]
        x *= 10 ** (peak / 20) / np.abs(x).max()
        mp3, L = write(name, x)
        print(f'{name:20s} {dur:5.1f} s  {L:6.1f} LUFS  -> {os.path.relpath(mp3)}')
    # The bed: rendered long, the last BED_FOLD s crossfaded over the first so the loop has no seam.
    x, sr = sf.read(render(BED, 'bed', 7, BED_LOOP + BED_FOLD), dtype='float64')
    n, f = int(BED_LOOP * SR), int(BED_FOLD * SR)
    y = x[:n].copy(); ramp = np.linspace(0, 1, f)[:, None]
    y[:f] = y[:f] * ramp + x[n:n + f] * (1 - ramp)
    y = np.concatenate([y, y, y]); y = sosfilt(butter(2, 25, 'highpass', fs=SR, output='sos'), y, axis=0)[n:2 * n]
    y *= 10 ** (-6 / 20) / np.abs(y).max()
    mp3, L = write(BED, y)
    print(f'{BED:20s} {BED_LOOP:5.1f} s  {L:6.1f} LUFS  -> {os.path.relpath(mp3)} (loop)')
