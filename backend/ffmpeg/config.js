/**
 * FFmpeg Config - Lấy đường dẫn đến ffmpeg và ffprobe
 */
import path from 'node:path';
import fs from 'node:fs';
/**
 * Lấy đường dẫn đến ffmpeg và ffprobe
 * - Ưu tiên: environment variables FFMPEG_PATH và FFPROBE_PATH
 * - DEV mode: tìm trong <project root>/bin/
 * - PROD mode: tìm trong <resourcesPath>/bin/
 */
export function getFfmpegPaths() {
    var isWindows = process.platform === 'win32';
    var exeExt = isWindows ? '.exe' : '';
    // Ưu tiên: environment variables
    if (process.env.FFMPEG_PATH && process.env.FFPROBE_PATH) {
        return {
            ffmpeg: process.env.FFMPEG_PATH,
            ffprobe: process.env.FFPROBE_PATH,
        };
    }
    // Tìm trong thư mục bin
    var ffmpegPath;
    var ffprobePath;
    // Kiểm tra xem app có được packaged không
    // Sử dụng app.isPackaged nếu có (từ Electron), fallback về check resourcesPath
    var isPackaged = false;
    try {
        // Thử import app từ electron (chỉ có trong main process)
        var app = require('electron').app;
        isPackaged = app.isPackaged;
    }
    catch (_a) {
        // Nếu không import được (không phải main process hoặc chưa load electron), dùng fallback
        // Trong DEV, process.resourcesPath có thể undefined hoặc trỏ vào node_modules/electron/dist/resources
        // Nên cần check thêm: nếu resourcesPath chứa 'node_modules/electron', đó là DEV mode
        var resourcesPath = process.resourcesPath;
        if (resourcesPath && typeof resourcesPath === 'string') {
            // Nếu resourcesPath chứa 'node_modules/electron', đó là DEV mode (Electron dev binaries)
            // Nếu resourcesPath chứa 'app.asar' hoặc không chứa 'node_modules', đó là PROD mode
            var isNodeModulesPath = resourcesPath.includes('node_modules') && resourcesPath.includes('electron');
            var isAsarPath = resourcesPath.includes('app.asar');
            if (isNodeModulesPath && !isAsarPath) {
                isPackaged = false; // DEV mode: trỏ vào node_modules/electron/dist/resources
            }
            else if (isAsarPath || (!isNodeModulesPath && resourcesPath.length > 0)) {
                isPackaged = true; // PROD mode: trỏ vào app.asar/resources hoặc resources thực sự
            }
            else {
                isPackaged = false; // Mặc định: DEV mode
            }
        }
        else {
            isPackaged = false; // Không có resourcesPath = DEV mode
        }
    }
    if (isPackaged) {
        // Production mode: tìm trong resources/bin (extraResources)
        var resourcesPath = process.resourcesPath;
        if (!resourcesPath) {
            throw new Error('[FFmpeg Config] Production mode but resourcesPath is undefined');
        }
        var packagedBinDir = path.join(resourcesPath, 'bin');
        ffmpegPath = path.join(packagedBinDir, "ffmpeg".concat(exeExt));
        ffprobePath = path.join(packagedBinDir, "ffprobe".concat(exeExt));
    }
    else {
        // Dev mode: tìm trong bin folder ở root project
        // Dùng process.cwd() để lấy root project (nơi chạy npm run dev)
        var projectRoot = process.cwd();
        var binDir = path.join(projectRoot, 'bin');
        ffmpegPath = path.join(binDir, "ffmpeg".concat(exeExt));
        ffprobePath = path.join(binDir, "ffprobe".concat(exeExt));
    }
    // Log để debug (chỉ trong DEV mode hoặc khi có NODE_ENV=development)
    var isDev = !isPackaged || process.env.NODE_ENV === 'development';
    if (isDev) {
        console.log('[FFMPEG CONFIG] isPackaged =', isPackaged);
        console.log('[FFMPEG CONFIG] ffmpegPath =', ffmpegPath);
        console.log('[FFMPEG CONFIG] ffprobePath =', ffprobePath);
        console.log('[FFMPEG CONFIG] ffmpeg exists:', fs.existsSync(ffmpegPath));
        console.log('[FFMPEG CONFIG] ffprobe exists:', fs.existsSync(ffprobePath));
    }
    // Warning nếu không tìm thấy (nhưng vẫn trả về path để FFmpeg tự báo lỗi)
    if (!fs.existsSync(ffmpegPath)) {
        console.warn("[FFmpeg] Warning: ffmpeg not found at: ".concat(ffmpegPath));
    }
    if (!fs.existsSync(ffprobePath)) {
        console.warn("[FFmpeg] Warning: ffprobe not found at: ".concat(ffprobePath));
    }
    return {
        ffmpeg: ffmpegPath,
        ffprobe: ffprobePath,
    };
}
