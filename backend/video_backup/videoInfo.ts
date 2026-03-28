import { probeFile, type ProbeResult } from '../ffmpeg/probe'
import path from 'node:path'
import fs from 'node:fs'
import { getDiskInfo, type DiskType } from './detectDiskType'

export interface VideoFileInfo {
  path: string
  fileName: string
  durationSec: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  sizeBytes: number
  diskType?: DiskType
}

/**
 * Probe video file và convert sang VideoFileInfo
 * Bao gồm disk type detection
 */
export async function getVideoFileInfo(filePath: string): Promise<VideoFileInfo> {
  const probeResult: ProbeResult = await probeFile(filePath)

  if (!probeResult.video) {
    throw new Error('File không phải là video hoặc không có video stream')
  }

  const stats = fs.statSync(filePath)

  // Detect disk type (async, không block nếu fail)
  let diskType: DiskType | undefined
  try {
    const diskInfo = await getDiskInfo(filePath)
    diskType = diskInfo.type
  } catch (error) {
    console.warn('[getVideoFileInfo] Disk detection failed:', error)
    // diskType vẫn là undefined nếu fail
  }

  return {
    path: filePath,
    fileName: path.basename(filePath),
    durationSec: probeResult.format.duration || 0,
    width: probeResult.video.width || 0,
    height: probeResult.video.height || 0,
    fps: probeResult.video.fps || 0,
    videoCodec: probeResult.video.codec || 'unknown',
    audioCodec: probeResult.audio?.codec || null,
    sizeBytes: stats.size,
    diskType,
  }
}

