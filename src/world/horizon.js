// The country beyond the playable valley. Each mission has its own panorama, rendered in Blender
// (tools/blender/horizon.py): its region's hills, fields, woods, villages, sea or Alps out to 20 km,
// under the mission's sun and washed into its haze, as a 360° strip over latitudes LAT; the sky is
// left clear. It's wrapped round a cylinder that keeps centred on the camera, like the sky, so the
// far country never slides as you walk. Until it has loaded (or if a mission has none), three
// rings of drawn ridgelines stand in: each further away, taller and more washed into the haze.
import * as THREE from 'three';
import { activeMap } from './terrain.js';
import { fbm } from './noise.js';
import { asset } from '../core/version.js';

const LAT = [-3, 16];          // degrees: the panorama's band (horizon.py's LAT_MIN, LAT_MAX)
const R = 2600;                // inside the camera's far plane (3000)

const LAYERS = [
  { radius: 900, base: 10, height: 110, color: 0x6f8361, top: 0x86977a, seed: 1 },
  { radius: 1500, base: 30, height: 220, color: 0x8698a0, top: 0x99a9b0, seed: 2 },
  { radius: 2300, base: 60, height: 380, color: 0xa3b3bd, top: 0xb4c2ca, seed: 3 },
];

// One ring of drawn ridgeline. It used to be a band of one colour, darker at the foot, and read as
// a flat cut-out: now each slope is lit by how it faces the mission's sun (a ridge's sunny flank
// light, the far flank in shade), the face is broken by gullies and woods (noise down the slope),
// and the whole ring is washed toward the map's own fog colour by its distance (layer).
const HAZE = [0.3, 0.5, 0.68];
function ring({ radius, base, height, color, top, seed }, layer) {
  const SEG = 360, ROWS = 5;
  const positions = [], colors = [];
  const lo = new THREE.Color(color), hi = new THREE.Color(top), c = new THREE.Color();
  const L = activeMap().light ?? {}, fog = new THREE.Color(activeMap().fog?.color ?? 0xb9c6cc);
  const az = THREE.MathUtils.degToRad(L.azimuth ?? 215), sun = [Math.sin(az), -Math.cos(az)];   // (x, z: compass bearing, north −z)
  const ridge = (a) => base + height * (0.35 + 0.65 * fbm(Math.cos(a) * 3 + seed * 10, Math.sin(a) * 3 - seed * 7, 5));
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    // Ridgeline: broad swells plus finer peaks, wrapping seamlessly around the circle.
    const h = ridge(a), x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    // The slope's facing: toward the centre (the viewer), turned along the ring by how steeply the
    // ridge climbs there. Lit 0.7 (back to the sun) to 1.15 (facing it).
    const slope = (ridge(a + 0.004) - ridge(a - 0.004)) / (0.008 * radius);
    let nx = -Math.cos(a) - Math.sin(a) * slope * 2.5, nz = -Math.sin(a) + Math.cos(a) * slope * 2.5;
    const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
    const lit = 0.92 + 0.23 * (nx * sun[0] + nz * sun[1]);
    for (let r = 0; r <= ROWS; r++) {
      const f = r / ROWS, y = -60 + (h + 60) * f;
      const gully = 0.85 + 0.3 * fbm(Math.cos(a) * 40 + seed * 3, f * 4 + seed, 3);   // (woods and gullies)
      positions.push(x, y, z);
      c.copy(lo).lerp(hi, 0.8 * f).multiplyScalar(lit * (r < ROWS ? gully : 1)).lerp(fog, HAZE[layer] * (0.6 + 0.4 * f));
      colors.push(c.r, c.g, c.b);
    }
  }
  const index = [];
  for (let i = 0; i < SEG; i++) for (let r = 0; r < ROWS; r++) {
    const k = i * (ROWS + 1) + r, n = k + ROWS + 1;
    index.push(k, k + 1, n, k + 1, n + 1, n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.userData.noAO = true;
  m.frustumCulled = false;
  return m;
}

// The panorama's cylinder: u runs clockwise from south through north (u = 0.5) as horizon.py renders
// it; rows are spaced by latitude so the strip isn't stretched.
function panorama(tex, k) {
  const SEG = 256, ROWS = 19, pos = [], uv = [], index = [];
  for (let r = 0; r <= ROWS; r++) {
    const lat = THREE.MathUtils.degToRad(LAT[0] + (LAT[1] - LAT[0]) * r / ROWS), y = R * Math.tan(lat);
    for (let i = 0; i <= SEG; i++) {
      const bearing = (i / SEG - 0.5) * Math.PI * 2;        // clockwise from north (−z)
      pos.push(R * Math.sin(bearing), y, -R * Math.cos(bearing));
      uv.push(i / SEG, r / ROWS);
    }
  }
  for (let r = 0; r < ROWS; r++) for (let i = 0; i < SEG; i++) {
    const a = r * (SEG + 1) + i, b = a + SEG + 1;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // Unlit: the render already has the mission's light and haze in it, as radiance / k (the sky near
  // the horizon is many times brighter than a texture holds), and it's tone-mapped with the rest.
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  mat.color.setScalar(k);
  // The far hills read flat: the render's haze, right for the distance, leaves their light and shade
  // only a few percent apart. Local contrast brings it back: each texel's difference from the
  // country round it (a blurred mip, 3.5 levels down, about 10 texels), as a ratio of brightness, is
  // drawn out (to the power 1.8: each texel brighter or darker than its surroundings becomes 1.8
  // times as much so), which keeps the overall tone, the hue and the haze but shows the ridges,
  // gullies and woods. Held to 25% darker or 35% lighter: a plain difference turned the Po's poplar
  // rows, dark against the white haze behind them, black. And only on solid land: the clear sky's
  // texels still hold the haze colour Blender rendered there, which means nothing in the blur, so
  // the effect fades out by the blurred texel's own cover (a ridge's edge stays as it was).
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec4 sampledDiffuseColor = texture2D( map, vMapUv );
      vec4 wide4 = texture2D( map, vMapUv, 3.5 );
      float solid = smoothstep( 0.97, 1.0, wide4.a ) * smoothstep( 0.97, 1.0, sampledDiffuseColor.a );
      const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
      float lr = dot( sampledDiffuseColor.rgb, LUMA ) / max( dot( wide4.rgb, LUMA ), 1e-4 );
      sampledDiffuseColor.rgb *= mix( 1.0, clamp( pow( lr, 0.8 ), 0.75, 1.35 ), solid );
      diffuseColor *= sampledDiffuseColor;`);
  };
  mat.customProgramCacheKey = () => 'horizon-panorama';
  mat.opacity = 1 - (activeMap().horizonFade ?? 0);   // (under cloud, rain or mist the far country fades)
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = -5;
  m.userData.noAO = true;
  // Centred on whichever camera draws it (the player's, the kill cam's).
  m.onBeforeRender = (renderer, scene, camera) => { m.position.copy(camera.position); m.updateMatrixWorld(); };
  return m;
}

// Resolves when the far country's panorama is in (or isn't coming): main.js waits for it before
// warming up, so its shader and texture aren't first met in play.
export let horizonReady = Promise.resolve();
export function buildHorizon(scene, id = null) {
  const group = new THREE.Group();
  if (id) horizonReady = (async () => {
    try {
      const k = (await (await fetch(asset(`textures/horizons.json`))).json())[id];
      if (!k) return;                    // no panorama for this mission: the ridgelines stay
      const tex = await new THREE.TextureLoader().loadAsync(asset(`textures/horizon_${id}.webp`));
      group.clear();                     // the drawn ridgelines give way
      group.add(panorama(tex, k));
    } catch { /* missing: the ridgelines stay */ }
  })();
  // Farthest first, so nearer ridges are drawn over them.
  for (const L of [...LAYERS].reverse()) {
    const m = ring(L, LAYERS.indexOf(L));
    m.renderOrder = -10 + LAYERS.indexOf(L);
    group.add(m);
  }
  scene.add(group);
  return group;
}
