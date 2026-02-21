import { expect, test, type Locator, type Page } from '@playwright/test'

async function setRangeValue(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
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
})
