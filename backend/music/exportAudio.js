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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runFfmpeg } from '../ffmpeg/wrapper';
import { getPlaylistById } from './playlistEngine';
import { loadScanResult } from './scanStore';
import { checkMinimumSpace, createDiskSpaceErrorMessage, formatBytes, getDiskSpace, } from '../utils/diskSpace';
import { addHistoryEntry } from './exportHistory';
import { probeFile } from '../ffmpeg/probe';
/**
 * Chuẩn hóa tên file: bỏ ký tự đặc biệt, thay bằng _
 */
function sanitizeFileName(fileName) {
    // Bỏ ký tự không hợp lệ cho tên file Windows/Linux
    return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}
/**
 * Tạo file concat list.txt cho FFmpeg
 */
function createConcatListFile(tracks, tempDir, playlistId) {
    var listFile = path.join(tempDir, "concat-".concat(playlistId, "-").concat(Date.now(), ".txt"));
    var lines = [];
    for (var _i = 0, tracks_1 = tracks; _i < tracks_1.length; _i++) {
        var track = tracks_1[_i];
        // Normalize path: Windows backslashes -> forward slashes cho FFmpeg
        var normalizedPath = track.path.replace(/\\/g, '/');
        // Escape single quotes trong path (đã normalize thành forward slashes rồi)
        normalizedPath = normalizedPath.replace(/'/g, "\\'");
        lines.push("file '".concat(normalizedPath, "'"));
    }
    fs.writeFileSync(listFile, lines.join('\n'), 'utf-8');
    return listFile;
}
/**
 * Export playlist thành một file audio duy nhất
 */
export function exportPlaylistToFile(req, progressEmitter) {
    return __awaiter(this, void 0, void 0, function () {
        var tempFiles, listFile, batchTempFiles, concatListFile, playlist, diskInfo, spaceCheck, errorMsg, diskErr_1, safeName, ext, outputPath_1, tempDirPath, diskInfo, estimatedBytes, spaceCheck, diskErr_2, tempDir, smoothTransitions, crossfadeDurationSec, defaultBitrate, bitrate, targetDurationSec, totalDurationSec_1, args_1, MAX_TRACKS_PER_BATCH, totalTracks_1, crossfadePoints, lastTrackDuration, lastTrackRemainingSec, estimatedOutputDurationSec, durationDiff, scanResult, averageTrackDuration, durationPerNewTrack, estimatedTracksNeeded, usedTrackIds_1, availableTracks, tracksToAdd, addedDuration, lastTrackId, shuffled, _i, shuffled_1, track, cumulativeDuration, newTotalTracks, newCrossfadePoints, newTotalDuration, newLastTrackDuration, newLastTrackRemainingSec, newEstimatedDuration, extendedPlaylist, newTotalTracks, newCrossfadePoints, newLastTrackDuration, newLastTrackRemainingSec, filterLines, inputLabels, i, label, lastLabel, i, nextLabel, isLastTrack, outLabel, lastTrackRemainingLabel, remainingStartSec, lastTrackRemainingSec_1, estimatedOutputDurationSec_1, durationDiff_1, scanResult, averageTrackDuration, durationPerNewTrack, estimatedTracksNeeded, usedTrackIds_2, availableTracks, tracksToAdd, addedDuration, lastTrackId, shuffled, _a, shuffled_2, track, cumulativeDuration, newTotalTracks, newCrossfadePoints, newTotalDuration, newLastTrackDuration, newLastTrackRemainingSec, newEstimatedDuration, extendedPlaylist, newTotalTracks, newCrossfadePoints, newLastTrackDuration, newLastTrackRemainingSec, filterComplex, batches, i, batchOutputFiles, processedDuration_1, _loop_1, batchIdx, state_1, concatLines, requestId, result, actualDurationSec, probed, err_1, diffSec, successResult, err_2;
        var _b, _c, _d, _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    tempFiles = new Set() // Track all temp files for cleanup
                    ;
                    listFile = null;
                    batchTempFiles = [] // Track batch temp files để cleanup
                    ;
                    concatListFile = null // Track concat list file để cleanup
                    ;
                    _j.label = 1;
                case 1:
                    _j.trys.push([1, 24, 25, 26]);
                    playlist = getPlaylistById(req.playlistId);
                    if (!playlist) {
                        return [2 /*return*/, {
                                success: false,
                                error: 'Playlist không tồn tại.',
                            }];
                    }
                    if (playlist.tracks.length === 0) {
                        return [2 /*return*/, {
                                success: false,
                                error: 'Playlist không có bài hát nào.',
                            }];
                    }
                    // 2. Validate output directory
                    if (!fs.existsSync(req.outputDir)) {
                        return [2 /*return*/, {
                                success: false,
                                error: "Th\u01B0 m\u1EE5c xu\u1EA5t kh\u00F4ng t\u1ED3n t\u1EA1i: ".concat(req.outputDir),
                            }];
                    }
                    _j.label = 2;
                case 2:
                    _j.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, getDiskSpace(req.outputDir)];
                case 3:
                    diskInfo = _j.sent();
                    console.log("[ExportAudio] Disk ".concat(diskInfo.drive, ": ").concat(formatBytes(diskInfo.free), " free (").concat((diskInfo.free /
                        (1024 * 1024 * 1024)).toFixed(2), " GB)"));
                    spaceCheck = checkMinimumSpace(diskInfo.free, 4);
                    if (!spaceCheck.enough) {
                        errorMsg = createDiskSpaceErrorMessage(diskInfo, spaceCheck, {
                            tabName: 'Tab 4 - Xuất nhạc',
                            operation: 'Export playlist',
                            additionalInfo: "Playlist: ".concat(playlist.name, " \u2013 s\u1ED1 b\u00E0i: ").concat(playlist.tracks.length),
                        });
                        console.error('[ExportAudio] Disk space not enough\n', errorMsg);
                        return [2 /*return*/, {
                                success: false,
                                error: errorMsg,
                            }];
                    }
                    console.log('[ExportAudio] ✓ Disk space OK');
                    return [3 /*break*/, 5];
                case 4:
                    diskErr_1 = _j.sent();
                    console.error('[ExportAudio] Disk space check error:', diskErr_1);
                    return [2 /*return*/, {
                            success: false,
                            error: (diskErr_1 === null || diskErr_1 === void 0 ? void 0 : diskErr_1.message) || 'Không kiểm tra được dung lượng ổ đĩa.',
                        }];
                case 5:
                    safeName = sanitizeFileName(req.fileName);
                    ext = req.format === 'mp3' ? '.mp3' : req.format === 'aac' ? '.m4a' : '.wav';
                    outputPath_1 = path.join(req.outputDir, safeName + ext);
                    tempDirPath = os.tmpdir();
                    _j.label = 6;
                case 6:
                    _j.trys.push([6, 8, , 9]);
                    return [4 /*yield*/, getDiskSpace(tempDirPath)
                        // Estimate: assume each track needs ~50MB temp space
                    ];
                case 7:
                    diskInfo = _j.sent();
                    estimatedBytes = playlist.tracks.length * 50 * 1024 * 1024;
                    spaceCheck = checkMinimumSpace(diskInfo.free, Math.ceil(estimatedBytes / (1024 * 1024 * 1024)));
                    if (!spaceCheck.enough) {
                        return [2 /*return*/, {
                                success: false,
                                error: "Kh\u00F4ng \u0111\u1EE7 dung l\u01B0\u1EE3ng \u1ED5 \u0111\u0129a \u0111\u1EC3 t\u1EA1o temp files. C\u1EA7n: ".concat(formatBytes(estimatedBytes), ", C\u00F2n: ").concat(formatBytes(diskInfo.free)),
                            }];
                    }
                    return [3 /*break*/, 9];
                case 8:
                    diskErr_2 = _j.sent();
                    console.warn('[ExportAudio] Disk space check failed, continuing anyway:', diskErr_2);
                    return [3 /*break*/, 9];
                case 9:
                    tempDir = path.join(os.tmpdir(), '93-media-tool-mix-nhac');
                    if (!fs.existsSync(tempDir)) {
                        fs.mkdirSync(tempDir, { recursive: true });
                    }
                    smoothTransitions = !!req.smoothTransitions && playlist.tracks.length > 1;
                    crossfadeDurationSec = (function () {
                        var raw = req.crossfadeDurationSec;
                        var fallback = 4; // default 4s trong khoảng 1-10s
                        if (!raw || raw <= 0)
                            return fallback;
                        return Math.min(Math.max(raw, 1), 10);
                    })();
                    defaultBitrate = req.format === 'aac' ? 256 : req.format === 'mp3' ? 320 : undefined;
                    bitrate = (_b = req.bitrateKbps) !== null && _b !== void 0 ? _b : defaultBitrate;
                    targetDurationSec = playlist.targetDurationSec || playlist.totalDurationSec;
                    totalDurationSec_1 = playlist.totalDurationSec;
                    args_1 = [];
                    if (!!smoothTransitions) return [3 /*break*/, 10];
                    // Giữ concat copy như cũ (nhanh, không fade)
                    try {
                        listFile = createConcatListFile(playlist.tracks, tempDir, req.playlistId);
                        if (listFile)
                            tempFiles.add(listFile); // Fix High #2.1: Track for cleanup
                        if (req.format === 'mp3') {
                            args_1 = [
                                '-hide_banner',
                                '-y', // overwrite output file
                                '-f',
                                'concat',
                                '-safe',
                                '0',
                                '-i',
                                listFile,
                                '-vn', // no video
                                '-acodec',
                                'libmp3lame',
                                '-ar',
                                '48000',
                                '-ac',
                                '2',
                                '-b:a',
                                "".concat((bitrate !== null && bitrate !== void 0 ? bitrate : 320), "k"),
                                outputPath_1,
                            ];
                        }
                        else if (req.format === 'aac') {
                            args_1 = [
                                '-hide_banner',
                                '-y',
                                '-f',
                                'concat',
                                '-safe',
                                '0',
                                '-i',
                                listFile,
                                '-vn',
                                '-acodec',
                                'aac',
                                '-ar',
                                '48000',
                                '-ac',
                                '2',
                                '-b:a',
                                "".concat((bitrate !== null && bitrate !== void 0 ? bitrate : 384), "k"),
                                outputPath_1,
                            ];
                        }
                        else {
                            // WAV
                            args_1 = [
                                '-hide_banner',
                                '-y',
                                '-f',
                                'concat',
                                '-safe',
                                '0',
                                '-i',
                                listFile,
                                '-vn',
                                '-acodec',
                                'pcm_s16le',
                                '-ar',
                                '48000',
                                '-ac',
                                '2',
                                outputPath_1,
                            ];
                        }
                        // Cập nhật totalDurationSec để dùng cho progress tracking
                        totalDurationSec_1 = targetDurationSec;
                        // Emit progress ban đầu với target duration
                        if (progressEmitter) {
                            progressEmitter({
                                playlistId: req.playlistId,
                                outputPath: outputPath_1,
                                currentSec: 0,
                                totalSec: totalDurationSec_1,
                                percent: 0,
                            });
                        }
                    }
                    catch (err) {
                        if (listFile && fs.existsSync(listFile)) {
                            try {
                                fs.unlinkSync(listFile);
                            }
                            catch (_k) { }
                        }
                        throw err;
                    }
                    return [3 /*break*/, 16];
                case 10:
                    MAX_TRACKS_PER_BATCH = 8 // Giới hạn số tracks mỗi batch để tránh memory issue
                    ;
                    totalTracks_1 = playlist.tracks.length;
                    crossfadePoints = totalTracks_1 > 1 ? totalTracks_1 - 1 : 0;
                    lastTrackDuration = ((_c = playlist.tracks[playlist.tracks.length - 1]) === null || _c === void 0 ? void 0 : _c.duration) || 0;
                    lastTrackRemainingSec = lastTrackDuration > crossfadeDurationSec
                        ? (lastTrackDuration - crossfadeDurationSec)
                        : 0;
                    estimatedOutputDurationSec = playlist.totalDurationSec
                        - (crossfadeDurationSec * crossfadePoints)
                        + lastTrackRemainingSec;
                    // Debug logging để kiểm tra tính toán
                    console.log("[exportAudio] Crossfade duration calculation (tr\u01B0\u1EDBc khi extend):");
                    console.log("  - Total tracks: ".concat(totalTracks_1));
                    console.log("  - Crossfade points: ".concat(crossfadePoints));
                    console.log("  - Crossfade duration: ".concat(crossfadeDurationSec, "s"));
                    console.log("  - Playlist total duration: ".concat(playlist.totalDurationSec.toFixed(2), "s"));
                    console.log("  - Estimated output duration: ".concat(estimatedOutputDurationSec.toFixed(2), "s"));
                    console.log("  - Target duration: ".concat(targetDurationSec.toFixed(2), "s"));
                    durationDiff = targetDurationSec - estimatedOutputDurationSec;
                    if (durationDiff > 5.0) {
                        console.log("[exportAudio] Playlist thi\u1EBFu ".concat(durationDiff.toFixed(2), "s so v\u1EDBi target (").concat(targetDurationSec.toFixed(2), "s). ") +
                            "\u0110ang t\u1EF1 \u0111\u1ED9ng th\u00EAm b\u00E0i nh\u1EA1c v\u00E0o playlist...");
                        scanResult = loadScanResult();
                        if (scanResult && scanResult.tracks.length > 0) {
                            averageTrackDuration = scanResult.tracks.reduce(function (sum, t) { return sum + t.duration; }, 0) / scanResult.tracks.length;
                            durationPerNewTrack = averageTrackDuration - crossfadeDurationSec;
                            estimatedTracksNeeded = Math.ceil(durationDiff / Math.max(durationPerNewTrack, 1));
                            console.log("[exportAudio] \u01AF\u1EDBc t\u00EDnh c\u1EA7n th\u00EAm ".concat(estimatedTracksNeeded, " b\u00E0i (average: ").concat(averageTrackDuration.toFixed(1), "s, ") +
                                "duration per new track: ".concat(durationPerNewTrack.toFixed(1), "s)"));
                            usedTrackIds_1 = new Set(playlist.tracks.map(function (t) { return t.id; }));
                            availableTracks = scanResult.tracks.filter(function (t) { return !usedTrackIds_1.has(t.id); });
                            if (availableTracks.length === 0) {
                                console.warn("[exportAudio] Kh\u00F4ng c\u00F2n b\u00E0i nh\u1EA1c n\u00E0o \u0111\u1EC3 th\u00EAm v\u00E0o playlist.");
                            }
                            else {
                                tracksToAdd = [];
                                addedDuration = 0;
                                lastTrackId = ((_d = playlist.tracks[playlist.tracks.length - 1]) === null || _d === void 0 ? void 0 : _d.id) || '';
                                shuffled = __spreadArray([], availableTracks, true).sort(function () { return Math.random() - 0.5; });
                                for (_i = 0, shuffled_1 = shuffled; _i < shuffled_1.length; _i++) {
                                    track = shuffled_1[_i];
                                    if (tracksToAdd.length >= estimatedTracksNeeded + 10)
                                        break; // Thêm thêm 10 bài để đảm bảo đủ
                                    // Tránh trùng liên tiếp
                                    if (track.id === lastTrackId && shuffled.length > 1)
                                        continue;
                                    cumulativeDuration = playlist.totalDurationSec + addedDuration + track.duration;
                                    tracksToAdd.push(__assign(__assign({}, track), { order: playlist.tracks.length + tracksToAdd.length + 1, cumulativeDuration: cumulativeDuration }));
                                    addedDuration += track.duration;
                                    lastTrackId = track.id;
                                    newTotalTracks = totalTracks_1 + tracksToAdd.length;
                                    newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0;
                                    newTotalDuration = playlist.totalDurationSec + addedDuration;
                                    newLastTrackDuration = track.duration;
                                    newLastTrackRemainingSec = newLastTrackDuration > crossfadeDurationSec
                                        ? (newLastTrackDuration - crossfadeDurationSec)
                                        : 0;
                                    newEstimatedDuration = newTotalDuration
                                        - (crossfadeDurationSec * newCrossfadePoints)
                                        + newLastTrackRemainingSec;
                                    // Nếu đã đủ hoặc vượt target, dừng lại
                                    if (newEstimatedDuration >= targetDurationSec - 1.0) {
                                        break;
                                    }
                                }
                                if (tracksToAdd.length > 0) {
                                    extendedPlaylist = __assign(__assign({}, playlist), { tracks: __spreadArray(__spreadArray([], playlist.tracks, true), tracksToAdd, true), totalDurationSec: playlist.totalDurationSec + addedDuration });
                                    newTotalTracks = extendedPlaylist.tracks.length;
                                    newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0;
                                    newLastTrackDuration = ((_e = extendedPlaylist.tracks[extendedPlaylist.tracks.length - 1]) === null || _e === void 0 ? void 0 : _e.duration) || 0;
                                    newLastTrackRemainingSec = newLastTrackDuration > crossfadeDurationSec
                                        ? (newLastTrackDuration - crossfadeDurationSec)
                                        : 0;
                                    estimatedOutputDurationSec = extendedPlaylist.totalDurationSec
                                        - (crossfadeDurationSec * newCrossfadePoints)
                                        + newLastTrackRemainingSec;
                                    console.log("[exportAudio] \u0110\u00E3 th\u00EAm ".concat(tracksToAdd.length, " b\u00E0i v\u00E0o playlist. ") +
                                        "Duration: ".concat(playlist.totalDurationSec.toFixed(1), "s -> ").concat(extendedPlaylist.totalDurationSec.toFixed(1), "s. ") +
                                        "Estimated sau crossfade: ".concat(estimatedOutputDurationSec.toFixed(1), "s (target: ").concat(targetDurationSec.toFixed(1), "s)"));
                                    // Dùng playlist mới
                                    playlist = extendedPlaylist;
                                    totalTracks_1 = newTotalTracks;
                                    crossfadePoints = newCrossfadePoints;
                                    lastTrackDuration = newLastTrackDuration;
                                    lastTrackRemainingSec = newLastTrackRemainingSec;
                                }
                            }
                        }
                        else {
                            console.warn("[exportAudio] Kh\u00F4ng c\u00F3 scan result \u0111\u1EC3 th\u00EAm b\u00E0i nh\u1EA1c v\u00E0o playlist.");
                        }
                    }
                    if (!(totalTracks_1 <= MAX_TRACKS_PER_BATCH)) return [3 /*break*/, 11];
                    // Nếu số tracks <= MAX_TRACKS_PER_BATCH, xử lý bình thường
                    args_1 = ['-hide_banner', '-y'];
                    // Inputs
                    playlist.tracks.forEach(function (track) {
                        args_1.push('-i', track.path);
                    });
                    filterLines = [];
                    inputLabels = [];
                    // Đảm bảo tất cả các bài được decode đầy đủ (không trim)
                    for (i = 0; i < playlist.tracks.length; i++) {
                        label = "a".concat(i);
                        inputLabels.push("[".concat(label, "]"));
                        // Không trim, để nguyên toàn bộ bài để đảm bảo bài cuối được phát hết
                        filterLines.push("[".concat(i, ":a]asetpts=PTS-STARTPTS[").concat(label, "]"));
                    }
                    lastLabel = inputLabels[0];
                    // totalTracks đã được tính ở trên (sau khi extend playlist nếu cần)
                    if (totalTracks_1 === 1) {
                        // Chỉ có 1 bài: không cần crossfade, chỉ copy
                        filterLines.push("".concat(inputLabels[0], "acopy[amixout]"));
                        lastLabel = '[amixout]';
                    }
                    else {
                        // Crossfade các bài từ đầu đến bài áp cuối
                        // Bài cuối sẽ được xử lý riêng để đảm bảo phát hết
                        for (i = 1; i < totalTracks_1; i++) {
                            nextLabel = inputLabels[i];
                            isLastTrack = i === totalTracks_1 - 1;
                            outLabel = isLastTrack ? 'amixout' : "acfade".concat(i);
                            filterLines.push("".concat(lastLabel).concat(nextLabel, "acrossfade=d=").concat(crossfadeDurationSec, ":c1=tri:c2=tri[").concat(outLabel, "]"));
                            lastLabel = "[".concat(outLabel, "]");
                        }
                        // Đảm bảo lastLabel là [amixout]
                        if (lastLabel !== '[amixout]') {
                            filterLines.push("".concat(lastLabel, "acopy[amixout]"));
                            lastLabel = '[amixout]';
                        }
                    }
                    // Tính toán duration sau crossfade:
                    // Khi acrossfade, mỗi điểm nối (giữa 2 bài) sẽ overlap crossfadeDurationSec giây
                    // - Bài đầu fade out trong crossfadeDurationSec cuối
                    // - Bài sau fade in trong crossfadeDurationSec đầu
                    // - Overlap = crossfadeDurationSec
                    // 
                    // Với N bài, có N-1 điểm nối
                    // Tổng duration = tổng tất cả bài - (crossfadeDurationSec * số điểm nối)
                    // 
                    // Tuy nhiên, bài cuối cần được phát hết:
                    // - Khi acrossfade với bài áp cuối, bài cuối chỉ fade in trong crossfadeDurationSec đầu
                    // - Nếu bài cuối dài hơn crossfadeDurationSec, phần còn lại (từ crossfadeDurationSec đến hết) cần concat thêm
                    // 
                    // Công thức đúng:
                    // Duration = tổng duration - (crossfadeDurationSec * số điểm nối) + phần còn lại của bài cuối (nếu có)
                    // = tổng duration - (crossfadeDurationSec * (N-1)) + max(0, lastTrackDuration - crossfadeDurationSec)
                    // crossfadePoints, lastTrackDuration đã được tính ở trên (sau khi extend playlist nếu cần)
                    // Xử lý bài cuối: concat phần còn lại (sau phần fade in đã được crossfade)
                    // Đảm bảo bài cuối được phát hết mà không gây im lặng
                    if (totalTracks_1 > 1 && lastTrackDuration > crossfadeDurationSec) {
                        lastTrackRemainingLabel = 'last_track_remaining';
                        remainingStartSec = crossfadeDurationSec;
                        // Lấy phần còn lại của bài cuối (từ crossfadeDurationSec đến hết)
                        // Đảm bảo reset PTS để tránh gap khi concat
                        filterLines.push("[".concat(totalTracks_1 - 1, ":a]atrim=start=").concat(remainingStartSec.toFixed(3), ",asetpts=PTS-STARTPTS[").concat(lastTrackRemainingLabel, "]"));
                        // Concat phần crossfade với phần còn lại của bài cuối
                        // Đảm bảo không có gap bằng cách dùng concat với cùng sample rate và reset PTS
                        filterLines.push("[amixout][".concat(lastTrackRemainingLabel, "]concat=n=2:v=0:a=1[final_crossfade]"));
                        lastLabel = '[final_crossfade]';
                    }
                    lastTrackRemainingSec_1 = lastTrackDuration > crossfadeDurationSec
                        ? (lastTrackDuration - crossfadeDurationSec)
                        : 0;
                    estimatedOutputDurationSec_1 = playlist.totalDurationSec
                        - (crossfadeDurationSec * crossfadePoints)
                        + lastTrackRemainingSec_1;
                    // Debug logging để kiểm tra tính toán
                    console.log("[exportAudio] Crossfade duration calculation:");
                    console.log("  - Total tracks: ".concat(totalTracks_1));
                    console.log("  - Crossfade points: ".concat(crossfadePoints));
                    console.log("  - Crossfade duration: ".concat(crossfadeDurationSec, "s"));
                    console.log("  - Playlist total duration: ".concat(playlist.totalDurationSec.toFixed(2), "s"));
                    console.log("  - Last track duration: ".concat(lastTrackDuration.toFixed(2), "s"));
                    console.log("  - Last track remaining: ".concat(lastTrackRemainingSec_1.toFixed(2), "s"));
                    console.log("  - Estimated output duration: ".concat(estimatedOutputDurationSec_1.toFixed(2), "s"));
                    console.log("  - Formula: ".concat(playlist.totalDurationSec.toFixed(2), " - (").concat(crossfadeDurationSec, " * ").concat(crossfadePoints, ") + ").concat(lastTrackRemainingSec_1.toFixed(2), " = ").concat(estimatedOutputDurationSec_1.toFixed(2), "s"));
                    durationDiff_1 = targetDurationSec - estimatedOutputDurationSec_1;
                    if (durationDiff_1 > 5.0) {
                        console.log("[exportAudio] Playlist thi\u1EBFu ".concat(durationDiff_1.toFixed(2), "s so v\u1EDBi target (").concat(targetDurationSec.toFixed(2), "s). ") +
                            "\u0110ang t\u1EF1 \u0111\u1ED9ng th\u00EAm b\u00E0i nh\u1EA1c v\u00E0o playlist...");
                        scanResult = loadScanResult();
                        if (scanResult && scanResult.tracks.length > 0) {
                            averageTrackDuration = scanResult.tracks.reduce(function (sum, t) { return sum + t.duration; }, 0) / scanResult.tracks.length;
                            durationPerNewTrack = averageTrackDuration - crossfadeDurationSec;
                            estimatedTracksNeeded = Math.ceil(durationDiff_1 / Math.max(durationPerNewTrack, 1));
                            console.log("[exportAudio] \u01AF\u1EDBc t\u00EDnh c\u1EA7n th\u00EAm ".concat(estimatedTracksNeeded, " b\u00E0i (average: ").concat(averageTrackDuration.toFixed(1), "s, ") +
                                "duration per new track: ".concat(durationPerNewTrack.toFixed(1), "s)"));
                            usedTrackIds_2 = new Set(playlist.tracks.map(function (t) { return t.id; }));
                            availableTracks = scanResult.tracks.filter(function (t) { return !usedTrackIds_2.has(t.id); });
                            if (availableTracks.length === 0) {
                                console.warn("[exportAudio] Kh\u00F4ng c\u00F2n b\u00E0i nh\u1EA1c n\u00E0o \u0111\u1EC3 th\u00EAm v\u00E0o playlist.");
                            }
                            else {
                                tracksToAdd = [];
                                addedDuration = 0;
                                lastTrackId = ((_f = playlist.tracks[playlist.tracks.length - 1]) === null || _f === void 0 ? void 0 : _f.id) || '';
                                shuffled = __spreadArray([], availableTracks, true).sort(function () { return Math.random() - 0.5; });
                                for (_a = 0, shuffled_2 = shuffled; _a < shuffled_2.length; _a++) {
                                    track = shuffled_2[_a];
                                    if (tracksToAdd.length >= estimatedTracksNeeded + 10)
                                        break; // Thêm thêm 10 bài để đảm bảo đủ
                                    // Tránh trùng liên tiếp
                                    if (track.id === lastTrackId && shuffled.length > 1)
                                        continue;
                                    cumulativeDuration = playlist.totalDurationSec + addedDuration + track.duration;
                                    tracksToAdd.push(__assign(__assign({}, track), { order: playlist.tracks.length + tracksToAdd.length + 1, cumulativeDuration: cumulativeDuration }));
                                    addedDuration += track.duration;
                                    lastTrackId = track.id;
                                    newTotalTracks = totalTracks_1 + tracksToAdd.length;
                                    newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0;
                                    newTotalDuration = playlist.totalDurationSec + addedDuration;
                                    newLastTrackDuration = track.duration;
                                    newLastTrackRemainingSec = newLastTrackDuration > crossfadeDurationSec
                                        ? (newLastTrackDuration - crossfadeDurationSec)
                                        : 0;
                                    newEstimatedDuration = newTotalDuration
                                        - (crossfadeDurationSec * newCrossfadePoints)
                                        + newLastTrackRemainingSec;
                                    // Nếu đã đủ hoặc vượt target, dừng lại
                                    if (newEstimatedDuration >= targetDurationSec - 1.0) {
                                        break;
                                    }
                                }
                                if (tracksToAdd.length > 0) {
                                    extendedPlaylist = __assign(__assign({}, playlist), { tracks: __spreadArray(__spreadArray([], playlist.tracks, true), tracksToAdd, true), totalDurationSec: playlist.totalDurationSec + addedDuration });
                                    newTotalTracks = extendedPlaylist.tracks.length;
                                    newCrossfadePoints = newTotalTracks > 1 ? newTotalTracks - 1 : 0;
                                    newLastTrackDuration = ((_g = extendedPlaylist.tracks[extendedPlaylist.tracks.length - 1]) === null || _g === void 0 ? void 0 : _g.duration) || 0;
                                    newLastTrackRemainingSec = newLastTrackDuration > crossfadeDurationSec
                                        ? (newLastTrackDuration - crossfadeDurationSec)
                                        : 0;
                                    estimatedOutputDurationSec_1 = extendedPlaylist.totalDurationSec
                                        - (crossfadeDurationSec * newCrossfadePoints)
                                        + newLastTrackRemainingSec;
                                    console.log("[exportAudio] \u0110\u00E3 th\u00EAm ".concat(tracksToAdd.length, " b\u00E0i v\u00E0o playlist. ") +
                                        "Duration: ".concat(playlist.totalDurationSec.toFixed(1), "s -> ").concat(extendedPlaylist.totalDurationSec.toFixed(1), "s. ") +
                                        "Estimated sau crossfade: ".concat(estimatedOutputDurationSec_1.toFixed(1), "s (target: ").concat(targetDurationSec.toFixed(1), "s)"));
                                    // Dùng playlist mới
                                    playlist = extendedPlaylist;
                                    totalTracks_1 = newTotalTracks;
                                    crossfadePoints = newCrossfadePoints;
                                    lastTrackDuration = newLastTrackDuration;
                                    lastTrackRemainingSec_1 = newLastTrackRemainingSec;
                                    // Cập nhật lại inputLabels và filterLines với số tracks mới
                                    // Cần rebuild filter graph với số tracks mới
                                    // Tạm thời, sẽ rebuild ở dưới
                                }
                            }
                        }
                        else {
                            console.warn("[exportAudio] Kh\u00F4ng c\u00F3 scan result \u0111\u1EC3 th\u00EAm b\u00E0i nh\u1EA1c v\u00E0o playlist.");
                        }
                    }
                    // Progress tracking dùng estimated duration (thời lượng thực tế sau crossfade)
                    totalDurationSec_1 = estimatedOutputDurationSec_1;
                    // Emit progress ban đầu với target duration (thời lượng hiển thị trong UI)
                    // Để UI cập nhật totalSec đúng từ đầu
                    if (progressEmitter) {
                        progressEmitter({
                            playlistId: req.playlistId,
                            outputPath: outputPath_1, // outputPath đã được tính ở trên (dòng 166)
                            currentSec: 0,
                            totalSec: totalDurationSec_1,
                            percent: 0,
                        });
                    }
                    filterComplex = filterLines.join(';');
                    args_1.push('-filter_complex', filterComplex, '-map', lastLabel, '-ar', '48000', '-ac', '2');
                    if (req.format === 'mp3') {
                        args_1.push('-acodec', 'libmp3lame', '-b:a', "".concat((bitrate !== null && bitrate !== void 0 ? bitrate : 320), "k"));
                    }
                    else if (req.format === 'aac') {
                        args_1.push('-acodec', 'aac', '-b:a', "".concat((bitrate !== null && bitrate !== void 0 ? bitrate : 384), "k"));
                    }
                    else {
                        args_1.push('-acodec', 'pcm_s16le');
                    }
                    // KHÔNG dùng -t để cắt - để FFmpeg xuất hết audio thực tế
                    // Nếu muốn đúng target duration, cần thêm bài nhạc vào playlist, không phải cắt/pad
                    args_1.push(outputPath_1);
                    return [3 /*break*/, 16];
                case 11:
                    // Nếu số tracks > MAX_TRACKS_PER_BATCH, xử lý theo batch
                    console.log("[ExportAudio] Playlist c\u00F3 ".concat(totalTracks_1, " tracks, chia th\u00E0nh batch \u0111\u1EC3 tr\u00E1nh memory issue"));
                    batches = [];
                    for (i = 0; i < totalTracks_1; i += MAX_TRACKS_PER_BATCH) {
                        batches.push(playlist.tracks.slice(i, i + MAX_TRACKS_PER_BATCH));
                    }
                    batchOutputFiles = [];
                    processedDuration_1 = 0;
                    _loop_1 = function (batchIdx) {
                        var batch, batchOutputFile, batchFilterLines, batchInputLabels, batchArgs, i, label, batchLastLabel, batchTrackCount, i, nextLabel, isLastInBatch, outLabel, lastTrackInBatch, lastTrackDuration_1, lastTrackRemainingLabel, batchFilterComplex, batchResult, batchDuration;
                        return __generator(this, function (_l) {
                            switch (_l.label) {
                                case 0:
                                    batch = batches[batchIdx];
                                    batchOutputFile = path.join(tempDir, "batch-".concat(req.playlistId, "-").concat(batchIdx, "-").concat(Date.now(), ".wav"));
                                    batchOutputFiles.push(batchOutputFile);
                                    batchTempFiles.push(batchOutputFile); // Track để cleanup
                                    tempFiles.add(batchOutputFile); // Fix High #2.1: Track in Set for better cleanup
                                    batchFilterLines = [];
                                    batchInputLabels = [];
                                    batchArgs = ['-hide_banner', '-y'];
                                    batch.forEach(function (track) {
                                        batchArgs.push('-i', track.path);
                                    });
                                    // Tạo labels cho batch
                                    for (i = 0; i < batch.length; i++) {
                                        label = "a".concat(i);
                                        batchInputLabels.push("[".concat(label, "]"));
                                        batchFilterLines.push("[".concat(i, ":a]asetpts=PTS-STARTPTS[").concat(label, "]"));
                                    }
                                    batchLastLabel = batchInputLabels[0];
                                    batchTrackCount = batch.length;
                                    if (batchTrackCount === 1) {
                                        batchFilterLines.push("".concat(batchInputLabels[0], "acopy[batchout]"));
                                        batchLastLabel = '[batchout]';
                                    }
                                    else {
                                        for (i = 1; i < batchTrackCount; i++) {
                                            nextLabel = batchInputLabels[i];
                                            isLastInBatch = i === batchTrackCount - 1;
                                            outLabel = isLastInBatch ? 'batchout' : "batchfade".concat(i);
                                            batchFilterLines.push("".concat(batchLastLabel).concat(nextLabel, "acrossfade=d=").concat(crossfadeDurationSec, ":c1=tri:c2=tri[").concat(outLabel, "]"));
                                            batchLastLabel = "[".concat(outLabel, "]");
                                        }
                                        if (batchLastLabel !== '[batchout]') {
                                            batchFilterLines.push("".concat(batchLastLabel, "acopy[batchout]"));
                                            batchLastLabel = '[batchout]';
                                        }
                                    }
                                    // Xử lý bài cuối của batch (nếu không phải batch cuối cùng, không cần xử lý đặc biệt)
                                    // Nếu là batch cuối cùng, cần đảm bảo bài cuối phát hết
                                    if (batchIdx === batches.length - 1) {
                                        lastTrackInBatch = batch[batch.length - 1];
                                        lastTrackDuration_1 = (lastTrackInBatch === null || lastTrackInBatch === void 0 ? void 0 : lastTrackInBatch.duration) || 0;
                                        if (lastTrackDuration_1 > crossfadeDurationSec) {
                                            lastTrackRemainingLabel = 'batch_last_remaining';
                                            batchFilterLines.push("[".concat(batchTrackCount - 1, ":a]atrim=start=").concat(crossfadeDurationSec.toFixed(3), ",asetpts=PTS-STARTPTS[").concat(lastTrackRemainingLabel, "]"));
                                            batchFilterLines.push("[batchout][".concat(lastTrackRemainingLabel, "]concat=n=2:v=0:a=1[batchfinal]"));
                                            batchLastLabel = '[batchfinal]';
                                        }
                                    }
                                    batchFilterComplex = batchFilterLines.join(';');
                                    batchArgs.push('-filter_complex', batchFilterComplex, '-map', batchLastLabel, '-ar', '44100', '-ac', '2', '-acodec', 'pcm_s16le', // Luôn dùng WAV cho batch temp
                                    batchOutputFile);
                                    // Chạy FFmpeg cho batch này
                                    console.log("[ExportAudio] X\u1EED l\u00FD batch ".concat(batchIdx + 1, "/").concat(batches.length, " (").concat(batch.length, " tracks)..."));
                                    return [4 /*yield*/, runFfmpeg({
                                            args: batchArgs,
                                            timeoutMs: 3600000,
                                            requestId: req.requestId,
                                            signal: req.signal,
                                            onProgress: function (p) {
                                                if (!progressEmitter)
                                                    return;
                                                // Tính progress tổng thể
                                                var batchProgress = p.timeSec / (batch.reduce(function (sum, t) { return sum + t.duration; }, 0) || 1);
                                                var batchWeight = batch.length / totalTracks_1;
                                                var overallProgress = (processedDuration_1 + p.timeSec) / totalDurationSec_1;
                                                var percent = Math.max(0, Math.min(100, overallProgress * 100));
                                                progressEmitter({
                                                    playlistId: req.playlistId,
                                                    outputPath: outputPath_1,
                                                    currentSec: processedDuration_1 + p.timeSec,
                                                    totalSec: totalDurationSec_1,
                                                    percent: percent,
                                                });
                                            },
                                        })];
                                case 1:
                                    batchResult = _l.sent();
                                    if (batchResult.code !== 0) {
                                        // Fix High #2.1: Cleanup all temp files when batch fails
                                        tempFiles.forEach(function (f) {
                                            if (fs.existsSync(f)) {
                                                try {
                                                    fs.unlinkSync(f);
                                                }
                                                catch (_a) { }
                                            }
                                        });
                                        return [2 /*return*/, { value: {
                                                    success: false,
                                                    error: "Batch ".concat(batchIdx + 1, " failed: ").concat(batchResult.stderr || 'Unknown error'),
                                                } }];
                                    }
                                    batchDuration = batch.reduce(function (sum, t) { return sum + t.duration; }, 0);
                                    processedDuration_1 += batchDuration;
                                    return [2 /*return*/];
                            }
                        });
                    };
                    batchIdx = 0;
                    _j.label = 12;
                case 12:
                    if (!(batchIdx < batches.length)) return [3 /*break*/, 15];
                    return [5 /*yield**/, _loop_1(batchIdx)];
                case 13:
                    state_1 = _j.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    _j.label = 14;
                case 14:
                    batchIdx++;
                    return [3 /*break*/, 12];
                case 15:
                    // Concat tất cả các batch lại
                    console.log("[ExportAudio] Concat ".concat(batches.length, " batches..."));
                    concatListFile = path.join(tempDir, "concat-batches-".concat(req.playlistId, "-").concat(Date.now(), ".txt"));
                    tempFiles.add(concatListFile); // Fix High #2.1: Track for cleanup
                    concatLines = batchOutputFiles.map(function (f) {
                        var normalizedPath = f.replace(/\\/g, '/').replace(/'/g, "\\'");
                        return "file '".concat(normalizedPath, "'");
                    });
                    fs.writeFileSync(concatListFile, concatLines.join('\n'), 'utf-8');
                    // Tạo args để concat các batch
                    args_1 = [
                        '-hide_banner',
                        '-y',
                        '-f',
                        'concat',
                        '-safe',
                        '0',
                        '-i',
                        concatListFile,
                        '-vn',
                        '-ar',
                        '48000',
                        '-ac',
                        '2',
                    ];
                    if (req.format === 'mp3') {
                        args_1.push('-acodec', 'libmp3lame', '-b:a', "".concat((bitrate !== null && bitrate !== void 0 ? bitrate : 320), "k"));
                    }
                    else if (req.format === 'aac') {
                        args_1.push('-acodec', 'aac', '-b:a', "".concat((bitrate !== null && bitrate !== void 0 ? bitrate : 384), "k"));
                    }
                    else {
                        args_1.push('-acodec', 'pcm_s16le');
                    }
                    // KHÔNG dùng -t để cắt - để FFmpeg xuất hết audio thực tế
                    // Nếu muốn đúng target duration, cần thêm bài nhạc vào playlist, không phải cắt/pad
                    args_1.push(outputPath_1);
                    _j.label = 16;
                case 16:
                    // 7. Chạy FFmpeg
                    console.log('[ExportAudio] Running FFmpeg with args:', args_1);
                    requestId = req.requestId;
                    return [4 /*yield*/, runFfmpeg({
                            args: args_1,
                            timeoutMs: 3600000, // 1 hour timeout
                            requestId: requestId, // Pass requestId để register vào videoJobManager
                            signal: req.signal, // Pass AbortSignal từ jobQueue context
                            onStderrChunk: function (chunk) {
                                // Log progress (FFmpeg thường log vào stderr)
                                process.stdout.write(chunk);
                            },
                            onProgress: function (p) {
                                if (!totalDurationSec_1 || !progressEmitter)
                                    return;
                                var percent = Math.max(0, Math.min(100, (p.timeSec / totalDurationSec_1) * 100));
                                progressEmitter({
                                    playlistId: req.playlistId,
                                    outputPath: outputPath_1,
                                    currentSec: p.timeSec,
                                    totalSec: totalDurationSec_1,
                                    percent: percent,
                                });
                            },
                        })
                        // 8. Kiểm tra kết quả
                    ];
                case 17:
                    result = _j.sent();
                    if (!(result.code === 0 && fs.existsSync(outputPath_1))) return [3 /*break*/, 22];
                    // Đảm bảo emit progress 100% khi hoàn thành (tránh progress đứng ở ~99%)
                    if (progressEmitter && totalDurationSec_1) {
                        progressEmitter({
                            playlistId: req.playlistId,
                            outputPath: outputPath_1,
                            currentSec: totalDurationSec_1,
                            totalSec: totalDurationSec_1,
                            percent: 100,
                        });
                    }
                    actualDurationSec = totalDurationSec_1;
                    _j.label = 18;
                case 18:
                    _j.trys.push([18, 20, , 21]);
                    return [4 /*yield*/, probeFile(outputPath_1)];
                case 19:
                    probed = _j.sent();
                    if (((_h = probed.format) === null || _h === void 0 ? void 0 : _h.duration) && probed.format.duration > 0) {
                        actualDurationSec = probed.format.duration;
                    }
                    return [3 /*break*/, 21];
                case 20:
                    err_1 = _j.sent();
                    console.warn('[ExportAudio] Could not probe output file duration, using estimated:', err_1);
                    return [3 /*break*/, 21];
                case 21:
                    // KHÔNG pad silence - đây là dối trá!
                    // Nếu duration thiếu, cần thêm bài nhạc vào playlist khi tạo playlist, không phải pad silence ở đây
                    // Log warning nếu duration thiếu nhiều
                    if (smoothTransitions && actualDurationSec < targetDurationSec - 5.0) {
                        diffSec = targetDurationSec - actualDurationSec;
                        console.warn("[ExportAudio] WARNING: File xu\u1EA5t ra thi\u1EBFu ".concat(diffSec.toFixed(2), "s so v\u1EDBi target (").concat(targetDurationSec.toFixed(2), "s). ") +
                            "C\u1EA7n th\u00EAm b\u00E0i nh\u1EA1c v\u00E0o playlist \u0111\u1EC3 \u0111\u1EA1t target duration. " +
                            "Actual duration: ".concat(actualDurationSec.toFixed(2), "s"));
                    }
                    successResult = {
                        success: true,
                        outputPath: outputPath_1,
                        durationSec: actualDurationSec,
                    };
                    // Lưu lịch sử export (tất cả các đợt)
                    try {
                        addHistoryEntry({
                            playlistId: playlist.id,
                            playlistName: playlist.name,
                            outputPath: outputPath_1,
                            tracks: playlist.tracks.map(function (t) {
                                var _a;
                                return ({
                                    name: t.fileName,
                                    path: t.path,
                                    durationSec: t.duration,
                                    startSec: (_a = t.cumulativeDuration) !== null && _a !== void 0 ? _a : 0,
                                });
                            }),
                        });
                    }
                    catch (err) {
                        console.warn('[ExportAudio] Failed to record export history:', err);
                    }
                    return [2 /*return*/, successResult];
                case 22: return [2 /*return*/, {
                        success: false,
                        error: result.stderr || 'FFmpeg export failed',
                    }];
                case 23: return [3 /*break*/, 26];
                case 24:
                    err_2 = _j.sent();
                    console.error('[ExportAudio] exportPlaylistToFile error:', err_2);
                    return [2 /*return*/, {
                            success: false,
                            error: (err_2 === null || err_2 === void 0 ? void 0 : err_2.message) || 'Lỗi không xác định khi xuất playlist.',
                        }];
                case 25:
                    // Fix High #2.1: Cleanup all temp files comprehensively
                    try {
                        // Cleanup all tracked temp files
                        tempFiles.forEach(function (f) {
                            try {
                                if (fs.existsSync(f)) {
                                    fs.unlinkSync(f);
                                }
                            }
                            catch (err) {
                                console.warn("[ExportAudio] Failed to delete temp file ".concat(f, ":"), err);
                            }
                        });
                        // Also cleanup batch temp files (backward compatibility)
                        batchTempFiles.forEach(function (f) {
                            if (!tempFiles.has(f) && fs.existsSync(f)) {
                                try {
                                    fs.unlinkSync(f);
                                }
                                catch (err) {
                                    console.warn("[ExportAudio] Failed to delete batch temp file ".concat(f, ":"), err);
                                }
                            }
                        });
                        // Cleanup listFile and concatListFile if not already in tempFiles
                        if (listFile && !tempFiles.has(listFile) && fs.existsSync(listFile)) {
                            try {
                                fs.unlinkSync(listFile);
                            }
                            catch (err) {
                                console.warn('[ExportAudio] Failed to delete temp list file:', err);
                            }
                        }
                        if (concatListFile && !tempFiles.has(concatListFile) && fs.existsSync(concatListFile)) {
                            try {
                                fs.unlinkSync(concatListFile);
                            }
                            catch (err) {
                                console.warn('[ExportAudio] Failed to delete concat list file:', err);
                            }
                        }
                    }
                    catch (err) {
                        console.warn('[ExportAudio] Error during temp files cleanup:', err);
                    }
                    return [7 /*endfinally*/];
                case 26: return [2 /*return*/];
            }
        });
    });
}
/**
 * Kiểm tra các track trong playlist có phù hợp để chạy crossfade không.
 * - Decode thử 2s đầu của từng file bằng FFmpeg: nếu FFmpeg lỗi → mark là track lỗi.
 * - KHÔNG xuất file, chỉ trả về danh sách issues để UI hiển thị.
 */
export function validatePlaylistForCrossfade(playlistId) {
    return __awaiter(this, void 0, void 0, function () {
        var playlist, issues, _i, _a, track, srcPath, args, result, err_3;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    playlist = getPlaylistById(playlistId);
                    if (!playlist) {
                        return [2 /*return*/, {
                                playlistId: playlistId,
                                playlistName: '(unknown)',
                                issues: [
                                    {
                                        trackPath: '',
                                        trackName: '',
                                        reason: 'Playlist không tồn tại.',
                                    },
                                ],
                            }];
                    }
                    issues = [];
                    _i = 0, _a = playlist.tracks;
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 6];
                    track = _a[_i];
                    srcPath = track.path;
                    if (!srcPath || !fs.existsSync(srcPath)) {
                        issues.push({
                            trackPath: srcPath,
                            trackName: track.fileName || path.basename(srcPath || '(unknown)'),
                            reason: 'File không tồn tại trên đĩa.',
                        });
                        return [3 /*break*/, 5];
                    }
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    args = [
                        '-hide_banner',
                        '-loglevel',
                        'error',
                        '-t',
                        '2', // decode thử 2 giây đầu
                        '-i',
                        srcPath,
                        '-f',
                        'null',
                        '-',
                    ];
                    return [4 /*yield*/, runFfmpeg({
                            args: args,
                            timeoutMs: 60000,
                        })];
                case 3:
                    result = _b.sent();
                    if (result.code !== 0) {
                        issues.push({
                            trackPath: srcPath,
                            trackName: track.fileName || path.basename(srcPath),
                            reason: result.stderr || 'FFmpeg báo lỗi khi decode file (crossfade pre-check).',
                        });
                    }
                    return [3 /*break*/, 5];
                case 4:
                    err_3 = _b.sent();
                    issues.push({
                        trackPath: srcPath,
                        trackName: track.fileName || path.basename(srcPath),
                        reason: (err_3 === null || err_3 === void 0 ? void 0 : err_3.message) || 'Lỗi không xác định khi decode file.',
                    });
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6: return [2 /*return*/, {
                        playlistId: playlist.id,
                        playlistName: playlist.name,
                        issues: issues,
                    }];
            }
        });
    });
}
/**
 * Validate nhiều playlist cùng lúc cho crossfade
 */
export function validatePlaylistsForCrossfade(req) {
    return __awaiter(this, void 0, void 0, function () {
        var results, _i, _a, playlistId, checkResult, totalWithIssues;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    results = [];
                    _i = 0, _a = req.playlistIds;
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    playlistId = _a[_i];
                    return [4 /*yield*/, validatePlaylistForCrossfade(playlistId)];
                case 2:
                    checkResult = _b.sent();
                    results.push(checkResult);
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    totalWithIssues = results.filter(function (r) { return r.issues.length > 0; }).length;
                    return [2 /*return*/, {
                            results: results,
                            totalChecked: results.length,
                            totalWithIssues: totalWithIssues,
                        }];
            }
        });
    });
}
