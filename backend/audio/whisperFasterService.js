import { spawn } from 'child_process';
import path from 'node:path';
/**
 * Resolve path to the Python script inside the built app.
 * In dev, __dirname will point to backend/audio; in prod, to dist-electron/main/backend/audio.
 * We climb up and into backend/python.
 */
function getPythonScriptPath() {
    // Try multiple locations so it works in both DEV and packaged builds
    var candidates = [
        // DEV: run from project root
        path.join(process.cwd(), 'backend', 'python', 'faster_whisper_service.py'),
        // Built main chunk location (dist-electron/main/backend/audio)
        path.join(path.resolve(__dirname, '..'), 'python', 'faster_whisper_service.py'),
    ];
    // If Electron resourcesPath exists, also try there (packaged as extraResources)
    var resourcesPath = process.resourcesPath;
    if (resourcesPath && typeof resourcesPath === 'string') {
        candidates.push(path.join(resourcesPath, 'python', 'faster_whisper_service.py'));
    }
    var found = candidates.find(function (p) {
        try {
            return require('fs').existsSync(p);
        }
        catch (_a) {
            return false;
        }
    });
    if (found)
        return found;
    // Last resort: return the first candidate (ffmpeg will fail with clear path)
    return candidates[0];
}
/**
 * Call external Python Faster-Whisper service on GPU.
 * This requires:
 *  - Python in PATH (or PYTHON_EXEC env)
 *  - pip install faster-whisper
 *  - CUDA/cuDNN properly installed
 */
export function transcribeWithFasterWhisper(options) {
    var audioPath = options.audioPath, _a = options.language, language = _a === void 0 ? 'auto' : _a, _b = options.model, model = _b === void 0 ? process.env.WHISPER_GPU_MODEL || 'small' : _b, _c = options.beamSize, beamSize = _c === void 0 ? 5 : _c;
    var pythonExec = process.env.PYTHON_EXEC || 'python';
    var scriptPath = getPythonScriptPath();
    return new Promise(function (resolve, reject) {
        var args = [
            scriptPath,
            '--audio',
            audioPath,
            '--model',
            model,
            '--language',
            language,
            '--beam_size',
            String(beamSize),
        ];
        var child = spawn(pythonExec, args, {
            windowsHide: true,
        });
        var stdout = '';
        var stderr = '';
        child.stdout.on('data', function (chunk) {
            stdout += chunk.toString('utf-8');
        });
        child.stderr.on('data', function (chunk) {
            stderr += chunk.toString('utf-8');
        });
        child.on('error', function (err) {
            reject(new Error("[GPU-Whisper] Failed to start Python process: ".concat(err.message, ". stderr: ").concat(stderr.substring(0, 500))));
        });
        child.on('close', function (code) {
            if (code !== 0) {
                reject(new Error("[GPU-Whisper] Python exited with code ".concat(code, ". stderr: ").concat(stderr.substring(0, 1000))));
                return;
            }
            try {
                var parsed = JSON.parse(stdout);
                resolve(parsed);
            }
            catch (e) {
                reject(new Error("[GPU-Whisper] Failed to parse JSON from Python. Error: ".concat(e.message, ", stdout snippet: ").concat(stdout.substring(0, 500), ", stderr snippet: ").concat(stderr.substring(0, 500))));
            }
        });
    });
}
