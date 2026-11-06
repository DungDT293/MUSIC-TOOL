/**
 * Walks the public Vizzy editor over CDP and maps its UI:
 * rail panels, top menus, presets, inspector accordions and timeline controls.
 *
 * Only opens menus / switches panels — never clicks a destructive or save action.
 */
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const ENDPOINT = process.env.CDP || 'http://127.0.0.1:9222'
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'plans')

const SNAPSHOT_FN = `(tag) => {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const labelOf = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
  const controls = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],input,select,textarea,[role="slider"],[role="tab"]')]
    .filter(visible)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      type: el.getAttribute('type') || '',
      label: labelOf(el),
    }))
    .filter((c) => c.label)
  return { tag, url: location.href, controls: controls.slice(0, 120) }
}`

const MENU_FN = `() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'
  }
  const items = [...document.querySelectorAll('[role="menuitem"]')].filter(visible)
  if (items.length) return items.map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean)
  const popup = [...document.querySelectorAll('div,ul')]
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return visible(el) && r.y < 130 && r.height > 60 && r.width > 120 && r.width < 460
    })
    .pop()
  if (!popup) return []
  return [...popup.querySelectorAll('*')]
    .filter((el) => el.childElementCount === 0 && visible(el))
    .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
    .filter(Boolean)
}`

const PRESET_FN = `() => {
  const nodes = [...document.querySelectorAll('[title], [aria-label]')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.x > 1400 && r.width >= 28 && r.width <= 50 && r.height >= 28 && r.height <= 50
  })
  const seen = new Set()
  return nodes
    .map((el) => ({
      label: (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim(),
      size: Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height),
    }))
    .filter((p) => p.label && !seen.has(p.label) && seen.add(p.label))
}`

const TIMELINE_FN = `() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  return [...document.querySelectorAll('button,input,[role="slider"],[role="button"]')]
    .filter((el) => visible(el) && el.getBoundingClientRect().y > window.innerHeight * 0.7)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70),
    }))
    .filter((item) => item.label || item.type === 'range')
}`

async function main() {
  const browser = await chromium.connectOverCDP(ENDPOINT)
  const ctx = browser.contexts()[0]
  const page = ctx.pages().find((p) => p.url().includes('vizzy.io'))
  if (!page) throw new Error('vizzy page not found on ' + ENDPOINT)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(800)

  const report = { capturedAt: new Date().toISOString(), url: page.url(), rail: {}, menus: {}, presets: [], timeline: [] }

  report.railItems = await page.evaluate(() =>
    [...new Set(
      [...document.querySelectorAll('*')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.x < 90 && r.width > 30 && r.width < 80 && r.height > 28 && r.height < 80 && el.childElementCount <= 3
        })
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    )],
  )

  for (const item of report.railItems.slice(0, 12)) {
    try {
      await page.locator(`text="${item}"`).first().click({ timeout: 2500 })
      await page.waitForTimeout(700)
      report.rail[item] = await page.evaluate(eval(SNAPSHOT_FN), item)
    } catch (error) {
      report.rail[item] = { error: String(error).slice(0, 120) }
    }
  }

  for (const menu of ['File', 'Edit', 'Project', 'View', 'Help']) {
    try {
      await page.getByText(menu, { exact: true }).first().click({ timeout: 2000 })
      await page.waitForTimeout(450)
      report.menus[menu] = await page.evaluate(eval(MENU_FN))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    } catch (error) {
      report.menus[menu] = ['(không mở được: ' + String(error).slice(0, 80) + ')']
    }
  }

  // Back to the composition panel before reading the preset grid.
  await page.locator('text="Composition"').first().click({ timeout: 2500 }).catch(() => {})
  await page.waitForTimeout(800)
  report.presets = await page.evaluate(eval(PRESET_FN))
  report.timeline = await page.evaluate(eval(TIMELINE_FN))
  report.inspectorSections = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => el.childElementCount === 0)
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => ['Spectrum layers', 'General', 'Positioning & Size', 'Basics', 'Preset'].includes(t)),
  )

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'vizzy-feature-map.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    railItems: report.railItems,
    railPanels: Object.fromEntries(Object.entries(report.rail).map(([k, v]) => [k, v.controls ? v.controls.length : 'error'])),
    menus: Object.fromEntries(Object.entries(report.menus).map(([k, v]) => [k, v.length])),
    presets: report.presets.length,
    presetSample: report.presets.slice(0, 8),
    timeline: report.timeline.length,
  }, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error('PROBE FAILED:', error)
  process.exit(1)
})
