<script setup lang="ts">
import type { ExhibitItem, JourneyScene, Pointer } from '~/journey/scene'
import { lowPowerFor, pickTier } from '~/journey/tier'

const props = defineProps<{
  chapter: number
  progress: number
  isDark: boolean
  projectItems: ExhibitItem[]
}>()

const emit = defineEmits<{
  unavailable: []
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const active = ref(false)
const pointer: Pointer = { x: 0, y: 0 }
let scene: JourneyScene | null = null
let frame = 0
let unmounted = false
let contextLost = false
let restoreTimer: ReturnType<typeof setTimeout> | undefined
let restoreBudgetMs = 0
let restoreWaitStartedAt = 0

// How long to wait, while the page is visible, for the browser to hand back a
// lost WebGL context before giving up and showing the gradient hero instead.
const RESTORE_TIMEOUT_MS = 5000

function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl')
    // Release the probe context right away so it does not count against the browser's limit.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return Boolean(gl)
  } catch {
    return false
  }
}

function render(now: number) {
  frame = 0
  try {
    scene?.update(props.chapter, props.progress, now / 1000, pointer)
  } catch (error) {
    console.warn('[journey] 3D scene disabled:', error)
    teardown()
    emit('unavailable')
    return
  }
  if (scene && !contextLost && !document.hidden) frame = requestAnimationFrame(render)
}

function start() {
  if (scene && !frame && !contextLost && !document.hidden) frame = requestAnimationFrame(render)
}

function stop() {
  cancelAnimationFrame(frame)
  frame = 0
}

function onResize() {
  scene?.resize(window.innerWidth, window.innerHeight)
}

function onVisibility() {
  if (document.hidden) {
    stop()
    pauseRestoreWait()
  } else if (contextLost) {
    waitForRestore()
  } else {
    start()
  }
}

function onPointer(event: PointerEvent) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -((event.clientY / window.innerHeight) * 2 - 1)
}

function teardown() {
  stop()
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointermove', onPointer)
  document.removeEventListener('visibilitychange', onVisibility)
  canvas.value?.removeEventListener('webglcontextlost', onContextLost)
  canvas.value?.removeEventListener('webglcontextrestored', onContextRestored)
  clearTimeout(restoreTimer)
  scene?.dispose()
  scene = null
  active.value = false
}

// Counts down whatever is left of the restore budget. Paired with
// pauseRestoreWait so only visible time counts toward the timeout.
function waitForRestore() {
  clearTimeout(restoreTimer)
  restoreWaitStartedAt = performance.now()
  restoreTimer = setTimeout(() => {
    teardown()
    emit('unavailable')
  }, restoreBudgetMs)
}

function pauseRestoreWait() {
  if (restoreTimer === undefined) return
  clearTimeout(restoreTimer)
  restoreTimer = undefined
  restoreBudgetMs = Math.max(0, restoreBudgetMs - (performance.now() - restoreWaitStartedAt))
}

// Mobile browsers drop the WebGL context when the page is backgrounded or the
// GPU is under memory pressure, then usually restore it. Pause instead of
// tearing down; preventDefault tells the browser a restore is wanted.
function onContextLost(event: Event) {
  event.preventDefault()
  contextLost = true
  restoreBudgetMs = RESTORE_TIMEOUT_MS
  stop()
  if (!document.hidden) waitForRestore()
}

// three.js rebuilds its GL state on this event (its listener runs before ours)
// and re-uploads geometry and textures on the next render, so just resume.
// Known trade-off: three.js leaves its old managers' dispose listeners on each
// mesh, so every restore leaks a little bookkeeping. Restores happen a few
// times per visit at most, so this is cheaper than rebuilding the scene.
function onContextRestored() {
  contextLost = false
  clearTimeout(restoreTimer)
  restoreTimer = undefined
  start()
}

onMounted(async () => {
  // Not a .client component on purpose: the canvas is in the server HTML, so the
  // ref is set before onMounted runs. A .client component renders a placeholder
  // first and swaps in the canvas on a later render, which raced this hook on iOS.
  const tierInput = {
    webgl: hasWebGL(),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    width: window.innerWidth,
  }
  const tier = pickTier(tierInput)

  if (tier === 'none') {
    emit('unavailable')
    return
  }

  if (!canvas.value) {
    console.warn('[journey] canvas ref missing')
    emit('unavailable')
    return
  }

  try {
    const { createJourneyScene } = await import('~/journey/scene')
    if (unmounted) return
    scene = createJourneyScene(canvas.value, tier, props.projectItems, { lowPower: lowPowerFor(tierInput) })
  } catch (error) {
    console.warn('[journey] 3D scene disabled:', error)
    teardown()
    emit('unavailable')
    return
  }

  active.value = true
  onResize()
  scene.setTheme(props.isDark)
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  if (tier === 'full') window.addEventListener('pointermove', onPointer, { passive: true })
  canvas.value.addEventListener('webglcontextlost', onContextLost)
  canvas.value.addEventListener('webglcontextrestored', onContextRestored)
  start()
})

watch(() => props.isDark, isDark => scene?.setTheme(isDark))

onBeforeUnmount(() => {
  unmounted = true
  teardown()
})
</script>

<template>
  <canvas
    v-show="active"
    ref="canvas"
    class="fixed inset-0 z-0 h-full w-full pointer-events-none"
    aria-hidden="true"
  />
</template>
