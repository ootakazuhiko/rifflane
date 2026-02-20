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

export function renderAppShell(root: HTMLElement, model: AppShellModel): AppShellRefs {
  root.innerHTML = `
    <section class="app-shell">
      <h1>Rifflane MVP Bootstrap</h1>
      <p>Issue #2/#3 完了。Issue #4/#5 (Audio Input + Worklet Meter) の検証UI。</p>
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
          <strong>Latency Offset</strong>
          <span>${model.latencyOffsetMs}ms</span>
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
    updateLevelMeter,
    resetLevelMeter,
  }
}
