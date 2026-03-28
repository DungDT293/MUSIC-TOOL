import fs from 'node:fs';
import path from 'node:path';
var AUTH_FILE_NAME = 'authState.json';
function resolveStoragePath() {
    if (process.env.AUTH_STATE_PATH) {
        return process.env.AUTH_STATE_PATH;
    }
    var commonAppData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData');
    var dir = path.join(commonAppData, '93MediaToolMixNhac');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, AUTH_FILE_NAME);
}
export function readStoredAuthState() {
    try {
        var file = resolveStoragePath();
        if (!fs.existsSync(file))
            return null;
        var raw = fs.readFileSync(file, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        console.warn('[auth] Failed to read stored auth state:', error);
        return null;
    }
}
export function writeStoredAuthState(state) {
    try {
        var file = resolveStoragePath();
        fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
    }
    catch (error) {
        console.error('[auth] Failed to persist auth state:', error);
    }
}
export function clearStoredAuthState() {
    try {
        var file = resolveStoragePath();
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    }
    catch (error) {
        console.error('[auth] Failed to clear auth state:', error);
    }
}
