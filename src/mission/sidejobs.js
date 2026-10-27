// Side jobs: two optional tasks drawn at random for each run, on top of the mission's own, so no
// two runs ask the same of you. The pool works on any map: a marked man among the guards (a name,
// a rank, where he was last reported), a long shot, the target down before any alarm or before any
// body is found, knife takedowns, headshots, and intel papers left on tables in the houses. Each is
// checked against what the game already counts (Mission.stats, the alarm, the documents read).
// The draw is seeded and the seed goes into the save, so a loaded game has the same jobs.
import * as THREE from 'three';

const RANKS = ['Feldwebel', 'Unteroffizier', 'Obergefreiter', 'Leutnant', 'Oberfeldwebel', 'Stabsgefreiter'];
const NAMES = ['Brandt', 'Hartmann', 'Vogel', 'Kessler', 'Lindner', 'Roth', 'Seidel', 'Winkler', 'Albrecht', 'Krüger', 'Haas', 'Engel'];
const ROLES = [
  'the paymaster', 'who shot the hostages at Sant\'Anna', 'the quartermaster selling the village\'s grain', 'the sniper who killed two of our scouts',
  'who signs the deportation lists', 'the radio operator who betrayed the partisan cell', 'who runs the black market in fuel',
];
const INTEL = [
  ['A letter home', 'Dear Mother,\nThey have us digging again. The Lieutenant says the Americans will not come this way, but he has sent his own things north. The food is bad and the wine is worse. Kiss Lotte for me.\n— Walter'],
  ['Strength return', 'Garrison strength, as of Monday:\n2 officers, 4 NCOs, 31 men.\n1 MG42 (sandbagged position), 2 spare barrels.\nFuel: 600 litres. Ammunition: adequate.\nMorale: fair. Two cases of dysentery.'],
  ['Minefield sketch', 'A pencil sketch of the approaches: the ditch along the south road is mined (Teller mines, 30 paces apart); the orchard path is clear for our own patrols. "Do NOT use the bridge path after dark."'],
  ['Sentry schedule', 'Night sentries change at 22:00, 01:00 and 04:00. The 04:00 relief is always late. The dog handler has been sent to the coast; the kennels are empty.'],
  ['Partisan list', 'Names of villagers suspected of helping the bandits, with addresses. Three are underlined twice. At the bottom: "Collect on Sunday after Mass."'],
  ['Requisition order', 'All livestock, cheese and oil from the farms between the river and the ridge to be delivered to the depot by the end of the month. Farmers who refuse to be reported to the Feldgendarmerie.'],
  ['Pay book', 'A soldier\'s Soldbuch. In the back, a photograph of a girl on a bicycle, and a list of debts to other men in the platoon, most of them crossed out.'],
  ['Signal codes', 'This week\'s flare signals: two green, "enemy in sight"; one red, "need support"; white, "withdraw". The radio call sign changes to EMIL on Thursday.'],
];

const rngFrom = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// The jobs: applies(ctx) says whether this map can have it; make(ctx, rnd) returns its objective
// text and check() → 'done' | 'failed' | null, plus markers() for the compass and the map.
const POOL = {
  marked: {
    applies: (c) => c.world.soldiers.some(s => candidate(s)),
    make(c, rnd) {
      const list = c.world.soldiers.filter(candidate), s = list[Math.floor(rnd() * list.length)];
      const name = `${RANKS[Math.floor(rnd() * RANKS.length)]} ${NAMES[Math.floor(rnd() * NAMES.length)]}`;
      const role = ROLES[Math.floor(rnd() * ROLES.length)];
      s.marked = name;
      s.label = () => name.toUpperCase();     // (his name in the code stays: missions find men by it)
      const seen = s.root.position.clone();
      return {
        text: `Eliminate ${name}, ${role} (tag him with the binoculars to follow him)`,
        check: () => (!s.alive ? 'done' : null),
        markers: () => s.alive ? [s.tagged ? { pos: s.root.position, kind: 'target', label: name.split(' ')[1].toUpperCase(), height: 2.4 } : { pos: seen, kind: 'target', label: 'LAST REPORTED', height: 4 }] : [],
        message: `${name.toUpperCase()} IS DEAD`,
      };
    },
  },
  longshot: {
    applies: () => true,
    make(c, rnd) {
      const m = [150, 200, 250][Math.floor(rnd() * 3)];
      return { text: `Make a kill from ${m} m or more`, check: () => (c.mission.stats.longest >= m ? 'done' : null), message: `${m} M KILL` };
    },
  },
  ghost: {
    applies: (c) => !!c.mission.officer && !!c.ai.siren,
    make(c) {
      return {
        text: 'Take down the target before any alarm is raised',
        check: () => c.ai.alarm.count > 0 && c.mission.officer.alive ? 'failed' : !c.mission.officer.alive && c.ai.alarm.count === 0 ? 'done' : null,
        message: 'TARGET DOWN · NO ALARM',
      };
    },
  },
  unseen: {
    applies: (c) => !!c.mission.officer,
    make(c) {
      return {
        text: 'Take down the target before anyone finds a body',
        check: () => c.mission.stats.bodiesFound > 0 && c.mission.officer.alive ? 'failed' : !c.mission.officer.alive && c.mission.stats.bodiesFound === 0 ? 'done' : null,
        message: 'TARGET DOWN · NO BODY FOUND',
      };
    },
  },
  knife: {
    applies: () => true,
    make(c, rnd) {
      const n = 2 + Math.floor(rnd() * 2), from = c.mission.stats.takedowns;
      return { text: `Take down ${n} guards with the knife`, check: () => (c.mission.stats.takedowns - from >= n ? 'done' : null), message: `${n} KNIFE TAKEDOWNS` };
    },
  },
  headshots: {
    applies: () => true,
    make(c, rnd) {
      const n = 3 + Math.floor(rnd() * 3), from = c.mission.stats.headshots;
      return { text: `Kill ${n} men with headshots`, check: () => (c.mission.stats.headshots - from >= n ? 'done' : null), message: `${n} HEADSHOTS` };
    },
  },
  intel: {
    applies: (c) => tableTops(c.world, Math.random).length >= 3,
    make(c, rnd) {
      const tops = tableTops(c.world, rnd), picked = [];
      while (picked.length < 3 && tops.length) {
        const t = tops.splice(Math.floor(rnd() * tops.length), 1)[0];
        if (picked.every(p => p.distanceTo(t) > 6)) picked.push(t);
      }
      if (picked.length < 3) return null;
      const texts = [...INTEL], ids = [];
      picked.forEach((at, i) => {
        const [title, text] = texts.splice(Math.floor(rnd() * texts.length), 1)[0];
        const id = `side-intel-${i}`;
        ids.push(id);
        c.interactions.addDocument({ id, title, text, at });
      });
      return {
        text: 'Find the 3 intelligence papers left on tables in the buildings',
        check: () => (ids.every(id => c.interactions.found.has(id)) ? 'done' : null),
        message: 'ALL THE INTELLIGENCE PAPERS FOUND',
      };
    },
  },
};
const EXCLUSIVE = [['ghost', 'unseen']];

function candidate(s) { return s.alive && !s.officer && !s.range && s.brain && !s.brain.fixed && s.name !== 'Reinforcement'; }

// Table tops indoors where papers can lie: the solid tables and the missions' own (0.7-0.85 m high).
function tableTops(world, rnd) {
  const out = [];
  for (const b of world.boxes) {
    const h = b.max.y - b.min.y, w = b.max.x - b.min.x, d = b.max.z - b.min.z;
    if (h < 0.7 || h > 0.85 || w < 0.6 || d < 0.5 || w > 3 || d > 3) continue;
    if (Math.abs(b.min.y - world.groundAt((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2)) > 6) continue;
    out.push(new THREE.Vector3((b.min.x + b.max.x) / 2 + (rnd() - 0.5) * w * 0.3, b.max.y + 0.005, (b.min.z + b.max.z) / 2));
  }
  return out;
}

export class SideJobs {
  // ctx: { world, mission, ai, interactions, hud, saves }
  constructor(ctx) {
    this.c = ctx;
    const pending = (() => { try { return sessionStorage.getItem('sniper-slice.pendingLoad'); } catch { return null; } })();
    this.seed = (pending && ctx.saves?.read(pending)?.mission?.stats?.jobSeed) || Math.floor(Math.random() * 2 ** 31);
    ctx.mission.stats.jobSeed = this.seed;
    const rnd = rngFrom(this.seed), keys = Object.keys(POOL).filter(k => POOL[k].applies(ctx));
    this.jobs = [];
    while (this.jobs.length < 2 && keys.length) {
      const k = keys.splice(Math.floor(rnd() * keys.length), 1)[0];
      if (EXCLUSIVE.some(g => g.includes(k) && this.jobs.some(j => g.includes(j.key)))) continue;
      const job = POOL[k].make(ctx, rnd);
      if (!job) continue;
      const id = `side-${k}`;
      ctx.mission.objectives.splice(ctx.mission.objectives.length - 1, 0, { id, text: `Side job: ${job.text}`, optional: true, done: false });
      this.jobs.push({ ...job, key: k, id });
    }
    // The marked man and the like on the compass and the map.
    const own = ctx.mission.markers.bind(ctx.mission);
    ctx.mission.markers = () => [...own(), ...this.jobs.flatMap(j => (ctx.mission.obj(j.id)?.done ? [] : j.markers?.() ?? []))];
  }

  tick() {
    const m = this.c.mission;
    if (m.done) return;
    for (const j of this.jobs) {
      const o = m.obj(j.id);
      if (!o || o.done || o.failed) continue;
      const r = j.check();
      if (r === 'done') m.complete(j.id, `SIDE JOB DONE · ${j.message}`);
      else if (r === 'failed') { o.failed = true; o.text += ' · FAILED'; this.c.hud.message('SIDE JOB FAILED', 'wound'); }
    }
  }
}
