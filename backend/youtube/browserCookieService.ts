import { spawn } from 'child_process'
import path from 'node:path'
import fs from 'fs'
import os from 'os'

/**
 * Result shape returned by browser_cookie_extractor.py
 */
export interface BrowserCookieResult {
  success: boolean
  cookie_file?: string
  cookie_count?: number
  browser?: string
  domain?: string
  error?: string
}

/**
 * Resolve path to the Python script inside the built app.
 * In dev, __dirname will point to backend/youtube; in prod, to dist-electron/main/backend/youtube.
 * We climb up and into backend/python.
 */
function getPythonScriptPath(): string {
  // Try multiple locations so it works in both DEV and packaged builds
  const candidates = [
    // DEV: run from project root
    path.join(process.cwd(), 'backend', 'python', 'browser_cookie_extractor.py'),
    // Built main chunk location (dist-electron/main/backend/youtube)
    path.join(path.resolve(__dirname, '..'), 'python', 'browser_cookie_extractor.py'),
  ]

  // If Electron resourcesPath exists, also try there (packaged as extraResources)
  const resourcesPath = (process as any).resourcesPath
  if (resourcesPath && typeof resourcesPath === 'string') {
    candidates.push(path.join(resourcesPath, 'python', 'browser_cookie_extractor.py'))
  }

  const found = candidates.find((p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })

  if (found) return found

  // Last resort: return the first candidate (will fail with clear path)
  return candidates[0]
}

export type SupportedBrowser = 'chrome' | 'firefox' | 'edge' | 'opera' | 'brave' | 'safari' | 'chromium' | 'vivaldi'

interface ExtractCookieOptions {
  browser: SupportedBrowser
  domain?: string // Ví dụ: 'youtube.com'
  outputFile?: string // Nếu không có, sẽ tạo temp file
}

/**
 * Extract cookies from browser và export ra Netscape format file.
 * 
 * Sử dụng Python script với browser_cookie3 hoặc rookiepy để lấy cookie
 * từ trình duyệt local, sau đó export ra file Netscape format để yt-dlp sử dụng.
 * 
 * Ưu điểm so với --cookies-from-browser của yt-dlp:
 * - Xử lý tốt hơn khi browser đang mở (tránh "Database is locked")
 * - Hỗ trợ nhiều trình duyệt hơn
 * - Có thể filter theo domain
 * - Tốc độ nhanh hơn với rookiepy
 * 
 * Requirements:
 * - Python in PATH (or PYTHON_EXEC env)
 * - pip install browser-cookie3 hoặc pip install rookiepy
 */
export async function extractBrowserCookies(
  options: ExtractCookieOptions
): Promise<BrowserCookieResult> {
  const {
    browser,
    domain = 'youtube.com',
    outputFile,
  } = options

  const pythonExec = process.env.PYTHON_EXEC || 'python'
  const scriptPath = getPythonScriptPath()

  // Tạo temp file nếu không có outputFile
  const tempFile = outputFile || path.join(
    os.tmpdir(),
    `youtube_cookies_${browser}_${Date.now()}.txt`
  )

  return new Promise((resolve, reject) => {
    const args = [
      scriptPath,
      '--browser',
      browser,
      '--domain',
      domain,
      '--output',
      tempFile,
    ]

    const child = spawn(pythonExec, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (err) => {
      reject(
        new Error(
          `[BrowserCookieExtractor] Failed to start Python process: ${err.message}. stderr: ${stderr.substring(
            0,
            500
          )}`
        )
      )
    })

    child.on('close', (code) => {
      if (code !== 0) {
        // Thử parse error từ stdout (Python script trả về JSON error)
        try {
          const errorResult = JSON.parse(stdout) as BrowserCookieResult
          reject(new Error(errorResult.error || `Python exited with code ${code}`))
        } catch {
          reject(
            new Error(
              `[BrowserCookieExtractor] Python exited with code ${code}. stderr: ${stderr.substring(0, 1000)}`
            )
          )
        }
        return
      }

      try {
        const parsed = JSON.parse(stdout) as BrowserCookieResult
        if (!parsed.success) {
          reject(new Error(parsed.error || 'Failed to extract cookies'))
          return
        }
        
        // Verify file exists
        if (parsed.cookie_file && !fs.existsSync(parsed.cookie_file)) {
          reject(new Error(`Cookie file not found: ${parsed.cookie_file}`))
          return
        }
        
        resolve(parsed)
      } catch (e) {
        reject(
          new Error(
            `[BrowserCookieExtractor] Failed to parse JSON from Python. Error: ${
              (e as Error).message
            }, stdout snippet: ${stdout.substring(0, 500)}, stderr snippet: ${stderr.substring(
              0,
              500
            )}`
          )
        )
      }
    })
  })
}

/**
 * Extract cookies từ nhiều trình duyệt theo thứ tự ưu tiên.
 * Trả về cookie file đầu tiên thành công.
 */
export async function extractCookiesFromBrowsers(
  browsers: SupportedBrowser[] = ['chrome', 'firefox', 'edge'],
  domain: string = 'youtube.com',
  outputFile?: string
): Promise<BrowserCookieResult> {
  let lastError: Error | null = null

  for (const browser of browsers) {
    try {
      const result = await extractBrowserCookies({
        browser,
        domain,
        outputFile,
      })
      
      if (result.success && result.cookie_file) {
        console.log(`[BrowserCookieExtractor] Successfully extracted ${result.cookie_count} cookies from ${browser}`)
        return result
      }
    } catch (error: any) {
      const errorMsg = error?.message || ''
      console.warn(`[BrowserCookieExtractor] Failed to extract cookies from ${browser}: ${errorMsg}`)
      lastError = error
      continue
    }
  }

  throw lastError || new Error('Failed to extract cookies from all browsers')
}



