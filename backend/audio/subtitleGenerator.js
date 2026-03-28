/**
 * Subtitle Generator
 * Converts Whisper transcription with timestamps to SRT/ASS subtitle files
 * Supports word-level timestamps for karaoke effects
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import fs from 'node:fs';
/**
 * Convert HEX color (#RRGGBB) + alpha (0–255) to ASS ABGR format (&HAABBGGRR)
 */
function toAssColor(hex, alpha) {
    if (alpha === void 0) { alpha = 0; }
    var h = hex.replace('#', '');
    var r = h.substring(0, 2);
    var g = h.substring(2, 4);
    var b = h.substring(4, 6);
    var a = Math.max(0, Math.min(255, alpha)).toString(16).padStart(2, '0');
    // ASS uses &HAABBGGRR (A = alpha, then BGR)
    return "&H".concat(a).concat(b).concat(g).concat(r);
}
/**
 * Format time for SRT (HH:MM:SS,mmm)
 */
function formatSRTTime(seconds) {
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var secs = Math.floor(seconds % 60);
    var millis = Math.floor((seconds % 1) * 1000);
    return "".concat(hours.toString().padStart(2, '0'), ":").concat(minutes.toString().padStart(2, '0'), ":").concat(secs.toString().padStart(2, '0'), ",").concat(millis.toString().padStart(3, '0'));
}
/**
 * Format time for ASS (H:MM:SS.cc)
 */
function formatASSTime(seconds) {
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var secs = Math.floor(seconds % 60);
    var centis = Math.floor((seconds % 1) * 100);
    return "".concat(hours, ":").concat(minutes.toString().padStart(2, '0'), ":").concat(secs.toString().padStart(2, '0'), ".").concat(centis.toString().padStart(2, '0'));
}
/**
 * Build basic ASS header with PlayRes for proper scaling
 */
function assHeader(playResX, playResY) {
    if (playResX === void 0) { playResX = 1920; }
    if (playResY === void 0) { playResY = 1080; }
    return [
        '[Script Info]',
        'ScriptType: v4.00+',
        "PlayResX: ".concat(playResX),
        "PlayResY: ".concat(playResY),
    ];
}
/**
 * Build a flexible ASS style line
 * Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
 * Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,
 * Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
 */
function buildStyle(opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    var name = (_a = opts.name) !== null && _a !== void 0 ? _a : 'Default';
    var font = (_b = opts.font) !== null && _b !== void 0 ? _b : 'Arial';
    var size = (_c = opts.size) !== null && _c !== void 0 ? _c : 48;
    var primary = opts.primary;
    var secondary = (_d = opts.secondary) !== null && _d !== void 0 ? _d : primary;
    var outlineColor = (_e = opts.outlineColor) !== null && _e !== void 0 ? _e : toAssColor('#000000', 0);
    var backColor = (_f = opts.backColor) !== null && _f !== void 0 ? _f : toAssColor('#000000', 128); // 50% opacity box
    var outline = (_g = opts.outline) !== null && _g !== void 0 ? _g : 3;
    var shadow = (_h = opts.shadow) !== null && _h !== void 0 ? _h : 1;
    var borderStyle = (_j = opts.borderStyle) !== null && _j !== void 0 ? _j : 1;
    var align = (_k = opts.align) !== null && _k !== void 0 ? _k : 2;
    var marginV = (_l = opts.marginV) !== null && _l !== void 0 ? _l : 20;
    return "Style: ".concat(name, ",").concat(font, ",").concat(size, ",").concat(primary, ",").concat(secondary, ",").concat(outlineColor, ",").concat(backColor, ",0,0,0,0,100,100,0,0,").concat(borderStyle, ",").concat(outline, ",").concat(shadow, ",").concat(align, ",10,10,").concat(marginV, ",1");
}
/**
 * Fallback: interpolate word timestamps linearly across a segment when Whisper
 * does not provide word-level timing. Uses word length as weight to make
 * longer words last slightly longer while ensuring total duration matches.
 */
function interpolateWordsFromText(text, segmentStart, segmentEnd) {
    var rawWords = text.split(/\s+/).filter(function (w) { return w.length > 0; });
    if (rawWords.length === 0)
        return [];
    var segDur = Math.max(0.01, segmentEnd - segmentStart);
    // Use character length as weight to distribute time
    var lengths = rawWords.map(function (w) { return Math.max(1, w.length); });
    var totalLen = lengths.reduce(function (a, b) { return a + b; }, 0);
    var words = [];
    var cursor = segmentStart;
    for (var i = 0; i < rawWords.length; i++) {
        var weight = lengths[i] / totalLen;
        // Clamp duration for each word between 100ms and 600ms
        var dur = Math.max(0.1, Math.min(segDur * weight, 0.6));
        var end = i === rawWords.length - 1 ? segmentEnd : Math.min(segmentEnd, cursor + dur);
        words.push({
            word: rawWords[i],
            start: cursor,
            end: end,
        });
        cursor = end;
    }
    // Ensure last word ends exactly at segmentEnd to avoid drift
    if (words.length > 0) {
        words[words.length - 1].end = segmentEnd;
    }
    return words;
}
/**
 * Parse Whisper result to segments with timestamps
 * Whisper result format: { text: string, chunks: [{ text, timestamp: [start, end] }] }
 */
export function parseWhisperResult(whisperResult) {
    var segments = [];
    console.log('[SubtitleGenerator] 🔍 Parsing Whisper result...');
    console.log('[SubtitleGenerator] 🔍 Result type:', typeof whisperResult);
    console.log('[SubtitleGenerator] 🔍 Has chunks:', !!(whisperResult === null || whisperResult === void 0 ? void 0 : whisperResult.chunks));
    console.log('[SubtitleGenerator] 🔍 Has segments:', !!(whisperResult === null || whisperResult === void 0 ? void 0 : whisperResult.segments));
    console.log('[SubtitleGenerator] 🔍 Has text:', !!(whisperResult === null || whisperResult === void 0 ? void 0 : whisperResult.text));
    // Log first chunk structure for debugging
    if ((whisperResult === null || whisperResult === void 0 ? void 0 : whisperResult.chunks) && Array.isArray(whisperResult.chunks) && whisperResult.chunks.length > 0) {
        var firstChunk = whisperResult.chunks[0];
        console.log('[SubtitleGenerator] 🔍 First chunk keys:', Object.keys(firstChunk));
        console.log('[SubtitleGenerator] 🔍 First chunk sample:', JSON.stringify(firstChunk).substring(0, 500));
        if (firstChunk.words && Array.isArray(firstChunk.words) && firstChunk.words.length > 0) {
            console.log('[SubtitleGenerator] 🔍 First word sample:', JSON.stringify(firstChunk.words[0]));
        }
    }
    // Check if result has segments (faster-whisper shape) and adapt to chunk format
    // faster-whisper returns: { text, segments: [{ text, start, end, words: [{word,start,end}]}] }
    if (!whisperResult.chunks && Array.isArray(whisperResult.segments)) {
        console.log("[SubtitleGenerator] \uD83D\uDCCA Converting ".concat(whisperResult.segments.length, " segments from faster-whisper format..."));
        whisperResult.chunks = whisperResult.segments.map(function (seg) { return ({
            text: seg.text,
            start: seg.start,
            end: seg.end,
            words: seg.words,
        }); });
    }
    // Check if result has chunks with timestamps (covers both original chunks and converted segments)
    if (whisperResult.chunks && Array.isArray(whisperResult.chunks)) {
        console.log("[SubtitleGenerator] \uD83D\uDCCA Processing ".concat(whisperResult.chunks.length, " chunks..."));
        for (var i = 0; i < whisperResult.chunks.length; i++) {
            var chunk = whisperResult.chunks[i];
            // @xenova/transformers may return chunks in different formats
            // Format 1: { text: string, timestamp: [start, end], words: [...] }
            // Format 2: { text: string, timestamps: { start: number, end: number }, words: [...] }
            // Format 3: { text: string, timestamp: [start, end] } (no words)
            var chunkStart = 0;
            var chunkEnd = 0;
            // Try to get chunk timestamps
            if (chunk.timestamp && Array.isArray(chunk.timestamp) && chunk.timestamp.length >= 2) {
                chunkStart = chunk.timestamp[0];
                chunkEnd = chunk.timestamp[1];
            }
            else if (chunk.timestamps && typeof chunk.timestamps === 'object') {
                chunkStart = chunk.timestamps.start || 0;
                chunkEnd = chunk.timestamps.end || 0;
            }
            else if (typeof chunk.start === 'number' && typeof chunk.end === 'number') {
                chunkStart = chunk.start;
                chunkEnd = chunk.end;
            }
            else {
                console.warn("[SubtitleGenerator] \u26A0\uFE0F Chunk ".concat(i + 1, " has invalid timestamp format, skipping"));
                continue;
            }
            if (chunkEnd <= chunkStart) {
                console.warn("[SubtitleGenerator] \u26A0\uFE0F Chunk ".concat(i + 1, " has invalid timestamp (end <= start), skipping"));
                continue;
            }
            // Parse word-level timestamps if available
            var words = undefined;
            if (chunk.words && Array.isArray(chunk.words) && chunk.words.length > 0) {
                words = [];
                console.log("[SubtitleGenerator] \uD83D\uDCCA Chunk ".concat(i + 1, " has ").concat(chunk.words.length, " words"));
                for (var j = 0; j < chunk.words.length; j++) {
                    var w = chunk.words[j];
                    // Handle different word formats
                    // Format 1: { word: string, timestamp: [start, end] }
                    // Format 2: { text: string, start: number, end: number }
                    // Format 3: { word: string, timestamps: { start: number, end: number } }
                    var wordText = w.word || w.text || '';
                    var wordStart = 0;
                    var wordEnd = 0;
                    if (w.timestamp && Array.isArray(w.timestamp) && w.timestamp.length >= 2) {
                        wordStart = w.timestamp[0];
                        wordEnd = w.timestamp[1];
                    }
                    else if (w.timestamps && typeof w.timestamps === 'object') {
                        wordStart = w.timestamps.start || 0;
                        wordEnd = w.timestamps.end || 0;
                    }
                    else if (typeof w.start === 'number' && typeof w.end === 'number') {
                        wordStart = w.start;
                        wordEnd = w.end;
                    }
                    else {
                        // If no word timestamps, estimate from chunk timing
                        // Distribute words evenly across chunk duration
                        var wordCount = chunk.words.length;
                        var chunkDuration = chunkEnd - chunkStart;
                        wordStart = chunkStart + (j / wordCount) * chunkDuration;
                        wordEnd = chunkStart + ((j + 1) / wordCount) * chunkDuration;
                        console.log("[SubtitleGenerator] \u26A0\uFE0F Word ".concat(j + 1, " has no timestamps, estimating: ").concat(wordStart.toFixed(2), "-").concat(wordEnd.toFixed(2)));
                    }
                    if (wordText && wordText.trim() && wordEnd > wordStart) {
                        words.push({
                            word: wordText.trim(),
                            start: wordStart,
                            end: wordEnd,
                        });
                    }
                    else {
                        console.warn("[SubtitleGenerator] \u26A0\uFE0F Skipping invalid word ".concat(j + 1, ": \"").concat(wordText, "\" (start=").concat(wordStart, ", end=").concat(wordEnd, ")"));
                    }
                }
                if (words.length === 0) {
                    console.warn("[SubtitleGenerator] \u26A0\uFE0F Chunk ".concat(i + 1, " has no valid words after parsing"));
                    words = undefined;
                }
                else {
                    console.log("[SubtitleGenerator] \u2705 Chunk ".concat(i + 1, " parsed: ").concat(words.length, " valid words"));
                }
            }
            else {
                console.warn("[SubtitleGenerator] \u26A0\uFE0F Chunk ".concat(i + 1, " has NO word-level timestamps from Whisper"));
                var chunkText = (chunk.text || '').trim();
                if (chunkText.length > 0) {
                    // Fallback: interpolate word timings linearly across the segment
                    words = interpolateWordsFromText(chunkText, chunkStart, chunkEnd);
                    console.log("[SubtitleGenerator] \u2705 Fallback interpolated ".concat(words.length, " word timestamps for chunk ").concat(i + 1));
                }
            }
            segments.push({
                text: (chunk.text || '').trim(),
                start: chunkStart,
                end: chunkEnd,
                words: words,
            });
        }
        console.log("[SubtitleGenerator] \u2705 Parsed ".concat(segments.length, " segments with timestamps"));
        // Count segments with word-level timestamps
        var segmentsWithWords = segments.filter(function (seg) { return seg.words && seg.words.length > 0; }).length;
        console.log("[SubtitleGenerator] \uD83D\uDCCA Segments with word-level timestamps: ".concat(segmentsWithWords, "/").concat(segments.length));
        if (segmentsWithWords === 0) {
            console.error("[SubtitleGenerator] \u274C CRITICAL: No segments have word-level timestamps! Karaoke effects will not work!");
            console.error("[SubtitleGenerator] \u274C This means Whisper did not return word-level timestamps.");
            console.error("[SubtitleGenerator] \u274C Check Whisper pipeline options: return_timestamps should be 'word'");
        }
    }
    else if (whisperResult.text) {
        // Fallback: if no chunks, check if we have timestamp info in the result
        // @xenova/transformers may return different format
        if (whisperResult.timestamp && Array.isArray(whisperResult.timestamp) && whisperResult.timestamp.length >= 2) {
            // Has timestamp at root level
            segments.push({
                text: whisperResult.text,
                start: whisperResult.timestamp[0],
                end: whisperResult.timestamp[1],
            });
        }
        else {
            // No timestamps available - cannot generate subtitle file
            // Return empty segments to indicate failure
            console.warn('[SubtitleGenerator] Whisper result has no timestamps, cannot generate subtitle file');
            return [];
        }
    }
    // Validate segments - ensure all have valid timestamps
    return segments.filter(function (seg) { return seg.start >= 0 && seg.end > seg.start && seg.text.trim().length > 0; });
}
/**
 * Generate SRT subtitle file from segments
 */
export function generateSRT(segments, outputPath) {
    if (segments.length === 0) {
        throw new Error('No valid subtitle segments to generate SRT file');
    }
    var lines = [];
    var index = 1;
    for (var _i = 0, segments_1 = segments; _i < segments_1.length; _i++) {
        var segment = segments_1[_i];
        if (!segment.text.trim() || segment.end <= segment.start) {
            continue; // Skip invalid segments
        }
        lines.push(index.toString());
        lines.push("".concat(formatSRTTime(segment.start), " --> ").concat(formatSRTTime(segment.end)));
        lines.push(segment.text.trim());
        lines.push(''); // Empty line between subtitles
        index++;
    }
    if (lines.length === 0) {
        throw new Error('No valid subtitle segments after filtering');
    }
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
/**
 * Generate ASS subtitle file with karaoke effects
 * ASS format supports advanced styling and karaoke effects
 */
export function generateASS(segments, outputPath, options) {
    var _a, _b;
    var fontSize = (options === null || options === void 0 ? void 0 : options.fontSize) || 48;
    var normalizeHex = function (c) { return (c || '').replace('#', '').padStart(6, '0').toUpperCase(); };
    var fontColor = normalizeHex((options === null || options === void 0 ? void 0 : options.fontColor) || 'FFFFFF');
    var highlightColor = normalizeHex((options === null || options === void 0 ? void 0 : options.highlightColor) || 'FFFF00'); // Yellow for highlight
    var position = (options === null || options === void 0 ? void 0 : options.position) || 'bottom';
    var style = (options === null || options === void 0 ? void 0 : options.style) || 'karaoke'; // Default to karaoke
    var leadIn = Math.max(0, (_a = options === null || options === void 0 ? void 0 : options.leadInSeconds) !== null && _a !== void 0 ? _a : 1); // default 1s lead-in
    // Calculate Y position
    var yPos = 10; // Top
    if (position === 'center') {
        yPos = 5; // Center (will be calculated as percentage)
    }
    else if (position === 'bottom') {
        yPos = 2; // Bottom
    }
    var lines = [];
    // ASS header with PlayRes for scaling
    lines.push.apply(lines, assHeader());
    lines.push('');
    lines.push('[V4+ Styles]');
    lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
    // Create different styles based on subtitle style (Aegisub standard)
    var alignment = position === 'top' ? 8 : position === 'center' ? 5 : 2;
    if (style === 'dynamic') {
        // Dynamic Captions: bold, thick outline, box background for readability
        lines.push(buildStyle({
            name: 'Default',
            font: 'Arial',
            size: fontSize,
            primary: toAssColor("#".concat(fontColor), 0),
            secondary: toAssColor("#".concat(highlightColor), 0),
            outlineColor: toAssColor('#000000', 0),
            backColor: toAssColor('#000000', 128),
            outline: 3,
            shadow: 2,
            borderStyle: 3,
            align: alignment,
            marginV: yPos * 10,
        }));
    }
    else if (style === 'karaoke') {
        // Karaoke: medium outline, slight shadow, no box (BorderStyle=1)
        lines.push(buildStyle({
            name: 'Default',
            font: 'Arial',
            size: fontSize,
            // Karaoke color semantics:
            // - SecondaryColour = base (chưa hát)  => fontColor
            // - PrimaryColour   = highlight (đang hát) => highlightColor
            primary: toAssColor("#".concat(highlightColor), 0),
            secondary: toAssColor("#".concat(fontColor), 0),
            outlineColor: toAssColor('#000000', 0),
            backColor: toAssColor('#000000', 255), // fully transparent box (no background)
            outline: 3,
            shadow: 1,
            borderStyle: 1,
            align: alignment,
            marginV: yPos * 10,
        }));
    }
    else {
        // Simple / Word-by-word: clean text, optional box for readability
        var isSimple = style === 'simple';
        lines.push(buildStyle({
            name: 'Default',
            font: 'Arial',
            size: fontSize,
            primary: toAssColor("#".concat(fontColor), 0),
            secondary: toAssColor("#".concat(highlightColor), 0),
            outlineColor: toAssColor('#000000', isSimple ? 0 : 0),
            backColor: toAssColor('#000000', isSimple ? 128 : 64),
            outline: isSimple ? 2 : 2,
            shadow: isSimple ? 0 : 1,
            borderStyle: isSimple ? 3 : 1,
            align: alignment,
            marginV: yPos * 10,
        }));
    }
    lines.push('');
    lines.push('[Events]');
    lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
    if (segments.length === 0) {
        throw new Error('No valid subtitle segments to generate ASS file');
    }
    // Generate subtitle events
    for (var _i = 0, segments_2 = segments; _i < segments_2.length; _i++) {
        var segment = segments_2[_i];
        if (!segment.text.trim() || segment.end <= segment.start) {
            continue; // Skip invalid segments
        }
        var segmentStartAdjusted = Math.max(0, segment.start - leadIn);
        var startTime = formatASSTime(segmentStartAdjusted);
        var endTime = formatASSTime(segment.end);
        // Generate subtitle based on style
        // CRITICAL: Log segment info for debugging
        var hasWords = segment.words && Array.isArray(segment.words) && segment.words.length > 0;
        console.log("[SubtitleGenerator] Segment: style=".concat(style, ", hasWords=").concat(hasWords, ", wordCount=").concat(((_b = segment.words) === null || _b === void 0 ? void 0 : _b.length) || 0));
        if (style === 'word-by-word' && hasWords) {
            // Word-by-word Pop effect: Each word gets its own dialogue with scale animation
            console.log("[SubtitleGenerator] Creating word-by-word pop effect with ".concat(segment.words.length, " words"));
            createWordByWordPopEffect(segment.words, lines, fontColor, highlightColor, segmentStartAdjusted, segment.text);
        }
        else if (style === 'karaoke' && hasWords) {
            // Karaoke traditional: All words visible, each word highlights when sung
            console.log("[SubtitleGenerator] Creating karaoke effect with ".concat(segment.words.length, " words"));
            var karaokeText = createKaraokeEffect(segment.words, fontColor, highlightColor, segmentStartAdjusted);
            console.log("[SubtitleGenerator] Karaoke text preview: ".concat(karaokeText.substring(0, 150), "..."));
            lines.push("Dialogue: 0,".concat(startTime, ",").concat(endTime, ",Default,,0,0,0,,").concat(karaokeText));
        }
        else if (style === 'dynamic' && hasWords) {
            // Dynamic Captions: Bold, stroke, highlight current word
            console.log("[SubtitleGenerator] Creating dynamic caption effect with ".concat(segment.words.length, " words"));
            var dynamicText = createDynamicCaptionEffect(segment.words, fontColor, highlightColor);
            lines.push("Dialogue: 0,".concat(startTime, ",").concat(endTime, ",Default,,0,0,0,,").concat(dynamicText));
        }
        else {
            // Fallback: Simple subtitle without effects
            // WARNING: This means word-level timestamps are missing!
            if (style === 'karaoke' || style === 'word-by-word' || style === 'dynamic') {
                console.warn("[SubtitleGenerator] \u26A0\uFE0F WARNING: Style is ".concat(style, " but no word-level timestamps available!"));
                console.warn("[SubtitleGenerator] \u26A0\uFE0F Falling back to simple text. Segment text: ".concat(segment.text.substring(0, 50), "..."));
                console.warn("[SubtitleGenerator] \u26A0\uFE0F This means Whisper did not return word-level timestamps.");
            }
            lines.push("Dialogue: 0,".concat(startTime, ",").concat(endTime, ",Default,,0,0,0,,").concat(segment.text.trim()));
        }
    }
    if (lines.length === 0) {
        throw new Error('No valid subtitle events after filtering');
    }
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
/**
 * Create professional karaoke effect text for ASS format (Aegisub standard)
 * Uses ASS karaoke tags: {\k<duration>} to highlight words as they are sung
 * Professional features:
 * - Color sweep effect (chữ đổi màu dần)
 * - Smooth transitions between words
 * - Proper timing alignment
 */
function createKaraokeEffect(words, _normalColor, _highlightColor, segmentStart // Dialogue start time (may include lead-in)
) {
    if (segmentStart === void 0) { segmentStart = 0; }
    var KARAOKE_KF_THRESHOLD_CS = 120; // 1.2s: longer syllables use \kf for smooth fill
    if (!words || words.length === 0)
        return '';
    // Dialogue start is provided (already includes lead-in). Use first word start as actual audio start.
    var firstWordStart = words[0].start;
    var lineStart = segmentStart > 0 ? segmentStart : firstWordStart;
    var initialOffsetCs = Math.max(0, Math.floor((firstWordStart - lineStart) * 100));
    var parts = [];
    var prevEnd = firstWordStart;
    for (var i = 0; i < words.length; i++) {
        var word = words[i];
        if (!word.word || word.word.trim().length === 0)
            continue;
        if (word.start < 0 || word.end <= word.start)
            continue;
        var gapCs = Math.max(0, Math.floor((word.start - prevEnd) * 100));
        var durCs = Math.max(1, Math.floor((word.end - word.start) * 100));
        var tag = durCs > KARAOKE_KF_THRESHOLD_CS ? 'kf' : 'k';
        var escapedWord = word.word
            .replace(/\\/g, '\\\\')
            .replace(/{/g, '\\{')
            .replace(/}/g, '\\}')
            .replace(/\n/g, '\\N')
            .replace(/\r/g, '');
        if (i > 0)
            parts.push(' ');
        if (i === 0) {
            // Apply initial wait to compensate lead-in, then highlight
            parts.push("{\\k".concat(initialOffsetCs, "}{\\").concat(tag).concat(durCs, "}").concat(escapedWord));
        }
        else {
            // Gap between words, then highlight
            if (gapCs > 0)
                parts.push("{\\k".concat(gapCs, "}"));
            parts.push("{\\".concat(tag).concat(durCs, "}").concat(escapedWord));
        }
        prevEnd = word.end;
    }
    if (parts.length === 0) {
        console.warn('[SubtitleGenerator] createKaraokeEffect: No valid words to create karaoke effect');
        return '';
    }
    var karaokeText = "{\\k0}".concat(parts.join(''));
    console.log("[SubtitleGenerator] \u2705 Created karaoke effect: ".concat(parts.length, " words"));
    console.log("[SubtitleGenerator] \uD83D\uDCDD Full sentence: ".concat(words.map(function (w) { return w.word; }).join(' ')));
    console.log("[SubtitleGenerator] \uD83D\uDCDD Karaoke preview: ".concat(karaokeText.substring(0, 250), "..."));
    return karaokeText;
}
/**
 * Create Word-by-word Pop effect (TikTok/Reels style)
 * All words shown together, but each word pops (scales up) when it's being sung
 */
function createWordByWordPopEffect(words, lines, normalColor, highlightColor, segmentStartOverride, baseText) {
    if (!words || words.length === 0) {
        return;
    }
    // Base dialogue (layer 0) with full text – keeps layout stable
    var segmentStart = segmentStartOverride !== null && segmentStartOverride !== void 0 ? segmentStartOverride : words[0].start;
    var segmentEnd = words[words.length - 1].end;
    var baseSentence = baseText && baseText.trim().length > 0
        ? baseText.trim()
        : words.map(function (w) { return w.word; }).join(' ');
    var baseStartTime = formatASSTime(segmentStart);
    var baseEndTime = formatASSTime(segmentEnd);
    lines.push("Dialogue: 0,".concat(baseStartTime, ",").concat(baseEndTime, ",Default,,0,0,0,,").concat(baseSentence));
    // Overlay dialogues (layer 1) – one per word, centered (TikTok/Reels style)
    var highlightAssColor = toAssColor("#".concat(highlightColor), 0);
    var normalAssColor = toAssColor("#".concat(normalColor), 0);
    for (var i = 0; i < words.length; i++) {
        var word = words[i];
        if (!word.word || word.word.trim().length === 0)
            continue;
        if (word.start < 0 || word.end <= word.start)
            continue;
        var wStart = word.start;
        var wEnd = word.end;
        var durMs = Math.max(100, Math.floor((wEnd - wStart) * 1000));
        var popDurationMs = Math.max(80, Math.floor(durMs * 0.3));
        var popStartMs = 0;
        var popEndMs = Math.min(durMs, popDurationMs);
        var startTime = formatASSTime(wStart);
        var endTime = formatASSTime(wEnd);
        var escapedWord = word.word
            .replace(/\\/g, '\\\\')
            .replace(/{/g, '\\{')
            .replace(/}/g, '\\}')
            .replace(/\n/g, '\\N')
            .replace(/\r/g, '');
        // Sparkle pop effect in a single override block
        var effect = "{" +
            "\\an5" +
            "\\alpha&HFF&" +
            "\\t(".concat(popStartMs, ",").concat(popEndMs, ",") +
            "\\alpha&H00&\\fscx130\\fscy130\\c".concat(highlightAssColor, "\\be10") +
            ")" +
            "\\t(".concat(popEndMs, ",").concat(durMs, ",") +
            "\\fscx110\\fscy110\\c".concat(normalAssColor, "\\be2") +
            ")" +
            "}".concat(escapedWord);
        lines.push("Dialogue: 1,".concat(startTime, ",").concat(endTime, ",Default,,0,0,0,,").concat(effect));
    }
}
/**
 * Create Dynamic Captions effect (Alex Hormozi style)
 * Features: Bold text, thick outline, slight rotation, highlight current word
 */
function createDynamicCaptionEffect(words, normalColor, highlightColor) {
    if (!words || words.length === 0) {
        return '';
    }
    var parts = [];
    for (var i = 0; i < words.length; i++) {
        var word = words[i];
        // Validate word
        if (!word.word || word.word.trim().length === 0) {
            continue;
        }
        // Validate timestamps
        if (word.start < 0 || word.end <= word.start) {
            continue;
        }
        var nextWord = words[i + 1];
        // Calculate duration in centiseconds
        var duration = nextWord
            ? Math.max(1, Math.floor((nextWord.start - word.start) * 100))
            : Math.max(1, Math.floor((word.end - word.start) * 100));
        // Escape word text
        var escapedWord = word.word
            .replace(/\\/g, '\\\\')
            .replace(/{/g, '\\{')
            .replace(/}/g, '\\}');
        // Dynamic Captions: Bold, thick outline, highlight current word
        // {\b1} = bold, {\k<duration>} = karaoke highlight, {\c&H00<color>&} = color
        // {\bord4} = thick outline (4 pixels), {\3c&H00<color>&} = outline color (black)
        // Highlight current word with yellow, others stay white
        parts.push("{\\k".concat(duration, "}{\\c&H00").concat(highlightColor, "&}{\\b1}{\\bord4}{\\3c&H00000000&}").concat(escapedWord, "{\\c&H00").concat(normalColor, "&}"));
    }
    if (parts.length === 0) {
        return '';
    }
    // Combine all words with dynamic styling
    // Initial state: normal color (white), bold, thick outline (black), slight rotation (-5 degrees)
    // Each word gets highlighted sequentially via {\k} tags
    // {\r} = reset style, {\an5} = center alignment
    return "{\\c&H00".concat(normalColor, "&}{\\b1}{\\bord4}{\\3c&H00000000&}{\\k0}").concat(parts.join(' '));
}
/**
 * Generate subtitle file (SRT or ASS) from Whisper result
 */
export function generateSubtitleFile(whisperResult_1, outputPath_1) {
    return __awaiter(this, arguments, void 0, function (whisperResult, outputPath, format, options) {
        var segments, segmentsWithWords, fileSize, fileContent, lines;
        if (format === void 0) { format = 'srt'; }
        return __generator(this, function (_a) {
            console.log("[SubtitleGenerator] \uD83C\uDFAC Generating ".concat(format.toUpperCase(), " subtitle file: ").concat(outputPath));
            console.log("[SubtitleGenerator] \uD83C\uDFAC Options:", options);
            segments = parseWhisperResult(whisperResult);
            if (segments.length === 0) {
                console.error('[SubtitleGenerator] ❌ No valid segments found in Whisper result');
                throw new Error('No subtitle segments found in Whisper result. Whisper may not have returned word-level timestamps.');
            }
            console.log("[SubtitleGenerator] \u2705 Generated ".concat(segments.length, " segments"));
            segmentsWithWords = segments.filter(function (seg) { return seg.words && seg.words.length > 0; }).length;
            console.log("[SubtitleGenerator] \uD83D\uDCCA Segments with word-level timestamps: ".concat(segmentsWithWords, "/").concat(segments.length));
            if (format === 'ass') {
                generateASS(segments, outputPath, options);
                console.log("[SubtitleGenerator] \u2705 ASS file generated successfully: ".concat(outputPath));
                // Verify file was created
                if (fs.existsSync(outputPath)) {
                    fileSize = fs.statSync(outputPath).size;
                    console.log("[SubtitleGenerator] \u2705 ASS file size: ".concat(fileSize, " bytes"));
                    // Log first few lines for debugging
                    try {
                        fileContent = fs.readFileSync(outputPath, 'utf-8');
                        lines = fileContent.split('\n');
                        console.log("[SubtitleGenerator] \uD83D\uDCC4 ASS file preview (first 10 lines):");
                        lines.slice(0, 10).forEach(function (line, i) {
                            console.log("[SubtitleGenerator]   ".concat(i + 1, ": ").concat(line.substring(0, 100)));
                        });
                    }
                    catch (error) {
                        console.warn("[SubtitleGenerator] \u26A0\uFE0F Could not read ASS file for preview:", error);
                    }
                }
                else {
                    console.error("[SubtitleGenerator] \u274C ASS file was not created: ".concat(outputPath));
                }
            }
            else {
                generateSRT(segments, outputPath);
                console.log("[SubtitleGenerator] \u2705 SRT file generated successfully: ".concat(outputPath));
            }
            return [2 /*return*/];
        });
    });
}
