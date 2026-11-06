const { app, BrowserWindow } = require('electron')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 })
  await win.loadURL(process.argv[2] || 'http://localhost:5173/')
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const out = { href: location.href, secure: window.isSecureContext, hasEncoder: typeof VideoEncoder !== 'undefined' };
      try {
        const mod = await import('/src/features/song-nhac/export/frameEncoder.ts');
        out.imported = true;
        for (const cfg of [
          { codec: 'h264', bitrate: 5280000 },
          { codec: 'hevc', bitrate: 5280000 }
        ]) {
          try {
            const encoder = new mod.FrameEncoder({ width: 1920, height: 1080, fps: 30, bitrate: cfg.bitrate, codec: cfg.codec, onChunk() {} });
            const ok = await encoder.init();
            out[cfg.codec] = { ok, selected: encoder.selectedCodec };
            encoder.close();
          } catch (error) {
            out[cfg.codec] = 'throw: ' + String(error && error.message || error).slice(0, 160);
          }
        }
      } catch (error) {
        out.imported = false;
        out.importError = String(error && error.message || error).slice(0, 200);
      }
      return out;
    })()
  `)
  console.log('PROBE2 ' + JSON.stringify(result, null, 2))
  app.quit()
})
