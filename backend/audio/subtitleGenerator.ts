/**
 * Subtitle Generator
 * Converts Whisper transcription with timestamps to SRT/ASS subtitle files
 * Supports word-level timestamps for karaoke effects
 */

import fs from 'node:fs'
import path from 'node:path'

export interface WordTimestamp {
  word: string
  start: number // seconds
  end: number // seconds
}

export interface SegmentTimestamp {
  text: string
  start: number // seconds
  end: number // seconds
  words?: WordTimestamp[] // Optional word-level timestamps
}

export interface SubtitleGeneratorOptions {
  fontSize?: number
  fontColor?: string
  highlightColor?: string
  position?: 'top' | 'center' | 'bottom'
  style?: 'simple' | 'karaoke' | 'word-by-word' | 'dynamic'
  leadInSeconds?: number
}

/**
 * Convert HEX color (#RRGGBB) + alpha (0–255) to ASS ABGR format (&HAABBGGRR)
 */
function toAssColor(hex: string, alpha: number = 0): string {
  const h = hex.replace('#', '')
  const r = h.substring(0, 2)
  const g = h.substring(2, 4)
  const b = h.substring(4, 6)
  const a = Math.max(0, Math.min(255, alpha)).toString(16).padStart(2, '0')
  // ASS uses &HAABBGGRR (A = alpha, then BGR)
  return `&H${a}${b}${g}${r}`
}

/**
 * Format time for SRT (HH:MM:SS,mmm)
 */
function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const millis = Math.floor((seconds % 1) * 1000)
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`
}

/**
 * Format time for ASS (H:MM:SS.cc)
 */
function formatASSTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const centis = Math.floor((seconds % 1) * 100)
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`
}

/**
 * Build basic ASS header with PlayRes for proper scaling
 */
function assHeader(playResX = 1920, playResY = 1080): string[] {
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
  ]
}

/**
 * Build a flexible ASS style line
 * Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
 * Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,
 * Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
 */
function buildStyle(opts: {
  name?: string
  font?: string
  size?: number
  primary: string
  secondary?: string
  outlineColor?: string
  backColor?: string
  outline?: number
  shadow?: number
  borderStyle?: 1 | 3
  align?: number // 2 bottom-center, 5 mid-center, 8 top-center
  marginV?: number
}): string {
  const name = opts.name ?? 'Default'
  const font = opts.font ?? 'Arial'
  const size = opts.size ?? 48
  const primary = opts.primary
  const secondary = opts.secondary ?? primary
  const outlineColor = opts.outlineColor ?? toAssColor('#000000', 0)
  const backColor = opts.backColor ?? toAssColor('#000000', 128) // 50% opacity box
  const outline = opts.outline ?? 3
  const shadow = opts.shadow ?? 1
  const borderStyle = opts.borderStyle ?? 1
  const align = opts.align ?? 2
  const marginV = opts.marginV ?? 20

  return `Style: ${name},${font},${size},${primary},${secondary},${outlineColor},${backColor},0,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${align},10,10,${marginV},1`
}

/**
 * Fallback: interpolate word timestamps linearly across a segment when Whisper
 * does not provide word-level timing. Uses word length as weight to make
 * longer words last slightly longer while ensuring total duration matches.
 */
function interpolateWordsFromText(
  text: string,
  segmentStart: number,
  segmentEnd: number
): WordTimestamp[] {
  const rawWords = text.split(/\s+/).filter(w => w.length > 0)
  if (rawWords.length === 0) return []

  const segDur = Math.max(0.01, segmentEnd - segmentStart)

  // Use character length as weight to distribute time
  const lengths = rawWords.map(w => Math.max(1, w.length))
  const totalLen = lengths.reduce((a, b) => a + b, 0)

  const words: WordTimestamp[] = []
  let cursor = segmentStart

  for (let i = 0; i < rawWords.length; i++) {
    const weight = lengths[i] / totalLen
    // Clamp duration for each word between 100ms and 600ms
    const dur = Math.max(0.1, Math.min(segDur * weight, 0.6))
    const end = i === rawWords.length - 1 ? segmentEnd : Math.min(segmentEnd, cursor + dur)

    words.push({
      word: rawWords[i],
      start: cursor,
      end,
    })

    cursor = end
  }

  // Ensure last word ends exactly at segmentEnd to avoid drift
  if (words.length > 0) {
    words[words.length - 1].end = segmentEnd
  }

  return words
}

/**
 * Parse Whisper result to segments with timestamps
 * Whisper result format: { text: string, chunks: [{ text, timestamp: [start, end] }] }
 */
export function parseWhisperResult(whisperResult: any): SegmentTimestamp[] {
  const segments: SegmentTimestamp[] = []

  console.log('[SubtitleGenerator] 🔍 Parsing Whisper result...')
  console.log('[SubtitleGenerator] 🔍 Result type:', typeof whisperResult)
  console.log('[SubtitleGenerator] 🔍 Has chunks:', !!whisperResult?.chunks)
  console.log('[SubtitleGenerator] 🔍 Has segments:', !!whisperResult?.segments)
  console.log('[SubtitleGenerator] 🔍 Has text:', !!whisperResult?.text)
  
  // Log first chunk structure for debugging
  if (whisperResult?.chunks && Array.isArray(whisperResult.chunks) && whisperResult.chunks.length > 0) {
    const firstChunk = whisperResult.chunks[0]
    console.log('[SubtitleGenerator] 🔍 First chunk keys:', Object.keys(firstChunk))
    console.log('[SubtitleGenerator] 🔍 First chunk sample:', JSON.stringify(firstChunk).substring(0, 500))
    if (firstChunk.words && Array.isArray(firstChunk.words) && firstChunk.words.length > 0) {
      console.log('[SubtitleGenerator] 🔍 First word sample:', JSON.stringify(firstChunk.words[0]))
    }
  }

  // Check if result has segments (faster-whisper shape) and adapt to chunk format
  // faster-whisper returns: { text, segments: [{ text, start, end, words: [{word,start,end}]}] }
  if (!whisperResult.chunks && Array.isArray(whisperResult.segments)) {
    console.log(`[SubtitleGenerator] 📊 Converting ${whisperResult.segments.length} segments from faster-whisper format...`)
    whisperResult.chunks = whisperResult.segments.map((seg: any) => ({
      text: seg.text,
      start: seg.start,
      end: seg.end,
      words: seg.words,
    }))
  }

  // Check if result has chunks with timestamps (covers both original chunks and converted segments)
  if (whisperResult.chunks && Array.isArray(whisperResult.chunks)) {
    console.log(`[SubtitleGenerator] 📊 Processing ${whisperResult.chunks.length} chunks...`)
    
    for (let i = 0; i < whisperResult.chunks.length; i++) {
      const chunk = whisperResult.chunks[i]
      
      // @xenova/transformers may return chunks in different formats
      // Format 1: { text: string, timestamp: [start, end], words: [...] }
      // Format 2: { text: string, timestamps: { start: number, end: number }, words: [...] }
      // Format 3: { text: string, timestamp: [start, end] } (no words)
      
      let chunkStart = 0
      let chunkEnd = 0
      
      // Try to get chunk timestamps
      if (chunk.timestamp && Array.isArray(chunk.timestamp) && chunk.timestamp.length >= 2) {
        chunkStart = chunk.timestamp[0]
        chunkEnd = chunk.timestamp[1]
      } else if (chunk.timestamps && typeof chunk.timestamps === 'object') {
        chunkStart = chunk.timestamps.start || 0
        chunkEnd = chunk.timestamps.end || 0
      } else if (typeof chunk.start === 'number' && typeof chunk.end === 'number') {
        chunkStart = chunk.start
        chunkEnd = chunk.end
      } else {
        console.warn(`[SubtitleGenerator] ⚠️ Chunk ${i + 1} has invalid timestamp format, skipping`)
        continue
      }
      
      if (chunkEnd <= chunkStart) {
        console.warn(`[SubtitleGenerator] ⚠️ Chunk ${i + 1} has invalid timestamp (end <= start), skipping`)
        continue
      }
      
      // Parse word-level timestamps if available
      let words: WordTimestamp[] | undefined = undefined
      if (chunk.words && Array.isArray(chunk.words) && chunk.words.length > 0) {
        words = []
        console.log(`[SubtitleGenerator] 📊 Chunk ${i + 1} has ${chunk.words.length} words`)
        
        for (let j = 0; j < chunk.words.length; j++) {
          const w = chunk.words[j]
          
          // Handle different word formats
          // Format 1: { word: string, timestamp: [start, end] }
          // Format 2: { text: string, start: number, end: number }
          // Format 3: { word: string, timestamps: { start: number, end: number } }
          
          const wordText = w.word || w.text || ''
          let wordStart = 0
          let wordEnd = 0
          
          if (w.timestamp && Array.isArray(w.timestamp) && w.timestamp.length >= 2) {
            wordStart = w.timestamp[0]
            wordEnd = w.timestamp[1]
          } else if (w.timestamps && typeof w.timestamps === 'object') {
            wordStart = w.timestamps.start || 0
            wordEnd = w.timestamps.end || 0
          } else if (typeof w.start === 'number' && typeof w.end === 'number') {
            wordStart = w.start
            wordEnd = w.end
          } else {
            // If no word timestamps, estimate from chunk timing
            // Distribute words evenly across chunk duration
            const wordCount = chunk.words.length
            const chunkDuration = chunkEnd - chunkStart
            wordStart = chunkStart + (j / wordCount) * chunkDuration
            wordEnd = chunkStart + ((j + 1) / wordCount) * chunkDuration
            console.log(`[SubtitleGenerator] ⚠️ Word ${j + 1} has no timestamps, estimating: ${wordStart.toFixed(2)}-${wordEnd.toFixed(2)}`)
          }
          
          if (wordText && wordText.trim() && wordEnd > wordStart) {
            words.push({
              word: wordText.trim(),
              start: wordStart,
              end: wordEnd,
            })
          } else {
            console.warn(`[SubtitleGenerator] ⚠️ Skipping invalid word ${j + 1}: "${wordText}" (start=${wordStart}, end=${wordEnd})`)
          }
        }
        
        if (words.length === 0) {
          console.warn(`[SubtitleGenerator] ⚠️ Chunk ${i + 1} has no valid words after parsing`)
          words = undefined
        } else {
          console.log(`[SubtitleGenerator] ✅ Chunk ${i + 1} parsed: ${words.length} valid words`)
        }
      } else {
        console.warn(`[SubtitleGenerator] ⚠️ Chunk ${i + 1} has NO word-level timestamps from Whisper`)
        const chunkText = (chunk.text || '').trim()
        if (chunkText.length > 0) {
          // Fallback: interpolate word timings linearly across the segment
          words = interpolateWordsFromText(chunkText, chunkStart, chunkEnd)
          console.log(
            `[SubtitleGenerator] ✅ Fallback interpolated ${words.length} word timestamps for chunk ${i + 1}`
          )
        }
      }
      
      segments.push({
        text: (chunk.text || '').trim(),
        start: chunkStart,
        end: chunkEnd,
        words: words,
      })
    }
    
    console.log(`[SubtitleGenerator] ✅ Parsed ${segments.length} segments with timestamps`)
    
    // Count segments with word-level timestamps
    const segmentsWithWords = segments.filter(seg => seg.words && seg.words.length > 0).length
    console.log(`[SubtitleGenerator] 📊 Segments with word-level timestamps: ${segmentsWithWords}/${segments.length}`)
    
    if (segmentsWithWords === 0) {
      console.error(`[SubtitleGenerator] ❌ CRITICAL: No segments have word-level timestamps! Karaoke effects will not work!`)
      console.error(`[SubtitleGenerator] ❌ This means Whisper did not return word-level timestamps.`)
      console.error(`[SubtitleGenerator] ❌ Check Whisper pipeline options: return_timestamps should be 'word'`)
    }
  } else if (whisperResult.text) {
    // Fallback: if no chunks, check if we have timestamp info in the result
    // @xenova/transformers may return different format
    if (whisperResult.timestamp && Array.isArray(whisperResult.timestamp) && whisperResult.timestamp.length >= 2) {
      // Has timestamp at root level
      segments.push({
        text: whisperResult.text,
        start: whisperResult.timestamp[0],
        end: whisperResult.timestamp[1],
      })
    } else {
      // No timestamps available - cannot generate subtitle file
      // Return empty segments to indicate failure
      console.warn('[SubtitleGenerator] Whisper result has no timestamps, cannot generate subtitle file')
      return []
    }
  }

  // Validate segments - ensure all have valid timestamps
  return segments.filter(seg => seg.start >= 0 && seg.end > seg.start && seg.text.trim().length > 0)
}

/**
 * Generate SRT subtitle file from segments
 */
export function generateSRT(
  segments: SegmentTimestamp[],
  outputPath: string
): void {
  if (segments.length === 0) {
    throw new Error('No valid subtitle segments to generate SRT file')
  }

  const lines: string[] = []
  let index = 1

  for (const segment of segments) {
    if (!segment.text.trim() || segment.end <= segment.start) {
      continue // Skip invalid segments
    }

    lines.push(index.toString())
    lines.push(`${formatSRTTime(segment.start)} --> ${formatSRTTime(segment.end)}`)
    lines.push(segment.text.trim())
    lines.push('') // Empty line between subtitles
    index++
  }

  if (lines.length === 0) {
    throw new Error('No valid subtitle segments after filtering')
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8')
}

/**
 * Generate ASS subtitle file with karaoke effects
 * ASS format supports advanced styling and karaoke effects
 */
export function generateASS(
  segments: SegmentTimestamp[],
  outputPath: string,
  options?: SubtitleGeneratorOptions
): void {
  const fontSize = options?.fontSize || 48
  const normalizeHex = (c: string) => (c || '').replace('#', '').padStart(6, '0').toUpperCase()
  const fontColor = normalizeHex(options?.fontColor || 'FFFFFF')
  const highlightColor = normalizeHex(options?.highlightColor || 'FFFF00') // Yellow for highlight
  const position = options?.position || 'bottom'
  const style = options?.style || 'karaoke' // Default to karaoke
  const leadIn = Math.max(0, options?.leadInSeconds ?? 1) // default 1s lead-in

  // Calculate Y position
  let yPos = 10 // Top
  if (position === 'center') {
    yPos = 5 // Center (will be calculated as percentage)
  } else if (position === 'bottom') {
    yPos = 2 // Bottom
  }

  const lines: string[] = []

  // ASS header with PlayRes for scaling
  lines.push(...assHeader())
  lines.push('')
  lines.push('[V4+ Styles]')
  lines.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
  )
  
  // Create different styles based on subtitle style (Aegisub standard)
  const alignment = position === 'top' ? 8 : position === 'center' ? 5 : 2
  
  if (style === 'dynamic') {
    // Dynamic Captions: bold, thick outline, box background for readability
    lines.push(
      buildStyle({
        name: 'Default',
        font: 'Arial',
        size: fontSize,
        primary: toAssColor(`#${fontColor}`, 0),
        secondary: toAssColor(`#${highlightColor}`, 0),
        outlineColor: toAssColor('#000000', 0),
        backColor: toAssColor('#000000', 128),
        outline: 3,
        shadow: 2,
        borderStyle: 3,
        align: alignment,
        marginV: yPos * 10,
      })
    )
  } else if (style === 'karaoke') {
    // Karaoke: medium outline, slight shadow, no box (BorderStyle=1)
    lines.push(
      buildStyle({
        name: 'Default',
        font: 'Arial',
        size: fontSize,
        // Karaoke color semantics:
        // - SecondaryColour = base (chưa hát)  => fontColor
        // - PrimaryColour   = highlight (đang hát) => highlightColor
        primary: toAssColor(`#${highlightColor}`, 0),
        secondary: toAssColor(`#${fontColor}`, 0),
        outlineColor: toAssColor('#000000', 0),
        backColor: toAssColor('#000000', 255), // fully transparent box (no background)
        outline: 3,
        shadow: 1,
        borderStyle: 1,
        align: alignment,
        marginV: yPos * 10,
      })
    )
  } else {
    // Simple / Word-by-word: clean text, optional box for readability
    const isSimple = style === 'simple'
    lines.push(
      buildStyle({
        name: 'Default',
        font: 'Arial',
        size: fontSize,
        primary: toAssColor(`#${fontColor}`, 0),
        secondary: toAssColor(`#${highlightColor}`, 0),
        outlineColor: toAssColor('#000000', isSimple ? 0 : 0),
        backColor: toAssColor('#000000', isSimple ? 128 : 64),
        outline: isSimple ? 2 : 2,
        shadow: isSimple ? 0 : 1,
        borderStyle: isSimple ? 3 : 1,
        align: alignment,
        marginV: yPos * 10,
      })
    )
  }
  
  lines.push('')
  lines.push('[Events]')
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')

  if (segments.length === 0) {
    throw new Error('No valid subtitle segments to generate ASS file')
  }

  // Generate subtitle events
  for (const segment of segments) {
    if (!segment.text.trim() || segment.end <= segment.start) {
      continue // Skip invalid segments
    }

    const segmentStartAdjusted = Math.max(0, segment.start - leadIn)
    const startTime = formatASSTime(segmentStartAdjusted)
    const endTime = formatASSTime(segment.end)

    // Generate subtitle based on style
    // CRITICAL: Log segment info for debugging
    const hasWords = segment.words && Array.isArray(segment.words) && segment.words.length > 0
    const wordTimestamps: WordTimestamp[] = hasWords ? segment.words ?? [] : []
    console.log(`[SubtitleGenerator] Segment: style=${style}, hasWords=${hasWords}, wordCount=${segment.words?.length || 0}`)
    
    if (style === 'word-by-word' && hasWords) {
      // Word-by-word Pop effect: Each word gets its own dialogue with scale animation
      console.log(`[SubtitleGenerator] Creating word-by-word pop effect with ${wordTimestamps.length} words`)
      createWordByWordPopEffect(wordTimestamps, lines, fontColor, highlightColor, segmentStartAdjusted, segment.text)
    } else if (style === 'karaoke' && hasWords) {
      // Karaoke traditional: All words visible, each word highlights when sung
      console.log(`[SubtitleGenerator] Creating karaoke effect with ${wordTimestamps.length} words`)
      const karaokeText = createKaraokeEffect(wordTimestamps, fontColor, highlightColor, segmentStartAdjusted)
      console.log(`[SubtitleGenerator] Karaoke text preview: ${karaokeText.substring(0, 150)}...`)
      lines.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${karaokeText}`)
    } else if (style === 'dynamic' && hasWords) {
      // Dynamic Captions: Bold, stroke, highlight current word
      console.log(`[SubtitleGenerator] Creating dynamic caption effect with ${wordTimestamps.length} words`)
      const dynamicText = createDynamicCaptionEffect(wordTimestamps, fontColor, highlightColor)
      lines.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${dynamicText}`)
    } else {
      // Fallback: Simple subtitle without effects
      // WARNING: This means word-level timestamps are missing!
      if (style === 'karaoke' || style === 'word-by-word' || style === 'dynamic') {
        console.warn(`[SubtitleGenerator] ⚠️ WARNING: Style is ${style} but no word-level timestamps available!`)
        console.warn(`[SubtitleGenerator] ⚠️ Falling back to simple text. Segment text: ${segment.text.substring(0, 50)}...`)
        console.warn(`[SubtitleGenerator] ⚠️ This means Whisper did not return word-level timestamps.`)
      }
      lines.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${segment.text.trim()}`)
    }
  }

  if (lines.length === 0) {
    throw new Error('No valid subtitle events after filtering')
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8')
}

/**
 * Create professional karaoke effect text for ASS format (Aegisub standard)
 * Uses ASS karaoke tags: {\k<duration>} to highlight words as they are sung
 * Professional features:
 * - Color sweep effect (chữ đổi màu dần)
 * - Smooth transitions between words
 * - Proper timing alignment
 */
function createKaraokeEffect(
  words: WordTimestamp[],
  _normalColor: string,
  _highlightColor: string,
  segmentStart: number = 0 // Dialogue start time (may include lead-in)
): string {
  const KARAOKE_KF_THRESHOLD_CS = 120 // 1.2s: longer syllables use \kf for smooth fill
  if (!words || words.length === 0) return ''

  // Dialogue start is provided (already includes lead-in). Use first word start as actual audio start.
  const firstWordStart = words[0].start
  const lineStart = segmentStart > 0 ? segmentStart : firstWordStart
  const initialOffsetCs = Math.max(0, Math.floor((firstWordStart - lineStart) * 100))

  const parts: string[] = []
  let prevEnd = firstWordStart

  for (let i = 0; i < words.length; i++) {
    const word = words[i]

    if (!word.word || word.word.trim().length === 0) continue
    if (word.start < 0 || word.end <= word.start) continue

    const gapCs = Math.max(0, Math.floor((word.start - prevEnd) * 100))
    const durCs = Math.max(1, Math.floor((word.end - word.start) * 100))
    const tag = durCs > KARAOKE_KF_THRESHOLD_CS ? 'kf' : 'k'

    const escapedWord = word.word
      .replace(/\\/g, '\\\\')
      .replace(/{/g, '\\{')
      .replace(/}/g, '\\}')
      .replace(/\n/g, '\\N')
      .replace(/\r/g, '')

    if (i > 0) parts.push(' ')

    if (i === 0) {
      // Apply initial wait to compensate lead-in, then highlight
      parts.push(`{\\k${initialOffsetCs}}{\\${tag}${durCs}}${escapedWord}`)
    } else {
      // Gap between words, then highlight
      if (gapCs > 0) parts.push(`{\\k${gapCs}}`)
      parts.push(`{\\${tag}${durCs}}${escapedWord}`)
    }

    prevEnd = word.end
  }

  if (parts.length === 0) {
    console.warn('[SubtitleGenerator] createKaraokeEffect: No valid words to create karaoke effect')
    return ''
  }

  const karaokeText = `{\\k0}${parts.join('')}`
  console.log(`[SubtitleGenerator] ✅ Created karaoke effect: ${parts.length} words`)
  console.log(`[SubtitleGenerator] 📝 Full sentence: ${words.map(w => w.word).join(' ')}`)
  console.log(`[SubtitleGenerator] 📝 Karaoke preview: ${karaokeText.substring(0, 250)}...`)
  return karaokeText
}

/**
 * Create Word-by-word Pop effect (TikTok/Reels style)
 * All words shown together, but each word pops (scales up) when it's being sung
 */
function createWordByWordPopEffect(
  words: WordTimestamp[],
  lines: string[],
  normalColor: string,
  highlightColor: string,
  segmentStartOverride?: number,
  baseText?: string
): void {
  if (!words || words.length === 0) {
    return
  }

  // Base dialogue (layer 0) with full text – keeps layout stable
  const segmentStart = segmentStartOverride ?? words[0].start
  const segmentEnd = words[words.length - 1].end
  const baseSentence =
    baseText && baseText.trim().length > 0
      ? baseText.trim()
      : words.map(w => w.word).join(' ')

  const baseStartTime = formatASSTime(segmentStart)
  const baseEndTime = formatASSTime(segmentEnd)
  lines.push(`Dialogue: 0,${baseStartTime},${baseEndTime},Default,,0,0,0,,${baseSentence}`)

  // Overlay dialogues (layer 1) – one per word, centered (TikTok/Reels style)
  const highlightAssColor = toAssColor(`#${highlightColor}`, 0)
  const normalAssColor = toAssColor(`#${normalColor}`, 0)

  for (let i = 0; i < words.length; i++) {
    const word = words[i]

    if (!word.word || word.word.trim().length === 0) continue
    if (word.start < 0 || word.end <= word.start) continue

    const wStart = word.start
    const wEnd = word.end
    const durMs = Math.max(100, Math.floor((wEnd - wStart) * 1000))
    const popDurationMs = Math.max(80, Math.floor(durMs * 0.3))
    const popStartMs = 0
    const popEndMs = Math.min(durMs, popDurationMs)

    const startTime = formatASSTime(wStart)
    const endTime = formatASSTime(wEnd)

    const escapedWord = word.word
      .replace(/\\/g, '\\\\')
      .replace(/{/g, '\\{')
      .replace(/}/g, '\\}')
      .replace(/\n/g, '\\N')
      .replace(/\r/g, '')

    // Sparkle pop effect in a single override block
    const effect =
      `{` +
      `\\an5` +
      `\\alpha&HFF&` +
      `\\t(${popStartMs},${popEndMs},` +
      `\\alpha&H00&\\fscx130\\fscy130\\c${highlightAssColor}\\be10` +
      `)` +
      `\\t(${popEndMs},${durMs},` +
      `\\fscx110\\fscy110\\c${normalAssColor}\\be2` +
      `)` +
      `}${escapedWord}`

    lines.push(`Dialogue: 1,${startTime},${endTime},Default,,0,0,0,,${effect}`)
  }
}

/**
 * Create Dynamic Captions effect (Alex Hormozi style)
 * Features: Bold text, thick outline, slight rotation, highlight current word
 */
function createDynamicCaptionEffect(
  words: WordTimestamp[],
  normalColor: string,
  highlightColor: string
): string {
  if (!words || words.length === 0) {
    return ''
  }

  const parts: string[] = []

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    
    // Validate word
    if (!word.word || word.word.trim().length === 0) {
      continue
    }

    // Validate timestamps
    if (word.start < 0 || word.end <= word.start) {
      continue
    }

    const nextWord = words[i + 1]

    // Calculate duration in centiseconds
    const duration = nextWord
      ? Math.max(1, Math.floor((nextWord.start - word.start) * 100))
      : Math.max(1, Math.floor((word.end - word.start) * 100))

    // Escape word text
    const escapedWord = word.word
      .replace(/\\/g, '\\\\')
      .replace(/{/g, '\\{')
      .replace(/}/g, '\\}')

    // Dynamic Captions: Bold, thick outline, highlight current word
    // {\b1} = bold, {\k<duration>} = karaoke highlight, {\c&H00<color>&} = color
    // {\bord4} = thick outline (4 pixels), {\3c&H00<color>&} = outline color (black)
    // Highlight current word with yellow, others stay white
    parts.push(`{\\k${duration}}{\\c&H00${highlightColor}&}{\\b1}{\\bord4}{\\3c&H00000000&}${escapedWord}{\\c&H00${normalColor}&}`)
  }

  if (parts.length === 0) {
    return ''
  }

  // Combine all words with dynamic styling
  // Initial state: normal color (white), bold, thick outline (black), slight rotation (-5 degrees)
  // Each word gets highlighted sequentially via {\k} tags
  // {\r} = reset style, {\an5} = center alignment
  return `{\\c&H00${normalColor}&}{\\b1}{\\bord4}{\\3c&H00000000&}{\\k0}${parts.join(' ')}`
}

/**
 * Generate subtitle file (SRT or ASS) from Whisper result
 */
export async function generateSubtitleFile(
  whisperResult: any,
  outputPath: string,
  format: 'srt' | 'ass' = 'srt',
  options?: SubtitleGeneratorOptions
): Promise<void> {
  console.log(`[SubtitleGenerator] 🎬 Generating ${format.toUpperCase()} subtitle file: ${outputPath}`)
  console.log(`[SubtitleGenerator] 🎬 Options:`, options)
  
  const segments = parseWhisperResult(whisperResult)

  if (segments.length === 0) {
    console.error('[SubtitleGenerator] ❌ No valid segments found in Whisper result')
    throw new Error('No subtitle segments found in Whisper result. Whisper may not have returned word-level timestamps.')
  }

  console.log(`[SubtitleGenerator] ✅ Generated ${segments.length} segments`)
  
  // Count segments with word-level timestamps (for karaoke)
  const segmentsWithWords = segments.filter(seg => seg.words && seg.words.length > 0).length
  console.log(`[SubtitleGenerator] 📊 Segments with word-level timestamps: ${segmentsWithWords}/${segments.length}`)
  
  if (format === 'ass') {
    generateASS(segments, outputPath, options)
    console.log(`[SubtitleGenerator] ✅ ASS file generated successfully: ${outputPath}`)
    
    // Verify file was created
    if (fs.existsSync(outputPath)) {
      const fileSize = fs.statSync(outputPath).size
      console.log(`[SubtitleGenerator] ✅ ASS file size: ${fileSize} bytes`)
      
      // Log first few lines for debugging
      try {
        const fileContent = fs.readFileSync(outputPath, 'utf-8')
        const lines = fileContent.split('\n')
        console.log(`[SubtitleGenerator] 📄 ASS file preview (first 10 lines):`)
        lines.slice(0, 10).forEach((line, i) => {
          console.log(`[SubtitleGenerator]   ${i + 1}: ${line.substring(0, 100)}`)
        })
      } catch (error) {
        console.warn(`[SubtitleGenerator] ⚠️ Could not read ASS file for preview:`, error)
      }
    } else {
      console.error(`[SubtitleGenerator] ❌ ASS file was not created: ${outputPath}`)
    }
  } else {
    generateSRT(segments, outputPath)
    console.log(`[SubtitleGenerator] ✅ SRT file generated successfully: ${outputPath}`)
  }
}
