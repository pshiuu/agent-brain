/* What both front ends share: the Studio (index.html, for the people who write) and
   Admin (admin.html, the engine room). Classic scripts, loaded before each app's own, so
   these are plain globals there — no build step, same as the rest of the cockpit. */
const $ = (h, c, t) => { const e = document.createElement(h); if (c) e.className = c; if (t != null) e.textContent = t; return e }
const frag = (...n) => { const f = document.createDocumentFragment(); for (const x of n) if (x) f.append(x); return f }
/* Light or dark. The page follows the system until you flip the Dark mode switch, then
   keeps your choice in this browser for both apps. shared.js loads in <head> so this
   runs before the first paint, and a reload never flashes the other theme first. */
const THEME_KEY = 'brain-theme'
try { const t = localStorage.getItem(THEME_KEY); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t } catch {}
addEventListener('DOMContentLoaded', () => {
  const sw = document.getElementById('theme'), sys = matchMedia('(prefers-color-scheme: dark)')
  if (!sw) return
  const sync = () => { const t = document.documentElement.dataset.theme; sw.checked = t ? t === 'dark' : sys.matches }
  sync(); sys.addEventListener('change', sync)
  sw.onchange = () => {
    const t = sw.checked ? 'dark' : 'light'
    document.documentElement.dataset.theme = t
    try { localStorage.setItem(THEME_KEY, t) } catch {}
  }
})

/** A Phosphor glyph from vendor/phosphor, decorative: the text beside it is the label. */
const icon = (name, cls = '') => { const i = $('i', `ph ph-${name}${cls ? ' ' + cls : ''}`); i.setAttribute('aria-hidden', 'true'); return i }

const api = async (path, opts) => {
  const r = await fetch(path, opts && { method: opts.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) })
  const d = await r.json().catch(() => ({ error: r.statusText }))
  if (!r.ok) throw Object.assign(new Error(d.error || 'request failed'), { status: r.status })
  return d
}

/* Minimal renderer for the markdown subset these files actually use. Escapes first,
   so nothing in a role doc or an agent-written summary can inject markup. */
function md (src) {
  src = (src || '').replace(/<!--[\s\S]*?-->/g, '')
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  const out = []; let list = null, fence = null, para = [], rows = null
  /* Markdown joins soft-wrapped lines into one paragraph. One <p> per source line turned
     every hard-wrapped sentence in a playbook section or phase summary into its own block. */
  const flushP = () => { if (para.length) { out.push(`<p>${para.join(' ')}</p>`); para = [] } }
  /* Pipe tables. The phase summaries this UI exists to read are full of them (crawl.md's
     page inventory, brand.md's palette), and without this they are the one thing the
     paragraph join above makes worse: every row merges into one run-on line. */
  const flushT = () => {
    if (!rows) return
    const head = rows.head ? `<thead><tr>${rows.head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : ''
    const body = rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
    out.push(`<table>${head}<tbody>${body}</tbody></table>`)
    rows = null
  }
  for (const line of src.split('\n')) {
    if (line.startsWith('```')) {
      flushP(); flushT()
      if (fence) { out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`); fence = null } else fence = []
      continue
    }
    if (fence) { fence.push(line); continue }
    if (/^\s*\|/.test(line)) {
      flushP()
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
      if (!rows) rows = []
      // The |---|---| separator promotes the row above it to the header.
      if (cells.length && cells.every(c => /^:?-+:?$/.test(c))) rows.head = rows.pop()
      else rows.push(cells)
      continue
    }
    flushT()
    const h = line.match(/^(#{1,4})\s+(.*)$/), li = line.match(/^\s*[-*]\s+(.*)$/), ol = line.match(/^\s*\d+\.\s+(.*)$/)
    const close = () => { flushP(); if (list) { out.push(`</${list}>`); list = null } }
    if (h) { close(); out.push(`<h${Math.min(h[1].length + 1, 4)}>${inline(h[2])}</h${Math.min(h[1].length + 1, 4)}>`) }
    else if (li || ol) {
      flushP()
      const want = li ? 'ul' : 'ol'
      if (list !== want) { close(); out.push(`<${want}>`); list = want }
      out.push(`<li>${inline((li || ol)[1])}</li>`)
    } else if (!line.trim()) close()
    else { if (list) close(); para.push(inline(line)) }
  }
  if (fence) out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`)
  flushP(); flushT()
  if (list) out.push(`</${list}>`)
  const d = $('div', 'prose'); d.innerHTML = out.join(''); return d
}

const cmd = text => {
  const w = $('div', 'cmd'), c = $('code', 'mono', text), b = $('button', '', 'copy')
  b.onclick = async () => { await navigator.clipboard.writeText(text).catch(() => {}); b.textContent = 'copied'; setTimeout(() => (b.textContent = 'copy'), 1200) }
  w.append(c, b); return w
}

// Same rule as ui/brain.mjs toSlug, which slugs the name again on the server.
// Letters with accents keep their sound: Wärmepumpe is waermepumpe, café is cafe.
const toSlug = s => String(s || '').trim().toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
// Same rule as ui/brain.mjs normUrl: people paste example.com/page, and that is fine.
const normUrl = raw => {
  const t = String(raw || '').trim()
  if (!t || /\s/.test(t) || /^[a-z][a-z0-9+-]*:(?!\/\/)/i.test(t)) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`)
    return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') && !u.username && !u.password ? u.href : null
  } catch { return null }
}
const readB64 = f => new Promise((ok, no) => {
  if (f.size > 7e6) return no(new Error(`${f.name} is over 7 MB. Copy it into the sources folder yourself`))
  const r = new FileReader()
  r.onload = () => ok(String(r.result).split(',')[1] || '')
  r.onerror = () => no(new Error(`could not read ${f.name}`))
  r.readAsDataURL(f)
})
const upload = async (f, where) => api('/api/source', { method: 'POST', body: { name: f.name, data: await readB64(f), ...where } })

/** One field for one input. check() is the message that stops the form, or ''. */
function inputField (inp, value = '', { readonly = false, onchange = null } = {}) {
  const w = $('div', 'field'), id = `in-${inp.per}-${inp.name}`
  const l = $('label', '', inp.label); l.htmlFor = id
  if (!inp.required) l.append($('span', 'opt', ' optional'))
  w.append(l)
  const status = $('div', 'tag')
  let ctl, get, check = () => ''
  if (inp.type === 'choice') {
    ctl = $('select')
    ctl.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Choose one' }))
    for (const o of inp.options) ctl.append(Object.assign(document.createElement('option'), { value: o, textContent: o, selected: o === value }))
    get = () => ctl.value
  } else if (inp.type === 'files') {
    ctl = Object.assign(document.createElement('input'), { type: 'file', multiple: true })
    const have = Array.isArray(value) ? value : []
    if (have.length) status.textContent = `on file: ${have.join(', ')}`
    get = () => [...ctl.files]
    value = have.length ? have : ''
  } else if (inp.type === 'longtext' || inp.type === 'urls') {
    ctl = document.createElement('textarea'); ctl.rows = 3; ctl.value = value || ''
    if (inp.type === 'urls') ctl.placeholder = 'One web address per line. example.com/page is fine.'
    get = () => ctl.value
  } else {
    ctl = Object.assign(document.createElement('input'), { type: inp.type === 'number' ? 'number' : 'text', value: value || '' })
    if (inp.type === 'url') { ctl.inputMode = 'url'; ctl.placeholder = 'example.com/page' }
    get = () => ctl.value
  }
  ctl.id = id
  if (inp.type === 'url' || inp.type === 'urls') {
    check = () => {
      const tokens = String(get()).split(/\s+/).filter(Boolean)
      const bad = tokens.filter(t => !normUrl(t))
      if (inp.type === 'url' && tokens.length > 1) return `${inp.label}: one web address only`
      return bad.length ? `${inp.label}: not a web address: ${bad.slice(0, 3).map(b => `'${b}'`).join(', ')}` : ''
    }
    const show = () => {
      const n = String(get()).split(/\s+/).filter(Boolean).length, err = check()
      status.className = err ? 'tag err' : 'tag'
      status.textContent = err || (inp.type === 'urls' && n ? `${n} address${n > 1 ? 'es' : ''}` : '')
    }
    ctl.addEventListener('input', show); show()
  }
  const required = () => {
    const v = get()
    return inp.required && !(Array.isArray(v) ? v.length || (Array.isArray(value) && value.length) : String(v).trim()) ? `${inp.label} is required` : ''
  }
  if (onchange) ctl.addEventListener('input', onchange)
  if (readonly) ctl.disabled = true
  w.append(ctl, status)
  return { el: w, inp, get, check: () => check() || required() }
}

/** A form of typed fields. values() for the answers, files() for the picked files. */
function inputsForm (inputs, values = {}, opts = {}) {
  const el = $('div', 'fields')
  const fields = inputs.map(i => inputField(i, values[i.name], opts))
  for (const f of fields) el.append(f.el)
  return {
    el,
    values: () => Object.fromEntries(fields.filter(f => f.inp.type !== 'files').map(f => [f.inp.name, f.get()])),
    files: () => Object.fromEntries(fields.filter(f => f.inp.type === 'files').map(f => [f.inp.name, f.get()])),
    check: () => fields.map(f => f.check()).find(Boolean) || ''
  }
}

/* A Copy button. With `html` the clipboard gets rich text and plain text side by side:
   a CMS rich-text field takes the first, anything else the second. */
function copyButton (label, text, html = '') {
  const b = $('button', '', label)
  b.onclick = async () => {
    try {
      if (html) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })])
      } else await navigator.clipboard.writeText(text)
      b.textContent = 'Copied'
    } catch { b.textContent = 'Not copied. Select it by hand' }
    setTimeout(() => (b.textContent = label), 1500)
  }
  return b
}

/* What a person pastes into their CMS (Webflow, for now), rebuilt from content/article.md
   on every open, so a fix round or an edit by hand is in the next copy. Nothing here signs
   in anywhere. */
function articleBlock (p, { intro = true } = {}) {
  const box = $('div'), out = $('div')
  if (intro) box.append($('p', 'sub', 'Built from content/article.md each time you open this tab. Copy each field into the CMS item, then the body into its rich-text field.'))
  box.append(out)
  out.append($('div', 'skel'))
  api(`/api/article?project=${encodeURIComponent(p.name)}`).then(a => {
    out.textContent = ''
    const f = a.fields, defs = $('div', 'defs')
    for (const [label, value] of [['Name', f.title], ['Slug', f.slug], ['Meta title', f.meta_title], ['Meta description', f.meta_description], ['Summary', f.summary], ['Author', f.author], ['Updated', f.updated]]) {
      const d = $('div', 'def')
      d.append($('b', '', label), $('span', value ? '' : 'sub', value || 'missing'))
      if (value) d.append(copyButton('Copy', value))
      defs.append(d)
    }
    out.append($('h2', '', 'Fields'), defs)

    // The body is our own converter's output: every text escaped, links only http(s) or
    // root-relative, so it is rendered as markup rather than shown as source.
    const body = $('div', 'prose article-body'); body.innerHTML = a.body
    const bar = $('div', 'bar'); bar.append(copyButton('Copy body', body.innerText, a.body))
    out.append($('h2', '', 'Body'), $('p', 'sub', 'Paste into the rich-text field. If an image does not come across, add it there by hand from the list below.'), bar, body)

    if (a.images.length) {
      const defs = $('div', 'defs')
      for (const i of a.images) {
        const d = $('div', 'def'), link = $('a', '', 'Open file')
        link.href = i.url; link.target = '_blank'; link.rel = 'noopener noreferrer'
        d.append($('span', '', i.alt), copyButton('Copy alt text', i.alt), link, $('span', 'sub', i.credit))
        defs.append(d)
      }
      out.append($('h2', '', 'Images'), $('p', 'sub', 'Download each file and upload it to the CMS with its alt text. The first one is the main image. Keep the credit with the picture: the licence asks for it.'), defs)
    }
    if (a.tables.length) {
      out.append($('h2', '', 'Tables'), $('p', 'sub', "Rich-text fields usually have no tables. Add an embed where each one goes and paste its HTML."))
      a.tables.forEach((t, n) => { const bar = $('div', 'bar'); bar.append(copyButton(`Copy table ${n + 1}`, t)); out.append(bar) })
    }
    const bar2 = $('div', 'bar'); bar2.append(copyButton('Copy schema', a.schema))
    out.append($('h2', '', 'Schema'), $('p', 'sub', "Article and FAQ structured data. Paste into the page's custom code (before </body>) or an Embed in the post template."), bar2, $('pre', 'plain', a.schema))
  }).catch(e => { out.textContent = ''; out.append($('div', 'note err', e.message)) })
  return box
}

/* Start a project the way both front ends do: the client's answers and files into its
   profile first (every project for that client reuses them), then this project's files
   into staging, then the request — the last write, which is what `brain watch` acts on. */
async function submitProject ({ playbook, name, client = '', projectForm = null, clientForm = null, brief = {}, then = '' }, status = () => {}) {
  if (clientForm) {
    status('saving the client')
    await api('/api/client-inputs', { method: 'POST', body: { client, playbook, values: clientForm.values() } })
    for (const [input, picked] of Object.entries(clientForm.files())) {
      for (const f of picked) { status(`uploading ${f.name}`); await upload(f, { client, playbook, input }) }
    }
  }
  const files = {}, slug = toSlug(name)
  for (const [input, picked] of Object.entries(projectForm?.files() || {})) {
    files[input] = []
    for (const f of picked) { status(`uploading ${f.name}`); files[input].push((await upload(f, { staged: slug })).name) }
  }
  status('starting')
  return api('/api/project', { method: 'POST', body: { playbook, name, client, then, values: projectForm?.values() || {}, files, brief } })
}


/* An interactive force-directed graph in SVG, for the academy workspaces (Studio) and the
   brain's own knowledge/ (Admin). No library. Search for a node; click one to select it —
   its neighbours light up and the panel lists its links, each a step to the next node, with
   Back to retrace the path; drag a node and the graph follows it; scroll to zoom, drag the
   background to pan. Double-click (or Open in the panel) runs open(node).
   g = { nodes: [{ id, type, label, title?, rating?, status?, discovery?, degree }],
         edges: [{ source, target, rel, discovery?, inferred? }], flags: [{ id, text }] } */
function graphView (g, { open = () => {}, height = 600, openLabel = 'Open' } = {}) {
  const NS = 'http://www.w3.org/2000/svg', svgEl = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e }
  const wrap = $('div', 'graph'), bar = $('div', 'graph-bar'), stage = $('div', 'graph-stage'), legend = $('div', 'graph-legend')
  const panel = $('aside', 'graph-panel'); panel.hidden = true
  const flagText = new Map(); for (const f of g.flags || []) flagText.set(f.id, [...(flagText.get(f.id) || []), f.text || ''])
  const byId = new Map(g.nodes.map(n => [n.id, n]))
  const hasRating = g.nodes.some(n => n.rating), hasDiscovery = g.nodes.some(n => n.discovery)
  const pos = new Map(), K = 42
  let colorBy = 'type', showDiscovery = false, selected = null, history = [], view = null, nodes = [], edges = [], els = new Map(), lineEls = [], vb = null, svg = null

  // ---- controls: search, colour, discovery, zoom ----
  const search = Object.assign(document.createElement('input'), { type: 'text', placeholder: `Search ${g.nodes.length} nodes…` })
  search.className = 'graph-search'; search.setAttribute('aria-label', 'Search the graph')
  const hits = $('div', 'graph-hits'); hits.hidden = true
  const sbox = $('div', 'graph-find'); sbox.append(search, hits)
  bar.append(sbox)
  if (hasRating) {
    const sel = $('select'); sel.setAttribute('aria-label', 'Colour by')
    for (const [v, t] of [['type', 'Colour by kind'], ['rating', 'Colour by rating']]) sel.append(Object.assign(document.createElement('option'), { value: v, textContent: t }))
    sel.onchange = () => { colorBy = sel.value; paint() }
    bar.append(sel)
  }
  if (hasDiscovery) {
    const l = $('label', 'check'), c = Object.assign(document.createElement('input'), { type: 'checkbox' })
    c.onchange = () => { showDiscovery = c.checked; build() }
    l.append(c, document.createTextNode(' Discovery layer (graphify — suggestions, not evidence)'))
    bar.append(l)
  }
  const zoomBar = $('div', 'graph-zoom')
  const zb = (label, title, fn) => { const b = $('button', 'btn', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.onclick = fn; zoomBar.append(b); return b }
  zb('+', 'Zoom in', () => zoomBy(1 / 1.3)); zb('−', 'Zoom out', () => zoomBy(1.3)); zb('Fit', 'Fit the whole graph', () => fit(true))

  // ---- physics: Fruchterman–Reingold with gravity, seeded on a spiral (same files, same picture) ----
  const tick = (temp, fixed) => {
    const d = new Map(nodes.map(v => [v.id, { x: 0, y: 0 }]))
    for (let i = 0; i < nodes.length; i++) {
      const a = pos.get(nodes[i].id), da = d.get(nodes[i].id)
      for (let j = i + 1; j < nodes.length; j++) {
        const b = pos.get(nodes[j].id), dx = a.x - b.x, dy = a.y - b.y, dist2 = Math.max(0.25, dx * dx + dy * dy), f = K * K / dist2
        const db = d.get(nodes[j].id)
        da.x += dx * f; da.y += dy * f; db.x -= dx * f; db.y -= dy * f
      }
    }
    for (const e of edges) {
      const a = pos.get(e.source), b = pos.get(e.target), dx = a.x - b.x, dy = a.y - b.y, f = Math.hypot(dx, dy) / K
      const ds = d.get(e.source), dt = d.get(e.target)
      ds.x -= dx * f; ds.y -= dy * f; dt.x += dx * f; dt.y += dy * f
    }
    for (const v of nodes) {
      if (v.id === fixed) continue
      const p = pos.get(v.id), dv = d.get(v.id)
      dv.x -= p.x * 0.08; dv.y -= p.y * 0.08
      const len = Math.max(0.01, Math.hypot(dv.x, dv.y)), step = Math.min(len, temp)
      p.x += dv.x / len * step; p.y += dv.y / len * step
    }
  }
  const settle = () => {
    let t = 60
    const fresh = nodes.filter(v => !pos.has(v.id))
    fresh.forEach((v, i) => { const n = pos.size + i; pos.set(v.id, { x: Math.cos(n * 2.39996) * 12 * Math.sqrt(n + 1), y: Math.sin(n * 2.39996) * 12 * Math.sqrt(n + 1) }) })
    if (!fresh.length) return
    const iters = nodes.length > 300 ? 150 : 300
    for (let it = 0; it < iters; it++) { tick(t); t = Math.max(1, t * 0.985) }
    // A node with no links drifts outward forever: pull stragglers in to the cluster's rim.
    const radii = nodes.map(v => Math.hypot(pos.get(v.id).x, pos.get(v.id).y)).sort((a, b) => a - b)
    const rim = Math.max(K * 2, (radii[Math.floor(radii.length * 0.9)] || 0) * 1.25)
    for (const v of nodes) { const p = pos.get(v.id), r = Math.hypot(p.x, p.y); if (r > rim) { p.x *= rim / r; p.y *= rim / r } }
  }

  // ---- view box: fit, zoom, animated centring ----
  const setVb = () => svg && svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`)
  const bounds = ids => {
    const ps = ids.map(id => pos.get(id)).filter(Boolean), pad = 50
    const xs = ps.map(p => p.x), ys = ps.map(p => p.y)
    const b = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad }
    const ratio = (stage.clientWidth || 900) / height // keep the stage's aspect, so nothing stretches
    if (b.w / b.h < ratio) { const w = b.h * ratio; b.x -= (w - b.w) / 2; b.w = w } else { const h = b.w / ratio; b.y -= (h - b.h) / 2; b.h = h }
    return b
  }
  let anim = 0
  const animateTo = target => {
    cancelAnimationFrame(anim)
    const from = { ...vb }, t0 = performance.now()
    const step = now => {
      const k = Math.min(1, (now - t0) / 350), e = 1 - Math.pow(1 - k, 3)
      vb = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e }
      setVb()
      if (k < 1) anim = requestAnimationFrame(step)
    }
    anim = requestAnimationFrame(step)
  }
  const fit = animated => { const b = bounds(nodes.map(n => n.id)); if (animated && vb) animateTo(b); else { vb = b; setVb() } }
  const zoomBy = f => { const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2; animateTo({ x: cx - vb.w * f / 2, y: cy - vb.h * f / 2, w: vb.w * f, h: vb.h * f }) }
  const focus = id => {
    const near = [id, ...neighbours(id).map(x => x.node.id)]
    const b = bounds(near), min = 900 // never zoom in so far that one node fills the screen
    if (b.w < min) { const s = min / b.w; b.x -= (b.w * s - b.w) / 2; b.y -= (b.h * s - b.h) / 2; b.w *= s; b.h *= s }
    // The panel covers the right of a wide stage: centre the neighbourhood in what is left.
    const sw = stage.clientWidth || 0
    if (sw > 720) b.x += b.w * (320 / sw) / 2
    animateTo(b)
  }
  const toGraph = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()) }

  // ---- neighbourhood, selection, navigation ----
  const neighbours = id => edges.filter(e => e.source === id || e.target === id)
    .map(e => ({ edge: e, out: e.source === id, node: byId.get(e.source === id ? e.target : e.source) }))
  const paint = () => {
    const near = selected ? new Set([selected, ...neighbours(selected).map(x => x.node.id)]) : null
    const q = search.value.trim().toLowerCase()
    for (const [id, el] of els) {
      const v = byId.get(id)
      const kind = colorBy === 'rating' ? `gr-${v.type === 'source' ? v.rating || 'none' : 'other'}` : `gn-${v.type}`
      el.setAttribute('class', ['gnode', kind, flagText.has(id) ? 'flagged' : '', id === selected ? 'sel' : '', near && !near.has(id) ? 'dim' : '',
        q && (v.label + ' ' + (v.title || '')).toLowerCase().includes(q) ? 'hit' : '', labelled(v) || id === selected || (near && near.has(id)) ? 'lab' : ''].filter(Boolean).join(' '))
    }
    for (const [l, e] of lineEls) {
      const on = !near || e.source === selected || e.target === selected
      l.setAttribute('class', `ge ge-${e.rel}${e.discovery ? ' ge-disc' : ''}${e.inferred ? ' ge-inf' : ''}${on ? '' : ' dim'}${near && on ? ' on' : ''}`)
    }
    legendFor()
  }
  const select = (id, { push = true, center = true } = {}) => {
    if (id && !els.has(id)) return
    if (push && selected && selected !== id) history.push(selected)
    selected = id
    paint(); renderPanel()
    if (id && center) focus(id)
  }
  const REL = { supports: ['supports', 'supported by'], contradicts: ['contradicts', 'contradicted by'], defines: ['defines', 'defined by'], extends: ['extends', 'extended by'],
    'uses-method': ['uses the method', 'method used by'], cites: ['cites', 'cited by'], link: ['links to', 'linked from'], from: ['comes from', 'source of'] }
  const renderPanel = () => {
    panel.textContent = ''
    if (!selected) { panel.hidden = true; return }
    panel.hidden = false
    const v = byId.get(selected), headRow = $('div', 'gp-head')
    const back = $('button', 'btn', '←'); back.type = 'button'; back.title = 'Back'; back.setAttribute('aria-label', 'Back to the previous node'); back.disabled = !history.length
    back.onclick = () => select(history.pop(), { push: false })
    const close = $('button', 'btn', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.onclick = () => { history = []; select(null) }
    headRow.append(back, $('span', 'gp-kind', v.discovery ? 'graphify idea' : v.type), close)
    panel.append(headRow, $('h3', '', v.label))
    if (v.title && v.title !== v.label) panel.append($('p', 'muted', v.title))
    const facts = [v.rating ? `rated ${v.rating}` : '', v.status ? `status: ${v.status}` : '', v.failed?.length ? `failed: ${v.failed.join(', ')}` : '', v.community != null && v.discovery ? `cluster ${v.community}` : ''].filter(Boolean)
    if (facts.length) panel.append($('p', 'gp-facts', facts.join(' · ')))
    for (const t of flagText.get(selected) || []) panel.append($('p', 'gp-flag', t))
    if (v.path) { const o = $('button', 'btn primary', openLabel); o.type = 'button'; o.onclick = () => open(v); panel.append(o) }
    const groups = new Map()
    for (const x of neighbours(selected)) {
      const words = REL[x.edge.rel] || [x.edge.rel, x.edge.rel], key = `${x.edge.discovery ? '~ ' : ''}${words[x.out ? 0 : 1]}`
      groups.set(key, [...(groups.get(key) || []), x])
    }
    if (!groups.size) panel.append($('p', 'muted', 'No links.'))
    for (const [rel, xs] of groups) {
      panel.append($('div', 'gp-rel', `${rel} · ${xs.length}`))
      const ul = $('ul', 'gp-list')
      for (const x of xs.sort((a, b) => a.node.label.localeCompare(b.node.label))) {
        const li = $('li'), b = $('button', `gp-node gn-${x.node.type}`); b.type = 'button'
        b.append($('i'), document.createTextNode(x.node.label + (x.node.rating ? ` (${x.node.rating})` : '')))
        b.onclick = () => select(x.node.id)
        b.onmouseenter = () => els.get(x.node.id)?.classList.add('peek'); b.onmouseleave = () => els.get(x.node.id)?.classList.remove('peek')
        li.append(b); ul.append(li)
      }
      panel.append(ul)
    }
  }
  const labelled = v => nodes.length <= 60 || (v.degree || 0) >= 3 || v.type === 'chapter' || v.type === 'draft'
  const legendFor = () => {
    legend.textContent = ''
    const kinds = colorBy === 'rating' ? ['A', 'B', 'C', 'D', 'none'].map(r => [`gr-${r}`, r === 'none' ? 'not rated' : `rated ${r}`]) : [...new Set(nodes.map(n => n.type))].map(t => [`gn-${t}`, t === 'idea' ? 'graphify idea' : t])
    for (const [cls, label] of kinds) { const s = $('span', `gkey ${cls}`); s.append($('i'), document.createTextNode(label)); legend.append(s) }
    if (flagText.size) { const s = $('span', 'gkey flagged'); s.append($('i'), document.createTextNode('needs a look')); legend.append(s) }
  }

  // ---- search: matches as you type, Enter or a click selects and centres ----
  const runSearch = () => {
    const q = search.value.trim().toLowerCase()
    hits.textContent = ''
    paint()
    if (!q) { hits.hidden = true; return }
    const found = nodes.filter(v => (v.label + ' ' + (v.title || '')).toLowerCase().includes(q))
      .sort((a, b) => (a.label.toLowerCase().startsWith(q) ? 0 : 1) - (b.label.toLowerCase().startsWith(q) ? 0 : 1) || (b.degree || 0) - (a.degree || 0)).slice(0, 8)
    hits.hidden = false
    if (!found.length) { hits.append($('div', 'muted', 'No match')); return }
    for (const v of found) {
      const b = $('button', `gp-node gn-${v.type}`); b.type = 'button'
      b.append($('i'), document.createTextNode(v.label)); b.onclick = () => { hits.hidden = true; select(v.id) }
      hits.append(b)
    }
  }
  search.oninput = runSearch
  search.onkeydown = e => {
    if (e.key === 'Enter') { const b = hits.querySelector('button'); if (b) b.click() }
    if (e.key === 'Escape') { search.value = ''; runSearch() }
  }

  // ---- build the SVG for the visible layer ----
  const build = () => {
    stage.textContent = ''; els = new Map(); lineEls = []
    nodes = g.nodes.filter(n => showDiscovery || !n.discovery)
    const ids = new Set(nodes.map(n => n.id))
    edges = g.edges.filter(e => ids.has(e.source) && ids.has(e.target))
    if (selected && !ids.has(selected)) { selected = null; history = [] }
    if (!nodes.length) { stage.append($('p', 'muted', 'Nothing to draw yet.')); return }
    settle()
    svg = svgEl('svg', { role: 'img', 'aria-label': `Graph of ${nodes.length} nodes and ${edges.length} links` })
    svg.style.height = `${height}px`
    const gE = svgEl('g'), gN = svgEl('g')
    for (const e of edges) {
      const l = svgEl('line'), t = svgEl('title'); t.textContent = e.rel; l.append(t)
      lineEls.push([l, e]); gE.append(l)
    }
    for (const v of nodes) {
      const r = 4 + Math.sqrt(v.degree || 0) * 2
      const grp = svgEl('g', { tabindex: 0 }), t = svgEl('title')
      t.textContent = `${v.label}${v.title && v.title !== v.label ? ` — ${v.title}` : ''}`
      const txt = svgEl('text', { x: r + 3, y: 4 }); txt.textContent = v.label.length > 34 ? v.label.slice(0, 33) + '…' : v.label
      grp.append(svgEl('circle', { r }), txt, t)
      grp.onkeydown = e => { if (e.key === 'Enter') select(v.id); if (e.key === 'o') open(v) }
      grp.ondblclick = () => open(v)
      grp.onpointerdown = e => startDrag(e, v.id)
      els.set(v.id, grp); gN.append(grp)
    }
    svg.append(gE, gN)
    stage.append(svg, zoomBar, panel)
    place(); paint(); renderPanel()
    fit(false)
    svg.onwheel = e => {
      e.preventDefault()
      const p = toGraph(e), f = e.deltaY > 0 ? 1.12 : 1 / 1.12
      vb = { x: p.x - (p.x - vb.x) * f, y: p.y - (p.y - vb.y) * f, w: vb.w * f, h: vb.h * f }; setVb()
    }
    svg.onpointerdown = e => { if (e.target === svg || e.target.tagName === 'line') startPan(e) }
  }
  const place = () => {
    for (const [id, el] of els) { const p = pos.get(id); el.setAttribute('transform', `translate(${p.x},${p.y})`) }
    for (const [l, e] of lineEls) { const a = pos.get(e.source), b = pos.get(e.target); l.setAttribute('x1', a.x); l.setAttribute('y1', a.y); l.setAttribute('x2', b.x); l.setAttribute('y2', b.y) }
  }

  // ---- pointer: pan the background, drag a node (a still click selects it) ----
  const startPan = e => {
    const start = { x: e.clientX, y: e.clientY, vb: { ...vb } }, box = svg.getBoundingClientRect()
    let moved = false
    svg.setPointerCapture(e.pointerId)
    svg.onpointermove = m => {
      if (Math.abs(m.clientX - start.x) + Math.abs(m.clientY - start.y) > 3) moved = true
      vb = { ...start.vb, x: start.vb.x - (m.clientX - start.x) / box.width * start.vb.w, y: start.vb.y - (m.clientY - start.y) / box.height * start.vb.h }; setVb()
    }
    svg.onpointerup = () => { svg.onpointermove = null; if (!moved && selected) { history = []; select(null) } }
  }
  const startDrag = (e, id) => {
    e.stopPropagation()
    const p0 = toGraph(e), start = { ...pos.get(id) }
    let moved = false, raf = 0
    svg.setPointerCapture(e.pointerId)
    svg.onpointermove = m => {
      const p = toGraph(m)
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return
      moved = true
      pos.set(id, { x: start.x + p.x - p0.x, y: start.y + p.y - p0.y })
      // A few gentle physics steps with the dragged node pinned: its neighbours follow.
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; for (let i = 0; i < 3; i++) tick(2, id); place() })
    }
    svg.onpointerup = () => {
      svg.onpointermove = null
      if (!moved) { select(id, { center: false }); return }
      let n = 30
      const relax = () => { for (let i = 0; i < 2; i++) tick(1.5, id); place(); if (--n > 0) requestAnimationFrame(relax) }
      requestAnimationFrame(relax)
    }
  }

  wrap.append(bar, stage, legend)
  // Laid out once the stage is in the page, so the fit knows its real width.
  requestAnimationFrame(build)
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && selected) { history = []; select(null) } })
  wrap.select = id => select(id) // for lists beside the graph: show that node in it
  return wrap
}
