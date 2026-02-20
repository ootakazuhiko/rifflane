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
}

function queryRequired<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing required element: ${selector}`)
  }
  return element
}

export function renderAppShell(root: HTMLElement, model: AppShellModel): AppShellRefs {
  root.innerHTML = `
    <section class="app-shell">
      <h1>Rifflane MVP Bootstrap</h1>
      <p>Issue #2/#3 完了。Issue #4 (Audio Input) の検証UI。</p>
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
      </div>
    </section>
  `

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
  }
}
