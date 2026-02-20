export type LaneName = 'E' | 'A' | 'D' | 'G'

export interface LaneScrollerNote {
  lane: LaneName
  timeMs: number
  durationMs: number
  fret?: number
}

export interface LaneScrollerChart {
  loopDurationMs: number
  notes: LaneScrollerNote[]
}

export interface LaneScrollerFpsSample {
  timestampMs: number
  elapsedMs: number
  frameCount: number
  fps: number
}

export interface LaneScrollerOptions {
  canvas: HTMLCanvasElement
  chart?: LaneScrollerChart
  speedMultiplier?: number
  pixelsPerSecond?: number
  hitLineRatio?: number
  laneOrder?: readonly LaneName[]
  fpsSampleWindowMs?: number
  onFpsSample?: (sample: LaneScrollerFpsSample) => void
}

const DEFAULT_LANE_ORDER = ['E', 'A', 'D', 'G'] as const
const LANE_NAME_SET = new Set<LaneName>(DEFAULT_LANE_ORDER)
const NOTE_COLORS: Record<LaneName, string> = {
  E: '#e76f51',
  A: '#f4a261',
  D: '#2a9d8f',
  G: '#457b9d',
}

function assertFinitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number.`)
  }
  return value
}

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error('hitLineRatio must be a finite number between 0 and 1 (exclusive).')
  }
  return value
}

function wrapTimeMs(timeMs: number, loopDurationMs: number): number {
  const wrapped = timeMs % loopDurationMs
  return wrapped < 0 ? wrapped + loopDurationMs : wrapped
}

function normalizeLaneOrder(laneOrder?: readonly LaneName[]): readonly LaneName[] {
  if (!laneOrder) {
    return DEFAULT_LANE_ORDER
  }

  if (laneOrder.length !== DEFAULT_LANE_ORDER.length) {
    throw new Error('laneOrder must include exactly four lanes: E/A/D/G.')
  }

  const seen = new Set<LaneName>()
  for (const lane of laneOrder) {
    if (!LANE_NAME_SET.has(lane)) {
      throw new Error(`Unsupported lane name: ${lane}`)
    }
    if (seen.has(lane)) {
      throw new Error(`laneOrder includes duplicate lane: ${lane}`)
    }
    seen.add(lane)
  }

  return [...laneOrder]
}

function normalizeChart(chart: LaneScrollerChart, laneOrder: readonly LaneName[]): LaneScrollerChart {
  const loopDurationMs = assertFinitePositive(chart.loopDurationMs, 'loopDurationMs')
  const laneSet = new Set<LaneName>(laneOrder)

  const notes = chart.notes.map((note) => {
    if (!laneSet.has(note.lane)) {
      throw new Error(`Unknown lane in chart: ${note.lane}`)
    }
    if (!Number.isFinite(note.timeMs)) {
      throw new Error('Chart note timeMs must be finite.')
    }
    if (!Number.isFinite(note.durationMs) || note.durationMs < 0) {
      throw new Error('Chart note durationMs must be finite and >= 0.')
    }

    return {
      lane: note.lane,
      timeMs: wrapTimeMs(note.timeMs, loopDurationMs),
      durationMs: note.durationMs,
      fret: note.fret,
    }
  })

  notes.sort((a, b) => a.timeMs - b.timeMs)
  return {
    loopDurationMs,
    notes,
  }
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
  context.closePath()
  context.fill()
}

export function createDummyLaneScrollerChart(): LaneScrollerChart {
  return {
    loopDurationMs: 2400,
    notes: [
      { lane: 'E', fret: 0, timeMs: 0, durationMs: 320 },
      { lane: 'A', fret: 2, timeMs: 300, durationMs: 220 },
      { lane: 'D', fret: 4, timeMs: 600, durationMs: 300 },
      { lane: 'G', fret: 5, timeMs: 900, durationMs: 220 },
      { lane: 'D', fret: 2, timeMs: 1200, durationMs: 480 },
      { lane: 'A', fret: 0, timeMs: 1500, durationMs: 240 },
      { lane: 'G', fret: 7, timeMs: 1800, durationMs: 300 },
      { lane: 'E', fret: 3, timeMs: 2100, durationMs: 260 },
    ],
  }
}

export class LaneScroller {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly laneOrder: readonly LaneName[]
  private readonly laneIndexByName: ReadonlyMap<LaneName, number>
  private readonly hitLineRatio: number
  private readonly pixelsPerSecond: number
  private readonly fpsSampleWindowMs: number

  private chart: LaneScrollerChart
  private speedMultiplier: number
  private onFpsSample: ((sample: LaneScrollerFpsSample) => void) | undefined

  private running = false
  private animationFrameId: number | null = null
  private playheadMs = 0
  private lastFrameNowMs = 0

  private fpsWindowStartedAtMs = 0
  private fpsFrameCount = 0

  private viewportWidth = 0
  private viewportHeight = 0

  public constructor(options: LaneScrollerOptions) {
    const context = options.canvas.getContext('2d')
    if (!context) {
      throw new Error('2D canvas context is required.')
    }

    this.canvas = options.canvas
    this.context = context
    this.laneOrder = normalizeLaneOrder(options.laneOrder)
    this.laneIndexByName = new Map(this.laneOrder.map((lane, index) => [lane, index]))

    this.hitLineRatio = normalizeRatio(options.hitLineRatio ?? 0.8)
    this.pixelsPerSecond = assertFinitePositive(options.pixelsPerSecond ?? 280, 'pixelsPerSecond')
    this.fpsSampleWindowMs = assertFinitePositive(
      options.fpsSampleWindowMs ?? 500,
      'fpsSampleWindowMs',
    )

    this.speedMultiplier = assertFinitePositive(options.speedMultiplier ?? 1, 'speedMultiplier')
    this.onFpsSample = options.onFpsSample
    this.chart = normalizeChart(options.chart ?? createDummyLaneScrollerChart(), this.laneOrder)

    this.syncCanvasSize()
    this.drawFrame()
  }

  public start(): void {
    if (this.running) {
      return
    }

    const nowMs = performance.now()
    this.running = true
    this.lastFrameNowMs = nowMs
    this.fpsWindowStartedAtMs = nowMs
    this.fpsFrameCount = 0
    this.animationFrameId = window.requestAnimationFrame(this.onAnimationFrame)
  }

  public stop(): void {
    if (!this.running) {
      return
    }

    this.running = false
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  public dispose(): void {
    this.stop()
  }

  public isRunning(): boolean {
    return this.running
  }

  public setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = assertFinitePositive(multiplier, 'speedMultiplier')
  }

  public getSpeedMultiplier(): number {
    return this.speedMultiplier
  }

  public setPlayheadMs(timeMs: number): void {
    if (!Number.isFinite(timeMs)) {
      throw new Error('playheadMs must be finite.')
    }
    this.playheadMs = wrapTimeMs(timeMs, this.chart.loopDurationMs)
    this.drawFrame()
  }

  public getPlayheadMs(): number {
    return this.playheadMs
  }

  public setChart(chart: LaneScrollerChart): void {
    this.chart = normalizeChart(chart, this.laneOrder)
    this.playheadMs = wrapTimeMs(this.playheadMs, this.chart.loopDurationMs)
    this.drawFrame()
  }

  public setFpsSampleCallback(callback: ((sample: LaneScrollerFpsSample) => void) | undefined): void {
    this.onFpsSample = callback
  }

  public renderNow(): void {
    this.drawFrame()
  }

  private readonly onAnimationFrame = (): void => {
    if (!this.running) {
      return
    }

    const nowMs = performance.now()
    const elapsedMs = Math.max(0, nowMs - this.lastFrameNowMs)
    this.lastFrameNowMs = nowMs

    this.playheadMs = wrapTimeMs(
      this.playheadMs + elapsedMs * this.speedMultiplier,
      this.chart.loopDurationMs,
    )

    this.drawFrame()
    this.emitFpsSample(nowMs)

    this.animationFrameId = window.requestAnimationFrame(this.onAnimationFrame)
  }

  private emitFpsSample(nowMs: number): void {
    this.fpsFrameCount += 1

    const elapsedMs = nowMs - this.fpsWindowStartedAtMs
    if (elapsedMs < this.fpsSampleWindowMs) {
      return
    }

    const callback = this.onFpsSample
    if (callback) {
      callback({
        timestampMs: nowMs,
        elapsedMs,
        frameCount: this.fpsFrameCount,
        fps: (this.fpsFrameCount / elapsedMs) * 1000,
      })
    }

    this.fpsFrameCount = 0
    this.fpsWindowStartedAtMs = nowMs
  }

  private syncCanvasSize(): void {
    const cssWidth = Math.max(1, Math.floor(this.canvas.clientWidth || this.canvas.width))
    const cssHeight = Math.max(1, Math.floor(this.canvas.clientHeight || this.canvas.height))
    const dpr = Math.max(1, window.devicePixelRatio || 1)

    const pixelWidth = Math.floor(cssWidth * dpr)
    const pixelHeight = Math.floor(cssHeight * dpr)

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth
      this.canvas.height = pixelHeight
      this.context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    this.viewportWidth = cssWidth
    this.viewportHeight = cssHeight
  }

  private drawFrame(): void {
    this.syncCanvasSize()

    const width = this.viewportWidth
    const height = this.viewportHeight
    const laneCount = this.laneOrder.length
    const laneWidth = width / laneCount
    const hitLineY = height * this.hitLineRatio

    this.context.clearRect(0, 0, width, height)

    this.context.fillStyle = '#0f1720'
    this.context.fillRect(0, 0, width, height)

    for (let index = 0; index < laneCount; index += 1) {
      const x = index * laneWidth

      this.context.fillStyle = index % 2 === 0 ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.06)'
      this.context.fillRect(x, 0, laneWidth, height)

      this.context.strokeStyle = 'rgba(255, 255, 255, 0.1)'
      this.context.lineWidth = 1
      this.context.beginPath()
      this.context.moveTo(x + 0.5, 0)
      this.context.lineTo(x + 0.5, height)
      this.context.stroke()

      const laneName = this.laneOrder[index]
      this.context.fillStyle = 'rgba(255, 255, 255, 0.8)'
      this.context.font = '600 13px monospace'
      this.context.textAlign = 'center'
      this.context.textBaseline = 'middle'
      this.context.fillText(laneName, x + laneWidth / 2, 18)
    }

    const pxPerMs = this.pixelsPerSecond / 1000
    const loopDurationMs = this.chart.loopDurationMs

    for (const note of this.chart.notes) {
      const laneIndex = this.laneIndexByName.get(note.lane)
      if (laneIndex === undefined) {
        continue
      }

      const nearestLoopIndex = Math.floor((this.playheadMs - note.timeMs) / loopDurationMs)
      for (let offset = -1; offset <= 1; offset += 1) {
        const occurrenceTimeMs = note.timeMs + (nearestLoopIndex + offset) * loopDurationMs
        const relativeMs = occurrenceTimeMs - this.playheadMs
        const centerY = hitLineY - relativeMs * pxPerMs

        const noteHeight = Math.max(12, note.durationMs * pxPerMs)
        const noteTop = centerY - noteHeight / 2
        if (noteTop > height || noteTop + noteHeight < 0) {
          continue
        }

        const lanePadding = Math.max(4, laneWidth * 0.12)
        const noteWidth = Math.max(6, laneWidth - lanePadding * 2)
        const noteLeft = laneIndex * laneWidth + lanePadding

        this.context.fillStyle = NOTE_COLORS[note.lane]
        fillRoundedRect(this.context, noteLeft, noteTop, noteWidth, noteHeight, Math.min(8, noteHeight / 2))

        if (typeof note.fret === 'number') {
          this.context.fillStyle = 'rgba(255, 255, 255, 0.95)'
          this.context.font = '600 12px monospace'
          this.context.textAlign = 'center'
          this.context.textBaseline = 'middle'
          this.context.fillText(String(note.fret), noteLeft + noteWidth / 2, centerY)
        }
      }
    }

    this.context.strokeStyle = '#ffd166'
    this.context.lineWidth = 2
    this.context.beginPath()
    this.context.moveTo(0, hitLineY + 0.5)
    this.context.lineTo(width, hitLineY + 0.5)
    this.context.stroke()

    this.context.fillStyle = '#ffd166'
    this.context.font = '700 12px monospace'
    this.context.textAlign = 'right'
    this.context.textBaseline = 'bottom'
    this.context.fillText('HIT LINE', width - 8, hitLineY - 4)
  }
}
