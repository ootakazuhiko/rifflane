#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const HOST = '127.0.0.1'
const PORT = 4173
const BASE_URL = `http://${HOST}:${PORT}`
const OUTPUT_DIR = path.resolve('docs/screenshots/e2e')
const SERVER_READY_TIMEOUT_MS = 60_000
const SERVER_STOP_TIMEOUT_MS = 10_000

function killProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
      return
    }
    throw error
  }
}

function startDevServer() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(
    npmCommand,
    ['run', 'dev', '--', '--host', HOST, '--port', String(PORT), '--strictPort'],
    {
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
      detached: process.platform !== 'win32',
    },
  )

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[dev] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[dev] ${chunk}`)
  })

  return child
}

async function waitForServerReady(serverProcess) {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`dev server exited before ready (exitCode=${serverProcess.exitCode})`)
    }

    try {
      const response = await fetch(BASE_URL)
      if (response.ok) {
        return
      }
    } catch {
      // server not ready yet
    }
    await delay(400)
  }

  throw new Error(`timed out waiting for dev server: ${BASE_URL}`)
}

async function stopDevServer(serverProcess) {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    serverProcess.kill('SIGTERM')
  } else if (serverProcess.pid) {
    killProcessGroup(serverProcess.pid, 'SIGTERM')
  }

  const deadline = Date.now() + SERVER_STOP_TIMEOUT_MS
  while (serverProcess.exitCode === null && Date.now() < deadline) {
    await delay(100)
  }

  if (serverProcess.exitCode === null) {
    if (process.platform === 'win32') {
      serverProcess.kill('SIGKILL')
    } else if (serverProcess.pid) {
      killProcessGroup(serverProcess.pid, 'SIGKILL')
    }
  }
}

async function setRangeValue(locator, value) {
  await locator.evaluate((element, nextValue) => {
    const input = element
    input.value = String(nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function capturePage(page, fileName) {
  const outputPath = path.join(OUTPUT_DIR, fileName)
  await page.screenshot({ path: outputPath, fullPage: true })
  console.log(`[capture:e2e] saved ${outputPath}`)
}

async function run() {
  await mkdir(OUTPUT_DIR, { recursive: true })

  const serverProcess = startDevServer()
  let browser

  try {
    await waitForServerReady(serverProcess)

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    })
    const page = await context.newPage()

    await page.goto(BASE_URL)
    await page.getByRole('heading', { name: 'Rifflane MVP Bootstrap' }).waitFor()

    await capturePage(page, '01-initial-display.png')

    await page.locator('[data-role="diagnostics-toggle"]').check()
    await page.waitForFunction(() => {
      const modeText = document.querySelector('[data-role="diagnostics-mode-value"]')?.textContent?.trim()
      const panel = document.querySelector('[data-role="diagnostics-panel"]')
      return modeText === 'ON' && panel?.getAttribute('aria-hidden') === 'false'
    })
    await capturePage(page, '02-diagnostics-on.png')

    const latencySlider = page.locator('[data-role="latency-offset-slider"]')
    await setRangeValue(latencySlider, 72)
    await page.waitForFunction(() => {
      const valueText = document.querySelector('[data-role="latency-offset-value"]')?.textContent?.trim()
      const slider = document.querySelector('[data-role="latency-offset-slider"]')
      return valueText === '+72ms' && slider instanceof HTMLInputElement && slider.value === '72'
    })
    await capturePage(page, '03-latency-plus-72ms.png')

    await page.locator('[data-role="lane-start"]').click()
    await page.locator('[data-role="lane-speed-multiplier"]').selectOption('1.5')
    await page.waitForFunction(() => {
      const laneText = document.querySelector('[data-role="lane-state-value"]')?.textContent?.trim()
      return laneText === 'playing (1.50x)'
    })
    await capturePage(page, '04-lane-playing-1-5x.png')
  } finally {
    await browser?.close()
    await stopDevServer(serverProcess)
  }
}

run().catch((error) => {
  console.error(`[capture:e2e] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
