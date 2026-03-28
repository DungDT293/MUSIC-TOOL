import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ScanMusicResult } from './scanMusic'

const STORE_DIR = path.join(os.homedir(), '.93-media-tool-mix-nhac')
const STORE_FILE = path.join(STORE_DIR, 'music-scan-result.json')

let cache: ScanMusicResult | null = null

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true })
  }
}

export function saveScanResult(result: ScanMusicResult): void {
  try {
    const payload: ScanMusicResult = {
      ...result,
      scannedAt: result.scannedAt ?? Date.now(),
    }
    cache = payload
    ensureStoreDir()
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), 'utf-8')
    console.log('[scanStore] Saved scan result:', STORE_FILE)
  } catch (err) {
    console.warn('[scanStore] Failed to save scan result:', err)
  }
}

export function loadScanResult(): ScanMusicResult | null {
  if (cache) {
    return cache
  }
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return null
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf-8')
    cache = JSON.parse(raw) as ScanMusicResult
    return cache
  } catch (err) {
    console.warn('[scanStore] Failed to load scan result:', err)
    return null
  }
}

export function clearScanResult(): void {
  cache = null
  try {
    if (fs.existsSync(STORE_FILE)) {
      fs.unlinkSync(STORE_FILE)
    }
  } catch (err) {
    console.warn('[scanStore] Failed to clear scan result:', err)
  }
}
