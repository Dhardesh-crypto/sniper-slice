// Post-processing: multisampled HDR render, ambient occlusion, a touch of bloom, then a
// colour grade with a soft vignette, and finally tone mapping to the screen. The grade is one
// shader for every map; its warmth and saturation come from the map's light settings (after this
// run's conditions have changed them), so each region keeps its own colour: Tuscany warm and
// full, the Ligurian coast cooler, the misty Apennine forest cold and muted.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { activeMap } from '../world/terrain.js';
import { LIGHT } from '../world/world.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uWarm: { value: new THREE.Vector3(1.04, 1.0, 0.94) },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.08 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform vec3 uWarm; uniform float uContrast; uniform float uSaturation;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uWarm;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.18) * uContrast + 0.18;          // contrast around mid-grey (linear)
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.render = new RenderPass(scene, camera);
    this.composer.addPass(this.render);

    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 2, scale: 1, samples: 8 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 1, samples: 6 }); // ~5 ms instead of ~27
    // Also skip anything flagged noAO (e.g. shader-placed grass) in the AO's normal pass: three's
    // own hiding of points and lines, plus that, in one walk of the scene (its _restoreVisibility
    // shows them all again from the same cache).
    this.gtao._overrideVisibility = () => {
      const cache = this.gtao._visibilityCache;
      scene.traverse((o) => { if ((o.isPoints || o.isLine || o.isLine2 || o.userData.noAO) && o.visible) { o.visible = false; cache.push(o); } });
    };
    this.composer.addPass(this.gtao);

    // Bloom on what's brighter than 8 (the sun, fire), fed only the part above 8 and capped:
    // the stock pass passes a bright pixel's whole value, and the sun's wide halo (up to
    // ~28,000) then flooded the screen white whenever you looked toward it. Green and blue are
    // held to red first: a high sun's clear sky is over 8 in blue alone (3.9, 8.3, 12.2 thirty
    // degrees off it), and that blue, spread by the blur, dyed everything in front of the sky.
    // Warm light (fire, flashes) has red on top already and blooms as it always did.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.12, 0.4, 0);
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = min( max( min( texel.rgb, vec3( texel.r ) ) - vec3( 8.0 ), vec3( 0.0 ) ), vec3( 4.0 ) );');
    hp.needsUpdate = true;
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    const L = { ...LIGHT, ...activeMap().light };
    this.setGrade(L.warmth, L.saturation);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  // The grade's warmth (1: red up 4%, blue down 6%, the grade every map had; 0 neutral; above 1
  // warmer) and saturation (1 = none added).
  setGrade(warmth = 1, saturation = 1.08) {
    this.grade.uniforms.uWarm.value.set(1 + 0.04 * warmth, 1, 1 - 0.06 * warmth);
    this.grade.uniforms.uSaturation.value = saturation;
  }

  // high: up to 2x pixel ratio + AO; medium: up to 1.5x + AO; low: 1x, no AO or bloom.
  // The setting is a ceiling: the resolution scaler in main.js may render below it.
  setQuality(q) {
    this.maxPixelRatio = Math.min(devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.minPixelRatio = Math.min(this.maxPixelRatio, q === 'low' ? 0.75 : 1);
    this.gtao.enabled = q !== 'low';
    this.bloom.enabled = q !== 'low';
    this.setPixelRatio(this.maxPixelRatio);
  }

  setPixelRatio(pr) {
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    // Above 1x the pixels are fine enough on their own; 4x multisampling there costs about half
    // the frame, so it's only used at 1x (and every step the resolution scaler takes down is
    // cheaper than the one before).
    const samples = pr > 1 ? 0 : 4;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
    this.setSize(innerWidth, innerHeight);
  }

  setCamera(camera) {
    this.render.camera = camera;
    this.gtao.camera = camera;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    // Ambient occlusion is soft shading and the bloom only catches very bright things: both are
    // computed at half the render size (the bloom blurs at a quarter), which looks the same and
    // saves most of their cost on a large Retina screen.
    const pr = this.renderer.getPixelRatio(), W = Math.round(w * pr), H = Math.round(h * pr);
    this.gtao.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.bloom.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
  }

  draw() {
    this.composer.render();
  }
}
