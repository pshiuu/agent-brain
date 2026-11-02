// agent-brain cockpit. Observes and edits; the terminal executes.
// No dependencies beyond node: built-ins, no build step.
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, watch, mkdirSync } from 'node:fs'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as brain from './brain.mjs'
import { HttpError, BRAIN, safePath } from './brain.mjs'

const PORT = Number(process.env.PORT || 7777)
const HOST = process.env.HOST || '127.0.0.1'
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public')
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain', '.map': 'application/json' }

const body = req => new Promise((ok, no) => {
  let b = ''
  req.on('data', c => { b += c; if (b.length > 1e7) { no(new HttpError(413, 'too large')); req.destroy() } })
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch { no(new HttpError(400, 'bad JSON')) } })
})

/* Skill discovery for the Add-from-repo flow.
   The name that goes into skills.list is the SKILL.md `name:` field, NOT the directory:
   Leonxlnx/taste-skill ships `output-skill/` whose name is `full-output-enforcement`.
   Offering directory names would write entries that install nothing and then get pruned,
   so the frontmatter is read for real. */
const GH_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
export const normalizeRepo = raw => String(raw || '').trim()
  .replace(/^git@github\.com:/, '').replace(/^https?:\/\/(www\.)?github\.com\//, '')
  .replace(/\.git$/, '').replace(/\/+$/, '')

const grab = async (url, as = 'json') => {
  const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { 'user-agent': 'agent-brain-cockpit', accept: as === 'json' ? 'application/vnd.github+json' : 'text/plain' } })
  if (!r.ok) return { status: r.status, body: null }
  return { status: 200, body: as === 'json' ? await r.json() : await r.text() }
}

async function skillRepo (raw) {
  const repo = normalizeRepo(raw)
  // The repo is never interpolated into a caller-supplied URL: the owner/repo shape is
  // validated and the GitHub URLs are built here.
  if (!GH_REPO.test(repo)) throw new HttpError(400, `'${raw}' is not a GitHub owner/repo. Other hosts work in skills.list, you just have to type the skill names yourself.`)
  let tree = null, branch = null
  for (const b of ['main', 'master']) {
    const r = await grab(`https://api.github.com/repos/${repo}/git/trees/${b}?recursive=1`).catch(() => ({ status: 0 }))
    if (r.status === 200 && r.body?.tree) { tree = r.body.tree; branch = b; break }
    if (r.status === 403) throw new HttpError(429, 'GitHub rate limit reached. Wait a few minutes, or type the skill names by hand.')
  }
  if (!tree) throw new HttpError(404, `Could not read ${repo}. Private repos are fine in skills.list (sbx clones them with your git credentials), but this lookup only sees public ones.`)

  const files = tree.filter(t => /(^|\/)SKILL\.md$/i.test(t.path)).slice(0, 60)
  if (!files.length) throw new HttpError(404, `${repo} has no SKILL.md anywhere, so it is not a skills repo.`)
  const skills = await Promise.all(files.map(async f => {
    const dir = f.path.replace(/\/?SKILL\.md$/i, '').split('/').pop() || repo.split('/')[1]
    const r = await grab(`https://raw.githubusercontent.com/${repo}/${branch}/${f.path}`, 'text').catch(() => ({ body: null }))
    const fm = r.body?.match(/^---\n([\s\S]*?)\n---/)
    const field = k => {
      if (!fm) return ''
      const m = fm[1].match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'))
      if (!m) return ''
      let v = m[1].trim()
      // YAML block scalar (`description: >` or `|`): the value is the indented lines below.
      if (/^[|>][-+]?$/.test(v)) {
        const rest = fm[1].slice(m.index + m[0].length).split('\n').slice(1)
        const out = []
        for (const l of rest) { if (!l.trim()) { out.push(''); continue } if (!/^\s/.test(l)) break; out.push(l.trim()) }
        v = out.join(' ').trim()
      }
      return v.replace(/^["']|["']$/g, '')
    }
    return { name: field('name') || dir, dir, description: field('description'), named: !!field('name') }
  }))
  return { repo, branch, skills: skills.sort((a, b) => a.name.localeCompare(b.name)) }
}

/* Live updates without a refresh, and without a framework or a socket library.
   Server-Sent Events is one-way server-to-client over plain HTTP, which is exactly the
   shape of this problem: bin/brain writes marker files, the cockpit wants to know. The
   watch is on the trees brain writes — memory/ for run state, system/ for roles and
   playbooks, .drafts/ for the author finishing a draft — debounced, because a QA run writes dozens of PNGs in a burst
   and each one is a filesystem event nobody needs to hear about separately. */
const liveClients = new Set()
let liveTimer = null
// At most one event per 350ms, sent 350ms after the first change. Not a trailing debounce:
// an agent writing more often than that for minutes on end held one off for the whole run.
function liveBump () {
  if (liveTimer) return
  liveTimer = setTimeout(() => {
    liveTimer = null
    for (const res of liveClients) { try { res.write('data: change\n\n') } catch {} }
  }, 350)
}
// A comment line every 25s, which EventSource ignores. A run can leave the stream silent
// for many minutes, and an idle connection gets dropped somewhere between the browser and
// this container without either end hearing about it; the page then stops updating until a
// reload. Traffic keeps it open, and a dead one now fails loudly so the browser reconnects.
setInterval(() => { for (const res of liveClients) { try { res.write(': ping\n\n') } catch {} } }, 25000).unref()
mkdirSync(join(BRAIN, '.drafts'), { recursive: true }) // gitignored; watched before the first draft exists
for (const dir of [join(BRAIN, 'memory'), join(BRAIN, 'system'), join(BRAIN, '.drafts')]) {
  // recursive watch needs Node 20+ on Linux; a failure here costs live updates, not the
  // cockpit, so it degrades to the refresh button it has always had.
  // Not memory/.watch being rewritten: brain watch does that every 2 seconds to say it is
  // listening, and passing it on rebuilt every open page every 2 seconds. Its creation and
  // removal are 'rename' events and still go out, so a watcher starting or stopping shows.
  try { watch(dir, { recursive: true }, (ev, f) => { if (!(ev === 'change' && f === '.watch')) liveBump() }) } catch (e) { console.warn(`live updates off for ${dir}: ${e.message}`) }
}

const routes = {
  'GET /api/skill-repo': ({ q }) => skillRepo(q.get('repo')),
  'GET /api/state': () => brain.state(),
  'GET /api/file': ({ q }) => brain.readTracked(q.get('path')),
  'PUT /api/file': ({ q, b }) => brain.writeTracked(q.get('path'), b.content, b.prev),
  'GET /api/prompt': ({ q }) => brain.promptPreview(q.get('project'), q.get('phase')),
  'GET /api/brandkit': ({ q }) => brain.brandkit(q.get('project')),
  'GET /api/design': ({ q }) => brain.design(q.get('project')),
  'GET /api/article': ({ q }) => brain.article(q.get('project')),
  'POST /api/role': ({ b }) => {
    const rel = brain.roleConfRel(b.role)
    const { content } = brain.readTracked(rel)
    return brain.writeTracked(rel, brain.setRoleLine(content, b.role, b.engine, b.model, b.effort), content)
  },
  'POST /api/section': ({ b }) => {
    const rel = `${brain.playbookRel(b.playbook)}/playbook.md`
    const { content } = brain.readTracked(rel)
    if (typeof b.prev === 'string' && b.prev !== content) throw new HttpError(409, 'file changed on disk since you loaded it')
    return brain.writeTracked(rel, brain.replaceSection(content, b.phase, b.body), content)
  },
  'POST /api/source': ({ b }) => brain.addSource(b),
  'DELETE /api/skill-source': ({ b }) => brain.removeBaseSkillSource(b.name),
  'DELETE /api/skill': ({ b }) => {
    if (b.confirm !== b.dir) throw new HttpError(400, 'type the skill directory to confirm')
    return brain.deleteOwnSkill(b.dir)
  },
  'POST /api/role-new': ({ b }) => brain.createRole(b),
  'DELETE /api/role': ({ b }) => {
    if (b.confirm !== b.name) throw new HttpError(400, 'type the role name to confirm')
    return brain.deleteRole(b.name)
  },
  'POST /api/phase-role': ({ b }) => {
    const rel = `${brain.playbookRel(b.playbook)}/phases`
    const { content } = brain.readTracked(rel)
    return brain.writeTracked(rel, brain.setPhaseRole(content, b.phase, b.role, b.fix), content)
  },
  'POST /api/playbook': ({ b }) => brain.createPlaybook(b),
  'DELETE /api/playbook': ({ b }) => {
    if (b.confirm !== b.name) throw new HttpError(400, 'type the playbook name to confirm')
    return brain.deletePlaybook(b.name)
  },
  'POST /api/skill-source': ({ b }) => {
    const rel = 'system/skills.list'
    const { content } = brain.readTracked(rel)
    return brain.writeTracked(rel, brain.addSkillSource(content, b.repo, b.names || []), content)
  },
  'POST /api/role-skills': ({ b }) => {
    const rel = brain.roleDocRel(String(b.role || '').replace(/[^A-Za-z0-9._-]/g, ''))
    const { content } = brain.readTracked(rel)
    return brain.writeTracked(rel, brain.setRoleSkills(content, b.skills || []), content)
  },
  'POST /api/proposal': ({ b }) => {
    const rel = 'memory/proposals.md'
    const { content } = brain.readTracked(rel)
    return brain.writeTracked(rel, brain.moveProposal(content, b.line, b.from, b.to), content)
  },
  // The no-terminal doors: each stages a request that `brain watch` acts on.
  'GET /api/brief-form': ({ q }) => brain.briefForm(q.get('playbook')),
  'POST /api/project': ({ b }) => brain.createProject(b),
  'POST /api/inputs': ({ b }) => brain.setInputs(b),
  'GET /api/client-inputs': ({ q }) => brain.clientInputs(q.get('client'), q.get('playbook')),
  'POST /api/client-inputs': ({ b }) => brain.saveClientInputs(b),
  'DELETE /api/project-pending': ({ b }) => brain.discardPending(b.name),
  'POST /api/run': ({ b }) => brain.startRun(b.project, b.then),
  'POST /api/draft': ({ b }) => brain.requestDraft(b),
  'GET /api/draft': ({ q }) => brain.draft(q.get('name')),
  'POST /api/draft-install': ({ b }) => brain.installDraft(b),
  'DELETE /api/draft': ({ b }) => {
    if (b.confirm !== b.name) throw new HttpError(400, 'type the draft name to confirm')
    return brain.discardDraft(b.name)
  },
  'POST /api/app-secret': ({ b }) => brain.saveAppSecret(b),
  'POST /api/app-settings': ({ b }) => brain.saveAppSettings(b),
  'POST /api/apps': ({ b }) => brain.requestApps(b),
  'GET /api/app-readme': ({ q }) => brain.appReadme(q.get('name')),
  'POST /api/evolve': ({ b }) => brain.requestEvolve(b.playbook || ''),
  'POST /api/analyse': ({ b }) => brain.requestAnalysis(b.playbook),
  'POST /api/approve': ({ b }) => brain.approve(b.project, b.phase, b.note || '', b.then || '', Array.isArray(b.defer) ? b.defer.map(String) : []),
  'POST /api/reject': ({ b }) => brain.reject(b.project, b.phase, b.items || [], b.note || '', b.then || ''),
  'POST /api/reopen': ({ b }) => brain.reopen(b.project, b.phase, b.items || [], b.then || ''),
  'GET /api/knowledge-graph': () => brain.knowledgeGraph(),
  // An app's Studio code (ui/main.js): read what belongs to it, stage what it wants done.
  'POST /api/app-read': ({ b }) => brain.appRead(b),
  'POST /api/app-request': ({ b }) => brain.appRequest(b)
}

function serveFile (abs, res) {
  if (!existsSync(abs) || !statSync(abs).isFile()) return false
  res.writeHead(200, { 'content-type': MIME[extname(abs)] || 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(readFileSync(abs))
  return true
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  // no-store like serveFile: a heuristically cached /api/state shows a gate you just cleared.
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)) }
  try {
    const handler = routes[`${req.method} ${url.pathname}`]
    if (handler) return send(200, await handler({ q: url.searchParams, b: req.method === 'GET' ? {} : await body(req) }) ?? {})

    // QA screenshots. brain-shoot records host-absolute paths, so the client asks by
    // project/run/filename and we rebuild the path under the mount.
    const qa = url.pathname.match(/^\/qa\/([^/]+)\/([^/]+)\/([^/]+)$/)
    if (req.method === 'GET' && qa) {
      const abs = safePath(`memory/projects/${qa[1]}/qa/${qa[2]}/${qa[3]}`)
      if (serveFile(abs, res)) return
      return send(404, { error: 'no such screenshot' })
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write('retry: 3000\n\n')
      liveClients.add(res)
      req.on('close', () => liveClients.delete(res))
      return
    }

    // An app's own Studio files: ui/main.js and whatever it imports, from system/apps/<app>/ui/.
    const ap = url.pathname.match(/^\/apps\/([^/]+)\/(.+)$/)
    if (req.method === 'GET' && ap) {
      if (serveFile(brain.appUiFile(decodeURIComponent(ap[1]), decodeURIComponent(ap[2])), res)) return
      return send(404, { error: 'no such app file' })
    }
    // Brandkit artwork, which lives in the project repo rather than in brain memory.
    const bk = url.pathname.match(/^\/brandkit\/([^/]+)\/(.+)$/)
    if (req.method === 'GET' && bk) {
      const abs = brain.brandkitFile(decodeURIComponent(bk[1]), decodeURIComponent(bk[2]))
      if (serveFile(abs, res)) return
      return send(404, { error: 'no such brandkit file' })
    }

    // The built design, served whole so its css, fonts and images resolve — the point is
    // to open the real page instead of looking at a picture of it. Sandboxed: this is
    // agent-written HTML and script, and without an opaque origin it would run inside
    // the cockpit's own origin, next to the endpoints that edit system/ and memory/.
    const dz = url.pathname.match(/^\/design\/([^/]+)\/(.+)$/)
    if (req.method === 'GET' && dz) {
      const abs = brain.projectFile(decodeURIComponent(dz[1]), 'design', decodeURIComponent(dz[2]))
      if (existsSync(abs) && statSync(abs).isFile()) {
        res.writeHead(200, {
          'content-type': MIME[extname(abs)] || 'application/octet-stream',
          'cache-control': 'no-store',
          'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups',
          // The sandbox above gives the page an opaque origin, which makes its own
          // webfonts a cross-origin fetch — without this they are CORS-blocked and the
          // design renders in fallback type, which is the one thing you came to judge.
          'access-control-allow-origin': '*'
        })
        return res.end(readFileSync(abs))
      }
      return send(404, { error: 'no such design file' })
    }

    if (req.method === 'GET') {
      // Two front ends on one API: the Studio at / and the engine room at /admin.
      const rel = url.pathname === '/' ? 'index.html' : /^\/admin\/?$/.test(url.pathname) ? 'admin.html' : url.pathname.slice(1)
      const abs = resolve(PUBLIC, rel)
      if (abs.startsWith(PUBLIC + '/') && serveFile(abs, res)) return
      if (serveFile(join(PUBLIC, 'index.html'), res)) return // client-side routing
    }
    send(404, { error: 'not found' })
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e)
    send(e.status || 500, { error: e.message || 'server error' })
  }
}).listen(PORT, HOST, () => {
  console.log(`agent-brain cockpit  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  console.log(`brain: ${BRAIN}   projects: ${brain.projects().length}   lint: ${brain.lint().length}`)
})
