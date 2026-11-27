// Thunder for the storm (world/storm.js), rendered offline (NRT) like the music: all filtered noise,
// no tones (no bells, no ringing sines). thunder.py runs it once per file.
// env KIND: near (a strike close by: the crack, the tear across the sky, the roll), far (a roll
//   from miles off, no crack), strike (a bolt into the ground a stone's throw away: a hard snap
//   and a sizzle), bed (the storm's own low rumble and wind gusts, for a loop).
// env SEED (an integer: each file different), DUR (seconds), OUT_WAV (stereo 48 kHz 24-bit).
(
var kind = "KIND".getenv.asSymbol, seed = "SEED".getenv.asInteger, dur = "DUR".getenv.asFloat, out = "OUT_WAV".getenv;
var defs, list, opts, score;
defs = [
  SynthDef(\near, { |dur = 8, seed = 1|
    var crack, tear, roll, sub, sig, rollEnv;
    RandSeed.ir(1, seed);
    // The crack: a dense spray of clicks, falling from bright to dull in half a second.
    crack = HPF.ar(Dust2.ar([1, 1] * XLine.kr(9000, 500, 0.5)), 700) * 1.6 + HPF.ar(WhiteNoise.ar([1, 1]), 2500) * 0.4;
    crack = crack * EnvGen.ar(Env([0, 1, 0.35, 0], [0.003, 0.09, 0.4], [0, -4, -4]));
    // The tear: a ripping mid band racing down the sky in the first second and a half.
    tear = BPF.ar(WhiteNoise.ar([1, 1]), XLine.kr(Rand(1800, 2800), 420, 1.5), 0.55) * LFNoise1.ar([37, 43]).range(0.15, 1.3);
    tear = tear * EnvGen.ar(Env([0, 1, 0.5, 0], [0.04, 0.45, 1.1], [1, -2, -3]));
    // The roll: brown noise sweeping down through the valley, lumpy as the echoes come back.
    rollEnv = EnvGen.ar(Env([0, 1, 0.75, 0.4, 0], [0.12, 1.4, 2.4, dur - 4.0], [2, -1, -2, -3]), doneAction: 2);
    roll = LPF.ar(BrownNoise.ar([1, 1]), XLine.kr(2600, 160, dur * 0.8)) * LFNoise1.ar(LFNoise1.kr([0.6, 0.5]).range(2.5, 8)).range(0.12, 1).squared;
    sub = LPF.ar(WhiteNoise.ar([1, 1]), 65) * 5;
    sig = crack * 0.75 + (tear * 0.9) + ((roll * 1.3 + sub) * rollEnv);
    sig = sig + (FreeVerb2.ar(sig[0], sig[1], 0.45, 0.95, 0.6));
    Out.ar(0, LeakDC.ar(sig));
  }),
  SynthDef(\far, { |dur = 10, seed = 1|
    var env, roll, sig;
    RandSeed.ir(1, seed);
    env = EnvGen.ar(Env([0, 0.6, 1, 0.5, 0], [0.5, Rand(0.6, 1.4), 2.5, dur - 4.6], [2, 0, -2, -3]), doneAction: 2);
    roll = LPF.ar(BrownNoise.ar([1, 1]), XLine.kr(Rand(500, 800), 120, dur * 0.85)) * LFNoise1.ar(LFNoise1.kr([0.3, 0.35]).range(1.2, 4)).range(0.1, 1).squared;
    sig = (roll * 1.6 + (LPF.ar(WhiteNoise.ar([1, 1]), 55) * 4)) * env;
    sig = sig + (FreeVerb2.ar(sig[0], sig[1], 0.5, 0.98, 0.7));
    Out.ar(0, LeakDC.ar(sig));
  }),
  SynthDef(\strike, { |dur = 4, seed = 1|
    var snap, sizzle, boom, sig;
    RandSeed.ir(1, seed);
    // A bolt into the ground near you: a hard snap, a sizzle of burning sap and earth, the boom under it.
    snap = (HPF.ar(WhiteNoise.ar([1, 1]), 1200) + HPF.ar(Dust2.ar([1, 1] * 12000), 400)) * EnvGen.ar(Env([0, 1, 0.2, 0], [0.001, 0.03, 0.25], [0, -6, -4]));
    sizzle = HPF.ar(Dust2.ar([1, 1] * XLine.kr(4000, 300, dur * 0.7)), 2500) * EnvGen.ar(Env([0, 0.5, 0.25, 0], [0.05, 0.8, dur - 0.9], [0, -2, -4]));
    boom = LPF.ar(BrownNoise.ar([1, 1]), XLine.kr(1800, 120, dur * 0.6)) * 1.5 + (LPF.ar(WhiteNoise.ar([1, 1]), 60) * 6);
    boom = boom * EnvGen.ar(Env([0, 1, 0.3, 0], [0.008, 0.6, dur - 0.65], [0, -3, -3]), doneAction: 2);
    sig = snap * 1.1 + (sizzle * 0.5) + boom;
    sig = sig + (FreeVerb2.ar(sig[0], sig[1], 0.35, 0.9, 0.5));
    Out.ar(0, LeakDC.ar(sig));
  }),
  SynthDef(\bed, { |dur = 34, seed = 1|
    var rumble, gusts, sig;
    RandSeed.ir(1, seed);
    // The storm's own low rumble, swelling and sinking, and the wind gusting over it.
    rumble = LPF.ar(BrownNoise.ar([1, 1]), LFNoise2.kr([0.07, 0.08]).range(90, 220)) * LFNoise2.kr([0.11, 0.09]).range(0.05, 1).squared * 1.4;
    gusts = BPF.ar(PinkNoise.ar([1, 1]), LFNoise2.kr([0.13, 0.15]).exprange(250, 900), 0.4) * LFNoise2.kr([0.17, 0.19]).range(0.1, 1).squared * 1.6;
    sig = (rumble + gusts) * EnvGen.ar(Env.linen(0.01, dur - 0.02, 0.01), doneAction: 2);
    Out.ar(0, LeakDC.ar(sig));
  }),
];
list = defs.collect { |d| [0.0, [\d_recv, d.asBytes]] };
list = list ++ [[0.01, [\s_new, kind, 1000, 0, 0, \dur, dur, \seed, seed]], [dur, [\c_set, 0, 0]]];
score = Score(list);
opts = ServerOptions.new.numOutputBusChannels_(2).sampleRate_(48000).memSize_(65536).verbosity_(-1);
score.recordNRT(outputFilePath: out, sampleRate: 48000, headerFormat: "WAV", sampleFormat: "int24",
  options: opts, duration: dur, action: { "ALL DONE".postln; 0.exit });
)
