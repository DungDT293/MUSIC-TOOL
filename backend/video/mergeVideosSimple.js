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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
// Low: centralize magic numbers
var CANCEL_CHECK_INTERVAL_MS = 500;
var SIGKILL_DELAY_MS = 1000;
/**
 * Merge Videos Simple - Ghép nhiều video với thuật toán tối ưu tốc độ
 * Chỉ dùng 1 lệnh concat + 0 hoặc 1 lệnh cut (copy-stream, không re-encode)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { getFfmpegPaths } from '../ffmpeg/config';
import { getVideoFileInfo } from './videoInfo';
import { verifyOutputVideo } from './outputVerification';
import { buildMergeProgress } from './videoProgress';
import { validateInputFiles } from './videoUtils';
import { buildRandomPermutations, buildPlaylistToFillDuration, shuffleOnce, } from './utils/videoShuffleHelpers';
import { videoJobManager } from './videoJobManager';
import { checkMinimumSpace, createDiskSpaceErrorMessage, formatBytes, getDiskSpace, } from '../utils/diskSpace';
/**
 * C4: Debug mode flag (from environment variable)
 */
var MERGE_DEBUG = process.env.MERGE_DEBUG === '1';
/**
 * C4: Debug log helper
 */
function debugLog(message) {
    var args = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        args[_i - 1] = arguments[_i];
    }
    if (MERGE_DEBUG) {
        console.log.apply(console, __spreadArray(["[mergeVideosSimple:DEBUG] ".concat(message)], args, false));
    }
}
/**
 * Build concat list content for FFmpeg
 */
function buildConcatListContent(filePaths) {
    return filePaths.map(function (filePath) { return "file '".concat(filePath.replace(/'/g, "'\\''"), "'"); }).join('\n');
}
var DEFAULT_VIDEO_CLIP_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB fallback
function estimateConcatBytes(files, sizeLookup) {
    var knownTotal = 0;
    var knownCount = 0;
    for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
        var file = files_1[_i];
        var size = sizeLookup.get(file);
        if (typeof size === 'number' && size > 0) {
            knownTotal += size;
            knownCount++;
        }
    }
    var avgSize = knownCount > 0 ? knownTotal / knownCount : DEFAULT_VIDEO_CLIP_SIZE_BYTES;
    return files.reduce(function (sum, file) {
        var size = sizeLookup.get(file);
        return sum + (typeof size === 'number' && size > 0 ? size : avgSize);
    }, 0);
}
function ensureMergeDiskCapacity(outputDir, estimatedBytes, currentIndex, totalJobs) {
    return __awaiter(this, void 0, void 0, function () {
        var diskInfo, buffer, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, getDiskSpace(outputDir)];
                case 1:
                    diskInfo = _a.sent();
                    buffer = Math.max(estimatedBytes * 1.05, 4 * 1024 * 1024 * 1024) // +5% hoặc tối thiểu 4GB
                    ;
                    if (diskInfo.free < buffer) {
                        throw new Error("\u1ED4 ".concat(diskInfo.drive, " ch\u1EC9 c\u00F2n ").concat(formatBytes(diskInfo.free), " nh\u01B0ng video ").concat(currentIndex, "/").concat(totalJobs, " \u01B0\u1EDBc t\u00EDnh c\u1EA7n kho\u1EA3ng ").concat(formatBytes(estimatedBytes), ". Vui l\u00F2ng d\u1ECDn d\u1EB9p dung l\u01B0\u1EE3ng tr\u01B0\u1EDBc khi ti\u1EBFp t\u1EE5c."));
                    }
                    return [3 /*break*/, 3];
                case 2:
                    err_1 = _a.sent();
                    if (err_1 instanceof Error) {
                        throw err_1;
                    }
                    throw new Error('Không thể kiểm tra dung lượng ổ đĩa trước khi ghép video.');
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * C3: Run FFmpeg concat (copy-stream) with retry and timeout
 */
function runConcat(concatListPath_1, outputPath_1, mute_1, onProgress_1, totalDurationSec_1) {
    return __awaiter(this, arguments, void 0, function (concatListPath, outputPath, mute, onProgress, totalDurationSec, retryCount, requestId) {
        var ffmpegPath, MAX_RETRIES, TIMEOUT_MS;
        var _this = this;
        if (retryCount === void 0) { retryCount = 0; }
        return __generator(this, function (_a) {
            ffmpegPath = getFfmpegPaths().ffmpeg;
            MAX_RETRIES = 1;
            TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
            ;
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var _a;
                    // Check cancel trước khi bắt đầu
                    if (requestId && videoJobManager.isCancelled(requestId)) {
                        reject(new Error('Đã dừng bởi người dùng'));
                        return;
                    }
                    // C3: Simple args for retry (remove extra flags)
                    var args = retryCount > 0
                        ? __spreadArray(__spreadArray([
                            '-v', 'error',
                            '-f', 'concat',
                            '-safe', '0',
                            '-i', concatListPath,
                            '-c', 'copy'
                        ], (mute ? ['-an'] : []), true), [
                            outputPath,
                            '-y',
                        ], false) : __spreadArray(__spreadArray([
                        '-v', 'error',
                        '-stats',
                        '-f', 'concat',
                        '-safe', '0',
                        '-i', concatListPath,
                        '-c', 'copy'
                    ], (mute ? ['-an'] : []), true), [
                        outputPath,
                        '-y',
                    ], false);
                    var ffmpeg = spawn(ffmpegPath, args, {
                        stdio: ['ignore', 'ignore', 'pipe'],
                        windowsHide: true,
                    });
                    // Register process vào videoJobManager để có thể cancel
                    if (requestId) {
                        videoJobManager.registerJob(requestId, ffmpeg);
                    }
                    // C3: Timeout protection
                    var timeoutId = setTimeout(function () {
                        clearInterval(cancelCheckInterval); // Fix Critical #1.2: Clear interval on timeout
                        try {
                            ffmpeg.kill('SIGKILL');
                        }
                        catch (_a) { }
                        reject(new Error("FFmpeg concat timed out after ".concat(TIMEOUT_MS / 1000, "s")));
                    }, TIMEOUT_MS);
                    var stderr = '';
                    var lastProgressTime = 0;
                    var lastSpeedX = null;
                    var dropWarned = false;
                    var progressStartTime = Date.now();
                    // Interval check cancellation (mỗi 500ms) để đảm bảo phản hồi nhanh
                    var cancelCheckInterval = setInterval(function () {
                        if (requestId && videoJobManager.isCancelled(requestId)) {
                            clearInterval(cancelCheckInterval);
                            clearTimeout(timeoutId); // Also clear timeout when cancelling
                            console.log("[runConcat] Job ".concat(requestId, " cancelled (interval check), killing FFmpeg process"));
                            if (!ffmpeg.killed) {
                                ffmpeg.kill('SIGTERM');
                                setTimeout(function () {
                                    if (!ffmpeg.killed && ffmpeg.pid) {
                                        try {
                                            ffmpeg.kill('SIGKILL');
                                        }
                                        catch (err) {
                                            // Ignore errors
                                        }
                                    }
                                }, SIGKILL_DELAY_MS);
                            }
                            reject(new Error('Đã dừng bởi người dùng'));
                        }
                    }, CANCEL_CHECK_INTERVAL_MS);
                    (_a = ffmpeg.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (data) {
                        // Check nếu job đã bị cancel - kill process ngay lập tức
                        if (requestId && videoJobManager.isCancelled(requestId)) {
                            clearInterval(cancelCheckInterval);
                            clearTimeout(timeoutId); // Also clear timeout when cancelling
                            console.log("[runConcat] Job ".concat(requestId, " cancelled, killing FFmpeg process"));
                            if (!ffmpeg.killed) {
                                ffmpeg.kill('SIGTERM');
                                setTimeout(function () {
                                    if (!ffmpeg.killed && ffmpeg.pid) {
                                        try {
                                            ffmpeg.kill('SIGKILL');
                                        }
                                        catch (err) {
                                            // Ignore errors
                                        }
                                    }
                                }, 1000);
                            }
                            reject(new Error('Đã dừng bởi người dùng'));
                            return;
                        }
                        var chunk = data.toString('utf-8');
                        stderr += chunk;
                        // Parse progress từ time= và speed=
                        if (chunk.includes('time=') && onProgress) {
                            var timeMatch = chunk.match(/time=([0-9:.]+)/);
                            if (timeMatch && timeMatch[1]) {
                                var timeStr = timeMatch[1];
                                var parts = timeStr.split(':');
                                if (parts.length === 3) {
                                    var hours = parseFloat(parts[0]) || 0;
                                    var minutes = parseFloat(parts[1]) || 0;
                                    var seconds = parseFloat(parts[2]) || 0;
                                    var currentTimeSec = hours * 3600 + minutes * 60 + seconds;
                                    // Emit progress mỗi 0.1 giây (giảm từ 0.2s để cập nhật thường xuyên hơn)
                                    if (currentTimeSec - lastProgressTime >= 0.1) {
                                        lastProgressTime = currentTimeSec;
                                        // Tính percent dựa trên totalDurationSec (bắt buộc phải có khi không có target)
                                        var percent = 0;
                                        if (totalDurationSec && totalDurationSec > 0) {
                                            percent = Math.min(100, Math.max(0, (currentTimeSec / totalDurationSec) * 100));
                                        }
                                        else {
                                            // Nếu không có totalDurationSec, estimate từ elapsed time (fallback)
                                            var elapsedSec = (Date.now() - progressStartTime) / 1000;
                                            if (elapsedSec > 0 && currentTimeSec > 0) {
                                                // Estimate: giả sử tốc độ ổn định (chỉ dùng khi không có totalDurationSec)
                                                var estimatedTotal = currentTimeSec * 2; // Rough estimate
                                                percent = Math.min(95, (currentTimeSec / estimatedTotal) * 100);
                                            }
                                        }
                                        // Parse speed
                                        var speedMatch_1 = chunk.match(/speed=\s*([0-9.]+)x/i);
                                        if (speedMatch_1 && speedMatch_1[1]) {
                                            var speed = parseFloat(speedMatch_1[1]);
                                            if (!isNaN(speed) && speed > 0) {
                                                lastSpeedX = speed;
                                            }
                                        }
                                        // Calculate ETA
                                        var etaSec = null;
                                        if (lastSpeedX && lastSpeedX > 0 && totalDurationSec) {
                                            var remainingSec = totalDurationSec - currentTimeSec;
                                            etaSec = remainingSec > 0 ? remainingSec / lastSpeedX : 0;
                                        }
                                        onProgress({
                                            percent: Math.min(100, Math.max(0, percent)),
                                            timeSec: currentTimeSec,
                                            totalDurationSec: totalDurationSec,
                                            speedX: lastSpeedX,
                                            etaSec: etaSec,
                                        });
                                    }
                                }
                            }
                        }
                        // Parse speed từ chunk riêng
                        var speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i);
                        if (speedMatch && speedMatch[1]) {
                            var speed = parseFloat(speedMatch[1]);
                            if (!isNaN(speed) && speed > 0) {
                                lastSpeedX = speed;
                            }
                        }
                        // Log drop-frame / retry warnings
                        if (!dropWarned && /drop=\d+/i.test(chunk)) {
                            dropWarned = true;
                            console.warn('[mergeVideosSimple] FFmpeg báo drop-frame trong quá trình concat:\n', chunk);
                        }
                    });
                    ffmpeg.on('error', function (error) {
                        clearTimeout(timeoutId);
                        clearInterval(cancelCheckInterval);
                        reject(new Error("FFmpeg concat error: ".concat(error.message)));
                    });
                    ffmpeg.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                        var stats, retryError_1, retryError_2;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    clearTimeout(timeoutId);
                                    clearInterval(cancelCheckInterval);
                                    // Nếu job đã bị cancel, reject
                                    if (requestId && videoJobManager.isCancelled(requestId)) {
                                        reject(new Error('Đã dừng bởi người dùng'));
                                        return [2 /*return*/];
                                    }
                                    if (!(code === 0 && fs.existsSync(outputPath))) return [3 /*break*/, 7];
                                    stats = fs.statSync(outputPath);
                                    if (!(stats.size === 0)) return [3 /*break*/, 6];
                                    if (!(retryCount < MAX_RETRIES)) return [3 /*break*/, 5];
                                    console.log("[mergeVideosSimple] Retry concat (empty file), attempt ".concat(retryCount + 1, "/").concat(MAX_RETRIES));
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, runConcat(concatListPath, outputPath, mute, onProgress, totalDurationSec, retryCount + 1, requestId)];
                                case 2:
                                    _a.sent();
                                    resolve();
                                    return [3 /*break*/, 4];
                                case 3:
                                    retryError_1 = _a.sent();
                                    reject(new Error("FFmpeg concat produced empty file after retry: ".concat(retryError_1)));
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                                case 5:
                                    reject(new Error('FFmpeg concat produced empty file'));
                                    return [2 /*return*/];
                                case 6:
                                    // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
                                    if (onProgress && totalDurationSec) {
                                        onProgress({
                                            percent: 100,
                                            timeSec: totalDurationSec,
                                            totalDurationSec: totalDurationSec,
                                            speedX: lastSpeedX,
                                            etaSec: 0,
                                        });
                                    }
                                    resolve();
                                    return [3 /*break*/, 13];
                                case 7:
                                    if (!(retryCount < MAX_RETRIES)) return [3 /*break*/, 12];
                                    console.log("[mergeVideosSimple] Retry concat (code ".concat(code, "), attempt ").concat(retryCount + 1, "/").concat(MAX_RETRIES));
                                    _a.label = 8;
                                case 8:
                                    _a.trys.push([8, 10, , 11]);
                                    return [4 /*yield*/, runConcat(concatListPath, outputPath, mute, onProgress, totalDurationSec, retryCount + 1, requestId)];
                                case 9:
                                    _a.sent();
                                    resolve();
                                    return [3 /*break*/, 11];
                                case 10:
                                    retryError_2 = _a.sent();
                                    reject(new Error("FFmpeg concat failed with code ".concat(code, " after retry: ").concat(stderr.slice(0, 500))));
                                    return [3 /*break*/, 11];
                                case 11: return [2 /*return*/];
                                case 12:
                                    reject(new Error("FFmpeg concat failed with code ".concat(code, ": ").concat(stderr.slice(0, 500))));
                                    _a.label = 13;
                                case 13: return [2 /*return*/];
                            }
                        });
                    }); });
                })];
        });
    });
}
/**
 * D3: Run FFmpeg concat + cut in 1 pass (ultra-fast)
 */
function runConcatWithCut(concatListPath_1, outputPath_1, targetDurationSec_1, mute_1, onProgress_1) {
    return __awaiter(this, arguments, void 0, function (concatListPath, outputPath, targetDurationSec, mute, onProgress, retryCount, requestId) {
        var ffmpegPath, MAX_RETRIES, TIMEOUT_MS;
        var _this = this;
        if (retryCount === void 0) { retryCount = 0; }
        return __generator(this, function (_a) {
            ffmpegPath = getFfmpegPaths().ffmpeg;
            MAX_RETRIES = 1;
            TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
            ;
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var _a;
                    // D3: Gộp concat + cut thành 1 lệnh
                    var args = retryCount > 0
                        ? __spreadArray(__spreadArray([
                            '-v', 'error',
                            '-f', 'concat',
                            '-safe', '0',
                            '-i', concatListPath,
                            '-t', String(targetDurationSec),
                            '-c', 'copy'
                        ], (mute ? ['-an'] : []), true), [
                            outputPath,
                            '-y',
                        ], false) : __spreadArray(__spreadArray([
                        '-v', 'error',
                        '-stats',
                        '-f', 'concat',
                        '-safe', '0',
                        '-i', concatListPath,
                        '-t', String(targetDurationSec),
                        '-c', 'copy'
                    ], (mute ? ['-an'] : []), true), [
                        outputPath,
                        '-y',
                    ], false);
                    var ffmpeg = spawn(ffmpegPath, args, {
                        stdio: ['ignore', 'ignore', 'pipe'],
                        windowsHide: true,
                    });
                    // Register process vào videoJobManager để có thể cancel
                    if (requestId) {
                        videoJobManager.registerJob(requestId, ffmpeg);
                    }
                    // D3: Timeout protection
                    var timeoutId = setTimeout(function () {
                        clearInterval(cancelCheckInterval); // Fix Critical #1.2: Clear interval on timeout
                        try {
                            ffmpeg.kill('SIGKILL');
                        }
                        catch (_a) { }
                        reject(new Error("FFmpeg concat+cut timed out after ".concat(TIMEOUT_MS / 1000, "s")));
                    }, TIMEOUT_MS);
                    var stderr = '';
                    var lastProgressTime = 0;
                    var lastSpeedX = null;
                    // Interval check cancellation (mỗi 500ms) để đảm bảo phản hồi nhanh
                    var cancelCheckInterval = setInterval(function () {
                        if (requestId && videoJobManager.isCancelled(requestId)) {
                            clearInterval(cancelCheckInterval);
                            clearTimeout(timeoutId); // Also clear timeout when cancelling
                            console.log("[runConcatWithCut] Job ".concat(requestId, " cancelled (interval check), killing FFmpeg process"));
                            if (!ffmpeg.killed) {
                                ffmpeg.kill('SIGTERM');
                                setTimeout(function () {
                                    if (!ffmpeg.killed && ffmpeg.pid) {
                                        try {
                                            ffmpeg.kill('SIGKILL');
                                        }
                                        catch (err) {
                                            // Ignore errors
                                        }
                                    }
                                }, SIGKILL_DELAY_MS);
                            }
                            reject(new Error('Đã dừng bởi người dùng'));
                        }
                    }, CANCEL_CHECK_INTERVAL_MS);
                    (_a = ffmpeg.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (data) {
                        // Check nếu job đã bị cancel - kill process ngay lập tức
                        if (requestId && videoJobManager.isCancelled(requestId)) {
                            clearInterval(cancelCheckInterval);
                            clearTimeout(timeoutId); // Also clear timeout when cancelling
                            console.log("[runConcatWithCut] Job ".concat(requestId, " cancelled, killing FFmpeg process"));
                            if (!ffmpeg.killed) {
                                ffmpeg.kill('SIGTERM');
                                setTimeout(function () {
                                    if (!ffmpeg.killed && ffmpeg.pid) {
                                        try {
                                            ffmpeg.kill('SIGKILL');
                                        }
                                        catch (err) {
                                            // Ignore errors
                                        }
                                    }
                                }, 1000);
                            }
                            reject(new Error('Đã dừng bởi người dùng'));
                            return;
                        }
                        var chunk = data.toString('utf-8');
                        stderr += chunk;
                        // D3: Progress từ time= - parse chính xác hơn
                        if (chunk.includes('time=') && onProgress) {
                            var timeMatch = chunk.match(/time=([0-9:.]+)/);
                            if (timeMatch && timeMatch[1] && targetDurationSec > 0) {
                                var timeStr = timeMatch[1];
                                var parts = timeStr.split(':');
                                if (parts.length === 3) {
                                    var hours = parseFloat(parts[0]) || 0;
                                    var minutes = parseFloat(parts[1]) || 0;
                                    var seconds = parseFloat(parts[2]) || 0;
                                    var currentTimeSec = hours * 3600 + minutes * 60 + seconds;
                                    // Tính percent chính xác
                                    var percent = Math.min(100, Math.max(0, (currentTimeSec / targetDurationSec) * 100));
                                    // Parse speed từ chunk này hoặc từ biến lastSpeedX
                                    var speedMatch_2 = chunk.match(/speed=\s*([0-9.]+)x/i);
                                    if (speedMatch_2 && speedMatch_2[1]) {
                                        var speed = parseFloat(speedMatch_2[1]);
                                        if (!isNaN(speed) && speed > 0) {
                                            lastSpeedX = speed;
                                        }
                                    }
                                    // Emit progress mỗi 0.1 giây (giảm từ 0.2s để cập nhật thường xuyên hơn)
                                    if (currentTimeSec - lastProgressTime >= 0.1) {
                                        lastProgressTime = currentTimeSec;
                                        // Calculate ETA
                                        var etaSec = null;
                                        if (lastSpeedX && lastSpeedX > 0 && targetDurationSec > 0) {
                                            var remainingSec = targetDurationSec - currentTimeSec;
                                            etaSec = remainingSec > 0 ? remainingSec / lastSpeedX : 0;
                                        }
                                        onProgress({
                                            percent: percent,
                                            timeSec: currentTimeSec,
                                            speedX: lastSpeedX,
                                            etaSec: etaSec,
                                        });
                                    }
                                }
                            }
                        }
                        // Parse speed từ chunk riêng (nếu không có time=)
                        var speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i);
                        if (speedMatch && speedMatch[1]) {
                            var speed = parseFloat(speedMatch[1]);
                            if (!isNaN(speed) && speed > 0) {
                                lastSpeedX = speed;
                            }
                        }
                    });
                    ffmpeg.on('error', function (error) {
                        clearTimeout(timeoutId);
                        clearInterval(cancelCheckInterval);
                        reject(new Error("FFmpeg concat+cut error: ".concat(error.message)));
                    });
                    ffmpeg.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                        var stats, retryError_3, retryError_4;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    clearTimeout(timeoutId);
                                    clearInterval(cancelCheckInterval);
                                    // Nếu job đã bị cancel, reject
                                    if (requestId && videoJobManager.isCancelled(requestId)) {
                                        reject(new Error('Đã dừng bởi người dùng'));
                                        return [2 /*return*/];
                                    }
                                    if (!(code === 0 && fs.existsSync(outputPath))) return [3 /*break*/, 7];
                                    stats = fs.statSync(outputPath);
                                    if (!(stats.size === 0)) return [3 /*break*/, 6];
                                    if (!(retryCount < MAX_RETRIES)) return [3 /*break*/, 5];
                                    console.log("[mergeVideosSimple] Retry concat+cut (empty file), attempt ".concat(retryCount + 1, "/").concat(MAX_RETRIES));
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, runConcatWithCut(concatListPath, outputPath, targetDurationSec, mute, onProgress, retryCount + 1, requestId)];
                                case 2:
                                    _a.sent();
                                    resolve();
                                    return [3 /*break*/, 4];
                                case 3:
                                    retryError_3 = _a.sent();
                                    reject(new Error("FFmpeg concat+cut produced empty file after retry: ".concat(retryError_3)));
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                                case 5:
                                    reject(new Error('FFmpeg concat+cut produced empty file'));
                                    return [2 /*return*/];
                                case 6:
                                    // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
                                    if (onProgress && targetDurationSec) {
                                        onProgress({
                                            percent: 100,
                                            timeSec: targetDurationSec,
                                            speedX: lastSpeedX,
                                            etaSec: 0,
                                        });
                                    }
                                    resolve();
                                    return [3 /*break*/, 13];
                                case 7:
                                    if (!(retryCount < MAX_RETRIES)) return [3 /*break*/, 12];
                                    console.log("[mergeVideosSimple] Retry concat+cut (code ".concat(code, "), attempt ").concat(retryCount + 1, "/").concat(MAX_RETRIES));
                                    _a.label = 8;
                                case 8:
                                    _a.trys.push([8, 10, , 11]);
                                    return [4 /*yield*/, runConcatWithCut(concatListPath, outputPath, targetDurationSec, mute, onProgress, retryCount + 1, requestId)];
                                case 9:
                                    _a.sent();
                                    resolve();
                                    return [3 /*break*/, 11];
                                case 10:
                                    retryError_4 = _a.sent();
                                    reject(new Error("FFmpeg concat+cut failed with code ".concat(code, " after retry: ").concat(stderr.slice(0, 500))));
                                    return [3 /*break*/, 11];
                                case 11: return [2 /*return*/];
                                case 12:
                                    reject(new Error("FFmpeg concat+cut failed with code ".concat(code, ": ").concat(stderr.slice(0, 500))));
                                    _a.label = 13;
                                case 13: return [2 /*return*/];
                            }
                        });
                    }); });
                })];
        });
    });
}
/**
 * C3: Run FFmpeg cut (copy-stream) with retry and timeout
 */
function runCut(inputPath_1, outputPath_1, targetDurationSec_1, mute_1, onProgress_1) {
    return __awaiter(this, arguments, void 0, function (inputPath, outputPath, targetDurationSec, mute, onProgress, retryCount, requestId) {
        var ffmpegPath, MAX_RETRIES, TIMEOUT_MS;
        var _this = this;
        if (retryCount === void 0) { retryCount = 0; }
        return __generator(this, function (_a) {
            ffmpegPath = getFfmpegPaths().ffmpeg;
            MAX_RETRIES = 1;
            TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
            ;
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var _a;
                    // C3: Simple args for retry
                    var args = retryCount > 0
                        ? __spreadArray(__spreadArray([
                            '-v', 'error',
                            '-i', inputPath,
                            '-t', String(targetDurationSec),
                            '-c', 'copy'
                        ], (mute ? ['-an'] : []), true), [
                            outputPath,
                            '-y',
                        ], false) : __spreadArray(__spreadArray([
                        '-v', 'error',
                        '-stats',
                        '-i', inputPath,
                        '-t', String(targetDurationSec),
                        '-c', 'copy'
                    ], (mute ? ['-an'] : []), true), [
                        outputPath,
                        '-y',
                    ], false);
                    var ffmpeg = spawn(ffmpegPath, args, {
                        stdio: ['ignore', 'ignore', 'pipe'],
                        windowsHide: true,
                    });
                    // Register process vào videoJobManager để có thể cancel
                    if (requestId) {
                        videoJobManager.registerJob(requestId, ffmpeg);
                    }
                    // C3: Timeout protection
                    var timeoutId = setTimeout(function () {
                        clearInterval(cancelCheckInterval); // Fix Critical #1.2: Clear interval on timeout
                        try {
                            ffmpeg.kill('SIGKILL');
                        }
                        catch (_a) { }
                        reject(new Error("FFmpeg cut timed out after ".concat(TIMEOUT_MS / 1000, "s")));
                    }, TIMEOUT_MS);
                    // Interval check cancellation (mỗi 500ms) để đảm bảo phản hồi nhanh
                    var cancelCheckInterval = setInterval(function () {
                        if (requestId && videoJobManager.isCancelled(requestId)) {
                            clearInterval(cancelCheckInterval);
                            clearTimeout(timeoutId); // Also clear timeout when cancelling
                            console.log("[runCut] Job ".concat(requestId, " cancelled (interval check), killing FFmpeg process"));
                            if (!ffmpeg.killed) {
                                ffmpeg.kill('SIGTERM');
                                setTimeout(function () {
                                    if (!ffmpeg.killed && ffmpeg.pid) {
                                        try {
                                            ffmpeg.kill('SIGKILL');
                                        }
                                        catch (err) {
                                            // Ignore errors
                                        }
                                    }
                                }, SIGKILL_DELAY_MS);
                            }
                            reject(new Error('Đã dừng bởi người dùng'));
                        }
                    }, CANCEL_CHECK_INTERVAL_MS);
                    (_a = ffmpeg.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (data) {
                        // Check nếu job đã bị cancel - kill process ngay lập tức
                        if (requestId && videoJobManager.isCancelled(requestId)) {
                            clearInterval(cancelCheckInterval);
                            clearTimeout(timeoutId); // Also clear timeout when cancelling
                            console.log("[runCut] Job ".concat(requestId, " cancelled, killing FFmpeg process"));
                            if (!ffmpeg.killed) {
                                ffmpeg.kill('SIGTERM');
                                setTimeout(function () {
                                    if (!ffmpeg.killed && ffmpeg.pid) {
                                        try {
                                            ffmpeg.kill('SIGKILL');
                                        }
                                        catch (err) {
                                            // Ignore errors
                                        }
                                    }
                                }, 1000);
                            }
                            reject(new Error('Đã dừng bởi người dùng'));
                            return;
                        }
                        var chunk = data.toString('utf-8');
                        stderr += chunk;
                        // Parse speed từ chunk
                        var speedMatch = chunk.match(/speed=\s*([0-9.]+)x/i);
                        if (speedMatch && speedMatch[1]) {
                            var speed = parseFloat(speedMatch[1]);
                            if (!isNaN(speed) && speed > 0) {
                                lastSpeedX = speed;
                            }
                        }
                        // Simple progress: emit 90% when we see progress
                        if (chunk.includes('time=') && onProgress) {
                            onProgress({
                                percent: 90,
                                timeSec: undefined,
                                speedX: lastSpeedX,
                                etaSec: undefined,
                            });
                        }
                    });
                    ffmpeg.on('error', function (error) {
                        clearTimeout(timeoutId);
                        clearInterval(cancelCheckInterval);
                        reject(new Error("FFmpeg cut error: ".concat(error.message)));
                    });
                    ffmpeg.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                        var stats, retryError_5, retryError_6;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    clearTimeout(timeoutId);
                                    clearInterval(cancelCheckInterval);
                                    // Nếu job đã bị cancel, reject
                                    if (requestId && videoJobManager.isCancelled(requestId)) {
                                        reject(new Error('Đã dừng bởi người dùng'));
                                        return [2 /*return*/];
                                    }
                                    if (!(code === 0 && fs.existsSync(outputPath))) return [3 /*break*/, 7];
                                    stats = fs.statSync(outputPath);
                                    if (!(stats.size === 0)) return [3 /*break*/, 6];
                                    if (!(retryCount < MAX_RETRIES)) return [3 /*break*/, 5];
                                    console.log("[mergeVideosSimple] Retry cut (empty file), attempt ".concat(retryCount + 1, "/").concat(MAX_RETRIES));
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, runCut(inputPath, outputPath, targetDurationSec, mute, onProgress, retryCount + 1, requestId)];
                                case 2:
                                    _a.sent();
                                    resolve();
                                    return [3 /*break*/, 4];
                                case 3:
                                    retryError_5 = _a.sent();
                                    reject(new Error("FFmpeg cut produced empty file after retry: ".concat(retryError_5)));
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                                case 5:
                                    reject(new Error('FFmpeg cut produced empty file'));
                                    return [2 /*return*/];
                                case 6:
                                    // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
                                    if (onProgress && targetDurationSec) {
                                        onProgress({
                                            percent: 100,
                                            timeSec: targetDurationSec,
                                            speedX: lastSpeedX,
                                            etaSec: 0,
                                        });
                                    }
                                    resolve();
                                    return [3 /*break*/, 13];
                                case 7:
                                    if (!(retryCount < MAX_RETRIES)) return [3 /*break*/, 12];
                                    console.log("[mergeVideosSimple] Retry cut (code ".concat(code, "), attempt ").concat(retryCount + 1, "/").concat(MAX_RETRIES));
                                    _a.label = 8;
                                case 8:
                                    _a.trys.push([8, 10, , 11]);
                                    return [4 /*yield*/, runCut(inputPath, outputPath, targetDurationSec, mute, onProgress, retryCount + 1, requestId)];
                                case 9:
                                    _a.sent();
                                    resolve();
                                    return [3 /*break*/, 11];
                                case 10:
                                    retryError_6 = _a.sent();
                                    reject(new Error("FFmpeg cut failed with code ".concat(code, " after retry: ").concat(stderr.slice(0, 500))));
                                    return [3 /*break*/, 11];
                                case 11: return [2 /*return*/];
                                case 12:
                                    reject(new Error("FFmpeg cut failed with code ".concat(code, ": ").concat(stderr.slice(0, 500))));
                                    _a.label = 13;
                                case 13: return [2 /*return*/];
                            }
                        });
                    }); });
                })];
        });
    });
}
/**
 * Fallback: transcode tất cả inputs về định dạng an toàn (H.264/AAC) rồi concat copy
 */
function fallbackTranscodeAndConcat(inputs, outputPath, mute, targetDurationSec, onProgress, requestId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, getDiskSpace, checkMinimumSpace, formatBytes, tmpDirPath, diskInfo, estimatedBytes, spaceCheck, diskErr_1, tmpDir, ffmpeg, safeOutputs, cleanupOnCancel, _loop_1, i, concatListPath, err_2;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, import('../utils/diskSpace')];
                case 1:
                    _a = _b.sent(), getDiskSpace = _a.getDiskSpace, checkMinimumSpace = _a.checkMinimumSpace, formatBytes = _a.formatBytes;
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    tmpDirPath = os.tmpdir();
                    return [4 /*yield*/, getDiskSpace(tmpDirPath)
                        // Estimate: assume each input file needs ~200MB temp space
                    ];
                case 3:
                    diskInfo = _b.sent();
                    estimatedBytes = inputs.length * 200 * 1024 * 1024;
                    spaceCheck = checkMinimumSpace(diskInfo.free, Math.ceil(estimatedBytes / (1024 * 1024 * 1024)));
                    if (!spaceCheck.enough) {
                        throw new Error("Kh\u00F4ng \u0111\u1EE7 dung l\u01B0\u1EE3ng \u1ED5 \u0111\u0129a \u0111\u1EC3 t\u1EA1o temp files. C\u1EA7n: ".concat(formatBytes(estimatedBytes), ", C\u00F2n: ").concat(formatBytes(diskInfo.free)));
                    }
                    return [3 /*break*/, 5];
                case 4:
                    diskErr_1 = _b.sent();
                    console.warn('[mergeVideosSimple] Disk space check failed, continuing anyway:', diskErr_1);
                    return [3 /*break*/, 5];
                case 5: return [4 /*yield*/, fs.promises.mkdtemp(path.join(os.tmpdir(), 'merge-safe-'))];
                case 6:
                    tmpDir = _b.sent();
                    ffmpeg = getFfmpegPaths().ffmpeg;
                    safeOutputs = [];
                    cleanupOnCancel = false;
                    _b.label = 7;
                case 7:
                    _b.trys.push([7, , 16, 20]);
                    _loop_1 = function (i) {
                        var input, safeOut;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    // Check cancel trước khi bắt đầu transcode file tiếp theo
                                    if (requestId && videoJobManager.isCancelled(requestId)) {
                                        cleanupOnCancel = true;
                                        throw new Error('Đã dừng bởi người dùng');
                                    }
                                    input = inputs[i];
                                    safeOut = path.join(tmpDir, "safe_".concat(i + 1, ".mp4"));
                                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                                            var _a;
                                            var args = __spreadArray(__spreadArray([
                                                '-hide_banner',
                                                '-y',
                                                '-i', input,
                                                '-vf', 'scale=iw:ih,setsar=1,fps=30',
                                                '-c:v', 'libx264',
                                                '-preset', 'veryfast',
                                                '-crf', '20',
                                                '-pix_fmt', 'yuv420p',
                                                '-c:a', 'aac',
                                                '-b:a', '160k',
                                                '-ac', '2'
                                            ], (mute ? ['-an'] : []), true), [
                                                safeOut,
                                            ], false);
                                            var proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
                                            // Register process vào videoJobManager để có thể cancel
                                            if (requestId) {
                                                var childRequestId = "".concat(requestId, "-transcode-").concat(i);
                                                videoJobManager.registerJob(childRequestId, proc);
                                            }
                                            // Check cancel trong stderr handler
                                            (_a = proc.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (data) {
                                                if (requestId && videoJobManager.isCancelled(requestId)) {
                                                    cleanupOnCancel = true; // Fix Critical #1.1: Mark for cleanup on cancel
                                                    console.log("[fallbackTranscodeAndConcat] Job ".concat(requestId, " cancelled, killing transcode process ").concat(i));
                                                    if (!proc.killed) {
                                                        proc.kill('SIGTERM');
                                                        setTimeout(function () {
                                                            if (!proc.killed) {
                                                                proc.kill('SIGKILL');
                                                            }
                                                        }, 1000);
                                                    }
                                                    reject(new Error('Đã dừng bởi người dùng'));
                                                }
                                            });
                                            proc.on('error', function (err) { return reject(err); });
                                            proc.on('close', function (code) {
                                                // Check cancel trước khi resolve/reject
                                                if (requestId && videoJobManager.isCancelled(requestId)) {
                                                    cleanupOnCancel = true; // Fix Critical #1.1: Mark for cleanup on cancel
                                                    reject(new Error('Đã dừng bởi người dùng'));
                                                    return;
                                                }
                                                if (code === 0 && fs.existsSync(safeOut))
                                                    resolve();
                                                else
                                                    reject(new Error("Transcode failed for ".concat(input, " (code ").concat(code, ")")));
                                            });
                                        })];
                                case 1:
                                    _c.sent();
                                    safeOutputs.push(safeOut);
                                    if (onProgress) {
                                        onProgress({ percent: Math.min(99, ((i + 1) / inputs.length) * 40) }); // rough progress
                                    }
                                    return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _b.label = 8;
                case 8:
                    if (!(i < inputs.length)) return [3 /*break*/, 11];
                    return [5 /*yield**/, _loop_1(i)];
                case 9:
                    _b.sent();
                    _b.label = 10;
                case 10:
                    i++;
                    return [3 /*break*/, 8];
                case 11:
                    concatListPath = path.join(tmpDir, "concat_safe_".concat(Date.now(), ".txt"));
                    fs.writeFileSync(concatListPath, buildConcatListContent(safeOutputs), { encoding: 'utf8' });
                    if (!(targetDurationSec && targetDurationSec > 0)) return [3 /*break*/, 13];
                    return [4 /*yield*/, runConcatWithCut(concatListPath, outputPath, targetDurationSec, mute, undefined, 0, requestId)];
                case 12:
                    _b.sent();
                    return [3 /*break*/, 15];
                case 13: return [4 /*yield*/, runConcat(concatListPath, outputPath, mute, undefined, undefined, 0, requestId)];
                case 14:
                    _b.sent();
                    _b.label = 15;
                case 15: return [3 /*break*/, 20];
                case 16:
                    _b.trys.push([16, 18, , 19]);
                    return [4 /*yield*/, fs.promises.rm(tmpDir, { recursive: true, force: true })];
                case 17:
                    _b.sent();
                    return [3 /*break*/, 19];
                case 18:
                    err_2 = _b.sent();
                    console.warn('[mergeVideosSimple] Failed to cleanup temp dir:', err_2);
                    return [3 /*break*/, 19];
                case 19: return [7 /*endfinally*/];
                case 20: return [2 /*return*/];
            }
        });
    });
}
/**
 * Generate output file name
 */
function generateOutputFileName(baseFileName, index, total) {
    var ext = path.extname(baseFileName) || '.mp4';
    var nameWithoutExt = path.basename(baseFileName, ext);
    if (total > 1) {
        return "".concat(nameWithoutExt, "_").concat(index).concat(ext);
    }
    else {
        return baseFileName;
    }
}
/**
 * Main merge function - Rebuilt for maximum speed
 */
export function mergeVideosSimple(req, onProgress) {
    return __awaiter(this, void 0, void 0, function () {
        var requestId, startTime, sentWarningMessage, mergeCount_1, forceSafeMode, diskInfo, spaceCheck, additionalInfo, errorMsg, diskErr_2, _a, valid, invalid, distinctValidPaths, inputInfoMap, sizeLookup, filesWithDuration_1, totalInputDuration, baseClips_1, priorityPathSet_1, priorityClips, nonPriorityClips, distinctClips, hasTarget, targetDurationSec_1, permutations, generatedPermutations_1, permutationSignatures_1, outputPaths, totalElapsedMs, _loop_2, mergeIndex, elapsedMs, avgSpeed, error_1;
        var _this = this;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    requestId = req.requestId || randomUUID();
                    startTime = Date.now();
                    sentWarningMessage = false;
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 11, , 12]);
                    if (!req.inputFiles || req.inputFiles.length === 0) {
                        throw new Error('Không có inputFiles để ghép');
                    }
                    mergeCount_1 = req.mergeCount && req.mergeCount > 1 ? req.mergeCount : 1;
                    forceSafeMode = !!req.forceReencode;
                    console.log("[mergeVideosSimple] forceSafeMode=".concat(forceSafeMode ? 'ON' : 'OFF', " (forceReencode=").concat(req.forceReencode, ")"));
                    // Create output directory
                    if (!fs.existsSync(req.outputDir)) {
                        fs.mkdirSync(req.outputDir, { recursive: true });
                    }
                    _c.label = 2;
                case 2:
                    _c.trys.push([2, 4, , 5]);
                    console.log('[mergeVideosSimple] Checking disk space...');
                    return [4 /*yield*/, getDiskSpace(req.outputDir)];
                case 3:
                    diskInfo = _c.sent();
                    console.log("[mergeVideosSimple] Disk ".concat(diskInfo.drive, ": ").concat(formatBytes(diskInfo.free), " free (").concat((diskInfo.free /
                        (1024 * 1024 * 1024)).toFixed(2), " GB)"));
                    spaceCheck = checkMinimumSpace(diskInfo.free, 4);
                    if (!spaceCheck.enough) {
                        additionalInfo = [
                            "S\u1ED1 videos s\u1EBD t\u1EA1o: ".concat(mergeCount_1),
                            req.targetDurationSec && req.targetDurationSec > 0
                                ? "Th\u1EDDi l\u01B0\u1EE3ng m\u1ED7i video (target): ".concat(req.targetDurationSec, "s")
                                : "S\u1ED1 clips input: ".concat(req.inputFiles.length),
                        ].join('\n');
                        errorMsg = createDiskSpaceErrorMessage(diskInfo, spaceCheck, {
                            tabName: 'Tab 5 - Cắt/Ghép video',
                            operation: req.targetDurationSec && req.targetDurationSec > 0
                                ? 'Merge với giới hạn duration'
                                : 'Merge không giới hạn',
                            additionalInfo: additionalInfo,
                        });
                        console.error('[mergeVideosSimple] Disk space not enough\n', errorMsg);
                        throw new Error(errorMsg);
                    }
                    console.log('[mergeVideosSimple] ✓ Disk space OK');
                    return [3 /*break*/, 5];
                case 4:
                    diskErr_2 = _c.sent();
                    console.error('[mergeVideosSimple] Disk space check error:', diskErr_2);
                    throw new Error((diskErr_2 === null || diskErr_2 === void 0 ? void 0 : diskErr_2.message) || 'Không kiểm tra được dung lượng ổ đĩa.');
                case 5:
                    // B5: Progress nhẹ - stage: probe
                    if (onProgress) {
                        onProgress(buildMergeProgress({
                            mode: 'merge',
                            requestId: requestId,
                            stage: 'probe',
                            percent: 0,
                        }));
                    }
                    // DEBUG: Log input files trước khi validate
                    console.log("[mergeVideosSimple][DEBUG] Input files count: ".concat(req.inputFiles.length));
                    if (req.inputFiles.length > 0) {
                        console.log("[mergeVideosSimple][DEBUG] First 5 input files:", req.inputFiles.slice(0, 5));
                        console.log("[mergeVideosSimple][DEBUG] Last 5 input files:", req.inputFiles.slice(-5));
                    }
                    return [4 /*yield*/, validateInputFiles(req.inputFiles, 10)
                        // DEBUG: Log sau khi validate
                    ];
                case 6:
                    _a = _c.sent(), valid = _a.valid, invalid = _a.invalid;
                    // DEBUG: Log sau khi validate
                    console.log("[mergeVideosSimple][DEBUG] After validate: valid=".concat(valid.length, ", invalid=").concat(invalid.length));
                    distinctValidPaths = new Set(valid.map(function (v) { return v.path; }));
                    if (distinctValidPaths.size !== valid.length) {
                        console.error("[mergeVideosSimple][ERROR] Duplicate paths in valid array! distinct=".concat(distinctValidPaths.size, ", total=").concat(valid.length));
                    }
                    if (valid.length === 0) {
                        throw new Error('Không có video hợp lệ để ghép (tất cả file đều lỗi hoặc hỏng)');
                    }
                    // B5: Progress nhẹ - message nếu có invalid files
                    if (invalid.length > 0 && onProgress && !sentWarningMessage) {
                        onProgress(buildMergeProgress({
                            mode: 'merge',
                            requestId: requestId,
                            stage: 'probe',
                            percent: 2,
                            message: "\u0110\u00E3 b\u1ECF qua ".concat(invalid.length, " video l\u1ED7i / h\u1ECFng tr\u01B0\u1EDBc khi gh\u00E9p"),
                        }));
                        sentWarningMessage = true;
                    }
                    inputInfoMap = new Map(valid.map(function (v) { return [v.path, v.durationSec]; }));
                    sizeLookup = new Map(valid.map(function (v) { return [v.path, typeof v.sizeBytes === 'number' ? v.sizeBytes : null]; }));
                    filesWithDuration_1 = valid.map(function (v) { return ({
                        path: v.path,
                        duration: v.durationSec,
                        sizeBytes: typeof v.sizeBytes === 'number' ? v.sizeBytes : null,
                    }); });
                    totalInputDuration = filesWithDuration_1.reduce(function (sum, f) { return sum + f.duration; }, 0);
                    console.log("[mergeVideosSimple] Valid files: ".concat(valid.length, ", total duration: ").concat(totalInputDuration.toFixed(2), "s"));
                    console.log("[mergeVideosSimple] Merge count: ".concat(mergeCount_1));
                    baseClips_1 = filesWithDuration_1
                        .map(function (f) {
                        var _a, _b;
                        return ({
                            path: f.path,
                            durationSec: (_a = f.duration) !== null && _a !== void 0 ? _a : 0,
                            id: f.path,
                            sizeBytes: (_b = f.sizeBytes) !== null && _b !== void 0 ? _b : undefined,
                        });
                    })
                        .filter(function (c) { return c.durationSec > 0; });
                    priorityPathSet_1 = Array.isArray(req.priorityPaths) && req.priorityPaths.length > 0
                        ? new Set(req.priorityPaths)
                        : null;
                    priorityClips = priorityPathSet_1
                        ? baseClips_1.filter(function (c) { return priorityPathSet_1.has(c.path); })
                        : [];
                    nonPriorityClips = priorityPathSet_1 && priorityClips.length > 0
                        ? baseClips_1.filter(function (c) { return !priorityPathSet_1.has(c.path); })
                        : baseClips_1;
                    // DEBUG: Log baseClips
                    console.log("[mergeVideosSimple][DEBUG] baseClips.length = ".concat(baseClips_1.length));
                    if (baseClips_1.length > 0) {
                        console.log("[mergeVideosSimple][DEBUG] First 5 clips:", baseClips_1.slice(0, 5).map(function (c) { return path.basename(c.path); }));
                        console.log("[mergeVideosSimple][DEBUG] Last 5 clips:", baseClips_1.slice(-5).map(function (c) { return path.basename(c.path); }));
                    }
                    distinctClips = new Set(baseClips_1.map(function (c) { return c.path; }));
                    console.log("[mergeVideosSimple][DEBUG] Distinct clips: ".concat(distinctClips.size));
                    if (distinctClips.size !== baseClips_1.length) {
                        console.error("[mergeVideosSimple][ERROR] Duplicate clips detected! distinct=".concat(distinctClips.size, ", total=").concat(baseClips_1.length));
                    }
                    hasTarget = typeof req.targetDurationSec === 'number' && req.targetDurationSec > 0;
                    targetDurationSec_1 = hasTarget ? Number(req.targetDurationSec) : null;
                    permutations = null;
                    if (!hasTarget) {
                        if (req.shuffle) {
                            permutations = buildRandomPermutations(baseClips_1, mergeCount_1);
                            generatedPermutations_1 = permutations;
                            console.log("[merge][no-target] Created ".concat(generatedPermutations_1.length, " permutations, each with ").concat(baseClips_1.length, " clips"));
                            permutationSignatures_1 = new Set();
                            generatedPermutations_1.forEach(function (perm, idx) {
                                var signature = perm.map(function (c) { return c.path; }).join('|');
                                if (permutationSignatures_1.has(signature)) {
                                    throw new Error("[merge][no-target] Duplicate permutation detected t\u1EA1i v\u1ECB tr\u00ED ".concat(idx + 1, "."));
                                }
                                permutationSignatures_1.add(signature);
                                var preview = perm.slice(0, 5).map(function (c) { return path.basename(c.path); });
                                console.log("  Permutation ".concat(idx + 1, "/").concat(generatedPermutations_1.length, " first 5 clips: ").concat(preview.join(', ')));
                            });
                            console.log('[merge][no-target] ✓ All permutations are unique');
                        }
                        else {
                            // Không shuffle: tất cả permutations giống nhau (giữ nguyên thứ tự)
                            permutations = Array(mergeCount_1).fill(null).map(function () { return __spreadArray([], baseClips_1, true); });
                        }
                        if (!permutations) {
                            throw new Error('[merge][no-target] Không tạo được permutations.');
                        }
                    }
                    outputPaths = [];
                    totalElapsedMs = 0;
                    _loop_2 = function (mergeIndex) {
                        var currentMergeIndex, mergeStartTime, outputFileName, basePercent, filesForMerge, permutationsForUse, playlist, playlistPreview, originalFirst5, isSameOrder, errorMsg, validPaths_1, invalidPaths, shouldShuffle, randomPart, playlistSeed, priorityForThisMerge, priorityDuration, remainingTarget, playlist, loopSource, loopPlaylist, first5, originalFirst5, usedClipSet, usedClipCount, totalConcatItems, finalDurationSec, validPaths_2, invalidPaths, distinctCount, totalInputDurationSec, estimatedBytes, basePercent, concatListPath, concatContent, concatLines, finalOutputPath, runSafeMerge, basePercent, err_3, errorMsg, endPercent, totalDurationForMerge_1, basePercent, err_4, errorMsg, endPercent, stats, finalInfo, finalDurationSec, diff, error_2, shouldRunDeepVerify, verify, verifyErr_1, mergeElapsedMs, overallPercent;
                        return __generator(this, function (_d) {
                            switch (_d.label) {
                                case 0:
                                    // Check cancellation TRƯỚC khi bắt đầu merge tiếp theo
                                    if (videoJobManager.isCancelled(requestId)) {
                                        console.log("[mergeVideosSimple] Job ".concat(requestId, " cancelled before merge ").concat(mergeIndex + 1, "/").concat(mergeCount_1));
                                        throw new Error('Đã dừng bởi người dùng');
                                    }
                                    currentMergeIndex = mergeIndex + 1;
                                    mergeStartTime = Date.now();
                                    outputFileName = mergeCount_1 === 1
                                        ? "".concat(req.outputFileName, ".mp4")
                                        : "".concat(req.outputFileName, "_").concat(currentMergeIndex, ".mp4");
                                    console.log("[mergeVideosSimple] ===== Merge ".concat(currentMergeIndex, "/").concat(mergeCount_1, " ====="));
                                    console.log("[merge] Starting job ".concat(currentMergeIndex, "/").concat(mergeCount_1, ": ").concat(outputFileName));
                                    // Emit START progress cho job này
                                    if (onProgress) {
                                        basePercent = mergeCount_1 > 1 ? (mergeIndex / mergeCount_1) * 100 : 0;
                                        onProgress(buildMergeProgress({
                                            mode: 'merge',
                                            requestId: requestId,
                                            stage: 'build-list',
                                            percent: basePercent,
                                            currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                            totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                            currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                            message: mergeCount_1 > 1 ? "\u0110ang gh\u00E9p video ".concat(currentMergeIndex, "/").concat(mergeCount_1, "...") : undefined,
                                        }));
                                    }
                                    filesForMerge = [];
                                    if (!hasTarget) {
                                        permutationsForUse = permutations;
                                        if (!permutationsForUse || !permutationsForUse[mergeIndex]) {
                                            throw new Error("No permutation found for merge ".concat(mergeIndex));
                                        }
                                        playlist = permutationsForUse[mergeIndex];
                                        filesForMerge = playlist.map(function (c) { return c.path; });
                                        playlistPreview = playlist.slice(0, 5).map(function (c) { return path.basename(c.path); });
                                        console.log("[merge][no-target] Job ".concat(currentMergeIndex, " first 5 clips: ").concat(playlistPreview.join(', ')));
                                        // Debug: Log để verify shuffle
                                        if (req.shuffle) {
                                            originalFirst5 = baseClips_1.slice(0, 5).map(function (c) { return path.basename(c.path); });
                                            console.log("[merge][no-target][shuffle] Original first 5: ".concat(originalFirst5.join(', ')));
                                            console.log("[merge][no-target][shuffle] Shuffled first 5: ".concat(playlistPreview.join(', ')));
                                            isSameOrder = playlist.every(function (clip, idx) { var _a; return clip.path === ((_a = baseClips_1[idx]) === null || _a === void 0 ? void 0 : _a.path); });
                                            if (isSameOrder) {
                                                console.warn("[merge][no-target][shuffle] WARNING: Playlist order is identical to original! Shuffle may not be working.");
                                            }
                                        }
                                        // Verify: playlist.length PHẢI === baseClips.length
                                        if (playlist.length !== baseClips_1.length) {
                                            errorMsg = "Video ".concat(currentMergeIndex, ": ").concat(playlist.length, " clips (expected ").concat(baseClips_1.length, ") - Playlist length mismatch!");
                                            console.error("[merge][no-target] ERROR: ".concat(errorMsg));
                                            throw new Error(errorMsg);
                                        }
                                        validPaths_1 = new Set(baseClips_1.map(function (c) { return c.path; }));
                                        invalidPaths = filesForMerge.filter(function (p) { return !validPaths_1.has(p); });
                                        if (invalidPaths.length > 0) {
                                            throw new Error("Merge no-target: c\u00F3 ".concat(invalidPaths.length, " clip kh\u00F4ng h\u1EE3p l\u1EC7 trong filesForMerge"));
                                        }
                                        // Log theo spec
                                        console.log("Video ".concat(currentMergeIndex, ": ").concat(playlist.length, " clips (expected ").concat(baseClips_1.length, ")"));
                                    }
                                    else {
                                        shouldShuffle = req.shuffle === true;
                                        console.log("[merge][has-target] shuffle=".concat(shouldShuffle, ", targetDurationSec=").concat(targetDurationSec_1.toFixed(2), "s"));
                                        randomPart = randomBytes(4).readUInt32BE(0);
                                        playlistSeed = Date.now() + mergeIndex * 1000000 + randomPart + mergeIndex * 12345;
                                        priorityForThisMerge = priorityClips.length > 1 && shouldShuffle
                                            ? shuffleOnce(priorityClips)
                                            : __spreadArray([], priorityClips, true);
                                        priorityDuration = priorityForThisMerge.reduce(function (sum, c) { return sum + c.durationSec; }, 0);
                                        remainingTarget = Math.max(0, targetDurationSec_1 - priorityDuration);
                                        playlist = void 0;
                                        if (remainingTarget <= 0) {
                                            // Chỉ cần priority clips là đủ thời lượng
                                            playlist = __spreadArray([], priorityForThisMerge, true);
                                        }
                                        else {
                                            loopSource = nonPriorityClips.length > 0 ? nonPriorityClips : baseClips_1;
                                            loopPlaylist = buildPlaylistToFillDuration(loopSource, remainingTarget, shouldShuffle, playlistSeed);
                                            playlist = __spreadArray(__spreadArray([], priorityForThisMerge, true), loopPlaylist, true);
                                        }
                                        filesForMerge = playlist.map(function (c) { return c.path; });
                                        // Debug: Log seed để verify
                                        if (shouldShuffle) {
                                            console.log("[merge][has-target][shuffle] Merge ".concat(currentMergeIndex, " seed: ").concat(playlistSeed));
                                        }
                                        // Debug: Log thứ tự files để verify shuffle
                                        if (shouldShuffle) {
                                            first5 = filesForMerge.slice(0, 5).map(function (p) { return path.basename(p); });
                                            originalFirst5 = baseClips_1.slice(0, 5).map(function (c) { return path.basename(c.path); });
                                            console.log("[merge][has-target][shuffle] Original first 5: ".concat(originalFirst5.join(', ')));
                                            console.log("[merge][has-target][shuffle] Shuffled first 5: ".concat(first5.join(', ')));
                                        }
                                        usedClipSet = new Set(filesForMerge);
                                        usedClipCount = usedClipSet.size;
                                        totalConcatItems = filesForMerge.length;
                                        finalDurationSec = playlist.reduce(function (sum, c) { return sum + c.durationSec; }, 0);
                                        console.log("Playlist: ".concat(totalConcatItems, " clips (t\u1EEB ").concat(baseClips_1.length, " clips g\u1ED1c)"));
                                        console.log("[merge][has-target] Merge ".concat(currentMergeIndex, ": target=").concat(targetDurationSec_1.toFixed(2), "s, playlist=").concat(totalConcatItems, " items, final=").concat(finalDurationSec.toFixed(2), "s, unique=").concat(usedClipCount));
                                        validPaths_2 = new Set(baseClips_1.map(function (c) { return c.path; }));
                                        invalidPaths = filesForMerge.filter(function (p) { return !validPaths_2.has(p); });
                                        if (invalidPaths.length > 0) {
                                            throw new Error("Merge has-target: c\u00F3 ".concat(invalidPaths.length, " clip kh\u00F4ng h\u1EE3p l\u1EC7 trong filesForMerge"));
                                        }
                                    }
                                    distinctCount = new Set(filesForMerge).size;
                                    totalInputDurationSec = filesWithDuration_1.reduce(function (sum, f) { return sum + f.duration; }, 0);
                                    console.log("[mergeVideosSimple] Original files: ".concat(filesWithDuration_1.length));
                                    console.log("[mergeVideosSimple] Files after processing: ".concat(filesForMerge.length));
                                    console.log("[mergeVideosSimple] Distinct files in merge: ".concat(distinctCount));
                                    console.log("[mergeVideosSimple] Total input duration: ".concat(totalInputDurationSec.toFixed(2), "s"));
                                    if (hasTarget && targetDurationSec_1) {
                                        console.log("[mergeVideosSimple] Target duration: ".concat(targetDurationSec_1.toFixed(2), "s"));
                                    }
                                    else {
                                        console.log("[mergeVideosSimple] No target duration - using ALL ".concat(filesForMerge.length, " files"));
                                    }
                                    console.log("[mergeVideosSimple] First 10 files: ".concat(filesForMerge.slice(0, 10).map(function (f) { return path.basename(f); }).join(', ')));
                                    // C4: Debug logging
                                    debugLog("Merge ".concat(currentMergeIndex, " concat list"), {
                                        totalFiles: filesForMerge.length,
                                        distinctCount: distinctCount,
                                        first10: filesForMerge.slice(0, 10).map(function (f) { return path.basename(f); }),
                                        hasTarget: hasTarget,
                                    });
                                    if (filesForMerge.length === 0) {
                                        throw new Error('No files to merge');
                                    }
                                    estimatedBytes = estimateConcatBytes(filesForMerge, sizeLookup);
                                    return [4 /*yield*/, ensureMergeDiskCapacity(req.outputDir, estimatedBytes, currentMergeIndex, mergeCount_1)
                                        // D3: Progress nhẹ - stage: merge (START)
                                    ];
                                case 1:
                                    _d.sent();
                                    // D3: Progress nhẹ - stage: merge (START)
                                    if (onProgress) {
                                        basePercent = mergeCount_1 > 1 ? (mergeIndex / mergeCount_1) * 100 : 0;
                                        onProgress(buildMergeProgress({
                                            mode: 'merge',
                                            requestId: requestId,
                                            stage: 'merge',
                                            percent: basePercent,
                                            currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                            totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                            currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                            message: mergeCount_1 > 1 ? "\u0110ang gh\u00E9p video ".concat(currentMergeIndex, "/").concat(mergeCount_1, "...") : undefined,
                                        }));
                                    }
                                    concatListPath = path.join(req.outputDir, "concat_".concat(currentMergeIndex, "_").concat(Date.now(), ".txt"));
                                    concatContent = buildConcatListContent(filesForMerge);
                                    fs.writeFileSync(concatListPath, concatContent, { encoding: 'utf8' });
                                    concatLines = concatContent.split('\n').filter(function (line) { return line.trim().length > 0; });
                                    console.log("[mergeVideosSimple] Concat list: ".concat(concatLines.length, " files (filesForMerge: ").concat(filesForMerge.length, ")"));
                                    if (concatLines.length !== filesForMerge.length) {
                                        console.error("[mergeVideosSimple] ERROR: Concat list line count mismatch! Expected: ".concat(filesForMerge.length, ", Got: ").concat(concatLines.length));
                                    }
                                    finalOutputPath = path.join(req.outputDir, generateOutputFileName(req.outputFileName, currentMergeIndex, mergeCount_1));
                                    runSafeMerge = function (message, safeTarget) { return __awaiter(_this, void 0, void 0, function () {
                                        return __generator(this, function (_a) {
                                            switch (_a.label) {
                                                case 0: return [4 /*yield*/, fallbackTranscodeAndConcat(filesForMerge, finalOutputPath, req.mute || false, safeTarget !== null && safeTarget !== void 0 ? safeTarget : null, function (progress) {
                                                        if (onProgress) {
                                                            var overallPercent = mergeCount_1 > 1
                                                                ? (mergeIndex / mergeCount_1) * 100 + (progress.percent / mergeCount_1)
                                                                : progress.percent;
                                                            onProgress(buildMergeProgress({
                                                                mode: 'merge',
                                                                requestId: requestId,
                                                                stage: 'merge',
                                                                percent: Math.min(99, overallPercent),
                                                                currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                                                totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                                                currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                                                message: message,
                                                            }));
                                                        }
                                                    }, requestId)];
                                                case 1:
                                                    _a.sent();
                                                    return [2 /*return*/];
                                            }
                                        });
                                    }); };
                                    if (!(hasTarget && targetDurationSec_1)) return [3 /*break*/, 7];
                                    // NHÁNH CÓ TARGET: Giữ nguyên logic hiện tại (KHÔNG ĐỤNG)
                                    // D3: 1 pass concat + cut
                                    // Emit progress START ngay trước khi gọi FFmpeg
                                    if (onProgress) {
                                        basePercent = mergeCount_1 > 1 ? (mergeIndex / mergeCount_1) * 100 : 0;
                                        onProgress(buildMergeProgress({
                                            mode: 'merge',
                                            requestId: requestId,
                                            stage: 'merge',
                                            percent: basePercent,
                                            timeSec: 0,
                                            totalDurationSec: targetDurationSec_1,
                                            speedX: null,
                                            etaSec: null,
                                            currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                            totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                            currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                            message: mergeCount_1 > 1 ? "\u0110ang gh\u00E9p video ".concat(currentMergeIndex, "/").concat(mergeCount_1, "...") : undefined,
                                        }));
                                    }
                                    console.log("[merge][has-target] Starting job ".concat(currentMergeIndex, "/").concat(mergeCount_1, ": ").concat(outputFileName));
                                    console.log("[merge][has-target] Target duration: ".concat(targetDurationSec_1.toFixed(2), "s"));
                                    if (!forceSafeMode) return [3 /*break*/, 3];
                                    return [4 /*yield*/, runSafeMerge('Đang ghép ổn định (re-encode)...', targetDurationSec_1)];
                                case 2:
                                    _d.sent();
                                    return [3 /*break*/, 6];
                                case 3:
                                    _d.trys.push([3, 5, , 6]);
                                    return [4 /*yield*/, runConcatWithCut(concatListPath, finalOutputPath, targetDurationSec_1, req.mute || false, function (progress) {
                                            if (onProgress) {
                                                // Calculate overall percent: (jobIndex / totalJobs) * 100 + (currentJobPercent / totalJobs)
                                                var overallPercent = 0;
                                                if (mergeCount_1 > 1) {
                                                    var jobBasePercent = (mergeIndex / mergeCount_1) * 100;
                                                    var jobProgressPercent = (progress.percent || 0) / mergeCount_1;
                                                    overallPercent = jobBasePercent + jobProgressPercent;
                                                }
                                                else {
                                                    overallPercent = progress.percent || 0;
                                                }
                                                onProgress(buildMergeProgress({
                                                    mode: 'merge',
                                                    requestId: requestId,
                                                    stage: 'merge',
                                                    percent: Math.min(100, overallPercent),
                                                    timeSec: progress.timeSec,
                                                    totalDurationSec: targetDurationSec_1,
                                                    speedX: progress.speedX,
                                                    etaSec: progress.etaSec,
                                                    currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                                    totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                                    currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                                    message: mergeCount_1 > 1 ? "\u0110ang gh\u00E9p video ".concat(currentMergeIndex, "/").concat(mergeCount_1, "...") : undefined,
                                                }));
                                            }
                                        }, undefined, // retryCount
                                        requestId)];
                                case 4:
                                    _d.sent();
                                    return [3 /*break*/, 6];
                                case 5:
                                    err_3 = _d.sent();
                                    errorMsg = (err_3 === null || err_3 === void 0 ? void 0 : err_3.message) || String(err_3);
                                    console.error('[mergeVideosSimple] concat+cut failed:', errorMsg);
                                    throw new Error("Gh\u00E9p video th\u1EA5t b\u1EA1i: ".concat(errorMsg, ". N\u1EBFu g\u1EB7p l\u1ED7i codec/FPS kh\u00F4ng t\u01B0\u01A1ng th\u00EDch, h\u00E3y b\u1EADt \"Chu\u1EA9n h\u00F3a video khi gh\u00E9p\"."));
                                case 6:
                                    // Emit progress END sau khi hoàn thành job
                                    if (onProgress) {
                                        endPercent = mergeCount_1 > 1 ? ((mergeIndex + 1) / mergeCount_1) * 100 : 100;
                                        onProgress(buildMergeProgress({
                                            mode: 'merge',
                                            requestId: requestId,
                                            stage: 'merge',
                                            percent: Math.min(100, endPercent),
                                            timeSec: targetDurationSec_1,
                                            totalDurationSec: targetDurationSec_1,
                                            speedX: null,
                                            etaSec: null,
                                            currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                            totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                            currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                            message: mergeCount_1 > 1 ? "Ho\u00E0n th\u00E0nh video ".concat(currentMergeIndex, "/").concat(mergeCount_1) : undefined,
                                        }));
                                    }
                                    console.log("[merge][has-target] Completed job ".concat(currentMergeIndex, "/").concat(mergeCount_1, ": ").concat(outputFileName));
                                    return [3 /*break*/, 13];
                                case 7:
                                    totalDurationForMerge_1 = filesForMerge.reduce(function (sum, filePath) {
                                        var info = filesWithDuration_1.find(function (f) { return f.path === filePath; });
                                        return sum + ((info === null || info === void 0 ? void 0 : info.duration) || 0);
                                    }, 0);
                                    // Emit progress START ngay trước khi gọi FFmpeg
                                    if (onProgress) {
                                        basePercent = mergeCount_1 > 1 ? (mergeIndex / mergeCount_1) * 100 : 0;
                                        onProgress(buildMergeProgress({
                                            mode: 'merge',
                                            requestId: requestId,
                                            stage: 'merge',
                                            percent: basePercent,
                                            timeSec: 0,
                                            totalDurationSec: totalDurationForMerge_1,
                                            speedX: null,
                                            etaSec: null,
                                            currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                            totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                            currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                            message: mergeCount_1 > 1 ? "\u0110ang gh\u00E9p video ".concat(currentMergeIndex, "/").concat(mergeCount_1, "...") : undefined,
                                        }));
                                    }
                                    console.log("[merge][no-target] Starting job ".concat(currentMergeIndex, "/").concat(mergeCount_1, ": ").concat(outputFileName));
                                    if (!forceSafeMode) return [3 /*break*/, 9];
                                    return [4 /*yield*/, runSafeMerge('Đang ghép ổn định (re-encode)...', null)];
                                case 8:
                                    _d.sent();
                                    return [3 /*break*/, 12];
                                case 9:
                                    _d.trys.push([9, 11, , 12]);
                                    return [4 /*yield*/, runConcat(concatListPath, finalOutputPath, req.mute || false, function (progress) {
                                            if (onProgress) {
                                                // Calculate overall percent: (jobIndex / totalJobs) * 100 + (currentJobPercent / totalJobs)
                                                var overallPercent = 0;
                                                if (mergeCount_1 > 1) {
                                                    var jobBasePercent = (mergeIndex / mergeCount_1) * 100;
                                                    var jobProgressPercent = (progress.percent || 0) / mergeCount_1;
                                                    overallPercent = jobBasePercent + jobProgressPercent;
                                                }
                                                else {
                                                    overallPercent = progress.percent || 0;
                                                }
                                                onProgress(buildMergeProgress({
                                                    mode: 'merge',
                                                    requestId: requestId,
                                                    stage: 'merge',
                                                    percent: Math.min(100, overallPercent),
                                                    timeSec: progress.timeSec,
                                                    totalDurationSec: progress.totalDurationSec || totalDurationForMerge_1,
                                                    speedX: progress.speedX,
                                                    etaSec: progress.etaSec,
                                                    currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                                    totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                                    currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                                    message: mergeCount_1 > 1 ? "\u0110ang gh\u00E9p video ".concat(currentMergeIndex, "/").concat(mergeCount_1, "...") : undefined,
                                                }));
                                            }
                                        }, totalDurationForMerge_1, undefined, // retryCount
                                        requestId)];
                                case 10:
                                    _d.sent();
                                    return [3 /*break*/, 12];
                                case 11:
                                    err_4 = _d.sent();
                                    errorMsg = (err_4 === null || err_4 === void 0 ? void 0 : err_4.message) || String(err_4);
                                    console.error('[mergeVideosSimple] concat copy failed:', errorMsg);
                                    throw new Error("Gh\u00E9p video th\u1EA5t b\u1EA1i: ".concat(errorMsg, ". N\u1EBFu g\u1EB7p l\u1ED7i codec/FPS kh\u00F4ng t\u01B0\u01A1ng th\u00EDch, h\u00E3y b\u1EADt \"Chu\u1EA9n h\u00F3a video khi gh\u00E9p\"."));
                                case 12:
                                    // Emit progress END sau khi hoàn thành job
                                    if (onProgress) {
                                        endPercent = mergeCount_1 > 1 ? ((mergeIndex + 1) / mergeCount_1) * 100 : 100;
                                        onProgress(buildMergeProgress({
                                            mode: 'merge',
                                            requestId: requestId,
                                            stage: 'merge',
                                            percent: Math.min(100, endPercent),
                                            timeSec: totalDurationForMerge_1,
                                            totalDurationSec: totalDurationForMerge_1,
                                            speedX: null,
                                            etaSec: null,
                                            currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                            totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                            currentFile: mergeCount_1 > 1 ? outputFileName : undefined,
                                            message: mergeCount_1 > 1 ? "Ho\u00E0n th\u00E0nh video ".concat(currentMergeIndex, "/").concat(mergeCount_1) : undefined,
                                        }));
                                    }
                                    console.log("[merge][no-target] Completed job ".concat(currentMergeIndex, "/").concat(mergeCount_1, ": ").concat(outputFileName));
                                    _d.label = 13;
                                case 13:
                                    // D3: Cleanup concat list
                                    try {
                                        fs.unlinkSync(concatListPath);
                                    }
                                    catch (_e) { }
                                    // Check cancellation SAU khi merge xong, TRƯỚC khi verify
                                    if (videoJobManager.isCancelled(requestId)) {
                                        console.log("[mergeVideosSimple] Job ".concat(requestId, " cancelled after merge ").concat(currentMergeIndex, "/").concat(mergeCount_1));
                                        throw new Error('Đã dừng bởi người dùng');
                                    }
                                    if (!fs.existsSync(finalOutputPath)) return [3 /*break*/, 24];
                                    stats = fs.statSync(finalOutputPath);
                                    if (stats.size === 0) {
                                        throw new Error("Output file is empty: ".concat(finalOutputPath));
                                    }
                                    if (!(targetDurationSec_1 && targetDurationSec_1 > 0)) return [3 /*break*/, 17];
                                    _d.label = 14;
                                case 14:
                                    _d.trys.push([14, 16, , 17]);
                                    return [4 /*yield*/, getVideoFileInfo(finalOutputPath)];
                                case 15:
                                    finalInfo = _d.sent();
                                    finalDurationSec = finalInfo.durationSec || 0;
                                    // D3: Chỉ fail nếu duration < target - 10s (thiếu hẳn vài đoạn)
                                    if (finalDurationSec < targetDurationSec_1 - 10) {
                                        throw new Error("Output duration (".concat(finalDurationSec.toFixed(2), "s) is too short compared to target (").concat(targetDurationSec_1.toFixed(2), "s)"));
                                    }
                                    diff = Math.abs(finalDurationSec - targetDurationSec_1);
                                    if (diff > 5) {
                                        console.log("[mergeVideosSimple] Duration diff: ".concat(diff.toFixed(2), "s (target: ").concat(targetDurationSec_1.toFixed(2), "s, actual: ").concat(finalDurationSec.toFixed(2), "s)"));
                                    }
                                    return [3 /*break*/, 17];
                                case 16:
                                    error_2 = _d.sent();
                                    // D3: Nếu probe fail, chỉ log warning (không fail job)
                                    if ((_b = error_2 === null || error_2 === void 0 ? void 0 : error_2.message) === null || _b === void 0 ? void 0 : _b.includes('too short')) {
                                        throw error_2; // Re-throw nếu quá ngắn
                                    }
                                    console.warn("[mergeVideosSimple] Failed to verify duration (non-critical):", error_2);
                                    return [3 /*break*/, 17];
                                case 17:
                                    shouldRunDeepVerify = forceSafeMode // Chỉ decode khi đang re-encode (Chuẩn hóa)
                                    ;
                                    if (!shouldRunDeepVerify) return [3 /*break*/, 22];
                                    // Check cancellation trước khi verify (verify có thể mất thời gian)
                                    if (videoJobManager.isCancelled(requestId)) {
                                        console.log("[mergeVideosSimple] Job ".concat(requestId, " cancelled before verification"));
                                        throw new Error('Đã dừng bởi người dùng');
                                    }
                                    _d.label = 18;
                                case 18:
                                    _d.trys.push([18, 20, , 21]);
                                    if (onProgress) {
                                        onProgress(buildMergeProgress({
                                            mode: 'merge',
                                            requestId: requestId,
                                            stage: 'finalizing',
                                            percent: Math.min(99, mergeCount_1 > 1 ? ((mergeIndex + 1) / mergeCount_1) * 100 : 100),
                                            currentJob: mergeCount_1 > 1 ? currentMergeIndex : undefined,
                                            totalJobs: mergeCount_1 > 1 ? mergeCount_1 : undefined,
                                            currentFile: path.basename(finalOutputPath),
                                            message: "\u0110ang ki\u1EC3m tra file xu\u1EA5t ra (ffprobe + decode)...",
                                        }));
                                    }
                                    return [4 /*yield*/, verifyOutputVideo(finalOutputPath, {
                                            expectedDurationSec: targetDurationSec_1 !== null && targetDurationSec_1 !== void 0 ? targetDurationSec_1 : null,
                                            toleranceSec: 5,
                                            onLog: function (msg) { return console.log(msg); },
                                        })];
                                case 19:
                                    verify = _d.sent();
                                    if (verify.durationWarning) {
                                        console.warn("[mergeVideosSimple][verify] Duration diff > 5s (expected=".concat(targetDurationSec_1 !== null && targetDurationSec_1 !== void 0 ? targetDurationSec_1 : 'n/a', "s, actual=").concat(verify.durationSec.toFixed(2), "s)"));
                                    }
                                    if (!verify.decodeOk) {
                                        console.warn("[mergeVideosSimple][verify] Decode test b\u00E1o l\u1ED7i, file c\u00F3 th\u1EC3 b\u1ECB l\u1ED7i trong m\u1ED9t s\u1ED1 player.");
                                    }
                                    return [3 /*break*/, 21];
                                case 20:
                                    verifyErr_1 = _d.sent();
                                    console.warn('[mergeVideosSimple][verify] Không thể chạy bước kiểm tra sâu (không chặn job):', verifyErr_1);
                                    return [3 /*break*/, 21];
                                case 21: return [3 /*break*/, 23];
                                case 22:
                                    console.log('[mergeVideosSimple][verify] Skip deep verification (copy-stream mode).');
                                    _d.label = 23;
                                case 23:
                                    outputPaths.push(finalOutputPath);
                                    mergeElapsedMs = Date.now() - mergeStartTime;
                                    totalElapsedMs += mergeElapsedMs;
                                    // D3: Chỉ log summary (không log duration nếu không probe)
                                    console.log("[mergeVideosSimple] \u2713 Merge ".concat(currentMergeIndex, "/").concat(mergeCount_1, " completed: ").concat(path.basename(finalOutputPath)));
                                    // B5: Progress nhẹ - stage: finalizing
                                    if (onProgress) {
                                        overallPercent = mergeCount_1 > 1 ? ((mergeIndex + 1) / mergeCount_1) * 100 : 100;
                                        onProgress(buildMergeProgress({
                                            mode: 'merge',
                                            requestId: requestId,
                                            stage: 'finalizing',
                                            percent: overallPercent,
                                        }));
                                    }
                                    _d.label = 24;
                                case 24: return [2 /*return*/];
                            }
                        });
                    };
                    mergeIndex = 0;
                    _c.label = 7;
                case 7:
                    if (!(mergeIndex < mergeCount_1)) return [3 /*break*/, 10];
                    return [5 /*yield**/, _loop_2(mergeIndex)];
                case 8:
                    _c.sent();
                    _c.label = 9;
                case 9:
                    mergeIndex++;
                    return [3 /*break*/, 7];
                case 10:
                    elapsedMs = Date.now() - startTime;
                    avgSpeed = req.targetDurationSec && req.targetDurationSec > 0 && elapsedMs > 0
                        ? (req.targetDurationSec * mergeCount_1) / (elapsedMs / 1000)
                        : 0;
                    // Emit completed event
                    if (onProgress) {
                        onProgress(buildMergeProgress({
                            mode: 'merge',
                            requestId: requestId,
                            stage: 'finalizing',
                            percent: 100,
                            completed: true,
                        }));
                    }
                    return [2 /*return*/, {
                            requestId: requestId,
                            outputPaths: outputPaths,
                            outputPath: outputPaths[0],
                            totalDurationSec: req.targetDurationSec || 0,
                            success: true,
                            avgSpeed: avgSpeed,
                            elapsedMs: elapsedMs,
                        }];
                case 11:
                    error_1 = _c.sent();
                    console.error('[mergeVideosSimple] Error:', error_1);
                    // Emit error event
                    if (onProgress) {
                        onProgress(buildMergeProgress({
                            mode: 'merge',
                            requestId: requestId,
                            stage: 'finalizing',
                            percent: 0,
                            completed: true,
                            error: (error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || String(error_1),
                        }));
                    }
                    return [2 /*return*/, {
                            requestId: requestId,
                            outputPaths: [],
                            totalDurationSec: 0,
                            success: false,
                            error: (error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || String(error_1),
                        }];
                case 12: return [2 /*return*/];
            }
        });
    });
}
