import * as THREE from 'three'
import { BASE_FOV, fovForAspect } from './camera'
import { createContactShadowField, writeLayerShadows } from './contact-shadows'
import { facadeLookFor } from './facade-gradient'
import { applyBuildingState, type BuildingLayer, createBuildingLayer, LAYERS, layerMeshes } from './buildings'
import { createFacadeUniforms } from './facade-material'
import { CORNER_BLOCKS } from './footprints'
import { damp, dampState, lerpLook } from './interpolate'
import { createLamps, LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER, STREET_NAMES } from './lamps'
import { BUILDING_CLEARANCE, headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, type PathSegment, pathPointAt, PLACES, ROAD_HALF_WIDTH } from './path'
import type { StopState } from './stops'
import { createPostPipeline, POST_EMISSIVES, skyForDirectPipeline, TONE_MAPPING, type PostPipeline } from './post'
import { seeded } from './random'
import { reflectInPuddles } from './reflect-layer'
import { createRoad } from './road'
import { CAMERA_FAR, createSky, lightFromStop } from './sky'
import { createFarSkyline, createGround } from './skyline-far'
import { createShaderErrorRecorder } from './shader-utils'
import { targetFor } from './target'
import { createThemeController } from './theme-blend'
import type { Tier } from './tier'
import { carCountFor, createCars, createTraffic } from './traffic'
import { windowLookFor } from './window-look'
import { createWetRoad, WET_WARMUP, type WetRoad, type WetRoadOptions } from './wet-road'

export interface Pointer {
  x: number
  y: number
}

export interface JourneyScene {
  update(chapter: number, progress: number, t: number, pointer: Pointer): void
  resize(width: number, height: number): void
  setTheme(isDark: boolean, options?: { animate?: boolean }): void
  dispose(): void
}

export interface JourneySceneOptions {
  lowPower?: boolean
  // Test seam: lets a GPU test make the reflection target fail its framebuffer check.
  wetRoad?: WetRoadOptions
  onRenderer?: (renderer: THREE.WebGLRenderer) => void
  onSceneReady?: (ready: { scene: THREE.Scene; camera: THREE.PerspectiveCamera }) => void
  onStateApplied?: (state: Readonly<StopState>) => void
}

const DAMPING = 0.08
const STAR_COUNT = 800
export const STARS_NAME = 'journey-stars'
// After the dome (-1000) and before the haze (-900). The dome writes no depth,
// so stars inside it stay visible. Stars sit within about 110 units of any
// camera, inside the dome radius of 200.
const STARS_RENDER_ORDER = -999

const [seg1Maybe, seg2Maybe, seg3Maybe] = PATH_SEGMENTS
if (!seg1Maybe || !seg2Maybe || !seg3Maybe) throw new Error('expected 3 path segments')
const seg1: PathSegment = seg1Maybe
const seg2: PathSegment = seg2Maybe
const seg3: PathSegment = seg3Maybe

function createStars(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const positions = new Float32Array(STAR_COUNT * 3)
  for (let i = 0; i < positions.length; i += 3) {
    const distance = Math.random() * (PATH_TOTAL_LENGTH + 20) - 10
    const point = pathPointAt(Math.max(distance, 0))
    positions[i] = point.x + (Math.random() - 0.5) * 60
    positions[i + 1] = Math.random() * 17 + 8
    positions[i + 2] = point.z + (Math.random() - 0.5) * 30
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ size: 0.025, color: 0xffffff, transparent: true, opacity: 0, fog: false })
  const stars = new THREE.Points(geometry, material)
  stars.name = STARS_NAME
  stars.renderOrder = STARS_RENDER_ORDER
  return stars
}

function createCornerBlocks(): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: 0x242840, roughness: 0.9 })
  for (const block of CORNER_BLOCKS) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.width, block.height, block.depth), material)
    mesh.position.set(block.x, block.height / 2 - 1, block.z)
    group.add(mesh)
  }
  return group
}

const STONE = 0x4b4b58
const STONE_LIT = 0x6b6b7a

// Entrance: two pillars and a header beam framing the road where the journey begins.
// Authored facing world -Z; the caller rotates the group to match its segment.
function createGate(): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.8 })
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.4, 0.6), material)
    pillar.position.set(side * (ROAD_HALF_WIDTH + 0.4), 0.7, 0)
    group.add(pillar)
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry((ROAD_HALF_WIDTH + 0.4) * 2 + 0.6, 0.5, 0.6), material)
  header.position.set(0, 2.15, 0)
  group.add(header)
  return group
}

const HALL_LENGTH = 16
const HALL_WALL_X = ROAD_HALF_WIDTH + 1.1
const HALL_PILLAR_SPACING = 3.5

export interface FrameSlot {
  side: -1 | 1
  z: number
}

// z (in the hall's own local frame, center = 0) of each pillar along one wall.
export function hallPillarZs(): number[] {
  const pillarCount = Math.floor(HALL_LENGTH / HALL_PILLAR_SPACING)
  const zs: number[] = []
  for (let i = 0; i <= pillarCount; i++) zs.push(HALL_LENGTH / 2 - i * HALL_PILLAR_SPACING)
  return zs
}

// One slot per bay between pillars, left wall first (the projects HTML panel
// covers the right wall's screen position at the projects camera stop — see
// `stops.ts`). At most 8 projects fit (4 bays per wall at HALL_LENGTH 16);
// beyond that, extra projects are simply not given a frame.
export function hallFrameSlots(projectCount: number): FrameSlot[] {
  const bayCount = Math.floor(HALL_LENGTH / HALL_PILLAR_SPACING)
  const slots: FrameSlot[] = []
  for (const side of [-1, 1] as const) {
    for (let k = 0; k < bayCount; k++) {
      slots.push({ side, z: HALL_LENGTH / 2 - (k + 0.5) * HALL_PILLAR_SPACING })
    }
  }
  return slots.slice(0, Math.min(projectCount, slots.length))
}

export interface ExhibitItem {
  title: string
  date?: string
}

const PICTURE_WIDTH = 2.6
const PICTURE_HEIGHT = 2
const PICTURE_CENTER_Y = 0.3

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Formats a `YYYY-MM` (or `YYYY`) date string as "Jun 2020". Falls back to
// the raw string for any other shape rather than hiding it.
function formatProjectDate(date: string): string {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(date)
  if (!match) return date
  const [, year, month] = match
  if (!month) return year ?? date
  const label = MONTHS[Number(month) - 1]
  return label ? `${label} ${year}` : date
}

// Renders a project's title (and date, if present) onto a canvas, used as
// the picture's texture. There are no cover images in the content, so this
// text is the real per-project content; swap in an image texture if `cover`
// images get added later.
function createPictureTexture(title: string, date: string | undefined, color: THREE.Color): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 384
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = `#${color.getHexString()}`
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Uniform scrim (rather than a bottom-only gradient) since the title now
    // sits in the middle of the picture, not anchored to the bottom edge.
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const centerX = canvas.width / 2
    const paddingX = 36
    const maxWidth = canvas.width - paddingX * 2
    ctx.textAlign = 'center'

    ctx.font = '600 38px system-ui, sans-serif'
    const words = title.split(' ')
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)

    const lineHeight = 46
    const shown = lines.slice(0, 3)
    const dateGap = date ? 40 : 0
    const blockHeight = shown.length * lineHeight + dateGap
    const titleTopY = canvas.height / 2 - blockHeight / 2 + lineHeight * 0.75

    ctx.fillStyle = '#ffffff'
    shown.forEach((l, i) => ctx.fillText(l, centerX, titleTopY + i * lineHeight))

    if (date) {
      ctx.font = '500 20px system-ui, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.fillText(formatProjectDate(date), centerX, titleTopY + shown.length * lineHeight + 4)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Exhibition hall: a run of colonnade pillars flanking the road, with a low
// architrave connecting each row's tops, solid walls behind the pillars, and
// one picture per project mounted in the bays between pillars (see
// `hallFrameSlots`), stretched to fill the bay's wall segment and showing the
// project's title. Full project detail still scrolls over this in HTML.
// Authored facing world -Z; the caller rotates the group to match its segment.
function createColonnade(projectItems: readonly ExhibitItem[]): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: STONE_LIT, roughness: 0.6, metalness: 0.1 })
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x3f3f52, roughness: 0.8 })
  const pillarZs = hallPillarZs()
  for (const side of [-1, 1]) {
    for (const z of pillarZs) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3, 8), material)
      pillar.position.set(side * (ROAD_HALF_WIDTH + 0.6), 0.5, z)
      group.add(pillar)
    }
    const architrave = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, HALL_LENGTH), material)
    architrave.position.set(side * (ROAD_HALF_WIDTH + 0.6), 2.1, 0)
    group.add(architrave)

    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, HALL_LENGTH), wallMaterial)
    wall.position.set(side * HALL_WALL_X, 0.2, 0)
    group.add(wall)
  }

  const borderMaterial = new THREE.MeshStandardMaterial({ color: 0x242430, roughness: 0.7 })
  const slots = hallFrameSlots(projectItems.length)
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const item = projectItems[i]
    if (!slot || !item) continue
    const { side, z } = slot
    const wallX = side * HALL_WALL_X
    const color = new THREE.Color().setHSL(i / Math.max(slots.length, 1), 0.55, 0.4)
    const texture = createPictureTexture(item.title, item.date, color)
    const pictureMaterial = new THREE.MeshBasicMaterial({ map: texture })

    const border = new THREE.Mesh(new THREE.BoxGeometry(0.06, PICTURE_HEIGHT + 0.12, PICTURE_WIDTH + 0.12), borderMaterial)
    border.position.set(wallX - side * 0.1, PICTURE_CENTER_Y, z)
    group.add(border)

    const picture = new THREE.Mesh(new THREE.PlaneGeometry(PICTURE_WIDTH, PICTURE_HEIGHT), pictureMaterial)
    picture.rotation.y = -side * (Math.PI / 2)
    picture.position.set(wallX - side * 0.14, PICTURE_CENTER_Y, z)
    group.add(picture)
  }

  return group
}

// Market square: a scatter of stalls (box base + pyramid roof) and lamp posts
// off both sides of the road. Authored facing world -Z; the caller rotates
// the group to match its segment.
function createMarket(): THREE.Group {
  const group = new THREE.Group()
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 })
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8a3324, roughness: 0.8 })
  const stallCount = 6
  for (let i = 0; i < stallCount; i++) {
    const seed = 7000 + i
    const side = i % 2 === 0 ? -1 : 1
    const x = side * (BUILDING_CLEARANCE + 0.5 + seeded(seed) * 3)
    const z = (seeded(seed + 1) - 0.5) * 12
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), baseMaterial)
    base.position.set(x, -0.5, z)
    group.add(base)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 0.7, 4), roofMaterial)
    roof.rotation.y = Math.PI / 4
    roof.position.set(x, 0.35, z)
    group.add(roof)
  }
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2f, roughness: 0.7 })
  const lampGlow = new THREE.MeshBasicMaterial({ color: POST_EMISSIVES.lamp.hex })
  lampGlow.name = 'journey-lamp-glow'
  lampGlow.color.multiplyScalar(POST_EMISSIVES.lamp.gain)
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), lampMaterial)
    post.position.set(side * (ROAD_HALF_WIDTH + 0.3), 0.1, 0)
    group.add(post)
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), lampGlow)
    glow.position.set(side * (ROAD_HALF_WIDTH + 0.3), 1.25, 0)
    group.add(glow)
  }
  return group
}

// Home courtyard: low perimeter walls open toward the road, with a small house
// and a couple of always-lit windows. The journey's ending point. Authored
// facing world -Z; the caller rotates the group to match its segment.
function createCourtyard(): THREE.Group {
  const group = new THREE.Group()
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.85 })
  const depth = 8
  const width = 7
  const backZ = -depth / 2
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, depth), wallMaterial)
  leftWall.position.set(-width / 2, -0.4, 0)
  group.add(leftWall)
  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, depth), wallMaterial)
  rightWall.position.set(width / 2, -0.4, 0)
  group.add(rightWall)
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(width, 1.2, 0.3), wallMaterial)
  backWall.position.set(0, -0.4, backZ)
  group.add(backWall)

  const houseMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 })
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2f24, roughness: 0.8 })
  const house = new THREE.Mesh(new THREE.BoxGeometry(3, 1.8, 3), houseMaterial)
  house.position.set(0, -0.1, backZ + 1.8)
  group.add(house)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.3, 4), roofMaterial)
  roof.rotation.y = Math.PI / 4
  roof.position.set(0, 1.4, backZ + 1.8)
  group.add(roof)

  const windowMaterial = new THREE.MeshBasicMaterial({ color: POST_EMISSIVES.courtyard.hex })
  windowMaterial.name = 'journey-courtyard-window'
  windowMaterial.color.multiplyScalar(POST_EMISSIVES.courtyard.gain)
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), windowMaterial)
    win.position.set(side * 0.9, 0, backZ + 1.8 + 1.51)
    group.add(win)
  }
  return group
}

// Places a set-piece group, authored facing world -Z, at `point` and rotates
// it to face `dirX, dirZ` (the heading of the segment it belongs to).
function placeOnPath(group: THREE.Group, point: { x: number, z: number }, dirX: number, dirZ: number): THREE.Group {
  group.position.set(point.x, 0, point.z)
  group.rotation.y = headingFor(dirX, dirZ)
  return group
}

export function createJourneyScene(canvas: HTMLCanvasElement, tier: Exclude<Tier, 'none'>, projectItems: readonly ExhibitItem[], options: JourneySceneOptions = {}): JourneyScene {
  const lowPower = options.lowPower ?? (tier === 'lite')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower })
  const recorder = createShaderErrorRecorder(renderer)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, CAMERA_FAR)
  const facade = createFacadeUniforms(tier === 'reduced' ? 0 : 1)

  let post: PostPipeline | null = null
  let wetRoad: WetRoad | null = null
  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    post?.dispose()
    if (wetRoad) {
      wetRoad.dispose()
      scene.remove(wetRoad.overlay) // its geometry and material are owned by wetRoad, not the scene sweep below
    }
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    const textures = new Set<THREE.Texture>()
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material)
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      }
    })
    for (const texture of textures) texture.dispose()
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    recorder.dispose()
    renderer.dispose()
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss()
  }

  try {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2))
  renderer.toneMapping = TONE_MAPPING
  renderer.outputColorSpace = THREE.SRGBColorSpace
  options.onRenderer?.(renderer)

  // The scene renders its own sky (day-to-night arc), so the canvas is opaque here
  // rather than showing the page background through. Text sits on translucent panels.
  // The dome covers the background. The background stays at the horizon colour
  // as a fallback in case the dome does not draw.
  const horizonFallback = new THREE.Color(0xbfdbfe)
  scene.background = horizonFallback
  const fog = new THREE.FogExp2(0xbfdbfe, 0.02)
  scene.fog = fog

  const layers: BuildingLayer[] = []
  for (const [i] of LAYERS.entries()) {
    const layer = createBuildingLayer(i, { lowPower, facade })
    layers.push(layer)
    scene.add(...layerMeshes(layer))
    reflectInPuddles(...layerMeshes(layer))
  }
  const shadowOffsets: number[] = []
  let shadowTotal = 0
  for (const layer of layers) {
    shadowOffsets.push(shadowTotal)
    shadowTotal += layer.buildings.length
  }
  const shadows = createContactShadowField(shadowTotal)
  scene.add(shadows.mesh)

  scene.add(createGround())
  const road = createRoad(renderer.capabilities.getMaxAnisotropy())
  scene.add(road.group)
  const cornerBlocks = createCornerBlocks()
  scene.add(cornerBlocks)
  reflectInPuddles(cornerBlocks)

  scene.add(placeOnPath(createGate(), PLACES.entrance, seg1.dirX, seg1.dirZ))
  scene.add(placeOnPath(createColonnade(projectItems), PLACES.hall, seg1.dirX, seg1.dirZ))
  scene.add(placeOnPath(createMarket(), PLACES.market, seg2.dirX, seg2.dirZ))
  scene.add(placeOnPath(createCourtyard(), PLACES.courtyard, seg3.dirX, seg3.dirZ))

  // Street life: lamps follow `lowPower` for count, cars follow reduced motion (none) and `lowPower`.
  const lamps = createLamps(lowPower ? LAMP_SPACING_LOW_POWER : LAMP_SPACING_FULL)
  const traffic = createTraffic(createCars(carCountFor(tier === 'reduced', lowPower)))
  scene.add(...lamps.objects, ...traffic.objects)
  // Pools and halos already light the road; reflecting them would double that light.
  reflectInPuddles(
    ...lamps.objects.filter(object => object.name === STREET_NAMES.posts || object.name === STREET_NAMES.heads),
    ...traffic.objects.filter(object => object.name === STREET_NAMES.carBodies || object.name === STREET_NAMES.carLights),
  )

  const stars = !lowPower ? createStars() : null
  if (stars) { scene.add(stars); reflectInPuddles(stars) }
  const sky = createSky(lowPower ? 'lite' : 'full', tier === 'reduced')
  const farSkyline = createFarSkyline(lowPower)
  scene.add(sky.mesh, ...farSkyline.objects)
  reflectInPuddles(sky.mesh)

  const hemi = new THREE.HemisphereLight(0xbfdbfe, 0x1a1a1f, 0.9)
  const sun = new THREE.DirectionalLight(0xffffff, 0.8)
  sun.position.set(-4, 6, 4)
  hemi.name = 'journey-hemi'
  sun.name = 'journey-sun'
  scene.add(hemi, sun)
  reflectInPuddles(hemi, sun)

  const hemiMid = new THREE.Color()
  const themes = createThemeController(tier === 'reduced')
  let lastChapter = 0
  let lastProgress = 0
  let lastTime = 0
  let current: StopState = target(0, 0)
  const tilt = { x: 0, y: 0 }
  const lookAt = new THREE.Vector3()

  function target(chapter: number, progress: number): StopState {
    return targetFor(chapter, progress, themes.mix, tier === 'reduced')
  }

  function applyWindowLook(state: StopState, t: number) {
    const look = windowLookFor(state, t, tier)
    facade.uTime.value = look.uTime
    facade.uFlicker.value = look.uFlicker
    facade.uEmissiveScale.value = look.uEmissiveScale
  }
  applyWindowLook(current, 0)

  function apply(state: StopState) {
    // The composer tone-maps the whole frame, so fog stays authored. The direct
    // path tone-maps only object pixels, so map fog and the fallback background
    // on the CPU. The dome and far skyline tone-map themselves, so they always
    // take the authored colours.
    if (post) post.setLook(state.exposure, state.bloomStrength)
    else renderer.toneMappingExposure = state.exposure
    const fogRgb = post ? state.fogColor : skyForDirectPipeline(state.fogColor, state.exposure)
    horizonFallback.setRGB(fogRgb[0], fogRgb[1], fogRgb[2], THREE.SRGBColorSpace)
    fog.color.setRGB(fogRgb[0], fogRgb[1], fogRgb[2], THREE.SRGBColorSpace)
    fog.density = state.fogDensity
    hemi.color.setRGB(...state.skyZenith, THREE.SRGBColorSpace)
      .lerp(hemiMid.setRGB(...state.skyColor, THREE.SRGBColorSpace), 0.5)
    hemi.intensity = state.hemiIntensity
    const light = lightFromStop(state)
    sun.color.setRGB(...state.sunColor, THREE.SRGBColorSpace)
    sun.intensity = light.intensity
    sun.position.set(...light.position)
    facade.uLit.value = state.windowLitRatio
    lamps.update(state.windowLitRatio)
    traffic.update(state.windowLitRatio, lastTime)
    road.update(state.wetness, state.skyColor)
    wetRoad?.setLook(state.wetness, state.fogDensity)
    facade.uSkyTint.value.setRGB(...state.skyColor, THREE.SRGBColorSpace)
    layers.forEach((layer, i) => {
      if (applyBuildingState(layer, state.buildingHeight, state.buildingDensity, lastTime, tier === 'reduced')) {
        writeLayerShadows(shadows, shadowOffsets[i] ?? 0, layer)
      }
    })
    shadows.commit()
    if (stars) stars.material.opacity = state.starOpacity
    farSkyline.update(state.fogColor)

    // Camera position/lookAt are driven by distance along the bent path, not
    // raw x/z, so interpolating between two stops follows the turns instead
    // of cutting a diagonal shortcut across them.
    const camPoint = pathPointAt(state.cameraDistance)
    const lookPoint = pathPointAt(state.cameraDistance + state.lookAheadDistance)
    camera.position.set(
      camPoint.x + camPoint.rightX * tilt.x,
      state.cameraHeight + tilt.y,
      camPoint.z + camPoint.rightZ * tilt.x,
    )
    lookAt.set(lookPoint.x, state.lookHeight, lookPoint.z)
    camera.lookAt(lookAt)
    sky.update(state, camera.position, lastTime)
    const gradient = facadeLookFor(state, sky.sunVisibility)
    facade.uAoStrength.value = gradient.uAoStrength
    facade.uRimStrength.value = gradient.uRimStrength
    facade.uBounce.value = gradient.uBounce
    facade.uSunDir.value.copy(sky.sunDirection)
    facade.uSunColor.value.copy(sun.color)
    facade.uSunVisibility.value = sky.sunVisibility
    options.onStateApplied?.(state)
  }

  function resize(width: number, height: number) {
    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    renderer.setSize(safeWidth, safeHeight, false)
    post?.setSize(safeWidth, safeHeight, renderer.getPixelRatio())
    if (wetRoad) {
      const drawing = renderer.getDrawingBufferSize(new THREE.Vector2())
      wetRoad.setSize(drawing.x, drawing.y)
    }
    camera.aspect = safeWidth / safeHeight
    camera.fov = fovForAspect(camera.aspect)
    camera.updateProjectionMatrix()
  }

  function renderFrame() {
    wetRoad?.render(scene, camera)
    if (post) post.render()
    else renderer.render(scene, camera)
    recorder.assertClean()
  }

  apply(current)
  resize(canvas.clientWidth || canvas.width || window.innerWidth,
    canvas.clientHeight || canvas.height || window.innerHeight)
  post = lowPower ? null : createPostPipeline(renderer, scene, camera)
  // The direct pipeline maps fog and background on the CPU; a linear HDR reflection needs the composer.
  wetRoad = post ? createWetRoad(renderer, options.wetRoad) : null
  if (wetRoad) scene.add(wetRoad.overlay)
  apply(current)
  if (post) {
    // Force bloom and reflection on so every optional program compiles now, then
    // restore the real look; a later night chapter must not compile mid-scroll.
    post.setLook(current.exposure, 0.5)
    wetRoad?.setLook(WET_WARMUP, current.fogDensity)
    wetRoad?.render(scene, camera)
    post.render()
    recorder.assertClean()
    apply(current)
  }
  renderFrame()
  const gl = renderer.getContext()
  const startupError = gl.getError()
  if (startupError !== gl.NO_ERROR) throw new Error(`[journey] WebGL warmup error: ${startupError}`)
  options.onSceneReady?.({ scene, camera })

  return {
    update(chapter, progress, t, pointer) {
      lastChapter = chapter
      lastProgress = progress
      lastTime = t
      themes.advance(t)
      current = tier === 'reduced'
        ? target(chapter, progress)
        : dampState(current, target(chapter, progress), DAMPING)
      if (tier === 'full') {
        tilt.x = damp(tilt.x, pointer.x * 0.3, DAMPING)
        tilt.y = damp(tilt.y, pointer.y * 0.2, DAMPING)
      }
      applyWindowLook(current, t)
      apply(current)
      renderFrame()
    },

    resize,

    setTheme(isDark, themeOptions) {
      const result = themes.setTheme(isDark, themeOptions)
      if (!result.changed || !result.snapped) return
      const selected = target(lastChapter, lastProgress)
      current = { ...current, ...lerpLook(selected, selected, 0) }
      applyWindowLook(current, lastTime)
      apply(current)
      if (!renderer.getContext().isContextLost()) renderFrame()
    },

    dispose,
  }
  } catch (error) {
    dispose()
    throw error
  }
}
