import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Category, CategoryState, GlobalState, Settings } from './model.ts'
import { dataKey, open, seal } from './crypto.ts'
import { DAY } from './util.ts'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** DATA_DIR: where state lives (in CI, a checkout of the `data` branch) */
export const DATA = process.env.DATA_DIR ?? join(ROOT, 'data')
const STATE = join(DATA, 'state')

function readJSON<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback
}

export function writeJSON(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(value))
  renameSync(tmp, path)
}

/** Writes JSON encrypted when DATA_KEY is set (as `<path>.enc`, dropping a plain copy), plain otherwise. */
export function writeSealed(path: string, value: unknown) {
  const key = dataKey()
  if (!key) return writeJSON(path, value)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.enc.tmp'
  writeFileSync(tmp, seal(JSON.stringify(value), key))
  renameSync(tmp, path + '.enc')
  rmSync(path, { force: true })
}

/** Reads `<path>.enc` (needs DATA_KEY) or, before the first encrypted save, the plain `<path>`. */
export function readSealed<T>(path: string, fallback: T): T {
  if (existsSync(path + '.enc')) {
    const key = dataKey()
    if (!key) throw new Error(`${path}.enc is encrypted — set DATA_KEY`)
    return JSON.parse(open(readFileSync(path + '.enc'), key)) as T
  }
  return readJSON(path, fallback)
}

// SETTINGS_FILE / CATEGORIES_FILE: other config for tests and experiments
export const settings = (): Settings => readJSON(process.env.SETTINGS_FILE ?? join(ROOT, 'config', 'settings.json'), null as unknown as Settings)
export const categories = (): Category[] => readJSON(process.env.CATEGORIES_FILE ?? join(ROOT, 'config', 'categories.json'), [])

export function loadCategory(id: string): CategoryState {
  return readSealed(join(STATE, `${id}.json`), { apps: {}, events: [], runs: [] })
}
export function saveCategory(id: string, s: CategoryState) { writeSealed(join(STATE, `${id}.json`), s) }

export function loadGlobal(): GlobalState { return readSealed(join(STATE, 'global.json'), { seen: {}, reviews: [] }) }
export function saveGlobal(g: GlobalState) { writeSealed(join(STATE, 'global.json'), g) }

/** Keeps the last `days` of everything: events, runs, growth points, removed apps, reviews. */
export function prune(s: CategoryState, days: number, now: Date, today: number) {
  const from = new Date(now.getTime() - days * DAY).toISOString()
  s.events = s.events.filter(e => e.date >= from)
  s.runs = s.runs.filter(r => r.date >= from)
  for (const [id, a] of Object.entries(s.apps)) {
    if ((a.removedAt && a.removedAt < from) || a.lastSeen < from) { delete s.apps[id]; continue }
    // one point just outside the window keeps "gained over N days" answerable for the full window
    const keep = a.growth.findIndex(p => p[0] >= today - days)
    if (keep > 1) a.growth.splice(0, keep - 1)
    if (a.versions && a.versions.length > 1) {
      const recent = a.versions.filter(v => v.date >= from)
      a.versions = recent.length ? (recent.length === a.versions.length ? a.versions : [a.versions[a.versions.length - recent.length - 1], ...recent]) : a.versions.slice(-1)
    }
  }
}

export function pruneGlobal(g: GlobalState, days: number, now: Date) {
  const from = new Date(now.getTime() - days * DAY).toISOString()
  g.reviews = g.reviews.filter(r => r.date >= from)
}
