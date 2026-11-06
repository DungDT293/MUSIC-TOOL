import type { LyricLine } from './layerTypes'

const LRC_TIME = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g

/**
 * Parses lyrics into timed lines.
 *
 * Accepts LRC (`[00:12.34] text`) and plain text. Plain text is spread evenly across
 * the track so a pasted lyric is usable immediately; the user can still edit timings.
 */
export function parseLyrics(input: string, durationSec: number): LyricLine[] {
  const raw = input.replace(/\r\n/g, '\n').trim()
  if (!raw) return []

  const lines: LyricLine[] = []
  for (const row of raw.split('\n')) {
    const text = row.replace(LRC_TIME, '').trim()
    if (!text) continue
    LRC_TIME.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    while ((match = LRC_TIME.exec(row)) !== null) {
      const minutes = Number(match[1] ?? 0)
      const seconds = Number(match[2] ?? 0)
      const fractionRaw = match[3] ?? '0'
      const fraction = Number(fractionRaw) / Math.pow(10, fractionRaw.length)
      stamps.push(minutes * 60 + seconds + fraction)
    }
    if (stamps.length) {
      for (const time of stamps) lines.push({ timeSec: Number(time.toFixed(2)), text })
    } else {
      lines.push({ timeSec: -1, text })
    }
  }

  const timed = lines.filter((line) => line.timeSec >= 0)
  const untimed = lines.filter((line) => line.timeSec < 0)

  // Mixed input: keep the timed ones, and let the rest fall in after them.
  const ordered = [...timed].sort((a, b) => a.timeSec - b.timeSec)
  if (untimed.length) {
    const start = ordered.length ? ordered[ordered.length - 1].timeSec + 2 : 0
    const duration = Math.max(1, durationSec || untimed.length * 3)
    const span = Math.max(1, (duration - start) / Math.max(1, untimed.length))
    untimed.forEach((line, index) => {
      ordered.push({ timeSec: Number((start + index * span).toFixed(2)), text: line.text })
    })
  }

  return ordered.sort((a, b) => a.timeSec - b.timeSec)
}

/** Index of the line showing at `timeSec` (-1 before the first line). */
export function activeLyricIndex(lines: LyricLine[], timeSec: number): number {
  let index = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].timeSec <= timeSec) index = i
    else break
  }
  return index
}
