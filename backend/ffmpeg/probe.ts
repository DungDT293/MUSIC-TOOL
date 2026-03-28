/**
 * FFmpeg Probe - Probe file để lấy metadata (audio/video)
 */

import { runFfprobe } from './wrapper'
import fs from 'node:fs'

export interface ProbeResult {
  path: string
  format: {
    duration: number
    size: number
    bit_rate?: number
    start_time?: number
    tags?: {
      title?: string
      artist?: string
      album?: string
      album_artist?: string
      genre?: string
      date?: string
      [key: string]: string | undefined
    }
  }
  audio?: {
    codec: string
    sample_rate: number
    channels: number
    channel_layout?: string
  }
  video?: {
    codec: string
    width: number
    height: number
    fps: number
    pix_fmt?: string
  }
}

/**
 * Probe file để lấy metadata (audio/video streams, format info)
 */
export async function probeFile(filePath: string): Promise<ProbeResult> {
  // Kiểm tra file tồn tại
  if (!fs.existsSync(filePath)) {
    throw new Error(`File không tồn tại: ${filePath}`)
  }

  // Dùng ffprobe để lấy metadata (bao gồm tags và lyrics)
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration,size,bit_rate,start_time:format_tags=title,artist,album,album_artist,genre,date,lyrics,LYRICS,USLT:stream=codec_name,codec_type,sample_rate,channels,channel_layout,width,height,r_frame_rate,pix_fmt',
    '-of', 'json',
    filePath,
  ]

  try {
    const output = await runFfprobe(args)
    
    if (!output || output.trim().length === 0) {
      throw new Error(`FFprobe returned empty output for: ${filePath}`)
    }

    const json = JSON.parse(output)

    const format = json.format || {}
    const streams = Array.isArray(json.streams) ? json.streams : []

    // Tìm audio và video streams (không dùng .find trực tiếp trên đối tượng có thể undefined)
    let audioStream: any = undefined
    let videoStream: any = undefined
    for (const s of streams) {
      if (!audioStream && s?.codec_type === 'audio') audioStream = s
      else if (!videoStream && s?.codec_type === 'video') videoStream = s
      if (audioStream && videoStream) break
    }

    // Parse format info
    const formatInfo = {
      duration: format.duration ? parseFloat(format.duration) : 0,
      size: format.size ? parseInt(format.size, 10) : 0,
      bit_rate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
      start_time: format.start_time ? parseFloat(format.start_time) : undefined,
      tags: {
        ...(format.tags || {}),
        // Try to get lyrics from various tag formats
        lyrics: format.tags?.lyrics || format.tags?.LYRICS || format.tags?.USLT || undefined,
      },
    }

    // Parse audio stream
    let audioInfo: ProbeResult['audio'] | undefined
    if (audioStream) {
      // Parse frame rate cho audio (thường là sample_rate)
      const sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : 0
      const channels = audioStream.channels ? parseInt(audioStream.channels, 10) : 0

      audioInfo = {
        codec: audioStream.codec_name || 'unknown',
        sample_rate: sampleRate,
        channels: channels,
        channel_layout: audioStream.channel_layout || undefined,
      }
    }

    // Parse video stream
    let videoInfo: ProbeResult['video'] | undefined
    if (videoStream) {
      // Parse frame rate (r_frame_rate format: "30/1" hoặc "29.97")
      let fps = 0
      if (videoStream.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split('/')
        if (parts.length === 2) {
          const num = parseFloat(parts[0])
          const den = parseFloat(parts[1])
          fps = den > 0 ? num / den : 0
        } else {
          fps = parseFloat(videoStream.r_frame_rate) || 0
        }
      }

      videoInfo = {
        codec: videoStream.codec_name || 'unknown',
        width: videoStream.width ? parseInt(videoStream.width, 10) : 0,
        height: videoStream.height ? parseInt(videoStream.height, 10) : 0,
        fps: fps,
        pix_fmt: videoStream.pix_fmt || undefined,
      }
    }

    return {
      path: filePath,
      format: formatInfo,
      audio: audioInfo,
      video: videoInfo,
    }
  } catch (error: any) {
    console.error(`[probeFile] Error probing file ${filePath}:`, error)
    // Re-throw với message rõ ràng hơn
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse FFprobe JSON output for ${filePath}: ${error.message}`)
    }
    throw error
  }
}
