import fs from 'fs'
import path from 'path'
import { app } from 'electron'

/**
 * Lấy thư mục userData của Electron
 */
function getUserDataPath(): string {
  return app.getPath('userData')
}

/**
 * Lấy version hiện tại từ package.json
 */
function getCurrentVersion(): string {
  try {
    const packagePath = path.join(__dirname, '../../package.json')
    const packageContent = fs.readFileSync(packagePath, 'utf8')
    const packageJson = JSON.parse(packageContent)
    return packageJson.version || '0.0.0'
  } catch (error) {
    console.warn('[cacheCleanup] Failed to read package.json:', error)
    return '0.0.0'
  }
}

/**
 * Lấy version đã lưu trong cache
 */
function getStoredVersion(): string | null {
  try {
    const versionFile = path.join(getUserDataPath(), 'app-version.txt')
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, 'utf8').trim()
    }
  } catch (error) {
    console.warn('[cacheCleanup] Failed to read stored version:', error)
  }
  return null
}

/**
 * Lưu version hiện tại vào cache
 */
function saveCurrentVersion(version: string): void {
  try {
    const versionFile = path.join(getUserDataPath(), 'app-version.txt')
    fs.writeFileSync(versionFile, version, 'utf8')
  } catch (error) {
    console.warn('[cacheCleanup] Failed to save version:', error)
  }
}

/**
 * So sánh version (đơn giản: x.y.z)
 */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va < vb) return -1
    if (va > vb) return 1
  }
  return 0
}

/**
 * Xóa cache cũ khi nâng cấp version.
 * Giữ nguyên auth/license state để update app không làm mất đăng nhập.
 */
async function clearOldCache(): Promise<void> {
  try {
    const userDataPath = getUserDataPath()
    const cacheDirs = [
      path.join(userDataPath, 'Cache'),
      path.join(userDataPath, 'Code Cache'),
      path.join(userDataPath, 'GPUCache'),
      path.join(userDataPath, 'ShaderCache'),
      path.join(userDataPath, 'logs'), // Xóa logs cũ
    ]

    for (const dir of cacheDirs) {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true })
          console.log(`[cacheCleanup] Deleted cache directory: ${dir}`)
        } catch (err: any) {
          console.warn(`[cacheCleanup] Failed to delete ${dir}:`, err.message)
        }
      }
    }

    // Xóa các file cache khác
    const cacheFiles = [
      path.join(userDataPath, 'Cookies'),
      path.join(userDataPath, 'Cookies-journal'),
      path.join(userDataPath, 'Local Storage'),
      path.join(userDataPath, 'Session Storage'),
      path.join(userDataPath, 'IndexedDB'),
    ]

    for (const file of cacheFiles) {
      if (fs.existsSync(file)) {
        try {
          if (fs.statSync(file).isDirectory()) {
            fs.rmSync(file, { recursive: true, force: true })
          } else {
            fs.unlinkSync(file)
          }
          console.log(`[cacheCleanup] Deleted cache file: ${file}`)
        } catch (err: any) {
          console.warn(`[cacheCleanup] Failed to delete ${file}:`, err.message)
        }
      }
    }

    console.log('[cacheCleanup] Preserved auth state during version upgrade')
  } catch (error: any) {
    console.error('[cacheCleanup] Failed to clear cache:', error.message)
  }
}

/**
 * Kiểm tra và xóa cache nếu version mới hơn
 * Chỉ xóa cache khi version thay đổi, không xóa khi downgrade
 */
export async function checkAndCleanCacheOnUpdate(): Promise<void> {
  try {
    const currentVersion = getCurrentVersion()
    const storedVersion = getStoredVersion()

    console.log(`[cacheCleanup] Current version: ${currentVersion}, Stored version: ${storedVersion || 'none'}`)

    // Nếu chưa có version lưu hoặc version mới hơn -> xóa cache
    if (!storedVersion || compareVersion(currentVersion, storedVersion) > 0) {
      console.log('[cacheCleanup] New version detected, clearing old cache...')
      await clearOldCache()
      saveCurrentVersion(currentVersion)
      console.log('[cacheCleanup] Cache cleanup completed')
    } else {
      console.log('[cacheCleanup] Same or older version, skipping cache cleanup')
    }
  } catch (error: any) {
    console.error('[cacheCleanup] Error during cache cleanup check:', error.message)
  }
}























































































