/**
 * Export Preset — lưu/tải cấu hình xuất video vào AppData
 * File: userData/exportPresets.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export interface ExportPreset {
  id: string          // uuid-like
  name: string        // Tên hiển thị
  createdAt: number
  settings: ExportPresetSettings
}

export interface ExportPresetSettings {
  outputFilename?: string
  tracklistEnabled?: boolean
  forceReencode?: boolean
  normalizeAudio?: boolean
  useGpuEncoding?: 'auto' | 'gpu' | 'cpu'
  deleteSourceFiles?: boolean
  usePriorityVideos?: boolean
  // NormalizeAudio bitrate preset
  targetBitrate?: number
  outputFormat?: 'mp3' | 'aac' | 'keep'
  loudnessPreset?: 'streaming' | 'youtube' | 'broadcast' | 'club'
}

function getPresetsPath(): string {
  return path.join(app.getPath('userData'), 'exportPresets.json')
}

function loadAll(): ExportPreset[] {
  const p = getPresetsPath()
  try {
    if (!fs.existsSync(p)) return []
    const raw = fs.readFileSync(p, 'utf-8')
    return JSON.parse(raw) as ExportPreset[]
  } catch {
    return []
  }
}

function saveAll(presets: ExportPreset[]): void {
  const p = getPresetsPath()
  fs.writeFileSync(p, JSON.stringify(presets, null, 2), 'utf-8')
}

function makeId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function listPresets(): ExportPreset[] {
  return loadAll()
}

export function savePreset(name: string, settings: ExportPresetSettings): ExportPreset {
  const presets = loadAll()
  const preset: ExportPreset = {
    id: makeId(),
    name: name.trim() || `Preset ${presets.length + 1}`,
    createdAt: Date.now(),
    settings,
  }
  presets.push(preset)
  saveAll(presets)
  return preset
}

export function updatePreset(id: string, name: string, settings: ExportPresetSettings): ExportPreset | null {
  const presets = loadAll()
  const idx = presets.findIndex(p => p.id === id)
  if (idx === -1) return null
  presets[idx] = { ...presets[idx], name: name.trim() || presets[idx].name, settings }
  saveAll(presets)
  return presets[idx]
}

export function deletePreset(id: string): boolean {
  const presets = loadAll()
  const next = presets.filter(p => p.id !== id)
  if (next.length === presets.length) return false
  saveAll(next)
  return true
}
