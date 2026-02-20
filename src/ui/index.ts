export interface AppShellModel {
  noteCount: number
  maxFret: number
  bpm: number
  timingWindowMs: number
  pitchWindowCents: number
  latencyOffsetMs: number
}

export interface AppShellRefs {
  refreshButton: HTMLButtonElement
  deviceSelect: HTMLSelectElement
  startButton: HTMLButtonElement
  stopButton: HTMLButtonElement
  statusValue: HTMLElement
  sampleRateValue: HTMLElement
  channelCountValue: HTMLElement
  baseLatencyValue: HTMLElement
  constraintsValue: HTMLElement
  pitchF0HzValue: HTMLElement
  pitchMidiNoteValue: HTMLElement
  pitchCentsErrorValue: HTMLElement
  pitchConfidenceValue: HTMLElement
  pitchNoteTrackingStateValue: HTMLElement
  latestJudgmentValue: HTMLElement
  statsPerfectValue: HTMLElement
  statsGoodValue: HTMLElement
  statsMissValue: HTMLElement
  statsAccuracyValue: HTMLElement
  resetStatsButton: HTMLButtonElement
  latencyOffsetSlider: HTMLInputElement
  latencyOffsetValue: HTMLElement
  laneCanvas: HTMLCanvasElement
  laneStartButton: HTMLButtonElement
  laneStopButton: HTMLButtonElement
  laneSpeedSelect: HTMLSelectElement
  laneStateValue: HTMLElement
  laneFpsValue: HTMLElement
  updateLevelMeter: (rmsLevel: number, peakLevel: number, updateHz: number) => void
  resetLevelMeter: () => void
}

function queryRequired<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing required element: ${selector}`)
  }
  return element
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0
  }
  return Math.min(1, Math.max(0, level))
}

function formatDbfs(level: number): string {
  const normalized = clampLevel(level)
  if (normalized <= 0) {
    return '-∞ dBFS'
  }
  const db = 20 * Math.log10(normalized)
  return `${db.toFixed(1)} dBFS`
}

function formatUpdateHz(updateHz: number): string {
  if (!Number.isFinite(updateHz) || updateHz <= 0) {
    return '0.0'
  }
  return updateHz.toFixed(1)
}

function clampLatencyOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) {
    return 0
  }
  return Math.max(-150, Math.min(150, Math.round(offsetMs)))
}

function formatLatencyOffsetMs(offsetMs: number): string {
  const normalized = clampLatencyOffsetMs(offsetMs)
  if (normalized > 0) {
    return `+${normalized}ms`
  }
  return `${normalized}ms`
}

export function renderAppShell(root: HTMLElement, model: AppShellModel): AppShellRefs {
  const initialLatencyOffsetMs = clampLatencyOffsetMs(model.latencyOffsetMs)
  root.innerHTML = `
    <section class="app-shell">
      <h1>Rifflane MVP Bootstrap</h1>
      <p>Issue #2/#3 完了。Issue #4/#5/#6/#7/#8/#9 の統合検証UI。</p>
      <div class="status-grid">
        <div class="status-card">
          <strong>Chart</strong>
          <span>${model.noteCount} notes @ ${model.bpm} BPM (max fret ${model.maxFret})</span>
        </div>
        <div class="status-card">
          <strong>Scoring Window</strong>
          <span>${model.timingWindowMs}ms / ${model.pitchWindowCents} cents</span>
        </div>
        <div class="status-card">
          <strong>Latency Offset Range</strong>
          <span>-150ms to +150ms</span>
        </div>
      </div>

      <div class="audio-panel">
        <div class="audio-controls">
          <button type="button" data-role="refresh-devices">権限取得 / デバイス更新</button>
          <select data-role="device-select" aria-label="Audio input device"></select>
          <button type="button" data-role="start-capture">開始</button>
          <button type="button" data-role="stop-capture">停止</button>
        </div>
        <div class="audio-status-grid">
          <div class="status-card">
            <strong>状態</strong>
            <span data-role="status-value">未初期化</span>
          </div>
          <div class="status-card">
            <strong>Sample Rate</strong>
            <span data-role="sample-rate-value">-</span>
          </div>
          <div class="status-card">
            <strong>Channel Count</strong>
            <span data-role="channel-count-value">-</span>
          </div>
          <div class="status-card">
            <strong>AudioContext.baseLatency</strong>
            <span data-role="base-latency-value">-</span>
          </div>
          <div class="status-card">
            <strong>Constraints</strong>
            <span data-role="constraints-value">echo/noise/agc = - / - / -</span>
          </div>
        </div>
        <div class="level-meter-card status-card" aria-label="RMS/Peak level meter">
          <strong>入力レベル (RMS / Peak)</strong>
          <div class="level-meter-row">
            <span class="level-meter-label">RMS</span>
            <div class="level-meter-track" aria-hidden="true">
              <div class="level-meter-fill rms" data-role="rms-meter-fill"></div>
            </div>
            <span class="level-meter-value" data-role="rms-level-value">-∞ dBFS</span>
          </div>
          <div class="level-meter-row">
            <span class="level-meter-label">Peak</span>
            <div class="level-meter-track" aria-hidden="true">
              <div class="level-meter-fill peak" data-role="peak-meter-fill"></div>
            </div>
            <span class="level-meter-value" data-role="peak-level-value">-∞ dBFS</span>
          </div>
          <p class="level-meter-update-hz">
            更新周波数: <span data-role="meter-update-hz-value">0.0</span> Hz
          </p>
        </div>
        <div class="pitch-debug-card status-card" aria-label="Pitch debug panel">
          <strong>Pitch Debug</strong>
          <div class="pitch-debug-grid">
            <div class="pitch-debug-item">
              <span class="pitch-debug-label">f0Hz</span>
              <span class="pitch-debug-value" data-role="pitch-f0-hz-value">-</span>
            </div>
            <div class="pitch-debug-item">
              <span class="pitch-debug-label">midi note</span>
              <span class="pitch-debug-value" data-role="pitch-midi-note-value">-</span>
            </div>
            <div class="pitch-debug-item">
              <span class="pitch-debug-label">cents error</span>
              <span class="pitch-debug-value" data-role="pitch-cents-error-value">-</span>
            </div>
            <div class="pitch-debug-item">
              <span class="pitch-debug-label">confidence</span>
              <span class="pitch-debug-value" data-role="pitch-confidence-value">-</span>
            </div>
            <div class="pitch-debug-item">
              <span class="pitch-debug-label">note tracking state (note on/off)</span>
              <span class="pitch-debug-value" data-role="pitch-note-tracking-state-value">off</span>
            </div>
          </div>
        </div>
      </div>

      <div class="scoring-panel">
        <div class="status-card latest-judgment-card">
          <strong>Latest Judgment</strong>
          <span class="judgment-badge" data-role="latest-judgment-value">-</span>
        </div>
        <div class="score-stats-grid">
          <div class="status-card score-stat-card">
            <strong>Perfect</strong>
            <span class="score-stat-value" data-role="stats-perfect-value">0</span>
          </div>
          <div class="status-card score-stat-card">
            <strong>Good</strong>
            <span class="score-stat-value" data-role="stats-good-value">0</span>
          </div>
          <div class="status-card score-stat-card">
            <strong>Miss</strong>
            <span class="score-stat-value" data-role="stats-miss-value">0</span>
          </div>
          <div class="status-card score-stat-card">
            <strong>Accuracy</strong>
            <span class="score-stat-value" data-role="stats-accuracy-value">0.0%</span>
          </div>
        </div>
        <div class="scoring-controls">
          <button type="button" data-role="stats-reset">reset stats</button>
          <label for="latency-offset-ms">latency offset</label>
          <input
            id="latency-offset-ms"
            type="range"
            min="-150"
            max="150"
            step="1"
            value="${initialLatencyOffsetMs}"
            data-role="latency-offset-slider"
            aria-label="latency offset in milliseconds"
          />
          <span class="latency-offset-value" data-role="latency-offset-value">${formatLatencyOffsetMs(initialLatencyOffsetMs)}</span>
        </div>
      </div>

      <div class="lane-panel">
        <div class="status-card lane-canvas-card">
          <strong>4-string Lane</strong>
          <canvas
            class="lane-canvas"
            data-role="lane-canvas"
            width="800"
            height="240"
            aria-label="4-string lane display"
          ></canvas>
        </div>
        <div class="lane-controls">
          <button type="button" data-role="lane-start">start</button>
          <button type="button" data-role="lane-stop">stop</button>
          <label for="lane-speed-multiplier">speed multiplier</label>
          <select id="lane-speed-multiplier" data-role="lane-speed-multiplier">
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1" selected>1.0x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2.0x</option>
          </select>
        </div>
        <div class="lane-status-grid">
          <div class="status-card">
            <strong>状態</strong>
            <span data-role="lane-state-value">stopped</span>
          </div>
          <div class="status-card">
            <strong>FPS</strong>
            <span><span data-role="lane-fps-value">0.0</span> fps</span>
          </div>
        </div>
      </div>
    </section>
  `

  const rmsFill = queryRequired<HTMLElement>(root, '[data-role="rms-meter-fill"]')
  const peakFill = queryRequired<HTMLElement>(root, '[data-role="peak-meter-fill"]')
  const rmsValue = queryRequired<HTMLElement>(root, '[data-role="rms-level-value"]')
  const peakValue = queryRequired<HTMLElement>(root, '[data-role="peak-level-value"]')
  const meterUpdateHzValue = queryRequired<HTMLElement>(root, '[data-role="meter-update-hz-value"]')

  const updateLevelMeter = (rmsLevel: number, peakLevel: number, updateHz: number): void => {
    const normalizedRms = clampLevel(rmsLevel)
    const normalizedPeak = clampLevel(peakLevel)
    rmsFill.style.width = `${(normalizedRms * 100).toFixed(2)}%`
    peakFill.style.width = `${(normalizedPeak * 100).toFixed(2)}%`
    rmsValue.textContent = formatDbfs(normalizedRms)
    peakValue.textContent = formatDbfs(normalizedPeak)
    meterUpdateHzValue.textContent = formatUpdateHz(updateHz)
  }

  const resetLevelMeter = (): void => {
    updateLevelMeter(0, 0, 0)
  }

  return {
    refreshButton: queryRequired<HTMLButtonElement>(root, '[data-role="refresh-devices"]'),
    deviceSelect: queryRequired<HTMLSelectElement>(root, '[data-role="device-select"]'),
    startButton: queryRequired<HTMLButtonElement>(root, '[data-role="start-capture"]'),
    stopButton: queryRequired<HTMLButtonElement>(root, '[data-role="stop-capture"]'),
    statusValue: queryRequired<HTMLElement>(root, '[data-role="status-value"]'),
    sampleRateValue: queryRequired<HTMLElement>(root, '[data-role="sample-rate-value"]'),
    channelCountValue: queryRequired<HTMLElement>(root, '[data-role="channel-count-value"]'),
    baseLatencyValue: queryRequired<HTMLElement>(root, '[data-role="base-latency-value"]'),
    constraintsValue: queryRequired<HTMLElement>(root, '[data-role="constraints-value"]'),
    pitchF0HzValue: queryRequired<HTMLElement>(root, '[data-role="pitch-f0-hz-value"]'),
    pitchMidiNoteValue: queryRequired<HTMLElement>(root, '[data-role="pitch-midi-note-value"]'),
    pitchCentsErrorValue: queryRequired<HTMLElement>(root, '[data-role="pitch-cents-error-value"]'),
    pitchConfidenceValue: queryRequired<HTMLElement>(root, '[data-role="pitch-confidence-value"]'),
    pitchNoteTrackingStateValue: queryRequired<HTMLElement>(
      root,
      '[data-role="pitch-note-tracking-state-value"]',
    ),
    latestJudgmentValue: queryRequired<HTMLElement>(root, '[data-role="latest-judgment-value"]'),
    statsPerfectValue: queryRequired<HTMLElement>(root, '[data-role="stats-perfect-value"]'),
    statsGoodValue: queryRequired<HTMLElement>(root, '[data-role="stats-good-value"]'),
    statsMissValue: queryRequired<HTMLElement>(root, '[data-role="stats-miss-value"]'),
    statsAccuracyValue: queryRequired<HTMLElement>(root, '[data-role="stats-accuracy-value"]'),
    resetStatsButton: queryRequired<HTMLButtonElement>(root, '[data-role="stats-reset"]'),
    latencyOffsetSlider: queryRequired<HTMLInputElement>(root, '[data-role="latency-offset-slider"]'),
    latencyOffsetValue: queryRequired<HTMLElement>(root, '[data-role="latency-offset-value"]'),
    laneCanvas: queryRequired<HTMLCanvasElement>(root, '[data-role="lane-canvas"]'),
    laneStartButton: queryRequired<HTMLButtonElement>(root, '[data-role="lane-start"]'),
    laneStopButton: queryRequired<HTMLButtonElement>(root, '[data-role="lane-stop"]'),
    laneSpeedSelect: queryRequired<HTMLSelectElement>(root, '[data-role="lane-speed-multiplier"]'),
    laneStateValue: queryRequired<HTMLElement>(root, '[data-role="lane-state-value"]'),
    laneFpsValue: queryRequired<HTMLElement>(root, '[data-role="lane-fps-value"]'),
    updateLevelMeter,
    resetLevelMeter,
  }
}
