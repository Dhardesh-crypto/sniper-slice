// The map: a top-down image drawn once from the real terrain (colours, hill shading,
// contour lines), buildings, trees and tall-grass cover, with a lettered grid. Drawn
// full-screen on M (click to set a waypoint) and as a rotating minimap in the corner.
import * as THREE from 'three';
import { MAP_HALF } from '../world/terrain.js';

const PX = 800;                      // map image size in pixels (1 m per pixel)
const GRID = 100;                    // grid squares, metres
const COLS = 'ABCDEFGH';

const OBJ_COLORS = { supply: '#e8e2c8', toolbox: '#c9a86a', crate: '#e6b85c', bench: '#9ad0ff', target: '#ffcf6a', radio: '#8fd0ff', papers: '#d9b3ff', tank: '#ff8a5a', extract: '#8fe08a', weakspot: '#ff9a3c', waypoint: '#ffe28a' };

export class MapView {
  constructor(world) {
    this.world = world;
    this.base = this.drawBase();
    this.waypoint = null;
    this.open = false;
    this.full = document.getElementById('mapview');
    this.fg = this.full.getContext('2d');
    this.mini = document.getElementById('minimap');
    this.mg = this.mini.getContext('2d');
    this.full.addEventListener('mousedown', (e) => this.onClick(e));
    this.full.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // World x/z → map pixel.
  toMap(x, z) { return [(x + MAP_HALF) / (2 * MAP_HALF) * PX, (z + MAP_HALF) / (2 * MAP_HALF) * PX]; }
  toWorld(px, py) { return [px / PX * 2 * MAP_HALF - MAP_HALF, py / PX * 2 * MAP_HALF - MAP_HALF]; }

  drawBase() {
    const terrain = this.world.terrain.geometry;
    const pos = terrain.attributes.position, col = terrain.attributes.color;
    const N = Math.round(Math.sqrt(pos.count)); // vertices per side
    const step = (2 * MAP_HALF) / (N - 1);
    const H = (i, j) => pos.getY(Math.min(N - 1, j) * N + Math.min(N - 1, i));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PX;
    const g = canvas.getContext('2d');
    const img = g.createImageData(PX, PX);
    const c = new THREE.Color();
    const light = new THREE.Vector3(-0.6, 0.7, -0.4).normalize();
    for (let py = 0; py < PX; py++) {
      for (let px = 0; px < PX; px++) {
        const fx = px / PX * (N - 1), fz = py / PX * (N - 1);
        const i = Math.floor(fx), j = Math.floor(fz);
        const k = j * N + i;
        c.setRGB(col.getX(k), col.getY(k), col.getZ(k)); // linear vertex colour
        // Hill shading from the local slope.
        const dx = (H(i + 1, j) - H(i - 1 < 0 ? 0 : i - 1, j)) / (2 * step);
        const dz = (H(i, j + 1) - H(i, j - 1 < 0 ? 0 : j - 1)) / (2 * step);
        const nx = -dx, ny = 1, nz = -dz, len = Math.hypot(nx, ny, nz);
        const shade = 0.55 + 0.6 * Math.max(0, (nx * light.x + ny * light.y + nz * light.z) / len);
        c.multiplyScalar(shade);
        // Contour lines every 5 m, darker every 25 m.
        const h = H(i, j), h2 = H(i + 1, j), h3 = H(i, j + 1);
        const crosses = (iv) => Math.floor(h / iv) !== Math.floor(h2 / iv) || Math.floor(h / iv) !== Math.floor(h3 / iv);
        if (crosses(25)) c.multiplyScalar(0.62); else if (crosses(5)) c.multiplyScalar(0.84);
        const o = (py * PX + px) * 4;
        const srgb = c.clone().convertLinearToSRGB();
        img.data[o] = Math.min(255, srgb.r * 255);
        img.data[o + 1] = Math.min(255, srgb.g * 255);
        img.data[o + 2] = Math.min(255, srgb.b * 255);
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // Tall-grass cover: soft hatched patches.
    g.save();
    for (const p of this.world.grassPatches) {
      const [x, y] = this.toMap(p.x, p.z), r = p.r / (2 * MAP_HALF) * PX;
      g.fillStyle = 'rgba(190, 200, 110, 0.35)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(70, 90, 30, 0.45)';
      g.lineWidth = 1;
      g.save(); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
      g.beginPath();
      for (let d = -r * 2; d < r * 2; d += 3) { g.moveTo(x + d, y - r); g.lineTo(x + d + r * 0.6, y + r); }
      g.stroke(); g.restore();
    }
    g.restore();
    // Trees
    g.fillStyle = 'rgba(32, 52, 28, 0.85)';
    for (const t of this.world.trees) {
      const [x, y] = this.toMap(t.x, t.z);
      g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill();
    }
    // Buildings and walls (anything solid taller than a person)
    for (const b of this.world.boxes) {
      if (b.max.y - b.min.y < 0.6) continue;
      const [x0, y0] = this.toMap(b.min.x, b.min.z), [x1, y1] = this.toMap(b.max.x, b.max.z);
      g.fillStyle = b.max.y - b.min.y > 4 ? 'rgba(120, 70, 50, 0.95)' : 'rgba(95, 90, 80, 0.9)';
      g.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
    // Grid
    g.strokeStyle = 'rgba(20, 20, 15, 0.35)';
    g.lineWidth = 1;
    g.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = 'rgba(20, 20, 15, 0.6)';
    for (let m = -MAP_HALF; m <= MAP_HALF; m += GRID) {
      const [p] = this.toMap(m, 0);
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, PX); g.moveTo(0, p); g.lineTo(PX, p); g.stroke();
    }
    for (let k = 0; k < 8; k++) {
      g.fillText(COLS[k], k * GRID + 6, 14);
      g.fillText(String(k + 1), 4, k * GRID + 28);
    }
    return canvas;
  }

  gridRef(x, z) {
    const i = Math.floor((x + MAP_HALF) / GRID), j = Math.floor((z + MAP_HALF) / GRID);
    return `${COLS[Math.max(0, Math.min(7, i))]}${Math.max(1, Math.min(8, j + 1))}`;
  }

  // ---- markers shared by both views (ctx already transformed to map pixels) ----
  drawMarkers(g, st, scale) {
    const s = Math.min(devicePixelRatio, 2) * 1.25 / scale; // constant on-screen size, any zoom or DPI
    this.drawObjectives(g, st, s);
    // Bodies: hollow when searched, filled when there may be supplies.
    for (const so of this.world.soldiers) {
      if (so.alive || so.range) continue;
      const p = so.bodyPosition(); const [x, y] = this.toMap(p.x, p.z);
      g.lineWidth = 2 * s;
      g.strokeStyle = 'rgba(30,30,30,0.9)';
      g.fillStyle = so.hidden ? 'rgba(120,120,110,0.8)' : so.searched ? 'rgba(0,0,0,0)' : '#e8d07a';
      g.beginPath(); g.arc(x, y, 4.5 * s, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(x - 3 * s, y - 3 * s); g.lineTo(x + 3 * s, y + 3 * s); g.moveTo(x + 3 * s, y - 3 * s); g.lineTo(x - 3 * s, y + 3 * s); g.stroke();
    }
    // Tagged enemies
    for (const so of this.world.soldiers) {
      if (!so.alive || !so.tagged) continue;
      const [x, y] = this.toMap(so.root.position.x, so.root.position.z);
      g.fillStyle = '#ff4a3d';
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 1.5 * s;
      g.beginPath(); g.moveTo(x, y + 5 * s); g.lineTo(x - 5 * s, y - 4 * s); g.lineTo(x + 5 * s, y - 4 * s); g.closePath(); g.fill(); g.stroke();
    }
    // Waypoint
    if (this.waypoint) {
      const [x, y] = this.toMap(this.waypoint.x, this.waypoint.z);
      g.strokeStyle = '#ffe28a';
      g.lineWidth = 2.5 * s;
      g.beginPath(); g.arc(x, y, 7 * s, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(x, y - 12 * s); g.lineTo(x, y + 12 * s); g.moveTo(x - 12 * s, y); g.lineTo(x + 12 * s, y); g.stroke();
    }
    // Player: arrow pointing where the camera looks.
    const [px, py] = this.toMap(st.player.pos.x, st.player.pos.z);
    g.save();
    g.translate(px, py);
    g.rotate(-st.player.yaw);         // yaw 0 faces -z = up on the map
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = 1.5 * s;
    g.beginPath(); g.moveTo(0, -9 * s); g.lineTo(6 * s, 7 * s); g.lineTo(0, 3 * s); g.lineTo(-6 * s, 7 * s); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  // Mission objectives (target, radio, papers, extraction) and tagged weak spots. Labels
  // only on the full map (it doesn't rotate), stacked so close ones don't overlap.
  drawObjectives(g, st, s) {
    const mPerPx = (2 * MAP_HALF) / PX;
    const labels = [];
    const diamond = (x, y, r, color) => {
      g.fillStyle = color; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1.5 * s;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); g.stroke();
    };
    for (const m of this.mission?.markers() ?? []) {
      const [x, y] = this.toMap(m.pos.x, m.pos.z);
      const color = OBJ_COLORS[m.kind];
      if (m.label === 'TARGET AREA') {
        // Not tagged yet: a circle where to look, not a point where he is.
        const r = Math.max(28 / mPerPx, 9 * s);
        g.strokeStyle = color; g.lineWidth = 2 * s;
        g.setLineDash([4 * s, 3 * s]);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        labels.push({ x, y: y - r, text: m.label, color });
        continue;
      }
      if (m.kind === 'extract') { g.strokeStyle = color; g.lineWidth = 2 * s; g.beginPath(); g.arc(x, y, Math.max(10 / mPerPx, 9 * s), 0, Math.PI * 2); g.stroke(); }
      diamond(x, y, 6 * s, color);
      labels.push({ x, y: y - 7 * s, text: m.label, color });
    }
    // Toolboxes, weapon crates and workbenches: small squares.
    for (const m of this.pickups?.markers() ?? []) {
      const [x, y] = this.toMap(m.pos.x, m.pos.z), r = (m.kind === 'bench' ? 5 : m.kind === 'supply' ? 3 : 4) * s;
      g.fillStyle = OBJ_COLORS[m.kind]; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1.2 * s;
      g.fillRect(x - r, y - r * (m.kind === 'crate' ? 0.6 : 1), r * 2, r * (m.kind === 'crate' ? 1.2 : 2));
      g.strokeRect(x - r, y - r * (m.kind === 'crate' ? 0.6 : 1), r * 2, r * (m.kind === 'crate' ? 1.2 : 2));
      if (m.kind === 'bench') labels.push({ x, y: y - 6 * s, text: 'WORKBENCH', color: OBJ_COLORS.bench });
    }
    for (const h of this.hotspots?.tagged() ?? []) {
      const c = h.center(); const [x, y] = this.toMap(c.x, c.z);
      g.fillStyle = OBJ_COLORS.weakspot; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1.5 * s;
      g.beginPath(); g.moveTo(x, y - 6 * s); g.lineTo(x + 6 * s, y + 5 * s); g.lineTo(x - 6 * s, y + 5 * s); g.closePath(); g.fill(); g.stroke();
      labels.push({ x, y: y - 7 * s, text: h.label(), color: OBJ_COLORS.weakspot });
    }
    if (!st.full) return;
    g.font = `600 ${10 * s}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    const placed = [], lineH = 13 * s;
    for (const l of labels.sort((a, b) => b.y - a.y)) {
      const w = g.measureText(l.text).width + 6 * s;
      let ly = l.y - 3 * s;
      const hits = () => placed.some(p => Math.abs(p.x - l.x) < (p.w + w) / 2 && Math.abs(p.y - ly) < lineH);
      while (hits()) ly -= lineH;
      placed.push({ x: l.x, y: ly, w });
      if (l.y - ly > 4 * s) { // pushed up: a thin leader back to its marker
        g.strokeStyle = l.color; g.lineWidth = 1 * s; g.globalAlpha = 0.7;
        g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(l.x, ly + 2 * s); g.stroke();
        g.globalAlpha = 1;
      }
      g.lineWidth = 3 * s; g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.strokeText(l.text, l.x, ly);
      g.fillStyle = l.color;
      g.fillText(l.text, l.x, ly);
    }
  }

  // Objectives beyond the minimap's edge: pinned to the rim in their direction.
  rimPins(g, st, R, metres, dpr) {
    const pins = (this.mission?.markers() ?? []).map(m => ({ pos: m.pos, color: OBJ_COLORS[m.kind] }));
    if (this.waypoint) pins.push({ pos: this.waypoint, color: OBJ_COLORS.waypoint });
    for (const pin of pins) {
      const dx = pin.pos.x - st.player.pos.x, dz = pin.pos.z - st.player.pos.z;
      if (Math.hypot(dx, dz) <= metres) continue;
      const a = Math.atan2(dz, dx) + st.player.yaw;
      const x = R + Math.cos(a) * (R - 9 * dpr), y = R + Math.sin(a) * (R - 9 * dpr), r = 4.5 * dpr;
      g.fillStyle = pin.color; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1 * dpr;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); g.stroke();
    }
  }

  // ---- full-screen map ----
  layoutFull() {
    const dpr = Math.min(devicePixelRatio, 2);
    const W = innerWidth * dpr, H = innerHeight * dpr;
    if (this.full.width !== W || this.full.height !== H) { this.full.width = W; this.full.height = H; }
    const size = Math.min(W, H) * 0.86;
    return { dpr, W, H, size, x0: (W - size) / 2, y0: (H - size) / 2 + 10 * dpr, scale: size / PX };
  }

  drawFull(st) {
    const L = this.layoutFull(), g = this.fg;
    this.layout = L;
    g.clearRect(0, 0, L.W, L.H);
    g.fillStyle = 'rgba(10, 12, 10, 0.86)';
    g.fillRect(0, 0, L.W, L.H);
    g.save();
    g.translate(L.x0, L.y0);
    g.scale(L.scale, L.scale);
    g.drawImage(this.base, 0, 0);
    this.drawMarkers(g, { ...st, full: true }, L.scale);
    g.restore();
    g.strokeStyle = 'rgba(240,235,220,0.5)';
    g.lineWidth = L.dpr;
    g.strokeRect(L.x0, L.y0, L.size, L.size);
    // Header and legend
    const d = L.dpr, p = st.player.pos;
    g.fillStyle = '#f2ede1';
    g.font = `300 ${20 * d}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'left';
    g.fillText('MAP', L.x0, L.y0 - 14 * d);
    g.font = `${12 * d}px "Helvetica Neue", Arial, sans-serif`;
    g.fillStyle = 'rgba(242,237,225,0.7)';
    const wp = this.waypoint ? ` · waypoint ${Math.round(Math.hypot(this.waypoint.x - p.x, this.waypoint.z - p.z))} m` : '';
    g.fillText(`You are in ${this.gridRef(p.x, p.z)}${wp}`, L.x0 + 60 * d, L.y0 - 14 * d);
    g.textAlign = 'right';
    g.fillText('Click: set waypoint · Right-click: clear · M: close', L.x0 + L.size, L.y0 - 14 * d);
    g.textAlign = 'left';
    const legend = [['#ffffff', 'You'], [OBJ_COLORS.target, 'Target'], [OBJ_COLORS.radio, 'Radio'], [OBJ_COLORS.papers, 'Papers'], [OBJ_COLORS.tank, 'Panzer'], [OBJ_COLORS.extract, 'Extraction'],
      [OBJ_COLORS.weakspot, 'Weak spot'], [OBJ_COLORS.supply, 'Supplies'], [OBJ_COLORS.toolbox, 'Toolbox'], [OBJ_COLORS.crate, 'Weapon crate'], [OBJ_COLORS.bench, 'Workbench'], ['#ff4a3d', 'Tagged enemy'], ['#e8d07a', 'Body to search'], ['#ffe28a', 'Waypoint'], ['rgba(190,200,110,0.8)', 'Tall grass']];
    let lx = L.x0, ly = L.y0 + L.size + 22 * d;
    for (const [color, label] of legend) {
      const w = g.measureText(label).width + 16 * d;
      if (lx + w > L.x0 + L.size) { lx = L.x0; ly += 18 * d; } // wrap on narrow windows
      g.fillStyle = color;
      g.fillRect(lx, ly - 9 * d, 10 * d, 10 * d);
      g.fillStyle = 'rgba(242,237,225,0.8)';
      g.fillText(label, lx + 16 * d, ly);
      lx += w + 22 * d;
    }
    // North arrow
    g.textAlign = 'center';
    g.fillStyle = '#f2ede1';
    g.font = `bold ${13 * d}px "Helvetica Neue", Arial, sans-serif`;
    g.fillText('N ↑', L.x0 + L.size - 18 * d, L.y0 + 22 * d);
  }

  onClick(e) {
    if (!this.open || !this.layout) return;
    const L = this.layout;
    const px = (e.clientX * L.dpr - L.x0) / L.scale, py = (e.clientY * L.dpr - L.y0) / L.scale;
    if (e.button === 2) { this.waypoint = null; return; }
    if (px < 0 || py < 0 || px > PX || py > PX) return;
    const [x, z] = this.toWorld(px, py);
    this.waypoint = { x, z };
  }

  // ---- minimap: centred on you, turning so your view direction is up ----
  drawMini(st) {
    const dpr = Math.min(devicePixelRatio, 2), size = 170 * dpr;
    if (this.mini.width !== size) { this.mini.width = this.mini.height = size; }
    const g = this.mg, R = size / 2, metres = 110; // radius shown
    const scale = R / (metres / (2 * MAP_HALF) * PX);
    const [px, py] = this.toMap(st.player.pos.x, st.player.pos.z);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath(); g.arc(R, R, R - 2 * dpr, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#26281f'; g.fillRect(0, 0, size, size);
    g.translate(R, R);
    g.rotate(st.player.yaw);
    g.scale(scale, scale);
    g.translate(-px, -py);
    g.globalAlpha = 0.92;
    g.drawImage(this.base, 0, 0);
    g.globalAlpha = 1;
    this.drawMarkers(g, st, scale);
    g.restore();
    // How far you can be heard: your footsteps (white) and your last shot (red, fading).
    if (st.stealth) {
      const mPerPx = (2 * MAP_HALF) / PX;
      const ring = (radius, color, w) => {
        const r = radius / mPerPx * scale;
        if (r < 2 || r > R * 3) return;
        g.strokeStyle = color; g.lineWidth = w * dpr;
        g.beginPath(); g.arc(R, R, Math.min(r, R - 3 * dpr), 0, Math.PI * 2); g.stroke();
      };
      if (st.stealth.noise > 0) ring(st.stealth.noise, 'rgba(255,255,255,0.7)', 1.5);
      const shot = st.stealth.lastShot;
      if (shot) {
        const age = st.stealth.time - shot.t;
        if (age < 2.5) ring(shot.radius, `rgba(255,80,60,${0.9 * (1 - age / 2.5)})`, 2.5);
      }
    }
    // Objectives and the waypoint off the edge: pinned to the rim.
    this.rimPins(g, st, R, metres, dpr);
    // Rim with compass letters
    g.strokeStyle = 'rgba(242,237,225,0.6)';
    g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.arc(R, R, R - 2 * dpr, 0, Math.PI * 2); g.stroke();
    g.font = `bold ${10 * dpr}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [label, ang] of [['N', -Math.PI / 2], ['E', 0], ['S', Math.PI / 2], ['W', Math.PI]]) {
      const a = ang + st.player.yaw;
      const x = R + Math.cos(a) * (R - 10 * dpr), y = R + Math.sin(a) * (R - 10 * dpr);
      g.fillStyle = label === 'N' ? '#ffcf6a' : 'rgba(242,237,225,0.85)';
      g.fillText(label, x, y);
    }
    g.textBaseline = 'alphabetic';
  }
}
