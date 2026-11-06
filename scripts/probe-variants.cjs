const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const URL = 'http://localhost:5173/'
const PRELOAD = path.join(__dirname, '..', 'dist-electron', 'preload', 'preload.js')

async function probe(label, webPreferences) {
  const win = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences })
  try {
    await win.loadURL(URL)
    await new Promise((resolve) => setTimeout(resolve, 600))
    const result = await win.webContents.executeJavaScript(`
      ({ ve: typeof VideoEncoder, vd: typeof VideoDecoder, vf: typeof VideoFrame, secure: window.isSecureContext, sandboxed: !window.process })
    `)
    console.log(`PROBE ${label}: ${JSON.stringify(result)}`)
  } catch (error) {
    console.log(`PROBE ${label}: error ${String(error).slice(0, 120)}`)
  } finally {
    win.destroy()
  }
}

app.whenReady().then(async () => {
  await probe('appPrefs', {
    preload: PRELOAD,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: false,
    allowRunningInsecureContent: true,
  })
  app.quit()
})
