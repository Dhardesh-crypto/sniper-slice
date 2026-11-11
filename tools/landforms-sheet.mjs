// Renders the terrain kit's sample map (tools/landforms-sample.html) in a headless Chromium and
// saves its contact sheet of six fixed views, printing the page's report (trees, water heights,
// steep ground, what can be reached on foot).
//   npx vite --port 5183 --strictPort        (any dev server of this repo)
//   node tools/landforms-sheet.mjs [url] [out.jpg] [biome]
//       defaults: http://localhost:5183, tasks/landforms-sample.jpg, the map's own (alpine)
// Same Chromium and DevTools plumbing as tools/smoke.mjs (no npm package); muted, though the page
// plays nothing.
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const [base = 'http://localhost:5183', out = 'tasks/landforms-sample.jpg', biome = ''] = process.argv.slice(2);
const PORT = +(process.env.CDP_PORT ?? 9347);
const root = join(homedir(), 'Library/Caches/ms-playwright');
const exe = readdirSync(root).filter(d => d.startsWith('chromium_headless_shell')).sort().reverse()
  .map(d => join(root, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find(existsSync);
if (!exe) throw new Error('no headless Chromium in ' + root);
const browser = spawn(exe, [`--remote-debugging-port=${PORT}`, '--window-size=1000,700', '--mute-audio',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sheet-'))}`, 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { browser.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', stop);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://localhost:${PORT}/json/list`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
  if (!wsUrl) await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 1; const waiting = new Map(), errors = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) errors.push(msg.params.type + ': ' + msg.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
});
const send = (method, params = {}) => new Promise(res => { waiting.set(id, res); ws.send(JSON.stringify({ id: id++, method, params })); });
await send('Runtime.enable');
await send('Page.navigate', { url: `${base}/tools/landforms-sample.html${biome ? '?biome=' + biome : ''}` });
const t0 = Date.now();
let got = null;
while (!got && Date.now() - t0 < 600000) {
  await sleep(2000);
  const r = await send('Runtime.evaluate', { expression: 'window.sample ? JSON.stringify(window.sample) : ""', returnByValue: true });
  if (r.result?.result?.value) got = JSON.parse(r.result.result.value);
  if (errors.some(e => !e.startsWith('warning'))) break;
}
for (const e of [...new Set(errors)]) console.log('  page', e);
if (!got) { console.error('the page did not finish'); process.exit(1); }
writeFileSync(out, Buffer.from(got.sheet.split(',')[1], 'base64'));
console.log(JSON.stringify(got.report, null, 1));
console.log(`saved ${out} (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(0);
