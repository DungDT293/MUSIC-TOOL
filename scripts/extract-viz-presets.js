/**
 * Extract Avee presets from .viz files in viz/ folder
 * Output: src/features/visualizer/avee/extractedPresets.ts
 */

const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')

const VIZ_DIR = path.join(__dirname, '../viz')
const OUTPUT_FILE = path.join(__dirname, '../src/features/visualizer/avee/extractedPresets.ts')

async function extractVizPresets() {
  const vizFiles = fs.readdirSync(VIZ_DIR).filter((f) => f.endsWith('.viz'))
  
  console.log(`Found ${vizFiles.length} .viz files`)
  
  const presets = []
  
  for (const vizFile of vizFiles) {
    try {
      const vizPath = path.join(VIZ_DIR, vizFile)
      const vizData = fs.readFileSync(vizPath)
      
      const zip = new JSZip()
      const zipContent = await zip.loadAsync(vizData)
      
      const sceneFile = zipContent.file('scene.json')
      if (!sceneFile) {
        console.warn(`⚠️  ${vizFile}: scene.json not found`)
        continue
      }
      
      const sceneText = await sceneFile.async('text')
      const scene = JSON.parse(sceneText)
      
      const settings = extractAveeSettings(scene)
      if (!settings) {
        console.warn(`⚠️  ${vizFile}: Could not extract settings`)
        continue
      }
      
      const presetName = vizFile.replace(/\.viz$/i, '')
      presets.push({
        key: `viz_${presetName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        label: presetName,
        settings,
      })
      
      console.log(`✅ ${vizFile}`)
    } catch (err) {
      console.error(`❌ ${vizFile}: ${err.message}`)
    }
  }
  
  // Generate TypeScript file
  const tsContent = `// Auto-generated from .viz files in viz/ folder
// Run: node scripts/extract-viz-presets.js

import { AveeSettings, SampleProvider, ShapePath, SegmentType } from './types'

export interface ExtractedAveePreset {
  key: string
  label: string
  settings: AveeSettings
}

export const EXTRACTED_AVEE_PRESETS: ExtractedAveePreset[] = ${JSON.stringify(presets, null, 2)}
`
  
  fs.writeFileSync(OUTPUT_FILE, tsContent, 'utf8')
  
  console.log(`\n✅ Extracted ${presets.length} presets → ${OUTPUT_FILE}`)
}

function extractAveeSettings(scene) {
  try {
    const compositions = scene.compositions
    if (!Array.isArray(compositions) || compositions.length === 0) {
      return null
    }
    
    let audioProvider = null
    let barsElement = null
    
    for (const comp of compositions) {
      if (!Array.isArray(comp.elements)) continue
      
      for (const element of comp.elements) {
        if (element.objType === 'AudioProvider' || element.v === 'AudioProvider') {
          audioProvider = element
        }
        if (element.objType === 'Bars' || element.v === 'Bars') {
          barsElement = element
        }
      }
      
      if (audioProvider && barsElement) break
    }
    
    const settings = {
      sampleProvider: extractSampleProvider(audioProvider),
      fftSize: 2048,
      sampleOutCount: extractNumber(audioProvider, 'sampleOutCount', 200),
      lowerHz: extractNumber(audioProvider, 'lowerHz', 40),
      higherHz: extractNumber(audioProvider, 'higherHz', 18000),
      hzLinearFactor: extractNumber(audioProvider, 'hzLinearFactor', 0.3),
      smoothing: extractNumber(audioProvider, 'smooth', 0.7),
      shapePath: extractShapePath(barsElement),
      segment1Type: extractSegmentType(barsElement, 'Segment1'),
      segment2Type: extractSegmentType(barsElement, 'Segment2'),
      mirror: extractBoolean(barsElement, 'Segment1', 'mirror', false),
      barWidth: extractNumber(barsElement, 'Segment1', 'barWidth', 0.6) * 10,
      heightScale: Math.max(0.1, Math.min(1, extractNumber(barsElement, 'heightScale', 1) / 10)),
      fixedHeight: extractNumber(barsElement, 'Segment1', 'fixedHeight', 0),
    }
    
    return settings
  } catch (err) {
    console.error('Error extracting settings:', err)
    return null
  }
}

function extractSampleProvider(audioProvider) {
  if (!audioProvider || !audioProvider.sampleProvider) {
    return 'Spectrum'
  }
  
  const value = audioProvider.sampleProvider.v
  if (value === 'Waveform') {
    return 'Waveform'
  }
  
  return 'Spectrum'
}

function extractShapePath(barsElement) {
  if (!barsElement || !barsElement.ShapePath) {
    return 'HorizontalLine'
  }
  
  const value = barsElement.ShapePath.v
  switch (value) {
    case 'Circle':
      return 'Circle'
    case 'SidedPolygon':
      return 'SidedPolygon'
    case 'Letter':
      return 'Letter'
    case 'HorizontalLine':
    default:
      return 'HorizontalLine'
  }
}

function extractSegmentType(barsElement, segmentKey) {
  if (!barsElement || !barsElement[segmentKey]) {
    return 'None'
  }
  
  const value = barsElement[segmentKey].v
  switch (value) {
    case 'Bars':
      return 'Bars'
    case 'Line':
      return 'Line'
    case 'SharpBars':
      return 'SharpBars'
    case 'RoundBars':
      return 'RoundBars'
    case 'None':
    default:
      return 'None'
  }
}

function extractNumber(obj, ...keys) {
  let current = obj
  for (const key of keys) {
    if (!current || typeof current !== 'object') {
      return typeof key === 'number' ? key : 0
    }
    current = current[key]
  }
  
  if (current && typeof current === 'object' && 'v' in current) {
    const value = current.v
    return typeof value === 'number' ? value : 0
  }
  
  return typeof current === 'number' ? current : (typeof keys[keys.length - 1] === 'number' ? keys[keys.length - 1] : 0)
}

function extractBoolean(obj, ...keys) {
  let current = obj
  const defaultValue = typeof keys[keys.length - 1] === 'boolean' ? keys[keys.length - 1] : false
  const pathKeys = keys.filter((k) => typeof k === 'string')
  
  for (const key of pathKeys) {
    if (!current || typeof current !== 'object') {
      return defaultValue
    }
    current = current[key]
  }
  
  if (current && typeof current === 'object' && 'v' in current) {
    const value = current.v
    return typeof value === 'number' ? value !== 0 : Boolean(value)
  }
  
  return typeof current === 'number' ? current !== 0 : Boolean(current) || defaultValue
}

extractVizPresets().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
