import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getFfmpegPaths } from '../backend/ffmpeg/config'
import { probeFile } from '../backend/ffmpeg/probe'
import { planFinalExport, executeFinalExport, type FinalExportEmitter } from '../backend/video/finalExport'

async function main() {
  console.log('======================================================================')
  console.log('  TẠO VIDEO 1 TIẾNG THỰC TẾ TỪ 2 FOLDER NGUYÊN LIỆU CỦA NGƯỜI DÙNG')
  console.log('  Folder nhạc: E:\\nguyen lieu nhac\\hardtechno da fix')
  console.log('  Folder video: E:\\nguyen lieu nhac\\video veo 3')
  console.log('======================================================================\n')

  const audioDir = 'E:\\nguyen lieu nhac\\hardtechno da fix'
  const videoDir = 'E:\\nguyen lieu nhac\\video veo 3'
  const outputDir = 'E:\\nguyen lieu nhac\\xuat_video_1_tieng'

  await fsp.mkdir(outputDir, { recursive: true })

  const ffmpegPaths = getFfmpegPaths()
  const ffmpegExe = ffmpegPaths.ffmpeg

  // ──── BƯỚC 1: LỰA CHỌN VÀ GHÉP CÁC BÀI NHẠC ĐỂ ĐẠT ĐÚNG 1 TIẾNG (3600 GIÂY) ────
  console.log('--- BƯỚC 1: QUÉT VÀ CHỌN CÁC BÀI NHẠC ĐỂ TẠO MASTER AUDIO 1 TIẾNG ---')
  const audioEntries = (await fsp.readdir(audioDir))
    .filter((name) => !name.startsWith('__') && /\.(wav|mp3|m4a|flac)$/i.test(name))
    .sort()

  console.log(`Tìm thấy ${audioEntries.length} file nhạc trong "${audioDir}"`)

  const TARGET_DURATION_SEC = 3600 // 1 tiếng = 3600 giây
  let accumulatedSec = 0
  const selectedAudioPaths: string[] = []

  for (const entry of audioEntries) {
    const fullPath = path.join(audioDir, entry)
    try {
      const info = await probeFile(fullPath)
      const dur = info.format?.duration || 0
      if (dur > 0) {
        selectedAudioPaths.push(fullPath)
        accumulatedSec += dur
        if (accumulatedSec >= TARGET_DURATION_SEC) break
      }
    } catch {
      // Bỏ qua nếu có file lỗi
    }
  }

  console.log(`Đã chọn ${selectedAudioPaths.length} bài nhạc, tổng thời lượng: ${(accumulatedSec / 60).toFixed(2)} phút (${accumulatedSec.toFixed(1)}s)`)

  // Tạo file concat list cho audio
  const masterAudioPath = path.join(outputDir, 'hardtechno_master_audio_1hour.m4a')
  const finalVideoFilename = 'Hardtechno_Veo3_Mix_1Hour_Final.mp4'
  const finalVideoPathTarget = path.join(outputDir, finalVideoFilename)

  await fsp.rm(masterAudioPath, { force: true }).catch(() => {})
  await fsp.rm(finalVideoPathTarget, { force: true }).catch(() => {})

  const audioConcatListPath = path.join(outputDir, 'audio_concat_temp.txt')

  // Ghi file danh sách concat (escape dấu nháy đơn đúng quy chuẩn FFmpeg)
  const listLines = selectedAudioPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
  await fsp.writeFile(audioConcatListPath, listLines.join('\n'), 'utf-8')

  console.log(`\nĐang xuất file master audio 1 tiếng (${TARGET_DURATION_SEC}s, AAC 384k 48kHz)...`)
  const audioStartTime = Date.now()

  // Concat và encode sang M4A (AAC chuẩn YouTube) với độ dài chuẩn 3600s
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-y',
      '-loglevel', 'error',
      '-f', 'concat',
      '-safe', '0',
      '-i', audioConcatListPath,
      '-t', String(TARGET_DURATION_SEC),
      '-c:a', 'aac',
      '-b:a', '384k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      masterAudioPath,
    ]

    const proc = spawn(ffmpegExe, args, { windowsHide: true })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg concat audio thất bại với mã ${code}`))
    })
    proc.on('error', reject)
  })

  // Dọn dẹp file list tạm
  await fsp.unlink(audioConcatListPath).catch(() => {})

  const audioElapsed = ((Date.now() - audioStartTime) / 1000).toFixed(1)
  const masterAudioInfo = await probeFile(masterAudioPath)
  const masterAudioSizeMB = (fs.statSync(masterAudioPath).size / (1024 * 1024)).toFixed(2)

  console.log(`✓ Master audio đã sẵn sàng (${audioElapsed}s):`)
  console.log(`  File: ${masterAudioPath}`)
  console.log(`  Dung lượng: ${masterAudioSizeMB} MB`)
  console.log(`  Thời lượng: ${masterAudioInfo.format?.duration?.toFixed(2)}s (~${((masterAudioInfo.format?.duration || 0) / 60).toFixed(1)} phút)`)

  // ──── BƯỚC 2: PLAN VÀ EXECUTE FINAL EXPORT (GHÉP CÙNG 6.612 VIDEO CLIPS) ────
  console.log('\n--- BƯỚC 2: LẬP KẾ HOẠCH VÀ GHÉP VIDEO 1 TIẾNG BẰNG ENGINE CHÍNH CỦA TOOL ---')

  const planStart = Date.now()

  const plan = await planFinalExport(
    { type: 'file', path: masterAudioPath },
    { type: 'folder', path: videoDir },
    outputDir,
    finalVideoFilename,
    [finalVideoFilename],
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    'req-1hour-user-test',
  )

  const planElapsed = ((Date.now() - planStart) / 1000).toFixed(1)
  console.log(`✓ Lập kế hoạch hoàn tất (${planElapsed}s):`)
  console.log(`  - Pool video: ${plan.videoClips.length} clips`)
  console.log(`  - File audio: 1 job (${plan.totalAudioDurationSec.toFixed(1)}s = 1.0 tiếng)`)

  // Emitter theo dõi tiến độ
  let lastPercent = -1
  const emitter: FinalExportEmitter = {
    progress: (p) => {
      const rounded = Math.floor(p.percent || 0)
      if (rounded % 10 === 0 && rounded !== lastPercent) {
        lastPercent = rounded
        const speed = p.speedX ? ` (tốc độ: ${p.speedX.toFixed(1)}x)` : ''
        console.log(`  [Tiến độ xuất video] ${p.stage}: ${rounded}%${speed}`)
      }
    },
    done: () => {},
    error: (e) => console.error('[Lỗi xuất video]', e),
  }

  console.log('\n--- BƯỚC 3: BẮT ĐẦU XUẤT THỰC TẾ VIDEO 1 TIẾNG ---')
  const exportStartTime = Date.now()

  const result = await executeFinalExport(
    plan,
    'req-1hour-user-test',
    emitter,
    true, // Bật xáo trộn (shuffle) video clip ngẫu nhiên phong phú
    false,
    false,
    false,
    'cpu', // copy-stream kết hợp muxing
  )

  const exportElapsed = ((Date.now() - exportStartTime) / 1000).toFixed(1)

  if (!result.outputs || result.outputs.length === 0) {
    throw new Error('Không tạo được file video output!')
  }

  const finalVideoPath = result.outputs[0].videoFile
  const finalInfo = await probeFile(finalVideoPath)
  const finalStat = fs.statSync(finalVideoPath)
  const finalSizeMB = (finalStat.size / (1024 * 1024)).toFixed(2)

  console.log('\n======================================================================')
  console.log('              XUẤT VIDEO 1 TIẾNG THÀNH CÔNG RỰC RỠ!')
  console.log('======================================================================')
  console.log(`Đường dẫn file: ${finalVideoPath}`)
  console.log(`Dung lượng file: ${finalSizeMB} MB`)
  console.log(`Độ phân giải: ${finalInfo.video?.width}x${finalInfo.video?.height}`)
  console.log(`Video Codec: ${finalInfo.video?.codec}`)
  console.log(`Audio Codec: ${finalInfo.audio?.codec}`)
  console.log(`Thời lượng thực tế: ${finalInfo.format?.duration?.toFixed(2)}s (~${((finalInfo.format?.duration || 0) / 60).toFixed(2)} phút)`)
  console.log(`Thời gian render: ${exportElapsed} giây`)
  console.log('======================================================================\n')
}

main().catch((err) => {
  console.error('\nLỖI QUY TRÌNH:', err)
  process.exit(1)
})
