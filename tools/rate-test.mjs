// Does Apple count its Search API limit per IP? Run as several parallel jobs (each on its own runner):
//   node tools/rate-test.mjs <shard> <shards> <intervalMs> <minutes>
// Each job sends real category searches (its own slice, so no two jobs repeat a URL) at a fixed pace and
// reports its public IP and every status code. Writes a table to the job summary in GitHub Actions.
import { readFileSync, appendFileSync } from 'node:fs'

const [shard = 0, shards = 1, intervalMs = 3400, minutes = 5] = process.argv.slice(2).map(Number)
const cats = JSON.parse(readFileSync(new URL('../config/categories.json', import.meta.url)))
const { countries } = JSON.parse(readFileSync(new URL('../config/settings.json', import.meta.url)))
const all = cats.flatMap(c => countries.flatMap(country => c.terms.map(term => ({ term, country }))))
const mine = all.filter((_, i) => i % shards === shard)

const ip = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10_000) }).then(r => r.text()).catch(() => 'unknown')
const started = Date.now(), until = started + minutes * 60_000
const counts = {}
let sent = 0, first429, streak = 0, stopped = ''
const sleep = ms => new Promise(r => setTimeout(r, ms))

console.log(`shard ${shard}/${shards} · IP ${ip} · one request per ${intervalMs} ms for ${minutes} min`)
for (const { term, country } of mine) {
  const at = started + sent * intervalMs
  if (at > until) break
  await sleep(Math.max(0, at - Date.now()))
  const q = new URLSearchParams({ term, entity: 'software', limit: '200', country })
  let code
  try {
    code = (await fetch(`https://itunes.apple.com/search?${q}`, { signal: AbortSignal.timeout(30_000) })).status
  } catch {
    code = 'error'
  }
  sent++
  counts[code] = (counts[code] ?? 0) + 1
  const t = ((Date.now() - started) / 1000).toFixed(0)
  if (code === 429 || code === 403) {
    first429 ??= t
    console.log(`  ${t}s  HTTP ${code}  ${country} "${term}"`)
    // three throttles in a row is the answer already — no need to keep hitting Apple
    if (++streak >= 3) { stopped = 'stopped after 3 throttles in a row'; break }
  } else streak = 0
  if (sent % 20 === 0) console.log(`  ${t}s  ${sent} sent`, counts)
}

const secs = ((Date.now() - started) / 1000).toFixed(0)
const throttled = (counts[429] ?? 0) + (counts[403] ?? 0)
const line = `shard ${shard} | IP ${ip} | ${sent} requests in ${secs}s | 200: ${counts[200] ?? 0} | throttled: ${throttled}` +
  (first429 ? ` (first at ${first429}s)` : '') + (stopped ? ` | ${stopped}` : '')
console.log('\nRESULT ' + line)
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `| shard | IP | requests | seconds | 200 | throttled (429/403) | first throttle |\n|---|---|---|---|---|---|---|\n` +
    `| ${shard} | ${ip} | ${sent} | ${secs} | ${counts[200] ?? 0} | ${throttled} | ${first429 ? first429 + ' s' : '—'} |\n`)
}
