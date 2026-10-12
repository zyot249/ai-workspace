// The part of a model owner (traffic, people) that the swap drives. Kept structural so tests pass fakes.
export interface ModelSwapTarget<TModels> {
  stageModels(models: TModels): void
  showModels(): void
  discardModels(): void
}

export interface AttachModelsOptions<TModels> {
  target: ModelSwapTarget<TModels>
  load: () => Promise<TModels>
  disposeModels: (models: TModels) => void
  isDisposed: () => boolean
  // Runs after the models are staged (hidden) and before they show. The scene compiles their shaders here.
  warm?: () => Promise<void>
  onReady?: () => void
  // Called at most once, and never after the scene is disposed.
  onError?: (error: unknown) => void
}

// Never rejects. A failed load, a rejected stage, or a failed warmup leaves the scene as it was. After the
// scene is disposed it reports nothing and shows nothing.
export async function attachModels<TModels>(options: AttachModelsOptions<TModels>): Promise<void> {
  const { target, load, disposeModels, isDisposed, warm, onReady, onError } = options
  const report = (error: unknown) => { if (!isDisposed()) onError?.(error) }
  let models: TModels
  try {
    models = await load()
  } catch (error) {
    report(error)
    return
  }
  if (isDisposed()) {
    disposeModels(models)
    return
  }
  try {
    target.stageModels(models)
  } catch (error) {
    disposeModels(models)
    report(error)
    return
  }
  // From here the target owns the models: `discardModels` disposes them.
  try {
    await warm?.()
    if (isDisposed()) {
      target.discardModels()
      return
    }
    target.showModels()
  } catch (error) {
    target.discardModels()
    report(error)
    return
  }
  onReady?.()
}
