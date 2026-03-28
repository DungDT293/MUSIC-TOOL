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
import { promisify } from 'node:util';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
var execFileAsync = promisify(execFile);
var CACHE_DIR = path.join(os.homedir(), '.93media');
var CACHE_FILE = path.join(CACHE_DIR, 'machine-id.txt');
// Optional override for environments where the home folder is not persistent.
// Example: set MACHINE_ID_FILE="D:\\myapp\\machine-id.txt"
var ENV_CACHE_FILE = process.env.MACHINE_ID_FILE;
function readCachedMachineHash() {
    var candidates = [ENV_CACHE_FILE, CACHE_FILE].filter(Boolean);
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var file = candidates_1[_i];
        try {
            var content = fs.readFileSync(file, 'utf8').trim();
            if (content && /^[a-f0-9]{64}$/i.test(content)) {
                return content.toLowerCase();
            }
        }
        catch (_a) {
            // ignore and try next candidate
        }
    }
    return null;
}
function writeCachedMachineHash(hash) {
    var targets = [ENV_CACHE_FILE, CACHE_FILE].filter(Boolean);
    for (var _i = 0, targets_1 = targets; _i < targets_1.length; _i++) {
        var target = targets_1[_i];
        try {
            var dir = path.dirname(target);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(target, hash, 'utf8');
            return;
        }
        catch (err) {
            // Log once for visibility; continue to next fallback.
            console.warn('[machineId] Cannot write cache to', target, '-', (err === null || err === void 0 ? void 0 : err.message) || err);
        }
    }
}
function tryCommand(command, args) {
    return __awaiter(this, void 0, void 0, function () {
        var stdout, lines, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, execFileAsync(command, args, { windowsHide: true })];
                case 1:
                    stdout = (_b.sent()).stdout;
                    lines = stdout
                        .split(/\r?\n/)
                        .map(function (line) { return line.trim(); })
                        .filter(function (line) { return line && line.toLowerCase() !== 'uuid' && line.toLowerCase() !== 'serialnumber'; });
                    if (lines.length > 0) {
                        return [2 /*return*/, lines[0]];
                    }
                    return [2 /*return*/, null];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function getWindowsHardwareId() {
    return __awaiter(this, void 0, void 0, function () {
        var identifiers, cpuId, uuid, bios, baseboard, disk, interfaces, macs, _i, _a, value, _b, value_1, iface, execSync, winId, match, unique;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    identifiers = [];
                    return [4 /*yield*/, tryCommand('wmic', ['cpu', 'get', 'ProcessorId'])];
                case 1:
                    cpuId = _c.sent();
                    if (cpuId)
                        identifiers.push("CPU:".concat(cpuId));
                    return [4 /*yield*/, tryCommand('wmic', ['csproduct', 'get', 'uuid'])];
                case 2:
                    uuid = _c.sent();
                    if (uuid)
                        identifiers.push("UUID:".concat(uuid));
                    return [4 /*yield*/, tryCommand('wmic', ['bios', 'get', 'serialnumber'])];
                case 3:
                    bios = _c.sent();
                    if (bios)
                        identifiers.push("BIOS:".concat(bios));
                    return [4 /*yield*/, tryCommand('wmic', ['baseboard', 'get', 'serialnumber'])];
                case 4:
                    baseboard = _c.sent();
                    if (baseboard)
                        identifiers.push("MB:".concat(baseboard));
                    return [4 /*yield*/, tryCommand('wmic', ['diskdrive', 'get', 'serialnumber'])];
                case 5:
                    disk = _c.sent();
                    if (disk)
                        identifiers.push("DISK:".concat(disk));
                    // MAC Address (primary network adapter)
                    try {
                        interfaces = os.networkInterfaces();
                        macs = [];
                        for (_i = 0, _a = Object.values(interfaces); _i < _a.length; _i++) {
                            value = _a[_i];
                            if (!value)
                                continue;
                            for (_b = 0, value_1 = value; _b < value_1.length; _b++) {
                                iface = value_1[_b];
                                if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
                                    macs.push(iface.mac);
                                }
                            }
                        }
                        macs.sort();
                        if (macs.length > 0) {
                            identifiers.push("MAC:".concat(macs[0])); // Lấy MAC đầu tiên
                        }
                    }
                    catch (_d) {
                        // Ignore
                    }
                    // Windows Installation ID (từ registry nếu có thể)
                    try {
                        execSync = require('child_process').execSync;
                        winId = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
                            windowsHide: true,
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'ignore'],
                        });
                        match = winId.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
                        if (match && match[1]) {
                            identifiers.push("WINID:".concat(match[1]));
                        }
                    }
                    catch (_e) {
                        // Ignore nếu không đọc được registry
                    }
                    if (identifiers.length === 0) {
                        return [2 /*return*/, null];
                    }
                    unique = Array.from(new Set(identifiers)).sort();
                    return [2 /*return*/, unique.join('|')];
            }
        });
    });
}
function getUnixHardwareId() {
    var hostname = os.hostname();
    var interfaces = os.networkInterfaces();
    var macs = [];
    for (var _i = 0, _a = Object.values(interfaces); _i < _a.length; _i++) {
        var value = _a[_i];
        if (!value)
            continue;
        for (var _b = 0, value_2 = value; _b < value_2.length; _b++) {
            var iface = value_2[_b];
            if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
                macs.push(iface.mac);
            }
        }
    }
    macs.sort();
    return "".concat(hostname, "|").concat(macs.join('|'));
}
export function getMachineHash() {
    return __awaiter(this, void 0, void 0, function () {
        var cached, raw, normalized, hash;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    cached = readCachedMachineHash();
                    if (cached) {
                        return [2 /*return*/, cached];
                    }
                    raw = null;
                    if (!(process.platform === 'win32')) return [3 /*break*/, 2];
                    return [4 /*yield*/, getWindowsHardwareId()];
                case 1:
                    raw = _a.sent();
                    _a.label = 2;
                case 2:
                    if (!raw) {
                        raw = getUnixHardwareId();
                    }
                    normalized = raw.replace(/\s+/g, '').toUpperCase();
                    hash = crypto.createHash('sha256').update(normalized).digest('hex');
                    // Ghi cache để các lần chạy sau giữ nguyên Machine ID
                    writeCachedMachineHash(hash);
                    return [2 /*return*/, hash];
            }
        });
    });
}
