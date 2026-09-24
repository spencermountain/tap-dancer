import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { once } from 'node:events'
import path from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const __dirname = fileURLToPath(new URL('.', import.meta.url))

async function runTapeFile(source, directory) {
  const file = path.join(directory, 'suite.mjs')
  await writeFile(
    file,
    `import tape from ${JSON.stringify(import.meta.resolve('tape'))};\n${source}`
  )
  const env = { ...process.env, NO_COLOR: '1' }
  delete env.FORCE_COLOR
  const options = {
    cwd: path.join(__dirname, '../..'),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  }
  const producer = spawn(process.execPath, [file], options)
  const reporter = spawn(process.execPath, [path.join(__dirname, '../../src/cli.js')], options)
  const producerClosed = once(producer, 'close')
  const reporterClosed = once(reporter, 'close')
  let output = ''
  let producerError = ''
  let reporterError = ''
  reporter.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
  })
  producer.stderr.setEncoding('utf8').on('data', (chunk) => {
    producerError += chunk
  })
  reporter.stderr.setEncoding('utf8').on('data', (chunk) => {
    reporterError += chunk
  })
  producer.stdin.end()
  const [producerExit, reporterExit] = await Promise.all([
    producerClosed,
    reporterClosed,
    pipeline(producer.stdout, reporter.stdin)
  ])
  assert.equal(producerExit[1], null, producerError)
  assert.equal(reporterExit[1], null, reporterError)
  assert.equal(reporterError, '')
  return { output, producerError, producerStatus: producerExit[0], status: reporterExit[0] }
}

// Separate processes exercise Tape's own exit handling and the real CLI pipe.
async function runTape(source) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tap-dancer-'))
  try {
    return await runTapeFile(source, directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('real Tape asynchronous assertions and skipped tests pass through the CLI', async () => {
  const result = await runTape(`
    tape('async work', t => {
      t.plan(3)
      t.skip('skipped assertion')
      t.equal(1 + 1, 2, 'addition')
      setImmediate(() => t.deepEqual({ value: 3 }, { value: 3 }, 'async object'))
    })
    tape('skipped suite', { skip: true }, t => { t.fail('must not run'); t.end() })
  `)
  assert.equal(result.producerStatus, 0, result.producerError)
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /2 passed, 1 skipped\n/)
})

test('real Tape failures preserve values on one line without source locations', async () => {
  const result = await runTape(`
    tape('values', t => {
      t.equal(false, 0, 'falsy mismatch')
      t.deepEqual({ value: 'actual' }, { value: 'expected' }, 'object mismatch')
      t.end()
    })
  `)
  assert.equal(result.producerStatus, 1)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /#1  falsy mismatch +- false !0\n/)
  assert.match(result.output, /#2  object mismatch +- "\{ value: 'actual' \}" !"\{ value: 'expected' \}"\n/)
  assert.doesNotMatch(result.output, /at:|suite\.mjs/)
  assert.match(result.output, /2 Failed, 0 passed/)
})

test('real Tape rejected async tests produce a failed report', async () => {
  const result = await runTape(`
    tape('rejected work', async t => {
      await Promise.resolve()
      throw new Error('integration rejection')
    })
  `)
  assert.equal(result.producerStatus, 1)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /integration rejection/)
  assert.match(result.output, /1 Failed/)
  assert.ok(result.output.endsWith('1 Failed, 0 passed\n'))
})

test('real Tape large failure reports retain thirty-five diagnostics and include the full failure count', async () => {
  const result = await runTape(`
    tape('many failures', t => {
      for (let i = 1; i <= 52; i++) t.equal(i, 0, 'mismatch-' + i)
      t.end()
    })
  `)
  assert.equal(result.producerStatus, 1)
  assert.equal(result.status, 1)
  assert.equal((result.output.match(/^ #/gm) || []).length, 35)
  assert.match(result.output, /#35 mismatch-35 +-/)
  assert.doesNotMatch(result.output, /mismatch-36|mismatch-52/)
  assert.match(result.output, /\(showing 35 of 52 failing tests\)\n\n/)
  assert.match(result.output, /52 Failed/)
})
