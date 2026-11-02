// What an agent's `docker compose` may start, under the Docker driver.
//
// The agent has no Docker of its own: its `docker compose …` is a request the host runs
// (bin/sbx-docker stack). The host renders the project's compose file with
// `docker compose config --format json` and pipes it through this, which refuses
// anything that reaches past the project and rewrites the rest to live inside the
// sandbox: every service shares the sandbox's network, so `localhost:<port>` from the
// agent works as it did under sbx, and nothing is published to the host (brain up's PORTS
// does that, through the sandbox). A service name from another service resolves because
// the host writes the names into the sandbox's /etc/hosts, which every service in its
// network shares (Docker refuses extra_hosts there, so a stack's own are dropped).
//
//   node stack.mjs <root> <sandbox-container> <sandbox>  < config.json  > rewritten.json
//
// Prints the reason and exits 1 when the stack asks for more than a project may have.
// A port mapping HOST:CONTAINER with HOST ≠ CONTAINER becomes a small forwarder service in
// the sandbox, so localhost:HOST still answers. Services and volumes carry the label
// agent-brain.stack=<sandbox>, which is how removing the sandbox finds them.
import { resolve, sep } from 'node:path'

export function rewrite (cfg, root, sandbox, owner = sandbox) {
  const no = []
  const inside = p => { const a = resolve(String(p)); return a === root || a.startsWith(root + sep) }
  const services = cfg.services || {}
  const forwards = []
  for (const [name, s] of Object.entries(services)) {
    const at = what => no.push(`service ${name}: ${what}`)
    if (s.privileged) at('privileged')
    for (const k of ['cap_add', 'devices', 'device_cgroup_rules', 'sysctls', 'security_opt', 'cgroup_parent', 'runtime', 'gpus']) if (s[k] && (Array.isArray(s[k]) ? s[k].length : Object.keys(s[k]).length || s[k] === true)) at(k)
    for (const k of ['pid', 'ipc', 'uts', 'userns_mode', 'cgroup']) if (s[k] && /host|container:|service:/.test(s[k])) at(`${k}: ${s[k]}`)
    if (s.network_mode && s.network_mode !== 'bridge' && s.network_mode !== 'default') at(`network_mode: ${s.network_mode}`)
    for (const v of s.volumes || []) {
      if (v.type === 'bind' && !inside(v.source)) at(`binds ${v.source}, outside the project`)
      if (String(v.source || '').includes('docker.sock')) at('mounts the Docker socket')
    }
    for (const e of s.env_file || []) { const f = typeof e === 'string' ? e : e.path; if (f && !inside(f)) at(`env_file ${f}, outside the project`) }
    for (const v of s.volumes_from || []) if (/^container:/.test(v)) at(`volumes_from ${v}`)
    const ctx = s.build && (typeof s.build === 'string' ? s.build : s.build.context)
    if (ctx && !/^[a-z]+:\/\//.test(ctx) && !inside(ctx)) at(`builds from ${ctx}, outside the project`)
    for (const c of Object.values(s.build?.additional_contexts || {})) if (!/^[a-z-]+:/.test(c) && !inside(c)) at(`build context ${c}, outside the project`)
    for (const p of s.ports || []) {
      const host = Number(p.published), target = Number(p.target)
      if (host && target && host !== target) forwards.push([host, target])
    }
    // Inside the sandbox: its network, its localhost; the other services by name.
    for (const k of ['ports', 'networks', 'links', 'hostname', 'domainname', 'dns', 'dns_search', 'mac_address', 'expose', 'extra_hosts']) delete s[k]
    s.network_mode = `container:${sandbox}`
    s.labels = { ...(Array.isArray(s.labels) ? Object.fromEntries(s.labels.map(l => l.split('='))) : s.labels), 'agent-brain.stack': owner }
  }
  for (const [kind, all] of [['secret', cfg.secrets], ['config', cfg.configs]]) {
    for (const [n, d] of Object.entries(all || {})) if (d.file && !inside(d.file)) no.push(`${kind} ${n}: file ${d.file}, outside the project`)
  }
  for (const [n, v] of Object.entries(cfg.volumes || {})) {
    if (v.driver_opts && Object.keys(v.driver_opts).length) no.push(`volume ${n}: driver_opts (a bind mount by another name)`)
    if (v.external) no.push(`volume ${n}: external`)
    v.labels = { ...(v.labels || {}), 'agent-brain.stack': owner }
  }
  delete cfg.networks
  for (const [h, c] of forwards) {
    services[`brain-forward-${h}`] = {
      image: process.env.NODE_IMG || 'node:22-alpine', network_mode: `container:${sandbox}`, restart: 'unless-stopped',
      command: ['node', '/app/forward.mjs', String(h), '127.0.0.1', String(c)],
      volumes: [{ type: 'bind', source: process.env.BRAIN_DOCKER_APP || '/app', target: '/app', read_only: true }],
      labels: { 'agent-brain.stack': owner }
    }
  }
  return { cfg, no }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root, sandbox, owner] = process.argv.slice(2)
  let raw = ''
  process.stdin.on('data', d => { raw += d }).on('end', () => {
    const { cfg, no } = rewrite(JSON.parse(raw), resolve(root), sandbox, owner)
    if (no.length) { console.error(`refused — a sandbox's stack may not have:\n  ${no.join('\n  ')}`); process.exit(1) }
    process.stdout.write(JSON.stringify(cfg))
  })
}
