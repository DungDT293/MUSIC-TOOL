const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

async function main() {
  const chromePath =
    process.env.CHROME_PATH ||
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe')
  const browser = await chromium.launch({ executablePath: fs.existsSync(chromePath) ? chromePath : undefined })
  const page = await browser.newPage({ viewport: { width: 780, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 200))
  })
  await page.goto('file://' + path.resolve(__dirname, 'studio.html').replace(/\\/g, '/'))
  await page.waitForTimeout(700)

  const layerCount = () => page.evaluate(() => window.__store ? window.__store.getState().layers.length : -1)
  const rows = () => page.locator('section').first().locator('div').filter({ hasText: /^Chữ$/ })

  const before = await layerCount()
  await page.getByRole('button', { name: 'Chữ', exact: true }).click()
  await page.waitForTimeout(150)
  const afterAdd = await layerCount()

  await page.getByRole('button', { name: 'Nhóm', exact: true }).click()
  await page.waitForTimeout(150)
  const afterGroup = await layerCount()

  // Undo twice → back to the starting count.
  await page.getByRole('button', { name: 'Hoàn tác' }).click().catch(() => {})
  const undoBtnText = await page.evaluate(() => document.body.innerText.includes('Hoàn tác'))

  const state = await page.evaluate(() => {
    const store = window.__store
    if (!store) return null
    const s = store.getState()
    return {
      layers: s.layers.map((layer) => ({ type: layer.type, name: layer.name, visible: layer.visible })),
      historyPast: s.historyPast.length,
      historyFuture: s.historyFuture.length,
      selected: s.selectedLayerId,
    }
  })

  await page.screenshot({ path: path.resolve(__dirname, 'studio-interact.png') })
  await browser.close()
  console.log(JSON.stringify({ before, afterAdd, afterGroup, undoBtnText, state, errors: errors.slice(0, 4) }, null, 2))
}

main().catch((error) => {
  console.error('STUDIO INTERACT FAILED:', error)
  process.exit(1)
})
