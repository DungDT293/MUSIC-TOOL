/**
 * CookieManager - Quản lý cookies đa nền tảng cho video downloader
 * Hỗ trợ: Facebook, TikTok, Instagram, và các nền tảng khác
 * Cookies được import từ J2Team Cookies extension hoặc các extension tương tự
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { app } from 'electron';

export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: string;
}

export interface CookieFile {
  id: string;           // unique ID
  platform: string;     // 'facebook' | 'tiktok' | 'instagram' | 'youtube' | 'other'
  filePath: string;     // đường dẫn file JSON gốc
  domain: string;       // domain chính (ví dụ: .facebook.com)
  cookieCount: number;  // số lượng cookies
  importedAt: number;   // timestamp import
  lastTestedAt?: number;
  testResult?: 'ok' | 'expired' | 'error';
  label?: string;       // tên hiển thị do user đặt
}

export interface CookieTestResult {
  success: boolean;
  platform: string;
  message: string;
  username?: string;   // tên user nếu detect được
  cookieCount: number;
}

// Platform detection rules
const PLATFORM_RULES: Array<{
  platform: string;
  domains: string[];
  testUrl: string;
  loginIndicators: string[];    // nếu thấy = expired/not logged in
  successIndicators: string[];  // nếu thấy = logged in OK
}> = [
  {
    platform: 'facebook',
    domains: ['.facebook.com', 'facebook.com'],
    testUrl: 'https://www.facebook.com/me',
    loginIndicators: ['login_form', '/login/', 'log in to facebook', 'đăng nhập'],
    successIndicators: ['c_user', 'profilePage', 'entity_sidebar', '/me/'],
  },
  {
    platform: 'tiktok',
    domains: ['.tiktok.com', 'tiktok.com'],
    testUrl: 'https://www.tiktok.com/foryou',
    loginIndicators: ['login-modal', '/login/'],
    successIndicators: ['webapp.video-detail', 'sigi'],
  },
  {
    platform: 'instagram',
    domains: ['.instagram.com', 'instagram.com'],
    testUrl: 'https://www.instagram.com/accounts/edit/',
    loginIndicators: ['loginForm', '/accounts/login/'],
    successIndicators: ['profilePage', 'config', 'viewer'],
  },
  {
    platform: 'youtube',
    domains: ['.youtube.com', 'youtube.com', '.google.com', 'google.com'],
    testUrl: 'https://www.youtube.com/feed/subscriptions',
    loginIndicators: ['signin', '/ServiceLogin'],
    successIndicators: ['subscriptions', 'feed'],
  },
];

export class CookieManager {
  private cookieFiles: CookieFile[] = [];
  private cookiesMap: Map<string, CookieEntry[]> = new Map(); // platform -> cookies
  private storagePath: string;

  constructor() {
    // Store cookie config in userData
    try {
      this.storagePath = path.join(app.getPath('userData'), 'cookie-manager.json');
    } catch {
      this.storagePath = path.join(process.cwd(), 'cookie-manager.json');
    }
    this.loadState();
  }

  /**
   * Load saved state from disk
   */
  private loadState(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
        this.cookieFiles = data.cookieFiles || [];

        // Reload cookies from files
        for (const cf of this.cookieFiles) {
          try {
            if (fs.existsSync(cf.filePath)) {
              const cookies = this.parseCookieFile(cf.filePath);
              const platformCookies = cookies.filter(c =>
                PLATFORM_RULES.find(r => r.platform === cf.platform)?.domains.some(d =>
                  c.domain?.includes(d.replace('.', ''))
                )
              );
              this.cookiesMap.set(cf.platform, platformCookies);
            }
          } catch (e) {
            console.warn(`[CookieManager] Failed to reload cookies for ${cf.platform}: ${e}`);
          }
        }

        console.log(`[CookieManager] Loaded ${this.cookieFiles.length} cookie files from state`);
      }
    } catch (e) {
      console.warn(`[CookieManager] Failed to load state: ${e}`);
    }
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify({ cookieFiles: this.cookieFiles }, null, 2), 'utf-8');
    } catch (e) {
      console.warn(`[CookieManager] Failed to save state: ${e}`);
    }
  }

  /**
   * Parse a cookie JSON file (J2Team Cookies format or standard format)
   */
  private parseCookieFile(filePath: string): CookieEntry[] {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // J2Team Cookies format: [{ name, value, domain, ... }]
    // Or: { url: "...", cookies: [...] }
    // Or: { cookies: [...] }
    let cookiesArray: any[];

    if (Array.isArray(data)) {
      cookiesArray = data;
    } else if (data.cookies && Array.isArray(data.cookies)) {
      cookiesArray = data.cookies;
    } else {
      throw new Error('Không nhận dạng được format cookies. Hãy dùng J2Team Cookies extension để export.');
    }

    return cookiesArray
      .filter((c: any) => c.name && c.value && c.domain)
      .map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure ?? true,
        httpOnly: c.httpOnly ?? false,
        expirationDate: c.expirationDate,
        sameSite: c.sameSite,
      }));
  }

  /**
   * Detect platform from cookie domains
   */
  private detectPlatform(cookies: CookieEntry[]): string {
    const domains = cookies.map(c => c.domain.toLowerCase());

    for (const rule of PLATFORM_RULES) {
      const match = rule.domains.some(d =>
        domains.some(cd => cd.includes(d.replace(/^\./, '')))
      );
      if (match) return rule.platform;
    }

    return 'other';
  }

  /**
   * Import cookies from a JSON file
   */
  async importCookieFile(filePath: string, label?: string): Promise<CookieFile> {
    console.log(`[CookieManager] Importing cookies from: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File không tồn tại: ${filePath}`);
    }

    const cookies = this.parseCookieFile(filePath);

    if (cookies.length === 0) {
      throw new Error('File cookies trống hoặc không có cookies hợp lệ.');
    }

    const platform = this.detectPlatform(cookies);
    const rule = PLATFORM_RULES.find(r => r.platform === platform);
    const domain = rule?.domains[0] || cookies[0].domain;

    // Filter cookies for this platform
    const platformCookies = platform !== 'other'
      ? cookies.filter(c => rule?.domains.some(d => c.domain?.includes(d.replace('.', ''))))
      : cookies;

    // Remove existing cookie file for same platform (replace)
    const existingIndex = this.cookieFiles.findIndex(cf => cf.platform === platform);
    if (existingIndex >= 0) {
      this.cookieFiles.splice(existingIndex, 1);
    }

    const cookieFile: CookieFile = {
      id: `${platform}-${Date.now()}`,
      platform,
      filePath,
      domain,
      cookieCount: platformCookies.length,
      importedAt: Date.now(),
      label: label || `${platform.charAt(0).toUpperCase() + platform.slice(1)} Cookies`,
    };

    this.cookieFiles.push(cookieFile);
    this.cookiesMap.set(platform, platformCookies);
    this.saveState();

    console.log(`[CookieManager] Imported ${platformCookies.length} cookies for ${platform}`);
    return cookieFile;
  }

  /**
   * Remove a cookie file
   */
  removeCookieFile(id: string): boolean {
    const index = this.cookieFiles.findIndex(cf => cf.id === id);
    if (index < 0) return false;

    const cf = this.cookieFiles[index];
    this.cookieFiles.splice(index, 1);
    this.cookiesMap.delete(cf.platform);
    this.saveState();
    return true;
  }

  /**
   * Get all cookie files
   */
  getCookieFiles(): CookieFile[] {
    return [...this.cookieFiles];
  }

  /**
   * Get cookie string for a platform (name=value; name=value; ...)
   */
  getCookieString(platform: string): string {
    const cookies = this.cookiesMap.get(platform);
    if (!cookies || cookies.length === 0) return '';
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Get cookies for a platform
   */
  getCookies(platform: string): CookieEntry[] {
    return this.cookiesMap.get(platform) || [];
  }

  /**
   * Check if cookies exist for a platform
   */
  hasCookies(platform: string): boolean {
    const cookies = this.cookiesMap.get(platform);
    return !!cookies && cookies.length > 0;
  }

  /**
   * Detect platform from URL
   */
  static detectPlatformFromUrl(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
    if (lower.includes('tiktok.com')) return 'tiktok';
    if (lower.includes('instagram.com')) return 'instagram';
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
    return 'other';
  }

  /**
   * Test if cookies are still valid for a platform
   */
  async testCookies(platform: string): Promise<CookieTestResult> {
    const cookies = this.cookiesMap.get(platform);
    if (!cookies || cookies.length === 0) {
      return {
        success: false,
        platform,
        message: `Chưa import cookies cho ${platform}`,
        cookieCount: 0,
      };
    }

    const rule = PLATFORM_RULES.find(r => r.platform === platform);
    if (!rule) {
      return {
        success: true,
        platform,
        message: `Đã có ${cookies.length} cookies (không thể test tự động)`,
        cookieCount: cookies.length,
      };
    }

    console.log(`[CookieManager] Testing ${platform} cookies (${cookies.length} cookies)...`);

    try {
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const html = await this.fetchWithCookies(rule.testUrl, cookieString);

      const htmlLower = html.toLowerCase();

      // Check for login indicators (= cookies expired)
      const isLoginPage = rule.loginIndicators.some(indicator =>
        htmlLower.includes(indicator.toLowerCase())
      );

      // Check for success indicators
      const isLoggedIn = rule.successIndicators.some(indicator =>
        htmlLower.includes(indicator.toLowerCase())
      );

      // For Facebook, also check c_user cookie
      let username = '';
      if (platform === 'facebook') {
        const cUser = cookies.find(c => c.name === 'c_user');
        if (cUser) username = `User ID: ${cUser.value}`;
      }

      // Update test result
      const cf = this.cookieFiles.find(f => f.platform === platform);
      if (cf) {
        cf.lastTestedAt = Date.now();
      }

      if (isLoginPage && !isLoggedIn) {
        if (cf) cf.testResult = 'expired';
        this.saveState();
        return {
          success: false,
          platform,
          message: `Cookies ${platform} đã hết hạn. Vui lòng đăng nhập lại trên trình duyệt và export cookies mới.`,
          username,
          cookieCount: cookies.length,
        };
      }

      // If page loaded (large HTML) and no login page detected = probably OK
      if (html.length > 10000 || isLoggedIn) {
        if (cf) cf.testResult = 'ok';
        this.saveState();
        return {
          success: true,
          platform,
          message: `Cookies ${platform} hoạt động tốt! (${cookies.length} cookies)`,
          username,
          cookieCount: cookies.length,
        };
      }

      if (cf) cf.testResult = 'error';
      this.saveState();
      return {
        success: false,
        platform,
        message: `Không thể xác nhận cookies ${platform}. Trang trả về quá nhỏ (${html.length} chars).`,
        cookieCount: cookies.length,
      };

    } catch (error: any) {
      const cf = this.cookieFiles.find(f => f.platform === platform);
      if (cf) {
        cf.lastTestedAt = Date.now();
        cf.testResult = 'error';
      }
      this.saveState();
      return {
        success: false,
        platform,
        message: `Lỗi test cookies ${platform}: ${error.message}`,
        cookieCount: cookies.length,
      };
    }
  }

  /**
   * Write cookies to Netscape format file (for yt-dlp --cookies)
   */
  writeCookiesFileForYtDlp(platform: string): string | null {
    const cookies = this.cookiesMap.get(platform);
    if (!cookies || cookies.length === 0) return null;

    const tmpDir = path.join(
      (() => { try { return app.getPath('temp'); } catch { return require('os').tmpdir(); } })(),
      'media-tool-cookies'
    );

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const filePath = path.join(tmpDir, `${platform}-cookies.txt`);

    // Netscape cookie format
    const lines = ['# Netscape HTTP Cookie File', '# https://curl.se/docs/http-cookies.html', ''];

    for (const c of cookies) {
      const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
      const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const cookiePath = c.path || '/';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;

      lines.push(`${domain}\t${includeSubdomains}\t${cookiePath}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    console.log(`[CookieManager] Wrote ${cookies.length} cookies to ${filePath}`);
    return filePath;
  }

  /**
   * Fetch URL with cookies (for testing and scraping)
   */
  private fetchWithCookies(targetUrl: string, cookieString: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(targetUrl);
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        },
        rejectUnauthorized: false,
      };

      const req = https.request(options, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : `https://${parsedUrl.hostname}${res.headers.location}`;
          this.fetchWithCookies(redirectUrl, cookieString).then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.setEncoding('utf-8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('Request timeout'));
      });
      req.end();
    });
  }
}
