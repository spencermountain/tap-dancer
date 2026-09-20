import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const colorsUrl = new URL('../src/colors.js', import.meta.url).href
const render = (environment, force = false) => {
  const env = { ...process.env }
  for (const key of ['NO_COLOR', 'FORCE_COLOR', 'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TERM']) {
    delete env[key]
  }
  Object.assign(env, environment)
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import * as c from ${JSON.stringify(colorsUrl)}
    if (${force}) c.enableColor()
    process.stdout.write(JSON.stringify([
      c.red('red'), c.green('green'), c.yellow('yellow'), c.cyan('cyan'), c.gray('gray'),
      c.red('before ' + c.green('nested') + ' after'),
    ]))
  `], { env, encoding: 'utf8', timeout: 10000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('local colors respect environment and explicit color controls', () => {
  for (const [env, force, enabled] of [
    [{}, false, process.platform === 'win32'],
    [{ FORCE_COLOR: '1' }, false, true],
    [{ NO_COLOR: '' }, false, false],
    [{ NO_COLOR: '1', FORCE_COLOR: '1' }, true, false],
    [{ TERM: 'dumb' }, false, process.platform === 'win32'],
    [{ CI: '1', GITHUB_ACTIONS: '1' }, false, true],
    [{}, true, true],
  ]) {
    const values = render(env, force)
    assert.equal(values[0], enabled ? '\x1b[31mred\x1b[39m' : 'red', JSON.stringify(env))
  }
})

test('local colors use the expected ANSI codes and restore nested colors', () => {
  assert.deepEqual(render({ FORCE_COLOR: '1' }), [
    '\x1b[31mred\x1b[39m',
    '\x1b[32mgreen\x1b[39m',
    '\x1b[33myellow\x1b[39m',
    '\x1b[36mcyan\x1b[39m',
    '\x1b[90mgray\x1b[39m',
    '\x1b[31mbefore \x1b[32mnested\x1b[31m after\x1b[39m',
  ])
})
