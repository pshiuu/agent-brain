// The Docker driver's two trust decisions, without Docker: what an agent's compose stack
// may have (bin/docker/stack.mjs), and what the egress proxy lets out and puts in
// (bin/docker/egress.mjs). bin/sbx-docker itself is exercised against a real Docker by hand.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const store = mkdtempSync(join(tmpdir(), 'egress-'))
process.env.STORE = store
const { rewrite } = await import('../bin/docker/stack.mjs')
const { allowed, route, server, inside } = await import('../bin/docker/egress.mjs')
let n = 0
const it = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`) }

console.log('stack: what a sandbox\'s docker compose may start')
const root = '/Users/x/dev/site'
const svc = extra => ({ services: { web: { image: 'node', ports: [{ published: '3000', target: 3000 }], networks: { default: null }, ...extra } } })
it('a plain stack runs inside the sandbox: its network, no ports', () => {
  const { cfg, no } = rewrite({ services: { db: { image: 'mongo', ports: [{ published: '27018', target: 27017 }] }, app: { image: 'node', volumes: [{ type: 'bind', source: root + '/src' }] } }, networks: { default: {} } }, root, 'sbx-site-claude', 'site-claude')
  assert.deepEqual(no, [])
  assert.equal(cfg.services.db.network_mode, 'container:sbx-site-claude')
  assert.equal(cfg.services.db.ports, undefined); assert.equal(cfg.networks, undefined)
  assert.equal(cfg.services.app.extra_hosts, undefined, 'Docker refuses extra_hosts in a shared network; the names go in the sandbox\'s /etc/hosts')
  assert.equal(cfg.services.db.labels['agent-brain.stack'], 'site-claude')
  assert.deepEqual(cfg.services['brain-forward-27018'].command.slice(2), ['27018', '127.0.0.1', '27017'], 'HOST≠CONTAINER keeps answering on HOST')
})
for (const [what, extra] of [
  ['privileged', { privileged: true }],
  ['cap_add', { cap_add: ['SYS_ADMIN'] }],
  ['devices', { devices: ['/dev/kmsg'] }],
  ['security_opt', { security_opt: ['seccomp=unconfined'] }],
  ['pid: host', { pid: 'host' }],
  ['network_mode: host', { network_mode: 'host' }],
  ['a bind outside the project', { volumes: [{ type: 'bind', source: '/Users/x' }] }],
  ['the Docker socket', { volumes: [{ type: 'bind', source: root + '/../../../var/run/docker.sock' }] }],
  ['a build context outside', { build: { context: '/Users/x/.ssh' } }],
  ['an env_file outside', { env_file: [{ path: '/Users/x/.aws/credentials' }] }],
  ['volumes_from another container', { volumes_from: ['container:agent-brain-local-cockpit-1'] }]
]) it(`refuses ${what}`, () => assert.ok(rewrite(svc(extra), root, 'c').no.length, what))
it('refuses a volume that is a bind mount by another name, and secrets from outside', () => {
  assert.ok(rewrite({ services: {}, volumes: { v: { driver_opts: { type: 'none', o: 'bind', device: '/etc' } } } }, root, 'c').no.length)
  assert.ok(rewrite({ services: {}, secrets: { s: { file: '/Users/x/.netrc' } } }, root, 'c').no.length)
})

console.log('egress: the policy and the keys')
it('no allow line: everything but what is denied', () => {
  assert.equal(allowed('github.com', ''), true)
  assert.equal(allowed('pastebin.com', 'deny pastebin.com'), false)
  assert.equal(allowed('x.ngrok.io', 'deny *.ngrok.io'), false)
})
it('with allow lines: only those, and deny still wins', () => {
  const p = 'allow *.npmjs.org\nallow api.anthropic.com\ndeny bad.npmjs.org'
  assert.equal(allowed('registry.npmjs.org', p), true)
  assert.equal(allowed('npmjs.org', p), true)
  assert.equal(allowed('github.com', p), false)
  assert.equal(allowed('bad.npmjs.org', p), false)
  assert.equal(allowed('evilnpmjs.org', p), false, 'a suffix is not a subdomain')
})
mkdirSync(join(store, 'secrets')); mkdirSync(join(store, 'mcp'))
it('the engines\' keys are put in here, and only when stored', () => {
  assert.deepEqual(route('/anthropic/v1/messages').set, {})
  writeFileSync(join(store, 'secrets/anthropic'), 'sk-ant-real\n'); writeFileSync(join(store, 'secrets/openai'), 'sk-oa')
  const a = route('/anthropic/v1/messages')
  assert.equal(a.url, 'https://api.anthropic.com/v1/messages'); assert.equal(a.set['x-api-key'], 'sk-ant-real')
  assert.equal(route('/openai/v1/responses').set.authorization, 'Bearer sk-oa')
})
it('an MCP server gets its header filled from the store; an unknown one is no route', () => {
  writeFileSync(join(store, 'mcp/dataforseo'), 'https://mcp.dataforseo.com/http\nAuthorization: Basic ${token}\n')
  writeFileSync(join(store, 'secrets/mcp:dataforseo:token'), 'bG9naW46cHc=')
  const r = route('/mcp/dataforseo')
  assert.equal(r.url, 'https://mcp.dataforseo.com/http'); assert.equal(r.set.authorization, 'Basic bG9naW46cHc=')
  assert.equal(route('/mcp/nope'), null); assert.equal(route('/mcp/../secrets'), null)
})

// The proxy end to end: a forward request to a denied host is refused before it leaves.
const up = createServer((q, s) => s.end('upstream')).listen(0)
const px = server().listen(0)
writeFileSync(join(store, 'policy'), 'deny 127.0.0.2\nallow 127.0.0.1\nallow *\n')
const get = (url, host) => new Promise(ok => {
  import('node:http').then(({ request }) => request({ port: px.address().port, path: url, headers: { host } }, r => { let b = ''; r.on('data', d => { b += d }).on('end', () => ok([r.statusCode, b])) }).end())
})
const [code] = await get(`http://127.0.0.2:${up.address().port}/`, '127.0.0.2')
const [ok, body] = await get(`http://127.0.0.1:${up.address().port}/`, '127.0.0.1')
writeFileSync(join(store, 'policy'), '')
const [mine] = await get(`http://127.0.0.1:${up.address().port}/`, '127.0.0.1')
const [named] = await get(`http://localhost:${up.address().port}/`, 'localhost')
it('a denied host gets a 403 from the proxy; an allowed one goes through', () => {
  assert.equal(code, 403); assert.deepEqual([ok, body], [200, 'upstream'])
})
it('this machine is never reachable unless an allow line names it: by address or by a name that resolves to it', () => {
  assert.equal(mine, 403); assert.equal(named, 502, 'localhost resolves inside, so the lookup refuses it')
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.65.254', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1']) assert.ok(inside(ip), ip)
  for (const ip of ['1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.ok(!inside(ip), ip)
})
up.close(); px.close()
console.log(`\n${n} checks passed`)
