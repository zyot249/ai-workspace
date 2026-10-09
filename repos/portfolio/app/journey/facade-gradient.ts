import type * as THREE from 'three'
import { glslFloat } from './shader-utils'
import { smoothstep } from './sky-mirror'
import type { LookState } from './stops'

// World Y of the ground the walls stand on (shared conventions, section 6). Equals BASE_Y in buildings.ts;
// a test pins the two together so this file does not import buildings.ts.
export const GRADIENT_GROUND_Y = -1
export const AO_MIN = 0.55
export const AO_HEIGHT = 0.9
export const RIM_DEPTH = 0.25
export const BOUNCE_HEIGHT = 0.6

const RIM_STRENGTH = 0.35
const AO_NIGHT_RELIEF = 0.25
const BOUNCE_STRENGTH = 0.06

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// CPU mirror of the base-occlusion factor in the fragment shader.
export function aoFactor(height: number): number {
  return AO_MIN + (1 - AO_MIN) * smoothstep(0, AO_HEIGHT, height)
}

// The exact multiplier applied to the wall color: mix(1.0, ao, strength).
export function aoEffective(height: number, strength: number): number {
  return 1 + (aoFactor(height) - 1) * strength
}

export function rimAmount(worldY: number, topY: number, normalDotSun: number): number {
  return smoothstep(topY - RIM_DEPTH, topY, worldY) * Math.max(normalDotSun, 0)
}

export function bounceAmount(height: number): number {
  return 1 - smoothstep(0, BOUNCE_HEIGHT, height)
}

export interface FacadeGradientLook {
  uAoStrength: number
  uRimStrength: number
  uBounce: number
}

// `sunVisibility` is `sky.sunVisibility`: a smoothstep on the unclamped sun elevation.
export function facadeLookFor(look: Pick<LookState, 'windowLitRatio'>, sunVisibility: number): FacadeGradientLook {
  const lit = clamp01(look.windowLitRatio)
  return {
    uAoStrength: 1 - AO_NIGHT_RELIEF * lit,
    uRimStrength: RIM_STRENGTH * clamp01(sunVisibility),
    uBounce: BOUNCE_STRENGTH * lit,
  }
}

export type GradientVariant = 'full' | 'lite'

export interface FacadeGradientUniforms {
  uAoStrength: { value: number }
  uRimStrength: { value: number }
  uBounce: { value: number }
  uSunDir: { value: THREE.Vector3 }
  uSunColor: { value: THREE.Color }
  uBounceColor: { value: THREE.Color }
}

const glsl = glslFloat

export function gradientVertexDeclarations(variant: GradientVariant): string {
  return `
varying float vWorldY;${variant === 'full' ? `
varying float vTopY;
varying vec3 vWorldNormal;` : ''}
`
}

// Runs inside <begin_vertex>. Walls are scale-and-translate only (no rotation), so the unscaled normal is right.
export function gradientVertexPatch(variant: GradientVariant): string {
  return `
mat4 facadeModel = modelMatrix;
#ifdef USE_INSTANCING
facadeModel = modelMatrix * instanceMatrix;
#endif
vWorldY = (facadeModel * vec4(position, 1.0)).y;${variant === 'full' ? `
vTopY = (facadeModel * vec4(0.0, 0.5, 0.0, 1.0)).y;
vWorldNormal = normalize(mat3(modelMatrix) * normal);` : ''}
`
}

export function gradientFragmentDeclarations(variant: GradientVariant): string {
  return `
uniform float uAoStrength;
varying float vWorldY;
const float FACADE_AO_MIN = ${glsl(AO_MIN)};
const float FACADE_AO_HEIGHT = ${glsl(AO_HEIGHT)};${variant === 'full' ? `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uRimStrength;
uniform float uBounce;
uniform vec3 uBounceColor;
varying float vTopY;
varying vec3 vWorldNormal;
const float FACADE_RIM_DEPTH = ${glsl(RIM_DEPTH)};
const float FACADE_BOUNCE_HEIGHT = ${glsl(BOUNCE_HEIGHT)};` : ''}
`
}

// Runs at main scope after the window logic, so it darkens the wall and the glass diffuse but never the emissive windows.
export function gradientFragmentPatch(variant: GradientVariant): string {
  return `
float facadeHeight = vWorldY - (${glsl(GRADIENT_GROUND_Y)});
float facadeAo = mix(FACADE_AO_MIN, 1.0, smoothstep(0.0, FACADE_AO_HEIGHT, facadeHeight));
float facadeAoEffective = mix(1.0, facadeAo, uAoStrength);
diffuseColor.rgb *= facadeAoEffective;
vec3 facadeGradientEmission = vec3(0.0);${variant === 'full' ? `
float facadeRim = smoothstep(vTopY - FACADE_RIM_DEPTH, vTopY, vWorldY) * max(dot(normalize(vWorldNormal), uSunDir), 0.0);
facadeGradientEmission += uSunColor * facadeRim * uRimStrength;
float facadeBounce = 1.0 - smoothstep(0.0, FACADE_BOUNCE_HEIGHT, facadeHeight);
facadeGradientEmission += uBounceColor * facadeBounce * uBounce;` : ''}
`
}
