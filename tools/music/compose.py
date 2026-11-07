"""Sniper Slice score: one quiet loop per mission plus a matching alarm loop, same key, tempo
and length, so the game can crossfade between them in step (core/audio.js setMusicAlarm).

compose.py writes each cue as plain text (notes and synth events) for render.scd, which plays
it in SuperCollider: CC0 orchestral samples (VSCO 2 CE / VCSL) and the Salamander piano (CC BY 3.0),
picked and normalised through
lemo-opuscar's core/audio/sampler.py index) and synthesised pads, air and hum. No bells: no
glockenspiel, tubular bells, vibraphone or chimes, and the synths use no FM or ringing sines.

usage: python compose.py <outdir> [cue ...]     (cues: vineyard_calm, vineyard_alarm, ...)
"""
import os, sys, random

LIB = os.path.expanduser('~/Documents/Valexos/Research/lemo-opuscar-main')
sys.path.insert(0, os.path.join(LIB, 'core', 'audio'))
import sampler as S   # noqa: E402

BPM = 64
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 16
LOOP = BARS * BAR          # 60 s; every cue is exactly this long once the tail is folded back
TAIL = 8.0                 # rendered past the loop end, then mixed onto the start (seamless wrap)

# Natural minor with chord qualities; V and bII borrowed for the darker, period sound.
DEG = {'i': (0, 'm'), 'ii°': (2, 'd'), 'bII': (1, 'M'), 'III': (3, 'M'), 'iv': (5, 'm'), 'v': (7, 'm'),
       'V': (7, 'M'), 'VI': (8, 'M'), 'VII': (10, 'M')}
QUAL = {'m': [0, 3, 7], 'M': [0, 4, 7], 'd': [0, 3, 6]}
MINOR = [0, 2, 3, 5, 7, 8, 10]

# Each mission: key (pitch class), progression (one chord per two bars), the instruments that
# carry it, and a motif for the soloist (piano everywhere: the user preferred it to violins and winds) as (scale degree from the tonic, beats); None = rest.
MISSIONS = {
    'vineyard': dict(key=2, prog=['i', 'VI', 'III', 'VII', 'iv', 'i', 'VI', 'V'],
                     pad=['cellos', 'violas'], bass='contrabass', solo='piano', solo_oct=5,
                     motif=[(4, 2), (3, 1), (2, 1), (0, 3), (None, 1), (2, 1), (3, 1), (4, 2), (None, 4)],
                     color='harp', synth='air'),
    'town': dict(key=9, prog=['i', 'iv', 'VII', 'III', 'VI', 'iv', 'ii°', 'V'],
                 pad=['violas'], bass='contrabass_pizz', walk='cellos_pizz', solo='piano', solo_oct=5,
                 motif=[(0, 1), (2, 1), (4, 3), (None, 1), (5, 2), (4, 1), (2, 1), (4, 4), (None, 4)],
                 solo_send=0.55, synth='air'),
    'harbour': dict(key=0, prog=['i', 'VII', 'VI', 'V', 'i', 'iv', 'VI', 'V'],
                    pad=['cellos'], bass='contrabass', solo='piano', solo_oct=4,
                    motif=[(0, 2), (-2, 1), (0, 1), (2, 2), (3, 2), (2, 3), (None, 5)],
                    synth='sea'),
    'forest': dict(key=4, prog=['i', 'III', 'VII', 'iv', 'i', 'VI', 'iv', 'V'],
                   pad=['violas'], bass='cellos', solo='piano', solo_oct=5,
                   motif=[(4, 3), (6, 1), (7, 2), (6, 1), (4, 1), (3, 4), (None, 4)],
                   synth='pad'),
    'flak': dict(key=3, prog=['i', 'iv', 'i', 'VI', 'iv', 'VII', 'III', 'V'],
                 pad=['horn', 'cellos'], bass='contrabass', solo='piano', solo_oct=5,
                 motif=[(4, 1), (4, 1), (4, 2), (5, 2), (4, 2), (2, 2), (None, 6)],
                 solo_send=0.6, timp=True, synth='air'),
    'railway': dict(key=7, prog=['i', 'VI', 'iv', 'V', 'i', 'VI', 'bII', 'V'],
                    pad=['violas'], bass='contrabass', ostinato='cellos_spic', solo='piano', solo_oct=4,
                    motif=[(0, 4), (2, 2), (3, 2), (2, 4), (None, 4)],
                    timp=True, synth='hum'),
    'bridge': dict(key=11, prog=['i', 'VI', 'iv', 'i', 'VII', 'III', 'iv', 'V'],
                   pad=['cellos'], bass='contrabass', solo='piano', solo_oct=5,
                   motif=[(0, 1), (2, 1), (3, 2), (4, 3), (None, 1), (3, 1), (2, 1), (0, 2), (None, 4)],
                   color='harp', synth='air'),
    'airfield': dict(key=5, prog=['i', 'VI', 'VII', 'i', 'iv', 'VI', 'V', 'V'],
                     pad=['trombone', 'cellos'], bass='contrabass', solo='piano', solo_oct=5,
                     motif=[(4, 3), (3, 1), (2, 2), (0, 2), (2, 4), (None, 4)],
                     solo_send=0.5, synth='hum'),
    'radar': dict(key=10, prog=['i', 'iv', 'VI', 'V', 'i', 'bII', 'iv', 'V'],
                  pad=['horn', 'trombone', 'cellos'], bass='tuba', solo=None, synth='hum_radar'),
}


class Cue:
    def __init__(self, name, seed):
        self.name, self.bufs, self.notes, self.synths = name, {}, [], []
        S.seed(seed); self.rng = random.Random(seed)

    def buf(self, path):
        return self.bufs.setdefault(path, len(self.bufs))

    def note(self, inst, t, m, dur, vel=.6, pan=0., atk=None, rel=None, send=.3, var=None, gain=1.):
        """One sampled note. Long sustained notes are built from overlapping segments that
        start from the sample's body, so nothing re-attacks."""
        I = S.load(inst)
        if I.kind != 'hit' and m is not None:
            while m < I.lo: m += 12
            while m > I.hi: m -= 12
        z = I.pick(m, vel, var)
        rate = 1.0 if (z['root'] is None or m is None) else 2 ** ((m - z['root']) / 12)
        amp = I.vgain[z.get('var')] * 10 ** (z['db'] / 20) * (vel / .8) ** 1.3 * gain
        rel = I.rel if rel is None else rel
        path = os.path.join(S.ROOT, z['f'])
        frames = z['n'] - z['on']
        avail = frames / z['sr'] / rate
        if I.kind != 'sus':                       # plucked, struck, short: natural decay
            sus = max(.01, min(dur, avail - rel - .02))
            self.notes.append((t, self.buf(path), rate, z['on'], sus, amp, pan, .002 if atk is None else atk, rel, send))
            return
        atk = .08 if atk is None else atk
        if dur + rel <= avail - .1:
            self.notes.append((t, self.buf(path), rate, z['on'], dur, amp, pan, atk, rel, send))
            return
        # first segment from the attack, then segments from 35% into the sample, 1 s crossfades
        body = z['on'] + int(frames * .35)
        seg_body = (z['n'] - body) / z['sr'] / rate
        first = avail - 1.2
        self.notes.append((t, self.buf(path), rate, z['on'], first, amp, pan, atk, 1.0, send))
        pos, end = t + first, t + dur
        while pos < end:
            seg = min(seg_body - 2.2, end - pos + .05)
            self.notes.append((pos, self.buf(path), rate, body, max(.05, seg), amp, pan, 1.0, 1.0 if pos + seg < end else rel, send))
            pos += seg                      # the next segment fades in as this one releases

    def synth(self, t, name, **kw):
        self.synths.append((t, name, kw))

    def write(self, d):
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'meta.txt'), 'w') as f: f.write(f'{LOOP + TAIL}\n')
        with open(os.path.join(d, 'bufs.txt'), 'w') as f:
            f.write('\n'.join(sorted(self.bufs, key=self.bufs.get)) + '\n')
        with open(os.path.join(d, 'notes.txt'), 'w') as f:
            for n in sorted(self.notes):
                f.write(' '.join(f'{v:.6g}' if isinstance(v, float) else str(v) for v in n) + '\n')
        with open(os.path.join(d, 'synths.txt'), 'w') as f:
            for t, nm, kw in sorted(self.synths, key=lambda s: s[0]):
                f.write(f'{t:.4f} {nm} ' + ' '.join(f'{k} {v:.6g}' for k, v in kw.items()) + '\n')


def seed_of(s):          # (Python's hash() changes per run; this doesn't)
    return sum((i + 1) * ord(ch) for i, ch in enumerate(s))


# ---- harmony helpers ----
def chord_pcs(key, deg):
    r, q = DEG[deg]
    return [(key + r + i) % 12 for i in QUAL[q]], (key + r) % 12


def voice(pcs, lo, hi, prev=None, n=3):
    """The n chord tones within [lo, hi] closest to the previous voicing (smooth voice leading)."""
    cands = sorted(m for m in range(lo, hi + 1) if m % 12 in pcs)
    best, bcost = None, 1e9
    import itertools
    for combo in itertools.combinations(cands, n):
        if len({m % 12 for m in combo}) < min(n, len(pcs)): continue
        if combo[-1] - combo[0] > 14: continue
        cost = sum(abs(a - b) for a, b in zip(combo, prev)) if prev else abs(sum(combo) / n - (lo + hi) / 2)
        if cost < bcost: best, bcost = combo, cost
    return list(best)


def root_in(pc, lo):
    m = lo + ((pc - lo) % 12)
    return m


def scale_note(key, deg, octave):
    o, d = divmod(deg, 7)
    return 12 * (octave + 1 + o) + key + MINOR[d]


def melody(key, motif, octave, start_beat, prog, key_pcs_at):
    """Motif → notes; long notes that clash with the bar's chord move to its nearest chord tone."""
    out, b = [], start_beat
    for deg, beats in motif:
        if deg is not None:
            m = scale_note(key, deg, octave)
            if beats >= 2:
                pcs = key_pcs_at(b)
                if m % 12 not in pcs:
                    m = min((m + d for d in range(-2, 3) if (m + d) % 12 in pcs), key=lambda x: abs(x - m))
            out.append((b, m, beats))
        b += beats
    return out


# ---- the two cue types ----
def calm(mid, P):
    c = Cue(f'{mid}_calm', seed_of(mid))
    key, prog = P['key'], P['prog']
    chords = [chord_pcs(key, d) for d in prog]
    pcs_at = lambda beat: chords[int(beat // 8) % 8][0]
    prev = None
    for i, (pcs, root) in enumerate(chords):
        t = i * 2 * BAR
        v = voice(pcs, 50, 69, prev); prev = v
        first = i == 0
        for k, inst in enumerate(P['pad']):
            lo = {'cellos': 43, 'trombone': 46, 'horn': 50}.get(inst, 50)
            vv = voice(pcs, lo, lo + 17, v if inst not in ('cellos', 'trombone') else None)
            for j, m in enumerate(vv):
                c.note(inst, t, m, 2 * BAR + .4, vel=.42 if inst != 'violins_trem' else .3,
                       pan=(j - 1) * .35 + (k - .5) * .2, atk=2.5 if first else .9, rel=1.6, send=.38,
                       gain=.8 if inst in ('horn', 'trombone') else 1.0)
        bm = root_in(root, 31 if P['bass'] in ('contrabass', 'contrabass_pizz', 'tuba') else 36)
        if P['bass'] == 'contrabass_pizz':
            for b in range(8):
                if b % 2 == 0: c.note('contrabass_pizz', t + b * BEAT, bm, BEAT, vel=.5, send=.25, gain=.9)
        else:
            c.note(P['bass'], t, bm, 2 * BAR + .3, vel=.45, atk=1.2 if not first else 2.5, rel=1.4, send=.3, gain=.75)
        if P.get('walk'):          # town: soft pizzicato steps through the chord
            tones = sorted(root_in(p, 43) for p in pcs)
            for b in range(8):
                if b % 2 == 1:
                    c.note(P['walk'], t + b * BEAT, tones[(b // 2) % 3] + (12 if b == 7 else 0), BEAT, vel=.38, pan=.3, send=.3)
        if P.get('ostinato'):      # railway: low spiccato eighths, like wheels on the joints
            tones = sorted(root_in(p, 43) for p in pcs)
            pat = [0, 0, 2, 0, 1, 0, 2, 1]
            for e in range(16):
                c.note(P['ostinato'], t + e * BEAT / 2, tones[pat[e % 8]], BEAT / 2, vel=.42 if e % 4 == 0 else .3,
                       pan=-.2, send=.25, gain=.8)
        if P.get('timp') and i % 2 == 0:   # a distant drum on the strong chords
            c.note('timpani', t, root_in(root, 41), 3, vel=.35, send=.7, gain=.6)
            c.note('timpani', t + 2 * BAR - BEAT, root_in((root + 7) % 12, 41), 2, vel=.25, send=.7, gain=.5)
        if P.get('color') == 'harp' and i % 2 == 1:   # a slow broken chord, rising
            for j, m in enumerate(sorted(root_in(p, 55) for p in pcs) + [root_in(root, 67)]):
                c.note('harp', t + BAR + j * BEAT * .5, m, 3, vel=.35, pan=.4, send=.45, gain=.7)
    if P.get('solo'):
        for start in (2 * 4, 10 * 4):     # phrases from bar 2 and bar 10, rests between
            for b, m, beats in melody(key, P['motif'], P['solo_oct'], start, prog, pcs_at):
                c.note(P['solo'], b * BEAT, m, beats * BEAT * .95, vel=.5 + .1 * c.rng.random(),
                       pan=.15, atk=.12, rel=.5, send=P.get('solo_send', .4), gain=.45)
    # synth layer, very low, across the loop (and over the seam: the tail folds back)
    syn = P.get('synth')
    for t in range(0, int(LOOP), 15):
        if syn in ('air', 'sea'):
            c.synth(t, 'air', amp=.022 if syn == 'air' else .03, atk=6, sus=6, rel=6,
                    lo=350 if syn == 'air' else 150, hi=2400 if syn == 'air' else 900)
        elif syn == 'pad':
            c.synth(t, 'pad', freq=440 * 2 ** ((root_in(key, 38) - 69) / 12), amp=.035, atk=6, sus=6, rel=6, cutoff=600)
        elif syn in ('hum', 'hum_radar'):
            c.synth(t, 'hum', freq=440 * 2 ** ((root_in(key, 31) - 69) / 12), amp=.018, atk=5, sus=7, rel=5,
                    rate=BPM / 60 / (1 if syn == 'hum_radar' else 2), cutoff=700)
    return c


def alarm(mid, P):
    c = Cue(f'{mid}_alarm', seed_of(mid + '-alarm'))
    key, prog = P['key'], P['prog']
    chords = [chord_pcs(key, d) for d in prog]
    prev = None
    for i, (pcs, root) in enumerate(chords):
        t = i * 2 * BAR
        tones = sorted(root_in(p, 38) for p in pcs)
        # driving low strings in sixteenths, accents on the beat
        pat = [0, 0, 0, 2, 0, 0, 1, 0]
        for s in range(32):
            m = tones[pat[s % 8]]
            acc = s % 4 == 0
            c.note('cellos_spic', t + s * BEAT / 4, m, BEAT / 4, vel=.75 if acc else .5, pan=-.25, send=.2, gain=.9)
            if s % 2 == 0:
                c.note('contrabass_pizz', t + s * BEAT / 4, m - 12, BEAT / 2, vel=.6 if acc else .45, send=.15, gain=.8)
                c.synth(t + s * BEAT / 4 + .02, 'drive', freq=440 * 2 ** ((m - 12 - 69) / 12), amp=.035 if acc else .022,
                        sus=BEAT / 4, cutoff=900)
        # repeated piano chords on every beat: the tension on top
        v = voice(pcs, 62, 81, prev); prev = v
        for q in range(8):
            for j, m in enumerate(v):
                c.note('piano', t + q * BEAT, m, BEAT * .9, vel=.55 if q % 4 == 0 else .42, pan=(j - 1) * .3, send=.3, gain=.75)
        # brass stabs: beat 1 and the "and" of 2, each bar; horns above, trombones below
        for b in range(2):
            for at in (0, 1.5):
                tb = t + b * BAR + at * BEAT
                for m in voice(pcs, 46, 60):
                    c.note('trombone_stac', tb, m, .3, vel=.7 if at == 0 else .55, pan=.2, send=.3, gain=.7)
                for m in voice(pcs, 55, 69):
                    c.note('horn_stac', tb, m, .3, vel=.6 if at == 0 else .5, pan=.35, send=.35, gain=.6)
        # timpani on 1 and 3, snare on the off-beats, a sixteenth roll into each four-bar line
        for b in range(2):
            c.note('timpani', t + b * BAR, root_in(root, 41), 1.5, vel=.7, send=.35, gain=.9)
            c.note('timpani', t + b * BAR + 2 * BEAT, root_in((root + 7) % 12, 41), 1.2, vel=.5, send=.35, gain=.8)
            for e in (1, 3, 5, 7):
                c.note('snare', t + b * BAR + e * BEAT / 2, None, .3, vel=.45, var='on', pan=-.1, send=.25, gain=.8)
        if i % 2 == 1:
            for s in range(4):
                c.note('snare', t + 2 * BAR - BEAT + s * BEAT / 4, None, .2, vel=.4 + .1 * s, var='on', send=.25, gain=.8)
    return c


def cues():
    out = {}
    for mid, P in MISSIONS.items():
        out[f'{mid}_calm'] = lambda mid=mid, P=P: calm(mid, P)
        out[f'{mid}_alarm'] = lambda mid=mid, P=P: alarm(mid, P)
    return out


if __name__ == '__main__':
    outdir = sys.argv[1]
    want = sys.argv[2:] or list(cues())
    for name in want:
        c = cues()[name]()
        c.write(os.path.join(outdir, name))
        print(f'{name}: {len(c.notes)} notes, {len(c.synths)} synths, {len(c.bufs)} samples')
