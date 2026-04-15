import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Một số shell/SDK để sót ELECTRON_RUN_AS_NODE=1 trong environment.
// Nếu electron-vite inherit biến này khi spawn app, Electron sẽ chạy như Node thường
// và các API main-process như app/protocol sẽ thành undefined trong dev/preview.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/main.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/preload.ts'),
      },
    },
  },
  renderer: {
    root: __dirname,
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html'),
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
    },
  },
})
