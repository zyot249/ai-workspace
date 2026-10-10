import { glslFloat } from './shader-utils'

// Spec 06 Part C. The CPU mirrors below define the formula; the GLSL in glassStatements() must match them.
export const GLASS = {
  darkFactor: 0.25,
  fresnelPower: 3,
  tintBase: 0.35,
  tintFresnel: 0.45,
  glintPower: 24,
  glintGain: 0.8,
} as const

export type Rgb = readonly [number, number, number]
export type Vec3Tuple = readonly [number, number, number]
export type GlassVariant = 'full' | 'lite'

const glsl = glslFloat
const dot = (a: Vec3Tuple, b: Vec3Tuple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function fresnelAmount(normalDotView: number): number {
  return (1 - Math.max(normalDotView, 0)) ** GLASS.fresnelPower
}

export function glintAmount(reflectDotSun: number, sunVisibility: number): number {
  return Math.max(reflectDotSun, 0) ** GLASS.glintPower * sunVisibility
}

// R = reflect(-V, N) = -V + 2 (N . V) N. All vectors must be unit length.
export function reflectedSunDot(normal: Vec3Tuple, view: Vec3Tuple, sunDir: Vec3Tuple): number {
  const k = 2 * dot(normal, view)
  const reflected: Vec3Tuple = [
    -view[0] + k * normal[0], -view[1] + k * normal[1], -view[2] + k * normal[2],
  ]
  return dot(reflected, sunDir)
}

export interface GlassInput {
  wall: Rgb
  skyTint: Rgb
  sunColor: Rgb
  normal: Vec3Tuple
  view: Vec3Tuple
  sunDir: Vec3Tuple
  sunVisibility: number
}

export function glassColorFor(input: GlassInput): Rgb {
  const fres = fresnelAmount(dot(input.normal, input.view))
  const glint = glintAmount(reflectedSunDot(input.normal, input.view, input.sunDir), input.sunVisibility)
  const t = GLASS.tintBase + GLASS.tintFresnel * fres
  const channel = (i: 0 | 1 | 2): number =>
    input.wall[i] * GLASS.darkFactor * (1 - t) + input.skyTint[i] * t + input.sunColor[i] * glint * GLASS.glintGain
  return [channel(0), channel(1), channel(2)]
}

export function glassVertexDeclarations(variant: GlassVariant): string {
  return variant === 'full' ? 'varying vec3 vWorldPos;\n' : ''
}

// Runs after gradientVertexPatch, which declares `facadeModel`.
export function glassVertexPatch(variant: GlassVariant): string {
  return variant === 'full' ? 'vWorldPos = (facadeModel * vec4(position, 1.0)).xyz;\n' : ''
}

// uSunDir, uSunColor, uSkyTint, and vWorldNormal are declared by facade-gradient.ts and facade-material.ts.
export function glassFragmentDeclarations(variant: GlassVariant): string {
  return variant === 'full' ? 'uniform float uSunVisibility;\nvarying vec3 vWorldPos;\n' : ''
}

// Runs inside the windowed-face branch, after `wallColor` is set. Defines `glass`.
export function glassStatements(variant: GlassVariant): string {
  if (variant === 'lite') return 'vec3 glass = mix(wallColor, uSkyTint * 0.35, 0.6);'
  return `
  vec3 glassDark = wallColor * ${glsl(GLASS.darkFactor)};
  vec3 glassN = normalize(vWorldNormal);
  vec3 glassV = normalize(cameraPosition - vWorldPos);
  float glassFresnel = pow(1.0 - max(dot(glassN, glassV), 0.0), ${glsl(GLASS.fresnelPower)});
  vec3 glassR = reflect(-glassV, glassN);
  float glassGlint = pow(max(dot(glassR, uSunDir), 0.0), ${glsl(GLASS.glintPower)}) * uSunVisibility;
  vec3 glass = mix(glassDark, uSkyTint, ${glsl(GLASS.tintBase)} + ${glsl(GLASS.tintFresnel)} * glassFresnel)
    + uSunColor * glassGlint * ${glsl(GLASS.glintGain)};`
}
