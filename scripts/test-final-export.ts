import path from 'path'
import { exportFinalVideo } from '../backend/video/finalExport'
import type { FinalExportRequestPayload } from '../shared/videoFinalExportChannels'

async function main() {
  const projectRoot = path.resolve(__dirname, '..')
  const audioDir = path.join(projectRoot, 'tmp', 'final-export', 'audio')
  const videoDir = path.join(projectRoot, 'tmp', 'final-export', 'video')
  const outputDir = path.join(projectRoot, 'tmp', 'final-export', 'output')

  const audioPaths = [
    path.join(audioDir, 'audio1.mp3'),
    path.join(audioDir, 'audio2.mp3'),
  ]
  const videoPaths = [
    path.join(videoDir, 'video1.mp4'),
    path.join(videoDir, 'video2.mp4'),
  ]

  const payload: FinalExportRequestPayload = {
    requestId: `test-final-export-${Date.now()}`,
    audioSource: { type: 'files', path: audioPaths[0], paths: audioPaths },
    videoSource: { type: 'files', path: videoPaths[0], paths: videoPaths },
    outputFolder: outputDir,
    outputFilename: 'final_test.mp4',
    tracklistAuto: false,
    forceReencode: false,
    normalizeAudio: false,
  }

  console.log('[Test] Starting final export with payload:', JSON.stringify(payload, null, 2))

  await exportFinalVideo(payload, {
    progress: (p) => {
      const percent = typeof p.percent === 'number' ? p.percent.toFixed(2) : 'N/A'
      console.log(`[Progress] ${percent}% - ${p.status || ''}`)
    },
    done: (d) => {
      console.log('[Done]', d)
    },
    error: (err) => {
      console.error('[Error]', err)
    },
  })

  console.log('[Test] Final export finished successfully')
}

main().catch((err) => {
  console.error('[Test] Final export failed:', err)
  process.exit(1)
})
