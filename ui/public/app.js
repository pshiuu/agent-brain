const view = document.getElementById('view')
let S = null
/* Removing a skill here only changes what the brain declares. The sbx store is on your
   Mac and the cockpit cannot reach it, so the commands that actually uninstall are
   collected and shown until the page is reloaded. */
const unsynced = []

/* One editor for every plain-text file. Tracks the exact bytes it loaded and sends them
   back on save, so a change made in your real editor meanwhile is refused, not clobbered. */
function editor (path, { rows = 14, label = path } = {}) {
  const box = $('div'), bar = $('div', 'bar'), status = $('span', '')
  const ta = $('textarea'); ta.rows = rows; ta.setAttribute('aria-label', label); ta.disabled = true
  const save = $('button', 'primary', 'Save'); save.disabled = true
  const reload = $('button', '', 'Reload')
  let loaded = null
  const mark = () => {
    const dirty = ta.value !== loaded
    save.disabled = !dirty
    status.className = dirty ? 'dirty' : ''
    status.textContent = dirty ? 'unsaved changes' : ''
  }
  const load = async () => {
    ta.disabled = true; status.textContent = 'loading'; status.className = ''
    try { const d = await api(`/api/file?path=${encodeURIComponent(path)}`); loaded = d.content; ta.value = d.content; ta.disabled = false; mark() }
    catch (e) { status.className = 'dirty'; status.textContent = e.message }
  }
  save.onclick = async () => {
    save.disabled = true; status.className = ''; status.textContent = 'saving'
    try {
      const r = await api(`/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: { content: ta.value, prev: loaded } })
      loaded = ta.value.endsWith('\n') || !ta.value ? ta.value : ta.value + '\n'
      ta.value = loaded; mark()
      status.className = 'saved'; status.textContent = r.written ? 'saved' : 'no change on disk'
      setTimeout(() => { if (status.textContent.startsWith('saved') || status.textContent.startsWith('no change')) status.textContent = '' }, 2200)
    } catch (e) {
      status.className = 'dirty'
      status.textContent = e.status === 409 ? 'changed on disk since you loaded it - Reload to see it' : e.message
      mark()
    }
  }
  reload.onclick = load
  ta.oninput = mark
  bar.append($('span', 'tag', path), $('span', 'grow'), status, reload, save)
  box.append(ta, bar); load()
  return box
}

/* ---------- views ---------- */

function lintBlock (items, filter) {
  const list = filter ? items.filter(filter) : items
  if (!list.length) return null
  const box = $('div')
  for (const f of list) {
    const n = $('div', 'note ' + (f.level === 'error' ? 'err' : 'warn'))
    n.append($('b', '', f.where), document.createTextNode(' '), $('span', '', f.msg))
    box.append(n)
  }
  return box
}

/* A human phase is only the human's turn while it is untouched or has come back from a
   fix round. Once rejected it is state awaiting-fix and the fix role runs next, so keying
   any of this on role alone told you to approve a phase that was waiting on an agent. */
const humanTurn = ph => ph.role === 'human' && ['pending', 'awaiting-review'].includes(ph.state)

/* How long a phase has been running. Shown rather than hidden because the .running
   marker outlives a machine killed mid-phase, and '4d' reads as stale where a bare
   'running' chip would keep claiming an agent is at work. */
/* A run's receipt, compact enough to sit on the phase row: what it cost and what it
   reached for. Cache reads dominate the token count and say nothing about the work, so
   the headline number is output — that is the part the agent actually generated. */
const kb = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
const runLine = r => {
  if (!r) return ''
  const mins = r.seconds == null ? null : Math.round(r.seconds / 60)
  const parts = []
  if (mins != null) parts.push(mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`)
  if (r.turns) parts.push(`${r.turns} turns`)
  if (r.tokens) parts.push(`${kb(r.tokens.output || 0)} out · ${kb(r.tokens.cache_read || 0)} cached`)
  if (r.skills && r.skills.length) parts.push(`skills: ${r.skills.join(', ')}`)
  return parts.join(' · ')
}

/* The point of the receipt: a role's `Skills:` line is a declaration, and invoking a
   skill is what actually loads it. The gap between the two is the single most useful
   thing here for improving a role, so it is computed everywhere the run is shown.
   Keyed on the role that ACTUALLY ran: a fix round runs the fix-role, and comparing its
   skills against the reviewer's declaration would invent a gap that is not there. */
const skillGap = (ph, roles, run = ph.run) => {
  const declared = (roles.find(r => r.role === (run?.role || ph.role))?.names || []).filter(n => n !== 'brain')
  const used = run?.skills || []
  return { declared, used, unused: declared.filter(n => !used.includes(n)) }
}

/* When a run happened. The receipt's own end timestamp when it has one, otherwise the
   directory timestamp brain named it with — a receipt from a codex run has neither. */
const runWhen = r => r.ended ? new Date(r.ended).toLocaleString()
  : r.at ? `${r.at.slice(0, 4)}-${r.at.slice(4, 6)}-${r.at.slice(6, 8)} ${r.at.slice(9, 11)}:${r.at.slice(11, 13)}`
    : 'an earlier run'

const ago = ms => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (m < 60) return `${m}m`
  return m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`
}
const stateLabel = p => humanTurn(p) ? 'human' : p.state

function pipeline (proj) {
  const w = $('div', 'pipe')
  for (const p of proj.phases) {
    const c = $('span', `chip ${stateLabel(p)}`, p.phase)
    if (proj.next && proj.next.phase === p.phase) c.classList.add('next')
    c.title = `${p.phase}: ${p.state}${p.since ? ` for ${ago(p.since)}` : ''}${p.fails ? ` (${p.fails}/${p.maxFails} fails)` : ''} - role ${p.role}${p.fix ? `, fix ${p.fix}` : ''}`
    w.append(c)
  }
  return w
}

/* Every button that needs the host says the same thing when nobody is there to act. The
   once-only fix is the login item; the spare-tab command is the old habit. */
function watchNote (what = 'the button only leaves the request') {
  const w = $('div', 'note')
  w.append($('p', '', `Nothing is listening, so ${what}. Make brain watch a login item once and every button here works from then on:`),
    cmd('brain watch install'), $('p', 'sub', 'Or leave it open in a spare terminal tab for now: brain watch'))
  return w
}

/* ---------- typed inputs ----------
   A playbook's inputs file says what a project is handed and in what shape, so each one
   gets the field it deserves: a URL list that checks every address as you paste, a choice,
   a file drop. The server checks it all again; this is so the person sees it first. */
const INPUT_KINDS = [['text', 'Short text'], ['longtext', 'Long text'], ['url', 'Web address'], ['urls', 'List of web addresses'], ['number', 'Number'], ['choice', 'Choice'], ['files', 'Files']]
/* A project from the browser. The cockpit cannot run `brain new` (its container has no
   brain and ~/dev is read-only), so this stages memory/.new/<slug>/ with the request,
   the filled brief and any uploaded files, and `brain watch` makes the project on its
   next tick. The playbook's inputs are the form; the rest of its brief is optional. */
function newProjectForm () {
  const box = $('div')
  const bar = $('div', 'bar'), note = $('span', 'tag')
  const pbSel = $('select'); pbSel.setAttribute('aria-label', 'playbook')
  for (const p of S.playbooks) { const o = $('option', '', p.name); o.value = p.name; pbSel.append(o) }
  const name = document.createElement('input')
  name.type = 'text'; name.placeholder = 'project name, e.g. heat-pump-cost'; name.size = 26
  name.setAttribute('aria-label', 'project name')
  const client = document.createElement('input')
  client.type = 'text'; client.placeholder = 'client (optional)'; client.size = 16
  client.setAttribute('aria-label', 'client'); client.setAttribute('list', 'clients-known')
  const known = document.createElement('datalist'); known.id = 'clients-known'
  for (const c of S.clients) known.append(Object.assign(document.createElement('option'), { value: c.slug }))
  // Typing here and then clicking away must not lose the form to a live refresh.
  const dirty = $('span', ''); const touch = () => { dirty.className = 'dirty'; dirty.textContent = 'not created yet' }
  box.addEventListener('input', touch)

  const projectBox = $('div'), clientBox = $('div'), extraBox = $('div')
  let form = null, projectForm = null, clientForm = null, brief = []
  const loadClient = async () => {
    clientBox.textContent = ''; clientForm = null
    if (!form?.clientInputs.length) return
    clientBox.append($('h3', 'tag', 'asked once per client'))
    if (!toSlug(client.value)) { clientBox.append($('p', 'sub', `${form.clientInputs.map(i => i.label).join(', ')}: asked once per client and kept in its profile. Name the client above.`)); return }
    try {
      const c = await api(`/api/client-inputs?client=${encodeURIComponent(client.value)}&playbook=${encodeURIComponent(pbSel.value)}`)
      const values = Object.fromEntries(c.inputs.map(i => [i.name, i.value]))
      clientForm = inputsForm(c.inputs, values)
      const done = c.inputs.every(i => !i.required || (Array.isArray(i.value) ? i.value.length : i.value))
      if (done && c.exists) {
        const d = document.createElement('details'); d.className = 'fold'
        const answered = c.inputs.filter(i => Array.isArray(i.value) ? i.value.length : i.value).map(i => i.label)
        d.append($('summary', '', `Set once for ${c.client}: ${answered.join(', ') || 'nothing yet'} · edit`), clientForm.el)
        clientBox.append(d)
      } else {
        clientBox.append($('p', 'sub', c.exists ? `${c.client} is missing some of these. They are saved in its profile and every project for it reuses them.` : `${c.client} is a new client. These are saved in its profile and every project for it reuses them.`), clientForm.el)
      }
    } catch (e) { clientBox.append($('div', 'note err', e.message)) }
  }
  const load = async () => {
    projectBox.textContent = ''; extraBox.textContent = ''; clientBox.textContent = ''
    if (!pbSel.value) return
    try {
      form = await api(`/api/brief-form?playbook=${encodeURIComponent(pbSel.value)}`)
      projectForm = inputsForm(form.inputs)
      projectBox.append(projectForm.el)
      brief = form.sections.map(f => {
        const w = $('div', 'field'), l = $('label', '', f.heading)
        const t = document.createElement('textarea'); t.rows = 2; t.placeholder = f.hint; t.dataset.heading = f.heading
        t.id = `brief-${toSlug(f.heading)}`; l.htmlFor = t.id
        w.append(l, t); return { w, t }
      })
      if (brief.length) {
        const wrap = $('div', 'fields'); for (const b of brief) wrap.append(b.w)
        if (form.inputs.length) {
          const d = document.createElement('details'); d.className = 'fold'
          d.append($('summary', '', `More for the brief (${brief.length}, optional)`), wrap)
          extraBox.append(d)
        } else extraBox.append(wrap)
      }
      await loadClient()
    } catch (e) { projectBox.append($('div', 'note err', e.message)) }
  }
  pbSel.onchange = load; client.onchange = loadClient; load()

  const then = thenPicker()
  const make = $('button', 'primary', 'Create project')
  make.onclick = async () => {
    note.className = 'tag'; note.textContent = ''
    const err = projectForm?.check() || clientForm?.check() || ''
    if (err) { note.className = 'tag err'; note.textContent = err; return }
    const slug = toSlug(name.value)
    if (!slug) { note.className = 'tag err'; note.textContent = 'give the project a name'; return }
    make.disabled = true
    try {
      const r = await submitProject({
        playbook: pbSel.value, name: name.value, client: client.value, then: then.get(), projectForm, clientForm,
        brief: Object.fromEntries(brief.map(b => [b.t.dataset.heading, b.t.value]))
      }, m => { note.textContent = m })
      dirty.textContent = ''; dirty.className = ''
      note.textContent = r.watching ? `creating ${r.project}` : `${r.project} is staged, waiting for brain watch`
      S = await api('/api/state'); render()
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; make.disabled = false }
  }
  bar.append(pbSel, name, ...(S.clientsOn ? [client, known] : []))
  box.append(bar, projectBox, clientBox, extraBox)
  const act = $('div', 'bar'); act.append(make, then.wrap, note, dirty)
  box.append(act)
  box.append($('p', 'sub', 'The name becomes the folder under ~/dev and the project in memory. Each answer lands in the project\'s brief under its label, which is what every phase reads first.'))
  return box
}

function dashboard () {
  const box = $('div')
  const head = $('div', 'head')
  head.append($('h1', '', 'Overview'), $('p', 'sub', `${S.playbooks.length} playbooks, ${S.roles.length} roles, ${S.projects.length} projects`))
  box.append(head)
  const upd = baseUpdateNote(S, () => refreshState(scrollY))
  if (upd) box.append(upd)
  const use = usageBlock(S.usage, S.engines)
  if (use) box.append($('h2', '', 'Subscription usage'), use)

  const errs = lintBlock(S.lint, f => f.level === 'error')
  const warns = lintBlock(S.lint, f => f.level === 'warn')
  if (errs) { box.append($('h2', '', 'Problems that break a run')); box.append(errs) }

  if (S.playbooks.length) {
    const d = document.createElement('details'); d.className = 'fold'; d.open = !S.projects.length
    d.append($('summary', '', 'New project'), newProjectForm())
    box.append($('h2', '', 'Start something'), d)
  }

  box.append($('h2', '', 'Projects'))
  if (!S.watching && (S.pending.new.length || S.projects.some(p => p.runPending))) box.append(watchNote('nothing is created or started'))
  if (!S.projects.length && !S.pending.new.length) {
    const e = $('div', 'empty')
    e.append($('h3', '', 'No projects yet'),
      $('p', '', S.playbooks.length ? 'Fill in the form above and the project shows up here with its phase pipeline.' : 'A project runs a playbook, and there is no playbook yet. Write one under Playbooks first.'))
    box.append(e)
  } else {
    const rows = $('div', 'rows')
    for (const q of S.pending.new) {
      const r = $('div', 'row k2'), left = $('div')
      left.append($('div', 'name', q.slug))
      const right = $('div')
      if (q.error) {
        right.append($('div', 'tag err', `could not create it: ${q.error}`))
        const drop = $('button', '', 'Discard'); drop.style.marginLeft = '8px'
        drop.onclick = async () => { await api('/api/project-pending', { method: 'DELETE', body: { name: q.slug } }); S = await api('/api/state'); render() }
        right.append(drop)
      } else right.append($('div', 'tag', S.watching ? `creating from ${q.playbook}…` : `staged from ${q.playbook}, waiting for brain watch`))
      r.append(left, right); rows.append(r)
    }
    for (const p of S.projects) {
      const r = $('div', 'row k2')
      const left = $('div')
      const a = $('a', 'name', p.name); a.href = `#/project/${p.name}`
      left.append(a, $('div', 'tag', p.playbook + (p.client ? ` · ${p.client}` : '')))
      const right = $('div')
      right.append(pipeline(p))
      if (p.blocked) {
        const why = p.blocked.state === 'stuck'
          ? `${p.blocked.phase} failed ${p.blocked.fails} times - brain run will stop and ask you`
          : humanTurn(p.blocked) ? `${p.blocked.phase} is waiting for your approval`
          : `${p.blocked.phase} needs a fix round from ${p.blocked.fix}`
        const t = $('div', 'tag ' + (p.blocked.state === 'stuck' ? 'err' : 'warn'))
        const to = $('a', '', why); to.href = `#/project/${p.name}`
        t.append(to); right.append(t)
      } else if (p.next) {
        right.append($('div', 'tag', p.next.state === 'running'
          ? `running: ${p.next.phase} (${p.next.role}) · ${ago(p.next.since)}`
          : `next: ${p.next.phase} (${p.next.role})`))
      }
      else right.append($('div', 'tag', 'playbook complete'))
      if (p.runPending) right.append($('div', 'tag', S.watching ? 'queued · brain watch starts it when a slot is free' : 'queued · nothing is listening'))
      else if (p.next && p.next.state !== 'running' && !humanTurn(p.next)) {
        const bar = $('div', 'bar'); bar.style.margin = '4px 0 0'
        const run = $('button', '', `Run ${p.next.phase}`), note = $('span', 'tag')
        run.onclick = async () => {
          run.disabled = true
          try {
            const r = await api('/api/run', { method: 'POST', body: { project: p.name, then: thenChoice() || 'auto' } })
            note.textContent = r.watching ? `starting brain ${r.started}` : 'queued, nothing is listening'
            S = await api('/api/state'); render()
          } catch (e) { note.className = 'tag err'; note.textContent = e.message; run.disabled = false }
        }
        bar.append(run, note)
        if (!S.watching && p.visible) bar.append(cmd(`cd ${p.hostDir} && brain run`))
        right.append(bar)
      }
      if (p.next && p.hostDir && !p.visible) right.append($('div', 'tag', `code at ${p.hostDir} (outside ~/dev, not readable here)`))
      r.append(left, right); rows.append(r)
    }
    box.append(rows)
  }

  box.append($('h2', '', 'Proposed by agents'))
  box.append($('p', 'sub', 'Changes agents want made to system/. Accept is your approval, and the only thing brain evolve applies. Decline keeps the line under ## Declined, where the next agent reads it before proposing the same change again.'))
  box.append(proposalsBlock(S.proposals))

  if (warns) { box.append($('h2', '', 'Worth a look')); box.append(warns) }
  return box
}

/* proposals.md as three lists, each line with the move that is yours to make. The file
   stays the record — the buttons only save you the cut and paste between its headings. */
const MOVES = {
  Open: [['Accepted', 'Accept', 'primary'], ['Declined', 'Decline', 'danger']],
  Accepted: [['Open', 'Back to open', '']],
  Declined: [['Open', 'Reopen', '']]
}
function proposalList (lines, from) {
  const rows = $('div', 'rows')
  for (const line of lines) {
    const r = $('div', 'row proposal'), bar = $('div', 'bar'), note = $('span', 'tag')
    for (const [to, label, cls] of MOVES[from]) {
      const b = $('button', cls, label)
      b.onclick = async () => {
        for (const x of bar.querySelectorAll('button')) x.disabled = true
        note.className = 'tag'; note.textContent = 'saving'
        try { await api('/api/proposal', { method: 'POST', body: { line, from, to } }); await refreshState(scrollY) }
        catch (e) { note.className = 'tag err'; note.textContent = e.message; for (const x of bar.querySelectorAll('button')) x.disabled = false }
      }
      bar.append(b)
    }
    bar.append(note)
    r.append(md(line.replace(/^- /, '')), bar)
    rows.append(r)
  }
  return rows
}

/* scope names the project or playbook the sets were filtered to, or '' for all of them.
   playbook makes the evolve button that playbook's own. */
function proposalsBlock (sets, scope = '', playbook = '') {
  const box = $('div')
  for (const [s, empty] of [
    ['Accepted', scope ? `Nothing for ${scope} is accepted.` : 'Nothing accepted, so brain evolve has nothing to do.'],
    ['Open', scope ? `Nothing for ${scope} is waiting on you.` : 'Nothing proposed yet.']
  ]) {
    box.append($('h3', 'tag', `${s} · ${sets[s].length}`))
    box.append(sets[s].length ? proposalList(sets[s], s) : $('div', 'note', empty))
  }
  // Declined is the archive: kept for the agents that read it, folded away for you.
  if (sets.Declined.length) {
    const d = $('details')
    d.append(Object.assign(document.createElement('summary'), { textContent: `Declined · ${sets.Declined.length}` }), proposalList(sets.Declined, 'Declined'))
    box.append(d)
  }
  box.append(evolveBar(scope, sets.Accepted.length, playbook))
  return box
}

/* One click for `brain evolve`, or `brain playbook evolve <name>` when a playbook is
   given. The cockpit cannot run either: it leaves memory/.evolve-request and `brain
   watch` opens a Terminal on the brain — the same hand-off as a gate's "then start".
   Plain evolve applies every accepted line; the playbook form only that playbook's,
   so one can be improved while another has a project partway through it. */
function evolveBar (scope, mine, playbook = '') {
  const all = S.proposals.Accepted.length, n = playbook ? mine : all
  const box = $('div'), bar = $('div', 'bar'), note = $('span', 'tag')
  const go = $('button', 'primary', `${playbook ? `Evolve ${playbook}` : 'Run brain evolve'}${n ? ` · ${n} accepted` : ''}`)
  go.disabled = !n || S.evolvePending
  note.textContent = S.evolvePending ? 'requested, waiting for brain watch to start it'
    : !n ? `accept a proposal${playbook ? ` for ${playbook}` : ''} first. Evolve applies accepted ones and nothing else`
    : playbook ? (all > n ? `${all - n} other accepted wait for their own playbook's evolve, or brain evolve for all` : '')
    : scope ? `applies all ${n}, ${mine} of them for ${scope}` : ''
  go.onclick = async () => {
    go.disabled = true; note.className = 'tag'; note.textContent = 'asking'
    try {
      const r = await api('/api/evolve', { method: 'POST', body: playbook ? { playbook } : {} })
      note.textContent = r.watching ? `starting brain ${r.started} in a new Terminal` : `saved, waiting for \`brain watch\` to start brain ${r.started}`
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; go.disabled = false }
  }
  bar.append(go, note)
  box.append(bar)
  // The Terminal asks before it goes ahead; saying so here saves the surprise.
  const busy = playbook ? S.projects.filter(x => x.playbook === playbook && x.next && x.phases.some(ph => ph.state === 'done')) : []
  if (busy.length) box.append($('div', 'note warn', `${busy.map(x => x.name).join(', ')} ${busy.length > 1 ? 'are' : 'is'} partway through ${playbook}: the rest of its phases would run under the edited playbook, and a renamed phase orphans its files. The Terminal asks before it applies anything.`))
  if (!S.watching && n) {
    const w = watchNote()
    w.append($('p', 'sub', 'Or run it yourself:'), cmd(`cd ${S.hostBrain} && brain ${playbook ? `playbook evolve ${playbook}` : 'evolve'}`))
    box.append(w)
  }
  box.append($('p', 'sub', 'Evolve edits system/ in place. The diff is the review, and checkout is the undo:'), cmd(`git -C ${S.hostBrain} diff system`))
  return box
}

/* Step one of improving a playbook, `brain playbook analyse <name>`: the host scores every
   project that ran it and an agent files proposals. It changes nothing in system/ —
   step two is choosing among them here, then evolve. Same hand-off as evolveBar. */
function playbookAnalyseBar (name) {
  const box = $('div'), bar = $('div', 'bar'), note = $('span', 'tag')
  const go = $('button', 'primary', `Analyse runs of ${name}`)
  go.disabled = S.evolvePending
  if (S.evolvePending) note.textContent = 'requested, waiting for brain watch to start it'
  go.onclick = async () => {
    go.disabled = true; note.className = 'tag'; note.textContent = 'asking'
    try {
      const r = await api('/api/analyse', { method: 'POST', body: { playbook: name } })
      note.textContent = r.watching ? `starting brain playbook analyse ${name} in a new Terminal. Its proposals appear under step 2` : `saved, waiting for \`brain watch\` to start it`
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; go.disabled = false }
  }
  bar.append(go, note)
  box.append(bar)
  if (!S.watching) box.append($('p', 'sub', 'Nothing is listening, so the button only leaves the request. Run it yourself, or leave brain watch open and the button starts it:'),
    cmd(`cd ${S.hostBrain} && brain playbook analyse ${name}`))
  return box
}

/* What a project left behind in the brain-wide memory — the part the next project reads.
   Its own record (brief, decisions, phases) has its own tabs; this is what it taught. */
const hasMemory = p => !!(p.memory.knowledge.length || p.memory.log.length || p.client
  || Object.values(p.memory.proposals).some(l => l.length))

function projectMemoryBlock (p) {
  const m = p.memory, box = $('div')
  box.append($('p', 'sub', `What ${p.name} taught the brain: the proposals it filed, the knowledge pages compiled from its record, and the log of what happened when.`))
  box.append($('h2', '', 'Proposals it filed'))
  box.append(proposalsBlock(m.proposals, p.name))

  box.append($('h2', '', `knowledge/ · ${m.knowledge.length}`))
  box.append($('p', 'sub', 'Pages that cite this project under ## Sources. Edit them under Memory.'))
  if (!m.knowledge.length) box.append($('div', 'note', 'No page cites this project yet. The retro phase compiles what it taught into knowledge/.'))
  for (const name of m.knowledge) {
    const k = S.knowledge.find(x => x.name === name)
    box.append(fileDetails(k.path, name))
    if (k.summary) box.append($('p', 'sub', k.summary))
  }

  if (p.client && S.clients.some(c => c.slug === p.client)) {
    box.append($('h2', '', `clients/${p.client}`))
    box.append($('p', 'sub', 'Shared by every project for this client.'))
    box.append(fileDetails(`memory/clients/${p.client}/profile.md`, 'profile.md'))
  }

  box.append($('h2', '', `log.md · ${m.log.length}`))
  box.append(m.log.length
    ? md([...m.log].reverse().map(e => `- **${e.head}**${e.body ? `: ${e.body.replace(/\n/g, ' ')}` : ''}`).join('\n'))
    : $('div', 'note', 'No log entry names this project.'))
  return box
}

/* Most new playbooks are a variation on one you already have, which is what docs/playbooks.md
   tells you to do by hand: copy a folder and edit it. */
function newPlaybookForm () {
  const box = $('div')
  const bar = $('div', 'bar'), note = $('span', 'tag')
  const name = document.createElement('input')
  name.type = 'text'; name.placeholder = 'name'; name.size = 18
  name.setAttribute('aria-label', 'new playbook name')
  const desc = document.createElement('input')
  desc.type = 'text'; desc.placeholder = 'one-line description'
  desc.setAttribute('aria-label', 'new playbook description')
  const from = $('select')
  from.setAttribute('aria-label', 'copy from')
  const blank = $('option', '', 'start from a skeleton'); blank.value = ''
  from.append(blank)
  for (const p of S.playbooks) { const o = $('option', '', `copy ${p.name}`); o.value = p.name; from.append(o) }
  for (const e of S.examples) {
    if (S.playbooks.some(p => p.name === e.name)) continue
    const o = $('option', '', `copy example ${e.name}`); o.value = e.name; from.append(o)
  }
  const make = $('button', 'primary', 'Create')
  make.onclick = async () => {
    make.disabled = true; note.className = 'tag'; note.textContent = 'creating'
    try {
      const r = await api('/api/playbook', { method: 'POST', body: { name: name.value.trim(), description: desc.value.trim(), from: from.value } })
      S = await api('/api/state')
      location.hash = `#/playbook/${r.name}`
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; make.disabled = false }
  }
  name.onkeydown = desc.onkeydown = e => { if (e.key === 'Enter') make.click() }
  bar.append(name, from, desc, make, note)
  box.append(bar)
  box.append($('p', 'sub', 'The name becomes the folder and the argument to brain new, so it is lowercase letters, digits and dashes. A skeleton starts with plan, build, code-review and retro so it is runnable and lint-clean straight away.'))
  return box
}

/* What an app brings is the app's: its playbooks name its roles, its roles name its skills,
   so none of them is deleted on its own. Each shows which app it came with, links there,
   and goes when the app is uninstalled. */
function appTag (app) {
  const a = $('a', 'tag app-tag', `app: ${S.apps.find(x => x.name === app)?.label || app}`)
  a.href = `#/apps/${app}`; a.title = `Comes with the app '${app}'`
  return a
}
function appOwnedNote (kind, app) {
  const n = $('div', 'note')
  const a = $('a', '', S.apps.find(x => x.name === app)?.label || app); a.href = `#/apps/${app}`
  n.append(`This ${kind} comes with the app `, a, `, whose other parts depend on it, so it cannot be deleted on its own. Uninstalling the app removes it with everything else the app brought.`)
  return n
}

/* system/ is not auto-committed (commit_memory stages only memory/), so an uncommitted
   playbook deleted here is gone. The typed confirmation and the recovery command are
   the whole safety net. */
function deletePlaybookPanel (p) {
  if (p.app) return appOwnedNote('playbook', p.app)
  const box = $('div')
  const users = S.projects.filter(x => x.playbook === p.name)
  if (users.length) {
    box.append($('div', 'note warn',
      `${users.map(u => u.name).join(', ')} still point at this playbook. Deleting it would make brain status and brain run fail for them, so it is blocked until they are gone.`))
    return box
  }
  box.append($('p', 'sub', `Removes system/playbooks/${p.name}/ and its ${p.phases.length} phases. No project points at it. system/ is not auto-committed, so the command below only recovers it if it was committed.`))
  const bar = $('div', 'bar'), note = $('span', 'tag')
  const confirm = document.createElement('input')
  confirm.type = 'text'; confirm.placeholder = `type ${p.name} to confirm`; confirm.size = 24
  confirm.setAttribute('aria-label', 'confirm playbook name')
  const del = $('button', 'danger', 'Delete playbook')
  del.onclick = async () => {
    del.disabled = true; note.className = 'tag'; note.textContent = 'deleting'
    try {
      await api('/api/playbook', { method: 'DELETE', body: { name: p.name, confirm: confirm.value.trim() } })
      S = await api('/api/state')
      location.hash = '#/playbooks'
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; del.disabled = false }
  }
  bar.append(confirm, del, note)
  box.append(bar, cmd(`git -C ${S.hostBrain} checkout system/playbooks/${p.name}`))
  return box
}

/* The way a playbook starts: describe the work, and the brain's own playbook-author
   drafts the phases, picks the roles that exist and proposes the ones that do not. It
   runs in a Terminal window `brain watch` opens, asks its questions there, and the draft
   lands on its own page here for the human to install. */
function draftForm () {
  const box = $('div')
  const name = document.createElement('input')
  name.type = 'text'; name.placeholder = 'name, e.g. seo-article'; name.size = 22
  name.setAttribute('aria-label', 'new playbook name')
  const desc = document.createElement('textarea'); desc.rows = 3; desc.style.minHeight = '0'
  desc.placeholder = 'What work, in what order, what must be checked, and where you want to approve. E.g.: blog articles for our Webflow blog: research the keyword and the competitors we name, outline, I approve the outline, write in our voice, fact check, I approve the final.'
  desc.setAttribute('aria-label', 'describe the playbook')
  const bar = $('div', 'bar'), note = $('span', 'tag')
  const go = $('button', 'primary', 'Draft it with the author')
  go.onclick = async () => {
    go.disabled = true; note.className = 'tag'; note.textContent = 'asking'
    try {
      const r = await api('/api/draft', { method: 'POST', body: { name: name.value.trim(), description: desc.value } })
      S = await api('/api/state')
      location.hash = `#/draft/${r.name}`
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; go.disabled = false }
  }
  bar.append(name, go, note)
  box.append(desc, bar)
  box.append($('p', 'sub', 'A Terminal window opens with the author. It may ask you a few questions there; answer them and the window closes by itself. The draft then shows up under Drafts below, where you install it.'))
  return box
}

/* Changing an installed playbook in words: the author revises a copy of it, and the
   copy lands on the draft page, marked with what changed, for you to install over it. */
function adjustForm (name) {
  const box = $('div'), d = S.pending.drafts.find(x => x.name === name)
  if (d) {
    const a = $('a', '', d.pending ? 'The author is working on an adjustment' : 'An adjustment is ready to review')
    a.href = `#/draft/${name}`
    const n = $('div', 'note'); n.append(a); box.append(n)
    return box
  }
  const desc = document.createElement('textarea'); desc.rows = 3; desc.style.minHeight = '0'
  desc.placeholder = 'What should be different. E.g.: the intros run too long, and every article should end with a short FAQ.'
  desc.setAttribute('aria-label', 'what should change')
  const bar = $('div', 'bar'), note = $('span', 'tag'), go = $('button', 'primary', 'Adjust it with the author')
  go.onclick = async () => {
    go.disabled = true; note.className = 'tag'; note.textContent = 'asking'
    try {
      await api('/api/draft', { method: 'POST', body: { name, description: desc.value, adjust: true } })
      S = await api('/api/state'); location.hash = `#/draft/${name}`
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; go.disabled = false }
  }
  bar.append(go, note)
  box.append(desc, bar, $('p', 'sub', 'The author revises a copy in a Terminal window and may ask a question there. Nothing changes until you install the copy from its draft page.'))
  return box
}

function playbooksView () {
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', 'Playbooks'), $('p', 'sub', 'A playbook is an ordered list of phases, each run by a role.'))
  box.append(head)
  box.append($('h2', '', 'New playbook'))
  box.append(draftForm())
  if (S.pending.drafts.length) {
    box.append($('h2', '', `Drafts (${S.pending.drafts.length})`))
    if (!S.watching && S.pending.drafts.some(d => d.pending)) box.append(watchNote('the author is not started'))
    const rows = $('div', 'rows')
    for (const d of S.pending.drafts) {
      const r = $('div', 'row k2')
      const a = $('a', 'name', d.name); a.href = `#/draft/${d.name}`
      const adjusting = S.playbooks.some(p => p.name === d.name)
      r.append(a, $('div', 'tag', d.pending ? (S.watching ? 'the author is working on it' : 'waiting for brain watch') : d.exists ? (adjusting ? 'adjustment ready to install' : 'draft ready to install') : 'nothing drafted yet'))
      rows.append(r)
    }
    box.append(rows)
  }
  const more = document.createElement('details'); more.className = 'fold'
  more.append($('summary', '', 'Or start from a skeleton or a copy'), newPlaybookForm())
  box.append(more)
  box.append($('h2', '', `Playbooks (${S.playbooks.length})`))
  if (!S.playbooks.length) {
    const e = $('div', 'empty')
    e.append($('h3', '', 'None yet, on purpose'),
      $('p', '', 'A playbook is how your team works, so the repo ships without any. Write one above, or start from one of the examples in the dropdown and edit it.'))
    box.append(e)
  }
  const rows = $('div', 'rows')
  for (const p of S.playbooks) {
    const r = $('div', 'row k2')
    const left = $('div'); const a = $('a', 'name', p.name); a.href = `#/playbook/${p.name}`
    left.append(a, $('div', 'tag', `${p.phases.length} phases`))
    if (p.app) left.append(appTag(p.app))
    const right = $('div')
    right.append($('div', 'meta', p.description || 'no description'))
    const pipe = $('div', 'pipe')
    for (const ph of p.phases) pipe.append($('span', 'chip ' + (ph.role === 'human' ? 'human' : 'pending'), ph.phase))
    right.append(pipe)
    r.append(left, right); rows.append(r)
  }
  box.append(rows); return box
}

/* One draft: what the author wrote, the roles it proposes with the human's choice of
   engine and model for each, the problems the installed playbook would have, and the
   three ways out — install, ask for more changes, discard. */
function draftView (name) {
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', `Draft: ${name}`))
  box.append(head)
  const body = $('div'); body.append($('div', 'skel'), $('div', 'skel'))
  box.append(body)
  api(`/api/draft?name=${encodeURIComponent(name)}`).then(d => {
    body.textContent = ''
    if (d.installed) head.firstChild.textContent = `Adjusting: ${name}`
    if (d.pending) {
      body.append($('div', 'note', S.watching
        ? 'The author is working on it in a Terminal window. If it asks a question, answer it there; this page updates when the window closes.'
        : 'Waiting for brain watch to open the author.'))
      if (!S.watching) body.append(watchNote('the author is not started'))
      if (d.request) body.append($('h2', '', 'What you asked for'), $('pre', 'plain', d.request))
      if (!d.exists) return
    }
    if (!d.exists) {
      const e = $('div', 'empty')
      e.append($('h3', '', 'Nothing drafted yet'), $('p', '', 'The author wrote no phases file. Ask again below, or discard this draft.'))
      body.append(e)
    } else {
      body.append($('p', 'sub', d.description || 'no description line'))
      if (d.installed) {
        if (!d.phases.some(p => p.change) && !d.removed.length && !d.alsoChanged.length) body.append($('div', 'note', 'Nothing differs from the installed playbook yet.'))
        if (d.removed.length) body.append($('div', 'note warn', `Removes ${d.removed.join(', ')}. A project that already has files for a removed or renamed phase keeps them, unused.`))
        if (d.alsoChanged.length) body.append($('p', 'sub', `Also changes ${d.alsoChanged.join(', ')}.`))
        const busy = S.projects.filter(x => x.playbook === name && x.next && x.phases.some(ph => ph.state === 'done'))
        if (busy.length) body.append($('div', 'note warn', `${busy.map(x => x.name).join(', ')} ${busy.length > 1 ? 'are' : 'is'} partway through ${name}: the rest of its phases run under this version once you install it.`))
      }
      body.append($('h2', '', `Phases (${d.phases.length})`))
      for (const p of d.phases) {
        const det = document.createElement('details'); det.className = 'phase'
        const sum = $('summary', ''); sum.append($('span', 'name', p.phase), ' ', $('span', 'tag', p.role === 'human' ? 'you' : p.role + (p.fix ? ` · on FAIL ${p.fix} fixes` : '')))
        if (p.change) sum.append(' ', $('span', 'tag warn', p.change))
        const pr = $('div', 'prose'); pr.append(md(p.section || '(no section)'))
        det.append(sum, pr); body.append(det)
      }
      if (d.preamble) { const det = document.createElement('details'); det.className = 'fold'; const pr = $('div', 'prose'); pr.append(md(d.preamble)); det.append($('summary', '', 'What every phase is told first'), pr); body.append(det) }
      if (d.inputs.length) {
        body.append($('h2', '', `What it will ask for (${d.inputs.length})`), $('p', 'sub', 'The New project form this playbook gets. You can change it on the playbook\'s page after installing.'))
        const mine = d.inputs.filter(i => i.per === 'project'), theirs = d.inputs.filter(i => i.per === 'client')
        if (mine.length) body.append(inputsForm(mine, {}, { readonly: true }).el)
        if (theirs.length) body.append($('h3', 'tag', 'asked once per client'), inputsForm(theirs, {}, { readonly: true }).el)
      }
    }
    const choices = {}
    if (d.roles.length) {
      body.append($('h2', '', `New agents it proposes (${d.roles.length})`), $('p', 'sub', 'Each becomes a role: its instructions as written here, and the engine, model and effort you pick. Change them later under Roles.'))
      body.append(modelDatalists())
      for (const r of d.roles) {
        const det = document.createElement('details'); det.className = 'phase'
        const sum = $('summary', ''); sum.append($('span', 'name', r.name), ' ')
        const eng = $('select'), eff = $('select')
        const mod = document.createElement('input'); mod.type = 'text'; mod.value = 'default'; mod.size = 14
        mod.setAttribute('aria-label', `model for ${r.name}`)
        for (const e of engineChoices()) { const o = $('option', '', e); o.value = e; eng.append(o) }
        const fill = () => {
          mod.setAttribute('list', `models-${eng.value}`)
          const e = S.models[eng.value], hit = e.options.find(o => o.slug === mod.value)
          const allowed = hit && hit.efforts.length ? hit.efforts : e.efforts
          eff.textContent = ''
          for (const v of ['default', ...allowed]) { const o = $('option', '', v); o.value = v; eff.append(o) }
        }
        fill(); eng.onchange = () => { if (!S.models[eng.value].options.some(o => o.slug === mod.value)) mod.value = 'default'; fill() }; mod.onchange = fill
        for (const el of [eng, mod, eff]) el.onclick = e => e.preventDefault()
        choices[r.name] = () => ({ engine: eng.value, model: mod.value.trim() || 'default', effort: eff.value === 'default' ? '' : eff.value })
        sum.append(eng, ' ', mod, ' ', eff)
        const pr = $('div', 'prose'); pr.append(md(r.doc))
        det.append(sum, pr); body.append(det)
      }
    }
    const probs = lintBlock(d.problems, () => true)
    if (probs) { body.append($('h2', '', 'Before it can run')); body.append(probs) }

    body.append($('h2', '', 'Next'))
    const bar = $('div', 'bar'), note = $('span', 'tag')
    if (d.exists && !d.pending) {
      const ok = $('button', 'primary', d.installed ? 'Install changes' : 'Install playbook')
      ok.disabled = d.problems.some(p => p.level === 'error')
      ok.onclick = async () => {
        ok.disabled = true; note.className = 'tag'; note.textContent = 'installing'
        try {
          const r = await api('/api/draft-install', { method: 'POST', body: { name, roles: Object.fromEntries(Object.entries(choices).map(([k, f]) => [k, f()])) } })
          S = await api('/api/state')
          location.hash = `#/playbook/${r.installed}`
        } catch (e) { note.className = 'tag err'; note.textContent = e.message; ok.disabled = false }
      }
      bar.append(ok)
    }
    bar.append(note); body.append(bar)
    if (!d.pending) {
      body.append($('h3', 'tag', 'ask for more changes'))
      const again = document.createElement('textarea'); again.rows = 3; again.style.minHeight = '0'
      again.placeholder = d.exists ? 'What to change. The author reads the draft first, then revises it.' : 'Describe the path again, or differently.'
      const ab = $('div', 'bar'), an = $('span', 'tag'), ask = $('button', '', 'Open the author again')
      ask.onclick = async () => {
        ask.disabled = true; an.className = 'tag'; an.textContent = 'asking'
        try { await api('/api/draft', { method: 'POST', body: { name, description: again.value } }); S = await api('/api/state'); render() } catch (e) { an.className = 'tag err'; an.textContent = e.message; ask.disabled = false }
      }
      ab.append(ask, an); body.append(again, ab)
      body.append($('h3', 'tag', 'discard'))
      const db = $('div', 'bar'), dn = $('span', 'tag')
      const confirm = document.createElement('input'); confirm.type = 'text'; confirm.placeholder = `type ${name} to confirm`; confirm.size = 24
      const del = $('button', 'danger', 'Discard draft')
      del.onclick = async () => {
        del.disabled = true
        try { await api('/api/draft', { method: 'DELETE', body: { name, confirm: confirm.value.trim() } }); S = await api('/api/state'); location.hash = '#/playbooks' } catch (e) { dn.className = 'tag err'; dn.textContent = e.message; del.disabled = false }
      }
      db.append(confirm, del, dn); body.append(db)
    }
  }).catch(e => { body.textContent = ''; body.append($('div', 'note err', e.message)) })
  return box
}

/* Which role runs a phase, and who fixes it when a review fails. This is the pairing
   bin/brain reads out of the phases file, so both columns are chosen here together
   rather than typed into the raw editor below and hopefully spelled right. */
function phaseRolePicker (pb, ph) {
  const bar = $('span', 'bar'); bar.style.margin = '0'
  const note = $('span', 'tag')
  const sel = (value, blank, aria) => {
    const el = $('select'); el.setAttribute('aria-label', aria)
    if (blank) { const o = $('option', '', blank); o.value = ''; o.selected = !value; el.append(o) }
    for (const r of [...S.roles.map(r => r.role), ...(blank ? [] : ['human'])].sort()) {
      const o = $('option', '', r); o.value = r; o.selected = r === value; el.append(o)
    }
    // A select inside <summary> would toggle the <details> on every click.
    el.onclick = el.onmousedown = e => e.stopPropagation()
    return el
  }
  const role = sel(ph.role, '', `role for ${ph.phase}`)
  const fix = sel(ph.fix, 'no fix-role', `fix-role for ${ph.phase}`)
  const apply = async () => {
    note.className = 'tag'; note.textContent = 'saving'
    try {
      await api('/api/phase-role', { method: 'POST', body: { playbook: pb.name, phase: ph.phase, role: role.value, fix: fix.value } })
      S = await api('/api/state'); render()
    } catch (e) { note.className = 'tag err'; note.textContent = e.message }
  }
  role.onchange = fix.onchange = apply
  bar.append(role, $('span', 'tag', 'fix:'), fix, note)
  return bar
}

/* The inputs file as rows a non-programmer can edit: a question, what kind of answer,
   whether it is asked every time or once per client, and whether it is required — with
   the form it produces beside it. Saving writes the file and the brief headings. */
function inputsEditor (p) {
  const box = $('div', 'ins')
  const rows = $('div', 'defs'), preview = $('div')
  const status = $('span', ''), note = $('span', 'tag')
  const list = p.inputs.map(i => ({ ...i }))
  const changed = () => { status.className = 'dirty'; status.textContent = 'unsaved'; draw() }
  const draw = () => {
    rows.textContent = ''
    list.forEach((i, k) => {
      const r = $('div', 'def')
      const label = Object.assign(document.createElement('input'), { type: 'text', value: i.label, placeholder: 'the question, e.g. Competitor pages' })
      label.setAttribute('aria-label', `input ${k + 1} label`)
      label.onchange = () => { i.label = label.value; changed() }
      const type = $('select'); type.setAttribute('aria-label', `input ${k + 1} type`)
      for (const [v, t] of INPUT_KINDS) type.append(Object.assign(document.createElement('option'), { value: v, textContent: t, selected: v === i.type }))
      type.onchange = () => { i.type = type.value; changed() }
      const per = $('select'); per.setAttribute('aria-label', `input ${k + 1} asked`)
      for (const [v, t] of [['project', 'every project'], ['client', 'once per client']]) per.append(Object.assign(document.createElement('option'), { value: v, textContent: t, selected: v === i.per }))
      per.onchange = () => { i.per = per.value; changed() }
      const req = $('label', 'tag'), cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!i.required })
      cb.onchange = () => { i.required = cb.checked; changed() }
      req.append(cb, document.createTextNode(' required'))
      const del = $('button', '', 'Remove'); del.setAttribute('aria-label', `remove ${i.label || 'input'}`)
      del.onclick = () => { list.splice(k, 1); changed() }
      r.append(label, type)
      if (i.type === 'choice') {
        const opts = Object.assign(document.createElement('input'), { type: 'text', value: (i.options || []).join(', '), placeholder: 'the choices, e.g. en, de' })
        opts.setAttribute('aria-label', `input ${k + 1} choices`)
        opts.onchange = () => { i.options = opts.value.split(',').map(x => x.trim()).filter(Boolean); changed() }
        r.append(opts)
      }
      r.append(per, req, del)
      rows.append(r)
    })
    if (!list.length) rows.append($('p', 'sub', 'No inputs: the New project form asks the brief\'s headings as free text instead.'))
    preview.textContent = ''
    const shown = list.filter(i => i.label)
    preview.append($('h3', 'tag', 'the form, as it will look'))
    if (shown.some(i => i.per === 'project')) preview.append(inputsForm(shown.filter(i => i.per === 'project'), {}, { readonly: true }).el)
    if (shown.some(i => i.per === 'client')) preview.append($('h3', 'tag', 'asked once per client'), inputsForm(shown.filter(i => i.per === 'client'), {}, { readonly: true }).el)
  }
  draw()
  const add = $('button', '', 'Add input')
  add.onclick = () => { list.push({ label: '', type: 'text', per: 'project', required: false, options: [] }); changed() }
  const save = $('button', 'primary', 'Save inputs')
  save.onclick = async () => {
    save.disabled = true; note.className = 'tag'; note.textContent = 'saving'
    try {
      await api('/api/inputs', { method: 'POST', body: { playbook: p.name, prev: p.inputsText, inputs: list.map(i => ({ name: i.name, label: i.label, type: i.type, options: i.options || [], per: i.per, required: !!i.required })) } })
      status.className = ''; status.textContent = ''
      S = await api('/api/state'); render({ keepScroll: scrollY })
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; save.disabled = false }
  }
  const left = $('div'), bar = $('div', 'bar')
  bar.append(add, save, status, note)
  left.append(rows, bar)
  box.append(left, preview)
  return box
}

function playbookView (name) {
  const p = S.playbooks.find(x => x.name === name)
  if (!p) return $('div', 'note err', `No playbook '${name}'`)
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', p.name), $('p', 'sub', p.description || 'no description'))
  if (p.app) head.append(appTag(p.app))
  const users = S.projects.filter(x => x.playbook === name)
  if (users.length) head.append($('p', 'tag warn', `${users.length} project(s) use this: ${users.map(u => u.name).join(', ')}. Renaming a phase orphans their phase files.`))
  box.append(head)

  const mine = lintBlock(S.lint, f => f.where.includes(`playbooks/${name}`))
  if (mine) box.append(mine)

  box.append($('h2', '', 'Adjust with AI'))
  box.append($('p', 'sub', 'Not what you wanted? Say what should be different and the playbook-author revises it. You see what changed before anything is installed.'))
  box.append(adjustForm(name))

  box.append($('h2', '', 'Phases'))
  box.append($('p', 'sub', 'Each row is a line in the phases file. The body is its section of playbook.md, which is what the agent is told to follow.'))
  const wrap = $('div')
  for (const ph of p.phases) {
    const d = $('details', 'phase')
    const s = document.createElement('summary')
    const role = S.roles.find(r => r.role === ph.role)
    s.append(
      $('span', 'name', ph.phase),
      $('span', 'tag', role ? `${role.engine} ${role.model}` : ph.role === 'human' ? 'human gate' : `${ph.role} (missing)`),
      phaseRolePicker(p, ph)
    )
    d.append(s)
    const body = $('div', 'body')
    const sec = p.md.sections.find(x => x.heading === `## ${ph.phase}`)
    if (!sec) body.append($('div', 'note err', `No "## ${ph.phase}" section in playbook.md. brain matches the heading byte-exactly, so this phase has no instructions.`))
    d.ontoggle = () => {
      if (!d.open || d.dataset.loaded) return
      d.dataset.loaded = '1'
      if (sec) body.append(sectionEditor(p.name, ph.phase))
    }
    d.append(body); wrap.append(d)
  }
  box.append(wrap)

  box.append($('h2', '', `Inputs (${p.inputs.length})`))
  box.append($('p', 'sub', 'What the New project form asks for this playbook. Each answer lands in the project\'s brief under its label, which every phase reads first; one asked once per client is kept in that client\'s profile instead.'))
  box.append(inputsEditor(p))

  // Two steps on purpose: analysing only files proposals, and nothing in system/ changes
  // until you have chosen which of them to use.
  box.append($('h2', '', '1 · Analyse its runs'))
  box.append($('p', 'sub', 'Scores every project that ran this playbook from its record, and an agent finds where the rework came from and proposes what to change. Nothing changes yet. The analysis is a knowledge page, so the next run reads it too.'))
  box.append(playbookAnalyseBar(name))
  if (p.analysis) box.append(fileDetails(p.analysis, `knowledge/playbook-${name}.md, the last analysis`))
  box.append($('h2', '', '2 · Choose what to evolve'))
  box.append($('p', 'sub', `Accept what should change this playbook or its roles, decline what should not. Evolve ${name} applies its accepted ones and nothing else, not even proposals accepted for other playbooks. Declined ones stay on record so they are not proposed again.`))
  box.append(proposalsBlock(p.proposals, name, name))

  box.append($('h2', '', 'phases file'))
  box.append($('p', 'sub', 'Columns are phase, role, fix-role. Order is execution order. Edited as text so comments and alignment survive.'))
  box.append(editor(`${p.dir}/phases`, { rows: Math.max(8, p.phases.length + 3) }))

  box.append($('h2', '', 'brief template'))
  box.append($('p', 'sub', 'Copied into a new project by brain new, then filled in by you.'))
  box.append(editor(`${p.dir}/brief.md`, { rows: 12 }))

  box.append($('h2', '', p.app ? 'Removing it' : 'Delete this playbook'))
  box.append(deletePlaybookPanel(p))

  if (Object.keys(p.env).length) {
    box.append($('h2', '', 'playbook.env'))
    box.append($('p', 'sub', 'Sourced as bash by brain new. Values must stay shell-safe.'))
    box.append(editor(`${p.dir}/playbook.env`, { rows: 4 }))
  }
  return box
}

/* The phase row and its instructions live in two different files. This edits the
   playbook.md section in place without touching the title, the description line,
   the preamble, or any neighbouring section. */
// An app's playbook lives in system/apps/<app>/playbooks/; the state says where.
const pbDir = name => S.playbooks.find(x => x.name === name)?.dir || `system/playbooks/${name}`

function sectionEditor (playbook, phase) {
  const box = $('div'), bar = $('div', 'bar'), status = $('span', '')
  const ta = $('textarea'); ta.rows = 7; ta.setAttribute('aria-label', `${phase} instructions`); ta.disabled = true
  const save = $('button', 'primary', 'Save'); save.disabled = true
  let loaded = null, whole = null
  const mark = () => { const d = ta.value !== loaded; save.disabled = !d; status.className = d ? 'dirty' : ''; status.textContent = d ? 'unsaved' : '' }
  api(`/api/file?path=${encodeURIComponent(`${pbDir(playbook)}/playbook.md`)}`).then(d => {
    whole = d.content
    const lines = whole.split('\n')
    const i = lines.indexOf(`## ${phase}`)
    let j = i + 1; while (j < lines.length && !lines[j].startsWith('## ')) j++
    loaded = lines.slice(i + 1, j).join('\n').trim()
    ta.value = loaded; ta.disabled = false; mark()
  }).catch(e => { status.className = 'dirty'; status.textContent = e.message })
  save.onclick = async () => {
    save.disabled = true; status.className = ''; status.textContent = 'saving'
    try {
      await api('/api/section', { method: 'POST', body: { playbook, phase, body: ta.value, prev: whole } })
      const d = await api(`/api/file?path=${encodeURIComponent(`${pbDir(playbook)}/playbook.md`)}`)
      whole = d.content; loaded = ta.value.trim(); ta.value = loaded; mark()
      status.className = 'saved'; status.textContent = 'saved'
      setTimeout(() => { if (status.textContent === 'saved') status.textContent = '' }, 2000)
    } catch (e) {
      status.className = 'dirty'
      status.textContent = e.status === 409 ? 'playbook.md changed on disk - reopen this row' : e.message
      mark()
    }
  }
  ta.oninput = mark
  bar.append($('span', 'tag', `playbook.md · ## ${phase}`), $('span', 'grow'), status, save)
  box.append(ta, bar); return box
}

/* Model suggestions come from the server: claude's documented aliases, and codex's own
   model catalog when it is mounted. The field is a free-text input with a datalist
   rather than a select, so a model neither side knows about can still be typed. */
/* The agents a role can run on: the ones this brain installed, and the role's own when it
   names one that is not (so the select still shows the truth). */
const engineChoices = (current = '') => S.engines.filter(e => e.on || e.name === current).map(e => e.name)
const modelDatalists = () => frag(...S.engines.filter(e => S.models[e.name]).map(e => modelDatalist(e.name)))

function modelDatalist (engine) {
  const dl = document.createElement('datalist')
  dl.id = `models-${engine}`
  for (const o of S.models[engine].options) {
    const opt = document.createElement('option')
    opt.value = o.slug
    if (o.description) opt.label = o.description
    dl.append(opt)
  }
  return dl
}

/* Which skills a role should reach for. Neither CLI can restrict the skill set per run
   (claude's --disable-slash-commands is all-or-nothing), so this writes a Skills: line
   into the role's instructions, which brain tells every agent to follow. It points the
   role at the right skill; it does not stop it loading others. */
function roleSkillPicker (r) {
  const box = $('div')
  box.append($('p', 'sub', "Written as a Skills: line in this role's instructions, which the agent is told to follow. Skills also trigger on their own description, so this directs the role rather than restricting it."))
  const missing = r.names.filter(n => !S.skills.declared.some(d => d.name === n))
  if (missing.length) box.append($('div', 'note warn', `This role names ${missing.join(', ')}, which the brain does not declare. Add it on the Skills screen, or the role points at something the sandbox will not have.`))
  const rows = $('div', 'rows'), boxes = []
  for (const d of S.skills.declared) {
    const row = $('div', 'row k3')
    const label = document.createElement('label')
    label.style.display = 'flex'; label.style.gap = '7px'; label.style.alignItems = 'baseline'; label.style.cursor = 'pointer'
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = d.name
    cb.checked = r.names.includes(d.name)
    boxes.push(cb)
    label.append(cb, $('span', 'name', d.name))
    row.append(label, $('div', 'tag', d.source === 'own' ? 'own' : d.source === 'host' ? 'host skill' : 'external'),
      $('div', 'meta trunc', d.description || d.detail))
    rows.append(row)
  }
  if (!r.editable) {
    for (const cb of boxes) cb.disabled = true
    box.append($('div', 'note', 'This role explains its skills in prose rather than as a list, so the boxes are read-only. Edit the instructions below to change them, and the reasoning stays with them.'))
    box.append($('pre', 'plain', r.prose))
    box.append(rows); return box
  }
  const bar = $('div', 'bar'), save = $('button', 'primary', 'Save skills'), note = $('span', 'tag')
  save.onclick = async () => {
    save.disabled = true; note.className = 'tag'; note.textContent = 'saving'
    try {
      await api('/api/role-skills', { method: 'POST', body: { role: r.role, skills: boxes.filter(c => c.checked).map(c => c.value) } })
      S = await api('/api/state'); render()
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; save.disabled = false }
  }
  bar.append(save, note)
  box.append(rows, bar)
  return box
}

function rolesView () {
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', 'Roles'), $('p', 'sub', 'Engine, model and reasoning effort per role. Each change rewrites that one line of roles.conf. Effort "default" passes no flag, so nothing changes until you pick one.'))
  head.append($('p', 'tag', `agents: ${S.engines.filter(e => e.on).map(e => `${e.name} (models: ${S.models[e.name]?.source || 'free text'})`).join(', ')} — add another with brain engine add. The model box is free text, so anything your CLI accepts works.`))
  box.append(head)
  box.append(modelDatalists())
  const mine = lintBlock(S.lint, f => f.where.startsWith('roles.conf'))
  if (mine) box.append(mine)

  box.append($('h2', '', 'New role'))
  box.append(newRoleForm())
  box.append($('h2', '', `Roles (${S.roles.length})`))

  const rows = $('div', 'rows')
  for (const r of S.roles) {
    const row = $('div', 'row roles')
    const left = $('div')
    const a = $('a', 'name', r.role); a.href = `#/role/${r.role}`
    left.append(a)
    const uses = []
    for (const p of S.playbooks) for (const ph of p.phases) {
      if (ph.role === r.role) uses.push(`${p.name}/${ph.phase}`)
      else if (ph.fix === r.role) uses.push(`${p.name}/${ph.phase} (fix)`)
    }
    left.append($('div', 'tag', `${uses.length ? `${uses.length} phase(s)` : 'unused'}${r.names.length ? ` · ${r.names.length} skill(s)` : ''}`))
    if (r.app) left.append(appTag(r.app))

    const ctl = $('div', 'bar'); ctl.style.margin = '0'
    const eng = $('select'), eff = $('select')
    const mod = document.createElement('input')
    mod.type = 'text'; mod.value = r.model || 'default'; mod.size = 15
    mod.setAttribute('aria-label', `model for ${r.role}`)
    mod.title = 'Model name. Suggestions come from the engine; any name your CLI accepts works.'
    for (const e of engineChoices(r.engine)) { const o = $('option', '', e); o.value = e; o.selected = e === r.engine; eng.append(o) }
    const bindList = () => mod.setAttribute('list', `models-${eng.value}`)
    bindList()
    // Reasoning levels are per model, not just per engine: gpt-5.5 stops at xhigh
    // while gpt-6-astra goes to ultra.
    const fillEfforts = () => {
      eff.textContent = ''
      const e = S.models[eng.value]
      const hit = e.options.find(o => o.slug === mod.value)
      const allowed = hit && hit.efforts.length ? hit.efforts : e.efforts
      if (!allowed.includes(eff.dataset.want)) eff.dataset.want = 'default'
      for (const v of ['default', ...allowed]) { const o = $('option', '', v); o.value = v; o.selected = v === eff.dataset.want; eff.append(o) }
      const d = hit && hit.defaultEffort
      eff.title = `Reasoning effort. "default" passes no flag at all${d ? `, letting ${mod.value} use its own default of ${d}` : ''}.`
    }
    eff.dataset.want = r.effort || 'default'; fillEfforts()
    const note = $('span', 'tag')
    const apply = async () => {
      note.className = 'tag'; note.textContent = 'saving'
      try {
        await api('/api/role', { method: 'POST', body: { role: r.role, engine: eng.value, model: mod.value, effort: eff.value } })
        note.textContent = 'saved'; S = await api('/api/state')
        setTimeout(() => { note.textContent = '' }, 1800)
      } catch (e) { note.className = 'tag err'; note.textContent = e.message }
    }
    eng.onchange = () => {
      bindList()
      // A model from the other engine is meaningless here, so fall back to default.
      if (!S.models[eng.value].options.some(o => o.slug === mod.value)) mod.value = 'default'
      fillEfforts(); apply()
    }
    mod.onchange = () => { if (!mod.value.trim()) mod.value = 'default'; fillEfforts(); apply() }
    eff.onchange = () => { eff.dataset.want = eff.value; apply() }
    ctl.append(eng, mod, eff, note)

    const right = $('div', 'meta trunc')
    right.textContent = uses.join(', ') || 'Not referenced by any playbook'
    if (!r.doc) { const w = $('div', 'tag err', `no system/roles/${r.role}.md`); right.append(w) }
    row.append(left, ctl, right); rows.append(row)
  }
  box.append(rows); return box
}

/* A role is a roles.conf line plus roles/<name>.md. Creating them separately is the
   commonest way to get a lint error, so the form always writes both. */
function newRoleForm () {
  const box = $('div')
  const bar = $('div', 'bar'), note = $('span', 'tag')
  const name = document.createElement('input')
  name.type = 'text'; name.placeholder = 'name'; name.size = 18
  name.setAttribute('aria-label', 'new role name')
  const purpose = document.createElement('input')
  purpose.type = 'text'; purpose.placeholder = 'one line: what this role is for'
  purpose.setAttribute('aria-label', 'what the role is for')
  const eng = $('select')
  eng.setAttribute('aria-label', 'engine')
  for (const e of engineChoices()) { const o = $('option', '', e); o.value = e; eng.append(o) }
  const mod = document.createElement('input')
  mod.type = 'text'; mod.value = 'default'; mod.size = 12
  mod.setAttribute('aria-label', 'model')
  const bind = () => mod.setAttribute('list', `models-${eng.value}`)
  bind(); eng.onchange = bind
  const make = $('button', 'primary', 'Create')
  make.onclick = async () => {
    make.disabled = true; note.className = 'tag'; note.textContent = 'creating'
    try {
      const r = await api('/api/role-new', { method: 'POST', body: { name: name.value.trim(), engine: eng.value, model: mod.value.trim() || 'default', purpose: purpose.value.trim() } })
      S = await api('/api/state')
      location.hash = `#/role/${r.role}`
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; make.disabled = false }
  }
  name.onkeydown = purpose.onkeydown = e => { if (e.key === 'Enter') make.click() }
  bar.append(name, eng, mod, purpose, make, note)
  box.append(bar)
  box.append($('p', 'sub', 'Writes system/roles/<name>.md with a skeleton and adds the line to roles.conf. It shows as unused until a playbook phase points at it, which is the next step.'))
  return box
}

function deleteRolePanel (r) {
  if (r.app) return appOwnedNote('role', r.app)
  const box = $('div')
  const uses = []
  for (const p of S.playbooks) for (const ph of p.phases) {
    if (ph.role === r.role) uses.push(`${p.name}/${ph.phase}`)
    if (ph.fix === r.role) uses.push(`${p.name}/${ph.phase} (fix)`)
  }
  if (uses.length) {
    box.append($('div', 'note warn',
      `${uses.join(', ')} still name this role. brain reads the role straight out of phases, so those phases would fail on the next run. Point them somewhere else first.`))
    return box
  }
  box.append($('p', 'sub', `Removes the roles.conf line and system/roles/${r.role}.md. No playbook names it. system/ is not auto-committed, so the command below only recovers it if it was committed.`))
  const bar = $('div', 'bar'), note = $('span', 'tag')
  const confirm = document.createElement('input')
  confirm.type = 'text'; confirm.placeholder = `type ${r.role} to confirm`; confirm.size = 24
  confirm.setAttribute('aria-label', 'confirm role name')
  const del = $('button', 'danger', 'Delete role')
  del.onclick = async () => {
    del.disabled = true; note.className = 'tag'; note.textContent = 'deleting'
    try {
      await api('/api/role', { method: 'DELETE', body: { name: r.role, confirm: confirm.value.trim() } })
      S = await api('/api/state')
      location.hash = '#/roles'
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; del.disabled = false }
  }
  bar.append(confirm, del, note)
  box.append(bar, cmd(`git -C ${S.hostBrain} checkout system/roles.conf system/roles/${r.role}.md`))
  return box
}

function roleView (name) {
  const r = S.roles.find(x => x.role === name)
  if (!r) return $('div', 'note err', `No role '${name}' in roles.conf`)
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', r.role), $('p', 'sub', `${r.engine} · model ${r.model} · effort ${r.effort || 'default (no flag passed)'}`))
  if (r.app) head.append(appTag(r.app))
  box.append(head)
  if (!r.doc) { box.append($('div', 'note err', `There is no system/roles/${name}.md. brain tells the agent to follow that file, so this role has no instructions.`)); return box }
  box.append($('h2', '', 'Skills this role should use'))
  box.append(roleSkillPicker(r))
  box.append($('h2', '', 'Instructions'))
  box.append($('p', 'sub', 'The agent is told to follow this file for every phase that uses this role.'))
  box.append(editor(r.doc, { rows: 18 }))
  box.append($('h2', '', r.app ? 'Removing it' : 'Delete this role'))
  box.append(deleteRolePanel(r))
  return box
}

/* The two-step workflow: declare the skill here, then sync from the terminal.
   Installing with `sbx skills add` directly looks like it works and then the next
   sync-skills prunes it, because the keep list is built from skills.list. */
function skillInstaller () {
  const box = $('div')
  box.append($('p', 'sub', 'Adding a skill is two steps: declare it here, then sync from the terminal. Skipping step one and running sbx skills add yourself installs the skill and the next sync removes it again, because the keep list is built from skills.list.'))

  const bar = $('div', 'bar')
  const input = document.createElement('input')
  input.type = 'text'; input.placeholder = 'owner/repo or a GitHub URL'
  input.setAttribute('aria-label', 'skill repository')
  const find = $('button', '', 'Find skills')
  const note = $('span', 'tag')
  bar.append(input, find, note)
  const results = $('div')
  box.append(bar, results)

  const look = async () => {
    const repo = input.value.trim()
    if (!repo) return
    results.textContent = ''; note.className = 'tag'; note.textContent = 'looking up'
    find.disabled = true
    try {
      const d = await api(`/api/skill-repo?repo=${encodeURIComponent(repo)}`)
      note.textContent = ''
      render(d)
    } catch (e) {
      note.className = 'tag err'; note.textContent = ''
      const n = $('div', 'note err'); n.append($('b', '', 'Lookup failed. '), $('span', '', e.message))
      const manual = $('p', 'sub', 'You can still add it by hand in skills.list below: one line of "<repo> <skill-name> <skill-name>". The names are the name: field of each SKILL.md, which is often not the folder name.')
      results.append(n, manual)
    }
    find.disabled = false
  }
  find.onclick = look
  input.onkeydown = e => { if (e.key === 'Enter') look() }

  function render (d) {
    const have = new Set(S.skills.declared.map(x => x.name))
    const fresh = d.skills.filter(s => !have.has(s.name))
    results.append($('p', 'sub', `${d.repo} on ${d.branch}: ${d.skills.length} skill(s), ${fresh.length} not yet declared. The name is what goes in skills.list; the folder is shown when it differs.`))
    const rows = $('div', 'rows'), boxes = []
    for (const sk of d.skills) {
      const r = $('div', 'row k3')
      const left = document.createElement('label')
      left.style.display = 'flex'; left.style.gap = '7px'; left.style.alignItems = 'baseline'; left.style.cursor = 'pointer'
      const cb = document.createElement('input'); cb.type = 'checkbox'
      cb.checked = false; cb.disabled = have.has(sk.name); cb.value = sk.name
      boxes.push(cb)
      left.append(cb, $('span', 'name', sk.name))
      const mid = $('div', 'tag', have.has(sk.name) ? 'already declared' : sk.dir !== sk.name ? `folder: ${sk.dir}` : '')
      r.append(left, mid, $('div', 'meta trunc', sk.description || ''))
      rows.append(r)
    }
    results.append(rows)

    const act = $('div', 'bar'), add = $('button', 'primary', 'Add to skills.list'), st = $('span', 'tag')
    const all = $('button', '', 'Select all new')
    all.onclick = () => { for (const cb of boxes) if (!cb.disabled) cb.checked = true }
    add.onclick = async () => {
      const names = boxes.filter(cb => cb.checked && !cb.disabled).map(cb => cb.value)
      if (!names.length) { st.className = 'tag err'; st.textContent = 'pick at least one'; return }
      add.disabled = true; st.className = 'tag'; st.textContent = 'writing'
      try {
        await api('/api/skill-source', { method: 'POST', body: { repo: d.repo, names } })
        S = await api('/api/state')
        st.textContent = `added ${names.length}`
        location.hash = '#/skills'; render2()
      } catch (e) { st.className = 'tag err'; st.textContent = e.message; add.disabled = false }
    }
    act.append(all, add, st)
    results.append(act)
  }
  return box
}

/* The app store: installed apps and what the apps repo offers, as one searchable grid,
   and a page per app with its README. The cockpit runs nothing: each button stages
   memory/.apps-request, brain watch runs `brain app <verb>` in the background (then
   sync-skills / sync-sandbox, as the terminal would tell you to) and leaves the outcome in
   .apps-status. One change at a time. What a terminal would ask becomes a confirm dialog:
   trusting an app's Studio code, and losing this brain's changes on uninstall. */
let storeTab = 'all', storeQuery = '', storeError = ''
const hueOf = name => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360
function appTile (name, ico, size = 44) {
  const t = $('span', 'app-tile'); t.style.setProperty('--h', hueOf(name)); t.style.width = t.style.height = `${size}px`
  t.append(icon(ico || 'puzzle-piece')); t.style.fontSize = `${Math.round(size * 0.5)}px`
  return t
}
// Installed and offered, one list: an installed app's own copy wins, the catalog adds the update flag.
function storeApps () {
  const cat = S.store.catalog?.apps || []
  const mine = S.apps.map(a => {
    const c = cat.find(x => x.name === a.name)
    return { name: a.name, label: a.label, icon: a.icon, version: a.version, desc: a.desc || c?.desc || '', installed: a, update: !!c?.update, flags: c?.flags || [...(a.main ? ['code'] : []), ...(a.config.secrets.length || a.config.settings.length ? ['settings'] : [])] }
  })
  // A repo the human scanned offers its apps too, ahead of the catalog's of the same name: they asked for it.
  const scan = (S.store.scan?.apps || []).map(c => ({ ...c, source: S.store.scan.source }))
  const offered = [...scan, ...cat.filter(c => !scan.some(x => x.name === c.name))]
  return [...mine, ...offered.filter(c => !S.apps.some(a => a.name === c.name)).map(c => ({ ...c, installed: null }))]
    .sort((x, y) => x.label.localeCompare(y.label))
}
async function storeAsk (body, btn) {
  if (btn) btn.disabled = true
  storeError = ''
  try { await api('/api/apps', { method: 'POST', body }); S = await api('/api/state') } catch (e) { storeError = e.message }
  render()
}
function storeAct (a, verb, btn) {
  const code = a.flags.includes('code')
  if (verb === 'install' && a.source) {
    if (!window.confirm(`${a.label} is from ${a.source}, not this brain's apps repo. Its commands run on your machine${code ? ' and its code in your Studio' : ''}, with everything you may do there. Install and trust it?`)) return
    return storeAsk({ verb, name: a.name, trust: true, from: a.source }, btn)
  }
  if (verb === 'install') {
    if (code && !window.confirm(`${a.label} runs its own code in your Studio, with everything the Studio may do. Install and trust it?`)) return
    return storeAsk({ verb, name: a.name, trust: code }, btn)
  }
  if (verb === 'update') {
    if (code && !window.confirm(`${a.label} runs its own code in your Studio, and an update may change it. Update and trust the new code?`)) return
    return storeAsk({ verb, name: a.name, trust: code }, btn)
  }
  if (verb === 'revert') {
    if (!window.confirm(`Drop the ${a.installed.changes} change(s) this brain made to ${a.label} and go back to the version as installed?`)) return
    return storeAsk({ verb, name: a.name }, btn)
  }
  if (verb === 'remove') {
    const ch = a.installed.changes
    if (!window.confirm(`Uninstall ${a.label}? Its playbooks, roles and skills go; what its projects taught the brain stays in memory/. Reinstalling brings it back.`)) return
    if (ch && !window.confirm(`This brain changed ${ch} file(s) in ${a.label}. Uninstalling loses those changes. Uninstall anyway?`)) return
    return storeAsk({ verb, name: a.name, confirm: a.name, force: !!ch }, btn)
  }
}
function storeStatus () {
  const st = S.store, box = $('div')
  if (storeError) box.append($('div', 'note err', storeError))
  if (st.running || st.pending) {
    const n = $('div', 'note'); n.append(icon('spinner-gap', 'spin'), ` ${st.running ? 'Working on' : 'Waiting to'}: ${st.running || st.pending}`)
    box.append(n)
    if (!st.running && !S.watching) box.append(watchNote('the change waits in a request file until it starts'))
  } else if (st.status && !(st.status.ok && st.status.verb === 'catalog')) {
    const s = st.status, n = $('div', s.ok ? 'note' : 'note err')
    n.append($('span', '', `${{ install: 'Installed', update: 'Updated', remove: 'Uninstalled', revert: 'Reverted', scan: 'Scanned', catalog: 'Checked for updates' }[s.verb] || s.verb} ${s.name}${s.ok ? '' : ' — failed'} · ${s.at}`))
    if (!s.ok && s.log) { const pre = $('pre', '', s.log); pre.style.whiteSpace = 'pre-wrap'; pre.style.margin = '6px 0 0'; n.append(pre) }
    box.append(n)
  }
  return box
}
const busyStore = () => !!(S.store.running || S.store.pending)
const FLAG = { code: 'Studio pages', commands: 'Commands', settings: 'Settings' }
const flagText = f => FLAG[f] || f.replace(/^requires:/, 'Needs ').replace(/\+/g, ', ')

function appsView (name) {
  if (name) return appPage(name)
  const box = $('div'), head = $('div', 'head store-head')
  const titles = $('div'); titles.append($('h1', '', 'Apps'), $('p', 'sub', 'Add a domain to the brain — its playbooks, roles and skills, sometimes pages and commands of its own. Uninstalling keeps what its projects taught the brain.'))
  const refresh = $('button', '', ''); refresh.append(icon('arrows-clockwise'), ' Check for updates'); refresh.disabled = busyStore()
  refresh.title = S.store.catalog ? `${S.store.catalog.source} @ ${S.store.catalog.commit.slice(0, 12)}, checked ${S.store.catalog.at}` : 'Not checked yet'
  refresh.onclick = () => storeAsk({ verb: 'catalog' }, refresh)
  head.append(titles, refresh); box.append(head, baseUpdateNote(S, () => refreshState(scrollY)) || '', storeStatus())

  const all = storeApps(), count = { all: all.length, installed: all.filter(a => a.installed).length, available: all.filter(a => !a.installed).length }
  const bar = $('div', 'store-bar'), search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Search apps', value: storeQuery })
  search.setAttribute('aria-label', 'Search apps')
  const tabs = $('div', 'seg'); tabs.setAttribute('role', 'tablist')
  const grid = $('div', 'store-grid')
  const draw = () => {
    grid.textContent = ''
    const q = storeQuery.trim().toLowerCase()
    const shown = all.filter(a => (storeTab === 'all' || (storeTab === 'installed') === !!a.installed) && (!q || `${a.label} ${a.name} ${a.desc}`.toLowerCase().includes(q)))
    for (const a of shown) grid.append(appCard(a))
    if (!shown.length) grid.append($('div', 'store-empty', q ? `No app matches “${storeQuery.trim()}”.` : storeTab === 'available' ? (S.store.catalog ? 'Every app in the repo is installed.' : 'Not checked yet — brain watch lists them when it starts, or press Check for updates.') : 'No apps installed yet.'))
  }
  for (const [k, label] of [['all', 'All'], ['installed', 'Installed'], ['available', 'Available']]) {
    const t = $('button', '', ''); t.append(label, $('span', 'n', String(count[k])))
    t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(storeTab === k))
    t.onclick = () => { storeTab = k; for (const x of tabs.children) x.setAttribute('aria-selected', String(x === t)); draw() }
    tabs.append(t)
  }
  search.oninput = () => { storeQuery = search.value; draw() }
  bar.append(search, tabs); box.append(bar, grid); draw()
  box.append($('h2', 'store-section', 'Install from a repo'), repoScanner())
  return box
}

/* An app someone wrote themselves: brain watch clones the repo (private ones too, with your
   git access) and lists the apps in it, at its root or one folder down. They then show in
   the grid above, marked with where they come from. */
function repoScanner () {
  const box = $('div'), sc = S.store.scan
  box.append($('p', 'sub', 'Any git repo with an app.conf at its root or in a folder of its own. Its apps join the list above; installing one asks for your trust, since its commands run on this machine.'))
  const bar = $('div', 'bar'), input = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'owner/repo or a git URL', value: sc?.source || '' })
  input.setAttribute('aria-label', 'app repository')
  const go = $('button', '', ''); go.append(icon('magnifying-glass'), ' Scan'); go.disabled = busyStore()
  const scan = () => input.value.trim() && storeAsk({ verb: 'scan', name: input.value.trim() }, go)
  go.onclick = scan; input.onkeydown = e => { if (e.key === 'Enter') scan() }
  bar.append(input, go); box.append(bar)
  if (sc) box.append($('p', 'sub', `${sc.source} @ ${sc.commit.slice(0, 12)}, scanned ${sc.at}: ${sc.apps.length ? sc.apps.map(a => a.label).join(', ') : 'no app in it'}.`))
  return box
}

function appCard (a) {
  const c = $('a', 'store-card'); c.href = `#/apps/${a.name}`
  const top = $('div', 'store-card-top'), t = $('div')
  t.append($('div', 'store-name', a.label), $('div', 'store-ver', [`v${a.version}`, a.installed?.lock?.commit.slice(0, 7), a.installed && 'installed', !a.installed && a.source].filter(Boolean).join(' · ')))
  top.append(appTile(a.name, a.icon), t)
  c.append(top, $('p', 'store-desc', a.desc || 'No description.'))
  const foot = $('div', 'store-card-foot'), tags = $('div', 'store-tags')
  if (a.update) tags.append($('span', 'tag warn', 'Update'))
  for (const f of a.flags) tags.append($('span', 'tag', flagText(f)))
  foot.append(tags)
  const verb = !a.installed ? 'install' : a.update ? 'update' : null
  if (verb) {
    const btn = $('button', verb === 'install' ? 'primary' : '', verb === 'install' ? 'Install' : 'Update')
    btn.disabled = busyStore()
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); storeAct(a, verb, btn) }
    foot.append(btn)
  } else foot.append($('span', 'store-open', 'Open'), icon('caret-right'))
  c.append(foot)
  return c
}

function appPage (name) {
  const a = storeApps().find(x => x.name === name)
  if (!a) return $('div', 'note err', `No app '${name}' installed or in the catalog.`)
  const box = $('div'), back = $('a', 'store-back'); back.href = '#/apps'; back.append(icon('arrow-left'), ' All apps')
  const head = $('div', 'store-page-head'), t = $('div')
  t.append($('h1', '', a.label), $('p', 'sub', [`v${a.version}`, a.installed ? `installed in ${a.installed.dir}` : a.source ? `not installed · from ${a.source}` : 'not installed',
    a.installed?.lock ? `from ${a.installed.lock.source} @ ${a.installed.lock.commit.slice(0, 12)}` : ''].filter(Boolean).join(' · ')))
  const tags = $('div', 'store-tags')
  if (a.update) tags.append($('span', 'tag warn', 'Update available'))
  if (a.installed?.changes) tags.append($('span', 'tag', `${a.installed.changes} file${a.installed.changes > 1 ? 's' : ''} changed by this brain`))
  for (const f of a.flags) tags.append($('span', 'tag', flagText(f)))
  t.append(tags)
  head.append(appTile(a.name, a.icon, 72), t)
  const act = $('div', 'bar'), busy = busyStore()
  const btn = (label, cls, verb) => { const b = $('button', cls, label); b.disabled = busy; b.onclick = () => storeAct(a, verb, b); act.append(b) }
  if (!a.installed) btn('Install', 'primary', 'install')
  else {
    if (a.update) btn('Update', 'primary', 'update')
    if (!a.update) btn('Reinstall latest', '', 'update')
    if (a.installed.changes) btn('Revert changes', '', 'revert')
    btn('Uninstall', 'danger', 'remove')
  }
  box.append(back, head, act, storeStatus())
  if (a.desc) box.append($('p', 'store-lead', a.desc))
  const readme = $('div', 'prose store-readme'); readme.append($('div', 'skel'))
  api(`/api/app-readme?name=${encodeURIComponent(a.name)}`)
    .then(r => { readme.textContent = ''; readme.append(md(r.text.replace(/^# .*\n/, ''))) })
    .catch(() => { readme.textContent = '' })
  if (a.installed && (a.installed.config.secrets.length || a.installed.config.settings.length)) {
    box.append($('h2', 'store-section', 'Settings'), appSettingsView(a.name))
  }
  box.append($('h2', 'store-section', 'About'), readme)
  return box
}

/* An app's settings, generated from its app.conf. A secret is checked by the cockpit where
   the app says, then stored in sbx by the host — which is why the form says when nobody is
   listening. The key field never shows a saved key: there is none to show, sbx holds it. */
function appSettingsView (name) {
  const a = S.apps.find(x => x.name === name)
  const c = a.config, box = $('div')
  box.append($('p', 'sub', `From its app.conf. Keys go into sbx's secret store, never into a file in this folder; settings into system/config/${a.name}.conf, which its agents read.`))

  for (const sec of c.secrets) {
    box.append($('h3', '', sec.label))
    const status = sec.pending ? ['note', 'Key checked and waiting for brain watch to store it.']
      : sec.status.startsWith('error') ? ['note err', `Could not connect: ${sec.status.slice(6).trim()}`]
        : sec.connected ? ['note', `Connected (${sec.status.slice(10)}).`] : ['note warn', 'Not connected.']
    box.append($('div', status[0], status[1]))
    if (sec.pending && !S.watching) box.append(watchNote('the key waits in a request file until it starts'))
    const bar = $('div', 'bar'), note = $('span', 'tag'), fields = []
    const input = (type, ph) => {
      const i = Object.assign(document.createElement('input'), { type, placeholder: ph, autocomplete: type === 'password' ? 'new-password' : 'off' })
      i.setAttribute('aria-label', `${sec.label}: ${ph}`); fields.push(i); bar.append(i); return i
    }
    const login = sec.kind === 'basic' ? input('text', 'login') : null
    const pass = input('password', sec.kind === 'basic' ? 'password' : 'token')
    const save = $('button', 'primary', sec.connected ? 'Replace the key' : 'Connect')
    save.onclick = async () => {
      save.disabled = true; note.className = 'tag'; note.textContent = sec.check ? `checking the key with ${new URL(sec.check).host}` : 'saving'
      try {
        await api('/api/app-secret', { method: 'POST', body: sec.kind === 'basic' ? { app: name, name: sec.name, login: login.value, password: pass.value } : { app: name, name: sec.name, token: pass.value } })
        S = await api('/api/state'); render()
      } catch (e) { note.className = 'tag err'; note.textContent = e.message; save.disabled = false }
    }
    bar.append(save, note)
    box.append(bar, $('p', 'sub', 'Project sandboxes that already exist get the server loaded into them; one that had an older key keeps it until it restarts.'))
  }

  if (c.settings.length) {
    const rows = $('div', 'rows'), get = {}
    for (const st of c.settings) {
      const r = $('div', 'row'), l = document.createElement('label')
      l.style.display = 'flex'; l.style.gap = '7px'; l.style.alignItems = 'baseline'
      let el
      if (st.type === 'toggle') { el = Object.assign(document.createElement('input'), { type: 'checkbox', checked: st.value !== 'off' }); get[st.key] = () => el.checked ? 'on' : 'off'; l.append(el, $('span', '', st.label)) } else {
        if (st.type === 'choice') { el = document.createElement('select'); for (const o of st.options) el.append(Object.assign(document.createElement('option'), { value: o, textContent: o, selected: o === st.value })) } else el = Object.assign(document.createElement('input'), { type: 'text', value: st.value })
        get[st.key] = () => el.value; l.append($('span', '', st.label), el)
      }
      r.append(l); rows.append(r)
    }
    const act = $('div', 'bar'), save = $('button', 'primary', 'Save'), note = $('span', 'tag')
    save.onclick = async () => {
      save.disabled = true
      try {
        await api('/api/app-settings', { method: 'POST', body: { app: name, values: Object.fromEntries(Object.entries(get).map(([k, f]) => [k, f()])) } })
        S = await api('/api/state'); render()
      } catch (e) { note.className = 'tag err'; note.textContent = e.message; save.disabled = false }
    }
    act.append(save, note); box.append(rows, act)
  }
  return box
}

const render2 = () => { view.textContent = ''; view.append(skillsView()); renderNav('skills') }

function skillsView () {
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', 'Skills'), $('p', 'sub', 'Skills installed into the sandbox store, shared by Claude and Codex.'))
  box.append(head)
  const mine = lintBlock(S.lint, f => f.where.includes('skills'))
  if (mine) box.append(mine)

  box.append($('h2', '', 'Add skills from a repo'))
  box.append(skillInstaller())

  box.append($('h2', '', `All declared skills (${S.skills.declared.length})`))
  box.append($('p', 'sub', 'sync-skills installs exactly this set and removes everything else from the sandbox store, so this should match sbx skills ls. The cockpit cannot run sbx to confirm it.'))
  // One list per owner: the brain's own and the ones you added, then each app's, so whose a
  // skill is shows before anything else about it. An app's go with the app.
  const label = app => S.apps.find(x => x.name === app)?.label || app
  const owners = [...new Set(S.skills.declared.map(d => d.app || ''))]
    .sort((x, y) => !x ? -1 : !y ? 1 : label(x).localeCompare(label(y)))
  for (const owner of owners) {
    const mine = S.skills.declared.filter(d => (d.app || '') === owner)
    const h = $('h3', 'tag')
    if (owner) { const l = $('a', '', label(owner)); l.href = `#/apps/${owner}`; h.append('From the app ', l, ` (${mine.length})`) }
    else h.append(`The brain's own and yours (${mine.length})`)
    const rows = $('div', 'rows')
    for (const d of mine) {
      const r = $('div', 'row k3')
      const left = $('div')
      const own = S.skills.own.find(o => (o.name || o.dir) === d.name)
      if (own) { const a = $('a', 'name', d.name); a.href = `#/skill/${own.dir}`; left.append(a) }
      else left.append($('span', 'name', d.name))
      const mid = $('div')
      mid.append($('div', 'tag', d.source === 'own' ? 'own' : d.source === 'host' ? 'host skill' : 'external'))
      const right = $('div', 'bar'); right.style.margin = '0'
      right.append($('span', 'meta trunc', d.description || d.detail))
      if (d.app) {
        right.append($('span', 'tag', 'goes with the app'))
      } else if (own) {
        // Deleting files you wrote gets the same type-the-name confirm as a role or
        // playbook, and that lives on the skill's own page.
        const a = $('a', 'tag', 'remove…'); a.href = `#/skill/${own.dir}`; right.append(a)
      } else {
        const note = $('span', 'tag')
        const rm = $('button', '', 'Remove')
        rm.onclick = async () => {
          rm.disabled = true; note.className = 'tag'; note.textContent = 'removing'
          try {
            await api('/api/skill-source', { method: 'DELETE', body: { name: d.name } })
            unsynced.push(d.name); S = await api('/api/state'); render()
          } catch (e) { note.className = 'tag err'; note.textContent = e.message; rm.disabled = false }
        }
        right.append(rm, note)
      }
      r.append(left, mid, right)
      rows.append(r)
    }
    box.append(h, rows)
  }
  if (unsynced.length) box.append(unsyncedBlock())
  box.append(cmd('sbx skills ls'))

  box.append($('h2', '', 'skills.list'))
  box.append($('p', 'sub', 'One repo per line, followed by the skill names to install. A repo with no names adds nothing to the keep list, so the same sync prunes it straight back out.'))
  box.append(editor('system/skills.list', { rows: 12 }))
  box.append($('p', 'sub', 'Nothing here is applied until you sync from the terminal. Until then this list is intent, not the state of the store.'))
  box.append(cmd('brain sync-skills'))

  box.append($('h2', '', 'MCP servers and network rules'))
  box.append($('p', 'sub', 'The other half of what a sandbox gets. A sandbox takes its MCP set at create time, so a server added here reaches existing ones only via sbx mcp load; network rules apply to all of them at once. Same caveat as the skills above: this is what sandbox.conf declares, and the cockpit cannot run sbx to confirm it.'))
  const sb = S.sandbox
  const decl = [
    ...sb.mcp.map(m => ['mcp', m.name, m.detail]),
    ...sb.deny.map(h => ['deny', h, 'blocked for every sandbox']),
    ...sb.allow.map(h => ['allow', h, 'reachable from every sandbox'])
  ]
  if (!decl.length) box.append($('p', 'sub', 'Nothing declared yet, so every sandbox gets the sbx defaults (no MCP servers, egress allow-all).'))
  else {
    const srows = $('div', 'rows')
    for (const [kind, name, detail] of decl) {
      const r = $('div', 'row k3'), left = $('div'), mid = $('div'), right = $('div', 'bar')
      right.style.margin = '0'
      left.append($('span', 'name', name))
      mid.append($('div', 'tag', kind))
      right.append($('span', 'meta trunc', detail))
      r.append(left, mid, right)
      srows.append(r)
    }
    box.append(srows)
  }
  box.append(cmd('sbx mcp ls\nsbx policy ls --wide'))
  box.append(editor('system/sandbox.conf', { rows: 12 }))
  box.append(cmd('brain sync-sandbox'))
  return box
}

/* The removal is only intent until sbx is told. brain sync-skills prunes everything off
   the keep list in one pass, which is the normal route; the per-skill rm is there for
   when you want just this one gone now. */
function unsyncedBlock () {
  const box = $('div', 'note warn')
  box.append($('p', '', `Removed from what this brain declares, but still installed in the sbx store: ${unsynced.join(', ')}. The cockpit runs on a container and cannot reach sbx, so run one of these:`))
  box.append(cmd('brain sync-skills'))
  box.append(cmd(unsynced.map(n => `sbx skills rm --force ${n}`).join('\n')))
  return box
}

function skillView (dir) {
  const s = S.skills.own.find(x => x.dir === dir)
  if (!s) return $('div', 'note err', `No skill '${dir}'`)
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', s.dir), $('p', 'sub', s.description || ''))
  if (s.app) head.append(appTag(s.app))
  box.append(head)
  box.append($('div', 'note', 'The directory name is what the keep list uses, but pruning compares the frontmatter name. If you change name: here, rename the directory too or the skill removes itself on the next sync.'))
  box.append(editor(s.path, { rows: 20 }))
  box.append($('h2', '', s.app ? 'Removing it' : 'Remove this skill'))
  box.append(deleteSkillPanel(s))
  return box
}

function deleteSkillPanel (s) {
  if (s.app) return appOwnedNote('skill', s.app)
  const box = $('div')
  const name = s.name || s.dir
  const users = S.roles.filter(r => r.names.includes(name)).map(r => r.role)
  if (users.length) {
    box.append($('div', 'note warn',
      `${users.join(', ')} name this skill. Those phases will still run, just without it, and the lint will flag them until you edit the roles.`))
  }
  box.append($('p', 'sub', `Deletes system/skills/${s.dir}/. That drops it from the keep list, which is what makes the next sync remove it from the sbx store.`))
  const bar = $('div', 'bar'), note = $('span', 'tag')
  const confirm = document.createElement('input')
  confirm.type = 'text'; confirm.placeholder = `type ${s.dir} to confirm`; confirm.size = 24
  confirm.setAttribute('aria-label', 'confirm skill directory')
  const del = $('button', 'danger', 'Delete skill')
  del.onclick = async () => {
    del.disabled = true; note.className = 'tag'; note.textContent = 'deleting'
    try {
      await api('/api/skill', { method: 'DELETE', body: { dir: s.dir, confirm: confirm.value.trim() } })
      unsynced.push(name); S = await api('/api/state')
      location.hash = '#/skills'
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; del.disabled = false }
  }
  bar.append(confirm, del, note)
  box.append(bar, cmd(`git -C ${S.hostBrain} checkout system/skills/${s.dir}`))
  return box
}

function memoryView () {
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', 'Brain memory'), $('p', 'sub', 'Every agent reads these at the start of every session, whatever the engine.'))
  box.append(head)
  box.append($('h2', '', 'preferences.md'))
  box.append($('p', 'sub', 'How you work, across every project. Agents follow it in all of them. Not the stack \u2014 that belongs to one project, so it lives in that project\u2019s brief.'))
  box.append(editor('memory/preferences.md', { rows: 16 }))

  box.append($('h2', '', 'index.md'))
  box.append($('p', 'sub', 'The catalog agents read first. They maintain it; a page missing from here is invisible to them, which is what brain lint checks.'))
  box.append(editor('memory/index.md', { rows: 14 }))

  box.append($('h2', '', 'knowledge/'))
  box.append($('p', 'sub', 'The wiki. Compiled by the retro role after each project: one page per topic, rewritten to stay true rather than appended to.'))
  if (!S.knowledge.length) {
    const e = $('div', 'empty')
    e.append($('h3', '', 'No pages yet'),
      $('p', '', 'The retro phase writes the first ones, from what the reviews and QA of a finished project turned up.'))
    e.append(cmd('brain lint'))
    box.append(e)
  } else {
    // The pages and their [[links]], and the projects each was compiled from. A click jumps to the page's editor.
    const g = $('div'); g.append($('div', 'note', 'Drawing the graph…'))
    api('/api/knowledge-graph').then(d => { g.textContent = ''; g.append(graphView(d, { height: 420, open: n => document.getElementById(n.id)?.scrollIntoView({ behavior: 'smooth' }) })) })
      .catch(e => { g.textContent = ''; g.append($('div', 'note err', e.message)) })
    box.append(g)
  }
  for (const k of S.knowledge) {
    const h = $('h3', '', k.name); h.id = `k:${k.name}`
    box.append(h)
    if (k.summary) box.append($('p', 'sub', k.summary))
    box.append(editor(k.path, { rows: 14 }))
  }

  box.append($('h2', '', 'sources/'))
  box.append($('p', 'sub', 'Drop in anything the brain should know: an article, a brand guide, a process doc, a transcript. It is kept as-is and never edited. An agent reads it and compiles what matters into a knowledge page.'))
  box.append(sourcesBlock())

  box.append($('h2', '', 'proposals.md'))
  box.append($('p', 'sub', 'Changes agents want made to the read-only system/ folder. The Overview accepts and declines them with one click; this is the raw file. ## Accepted is the only section `brain evolve` applies, and ## Declined is what agents read before proposing again.'))
  box.append(editor('memory/proposals.md', { rows: 10 }))
  box.append($('h2', '', 'BRAIN.md'))
  box.append($('p', 'sub', 'The operating manual. This one is read-only here on purpose: it defines the file contract this cockpit depends on.'))
  const pre = $('div'); pre.append($('div', 'skel'))
  api('/api/file?path=system/BRAIN.md').then(d => { pre.textContent = ''; pre.append(md(d.content)) })
    .catch(e => { pre.textContent = ''; pre.append($('div', 'note err', e.message)) })
  box.append(pre)
  return box
}

/* Ingest, for the brain's own sources and for one project's — the same upload, aimed at
   a different folder. The upload only files the document; reading it is an agent's job,
   so this hands you the command rather than pretending the browser can run one. */
function sourcesBlock (project = null) {
  const box = $('div')
  const list = project ? project.sources : S.sources
  const rows = $('div', 'rows')
  const pending = []
  for (const s of list) {
    const r = $('div', 'row k2')
    const left = $('div'); left.append($('div', 'name', s.name))
    const right = $('div')
    right.append($('div', 'tag', s.cited ? (project ? 'read by a phase' : 'compiled') : 'not cited yet'))
    if (!s.cited) pending.push(s.name)
    r.append(left, right); rows.append(r)
  }
  if (list.length) box.append(rows)

  const bar = $('div', 'bar'), note = $('span', 'tag')
  const pick = document.createElement('input')
  pick.type = 'file'; pick.multiple = true
  pick.setAttribute('aria-label', 'documents to add to memory')
  pick.onchange = async () => {
    const files = [...pick.files]
    if (!files.length) return
    note.className = 'tag'; note.textContent = `adding ${files.length}`
    try {
      for (const f of files) await upload(f, { project: project?.name || '' })
      S = await api('/api/state'); render()
    } catch (e) { note.className = 'tag err'; note.textContent = e.message }
  }
  bar.append(pick, note)
  box.append(bar)
  // Two different next steps. A brain source is compiled into knowledge/ by an agent you
  // start; a project source is read by whichever phase needs it, which is already in the
  // pipeline — so the only useful thing to say is that nothing has cited it yet.
  if (pending.length && !project) box.append(cmd(`brain open   # then: compile ${pending.slice(0, 3).join(', ')}${pending.length > 3 ? ' …' : ''} into knowledge/`))
  else if (pending.length) box.append($('p', 'sub', `Not cited yet by any phase summary or by decisions.md: ${pending.join(', ')}. The phase that reads a source names the file in its handoff, and that is what turns this line off.`))
  return box
}

function clientsView () {
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', 'Clients'), $('p', 'sub', 'A client profile is shared by every project for that client.'))
  box.append(head)
  if (!S.clients.length) {
    const e = $('div', 'empty')
    e.append($('h3', '', 'No client profiles yet'),
      $('p', '', 'Passing --client to brain new creates the folder and a stub profile, which the client-profiler role then fills in.'))
    e.append(cmd('brain new <playbook> <name> --client <slug>'))
    box.append(e); return box
  }
  for (const c of S.clients) {
    box.append($('h2', '', c.slug))
    box.append(editor(c.path, { rows: 14 }))
  }
  return box
}

/* The project page was one scroll holding everything: a gate, the built pages, run
   analytics, 43 brandkit swatches, a brief editor, 15 phase rows, QA tables, decisions.
   Density is right for a control panel, but density is not the same as dumping — so the
   overview answers one question (what needs me, and where is the run) and everything
   else is a destination you navigate to. Detail lives at its own URL, which also means
   a phase is linkable. */
/* A tab is a place something is, not a place something could be. A playbook with no
   brand phase never produces a brandkit/, and offering the section anyway teaches you
   to click into empty pages. Phases, Brief and Decisions are the three every project
   has by construction; the rest earn their place by existing. */
const projectTabsFor = p => [
  ['', 'Phases', true],
  // What the project's app declares in its ui/app.json, when its file or folder is there.
  ...(p.tabs || []).map(t => [t.id, t.label, true]),
  ['qa', 'QA', p.qa.length > 0],
  ['sources', 'Sources', true],
  ['runs', 'Analytics', p.phases.some(ph => ph.run)],
  ['brief', 'Brief', true],
  ['decisions', 'Decisions', true],
  ['memory', 'Memory', hasMemory(p)]
].filter(t => t[2])

function projectTabs (p, active) {
  const w = $('nav', 'tabs')
  for (const [slug, label] of projectTabsFor(p)) {
    const a = $('a', '', label)
    a.href = `#/project/${encodeURIComponent(p.name)}${slug ? '/' + slug : ''}`
    if (slug === active) a.setAttribute('aria-current', 'page')
    w.append(a)
  }
  return w
}

function projectView (name, sub = '', arg = '') {
  const p = S.projects.find(x => x.name === name)
  if (!p) return $('div', 'note err', `No project '${name}'`)
  const box = $('div'), head = $('div', 'head')
  head.append($('h1', '', p.name), $('p', 'sub', `${p.playbook}${p.client ? ` · client ${p.client}` : ''}${p.created ? ` · created ${p.created}` : ''}`))
  head.append(pipeline(p))
  if (p.hostDir) head.append($('p', 'tag', p.hostDir))
  box.append(head)

  if (sub === 'phase') { box.append(phaseView(p, decodeURIComponent(arg))); return box }
  box.append(projectTabs(p, sub))

  // The gate rides above every tab: it is the one thing that is waiting on a human, and
  // burying it behind navigation would be the same mistake in a new shape.
  if (p.blocked && humanTurn(p.blocked)) box.append(gatePanel(p, p.blocked))

  const view = (p.tabs || []).find(t => t.id === sub)?.view
  if (view === 'article') box.append(articleBlock(p))
  else if (view === 'design') box.append(designBlock(p))
  else if (view === 'brandkit') box.append(brandkitBlock(p))
  else if (sub === 'qa') box.append(qaBlock(p))
  else if (sub === 'runs') box.append(runsBlock(p))
  else if (sub === 'memory') box.append(projectMemoryBlock(p))
  else if (sub === 'sources') {
    box.append($('h2', '', 'sources/'))
    box.append($('p', 'sub', "This project's own material: the client's brand book, their logo files, a contract, a transcript, anything a phase needs and the brief only points at. Kept as-is and never edited. It stays with the project. The brain-wide sources/ under Memory is for material every project may need."))
    box.append(sourcesBlock(p))
  }
  else if (sub === 'brief') {
    box.append($('p', 'sub', 'The task, written by you. BRAIN.md calls this the source of truth.'))
    box.append(editor(`${p.mem}/brief.md`, { rows: 20 }))
  } else if (sub === 'decisions') {
    box.append($('p', 'sub', 'Append only. BRAIN.md says never rewrite history here.'))
    box.append(decisionAppender(p))
  } else if (sub) {
    box.append($('div', 'note', `This project has no '${sub}' yet. It appears as a section once the phase that makes it has run.`))
  } else box.append(phaseList(p))
  return box
}

/* One row per phase, and the row is the link. What it carries is what you scan for:
   state, who runs it, and what the last run cost. Everything else is one click in. */
function phaseList (p) {
  const wrap = $('div')
  if (p.next && p.visible && p.next.state !== 'running') wrap.append(cmd(`cd ${p.hostDir} && brain run`))
  if (!p.next && p.playbook) {
    const n = $('div', 'note')
    const to = $('a', '', `${p.playbook}'s page`); to.href = `#/playbook/${encodeURIComponent(p.playbook)}`
    const next = $('p', 'sub'); next.append('Then choose which of its proposals to use, and evolve, on ', to, '.')
    n.append($('p', '', `Playbook complete. Analyse this run, so the next project on ${p.playbook} goes better:`), playbookAnalyseBar(p.playbook), next)
    wrap.append(n)
  }
  const rows = $('div', 'rows')
  for (const ph of p.phases) {
    const r = $('a', 'row phaserow')
    r.href = `#/project/${encodeURIComponent(p.name)}/phase/${encodeURIComponent(ph.phase)}`
    const isNext = p.next && p.next.phase === ph.phase
    if (isNext) r.classList.add('is-next')
    r.append(
      $('span', 'name', ph.phase),
      $('span', `chip ${stateLabel(ph)}${isNext ? ' next' : ''}`, stateLabel(ph)),
      $('span', 'tag', `${ph.role}${ph.fix ? ` · fix ${ph.fix}` : ''}`),
      $('span', 'tag' + (ph.state === 'stuck' || rejected(ph) ? ' err' : ''),
        ph.state === 'running' ? `${ago(ph.since)} in the sandbox` : rejected(ph) || (ph.fails ? `${ph.fails}/${ph.maxFails} fails` : runLine(ph.run))),
      // Waived and deferred findings are what the project ships with, so they stay on the row.
      $('span', 'tag' + (ph.open ? ' err' : ph.waived || ph.deferred ? ' warn' : ''), defectLine(ph))
    )
    rows.append(r)
  }
  wrap.append(rows)
  return wrap
}

/* A phase at its own URL: the summary the next role reads, what the run cost and
   reached for, its verdict history, and the verdict controls when it is yours to give. */
function phaseView (p, name) {
  const ph = p.phases.find(x => x.phase === name)
  if (!ph) return $('div', 'note err', `No phase '${name}' in ${p.playbook}`)
  const box = $('div')
  const back = $('a', 'tag', '← all phases'); back.href = `#/project/${encodeURIComponent(p.name)}`
  box.append(back)
  const bar = $('div', 'bar')
  bar.append($('h2', '', ph.phase), $('span', `chip ${stateLabel(ph)}`, stateLabel(ph)),
    $('span', 'tag', `${ph.role}${ph.fix ? ` · fix ${ph.fix}` : ''}`))
  box.append(bar)
  if (ph.state === 'stuck') box.append($('div', 'note err', `This phase has failed ${ph.fails} times. brain run will stop and ask you to decide instead of starting another fix round.`))
  box.append(attemptPanel(ph))
  box.append(runsPanel(ph))
  const body = $('div')
  box.append(body)
  fillPhase(body, p, ph)
  return box
}

/* What the host decided about the newest attempt, which is not what the agent claimed.
   `brain auto` stops with exit 2 when a contract check fails, and until this panel the
   only account of which check and what it printed was a directory you had to cd to.
   Silent when the host accepted the attempt: a verdict is only news when it is bad. */
const defectLine = ph => [[ph.open, 'open'], [ph.waived, 'waived'], [ph.deferred, 'deferred']]
  .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(' · ')
const REJECTED = {
  crashed: 'The launcher running this attempt died before it checked the handoff. Any marker it left was withheld; the phase runs again.',
  unfinished: 'This attempt never finished and nothing is running it. The next brain run, brain status or brain watch closes it as crashed.',
  defects_invalid: 'The ## Defects block broke the rules (see the log below). The summary and log were put back as they were before this attempt.',
  verification_failed: 'Verification failed. The completion marker was withheld, so this phase did not advance.',
  blocked: 'Blocked before launch: a contract input was missing or empty, so the agent never started.',
  incomplete: 'The agent exited without a valid handoff.',
  timed_out: 'The agent hit BRAIN_PHASE_TIMEOUT and was stopped.',
  engine_error: 'The engine exited non-zero. This is a sandbox or model failure, not a verdict on the work.'
}
/* The list row otherwise shows a rejected attempt as a phase that simply never ran,
   which is the confusion this whole panel exists to end. Guarded on state: a rerun that
   passed leaves a `verified` newest attempt and says nothing here. */
const rejected = ph => ph.state !== 'done' && REJECTED[ph.attempt?.outcome] ? ph.attempt.outcome.replace(/_/g, ' ') : null

function attemptPanel (ph) {
  const a = ph.attempt
  const box = $('div')
  if (!a || !REJECTED[a.outcome]) return box
  box.append($('div', 'note err', REJECTED[a.outcome]))
  const ul = $('ul', 'flat')
  ul.append(Object.assign($('li', 'tag'), { textContent: `host record   ${a.dir}` }))
  box.append(ul)
  for (const n of a.notes) box.append(fileDetails(n.path, n.label))
  /* Every check, not just the failing one: verification stops at the first failure, so
     which ones ran before it is how far the attempt actually got. */
  for (const [i, c] of a.checks.entries()) {
    box.append(fileDetails(c.log,
      `check ${i + 1}: ${c.command}   ${c.exit === 0 ? 'passed' : c.exit == null ? 'no exit recorded, killed mid-check' : `exit ${c.exit}`}`))
  }
  return box
}

/* Every run of this phase, newest first and the newest open. It sits above the summary
   because a phase that failed twice has three receipts, and what changed between them is
   the question you came with — the summary is only ever the last one's. Each run carries
   the role file it ran against, snapshotted at the time: roles get edited between rounds,
   and instructions you cannot read against the result they produced are not evidence. */
function runsPanel (ph) {
  const box = $('div')
  const runs = ph.runs || []
  if (!runs.length) return box
  box.append($('h3', 'tag', runs.length > 1 ? `${runs.length} runs, newest first` : 'this run'))
  runs.forEach((r, i) => {
    const d = $('details'); if (i === 0) d.open = true
    d.append(Object.assign(document.createElement('summary'),
      { textContent: `${runWhen(r)} · ${r.role || ph.role} · ${runLine(r) || 'no detail recorded'}` }))
    const ul = $('ul', 'flat')
    const row = (k, v, cls) => ul.append(Object.assign($('li', 'tag' + (cls ? ' ' + cls : '')), { textContent: `${k}   ${v}` }))
    row('model', `${r.model || '?'}${r.session ? `   session ${r.session.slice(0, 8)}` : ''}`)
    if (r.seconds != null) row('ran for', `${Math.round(r.seconds / 60)} min   (${r.turns || 0} turns)`)
    if (r.tokens) row('tokens', `${kb(r.tokens.output || 0)} out · ${kb(r.tokens.input || 0)} in · ${kb(r.tokens.cache_read || 0)} cache read · ${kb(r.tokens.cache_write || 0)} cache write`)
    const gap = skillGap(ph, S.roles, r)
    row('skills invoked', gap.used.length ? gap.used.join(', ') : 'none')
    if (gap.unused.length) row('declared, never invoked', gap.unused.join(', '), 'err')
    if (r.tools) row('tools', Object.entries(r.tools).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none')
    d.append(ul)
    d.append(r.rolePath
      ? roleSnapshot(r)
      : $('p', 'sub', 'No role file was kept for this run. Runs from here on snapshot the instructions they ran against.'))
    box.append(d)
  })
  return box
}

/* A repo file behind a disclosure, fetched when it is opened rather than with the page:
   these are whole documents, one or two per run, and /api/state is polled. */
function fileDetails (path, label) {
  const d = $('details')
  d.append(Object.assign(document.createElement('summary'), { textContent: label }))
  const b = $('div'); d.append(b)
  d.ontoggle = () => {
    if (!d.open || d.dataset.l) return
    d.dataset.l = '1'; b.append($('div', 'skel'))
    api(`/api/file?path=${encodeURIComponent(path)}`)
      // Same rule as the memory browser: a check log is not markdown, and rendering it
      // as one joins its wrapped lines and eats the indentation you opened it to read.
      .then(x => { b.textContent = ''; b.append(/\.md$/i.test(path) ? md(x.content) : $('pre', 'plain', x.content)) })
      .catch(e => { b.textContent = ''; b.append($('div', 'note err', e.message)) })
  }
  return d
}

/* The instructions this run was given, exactly as they read then. */
const roleSnapshot = r => fileDetails(r.rolePath, `roles/${r.role}.md as it ran`)

function qaBlock (p) {
  const box = $('div')
  if (!p.qa.length) {
    const e = $('div', 'empty')
    e.append($('h3', '', 'No QA runs yet'),
      $('p', '', 'brain-shoot writes one folder per run: screenshots at three widths, plus the checks a screenshot cannot show: contrast as painted, broken or unlabelled images, page structure. A review phase is what puts them here.'))
    box.append(e); return box
  }
  for (const run of p.qa) {
      const found = []
      for (const sh of run.shots) {
        const page = sh.url.replace(/^https?:\/\/[^/]+/, '') || '/'
        const add = (check, detail) => found.push({ page, width: sh.width, check, detail })
        if (sh.status >= 400) add('status', String(sh.status))
        for (const c of sh.contrast) add('contrast', `${c.ratio} (needs ${c.need}) · ${c.px}px · ${c.sel} · "${c.text}"`)
        for (const i of sh.structure) add('structure', i)
        for (const b of (sh.images?.broken || [])) add('image', `broken: ${b}`)
        for (const a of (sh.images?.noalt || [])) add('image', `no alt: ${a}`)
        for (const e of sh.errors) add('console', e)
      }
      const d = $('details', 'phase')
      const sum = document.createElement('summary')
      sum.append(
        $('span', 'name', run.run),
        $('span', 'tag', `${run.shots.length} checks`),
        $('span', 'tag' + (found.length ? ' err' : ''), found.length ? `${found.length} findings` : 'all clean')
      )
      d.append(sum)
      const wrap = $('div'); wrap.style.cssText = 'padding:10px 0 16px;overflow-x:auto'
      if (!found.length) wrap.append($('p', 'sub', 'Nothing failed. Screenshots are on disk; the pages themselves are linked under Design.'))
      else {
        const t = document.createElement('table'); t.className = 'runs'
        const head = document.createElement('tr')
        for (const h of ['page', 'width', 'check', 'what']) head.append(Object.assign(document.createElement('th'), { textContent: h }))
        t.append(head)
        for (const f of found.slice(0, 200)) {
          const r = document.createElement('tr')
          const cell = (text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; r.append(td) }
          cell(f.page); cell(`${f.width}px`); cell(f.check, 'tag err')
          const td = document.createElement('td')
          td.textContent = f.detail.length > 160 ? f.detail.slice(0, 160) + '…' : f.detail
          td.title = f.detail
          r.append(td)
          t.append(r)
        }
        wrap.append(t)
        if (found.length > 200) wrap.append($('p', 'sub', `${found.length - 200} more not listed.`))
      }
      d.append(wrap); box.append(d)
  }
  return box
}


function fillPhase (body, p, ph) {
  body.append($('div', 'skel'))
  api(`/api/file?path=${encodeURIComponent(`${p.mem}/phases/${ph.phase}.md`)}`)
    .then(d => { body.textContent = ''; body.append(md(d.content)); after() })
    .catch(() => { body.textContent = ''; body.append($('div', 'note', 'No summary written yet.')); after() })

  function after () {
    if (ph.log.length) {
      const ul = $('ul', 'flat')
      for (const l of ph.log) ul.append($('li', 'mono tag', l))
      body.append($('h3', 'tag', 'log'), ul)
    }
    const pv = $('details'); pv.append(Object.assign(document.createElement('summary'), { textContent: 'What brain run will send' }))
    const pvb = $('div'); pv.append(pvb)
    pv.ontoggle = () => {
      if (!pv.open || pv.dataset.l) return
      pv.dataset.l = '1'; pvb.append($('div', 'skel'))
      api(`/api/prompt?project=${encodeURIComponent(p.name)}&phase=${encodeURIComponent(ph.phase)}`)
        .then(d => { pvb.textContent = ''; if (d.human) pvb.append($('div', 'note', 'This is a human gate. brain prints the section below and waits for you, it never starts an agent.')); pvb.append($('pre', 'plain', d.prompt)) })
        .catch(e => { pvb.textContent = ''; pvb.append($('div', 'note err', e.message)) })
    }
    body.append(pv)
    // A verdict on a phase an agent is still inside would write .done under it and race
    // its own summary, so running gets the reason instead of the buttons.
    if (ph.state === 'running') body.append($('div', 'note', `An agent has been in the sandbox on this phase for ${ago(ph.since)}. Your verdict appears when it stops.`))
    else if (ph.state !== 'done') body.append(gateControls(p, ph))
  }
}

/* `brain run` on a human phase prints the playbook's gate section and stops. The UI only
   tagged it 'waiting for your approval' and kept the verdict two <details> deep, so the
   same stop point is now the first thing on the project page, text and buttons together. */
function gatePanel (p, ph) {
  const box = $('div', 'gate')
  box.append($('h2', '', `Your turn: ${ph.phase}`))
  const body = S.playbooks.find(x => x.name === p.playbook)?.md.sections.find(s => s.name === ph.phase)?.body
  box.append(body
    ? md(body)
    : $('div', 'note warn', `The playbook has no '## ${ph.phase}' section, so nothing here says what this gate confirms.`))
  box.append(gateControls(p, ph))
  return box
}

/* The brandkit is what brand-gate actually asks you to approve, and it is the one phase
   output that lives in the project repo rather than in brain memory — so before this it
   was the only thing you had to leave the cockpit to look at. Swatches first: a palette
   is judged as colour, not as 43 hex strings. The documents stay folded because brand.md
   runs to 37KB and the page is for deciding, not for reading end to end. */
/* The built pages themselves. A screenshot tells you a page existed at some width on
   some day; the page tells you whether the design is any good, at the size of your own
   window, with the type rendering and the interactions working. Styleguide first: it is
   the specimen catalogue every block is ported from. */
function designBlock (p) {
  const box = $('div')
  const body = $('div')
  api(`/api/design?project=${encodeURIComponent(p.name)}`).then(d => {
    if (!d.present) return
    box.append($('h2', '', 'Design'))
    box.append($('p', 'sub', d.hostDir))
    const bar = $('div', 'bar')
    for (const pg of d.pages) {
      const a = $('a', 'pagelink', pg.path)
      a.href = pg.url; a.target = '_blank'; a.rel = 'noopener'
      if (/^styleguide\./i.test(pg.path)) a.classList.add('primary')
      bar.append(a)
    }
    body.append(bar)
    box.append(body)
  }).catch(e => { box.append($('div', 'note err', e.message)) })
  return box
}

/* Run analytics: one row per RUN, newest first, across every phase. Per phase was the
   wrong unit — a review that failed twice ran three times under two different roles, and
   showing only the last one hid exactly the rounds you are trying to compare. Click the
   phase to read each run against the role file it was given. */
/* ---------- analytics ----------
   Where a project's time, tokens and re-runs went. Everything here is derived from the
   receipts brain-runlog leaves per run — the cockpit measures nothing itself, and a
   codex run keeps no transcript to read one from, so a project can honestly show fewer
   runs than it had. The empty state says that rather than a table lying by omission. */
const hm = mins => mins >= 60 ? `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m` : `${Math.round(mins)}m`
const sumOf = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0)

/* [value, count] pairs, commonest first. f may return one value or a list, so it counts
   models (one per run) and skills (many per run) with the same call. */
const tallyBy = (xs, f) => {
  const m = new Map()
  for (const x of xs) for (const v of [].concat(f(x) ?? [])) if (v) m.set(v, (m.get(v) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const countList = pairs => pairs.map(([v, n]) => `${v} ×${n}`).join(' · ')

/* A cell is a string, a Node, or [text, className]. Three tables here want the same
   thing and the difference between them is only the headers. */
function table (headers, rows) {
  const t = document.createElement('table'); t.className = 'runs'
  const h = document.createElement('tr')
  for (const x of headers) h.append(Object.assign(document.createElement('th'), { textContent: x }))
  t.append(h)
  for (const cells of rows) {
    const tr = document.createElement('tr')
    for (const c of cells) {
      const td = document.createElement('td')
      if (c instanceof Node) td.append(c)
      else if (Array.isArray(c)) { td.textContent = c[0] == null ? '-' : String(c[0]); if (c[1]) td.className = c[1] }
      else td.textContent = c == null ? '-' : String(c)
      tr.append(td)
    }
    t.append(tr)
  }
  const wrap = $('div'); wrap.style.overflowX = 'auto'; wrap.append(t)
  return wrap
}

/* Share of total time, as something you can scan down a column. The number alone makes
   you compare 14 values by reading; the bar makes the answer the shape of the column. */
const shareCell = pct => {
  const w = $('div'); w.style.cssText = 'display:flex;align-items:center;gap:7px'
  const track = $('div'); track.style.cssText = 'width:64px;height:5px;background:var(--sunk);border-radius:3px;overflow:hidden'
  const fill = $('div'); fill.style.cssText = `width:${Math.max(2, Math.round(pct))}%;height:100%;background:var(--focus)`
  track.append(fill)
  w.append(track, $('span', 'tag', `${Math.round(pct)}%`))
  return w
}

function runsBlock (p) {
  const box = $('div')
  box.append($('h2', '', 'Analytics'))
  const runs = p.phases.flatMap(ph => (ph.runs || []).map(r => ({ ph, r })))
  if (!runs.length) {
    const e = $('div', 'empty')
    e.append($('h3', '', 'No run receipts yet'),
      $('p', '', 'brain-runlog writes one per run: how long it took, which model ran it, what it cost in tokens and turns, and which of the skills its role declared it actually invoked. A phase has to run first, and a codex run keeps no transcript, so it leaves none.'))
    box.append(e); return box
  }
  runs.sort((a, b) => String(b.r.ended || b.r.at || '').localeCompare(String(a.r.ended || a.r.at || '')))

  const ran = p.phases.filter(ph => (ph.runs || []).length)
  const extra = sumOf(ran, ph => ph.runs.length - 1)
  const minutes = sumOf(runs, x => x.r.seconds) / 60
  const stamps = runs.flatMap(x => [x.r.started, x.r.ended]).map(s => Date.parse(s || '')).filter(n => !isNaN(n))
  const elapsed = stamps.length > 1 ? (Math.max(...stamps) - Math.min(...stamps)) / 60000 : 0
  const tok = k => sumOf(runs, x => x.r.tokens?.[k])
  const gaps = runs.map(x => skillGap(x.ph, S.roles, x.r))

  const rows = $('div', 'rows')
  const line = (k, v, cls) => {
    if (!v) return
    const r = $('div', 'row k2'); r.append($('div', 'name', k), $('div', 'meta' + (cls ? ' ' + cls : ''), v)); rows.append(r)
  }
  line('runs', `${runs.length} across ${ran.length} of ${p.phases.length} phases` + (extra ? ` · ${extra} of them re-runs` : ''))
  line('agent time', hm(minutes) + (runs.length > 1 ? ` · ${hm(minutes / runs.length)} per run` : ''))
  // Wall-clock from the first run's start to the last one's end: what "how long did this
  // project take" actually means to the human waiting, and always longer than agent time,
  // because gates, fix rounds and nights are in it.
  line('elapsed', elapsed ? `${hm(elapsed)} from first run to last` : null)
  line('turns', `${sumOf(runs, x => x.r.turns)} agent turns`)
  line('tokens', `${kb(tok('output'))} written · ${kb(tok('input'))} in · ${kb(tok('cache_read'))} cache read · ${kb(tok('cache_write'))} cache write`)
  line('models', countList(tallyBy(runs, x => x.r.model)))
  line('skills invoked', countList(tallyBy(gaps, g => g.used)) || 'none')
  line('declared, never invoked', countList(tallyBy(gaps, g => g.unused)), 'err')
  box.append(rows)

  /* Per phase, because "the project took 14 hours" is not a finding and "port took 6 of
     them over 3 runs" is. Sorted by time rather than by playbook order: the question is
     which phase cost the day, not what ran when — that is the table below. */
  box.append($('h3', '', 'Where the time went'))
  const byPhase = ran.map(ph => {
    const rs = ph.runs
    return {
      ph,
      mins: sumOf(rs, r => r.seconds) / 60,
      turns: sumOf(rs, r => r.turns),
      out: sumOf(rs, r => r.tokens?.output),
      models: tallyBy(rs, r => r.model).map(([m]) => m).join(', '),
      skills: tallyBy(rs, r => r.skills || []).map(([s]) => s).join(', ')
    }
  }).sort((a, b) => b.mins - a.mins)
  box.append(table(['phase', 'runs', 'time', 'share', 'turns', 'output', 'models', 'skills invoked'],
    byPhase.map(x => {
      const link = $('a', '', x.ph.phase)
      link.href = `#/project/${encodeURIComponent(p.name)}/phase/${encodeURIComponent(x.ph.phase)}`
      return [link,
        [x.ph.runs.length + (x.ph.fails ? ` · ${x.ph.fails} FAIL` : ''), x.ph.fails ? 'tag err' : ''],
        hm(x.mins), shareCell(minutes ? (x.mins / minutes) * 100 : 0),
        x.turns || '-', kb(x.out), x.models || '-', x.skills || 'none']
    })))

  /* The fix rounds, which are the whole answer to "why did this take so long". Each
     round's verdict is snapshotted beside its receipt, because the live <phase>.md is
     the last round's only — a phase that failed twice would otherwise show one reason
     three times. */
  /* A run's snapshot is the summary as it stood when that run ended — so the reviewer's
     FAIL is still sitting there when the fix-role runs next, and both receipts carry it.
     Keeping the earliest run per distinct verdict credits it to whoever produced it: the
     reviewer on a review phase, and on a human gate the fix round, which is the only run
     the rejection ever gets attached to. */
  const seen = new Set()
  const failed = runs.filter(x => x.r.result === 'FAIL').slice().reverse()
    .filter(x => { const k = `${x.ph.phase}|${x.r.fixItems.join('|')}`; return !seen.has(k) && seen.add(k) })
    .reverse()
  const unrecorded = p.phases.filter(ph => ph.fails && !(ph.runs || []).some(r => r.result))
  if (failed.length || unrecorded.length) {
    box.append($('h3', '', 'Fix rounds'))
    box.append($('p', 'sub', 'Every review that came back FAIL, with what it sent back. Each round is one re-run of the fix-role plus one re-run of the reviewer.'))
    for (const { ph, r } of failed) {
      const d = $('details')
      d.append(Object.assign(document.createElement('summary'),
        { textContent: `${ph.phase} · ${runWhen(r)} · ${r.role || ph.role} · ${r.fixItems.length || 'no'} fix items` }))
      const ul = $('ul', 'flat')
      for (const it of r.fixItems) ul.append($('li', 'tag', it.length > 240 ? it.slice(0, 240) + '…' : it))
      d.append(r.fixItems.length ? ul : $('p', 'sub', 'The summary recorded a FAIL with no numbered fix list.'))
      if (r.summaryPath) d.append(fileDetails(r.summaryPath, 'the full verdict as it was written'))
      box.append(d)
    }
    for (const ph of unrecorded) {
      box.append($('div', 'note warn',
        `${ph.phase} failed ${ph.fails}× before verdicts were snapshotted per run. Only the last one survives, on the phase page. ${ph.log.filter(l => l.includes('FAIL')).join(' · ')}`))
    }
  }

  box.append($('h3', '', 'Every run'))
  box.append(table(['when', 'phase', 'role', 'model', 'ran', 'turns', 'output', 'verdict', 'skills invoked', 'declared, never invoked'],
    runs.map(({ ph, r }) => {
      const gap = skillGap(ph, S.roles, r)
      const link = $('a', '', ph.phase)
      link.href = `#/project/${encodeURIComponent(p.name)}/phase/${encodeURIComponent(ph.phase)}`
      // A fix round inherits the FAIL it is answering; saying so beats printing a
      // verdict the run did not get.
      const fixing = ph.fix && r.role === ph.fix && r.role !== ph.role
      return [runWhen(r), link, r.role || ph.role, r.model || '-',
        r.seconds == null ? '-' : hm(r.seconds / 60), r.turns ?? '-', kb(r.tokens?.output || 0),
        fixing ? 'fix round' : [r.result || '-', r.result === 'FAIL' ? 'tag err' : ''],
        gap.used.join(', ') || 'none',
        [gap.unused.join(', ') || '-', gap.unused.length ? 'tag err' : '']]
    })))
  return box
}

function brandkitBlock (p) {
  const box = $('div')
  box.append($('h2', '', 'Brandkit'))
  const body = $('div'); body.append($('div', 'skel'))
  box.append(body)
  api(`/api/brandkit?project=${encodeURIComponent(p.name)}`).then(d => {
    body.textContent = ''
    if (!d.present) { body.append($('div', 'note', d.why)); return }
    body.append($('p', 'sub', d.hostDir))

    if (d.colours.length) {
      const g = $('div', 'swatches')
      for (const c of d.colours) {
        const sw = $('div', 'swatch')
        const chip = $('div', 'ink'); chip.style.background = c.value
        sw.append(chip, $('div', 'tag', c.name), $('div', 'tag', c.value))
        g.append(sw)
      }
      body.append(g)
    }

    for (const im of d.images) {
      const fig = document.createElement('figure'); fig.className = 'shot art'; fig.style.margin = '0'
      const a = $('a'); a.href = im.url; a.target = '_blank'; a.rel = 'noopener'; a.title = `open ${im.path}`
      const el = document.createElement('img'); el.loading = 'lazy'; el.src = im.url; el.alt = im.path
      a.append(el); fig.append(a, $('figcaption', '', im.path))
      body.append(fig)
    }

    for (const doc of d.docs) {
      const det = $('details', 'phase')
      const sum = document.createElement('summary')
      sum.append($('span', 'name', doc.path), $('span', 'tag', `${Math.round(doc.content.length / 1024)} KB`), $('span', 'tag', ''))
      det.append(sum)
      const inner = $('div'); inner.style.padding = '10px 0 16px'
      det.append(inner)
      det.ontoggle = () => {
        if (!det.open || det.dataset.l) return
        det.dataset.l = '1'
        inner.append(/\.md$/i.test(doc.path) ? md(doc.content) : $('pre', 'plain', doc.content))
      }
      body.append(det)
    }
    if (!d.colours.length && !d.images.length && !d.docs.length) body.append($('div', 'note', 'brandkit/ exists but has nothing readable in it yet.'))
  }).catch(e => { body.textContent = ''; body.append($('div', 'note err', e.message)) })
  return box
}

/* What to start once the verdict is written. The cockpit cannot run it — it leaves the
   word in <project>/.run-request and `brain watch` on the host opens the terminal. The
   choice is per browser, because it is a habit ("I always want auto"), not project state
   some other reader of this brain should inherit. */
const THEN_KEY = 'brain.then'
const thenChoice = () => { try { return localStorage.getItem(THEN_KEY) ?? 'auto' } catch { return 'auto' } }

function thenPicker () {
  const wrap = $('label', 'tag'); wrap.style.display = 'inline-flex'; wrap.style.gap = '6px'; wrap.style.alignItems = 'center'
  wrap.append(document.createTextNode('then start'))
  const sel = document.createElement('select')
  for (const [v, label] of [['auto', 'brain auto (the rest of the playbook)'], ['run', 'brain run (this phase only)'], ['', 'nothing, I will start it myself']]) {
    sel.append(Object.assign(document.createElement('option'), { value: v, textContent: label }))
  }
  sel.value = thenChoice()
  sel.onchange = () => { try { localStorage.setItem(THEN_KEY, sel.value) } catch {} }
  wrap.append(sel)
  return { wrap, get: () => sel.value }
}

function gateControls (p, ph) {
  const box = $('div'); box.style.marginTop = '14px'
  const items = $('textarea', 'verdict'); items.rows = 3
  items.placeholder = ph.fix
    ? 'One change per line. These become the numbered fix list the fix role is told to work through.'
    : 'One change per line. This phase has no fix role: they go to the phase you send the playbook back to, which runs again with everything after it.'
  const bar = $('div', 'bar'), note = $('span', 'tag')
  const ok = $('button', 'primary', `Approve ${ph.phase}`)
  const no = $('button', 'danger', ph.fix ? 'Request changes' : 'Send back to')
  const then = thenPicker()
  // No fix role (launch-gate): the way back is reopening the phase that made the work.
  const back = document.createElement('select')
  for (const x of p.phases.slice(0, p.phases.findIndex(x => x.phase === ph.phase) + 1).filter(x => x.role !== 'human').reverse()) {
    back.append(Object.assign(document.createElement('option'), { value: x.phase, textContent: x.phase }))
  }
  // Approving over open findings closes them: waived unless you tick defer, which keeps
  // them on the record for retro as known, unfixed work.
  const open = (ph.defects || []).filter(d => d.state === 'OPEN')
  const defer = open.map(d => {
    const c = Object.assign(document.createElement('input'), { type: 'checkbox', value: d.id })
    const l = $('label', 'tag'); l.style.display = 'block'
    l.append(c, document.createTextNode(` defer ${d.id}${d.text ? `: ${d.text}` : ''}`))
    return { c, l }
  })

  const run = async (fn) => {
    ok.disabled = no.disabled = true; note.className = 'tag'; note.textContent = 'saving'
    try {
      const r = await fn()
      note.className = 'tag'
      // Three different things can have happened, and guessing wrong is what makes a
      // button feel broken: it ran, it is queued for a watcher that is not there, or
      // you asked for nothing.
      note.textContent = !r?.started ? 'saved' : r.watching ? `saved, starting brain ${r.started}` : `saved, waiting for \`brain watch\` to start brain ${r.started}`
      if (r?.willStick) alert(`That was fix round ${r.fails} of ${r.maxFails}. brain run will now stop and ask you instead of starting another fix round.`)
      S = await api('/api/state'); render()
    } catch (e) { note.className = 'tag err'; note.textContent = e.message; ok.disabled = false; no.disabled = false }
  }
  const lines = () => items.value.split('\n').map(s => s.trim()).filter(Boolean)
  ok.onclick = () => run(() => api('/api/approve', { method: 'POST', body: { project: p.name, phase: ph.phase, then: then.get(), defer: defer.filter(d => d.c.checked).map(d => d.c.value) } }))
  no.onclick = () => run(() => ph.fix
    ? api('/api/reject', { method: 'POST', body: { project: p.name, phase: ph.phase, items: lines(), then: then.get() } })
    : api('/api/reopen', { method: 'POST', body: { project: p.name, phase: back.value, items: lines(), then: then.get() } }))

  box.append($('h3', 'tag', 'your verdict'), items)
  if (open.length) {
    box.append($('p', 'sub', `${open.length} open finding${open.length > 1 ? 's' : ''}. Approving waives ${open.length > 1 ? 'them' : 'it'} on the record; tick the ones to keep as deferred work instead.`))
    for (const d of defer) box.append(d.l)
  }
  bar.append(ok, no, ...(ph.fix ? [] : [back]), then.wrap, note, $('span', 'grow'))
  box.append(bar)
  box.append($('p', 'sub', ph.fix
    ? 'Approve keeps the agent summary above and adds the PASS line. Requesting changes clears the done marker so the next brain run starts the fix role.'
    : 'Approve keeps the agent summary above and adds the PASS line. Sending back reopens the phase you pick: it and every phase after it lose their done marker and run again.'))
  if (!S.watching) box.append(watchNote('the verdict is all that happens here'))
  return box
}

/* decisions.md is append-only by contract (BRAIN.md:24, "append, never rewrite
   history"), so this is a two-field appender rather than a textarea. The line format
   is the one BRAIN.md specifies and agents already write, em-dashes included. */
function decisionAppender (p) {
  const path = `${p.mem}/decisions.md`
  const box = $('div'), list = $('div'), bar = $('div', 'bar'), note = $('span', 'tag')
  const what = document.createElement('input'); what.type = 'text'; what.placeholder = 'Decision'
  const why = document.createElement('input'); why.type = 'text'; why.placeholder = 'Reason'
  const add = $('button', 'primary', 'Append')
  let current = null
  const show = () => {
    list.textContent = ''
    const body = (current || '').trim()
    list.append(body ? md(body) : $('div', 'note', 'No decisions recorded yet.'))
  }
  const load = () => api(`/api/file?path=${encodeURIComponent(path)}`)
    .then(d => { current = d.content; show() })
    .catch(e => { list.textContent = ''; list.append($('div', 'note err', e.message)) })
  add.onclick = async () => {
    if (!what.value.trim()) { note.className = 'tag err'; note.textContent = 'a decision needs text'; return }
    add.disabled = true; note.className = 'tag'; note.textContent = 'saving'
    const date = new Date().toISOString().slice(0, 10)
    const line = `${date} \u2014 ${what.value.trim()}${why.value.trim() ? ` \u2014 ${why.value.trim()}` : ''}`
    const next = (current && current.trim() ? current.replace(/\n*$/, '\n') : '') + line
    try {
      await api(`/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: { content: next, prev: current } })
      what.value = why.value = ''; note.textContent = 'appended'
      await load(); setTimeout(() => { if (note.textContent === 'appended') note.textContent = '' }, 1800)
    } catch (e) {
      note.className = 'tag err'
      note.textContent = e.status === 409 ? 'decisions.md changed on disk, reloading' : e.message
      if (e.status === 409) await load()
    }
    add.disabled = false
  }
  list.append($('div', 'skel')); load()
  bar.append(what, why, add, note)
  box.append(list, bar)
  return box
}

/* ---------- router ---------- */

// Grouped by where the thing lives: system/ is what agents run, memory/ what they know.
const NAV = [
  ['', [['', 'Overview', 'house', () => S.projects.length]]],
  ['System', [
    ['playbooks', 'Playbooks', 'book-open-text', () => S.playbooks.length],
    ['roles', 'Roles', 'robot', () => S.roles.length],
    ['skills', 'Skills', 'puzzle-piece', () => S.skills.declared.length],
    ['apps', 'Apps', 'squares-four', () => S.apps.length]]],
  // A function, read on every render: Clients is the clients app's, so it shows only with it.
  ['Knowledge', () => [
    ['memory', 'Memory', 'brain', () => ''],
    ...(S.clientsOn ? [['clients', 'Clients', 'buildings', () => S.clients.length]] : [])]]
]
const navItems = items => typeof items === 'function' ? items() : items
const navLabel = slug => NAV.flatMap(g => navItems(g[1])).find(i => i[0] === slug)

function renderNav (active) {
  const nav = document.getElementById('nav'); nav.textContent = ''
  for (const [title, group] of NAV) {
    const items = navItems(group)
    if (!items.length) continue
    const g = $('div', 'group')
    if (title) g.append($('span', '', title))
    for (const [slug, label, ico, count] of items) {
      const a = $('a', 'nav-item'); a.href = `#/${slug}`
      a.append(icon(ico), $('span', 'label', label), $('span', 'n', String(count() ?? '')))
      if (slug === active) a.setAttribute('aria-current', 'page')
      g.append(a)
    }
    nav.append(g)
  }
  const errs = S.lint.filter(f => f.level === 'error').length
  const checks = document.getElementById('checks')
  checks.className = `nav-item checks${errs ? ' err' : ''}`
  checks.replaceChildren(icon(errs ? 'warning-circle' : 'check-circle'), $('span', 'label', errs ? `${errs} problem${errs > 1 ? 's' : ''}` : 'All checks pass'))
  document.getElementById('undo').replaceChildren(cmd(`git -C ${S.hostBrain} diff`))
}

/* The strip across the top of the panel: where you are, each step back one click. */
function crumbs (top, key, arg, sub, sub2) {
  const c = $('nav', 'crumbs'), [slug, label, ico] = navLabel(top) || navLabel('')
  c.setAttribute('aria-label', 'Breadcrumb')
  const trail = [[label, `#/${slug}`, ico]]
  if (arg) trail.push([arg, key === 'project' ? `#/project/${encodeURIComponent(arg)}` : ''])
  if (key === 'project' && sub === 'phase' && sub2) trail.push([decodeURIComponent(sub2)])
  trail.forEach(([text, href, ico], i) => {
    if (i) c.append(icon('caret-right'))
    const last = i === trail.length - 1, el = last ? $('span', 'here') : $('a', 'crumb')
    if (!last) el.href = href
    if (ico) el.append(icon(ico))
    el.append($('span', '', text))
    c.append(el)
  })
  const s = $('div', 'strip'); s.append(c)
  return s
}

function render (opts) {
  const parts = location.hash.replace(/^#\/?/, '').split('/')
  const key = parts[0] || '', arg = parts[1] || ''
  // A project's own sections and its phases are destinations, not scroll positions, so
  // the router reads two more segments: #/project/<name>/<tab> and .../phase/<phase>.
  const sub = parts[2] || '', sub2 = parts[3] || ''
  const top = ['playbook', 'draft', 'role', 'skill', 'project'].includes(key)
    ? { playbook: 'playbooks', draft: 'playbooks', role: 'roles', skill: 'skills', project: '' }[key] : key
  renderNav(top)
  view.textContent = ''
  const routes = {
    '': dashboard, playbooks: playbooksView, roles: rolesView, skills: skillsView,
    memory: memoryView, clients: clientsView,
    app: () => { location.replace(`#/apps/${arg}`); return $('div') },
    apps: () => appsView(decodeURIComponent(arg)),
    playbook: () => playbookView(decodeURIComponent(arg)),
    draft: () => draftView(decodeURIComponent(arg)),
    role: () => roleView(decodeURIComponent(arg)),
    skill: () => skillView(decodeURIComponent(arg)),
    project: () => projectView(decodeURIComponent(arg), sub, sub2)
  }
  const fn = routes[key] || dashboard
  // hashchange passes an Event, which has no keepScroll, so navigation still lands at
  // the top; only a live refresh of the page you are already on holds its position.
  const keep = opts && typeof opts.keepScroll === 'number' ? opts.keepScroll : null
  // The same split decides the fade: arriving at a page fades it in, a refresh does not.
  const page = $('div', keep === null ? 'page' : ''), pane = $('div', 'pane')
  try { pane.append(fn()) } catch (e) { pane.append($('div', 'note err', e.message)) }
  page.append(crumbs(routes[key] ? top : '', key, routes[key] ? decodeURIComponent(arg) : '', sub, sub2), pane)
  view.append(page)
  if (keep === null) { view.scrollTop = 0; scrollTo(0, 0) } else scrollTo(0, keep)
}

/* ---------- live updates ---------- */
/* The cockpit reads state that another process is writing: bin/brain flips marker files
   as a phase runs, and an agent writes memory/ under you. Refreshing by hand to find
   out is the wrong contract for a control panel, so the server pushes and this refetches.
   What it will not do is re-render on top of your hands: a live rebuild while you are
   typing into the brief, or with a verdict half-written, would throw the text away. */
let staleTag = null
const busyEditing = () => {
  const el = document.activeElement
  if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true
  return !!document.querySelector('.dirty') // an editor with unsaved changes
}

async function refreshState (keepScroll, next) {
  if (!next) try { next = await api('/api/state') } catch { return } // server restarting; the stream will fire again
  S = next
  if (staleTag) { staleTag.remove(); staleTag = null }
  render({ keepScroll })
}

function showStale () {
  if (staleTag) return
  staleTag = $('button', 'stale', 'Something changed · reload')
  staleTag.onclick = () => refreshState(scrollY)
  document.body.append(staleTag)
}

function live () {
  if (typeof EventSource !== 'function') return
  const es = new EventSource('/api/events') // EventSource reconnects on its own
  // It does not replay what it missed: resync on every (re)connect and when the tab is
  // looked at again — a laptop asleep or the cockpit rebuilt sends no event of its own.
  addEventListener('visibilitychange', () => { if (!document.hidden) es.onmessage() })
  es.onopen = () => es.onmessage()
  es.onmessage = async () => {
    let next
    try { next = await api('/api/state') } catch { return }
    // Most events change nothing shown here: an agent saving a working file mid-phase.
    // Rebuilding for those reset the page under you every few seconds.
    if (JSON.stringify(next) === JSON.stringify(S)) return
    if (busyEditing()) showStale(); else refreshState(scrollY, next)
  }
}

async function boot () {
  view.append($('div', 'skel'), $('div', 'skel'), $('div', 'skel'))
  try { S = await api('/api/state') } catch (e) {
    view.textContent = ''
    view.append($('div', 'note err', `Could not load the brain: ${e.message}`))
    return
  }
  addEventListener('hashchange', render)
  render()
  live()
}
boot()
