import * as THREE from 'three'
import { damp, dampState, easeInOut, lerpStop } from './interpolate'
import { STOPS, type Stop, type StopState } from './stops'
import { LITE_MAX_WIDTH, type Tier } from './tier'

export interface Pointer {
  x: number
  y: number
}

export interface JourneyScene {
  update(chapter: number, progress: number, t: number, pointer: Pointer): void
  resize(width: number, height: number): void
  setTheme(isDark: boolean): void
  dispose(): void
}

const DAMPING = 0.08
const PARTICLE_COUNT = 800
const NARROW_OPACITY = 0.55
const MAX_FRAME_SECONDS = 0.1

function stopAt(index: number): Stop {
  const last = STOPS.length - 1
  const stop = STOPS[Math.min(Math.max(index, 0), last)]
  if (!stop) throw new Error('STOPS is empty')
  return stop
}

function createParticles(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (Math.random() - 0.5) * 14
    positions[i + 1] = (Math.random() - 0.5) * 10
    positions[i + 2] = (Math.random() - 0.5) * 8
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ size: 0.03, transparent: true, depthWrite: false })
  return new THREE.Points(geometry, material)
}

export function createJourneyScene(canvas: HTMLCanvasElement, tier: Exclude<Tier, 'none'>): JourneyScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'lite', alpha: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 'lite' ? 1.5 : 2))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)

  // Blob: an icosphere displaced along its normals in the vertex shader.
  const uniforms = { uTime: { value: 0 }, uStrength: { value: 0 } }
  const material = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.3, transparent: true })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uStrength = uniforms.uStrength
    shader.vertexShader = 'uniform float uTime;\nuniform float uStrength;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = position + normal * uStrength
        * sin(position.x * 3.0 + uTime)
        * sin(position.y * 2.5 + uTime * 0.8)
        * cos(position.z * 2.0 + uTime * 0.7);`,
    )
  }
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, tier === 'lite' ? 24 : 64), material)
  scene.add(blob)

  const ambient = new THREE.AmbientLight(0xffffff, 0.4)
  const pinkLight = new THREE.PointLight(0xec4899, 40)
  pinkLight.position.set(3, 2, 3)
  const indigoLight = new THREE.PointLight(0x6366f1, 40)
  indigoLight.position.set(-3, -2, 2)
  scene.add(ambient, pinkLight, indigoLight)

  const particles = tier === 'full' ? createParticles() : null
  if (particles) scene.add(particles)

  const first = stopAt(0)
  let current: StopState = target(0, 0)
  let narrow = false
  let phase = 0
  let lastT = 0
  const tilt = { x: 0, y: 0 }
  const lookAt = new THREE.Vector3()

  function target(chapter: number, progress: number): StopState {
    const state = lerpStop(stopAt(chapter), stopAt(chapter + 1), easeInOut(progress))
    if (tier === 'reduced') {
      // No motion: keep the first stop's framing and only let the color change.
      return { ...lerpStop(first, first, 0), color: state.color, strength: 0 }
    }
    return state
  }

  function apply(state: StopState) {
    const offset = narrow ? state.offsetNarrow : state.offsetWide
    blob.position.set(offset[0], offset[1], offset[2])
    blob.scale.setScalar(state.scale)
    material.color.setRGB(state.color[0], state.color[1], state.color[2], THREE.SRGBColorSpace)
    uniforms.uStrength.value = state.strength
    camera.position.set(state.camera[0] + tilt.x, state.camera[1] + tilt.y, state.camera[2])
    lookAt.set(state.lookAt[0], state.lookAt[1], state.lookAt[2])
    camera.lookAt(lookAt)
  }

  return {
    update(chapter, progress, t, pointer) {
      const dt = Math.min(Math.max(t - lastT, 0), MAX_FRAME_SECONDS)
      lastT = t
      current = dampState(current, target(chapter, progress), DAMPING)
      // Accumulate phase so a speed change does not make the wobble jump.
      phase += dt * current.speed
      uniforms.uTime.value = phase
      if (tier === 'full') {
        tilt.x = damp(tilt.x, pointer.x * 0.3, DAMPING)
        tilt.y = damp(tilt.y, pointer.y * 0.2, DAMPING)
      }
      if (particles) particles.rotation.y = t * 0.02
      apply(current)
      renderer.render(scene, camera)
    },

    resize(width, height) {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      narrow = width < LITE_MAX_WIDTH
      material.opacity = narrow ? NARROW_OPACITY : 1
    },

    setTheme(isDark) {
      ambient.intensity = isDark ? 0.35 : 0.8
      if (particles) {
        particles.material.color.set(isDark ? 0xffffff : 0x6366f1)
        particles.material.opacity = isDark ? 0.6 : 0.35
      }
    },

    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const m of materials) m.dispose()
        }
      })
      renderer.dispose()
      // dispose() frees GPU resources but keeps the context alive. Browsers cap live
      // contexts (about 16 in Chrome), so release it for home <-> projects navigation.
      renderer.forceContextLoss()
    },
  }
}
