import ToneMidiModule from '@tonejs/midi'
import { expect, test, type Locator } from '@playwright/test'

const { Midi } = ToneMidiModule

async function setRangeValue(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

function createValidMidiFilePayload(fileName: string): {
  name: string
  mimeType: string
  buffer: Buffer
} {
  const midi = new Midi()
  midi.header.setTempo(120)

  const mainTrack = midi.addTrack()
  mainTrack.name = 'Main'
  mainTrack.addNote({ midi: 28, time: 0, duration: 0.5 })
  mainTrack.addNote({ midi: 33, time: 0.75, duration: 0.25 })

  const alternateTrack = midi.addTrack()
  alternateTrack.name = 'Alt'
  alternateTrack.addNote({ midi: 40, time: 0.25, duration: 0.5 })

  return {
    name: fileName,
    mimeType: 'audio/midi',
    buffer: Buffer.from(midi.toArray()),
  }
}

function createInvalidMidiFilePayload(fileName: string): {
  name: string
  mimeType: string
  buffer: Buffer
} {
  return {
    name: fileName,
    mimeType: 'audio/midi',
    buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
  }
}

test.describe('Rifflane e2e baseline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Rifflane MVP Bootstrap' })).toBeVisible()
  })

  test('smoke: ページ表示と主要パネルの存在確認', async ({ page }) => {
    await expect(page.locator('[data-role="midi-drop-zone"]')).toBeVisible()
    await expect(page.locator('[data-role="lane-canvas"]')).toBeVisible()
    await expect(page.locator('[data-role="latest-judgment-value"]')).toBeVisible()
  })

  test('diagnostics modeトグルの表示と状態反映', async ({ page }) => {
    const diagnosticsToggle = page.locator('[data-role="diagnostics-toggle"]')
    const diagnosticsModeValue = page.locator('[data-role="diagnostics-mode-value"]')
    const diagnosticsPanel = page.locator('[data-role="diagnostics-panel"]')

    await expect(diagnosticsToggle).toBeVisible()
    await expect(diagnosticsModeValue).toHaveText('OFF')
    await expect(diagnosticsPanel).toBeVisible()
    await expect(diagnosticsPanel).toHaveAttribute('aria-hidden', 'true')

    await diagnosticsToggle.check()
    await expect(diagnosticsModeValue).toHaveText('ON')
    await expect(diagnosticsPanel).toHaveAttribute('aria-hidden', 'false')
  })

  test('lane start/stop と speed変更のUI反映', async ({ page }) => {
    const startButton = page.locator('[data-role="lane-start"]')
    const stopButton = page.locator('[data-role="lane-stop"]')
    const speedSelect = page.locator('[data-role="lane-speed-multiplier"]')
    const laneState = page.locator('[data-role="lane-state-value"]')

    await expect(laneState).toHaveText('stopped (1.00x)')
    await expect(startButton).toBeEnabled()
    await expect(stopButton).toBeDisabled()

    await startButton.click()
    await expect(laneState).toHaveText('playing (1.00x)')
    await expect(startButton).toBeDisabled()
    await expect(stopButton).toBeEnabled()

    await speedSelect.selectOption('1.5')
    await expect(laneState).toHaveText('playing (1.50x)')

    await stopButton.click()
    await expect(laneState).toHaveText('stopped (1.50x)')
    await expect(startButton).toBeEnabled()
    await expect(stopButton).toBeDisabled()
  })

  test('latency offset slider操作の反映', async ({ page }) => {
    const slider = page.locator('[data-role="latency-offset-slider"]')
    const offsetValue = page.locator('[data-role="latency-offset-value"]')

    await setRangeValue(slider, 45)
    await expect(slider).toHaveValue('45')
    await expect(offsetValue).toHaveText('+45ms')

    await setRangeValue(slider, -30)
    await expect(slider).toHaveValue('-30')
    await expect(offsetValue).toHaveText('-30ms')
  })

  test('latency offset の localStorage 永続化（reload後復元）', async ({ page }) => {
    const slider = page.locator('[data-role="latency-offset-slider"]')
    const offsetValue = page.locator('[data-role="latency-offset-value"]')

    await setRangeValue(slider, 72)
    await expect(slider).toHaveValue('72')
    await expect(offsetValue).toHaveText('+72ms')

    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('rifflane.latencyOffsetMs')))
      .toBe('72')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Rifflane MVP Bootstrap' })).toBeVisible()
    await expect(slider).toHaveValue('72')
    await expect(offsetValue).toHaveText('+72ms')
  })

  test('diagnostics toggle の localStorage 永続化（reload後ON継続）', async ({ page }) => {
    const diagnosticsToggle = page.locator('[data-role="diagnostics-toggle"]')
    const diagnosticsModeValue = page.locator('[data-role="diagnostics-mode-value"]')
    const diagnosticsPanel = page.locator('[data-role="diagnostics-panel"]')

    await diagnosticsToggle.check()
    await expect(diagnosticsToggle).toBeChecked()
    await expect(diagnosticsModeValue).toHaveText('ON')
    await expect(diagnosticsPanel).toHaveAttribute('aria-hidden', 'false')

    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('rifflane.diagnosticsMode')))
      .toBe('1')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Rifflane MVP Bootstrap' })).toBeVisible()
    await expect(diagnosticsToggle).toBeChecked()
    await expect(diagnosticsModeValue).toHaveText('ON')
    await expect(diagnosticsPanel).toHaveAttribute('aria-hidden', 'false')
  })

  test('MIDI投入から解析成功・track選択・import完了まで検証', async ({ page }) => {
    const midiFileInput = page.locator('[data-role="midi-file-input"]')
    const midiTrackSelect = page.locator('[data-role="midi-track-select"]')
    const midiImportButton = page.locator('[data-role="midi-import-run"]')
    const midiSelectedNameValue = page.locator('[data-role="midi-selected-name-value"]')
    const midiImportStatusValue = page.locator('[data-role="midi-import-status-value"]')
    const payload = createValidMidiFilePayload('e2e-valid.mid')

    await midiFileInput.setInputFiles(payload)

    await expect(midiSelectedNameValue).toHaveText('e2e-valid.mid')
    await expect(midiImportStatusValue).toHaveText('解析成功: 2 tracks')
    await expect(midiTrackSelect).toBeEnabled()
    await expect(midiTrackSelect.locator('option')).toHaveCount(3)
    await expect(midiTrackSelect.locator('option[value="1"]')).toHaveText('#2 Alt (1 notes)')

    await midiTrackSelect.selectOption('1')
    await expect(midiTrackSelect).toHaveValue('1')
    await expect(midiImportButton).toBeEnabled()

    await midiImportButton.click()
    await expect(midiImportStatusValue).toHaveText('import完了: #2 Alt')
  })

  test('不正MIDI投入時に解析失敗表示を検証', async ({ page }) => {
    const midiFileInput = page.locator('[data-role="midi-file-input"]')
    const midiTrackSelect = page.locator('[data-role="midi-track-select"]')
    const midiImportButton = page.locator('[data-role="midi-import-run"]')
    const midiSelectedNameValue = page.locator('[data-role="midi-selected-name-value"]')
    const midiImportStatusValue = page.locator('[data-role="midi-import-status-value"]')
    const payload = createInvalidMidiFilePayload('e2e-invalid.mid')

    await midiFileInput.setInputFiles(payload)

    await expect(midiSelectedNameValue).toHaveText('e2e-invalid.mid')
    await expect(midiImportStatusValue).toHaveText('解析失敗: SMF_PARSE_FAILED')
    await expect(midiTrackSelect).toBeDisabled()
    await expect(midiTrackSelect).toHaveValue('')
    await expect(midiImportButton).toBeDisabled()
  })
})
