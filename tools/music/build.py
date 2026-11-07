"""Build the game's music: compose → render in SuperCollider → fold the tail onto the start
(seamless loop) → EQ → level → public/sounds/music_<mission>.mp3 and music_alarm_<mission>.mp3.

usage (lemo-opuscar's venv has numpy/scipy/soundfile and the sampler):
  ~/Documents/Valexos/Research/lemo-opuscar-main/.venv/bin/python tools/music/build.py [cue ...]
"""
import os, sys, subprocess, re
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compose as C   # noqa: E402

GAME = os.path.dirname(os.path.dirname(HERE))
BUILD = os.path.join(HERE, 'build')
SOUNDS = os.path.join(GAME, 'public', 'sounds')
SCLANG = '/Applications/SuperCollider.app/Contents/MacOS/sclang'
SR = 48000
# The MusicGen loops sat at about −24 LUFS (calm) and −21 LUFS (alarm) under the effects;
# match them so the music slider and the mix keep their meaning.
TARGET = {'calm': -24.0, 'alarm': -21.0}


def render(name):
    d = os.path.join(BUILD, name); wav = os.path.join(d, 'raw.wav')
    env = dict(os.environ, CUE_DIR=d, OUT_WAV=wav)
    p = subprocess.run([SCLANG, os.path.join(HERE, 'render.scd')], env=env, capture_output=True, text=True, timeout=600)
    log = p.stdout + p.stderr
    open(os.path.join(d, 'render.log'), 'w').write(log)
    if 'ALL DONE' not in log: raise RuntimeError(f'{name}: render failed\n' + log[-2000:])
    return wav


def lufs(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'ebur128', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1])


def finish(name, raw):
    x, sr = sf.read(raw, dtype='float64'); assert sr == SR
    n = int(round(C.LOOP * SR))
    loop = x[:n].copy()
    tail = x[n:]
    loop[:len(tail)] += tail[:n]                       # what rings past the end sounds at the start
    # EQ on three copies end to end, keep the middle: the filters see a continuous loop, no seam.
    y = np.concatenate([loop, loop, loop])
    y = sosfilt(butter(2, 35, 'highpass', fs=SR, output='sos'), y, axis=0)
    # pull back the voice range (2–4 kHz) a little so the guards and Kestrel stay clear
    band = sosfilt(butter(2, [2000, 4000], 'bandpass', fs=SR, output='sos'), y, axis=0)
    y = y - band * (1 - 10 ** (-3 / 20))
    y = y[n:2 * n]
    tmp = os.path.join(BUILD, name, 'eq.wav'); sf.write(tmp, y, SR, subtype='FLOAT')
    kind = name.split('_')[1]
    g = 10 ** ((TARGET[kind] - lufs(tmp)) / 20)
    y *= g
    pk = np.abs(y).max()
    if pk > 0.89: y *= 0.89 / pk                     # −1 dBFS ceiling (quiet music, rarely hit)
    final = os.path.join(BUILD, name, 'loop.wav'); sf.write(final, y, SR, subtype='PCM_24')
    mission = name.split('_')[0]
    mp3 = os.path.join(SOUNDS, f'music_{mission}.mp3' if kind == 'calm' else f'music_alarm_{mission}.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', final, '-b:a', '160k', mp3], check=True)
    return mp3, lufs(final), 20 * np.log10(np.abs(y).max())


if __name__ == '__main__':
    want = sys.argv[1:] or list(C.cues())
    for name in want:
        c = C.cues()[name](); c.write(os.path.join(BUILD, name))
        mp3, L, pk = finish(name, render(name))
        print(f'{name:18s} {len(c.notes):5d} notes {len(c.bufs):4d} samples  {L:6.1f} LUFS  peak {pk:5.1f} dBFS  -> {os.path.relpath(mp3, GAME)}')
