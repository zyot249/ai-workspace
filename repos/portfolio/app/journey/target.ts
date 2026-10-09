import { CHAPTER_IDS, LOOKS, PATH_STOPS, type ChapterId, type StopState } from './stops'
import { easeInOut, lerpLook, lerpPath } from './interpolate'

export function chapterIdAt(index: number): ChapterId {
  const n = Number.isNaN(index) ? 0 : Math.trunc(index)
  return CHAPTER_IDS[Math.min(CHAPTER_IDS.length - 1, Math.max(0, n))]!
}

export function stopFor(index: number, themeMix: number): StopState {
  const id = chapterIdAt(index)
  return { ...PATH_STOPS[id], ...lerpLook(LOOKS.light[id], LOOKS.dark[id], easeInOut(themeMix)) }
}

export function targetFor(chapter: number, progress: number, themeMix: number, reduced: boolean): StopState {
  const a = chapterIdAt(chapter), b = chapterIdAt(chapter + 1)
  const p = reduced ? 0 : easeInOut(progress)
  return {
    ...lerpPath(PATH_STOPS[a], PATH_STOPS[b], p),
    ...lerpLook(lerpLook(LOOKS.light[a], LOOKS.light[b], p),
      lerpLook(LOOKS.dark[a], LOOKS.dark[b], p), easeInOut(themeMix)),
  }
}
