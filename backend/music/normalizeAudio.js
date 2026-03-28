/**
 * Normalize Audio Bitrate
 * Chuẩn hóa bitrate của các file audio về cùng một giá trị
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
import path from 'node:path';
import { spawn } from 'child_process';
import { getFfmpegPaths } from '../ffmpeg/config';
import { probeFile } from '../ffmpeg/probe';
var SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.opus'];
var cancelRequested = false;
var currentFfmpegProcess = null;
export function cancelNormalizeAudio() {
    cancelRequested = true;
    if (currentFfmpegProcess) {
        try {
            currentFfmpegProcess.kill('SIGTERM');
        }
        catch (err) {
            console.warn('[normalizeAudio] Failed to kill FFmpeg process:', err);
        }
        currentFfmpegProcess = null;
    }
}
function resetCancelFlag() {
    cancelRequested = false;
    currentFfmpegProcess = null;
}
function isSupportedAudioFile(filePath) {
    var ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_AUDIO_EXTENSIONS.includes(ext);
}
function getAllAudioFilesInFolder(folderPath) {
    var files = [];
    function walkDir(currentDir) {
        try {
            var entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                var entry = entries_1[_i];
                var fullPath = path.join(currentDir, entry.name);
                try {
                    if (entry.isDirectory()) {
                        walkDir(fullPath);
                    }
                    else if (entry.isFile() && isSupportedAudioFile(fullPath)) {
                        files.push(fullPath);
                    }
                }
                catch (err) {
                    console.warn("[normalizeAudio] Failed to process ".concat(fullPath, ":"), err);
                }
            }
        }
        catch (err) {
            console.warn("[normalizeAudio] Failed to read directory ".concat(currentDir, ":"), err);
        }
    }
    walkDir(folderPath);
    return files;
}
/**
 * Xác định format output dựa trên file gốc
 */
function determineOutputFormat(inputFile, requestedFormat) {
    var inputExt = path.extname(inputFile).toLowerCase();
    if (requestedFormat === 'keep') {
        // Giữ nguyên format gốc
        if (inputExt === '.mp3') {
            return { format: 'mp3', codec: 'libmp3lame', extension: '.mp3' };
        }
        else if (inputExt === '.m4a' || inputExt === '.aac') {
            return { format: 'aac', codec: 'aac', extension: '.m4a' };
        }
        else if (inputExt === '.wav') {
            return { format: 'wav', codec: 'pcm_s16le', extension: '.wav' };
        }
        else if (inputExt === '.flac') {
            return { format: 'flac', codec: 'flac', extension: '.flac' };
        }
        // Default fallback
        return { format: 'mp3', codec: 'libmp3lame', extension: '.mp3' };
    }
    // Format được chỉ định
    if (requestedFormat === 'mp3') {
        return { format: 'mp3', codec: 'libmp3lame', extension: '.mp3' };
    }
    else if (requestedFormat === 'aac') {
        return { format: 'aac', codec: 'aac', extension: '.m4a' };
    }
    // Default: mp3
    return { format: 'mp3', codec: 'libmp3lame', extension: '.mp3' };
}
/**
 * Normalize một file audio
 */
function normalizeSingleFile(inputFile, targetBitrate, outputFormat, backupOriginal, outputFolder) {
    return __awaiter(this, void 0, void 0, function () {
        var probeResult, err_1, streams, hasAudioStream, hasAudioField, _a, format, codec, extension, inputDir, outputDir, inputName, outputFile, backupFile, ffmpeg_1, args_1, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 6, , 7]);
                    // Kiểm tra file tồn tại
                    if (!fs.existsSync(inputFile)) {
                        return [2 /*return*/, { success: false, error: 'File không tồn tại' }];
                    }
                    probeResult = void 0;
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, probeFile(inputFile)];
                case 2:
                    probeResult = _b.sent();
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _b.sent();
                    return [2 /*return*/, { success: false, error: "Kh\u00F4ng th\u1EC3 \u0111\u1ECDc file: ".concat(err_1.message) }];
                case 4:
                    streams = Array.isArray(probeResult.streams) ? probeResult.streams : [];
                    hasAudioStream = streams.some(function (s) { return (s === null || s === void 0 ? void 0 : s.codec_type) === 'audio'; });
                    hasAudioField = !!probeResult.audio;
                    if (!hasAudioStream && !hasAudioField) {
                        return [2 /*return*/, { success: false, error: 'File không có audio stream' }];
                    }
                    _a = determineOutputFormat(inputFile, outputFormat), format = _a.format, codec = _a.codec, extension = _a.extension;
                    inputDir = path.dirname(inputFile);
                    outputDir = outputFolder || inputDir;
                    // Tạo thư mục output nếu chưa tồn tại
                    if (!fs.existsSync(outputDir)) {
                        fs.mkdirSync(outputDir, { recursive: true });
                    }
                    inputName = path.basename(inputFile, path.extname(inputFile));
                    outputFile = path.join(outputDir, "".concat(inputName, "_normalized").concat(extension));
                    // Backup file gốc nếu cần (luôn backup vào thư mục gốc)
                    if (backupOriginal) {
                        backupFile = path.join(inputDir, "".concat(inputName, "_original").concat(path.extname(inputFile)));
                        if (!fs.existsSync(backupFile)) {
                            fs.copyFileSync(inputFile, backupFile);
                        }
                    }
                    ffmpeg_1 = getFfmpegPaths().ffmpeg;
                    args_1 = [
                        '-hide_banner',
                        '-loglevel',
                        'error',
                        '-i',
                        inputFile,
                        '-vn', // Không có video
                        '-ar',
                        '48000', // Sample rate chuẩn 48kHz cho YouTube
                        '-ac',
                        '2', // Stereo
                    ];
                    // Thêm codec và bitrate
                    if (format === 'mp3') {
                        args_1.push('-acodec', 'libmp3lame', '-b:a', "".concat(targetBitrate, "k"));
                    }
                    else if (format === 'aac') {
                        args_1.push('-acodec', 'aac', '-b:a', "".concat(targetBitrate, "k"));
                    }
                    else if (format === 'wav') {
                        args_1.push('-acodec', 'pcm_s16le');
                    }
                    else if (format === 'flac') {
                        args_1.push('-acodec', 'flac', '-compression_level', '5');
                    }
                    args_1.push('-y', outputFile);
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var _a;
                            var child = spawn(ffmpeg_1, args_1, { windowsHide: true });
                            currentFfmpegProcess = child;
                            var stderr = '';
                            (_a = child.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                                stderr += chunk.toString();
                            });
                            child.on('error', function (err) {
                                currentFfmpegProcess = null;
                                if (cancelRequested) {
                                    reject(new Error('Đã dừng bởi người dùng'));
                                }
                                else {
                                    reject(new Error("FFmpeg error: ".concat(err.message)));
                                }
                            });
                            child.on('close', function (code) {
                                currentFfmpegProcess = null;
                                if (cancelRequested) {
                                    reject(new Error('Đã dừng bởi người dùng'));
                                }
                                else if (code === 0) {
                                    resolve();
                                }
                                else {
                                    reject(new Error("FFmpeg exited with code ".concat(code, ". ").concat(stderr)));
                                }
                            });
                            // Kiểm tra cancel trong quá trình chạy
                            if (cancelRequested) {
                                try {
                                    child.kill('SIGTERM');
                                }
                                catch (err) {
                                    // Ignore
                                }
                                currentFfmpegProcess = null;
                                reject(new Error('Đã dừng bởi người dùng'));
                            }
                        })
                        // Kiểm tra output file đã tạo
                    ];
                case 5:
                    _b.sent();
                    // Kiểm tra output file đã tạo
                    if (!fs.existsSync(outputFile)) {
                        return [2 /*return*/, { success: false, error: 'File output không được tạo' }];
                    }
                    return [2 /*return*/, { success: true, outputFile: outputFile }];
                case 6:
                    error_1 = _b.sent();
                    return [2 /*return*/, { success: false, error: error_1.message || String(error_1) }];
                case 7: return [2 /*return*/];
            }
        });
    });
}
/**
 * Normalize audio files
 */
export function normalizeAudio(request, onProgress) {
    return __awaiter(this, void 0, void 0, function () {
        var filesToProcess, result, totalFiles, startTime, fileProcessingTimes, i, file, fileStartTime, elapsedSec, processedCount, remainingFiles, etaSeconds, avgTimePerFile, avgTimePerFile, percent, normalizeResult, fileProcessingTime, elapsedSec, processedCount, remainingFiles, etaSeconds, avgTimePerFile, percent;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    resetCancelFlag();
                    filesToProcess = [];
                    if (request.files && request.files.length > 0) {
                        // Dùng danh sách file được chỉ định
                        filesToProcess = request.files.filter(function (f) { return isSupportedAudioFile(f); });
                    }
                    else if (request.folder) {
                        // Quét folder
                        if (!fs.existsSync(request.folder)) {
                            throw new Error('Folder không tồn tại');
                        }
                        filesToProcess = getAllAudioFilesInFolder(request.folder);
                    }
                    else {
                        throw new Error('Phải chỉ định files hoặc folder');
                    }
                    if (filesToProcess.length === 0) {
                        return [2 /*return*/, {
                                success: true,
                                processed: 0,
                                failed: 0,
                                errors: [],
                                outputFiles: [],
                            }];
                    }
                    result = {
                        success: true,
                        processed: 0,
                        failed: 0,
                        errors: [],
                        outputFiles: [],
                    };
                    totalFiles = filesToProcess.length;
                    startTime = Date.now();
                    fileProcessingTimes = [] // Lưu thời gian xử lý mỗi file
                    ;
                    i = 0;
                    _b.label = 1;
                case 1:
                    if (!(i < filesToProcess.length)) return [3 /*break*/, 4];
                    file = filesToProcess[i];
                    fileStartTime = Date.now();
                    if (cancelRequested) {
                        result.success = false;
                        result.errors.push({ file: '[cancelled]', error: 'Đã dừng bởi người dùng' });
                        if (onProgress) {
                            onProgress({
                                currentFile: path.basename(file),
                                currentIndex: i,
                                totalFiles: totalFiles,
                                percent: Math.round((i / totalFiles) * 100),
                                status: 'cancelled',
                                error: 'Đã dừng bởi người dùng',
                                etaSeconds: 0,
                            });
                        }
                        return [3 /*break*/, 4];
                    }
                    // Emit progress trước khi xử lý file
                    if (onProgress) {
                        elapsedSec = (Date.now() - startTime) / 1000;
                        processedCount = i;
                        remainingFiles = totalFiles - processedCount;
                        etaSeconds = undefined;
                        if (processedCount > 0 && fileProcessingTimes.length > 0) {
                            avgTimePerFile = fileProcessingTimes.reduce(function (a, b) { return a + b; }, 0) / fileProcessingTimes.length;
                            etaSeconds = Math.max(0, Math.round(avgTimePerFile * remainingFiles));
                        }
                        else if (processedCount > 0 && elapsedSec > 0) {
                            avgTimePerFile = elapsedSec / processedCount;
                            etaSeconds = Math.max(0, Math.round(avgTimePerFile * remainingFiles));
                        }
                        percent = Math.round((processedCount / totalFiles) * 100);
                        onProgress({
                            currentFile: path.basename(file),
                            currentIndex: processedCount,
                            totalFiles: totalFiles,
                            percent: percent,
                            status: 'processing',
                            etaSeconds: etaSeconds,
                        });
                    }
                    return [4 /*yield*/, normalizeSingleFile(file, request.targetBitrate, request.outputFormat, (_a = request.backupOriginal) !== null && _a !== void 0 ? _a : false, request.outputFolder)
                        // Lưu thời gian xử lý file này
                    ];
                case 2:
                    normalizeResult = _b.sent();
                    fileProcessingTime = (Date.now() - fileStartTime) / 1000;
                    fileProcessingTimes.push(fileProcessingTime);
                    // Kiểm tra cancel sau khi xử lý file
                    if (cancelRequested) {
                        result.success = false;
                        result.errors.push({ file: '[cancelled]', error: 'Đã dừng bởi người dùng' });
                        if (onProgress) {
                            onProgress({
                                currentFile: '',
                                currentIndex: i + 1,
                                totalFiles: totalFiles,
                                percent: Math.round(((i + 1) / totalFiles) * 100),
                                status: 'cancelled',
                                error: 'Đã dừng bởi người dùng',
                                etaSeconds: 0,
                            });
                        }
                        return [3 /*break*/, 4];
                    }
                    if (normalizeResult.success && normalizeResult.outputFile) {
                        result.processed++;
                        result.outputFiles.push(normalizeResult.outputFile);
                    }
                    else {
                        result.failed++;
                        result.errors.push({
                            file: file,
                            error: normalizeResult.error || 'Unknown error',
                        });
                    }
                    // Emit progress sau khi xử lý file
                    if (onProgress) {
                        elapsedSec = (Date.now() - startTime) / 1000;
                        processedCount = i + 1;
                        remainingFiles = totalFiles - processedCount;
                        etaSeconds = undefined;
                        if (fileProcessingTimes.length > 0) {
                            avgTimePerFile = fileProcessingTimes.reduce(function (a, b) { return a + b; }, 0) / fileProcessingTimes.length;
                            etaSeconds = remainingFiles > 0 ? Math.max(0, Math.round(avgTimePerFile * remainingFiles)) : 0;
                        }
                        percent = Math.round((processedCount / totalFiles) * 100);
                        onProgress({
                            currentFile: processedCount < totalFiles ? path.basename(filesToProcess[processedCount] || '') : '',
                            currentIndex: processedCount,
                            totalFiles: totalFiles,
                            percent: percent,
                            status: 'processing',
                            etaSeconds: etaSeconds,
                        });
                    }
                    _b.label = 3;
                case 3:
                    i++;
                    return [3 /*break*/, 1];
                case 4:
                    // Emit final progress
                    if (onProgress) {
                        onProgress({
                            currentFile: '',
                            currentIndex: totalFiles,
                            totalFiles: totalFiles,
                            percent: 100,
                            status: cancelRequested ? 'cancelled' : result.failed === 0 ? 'completed' : 'error',
                            etaSeconds: 0,
                        });
                    }
                    result.success = !cancelRequested && result.failed === 0;
                    return [2 /*return*/, result];
            }
        });
    });
}
