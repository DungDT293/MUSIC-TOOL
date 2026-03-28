/**
 * Whisper Transcription Service
 * Uses @xenova/transformers to transcribe audio to text
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
import { getFfmpegPaths } from '../ffmpeg/config';
import { spawn } from 'child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { transcribeWithFasterWhisper } from './whisperFasterService';
// Cache directory for models - try to use SSD if available
function getOptimalCacheDir() {
    return __awaiter(this, void 0, void 0, function () {
        var defaultCacheDir, getDiskInfo, diskInfo, minFreeGB, minFreeBytes, _i, _a, drive, ssdCacheDir, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    defaultCacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'transformers');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, import('../system/diskInfo')];
                case 2:
                    getDiskInfo = (_b.sent()).getDiskInfo;
                    return [4 /*yield*/, getDiskInfo()
                        // Find first SSD drive with enough space (at least 1GB free)
                    ];
                case 3:
                    diskInfo = _b.sent();
                    minFreeGB = 1;
                    minFreeBytes = minFreeGB * 1024 * 1024 * 1024;
                    if (diskInfo.byType.ssd && diskInfo.byType.ssd.freeBytes >= minFreeBytes) {
                        // Use SSD for cache - find a drive letter from SSD drives
                        for (_i = 0, _a = diskInfo.drives; _i < _a.length; _i++) {
                            drive = _a[_i];
                            if (drive.diskType === 'SSD' && drive.freeBytes && drive.freeBytes >= minFreeBytes) {
                                ssdCacheDir = path.join(drive.drive, 'huggingface', 'transformers');
                                console.log("[Whisper] Using SSD cache directory: ".concat(ssdCacheDir, " (").concat(drive.drive, " has ").concat((drive.freeBytes / 1024 / 1024 / 1024).toFixed(1), " GB free)"));
                                return [2 /*return*/, ssdCacheDir];
                            }
                        }
                    }
                    console.log("[Whisper] Using default cache directory: ".concat(defaultCacheDir));
                    return [2 /*return*/, defaultCacheDir];
                case 4:
                    error_1 = _b.sent();
                    console.warn("[Whisper] Failed to detect SSD, using default cache:", error_1);
                    return [2 /*return*/, defaultCacheDir];
                case 5: return [2 /*return*/];
            }
        });
    });
}
// Cache directory for models - will be set to SSD if available
var CACHE_DIR = path.join(os.homedir(), '.cache', 'huggingface', 'transformers');
var whisperPipeline = null;
var isInitializing = false;
var initPromise = null;
var transformersModule = null;
/**
 * Dynamically import @xenova/transformers (ES Module)
 */
function loadTransformers() {
    return __awaiter(this, void 0, void 0, function () {
        var error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (transformersModule) {
                        return [2 /*return*/, transformersModule];
                    }
                    return [4 /*yield*/, import('@xenova/transformers')
                        // Configure environment
                    ];
                case 1:
                    // Dynamic import for ES Module
                    transformersModule = _a.sent();
                    // Configure environment
                    transformersModule.env.allowLocalModels = false;
                    transformersModule.env.allowRemoteModels = true;
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 5, , 6]);
                    return [4 /*yield*/, getOptimalCacheDir()
                        // Ensure cache directory exists
                    ];
                case 3:
                    CACHE_DIR = _a.sent();
                    // Ensure cache directory exists
                    return [4 /*yield*/, fsp.mkdir(CACHE_DIR, { recursive: true }).catch(function () { })];
                case 4:
                    // Ensure cache directory exists
                    _a.sent();
                    transformersModule.env.cacheDir = CACHE_DIR;
                    console.log("[Whisper] \u2705 Cache directory set to: ".concat(CACHE_DIR));
                    return [3 /*break*/, 6];
                case 5:
                    error_2 = _a.sent();
                    console.warn("[Whisper] Failed to set optimal cache directory:", error_2);
                    return [3 /*break*/, 6];
                case 6:
                    // Note: @xenova/transformers in Node.js main process doesn't support WebGPU
                    // Navigator is not available in Node.js, so WebGPU detection always fails
                    // We'll use explicit CPU device to avoid detection overhead and optimize for CPU performance
                    console.log('[Whisper] Using CPU device (Node.js main process - WebGPU not available)');
                    return [2 /*return*/, transformersModule];
            }
        });
    });
}
/**
 * Initialize Whisper pipeline (lazy loading)
 */
function getWhisperPipeline() {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            if (whisperPipeline) {
                return [2 /*return*/, whisperPipeline];
            }
            if (isInitializing && initPromise) {
                return [2 /*return*/, initPromise];
            }
            isInitializing = true;
            initPromise = (function () { return __awaiter(_this, void 0, void 0, function () {
                var transformers, deviceInfo, error_3;
                var _a, _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            _c.trys.push([0, 3, , 4]);
                            return [4 /*yield*/, loadTransformers()
                                // Use Whisper Small model for best accuracy (vs Tiny/Base)
                                // Small model is significantly more accurate than Base/Tiny
                                // Model sizes: tiny (~75MB) < base (~150MB) < small (~500MB) < medium (~1.5GB)
                                // Small provides excellent accuracy while still being manageable in size
                            ];
                        case 1:
                            transformers = _c.sent();
                            // Use Whisper Small model for best accuracy (vs Tiny/Base)
                            // Small model is significantly more accurate than Base/Tiny
                            // Model sizes: tiny (~75MB) < base (~150MB) < small (~500MB) < medium (~1.5GB)
                            // Small provides excellent accuracy while still being manageable in size
                            console.log('[Whisper] Loading Whisper Small model (best accuracy)...');
                            console.log("[Whisper] Cache directory: ".concat(CACHE_DIR));
                            console.log('[Whisper] Note: Small model is ~500MB, first download may take several minutes');
                            return [4 /*yield*/, transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-small', // Upgraded to Small for best accuracy and word-level timestamps
                                {
                                    quantized: true, // Use quantized model for smaller size and faster loading
                                    device: 'cpu', // Explicit CPU - faster than auto-detect overhead
                                    progress_callback: function (progress) {
                                        if (progress.status === 'progress') {
                                            console.log("[Whisper] Downloading model: ".concat(progress.progress || 0, "%"));
                                        }
                                    },
                                })
                                // Log device info after pipeline creation
                            ];
                        case 2:
                            // Use explicit CPU device - faster than auto-detect overhead in Node.js
                            // @xenova/transformers in Node.js main process doesn't support WebGPU/CUDA
                            // Explicit CPU setting avoids detection overhead and optimizes for CPU performance
                            whisperPipeline = _c.sent();
                            deviceInfo = ((_a = whisperPipeline === null || whisperPipeline === void 0 ? void 0 : whisperPipeline.processor) === null || _a === void 0 ? void 0 : _a.device) || ((_b = whisperPipeline === null || whisperPipeline === void 0 ? void 0 : whisperPipeline.model) === null || _b === void 0 ? void 0 : _b.device) || 'cpu';
                            console.log("[Whisper] \u2705 Pipeline created, device: ".concat(deviceInfo));
                            console.log("[Whisper] \u2705 Using CPU (optimized for Node.js main process)");
                            console.log('[Whisper] Model loaded successfully');
                            isInitializing = false;
                            return [2 /*return*/, whisperPipeline];
                        case 3:
                            error_3 = _c.sent();
                            isInitializing = false;
                            initPromise = null;
                            console.error('[Whisper] Failed to load model:', error_3);
                            throw error_3;
                        case 4: return [2 /*return*/];
                    }
                });
            }); })();
            return [2 /*return*/, initPromise];
        });
    });
}
/**
 * Convert audio file to WAV format (required by Whisper)
 */
function convertAudioToWav(inputPath, outputPath) {
    return __awaiter(this, void 0, void 0, function () {
        var ffmpeg;
        return __generator(this, function (_a) {
            ffmpeg = getFfmpegPaths().ffmpeg;
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var _a;
                    // Improved audio preprocessing for better Whisper accuracy:
                    // - 16kHz sample rate (Whisper requirement)
                    // - Mono channel (required)
                    // - High-pass filter to remove low-frequency noise
                    // - Low-pass filter to remove high-frequency noise
                    // - Normalize audio levels for better recognition
                    var args = [
                        '-i', inputPath,
                        '-ar', '16000', // 16kHz sample rate (Whisper requirement)
                        '-ac', '1', // Mono channel
                        '-af', 'highpass=f=80,lowpass=f=8000,volume=1.0', // Filter noise and normalize
                        '-f', 'wav', // WAV format
                        '-y', // Overwrite
                        outputPath,
                    ];
                    var proc = spawn(ffmpeg, args, { windowsHide: true });
                    var stderr = '';
                    (_a = proc.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                        stderr += chunk.toString('utf-8');
                    });
                    proc.on('error', function (err) {
                        reject(new Error("FFmpeg error: ".concat(err.message)));
                    });
                    proc.on('close', function (code) {
                        if (code === 0) {
                            resolve();
                        }
                        else {
                            reject(new Error("FFmpeg exited with code ".concat(code, ". ").concat(stderr.substring(0, 500))));
                        }
                    });
                })];
        });
    });
}
/**
 * Transcribe audio file to text using Whisper
 * @param audioPath Path to audio file
 * @param language Language code: 'auto' (auto-detect), 'vi' (Vietnamese), 'en' (English), 'zh' (Chinese), 'ja' (Japanese), 'ko' (Korean), 'th' (Thai), 'fr' (French), 'de' (German), 'es' (Spanish), 'it' (Italian), 'pt' (Portuguese), 'ru' (Russian), 'ar' (Arabic), 'hi' (Hindi), etc. (supports ~99 languages)
 * @param onProgress Progress callback
 * @param returnFullResult If true, returns full result object with timestamps. If false, returns only text string.
 */
export function transcribeAudio(audioPath_1) {
    return __awaiter(this, arguments, void 0, function (audioPath, language, onProgress, returnFullResult) {
        var gpuEnv, tryGpuFirst, gpuResult, error_4, tempDir, wavPath, error_5, pipeline, wavBuffer, pcmData, float32Array, i, sample, result, firstChunk, text, error_6;
        var _a;
        if (language === void 0) { language = 'auto'; }
        if (returnFullResult === void 0) { returnFullResult = false; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    gpuEnv = process.env.WHISPER_GPU_ENABLED;
                    tryGpuFirst = gpuEnv === undefined || gpuEnv === '1' || gpuEnv === 'true';
                    if (!tryGpuFirst) return [3 /*break*/, 4];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({
                        stage: 'transcribing',
                        message: 'Đang nhận diện lời bài hát bằng GPU (Faster-Whisper)...',
                    });
                    return [4 /*yield*/, transcribeWithFasterWhisper({
                            audioPath: audioPath,
                            language: language,
                        })];
                case 2:
                    gpuResult = _b.sent();
                    console.log('[Whisper] ✅ Using Faster-Whisper GPU result');
                    if (returnFullResult) {
                        return [2 /*return*/, gpuResult];
                    }
                    return [2 /*return*/, gpuResult.text || ''];
                case 3:
                    error_4 = _b.sent();
                    console.warn('[Whisper] ⚠️ Faster-Whisper GPU path failed, falling back to CPU implementation:', error_4);
                    return [3 /*break*/, 4];
                case 4:
                    _b.trys.push([4, 15, , 16]);
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ stage: 'converting', message: 'Đang chuyển đổi audio sang WAV (CPU)...' });
                    return [4 /*yield*/, fs.promises.mkdtemp(path.join(os.tmpdir(), 'whisper-'))];
                case 5:
                    tempDir = _b.sent();
                    wavPath = path.join(tempDir, 'audio.wav');
                    _b.label = 6;
                case 6:
                    _b.trys.push([6, 8, , 10]);
                    return [4 /*yield*/, convertAudioToWav(audioPath, wavPath)];
                case 7:
                    _b.sent();
                    return [3 /*break*/, 10];
                case 8:
                    error_5 = _b.sent();
                    return [4 /*yield*/, fs.promises.rm(tempDir, { recursive: true, force: true }).catch(function () { })];
                case 9:
                    _b.sent();
                    throw new Error("Failed to convert audio: ".concat(error_5 instanceof Error ? error_5.message : String(error_5)));
                case 10:
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ stage: 'loading', message: 'Đang tải Whisper model (lần đầu có thể mất vài phút)...' });
                    return [4 /*yield*/, getWhisperPipeline()];
                case 11:
                    pipeline = _b.sent();
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ stage: 'transcribing', message: 'Đang nhận diện lời bài hát...' });
                    return [4 /*yield*/, fs.promises.readFile(wavPath)
                        // WAV file structure: header (44 bytes) + PCM data
                        // Skip WAV header (first 44 bytes) to get raw PCM data
                    ];
                case 12:
                    wavBuffer = _b.sent();
                    pcmData = wavBuffer.subarray(44);
                    float32Array = new Float32Array(pcmData.length / 2) // 16-bit = 2 bytes per sample
                    ;
                    for (i = 0; i < float32Array.length; i++) {
                        sample = pcmData.readInt16LE(i * 2);
                        float32Array[i] = sample / 32768.0;
                    }
                    return [4 /*yield*/, pipeline(float32Array, {
                            return_timestamps: returnFullResult ? 'word' : 'word', // ALWAYS use word-level for better karaoke
                            language: language === 'auto' ? null : language, // null = auto-detect, otherwise use specified language
                            task: 'transcribe',
                            chunk_length_s: 30, // Process in 30-second chunks
                            // Improved accuracy options (supported by @xenova/transformers)
                            temperature: 0, // Deterministic output (0 = most deterministic, reduces hallucinations)
                            no_speech_threshold: 0.5, // Lower threshold (0.5) to reduce hallucinations in silent parts
                            // Note: condition_on_previous_text, compression_ratio_threshold, logprob_threshold
                            // may not be supported by @xenova/transformers, so we only use basic options
                        })
                        // Log result structure for debugging
                    ];
                case 13:
                    result = _b.sent();
                    // Log result structure for debugging
                    console.log("[Whisper] Result type: ".concat(typeof result));
                    console.log("[Whisper] Result has text: ".concat(!!(result === null || result === void 0 ? void 0 : result.text)));
                    console.log("[Whisper] Result has chunks: ".concat(!!(result === null || result === void 0 ? void 0 : result.chunks)));
                    if ((result === null || result === void 0 ? void 0 : result.chunks) && Array.isArray(result.chunks)) {
                        console.log("[Whisper] Chunks count: ".concat(result.chunks.length));
                        if (result.chunks.length > 0) {
                            firstChunk = result.chunks[0];
                            console.log("[Whisper] First chunk has words: ".concat(!!(firstChunk === null || firstChunk === void 0 ? void 0 : firstChunk.words)));
                            console.log("[Whisper] First chunk words count: ".concat(((_a = firstChunk === null || firstChunk === void 0 ? void 0 : firstChunk.words) === null || _a === void 0 ? void 0 : _a.length) || 0));
                        }
                    }
                    // Cleanup temp file
                    return [4 /*yield*/, fs.promises.rm(tempDir, { recursive: true, force: true }).catch(function () { })];
                case 14:
                    // Cleanup temp file
                    _b.sent();
                    text = (result === null || result === void 0 ? void 0 : result.text) || '';
                    if (!text.trim()) {
                        throw new Error('Whisper không nhận diện được lời bài hát');
                    }
                    onProgress === null || onProgress === void 0 ? void 0 : onProgress({ stage: 'done', message: 'Hoàn tất nhận diện lời bài hát' });
                    // Return full result with timestamps if requested, otherwise return text only
                    if (returnFullResult) {
                        return [2 /*return*/, result];
                    }
                    return [2 /*return*/, text.trim()];
                case 15:
                    error_6 = _b.sent();
                    console.error('[Whisper] Transcription error:', error_6);
                    throw error_6;
                case 16: return [2 /*return*/];
            }
        });
    });
}
/**
 * Check if Whisper is available (model can be loaded)
 */
export function checkWhisperAvailable() {
    return __awaiter(this, void 0, void 0, function () {
        var error_7;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, getWhisperPipeline()];
                case 1:
                    _a.sent();
                    return [2 /*return*/, true];
                case 2:
                    error_7 = _a.sent();
                    console.warn('[Whisper] Not available:', error_7);
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Get cache directory size (for cleanup if needed)
 */
export function getWhisperCacheSize() {
    return new Promise(function (resolve) {
        if (!fs.existsSync(CACHE_DIR)) {
            resolve(0);
            return;
        }
        var totalSize = 0;
        var walk = function (dir) {
            try {
                var files = fs.readdirSync(dir);
                for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
                    var file = files_1[_i];
                    var filePath = path.join(dir, file);
                    var stat = fs.statSync(filePath);
                    if (stat.isDirectory()) {
                        walk(filePath);
                    }
                    else {
                        totalSize += stat.size;
                    }
                }
            }
            catch (error) {
                // Ignore errors
            }
        };
        walk(CACHE_DIR);
        resolve(totalSize);
    });
}
