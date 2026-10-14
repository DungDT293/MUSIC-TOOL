import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { getFfmpegPaths } from '../../../backend/ffmpeg/config'
import { probeFile } from '../../../backend/ffmpeg/probe'
import { mergeVideosSimple } from '../../../backend/video/mergeVideosSimple'
import { planFinalExport, executeFinalExport, type FinalExportEmitter } from '../../../backend/video/finalExport'

const { ffmpeg: ffmpegBin } = getFfmpegPaths()
const testDir = path.join(os.tmpdir(), `real_corrupt_test_${Date.now()}`)

let validVideo1: string
let validVideo2: string
let validVideo3: string
let corruptVideoEmpty: string
let corruptVideoGarbage: string

let validAudio1: string
let validAudio2: string
let corruptAudioEmpty: string
let corruptAudioGarbage: string

beforeAll(async () => {
  await fsp.mkdir(testDir, { recursive: true })

  validVideo1 = path.join(testDir, 'valid_red_5s.mp4')
  validVideo2 = path.join(testDir, 'valid_blue_5s.mp4')
  validVideo3 = path.join(testDir, 'valid_green_5s.mp4')
  corruptVideoEmpty = path.join(testDir, 'corrupt_empty.mp4')
  corruptVideoGarbage = path.join(testDir, 'corrupt_garbage.mp4')

  validAudio1 = path.join(testDir, 'valid_tone_10s.m4a')
  validAudio2 = path.join(testDir, 'valid_tone_12s.m4a')
  corruptAudioEmpty = path.join(testDir, 'corrupt_empty.m4a')
  corruptAudioGarbage = path.join(testDir, 'corrupt_garbage.m4a')

  // Tạo 3 video thật (mỗi video 5s, 640x360, 30fps) bằng FFmpeg thật
  spawnSync(ffmpegBin, [
    '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=5:r=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', validVideo1,
  ])
  spawnSync(ffmpegBin, [
    '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=5:r=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', validVideo2,
  ])
  spawnSync(ffmpegBin, [
    '-y', '-f', 'lavfi', '-i', 'color=c=green:s=640x360:d=5:r=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', validVideo3,
  ])

  // Tạo 2 video hỏng
  await fsp.writeFile(corruptVideoEmpty, Buffer.alloc(0))
  await fsp.writeFile(corruptVideoGarbage, randomBytes(50 * 1024))

  // Tạo 2 audio thật bằng FFmpeg thật
  spawnSync(ffmpegBin, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
    '-c:a', 'aac', '-b:a', '128k', validAudio1,
  ])
  spawnSync(ffmpegBin, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=12',
    '-c:a', 'aac', '-b:a', '128k', validAudio2,
  ])

  // Tạo 2 audio hỏng
  await fsp.writeFile(corruptAudioEmpty, Buffer.alloc(0))
  await fsp.writeFile(corruptAudioGarbage, randomBytes(30 * 1024))
})

afterAll(async () => {
  try {
    await fsp.rm(testDir, { recursive: true, force: true })
  } catch {}
})

describe('REAL MEDIA PIPELINE TEST: Xử lý video/audio hỏng thực tế trên đĩa', () => {
  it('mergeVideosSimple: Tự động loại bỏ video hỏng và dùng video tốt bù đắp đủ target duration', async () => {
    const outDir = path.join(testDir, 'merge_out')
    await fsp.mkdir(outDir, { recursive: true })

    // Trộn lẫn 3 video thật (5s x 3 = 15s) và 2 video hỏng
    const mixedInputVideos = [
      validVideo1,
      corruptVideoEmpty,
      validVideo2,
      corruptVideoGarbage,
      validVideo3,
    ]

    const progressMessages: string[] = []

    // Yêu cầu thời lượng mục tiêu: 22 giây (lớn hơn 15s của 3 clip, tool phải bù đắp bằng cách loop các clip tốt)
    const result = await mergeVideosSimple({
      inputFiles: mixedInputVideos,
      outputDir: outDir,
      outputFileName: 'real_merged_test',
      shuffle: true,
      mergeCount: 1,
      targetDurationSec: 22,
    }, (prog) => {
      if (prog.message) progressMessages.push(prog.message)
    })

    console.log('mergeVideosSimple RESULT:', JSON.stringify(result, null, 2))
    expect(result.success).toBe(true)
    expect(result.outputPaths).toBeDefined()
    expect(result.outputPaths!.length).toBe(1)

    const mergedFilePath = result.outputPaths![0]
    expect(fs.existsSync(mergedFilePath)).toBe(true)

    // Xác thực video xuất ra bằng ffprobe thật
    const probe = await probeFile(mergedFilePath)
    expect(probe).toBeDefined()
    expect(probe?.video).toBeDefined()
    expect(probe?.video?.width).toBe(640)
    expect(probe?.video?.height).toBe(360)

    // Thời lượng thực tế phải >= 22 giây (được bù đắp hoàn chỉnh)
    const actualDuration = probe?.format?.duration ?? 0
    expect(actualDuration).toBeGreaterThanOrEqual(21.5)

    // Tool phải có thông báo đã bỏ qua 2 video hỏng
    const skippedMsg = progressMessages.find((m) => m.includes('bỏ qua 2 video lỗi'))
    expect(skippedMsg).toBeDefined()
  }, 45000)

  it('finalExport: Quét nguồn có file audio hỏng và video hỏng -> loại bỏ file hỏng, xuất thành công các video chuẩn', async () => {
    const finalOutDir = path.join(testDir, 'final_out')
    await fsp.mkdir(finalOutDir, { recursive: true })

    // Danh sách audio: 2 file chuẩn (10s và 12s), 2 file hỏng
    const mixedAudioList = [
      validAudio1,
      corruptAudioEmpty,
      validAudio2,
      corruptAudioGarbage,
    ]

    // Danh sách video: 3 file chuẩn (5s x 3), 2 file hỏng
    const mixedVideoList = [
      validVideo1,
      corruptVideoEmpty,
      validVideo2,
      corruptVideoGarbage,
      validVideo3,
    ]

    const requestId = `test-req-${Date.now()}`

    // 1. Tạo plan: phải tự động loại 2 audio hỏng và 2 video hỏng, chỉ giữ lại 2 audio chuẩn (2 jobs)
    const plan = await planFinalExport(
      { type: 'files', path: mixedAudioList[0], paths: mixedAudioList },
      { type: 'files', path: mixedVideoList[0], paths: mixedVideoList, strictPairing: false },
      finalOutDir,
      'final_test.mp4',
      ['Output_Audio1', 'Output_Audio2'],
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      requestId,
    )

    // Phải có đúng 2 jobs tương ứng với 2 audio hợp lệ
    expect(plan.jobs).toHaveLength(2)
    expect(plan.totalJobs).toBe(2)

    // Pool video hợp lệ phải chứa đủ 3 video tốt (không chứa video hỏng)
    expect(plan.videoClips).toHaveLength(3)
    const planVideoPaths = plan.videoClips.map((c) => c.path)
    expect(planVideoPaths).not.toContain(corruptVideoEmpty)
    expect(planVideoPaths).not.toContain(corruptVideoGarbage)

    // 2. Chạy execute export thật bằng FFmpeg
    const dummyEmitter: FinalExportEmitter = {
      progress: () => {},
      done: () => {},
      error: () => {},
    }

    const donePayload = await executeFinalExport(
      plan,
      requestId,
      dummyEmitter,
      true, // shuffle
      false, // copy-stream
      false,
      false,
      'cpu',
    )

    expect(donePayload.outputs).toHaveLength(2)
    expect(donePayload.failedJobs).toBeUndefined()

    // 3. Kiểm tra từng file video xuất ra bằng ffprobe thật
    for (let i = 0; i < donePayload.outputs.length; i++) {
      const out = donePayload.outputs[i]
      expect(fs.existsSync(out.videoFile)).toBe(true)
      const stat = fs.statSync(out.videoFile)
      expect(stat.size).toBeGreaterThan(10000) // File có dữ liệu thật

      const verifyProbe = await probeFile(out.videoFile)
      expect(verifyProbe?.video).toBeDefined()
      expect(verifyProbe?.audio).toBeDefined()
      expect(verifyProbe?.video?.width).toBe(640)
      expect(verifyProbe?.video?.height).toBe(360)

      // Kiểm tra thời lượng khớp với audio của job đó
      const expectedAudioDur = i === 0 ? 10 : 12
      expect(verifyProbe?.format?.duration).toBeGreaterThanOrEqual(expectedAudioDur - 0.5)
    }
  }, 60000)
})
