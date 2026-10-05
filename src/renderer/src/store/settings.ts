import { create } from 'zustand'
import i18n from '../i18n'
import { storage } from '../lib/storage'

export type ThemeMode = 'system' | 'light' | 'dark'
export const ACCENTS = ['mono', 'aqua', 'rose', 'violet', 'mint', 'amber'] as const
export type Accent = (typeof ACCENTS)[number]
export type Lang = 'th' | 'en'

interface Settings {
  theme: ThemeMode
  accent: Accent
  lang: Lang
}

interface SettingsStore extends Settings {
  loaded: boolean
  load(): Promise<void>
  set(p: Partial<Settings>): void
}

function apply(s: Settings) {
  const root = document.documentElement
  if (s.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = s.theme
  root.dataset.accent = s.accent
  root.lang = s.lang
  i18n.changeLanguage(s.lang)
}

export const useSettings = create<SettingsStore>((set, get) => ({
  theme: 'system',
  accent: 'aqua',
  lang: 'th',
  loaded: false,
  async load() {
    const saved = await storage.getGlobal<Partial<Settings>>('settings')
    const next = { theme: get().theme, accent: get().accent, lang: get().lang, ...saved }
    apply(next)
    set({ ...next, loaded: true })
  },
  set(p) {
    set(p)
    const { theme, accent, lang } = get()
    apply({ theme, accent, lang })
    storage.setGlobal('settings', { theme, accent, lang })
  }
}))
