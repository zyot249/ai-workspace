// Vertical field of view the scene is framed for on landscape screens.
export const BASE_FOV = 55

// Narrowest horizontal field of view to keep. On a portrait phone a fixed
// vertical FOV leaves only a thin slice of the scene (about 34 degrees wide),
// which cuts off the gate, the hall frames, and the street props. Below this
// width the vertical FOV grows instead.
export const MIN_HORIZONTAL_FOV = 70

// Cap so very tall screens do not get a fisheye look.
export const MAX_FOV = 100

const DEG = Math.PI / 180

// Vertical FOV, in degrees, for a viewport with the given width / height ratio.
export function fovForAspect(aspect: number): number {
  const needed = 2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * DEG) / 2) / aspect) / DEG
  return Math.min(MAX_FOV, Math.max(BASE_FOV, needed))
}
