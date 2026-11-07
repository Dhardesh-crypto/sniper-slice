// Offline (NRT) renderer for one cue written by compose.py.
// env CUE_DIR: folder with meta.txt (duration), bufs.txt (one sample path per line),
//   notes.txt ("t buf rate start sus amp pan atk rel send" per line),
//   synths.txt ("t def key value key value ..." per line).
// env OUT_WAV: the stereo 48 kHz 24-bit file to write. Posts "ALL DONE" when finished.
// The samples are CC0 orchestral recordings (VSCO 2 CE, VCSL); everything else is synthesis.
(
var dir, out, read, dur, bufs, notes, synths, defs, list, opts, score, verbBus = 16;
dir = "CUE_DIR".getenv; out = "OUT_WAV".getenv;
read = { |f| File.readAllString(dir +/+ f).split($\n).reject { |l| l.isEmpty } };
dur = read.("meta.txt")[0].asFloat;
bufs = read.("bufs.txt");
notes = read.("notes.txt").collect { |l| l.split($ ).collect(_.asFloat) };
synths = read.("synths.txt").collect { |l|
  var w = l.split($ );
  [w[0].asFloat, w[1].asSymbol, w[2..].collect { |x, i| if(i.even) { x.asSymbol } { x.asFloat } }]
};

defs = [
  // A sample at a given rate, from a start frame, with a linear-ish envelope. Dry to the
  // main out, `send` of it to the hall.
  SynthDef(\samp, { |buf = 0, rate = 1, start = 0, sus = 1, amp = 0.1, pan = 0, atk = 0.01, rel = 0.3, send = 0.3|
    var env = EnvGen.kr(Env.linen(atk, sus, rel, 1, [1, 0, -2]), doneAction: 2);
    var sig = PlayBuf.ar(2, buf, rate * BufRateScale.kr(buf), 1, start, 0, doneAction: 2);
    sig = Balance2.ar(sig[0], sig[1], pan) * env * amp;
    Out.ar(0, sig); Out.ar(verbBus, sig * send);
  }),
  // Warm under-pad: detuned saws, low-passed hard, slowly breathing. Sits under the strings.
  SynthDef(\pad, { |freq = 110, amp = 0.05, atk = 3, sus = 4, rel = 4, cutoff = 700, pan = 0, send = 0.4|
    var env = EnvGen.kr(Env.linen(atk, sus, rel, 1, [2, 0, -3]), doneAction: 2);
    var sig = Mix(Saw.ar(freq * [-0.1, -0.03, 0.04, 0.09].midiratio)) * 0.25;
    sig = RLPF.ar(sig, (cutoff * LFNoise2.kr(0.1).exprange(0.75, 1.3)).clip(150, 6000), 0.8);
    sig = Pan2.ar(sig, (pan + LFNoise2.kr(0.07, 0.25)).clip(-1, 1)) * env * amp;
    Out.ar(0, sig); Out.ar(verbBus, sig * send);
  }),
  // Air: band-passed pink noise, wandering. Wind on the hills, sea under the harbour.
  SynthDef(\air, { |amp = 0.03, atk = 4, sus = 8, rel = 4, lo = 300, hi = 2000, q = 0.35|
    var env = EnvGen.kr(Env.linen(atk, sus, rel, 1, [2, 0, -2]), doneAction: 2);
    var sig = BPF.ar(PinkNoise.ar([1, 1]), LFNoise2.kr([0.13, 0.11]).exprange(lo, hi), q) * 2;
    Out.ar(0, sig * env * amp);
  }),
  // Hum: a valve set's low drone with a slow pulse in it (radar, generators). Harmonics,
  // no pings: no long-decay sines, no FM.
  SynthDef(\hum, { |freq = 58, amp = 0.03, atk = 4, sus = 8, rel = 4, rate = 0.5, cutoff = 900|
    var env = EnvGen.kr(Env.linen(atk, sus, rel, 1, [2, 0, -2]), doneAction: 2);
    var sig = LPF.ar(Pulse.ar(freq * [1, 1.004], 0.4) + (Saw.ar(freq * 2) * 0.3), cutoff);
    sig = sig * (0.7 + (0.3 * SinOsc.kr(rate).range(0, 1)));
    Out.ar(0, sig * env * amp);
  }),
  // Drive: a filtered saw doubling the alarm's bass ostinato so it speaks on small speakers.
  SynthDef(\drive, { |freq = 55, amp = 0.05, sus = 0.15, cutoff = 1200|
    var env = EnvGen.kr(Env.linen(0.003, sus, 0.08, 1, -3), doneAction: 2);
    var sig = RLPF.ar(Saw.ar(freq * [1, 1.006]), cutoff * env.range(0.4, 1), 0.6);
    Out.ar(0, sig * env * amp);
  }),
  // The hall: pre-delay, low cut so the reverb doesn't muddy, FreeVerb, wet only.
  SynthDef(\hall, { |room = 0.88, damp = 0.55|
    var sig = DelayN.ar(In.ar(verbBus, 2), 0.05, 0.03);
    sig = LPF.ar(HPF.ar(sig, 160), 6500);
    Out.ar(0, FreeVerb2.ar(sig[0], sig[1], 1, room, damp));
  })
];

list = defs.collect { |d| [0.0, [\d_recv, d.asBytes]] };
list = list ++ bufs.collect { |p, i| [0.0, [\b_allocRead, i, p]] };
list = list ++ [[0.0, [\s_new, \hall, 1000, 1, 0]]];
notes.do { |n|
  list = list.add([n[0] + 0.02, [\s_new, \samp, -1, 0, 0, \buf, n[1].asInteger, \rate, n[2], \start, n[3],
    \sus, n[4], \amp, n[5], \pan, n[6], \atk, n[7], \rel, n[8], \send, n[9]]]);
};
synths.do { |s| list = list.add([s[0] + 0.02, [\s_new, s[1], -1, 0, 0] ++ s[2]]) };
list = list.add([dur, [\c_set, 0, 0]]);

score = Score(list);
score.sort;
opts = ServerOptions.new.numOutputBusChannels_(2).sampleRate_(48000).numBuffers_(4096)
  .memSize_(65536).maxNodes_(8192).verbosity_(-1);
("rendering % notes, % synths, % samples, % s".format(notes.size, synths.size, bufs.size, dur)).postln;
score.recordNRT(outputFilePath: out, sampleRate: 48000, headerFormat: "WAV", sampleFormat: "int24",
  options: opts, duration: dur, action: { "ALL DONE".postln; 0.exit });
)
