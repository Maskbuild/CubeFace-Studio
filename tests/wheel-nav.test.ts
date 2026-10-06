import { describe, expect, it } from 'vitest'
import { wheelScreens, type WheelItem, type WheelPage } from '../src/renderer/src/skin/figura'

const items = (n: number, pre = 'x'): WheelItem[] => Array.from({ length: n }, (_, i) => ({ id: pre + i, type: 'clear', title: '' }))

describe('wheel screens', () => {
  it('keeps the first page whole when it fits and gives sub-pages a Back', () => {
    const pages: WheelPage[] = [
      { id: 'main', title: 'Main', items: [{ id: 'go', type: 'page', page: 'faces', title: '' }, { id: 'home', type: 'home', title: '' }] },
      { id: 'faces', title: 'Faces', items: items(3) }
    ]
    const s = wheelScreens(pages)
    expect(s.length).toBe(2)
    expect(s[0].slots.map((x) => x.kind)).toEqual(['item', 'item'])
    expect(s[0].slots[0]).toMatchObject({ to: 1 })
    expect(s[0].slots[1]).toMatchObject({ to: 0 })
    expect(s[1].slots.at(-1)).toEqual({ kind: 'back', to: 0 })
  })

  it('splits long pages with Next only while more buttons follow', () => {
    const pages: WheelPage[] = [
      { id: 'main', title: 'Main', items: [{ id: 'go', type: 'page', page: 'faces', title: '' }] },
      { id: 'faces', title: 'Faces', items: items(15) }
    ]
    const s = wheelScreens(pages)
    // faces: 6 + back + next, 6 + back + next, 3 + back
    expect(s.map((x) => x.slots.length)).toEqual([1, 8, 8, 4])
    expect(s[1].slots.slice(-2)).toEqual([{ kind: 'back', to: 0 }, { kind: 'next', to: 2 }])
    expect(s[2].slots.slice(-2)).toEqual([{ kind: 'back', to: 1 }, { kind: 'next', to: 3 }])
    expect(s[3].slots.at(-1)).toEqual({ kind: 'back', to: 2 })
    expect(s.every((x) => x.slots.length <= 8)).toBe(true)
    expect(s[0].slots[0]).toMatchObject({ to: 1 })
  })

  it('first page gets Next but no Back on its first part', () => {
    const s = wheelScreens([{ id: 'main', title: 'Main', items: items(9) }])
    expect(s[0].slots.map((x) => x.kind).filter((k) => k !== 'item')).toEqual(['next'])
    expect(s[0].slots.length).toBe(8)
    expect(s[1].slots.at(-1)).toEqual({ kind: 'back', to: 0 })
  })
})
