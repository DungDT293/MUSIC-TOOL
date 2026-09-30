import { BrowserWindow, session } from 'electron'
import type { CookieEntry } from '../backend/youtube/cookieManager'
import type { ParsedSpotifyUrl } from '../backend/music/spotifyMeta'

export interface BrowserSpotifyTrack {
  id: string
  name: string
  artists: string[]
  externalUrl: string
}

const MAX_TRACKS = 1000
const LOAD_TIMEOUT_MS = 20_000
const SCROLL_STEPS = 240
const INITIAL_RENDER_WAIT_MS = 3_000

function isAllowedSpotifyUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' &&
      (url.pathname.startsWith('/playlist/') || url.pathname.startsWith('/album/') || url.pathname.startsWith('/track/'))
  } catch {
    return false
  }
}

function cookieUrl(cookie: CookieEntry): string {
  const domain = cookie.domain.replace(/^\./, '')
  return `https://${domain}${cookie.path || '/'}`
}

export async function readSpotifyPlaylistWithBrowser(
  parsed: ParsedSpotifyUrl,
  cookies: CookieEntry[],
): Promise<BrowserSpotifyTrack[]> {
  if (cookies.length === 0) throw new Error('Spotify cookies are empty.')
  const partition = `spotify-metadata-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const ses = session.fromPartition(partition)
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })

  try {
    for (const cookie of cookies) {
      await ses.cookies.set({
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure ?? true,
        httpOnly: cookie.httpOnly ?? false,
        expirationDate: cookie.expirationDate,
      })
    }

    const target = `https://open.spotify.com/${parsed.type}/${parsed.id}`
    if (!isAllowedSpotifyUrl(target)) throw new Error('Spotify URL is not allowed.')
    await window.loadURL(target, { httpReferrer: 'https://open.spotify.com/' })
    await new Promise((resolve) => setTimeout(resolve, INITIAL_RENDER_WAIT_MS))

    const tracks = await window.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const output = new Map();
      const readRows = () => {
        document.querySelectorAll('[data-testid="track-row"]').forEach(row => {
          const link = row.querySelector('a[href^="/track/"]');
          const id = link?.getAttribute('href')?.match(/^\\/track\\/([A-Za-z0-9]+)/)?.[1];
          const title = row.querySelector('[id^="listrow-title-"] span')?.textContent?.trim() || row.getAttribute('aria-label')?.trim();
          const artists = [...row.querySelectorAll('a[href^="/artist/"]')].map(node => node.textContent?.trim()).filter(Boolean);
          if (id && title && artists.length) output.set(id, { id, name: title, artists, externalUrl: 'https://open.spotify.com/track/' + id });
        });
      };
      let stable = 0;
      let previous = 0;
      for (let i = 0; i < ${SCROLL_STEPS}; i++) {
        readRows();
        const candidates = [
          document.querySelector('[data-main-scrollable-node="true"]'),
          document.querySelector('main'),
          document.scrollingElement,
        ].filter(Boolean);
        const scroller = candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
        if (!scroller) break;
        const previousTop = scroller.scrollTop;
        const step = Math.max(scroller.clientHeight * 0.85, 500);
        scroller.scrollBy({ top: step, behavior: 'auto' });
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: step, bubbles: true, cancelable: true }));
        scroller.scrollTop = Math.min(scroller.scrollHeight, previousTop + step);
        await sleep(500);
        readRows();
        if (output.size === previous) stable += 1; else stable = 0;
        previous = output.size;
        if (stable >= 20) break;
      }
      readRows();
      return [...output.values()].slice(0, ${MAX_TRACKS});
    })()`, true)

    if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('Spotify browser page returned no track metadata.')
    return tracks as BrowserSpotifyTrack[]
  } finally {
    if (!window.isDestroyed()) window.destroy()
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'serviceworkers', 'cachestorage'] }).catch(() => {})
  }
}
