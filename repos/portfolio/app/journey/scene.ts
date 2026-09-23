import * as THREE from 'three'
import { damp, dampState, easeInOut, lerpStop } from './interpolate'
import { clearsPath, headingFor, PATH_SEGMENTS, PATH_TOTAL_LENGTH, type PathSegment, pathPointAt, PLACES, WAYPOINTS } from './path'
import { STOPS, type Stop, type StopState } from './stops'
import type { Tier } from './tier'

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
const STAR_COUNT = 800
const ROAD_HALF_WIDTH = 3
const ROAD_CLEARANCE = ROAD_HALF_WIDTH + 0.3
const BUILDING_CLEARANCE = 3.3

// Axis-aligned-in-its-own-frame footprint for a set-piece: keeps generic
// background buildings (and corner-blocking props) from landing inside it.
// `heading` must match the rotation the piece was placed with.
interface Footprint {
  x: number
  z: number
  heading: number
  halfX: number
  halfZ: number
}

const [seg1Maybe, seg2Maybe, seg3Maybe] = PATH_SEGMENTS
if (!seg1Maybe || !seg2Maybe || !seg3Maybe) throw new Error('expected 3 path segments')
const seg1: PathSegment = seg1Maybe
const seg2: PathSegment = seg2Maybe
const seg3: PathSegment = seg3Maybe

const FOOTPRINTS: readonly Footprint[] = [
  { x: PLACES.entrance.x, z: PLACES.entrance.z, heading: headingFor(seg1.dirX, seg1.dirZ), halfX: 4, halfZ: 1.2 },
  // halfZ covers HALL_MAX_LENGTH / 2 + margin, not just the base length, so
  // background scenery stays clear even when the hall grows for more projects.
  { x: PLACES.hall.x, z: PLACES.hall.z, heading: headingFor(seg1.dirX, seg1.dirZ), halfX: 4.5, halfZ: 10.5 },
  { x: PLACES.market.x, z: PLACES.market.z, heading: headingFor(seg2.dirX, seg2.dirZ), halfX: 7.5, halfZ: 6.5 },
  { x: PLACES.courtyard.x, z: PLACES.courtyard.z, heading: headingFor(seg3.dirX, seg3.dirZ), halfX: 4.5, halfZ: 5 },
]

function clearsFootprints(x: number, z: number): boolean {
  for (const fp of FOOTPRINTS) {
    const dx = x - fp.x
    const dz = z - fp.z
    const cos = Math.cos(fp.heading)
    const sin = Math.sin(fp.heading)
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    if (Math.abs(lx) <= fp.halfX && Math.abs(lz) <= fp.halfZ) return false
  }
  return true
}

// Two tall solid blocks, one tucked into each turn's inside corner, so the
// wide-open sightline from the entrance can't see straight through both
// turns to the market and courtyard. Always present, not tied to density.
const CORNER_BLOCKS = [
  { x: -4.2, z: -22, width: 3, depth: 3, height: 5 },
  { x: -22, z: -30, width: 3, depth: 3, height: 5 },
] as const

// Generic background skyline, spread across the whole path as fill between the
// set-pieces rather than clustered at one depth. Each band has its own base
// clearance from the path so near/mid/far read as layered, not piled at the curb.
// `buildingDensity` scales how many of each band's baked instances are visible.
const LAYERS = [
  { count: 24, sideSpread: 9, baseHeight: 1.4, color: 0x1f2438 },
  { count: 32, sideSpread: 13, baseHeight: 2.2, color: 0x2a2f4a },
  { count: 40, sideSpread: 18, baseHeight: 3.2, color: 0x353b5c },
] as const

function stopAt(index: number): Stop {
  const last = STOPS.length - 1
  const stop = STOPS[Math.min(Math.max(index, 0), last)]
  if (!stop) throw new Error('STOPS is empty')
  return stop
}

// Deterministic pseudo-random in [0, 1), seeded by index so layout is stable across renders.
function seeded(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

interface Building {
  x: number
  z: number
  width: number
  baseHeight: number
}

interface BuildingLayer {
  mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  buildings: Building[]
}

const PLACEMENT_ATTEMPTS = 6

// Picks a point off to one side of the path, at least clear of every road
// segment and every set-piece's footprint. Tries a handful of seeded
// candidates and gives up (returns null, hidden off-scene) if none clear.
function placeBuilding(seedBase: number, sideSpread: number): Building | null {
  const width = 0.5 + seeded(seedBase + 100) * 0.6
  const minClear = ROAD_CLEARANCE + width / 2
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const s = seedBase + attempt * 977
    const distance = seeded(s + 400) * PATH_TOTAL_LENGTH
    const point = pathPointAt(distance)
    const half = Math.max(sideSpread / 2, minClear + 1)
    const side = seeded(s) < 0.5 ? -1 : 1
    const offset = side * (minClear + seeded(s + 1000) * (half - minClear))
    const x = point.x + point.rightX * offset
    const z = point.z + point.rightZ * offset
    if (clearsPath(x, z, minClear) && clearsFootprints(x, z)) {
      return { x, z, width, baseHeight: 0 }
    }
  }
  return null
}

function createBuildingLayer(config: (typeof LAYERS)[number], layerIndex: number, lite: boolean): BuildingLayer {
  const count = lite ? Math.round(config.count * 0.6) : config.count
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.9, metalness: 0.05 })
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  const buildings: Building[] = []
  const seedBase = layerIndex * 1000
  for (let i = 0; i < count; i++) {
    const building = placeBuilding(seedBase + i, config.sideSpread)
    buildings.push(
      building
        ? { ...building, baseHeight: config.baseHeight * (0.5 + seeded(seedBase + i + 200)) }
        : { x: 0, z: 0, width: 0, baseHeight: 0 },
    )
  }
  return { mesh, buildings }
}

// Scales each instance's height by `heightScale` and hides instances beyond
// `density * count`, so a rising density reads as the skyline filling in
// rather than buildings fading to transparent. A building with `width === 0`
// (no clear spot found for it) always stays hidden.
function applyBuildingState(layer: BuildingLayer, heightScale: number, density: number) {
  const matrix = new THREE.Matrix4()
  const activeCount = Math.round(density * layer.buildings.length)
  for (let i = 0; i < layer.buildings.length; i++) {
    const building = layer.buildings[i]
    if (!building) continue
    if (i >= activeCount || building.width === 0) {
      matrix.compose(new THREE.Vector3(building.x, -100, building.z), new THREE.Quaternion(), new THREE.Vector3(0, 0, 0))
      layer.mesh.setMatrixAt(i, matrix)
      continue
    }
    const height = building.baseHeight * heightScale
    matrix.compose(
      new THREE.Vector3(building.x, height / 2 - 1, building.z),
      new THREE.Quaternion(),
      new THREE.Vector3(building.width, height, building.width),
    )
    layer.mesh.setMatrixAt(i, matrix)
  }
  layer.mesh.instanceMatrix.needsUpdate = true
}

interface WindowLight {
  buildingIndex: number
  xOffset: number
  heightFraction: number
}

// Window lights: small emissive planes scattered up the near layer's building faces.
// Positions are recomputed every frame from the building's current height so they
// stay pinned to the facade as `buildingHeight` animates.
function createWindows(nearLayer: BuildingLayer, lite: boolean): { mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, windows: WindowLight[] } {
  const perBuilding = lite ? 3 : 6
  const windows: WindowLight[] = []
  for (let b = 0; b < nearLayer.buildings.length; b++) {
    for (let i = 0; i < perBuilding; i++) {
      const seed = b * perBuilding + i
      windows.push({
        buildingIndex: b,
        xOffset: (seeded(seed) - 0.5) * 0.7,
        heightFraction: seeded(seed + 500),
      })
    }
  }
  const geometry = new THREE.PlaneGeometry(0.12, 0.16)
  const material = new THREE.MeshBasicMaterial({ color: 0xffe1a8, transparent: true, opacity: 0 })
  const mesh = new THREE.InstancedMesh(geometry, material, windows.length)
  return { mesh, windows }
}

function applyWindowState(nearLayer: BuildingLayer, windows: WindowLight[], mesh: THREE.InstancedMesh, heightScale: number, density: number) {
  const matrix = new THREE.Matrix4()
  const activeCount = Math.round(density * nearLayer.buildings.length)
  for (let w = 0; w < windows.length; w++) {
    const win = windows[w]
    if (!win) continue
    const building = nearLayer.buildings[win.buildingIndex]
    if (!building || win.buildingIndex >= activeCount || building.width === 0) {
      matrix.compose(new THREE.Vector3(0, -100, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, 0))
      mesh.setMatrixAt(w, matrix)
      continue
    }
    const height = building.baseHeight * heightScale
    const wx = building.x + win.xOffset * building.width
    const wy = height / 2 - 1 - height / 2 + win.heightFraction * height
    const wz = building.z + building.width / 2 + 0.01
    matrix.compose(new THREE.Vector3(wx, wy, wz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1))
    mesh.setMatrixAt(w, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

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
  return new THREE.Points(geometry, material)
}

function createGround(): THREE.Mesh {
  // One large plane under the whole bent path, rather than following each
  // segment, since the path's bounding box is simple and this avoids gaps at
  // the turns.
  const minX = Math.min(...WAYPOINTS.map(w => w.x)) - 40
  const maxX = Math.max(...WAYPOINTS.map(w => w.x)) + 40
  const minZ = Math.min(...WAYPOINTS.map(w => w.z)) - 10
  const maxZ = Math.max(...WAYPOINTS.map(w => w.z)) + 10
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(maxX - minX, maxZ - minZ),
    new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((minX + maxX) / 2, -1.01, (minZ + maxZ) / 2)
  return ground
}

// Lays a plane flat (facing up) and turns it to face (dirX, dirZ) along its
// local-Y (length) axis. Order matters: flatten first, then turn around the
// world-vertical axis, so a plain rotation.z hack (which tilts instead of
// turning) doesn't work here.
function flattenAndHeadPlane(mesh: THREE.Mesh, dirX: number, dirZ: number) {
  const flatten = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
  const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingFor(dirX, dirZ))
  mesh.quaternion.copy(flatten).premultiply(heading)
}

// One road quad per path segment, oriented and sized to that segment, plus a
// square patch at each interior waypoint so the turns don't leave a gap.
function createRoad(): THREE.Group {
  const group = new THREE.Group()
  const surfaceMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 1 })
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf5e6a8, transparent: true, opacity: 0.5 })

  for (const segment of PATH_SEGMENTS) {
    const midX = segment.fromX + segment.dirX * (segment.length / 2)
    const midZ = segment.fromZ + segment.dirZ * (segment.length / 2)

    const surface = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, segment.length), surfaceMaterial)
    flattenAndHeadPlane(surface, segment.dirX, segment.dirZ)
    surface.position.set(midX, -1, midZ)
    group.add(surface)

    const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.08, segment.length), lineMaterial)
    flattenAndHeadPlane(centerLine, segment.dirX, segment.dirZ)
    centerLine.position.set(midX, -0.99, midZ)
    group.add(centerLine)
  }

  for (let i = 1; i < WAYPOINTS.length - 1; i++) {
    const point = WAYPOINTS[i]
    if (!point) continue
    const joint = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, ROAD_HALF_WIDTH * 2),
      surfaceMaterial,
    )
    joint.rotation.x = -Math.PI / 2
    joint.position.set(point.x, -1, point.z)
    group.add(joint)
  }

  return group
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
  const lampGlow = new THREE.MeshBasicMaterial({ color: 0xffdca8 })
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

  const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffe1a8 })
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

export function createJourneyScene(canvas: HTMLCanvasElement, tier: Exclude<Tier, 'none'>, projectItems: readonly ExhibitItem[]): JourneyScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'lite' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 'lite' ? 1.5 : 2))

  const lite = tier === 'lite'
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120)

  // The scene renders its own sky (day-to-night arc), so the canvas is opaque here
  // rather than showing the page background through. Text sits on translucent panels.
  const sky = new THREE.Color(0xbfdbfe)
  scene.background = sky
  const fog = new THREE.FogExp2(0xbfdbfe, 0.02)
  scene.fog = fog

  const layers = LAYERS.map((config, i) => createBuildingLayer(config, i, lite))
  for (const layer of layers) scene.add(layer.mesh)
  const [nearLayer] = layers
  if (!nearLayer) throw new Error('LAYERS is empty')
  const near: BuildingLayer = nearLayer
  const { mesh: windowsMesh, windows } = createWindows(near, lite)
  scene.add(windowsMesh)

  scene.add(createGround())
  scene.add(createRoad())
  scene.add(createCornerBlocks())

  scene.add(placeOnPath(createGate(), PLACES.entrance, seg1.dirX, seg1.dirZ))
  scene.add(placeOnPath(createColonnade(projectItems), PLACES.hall, seg1.dirX, seg1.dirZ))
  scene.add(placeOnPath(createMarket(), PLACES.market, seg2.dirX, seg2.dirZ))
  scene.add(placeOnPath(createCourtyard(), PLACES.courtyard, seg3.dirX, seg3.dirZ))

  const stars = tier === 'full' ? createStars() : null
  if (stars) scene.add(stars)

  const hemi = new THREE.HemisphereLight(0xbfdbfe, 0x1a1a1f, 0.9)
  const sun = new THREE.DirectionalLight(0xffffff, 0.8)
  sun.position.set(-4, 6, 4)
  scene.add(hemi, sun)

  let current: StopState = target(0, 0)
  const tilt = { x: 0, y: 0 }
  const lookAt = new THREE.Vector3()

  function target(chapter: number, progress: number): StopState {
    // No easing/blending between stops: each chapter snaps straight to its own
    // place, still showing all four without any camera travel or wobble.
    if (tier === 'reduced') return stopAt(chapter)
    return lerpStop(stopAt(chapter), stopAt(chapter + 1), easeInOut(progress))
  }

  function apply(state: StopState) {
    sky.setRGB(state.skyColor[0], state.skyColor[1], state.skyColor[2], THREE.SRGBColorSpace)
    fog.color.setRGB(state.fogColor[0], state.fogColor[1], state.fogColor[2], THREE.SRGBColorSpace)
    fog.density = state.fogDensity
    hemi.color.setRGB(state.skyColor[0], state.skyColor[1], state.skyColor[2], THREE.SRGBColorSpace)
    for (const layer of layers) applyBuildingState(layer, state.buildingHeight, state.buildingDensity)
    applyWindowState(near, windows, windowsMesh, state.buildingHeight, state.buildingDensity)
    windowsMesh.material.opacity = state.windowLitRatio
    if (stars) stars.material.opacity = state.windowLitRatio

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
  }

  return {
    update(chapter, progress, _t, pointer) {
      current = tier === 'reduced'
        ? target(chapter, progress)
        : dampState(current, target(chapter, progress), DAMPING)
      if (tier === 'full') {
        tilt.x = damp(tilt.x, pointer.x * 0.3, DAMPING)
        tilt.y = damp(tilt.y, pointer.y * 0.2, DAMPING)
      }
      apply(current)
      renderer.render(scene, camera)
    },

    resize(width, height) {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },

    setTheme(isDark) {
      sun.intensity = isDark ? 0.5 : 0.9
      hemi.intensity = isDark ? 0.6 : 0.9
    },

    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.InstancedMesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const m of materials) m.dispose()
        }
      })
      renderer.dispose()
      // dispose() frees GPU resources but keeps the context alive. Browsers cap live
      // contexts (about 16 in Chrome), so release it for home <-> projects navigation.
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss()
    },
  }
}
