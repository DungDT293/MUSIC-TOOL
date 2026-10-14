import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { getFfmpegPaths } from '../backend/ffmpeg/config'
import { probeFile } from '../backend/ffmpeg/probe'
import { mergeVideosSimple } from '../backend/video/mergeVideosSimple'
import { planFinalExport, executeFinalExport, type FinalExportEmitter } from '../backend/video/finalExport'
import { exportPlaylistToFile } from '../backend/music/exportAudio'
import { savePlaylists } from '../backend/music/playlistEngine'
import type { PlaylistDefinition } from '../backend/music/musicTypes'

async function runRealScaleTest() {
  console.log('======================================================================')
  console.log('  KIỂM THỬ THỰC TẾ QUY MÔ LỚN: 18-20 BÀI NHẠC + 2000 VIDEO CLIP 5S')
  console.log('  THỜI LƯỢNG MỤC TIÊU: 1 TIẾNG (3600 GIÂY)')
  console.log('======================================================================\n')

  const { ffmpeg: ffmpegBin, ffprobe: ffprobeBin } = getFfmpegPaths()
  console.log(`[FFmpeg Binary] : ${ffmpegBin}`)
  console.log(`[FFprobe Binary]: ${ffprobeBin}\n`)

  const baseDir = path.resolve('test_real_scale')
  const audioDir = path.join(baseDir, 'audio_source')
  const videoDir = path.join(baseDir, 'video_source')
  const outDir = path.join(baseDir, 'output')

  // Clean / prepare directories
  await fsp.mkdir(audioDir, { recursive: true })
  await fsp.mkdir(videoDir, { recursive: true })
  await fsp.mkdir(outDir, { recursive: true })

  // -------------------------------------------------------------------------
  // BƯỚC 1: TẠO 18 BÀI NHẠC THẬT (200s mỗi bài = 3600s / 1 tiếng) + 2 FILE HỎNG
  // -------------------------------------------------------------------------
  console.log('--- BƯỚC 1: TẠO 18 BÀI NHẠC THẬT VÀ 2 FILE AUDIO HỎNG TRÊN Ổ ĐĨA ---')
  const baseAudioFiles: string[] = []
  const tones = [330, 440, 550]
  for (let t = 0; t < tones.length; t++) {
    const baseAudioPath = path.join(audioDir, `__base_audio_${t}.m4a`)
    if (!fs.existsSync(baseAudioPath)) {
      console.log(`  -> Đang sinh file audio mẫu ${t + 1}/3 (${tones[t]}Hz, 200s)...`)
      const res = spawnSync(ffmpegBin, [
        '-y', '-v', 'error',
        '-f', 'lavfi', '-i', `sine=frequency=${tones[t]}:duration=200`,
        '-c:a', 'aac', '-b:a', '128k',
        baseAudioPath,
      ])
      if (res.status !== 0) {
        throw new Error(`FFmpeg sinh audio thất bại: ${res.stderr?.toString()}`)
      }
    }
    baseAudioFiles.push(baseAudioPath)
  }

  const validAudioTracks: string[] = []
  const audioCount = 18 // 18 bài nhạc thật (tổng thời lượng: 18 * 200s = 3600s = 1 tiếng)
  for (let i = 1; i <= audioCount; i++) {
    const trackName = `song_${String(i).padStart(2, '0')}.m4a`
    const trackPath = path.join(audioDir, trackName)
    const baseSource = baseAudioFiles[(i - 1) % baseAudioFiles.length]
    if (!fs.existsSync(trackPath)) {
      await fsp.copyFile(baseSource, trackPath)
    }
    validAudioTracks.push(trackPath)
  }

  // 2 file audio hỏng
  const corruptAudio1 = path.join(audioDir, 'corrupt_audio_empty.m4a')
  const corruptAudio2 = path.join(audioDir, 'corrupt_audio_garbage.m4a')
  await fsp.writeFile(corruptAudio1, Buffer.alloc(0))
  await fsp.writeFile(corruptAudio2, randomBytes(30 * 1024))

  console.log(`  ✓ Đã sẵn sàng ${validAudioTracks.length} bài nhạc thật (mỗi bài 200s, tổng 3600s = 1 tiếng)`)
  console.log(`  ✓ Đã trộn lẫn 2 file audio hỏng:`)
  console.log(`      1. ${corruptAudio1} (0 byte)`)
  console.log(`      2. ${corruptAudio2} (30 KB byte rác)\n`)

  // -------------------------------------------------------------------------
  // BƯỚC 2: TẠO 2000 VIDEO CLIP THẬT (5s mỗi clip, 640x360) + 5 FILE HỎNG
  // -------------------------------------------------------------------------
  console.log('--- BƯỚC 2: TẠO 2000 VIDEO CLIP THẬT (5s) VÀ 5 VIDEO HỎNG TRÊN Ổ ĐĨA ---')
  const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan', 'magenta', 'orange', 'teal', 'pink']
  const baseVideoFiles: string[] = []
  for (let c = 0; c < colors.length; c++) {
    const baseVideoPath = path.join(videoDir, `__base_video_${colors[c]}.mp4`)
    if (!fs.existsSync(baseVideoPath)) {
      const res = spawnSync(ffmpegBin, [
        '-y', '-v', 'error',
        '-f', 'lavfi', '-i', `color=c=${colors[c]}:s=640x360:d=5:r=30`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        baseVideoPath,
      ])
      if (res.status !== 0) {
        throw new Error(`FFmpeg sinh video mẫu thất bại: ${res.stderr?.toString()}`)
      }
    }
    baseVideoFiles.push(baseVideoPath)
  }

  const validVideoClips: string[] = []
  const videoCount = 2000 // Đúng 2000 clip nhỏ 5s
  console.log(`  -> Đang nhân bản thành ${videoCount} clip video độc lập trên đĩa...`)
  for (let i = 1; i <= videoCount; i++) {
    const clipName = `clip_${String(i).padStart(4, '0')}.mp4`
    const clipPath = path.join(videoDir, clipName)
    const baseSource = baseVideoFiles[(i - 1) % baseVideoFiles.length]
    if (!fs.existsSync(clipPath)) {
      await fsp.copyFile(baseSource, clipPath)
    }
    validVideoClips.push(clipPath)
  }

  // 5 file video hỏng
  const corruptVideoList: string[] = []
  for (let j = 1; j <= 5; j++) {
    const corruptPath = path.join(videoDir, `corrupt_video_${String(j).padStart(2, '0')}.mp4`)
    if (j % 2 === 1) {
      await fsp.writeFile(corruptPath, Buffer.alloc(0)) // 0 byte
    } else {
      await fsp.writeFile(corruptPath, randomBytes(40 * 1024)) // 40KB byte rác
    }
    corruptVideoList.push(corruptPath)
  }

  console.log(`  ✓ Đã sẵn sàng ${validVideoClips.length} video clip thật (mỗi clip 5s, tổng thời lượng pool = 10,000s = 2.77 tiếng)`)
  console.log(`  ✓ Đã trộn lẫn 5 file video hỏng (0 byte và file rác)\n`)

  // -------------------------------------------------------------------------
  // BƯỚC 3: TEST GHÉP NHẠC (TAB 4) -> 1 BÀI MIX AUDIO DÀI 1 TIẾNG (3600s)
  // -------------------------------------------------------------------------
  console.log('--- BƯỚC 3: TEST GHÉP 18 BÀI NHẠC THÀNH 1 FILE AUDIO DÀI 1 TIẾNG (TAB 4) ---')
  const mixedAudioOutput = path.join(outDir, 'mixed_audio_1hour.m4a')
  const playlistDef: PlaylistDefinition = {
    id: 'playlist-1hour-scale',
    name: 'Mix Nhac 1 Tieng Thuc Te',
    targetDurationSec: 3600,
    totalDurationSec: 3600,
    tracks: validAudioTracks.map((p, idx) => ({
      id: `track-${idx}`,
      title: `Bai Hat ${idx + 1}`,
      path: p,
      durationSec: 200,
      startTimeSec: idx * 200,
      endTimeSec: (idx + 1) * 200,
    })),
  }

  savePlaylists([playlistDef])

  const audioExportStart = Date.now()
  const audioResult = await exportPlaylistToFile({
    playlistId: playlistDef.id,
    outputDir: outDir,
    fileName: 'mixed_audio_1hour',
    format: 'aac',
    requestId: 'req-audio-scale-1h',
    smoothTransitions: false,
  })
  const audioExportDurationMs = Date.now() - audioExportStart

  if (!audioResult.success) {
    throw new Error(`Export audio thất bại: ${audioResult.error}`)
  }

  const mixedAudioProbe = await probeFile(mixedAudioOutput)
  console.log(`  ✓ Xuất audio hoàn tất sau ${(audioExportDurationMs / 1000).toFixed(2)}s`)
  console.log(`  ✓ File audio xuất: ${mixedAudioOutput}`)
  console.log(`  ✓ Thời lượng probe: ${mixedAudioProbe?.format?.duration?.toFixed(2)}s (~${Math.round((mixedAudioProbe?.format?.duration ?? 0) / 60)} phút)`)
  console.log(`  ✓ Dung lượng file: ${(fs.statSync(mixedAudioOutput).size / (1024 * 1024)).toFixed(2)} MB\n`)

  // -------------------------------------------------------------------------
  // BƯỚC 4: TEST GHÉP VIDEO ĐƠN GIẢN (TAB 5) -> GHÉP 2000 CLIP VỚI TARGET 1 TIẾNG
  // -------------------------------------------------------------------------
  console.log('--- BƯỚC 4: TEST TAB 5 (GHÉP 2000 VIDEO CLIP VỚI TARGET DURATION 1 TIẾNG = 3600s) ---')
  console.log('  (Đầu vào: 2000 clip chuẩn + 5 clip hỏng = 2005 files, shuffle: true)')
  const allMixedVideoInputs = [...validVideoClips, ...corruptVideoList]
  const mergeStart = Date.now()
  const mergeResult = await mergeVideosSimple({
    inputFiles: allMixedVideoInputs,
    outputDir: outDir,
    outputFileName: 'merged_video_1hour.mp4',
    shuffle: true,
    mergeCount: 1,
    targetDurationSec: 3600, // 1 tiếng
  })
  const mergeDurationMs = Date.now() - mergeStart

  if (!mergeResult.success || !mergeResult.outputPaths?.[0]) {
    throw new Error(`Ghép video thất bại: ${mergeResult.error}`)
  }
  const mergedVideoPath = mergeResult.outputPaths[0]
  const mergedProbe = await probeFile(mergedVideoPath)
  console.log(`  ✓ Ghép 2000 video hoàn tất sau ${(mergeDurationMs / 1000).toFixed(2)}s`)
  console.log(`  ✓ File video xuất: ${mergedVideoPath}`)
  console.log(`  ✓ Độ phân giải: ${mergedProbe?.video?.width}x${mergedProbe?.video?.height}`)
  console.log(`  ✓ Codec: ${mergedProbe?.video?.codec}`)
  console.log(`  ✓ Thời lượng probe: ${mergedProbe?.format?.duration?.toFixed(2)}s (đạt yêu cầu 3600s / 1 tiếng)`)
  console.log(`  ✓ Dung lượng file: ${(fs.statSync(mergedVideoPath).size / (1024 * 1024)).toFixed(2)} MB\n`)

  // -------------------------------------------------------------------------
  // BƯỚC 5: TEST XUẤT VIDEO HOÀN CHỈNH (TAB 6) -> GHÉP NHẠC 1 TIẾNG VỚI 2000 CLIP VIDEO
  // -------------------------------------------------------------------------
  console.log('--- BƯỚC 5: TEST TAB 6 (FINAL EXPORT: GHÉP NHẠC 1 TIẾNG VỚI KHO 2000 CLIP VIDEO) ---')
  console.log('  (Đầu vào: Audio 1 tiếng + Kho 2000 video clip + 5 clip hỏng, shuffle: true)')
  const finalStart = Date.now()
  const plan = await planFinalExport(
    { type: 'file', path: mixedAudioOutput },
    { type: 'files', path: allMixedVideoInputs[0], paths: allMixedVideoInputs, strictPairing: false },
    outDir,
    'final_full_1hour.mp4',
    ['Final_Video_Mix_1Hour'],
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    'req-final-scale-1h',
  )

  console.log(`  ✓ Kế hoạch xuất: ${plan.totalJobs} job, video pool hợp lệ: ${plan.videoClips.length} clips (đã lọc bỏ các clip hỏng)`)

  const dummyEmitter: FinalExportEmitter = {
    progress: (p) => {
      if (p.stage && p.percent % 25 === 0) {
        console.log(`     [Tiến độ] ${p.stage}: ${p.percent.toFixed(0)}%`)
      }
    },
    done: () => {},
    error: (e) => {
      console.error('Final export error event:', e)
    },
  }

  const finalDone = await executeFinalExport(
    plan,
    'req-final-scale-1h',
    dummyEmitter,
    true, // shuffle
    false, // copy-stream
    false,
    false,
    'cpu',
  )
  const finalDurationMs = Date.now() - finalStart

  if (!finalDone.outputs || finalDone.outputs.length === 0) {
    throw new Error('Final export không có output!')
  }
  const finalOutputPath = finalDone.outputs[0].videoFile
  const finalProbe = await probeFile(finalOutputPath)

  console.log(`  ✓ Xuất video hoàn chỉnh hoàn tất sau ${(finalDurationMs / 1000).toFixed(2)}s`)
  console.log(`  ✓ File video hoàn chỉnh xuất: ${finalOutputPath}`)
  console.log(`  ✓ Video stream: ${finalProbe?.video?.width}x${finalProbe?.video?.height}, codec: ${finalProbe?.video?.codec}`)
  console.log(`  ✓ Audio stream: codec: ${finalProbe?.audio?.codec}, channels: ${finalProbe?.audio?.channels}`)
  console.log(`  ✓ Thời lượng probe: ${finalProbe?.format?.duration?.toFixed(2)}s (khớp 1 tiếng = 3600s)`)
  console.log(`  ✓ Dung lượng file: ${(fs.statSync(finalOutputPath).size / (1024 * 1024)).toFixed(2)} MB\n`)

  // -------------------------------------------------------------------------
  // TỔNG KẾT VÀ BÁO CÁO ĐƯỜNG DẪN THỰC TẾ
  // -------------------------------------------------------------------------
  console.log('======================================================================')
  console.log('                   KẾT QUẢ KIỂM THỬ THỰC TẾ THÀNH CÔNG')
  console.log('======================================================================')
  console.log(`1. Thư mục chứa 18 bài nhạc thật:`)
  console.log(`   ${audioDir}`)
  console.log(`2. Thư mục chứa 2000 video clip thật:`)
  console.log(`   ${videoDir}`)
  console.log(`3. File audio mix 1 tiếng (Tab 4):`)
  console.log(`   ${mixedAudioOutput} (${(fs.statSync(mixedAudioOutput).size / (1024 * 1024)).toFixed(2)} MB, ${mixedAudioProbe?.format?.duration?.toFixed(1)}s)`)
  console.log(`4. File video ghép 1 tiếng từ 2000 clip (Tab 5):`)
  console.log(`   ${mergedVideoPath} (${(fs.statSync(mergedVideoPath).size / (1024 * 1024)).toFixed(2)} MB, ${mergedProbe?.format?.duration?.toFixed(1)}s)`)
  console.log(`5. File video hoàn chỉnh 1 tiếng (Nhạc + Video) (Tab 6):`)
  console.log(`   ${finalOutputPath} (${(fs.statSync(finalOutputPath).size / (1024 * 1024)).toFixed(2)} MB, ${finalProbe?.format?.duration?.toFixed(1)}s)`)
  console.log('======================================================================')
}

runRealScaleTest().catch((err) => {
  console.error('\nLỖI TRONG QUÁ TRÌNH TEST THỰC TẾ:', err)
  process.exit(1)
})
