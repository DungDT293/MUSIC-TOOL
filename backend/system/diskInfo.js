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
import { promisify } from 'util';
import { exec } from 'child_process';
var execAsync = promisify(exec);
// Timeout cho các lệnh WMIC (5 giây)
var WMIC_TIMEOUT_MS = 5000;
/**
 * Wrapper cho execAsync với timeout
 */
function execWithTimeout(command_1) {
    return __awaiter(this, arguments, void 0, function (command, timeoutMs) {
        if (timeoutMs === void 0) { timeoutMs = WMIC_TIMEOUT_MS; }
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var child = exec(command, { timeout: timeoutMs }, function (error, stdout, stderr) {
                        if (error) {
                            // Nếu timeout, không reject mà trả về empty
                            if (error.signal === 'SIGTERM') {
                                resolve({ stdout: '', stderr: 'Timeout' });
                            }
                            else {
                                reject(error);
                            }
                        }
                        else {
                            resolve({ stdout: stdout, stderr: stderr });
                        }
                    });
                })];
        });
    });
}
/**
 * Phát hiện loại ổ đĩa (SSD/HDD) cho một drive letter trên Windows
 * Với timeout để tránh chờ quá lâu
 */
function detectDiskTypeWindows(driveLetter) {
    return __awaiter(this, void 0, void 0, function () {
        var diskIndexMatch, diskIndex, partitionInfo, err_1, partitionInfo2, err_2, logicalDiskInfo, diskDriveInfo, err_3, mediaType, mediaTypeMatch, type, err_4, modelInfo, modelMatch, model, err_5, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 21, , 22]);
                    diskIndexMatch = null;
                    diskIndex = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, execWithTimeout("wmic partition where \"DeviceID='".concat(driveLetter, "\\\\'\" get DiskIndex /format:list"), 3000 // 3 giây timeout
                        )];
                case 2:
                    partitionInfo = (_a.sent()).stdout;
                    diskIndexMatch = partitionInfo.match(/DiskIndex=(\d+)/i);
                    if (diskIndexMatch) {
                        diskIndex = diskIndexMatch[1];
                        console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " found DiskIndex=").concat(diskIndex, " via partition query"));
                    }
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _a.sent();
                    console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " partition query failed, trying alternative method..."));
                    return [3 /*break*/, 4];
                case 4:
                    if (!!diskIndexMatch) return [3 /*break*/, 8];
                    _a.label = 5;
                case 5:
                    _a.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, execWithTimeout("wmic partition where \"DeviceID like '".concat(driveLetter, "%'\" get DiskIndex /format:list"), 3000)];
                case 6:
                    partitionInfo2 = (_a.sent()).stdout;
                    diskIndexMatch = partitionInfo2.match(/DiskIndex=(\d+)/i);
                    if (diskIndexMatch) {
                        diskIndex = diskIndexMatch[1];
                        console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " found DiskIndex=").concat(diskIndex, " via alternative partition query"));
                    }
                    return [3 /*break*/, 8];
                case 7:
                    err_2 = _a.sent();
                    console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " alternative partition query also failed"));
                    return [3 /*break*/, 8];
                case 8:
                    if (!!diskIndexMatch) return [3 /*break*/, 13];
                    _a.label = 9;
                case 9:
                    _a.trys.push([9, 12, , 13]);
                    return [4 /*yield*/, execWithTimeout("wmic logicaldisk where \"DeviceID='".concat(driveLetter, "'\" get VolumeSerialNumber,Size /format:list"), 2000)
                        // Try to enumerate all diskdrives and match by size
                    ];
                case 10:
                    logicalDiskInfo = (_a.sent()).stdout;
                    return [4 /*yield*/, execWithTimeout("wmic diskdrive get Index,Model,Size /format:list", 3000)
                        // Parse diskdrive info and try to match (complex, skip for now)
                    ];
                case 11:
                    diskDriveInfo = (_a.sent()).stdout;
                    // Parse diskdrive info and try to match (complex, skip for now)
                    console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " trying diskdrive enumeration..."));
                    return [3 /*break*/, 13];
                case 12:
                    err_3 = _a.sent();
                    console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " diskdrive enumeration failed"));
                    return [3 /*break*/, 13];
                case 13:
                    // Fallback: If C: drive and all methods failed, assume SSD (common case)
                    if (!diskIndexMatch && driveLetter === 'C:') {
                        console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " is C: drive, assuming SSD (common case on modern systems)"));
                        return [2 /*return*/, 'SSD'];
                    }
                    if (!diskIndexMatch) {
                        console.log("[system] detectDiskTypeWindows: No DiskIndex found for ".concat(driveLetter, " after all methods, defaulting to HDD"));
                        return [2 /*return*/, 'HDD']; // Default to HDD nếu không tìm được partition
                    }
                    diskIndex = diskIndexMatch[1];
                    _a.label = 14;
                case 14:
                    _a.trys.push([14, 16, , 17]);
                    return [4 /*yield*/, execWithTimeout("wmic diskdrive where \"Index=".concat(diskIndex, "\" get MediaType /format:list"), 2000 // 2 giây timeout
                        )];
                case 15:
                    mediaType = (_a.sent()).stdout;
                    mediaTypeMatch = mediaType.match(/MediaType=(\d+)/i);
                    if (mediaTypeMatch) {
                        type = parseInt(mediaTypeMatch[1], 10);
                        // 4 = SSD, 3 = HDD, 0 = Unknown
                        if (type === 4) {
                            console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " detected as SSD (MediaType=4)"));
                            return [2 /*return*/, 'SSD'];
                        }
                        if (type === 3) {
                            console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " detected as HDD (MediaType=3)"));
                            return [2 /*return*/, 'HDD'];
                        }
                        // Nếu MediaType = 0 hoặc giá trị khác, tiếp tục kiểm tra Model
                        console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " MediaType=").concat(type, ", checking Model..."));
                    }
                    else {
                        console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " MediaType not found, checking Model..."));
                    }
                    return [3 /*break*/, 17];
                case 16:
                    err_4 = _a.sent();
                    console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " MediaType check failed, checking Model..."));
                    return [3 /*break*/, 17];
                case 17:
                    _a.trys.push([17, 19, , 20]);
                    return [4 /*yield*/, execWithTimeout("wmic diskdrive where \"Index=".concat(diskIndex, "\" get Model /format:list"), 2000 // 2 giây timeout
                        )];
                case 18:
                    modelInfo = (_a.sent()).stdout;
                    modelMatch = modelInfo.match(/Model=(.+)/i);
                    if (modelMatch) {
                        model = modelMatch[1].toUpperCase();
                        if (model.includes('SSD') || model.includes('SOLID STATE')) {
                            console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " detected as SSD (Model contains SSD)"));
                            return [2 /*return*/, 'SSD'];
                        }
                        // Nếu Model không chứa SSD, có thể là HDD
                        console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " Model=\"").concat(modelMatch[1], "\", defaulting to HDD"));
                    }
                    return [3 /*break*/, 20];
                case 19:
                    err_5 = _a.sent();
                    console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " Model check failed, defaulting to HDD"));
                    return [3 /*break*/, 20];
                case 20:
                    // Mặc định là HDD nếu không phát hiện được SSD
                    console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " defaulting to HDD"));
                    return [2 /*return*/, 'HDD'];
                case 21:
                    error_1 = _a.sent();
                    console.log("[system] detectDiskTypeWindows: ".concat(driveLetter, " error, defaulting to HDD:"), error_1);
                    return [2 /*return*/, 'HDD']; // Default to HDD thay vì UNKNOWN
                case 22: return [2 /*return*/];
            }
        });
    });
}
function getDiskInfoWindows() {
    return __awaiter(this, void 0, void 0, function () {
        var stdout, lines, drivesMap, currentDrive, _i, lines_1, line, trimmed, _a, keyRaw, valueRaw, key, value, driveInfo, blocks, drives, drivePromises, _loop_1, i, results, _b, results_1, result, error_2;
        var _this = this;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, execWithTimeout('wmic logicaldisk get DeviceID,FreeSpace,Size,DriveType /format:list', 5000 // 5 giây timeout
                        )];
                case 1:
                    stdout = (_c.sent()).stdout;
                    console.log("[system] WMIC raw output length: ".concat(stdout.length, " chars"));
                    lines = stdout.split(/\r?\n/);
                    drivesMap = new Map();
                    currentDrive = '';
                    for (_i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
                        line = lines_1[_i];
                        trimmed = line.trim();
                        if (!trimmed) {
                            // Dòng trống - reset current drive
                            currentDrive = '';
                            continue;
                        }
                        _a = trimmed.split('='), keyRaw = _a[0], valueRaw = _a[1];
                        if (!keyRaw || !valueRaw)
                            continue;
                        key = keyRaw.trim().toLowerCase();
                        value = valueRaw.trim();
                        if (key === 'deviceid') {
                            currentDrive = value;
                            if (!drivesMap.has(currentDrive)) {
                                drivesMap.set(currentDrive, { drive: currentDrive });
                            }
                        }
                        else if (currentDrive && drivesMap.has(currentDrive)) {
                            driveInfo = drivesMap.get(currentDrive);
                            if (key === 'freespace') {
                                driveInfo.freeStr = value;
                            }
                            else if (key === 'size') {
                                driveInfo.sizeStr = value;
                            }
                            else if (key === 'drivetype') {
                                driveInfo.driveType = value;
                            }
                        }
                    }
                    blocks = Array.from(drivesMap.values());
                    console.log("[system] Found ".concat(blocks.length, " drives after parsing:"), blocks.map(function (b) { return b.drive; }).join(', '));
                    drives = [];
                    drivePromises = [];
                    _loop_1 = function (i) {
                        var block = blocks[i];
                        var drive = block.drive;
                        var freeStr = block.freeStr;
                        var sizeStr = block.sizeStr;
                        var driveType = block.driveType;
                        // Chỉ lấy Fixed disk (DriveType=3) hoặc nếu không có DriveType thì lấy tất cả
                        if (!drive) {
                            console.log("[system] Block ".concat(i, " has no DeviceID, skipping"));
                            return "continue";
                        }
                        // Bỏ qua CD-ROM (DriveType=5), Removable (DriveType=2), Network (DriveType=4)
                        if (driveType && driveType !== '3') {
                            console.log("[system] Drive ".concat(drive, " has DriveType=").concat(driveType, ", skipping (only DriveType=3 is Fixed disk)"));
                            return "continue";
                        }
                        console.log("[system] Processing drive ".concat(drive, ": FreeSpace=").concat(freeStr, ", Size=").concat(sizeStr, ", DriveType=").concat(driveType));
                        var totalBytes = sizeStr ? Number(sizeStr) : null;
                        var freeBytes = freeStr ? Number(freeStr) : null;
                        var usedBytes = totalBytes != null && freeBytes != null ? Math.max(totalBytes - freeBytes, 0) : null;
                        var usedPercent = totalBytes && usedBytes != null && totalBytes > 0
                            ? (usedBytes / totalBytes) * 100
                            : null;
                        // Tạo promise để phát hiện loại ổ đĩa song song
                        var drivePromise = (function () { return __awaiter(_this, void 0, void 0, function () {
                            var diskType;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, Promise.race([
                                            detectDiskTypeWindows(drive),
                                            new Promise(function (resolve) { return setTimeout(function () { return resolve('HDD'); }, 5000); })
                                        ])];
                                    case 1:
                                        diskType = _a.sent();
                                        return [2 /*return*/, {
                                                drive: drive,
                                                totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
                                                freeBytes: Number.isFinite(freeBytes) ? freeBytes : null,
                                                usedBytes: Number.isFinite(usedBytes) ? usedBytes : null,
                                                usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
                                                diskType: diskType,
                                            }];
                                }
                            });
                        }); })();
                        drivePromises.push(drivePromise);
                    };
                    for (i = 0; i < blocks.length; i++) {
                        _loop_1(i);
                    }
                    return [4 /*yield*/, Promise.allSettled(drivePromises)];
                case 2:
                    results = _c.sent();
                    for (_b = 0, results_1 = results; _b < results_1.length; _b++) {
                        result = results_1[_b];
                        if (result.status === 'fulfilled') {
                            drives.push(result.value);
                        }
                    }
                    return [2 /*return*/, drives];
                case 3:
                    error_2 = _c.sent();
                    console.error('[system] getDiskInfoWindows error:', error_2);
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    });
}
export function getDiskInfo() {
    return __awaiter(this, void 0, void 0, function () {
        var drives, startTime, duration, error_3, ssdTotal, ssdFree, ssdCount, hddTotal, hddFree, hddCount, unknownCount, _i, drives_1, drive, formatGB, ssdSummary, hddSummary;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    drives = [];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    if (!(process.platform === 'win32')) return [3 /*break*/, 3];
                    startTime = Date.now();
                    return [4 /*yield*/, getDiskInfoWindows()];
                case 2:
                    drives = _a.sent();
                    duration = Date.now() - startTime;
                    console.log("[system] getDiskInfo completed in ".concat(duration, "ms, found ").concat(drives.length, " drives"));
                    return [3 /*break*/, 4];
                case 3:
                    // Các hệ điều hành khác hiện chưa hỗ trợ chi tiết, trả về rỗng
                    drives = [];
                    _a.label = 4;
                case 4: return [3 /*break*/, 6];
                case 5:
                    error_3 = _a.sent();
                    console.error('[system] getDiskInfo error:', error_3);
                    drives = [];
                    return [3 /*break*/, 6];
                case 6:
                    ssdTotal = 0;
                    ssdFree = 0;
                    ssdCount = 0;
                    hddTotal = 0;
                    hddFree = 0;
                    hddCount = 0;
                    unknownCount = 0;
                    for (_i = 0, drives_1 = drives; _i < drives_1.length; _i++) {
                        drive = drives_1[_i];
                        console.log("[system] Processing drive ".concat(drive.drive, ": type=").concat(drive.diskType, ", total=").concat(drive.totalBytes, ", free=").concat(drive.freeBytes));
                        if (drive.diskType === 'SSD' && drive.totalBytes != null && drive.freeBytes != null) {
                            ssdTotal += drive.totalBytes;
                            ssdFree += drive.freeBytes;
                            ssdCount++;
                        }
                        else if ((drive.diskType === 'HDD' || drive.diskType === 'UNKNOWN') && drive.totalBytes != null && drive.freeBytes != null) {
                            // Nếu là HDD hoặc UNKNOWN, tính vào HDD
                            hddTotal += drive.totalBytes;
                            hddFree += drive.freeBytes;
                            hddCount++;
                            if (drive.diskType === 'UNKNOWN') {
                                unknownCount++;
                                console.log("[system] Drive ".concat(drive.drive, " is UNKNOWN, counting as HDD"));
                            }
                        }
                    }
                    formatGB = function (bytes) {
                        if (!Number.isFinite(bytes))
                            return '0 GB';
                        return "".concat((bytes / (1024 * 1024 * 1024)).toFixed(1), " GB");
                    };
                    console.log("[system] Summary: SSD=".concat(ssdCount, " drives (").concat(formatGB(ssdTotal), "), HDD=").concat(hddCount, " drives (").concat(formatGB(hddTotal), "), Unknown=").concat(unknownCount));
                    ssdSummary = ssdCount > 0
                        ? {
                            type: 'SSD',
                            totalBytes: ssdTotal,
                            freeBytes: ssdFree,
                            usedBytes: Math.max(ssdTotal - ssdFree, 0),
                            driveCount: ssdCount,
                        }
                        : null;
                    hddSummary = hddCount > 0
                        ? {
                            type: 'HDD',
                            totalBytes: hddTotal,
                            freeBytes: hddFree,
                            usedBytes: Math.max(hddTotal - hddFree, 0),
                            driveCount: hddCount,
                        }
                        : null;
                    return [2 /*return*/, {
                            drives: drives,
                            byType: {
                                ssd: ssdSummary,
                                hdd: hddSummary,
                            },
                            updatedAt: Date.now(),
                        }];
            }
        });
    });
}
