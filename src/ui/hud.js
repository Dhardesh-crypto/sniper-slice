// HUD: DOM panels for vitals/ammo/wind, a canvas for the scope and binocular masks
// (redrawn only when they change) and a canvas for per-frame markers.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.overlay = $('overlay');
    this.markers = $('markers');
    this.og = this.overlay.getContext('2d');
    this.mg = this.markers.getContext('2d');
    this.el = {
      crosshair: $('crosshair'), wind: $('wind'), windArrow: $('wind-arrow'), windText: $('wind-text'),
      stance: $('stance'), heart: $('heart'), heartText: $('heart-text'), breath: $('breath'), breathFill: $('breath-fill'),
      ammo: $('ammo'), weapon: $('weapon-name'), mag: $('mag'), zero: $('zero'),
      scopeInfo: $('scope-info'), hitmsg: $('hitmsg'), range: $('range'), debug: $('debug'), hint: $('hint'),
    };
    this.overlayKey = '';
    this.hitMarker = 0;
    this.hitKill = false;
    this.msgT = 0;
    this.debugOn = false;
    this.v = new THREE.Vector3();
    this.resize();
  }

  resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    for (const c of [this.overlay, this.markers]) {
      c.width = innerWidth * dpr;
      c.height = innerHeight * dpr;
    }
    this.dpr = dpr;
    this.overlayKey = '';
  }

  message(text, kind = '') {
    this.el.hitmsg.textContent = text;
    this.el.hitmsg.className = `show ${kind}`;
    this.msgT = 2.2;
  }

  onHit(e) {
    if (e.miss) return;
    if (e.hotspot) { this.hitMarker = 1; this.hitKill = false; return; } // the hotspot posts its own message
    this.hitMarker = 1;
    this.hitKill = e.killed;
    const d = `${Math.round(e.distance)} m`;
    if (e.killed) this.message(e.zone === 'head' ? `HEADSHOT · ${d}` : `KILL · ${d}`, e.zone === 'head' ? 'head' : '');
    else this.message(`${e.zone.toUpperCase()} HIT · ${d}`, 'wound');
  }

  // Sniper Elite-style awareness: an arc around the crosshair for each guard who is
  // noticing you (white → yellow → red, pointing toward him), "?" / "!" over heads,
  // and the sound-masking indicator.
  drawStealth(g, W, H, d, camera, player, world, st, project, mode) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    const R = (mode === 'none' ? 70 : 120) * d;
    for (const s of world.soldiers) {
      const a = s.aware;
      if (!s.alive || s.range || !a || (a.meter < 0.03 && a.state === 'calm')) continue;
      const to = s.root.position.clone().sub(player.pos).setY(0).normalize();
      const ang = Math.atan2(to.dot(right), to.dot(fwd)); // 0 = straight ahead, clockwise
      const level = a.state === 'alerted' ? 1 : a.meter;
      const color = a.state === 'alerted' ? '255,60,45' : a.state === 'suspicious' ? '255,200,70' : '255,255,255';
      g.strokeStyle = `rgba(${color},${0.35 + 0.65 * level})`;
      g.lineWidth = (3 + 4 * level) * d;
      g.beginPath();
      g.arc(W / 2, H / 2, R, ang - Math.PI / 2 - 0.16, ang - Math.PI / 2 + 0.16);
      g.stroke();
      // ? or ! over the guard when you can see him.
      if (a.state !== 'calm') {
        const p = project(s.headPosition());
        if (p && p.x > 0 && p.x < W && p.y > 0 && p.y < H) {
          g.font = `bold ${(a.state === 'alerted' ? 22 : 18) * d}px "Helvetica Neue", Arial, sans-serif`;
          g.textAlign = 'center';
          g.fillStyle = `rgb(${color})`;
          g.strokeStyle = 'rgba(0,0,0,0.7)';
          g.lineWidth = 3 * d;
          const mark = a.state === 'alerted' ? '!' : '?';
          g.strokeText(mark, p.x, p.y - 22 * d);
          g.fillText(mark, p.x, p.y - 22 * d);
        }
      }
    }
    // Masking indicator under the wind readout.
    const el = this.el.mask ?? (this.el.mask = document.getElementById('mask'));
    const names = { generator: 'GENERATOR', plane: 'AIRCRAFT', artillery: 'ARTILLERY' };
    if (st.mask.amount > 0.5) {
      el.textContent = `SOUND MASKED · ${names[st.mask.source]}`;
      el.className = 'on';
    } else if (st.upcoming && st.upcoming.in < 6 && st.upcoming.in > 0) {
      el.textContent = st.upcoming.kind === 'plane' ? 'AIRCRAFT APPROACHING' : 'ARTILLERY INCOMING';
      el.className = 'soon';
    } else el.className = '';
    // Overall state
    const banner = this.el.banner ?? (this.el.banner = document.getElementById('alertstate'));
    banner.textContent = st.alarm ? 'ALARM' : st.worst === 'alerted' ? 'ENEMIES ALERTED' : st.worst === 'suspicious' ? 'SUSPICIOUS' : '';
    banner.className = st.alarm ? 'alarm' : st.worst;
  }

  // Scope mask + reticle with true mil spacing for the current magnification.
  drawScope(fovDeg) {
    const g = this.og, W = this.overlay.width, H = this.overlay.height;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.47;
    g.fillStyle = '#000';
    g.beginPath();
    g.rect(0, 0, W, H);
    g.arc(cx, cy, R, 0, Math.PI * 2, true);
    g.fill('evenodd');
    const vg = g.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = vg;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

    const pxPerMil = (H / 2) / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) / 1000;
    const thin = Math.max(1, this.dpr * 0.9), thick = R * 0.035;
    g.strokeStyle = '#0a0a0a';
    g.fillStyle = '#0a0a0a';
    g.lineWidth = thin;
    // Fine crosshair
    g.beginPath();
    g.moveTo(cx - R, cy); g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R); g.lineTo(cx, cy + R);
    g.stroke();
    // Heavy posts from the edge (German-style), stopping short of the centre.
    const gap = Math.max(pxPerMil * 10.5, R * 0.3);
    g.fillRect(cx - R, cy - thick / 2, R - gap, thick);
    g.fillRect(cx + gap, cy - thick / 2, R - gap, thick);
    g.fillRect(cx - thick / 2, cy + gap, thick, R - gap);
    // Mil dots: windage left/right, holdover below.
    const dot = Math.max(1.5, Math.min(pxPerMil * 0.18, 4 * this.dpr));
    const dots = (x, y) => { g.beginPath(); g.arc(x, y, dot, 0, Math.PI * 2); g.fill(); };
    for (let m = 1; m <= 10; m++) {
      const d = m * pxPerMil;
      if (d > gap - dot) break;
      dots(cx - d, cy); dots(cx + d, cy); dots(cx, cy + d);
      if (m <= 4) dots(cx, cy - d);
      if (m % 5 === 0) { // longer ticks every 5 mils
        g.fillRect(cx - d - thin, cy - dot * 3, thin * 2, dot * 6);
        g.fillRect(cx + d - thin, cy - dot * 3, thin * 2, dot * 6);
        g.fillRect(cx - dot * 3, cy + d - thin, dot * 6, thin * 2);
      }
    }
    // Small lens tint
    g.fillStyle = 'rgba(30,40,20,0.05)';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  }

  drawBinoculars(fovDeg) {
    const g = this.og, W = this.overlay.width, H = this.overlay.height;
    g.clearRect(0, 0, W, H);
    const R = Math.min(W * 0.3, H * 0.46), cy = H / 2, off = R * 0.62;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out'; // cut both lenses out of the black
    for (const x of [W / 2 - off, W / 2 + off]) {
      g.beginPath(); g.arc(x, cy, R, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    const pxPerMil = (H / 2) / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) / 1000;
    g.strokeStyle = 'rgba(10,10,10,0.8)';
    g.lineWidth = Math.max(1, this.dpr);
    g.beginPath();
    g.moveTo(W / 2 - pxPerMil * 40, cy); g.lineTo(W / 2 + pxPerMil * 40, cy);
    for (let m = -40; m <= 40; m += 5) {
      const len = m % 10 === 0 ? 8 : 4;
      g.moveTo(W / 2 + m * pxPerMil, cy - len * this.dpr); g.lineTo(W / 2 + m * pxPerMil, cy);
    }
    g.moveTo(W / 2, cy - pxPerMil * 6); g.lineTo(W / 2, cy + pxPerMil * 6);
    g.stroke();
  }

  // Objectives in the top-left corner (rebuilt only when they change).
  drawObjectives(mission) {
    const el = this.el.objectives ?? (this.el.objectives = document.getElementById('objectives'));
    const key = mission.objectives.map(o => `${o.id}${o.done}${o.hidden}`).join();
    if (key === this.objKey) return;
    const fresh = this.objKey ? mission.objectives.filter(o => !o.hidden && !this.objKey.includes(`${o.id}${o.done}false`)) : [];
    this.objKey = key;
    el.innerHTML = '<h3>OPERATION VINEYARD</h3>' + mission.objectives.filter(o => !o.hidden).map(o =>
      `<div class="${o.optional ? 'optional' : ''} ${o.done ? 'done' : ''} ${fresh.includes(o) ? 'new' : ''}">${o.done ? '✓' : o.optional ? '◇' : '◆'} ${o.text}${o.optional ? ' <small>(optional)</small>' : ''}</div>`).join('');
  }

  // Compass strip: heading ticks, and markers for objectives, the waypoint and tagged enemies.
  drawCompass(player, marks) {
    const c = this.el.compass ?? (this.el.compass = document.getElementById('compass'));
    const d = this.dpr, W = c.clientWidth * d, H = c.clientHeight * d;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const heading = -player.yaw;                    // 0 = north (-z), clockwise toward east (+x)
    const span = Math.PI * 0.75;                    // visible arc
    const xOf = (bearing) => {
      const a = Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading));
      return Math.abs(a) > span / 2 ? null : W / 2 + (a / (span / 2)) * (W / 2 - 10 * d);
    };
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.35)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let i = 0; i < 24; i++) {
      const x = xOf((i / 24) * Math.PI * 2);
      if (x === null) continue;
      const major = i % 3 === 0;
      g.fillStyle = i === 0 ? '#ffcf6a' : 'rgba(242,237,225,0.85)';
      if (major) { g.font = `${(i % 6 === 0 ? 12 : 10) * d}px "Helvetica Neue", Arial, sans-serif`; g.fillText(names[i / 3], x, H * 0.38); }
      else g.fillRect(x - 0.5 * d, H * 0.3, 1 * d, H * 0.18);
    }
    g.fillStyle = 'rgba(242,237,225,0.9)';
    g.fillRect(W / 2 - 0.75 * d, H * 0.66, 1.5 * d, H * 0.3);
    const COLORS = { target: '#ffcf6a', radio: '#8fd0ff', extract: '#8fe08a', papers: '#d9b3ff', waypoint: '#ffe28a', enemy: '#ff4a3d', weakspot: '#ff9a3c' };
    for (const m of marks) {
      const x = xOf(Math.atan2(m.pos.x - player.pos.x, -(m.pos.z - player.pos.z)));
      if (x === null) continue;
      g.fillStyle = COLORS[m.kind];
      g.beginPath();
      const y = H * 0.8, r = (m.kind === 'enemy' ? 3 : 5) * d;
      if (m.kind === 'enemy') g.arc(x, y, r, 0, Math.PI * 2);
      else if (m.kind === 'weakspot') { g.moveTo(x, y - r); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r); }
      else { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); }
      g.fill();
    }
  }

  update(dt, { camera, player, arsenal, world, fps, search, waypoint, stealth, mission, hotspots, res }) {
    const a = arsenal.hudState();
    const el = this.el;

    // Overlay masks
    const mode = a.binoc > 0.6 ? 'binoc' : (a.weapon === 'rifle' && a.aim > 0.85) ? 'scope' : 'none';
    const key = `${mode}:${mode === 'binoc' ? a.binocFov : a.zoomFov}:${this.overlay.width}x${this.overlay.height}`;
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      if (mode === 'scope') this.drawScope(a.zoomFov);
      else if (mode === 'binoc') this.drawBinoculars(a.binocFov);
      else this.og.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
    // Scope jolts on recoil (only then: the reticle must stay on the bullet's line otherwise).
    const kick = arsenal.viewKick;
    this.overlay.style.transform = mode === 'scope' && kick > 0.01 ? `translate(0px, ${(kick * 40).toFixed(1)}px) scale(${1 + kick * 0.04})` : '';

    el.crosshair.style.opacity = mode === 'none' && !player.sprinting ? 0.85 : 0;
    el.scopeInfo.style.opacity = mode === 'none' ? 0 : 1;
    if (mode === 'scope') el.scopeInfo.textContent = `${a.zoomName}   ZERO ${a.zero} m`;
    else if (mode === 'binoc') el.scopeInfo.textContent = `${a.binocZoomName}   BINOCULARS`;
    el.range.style.opacity = mode === 'binoc' ? 1 : 0;
    if (mode === 'binoc') el.range.textContent = a.range ? `${Math.round(a.range)} m` : '— m';

    // Wind relative to where you face: up = blowing away from you, right = to your right.
    const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
    const rgtX = Math.cos(player.yaw), rgtZ = -Math.sin(player.yaw);
    const wv = world.wind;
    const ang = Math.atan2(wv.x * rgtX + wv.z * rgtZ, wv.x * fwdX + wv.z * fwdZ);
    el.windArrow.style.transform = `rotate(${THREE.MathUtils.radToDeg(ang).toFixed(1)}deg)`;
    el.windText.textContent = `${world.windSpeed.toFixed(1)} m/s`;

    el.stance.textContent = player.stance.toUpperCase();
    // Concealment in tall grass: an icon over the stance and a faint green edge to the view.
    const cc = el.conceal ?? (el.conceal = document.getElementById('conceal'));
    const edge = el.hiddenEdge ?? (el.hiddenEdge = document.getElementById('hidden-edge'));
    const concealed = !!stealth?.concealed && !player.dead, partial = !!stealth?.inGrass && !concealed && !player.dead;
    cc.className = concealed ? 'on' : partial ? 'partial' : '';
    const text = concealed ? 'CONCEALED' : partial ? 'IN TALL GRASS · CROUCH TO HIDE' : '';
    if (cc.lastChild.textContent !== text && text) cc.lastChild.textContent = text;
    edge.classList.toggle('on', concealed && mode === 'none');
    // Health and the red edge when hit.
    const hb = el.health ?? (el.health = document.getElementById('health'));
    hb.firstElementChild.style.width = `${player.health.toFixed(1)}%`;
    hb.classList.toggle('low', player.health < 35);
    const hurt = el.hurt ?? (el.hurt = document.getElementById('hurt'));
    hurt.style.opacity = String(Math.max(player.dead ? 0.9 : 0, Math.max(0, 1 - player.hurtT / 0.9), player.health < 35 ? 0.35 : 0));
    el.heartText.textContent = Math.round(player.heartRate);
    el.heart.style.animationDuration = `${(60 / player.heartRate).toFixed(3)}s`;
    el.breath.style.opacity = a.scoped ? 1 : 0;
    el.breathFill.style.width = `${(a.breath * 100).toFixed(1)}%`;
    el.breath.classList.toggle('holding', a.holding);
    el.breath.classList.toggle('exhausted', a.exhausted);

    el.weapon.textContent = a.reloading ? 'RELOADING…' : a.name;
    el.mag.innerHTML = `${a.mag}<span>/ ${a.reserve}</span>`;
    el.zero.textContent = a.zero ? `ZERO ${a.zero} m` : '';

    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) el.hitmsg.className = ''; }

    // Per-frame markers
    const g = this.mg, W = this.markers.width, H = this.markers.height, d = this.dpr;
    g.clearRect(0, 0, W, H);
    const project = (p) => {
      this.v.copy(p).project(camera);
      if (this.v.z > 1) return null;
      return { x: (this.v.x * 0.5 + 0.5) * W, y: (-this.v.y * 0.5 + 0.5) * H };
    };
    if (arsenal.prediction) {
      const s = project(arsenal.prediction);
      if (s) {
        g.save();
        g.translate(s.x, s.y);
        g.rotate(Math.PI / 4);
        g.strokeStyle = '#ff3b2f';
        g.lineWidth = 2 * d;
        g.strokeRect(-5 * d, -5 * d, 10 * d, 10 * d);
        g.restore();
      }
    }
    g.font = `${11 * d}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    for (const s of world.soldiers) {
      if (!s.tagged || !s.alive) continue;
      const p = project(s.headPosition());
      if (!p) continue;
      g.fillStyle = '#ff4a3d';
      g.beginPath();
      g.moveTo(p.x, p.y); g.lineTo(p.x - 6 * d, p.y - 10 * d); g.lineTo(p.x + 6 * d, p.y - 10 * d);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(`${Math.round(camera.position.distanceTo(s.root.position))} m`, p.x, p.y - 14 * d);
    }
    // Tagged weak spots: an orange warning triangle with what it is and how many hits it takes.
    for (const h of hotspots?.tagged() ?? []) {
      const c = h.center(this.v4 ?? (this.v4 = new THREE.Vector3()));
      const sp = project(c);
      if (!sp) continue;
      const r = 7 * d;
      g.fillStyle = 'rgba(255,154,60,0.92)';
      g.beginPath(); g.moveTo(sp.x, sp.y - r); g.lineTo(sp.x + r, sp.y + r * 0.8); g.lineTo(sp.x - r, sp.y + r * 0.8); g.fill();
      g.fillStyle = '#1a1208'; g.fillText('!', sp.x, sp.y + r * 0.55);
      g.fillStyle = 'rgba(255,190,120,0.95)';
      g.fillText(h.label(), sp.x, sp.y - r - 5 * d);
    }
    // Objectives: diamonds in the world with a name and distance.
    if (mission) {
      const COLORS = { target: '255,207,106', radio: '143,208,255', extract: '143,224,138', papers: '217,179,255' };
      for (const m of mission.markers()) {
        const at = (this.v3 ?? (this.v3 = new THREE.Vector3())).copy(m.pos); at.y += m.height;
        const sp = project(at);
        if (!sp) continue;
        const dist = Math.round(Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z));
        if (dist < 4 && m.kind !== 'extract') continue;
        g.save();
        g.translate(sp.x, sp.y);
        g.fillStyle = `rgba(${COLORS[m.kind]},0.9)`;
        g.rotate(Math.PI / 4); g.fillRect(-5 * d, -5 * d, 10 * d, 10 * d);
        g.restore();
        g.fillStyle = `rgba(${COLORS[m.kind]},0.95)`;
        g.fillText(`${m.label} · ${dist} m`, sp.x, sp.y - 13 * d);
      }
      this.drawObjectives(mission);
      const marks = mission.markers();
      if (waypoint) marks.push({ pos: waypoint, kind: 'waypoint' });
      for (const s of world.soldiers) if (s.tagged && s.alive && !s.officer) marks.push({ pos: s.root.position, kind: 'enemy' });
      for (const h of hotspots?.tagged() ?? []) marks.push({ pos: h.center(), kind: 'weakspot' });
      this.drawCompass(player, marks);
    }
    // Waypoint: a marker in the world with its distance.
    if (waypoint) {
      const wp = this.v2 ?? (this.v2 = new THREE.Vector3());
      wp.set(waypoint.x, world.groundAt(waypoint.x, waypoint.z) + 2.5, waypoint.z);
      const sp = project(wp);
      if (sp) {
        g.save();
        g.translate(sp.x, sp.y);
        g.strokeStyle = '#ffe28a'; g.lineWidth = 2 * d;
        g.rotate(Math.PI / 4); g.strokeRect(-6 * d, -6 * d, 12 * d, 12 * d);
        g.restore();
        g.fillStyle = 'rgba(255,226,138,0.95)';
        g.fillText(`${Math.round(Math.hypot(waypoint.x - player.pos.x, waypoint.z - player.pos.z))} m`, sp.x, sp.y - 14 * d);
      }
    }
    if (a.tagProgress > 0 && a.tagProgress < 1) {
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 2 * d;
      g.beginPath();
      g.arc(W / 2, H / 2, 16 * d, -Math.PI / 2, -Math.PI / 2 + a.tagProgress * Math.PI * 2);
      g.stroke();
    }
    if (this.hitMarker > 0) {
      this.hitMarker = Math.max(0, this.hitMarker - dt * (this.hitKill ? 1.4 : 2.5));
      const pop = 1 + 0.5 * Math.max(0, this.hitMarker - 0.8) / 0.2; // starts big, snaps in
      g.strokeStyle = this.hitKill ? `rgba(255,60,40,${this.hitMarker})` : `rgba(255,255,255,${this.hitMarker})`;
      g.lineWidth = (this.hitKill ? 4 : 3) * d;
      const r0 = 8 * d * pop, r1 = (this.hitKill ? 24 : 18) * d * pop;
      g.beginPath();
      for (const [sx2, sy2] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        g.moveTo(W / 2 + sx2 * r0, H / 2 + sy2 * r0); g.lineTo(W / 2 + sx2 * r1, H / 2 + sy2 * r1);
      }
      g.stroke();
    }

    if (stealth) this.drawStealth(g, W, H, d, camera, player, world, stealth, project, mode);

    // Search prompt over a body.
    const pr = document.getElementById('prompt');
    pr.classList.toggle('show', !!search && mode === 'none');
    if (search) {
      pr.querySelector('span').textContent = search.label;
      pr.querySelector('#prompt-ring').style.strokeDashoffset = String(94.25 * (1 - search.progress));
    }

    if (this.debugOn) {
      const p = player.pos;
      el.debug.textContent = `${fps.toFixed(0)} fps · res ×${(res ?? 0).toFixed(2)} · pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · ` +
        `HR ${player.heartRate.toFixed(0)} · wind ${world.wind.x.toFixed(1)},${world.wind.z.toFixed(1)} · ` +
        `bullets ${arsenal.bullets.length} · grass ${world.tuftCount} · stats ${JSON.stringify(arsenal.stats)}`;
    }
    el.debug.style.display = this.debugOn ? 'block' : 'none';
  }
}
