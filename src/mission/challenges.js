// Things to try in each mission, beyond the orders: met once, they stay met (kept in the profile).
// Every fifth one across the campaign brings a weapon part you don't have.
const PER_PART = 5;
const PAR = 15 * 60;         // s

// { id, text, offered?(mission), met(sum) }; sum: { stats, rating, alarms, time, mission }.
const LIST = [
  { id: 'ghost', text: 'Finish with a GHOST rating: never spotted, no alarm', met: s => s.rating === 'GHOST' },
  { id: 'quiet', text: 'Finish without the alarm being raised', met: s => s.alarms === 0 },
  { id: 'clean', text: 'Finish with no body found', met: s => s.stats.bodiesFound === 0 },
  { id: 'long', text: 'Make a kill from 250 m or more', met: s => s.stats.longest >= 250 },
  { id: 'heads', text: 'Five headshots', met: s => s.stats.headshots >= 5 },
  { id: 'blade', text: 'Kill the target with the knife', offered: m => !!m.officer, met: s => s.stats.targetBy === 'knife' },
  { id: 'one', text: 'Kill nobody but the target', offered: m => !!m.officer, met: s => s.stats.kills === 1 && !s.mission.officer.alive },
  { id: 'thorough', text: 'Finish every optional objective', offered: m => m.objectives.some(o => o.optional), met: s => s.mission.objectives.every(o => !o.optional || o.done) },
  { id: 'reader', text: 'Find every document', offered: m => (m.documentsTotal ?? 0) > 0, met: s => (s.mission.interactions?.found.size ?? 0) >= s.mission.documentsTotal },
  { id: 'quick', text: 'Finish in under 15 minutes', met: s => s.time < PAR },
];

export const challengesFor = (mission) => LIST.filter(c => c.offered?.(mission) ?? true);

// The end of a mission: what's newly met, and any part that earns.
export function scoreChallenges({ profile, missionId, mission, sum, pickups }) {
  const before = profile.challengeCount;
  const fresh = challengesFor(mission).filter(c => c.met(sum) && profile.addChallenge(missionId, c.id));
  const earned = Math.floor(profile.challengeCount / PER_PART) - Math.floor(before / PER_PART);
  const parts = [];
  for (let i = 0; i < earned; i++) { const p = pickups.givePart(); if (p) parts.push(p.name); }
  return { fresh, parts };
}

// For the briefing: the list, with what's done.
export function challengesHtml(mission, done) {
  const list = challengesFor(mission);
  return `<p class="brief"><b>Challenges (${list.filter(c => done.includes(c.id)).length} / ${list.length}):</b> ${list.map(c => done.includes(c.id) ? `<s>${c.text}</s>` : c.text).join(' · ')}.</p>`;
}
