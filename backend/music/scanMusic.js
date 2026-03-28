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
import { createHash } from 'crypto';
import { probeFile } from '../ffmpeg/probe';
import { saveScanResult } from './scanStore';
var SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg'];
function isSupportedAudioExtension(fileName) {
    var ext = path.extname(fileName).toLowerCase();
    return SUPPORTED_AUDIO_EXTENSIONS.includes(ext);
}
function getAllAudioFiles(dir) {
    var files = [];
    function walkDir(currentDir) {
        try {
            var entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                var entry = entries_1[_i];
                var fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath);
                }
                else if (entry.isFile() && isSupportedAudioExtension(entry.name)) {
                    files.push(fullPath);
                }
            }
        }
        catch (err) {
            console.warn("[ScanMusic] Failed to read directory ".concat(currentDir, ":"), err);
        }
    }
    walkDir(dir);
    return files;
}
function runWithConcurrency(items, limit, worker) {
    return __awaiter(this, void 0, void 0, function () {
        var results, executing, _loop_1, i;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    results = new Array(items.length);
                    executing = [];
                    _loop_1 = function (i) {
                        var item, index, promise;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    item = items[i];
                                    index = i;
                                    promise = worker(item)
                                        .then(function (result) {
                                        results[index] = result;
                                    })
                                        .catch(function (err) {
                                        console.warn("[ScanMusic] Worker failed for item ".concat(index, ":"), err);
                                        results[index] = null;
                                    })
                                        .then(function () {
                                        // Remove from executing when done
                                        var execIndex = executing.findIndex(function (e) { return e.index === index; });
                                        if (execIndex >= 0) {
                                            executing.splice(execIndex, 1);
                                        }
                                    });
                                    executing.push({ promise: promise, index: index });
                                    if (!(executing.length >= limit)) return [3 /*break*/, 2];
                                    return [4 /*yield*/, Promise.race(executing.map(function (e) { return e.promise; }))];
                                case 1:
                                    _b.sent();
                                    _b.label = 2;
                                case 2: return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _a.label = 1;
                case 1:
                    if (!(i < items.length)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(i)];
                case 2:
                    _a.sent();
                    _a.label = 3;
                case 3:
                    i++;
                    return [3 /*break*/, 1];
                case 4: 
                // Wait for all remaining promises
                return [4 /*yield*/, Promise.all(executing.map(function (e) { return e.promise; }))
                    // Filter out null results
                ];
                case 5:
                    // Wait for all remaining promises
                    _a.sent();
                    // Filter out null results
                    return [2 /*return*/, results.filter(function (r) { return r !== null; })];
            }
        });
    });
}
function scanSingleFile(filePath, folderType) {
    return __awaiter(this, void 0, void 0, function () {
        var probeResult, id, fileName, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    // Medium: check file exists trước khi probe để tránh lỗi không cần thiết
                    if (!fs.existsSync(filePath)) {
                        console.warn("[ScanMusic] File not found (skip): ".concat(filePath));
                        return [2 /*return*/, null];
                    }
                    return [4 /*yield*/, probeFile(filePath)];
                case 1:
                    probeResult = _a.sent();
                    if (!probeResult.audio) {
                        console.warn("[ScanMusic] File has no audio stream: ".concat(filePath));
                        return [2 /*return*/, null];
                    }
                    id = createHash('md5').update(filePath).digest('hex');
                    fileName = path.basename(filePath);
                    return [2 /*return*/, {
                            id: id,
                            path: filePath,
                            fileName: fileName,
                            folderType: folderType,
                            duration: probeResult.format.duration || 0,
                            size: probeResult.format.size || 0,
                            codec: probeResult.audio.codec,
                            bitrate: probeResult.format.bit_rate
                                ? Math.round(probeResult.format.bit_rate / 1000)
                                : undefined, // Convert to kbps
                        }];
                case 2:
                    err_1 = _a.sent();
                    console.warn("[ScanMusic] Failed to probe file ".concat(filePath, ":"), err_1);
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
export function scanMusicFolders(payload) {
    return __awaiter(this, void 0, void 0, function () {
        var priorityFolder, randomFolder, allTracks, priorityFiles, priorityTracks_1, randomFiles, randomTracks_1, priorityTracks, randomTracks, summary, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    priorityFolder = payload.priorityFolder, randomFolder = payload.randomFolder;
                    if (!priorityFolder && !randomFolder) {
                        throw new Error('No folders provided');
                    }
                    allTracks = [];
                    if (!priorityFolder) return [3 /*break*/, 2];
                    if (!fs.existsSync(priorityFolder)) {
                        throw new Error("Priority folder does not exist: ".concat(priorityFolder));
                    }
                    console.log("[ScanMusic] Scanning priority folder: ".concat(priorityFolder));
                    priorityFiles = getAllAudioFiles(priorityFolder);
                    console.log("[ScanMusic] priorityFiles: ".concat(priorityFiles.length));
                    return [4 /*yield*/, runWithConcurrency(priorityFiles, 5, // Limit to 5 concurrent probes
                        function (filePath) { return scanSingleFile(filePath, 'priority'); })];
                case 1:
                    priorityTracks_1 = _a.sent();
                    console.log("[ScanMusic] priorityTracks scanned: ".concat(priorityTracks_1.length));
                    allTracks.push.apply(allTracks, priorityTracks_1.filter(function (track) { return track !== null; }));
                    _a.label = 2;
                case 2:
                    if (!randomFolder) return [3 /*break*/, 4];
                    if (!fs.existsSync(randomFolder)) {
                        throw new Error("Random folder does not exist: ".concat(randomFolder));
                    }
                    console.log("[ScanMusic] Scanning random folder: ".concat(randomFolder));
                    randomFiles = getAllAudioFiles(randomFolder);
                    console.log("[ScanMusic] randomFiles: ".concat(randomFiles.length));
                    return [4 /*yield*/, runWithConcurrency(randomFiles, 5, // Limit to 5 concurrent probes
                        function (filePath) { return scanSingleFile(filePath, 'random'); })];
                case 3:
                    randomTracks_1 = _a.sent();
                    console.log("[ScanMusic] randomTracks scanned: ".concat(randomTracks_1.length));
                    allTracks.push.apply(allTracks, randomTracks_1.filter(function (track) { return track !== null; }));
                    _a.label = 4;
                case 4:
                    priorityTracks = allTracks.filter(function (t) { return t.folderType === 'priority'; });
                    randomTracks = allTracks.filter(function (t) { return t.folderType === 'random'; });
                    console.log("[ScanMusic] tracks total: ".concat(allTracks.length));
                    summary = {
                        priorityCount: priorityTracks.length,
                        randomCount: randomTracks.length,
                        totalCount: allTracks.length,
                        priorityDuration: priorityTracks.reduce(function (sum, t) { return sum + t.duration; }, 0),
                        randomDuration: randomTracks.reduce(function (sum, t) { return sum + t.duration; }, 0),
                        totalDuration: allTracks.reduce(function (sum, t) { return sum + t.duration; }, 0),
                    };
                    result = {
                        tracks: allTracks,
                        summary: summary,
                        scannedAt: Date.now(),
                    };
                    saveScanResult(result);
                    return [2 /*return*/, result];
            }
        });
    });
}
