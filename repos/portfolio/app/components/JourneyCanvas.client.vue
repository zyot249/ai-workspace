<script setup lang="ts">
import type { JourneyScene, Pointer } from '~/journey/scene'
import { pickTier } from '~/journey/tier'

const props = defineProps<{
  chapter: number
  progress: number
  isDark: boolean
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
  scene?.update(props.chapter, props.progress, now / 1000, pointer)
  frame = requestAnimationFrame(render)
}

function start() {
  if (scene && !frame && !document.hidden) frame = requestAnimationFrame(render)
}

function stop() {
  cancelAnimationFrame(frame)
  frame = 0
}

function onResize() {
  scene?.resize(window.innerWidth, window.innerHeight)
}

function onVisibility() {
  if (document.hidden) stop()
  else start()
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
  scene?.dispose()
  scene = null
  active.value = false
}

function onContextLost(event: Event) {
  event.preventDefault()
  teardown()
  emit('unavailable')
}

onMounted(async () => {
  // .client components render only after mounting; wait a tick so `canvas` is populated.
  await nextTick()
  if (unmounted) return

  const tier = pickTier({
    webgl: hasWebGL(),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    width: window.innerWidth,
  })

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
    scene = createJourneyScene(canvas.value, tier)
  } catch (error) {
    console.warn('[journey] 3D scene disabled:', error)
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
