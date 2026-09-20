#!/usr/bin/env node
'use strict'
const { Transform } = require('node:stream')
const { StringDecoder } = require('node:string_decoder')
const { inspect } = require('node:util')
const { Parser } = require('tap-parser')
const c = require('colorette')
const { duration, niceNumber } = require('./fns')

// Importing the reporter does not read stdin or change the host's exit status.
class TapDance extends Transform {
  constructor(options = {}) {
    super()
    this.options = options
    this.started = Date.now()
    this.decoder = new StringDecoder('utf8')
    this.counts = { passed: 0, failed: 0, skipped: 0, todo: 0 }
    this.failures = []
    this.protocolErrors = []
    this.results = null
    this.parser = new Parser()
    this.children = []
    this.parser.on('child', child => this.children.push(child))
    this.parser.on('error', err => this.destroy(err))
    this.parser.on('assert', assertion => {
      if (assertion.skip) {
        this.counts.skipped += 1
        this.push(c.cyan('s'))
      } else if (assertion.todo) {
        this.counts.todo += 1
        this.push(c.yellow('t'))
      } else if (assertion.ok) {
        this.counts.passed += 1
        this.push(c.green('•'))
      } else {
        this.counts.failed += 1
        this.failures.push(assertion)
        this.push(c.red('✗'))
      }
    })
    // Preserve ordinary console output alongside the test report.
    this.parser.on('extra', text => {
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*(?:\d+\.\.\d+|(?:not )?ok\b|Bail out!)/i.test(line)) {
          this.protocolErrors.push('Unexpected TAP data: ' + line.trim())
        }
      }
      this.push(text)
    })
    this.parser.on('complete', results => this.finishReport(results))
  }

  _transform(chunk, encoding, callback) {
    try {
      this.parser.write(this.decoder.write(chunk))
      callback()
    } catch (err) {
      callback(err)
    }
  }

  _flush(callback) {
    try {
      this.parser.end(this.decoder.end())
      callback()
    } catch (err) {
      callback(err)
    }
  }

  finishReport(parsed) {
    const errors = [...new Set([
      ...this.protocolErrors,
      ...parsed.failures.filter(f => f.tapError).map(f => f.tapError),
    ])]
    // tap-parser synthesizes a successful 1..0 plan for empty input. A reporter
    // must distinguish that from a producer explicitly skipping its tests.
    if (this.parser.syntheticPlan && !parsed.bailout) {
      errors.push('No TAP tests or explicit plan received')
    }
    if (parsed.bailout) {
      errors.push('Bail out!' + (typeof parsed.bailout === 'string' ? ' ' + parsed.bailout : ''))
    }
    // tap-parser marks the parent not-ok as soon as a child fails, before the
    // child's closing test point can mark that failure as TODO or SKIP.
    const failedChildren = this.children.filter(child => !child.results.ok)
    const expectedChildFailures = failedChildren.length > 0 && parsed.failures.length === 0 &&
      failedChildren.every(child =>
        (child.closingTestPoint?.todo || child.closingTestPoint?.skip) &&
        !child.results.bailout && !child.results.failures.some(f => f.tapError))
    const ok = (parsed.ok || expectedChildFailures) && errors.length === 0
    this.results = { ...parsed, ok, counts: { ...this.counts }, errors }
    this.push('\n')

    if (!this.options.noreport) {
      this.failures.forEach((assertion, i) => {
        this.push(c.red(`\n   #${i + 1} - ${assertion.name || 'unnamed assertion'} -\n`))
        if (this.failures.length > 10) return
        const diag = assertion.diag || {}
        const actual = Object.hasOwn(diag, 'actual') ? 'actual' : 'found'
        for (const [key, label] of [[actual, 'actual'], ['expected', 'want'], ['message', 'message'], ['at', 'at']]) {
          if (Object.hasOwn(diag, key)) {
            this.push(`       ${label}: ${inspect(diag[key], { colors: false, depth: 4 })}\n`)
          }
        }
      })
    }
    // Protocol failures stay visible even with -noreport.
    for (const error of errors) this.push(c.red(`   ${error}\n`))
    if (parsed.plan.skipAll && !this.parser.syntheticPlan && ok) {
      this.push(c.cyan(`   suite skipped${parsed.plan.skipReason ? ': ' + parsed.plan.skipReason : ''}\n`))
    }
    this.push(c.gray(`   ${duration(this.started)}s\n`))
    const { passed, failed, skipped, todo } = this.counts
    this.push(`   ${niceNumber(passed)} passed, ${niceNumber(failed)} failed, ${niceNumber(skipped)} skipped, ${niceNumber(todo)} TODO\n`)
    this.push(ok ? c.green('   ✔️\n') : c.red('   FAILED\n'))
    this.emit('complete', this.results)
  }
}

module.exports = TapDance

// Keep the historical direct invocation working as well as the package bin.
if (require.main === module) require('./cli')()
