import { create } from 'zustand'

const RECENTS_KEY = 'song-nhac.recent-projects'
const DRAFT_KEY = 'song-nhac.autosave'

export interface RecentProject {
  path: string
  name: string
  savedAt: number
}

export interface DraftProject {
  json: string
  savedAt: number
}

function loadRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadDraft(): DraftProject | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftProject
    return parsed && typeof parsed.json === 'string' ? parsed : null
  } catch {
    return null
  }
}

interface ProjectHistoryStore {
  recents: RecentProject[]
  draft: DraftProject | null
  remember: (path: string, name: string) => void
  setDraft: (json: string) => void
  clearDraft: () => void
  forget: (path: string) => void
}

export const useProjectHistory = create<ProjectHistoryStore>((set, get) => ({
  recents: loadRecents(),
  draft: loadDraft(),
  remember: (path, name) => {
    const entry: RecentProject = { path, name, savedAt: Date.now() }
    const next = [entry, ...get().recents.filter((item) => item.path !== path)].slice(0, 10)
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
    } catch {
      // Ignore storage failures; the list still works for this session.
    }
    set({ recents: next })
  },
  setDraft: (json) => {
    const draft: DraftProject = { json, savedAt: Date.now() }
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // A 40MB project may exceed the quota; autosave silently gives up.
    }
    set({ draft })
  },
  clearDraft: () => {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      // ignore
    }
    set({ draft: null })
  },
  forget: (path) => {
    const next = get().recents.filter((item) => item.path !== path)
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
    set({ recents: next })
  },
}))
