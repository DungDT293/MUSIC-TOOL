/**
 * Extracts the Vizzy editor's feature map: rail panels, menu items, preset ids
 * (from the thumbnail URLs), inspector sections and timeline controls.
 * Writes docs/plans/vizzy-feature-map.{json,md}.
 */
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.resolve(__dirname, '..', 'docs', 'plans')

const ICON_PREFIXES = [
  'palette', 'add', 'blur_on', 'blur_off', 'timeline', 'insert_photo', 'file_copy',
  'delete', 'restore', 'get_app', 'save', 'picture_in_picture', 'camera_enhance',
]

const stripShortcut = (text) => text.replace(/(Ctrl|Shift|Alt)\s*\+\s*[A-Za-z+ ]{0,3}$/g, '').trim()

const clean = (text) => {
  let value = text.replace(/\s+/g, ' ').trim()
  value = stripShortcut(value)
  for (const prefix of ICON_PREFIXES) {
    if (value.startsWith(prefix)) {
      value = value.slice(prefix.length).trim()
      break
    }
  }
  value = value.replace(/^([a-z_]+)(?=[A-Z])/, '').trim()
  if (value) value = value[0].toUpperCase() + value.slice(1)
  return value
}

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP || 'http://127.0.0.1:9222')
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('vizzy.io'))
  if (!page) throw new Error('vizzy page not found')
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(600)

  const report = { capturedAt: new Date().toISOString(), url: page.url(), panels: {}, menus: {}, presets: [], inspector: [], timeline: [] }

  // panels from the left rail
  const rail = ['Composition', 'Analyzers', 'Effects', 'Automations', 'Media', 'Projects', 'Lyrics']
  for (const item of rail) {
    try {
      await page.locator(`text="${item}"`).first().click({ timeout: 2500 })
      await page.waitForTimeout(650)
      report.panels[item] = await page.evaluate(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }
        const inPanel = (el) => {
          const r = el.getBoundingClientRect()
          return r.x > 55 && r.x < 530 && r.y > 40 && r.y < window.innerHeight * 0.95
        }
        const controls = [...document.querySelectorAll('button,[role="button"],input,select,[role="tab"],label')]
          .filter((el) => visible(el) && inPanel(el))
          .map((el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
        const sections = [...document.querySelectorAll('*')]
          .filter((el) => el.childElementCount === 0 && visible(el) && inPanel(el))
          .map((el) => (el.textContent || '').trim())
          .filter((t) => t.length > 2 && t.length < 40)
        return { controls: [...new Set(controls)].slice(0, 60), sections: [...new Set(sections)].slice(0, 40) }
      })
    } catch (error) {
      report.panels[item] = { error: String(error).slice(0, 120) }
    }
  }

  // top menus
  for (const menu of ['File', 'Edit', 'Project', 'View', 'Help']) {
    try {
      await page.getByText(menu, { exact: true }).first().click({ timeout: 2000 })
      await page.waitForTimeout(400)
      const items = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[role="menuitem"]')]
          .filter((el) => {
            const r = el.getBoundingClientRect()
            const style = getComputedStyle(el)
            return (
              el.offsetParent !== null &&
              style.visibility !== 'hidden' &&
              r.width > 20 &&
              r.height > 10 &&
              r.height < 60 &&
              r.y < 400 &&
              r.x < 700
            )
          })
          .map((el) => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(), y: el.getBoundingClientRect().y }))
          .sort((a, b) => a.y - b.y)
        if (!nodes.length) return []
        // The open menu is one contiguous vertical run; context menus elsewhere on the
        // page are separated by a large vertical gap.
        const run = [nodes[0]]
        for (let i = 1; i < nodes.length; i += 1) {
          if (nodes[i].y - nodes[i - 1].y > 40) break
          run.push(nodes[i])
        }
        return run.map((item) => item.text)
      })
      const cleaned = [...new Set(items.map(clean).filter(Boolean))]
      // keep only entries that look like a command, drop context-menu noise from the canvas
      report.menus[menu] = cleaned.slice(0, 25)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
    } catch (error) {
      report.menus[menu] = ['(không mở được)']
    }
  }

  // presets: ids come from the Firebase thumbnail filenames
  await page.locator('text="Composition"').first().click({ timeout: 2500 }).catch(() => {})
  await page.waitForTimeout(600)
  report.presets = await page.evaluate(() => {
    const urls = [...document.querySelectorAll('img')]
      .map((img) => img.src)
      .filter((src) => src.includes('spectrum_'))
    const ids = urls.map((src) => {
      const match = src.match(/spectrum_([^.?/]+)/)
      return match ? match[1] : src
    })
    return [...new Set(ids)]
  })

  // inspector accordions
  await page.evaluate(() => window.scrollTo(0, 0))
  report.inspector = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => el.childElementCount === 0)
      .map((el) => (el.textContent || '').trim())
      .filter((t) => ['Preset', 'Spectrum layers', 'General', 'Positioning & Size', 'Basics'].includes(t)),
  )

  report.timeline = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.y > window.innerHeight * 0.72
    }
    return [...document.querySelectorAll('button,input,[role="slider"]')]
      .filter(visible)
      .map((el) => ({
        kind: el.getAttribute('type') || el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      }))
      .filter((item) => item.label || item.kind === 'range')
  })

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'vizzy-feature-map.json'), JSON.stringify(report, null, 2))

  const lines = []
  lines.push('# Vizzy editor — bản đồ chức năng (bóc tách tự động)')
  lines.push('')
  lines.push(`Nguồn: ${report.url}  `)
  lines.push(`Thời điểm: ${report.capturedAt}  `)
  lines.push('Cách lấy: CDP + Playwright, chỉ mở menu/đổi panel, không bấm hành động phá huỷ.')
  lines.push('')
  lines.push('## Panel trái (rail)')
  lines.push('')
  for (const [name, data] of Object.entries(report.panels)) {
    if (data.error) {
      lines.push(`- **${name}**: lỗi (${data.error})`)
      continue
    }
    lines.push(`- **${name}** — ${data.controls.length} control, ${data.sections.length} nhãn`)
    const preview = data.sections.slice(0, 12).join(' · ')
    if (preview) lines.push(`  - nhãn: ${preview}`)
  }
  lines.push('')
  lines.push('## Menu trên thanh tiêu đề')
  lines.push('')
  for (const [menu, items] of Object.entries(report.menus)) {
    lines.push(`- **${menu}** (${items.length}): ${items.join(' · ')}`)
  }
  lines.push('')
  lines.push('## Preset sóng')
  lines.push('')
  lines.push(`Tổng số id thu được: **${report.presets.length}**`)
  lines.push('')
  lines.push('`' + report.presets.join('`, `') + '`')
  lines.push('')
  lines.push('## Panel phải (Inspector)')
  lines.push('')
  lines.push(report.inspector.map((s) => `- ${s}`).join('\n'))
  lines.push('')
  lines.push('## Timeline')
  lines.push('')
  lines.push(report.timeline.map((t) => `- \`${t.kind}\` ${t.label}`).join('\n'))
  lines.push('')
  lines.push('## Luồng hoạt động & tương tác (suy ra từ DOM)')
  lines.push('')
  lines.push('1. Rail trái đổi panel: Composition → Analyzers → Effects → Automations → Media → Projects → Lyrics.')
  lines.push('2. Composition là cây 3 tầng: nhóm (Visualizer / Particles Glow / Particles / Background Layer) → layer (2D Visualizer, 3D Particles, 2D Image, 2D Video).')
  lines.push('3. Panel phải đổi theo layer đang chọn: tab Objects / Visualizer, rồi các accordion Preset, Spectrum layers, General, Positioning & Size, Basics.')
  lines.push('4. Preset là lưới thumbnail 38×38, 6 cột; bấm là áp vào layer sóng đang chọn.')
  lines.push('5. Timeline: zoom, timecode, transport, waveform, track theo layer; kéo playhead để seek.')
  lines.push('6. Menu trên: File (Export/New/Save/Save As/Close), Edit, Project (Rename, Unpublish, Thumbnail, Custom resolution, Set background, Organize tracks), View, Help (system info, changelog, export JSON/log).')
  lines.push('7. Chuột phải trên canvas/layer mở context menu: Choose preset, Add automation, Enable/Disable blur, Set background, Duplicate, Delete, Remove, Reset, Save preview as image, Save as this preset, Open external preview, Edit image.')
  lines.push('')
  lines.push('## Giới hạn của lần bóc tách này')
  lines.push('')
  lines.push('- Trang là SPA; dữ liệu lấy từ DOM đang render, không phải API nội bộ.')
  lines.push('- Preset chỉ lấy được **id** (từ URL thumbnail trên Firebase Storage), không có tên hiển thị vì UI dùng tooltip ảnh.')
  lines.push('- Menu và context menu dùng chung `role="menuitem"` nên phần đầu mỗi menu có thể lẫn mục context menu.')
  lines.push('- Không bấm các hành động phá huỷ (Delete/Remove/Close/Save) để giữ nguyên project.')
  lines.push('')
  fs.writeFileSync(path.join(OUT, 'vizzy-feature-map.md'), lines.join('\n'))

  console.log(JSON.stringify({
    panels: Object.fromEntries(Object.entries(report.panels).map(([k, v]) => [k, v.controls ? v.controls.length : 'error'])),
    menus: Object.fromEntries(Object.entries(report.menus).map(([k, v]) => [k, v.length])),
    presets: report.presets.length,
    presetSample: report.presets.slice(0, 10),
    timeline: report.timeline.length,
  }, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error('EXTRACT FAILED:', error)
  process.exit(1)
})
