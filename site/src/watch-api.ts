// The watch list's endpoint (functions/api/watchers.js): read it, add an app, remove one.
import type { WatchedApp } from '../../collector/model.ts'

export type { WatchedApp }

export interface WatchList {
  /** false: the site can't edit the list (no DATA_REPO_TOKEN, or local dev without the endpoint) */
  configured: boolean
  apps?: WatchedApp[]
  error?: string
  /** after an add: its first check started right away */
  started?: boolean
  /** after an add: the App Store didn't answer, so the name is a placeholder until the first check */
  unverified?: boolean
}

const API = 'api/watchers'

async function call(init?: RequestInit): Promise<WatchList> {
  const r = await fetch(API, { cache: 'no-store', ...init })
  // no endpoint (local dev) or a page instead of JSON: read-only
  if (!(r.headers.get('Content-Type') ?? '').includes('application/json')) return { configured: false }
  return (await r.json()) as WatchList
}

const send = (body: unknown) =>
  call({ method: 'POST', headers: { 'X-App-Radar': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const readWatchList = () => call()
export const addApp = (app: string) => send({ op: 'add', app })
export const removeApp = (id: number) => send({ op: 'remove', id })
