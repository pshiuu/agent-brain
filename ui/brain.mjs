// Read and write every agent-brain format. Mirrors the parsing in bin/brain exactly —
// where bin/brain uses awk, we use the same field rules, including its blind spots,
// which the lint below reports instead of silently papering over.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, renameSync, unlinkSync, appendFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, copyFileSync } from 'node:fs'
import { resolve, join, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BRAIN = process.env.BRAIN_DIR || '/brain'
export const DEV = process.env.DEV_MOUNT || '/dev-projects'
export const HOST_BRAIN = process.env.HOST_BRAIN || `${process.env.HOME || '~'}/agent-brain`
export const HOST_DEV = process.env.HOST_DEV || `${process.env.HOME || '~'}/dev`
const MAX_FIX_LOOPS = Number(process.env.BRAIN_MAX_FIX_LOOPS || 3)

const SYS = join(BRAIN, 'system')
const MEM = join(BRAIN, 'memory')
// BRAIN.md:34 defines a review phase by its ROLE, not its phase name: 'roles ending in
// -reviewer, and qa'. rebuild-website's `audit` phase runs site-auditor, a discovery role
// with no RESULT contract, and correctly has no fix-role.
const REVIEW_ROLE = /-reviewer$|^qa$/

// Mirrors bin/phase-contract.sh; these files remain optional, plain-text system
// configuration. Only the host launcher executes their sandbox checks.
export function contractProblems (text) {
  const errors = []
  text.split('\n').forEach((line, i) => {
    const s = line.replace(/^[ \t]+|[ \t]+$/g, '')
    if (!s || s.startsWith('#')) return
    const [, kind, value = ''] = s.match(/^(\S+)(?:[ \t]+(.*))?$/) || []
    if (['input', 'output', 'evidence'].includes(kind)) {
      if (!/^(project|memory):/.test(value)) errors.push([i + 1, 'use project: or memory: before a relative file'])
      else if (('/' + value.slice(value.indexOf(':') + 1) + '/').split('/').slice(1, -1).some(p => !p || p === '.' || p === '..')) errors.push([i + 1, 'empty, absolute or traversing file path'])
    } else if (kind === 'check') {
      const check = value.match(/^([1-9][0-9]{0,4})[ \t]+(.+)$/)
      if (!check || Number(check[1]) > 86400) errors.push([i + 1, 'check needs seconds (1..86400) and a command'])
    } else errors.push([i + 1, `unknown contract directive '${kind}'`])
  })
  return errors
}
const SAFE_ENV = /^[A-Za-z0-9._:/@+-]*$/

// Claude documents its aliases in `claude --help`: fable, opus, sonnet (plus haiku),
// or a full model name. Any string is allowed through, so a name not listed here still
// works; these are suggestions, not a whitelist.
const CLAUDE_MODELS = ['default', 'fable', 'opus', 'sonnet', 'haiku']
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] // claude --help
// Used only when the codex catalog is not mounted.
const CODEX_FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const CODEX_CATALOG = process.env.CODEX_MODELS || '/codex-models.json'

let catalogCache = { at: -1, models: [], fetched: '' }

/** Codex's own model list, from the cache its CLI maintains at
 *  ~/.codex/models_cache.json. Mounting it beats hardcoding: the list and each model's
 *  reasoning levels change with the CLI, and they really do differ per model
 *  (gpt-5.5 stops at xhigh, gpt-6-astra goes to ultra). visibility "hide" marks
 *  internal entries like codex-auto-review. */
function codexCatalog () {
  let at = 0
  try { at = statSync(CODEX_CATALOG).mtimeMs } catch { return { models: [], fetched: '' } }
  if (at === catalogCache.at) return catalogCache
  try {
    const d = JSON.parse(readFileSync(CODEX_CATALOG, 'utf8'))
    catalogCache = {
      at,
      fetched: String(d.fetched_at || '').slice(0, 10),
      models: (d.models || [])
        .filter(m => m.visibility === 'list' && m.slug)
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
        .map(m => ({
          slug: m.slug,
          label: m.display_name || m.slug,
          description: m.description || '',
          efforts: (m.supported_reasoning_levels || []).map(l => l && l.effort).filter(Boolean),
          defaultEffort: m.default_reasoning_level || '',
          context: m.context_window || null
        }))
    }
  } catch { catalogCache = { at, models: [], fetched: '' } }
  return catalogCache
}

/** The agents, from system/engines.conf (bin/brain's engine_line), each with whether this
 *  brain installed it (BRAIN_ENGINES). Declared before any model list reads it. */
export function engines () {
  const on = setting('BRAIN_ENGINES', 'claude codex').split(/[\s,]+/).filter(Boolean)
  return (read(join(SYS, 'engines.conf')) || '').split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => l.trim().split(/\s+/)).filter(f => f.length >= 5)
    .map(([name, template, role, efforts, ...label]) => ({ name, template, role, efforts: efforts === '-' ? [] : efforts.split(','), label: label.join(' '), on: on.includes(name) }))
}
const engineNames = () => engines().map(e => e.name)

/** What each subscription has left, as its own CLI last reported it (bin/brain usage_file):
 *  Claude's statusline input, Codex's session-log line, in memory/projects/.usage/. An
 *  engine on an API key reports nothing and is left out. */
export function usage () {
  const out = {}
  for (const { name } of engines()) {
    const f = join(MEM, 'projects', '.usage', `${name}.json`)
    let j; try { j = JSON.parse(read(f)) } catch { continue }
    const rl = j?.rate_limits || j?.payload?.rate_limits
    if (!rl) continue
    const win = (w, label) => w && { label, used: w.used_percentage ?? w.used_percent, resetsAt: w.resets_at * 1000 }
    const windows = [win(rl.five_hour || rl.primary, '5 hours'), win(rl.seven_day || rl.secondary, 'Week')].filter(Boolean)
    if (windows.length) out[name] = { at: mtime(f), windows }
  }
  return out
}

export function models () {
  const cat = codexCatalog()
  const codexEfforts = [...new Set(cat.models.flatMap(m => m.efforts))]
  return {
    claude: {
      options: CLAUDE_MODELS.map(slug => ({ slug, label: slug, description: '', efforts: CLAUDE_EFFORTS })),
      efforts: CLAUDE_EFFORTS,
      source: 'claude --help'
    },
    codex: {
      options: [{ slug: 'default', label: 'default', description: "codex's own configured default", efforts: codexEfforts.length ? codexEfforts : CODEX_FALLBACK_EFFORTS }, ...cat.models],
      efforts: codexEfforts.length ? codexEfforts : CODEX_FALLBACK_EFFORTS,
      source: cat.models.length ? `codex catalog, fetched ${cat.fetched}` : 'catalog not mounted, showing a fallback list'
    },
    // The others: the model is free text (OpenCode's as provider/model), efforts as engines.conf says.
    ...Object.fromEntries(engines().filter(e => !['claude', 'codex'].includes(e.name)).map(e => [e.name, {
      options: [{ slug: 'default', label: 'default', description: `${e.name}'s own default`, efforts: e.efforts }],
      efforts: e.efforts,
      source: e.name === 'opencode' ? 'free text: provider/model, e.g. anthropic/claude-sonnet-4-5' : 'free text'
    }]))
  }
}

/** Reasoning levels valid for one engine+model pair. Falls back to the engine's union
 *  for a model the catalog does not know, so a hand-typed name is never blocked. */
export function effortsFor (engine, model) {
  const e = models()[engine]
  if (!e) return []
  const hit = e.options.find(o => o.slug === model)
  return hit && hit.efforts.length ? hit.efforts : e.efforts
}

export class HttpError extends Error {
  constructor (status, msg) { super(msg); this.status = status }
}

// ---------- fs helpers -------------------------------------------------------

const read = p => { try { return readFileSync(p, 'utf8') } catch { return null } },
      ls = p => { try { return readdirSync(p, { withFileTypes: true }) } catch { return [] } },
      dirs = p => ls(p).filter(d => d.isDirectory()).map(d => d.name).sort(),
      mtime = p => { try { return statSync(p).mtimeMs } catch { return 0 } }

// ---------- apps -------------------------------------------------------------

/** system/ and every installed app (system/apps/<name>/ with an app.conf), base first —
 *  bin/brain's sys_roots, in the same order. A lookup takes the first root that has it;
 *  a name in two roots is a lint error, never an override. Not a dot-folder: like the
 *  shell's glob in sys_roots, .base/ and an update's .<app>.conflicts/ (a whole app.conf in it) are
 *  copies of an app, not apps. */
export function sysRoots () {
  return [SYS, ...dirs(join(SYS, 'apps')).filter(n => !n.startsWith('.')).map(n => join(SYS, 'apps', n)).filter(d => existsSync(join(d, 'app.conf')))]
}
const relOf = abs => abs.slice(BRAIN.length + 1)
const appOf = abs => (relOf(abs).match(/^system\/apps\/([^/]+)\//) || [])[1] || ''
const inRoots = sub => sysRoots().map(r => join(r, sub)).find(p => existsSync(p)) || null
const allIn = sub => [...new Set(sysRoots().flatMap(r => dirs(join(r, sub))))].sort()

/* What an app adds to the Studio, from its ui/app.json. A project tab names one of the
   cockpit's own views and says when it shows: memory:<path> in the project's memory, or
   code:<path> in its code folder. The views are still the cockpit's — an app chooses
   which of its projects get them and under what name. */
// ponytail: the views live in the base until the ui/main.js kit (stage 5) lets an app ship its own.
export const APP_VIEWS = ['article', 'design', 'brandkit']
const WHEN = /^(memory|code):[A-Za-z0-9._/-]+$/
export function appUi (dir) {
  const text = read(join(dir, 'ui', 'app.json'))
  if (!text) return { projectTabs: [] }
  try {
    const ui = JSON.parse(text)
    const projectTabs = Array.isArray(ui.projectTabs) ? ui.projectTabs : []
    const problems = projectTabs.flatMap(t => [
      !/^[a-z0-9-]+$/.test(t.id || '') && `tab id '${t.id}' must be lowercase letters, digits and dashes`,
      !APP_VIEWS.includes(t.view) && `tab '${t.id}' uses view '${t.view}', which is not one of ${APP_VIEWS.join(', ')}`,
      !WHEN.test(t.when || '') && `tab '${t.id}' needs when: memory:<path> or code:<path>`
    ].filter(Boolean))
    return { projectTabs: problems.length ? [] : projectTabs, problems }
  } catch (e) { return { projectTabs: [], problems: [`ui/app.json is not JSON: ${e.message}`] } }
}
export function apps () {
  return sysRoots().slice(1).map(dir => {
    const conf = Object.fromEntries((read(join(dir, 'app.conf')) || '').split('\n').map(l => l.trim().match(/^([a-z]+)\s+(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
    return {
      name: basename(dir), label: conf.label || basename(dir), icon: conf.icon || 'puzzle-piece', version: conf.version || '', dir: relOf(dir), ui: appUi(dir),
      kind: conf.kind || '', main: existsSync(join(dir, 'ui', 'main.js')), projects: conf.kind ? kindProjects(basename(dir), conf.kind) : [],
      desc: conf.description || readmeLead(read(join(dir, 'README.md'))),
      config: appConfig(basename(dir), appLines(dir)), lock: appLock(basename(dir)), changes: appChanges(basename(dir))
    }
  })
}

/** Resolve a repo-relative path, refusing anything that escapes the root.
 *  The trailing slash matters: without it `/brainX` passes a bare prefix check. */
export function safePath (rel, root = BRAIN) {
  const p = resolve(root, String(rel || ''))
  // An app's host credentials on their way to its cli.sh (saveAppCredential): never read back.
  const inbox = join(BRAIN, '.credentials-inbox')
  if (p === inbox || p.startsWith(inbox + '/')) throw new HttpError(403, 'host credentials are not readable through the cockpit')
  if (p !== root && !p.startsWith(root + '/')) throw new HttpError(400, 'path escapes root')
  return p
}

/** Atomic, newline-terminated, and a no-op when the bytes already match.
 *  The no-op is load-bearing: bin/brain:286 decides whether a fix has landed by
 *  comparing <phase>.fixed mtime against <phase>.md, so rewriting identical content
 *  re-dispatches the fixer and burns a MAX_FIX_LOOPS slot. */
export function writeAtomic (abs, content) {
  let out = content.replace(/\r\n/g, '\n')
  if (!out.endsWith('\n')) out += '\n' // bin/brain reads skills.list with `while read`, which drops an unterminated last line
  if (read(abs) === out) return { written: false }
  const tmp = abs + '.tmp'
  writeFileSync(tmp, out, 'utf8')
  renameSync(tmp, abs)
  return { written: true }
}

export function readTracked (rel) {
  const abs = safePath(rel)
  const content = read(abs)
  if (content === null) throw new HttpError(404, `no such file: ${rel}`)
  return { path: rel, content }
}

export function writeTracked (rel, content, prev) {
  const abs = safePath(rel)
  if (!abs.startsWith(join(BRAIN, 'system') + '/') && !abs.startsWith(join(BRAIN, 'memory') + '/')) {
    throw new HttpError(403, 'only system/ and memory/ are writable')
  }
  const now = read(abs)
  if (now === null) throw new HttpError(404, `no such file: ${rel}`)
  if (typeof prev === 'string' && prev.replace(/\r\n/g, '\n') !== now) {
    throw new HttpError(409, 'file changed on disk since you loaded it')
  }
  return { path: rel, ...writeAtomic(abs, content) }
}

// ---------- parsers ----------------------------------------------------------

/** Whitespace-columned rows, keeping the raw line so writes can splice instead of reflow. */
function columns (text) {
  return (text || '').split('\n').map((line, i) => {
    const f = line.trim().split(/\s+/).filter(Boolean)
    return { i, line, fields: f, comment: line.trimStart().startsWith('#'), blank: !line.trim() }
  })
}
const dataRows = rows => rows.filter(r => !r.comment && !r.blank)

export function parseEnv (text) {
  const out = {}
  for (const line of (text || '').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

/** playbook.md is four parts: title, `> ` description, preamble prose, then `## <phase>`
 *  sections. bin/brain:301 extracts a section with `$0 == "## " phase` — byte equality —
 *  so headings are captured raw, trailing whitespace and all, for the lint to catch. */
export function parsePlaybookMd (text) {
  const lines = (text || '').split('\n')
  const sections = []
  let firstHead = lines.length
  lines.forEach((l, i) => {
    if (!l.startsWith('## ')) return
    if (i < firstHead) firstHead = i
    sections.push({ heading: l, name: l.slice(3), start: i })
  })
  sections.forEach((s, n) => { s.end = n + 1 < sections.length ? sections[n + 1].start : lines.length })
  for (const s of sections) s.body = lines.slice(s.start + 1, s.end).join('\n').trim()
  const desc = lines.find(l => l.startsWith('> '))
  // `Area: Websites` before the first phase: which kind of work this is, so the Studio
  // can group playbooks and their projects. Optional.
  const area = lines.slice(0, firstHead).find(l => /^Area:\s*\S/.test(l))
  return {
    title: lines.find(l => l.startsWith('# ')) || '',
    description: desc ? desc.slice(2) : '',
    area: area ? area.replace(/^Area:\s*/, '').trim() : '',
    preamble: lines.slice(desc ? lines.indexOf(desc) + 1 : 1, firstHead).filter(l => l !== area).join('\n').trim(),
    sections
  }
}

/** Replace one `## <phase>` body, leaving every other line byte-identical. */
export function replaceSection (text, phase, body) {
  const lines = text.split('\n')
  const doc = parsePlaybookMd(text)
  const s = doc.sections.find(x => x.name === phase)
  if (!s) throw new HttpError(404, `no '## ${phase}' section`)
  const tail = lines.slice(s.end)
  return [...lines.slice(0, s.start + 1), ...body.trim().split('\n'), ...(tail.length ? [''] : []), ...tail].join('\n')
}

/** Rewrite fields 2 and 3 of one roles.conf line. Everything else keeps its bytes —
 *  the file carries a mid-file `# rebuild-payload` divider and two different column
 *  alignments (positions 21/30 and 23/32) that a regenerate would flatten. */
/** Rewrite fields 2-4 of one roles.conf line. Everything else keeps its bytes: the file
 *  carries a mid-file `# rebuild-payload` divider and two different column alignments
 *  that a regenerate would flatten. */
export function setRoleLine (text, role, engine, model, effort = '') {
  if (!engineNames().includes(engine)) throw new HttpError(400, `engine must be one of system/engines.conf: ${engineNames().join(', ')}`)
  if (!/^[A-Za-z0-9._/-]+$/.test(model || '')) throw new HttpError(400, 'bad model name')
  const use = effort && effort !== 'default' ? effort : ''
  const ok = effortsFor(engine, model)
  if (use && !ok.length) throw new HttpError(400, `${engine} has no reasoning effort setting`)
  if (use && !ok.includes(use)) {
    throw new HttpError(400, `${engine}${model && model !== 'default' ? ` with ${model}` : ''} takes effort ${ok.join(', ')} (got '${use}')`)
  }
  const lines = text.split('\n')
  const rows = dataRows(columns(text))
  const row = rows.find(r => r.fields[0] === role)
  if (!row) throw new HttpError(404, `role '${role}' not in roles.conf`)
  const start = (r, n) => { let i = -1; for (let k = 1; k <= n; k++) i = r.line.indexOf(r.fields[k], i + 1); return i }
  const i1 = start(row, 1), i2 = start(row, 2)
  // Keep the effort column aligned across the file: park it past the widest model.
  const i3 = Math.max(...rows.map(r => i2 + (r.fields[2] || '').length)) + 2
  const pad = (s, to) => s + ' '.repeat(Math.max(1, to - s.length))
  let out = pad(pad(role, i1) + engine, i2) + model
  if (use) out = pad(out, i3) + use
  lines[row.i] = out
  return lines.join('\n')
}

/* ---------- inputs: what a project is handed when it starts ----------
   A playbook's `inputs` file types the questions its brief asks, so the cockpit can ask
   them properly — a URL list that checks every address, a choice, a file drop — and
   says which are asked for every project and which once per client. Columns like
   phases; the label is the rest of the line and is the brief heading the answer lands
   under, so agents read it exactly where they always read the brief. bin/brain
   check_playbook applies the same rules. */
export const INPUT_TYPES = ['text', 'longtext', 'url', 'urls', 'number', 'choice', 'files']
const INPUT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

export function parseInputs (text) {
  const inputs = [], problems = [], names = new Set(), labels = new Set()
  for (const r of dataRows(columns(text))) {
    const n = r.i + 1
    const [name, type = '', per = '', need = '', ...rest] = r.fields
    const label = rest.join(' ')
    if (r.fields.length < 5) { problems.push([n, `'${name}' needs five columns: input type per need label`]); continue }
    if (!INPUT_NAME.test(name)) problems.push([n, `'${name}' is not a usable input name — lowercase letters, digits and dashes`])
    if (names.has(name)) problems.push([n, `input '${name}' appears twice`])
    names.add(name)
    const c = type.indexOf(':'), kind = c < 0 ? type : type.slice(0, c)
    const options = c < 0 ? [] : type.slice(c + 1).split(',').filter(Boolean)
    if (!INPUT_TYPES.includes(kind)) problems.push([n, `'${name}': type '${type}' is not one of ${INPUT_TYPES.join(', ')}`])
    else if (kind === 'choice' && options.length < 2) problems.push([n, `'${name}': a choice needs at least two options, as choice:a,b`])
    else if (kind !== 'choice' && c >= 0) problems.push([n, `'${name}': only a choice takes options after ':'`])
    if (!['project', 'client'].includes(per)) problems.push([n, `'${name}': per is 'project' or 'client', not '${per}'`])
    if (!['yes', 'no'].includes(need)) problems.push([n, `'${name}': need is 'yes' or 'no', not '${need}'`])
    if (label.includes('#')) problems.push([n, `'${name}': a '#' in the label becomes part of the brief heading`])
    if (labels.has(label.toLowerCase())) problems.push([n, `the label '${label}' is used twice — both answers would land under one brief heading`])
    labels.add(label.toLowerCase())
    inputs.push({ name, type: kind, options, per, required: need === 'yes', label, line: r.i })
  }
  return { inputs, problems }
}

function playbookInputs (playbook) {
  return parseInputs(read(join(playbookDir(playbook), 'inputs')) || '').inputs
}

/** What people paste into a URL box: `example.com/page`, a full link, a stray space.
 *  The scheme is added when it is missing; anything else that is not an http(s)
 *  address with a dotted host is refused, because an agent would only fail on it later. */
export function normUrl (raw) {
  const t = String(raw || '').trim()
  if (!t || /\s/.test(t)) return null
  // mailto:, javascript:, tel: — another scheme, not a page missing its https://. A dot
  // before the colon is a host with a port (example.com:8080), which is fine.
  if (/^[a-z][a-z0-9+-]*:(?!\/\/)/i.test(t)) return null
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`) } catch { return null }
  return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') && !u.username && !u.password ? u.href : null
}

/** One answer as the markdown body of its brief section: a list for urls and files, a
 *  line for the rest. Empty means unanswered. Throws what the human needs to fix. */
function inputBody (inp, raw) {
  const fail = msg => { throw new HttpError(400, `${inp.label}: ${msg}`) }
  const s = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '')
  if (!s.trim()) return ''
  switch (inp.type) {
    case 'text': return s.replace(/\s+/g, ' ').trim()
    case 'longtext': return s.trim()
    case 'number': return Number.isFinite(Number(s.trim())) ? s.trim() : fail(`'${s.trim()}' is not a number`)
    case 'choice': return inp.options.includes(s.trim()) ? s.trim() : fail(`pick one of ${inp.options.join(', ')}`)
    case 'url': return normUrl(s) || fail(`'${s.trim()}' is not a web address`)
    case 'urls': {
      const tokens = s.split(/\s+/).filter(Boolean)
      const bad = tokens.filter(t => !normUrl(t))
      if (bad.length) fail(`not a web address: ${bad.slice(0, 3).map(b => `'${b}'`).join(', ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''}`)
      const urls = [...new Set(tokens.map(normUrl))]
      if (urls.length > 50) fail('at most 50 addresses')
      return urls.map(u => `- ${u}`).join('\n')
    }
    default: fail(`cannot take a typed answer (${inp.type})`)
  }
}

/** A section body as the value a form field shows: comments gone, list bullets gone. */
function sectionValue (text, inp) {
  const s = briefSections(text || '').find(x => x.heading === inp.label)
  const body = s ? s.body.replace(/<!--[\s\S]*?-->/g, '').trim() : ''
  if (!['urls', 'files'].includes(inp.type)) return body
  const items = body.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
  return inp.type === 'files' ? items.map(f => f.replace(/^sources\//, '')) : items.join('\n')
}

/** Set one `##` section's body by heading text, or append the section when there is none.
 *  Every other line keeps its bytes. */
function setSection (text, heading, body) {
  const lines = (text || '').replace(/\n+$/, '').split('\n')
  const s = briefSections(lines.join('\n')).find(x => x.heading === heading)
  if (!s) return `${lines.join('\n')}\n\n## ${heading}\n${body}\n`.replace(/^\n+/, '')
  lines.splice(s.start + 1, s.end - s.start - 1, ...(body ? body.split('\n') : []), '')
  return lines.join('\n').replace(/\n+$/, '') + '\n'
}

/** Save the inputs a playbook asks for, from the cockpit's editor. Writes the file in the
 *  phases style and gives every per-project input a heading in the brief template, so
 *  `brain new` at a terminal asks it too. */
export function setInputs ({ playbook, inputs = [], prev }) {
  const dir = playbookDir(playbook)
  if (!existsSync(join(dir, 'phases'))) throw new HttpError(404, `no playbook '${playbook}'`)
  const file = join(dir, 'inputs'), cur = read(file) || ''
  if (typeof prev === 'string' && prev !== cur) throw new HttpError(409, 'the inputs changed on disk since you loaded them — reload and try again')
  const taken = new Set()
  const rows = inputs.map(i => {
    const label = String(i.label || '').replace(/\s+/g, ' ').trim()
    if (!label) throw new HttpError(400, 'every input needs a label: it is the question the form asks')
    let name = String(i.name || '') || toSlug(label).slice(0, 40).replace(/-+$/, '') || 'input'
    for (let k = 2; taken.has(name); k++) name = `${toSlug(label).slice(0, 36)}-${k}`
    taken.add(name)
    const opts = (i.options || []).map(o => String(o).trim()).filter(Boolean)
    if (opts.some(o => !/^[^\s,#]+$/.test(o))) throw new HttpError(400, `${label}: each choice is a single word or code (no spaces or commas), e.g. en, de`)
    return [name, i.type === 'choice' ? `choice:${opts.join(',')}` : String(i.type || ''), String(i.per || ''), i.required ? 'yes' : 'no', label]
  })
  if (!rows.length) {
    if (existsSync(file)) unlinkSync(file)
    return { inputs: [], content: '' }
  }
  const head = ['input', 'type', 'per', 'need']
  const w = k => Math.max(head[k].length, ...rows.map(r => r[k].length)) + 2
  const line = r => r.map((v, k) => k < 4 ? v.padEnd(w(k)) : v).join('')
  const text = [
    '# What a project is handed when it starts. The cockpit asks these as a form; each answer',
    '# lands in the brief under its label. type: text longtext url urls number files choice:a,b',
    '# per: project (asked every time) or client (asked once, kept in the client profile).',
    '# ' + line(['input', 'type', 'per', 'need', 'label']).replace(/^input {2}/, 'input'),
    ...rows.map(line)
  ].join('\n') + '\n'
  const { problems, inputs: parsed } = parseInputs(text)
  if (problems.length) throw new HttpError(400, problems[0][1])
  writeAtomic(file, text)
  let brief = read(join(dir, 'brief.md')) || read(join(SYS, 'brief-template.md')) || '# Brief\n'
  const before = brief
  for (const i of parsed.filter(x => x.per === 'project')) {
    if (!briefSections(brief).some(s => s.heading === i.label)) brief = setSection(brief, i.label, '')
  }
  if (brief !== before) writeAtomic(join(dir, 'brief.md'), brief)
  return { inputs: parsed, content: text }
}

/* ---------- a client's own answers ----------
   An input asked once per client lives in memory/clients/<slug>/profile.md under its
   label, and its files in clients/<slug>/sources/ — the client folder every project for
   that client already reads. */
/** Client work is the clients app's — bin/brain's clients_on. Without it no project has a
 *  client, an input asked once per client is asked for each project instead, and
 *  memory/clients/ stays on disk, unread, until the app is back. */
export const clientsOn = () => existsSync(join(SYS, 'apps', 'clients', 'app.conf'))
const askedInputs = playbook => playbookInputs(playbook).map(i => clientsOn() || i.per !== 'client' ? i : { ...i, per: 'project' })
function clientDir (client) {
  if (!clientsOn()) throw new HttpError(404, 'clients are an app: install it from Admin → Apps')
  const cl = toSlug(client)
  if (!PLAYBOOK_NAME.test(cl)) throw new HttpError(400, `'${client}' does not make a usable client slug`)
  return { cl, dir: join(MEM, 'clients', cl) }
}

export function clientInputs (client, playbook) {
  const { cl, dir } = clientDir(client)
  const prof = read(join(dir, 'profile.md')) || ''
  return {
    client: cl,
    exists: existsSync(join(dir, 'profile.md')),
    inputs: playbookInputs(playbook).filter(i => i.per === 'client').map(i => ({ ...i, value: sectionValue(prof, i) }))
  }
}

export function saveClientInputs ({ client, playbook, values = {} }) {
  const { cl, dir } = clientDir(client)
  const inputs = playbookInputs(playbook).filter(i => i.per === 'client' && i.type !== 'files')
  // Every answer is checked before the profile is touched, so a bad URL in the third box
  // does not leave the first two saved and the form saying it failed.
  const bodies = inputs.filter(i => Object.hasOwn(values, i.name)).map(i => [i, inputBody(i, values[i.name])])
  let prof = read(join(dir, 'profile.md')) || `# Client: ${cl}\n`
  for (const [i, body] of bodies) prof = setSection(prof, i.label, body)
  mkdirSync(dir, { recursive: true })
  writeAtomic(join(dir, 'profile.md'), prof)
  return clientInputs(cl, playbook)
}

/* Archiving moves a client to memory/archive/clients/<slug>/ — its profile, its pages and
   its documents, still tracked and still there to read, as `brain app forget` does with
   knowledge; a second archive of the same slug gets a timestamp. Restoring moves it back.
   Deleting removes the folder, active or archived, for good. Archiving and deleting an
   active client are refused while one of its projects is unfinished: those agents read
   the folder. A finished project keeps CLIENT=<slug> and simply finds no client memory. */
const CLIENT_ARCHIVE = () => join(MEM, 'archive', 'clients')
const ARCHIVED_STAMP = /-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/
function activeClient (client) {
  const { cl, dir } = clientDir(client)
  if (!existsSync(dir)) throw new HttpError(404, `no client '${cl}'`)
  const open = projects().filter(p => p.client === cl && p.next)
  if (open.length) throw new HttpError(409, `${open.map(p => p.name).join(', ')} ${open.length === 1 ? 'is' : 'are'} still running for this client. Finish or delete ${open.length === 1 ? 'it' : 'them'} first.`)
  return { cl, dir }
}
function archivedClient (name) {
  if (!clientsOn()) throw new HttpError(404, 'clients are an app: install it from Admin → Apps')
  const n = String(name || '')
  const dir = join(CLIENT_ARCHIVE(), n)
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(n) || !existsSync(dir)) throw new HttpError(404, `no archived client '${n}'`)
  return { name: n, dir, slug: n.replace(ARCHIVED_STAMP, '') }
}

export function archivedClients () {
  if (!clientsOn()) return []
  return dirs(CLIENT_ARCHIVE()).map(name => ({ name, slug: name.replace(ARCHIVED_STAMP, ''), path: `memory/archive/clients/${name}/profile.md` }))
}

export function archiveClient (client) {
  const { cl, dir } = activeClient(client)
  let dest = join(CLIENT_ARCHIVE(), cl)
  if (existsSync(dest)) dest = join(CLIENT_ARCHIVE(), `${cl}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`)
  mkdirSync(CLIENT_ARCHIVE(), { recursive: true })
  renameSync(dir, dest)
  return { archived: basename(dest), path: `memory/archive/clients/${basename(dest)}` }
}

export function restoreClient (name) {
  const { dir, slug } = archivedClient(name)
  const dest = join(MEM, 'clients', slug)
  if (existsSync(dest)) throw new HttpError(409, `a client '${slug}' exists already — archive or delete it first`)
  mkdirSync(dirname(dest), { recursive: true })
  renameSync(dir, dest)
  return { restored: slug }
}

/** For good: `archived` names a folder in the archive, otherwise `client` is an active one.
 *  `confirm` is the client's slug, typed. */
export function deleteClient ({ client, archived, confirm }) {
  const { dir, slug } = archived ? archivedClient(archived) : { ...activeClient(client), slug: toSlug(client) }
  if (confirm !== slug) throw new HttpError(400, `type ${slug} to confirm`)
  rmSync(dir, { recursive: true, force: true })
  return { deleted: archived || slug }
}

// ---------- state ------------------------------------------------------------

export function playbooks () {
  const props = proposals(read(join(MEM, 'proposals.md')))
  return allIn('playbooks').map(name => {
    const dir = playbookDir(name)
    const md = parsePlaybookMd(read(join(dir, 'playbook.md')) || '')
    const rows = columns(read(join(dir, 'phases')) || '')
    const analysis = `memory/knowledge/playbook-${name}.md`
    return {
      proposals: playbookProposals(name, dataRows(rows).flatMap(r => r.fields.slice(1, 3)), props),
      // What `brain playbook analyse` writes: the scorecards and the diagnosis, run over run.
      analysis: existsSync(join(BRAIN, analysis)) ? analysis : null,
      name,
      // Where it lives: system/playbooks/<name> or system/apps/<app>/playbooks/<name>.
      dir: relOf(dir),
      app: appOf(dir),
      description: md.description,
      area: md.area || 'Other',
      md,
      env: parseEnv(read(join(dir, 'playbook.env')) || ''),
      hasBrief: existsSync(join(dir, 'brief.md')),
      inputs: parseInputs(read(join(dir, 'inputs')) || '').inputs,
      inputsText: read(join(dir, 'inputs')) || '',
      rows: dataRows(rows),
      // bin/brain:61 filters NF >= 2, so a 1-field row silently vanishes from the pipeline
      phases: dataRows(rows).filter(r => r.fields.length >= 2)
        .map(r => ({
          phase: r.fields[0], role: r.fields[1], fix: r.fields[2] || '', line: r.i,
          // The phase whose contract outputs the article: a gate before it reviews that
          // phase's summary, even when an older article.md is still on disk from a reopen.
          writesArticle: /^output\s+memory:content\/article\.md\s*$/m.test(read(join(dir, 'contracts', r.fields[0])) || '')
        }))
    }
  })
}

/** Which skills a role should reach for. Neither CLI has an allowlist flag, so this is
 *  a line in the role's own instructions, which brain tells every agent to follow. It
 *  directs the role; it does not restrict what the sandbox can load. */
/** Reads the role's `Skills:` line, if it has one.
 *  A structured list is bare identifiers. html-designer.md opens with a prose
 *  "Skills: use the taste skills (...)" line explaining why each one is used; that is
 *  reported as not editable so the picker never overwrites the reasoning.
 *  Deliberately does not guess from the surrounding prose: "brain" appears as an
 *  ordinary word in almost every role doc, and "payload" is a substring of
 *  "payload-conventions", so scanning produces confident nonsense. */
export function roleSkills (text) {
  const m = (text || '').match(/^Skills:[ \t]*(.*)$/m)
  if (!m) return { names: [], editable: true }
  const toks = m[1].split(',').map(t => t.trim()).filter(Boolean)
  if (toks.length && toks.every(t => /^[A-Za-z0-9._-]+$/.test(t))) return { names: toks, editable: true }
  return { names: [], editable: false, prose: m[0] }
}

export function setRoleSkills (text, names) {
  const cur = roleSkills(text)
  if (!cur.editable) {
    throw new HttpError(409, 'this role explains its skills in prose. Edit the instructions directly so the reasoning is not lost.')
  }
  const lines = (text || '').split('\n')
  const i = lines.findIndex(l => /^Skills:/.test(l))
  if (!names.length) {
    // Symmetry matters: inserting used to add a blank line with the Skills line, so
    // clearing left the blank behind and every save/clear cycle grew the file.
    if (i >= 0) lines.splice(i, lines[i + 1] === '' && lines[i - 1] === '' ? 2 : 1)
    return lines.join('\n')
  }
  const line = `Skills: ${names.join(', ')}`
  if (i >= 0) lines[i] = line
  else {
    const h = lines.findIndex(l => l.startsWith('# '))
    const at = h < 0 ? 0 : h + 1
    lines.splice(at, 0, line)
  }
  return lines.join('\n')
}

/** Every root's roles.conf, base first. `conf` is the file the line is in, so an edit
 *  to an app's role goes to that app's roles.conf; both halves live in the same root. */
export function roles () {
  return sysRoots().flatMap(root => {
    const rows = dataRows(columns(read(join(root, 'roles.conf')) || ''))
    const docs = ls(join(root, 'roles')).filter(d => d.isFile() && d.name.endsWith('.md')).map(d => d.name.slice(0, -3))
    const conf = relOf(join(root, 'roles.conf')), app = appOf(join(root, 'x'))
    return rows.map(r => {
      const doc = docs.includes(r.fields[0]) ? relOf(join(root, 'roles', `${r.fields[0]}.md`)) : null
      return {
        role: r.fields[0], engine: r.fields[1] || '', model: r.fields[2] || '', effort: r.fields[3] || '',
        fields: r.fields.length, line: r.i, doc, conf, app,
        ...(doc ? roleSkills(read(join(BRAIN, doc))) : { names: [], editable: false })
      }
    })
  })
}
export const roleConfRel = role => roles().find(r => r.role === role)?.conf || 'system/roles.conf'
export const roleDocRel = role => roles().find(r => r.role === role)?.doc || `system/roles/${role}.md`

export function skills () {
  const own = sysRoots().flatMap(root => dirs(join(root, 'skills')).map(name => {
    const text = read(join(root, 'skills', name, 'SKILL.md')) || ''
    const fm = text.match(/^---\n([\s\S]*?)\n---/)
    const field = k => (fm?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] || '').trim()
    return { dir: name, name: field('name'), description: field('description'), path: relOf(join(root, 'skills', name, 'SKILL.md')), app: appOf(join(root, 'x')) }
  }))
  const external = []
  for (const root of sysRoots()) {
    for (const line of (read(join(root, 'skills.list')) || '').split('\n')) {
      const f = line.trim().split(/\s+/).filter(Boolean)
      if (!f.length || f[0].startsWith('#')) continue
      external.push({ keep: f[0] === 'keep:', repo: f[0] === 'keep:' ? null : f[0], names: f.slice(1), line, list: relOf(join(root, 'skills.list')), app: appOf(join(root, 'x')) })
    }
  }
  // One flat list of every skill this brain declares, whatever its source. sync-skills
  // installs exactly this set and prunes everything else, so it should match
  // `sbx skills ls` — which the container cannot run to confirm.
  const declared = [
    ...own.map(s => ({ name: s.name || s.dir, source: 'own', detail: s.path.replace(/\/SKILL\.md$/, ''), path: s.path, description: s.description, app: s.app })),
    ...external.flatMap(e => e.names.map(n => ({
      name: n,
      source: e.keep ? 'host' : 'repo',
      detail: e.keep ? 'kept from your Mac, not installed by the brain' : e.repo,
      app: e.app
    })))
  ].sort((a, b) => a.name.localeCompare(b.name))
  return { own, external, declared }
}

/** What sandbox.conf declares: MCP servers and network rules. Intent, like
 *  skills.list — the container cannot run `sbx mcp ls` or `sbx policy ls` to see
 *  what is actually registered, so the UI says what it is showing. */
export function sandbox () {
  const out = { mcp: [], allow: [], deny: [] }
  for (const line of (read(join(SYS, 'sandbox.conf')) || '').split('\n')) {
    const f = line.trim().split(/\s+/).filter(Boolean)
    if (!f.length || f[0].startsWith('#')) continue
    // Hosts are comma- or space-separated; bin/brain turns both into one sbx argument.
    if (f[0] === 'mcp' && f[1]) out.mcp.push({ name: f[1], detail: f.slice(2).join(' ') })
    else if (f[0] === 'allow' || f[0] === 'deny') out[f[0]].push(...f.slice(1).join(',').split(',').filter(Boolean))
  }
  return out
}

/** Every run of one phase, newest first. bin/brain writes one receipt per run into
 *  <phase>.runs/<run-id>.json, named by the host record's run id, and the role file and
 *  summary that run had are in that record, .runs/<project>/<phase>/<run-id>/ — so a
 *  phase that failed twice has three receipts and each one can be read against the
 *  instructions that produced it. Receipts from before the join are <ts>.json with
 *  <ts>.<role>.md and <ts>.summary.md beside them, and are still read. The paths are
 *  repo-relative because the client fetches the snapshots through /api/file. */
function phaseRuns (pdir, phase) {
  const dir = join(pdir, 'phases', `${phase}.runs`)
  const names = ls(dir).filter(e => e.isFile()).map(e => e.name)
  const project = basename(pdir)
  const rel = n => `memory/projects/${project}/phases/${phase}.runs/${n}`
  const out = []
  for (const n of names.filter(x => x.endsWith('.json')).sort()) {
    const at = n.slice(0, -5)
    let d = null
    try { d = JSON.parse(read(join(dir, n))) } catch { continue }
    const rec = join(BRAIN, '.runs', project, phase, at), recRel = x => `.runs/${project}/${phase}/${at}/${x}`
    let role = null, rolePath = null, summaryPath = null, v = null
    if (existsSync(join(rec, 'plan.json'))) {
      try { role = JSON.parse(read(join(rec, 'plan.json'))).role || null } catch {}
      if (existsSync(join(rec, 'role.md'))) rolePath = recRel('role.md')
      if (existsSync(join(rec, 'summary.md'))) { summaryPath = recRel('summary.md'); v = verdict(read(join(rec, 'summary.md'))) }
    } else {
      // `<ts>.summary.md` is the phase summary as this run left it; everything else ending
      // .md is the role snapshot, whose name carries the role. Excluding it explicitly,
      // because `startsWith(at + '.')` matches both and the role would come out "summary".
      const sum = `${at}.summary.md`
      const snap = names.find(x => x !== n && x !== sum && x.startsWith(at + '.') && x.endsWith('.md'))
      if (snap) { role = snap.slice(at.length + 1, -3); rolePath = rel(snap) }
      if (names.includes(sum)) { summaryPath = rel(sum); v = verdict(read(join(dir, sum))) }
    }
    out.push({
      ...d, at, path: rel(n), role, rolePath,
      result: v?.result || null, fixItems: v?.items || [], defects: v?.defects || [], summaryPath
    })
  }
  return out.reverse()
}

// The verdict is the one line that says it (bin/brain verdict_is), and a round is one
// host-format FAIL line in <phase>.log (bin/phase-contract.sh fail_rounds). A summary
// quoting "RESULT: FAIL" in prose is not a failed review, and it is not a round.
const VERDICT = /^RESULT: (PASS|FAIL)[ \t]*$/m
const VERDICT_LINE = /^RESULT: (PASS|FAIL)[ \t]*$/
const FAIL_ROUND = /^\d{4}-\d{2}-\d{2} FAIL[ \t]*$/
export const failRounds = log => (log || '').split('\n').filter(l => FAIL_ROUND.test(l)).length
// bin/phase-contract.sh open_rounds: the rounds since the last PASS, which the fix limit
// counts. A reopen after a PASS starts a new review, not round N+1 of the old one.
const PASS_ROUND = /^\d{4}-\d{2}-\d{2} PASS[ \t]*$/
export const openRounds = log => (log || '').split('\n').reduce((n, l) => PASS_ROUND.test(l) ? 0 : FAIL_ROUND.test(l) ? n + 1 : n, 0)

/** A summary's `## Defects` block, by bin/phase-contract.sh's rules: a `- ` line under
 *  the heading, fields split on blanks — id, state, then free text. */
export function defects (md) {
  const out = []
  let on = false
  for (const l of (md || '').split('\n')) {
    if (l.startsWith('## ')) { on = /^## Defects[ \t]*$/.test(l); continue }
    if (!on || !l.startsWith('- ')) continue
    const f = l.split(/[ \t]+/)
    out.push({ id: f[1] || '', state: f[2] || '', text: f.slice(3).join(' '), escaped: l.match(/escaped: ([a-z0-9-]+)/)?.[1] || null })
  }
  return out
}

/** What one run's phase summary said. Parsed here rather than in the browser because
 *  the analytics table wants a verdict per run inline, and fetching one summary per run
 *  to find out would be a request per fix round. Only a FAIL carries a fix list: every
 *  other phase writes numbered lines too, and they are prose, not findings. */
export function verdict (md) {
  if (!md) return null
  const result = md.match(VERDICT)?.[1] || null
  const found = defects(md)
  if (result !== 'FAIL') return { result, items: [], defects: found }
  const items = md.split('\n')
    .filter(l => /^\s*\d+\.\s/.test(l))
    .map(l => l.replace(/^\s*\d+\.\s*/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
  return { result, items, defects: found }
}

/** bin/phase-contract.sh approve_summary, byte for byte (test/fixtures/verdicts). */
export function approvedSummary (prev, fixedText, day, since, defer = []) {
  const named = new Set()
  if (since) {
    for (const l of (fixedText || '').split('\n')) {
      for (const w of l.replace(/[^a-z0-9.-]+/g, ' ').split(' ')) { const x = w.replace(/\.+$/, ''); if (x) named.add(x) }
    }
  }
  const lines = prev ? prev.split('\n') : []
  if (lines.length && lines.at(-1) === '') lines.pop() // awk: a final newline ends a record, it does not start one
  let has = false, on = false
  for (let i = 0; i < lines.length; i++) if (VERDICT_LINE.test(lines[i])) { lines[i] = 'RESULT: PASS'; has = true }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith('## ')) { on = /^## Defects[ \t]*$/.test(l); continue }
    if (!on || !l.startsWith('- ')) continue
    const f = l.split(/[ \t]+/)
    if (f[2] !== 'OPEN') continue
    const st = defer.includes(f[1]) ? 'DEFERRED' : named.has(f[1]) ? 'VERIFIED' : 'WAIVED'
    lines[i] = l.replace(' OPEN', ' ' + st) + ' — human ' + day
  }
  while (lines.length && /^[ \t\r]*$/.test(lines.at(-1))) lines.pop()
  if (lines.length) lines[lines.length - 1] = lines.at(-1).replace(/[ \t\r]+$/, '')
  return [...(has ? [] : ['RESULT: PASS']), ...lines, '', `Approved by human on ${day}.`].join('\n') + '\n'
}

/** bin/phase-contract.sh reject_summary. The note is the cockpit's; the CLI has none. */
export function rejectedSummary (phase, round, day, items, note = '') {
  return [
    'RESULT: FAIL', `Feedback from the human (${day}):`,
    ...items.map((s, i) => `${i + 1}. ${s}`),
    ...(note.trim() ? ['', note.trim()] : []),
    '', '## Defects',
    ...items.map((_, i) => `- ${phase}.r${round}-${i + 1} OPEN — item ${i + 1}`)
  ].join('\n') + '\n'
}

/** The host's own verdict on the newest attempt, from bin/run-record.sh. Separate from
 *  the receipts above: those are what the agent did, this is what the host checked after
 *  it exited. Only the newest attempt, and only once it has a result.json — an attempt
 *  still running has no verdict, and the previous one shown beside a live phase would
 *  read as this one's. Logs are linked, not inlined: /api/state is polled and a check
 *  log is unbounded. .runs/ is local and gitignored, but /api/file resolves anything
 *  under BRAIN, so the client fetches these the same way it fetches a role snapshot. */
function hostAttempt (project, phase, running = false) {
  const base = join(BRAIN, '.runs', project, phase)
  // mktemp appends its suffix to a UTC stamp, so the names sort oldest-first.
  const id = dirs(base).pop()
  if (!id) return null
  const dir = join(base, id), rel = n => `.runs/${project}/${phase}/${id}/${n}`
  // JSON.parse(null) is null, not a throw: an attempt with no result.json yet reaches here.
  let r
  try { r = JSON.parse(read(join(dir, 'result.json'))) } catch { r = null }
  // No result is an attempt still running — or one whose launcher died, which only the
  // host can tell (its pid is the lease) and closes as crashed on the next brain run,
  // status or watch. Until then, say it is unfinished rather than show nothing.
  if (!r) return running ? null : { id, dir: `.runs/${project}/${phase}/${id}`, outcome: 'unfinished', ended: null, checks: [], notes: [] }
  const ev = join(dir, 'evidence')
  const checks = ls(ev).map(e => e.name.match(/^check-(\d+)\.command$/)).filter(Boolean)
    // Numeric, not lexical: with ten checks, sorting the names puts check-10 second.
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([, n]) => {
      // Absent when a check was killed before it could write one. Zero would read as a pass.
      const code = (read(join(ev, `check-${n}.exit`)) || '').trim()
      return { command: (read(join(ev, `check-${n}.command`)) || '').trim(), exit: code === '' ? null : Number(code), log: rel(`evidence/check-${n}.log`) }
    })
  // The line that says which output, evidence or check rejected the attempt. A missing
  // or stale artifact produces no check entry, so this is the only account of it.
  const notes = [['preflight.log', 'missing contract inputs'], ['defects.log', 'what the defect rules rejected'], ['verification.log', 'what verification rejected']]
    .filter(([n]) => (read(join(dir, n)) || '').trim())
    .map(([n, label]) => ({ label, path: rel(n) }))
  return { id, dir: `.runs/${project}/${phase}/${id}`, outcome: r.host_verdict?.outcome || null, ended: r.ended || null, checks, notes }
}

/** Phase state is the whole state machine and it lives entirely in marker files.
 *  bin/brain reads nothing else: .done means complete, RESULT: FAIL in .md means
 *  needs fixing, and .fixed newer than .md means the fix already landed. */
function phaseState (pdir, phase) {
  const f = e => join(pdir, 'phases', phase + e)
  const md = read(f('.md')), log = read(f('.log')) || ''
  const done = existsSync(f('.done'))
  const failed = !!md && /^RESULT: FAIL[ \t]*$/m.test(md)
  const fails = failRounds(log), open = openRounds(log)
  const fixed = mtime(f('.fixed')) > mtime(f('.md'))
  // bin/brain holds .running for exactly as long as the blocking sbx run, so an agent
  // is at work on this phase right now. A machine killed mid-phase leaves one behind,
  // which is why `since` is reported too: a marker hours old reads as stale, not busy.
  const since = done ? 0 : mtime(f('.running'))
  // brain-runlog's receipts: duration, tokens, and which skills the agent actually
  // reached for, one per run. Absent for a codex run, or a phase that predates it, so
  // every consumer has to cope with an empty list.
  const runs = phaseRuns(pdir, phase)
  // A phase that last ran before receipts were kept per run still has its single
  // <phase>.run.json. It is one run with no role snapshot, not a missing one.
  if (!runs.length && existsSync(f('.run.json'))) {
    try { runs.push({ ...JSON.parse(read(f('.run.json'))), at: null, path: `memory/projects/${basename(pdir)}/phases/${phase}.run.json`, role: null, rolePath: null }) } catch {}
  }
  const run = runs[0] || null
  let state = 'pending'
  if (done) state = 'done'
  // Ahead of `failed`: a fix round for a failed review is an agent working, not a wait.
  else if (since) state = 'running'
  else if (failed) state = open >= MAX_FIX_LOOPS ? 'stuck' : fixed ? 'awaiting-review' : 'awaiting-fix'
  // What the phase's findings came to. Waived and deferred are what the project ships
  // with, which is why they are counted where the phase row can show them.
  const found = defects(md)
  const count = st => found.filter(d => d.state === st).length
  return {
    phase, state, fails, maxFails: MAX_FIX_LOOPS, hasSummary: !!md, since, run, runs,
    attempt: hostAttempt(basename(pdir), phase, !!since),
    result: md?.match(VERDICT)?.[1] || null,
    defects: found, open: count('OPEN'), waived: count('WAIVED'), deferred: count('DEFERRED'),
    log: log.split('\n').filter(Boolean)
  }
}

export function projects () {
  const pbs = playbooks()
  const appTabs = new Map(apps().map(a => [a.name, a.ui.projectTabs]))
  const pages = knowledge(), log = logEntries(), props = proposals(read(join(MEM, 'proposals.md')))
  // A project of an app's kind (KIND=academy) has no playbook and no phases; it is not one of these.
  return dirs(join(MEM, 'projects')).filter(n => existsSync(join(MEM, 'projects', n, 'project.env')) &&
    !parseEnv(read(join(MEM, 'projects', n, 'project.env'))).KIND).map(name => {
    const pdir = join(MEM, 'projects', name)
    const env = parseEnv(read(join(pdir, 'project.env')))
    const pb = pbs.find(p => p.name === env.PLAYBOOK)
    const phases = (pb?.phases || []).map(p => ({ ...p, ...phaseState(pdir, p.phase) }))
    const next = phases.find(p => p.state !== 'done')
    const hostDir = env.PROJECT_DIR || ''
    // PROJECT_DIR is a host path and --dir allows anywhere; only ~/dev is mounted.
    const seen = hostDir.startsWith(HOST_DEV + '/')
    // Which of a project's own output directories actually exist. A playbook without a
    // brand phase never makes a brandkit/, so the cockpit must not offer to show one:
    // a section is a place something IS, not a place something could be.
    const codeDir = seen ? join(DEV, hostDir.slice(HOST_DEV.length + 1)) : null
    const has = {
      design: !!(codeDir && existsSync(join(codeDir, 'design'))),
      brandkit: !!(codeDir && existsSync(join(codeDir, 'brandkit'))),
      article: existsSync(join(pdir, 'content', 'article.md'))
    }
    // The tabs its app declares, the ones whose file or folder is there.
    const holds = w => { const [where, rel] = w.split(/:(.*)/); return where === 'memory' ? existsSync(join(pdir, rel)) : !!(codeDir && existsSync(join(codeDir, rel))) }
    const tabs = (appTabs.get(pb?.app) || []).filter(t => holds(t.when))
    // What a person calls this project: the answer to the playbook's first input (the
    // keyword, on the SEO paths), the article's own title once there is one.
    const first = pb?.inputs.find(i => i.per === 'project')
    const answer = first ? sectionValue(read(join(pdir, 'brief.md')), first).split('\n')[0].replace(/^\s*-\s*/, '').trim() : ''
    const titled = existsSync(join(pdir, 'content', 'article.md')) && (read(join(pdir, 'content', 'article.md')).match(/^---\n[\s\S]*?^title:\s*(.+)$/m) || [])[1]
    return {
      name, playbook: env.PLAYBOOK || null, client: (clientsOn() && env.CLIENT) || null, created: env.CREATED || null,
      title: (titled || '').trim().replace(/^(['"])(.*)\1$/, '$2') || answer || null, keyword: answer || null,
      template: env.TEMPLATE || null, hostDir,
      visible: seen, has, tabs,
      phases, next: next || null, sources: sources(name),
      blocked: next && (next.role === 'human' || ['awaiting-fix', 'stuck'].includes(next.state)) ? next : null,
      // A run the cockpit asked for that `brain watch` has not started yet: queued at the
      // cap, or nobody is listening. Or one it has just opened a Terminal for, in the
      // seconds before the sandbox is up and the phase holds its .running lease; without
      // it a run that is starting showed as paused.
      runPending: existsSync(join(pdir, '.run-request')) || existsSync(join(pdir, '.launching')),
      // Waiting out a subscription limit (bin/brain wait_limit): which engine, and until when.
      limit: (([engine, until]) => +until * 1000 > Date.now() ? { engine, until: +until * 1000 } : null)((read(join(pdir, '.limit')) || '').trim().split(/\s+/)),
      qa: qaReports(name), mem: `memory/projects/${name}`,
      memory: projectMemory(name, pages, log, props)
    }
  })
}

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What a project left in the brain-wide memory, which outlives it: the knowledge pages
 *  that cite its record under ## Sources, the log entries that name it, and the
 *  proposals it filed — each one tagged `(project, date)`, the format proposals.md asks for. */
function projectMemory (name, pages, log, props) {
  const named = new RegExp(`(^|[^A-Za-z0-9-])${reEsc(name)}([^A-Za-z0-9-]|$)`)
  const tag = new RegExp(`\\(${reEsc(name)},\\s*\\d{4}-\\d{2}-\\d{2}\\)`)
  return {
    knowledge: pages.filter(k => k.cites.includes(name)).map(k => k.name),
    log: log.filter(e => named.test(`${e.head}\n${e.body}`)),
    proposals: Object.fromEntries(PROPOSAL_SECTIONS.map(s => [s, props[s].filter(l => tag.test(l))]))
  }
}

/** log.md as entries: a `## [date] kind | subject` heading and the lines under it. */
function logEntries () {
  const out = []
  for (const line of (read(join(MEM, 'log.md')) || '').split('\n')) {
    if (line.startsWith('## [')) out.push({ head: line.slice(3), body: '' })
    else if (out.length && line.trim()) out.at(-1).body += (out.at(-1).body ? '\n' : '') + line
  }
  return out
}

// ---------- proposals --------------------------------------------------------

/** proposals.md is three lists under three headings. Agents append to Open; the human
 *  moves a line to Accepted — the only section `brain evolve` applies — or to Declined,
 *  which BRAIN.md tells agents to read before they propose the same change again.
 *  Same rule as bin/brain proposals_section: the '- ' lines under a byte-exact heading. */
export const PROPOSAL_SECTIONS = ['Open', 'Accepted', 'Declined']
export function proposals (text) {
  const out = Object.fromEntries(PROPOSAL_SECTIONS.map(s => [s, []]))
  let on = null
  for (const line of (text || '').split('\n')) {
    if (line.startsWith('## ')) { on = PROPOSAL_SECTIONS.find(s => line === `## ${s}`) || null; continue }
    if (on && line.startsWith('- ')) out[on].push(line)
  }
  return out
}

/** The proposals that would change a playbook: its own folder, or a role its phases run.
 *  Read from the leading [target] alone, because the evidence after it cites other
 *  roles' files as often as the one to change. */
export function playbookProposals (name, roles, props) {
  const own = new RegExp(`playbooks/${reEsc(name)}(?![a-z0-9-])`) // not playbooks/<name>-v2
  const files = roles.filter(r => r && r !== 'human').map(r => `roles/${r}.md`)
  const hits = line => { const t = line.match(/^- \[([^\]]*)\]/)?.[1] || ''; return own.test(t) || files.some(x => t.includes(x)) }
  return Object.fromEntries(PROPOSAL_SECTIONS.map(s => [s, props[s].filter(hits)]))
}

/** Move one line between sections by its exact text. A line that is no longer where the
 *  cockpit saw it — an agent rewrote it, you moved it in another tab — is a conflict,
 *  not a guess. A missing heading is added at the end, so a proposals.md from before
 *  Declined existed gains it the first time you decline something. */
export function moveProposal (text, line, from, to) {
  if (from === to || ![from, to].every(s => PROPOSAL_SECTIONS.includes(s))) throw new HttpError(400, `cannot move a proposal from '${from}' to '${to}'`)
  const lines = String(text).split('\n')
  let on = null
  const at = lines.findIndex(l => { if (l.startsWith('## ')) { on = l; return false } return on === `## ${from}` && l === line })
  if (at < 0) throw new HttpError(409, `that proposal is no longer under ## ${from} — reload`)
  lines.splice(at, 1)
  if (!lines[at - 1]?.trim() && !lines[at]?.trim()) lines.splice(at, 1) // no double gap where it was
  let h = lines.indexOf(`## ${to}`)
  if (h < 0) {
    while (lines.length && !lines.at(-1).trim()) lines.pop()
    lines.push('', `## ${to}`)
    h = lines.length - 1
  }
  let end = h + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end++
  while (end > h + 1 && !lines[end - 1].trim()) end--
  lines.splice(end, 0, ...(end === h + 1 ? ['', line] : [line]))
  return lines.join('\n')
}

/** brain-shoot writes report.json with `screenshot` as the HOST path it was handed
 *  (templates/bin/brain-shoot:6,29) — meaningless in this container. Re-derive from the
 *  report's own location. The qa/<name>/ folder is agent-chosen, so glob rather than assume. */
function qaReports (project) {
  const qa = join(MEM, 'projects', project, 'qa')
  return dirs(qa).flatMap(run => {
    let entries
    try { entries = JSON.parse(read(join(qa, run, 'report.json')) || 'null') } catch { return [] }
    if (!Array.isArray(entries)) return []
    return [{
      run,
      shots: entries.map(e => ({
        url: e.url, width: e.width, status: e.status, errors: e.errors || [],
        // Added by brain-shoot alongside the pixels: the checks a screenshot cannot
        // show. Older runs have none of these, so every reader must tolerate absent.
        contrast: e.contrast || [], structure: e.structure || [], images: e.images || null,
        img: e.screenshot ? `/qa/${project}/${run}/${basename(e.screenshot)}` : null
      }))
    }]
  })
}

/** Add skill names to a repo's line in skills.list, or append the line if it has none.
 *  Every other line keeps its bytes, so the comment header, the keep: line and the blank
 *  lines survive. Lives here rather than in the browser so it is covered by ui/test.mjs. */
export function normRepo (r) {
  return String(r || '').trim()
    .replace(/^git@github\.com:/, '').replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '').replace(/\/+$/, '')
}

export function addSkillSource (text, repo, names) {
  const clean = names.map(n => String(n).trim()).filter(Boolean)
  if (!clean.length) throw new HttpError(400, 'no skills given')
  for (const n of clean) if (!/^[A-Za-z0-9._-]+$/.test(n)) throw new HttpError(400, `bad skill name '${n}'`)
  if (!repo || /\s/.test(repo)) throw new HttpError(400, 'a repo cannot contain whitespace')
  const before = text.replace(/\n+$/, '').split('\n')
  const lines = [...before]
  const i = lines.findIndex(l => {
    const t = l.trim().split(/\s+/)
    return t[0] && !t[0].startsWith('#') && t[0] !== 'keep:' && normRepo(t[0]) === normRepo(repo)
  })
  if (i >= 0) {
    const t = lines[i].trim().split(/\s+/)
    lines[i] = [t[0], ...new Set([...t.slice(1), ...clean])].join(' ')
  } else lines.push(`${repo} ${clean.join(' ')}`)
  // Nothing may go missing: adding a skill must never drop a line.
  if (lines.length < before.length) throw new HttpError(500, 'refusing a write that would drop lines')
  return lines.join('\n')
}

/** The inverse of addSkillSource: drop one skill name from whichever line declares it.
 *  A repo line with no names left is removed outright — it would install everything in
 *  the repo and the same sync would prune it all back out, which the lint warns about. */
export function removeSkillSource (text, name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name || '')) throw new HttpError(400, `bad skill name '${name}'`)
  const before = text.replace(/\n+$/, '').split('\n')
  const out = []
  let hit = false
  for (const line of before) {
    const t = line.trim().split(/\s+/).filter(Boolean)
    if (!t.length || t[0].startsWith('#') || !t.slice(1).includes(name)) { out.push(line); continue }
    hit = true
    const kept = t.slice(1).filter(n => n !== name)
    if (kept.length) out.push([t[0], ...kept].join(' '))
  }
  if (!hit) throw new HttpError(404, `'${name}' is not declared in skills.list`)
  // Nothing unrelated may go missing: at most the one emptied line disappears.
  if (out.length < before.length - 1) throw new HttpError(500, 'refusing a write that would drop lines')
  return out.join('\n')
}

/** What an app brings is the app's: its playbooks name its roles, its roles name its skills,
 *  so taking one out breaks the app. It goes with the app, from Admin → Apps. */
function refuseAppOwned (kind, app, name) {
  if (app) throw new HttpError(409, `the ${kind} '${name}' comes with the app '${app}' and goes when the app does: uninstall it in Admin → Apps (brain app remove ${app})`)
}

/** skills.list in the base only: a line of an app's skills.list is the app's. */
export function removeBaseSkillSource (name) {
  refuseAppOwned('skill', skills().declared.find(d => d.name === name && d.source === 'repo' && d.app)?.app, name)
  const rel = 'system/skills.list'
  const { content } = readTracked(rel)
  return writeTracked(rel, removeSkillSource(content, name), content)
}

/** An own skill is a directory under system/skills. Deleting it drops the name from the
 *  keep list, so the next sync-skills is what actually removes it from the sbx store. */
export function deleteOwnSkill (dir) {
  if (!/^[A-Za-z0-9._-]+$/.test(dir || '')) throw new HttpError(400, `bad skill directory '${dir}'`)
  refuseAppOwned('skill', skills().own.find(s => s.dir === dir)?.app, dir)
  const abs = join(SYS, 'skills', dir)
  if (abs !== safePath(`system/skills/${dir}`)) throw new HttpError(400, 'bad skill path')
  if (!existsSync(abs)) throw new HttpError(404, `no skill directory '${dir}'`)
  rmSync(abs, { recursive: true, force: true })
  return { deleted: dir }
}

// The name becomes a directory and a `brain new <playbook>` argument, so keep it to
// what is safe in both.
const PLAYBOOK_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

const STARTER_PHASES = [
  ['plan', 'planner', ''],
  ['build', 'builder', ''],
  ['code-review', 'code-reviewer', 'builder'],
  ['retro', 'retro', '']
]

const ROLE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

function roleDoc (name) {
  if (!ROLE_NAME.test(name || '')) {
    throw new HttpError(400, `'${name}' is not a usable role name: lowercase letters, digits and dashes, starting with a letter or digit`)
  }
  const abs = join(SYS, 'roles', `${name}.md`)
  if (abs !== safePath(`system/roles/${name}.md`)) throw new HttpError(400, 'bad role path')
  return abs
}

/** A role is two things that must agree: a line in roles.conf (which engine runs it)
 *  and system/roles/<name>.md (what it is told to do). Creating one without the other
 *  is the failure the lint reports, so both are written here or neither is. */
export function createRole ({ name, engine = 'claude', model = 'default', effort = '', purpose = '' }) {
  const abs = roleDoc(name)
  const conf = join(SYS, 'roles.conf')
  const text = read(conf) || ''
  if (dataRows(columns(text)).some(r => r.fields[0] === name)) throw new HttpError(409, `'${name}' is already in roles.conf`)
  if (existsSync(abs)) throw new HttpError(409, `system/roles/${name}.md already exists`)

  const line = String(purpose).replace(/[\r\n]+/g, ' ').trim()
  writeAtomic(abs, [
    `# Role: ${name}`,
    line || 'One line: what this role is for.',
    '',
    'Do:',
    '1. ',
    '',
    `Output: \`phases/<phase>.md\` with what you did, where the outputs are, and what the next role must know.`,
    "Don't: "
  ].join('\n'))
  appendRoleLine(name, engine, model, effort)
  return { role: name, doc: `system/roles/${name}.md` }
}

/** Append in roles.conf's own columns; setRoleLine keeps a row's existing spacing, so
 *  the padding has to be right here. Running it after still buys the validation. */
function appendRoleLine (name, engine, model, effort) {
  const conf = join(SYS, 'roles.conf')
  const text = read(conf) || ''
  const rows = dataRows(columns(text))
  const w = (i, min) => Math.max(min, ...rows.map(r => (r.fields[i] || '').length + 2))
  const pad = (v, to) => v + ' '.repeat(Math.max(1, to - v.length))
  const row = pad(name, w(0, 20)) + pad(engine, w(1, 9)) + (model || 'default')
  writeAtomic(conf, `${text.replace(/\n+$/, '')}\n${row}\n`)
  writeAtomic(conf, setRoleLine(read(conf), name, engine, model || 'default', effort))
}

/** Refuses while a playbook still names the role, in either column: bin/brain reads the
 *  role straight out of phases, so removing it turns that phase into a hard failure. */
export function deleteRole (name) {
  const abs = roleDoc(name)
  refuseAppOwned('role', roles().find(r => r.role === name)?.app, name)
  const conf = join(SYS, 'roles.conf')
  const text = read(conf) || ''
  const row = dataRows(columns(text)).find(r => r.fields[0] === name)
  if (!row && !existsSync(abs)) throw new HttpError(404, `no role '${name}'`)

  const users = []
  for (const pb of playbooks()) {
    for (const ph of pb.phases) {
      if (ph.role === name) users.push(`${pb.name}/${ph.phase}`)
      if (ph.fix === name) users.push(`${pb.name}/${ph.phase} (fix-role)`)
    }
  }
  if (users.length) throw new HttpError(409, `${users.join(', ')} still use this role. Point those phases somewhere else first.`)

  if (row) writeAtomic(conf, text.split('\n').filter((_, i) => i !== row.i).join('\n'))
  if (existsSync(abs)) unlinkSync(abs)
  return { deleted: name }
}

/** Rewrite one row of a playbook's phases file. Single-line like setRoleLine, so the
 *  header comment, blank lines and any hand alignment elsewhere survive untouched. */
export function setPhaseRole (text, phase, role, fix = '') {
  const rows = dataRows(columns(text))
  const row = rows.find(r => r.fields[0] === phase)
  if (!row) throw new HttpError(404, `no phase '${phase}' in this playbook`)
  const known = new Set(roles().map(r => r.role))
  for (const [col, v] of [['role', role], ['fix-role', fix]]) {
    if (!v) continue
    if (v === 'human') { if (col === 'role') continue; throw new HttpError(400, "'human' cannot be a fix-role") }
    if (!known.has(v)) throw new HttpError(400, `${col} '${v}' is not in roles.conf`)
  }
  if (!role) throw new HttpError(400, 'a phase needs a role')
  const w = (i, min) => Math.max(min, ...rows.map(r => (r.fields[i] || '').length + 2))
  const c2 = w(0, 15), c3 = w(1, 18)
  const pad = (v, to) => v + ' '.repeat(Math.max(1, to - v.length))
  const lines = text.split('\n')
  lines[row.i] = (pad(phase, c2) + pad(role, c3) + fix).trimEnd()
  return lines.join('\n')
}

function playbookDir (name) {
  if (!PLAYBOOK_NAME.test(name || '')) {
    throw new HttpError(400, `'${name}' is not a usable playbook name: lowercase letters, digits and dashes, starting with a letter or digit`)
  }
  // An installed app's playbook when one has it; otherwise where a new one goes.
  const dir = inRoots(`playbooks/${name}`) || join(SYS, 'playbooks', name)
  if (dir !== safePath(relOf(dir))) throw new HttpError(400, 'bad playbook path')
  return dir
}
export const playbookRel = name => relOf(playbookDir(name))

/** Create a playbook, either as a working skeleton or as a copy of an existing one.
 *  Copying is what docs/playbooks.md already tells you to do by hand, and it is the common
 *  case: most playbooks are a variation on one you already have. */
export function createPlaybook ({ name, description = '', from = '' }) {
  const dir = playbookDir(name)
  if (existsSync(dir)) throw new HttpError(409, `playbook '${name}' already exists`)
  const desc = String(description).replace(/[\r\n]+/g, ' ').trim()

  if (from) {
    let src = playbookDir(from)
    if (!existsSync(src)) src = join(BRAIN, 'examples', 'playbooks', basename(playbookDir(from)))
    if (!existsSync(src)) throw new HttpError(404, `no playbook or example '${from}' to copy`)
    cpSync(src, dir, { recursive: true })
    const mdPath = join(dir, 'playbook.md')
    const md = read(mdPath) || ''
    const lines = md.split('\n')
    const t = lines.findIndex(l => l.startsWith('# '))
    if (t >= 0) lines[t] = `# Playbook: ${name}`
    const d = lines.findIndex(l => l.startsWith('> '))
    if (desc && d >= 0) lines[d] = `> ${desc}`
    else if (desc) lines.splice(t + 1, 0, `> ${desc}`)
    writeAtomic(mdPath, lines.join('\n'))
    return { name, copiedFrom: from }
  }

  mkdirSync(dir, { recursive: true })
  const pad = (v, w) => v + ' '.repeat(Math.max(1, w - v.length))
  writeAtomic(join(dir, 'phases'), [
    '# phase        role              fix-role (who fixes when this review FAILs)',
    ...STARTER_PHASES.map(([p, r, f]) => (pad(p, 15) + pad(r, 18) + f).trimEnd())
  ].join('\n'))
  writeAtomic(join(dir, 'playbook.md'), [
    `# Playbook: ${name}`,
    `> ${desc || 'Describe this dev path in one line. brain playbooks shows it.'}`,
    '',
    'What the agent should know about this path before any phase runs.',
    '',
    ...STARTER_PHASES.flatMap(([p, r, f]) => [
      `## ${p}`,
      `What the '${r}' role does in this phase, and the gate it has to pass.` +
        (f ? ` On FAIL the '${f}' role fixes it.` : ''),
      ''
    ])
  ].join('\n').trimEnd())
  writeAtomic(join(dir, 'brief.md'), read(join(SYS, 'brief-template.md')) || '# Brief\n')
  return { name, copiedFrom: null }
}

/** Refuses while any project still points at it: project.env carries PLAYBOOK=<name>
 *  and load_project dies without the phases file, so brain status and brain run would
 *  both break for those projects. */
export function deletePlaybook (name) {
  const dir = playbookDir(name)
  refuseAppOwned('playbook', appOf(dir), name)
  if (!existsSync(dir)) throw new HttpError(404, `no playbook '${name}'`)
  const users = projects().filter(p => p.playbook === name)
  if (users.length) {
    throw new HttpError(409, `${users.map(u => u.name).join(', ')} still use${users.length === 1 ? 's' : ''} this playbook. Deleting it makes brain status and brain run fail for ${users.length === 1 ? 'that project' : 'them'}.`)
  }
  rmSync(dir, { recursive: true, force: true })
  return { deleted: name }
}

export function clients () {
  if (!clientsOn()) return []
  return dirs(join(MEM, 'clients')).map(slug => ({ slug, path: `memory/clients/${slug}/profile.md` }))
}

/** The wiki. Summary is the page's first prose line, which BRAIN.md asks for right
 *  under the H1 — the same line the agent is supposed to put in index.md. */
/** examples/playbooks ships with the repo but is never loaded: a playbook is how a
 *  team works, so system/playbooks starts empty and these are only copy sources. */
export function examples () {
  return dirs(join(BRAIN, 'examples', 'playbooks')).map(name => ({
    name,
    description: parsePlaybookMd(read(join(BRAIN, 'examples', 'playbooks', name, 'playbook.md')) || '').description
  }))
}

/** Ingest: the human drops material in, an agent reads it. Two homes of the same shape.
 *  `memory/sources/` is the brain's own — material any project may need, compiled into
 *  knowledge/. `memory/projects/<name>/sources/` is one project's, which is where most
 *  material actually belongs: a client's brand book, their old contract, a transcript of
 *  their kickoff call are not knowledge about the world, and putting them in the shared
 *  pile means the next project's agents read someone else's brand guide.
 *  Raw sources are immutable, so a name collision gets a suffix instead of an overwrite. */
const sourcesRel = (project, file = '') => (project ? `memory/projects/${project}/sources` : 'memory/sources') + (file ? `/${file}` : '')
const sourcesDir = project => join(BRAIN, sourcesRel(project))

export function sources (project = '') {
  const names = ls(sourcesDir(project)).filter(d => d.isFile() && !d.name.startsWith('.')).map(d => d.name).sort().reverse()
  // Nothing dropped in yet is the common case, and the citation scan below reads every
  // knowledge page or every phase summary — so it only runs when there is something to
  // look for. /api/state is polled.
  if (!names.length) return []
  /** Cited = something wrote the filename down, which is what BRAIN.md asks for. For the
   *  brain's own sources that is a knowledge page; for a project's it is the summary of
   *  the phase that read it, or decisions.md. Either way it answers the same question:
   *  has anyone actually used this, or is it still work waiting? */
  const pdir = join(MEM, 'projects', project)
  const corpus = (project
    ? [read(join(pdir, 'decisions.md')), ...ls(join(pdir, 'phases')).filter(d => d.isFile() && d.name.endsWith('.md')).map(d => read(join(pdir, 'phases', d.name)))]
    : ls(join(MEM, 'knowledge')).filter(k => k.isFile()).map(k => read(join(MEM, 'knowledge', k.name)))
  ).filter(Boolean).join('\n')
  return names.map(name => ({ name, cited: corpus.includes(name), path: sourcesRel(project, name) }))
}

/** Where a dropped-in file goes. Besides a project's and the brain's own: a project the
 *  cockpit has staged but the host has not made yet (its files move in with it), and a
 *  client, for an input asked once per client — listed in the profile under its label. */
function sourceTarget ({ project = '', staged = '', client = '', playbook = '', input = '' }) {
  if (staged) {
    if (!PLAYBOOK_NAME.test(staged)) throw new HttpError(400, 'bad project name')
    if (existsSync(join(MEM, 'projects', staged, 'project.env'))) throw new HttpError(409, `project '${staged}' already exists`)
    if (existsSync(join(MEM, '.new', staged, 'request')) && !existsSync(join(MEM, '.new', staged, 'error'))) throw new HttpError(409, `'${staged}' is already being created`)
    return { rel: `memory/.new/${staged}/sources`, logRel: `projects/${staged}/sources` }
  }
  if (client) {
    const { cl } = clientDir(client)
    const inp = input ? playbookInputs(playbook).find(i => i.name === input && i.per === 'client' && i.type === 'files') : null
    if (input && !inp) throw new HttpError(400, `'${input}' is not a per-client file input of '${playbook}'`)
    return {
      rel: `memory/clients/${cl}/sources`, logRel: `clients/${cl}/sources`,
      after: file => {
        if (!inp) return
        const pf = join(MEM, 'clients', cl, 'profile.md')
        const prof = read(pf) || `# Client: ${cl}\n`
        const have = sectionValue(prof, inp)
        writeAtomic(pf, setSection(prof, inp.label, [...have, file].map(f => `- sources/${f}`).join('\n')))
      }
    }
  }
  if (project && !existsSync(join(MEM, 'projects', project, 'project.env'))) throw new HttpError(404, `no project '${project}'`)
  return { rel: sourcesRel(project), logRel: sourcesRel(project).replace(/^memory\//, '') }
}

export function addSource ({ name, data, ...where }) {
  const target = sourceTarget(where)
  const dir = join(BRAIN, target.rel)
  const clean = String(name || '').replace(/^.*[\\/]/, '').trim()
  if (!clean) throw new HttpError(400, 'the file needs a name')
  const dot = clean.lastIndexOf('.')
  const ext = dot > 0 ? clean.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : ''
  const slug = (dot > 0 ? clean.slice(0, dot) : clean).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'source'
  const day = new Date().toISOString().slice(0, 10)
  let file = `${day}-${slug}${ext}`
  for (let i = 2; existsSync(join(dir, file)); i++) file = `${day}-${slug}-${i}${ext}`
  const buf = Buffer.from(String(data || ''), 'base64')
  if (!buf.length) throw new HttpError(400, 'the file is empty')
  mkdirSync(dir, { recursive: true })
  // The guard, not a formality: the project, client or staged name reaches here from the
  // browser, and the whole path is built from it.
  if (safePath(`${target.rel}/${file}`) !== join(dir, file)) throw new HttpError(400, 'bad source path')
  writeFileSync(join(dir, file), buf)
  if (target.after) target.after(file)
  appendFileSync(join(MEM, 'log.md'), `\n## [${day}] ingest | ${clean}\nDropped into ${target.logRel}/${file}. Not cited yet.\n`)
  return { file: `${target.rel}/${file}`, name: file, bytes: buf.length }
}

export function knowledge () {
  return ls(join(MEM, 'knowledge')).filter(d => d.isFile() && d.name.endsWith('.md')).map(d => d.name).sort()
    .map(file => {
      const body = read(join(MEM, 'knowledge', file)) || ''
      const summary = body.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('tags:')) || ''
      const cites = [...new Set([...body.matchAll(/projects\/([A-Za-z0-9._-]+)/g)].map(m => m[1]))]
      return { name: file.replace(/\.md$/, ''), path: `memory/knowledge/${file}`, summary, cites, tags: pageTags(body) }
    })
}

/** A page's tags, from the "tags:" line under its title — bin/brain page_tags. */
const pageTags = body => ((body.split('\n').slice(0, 3).find(l => l.startsWith('tags:')) || '').slice(5).match(/[^\s,]+/g) || [])

/** The tags a project's agents read — bin/brain knowledge_scope, same order: shared, the
 *  playbook's app and the apps it requires, then every wiki tag a word of its ## Stack starts with. */
export function knowledgeScope (playbook, project) {
  const app = appOf(playbookDir(playbook) + '/')
  const requires = app ? ((read(join(SYS, 'apps', app, 'app.conf')) || '').match(/^requires[ \t]+(.*)$/m)?.[1].trim().split(/\s+/) || []) : []
  const stack = (briefSections(read(join(MEM, 'projects', project, 'brief.md')) || '').find(s => s.heading === 'Stack')?.body || '').toLowerCase()
  const named = [...new Set(knowledge().flatMap(k => k.tags))].sort()
    .filter(t => !existsSync(join(SYS, 'apps', t, 'app.conf')) && new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(stack))
  return [...new Set(['shared', ...(app ? [app] : []), ...requires, ...named])]
}

/** Exactly what `brain run` would send: header() plus cmd_run's task, the review and
 *  contract lines, and the playbook's preamble and phase section (bin/brain
 *  playbook_preamble / phase_section). The only way to confirm a playbook.md edit
 *  actually reaches the agent, given the byte-exact section match. */
export function promptPreview (project, phase) {
  const p = projects().find(x => x.name === project)
  if (!p) throw new HttpError(404, `no project '${project}'`)
  const ph = p.phases.find(x => x.phase === phase)
  if (!ph) throw new HttpError(404, `phase '${phase}' not in playbook '${p.playbook}'`)
  const pdir = `${HOST_BRAIN}/memory/projects/${project}`
  const sys = `${HOST_BRAIN}/system`
  const md = `${pdir}/phases/${phase}.md`
  const fixing = !!ph.fix && ph.state === 'awaiting-fix'
  const role = fixing ? ph.fix : ph.role
  const review = !fixing && (!!ph.fix || REVIEW_ROLE.test(ph.role))
  const scope = knowledgeScope(p.playbook, project)
  // bin/brain app_knowledge: the knowledge/ an app in scope ships, read-only.
  const appKnowledge = scope.filter(a => existsSync(join(SYS, 'apps', a, 'knowledge')) && readdirSync(join(SYS, 'apps', a, 'knowledge')).some(f => f.endsWith('.md')))
    .map(a => `${sys}/apps/${a}/knowledge`)
  const header = [
    'You are working inside the agent brain system.',
    `Brain instructions (read-only): ${sys}`,
    `Brain memory (read-write):      ${HOST_BRAIN}/memory`,
    `Project: ${project}   Playbook: ${p.playbook}   Project memory: ${pdir}`,
    `Client memory: ${p.client ? `${HOST_BRAIN}/memory/clients/${p.client}` : 'none'}`,
    `Knowledge scope: ${scope.join(' ')} — in index.md, read only the Knowledge sections tagged with one of these.`,
    ...(appKnowledge.length ? [`App knowledge (read-only, shipped with the apps): ${appKnowledge.join(' ')} — open the pages there that fit your task.`] : []),
    `First read ${sys}/BRAIN.md and follow it.`
  ].join('\n')
  const lines = []
  if (fixing) {
    lines.push(`Fix round ${ph.fails} for review phase '${phase}'. Read the numbered fix list in ${md} and fix every item as the role '${role}'. Do not mark anything as done, and do not write ${md} — it is the reviewer's file, and touching it restarts this round. When all items are addressed, write one line per item saying what you changed to ${pdir}/phases/${phase}.fixed, naming each OPEN defect id from the summary's ## Defects block on its line — the host rejects a fix handoff that leaves one out. Creating that file is what tells brain the round is done, and it is what the reviewer reads next.`)
  } else {
    lines.push(`Run phase '${phase}' of playbook '${p.playbook}' as the role '${role}'.`,
      `Follow ${HOST_BRAIN}/${roleDocRel(role)} and the '${phase}' section of ${HOST_BRAIN}/${playbookRel(p.playbook)}/playbook.md.`,
      `When this phase's own work is complete: write your summary to ${md} and create ${pdir}/phases/${phase}.done (see BRAIN.md for review phases). A human gate that follows this phase is a separate phase: do not wait for its approval, because this .done is what hands your work to it.`)
    if (ph.state === 'awaiting-review') lines.push(`Fix round ${ph.fails} has landed since your last review: ${pdir}/phases/${phase}.fixed is the fix-role's account of what it changed. Check every item on your previous list as well as re-running your own checks. Your new summary replaces the old one: carry every defect id from its ## Defects block into yours, as VERIFIED if it is fixed or OPEN if it is not.`)
    const summary = read(join(MEM, 'projects', project, 'phases', `${phase}.md`)) || ''
    if (!review && /^## Feedback from the human/m.test(summary)) lines.push(`A human reopened this phase. Read the '## Feedback from the human' section at the end of ${md} first: it is why this phase is running again, and your new summary must say how you addressed each item.`)
  }
  if (review) lines.push(`This is a review handoff: write exactly one RESULT: PASS or RESULT: FAIL line in the summary, then append a matching YYYY-MM-DD PASS or YYYY-MM-DD FAIL line to ${pdir}/phases/${phase}.log. Create .done only on PASS. The host checks all three files, and the summary's ## Defects block (BRAIN.md, Review phases): FAIL needs an OPEN defect, PASS none, and every id the previous summary had OPEN must still be listed.`)
  if (existsSync(join(playbookDir(p.playbook), 'contracts', phase))) lines.push(`The host enforces ${HOST_BRAIN}/${playbookRel(p.playbook)}/contracts/${phase}. Required evidence must be produced in this attempt. Verification commands run inside the sandbox after your handoff.`)
  const book = (read(join(playbookDir(p.playbook), 'playbook.md')) || '').split('\n')
  if (book.at(-1) === '') book.pop()
  const pre = [], sec = []
  let quote = false, on = false
  for (const [i, l] of book.entries()) {
    if (l.startsWith('## ')) break
    if (i === 0 && l.startsWith('# ')) continue
    if (l.startsWith('> ') && !quote) { quote = true; continue }
    pre.push(l)
  }
  for (const l of book) {
    if (l === `## ${phase}`) { on = true; continue }
    if (l.startsWith('## ')) on = false
    else if (on) sec.push(l)
  }
  const block = a => a.slice(a.findIndex(l => l.trim())).join('\n').replace(/\n+$/, '')
  const prompt = `${header}\n${lines.join('\n')}\n\n── What every phase of the '${p.playbook}' playbook is told ──\n${pre.some(l => l.trim()) ? block(pre) : ''}\n\n── The '${phase}' section of the playbook ──\n${sec.join('\n').replace(/\n+$/, '')}`
  return { role, fixing, human: ph.role === 'human', prompt }
}

// ---------- brandkit --------------------------------------------------------
// The brandkit is the one phase output that does not live in brain memory: the playbook
// sends it to `brandkit/` in the PROJECT repo. Only ~/dev is mounted here, read-only, so
// a project kept outside it says so instead of looking like a project with no brandkit.

const BK_IMG = /\.(png|jpe?g|svg|webp|avif|gif)$/i
const BK_TEXT = /\.(md|css|json|txt|ya?ml)$/i
const BK_CAP = 300_000

/** One of a project's own output directories inside the read-only code mount, or null
 *  when the project lives outside ~/dev and the cockpit therefore cannot see its code. */
function projectSubdir (p, name) {
  if (!p.hostDir || !p.visible) return null
  return join(DEV, p.hostDir.slice(HOST_DEV.length + 1), name)
}
const brandkitRoot = p => projectSubdir(p, 'brandkit')

/** The built pages, so the cockpit can link to the real thing instead of showing
 *  pictures of it. Only the HTML is listed; everything around it (css, js, fonts,
 *  images) is served on demand because the pages reference it. */
export function design (project) {
  const p = projects().find(x => x.name === project)
  if (!p) throw new HttpError(404, `no project '${project}'`)
  const root = projectSubdir(p, 'design')
  if (!root) return { present: false, why: 'the project code is not readable here' }
  if (!existsSync(root)) return { present: false, why: `no design/ in ${p.hostDir} yet` }
  const pages = []
  const walk = (dir, rel, depth) => {
    for (const e of ls(dir).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === '_build') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (depth > 0) walk(join(dir, e.name), r, depth - 1) } else if (/\.html?$/i.test(e.name)) {
        pages.push({ path: r, url: `/design/${encodeURIComponent(project)}/${r.split('/').map(encodeURIComponent).join('/')}` })
      }
    }
  }
  walk(root, '', 3)
  // The styleguide is the specimen catalogue every block is ported from, and index is
  // the way in; the playbook treats both as the things a human actually opens.
  const rank = f => (/^styleguide\.html?$/i.test(f.path) ? 0 : /^index\.html?$/i.test(f.path) ? 1 : 2)
  pages.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
  return { present: true, hostDir: `${p.hostDir}/design`, pages }
}

/** The Webflow paste for a project's `content/article.md`: fields, rich-text body, images,
 *  tables and JSON-LD. Built by the seo-content skill's own parser — the same one its
 *  measured checks read — so what was checked is what gets pasted. Re-imported when the
 *  script changes, since a skill can be edited while the cockpit runs. */
export async function article (project) {
  const p = projects().find(x => x.name === project)
  if (!p) throw new HttpError(404, `no project '${project}'`)
  const rel = `${p.mem}/content/article.md`, abs = safePath(rel)
  if (!existsSync(abs)) throw new HttpError(404, `no ${rel} yet`)
  const mod = inRoots('skills/seo-content/article.mjs') || join(SYS, 'skills', 'seo-content', 'article.mjs')
  if (!existsSync(mod)) throw new HttpError(404, 'the seo-content skill is not installed, and it is what builds the Webflow paste')
  const { articleHtml } = await import(`${pathToFileURL(mod).href}?v=${statSync(mod).mtimeMs}`)
  return { path: rel, ...articleHtml(read(abs)) }
}

/** Absolute path of one file under a project output dir, for the static routes. */
export function projectFile (project, sub, rel) {
  const p = projects().find(x => x.name === project)
  if (!p) throw new HttpError(404, `no project '${project}'`)
  const root = projectSubdir(p, sub)
  if (!root) throw new HttpError(404, 'project code is not readable here')
  return safePath(rel, root)
}

/** `--token: value` pairs whose value is a literal colour. A palette cannot be approved
 *  by reading sixteen hex strings, which is the whole reason this is parsed out. */
function colourTokens (docs) {
  const css = docs.filter(d => /\.css$/i.test(d.path)).map(d => d.content).join('\n')
  const out = []
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const value = m[2].trim()
    // var() and currentColor cannot be painted on their own, so they are not swatches.
    if (/^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\()/i.test(value)) {
      out.push({ name: `--${m[1]}`, value })
    }
  }
  return out
}

export function brandkit (project) {
  const p = projects().find(x => x.name === project)
  if (!p) throw new HttpError(404, `no project '${project}'`)
  const root = brandkitRoot(p)
  if (!root) {
    return { present: false, why: p.hostDir
      ? `${p.hostDir} is outside ${HOST_DEV}, the only code mount the cockpit has`
      : 'the project has no PROJECT_DIR, so there is no repo to look in' }
  }
  if (!existsSync(root)) return { present: false, why: `no brandkit/ in ${p.hostDir} yet` }

  const images = [], docs = []
  const walk = (dir, rel, depth) => {
    for (const e of ls(dir).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (depth > 0) walk(join(dir, e.name), r, depth - 1) } else if (BK_IMG.test(e.name)) {
        images.push({ path: r, url: `/brandkit/${encodeURIComponent(project)}/${r.split('/').map(encodeURIComponent).join('/')}` })
      } else if (BK_TEXT.test(e.name)) {
        docs.push({ path: r, content: (read(join(dir, e.name)) || '').slice(0, BK_CAP) })
      }
    }
  }
  walk(root, '', 2)
  return { present: true, hostDir: `${p.hostDir}/brandkit`, images, docs, colours: colourTokens(docs) }
}

/** Absolute path of one brandkit file, for the image route. */
export const brandkitFile = (project, rel) => projectFile(project, 'brandkit', rel)

// ---------- human gates ------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10)

function gate (project, phase) {
  const p = projects().find(x => x.name === project)
  if (!p) throw new HttpError(404, `no project '${project}'`)
  const ph = p.phases.find(x => x.phase === phase)
  if (!ph) throw new HttpError(404, `phase '${phase}' not in playbook '${p.playbook}'`)
  // A verdict under a running agent would race its own handoff files — any phase, since
  // reopen moves every later phase's .done too.
  const busy = p.phases.find(x => x.state === 'running')
  if (busy) throw new HttpError(409, `an agent is running '${busy.phase}' — give the verdict once it stops`)
  const dir = join(MEM, 'projects', project, 'phases')
  mkdirSync(dir, { recursive: true })
  return { p, ph, dir, f: e => join(dir, phase + e) }
}

/** bin/run-record.sh human: one write-once record per human verdict, beside the agent
 *  attempts, so every change of phase state has one. `lines` are [kind, value] pairs:
 *  item, waived, deferred, verified, reopened. Returns the record's directory. */
function humanRecord (project, playbook, phase, outcome, lines) {
  const base = join(BRAIN, '.runs', project, phase)
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const dir = mkdtempSync(join(base, `${now.replace(/[-:]/g, '')}-`))
  const id = basename(dir), f = e => join(MEM, 'projects', project, 'phases', phase + e)
  writeFileSync(join(dir, 'verdict.txt'), lines.map(([k, v]) => `${k} ${v}\n`).join(''))
  if (existsSync(f('.md'))) copyFileSync(f('.md'), join(dir, 'summary.md'))
  if (existsSync(f('.log'))) copyFileSync(f('.log'), join(dir, 'handoff.log'))
  const of = k => lines.filter(([x]) => x === k).map(([, v]) => v)
  writeFileSync(join(dir, 'plan.json'), JSON.stringify({ schema: 1, run_id: id, attempt_id: id, started: now, actor: 'human', project, playbook, phase, mode: 'verdict' }) + '\n')
  writeFileSync(join(dir, 'result.json'), JSON.stringify({
    schema: 1, run_id: id, ended: now, actor: 'human', exit_code: null,
    host_verdict: { outcome, scope: 'a human verdict; the host records it and checks nothing' },
    items: of('item'), defects: { waived: of('waived'), deferred: of('deferred'), verified: of('verified') }, reopened: of('reopened')
  }) + '\n')
  return dir
}

/** What the cockpit wants run next, left where `brain watch` on the host will find it.
 *  The container cannot start a run itself — it writes the wish, the host grants it, and
 *  only while you have `brain watch` open. One word, checked against the two that exist,
 *  because on the other side it names a command. */
const RUNNABLE = new Set(['run', 'auto'])
function requestRun (project, then) {
  if (!then) return null
  if (!RUNNABLE.has(then)) throw new HttpError(400, `'${then}' is not a brain command — run or auto`)
  writeFileSync(join(MEM, 'projects', project, '.run-request'), then + '\n')
  return then
}

/** `brain evolve`, asked for from the cockpit: the same hand-off as requestRun, for the
 *  brain rather than a project. An empty queue is refused here, where the reason can be
 *  shown, instead of in a Terminal window that opens only to die. */
export function requestEvolve (playbook = '') {
  if (!playbook) {
    const n = proposals(read(join(MEM, 'proposals.md'))).Accepted.length
    if (!n) throw new HttpError(400, 'nothing accepted — brain evolve applies ## Accepted and refuses to start on an empty one')
    writeFileSync(join(MEM, '.evolve-request'), 'evolve\n')
    return { started: 'evolve', accepted: n, watching: watching() }
  }
  // `brain playbook evolve <name>`: that playbook's accepted lines only. The name ends up
  // in a shell command on the host, so it has to be one that exists.
  const pb = PLAYBOOK_NAME.test(playbook) && playbooks().find(p => p.name === playbook)
  if (!pb) throw new HttpError(400, `no playbook '${playbook}'`)
  const n = pb.proposals.Accepted.length
  if (!n) throw new HttpError(400, `nothing accepted for ${playbook} — accept its proposals first`)
  writeFileSync(join(MEM, '.evolve-request'), `evolve ${playbook}\n`)
  return { started: `playbook evolve ${playbook}`, accepted: n, watching: watching() }
}

/** `brain playbook analyse <name>`, step one: it only files proposals, so it needs no
 *  accepted queue — just a playbook that exists, since the name ends up in a shell
 *  command on the host. Same request file as evolve: the host runs one at a time. */
export function requestAnalysis (playbook) {
  if (!PLAYBOOK_NAME.test(playbook || '') || !existsSync(join(playbookDir(playbook), 'phases'))) throw new HttpError(400, `no playbook '${playbook}'`)
  writeFileSync(join(MEM, '.evolve-request'), `analyse ${playbook}\n`)
  return { started: `playbook analyse ${playbook}`, watching: watching() }
}

/** An app's own settings page, from its app.conf: `secret` lines are keys for its MCP
 *  servers, `setting` lines plain values. A key never touches a tracked file: it is checked
 *  where the app says (401/403 there means a typo), then left for `brain watch` in a 0600
 *  gitignored memory/.secret-<name>.request that the host moves into sbx's secret store.
 *  Settings go to system/config/<app>.conf, outside the app's folder so an update keeps
 *  them, and inside system/ so a sandbox reads them at $BRAIN_SYSTEM/config/<app>.conf. */
function appConfig (name, lines) {
  const field = k => lines.filter(f => f[0] === k)
  const saved = Object.fromEntries((read(join(SYS, 'config', `${name}.conf`)) || '').split('\n')
    .map(l => l.trim().match(/^([a-z0-9_-]+)\s+(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
  return {
    secrets: field('secret').map(([, n, kind, check, ...label]) => {
      const status = (read(join(MEM, `.secret-${n}.status`)) || '').trim()
      return { name: n, kind, check: check === '-' ? '' : check, label: label.join(' '), status, connected: status.startsWith('connected'), pending: existsSync(join(MEM, `.secret-${n}.request`)) }
    }),
    // What the app's host code reported for the site the setting names now, never the key.
    credentials: field('host-credential').map(([, key, kind, setting, ...label]) => {
      let state = {}; try { state = JSON.parse(read(join(MEM, 'apps', name, `${key}-connection.json`)) || '{}') } catch {}
      const site = saved[setting] || field('setting').find(f => f[1] === setting)?.[3]
      const here = state.site === site
      return { name: key, kind, setting, label: label.join(' '), connected: here && state.connected === true, message: here ? state.message || '' : '', pending: existsSync(join(BRAIN, '.credentials-inbox', name, `${key}.request`)) }
    }),
    settings: field('setting').map(([, key, type, def, ...label]) => {
      const options = type === 'choice' ? def.split(',') : []
      return { key, type, options, def: options[0] ?? def, label: label.join(' '), value: saved[key] ?? options[0] ?? def }
    }),
    mcp: field('mcp').map(([, n, url]) => ({ name: n, url })),
    allow: field('allow').flatMap(f => f.slice(1).join(',').split(',').filter(Boolean))
  }
}
const appLines = dir => (read(join(dir, 'app.conf')) || '').split('\n').map(l => l.trim().split(/\s+/)).filter(f => f[0] && !f[0].startsWith('#'))
const appDirOf = name => sysRoots().slice(1).find(d => basename(d) === name)

/** The first paragraph of a README under its title — bin/brain's app_catalog, the same way. */
const readmeLead = text => {
  const out = []
  for (const [i, l] of (text || '').split('\n').entries()) {
    if (i === 0 && l.startsWith('#')) continue
    if (l.trim()) out.push(l.trim()); else if (out.length) break
  }
  return out.join(' ')
}
/** An app's README for its page in the store: the installed copy, else the catalog's. */
export function appReadme (name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name || '')) throw new HttpError(400, 'bad app name')
  const text = read(join(SYS, 'apps', name, 'README.md')) ?? read(join(MEM, '.apps-scan.d', `${name}.md`)) ?? read(join(MEM, '.apps-catalog.d', `${name}.md`))
  if (text === null) throw new HttpError(404, `no README for '${name}'`)
  return { name, text }
}

/** Where an installed app came from: its system/apps.lock line. */
function appLock (name) {
  const f = (read(join(SYS, 'apps.lock')) || '').split('\n').map(l => l.split(/\s+/)).find(f => f[0] === name)
  return f ? { source: f[1], commit: f[2], path: f[3] } : null
}
/** How many files this brain changed in an app since it was installed — bin/brain's
 *  app_changes, counted: the installed copy against system/apps/.base/<name>. */
function appChanges (name) {
  const files = (root, rel = '') => ls(join(root, rel)).flatMap(e => e.isDirectory() ? files(root, join(rel, e.name)) : [join(rel, e.name)])
  const a = join(SYS, 'apps', name), b = join(SYS, 'apps', '.base', name)
  if (!existsSync(b)) return 0
  const all = new Set([...files(a), ...files(b)])
  return [...all].filter(f => { try { return !readFileSync(join(a, f)).equals(readFileSync(join(b, f))) } catch { return true } }).length
}

/** memory/.apps-catalog (what the apps repo offers) or .apps-scan (what a repo the human
 *  named offers), both written by `brain watch`: the cockpit cannot clone a private repo. */
function appCatalog (file) {
  const text = read(join(MEM, file)) || ''
  const [, source = '', commit = '', at = ''] = text.split('\n')[0].match(/^# (\S+) (\S+) (.*)$/) || []
  return text ? {
    source, commit, at,
    apps: text.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
      const [name, version, label, icon, flags, update, desc, path] = l.split('\t')
      return { name, version, label, icon: icon || 'puzzle-piece', flags: (flags || '').split(',').filter(Boolean), update: update === 'yes', desc: desc || '', path: path || name }
    })
  } : null
}
/** The Studio's Apps page: the catalog, the last scan of another repo, and install, update,
 *  revert, remove and scan as a request brain watch runs, one at a time, with the outcome
 *  in .apps-status. */
export function appStore () {
  const [head = '', ...log] = (read(join(MEM, '.apps-status')) || '').split('\n')
  const [ok, verb, name, ...when] = head.split(' ')
  return {
    catalog: appCatalog('.apps-catalog'),
    scan: appCatalog('.apps-scan'),
    status: head ? { ok: ok === 'ok', verb, name, at: when.join(' '), log: log.join('\n').trim() } : null,
    pending: (read(join(MEM, '.apps-request')) || '').trim() || null,
    running: (read(join(MEM, '.apps-running')) || '').trim() || null
  }
}

/** memory/.base-update, written by brain watch: what the base's upstream has that this
 *  brain does not, oldest first. The Update button stages .update-request; brain watch
 *  runs brain update once no phase is running. */
export function baseUpdate () {
  const text = read(join(MEM, '.base-update'))
  if (!text) return null
  const [, head = '', upstream = '', at = ''] = text.split('\n')[0].match(/^# (\S+) (\S+) (.*)$/) || []
  const commits = text.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [sha, ...subject] = l.split('\t'); return { sha, subject: subject.join(' ') }
  })
  return { head, upstream, at, commits, requested: existsSync(join(MEM, '.update-request')) }
}
export function requestBaseUpdate () {
  if (!baseUpdate()?.commits.length) throw new HttpError(409, 'the brain is up to date — nothing to update')
  writeFileSync(join(MEM, '.update-request'), 'update\n')
  return { ok: true, watching: watching() }
}

// bin/brain's app_source_ok: owner/repo or a git URL, never a folder on the host or a git option.
const APP_SOURCE = /^([A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+|https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~/-]+|git@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+)$/
export function requestApps ({ verb, name = '', trust = false, force = false, confirm = '', from = '' }) {
  if (existsSync(join(MEM, '.apps-request')) || existsSync(join(MEM, '.apps-running'))) throw new HttpError(409, 'another app change is queued or running — wait for it')
  if (verb === 'catalog') { writeFileSync(join(MEM, '.apps-request'), 'catalog\n'); return { ok: true, watching: watching() } }
  if (verb === 'scan') {
    const src = String(name).trim().replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '')
    if (!APP_SOURCE.test(src) || src.includes('..')) throw new HttpError(400, `'${name}' is not a GitHub owner/repo or a git URL`)
    writeFileSync(join(MEM, '.apps-request'), `scan ${src}\n`); return { ok: true, watching: watching() }
  }
  if (!['install', 'update', 'remove', 'revert'].includes(verb)) throw new HttpError(400, `'${verb}' is not an app command`)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new HttpError(400, `'${name}' is not an app name`)
  const installed = existsSync(join(SYS, 'apps', name, 'app.conf'))
  if (verb === 'install' && installed) throw new HttpError(400, `'${name}' is already installed`)
  // From another repo: only what its last scan found, and only with the trust tick.
  const scan = appStore().scan, scanned = from && scan?.source === from && scan.apps.find(a => a.name === name)
  if (from && (verb !== 'install' || !scanned)) throw new HttpError(404, `'${name}' is not in the scan of ${from}`)
  if (from && !trust) throw new HttpError(400, `'${name}' is from ${from}: its commands run on your machine, so it needs your trust`)
  if (verb === 'install' && !from && !appStore().catalog?.apps.some(a => a.name === name)) throw new HttpError(404, `'${name}' is not in the catalog`)
  if (verb !== 'install' && !installed) throw new HttpError(404, `no app '${name}' installed`)
  if (verb === 'remove' && confirm !== name) throw new HttpError(400, 'type the app\'s name to confirm')
  writeFileSync(join(MEM, '.apps-request'), [verb, name, trust && 'trust', force && 'force', scanned && `from ${from} ${scanned.path}`].filter(Boolean).join(' ') + '\n')
  return { ok: true, watching: watching() }
}

export function saveAppSettings ({ app, values = {} }) {
  const dir = appDirOf(app); if (!dir) throw new HttpError(404, `no app '${app}'`)
  const conf = appConfig(app, appLines(dir))
  const out = conf.settings.map(s => {
    let v = String(values[s.key] ?? s.value).trim()
    if (s.type === 'toggle') v = v === 'off' ? 'off' : 'on'
    else if (s.type === 'choice' && !s.options.includes(v)) throw new HttpError(400, `${s.key}: one of ${s.options.join(', ')}`)
    else if (/[\n\r]/.test(v)) throw new HttpError(400, `${s.key}: one line`)
    return `${s.key} ${v || s.def}`
  })
  mkdirSync(join(SYS, 'config'), { recursive: true })
  writeAtomic(join(SYS, 'config', `${app}.conf`), [`# ${app}'s settings, set in the Studio (Admin → Apps). Its agents read them at $BRAIN_SYSTEM/config/${app}.conf.`, ...out].join('\n'))
  return { ok: true }
}

/** An app's `host-credential` (app-format skill): a key pair for the app's own host code,
 *  not an MCP key for sbx. Staged 0600 in .credentials-inbox/<app>/, outside memory/ and
 *  system/ so no sandbox ever mounts it; the app's <name>_watch checks it, keeps it where it
 *  keeps keys and deletes the file. Nothing here returns it. */
export function saveAppCredential ({ app, name, key = '', secret = '' }) {
  const dir = appDirOf(app); if (!dir) throw new HttpError(404, `no app '${app}'`)
  const lines = appLines(dir), spec = lines.find(f => f[0] === 'host-credential' && f[1] === name && f[2] === 'keypair')
  if (!spec || !/^[a-z0-9-]+$/.test(name)) throw new HttpError(400, `'${app}' has no host credential called '${name}'`)
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(key) || !/^[A-Za-z0-9_-]{1,200}$/.test(secret)) throw new HttpError(400, 'enter the API key and the API secret')
  const setting = appConfig(app, lines).settings.find(s => s.key === spec[3])
  if (!setting?.value) throw new HttpError(400, `save ${setting?.label || spec[3]} first`)
  const root = join(BRAIN, '.credentials-inbox', app); mkdirSync(root, { recursive: true, mode: 0o700 })
  try { writeFileSync(join(root, `${name}.request`), JSON.stringify({ site: setting.value, key, secret }) + '\n', { mode: 0o600, flag: 'wx' }) }
  catch (e) { if (e.code === 'EEXIST') throw new HttpError(409, 'a key pair is already waiting for the app to check it'); throw e }
  return { ok: true, watching: watching() }
}

export async function saveAppSecret ({ app, name, login = '', password = '', token = '' }) {
  const dir = appDirOf(app); if (!dir) throw new HttpError(404, `no app '${app}'`)
  const sec = appConfig(app, appLines(dir)).secrets.find(s => s.name === name)
  if (!sec) throw new HttpError(404, `the app '${app}' has no secret '${name}'`)
  if (sec.kind === 'basic') {
    login = String(login).trim(); password = String(password).trim()
    if (!login || !password || /[\s:]/.test(login) || /\s/.test(password)) throw new HttpError(400, 'enter the login and the password')
    token = Buffer.from(`${login}:${password}`).toString('base64')
  } else {
    token = String(token).trim()
    if (!/^[A-Za-z0-9+/=._~-]{8,4000}$/.test(token)) throw new HttpError(400, 'enter the token')
  }
  if (sec.check) {
    const r = await fetch(sec.check, { headers: { authorization: `${sec.kind === 'basic' ? 'Basic' : 'Bearer'} ${token}` }, signal: AbortSignal.timeout(12000) }).catch(() => null)
    if (!r) throw new HttpError(502, `could not reach ${new URL(sec.check).host} to check the key — try again`)
    if (r.status === 401 || r.status === 403) throw new HttpError(400, `${new URL(sec.check).host} refused the key (${r.status})`)
  }
  writeFileSync(join(MEM, `.secret-${name}.request`), token + '\n', { mode: 0o600 })
  try { unlinkSync(join(MEM, `.secret-${name}.status`)) } catch {}
  return { ok: true, watching: watching() }
}

/** Whether a `brain watch` is listening right now. It rewrites its heartbeat every two
 *  seconds, so anything older than three polls means nobody is there — and the cockpit
 *  has to say so, or Approve looks broken when it silently did exactly what it said. */
export function watching () {
  return Date.now() - mtime(join(MEM, '.watch')) < 8000
}

/** bin/brain cmd_approve: keep the agent's summary — the next role reads it as its
 *  handoff input — turn its verdict line to PASS, and close every OPEN defect as
 *  DEFERRED (when listed in `defer`), VERIFIED (a fix round landed after the summary and
 *  names it) or WAIVED. The note is the cockpit's own, after the approval line. */
export function approve (project, phase, note = '', then = '', defer = []) {
  const { p, f } = gate(project, phase)
  const prev = read(f('.md')) || ''
  const open = defects(prev).filter(d => d.state === 'OPEN').map(d => d.id)
  for (const id of defer) if (!open.includes(id)) throw new HttpError(400, `'${id}' is not an OPEN defect of '${phase}'`)
  const since = existsSync(f('.fixed')) && mtime(f('.fixed')) > mtime(f('.md'))
  const day = today()
  let body = approvedSummary(prev, since ? read(f('.fixed')) : '', day, since, defer)
  // A note line that is itself a verdict line would be read as one; quote it.
  if (note.trim()) body += note.trim().split('\n').map(l => VERDICT_LINE.test(l) ? `> ${l}` : l).join('\n') + '\n'
  const after = defects(body)
  const closed = open.map(id => [(after.find(d => d.id === id)?.state || 'waived').toLowerCase(), id])
  writeAtomic(f('.md'), body)
  appendFileSync(f('.log'), `${day} PASS\n`)
  writeFileSync(f('.done'), '')
  humanRecord(project, p.playbook, phase, 'approved', closed)
  return { ok: true, closed: closed.map(([st, id]) => `${st} ${id}`), started: requestRun(project, then), watching: watching() }
}

export function reject (project, phase, items = [], note = '', then = '') {
  const { p, ph } = gate(project, phase)
  if (!ph.fix) throw new HttpError(400, `phase '${phase}' has no fix role — send the work back to the phase that made it (reopen)`)
  const list = items.map(s => String(s).trim()).filter(Boolean)
  if (!list.length) throw new HttpError(400, 'give at least one feedback item')
  const fails = sendBack(p, phase, 'rejected', list, note)
  const open = openRounds(read(join(MEM, 'projects', p.name, 'phases', phase + '.log')))
  // The fix round is what the human just asked for, so it is the one worth starting.
  return { ok: true, fails, maxFails: MAX_FIX_LOOPS, willStick: open >= MAX_FIX_LOOPS, started: requestRun(project, then), watching: watching() }
}

/** bin/brain cmd_reopen: the way back from a gate with no fix-role. `phase` and every
 *  phase after it lose their .done (kept in the record), so the playbook runs again
 *  from there. */
export function reopen (project, phase, items = [], then = '') {
  const { p } = gate(project, phase)
  const list = items.map(s => String(s).trim()).filter(Boolean)
  if (!list.length) throw new HttpError(400, 'say why it goes back — at least one item')
  sendBack(p, phase, 'reopened', list, '')
  return { ok: true, reopened: phase, started: requestRun(project, then), watching: watching() }
}

/** bin/brain send_back. A phase with a fix-role gets the rejection its fixer reads; a
 *  work phase keeps its summary and gets the feedback appended. Returns the FAIL rounds. */
function sendBack (p, phase, outcome, list, note) {
  const ph = p.phases.find(x => x.phase === phase)
  const dir = join(MEM, 'projects', p.name, 'phases'), f = e => join(dir, phase + e)
  const day = today()
  if (ph.fix) {
    writeAtomic(f('.md'), rejectedSummary(phase, failRounds(read(f('.log'))) + 1, day, list, note))
    appendFileSync(f('.log'), `${day} FAIL\n`)
    // .fixed must go too: fix_pending compares its mtime against .md, so a stale marker
    // makes brain run skip the fix round.
    try { unlinkSync(f('.fixed')) } catch {}
  } else {
    const prev = read(f('.md')) || ''
    writeAtomic(f('.md'), (prev ? prev + '\n' : '') + `## Feedback from the human (${day})\n` + list.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n')
  }
  const at = p.phases.findIndex(x => x.phase === phase)
  const moved = p.phases.slice(at).map(x => x.phase).filter(x => existsSync(join(dir, x + '.done')))
  const rec = humanRecord(p.name, p.playbook, phase, outcome, [...list.map(s => ['item', s]), ...moved.map(x => ['reopened', x])])
  for (const x of moved) renameSync(join(dir, x + '.done'), join(rec, x + '.done'))
  return failRounds(read(f('.log')))
}

// ---------- lint -------------------------------------------------------------
// Every rule here is a silent failure in bin/brain, not a style preference: the run
// either breaks mid-phase or does the wrong thing with no error at all.

/* Roles brain invokes directly rather than from a phases file: `brain playbook new`,
   `brain role new`, `brain evolve` and `brain playbook analyse`. */
const DIRECT_ROLES = new Set(['playbook-author', 'role-author', 'system-editor', 'playbook-analyst'])

export function lint () {
  const out = []
  const add = (level, where, msg) => out.push({ level, where, msg })
  const pbs = playbooks(), rs = roles(), sk = skills()
  const byRole = new Map(rs.map(r => [r.role, r]))
  const roleFiles = sysRoots().flatMap(r => ls(join(r, 'roles'))).filter(d => d.isFile() && d.name.endsWith('.md')).map(d => d.name.slice(0, -3))
  const used = new Set()

  for (const r of rs) {
    if (r.fields < 3 || r.fields > 4) add('error', `roles.conf:${r.line + 1}`,
      `'${r.role}' has ${r.fields} field(s), needs 3 or 4: role engine model [effort].`)
    const eng = engines().find(e => e.name === r.engine)
    if (r.effort && eng) {
      const ok = effortsFor(r.engine, r.model)
      if (!ok.includes(r.effort)) add('error', `roles.conf:${r.line + 1}`, ok.length
        ? `effort '${r.effort}' is not valid for ${r.engine} with model ${r.model}. Allowed: ${ok.join(', ')}.`
        : `${r.engine} has no reasoning effort setting: leave the fourth column empty.`)
    }
    if (r.engine && !eng) add('error', `roles.conf:${r.line + 1}`, `engine '${r.engine}' is not in system/engines.conf (${engineNames().join(', ')})`)
    else if (eng && !eng.on) add('error', `roles.conf:${r.line + 1}`, `'${r.role}' runs on ${r.engine}, which this brain has not installed: brain engine add ${r.engine}`)
    if (!r.doc) {
      const ci = roleFiles.find(f => f.toLowerCase() === r.role.toLowerCase())
      if (ci) add('error', `roles.conf:${r.line + 1}`, `'${r.role}' resolves to roles/${ci}.md only because macOS is case-insensitive. The Linux sandbox will not find it.`)
      else add('error', `roles.conf:${r.line + 1}`, `'${r.role}' has no system/roles/${r.role}.md`)
    }
  }
  const dupRoles = rs.map(r => r.role).filter((r, i, a) => a.indexOf(r) !== i)
  for (const r of new Set(dupRoles)) add('error', 'roles.conf', `'${r}' listed twice — role_cfg takes the first and silently ignores the rest`)

  for (const pb of pbs) playbookProblems(pb, playbookDir(pb.name), byRole, used, add)
  for (const a of apps()) for (const p of a.ui.problems || []) add('error', `${a.dir}/ui/app.json`, p)

  /* Only meaningful once playbooks exist. system/playbooks ships empty, so on a fresh
     clone every role is unused by definition and the warning would be pure noise.
     DIRECT_ROLES are the ones brain runs itself rather than from a phases file, so
     "unused by any playbook" is their normal state, not a mistake. So is an app's role:
     the app may run it from its own commands (the academy's roles have no playbook), and
     it is the app's to keep or drop, not something to clean up here. */
  if (pbs.length) {
    for (const r of rs) if (!used.has(r.role) && !DIRECT_ROLES.has(r.role) && !r.app) add('warn', `roles.conf:${r.line + 1}`, `'${r.role}' is not used by any playbook`)
  }
  const known = new Set(sk.declared.map(d => d.name))
  for (const r of rs) for (const n of (r.editable ? r.names : [])) {
    if (!known.has(n)) add('warn', r.doc || `roles.conf:${r.line + 1}`,
      `'${r.role}' names skill '${n}', which this brain does not declare, so the sandbox will not have it.`)
  }
  /* The other half of that check: a step that tells the agent to use a skill the role
     never declared. The instruction reads as if the skill is there, and the run simply
     does without it — role-author.md:21 already says the line and the step have to
     agree, which is exactly the pairing nothing was checking.
     Only backticked exact matches against a known skill count: role docs use "brain"
     and "payload" as ordinary words, and `brain run` or `payload-conventions` are not
     the skill. DIRECT_ROLES are skipped because writing roles is their subject — they
     quote skill names as examples of how a step should read. */
  for (const r of rs) {
    if (!r.doc || DIRECT_ROLES.has(r.role)) continue
    const text = read(join(BRAIN, r.doc)) || ''
    const body = text.replace(/^Skills:[ \t]*.*$/m, '')
    const declared = new Set(r.names || [])
    for (const n of new Set([...body.matchAll(/`([^`]+)`/g)].map(m => m[1]))) {
      if (known.has(n) && !declared.has(n)) add('warn', r.doc,
        `'${r.role}' tells the agent to use the '${n}' skill, but its Skills: line does not name it — the step reads as if the skill is loaded and the run goes without it.`)
    }
  }

  for (const s of sk.own) {
    if (s.name && s.name !== s.dir) add('error', s.path,
      `frontmatter name '${s.name}' differs from directory '${s.dir}'. sync-skills builds its keep list from the directory but prunes against the frontmatter name, so this skill removes itself on the next sync.`)
  }
  for (const e of sk.external) {
    if (!e.keep && !e.names.length) add('warn', 'system/skills.list',
      `'${e.repo}' lists no skill names, so it adds nothing to the keep list — sync installs every skill in it and the same run prunes them straight back out`)
  }

  for (const p of projects()) {
    const at = `${p.mem}/project.env`
    if (!p.playbook) add('error', at, 'no PLAYBOOK= — load_project crashes under set -u')
    else if (!pbs.some(x => x.name === p.playbook)) add('error', at, `PLAYBOOK='${p.playbook}' has no playbook directory`)
    if (p.hostDir && !SAFE_ENV.test(p.hostDir)) add('error', at, `PROJECT_DIR is sourced as bash on the host; '${p.hostDir}' can execute`)
  }
  return out
}

/** The checks on one playbook folder: what brain playbook check enforces, worded for the
 *  cockpit. Shared by lint() and by a draft the author has not installed yet, which is
 *  why the folder and the known roles are arguments rather than read from system/. */
function playbookProblems (pb, dir, byRole, used, add) {
  {
    const at = `playbooks/${pb.name}`
    for (const f of ls(join(dir, 'contracts')).filter(f => f.isFile())) {
      const contractAt = `${at}/contracts/${f.name}`
      const phase = pb.phases.find(p => p.phase === f.name)
      if (!phase || phase.role === 'human') add('error', contractAt, 'contracts require an agent phase; human approval stays in phases')
      for (const [line, message] of contractProblems(read(join(dir, 'contracts', f.name)))) add('error', `${contractAt}:${line}`, message)
    }
    if (!pb.description) add('warn', `${at}/playbook.md`, 'no "> " line — brain playbooks renders it blank')
    const seen = new Set()
    for (const r of pb.rows) {
      if (r.line.includes('#')) add('error', `${at}/phases:${r.i + 1}`,
        `'#' on a data line becomes a field. The awk filter only rejects '#' at line start, so '${r.fields[2] || r.fields[1]}' is parsed as a role.`)
      if (r.fields.length < 2) add('error', `${at}/phases:${r.i + 1}`,
        `'${r.fields[0]}' has no role — awk filters NF >= 2, so this row vanishes from the pipeline with no error anywhere`)
      else if (r.fields.length > 3) add('error', `${at}/phases:${r.i + 1}`, `${r.fields.length} fields, expected 2 or 3`)
    }
    for (const p of pb.phases) {
      if (seen.has(p.phase)) add('error', `${at}/phases:${p.line + 1}`,
        `'${p.phase}' appears twice and both rows share phases/${p.phase}.done — one completion marks both`)
      seen.add(p.phase)
      for (const [col, role] of [['role', p.role], ['fix-role', p.fix]]) {
        if (!role || role === 'human') continue
        used.add(role)
        if (!byRole.has(role)) add('error', `${at}/phases:${p.line + 1}`, `${col} '${role}' is not in roles.conf`)
      }
      if (!pb.md.sections.some(s => s.heading === `## ${p.phase}`)) {
        const loose = pb.md.sections.find(s => s.name.trim() === p.phase)
        add('error', `${at}/playbook.md`, loose
          ? `heading "${loose.heading}" is not byte-exact — brain matches $0 == "## ${p.phase}", so this section extracts as empty`
          : `no "## ${p.phase}" section — the agent prompt points at nothing`)
      }
      if (REVIEW_ROLE.test(p.role) && !p.fix) add('error', `${at}/phases:${p.line + 1}`,
        `'${p.phase}' runs the review role '${p.role}' but has no fix-role. On FAIL brain re-runs the reviewer, which BRAIN.md forbids from editing code, and MAX_FIX_LOOPS never applies because it lives in the branch that needs a fix-role.`)
      if (p.role === 'human' && !p.fix) add('warn', `${at}/phases:${p.line + 1}`,
        `human gate '${p.phase}' has no fix-role — brain reject refuses it, so the way back is brain reopen <earlier phase>`)
      if (p.fix && p.fix === p.role) add('error', `${at}/phases:${p.line + 1}`,
        `'${p.phase}' names its own role '${p.role}' as fix-role — a review cannot fix its own findings`)
    }
    for (const s of pb.md.sections) {
      if (!pb.phases.some(p => p.phase === s.name)) add('warn', `${at}/playbook.md`, `"${s.heading}" has no row in phases — dead prose`)
    }
    for (const [k, v] of Object.entries(pb.env)) {
      if (!SAFE_ENV.test(v)) add('error', `${at}/playbook.env`, `${k} is sourced as bash by brain new; '${v}' can break or execute`)
    }
    const inText = read(join(dir, 'inputs'))
    if (inText !== null) {
      const { inputs, problems } = parseInputs(inText)
      for (const [line, msg] of problems) add('error', `${at}/inputs:${line}`, msg)
      const heads = briefSections(read(join(dir, 'brief.md')) || '').map(s => s.heading)
      for (const i of inputs) {
        if (i.per === 'project' && !heads.includes(i.label)) add('warn', `${at}/brief.md`,
          `input '${i.name}' has no '## ${i.label}' heading — the cockpit adds it to each project's brief, but brain new at a terminal will not ask for it`)
      }
    }
  }
}

/* ---------- the cockpit's doors into bin/brain ----------
   Someone who never opens a terminal has to be able to start a project, a run and a
   playbook draft from here. The container has no brain, sbx or git and ~/dev is mounted
   read-only, so each of these stages a request under memory/ and `brain watch` on the
   host does the work — the same hand-off as .run-request, with one file per wish. */

const NEW = join(MEM, '.new')
const DRAFTS = join(BRAIN, '.drafts', 'playbook')
const SEED = ['phases', 'playbook.md', 'brief.md', 'inputs', 'contracts'] // what an adjustment starts from

/** system/brain.local.conf, then system/brain.conf, read the way bin/brain's `setting` reads
 *  them: first KEY= wins, never sourced. The environment still beats both, as on the host. */
function setting (key, dflt) {
  if (process.env[key]) return process.env[key]
  for (const f of ['brain.local.conf', 'brain.conf']) {
    const m = (read(join(SYS, f)) || '').split('\n').map(l => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*?)"?\s*$/)).find(m => m && m[1] === key)
    if (m && m[2]) return m[2]
  }
  return dflt
}

/** The questions a playbook's brief asks: every `##` heading (### included, as bin/brain
 *  brief_sections does), with the HTML comment under it as the hint fill_brief shows. */
function briefSections (text) {
  const lines = text.split('\n'), out = []
  lines.forEach((l, i) => { if (/^##/.test(l)) out.push({ heading: l.replace(/^#+\s*/, '').trim(), start: i }) })
  out.forEach((s, k) => { s.end = k + 1 < out.length ? out[k + 1].start : lines.length; s.body = lines.slice(s.start + 1, s.end).join('\n') })
  return out
}
const briefTemplate = pb => read(join(playbookDir(pb), 'brief.md')) || read(join(SYS, 'brief-template.md')) || '# Brief\n'

/** What the New project form asks for this playbook: its typed inputs, split into the
 *  ones asked every time and the ones asked once per client, and every other heading of
 *  its brief as an optional free-text box. A playbook with no inputs file is all brief. */
export function briefForm (playbook) {
  const dir = playbookDir(playbook)
  if (!existsSync(join(dir, 'phases'))) throw new HttpError(404, `no playbook '${playbook}'`)
  const inputs = askedInputs(playbook)
  const taken = new Set(inputs.map(i => i.label))
  return {
    inputs: inputs.filter(i => i.per === 'project'),
    clientInputs: inputs.filter(i => i.per === 'client'),
    sections: briefSections(briefTemplate(playbook)).filter(s => !taken.has(s.heading)).map(s => ({
      heading: s.heading,
      hint: (s.body.match(/<!--([\s\S]*?)-->/) || [, ''])[1].replace(/\s+/g, ' ').trim()
    }))
  }
}

// Same rule as ui/public/shared.js toSlug.
// Letters with accents keep their sound: Wärmepumpe is waermepumpe, café is cafe.
const toSlug = s => String(s || '').trim().toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

/** Stage a project for `brain watch`: memory/.new/<slug>/request plus the brief with the
 *  form's answers under their headings, exactly as fill_brief writes them. The project
 *  itself appears when the host has run `brain new`, a tick later. */
export function createProject ({ playbook, name, client = '', values = {}, files = {}, brief = {}, then = '' }) {
  const slug = toSlug(name)
  if (!PLAYBOOK_NAME.test(slug)) throw new HttpError(400, `'${name}' does not make a usable project name — letters, digits and dashes, up to 40`)
  if (!existsSync(join(playbookDir(playbook), 'phases'))) throw new HttpError(404, `no playbook '${playbook}'`)
  const cl = toSlug(client)
  if (cl && !PLAYBOOK_NAME.test(cl)) throw new HttpError(400, `'${client}' does not make a usable client slug`)
  if (cl && !clientsOn()) throw new HttpError(400, 'clients are an app: install it from Admin → Apps, or leave the client out')
  if (then && !RUNNABLE.has(then)) throw new HttpError(400, `'${then}' is not a brain command — run or auto`)
  if (existsSync(join(MEM, 'projects', slug, 'project.env'))) throw new HttpError(409, `project '${slug}' already exists`)
  const st = join(NEW, slug)
  if (st !== safePath(`memory/.new/${slug}`)) throw new HttpError(400, 'bad project path')
  if (existsSync(join(st, 'request')) && !existsSync(join(st, 'error'))) throw new HttpError(409, `'${slug}' is already being created`)

  // The answers, every one checked before anything is written.
  const inputs = askedInputs(playbook)
  let text = briefTemplate(playbook)
  for (const i of inputs.filter(x => x.per === 'project')) {
    let body = ''
    if (i.type === 'files') {
      const names = [].concat(files[i.name] || [])
      for (const f of names) {
        if (!/^[A-Za-z0-9._-]+$/.test(f) || !existsSync(join(st, 'sources', f))) throw new HttpError(400, `${i.label}: '${f}' was not uploaded — add the file again`)
      }
      body = names.map(f => `- sources/${f}`).join('\n')
    } else body = inputBody(i, values[i.name])
    if (!body && i.required) throw new HttpError(400, `${i.label} is required`)
    // An unanswered input keeps its heading, so the first phase sees the question.
    if (body || !briefSections(text).some(s => s.heading === i.label)) text = setSection(text, i.label, body)
  }
  const taken = new Set(inputs.map(i => i.label))
  for (const s of briefSections(text)) {
    const v = String(brief?.[s.heading] ?? '').trim()
    if (v && !taken.has(s.heading)) text = setSection(text, s.heading, v)
  }
  const fromClient = inputs.filter(i => i.per === 'client' && i.required)
  if (fromClient.length) {
    if (!cl) throw new HttpError(400, `this playbook asks once per client for ${fromClient.map(i => i.label).join(', ')} — name the client`)
    const prof = read(join(MEM, 'clients', cl, 'profile.md')) || ''
    const missing = fromClient.filter(i => !String(sectionValue(prof, i)).length)
    if (missing.length) throw new HttpError(400, `${cl} has no ${missing.map(i => i.label).join(', ')} yet — fill in the client part of the form`)
  }

  // A retry after the host refused it starts clean, except for the files already uploaded.
  for (const e of ls(st)) if (e.name !== 'sources') rmSync(join(st, e.name), { recursive: true, force: true })
  mkdirSync(st, { recursive: true })
  writeAtomic(join(st, 'brief.md'), text)
  if (then) writeAtomic(join(st, 'then'), then + '\n')
  // Last: `request` is what the watcher acts on, so everything else is in place first.
  writeAtomic(join(st, 'request'), `${playbook} ${slug}${cl ? ' ' + cl : ''}\n`)
  return { queued: true, project: slug, watching: watching() }
}

/** Projects staged but not yet made, with the host's error when it refused one. */
export function pendingProjects () {
  return dirs(NEW).map(slug => {
    const [playbook = '', , client = ''] = (read(join(NEW, slug, 'request')) || '').trim().split(/\s+/)
    return { slug, playbook, client, error: (read(join(NEW, slug, 'error')) || '').trim() || null }
  })
}
export function discardPending (slug) {
  if (!PLAYBOOK_NAME.test(slug || '')) throw new HttpError(400, 'bad project name')
  rmSync(join(NEW, slug), { recursive: true, force: true })
  return { discarded: slug }
}

/** The Run button: the same .run-request a verdict leaves, without a verdict. */
export function startRun (project, then = 'auto') {
  const p = projects().find(x => x.name === project)
  if (!p) throw new HttpError(404, `no project '${project}'`)
  const busy = p.phases.find(x => x.state === 'running')
  if (busy) throw new HttpError(409, `'${busy.phase}' is already running`)
  if (!p.next) throw new HttpError(409, 'the playbook is complete — nothing left to run')
  return { started: requestRun(project, then || 'auto'), watching: watching() }
}

/* Playbook drafts: the author writes .drafts/playbook/<name>/, the cockpit reads it. */
function draftDir (name) {
  if (!PLAYBOOK_NAME.test(name || '')) throw new HttpError(400, `'${name}' is not a usable playbook name — lowercase letters, digits and dashes`)
  return join(DRAFTS, name)
}

/** Ask the author for a draft (or a revision of the one that exists). The description
 *  waits in REQUEST.md and `brain watch` opens `brain playbook draft <name>` in a Terminal
 *  window; the author consumes REQUEST.md when it is done, which is how `pending` clears.
 *  `adjust` is the same round for an installed playbook: the draft starts as a copy of it,
 *  so the author revises what is there and the human installs the result over it. */
export function requestDraft ({ name, description, adjust = false }) {
  const dir = draftDir(name), installed = existsSync(playbookDir(name)), seeded = existsSync(join(dir, 'phases'))
  if (installed && !adjust && !seeded) throw new HttpError(409, `playbook '${name}' already exists — adjust it on its own page`)
  const desc = String(description || '').trim()
  if (!desc) throw new HttpError(400, installed ? 'say what should change' : 'describe the path: what work, in what order, and what must be checked')
  if (existsSync(join(dir, 'REQUEST.md'))) throw new HttpError(409, 'the author is already working on this draft')
  mkdirSync(dir, { recursive: true })
  // Never playbook.env: `brain new` sources it as bash on the host, so it is not a file an
  // agent gets to hand back. Install leaves the installed one alone for the same reason.
  if (installed && !seeded) {
    for (const f of SEED) if (existsSync(join(playbookDir(name), f))) cpSync(join(playbookDir(name), f), join(dir, f), { recursive: true })
  }
  writeAtomic(join(dir, 'REQUEST.md'), desc + '\n')
  writeFileSync(join(MEM, '.draft-request'), name + '\n')
  return { name, again: existsSync(join(dir, 'phases')), watching: watching() }
}

export function drafts () {
  return dirs(DRAFTS).filter(n => PLAYBOOK_NAME.test(n)).map(name => ({
    name, pending: existsSync(join(DRAFTS, name, 'REQUEST.md')), exists: existsSync(join(DRAFTS, name, 'phases'))
  }))
}

export function draft (name) {
  const dir = draftDir(name)
  const pending = existsSync(join(dir, 'REQUEST.md')), installed = existsSync(playbookDir(name))
  const out = { name, pending, installed, request: read(join(dir, 'REQUEST.md')) || '', exists: existsSync(join(dir, 'phases')), phases: [], roles: [], inputs: [], problems: [], description: '', preamble: '', removed: [], alsoChanged: [] }
  if (!out.exists) return out
  const text = read(join(dir, 'phases')) || '', md = parsePlaybookMd(read(join(dir, 'playbook.md')) || '')
  const rows = dataRows(columns(text))
  const phases = rows.filter(r => r.fields.length >= 2).map(r => ({ phase: r.fields[0], role: r.fields[1], fix: r.fields[2] || '', line: r.i }))
  out.roles = ls(join(dir, 'roles')).filter(f => f.isFile() && f.name.endsWith('.md')).map(f => ({ name: f.name.slice(0, -3), doc: read(join(dir, 'roles', f.name)) || '' }))
  out.description = md.description; out.preamble = md.preamble
  out.inputs = parseInputs(read(join(dir, 'inputs')) || '').inputs
  out.phases = phases.map(p => ({ ...p, section: (md.sections.find(s => s.heading === `## ${p.phase}`) || {}).body || '' }))
  // An adjustment says what it changes against the installed playbook, phase by phase.
  if (installed) {
    const pb = playbooks().find(x => x.name === name)
    const was = new Map(pb.phases.map(p => [p.phase, { ...p, section: (pb.md.sections.find(s => s.heading === `## ${p.phase}`) || {}).body || '' }]))
    for (const p of out.phases) {
      const w = was.get(p.phase)
      p.change = !w ? 'new' : w.role !== p.role || w.fix !== p.fix || w.section !== p.section ? 'changed' : ''
    }
    out.removed = pb.phases.map(p => p.phase).filter(n => !phases.some(p => p.phase === n))
    const same = f => (read(join(dir, f)) || '') === (read(join(playbookDir(name), f)) || '')
    out.alsoChanged = [[md.description === pb.md.description, 'the description'], [md.preamble === pb.md.preamble, 'what every step is told first'],
      [same('inputs'), 'the form it asks'], [same('brief.md'), 'the brief template']].filter(([s]) => !s).map(([, label]) => label)
  }
  // The checks a playbook gets once installed, with the roles the draft proposes counted
  // as existing — a proposed role is not a problem, a role nobody is going to write is.
  const byRole = new Map([...roles().map(r => [r.role, r]), ...out.roles.map(r => [r.name, r])])
  playbookProblems({ name, phases, rows, md, description: md.description, env: {} }, dir, byRole, new Set(), (level, where, msg) => out.problems.push({ level, where, msg }))
  return out
}

/** Install what the author drafted: each proposed role as both halves (the engine and
 *  model are the human's choice, taken from the form), then the playbook folder. The
 *  draft is gone afterwards and the host is asked to commit, so it is one revert away. */
export function installDraft ({ name, roles: choices = {} }) {
  const dir = draftDir(name), dest = playbookDir(name)
  const d = draft(name)
  if (!d.exists) throw new HttpError(404, `no draft '${name}'`)
  if (d.pending) throw new HttpError(409, 'the author is still working on it')
  const err = d.problems.find(p => p.level === 'error')
  if (err) throw new HttpError(409, `the draft has a problem to fix first: ${err.msg}`)
  // Every refusal before the first write: a role installed by a call that then threw
  // on the next one would be skipped as "already real" on the retry.
  for (const r of d.roles) {
    roleDoc(r.name)
    const c = choices[r.name] || {}
    if (c.engine && !engineNames().includes(c.engine)) throw new HttpError(400, `engine for '${r.name}' must be one of system/engines.conf: ${engineNames().join(', ')}`)
  }
  const conf = read(join(SYS, 'roles.conf')) || ''
  const installed = []
  for (const r of d.roles) {
    const abs = roleDoc(r.name)
    const inConf = dataRows(columns(conf)).some(x => x.fields[0] === r.name)
    if (inConf && existsSync(abs)) continue // already a real role; the draft's copy is not installed over it
    const c = choices[r.name] || {}
    if (!existsSync(abs)) writeAtomic(abs, r.doc.trim() + '\n')
    if (!inConf) appendRoleLine(r.name, c.engine || 'claude', c.model || 'default', c.effort || '')
    installed.push(r.name)
  }
  mkdirSync(dest, { recursive: true })
  for (const f of ['phases', 'playbook.md']) copyFileSync(join(dir, f), join(dest, f))
  // The draft is the whole of these, so one it no longer has goes: an adjustment that
  // dropped the form or a check means it. The contracts are the checks the host runs
  // after a phase, and the problems above were checked against the draft's copy.
  for (const f of ['inputs', 'contracts']) {
    rmSync(join(dest, f), { recursive: true, force: true })
    if (existsSync(join(dir, f))) cpSync(join(dir, f), join(dest, f), { recursive: true })
  }
  writeAtomic(join(dest, 'brief.md'), read(join(dir, 'brief.md')) || read(join(SYS, 'brief-template.md')) || '# Brief\n')
  rmSync(dir, { recursive: true, force: true })
  writeFileSync(join(MEM, '.commit-request'), `playbook: ${name} (${d.installed ? 'adjusted' : 'installed'} from the cockpit)\n`)
  return { installed: name, roles: installed, watching: watching() }
}

export function discardDraft (name) {
  const dir = draftDir(name)
  if (!existsSync(dir)) throw new HttpError(404, `no draft '${name}'`)
  if (existsSync(join(dir, 'REQUEST.md'))) throw new HttpError(409, 'the author is still working on it — wait for its window to close')
  rmSync(dir, { recursive: true, force: true })
  if ((read(join(MEM, '.draft-request')) || '').trim() === name) unlinkSync(join(MEM, '.draft-request'))
  return { discarded: name }
}

/* ---------- apps in the Studio (ui/main.js) ----------
   An app's Studio code reads and stages through two endpoints, scoped to what belongs to
   it: the projects of its kind (KIND=<kind> in project.env) and of its playbooks, and its
   own folder. It reads a project's memory folder and its workspace under ~/dev (mounted
   read-only here). It writes only into memory/ — a run request, a file for the workspace's
   inbox, an edit staged as <name>.staged, or a new workspace in memory/.new/<slug>/ — and
   `brain watch` hands each to the app's cli.sh (<app>_watch, <app>_studio_new). */
const workRoot = env => {
  const h = env.PROJECT_DIR || ''
  return h.startsWith(HOST_DEV + '/') ? join(DEV, h.slice(HOST_DEV.length + 1)) : null
}
/** The projects of an app's kind, with the run markers its cli.sh leaves in memory/. */
function kindProjects (app, kind) {
  return dirs(join(MEM, 'projects')).map(name => ({ name, env: parseEnv(read(join(MEM, 'projects', name, 'project.env'))) }))
    .filter(x => x.env.KIND === kind).map(({ name, env }) => {
      const pdir = join(MEM, 'projects', name), root = workRoot(env)
      return {
        name, hostDir: env.PROJECT_DIR || '', created: env.CREATED || null, visible: !!root && existsSync(root),
        running: (read(join(pdir, `.${app}-running`)) || '').trim() || null,
        request: read(join(pdir, `.${app}-request`)) || read(join(pdir, `.${app}-request.taken`)) || null,
        launching: existsSync(join(pdir, '.launching')),
        staged: ls(join(pdir, 'inbox')).filter(d => d.isFile()).map(d => d.name),
        edits: ls(pdir).filter(d => d.isFile() && d.name.endsWith('.staged')).map(d => d.name.replace(/\.staged$/, ''))
      }
    })
}
const installedApp = name => {
  const a = apps().find(x => x.name === name)
  if (!a) throw new HttpError(404, `no app '${name}' is installed`)
  return a
}
function appProject (app, project) {
  const a = installedApp(app)
  if (!PLAYBOOK_NAME.test(String(project || ''))) throw new HttpError(400, 'bad project name')
  const env = parseEnv(read(join(MEM, 'projects', project, 'project.env')))
  const linked = String(env.INTEGRATIONS || '').split(/\s+/).includes(app)
  const mine = linked || (a.kind ? env.KIND === a.kind : !env.KIND && !!env.PLAYBOOK && appOf((inRoots(`playbooks/${env.PLAYBOOK}`) || '') + '/') === app)
  if (!mine) throw new HttpError(404, `'${project}' is not a project of the ${app} app`)
  return { env, mem: join(MEM, 'projects', project), work: workRoot(env) }
}
const SHOWN = /\.(md|bib|txt|json|csv|ya?ml)$/i
/** An app's own memory, memory/apps/<app>/: what it keeps beyond any one project (the
 *  Frappe app's benches and its per-app knowledge). Its cli.sh writes it; the Studio reads it
 *  and stages requests there with no project named. */
const appData = app => join(MEM, 'apps', installedApp(app).name)

/** Files and folders, many in one call: a folder (`dir/`) as its entries, a text file with
 *  its content, anything else as its size. Missing is null. `where` is the workspace
 *  (`work`), the project's memory folder (`memory`), the app's own folder (`app`) or the
 *  app's own memory (`data`, no project). */
export function appRead ({ app, project, paths = [], where = 'work' }) {
  if (!Array.isArray(paths) || paths.length > 2000) throw new HttpError(400, 'paths is a list of at most 2000')
  let root
  if (where === 'app') root = join(BRAIN, installedApp(app).dir)
  else if (where === 'data') root = appData(app)
  else {
    const { env, mem, work } = appProject(app, project)
    root = where === 'memory' ? mem : work
    if (!root || !existsSync(root)) throw new HttpError(404, `${env.PROJECT_DIR || 'the workspace'} is outside ${HOST_DEV}, so the Studio cannot read it`)
  }
  const files = {}
  for (const rel of paths) {
    const abs = safePath(String(rel), root)
    let st = null
    try { st = statSync(abs) } catch {}
    if (!st) files[rel] = null
    else if (st.isDirectory()) files[rel] = { entries: ls(abs).map(d => ({ name: d.name, dir: d.isDirectory(), mtime: mtime(join(abs, d.name)) })) }
    else if (!SHOWN.test(abs) || st.size > 5e6) files[rel] = { size: st.size, mtime: st.mtimeMs }
    else files[rel] = { content: read(abs), mtime: st.mtimeMs }
  }
  return { files }
}

/** One staged file for `brain watch`: the app's run request (one at a time), a file for
 *  the inbox (`data`, base64), or an edit (`<name>.staged`; with `prev`, refused when the
 *  workspace's `against` file changed since the page read it). With `new` instead of a
 *  project: a new project of the app's kind, its `files` written beside the request. */
export function appRequest ({ app, project, file, content, data, prev, against, new: name, files = {} }) {
  if (name !== undefined) return appNew(app, name, files)
  const f = String(file || '')
  const req = `.${app}-request`
  // No project: the app's own memory. Its request (one at a time) or a staged file, for its cli.sh.
  if (project === undefined || project === null) {
    const root = appData(app)
    if (!(f === req || /^[a-z0-9-]+\.staged$/.test(f))) throw new HttpError(400, `the Studio stages ${req} or <name>.staged in the app's memory — not '${f}'`)
    if (f === req && (existsSync(join(root, req)) || existsSync(join(root, `${req}.taken`)))) {
      throw new HttpError(409, 'a request is already waiting — it is picked up within seconds while brain watch runs')
    }
    mkdirSync(root, { recursive: true })
    writeAtomic(safePath(f, root), String(content ?? ''))
    return { staged: f, watching: watching() }
  }
  const { mem, work } = appProject(app, project)
  if (!(f === req || /^inbox\/[A-Za-z0-9_][A-Za-z0-9._ -]*$/.test(f) || /^[a-z0-9-]+\.staged$/.test(f))) {
    throw new HttpError(400, `the Studio stages ${req}, inbox/<file> or <name>.staged — not '${f}'`)
  }
  if (f === req && (existsSync(join(mem, req)) || existsSync(join(mem, `${req}.taken`)))) {
    throw new HttpError(409, 'a run is already queued — it starts as soon as the one before it is done')
  }
  if (typeof prev === 'string') {
    const now = work && against ? read(safePath(String(against), work)) || '' : null
    if (now === null || prev.replace(/\r\n/g, '\n') !== now) throw new HttpError(409, `${against || 'the file'} changed since you opened it — reload and edit again`)
  }
  const abs = safePath(f, mem)
  mkdirSync(dirname(abs), { recursive: true })
  if (data !== undefined) {
    const buf = Buffer.from(String(data || ''), 'base64')
    if (!buf.length) throw new HttpError(400, 'the file is empty')
    writeFileSync(abs, buf)
  } else writeAtomic(abs, String(content ?? ''))
  return { staged: f, watching: watching() }
}

function appNew (app, name, files) {
  const a = installedApp(app)
  if (!a.kind) throw new HttpError(400, `the ${app} app has no kind of project to create`)
  const slug = toSlug(name)
  if (!PLAYBOOK_NAME.test(slug)) throw new HttpError(400, `'${name}' does not make a usable name — letters, digits and dashes, up to 40`)
  if (existsSync(join(MEM, 'projects', slug, 'project.env'))) throw new HttpError(409, `'${slug}' already exists`)
  const st = join(NEW, slug)
  if (st !== safePath(`memory/.new/${slug}`)) throw new HttpError(400, 'bad path')
  if (existsSync(join(st, 'request')) && !existsSync(join(st, 'error'))) throw new HttpError(409, `'${slug}' is already being created`)
  const bad = Object.keys(files || {}).find(f => !/^[a-z0-9-]+\.md$/.test(f))
  if (bad) throw new HttpError(400, `a new ${a.kind} takes <name>.md files, not '${bad}'`)
  rmSync(st, { recursive: true, force: true })
  mkdirSync(st, { recursive: true })
  for (const [f, text] of Object.entries(files || {})) writeAtomic(join(st, f), String(text).replace(/\n+$/, '\n'))
  writeAtomic(join(st, 'request'), `${a.kind} ${slug}\n`)
  return { queued: true, project: slug, watching: watching() }
}

/** An app's own Studio files: system/apps/<app>/ui/<rel>, nothing outside it. */
export function appUiFile (app, rel) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(app || ''))) throw new HttpError(400, 'bad app name')
  return safePath(String(rel || ''), join(SYS, 'apps', app, 'ui'))
}

/* ---------- graphs ----------
   The Studio's graph view takes nodes, edges and flags; buildGraph drops dangling and
   duplicate edges and flags what is connected to nothing. */
function buildGraph (nodes, edges, flags) {
  const byId = new Map(nodes.map(n => [n.id, n])), seen = new Set(), out = []
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue
    const k = `${e.source}|${e.target}|${e.rel}`
    if (seen.has(k)) continue
    seen.add(k); out.push(e)
  }
  const deg = new Map()
  for (const e of out) for (const id of [e.source, e.target]) deg.set(id, (deg.get(id) || 0) + 1)
  for (const n of nodes) n.degree = deg.get(n.id) || 0
  for (const n of nodes) if (!n.degree && !n.discovery) flags.push({ kind: 'orphan', id: n.id, text: `${n.label} is connected to nothing` })
  return { nodes, edges: out, flags }
}

/** The brain's own wiki as a graph, for Admin: knowledge pages, their [[links]], and the
 *  projects each page was compiled from. */
export function knowledgeGraph () {
  const pages = knowledge(), nodes = [], edges = [], flags = []
  for (const k of pages) nodes.push({ id: `k:${k.name}`, type: 'knowledge', label: k.name, path: k.path })
  for (const p of new Set(pages.flatMap(k => k.cites))) nodes.push({ id: `p:${p}`, type: 'project', label: p })
  for (const k of pages) {
    const text = read(join(MEM, 'knowledge', `${k.name}.md`)) || ''
    for (const m of text.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) edges.push({ source: `k:${k.name}`, target: `k:${m[1].trim().replace(/\.md$/, '')}`, rel: 'link' })
    for (const p of k.cites) edges.push({ source: `k:${k.name}`, target: `p:${p}`, rel: 'from' })
    for (const m of text.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) {
      if (!pages.some(x => x.name === m[1].trim().replace(/\.md$/, ''))) flags.push({ kind: 'missing', id: `k:${k.name}`, text: `${k.name} links [[${m[1].trim()}]], which is not written yet` })
    }
  }
  return buildGraph(nodes, edges, flags)
}

export function state () {
  return {
    playbooks: playbooks(), apps: apps(), store: appStore(), base: baseUpdate(), engines: engines(), usage: usage(), clientsOn: clientsOn(), roles: roles(), skills: skills(), sandbox: sandbox(), projects: projects(), clients: clients(), archivedClients: archivedClients(), knowledge: knowledge(), proposals: proposals(read(join(MEM, 'proposals.md'))), examples: examples(), sources: sources(), lint: lint(), models: models(), maxFixLoops: MAX_FIX_LOOPS, hostBrain: HOST_BRAIN, hostDev: HOST_DEV, watching: watching(), evolvePending: existsSync(join(MEM, '.evolve-request')),
    maxParallel: Number(setting('BRAIN_MAX_PARALLEL', 3)) || 0,
    pending: { new: pendingProjects(), drafts: drafts(), draft: (read(join(MEM, '.draft-request')) || '').trim() || null, commit: existsSync(join(MEM, '.commit-request')) }
  }
}

export { MAX_FIX_LOOPS, columns, dataRows, read }
