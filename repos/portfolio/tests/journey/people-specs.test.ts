// tests/journey/people-specs.test.ts
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHARACTER_SPECS, CLIP_NAMES, MAX_PEOPLE, PEOPLE_CLIPS, PEOPLE_COUNTS, PERSON_HEIGHT, PERSON_RADIUS, peopleTotal,
} from '../../app/journey/people-specs'

const MODEL_DIR = fileURLToPath(new URL('../../public/models/people/', import.meta.url))
const MAX_TOTAL_BYTES = 800 * 1024
const GLB_MAGIC = 'glTF'

describe('people specs', () => {
  it('ships three characters as GLB files', () => {
    expect(CHARACTER_SPECS).toHaveLength(3)
    for (const { file } of CHARACTER_SPECS) {
      const path = MODEL_DIR + file
      expect(existsSync(path), file).toBe(true)
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), file).toBe(GLB_MAGIC)
    }
  })

  it('keeps the download under the budget', () => {
    const total = CHARACTER_SPECS.reduce((sum, { file }) => sum + statSync(MODEL_DIR + file).size, 0)
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })

  it('records the license', () => {
    const text = readFileSync(MODEL_DIR + 'LICENSE.txt', 'utf8')
    expect(text).toContain('Quaternius')
    expect(text).toContain('CC0')
  })

  it('names a clip for every role', () => {
    for (const name of CLIP_NAMES) expect(PEOPLE_CLIPS[name].length).toBeGreaterThan(0)
  })

  it('gives 16, 6, and 0 people per tier, within the cap', () => {
    expect(peopleTotal(PEOPLE_COUNTS.full)).toBe(16)
    expect(peopleTotal(PEOPLE_COUNTS.lite)).toBe(6)
    expect(peopleTotal(PEOPLE_COUNTS.reduced)).toBe(0)
    for (const counts of Object.values(PEOPLE_COUNTS)) expect(peopleTotal(counts)).toBeLessThanOrEqual(MAX_PEOPLE)
  })

  it('uses a person radius that fits inside the height', () => {
    expect(PERSON_RADIUS).toBeLessThan(PERSON_HEIGHT / 2)
  })
})
