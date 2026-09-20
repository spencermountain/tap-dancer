#!/usr/bin/env node
/* eslint-disable no-console */
import { pipeline } from 'node:stream'
import { enableColor } from './colors.js'
import TapDance from './index.js'
import { isMain } from './is-main.js'

const run = function () {
  const args = process.argv.slice(2)
  if (args.includes('--color')) enableColor()
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

export default run
if (isMain(import.meta.url)) run()
