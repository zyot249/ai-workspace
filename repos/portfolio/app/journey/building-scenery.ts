// app/journey/building-scenery.ts
import { type BuildingModels, disposeBuildingModels } from './building-models'
import type { ModelSwapTarget } from './model-swap'

// One piece of the building scenery (the set-pieces, the near layer). It owns the meshes and geometry it
// builds, not the models it builds them from.
export interface SceneryPart {
  stage(models: BuildingModels): void
  show(): void
  // Removes and disposes what `stage` built. Safe to call before `stage` or twice.
  release(): void
}

export interface BuildingScenery extends ModelSwapTarget<BuildingModels> {
  dispose(): void
}

export function createBuildingScenery(parts: readonly SceneryPart[]): BuildingScenery {
  let owned: BuildingModels | null = null
  let offered = false
  let disposed = false

  function releaseAll(): void {
    for (const part of parts) part.release()
    if (owned) disposeBuildingModels(owned)
    owned = null
  }

  return {
    stageModels(models) {
      if (disposed || offered) return
      offered = true
      const staged: SceneryPart[] = []
      try {
        for (const part of parts) {
          staged.push(part)
          part.stage(models)
        }
      } catch (error) {
        // The caller disposes the models when staging throws, so release only the parts.
        for (const part of staged) part.release()
        throw error
      }
      owned = models
    },
    showModels() {
      if (disposed || !owned) return
      for (const part of parts) part.show()
    },
    discardModels() {
      if (disposed || !owned) return
      releaseAll()
    },
    dispose() {
      if (disposed) return
      disposed = true
      releaseAll()
    },
  }
}
