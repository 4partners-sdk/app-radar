import { useEffect, useState } from 'preact/hooks'
import type { AppRow, WatchRow } from '../../collector/publish.ts'
import type { EventKind, GrowthPoint, InAppItem, Review, Run, Version, WatchEvent } from '../../collector/model.ts'

export type { AppRow, EventKind, Review, Run, WatchEvent, WatchRow }

export interface Index {
  generatedAt: string
  lastDaily?: string
  lastRecheck?: string
  lastPrices?: string
  timezone: string
  dailyHour: number
  retentionDays: number
  countries: string[]
  featureWords: string
  riskyWords: string
  pricesTop: number
  /** the watch list as of the last check; the site reads the live list from api/watchers */
  watchers: WatchRow[]
  lastReviews?: string
  watchEveryHours: number
  categories: { id: string; name: string; enabled: boolean; active: number; removed: number }[]
}

export interface VersionRow { id: number; version: string; date: string; notes: string; before?: number; after?: number; boost?: boolean }

export interface Detail {
  growth: GrowthPoint[]
  byCountry: Record<string, [number, number]>
  versions?: Version[]
  inApp?: InAppItem[]
  notes?: string
  languages?: string[]
  screenshots?: string[]
  desc?: string
  genres?: string[]
  sellerURL?: string
  pulledFrom?: Record<string, string>
  countryMiss?: Record<string, { n: number; since: string }>
}

const cache = new Map<string, Promise<unknown>>()

export function load<T>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(`data/${path}`, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
      return r.json()
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p as Promise<T>
}

export function useData<T>(path: string | null): { data?: T; error?: string } {
  const [state, set] = useState<{ path: string | null; data?: T; error?: string }>({ path: null })
  useEffect(() => {
    if (!path) return
    let live = true
    load<T>(path).then(data => live && set({ path, data }), e => live && set({ path, error: String(e.message ?? e) }))
    return () => { live = false }
  }, [path])
  return state.path === path ? state : {}
}

export const detail = (cat: string, id: number) => load<Record<string, Detail>>(`${cat}/d/${id % 32}.json`).then(m => m[id])

export const SHARDS = 32
