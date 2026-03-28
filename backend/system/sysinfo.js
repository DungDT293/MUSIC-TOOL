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
import os from 'node:os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { runFfprobe } from '../ffmpeg/wrapper';
var execAsync = promisify(exec);
function getGpuModel() {
    return __awaiter(this, void 0, void 0, function () {
        var stdout, lines, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!(process.platform === 'win32')) return [3 /*break*/, 4];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, execAsync('wmic path win32_VideoController get name')];
                case 2:
                    stdout = (_b.sent()).stdout;
                    lines = stdout
                        .split('\n')
                        .map(function (line) { return line.trim(); })
                        .filter(function (line) { return line && line !== 'Name' && !line.startsWith('---'); });
                    return [2 /*return*/, lines[0] || undefined];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, undefined];
                case 4: 
                // Linux/Mac: đơn giản trả undefined
                return [2 /*return*/, undefined];
            }
        });
    });
}
function getDrives() {
    return __awaiter(this, void 0, void 0, function () {
        var stdout, drives, entries, _i, entries_1, entry, nameMatch, sizeMatch, freeMatch, mount, size, free, _a, stdout, lines, drives, _b, lines_1, line, parts, mount, totalKB, freeKB, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (!(process.platform === 'win32')) return [3 /*break*/, 5];
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, execAsync('wmic logicaldisk get name,size,freespace /format:list')];
                case 2:
                    stdout = (_d.sent()).stdout;
                    drives = [];
                    entries = stdout.split(/\r?\n\r?\n/).filter(function (entry) { return entry.trim(); });
                    for (_i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                        entry = entries_1[_i];
                        nameMatch = entry.match(/Name=([A-Z]:)/i);
                        sizeMatch = entry.match(/Size=(\d+)/i);
                        freeMatch = entry.match(/FreeSpace=(\d+)/i);
                        if (nameMatch && sizeMatch && freeMatch) {
                            mount = nameMatch[1];
                            size = parseInt(sizeMatch[1], 10);
                            free = parseInt(freeMatch[1], 10);
                            if (!isNaN(size) && !isNaN(free)) {
                                drives.push({
                                    mount: mount,
                                    totalGB: Math.round((size / 1024 / 1024 / 1024) * 100) / 100,
                                    freeGB: Math.round((free / 1024 / 1024 / 1024) * 100) / 100,
                                });
                            }
                        }
                    }
                    return [2 /*return*/, drives];
                case 3:
                    _a = _d.sent();
                    return [2 /*return*/, []];
                case 4: return [3 /*break*/, 8];
                case 5:
                    _d.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, execAsync('df -k')];
                case 6:
                    stdout = (_d.sent()).stdout;
                    lines = stdout.split('\n').slice(1) // Bỏ header
                    ;
                    drives = [];
                    for (_b = 0, lines_1 = lines; _b < lines_1.length; _b++) {
                        line = lines_1[_b];
                        parts = line.trim().split(/\s+/);
                        if (parts.length >= 4) {
                            mount = parts[parts.length - 1];
                            totalKB = parseInt(parts[1], 10);
                            freeKB = parseInt(parts[3], 10);
                            if (!isNaN(totalKB) && !isNaN(freeKB) && mount.startsWith('/')) {
                                drives.push({
                                    mount: mount,
                                    totalGB: Math.round((totalKB / 1024 / 1024) * 100) / 100,
                                    freeGB: Math.round((freeKB / 1024 / 1024) * 100) / 100,
                                });
                            }
                        }
                    }
                    return [2 /*return*/, drives];
                case 7:
                    _c = _d.sent();
                    return [2 /*return*/, []];
                case 8: return [2 /*return*/];
            }
        });
    });
}
function getFfmpegVersion() {
    return __awaiter(this, void 0, void 0, function () {
        var versionOutput, firstLine, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, runFfprobe(['-version'])];
                case 1:
                    versionOutput = _b.sent();
                    firstLine = versionOutput.split(/\r?\n/)[0];
                    return [2 /*return*/, firstLine || undefined];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, undefined];
                case 3: return [2 /*return*/];
            }
        });
    });
}
export function getSystemInfo() {
    return __awaiter(this, void 0, void 0, function () {
        var cpus, cpuModel, cpuCores, ramGB, _a, gpuModel, drives, ffmpegVersion;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    cpus = os.cpus();
                    cpuModel = ((_b = cpus[0]) === null || _b === void 0 ? void 0 : _b.model) || 'Unknown CPU';
                    cpuCores = cpus.length;
                    ramGB = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 100) / 100;
                    return [4 /*yield*/, Promise.all([
                            getGpuModel(),
                            getDrives(),
                            getFfmpegVersion(),
                        ])];
                case 1:
                    _a = _c.sent(), gpuModel = _a[0], drives = _a[1], ffmpegVersion = _a[2];
                    return [2 /*return*/, {
                            cpuModel: cpuModel,
                            cpuCores: cpuCores,
                            gpuModel: gpuModel,
                            ramGB: ramGB,
                            drives: drives,
                            ffmpegVersion: ffmpegVersion,
                        }];
            }
        });
    });
}
