import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import TapDance from '../src/index.js'
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const cli = path.join(__dirname, '../src/cli.js')
const run = (input, args = []) => {
  const env = { ...process.env, NO_COLOR: '1' }
  delete env.FORCE_COLOR
  const result = spawnSync(process.execPath, [cli, ...args], {
    input, encoding: 'utf8', env,
    timeout: 10000, maxBuffer: 8 * 1024 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return result
}

const fixtures = [
  ['passing', '1..1\nok 1 works\n', 0],
  ['plain failure', '1..1\nnot ok 1 broken\n', 1],
  ['empty input', '', 1],
  ['non-TAP input', 'ordinary log\n', 1],
  ['version only', 'TAP version 13\n', 1],
  ['truncated plan', '1..2\nok 1 first\n', 1],
  ['missing plan', 'ok 1 first\n', 1],
  ['duplicate plans', '1..1\nok 1 first\n1..1\n', 1],
  ['duplicate numbers', '1..2\nok 1 first\nok 1 duplicate\n', 1],
  ['bailout', 'Bail out! database unavailable\n', 1],
  ['bailout after passing', '1..1\nok 1 first\nBail out! cleanup failed\n', 1],
  ['TODO failure', '1..1\nnot ok 1 feature # TODO later\n', 0],
  ['TODO success', '1..1\nok 1 feature # TODO later\n', 0],
  ['SKIP', '1..1\nok 1 platform # SKIP unavailable\n', 0],
  ['explicit zero plan', '1..0\n', 0],
  ['explicit suite skip', '1..0 # SKIP unsupported\n', 0],
  ['trailing plan', 'ok 1 works\n1..1\n', 0],
  ['no final newline', '1..1\nok 1 works', 0],
  ['CRLF', '1..1\r\nok 1 works\r\n', 0],
  ['nested passing', '# Subtest: child\n    1..1\n    ok 1 works\nok 1 child\n1..1\n', 0],
  ['nested failing', '# Subtest: child\n    1..1\n    not ok 1 broken\nnot ok 1 child\n1..1\n', 1],
]
for (const [name, input, status] of fixtures) {
  test(name, () => {
    const result = run(input)
    assert.equal(result.status, status, result.stdout + result.stderr)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, status ? /Failed/ : /✓ .*passed/)
    assert.doesNotMatch(result.stdout, /✔️/)
    if (status) assert.doesNotMatch(result.stdout, /✓/)
  })
}

test('separate counts for passed, failed, skipped and TODO', () => {
  const result = run('1..4\nok 1 good\nnot ok 2 bad\nok 3 omitted # skip reason\nnot ok 4 pending # todo later\n')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /1 Failed, 1 passed, 1 skipped, 1 TODO/)
})

test('plain failures do not invent diagnostics', () => {
  const result = run('1..1\nnot ok 1 broken\n')
  assert.match(result.stdout, /broken/)
  assert.doesNotMatch(result.stdout, /undefined|want:|actual:/)
})

test('diagnostics preserve falsy values and support found', () => {
  const result = run('1..1\nnot ok 1 mismatch\n  ---\n  found: false\n  expected: 0\n  message: wrong value\n  ...\n')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /mismatch +- false !0/)
  assert.match(result.stdout, /message: 'wrong value'/)
})

test('object and multiline diagnostics stay on one output line', () => {
  const result = run(`1..1
not ok 1 multiline mismatch
  ---
  actual:
    values: [1, 2, 3]
    text: |
      first
      second
  expected: null
  message: |
    wrong
    value
  at: test.js:12
  ...
`)
  assert.equal(result.status, 1)
  const lines = result.stdout.trimEnd().split('\n')
  assert.equal(lines.length, 4, result.stdout)
  assert.match(lines[1], /#1  multiline mismatch +- .*values: \[ 1, 2, 3 \].*!null.*message:/)
  assert.doesNotMatch(result.stdout, /test\.js/)
})

test('failure details align loosely and long rows end with an ellipsis', () => {
  const names = ['short', 'a slightly longer name', 'x'.repeat(100)]
  const input = '1..3\n' + names.map((name, i) =>
    `not ok ${i + 1} ${name}\n  ---\n  actual: ${i === 2 ? 'y'.repeat(300) : 'true'}\n  expected: false\n  ...\n`).join('')
  const result = run(input)
  const rows = result.stdout.split('\n').filter(line => line.startsWith(' #'))
  assert.equal(rows[0].indexOf(' - true'), rows[1].indexOf(' - true'))
  assert.equal(rows[0].indexOf(' - true'), 30)
  assert.ok(rows[2].includes('x… - '))
  assert.equal(Array.from(rows[2]).length, 170)
  assert.ok(rows[2].endsWith('…'))
  assert.ok(result.stdout.endsWith('3 Failed, 0 passed\n'))
})

test('nofail suppresses status but keeps the failure report', () => {
  for (const input of ['1..1\nnot ok 1 broken\n', '', 'Bail out! setup failed\n']) {
    const result = run(input, ['-nofail'])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Failed/)
  }
})

test('noreport hides assertion details, not status or protocol errors', () => {
  const result = run('1..1\nnot ok 1 secret failure name\n', ['-noreport'])
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stdout, /secret failure name/)
  assert.match(result.stdout, /1 Failed/)
  assert.match(run('Bail out! setup failed\n', ['-noreport']).stdout, /setup failed/)
})

test('the library import has no output or stdin/exit side effects', () => {
  const code = `process.exitCode = 7; await import(${JSON.stringify(new URL('../src/index.js', import.meta.url).href)}); await import(${JSON.stringify(new URL('../src/cli.js', import.meta.url).href)}); console.log('imported')`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', input: '' })
  assert.equal(result.status, 7)
  assert.equal(result.stdout, 'imported\n')
  assert.equal(result.stderr, '')
})

test('the installed package exposes an ES module default export', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tap-dancer-esm-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, 'node_modules'))
  await symlink(path.resolve(__dirname, '..'), path.join(directory, 'node_modules/tap-dancer'), 'dir')
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import TapDance from 'tap-dancer'
    import { Transform } from 'node:stream'
    if (!(new TapDance() instanceof Transform)) throw new Error('invalid default export')
    console.log('imported')
  `], { cwd: directory, encoding: 'utf8', timeout: 10000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'imported\n')
  assert.equal(result.stderr, '')
})

test('both CLI entry points execute through symlinks', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tap-dancer-bin-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const entry of ['cli.js', 'index.js']) {
    const bin = path.join(directory, entry)
    await symlink(path.join(__dirname, '../src', entry), bin)
    const result = spawnSync(process.execPath, [bin], {
      input: '1..1\nnot ok 1 broken\n', encoding: 'utf8', timeout: 10000,
    })
    assert.ifError(result.error)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stdout, /1 Failed/)
    assert.match(result.stdout, /Failed/)
    assert.equal(result.stderr, '')
  }
})

test('documented stream API emits results without changing exit status', async () => {
  const reporter = new TapDance()
  let result
  let text = ''
  const exitCode = process.exitCode
  reporter.on('complete', value => { result = value })
  await pipeline(Readable.from(['1..1\nnot ok 1 broken\n']), reporter, new Writable({
    write(chunk, encoding, callback) { text += chunk; callback() },
  }))
  assert.equal(result.ok, false)
  assert.equal(reporter.results, result)
  assert.equal(result.counts.failed, 1)
  assert.equal(process.exitCode, exitCode)
  assert.match(text, /broken/)
})

test('UTF-8 split across chunks is preserved', async () => {
  const reporter = new TapDance()
  let text = ''
  const bytes = Buffer.from('1..1\nnot ok 1 café 🐈\n')
  await pipeline(Readable.from([...bytes].map(byte => Buffer.from([byte]))), reporter, new Writable({
    write(chunk, encoding, callback) { text += chunk; callback() },
  }))
  assert.match(text, /café 🐈/)
  assert.doesNotMatch(text, /�/)
})

test('large redirected output is fully flushed', () => {
  const count = 12000
  const input = `1..${count}\n` + Array.from({length: count}, (_, i) => `ok ${i + 1} works\n`).join('')
  const result = run(input)
  assert.equal(result.status, 0)
  assert.equal((result.stdout.match(/•/g) || []).length, count)
  assert.match(result.stdout, /12,000 passed/)
  assert.ok(stripVTControlCharacters(result.stdout).endsWith('passed\n'))
})

test('upstream crash before TAP is rejected', () => {
  const producer = spawnSync(process.execPath, ['-e', "throw new Error('crash')"], {encoding:'utf8'})
  assert.equal(producer.status, 1)
  assert.equal(run(producer.stdout).status, 1)
})

test('bailout after a zero-test plan still fails', () => {
  assert.equal(run('1..0\nBail out! cleanup failed\n').status, 1)
})

test('ordinary logging does not invalidate an otherwise valid run', () => {
  const result = run('starting server\n1..1\nok 1 connected\n')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /starting server/)
})

test('a TODO subtest does not become a hard failure', () => {
  const result = run('# Subtest: pending\n    1..1\n    not ok 1 unfinished\nnot ok 1 pending # TODO later\n1..1\n')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /0 passed, 1 TODO\n/)
})

test('parser errors propagate through the stream API', async () => {
  const reporter = new TapDance()
  const pending = pipeline(reporter, new Writable({ write(chunk, encoding, callback) { callback() } }))
  reporter.parser.emit('error', new Error('parser failed'))
  await assert.rejects(pending, /parser failed/)
})

test('slow consumers receive the complete report', async () => {
  const reporter = new TapDance()
  let text = ''
  await pipeline(Readable.from(['1..2\nok 1 first\nok 2 second\n']), reporter, new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) { text += chunk; setImmediate(callback) },
  }))
  assert.match(stripVTControlCharacters(text), /2 passed/)
  assert.ok(stripVTControlCharacters(text).endsWith('passed\n'))
})

test('historical direct entry point remains executable', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../src/index.js')], {
    input: '1..1\nok 1 works\n', encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.match(stripVTControlCharacters(result.stdout), /1 passed/)
})

const nested = (body, name, closing = `ok 1 ${name}`) =>
  `# Subtest: ${name}\n` + body.split('\n').filter(Boolean).map(line => `    ${line}\n`).join('') + `${closing}\n1..1\n`

for (const directive of ['TODO', 'SKIP']) {
  test(`deep ${directive} assertion failures do not fail the run`, () => {
    const input = nested(nested('not ok 1 unfinished\n1..1\n', 'inner', `not ok 1 inner # ${directive} later`), 'outer')
    const result = run(input)
    assert.equal(result.status, 0, result.stdout)
    assert.match(result.stdout, /1 passed\n/)
    assert.doesNotMatch(result.stdout, /unfinished|Failed/)
  })

  test(`${directive} cannot hide grandchild protocol errors`, () => {
    const input = nested(nested('ok 1 works\n1..2\n', 'inner', 'not ok 1 inner'), 'outer', `not ok 1 outer # ${directive} later`)
    const result = run(input, ['-noreport'])
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stdout, /outer > inner: incorrect number of tests/)
    assert.match(result.stdout, /Failed/)
  })
}

test('nested failures retain diagnostics and subtest context', () => {
  const input = nested(nested('not ok 1 mismatch\n  ---\n  actual: false\n  expected: 0\n  at: test.js:12\n  ...\n1..1\n', 'inner', 'not ok 1 inner'), 'outer', 'not ok 1 outer')
  const result = run(input)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /outer > inner: mismatch/)
  assert.match(result.stdout, /mismatch +- false !0/)
  assert.doesNotMatch(result.stdout, /at:|test\.js/)
  const quiet = run(input, ['-noreport'])
  assert.equal(quiet.status, 1)
  assert.doesNotMatch(quiet.stdout, /mismatch|actual:|want:|test.js/)
})

test('child protocol errors explain failure even with a passing closing point', () => {
  const result = run(nested('ok 1 works\n1..2\n', 'child'))
  assert.equal(result.status, 1)
  assert.match(result.stdout, /child: incorrect number of tests/)
})

test('TODO failures do not conceal an incomplete plan', () => {
  const result = run(nested('not ok 1 pending\n1..2\n', 'child', 'not ok 1 child # TODO later'))
  assert.equal(result.status, 1)
  assert.match(result.stdout, /child: incorrect number of tests/)
})

test('both CLI entry points support forced color and respect NO_COLOR', () => {
  for (const entry of [cli, path.join(__dirname, '../src/index.js')]) {
    for (const noColor of [false, true]) {
      const env = { ...process.env }
      delete env.NO_COLOR
      delete env.FORCE_COLOR
      if (noColor) env.NO_COLOR = '1'
      const result = spawnSync(process.execPath, [entry, '--color'], {
        input: '1..1\nok 1 works\n', encoding: 'utf8', env, timeout: 10000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0)
      assert.equal(result.stdout.includes('\x1b['), !noColor)
      assert.equal(result.stdout.includes('\x1b[32m✓\x1b[39m'), !noColor)
      assert.ok(stripVTControlCharacters(result.stdout).endsWith('passed\n'))
    }
  }
})

test('numbers within failure names and values retain their surrounding colors', () => {
  const env = { ...process.env, FORCE_COLOR: '1' }
  delete env.NO_COLOR
  const result = spawnSync(process.execPath, [cli], {
    input: '1..1\nnot ok 1 case 123\n  ---\n  actual: -1.5\n  expected: 2.5\n  ...\n',
    encoding: 'utf8', env, timeout: 10000,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.ok(result.stdout.includes('\x1b[2m#1 \x1b[22m'))
  assert.ok(result.stdout.includes('\x1b[31mcase 123\x1b[39m'))
  assert.ok(result.stdout.includes('\x1b[2m\x1b[33m-1.5\x1b[39m\x1b[22m'))
  assert.ok(result.stdout.includes('\x1b[3m\x1b[35m2.5\x1b[39m\x1b[23m'))
})

for (const count of [12, 35, 36, 52]) {
  test(`diagnostic limit preserves the first thirty-five of ${count} failures`, () => {
    const input = `1..${count}\n` + Array.from({ length: count }, (_, i) =>
      `not ok ${i + 1} mismatch-${i + 1}\n  ---\n  actual: ${i + 1}\n  expected: 0\n  ...\n`).join('')
    const result = run(input)
    assert.equal(result.status, 1)
    assert.equal((result.stdout.match(/^ #/gm) || []).length, Math.min(count, 35))
    assert.match(result.stdout, /#12 mismatch-12 +- 12 !0\n/)
    assert.match(result.stdout, new RegExp(`${count} Failed`))
    assert.doesNotMatch(result.stdout, /mismatch-36|mismatch-52|omitted/)
    if (count > 35) {
      assert.ok(result.stdout.includes(`   (showing 35 of ${count} failing tests)\n\n`))
    } else {
      assert.doesNotMatch(result.stdout, /showing/)
    }
    const quiet = run(input, ['-noreport'])
    assert.equal(quiet.status, 1)
    assert.doesNotMatch(quiet.stdout, /mismatch|actual:|omitted|showing/)
  })
}
