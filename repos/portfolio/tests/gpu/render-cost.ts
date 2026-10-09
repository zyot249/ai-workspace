import type * as THREE from 'three'
import { getShaderErrorRecorder } from '../../app/journey/shader-utils'

export interface RenderCost {
  meanMs: number
  medianMs: number
  p95Ms: number
  samples: number
  gpuMeanMs: number | null
  gpuP95Ms: number | null
  disjoint: boolean
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export async function measureRenderCost(
  renderer: THREE.WebGLRenderer,
  update: () => void,
  durationMs = 10_000,
): Promise<RenderCost> {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const syncPixel = new Uint8Array(4)
  const samples: number[] = []
  const gpuSamples: number[] = []
  const pending: WebGLQuery[] = []
  let disjoint = false

  function collectQueries() {
    if (!ext) return
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint = true
    for (let i = pending.length - 1; i >= 0; i--) {
      const query = pending[i]!
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number
      if (!disjoint) gpuSamples.push(nanoseconds / 1e6)
      gl.deleteQuery(query)
      pending.splice(i, 1)
    }
  }

  try {
    const started = performance.now()
    while (samples.length === 0 || performance.now() - started < Math.max(1, durationMs)) {
      collectQueries()
      const query = ext && pending.length < 64 ? gl.createQuery() : null
      if (query && ext) gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
      const before = performance.now()
      try {
        update()
      } finally {
        if (query && ext) {
          gl.endQuery(ext.TIME_ELAPSED_EXT)
          pending.push(query)
        }
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel)
      samples.push(performance.now() - before)
    }

    const queryDeadline = performance.now() + 2000
    while (pending.length && performance.now() < queryDeadline) {
      collectQueries()
      if (pending.length) await new Promise(resolve => setTimeout(resolve, 16))
    }
    if (ext && gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint = true
    getShaderErrorRecorder(renderer)?.assertClean()
    const glError = gl.getError()
    if (glError !== gl.NO_ERROR) throw new Error(`[journey] WebGL benchmark error: ${glError}`)

    const sorted = [...samples].sort((a, b) => a - b)
    const sortedGpu = [...gpuSamples].sort((a, b) => a - b)
    return {
      meanMs: mean(samples), medianMs: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95),
      samples: samples.length,
      gpuMeanMs: !disjoint && sortedGpu.length ? mean(gpuSamples) : null,
      gpuP95Ms: !disjoint && sortedGpu.length ? percentile(sortedGpu, 0.95) : null,
      disjoint,
    }
  } finally {
    for (const query of pending) gl.deleteQuery(query)
  }
}
