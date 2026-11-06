const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

async function main() {
  const outFile = process.argv[2] || 'studio.png'
  const chromePath =
    process.env.CHROME_PATH ||
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe')
  const browser = await chromium.launch({ executablePath: fs.existsSync(chromePath) ? chromePath : undefined })
  const page = await browser.newPage({ viewport: { width: 760, height: 760 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300))
  })
  await page.goto('file://' + path.resolve(__dirname, 'studio.html').replace(/\\/g, '/'))
  await page.waitForTimeout(1200)
  const state = await page.evaluate(() => ({
    rows: document.querySelectorAll('section div').length,
    hasInspector: document.body.innerText.includes('Thuộc tính'),
    hasLayers: document.body.innerText.includes('Lớp'),
    text: document.body.innerText.slice(0, 400),
  }))
  await page.screenshot({ path: path.resolve(outFile) })
  await browser.close()
  if (errors.length) console.error('PAGE ERRORS:', errors.slice(0, 4).join(' | '))
  console.log(JSON.stringify(state))
}

main().catch((error) => {
  console.error('STUDIO CHECK FAILED:', error)
  process.exit(1)
})
