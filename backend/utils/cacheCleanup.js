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
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
/**
 * Lấy thư mục userData của Electron
 */
function getUserDataPath() {
    return app.getPath('userData');
}
/**
 * Lấy version hiện tại từ package.json
 */
function getCurrentVersion() {
    try {
        var packagePath = path.join(__dirname, '../../package.json');
        var packageContent = fs.readFileSync(packagePath, 'utf8');
        var packageJson = JSON.parse(packageContent);
        return packageJson.version || '0.0.0';
    }
    catch (error) {
        console.warn('[cacheCleanup] Failed to read package.json:', error);
        return '0.0.0';
    }
}
/**
 * Lấy version đã lưu trong cache
 */
function getStoredVersion() {
    try {
        var versionFile = path.join(getUserDataPath(), 'app-version.txt');
        if (fs.existsSync(versionFile)) {
            return fs.readFileSync(versionFile, 'utf8').trim();
        }
    }
    catch (error) {
        console.warn('[cacheCleanup] Failed to read stored version:', error);
    }
    return null;
}
/**
 * Lưu version hiện tại vào cache
 */
function saveCurrentVersion(version) {
    try {
        var versionFile = path.join(getUserDataPath(), 'app-version.txt');
        fs.writeFileSync(versionFile, version, 'utf8');
    }
    catch (error) {
        console.warn('[cacheCleanup] Failed to save version:', error);
    }
}
/**
 * So sánh version (đơn giản: x.y.z)
 */
function compareVersion(a, b) {
    var pa = a.split('.').map(function (x) { return parseInt(x, 10) || 0; });
    var pb = b.split('.').map(function (x) { return parseInt(x, 10) || 0; });
    var len = Math.max(pa.length, pb.length);
    for (var i = 0; i < len; i++) {
        var va = pa[i] || 0;
        var vb = pb[i] || 0;
        if (va < vb)
            return -1;
        if (va > vb)
            return 1;
    }
    return 0;
}
/**
 * Xóa cache cũ - XÓA TOÀN BỘ kể cả thông tin đăng nhập (authState.enc)
 * Để người dùng đăng nhập lại khi cài version mới
 */
function clearOldCache() {
    return __awaiter(this, void 0, void 0, function () {
        var userDataPath, cacheDirs, _i, cacheDirs_1, dir, cacheFiles, _a, cacheFiles_1, file, resolveStoragePath, authStateEncPath, authFiles, _b, authFiles_1, authFile, err_1, fallbackAuthFiles, _c, fallbackAuthFiles_1, authFile, error_1;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 5, , 6]);
                    userDataPath = getUserDataPath();
                    cacheDirs = [
                        path.join(userDataPath, 'Cache'),
                        path.join(userDataPath, 'Code Cache'),
                        path.join(userDataPath, 'GPUCache'),
                        path.join(userDataPath, 'ShaderCache'),
                        path.join(userDataPath, 'logs'), // Xóa logs cũ
                    ];
                    for (_i = 0, cacheDirs_1 = cacheDirs; _i < cacheDirs_1.length; _i++) {
                        dir = cacheDirs_1[_i];
                        if (fs.existsSync(dir)) {
                            try {
                                fs.rmSync(dir, { recursive: true, force: true });
                                console.log("[cacheCleanup] Deleted cache directory: ".concat(dir));
                            }
                            catch (err) {
                                console.warn("[cacheCleanup] Failed to delete ".concat(dir, ":"), err.message);
                            }
                        }
                    }
                    cacheFiles = [
                        path.join(userDataPath, 'Cookies'),
                        path.join(userDataPath, 'Cookies-journal'),
                        path.join(userDataPath, 'Local Storage'),
                        path.join(userDataPath, 'Session Storage'),
                        path.join(userDataPath, 'IndexedDB'),
                    ];
                    for (_a = 0, cacheFiles_1 = cacheFiles; _a < cacheFiles_1.length; _a++) {
                        file = cacheFiles_1[_a];
                        if (fs.existsSync(file)) {
                            try {
                                if (fs.statSync(file).isDirectory()) {
                                    fs.rmSync(file, { recursive: true, force: true });
                                }
                                else {
                                    fs.unlinkSync(file);
                                }
                                console.log("[cacheCleanup] Deleted cache file: ".concat(file));
                            }
                            catch (err) {
                                console.warn("[cacheCleanup] Failed to delete ".concat(file, ":"), err.message);
                            }
                        }
                    }
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, import('../auth/encryptedAuthStore')];
                case 2:
                    resolveStoragePath = (_d.sent()).resolveStoragePath;
                    authStateEncPath = resolveStoragePath();
                    authFiles = [
                        authStateEncPath, // File encrypted auth state (đường dẫn chính xác)
                        authStateEncPath.replace(/\.enc$/, '.json'), // File plaintext cũ (nếu có)
                        authStateEncPath.replace(/\.enc$/, '.json.backup'), // File backup (nếu có)
                    ];
                    for (_b = 0, authFiles_1 = authFiles; _b < authFiles_1.length; _b++) {
                        authFile = authFiles_1[_b];
                        if (fs.existsSync(authFile)) {
                            try {
                                fs.unlinkSync(authFile);
                                console.log("[cacheCleanup] Deleted auth file: ".concat(authFile));
                            }
                            catch (err) {
                                console.warn("[cacheCleanup] Failed to delete ".concat(authFile, ":"), err.message);
                            }
                        }
                    }
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _d.sent();
                    // Fallback: thử xóa với đường dẫn mặc định
                    console.warn('[cacheCleanup] Failed to import resolveStoragePath, using fallback:', err_1.message);
                    fallbackAuthFiles = [
                        path.join(userDataPath, 'authState.enc'),
                        path.join(userDataPath, 'authState.json'),
                        path.join(userDataPath, 'authState.json.backup'),
                    ];
                    for (_c = 0, fallbackAuthFiles_1 = fallbackAuthFiles; _c < fallbackAuthFiles_1.length; _c++) {
                        authFile = fallbackAuthFiles_1[_c];
                        if (fs.existsSync(authFile)) {
                            try {
                                fs.unlinkSync(authFile);
                                console.log("[cacheCleanup] Deleted auth file (fallback): ".concat(authFile));
                            }
                            catch (err2) {
                                console.warn("[cacheCleanup] Failed to delete ".concat(authFile, ":"), err2.message);
                            }
                        }
                    }
                    return [3 /*break*/, 4];
                case 4: return [3 /*break*/, 6];
                case 5:
                    error_1 = _d.sent();
                    console.error('[cacheCleanup] Failed to clear cache:', error_1.message);
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
/**
 * Kiểm tra và xóa cache nếu version mới hơn
 * Chỉ xóa cache khi version thay đổi, không xóa khi downgrade
 */
export function checkAndCleanCacheOnUpdate() {
    return __awaiter(this, void 0, void 0, function () {
        var currentVersion, storedVersion, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    currentVersion = getCurrentVersion();
                    storedVersion = getStoredVersion();
                    console.log("[cacheCleanup] Current version: ".concat(currentVersion, ", Stored version: ").concat(storedVersion || 'none'));
                    if (!(!storedVersion || compareVersion(currentVersion, storedVersion) > 0)) return [3 /*break*/, 2];
                    console.log('[cacheCleanup] New version detected, clearing old cache...');
                    return [4 /*yield*/, clearOldCache()];
                case 1:
                    _a.sent();
                    saveCurrentVersion(currentVersion);
                    console.log('[cacheCleanup] Cache cleanup completed');
                    return [3 /*break*/, 3];
                case 2:
                    console.log('[cacheCleanup] Same or older version, skipping cache cleanup');
                    _a.label = 3;
                case 3: return [3 /*break*/, 5];
                case 4:
                    error_2 = _a.sent();
                    console.error('[cacheCleanup] Error during cache cleanup check:', error_2.message);
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
