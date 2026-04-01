import { spawn } from 'child_process'

export interface PlaybackTestResult {
  player: 'mpv' | 'vlc' | null
  success: boolean
  exitCode: number | null
}

function runPlayerOnce(
  cmd: string,
  args: string[],
  label: 'mpv' | 'vlc'
): Promise<PlaybackTestResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      child.on('error', () => {
        resolve({ player: label, success: false, exitCode: null })
      })
      child.on('close', (code) => {
        resolve({ player: label, success: code === 0, exitCode: code ?? null })
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




