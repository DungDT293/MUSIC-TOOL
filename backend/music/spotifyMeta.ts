/**
 * Spotify Metadata Lookup
 * Dùng public oembed API — không cần auth/token
 * https://open.spotify.com/oembed?url=<spotify_url>
 */

import https from 'node:https'

export interface SpotifyOembedResult {
  success: boolean
  title?: string
  artist?: string           // Phân tích từ title (format: "Track - Artist")
  thumbnailUrl?: string
  providerName?: string
  url?: string
  error?: string
}

function isSpotifyUrl(url: string): boolean {
  return /^https?:\/\/(open\.)?spotify\.com\/.+/.test(url)
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SpotifyMetaLookup/1.0)',
        'Accept': 'application/json',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers['location']
        if (location) {
          httpsGet(location).then(resolve).catch(reject)
          return
        }
      }
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'))
    })
  })
}

/**
 * Lookup Spotify track/album/playlist metadata via public oembed API
 */
export async function getSpotifyMeta(spotifyUrl: string): Promise<SpotifyOembedResult> {
  if (!isSpotifyUrl(spotifyUrl)) {
    return { success: false, error: 'URL không phải Spotify' }
  }

  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`
    const raw = await httpsGet(oembedUrl)
    const json = JSON.parse(raw)

    // title thường có format "Track Name" (oembed trả về tên bài hát)
    // thumbnail_url có sẵn
    const title: string = json.title || ''
    const thumbnail: string = json.thumbnail_url || ''
    const provider: string = json.provider_name || 'Spotify'

    // Cố gắng split artist từ title nếu có dấu " · " (Spotify format)
    let trackName = title
    let artist = ''
    if (title.includes(' · ')) {
      const parts = title.split(' · ')
      trackName = parts[0]?.trim() || title
      artist = parts.slice(1).join(', ').trim()
    }

    return {
      success: true,
      title: trackName,
      artist,
      thumbnailUrl: thumbnail,
      providerName: provider,
      url: json.resource_url || spotifyUrl,
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}
