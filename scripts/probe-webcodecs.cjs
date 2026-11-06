const { app, BrowserWindow } = require('electron')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, webSecurity: false, allowRunningInsecureContent: true } })
  await win.loadURL(process.argv[2] || 'http://localhost:5173/')
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const out = { hasVideoEncoder: typeof VideoEncoder !== 'undefined', secure: window.isSecureContext, ua: navigator.userAgent };
      const configs = [
        { codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 4400000, framerate: 30 },
        { codec: 'avc1.4d4028', width: 1920, height: 1080, bitrate: 4400000, framerate: 30 },
        { codec: 'avc1.42e01f', width: 1280, height: 720, bitrate: 4400000, framerate: 30 },
        { codec: 'hvc1.1.6.L120.90', width: 1920, height: 1080, bitrate: 4400000, framerate: 30 }
      ];
      for (const cfg of configs) {
        try {
          const supported = await VideoEncoder.isConfigSupported(cfg);
          out[cfg.codec] = supported.supported;
        } catch (error) {
          out[cfg.codec] = 'error: ' + String(error && error.message || error).slice(0, 120);
        }
      }
      try {
        const encoder = new VideoEncoder({ output() {}, error(e) { out.configureError = String(e).slice(0, 120); } });
        encoder.configure({ codec: 'avc1.640028', width: 640, height: 360, bitrate: 2000000, framerate: 30, avc: { format: 'annexb' } });
        out.configureOk = true;
        encoder.close();
      } catch (error) {
        out.configureOk = false;
        out.configureError = String(error && error.message || error).slice(0, 160);
      }
      return out;
    })()
  `)
  console.log('PROBE ' + JSON.stringify(result, null, 2))
  app.quit()
})
