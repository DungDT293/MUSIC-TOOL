import { spawn } from 'child_process'

export interface PlaybackTestResult {
  player: 'mpv' | 'vlc' | null
  success: boolean
  exitCode: number | null
}

const PLAYBACK_TIMEOUT_MS = 30_000 // 30 seconds timeout to prevent infinite hang

function runPlayerOnce(
  cmd: string,
  args: string[],
  label: 'mpv' | 'vlc'
): Promise<PlaybackTestResult> {
  return new Promise((resolve) => {
    let resolved = false
    const safeResolve = (result: PlaybackTestResult) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve(result)
    }

    try {
      const child = spawn(cmd, args, { windowsHide: true })

      // Timeout to prevent infinite hang if player gets stuck
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        safeResolve({ player: label, success: false, exitCode: null })
      }, PLAYBACK_TIMEOUT_MS)

      child.on('error', () => {
        safeResolve({ player: label, success: false, exitCode: null })
      })
      child.on('close', (code) => {
        safeResolve({ player: label, success: code === 0, exitCode: code ?? null })
      })
    } catch {
      resolve({ player: label, success: false, exitCode: null })
    }
  })
}

export async function runPlaybackTest(outputPath: string): Promise<PlaybackTestResult> {
  // Ưu tiên mpv nếu có
  const mpvArgs = ['--no-config', '--really-quiet', '--vo=null', '--ao=null', '--length=5', outputPath]
  const vlcArgs = [
    '-I',
    'dummy',
    '--play-and-exit',
    '--no-video-title-show',
    '--start-time=0',
    '--run-time=5',
    outputPath,
  ]

  const mpvResult = await runPlayerOnce('mpv', mpvArgs, 'mpv')
  if (mpvResult.success) return mpvResult

  const vlcResult = await runPlayerOnce('vlc', vlcArgs, 'vlc')
  if (vlcResult.success) return vlcResult

  // Nếu cả 2 đều không chạy được thành công, trả về kết quả xấu nhất (ưu tiên mpv nếu có thử)
  if (mpvResult.player && mpvResult.exitCode !== null) return mpvResult
  if (vlcResult.player && vlcResult.exitCode !== null) return vlcResult

  return { player: null, success: false, exitCode: null }
}
