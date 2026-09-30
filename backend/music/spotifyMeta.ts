import https from 'node:https'
import type {
  SpotifyMetadataError,
  SpotifyMetadataResult,
  SpotifyMetadataTrack,
  SpotifyResourceType,
} from '../../shared/ipcSchemas'

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_PAGE_LIMIT = 50
const MAX_RETRY_AFTER_MS = 10_000
const MAX_PAGES = 1_000
const SPOTIFY_TYPES = new Set<SpotifyResourceType>(['track', 'album', 'playlist'])

export interface ParsedSpotifyUrl {
  type: SpotifyResourceType
  id: string
  canonicalUrl: string
}

export interface SpotifyHttpResponse {
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

export type SpotifyHttpRequest = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<SpotifyHttpResponse>

export interface SpotifyMetadataResolverOptions {
  getAccessToken: () => string | undefined
  request?: SpotifyHttpRequest
  pageLimit?: number
  timeoutMs?: number
  sleep?: (milliseconds: number) => Promise<void>
}

export interface SpotifyPublicHttpResponse {
  status: number
  text(): Promise<string>
}

export type SpotifyPublicHttpRequest = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<SpotifyPublicHttpResponse>

export interface SpotifyPublicMetadataResolverOptions {
  request?: SpotifyPublicHttpRequest
  timeoutMs?: number
  maxHtmlBytes?: number
  cookieString?: string
}

export interface SpotifyBrowserTrack {
  id: string
  name: string
  artists: string[]
  externalUrl: string
}

export type SpotifyBrowserMetadataRequest = (
  parsed: ParsedSpotifyUrl,
) => Promise<SpotifyBrowserTrack[]>

export interface SpotifyBrowserMetadataResolverOptions {
  readTracks: SpotifyBrowserMetadataRequest
}

export class SpotifyMetadataException extends Error {
  readonly code: SpotifyMetadataError['code']
  readonly retryAfterSeconds?: number

  constructor(code: SpotifyMetadataError['code'], message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'SpotifyMetadataException'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function failure(error: SpotifyMetadataException): SpotifyMetadataResult {
  const metadataError: SpotifyMetadataError = { code: error.code, message: error.message }
  if (error.retryAfterSeconds !== undefined) metadataError.retryAfterSeconds = error.retryAfterSeconds
  return { success: false, error: metadataError }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isValidSpotifyId(id: string): boolean {
  return /^[A-Za-z0-9]+$/.test(id)
}

/** Parse only canonical Spotify web URLs and Spotify URIs. */
export function parseSpotifyUrl(value: string): ParsedSpotifyUrl | null {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return null
  if (/[\x00-\x1F\x7F]/.test(value)) return null

  const webMatch = value.match(/^https:\/\/open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)(?:[?#].*)?$/i)
  const uriMatch = value.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)(?:[?#].*)?$/i)
  const type = (webMatch?.[1] ?? uriMatch?.[1])?.toLowerCase() as SpotifyResourceType | undefined
  const id = webMatch?.[2] ?? uriMatch?.[2]

  if (!type || !SPOTIFY_TYPES.has(type) || !id) return null
  return { type, id, canonicalUrl: `https://open.spotify.com/${type}/${id}` }
}

function isSpotifyApiUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'api.spotify.com' && url.port === '' && !url.username && !url.password && url.pathname.startsWith('/v1/')
  } catch {
    return false
  }
}

function retryAfterMilliseconds(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000))
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 0
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - Date.now()))
}

function responseHeader(response: SpotifyHttpResponse, name: string): string | null {
  try {
    return response.headers.get(name)
  } catch {
    return null
  }
}

function defaultRequest(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<Response> {
  return fetch(url, init)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const PUBLIC_METADATA_TIMEOUT_MS = 10_000
const PUBLIC_METADATA_MAX_HTML_BYTES = 8 * 1024 * 1024
const PUBLIC_METADATA_HEADERS = {
  Accept: '*/*',
  'User-Agent': 'Mozilla/5.0',
}

function defaultPublicRequest(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<Response> {
  return fetch(url, init)
}

function decodeHtmlJson(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
}

function collectJsonValues(value: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonValues(item, found)
  } else if (isRecord(value)) {
    if (typeof value.id === 'string' && typeof value.name === 'string' && Array.isArray(value.artists)) found.push(value)
    for (const child of Object.values(value)) collectJsonValues(child, found)
  }
  return found
}

function extractEmbeddedJson(html: string): unknown[] {
  const documents: unknown[] = []
  const scriptPattern = /<script[^>]*(?:id=["']__NEXT_DATA__["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(scriptPattern)) {
    try {
      documents.push(JSON.parse(decodeHtmlJson(match[1])))
    } catch {
      // Ignore unrelated or malformed JSON scripts.
    }
  }
  return documents.flatMap((document) => collectJsonValues(document))
}

function htmlText(value: string): string {
  return decodeHtmlJson(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPublicHtmlTracks(html: string): SpotifyMetadataTrack[] {
  const rowStarts = Array.from(html.matchAll(/<div[^>]+data-testid=["']track-row["'][^>]*>/gi), (match) => match.index ?? -1)
  const tracks: SpotifyMetadataTrack[] = []
  for (let index = 0; index < rowStarts.length; index += 1) {
    const start = rowStarts[index]
    const end = rowStarts[index + 1] >= 0 ? rowStarts[index + 1] : html.length
    const row = html.slice(start, end)
    const id = row.match(/href=["']\/track\/([A-Za-z0-9]+)["']/i)?.[1]
    const title = row.match(/id=["']listrow-title-[^"']+["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]
      ?? row.match(/aria-label=["']([^"']+)["']/i)?.[1]
    const artists = Array.from(row.matchAll(/href=["']\/artist\/[A-Za-z0-9]+["'][^>]*>([^<]+)<\/a>/gi), (match) => htmlText(match[1]))
    if (!id || !title || artists.length === 0) continue
    tracks.push({
      id,
      name: htmlText(title),
      artists: Array.from(new Set(artists)),
      externalUrl: `https://open.spotify.com/track/${id}`,
    })
  }
  return tracks
}

function dedupePublicTracks(values: unknown[]): SpotifyMetadataTrack[] {
  const seen = new Set<string>()
  const tracks: SpotifyMetadataTrack[] = []
  for (const value of values) {
    const track = isRecord(value) && Array.isArray(value.artists) && value.artists.every((artist) => typeof artist === 'string')
      ? value as unknown as SpotifyMetadataTrack
      : mapTrack(value)
    if (!track || seen.has(track.id)) continue
    seen.add(track.id)
    tracks.push(track)
  }
  return tracks
}

async function fetchPublicSpotifyHtml(
  url: string,
  options: SpotifyPublicMetadataResolverOptions,
): Promise<string> {
  const request = options.request ?? defaultPublicRequest
  const timeoutMs = options.timeoutMs ?? PUBLIC_METADATA_TIMEOUT_MS
  const maxHtmlBytes = options.maxHtmlBytes ?? PUBLIC_METADATA_MAX_HTML_BYTES
  if (!Number.isInteger(maxHtmlBytes) || maxHtmlBytes < 1024 || maxHtmlBytes > PUBLIC_METADATA_MAX_HTML_BYTES) {
    throw new SpotifyMetadataException('invalid', 'Spotify HTML response limit is invalid.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = options.cookieString
      ? { ...PUBLIC_METADATA_HEADERS, Cookie: options.cookieString }
      : PUBLIC_METADATA_HEADERS
    const response = await request(url, { headers, signal: controller.signal })
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new SpotifyMetadataException('access-denied', 'Spotify playlist is private or unavailable.')
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SpotifyMetadataException('upstream', `Spotify returned HTTP ${response.status}.`)
    }
    const html = await response.text()
    if (Buffer.byteLength(html, 'utf8') > maxHtmlBytes) {
      throw new SpotifyMetadataException('upstream', 'Spotify page is too large to process.')
    }
    return html
  } catch (error: unknown) {
    if (error instanceof SpotifyMetadataException) throw error
    if (controller.signal.aborted) throw new SpotifyMetadataException('timeout', 'Spotify page request timed out.')
    throw new SpotifyMetadataException('upstream', 'Spotify public page request failed.')
  } finally {
    clearTimeout(timeout)
  }
}

/** Resolve browser-session Spotify metadata without audio URLs. */
export async function resolveBrowserSpotifyMetadata(
  spotifyUrl: string,
  options: SpotifyBrowserMetadataResolverOptions,
): Promise<SpotifyMetadataResult> {
  const parsed = parseSpotifyUrl(spotifyUrl)
  if (!parsed) return failure(new SpotifyMetadataException('invalid', 'Invalid Spotify URL.'))
  try {
    const rawTracks = await options.readTracks(parsed)
    const tracks = dedupePublicTracks(rawTracks)
    if (tracks.length === 0) throw new SpotifyMetadataException('upstream', 'Spotify browser session returned no track metadata.')
    return {
      success: true,
      type: parsed.type,
      id: parsed.id,
      name: `${parsed.type === 'playlist' ? 'Spotify Playlist' : parsed.type === 'album' ? 'Spotify Album' : tracks[0].name}`,
      externalUrl: parsed.canonicalUrl,
      tracks,
    }
  } catch (error: unknown) {
    if (error instanceof SpotifyMetadataException) return failure(error)
    return failure(new SpotifyMetadataException('upstream', 'Spotify browser metadata extraction failed.'))
  }
}

/** Resolve public Spotify page metadata without API credentials or audio URLs. */
export async function resolvePublicSpotifyMetadata(
  spotifyUrl: string,
  options: SpotifyPublicMetadataResolverOptions = {},
): Promise<SpotifyMetadataResult> {
  const parsed = parseSpotifyUrl(spotifyUrl)
  if (!parsed) return failure(new SpotifyMetadataException('invalid', 'Invalid Spotify URL.'))

  try {
    const html = await fetchPublicSpotifyHtml(parsed.canonicalUrl, options)
    let embeddedTracks = dedupePublicTracks([...extractEmbeddedJson(html), ...extractPublicHtmlTracks(html)])
    if (embeddedTracks.length === 0 && parsed.type === 'track') {
      const legacy = await getSpotifyMeta(parsed.canonicalUrl)
      if (legacy.success) {
        embeddedTracks = [{ id: parsed.id, name: legacy.title || parsed.id, artists: legacy.artist ? [legacy.artist] : [], externalUrl: parsed.canonicalUrl }]
      }
    }
    if (parsed.type === 'track') {
      const track = embeddedTracks.find((item) => item.id === parsed.id) ?? embeddedTracks[0]
      if (!track) throw new SpotifyMetadataException('upstream', 'Spotify page did not contain track metadata.')
      return { success: true, type: 'track', id: parsed.id, name: track.name, externalUrl: track.externalUrl, tracks: [track] }
    }

    const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)
    const name = titleMatch?.[1] ? decodeHtmlJson(titleMatch[1]) : `${parsed.type === 'playlist' ? 'Spotify Playlist' : 'Spotify Album'} ${parsed.id}`
    if (embeddedTracks.length === 0) {
      throw new SpotifyMetadataException('upstream', 'Spotify page did not contain public track metadata. Spotify may have changed its public markup or the playlist may be unavailable.')
    }
    return { success: true, type: parsed.type, id: parsed.id, name, externalUrl: parsed.canonicalUrl, tracks: embeddedTracks }
  } catch (error: unknown) {
    if (error instanceof SpotifyMetadataException) return failure(error)
    return failure(new SpotifyMetadataException('upstream', 'Spotify public metadata extraction failed.'))
  }
}

async function requestWithTimeout(
  request: SpotifyHttpRequest,
  url: string,
  accessToken: string,
  timeoutMs: number,
): Promise<SpotifyHttpResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await request(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
  } catch (error: unknown) {
    if (controller.signal.aborted) throw new SpotifyMetadataException('timeout', 'Spotify API request timed out.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function requestJson(
  request: SpotifyHttpRequest,
  url: string,
  accessToken: string,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<unknown> {
  if (!isSpotifyApiUrl(url)) {
    throw new SpotifyMetadataException('upstream', 'Spotify API returned an invalid pagination URL.')
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: SpotifyHttpResponse
    try {
      response = await requestWithTimeout(request, url, accessToken, timeoutMs)
    } catch (error: unknown) {
      if (error instanceof SpotifyMetadataException) throw error
      throw new SpotifyMetadataException('upstream', 'Spotify API request failed.')
    }

    const retryAfterMs = retryAfterMilliseconds(responseHeader(response, 'Retry-After'))
    if (response.status === 429) {
      if (attempt === 0) {
        await sleep(retryAfterMs)
        continue
      }
      throw new SpotifyMetadataException('rate-limit', 'Spotify rate limit reached.', Math.ceil(retryAfterMs / 1000))
    }
    if (response.status === 401) throw new SpotifyMetadataException('auth-required', 'Spotify access token was rejected.')
    if (response.status === 403 || response.status === 404) throw new SpotifyMetadataException('access-denied', 'Spotify denied access to this resource.')
    if (response.status < 200 || response.status >= 300) throw new SpotifyMetadataException('upstream', 'Spotify API returned an upstream error.')

    try {
      return await response.json()
    } catch {
      throw new SpotifyMetadataException('upstream', 'Spotify API returned invalid JSON.')
    }
  }

  throw new SpotifyMetadataException('upstream', 'Spotify API request failed.')
}

function readExternalUrl(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    const candidate = stringValue(value.spotify)
    if (candidate?.startsWith('https://open.spotify.com/')) return candidate
  }
  return fallback
}

function readArtists(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((artist) => {
    if (!isRecord(artist)) return []
    const name = stringValue(artist.name)
    return name ? [name] : []
  })
}

function mapTrack(value: unknown, fallbackAlbumName?: string): SpotifyMetadataTrack | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const name = stringValue(value.name)
  if (!id || !name || !isValidSpotifyId(id)) return null

  const album = isRecord(value.album) ? value.album : undefined
  const albumName = stringValue(album?.name) ?? fallbackAlbumName
  const durationMs = typeof value.duration_ms === 'number' && Number.isFinite(value.duration_ms) && value.duration_ms >= 0
    ? value.duration_ms
    : undefined
  const track: SpotifyMetadataTrack = {
    id,
    name,
    artists: readArtists(value.artists),
    externalUrl: readExternalUrl(isRecord(value.external_urls) ? value.external_urls : undefined, `https://open.spotify.com/track/${id}`),
  }
  if (albumName) track.albumName = albumName
  if (durationMs !== undefined) track.durationMs = durationMs
  return track
}

function paginatedTracks(value: unknown, fallbackAlbumName?: string): { items: SpotifyMetadataTrack[]; next: string | null } {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new SpotifyMetadataException('upstream', 'Spotify API returned invalid track pagination data.')
  }
  const items = value.items.flatMap((item) => {
    const trackValue = isRecord(item) && isRecord(item.item)
      ? item.item
      : isRecord(item) && isRecord(item.track)
        ? item.track
        : item
    const track = mapTrack(trackValue, fallbackAlbumName)
    return track ? [track] : []
  })
  const next = value.next === null || value.next === undefined ? null : stringValue(value.next) ?? null
  if (value.next !== null && value.next !== undefined && !next) {
    throw new SpotifyMetadataException('upstream', 'Spotify API returned invalid pagination data.')
  }
  return { items, next }
}

/** Resolve Spotify Web API metadata with main-process token and request injection. */
export async function resolveSpotifyMetadata(
  spotifyUrl: string,
  options: SpotifyMetadataResolverOptions,
): Promise<SpotifyMetadataResult> {
  const parsed = parseSpotifyUrl(spotifyUrl)
  if (!parsed) return failure(new SpotifyMetadataException('invalid', 'Invalid Spotify URL.'))

  const pageLimit = options.pageLimit ?? MAX_PAGE_LIMIT
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > MAX_PAGE_LIMIT) {
    return failure(new SpotifyMetadataException('invalid', 'Spotify page limit must be between 1 and 50.'))
  }

  const accessToken = options.getAccessToken()?.trim()
  if (!accessToken) return failure(new SpotifyMetadataException('auth-required', 'Spotify access token is not configured.'))

  const request = options.request ?? defaultRequest
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const sleep = options.sleep ?? wait

  try {
    const rootUrl = `${SPOTIFY_API_BASE}/${parsed.type}s/${parsed.id}`
    const root = await requestJson(request, rootUrl, accessToken, timeoutMs, sleep)

    if (parsed.type === 'track') {
      const track = mapTrack(root)
      if (!track) throw new SpotifyMetadataException('upstream', 'Spotify API returned invalid track metadata.')
      const rootRecord = isRecord(root) ? root : undefined
      return {
        success: true,
        type: parsed.type,
        id: parsed.id,
        name: track.name,
        externalUrl: readExternalUrl(rootRecord?.external_urls, parsed.canonicalUrl),
        tracks: [track],
      }
    }

    const rootRecord = isRecord(root) ? root : undefined
    const name = stringValue(rootRecord?.name)
    if (!name) throw new SpotifyMetadataException('upstream', 'Spotify API returned invalid collection metadata.')

    const pageResource = parsed.type === 'playlist' ? 'playlists' : 'albums'
    const pageEndpoint = parsed.type === 'playlist' ? 'items' : 'tracks'
    const firstPageUrl = `${SPOTIFY_API_BASE}/${pageResource}/${parsed.id}/${pageEndpoint}?limit=${pageLimit}`
    const tracks: SpotifyMetadataTrack[] = []
    let current = paginatedTracks(await requestJson(request, firstPageUrl, accessToken, timeoutMs, sleep), name)
    const seenPages = new Set<string>([firstPageUrl])
    let pageCount = 1
    tracks.push(...current.items)

    while (current.next !== null) {
      if (pageCount >= MAX_PAGES || seenPages.has(current.next)) {
        throw new SpotifyMetadataException('upstream', 'Spotify API returned invalid pagination data.')
      }
      seenPages.add(current.next)
      current = paginatedTracks(await requestJson(request, current.next, accessToken, timeoutMs, sleep), name)
      pageCount += 1
      tracks.push(...current.items)
    }

    if (tracks.length === 0 && isRecord(rootRecord?.tracks)) {
      const fallback = paginatedTracks(rootRecord.tracks, name)
      tracks.push(...fallback.items)
    }

    return {
      success: true,
      type: parsed.type,
      id: parsed.id,
      name,
      externalUrl: readExternalUrl(rootRecord?.external_urls, parsed.canonicalUrl),
      tracks,
    }
  } catch (error: unknown) {
    if (error instanceof SpotifyMetadataException) return failure(error)
    return failure(new SpotifyMetadataException('upstream', 'Spotify API request failed.'))
  }
}

// Legacy oEmbed adapter kept for existing callers.
export interface SpotifyOembedResult {
  success: boolean
  title?: string
  artist?: string
  thumbnailUrl?: string
  providerName?: string
  url?: string
  error?: string
}

function isLegacySpotifyUrl(url: string): boolean {
  return /^https?:\/\/(open\.)?spotify\.com\/.+/.test(url)
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SpotifyMetaLookup/1.0)',
        Accept: 'application/json',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location
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
      res.on('data', (chunk: Buffer | string) => { data += chunk.toString() })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(10000, () => req.destroy(new Error('Request timeout')))
  })
}

/** Backward-compatible public oEmbed lookup. */
export async function getSpotifyMeta(spotifyUrl: string): Promise<SpotifyOembedResult> {
  if (!isLegacySpotifyUrl(spotifyUrl)) return { success: false, error: 'URL không phải Spotify' }

  try {
    const raw = await httpsGet(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`)
    const json = JSON.parse(raw) as Record<string, unknown>
    const title = stringValue(json.title) ?? ''
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
      thumbnailUrl: stringValue(json.thumbnail_url) ?? '',
      providerName: stringValue(json.provider_name) ?? 'Spotify',
      url: stringValue(json.resource_url) || spotifyUrl,
    }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
