import { describe, expect, it } from 'vitest'
import {
  clearLatencyOffsetMs,
  DEFAULT_LATENCY_OFFSET_STORAGE_KEY,
  loadLatencyOffsetMs,
  saveLatencyOffsetMs,
} from './latency-offset-storage'

interface TestStorageOptions {
  throwOnGet?: boolean
  throwOnSet?: boolean
  throwOnRemove?: boolean
}

class TestStorage implements Storage {
  private readonly data = new Map<string, string>()
  private readonly options: TestStorageOptions

  public constructor(initial: Record<string, string> = {}, options: TestStorageOptions = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.data.set(key, value)
    }
    this.options = options
  }

  public get length(): number {
    return this.data.size
  }

  public clear(): void {
    this.data.clear()
  }

  public getItem(key: string): string | null {
    if (this.options.throwOnGet) {
      throw new Error('getItem failed')
    }
    return this.data.get(key) ?? null
  }

  public key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null
  }

  public removeItem(key: string): void {
    if (this.options.throwOnRemove) {
      throw new Error('removeItem failed')
    }
    this.data.delete(key)
  }

  public setItem(key: string, value: string): void {
    if (this.options.throwOnSet) {
      throw new Error('setItem failed')
    }
    this.data.set(key, value)
  }
}

describe('loadLatencyOffsetMs', () => {
  it('returns fallback when storage is unavailable', () => {
    expect(loadLatencyOffsetMs({ fallbackMs: 12 })).toBe(12)
  })

  it('loads numeric value from storage and defaults on invalid values', () => {
    const validStorage = new TestStorage({
      [DEFAULT_LATENCY_OFFSET_STORAGE_KEY]: '24.5',
    })
    expect(loadLatencyOffsetMs({ storage: validStorage })).toBe(24.5)

    const invalidStorage = new TestStorage({
      [DEFAULT_LATENCY_OFFSET_STORAGE_KEY]: 'invalid',
    })
    expect(loadLatencyOffsetMs({ storage: invalidStorage, fallbackMs: 7 })).toBe(7)
  })

  it('returns fallback when storage access throws', () => {
    const storage = new TestStorage({}, { throwOnGet: true })
    expect(loadLatencyOffsetMs({ storage, fallbackMs: -3 })).toBe(-3)
  })

  it('throws when fallback or key are invalid', () => {
    expect(() => loadLatencyOffsetMs({ fallbackMs: Number.NaN })).toThrow(
      'fallbackMs must be a finite number.',
    )
    expect(() => loadLatencyOffsetMs({ key: '   ', storage: new TestStorage() })).toThrow(
      'storage key must not be empty.',
    )
  })
})

describe('saveLatencyOffsetMs', () => {
  it('saves offset to storage and returns true', () => {
    const storage = new TestStorage()

    const saved = saveLatencyOffsetMs(18, { storage, key: 'latency.custom' })
    expect(saved).toBe(true)
    expect(storage.getItem('latency.custom')).toBe('18')
  })

  it('returns false when storage is unavailable or write fails', () => {
    expect(saveLatencyOffsetMs(10)).toBe(false)

    const failingStorage = new TestStorage({}, { throwOnSet: true })
    expect(saveLatencyOffsetMs(10, { storage: failingStorage })).toBe(false)
  })

  it('throws when offset or key are invalid', () => {
    expect(() => saveLatencyOffsetMs(Number.POSITIVE_INFINITY, { storage: new TestStorage() })).toThrow(
      'offsetMs must be a finite number.',
    )
    expect(() => saveLatencyOffsetMs(1, { key: ' ', storage: new TestStorage() })).toThrow(
      'storage key must not be empty.',
    )
  })
})

describe('clearLatencyOffsetMs', () => {
  it('removes stored offset and returns true', () => {
    const storage = new TestStorage({
      [DEFAULT_LATENCY_OFFSET_STORAGE_KEY]: '30',
    })

    const cleared = clearLatencyOffsetMs({ storage })
    expect(cleared).toBe(true)
    expect(storage.getItem(DEFAULT_LATENCY_OFFSET_STORAGE_KEY)).toBeNull()
  })

  it('returns false when storage is unavailable or remove fails', () => {
    expect(clearLatencyOffsetMs()).toBe(false)

    const failingStorage = new TestStorage({}, { throwOnRemove: true })
    expect(clearLatencyOffsetMs({ storage: failingStorage })).toBe(false)
  })

  it('throws when key is empty', () => {
    expect(() => clearLatencyOffsetMs({ key: ' ', storage: new TestStorage() })).toThrow(
      'storage key must not be empty.',
    )
  })
})
