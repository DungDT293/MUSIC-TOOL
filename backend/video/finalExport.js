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
import { spawn } from 'child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getFfmpegPaths } from '../ffmpeg/config';
import { probeFile } from '../ffmpeg/probe';
import { transcribeAudio } from '../audio/whisperTranscribe';
import { generateSubtitleFile } from '../audio/subtitleGenerator';
import { validateInputFiles } from './videoUtils';
import { videoJobManager } from './videoJobManager';
import { verifyOutputVideo } from './outputVerification';
import { runPlaybackTest } from './playbackTest';
import { getDiskSpace, formatBytes } from '../utils/diskSpace';
import { buildVideoEncoderArgs, getGpuInfo } from '../utils/gpuDetection';
import { buildPlaylistToFillDuration, shuffleOnce, } from './utils/videoShuffleHelpers';
import { getRecentHistory } from '../music/exportHistory';
var AUDIO_EXTS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg']);
var VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm']);
function escapePathForFfmpegList(filePath) {
    return filePath.replace(/'/g, "'\\''");
}
function sanitizeFilename(name) {
    // Loại bỏ các ký tự không hợp lệ trong tên file Windows
    // Đặc biệt: chỉ thay "|" thành " _ " (có khoảng trắng xung quanh để format đẹp)
    // Format mong muốn: "1 Tomorrowland 2025 _ Tiësto, ..."
    // Bước 1: Thay "|" thành " _ " (có khoảng trắng xung quanh)
    var result = name.replace(/\|/g, ' _ ');
    // Bước 2: Thay các ký tự không hợp lệ khác bằng "_" (trừ dấu cách)
    result = result.replace(/[<>:"/\\?*\x00-\x1F]/g, '_');
    // Bước 3: Gộp nhiều khoảng trắng liên tiếp thành 1 khoảng trắng
    result = result.replace(/\s+/g, ' ');
    // Bước 4: Gộp nhiều "_" liên tiếp thành 1 "_"
    // Nhưng cần cẩn thận để không làm mất " _ " đã tạo từ "|"
    // Cách đơn giản: chỉ gộp các "_" không có khoảng trắng xung quanh
    result = result.replace(/([^ ])_+([^ ])/g, '$1_$2'); // Gộp _ giữa 2 ký tự không phải khoảng trắng
    result = result.replace(/([^ ])_+$/g, '$1_'); // Gộp _ ở cuối
    result = result.replace(/^_+([^ ])/g, '_$1'); // Gộp _ ở đầu
    // Bước 5: Loại bỏ _ và khoảng trắng ở đầu và cuối
    result = result.replace(/^[\s_]+|[\s_]+$/g, '');
    return result.trim();
}
function buildTracklistPath(outputPath) {
    var dir = path.dirname(outputPath);
    var base = path.basename(outputPath, path.extname(outputPath));
    return path.join(dir, "".concat(base, "_tracklist.txt"));
}
function formatTimeForTracklist(seconds) {
    var total = Math.floor(seconds);
    var minutes = Math.floor(total / 60);
    var secs = total % 60;
    return "".concat(minutes.toString().padStart(2, '0'), ":").concat(secs.toString().padStart(2, '0'));
}
/**
 * Tìm tracklist từ export history dựa trên audio path
 * Trả về tracklist text (mm:ss + tên bài) hoặc undefined nếu không tìm thấy
 */
function generateTracklistFromHistory(audioPath) {
    try {
        var history_1 = getRecentHistory();
        // Tìm entry có outputPath khớp với audioPath
        var matchingEntry = history_1.find(function (entry) {
            // So sánh đường dẫn (normalize để tránh vấn đề case sensitivity và path separator)
            var entryPath = path.resolve(entry.outputPath).toLowerCase();
            var audioPathResolved = path.resolve(audioPath).toLowerCase();
            return entryPath === audioPathResolved;
        });
        if (!matchingEntry || !matchingEntry.tracks || matchingEntry.tracks.length === 0) {
            console.log("[FinalExport] Kh\u00F4ng t\u00ECm th\u1EA5y tracklist cho audio: ".concat(audioPath));
            return undefined;
        }
        // Format tracklist: mm:ss + tên bài (không có đuôi file)
        var lines = matchingEntry.tracks.map(function (track) {
            var timeStr = formatTimeForTracklist(track.startSec);
            // Loại bỏ đuôi file từ tên bài hát
            var name = track.name || path.basename(track.path, path.extname(track.path));
            // Nếu name có extension, loại bỏ nó
            if (name && path.extname(name)) {
                name = path.basename(name, path.extname(name));
            }
            return "".concat(timeStr, " ").concat(name);
        });
        var tracklistText = lines.join('\n');
        console.log("[FinalExport] T\u00ECm th\u1EA5y tracklist cho audio: ".concat(audioPath, " (").concat(matchingEntry.tracks.length, " tracks)"));
        return tracklistText;
    }
    catch (error) {
        console.warn("[FinalExport] L\u1ED7i khi t\u00ECm tracklist cho audio: ".concat(audioPath), error);
        return undefined;
    }
}
function buildOutputNameFromAudio(audioPath, targetExt) {
    var base = path.basename(audioPath, path.extname(audioPath));
    var sanitized = sanitizeFilename(base) || 'audio';
    var normalizedExt = (targetExt === null || targetExt === void 0 ? void 0 : targetExt.startsWith('.')) ? targetExt : ".".concat(targetExt || 'mp4');
    return "".concat(sanitized).concat(normalizedExt);
}
function parseTimeFromChunk(chunk) {
    var match = chunk.match(/time=([0-9:.]+)/);
    if (!match)
        return null;
    var _a = match[1].split(':'), hours = _a[0], minutes = _a[1], seconds = _a[2];
    var h = parseFloat(hours !== null && hours !== void 0 ? hours : '0');
    var m = parseFloat(minutes !== null && minutes !== void 0 ? minutes : '0');
    var s = parseFloat(seconds !== null && seconds !== void 0 ? seconds : '0');
    if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s))
        return null;
    return h * 3600 + m * 60 + s;
}
function parseSpeedFromChunk(chunk) {
    var match = chunk.match(/speed=\s*([0-9.]+)x/);
    if (!match)
        return null;
    var speed = parseFloat(match[1]);
    return Number.isNaN(speed) ? null : speed;
}
function ensureTempDir(baseName) {
    return __awaiter(this, void 0, void 0, function () {
        var dir;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fsp.mkdtemp(path.join(os.tmpdir(), baseName))];
                case 1:
                    dir = _a.sent();
                    return [2 /*return*/, dir];
            }
        });
    });
}
function ensurePathKind(p, kind) {
    return __awaiter(this, void 0, void 0, function () {
        var stat, error_1, message;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, fsp.stat(p)];
                case 1:
                    stat = _a.sent();
                    if (kind === 'file' && !stat.isFile()) {
                        throw new Error("\u0110\u01B0\u1EDDng d\u1EABn kh\u00F4ng ph\u1EA3i file: ".concat(p));
                    }
                    if (kind === 'dir' && !stat.isDirectory()) {
                        throw new Error("\u0110\u01B0\u1EDDng d\u1EABn kh\u00F4ng ph\u1EA3i th\u01B0 m\u1EE5c: ".concat(p));
                    }
                    return [3 /*break*/, 3];
                case 2:
                    error_1 = _a.sent();
                    message = kind === 'file'
                        ? "Kh\u00F4ng t\u00ECm th\u1EA5y file: ".concat(p)
                        : "Kh\u00F4ng t\u00ECm th\u1EA5y th\u01B0 m\u1EE5c: ".concat(p);
                    throw new Error(message);
                case 3: return [2 /*return*/];
            }
        });
    });
}
function loadAudioFiles(source) {
    return __awaiter(this, void 0, void 0, function () {
        var audioFiles, collectFromPaths, list, entries, paths, _i, entries_1, entry, ext;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    audioFiles = [];
                    collectFromPaths = function (paths) { return __awaiter(_this, void 0, void 0, function () {
                        var _i, paths_1, filePath, info, duration, codecName, error_2;
                        var _a, _b, _c, _d;
                        return __generator(this, function (_e) {
                            switch (_e.label) {
                                case 0:
                                    _i = 0, paths_1 = paths;
                                    _e.label = 1;
                                case 1:
                                    if (!(_i < paths_1.length)) return [3 /*break*/, 7];
                                    filePath = paths_1[_i];
                                    return [4 /*yield*/, ensurePathKind(filePath, 'file')];
                                case 2:
                                    _e.sent();
                                    _e.label = 3;
                                case 3:
                                    _e.trys.push([3, 5, , 6]);
                                    return [4 /*yield*/, probeFile(filePath)];
                                case 4:
                                    info = _e.sent();
                                    duration = (_b = (_a = info === null || info === void 0 ? void 0 : info.format) === null || _a === void 0 ? void 0 : _a.duration) !== null && _b !== void 0 ? _b : 0;
                                    codecName = (_d = (_c = info === null || info === void 0 ? void 0 : info.audio) === null || _c === void 0 ? void 0 : _c.codec) !== null && _d !== void 0 ? _d : null;
                                    if (!duration || duration <= 0) {
                                        console.warn('[FinalExport] Bỏ qua audio duration <= 0:', filePath);
                                        return [3 /*break*/, 6];
                                    }
                                    audioFiles.push({ path: filePath, durationSec: duration, codecName: codecName });
                                    return [3 /*break*/, 6];
                                case 5:
                                    error_2 = _e.sent();
                                    console.warn('[FinalExport] Bỏ qua audio lỗi:', filePath, error_2);
                                    return [3 /*break*/, 6];
                                case 6:
                                    _i++;
                                    return [3 /*break*/, 1];
                                case 7: return [2 /*return*/];
                            }
                        });
                    }); };
                    if (!(source.type === 'file')) return [3 /*break*/, 2];
                    return [4 /*yield*/, collectFromPaths([source.path])];
                case 1:
                    _a.sent();
                    return [3 /*break*/, 9];
                case 2:
                    if (!(source.type === 'files')) return [3 /*break*/, 4];
                    list = source.paths && source.paths.length > 0 ? source.paths : [source.path];
                    return [4 /*yield*/, collectFromPaths(Array.from(new Set(list)))];
                case 3:
                    _a.sent();
                    return [3 /*break*/, 9];
                case 4:
                    if (!(source.type === 'folder')) return [3 /*break*/, 8];
                    return [4 /*yield*/, ensurePathKind(source.path, 'dir')];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, fsp.readdir(source.path, { withFileTypes: true })];
                case 6:
                    entries = _a.sent();
                    paths = [];
                    for (_i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                        entry = entries_1[_i];
                        if (!entry.isFile())
                            continue;
                        ext = path.extname(entry.name).toLowerCase();
                        if (!AUDIO_EXTS.has(ext))
                            continue;
                        paths.push(path.join(source.path, entry.name));
                    }
                    return [4 /*yield*/, collectFromPaths(Array.from(new Set(paths)))];
                case 7:
                    _a.sent();
                    return [3 /*break*/, 9];
                case 8: throw new Error('Loại nguồn audio không được hỗ trợ.');
                case 9:
                    if (audioFiles.length === 0) {
                        throw new Error('Không tìm thấy file audio hợp lệ.');
                    }
                    audioFiles.sort(function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }); });
                    return [2 /*return*/, audioFiles];
            }
        });
    });
}
function prepareAudioForOutput(audioFile, pairTempDir, targetExt) {
    return __awaiter(this, void 0, void 0, function () {
        var normalizedExt, codec, needsAac, safeName, tempPath, ffmpeg;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    normalizedExt = targetExt.toLowerCase();
                    codec = (_b = (_a = audioFile.codecName) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : null;
                    needsAac = (normalizedExt === '.mp4' || normalizedExt === '.m4v' || normalizedExt === '.mov') &&
                        codec !== 'aac';
                    if (!needsAac) {
                        return [2 /*return*/, {
                                preparedPath: audioFile.path,
                                audioCodec: audioFile.codecName,
                            }];
                    }
                    return [4 /*yield*/, fsp.mkdir(pairTempDir, { recursive: true })];
                case 1:
                    _c.sent();
                    safeName = sanitizeFilename(path.basename(audioFile.path, path.extname(audioFile.path)));
                    tempPath = path.join(pairTempDir, "".concat(safeName || 'audio', "-").concat(randomUUID(), ".m4a"));
                    ffmpeg = getFfmpegPaths().ffmpeg;
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var child = spawn(ffmpeg, [
                                '-hide_banner',
                                '-loglevel',
                                'error',
                                '-i',
                                audioFile.path,
                                '-c:a',
                                'aac',
                                '-b:a',
                                '192k',
                                '-ac',
                                '2',
                                '-y',
                                tempPath,
                            ]);
                            child.on('error', reject);
                            child.on('close', function (code) {
                                if (code === 0)
                                    resolve();
                                else
                                    reject(new Error("FFmpeg l\u1ED7i khi chu\u1EA9n ho\u00E1 audio ".concat(audioFile.path, " (code ").concat(code, ").")));
                            });
                        })];
                case 2:
                    _c.sent();
                    return [2 /*return*/, {
                            preparedPath: tempPath,
                            audioCodec: 'aac',
                        }];
            }
        });
    });
}
function loadVideoClips(source) {
    return __awaiter(this, void 0, void 0, function () {
        var videoPaths, list, entries, _i, entries_2, entry, ext, valid;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    videoPaths = [];
                    if (!(source.type === 'file')) return [3 /*break*/, 1];
                    videoPaths = [source.path];
                    return [3 /*break*/, 6];
                case 1:
                    if (!(source.type === 'files')) return [3 /*break*/, 2];
                    list = source.paths && source.paths.length > 0 ? source.paths : [source.path];
                    videoPaths = Array.from(new Set(list));
                    return [3 /*break*/, 6];
                case 2:
                    if (!(source.type === 'folder')) return [3 /*break*/, 5];
                    return [4 /*yield*/, ensurePathKind(source.path, 'dir')];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, fsp.readdir(source.path, { withFileTypes: true })];
                case 4:
                    entries = _a.sent();
                    for (_i = 0, entries_2 = entries; _i < entries_2.length; _i++) {
                        entry = entries_2[_i];
                        if (!entry.isFile())
                            continue;
                        ext = path.extname(entry.name).toLowerCase();
                        if (!VIDEO_EXTS.has(ext))
                            continue;
                        videoPaths.push(path.join(source.path, entry.name));
                    }
                    videoPaths = Array.from(new Set(videoPaths));
                    return [3 /*break*/, 6];
                case 5: throw new Error('Loại nguồn video không được hỗ trợ.');
                case 6:
                    if (videoPaths.length === 0) {
                        throw new Error('Không tìm thấy clip video hợp lệ.');
                    }
                    return [4 /*yield*/, validateInputFiles(videoPaths, 8)];
                case 7:
                    valid = (_a.sent()).valid;
                    if (valid.length === 0) {
                        throw new Error('Không clip video nào có duration hợp lệ.');
                    }
                    valid.sort(function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }); });
                    return [2 /*return*/, { clips: valid }];
            }
        });
    });
}
// PHASE 4: Planning helper functions
/**
 * Scan audio source và trả về AudioSourceItem[]
 * Support: file, folder, hoặc array paths
 */
function scanAudioSourceForPlan(audioSource) {
    return __awaiter(this, void 0, void 0, function () {
        var audioFiles;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, loadAudioFiles(audioSource)];
                case 1:
                    audioFiles = _a.sent();
                    return [2 /*return*/, audioFiles.map(function (f) { return ({
                            path: f.path,
                            durationSec: f.durationSec,
                        }); })];
            }
        });
    });
}
/**
 * Scan video source và trả về VideoClipItem[]
 * Support: file, folder, hoặc array paths
 */
function scanVideoSourceForPlan(videoSource) {
    return __awaiter(this, void 0, void 0, function () {
        var videoClips;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, loadVideoClips(videoSource)];
                case 1:
                    videoClips = _a.sent();
                    return [2 /*return*/, videoClips.clips.map(function (c) { return ({
                            path: c.path,
                            durationSec: c.durationSec,
                            sizeBytes: typeof c.sizeBytes === 'number' ? c.sizeBytes : null,
                        }); })];
            }
        });
    });
}
/**
 * Helper: Get output filename
 * - Nếu 1 audio → dùng baseName
 * - Nếu nhiều audio → basename(audio.path) + '.mp4'
 */
function getOutputFileName(audio, index, totalAudio, baseName, customName) {
    // Nếu có custom name từ outputNames array
    if (customName) {
        var sanitized = sanitizeFilename(customName);
        return sanitized.endsWith('.mp4') ? sanitized : "".concat(sanitized, ".mp4");
    }
    if (totalAudio === 1) {
        // Single audio: dùng baseName, đảm bảo có extension .mp4
        var sanitized = sanitizeFilename(baseName) || 'output';
        return sanitized.endsWith('.mp4') ? sanitized : "".concat(sanitized, ".mp4");
    }
    else {
        // Multiple audio: dùng basename(audio.path) + '.mp4'
        var base = path.basename(audio.path, path.extname(audio.path));
        var sanitized = sanitizeFilename(base) || 'audio';
        return "".concat(sanitized, ".mp4");
    }
}
/**
 * PHASE 4: Plan final export - tạo ExportPlan từ audio/video sources
 *
 * - Probe audio/video chỉ 1 lần ở đây
 * - KHÔNG chạy FFmpeg trong planner
 * - Mỗi audio = 1 job riêng
 */
export function planFinalExport(audioSource, videoSource, outputFolder, baseOutputFilename, outputNames, priorityVideoSource) {
    return __awaiter(this, void 0, void 0, function () {
        var err_1, audioItems, videoClips, priorityVideoClips, error_3, jobs, totalAudioDurationSec, totalVideoDurationSec;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, fsp.mkdir(outputFolder, { recursive: true })];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, fsp.access(outputFolder, fs.constants.W_OK)];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _a.sent();
                    throw new Error("Kh\u00F4ng ghi \u0111\u01B0\u1EE3c v\u00E0o th\u01B0 m\u1EE5c output: ".concat(outputFolder, ". L\u1ED7i: ").concat((err_1 === null || err_1 === void 0 ? void 0 : err_1.message) || err_1));
                case 4: return [4 /*yield*/, scanAudioSourceForPlan(audioSource)];
                case 5:
                    audioItems = _a.sent();
                    if (audioItems.length === 0) {
                        throw new Error('Không có file audio hợp lệ.');
                    }
                    return [4 /*yield*/, scanVideoSourceForPlan(videoSource)];
                case 6:
                    videoClips = _a.sent();
                    if (!priorityVideoSource) return [3 /*break*/, 10];
                    _a.label = 7;
                case 7:
                    _a.trys.push([7, 9, , 10]);
                    return [4 /*yield*/, scanVideoSourceForPlan(priorityVideoSource)];
                case 8:
                    priorityVideoClips = _a.sent();
                    return [3 /*break*/, 10];
                case 9:
                    error_3 = _a.sent();
                    console.warn('[FinalExport] Không quét được thư mục video ưu tiên, sẽ bỏ qua priority clips:', error_3);
                    priorityVideoClips = undefined;
                    return [3 /*break*/, 10];
                case 10:
                    if (videoClips.length === 0) {
                        throw new Error('Không có clip video hợp lệ.');
                    }
                    // Medium: Validate audio/video count match khi dùng nguồn file
                    if (audioSource.type === 'files' &&
                        videoSource.type === 'files' &&
                        videoClips.length < audioItems.length) {
                        throw new Error("S\u1ED1 video (".concat(videoClips.length, ") \u00EDt h\u01A1n s\u1ED1 audio (").concat(audioItems.length, "). H\u00E3y b\u1ED5 sung video ho\u1EB7c b\u1EADt shuffle \u0111\u1EC3 reuse."));
                    }
                    jobs = audioItems.map(function (audio, index) {
                        var customName = outputNames && outputNames[index] ? outputNames[index] : undefined;
                        var outputFileName = getOutputFileName(audio, index, audioItems.length, baseOutputFilename, customName);
                        return {
                            jobIndex: index,
                            audio: audio,
                            outputPath: path.join(outputFolder, outputFileName),
                            outputFileName: outputFileName,
                            customOutputName: customName,
                        };
                    });
                    totalAudioDurationSec = audioItems.reduce(function (sum, a) { return sum + a.durationSec; }, 0);
                    totalVideoDurationSec = videoClips.reduce(function (sum, v) { return sum + v.durationSec; }, 0);
                    return [2 /*return*/, {
                            jobs: jobs,
                            totalJobs: jobs.length,
                            totalAudioDurationSec: totalAudioDurationSec,
                            totalVideoDurationSec: totalVideoDurationSec,
                            videoClips: videoClips,
                            priorityVideoClips: priorityVideoClips,
                        }];
            }
        });
    });
}
/**
 * PHASE 5: Probe audio codec để quyết định có cần encode không
 */
function probeAudioCodec(audioPath) {
    return __awaiter(this, void 0, void 0, function () {
        var info, error_4;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, probeFile(audioPath)];
                case 1:
                    info = _c.sent();
                    return [2 /*return*/, (_b = (_a = info === null || info === void 0 ? void 0 : info.audio) === null || _a === void 0 ? void 0 : _a.codec) !== null && _b !== void 0 ? _b : null];
                case 2:
                    error_4 = _c.sent();
                    console.warn('[FinalExport] Failed to probe audio codec:', audioPath, error_4);
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * PHASE 5: Execute final export - chạy từng job trong ExportPlan
 *
 * - Mỗi job dùng TOÀN BỘ videoClips pool (không chia subset)
 * - Audio codec check: AAC/MP3 → copy, WAV/PCM → encode aac
 * - Progress: percentJob + percentTotal
 * - KHÔNG concat audio lại
 */
export function executeFinalExport(plan_1, requestId_1, emitter_1) {
    return __awaiter(this, arguments, void 0, function (plan, requestId, emitter, shuffle, forceReencode, normalizeAudio, tracklistAuto, subtitle) {
        var tempDir, _i, _a, job, tracklistText, baseClips_1, priorityClips_1, priorityPathSet_1, nonPriorityClips_1, canMapOneToOne_1, processJob, _b, _c, job, tracklistPaths_1, _d, _e, job, error_5;
        var _this = this;
        var _f;
        if (shuffle === void 0) { shuffle = false; }
        if (forceReencode === void 0) { forceReencode = false; }
        if (normalizeAudio === void 0) { normalizeAudio = false; }
        if (tracklistAuto === void 0) { tracklistAuto = false; }
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    console.log('[FinalExport] executeFinalExport called with subtitle:', subtitle ? JSON.stringify({
                        enabled: subtitle.enabled,
                        useWhisper: subtitle.useWhisper,
                        autoLyrics: subtitle.autoLyrics,
                        subtitleStyle: subtitle.subtitleStyle,
                        hasText: !!subtitle.text,
                    }) : 'undefined');
                    return [4 /*yield*/, ensureTempDir("final-export-".concat(requestId, "-"))];
                case 1:
                    tempDir = _g.sent();
                    _g.label = 2;
                case 2:
                    _g.trys.push([2, 7, 8, 10]);
                    // Generate tracklist cho từng job nếu tracklistAuto = true
                    if (tracklistAuto) {
                        for (_i = 0, _a = plan.jobs; _i < _a.length; _i++) {
                            job = _a[_i];
                            tracklistText = generateTracklistFromHistory(job.audio.path);
                            if (tracklistText) {
                                job.tracklistText = tracklistText;
                                console.log("[FinalExport] Generated tracklist for job ".concat(job.jobIndex + 1, ": ").concat(job.outputFileName));
                            }
                        }
                    }
                    baseClips_1 = plan.videoClips.map(function (v) {
                        var _a;
                        return ({
                            path: v.path,
                            durationSec: v.durationSec,
                            id: v.path,
                            sizeBytes: (_a = v.sizeBytes) !== null && _a !== void 0 ? _a : undefined,
                        });
                    });
                    priorityClips_1 = ((_f = plan.priorityVideoClips) !== null && _f !== void 0 ? _f : []).map(function (v) {
                        var _a;
                        return ({
                            path: v.path,
                            durationSec: v.durationSec,
                            id: v.path,
                            sizeBytes: (_a = v.sizeBytes) !== null && _a !== void 0 ? _a : undefined,
                        });
                    });
                    priorityPathSet_1 = priorityClips_1.length > 0 ? new Set(priorityClips_1.map(function (c) { return c.path; })) : null;
                    nonPriorityClips_1 = priorityPathSet_1 && priorityPathSet_1.size > 0
                        ? baseClips_1.filter(function (c) { return !priorityPathSet_1.has(c.path); })
                        : baseClips_1;
                    canMapOneToOne_1 = !shuffle && baseClips_1.length >= plan.jobs.length;
                    if (canMapOneToOne_1) {
                        console.log('[FinalExport] Số lượng video >= audio, sẽ map 1-1 theo thứ tự (không shuffle).');
                    }
                    processJob = function (job) { return __awaiter(_this, void 0, void 0, function () {
                        var jobIndex, currentJobIndex, targetDurationSec, videoPlaylist, useShuffle, priorityForThisJob, priorityDuration, remainingTarget, loopPlaylist, mappedClip, stillRemaining, additional, loopSource, loopSource, sourceClipsForJob, shouldShuffle, mappedClip, videoListFile, listContent, audioCodec, codecLower, needAudioEncode, estimatedOutputBytes, subtitleToUse, tempVideoPath, willUseTwoStep, subtitleText, title, artist, album, lyrics, audioMetadata, tags, error_6, needsTimestamps, shouldUseWhisper, whisperLanguage, whisperResult, firstChunk, firstWord, subtitleFormat, tempDir_1, subtitleFile, fileSize, fileContent, lines, e_1, subtitleError_1, errorMsg, whisperText, subtitleFormat, tempDir_2, subtitleFile, parseWhisperResult_1, segments, generateSubtitleFile_1, parseError_1, errorMsg, filePath, exists, stats, error_7, errorMsg, audioFileName, shouldRunDeepVerify, verify, playback, verifyErr_1, tracklistPath, error_8, error_9;
                        var _this = this;
                        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
                        return __generator(this, function (_o) {
                            switch (_o.label) {
                                case 0:
                                    // Kiểm tra cancel trước khi bắt đầu job
                                    if (videoJobManager.isCancelled(requestId)) {
                                        throw new Error('Đã dừng bởi người dùng');
                                    }
                                    jobIndex = job.jobIndex;
                                    currentJobIndex = jobIndex + 1;
                                    console.log("[Job ".concat(currentJobIndex, "/").concat(plan.totalJobs, "] ").concat(job.outputFileName));
                                    // Emit progress: prepare-video stage
                                    emitter.progress({
                                        requestId: requestId,
                                        stage: 'prepare-video',
                                        percent: (jobIndex / plan.totalJobs) * 100,
                                        timeSec: 0,
                                        totalDurationSec: job.audio.durationSec,
                                        currentIndex: currentJobIndex,
                                        totalOutputs: plan.totalJobs,
                                        currentAudioPath: job.audio.path,
                                        currentOutputFilename: job.outputFileName,
                                        status: "\u0110ang chu\u1EA9n b\u1ECB video ".concat(currentJobIndex, "/").concat(plan.totalJobs),
                                    });
                                    targetDurationSec = job.audio.durationSec;
                                    if (priorityClips_1.length > 0) {
                                        useShuffle = shuffle;
                                        priorityForThisJob = priorityClips_1.length > 1 && useShuffle ? shuffleOnce(priorityClips_1) : __spreadArray([], priorityClips_1, true);
                                        priorityDuration = priorityForThisJob.reduce(function (sum, c) { return sum + c.durationSec; }, 0);
                                        remainingTarget = Math.max(0, targetDurationSec - priorityDuration);
                                        loopPlaylist = [];
                                        if (remainingTarget > 0) {
                                            // Nếu map 1-1 và có đủ video, dùng video tương ứng trước, sau đó mới loop
                                            if (canMapOneToOne_1 && baseClips_1.length > job.jobIndex) {
                                                mappedClip = baseClips_1[job.jobIndex];
                                                if (mappedClip && mappedClip.durationSec <= remainingTarget) {
                                                    // Dùng video tương ứng nếu duration phù hợp
                                                    loopPlaylist = [mappedClip];
                                                    stillRemaining = remainingTarget - mappedClip.durationSec;
                                                    if (stillRemaining > 0 && nonPriorityClips_1.length > 0) {
                                                        additional = buildPlaylistToFillDuration(nonPriorityClips_1, stillRemaining, false);
                                                        loopPlaylist.push.apply(loopPlaylist, additional);
                                                    }
                                                }
                                                else {
                                                    loopSource = nonPriorityClips_1.length > 0 ? nonPriorityClips_1 : baseClips_1;
                                                    loopPlaylist = buildPlaylistToFillDuration(loopSource, remainingTarget, useShuffle);
                                                }
                                            }
                                            else {
                                                loopSource = nonPriorityClips_1.length > 0 ? nonPriorityClips_1 : baseClips_1;
                                                loopPlaylist = buildPlaylistToFillDuration(loopSource, remainingTarget, useShuffle);
                                            }
                                        }
                                        videoPlaylist = __spreadArray(__spreadArray([], priorityForThisJob, true), loopPlaylist, true);
                                    }
                                    else {
                                        sourceClipsForJob = baseClips_1;
                                        shouldShuffle = shuffle;
                                        if (canMapOneToOne_1) {
                                            mappedClip = baseClips_1[Math.min(job.jobIndex, baseClips_1.length - 1)];
                                            if (mappedClip) {
                                                sourceClipsForJob = [mappedClip];
                                                shouldShuffle = false;
                                                console.log("[Job ".concat(currentJobIndex, "/").concat(plan.totalJobs, "] Map 1-1 v\u1EDBi clip: ").concat(path.basename(mappedClip.path)));
                                            }
                                        }
                                        videoPlaylist = buildPlaylistToFillDuration(sourceClipsForJob, targetDurationSec, shouldShuffle);
                                    }
                                    console.log("[Job ".concat(currentJobIndex, "] Video playlist: ").concat(videoPlaylist.length, " clips (t\u1EEB ").concat(baseClips_1.length, " clips g\u1ED1c, priority=").concat(priorityClips_1.length, ")"));
                                    videoListFile = path.join(tempDir, "video_".concat(job.jobIndex, ".txt"));
                                    listContent = videoPlaylist
                                        .map(function (c) { return "file '".concat(escapePathForFfmpegList(c.path), "'"); })
                                        .join('\n');
                                    return [4 /*yield*/, fsp.writeFile(videoListFile, listContent, 'utf-8')
                                        // 3. Probe audio codec
                                    ];
                                case 1:
                                    _o.sent();
                                    return [4 /*yield*/, probeAudioCodec(job.audio.path)];
                                case 2:
                                    audioCodec = _o.sent();
                                    codecLower = (_a = audioCodec === null || audioCodec === void 0 ? void 0 : audioCodec.toLowerCase()) !== null && _a !== void 0 ? _a : null;
                                    needAudioEncode = !codecLower || (codecLower !== 'aac' && codecLower !== 'mp3');
                                    console.log("[Job ".concat(currentJobIndex, "] Audio codec: ").concat(audioCodec || 'unknown', ", needEncode: ").concat(needAudioEncode));
                                    estimatedOutputBytes = estimatePlaylistBytes(videoPlaylist);
                                    return [4 /*yield*/, ensureFinalExportDiskCapacity(job.outputPath, estimatedOutputBytes, "video ".concat(currentJobIndex, "/").concat(plan.totalJobs))
                                        // 4. Run FFmpeg với progress tracking
                                        // Prepare subtitle text with metadata replacement ({title}, {artist}, {filename}) và auto lyrics/Whisper
                                    ];
                                case 3:
                                    _o.sent();
                                    subtitleToUse = subtitle;
                                    tempVideoPath = null;
                                    willUseTwoStep = (subtitle === null || subtitle === void 0 ? void 0 : subtitle.enabled) && !forceReencode;
                                    if (!willUseTwoStep) return [3 /*break*/, 5];
                                    // Step 1: Concat video + audio (copy-stream, no subtitle) - BEFORE Whisper
                                    console.log("[FinalExport] \uD83D\uDD04 Step 1/2 (PRE-WHISPER): Concat video for job ".concat(currentJobIndex, "/").concat(plan.totalJobs));
                                    tempVideoPath = job.outputPath.replace(/\.mp4$/, '.temp.mp4');
                                    emitter.progress({
                                        requestId: requestId,
                                        stage: 'export',
                                        percent: (jobIndex / plan.totalJobs) * 100,
                                        timeSec: 0,
                                        totalDurationSec: job.audio.durationSec,
                                        currentIndex: currentJobIndex,
                                        totalOutputs: plan.totalJobs,
                                        currentAudioPath: job.audio.path,
                                        currentOutputFilename: job.outputFileName,
                                        status: "[B\u01B0\u1EDBc 1/2] \u0110ang gh\u00E9p video (copy-stream, nhanh)... (".concat(currentJobIndex, "/").concat(plan.totalJobs, ")"),
                                    });
                                    // Run Step 1: Concat video (copy-stream, no subtitle)
                                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                                            var _a;
                                            var shouldNormalizeAudio = normalizeAudio;
                                            var shouldEncodeAudio = forceReencode || needAudioEncode || shouldNormalizeAudio;
                                            var audioCodecArgs = shouldEncodeAudio
                                                ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
                                                : ['-c:a', 'copy'];
                                            var audioFilterArgs = shouldNormalizeAudio
                                                ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
                                                : [];
                                            var ffmpegPath = getFfmpegExecutable();
                                            var args = __spreadArray(__spreadArray(__spreadArray([
                                                '-hide_banner',
                                                '-loglevel', 'error',
                                                '-stats',
                                                '-f', 'concat',
                                                '-safe', '0',
                                                '-i', videoListFile,
                                                '-i', job.audio.path,
                                                '-map', '0:v:0',
                                                '-map', '1:a:0',
                                                '-c:v', 'copy'
                                            ], audioFilterArgs, true), audioCodecArgs, true), [
                                                '-avoid_negative_ts', 'make_zero',
                                                '-t', job.audio.durationSec.toFixed(3),
                                                '-y', tempVideoPath,
                                            ], false);
                                            var child = spawn(ffmpegPath, args, { windowsHide: true });
                                            videoJobManager.registerJob(requestId, child);
                                            var lastEmit = 0;
                                            var stderrLines = [];
                                            (_a = child.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                                                if (videoJobManager.isCancelled(requestId)) {
                                                    if (!child.killed) {
                                                        child.kill('SIGTERM');
                                                        setTimeout(function () {
                                                            if (!child.killed)
                                                                child.kill('SIGKILL');
                                                        }, 2000);
                                                    }
                                                    return;
                                                }
                                                var text = chunk.toString('utf-8');
                                                stderrLines.push.apply(stderrLines, text.split(/\r?\n/).filter(Boolean));
                                                if (stderrLines.length > 80) {
                                                    stderrLines.splice(0, stderrLines.length - 80);
                                                }
                                                var timeSec = parseTimeFromChunk(text);
                                                if (timeSec !== null && job.audio.durationSec > 0) {
                                                    var percent = Math.min(25, (timeSec / job.audio.durationSec) * 25); // Step 1 = 0-25% of total job
                                                    var now = Date.now();
                                                    if (now - lastEmit > 100) {
                                                        lastEmit = now;
                                                        emitter.progress({
                                                            requestId: requestId,
                                                            stage: 'export',
                                                            percent: (jobIndex / plan.totalJobs) * 100 + percent / plan.totalJobs,
                                                            timeSec: timeSec,
                                                            totalDurationSec: job.audio.durationSec,
                                                            currentIndex: currentJobIndex,
                                                            totalOutputs: plan.totalJobs,
                                                            currentAudioPath: job.audio.path,
                                                            currentOutputFilename: job.outputFileName,
                                                            status: "[B\u01B0\u1EDBc 1/2] \u0110ang gh\u00E9p video... (".concat(currentJobIndex, "/").concat(plan.totalJobs, ")"),
                                                        });
                                                    }
                                                }
                                            });
                                            child.on('error', function (error) {
                                                reject(new Error("FFmpeg step 1 (concat) error: ".concat(error.message)));
                                            });
                                            child.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                                                var tail;
                                                return __generator(this, function (_a) {
                                                    if (code === 0) {
                                                        console.log('[FinalExport] ✅ Step 1 completed: Video concatenated (pre-Whisper)');
                                                        resolve();
                                                    }
                                                    else {
                                                        tail = stderrLines.slice(-10).join('\n');
                                                        reject(new Error("FFmpeg step 1 (concat) failed v\u1EDBi m\u00E3 ".concat(code, ". stderr:\n").concat(tail)));
                                                    }
                                                    return [2 /*return*/];
                                                });
                                            }); });
                                        })];
                                case 4:
                                    // Run Step 1: Concat video (copy-stream, no subtitle)
                                    _o.sent();
                                    _o.label = 5;
                                case 5:
                                    if (!(subtitle === null || subtitle === void 0 ? void 0 : subtitle.enabled)) return [3 /*break*/, 37];
                                    subtitleText = subtitle.text || '';
                                    title = '';
                                    artist = '';
                                    album = '';
                                    lyrics = '';
                                    _o.label = 6;
                                case 6:
                                    _o.trys.push([6, 8, , 9]);
                                    return [4 /*yield*/, probeFile(job.audio.path)];
                                case 7:
                                    audioMetadata = _o.sent();
                                    tags = audioMetadata.format.tags || {};
                                    title = tags.title || '';
                                    artist = tags.artist || tags.album_artist || '';
                                    album = tags.album || '';
                                    lyrics = tags.lyrics || ''; // Lyrics from ID3 tags (USLT, LYRICS)
                                    return [3 /*break*/, 9];
                                case 8:
                                    error_6 = _o.sent();
                                    console.warn("[FinalExport] Failed to read metadata from ".concat(job.audio.path, ":"), error_6);
                                    return [3 /*break*/, 9];
                                case 9:
                                    needsTimestamps = subtitle.subtitleStyle === 'karaoke' ||
                                        subtitle.subtitleStyle === 'word-by-word' ||
                                        subtitle.subtitleStyle === 'dynamic' ||
                                        subtitle.subtitleStyle === 'simple' // Simple style also needs timestamps for timed display
                                    ;
                                    shouldUseWhisper = subtitle.useWhisper || needsTimestamps || !lyrics;
                                    if (!shouldUseWhisper) return [3 /*break*/, 35];
                                    // If useWhisper is enabled and no lyrics in metadata, try Whisper transcription
                                    console.log("[FinalExport] \uD83C\uDFA4 Starting Whisper transcription for job ".concat(currentJobIndex, "/").concat(plan.totalJobs));
                                    emitter.progress({
                                        requestId: requestId,
                                        stage: 'export',
                                        percent: (jobIndex / plan.totalJobs) * 100,
                                        timeSec: 0,
                                        totalDurationSec: job.audio.durationSec,
                                        currentIndex: currentJobIndex,
                                        totalOutputs: plan.totalJobs,
                                        currentAudioPath: job.audio.path,
                                        currentOutputFilename: job.outputFileName,
                                        status: "[Whisper] \u0110ang nh\u1EADn di\u1EC7n l\u1EDDi b\u00E0i h\u00E1t b\u1EB1ng GPU (Faster-Whisper)... (".concat(currentJobIndex, "/").concat(plan.totalJobs, ")"),
                                    });
                                    _o.label = 10;
                                case 10:
                                    _o.trys.push([10, 33, , 34]);
                                    whisperLanguage = subtitle.whisperLanguage || 'auto' // Default to auto-detect
                                    ;
                                    // ALWAYS get full result with timestamps for subtitle generation
                                    // Even for 'simple' style, we need timestamps to show subtitles changing over time
                                    // Without timestamps, subtitle will be static text (not what we want)
                                    console.log("[FinalExport] \uD83C\uDFA4 Calling transcribeAudio...");
                                    return [4 /*yield*/, transcribeAudio(job.audio.path, whisperLanguage, function (progress) {
                                            emitter.progress({
                                                requestId: requestId,
                                                stage: 'export',
                                                percent: (jobIndex / plan.totalJobs) * 100,
                                                timeSec: 0,
                                                totalDurationSec: job.audio.durationSec,
                                                currentIndex: currentJobIndex,
                                                totalOutputs: plan.totalJobs,
                                                currentAudioPath: job.audio.path,
                                                currentOutputFilename: job.outputFileName,
                                                status: "[Whisper] ".concat(progress.message, " (").concat(currentJobIndex, "/").concat(plan.totalJobs, ")"),
                                            });
                                        }, true // ALWAYS request full result with timestamps for subtitle generation
                                        )
                                        // Always try to create subtitle file from Whisper result (we always request timestamps now)
                                    ];
                                case 11:
                                    whisperResult = _o.sent();
                                    // Always try to create subtitle file from Whisper result (we always request timestamps now)
                                    console.log("[FinalExport] \uD83D\uDD0D Whisper result type: ".concat(typeof whisperResult));
                                    console.log("[FinalExport] \uD83D\uDD0D Whisper result is object: ".concat(typeof whisperResult === 'object' && whisperResult !== null));
                                    if (!(typeof whisperResult === 'object' && whisperResult !== null)) return [3 /*break*/, 21];
                                    // Log Whisper result structure for debugging
                                    console.log("[FinalExport] \uD83D\uDCCA Whisper result keys:", Object.keys(whisperResult));
                                    console.log("[FinalExport] \uD83D\uDCCA Whisper result has chunks:", !!whisperResult.chunks);
                                    console.log("[FinalExport] \uD83D\uDCCA Whisper result has text:", !!whisperResult.text);
                                    console.log("[FinalExport] \uD83D\uDCCA Whisper result text preview:", ((_b = whisperResult.text) === null || _b === void 0 ? void 0 : _b.substring(0, 100)) || 'N/A');
                                    if (whisperResult.chunks && Array.isArray(whisperResult.chunks)) {
                                        console.log("[FinalExport] \uD83D\uDCCA Whisper chunks count:", whisperResult.chunks.length);
                                        if (whisperResult.chunks.length > 0) {
                                            firstChunk = whisperResult.chunks[0];
                                            console.log("[FinalExport] \uD83D\uDCCA First chunk structure:", {
                                                hasText: !!firstChunk.text,
                                                hasTimestamp: !!firstChunk.timestamp,
                                                hasWords: !!firstChunk.words,
                                                wordsCount: ((_c = firstChunk.words) === null || _c === void 0 ? void 0 : _c.length) || 0,
                                                text: ((_d = firstChunk.text) === null || _d === void 0 ? void 0 : _d.substring(0, 50)) || 'N/A',
                                            });
                                            // Log word-level timestamps if available
                                            if (firstChunk.words && Array.isArray(firstChunk.words) && firstChunk.words.length > 0) {
                                                firstWord = firstChunk.words[0];
                                                console.log("[FinalExport] \uD83D\uDCCA First word structure:", {
                                                    word: firstWord.word || firstWord.text || 'N/A',
                                                    hasTimestamp: !!firstWord.timestamp,
                                                    hasStart: typeof firstWord.start === 'number',
                                                    hasEnd: typeof firstWord.end === 'number',
                                                    start: firstWord.start || ((_e = firstWord.timestamp) === null || _e === void 0 ? void 0 : _e[0]) || 'N/A',
                                                    end: firstWord.end || ((_f = firstWord.timestamp) === null || _f === void 0 ? void 0 : _f[1]) || 'N/A',
                                                });
                                            }
                                            else {
                                                console.warn("[FinalExport] \u26A0\uFE0F First chunk has NO word-level timestamps - karaoke effects may not work properly");
                                            }
                                        }
                                    }
                                    else {
                                        console.warn("[FinalExport] \u26A0\uFE0F Whisper result has NO chunks - cannot create timed subtitle file");
                                    }
                                    _o.label = 12;
                                case 12:
                                    _o.trys.push([12, 19, , 20]);
                                    subtitleFormat = subtitle.subtitleFormat || 'ass';
                                    tempDir_1 = path.join(os.tmpdir(), 'ffmpeg-subtitles');
                                    return [4 /*yield*/, fsp.mkdir(tempDir_1, { recursive: true })];
                                case 13:
                                    _o.sent();
                                    subtitleFile = path.join(tempDir_1, "subtitle-".concat(requestId, "-").concat(job.jobIndex, "-").concat(randomUUID(), ".").concat(subtitleFormat));
                                    console.log("[FinalExport] Generating ".concat(subtitleFormat.toUpperCase(), " subtitle file: ").concat(subtitleFile));
                                    return [4 /*yield*/, generateSubtitleFile(whisperResult, subtitleFile, subtitleFormat, {
                                            fontSize: subtitle.fontSize || 48,
                                            fontColor: ((_g = subtitle.fontColor) === null || _g === void 0 ? void 0 : _g.replace('#', '')) || 'FFFFFF',
                                            highlightColor: ((_h = subtitle.highlightColor) === null || _h === void 0 ? void 0 : _h.replace('#', '')) || 'FFFF00',
                                            position: subtitle.position || 'bottom',
                                            style: subtitle.subtitleStyle || 'karaoke', // Use subtitle style from options
                                        })
                                        // Verify file was created
                                    ];
                                case 14:
                                    _o.sent();
                                    // Verify file was created
                                    if (!fs.existsSync(subtitleFile)) {
                                        throw new Error("Subtitle file was not created at: ".concat(subtitleFile));
                                    }
                                    fileSize = fs.statSync(subtitleFile).size;
                                    if (fileSize === 0) {
                                        throw new Error("Subtitle file is empty: ".concat(subtitleFile));
                                    }
                                    // Store subtitle file path in subtitle object
                                    // Set text to empty since we're using file-based subtitle
                                    subtitleToUse = __assign(__assign({}, subtitle), { text: '', // Empty text when using subtitle file
                                        subtitleFile: subtitleFile });
                                    console.log("[FinalExport] \u2705 Generated ".concat(subtitleFormat.toUpperCase(), " subtitle file: ").concat(subtitleFile));
                                    console.log("[FinalExport] \u2705 Subtitle file size: ".concat(fileSize, " bytes"));
                                    _o.label = 15;
                                case 15:
                                    _o.trys.push([15, 17, , 18]);
                                    return [4 /*yield*/, fsp.readFile(subtitleFile, 'utf-8')];
                                case 16:
                                    fileContent = _o.sent();
                                    lines = fileContent.split('\n').slice(0, 15);
                                    console.log("[FinalExport] Subtitle file preview (first 15 lines):\n".concat(lines.join('\n')));
                                    return [3 /*break*/, 18];
                                case 17:
                                    e_1 = _o.sent();
                                    console.warn('[FinalExport] Could not read subtitle file for preview:', e_1);
                                    return [3 /*break*/, 18];
                                case 18: return [3 /*break*/, 20];
                                case 19:
                                    subtitleError_1 = _o.sent();
                                    console.error("[FinalExport] \u274C Failed to generate subtitle file:", subtitleError_1);
                                    console.error("[FinalExport] Error details:", subtitleError_1 instanceof Error ? subtitleError_1.stack : subtitleError_1);
                                    // If we need timestamps, we cannot fallback to static text
                                    // Throw error to prevent using static text subtitle
                                    if (needsTimestamps || subtitle.useWhisper) {
                                        errorMsg = subtitleError_1 instanceof Error ? subtitleError_1.message : String(subtitleError_1);
                                        throw new Error("Failed to generate subtitle file: ".concat(errorMsg, ". Cannot create timed subtitle."));
                                    }
                                    // Only fallback to simple text if we don't need timestamps (rare case)
                                    console.warn("[FinalExport] \u26A0\uFE0F Falling back to static text (not timed)");
                                    subtitleText = (whisperResult === null || whisperResult === void 0 ? void 0 : whisperResult.text) || '';
                                    subtitleToUse = __assign(__assign({}, subtitle), { text: subtitleText });
                                    console.log("[FinalExport] Fallback to simple text subtitle: ".concat(subtitleText.substring(0, 50), "..."));
                                    return [3 /*break*/, 20];
                                case 20: return [3 /*break*/, 32];
                                case 21:
                                    whisperText = typeof whisperResult === 'string' ? whisperResult : (whisperResult === null || whisperResult === void 0 ? void 0 : whisperResult.text) || '';
                                    if (!(typeof whisperResult === 'object' && whisperResult !== null && !whisperResult.chunks)) return [3 /*break*/, 31];
                                    _o.label = 22;
                                case 22:
                                    _o.trys.push([22, 29, , 30]);
                                    subtitleFormat = subtitle.subtitleFormat || 'ass';
                                    tempDir_2 = path.join(os.tmpdir(), 'ffmpeg-subtitles');
                                    return [4 /*yield*/, fsp.mkdir(tempDir_2, { recursive: true })];
                                case 23:
                                    _o.sent();
                                    subtitleFile = path.join(tempDir_2, "subtitle-".concat(requestId, "-").concat(job.jobIndex, "-").concat(randomUUID(), ".").concat(subtitleFormat));
                                    return [4 /*yield*/, import('../audio/subtitleGenerator')];
                                case 24:
                                    parseWhisperResult_1 = (_o.sent()).parseWhisperResult;
                                    segments = parseWhisperResult_1(whisperResult);
                                    if (!(segments.length > 0)) return [3 /*break*/, 27];
                                    return [4 /*yield*/, import('../audio/subtitleGenerator')];
                                case 25:
                                    generateSubtitleFile_1 = (_o.sent()).generateSubtitleFile;
                                    return [4 /*yield*/, generateSubtitleFile_1(whisperResult, subtitleFile, subtitleFormat, {
                                            fontSize: subtitle.fontSize || 48,
                                            fontColor: ((_j = subtitle.fontColor) === null || _j === void 0 ? void 0 : _j.replace('#', '')) || 'FFFFFF',
                                            highlightColor: ((_k = subtitle.highlightColor) === null || _k === void 0 ? void 0 : _k.replace('#', '')) || 'FFFF00',
                                            position: subtitle.position || 'bottom',
                                            style: subtitle.subtitleStyle || 'simple',
                                        })];
                                case 26:
                                    _o.sent();
                                    if (fs.existsSync(subtitleFile)) {
                                        subtitleToUse = __assign(__assign({}, subtitle), { text: '', subtitleFile: subtitleFile });
                                        console.log("[FinalExport] Created subtitle file from Whisper result: ".concat(subtitleFile));
                                    }
                                    else {
                                        throw new Error('Subtitle file was not created');
                                    }
                                    return [3 /*break*/, 28];
                                case 27: throw new Error('No segments parsed from Whisper result');
                                case 28: return [3 /*break*/, 30];
                                case 29:
                                    parseError_1 = _o.sent();
                                    console.error("[FinalExport] \u274C Failed to create subtitle file from Whisper result:", parseError_1);
                                    // If we need timestamps, we cannot fallback to static text
                                    if (needsTimestamps || subtitle.useWhisper) {
                                        errorMsg = parseError_1 instanceof Error ? parseError_1.message : String(parseError_1);
                                        throw new Error("Failed to parse Whisper result and create subtitle file: ".concat(errorMsg, ". Cannot create timed subtitle."));
                                    }
                                    // Only fallback if we don't need timestamps
                                    console.warn("[FinalExport] \u26A0\uFE0F Falling back to static text (not timed)");
                                    subtitleText = whisperText;
                                    subtitleToUse = __assign(__assign({}, subtitle), { text: subtitleText });
                                    console.log("[FinalExport] Fallback to simple text subtitle: ".concat(subtitleText.substring(0, 50), "..."));
                                    return [3 /*break*/, 30];
                                case 30: return [3 /*break*/, 32];
                                case 31:
                                    // No object result - just text (this should not happen when returnFullResult=true)
                                    console.error("[FinalExport] \u274C ERROR: Whisper returned text instead of object result!");
                                    console.error("[FinalExport] This should not happen when returnFullResult=true");
                                    console.error("[FinalExport] Whisper result type: ".concat(typeof whisperResult));
                                    console.error("[FinalExport] Whisper result (first 200 chars):", typeof whisperResult === 'string' ? whisperResult.substring(0, 200) : JSON.stringify(whisperResult).substring(0, 200));
                                    // Try to throw error instead of fallback to static text
                                    throw new Error('Whisper did not return object result with timestamps - cannot create timed subtitle file. Expected object with chunks, got: ' + typeof whisperResult);
                                case 32:
                                    // Log subtitleToUse for debugging
                                    if (subtitleToUse) {
                                        console.log("[FinalExport] \uD83D\uDCDD subtitleToUse after Whisper:", {
                                            enabled: subtitleToUse.enabled,
                                            text: ((_l = subtitleToUse.text) === null || _l === void 0 ? void 0 : _l.substring(0, 50)) || '(empty)',
                                            subtitleFile: subtitleToUse.subtitleFile || '(none)',
                                            subtitleStyle: subtitleToUse.subtitleStyle,
                                            subtitleFormat: subtitleToUse.subtitleFormat,
                                        });
                                    }
                                    // Verify subtitle file exists if it was set
                                    if (subtitleToUse && subtitleToUse.subtitleFile) {
                                        filePath = subtitleToUse.subtitleFile;
                                        exists = fs.existsSync(filePath);
                                        console.log("[FinalExport] \uD83D\uDD0D Verifying subtitle file: ".concat(filePath));
                                        console.log("[FinalExport] ".concat(exists ? '✅' : '❌', " Subtitle file exists: ").concat(exists));
                                        if (exists) {
                                            stats = fs.statSync(filePath);
                                            console.log("[FinalExport] \uD83D\uDCCA Subtitle file size: ".concat(stats.size, " bytes"));
                                        }
                                    }
                                    return [3 /*break*/, 34];
                                case 33:
                                    error_7 = _o.sent();
                                    console.error("[FinalExport] \u274C Whisper transcription failed for ".concat(job.audio.path, ":"), error_7);
                                    console.error("[FinalExport] Error details:", error_7 instanceof Error ? error_7.stack : error_7);
                                    // If Whisper fails and we need timestamps, we cannot create timed subtitle
                                    // Throw error instead of fallback to static text
                                    if (needsTimestamps || subtitle.useWhisper) {
                                        errorMsg = error_7 instanceof Error ? error_7.message : String(error_7);
                                        throw new Error("Whisper transcription failed: ".concat(errorMsg, ". Cannot create timed subtitle file."));
                                    }
                                    // Only fallback to title if we don't need timestamps (rare case) AND no subtitle file exists
                                    console.warn("[FinalExport] \u26A0\uFE0F Falling back to static text (not timed)");
                                    if (!subtitleText.trim() && !(subtitleToUse === null || subtitleToUse === void 0 ? void 0 : subtitleToUse.subtitleFile)) {
                                        subtitleText = title || path.basename(job.audio.path, path.extname(job.audio.path));
                                    }
                                    // Only set text if no subtitle file exists
                                    if (!(subtitleToUse === null || subtitleToUse === void 0 ? void 0 : subtitleToUse.subtitleFile)) {
                                        subtitleToUse = __assign(__assign({}, subtitle), { text: subtitleText });
                                    }
                                    return [3 /*break*/, 34];
                                case 34: return [3 /*break*/, 36];
                                case 35:
                                    // CRITICAL: Skip text-based subtitle processing if subtitle file exists
                                    if (subtitleToUse === null || subtitleToUse === void 0 ? void 0 : subtitleToUse.subtitleFile) {
                                        console.log("[FinalExport] \u2705 Subtitle file exists, skipping text-based subtitle processing");
                                    }
                                    else if (subtitle === null || subtitle === void 0 ? void 0 : subtitle.enabled) {
                                        // If subtitle text is empty, auto-use title from metadata
                                        if (!subtitleText.trim()) {
                                            if (title) {
                                                subtitleText = title;
                                                // Optionally add artist if available
                                                if (artist && artist !== title) {
                                                    subtitleText = "".concat(artist, " - ").concat(title);
                                                }
                                            }
                                            else {
                                                // Fallback to filename if no metadata
                                                subtitleText = path.basename(job.audio.path, path.extname(job.audio.path));
                                            }
                                        }
                                        else {
                                            // Replace placeholders in user-provided text
                                            subtitleText = subtitleText.replace(/{title}/g, title);
                                            subtitleText = subtitleText.replace(/{artist}/g, artist);
                                            subtitleText = subtitleText.replace(/{album}/g, album);
                                            subtitleText = subtitleText.replace(/{lyrics}/g, lyrics); // Also support {lyrics} placeholder
                                            // Fallback: replace {filename} with actual filename
                                            if (subtitleText.includes('{filename}')) {
                                                audioFileName = path.basename(job.audio.path, path.extname(job.audio.path));
                                                subtitleText = subtitleText.replace(/{filename}/g, audioFileName);
                                            }
                                            // If result is empty or only placeholders, use title or filename
                                            if (!subtitleText.trim() || subtitleText.trim().match(/^\{[^}]+\}$/)) {
                                                subtitleText = title || path.basename(job.audio.path, path.extname(job.audio.path));
                                            }
                                        }
                                    }
                                    _o.label = 36;
                                case 36:
                                    // CRITICAL: Only do final fallback if no subtitle file exists
                                    if (!(subtitleToUse === null || subtitleToUse === void 0 ? void 0 : subtitleToUse.subtitleFile)) {
                                        // If still empty after all processing, use filename as final fallback
                                        if (!subtitleText.trim()) {
                                            subtitleText = path.basename(job.audio.path, path.extname(job.audio.path));
                                        }
                                        subtitleToUse = __assign(__assign({}, subtitle), { text: subtitleText });
                                    }
                                    else {
                                        console.log("[FinalExport] \u2705 Subtitle file exists, skipping final text fallback");
                                    }
                                    _o.label = 37;
                                case 37:
                                    console.log("[FinalExport] \uD83D\uDCCB About to call runFinalCommand for job ".concat(currentJobIndex, "/").concat(plan.totalJobs));
                                    console.log("[FinalExport] \uD83D\uDCCB subtitleToUse:", {
                                        enabled: subtitleToUse === null || subtitleToUse === void 0 ? void 0 : subtitleToUse.enabled,
                                        hasSubtitleFile: !!(subtitleToUse === null || subtitleToUse === void 0 ? void 0 : subtitleToUse.subtitleFile),
                                        subtitleFile: (subtitleToUse === null || subtitleToUse === void 0 ? void 0 : subtitleToUse.subtitleFile) || '(none)',
                                    });
                                    return [4 /*yield*/, runFinalCommand({
                                            requestId: requestId,
                                            totalDurationSec: job.audio.durationSec,
                                            videoListPath: videoListFile,
                                            audioPath: job.audio.path,
                                            outputPath: job.outputPath,
                                            audioCodec: audioCodec,
                                            forceReencode: forceReencode,
                                            normalizeAudio: normalizeAudio,
                                            subtitle: subtitleToUse,
                                            tempVideoPath: tempVideoPath || undefined, // Pass temp video path if Step 1 already done
                                            emitProgress: function (progressPayload) {
                                                // Calculate percentJob và percentTotal
                                                // Vì chạy tuần tự, job đang chạy là job.jobIndex (0-based)
                                                var percentJob = progressPayload.percent || 0;
                                                var percentTotal = (job.jobIndex / plan.totalJobs) * 100 + (percentJob / plan.totalJobs);
                                                emitter.progress(__assign(__assign({}, progressPayload), { requestId: requestId, stage: 'export', percent: percentTotal, currentIndex: currentJobIndex, totalOutputs: plan.totalJobs, currentAudioPath: job.audio.path, currentOutputFilename: job.outputFileName, status: "\u0110ang xu\u1EA5t video ".concat(currentJobIndex, "/").concat(plan.totalJobs, ": ").concat(job.outputFileName) }));
                                            },
                                        })
                                        // 5. Verify output (ffprobe + decode) + optional playback test + cleanup concat list file
                                    ];
                                case 38:
                                    _o.sent();
                                    shouldRunDeepVerify = forceReencode || needAudioEncode || normalizeAudio;
                                    if (!shouldRunDeepVerify) return [3 /*break*/, 45];
                                    _o.label = 39;
                                case 39:
                                    _o.trys.push([39, 43, , 44]);
                                    emitter.progress({
                                        requestId: requestId,
                                        stage: 'finishing',
                                        percent: ((job.jobIndex + 0.5) / plan.totalJobs) * 100,
                                        timeSec: job.audio.durationSec,
                                        totalDurationSec: job.audio.durationSec,
                                        currentIndex: currentJobIndex,
                                        totalOutputs: plan.totalJobs,
                                        currentAudioPath: job.audio.path,
                                        currentOutputFilename: job.outputFileName,
                                        status: "\u0110ang ki\u1EC3m tra file xu\u1EA5t ra ".concat(currentJobIndex, "/").concat(plan.totalJobs, " (ffprobe + decode)..."),
                                    });
                                    return [4 /*yield*/, verifyOutputVideo(job.outputPath, {
                                            expectedDurationSec: job.audio.durationSec,
                                            toleranceSec: 5,
                                            onLog: function (msg) { return console.log('[FinalExport][verify]', msg); },
                                        })];
                                case 40:
                                    verify = _o.sent();
                                    if (verify.durationWarning) {
                                        console.warn("[FinalExport][verify] Duration diff > 5s cho ".concat(job.outputFileName, " (expected=").concat(job.audio.durationSec.toFixed(2), "s, actual=").concat(verify.durationSec.toFixed(2), "s)"));
                                    }
                                    if (!verify.decodeOk) {
                                        console.warn("[FinalExport][verify] Decode test b\u00E1o l\u1ED7i cho ".concat(job.outputFileName, ", file c\u00F3 th\u1EC3 l\u1ED7i tr\u00EAn m\u1ED9t s\u1ED1 player."));
                                    }
                                    if (!forceReencode) return [3 /*break*/, 42];
                                    return [4 /*yield*/, runPlaybackTest(job.outputPath)];
                                case 41:
                                    playback = _o.sent();
                                    if (playback.success) {
                                        console.log("[FinalExport][playback] ".concat(job.outputFileName, " ph\u00E1t th\u1EED OK v\u1EDBi ").concat(playback.player, " (exitCode=").concat(playback.exitCode, ")"));
                                    }
                                    else {
                                        console.warn("[FinalExport][playback] Ph\u00E1t th\u1EED th\u1EA5t b\u1EA1i cho ".concat(job.outputFileName, " (player=").concat((_m = playback.player) !== null && _m !== void 0 ? _m : 'none', ", exitCode=").concat(playback.exitCode, ")"));
                                        emitter.progress({
                                            requestId: requestId,
                                            stage: 'finishing',
                                            percent: ((job.jobIndex + 0.75) / plan.totalJobs) * 100,
                                            timeSec: job.audio.durationSec,
                                            totalDurationSec: job.audio.durationSec,
                                            currentIndex: currentJobIndex,
                                            totalOutputs: plan.totalJobs,
                                            currentAudioPath: job.audio.path,
                                            currentOutputFilename: job.outputFileName,
                                            status: "\u26A0\uFE0F Playback test th\u1EA5t b\u1EA1i cho ".concat(job.outputFileName, " (mpv/VLC), h\u00E3y ki\u1EC3m tra l\u1EA1i file."),
                                        });
                                    }
                                    _o.label = 42;
                                case 42: return [3 /*break*/, 44];
                                case 43:
                                    verifyErr_1 = _o.sent();
                                    console.warn("[FinalExport][verify] Kh\u00F4ng th\u1EC3 ch\u1EA1y b\u01B0\u1EDBc ki\u1EC3m tra s\u00E2u cho ".concat(job.outputFileName, " (kh\u00F4ng ch\u1EB7n job):"), verifyErr_1);
                                    return [3 /*break*/, 44];
                                case 44: return [3 /*break*/, 46];
                                case 45:
                                    emitter.progress({
                                        requestId: requestId,
                                        stage: 'finishing',
                                        percent: ((job.jobIndex + 0.5) / plan.totalJobs) * 100,
                                        timeSec: job.audio.durationSec,
                                        totalDurationSec: job.audio.durationSec,
                                        currentIndex: currentJobIndex,
                                        totalOutputs: plan.totalJobs,
                                        currentAudioPath: job.audio.path,
                                        currentOutputFilename: job.outputFileName,
                                        status: "B\u1ECF qua ki\u1EC3m tra s\u00E2u cho video ".concat(currentJobIndex, "/").concat(plan.totalJobs, " (copy-stream)."),
                                    });
                                    console.log("[FinalExport] Skip deep verification for ".concat(job.outputFileName, " (copy-stream mode, codec=").concat(audioCodec || 'unknown', ")"));
                                    _o.label = 46;
                                case 46:
                                    tracklistPath = undefined;
                                    if (!(job.tracklistText && job.tracklistText.trim().length > 0)) return [3 /*break*/, 50];
                                    _o.label = 47;
                                case 47:
                                    _o.trys.push([47, 49, , 50]);
                                    tracklistPath = buildTracklistPath(job.outputPath);
                                    return [4 /*yield*/, fsp.writeFile(tracklistPath, job.tracklistText.trimEnd() + '\n', 'utf-8')];
                                case 48:
                                    _o.sent();
                                    console.log("[Job ".concat(currentJobIndex, "/").concat(plan.totalJobs, "] \u2713 Tracklist saved: ").concat(tracklistPath));
                                    return [3 /*break*/, 50];
                                case 49:
                                    error_8 = _o.sent();
                                    console.warn("[FinalExport] Failed to write tracklist file: ".concat(tracklistPath), error_8);
                                    return [3 /*break*/, 50];
                                case 50:
                                    _o.trys.push([50, 52, , 53]);
                                    return [4 /*yield*/, fsp.unlink(videoListFile)];
                                case 51:
                                    _o.sent();
                                    return [3 /*break*/, 53];
                                case 52:
                                    error_9 = _o.sent();
                                    console.warn("[FinalExport] Failed to cleanup concat list: ".concat(videoListFile), error_9);
                                    return [3 /*break*/, 53];
                                case 53:
                                    console.log("[Job ".concat(currentJobIndex, "/").concat(plan.totalJobs, "] \u2713 Completed: ").concat(job.outputFileName));
                                    return [2 /*return*/];
                            }
                        });
                    }); };
                    _b = 0, _c = plan.jobs;
                    _g.label = 3;
                case 3:
                    if (!(_b < _c.length)) return [3 /*break*/, 6];
                    job = _c[_b];
                    return [4 /*yield*/, processJob(job)];
                case 4:
                    _g.sent();
                    _g.label = 5;
                case 5:
                    _b++;
                    return [3 /*break*/, 3];
                case 6:
                    tracklistPaths_1 = {};
                    for (_d = 0, _e = plan.jobs; _d < _e.length; _d++) {
                        job = _e[_d];
                        if (job.tracklistText) {
                            tracklistPaths_1[job.jobIndex] = buildTracklistPath(job.outputPath);
                        }
                    }
                    emitter.done({
                        requestId: requestId,
                        outputs: plan.jobs.map(function (j) { return ({
                            audioFile: j.audio.path,
                            videoFile: j.outputPath,
                            durationSec: j.audio.durationSec,
                            tracklistFile: tracklistPaths_1[j.jobIndex],
                        }); }),
                    });
                    return [3 /*break*/, 10];
                case 7:
                    error_5 = _g.sent();
                    emitter.error({
                        requestId: requestId,
                        error: (error_5 === null || error_5 === void 0 ? void 0 : error_5.message) || 'Unknown error',
                        message: error_5 === null || error_5 === void 0 ? void 0 : error_5.message,
                    });
                    throw error_5;
                case 8: 
                // Cleanup temp dir
                return [4 /*yield*/, cleanupTempDir(tempDir)];
                case 9:
                    // Cleanup temp dir
                    _g.sent();
                    return [7 /*endfinally*/];
                case 10: return [2 /*return*/];
            }
        });
    });
}
function buildVideoPlaylist(clips, totalDurationSec, shuffle, seed) {
    if (shuffle === void 0) { shuffle = false; }
    if (clips.length === 0) {
        throw new Error('Không có clip video để ghép.');
    }
    // Map sang ClipItem
    var clipItems = clips.map(function (c) { return ({
        path: c.path,
        durationSec: c.durationSec,
        id: c.path,
    }); });
    // PHASE 4: Dùng buildPlaylistToFillDuration
    var playlist = buildPlaylistToFillDuration(clipItems, totalDurationSec, shuffle);
    // Convert back to ValidatedInputFile[]
    var picked = playlist.map(function (c) {
        var original = clips.find(function (clip) { return clip.path === c.path; });
        if (!original) {
            throw new Error("Clip not found: ".concat(c.path));
        }
        return original;
    });
    var totalDurationSecActual = playlist.reduce(function (sum, c) { return sum + c.durationSec; }, 0);
    var usedUniqueClips = new Set(playlist.map(function (c) { return c.path; })).size;
    console.log("[finalExport] Built playlist: target=".concat(totalDurationSec.toFixed(2), "s, actual=").concat(totalDurationSecActual.toFixed(2), "s, items=").concat(playlist.length, ", unique=").concat(usedUniqueClips, "/").concat(clips.length));
    return {
        clips: picked,
        totalDurationSec: totalDurationSecActual,
        usedFiles: picked.length,
    };
}
var DEFAULT_PLAYLIST_CLIP_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB fallback
function estimatePlaylistBytes(playlist) {
    var knownTotal = 0;
    var knownCount = 0;
    for (var _i = 0, playlist_1 = playlist; _i < playlist_1.length; _i++) {
        var clip = playlist_1[_i];
        if (typeof clip.sizeBytes === 'number' && clip.sizeBytes > 0) {
            knownTotal += clip.sizeBytes;
            knownCount++;
        }
    }
    var avgSize = knownCount > 0 ? knownTotal / knownCount : DEFAULT_PLAYLIST_CLIP_SIZE_BYTES;
    return playlist.reduce(function (sum, clip) {
        var size = clip.sizeBytes;
        return sum + (typeof size === 'number' && size > 0 ? size : avgSize);
    }, 0);
}
function ensureFinalExportDiskCapacity(outputPath, estimatedBytes, jobLabel) {
    return __awaiter(this, void 0, void 0, function () {
        var diskInfo, buffer, err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, getDiskSpace(outputPath)];
                case 1:
                    diskInfo = _a.sent();
                    buffer = Math.max(estimatedBytes * 1.05, 4 * 1024 * 1024 * 1024) // 5% margin or >=4GB
                    ;
                    if (diskInfo.free < buffer) {
                        throw new Error("\u1ED4 ".concat(diskInfo.drive, " ch\u1EC9 c\u00F2n ").concat(formatBytes(diskInfo.free), " nh\u01B0ng ").concat(jobLabel, " c\u1EA7n kho\u1EA3ng ").concat(formatBytes(estimatedBytes), ". Vui l\u00F2ng d\u1ECDn d\u1EB9p dung l\u01B0\u1EE3ng tr\u01B0\u1EDBc khi ti\u1EBFp t\u1EE5c."));
                    }
                    return [3 /*break*/, 3];
                case 2:
                    err_2 = _a.sent();
                    if (err_2 instanceof Error) {
                        throw err_2;
                    }
                    throw new Error('Không thể kiểm tra dung lượng ổ đĩa trước khi xuất video.');
                case 3: return [2 /*return*/];
            }
        });
    });
}
function writeVideoConcatList(files, filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var content;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    content = files.map(function (clip) { return "file '".concat(escapePathForFfmpegList(clip.path), "'"); }).join('\n');
                    return [4 /*yield*/, fsp.writeFile(filePath, content, 'utf-8')];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function getFfmpegExecutable() {
    var ffmpeg = getFfmpegPaths().ffmpeg;
    if (process.platform === 'win32' && ffmpeg.match(/^[A-Z]:\\.*$/) && ffmpeg.length > 240) {
        return ffmpeg.startsWith('\\\\?\\') ? ffmpeg : "\\\\?\\".concat(ffmpeg);
    }
    return ffmpeg;
}
/**
 * Helper: Burn subtitle into a video file (Step 2 of 2-step process)
 */
function burnSubtitleIntoVideo(inputVideoPath, outputPath, subtitle, videoFilter, requestId, totalDurationSec, emitProgress) {
    return __awaiter(this, void 0, void 0, function () {
        var ffmpegPath, gpuCodecArgs, gpuInfo;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    ffmpegPath = getFfmpegExecutable();
                    return [4 /*yield*/, buildVideoEncoderArgs(true, 'fast')];
                case 1:
                    gpuCodecArgs = _a.sent();
                    return [4 /*yield*/, getGpuInfo()];
                case 2:
                    gpuInfo = _a.sent();
                    console.log("[FinalExport] Step 2: Using ".concat(gpuInfo.available ? gpuInfo.encoder.toUpperCase() : 'CPU', " encoder for subtitle burn"));
                    return [2 /*return*/, new Promise(function (resolve, reject) {
                            var _a;
                            var args = [
                                '-hide_banner',
                                '-loglevel', 'error',
                                '-stats',
                                '-i', inputVideoPath,
                            ];
                            // Add subtitle filter
                            if (videoFilter.includes('subtitles=')) {
                                args.push('-vf', videoFilter);
                                args.push('-map', '0:v:0');
                            }
                            else if (videoFilter.includes('drawtext=')) {
                                var filterComplex = "[0:v]".concat(videoFilter, "[v]");
                                args.push('-filter_complex', filterComplex);
                                args.push('-map', '[v]');
                            }
                            else {
                                reject(new Error('Invalid subtitle filter'));
                                return;
                            }
                            args.push.apply(args, __spreadArray(__spreadArray(['-map', '0:a:0'], gpuCodecArgs, false), [// Re-encode video with GPU
                                '-c:a', 'copy', // Copy audio (already processed in step 1)
                                '-avoid_negative_ts', 'make_zero',
                                '-y', outputPath], false));
                            console.log('[FinalExport] Step 2: Running FFmpeg to burn subtitle...');
                            var child = spawn(ffmpegPath, args, { windowsHide: true });
                            videoJobManager.registerJob(requestId, child);
                            var lastEmit = 0;
                            var stderrLines = [];
                            (_a = child.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                                if (videoJobManager.isCancelled(requestId)) {
                                    if (!child.killed) {
                                        child.kill('SIGTERM');
                                        setTimeout(function () {
                                            if (!child.killed)
                                                child.kill('SIGKILL');
                                        }, 2000);
                                    }
                                    return;
                                }
                                var text = chunk.toString('utf-8');
                                stderrLines.push.apply(stderrLines, text.split(/\r?\n/).filter(Boolean));
                                if (stderrLines.length > 80) {
                                    stderrLines.splice(0, stderrLines.length - 80);
                                }
                                var timeSec = parseTimeFromChunk(text);
                                if (timeSec !== null && totalDurationSec > 0) {
                                    var percent = 50 + Math.min(50, (timeSec / totalDurationSec) * 50); // Step 2 = 50-100%
                                    var now = Date.now();
                                    if (now - lastEmit > 100) {
                                        lastEmit = now;
                                        emitProgress({
                                            requestId: requestId,
                                            stage: 'export',
                                            percent: percent,
                                            timeSec: timeSec,
                                            totalDurationSec: totalDurationSec,
                                            status: 'Đang ghi đè subtitle (bước 2/2)...',
                                        });
                                    }
                                }
                            });
                            child.on('error', function (error) {
                                reject(new Error("FFmpeg step 2 (burn subtitle) error: ".concat(error.message)));
                            });
                            child.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                                var e_2, tail;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            if (!(code === 0)) return [3 /*break*/, 5];
                                            console.log('[FinalExport] ✅ Step 2 completed: Subtitle burned');
                                            _a.label = 1;
                                        case 1:
                                            _a.trys.push([1, 3, , 4]);
                                            return [4 /*yield*/, fsp.unlink(inputVideoPath).catch(function () { })];
                                        case 2:
                                            _a.sent();
                                            return [3 /*break*/, 4];
                                        case 3:
                                            e_2 = _a.sent();
                                            return [3 /*break*/, 4];
                                        case 4:
                                            resolve();
                                            return [3 /*break*/, 6];
                                        case 5:
                                            tail = stderrLines.slice(-10).join('\n');
                                            reject(new Error("FFmpeg step 2 (burn subtitle) failed v\u1EDBi m\u00E3 ".concat(code, ". stderr:\n").concat(tail)));
                                            _a.label = 6;
                                        case 6: return [2 /*return*/];
                                    }
                                });
                            }); });
                        })];
            }
        });
    });
}
function runFinalCommand(opts) {
    return __awaiter(this, void 0, void 0, function () {
        var requestId, totalDurationSec, videoListPath, audioPath, outputPath, audioCodec, _a, forceReencode, _b, normalizeAudio, subtitle, emitProgress, tempVideoPath, ffmpegPath, codec, needAudioEncode, hasSubtitleText, hasSubtitleFile, needsSubtitle, needsReencode, useTwoStepProcess, videoCodecArgs, _c, gpuInfo, videoFilter, subtitleFile, subtitleTextFile, textToEscape, position, fontSize, fontColor, bgColor, bgOpacity, y, xPos, yPos, tempDir, escapedTextFile, subtitleFilePath, fileSize, fileContent, subtitleFormat, escapedSubtitleFile, useTwoStepProcessRecalc, shouldUseTwoStep, step1AlreadyDone, tempOutputPath_1, e_3, e_4;
        var _this = this;
        var _d, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    requestId = opts.requestId, totalDurationSec = opts.totalDurationSec, videoListPath = opts.videoListPath, audioPath = opts.audioPath, outputPath = opts.outputPath, audioCodec = opts.audioCodec, _a = opts.forceReencode, forceReencode = _a === void 0 ? false : _a, _b = opts.normalizeAudio, normalizeAudio = _b === void 0 ? false : _b, subtitle = opts.subtitle, emitProgress = opts.emitProgress, tempVideoPath = opts.tempVideoPath;
                    ffmpegPath = getFfmpegExecutable();
                    console.log('[FinalExport] runFinalCommand called:', {
                        hasSubtitle: !!subtitle,
                        subtitleEnabled: subtitle === null || subtitle === void 0 ? void 0 : subtitle.enabled,
                        hasSubtitleFile: !!(subtitle === null || subtitle === void 0 ? void 0 : subtitle.subtitleFile),
                        subtitleFile: subtitle === null || subtitle === void 0 ? void 0 : subtitle.subtitleFile,
                        subtitleFileExists: (subtitle === null || subtitle === void 0 ? void 0 : subtitle.subtitleFile) ? fs.existsSync(subtitle.subtitleFile) : false,
                        forceReencode: forceReencode,
                        tempVideoPath: tempVideoPath,
                        step1AlreadyDone: tempVideoPath && fs.existsSync(tempVideoPath),
                    });
                    return [4 /*yield*/, fsp.mkdir(path.dirname(outputPath), { recursive: true })
                        // Pre-build video encoder args (needs to be async, so do it before Promise constructor)
                    ];
                case 1:
                    _g.sent();
                    codec = (_d = audioCodec === null || audioCodec === void 0 ? void 0 : audioCodec.toLowerCase()) !== null && _d !== void 0 ? _d : null;
                    needAudioEncode = !codec || (codec !== 'aac' && codec !== 'mp3');
                    hasSubtitleText = (subtitle === null || subtitle === void 0 ? void 0 : subtitle.enabled) && subtitle.text && subtitle.text.trim();
                    hasSubtitleFile = (subtitle === null || subtitle === void 0 ? void 0 : subtitle.enabled) && subtitle.subtitleFile && fs.existsSync(subtitle.subtitleFile);
                    needsSubtitle = hasSubtitleText || hasSubtitleFile;
                    console.log('[FinalExport] Subtitle check:', {
                        hasSubtitleText: hasSubtitleText,
                        hasSubtitleFile: hasSubtitleFile,
                        needsSubtitle: needsSubtitle,
                        subtitleText: ((_e = subtitle === null || subtitle === void 0 ? void 0 : subtitle.text) === null || _e === void 0 ? void 0 : _e.substring(0, 50)) || '(empty)',
                        subtitleFilePath: (subtitle === null || subtitle === void 0 ? void 0 : subtitle.subtitleFile) || '(none)',
                    });
                    // Debug logging
                    if (subtitle === null || subtitle === void 0 ? void 0 : subtitle.enabled) {
                        console.log('[FinalExport] Subtitle enabled:', subtitle.enabled);
                        console.log('[FinalExport] Subtitle text:', subtitle.text);
                        console.log('[FinalExport] Subtitle file:', subtitle.subtitleFile);
                        console.log('[FinalExport] Subtitle file exists:', hasSubtitleFile);
                        console.log('[FinalExport] Subtitle style:', subtitle.subtitleStyle);
                    }
                    needsReencode = forceReencode || needsSubtitle;
                    useTwoStepProcess = needsSubtitle && !forceReencode;
                    if (useTwoStepProcess) {
                        console.log('[FinalExport] 📋 Using 2-step process: Concat video first, then burn subtitle');
                    }
                    else if (needsSubtitle && forceReencode) {
                        console.log('[FinalExport] ⚠️ Subtitle enabled with forceReencode=true. Using single-step process.');
                    }
                    if (!needsReencode) return [3 /*break*/, 3];
                    return [4 /*yield*/, buildVideoEncoderArgs(true, 'fast')]; // 'fast' quality for subtitle rendering
                case 2:
                    _c = _g.sent(); // 'fast' quality for subtitle rendering
                    return [3 /*break*/, 4];
                case 3:
                    _c = ['-c:v', 'copy'];
                    _g.label = 4;
                case 4:
                    videoCodecArgs = _c;
                    if (!needsReencode) return [3 /*break*/, 6];
                    return [4 /*yield*/, getGpuInfo()];
                case 5:
                    gpuInfo = _g.sent();
                    if (gpuInfo.available) {
                        console.log("[FinalExport] Using ".concat(gpuInfo.encoder.toUpperCase(), " encoder (").concat(gpuInfo.name || 'GPU', ") for video encoding"));
                    }
                    else {
                        console.log("[FinalExport] Using CPU encoder (libx264) - ".concat(gpuInfo.reason || 'GPU not available'));
                    }
                    _g.label = 6;
                case 6:
                    videoFilter = '';
                    subtitleFile = null;
                    subtitleTextFile = null // For drawtext textfile
                    ;
                    if (!(needsSubtitle && (subtitle === null || subtitle === void 0 ? void 0 : subtitle.text) && subtitle.text.trim() && !(subtitle === null || subtitle === void 0 ? void 0 : subtitle.subtitleFile))) return [3 /*break*/, 9];
                    textToEscape = subtitle.text.trim();
                    position = subtitle.position || 'bottom';
                    fontSize = subtitle.fontSize || 48;
                    fontColor = subtitle.fontColor || 'white';
                    bgColor = subtitle.backgroundColor || 'black';
                    bgOpacity = (_f = subtitle.backgroundOpacity) !== null && _f !== void 0 ? _f : 0.7;
                    y = subtitle.y;
                    if (y === undefined) {
                        switch (position) {
                            case 'top':
                                y = 10;
                                break;
                            case 'center':
                                y = 50;
                                break;
                            case 'bottom':
                            default:
                                y = 90;
                                break;
                        }
                    }
                    xPos = subtitle.x === undefined || subtitle.x === 50
                        ? '(w-text_w)/2' // Center
                        : "(w-text_w)*".concat(subtitle.x, "/100") // Percentage from left
                    ;
                    yPos = "(h-text_h)*".concat(y, "/100");
                    console.log("[FinalExport] Subtitle text length: ".concat(textToEscape.length, " chars, using textfile for safety"));
                    tempDir = path.join(os.tmpdir(), 'ffmpeg-subtitles');
                    return [4 /*yield*/, fsp.mkdir(tempDir, { recursive: true })];
                case 7:
                    _g.sent();
                    subtitleTextFile = path.join(tempDir, "subtitle-text-".concat(requestId, "-").concat(randomUUID(), ".txt"));
                    // Write text to file (no escaping needed for file content)
                    return [4 /*yield*/, fsp.writeFile(subtitleTextFile, textToEscape, 'utf-8')
                        // Escape file path for FFmpeg
                    ];
                case 8:
                    // Write text to file (no escaping needed for file content)
                    _g.sent();
                    escapedTextFile = path.resolve(subtitleTextFile).replace(/\\/g, '/');
                    escapedTextFile = escapedTextFile
                        .replace(/\\/g, '\\\\')
                        .replace(/'/g, "\\'")
                        .replace(/:/g, '\\:')
                        .replace(/\[/g, '\\[')
                        .replace(/\]/g, '\\]');
                    // Build filter using textfile parameter
                    // IMPORTANT: Don't add [v] label here - it will be added in filter_complex
                    videoFilter = "drawtext=textfile='".concat(escapedTextFile, "':fontsize=").concat(fontSize, ":fontcolor=").concat(fontColor, ":x=").concat(xPos, ":y=").concat(yPos, ":box=1:boxcolor=").concat(bgColor, "@").concat(bgOpacity, ":boxborderw=10");
                    console.log('[FinalExport] ✅ Using textfile for subtitle text:', subtitleTextFile);
                    console.log('[FinalExport] ✅ videoFilter built (last 50 chars):', videoFilter.substring(Math.max(0, videoFilter.length - 50)));
                    _g.label = 9;
                case 9:
                    subtitleFilePath = subtitle === null || subtitle === void 0 ? void 0 : subtitle.subtitleFile;
                    if (subtitleFilePath && fs.existsSync(subtitleFilePath)) {
                        subtitleFile = subtitleFilePath;
                        console.log('[FinalExport] ✅ Found subtitle file:', subtitleFile);
                        // Validate subtitle file (subtitleFile is guaranteed to be string here)
                        if (subtitleFile) {
                            fileSize = fs.statSync(subtitleFile).size;
                            if (fileSize === 0) {
                                throw new Error("Subtitle file is empty: ".concat(subtitleFile));
                            }
                            fileContent = fs.readFileSync(subtitleFile, 'utf-8');
                            subtitleFormat = (subtitle === null || subtitle === void 0 ? void 0 : subtitle.subtitleFormat) || 'ass';
                            // Validate format
                            if (subtitleFormat === 'ass') {
                                if (!fileContent.includes('[Script Info]') && !fileContent.includes('[V4+ Styles]')) {
                                    console.warn("[FinalExport] \u26A0\uFE0F Subtitle file may not be valid ASS format (missing [Script Info] or [V4+ Styles])");
                                }
                                else {
                                    console.log("[FinalExport] \u2705 Subtitle file is valid ASS format");
                                }
                            }
                            else if (subtitleFormat === 'srt') {
                                if (!fileContent.match(/^\d+\s*$/m) && !fileContent.includes('-->')) {
                                    console.warn("[FinalExport] \u26A0\uFE0F Subtitle file may not be valid SRT format (missing sequence numbers or timestamps)");
                                }
                                else {
                                    console.log("[FinalExport] \u2705 Subtitle file is valid SRT format");
                                }
                            }
                            escapedSubtitleFile = path.resolve(subtitleFile).replace(/\\/g, '/');
                            escapedSubtitleFile = escapedSubtitleFile
                                .replace(/\\/g, '\\\\')
                                .replace(/'/g, "\\'")
                                .replace(/:/g, '\\:')
                                .replace(/\[/g, '\\[')
                                .replace(/\]/g, '\\]');
                            // Use FFmpeg subtitles filter for .srt/.ass files (supports karaoke effects)
                            videoFilter = "subtitles='".concat(escapedSubtitleFile, "'");
                        }
                        console.log('[FinalExport] ✅ Using subtitle file with karaoke effects');
                        console.log('[FinalExport] ✅ FFmpeg filter:', videoFilter.substring(0, 150) + '...');
                    }
                    else if (needsSubtitle && !videoFilter) {
                        console.warn('[FinalExport] Subtitle enabled but no text or file, skipping subtitle filter');
                    }
                    useTwoStepProcessRecalc = needsSubtitle && !forceReencode;
                    console.log('[FinalExport] 🔍 Debug 2-step check:', {
                        useTwoStepProcess: useTwoStepProcessRecalc,
                        needsSubtitle: needsSubtitle,
                        forceReencode: forceReencode,
                        hasVideoFilter: !!videoFilter,
                        videoFilterLength: (videoFilter === null || videoFilter === void 0 ? void 0 : videoFilter.length) || 0,
                        hasSubtitle: !!subtitle,
                        subtitleEnabled: subtitle === null || subtitle === void 0 ? void 0 : subtitle.enabled,
                        videoFilterPreview: videoFilter ? videoFilter.substring(0, 100) : '(empty)',
                    });
                    shouldUseTwoStep = useTwoStepProcessRecalc && videoFilter && videoFilter.trim().length > 0;
                    console.log('[FinalExport] 🔍 2-step decision:', {
                        shouldUseTwoStep: shouldUseTwoStep,
                        useTwoStepProcessRecalc: useTwoStepProcessRecalc,
                        needsSubtitle: needsSubtitle,
                        forceReencode: forceReencode,
                        hasVideoFilter: !!videoFilter && videoFilter.trim().length > 0,
                    });
                    step1AlreadyDone = tempVideoPath && fs.existsSync(tempVideoPath);
                    if (!(shouldUseTwoStep && !step1AlreadyDone)) return [3 /*break*/, 16];
                    console.log('[FinalExport] 🔄 Step 1/2: Concat video (copy-stream, fast)');
                    // Emit progress to show we're starting 2-step process
                    if (emitProgress) {
                        emitProgress({
                            requestId: requestId,
                            stage: 'export',
                            percent: 0,
                            timeSec: 0,
                            totalDurationSec: totalDurationSec,
                            status: '[Bước 1/2] Đang ghép video (copy-stream, nhanh)...',
                        });
                    }
                    tempOutputPath_1 = outputPath.replace(/\.mp4$/, '.temp.mp4');
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var _a;
                            var shouldNormalizeAudio = normalizeAudio;
                            var shouldEncodeAudio = forceReencode || needAudioEncode || shouldNormalizeAudio;
                            var audioCodecArgs = shouldEncodeAudio
                                ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
                                : ['-c:a', 'copy'];
                            var audioFilterArgs = shouldNormalizeAudio
                                ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
                                : [];
                            var args = __spreadArray(__spreadArray(__spreadArray([
                                '-hide_banner',
                                '-loglevel', 'error',
                                '-stats',
                                '-f', 'concat',
                                '-safe', '0',
                                '-i', videoListPath,
                                '-i', audioPath,
                                '-map', '0:v:0',
                                '-map', '1:a:0',
                                '-c:v', 'copy'
                            ], audioFilterArgs, true), audioCodecArgs, true), [
                                '-avoid_negative_ts', 'make_zero',
                                '-t', totalDurationSec.toFixed(3),
                                '-y', tempOutputPath_1,
                            ], false);
                            var child = spawn(ffmpegPath, args, { windowsHide: true });
                            videoJobManager.registerJob(requestId, child);
                            var lastEmit = 0;
                            var stderrLines = [];
                            (_a = child.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                                if (videoJobManager.isCancelled(requestId)) {
                                    if (!child.killed) {
                                        child.kill('SIGTERM');
                                        setTimeout(function () {
                                            if (!child.killed)
                                                child.kill('SIGKILL');
                                        }, 2000);
                                    }
                                    return;
                                }
                                var text = chunk.toString('utf-8');
                                stderrLines.push.apply(stderrLines, text.split(/\r?\n/).filter(Boolean));
                                if (stderrLines.length > 80) {
                                    stderrLines.splice(0, stderrLines.length - 80);
                                }
                                var timeSec = parseTimeFromChunk(text);
                                if (timeSec !== null && totalDurationSec > 0) {
                                    var percent = Math.min(50, (timeSec / totalDurationSec) * 50); // Step 1 = 0-50%
                                    var now = Date.now();
                                    if (now - lastEmit > 100) {
                                        lastEmit = now;
                                        emitProgress({
                                            requestId: requestId,
                                            stage: 'export',
                                            percent: percent,
                                            timeSec: timeSec,
                                            totalDurationSec: totalDurationSec,
                                            status: 'Đang ghép video (bước 1/2)...',
                                        });
                                    }
                                }
                            });
                            child.on('error', function (error) {
                                reject(new Error("FFmpeg step 1 (concat) error: ".concat(error.message)));
                            });
                            child.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                                var tail;
                                return __generator(this, function (_a) {
                                    if (code === 0) {
                                        console.log('[FinalExport] ✅ Step 1 completed: Video concatenated');
                                        resolve();
                                    }
                                    else {
                                        tail = stderrLines.slice(-10).join('\n');
                                        reject(new Error("FFmpeg step 1 (concat) failed v\u1EDBi m\u00E3 ".concat(code, ". stderr:\n").concat(tail)));
                                    }
                                    return [2 /*return*/];
                                });
                            }); });
                        })
                        // Step 2: Burn subtitle into temp file (re-encode with GPU)
                    ];
                case 10:
                    _g.sent();
                    // Step 2: Burn subtitle into temp file (re-encode with GPU)
                    console.log('[FinalExport] 🔄 Step 2/2: Burn subtitle (re-encode with GPU)');
                    // Emit progress to show we're starting step 2
                    if (emitProgress) {
                        emitProgress({
                            requestId: requestId,
                            stage: 'export',
                            percent: 50,
                            timeSec: 0,
                            totalDurationSec: totalDurationSec,
                            status: '[Bước 2/2] Đang burn subtitle vào video (GPU encoding)...',
                        });
                    }
                    return [4 /*yield*/, burnSubtitleIntoVideo(tempOutputPath_1, outputPath, subtitle, videoFilter, requestId, totalDurationSec, emitProgress)
                        // Clean up temp file if we created it
                    ];
                case 11:
                    _g.sent();
                    if (!fs.existsSync(tempOutputPath_1)) return [3 /*break*/, 15];
                    _g.label = 12;
                case 12:
                    _g.trys.push([12, 14, , 15]);
                    return [4 /*yield*/, fsp.unlink(tempOutputPath_1)];
                case 13:
                    _g.sent();
                    console.log('[FinalExport] ✅ Cleaned up temp video file');
                    return [3 /*break*/, 15];
                case 14:
                    e_3 = _g.sent();
                    console.warn('[FinalExport] ⚠️ Failed to clean up temp video file:', e_3);
                    return [3 /*break*/, 15];
                case 15: return [2 /*return*/]; // Exit early, don't run single-step process
                case 16:
                    if (!(shouldUseTwoStep && step1AlreadyDone)) return [3 /*break*/, 22];
                    // Step 1 already done, only run Step 2
                    console.log('[FinalExport] 🔄 Step 2/2: Burn subtitle (re-encode with GPU) - Step 1 already done');
                    if (emitProgress) {
                        emitProgress({
                            requestId: requestId,
                            stage: 'export',
                            percent: 50,
                            timeSec: 0,
                            totalDurationSec: totalDurationSec,
                            status: '[Bước 2/2] Đang burn subtitle vào video (GPU encoding)...',
                        });
                    }
                    return [4 /*yield*/, burnSubtitleIntoVideo(tempVideoPath, outputPath, subtitle, videoFilter, requestId, totalDurationSec, emitProgress)
                        // Clean up temp file
                    ];
                case 17:
                    _g.sent();
                    if (!fs.existsSync(tempVideoPath)) return [3 /*break*/, 21];
                    _g.label = 18;
                case 18:
                    _g.trys.push([18, 20, , 21]);
                    return [4 /*yield*/, fsp.unlink(tempVideoPath)];
                case 19:
                    _g.sent();
                    console.log('[FinalExport] ✅ Cleaned up temp video file');
                    return [3 /*break*/, 21];
                case 20:
                    e_4 = _g.sent();
                    console.warn('[FinalExport] ⚠️ Failed to clean up temp video file:', e_4);
                    return [3 /*break*/, 21];
                case 21: return [2 /*return*/]; // Exit early, don't run single-step process
                case 22: 
                // Original single-step process (when no subtitle or forceReencode=true)
                return [4 /*yield*/, new Promise(function (resolve, reject) {
                        var _a;
                        var shouldNormalizeAudio = normalizeAudio;
                        var shouldEncodeAudio = forceReencode || needAudioEncode || shouldNormalizeAudio;
                        var audioCodecArgs = shouldEncodeAudio
                            ? ['-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2']
                            : ['-c:a', 'copy'];
                        var audioFilterArgs = shouldNormalizeAudio
                            ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
                            : [];
                        // videoFilter was already built above (before Promise constructor)
                        if (needsSubtitle && videoFilter) {
                            console.log('[FinalExport] Using pre-built videoFilter:', videoFilter.includes('subtitles=') ? 'subtitles file' : 'drawtext');
                        }
                        else if (needsSubtitle && !videoFilter) {
                            console.warn('[FinalExport] Subtitle enabled but filter not created, skipping subtitle');
                        }
                        // REMOVED: Subtitle file processing moved outside Promise constructor (before 2-step check)
                        // This ensures videoFilter is ready before checking useTwoStepProcess
                        // CRITICAL VALIDATION: videoFilter must NOT contain [v] (if it exists)
                        if (videoFilter && videoFilter.includes('[v]')) {
                            console.error('[FinalExport] ❌ CRITICAL ERROR: videoFilter contains [v] label!');
                            console.error('[FinalExport] videoFilter:', videoFilter);
                            throw new Error('videoFilter must not contain [v] label - it will be added in filter_complex');
                        }
                        var args = [
                            '-hide_banner',
                            '-loglevel',
                            'error',
                            '-stats',
                            '-f',
                            'concat',
                            '-safe',
                            '0',
                            '-i',
                            videoListPath,
                            '-i',
                            audioPath,
                        ];
                        // Add video filter if subtitle is enabled and filter is valid
                        if (needsSubtitle && videoFilter && videoFilter.trim().length > 0) {
                            // Validate filter string before using
                            if (!videoFilter.includes('drawtext=') && !videoFilter.includes('subtitles=')) {
                                console.error('[FinalExport] Invalid video filter, missing drawtext or subtitles:', videoFilter);
                                throw new Error('Invalid subtitle filter configuration');
                            }
                            // Debug: Log videoFilter before processing
                            console.log('[FinalExport] 🔍 videoFilter before processing (first 200 chars):', videoFilter.substring(0, 200));
                            console.log('[FinalExport] 🔍 videoFilter before processing (last 50 chars):', videoFilter.substring(Math.max(0, videoFilter.length - 50)));
                            console.log('[FinalExport] 🔍 videoFilter ends with [v]:', videoFilter.trim().endsWith('[v]'));
                            // For subtitles filter, apply directly to video stream using -vf
                            // For drawtext, use filter_complex with output label
                            if (videoFilter.includes('subtitles=')) {
                                // subtitles filter applies directly, no need for [v] label
                                args.push('-vf', videoFilter);
                                args.push('-map', '0:v:0');
                            }
                            else if (videoFilter.includes('drawtext=')) {
                                // drawtext needs filter_complex
                                // IMPORTANT: videoFilter should NOT contain [v] - we add it here
                                // Make sure videoFilter doesn't already have [v] at the end
                                // CRITICAL: videoFilter should NOT contain [v] - validate and clean if needed
                                var cleanFilter = videoFilter.trim();
                                // Remove [v] from anywhere in the string (should not exist, but safety check)
                                var originalFilter = cleanFilter;
                                cleanFilter = cleanFilter.replace(/\[v\]/g, '').trim();
                                if (originalFilter !== cleanFilter) {
                                    console.error('[FinalExport] ❌ CRITICAL: Found [v] in videoFilter!');
                                    console.error('[FinalExport] Original (last 100 chars):', originalFilter.substring(Math.max(0, originalFilter.length - 100)));
                                    console.error('[FinalExport] Cleaned (last 100 chars):', cleanFilter.substring(Math.max(0, cleanFilter.length - 100)));
                                }
                                // Final validation: cleanFilter must NOT contain [v]
                                if (cleanFilter.includes('[v]')) {
                                    console.error('[FinalExport] ❌ CRITICAL ERROR: cleanFilter still contains [v] after cleanup!');
                                    throw new Error('CRITICAL: cleanFilter contains [v] - this will cause FFmpeg error!');
                                }
                                // Build filter_complex: [0:v]drawtext=...[v]
                                // Format: [0:v]drawtext=textfile='...':fontsize=48:...:boxborderw=10[v]
                                var filterComplex = "[0:v]".concat(cleanFilter, "[v]");
                                console.log('[FinalExport] ✅ Drawtext filter_complex (first 300 chars):', filterComplex.substring(0, 300));
                                console.log('[FinalExport] ✅ Drawtext filter_complex (last 50 chars):', filterComplex.substring(Math.max(0, filterComplex.length - 50)));
                                console.log('[FinalExport] ✅ Validation:', {
                                    startsWith: filterComplex.startsWith('[0:v]'),
                                    endsWith: filterComplex.endsWith('[v]'),
                                    cleanFilterContainsV: cleanFilter.includes('[v]'),
                                    cleanFilterEndsWith: cleanFilter.substring(Math.max(0, cleanFilter.length - 10)),
                                });
                                args.push('-filter_complex', filterComplex);
                                args.push('-map', '[v]');
                            }
                            else {
                                console.error('[FinalExport] Unknown video filter type:', videoFilter.substring(0, 100));
                                throw new Error('Invalid video filter type');
                            }
                            console.log('[FinalExport] Using subtitle filter, re-encoding video');
                        }
                        else {
                            args.push('-map', '0:v:0');
                            if (needsSubtitle && !videoFilter) {
                                console.warn('[FinalExport] Subtitle enabled but filter not created, using video copy');
                            }
                        }
                        args.push.apply(args, __spreadArray(__spreadArray(__spreadArray(__spreadArray(['-map', '1:a:0'], videoCodecArgs, false), audioFilterArgs, false), audioCodecArgs, false), ['-avoid_negative_ts',
                            'make_zero',
                            '-t',
                            totalDurationSec.toFixed(3),
                            '-y',
                            outputPath], false));
                        var child = spawn(ffmpegPath, args, { windowsHide: true });
                        videoJobManager.registerJob(requestId, child);
                        var lastEmit = 0;
                        var lastTimeSec = null;
                        var stderrLines = [];
                        var dropWarned = false;
                        (_a = child.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                            // Kiểm tra cancel trong quá trình xử lý
                            if (videoJobManager.isCancelled(requestId)) {
                                if (!child.killed) {
                                    child.kill('SIGTERM');
                                    setTimeout(function () {
                                        if (!child.killed) {
                                            child.kill('SIGKILL');
                                        }
                                    }, 2000);
                                }
                                return;
                            }
                            var text = chunk.toString('utf-8');
                            stderrLines.push.apply(stderrLines, text.split(/\r?\n/).filter(Boolean));
                            if (stderrLines.length > 80) {
                                stderrLines.splice(0, stderrLines.length - 80);
                            }
                            var timeSec = parseTimeFromChunk(text);
                            var speedX = parseSpeedFromChunk(text);
                            if (timeSec !== null && totalDurationSec > 0) {
                                var percent = Math.min(100, (timeSec / totalDurationSec) * 100);
                                var now = Date.now();
                                // Giảm debounce từ 200ms xuống 100ms để cập nhật thường xuyên hơn
                                if (now - lastEmit > 100) {
                                    lastEmit = now;
                                    var etaSec = speedX && speedX > 0 ? Math.max(0, (totalDurationSec - timeSec) / Math.max(speedX, 0.1)) : undefined;
                                    emitProgress({
                                        requestId: requestId,
                                        stage: 'export',
                                        percent: percent,
                                        timeSec: timeSec,
                                        totalDurationSec: totalDurationSec,
                                        speedX: speedX !== null && speedX !== void 0 ? speedX : undefined,
                                        etaSec: etaSec,
                                    });
                                }
                                // Lưu lại timeSec cuối cùng để dùng khi close
                                lastTimeSec = timeSec;
                            }
                            // Log drop-frame / retry warnings if FFmpeg báo
                            if (!dropWarned && /drop=\d+/i.test(text)) {
                                dropWarned = true;
                                console.warn('[FinalExport] FFmpeg báo drop-frame trong quá trình export:\n', text);
                                emitProgress({
                                    requestId: requestId,
                                    stage: 'export',
                                    percent: 100,
                                    timeSec: timeSec !== null && timeSec !== void 0 ? timeSec : undefined,
                                    totalDurationSec: totalDurationSec,
                                    speedX: speedX !== null && speedX !== void 0 ? speedX : undefined,
                                    etaSec: 0,
                                    status: '⚠️ FFmpeg báo drop-frame, hãy kiểm tra lại video sau khi xuất.',
                                });
                            }
                        });
                        child.on('error', function (error) { return __awaiter(_this, void 0, void 0, function () {
                            var cleanupError_1;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        if (!(subtitleFile && fs.existsSync(subtitleFile))) return [3 /*break*/, 4];
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 3, , 4]);
                                        return [4 /*yield*/, fsp.unlink(subtitleFile).catch(function () { })];
                                    case 2:
                                        _a.sent();
                                        return [3 /*break*/, 4];
                                    case 3:
                                        cleanupError_1 = _a.sent();
                                        return [3 /*break*/, 4];
                                    case 4:
                                        reject(new Error("FFmpeg spawn error: ".concat(error.message)));
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        child.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                            var error_10, finalTimeSec, stats, stderrText, isBufferQueueWarning, finalTimeSec, checkError_1, tail;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        if (!(subtitleFile && fs.existsSync(subtitleFile))) return [3 /*break*/, 4];
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 3, , 4]);
                                        return [4 /*yield*/, fsp.unlink(subtitleFile).catch(function () { })];
                                    case 2:
                                        _a.sent();
                                        return [3 /*break*/, 4];
                                    case 3:
                                        error_10 = _a.sent();
                                        return [3 /*break*/, 4];
                                    case 4:
                                        if (!(code === 0)) return [3 /*break*/, 5];
                                        finalTimeSec = lastTimeSec !== null && lastTimeSec >= totalDurationSec ? totalDurationSec : totalDurationSec;
                                        emitProgress({
                                            requestId: requestId,
                                            stage: 'finishing',
                                            percent: 100,
                                            timeSec: finalTimeSec,
                                            totalDurationSec: totalDurationSec,
                                            speedX: undefined,
                                            etaSec: 0,
                                        });
                                        resolve();
                                        return [3 /*break*/, 9];
                                    case 5:
                                        _a.trys.push([5, 7, , 8]);
                                        return [4 /*yield*/, fsp.stat(outputPath)];
                                    case 6:
                                        stats = _a.sent();
                                        if (stats.size > 0) {
                                            stderrText = stderrLines.join('\n');
                                            isBufferQueueWarning = /buffers queued|Error marking filters as finished/i.test(stderrText);
                                            if (isBufferQueueWarning) {
                                                // Đây là warning thường gặp, không phải lỗi thực sự
                                                console.warn("[FinalExport] FFmpeg exited with code ".concat(code, " nh\u01B0ng file output t\u1ED3n t\u1EA1i v\u00E0 h\u1EE3p l\u1EC7 (").concat(formatBytes(stats.size), "). ") +
                                                    "\u0110\u00E2y l\u00E0 warning v\u1EC1 buffer queue (kh\u00F4ng \u1EA3nh h\u01B0\u1EDFng ch\u1EA5t l\u01B0\u1EE3ng video).");
                                                finalTimeSec = lastTimeSec !== null && lastTimeSec >= totalDurationSec ? totalDurationSec : totalDurationSec;
                                                emitProgress({
                                                    requestId: requestId,
                                                    stage: 'finishing',
                                                    percent: 100,
                                                    timeSec: finalTimeSec,
                                                    totalDurationSec: totalDurationSec,
                                                    speedX: undefined,
                                                    etaSec: 0,
                                                });
                                                resolve();
                                                return [2 /*return*/];
                                            }
                                        }
                                        return [3 /*break*/, 8];
                                    case 7:
                                        checkError_1 = _a.sent();
                                        return [3 /*break*/, 8];
                                    case 8:
                                        tail = stderrLines.slice(-10).join('\n');
                                        reject(new Error("FFmpeg final export failed v\u1EDBi m\u00E3 ".concat(code, ". stderr:\n").concat(tail)));
                                        _a.label = 9;
                                    case 9: return [2 /*return*/];
                                }
                            });
                        }); });
                    })];
                case 23:
                    // Original single-step process (when no subtitle or forceReencode=true)
                    _g.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function cleanupTempDir(dir) {
    return __awaiter(this, void 0, void 0, function () {
        var error_11;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!dir)
                        return [2 /*return*/];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, fsp.rm(dir, { recursive: true, force: true })];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    error_11 = _a.sent();
                    console.warn('[FinalExport] Không thể xoá thư mục tạm:', error_11);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
export function scanAudioSource(payload) {
    return __awaiter(this, void 0, void 0, function () {
        var files, totalDurationSec;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, loadAudioFiles(payload.audioSource)];
                case 1:
                    files = _a.sent();
                    totalDurationSec = files.reduce(function (sum, f) { return sum + f.durationSec; }, 0);
                    return [2 /*return*/, {
                            requestId: payload.requestId,
                            kind: 'audio',
                            fileCount: files.length,
                            totalDurationSec: totalDurationSec,
                            items: files.map(function (f) { return ({
                                path: f.path,
                                durationSec: f.durationSec,
                                codecName: f.codecName,
                            }); }),
                        }];
            }
        });
    });
}
export function scanVideoSource(payload) {
    return __awaiter(this, void 0, void 0, function () {
        var clips, totalDurationSec;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, loadVideoClips(payload.videoSource)];
                case 1:
                    clips = _a.sent();
                    totalDurationSec = clips.clips.reduce(function (sum, c) { return sum + c.durationSec; }, 0);
                    return [2 /*return*/, {
                            requestId: payload.requestId,
                            kind: 'video',
                            fileCount: clips.clips.length,
                            totalDurationSec: totalDurationSec,
                            items: clips.clips.map(function (clip) { return ({
                                path: clip.path,
                                durationSec: clip.durationSec,
                            }); }),
                        }];
            }
        });
    });
}
export function exportFinalVideo(request, emitter) {
    return __awaiter(this, void 0, void 0, function () {
        var requestId, plan, error_12;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    requestId = request.requestId || randomUUID();
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, planFinalExport(request.audioSource, request.videoSource, request.outputFolder, request.outputFilename, request.outputNames, request.priorityVideoSource)
                        // Emit initial progress
                    ];
                case 2:
                    plan = _a.sent();
                    // Emit initial progress
                    emitter.progress({
                        requestId: requestId,
                        stage: 'prepare-audio',
                        percent: 0,
                        timeSec: 0,
                        totalDurationSec: 0,
                        audioFileCount: plan.totalJobs,
                        videoFileCount: plan.videoClips.length,
                        totalOutputs: plan.totalJobs,
                        status: plan.totalJobs > 1
                            ? "\u0110ang chu\u1EA9n b\u1ECB ".concat(plan.totalJobs, " track audio...")
                            : 'Đang chuẩn bị audio...',
                    });
                    // Step 2: Execute - chạy từng job
                    return [4 /*yield*/, executeFinalExport(plan, requestId, emitter, request.shuffle || false, !!request.forceReencode, !!request.normalizeAudio, !!request.tracklistAuto, request.subtitle)];
                case 3:
                    // Step 2: Execute - chạy từng job
                    _a.sent();
                    return [3 /*break*/, 5];
                case 4:
                    error_12 = _a.sent();
                    console.error('[FinalExport] Lỗi export video hoàn chỉnh:', error_12);
                    emitter.error({
                        requestId: requestId,
                        error: (error_12 === null || error_12 === void 0 ? void 0 : error_12.message) || 'Xuất video thất bại.',
                        message: error_12 === null || error_12 === void 0 ? void 0 : error_12.message,
                    });
                    throw error_12;
                case 5: return [2 /*return*/];
            }
        });
    });
}
