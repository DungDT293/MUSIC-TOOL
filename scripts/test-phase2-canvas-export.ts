/**
 * PHASE 2: Canvas Export Test Script
 * 
 * Tests the complete Phase 2 pipeline:
 * - Visualizer + layers → CanvasExportScene
 * - Offscreen rendering → RGBA frames
 * - FFmpeg encoding → MP4 output
 * 
 * Usage:
 *   npm run test:phase2
 * OR:
 *   tsx scripts/test-phase2-canvas-export.ts
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createCanvasExportScene } from '../src/features/visualizer/exportConverter'
import { exportFinalVideo } from '../backend/video/finalExport'
import type { FinalExportRequestPayload } from '../shared/videoFinalExportChannels'
import type { Layer, ImageLayer, TextLayer } from '../src/features/visualizer/layers/types'

async function testPhase2Export() {
  console.log('='.repeat(60))
  console.log('PHASE 2: Canvas Export Test')
  console.log('='.repeat(60))

  // 1. Create test layers
  const testLayers: Layer[] = [
    // Text layer
    {
      id: 'test-text-1',
      type: 'text',
      name: 'Test Text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      text: 'PHASE 2 WORKING! 🎉',
      fontSize: 72,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      color: '#ffffff',
      fillColor: '#ffffff',
      align: 'center',
      transform: {
        x: 0,
        y: -200,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0.5,
        anchorY: 0.5,
      },
      stroke: {
        enabled: true,
        width: 4,
        color: '#000000',
      },
      shadow: {
        enabled: true,
        color: '#000000',
        blur: 10,
        offsetX: 2,
        offsetY: 2,
      },
    } as TextLayer,

    // Another text layer
    {
      id: 'test-text-2',
      type: 'text',
      name: 'Subtitle Text',
      visible: true,
      locked: false,
      opacity: 0.9,
      blendMode: 'normal',
      text: 'Canvas Export with Layers',
      fontSize: 36,
      fontFamily: 'Arial',
      fontWeight: 'normal',
      color: '#00ff00',
      fillColor: '#00ff00',
      align: 'center',
      transform: {
        x: 0,
        y: 200,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0.5,
        anchorY: 0.5,
      },
    } as TextLayer,
  ]

  // 2. Create test audio file path (you need to provide a valid audio file)
  const testAudioPath = path.join(os.homedir(), 'Music', 'test.mp3')
  
  // Check if test audio exists
  try {
    await fs.access(testAudioPath)
    console.log(`✓ Test audio found: ${testAudioPath}`)
  } catch {
    console.warn(`⚠ Test audio not found: ${testAudioPath}`)
    console.warn('Please provide a valid audio file path or skip this test')
    console.warn('You can edit this script and change testAudioPath')
    return
  }

  // 3. Create CanvasExportScene
  console.log('\n[1/3] Creating canvas export scene...')
  const scene = createCanvasExportScene({
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 10, // 10 second test video
    
    // Visualizer settings (butterchurn)
    rendererMode: 'butterchurn',
    presetKey: 'martin_-_ignition',
    butterchurnPresetName: 'Martin - Ignition',
    beatIntensity: 1.0,
    
    // Layers
    layers: testLayers,
    
    // Audio
    audioPath: testAudioPath,
    normalizeAudio: false,
    audioCodec: undefined,
  })

  console.log(`✓ Scene created:`)
  console.log(`  - Resolution: ${scene.width}x${scene.height}`)
  console.log(`  - FPS: ${scene.fps}`)
  console.log(`  - Duration: ${scene.durationSec}s`)
  console.log(`  - Layers: ${scene.layers.length}`)
  console.log(`  - Visualizer: ${scene.visualizer.mode}`)

  // 4. Setup output path
  const outputFolder = path.join(os.homedir(), 'Videos', 'phase2-test')
  await fs.mkdir(outputFolder, { recursive: true })
  const outputFilename = `phase2_test_${Date.now()}.mp4`
  const outputPath = path.join(outputFolder, outputFilename)

  console.log(`\n[2/3] Exporting to: ${outputPath}`)

  // 5. Create export request with canvasScene
  const request: FinalExportRequestPayload & { canvasScene?: any } = {
    requestId: `phase2-test-${Date.now()}`,
    audioSource: { type: 'file', path: testAudioPath },
    videoSource: { type: 'folder', path: '' }, // Not used in Phase 2
    outputFolder,
    outputFilename,
    shuffle: false,
    forceReencode: false,
    normalizeAudio: false,
    useGpuEncoding: 'auto',
    
    // PHASE 2: Include canvas scene
    canvasScene: scene,
  }

  // 6. Export with progress tracking
  let lastPercent = 0
  await exportFinalVideo(request, {
    progress: (payload) => {
      const percent = Math.floor(payload.percent || 0)
      if (percent > lastPercent && percent % 10 === 0) {
        console.log(`  Progress: ${percent}% - ${payload.status || ''}`)
        lastPercent = percent
      }
    },
    done: (payload) => {
      console.log(`\n✓ Export complete!`)
      console.log(`  Output: ${payload.outputPaths?.[0] || outputPath}`)
      console.log(`  Duration: ${payload.totalDurationSec}s`)
    },
    error: (payload) => {
      console.error(`\n✗ Export failed: ${payload.error}`)
      throw new Error(payload.error)
    },
  })

  // 7. Verify output
  console.log(`\n[3/3] Verifying output...`)
  try {
    const stat = await fs.stat(outputPath)
    console.log(`✓ Output file exists`)
    console.log(`  Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`)
    
    // TODO: Add video probe to verify resolution, fps, duration
    console.log(`\n${'='.repeat(60)}`)
    console.log('PHASE 2 TEST COMPLETE!')
    console.log(`Play the video to verify text + visualizer are visible:`)
    console.log(`  ${outputPath}`)
    console.log('='.repeat(60))
  } catch (error) {
    console.error(`✗ Output file not found: ${outputPath}`)
    throw error
  }
}

// Run test
if (require.main === module) {
  testPhase2Export()
    .then(() => {
      console.log('\n✓ Test passed!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n✗ Test failed:', error)
      process.exit(1)
    })
}

export { testPhase2Export }
