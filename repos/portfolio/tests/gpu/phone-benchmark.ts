import type * as THREE from 'three'
import { createJourneyScene } from '../../app/journey/scene'
import { measureRenderCost, type RenderCost } from './render-cost'

declare global {
  interface Window {
    __cityGpuRendererObserver?: (renderer: THREE.WebGLRenderer) => void
    __phoneRenderer?: THREE.WebGLRenderer
  }
}

const run = document.querySelector<HTMLButtonElement>('#run')!
const copy = document.querySelector<HTMLButtonElement>('#copy')!
const status = document.querySelector<HTMLElement>('#status')!
const results = document.querySelector<HTMLTextAreaElement>('#results')!
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const revision = document.body.dataset.revision ?? 'unknown'
const params = new URLSearchParams(location.search)
const durationMs = Math.max(1, Number(params.get('durationMs')) || 10_000)
const repeats = Math.max(1, Number(params.get('repeats')) || 3)

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function publish(value: unknown) {
  const json = JSON.stringify(value, null, 2)
  results.value = json
  localStorage.setItem(`city01-phone-${revision}`, json)
}

results.value = localStorage.getItem(`city01-phone-${revision}`) ?? ''
copy.addEventListener('click', () => { results.focus(); results.select() })
run.addEventListener('click', async () => {
  run.disabled = true
  const width = window.innerWidth
  const height = window.innerHeight
  let journey: ReturnType<typeof createJourneyScene> | null = null
  try {
    status.textContent = 'Creating lite scene…'
    await new Promise(requestAnimationFrame)
    window.__phoneRenderer = undefined
    window.__cityGpuRendererObserver = renderer => { window.__phoneRenderer = renderer }
    journey = createJourneyScene(canvas, 'lite', [{ title: 'GPU test exhibit', date: '2026-10' }])
    const renderer = window.__phoneRenderer
    if (!renderer) throw new Error('Renderer observer did not run')
    journey.resize(width, height)
    journey.setTheme(false)
    const gl = renderer.getContext()
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const output: {
      revision: string; userAgent: string; renderer: string; drawingBuffer: number[]
      devicePixelRatio: number; durationMs: number; repeats: number
      chapters: Record<string, { runs: RenderCost[]; medianMeanMs: number; medianP95Ms: number }>
    } = {
      revision, userAgent: navigator.userAgent,
      renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      devicePixelRatio: window.devicePixelRatio, durationMs, repeats, chapters: {},
    }
    for (const chapter of [0, 2, 3]) {
      const update = () => journey!.update(chapter, 0, 0, { x: 0, y: 0 })
      for (let i = 0; i < 240; i++) update()
      const runs: RenderCost[] = []
      for (let repetition = 0; repetition < repeats; repetition++) {
        status.textContent = `Chapter ${chapter}, run ${repetition + 1}/${repeats} (${durationMs / 1000} s)…`
        await new Promise(requestAnimationFrame)
        runs.push(await measureRenderCost(renderer, update, durationMs))
      }
      output.chapters[String(chapter)] = {
        runs,
        medianMeanMs: median(runs.map(item => item.meanMs)),
        medianP95Ms: median(runs.map(item => item.p95Ms)),
      }
      publish(output)
    }
    status.textContent = 'Complete. Select and send the results text.'
  } catch (error) {
    status.textContent = `Failed: ${String(error)}`
  } finally {
    journey?.dispose()
    window.__cityGpuRendererObserver = undefined
    window.__phoneRenderer = undefined
    run.disabled = false
  }
})
