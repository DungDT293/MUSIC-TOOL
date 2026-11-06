import { create } from 'zustand'

export type MediaKind = 'image' | 'video' | 'audio'

export interface MediaItem {
  path: string
  name: string
  addedAt: number
}

const STORAGE_KEY = 'song-nhac.media-library'

type Lists = Record<MediaKind, MediaItem[]>

function load(): Lists {
  const empty: Lists = { image: [], video: [], audio: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<Lists>
    return {
      image: Array.isArray(parsed.image) ? parsed.image : [],
      video: Array.isArray(parsed.video) ? parsed.video : [],
      audio: Array.isArray(parsed.audio) ? parsed.audio : [],
    }
  } catch {
    return empty
  }
}

function persist(lists: Lists): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lists))
  } catch {
    // Storage may be full or disabled; the library still works for this session.
  }
}

interface MediaLibraryStore extends Lists {
  add: (kind: MediaKind, path: string, name?: string) => void
  remove: (kind: MediaKind, path: string) => void
}

const nameOf = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath

export const useMediaLibrary = create<MediaLibraryStore>((set, get) => ({
  ...load(),
  add: (kind, path, name) => {
    const current = get()[kind]
    const existing = current.find((item) => item.path === path)
    const next = existing
      ? [{ ...existing, addedAt: Date.now() }, ...current.filter((item) => item.path !== path)]
      : [{ path, name: name ?? nameOf(path), addedAt: Date.now() }, ...current].slice(0, 60)
    const lists = { image: get().image, video: get().video, audio: get().audio, [kind]: next } as Lists
    persist(lists)
    set({ [kind]: next } as Partial<MediaLibraryStore>)
  },
  remove: (kind, path) => {
    const next = get()[kind].filter((item) => item.path !== path)
    const lists = { image: get().image, video: get().video, audio: get().audio, [kind]: next } as Lists
    persist(lists)
    set({ [kind]: next } as Partial<MediaLibraryStore>)
  },
}))
