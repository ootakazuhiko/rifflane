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

interface MockCanvasOptions {
  width?: number
  height?: number
  clientWidth?: number
  clientHeight?: number
  context?: CanvasRenderingContext2D | null
}

function createMockContext(
  overrides: Partial<CanvasRenderingContext2D> = {},
): CanvasRenderingContext2D {
  return {
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
    ...overrides,
  } as unknown as CanvasRenderingContext2D
}

function createMockCanvasBundle(options: MockCanvasOptions = {}): {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D | null
} {
  const context = options.context === undefined ? createMockContext() : options.context

  return {
    canvas: {
      width: options.width ?? 320,
      height: options.height ?? 180,
      clientWidth: options.clientWidth ?? 320,
      clientHeight: options.clientHeight ?? 180,
      getContext: (contextId: string) => (contextId === '2d' ? context : null),
    } as unknown as HTMLCanvasElement,
    context,
  }
}

function createMockCanvas(): HTMLCanvasElement {
  return createMockCanvasBundle().canvas
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

  it('validates hitLineRatio range on construction', () => {
    setupEnvironment()

    expect(() =>
      new LaneScroller({
        canvas: createMockCanvas(),
        chart: createChart(),
        hitLineRatio: 0,
      }),
    ).toThrow('hitLineRatio must be a finite number between 0 and 1 (exclusive).')
    expect(() =>
      new LaneScroller({
        canvas: createMockCanvas(),
        chart: createChart(),
        hitLineRatio: 1,
      }),
    ).toThrow('hitLineRatio must be a finite number between 0 and 1 (exclusive).')
    expect(() =>
      new LaneScroller({
        canvas: createMockCanvas(),
        chart: createChart(),
        hitLineRatio: Number.NaN,
      }),
    ).toThrow('hitLineRatio must be a finite number between 0 and 1 (exclusive).')
  })

  it('uses a copy of laneOrder provided via options', () => {
    setupEnvironment()
    const fillText = vi.fn()
    const { canvas } = createMockCanvasBundle({
      context: createMockContext({ fillText }),
    })
    const laneOrder: LaneName[] = ['G', 'D', 'A', 'E']

    const scroller = new LaneScroller({ canvas, chart: createChart(), laneOrder })

    laneOrder.splice(0, laneOrder.length, 'E', 'A', 'D', 'G')
    fillText.mockClear()
    scroller.renderNow()

    const laneLabels = fillText.mock.calls.slice(0, 4).map(([text]) => text)
    expect(laneLabels).toEqual(['G', 'D', 'A', 'E'])
  })

  it('validates chart note fields on setChart', () => {
    setupEnvironment()
    const scroller = new LaneScroller({ canvas: createMockCanvas(), chart: createChart() })

    expect(() =>
      scroller.setChart({
        loopDurationMs: 1000,
        notes: [{ lane: 'X' as unknown as LaneName, timeMs: 0, durationMs: 120 }],
      }),
    ).toThrow('Unknown lane in chart: X')

    expect(() =>
      scroller.setChart({
        loopDurationMs: 1000,
        notes: [{ lane: 'E', timeMs: Number.NaN, durationMs: 120 }],
      }),
    ).toThrow('Chart note timeMs must be finite.')

    expect(() =>
      scroller.setChart({
        loopDurationMs: 1000,
        notes: [{ lane: 'E', timeMs: 0, durationMs: -1 }],
      }),
    ).toThrow('Chart note durationMs must be finite and >= 0.')
  })

  it('throws when 2D context is unavailable', () => {
    setupEnvironment()
    const { canvas } = createMockCanvasBundle({ context: null })

    expect(() => new LaneScroller({ canvas, chart: createChart() })).toThrow(
      '2D canvas context is required.',
    )
  })

  it('uses dummy chart when chart option is omitted', () => {
    setupEnvironment()
    const scroller = new LaneScroller({ canvas: createMockCanvas() })

    scroller.setPlayheadMs(2500)

    expect(scroller.getPlayheadMs()).toBe(100)
  })

  it('calls setTransform when device pixel ratio changes backing canvas size', () => {
    const { windowMock } = setupEnvironment()
    windowMock.devicePixelRatio = 2

    const setTransform = vi.fn()
    const { canvas } = createMockCanvasBundle({
      context: createMockContext({ setTransform }),
    })
    new LaneScroller({ canvas, chart: createChart() })

    expect(setTransform).toHaveBeenCalledTimes(1)
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(360)
  })

  it('stops and cancels pending animation frame when disposed', () => {
    const { windowMock, setNowMs } = setupEnvironment()
    const scroller = new LaneScroller({ canvas: createMockCanvas(), chart: createChart() })

    setNowMs(0)
    scroller.start()
    expect(scroller.isRunning()).toBe(true)
    expect(windowMock.queuedFrameCount).toBe(1)

    scroller.dispose()
    expect(scroller.isRunning()).toBe(false)
    expect(windowMock.cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(windowMock.queuedFrameCount).toBe(0)

    scroller.dispose()
    expect(windowMock.cancelAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('does not cancel animation frame when stop is called with null frame id', () => {
    const { windowMock, setNowMs } = setupEnvironment()
    const scroller = new LaneScroller({ canvas: createMockCanvas(), chart: createChart() })
    const internalScroller = scroller as unknown as { animationFrameId: number | null }

    setNowMs(0)
    scroller.start()
    internalScroller.animationFrameId = null
    windowMock.cancelAnimationFrame.mockClear()

    scroller.stop()

    expect(scroller.isRunning()).toBe(false)
    expect(windowMock.cancelAnimationFrame).not.toHaveBeenCalled()
  })

  it('draws one frame when renderNow is called', () => {
    setupEnvironment()
    const clearRect = vi.fn()
    const { canvas } = createMockCanvasBundle({
      context: createMockContext({ clearRect }),
    })
    const scroller = new LaneScroller({ canvas, chart: createChart() })

    clearRect.mockClear()
    scroller.renderNow()

    expect(clearRect).toHaveBeenCalledTimes(1)
  })

  it('returns early in onAnimationFrame when not running', () => {
    const { windowMock } = setupEnvironment()
    const clearRect = vi.fn()
    const { canvas } = createMockCanvasBundle({
      context: createMockContext({ clearRect }),
    })
    const scroller = new LaneScroller({ canvas, chart: createChart() })
    const internalScroller = scroller as unknown as { onAnimationFrame: () => void }

    clearRect.mockClear()
    internalScroller.onAnimationFrame()

    expect(clearRect).not.toHaveBeenCalled()
    expect(windowMock.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('skips chart notes with unknown lanes defensively during draw', () => {
    setupEnvironment()
    const quadraticCurveTo = vi.fn()
    const fillText = vi.fn()
    const { canvas } = createMockCanvasBundle({
      context: createMockContext({ quadraticCurveTo, fillText }),
    })
    const scroller = new LaneScroller({
      canvas,
      chart: { loopDurationMs: 1000, notes: [] },
    })
    const internalScroller = scroller as unknown as { chart: LaneScrollerChart }

    internalScroller.chart = {
      loopDurationMs: 1000,
      notes: [{ lane: 'X' as unknown as LaneName, timeMs: 0, durationMs: 120, fret: 9 }],
    }

    quadraticCurveTo.mockClear()
    fillText.mockClear()
    expect(() => scroller.renderNow()).not.toThrow()
    expect(quadraticCurveTo).not.toHaveBeenCalled()

    const renderedTexts = fillText.mock.calls.map(([text]) => text)
    expect(renderedTexts).not.toContain('9')
  })

  it('uses syncCanvasSize fallback values when client size and dpr are zero', () => {
    const { windowMock } = setupEnvironment()
    windowMock.devicePixelRatio = 0

    const clearRect = vi.fn()
    const setTransform = vi.fn()
    const { canvas } = createMockCanvasBundle({
      width: 250.6,
      height: 140.4,
      clientWidth: 0,
      clientHeight: 0,
      context: createMockContext({ clearRect, setTransform }),
    })
    new LaneScroller({ canvas, chart: createChart() })

    expect(canvas.width).toBe(250)
    expect(canvas.height).toBe(140)
    expect(setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
    expect(clearRect).toHaveBeenCalledWith(0, 0, 250, 140)
  })

  it('does not draw fret text when note fret is not a number', () => {
    setupEnvironment()
    const fillText = vi.fn()
    const { canvas } = createMockCanvasBundle({
      context: createMockContext({ fillText }),
    })
    const chart = {
      loopDurationMs: 1000,
      notes: [{ lane: 'E', timeMs: 0, durationMs: 120, fret: 'x' }],
    } as unknown as LaneScrollerChart
    const scroller = new LaneScroller({ canvas, chart })

    fillText.mockClear()
    scroller.renderNow()

    const renderedTexts = fillText.mock.calls.map(([text]) => text)
    expect(renderedTexts).not.toContain('x')
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

  it('does not emit fps sample after callback is cleared with undefined', () => {
    const { windowMock, setNowMs } = setupEnvironment()
    const onFpsSample = vi.fn()
    const scroller = new LaneScroller({
      canvas: createMockCanvas(),
      chart: createChart(),
      fpsSampleWindowMs: 10,
      onFpsSample,
    })

    scroller.setFpsSampleCallback(undefined)

    setNowMs(0)
    scroller.start()

    setNowMs(6)
    expect(windowMock.runNextFrame(6)).toBe(true)
    setNowMs(12)
    expect(windowMock.runNextFrame(12)).toBe(true)
    setNowMs(24)
    expect(windowMock.runNextFrame(24)).toBe(true)

    expect(onFpsSample).not.toHaveBeenCalled()

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
