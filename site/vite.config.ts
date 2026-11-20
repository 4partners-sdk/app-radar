import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'

/** `MOCK_REFRESH=1 npm run dev`: a stand-in for functions/api/refresh.js, so the Refresh button can be tried locally.
 *  A started "check" runs for 45 s, then succeeds. */
function mockRefresh(): Plugin {
  const at = (ms = 0) => new Date(Date.now() - ms).toISOString()
  let run = { status: 'completed', conclusion: 'success' as string | null, createdAt: at(3_600_000), updatedAt: at(3_000_000), url: '#' }
  return {
    name: 'mock-refresh',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/refresh', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return send(200, { configured: true, latest: run })
        if (run.status !== 'completed') return send(409, { configured: true, started: false, latest: run })
        const before = run
        setTimeout(() => {
          run = { status: 'in_progress', conclusion: null, createdAt: at(), updatedAt: at(), url: '#' }
          setTimeout(() => { run = { ...run, status: 'completed', conclusion: 'success', updatedAt: at() } }, 45_000)
        }, 4_000)
        send(202, { configured: true, started: true, latest: before })
      })
    },
  }
}

/** `MOCK_REFRESH=1 npm run dev` also stands in for functions/api/watchers.js: the list lives in memory, apps are
 *  looked up in the real App Store. Paste "fail" to see an error. */
function mockWatchers(): Plugin {
  let apps: { id: number; name: string; developer?: string; icon?: string; addedAt: string; addedBy: string }[] = []
  return {
    name: 'mock-watchers',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/watchers', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return send(200, { configured: true, apps })
        let raw = ''
        for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}')
        await new Promise(r => setTimeout(r, 600))
        if (body.op === 'remove') { apps = apps.filter(a => a.id !== body.id); return send(200, { configured: true, apps }) }
        const m = /\bid=?(\d{6,12})\b/.exec(String(body.app)) ?? /^(\d{6,12})$/.exec(String(body.app).trim())
        if (!m) return send(400, { configured: true, error: 'Paste an App Store link (…/id1234567890) or an app id' })
        const id = Number(m[1])
        const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=us&entity=software`).then(x => x.json()).catch(() => ({ results: [] }))
        const a = r.results?.[0]
        if (!a) return send(404, { configured: true, error: `No app with id ${id} in the App Store (US)` })
        if (!apps.some(x => x.id === id)) apps = [...apps, { id, name: a.trackName, developer: a.artistName, icon: a.artworkUrl100, addedAt: new Date().toISOString(), addedBy: 'you' }]
        send(200, { configured: true, apps, started: true })
      })
    },
  }
}

export default defineConfig({
  plugins: [preact(), ...(process.env.MOCK_REFRESH ? [mockRefresh(), mockWatchers()] : [])],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
})
