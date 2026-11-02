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
//                                          here: the agent only ever holds a placeholder
//   /mcp/<name>/…                          an MCP server, with its header filled in from
//                                          the secret store
//
// The store is mounted read-only at /store: secrets/<name>, mcp/<name> ("url\nheader"),
// policy ("allow host" / "deny host" lines, *.example.com for a domain and its subdomains).
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect, isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const STORE = process.env.STORE || '/store'
const read = f => { try { return readFileSync(join(STORE, f), 'utf8').trim() } catch { return '' } }
const secret = n => /^[A-Za-z0-9:._-]+$/.test(n) ? read(join('secrets', n)) : ''

export function allowed (host, policy = read('policy')) {
  const rules = policy.split('\n').map(l => l.trim().split(/\s+/)).filter(r => r.length === 2 && ['allow', 'deny'].includes(r[0]))
  const hit = pat => pat.startsWith('*.') ? host === pat.slice(2) || host.endsWith(pat.slice(1)) : host === pat
  if (rules.some(([k, p]) => k === 'deny' && hit(p))) return false
  const allows = rules.filter(([k]) => k === 'allow')
  return !allows.length || allows.some(([, p]) => hit(p))
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
    if (m[1] === 'anthropic') return { url: 'https://api.anthropic.com' + rest, set: key ? { 'x-api-key': key } : {}, drop: key ? ['authorization'] : [] }
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

export function server () {
  const s = createServer((req, res) => {
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
