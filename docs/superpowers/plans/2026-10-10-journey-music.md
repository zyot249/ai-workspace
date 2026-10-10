# Journey Background Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in background music to the journey page, with a configurable playlist per theme and a crossfade when the theme toggles.

**Architecture:** A Web Audio engine (`app/music/player.ts`, no Vue imports) owns two decks, each `<audio>` -> `GainNode` -> destination, and fades with gain ramps. Pure helpers (`playlist.ts`, `fade.ts`) hold list and ramp math. A composable (`useJourneyMusic`) bridges the engine to Vue: stored choice, arming on a gesture, tab visibility, theme watch. `MusicControl.vue` is the button and panel. `index.vue` renders the control only when a playlist has tracks.

**Tech Stack:** Nuxt 4, Vue 3.5, TypeScript, Web Audio API, Vitest 5, `@vue/test-utils`, `happy-dom`, Tailwind 3.

**Spec:** `docs/superpowers/specs/2026-10-09-journey-music-design.md`

**Research:** `docs/superpowers/research/2026-10-09-portfolio-overview-research.md`. It was written against commit `ef03e91`. `HEAD` is `4ab94a3`. I checked the parts this plan relies on against the current code: `app/pages/index.vue`, `site.config.ts`, `types/site.d.ts`, `app/composables/useDarkMode.ts`, `app/plugins/dark-mode.client.ts`, `vitest.config.ts` and the `tests/journey/` layout all match what this plan assumes.

All paths below are relative to `repos/portfolio/` unless they start with `docs/`. Run all commands from `repos/portfolio/`.

## Decisions that differ from the spec text

Each one is small and has a reason. The executor follows this plan, not the spec, on these points.

1. **`Theme` is imported, not declared.** Spec 09 has landed: `Theme` is exported from `app/journey/stops.ts`. `playlist.ts` re-exports it.
2. **Gesture listeners do not use `{ once: true }`.** With `once`, the first `pointerdown` on the music button itself would consume the listener, and the armed-click rule ("a click on the button while armed toggles music off") could not work. The listeners are removed by hand after the first gesture outside the control.
3. **`fade.ts` also exports `gainAt(plan, now)`.** The engine needs the current gain to start a new ramp without a jump. Reading `gain.value` is unreliable on older Safari, so the engine computes it from the last plan.
4. **`createMusicPlayer` takes an optional fourth argument `env`** (`PlayerEnv`). Tests pass fakes. Production code omits it and gets `browserEnv()`.
5. **`pause()` suspends the `AudioContext`** after the fade (spec section 5, "Leaving the page"). `play()` resumes it. `dispose()` is immediate, because a ramp cannot finish before `close()`.
6. **The composable prefetches the engine chunk on mount** (an `import()` of a few KB, no audio). Safari only allows audio to start close to the gesture, so the chunk must already be loaded when the visitor clicks.
7. **The composable also returns `supported`** (`AudioContext` exists). `MusicControl` hides itself with it.
8. **`index.vue` is checked by a source test**, not a mounted render, because mounting the page needs the Nuxt content layer.

## Global Constraints

Every task's requirements include these. Values are copied from the spec.

- Audio files: MP3, 128 to 160 kbps, at most 6 MB per file, in `public/audio/`.
- `volume` is in `[0, 1]`. `fadeSeconds` and `themeCrossfadeSeconds` are in `(0, 5]`. Shipped values: `0.4`, `1.5`, `1.2`.
- Every `src` starts with `/audio/`, ends with `.mp3`, and names a file that exists in `public/audio/`. `title`, `artist`, `credit` are not empty.
- **Enabled** means at least one list has a track. If only one list has tracks, both themes use that list.
- The feature ships with empty `light` and `dark` lists. With both empty, no button renders and no audio code runs.
- No audio file downloads and no `<audio>` gets a `src` before the first `play()`.
- Storage key: `localStorage['music']`, value `'on'` or `'off'`. Every read and write is in `try`/`catch`.
- Gesture events: `pointerdown`, `keydown`, `touchend`. Scrolling does not count.
- Fade-in on start: `fadeSeconds`. Theme crossfade: `themeCrossfadeSeconds`. The engine reads time from `AudioContext.currentTime` and uses no timers for gain.
- Shared state key: `useState('journeyMusic')`.
- Where `navigator.audioSession` exists, set `navigator.audioSession.type = 'playback'`.
- UI strings, exact: `aria-label` "Background music", error label "Background music unavailable", live region "Now playing: Title by Artist", armed `title` "Music resumes on your first click", panel button "Next track".
- Button: 44 x 44 px, `fixed`, `z-20`, `right-4 bottom-4` plus `env(safe-area-inset-bottom)` and `env(safe-area-inset-right)`. Panel style `bg-white/75 dark:bg-neutral-950/60 backdrop-blur`. No icon dependency. No pulse under `prefers-reduced-motion`.
- No new runtime dependency. Dev dependencies: `@vue/test-utils`, `happy-dom` only.
- Repo rules: write each test first and watch it fail (`.claude/rules/common/testing.md`). No mutation of inputs outside the engine's own deck state. Source files stay under 800 lines. Commit messages are `<type>: <description>` with types `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
- Write user-facing copy and comments in plain, direct prose.

## Review Focus

Inputs and conditions the spec implies but does not spell out. Each line names the task whose tests pin it.

1. **Only one list has tracks.** Toggling the theme must not start a second deck or crossfade the same list against itself. (Task 5, test "does not crossfade when both themes share one list".)
2. **An armed visitor clicks the music button itself.** Music stays off. The button's own `pointerdown` must not start playback and then have the click stop it. (Task 6, test "a pointerdown on the control does not start music").
3. **`pause()` during a crossfade, and `play()` during a pause fade-out.** Both decks go quiet on pause. A `play()` that interrupts a fade-out ramps up from the current gain and the pending pause never runs. (Task 5, tests "pause during a crossfade" and "play during a pause fade-out").
4. **A one-track list.** `ended` loops the same track. "Next track" does not throw. (Task 4 "loops a one-track list"; Task 5 "next with one track").
5. **A double click on the button, or two `play()` calls in a row.** One playback, not two overlapping ones. (Task 4, test "two quick play calls start one playback").

## File Structure

| File | Responsibility |
| --- | --- |
| `types/site.d.ts` (modify) | `Track`, `MusicConfig`, `SiteConfig.music`. |
| `site.config.ts` (modify) | `music` block with empty lists. |
| `public/audio/.gitkeep` (create) | Folder for tracks. |
| `app/music/playlist.ts` (create) | Pure list helpers and the `Positions` record. |
| `app/music/fade.ts` (create) | Pure ramp planning: `fadePlan`, `gainAt`. |
| `app/music/player.ts` (create) | The engine. No Vue imports. |
| `app/composables/useJourneyMusic.ts` (create) | Vue bridge. |
| `app/components/MusicControl.vue` (create) | Button and panel. |
| `app/pages/index.vue` (modify) | Render `MusicControl` when enabled. |
| `vitest.config.ts` (modify) | Vue plugin and the `#imports` alias for tests. |
| `tests/music/support/validate-music-config.ts` (create) | Config rules as a pure function. |
| `tests/music/support/fakes.ts` (create) | Fake `AudioContext`, audio element, env. |
| `tests/music/support/fake-player.ts` (create) | Fake `MusicPlayer` for composable tests. |
| `tests/music/support/nuxt-imports.ts` (create) | `useState` stand-in for `#imports`. |
| `tests/music/*.test.ts` (create) | One file per unit. |

---

### Task 1: Types, empty config, config validation

**Files:**
- Modify: `types/site.d.ts`
- Modify: `site.config.ts`
- Create: `public/audio/.gitkeep`
- Create: `tests/music/support/validate-music-config.ts`
- Test: `tests/music/config.test.ts`
- Modify: `package.json`, `package-lock.json` (dev dependencies)

**Interfaces:**
- Consumes: nothing.
- Produces: `Track`, `MusicConfig` types (`types/site.d.ts`); `siteConfig.music`; `validateMusicConfig(config: MusicConfig, publicDir: string): string[]` and `MAX_TRACK_BYTES` from `tests/music/support/validate-music-config.ts`.

- [ ] **Step 1: Install the test dependencies**

Run: `npm install -D @vue/test-utils happy-dom`
Expected: both appear under `devDependencies`. Note: `package-lock.json` already has uncommitted changes from before this plan (npm regenerated it). This task commits the lockfile as it stands after the install. Mention this in the handoff.

- [ ] **Step 2: Write the failing test**

Create `tests/music/config.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteConfig } from '../../site.config'
import type { MusicConfig, Track } from '../../types/site'
import { MAX_TRACK_BYTES, validateMusicConfig } from './support/validate-music-config'

const track: Track = { src: '/audio/ok.mp3', title: 'Morning walk', artist: 'A. Artist', credit: 'CC BY 4.0' }

function configWith(overrides: Partial<MusicConfig>): MusicConfig {
  return { volume: 0.4, fadeSeconds: 1.5, themeCrossfadeSeconds: 1.2, light: [track], dark: [], ...overrides }
}

function makePublicDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'music-public-'))
  mkdirSync(join(root, 'audio'))
  writeFileSync(join(root, 'audio', 'ok.mp3'), Buffer.alloc(10))
  writeFileSync(join(root, 'audio', 'big.mp3'), Buffer.alloc(MAX_TRACK_BYTES + 1))
  return root
}

describe('shipped music config', () => {
  it('passes every rule', () => {
    const publicDir = fileURLToPath(new URL('../../public', import.meta.url))
    expect(validateMusicConfig(siteConfig.music, publicDir)).toEqual([])
  })
})

describe('validateMusicConfig', () => {
  const publicDir = makePublicDir()

  it('accepts a valid config', () => {
    expect(validateMusicConfig(configWith({}), publicDir)).toEqual([])
  })

  it('rejects a volume outside 0..1', () => {
    expect(validateMusicConfig(configWith({ volume: 1.5 }), publicDir)).toEqual(['volume must be in [0, 1]'])
    expect(validateMusicConfig(configWith({ volume: -0.1 }), publicDir)).toEqual(['volume must be in [0, 1]'])
  })

  it('rejects fade lengths outside (0, 5]', () => {
    expect(validateMusicConfig(configWith({ fadeSeconds: 0 }), publicDir)).toEqual(['fadeSeconds must be in (0, 5]'])
    expect(validateMusicConfig(configWith({ themeCrossfadeSeconds: 5.1 }), publicDir)).toEqual([
      'themeCrossfadeSeconds must be in (0, 5]',
    ])
  })

  it('rejects a src with the wrong prefix or extension', () => {
    const bad = configWith({ light: [{ ...track, src: '/media/ok.mp3' }], dark: [{ ...track, src: '/audio/ok.wav' }] })
    expect(validateMusicConfig(bad, publicDir)).toEqual([
      'light[0].src must start with /audio/ and end with .mp3',
      'dark[0].src must start with /audio/ and end with .mp3',
    ])
  })

  it('rejects a file that does not exist', () => {
    const bad = configWith({ light: [{ ...track, src: '/audio/missing.mp3' }] })
    expect(validateMusicConfig(bad, publicDir)).toEqual(['light[0].src names a file that does not exist in public/'])
  })

  it('rejects a file over 6 MB', () => {
    const bad = configWith({ light: [{ ...track, src: '/audio/big.mp3' }] })
    expect(validateMusicConfig(bad, publicDir)).toEqual(['light[0].src is larger than 6 MB'])
  })

  it('rejects empty title, artist, and credit', () => {
    const bad = configWith({ light: [{ ...track, title: '', artist: ' ', credit: '' }] })
    expect(validateMusicConfig(bad, publicDir)).toEqual([
      'light[0].title must not be empty',
      'light[0].artist must not be empty',
      'light[0].credit must not be empty',
    ])
  })

  it('accepts empty lists', () => {
    expect(validateMusicConfig(configWith({ light: [], dark: [] }), publicDir)).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/music/config.test.ts`
Expected: FAIL with an import error for `./support/validate-music-config`.

- [ ] **Step 4: Write the validator**

Create `tests/music/support/validate-music-config.ts`:

```ts
import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { MusicConfig, Track } from '../../../types/site'

export const MAX_TRACK_BYTES = 6 * 1024 * 1024
export const MAX_FADE_SECONDS = 5

function validateTrack(track: Track, label: string, publicDir: string): string[] {
  const errors: string[] = []
  if (!track.src.startsWith('/audio/') || !track.src.endsWith('.mp3')) {
    errors.push(`${label}.src must start with /audio/ and end with .mp3`)
  } else {
    try {
      if (statSync(join(publicDir, track.src)).size > MAX_TRACK_BYTES) errors.push(`${label}.src is larger than 6 MB`)
    } catch {
      errors.push(`${label}.src names a file that does not exist in public/`)
    }
  }
  for (const field of ['title', 'artist', 'credit'] as const) {
    if (track[field].trim() === '') errors.push(`${label}.${field} must not be empty`)
  }
  return errors
}

export function validateMusicConfig(config: MusicConfig, publicDir: string): string[] {
  const errors: string[] = []
  if (!(config.volume >= 0 && config.volume <= 1)) errors.push('volume must be in [0, 1]')
  for (const key of ['fadeSeconds', 'themeCrossfadeSeconds'] as const) {
    if (!(config[key] > 0 && config[key] <= MAX_FADE_SECONDS)) errors.push(`${key} must be in (0, 5]`)
  }
  for (const theme of ['light', 'dark'] as const) {
    config[theme].forEach((track, index) => errors.push(...validateTrack(track, `${theme}[${index}]`, publicDir)))
  }
  return errors
}
```

- [ ] **Step 5: Run the test to verify the shipped-config test still fails**

Run: `npx vitest run tests/music/config.test.ts`
Expected: the `validateMusicConfig` tests PASS. "shipped music config passes every rule" FAILS with "Cannot read properties of undefined" because `siteConfig.music` does not exist yet.

- [ ] **Step 6: Add the types and the empty config**

In `types/site.d.ts`, add before `SiteConfig` and add the `music` field:

```ts
export interface Track {
  src: string       // path under /audio/, for example '/audio/morning-walk.mp3'
  title: string
  artist: string
  credit: string    // license and attribution line, shown in the control
}

export interface MusicConfig {
  volume: number                 // 0..1, level at full fade-in
  fadeSeconds: number            // start, stop, hide, and show fades
  themeCrossfadeSeconds: number  // theme toggle crossfade
  light: readonly Track[]
  dark: readonly Track[]
}
```

and in `SiteConfig`, after `skills: SkillGroup[]`:

```ts
  music: MusicConfig
```

In `site.config.ts`, after the `skills` array (before the closing `}`), add:

```ts
  music: {
    volume: 0.4,
    fadeSeconds: 1.5,
    themeCrossfadeSeconds: 1.2,
    light: [],
    dark: [],
  },
```

Create the empty file `public/audio/.gitkeep`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/music/config.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: all pass (296 existing plus 9 new).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json types/site.d.ts site.config.ts public/audio/.gitkeep tests/music
git commit -m "feat: add music config types, empty playlists, and config validation"
```

---

### Task 2: Playlist helpers

**Files:**
- Create: `app/music/playlist.ts`
- Test: `tests/music/playlist.test.ts`

**Interfaces:**
- Consumes: `MusicConfig`, `Track` (Task 1); `Theme` from `app/journey/stops.ts`.
- Produces, all from `app/music/playlist.ts`:
  - `type Theme = 'light' | 'dark'` (re-export)
  - `interface Position { readonly index: number; readonly time: number }`
  - `type Positions = Readonly<Record<Theme, Position>>`
  - `const INITIAL_POSITIONS: Positions`
  - `musicEnabled(config: MusicConfig): boolean`
  - `listFor(config: MusicConfig, theme: Theme): readonly Track[]`
  - `nextIndex(list: readonly Track[], index: number): number`
  - `savePosition(positions: Positions, theme: Theme, position: Position): Positions`
  - `positionFor(positions: Positions, theme: Theme): Position`

- [ ] **Step 1: Write the failing test**

Create `tests/music/playlist.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  INITIAL_POSITIONS,
  listFor,
  musicEnabled,
  nextIndex,
  positionFor,
  savePosition,
} from '../../app/music/playlist'
import type { MusicConfig, Track } from '../../types/site'

function track(name: string): Track {
  return { src: `/audio/${name}.mp3`, title: name, artist: 'Artist', credit: 'CC0' }
}

function config(light: string[], dark: string[]): MusicConfig {
  return { volume: 0.4, fadeSeconds: 1.5, themeCrossfadeSeconds: 1.2, light: light.map(track), dark: dark.map(track) }
}

describe('musicEnabled', () => {
  it('is false when both lists are empty', () => {
    expect(musicEnabled(config([], []))).toBe(false)
  })
  it('is true when either list has a track', () => {
    expect(musicEnabled(config(['a'], []))).toBe(true)
    expect(musicEnabled(config([], ['a']))).toBe(true)
  })
})

describe('listFor', () => {
  it('returns the list for the theme', () => {
    const c = config(['l1'], ['d1'])
    expect(listFor(c, 'light')).toBe(c.light)
    expect(listFor(c, 'dark')).toBe(c.dark)
  })
  it('falls back to the other list when one is empty', () => {
    const onlyLight = config(['l1'], [])
    expect(listFor(onlyLight, 'dark')).toBe(onlyLight.light)
    const onlyDark = config([], ['d1'])
    expect(listFor(onlyDark, 'light')).toBe(onlyDark.dark)
  })
})

describe('nextIndex', () => {
  it('advances and wraps at the end of the list', () => {
    const list = config(['a', 'b', 'c'], []).light
    expect(nextIndex(list, 0)).toBe(1)
    expect(nextIndex(list, 2)).toBe(0)
  })
  it('stays on a one-track list and returns 0 for an empty one', () => {
    expect(nextIndex(config(['a'], []).light, 0)).toBe(0)
    expect(nextIndex([], 3)).toBe(0)
  })
})

describe('positions', () => {
  it('defaults to the start of the first track', () => {
    expect(positionFor(INITIAL_POSITIONS, 'light')).toEqual({ index: 0, time: 0 })
    expect(positionFor(INITIAL_POSITIONS, 'dark')).toEqual({ index: 0, time: 0 })
  })
  it('savePosition returns a new record and leaves the input unchanged', () => {
    const before = INITIAL_POSITIONS
    const after = savePosition(before, 'dark', { index: 2, time: 31.5 })
    expect(after).not.toBe(before)
    expect(positionFor(after, 'dark')).toEqual({ index: 2, time: 31.5 })
    expect(positionFor(after, 'light')).toEqual({ index: 0, time: 0 })
    expect(positionFor(before, 'dark')).toEqual({ index: 0, time: 0 })
  })
  it('positionFor falls back to the start when a theme is missing', () => {
    const partial = { light: { index: 1, time: 5 } } as unknown as typeof INITIAL_POSITIONS
    expect(positionFor(partial, 'dark')).toEqual({ index: 0, time: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/music/playlist.test.ts`
Expected: FAIL, cannot resolve `../../app/music/playlist`.

- [ ] **Step 3: Write the implementation**

Create `app/music/playlist.ts`:

```ts
import type { MusicConfig, Track } from '../../types/site'
import type { Theme } from '../journey/stops'

export type { Theme }

export interface Position {
  readonly index: number
  readonly time: number
}

export type Positions = Readonly<Record<Theme, Position>>

const START: Position = { index: 0, time: 0 }

export const INITIAL_POSITIONS: Positions = { light: START, dark: START }

export function musicEnabled(config: MusicConfig): boolean {
  return config.light.length > 0 || config.dark.length > 0
}

/** The list a theme plays. A theme with no tracks plays the other theme's list. */
export function listFor(config: MusicConfig, theme: Theme): readonly Track[] {
  const own = config[theme]
  if (own.length > 0) return own
  return config[theme === 'light' ? 'dark' : 'light']
}

export function nextIndex(list: readonly Track[], index: number): number {
  return list.length === 0 ? 0 : (index + 1) % list.length
}

export function savePosition(positions: Positions, theme: Theme, position: Position): Positions {
  return { ...positions, [theme]: position }
}

export function positionFor(positions: Positions, theme: Theme): Position {
  return positions[theme] ?? START
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/music/playlist.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add app/music/playlist.ts tests/music/playlist.test.ts
git commit -m "feat: add music playlist helpers"
```

---

### Task 3: Fade planning

**Files:**
- Create: `app/music/fade.ts`
- Test: `tests/music/fade.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, from `app/music/fade.ts`:
  - `const MIN_FADE_SECONDS = 0.05`
  - `interface FadePlan { readonly startValue: number; readonly endValue: number; readonly startTime: number; readonly endTime: number }`
  - `fadePlan(from: number, to: number, seconds: number, now: number): FadePlan`
  - `gainAt(plan: FadePlan, now: number): number`

- [ ] **Step 1: Write the failing test**

Create `tests/music/fade.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fadePlan, gainAt, MIN_FADE_SECONDS } from '../../app/music/fade'

describe('fadePlan', () => {
  it('starts at the current gain and ends at the target after the given seconds', () => {
    expect(fadePlan(0.1, 0.4, 1.5, 10)).toEqual({ startValue: 0.1, endValue: 0.4, startTime: 10, endTime: 11.5 })
  })
  it('clamps very short and non-positive lengths to the minimum', () => {
    expect(fadePlan(0, 1, 0, 2).endTime).toBeCloseTo(2 + MIN_FADE_SECONDS)
    expect(fadePlan(0, 1, -3, 2).endTime).toBeCloseTo(2 + MIN_FADE_SECONDS)
    expect(fadePlan(0, 1, 0.01, 2).endTime).toBeCloseTo(2 + MIN_FADE_SECONDS)
  })
  it('treats a non-finite length as the minimum', () => {
    expect(fadePlan(0, 1, Number.NaN, 2).endTime).toBeCloseTo(2 + MIN_FADE_SECONDS)
  })
})

describe('gainAt', () => {
  const plan = fadePlan(0.4, 0, 2, 10)
  it('interpolates linearly inside the ramp', () => {
    expect(gainAt(plan, 11)).toBeCloseTo(0.2)
  })
  it('holds the start value before the ramp and the end value after it', () => {
    expect(gainAt(plan, 5)).toBe(0.4)
    expect(gainAt(plan, 12)).toBe(0)
    expect(gainAt(plan, 99)).toBe(0)
  })
  it('returns the end value for a flat plan with no duration', () => {
    expect(gainAt({ startValue: 0, endValue: 0, startTime: 0, endTime: 0 }, 5)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/music/fade.test.ts`
Expected: FAIL, cannot resolve `../../app/music/fade`.

- [ ] **Step 3: Write the implementation**

Create `app/music/fade.ts`:

```ts
/** Shortest ramp. A shorter one can click. */
export const MIN_FADE_SECONDS = 0.05

export interface FadePlan {
  readonly startValue: number
  readonly endValue: number
  readonly startTime: number
  readonly endTime: number
}

export function fadePlan(from: number, to: number, seconds: number, now: number): FadePlan {
  const length = Number.isFinite(seconds) ? Math.max(seconds, MIN_FADE_SECONDS) : MIN_FADE_SECONDS
  return { startValue: from, endValue: to, startTime: now, endTime: now + length }
}

/** The gain a plan has reached at `now`. Used to start a new ramp from the current level. */
export function gainAt(plan: FadePlan, now: number): number {
  if (now >= plan.endTime) return plan.endValue
  if (now <= plan.startTime) return plan.startValue
  const progress = (now - plan.startTime) / (plan.endTime - plan.startTime)
  return plan.startValue + (plan.endValue - plan.startValue) * progress
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/music/fade.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/music/fade.ts tests/music/fade.test.ts
git commit -m "feat: add music fade planning"
```

---

### Task 4: Player engine core (play, pause, loop, errors, dispose)

This task builds the engine and the fakes. `setTheme` here only records the theme (the correct behavior while not playing) and `next` returns unless playing. Task 5 replaces both with the crossfade versions.

**Files:**
- Create: `app/music/player.ts`
- Create: `tests/music/support/fakes.ts`
- Test: `tests/music/player.test.ts`

**Interfaces:**
- Consumes: `MusicConfig`, `Track` (Task 1); `listFor`, `nextIndex`, `positionFor`, `savePosition`, `Positions`, `Theme` (Task 2); `fadePlan`, `gainAt`, `FadePlan` (Task 3).
- Produces, from `app/music/player.ts`:
  - `type MusicStatus = 'idle' | 'playing' | 'paused' | 'error'`
  - `interface MusicPlayer { readonly status: MusicStatus; readonly current: Track | null; play(): Promise<void>; pause(): Promise<void>; next(): Promise<void>; setTheme(theme: Theme): void; onChange(listener: () => void): () => void; dispose(): void }`
  - `createMusicPlayer(config: MusicConfig, theme: Theme, positions: Positions, env?: PlayerEnv): MusicPlayer`
  - `browserEnv(): PlayerEnv`
  - Structural types for fakes: `GainParamLike`, `GainNodeLike`, `MediaSourceLike`, `AudioContextLike`, `AudioElementLike`, `PlayerEnv`
- Produces, from `tests/music/support/fakes.ts`: `FakeParam`, `FakeContext`, `FakeAudio`, `createFakeEnv(options?)` returning `{ env, ctx, audios, warnings, rules }`, `makeConfig(light: string[], dark: string[]): MusicConfig`, `expectRamp(call, value, time)`. Deck `i` pairs `audios[i]` with `ctx.gains[i]` (the engine creates audio, source, then gain, deck 0 first).

- [ ] **Step 1: Write the fakes**

Create `tests/music/support/fakes.ts`:

```ts
import { expect } from 'vitest'
import type {
  AudioContextLike,
  AudioElementLike,
  GainNodeLike,
  MediaSourceLike,
  PlayerEnv,
} from '../../../app/music/player'
import type { MusicConfig, Track } from '../../../types/site'

export interface ParamCall {
  readonly type: 'cancel' | 'set' | 'ramp'
  readonly value: number
  readonly time: number
}

export class FakeParam {
  readonly calls: ParamCall[] = []
  cancelScheduledValues(time: number): void {
    this.calls.push({ type: 'cancel', value: 0, time })
  }
  setValueAtTime(value: number, time: number): void {
    this.calls.push({ type: 'set', value, time })
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ type: 'ramp', value, time })
  }
  get sets(): ParamCall[] {
    return this.calls.filter(call => call.type === 'set')
  }
  get lastRamp(): ParamCall | undefined {
    return this.calls.filter(call => call.type === 'ramp').at(-1)
  }
}

export class FakeGain implements GainNodeLike {
  readonly gain = new FakeParam()
  disconnected = false
  connect(): void {}
  disconnect(): void {
    this.disconnected = true
  }
}

export class FakeSource implements MediaSourceLike {
  connect(): void {}
  disconnect(): void {}
}

export class FakeContext implements AudioContextLike {
  currentTime = 0
  state = 'suspended'
  readonly destination = {}
  readonly gains: FakeGain[] = []
  resumeCalls = 0
  suspendCalls = 0
  closed = false
  private readonly listeners = new Set<() => void>()

  resume(): Promise<void> {
    this.resumeCalls += 1
    this.state = 'running'
    return Promise.resolve()
  }
  suspend(): Promise<void> {
    this.suspendCalls += 1
    this.setState('suspended')
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
    return Promise.resolve()
  }
  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  createMediaElementSource(): FakeSource {
    return new FakeSource()
  }
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.delete(listener)
  }
  /** Change the state and fire `statechange`, like the browser does. */
  setState(state: string): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }
}

export interface PlayRules {
  /** Sources whose `play()` rejects with `NotSupportedError`. */
  readonly failing: Set<string>
  /** When true, every `play()` rejects with `NotAllowedError`. */
  blocked: boolean
}

function domError(name: string): Error {
  return Object.assign(new Error(name), { name })
}

export class FakeAudio implements AudioElementLike {
  src = ''
  preload = ''
  currentTime = 0
  paused = true
  playCalls = 0
  pauseCalls = 0
  private readonly rules: PlayRules
  private readonly listeners: Record<'ended' | 'error', Set<() => void>> = { ended: new Set(), error: new Set() }

  constructor(rules: PlayRules) {
    this.rules = rules
  }

  play(): Promise<void> {
    this.playCalls += 1
    if (this.rules.blocked) return Promise.reject(domError('NotAllowedError'))
    if (this.rules.failing.has(this.src)) return Promise.reject(domError('NotSupportedError'))
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.pauseCalls += 1
    this.paused = true
  }
  addEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.listeners[type].add(listener)
  }
  removeEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.listeners[type].delete(listener)
  }
  emit(type: 'ended' | 'error'): void {
    for (const listener of [...this.listeners[type]]) listener()
  }
}

export interface FakeEnv {
  readonly env: PlayerEnv
  readonly ctx: FakeContext
  readonly audios: FakeAudio[]
  readonly warnings: unknown[][]
  readonly rules: PlayRules
}

export function createFakeEnv(options: { audioSession?: { type: string } } = {}): FakeEnv {
  const ctx = new FakeContext()
  const audios: FakeAudio[] = []
  const warnings: unknown[][] = []
  const rules: PlayRules = { failing: new Set(), blocked: false }
  const env: PlayerEnv = {
    createContext: () => ctx,
    createAudio: () => {
      const audio = new FakeAudio(rules)
      audios.push(audio)
      return audio
    },
    audioSession: options.audioSession,
    warn: (...args) => {
      warnings.push(args)
    },
  }
  return { env, ctx, audios, warnings, rules }
}

export function track(name: string): Track {
  return { src: `/audio/${name}.mp3`, title: name, artist: 'Artist', credit: 'CC0' }
}

export function makeConfig(light: string[], dark: string[]): MusicConfig {
  return { volume: 0.4, fadeSeconds: 1.5, themeCrossfadeSeconds: 1.2, light: light.map(track), dark: dark.map(track) }
}

export function expectRamp(call: ParamCall | undefined, value: number, time: number): void {
  expect(call?.type).toBe('ramp')
  expect(call?.value).toBeCloseTo(value, 5)
  expect(call?.time).toBeCloseTo(time, 5)
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/music/player.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMusicPlayer } from '../../app/music/player'
import { INITIAL_POSITIONS } from '../../app/music/playlist'
import { createFakeEnv, expectRamp, type FakeEnv, makeConfig } from './support/fakes'

const flush = () => vi.advanceTimersByTimeAsync(0)

async function advance(fake: FakeEnv, seconds: number): Promise<void> {
  fake.ctx.currentTime += seconds
  await vi.advanceTimersByTimeAsync(seconds * 1000)
}

function setup(light: string[], dark: string[] = []) {
  const fake = createFakeEnv()
  const player = createMusicPlayer(makeConfig(light, dark), 'light', INITIAL_POSITIONS, fake.env)
  return { ...fake, player, fake }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('before the first play', () => {
  it('creates no audio element and no context', () => {
    const { audios, ctx, player } = setup(['a'])
    expect(audios).toHaveLength(0)
    expect(ctx.resumeCalls).toBe(0)
    expect(player.status).toBe('idle')
    expect(player.current).toBeNull()
  })
})

describe('play', () => {
  it('resumes the context, loads the first track, and fades from 0 to the volume', async () => {
    const { player, ctx, audios } = setup(['a', 'b'])
    ctx.currentTime = 10
    await player.play()
    expect(ctx.resumeCalls).toBe(1)
    expect(audios[0].src).toBe('/audio/a.mp3')
    expect(audios[0].playCalls).toBe(1)
    expectRamp(ctx.gains[0].gain.lastRamp, 0.4, 11.5)
    expect(player.status).toBe('playing')
    expect(player.current?.title).toBe('a')
  })

  it('keeps the idle deck empty and preloads only the active deck', async () => {
    const { player, audios } = setup(['a'])
    await player.play()
    expect(audios).toHaveLength(2)
    expect(audios[0].preload).toBe('auto')
    expect(audios[1].preload).toBe('none')
    expect(audios[1].src).toBe('')
  })

  it('two quick play calls start one playback', async () => {
    const { player, audios } = setup(['a'])
    await Promise.all([player.play(), player.play()])
    expect(audios).toHaveLength(2)
    expect(audios[0].playCalls).toBe(1)
    expect(player.status).toBe('playing')
  })

  it('sets the iOS audio session to playback when it exists', async () => {
    const session = { type: 'auto' }
    const fake = createFakeEnv({ audioSession: session })
    const player = createMusicPlayer(makeConfig(['a'], []), 'light', INITIAL_POSITIONS, fake.env)
    await player.play()
    expect(session.type).toBe('playback')
  })

  it('works when the audio session does not exist', async () => {
    const { player } = setup(['a'])
    await expect(player.play()).resolves.toBeUndefined()
  })

  it('notifies listeners until they unsubscribe', async () => {
    const { player, fake } = setup(['a'])
    const listener = vi.fn()
    const off = player.onChange(listener)
    await player.play()
    expect(listener).toHaveBeenCalled()
    off()
    listener.mockClear()
    const paused = player.pause()
    await advance(fake, 1.5)
    await paused
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('pause', () => {
  it('ramps the gain to 0, then pauses the audio and suspends the context', async () => {
    const fake = setup(['a'])
    const { player, ctx, audios } = fake
    await player.play()
    await advance(fake.fake, 2)
    const paused = player.pause()
    expect(player.status).toBe('paused')
    expectRamp(ctx.gains[0].gain.lastRamp, 0, 3.5)
    expect(audios[0].paused).toBe(false)
    await advance(fake.fake, 1.5)
    await paused
    expect(audios[0].paused).toBe(true)
    expect(ctx.suspendCalls).toBe(1)
  })

  it('resumes the saved time on the next play', async () => {
    const { player, audios, fake } = setup(['a'])
    await player.play()
    audios[0].currentTime = 42
    const paused = player.pause()
    await advance(fake, 1.5)
    await paused
    audios[0].currentTime = 0
    await player.play()
    expect(audios[0].currentTime).toBe(42)
    expect(player.status).toBe('playing')
  })

  it('does nothing when not playing', async () => {
    const { player, ctx } = setup(['a'])
    await player.pause()
    expect(ctx.suspendCalls).toBe(0)
    expect(player.status).toBe('idle')
  })
})

describe('track end', () => {
  it('starts the next track at full volume, with no new ramp, and loops at the end', async () => {
    const { player, audios, ctx } = setup(['a', 'b'])
    await player.play()
    const rampsBefore = ctx.gains[0].gain.calls.filter(call => call.type === 'ramp').length
    audios[0].emit('ended')
    await flush()
    expect(audios[0].src).toBe('/audio/b.mp3')
    expect(player.current?.title).toBe('b')
    audios[0].emit('ended')
    await flush()
    expect(audios[0].src).toBe('/audio/a.mp3')
    expect(ctx.gains[0].gain.calls.filter(call => call.type === 'ramp')).toHaveLength(rampsBefore)
  })

  it('loops a one-track list', async () => {
    const { player, audios } = setup(['only'])
    await player.play()
    audios[0].currentTime = 99
    audios[0].emit('ended')
    await flush()
    expect(audios[0].playCalls).toBe(2)
    expect(audios[0].currentTime).toBe(0)
    expect(player.status).toBe('playing')
    expect(player.current?.title).toBe('only')
  })
})

describe('errors', () => {
  it('skips a track that fails to play, warns, and plays the next one', async () => {
    const { player, audios, warnings, rules } = setup(['a', 'b'])
    rules.failing.add('/audio/a.mp3')
    await player.play()
    expect(audios[0].src).toBe('/audio/b.mp3')
    expect(player.status).toBe('playing')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('/audio/a.mp3')
  })

  it('skips a track whose media element reports an error during playback', async () => {
    const { player, audios, warnings } = setup(['a', 'b'])
    await player.play()
    audios[0].emit('error')
    await flush()
    expect(audios[0].src).toBe('/audio/b.mp3')
    expect(warnings).toHaveLength(1)
    expect(player.status).toBe('playing')
  })

  it('sets status to error when every track fails', async () => {
    const { player, rules } = setup(['a', 'b'])
    rules.failing.add('/audio/a.mp3')
    rules.failing.add('/audio/b.mp3')
    await player.play()
    expect(player.status).toBe('error')
    expect(player.current).toBeNull()
  })

  it('sets status to idle on NotAllowedError and does not mark the track failed', async () => {
    const { player, audios, warnings, rules } = setup(['a'])
    rules.blocked = true
    await player.play()
    expect(player.status).toBe('idle')
    expect(warnings).toHaveLength(0)
    rules.blocked = false
    await player.play()
    expect(player.status).toBe('playing')
    expect(audios[0].src).toBe('/audio/a.mp3')
  })
})

describe('interruption', () => {
  it('pauses when the context is interrupted and plays again on request', async () => {
    const { player, ctx, audios } = setup(['a'])
    await player.play()
    ctx.setState('interrupted')
    expect(player.status).toBe('paused')
    expect(audios[0].paused).toBe(true)
    await player.play()
    expect(ctx.state).toBe('running')
    expect(player.status).toBe('playing')
  })
})

describe('setTheme while not playing', () => {
  it('switches the list the next play uses and starts no audio', async () => {
    const { player, audios } = setup(['l1'], ['d1'])
    player.setTheme('dark')
    await flush()
    expect(audios).toHaveLength(0)
    await player.play()
    expect(audios[0].src).toBe('/audio/d1.mp3')
  })
})

describe('dispose', () => {
  it('silences and closes everything', async () => {
    const { player, ctx, audios } = setup(['a'])
    await player.play()
    player.dispose()
    expect(ctx.closed).toBe(true)
    expect(ctx.gains.every(gain => gain.disconnected)).toBe(true)
    expect(audios.every(audio => audio.paused)).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/music/player.test.ts`
Expected: FAIL, cannot resolve `../../app/music/player`.

- [ ] **Step 4: Write the engine**

Create `app/music/player.ts`:

```ts
// The playback engine. It keeps mutable audio state (decks, gain plans, status)
// because Web Audio nodes are mutable objects. Pure list and ramp math lives in
// playlist.ts and fade.ts and returns new objects.
import type { MusicConfig, Track } from '../../types/site'
import { type FadePlan, fadePlan, gainAt } from './fade'
import { listFor, nextIndex, positionFor, type Positions, savePosition, type Theme } from './playlist'

export type MusicStatus = 'idle' | 'playing' | 'paused' | 'error'

export interface MusicPlayer {
  readonly status: MusicStatus
  readonly current: Track | null
  play(): Promise<void> // must be called inside a gesture the first time
  pause(): Promise<void> // fades out, then pauses
  next(): Promise<void> // fades to the next track in the current list
  setTheme(theme: Theme): void // crossfades to the other list if playing
  onChange(listener: () => void): () => void
  dispose(): void
}

// Structural types: the parts of the browser audio objects the engine uses.
// Tests pass fakes that match them.
export interface GainParamLike {
  cancelScheduledValues(time: number): void
  setValueAtTime(value: number, time: number): void
  linearRampToValueAtTime(value: number, time: number): void
}
export interface GainNodeLike {
  readonly gain: GainParamLike
  connect(destination: unknown): void
  disconnect(): void
}
export interface MediaSourceLike {
  connect(destination: unknown): void
  disconnect(): void
}
export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: unknown
  resume(): Promise<void>
  suspend(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createMediaElementSource(element: AudioElementLike): MediaSourceLike
  addEventListener(type: 'statechange', listener: () => void): void
  removeEventListener(type: 'statechange', listener: () => void): void
}
export interface AudioElementLike {
  src: string
  preload: string
  currentTime: number
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended' | 'error', listener: () => void): void
  removeEventListener(type: 'ended' | 'error', listener: () => void): void
}
export interface PlayerEnv {
  createContext(): AudioContextLike
  createAudio(): AudioElementLike
  audioSession?: { type: string }
  warn(...args: unknown[]): void
}

/** How long to wait for a context to resume before treating the gesture as missing. */
const RESUME_TIMEOUT_MS = 1000

const SILENT: FadePlan = { startValue: 0, endValue: 0, startTime: 0, endTime: 0 }

type StartResult = 'started' | 'blocked' | 'failed'

interface Deck {
  readonly audio: AudioElementLike
  readonly source: MediaSourceLike
  readonly gain: GainNodeLike
  readonly handlers: { readonly ended: () => void; readonly error: () => void }
  plan: FadePlan
  src: string | null
  theme: Theme
  trackIndex: number
  playing: boolean
  starting: boolean
}

export function browserEnv(): PlayerEnv {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  return {
    createContext: () => new Context() as unknown as AudioContextLike,
    createAudio: () => new Audio() as unknown as AudioElementLike,
    audioSession: session,
    warn: (...args) => console.warn(...args),
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

function notAllowed(): Error {
  return Object.assign(new Error('The audio context did not resume without a user gesture'), { name: 'NotAllowedError' })
}

function delay(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000)
  })
}

export function createMusicPlayer(
  config: MusicConfig,
  initialTheme: Theme,
  initialPositions: Positions,
  env: PlayerEnv = browserEnv(),
): MusicPlayer {
  const listeners = new Set<() => void>()
  const failed = new Set<string>()
  let theme = initialTheme
  let positions = initialPositions
  let status: MusicStatus = 'idle'
  let current: Track | null = null
  let context: AudioContextLike | null = null
  let decks: readonly Deck[] = []
  let active = 0
  // Bumped by every operation that takes over the decks. A timer or await that
  // resumes with an older value belongs to a cancelled operation and stops.
  let generation = 0
  let suspendInFlight: Promise<void> | null = null
  let disposed = false

  function notify(): void {
    for (const listener of [...listeners]) listener()
  }

  function setStatus(next: MusicStatus): void {
    if (status === next) return
    status = next
    notify()
  }

  function setCurrent(track: Track | null): void {
    if (current === track) return
    current = track
    notify()
  }

  function run(task: Promise<void>): void {
    task.catch((error: unknown) => env.warn('[music] playback failed:', error))
  }

  function trackOf(deck: Deck): Track | null {
    return listFor(config, deck.theme)[deck.trackIndex] ?? null
  }

  function snapshot(deck: Deck): void {
    positions = savePosition(positions, deck.theme, { index: deck.trackIndex, time: deck.audio.currentTime })
  }

  /** Ramp a deck to `target` from wherever its gain is now. Returns the ramp length in seconds. */
  function ramp(deck: Deck, target: number, seconds: number): number {
    if (!context) return seconds
    const now = context.currentTime
    const plan = fadePlan(gainAt(deck.plan, now), target, seconds, now)
    const param = deck.gain.gain
    param.cancelScheduledValues(now)
    param.setValueAtTime(plan.startValue, plan.startTime)
    param.linearRampToValueAtTime(plan.endValue, plan.endTime)
    deck.plan = plan
    return plan.endTime - plan.startTime
  }

  function setLevel(deck: Deck, level: number): void {
    if (!context) return
    const now = context.currentTime
    deck.gain.gain.cancelScheduledValues(now)
    deck.gain.gain.setValueAtTime(level, now)
    deck.plan = { startValue: level, endValue: level, startTime: now, endTime: now }
  }

  function stopDeck(deck: Deck): void {
    deck.audio.pause()
    deck.playing = false
    setLevel(deck, 0)
  }

  function stopOthers(keep: Deck): void {
    for (const deck of decks) {
      if (deck !== keep && deck.playing) stopDeck(deck)
    }
  }

  function markFailed(track: Track, error: unknown): void {
    if (failed.has(track.src)) return
    failed.add(track.src)
    env.warn('[music] track failed:', track.src, error)
  }

  function load(deck: Deck, trackTheme: Theme, index: number, track: Track, time: number): void {
    if (deck.src !== track.src) {
      deck.audio.src = track.src
      deck.src = track.src
    }
    deck.audio.currentTime = time
    deck.theme = trackTheme
    deck.trackIndex = index
  }

  /** Load and play the first playable track at or after `fromIndex`. */
  async function startTrack(deck: Deck, trackTheme: Theme, fromIndex: number, time: number): Promise<StartResult> {
    const list = listFor(config, trackTheme)
    deck.starting = true
    try {
      for (let step = 0; step < list.length; step += 1) {
        const index = (fromIndex + step) % list.length
        const track = list[index]
        if (failed.has(track.src)) continue
        load(deck, trackTheme, index, track, step === 0 ? time : 0)
        try {
          await deck.audio.play()
          deck.playing = true
          return 'started'
        } catch (error) {
          if (errorName(error) === 'NotAllowedError') return 'blocked'
          markFailed(track, error)
        }
      }
      return 'failed'
    } finally {
      deck.starting = false
    }
  }

  function settle(deck: Deck, result: StartResult): void {
    if (result === 'started') {
      positions = savePosition(positions, deck.theme, { index: deck.trackIndex, time: deck.audio.currentTime })
      setCurrent(trackOf(deck))
      setStatus('playing')
      return
    }
    deck.playing = false
    if (result === 'failed') setCurrent(null)
    setStatus(result === 'blocked' ? 'idle' : 'error')
  }

  /** Start `index` on a deck that is already playing, at the deck's current gain. */
  async function continueOn(deck: Deck, index: number): Promise<void> {
    const token = generation
    const result = await startTrack(deck, deck.theme, index, 0)
    if (token !== generation) return
    settle(deck, result)
  }

  function handleEnded(deck: Deck): void {
    if (deck !== decks[active] || status !== 'playing' || deck.starting) return
    run(continueOn(deck, nextIndex(listFor(config, deck.theme), deck.trackIndex)))
  }

  function handleError(deck: Deck): void {
    const track = trackOf(deck)
    if (track) markFailed(track, new Error('The media element reported an error'))
    if (deck !== decks[active] || status !== 'playing' || deck.starting) return
    run(continueOn(deck, nextIndex(listFor(config, deck.theme), deck.trackIndex)))
  }

  function createDeck(audioContext: AudioContextLike): Deck {
    const audio = env.createAudio()
    audio.preload = 'auto'
    const source = audioContext.createMediaElementSource(audio)
    const gain = audioContext.createGain()
    gain.gain.setValueAtTime(0, audioContext.currentTime)
    source.connect(gain)
    gain.connect(audioContext.destination)
    const deck: Deck = {
      audio,
      source,
      gain,
      handlers: { ended: () => handleEnded(deck), error: () => handleError(deck) },
      plan: SILENT,
      src: null,
      theme: initialTheme,
      trackIndex: 0,
      playing: false,
      starting: false,
    }
    audio.addEventListener('ended', deck.handlers.ended)
    audio.addEventListener('error', deck.handlers.error)
    return deck
  }

  function onContextState(): void {
    if (!context || context.state === 'running' || status !== 'playing') return
    generation += 1
    for (const deck of decks) {
      if (!deck.playing) continue
      snapshot(deck)
      stopDeck(deck)
    }
    setStatus('paused')
  }

  async function resumeContext(audioContext: AudioContextLike): Promise<void> {
    if (audioContext.state === 'running') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, RESUME_TIMEOUT_MS)
    })
    try {
      await Promise.race([audioContext.resume(), timeout])
    } finally {
      clearTimeout(timer)
    }
    if (audioContext.state !== 'running') throw notAllowed()
  }

  async function ensureReady(): Promise<void> {
    if (!context) {
      const created = env.createContext()
      if (env.audioSession) env.audioSession.type = 'playback'
      decks = [createDeck(created), createDeck(created)]
      decks[1].audio.preload = 'none'
      created.addEventListener('statechange', onContextState)
      context = created
    }
    if (suspendInFlight) await suspendInFlight
    await resumeContext(context)
  }

  async function suspendContext(token: number): Promise<void> {
    if (!context || token !== generation) return
    try {
      await context.suspend()
    } catch (error) {
      env.warn('[music] could not suspend the audio context:', error)
    }
  }

  async function play(): Promise<void> {
    if (disposed || status === 'playing') return
    const token = ++generation
    try {
      await ensureReady()
    } catch (error) {
      if (token !== generation) return
      if (errorName(error) === 'NotAllowedError') {
        setStatus('idle')
        return
      }
      env.warn('[music] the audio engine could not start:', error)
      setStatus('error')
      return
    }
    if (token !== generation) return
    const deck = decks[active]
    stopOthers(deck)
    const position = positionFor(positions, theme)
    const result = await startTrack(deck, theme, position.index, position.time)
    if (token !== generation) return
    settle(deck, result)
    if (result === 'started') ramp(deck, config.volume, config.fadeSeconds)
  }

  async function pause(): Promise<void> {
    if (status !== 'playing') return
    const token = ++generation
    setStatus('paused')
    const audible = decks.filter(deck => deck.playing)
    let seconds = config.fadeSeconds
    for (const deck of audible) {
      snapshot(deck)
      seconds = ramp(deck, 0, config.fadeSeconds)
    }
    await delay(seconds)
    if (token !== generation) return
    for (const deck of audible) {
      snapshot(deck)
      stopDeck(deck)
    }
    suspendInFlight = suspendContext(token)
    await suspendInFlight
    suspendInFlight = null
  }

  // Replaced in Task 5 with the crossfade versions.
  function setTheme(nextTheme: Theme): void {
    theme = nextTheme
  }

  async function next(): Promise<void> {
    if (status !== 'playing') return
  }

  function onChange(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    generation += 1
    for (const deck of decks) {
      setLevel(deck, 0)
      deck.audio.pause()
      deck.playing = false
      deck.audio.removeEventListener('ended', deck.handlers.ended)
      deck.audio.removeEventListener('error', deck.handlers.error)
      deck.source.disconnect()
      deck.gain.disconnect()
    }
    if (context) {
      context.removeEventListener('statechange', onContextState)
      void context.close()
    }
    listeners.clear()
  }

  return {
    get status() {
      return status
    },
    get current() {
      return current
    },
    play,
    pause,
    next,
    setTheme,
    onChange,
    dispose,
  }
}
```

Note on the comment `// Replaced in Task 5 ...`: remove that comment line when Task 5 replaces the two functions.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/music/player.test.ts`
Expected: PASS, 19 tests. If "notifies listeners until they unsubscribe" fails because `pause` is not awaited correctly, check that `advance` moves both the context clock and the fake timers.

- [ ] **Step 6: Commit**

```bash
git add app/music/player.ts tests/music/player.test.ts tests/music/support/fakes.ts
git commit -m "feat: add the music playback engine core"
```

---

### Task 5: Player crossfade (setTheme, next, error recovery)

**Files:**
- Modify: `app/music/player.ts` (replace `setTheme` and `next`, add `crossfade`)
- Test: `tests/music/player-crossfade.test.ts`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: the final `setTheme(theme: Theme): void` and `next(): Promise<void>` behavior. No new exports.

- [ ] **Step 1: Write the failing tests**

Create `tests/music/player-crossfade.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMusicPlayer } from '../../app/music/player'
import { INITIAL_POSITIONS } from '../../app/music/playlist'
import { createFakeEnv, expectRamp, type FakeEnv, makeConfig } from './support/fakes'

const flush = () => vi.advanceTimersByTimeAsync(0)

async function advance(fake: FakeEnv, seconds: number): Promise<void> {
  fake.ctx.currentTime += seconds
  await vi.advanceTimersByTimeAsync(seconds * 1000)
}

function setup(light: string[], dark: string[] = []) {
  const fake = createFakeEnv()
  const player = createMusicPlayer(makeConfig(light, dark), 'light', INITIAL_POSITIONS, fake.env)
  return { ...fake, player, fake }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('setTheme while playing', () => {
  it('crossfades to the other list over the theme crossfade length', async () => {
    const { player, audios, ctx, fake } = setup(['l1', 'l2'], ['d1'])
    await player.play()
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    expect(audios[1].src).toBe('/audio/d1.mp3')
    expect(audios[1].preload).toBe('auto')
    expectRamp(ctx.gains[1].gain.lastRamp, 0.4, 3.2)
    expectRamp(ctx.gains[0].gain.lastRamp, 0, 3.2)
    expect(player.current?.title).toBe('d1')
    expect(audios[0].paused).toBe(false)
    await advance(fake, 1.2)
    expect(audios[0].paused).toBe(true)
    expect(audios[1].paused).toBe(false)
  })

  it('resumes each list at the track and time where it was left', async () => {
    const { player, audios, fake } = setup(['l1', 'l2'], ['d1'])
    await player.play()
    audios[0].currentTime = 30
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    await advance(fake, 1.2)
    audios[0].currentTime = 0
    audios[1].currentTime = 50
    player.setTheme('light')
    await flush()
    expect(audios[0].src).toBe('/audio/l1.mp3')
    expect(audios[0].currentTime).toBe(30)
  })

  it('a second toggle during a crossfade starts from the current gains with no jump', async () => {
    const { player, audios, ctx, fake } = setup(['l1'], ['d1'])
    await player.play()
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    await advance(fake, 0.6)
    player.setTheme('light')
    await flush()
    const incoming = ctx.gains[0].gain
    const outgoing = ctx.gains[1].gain
    expect(incoming.sets.at(-1)?.value).toBeCloseTo(0.2, 5)
    expect(incoming.sets.at(-1)?.time).toBeCloseTo(2.6, 5)
    expectRamp(incoming.lastRamp, 0.4, 3.8)
    expect(outgoing.sets.at(-1)?.value).toBeCloseTo(0.2, 5)
    expectRamp(outgoing.lastRamp, 0, 3.8)
    expect(audios[0].playCalls).toBe(1)
    await advance(fake, 1.2)
    expect(audios[1].paused).toBe(true)
    expect(audios[0].paused).toBe(false)
  })

  it('does not crossfade when both themes share one list', async () => {
    const { player, audios, ctx, fake } = setup(['l1'], [])
    await player.play()
    await advance(fake, 2)
    const rampsBefore = ctx.gains[0].gain.calls.length
    player.setTheme('dark')
    await flush()
    expect(audios[1].src).toBe('')
    expect(audios[1].playCalls).toBe(0)
    expect(ctx.gains[0].gain.calls).toHaveLength(rampsBefore)
    expect(player.status).toBe('playing')
  })

  it('keeps playing the current list when the other list fails entirely', async () => {
    const { player, audios, rules, warnings, fake } = setup(['l1'], ['d1'])
    rules.failing.add('/audio/d1.mp3')
    await player.play()
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    expect(player.status).toBe('playing')
    expect(player.current?.title).toBe('l1')
    expect(audios[0].paused).toBe(false)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('tries the other list after a toggle when the first list failed entirely', async () => {
    const { player, audios, rules } = setup(['l1'], ['d1'])
    rules.failing.add('/audio/l1.mp3')
    await player.play()
    expect(player.status).toBe('error')
    player.setTheme('dark')
    await flush()
    expect(player.status).toBe('playing')
    expect(audios[0].src).toBe('/audio/d1.mp3')
  })
})

describe('pause and play during fades', () => {
  it('pause during a crossfade silences and pauses both decks', async () => {
    const { player, audios, ctx, fake } = setup(['l1'], ['d1'])
    await player.play()
    await advance(fake, 2)
    player.setTheme('dark')
    await flush()
    await advance(fake, 0.5)
    const paused = player.pause()
    expectRamp(ctx.gains[0].gain.lastRamp, 0, 4)
    expectRamp(ctx.gains[1].gain.lastRamp, 0, 4)
    await advance(fake, 1.5)
    await paused
    expect(audios[0].paused).toBe(true)
    expect(audios[1].paused).toBe(true)
    expect(player.status).toBe('paused')
  })

  it('play during a pause fade-out ramps up from the current gain and the pending pause never runs', async () => {
    const { player, audios, ctx, fake } = setup(['a'])
    await player.play()
    await advance(fake, 2)
    const paused = player.pause()
    await advance(fake, 0.5)
    await player.play()
    const last = ctx.gains[0].gain.sets.at(-1)
    expect(last?.value).toBeCloseTo(0.4 * (1 - 0.5 / 1.5), 5)
    expect(last?.time).toBeCloseTo(2.5, 5)
    expectRamp(ctx.gains[0].gain.lastRamp, 0.4, 4)
    await advance(fake, 2)
    await paused
    expect(audios[0].pauseCalls).toBe(0)
    expect(player.status).toBe('playing')
  })
})

describe('next', () => {
  it('crossfades to the next track in the current list over the fade length', async () => {
    const { player, audios, ctx, fake } = setup(['a', 'b', 'c'])
    await player.play()
    await advance(fake, 2)
    const done = player.next()
    await flush()
    expect(audios[1].src).toBe('/audio/b.mp3')
    expect(player.current?.title).toBe('b')
    expectRamp(ctx.gains[1].gain.lastRamp, 0.4, 3.5)
    expectRamp(ctx.gains[0].gain.lastRamp, 0, 3.5)
    await advance(fake, 1.5)
    await done
    expect(audios[0].paused).toBe(true)
  })

  it('next with one track plays that track again on the other deck without throwing', async () => {
    const { player, audios, fake } = setup(['only'])
    await player.play()
    await advance(fake, 2)
    const done = player.next()
    await flush()
    await advance(fake, 1.5)
    await expect(done).resolves.toBeUndefined()
    expect(audios[1].src).toBe('/audio/only.mp3')
    expect(player.status).toBe('playing')
  })

  it('does nothing when not playing', async () => {
    const { player, audios } = setup(['a', 'b'])
    await player.next()
    expect(audios).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/music/player-crossfade.test.ts`
Expected: FAIL. "crossfades to the other list", "resumes each list", "a second toggle", "pause during a crossfade", "next" and the error-retry tests fail, because the Task 4 `setTheme` and `next` do nothing while playing. "does not crossfade when both themes share one list" and "play during a pause fade-out" may already pass.

- [ ] **Step 3: Replace `setTheme` and `next`, and add `crossfade` and `restart`**

In `app/music/player.ts`, delete the comment `// Replaced in Task 5 ...` and the two Task 4 functions `setTheme` and `next`. In their place add:

```ts
  interface CrossfadeTarget {
    readonly theme: Theme
    readonly index: number
    readonly time: number
  }

  /**
   * Start `target` on the idle deck at gain 0, then ramp it up while the active
   * deck ramps down. If the idle deck already plays the target (a second toggle
   * during a crossfade), reuse it. `expectedTheme` is set for theme changes: if
   * the theme changed again while the track was loading, drop this crossfade.
   */
  async function crossfade(target: CrossfadeTarget, seconds: number, expectedTheme?: Theme): Promise<void> {
    const token = ++generation
    const outgoing = decks[active]
    const incoming = decks[1 - active]
    snapshot(outgoing)
    const reusable = incoming.playing && incoming.theme === target.theme && incoming.trackIndex === target.index
    if (!reusable) {
      incoming.audio.preload = 'auto'
      setLevel(incoming, 0)
      const result = await startTrack(incoming, target.theme, target.index, target.time)
      if (token !== generation) return
      if (expectedTheme && expectedTheme !== theme) {
        stopDeck(incoming)
        return
      }
      if (result !== 'started') {
        env.warn('[music] could not start the', target.theme, 'playlist; keeping the current track')
        return
      }
    }
    active = 1 - active
    ramp(incoming, config.volume, seconds)
    ramp(outgoing, 0, seconds)
    setCurrent(trackOf(incoming))
    await delay(seconds)
    if (token !== generation) return
    stopDeck(outgoing)
    outgoing.audio.preload = 'none'
  }

  function setTheme(nextTheme: Theme): void {
    if (nextTheme === theme) return
    theme = nextTheme
    if (disposed) return
    if (status === 'error') {
      run(play())
      return
    }
    if (status !== 'playing') return
    if (listFor(config, 'light') === listFor(config, 'dark')) return
    if (decks[active].theme === nextTheme) return
    const position = positionFor(positions, nextTheme)
    run(crossfade({ theme: nextTheme, index: position.index, time: position.time }, config.themeCrossfadeSeconds, nextTheme))
  }

  async function next(): Promise<void> {
    if (status !== 'playing') return
    const deck = decks[active]
    const list = listFor(config, deck.theme)
    await crossfade({ theme: deck.theme, index: nextIndex(list, deck.trackIndex), time: 0 }, config.fadeSeconds)
  }
```

(`interface` inside a function body is valid TypeScript. If the repo's lint prefers module scope, move `CrossfadeTarget` above `createMusicPlayer`.)

- [ ] **Step 4: Run all player tests**

Run: `npx vitest run tests/music/player.test.ts tests/music/player-crossfade.test.ts`
Expected: PASS, 19 + 11 tests. The Task 4 test "setTheme while not playing" must still pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/music/player.ts tests/music/player-crossfade.test.ts
git commit -m "feat: crossfade music between themes and tracks"
```

---

### Task 6: `useJourneyMusic` composable

**Files:**
- Modify: `vitest.config.ts`
- Create: `tests/music/support/nuxt-imports.ts`
- Create: `tests/music/support/fake-player.ts`
- Create: `app/composables/useJourneyMusic.ts`
- Test: `tests/music/use-journey-music.test.ts`

**Interfaces:**
- Consumes: `MusicPlayer`, `MusicStatus` (Task 4); `INITIAL_POSITIONS`, `Theme` (Task 2); `siteConfig.music` (Task 1); `useState` from `#imports`.
- Produces, from `app/composables/useJourneyMusic.ts`:
  - `type JourneyMusicStatus = MusicStatus | 'armed'`
  - `useJourneyMusic(isDark: Ref<boolean>): { status: Readonly<Ref<JourneyMusicStatus>>; current: Readonly<Ref<Track | null>>; supported: Readonly<Ref<boolean>>; toggle(): Promise<void>; next(): Promise<void> }`

- [ ] **Step 1: Set up the test environment**

Replace `vitest.config.ts` with:

```ts
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // Nuxt auto-imports resolve through #imports. Tests use a small stand-in.
      '#imports': fileURLToPath(new URL('./tests/music/support/nuxt-imports.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

Create `tests/music/support/nuxt-imports.ts`:

```ts
import { type Ref, ref } from 'vue'

const store = new Map<string, Ref<unknown>>()

/** Stand-in for Nuxt's `useState`: one shared ref per key. */
export function useState<T>(key: string, init: () => T): Ref<T> {
  if (!store.has(key)) store.set(key, ref(init()))
  return store.get(key) as Ref<T>
}

export function resetNuxtState(): void {
  store.clear()
}
```

Create `tests/music/support/fake-player.ts`:

```ts
import { vi } from 'vitest'
import type { MusicStatus } from '../../../app/music/player'
import type { Track } from '../../../types/site'
import { track } from './fakes'

export interface FakePlayer {
  readonly status: MusicStatus
  readonly current: Track | null
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  next: ReturnType<typeof vi.fn>
  setTheme: ReturnType<typeof vi.fn>
  onChange(listener: () => void): () => void
  dispose: ReturnType<typeof vi.fn>
  /** What the next `play()` leaves the status as. */
  playOutcome: 'playing' | 'idle' | 'error'
  /** Change the status from outside, like an interruption would. */
  force(next: MusicStatus): void
}

export function createFakePlayer(): FakePlayer {
  let status: MusicStatus = 'idle'
  let current: Track | null = null
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const player: FakePlayer = {
    get status() {
      return status
    },
    get current() {
      return current
    },
    play: vi.fn(async () => {
      status = player.playOutcome
      current = status === 'playing' ? track('a') : null
      emit()
    }),
    pause: vi.fn(async () => {
      status = 'paused'
      emit()
    }),
    next: vi.fn(async () => {}),
    setTheme: vi.fn(),
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: vi.fn(),
    playOutcome: 'playing',
    force(next) {
      status = next
      emit()
    },
  }
  return player
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/music/use-journey-music.test.ts`:

```ts
// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { useJourneyMusic } from '../../app/composables/useJourneyMusic'
import { createMusicPlayer } from '../../app/music/player'
import { createFakePlayer, type FakePlayer } from './support/fake-player'
import { resetNuxtState } from './support/nuxt-imports'

vi.mock('../../app/music/player', () => ({ createMusicPlayer: vi.fn() }))

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const

let fake: FakePlayer
let wrappers: VueWrapper[] = []

function mountHost(options: { isDark?: Ref<boolean>; audioContext?: boolean } = {}) {
  if (options.audioContext !== false) vi.stubGlobal('AudioContext', class {})
  const isDark = options.isDark ?? ref(false)
  let api!: ReturnType<typeof useJourneyMusic>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useJourneyMusic(isDark)
        return () => h('div')
      },
    }),
  )
  wrappers.push(wrapper)
  return { wrapper, api, isDark }
}

function fire(type: (typeof GESTURES)[number], target: EventTarget = window): void {
  target.dispatchEvent(new Event(type, { bubbles: true }))
}

beforeEach(() => {
  fake = createFakePlayer()
  vi.mocked(createMusicPlayer).mockReset()
  vi.mocked(createMusicPlayer).mockReturnValue(fake as never)
  localStorage.clear()
  resetNuxtState()
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.classList.remove('dark')
  document.body.innerHTML = ''
  Reflect.deleteProperty(document, 'hidden')
})

describe('stored choice', () => {
  it("arms on mount when the choice is 'on' and the first gesture plays once", async () => {
    localStorage.setItem('music', 'on')
    const { api } = mountHost()
    expect(api.status.value).toBe('armed')
    fire('pointerdown')
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(1)
    expect(api.status.value).toBe('playing')
    fire('keydown')
    fire('touchend')
    fire('pointerdown')
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(1)
  })

  it("adds no gesture listeners when the choice is 'off' or missing", () => {
    localStorage.setItem('music', 'off')
    const add = vi.spyOn(window, 'addEventListener')
    const { api } = mountHost()
    expect(api.status.value).toBe('idle')
    const types = add.mock.calls.map(call => call[0])
    for (const gesture of GESTURES) expect(types).not.toContain(gesture)
  })

  it('still toggles when storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    const { api } = mountHost()
    expect(api.status.value).toBe('idle')
    await api.toggle()
    expect(fake.play).toHaveBeenCalledTimes(1)
    expect(api.status.value).toBe('playing')
    await api.toggle()
    expect(fake.pause).toHaveBeenCalledTimes(1)
    expect(api.status.value).toBe('paused')
  })
})

describe('toggle', () => {
  it("saves 'on' and plays, then saves 'off' and pauses", async () => {
    const { api } = mountHost()
    await api.toggle()
    expect(localStorage.getItem('music')).toBe('on')
    expect(api.status.value).toBe('playing')
    expect(api.current.value?.title).toBe('a')
    await api.toggle()
    expect(localStorage.getItem('music')).toBe('off')
    expect(fake.pause).toHaveBeenCalledTimes(1)
  })

  it('a pointerdown on the control does not start music; the click turns it off', async () => {
    localStorage.setItem('music', 'on')
    const button = document.createElement('button')
    button.setAttribute('data-music-control', '')
    document.body.appendChild(button)
    const { api } = mountHost()
    fire('pointerdown', button)
    await flushPromises()
    expect(fake.play).not.toHaveBeenCalled()
    expect(api.status.value).toBe('armed')
    await api.toggle()
    expect(api.status.value).toBe('idle')
    expect(localStorage.getItem('music')).toBe('off')
    fire('pointerdown')
    await flushPromises()
    expect(fake.play).not.toHaveBeenCalled()
  })

  it('returns to armed when play is refused for a missing gesture, then plays on the next gesture', async () => {
    const { api } = mountHost()
    fake.playOutcome = 'idle'
    await api.toggle()
    expect(api.status.value).toBe('armed')
    fake.playOutcome = 'playing'
    fire('pointerdown')
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(2)
    expect(api.status.value).toBe('playing')
  })

  it('shows the error state and does nothing on toggle when every track failed', async () => {
    const { api } = mountHost()
    fake.playOutcome = 'error'
    await api.toggle()
    expect(api.status.value).toBe('error')
    await api.toggle()
    expect(fake.play).toHaveBeenCalledTimes(1)
  })

  it('next() asks the player for the next track', async () => {
    const { api } = mountHost()
    await api.toggle()
    await api.next()
    expect(fake.next).toHaveBeenCalledTimes(1)
  })
})

describe('tab visibility', () => {
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('pauses when hidden without changing the stored choice, and plays again when visible', async () => {
    const { api } = mountHost()
    await api.toggle()
    setHidden(true)
    await flushPromises()
    expect(fake.pause).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('music')).toBe('on')
    setHidden(false)
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(2)
    expect(api.status.value).toBe('playing')
  })

  it('does not resume on show after the visitor turned music off', async () => {
    const { api } = mountHost()
    await api.toggle()
    await api.toggle()
    setHidden(true)
    setHidden(false)
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(1)
  })

  it('becomes armed when the browser refuses the resume', async () => {
    const { api } = mountHost()
    await api.toggle()
    setHidden(true)
    await flushPromises()
    fake.playOutcome = 'idle'
    setHidden(false)
    await flushPromises()
    expect(api.status.value).toBe('armed')
  })
})

describe('system interruption', () => {
  it('arms when the player pauses without the visitor asking', async () => {
    const { api } = mountHost()
    await api.toggle()
    fake.force('paused')
    expect(api.status.value).toBe('armed')
    fire('pointerdown')
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(2)
  })
})

describe('theme', () => {
  it('forwards a theme change to the player', async () => {
    const { api, isDark } = mountHost()
    await api.toggle()
    isDark.value = true
    await nextTick()
    expect(fake.setTheme).toHaveBeenCalledWith('dark')
    isDark.value = false
    await nextTick()
    expect(fake.setTheme).toHaveBeenLastCalledWith('light')
  })

  it('creates the player with the theme from the <html> class, not the isDark prop', async () => {
    document.documentElement.classList.add('dark')
    const { api } = mountHost({ isDark: ref(false) })
    await api.toggle()
    expect(createMusicPlayer).toHaveBeenCalledWith(expect.anything(), 'dark', expect.anything())
  })
})

describe('leaving and returning to the page', () => {
  it('pauses on unmount and reuses the same player when the page mounts again', async () => {
    localStorage.setItem('music', 'on')
    const first = mountHost()
    fire('pointerdown')
    await flushPromises()
    expect(first.api.status.value).toBe('playing')
    first.wrapper.unmount()
    wrappers = []
    expect(fake.pause).toHaveBeenCalledTimes(1)
    const second = mountHost()
    await flushPromises()
    expect(createMusicPlayer).toHaveBeenCalledTimes(1)
    expect(fake.play).toHaveBeenCalledTimes(2)
    expect(second.api.status.value).toBe('playing')
  })

  it('removes its listeners on unmount', async () => {
    localStorage.setItem('music', 'on')
    const { wrapper } = mountHost()
    wrapper.unmount()
    wrappers = []
    fire('pointerdown')
    await flushPromises()
    expect(fake.play).not.toHaveBeenCalled()
  })
})

describe('browser support', () => {
  it('reports unsupported and stays idle when AudioContext is missing', () => {
    localStorage.setItem('music', 'on')
    const { api } = mountHost({ audioContext: false })
    expect(api.supported.value).toBe(false)
    expect(api.status.value).toBe('idle')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/music/use-journey-music.test.ts`
Expected: FAIL, cannot resolve `../../app/composables/useJourneyMusic`.

- [ ] **Step 4: Write the composable**

Create `app/composables/useJourneyMusic.ts`:

```ts
import { useState } from '#imports'
import { markRaw, onBeforeUnmount, onMounted, readonly, ref, type Ref, watch } from 'vue'
import { siteConfig } from '../../site.config'
import type { Track } from '../../types/site'
import type { MusicPlayer, MusicStatus } from '../music/player'
import { INITIAL_POSITIONS, type Theme } from '../music/playlist'

export type JourneyMusicStatus = MusicStatus | 'armed'

type Choice = 'on' | 'off'

const STORAGE_KEY = 'music'
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const
const CONTROL_SELECTOR = '[data-music-control]'

function readChoice(): Choice | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'on' || value === 'off' ? value : null
  } catch {
    return null
  }
}

function writeChoice(choice: Choice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Storage can be blocked (private mode); the choice lasts for this visit only.
  }
}

// The theme lives in the `dark` class on <html>. `isDark` is false until after
// mount, so reading it here could start the wrong playlist (see useDarkMode).
function themeFromDocument(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function isInsideControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROL_SELECTOR) !== null
}

function audioSupported(): boolean {
  return 'AudioContext' in window || 'webkitAudioContext' in window
}

type EngineModule = typeof import('../music/player')

let enginePromise: Promise<EngineModule> | null = null

function loadEngine(): Promise<EngineModule> {
  enginePromise ??= import('../music/player').catch((error: unknown) => {
    enginePromise = null
    throw error
  })
  return enginePromise
}

export function useJourneyMusic(isDark: Ref<boolean>) {
  // The player outlives the page: leaving `/` pauses it, coming back resumes it.
  const shared = useState<{ player: MusicPlayer | null }>('journeyMusic', () => ({ player: null }))
  const status = ref<JourneyMusicStatus>('idle')
  const current = ref<Track | null>(null)
  const supported = ref(true)
  let choice: Choice | null = null
  let armed = false
  let expectPause = false
  let resumeOnShow = false
  let bound: MusicPlayer | null = null
  let unsubscribe: (() => void) | null = null

  function saveChoice(next: Choice): void {
    choice = next
    writeChoice(next)
  }

  function sync(player: MusicPlayer): void {
    current.value = player.current
    const interrupted = player.status === 'paused' && !expectPause && choice === 'on'
    const refused = player.status === 'idle' && choice === 'on'
    if (interrupted || refused) {
      arm()
      return
    }
    status.value = player.status
  }

  function bind(player: MusicPlayer): void {
    if (bound === player) return
    unsubscribe?.()
    bound = player
    unsubscribe = player.onChange(() => sync(player))
    sync(player)
  }

  async function ensurePlayer(): Promise<MusicPlayer> {
    const existing = shared.value.player
    if (existing) {
      bind(existing)
      return existing
    }
    const { createMusicPlayer } = await loadEngine()
    const raced = shared.value.player
    if (raced) {
      bind(raced)
      return raced
    }
    const created = markRaw(createMusicPlayer(siteConfig.music, themeFromDocument(), INITIAL_POSITIONS))
    shared.value = { player: created }
    bind(created)
    return created
  }

  // Not `{ once: true }`: the first pointerdown may land on the music button
  // itself, and that one must not use up the listener or start the music.
  function onGesture(event: Event): void {
    if (isInsideControl(event.target)) return
    void start()
  }

  function arm(): void {
    status.value = 'armed'
    if (armed) return
    armed = true
    for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true })
  }

  function disarm(): void {
    if (!armed) return
    armed = false
    for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true })
  }

  async function start(): Promise<void> {
    disarm()
    try {
      const player = await ensurePlayer()
      await player.play()
      sync(player)
    } catch (error) {
      console.warn('[music] could not start playback:', error)
      status.value = 'error'
    }
  }

  async function pausePlayer(): Promise<void> {
    const player = shared.value.player
    if (!player) return
    expectPause = true
    try {
      await player.pause()
    } finally {
      expectPause = false
    }
  }

  async function toggle(): Promise<void> {
    resumeOnShow = false
    if (status.value === 'error') return
    if (status.value === 'playing') {
      saveChoice('off')
      await pausePlayer()
      return
    }
    if (status.value === 'armed') {
      saveChoice('off')
      disarm()
      status.value = 'idle'
      return
    }
    saveChoice('on')
    await start()
  }

  async function next(): Promise<void> {
    try {
      await shared.value.player?.next()
    } catch (error) {
      console.warn('[music] could not skip to the next track:', error)
    }
  }

  function onVisibilityChange(): void {
    const player = shared.value.player
    if (!player) return
    if (document.hidden) {
      if (player.status === 'playing') {
        resumeOnShow = true
        void pausePlayer()
      }
      return
    }
    if (resumeOnShow) {
      resumeOnShow = false
      void start()
    }
  }

  watch(isDark, (dark) => {
    shared.value.player?.setTheme(dark ? 'dark' : 'light')
  })

  onMounted(() => {
    supported.value = audioSupported()
    if (!supported.value) return
    choice = readChoice()
    document.addEventListener('visibilitychange', onVisibilityChange)
    // Load the engine chunk now so it is ready inside the visitor's first gesture.
    // This fetches code only; no audio file downloads before playback starts.
    loadEngine().catch((error: unknown) => console.warn('[music] could not load the audio engine:', error))
    if (choice !== 'on') return
    if (shared.value.player) void start()
    else arm()
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    disarm()
    unsubscribe?.()
    const player = shared.value.player
    if (player?.status === 'playing') {
      expectPause = true
      void player.pause()
    }
  })

  return { status: readonly(status), current: readonly(current), supported: readonly(supported), toggle, next }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/music/use-journey-music.test.ts`
Expected: PASS, 17 tests.

If "returns to armed when play is refused" fails: `sync` must run after `player.play()` in `start()`, because a refused play leaves the fake's status at `idle` and fires no change event.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass. The new Vue plugin in `vitest.config.ts` must not break the existing journey tests.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts app/composables/useJourneyMusic.ts tests/music
git commit -m "feat: add the useJourneyMusic composable"
```

---

### Task 7: `MusicControl` component

**Files:**
- Create: `app/components/MusicControl.vue`
- Test: `tests/music/music-control.test.ts`

**Interfaces:**
- Consumes: `useJourneyMusic(isDark: Ref<boolean>)` returning `{ status, current, supported, toggle, next }` (Task 6).
- Produces: `<MusicControl :is-dark="boolean" />`, auto-registered by Nuxt as `MusicControl`. Root element carries `data-music-control`; the panel carries `data-music-panel`.

- [ ] **Step 1: Write the failing tests**

Create `tests/music/music-control.test.ts`:

```ts
// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as composable from '../../app/composables/useJourneyMusic'
import MusicControl from '../../app/components/MusicControl.vue'
import { track } from './support/fakes'

vi.mock('../../app/composables/useJourneyMusic', async () => {
  const { ref } = await import('vue')
  const state = {
    status: ref('idle'),
    current: ref(null),
    supported: ref(true),
    toggle: vi.fn(),
    next: vi.fn(),
  }
  return { useJourneyMusic: () => state, __state: state }
})

const state = (composable as unknown as {
  __state: {
    status: { value: string }
    current: { value: ReturnType<typeof track> | null }
    supported: { value: boolean }
    toggle: ReturnType<typeof vi.fn>
    next: ReturnType<typeof vi.fn>
  }
}).__state

function render() {
  return mount(MusicControl, { props: { isDark: false } })
}

beforeEach(() => {
  state.status.value = 'idle'
  state.current.value = null
  state.supported.value = true
  state.toggle.mockClear()
  state.next.mockClear()
})

describe('button', () => {
  it('is a labelled toggle button whose aria-pressed follows the status', async () => {
    const wrapper = render()
    const button = wrapper.get('button[aria-label="Background music"]')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-pressed')).toBe('false')
    state.status.value = 'playing'
    await wrapper.vm.$nextTick()
    expect(button.attributes('aria-pressed')).toBe('true')
    state.status.value = 'paused'
    await wrapper.vm.$nextTick()
    expect(button.attributes('aria-pressed')).toBe('false')
  })

  it('calls toggle on click', async () => {
    const wrapper = render()
    await wrapper.get('button[aria-label="Background music"]').trigger('click')
    expect(state.toggle).toHaveBeenCalledTimes(1)
  })

  it('is disabled and relabelled in the error state', async () => {
    state.status.value = 'error'
    const wrapper = render()
    const button = wrapper.get('button[aria-label="Background music unavailable"]')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('explains the armed state in its title', async () => {
    state.status.value = 'armed'
    const wrapper = render()
    expect(wrapper.get('button').attributes('title')).toBe('Music resumes on your first click')
  })

  it('renders nothing when the browser has no AudioContext', () => {
    state.supported.value = false
    const wrapper = render()
    expect(wrapper.find('[data-music-control]').exists()).toBe(false)
  })
})

describe('panel', () => {
  async function renderPlaying() {
    state.status.value = 'playing'
    state.current.value = track('Morning walk')
    const wrapper = render()
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('opens on hover, shows the track and credit, and closes on Escape', async () => {
    const wrapper = await renderPlaying()
    expect(wrapper.find('[data-music-panel]').exists()).toBe(false)
    await wrapper.get('[data-music-control]').trigger('mouseenter')
    const panel = wrapper.get('[data-music-panel]')
    expect(panel.text()).toContain('Morning walk')
    expect(panel.text()).toContain('Artist')
    expect(panel.text()).toContain('CC0')
    await wrapper.get('[data-music-control]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-music-panel]').exists()).toBe(false)
  })

  it('calls next from the Next track button', async () => {
    const wrapper = await renderPlaying()
    await wrapper.get('[data-music-control]').trigger('mouseenter')
    const nextButton = wrapper.findAll('button').find(button => button.text() === 'Next track')
    expect(nextButton).toBeDefined()
    await nextButton!.trigger('click')
    expect(state.next).toHaveBeenCalledTimes(1)
  })

  it('does not open when there is no current track', async () => {
    const wrapper = render()
    await wrapper.get('[data-music-control]').trigger('mouseenter')
    expect(wrapper.find('[data-music-panel]').exists()).toBe(false)
  })
})

describe('live region', () => {
  it('announces only after playback starts', async () => {
    const wrapper = render()
    const region = wrapper.get('[aria-live="polite"]')
    expect(region.text()).toBe('')
    state.current.value = track('Morning walk')
    await wrapper.vm.$nextTick()
    expect(region.text()).toBe('')
    state.status.value = 'playing'
    await wrapper.vm.$nextTick()
    expect(region.text()).toBe('Now playing: Morning walk by Artist')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/music/music-control.test.ts`
Expected: FAIL, cannot resolve `MusicControl.vue`.

- [ ] **Step 3: Write the component**

Create `app/components/MusicControl.vue`:

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useJourneyMusic } from '../composables/useJourneyMusic'

const props = defineProps<{
  isDark: boolean
}>()

const { status, current, supported, toggle, next } = useJourneyMusic(toRef(props, 'isDark'))

// How long a touch must be held before the track panel opens.
const LONG_PRESS_MS = 500

const root = ref<HTMLElement | null>(null)
const panelOpen = ref(false)
const announcement = ref('')

const playing = computed(() => status.value === 'playing')
const errored = computed(() => status.value === 'error')
const label = computed(() => (errored.value ? 'Background music unavailable' : 'Background music'))
const hint = computed(() => (status.value === 'armed' ? 'Music resumes on your first click' : undefined))
const panelVisible = computed(() => panelOpen.value && current.value !== null)

// Announce a track only while music is playing, so a returning visitor who has
// not clicked yet hears nothing.
watch([current, status], () => {
  const track = current.value
  if (status.value === 'playing' && track) announcement.value = `Now playing: ${track.title} by ${track.artist}`
})

function openPanel(): void {
  panelOpen.value = true
}

function closePanel(): void {
  panelOpen.value = false
}

function onFocusOut(event: FocusEvent): void {
  const target = event.relatedTarget
  if (!(target instanceof Node) || !root.value?.contains(target)) closePanel()
}

function onOutsidePointer(event: Event): void {
  if (!(event.target instanceof Node) || !root.value?.contains(event.target)) closePanel()
}

watch(panelOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onOutsidePointer)
  else document.removeEventListener('pointerdown', onOutsidePointer)
})

let pressTimer: ReturnType<typeof setTimeout> | undefined
let suppressClick = false

function onTouchStart(): void {
  suppressClick = false
  pressTimer = setTimeout(() => {
    suppressClick = true
    openPanel()
  }, LONG_PRESS_MS)
}

function onTouchEnd(): void {
  clearTimeout(pressTimer)
}

function onButtonClick(): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  void toggle()
}

onBeforeUnmount(() => {
  clearTimeout(pressTimer)
  document.removeEventListener('pointerdown', onOutsidePointer)
})
</script>

<template>
  <div
    v-if="supported"
    ref="root"
    data-music-control
    class="fixed z-20 right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex items-center gap-2"
    @mouseenter="openPanel"
    @mouseleave="closePanel"
    @focusin="openPanel"
    @focusout="onFocusOut"
    @keydown.esc="closePanel"
  >
    <div
      v-if="panelVisible && current"
      data-music-panel
      class="rounded-2xl p-3 max-w-[16rem] bg-white/75 dark:bg-neutral-950/60 backdrop-blur border border-neutral-200/70 dark:border-white/10 shadow-sm text-sm"
    >
      <p class="font-semibold">{{ current.title }}</p>
      <p class="text-neutral-600 dark:text-neutral-400">{{ current.artist }}</p>
      <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{{ current.credit }}</p>
      <button
        type="button"
        class="mt-2 rounded px-2 py-1 border border-neutral-300 dark:border-neutral-700"
        @click="next"
      >
        Next track
      </button>
    </div>

    <button
      type="button"
      :aria-label="label"
      :aria-pressed="playing"
      :disabled="errored"
      :title="hint"
      class="relative h-11 w-11 shrink-0 rounded-full flex items-center justify-center bg-white/75 dark:bg-neutral-950/60 backdrop-blur border border-neutral-200/70 dark:border-white/10 shadow-sm text-neutral-800 dark:text-neutral-100 disabled:opacity-60"
      @click="onButtonClick"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <span
        v-if="status === 'armed'"
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 rounded-full ring-2 ring-indigo-500 motion-safe:animate-ping"
      />
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5z" />
        <template v-if="playing">
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </template>
        <path v-else-if="errored" d="M18 8v5M18 16.5v.01" />
        <path v-else d="M16 9l5 6M21 9l-5 6" />
      </svg>
    </button>

    <span class="sr-only" aria-live="polite">{{ announcement }}</span>
  </div>
</template>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/music/music-control.test.ts`
Expected: PASS, 9 tests.

If the Escape test fails, check that the `keydown` handler is on the root element and that the test sends `{ key: 'Escape' }`.

- [ ] **Step 5: Commit**

```bash
git add app/components/MusicControl.vue tests/music/music-control.test.ts
git commit -m "feat: add the MusicControl component"
```

---

### Task 8: Wire the control into the journey page

**Files:**
- Modify: `app/pages/index.vue`
- Test: `tests/music/page.test.ts`

**Interfaces:**
- Consumes: `musicEnabled` (Task 2), `MusicControl` (Task 7), `siteConfig.music` (Task 1).
- Produces: the home page renders `<MusicControl>` only when a playlist has tracks.

- [ ] **Step 1: Write the failing test**

Create `tests/music/page.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { musicEnabled } from '../../app/music/playlist'
import type { MusicConfig } from '../../types/site'

const source = readFileSync(new URL('../../app/pages/index.vue', import.meta.url), 'utf8')

const empty: MusicConfig = { volume: 0.4, fadeSeconds: 1.5, themeCrossfadeSeconds: 1.2, light: [], dark: [] }

describe('journey page', () => {
  it('renders MusicControl only when music is enabled, and passes isDark', () => {
    expect(source).toMatch(/<MusicControl\s+v-if="musicEnabled\(siteConfig\.music\)"\s+:is-dark="isDark"\s*\/>/)
  })

  it('imports musicEnabled from the playlist module', () => {
    expect(source).toMatch(/import \{ musicEnabled \} from '~\/music\/playlist'/)
  })

  it('treats empty lists as disabled, so nothing renders and no audio code runs', () => {
    expect(musicEnabled(empty)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/music/page.test.ts`
Expected: FAIL on the first two tests (the page has no `MusicControl` yet). The third passes.

- [ ] **Step 3: Edit the page**

In `app/pages/index.vue`, change the script imports at the top:

```ts
import { siteConfig } from '~~/site.config'
import { musicEnabled } from '~/music/playlist'
```

In the template, add the control as the last child of the root `<div>`, after the closing `</div>` of `class="relative z-10"`:

```vue
    <MusicControl v-if="musicEnabled(siteConfig.music)" :is-dark="isDark" />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/music/page.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite and the type check**

Run: `npm test && npm run typecheck`
Expected: all tests pass. Typecheck reports no errors in the new files. If `nuxt typecheck` flags `import('#imports')` types in `useJourneyMusic.ts`, run `npx nuxt prepare` first and retry.

- [ ] **Step 6: Commit**

```bash
git add app/pages/index.vue tests/music/page.test.ts
git commit -m "feat: render the music control on the journey page when enabled"
```

---

### Task 9: Final acceptance and handoff

**Files:** none changed unless a check fails.

- [ ] **Step 1: Run the automated checks**

Run each command from `repos/portfolio/`. All must pass.

**Automated verification:**

- [ ] `npm test` passes. Expected: 27 existing files plus 9 new `tests/music/*.test.ts` files (config, playlist, fade, player, player-crossfade, use-journey-music, music-control, page) all green.
- [ ] `npm run typecheck` reports no errors.
- [ ] `npm run build` completes.
- [ ] `npm run test:gpu` passes (this feature does not touch the scene; the run confirms nothing regressed). It takes several minutes.
- [ ] With the shipped empty lists, `npm run build` output contains no audio file: `ls .output/public/audio` shows at most `.gitkeep`.

- [ ] **Step 2: Confirm the empty-list behavior in a browser**

Run `npm run dev`, open `/`, and confirm no music button renders and the Network tab shows no request for the engine chunk or any `/audio/` file. (A person does this; record the result in the handoff.)

- [ ] **Step 3: Hand off the manual checks**

Do not tick these. Report them to the user and wait for confirmation. They need at least one temporary test track in each list (MP3, normalized to about -16 LUFS), removed before merge.

**Manual verification:**

- [ ] Desktop Chrome, desktop Safari, and iPhone Safari with the silent switch on and off.
- [ ] First visit: page is silent, one click on the button starts music with a 1.5 s fade-in.
- [ ] Return visit with `'on'` saved: music starts on the first click, tap, or key press anywhere. Return visit with `'off'` saved: stays silent.
- [ ] Armed state: the pulse ring shows (not with reduced motion), and a click on the button itself keeps music off.
- [ ] Theme toggle while playing crossfades in 1.2 s. A double toggle during the crossfade has no jump in volume. A toggle while paused starts nothing, and the next play uses the new theme's list.
- [ ] Each list resumes the track and time where it was last left during the visit.
- [ ] Switch tabs and come back. Navigate to `/projects` and back to `/`. Reload (starts fresh).
- [ ] Keyboard only: tab to the button, start music, open the panel, use "Next track", press `Escape`.
- [ ] VoiceOver on iPhone reads the label, the pressed state, and the now-playing announcement.
- [ ] A track that 404s is skipped. A list where every track fails shows the disabled error button.
- [ ] Licenses and `credit` lines for every track the owner adds are correct (the config test checks that a credit exists, not that it is right).

In the handoff, also report: the decisions listed at the top of this plan, and that `package-lock.json` carried uncommitted changes from before this work and was committed with Task 1.

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| Silent first visit, one click starts with fade-in | 4 (play ramp), 6 (toggle) |
| Saved choice, armed on first gesture | 6 |
| Theme crossfade 1.2 s, per-list resume | 5 |
| Fades via gain ramps (iOS) | 3, 4 |
| Empty lists: no button, no audio code | 7 (`supported`), 8, 9 step 2 |
| Missing or broken track skipped; all fail gives error state | 4, 7 |
| No download before playback | 4 (no src before play, idle deck `preload="none"`) |
| Keyboard and screen reader use | 7 |
| Config types, shipped empty, validation rules | 1 |
| `playlist.ts`, `fade.ts`, `player.ts`, composable, component | 2, 3, 4/5, 6, 7 |
| `audioSession`, `AudioContext` interruption | 4 |
| Tab visibility, page leave, SSR safety | 6 (all work in `onMounted` or handlers) |
| `package.json` dev dependencies | 1 |
| Spec test list 1 to 7 | 1, 2, 3, 4/5, 6, 7, 8 |
| Manual verification list | 9 |

**Placeholder scan:** the only forward reference is Task 4's `setTheme`/`next`, which are working versions for the non-playing case, with the replacement code given in full in Task 5.

**Type consistency:** `MusicPlayer`, `MusicStatus`, `Positions`, `Theme`, `FadePlan` names match across Tasks 2 to 7. `fadePlan(from, to, seconds, now)` and `gainAt(plan, now)` match their call sites in `ramp`. `crossfade(target, seconds, expectedTheme?)` matches both callers. `useJourneyMusic` returns `{ status, current, supported, toggle, next }`, which `MusicControl` destructures and the component test mocks.
