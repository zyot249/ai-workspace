export type Vec3 = readonly [number, number, number]

export type ChapterId = 'intro' | 'projects' | 'skills' | 'about'

export interface StopState {
  // Camera position/target are expressed as distance along the journey's
  // path (see `journey/path.ts`) rather than raw x/z, so interpolating
  // between two stops follows the path's turns instead of a straight line.
  cameraDistance: number
  cameraHeight: number
  lookAheadDistance: number
  lookHeight: number
  skyColor: Vec3
  fogColor: Vec3
  fogDensity: number
  buildingDensity: number
  buildingHeight: number
  windowLitRatio: number
}

export interface Stop extends StopState {
  id: ChapterId
}

export const CHAPTER_IDS: readonly ChapterId[] = ['intro', 'projects', 'skills', 'about']

export function hexToRgb(hex: string): Vec3 {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// The journey passes four places, in order: entrance gate, exhibition hall,
// market square, home courtyard (see `PLACES`/`WAYPOINTS` in journey/path.ts).
// The path bends twice (hall -> market turns 90 degrees, market -> courtyard
// turns back). `cameraDistance` is how far along that path the camera sits
// for each stop; `lookAheadDistance` is how much further along it looks. A
// day-to-night arc runs alongside: intro is daylight, about is full night.
export const STOPS: readonly Stop[] = [
  {
    id: 'intro',
    cameraDistance: 0,
    cameraHeight: 0.2,
    lookAheadDistance: 8,
    lookHeight: 0,
    skyColor: hexToRgb('#bfdbfe'),
    fogColor: hexToRgb('#e0e7ff'),
    fogDensity: 0.045,
    buildingDensity: 0.35,
    buildingHeight: 0.6,
    windowLitRatio: 0.05,
  },
  {
    id: 'projects',
    // Pulled back to distance 8 (world z 0), so the first hall bays (world z
    // around -5.75 and -9.25 — see `hallFrameSlots` in scene.ts) are ahead of
    // the camera and inside the horizontal FOV, not behind or off to the side.
    cameraDistance: 8,
    cameraHeight: 0.6,
    lookAheadDistance: 8,
    lookHeight: 0.3,
    skyColor: hexToRgb('#fbbf9f'),
    fogColor: hexToRgb('#f3a683'),
    fogDensity: 0.05,
    buildingDensity: 0.6,
    buildingHeight: 0.85,
    windowLitRatio: 0.3,
  },
  {
    id: 'skills',
    cameraDistance: 40,
    cameraHeight: 0.8,
    lookAheadDistance: 9,
    lookHeight: 0.4,
    skyColor: hexToRgb('#7c6aa8'),
    fogColor: hexToRgb('#6b5b95'),
    fogDensity: 0.05,
    buildingDensity: 0.85,
    buildingHeight: 1.15,
    windowLitRatio: 0.65,
  },
  {
    id: 'about',
    cameraDistance: 72,
    cameraHeight: 0.3,
    lookAheadDistance: 9,
    lookHeight: 0.2,
    skyColor: hexToRgb('#1e2340'),
    fogColor: hexToRgb('#141833'),
    fogDensity: 0.065,
    buildingDensity: 1,
    buildingHeight: 1,
    windowLitRatio: 0.9,
  },
]
