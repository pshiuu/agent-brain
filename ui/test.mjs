// Self-check for the invariants that keep bin/brain working. Run: node ui/test.mjs
// Builds a throwaway fixture from the real system/ so the rules are tested against
// the formats actually in use, never against the live repo.
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, utimesSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { createExtensions } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('./public/extensions.js', import.meta.url))).toString('base64'))
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = mkdtempSync(join(tmpdir(), 'brain-test-'))
cpSync(join(REPO, 'system'), join(FIX, 'system'), { recursive: true })

/* The fixture writes its own roles.conf and playbooks over the copied system/, because
   tests must not depend on which roles and playbooks the live brain happens to hold.
   Borrowing them broke twice: a real role named 'copywriter' collided with a fixture
   one, and emptying examples/ would have left the fixture with no playbooks at all.
   Shapes here mirror the real formats — that is what is under test. */
rmSync(join(FIX, 'system/roles'), { recursive: true, force: true })
rmSync(join(FIX, 'system/playbooks'), { recursive: true, force: true })
// Installed apps are this Mac's, not the format's: the fixture installs its own below.
rmSync(join(FIX, 'system/apps'), { recursive: true, force: true })
// Client work is an app; most of this file runs with it installed, one block without.
mkdirSync(join(FIX, 'system/apps/clients'), { recursive: true }); writeFileSync(join(FIX, 'system/apps/clients/app.conf'), 'name clients\nversion 1\nbrain >= 2\n')
const ROLES = ['builder', 'mapper', 'planner', 'code-reviewer', 'qa', 'fixer', 'payload-builder', 'designer', 'retro', 'html-designer']
mkdirSync(join(FIX, 'system/roles'), { recursive: true })
writeFileSync(join(FIX, 'system/roles.conf'), '# role              engine   model    [effort]\n' +
  ROLES.map(r => r.padEnd(20) + (r === 'payload-builder' ? 'codex' : 'claude').padEnd(9) + 'default').join('\n') + '\n')
for (const r of ROLES) writeFileSync(join(FIX, `system/roles/${r}.md`), `# Role: ${r}\nFixture role.\n`)
// One role carries a prose "Skills:" line, the shape the picker must refuse to rewrite.
writeFileSync(join(FIX, 'system/roles/html-designer.md'),
  '# Role: html-designer\nSkills: use the taste skills (design-taste-frontend for layout), then check your work.\nFixture role.\n')

// Same rule bin/brain's phase_row follows: always a space, even for a 15-char phase.
const row = (p, r, f = '') => (p.padEnd(Math.max(15, p.length + 1)) + r.padEnd(Math.max(18, r.length + 1)) + f).trimEnd()
const pb = (name, desc, rows, extra = {}) => {
  const dir = join(FIX, 'system/playbooks', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'phases'),
    '# phase        role              fix-role (who fixes when this review FAILs)\n' +
    rows.map(r => row(...r)).join('\n') + '\n')
  writeFileSync(join(dir, 'playbook.md'), `# Playbook: ${name}\n> ${desc}\n\nWhat every agent on this path should know.\n\n` +
    rows.map(([p]) => `## ${p}\nWhat ${p} does and its gate.\n`).join('\n'))
  writeFileSync(join(dir, 'brief.md'), '# Brief\n\n## Stack\n- \n')
  for (const [f, body] of Object.entries(extra)) writeFileSync(join(dir, f), body)
}
pb('feature', 'Fixture path over an existing codebase.', [
  ['map', 'mapper'], ['plan', 'planner'], ['build', 'builder'],
  ['code-review', 'code-reviewer', 'builder'], ['qa', 'qa', 'builder'], ['retro', 'retro']])
pb('rebuild-payload', 'Fixture path with a human gate.', [
  ['design', 'html-designer'], ['design-approval', 'human', 'html-designer'],
  ['build', 'payload-builder'], ['retro', 'retro']],
  { 'playbook.env': 'TEMPLATE_REPO=https://example.com/t.git\n' })
mkdirSync(join(FIX, 'memory/projects/demo/phases'), { recursive: true })
writeFileSync(join(FIX, 'memory/projects/demo/project.env'), 'PLAYBOOK=feature\nPROJECT_DIR=/Users/x/dev/demo\nCREATED=2026-01-01\n')
mkdirSync(join(FIX, 'memory/projects/zz-thesis'), { recursive: true })
writeFileSync(join(FIX, 'memory/projects/zz-thesis/project.env'), 'KIND=academy\nPROJECT_DIR=/Users/x/dev/zz-thesis\nCREATED=2026-01-01\n')
process.env.BRAIN_DIR = FIX; process.env.HOST_BRAIN = '/h/agent-brain'; process.env.HOST_DEV = '/Users/x/dev'; process.env.DEV_MOUNT = join(FIX, 'dev')
const b = await import('./brain.mjs')
const ph = e => join(FIX, 'memory/projects/demo/phases/code-review' + e)

let n = 0
const it = (name, fn) => { fn(); console.log(`  ok  ${name}`); n++ }
{
  const panels = createExtensions()
  assert.deepEqual(await panels.render('workspace-tasks', {}), [])
  panels.provide('tasks', 'workspace-tasks', context => context.path)
  panels.provide('broken', 'workspace-tasks', () => { throw new Error('offline') })
  const result = await panels.render('workspace-tasks', { path: '/workspace' })
  assert.equal(result[0].content, '/workspace')
  assert.equal(result[1].error, 'offline')
  assert.throws(() => panels.provide('tasks', 'workspace-tasks', () => null), /already provides/)
  assert.throws(() => panels.provide('../bad', 'workspace-tasks', () => null), /Invalid/)
}
const throws = (fn, re) => assert.throws(fn, e => re.test(e.message), `expected ${re}`)

console.log('path guard')
it('rejects traversal and sibling-prefix escapes', () => {
  for (const p of ['../../etc/passwd', '/etc/passwd', '../' + FIX.split('/').pop() + 'X/y'])
    throws(() => b.safePath(p), /escapes root/)
  assert.ok(b.safePath('system/roles.conf').startsWith(FIX + '/'))
})

console.log('writes')
const SCRATCH = join(FIX, 'system/scratch.list') // never a file another test reads
it('adds a trailing newline — bin/brain reads skills.list with `while read`, which drops an unterminated last line', () => {
  b.writeAtomic(SCRATCH, 'keep: payload\nrepo/x name')
  assert.equal(readFileSync(SCRATCH, 'utf8').at(-1), '\n')
})
it('skips the write when bytes are identical — a no-op save would bump .md past .fixed and re-run the fixer', () => {
  const f = SCRATCH
  const before = statSync(f).mtimeMs
  const r = b.writeAtomic(f, readFileSync(f, 'utf8'))
  assert.equal(r.written, false)
  assert.equal(statSync(f).mtimeMs, before)
})
it('refuses a stale prev with 409', () => {
  throws(() => b.writeTracked('system/scratch.list', 'x', 'not on disk'), /changed on disk/)
})
it('refuses writes outside system/ and memory/', () => {
  writeFileSync(join(FIX, 'README.md'), 'x\n')
  throws(() => b.writeTracked('README.md', 'y', undefined), /only system\/ and memory\//)
})

console.log('minimal diffs')
it('setRoleLine changes exactly one line and keeps both column alignments', () => {
  const src = readFileSync(join(FIX, 'system/roles.conf'), 'utf8')
  const out = b.setRoleLine(src, 'payload-builder', 'claude', 'opus')
  const a = src.split('\n'), z = out.split('\n')
  assert.equal(a.length, z.length)
  assert.equal(a.filter((l, i) => l !== z[i]).length, 1)
  const cols = s => [...new Set(s.split('\n').filter(l => l.trim() && !l.trimStart().startsWith('#'))
    .map(l => { const f = l.trim().split(/\s+/); return l.indexOf(f[1]) + ':' + l.indexOf(f[2], l.indexOf(f[1]) + 1) }))].sort()
  assert.deepEqual(cols(out), cols(src))
  throws(() => b.setRoleLine(src, 'payload-builder', 'gpt', 'x'), /engines\.conf/)
  throws(() => b.setRoleLine(src, 'payload-builder', 'gemini', 'default', 'high'), /no reasoning effort/, 'gemini has no effort setting')
  assert.match(b.setRoleLine(src, 'payload-builder', 'opencode', 'anthropic/claude-sonnet-4-5'), /payload-builder\s+opencode\s+anthropic\/claude-sonnet-4-5/, 'a provider/model name')
})
it('replaceSection rewrites one body and leaves title, description and preamble intact', () => {
  const src = readFileSync(join(FIX, 'system/playbooks/rebuild-payload/playbook.md'), 'utf8')
  const out = b.replaceSection(src, 'design-approval', 'NEW BODY.')
  const d0 = b.parsePlaybookMd(src), d1 = b.parsePlaybookMd(out)
  assert.equal(d1.title, d0.title); assert.equal(d1.description, d0.description)
  assert.equal(d1.preamble, d0.preamble)
  assert.deepEqual(d1.sections.map(s => s.name), d0.sections.map(s => s.name))
  assert.equal(d1.sections.find(s => s.name === 'design-approval').body, 'NEW BODY.')
  assert.equal(d1.sections.find(s => s.name === 'build').body, d0.sections.find(s => s.name === 'build').body)
})
it('an Area: line groups a playbook and stays out of its preamble', () => {
  const d = b.parsePlaybookMd('# Playbook: x\n> One line.\nArea: Websites\n\nKnow this.\n\n## build\nB.\n')
  assert.equal(d.area, 'Websites'); assert.equal(d.preamble, 'Know this.')
  assert.equal(b.parsePlaybookMd('# Playbook: x\n> One line.\n\n## build\nArea: no\n').area, '', 'only before the first phase')
})

console.log('phase state machine')
it('an academy workspace (KIND=academy) is not listed as a playbook project', () => {
  assert.ok(!b.projects().some(p => p.name === 'zz-thesis'))
})
it('reports the three blocked states bin/brain cannot distinguish', () => {
  const p = () => b.projects()[0].phases.find(x => x.phase === 'code-review')
  writeFileSync(ph('.md'), 'RESULT: FAIL\n1. fix it\n'); writeFileSync(ph('.log'), '2026-01-01 FAIL\n')
  assert.equal(p().state, 'awaiting-fix')
  writeFileSync(ph('.fixed'), ''); utimesSync(ph('.fixed'), new Date(), new Date(Date.now() + 2000))
  assert.equal(p().state, 'awaiting-review')
  writeFileSync(ph('.log'), '2026-01-01 FAIL\n2026-01-02 FAIL\n2026-01-03 FAIL\n')
  assert.equal(p().state, 'stuck', 'three FAILs means brain run will die at bin/brain:288')
  assert.equal(p().fails, 3)
})

console.log('run receipts')
it('reads one receipt per run, newest first, each against the role that actually ran', () => {
  const dir = ph('.runs')
  mkdirSync(dir, { recursive: true })
  const receipt = (turns, skills) => JSON.stringify({ model: 'claude-opus-5', seconds: 60, turns, skills, tokens: { output: 10 }, tools: {} })
  writeFileSync(join(dir, '20260101T100000Z.json'), receipt(10, ['visual-qa']))
  writeFileSync(join(dir, '20260101T100000Z.code-reviewer.md'), '# Role: code-reviewer\n')
  writeFileSync(join(dir, '20260102T100000Z.json'), receipt(20, []))
  writeFileSync(join(dir, '20260102T100000Z.fixer.md'), '# Role: fixer\n')
  const runs = b.projects()[0].phases.find(x => x.phase === 'code-review').runs
  assert.deepEqual(runs.map(r => [r.turns, r.role]), [[20, 'fixer'], [10, 'code-reviewer']],
    'newest first, and a fix round is the fix-role — pairing them by phase role would mislabel it')
  // The client fetches the snapshot through /api/file, so the path has to be repo-relative.
  assert.match(runs[0].rolePath, /^memory\/projects\/demo\/phases\/code-review\.runs\//)
  assert.equal(b.readTracked(runs[0].rolePath).content, '# Role: fixer\n')
  rmSync(dir, { recursive: true })
})
it('keeps each round\'s verdict with its run, so the analytics can tell them apart', () => {
  // bin/brain copies <phase>.md beside the receipt, because the next round overwrites it.
  // The role snapshot and the summary snapshot both end .md and share the timestamp
  // prefix — telling them apart is the part that breaks silently, as role "summary".
  const dir = ph('.runs')
  mkdirSync(dir, { recursive: true })
  const receipt = t => JSON.stringify({ model: 'claude-opus-5', seconds: 60, turns: t, skills: [], tokens: {}, tools: {} })
  writeFileSync(join(dir, '20260101T100000Z.json'), receipt(10))
  writeFileSync(join(dir, '20260101T100000Z.code-reviewer.md'), '# Role: code-reviewer\n')
  writeFileSync(join(dir, '20260101T100000Z.summary.md'),
    'RESULT: FAIL\n\n1. **Nav labels** hardcoded in Header.tsx:12\n2. 404 is a Payload page\n')
  writeFileSync(join(dir, '20260103T100000Z.json'), receipt(30))
  writeFileSync(join(dir, '20260103T100000Z.code-reviewer.md'), '# Role: code-reviewer\n')
  writeFileSync(join(dir, '20260103T100000Z.summary.md'), 'RESULT: PASS\n\n1. everything checks out\n')
  const runs = b.projects()[0].phases.find(x => x.phase === 'code-review').runs
  assert.deepEqual(runs.map(r => r.role), ['code-reviewer', 'code-reviewer'], 'the summary snapshot is not a role')
  assert.deepEqual(runs.map(r => r.result), ['PASS', 'FAIL'])
  assert.deepEqual(runs[1].fixItems, ['Nav labels hardcoded in Header.tsx:12', '404 is a Payload page'])
  assert.deepEqual(runs[0].fixItems, [], 'a PASS has no fix list — its numbered lines are prose')
  assert.match(runs[1].summaryPath, /code-review\.runs\/20260101T100000Z\.summary\.md$/)
  rmSync(dir, { recursive: true })
})
console.log('host attempt records')
const attempt = (id, result, files = {}) => {
  const dir = join(FIX, '.runs/demo/code-review', id)
  mkdirSync(join(dir, 'evidence'), { recursive: true })
  writeFileSync(join(dir, 'result.json'), JSON.stringify(result))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}
const att = () => b.projects()[0].phases.find(x => x.phase === 'code-review').attempt
it('surfaces the newest attempt\'s host verdict with each check and what it printed', () => {
  attempt('20260101T100000Z-aaaaaaaa', { host_verdict: { outcome: 'verified' }, ended: '2026-01-01T10:00:00Z' })
  attempt('20260102T100000Z-bbbbbbbb', { host_verdict: { outcome: 'verification_failed' }, ended: '2026-01-02T10:00:00Z' }, {
    'verification.log': 'Check 2 failed (exit 1): npm test\n',
    'evidence/check-1.command': 'npm run build\n', 'evidence/check-1.exit': '0\n', 'evidence/check-1.log': 'built\n',
    'evidence/check-2.command': 'npm test\n', 'evidence/check-2.exit': '1\n', 'evidence/check-2.log': '2 failing\n'
  })
  const a = att()
  assert.equal(a.outcome, 'verification_failed', 'the newest attempt, not the one that passed before it')
  assert.deepEqual(a.checks.map(c => [c.command, c.exit]), [['npm run build', 0], ['npm test', 1]])
  assert.deepEqual(a.notes.map(n => n.path), ['.runs/demo/code-review/20260102T100000Z-bbbbbbbb/verification.log'])
  // The client fetches these through /api/file, exactly like a role snapshot.
  assert.equal(b.readTracked(a.checks[1].log).content, '2 failing\n')
  rmSync(join(FIX, '.runs'), { recursive: true })
})
it('orders checks by number, because ten of them sort check-10 second by name', () => {
  const files = {}
  for (let n = 1; n <= 10; n++) Object.assign(files, { [`evidence/check-${n}.command`]: `c${n}\n`, [`evidence/check-${n}.exit`]: '0\n' })
  attempt('20260101T100000Z-cccccccc', { host_verdict: { outcome: 'verified' } }, files)
  assert.deepEqual(att().checks.map(c => c.command), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'])
  rmSync(join(FIX, '.runs'), { recursive: true })
})
it('reads no verdict from an attempt still running, rather than the last one\'s', () => {
  attempt('20260101T100000Z-dddddddd', { host_verdict: { outcome: 'verification_failed' } })
  const live = join(FIX, '.runs/demo/code-review/20260102T100000Z-eeeeeeee')
  mkdirSync(live, { recursive: true })
  writeFileSync(ph('.running'), '20260102T100000Z-eeeeeeee\n')
  assert.equal(att(), null, 'no result.json yet — showing the previous failure would read as this run\'s')
  // The same record with no lease is an attempt whose launcher died before finishing it.
  rmSync(ph('.running'))
  assert.equal(att().outcome, 'unfinished', 'neither the previous verdict nor nothing: say it never finished')
  rmSync(join(FIX, '.runs'), { recursive: true })
})
it('records a killed check as no exit code, never as zero', () => {
  attempt('20260101T100000Z-ffffffff', { host_verdict: { outcome: 'verification_failed' } },
    { 'evidence/check-1.command': 'sleep 99\n' })
  assert.equal(att().checks[0].exit, null, 'an empty exit file parsed as a number is 0, which reads as a pass')
  rmSync(join(FIX, '.runs'), { recursive: true })
})

it('counts a pre-receipt-directory <phase>.run.json as the one run it is', () => {
  writeFileSync(ph('.run.json'), JSON.stringify({ model: 'x', turns: 5, skills: [] }))
  const runs = b.projects()[0].phases.find(x => x.phase === 'code-review').runs
  assert.deepEqual(runs.map(r => [r.turns, r.role]), [[5, null]], 'no snapshot was kept then, and the UI says so')
  rmSync(ph('.run.json'))
})

console.log('sources')
it('keeps a project\'s own sources out of the brain-wide pile', () => {
  // The whole point of the split: a client's brand book must not land where the next
  // project's agents read it.
  b.addSource({ name: 'Brand Guide.pdf', data: Buffer.from('%PDF-demo').toString('base64'), project: 'demo' })
  b.addSource({ name: 'how-we-work.md', data: Buffer.from('# shared').toString('base64') })
  const proj = b.projects().find(p => p.name === 'demo')
  assert.deepEqual(proj.sources.map(s => s.name.replace(/^\d{4}-\d{2}-\d{2}-/, '')), ['brand-guide.pdf'])
  assert.deepEqual(b.sources().map(s => s.name.replace(/^\d{4}-\d{2}-\d{2}-/, '')), ['how-we-work.md'])
  assert.match(proj.sources[0].path, /^memory\/projects\/demo\/sources\//)
  assert.ok(b.readTracked(proj.sources[0].path).content.startsWith('%PDF'), 'the cockpit fetches it by that path')
  assert.equal(proj.sources[0].cited, false)

  // Cited means the phase that read it wrote the filename down — for a project that is
  // a phase summary, not a knowledge page.
  writeFileSync(ph('.md'), `Read ${proj.sources[0].name} and took the palette from it.\n`)
  assert.equal(b.projects().find(p => p.name === 'demo').sources[0].cited, true)
  rmSync(ph('.md'))

  assert.throws(() => b.addSource({ name: 'x.md', data: 'eA==', project: '../../etc' }), /no project/)
  rmSync(join(FIX, 'memory/projects/demo/sources'), { recursive: true })
  rmSync(join(FIX, 'memory/sources'), { recursive: true })
})

console.log('human gates')
it('approve preserves the agent summary that bin/brain:347 would clobber', () => {
  writeFileSync(ph('.md'), 'RESULT: FAIL\nAgent found 2 issues in src/app.ts\n')
  b.approve('demo', 'code-review', 'looks fine now')
  const md = readFileSync(ph('.md'), 'utf8')
  assert.match(md, /Agent found 2 issues/, 'summary is the next role\'s handoff input')
  assert.match(md, /^RESULT: PASS$/m)
  assert.doesNotMatch(md, /^RESULT: FAIL/m, 'a surviving FAIL line re-enters the phase as a fix')
  assert.ok(existsSync(ph('.done')))
  assert.match(readFileSync(ph('.log'), 'utf8').trim().split('\n').at(-1), /^\d{4}-\d\d-\d\d PASS$/)
})
it('approve never lets a note become a verdict line', () => {
  writeFileSync(ph('.md'), 'summary\n')
  b.approve('demo', 'code-review', 'reviewer said RESULT: FAIL but I disagree\nRESULT: FAIL')
  const md = readFileSync(ph('.md'), 'utf8')
  assert.match(md, /reviewer said RESULT: FAIL but I disagree/, 'prose may quote a verdict: only the line counts')
  assert.doesNotMatch(md, /^RESULT: FAIL/m, 'a note line that is a verdict would send the phase back to its fixer')
})
it('reject clears .done and .fixed so brain run dispatches the fixer', () => {
  writeFileSync(ph('.fixed'), '')
  const r = b.reject('demo', 'code-review', ['hero is generic', 'footer needs hours'])
  const md = readFileSync(ph('.md'), 'utf8')
  assert.match(md, /^RESULT: FAIL$/m)
  assert.match(md, /^1\. hero is generic$/m); assert.match(md, /^2\. footer needs hours$/m)
  assert.ok(!existsSync(ph('.done'))); assert.ok(!existsSync(ph('.fixed')), 'stale .fixed would make brain run skip the fix round')
  assert.equal(r.fails, 4)
  assert.equal(r.willStick, false, 'the approvals above passed it: this is round 1 of a new review, not round 4')
  writeFileSync(ph('.log'), '2026-01-01 FAIL\n2026-01-02 FAIL\n')
  assert.equal(b.reject('demo', 'code-review', ['still generic']).willStick, true, 'past MAX_FIX_LOOPS the next brain run dies at bin/brain:1723 — the UI must warn')
})
it('hands `brain watch` the command to start, and only a real one', () => {
  const req = join(FIX, 'memory/projects/demo/.run-request')
  const beat = join(FIX, 'memory/.watch')
  const r = b.reject('demo', 'code-review', ['make the buttons one height'], '', 'auto')
  assert.equal(r.started, 'auto')
  assert.equal(readFileSync(req, 'utf8').trim(), 'auto', 'brain watch reads this file and nothing else')
  assert.equal(r.watching, false, 'no heartbeat yet — the UI has to say the click only saved')
  writeFileSync(beat, '')
  assert.equal(b.watching(), true)
  utimesSync(beat, new Date(), new Date(Date.now() - 20000))
  assert.equal(b.watching(), false, 'a watcher killed without its trap must not keep looking alive')
  // The word names a command on the host, so anything outside the pair is refused here
  // rather than shipped to a shell.
  throws(() => b.approve('demo', 'code-review', '', 'auto; rm -rf /'), /not a brain command/)
  assert.equal(b.approve('demo', 'code-review', '', '').started, null, 'no choice means no request file')
  rmSync(req, { force: true }); rmSync(beat, { force: true })
})
it('reject refuses a phase with no fix-role', () => {
  throws(() => b.reject('demo', 'map', ['x']), /no fix role/)
  throws(() => b.reject('demo', 'code-review', []), /at least one/)
})

console.log('verdict texts, shared with test/state.sh')
const V = join(REPO, 'test/fixtures/verdicts')
const phasesDir = join(FIX, 'memory/projects/demo/phases')
// Newest by mtime: two records in one second sort by their random suffix, not by time.
const newestRecord = phase => {
  const base = join(FIX, '.runs/demo', phase)
  const id = readdirSync(base).sort((x, y) => statSync(join(base, x, 'result.json')).mtimeMs - statSync(join(base, y, 'result.json')).mtimeMs).at(-1)
  return JSON.parse(readFileSync(join(base, id, 'result.json'), 'utf8'))
}
it('approve, reject and the round count are the bytes bin/brain writes', () => {
  const r = f => readFileSync(join(V, f), 'utf8')
  assert.equal(b.approvedSummary(r('summary.md'), r('fixed.txt'), '2026-09-24', true, ['qa.slug-rename-links']), r('approved.md'))
  assert.equal(b.rejectedSummary('design-gate', 2, '2026-09-24', ['Hero feels generic', 'Footer needs opening hours']), r('rejected.md'))
  assert.equal(b.failRounds(r('phase.log')), 3, 'only host-format FAIL lines are rounds')
  assert.equal(b.openRounds(r('phase.log')), 1, 'the fix limit counts only rounds since the last PASS')
  assert.deepEqual(b.defects(r('summary.md')).map(d => d.state), ['OPEN', 'OPEN', 'OPEN', 'WAIVED', 'VERIFIED'], 'a list under another heading is not a defect')
})
it('approving over open findings closes them on the record — waived, or deferred when ticked', () => {
  rmSync(ph('.fixed'), { force: true })
  writeFileSync(ph('.md'), 'RESULT: FAIL\n1. code-review.a\n\n## Defects\n- code-review.a OPEN\n- code-review.b OPEN\n')
  throws(() => b.approve('demo', 'code-review', '', '', ['code-review.zz']), /not an OPEN defect/)
  const r = b.approve('demo', 'code-review', '', '', ['code-review.b'])
  assert.deepEqual(r.closed, ['waived code-review.a', 'deferred code-review.b'])
  const state = b.projects()[0].phases.find(x => x.phase === 'code-review')
  assert.deepEqual([state.open, state.waived, state.deferred], [0, 1, 1], 'the phase row can say what shipped unfixed')
  const rec = newestRecord('code-review')
  assert.equal(rec.actor, 'human')
  assert.deepEqual(rec.defects, { waived: ['code-review.a'], deferred: ['code-review.b'], verified: [] })
})
it('reject makes every item an OPEN defect with a per-round id', () => {
  b.reject('demo', 'code-review', ['hero is generic'])
  const found = b.defects(readFileSync(ph('.md'), 'utf8'))
  assert.equal(found.length, 1); assert.equal(found[0].state, 'OPEN'); assert.match(found[0].id, /^code-review\.r\d+-1$/)
  assert.equal(newestRecord('code-review').host_verdict.outcome, 'rejected')
})
it('reopen sends the playbook back to a work phase and keeps its summary', () => {
  writeFileSync(join(phasesDir, 'build.md'), 'Build summary\n')
  for (const x of ['map', 'plan', 'build', 'code-review', 'qa']) writeFileSync(join(phasesDir, `${x}.done`), '')
  b.reopen('demo', 'build', ['the API is wrong'])
  assert.deepEqual(['map', 'plan', 'build', 'code-review', 'qa'].map(x => existsSync(join(phasesDir, `${x}.done`))), [true, true, false, false, false])
  const md = readFileSync(join(phasesDir, 'build.md'), 'utf8')
  assert.match(md, /^Build summary$/m, 'the summary is the next role\'s handoff input')
  assert.match(md, /^## Feedback from the human \(\d{4}-\d\d-\d\d\)\n1\. the API is wrong$/m)
  assert.deepEqual(newestRecord('build').reopened, ['build', 'code-review', 'qa'])
  throws(() => b.reopen('demo', 'build', []), /at least one/)
  for (const x of ['map', 'plan', 'build']) rmSync(join(phasesDir, `${x}.${x === 'build' ? 'md' : 'done'}`), { force: true })
})
it('joins a receipt to its host record by run id', () => {
  const id = '20260105T100000Z-abcdefgh', rec = join(FIX, '.runs/demo/code-review', id)
  mkdirSync(rec, { recursive: true })
  writeFileSync(join(rec, 'plan.json'), JSON.stringify({ role: 'builder' }))
  writeFileSync(join(rec, 'role.md'), '# Role: builder\n')
  writeFileSync(join(rec, 'summary.md'), 'RESULT: FAIL\n1. x\n\n## Defects\n- code-review.x OPEN\n')
  mkdirSync(join(phasesDir, 'code-review.runs'), { recursive: true })
  writeFileSync(join(phasesDir, `code-review.runs/${id}.json`), JSON.stringify({ turns: 3, skills: [] }))
  const run = b.projects()[0].phases.find(x => x.phase === 'code-review').runs.find(r => r.at === id)
  assert.equal(run.role, 'builder', 'who ran is in the plan, not in a copied filename')
  assert.equal(run.rolePath, `.runs/demo/code-review/${id}/role.md`)
  assert.equal(run.result, 'FAIL'); assert.deepEqual(run.defects.map(d => d.id), ['code-review.x'])
  rmSync(join(phasesDir, 'code-review.runs'), { recursive: true })
})
it('refuses a verdict while an agent is in the project', () => {
  writeFileSync(join(phasesDir, 'qa.running'), 'x\n')
  throws(() => b.approve('demo', 'code-review'), /agent is running 'qa'/)
  rmSync(join(phasesDir, 'qa.running'))
  rmSync(join(FIX, '.runs'), { recursive: true, force: true })
})

console.log('skills.list writes')
// A literal fixture, not the repo's own skills.list: that file is the user's to edit,
// and a test that asserts its contents reports their edits as failures.
const LIST = [
  '# header comment',
  '# second header line',
  'keep: payload',
  '',
  '# a section comment',
  'owner/repo alpha beta',
  '',
  'https://github.com/other/thing.git gamma',
  ''
].join('\n')

it('adding a skill never drops a line, and keeps comments, keep: and blanks', () => {
  for (const [repo, names] of [['owner/repo', ['delta']], ['brand/new', ['thing']], ['https://github.com/owner/repo.git', ['eps']]]) {
    const out = b.addSkillSource(LIST, repo, names)
    for (const l of LIST.split('\n').filter(l => l.trim())) {
      const tok = l.trim().split(/\s+/)[0]
      assert.ok(out.includes(tok), `'${tok}' disappeared after adding to ${repo}`)
    }
    assert.ok(out.includes('keep: payload'), 'the keep: line protects a host skill from pruning')
    assert.equal(out.split('\n').filter(l => l.startsWith('#')).length,
                 LIST.split('\n').filter(l => l.startsWith('#')).length, 'comments survive')
    for (const n of names) assert.ok(out.includes(n))
  }
})
it('merges into the existing repo line instead of duplicating it', () => {
  const out = b.addSkillSource(LIST, 'owner/repo', ['delta'])
  const hits = out.split('\n').filter(l => l.startsWith('owner/repo'))
  assert.equal(hits.length, 1)
  assert.match(hits[0], /alpha beta delta/)
  // a shorthand and a full git URL for the same repo are one line, not two
  assert.equal(b.addSkillSource(LIST, 'https://github.com/owner/repo.git', ['zeta'])
    .split('\n').filter(l => l.includes('alpha')).length, 1)
  assert.equal(b.addSkillSource(LIST, 'owner/repo', ['alpha']).split('\n')
    .find(l => l.startsWith('owner/repo')).split(/\s+/).filter(t => t === 'alpha').length, 1, 'no duplicate name')
})
it('appends a brand new repo on its own line', () => {
  const out = b.addSkillSource(LIST, 'brand/new', ['thing'])
  assert.ok(out.split('\n').includes('brand/new thing'))
  assert.equal(out.split('\n').filter(l => l.trim()).length, LIST.split('\n').filter(l => l.trim()).length + 1)
})
it('rejects a name that would break the line format', () => {
  throws(() => b.addSkillSource(LIST, 'a/b', ['has space']), /bad skill name/)
  throws(() => b.addSkillSource(LIST, 'a/b', []), /no skills given/)
})

console.log('sandbox.conf')
it('reads mcp servers and both host separators, and ignores comments', () => {
  writeFileSync(join(FIX, 'system/sandbox.conf'),
    '# mcp commented --url x\nmcp github --url https://api.githubcopilot.com/mcp/\nallow a.com,b.com\ndeny  c.com d.com\n')
  const sb = b.sandbox()
  assert.deepEqual(sb.mcp, [{ name: 'github', detail: '--url https://api.githubcopilot.com/mcp/' }])
  assert.deepEqual(sb.allow, ['a.com', 'b.com'])
  assert.deepEqual(sb.deny, ['c.com', 'd.com'])
})

console.log('removing skills')
{
  const L = 'Leonxlnx/taste-skill design-taste-frontend redesign-existing-projects\nkeep: some-host-skill other-host\n# a comment\n'
  it('drops just that name and leaves the rest of the line', () => {
    assert.equal(b.removeSkillSource(L, 'redesign-existing-projects'),
      'Leonxlnx/taste-skill design-taste-frontend\nkeep: some-host-skill other-host\n# a comment')
  })
  it('removes a repo line that has no names left rather than leaving it to install everything', () => {
    const one = 'org/repo only-skill\nkeep: host-one\n'
    assert.equal(b.removeSkillSource(one, 'only-skill'), 'keep: host-one')
  })
  it('un-keeps a host skill', () => {
    assert.equal(b.removeSkillSource(L, 'other-host'),
      'Leonxlnx/taste-skill design-taste-frontend redesign-existing-projects\nkeep: some-host-skill\n# a comment')
  })
  it('refuses a name it does not declare, instead of silently writing nothing', () => {
    throws(() => b.removeSkillSource(L, 'not-there'), /not declared/)
    throws(() => b.removeSkillSource(L, 'bad name'), /bad skill name/)
  })
  it('comments survive a removal', () => {
    assert.ok(b.removeSkillSource(L, 'design-taste-frontend').includes('# a comment'))
  })
}
it('deleting an own skill removes the directory, which is what drops it from the keep list', () => {
  mkdirSync(join(FIX, 'system/skills/throwaway'), { recursive: true })
  writeFileSync(join(FIX, 'system/skills/throwaway/SKILL.md'), '---\nname: throwaway\ndescription: x\n---\nbody\n')
  assert.ok(b.skills().own.some(o => o.dir === 'throwaway'))
  b.deleteOwnSkill('throwaway')
  assert.ok(!existsSync(join(FIX, 'system/skills/throwaway')))
  assert.ok(!b.skills().own.some(o => o.dir === 'throwaway'))
  throws(() => b.deleteOwnSkill('throwaway'), /no skill directory/)
  throws(() => b.deleteOwnSkill('../roles'), /bad skill directory/)
})

console.log('per-role skills')
it('set then clear returns the file to its exact original bytes', () => {
  for (const doc of ['# Role: x\nProse right after the heading.\n\nDo:\n- a\n',
                     '# Role: y\n\nBlank line after the heading.\n',
                     'No heading at all.\n']) {
    const set = b.setRoleSkills(doc, ['alpha', 'beta'])
    assert.deepEqual(b.roleSkills(set).names, ['alpha', 'beta'])
    assert.equal(b.setRoleSkills(set, []), doc, 'clearing must not leave a stray blank line behind')
  }
})
it('leaves a prose Skills: line alone rather than destroying the reasoning', () => {
  const prose = readFileSync(join(FIX, 'system/roles/html-designer.md'), 'utf8')
  const got = b.roleSkills(prose)
  assert.equal(got.editable, false)
  assert.deepEqual(got.names, [])
  throws(() => b.setRoleSkills(prose, ['alpha']), /prose/)
})

console.log('playbooks')
it('a new playbook is valid the moment it is created', () => {
  b.createPlaybook({ name: 'scratch-path', description: 'A test path.' })
  const pb = b.playbooks().find(p => p.name === 'scratch-path')
  assert.ok(pb, 'shows up in the playbook list')
  assert.equal(pb.description, 'A test path.')
  assert.ok(pb.phases.length, 'has phases, not an empty file that silently completes')
  // every phase must resolve to a real role and have its own section, or the lint fires
  for (const ph of pb.phases) {
    assert.ok(b.roles().some(r => r.role === ph.role), `${ph.role} is a real role`)
    assert.ok(pb.md.sections.some(x => x.heading === `## ${ph.phase}`), `${ph.phase} has a section`)
  }
  assert.deepEqual(b.lint().filter(f => f.where.includes('scratch-path')), [], 'lint-clean on creation')
  assert.ok(existsSync(join(FIX, 'system/playbooks/scratch-path/brief.md')), 'brain new needs a brief to copy')
})
it('copying rewrites the title and description but keeps the phases', () => {
  b.createPlaybook({ name: 'copy-path', description: 'A copy.', from: 'feature' })
  const src = b.playbooks().find(p => p.name === 'feature')
  const got = b.playbooks().find(p => p.name === 'copy-path')
  assert.equal(got.md.title, '# Playbook: copy-path')
  assert.equal(got.description, 'A copy.')
  assert.deepEqual(got.phases.map(p => p.phase), src.phases.map(p => p.phase))
  assert.deepEqual(b.lint().filter(f => f.where.includes('copy-path')), [])
})
it('rejects a name that is not safe as a folder and a brain new argument', () => {
  for (const n of ['../escape', 'Has Caps', 'has space', '', 'has/slash'])
    throws(() => b.createPlaybook({ name: n }), /usable playbook name|bad playbook path/)
  throws(() => b.createPlaybook({ name: 'scratch-path' }), /already exists/)
})
it('refuses to delete a playbook a project still points at', () => {
  // the demo project's project.env says PLAYBOOK=feature
  throws(() => b.deletePlaybook('feature'), /still uses? this playbook/)
  assert.ok(existsSync(join(FIX, 'system/playbooks/feature')), 'nothing was removed')
})
it('deletes an unused playbook', () => {
  b.deletePlaybook('scratch-path')
  assert.ok(!existsSync(join(FIX, 'system/playbooks/scratch-path')))
  assert.ok(!b.playbooks().some(p => p.name === 'scratch-path'))
  b.deletePlaybook('copy-path')
  throws(() => b.deletePlaybook('copy-path'), /no playbook/)
})

console.log('roles')
// Names here must not be ones a real brain would have: the fixture is a copy of the
// live system/, so a plausible role name collides the day someone actually adds it.
it('a new role writes both halves, so it is lint-clean immediately', () => {
  b.createRole({ name: 'fixture-role', engine: 'claude', model: 'sonnet', purpose: 'You write the words.' })
  const r = b.roles().find(x => x.role === 'fixture-role')
  assert.equal(r.engine, 'claude'); assert.equal(r.model, 'sonnet')
  assert.ok(existsSync(join(FIX, 'system/roles/fixture-role.md')), 'brain follows roles/<name>.md, so it must exist')
  // 'unused by any playbook' is a warn and is correct here: you just made it. What must
  // never happen is an error, which is what a half-created role produces.
  assert.deepEqual(b.lint().filter(f => f.level === 'error' && f.msg.includes('fixture-role')), [])
})
it('the new line clears the widest role, so no column collides', () => {
  // roles.conf is read by whitespace columns, so the only real requirement is that the
  // engine starts past every role name. Aligning to the widest row is what does that.
  const conf = readFileSync(join(FIX, 'system/roles.conf'), 'utf8').split('\n')
  const line = conf.find(l => l.startsWith('fixture-role'))
  const widest = Math.max(...conf.filter(l => l && !l.startsWith('#')).map(l => l.trim().split(/\s+/)[0].length))
  assert.ok(line.indexOf('claude') > widest, `engine at ${line.indexOf('claude')} does not clear a ${widest}-char name`)
  assert.deepEqual(line.trim().split(/\s+/), ['fixture-role', 'claude', 'sonnet'])
})
it('refuses a duplicate rather than shadowing the first', () => {
  throws(() => b.createRole({ name: 'fixture-role', engine: 'claude', model: 'sonnet' }), /already in roles.conf/)
})
it('refuses to delete a role a playbook still names', () => {
  throws(() => b.deleteRole('builder'), /still use this role/)
  assert.ok(b.roles().some(r => r.role === 'builder'), 'nothing was removed')
})
it('deletes an unused role, both halves', () => {
  b.deleteRole('fixture-role')
  assert.ok(!b.roles().some(r => r.role === 'fixture-role'))
  assert.ok(!existsSync(join(FIX, 'system/roles/fixture-role.md')))
})

console.log('phase roles')
it('assigning a role rewrites only that line', () => {
  const src = readFileSync(join(FIX, 'system/playbooks/feature/phases'), 'utf8')
  const out = b.setPhaseRole(src, 'build', 'fixer', '')
  assert.ok(out.includes('build          fixer'), out)
  assert.equal(out.split('\n').length, src.split('\n').length)
  assert.equal(out.split('\n')[0], src.split('\n')[0], 'the header comment must survive')
  assert.equal(out.split('\n').filter((l, i) => l !== src.split('\n')[i]).length, 1, 'more than one line changed')
})
it('a review phase keeps its fix-role column', () => {
  const src = readFileSync(join(FIX, 'system/playbooks/feature/phases'), 'utf8')
  const out = b.setPhaseRole(src, 'code-review', 'code-reviewer', 'fixer')
  assert.match(out, /code-review {2,}code-reviewer {2,}fixer/)
})
it('rejects a role that is not in roles.conf, which would fail at run time', () => {
  const src = readFileSync(join(FIX, 'system/playbooks/feature/phases'), 'utf8')
  throws(() => b.setPhaseRole(src, 'build', 'ghostwriter', ''), /not in roles.conf/)
  throws(() => b.setPhaseRole(src, 'nosuchphase', 'builder', ''), /no phase/)
  throws(() => b.setPhaseRole(src, 'build', 'builder', 'human'), /cannot be a fix-role/)
})

console.log('lint')
it('validates optional phase contracts', () => {
  assert.deepEqual(b.contractProblems('# Comment\ninput memory:brief.md\noutput project:dist/a file.txt\nevidence memory:qa/proof.txt\ncheck 30 npm test'), [])
  for (const line of ['input /abs', 'output project:../escape', 'evidence memory:', 'output project:a//b', 'check 0 test', 'check 90000 test', 'check 10', 'unknown value']) {
    assert.equal(b.contractProblems(line).length, 1, line)
  }
  const dir = join(FIX, 'system/playbooks/feature/contracts')
  mkdirSync(dir)
  writeFileSync(join(dir, 'build'), 'output project:../escape\n')
  writeFileSync(join(dir, 'missing-phase'), 'check 30 npm test\n')
  const messages = b.lint().map(f => f.msg).join('\n')
  assert.match(messages, /traversing/)
  assert.match(messages, /contracts require an agent phase/)
  rmSync(dir, { recursive: true })
})
/* Orphan-role warnings are filtered: the fixture lays the examples over the live
   system/, so an example playbook shadows a real one of the same name and any role only
   that real playbook used now reads as unused. That is a property of the fixture, not
   of lint — the rule itself is asserted in the next test. Everything else stays strict. */
it('a review cannot be its own fixer', () => {
  pb('selffix', 'Fixture with a reviewer fixing itself.', [['review', 'code-reviewer', 'code-reviewer']])
  assert.match(b.lint().map(f => f.msg).join('\n'), /cannot fix its own findings/)
  rmSync(join(FIX, 'system/playbooks/selffix'), { recursive: true })
})
it('clean fixture is silent', () =>
  assert.deepEqual(b.lint().filter(f => !/is not used by any playbook/.test(f.msg)), []))
it('does not call a role brain runs itself unused — playbook-author has no phases row', () => {
  const src = readFileSync(join(FIX, 'system/roles.conf'), 'utf8')
  writeFileSync(join(FIX, 'system/roles.conf'), src + 'lonely-role         claude   sonnet\n')
  const msgs = b.lint().map(f => f.msg)
  writeFileSync(join(FIX, 'system/roles.conf'), src)
  assert.ok(msgs.some(m => /'lonely-role' is not used/.test(m)), 'a genuinely orphaned role must still warn')
  assert.ok(!msgs.some(m => /playbook-author/.test(m)), 'playbook-author is invoked by brain playbook new')
})
it('catches a role step that uses a skill the role never declared', () => {
  const f = join(FIX, 'system/roles/designer.md')
  const src = readFileSync(f, 'utf8')
  // Not 'brain': the fixture declares it below, which would make the test assert nothing.
  const skill = b.skills().declared.map(d => d.name).find(n => n !== 'brain')
  // Cites a real skill in a step, but the Skills: line names nothing.
  writeFileSync(f, `# Role: designer\nSkills: brain\nDo:\n1. Check your work with the \`${skill}\` skill.\n`)
  let msgs = b.lint().map(x => x.msg)
  assert.ok(msgs.some(m => new RegExp(`'designer' tells the agent to use the '${skill}' skill`).test(m)),
    'a step naming an undeclared skill must warn')

  // Declared: silent. This is the pairing the rule exists to keep honest.
  writeFileSync(f, `# Role: designer\nSkills: ${skill}, brain\nDo:\n1. Check your work with the \`${skill}\` skill.\n`)
  msgs = b.lint().map(x => x.msg)
  assert.ok(!msgs.some(m => /tells the agent to use/.test(m)), 'declaring the skill must silence it')

  // A role that writes roles quotes skill names as examples; that is not a mismatch.
  const ra = join(FIX, 'system/roles/role-author.md')
  const had = existsSync(ra) ? readFileSync(ra, 'utf8') : null
  writeFileSync(ra, `# Role: role-author\nSkills: brain\nName the skill in the step, e.g. the \`${skill}\` skill.\n`)
  assert.ok(!b.lint().some(x => /'role-author' tells the agent/.test(x.msg)),
    'a role-authoring role quoting a skill name is an example, not a missing declaration')
  if (had === null) rmSync(ra); else writeFileSync(ra, had)
  writeFileSync(f, src)
})
console.log('proposals and evolve')
it('moves a proposal between headings by its exact text, and only a real one', () => {
  const src = '# Proposals\n\n## Accepted\n\n## Open\n\n- [a] one (demo, 2026-09-23)\n\n- [b] two (other, 2026-09-23)\n'
  const acc = b.moveProposal(src, '- [a] one (demo, 2026-09-23)', 'Open', 'Accepted')
  assert.deepEqual(b.proposals(acc).Accepted, ['- [a] one (demo, 2026-09-23)'], 'what brain evolve will apply')
  assert.deepEqual(b.proposals(acc).Open, ['- [b] two (other, 2026-09-23)'])
  assert.ok(!/\n\n\n/.test(acc), 'removing a line leaves no double gap')
  // A proposals.md from before Declined existed gains the heading on first use.
  const dec = b.moveProposal(acc, '- [b] two (other, 2026-09-23)', 'Open', 'Declined')
  assert.match(dec, /\n## Declined\n\n- \[b\] two/)
  assert.deepEqual(b.proposals(dec).Declined, ['- [b] two (other, 2026-09-23)'])
  assert.deepEqual(b.proposals(b.moveProposal(dec, '- [b] two (other, 2026-09-23)', 'Declined', 'Open')).Open, ['- [b] two (other, 2026-09-23)'])
  throws(() => b.moveProposal(src, '- [a] one (demo, 2026-09-23)', 'Accepted', 'Open'), /no longer under ## Accepted/)
  throws(() => b.moveProposal(src, '- [a] one', 'Open', 'Accepted'), /no longer under/)
  throws(() => b.moveProposal(src, '- [a] one (demo, 2026-09-23)', 'Open', 'Shipped'), /cannot move/)
})
it('asks `brain watch` for brain evolve only when something is accepted', () => {
  const f = join(FIX, 'memory/proposals.md'), req = join(FIX, 'memory/.evolve-request')
  writeFileSync(f, '# P\n\n## Accepted\n\n## Open\n- [a] one (demo, 2026-09-23)\n')
  throws(() => b.requestEvolve(), /nothing accepted/)
  assert.ok(!existsSync(req), 'a refused click leaves nothing for the watcher')
  writeFileSync(f, b.moveProposal(readFileSync(f, 'utf8'), '- [a] one (demo, 2026-09-23)', 'Open', 'Accepted'))
  const r = b.requestEvolve()
  assert.equal(r.accepted, 1)
  assert.equal(readFileSync(req, 'utf8').trim(), 'evolve')
  assert.equal(b.state().evolvePending, true, 'the button stays pressed until the watcher takes it')
  rmSync(req); rmSync(f)
})
it('files a proposal under the playbook it would change, by its target alone', () => {
  writeFileSync(join(FIX, 'memory/proposals.md'), '# P\n\n## Accepted\n\n## Open\n' +
    '- [system/playbooks/feature/playbook.md, `qa`] a (demo, 2026-09-23)\n' +
    '- [system/roles/builder.md step 2] b — evidence in roles/html-designer.md (demo, 2026-09-23)\n' +
    '- [system/roles/html-designer.md] c — evidence in playbooks/feature (demo, 2026-09-23)\n' +
    '- [system/skills/visual-qa] d (demo, 2026-09-23)\n')
  assert.deepEqual(b.playbooks().find(p => p.name === 'feature').proposals.Open.map(l => l.match(/\] (\w)/)[1]), ['a', 'b'],
    'its folder and the roles its phases run; a mention in the evidence is not a target')
  assert.deepEqual(b.playbooks().find(p => p.name === 'rebuild-payload').proposals.Open.map(l => l.match(/\] (\w)/)[1]), ['c'])
  rmSync(join(FIX, 'memory/proposals.md'))
})
it('asks `brain watch` to analyse a playbook only by a real playbook name', () => {
  const req = join(FIX, 'memory/.evolve-request')
  assert.equal(b.requestAnalysis('feature').started, 'playbook analyse feature', 'no accepted queue needed: it only files proposals')
  assert.equal(readFileSync(req, 'utf8').trim(), 'analyse feature')
  rmSync(req)
  // The name lands in a shell command on the host.
  for (const bad of ['nope', 'feature; rm -rf ~', '../feature', undefined]) throws(() => b.requestAnalysis(bad), /no playbook/)
  assert.ok(!existsSync(req))
})
it('evolves one playbook only when something is accepted for it, and names it for the host', () => {
  const f = join(FIX, 'memory/proposals.md'), req = join(FIX, 'memory/.evolve-request')
  writeFileSync(f, '# P\n\n## Accepted\n- [system/playbooks/feature-x/phases] a prefix, not feature (demo, 2026-09-23)\n- [system/skills/x] no playbook (demo, 2026-09-23)\n\n## Open\n')
  throws(() => b.requestEvolve('feature'), /nothing accepted for feature/)
  assert.ok(!existsSync(req), 'accepted lines for other playbooks do not make this one runnable')
  writeFileSync(f, readFileSync(f, 'utf8').replace('## Accepted\n', '## Accepted\n- [system/roles/builder.md] mine (demo, 2026-09-23)\n'))
  const r = b.requestEvolve('feature')
  assert.equal(r.accepted, 1, 'the count the button shows is the playbook\'s, not the queue\'s')
  assert.equal(readFileSync(req, 'utf8').trim(), 'evolve feature')
  for (const bad of ['nope', 'feature; rm -rf ~']) throws(() => b.requestEvolve(bad), /no playbook/)
  rmSync(req); rmSync(f)
})
it("shows a project the memory it left behind, and nobody else's", () => {
  mkdirSync(join(FIX, 'memory/knowledge'), { recursive: true })
  writeFileSync(join(FIX, 'memory/knowledge/p.md'), '# P\nWhat we know.\n\n## Sources\n- projects/demo/phases/qa.md\n')
  writeFileSync(join(FIX, 'memory/knowledge/q.md'), '# Q\nOther.\n\n## Sources\n- projects/demo-two/phases/qa.md\n')
  writeFileSync(join(FIX, 'memory/log.md'), '# Log\n\n## [2026-09-23] retro | demo\nThree pages.\n## [2026-09-23] qa | demo-two round 1\n')
  writeFileSync(join(FIX, 'memory/proposals.md'), '# P\n\n## Accepted\n- [x] mine (demo, 2026-09-23)\n\n## Open\n- [y] theirs (demo-two, 2026-09-23)\n')
  const m = b.projects().find(p => p.name === 'demo').memory
  assert.deepEqual(m.knowledge, ['p'], 'demo-two is a different project, not a prefix match')
  assert.deepEqual(m.log, [{ head: '[2026-09-23] retro | demo', body: 'Three pages.' }])
  assert.deepEqual(m.proposals, { Open: [], Accepted: ['- [x] mine (demo, 2026-09-23)'], Declined: [] })
  for (const f of ['knowledge/p.md', 'knowledge/q.md', 'log.md', 'proposals.md']) rmSync(join(FIX, 'memory', f))
})

console.log('from the browser: projects, runs, drafts')
it('stages a project for brain watch with the brief answers under their headings', () => {
  pb('seo', 'Fixture SEO path.', [['research', 'planner'], ['draft', 'builder'], ['final', 'human', 'builder']])
  writeFileSync(join(FIX, 'system/playbooks/seo/brief.md'), '# Brief\n\n## Keyword\n<!-- the search term -->\n\n## Competitor pages\n<!-- one URL\n     per line -->\n- \n\n## Stack\n- \n')
  assert.deepEqual(b.briefForm('seo'), { inputs: [], clientInputs: [], sections: [{ heading: 'Keyword', hint: 'the search term' }, { heading: 'Competitor pages', hint: 'one URL per line' }, { heading: 'Stack', hint: '' }] })
  const r = b.createProject({ playbook: 'seo', name: 'Heat Pump Cost', client: 'Northwind', brief: { Keyword: 'heat pump cost 2026', 'Competitor pages': 'https://a.example\nhttps://b.example' }, then: 'auto' })
  assert.equal(r.project, 'heat-pump-cost', 'slugified the way brain new slugs the directory')
  const st = join(FIX, 'memory/.new/heat-pump-cost')
  assert.equal(readFileSync(join(st, 'request'), 'utf8'), 'seo heat-pump-cost northwind\n')
  assert.equal(readFileSync(join(st, 'then'), 'utf8'), 'auto\n')
  assert.match(readFileSync(join(st, 'brief.md'), 'utf8'),
    /^# Brief\n\n## Keyword\nheat pump cost 2026\n\n## Competitor pages\nhttps:\/\/a\.example\nhttps:\/\/b\.example\n\n## Stack\n- \n/, 'answered headings get the answer, the rest keep the template, as fill_brief writes it')
  assert.deepEqual(b.state().pending.new, [{ slug: 'heat-pump-cost', playbook: 'seo', client: 'northwind', error: null }])
  throws(() => b.createProject({ playbook: 'seo', name: 'heat-pump-cost' }), /already being created/)
  writeFileSync(join(st, 'error'), 'brain: boom\n')
  assert.equal(b.state().pending.new[0].error, 'brain: boom', 'the host\'s refusal is shown, not retried')
  assert.equal(b.createProject({ playbook: 'seo', name: 'heat-pump-cost' }).project, 'heat-pump-cost', 'and can be tried again')
  assert.ok(!existsSync(join(st, 'then')), 'a retry without then leaves no stale then')
  throws(() => b.createProject({ playbook: 'seo', name: 'demo' }), /already exists/)
  throws(() => b.createProject({ playbook: 'nope', name: 'x' }), /no playbook/)
  throws(() => b.createProject({ playbook: 'seo', name: '!!!' }), /usable project name/)
  throws(() => b.createProject({ playbook: 'seo', name: 'ok', then: 'rm' }), /not a brain command/)
  b.discardPending('heat-pump-cost'); assert.ok(!existsSync(st))
  rmSync(join(FIX, 'system/playbooks/seo'), { recursive: true })
})
it('the Run button leaves the request a verdict does, and refuses a busy project', () => {
  const req = join(FIX, 'memory/projects/demo/.run-request')
  assert.equal(b.startRun('demo', 'auto').started, 'auto')
  assert.equal(readFileSync(req, 'utf8').trim(), 'auto')
  assert.equal(b.projects()[0].runPending, true, 'queued until brain watch takes it')
  rmSync(req)
  assert.equal(b.projects()[0].runPending, false)
  throws(() => b.startRun('demo', 'rm -rf'), /not a brain command/)
  throws(() => b.startRun('nope'), /no project/)
  const lease = join(FIX, 'memory/projects/demo/phases/map.running')
  writeFileSync(lease, 'x\n')
  throws(() => b.startRun('demo'), /already running/)
  rmSync(lease)
  assert.ok(!existsSync(req))
})
it('asks the author for a draft, shows it, and installs both halves of each proposed role', () => {
  const r = b.requestDraft({ name: 'seo-article', description: 'Research, draft, check, you approve.' })
  assert.equal(r.again, false)
  const dir = join(FIX, '.drafts/playbook/seo-article')
  assert.equal(readFileSync(join(dir, 'REQUEST.md'), 'utf8'), 'Research, draft, check, you approve.\n')
  assert.equal(readFileSync(join(FIX, 'memory/.draft-request'), 'utf8').trim(), 'seo-article')
  assert.equal(b.state().pending.draft, 'seo-article')
  assert.deepEqual(b.state().pending.drafts, [{ name: 'seo-article', pending: true, exists: false }])
  assert.equal(b.draft('seo-article').exists, false)
  throws(() => b.requestDraft({ name: 'seo-article', description: 'again' }), /already working/)
  throws(() => b.requestDraft({ name: 'feature', description: 'x' }), /already exists/)
  throws(() => b.requestDraft({ name: 'Bad Name', description: 'x' }), /usable playbook name/)
  throws(() => b.installDraft({ name: 'seo-article' }), /no draft/)
  // The author writes, in its Terminal window.
  writeFileSync(join(dir, 'phases'), '# phase        role              fix-role\nresearch       planner\ndraft          seo-writer\ncheck          seo-editor        seo-writer\nfinal          human             seo-writer\n')
  writeFileSync(join(dir, 'playbook.md'), '# Playbook: seo-article\n> One article per keyword.\n\nPreamble.\n\n## research\nR.\n\n## draft\nD.\n\n## check\nC.\n\n## final\nF.\n')
  mkdirSync(join(dir, 'roles'), { recursive: true })
  writeFileSync(join(dir, 'roles/seo-writer.md'), '# Role: seo-writer\nWrites.\n')
  writeFileSync(join(dir, 'roles/seo-editor.md'), '# Role: seo-editor\nChecks.\n')
  mkdirSync(join(dir, 'contracts'), { recursive: true })
  writeFileSync(join(dir, 'contracts/draft'), 'output memory:content/article.md\n')
  throws(() => b.installDraft({ name: 'seo-article' }), /still working/)
  throws(() => b.discardDraft('seo-article'), /still working/)
  rmSync(join(dir, 'REQUEST.md'))
  const d = b.draft('seo-article')
  assert.equal(d.pending, false)
  assert.equal(d.description, 'One article per keyword.')
  assert.deepEqual(d.phases.map(p => [p.phase, p.role, p.fix]), [['research', 'planner', ''], ['draft', 'seo-writer', ''], ['check', 'seo-editor', 'seo-writer'], ['final', 'human', 'seo-writer']])
  assert.match(d.phases[1].section, /D\./)
  assert.deepEqual(d.roles.map(x => x.name), ['seo-editor', 'seo-writer'])
  assert.deepEqual(d.problems.filter(p => p.level === 'error'), [], 'a role the draft proposes is not a missing role')
  assert.equal(b.requestDraft({ name: 'seo-article', description: 'add a fact check' }).again, true, 'a second round revises instead of starting over')
  rmSync(join(dir, 'REQUEST.md')); rmSync(join(FIX, 'memory/.draft-request'))
  throws(() => b.installDraft({ name: 'seo-article', roles: { 'seo-writer': { engine: 'bash' } } }), /engines\.conf/)
  const inst = b.installDraft({ name: 'seo-article', roles: { 'seo-writer': { engine: 'codex', model: 'gpt-6-astra', effort: 'high' } } })
  assert.deepEqual(inst.roles, ['seo-editor', 'seo-writer'])
  assert.ok(existsSync(join(FIX, 'system/playbooks/seo-article/phases')) && existsSync(join(FIX, 'system/playbooks/seo-article/brief.md')), 'the playbook, with a brief even when the author wrote none')
  assert.equal(readFileSync(join(FIX, 'system/playbooks/seo-article/contracts/draft'), 'utf8'), 'output memory:content/article.md\n', 'its phase contracts come along')
  assert.ok(!existsSync(dir), 'the draft is consumed')
  const conf = readFileSync(join(FIX, 'system/roles.conf'), 'utf8')
  assert.match(conf, /^seo-writer\s+codex\s+gpt-6-astra\s+high$/m, 'the human\'s engine, model and effort')
  assert.match(conf, /^seo-editor\s+claude\s+default$/m, 'the default when nothing was chosen')
  assert.equal(readFileSync(join(FIX, 'system/roles/seo-writer.md'), 'utf8'), '# Role: seo-writer\nWrites.\n')
  assert.equal(readFileSync(join(FIX, 'memory/.commit-request'), 'utf8').trim(), 'playbook: seo-article (installed from the cockpit)')
  assert.equal(b.state().pending.commit, true)
  assert.deepEqual(b.lint().filter(f => f.where.includes('seo-article') || /seo-(writer|editor)/.test(f.msg)), [], 'installed clean')
  throws(() => b.requestDraft({ name: 'seo-article', description: 'x' }), /already exists/)
  rmSync(join(FIX, 'system/playbooks/seo-article'), { recursive: true }); rmSync(join(FIX, 'memory/.commit-request'))
  for (const role of ['seo-writer', 'seo-editor']) b.deleteRole(role)
  // A draft nobody wants.
  b.requestDraft({ name: 'scrap', description: 'never mind' }); rmSync(join(FIX, '.drafts/playbook/scrap/REQUEST.md'))
  assert.equal(b.discardDraft('scrap').discarded, 'scrap')
  assert.ok(!existsSync(join(FIX, 'memory/.draft-request')), 'and the watcher is not asked for it')
})

it('adjusts an installed playbook: the draft starts as its copy, says what changed, and installs over it', () => {
  pb('tune', 'Fixture path to adjust.', [['plan', 'planner'], ['build', 'builder'], ['review', 'code-reviewer', 'builder']], { 'playbook.env': 'TEMPLATE_REPO=https://example.com/t.git\n' })
  const live = join(FIX, 'system/playbooks/tune'), dir = join(FIX, '.drafts/playbook/tune')
  mkdirSync(join(live, 'contracts')); writeFileSync(join(live, 'contracts/build'), 'output memory:out.md\n')
  throws(() => b.requestDraft({ name: 'tune', description: 'x' }), /already exists/)
  throws(() => b.requestDraft({ name: 'tune', description: ' ', adjust: true }), /what should change/)
  assert.equal(b.requestDraft({ name: 'tune', description: 'drop the plan, add a qa check', adjust: true }).again, true, 'the author revises the copy')
  assert.equal(readFileSync(join(dir, 'phases'), 'utf8'), readFileSync(join(live, 'phases'), 'utf8'))
  assert.ok(existsSync(join(dir, 'contracts/build')), 'its checks come with the copy')
  assert.ok(!existsSync(join(dir, 'playbook.env')), 'never playbook.env: brain new sources it on the host')
  assert.ok(b.draft('tune').phases.every(p => p.change === ''), 'an untouched copy changes nothing')
  // The author writes, in its Terminal window.
  writeFileSync(join(dir, 'phases'), 'build          builder\nreview         code-reviewer     builder\nqa             qa                builder\n')
  writeFileSync(join(dir, 'playbook.md'), '# Playbook: tune\n> Fixture path to adjust.\n\nWhat every agent on this path should know.\n\n## build\nBuild it smaller.\n\n## review\nWhat review does and its gate.\n\n## qa\nTry it.\n')
  writeFileSync(join(dir, 'playbook.env'), 'TEMPLATE_REPO=$(touch /tmp/pwned)\n')
  rmSync(join(dir, 'contracts'), { recursive: true })
  rmSync(join(dir, 'REQUEST.md')); rmSync(join(FIX, 'memory/.draft-request'))
  const d = b.draft('tune')
  assert.equal(d.installed, true)
  assert.deepEqual(d.phases.map(p => [p.phase, p.change]), [['build', 'changed'], ['review', ''], ['qa', 'new']])
  assert.deepEqual(d.removed, ['plan'])
  assert.deepEqual(d.alsoChanged, [])
  b.installDraft({ name: 'tune' })
  assert.equal(readFileSync(join(live, 'phases'), 'utf8'), 'build          builder\nreview         code-reviewer     builder\nqa             qa                builder\n')
  assert.match(readFileSync(join(live, 'playbook.md'), 'utf8'), /Build it smaller/)
  assert.equal(readFileSync(join(live, 'playbook.env'), 'utf8'), 'TEMPLATE_REPO=https://example.com/t.git\n', 'the installed playbook.env is left alone')
  assert.ok(!existsSync(join(live, 'contracts')), 'a check the adjustment dropped is gone')
  assert.ok(!existsSync(dir), 'the draft is consumed')
  assert.equal(readFileSync(join(FIX, 'memory/.commit-request'), 'utf8').trim(), 'playbook: tune (adjusted from the cockpit)')
  // Asked again and thought better of: the playbook stays as it is.
  b.requestDraft({ name: 'tune', description: 'never mind', adjust: true }); rmSync(join(dir, 'REQUEST.md'))
  b.discardDraft('tune')
  assert.match(readFileSync(join(live, 'playbook.md'), 'utf8'), /Build it smaller/)
  rmSync(live, { recursive: true }); rmSync(join(FIX, 'memory/.commit-request')); rmSync(join(FIX, 'memory/.draft-request'), { force: true })
})

console.log('inputs: what a project is handed')
it('reads an inputs file and names every way it can be wrong', () => {
  const ok = b.parseInputs('# input type per need label\nkeyword  text  project  yes  Primary keyword\nlang  choice:en,de  project  no  Language\ncompetitors  urls  client  no  Competitors we want to beat\n')
  assert.deepEqual(ok.problems, [])
  assert.deepEqual(ok.inputs.map(i => [i.name, i.type, i.options, i.per, i.required, i.label]), [
    ['keyword', 'text', [], 'project', true, 'Primary keyword'],
    ['lang', 'choice', ['en', 'de'], 'project', false, 'Language'],
    ['competitors', 'urls', [], 'client', false, 'Competitors we want to beat']])
  const bad = b.parseInputs('a text project yes\nB text project yes Bee\nc colour project yes Cee\nd choice:x project yes Dee\ne url team maybe Eee\nf text project no Eee\ng url:x project no Gee # note\nc text project no Cee two\n')
  const msgs = bad.problems.map(p => p[1]).join('\n')
  for (const re of [/needs five columns/, /not a usable input name/, /type 'colour'/, /at least two options/, /per is 'project' or 'client'/, /need is 'yes' or 'no'/, /used twice/, /only a choice takes options/, /'#' in the label/, /appears twice/])
    assert.match(msgs, re)
})
it('takes the URLs people actually paste, and refuses what an agent would fail on', () => {
  assert.equal(b.normUrl('example.com/page'), 'https://example.com/page', 'the scheme is added')
  assert.equal(b.normUrl(' https://www.example.com '), 'https://www.example.com/')
  assert.equal(b.normUrl('http://example.com/a?b=1'), 'http://example.com/a?b=1')
  for (const bad of ['solarbattery guide', 'localhost:3000', 'ftp://example.com', 'javascript:alert(1)', 'mailto:a@b.c', 'notaurl', '']) assert.equal(b.normUrl(bad), null, bad)
})
it('saves the inputs editor as a file brain playbook check accepts, and gives each its brief heading', () => {
  pb('seo2', 'Fixture SEO path with inputs.', [['research', 'planner'], ['final', 'human', 'builder']])
  const r = b.setInputs({ playbook: 'seo2', prev: '', inputs: [
    { label: 'Primary keyword', type: 'text', per: 'project', required: true },
    { label: 'Language', type: 'choice', options: ['en', 'de'], per: 'project', required: true },
    { label: 'Competitor pages', type: 'urls', per: 'project' },
    { label: 'Brief document', type: 'files', per: 'project' },
    { label: 'Competitors', type: 'urls', per: 'client', required: true },
    { label: 'Brand guidelines', type: 'files', per: 'client' }] })
  assert.deepEqual(r.inputs.map(i => i.name), ['primary-keyword', 'language', 'competitor-pages', 'brief-document', 'competitors', 'brand-guidelines'], 'names come from the labels')
  assert.match(readFileSync(join(FIX, 'system/playbooks/seo2/inputs'), 'utf8'), /^language\s+choice:en,de\s+project\s+yes\s+Language$/m)
  const brief = readFileSync(join(FIX, 'system/playbooks/seo2/brief.md'), 'utf8')
  for (const h of ['Primary keyword', 'Language', 'Competitor pages', 'Brief document']) assert.match(brief, new RegExp(`^## ${h}$`, 'm'), `brain new at a terminal asks ${h} too`)
  assert.ok(!/## Competitors$/m.test(brief), 'a per-client input is not a project question')
  assert.deepEqual(b.lint().filter(f => f.where.includes('seo2')), [], 'lint-clean')
  throws(() => b.setInputs({ playbook: 'seo2', prev: 'stale', inputs: [] }), /changed on disk/)
  throws(() => b.setInputs({ playbook: 'seo2', prev: r.content, inputs: [{ label: 'Lang', type: 'choice', options: ['English UK', 'de'], per: 'project' }] }), /single word/)
  throws(() => b.setInputs({ playbook: 'seo2', prev: r.content, inputs: [{ label: '', type: 'text', per: 'project' }] }), /needs a label/)
  throws(() => b.setInputs({ playbook: 'seo2', prev: r.content, inputs: [{ label: 'X', type: 'colour', per: 'project' }] }), /not one of/)
  assert.equal(readFileSync(join(FIX, 'system/playbooks/seo2/inputs'), 'utf8'), r.content, 'a refused save writes nothing')
  // A heading the file lost is reported, not silently assumed.
  writeFileSync(join(FIX, 'system/playbooks/seo2/brief.md'), '# Brief\n')
  assert.match(b.lint().filter(f => f.where.includes('seo2')).map(f => f.msg).join('\n'), /input 'primary-keyword' has no '## Primary keyword' heading/)
  writeFileSync(join(FIX, 'system/playbooks/seo2/brief.md'), brief)
  writeFileSync(join(FIX, 'system/playbooks/seo2/inputs'), r.content + 'oops url project\n')
  assert.match(b.lint().map(f => `${f.where} ${f.msg}`).join('\n'), /playbooks\/seo2\/inputs:\d+ 'oops' needs five columns/)
  writeFileSync(join(FIX, 'system/playbooks/seo2/inputs'), r.content)
})
it('without the clients app: no clients, a per-client input asked per project, no client accepted', () => {
  renameSync(join(FIX, 'system/apps/clients'), join(FIX, 'clients-app'))
  try {
    assert.equal(b.clientsOn(), false); assert.deepEqual(b.clients(), [])
    const f = b.briefForm('seo2')
    assert.deepEqual(f.clientInputs, []); assert.ok(f.inputs.some(i => i.label === 'Competitors'), 'asked with the project instead')
    throws(() => b.clientInputs('northwind', 'seo2'), /clients are an app/)
    throws(() => b.createProject({ playbook: 'seo2', name: 'x-guide', client: 'northwind', values: {} }), /clients are an app/)
    assert.equal(b.state().clientsOn, false)
  } finally { renameSync(join(FIX, 'clients-app'), join(FIX, 'system/apps/clients')) }
})
it('keeps per-client answers in the client profile, every one checked before any is written', () => {
  throws(() => b.saveClientInputs({ client: 'northwind', playbook: 'seo2', values: { competitors: 'a.example.com nope' } }), /Competitors: not a web address: 'nope'/)
  assert.ok(!existsSync(join(FIX, 'memory/clients/northwind/profile.md')), 'nothing half-saved')
  const r = b.saveClientInputs({ client: 'Northwind', playbook: 'seo2', values: { competitors: 'a.example.com\nhttps://b.example.com/x a.example.com' } })
  assert.equal(r.client, 'northwind')
  const prof = readFileSync(join(FIX, 'memory/clients/northwind/profile.md'), 'utf8')
  assert.match(prof, /^# Client: northwind\n\n## Competitors\n- https:\/\/a\.example\.com\/\n- https:\/\/b\.example\.com\/x\n$/, 'deduplicated, schemes added, under the label')
  assert.equal(r.inputs.find(i => i.name === 'competitors').value, 'https://a.example.com/\nhttps://b.example.com/x', 'read back the way the form shows it')
  const up = b.addSource({ client: 'northwind', playbook: 'seo2', input: 'brand-guidelines', name: 'Brand Book.pdf', data: Buffer.from('%PDF').toString('base64') })
  assert.match(up.file, /^memory\/clients\/northwind\/sources\/\d{4}-\d\d-\d\d-brand-book\.pdf$/)
  assert.match(readFileSync(join(FIX, 'memory/clients/northwind/profile.md'), 'utf8'), /## Brand guidelines\n- sources\/\d{4}-\d\d-\d\d-brand-book\.pdf\n/)
  assert.deepEqual(b.clientInputs('northwind', 'seo2').inputs.find(i => i.name === 'brand-guidelines').value, [up.name])
  throws(() => b.addSource({ client: 'northwind', playbook: 'seo2', input: 'competitors', name: 'x.pdf', data: 'eA==' }), /not a per-client file input/)
  assert.match(b.addSource({ client: '../etc', name: 'x.pdf', data: 'eA==' }).file, /^memory\/clients\/etc\/sources\//, 'a client name is slugified, so it cannot climb out of memory/clients')
  throws(() => b.addSource({ client: '../..', name: 'x.pdf', data: 'eA==' }), /usable client slug/)
})
it('archives a client, restores it, and deletes one for good, never under an unfinished project', () => {
  b.saveClientInputs({ client: 'oldco', playbook: 'seo2', values: { competitors: 'a.example.com' } })
  const pdir = join(FIX, 'memory/projects/oldco-guide')
  mkdirSync(pdir, { recursive: true })
  writeFileSync(join(pdir, 'project.env'), 'PLAYBOOK=seo2\nCLIENT=oldco\nCREATED=2026-01-01\n')
  try {
    throws(() => b.archiveClient('oldco'), /oldco-guide is still running/)
    throws(() => b.deleteClient({ client: 'oldco', confirm: 'oldco' }), /oldco-guide is still running/)
    assert.ok(existsSync(join(FIX, 'memory/clients/oldco/profile.md')), 'nothing moved')
  } finally { rmSync(pdir, { recursive: true }) }
  assert.deepEqual(b.archiveClient('OldCo'), { archived: 'oldco', path: 'memory/archive/clients/oldco' })
  assert.ok(!existsSync(join(FIX, 'memory/clients/oldco')))
  assert.match(readFileSync(join(FIX, 'memory/archive/clients/oldco/profile.md'), 'utf8'), /## Competitors/, 'kept, not erased')
  assert.ok(!b.clients().some(c => c.slug === 'oldco'))
  assert.deepEqual(b.archivedClients().map(c => c.name), ['oldco'])
  b.saveClientInputs({ client: 'oldco', playbook: 'seo2', values: {} })
  throws(() => b.restoreClient('oldco'), /exists already/)
  const second = b.archiveClient('oldco').archived
  assert.match(second, /^oldco-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/, 'a second archive does not overwrite the first')
  assert.deepEqual(b.archivedClients().map(c => c.slug), ['oldco', 'oldco'])
  throws(() => b.archiveClient('oldco'), /no client 'oldco'/)
  throws(() => b.restoreClient('../projects'), /no archived client/)
  assert.deepEqual(b.restoreClient('oldco'), { restored: 'oldco' })
  assert.match(readFileSync(join(FIX, 'memory/clients/oldco/profile.md'), 'utf8'), /## Competitors/, 'back where it was')
  throws(() => b.deleteClient({ client: 'oldco', confirm: 'oldc' }), /type oldco to confirm/)
  assert.ok(existsSync(join(FIX, 'memory/clients/oldco')), 'a wrong confirm deletes nothing')
  assert.deepEqual(b.deleteClient({ client: 'oldco', confirm: 'oldco' }), { deleted: 'oldco' })
  assert.ok(!existsSync(join(FIX, 'memory/clients/oldco')))
  throws(() => b.deleteClient({ archived: second }), /type oldco to confirm/)
  b.deleteClient({ archived: second, confirm: 'oldco' })
  assert.deepEqual(b.archivedClients(), [])
})
it('turns the form into a brief: typed answers under their labels, staged files listed, nothing written on a bad answer', () => {
  const st = join(FIX, 'memory/.new/battery-guide')
  const up = b.addSource({ staged: 'battery-guide', name: 'notes.docx', data: Buffer.from('x').toString('base64') })
  assert.ok(existsSync(join(st, 'sources', up.name)), 'a file waits beside the staged project')
  throws(() => b.createProject({ playbook: 'seo2', name: 'battery-guide', client: 'northwind', values: { 'primary-keyword': 'solar battery', language: 'fr' } }), /Language: pick one of en, de/)
  throws(() => b.createProject({ playbook: 'seo2', name: 'battery-guide', client: 'northwind', values: { language: 'en' } }), /Primary keyword is required/)
  throws(() => b.createProject({ playbook: 'seo2', name: 'battery-guide', values: { 'primary-keyword': 'x', language: 'en' } }), /once per client for Competitors — name the client/)
  throws(() => b.createProject({ playbook: 'seo2', name: 'battery-guide', client: 'acme', values: { 'primary-keyword': 'x', language: 'en' } }), /acme has no Competitors yet/)
  throws(() => b.createProject({ playbook: 'seo2', name: 'battery-guide', client: 'northwind', values: { 'primary-keyword': 'x', language: 'en' }, files: { 'brief-document': ['missing.pdf'] } }), /was not uploaded/)
  assert.ok(!existsSync(join(st, 'request')), 'refusals stage nothing')
  b.createProject({ playbook: 'seo2', name: 'battery-guide', client: 'northwind', then: 'auto',
    values: { 'primary-keyword': '  is a solar battery\nworth it ', language: 'en', 'competitor-pages': 'energy.example/guide' },
    files: { 'brief-document': [up.name] } })
  const brief = readFileSync(join(st, 'brief.md'), 'utf8')
  assert.match(brief, /## Primary keyword\nis a solar battery worth it\n/, 'a text answer is one line')
  assert.match(brief, /## Language\nen\n/)
  assert.match(brief, /## Competitor pages\n- https:\/\/energy\.example\/guide\n/)
  assert.match(brief, new RegExp(`## Brief document\\n- sources/${up.name}\\n`))
  assert.ok(existsSync(join(st, 'sources', up.name)), 'the upload survives staging')
  throws(() => b.addSource({ staged: 'battery-guide', name: 'late.pdf', data: 'eA==' }), /already being created/)
  b.discardPending('battery-guide')
  rmSync(join(FIX, 'memory/clients'), { recursive: true, force: true })
})
it('a drafted playbook brings its inputs, and the draft shows them', () => {
  b.requestDraft({ name: 'with-inputs', description: 'x' })
  const dir = join(FIX, '.drafts/playbook/with-inputs')
  rmSync(join(dir, 'REQUEST.md')); rmSync(join(FIX, 'memory/.draft-request'))
  writeFileSync(join(dir, 'phases'), 'plan           planner\n')
  writeFileSync(join(dir, 'playbook.md'), '# Playbook: with-inputs\n> d\n\n## plan\nP.\n')
  writeFileSync(join(dir, 'brief.md'), '# Brief\n\n## Keyword\n')
  writeFileSync(join(dir, 'inputs'), 'keyword  text  project  yes  Keyword\nlang  choice:en  project  no  Language\n')
  assert.match(b.draft('with-inputs').problems.map(p => p.msg).join('\n'), /at least two options/, 'the draft is checked like an installed playbook')
  throws(() => b.installDraft({ name: 'with-inputs' }), /problem to fix first/)
  writeFileSync(join(dir, 'inputs'), 'keyword  text  project  yes  Keyword\n')
  assert.deepEqual(b.draft('with-inputs').inputs.map(i => i.label), ['Keyword'])
  b.installDraft({ name: 'with-inputs' })
  assert.deepEqual(b.playbooks().find(p => p.name === 'with-inputs').inputs.map(i => i.name), ['keyword'])
  rmSync(join(FIX, 'system/playbooks/with-inputs'), { recursive: true }); rmSync(join(FIX, 'memory/.commit-request'))
  rmSync(join(FIX, 'system/playbooks/seo2'), { recursive: true })
})

it('catches each silent bin/brain failure', () => {
  const add = (f, s) => writeFileSync(join(FIX, f), readFileSync(join(FIX, f), 'utf8') + s)
  add('system/roles.conf', 'ghostrole\nDesigner            claude   opus\n')
  add('system/playbooks/feature/phases', 'build            builder\nnoroleatall\nmap              mapper                # note\n')
  const msgs = b.lint().map(f => f.msg).join('\n')
  for (const re of [/has 1 field\(s\)/, /case-insensitive/, /appears twice/, /vanishes from the pipeline/, /'#' on a data line/])
    assert.match(msgs, re)
})

{
  // The Article tab builds the paste with the seo-content skill's article.mjs, wherever an
  // installed app keeps it; the skill itself is tested in the seo app (test/article.test.mjs).
  const S = join(FIX, "system/apps/fixture-seo")
  mkdirSync(join(S, "skills/seo-content"), { recursive: true })
  writeFileSync(join(S, "app.conf"), "name fixture-seo\nversion 1.0.0\nbrain >= 2\n")
  writeFileSync(join(S, "skills/seo-content/SKILL.md"), "---\nname: seo-content\ndescription: x\n---\n")
  writeFileSync(join(S, "skills/seo-content/article.mjs"), "export const articleHtml = t => ({ fields: { slug: (t.match(/^slug: (.*)$/m) || [])[1] }, body: '', images: [], tables: [], schema: '' })\n")
  mkdirSync(join(FIX, "memory/projects/demo/content"), { recursive: true })
  writeFileSync(join(FIX, "memory/projects/demo/content/article.md"), "---\ntitle: T\nslug: solar-battery-worth-it\n---\nBody.\n")
  const a = await b.article("demo")
  it("a project with content/article.md has an Article tab built by the installed skill", () => {
    assert.equal(b.projects().find(p => p.name === "demo").has.article, true)
    assert.equal(a.fields.slug, "solar-battery-worth-it")
    assert.equal(a.path, "memory/projects/demo/content/article.md")
  })
  rmSync(join(FIX, "memory/projects/demo/content"), { recursive: true }); rmSync(S, { recursive: true })
}

console.log('app pages: the scoped reader and the request stager')
{
  // An app that owns a kind, installed: what ui/main.js may read and stage for its projects.
  const W = join(FIX, 'dev/zz-thesis'), P = join(FIX, 'memory/projects/zz-thesis'), A = join(FIX, 'system/apps/academy')
  for (const d of ['notes', 'sources/smith2020beauty']) mkdirSync(join(W, d), { recursive: true })
  mkdirSync(join(A, 'ui'), { recursive: true }); mkdirSync(join(A, 'skills/academy/workspace'), { recursive: true })
  writeFileSync(join(A, 'app.conf'), 'name academy\nversion 1.0.0\nbrain >= 2\nkind academy\n')
  writeFileSync(join(A, 'ui/main.js'), 'export default () => {}\n')
  writeFileSync(join(A, 'skills/academy/workspace/profile.md'), '# Profile\n\n## Project\n<!-- What it is about. -->\n')
  writeFileSync(join(W, 'profile.md'), '# Profile\n\n## Project\nMaster thesis on beauty\n')
  writeFileSync(join(W, 'notes/smith2020beauty.md'), '# smith2020beauty\nRead: abstract only\n')
  writeFileSync(join(W, 'sources/smith2020beauty/paper.pdf'), 'pdf')
  writeFileSync(join(P, 'academy-lint.txt'), 'note one\n')
  const app = () => b.apps().find(x => x.name === 'academy')
  it('lists an app\'s projects of its kind with their run markers, and no playbook project', () => {
    assert.equal(app().kind, 'academy'); assert.equal(app().main, true)
    const w = app().projects.find(x => x.name === 'zz-thesis')
    assert.equal(w.visible, true); assert.equal(w.running, null); assert.equal(w.request, null)
    assert.ok(!app().projects.some(x => x.name === 'demo'))
    assert.ok(!b.state().projects.some(x => x.name === 'zz-thesis'), 'a kind\'s project is not a playbook project')
  })
  it('reads many files and folders in one call, text only, inside the workspace only', () => {
    const f = b.appRead({ app: 'academy', project: 'zz-thesis', paths: ['profile.md', 'notes/', 'sources/smith2020beauty/paper.pdf', 'nope.md'] }).files
    assert.match(f['profile.md'].content, /Master thesis/)
    assert.deepEqual(f['notes/'].entries.map(e => [e.name, e.dir]), [['smith2020beauty.md', false]])
    assert.equal(f['sources/smith2020beauty/paper.pdf'].content, undefined, 'a PDF is listed, not served'); assert.equal(f['nope.md'], null)
    throws(() => b.appRead({ app: 'academy', project: 'zz-thesis', paths: ['../../memory/proposals.md'] }), /escapes root/)
    assert.equal(b.appRead({ app: 'academy', project: 'zz-thesis', paths: ['academy-lint.txt'], where: 'memory' }).files['academy-lint.txt'].content, 'note one\n')
    assert.match(b.appRead({ app: 'academy', paths: ['skills/academy/workspace/profile.md'], where: 'app' }).files['skills/academy/workspace/profile.md'].content, /## Project/)
    throws(() => b.appRead({ app: 'academy', project: 'demo', paths: ['x'] }), /not a project of the academy app/)
    throws(() => b.appRead({ app: 'nope', project: 'zz-thesis', paths: [] }), /no app 'nope'/)
  })
  it('an optional integration can read only an explicitly linked playbook project', () => {
    const env = join(FIX, 'memory/projects/demo/project.env')
    const original = readFileSync(env, 'utf8')
    writeFileSync(env, original + '\nINTEGRATIONS=academy\n')
    const result = b.appRead({ app: 'academy', project: 'demo', paths: ['project.env'], where: 'memory' })
    assert.ok(result.files['project.env'].size > 0)
    writeFileSync(env, original)
    throws(() => b.appRead({ app: 'academy', project: 'demo', paths: ['project.env'], where: 'memory' }), /not a project/)
  })
  it('stages a run request, one at a time, files for the inbox and checked edits — only into memory/', () => {
    b.appRequest({ app: 'academy', project: 'zz-thesis', file: '.academy-request', content: 'talk\neditor\ncritique\nmy question\n' })
    assert.equal(readFileSync(join(P, '.academy-request'), 'utf8'), 'talk\neditor\ncritique\nmy question\n')
    assert.equal(app().projects.find(x => x.name === 'zz-thesis').request.split('\n')[0], 'talk')
    throws(() => b.appRequest({ app: 'academy', project: 'zz-thesis', file: '.academy-request', content: 'find\n\nx\n' }), /already queued/)
    rmSync(join(P, '.academy-request'))
    b.appRequest({ app: 'academy', project: 'zz-thesis', file: 'inbox/My-Paper.pdf', data: Buffer.from('pdf').toString('base64') })
    assert.ok(existsSync(join(P, 'inbox/My-Paper.pdf')))
    throws(() => b.appRequest({ app: 'academy', project: 'zz-thesis', file: 'profile.staged', content: 'x', prev: 'stale', against: 'profile.md' }), /changed since/)
    b.appRequest({ app: 'academy', project: 'zz-thesis', file: 'profile.staged', content: '# new', prev: readFileSync(join(W, 'profile.md'), 'utf8'), against: 'profile.md' })
    assert.equal(readFileSync(join(P, 'profile.staged'), 'utf8'), '# new\n')
    assert.deepEqual(app().projects.find(x => x.name === 'zz-thesis').edits, ['profile'])
    for (const file of ['project.env', 'phases/x.done', '.run-request', '.seo-request', 'inbox/../project.env', 'inbox/.hidden']) {
      throws(() => b.appRequest({ app: 'academy', project: 'zz-thesis', file, content: 'x' }), /stages/, file)
    }
    rmSync(join(P, 'inbox'), { recursive: true }); rmSync(join(P, 'profile.staged'))
  })
  it('stages a new project of the app\'s kind, with its files beside the request', () => {
    b.appRequest({ app: 'academy', new: 'My Thesis', files: { 'profile.md': '# Profile\n\n## Project\nA thesis\n' } })
    assert.equal(readFileSync(join(FIX, 'memory/.new/my-thesis/request'), 'utf8'), 'academy my-thesis\n')
    assert.match(readFileSync(join(FIX, 'memory/.new/my-thesis/profile.md'), 'utf8'), /A thesis/)
    throws(() => b.appRequest({ app: 'academy', new: 'zz-thesis' }), /already exists/)
    throws(() => b.appRequest({ app: 'academy', new: 'other', files: { '../x.md': 'x' } }), /takes <name>\.md files/)
    rmSync(join(FIX, 'memory/.new/my-thesis'), { recursive: true })
  })
  it('serves an app\'s own ui/ files and nothing beside them', () => {
    assert.equal(b.appUiFile('academy', 'main.js'), join(A, 'ui/main.js'))
    throws(() => b.appUiFile('academy', '../app.conf'), /escapes root/)
    throws(() => b.appUiFile('../system', 'x'), /bad app name/)
  })
  it('draws the brain\'s knowledge/ as a graph, with the links not written yet', () => {
    const g = b.knowledgeGraph()
    assert.ok(Array.isArray(g.nodes) && Array.isArray(g.edges))
    for (const x of g.edges) assert.ok(g.nodes.some(n => n.id === x.source) && g.nodes.some(n => n.id === x.target))
  })
  rmSync(A, { recursive: true })
}

console.log('app settings: secrets and settings from app.conf')
{
  const { createServer } = await import('node:http')
  const srv = createServer((q, r) => { r.statusCode = q.headers.authorization === `Basic ${Buffer.from('me:right').toString('base64')}` ? 200 : 401; r.end() })
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok))
  const A = join(FIX, 'system/apps/data')
  mkdirSync(A, { recursive: true })
  writeFileSync(join(A, 'app.conf'), `name data\nversion 1\nbrain >= 2\nmcp hub https://mcp.example.com/http\nsecret hub basic http://127.0.0.1:${srv.address().port}/me Hub login\nmcp tok https://t.example.com/mcp\nsecret tok bearer - A token\nsetting serp toggle on Live results\nsetting market choice de,fr,us Market\nallow a.example.com,b.example.com\n`)
  const conf = () => b.apps().find(x => x.name === 'data').config
  it('reads secrets, settings, servers and hosts from app.conf, with defaults', () => {
    const c = conf()
    assert.deepEqual(c.secrets.map(x => [x.name, x.kind, x.connected, x.pending]), [['hub', 'basic', false, false], ['tok', 'bearer', false, false]])
    assert.deepEqual(c.settings.map(x => [x.key, x.value]), [['serp', 'on'], ['market', 'de']])
    assert.deepEqual(c.allow, ['a.example.com', 'b.example.com'])
  })
  it('writes settings to system/config/<app>.conf, refusing an option the app does not offer', () => {
    b.saveAppSettings({ app: 'data', values: { serp: 'off', market: 'fr' } })
    assert.match(readFileSync(join(FIX, 'system/config/data.conf'), 'utf8'), /\nserp off\nmarket fr\n$/)
    assert.deepEqual(conf().settings.map(x => x.value), ['off', 'fr'])
    throws(() => b.saveAppSettings({ app: 'data', values: { market: 'xx' } }), /one of de, fr, us/)
  })
  const rejects = async (p, re) => { try { await p } catch (e) { assert.match(e.message, re); return } assert.fail('did not throw') }
  await rejects(b.saveAppSecret({ app: 'data', name: 'hub', login: 'me', password: 'wrong' }), /refused the key \(401\)/)
  assert.ok(!existsSync(join(FIX, 'memory/.secret-hub.request')), 'a refused key is not staged')
  await b.saveAppSecret({ app: 'data', name: 'hub', login: 'me', password: 'right' })
  const req = join(FIX, 'memory/.secret-hub.request')
  assert.equal(readFileSync(req, 'utf8'), Buffer.from('me:right').toString('base64') + '\n')
  assert.equal(statSync(req).mode & 0o777, 0o600, 'the request is 0600')
  assert.equal(conf().secrets[0].pending, true)
  await b.saveAppSecret({ app: 'data', name: 'tok', token: 'abcdefgh123' })
  await rejects(b.saveAppSecret({ app: 'data', name: 'nope', token: 'abcdefgh123' }), /has no secret 'nope'/)
  await rejects(b.saveAppSecret({ app: 'data', name: 'tok', token: 'bad token' }), /enter the token/)
  writeFileSync(join(FIX, 'memory/.secret-tok.status'), 'connected 2026-10-30\n')
  assert.equal(conf().secrets[1].connected, true)
  console.log('  ok  checks a key where the app says, stages it 0600 for brain watch, and shows when it is connected'); n++
  it('stages host keypairs outside memory, refuses duplicates and never returns their values',()=>{
    writeFileSync(join(A,'app.conf'),readFileSync(join(A,'app.conf'),'utf8')+'host-credential api keypair site_url ERPNext API\nsetting site_url text https://erp.example Site URL\n')
    const result=b.saveAppCredential({app:'data',name:'api',key:'fixture_key',secret:'fixture_secret'})
    const file=join(FIX,'.credentials-inbox/data/api.request')
    assert.equal(statSync(file).mode&0o777,0o600)
    assert.equal(JSON.parse(readFileSync(file,'utf8')).site,'https://erp.example')
    assert.ok(!JSON.stringify(result).includes('fixture_secret'))
    assert.ok(!JSON.stringify(conf()).includes('fixture_secret'))
    throws(()=>b.saveAppCredential({app:'data',name:'api',key:'key',secret:'secret'}),/already waiting/)
    throws(()=>b.saveAppCredential({app:'data',name:'nope',key:'key',secret:'secret'}),/no host credential called/)
    throws(()=>b.readTracked('.credentials-inbox/data/api.request'),/not readable/)
    assert.equal(conf().credentials[0].pending,true)
    rmSync(file)
  })
  srv.close()
  for (const f of ['.secret-hub.request', '.secret-tok.request', '.secret-tok.status']) rmSync(join(FIX, 'memory', f), { force: true })
  rmSync(A, { recursive: true }); rmSync(join(FIX, 'system/config'), { recursive: true })
}

console.log('engines: the agents in system/engines.conf, and the ones this brain installed')
{
  const local = join(FIX, 'system/brain.local.conf'), before = existsSync(local) ? readFileSync(local, 'utf8') : null
  it('reads every agent, and BRAIN_ENGINES says which are installed', () => {
    writeFileSync(local, 'BRAIN_ENGINES=claude gemini\n')
    const e = Object.fromEntries(b.engines().map(x => [x.name, x]))
    assert.deepEqual(Object.keys(e), ['claude', 'codex', 'gemini', 'opencode'])
    assert.deepEqual([e.claude.on, e.codex.on, e.gemini.on], [true, false, true])
    assert.deepEqual(e.gemini.efforts, []); assert.equal(e.opencode.role, '.config/opencode/AGENTS.md')
    assert.ok(b.models().gemini, 'every agent has a model list, free text for the new ones')
    const conf = readFileSync(join(FIX, 'system/roles.conf'), 'utf8')
    writeFileSync(join(FIX, 'system/roles.conf'), conf + 'idle-codex  codex  default\n')
    assert.ok(b.lint().some(f => /runs on codex, which this brain has not installed: brain engine add codex/.test(f.msg)))
    writeFileSync(join(FIX, 'system/roles.conf'), conf)
  })
  if (before === null) rmSync(local); else writeFileSync(local, before)
}

console.log('base update: the banner brain watch feeds, and the Update request')
{
  const f = join(FIX, 'memory/.base-update'), r = join(FIX, 'memory/.update-request')
  it('reads what is to come, and refuses an update with nothing to bring', () => {
    rmSync(f, { force: true }); rmSync(r, { force: true })
    assert.equal(b.baseUpdate(), null, 'no file: no banner')
    writeFileSync(f, '# aaa bbb 2026-11-02 23:40\n')
    throws(() => b.requestBaseUpdate(), /up to date/)
    writeFileSync(f, '# aaa bbb 2026-11-02 23:40\n1ca65b6\tbrain app update: settled\tconflicts\ne834b26\tcockpit: no rebuild\n')
    const u = b.baseUpdate()
    assert.deepEqual([u.head, u.upstream, u.at, u.requested], ['aaa', 'bbb', '2026-11-02 23:40', false])
    assert.deepEqual(u.commits.map(c => c.sha), ['1ca65b6', 'e834b26'])
    assert.equal(u.commits[0].subject, 'brain app update: settled conflicts')
    b.requestBaseUpdate()
    assert.equal(readFileSync(r, 'utf8'), 'update\n'); assert.equal(b.baseUpdate().requested, true)
    assert.equal(b.state().base.commits.length, 2, 'it is in the state the pages draw from')
    rmSync(f); rmSync(r)
  })
}

console.log('apps page: the catalog brain watch writes and the requests it runs')
{
  const M = f => join(FIX, 'memory', f), A = join(FIX, 'system/apps/kept')
  mkdirSync(join(A, 'roles'), { recursive: true }); mkdirSync(join(FIX, 'system/apps/.base/kept/roles'), { recursive: true })
  writeFileSync(join(A, 'app.conf'), 'name kept\nversion 1\nbrain >= 2\n')
  writeFileSync(join(FIX, 'system/apps/.base/kept/app.conf'), 'name kept\nversion 1\nbrain >= 2\n')
  writeFileSync(join(A, 'roles/r.md'), 'mine\n'); writeFileSync(join(FIX, 'system/apps/.base/kept/roles/r.md'), 'theirs\n')
  writeFileSync(join(FIX, 'system/apps.lock'), 'kept pshiuu/agent-brain-apps abc123def4567890 kept\n')
  writeFileSync(M('.apps-catalog'), '# pshiuu/agent-brain-apps abc123def4567890 2026-10-30 13:53\nkept\t2\tKept\t\t\tyes\tKeeps things.\npaint\t1.0.0\tPaint\tbrush\tcode,requires:kept\t-\tPaints.\n')
  mkdirSync(M('.apps-catalog.d'), { recursive: true }); writeFileSync(M('.apps-catalog.d/paint.md'), '# paint\n\nPaints walls.\n')
  writeFileSync(join(A, 'README.md'), '# kept\n\nKeeps things,\nsafely.\n\nMore.\n'); cpSync(join(A, 'README.md'), join(FIX, 'system/apps/.base/kept/README.md'))
  it('reads the catalog, the lock and this brain\'s changes', () => {
    const c = b.appStore().catalog
    assert.deepEqual([c.source, c.commit, c.at], ['pshiuu/agent-brain-apps', 'abc123def4567890', '2026-10-30 13:53'])
    assert.deepEqual(c.apps.map(a => [a.name, a.update, a.flags]), [['kept', true, []], ['paint', false, ['code', 'requires:kept']]])
    assert.deepEqual(c.apps.map(a => a.icon), ['puzzle-piece', 'brush'])
    assert.equal(b.apps().find(a => a.name === 'kept').desc, 'Keeps things, safely.')
    assert.match(b.appReadme('kept').text, /Keeps things/, 'an installed app\'s own README')
    assert.match(b.appReadme('paint').text, /Paints walls/, 'an available one\'s from the catalog')
    throws(() => b.appReadme('../x'), /bad app name/)
    const k = b.apps().find(a => a.name === 'kept')
    assert.equal(k.lock.commit, 'abc123def4567890'); assert.equal(k.changes, 1)
  })
  it('an update\'s conflicts folder is not a second app', () => {
    cpSync(A, join(FIX, 'system/apps/.kept.conflicts'), { recursive: true })
    try { assert.deepEqual(b.apps().map(a => a.name).filter(n => n.includes('kept')), ['kept']) }
    finally { rmSync(join(FIX, 'system/apps/.kept.conflicts'), { recursive: true }) }
  })
  it('stages one change at a time, only for what is installed or offered, and Remove needs the typed name', () => {
    throws(() => b.requestApps({ verb: 'install', name: 'kept' }), /already installed/)
    throws(() => b.requestApps({ verb: 'install', name: 'nope' }), /not in the catalog/)
    throws(() => b.requestApps({ verb: 'update', name: 'paint' }), /no app 'paint' installed/)
    throws(() => b.requestApps({ verb: 'install', name: '../x' }), /not an app name/)
    throws(() => b.requestApps({ verb: 'rm', name: 'kept' }), /not an app command/)
    throws(() => b.requestApps({ verb: 'remove', name: 'kept', confirm: 'kep' }), /type the app's name/)
    b.requestApps({ verb: 'remove', name: 'kept', confirm: 'kept', force: true })
    assert.equal(readFileSync(M('.apps-request'), 'utf8'), 'remove kept force\n')
    throws(() => b.requestApps({ verb: 'catalog' }), /queued or running/)
    rmSync(M('.apps-request')); b.requestApps({ verb: 'install', name: 'paint', trust: true })
    assert.equal(b.appStore().pending, 'install paint trust')
    rmSync(M('.apps-request'))
  })
  it('scans another repo and installs from it only what the scan found, with trust', () => {
    throws(() => b.requestApps({ verb: 'scan', name: '/etc' }), /not a GitHub owner\/repo/)
    throws(() => b.requestApps({ verb: 'scan', name: './x' }), /not a GitHub owner\/repo/)
    throws(() => b.requestApps({ verb: 'scan', name: '-uupload-pack=x' }), /not a GitHub owner\/repo/)
    b.requestApps({ verb: 'scan', name: 'https://github.com/me/my-apps.git' })
    assert.equal(readFileSync(M('.apps-request'), 'utf8'), 'scan me/my-apps\n', 'a GitHub URL becomes owner/repo')
    rmSync(M('.apps-request'))
    writeFileSync(M('.apps-scan'), '# me/my-apps 0123456789abcdef 2026-11-03 10:00\nmine\t1\tMine\t\tcommands\t-\tMy own.\t.\n')
    assert.deepEqual(b.appStore().scan.apps.map(a => [a.name, a.path, a.flags]), [['mine', '.', ['commands']]])
    throws(() => b.requestApps({ verb: 'install', name: 'mine' }), /not in the catalog/)
    throws(() => b.requestApps({ verb: 'install', name: 'mine', from: 'other/repo', trust: true }), /not in the scan/)
    throws(() => b.requestApps({ verb: 'install', name: 'mine', from: 'me/my-apps' }), /needs your trust/)
    b.requestApps({ verb: 'install', name: 'mine', from: 'me/my-apps', trust: true })
    assert.equal(b.appStore().pending, 'install mine trust from me/my-apps .')
    rmSync(M('.apps-request')); rmSync(M('.apps-scan'))
  })
  it('shows how the last change went', () => {
    writeFileSync(M('.apps-status'), 'error install paint 2026-10-30 14:00\nbrain: \'paint\' runs code in the Studio\n')
    assert.deepEqual(b.appStore().status, { ok: false, verb: 'install', name: 'paint', at: '2026-10-30 14:00', log: 'brain: \'paint\' runs code in the Studio' })
  })
  for (const f of ['.apps-catalog', '.apps-status', '.apps-catalog.d']) rmSync(M(f), { force: true, recursive: true })
  rmSync(A, { recursive: true }); rmSync(join(FIX, 'system/apps/.base/kept'), { recursive: true }); rmSync(join(FIX, 'system/apps.lock'))
}

{
  // An app in system/apps/<name>/ adds its playbooks, roles and skills; nothing is copied.
  const A = join(FIX, 'system/apps/fixture-app')
  mkdirSync(join(A, 'roles'), { recursive: true }); mkdirSync(join(A, 'playbooks/app-book'), { recursive: true }); mkdirSync(join(A, 'skills/app-skill'), { recursive: true })
  writeFileSync(join(A, 'app.conf'), 'name fixture-app\nversion 1.0.0\nbrain >= 2\n')
  writeFileSync(join(A, 'roles.conf'), 'app-writer  claude  default\n')
  writeFileSync(join(A, 'roles/app-writer.md'), '# Role: app-writer\nFixture role.\n')
  writeFileSync(join(A, 'playbooks/app-book/phases'), 'write  app-writer\nreview  qa  app-writer\n')
  writeFileSync(join(A, 'playbooks/app-book/playbook.md'), '# Playbook: app-book\n> From an app.\n\n## write\nWrite.\n## review\nReview.\n')
  writeFileSync(join(A, 'skills/app-skill/SKILL.md'), '---\nname: app-skill\ndescription: x\n---\n')
  it('finds an installed app\'s playbook, role and skill, and says where each lives', () => {
    const p = b.playbooks().find(x => x.name === 'app-book')
    assert.equal(p?.dir, 'system/apps/fixture-app/playbooks/app-book'); assert.equal(p.app, 'fixture-app')
    assert.equal(b.playbooks().find(x => x.name === 'feature').app, '', 'a base playbook has no app')
    const r = b.roles().find(x => x.role === 'app-writer')
    assert.equal(r?.conf, 'system/apps/fixture-app/roles.conf'); assert.equal(r.doc, 'system/apps/fixture-app/roles/app-writer.md')
    assert.equal(b.roleConfRel('qa'), 'system/roles.conf')
    assert.ok(b.skills().own.some(s => s.dir === 'app-skill' && s.app === 'fixture-app'))
    assert.ok(!b.lint().some(f => f.level === 'error' && /app-book|app-writer/.test(f.msg + f.where)), 'its roles resolve for lint')
  })
  it('gives a project the tabs its app declares, once their file is there', () => {
    mkdirSync(join(A, 'ui'), { recursive: true })
    writeFileSync(join(A, 'ui/app.json'), JSON.stringify({ projectTabs: [{ id: 'report', label: 'Report', view: 'article', when: 'memory:content/report.md', studio: true }] }))
    const P = join(FIX, 'memory/projects/app-proj')
    mkdirSync(join(P, 'content'), { recursive: true }); writeFileSync(join(P, 'project.env'), 'PLAYBOOK=app-book\nCREATED=2026-01-01\n')
    assert.deepEqual(b.projects().find(p => p.name === 'app-proj').tabs, [], 'not before the file exists')
    writeFileSync(join(P, 'content/report.md'), 'x')
    assert.deepEqual(b.projects().find(p => p.name === 'app-proj').tabs.map(t => t.id), ['report'])
    assert.deepEqual(b.projects().find(p => p.name === 'demo').tabs, [], 'a base playbook gets none')
    writeFileSync(join(A, 'ui/app.json'), JSON.stringify({ projectTabs: [{ id: 'x', view: 'spreadsheet', when: 'memory:x' }] }))
    assert.ok(b.lint().some(f => f.level === 'error' && /view 'spreadsheet'/.test(f.msg)), 'an unknown view is a lint error')
    writeFileSync(join(A, 'ui/app.json'), '{ nope')
    assert.ok(b.lint().some(f => f.level === 'error' && /not JSON/.test(f.msg)))
    rmSync(join(A, 'ui'), { recursive: true }); rmSync(P, { recursive: true })
  })
  it('scopes a project\'s knowledge to its app and its stack, and the prompt preview says so', () => {
    const P = join(FIX, 'memory/projects/scoped'), K = join(FIX, 'memory/knowledge')
    mkdirSync(join(P, 'phases'), { recursive: true }); mkdirSync(K, { recursive: true }); mkdirSync(join(FIX, 'system/apps/web')); writeFileSync(join(FIX, 'system/apps/web/app.conf'), 'name web\n')
    writeFileSync(join(P, 'project.env'), 'PLAYBOOK=app-book\nCREATED=2026-01-01\n')
    writeFileSync(join(P, 'brief.md'), '# Brief\n\n## Stack\n- PayloadCMS behind a Webflow front\n')
    for (const [n, t] of [['a', 'shared'], ['b', 'web, payload'], ['c', 'web']]) writeFileSync(join(K, `${n}.md`), `# ${n}\ntags: ${t}\nOne line.\n`)
    assert.deepEqual(b.knowledgeScope('app-book', 'scoped'), ['shared', 'fixture-app', 'payload'], "'Webflow' does not pull in the web app")
    assert.equal(b.knowledge().find(k => k.name === 'b').summary, 'One line.', 'the tags line is not the summary')
    assert.match(b.promptPreview('scoped', 'write').prompt, /^Knowledge scope: shared fixture-app payload — /m)
    assert.doesNotMatch(b.promptPreview('scoped', 'write').prompt, /^App knowledge/m, 'no line while no app in scope ships pages')
    mkdirSync(join(A, 'knowledge')); writeFileSync(join(A, 'knowledge/intent.md'), '# Intent\n')
    assert.match(b.promptPreview('scoped', 'write').prompt, /^App knowledge \(read-only, shipped with the apps\): \S+\/system\/apps\/fixture-app\/knowledge — /m, 'bin/brain header() names the app folder')
    rmSync(join(A, 'knowledge'), { recursive: true })
    for (const n of ['a', 'b', 'c']) rmSync(join(K, `${n}.md`))
    rmSync(P, { recursive: true }); rmSync(join(FIX, 'system/apps/web'), { recursive: true })
  })
  it('bin/brain and the cockpit agree on the views an app may name', () => {
    const sh = readFileSync(join(REPO, 'bin/brain'), 'utf8').match(/^APP_VIEWS="([^"]*)"/m)[1].split(' ')
    assert.deepEqual(sh, b.APP_VIEWS)
  })
  it('does not warn about an app\'s role that no playbook uses: the app may run it itself', () => {
    writeFileSync(join(A, 'roles.conf'), 'app-writer  claude  default\napp-helper  claude  default\n')
    writeFileSync(join(A, 'roles/app-helper.md'), '# Role: app-helper\n')
    assert.ok(!b.lint().some(f => /'app-helper' is not used/.test(f.msg)))
    writeFileSync(join(A, 'roles.conf'), 'app-writer  claude  default\n'); rmSync(join(A, 'roles/app-helper.md'))
  })
  it('refuses to delete what an app brings from the cockpit, and says which app', () => {
    throws(() => b.deletePlaybook('app-book'), /playbook 'app-book' comes with the app 'fixture-app'/)
    throws(() => b.deleteRole('app-writer'), /role 'app-writer' comes with the app 'fixture-app'/)
    assert.ok(existsSync(join(A, 'roles/app-writer.md')), 'its instructions are still there')
    throws(() => b.deleteOwnSkill('app-skill'), /skill 'app-skill' comes with the app 'fixture-app'/)
    assert.equal(b.skills().declared.find(d => d.name === 'app-skill').app, 'fixture-app', 'the skills list says whose it is')
    writeFileSync(join(A, 'skills.list'), 'owner/repo ext-skill\n')
    assert.equal(b.skills().declared.find(d => d.name === 'ext-skill').app, 'fixture-app')
    throws(() => b.removeBaseSkillSource('ext-skill'), /skill 'ext-skill' comes with the app 'fixture-app'/)
    assert.equal(readFileSync(join(A, 'skills.list'), 'utf8'), 'owner/repo ext-skill\n', 'its skills.list is untouched')
    rmSync(join(A, 'skills.list'))
    assert.equal(b.roles().find(r => r.role === 'qa').app, '', 'a base role has no app')
  })
  it('a directory without app.conf is not an app', () => {
    rmSync(join(A, 'app.conf'))
    assert.ok(!b.playbooks().some(x => x.name === 'app-book'))
    rmSync(A, { recursive: true })
  })
}

console.log(`\n${n} checks passed`)
