import { describe, expect, it, vi } from 'vitest'
import { parseSpotifyUrl, resolvePublicSpotifyMetadata, resolveSpotifyMetadata, type SpotifyHttpResponse, type SpotifyPublicHttpResponse } from '../../../backend/music/spotifyMeta'

function response(status: number, body: unknown, headers: Record<string, string> = {}): SpotifyHttpResponse {
  return {
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  }
}

function htmlResponse(status: number, html: string): SpotifyPublicHttpResponse {
  return { status, text: async () => html }
}

const track = (id: string, name: string) => ({
  id,
  name,
  artists: [{ name: 'Artist' }],
  duration_ms: 1234,
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
})

describe('Public Spotify metadata', () => {
  it('extracts ordered public playlist tracks without Authorization header', async () => {
    const request = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => htmlResponse(200, `
      <meta property="og:title" content="Public Mix">
      <script id="__NEXT_DATA__">${JSON.stringify({ props: { tracks: { items: [
        { track: { id: 'one', name: 'One', artists: [{ name: 'Artist A' }, { name: 'Artist A' }], album: { name: 'Album' } } },
        { track: { id: 'one', name: 'One duplicate', artists: [{ name: 'Artist A' }] } },
        { track: { id: 'two', name: 'Two', artists: [{ name: 'Artist B' }], preview_url: 'https://audio.invalid/nope' } },
      ] } } })}</script>
    `))
    const result = await resolvePublicSpotifyMetadata('https://open.spotify.com/playlist/pl1', { request })
    expect(result.success).toBe(true)
    if (result.success) expect(result.tracks.map((item) => item.id)).toEqual(['one', 'two'])
    expect(request.mock.calls[0]?.[1].headers.Authorization).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('preview_url')
  })

  it('extracts current public track-row HTML when JSON scripts are absent', async () => {
    const html = `<title>Public Playlist | Spotify</title><div data-testid="track-row"><a href="/track/abc123"><p id="listrow-title-track-spotify:track:abc123-0"><span>Song &amp; One</span></p></a><p><a href="/artist/artist1">Artist One</a></p></div>`
    const result = await resolvePublicSpotifyMetadata('https://open.spotify.com/playlist/pl1', {
      request: vi.fn().mockResolvedValue(htmlResponse(200, html)),
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.tracks[0]).toMatchObject({ id: 'abc123', name: 'Song & One', artists: ['Artist One'] })
  })

  it('rejects blocked pages and oversized responses', async () => {
    const blocked = await resolvePublicSpotifyMetadata('https://open.spotify.com/playlist/pl1', {
      request: vi.fn().mockResolvedValue(htmlResponse(403, 'blocked')),
    })
    expect(blocked).toEqual({ success: false, error: { code: 'access-denied', message: 'Spotify playlist is private or unavailable.' } })

    const oversized = await resolvePublicSpotifyMetadata('https://open.spotify.com/playlist/pl1', {
      request: vi.fn().mockResolvedValue(htmlResponse(200, 'x'.repeat(2048))),
      maxHtmlBytes: 1024,
    })
    expect(oversized).toEqual({ success: false, error: { code: 'upstream', message: 'Spotify page is too large to process.' } })
  })
})

describe('Spotify metadata', () => {
  it('strictly parses supported URL and URI forms', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/abc123?si=x#fragment')).toEqual({
      type: 'playlist',
      id: 'abc123',
      canonicalUrl: 'https://open.spotify.com/playlist/abc123',
    })
    expect(parseSpotifyUrl('spotify:track:abc123')).toMatchObject({ type: 'track', id: 'abc123' })
    for (const value of [
      'http://open.spotify.com/track/abc123',
      'https://spotify.com/track/abc123',
      'https://open.spotify.com/show/abc123',
      'https://open.spotify.com/track/abc/extra',
      'https://open.spotify.com:443/track/abc123',
      'https://open.spotify.com/track/a%2Fb',
      'spotify:artist:abc123',
    ]) expect(parseSpotifyUrl(value)).toBeNull()
  })

  it('preserves paginated order and stops at next null', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response(200, {
        name: 'Playlist',
        external_urls: { spotify: 'https://open.spotify.com/playlist/pl1' },
      }))
      .mockResolvedValueOnce(response(200, {
        items: [{ track: track('one', 'One') }],
        next: 'https://api.spotify.com/v1/playlists/pl1/items?offset=1',
      }))
      .mockResolvedValueOnce(response(200, {
        items: [{ track: track('two', 'Two') }],
        next: null,
      }))

    const result = await resolveSpotifyMetadata('https://open.spotify.com/playlist/pl1', {
      getAccessToken: () => 'secret-token',
      request,
      sleep: async () => {},
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.tracks.map((item) => item.id)).toEqual(['one', 'two'])
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[0]?.[1].headers.Authorization).toBe('Bearer secret-token')
  })

  it('honors one bounded Retry-After retry and reports rate limit', async () => {
    const sleep = vi.fn(async () => {})
    const request = vi.fn()
      .mockResolvedValueOnce(response(429, {}, { 'Retry-After': '9999' }))
      .mockResolvedValueOnce(response(429, {}, { 'Retry-After': '9999' }))

    const result = await resolveSpotifyMetadata('spotify:track:abc123', {
      getAccessToken: () => 'secret-token',
      request,
      sleep,
    })

    expect(result).toEqual({ success: false, error: { code: 'rate-limit', message: 'Spotify rate limit reached.', retryAfterSeconds: 10 } })
    expect(request).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10_000)
  })

  it('reports missing auth without network call', async () => {
    const request = vi.fn()
    const result = await resolveSpotifyMetadata('spotify:track:abc123', {
      getAccessToken: () => undefined,
      request,
    })
    expect(result).toEqual({ success: false, error: { code: 'auth-required', message: 'Spotify access token is not configured.' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('does not return audio or preview URLs', async () => {
    const result = await resolveSpotifyMetadata('spotify:track:abc123', {
      getAccessToken: () => 'secret-token',
      request: vi.fn().mockResolvedValue(response(200, {
        ...track('abc123', 'Track'),
        preview_url: 'https://audio.example/secret.mp3',
      })),
    })
    expect(result.success).toBe(true)
    expect(JSON.stringify(result)).not.toContain('preview_url')
    expect(JSON.stringify(result)).not.toContain('audio.example')
  })
})
