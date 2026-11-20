// `node tests/auth.test.mjs` — checks of the site login (functions/_middleware.js) with fake requests.
import { onRequest } from '../functions/_middleware.js'
let failed = 0
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}`) }
const page = async () => new Response('<html>dashboard</html>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' } })
const req = auth => new Request('https://app-radar.example/data/index.json', { headers: auth ? { Authorization: auth } : {} })
const basic = s => 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const env = { BASIC_AUTH: 'anna:s3cret-pass, oleg:Пароль-2' }

let r = await onRequest({ request: req(), env, next: page })
check('no credentials → 401 with a login prompt', r.status === 401 && r.headers.get('WWW-Authenticate')?.startsWith('Basic realm="App Radar"'))
r = await onRequest({ request: req(basic('anna:wrong')), env, next: page })
check('wrong password → 401', r.status === 401)
r = await onRequest({ request: req(basic('anna:s3cret-pass')), env, next: page })
check('right login → page served', r.status === 200 && (await r.text()).includes('dashboard'))
r = await onRequest({ request: req(basic('anna:s3cret-pass')), env, next: page })
check('served page is never cached publicly', r.headers.get('Cache-Control') === 'private, no-cache')
r = await onRequest({ request: req(basic('oleg:Пароль-2')), env, next: page })
check('second user with a non-Latin password works', r.status === 200)
r = await onRequest({ request: req(basic('anna:s3cret-pass')), env: {}, next: page })
check('secret missing → site closed (503), not open', r.status === 503)
r = await onRequest({ request: req('Basic %%%not-base64'), env, next: page })
check('garbage header → 401, no crash', r.status === 401)
r = await onRequest({ request: req('Bearer abc'), env, next: page })
check('other auth schemes → 401', r.status === 401)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
