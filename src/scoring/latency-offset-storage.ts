const DEFAULT_FALLBACK_OFFSET_MS = 0

export const DEFAULT_LATENCY_OFFSET_STORAGE_KEY = 'rifflane.latencyOffsetMs'

export interface LatencyOffsetStorageOptions {
  key?: string
  storage?: Storage | null
}

export interface LoadLatencyOffsetOptions extends LatencyOffsetStorageOptions {
  fallbackMs?: number
}

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

function normalizeStorageKey(key: string): string {
  if (key.trim().length === 0) {
    throw new Error('storage key must not be empty.')
  }
  return key
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) {
    return storage
  }

  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadLatencyOffsetMs(options: LoadLatencyOffsetOptions = {}): number {
  const storage = resolveStorage(options.storage)
  const key = normalizeStorageKey(options.key ?? DEFAULT_LATENCY_OFFSET_STORAGE_KEY)
  const fallbackMs = assertFiniteNumber(options.fallbackMs ?? DEFAULT_FALLBACK_OFFSET_MS, 'fallbackMs')

  if (!storage) {
    return fallbackMs
  }

  try {
    const rawValue = storage.getItem(key)
    if (rawValue === null) {
      return fallbackMs
    }

    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) ? parsedValue : fallbackMs
  } catch {
    return fallbackMs
  }
}

export function saveLatencyOffsetMs(offsetMs: number, options: LatencyOffsetStorageOptions = {}): boolean {
  const storage = resolveStorage(options.storage)
  const key = normalizeStorageKey(options.key ?? DEFAULT_LATENCY_OFFSET_STORAGE_KEY)
  const normalizedOffsetMs = assertFiniteNumber(offsetMs, 'offsetMs')
  if (!storage) {
    return false
  }

  try {
    storage.setItem(key, String(normalizedOffsetMs))
    return true
  } catch {
    return false
  }
}

export function clearLatencyOffsetMs(options: LatencyOffsetStorageOptions = {}): boolean {
  const storage = resolveStorage(options.storage)
  const key = normalizeStorageKey(options.key ?? DEFAULT_LATENCY_OFFSET_STORAGE_KEY)
  if (!storage) {
    return false
  }

  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
