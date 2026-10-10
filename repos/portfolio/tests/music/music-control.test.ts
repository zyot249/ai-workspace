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

describe('panel structure', () => {
  async function openPanel(status: string) {
    state.status.value = status
    state.current.value = track('Morning walk')
    const wrapper = render()
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-music-control]').trigger('mouseenter')
    return wrapper
  }

  it('places the panel after the toggle button in DOM order so Tab reaches Next track', async () => {
    const wrapper = await openPanel('playing')
    const toggleButton = wrapper.get('button[aria-label="Background music"]').element
    const panel = wrapper.get('[data-music-panel]').element
    expect(toggleButton.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reflects the open state in aria-expanded and points aria-controls at the panel', async () => {
    state.status.value = 'playing'
    state.current.value = track('Morning walk')
    const wrapper = render()
    const toggleButton = wrapper.get('button[aria-label="Background music"]')
    expect(toggleButton.attributes('aria-expanded')).toBe('false')
    await wrapper.get('[data-music-control]').trigger('mouseenter')
    expect(toggleButton.attributes('aria-expanded')).toBe('true')
    const panel = wrapper.get('[data-music-panel]')
    expect(panel.attributes('id')).toBeTruthy()
    expect(toggleButton.attributes('aria-controls')).toBe(panel.attributes('id'))
  })

  it('shows Next track only while playing, and keeps the credit visible when paused', async () => {
    const wrapper = await openPanel('paused')
    const panel = wrapper.get('[data-music-panel]')
    expect(panel.text()).toContain('Morning walk')
    expect(panel.text()).toContain('CC0')
    expect(wrapper.findAll('button').some(button => button.text() === 'Next track')).toBe(false)
    state.status.value = 'playing'
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('button').some(button => button.text() === 'Next track')).toBe(true)
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
