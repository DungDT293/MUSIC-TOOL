var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { getFfmpegPaths } from '../ffmpeg/config';
import { validateInputFiles } from './videoUtils';
import { videoJobManager } from './videoJobManager';
export function muteVideoAudio(req, onProgress) {
    return __awaiter(this, void 0, void 0, function () {
        var requestId, startTime, emitProgress, inputFiles, outputDir, _a, valid, invalid, totalFiles_1, processed_1, failed_1, outputPaths_1, lastError_1, message, ffmpeg_1, _loop_1, index, elapsedMs, success, err_1, errorMessage;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    requestId = req.requestId || randomUUID();
                    startTime = Date.now();
                    emitProgress = function (partial) {
                        if (!onProgress)
                            return;
                        onProgress(__assign({ requestId: requestId }, partial));
                    };
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 7, , 8]);
                    inputFiles = Array.from(new Set(req.inputFiles || [])).filter(function (p) { return !!p && fs.existsSync(p); });
                    if (!inputFiles.length) {
                        throw new Error('Không có video hợp lệ để tắt âm thanh');
                    }
                    outputDir = req.outputDir;
                    if (!outputDir) {
                        throw new Error('Thiếu outputDir');
                    }
                    if (!fs.existsSync(outputDir)) {
                        fs.mkdirSync(outputDir, { recursive: true });
                    }
                    return [4 /*yield*/, validateInputFiles(inputFiles, 8)];
                case 2:
                    _a = _d.sent(), valid = _a.valid, invalid = _a.invalid;
                    totalFiles_1 = inputFiles.length;
                    processed_1 = 0;
                    failed_1 = 0;
                    outputPaths_1 = [];
                    // Báo các file invalid (nếu có)
                    if (invalid.length > 0) {
                        message = "\u0110\u00E3 b\u1ECF qua ".concat(invalid.length, " video l\u1ED7i / h\u1ECFng tr\u01B0\u1EDBc khi t\u1EAFt \u00E2m thanh");
                        emitProgress({
                            currentFile: '',
                            currentIndex: 0,
                            totalFiles: totalFiles_1,
                            percent: 0,
                            message: message,
                        });
                        failed_1 += invalid.length;
                    }
                    ffmpeg_1 = getFfmpegPaths().ffmpeg;
                    _loop_1 = function (index) {
                        var fileInfo, inputPath, ext, baseName, outputPath;
                        return __generator(this, function (_e) {
                            switch (_e.label) {
                                case 0:
                                    fileInfo = valid[index];
                                    inputPath = fileInfo.path;
                                    if (videoJobManager.isCancelled(requestId)) {
                                        throw new Error('Đã dừng bởi người dùng');
                                    }
                                    ext = path.extname(inputPath) || '.mp4';
                                    baseName = path.basename(inputPath, ext);
                                    outputPath = path.join(outputDir, "".concat(baseName, "_mute").concat(ext));
                                    emitProgress({
                                        currentFile: path.basename(inputPath),
                                        currentIndex: index + 1,
                                        totalFiles: totalFiles_1,
                                        percent: (index / totalFiles_1) * 100,
                                        message: "\u0110ang t\u1EAFt \u00E2m thanh video ".concat(index + 1, "/").concat(totalFiles_1, "..."),
                                    });
                                    // Chạy FFmpeg để copy video stream và bỏ audio (-an)
                                    return [4 /*yield*/, new Promise(function (resolve) {
                                            var args = ['-y', '-i', inputPath, '-c', 'copy', '-an', outputPath];
                                            var proc = spawn(ffmpeg_1, args, {
                                                windowsHide: true,
                                            });
                                            // Đăng ký job để có thể cancel
                                            videoJobManager.registerJob(requestId, proc);
                                            var stderrBuffer = '';
                                            proc.stderr.on('data', function (data) {
                                                stderrBuffer += data.toString();
                                                // Nếu user cancel trong khi đang chạy, kill process
                                                if (videoJobManager.isCancelled(requestId)) {
                                                    try {
                                                        if (!proc.killed) {
                                                            proc.kill('SIGTERM');
                                                            setTimeout(function () {
                                                                if (!proc.killed) {
                                                                    try {
                                                                        proc.kill('SIGKILL');
                                                                    }
                                                                    catch (_a) {
                                                                        // ignore
                                                                    }
                                                                }
                                                            }, 1000);
                                                        }
                                                    }
                                                    catch (_a) {
                                                        // ignore
                                                    }
                                                }
                                            });
                                            proc.on('close', function (code) {
                                                if (videoJobManager.isCancelled(requestId)) {
                                                    lastError_1 = 'Đã dừng bởi người dùng';
                                                    failed_1++;
                                                    emitProgress({
                                                        currentFile: path.basename(inputPath),
                                                        currentIndex: index + 1,
                                                        totalFiles: totalFiles_1,
                                                        percent: (index + 1) / totalFiles_1 * 100,
                                                        error: lastError_1,
                                                    });
                                                    resolve();
                                                    return;
                                                }
                                                if (code === 0 && fs.existsSync(outputPath)) {
                                                    processed_1++;
                                                    outputPaths_1.push(outputPath);
                                                    emitProgress({
                                                        currentFile: path.basename(inputPath),
                                                        currentIndex: index + 1,
                                                        totalFiles: totalFiles_1,
                                                        percent: ((index + 1) / totalFiles_1) * 100,
                                                        message: "\u0110\u00E3 t\u1EAFt \u00E2m thanh video ".concat(index + 1, "/").concat(totalFiles_1),
                                                    });
                                                }
                                                else {
                                                    failed_1++;
                                                    var stderrSnippet = stderrBuffer.slice(-400);
                                                    lastError_1 = "FFmpeg exited with code ".concat(code, ". ").concat(stderrSnippet);
                                                    console.error('[muteVideoAudio] FFmpeg error for file:', inputPath, '\n', stderrSnippet);
                                                    emitProgress({
                                                        currentFile: path.basename(inputPath),
                                                        currentIndex: index + 1,
                                                        totalFiles: totalFiles_1,
                                                        percent: ((index + 1) / totalFiles_1) * 100,
                                                        error: lastError_1,
                                                    });
                                                }
                                                resolve();
                                            });
                                            proc.on('error', function (err) {
                                                failed_1++;
                                                lastError_1 = "FFmpeg process error: ".concat(err.message);
                                                console.error('[muteVideoAudio] FFmpeg process error for file:', inputPath, err);
                                                emitProgress({
                                                    currentFile: path.basename(inputPath),
                                                    currentIndex: index + 1,
                                                    totalFiles: totalFiles_1,
                                                    percent: ((index + 1) / totalFiles_1) * 100,
                                                    error: lastError_1,
                                                });
                                                resolve();
                                            });
                                        })];
                                case 1:
                                    // Chạy FFmpeg để copy video stream và bỏ audio (-an)
                                    _e.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    index = 0;
                    _d.label = 3;
                case 3:
                    if (!(index < valid.length)) return [3 /*break*/, 6];
                    return [5 /*yield**/, _loop_1(index)];
                case 4:
                    _d.sent();
                    _d.label = 5;
                case 5:
                    index++;
                    return [3 /*break*/, 3];
                case 6:
                    elapsedMs = Date.now() - startTime;
                    console.log("[muteVideoAudio] Completed. processed=".concat(processed_1, ", failed=").concat(failed_1, ", elapsed=").concat((elapsedMs / 1000).toFixed(1), "s"));
                    success = failed_1 === 0;
                    return [2 /*return*/, {
                            requestId: requestId,
                            outputPaths: outputPaths_1,
                            success: success,
                            error: success ? undefined : lastError_1 || 'Một số video tắt âm thanh thất bại',
                            processed: processed_1,
                            failed: failed_1,
                        }];
                case 7:
                    err_1 = _d.sent();
                    errorMessage = (err_1 === null || err_1 === void 0 ? void 0 : err_1.message) || String(err_1);
                    console.error('[muteVideoAudio] Error:', err_1);
                    emitProgress({
                        currentFile: '',
                        currentIndex: 0,
                        totalFiles: ((_b = req.inputFiles) === null || _b === void 0 ? void 0 : _b.length) || 0,
                        percent: 0,
                        error: errorMessage,
                    });
                    return [2 /*return*/, {
                            requestId: requestId,
                            outputPaths: [],
                            success: false,
                            error: errorMessage,
                            processed: 0,
                            failed: ((_c = req.inputFiles) === null || _c === void 0 ? void 0 : _c.length) || 0,
                        }];
                case 8: return [2 /*return*/];
            }
        });
    });
}
