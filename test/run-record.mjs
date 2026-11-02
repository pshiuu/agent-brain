import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = mkdtempSync(join(tmpdir(), 'brain-record-test-'))
const helper = resolve('bin/run-record.sh')
const write = (p, s) => { mkdirSync(resolve(p, '..'), { recursive: true }); writeFileSync(p, s) }
const read = p => JSON.parse(readFileSync(p))
try {
  // The test runner uses Node as an independent JSON parser. The program under
  // test gets only the launcher's existing tools, with no node, jq or Python.
  const toolPath = join(root, 'tools')
  mkdirSync(toolPath)
  for (const name of ['bash', 'awk', 'shasum', 'git', 'date', 'mkdir', 'mktemp', 'cat', 'cp', 'wc', 'tr', 'find', 'sed', 'head', 'readlink', 'mv', 'dirname']) {
    const target = execFileSync('/bin/bash', ['-c', 'command -v "$1"', '_', name], { encoding: 'utf8' }).trim()
    symlinkSync(target, join(toolPath, name))
  }
  const env = { ...process.env, PATH: toolPath }
  const invoke = (args, input = '', extra = {}) => execFileSync('/bin/bash', [helper, ...args], { env: { ...env, ...extra }, input, encoding: 'utf8', stdio: 'pipe' })
  const brain = join(root, 'brain'), project = join(root, 'code'), pdir = join(brain, 'memory/projects/demo')
  mkdirSync(project)
  execFileSync('git', ['init', '-q', project])
  write(join(project, 'untracked.txt'), 'first')
  write(join(brain, 'system/roles/reviewer.md'), '# Reviewer\nSkills: unavailable\n')
  write(join(pdir, 'brief.md'), '# Brief\n')
  const beginArgs = ['begin', brain, pdir, project, 'demo', 'book', 'qa', 'reviewer', 'codex', 'default', '', 'review', '120', '3', 'v1', 'github']
  const begin = () => invoke(beginArgs).trim()
  const a = begin(), original = readFileSync(join(a, 'plan.json'))
  write(join(brain, 'system/roles/reviewer.md'), '# Changed reviewer\n')
  write(join(project, 'untracked.txt'), 'second')
  const b = begin()
  assert.notEqual(a, b, 'attempts cannot collide within one second')
  assert.notEqual(read(join(a, 'plan.json')).role_sha256, read(join(b, 'plan.json')).role_sha256)
  assert.notEqual(read(join(a, 'plan.json')).git.dirty_sha256, read(join(b, 'plan.json')).git.dirty_sha256, 'untracked content contributes, not only its filename')
  execFileSync('git', ['-C', project, 'add', 'untracked.txt'])
  const c = begin()
  write(join(project, 'untracked.txt'), 'third')
  execFileSync('git', ['-C', project, 'add', 'untracked.txt'])
  const d = begin()
  assert.notEqual(read(join(c, 'plan.json')).git.dirty_sha256, read(join(d, 'plan.json')).git.dirty_sha256, 'staged content contributes even before the first commit')
  assert.equal(read(join(a, 'plan.json')).git.repo, project)
  const workspace = join(root, 'workspace')
  execFileSync('git', ['init', '-q', join(workspace, 'site')])
  write(join(workspace, 'design/index.html'), 'beside the repo, never in it')
  const nested = read(join(invoke(['begin', brain, pdir, workspace, ...beginArgs.slice(4)]).trim(), 'plan.json')).git
  assert.equal(nested.repo, join(workspace, 'site'), 'a workspace that is not a repo records the site repo inside it')
  assert.notEqual(nested.dirty_sha256, null)
  assert.equal(read(join(a, 'plan.json')).resolved_model, null, 'an alias is not an exact runtime model')
  assert.equal(read(join(a, 'context.json')).skills[0].unresolved, true)
  assert.match(readFileSync(join(a, 'role.md'), 'utf8'), /# Reviewer/)
  write(join(pdir, 'phases/qa.md'), 'RESULT: PASS\n')
  const finish = () => invoke(['finish', a, pdir, 'qa', 'incomplete', '0'])
  finish()
  const result = read(join(a, 'result.json'))
  assert.equal(result.agent_claim.verdict, 'PASS')
  assert.equal(result.host_verdict.outcome, 'incomplete', 'agent verdict does not become host verification')
  assert.ok(result.changed_inputs.includes(join(brain, 'system/roles/reviewer.md')), 'role drift is visible')
  assert.deepEqual(readFileSync(join(a, 'plan.json')), original, 'finish never rewrites the plan')
  assert.throws(finish, 'a second finish cannot overwrite evidence')
  const resultBytes = readFileSync(join(a, 'result.json'))
  assert.throws(finish)
  assert.deepEqual(readFileSync(join(a, 'result.json')), resultBytes)

  const unusual = 'Grüße "\\' + Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join('') + '`literal` $(literal)\n\n'
  const source = join(pdir, 'sources', unusual)
  write(source, 'original')
  const strangeArgs = [...beginArgs]
  strangeArgs[9] = unusual // requested model, not interpreted as shell text
  const prompt = 'prompt with Unicode ✓\n\0and arbitrary bytes\n\n'
  const special = invoke(strangeArgs, prompt).trim()
  assert.equal(read(join(special, 'plan.json')).requested_model, unusual)
  assert.equal(read(join(special, 'context.json')).inputs.find(i => i.path === source)?.bytes, 8)
  assert.equal(readFileSync(join(special, 'prompt.md'), 'utf8'), prompt)
  assert.equal(read(join(special, 'plan.json')).prompt_sha256, createHash('sha256').update(prompt).digest('hex'))
  write(source, 'changed')
  invoke(['finish', special, pdir, 'qa', 'incomplete', '0'])
  assert.ok(read(join(special, 'result.json')).changed_inputs.includes(source), 'NUL ledger preserves unusual filenames')
  for (const [index, value] of [[4, '../escape'], [12, '01'], [13, 'oops']]) {
    const invalid = [...beginArgs]; invalid[index] = value
    assert.throws(() => invoke(invalid), 'invalid identifiers or numbers fail before launch')
  }
  const contractPath = join(brain, 'system/playbooks/book/contracts/qa')
  const contract = 'input project:untracked.txt\noutput project:report.txt\nevidence memory:qa/proof.txt\ncheck 10 ./verify.sh\n'
  write(contractPath, contract)
  const contracted = begin(), plan = read(join(contracted, 'plan.json'))
  assert.equal(plan.contract_sha256, createHash('sha256').update(contract).digest('hex'))
  assert.ok(plan.expected_outputs.includes('project:report.txt'))
  assert.deepEqual(plan.verification_commands, [{ command: './verify.sh', timeout_seconds: 10 }])
  assert.ok(read(join(contracted, 'context.json')).inputs.some(i => i.reason === 'required contract input' && i.path === join(project, 'untracked.txt')))
  write(contractPath, 'check 10 changed-command\n')
  assert.equal(readFileSync(join(contracted, 'contract'), 'utf8'), contract)
  write(join(contracted, 'evidence/check-1.log'), 'Test output\n')
  write(join(contracted, 'evidence/check-1.exit'), '0\n')
  write(join(contracted, 'proposed.done'), '')
  invoke(['finish', contracted, pdir, 'qa', 'verified', '0'])
  const verified = read(join(contracted, 'result.json'))
  assert.equal(verified.host_verdict.outcome, 'verified')
  assert.ok(verified.evidence.some(e => e.path === 'evidence/check-1.log' && e.sha256 === createHash('sha256').update('Test output\n').digest('hex')))
  assert.ok(verified.agent_claim.outputs.some(o => o.path === 'handoff.done'), 'held completion marker is still part of the agent claim')
  assert.ok(verified.changed_inputs.includes(contractPath))

  // The phase's own files as the attempt found them, mtimes kept: the defect rules
  // compare against them and a rejected review is rolled back to them.
  write(join(pdir, 'phases/qa.log'), '2026-01-01 FAIL\n2026-01-02 FAIL but prose\n')
  const again = invoke(beginArgs, '', { BRAIN_LAUNCHER: '4242' }).trim()
  assert.equal(readFileSync(join(again, 'previous-summary.md'), 'utf8'), 'RESULT: PASS\n')
  assert.equal(Math.floor(statSync(join(again, 'previous-summary.md')).mtimeMs / 1000), Math.floor(statSync(join(pdir, 'phases/qa.md')).mtimeMs / 1000), 'mtime kept, or fix_pending reads a restored summary as new')
  assert.equal(readFileSync(join(again, 'previous.log'), 'utf8'), '2026-01-01 FAIL\n2026-01-02 FAIL but prose\n')
  assert.equal(read(join(again, 'plan.json')).fix_round, 1, 'one round rule: only host-format FAIL lines count')
  assert.equal(readFileSync(join(again, 'launcher'), 'utf8'), '4242\n', 'the pid that holds the attempt, for sweep_stale')
  assert.ok(read(join(again, 'context.json')).inputs.some(i => i.path === join(brain, 'system/skills.lock')), 'skill revisions are an input')

  // The sandbox receipt joins the record by run id; a crashed attempt claims no phase
  // files, only markers it held back itself.
  write(join(pdir, `phases/qa.runs/${basename(again)}.json`), '{\n  "session": "s",\n  "model": "claude-opus-5-5",\n  "reads": []\n}\n')
  invoke(['finish', again, pdir, 'qa', 'crashed', ''])
  const crashed = read(join(again, 'result.json'))
  assert.equal(crashed.exit_code, null, 'nobody saw the launcher exit')
  assert.equal(crashed.resolved_model, 'claude-opus-5-5', 'the model behind the alias, from the transcript')
  assert.ok(existsSync(join(again, 'transcript.json')))
  assert.deepEqual(crashed.agent_claim.outputs, [], 'the phase files a later launcher finds are not this attempt\'s')

  // A human verdict is a record too.
  const human = invoke(['human', brain, pdir, 'demo', 'book', 'qa', 'approved'], 'item fix "it" \\ now\nwaived qa.a\ndeferred qa.b\nreopened qa\n').trim()
  const verdict = read(join(human, 'result.json'))
  assert.equal(verdict.actor, 'human')
  assert.equal(verdict.host_verdict.outcome, 'approved')
  assert.deepEqual(verdict.items, ['fix "it" \\ now'])
  assert.deepEqual(verdict.defects, { waived: ['qa.a'], deferred: ['qa.b'], verified: [] })
  assert.deepEqual(verdict.reopened, ['qa'])
  assert.equal(read(join(human, 'plan.json')).mode, 'verdict')
  assert.equal(readFileSync(join(human, 'summary.md'), 'utf8'), 'RESULT: PASS\n', 'the summary as the verdict left it')
  assert.throws(() => invoke(['human', brain, pdir, 'demo', 'book', 'qa', 'deleted'], ''), 'only the three human outcomes')
  console.log('Run record checks passed (Node, jq and Python absent from helper PATH)')
} finally { rmSync(root, { recursive: true, force: true }) }
