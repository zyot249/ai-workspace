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

  it('applies the current document theme to the reused player before it plays again', async () => {
    localStorage.setItem('music', 'on')
    const first = mountHost()
    fire('pointerdown')
    await flushPromises()
    first.wrapper.unmount()
    wrappers = []
    fake.setTheme.mockClear()
    document.documentElement.classList.add('dark')
    mountHost()
    await flushPromises()
    expect(fake.setTheme).toHaveBeenCalledWith('dark')
    const themeOrder = fake.setTheme.mock.invocationCallOrder[0]!
    const playOrder = fake.play.mock.invocationCallOrder[fake.play.mock.invocationCallOrder.length - 1]!
    expect(themeOrder).toBeLessThan(playOrder)
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

describe('state-machine races', () => {
  function deferPlay(): { resolve: () => void } {
    let resolve!: () => void
    const gate = new Promise<void>((done) => {
      resolve = done
    })
    fake.play.mockImplementationOnce(async () => {
      await gate
      fake.force('playing')
    })
    return { resolve }
  }

  it('after a remount, turning music off keeps it off on the next gesture', async () => {
    localStorage.setItem('music', 'on')
    const first = mountHost()
    fire('pointerdown')
    await flushPromises()
    first.wrapper.unmount()
    wrappers = []
    const second = mountHost()
    await flushPromises()
    expect(second.api.status.value).toBe('playing')
    await second.api.toggle()
    expect(localStorage.getItem('music')).toBe('off')
    fire('pointerdown')
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('music')).toBe('off')
  })

  it('a toggle while a start is in flight cancels it', async () => {
    const { api } = mountHost()
    const gate = deferPlay()
    const starting = api.toggle()
    await flushPromises()
    await api.toggle()
    gate.resolve()
    await starting
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(1)
    expect(fake.pause).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('music')).toBe('off')
    expect(api.status.value).not.toBe('playing')
  })

  it('unmounting during a start leaves nothing playing or listening', async () => {
    localStorage.setItem('music', 'on')
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { wrapper, api } = mountHost()
    const gate = deferPlay()
    fire('pointerdown')
    await flushPromises()
    wrapper.unmount()
    wrappers = []
    gate.resolve()
    await flushPromises()
    expect(fake.pause).toHaveBeenCalled()
    expect(fake.status).not.toBe('playing')
    const gestureCalls = (spy: typeof add) => spy.mock.calls.filter(call => (GESTURES as readonly string[]).includes(call[0])).length
    expect(gestureCalls(add)).toBe(gestureCalls(remove))
    fire('pointerdown')
    await flushPromises()
    expect(fake.play).toHaveBeenCalledTimes(1)
    const before = api.status.value
    fake.force('paused')
    expect(api.status.value).toBe(before)
  })
})
