import * as THREE from 'three'
import { FACADE_CELL } from './facade-grid'
import { replaceOrThrow } from './shader-utils'

export interface FacadeUniforms {
  uLit: { value: number }
  uSkyTint: { value: THREE.Color }
}
export type FacadeVariant = 'full' | 'lite'

const warm = new THREE.Color(0xffe1a8)
const warmGlsl = `vec3(${warm.r.toFixed(9)}, ${warm.g.toFixed(9)}, ${warm.b.toFixed(9)})`
const vertexDeclarations = `
attribute float aSeed;
varying vec3 vFacadePos;
varying vec3 vFaceNormal;
varying float vSeed;
varying float vFacadeDepth;
`
const fragmentDeclarations = `
uniform float uLit;
uniform vec3 uSkyTint;
varying vec3 vFacadePos;
varying vec3 vFaceNormal;
varying float vSeed;
varying float vFacadeDepth;
float facadeHash13(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
`

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
float facadeBuildingHash = 0.0;
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
  facadeCellHash = facadeHash13(vec3(facadeCell, vSeed));
  facadeLit = 1.0 - step(uLit, facadeCellHash);
  facadeWindowEmission = ${warmGlsl} * 2.7 * facadeLit * windowCoverage;
}
`
}

export function createFacadeMaterial(options: {
  color: number; uniforms: FacadeUniforms; variant: FacadeVariant
}): THREE.MeshStandardMaterial {
  const { color, uniforms, variant } = options
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 })
  material.name = `journey-facade-${variant}`
  material.customProgramCacheKey = () => `facade-${variant}`
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
  }
  return material
}
