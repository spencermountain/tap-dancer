#!/usr/bin/env node
'use strict'
const { pipeline } = require('node:stream')

const run = function () {
  const args = process.argv.slice(2)
  if (args.includes('--color')) process.env.FORCE_COLOR = '1'
  const TapDance = require('./index')
  const reporter = new TapDance({ noreport: args.includes('-noreport') || args.includes('--noreport') })
  const nofail = args.includes('-nofail') || args.includes('--nofail')
  reporter.on('complete', results => {
    if (!results.ok && !nofail) process.exitCode = 1
  })
  pipeline(process.stdin, reporter, process.stdout, err => {
    if (err) {
      console.error(`tap-dancer: ${err.message}`)
      process.exitCode = 1
    }
  })
}

module.exports = run
if (require.main === module) run()
