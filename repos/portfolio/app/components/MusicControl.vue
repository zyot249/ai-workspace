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
const panelId = 'music-panel'
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
    class="fixed z-20 right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex flex-row-reverse items-center gap-2"
    @mouseenter="openPanel"
    @mouseleave="closePanel"
    @focusin="openPanel"
    @focusout="onFocusOut"
    @keydown.esc="closePanel"
  >
    <button
      type="button"
      :aria-label="label"
      :aria-pressed="playing"
      :aria-expanded="panelVisible"
      :aria-controls="panelVisible ? panelId : undefined"
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

    <div
      v-if="panelVisible && current"
      :id="panelId"
      data-music-panel
      class="rounded-2xl p-3 max-w-[16rem] bg-white/75 dark:bg-neutral-950/60 backdrop-blur border border-neutral-200/70 dark:border-white/10 shadow-sm text-sm"
    >
      <p class="font-semibold">{{ current.title }}</p>
      <p class="text-neutral-600 dark:text-neutral-400">{{ current.artist }}</p>
      <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{{ current.credit }}</p>
      <button
        v-if="playing"
        type="button"
        class="mt-2 rounded px-2 py-1 border border-neutral-300 dark:border-neutral-700"
        @click="next"
      >
        Next track
      </button>
    </div>

    <span class="sr-only" aria-live="polite">{{ announcement }}</span>
  </div>
</template>
