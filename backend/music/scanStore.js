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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
var STORE_DIR = path.join(os.homedir(), '.93-media-tool-mix-nhac');
var STORE_FILE = path.join(STORE_DIR, 'music-scan-result.json');
var cache = null;
function ensureStoreDir() {
    if (!fs.existsSync(STORE_DIR)) {
        fs.mkdirSync(STORE_DIR, { recursive: true });
    }
}
export function saveScanResult(result) {
    var _a;
    try {
        var payload = __assign(__assign({}, result), { scannedAt: (_a = result.scannedAt) !== null && _a !== void 0 ? _a : Date.now() });
        cache = payload;
        ensureStoreDir();
        fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
        console.log('[scanStore] Saved scan result:', STORE_FILE);
    }
    catch (err) {
        console.warn('[scanStore] Failed to save scan result:', err);
    }
}
export function loadScanResult() {
    if (cache) {
        return cache;
    }
    try {
        if (!fs.existsSync(STORE_FILE)) {
            return null;
        }
        var raw = fs.readFileSync(STORE_FILE, 'utf-8');
        cache = JSON.parse(raw);
        return cache;
    }
    catch (err) {
        console.warn('[scanStore] Failed to load scan result:', err);
        return null;
    }
}
export function clearScanResult() {
    cache = null;
    try {
        if (fs.existsSync(STORE_FILE)) {
            fs.unlinkSync(STORE_FILE);
        }
    }
    catch (err) {
        console.warn('[scanStore] Failed to clear scan result:', err);
    }
}
