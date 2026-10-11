export type Vec3 = readonly [number, number, number]

export type ChapterId = 'intro' | 'projects' | 'skills' | 'about'

export const CHAPTER_IDS: readonly ChapterId[] = ['intro', 'projects', 'skills', 'about']

export function hexToRgb(hex: string): Vec3 {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export type Theme = 'light' | 'dark'
export interface PathState {
  cameraDistance: number
  cameraHeight: number
  lookAheadDistance: number
  lookHeight: number
  buildingDensity: number
  buildingHeight: number
}
export interface LookState {
  skyZenith: Vec3
  skyColor: Vec3
  fogColor: Vec3
  fogDensity: number
  sunElevation: number
  sunAzimuth: number
  sunColor: Vec3
  sunGlow: number
  cloudCover: number
  cloudLitColor: Vec3
  cloudShadeColor: Vec3
  hemiIntensity: number
  starOpacity: number
  windowLitRatio: number
  exposure: number
  bloomStrength: number
  wetness: number
}
export type StopState = PathState & LookState
// The journey passes four places, in order: entrance gate, exhibition hall,
// market square, home courtyard (see `PLACES`/`WAYPOINTS` in journey/path.ts).
// `cameraDistance` is how far along that path the camera sits for each stop;
// `lookAheadDistance` is how much further along it looks. `PATH_STOPS` is
// theme-independent; `LOOKS` holds the light (morning to afternoon) and dark
// (sunset to night) arcs.
export const PATH_STOPS: Readonly<Record<ChapterId, PathState>> = {
  intro: { cameraDistance: 0, cameraHeight: .2, lookAheadDistance: 8, lookHeight: 0, buildingDensity: .35, buildingHeight: .6 },
  projects: { cameraDistance: 8, cameraHeight: .6, lookAheadDistance: 8, lookHeight: .3, buildingDensity: .6, buildingHeight: .85 },
  skills: { cameraDistance: 40, cameraHeight: .8, lookAheadDistance: 9, lookHeight: .4, buildingDensity: .85, buildingHeight: 1.15 },
  about: { cameraDistance: 72, cameraHeight: .3, lookAheadDistance: 9, lookHeight: .2, buildingDensity: 1, buildingHeight: 1 },
}
// `wetness` (spec 08): the light arc is a dry morning-to-afternoon day, so it is 0 throughout. The dark arc is a street that has just rained as dusk turns to night.
export const LOOKS: Readonly<Record<Theme, Readonly<Record<ChapterId, LookState>>>> = {
  light: {
    intro: { skyZenith: hexToRgb('#4f86d6'), skyColor: hexToRgb('#9cc3ee'), fogColor: hexToRgb('#dce8f6'), fogDensity: .04,
      sunElevation: 12, sunAzimuth: -60, sunColor: hexToRgb('#ffe7c4'), sunGlow: .35, cloudCover: .55,
      cloudLitColor: hexToRgb('#ffffff'), cloudShadeColor: hexToRgb('#b8c6dc'), hemiIntensity: .9, starOpacity: 0,
      windowLitRatio: .05, exposure: 1, bloomStrength: 0, wetness: 0 },
    projects: { skyZenith: hexToRgb('#3b78d4'), skyColor: hexToRgb('#8bbbf0'), fogColor: hexToRgb('#d4e5f7'), fogDensity: .035,
      sunElevation: 25, sunAzimuth: -40, sunColor: hexToRgb('#fff1dc'), sunGlow: .25, cloudCover: .65,
      cloudLitColor: hexToRgb('#ffffff'), cloudShadeColor: hexToRgb('#aebfd8'), hemiIntensity: .9, starOpacity: 0,
      windowLitRatio: .03, exposure: 1, bloomStrength: 0, wetness: 0 },
    skills: { skyZenith: hexToRgb('#2f6bcf'), skyColor: hexToRgb('#7fb2ee'), fogColor: hexToRgb('#cfe1f5'), fogDensity: .035,
      sunElevation: 55, sunAzimuth: -10, sunColor: hexToRgb('#fffaf0'), sunGlow: .15, cloudCover: .6,
      cloudLitColor: hexToRgb('#ffffff'), cloudShadeColor: hexToRgb('#b3c3da'), hemiIntensity: .9, starOpacity: 0,
      windowLitRatio: .02, exposure: 1, bloomStrength: 0, wetness: 0 },
    about: { skyZenith: hexToRgb('#3c72c4'), skyColor: hexToRgb('#95bbe4'), fogColor: hexToRgb('#e6e4df'), fogDensity: .04,
      sunElevation: 28, sunAzimuth: 30, sunColor: hexToRgb('#ffe9c7'), sunGlow: .3, cloudCover: .5,
      cloudLitColor: hexToRgb('#ffffff'), cloudShadeColor: hexToRgb('#bcbcc8'), hemiIntensity: .9, starOpacity: 0,
      windowLitRatio: .05, exposure: 1, bloomStrength: 0, wetness: 0 },
  },
  dark: {
    intro: { skyZenith: hexToRgb('#6f7fb8'), skyColor: hexToRgb('#fbbf9f'), fogColor: hexToRgb('#f3a683'), fogDensity: .05,
      sunElevation: 4, sunAzimuth: 5, sunColor: hexToRgb('#ffb27a'), sunGlow: .85, cloudCover: .45,
      cloudLitColor: hexToRgb('#ffc29a'), cloudShadeColor: hexToRgb('#7a6a8f'), hemiIntensity: .7, starOpacity: 0,
      windowLitRatio: .3, exposure: 1, bloomStrength: .12, wetness: 0 },
    projects: { skyZenith: hexToRgb('#2e2a5c'), skyColor: hexToRgb('#7c6aa8'), fogColor: hexToRgb('#6b5b95'), fogDensity: .05,
      sunElevation: -3, sunAzimuth: 10, sunColor: hexToRgb('#c97aa8'), sunGlow: .45, cloudCover: .4,
      cloudLitColor: hexToRgb('#d79ab8'), cloudShadeColor: hexToRgb('#3d3560'), hemiIntensity: .6, starOpacity: .3,
      windowLitRatio: .55, exposure: 1.1, bloomStrength: .25, wetness: .15 },
    skills: { skyZenith: hexToRgb('#151834'), skyColor: hexToRgb('#3a3768'), fogColor: hexToRgb('#2e2a52'), fogDensity: .055,
      sunElevation: -12, sunAzimuth: 10, sunColor: hexToRgb('#8a86c4'), sunGlow: .15, cloudCover: .3,
      cloudLitColor: hexToRgb('#5d5a8a'), cloudShadeColor: hexToRgb('#1f1e3a'), hemiIntensity: .55, starOpacity: .7,
      windowLitRatio: .75, exposure: 1.15, bloomStrength: .35, wetness: .4 },
    about: { skyZenith: hexToRgb('#0a0d22'), skyColor: hexToRgb('#1e2340'), fogColor: hexToRgb('#141833'), fogDensity: .065,
      // Night clouds stay within 8/255 of the clear sky (spec 09 test 16); retuned 2026-10-09.
      sunElevation: -22, sunAzimuth: 10, sunColor: hexToRgb('#7a8cc4'), sunGlow: 0, cloudCover: .1,
      cloudLitColor: hexToRgb('#2c3353'), cloudShadeColor: hexToRgb('#181c35'), hemiIntensity: .5, starOpacity: 1,
      windowLitRatio: .9, exposure: 1.25, bloomStrength: .42, wetness: .7 },
  },
}
