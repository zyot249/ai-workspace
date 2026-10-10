import { type Ref, ref } from 'vue'

const store = new Map<string, Ref<unknown>>()

/** Stand-in for Nuxt's `useState`: one shared ref per key. */
export function useState<T>(key: string, init: () => T): Ref<T> {
  if (!store.has(key)) store.set(key, ref(init()))
  return store.get(key) as Ref<T>
}

export function resetNuxtState(): void {
  store.clear()
}
