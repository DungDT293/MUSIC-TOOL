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
import { randomUUID } from 'node:crypto';
// Lưu ở userData nếu có Electron app, fallback về ./backups
function getHistoryPath() {
    var _a;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        var app = require('electron').app;
        var base = (_a = app === null || app === void 0 ? void 0 : app.getPath) === null || _a === void 0 ? void 0 : _a.call(app, 'userData');
        if (base) {
            var dir_1 = path.join(base, 'music-history');
            return { dir: dir_1, file: path.join(dir_1, 'music_export_history.json') };
        }
    }
    catch (_b) { }
    var dir = path.join(process.cwd(), 'backups');
    return { dir: dir, file: path.join(dir, 'music_export_history.json') };
}
var _a = getHistoryPath(), HISTORY_DIR = _a.dir, HISTORY_FILE = _a.file;
// Lưu tất cả lịch sử, không giới hạn 3 ngày
// Chỉ prune khi file quá lớn (> 10MB) để tránh file quá nặng
var MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
var MAX_ENTRIES_WHEN_LARGE = 1000; // Nếu file > 10MB, chỉ giữ 1000 entry gần nhất
function ensureHistoryDir() {
    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
}
export function loadHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE))
            return [];
        var raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (err) {
        console.warn('[exportHistory] Failed to load history:', err);
        return [];
    }
}
function pruneOld(entries) {
    // Không prune theo thời gian nữa - lưu tất cả lịch sử
    // Chỉ prune khi có quá nhiều entries (giữ 1000 entry gần nhất)
    if (entries.length > MAX_ENTRIES_WHEN_LARGE) {
        // Sort theo thời gian (mới nhất trước) và chỉ giữ 1000 entry gần nhất
        return entries.sort(function (a, b) { return b.exportedAt - a.exportedAt; }).slice(0, MAX_ENTRIES_WHEN_LARGE);
    }
    return entries;
}
function shouldPruneByFileSize() {
    try {
        if (!fs.existsSync(HISTORY_FILE))
            return false;
        var stats = fs.statSync(HISTORY_FILE);
        return stats.size > MAX_FILE_SIZE_BYTES;
    }
    catch (_a) {
        return false;
    }
}
export function addHistoryEntry(entry) {
    ensureHistoryDir();
    var current = loadHistory();
    var newEntry = __assign(__assign({}, entry), { id: randomUUID(), exportedAt: Date.now() });
    // Thêm entry mới vào đầu danh sách (mới nhất trước)
    var merged = __spreadArray([newEntry], current, true);
    // Chỉ prune nếu có quá nhiều entries (giữ 1000 entry gần nhất)
    // Không prune theo thời gian - lưu tất cả các đợt
    var final = merged.length > MAX_ENTRIES_WHEN_LARGE ? pruneOld(merged) : merged;
    // Sort theo thời gian (mới nhất trước)
    var sorted = final.sort(function (a, b) { return b.exportedAt - a.exportedAt; });
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(sorted, null, 2), 'utf-8');
    }
    catch (err) {
        console.warn('[exportHistory] Failed to write history:', err);
    }
}
export function getRecentHistory() {
    // Trả về tất cả lịch sử, không giới hạn 3 ngày
    // Chỉ prune nếu có quá nhiều entries (> 1000)
    var all = loadHistory();
    if (all.length > MAX_ENTRIES_WHEN_LARGE) {
        return pruneOld(all);
    }
    return all.sort(function (a, b) { return b.exportedAt - a.exportedAt; });
}
