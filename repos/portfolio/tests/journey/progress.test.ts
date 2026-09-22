import { describe, expect, it } from 'vitest'
import { computeProgress, type SectionRect } from '../../app/journey/progress'

// Builds consecutive sections starting at `firstTop`.
function sections(firstTop: number, heights: number[]): SectionRect[] {
  let top = firstTop
  return heights.map((height) => {
    const rect = { top, height }
    top += height
    return rect
  })
}

const FOUR = [800, 800, 800, 800]

describe('computeProgress', () => {
  it('returns chapter 0, progress 0 for no sections', () => {
    expect(computeProgress([])).toEqual({ chapter: 0, progress: 0 })
  })

  it('returns chapter 0, progress 0 before the first section reaches the anchor', () => {
    expect(computeProgress(sections(65, FOUR))).toEqual({ chapter: 0, progress: 0 })
  })

  it('reports progress halfway through the first section', () => {
    expect(computeProgress(sections(-400, FOUR))).toEqual({ chapter: 0, progress: 0.5 })
  })

  it('switches to the next chapter at progress 0 on the boundary', () => {
    expect(computeProgress(sections(-800, FOUR))).toEqual({ chapter: 1, progress: 0 })
  })

  it('reports the third chapter mid-way', () => {
    expect(computeProgress(sections(-2000, FOUR))).toEqual({ chapter: 2, progress: 0.5 })
  })

  it('clamps to the last chapter at progress 1 after the last section', () => {
    expect(computeProgress(sections(-4000, FOUR))).toEqual({ chapter: 3, progress: 1 })
  })

  it('treats a zero-height active section as complete', () => {
    expect(computeProgress([{ top: -100, height: 0 }, { top: 200, height: 800 }])).toEqual({ chapter: 0, progress: 1 })
  })

  it('measures from a custom anchor', () => {
    expect(computeProgress([{ top: 100, height: 800 }], 500)).toEqual({ chapter: 0, progress: 0.5 })
  })
})
