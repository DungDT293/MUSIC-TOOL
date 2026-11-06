/**
 * Measures per-frame cost of every visualizer style in Electron (hardware GL),
 * which is the same runtime the app uses for preview and export.
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const STYLES = ['circlebars', 'bars', 'dots', 'waveform', 'mirror', 'tunnel', 'orbit', 'pulse', 'grid', 'polar', 'orb', 'warp']
const SIZES = [
  [1920, 1080],
  [3840, 2160],
]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720 })
  await win.loadURL('file://' + path.resolve(__dirname, 'viz-harness', 'index.html').replace(/\\/g, '/'))
  await win.webContents.executeJavaScript('new Promise((resolve) => { const tick = () => (typeof window.benchViz === "function" ? resolve(true) : setTimeout(tick, 50)); tick() })')

  const results = []
  for (const [width, height] of SIZES) {
    for (const style of STYLES) {
      const result = await win.webContents.executeJavaScript(
        `window.benchViz({ width: ${width}, height: ${height}, waveStyle: '${style}', frames: 40 })`,
      )
      results.push(result)
      console.log(`${result.size} ${result.style.padEnd(11)} avg ${String(result.avgMs).padStart(7)} ms  p95 ${String(result.p95Ms).padStart(7)} ms  ~${result.fps} fps`)
    }
    console.log('---')
  }
  require('node:fs').writeFileSync(path.resolve(__dirname, '..', 'bench-visualizer.json'), JSON.stringify(results, null, 2))
  app.quit()
})
