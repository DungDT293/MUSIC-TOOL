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
import { cutVideoIntoSegmentsSimple } from './cutSingleSimple';
import { validateInputFiles } from './videoUtils';
import { videoJobManager } from './videoJobManager';
import { buildMultiCutProgress } from './videoProgress';
var MAX_PARALLEL_SINGLE_CUT = 1; // Chạy tuần tự từng video một
/**
 * Sanitize tên file
 */
function sanitizeFileName(fileName) {
    return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}
function computeOverallPercent(totalFiles, currentFileIndex, currentFilePercent) {
    if (totalFiles <= 0)
        return 0;
    var filesDoneBefore = Math.max(0, currentFileIndex - 1);
    var perFileWeight = 100 / totalFiles;
    var donePercent = filesDoneBefore * perFileWeight;
    var currentContribution = (Math.max(0, Math.min(100, currentFilePercent)) / 100) * perFileWeight;
    return Math.min(100, donePercent + currentContribution);
}
/**
 * Run items in batches with concurrency limit
 * Handles errors gracefully and ensures all items are processed
 */
function runInBatches(items, concurrency, worker) {
    return __awaiter(this, void 0, void 0, function () {
        var currentIndex, executing, hasError, processNext, initialBatch, i, results, _i, results_1, result;
        var _this = this;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (items.length === 0)
                        return [2 /*return*/];
                    currentIndex = 0;
                    executing = [];
                    hasError = false;
                    processNext = function () { return __awaiter(_this, void 0, void 0, function () {
                        var index, item, promise;
                        return __generator(this, function (_a) {
                            // Stop if error occurred (cancelled)
                            if (hasError || currentIndex >= items.length)
                                return [2 /*return*/];
                            index = currentIndex++;
                            item = items[index];
                            promise = worker(item, index).catch(function (error) {
                                var _a;
                                // Check if cancelled error - propagate it
                                if ((_a = error === null || error === void 0 ? void 0 : error.message) === null || _a === void 0 ? void 0 : _a.includes('hủy')) {
                                    hasError = true;
                                    throw error; // Re-throw cancelled errors
                                }
                                // Other errors are logged but don't stop the batch
                                console.error("[runInBatches] Worker error for item ".concat(index, ":"), error);
                            }).finally(function () {
                                var execIndex = executing.indexOf(promise);
                                if (execIndex >= 0) {
                                    executing.splice(execIndex, 1);
                                }
                                // Process next if we have capacity and no error
                                if (!hasError && executing.length < concurrency && currentIndex < items.length) {
                                    processNext();
                                }
                            });
                            executing.push(promise);
                            // Process next if we have capacity
                            if (!hasError && executing.length < concurrency && currentIndex < items.length) {
                                processNext();
                            }
                            return [2 /*return*/];
                        });
                    }); };
                    initialBatch = Math.min(concurrency, items.length);
                    for (i = 0; i < initialBatch; i++) {
                        processNext();
                    }
                    return [4 /*yield*/, Promise.allSettled(executing)
                        // Check if any was cancelled
                    ];
                case 1:
                    results = _c.sent();
                    // Check if any was cancelled
                    for (_i = 0, results_1 = results; _i < results_1.length; _i++) {
                        result = results_1[_i];
                        if (result.status === 'rejected' && ((_b = (_a = result.reason) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.includes('hủy'))) {
                            throw result.reason; // Re-throw cancelled error
                        }
                    }
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Cắt nhiều video tuần tự dựa trên engine single-cut.
 */
export function splitManyVideosSimple(req, onProgress, options) {
    return __awaiter(this, void 0, void 0, function () {
        var requestId, startTime, dummyProcess, normalizedInputFiles, _a, valid, invalid, outputRootDir, filesToProcess, totalFiles, results, successCount, failCount, totalProcessingSeconds, totalVideoDuration, childRequestIds, perFileProgress, completedFiles, sentWarningMessage, emitProgress, message, _i, invalid_1, invalidPath, _loop_1, idx, elapsedMs, avgSpeed, success, result, finalPayload;
        var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        return __generator(this, function (_m) {
            switch (_m.label) {
                case 0:
                    requestId = req.requestId || randomUUID();
                    startTime = Date.now();
                    dummyProcess = {
                        killed: false,
                        on: function () { },
                        kill: function () { },
                    };
                    videoJobManager.registerJob(requestId, dummyProcess);
                    normalizedInputFiles = Array.from(new Set((req.inputFiles && req.inputFiles.length ? req.inputFiles : req.inputPaths) || [])).filter(function (p) {
                        var exists = !!p && fs.existsSync(p);
                        if (!exists) {
                            console.warn("[splitManySimple] Skip missing file: ".concat(p));
                        }
                        return exists;
                    });
                    if (normalizedInputFiles.length === 0) {
                        throw new Error('Không có video hợp lệ để cắt');
                    }
                    return [4 /*yield*/, validateInputFiles(normalizedInputFiles, 10)];
                case 1:
                    _a = _m.sent(), valid = _a.valid, invalid = _a.invalid;
                    if (valid.length === 0) {
                        throw new Error('Không có video hợp lệ để cắt (tất cả file đều lỗi hoặc hỏng)');
                    }
                    outputRootDir = req.outputRootDir || req.outputBaseDir;
                    if (!outputRootDir) {
                        throw new Error('Thiếu outputRootDir');
                    }
                    if (!fs.existsSync(outputRootDir)) {
                        fs.mkdirSync(outputRootDir, { recursive: true });
                    }
                    filesToProcess = valid.map(function (v) { return v.path; });
                    totalFiles = normalizedInputFiles.length // Keep original count for reporting
                    ;
                    results = [];
                    successCount = 0;
                    failCount = 0;
                    totalProcessingSeconds = 0;
                    totalVideoDuration = 0;
                    childRequestIds = [];
                    perFileProgress = new Map() // path -> percent (0-100)
                    ;
                    completedFiles = new Set();
                    sentWarningMessage = false // Prevent spam progress.message
                    ;
                    emitProgress = function (partial, filePath) {
                        var _a, _b, _c;
                        if (!onProgress)
                            return;
                        // Update per-file progress if filePath is provided
                        if (filePath && typeof partial.currentFilePercent === 'number') {
                            perFileProgress.set(filePath, partial.currentFilePercent);
                        }
                        // Calculate overall percent - chạy tuần tự nên tính đơn giản hơn
                        var overallPercent = 0;
                        if (partial.overallPercent !== undefined) {
                            overallPercent = partial.overallPercent;
                        }
                        else {
                            // Tính theo công thức: (số file đã xong + phần trăm file hiện tại) / tổng số file
                            var currentFileIndex = (_a = partial.currentFileIndex) !== null && _a !== void 0 ? _a : 0;
                            var currentFilePercent = (_b = partial.currentFilePercent) !== null && _b !== void 0 ? _b : 0;
                            // currentFileIndex là 1-based, nên filesDoneBefore = currentFileIndex - 1
                            var filesDoneBefore = Math.max(0, currentFileIndex - 1);
                            var perFileWeight = 100 / totalFiles;
                            var donePercent = filesDoneBefore * perFileWeight;
                            var currentContribution = (Math.max(0, Math.min(100, currentFilePercent)) / 100) * perFileWeight;
                            overallPercent = Math.min(100, donePercent + currentContribution);
                        }
                        var payload = buildMultiCutProgress({
                            mode: 'multi-cut',
                            requestId: requestId,
                            totalFiles: totalFiles,
                            currentFileIndex: (_c = partial.currentFileIndex) !== null && _c !== void 0 ? _c : 0,
                            currentFilePath: partial.currentFilePath,
                            currentFilePercent: partial.currentFilePercent,
                            currentFileSegment: partial.currentFileSegment,
                            currentFileTotalSegments: partial.currentFileTotalSegments,
                            currentFileSpeedX: partial.currentFileSpeedX,
                            currentFileEtaSec: partial.currentFileEtaSec,
                            overallPercent: overallPercent,
                            error: partial.error,
                            completed: partial.completed,
                            message: partial.message,
                        });
                        onProgress(payload);
                    };
                    // Emit progress message if some files were invalid (only once)
                    if (invalid.length > 0 && !sentWarningMessage) {
                        message = "\u0110\u00E3 b\u1ECF qua ".concat(invalid.length, " video l\u1ED7i / h\u1ECFng tr\u01B0\u1EDBc khi c\u1EAFt");
                        emitProgress({
                            overallPercent: 0,
                            totalFiles: normalizedInputFiles.length,
                            currentFileIndex: 0,
                            message: message,
                        });
                        sentWarningMessage = true;
                    }
                    // Add invalid files to results as failed
                    for (_i = 0, invalid_1 = invalid; _i < invalid_1.length; _i++) {
                        invalidPath = invalid_1[_i];
                        results.push({
                            inputPath: invalidPath,
                            outputDir: '', // No output dir for invalid files
                            segmentCount: 0,
                            success: false,
                            error: 'invalid_or_corrupted',
                        });
                        failCount++;
                        completedFiles.add(invalidPath); // Mark as completed (failed)
                    }
                    _loop_1 = function (idx) {
                        var inputPath, currentFileIndex, videoName, safeBase, outputDir, singleReq, cutResult, _o, childRequestIds_1, childId, error_1, _p, childRequestIds_2, childId, errorMessage;
                        return __generator(this, function (_q) {
                            switch (_q.label) {
                                case 0:
                                    inputPath = filesToProcess[idx];
                                    currentFileIndex = invalid.length + idx + 1;
                                    videoName = path.basename(inputPath);
                                    safeBase = sanitizeFileName(path.basename(inputPath, path.extname(inputPath)) || "video_".concat(currentFileIndex));
                                    outputDir = path.join(outputRootDir, safeBase);
                                    fs.mkdirSync(outputDir, { recursive: true });
                                    console.log("[splitManySimple] Processing file ".concat(currentFileIndex, "/").concat(totalFiles, ": ").concat(videoName, " (sequential)"));
                                    // Initialize progress for this file
                                    perFileProgress.set(inputPath, 0);
                                    emitProgress({
                                        currentFilePercent: 0,
                                        currentFilePath: inputPath,
                                        currentFileIndex: currentFileIndex,
                                    }, inputPath);
                                    _q.label = 1;
                                case 1:
                                    _q.trys.push([1, 3, , 4]);
                                    singleReq = {
                                        inputPath: inputPath,
                                        outputDir: outputDir,
                                        segmentLengthSec: req.segmentLengthSec,
                                        format: req.format,
                                        normalizeOutput: !!req.normalizeOutput,
                                        requestId: "".concat(requestId, "-").concat(currentFileIndex), // Dùng parent requestId + index để track child jobs
                                    };
                                    return [4 /*yield*/, cutVideoIntoSegmentsSimple(singleReq, function (singleProgress) {
                                            var _a, _b, _c, _d, _e, _f;
                                            // Track requestId của single-cut job
                                            if (singleProgress.requestId && !childRequestIds.includes(singleProgress.requestId)) {
                                                childRequestIds.push(singleProgress.requestId);
                                            }
                                            // Check if multi-cut job was cancelled
                                            if (videoJobManager.isCancelled(requestId) || ((_a = options === null || options === void 0 ? void 0 : options.signal) === null || _a === void 0 ? void 0 : _a.aborted)) {
                                                // Cancel all child jobs
                                                for (var _i = 0, childRequestIds_3 = childRequestIds; _i < childRequestIds_3.length; _i++) {
                                                    var childId = childRequestIds_3[_i];
                                                    videoJobManager.cancelJob(childId);
                                                }
                                                return; // Stop processing
                                            }
                                            // Update progress for this file and emit overall progress
                                            emitProgress({
                                                currentFilePercent: (_b = singleProgress.percent) !== null && _b !== void 0 ? _b : 0,
                                                currentFileSegment: (_c = singleProgress.currentSegment) !== null && _c !== void 0 ? _c : 0,
                                                currentFileTotalSegments: (_d = singleProgress.totalSegments) !== null && _d !== void 0 ? _d : 0,
                                                currentFileSpeedX: (_e = singleProgress.speedX) !== null && _e !== void 0 ? _e : null,
                                                currentFileEtaSec: (_f = singleProgress.etaSec) !== null && _f !== void 0 ? _f : null,
                                                currentFilePath: inputPath,
                                                currentFileIndex: currentFileIndex,
                                            }, inputPath);
                                        }, options // Pass options (signal) để có thể cancel
                                        )
                                        // Check if multi-cut job was cancelled after single-cut completes
                                    ];
                                case 2:
                                    cutResult = _q.sent();
                                    // Check if multi-cut job was cancelled after single-cut completes
                                    if (videoJobManager.isCancelled(requestId) || ((_b = options === null || options === void 0 ? void 0 : options.signal) === null || _b === void 0 ? void 0 : _b.aborted)) {
                                        // Cancel all remaining child jobs
                                        for (_o = 0, childRequestIds_1 = childRequestIds; _o < childRequestIds_1.length; _o++) {
                                            childId = childRequestIds_1[_o];
                                            videoJobManager.cancelJob(childId);
                                        }
                                        videoJobManager.cancelJob(requestId); // Cleanup parent
                                        throw new Error('Đã dừng bởi người dùng');
                                    }
                                    // Mark file as completed
                                    completedFiles.add(inputPath);
                                    perFileProgress.delete(inputPath); // Remove from active progress tracking
                                    // UltraFast: Không verify số đoạn - chấp nhận kết quả từ cutVideoIntoSegmentsSimple
                                    if (cutResult.success) {
                                        successCount++;
                                        totalProcessingSeconds += cutResult.elapsedMs / 1000;
                                        // UltraFast: Ước lượng duration từ segmentCount (chấp nhận lệch)
                                        totalVideoDuration += cutResult.segmentCount * req.segmentLengthSec;
                                    }
                                    else {
                                        failCount++;
                                    }
                                    results.push({
                                        inputPath: inputPath,
                                        outputDir: outputDir,
                                        segmentCount: cutResult.segmentCount,
                                        success: cutResult.success,
                                        error: cutResult.error,
                                    });
                                    // Emit final progress for this file
                                    emitProgress({
                                        currentFilePercent: 100,
                                        currentFileSegment: cutResult.segmentCount,
                                        currentFileTotalSegments: cutResult.segmentCount,
                                        currentFileSpeedX: (_c = cutResult.avgSpeed) !== null && _c !== void 0 ? _c : null,
                                        currentFileEtaSec: 0,
                                        currentFilePath: inputPath,
                                        currentFileIndex: currentFileIndex,
                                    }, inputPath);
                                    return [3 /*break*/, 4];
                                case 3:
                                    error_1 = _q.sent();
                                    // Mark file as completed (failed)
                                    completedFiles.add(inputPath);
                                    perFileProgress.delete(inputPath);
                                    // Check if cancelled
                                    if (((_d = error_1 === null || error_1 === void 0 ? void 0 : error_1.message) === null || _d === void 0 ? void 0 : _d.includes('hủy')) || ((_e = error_1 === null || error_1 === void 0 ? void 0 : error_1.message) === null || _e === void 0 ? void 0 : _e.includes('dừng')) || videoJobManager.isCancelled(requestId) || ((_f = options === null || options === void 0 ? void 0 : options.signal) === null || _f === void 0 ? void 0 : _f.aborted)) {
                                        // Cancel all remaining child jobs
                                        for (_p = 0, childRequestIds_2 = childRequestIds; _p < childRequestIds_2.length; _p++) {
                                            childId = childRequestIds_2[_p];
                                            videoJobManager.cancelJob(childId);
                                        }
                                        videoJobManager.cancelJob(requestId); // Cleanup parent
                                        throw new Error('Đã dừng bởi người dùng');
                                    }
                                    failCount++;
                                    errorMessage = (error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || String(error_1);
                                    console.error("[splitManySimple] Error cutting ".concat(inputPath, " (index ").concat(idx, "):"), errorMessage);
                                    results.push({
                                        inputPath: inputPath,
                                        outputDir: outputDir,
                                        segmentCount: 0,
                                        success: false,
                                        error: errorMessage,
                                    });
                                    // Emit error progress
                                    emitProgress({
                                        currentFilePercent: 100,
                                        currentFileSegment: 0,
                                        currentFileTotalSegments: 0,
                                        currentFileSpeedX: null,
                                        currentFileEtaSec: null,
                                        error: errorMessage,
                                        currentFilePath: inputPath,
                                        currentFileIndex: currentFileIndex,
                                    }, inputPath);
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    idx = 0;
                    _m.label = 2;
                case 2:
                    if (!(idx < filesToProcess.length)) return [3 /*break*/, 5];
                    return [5 /*yield**/, _loop_1(idx)];
                case 3:
                    _m.sent();
                    _m.label = 4;
                case 4:
                    idx++;
                    return [3 /*break*/, 2];
                case 5:
                    // Clear memory after job completes
                    perFileProgress.clear();
                    completedFiles.clear();
                    elapsedMs = Date.now() - startTime;
                    avgSpeed = totalProcessingSeconds > 0 && totalVideoDuration > 0
                        ? totalVideoDuration / totalProcessingSeconds
                        : 0;
                    success = failCount === 0;
                    // Cleanup parent job
                    videoJobManager.cancelJob(requestId);
                    result = {
                        requestId: requestId,
                        success: success,
                        totalFiles: totalFiles,
                        successCount: successCount,
                        failCount: failCount,
                        elapsedMs: elapsedMs,
                        avgSpeed: avgSpeed,
                        results: results !== null && results !== void 0 ? results : [], // Always ensure results is an array
                    };
                    if (onProgress) {
                        finalPayload = buildMultiCutProgress({
                            mode: 'multi-cut',
                            requestId: requestId,
                            totalFiles: totalFiles,
                            currentFileIndex: totalFiles,
                            currentFilePath: (_g = results[results.length - 1]) === null || _g === void 0 ? void 0 : _g.inputPath,
                            currentFilePercent: 100,
                            currentFileSegment: (_j = (_h = results[results.length - 1]) === null || _h === void 0 ? void 0 : _h.segmentCount) !== null && _j !== void 0 ? _j : 0,
                            currentFileTotalSegments: (_l = (_k = results[results.length - 1]) === null || _k === void 0 ? void 0 : _k.segmentCount) !== null && _l !== void 0 ? _l : 0,
                            currentFileSpeedX: null,
                            currentFileEtaSec: 0,
                            overallPercent: 100,
                            completed: true,
                        });
                        onProgress(finalPayload);
                    }
                    return [2 /*return*/, result];
            }
        });
    });
}
// Backward-compatible export name
export var splitMultipleVideosSimple = splitManyVideosSimple;
