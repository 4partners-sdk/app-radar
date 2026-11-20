// "Refresh now": asks functions/api/refresh.js to start a daily check and follows it. Everyone with the site open
// sees a check in progress, whoever started it; the page reloads by itself once the new data is published.
import { useEffect, useState } from 'preact/hooks'
import type { Index } from './data.ts'

interface Run { status: string; conclusion: string | null; createdAt: string; updatedAt: string; url: string }
interface Status { configured: boolean; latest?: Run | null; error?: string }

const API = 'api/refresh'
const IDLE_POLL = 3 * 60_000
const ACTIVE_POLL = 15_000
/** a started run shows up in GitHub's list a few seconds after the request; give up waiting after this */
const START_GRACE = 3 * 60_000

const active = (r?: Run | null) => !!r && r.status !== 'completed'
const minutes = (from: string) => Math.max(0, Math.round((Date.now() - Date.parse(from)) / 60_000))

async function readStatus(init?: RequestInit): Promise<Status> {
  const r = await fetch(API, { cache: 'no-store', ...init })
  // no endpoint (local dev) or a page instead of JSON: no button
  if (!(r.headers.get('Content-Type') ?? '').includes('application/json')) return { configured: false }
  return (await r.json()) as Status
}

async function dataChangedSince(generatedAt: string): Promise<boolean> {
  try {
    const r = await fetch('data/index.json', { cache: 'no-cache' })
    return r.ok && ((await r.json()) as Index).generatedAt !== generatedAt
  } catch {
    return false
  }
}

export function Refresh({ generatedAt }: { generatedAt: string }) {
  const [status, setStatus] = useState<Status>()
  const [askedAt, setAskedAt] = useState<number>()
  const [error, setError] = useState<string>()
  const [, tick] = useState(0)

  const latest = status?.latest
  // pressed here, and GitHub doesn't list the new run yet
  const starting = !!askedAt && Date.now() - askedAt < START_GRACE && !(latest && Date.parse(latest.createdAt) >= askedAt - 30_000)
  const running = active(latest) || starting

  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const s = await readStatus()
        if (stop) return
        setStatus(s)
        if (s.error) setError(s.error)
        else if (s.latest?.status === 'completed' && s.latest.conclusion === 'success' && (await dataChangedSince(generatedAt))) {
          location.reload()
        }
      } catch { /* offline or signed out — try again later */ }
      tick(n => n + 1)
    }
    poll()
    const t = setInterval(poll, running ? ACTIVE_POLL : IDLE_POLL)
    return () => { stop = true; clearInterval(t) }
  }, [running, generatedAt])

  if (!status?.configured) return null

  const start = async () => {
    setError(undefined)
    setAskedAt(Date.now())
    try {
      const s = await readStatus({ method: 'POST', headers: { 'X-App-Radar': '1' } })
      setStatus(s)
      if (s.error) { setError(s.error); setAskedAt(undefined) }
    } catch (e) {
      setError((e as Error).message)
      setAskedAt(undefined)
    }
  }

  const failedRun = !running && latest?.status === 'completed' && latest.conclusion !== 'success' && latest.conclusion !== 'cancelled'
  const label = !running ? 'Refresh now'
    : starting && !active(latest) ? 'Starting…'
    : `Updating… ${minutes(latest!.createdAt)} min`

  return (
    <div class="refresh">
      <button class="btn ghost" disabled={running} onClick={start}
        title={running ? 'A full check takes about 7 minutes; the page reloads when it is done' : 'Run the full check now (about 7 minutes)'}>
        {running && <i class="spin" />}{label}
      </button>
      {error && <span class="refresh-note bad" title={error}>Couldn't start: {error}</span>}
      {!error && failedRun && latest && <a class="refresh-note bad" href={latest.url} target="_blank" rel="noreferrer">Last update failed</a>}
    </div>
  )
}
