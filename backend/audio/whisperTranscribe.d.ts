/**
 * Whisper Transcription Service
 * Uses @xenova/transformers to transcribe audio to text
 */
/**
 * Transcribe audio file to text using Whisper
 * @param audioPath Path to audio file
 * @param language Language code: 'auto' (auto-detect), 'vi' (Vietnamese), 'en' (English), 'zh' (Chinese), 'ja' (Japanese), 'ko' (Korean), 'th' (Thai), 'fr' (French), 'de' (German), 'es' (Spanish), 'it' (Italian), 'pt' (Portuguese), 'ru' (Russian), 'ar' (Arabic), 'hi' (Hindi), etc. (supports ~99 languages)
 * @param onProgress Progress callback
 * @param returnFullResult If true, returns full result object with timestamps. If false, returns only text string.
 */
export declare function transcribeAudio(audioPath: string, language?: string, onProgress?: (progress: {
    stage: string;
    message: string;
}) => void, returnFullResult?: boolean): Promise<string | any>;
/**
 * Check if Whisper is available (model can be loaded)
 */
export declare function checkWhisperAvailable(): Promise<boolean>;
/**
 * Get cache directory size (for cleanup if needed)
 */
export declare function getWhisperCacheSize(): Promise<number>;
