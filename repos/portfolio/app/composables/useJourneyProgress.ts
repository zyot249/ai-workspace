import { computeProgress } from '~/journey/progress'

export function useJourneyProgress(selector = '[data-chapter]') {
  const chapter = ref(0)
  const progress = ref(0)
  let frame = 0

  function measure() {
    frame = 0
    const rects = Array.from(document.querySelectorAll<HTMLElement>(selector), (el) => {
      const { top, height } = el.getBoundingClientRect()
      return { top, height }
    })
    const result = computeProgress(rects)
    chapter.value = result.chapter
    progress.value = result.progress
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    cancelAnimationFrame(frame)
  })

  return { chapter: readonly(chapter), progress: readonly(progress) }
}
