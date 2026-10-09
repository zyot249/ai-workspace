import * as THREE from 'three'
import {
  CLOUD_TIME_WRAP, CLOUD_WIND, skyParamsFor, smoothstep, sunDirectionFor, sunVisibilityFor,
  type CloudOffset, type SkyVariant,
} from './sky-mirror'
import { SKY_VERTEX_SHADER, skyFragmentShader } from './sky-shader'
import type { LookState, StopState, Vec3 } from './stops'

export const SKY_NAME = 'journey-sky-dome'
export const SKY_RADIUS = 200
// The dome follows the camera at SKY_RADIUS. The scene-centred haze and far
// rings reach about 185 units from the camera at the path ends.
export const CAMERA_FAR = 260

const SKY_RENDER_ORDER = -1000
const SKY_SEGMENTS: Readonly<Record<SkyVariant, readonly [number, number]>> = { full: [32, 16], lite: [24, 12] }
const SUN_LIGHT_DISTANCE = 10
const MOONLIGHT_MIN_HEIGHT = 2
const MOONLIGHT_FLOOR = 0.25
const SUN_DARK_ELEVATION = -6
const SUN_FULL_ELEVATION = 12

export interface SunLight {
  position: Vec3
  intensity: number
}

export function lightFromStop(look: Pick<LookState, 'sunElevation' | 'sunAzimuth'>): SunLight {
  const [x, y, z] = sunDirectionFor(look.sunElevation, look.sunAzimuth)
  return {
    // The height clamp keeps a below-horizon sun lighting from above as moonlight.
    position: [x * SUN_LIGHT_DISTANCE, Math.max(MOONLIGHT_MIN_HEIGHT, y * SUN_LIGHT_DISTANCE), z * SUN_LIGHT_DISTANCE],
    intensity: Math.max(MOONLIGHT_FLOOR, smoothstep(SUN_DARK_ELEVATION, SUN_FULL_ELEVATION, look.sunElevation)),
  }
}

// The CPU wraps time, so the shader never sees a large offset; clouds jump once an hour.
export function cloudOffsetAt(t: number, reduced: boolean): CloudOffset {
  if (reduced || !Number.isFinite(t)) return [0, 0]
  const wrapped = ((t % CLOUD_TIME_WRAP) + CLOUD_TIME_WRAP) % CLOUD_TIME_WRAP
  return [CLOUD_WIND[0] * wrapped, CLOUD_WIND[1] * wrapped]
}

export interface Sky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  readonly sunDirection: THREE.Vector3
  readonly sunVisibility: number
  update(state: StopState, cameraPosition: THREE.Vector3, t: number): void
}

// The scene's dispose() traverses the dome like any other mesh, so Sky has no dispose of its own.
export function createSky(variant: SkyVariant, reduced: boolean): Sky {
  const uniforms = {
    uHorizon: { value: new THREE.Vector3() },
    uMid: { value: new THREE.Vector3() },
    uZenith: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Vector3() },
    uSunGlow: { value: 0 },
    uCloudCover: { value: 0 },
    uCloudLit: { value: new THREE.Vector3() },
    uCloudShade: { value: new THREE.Vector3() },
    uCloudOffset: { value: new THREE.Vector2() },
  }
  const material = new THREE.ShaderMaterial({
    name: 'journey-sky',
    uniforms,
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: skyFragmentShader(variant),
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  material.customProgramCacheKey = () => `sky-${variant}`
  const [widthSegments, heightSegments] = SKY_SEGMENTS[variant]
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, widthSegments, heightSegments), material)
  mesh.name = SKY_NAME
  mesh.renderOrder = SKY_RENDER_ORDER
  mesh.frustumCulled = false
  const sunDirection = new THREE.Vector3(0, 1, 0)
  let sunVisibility = 1

  return {
    mesh,
    sunDirection,
    get sunVisibility() { return sunVisibility },
    update(state, cameraPosition, t) {
      const p = skyParamsFor(state, cloudOffsetAt(t, reduced))
      uniforms.uHorizon.value.set(...p.horizon)
      uniforms.uMid.value.set(...p.mid)
      uniforms.uZenith.value.set(...p.zenith)
      uniforms.uSunDir.value.set(...p.sunDir)
      uniforms.uSunColor.value.set(...p.sunColor)
      uniforms.uSunGlow.value = p.sunGlow
      uniforms.uCloudCover.value = p.cloudCover
      uniforms.uCloudLit.value.set(...p.cloudLit)
      uniforms.uCloudShade.value.set(...p.cloudShade)
      uniforms.uCloudOffset.value.set(...p.cloudOffset)
      sunDirection.copy(uniforms.uSunDir.value)
      sunVisibility = sunVisibilityFor(p.sunDir[1])
      mesh.position.copy(cameraPosition)
    },
  }
}
