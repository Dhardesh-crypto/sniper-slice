// The Germans read their reports. What you've leaned on in the missions you've finished changes the
// orders the next garrison gets, and Ellis tells you so on the dispatch card. Your habits fade by
// half with each mission, so change how you work and they'll change too.
const THRESHOLD = 3;

// What each habit brings. apply(game) runs once the mission's systems are built.
const ORDERS = {
  long: { text: 'Intercepts say their posts have been told to watch the high ground with field glasses. They will pick you out further off.', sight: 1.2 },
  knife: { text: 'Word is the men have been ordered to keep in sight of each other. A partner gone quiet will be missed sooner, and they are listening harder.', ears: 1.3, mate: 40 },
  bodies: { text: 'They are tired of finding their dead. More dogs have been brought up.', dogs: 1 },
  loud: { text: 'After all that noise they have strung more tin cans and spread more glass on the ways in.', alarms: 3 },
};

// This mission's orders (or null). Only the habit you've leaned on hardest.
export function garrisonOrders(habits) {
  const [id, score] = Object.entries(habits).sort((a, b) => b[1] - a[1])[0] ?? [];
  return score >= THRESHOLD && ORDERS[id] ? { id, ...ORDERS[id] } : null;
}

// A finished mission goes on your record.
export function noteHabits(profile, stats, alarms) {
  const was = profile.habits, h = {};
  const seen = { long: stats.longKills, knife: stats.takedowns, bodies: stats.bodiesFound, loud: alarms * 2 };
  for (const k of Object.keys(ORDERS)) h[k] = (was[k] ?? 0) * 0.5 + (seen[k] ?? 0);
  profile.setHabits(h);
}
