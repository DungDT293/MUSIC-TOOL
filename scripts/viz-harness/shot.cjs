const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

async function main() {
  const [, , outFile = 'viz.png', theme = 'cyberpunk', timeArg = '3.2', rawThemeAfter = '', sizeArg = '1280x720', logoArg = ''] = process.argv
  const themeAfter = rawThemeAfter === '-' ? '' : rawThemeAfter
  const [width, height] = sizeArg.split('x').map((value) => Number(value))
  const chromePath =
    process.env.CHROME_PATH ||
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe')
  const browser = await chromium.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('file://' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/'))
  await page.waitForFunction(() => typeof window.renderViz === 'function', { timeout: 15000 })
  await page.evaluate(
    ({ theme, time, width, height, themeAfter, simulateLogo }) =>
      window.renderViz({ theme, time, width, height, quality: 'balanced', themeAfter, simulateLogo }),
    { theme, time: Number(timeArg), width, height, themeAfter, simulateLogo: logoArg === 'logo' },
  )
  await page.waitForTimeout(400)
  const out = path.resolve(outFile)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } })
  await browser.close()
  if (errors.length) console.error('PAGE ERRORS:', errors.slice(0, 5).join(' | '))
  console.log('saved', out)
}

main().catch((error) => {
  console.error('HARNESS FAILED:', error)
  process.exit(1)
})
