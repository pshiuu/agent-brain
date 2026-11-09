import { createExtensions } from './extensions.js'
/* Studio: the front end for the people the work is for. Projects grouped by area (the
   `Area:` line of their playbook: Content, Websites, …), what waits on you, the review
   with comments on the text, the copy for the CMS, adjusting a playbook in words, and
   the clients. A project page is built from what the project has, not from its kind:
   a tab appears when its file does (see `tabs` in projectView). Agents, skills and the full record live in Admin (/admin), on the
   same API. */
const view = document.getElementById('view')
const nav = document.getElementById('nav')
const search = document.getElementById('q')
let S = null
let query = ''
const F = { client: '', type: '', state: '' }

/* ---------- words ---------- */
const ACRONYM = /^(seo|aeo|geo|faq|ai|url)$/i
const human = slug => String(slug || '').split('-').filter(Boolean)
  .map((w, i) => ACRONYM.test(w) ? w.toUpperCase() : i ? w : w[0].toUpperCase() + w.slice(1)).join(' ')
// A client is a name: every word capitalised.
const clientName = slug => String(slug || '').split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
// A gate is named for what it reviews: outline-gate is "Your review: outline".
// A gate's name minus the words that only say it is a gate: outline-gate is the outline,
// and a phase called approve or review is just your review.
const reviewOf = ph => ph.phase.replace(/^(approve|approval|review|gate)$|-?gate$/, '')
const stepName = ph => ph.role === 'human'
  ? `Your review${reviewOf(ph) ? `: ${human(reviewOf(ph)).toLowerCase()}` : ''}`
  : human(ph.phase)
const humanTurn = ph => !!ph && ph.role === 'human' && ['pending', 'awaiting-review'].includes(ph.state)
const titleOf = p => p.title || human(p.name)
const typeOf = name => human(name)
// The area a playbook belongs to, and so every project made from it.
const areaOf = playbook => S.playbooks.find(x => x.name === playbook)?.area || 'Other'
const areas = () => [...new Set([...S.playbooks.map(x => x.area), ...S.projects.map(p => areaOf(p.playbook))])].sort()
const areaHref = area => `#/area/${encodeURIComponent(toSlug(area))}`
const areaCrumb = p => [areaOf(p.playbook), areaHref(areaOf(p.playbook)), 'folder']
const iconOf = playbook => /refresh/.test(playbook) ? 'arrows-clockwise' : ({ content: 'file-text', websites: 'browser' })[toSlug(areaOf(playbook))] || 'folder'
const ago = d => {
  if (!d) return ''
  const days = Math.round((Date.now() - new Date(d)) / 864e5)
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? `${days} days ago` : new Date(d).toLocaleDateString()
}

/* ---------- small building blocks ---------- */
const link = (href, cls, ...kids) => { const a = $('a', cls); a.href = href; a.append(...kids); return a }
const withIcon = (el, name, text) => { el.append(icon(name), $('span', '', text)); return el }
const btn = (cls, name, text) => withIcon($('button', cls), name, text)

/** Where a project stands, in the words the Studio uses. Rank orders every list. */
function status (p) {
  const n = p.next
  if (!n) return { key: 'done', label: 'Done', icon: 'check-circle', rank: 5 }
  if (humanTurn(n)) return { key: 'you', label: 'Waiting for you', icon: 'hand-pointing', rank: 0 }
  if (n.state === 'running') return { key: 'work', label: stepName(n), icon: 'circle-notch', rank: 1 }
  if (n.state === 'stuck') return { key: 'stuck', label: 'Needs help', icon: 'warning-circle', rank: 2 }
  if (p.limit) return { key: 'queued', label: `Usage limit · resumes ${atTime(p.limit.until)}`, icon: 'hourglass', rank: 3 }
  if (p.runPending) return { key: 'queued', label: 'Queued', icon: 'clock', rank: 3 }
  return { key: 'paused', label: 'Paused', icon: 'pause', rank: 4 }
}
// The running icon turns: it is the one thing on the page that is live.
const tagOf = st => { const t = $('span', `tag-s ${st.key}`); t.append(icon(st.icon, st.key === 'work' ? 'spin' : ''), document.createTextNode(st.label)); return t }
const stepState = (p, ph) => ph.state === 'done' ? 'done'
  : p.next?.phase === ph.phase && humanTurn(ph) ? 'you'
    : ph.state === 'running' ? 'work'
      : ['stuck', 'awaiting-fix'].includes(ph.state) ? 'fix' : 'todo'

function mini (p) {
  const w = $('span', 'mini'), bars = $('span', 'bars')
  for (const ph of p.phases) { const i = $('i', `s-${stepState(p, ph)}`); i.title = stepName(ph); bars.append(i) }
  w.append(bars, $('span', 'num', `${p.phases.filter(ph => ph.state === 'done').length}/${p.phases.length}`))
  return w
}

function stepper (p) {
  const w = $('ol', 'stepper'); w.setAttribute('aria-label', 'Steps')
  const glyph = { done: 'check', you: 'hand-pointing', work: 'circle-notch', fix: 'arrows-clockwise', todo: 'circle' }
  for (const ph of p.phases) {
    const st = stepState(p, ph), li = $('li', `s-${st}`), d = $('span', 'dot')
    d.append(icon(glyph[st], st === 'work' ? 'spin' : ''))
    li.append(d, $('span', '', stepName(ph)))
    w.append(li)
  }
  return w
}

/** One page in the panel: the crumb strip, then the body. */
function frame (crumbs, actions, ...body) {
  const page = $('div', 'page'), strip = $('div', 'strip'), c = $('nav', 'crumbs')
  c.setAttribute('aria-label', 'Breadcrumb')
  crumbs.forEach(([label, href, ico], i) => {
    if (i) c.append(icon('caret-right'))
    const el = href ? link(href, 'crumb') : $('span', 'here')
    if (ico) el.append(icon(ico))
    el.append($('span', '', label))
    c.append(el)
  })
  strip.append(c, ...actions.filter(Boolean))
  const b = $('div', 'body'); b.append(...body.filter(Boolean))
  page.append(strip, b)
  return page
}
const head = (title, sub, ...after) => { const h = $('div', 'head'), d = $('div'); d.append($('h1', '', title)); if (sub) d.append($('p', '', sub)); h.append(d, ...after.filter(Boolean)); return h }
function card (title, sub, action, ...body) {
  const c = $('section', 'card'), h = $('header'), d = $('div')
  d.append($('h2', '', title)); if (sub) d.append($('p', '', sub))
  h.append(d); if (action) h.append(action)
  c.append(h, ...body.filter(Boolean))
  return c
}
const pad = (...kids) => { const d = $('div', 'pad'); d.append(...kids.filter(Boolean)); return d }
function empty (ico, title, text, action) {
  const e = $('div', 'empty'), i = $('span', 'ico'); i.append(icon(ico))
  e.append(i, $('h2', '', title), $('p', '', text)); if (action) e.append(action)
  return e
}
const newButton = (area = '') => withIcon(link(area ? `#/new/${encodeURIComponent(toSlug(area))}` : '#/new', 'btn primary'), 'plus', 'New project')
function toast (msg) {
  const t = document.getElementById('toast')
  t.textContent = msg; t.hidden = false
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true }, 3600)
}
const note = (cls, ico, text) => { const n = $('div', `note ${cls}`); n.append(icon(ico), $('p', '', text)); return n }
// Typing into a form must never be thrown away by a live refresh.
const keep = el => { el.addEventListener('input', () => { el.dataset.keep = '1' }); return el }
const watchingNote = () => S.watching ? null : note('warn', 'warning-circle',
  'Runs cannot start right now: the helper that starts them is not running on this Mac. Whoever set up the Studio can fix it once with ./install.sh. Everything you do here is kept and starts as soon as it runs.')

/* ---------- the project table, shared by every list ---------- */
const sorted = ps => ps.slice().sort((a, b) => status(a).rank - status(b).rank || String(b.created).localeCompare(String(a.created)))
const td = (cls, ...kids) => { const d = $('td', cls); d.append(...kids); return d }
const rowLink = (r, go) => { r.tabIndex = 0; r.onclick = () => { location.hash = go }; r.onkeydown = e => { if (e.key === 'Enter') location.hash = go } }
function table (cols, rows, none) {
  const wrap = $('div', 'scroll'), t = $('table', 'grid'), th = $('thead'), hr = $('tr'), tb = $('tbody')
  for (const [c, cls] of cols) { const h = $('th', cls, c); if (c === '#') h.setAttribute('aria-label', 'Number'); hr.append(h) }
  th.append(hr); tb.append(...rows)
  if (!rows.length) { const r = $('tr'), d = $('td', 'empty-row', none); d.colSpan = cols.length; r.append(d); tb.append(r) }
  t.append(th, tb); wrap.append(t)
  return wrap
}
function projectTable (ps, { client = S.clientsOn, none = 'No projects yet.' } = {}) {
  const cols = [['#', 'idx'], ['Project', ''], ...(client ? [['Client', 'hide-sm']] : []), ['Type', 'hide-sm'], ['Progress', 'hide-sm'], ['Status', ''], ['Created', 'hide-sm']]
  return table(cols, ps.map((p, i) => {
    const r = $('tr'), go = `#/a/${encodeURIComponent(p.name)}`, a = $('td')
    rowLink(r, go)
    a.append(link(go, 't', titleOf(p))); if (p.keyword && p.keyword !== titleOf(p)) a.append($('span', 'k', p.keyword))
    r.append(td('idx', String(i + 1)), a)
    if (client) r.append(td('dim hide-sm', p.client ? clientName(p.client) : ''))
    r.append(td('dim hide-sm', typeOf(p.playbook)), td('hide-sm', mini(p)), td('', tagOf(status(p))), td('dim hide-sm', ago(p.created)))
    return r
  }), none)
}

/* ---------- Overview ---------- */
function overview () {
  const ps = sorted(S.projects)
  const count = keys => ps.filter(p => keys.includes(status(p).key)).length
  const waiting = ps.filter(p => status(p).key === 'you')
  const crumbs = [['Overview', '', 'house']]
  const pend = S.pending.new.filter(n => !ofKind(n))
  const use = usageBlock(S.usage, S.engines)
  const usage = use && card('Agent usage', 'What each subscription has left. A run that reaches a limit pauses and carries on by itself after the reset.', null, pad(use))
  if (!ps.length && !pend.length) {
    return frame(crumbs, [newButton()], head('Overview'), watchingNote(), usage,
      card('Your first project', '', null, empty('pen-nib', 'No projects yet', 'Pick what kind of work it is and fill in the brief. The steps run by themselves, and you review where the playbook asks you to.', newButton())))
  }
  const stats = $('div', 'stats')
  for (const [label, n, ico, cls] of [['Waiting for you', waiting.length, 'hand-pointing', 'you'], ['Working', count(['work']), 'circle-notch', ''], ['Queued or paused', count(['queued', 'paused', 'stuck']), 'clock', ''], ['Done', count(['done']), 'check-circle', '']]) {
    const s = $('div', `stat${n && cls ? ' ' + cls : ''}`), l = $('span'); l.append(icon(ico), document.createTextNode(label))
    s.append(l, $('b', '', String(n))); stats.append(s)
  }
  const sub = waiting.length ? `${waiting.length} review${waiting.length > 1 ? 's' : ''} only you can do.` : 'Nothing is waiting for you right now.'
  const parts = [head('Overview', sub), watchingNote(), baseUpdateNote(S, () => refresh().then(() => render())), stats].filter(Boolean)
  if (pend.length) parts.push(startingCard())
  if (usage) parts.push(usage)
  if (waiting.length) parts.push(card('Waiting for you', 'Open one, comment on the text, then approve it or send it back.', null, projectTable(waiting)))
  const adj = adjustments()
  if (adj.length) parts.push(card('Playbook changes', 'What you asked the AI to change. Look it over, then apply it or not.', null, table([['Playbook', ''], ['Status', '']], adj.map(d => {
    const r = $('tr'), go = `#/adjust/${encodeURIComponent(d.name)}`
    rowLink(r, go)
    r.append(td('', link(go, 't', typeOf(d.name))), td('', tagOf(d.pending ? { key: 'work', label: 'Being rewritten', icon: 'circle-notch' } : { key: 'you', label: 'Ready for you', icon: 'hand-pointing' })))
    return r
  }), '')))
  const recent = ps.filter(p => status(p).key !== 'you').slice(0, 6)
  if (recent.length) parts.push(card('Recent projects', '', link('#/articles', 'btn', 'All projects'), projectTable(recent)))
  return frame(crumbs, [newButton()], ...parts)
}

/* Projects asked for and not made yet: the helper creates them on its next tick. */
function startingCard () {
  const rows = S.pending.new.filter(n => !ofKind(n)).map(n => {
    const r = $('tr'), a = $('td'), s = $('td'); r.style.cursor = 'default'
    a.append($('span', 't', human(n.slug)), $('span', 'k', [n.client && clientName(n.client), typeOf(n.playbook)].filter(Boolean).join(', ')))
    if (n.error) {
      const d = btn('quiet', 'x', 'Discard')
      d.onclick = async () => { await api('/api/project-pending', { method: 'DELETE', body: { name: n.slug } }); await refresh(); render() }
      s.append($('span', 'err-text', n.error), d)
    } else s.append(tagOf({ key: 'queued', label: 'Starting', icon: 'clock' }))
    r.append(a, s); return r
  })
  return card('Starting', 'Being set up. They show up in their area in a moment.', null, table([['Project', ''], ['Status', '']], rows, ''))
}

/* ---------- Projects: all of them, or one area's ---------- */
function projectsView (areaSlug = '') {
  const area = areaSlug && areas().find(a => toSlug(a) === areaSlug)
  if (areaSlug && !area) return frame([['Projects', '#/articles', 'files'], [areaSlug]], [], card('Not found', '', null, empty('magnifying-glass', 'No such area', `No playbook is in an area called ${areaSlug}.`, link('#/articles', 'btn', 'All projects'))))
  const all = sorted(S.projects.filter(p => !area || areaOf(p.playbook) === area))
  const q = query.trim().toLowerCase()
  const ps = all.filter(p => (!F.client || p.client === F.client) && (!F.type || p.playbook === F.type) && (!F.state || status(p).key === F.state) &&
    (!q || [titleOf(p), p.keyword, p.client, p.name].some(x => String(x || '').toLowerCase().includes(q))))
  const pick = (label, key, opts) => {
    const s = $('select', 'chip'); s.setAttribute('aria-label', label)
    s.append(Object.assign(document.createElement('option'), { value: '', textContent: label }))
    for (const [v, t] of opts) s.append(Object.assign(document.createElement('option'), { value: v, textContent: t, selected: F[key] === v }))
    s.onchange = () => { F[key] = s.value; render() }
    return s
  }
  const filters = $('div', 'bar')
  filters.append(
    ...(S.clientsOn ? [pick('All clients', 'client', [...new Set(all.map(p => p.client).filter(Boolean))].sort().map(c => [c, clientName(c)]))] : []),
    pick('All types', 'type', [...new Set(all.map(p => p.playbook))].sort().map(t => [t, typeOf(t)])),
    pick('Every status', 'state', [['you', 'Waiting for you'], ['work', 'Working'], ['queued', 'Queued'], ['paused', 'Paused'], ['stuck', 'Needs help'], ['done', 'Done']]))
  if (q) { const c = btn('quiet', 'x', `Search: ${query}`); c.onclick = () => { query = ''; search.value = ''; render() }; filters.append(c) }
  const filtered = q || F.client || F.type || F.state
  const title = area || 'All projects'
  return frame([[title, '', area ? 'folder' : 'files']], [newButton(area)],
    head(title, `${all.length} in all${filtered ? `, ${ps.length} shown` : ''}.`), watchingNote(),
    card(title, '', filters, projectTable(ps, { none: filtered ? 'Nothing matches these filters.' : 'No projects yet.' })))
}

/* ---------- New project ---------- */
function newProject (preset = '') {
  // Every playbook with a brief or an inputs file: its inputs are the form, its brief's
  // headings the rest. `preset` is a playbook or an area; an area offers only its own.
  // The type used most comes first, so the usual one is the default.
  const used = n => S.projects.filter(p => p.playbook === n).length
  const area = areas().find(a => toSlug(a) === preset)
  const pbs = S.playbooks.filter(p => (p.hasBrief || p.inputs.length) && (!area || p.area === area))
    .sort((a, b) => used(b.name) - used(a.name) || a.name.localeCompare(b.name))
  let playbook = pbs.find(p => p.name === preset)?.name || pbs[0]?.name || ''
  const crumbs = [area ? [area, areaHref(area), 'folder'] : ['Projects', '#/articles', 'files'], ['New project']]
  const h = head('New project', S.clientsOn ? 'What kind of work, and for whom. What a client hands over once is remembered.' : 'What kind of work, and what it needs.')
  if (!pbs.length) return frame(crumbs, [], h, card('Nothing to start yet', '', null, empty('files', 'No playbook here yet', 'Draft one in Admin and it shows up here.', link('/admin', 'btn', 'Open Admin'))))

  const form = keep($('div', 'form')), main = $('div'), side = $('div')
  const types = $('div', 'types')
  for (const p of pbs) {
    const b = $('button', 'type'); b.type = 'button'
    const ico = $('span', 'ico'); ico.append(icon(iconOf(p.name)))
    b.append(ico, $('b', '', typeOf(p.name)), icon('check-circle', 'tick'), $('small', '', p.description || ''))
    b.setAttribute('aria-pressed', String(p.name === playbook))
    b.onclick = () => { playbook = p.name; for (const x of types.children) x.setAttribute('aria-pressed', String(x === b)); summary.querySelector('header p').textContent = plan(); load() }
    types.append(b)
  }
  const briefBox = $('div'), clientBox = $('div'), moreBox = $('div')

  // The client: one of the known ones, or a new name.
  const pickClient = $('select'); pickClient.setAttribute('aria-label', 'Client')
  pickClient.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Choose a client' }))
  for (const c of S.clients) pickClient.append(Object.assign(document.createElement('option'), { value: c.slug, textContent: clientName(c.slug) }))
  pickClient.append(Object.assign(document.createElement('option'), { value: '+', textContent: 'New client…' }))
  const fresh = $('input'); fresh.type = 'text'; fresh.placeholder = 'Client name, for example Northwind Solar'; fresh.hidden = true
  fresh.setAttribute('aria-label', 'New client name')
  const chosen = () => pickClient.value === '+' ? fresh.value.trim() : pickClient.value
  const clientFields = $('div', 'fields'); clientFields.append(pickClient, fresh, clientBox)
  const clientCard = card('The client', 'Optional. What a playbook asks of a client is asked once and kept with them.', null, pad(clientFields))

  const name = $('input'); name.type = 'text'; name.placeholder = 'acme-relaunch'; name.id = 'short-name'
  let named = false
  name.addEventListener('input', () => { named = !!name.value })
  const nameField = $('div', 'field'), nl = $('label', '', 'Short name'); nl.htmlFor = 'short-name'
  nameField.append(nl, name, $('span', 'tag', 'Filled in from the first answer. It names the project\'s folder.'))
  const start = $('label', 'switch'), go = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true })
  start.append(document.createTextNode('Start right away'), go)
  const create = btn('primary', 'plus', 'Create project'), msg = $('div', 'tag')
  // What happens after Create, read off the chosen playbook: its first step, then the
  // reviews that are yours. Written out once, it described seo-article for every type.
  const plan = () => {
    const ph = pbs.find(p => p.name === playbook)?.phases || []
    const yours = ph.filter(x => x.role === 'human').map(x => human(reviewOf(x)).toLowerCase() || 'the result')
    return [ph[0] && `It begins with ${human(ph[0].phase).toLowerCase()}.`,
      yours.length === 1 ? 'You review it once, before it is done.' : yours.length ? `You review it ${yours.length} times: ${yours.join(', then ')}.` : ''].filter(Boolean).join(' ')
  }
  const summary = card('Ready to start', plan(), null, pad(nameField, start, create, msg))
  summary.classList.add('side-card')
  side.append(summary)

  let shape = null, briefForm = null, clientForm = null, extras = []
  const loadClient = async () => {
    clientBox.textContent = ''; clientForm = null
    // Every project may have a client; only some playbooks ask the client for anything.
    if (!shape?.clientInputs.length) return
    const cl = chosen()
    if (!toSlug(cl)) { clientBox.append($('p', 'sub', `Asked once per client: ${shape.clientInputs.map(i => i.label.toLowerCase()).join(', ')}.`)); return }
    try {
      const c = await api(`/api/client-inputs?client=${encodeURIComponent(cl)}&playbook=${encodeURIComponent(playbook)}`)
      clientForm = inputsForm(c.inputs, Object.fromEntries(c.inputs.map(i => [i.name, i.value])))
      const complete = c.exists && c.inputs.every(i => !i.required || (Array.isArray(i.value) ? i.value.length : i.value))
      if (complete) {
        const d = $('details', 'fold'), got = c.inputs.filter(i => Array.isArray(i.value) ? i.value.length : i.value).map(i => i.label.toLowerCase())
        d.append($('summary', '', `Using what ${clientName(c.client)} has on file: ${got.join(', ')}. Change it`), clientForm.el)
        clientBox.append(d)
      } else {
        clientBox.append($('p', 'sub', c.exists ? `${clientName(c.client)} is missing some of this. It is saved with the client and reused next time.` : 'A new client. This is saved with them and reused for every article.'), clientForm.el)
      }
    } catch (e) { clientBox.append(note('err', 'warning-circle', e.message)) }
  }
  pickClient.onchange = () => { fresh.hidden = pickClient.value !== '+'; if (!fresh.hidden) fresh.focus(); loadClient() }
  fresh.onchange = loadClient

  const load = async () => {
    briefBox.textContent = ''; moreBox.textContent = ''; shape = null
    briefBox.append($('div', 'skel'), $('div', 'skel'))
    try {
      shape = await api(`/api/brief-form?playbook=${encodeURIComponent(playbook)}`)
      briefBox.textContent = ''
      briefForm = inputsForm(shape.inputs)
      briefBox.append(briefForm.el)
      // The first answer names the project, until someone names it themselves.
      const first = briefBox.querySelector('input[type=text], textarea')
      if (first) first.addEventListener('input', () => { if (!named) name.value = toSlug(first.value).slice(0, 40).replace(/-+$/, '') })
      extras = shape.sections.map(f => {
        const w = $('div', 'field'), l = $('label', '', f.heading), t = $('textarea')
        t.rows = 2; t.placeholder = f.hint; t.id = `more-${toSlug(f.heading)}`; l.htmlFor = t.id; t.dataset.heading = f.heading
        w.append(l, t); return t
      })
      // With no inputs, the brief's headings are the form, so they are not folded away.
      if (extras.length && !shape.inputs.length) { const f = $('div', 'fields'); extras.forEach(t => f.append(t.parentNode)); moreBox.append(f) }
      else if (extras.length) {
        const d = $('details', 'fold'), f = $('div', 'fields')
        extras.forEach(t => f.append(t.parentNode))
        d.append($('summary', '', 'More details for the brief (optional)'), f)
        moreBox.append(d)
      }
      await loadClient()
    } catch (e) { briefBox.textContent = ''; briefBox.append(note('err', 'warning-circle', e.message)) }
  }

  create.onclick = async () => {
    msg.className = 'tag'; msg.textContent = ''
    const fail = m => { msg.className = 'tag err'; msg.textContent = m }
    const cl = chosen()
    const err = briefForm?.check() || (shape?.clientInputs.length && !toSlug(cl) ? 'Choose a client' : '') || clientForm?.check() || (!toSlug(name.value) ? 'Give it a short name' : '')
    if (err) return fail(err)
    create.disabled = true
    try {
      const r = await submitProject({
        playbook, name: name.value, client: cl, projectForm: briefForm, clientForm,
        brief: Object.fromEntries(extras.map(t => [t.dataset.heading, t.value])), then: go.checked ? 'auto' : ''
      }, m => { msg.textContent = m })
      delete form.dataset.keep
      toast(go.checked ? `${human(r.project)} is starting` : `${human(r.project)} is created. Start it from its page.`)
      location.hash = '#/'
      await refresh(); render()
    } catch (e) { fail(e.message); create.disabled = false }
  }

  const fieldsWrap = $('div', 'fields'); fieldsWrap.append(briefBox, moreBox)
  main.append(card('What kind', '', null, pad(types)), card('The brief', '', null, pad(fieldsWrap)), ...(S.clientsOn ? [clientCard] : []))
  form.append(main, side)
  load()
  return frame(crumbs, [], h, watchingNote(), form)
}

/* ---------- one project ---------- */
function projectView (name, tab = '') {
  const p = S.projects.find(x => x.name === name)
  if (!p) {
    const n = S.pending.new.find(x => x.slug === name)
    return frame([['Projects', '#/articles', 'files'], [human(name)]], [], card(n ? 'Being set up' : 'Not found', '', null,
      empty(n ? 'clock' : 'magnifying-glass', n ? 'Almost there' : 'No such project', n ? 'This project is being set up and appears here in a moment.' : `There is no project called ${name}.`, link('#/articles', 'btn', 'All projects'))))
  }
  const st = status(p)
  const meta = $('div', 'meta')
  if (p.client) meta.append(withIcon(link(`#/client/${encodeURIComponent(p.client)}`, 'chip'), 'buildings', clientName(p.client)))
  meta.append(withIcon($('span', 'chip'), iconOf(p.playbook), typeOf(p.playbook)), tagOf(st))
  if (p.created) meta.append(withIcon($('span', 'chip'), 'calendar-blank', ago(p.created)))
  const actions = []
  if (['paused', 'stuck'].includes(st.key) && p.next) {
    const b = btn('primary', st.key === 'stuck' ? 'arrows-clockwise' : 'play', st.key === 'stuck' ? 'Try again' : 'Continue')
    b.onclick = async () => {
      b.disabled = true
      try { await api('/api/run', { method: 'POST', body: { project: p.name, then: 'auto' } }); toast('Queued. It starts in a moment.'); await refresh(); render() } catch (e) { toast(e.message); b.disabled = false }
    }
    actions.push(b)
  }
  const adj = adjustments().find(d => d.name === p.playbook)
  // Feedback on how the run went is how a playbook gets better, so a finished project asks for it.
  actions.push(withIcon(link(`#/adjust/${encodeURIComponent(p.playbook)}/${encodeURIComponent(p.name)}`, st.key === 'done' && !adj ? 'btn primary' : 'btn'), 'sliders-horizontal',
    adj && !adj.pending ? 'Playbook changes ready' : st.key === 'done' ? 'Feedback on the playbook' : 'Adjust playbook'))
  const h = head(titleOf(p), '', ...actions); h.firstChild.append(meta)

  const waiting = humanTurn(p.next)
  // Between Your review and Progress: the tabs the project's app shows in the Studio (ui/app.json).
  const own = (p.tabs || []).filter(t => t.studio)
  const tabs = [['review', 'Your review', 'hand-pointing', waiting], ...own.map(t => [t.id, t.label, t.icon || 'file', true]), ['progress', 'Progress', 'list-checks', true], ['brief', 'Brief', 'note-pencil', true]].filter(t => t[3])
  if (!tabs.some(t => t[0] === tab)) tab = waiting ? 'review' : own[0] && !p.next ? own[0].id : 'progress'
  const seg = $('nav', 'seg'); seg.setAttribute('aria-label', 'Project views')
  for (const [k, label, ico] of tabs) {
    const a = withIcon(link(`#/a/${encodeURIComponent(p.name)}/${k}`, ''), ico, label)
    if (k === 'review') a.append($('span', 'n', '1'))
    if (k === tab) a.setAttribute('aria-current', 'page')
    seg.append(a)
  }
  const stuck = st.key === 'stuck' ? note('err', 'warning-circle', 'A step failed its checks more often than allowed. Try again runs it once more. If it stops again, Admin shows what went wrong.') : null
  const body = tab === 'review' ? reviewPanel(p, p.next)
    : own.some(t => t.id === tab && t.view === 'article') ? copyPanel(p)
      : tab === 'brief' ? briefPanel(p) : progressPanel(p)
  return frame([areaCrumb(p), ...(p.client ? [[clientName(p.client), `#/client/${encodeURIComponent(p.client)}`]] : []), [titleOf(p)]], [newButton(areaOf(p.playbook))],
    h, stepper(p), watchingNote(), stuck, seg, body)
}

function copyPanel (p) {
  const w = $('div', 'copy')
  w.append(articleBlock(p, { intro: false }))
  return card('Copy', 'Rebuilt from the article every time you open it. Paste each field into the CMS item, then the body into its rich-text field.', null, pad(w))
}

const fileText = path => api(`/api/file?path=${encodeURIComponent(path)}`).then(f => f.content)

/* The review: what the gate is about, in a reading pane you can comment on by selecting a
   sentence, and the two answers. Approve, or send it back with your comments, which the
   step that made it gets as a numbered list and has to answer item by item. */
function reviewPanel (p, gate) {
  const box = $('div', 'review'), doc = $('article', 'card doc')
  const at = p.phases.findIndex(x => x.phase === gate.phase)
  const made = p.phases.slice(0, at).reverse().find(x => x.role !== 'human')
  // After a reopen, the old article.md is still on disk at gates that come before the
  // phase that rewrites it; those gates review their own step's summary instead.
  const article = p.has?.article && (!p.phases.some(x => x.writesArticle) || p.phases.slice(0, at).some(x => x.writesArticle))
  doc.append($('div', 'skel'), $('div', 'skel'), $('div', 'skel'))

  ;(async () => {
    try {
      const content = $('div', 'prose reading')
      if (article) {
        const a = await api(`/api/article?project=${encodeURIComponent(p.name)}`)
        const b = $('div'); b.innerHTML = a.body
        content.append($('h1', '', a.fields.title || titleOf(p)), ...b.childNodes)
      } else if (made) {
        content.append(...md(await fileText(`${p.mem}/phases/${made.phase}.md`)).childNodes)
      }
      doc.textContent = ''; doc.append(content)
      if (article && made) {
        const d = $('details', 'more'), s = $('summary')
        s.append(icon('caret-right'), document.createTextNode(`What the ${stepName(made).toLowerCase()} found`))
        d.append(s)
        d.ontoggle = async () => { if (d.open && d.children.length === 1) d.append(md(await fileText(`${p.mem}/phases/${made.phase}.md`).catch(e => e.message))) }
        doc.append(d)
      }
    } catch (e) { doc.textContent = ''; doc.append(note('err', 'warning-circle', e.message)) }
  })()

  // Comments: select text in what is shown, or add one about the whole thing.
  const comments = [], list = $('div', 'fields')
  // The passage stays marked in the article, so you can see what you already said
  // something about. Each text node in the range gets its own <mark>: a range can cross
  // paragraphs and table cells, which one wrapper cannot.
  const markRange = range => {
    const root = range.commonAncestorContainer, nodes = []
    if (root.nodeType === 3) nodes.push(root)
    else for (let w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n; (n = w.nextNode());) if (range.intersectsNode(n) && n.data.trim()) nodes.push(n)
    return nodes.map(n => {
      if (n === range.endContainer && range.endOffset < n.length) n.splitText(range.endOffset)
      if (n === range.startContainer && range.startOffset > 0) n = n.splitText(range.startOffset)
      const m = $('mark', 'c-mark'); n.replaceWith(m); m.append(n); return m
    })
  }
  const unmark = marks => marks.forEach(m => m.replaceWith(...m.childNodes))
  const addComment = (quote = '', marks = [], text = '') => {
    const c = { quote: quote.replace(/\s+/g, ' ').trim().slice(0, 240) }
    const el = $('div', 'comment'), top = $('div', 'top'), rm = btn('quiet', 'x', 'Remove')
    const t = $('textarea'); t.rows = 3; t.placeholder = quote ? 'What should change here?' : 'What should change?'
    t.setAttribute('aria-label', 'Comment'); t.value = text
    c.text = () => t.value.trim()
    marks.forEach(m => { m.onclick = () => openPop(marks, t.value, v => { t.value = v; sync() }) })
    t.onfocus = () => marks.forEach(m => m.classList.add('on'))
    t.onblur = () => marks.forEach(m => m.classList.remove('on'))
    rm.onclick = () => { comments.splice(comments.indexOf(c), 1); el.remove(); unmark(marks); sync() }
    top.append($('span', '', quote ? 'On this passage' : 'On the whole'), rm)
    el.append(top)
    if (c.quote) el.append($('blockquote', '', c.quote))
    el.append(t)
    comments.push(c); list.append(el); t.addEventListener('input', sync); sync()
    // A comment on the whole is started in the sidebar, so it is written there. One on a
    // passage was written in the popup at the passage: the sidebar may be a whole article
    // further down, and jumping there loses your place.
    if (!marks.length) { t.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }) }
    box.dataset.keep = '1'
  }

  // The popup where a comment on a passage is written, right under the passage.
  const pop = $('div', 'card comment-pop'); pop.hidden = true
  const pt = $('textarea'); pt.rows = 3; pt.placeholder = 'What should change here?'; pt.setAttribute('aria-label', 'Comment')
  const save = btn('primary', 'check', 'Save'), cancel = btn('quiet', 'x', 'Cancel'), row = $('div', 'acts')
  row.append(cancel, save); pop.append(pt, row)
  let closePop = () => {}
  const openPop = (marks, text, onSave, onCancel = () => {}) => {
    closePop()
    const r = marks[0].getBoundingClientRect(), last = marks[marks.length - 1].getBoundingClientRect(), o = box.getBoundingClientRect()
    pop.style.top = `${last.bottom - o.top + 8}px`
    pop.style.left = `${Math.max(0, Math.min(r.left - o.left, o.width - 340))}px`
    marks.forEach(m => m.classList.add('on'))
    pt.value = text; pop.hidden = false; floater.hidden = true; box.dataset.keep = '1'
    pt.focus({ preventScroll: true })
    closePop = (saved = false) => {
      pop.hidden = true; marks.forEach(m => m.classList.remove('on')); closePop = () => {}
      if (saved) onSave(pt.value.trim()); else onCancel()
      if (!comments.length) delete box.dataset.keep
    }
  }
  save.onclick = () => closePop(true)
  cancel.onclick = () => closePop()
  pt.onkeydown = e => {
    if (e.key === 'Escape') closePop()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) closePop(true)
  }

  const floater = btn('primary float-comment', 'chat-circle', 'Comment'); floater.hidden = true
  floater.onmousedown = e => e.preventDefault() // keep the selection
  floater.onclick = () => {
    const sel = getSelection(), quote = String(sel), marks = markRange(sel.getRangeAt(0))
    sel.removeAllRanges()
    if (!marks.length) { floater.hidden = true; return }
    openPop(marks, '', v => v ? addComment(quote, marks, v) : unmark(marks), () => unmark(marks))
  }
  const placeFloater = () => {
    const sel = getSelection()
    if (!pop.hidden || sel.isCollapsed || !sel.rangeCount || !doc.contains(sel.anchorNode) || !String(sel).trim()) { floater.hidden = true; return }
    const r = sel.getRangeAt(0).getBoundingClientRect(), o = box.getBoundingClientRect()
    floater.style.left = `${r.left + r.width / 2 - o.left}px`; floater.style.top = `${r.top - o.top - 8}px`
    floater.hidden = false
  }
  doc.addEventListener('mouseup', () => setTimeout(placeFloater))
  doc.addEventListener('keyup', placeFloater)
  doc.addEventListener('touchend', () => setTimeout(placeFloater, 50))

  const instructions = S.playbooks.find(x => x.name === p.playbook)?.md?.sections?.find(s => s.name === gate.phase)?.body
  const general = btn('quiet', 'plus', 'Comment on the whole')
  general.onclick = () => addComment('')
  const ok = btn('primary', 'check', 'Approve'), back = btn('', 'arrow-u-up-left', 'Send back'), msg = $('div', 'tag')
  const hint = $('p', 'ask', 'You have comments, so this goes back. To approve instead, remove them.')
  // Comments mean "change this": Approve leaves while there are any, so the one big button
  // is the one that sends them. Approving with comments on the page dropped them silently.
  const sync = () => {
    const n = comments.filter(c => c.text()).length, held = gate.fix && comments.length > 0
    back.lastChild.textContent = n ? `Send back with ${n} comment${n > 1 ? 's' : ''}` : 'Send back'
    back.disabled = !n || !gate.fix
    back.className = held ? 'primary' : ''
    ok.hidden = held; hint.hidden = !held
  }
  const act = async (fn, done) => {
    ok.disabled = back.disabled = true; msg.className = 'tag'; msg.textContent = 'Saving…'
    try { await fn(); delete box.dataset.keep; toast(done); location.hash = `#/a/${encodeURIComponent(p.name)}/progress`; await refresh(); render() } catch (e) { msg.className = 'tag err'; msg.textContent = e.message; ok.disabled = false; sync() }
  }
  ok.onclick = () => {
    act(() => api('/api/approve', { method: 'POST', body: { project: p.name, phase: gate.phase, then: 'auto' } }),
      p.phases[at + 1] ? `Approved. Next: ${stepName(p.phases[at + 1]).toLowerCase()}.` : 'Approved. All done.')
  }
  back.onclick = () => {
    const items = comments.filter(c => c.text()).map(c => (c.quote ? `“${c.quote}”: ` : '') + c.text())
    act(() => api('/api/reject', { method: 'POST', body: { project: p.name, phase: gate.phase, items, then: 'auto' } }),
      `Sent back with ${items.length} comment${items.length > 1 ? 's' : ''}. Every one gets an answer.`)
  }
  const v = $('div', 'verdict'); v.append(ok, back, hint, msg)
  if (!gate.fix) v.append($('p', 'ask', 'This review can only be approved here. To send work back, use Admin.'))
  let what = null
  if (instructions) { what = $('details', 'more'); const s = $('summary'); s.append(icon('caret-right'), document.createTextNode('What this review is for')); what.append(s, md(instructions)) }
  const aside = card(stepName(gate), 'Select any passage to comment on it. Each comment becomes one numbered change that must be answered.', null, pad(list, general, v, what))
  aside.classList.add('side-card')
  sync()
  box.append(doc, aside, floater, pop)
  return box
}

function progressPanel (p) {
  const rows = []
  p.phases.forEach((ph, i) => {
    const st = ph.state === 'done' ? { key: 'done', label: 'Done', icon: 'check-circle' }
      : p.next?.phase === ph.phase ? status(p)
        : ph.state === 'running' ? { key: 'work', label: 'Working', icon: 'circle-notch' } : { key: 'queued', label: ph.hasSummary ? 'Earlier version' : 'Not yet', icon: 'circle' }
    const r = $('tr'), name = $('td'), more = $('tr'), cell = $('td'); cell.colSpan = 4
    name.append($('span', 't', stepName(ph)))
    r.append(td('idx', String(i + 1)), name, td('', tagOf(st)), td('dim hide-sm', ph.fails ? String(ph.fails) : ''))
    more.hidden = true; more.append(cell)
    if (ph.hasSummary) {
      name.append($('span', 'k', 'Show what it wrote'))
      r.tabIndex = 0
      const open = async () => {
        more.hidden = !more.hidden
        if (!more.hidden && !cell.dataset.l) { cell.dataset.l = '1'; cell.append($('div', 'skel')); const m = md(await fileText(`${p.mem}/phases/${ph.phase}.md`).catch(e => e.message)); cell.textContent = ''; cell.append(m) }
      }
      r.onclick = open; r.onkeydown = e => { if (e.key === 'Enter') open() }
    } else r.style.cursor = 'default'
    rows.push(r, more)
  })
  return card('Progress', 'Every step in order. Open a finished one to read what it wrote.', null,
    table([['#', 'idx'], ['Step', ''], ['Status', ''], ['Fix rounds', 'hide-sm']], rows, ''))
}

function briefPanel (p) {
  const b = $('div'); b.append($('div', 'skel'), $('div', 'skel'))
  fileText(`${p.mem}/brief.md`).then(t => { b.textContent = ''; b.append(md(t.replace(/^# Brief\s*/, ''))) })
    .catch(e => { b.textContent = ''; b.append(note('err', 'warning-circle', e.message)) })
  return card('Brief', 'What every step reads first.', withIcon(link(`/admin#/project/${encodeURIComponent(p.name)}/brief`, 'btn'), 'note-pencil', 'Edit in Admin'), pad(b))
}

/* ---------- adjusting a playbook ---------- */
/* When a playbook's results do not come out as wished, say what should be different. The
   AI rewrites a copy of the playbook; you see what it changed and apply it, or not. */
const adjustments = () => S.pending.drafts.filter(d => S.playbooks.some(p => p.name === d.name))

function adjustView (name, from) {
  const pb = S.playbooks.find(x => x.name === name), p = S.projects.find(x => x.name === from)
  const crumbs = [pb ? [pb.area, areaHref(pb.area), 'folder'] : ['Projects', '#/articles', 'files'], ...(p ? [[titleOf(p), `#/a/${encodeURIComponent(p.name)}`]] : []), [`Adjust: ${typeOf(name)}`]]
  if (!pb) return frame(crumbs, [], card('Not found', '', null, empty('magnifying-glass', 'No such playbook', `There is no playbook called ${name}.`, link('#/articles', 'btn', 'All projects'))))
  const h = head(`Adjust: ${typeOf(name)}`, 'Say what should be different next time. The AI rewrites a copy of the steps, and nothing changes until you have seen it and apply it.')
  const d = adjustments().find(x => x.name === name)
  if (!d) return frame(crumbs, [], h, watchingNote(), askCard(name, p))
  if (d.pending) {
    return frame(crumbs, [], h, watchingNote(), card('The AI is on it', '', null,
      empty('circle-notch', 'Rewriting the steps', 'A window may open on the Mac with a question or two. Answer it there. The changes show up here when it is done.')))
  }
  const body = $('div'); body.append($('div', 'skel'), $('div', 'skel'))
  api(`/api/draft?name=${encodeURIComponent(name)}`).then(x => { body.textContent = ''; body.append(...changes(x, p)) })
    .catch(e => { body.textContent = ''; body.append(note('err', 'warning-circle', e.message)) })
  return frame(crumbs, [], h, watchingNote(), body)
}

function askCard (name, p, again = false) {
  const t = keep($('textarea')); t.rows = 4; t.setAttribute('aria-label', 'What should change')
  t.placeholder = again ? 'What else should change?' : 'For example: the introductions are too long, and every result should end with a short FAQ.'
  const go = btn('primary', 'magic-wand', again ? 'Ask for more changes' : 'Adjust with AI'), msg = $('div', 'tag')
  go.onclick = async () => {
    if (!t.value.trim()) { msg.className = 'tag err'; msg.textContent = 'Say what should change'; return }
    go.disabled = true; msg.className = 'tag'; msg.textContent = ''
    // Which project prompted it, so the AI can read what that one produced.
    const about = p ? `\n\nThis came up on "${titleOf(p)}" (project ${p.name}).` : ''
    try {
      await api('/api/draft', { method: 'POST', body: { name, description: t.value.trim() + about, adjust: true } })
      delete t.dataset.keep; toast('Asked. The AI is rewriting the steps.'); await refresh(); render()
    } catch (e) { msg.className = 'tag err'; msg.textContent = e.message; go.disabled = false }
  }
  const bar = $('div', 'bar'); bar.append(go, msg)
  return card(again ? 'Not quite right?' : 'What should change', again ? 'The AI reads its copy first and changes it again.' : '', null, pad(t, bar))
}

/* What the copy changes, step by step, and the three ways out. */
function changes (d, p) {
  const out = [], changed = d.phases.filter(ph => ph.change)
  const errors = d.problems.filter(x => x.level === 'error')
  const nothing = !changed.length && !d.removed.length && !d.alsoChanged.length
  const rows = changed.map(ph => {
    const r = $('tr'), name = $('td'), more = $('tr'), cell = $('td'); cell.colSpan = 2
    name.append($('span', 't', stepName(ph)), $('span', 'k', 'Show the new instructions'))
    r.append(name, td('', tagOf(ph.change === 'new' ? { key: 'work', label: 'New step', icon: 'plus' } : { key: 'you', label: 'Changed', icon: 'pencil-simple' })))
    more.hidden = true; cell.append(md(ph.section || 'No instructions.')); more.append(cell)
    r.tabIndex = 0; r.onclick = () => { more.hidden = !more.hidden }; r.onkeydown = e => { if (e.key === 'Enter') r.onclick() }
    return [r, more]
  }).flat()
  for (const n of d.removed) { const r = $('tr'); r.style.cursor = 'default'; r.append(td('', $('span', 't', human(n))), td('', tagOf({ key: 'stuck', label: 'Removed', icon: 'minus' }))); rows.push(r) }
  const parts = [nothing ? note('', 'info', 'The copy is the same as the playbook in use. Ask for the change again below, in other words.') : null,
    d.alsoChanged.length ? note('', 'info', `Also changes ${d.alsoChanged.join(', ')}.`) : null,
    ...errors.map(e => note('err', 'warning-circle', `It cannot be applied yet: ${e.msg}. Ask for more changes below to fix it.`))]
  const fresh = d.roles.filter(r => !S.roles.some(x => x.role === r.name)).map(r => human(r.name).toLowerCase())
  if (fresh.length) parts.push(note('', 'info', `It adds a new kind of agent: ${fresh.join(', ')}. It starts on the default model, and Admin can change that.`))
  const busy = S.projects.filter(x => x.playbook === d.name && x.next && x.phases.some(ph => ph.state === 'done'))
  if (busy.length) parts.push(note('warn', 'warning-circle', `${busy.length} project${busy.length > 1 ? 's are' : ' is'} partway through this playbook. Their next steps follow the new version.`))
  out.push(card('What changes', 'Open a step to read what it will be told.', null, rows.length ? table([['Step', ''], ['', '']], rows, '') : null, pad(...parts)))

  const apply = btn('primary', 'check', 'Apply changes'), drop = btn('quiet', 'trash', 'Discard'), msg = $('div', 'tag')
  apply.disabled = nothing || !!errors.length
  const back = () => { location.hash = p ? `#/a/${encodeURIComponent(p.name)}` : '#/' }
  apply.onclick = async () => {
    apply.disabled = drop.disabled = true
    try { await api('/api/draft-install', { method: 'POST', body: { name: d.name } }); toast(`Applied. The next ${typeOf(d.name)} steps use it.`); back(); await refresh(); render() } catch (e) { msg.className = 'tag err'; msg.textContent = e.message; apply.disabled = drop.disabled = false }
  }
  let sure = false
  drop.onclick = async () => {
    if (!sure) { sure = true; drop.lastChild.textContent = 'Discard: nothing changes'; return }
    drop.disabled = true
    try { await api('/api/draft', { method: 'DELETE', body: { name: d.name, confirm: d.name } }); toast('Discarded. The playbook is as it was.'); await refresh(); render() } catch (e) { msg.className = 'tag err'; msg.textContent = e.message; drop.disabled = false }
  }
  const v = $('div', 'verdict'); v.append(apply, drop, msg)
  out.push(card('Apply it?', 'Applying changes the playbook for every project that uses it from now on.', null, pad(v)), askCard(d.name, p, true))
  return out
}

/* ---------- apps in the Studio (ui/main.js) ----------
   An installed app with ui/main.js adds pages here: its module's default export gets the
   kit below, and what it registers with route() and nav() renders like the Studio's own
   pages. Its code runs in this page with everything the Studio may do, which is why
   installing it asks for trust. It reads and stages through /api/app-read and
   /api/app-request, scoped on the server to its own projects and folder. */
const BASE_ROUTES = new Set(['', 'articles', 'area', 'new', 'a', 'adjust'])
const appRoutes = {}, appNavs = [], appExtensions = createExtensions()
function kit (app) {
  const post = (path, body) => api(path, { method: 'POST', body: { app: app.name, ...body } })
  return {
    app: app.name,
    provide: (slot, render) => appExtensions.provide(app.name, slot, render),
    contributions: (slot, context) => appExtensions.render(slot, context),
    get state () { return S },
    refresh, render,
    /** #/<key>/<slug>/<sub>/<rest> renders fn(slug, sub, rest); active(slug) names the nav item it lights up. */
    route (key, fn, active = slug => slug ? `${key}:${slug}` : key) {
      if (BASE_ROUTES.has(key) || appRoutes[key]) return console.error(`app ${app.name}: the route '${key}' is taken`)
      appRoutes[key] = { fn, active }
    },
    /** A sidebar group; items() is called on every render: [{ href, label, icon, key, n }]. */
    nav (group) { appNavs.push({ app: app.name, ...group }) },
    /** Many files or folders in one call; where: 'work' (the workspace), 'memory' (the project's memory folder) or 'app'. */
    read: (project, paths, where = 'work') => post('/api/app-read', { project, paths, where }).then(r => r.files),
    request: (project, file, body = {}) => post('/api/app-request', { project, file, ...body }),
    create: (name, files = {}) => post('/api/app-request', { new: name, files }),
    frame, head, card, pad, table, td, rowLink, empty, toast, note, keep, link, withIcon, btn, tagOf, watchingNote, human, ago,
    $, icon, md, graphView, readB64,
    // The rest of the cockpit, for an app that builds on the Studio's own pages (clients).
    api, upload, inputsForm, projectTable, sorted, status, titleOf, clientName, newButton
  }
}
async function loadApps () {
  for (const a of S.apps.filter(x => x.main)) {
    try { (await import(`/apps/${encodeURIComponent(a.name)}/main.js`)).default(kit(a)) } catch (e) { console.error(`app ${a.name}: ${e.message}`) }
  }
}
/** A staged project of an app's kind (an academy workspace) is the app's to show, not a project's. */
const ofKind = n => S.apps.some(a => a.kind && a.kind === n.playbook)

/* ---------- routing and live updates ---------- */
function renderNav (active) {
  nav.textContent = ''
  const you = S.projects.filter(p => status(p).key === 'you').length
  const item = (href, label, ico, key, n, nCls = '') => {
    const a = link(href, 'nav-item'); a.append(icon(ico), $('span', 'label', label))
    if (n) a.append($('span', `n ${nCls}`, String(n)))
    if (key === active) a.setAttribute('aria-current', 'page')
    return a
  }
  const group = (label, cls, ...items) => { const g = $('div', `group ${cls}`); if (label) g.append($('span', '', label)); g.append(...items); return g }
  const waits = area => S.projects.filter(p => areaOf(p.playbook) === area && status(p).key === 'you').length
  nav.append(group('', '',
    item('#/', 'Overview', 'house', 'home', you, 'you'),
    item('#/articles', 'All projects', 'files', 'articles', S.projects.length)))
  nav.append(group('Areas', 'areas', ...areas().map(a => item(areaHref(a), a, 'folder', `area:${toSlug(a)}`, waits(a), 'you'))))
  for (const g of appNavs) {
    try { nav.append(group(g.label, g.app, ...g.items().map(i => item(i.href, i.label, i.icon, i.key, i.n)))) } catch (e) { console.error(`app ${g.app}: ${e.message}`) }
  }
}

function render (opts = {}) {
  const [, key = '', arg = '', sub = '', rest = ''] = location.hash.split('/')
  const slug = decodeURIComponent(arg)
  // A project, its adjustment and a New form opened from an area light up that area.
  const inArea = key === 'a' ? S.projects.find(p => p.name === slug)?.playbook && `area:${toSlug(areaOf(S.projects.find(p => p.name === slug).playbook))}`
    : key === 'adjust' ? `area:${toSlug(areaOf(slug))}` : key === 'new' && areas().some(a => toSlug(a) === slug) ? `area:${slug}` : ''
  const active = inArea || appRoutes[key]?.active(slug) || { '': 'home', articles: 'articles', area: `area:${slug}`, new: 'new' }[key] || 'home'
  renderNav(active)
  let el
  try {
    el = appRoutes[key] ? appRoutes[key].fn(slug, decodeURIComponent(sub), decodeURIComponent(rest))
      : key === 'new' ? newProject(slug)
      : key === 'a' ? projectView(slug, sub)
        : key === 'adjust' ? adjustView(slug, decodeURIComponent(sub))
        : key === 'articles' ? projectsView()
        : key === 'area' ? projectsView(slug)
          : overview()
  } catch (e) { el = frame([['Studio']], [], note('err', 'warning-circle', e.message)) }
  view.textContent = ''; view.append(el)
  if (opts.keepScroll == null) scrollTo(0, 0); else scrollTo(0, opts.keepScroll)
}

async function refresh () { S = await api('/api/state') }

search.addEventListener('input', () => {
  query = search.value
  if (!location.hash.startsWith('#/articles')) location.hash = '#/articles'
  else render({ keepScroll: scrollY })
})

let fresh = null
function live () {
  if (typeof EventSource !== 'function') return
  // Also on every (re)connect and whenever the tab is looked at again: a change made while
  // the stream was down — a laptop asleep, the cockpit rebuilt — sends no event of its own.
  const es = new EventSource('/api/events')
  addEventListener('visibilitychange', () => { if (!document.hidden) es.onmessage() })
  es.onopen = () => es.onmessage()
  es.onmessage = async () => {
    let next
    try { next = await api('/api/state') } catch { return }
    // Most events change nothing shown here: an agent saving a working file mid-step.
    // Rebuilding for those reset the page under you every few seconds.
    if (JSON.stringify(next) === JSON.stringify(S)) return
    // Never rebuild under someone's hands: a half-written comment or form stays put, and
    // so does a passage selected to comment on.
    const typing = document.activeElement?.matches('input, textarea, select') && document.activeElement !== search
    if (document.querySelector('[data-keep]') || typing || String(getSelection() || '').trim()) {
      if (fresh) return
      fresh = btn('primary fresh', 'arrows-clockwise', 'Updated. Refresh')
      fresh.onclick = async () => { fresh.remove(); fresh = null; await refresh(); render({ keepScroll: scrollY }) }
      document.body.append(fresh); return
    }
    // An app's ui/main.js was imported once; a module cannot be imported again, so a new,
    // updated or removed app reloads the page to load its code as it now is.
    if (appCode(next) !== appCode(S)) return location.reload()
    S = next; render({ keepScroll: scrollY })
  }
}
const appCode = st => JSON.stringify(st.apps.filter(a => a.main).map(a => [a.name, a.lock?.commit, a.version]))

addEventListener('hashchange', () => { if (fresh) { fresh.remove(); fresh = null } render() })
view.append($('div', 'skel'), $('div', 'skel'), $('div', 'skel'))
refresh().then(loadApps).then(() => { render(); live() }).catch(e => { view.textContent = ''; view.append(note('err', 'warning-circle', `The Studio could not reach its server: ${e.message}`)) })
