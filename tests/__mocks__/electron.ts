/**
 * tests/__mocks__/electron.ts
 * Mock của electron module để Vitest có thể chạy backend code
 * mà không cần Electron process thực sự.
 */

import { vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'

export const app = {
  getPath: vi.fn((name: string) => {
    const paths: Record<string, string> = {
      userData: path.join(os.tmpdir(), 'vitest-93media-userData'),
      appData:  path.join(os.tmpdir(), 'vitest-93media-appData'),
      temp:     os.tmpdir(),
      logs:     path.join(os.tmpdir(), 'vitest-93media-logs'),
    }
    return paths[name] ?? os.tmpdir()
  }),
  getVersion: vi.fn(() => '3.7.4'),
  getName:    vi.fn(() => '93-media-tool'),
  isPackaged: false,
  quit:       vi.fn(),
  on:         vi.fn(),
}

export const ipcMain = {
  handle: vi.fn(),
  on:     vi.fn(),
  off:    vi.fn(),
  emit:   vi.fn(),
}

export const ipcRenderer = {
  invoke:         vi.fn(),
  send:           vi.fn(),
  on:             vi.fn(),
  removeListener: vi.fn(),
}

export const BrowserWindow = vi.fn(() => ({
  loadURL:      vi.fn(),
  loadFile:     vi.fn(),
  webContents:  { send: vi.fn() },
  on:           vi.fn(),
  once:         vi.fn(),
  show:         vi.fn(),
  close:        vi.fn(),
  isDestroyed:  vi.fn(() => false),
}))

export const dialog = {
  showOpenDialog:  vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/test.mp3'] })),
  showSaveDialog:  vi.fn(async () => ({ canceled: false, filePath: '/tmp/output.mp4' })),
  showMessageBox:  vi.fn(async () => ({ response: 0 })),
}

export const shell = {
  openExternal: vi.fn(),
  openPath:     vi.fn(),
}

export default { app, ipcMain, ipcRenderer, BrowserWindow, dialog, shell }
