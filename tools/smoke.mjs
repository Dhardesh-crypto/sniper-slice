// Smoke test: every mission loaded and played for a while in a headless Chromium, reporting
// console errors, uncaught exceptions, failed requests and the frame time. It catches the kind of
// bug the MG42 one was (fine on a calm map, falling apart once the shooting starts) before it ships.
//   npm run dev            (or vite preview of a build)
//   node tools/smoke.mjs [url] [mission ...]      default url http://localhost:5179, all missions
// For each mission: load it, start it (as the pad would: no pointer lock needed), let it settle,
// then 10 s of play with the alarm raised near the target and a few rifle shots, timed frame by
// frame. Exits 1 if any mission logged an error or a request failed.
// Uses the Chromium Playwright keeps in ~/Library/Caches/ms-playwright (no npm package): spoken to
// over the DevTools protocol with Node's own WebSocket. Frame times come from a headless window, so
// read them against each other (mission to mission, before and after), not as a real screen's.
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = args[0]?.startsWith('http') ? args.shift() : 'http://localhost:5179';
const url = base + (base.includes('?') ? '&' : '?') + 'mute';   // (silent twice over: ?mute in the game, --mute-audio in Chromium)
const MISSIONS = args.length ? args : ['vineyard', 'town', 'harbour', 'forest', 'flak', 'railway', 'bridge', 'airfield', 'radar'];
const PORT = 9333;

function chromium() {
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  for (const d of readdirSync(root).filter(d => d.startsWith('chromium_headless_shell')).sort().reverse()) {
    const p = join(root, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(p)) return p;
  }
  throw new Error('no headless Chromium in ' + root);
}

const browser = spawn(chromium(), [`--remote-debugging-port=${PORT}`, '--window-size=1280,720', 
  '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'smoke-'))}`, 'about:blank'], { stdio: 'ignore' });
// However this run ends (finished, an error, stopped with Ctrl-C or killed by a tool), its
// Chromium goes with it: left running, a game in it carries on (alarm and all).
const stop = () => { try { browser.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stop(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); stop(); process.exit(1); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chromium did not start');
}

const ws = new WebSocket(await connect());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const waiting = new Map(), events = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  else if (msg.method) events.push(msg);
});
const send = (method, params = {}) => new Promise((res) => { const id = nextId++; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr, timeout = 120000) => {
  const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(timeout).then(() => ({ timeout: true }))]);
  if (r.timeout) throw new Error('timed out: ' + expr.slice(0, 60));
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');

// What one mission's run does, inside the page.
const PLAY = `(async () => {
  const t0 = performance.now();
  while (!(window.game && game.assets?.clips?.idle && document.getElementById('play') && !/loading/i.test(document.getElementById('play').textContent))) {
    if (performance.now() - t0 > 90000) throw new Error('never finished loading');
    await new Promise(r => setTimeout(r, 300));
  }
  const g = game, load = Math.round(performance.now() - t0);
  g.input.setDevice('pad');
  document.getElementById('play').click();
  await new Promise(r => setTimeout(r, 300));
  const card = document.getElementById('dispatch');
  if (card.classList.contains('on')) { card.click(); card.click(); }
  await new Promise(r => setTimeout(r, 200));
  g.tutorial?.finish?.();
  g.advance(1);
  // Timed in blocks of ten simulation steps with one render (a headless window renders slowly,
  // and its render time says little): each block's time / 10 is a step's cost, render shared out.
  const frames = [];
  const timed = (n) => { for (let i = 0; i < n; i += 10) { const a = performance.now(); g.advance(10 / 60); frames.push((performance.now() - a) / 10); } };
  timed(120);                                     // calm
  const target = g.world.soldiers.find(s => s.officer || s.target) ?? g.world.soldiers.find(s => !s.range);
  if (target) g.stealth.noise(target.root.position.clone(), 300, 'explosion');   // everyone hears it: routes, alarms, reinforcements
  for (let k = 0; k < 4; k++) {
    if (target?.alive) { const p = target.root.position; g.aimAt(p.x + 3 * k, p.y + 1.2, p.z); }
    g.input.pressed.add('Mouse0'); g.input.buttons.add('Mouse0');
    g.advance(2 / 60); g.input.buttons.delete('Mouse0');
    timed(120);
  }
  frames.sort((a, b) => a - b);
  const q = (f) => +frames[Math.floor(f * (frames.length - 1))].toFixed(1);
  const ways = [...document.querySelectorAll('#approaches .way b')].map(b => b.textContent.replace('From the ', ''));
  return { load, frames: frames.length, median: q(0.5), p95: q(0.95), worst: q(1), soldiers: g.world.soldiers.length, alarm: !!g.stealth.alarm, ways, silent: !g.audio?.master || g.audio.master.gain.value === 0 };
})()`;

const report = [];
let failed = false;
for (const id of MISSIONS) {
  events.length = 0;
  await send('Page.navigate', { url });
  await sleep(1500);
  await evaluate(`sessionStorage.setItem('sniper-slice.mission', ${JSON.stringify(id)}); localStorage.removeItem('sniper-slice.save.auto'); true`);
  await send('Page.reload', { ignoreCache: false });
  await sleep(1500);
  let res, err = null;
  try { res = await evaluate(PLAY, 180000); } catch (e) { err = e.message; }
  const errors = events.filter(e => (e.method === 'Runtime.exceptionThrown') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source !== 'network'))
    .map(e => e.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? e.params.args?.map(a => a.value ?? a.description).join(' ') ?? e.params.entry?.text);
  const bad = events.filter(e => e.method === 'Network.responseReceived' && e.params.response.status >= 400).map(e => `${e.params.response.status} ${e.params.response.url.replace(base, '')}`)
    .concat(events.filter(e => e.method === 'Network.loadingFailed' && !e.params.canceled).map(e => `failed ${e.params.errorText}`));
  if (err || errors.length || bad.length) failed = true;
  report.push({ id, ...(res ?? {}), error: err, errors: [...new Set(errors)].slice(0, 5), requests: [...new Set(bad)].slice(0, 5) });
  const r = report[report.length - 1];
  console.log(`${id.padEnd(9)} ${err ? 'FAILED: ' + err : `load ${(r.load / 1000).toFixed(1)} s · frame median ${r.median} ms, 95% ${r.p95}, worst ${r.worst} · ${r.soldiers} soldiers · alarm ${r.alarm ? 'up' : 'no'} · ways in: ${r.ways?.length ?? '?'} (${r.ways?.slice(1).join(', ')}) · ${r.silent ? 'silent' : 'SOUND ON'}`}`);
  for (const e of r.errors) console.log('   error:', e);
  for (const b of r.requests) console.log('   request:', b);
}
ws.close();
browser.kill();
console.log(failed ? '\nSome missions had errors.' : '\nAll missions ran clean.');
process.exit(failed ? 1 : 0);
