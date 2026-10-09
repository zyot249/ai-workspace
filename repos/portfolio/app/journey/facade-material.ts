import * as THREE from 'three'
import { FACADE_CELL } from './facade-grid'
import { glslFloat, glslVec3, replaceOrThrow } from './shader-utils'
import { WINDOW, WINDOW_PALETTE } from './window-look'

export interface FacadeUniforms {
  uLit: { value: number }
  uSkyTint: { value: THREE.Color }
  uTime: { value: number }
  uFlicker: { value: number }
  uEmissiveScale: { value: number }
}
export type FacadeVariant = 'full' | 'lite'

const glsl = glslFloat
const glsl3 = glslVec3
const [warm, neutral, cool] = WINDOW_PALETTE
const saltedHash = (salt: readonly [number, number, number]) =>
  `windowHash13(vec3(facadeCell + vec2(${glsl(salt[0])}, ${glsl(salt[1])}), vSeed + ${glsl(salt[2])}))`
const vertexDeclarations = `
attribute float aSeed;
varying vec3 vFacadePos;
varying vec3 vFaceNormal;
varying float vSeed;
varying float vFacadeDepth;
`
const fragmentDeclarations = `
precision highp float;
uniform float uLit;
uniform float uTime;
uniform float uFlicker;
uniform float uEmissiveScale;
uniform vec3 uSkyTint;
varying vec3 vFacadePos;
varying vec3 vFaceNormal;
varying float vSeed;
varying float vFacadeDepth;
float windowHash11(float p) {
  p = fract(p * ${glsl(WINDOW.hashMultiplier)});
  p *= p + ${glsl(WINDOW.hash11Offset)};
  p *= p + p;
  return fract(p);
}
float windowHash13(vec3 p) {
  vec3 p3 = fract(p * ${glsl(WINDOW.hashMultiplier)});
  vec3 q = p3.zyx + ${glsl(WINDOW.hash13Offset)};
  float a = p3.x * q.x;
  float b = p3.y * q.y;
  float c = p3.z * q.z;
  float d = (a + b) + c;
  p3 += d;
  return fract((p3.x + p3.y) * p3.z);
}
`

const fullEmission = `
  facadeTintHash = ${saltedHash(WINDOW.tintSalt)};
  float brightnessHash = ${saltedHash(WINDOW.brightnessSalt)};
  float flickerHash = ${saltedHash(WINDOW.flickerSalt)};
  vec3 lightColor = ${glsl3(warm.linear)};
  float lightGain = ${glsl(warm.gain)};
  if (facadeTintHash >= ${glsl(WINDOW.neutralCut)}) {
    lightColor = ${glsl3(cool.linear)}; lightGain = ${glsl(cool.gain)};
  } else if (facadeTintHash >= ${glsl(WINDOW.warmCut)}) {
    lightColor = ${glsl3(neutral.linear)}; lightGain = ${glsl(neutral.gain)};
  }
  float brightness = mix(${glsl(WINDOW.brightnessMin)}, ${glsl(WINDOW.brightnessMax)}, brightnessHash);
  float flicker = 1.0;
  if (facadeTintHash >= ${glsl(WINDOW.neutralCut)} && flickerHash < ${glsl(WINDOW.flickerCut)}) {
    float phase = flickerHash * ${glsl(WINDOW.phasePeriod)};
    flicker = mix(1.0, 0.8 + 0.2 * sin(uTime * 6.3 + phase)
      * sin(uTime * 2.1 + phase * 1.7), uFlicker);
  }
  facadeWindowEmission = lightColor * lightGain * brightness * flicker
    * uEmissiveScale * facadeLit * windowCoverage;`
const liteEmission = `
  facadeWindowEmission = ${glsl3(warm.linear)} * ${glsl(warm.gain)}
    * uEmissiveScale * facadeLit * windowCoverage;`

function facadeColorPatch(variant: FacadeVariant): string {
  const filter = variant === 'full'
    ? `vec2 aa = max(fwidth(uv) / CELL, vec2(0.00001));
       distanceFade = smoothstep(0.35, 0.7, max(aa.x, aa.y));
       vec2 lo = smoothstep(vec2(0.2, 0.18) - aa, vec2(0.2, 0.18) + aa, local);
       vec2 hi = 1.0 - smoothstep(vec2(0.8, 0.82) - aa, vec2(0.8, 0.82) + aa, local);
       float rect = lo.x * lo.y * hi.x * hi.y;
       float floorBand = 1.0 - smoothstep(0.02 - aa.y * CELL.y, 0.02 + aa.y * CELL.y, local.y * CELL.y);`
    : `distanceFade = smoothstep(6.0, 14.0, vFacadeDepth);
       float rect = step(0.2, local.x) * step(local.x, 0.8) * step(0.18, local.y) * step(local.y, 0.82);
       float floorBand = 1.0 - step(0.02, local.y * CELL.y);`
  return `
#include <color_fragment>
vec2 facadeCell = vec2(0.0);
vec2 facadeLocal = vec2(0.0);
float windowCoverage = 0.0;
float distanceFade = 0.0;
float facadeCellHash = 0.0;
float facadeBuildingHash = windowHash11(vSeed);
float facadeTintHash = 0.0;
float facadeLit = 0.0;
vec3 facadeWindowEmission = vec3(0.0);
if (abs(vFaceNormal.y) < 0.5) {
  vec2 uv = abs(vFaceNormal.x) > 0.5 ? vec2(vFacadePos.z, vFacadePos.y) : vec2(vFacadePos.x, vFacadePos.y);
  const vec2 CELL = vec2(${FACADE_CELL[0]}, ${FACADE_CELL[1]});
  facadeCell = floor(uv / CELL);
  facadeLocal = fract(uv / CELL);
  vec2 local = facadeLocal;
  ${filter}
  vec3 wallColor = diffuseColor.rgb;
  vec3 glass = mix(wallColor, uSkyTint * 0.35, 0.6);
  windowCoverage = rect * (1.0 - distanceFade);
  vec3 linedWall = wallColor * (1.0 - 0.12 * floorBand * (1.0 - distanceFade));
  vec3 detail = mix(linedWall, glass, windowCoverage);
  const float windowArea = 0.6 * 0.64;
  const float floorArea = 0.02 / 0.22;
  vec3 averageFacade = mix(wallColor * (1.0 - 0.12 * floorArea), glass, windowArea);
  diffuseColor.rgb = mix(detail, averageFacade, distanceFade);
  facadeCellHash = windowHash13(vec3(facadeCell, vSeed));
  float k = mix(${glsl(WINDOW.kMax)}, ${glsl(WINDOW.kMin)}, facadeBuildingHash);
  float threshold = facadeCellHash * k;
  facadeLit = smoothstep(threshold, threshold + ${glsl(WINDOW.fadeBand)}, uLit);${variant === 'full' ? fullEmission : liteEmission}
}
`
}

const debugOutput = `
#if defined(FACADE_DEBUG_WINDOW) && FACADE_DEBUG_WINDOW == 1
  gl_FragColor = vec4(vec3(facadeLit), 1.0);
#elif defined(FACADE_DEBUG_WINDOW) && FACADE_DEBUG_WINDOW == 2
  gl_FragColor = vec4(facadeCellHash, facadeBuildingHash, facadeTintHash, 1.0);
#elif defined(FACADE_DEBUG_WINDOW) && FACADE_DEBUG_WINDOW == 3
  gl_FragColor = vec4(facadeWindowEmission, 1.0);
#endif
`

export function createFacadeMaterial(options: {
  color: number; uniforms: FacadeUniforms; variant: FacadeVariant
}): THREE.MeshStandardMaterial {
  const { color, uniforms, variant } = options
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 })
  material.name = `journey-facade-${variant}`
  material.precision = 'highp'
  material.customProgramCacheKey = () =>
    `facade-${variant}-windows-ab-${material.defines?.FACADE_DEBUG_WINDOW ?? 0}`
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <common>', '#include <common>\n' + vertexDeclarations)
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <begin_vertex>', `
#include <begin_vertex>
vec3 facadeScale = vec3(1.0);
#ifdef USE_INSTANCING
facadeScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#endif
vFacadePos = (position + vec3(0.0, 0.5, 0.0)) * facadeScale;
vFaceNormal = normal;
vSeed = aSeed;
`)
    shader.vertexShader = replaceOrThrow(shader.vertexShader, '#include <project_vertex>', '#include <project_vertex>\nvFacadeDepth = -mvPosition.z;')
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <common>', '#include <common>\n' + fragmentDeclarations)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <color_fragment>', facadeColorPatch(variant))
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facadeWindowEmission;')
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, '#include <dithering_fragment>', `#include <dithering_fragment>
${debugOutput}`)
  }
  return material
}
