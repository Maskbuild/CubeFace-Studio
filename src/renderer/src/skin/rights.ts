/**
 * What may be done with something that came from someone else (Figura avatars, emotes).
 * "own" (made by me) and "exclusive" (bought with full rights) allow everything.
 */
export const SOURCES = ['free', 'bought', 'own', 'exclusive'] as const
export type Source = (typeof SOURCES)[number]

export interface Rights {
  source: Source
  commercial: boolean // may be used commercially
  redistribute: boolean // may be shared / re-uploaded
  modify: 'yes' | 'limited' | 'no'
}

export const defaultRights = (source: Source = 'free'): Rights => ({ source, commercial: false, redistribute: false, modify: 'limited' })

export const isOwned = (r?: Rights) => !!r && (r.source === 'own' || r.source === 'exclusive')

/** Exporting / downloading a copy needs redistribution rights (or owning it). */
export const canRedistribute = (r?: Rights) => isOwned(r) || !!r?.redistribute

/** Accept only well-formed rights (data coming back from storage / IPC). */
export function cleanRights(v: unknown): Rights | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (!SOURCES.includes(o.source as Source)) return undefined
  const modify = o.modify === 'yes' || o.modify === 'no' ? o.modify : 'limited'
  return { source: o.source as Source, commercial: o.commercial === true, redistribute: o.redistribute === true, modify }
}
