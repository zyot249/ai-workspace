# Journey background music

Date: 2026-10-09
Status: Draft, approved in conversation, pending written review
Target: `repos/portfolio`, home page journey (`app/pages/index.vue`)
Related: [City polish 09, theme-aware sky](2026-10-09-city-09-theme-sky-design.md). The music follows the same light and dark themes.

## Problem

The journey is a visual experience with no sound. The owner wants optional background music on the journey page, from a playlist they can change without touching player code.

## Goal

Add opt-in background music to the journey page. Light and dark themes each have their own configurable playlist, and toggling the theme crossfades between them.

Success criteria:

- On a first visit the page is silent. One click on the music button starts music with a 1.5 s fade-in.
- The choice (on or off) is saved. A returning visitor who left music on hears it start on their first click, tap, or key press anywhere on the page.
- Toggling the theme while music plays crossfades to the other theme's playlist in 1.2 s. Each playlist resumes the track and time where it was last left during this visit.
- Fades work on iPhone Safari, where `HTMLMediaElement.volume` is read-only.
- When both playlists are empty, no button renders and no audio code runs. The feature ships this way, with empty lists.
- A missing or broken track is skipped. If every track in a list fails, the button shows an error state and nothing else breaks.
- No audio file downloads before the visitor starts playback.
- The button is fully usable with a keyboard and a screen reader.

## Non-goals

- Music on pages other than the journey (`/projects`, `/about`, project pages).
- Music that changes per chapter or with scroll position.
- A volume slider, seek bar, shuffle, or track list UI.
- Remembering the playback position across page reloads.
- Streaming from external URLs. Files are self-hosted.
- Choosing or licensing tracks. The owner adds tracks later.

## Terms

- **Deck:** one `<audio>` element and its Web Audio gain node. The player has two decks so it can crossfade.
- **Playlist:** the ordered track list for one theme.
- **Armed:** the state of a returning visitor whose saved choice is on, before their first gesture. Browsers refuse to start audio without a user gesture, so the player waits.
- **Gesture:** a `pointerdown`, `keydown`, or `touchend` event. Scrolling does not count in browsers' autoplay rules.

## Design

### 1. Approach

Each deck routes `<audio>` through Web Audio: `MediaElementAudioSourceNode -> GainNode -> AudioContext.destination`. Fades are `GainNode.gain` ramps.

Alternatives considered:

- Plain `<audio>` with `volume` fades. Rejected: iOS Safari ignores `volume`, so fades would fail silently on iPhones.
- Howler.js. Rejected: it adds a dependency (about 10 KB gzip) for about 150 lines of code this design needs.

### 2. Configuration

In `types/site.d.ts`:

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

// SiteConfig gains:
music: MusicConfig
```

In `site.config.ts`, shipped empty:

```ts
music: {
  volume: 0.4,
  fadeSeconds: 1.5,
  themeCrossfadeSeconds: 1.2,
  light: [],
  dark: [],
},
```

Audio files live in `public/audio/`. Format: MP3, 128 to 160 kbps, at most 6 MB per file. MP3 plays in every target browser.

Rules (enforced by tests, section 8):

- `volume` is in `[0, 1]`. `fadeSeconds` and `themeCrossfadeSeconds` are in `(0, 5]`.
- Every `src` starts with `/audio/`, ends with `.mp3`, and names a file that exists in `public/audio/`.
- Every file is at most 6 MB.
- `title`, `artist`, and `credit` are not empty.
- **Enabled** means at least one list has a track. If only one list has tracks, both themes use that list.

### 3. Units

| Unit | Kind | Responsibility |
| --- | --- | --- |
| `app/music/playlist.ts` | Pure | `musicEnabled(config)`, `listFor(config, theme)` (with the one-list fallback), `nextIndex(list, i)`, and a `Positions` record (`{ light: { index, time }, dark: { index, time } }`) with `savePosition` and `positionFor`. Returns new objects. |
| `app/music/fade.ts` | Pure | `fadePlan(from, to, seconds, now)` returns the gain ramp start and end values and times. Clamps `seconds` to a minimum of 0.05 to avoid clicks. |
| `app/music/player.ts` | Engine | Owns the `AudioContext` and two decks. API in section 4. No Vue imports. |
| `app/composables/useJourneyMusic.ts` | Vue bridge | Stored choice, arming on a gesture, tab visibility, page leave, theme watch, reactive status for the UI. |
| `app/components/MusicControl.vue` | UI | The button and the expanded panel. |

`app/pages/index.vue` renders `<MusicControl v-if="musicEnabled(siteConfig.music)" />` and passes `isDark`. With empty lists nothing renders, and `player.ts` is never imported. The composable loads it with a dynamic `import()` on first play, so the engine stays out of the initial bundle.

### 4. Player engine

```ts
export type MusicStatus = 'idle' | 'playing' | 'paused' | 'error'

export interface MusicPlayer {
  readonly status: MusicStatus
  readonly current: Track | null
  play(): Promise<void>           // must be called inside a gesture the first time
  pause(): Promise<void>          // fades out, then pauses
  next(): Promise<void>           // fades to the next track in the current list
  setTheme(theme: Theme): void    // crossfades to the other list if playing
  onChange(listener: () => void): () => void
  dispose(): void
}

export function createMusicPlayer(config: MusicConfig, theme: Theme, positions: Positions): MusicPlayer
```

`Theme` is `'light' | 'dark'`, the type spec 09 adds to `stops.ts`. If this spec lands first, declare `Theme` in `app/music/playlist.ts`, and spec 09 imports it from there.

Behavior:

1. **Creation** happens on the first `play()`, inside the gesture. The `AudioContext` is created and resumed there. Where `navigator.audioSession` exists (Safari 17 and later), set `navigator.audioSession.type = 'playback'` so the iPhone silent switch does not mute the music.
2. **Play** loads the current list's saved position (`positionFor`), sets `currentTime`, calls `audio.play()`, and ramps gain from 0 to `volume` over `fadeSeconds`.
3. **Pause** ramps gain to 0 over `fadeSeconds`, then calls `audio.pause()` and saves the position.
4. **Track end** (`ended` event) starts the next track in the same list at full volume, with no fade. The list loops.
5. **Theme change while playing.** Save the active deck's position. Load the other list's position into the idle deck, start it at gain 0, and ramp it up while the active deck ramps down, both over `themeCrossfadeSeconds`. Then pause the old deck and swap roles. A second theme change during a crossfade starts a new crossfade from the current gain values, without a jump. Theme change while paused only switches which list the next `play()` uses.
6. **Preload.** The active deck uses `preload="auto"`. The idle deck uses `preload="none"` until a crossfade needs it. Nothing loads before the first `play()`.
7. **Errors.** On an `error` event or a rejected `audio.play()` (other than `NotAllowedError`), mark that track failed for this visit, `console.warn` with the `src` and the error, and move to the next track that has not failed. If every track in the list has failed, set status to `error` and stop. `NotAllowedError` means the gesture was missing. Set status back to `idle` so the UI can ask again.
8. **Dispose** ramps to 0, pauses both decks, disconnects nodes, and closes the `AudioContext`.

The engine reads time from `AudioContext.currentTime` for ramps and does not use timers for gain.

### 5. Vue bridge: `useJourneyMusic`

```ts
export function useJourneyMusic(isDark: Ref<boolean>): {
  status: Readonly<Ref<MusicStatus | 'armed'>>
  current: Readonly<Ref<Track | null>>
  toggle(): Promise<void>   // from the button click
  next(): Promise<void>
}
```

- **Stored choice.** `localStorage['music']` is `'on'` or `'off'`. Reads and writes are wrapped in `try`/`catch`. If storage is blocked, the choice lasts for this visit only.
- **Arming.** On mount, if the stored choice is `'on'`, status becomes `armed`, and one listener for each of `pointerdown`, `keydown`, and `touchend` is added to `window` (`{ once: true, capture: true }`). The first one to fire calls `play()` and removes the others. A click on the music button itself while armed toggles music off (saves `'off'`) instead of starting it.
- **Toggle.** Off to on: `play()`, save `'on'`. On to off: `pause()`, save `'off'`.
- **Theme.** `watch(isDark, ...)` calls `player.setTheme`. The initial theme comes from the `dark` class on `<html>`, for the same reason as spec 09, section 3: `isDark` is `false` until after mount.
- **Tab visibility.** When `document.hidden` becomes true while playing, `pause()` without changing the stored choice, and remember that the pause was automatic. When the tab is visible again, `play()` if the pause was automatic. iOS may refuse that `play()` without a gesture; then status becomes `armed`.
- **Leaving the page.** `onBeforeUnmount` pauses with a fade and keeps the player and `Positions` in a `useState` key (`journeyMusic`), so returning to `/` during the same visit resumes where it left off. The `AudioContext` is suspended, not closed. A full reload starts fresh.
- **SSR.** Everything runs in `onMounted` or in event handlers. The server renders the button in its `idle` state.

### 6. Control UI: `MusicControl.vue`

- **Placement.** Fixed bottom-right of the journey page: `fixed right-4 bottom-4` plus `env(safe-area-inset-bottom)` and `env(safe-area-inset-right)`, `z-20`, above the canvas and panels. Same translucent panel style as the chapter panels (`bg-white/75 dark:bg-neutral-950/60 backdrop-blur`).
- **Button.** A 44 x 44 px round button (touch target). Icons: speaker with waves (playing), speaker with a slash (idle, paused, or armed), and speaker with an exclamation mark (error). Inline SVG, no icon dependency.
- **Accessibility.** `<button type="button" aria-label="Background music" :aria-pressed="playing">`. In the error state, `aria-label` becomes "Background music unavailable" and the button is disabled. A visually hidden `aria-live="polite"` region announces "Now playing: Title by Artist" when the track changes, only after the visitor has started music.
- **Expanded panel.** On hover or focus within the control (desktop), or a long press on touch devices, a small panel opens to the left of the button. It shows the title and artist, the `credit` line in small text, and a "Next track" button. It closes on `Escape`, on blur, or when the pointer leaves.
- **Armed hint.** While armed, the button shows a subtle pulse ring (none under `prefers-reduced-motion`) and its `title` reads "Music resumes on your first click".
- **Fallback.** The control works whether or not the 3D scene is available, because the music does not depend on WebGL.

### 7. Error handling summary

| Failure | Result |
| --- | --- |
| Storage blocked | Choice lasts for the visit. No error shown. |
| `AudioContext` missing (very old browser) | `MusicControl` checks `'AudioContext' in window` in `onMounted` and hides itself. `musicEnabled` checks the config only, so server and client render the same HTML. |
| One track 404s or fails to decode | Skipped, `console.warn`, next track plays. |
| Every track in a list fails | Status `error`, button disabled with the error icon. The other theme's list is still tried after a theme toggle. |
| `play()` rejected for a missing gesture | Status `armed`, waits for the next gesture. |
| `AudioContext` interrupted (iOS phone call) | On `statechange` to `interrupted` or `suspended`, mark the pause as automatic. Resume on the next gesture. |

## Files

| File | Change |
| --- | --- |
| `types/site.d.ts` | `Track`, `MusicConfig`, `SiteConfig.music`. |
| `site.config.ts` | `music` block with empty lists. |
| `public/audio/.gitkeep` | New, empty folder for tracks. |
| `app/music/playlist.ts` | New. |
| `app/music/fade.ts` | New. |
| `app/music/player.ts` | New. |
| `app/composables/useJourneyMusic.ts` | New. |
| `app/components/MusicControl.vue` | New. |
| `app/pages/index.vue` | Render `MusicControl` when enabled. |
| `package.json` | Dev dependencies `@vue/test-utils` and `happy-dom` for the component and composable tests. |
| `tests/music/*.test.ts` | New, listed below. |

## Testing

Write each test first and watch it fail (`.claude/rules/common/testing.md`). Unit tests run in Node. The composable and component tests set `// @vitest-environment happy-dom` per file.

1. **Config validation** (`config.test.ts`) on the real `siteConfig.music`: every rule in section 2. With empty lists, the test passes and asserts `musicEnabled` is false. When tracks are added, it checks file existence and size with `fs.statSync` on `public/` paths.
2. **`playlist.ts`**: `listFor` falls back to the other list when one is empty. `nextIndex` wraps. `savePosition` returns a new object and leaves the input unchanged. `positionFor` defaults to `{ index: 0, time: 0 }`.
3. **`fade.ts`**: ramps start at the current gain, end at the target at `now + seconds`, and clamp `seconds` to at least 0.05.
4. **Player** (`player.test.ts`) with a fake `AudioContext` (records `linearRampToValueAtTime` calls and `currentTime`) and fake media elements (controllable `play()` promise, `ended`, and `error`):
   - First `play()` resumes the context and ramps 0 to `volume` over `fadeSeconds`.
   - `pause()` ramps to 0 and then pauses.
   - `ended` starts the next track and loops at the end of the list.
   - `setTheme` while playing ramps the two decks in opposite directions over `themeCrossfadeSeconds` and resumes the other list's saved position. A second `setTheme` mid-crossfade starts from the current gains.
   - `setTheme` while paused starts no audio.
   - An `error` event skips to the next track and warns. All tracks failing gives status `error`.
   - A `NotAllowedError` rejection gives status `idle`.
   - `navigator.audioSession.type` is set to `'playback'` when the object exists, and nothing throws when it does not.
   - No `<audio>` gets a `src` before the first `play()`.
5. **`useJourneyMusic`** (happy-dom): stored `'on'` arms and adds the gesture listeners; a `pointerdown` calls `play()` once and removes all listeners. Stored `'off'` adds no listeners. Blocked storage (getter throws) still toggles. Hiding the tab pauses without changing storage; showing it resumes only after an automatic pause. A theme change calls `setTheme`. The initial theme comes from the `<html>` class, not the `isDark` prop.
6. **`MusicControl`** (`@vue/test-utils`): `aria-pressed` follows status, the error state disables the button and changes its label, `Escape` closes the panel, and the live region announces only after playback starts.
7. **Page**: with empty lists, `index.vue` renders no `MusicControl`.

Manual verification (with at least one temporary test track in each list, removed before merge):

- Desktop Chrome, desktop Safari, iPhone Safari with the silent switch on and off.
- First visit, return visit with `'on'` saved, and return visit with `'off'` saved.
- Theme toggle while playing, a double toggle during a crossfade, and a theme toggle while paused.
- Switch tabs and come back. Navigate to `/projects` and back to `/`. Reload.
- Keyboard only: tab to the button, start music, open the panel, use "Next track", press `Escape`.
- VoiceOver on iPhone reads the label, the pressed state, and the now-playing announcement.

## Risks

- **Autoplay rules differ per browser.** Some browsers allow audio after any earlier interaction with the site and some do not. The armed state covers every case; test returning visits on each browser.
- **Licensing.** Every track needs a license that allows use on a public website, and attribution where the license requires it. The `credit` field and the config test enforce that a credit exists, not that it is correct. The owner checks each license.
- **Bandwidth.** A 6 MB track on a mobile connection is noticeable. Only the active track preloads, and only after the visitor opts in.
- **Crossfade with different loudness.** Tracks mastered at different levels make the theme crossfade jump in volume. Normalize files to about -16 LUFS before adding them.
- **iOS `audioSession` support.** On iOS versions without `navigator.audioSession`, the silent switch mutes Web Audio. That is accepted. The button still works, and the visitor hears nothing with the switch on.

## Open questions

None. Tracks are added later by editing `site.config.ts` and `public/audio/`.
