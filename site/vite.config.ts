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

export default defineConfig({
  plugins: [preact(), ...(process.env.MOCK_REFRESH ? [mockRefresh()] : [])],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
})
