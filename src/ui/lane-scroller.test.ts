import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDummyLaneScrollerChart,
  LaneScroller,
  type LaneName,
  type LaneScrollerChart,
  type LaneScrollerFpsSample,
} from './lane-scroller'

type RafCallback = (timestampMs: number) => void

class MockWindow {
  public devicePixelRatio = 1
  private nextFrameId = 1
  private readonly callbacks = new Map<number, RafCallback>()

  public readonly requestAnimationFrame = vi.fn((callback: RafCallback): number => {
    const id = this.nextFrameId
    this.nextFrameId += 1
    this.callbacks.set(id, callback)
    return id
  })

  public readonly cancelAnimationFrame = vi.fn((id: number): void => {
    this.callbacks.delete(id)
  })

  public runNextFrame(timestampMs: number): boolean {
    const next = this.callbacks.entries().next()
    if (next.done) {
      return false
    }

    const [id, callback] = next.value
    this.callbacks.delete(id)
    callback(timestampMs)
    return true
  }

  public get queuedFrameCount(): number {
    return this.callbacks.size
  }
}

function noop(): void {}

function createMockCanvas(): HTMLCanvasElement {
  const context = {
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fillText: noop,
    setTransform: noop,
    quadraticCurveTo: noop,
    closePath: noop,
    fill: noop,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D

  return {
    width: 320,
    height: 180,
    clientWidth: 320,
    clientHeight: 180,
    getContext: (contextId: string) => (contextId === '2d' ? context : null),
  } as unknown as HTMLCanvasElement
}

function setupEnvironment(): { windowMock: MockWindow; setNowMs: (nextNowMs: number) => void } {
  const windowMock = new MockWindow()
  vi.stubGlobal('window', windowMock as unknown as Window & typeof globalThis)

  let nowMs = 0
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs)

  return {
    windowMock,
    setNowMs: (nextNowMs: number) => {
      nowMs = nextNowMs
    },
  }
}

function createChart(loopDurationMs = 1000): LaneScrollerChart {
  return {
    loopDurationMs,
    notes: [{ lane: 'E', timeMs: 100, durationMs: 120, fret: 0 }],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createDummyLaneScrollerChart', () => {
  it('returns deterministic chart data', () => {
    const chart = createDummyLaneScrollerChart()

    expect(chart.loopDurationMs).toBe(2400)
    expect(chart.notes).toHaveLength(8)
    expect(chart.notes[0]).toEqual({ lane: 'E', fret: 0, timeMs: 0, durationMs: 320 })
    expect(chart.notes[7]).toEqual({ lane: 'E', fret: 3, timeMs: 2100, durationMs: 260 })
    expect(chart.notes.map((note) => note.timeMs)).toEqual([0, 300, 600, 900, 1200, 1500, 1800, 2100])
  })
})

describe('LaneScroller', () => {
  it('toggles running state with start/stop and avoids duplicate start', () => {
    const { windowMock, setNowMs } = setupEnvironment()
    const scroller = new LaneScroller({ canvas: createMockCanvas(), chart: createChart() })

    expect(scroller.isRunning()).toBe(false)

    setNowMs(1000)
    scroller.start()
    expect(scroller.isRunning()).toBe(true)
    expect(windowMock.requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(windowMock.queuedFrameCount).toBe(1)

    scroller.start()
    expect(windowMock.requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(windowMock.queuedFrameCount).toBe(1)

    setNowMs(1016)
    expect(windowMock.runNextFrame(1016)).toBe(true)
    expect(windowMock.queuedFrameCount).toBe(1)

    scroller.stop()
    expect(scroller.isRunning()).toBe(false)
    expect(windowMock.cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(windowMock.queuedFrameCount).toBe(0)

    scroller.stop()
    expect(windowMock.cancelAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('wraps playhead value by loop duration', () => {
    setupEnvironment()
    const scroller = new LaneScroller({ canvas: createMockCanvas(), chart: createChart() })

    scroller.setPlayheadMs(2500)
    expect(scroller.getPlayheadMs()).toBe(500)

    scroller.setPlayheadMs(-220)
    expect(scroller.getPlayheadMs()).toBe(780)

    expect(() => scroller.setPlayheadMs(Number.NaN)).toThrow('playheadMs must be finite.')
  })

  it('validates speedMultiplier on update', () => {
    setupEnvironment()
    const scroller = new LaneScroller({ canvas: createMockCanvas(), chart: createChart() })

    scroller.setSpeedMultiplier(1.75)
    expect(scroller.getSpeedMultiplier()).toBe(1.75)

    expect(() => scroller.setSpeedMultiplier(0)).toThrow(
      'speedMultiplier must be a finite positive number.',
    )
    expect(() => scroller.setSpeedMultiplier(-1)).toThrow(
      'speedMultiplier must be a finite positive number.',
    )
    expect(() => scroller.setSpeedMultiplier(Number.POSITIVE_INFINITY)).toThrow(
      'speedMultiplier must be a finite positive number.',
    )
  })

  it('validates laneOrder shape and values', () => {
    setupEnvironment()

    expect(() =>
      new LaneScroller({
        canvas: createMockCanvas(),
        chart: createChart(),
        laneOrder: ['E', 'A', 'D'],
      }),
    ).toThrow('laneOrder must include exactly four lanes: E/A/D/G.')

    expect(() =>
      new LaneScroller({
        canvas: createMockCanvas(),
        chart: createChart(),
        laneOrder: ['E', 'A', 'D', 'D'],
      }),
    ).toThrow('laneOrder includes duplicate lane: D')

    const unsupportedLaneOrder = ['E', 'A', 'D', 'X'] as unknown as readonly LaneName[]
    expect(() =>
      new LaneScroller({
        canvas: createMockCanvas(),
        chart: createChart(),
        laneOrder: unsupportedLaneOrder,
      }),
    ).toThrow('Unsupported lane name: X')
  })

  it('emits fps samples when elapsed time reaches sample window', () => {
    const { windowMock, setNowMs } = setupEnvironment()
    const samples: LaneScrollerFpsSample[] = []

    const scroller = new LaneScroller({
      canvas: createMockCanvas(),
      chart: createChart(),
      fpsSampleWindowMs: 10,
      onFpsSample: (sample) => {
        samples.push(sample)
      },
    })

    setNowMs(0)
    scroller.start()

    setNowMs(4)
    expect(windowMock.runNextFrame(4)).toBe(true)
    expect(samples).toHaveLength(0)

    setNowMs(12)
    expect(windowMock.runNextFrame(12)).toBe(true)
    expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({
      timestampMs: 12,
      frameCount: 2,
      elapsedMs: 12,
    })
    expect(samples[0].fps).toBeCloseTo((2 / 12) * 1000, 8)

    scroller.stop()
  })

  it('rewraps playhead when chart loop duration changes via setChart', () => {
    setupEnvironment()
    const scroller = new LaneScroller({ canvas: createMockCanvas(), chart: createChart(2000) })

    scroller.setPlayheadMs(1500)
    expect(scroller.getPlayheadMs()).toBe(1500)

    scroller.setChart({
      loopDurationMs: 1000,
      notes: [{ lane: 'E', timeMs: 0, durationMs: 120, fret: 0 }],
    })
    expect(scroller.getPlayheadMs()).toBe(500)
  })
})
