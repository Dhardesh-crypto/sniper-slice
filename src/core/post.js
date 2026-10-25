// Post-processing: multisampled HDR render, ambient occlusion, a touch of bloom, then a
// warm colour grade with a soft vignette, and finally tone mapping to the screen.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
    // Also skip anything flagged noAO (e.g. shader-placed grass) in the AO's normal pass.
    const hide = this.gtao._overrideVisibility.bind(this.gtao);
    this.gtao._overrideVisibility = () => {
      hide();
      scene.traverse((o) => { if (o.userData.noAO && o.visible) { o.visible = false; this.gtao._visibilityCache.push(o); } });
    };
    this.composer.addPass(this.gtao);

    // Bloom on what's brighter than 8 (the sun, fire), fed only the part above 8 and capped:
    // the stock pass passes a bright pixel's whole value, and the sun's wide halo (up to
    // ~28,000) then flooded the screen white whenever you looked toward it.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.12, 0.4, 0);
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = min( max( texel.rgb - vec3( 8.0 ), vec3( 0.0 ) ), vec3( 4.0 ) );');
    hp.needsUpdate = true;
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
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
