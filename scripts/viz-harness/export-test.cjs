const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

async function main() {
  const outH264 = path.resolve(process.argv[2] || 'viz-export.h264')
  const chromePath =
    process.env.CHROME_PATH ||
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe')
  const browser = await chromium.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 800, height: 480 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('file://' + path.resolve(__dirname, 'export.html').replace(/\\/g, '/'))
  await page.waitForFunction(() => typeof window.runExport === 'function', { timeout: 15000 })
  const result = await page.evaluate(() => window.runExport())
  await browser.close()
  if (errors.length) console.error('PAGE ERRORS:', errors.slice(0, 3).join(' | '))
  fs.writeFileSync(outH264, Buffer.from(result.base64, 'base64'))
  console.log(JSON.stringify({ frames: result.frames, bytes: result.bytes, out: outH264 }))
}

main().catch((error) => {
  console.error('EXPORT TEST FAILED:', error)
  process.exit(1)
})
