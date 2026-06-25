/**
 * FacebookScraper - Scrape Facebook Reels/Videos without yt-dlp
 * Uses cookies from JSON export (browser extension) to access Facebook
 * Extracts reel IDs from listing pages and direct video URLs from reel pages
 *
 * HD support (v4.4): Parses relay JSON data from data-sjs> script tags
 * instead of flat regex — this is how Facebook embeds HD URLs in 2025+
 * Also includes Tahoe async endpoint fallback for additional HD sources
 */

import { EventEmitter } from 'events';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

export interface FacebookCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
}

export interface FacebookReelInfo {
  id: string;
  url: string;
  videoUrl?: string;   // Direct mp4 URL (SD)
  videoUrlHD?: string; // HD mp4 URL
  title?: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  width?: number;
  height?: number;
}

/** Internal type for collecting video URLs during parsing */
interface VideoUrlResult {
  sd?: string;
  hd?: string;
  dash?: string;
}

export class FacebookScraper extends EventEmitter {
  private cookieString: string = '';
  private cookies: FacebookCookie[] = [];

  constructor() {
    super();
  }

  /**
   * Set cookies directly from cookie string (from CookieManager)
   */
  setCookieString(cookieStr: string): void {
    this.cookieString = cookieStr;
    // Parse minimal cookie info
    this.cookies = cookieStr.split('; ').map(pair => {
      const [name, ...valueParts] = pair.split('=');
      return { name, value: valueParts.join('='), domain: '.facebook.com' };
    }).filter(c => c.name && c.value);
    console.log(`[FacebookScraper] Set ${this.cookies.length} cookies from CookieManager`);
  }

  /**
   * Load cookies from JSON file (exported by browser extension like "J2Team Cookies")
   */
  loadCookiesFromJSON(jsonPath: string): boolean {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const data = JSON.parse(raw);

      // Support both [...]  and { cookies: [...] } and { url, cookies: [...] } formats
      let cookiesArray: any[];
      if (Array.isArray(data)) {
        cookiesArray = data;
      } else if (data.cookies && Array.isArray(data.cookies)) {
        cookiesArray = data.cookies;
      } else {
        console.error('[FacebookScraper] Invalid cookies JSON format');
        return false;
      }

      this.cookies = cookiesArray.filter((c: any) =>
        c.name && c.value && (c.domain?.includes('facebook.com') || c.domain?.includes('.facebook.com'))
      );

      this.cookieString = this.cookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      console.log(`[FacebookScraper] Loaded ${this.cookies.length} cookies`);
      return this.cookies.length > 0;
    } catch (error: any) {
      console.error(`[FacebookScraper] Failed to load cookies: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if cookies are loaded and valid
   */
  hasCookies(): boolean {
    return this.cookies.length > 0 && this.cookieString.length > 0;
  }

  /**
   * Check if a URL is a Facebook reels listing page
   */
  static isReelsListingUrl(inputUrl: string): boolean {
    return /facebook\.com\/[^/]+\/reels\/?$/.test(inputUrl) ||
           /facebook\.com\/[^/]+\/videos\/?$/.test(inputUrl);
  }

  /**
   * Check if a URL is a single Facebook reel/video
   */
  static isSingleReelUrl(inputUrl: string): boolean {
    return /facebook\.com\/reel\/\d+/.test(inputUrl) ||
           /facebook\.com\/share\/r\//.test(inputUrl) ||
           /facebook\.com\/watch\/?\?v=/.test(inputUrl) ||
           /facebook\.com\/.+\/videos\/\d+/.test(inputUrl) ||
           /fb\.watch\//.test(inputUrl);
  }

  /**
   * Fetch a URL with Facebook cookies
   */
  private fetch(targetUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(targetUrl);
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Cookie': this.cookieString,
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
          console.log(`[FacebookScraper] Redirected to: ${res.headers.location}`);
          this.fetch(res.headers.location).then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.setEncoding('utf-8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
          } else {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout'));
      });
      req.end();
    });
  }

  /**
   * POST request to Facebook (for Tahoe endpoint)
   */
  private postFetch(targetUrl: string, postData: string = ''): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(targetUrl);
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Cookie': this.cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'Content-Length': Buffer.byteLength(postData).toString(),
        },
        rejectUnauthorized: false,
      };

      const req = https.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.postFetch(res.headers.location, postData).then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.setEncoding('utf-8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve(data);
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout'));
      });
      req.write(postData);
      req.end();
    });
  }

  /**
   * Get list of reel IDs from a Facebook profile reels page
   */
  async getReelIds(listingUrl: string): Promise<string[]> {
    console.log(`[FacebookScraper] Scraping reel IDs from: ${listingUrl}`);

    if (!this.hasCookies()) {
      throw new Error('Facebook cookies not loaded. Please import a cookies JSON file.');
    }

    const html = await this.fetch(listingUrl);
    console.log(`[FacebookScraper] Page size: ${html.length} chars`);

    // Check if we got a login page
    if (html.length < 10000 && html.toLowerCase().includes('login')) {
      throw new Error('Facebook cookies expired. Please re-export cookies from browser.');
    }

    // Extract reel IDs from HTML
    const reelIds = new Set<string>();

    // Pattern 1: /reel/ID
    const reelMatches = html.matchAll(/\/reel\/(\d{10,})/g);
    for (const match of reelMatches) {
      reelIds.add(match[1]);
    }

    // Pattern 2: "videoID":"ID" or "video_id":"ID"
    const videoIdMatches = html.matchAll(/"(?:videoID|video_id|videoId)"\s*:\s*"(\d{10,})"/g);
    for (const match of videoIdMatches) {
      reelIds.add(match[1]);
    }

    const ids = Array.from(reelIds);
    console.log(`[FacebookScraper] Found ${ids.length} reel IDs`);
    return ids;
  }

  // ============================================
  // HD Video Extraction - Strategy 1: Parse Relay JSON
  // ============================================

  /**
   * Extract video URLs from data-sjs> relay prefetched data.
   * Facebook embeds video data in <script> tags with relay/require data.
   * This is where HD URLs are hidden in 2025+.
   */
  private extractRelayVideoData(html: string): VideoUrlResult {
    const result: VideoUrlResult = {};

    // Step 1: Find all script content that might contain video data
    // Facebook uses multiple patterns:
    //   <script type="application/json" data-sjs>{"require":...}</script>
    //   <script>requireLazy(["ServerJS"], function(ServerJS) { ServerJS.handleServerJS(...)});</script>
    //   <script data-content-len="..." data-sjs>...</script>

    const scriptBlocks: string[] = [];

    // Pattern A: data-sjs script tags (most common in 2024-2025)
    const sjsRegex = /<script[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(sjsRegex)) {
      const content = match[1].trim();
      if (content && (
        content.includes('playable_url') ||
        content.includes('browser_native') ||
        content.includes('dash_manifest') ||
        content.includes('videoDeliveryResponse') ||
        content.includes('video_url') ||
        content.includes('hd_src') ||
        content.includes('sd_src') ||
        content.includes('progressive_url')
      )) {
        scriptBlocks.push(content);
      }
    }

    // Pattern B: handleServerJS (legacy but still seen)
    const serverJsRegex = /handleServerJS\(({.+?})\)(?:;|,\")/gs;
    for (const match of html.matchAll(serverJsRegex)) {
      const content = match[1];
      if (content.includes('playable_url') || content.includes('browser_native') ||
          content.includes('hd_src') || content.includes('sd_src')) {
        scriptBlocks.push(content);
      }
    }

    // Pattern C: large JSON objects within script tags (fallback)
    if (scriptBlocks.length === 0) {
      const bigJsonRegex = /<script[^>]*>(\{(?:"require"|"__bbox"|"result").{500,}?})<\/script>/gi;
      for (const match of html.matchAll(bigJsonRegex)) {
        const content = match[1];
        if (content.includes('video') || content.includes('playable')) {
          scriptBlocks.push(content);
        }
      }
    }

    console.log(`[FacebookScraper] Found ${scriptBlocks.length} script blocks with potential video data`);

    // Step 2: Parse each block and traverse for video URLs
    for (const block of scriptBlocks) {
      try {
        const data = JSON.parse(block);
        this.traverseForVideoUrls(data, result);
        // Stop early if we found HD
        if (result.hd) {
          console.log(`[FacebookScraper] Found HD URL from relay JSON parsing`);
          break;
        }
      } catch {
        // JSON parse may fail on truncated blocks — try regex fallback on this block
        this.regexExtractUrls(block, result);
      }
    }

    return result;
  }

  /**
   * Recursively traverse parsed relay JSON to find video URL keys.
   * Facebook nests video data 10+ levels deep in __bbox/result/data/... structures.
   *
   * 2025 format: videoDeliveryResponseResult contains:
   *   - progressive_urls: [{progressive_url, metadata: {quality: "SD"|"HD"}}]
   *   - dash_manifests: [{manifest_xml: "<MPD>...</MPD>"}]
   *   - dash_manifest_urls: [{manifest_url: "https://..."}]
   *
   * progressive_urls HD = 720p, DASH = up to 1080p
   */
  private traverseForVideoUrls(
    obj: any,
    result: VideoUrlResult,
    depth = 0
  ): void {
    if (depth > 30 || !obj || typeof obj !== 'object') return;

    // === NEW delivery format (2024-2025): videoDeliveryResponseResult ===
    if (obj.videoDeliveryResponseResult) {
      const vdr = obj.videoDeliveryResponseResult;
      console.log(`[FacebookScraper] Found videoDeliveryResponseResult (keys: ${Object.keys(vdr).join(', ')})`);

      // Progressive URLs (direct MP4s) — quality is in metadata.quality string
      if (Array.isArray(vdr.progressive_urls)) {
        console.log(`[FacebookScraper] progressive_urls: ${vdr.progressive_urls.length} entries`);

        for (const p of vdr.progressive_urls) {
          const rawUrl = p.progressive_url || p.url || '';
          const decodedUrl = this.decodeUrl(rawUrl);
          if (!decodedUrl || !decodedUrl.startsWith('http')) continue;

          const meta = p.metadata || {};
          const quality = (meta.quality || '').toUpperCase();
          console.log(`[FacebookScraper]   progressive: quality="${quality}" url=${decodedUrl.substring(0, 80)}...`);

          if (quality === 'HD') {
            result.hd = result.hd || decodedUrl;
          } else {
            result.sd = result.sd || decodedUrl;
          }
        }
      }

      // DASH manifests — contain ALL quality levels up to 1080p
      // Save for later parsing (extractBestUrlFromDash)
      if (Array.isArray(vdr.dash_manifests) && vdr.dash_manifests.length > 0) {
        const dashXml = vdr.dash_manifests[0].manifest_xml;
        if (dashXml) {
          result.dash = result.dash || dashXml;
          console.log(`[FacebookScraper] DASH manifest XML found (${dashXml.length} chars)`);
        }
      }
      if (Array.isArray(vdr.dash_manifest_urls) && vdr.dash_manifest_urls.length > 0) {
        for (const d of vdr.dash_manifest_urls) {
          if (d.manifest_url && !result.dash) {
            result.dash = d.manifest_url;
          }
        }
      }
    }

    // === Legacy keys (still common in 2025) ===
    if (typeof obj.playable_url_quality_hd === 'string' && obj.playable_url_quality_hd) {
      const decoded = this.decodeUrl(obj.playable_url_quality_hd);
      if (decoded && decoded.startsWith('http')) {
        result.hd = result.hd || decoded;
      }
    }
    if (typeof obj.playable_url === 'string' && obj.playable_url) {
      const decoded = this.decodeUrl(obj.playable_url);
      if (decoded && decoded.startsWith('http')) {
        result.sd = result.sd || decoded;
      }
    }
    if (typeof obj.browser_native_hd_url === 'string' && obj.browser_native_hd_url) {
      const decoded = this.decodeUrl(obj.browser_native_hd_url);
      if (decoded && decoded.startsWith('http')) {
        result.hd = result.hd || decoded;
      }
    }
    if (typeof obj.browser_native_sd_url === 'string' && obj.browser_native_sd_url) {
      const decoded = this.decodeUrl(obj.browser_native_sd_url);
      if (decoded && decoded.startsWith('http')) {
        result.sd = result.sd || decoded;
      }
    }

    // Legacy hd_src / sd_src keys
    if (typeof obj.hd_src_no_ratelimit === 'string' && obj.hd_src_no_ratelimit) {
      result.hd = result.hd || this.decodeUrl(obj.hd_src_no_ratelimit);
    }
    if (typeof obj.hd_src === 'string' && obj.hd_src) {
      result.hd = result.hd || this.decodeUrl(obj.hd_src);
    }
    if (typeof obj.sd_src_no_ratelimit === 'string' && obj.sd_src_no_ratelimit) {
      result.sd = result.sd || this.decodeUrl(obj.sd_src_no_ratelimit);
    }
    if (typeof obj.sd_src === 'string' && obj.sd_src) {
      result.sd = result.sd || this.decodeUrl(obj.sd_src);
    }

    // DASH manifest direct key
    if (typeof obj.dash_manifest === 'string' && obj.dash_manifest) {
      result.dash = result.dash || obj.dash_manifest;
    }
    if (typeof obj.dash_manifest_url === 'string' && obj.dash_manifest_url) {
      result.dash = result.dash || obj.dash_manifest_url;
    }

    // Recurse into children
    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.traverseForVideoUrls(item, result, depth + 1);
        if (result.hd) return; // Early exit once HD found
      }
    } else {
      for (const key of Object.keys(obj)) {
        this.traverseForVideoUrls(obj[key], result, depth + 1);
        if (result.hd) return; // Early exit once HD found
      }
    }
  }

  /**
   * Regex-based extraction of video URLs from a raw text block.
   * Used as fallback when JSON parsing fails.
   */
  private regexExtractUrls(text: string, result: VideoUrlResult): void {
    // HD patterns
    const hdPatterns = [
      /"playable_url_quality_hd"\s*:\s*"([^"]+)"/g,
      /"browser_native_hd_url"\s*:\s*"([^"]+)"/g,
      /"hd_src_no_ratelimit"\s*:\s*"([^"]+)"/g,
      /"hd_src"\s*:\s*"([^"]+)"/g,
    ];

    for (const pattern of hdPatterns) {
      for (const match of text.matchAll(pattern)) {
        const decoded = this.decodeUrl(match[1]);
        if (decoded && decoded.startsWith('http')) {
          result.hd = result.hd || decoded;
        }
      }
      if (result.hd) break;
    }

    // SD patterns
    const sdPatterns = [
      /"playable_url"\s*:\s*"([^"]+)"/g,
      /"browser_native_sd_url"\s*:\s*"([^"]+)"/g,
      /"sd_src_no_ratelimit"\s*:\s*"([^"]+)"/g,
      /"sd_src"\s*:\s*"([^"]+)"/g,
    ];

    for (const pattern of sdPatterns) {
      for (const match of text.matchAll(pattern)) {
        const decoded = this.decodeUrl(match[1]);
        if (decoded && decoded.startsWith('http')) {
          result.sd = result.sd || decoded;
        }
      }
      if (result.sd) break;
    }

    // Progressive URL pattern (new format)
    // Facebook 2025: progressive_urls have metadata.quality = "SD" or "HD" (uppercase)
    const progressivePattern = /"progressive_url"\s*:\s*"([^"]+)"/g;
    for (const match of text.matchAll(progressivePattern)) {
      const decoded = this.decodeUrl(match[1]);
      if (decoded && decoded.startsWith('http')) {
        // Check for quality hint in surrounding text (case-insensitive)
        const surroundingStart = Math.max(0, (match.index || 0) - 300);
        const surrounding = text.substring(surroundingStart, (match.index || 0) + match[0].length + 300);
        const surroundingUpper = surrounding.toUpperCase();
        if (surroundingUpper.includes('"QUALITY":"HD"') || surroundingUpper.includes('"HD"') ||
            surrounding.includes('1280') || surrounding.includes('1920') || surrounding.includes('720')) {
          result.hd = result.hd || decoded;
        } else {
          result.sd = result.sd || decoded;
        }
      }
    }

    // Fallback: scontent CDN URLs (any quality)
    if (!result.sd && !result.hd) {
      const mp4Pattern = /"(https?:\\?\/?\\?\/?scontent[^"]*\.mp4[^"]*)"/g;
      for (const match of text.matchAll(mp4Pattern)) {
        const decoded = this.decodeUrl(match[1]);
        if (decoded && decoded.startsWith('http')) {
          result.sd = result.sd || decoded;
        }
      }
    }
  }

  // ============================================
  // HD Video Extraction - Strategy 2: Tahoe Endpoint
  // ============================================

  /**
   * Fetch video info via Facebook's internal Tahoe async player endpoint.
   * This is a POST request that returns richer video data including HD URLs.
   */
  private async fetchViaTahoe(videoId: string): Promise<VideoUrlResult> {
    const result: VideoUrlResult = {};

    try {
      const tahoeUrl = `https://www.facebook.com/video/tahoe/async/${videoId}/?chain=true&isvideo=true&payloadtype=primary`;
      console.log(`[FacebookScraper] Trying Tahoe endpoint for video ${videoId}`);

      const response = await this.postFetch(tahoeUrl);

      // Tahoe response has a prefix "for (;;);" that must be stripped (anti-JSON-hijack)
      const cleaned = response.replace(/^for\s*\(\s*;\s*;\s*\)\s*;?\s*/, '');

      // Try parse as JSON
      try {
        const data = JSON.parse(cleaned);
        this.traverseForVideoUrls(data, result);
      } catch {
        // Fall back to regex extraction
        this.regexExtractUrls(cleaned, result);
      }

      if (result.hd || result.sd) {
        console.log(`[FacebookScraper] Tahoe returned: HD=${!!result.hd}, SD=${!!result.sd}`);
      }
    } catch (error: any) {
      console.log(`[FacebookScraper] Tahoe fallback failed: ${error.message}`);
    }

    return result;
  }

  // ============================================
  // HD Video Extraction - Strategy 3: Parse DASH manifest
  // ============================================

  /**
   * Extract highest quality video URL from a DASH manifest XML.
   * Facebook's DASH manifests contain multiple quality representations.
   */
  private extractBestUrlFromDash(dashManifest: string): string | null {
    try {
      // Decode if needed
      const decoded = this.decodeUrl(dashManifest);
      const xml = decoded || dashManifest;

      // If it's a URL to the manifest (not the XML itself), skip
      if (xml.startsWith('http')) {
        return null; // Can't fetch and parse DASH manifest URL here
      }

      // Facebook DASH XML format (2025):
      //   <Representation id="..." bandwidth="..." codecs="av01..." mimeType="video/mp4"
      //     ... many FB-specific attributes ...
      //     width="720" height="1280" FBQualityClass="hd" FBQualityLabel="720p">
      //     <BaseURL>https://scontent...mp4?...</BaseURL>
      //   </Representation>
      //
      // Attributes appear in ANY ORDER with many custom FB attributes between them.
      // Audio tracks have mimeType="audio/mp4" and NO width/height.
      // We extract each <Representation...>...<BaseURL>URL</BaseURL> block,
      // then parse attributes individually from the tag string.

      const representations: Array<{
        url: string;
        bandwidth: number;
        width: number;
        height: number;
        qualityLabel: string;
      }> = [];

      // Match each Representation block: tag content + BaseURL
      const repBlockRegex = /<Representation\s([^>]+)>[\s\S]*?<BaseURL>([^<]+)<\/BaseURL>/gi;

      for (const match of xml.matchAll(repBlockRegex)) {
        const attrs = match[1];
        const baseUrl = this.decodeUrl(match[2]);

        if (!baseUrl || !baseUrl.startsWith('http')) continue;

        // Skip audio-only representations
        if (attrs.includes('audio/mp4') || attrs.includes('audio/')) continue;

        // Extract individual attributes (order-independent)
        const bandwidth = parseInt(attrs.match(/bandwidth="(\d+)"/)?.[1] || '0');
        const width = parseInt(attrs.match(/width="(\d+)"/)?.[1] || '0');
        const height = parseInt(attrs.match(/height="(\d+)"/)?.[1] || '0');
        const qualityLabel = attrs.match(/FBQualityLabel="([^"]+)"/)?.[1] || '';

        if (width > 0) {
          representations.push({ url: baseUrl, bandwidth, width, height, qualityLabel });
        }
      }

      if (representations.length === 0) return null;

      // Sort by pixel count (width*height) descending, then by bandwidth
      representations.sort((a, b) => {
        const pixelsA = a.width * a.height;
        const pixelsB = b.width * b.height;
        if (pixelsB !== pixelsA) return pixelsB - pixelsA;
        return b.bandwidth - a.bandwidth;
      });

      const best = representations[0];
      console.log(`[FacebookScraper] DASH: found ${representations.length} video representations, best: ${best.width}x${best.height} (${best.qualityLabel}, ${(best.bandwidth / 1000).toFixed(0)}kbps)`);

      // NOTE: DASH representations are video-only (AV1/VP9 codec).
      // They need ffmpeg to merge with audio track for a complete file.
      // For now, we still return the URL — the caller (youtubeDownloader)
      // should prefer progressive HD (720p complete mp4) over DASH.
      return best.url;
    } catch (error: any) {
      console.log(`[FacebookScraper] DASH parsing failed: ${error.message}`);
      return null;
    }
  }

  // ============================================
  // Main video info extraction
  // ============================================

  /**
   * Get direct video URL from a single reel page.
   * Uses multi-strategy approach for HD:
   *   1. Parse relay JSON from data-sjs script tags
   *   2. Flat regex fallback on full HTML
   *   3. Tahoe async endpoint fallback
   *   4. DASH manifest parsing
   */
  async getReelVideoUrl(reelUrl: string): Promise<FacebookReelInfo> {
    const reelIdMatch = reelUrl.match(/reel\/(\d+)/) ||
                        reelUrl.match(/videos\/(\d+)/) ||
                        reelUrl.match(/watch\/?\?v=(\d+)/);
    const reelId = reelIdMatch ? reelIdMatch[1] : 'unknown';

    console.log(`[FacebookScraper] Getting video URL for reel: ${reelId}`);

    if (!this.hasCookies()) {
      throw new Error('Facebook cookies not loaded.');
    }

    const html = await this.fetch(reelUrl);

    if (html.length < 10000 && html.toLowerCase().includes('login')) {
      throw new Error('Facebook cookies expired.');
    }

    console.log(`[FacebookScraper] Page size: ${html.length} chars`);

    // === Strategy 1: Parse relay JSON data from data-sjs script tags ===
    let videoResult = this.extractRelayVideoData(html);

    // === Strategy 2: Flat regex fallback on full HTML ===
    if (!videoResult.hd && !videoResult.sd) {
      console.log(`[FacebookScraper] Relay parsing found nothing, trying flat regex...`);
      videoResult = {};
      this.regexExtractUrls(html, videoResult);
    }

    // === Strategy 3: Tahoe async endpoint fallback ===
    if (!videoResult.hd && reelId !== 'unknown') {
      console.log(`[FacebookScraper] No HD URL found, trying Tahoe endpoint...`);
      const tahoeResult = await this.fetchViaTahoe(reelId);
      videoResult.hd = videoResult.hd || tahoeResult.hd;
      videoResult.sd = videoResult.sd || tahoeResult.sd;
      videoResult.dash = videoResult.dash || tahoeResult.dash;
    }

    // === Strategy 4: Try DASH manifest for highest quality ===
    if (!videoResult.hd && videoResult.dash) {
      console.log(`[FacebookScraper] Trying DASH manifest for HD...`);
      const dashUrl = this.extractBestUrlFromDash(videoResult.dash);
      if (dashUrl) {
        videoResult.hd = dashUrl;
      }
    }

    // Extract title/description
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/) ||
                       html.match(/"text"\s*:\s*"([^"]{10,200})"/);
    const title = titleMatch ? titleMatch[1].substring(0, 200) : `Facebook Reel ${reelId}`;

    // Extract uploader
    const uploaderMatch = html.match(/"name"\s*:\s*"([^"]+)".*?"__typename"\s*:\s*"User"/s) ||
                          html.match(/"ownerName"\s*:\s*"([^"]+)"/) ||
                          html.match(/"owner"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
    const uploader = uploaderMatch ? uploaderMatch[1] : '';

    // Extract dimensions from HTML meta or video data
    const widthMatch = html.match(/"width"\s*:\s*(\d+).*?"height"\s*:\s*(\d+)/);
    const width = widthMatch ? parseInt(widthMatch[1]) : 0;
    const height = widthMatch ? parseInt(widthMatch[2]) : 0;

    // Prefer HD URL, fallback to SD
    const bestVideoUrl = videoResult.hd || videoResult.sd || '';

    if (!bestVideoUrl) {
      throw new Error(`No video URL found for reel ${reelId}. The reel may be private or deleted.`);
    }

    const qualityTag = videoResult.hd ? 'HD' : 'SD';
    console.log(`[FacebookScraper] Best video URL: ${qualityTag} (HD=${!!videoResult.hd}, SD=${!!videoResult.sd}, DASH=${!!videoResult.dash})`);

    return {
      id: reelId,
      url: reelUrl,
      videoUrl: videoResult.sd || bestVideoUrl,
      videoUrlHD: videoResult.hd,
      title,
      uploader,
      width,
      height,
    };
  }

  /**
   * Download a video from direct URL to output path
   */
  async downloadVideo(videoUrl: string, outputPath: string, onProgress?: (percent: number, downloaded: number, total: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(videoUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.facebook.com/',
        },
        rejectUnauthorized: false,
      };

      const req = (protocol as typeof https).request(options, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.downloadVideo(res.headers.location, outputPath, onProgress).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        // Ensure directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const fileStream = fs.createWriteStream(outputPath);

        res.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length;
          if (onProgress && totalSize > 0) {
            const percent = (downloadedSize / totalSize) * 100;
            onProgress(percent, downloadedSize, totalSize);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          console.log(`[FacebookScraper] Downloaded: ${outputPath} (${(downloadedSize / 1024 / 1024).toFixed(1)} MB)`);
          resolve(outputPath);
        });

        fileStream.on('error', (err) => {
          fs.unlinkSync(outputPath);
          reject(err);
        });
      });

      req.on('error', reject);
      req.setTimeout(300000, () => {
        req.destroy(new Error('Download timeout'));
      });
      req.end();
    });
  }

  /**
   * Decode Facebook's escaped URL format.
   * Enhanced to handle all escape sequences used by Facebook in 2025.
   */
  private decodeUrl(escaped: string): string {
    if (!escaped) return '';
    return escaped
      .replace(/\\\//g, '/')            // \/ → /
      .replace(/\\u0025/g, '%')         // unicode %
      .replace(/\\u0026/g, '&')         // unicode &
      .replace(/\\u003d/g, '=')         // unicode =
      .replace(/\\u003C/gi, '<')        // unicode <
      .replace(/\\u003E/gi, '>')        // unicode >
      .replace(/\\u0022/g, '"')         // unicode "
      .replace(/\\n/g, '')              // newlines in URLs
      .replace(/\\t/g, '')              // tabs
      .replace(/&amp;/g, '&')           // HTML entity &
      .replace(/&#37;/g, '%')           // HTML entity %
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)))  // \x hex escapes
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))); // remaining \u escapes
  }

  /**
   * Sanitize filename for Windows
   */
  static sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
  }
}
