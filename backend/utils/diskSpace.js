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
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
var execFileAsync = promisify(execFile);
var GIGABYTE = 1024 * 1024 * 1024;
export function getDiskSpace(targetPath) {
    return __awaiter(this, void 0, void 0, function () {
        var resolved, drive, stdout, matches, free, total, err_1, stdout, lines, parts, totalKb, freeKb, err_2;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    resolved = path.resolve(targetPath || os.homedir());
                    if (!(process.platform === 'win32')) return [3 /*break*/, 5];
                    drive = resolved.slice(0, 2).toUpperCase();
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, execFileAsync('wmic', [
                            'logicaldisk',
                            'where',
                            "Caption='".concat(drive, "'"),
                            'get',
                            'FreeSpace,Size',
                            '/value',
                        ])];
                case 2:
                    stdout = (_c.sent()).stdout;
                    matches = Object.fromEntries(stdout
                        .split('\n')
                        .map(function (line) { return line.trim(); })
                        .filter(Boolean)
                        .map(function (line) { return line.split('='); }));
                    free = Number((_a = matches.FreeSpace) !== null && _a !== void 0 ? _a : 0);
                    total = Number((_b = matches.Size) !== null && _b !== void 0 ? _b : 0);
                    if (Number.isFinite(free) && Number.isFinite(total)) {
                        return [2 /*return*/, { drive: drive, free: free, total: total }];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _c.sent();
                    console.warn('[diskSpace] WMIC query failed, falling back to OS metrics:', err_1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/, {
                        drive: drive,
                        free: os.freemem(),
                        total: os.totalmem(),
                    }];
                case 5:
                    _c.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, execFileAsync('df', ['-k', resolved])];
                case 6:
                    stdout = (_c.sent()).stdout;
                    lines = stdout.trim().split('\n');
                    if (lines.length >= 2) {
                        parts = lines[1].split(/\s+/);
                        totalKb = Number(parts[1]);
                        freeKb = Number(parts[3]);
                        if (Number.isFinite(totalKb) && Number.isFinite(freeKb)) {
                            return [2 /*return*/, {
                                    drive: resolved,
                                    total: totalKb * 1024,
                                    free: freeKb * 1024,
                                }];
                        }
                    }
                    return [3 /*break*/, 8];
                case 7:
                    err_2 = _c.sent();
                    console.warn('[diskSpace] df command failed, falling back to OS metrics:', err_2);
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/, {
                        drive: resolved,
                        free: os.freemem(),
                        total: os.totalmem(),
                    }];
            }
        });
    });
}
export function checkMinimumSpace(freeBytes, minGigabytes) {
    var requiredBytes = minGigabytes * GIGABYTE;
    return {
        freeBytes: freeBytes,
        requiredBytes: requiredBytes,
        enough: freeBytes >= requiredBytes,
    };
}
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes))
        return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var value = bytes;
    var unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return "".concat(value.toFixed(unitIndex === 0 ? 0 : 1), " ").concat(units[unitIndex]);
}
export function createDiskSpaceErrorMessage(info, check, meta) {
    var parts = [
        '❌ CẢNH BÁO: Dung lượng ổ đĩa không đủ.',
        "\u1ED4: ".concat(info.drive),
        "C\u00F2n tr\u1ED1ng: ".concat(formatBytes(check.freeBytes), "."),
        "C\u1EA7n t\u1ED1i thi\u1EC3u: ".concat(formatBytes(check.requiredBytes), "."),
    ];
    if (meta === null || meta === void 0 ? void 0 : meta.tabName) {
        parts.push("Tab: ".concat(meta.tabName, "."));
    }
    if (meta === null || meta === void 0 ? void 0 : meta.operation) {
        parts.push("T\u00E1c v\u1EE5: ".concat(meta.operation, "."));
    }
    if (meta === null || meta === void 0 ? void 0 : meta.additionalInfo) {
        parts.push(meta.additionalInfo);
    }
    return parts.join('\n');
}
