/**
 * Tamper Detection
 * Phát hiện khi code/executable bị sửa đổi
 */
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
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { reportTamperingDetected, reportFileIntegrityFailed } from './securityMonitoring';
/**
 * Calculate file hash (SHA-256)
 */
export function calculateFileHash(filePath) {
    return new Promise(function (resolve, reject) {
        var hash = crypto.createHash('sha256');
        var stream = fs.createReadStream(filePath);
        stream.on('data', function (data) { return hash.update(data); });
        stream.on('end', function () { return resolve(hash.digest('hex')); });
        stream.on('error', reject);
    });
}
/**
 * Get expected hash của main executable
 * Hash này sẽ được embed trong code tại build time
 */
function getExpectedMainHash() {
    // Trong production, hash này sẽ được embed từ build process
    // Tạm thời return null để skip check trong dev
    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
        return null;
    }
    // TODO: Embed hash từ build process
    // const EXPECTED_MAIN_HASH = '...'
    // return EXPECTED_MAIN_HASH
    return null;
}
/**
 * Verify executable integrity
 */
export function verifyExecutableIntegrity() {
    return __awaiter(this, void 0, void 0, function () {
        var expectedHash, exePath, actualHash, isValid, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    expectedHash = getExpectedMainHash();
                    if (!expectedHash) {
                        // Skip check trong dev hoặc nếu chưa có expected hash
                        return [2 /*return*/, true];
                    }
                    exePath = process.execPath;
                    if (!fs.existsSync(exePath)) {
                        return [2 /*return*/, false];
                    }
                    return [4 /*yield*/, calculateFileHash(exePath)];
                case 1:
                    actualHash = _a.sent();
                    isValid = actualHash === expectedHash;
                    if (!!isValid) return [3 /*break*/, 3];
                    // Report tampering
                    return [4 /*yield*/, reportFileIntegrityFailed({
                            file: exePath,
                            expectedHash: expectedHash,
                            actualHash: actualHash,
                        })];
                case 2:
                    // Report tampering
                    _a.sent();
                    _a.label = 3;
                case 3: return [2 /*return*/, isValid];
                case 4:
                    error_1 = _a.sent();
                    console.warn('[TamperDetection] Failed to verify executable integrity:', error_1);
                    return [2 /*return*/, true]; // Fail open trong trường hợp lỗi
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Verify main.js integrity (Electron main process)
 */
export function verifyMainJsIntegrity() {
    return __awaiter(this, void 0, void 0, function () {
        var mainJsPath, hash, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
                        return [2 /*return*/, true]; // Skip trong dev
                    }
                    mainJsPath = path.join(__dirname, '../../dist-electron/main/main.js');
                    if (!fs.existsSync(mainJsPath)) {
                        return [2 /*return*/, true]; // File không tồn tại trong dev mode
                    }
                    return [4 /*yield*/, calculateFileHash(mainJsPath)
                        // TODO: Compare với expected hash (embed từ build)
                        // const EXPECTED_MAIN_JS_HASH = '...'
                        // return hash === EXPECTED_MAIN_JS_HASH
                        // Tạm thời return true
                    ];
                case 1:
                    hash = _a.sent();
                    // TODO: Compare với expected hash (embed từ build)
                    // const EXPECTED_MAIN_JS_HASH = '...'
                    // return hash === EXPECTED_MAIN_JS_HASH
                    // Tạm thời return true
                    return [2 /*return*/, true];
                case 2:
                    error_2 = _a.sent();
                    console.warn('[TamperDetection] Failed to verify main.js integrity:', error_2);
                    return [2 /*return*/, true];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Detect function hooking (basic check)
 * Chỉ chạy trong renderer process
 */
export function detectFunctionHooking() {
    try {
        if (typeof window === 'undefined') {
            return false; // Node.js environment - skip
        }
        // Check nếu các hàm quan trọng bị override
        var originalFetch = window.fetch;
        if (originalFetch.toString().includes('native code')) {
            // Function chưa bị hook
            return false;
        }
        // Có thể bị hook
        return true;
    }
    catch (_a) {
        return false;
    }
}
/**
 * Self-checksum verification (verify chính nó)
 */
export function verifySelfChecksum() {
    return __awaiter(this, void 0, void 0, function () {
        var currentFile, hash, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (process.env.NODE_ENV === 'development') {
                        return [2 /*return*/, true]; // Skip trong dev
                    }
                    currentFile = __filename;
                    if (!fs.existsSync(currentFile)) {
                        return [2 /*return*/, true];
                    }
                    return [4 /*yield*/, calculateFileHash(currentFile)
                        // TODO: Compare với expected hash
                        // const EXPECTED_SELF_HASH = '...'
                        // return hash === EXPECTED_SELF_HASH
                    ];
                case 1:
                    hash = _a.sent();
                    // TODO: Compare với expected hash
                    // const EXPECTED_SELF_HASH = '...'
                    // return hash === EXPECTED_SELF_HASH
                    return [2 /*return*/, true];
                case 2:
                    error_3 = _a.sent();
                    console.warn('[TamperDetection] Failed to verify self checksum:', error_3);
                    return [2 /*return*/, true];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Main tamper detection check
 */
export function checkTampering() {
    return __awaiter(this, void 0, void 0, function () {
        var reasons, exeOk, mainJsOk, hookOk;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    reasons = [];
                    return [4 /*yield*/, verifyExecutableIntegrity()];
                case 1:
                    exeOk = _a.sent();
                    if (!exeOk) {
                        reasons.push('Executable integrity check failed');
                    }
                    return [4 /*yield*/, verifyMainJsIntegrity()];
                case 2:
                    mainJsOk = _a.sent();
                    if (!mainJsOk) {
                        reasons.push('Main.js integrity check failed');
                    }
                    // Check function hooking (chỉ trong renderer)
                    if (typeof window !== 'undefined') {
                        hookOk = !detectFunctionHooking();
                        if (!hookOk) {
                            reasons.push('Function hooking detected');
                        }
                    }
                    return [2 /*return*/, {
                            isTampered: reasons.length > 0,
                            reasons: reasons,
                        }];
            }
        });
    });
}
/**
 * Initialize tamper detection
 */
export function initTamperDetection() {
    var _this = this;
    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
        return; // Skip trong dev
    }
    // Periodic check (mỗi 5 phút)
    setInterval(function () { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, checkTampering()];
                case 1:
                    result = _a.sent();
                    if (!result.isTampered) return [3 /*break*/, 3];
                    console.error('[TamperDetection] Tampering detected:', result.reasons);
                    // Report tampering
                    return [4 /*yield*/, reportTamperingDetected({
                            reasons: result.reasons,
                        })
                        // Có thể thực hiện action: log, alert, exit, etc.
                    ];
                case 2:
                    // Report tampering
                    _a.sent();
                    _a.label = 3;
                case 3: return [2 /*return*/];
            }
        });
    }); }, 5 * 60 * 1000);
}
