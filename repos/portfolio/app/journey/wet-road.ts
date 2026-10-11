import * as THREE from 'three'
import { PUDDLE_GLSL } from './asphalt'
import { roadRects } from './path'
import { preservingState, probePostSupport } from './post'
import { REFLECT_LAYER } from './reflect-layer'
import { REFLECT_PLANE_Y, updateReflectionCamera } from './reflection'

export const WET_ROAD_NAME = 'journey-wet-road'
// At or below this wetness the pass does not run and the overlay is hidden (the intro chapter, and the whole light theme).
export const WET_MIN = 0.02
export const WET_WARMUP = 0.5
export const REFLECTION_SCALE = 0.5
export const PASS_DRAW_CALL_BUDGET = 16
// Before the shadow quads (renderOrder 1), set on the mesh, not the material.
const OVERLAY_RENDER_ORDER = 0.5
const OVERLAY_MARGIN = 4
const ROAD_RECT_COUNT = 5

// The overlay is one flat quad over the whole road: the road bounding box plus a margin on every side.
export function overlayPlacement(): { center: [number, number, number]; size: [number, number] } {
  const rects = roadRects()
  const minX = Math.min(...rects.map(r => r[0])) - OVERLAY_MARGIN
  const minZ = Math.min(...rects.map(r => r[1])) - OVERLAY_MARGIN
  const maxX = Math.max(...rects.map(r => r[2])) + OVERLAY_MARGIN
  const maxZ = Math.max(...rects.map(r => r[3])) + OVERLAY_MARGIN
  return { center: [(minX + maxX) / 2, REFLECT_PLANE_Y, (minZ + maxZ) / 2], size: [maxX - minX, maxZ - minZ] }
}

const vertexShader = `
uniform mat4 textureMatrix;
varying vec2 vWorldXZ;
varying float vViewDepth;
varying vec4 vReflUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vWorldXZ = world.xz;
  vViewDepth = -view.z;
  vReflUv = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
}`

// Linear HDR out, no tone-mapping or color-space chunks: the composer's OutputPass maps the whole frame.
const fragmentShader = `
uniform sampler2D tDiffuse;
uniform vec4 uRects[${ROAD_RECT_COUNT}];
uniform float uWetness;
uniform float uFogDensity;
varying vec2 vWorldXZ;
varying float vViewDepth;
varying vec4 vReflUv;
${PUDDLE_GLSL}
void main() {
  bool onRoad = false;
  for (int i = 0; i < ${ROAD_RECT_COUNT}; i++) {
    vec4 r = uRects[i];
    if (vWorldXZ.x >= r.x && vWorldXZ.y >= r.y && vWorldXZ.x <= r.z && vWorldXZ.y <= r.w) onRoad = true;
  }
  if (!onRoad) discard;
#ifdef WET_DEBUG_COVERAGE
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
  return;
#endif
  float wetAmt = uWetness * puddleMask(vWorldXZ);
  float distortion = (puddleNoise(vWorldXZ * 3.0) - 0.5) * 0.02;
#ifdef WET_DEBUG_FLOOD
  wetAmt = 1.0;
  distortion = 0.0;
#endif
  vec3 reflected = texture2D(tDiffuse, vReflUv.xy / vReflUv.w + distortion).rgb;
  vec3 V = normalize(cameraPosition - vec3(vWorldXZ.x, ${REFLECT_PLANE_Y}, vWorldXZ.y));
  float fresnel = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  float fogFactor = 1.0 - exp(-pow(uFogDensity * vViewDepth, 2.0));
  float alpha = mix(0.1, 0.9, fresnel) * wetAmt * (1.0 - fogFactor);
  gl_FragColor = vec4(reflected, alpha);
}`

export interface WetRoadStats {
  passes: number
  lastDrawCalls: number
}

export interface WetRoadOptions {
  // Test seam: replaces the framebuffer-completeness check of the freshly allocated target.
  checkComplete?: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) => boolean
}

export interface WetRoad {
  readonly overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  readonly target: THREE.WebGLRenderTarget
  readonly stats: WetRoadStats
  enabled: boolean
  setLook(wetness: number, fogDensity: number): void
  setSize(drawingWidth: number, drawingHeight: number): void
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void
  dispose(): void
}

function drainErrors(gl: WebGL2RenderingContext): void {
  while (gl.getError() !== gl.NO_ERROR) if (gl.isContextLost()) return
}

// Allocation is lazy, so a target built without error can still fail on first use. Bind it and ask.
function targetComplete(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): boolean {
  const gl = renderer.getContext() as WebGL2RenderingContext
  renderer.setRenderTarget(target)
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  renderer.setRenderTarget(null)
  return complete
}

const scaled = (size: number) => Math.max(1, Math.floor(size * REFLECTION_SCALE))
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

// Returns null when the reflection is unavailable (no HDR targets, or the target is incomplete); the caller then
// keeps Parts A and B. Shader and JS failures propagate to the scene's unavailable guard.
export function createWetRoad(renderer: THREE.WebGLRenderer, options: WetRoadOptions = {}): WetRoad | null {
  if (!probePostSupport(renderer)) return null
  const gl = renderer.getContext() as WebGL2RenderingContext
  const drawing = renderer.getDrawingBufferSize(new THREE.Vector2())
  const target = new THREE.WebGLRenderTarget(scaled(drawing.x), scaled(drawing.y), {
    type: THREE.HalfFloatType, depthBuffer: true,
  })
  if (!(options.checkComplete ?? targetComplete)(renderer, target)) {
    target.dispose()
    renderer.setRenderTarget(null)
    drainErrors(gl)
    return null
  }

  const textureMatrix = new THREE.Matrix4()
  const uniforms = {
    tDiffuse: { value: target.texture },
    textureMatrix: { value: textureMatrix },
    uRects: { value: roadRects().map(([minX, minZ, maxX, maxZ]) => new THREE.Vector4(minX, minZ, maxX, maxZ)) },
    uWetness: { value: 0 },
    uFogDensity: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({
    name: WET_ROAD_NAME, uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, fog: false,
    // The overlay floats 3 mm above the road; depth precision is coarser than that past about 60 units.
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  material.customProgramCacheKey = () =>
    `wet-road-${material.defines?.WET_DEBUG_COVERAGE ?? 0}-${material.defines?.WET_DEBUG_FLOOD ?? 0}`

  const { center, size } = overlayPlacement()
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material)
  overlay.rotation.x = -Math.PI / 2
  overlay.position.set(...center)
  overlay.updateMatrixWorld(true)
  overlay.name = WET_ROAD_NAME
  overlay.renderOrder = OVERLAY_RENDER_ORDER
  overlay.frustumCulled = false
  overlay.visible = false

  const virtual = new THREE.PerspectiveCamera()
  virtual.layers.set(REFLECT_LAYER)
  const stats: WetRoadStats = { passes: 0, lastDrawCalls: 0 }
  let enabled = true

  const wetRoad: WetRoad = {
    overlay, target, stats,
    get enabled() { return enabled },
    set enabled(value: boolean) {
      enabled = value
      overlay.visible = enabled && uniforms.uWetness.value > WET_MIN
    },
    setLook(wetness, fogDensity) {
      uniforms.uWetness.value = wetness
      uniforms.uFogDensity.value = fogDensity
      overlay.visible = enabled && wetness > WET_MIN
    },
    setSize(drawingWidth, drawingHeight) {
      target.setSize(scaled(drawingWidth), scaled(drawingHeight))
    },
    render(scene, camera) {
      if (!overlay.visible) return
      updateReflectionCamera(virtual, camera)
      textureMatrix.copy(BIAS).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse).multiply(overlay.matrixWorld)
      // Every frame: cars move, windows flicker, and a resize or context restore leaves a new target empty.
      preservingState(renderer, () => {
        renderer.setRenderTarget(target)
        renderer.autoClear = true
        renderer.render(scene, virtual)
        stats.lastDrawCalls = renderer.info.render.calls
      })
      stats.passes += 1
    },
    dispose() {
      target.dispose()
      overlay.geometry.dispose()
      material.dispose()
    },
  }
  overlay.userData.wetRoad = wetRoad
  return wetRoad
}
