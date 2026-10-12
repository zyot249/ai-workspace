import { SIDEWALK_HEIGHT } from './path'

// A person is 0.5 scene units tall. The Kenney cars are 0.9 long (about 4.5 m), so a real 1.7 m person
// would be 0.35; 0.5 reads better from the street camera. Tuned by eye in the browser.
export const PERSON_HEIGHT = 0.5
// Half the width of a person. Layout keeps this much clear of every obstacle.
export const PERSON_RADIUS = 0.1
// Road surface is at y = -1. People stand on the sidewalk top.
export const FEET_Y = -1 + SIDEWALK_HEIGHT

export const CLIP_NAMES = ['walk', 'idle', 'talk'] as const
export type ClipName = (typeof CLIP_NAMES)[number]
// The exact clip names inside the GLBs, from the inspection in plan task 1. Without a separate talk clip,
// `talk` has the same name as `idle` and talkers simply idle.
export const PEOPLE_CLIPS: Readonly<Record<ClipName, string>> = {
  walk: 'CharacterArmature|Walk',
  idle: 'CharacterArmature|Idle',
  talk: 'CharacterArmature|Wave',
}

export interface CharacterSpec {
  file: string
}

// Absolute path: it assumes the site is deployed at the domain root, as the vehicles do.
export const PEOPLE_MODEL_DIR = '/models/people/'
export const CHARACTER_SPECS: readonly CharacterSpec[] = [
  { file: 'casual.glb' },
  { file: 'business.glb' },
  { file: 'hoodie.glb' },
]

// glTF characters face +Z. The scene authors things facing -Z, so the model turns half a circle.
// If people walk backward in the browser check, set this to 0.
export const MODEL_FACING_Y = Math.PI

export type PeopleTier = 'full' | 'lite' | 'reduced'

export interface PeopleCounts {
  walkers: number
  // Size of each standing group, in the order the groups take their spots.
  talkerGroups: readonly number[]
  guides: number
}

export const PEOPLE_COUNTS: Readonly<Record<PeopleTier, PeopleCounts>> = {
  full: { walkers: 6, talkerGroups: [3, 3, 2], guides: 2 },
  lite: { walkers: 3, talkerGroups: [2], guides: 1 },
  reduced: { walkers: 0, talkerGroups: [], guides: 0 },
}

// One merged skinned mesh per person, so people cost at most this many draw calls.
export const MAX_PEOPLE = 16

export function peopleTotal(counts: PeopleCounts): number {
  return counts.walkers + counts.talkerGroups.reduce((sum, size) => sum + size, 0) + counts.guides
}

// Units per second. Slow, so the walk cycle's foot speed roughly matches the ground speed.
export const WALK_SPEED_MIN = 0.5
export const WALK_SPEED_MAX = 0.9
export const PEOPLE_SEED = 9500

// Distance along the path between the camera and a person. Inside ANIMATE the person animates. Outside
// VISIBLE (past the fog) the person is hidden.
export const PEOPLE_ANIMATE_DISTANCE = 25
export const PEOPLE_VISIBLE_DISTANCE = 45

// Talkers and guides talk for TALK_SECONDS of every TALK_CYCLE_SECONDS, then idle for the rest.
export const TALK_CYCLE_SECONDS = 9
export const TALK_SECONDS = 6
export const CLIP_FADE_SECONDS = 0.3
// The mixer never advances more than this per frame, so a scroll jump or a hidden tab does not fast-forward.
export const MAX_FRAME_STEP = 0.1

// A faint uniform emissive floor so figures stay readable at night. Ramps with the window-lit ratio.
export const NIGHT_GLOW = 0.12
export const GLOW_START = 0.15
export const GLOW_END = 0.6

export const PEOPLE_GROUP_NAME = 'journey-street-people'
export const PERSON_NAME_PREFIX = 'journey-street-person-'
