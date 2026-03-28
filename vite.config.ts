import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import glsl from 'vite-plugin-glsl'
import { obfuscatePlugin } from './vite-plugin-obfuscate'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/main.ts'),
      },
      minify: 'terser', // Minify code
      terserOptions: {
        compress: {
          drop_console: false, // Giữ console để debug
          drop_debugger: true,
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/preload.ts'),
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: false,
          drop_debugger: true,
        },
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'src'),
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'index.html'),
        },
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: false,
          drop_debugger: true,
        },
      },
    },
    plugins: [
      react(),
      glsl(), // GLSL shader loader
      // Obfuscate chỉ trong production build
      ...(process.env.NODE_ENV === 'production' ? [obfuscatePlugin()] : []),
    ],
  },
})

