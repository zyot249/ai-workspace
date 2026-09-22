export interface SectionRect {
  top: number
  height: number
}

export interface JourneyProgress {
  chapter: number
  progress: number
}

// The active chapter is the last section whose top has reached the anchor line.
// Progress is how far that section has scrolled past the anchor, from 0 to 1.
export function computeProgress(rects: readonly SectionRect[], anchor = 0): JourneyProgress {
  let chapter = -1
  let active: SectionRect | undefined
  rects.forEach((rect, index) => {
    if (rect.top <= anchor) {
      chapter = index
      active = rect
    }
  })

  if (!active) return { chapter: 0, progress: 0 }

  const progress = active.height > 0
    ? Math.min(1, Math.max(0, (anchor - active.top) / active.height))
    : 1
  return { chapter, progress }
}
