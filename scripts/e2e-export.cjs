/**
 * End-to-end export probe: launches the real Electron main with a CDP port, then
 * drives exportSongNhacFrames inside the app renderer with fixed paths (no dialogs).
 *
 * Usage: node scripts/e2e-export.cjs [audioPath] [outputPath]
 */
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9223

async function main() {
  const audioPath = process.argv[2]
  const outputPath = process.argv[3] || path.join(os.tmpdir(), `e2e-export-${Date.now()}.mp4`)
  if (!audioPath) throw new Error('audio path required')

  const userData = path.join(os.tmpdir(), `dsh-e2e-${Date.now()}`)
  const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ELECTRON_RENDERER_URL: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const logs = []
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))

  await new Promise((resolve) => setTimeout(resolve, 9000))

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const context = browser.contexts()[0]
  let page = context.pages().find((item) => item.url().includes('localhost:5173'))
  if (!page) {
    page = await context.waitForEvent('page', { timeout: 15000 }).catch(() => null)
  }
  if (!page) throw new Error('renderer page not found: ' + context.pages().map((p) => p.url()).join(', '))
  await page.waitForLoadState('domcontentloaded')
  await new Promise((resolve) => setTimeout(resolve, 2500))

  const result = await page.evaluate(
    async ({ audioPath, outputPath }) => {
      const mod = await import('/src/features/song-nhac/export/exportSongNhacFrames.ts')
      const hasApi = Boolean(window.api && window.api.songNhac)
      if (!hasApi) return { ok: false, error: 'window.api.songNhac missing' }
      const result = await mod.exportSongNhacFrames({
        requestId: 'e2e-' + Date.now(),
        audioPath,
        outputPath,
        width: 1280,
        height: 720,
        fps: 30,
        theme: 'cyberpunk',
        intensity: 1,
        quality: 'balanced',
        codec: 'h264',
        bitrateTier: 'balanced',
        rangeStartSec: 0,
        rangeEndSec: 6,
        layers: [],
      })
      return { ok: result.success, error: result.error, outputPath: result.outputPath }
    },
    { audioPath, outputPath },
  )

  console.log('E2E ' + JSON.stringify(result, null, 2))
  if (!result.ok) {
    const tail = logs.join('').split('\n').filter((line) => line.trim()).slice(-25).join('\n')
    console.log('--- app log tail ---\n' + tail)
  }
  await browser.close().catch(() => {})
  child.kill()
  process.exit(result.ok ? 0 : 1)
}

main().catch((error) => {
  console.error('E2E FAILED:', error)
  process.exit(2)
})
