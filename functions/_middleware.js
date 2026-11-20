// Login for the whole site: every page, data file and preview deployment goes through this check.
// `wrangler pages deploy` picks up the `functions/` folder from the repo root automatically.
//
// Credentials live in the Pages project, not in the repo:
//   Workers & Pages → app-radar → Settings → Variables and Secrets → Secret `BASIC_AUTH` = "login:password"
// Several people: "anna:pass1, oleg:pass2" (passwords without commas). Set it for Production and Preview.
// Without the secret the site stays closed (503) rather than open.

const REALM = 'App Radar'

export async function onRequest({ request, env, next }) {
  const allowed = String(env.BASIC_AUTH ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.includes(':'))
  if (!allowed.length) {
    return new Response('Login is not configured: add the BASIC_AUTH secret to the Pages project.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const given = credentials(request.headers.get('Authorization'))
  if (given && allowed.some(pair => sameText(pair, given))) {
    const res = await next()
    const out = new Response(res.body, res)
    // pages behind a login must never sit in a shared cache
    out.headers.set('Cache-Control', 'private, no-cache')
    return out
  }
  return new Response('Login required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' },
  })
}

/** "Basic base64(login:password)" → "login:password" */
function credentials(header) {
  const [scheme, encoded] = String(header ?? '').split(' ')
  if (scheme !== 'Basic' || !encoded) return ''
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)))
  } catch {
    return ''
  }
}

/** compares without stopping at the first difference, so timing doesn't hint at the password */
function sameText(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
