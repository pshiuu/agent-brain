// The way out of a Docker-driver sandbox, and the only holder of its keys.
//
// Every sandbox sits on an internal network with no route out; this proxy is on that
// network and on one that has one. It does three things, all read from the store on
// every request, so `brain secret set` or a policy change needs no restart:
//
//   CONNECT host:443 / GET http://host/…   egress, checked against policy (deny wins,
//                                          then allow; with no allow line, all is allowed).
//                                          Never this machine or its network: a loopback,
//                                          private or link-local address (the cockpit is one,
//                                          at host.docker.internal) is refused unless an
//                                          allow line names that host exactly. Checked on
//                                          the address the name resolves to, not the name.
//   /anthropic/…  /openai/…                the engines' APIs, with the real key put in
//                                          here: the agent only ever holds a placeholder.
//                                          /anthropic takes an API key, else a Claude
//                                          subscription token (claude setup-token)
//   /chatgpt/…  /openai-oauth/token        Codex on a ChatGPT subscription: the real tokens
//                                          live in /oauth/openai.json (writable, so they
//                                          can be refreshed here); Codex holds placeholders
//                                          and its own refresh comes here
//   /mcp/<name>/…                          an MCP server, with its header filled in from
//                                          the secret store
//
// The store is mounted read-only at /store: secrets/<name>, mcp/<name> ("url\nheader"),
// policy ("allow host" / "deny host" lines, *.example.com for a domain and its subdomains).
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect, isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const STORE = process.env.STORE || '/store'
const OAUTH = process.env.OAUTH_DIR || '/oauth'
const TOKEN_URL = process.env.OPENAI_TOKEN_URL || 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT = 'app_EMoamEEZ73f0CkXaXp7hrann'   // Codex's own OAuth client id
const read = f => { try { return readFileSync(join(STORE, f), 'utf8').trim() } catch { return '' } }
const secret = n => /^[A-Za-z0-9:._-]+$/.test(n) ? read(join('secrets', n)) : ''

export function allowed (host, policy = read('policy')) {
  const rules = policy.split('\n').map(l => l.trim().split(/\s+/)).filter(r => r.length === 2 && ['allow', 'deny'].includes(r[0]))
  const hit = pat => pat.startsWith('*.') ? host === pat.slice(2) || host.endsWith(pat.slice(1)) : host === pat
  if (rules.some(([k, p]) => k === 'deny' && hit(p))) return false
  const allows = rules.filter(([k]) => k === 'allow')
  return !allows.length || allows.some(([, p]) => hit(p))
}

// ---- Codex on a ChatGPT subscription ------------------------------------------------
const oauthFile = () => join(OAUTH, 'openai.json')
export function chatgptAuth () { try { return JSON.parse(readFileSync(oauthFile(), 'utf8')) } catch { return null } }
const claims = jwt => { try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url')) } catch { return {} } }
let refreshing = null
/** The real tokens, refreshed first when the access token is within five minutes of expiring
 *  (or when forced). Written back atomically: they are the only copy. */
export async function chatgptTokens (force = false) {
  const a = chatgptAuth()
  if (!a?.tokens?.refresh_token) return null
  const exp = claims(a.tokens.access_token).exp || 0
  if (!force && exp * 1000 > Date.now() + 300e3) return a.tokens
  refreshing ??= (async () => {
    const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CODEX_CLIENT, grant_type: 'refresh_token', refresh_token: a.tokens.refresh_token, scope: 'openid profile email' }) })
    if (!r.ok) throw new Error(`refresh failed: ${r.status} — sign in again with: brain secret set openai --oauth`)
    const t = await r.json()
    const next = { ...a, tokens: { ...a.tokens, ...Object.fromEntries(['id_token', 'access_token', 'refresh_token'].filter(k => t[k]).map(k => [k, t[k]])) }, last_refresh: new Date().toISOString() }
    writeFileSync(oauthFile() + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 }); renameSync(oauthFile() + '.tmp', oauthFile())
    return next.tokens
  })().finally(() => { refreshing = null })
  return refreshing
}
/** What Codex in a sandbox holds instead: the same claims, no signature, nothing it could use elsewhere. */
export function placeholderJwt (real) {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b({ alg: 'none', typ: 'JWT' })}.${b({ ...claims(real), exp: 4102444800 })}.YnJhaW4tZWdyZXNz`
}

/** Loopback, private, link-local, CGNAT, unspecified: anything that is not the internet. */
export function inside (ip) {
  const v = ip.replace(/^::ffff:/, '')
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  return /^(::1?|f[cd]|fe[89ab])/i.test(v)
}
const named = (host, policy = read('policy')) => policy.split('\n').some(l => l.trim() === `allow ${host}`)
// A DNS lookup that refuses an inside address, for every connection that leaves.
const guarded = host => (h, opts, cb) => dnsLookup(h, opts, (err, addr, fam) => {
  if (err) return cb(err)
  const all = Array.isArray(addr) ? addr : [{ address: addr, family: fam }]
  if (!named(host) && all.some(a => inside(a.address))) return cb(Object.assign(new Error(`${host} is on this machine's network`), { code: 'EINSIDE' }))
  cb(null, addr, fam)
})
const literalInside = host => isIP(host.replace(/^\[|\]$/g, '')) && inside(host.replace(/^\[|\]$/g, '')) && !named(host)

/** Where a request to this proxy's own paths goes, and with which headers changed. */
export function route (path) {
  const m = path.match(/^\/(anthropic|openai)(\/.*)?$/)
  if (m) {
    const key = secret(m[1]), rest = m[2] || '/'
    if (m[1] === 'anthropic') {
      if (key) return { url: 'https://api.anthropic.com' + rest, set: { 'x-api-key': key }, drop: ['authorization'] }
      const sub = secret('anthropic-oauth')
      return { url: 'https://api.anthropic.com' + rest, set: sub ? { authorization: `Bearer ${sub}` } : {}, drop: sub ? ['x-api-key'] : [] }
    }
    return { url: 'https://api.openai.com' + rest, set: key ? { authorization: `Bearer ${key}` } : {}, drop: [] }
  }
  const mcp = path.match(/^\/mcp\/([A-Za-z0-9][A-Za-z0-9._-]*)(\/.*)?$/)
  if (mcp) {
    const [url = '', header = ''] = read(join('mcp', mcp[1])).split('\n')
    if (!url) return null
    const set = {}
    const h = header.match(/^([^:]+):\s*(.*)$/)
    if (h) set[h[1].toLowerCase()] = h[2].replace(/\$\{token\}/g, () => secret(`mcp:${mcp[1]}:token`))
    return { url: url.replace(/\/$/, '') + (mcp[2] && mcp[2] !== '/' ? mcp[2] : ''), set, drop: [] }
  }
  return null
}

function forward (req, res, target, set = {}, drop = [], guard = false) {
  const u = new URL(target)
  const headers = { ...req.headers, host: u.host }
  for (const k of ['proxy-connection', 'proxy-authorization', ...drop]) delete headers[k]
  Object.assign(headers, set)
  const out = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method: req.method, headers, ...(guard && { lookup: guarded(u.hostname) }) }, up => {
    up.on('error', () => res.destroy())
    res.writeHead(up.statusCode, up.headers); up.pipe(res)
  })
  req.on('error', () => out.destroy()); res.on('error', () => out.destroy())
  out.on('error', e => { if (!res.headersSent) res.writeHead(502); res.end(`egress: ${e.message}\n`) })
  req.pipe(out)
}

async function chatgpt (req, res) {
  try {
    // The auth.json a sandbox's Codex gets: the account's claims, placeholder tokens.
    if (req.url.startsWith('/openai-oauth/placeholder')) {
      const a = chatgptAuth()
      if (!a?.tokens) { res.writeHead(404); return res.end('{}') }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, last_refresh: new Date().toISOString(),
        tokens: { id_token: placeholderJwt(a.tokens.id_token), access_token: placeholderJwt(a.tokens.access_token), refresh_token: 'brain-egress', account_id: a.tokens.account_id } }))
    }
    if (req.url.startsWith('/openai-oauth/token')) {
      const t = await chatgptTokens(true)
      if (!t) { res.writeHead(401); return res.end('{"error":"not signed in: brain secret set openai --oauth"}') }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id_token: placeholderJwt(t.id_token), access_token: placeholderJwt(t.access_token), refresh_token: 'brain-egress' }))
    }
    const t = await chatgptTokens()
    if (!t) { res.writeHead(401); return res.end('egress: not signed in to ChatGPT — brain secret set openai --oauth\n') }
    const set = { authorization: `Bearer ${t.access_token}` }
    if (t.account_id) set['chatgpt-account-id'] = t.account_id
    forward(req, res, 'https://chatgpt.com/backend-api' + req.url.replace(/^\/chatgpt/, ''), set)
  } catch (e) { if (!res.headersSent) res.writeHead(502); res.end(`egress: ${e.message}\n`) }
}

export function server () {
  const s = createServer((req, res) => {
    if (/^\/(chatgpt(\/|$)|openai-oauth\/(token|placeholder))/.test(req.url)) return chatgpt(req, res)
    if (req.url.startsWith('/')) {
      const r = route(req.url)
      if (!r) { res.writeHead(404); return res.end('egress: no such route\n') }
      return forward(req, res, r.url, r.set, r.drop)
    }
    let u; try { u = new URL(req.url) } catch { res.writeHead(400); return res.end('egress: bad request\n') }
    if (!allowed(u.hostname) || literalInside(u.hostname)) { res.writeHead(403); return res.end(`egress: ${u.hostname} is not allowed by the brain's network policy\n`) }
    forward(req, res, req.url, {}, [], true)
  })
  s.on('connect', (req, sock, head) => {
    sock.on('error', () => sock.destroy())
    const [host, port = '443'] = req.url.split(/:(?=\d+$)/)
    if (!allowed(host) || literalInside(host)) { sock.end(`HTTP/1.1 403 Forbidden\r\n\r\negress: ${host} is not allowed\r\n`); return }
    const up = connect({ port: Number(port), host, lookup: guarded(host) }, () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head); up.pipe(sock); sock.pipe(up) })
    up.on('error', () => sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')); sock.on('error', () => up.destroy())
  })
  s.on('clientError', (e, sock) => sock.destroy())
  return s
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Every sandbox's only way out: one connection that breaks oddly must not take it down.
  process.on('uncaughtException', e => console.error(`egress: ${e.code || ''} ${e.message}`))
  server().listen(Number(process.env.PORT || 3128), '0.0.0.0', () => console.log('egress listening on 3128'))
}
