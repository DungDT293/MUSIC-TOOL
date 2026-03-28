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
import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getFfmpegPaths } from '../backend/ffmpeg/config';
import { runFfprobe } from '../backend/ffmpeg/wrapper';
// Lazy import probeFile để tránh lỗi khi load module
var probeFile = null;
import { getSystemInfo } from '../backend/system/sysinfo';
import { getRealtimeStats } from '../backend/system/realtime';
import { getDiskInfo } from '../backend/system/diskInfo';
import { getDiskSpace, checkMinimumSpace, formatBytes } from '../backend/utils/diskSpace';
import { jobQueue } from '../backend/jobQueue/jobQueue';
import { scanMusicFolders } from '../backend/music/scanMusic';
import { loadScanResult } from '../backend/music/scanStore';
import { buildPlaylists, savePlaylists, getPlaylists, clearPlaylists, } from '../backend/music/playlistEngine';
import { exportPlaylistToFile, validatePlaylistsForCrossfade, } from '../backend/music/exportAudio';
import { randomUUID } from 'crypto';
// Video module imports (Simple version)
import { getVideoFileInfo } from '../backend/video/videoInfo';
import { cutVideoIntoSegmentsSimple } from '../backend/video/cutSingleSimple';
import { splitManyVideosSimple } from '../backend/video/splitManySimple';
import { mergeVideosSimple } from '../backend/video/mergeVideosSimple';
import { muteVideoAudio } from '../backend/video/muteVideoAudio';
import { exportFinalVideo, scanAudioSource, scanVideoSource } from '../backend/video/finalExport';
import { videoJobManager } from '../backend/video/videoJobManager';
import { VIDEO_FINAL_EXPORT_DONE, VIDEO_FINAL_EXPORT_ERROR, VIDEO_FINAL_EXPORT_PROGRESS, VIDEO_FINAL_EXPORT_REQUEST, } from '../shared/videoFinalExportChannels';
import { getMachineHash } from '../backend/license/machineId';
import { startAutopilot, getAutopilotProgress, onAutopilotProgress, cancelAutopilot, onAutopilotLog, } from '../backend/autopilot/autopilotRunner';
import { setupYouTubeHandlers, cleanupYouTubeHandlers } from './youtube/youtubeHandlers';
import { getRecentHistory } from '../backend/music/exportHistory';
import { applySeoMetadata } from '../backend/video/seoMetadata';
import { normalizeAudio, cancelNormalizeAudio } from '../backend/music/normalizeAudio';
import { evaluateLicenseState, submitLicenseRequest, clearLicense, } from '../backend/license/licenseManager';
import { readEncryptedAuthState, writeEncryptedAuthState, clearEncryptedAuthState, migrateFromPlaintext, } from '../backend/auth/encryptedAuthStore';
import { checkAndCleanCacheOnUpdate } from '../backend/utils/cacheCleanup';
// Biến kiểm tra dev mode
var isDev = !!process.env.ELECTRON_RENDERER_URL;
// Lưu mainWindow để dùng trong IPC handlers
var mainWindow = null;
var cachedDiskInfo = null;
var diskInfoRefreshInterval = null;
var activeMergeRequestId = null;
var licenseState = {
    status: 'checking',
    machineHash: '',
};
// =========================
// AUTH CONFIG (ONLINE)
// =========================
import { getDecryptedString } from '../backend/security/stringEncryption';
import { initTamperDetection, checkTampering } from '../backend/security/tamperDetection';
import { createSignedHeaders } from '../backend/security/apiSigning';
import { initSecurityMonitoring } from '../backend/security/securityMonitoring';
// Sử dụng encrypted strings (chỉ decrypt khi cần)
// Fallback về plaintext nếu encryption fail (dev mode)
var AUTH_BASE;
var INSTALLER_SECRET;
try {
    AUTH_BASE = getDecryptedString('AUTH_BASE');
    INSTALLER_SECRET = getDecryptedString('INSTALLER_SECRET');
}
catch (_a) {
    // Fallback cho dev mode hoặc nếu có lỗi
    AUTH_BASE = 'https://license-server.dungdong333.workers.dev';
    INSTALLER_SECRET = '2025LEONYG280722';
}
var AUTH_REQUEST_TIMEOUT_MS = 10000;
// Đọc version từ package.json
import { readFileSync } from 'node:fs';
var APP_VERSION = '1.0.9'; // Fallback
try {
    var packageJson = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
    APP_VERSION = packageJson.version || APP_VERSION;
}
catch (_b) {
    // Fallback nếu không đọc được
}
function getFriendlyAuthError(rawError, fallback) {
    var msg = (rawError === null || rawError === void 0 ? void 0 : rawError.message) || String(rawError) || '';
    // Lỗi timeout / mạng
    if (msg.includes('AUTH_NETWORK_TIMEOUT') ||
        msg.includes('The operation was aborted') ||
        msg.includes('network error') ||
        msg.includes('Failed to fetch')) {
        return 'Không kết nối được server, vui lòng kiểm tra mạng và thử lại.';
    }
    // Lỗi HTTP có message từ server: HTTP_ERROR: <message>
    if (msg.startsWith('HTTP_ERROR: ')) {
        return msg.slice('HTTP_ERROR: '.length);
    }
    // Mặc định: dùng fallback nếu có, nếu không thì dùng message gốc
    return fallback || msg || 'Đã xảy ra lỗi không xác định.';
}
function postJson(path_1, body_1) {
    return __awaiter(this, arguments, void 0, function (path, body, headers) {
        var controller, timeout, signedHeaders, res, serverMessage, data, _a, err_1;
        if (headers === void 0) { headers = {}; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    controller = new AbortController();
                    timeout = setTimeout(function () { return controller.abort(); }, AUTH_REQUEST_TIMEOUT_MS);
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 11, 12, 13]);
                    return [4 /*yield*/, createSignedHeaders('POST', path, body)];
                case 2:
                    signedHeaders = _b.sent();
                    return [4 /*yield*/, fetch("".concat(AUTH_BASE).concat(path), {
                            method: 'POST',
                            headers: __assign(__assign({ 'content-type': 'application/json' }, signedHeaders), headers),
                            body: JSON.stringify(body),
                            signal: controller.signal,
                        })];
                case 3:
                    res = _b.sent();
                    if (!!res.ok) return [3 /*break*/, 9];
                    serverMessage = '';
                    _b.label = 4;
                case 4:
                    _b.trys.push([4, 6, , 8]);
                    return [4 /*yield*/, res.json()];
                case 5:
                    data = _b.sent();
                    serverMessage = (data === null || data === void 0 ? void 0 : data.reason) || (data === null || data === void 0 ? void 0 : data.error) || '';
                    return [3 /*break*/, 8];
                case 6:
                    _a = _b.sent();
                    return [4 /*yield*/, res.text()];
                case 7:
                    // Nếu không phải JSON, fallback sang text
                    serverMessage = _b.sent();
                    return [3 /*break*/, 8];
                case 8: throw new Error("HTTP_ERROR: ".concat(serverMessage || "HTTP ".concat(res.status)));
                case 9: return [4 /*yield*/, res.json()];
                case 10: return [2 /*return*/, (_b.sent())];
                case 11:
                    err_1 = _b.sent();
                    if ((err_1 === null || err_1 === void 0 ? void 0 : err_1.name) === 'AbortError') {
                        // Timeout
                        throw new Error('AUTH_NETWORK_TIMEOUT');
                    }
                    // Lỗi mạng khác
                    if ((err_1 === null || err_1 === void 0 ? void 0 : err_1.message) && (err_1.message.includes('network') || err_1.message.includes('fetch'))) {
                        throw new Error('AUTH_NETWORK_TIMEOUT');
                    }
                    throw err_1;
                case 12:
                    clearTimeout(timeout);
                    return [7 /*endfinally*/];
                case 13: return [2 /*return*/];
            }
        });
    });
}
var authState = null;
function getOrInitAuthState() {
    return __awaiter(this, void 0, void 0, function () {
        var currentMachineId, err_2, stored;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (authState)
                        return [2 /*return*/, authState
                            // Lấy machineId hiện tại của máy
                        ];
                    return [4 /*yield*/, getMachineHash()
                        // Thử migrate từ plaintext format (chỉ chạy một lần)
                    ];
                case 1:
                    currentMachineId = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, migrateFromPlaintext()];
                case 3:
                    _a.sent();
                    return [3 /*break*/, 5];
                case 4:
                    err_2 = _a.sent();
                    console.warn('[auth] Migration from plaintext failed:', err_2);
                    return [3 /*break*/, 5];
                case 5: return [4 /*yield*/, readEncryptedAuthState()];
                case 6:
                    stored = _a.sent();
                    if (stored && stored.remember && stored.status === 'allowed' && stored.username && stored.password) {
                        // MachineId đã được verify trong readEncryptedAuthState()
                        // Nếu không khớp, readEncryptedAuthState() sẽ return null
                        authState = {
                            status: stored.status,
                            username: stored.username,
                            password: stored.password,
                            machineId: currentMachineId, // Dùng machineId hiện tại
                            activationKey: stored.activationKey,
                            message: stored.message,
                            latestVersion: stored.latestVersion,
                            downloadUrl: stored.downloadUrl,
                        };
                        return [2 /*return*/, authState];
                    }
                    // Nếu không có stored hoặc không remember, khởi tạo mới
                    authState = {
                        status: 'unregistered',
                        machineId: currentMachineId,
                        message: 'Máy này chưa đăng ký tài khoản sử dụng.',
                    };
                    return [2 /*return*/, authState];
            }
        });
    });
}
function refreshLicenseState() {
    return __awaiter(this, arguments, void 0, function (forceRemote) {
        var error_1;
        if (forceRemote === void 0) { forceRemote = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, evaluateLicenseState(forceRemote)];
                case 1:
                    licenseState = _a.sent();
                    return [3 /*break*/, 3];
                case 2:
                    error_1 = _a.sent();
                    console.error('[license] Failed to evaluate license state:', error_1);
                    licenseState = {
                        status: 'denied',
                        machineHash: licenseState.machineHash,
                        message: error_1 instanceof Error ? error_1.message : String(error_1),
                    };
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/, licenseState];
            }
        });
    });
}
function refreshDiskInfoAndBroadcast() {
    return __awaiter(this, void 0, void 0, function () {
        var info, error_2, fallback;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, getDiskInfo()];
                case 1:
                    info = _a.sent();
                    cachedDiskInfo = info;
                    broadcastDiskInfo(info);
                    return [2 /*return*/, info];
                case 2:
                    error_2 = _a.sent();
                    console.error('[system] Failed to get disk info:', error_2);
                    fallback = {
                        drives: [],
                        byType: { ssd: null, hdd: null },
                        updatedAt: Date.now(),
                    };
                    cachedDiskInfo = fallback;
                    broadcastDiskInfo(fallback);
                    return [2 /*return*/, fallback];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function broadcastDiskInfo(info) {
    var windows = BrowserWindow.getAllWindows();
    for (var _i = 0, windows_1 = windows; _i < windows_1.length; _i++) {
        var win = windows_1[_i];
        if (!win.isDestroyed()) {
            win.webContents.send('system:disk-info', info);
        }
    }
}
jobQueue.on('update', function (job) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('jobQueue:update', job);
    }
});
// Hiển thị dialog lỗi khi không load được
function showLoadErrorDialog(window, code, message, error) {
    if (!window || window.isDestroyed())
        return;
    var errorDetails = error ? (error.message || String(error)) : '';
    var fullMessage = errorDetails ? "".concat(message, "\n\nChi ti\u1EBFt: ").concat(errorDetails) : message;
    // Delay một chút để đảm bảo window đã hiển thị
    setTimeout(function () {
        if (window && !window.isDestroyed()) {
            dialog.showMessageBox(window, {
                type: 'error',
                title: 'Lỗi Khởi Động Ứng Dụng',
                message: 'Không thể tải giao diện ứng dụng',
                detail: fullMessage,
                buttons: ['Đóng', 'Mở DevTools'],
                defaultId: 0,
                cancelId: 0,
            }).then(function (result) {
                if (result.response === 1) {
                    // Mở DevTools để debug
                    if (window && !window.isDestroyed()) {
                        window.webContents.openDevTools();
                    }
                }
            }).catch(function (err) {
                console.error('[Window] Failed to show error dialog:', err);
            });
        }
    }, 500);
}
// Load error page HTML
function loadErrorPage(window, errorMessage) {
    if (!window || window.isDestroyed())
        return;
    var errorHtml = "\n<!DOCTYPE html>\n<html>\n<head>\n  <meta charset=\"UTF-8\">\n  <title>L\u1ED7i Kh\u1EDFi \u0110\u1ED9ng \u1EE8ng D\u1EE5ng</title>\n  <style>\n    body {\n      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;\n      background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);\n      color: #ffffff;\n      margin: 0;\n      padding: 0;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      min-height: 100vh;\n    }\n    .container {\n      max-width: 600px;\n      padding: 40px;\n      background: #2a2a2a;\n      border-radius: 12px;\n      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);\n      border: 2px solid #dc2626;\n    }\n    h1 {\n      color: #fca5a5;\n      margin-top: 0;\n      font-size: 28px;\n    }\n    .error-message {\n      background: #1a1a1a;\n      padding: 20px;\n      border-radius: 8px;\n      border-left: 4px solid #dc2626;\n      margin: 20px 0;\n      white-space: pre-wrap;\n      font-family: 'Courier New', monospace;\n      font-size: 14px;\n      line-height: 1.6;\n    }\n    .actions {\n      margin-top: 30px;\n    }\n    .action-item {\n      margin: 10px 0;\n      padding: 12px;\n      background: #3a3a3a;\n      border-radius: 6px;\n    }\n    .action-item strong {\n      color: #60a5fa;\n    }\n    code {\n      background: #1a1a1a;\n      padding: 2px 6px;\n      border-radius: 4px;\n      font-family: 'Courier New', monospace;\n    }\n  </style>\n</head>\n<body>\n  <div class=\"container\">\n    <h1>\u274C L\u1ED7i Kh\u1EDFi \u0110\u1ED9ng \u1EE8ng D\u1EE5ng</h1>\n    <p>\u1EE8ng d\u1EE5ng kh\u00F4ng th\u1EC3 t\u1EA3i giao di\u1EC7n. Vui l\u00F2ng th\u1EF1c hi\u1EC7n c\u00E1c b\u01B0\u1EDBc sau:</p>\n    <div class=\"error-message\">".concat(errorMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;'), "</div>\n    <div class=\"actions\">\n      <div class=\"action-item\">\n        <strong>B\u01B0\u1EDBc 1:</strong> Ch\u1EA1y diagnostic script \u0111\u1EC3 ki\u1EC3m tra:<br>\n        <code>.\\scripts\\diagnose-app.ps1</code>\n      </div>\n      <div class=\"action-item\">\n        <strong>B\u01B0\u1EDBc 2:</strong> Ch\u1EA1y uninstaller \u0111\u1EC3 x\u00F3a s\u1EA1ch:<br>\n        <code>.\\scripts\\uninstall-complete.ps1</code>\n      </div>\n      <div class=\"action-item\">\n        <strong>B\u01B0\u1EDBc 3:</strong> C\u00E0i \u0111\u1EB7t l\u1EA1i \u1EE9ng d\u1EE5ng\n      </div>\n    </div>\n  </div>\n</body>\n</html>\n  ");
    window.loadURL("data:text/html;charset=utf-8,".concat(encodeURIComponent(errorHtml))).catch(function (err) {
        console.error('[Window] Failed to load error page:', err);
    });
}
// Tạo window chính
function createWindow() {
    var _this = this;
    // Xác định đường dẫn preload đúng cho cả dev và production
    // Trong packaged app (asar):
    // - __dirname = app.asar/dist-electron/main
    // - preload = app.asar/dist-electron/preload/preload.js
    // Trong dev mode:
    // - __dirname = dist-electron/main
    // - preload = dist-electron/preload/preload.js
    // Cả 2 trường hợp đều dùng: ../preload/preload.js
    var preloadPath = path.join(__dirname, '../preload/preload.js');
    // Kiểm tra preload file có tồn tại không
    var fs = require('fs');
    if (!fs.existsSync(preloadPath)) {
        console.error('[Window] Preload file not found at:', preloadPath);
        console.error('[Window] __dirname:', __dirname);
        console.error('[Window] app.isPackaged:', app.isPackaged);
    }
    else {
        console.log('[Window] Preload file found at:', preloadPath);
    }
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        title: '93 Media - Tool Mix Nhạc',
        show: false, // Không hiển thị ngay, chờ load xong
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            // Cho phép trang http://localhost:5173 load file:// trong DEV
            webSecurity: !isDev,
            allowRunningInsecureContent: isDev,
        },
    });
    // Hiển thị window khi đã sẵn sàng
    mainWindow.once('ready-to-show', function () {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            console.log('[Window] Window shown and focused');
        }
    });
    // Fallback: Nếu sau 5 giây mà window chưa show, force show
    setTimeout(function () {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
            console.warn('[Window] Window not visible after 5s, forcing show...');
            mainWindow.show();
            mainWindow.focus();
        }
    }, 5000);
    // Error handling cho webContents
    mainWindow.webContents.on('did-fail-load', function (event, errorCode, errorDescription, validatedURL) {
        console.error('[Window] Failed to load:', {
            errorCode: errorCode,
            errorDescription: errorDescription,
            validatedURL: validatedURL,
        });
        // Hiển thị window ngay cả khi load fail
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.webContents.send('app:load-error', {
                code: errorCode,
                description: errorDescription,
                url: validatedURL,
            });
            // Load error page
            loadErrorPage(mainWindow, "L\u1ED7i khi t\u1EA3i trang:\nCode: ".concat(errorCode, "\nM\u00F4 t\u1EA3: ").concat(errorDescription, "\nURL: ").concat(validatedURL));
        }
    });
    mainWindow.webContents.on('crashed', function (event, killed) {
        console.error('[Window] Renderer process crashed:', { killed: killed });
        // Thử reload window sau khi crash
        if (mainWindow && !mainWindow.isDestroyed()) {
            setTimeout(function () {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.reload();
                }
            }, 1000);
        }
    });
    mainWindow.webContents.on('unresponsive', function () {
        console.warn('[Window] Renderer process became unresponsive');
        // Hiển thị dialog cho user biết
        if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Ứng Dụng Không Phản Hồi',
                message: 'Ứng dụng đang không phản hồi. Bạn có muốn đợi thêm hoặc đóng lại?',
                buttons: ['Đợi thêm', 'Đóng lại'],
                defaultId: 0,
            }).then(function (result) {
                if (result.response === 1) {
                    // Đóng lại
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.close();
                    }
                }
            }).catch(function () { });
        }
    });
    mainWindow.webContents.on('responsive', function () {
        console.log('[Window] Renderer process became responsive again');
    });
    // Load renderer
    if (process.env.ELECTRON_RENDERER_URL) {
        // Dev mode: dùng URL của Vite dev server
        console.log('[Window] Loading dev URL:', process.env.ELECTRON_RENDERER_URL);
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch(function (err) {
            console.error('[Window] Failed to load dev URL:', err);
            showLoadErrorDialog(mainWindow, 'DEV_URL_ERROR', "Kh\u00F4ng th\u1EC3 t\u1EA3i URL dev: ".concat(process.env.ELECTRON_RENDERER_URL), err);
        });
    }
    else {
        // Build mode: load file index.html đã build
        // Trong packaged app: __dirname = app.asar/dist-electron/main
        // index.html nằm ở: app.asar/dist/index.html
        // Trong dev: __dirname = dist-electron/main
        // index.html nằm ở: dist/index.html
        var indexPath_1;
        if (app.isPackaged) {
            // Packaged: index.html nằm trong asar
            indexPath_1 = path.join(__dirname, '../../dist/index.html');
        }
        else {
            // Dev: index.html nằm ở dist/
            indexPath_1 = path.join(__dirname, '../../dist/index.html');
        }
        console.log('[Window] Loading index.html from:', indexPath_1);
        console.log('[Window] __dirname:', __dirname);
        console.log('[Window] app.isPackaged:', app.isPackaged);
        var fs_1 = require('fs');
        var fileExists = fs_1.existsSync(indexPath_1);
        console.log('[Window] File exists:', fileExists);
        if (!fileExists) {
            console.error('[Window] index.html NOT FOUND at:', indexPath_1);
            // Hiển thị window trước để có thể show dialog
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
            }
            // Hiển thị dialog lỗi ngay lập tức
            showLoadErrorDialog(mainWindow, 'FILE_NOT_FOUND', "Kh\u00F4ng t\u00ECm th\u1EA5y file index.html t\u1EA1i:\n".concat(indexPath_1, "\n\nVui l\u00F2ng c\u00E0i \u0111\u1EB7t l\u1EA1i \u1EE9ng d\u1EE5ng."), null);
            // Load error page thay vì return
            loadErrorPage(mainWindow, "File index.html kh\u00F4ng t\u1ED3n t\u1EA1i t\u1EA1i:\n".concat(indexPath_1, "\n\nVui l\u00F2ng ch\u1EA1y diagnostic script \u0111\u1EC3 ki\u1EC3m tra."));
            return;
        }
        // Retry logic cho việc load file
        var retryCount_1 = 0;
        var maxRetries_1 = 3;
        var loadFileWithRetry_1 = function () { return __awaiter(_this, void 0, void 0, function () {
            var err_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 6]);
                        return [4 /*yield*/, mainWindow.loadFile(indexPath_1)];
                    case 1:
                        _a.sent();
                        console.log('[Window] Successfully loaded index.html');
                        return [3 /*break*/, 6];
                    case 2:
                        err_3 = _a.sent();
                        retryCount_1++;
                        console.error("[Window] Failed to load index.html (attempt ".concat(retryCount_1, "/").concat(maxRetries_1, "):"), err_3);
                        console.error("[Window] Error details:", {
                            message: err_3 === null || err_3 === void 0 ? void 0 : err_3.message,
                            code: err_3 === null || err_3 === void 0 ? void 0 : err_3.code,
                            stack: err_3 === null || err_3 === void 0 ? void 0 : err_3.stack,
                        });
                        if (!(retryCount_1 < maxRetries_1)) return [3 /*break*/, 4];
                        // Đợi một chút trước khi retry
                        console.log("[Window] Retrying in ".concat(1000 * retryCount_1, "ms..."));
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 1000 * retryCount_1); })];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, loadFileWithRetry_1()];
                    case 4:
                        // Đã hết retry, hiển thị lỗi
                        console.error('[Window] All retry attempts failed, showing error page');
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.show();
                            // Đảm bảo window visible
                            if (!mainWindow.isVisible()) {
                                mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                                mainWindow.show();
                            }
                        }
                        showLoadErrorDialog(mainWindow, 'LOAD_ERROR', "Kh\u00F4ng th\u1EC3 t\u1EA3i file index.html sau ".concat(maxRetries_1, " l\u1EA7n th\u1EED:\n").concat(indexPath_1, "\n\nL\u1ED7i: ").concat((err_3 === null || err_3 === void 0 ? void 0 : err_3.message) || String(err_3)), err_3);
                        // Load error page
                        loadErrorPage(mainWindow, "L\u1ED7i khi t\u1EA3i file index.html sau ".concat(maxRetries_1, " l\u1EA7n th\u1EED:\n\n\u0110\u01B0\u1EDDng d\u1EABn: ").concat(indexPath_1, "\n\nL\u1ED7i: ").concat((err_3 === null || err_3 === void 0 ? void 0 : err_3.message) || String(err_3), "\n\nVui l\u00F2ng ch\u1EA1y diagnostic script \u0111\u1EC3 ki\u1EC3m tra:\n.\\scripts\\diagnose-app.ps1"));
                        _a.label = 5;
                    case 5: return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        }); };
        // Bắt lỗi nếu loadFileWithRetry throw
        loadFileWithRetry_1().catch(function (err) {
            console.error('[Window] loadFileWithRetry threw unhandled error:', err);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                loadErrorPage(mainWindow, "L\u1ED7i nghi\u00EAm tr\u1ECDng khi t\u1EA3i \u1EE9ng d\u1EE5ng:\n".concat((err === null || err === void 0 ? void 0 : err.message) || String(err)));
            }
        });
    }
    // Mở DevTools trong dev mode hoặc nếu có lỗi (để debug)
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }
    // Trong production, mở DevTools nếu có lỗi (tạm thời để debug)
    if (app.isPackaged && process.env.DEBUG === '1') {
        mainWindow.webContents.openDevTools();
    }
    // (Optional) xử lý link mở ngoài
    mainWindow.webContents.setWindowOpenHandler(function (details) {
        shell.openExternal(details.url);
        return { action: 'deny' };
    });
    // Setup YouTube handlers
    if (mainWindow) {
        setupYouTubeHandlers(mainWindow);
    }
}
function confirmResourcesForVideoJob(kind, targetDir) {
    return __awaiter(this, void 0, void 0, function () {
        var warnings, disk, spaceCheck, fiftyGB, err_4, sys, cpuTemp, err_5, message, response;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!mainWindow || mainWindow.isDestroyed())
                        return [2 /*return*/, true];
                    warnings = [];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, getDiskSpace(targetDir)];
                case 2:
                    disk = _b.sent();
                    spaceCheck = checkMinimumSpace(disk.free, 4);
                    if (!spaceCheck.enough) {
                        warnings.push("Dung l\u01B0\u1EE3ng tr\u1ED1ng \u00EDt: ".concat(formatBytes(disk.free), " tr\u00EAn \u1ED5 ").concat(disk.drive, " (khuy\u1EBFn ngh\u1ECB >= 4 GB cho job video)."));
                    }
                    fiftyGB = 50 * 1024 * 1024 * 1024;
                    if (disk.free < fiftyGB) {
                        warnings.push("\u1ED4 ".concat(disk.drive, " ch\u1EC9 c\u00F2n ").concat(formatBytes(disk.free), " (<50 GB). H\u00E3y d\u1ECDn d\u1EB9p b\u1EDBt d\u1EEF li\u1EC7u tr\u01B0\u1EDBc khi ch\u1EA1y job \u0111\u1EC3 tr\u00E1nh l\u1ED7i treo khi ghi file."));
                    }
                    return [3 /*break*/, 4];
                case 3:
                    err_4 = _b.sent();
                    console.warn('[ResourceMonitor] Không kiểm tra được dung lượng ổ đĩa:', err_4);
                    return [3 /*break*/, 4];
                case 4:
                    _b.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, getSystemInfo()];
                case 5:
                    sys = _b.sent();
                    cpuTemp = (_a = sys === null || sys === void 0 ? void 0 : sys.cpu) === null || _a === void 0 ? void 0 : _a.temperature;
                    if (typeof cpuTemp === 'number' && cpuTemp >= 80) {
                        warnings.push("Nhi\u1EC7t \u0111\u1ED9 CPU cao: ~".concat(cpuTemp.toFixed(1), "\u00B0C. N\u00EAn \u0111\u1EC3 m\u00E1y ngh\u1EC9 ho\u1EB7c t\u0103ng t\u1EA3n nhi\u1EC7t tr\u01B0\u1EDBc khi encode."));
                    }
                    return [3 /*break*/, 7];
                case 6:
                    err_5 = _b.sent();
                    console.warn('[ResourceMonitor] Không lấy được system info:', err_5);
                    return [3 /*break*/, 7];
                case 7:
                    if (!warnings.length)
                        return [2 /*return*/, true];
                    message = 'Trước khi xử lý video, hệ thống phát hiện một số cảnh báo tài nguyên:';
                    if (kind === 'final-export') {
                        message = 'Trước khi xuất video hoàn chỉnh, hệ thống phát hiện một số cảnh báo tài nguyên:';
                    }
                    else if (kind === 'merge') {
                        message = 'Trước khi ghép video, hệ thống phát hiện một số cảnh báo tài nguyên:';
                    }
                    else if (kind === 'mute') {
                        message = 'Trước khi tắt âm thanh video, hệ thống phát hiện một số cảnh báo tài nguyên:';
                    }
                    return [4 /*yield*/, dialog.showMessageBox(mainWindow, {
                            type: 'warning',
                            buttons: ['Tiếp tục', 'Hủy'],
                            defaultId: 1,
                            cancelId: 1,
                            title: 'Cảnh báo tài nguyên trước khi chạy job video',
                            message: message,
                            detail: warnings.join('\n'),
                        })];
                case 8:
                    response = (_b.sent()).response;
                    return [2 /*return*/, response === 0];
            }
        });
    });
}
// Log FFmpeg info
function logFfmpegInfo() {
    return __awaiter(this, void 0, void 0, function () {
        var paths, versionOutput, firstLine, err_6;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    paths = getFfmpegPaths();
                    console.log('[FFmpeg] using ffmpeg at:', paths.ffmpeg);
                    console.log('[FFmpeg] using ffprobe at:', paths.ffprobe);
                    return [4 /*yield*/, runFfprobe(['-version'])];
                case 1:
                    versionOutput = _a.sent();
                    firstLine = versionOutput.split(/\r?\n/)[0];
                    console.log('[FFmpeg] ffprobe version:', firstLine);
                    return [3 /*break*/, 3];
                case 2:
                    err_6 = _a.sent();
                    console.warn('[FFmpeg] ffprobe check failed:', err_6);
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// Đăng ký IPC handlers (GIỮ LẠI NHƯ CŨ, CHỈ DI CHUYỂN VÀO SAU createWindow)
function registerIpcHandlers() {
    var _this = this;
    ipcMain.handle('license:getState', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!(licenseState.status === 'checking')) return [3 /*break*/, 2];
                    return [4 /*yield*/, refreshLicenseState()];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/, licenseState];
            }
        });
    }); });
    ipcMain.handle('license:register', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, submitLicenseRequest(payload === null || payload === void 0 ? void 0 : payload.note)];
                case 1:
                    result = _a.sent();
                    licenseState = result.state;
                    return [2 /*return*/, result];
            }
        });
    }); });
    ipcMain.handle('license:retry', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, refreshLicenseState(true)];
                case 1:
                    _a.sent();
                    return [2 /*return*/, licenseState];
            }
        });
    }); });
    ipcMain.handle('license:clear', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, clearLicense()];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, refreshLicenseState(false)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, licenseState];
            }
        });
    }); });
    // ===== AUTH IPC (ONLINE, sử dụng Worker + D1) =====
    ipcMain.handle('auth:getState', function () { return __awaiter(_this, void 0, void 0, function () {
        var state;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getOrInitAuthState()];
                case 1:
                    state = _a.sent();
                    return [2 /*return*/, state];
            }
        });
    }); });
    ipcMain.handle('auth:register', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        var base, err_7;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getOrInitAuthState()];
                case 1:
                    base = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 5, , 6]);
                    return [4 /*yield*/, postJson('/api/auth/register', {
                            tai_khoan: payload.username,
                            mat_khau: payload.password,
                            ma_may: base.machineId,
                            version: APP_VERSION,
                        }
                        // Bỏ installer key - chưa cần thiết
                        // { 'x-installer-key': INSTALLER_SECRET }
                        )];
                case 3:
                    _a.sent();
                    authState = {
                        status: 'pending',
                        username: payload.username,
                        password: payload.password,
                        machineId: base.machineId,
                        activationKey: undefined,
                        message: 'Yêu cầu đăng ký đã được gửi lên server. Nhấn "Kiểm tra lại" sau khi admin cấp quyền.',
                        refreshCount: 0,
                    };
                    // Lưu trạng thái pending (không cần remember vì chưa được duyệt)
                    return [4 /*yield*/, writeEncryptedAuthState({
                            status: authState.status,
                            username: authState.username,
                            password: authState.password,
                            machineId: authState.machineId,
                            message: authState.message,
                            remember: false,
                        })];
                case 4:
                    // Lưu trạng thái pending (không cần remember vì chưa được duyệt)
                    _a.sent();
                    return [3 /*break*/, 6];
                case 5:
                    err_7 = _a.sent();
                    console.error('[auth:register] error', err_7);
                    authState = {
                        status: 'error',
                        machineId: base.machineId,
                        message: getFriendlyAuthError(err_7, 'Không gửi được yêu cầu đăng ký.'),
                    };
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/, authState];
            }
        });
    }); });
    ipcMain.handle('auth:refresh', function () { return __awaiter(_this, void 0, void 0, function () {
        var state, currentMachineId, stored, isSessionValid, result, status_1, stored_1, _a, updateSessionActivity, createSession, sessionInfo, err_8;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, getOrInitAuthState()];
                case 1:
                    state = _b.sent();
                    if (!state.username || !state.password) {
                        return [2 /*return*/, state];
                    }
                    return [4 /*yield*/, getMachineHash()];
                case 2:
                    currentMachineId = _b.sent();
                    if (state.machineId !== currentMachineId) {
                        console.warn('[auth:refresh] MachineId mismatch! Stored:', state.machineId, 'Current:', currentMachineId);
                        console.warn('[auth:refresh] Clearing auth state - user may have tampered with encrypted auth state');
                        clearEncryptedAuthState();
                        authState = {
                            status: 'unregistered',
                            machineId: currentMachineId,
                            message: 'Machine ID đã thay đổi. Vui lòng đăng nhập lại.',
                        };
                        return [2 /*return*/, authState];
                    }
                    return [4 /*yield*/, readEncryptedAuthState()];
                case 3:
                    stored = _b.sent();
                    if (!(stored && stored.status === 'allowed' && stored.sessionInfo)) return [3 /*break*/, 6];
                    return [4 /*yield*/, import('../backend/auth/sessionManager')];
                case 4:
                    isSessionValid = (_b.sent()).isSessionValid;
                    if (!!isSessionValid(stored.sessionInfo)) return [3 /*break*/, 6];
                    console.warn('[auth:refresh] Session expired, requiring re-login');
                    return [4 /*yield*/, clearEncryptedAuthState()];
                case 5:
                    _b.sent();
                    authState = {
                        status: 'unregistered',
                        machineId: currentMachineId,
                        message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
                    };
                    return [2 /*return*/, authState];
                case 6:
                    _b.trys.push([6, 13, , 14]);
                    return [4 /*yield*/, postJson('/api/auth/check', {
                            tai_khoan: state.username,
                            mat_khau: state.password,
                            ma_may: currentMachineId, // Dùng machineId hiện tại
                            version: APP_VERSION,
                        })];
                case 7:
                    result = _b.sent();
                    if (!!result.allow) return [3 /*break*/, 8];
                    status_1 = result.trang_thai === 'CHAN'
                        ? 'blocked'
                        : 'pending';
                    authState = __assign(__assign({}, state), { status: status_1, message: result.reason ||
                            (status_1 === 'blocked'
                                ? 'Tài khoản / máy đã bị chặn.'
                                : 'Tài khoản đang chờ admin cấp quyền.'), latestVersion: result.latestVersion, downloadUrl: result.downloadUrl });
                    return [3 /*break*/, 12];
                case 8:
                    authState = __assign(__assign({}, state), { status: 'allowed', activationKey: result.key_kich_hoat, message: 'Admin đã cấp quyền. Bạn có thể đăng nhập.', latestVersion: result.latestVersion, downloadUrl: result.downloadUrl });
                    return [4 /*yield*/, readEncryptedAuthState()];
                case 9:
                    stored_1 = _b.sent();
                    if (!(stored_1 && stored_1.remember)) return [3 /*break*/, 12];
                    return [4 /*yield*/, import('../backend/auth/sessionManager')];
                case 10:
                    _a = _b.sent(), updateSessionActivity = _a.updateSessionActivity, createSession = _a.createSession;
                    sessionInfo = stored_1.sessionInfo
                        ? updateSessionActivity(stored_1.sessionInfo)
                        : createSession();
                    return [4 /*yield*/, writeEncryptedAuthState(__assign(__assign({}, stored_1), { status: authState.status, activationKey: authState.activationKey, message: authState.message, latestVersion: authState.latestVersion, downloadUrl: authState.downloadUrl, sessionInfo: sessionInfo }))];
                case 11:
                    _b.sent();
                    _b.label = 12;
                case 12: return [3 /*break*/, 14];
                case 13:
                    err_8 = _b.sent();
                    console.error('[auth:refresh] error', err_8);
                    authState = __assign(__assign({}, state), { status: 'error', message: getFriendlyAuthError(err_8, 'Không kiểm tra được trạng thái từ server.') });
                    return [3 /*break*/, 14];
                case 14: return [2 /*return*/, authState];
            }
        });
    }); });
    ipcMain.handle('auth:login', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        var base, result, createSession, err_9;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 7, , 8]);
                    return [4 /*yield*/, getOrInitAuthState()];
                case 1:
                    base = _a.sent();
                    return [4 /*yield*/, postJson('/api/auth/check', {
                            tai_khoan: payload.username,
                            mat_khau: payload.password,
                            ma_may: base.machineId,
                            version: APP_VERSION,
                        })];
                case 2:
                    result = _a.sent();
                    if (!result.allow) {
                        return [2 /*return*/, {
                                ok: false,
                                message: result.reason ||
                                    (result.trang_thai === 'CHAN'
                                        ? 'Tài khoản / máy này đã bị chặn.'
                                        : 'Tài khoản chưa được cấp quyền.'),
                            }];
                    }
                    authState = {
                        status: 'allowed',
                        username: payload.username,
                        password: payload.password,
                        machineId: base.machineId,
                        activationKey: result.key_kich_hoat,
                        message: 'Đăng nhập thành công, tài khoản đã được kích hoạt.',
                        latestVersion: result.latestVersion,
                        downloadUrl: result.downloadUrl,
                    };
                    if (!payload.remember) return [3 /*break*/, 5];
                    return [4 /*yield*/, import('../backend/auth/sessionManager')];
                case 3:
                    createSession = (_a.sent()).createSession;
                    return [4 /*yield*/, writeEncryptedAuthState({
                            status: authState.status,
                            username: authState.username,
                            password: authState.password,
                            machineId: authState.machineId,
                            activationKey: authState.activationKey,
                            message: authState.message,
                            latestVersion: authState.latestVersion,
                            downloadUrl: authState.downloadUrl,
                            remember: true,
                            sessionInfo: createSession(),
                        })];
                case 4:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 5:
                    // Nếu không remember, xóa file cũ
                    clearEncryptedAuthState();
                    _a.label = 6;
                case 6: return [2 /*return*/, { ok: true }];
                case 7:
                    err_9 = _a.sent();
                    console.error('[auth:login] error', err_9);
                    return [2 /*return*/, {
                            ok: false,
                            message: getFriendlyAuthError(err_9, 'Lỗi khi đăng nhập với server.'),
                        }];
                case 8: return [2 /*return*/];
            }
        });
    }); });
    ipcMain.handle('auth:clear', function () { return __awaiter(_this, void 0, void 0, function () {
        var current;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getOrInitAuthState()];
                case 1:
                    current = _a.sent();
                    authState = {
                        status: 'unregistered',
                        machineId: current.machineId,
                        message: 'Đăng ký lại với tài khoản mới.',
                    };
                    // Xóa file stored
                    clearEncryptedAuthState();
                    return [2 /*return*/];
            }
        });
    }); });
    // Các handler đã có trước đó: music:scan, music:createPlaylist, music:preview, music:export,
    // video:cutSingle, video:cutBatch, video:merge, video:finalExport.
    // Nếu hiện tại file main.ts đang có logic nào cho những channel này
    // thì HÃY GIỮ LẠI NGUYÊN VẸN và chỉ đặt chúng trong hàm này.
    ipcMain.handle('music:scan', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('[IPC] music:scan', payload);
            // TODO: sẽ implement sau
            return [2 /*return*/, { ok: true }];
        });
    }); });
    ipcMain.handle('music:createPlaylist', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('[IPC] music:createPlaylist', payload);
            return [2 /*return*/, { ok: true }];
        });
    }); });
    ipcMain.handle('music:preview', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('[IPC] music:preview', payload);
            return [2 /*return*/, { ok: true }];
        });
    }); });
    ipcMain.handle('music:export', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('[IPC] music:export', payload);
            return [2 /*return*/, { ok: true }];
        });
    }); });
    // Job queue inspectors
    ipcMain.handle('jobQueue:list', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, jobQueue.getJobs()];
        });
    }); });
    ipcMain.handle('jobQueue:get', function (_event, jobId) { return __awaiter(_this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            return [2 /*return*/, (_a = jobQueue.getJob(jobId)) !== null && _a !== void 0 ? _a : null];
        });
    }); });
    ipcMain.handle('jobQueue:cancel', function (_event, jobId) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, jobQueue.cancelJob(jobId)];
                case 1:
                    _a.sent();
                    return [2 /*return*/, { success: true }];
            }
        });
    }); });
    ipcMain.handle('video:cutSingle', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('[IPC] video:cutSingle', payload);
            return [2 /*return*/, { ok: true }];
        });
    }); });
    ipcMain.handle('video:cutBatch', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('[IPC] video:cutBatch', payload);
            return [2 /*return*/, { ok: true }];
        });
    }); });
    ipcMain.handle('video:merge', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('[IPC] video:merge', payload);
            return [2 /*return*/, { ok: true }];
        });
    }); });
    ipcMain.handle('video:finalExport', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            console.log('[IPC] video:finalExport', payload);
            return [2 /*return*/, { ok: true }];
        });
    }); });
    // FFprobe IPC
    ipcMain.handle('ffmpeg:probe', function (_event, filePath) { return __awaiter(_this, void 0, void 0, function () {
        var probeModule;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!!probeFile) return [3 /*break*/, 2];
                    return [4 /*yield*/, import('../backend/ffmpeg/probe')];
                case 1:
                    probeModule = _a.sent();
                    probeFile = probeModule.probeFile;
                    _a.label = 2;
                case 2: return [4 /*yield*/, probeFile(filePath)];
                case 3: return [2 /*return*/, _a.sent()];
            }
        });
    }); });
    // System info IPC
    ipcMain.handle('system:info', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getSystemInfo()];
                case 1: return [2 /*return*/, _a.sent()];
            }
        });
    }); });
    ipcMain.handle('system:realtime', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getRealtimeStats()];
                case 1: return [2 /*return*/, _a.sent()];
            }
        });
    }); });
    ipcMain.handle('system:getDiskInfo', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (cachedDiskInfo)
                        return [2 /*return*/, cachedDiskInfo];
                    return [4 /*yield*/, refreshDiskInfoAndBroadcast()];
                case 1: return [2 /*return*/, _a.sent()];
            }
        });
    }); });
    ipcMain.handle('system:refreshDiskInfo', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, refreshDiskInfoAndBroadcast()];
                case 1: return [2 /*return*/, _a.sent()];
            }
        });
    }); });
    // Dialog IPC
    ipcMain.handle('dialog:selectFolder', function () { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, dialog.showOpenDialog({
                        properties: ['openDirectory'],
                    })];
                case 1:
                    result = _a.sent();
                    if (result.canceled || result.filePaths.length === 0) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, result.filePaths[0]];
            }
        });
    }); });
    ipcMain.handle('dialog:selectVideoFile', function () { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, dialog.showOpenDialog({
                        properties: ['openFile'],
                        filters: [
                            { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
                            { name: 'All Files', extensions: ['*'] },
                        ],
                    })];
                case 1:
                    result = _a.sent();
                    if (result.canceled || result.filePaths.length === 0) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, result.filePaths[0]];
            }
        });
    }); });
    ipcMain.handle('dialog:selectVideoFilesMulti', function () { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, dialog.showOpenDialog({
                        properties: ['openFile', 'multiSelections'],
                        filters: [
                            { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
                            { name: 'All Files', extensions: ['*'] },
                        ],
                    })];
                case 1:
                    result = _a.sent();
                    if (result.canceled || result.filePaths.length === 0) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, result.filePaths];
            }
        });
    }); });
    ipcMain.handle('dialog:selectAudioFile', function () { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, dialog.showOpenDialog({
                        properties: ['openFile'],
                        filters: [
                            { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac'] },
                            { name: 'All Files', extensions: ['*'] },
                        ],
                    })];
                case 1:
                    result = _a.sent();
                    if (result.canceled || result.filePaths.length === 0) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, result.filePaths[0]];
            }
        });
    }); });
    ipcMain.handle('dialog:selectAudioFilesMulti', function () { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, dialog.showOpenDialog({
                        properties: ['openFile', 'multiSelections'],
                        filters: [
                            { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac'] },
                            { name: 'All Files', extensions: ['*'] },
                        ],
                    })];
                case 1:
                    result = _a.sent();
                    if (result.canceled || result.filePaths.length === 0) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, result.filePaths];
            }
        });
    }); });
    ipcMain.handle('dialog:selectManyVideos', function () { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, dialog.showOpenDialog({
                        properties: ['openFile', 'multiSelections'],
                        filters: [
                            { name: 'Video Files', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] },
                            { name: 'All Files', extensions: ['*'] },
                        ],
                    })];
                case 1:
                    result = _a.sent();
                    if (result.canceled || result.filePaths.length === 0) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, result.filePaths];
            }
        });
    }); });
    // System: Create Directory IPC
    ipcMain.handle('system:createDirectory', function (_event, dirPath) { return __awaiter(_this, void 0, void 0, function () {
        var fs_2, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, import('node:fs')];
                case 1:
                    fs_2 = _a.sent();
                    return [4 /*yield*/, fs_2.promises.mkdir(dirPath, { recursive: true })];
                case 2:
                    _a.sent();
                    return [2 /*return*/, { success: true }];
                case 3:
                    error_3 = _a.sent();
                    return [2 /*return*/, { success: false, error: (error_3 === null || error_3 === void 0 ? void 0 : error_3.message) || String(error_3) }];
                case 4: return [2 /*return*/];
            }
        });
    }); });
    ipcMain.handle('video:listVideosInFolder', function (_event, folderPath) { return __awaiter(_this, void 0, void 0, function () {
        var fs_3, path_1, exts, entries, files, _i, entries_1, entry, ext, full, sizeBytes, err_10;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, import('node:fs')];
                case 1:
                    fs_3 = _a.sent();
                    return [4 /*yield*/, import('node:path')];
                case 2:
                    path_1 = _a.sent();
                    exts = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm']);
                    entries = fs_3.readdirSync(folderPath, { withFileTypes: true });
                    files = [];
                    for (_i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                        entry = entries_1[_i];
                        if (!entry.isFile())
                            continue;
                        ext = path_1.extname(entry.name).toLowerCase();
                        if (!exts.has(ext))
                            continue;
                        full = path_1.join(folderPath, entry.name);
                        sizeBytes = 0;
                        try {
                            sizeBytes = fs_3.statSync(full).size;
                        }
                        catch (_b) { }
                        files.push({ path: full, fileName: entry.name, sizeBytes: sizeBytes });
                    }
                    return [2 /*return*/, files];
                case 3:
                    err_10 = _a.sent();
                    console.error('[IPC] video:listVideosInFolder error', err_10);
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    }); });
    ipcMain.handle('video:listVideosInFolderSimple', function (_event, folderPath) { return __awaiter(_this, void 0, void 0, function () {
        var fs_4, path_2, exts, entries, files, _i, entries_2, entry, ext, full, sizeBytes, err_11;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    console.log('[IPC] video:listVideosInFolderSimple', folderPath);
                    return [4 /*yield*/, import('node:fs')];
                case 1:
                    fs_4 = _a.sent();
                    return [4 /*yield*/, import('node:path')];
                case 2:
                    path_2 = _a.sent();
                    exts = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm']);
                    entries = fs_4.readdirSync(folderPath, { withFileTypes: true });
                    files = [];
                    for (_i = 0, entries_2 = entries; _i < entries_2.length; _i++) {
                        entry = entries_2[_i];
                        if (!entry.isFile())
                            continue;
                        ext = path_2.extname(entry.name).toLowerCase();
                        if (!exts.has(ext))
                            continue;
                        full = path_2.join(folderPath, entry.name);
                        sizeBytes = 0;
                        try {
                            sizeBytes = fs_4.statSync(full).size;
                        }
                        catch (_b) { }
                        files.push({ path: full, fileName: entry.name, sizeBytes: sizeBytes });
                    }
                    return [2 /*return*/, files];
                case 3:
                    err_11 = _a.sent();
                    console.error('[IPC] video:listVideosInFolderSimple error', err_11);
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    }); });
    // Ultra Fast Scan (recursive) - DEPRECATED, fallback to simple scan
    ipcMain.handle('video:ultraFastScanFolder', function (_event, folderPath) { return __awaiter(_this, void 0, void 0, function () {
        var fs_5, path_3, exts_1, files_1, scanDir_1, err_12;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    console.log('[IPC] video:ultraFastScanFolder', folderPath);
                    return [4 /*yield*/, import('node:fs')];
                case 1:
                    fs_5 = _a.sent();
                    return [4 /*yield*/, import('node:path')];
                case 2:
                    path_3 = _a.sent();
                    exts_1 = new Set(['.mp4', '.mkv', '.mov', '.m4v', '.avi', '.wmv', '.webm']);
                    files_1 = [];
                    scanDir_1 = function (dir) {
                        try {
                            var entries = fs_5.readdirSync(dir, { withFileTypes: true });
                            for (var _i = 0, entries_3 = entries; _i < entries_3.length; _i++) {
                                var entry = entries_3[_i];
                                var fullPath = path_3.join(dir, entry.name);
                                if (entry.isDirectory()) {
                                    scanDir_1(fullPath);
                                }
                                else if (entry.isFile()) {
                                    var ext = path_3.extname(entry.name).toLowerCase();
                                    if (exts_1.has(ext)) {
                                        try {
                                            var stats = fs_5.statSync(fullPath);
                                            files_1.push({
                                                path: fullPath,
                                                fileName: entry.name,
                                                sizeBytes: stats.size,
                                                mtimeMs: stats.mtimeMs,
                                            });
                                        }
                                        catch (_a) { }
                                    }
                                }
                            }
                        }
                        catch (_b) { }
                    };
                    scanDir_1(folderPath);
                    return [2 /*return*/, files_1];
                case 3:
                    err_12 = _a.sent();
                    console.error('[IPC] video:ultraFastScanFolder error', err_12);
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    }); });
    // Batch Lazy Probe - DEPRECATED, fallback to sequential probe
    ipcMain.handle('video:batchLazyProbe', function (_event_1, paths_1) {
        var args_1 = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args_1[_i - 2] = arguments[_i];
        }
        return __awaiter(_this, __spreadArray([_event_1, paths_1], args_1, true), void 0, function (_event, paths, concurrency) {
            var results_1, limit, chunks, i, _a, chunks_1, chunk, err_13;
            var _this = this;
            if (concurrency === void 0) { concurrency = 5; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 5, , 6]);
                        console.log('[IPC] video:batchLazyProbe', paths.length, 'files, concurrency:', concurrency);
                        results_1 = {};
                        limit = Math.min(concurrency, paths.length);
                        chunks = [];
                        for (i = 0; i < paths.length; i += limit) {
                            chunks.push(paths.slice(i, i + limit));
                        }
                        _a = 0, chunks_1 = chunks;
                        _b.label = 1;
                    case 1:
                        if (!(_a < chunks_1.length)) return [3 /*break*/, 4];
                        chunk = chunks_1[_a];
                        return [4 /*yield*/, Promise.all(chunk.map(function (p) { return __awaiter(_this, void 0, void 0, function () {
                                var info, err_14;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            _a.trys.push([0, 2, , 3]);
                                            return [4 /*yield*/, getVideoFileInfo(p)];
                                        case 1:
                                            info = _a.sent();
                                            results_1[p] = info;
                                            return [3 /*break*/, 3];
                                        case 2:
                                            err_14 = _a.sent();
                                            console.warn('[batchLazyProbe] Failed to probe', p, err_14);
                                            return [3 /*break*/, 3];
                                        case 3: return [2 /*return*/];
                                    }
                                });
                            }); }))];
                    case 2:
                        _b.sent();
                        _b.label = 3;
                    case 3:
                        _a++;
                        return [3 /*break*/, 1];
                    case 4: return [2 /*return*/, results_1];
                    case 5:
                        err_13 = _b.sent();
                        console.error('[IPC] video:batchLazyProbe error', err_13);
                        return [2 /*return*/, {}];
                    case 6: return [2 /*return*/];
                }
            });
        });
    });
    // Music scan IPC
    ipcMain.handle('music:scanFolders', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // payload: { priorityFolder: string | null; randomFolder: string | null }
                    console.log('[IPC] music:scanFolders', payload);
                    // Clear playlists khi quét nhạc mới (playlist cũ không còn hợp lệ)
                    clearPlaylists();
                    console.log('[IPC] Cleared old playlists due to new scan');
                    return [4 /*yield*/, scanMusicFolders(payload)];
                case 1:
                    result = _a.sent();
                    return [2 /*return*/, result];
            }
        });
    }); });
    // Create playlists IPC
    ipcMain.handle('music:createPlaylists', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        var playlists;
        var _a, _b;
        return __generator(this, function (_c) {
            console.log('[IPC] music:createPlaylists', {
                tracks: (_a = payload.tracks) === null || _a === void 0 ? void 0 : _a.length,
                pinned: (_b = payload.pinnedTrackIds) === null || _b === void 0 ? void 0 : _b.length,
                playlistCount: payload.playlistCount,
                targetMinutes: payload.targetDurationMinutes,
            });
            playlists = buildPlaylists(payload);
            savePlaylists(playlists);
            return [2 /*return*/, playlists];
        });
    }); });
    // List playlists IPC
    ipcMain.handle('music:listPlaylists', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, getPlaylists()];
        });
    }); });
    ipcMain.handle('music:getLastScan', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, loadScanResult()];
        });
    }); });
    // Export history (3 ngày gần nhất)
    ipcMain.handle('music:getExportHistory', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            try {
                return [2 /*return*/, getRecentHistory()];
            }
            catch (err) {
                console.error('[IPC] music:getExportHistory error', err);
                return [2 /*return*/, []];
            }
            return [2 /*return*/];
        });
    }); });
    // Validate playlists for crossfade (pre-check) - REMOVED: duplicate handler, using the one below
    ipcMain.handle('video:seo:apply', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        var result, err_15;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, applySeoMetadata(payload)];
                case 1:
                    result = _a.sent();
                    return [2 /*return*/, result];
                case 2:
                    err_15 = _a.sent();
                    console.error('[IPC] video:seo:apply error', err_15);
                    return [2 /*return*/, { error: (err_15 === null || err_15 === void 0 ? void 0 : err_15.message) || String(err_15) }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // Export playlist IPC
    var EXPORT_PROGRESS_CHANNEL = 'music:exportProgress';
    ipcMain.handle('music:exportPlaylist', function (event, req) { return __awaiter(_this, void 0, void 0, function () {
        var sender, jobHandle, result, err_16;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('[IPC] music:exportPlaylist', req);
                    sender = event.sender;
                    jobHandle = jobQueue.enqueue({
                        type: 'music:export-playlist',
                        payload: {
                            playlistId: req.playlistId,
                            outputPath: req === null || req === void 0 ? void 0 : req.outputPath,
                            // Lưu thêm metadata để restore UI khi component mount lại
                            playlistName: req === null || req === void 0 ? void 0 : req.playlistName,
                            currentIndex: req === null || req === void 0 ? void 0 : req.currentIndex,
                            totalCount: req === null || req === void 0 ? void 0 : req.totalCount,
                        },
                        onCancel: function (jobId) {
                            // Cancel FFmpeg process trong videoJobManager
                            videoJobManager.cancelJob(jobId);
                        },
                        task: function (ctx) { return __awaiter(_this, void 0, void 0, function () {
                            var result;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, exportPlaylistToFile(__assign(__assign({}, req), { requestId: ctx.jobId, signal: ctx.signal }), function (progress) {
                                            var _a;
                                            var progressPercent = (_a = progress.percent) !== null && _a !== void 0 ? _a : (progress.totalSec && progress.totalSec > 0
                                                ? (progress.currentSec / progress.totalSec) * 100
                                                : undefined);
                                            ctx.updateProgress(progressPercent, 'Exporting playlist');
                                            sender.send(EXPORT_PROGRESS_CHANNEL, __assign(__assign({}, progress), { requestId: ctx.jobId }));
                                        })];
                                    case 1:
                                        result = _a.sent();
                                        return [2 /*return*/, result];
                                }
                            });
                        }); },
                    });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, jobHandle.result];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, __assign(__assign({}, result), { requestId: jobHandle.jobId })];
                case 3:
                    err_16 = _a.sent();
                    console.error('[IPC] music:exportPlaylist error', err_16);
                    return [2 /*return*/, {
                            success: false,
                            error: (err_16 === null || err_16 === void 0 ? void 0 : err_16.message) || 'Lỗi không xác định khi xuất playlist.',
                            requestId: jobHandle.jobId,
                        }];
                case 4: return [2 /*return*/];
            }
        });
    }); });
    // Validate playlists for crossfade IPC
    ipcMain.removeHandler('music:validatePlaylistsForCrossfade'); // Remove handler cũ nếu có (tránh lỗi khi hot-reload)
    ipcMain.handle('music:validatePlaylistsForCrossfade', function (_event, req) { return __awaiter(_this, void 0, void 0, function () {
        var result, err_17;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    console.log('[IPC] music:validatePlaylistsForCrossfade', req);
                    return [4 /*yield*/, validatePlaylistsForCrossfade(req)];
                case 1:
                    result = _a.sent();
                    return [2 /*return*/, result];
                case 2:
                    err_17 = _a.sent();
                    console.error('[IPC] music:validatePlaylistsForCrossfade error', err_17);
                    return [2 /*return*/, {
                            results: [],
                            totalChecked: 0,
                            totalWithIssues: 0,
                        }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // Normalize audio bitrate IPC
    ipcMain.handle('music:normalizeAudio', function (event, req) { return __awaiter(_this, void 0, void 0, function () {
        var sender, progressChannel, result, err_18;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('[IPC] music:normalizeAudio', req);
                    sender = event.sender;
                    progressChannel = 'music:normalizeAudio:progress';
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, normalizeAudio(req, function (progress) {
                            // Gửi progress đến renderer
                            sender.send(progressChannel, progress);
                        })];
                case 2:
                    result = _a.sent();
                    return [2 /*return*/, result];
                case 3:
                    err_18 = _a.sent();
                    console.error('[IPC] music:normalizeAudio error', err_18);
                    return [2 /*return*/, {
                            success: false,
                            processed: 0,
                            failed: 0,
                            errors: [{ file: '', error: (err_18 === null || err_18 === void 0 ? void 0 : err_18.message) || 'Lỗi không xác định' }],
                            outputFiles: [],
                        }];
                case 4: return [2 /*return*/];
            }
        });
    }); });
    ipcMain.handle('music:normalizeAudio:cancel', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            cancelNormalizeAudio();
            return [2 /*return*/, { ok: true }];
        });
    }); });
    // Cut video segment IPC (DEPRECATED - file cutVideo.ts không tồn tại)
    // ipcMain.handle('video:cutSegment', async (event, req: any) => {
    //   throw new Error('video:cutSegment is deprecated')
    // })
    // Video probe file IPC
    ipcMain.handle('video:probeFile', function (_event, filePath) { return __awaiter(_this, void 0, void 0, function () {
        var info, err_19;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    console.log('[IPC] video:probeFile', filePath);
                    return [4 /*yield*/, getVideoFileInfo(filePath)];
                case 1:
                    info = _a.sent();
                    return [2 /*return*/, info];
                case 2:
                    err_19 = _a.sent();
                    console.error('[IPC] video:probeFile error', err_19);
                    throw err_19;
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // Video split file IPC (DEPRECATED - file splitVideo.ts không tồn tại)
    var VIDEO_PROGRESS_CHANNEL = 'video:progress';
    // ipcMain.handle('video:splitFile', async (event, options: any) => {
    //   throw new Error('video:splitFile is deprecated, use video:splitManySimple')
    // })
    // Video merge file IPC (DEPRECATED - file mergeVideo.ts không tồn tại)
    // ipcMain.handle('video:mergeFile', async (event, options: any) => {
    //   throw new Error('video:mergeFile is deprecated, use video:mergeSimple')
    // })
    // ============================================
    // TURBO ENGINE IPC HANDLERS
    // ============================================
    // Detect disk type (DEPRECATED - không dùng nữa, giữ lại để tránh lỗi)
    // ipcMain.handle('video:detectDiskType', async (_event, filePath: string) => {
    //   return 'UNKNOWN'
    // })
    // Get disk info (DEPRECATED - không dùng nữa, giữ lại để tránh lỗi)
    // ipcMain.handle('video:getDiskInfo', async (_event, filePath: string) => {
    //   return { type: 'UNKNOWN' as const, mount: '', isFast: false }
    // })
    // Open path (folder/file) in system file manager
    ipcMain.handle('system:openPath', function (_event, pathToOpen) { return __awaiter(_this, void 0, void 0, function () {
        var err_20;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, shell.openPath(pathToOpen)];
                case 1:
                    _a.sent();
                    return [2 /*return*/, { success: true }];
                case 2:
                    err_20 = _a.sent();
                    console.error('[IPC] system:openPath error', err_20);
                    return [2 /*return*/, { success: false, error: String(err_20) }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ========== VIDEO SIMPLE MODULE IPC HANDLERS ==========
    // Get video file info with timeout
    ipcMain.handle('video:getFileInfo', function (_event, filePath) { return __awaiter(_this, void 0, void 0, function () {
        var timeoutMs_1, timeoutPromise, infoPromise, result, err_21;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    timeoutMs_1 = 8000 // 8 seconds timeout
                    ;
                    timeoutPromise = new Promise(function (_, reject) {
                        setTimeout(function () { return reject(new Error('Timeout: videoGetFileInfo took longer than 8s')); }, timeoutMs_1);
                    });
                    infoPromise = getVideoFileInfo(filePath);
                    return [4 /*yield*/, Promise.race([infoPromise, timeoutPromise])];
                case 1:
                    result = _b.sent();
                    return [2 /*return*/, result];
                case 2:
                    err_21 = _b.sent();
                    console.error('[IPC] video:getFileInfo error', err_21);
                    // Return safe default on timeout or error
                    if ((_a = err_21 === null || err_21 === void 0 ? void 0 : err_21.message) === null || _a === void 0 ? void 0 : _a.includes('Timeout')) {
                        console.warn('[IPC] video:getFileInfo timeout, returning default');
                        return [2 /*return*/, { durationSec: 0, filePath: filePath }];
                    }
                    throw err_21;
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // Cut single video simple
    ipcMain.handle('video:cutSingleSimple', function (event, req) { return __awaiter(_this, void 0, void 0, function () {
        var sender, jobHandle, err_22;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sender = event.sender;
                    jobHandle = jobQueue.enqueue({
                        type: 'video:cut-single',
                        payload: { inputPath: req.inputPath, segmentLengthSec: req.segmentLengthSec },
                        onCancel: function (jobId) { return videoJobManager.cancelJob(jobId); },
                        task: function (ctx) { return __awaiter(_this, void 0, void 0, function () {
                            var result;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, cutVideoIntoSegmentsSimple(__assign(__assign({}, req), { requestId: ctx.jobId }), function (progress) {
                                            var _a;
                                            var percent = (_a = progress.percent) !== null && _a !== void 0 ? _a : 0;
                                            ctx.updateProgress(percent, "Cutting video (".concat(percent.toFixed(1), "%)"));
                                            sender.send(VIDEO_PROGRESS_CHANNEL, __assign(__assign({}, progress), { requestId: ctx.jobId, mode: 'single-cut' }));
                                        }, { signal: ctx.signal } // Pass AbortSignal để có thể cancel
                                        )];
                                    case 1:
                                        result = _a.sent();
                                        if (result.success) {
                                            sender.send(VIDEO_PROGRESS_CHANNEL, {
                                                requestId: ctx.jobId,
                                                mode: 'single-cut',
                                                completed: true,
                                                outputFiles: result.outputFiles,
                                                segmentCount: result.segmentCount,
                                                avgSpeed: result.avgSpeed,
                                                elapsedMs: result.elapsedMs,
                                            });
                                        }
                                        else {
                                            sender.send(VIDEO_PROGRESS_CHANNEL, {
                                                requestId: ctx.jobId,
                                                mode: 'single-cut',
                                                error: result.error,
                                            });
                                        }
                                        return [2 /*return*/, result];
                                }
                            });
                        }); },
                    });
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, jobHandle.result];
                case 2: return [2 /*return*/, _a.sent()];
                case 3:
                    err_22 = _a.sent();
                    console.error('[IPC] video:cutSingleSimple error', err_22);
                    throw err_22;
                case 4: return [2 /*return*/];
            }
        });
    }); });
    // Split many videos simple
    ipcMain.handle('video:splitManySimple', function (event, req) { return __awaiter(_this, void 0, void 0, function () {
        var sender, jobHandle, err_23;
        var _this = this;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    sender = event.sender;
                    jobHandle = jobQueue.enqueue({
                        type: 'video:split-many',
                        payload: { files: (_d = (_b = (_a = req.inputFiles) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : (_c = req.inputPaths) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0 },
                        onCancel: function (jobId) {
                            // Cancel parent job và tất cả child jobs
                            console.log("[IPC] Cancelling split-many job ".concat(jobId));
                            videoJobManager.cancelJob(jobId);
                            // Cancel tất cả child jobs (format: ${jobId}-${index})
                            // Tìm tất cả jobs có prefix là jobId
                            var allJobIds = videoJobManager.getAllJobIds();
                            for (var _i = 0, allJobIds_1 = allJobIds; _i < allJobIds_1.length; _i++) {
                                var childId = allJobIds_1[_i];
                                if (childId.startsWith("".concat(jobId, "-"))) {
                                    console.log("[IPC] Cancelling child job ".concat(childId));
                                    videoJobManager.cancelJob(childId);
                                }
                            }
                        },
                        task: function (ctx) { return __awaiter(_this, void 0, void 0, function () {
                            var result;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, splitManyVideosSimple(__assign(__assign({}, req), { requestId: ctx.jobId }), function (progress) {
                                            var _a, _b;
                                            var percent = (_b = (_a = progress.overallPercent) !== null && _a !== void 0 ? _a : progress.percent) !== null && _b !== void 0 ? _b : 0;
                                            ctx.updateProgress(percent, "Splitting videos (".concat(percent.toFixed(1), "%)"));
                                            sender.send(VIDEO_PROGRESS_CHANNEL, __assign(__assign({}, progress), { requestId: ctx.jobId, mode: 'multi-cut' }));
                                        }, { signal: ctx.signal })];
                                    case 1:
                                        result = _a.sent();
                                        return [2 /*return*/, result];
                                }
                            });
                        }); },
                    });
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, jobHandle.result];
                case 2: return [2 /*return*/, _e.sent()];
                case 3:
                    err_23 = _e.sent();
                    console.error('[IPC] video:splitManySimple error', err_23);
                    throw err_23;
                case 4: return [2 /*return*/];
            }
        });
    }); });
    // Merge videos simple
    ipcMain.handle('video:mergeSimple', function (event, req) { return __awaiter(_this, void 0, void 0, function () {
        var sender, proceed, requestId_1, result, cleanup_1, checkInterval_1, err_24;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sender = event.sender;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 7, , 8]);
                    return [4 /*yield*/, confirmResourcesForVideoJob('merge', req.outputDir)];
                case 2:
                    proceed = _a.sent();
                    if (!proceed) {
                        return [2 /*return*/, {
                                requestId: '',
                                outputPaths: [],
                                totalDurationSec: 0,
                                success: false,
                                error: 'Job đã bị hủy sau cảnh báo tài nguyên.',
                            }];
                    }
                    requestId_1 = req.requestId || randomUUID();
                    activeMergeRequestId = requestId_1;
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, , 5, 6]);
                    return [4 /*yield*/, mergeVideosSimple(__assign(__assign({}, req), { requestId: requestId_1 }), function (progress) {
                            sender.send(VIDEO_PROGRESS_CHANNEL, progress);
                        })];
                case 4:
                    result = _a.sent();
                    return [2 /*return*/, result];
                case 5:
                    // Only clear if job is no longer tracked
                    if (!videoJobManager.hasJob(requestId_1)) {
                        activeMergeRequestId = null;
                    }
                    else {
                        cleanup_1 = function () {
                            activeMergeRequestId = null;
                        };
                        checkInterval_1 = setInterval(function () {
                            if (!videoJobManager.hasJob(requestId_1)) {
                                clearInterval(checkInterval_1);
                                cleanup_1();
                            }
                        }, 500);
                    }
                    return [7 /*endfinally*/];
                case 6: return [3 /*break*/, 8];
                case 7:
                    err_24 = _a.sent();
                    console.error('[IPC] video:mergeSimple error', err_24);
                    throw err_24;
                case 8: return [2 /*return*/];
            }
        });
    }); });
    // Mute video audio
    var activeMuteRequestId = null;
    ipcMain.handle('video:muteAudio', function (event, req) { return __awaiter(_this, void 0, void 0, function () {
        var sender, proceed, requestId_2, result, cleanup_2, checkInterval_2, err_25;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sender = event.sender;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 7, , 8]);
                    return [4 /*yield*/, confirmResourcesForVideoJob('mute', req.outputDir)];
                case 2:
                    proceed = _a.sent();
                    if (!proceed) {
                        return [2 /*return*/, {
                                requestId: '',
                                outputPaths: [],
                                success: false,
                                error: 'Job đã bị hủy sau cảnh báo tài nguyên.',
                                processed: 0,
                                failed: 0,
                            }];
                    }
                    requestId_2 = req.requestId || randomUUID();
                    activeMuteRequestId = requestId_2;
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, , 5, 6]);
                    return [4 /*yield*/, muteVideoAudio(__assign(__assign({}, req), { requestId: requestId_2 }), function (progress) {
                            sender.send(VIDEO_PROGRESS_CHANNEL, __assign(__assign({}, progress), { requestId: requestId_2, mode: 'mute-audio' }));
                        })];
                case 4:
                    result = _a.sent();
                    return [2 /*return*/, result];
                case 5:
                    // Only clear if job is no longer tracked
                    if (!videoJobManager.hasJob(requestId_2)) {
                        activeMuteRequestId = null;
                    }
                    else {
                        cleanup_2 = function () {
                            activeMuteRequestId = null;
                        };
                        checkInterval_2 = setInterval(function () {
                            if (!videoJobManager.hasJob(requestId_2)) {
                                clearInterval(checkInterval_2);
                                cleanup_2();
                            }
                        }, 500);
                    }
                    return [7 /*endfinally*/];
                case 6: return [3 /*break*/, 8];
                case 7:
                    err_25 = _a.sent();
                    console.error('[IPC] video:muteAudio error', err_25);
                    return [2 /*return*/, {
                            requestId: req.requestId || randomUUID(),
                            outputPaths: [],
                            success: false,
                            error: (err_25 === null || err_25 === void 0 ? void 0 : err_25.message) || 'Lỗi không xác định khi tắt âm thanh video',
                            processed: 0,
                            failed: 0,
                        }];
                case 8: return [2 /*return*/];
            }
        });
    }); });
    ipcMain.handle('video:getActiveMuteJobId', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, activeMuteRequestId];
        });
    }); });
    ipcMain.handle('video:final-export:scan-audio', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        var err_26;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, scanAudioSource(payload)];
                case 1: return [2 /*return*/, _a.sent()];
                case 2:
                    err_26 = _a.sent();
                    console.error('[IPC] scan-audio error:', err_26);
                    throw new Error((err_26 === null || err_26 === void 0 ? void 0 : err_26.message) || 'Scan audio source failed');
                case 3: return [2 /*return*/];
            }
        });
    }); });
    ipcMain.handle('video:final-export:scan-video', function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        var err_27;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, scanVideoSource(payload)];
                case 1: return [2 /*return*/, _a.sent()];
                case 2:
                    err_27 = _a.sent();
                    console.error('[IPC] scan-video error:', err_27);
                    throw new Error((err_27 === null || err_27 === void 0 ? void 0 : err_27.message) || 'Scan video source failed');
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // Map để lưu jobHandle theo requestId để có thể cancel
    var finalExportJobHandles = new Map();
    // Final export request handler
    ipcMain.on(VIDEO_FINAL_EXPORT_REQUEST, function (_event, payload) { return __awaiter(_this, void 0, void 0, function () {
        // Helper function to track video export
        function trackVideoExport(status, errorMessage, videoFile, durationSec) {
            return __awaiter(this, void 0, void 0, function () {
                var authState_1, machineId, username, fileSize, exportFormat, stats, ext, trackingPayload, LICENSE_SERVER, response, errorText, error_4;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 6, , 7]);
                            return [4 /*yield*/, getOrInitAuthState()];
                        case 1:
                            authState_1 = _a.sent();
                            if (!authState_1.username || !authState_1.machineId) {
                                console.log('[Video Export Tracking] Skipping - user not authenticated');
                                return [2 /*return*/];
                            }
                            machineId = authState_1.machineId;
                            username = authState_1.username;
                            fileSize = null;
                            exportFormat = null;
                            if (videoFile && fs.existsSync(videoFile)) {
                                try {
                                    stats = fs.statSync(videoFile);
                                    fileSize = stats.size;
                                    ext = path.extname(videoFile).toLowerCase();
                                    exportFormat = ext ? ext.substring(1) : null; // Remove leading dot
                                }
                                catch (err) {
                                    console.warn('[Video Export Tracking] Failed to get file stats:', err);
                                }
                            }
                            trackingPayload = {
                                username: username,
                                machine_id: machineId,
                                status: status,
                                error_message: errorMessage || null,
                                video_duration: durationSec ? Math.round(durationSec) : null,
                                file_size: fileSize,
                                export_format: exportFormat,
                            };
                            LICENSE_SERVER = process.env.LICENSE_SERVER_BASE || 'https://license-server.dungdong333.workers.dev';
                            return [4 /*yield*/, fetch("".concat(LICENSE_SERVER, "/api/video/export"), {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify(trackingPayload),
                                })];
                        case 2:
                            response = _a.sent();
                            if (!!response.ok) return [3 /*break*/, 4];
                            return [4 /*yield*/, response.text()];
                        case 3:
                            errorText = _a.sent();
                            console.warn('[Video Export Tracking] Failed to track export:', response.status, errorText);
                            return [3 /*break*/, 5];
                        case 4:
                            console.log('[Video Export Tracking] Successfully tracked video export:', status);
                            _a.label = 5;
                        case 5: return [3 /*break*/, 7];
                        case 6:
                            error_4 = _a.sent();
                            // Don't throw - tracking is non-blocking
                            console.warn('[Video Export Tracking] Error:', error_4.message);
                            return [3 /*break*/, 7];
                        case 7: return [2 /*return*/];
                    }
                });
            });
        }
        var sender, requestId, existingJobs, runningFinalExport, proceed, emitter, jobHandle;
        var _this = this;
        var _a, _b, _c, _d, _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    console.log('[IPC] VIDEO_FINAL_EXPORT_REQUEST received:', payload);
                    if (!mainWindow || mainWindow.isDestroyed()) {
                        console.error('[IPC] Main window not available for final export');
                        return [2 /*return*/];
                    }
                    sender = mainWindow.webContents;
                    requestId = payload.requestId || randomUUID();
                    existingJobs = jobQueue.getJobs();
                    runningFinalExport = existingJobs.find(function (job) { return job.type === 'video:final-export' && (job.status === 'running' || job.status === 'pending'); });
                    if (runningFinalExport) {
                        console.warn("[IPC] Rejecting final export request: job ".concat(runningFinalExport.id, " is already running"));
                        sender.send(VIDEO_FINAL_EXPORT_ERROR, {
                            requestId: requestId,
                            error: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
                            message: 'Đã có một quy trình xuất video đang chạy. Vui lòng đợi hoàn thành hoặc hủy trước khi bắt đầu quy trình mới.',
                        });
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, confirmResourcesForVideoJob('final-export', payload.outputFolder)];
                case 1:
                    proceed = _j.sent();
                    if (!proceed) {
                        sender.send(VIDEO_FINAL_EXPORT_ERROR, {
                            requestId: requestId,
                            error: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
                            message: 'Người dùng đã hủy xuất video sau cảnh báo tài nguyên.',
                        });
                        return [2 /*return*/];
                    }
                    emitter = {
                        progress: function (progressPayload) {
                            sender.send(VIDEO_FINAL_EXPORT_PROGRESS, progressPayload);
                        },
                        done: function (donePayload) { return __awaiter(_this, void 0, void 0, function () {
                            var _i, _a, output;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        finalExportJobHandles.delete(requestId); // Cleanup khi done
                                        sender.send(VIDEO_FINAL_EXPORT_DONE, donePayload);
                                        if (!(donePayload.outputs && donePayload.outputs.length > 0)) return [3 /*break*/, 4];
                                        _i = 0, _a = donePayload.outputs;
                                        _b.label = 1;
                                    case 1:
                                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                                        output = _a[_i];
                                        return [4 /*yield*/, trackVideoExport('success', undefined, output.videoFile, output.durationSec)];
                                    case 2:
                                        _b.sent();
                                        _b.label = 3;
                                    case 3:
                                        _i++;
                                        return [3 /*break*/, 1];
                                    case 4: return [2 /*return*/];
                                }
                            });
                        }); },
                        error: function (errorPayload) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        finalExportJobHandles.delete(requestId); // Cleanup khi error
                                        sender.send(VIDEO_FINAL_EXPORT_ERROR, errorPayload);
                                        // Track failed export
                                        return [4 /*yield*/, trackVideoExport('failed', errorPayload.message || errorPayload.error)];
                                    case 1:
                                        // Track failed export
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); },
                    };
                    jobHandle = jobQueue.enqueue({
                        type: 'video:final-export',
                        payload: {
                            requestId: requestId,
                            audioCount: ((_a = payload.audioSource) === null || _a === void 0 ? void 0 : _a.type) === 'folder' ? 0 : ((_d = (_c = (_b = payload.audioSource) === null || _b === void 0 ? void 0 : _b.paths) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0),
                            videoCount: ((_e = payload.videoSource) === null || _e === void 0 ? void 0 : _e.type) === 'folder' ? 0 : ((_h = (_g = (_f = payload.videoSource) === null || _f === void 0 ? void 0 : _f.paths) === null || _g === void 0 ? void 0 : _g.length) !== null && _h !== void 0 ? _h : 0),
                        },
                        task: function (ctx) { return __awaiter(_this, void 0, void 0, function () {
                            var error_5;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        _a.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, exportFinalVideo(__assign(__assign({}, payload), { requestId: requestId || ctx.jobId }), emitter)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/, { success: true }];
                                    case 2:
                                        error_5 = _a.sent();
                                        console.error('[IPC] Final export error:', error_5);
                                        emitter.error({
                                            requestId: requestId || ctx.jobId,
                                            error: (error_5 === null || error_5 === void 0 ? void 0 : error_5.message) || 'Xuất video thất bại.',
                                            message: error_5 === null || error_5 === void 0 ? void 0 : error_5.message,
                                        });
                                        throw error_5;
                                    case 3: return [2 /*return*/];
                                }
                            });
                        }); },
                    });
                    // Lưu jobHandle để có thể cancel sau
                    finalExportJobHandles.set(requestId, jobHandle);
                    // Start processing (don't await, let it run in background)
                    jobHandle.result.catch(function (err) {
                        console.error('[IPC] Final export job failed:', err);
                        finalExportJobHandles.delete(requestId); // Cleanup khi failed
                    });
                    return [2 /*return*/];
            }
        });
    }); });
    // Cancel final export handler
    ipcMain.handle('video:final-export:cancel', function (_event, requestId) { return __awaiter(_this, void 0, void 0, function () {
        var jobHandle, err_28;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    jobHandle = finalExportJobHandles.get(requestId);
                    if (!jobHandle) return [3 /*break*/, 2];
                    return [4 /*yield*/, jobHandle.cancel()];
                case 1:
                    _a.sent();
                    finalExportJobHandles.delete(requestId);
                    _a.label = 2;
                case 2:
                    // Kill tất cả FFmpeg processes đang chạy (vì final export chạy tuần tự, chỉ có 1 job đang chạy tại một thời điểm)
                    // Nhưng để chắc chắn, cancel tất cả jobs đang chạy
                    videoJobManager.cancelAll();
                    // Cũng thử cancel bằng requestId cụ thể (nếu có)
                    videoJobManager.cancelJob(requestId);
                    return [2 /*return*/, { success: true }];
                case 3:
                    err_28 = _a.sent();
                    console.error('[IPC] Cancel final export error:', err_28);
                    return [2 /*return*/, { success: false, error: String(err_28) }];
                case 4: return [2 /*return*/];
            }
        });
    }); });
    // ============================================
    // TURBO ENGINE HANDLERS (DEPRECATED - Commented out)
    // ============================================
    // Cut single turbo (DEPRECATED)
    // ipcMain.handle('video:cutSingleTurbo', async (event, req: any) => {
    //   // Handler removed - use video:cutSingleSimple instead
    //   throw new Error('video:cutSingleTurbo is deprecated, use video:cutSingleSimple')
    // })
    // Split many turbo (DEPRECATED)
    // ipcMain.handle('video:splitManyTurbo', async (event, req: any) => {
    //   // Handler removed - use video:splitManySimple instead
    //   throw new Error('video:splitManyTurbo is deprecated, use video:splitManySimple')
    // })
    // Merge turbo (DEPRECATED)
    // ipcMain.handle('video:mergeTurbo', async (event, req: any) => {
    //   // Handler removed - use video:mergeSimple instead
    //   throw new Error('video:mergeTurbo is deprecated, use video:mergeSimple')
    // })
    // Cancel job
    ipcMain.handle('video:cancelJob', function (_event, requestId) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            try {
                videoJobManager.cancelJob(requestId);
                return [2 /*return*/, { success: true }];
            }
            catch (err) {
                console.error('[IPC] video:cancelJob error', err);
                return [2 /*return*/, { success: false, error: String(err) }];
            }
            return [2 /*return*/];
        });
    }); });
    // Get all active video job IDs (for restore UI state)
    ipcMain.handle('video:getAllJobIds', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            try {
                return [2 /*return*/, videoJobManager.getAllJobIds()];
            }
            catch (err) {
                console.error('[IPC] video:getAllJobIds error', err);
                return [2 /*return*/, []];
            }
            return [2 /*return*/];
        });
    }); });
    ipcMain.handle('video:getActiveMergeJobId', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            try {
                if (activeMergeRequestId && videoJobManager.hasJob(activeMergeRequestId)) {
                    return [2 /*return*/, activeMergeRequestId];
                }
                return [2 /*return*/, null];
            }
            catch (err) {
                console.error('[IPC] video:getActiveMergeJobId error', err);
                return [2 /*return*/, null];
            }
            return [2 /*return*/];
        });
    }); });
    // Check if video job is running
    ipcMain.handle('video:hasJob', function (_event, requestId) { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            try {
                return [2 /*return*/, videoJobManager.hasJob(requestId)];
            }
            catch (err) {
                console.error('[IPC] video:hasJob error', err);
                return [2 /*return*/, false];
            }
            return [2 /*return*/];
        });
    }); });
    // ===== Autopilot IPC =====
    onAutopilotProgress(function (progress) {
        var windows = BrowserWindow.getAllWindows();
        for (var _i = 0, windows_2 = windows; _i < windows_2.length; _i++) {
            var win = windows_2[_i];
            if (!win.isDestroyed()) {
                win.webContents.send('autopilot:status', progress);
            }
        }
    });
    onAutopilotLog(function (log) {
        var windows = BrowserWindow.getAllWindows();
        for (var _i = 0, windows_3 = windows; _i < windows_3.length; _i++) {
            var win = windows_3[_i];
            if (!win.isDestroyed()) {
                win.webContents.send('autopilot:log', log);
            }
        }
    });
    ipcMain.handle('autopilot:getStatus', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, getAutopilotProgress()];
        });
    }); });
    ipcMain.handle('autopilot:start', function (_event, config) { return __awaiter(_this, void 0, void 0, function () {
        var error_6;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, startAutopilot(config)];
                case 1:
                    _a.sent();
                    return [2 /*return*/, { ok: true }];
                case 2:
                    error_6 = _a.sent();
                    console.error('[Autopilot] Failed to start:', error_6);
                    return [2 /*return*/, { ok: false, error: (error_6 === null || error_6 === void 0 ? void 0 : error_6.message) || String(error_6) }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    ipcMain.handle('autopilot:cancel', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            cancelAutopilot();
            return [2 /*return*/, { ok: true }];
        });
    }); });
    // Security monitoring IPC
    ipcMain.handle('security:reportAntiDebug', function (_event, details) { return __awaiter(_this, void 0, void 0, function () {
        var reportAntiDebugTriggered;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, import('../backend/security/securityMonitoring')];
                case 1:
                    reportAntiDebugTriggered = (_a.sent()).reportAntiDebugTriggered;
                    return [4 /*yield*/, reportAntiDebugTriggered(details)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, { ok: true }];
            }
        });
    }); });
}
// Global error handlers - Bắt tất cả lỗi uncaught
process.on('uncaughtException', function (error) {
    console.error('[App] UNCAUGHT EXCEPTION:', error);
    console.error('[App] Stack:', error.stack);
    // Không quit app, chỉ log để debug
    // App vẫn tiếp tục chạy để user có thể thấy lỗi
});
process.on('unhandledRejection', function (reason, promise) {
    console.error('[App] UNHANDLED REJECTION:', reason);
    console.error('[App] Promise:', promise);
    // Không quit app, chỉ log để debug
});
// Lifecycle chuẩn Electron
app.whenReady()
    .then(function () { return __awaiter(void 0, void 0, void 0, function () {
    var err_29;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.log('[App] Starting initialization...');
                // QUAN TRỌNG: Tạo window TRƯỚC để đảm bảo app luôn hiển thị, ngay cả khi có lỗi
                // Đăng ký IPC handlers trước để window có thể giao tiếp
                try {
                    registerIpcHandlers();
                    console.log('[App] IPC handlers registered');
                }
                catch (err) {
                    console.error('[App] Failed to register IPC handlers (critical):', (err === null || err === void 0 ? void 0 : err.message) || err);
                    // Vẫn tiếp tục tạo window
                }
                try {
                    createWindow();
                    console.log('[App] Window created');
                }
                catch (err) {
                    console.error('[App] Failed to create window (critical):', (err === null || err === void 0 ? void 0 : err.message) || err);
                    // Thử tạo window đơn giản hơn
                    try {
                        mainWindow = new BrowserWindow({
                            width: 1280,
                            height: 720,
                            show: true,
                            webPreferences: {
                                nodeIntegration: false,
                                contextIsolation: true,
                            },
                        });
                        loadErrorPage(mainWindow, "L\u1ED7i kh\u1EDFi \u0111\u1ED9ng \u1EE9ng d\u1EE5ng:\n".concat((err === null || err === void 0 ? void 0 : err.message) || String(err), "\n\nVui l\u00F2ng ch\u1EA1y diagnostic script \u0111\u1EC3 ki\u1EC3m tra."));
                    }
                    catch (fallbackErr) {
                        console.error('[App] Failed to create fallback window:', fallbackErr);
                        // Cuối cùng mới quit
                        app.quit();
                        return [2 /*return*/];
                    }
                }
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, checkAndCleanCacheOnUpdate()];
            case 2:
                _a.sent();
                console.log('[App] Cache cleanup completed');
                return [3 /*break*/, 4];
            case 3:
                err_29 = _a.sent();
                console.error('[App] Cache cleanup failed (non-critical):', (err_29 === null || err_29 === void 0 ? void 0 : err_29.message) || err_29);
                return [3 /*break*/, 4];
            case 4:
                // Initialize security monitoring
                try {
                    initSecurityMonitoring();
                    console.log('[App] Security monitoring initialized');
                }
                catch (err) {
                    console.error('[App] Security monitoring init failed (non-critical):', (err === null || err === void 0 ? void 0 : err.message) || err);
                }
                // Initialize tamper detection (chỉ trong production)
                try {
                    initTamperDetection();
                    console.log('[App] Tamper detection initialized');
                }
                catch (err) {
                    console.error('[App] Tamper detection init failed (non-critical):', (err === null || err === void 0 ? void 0 : err.message) || err);
                }
                // Check environment (VM/Sandbox detection) - chạy async, không block
                ;
                (function () { return __awaiter(void 0, void 0, void 0, function () {
                    var isSafeEnvironment, envCheck, reportSecurityEvent, machineId, reportErr_1, err_30;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 9, , 10]);
                                return [4 /*yield*/, import('../backend/security/environmentDetection')];
                            case 1:
                                isSafeEnvironment = (_a.sent()).isSafeEnvironment;
                                return [4 /*yield*/, isSafeEnvironment()];
                            case 2:
                                envCheck = _a.sent();
                                if (!!envCheck.safe) return [3 /*break*/, 8];
                                console.warn('[Security] Unsafe environment detected:', envCheck.reason);
                                _a.label = 3;
                            case 3:
                                _a.trys.push([3, 7, , 8]);
                                return [4 /*yield*/, import('../backend/security/securityMonitoring')];
                            case 4:
                                reportSecurityEvent = (_a.sent()).reportSecurityEvent;
                                return [4 /*yield*/, getMachineHash()];
                            case 5:
                                machineId = _a.sent();
                                return [4 /*yield*/, reportSecurityEvent({
                                        type: 'UNSAFE_ENVIRONMENT',
                                        severity: 'high',
                                        message: "Unsafe environment detected: ".concat(envCheck.reason),
                                        details: {
                                            detected: envCheck.detected,
                                        },
                                        timestamp: Date.now(),
                                        machineId: machineId,
                                    }).catch(function () { })];
                            case 6:
                                _a.sent();
                                return [3 /*break*/, 8];
                            case 7:
                                reportErr_1 = _a.sent();
                                console.warn('[Security] Failed to report unsafe environment:', reportErr_1);
                                return [3 /*break*/, 8];
                            case 8: return [3 /*break*/, 10];
                            case 9:
                                err_30 = _a.sent();
                                console.error('[App] Environment check failed (non-critical):', (err_30 === null || err_30 === void 0 ? void 0 : err_30.message) || err_30);
                                return [3 /*break*/, 10];
                            case 10: return [2 /*return*/];
                        }
                    });
                }); })();
                (function () { return __awaiter(void 0, void 0, void 0, function () {
                    var tamperCheck, err_31;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 2, , 3]);
                                return [4 /*yield*/, checkTampering()];
                            case 1:
                                tamperCheck = _a.sent();
                                if (tamperCheck.isTampered) {
                                    console.error('[Security] Tampering detected on startup:', tamperCheck.reasons);
                                }
                                return [3 /*break*/, 3];
                            case 2:
                                err_31 = _a.sent();
                                console.error('[App] Tamper check failed (non-critical):', (err_31 === null || err_31 === void 0 ? void 0 : err_31.message) || err_31);
                                return [3 /*break*/, 3];
                            case 3: return [2 /*return*/];
                        }
                    });
                }); })();
                (function () { return __awaiter(void 0, void 0, void 0, function () {
                    var err_32;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 2, , 3]);
                                return [4 /*yield*/, refreshLicenseState(true)];
                            case 1:
                                _a.sent();
                                console.log('[App] License state refreshed');
                                return [3 /*break*/, 3];
                            case 2:
                                err_32 = _a.sent();
                                console.error('[App] License refresh failed (non-critical):', (err_32 === null || err_32 === void 0 ? void 0 : err_32.message) || err_32);
                                return [3 /*break*/, 3];
                            case 3: return [2 /*return*/];
                        }
                    });
                }); })();
                // FFmpeg info - chạy async, không block
                logFfmpegInfo().catch(function (err) {
                    console.warn('[FFmpeg] Failed to log FFmpeg info (non-critical):', err);
                });
                // Disk info - chạy async, không block
                refreshDiskInfoAndBroadcast().catch(function (err) {
                    return console.error('[system] Initial disk info scan failed (non-critical):', err);
                });
                // Refresh disk info định kỳ mỗi 30 giây
                diskInfoRefreshInterval = setInterval(function () {
                    refreshDiskInfoAndBroadcast().catch(function (err) {
                        return console.error('[system] Periodic disk info refresh failed:', err);
                    });
                }, 30000); // 30 giây
                // Periodic license check (mỗi 30 phút)
                setInterval(function () { return __awaiter(void 0, void 0, void 0, function () {
                    var currentState, error_7;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 3, , 4]);
                                return [4 /*yield*/, refreshLicenseState(true)]; // Force remote check
                            case 1:
                                _a.sent(); // Force remote check
                                return [4 /*yield*/, refreshLicenseState(false)];
                            case 2:
                                currentState = _a.sent();
                                if (currentState.status !== 'ok') {
                                    console.warn('[Security] License check failed during periodic check:', currentState.status);
                                }
                                return [3 /*break*/, 4];
                            case 3:
                                error_7 = _a.sent();
                                console.warn('[Security] Periodic license check failed:', error_7);
                                return [3 /*break*/, 4];
                            case 4: return [2 /*return*/];
                        }
                    });
                }); }, 30 * 60 * 1000); // 30 phút
                app.on('activate', function () {
                    if (BrowserWindow.getAllWindows().length === 0) {
                        createWindow();
                    }
                });
                console.log('[App] Initialization completed (window should be visible)');
                return [2 /*return*/];
        }
    });
}); })
    .catch(function (err) {
    console.error('[App] CRITICAL: Failed to initialize:', err);
    console.error('[App] Error stack:', err === null || err === void 0 ? void 0 : err.stack);
    // Thử tạo window ngay cả khi có lỗi để user thấy được thông báo
    try {
        if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            loadErrorPage(mainWindow, "L\u1ED7i kh\u1EDFi \u0111\u1ED9ng \u1EE9ng d\u1EE5ng:\n".concat((err === null || err === void 0 ? void 0 : err.message) || String(err), "\n\nVui l\u00F2ng ch\u1EA1y diagnostic script \u0111\u1EC3 ki\u1EC3m tra."));
        }
    }
    catch (windowErr) {
        console.error('[App] Failed to create error window:', windowErr);
        // Chỉ quit nếu không thể tạo window
        app.quit();
    }
});
app.on('window-all-closed', function () {
    cleanupYouTubeHandlers();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
