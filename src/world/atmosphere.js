// Haze that behaves like air (after Athenaion's core/atmosphere.js, MIT, Leon Lin): three's fog
// chunks are replaced, so every material with fog (the default) gets it. The map's own fog (colour,
// near/far or density) still sets how much; on top of that:
//  - height: the haze is thicker low down, so looking up at a ridge the air is clearer and looking
//    down into a valley it is thicker (the amount of air along the line of sight, not just its length);
//  - colour: blue fades first, so far things turn blue-grey and the near ground keeps its warmth;
//  - the sun: haze toward the sun glows in its colour (forward scattering), away from it it doesn't.
// The values live in arrays shared by every program (three copies uniform objects per material but
// passes plain typed arrays through by reference), so setAtmosphere() reaches all of them at once.
import * as THREE from 'three';

const SUN = new Float32Array([0, 1, 0]);        // direction toward the sun
const SUN_COLOR = new Float32Array([1, 1, 1]);  // linear
const PARAMS = new Float32Array([0, 0, 0]);     // height scale (m), sun glow, on (1) / off (0)

const H = 220;            // the haze's scale height: e-fold every 220 m up
const GLOW = 0.035;       // how bright the haze gets toward the sun
const EXT = '0.8, 0.95, 1.2';   // per-channel share of the fog: red gets through, blue is lost first

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;
// From the final view-space position, so skinning, instancing and the wind's vertex shifts are in it.
const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
#endif
`;
const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec3 atmoSun;
  uniform vec3 atmoSunColor;
  uniform vec3 atmoParams;
#endif
`;
const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  {
    float fogD = vFogDepth;
    vec3 fogCol = fogColor;
    vec3 fogExt = vec3( 1.0 );
    if ( atmoParams.z > 0.5 ) {
      vec3 V = vFogWorld - cameraPosition;
      float dist = max( length( V ), 1e-4 );
      vec3 dir = V / dist;
      // air along the ray through an exponential layer, relative to a level ray of the same length
      float k = clamp( dir.y * dist / atmoParams.x, -6.0, 6.0 );
      fogD *= clamp( abs( k ) > 1e-3 ? ( 1.0 - exp( - k ) ) / k : 1.0 - 0.5 * k, 0.25, 3.0 );
      float mu = dot( dir, atmoSun ), g = 0.7;
      float phase = ( 1.0 - g * g ) / pow( max( 1.0 + g * g - 2.0 * g * mu, 1e-4 ), 1.5 );   // Henyey-Greenstein, x 4 pi
      fogCol += atmoSunColor * atmoParams.y * phase;
      fogExt = vec3( ${EXT} );
    }
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogD * fogD );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, fogD );
    #endif
    vec3 f3 = 1.0 - pow( vec3( 1.0 - fogFactor ), fogExt );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, f3 );
  }
#endif
`;

// Call once, before anything is drawn.
export function installAtmosphere() {
  THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FRAGMENT;
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (!lib.uniforms?.fogColor) continue;
    lib.uniforms.atmoSun = { value: SUN };
    lib.uniforms.atmoSunColor = { value: SUN_COLOR };
    lib.uniforms.atmoParams = { value: PARAMS };
  }
}

// The map's sun (a direction toward it and its colour); off = plain fog.
export function setAtmosphere(sunDir, sunColor, on = true) {
  SUN.set([sunDir.x, sunDir.y, sunDir.z]);
  const c = new THREE.Color(sunColor);
  SUN_COLOR.set([c.r, c.g, c.b]);
  PARAMS.set([H, GLOW, on ? 1 : 0]);
}
