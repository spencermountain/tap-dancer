#!/usr/bin/env node
import { Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { inspect } from 'node:util'
import { Parser } from 'tap-parser'
import * as c from './colors.js'
import { duration, niceNumber } from './fns.js'
import { isMain } from './is-main.js'

const failureLimit = 35
const dimNumber = (value) => c.dim(value)
const coloredText = (value, color) =>
  value
    .split(/(\d+(?:[,.]\d+)*)/g)
    .map((part, i) => (i % 2 ? dimNumber(part) : color(part)))
    .join('')
const failureText = (value) => coloredText(value, c.red)
const singleLine = (value) => String(value).replace(/[\r\n\u2028\u2029]+/g, ' ')
const formatValue = (value) =>
  singleLine(inspect(value, { colors: false, depth: 4, compact: true, breakLength: Infinity }))

// Truncate plain text before styling so ANSI escape sequences stay intact.
const truncate = (text, width) => {
  const chars = Array.from(text)
  return chars.length > width ? chars.slice(0, width - 1).join('') + '…' : text
}
const renderRow = (parts) => {
  const width = process.stdout.columns || 170
  const length = parts.reduce((sum, [text]) => sum + Array.from(text).length, 0)
  let remaining = length > width ? width - 1 : width
  const row = parts
    .map(([text, style]) => {
      const chars = Array.from(text).slice(0, Math.max(0, remaining))
      remaining -= chars.length
      return chars.length ? style(chars.join('')) : ''
    })
    .join('')
  return row + (length > width ? c.dim('…') : '') + '\n'
}

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
    this.tree = this.trackParser(this.parser)
    this.parser.on('error', (err) => this.destroy(err))
    this.parser.on('assert', (assertion) => {
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
        this.push(c.red('✗'))
      }
    })
    // Preserve ordinary console output alongside the test report.
    this.parser.on('extra', (text) => {
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*(?:\d+\.\.\d+|(?:not )?ok\b|Bail out!)/i.test(line)) {
          this.protocolErrors.push('Unexpected TAP data: ' + line.trim())
        }
      }
      this.push(text)
    })
    this.parser.on('complete', (results) => this.finishReport(results))
  }

  trackParser(parser) {
    const node = { parser, children: [] }
    parser.on('child', (child) => {
      node.children.push(this.trackParser(child))
    })
    return node
  }

  collectResults(node, errors, path = [], suppressed = false) {
    const { parser, children } = node
    const parsed = parser.results
    const prefix = path.length > 0 ? path.join(' > ') + ': ' : ''
    const addError = (message) => {
      errors.push(prefix + message)
    }
    for (const failure of parsed.failures) {
      if (failure.tapError) addError(failure.tapError)
      if (
        !suppressed &&
        !failure.ok &&
        !failure.skip &&
        !failure.todo &&
        Object.hasOwn(failure, 'name')
      ) {
        this.failures.push({ ...failure, name: prefix + (failure.name || 'unnamed assertion') })
      }
    }
    if (parser.syntheticPlan && !parsed.bailout) {
      addError('No TAP tests or explicit plan received')
    }
    // The parser may omit this check when an assertion already failed.
    if (
      !parsed.bailout &&
      parsed.plan.start !== null &&
      parsed.count !== parsed.plan.end - parsed.plan.start + 1
    ) {
      addError('incorrect number of tests')
    }
    if (parsed.bailout) {
      addError('Bail out!' + (typeof parsed.bailout === 'string' ? ' ' + parsed.bailout : ''))
    }
    for (const child of children) {
      const closing = child.parser.closingTestPoint
      this.collectResults(
        child,
        errors,
        [...path, child.parser.name || closing?.name || 'unnamed subtest'],
        suppressed || Boolean(closing?.todo || closing?.skip)
      )
    }
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
    const collectedErrors = [...this.protocolErrors]
    this.collectResults(this.tree, collectedErrors)
    const errors = [...new Set(collectedErrors)]
    // Evaluate the full tree after closing directives are known. TODO/SKIP
    // suppress assertion failures, but never malformed TAP or bailouts.
    const isOk = this.failures.length === 0 && errors.length === 0
    this.results = { ...parsed, ok: isOk, counts: { ...this.counts }, errors }
    this.push('\n')

    if (!this.options.noreport) {
      this.failures.slice(0, failureLimit).forEach((assertion, i) => {
        const diag = assertion.diag || {}
        const actual = Object.hasOwn(diag, 'actual') ? 'actual' : 'found'
        const parts = []
        const number = String(i + 1).padEnd(2)
        const prefix = ` #${number} `
        const name = truncate(singleLine(assertion.name || 'unnamed assertion'), 82)
        parts.push([' ', c.dim], ['#' + number, dimNumber], [' ', c.gray], [name, failureText])
        const hasDetails = [actual, 'expected', 'message'].some((key) => Object.hasOwn(diag, key))
        if (hasDetails) {
          const padding = ' '.repeat(Math.max(0, 30 - Array.from(prefix + name).length))
          parts.push([padding + ' - ', c.gray])
          if (Object.hasOwn(diag, actual)) {
            parts.push([formatValue(diag[actual]), (text) => coloredText(text, (value) => c.dim(c.yellow(value)))])
          }
          if (Object.hasOwn(diag, 'expected')) {
            parts.push(
              [Object.hasOwn(diag, actual) ? ' !' : '!', (text) => c.italic(c.red(text))],
              [formatValue(diag.expected), (text) => c.italic(coloredText(text, c.magenta))]
            )
          }
          if (Object.hasOwn(diag, 'message')) {
            const space = Object.hasOwn(diag, actual) || Object.hasOwn(diag, 'expected') ? ' ' : ''
            parts.push([
              `${space}message: ${formatValue(diag.message)}`,
              (text) => coloredText(text, c.gray)
            ])
          }
        }
        this.push(renderRow(parts))
      })
      if (this.failures.length > failureLimit) {
        this.push(
          c.dim(
            `   (showing ${failureLimit} of ${niceNumber(this.failures.length)} failing tests)\n\n`
          )
        )
      }
    }
    // Protocol failures stay visible even with -noreport.
    for (const error of errors) this.push(failureText(`   ${error}\n`))
    if (parsed.plan.skipAll && !this.parser.syntheticPlan && isOk) {
      this.push(
        c.cyan(`   suite skipped${parsed.plan.skipReason ? ': ' + parsed.plan.skipReason : ''}\n`)
      )
    }
    this.push(dimNumber(`   ${duration(this.started)}s\n`))
    const { passed, failed, skipped, todo } = this.counts
    const summary = []
    if (!isOk) summary.push(c.red(c.bold(failed > 0 ? `${niceNumber(failed)} Failed` : 'Failed')))
    summary.push(dimNumber(niceNumber(passed)) + c.dim(' passed'))
    for (const [count, label] of [
      [skipped, 'skipped'],
      [todo, 'TODO']
    ]) {
      if (count > 0) summary.push(dimNumber(niceNumber(count)) + c.dim(` ${label}`))
    }
    this.push(`   ${summary.join(', ')}\n`)
    this.emit('complete', this.results)
  }
}

export default TapDance

// Keep the historical direct invocation working as well as the package bin.
if (isMain(import.meta.url)) {
  import('./cli.js').then(({ default: run }) => run())
}
