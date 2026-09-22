export type Vec3 = readonly [number, number, number]

export type ChapterId = 'intro' | 'projects' | 'skills' | 'about'

export interface StopState {
  camera: Vec3
  lookAt: Vec3
  color: Vec3
  strength: number
  speed: number
  scale: number
  offsetWide: Vec3
  offsetNarrow: Vec3
}

export interface Stop extends StopState {
  id: ChapterId
}

export const CHAPTER_IDS: readonly ChapterId[] = ['intro', 'projects', 'skills', 'about']

export function hexToRgb(hex: string): Vec3 {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Wide offsets place the blob opposite the chapter's text panel.
export const STOPS: readonly Stop[] = [
  {
    id: 'intro',
    camera: [0, 0, 5],
    lookAt: [0, 0, 0],
    color: hexToRgb('#6366f1'),
    strength: 0.15,
    speed: 1,
    scale: 1,
    offsetWide: [0, 0, -1.5],
    offsetNarrow: [0, 0, -1.5],
  },
  {
    id: 'projects',
    camera: [1.2, 0.3, 5],
    lookAt: [0, 0, 0],
    color: hexToRgb('#a855f7'),
    strength: 0.28,
    speed: 1.4,
    scale: 1,
    offsetWide: [-2.2, 0, 0],
    offsetNarrow: [0, 0.3, -1],
  },
  {
    id: 'skills',
    camera: [0, 1.2, 6.5],
    lookAt: [0, -0.2, 0],
    color: hexToRgb('#ec4899'),
    strength: 0.35,
    speed: 2,
    scale: 1.1,
    offsetWide: [2.2, 0, 0],
    offsetNarrow: [0, 0, -1],
  },
  {
    id: 'about',
    camera: [0, -0.4, 4],
    lookAt: [0, 0, 0],
    color: hexToRgb('#818cf8'),
    strength: 0.1,
    speed: 0.6,
    scale: 0.9,
    offsetWide: [-1.6, -0.2, -1],
    offsetNarrow: [0, 0, -1],
  },
]
