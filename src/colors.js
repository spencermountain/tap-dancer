import { isatty } from 'node:tty'

const env = process.env
const disabled = 'NO_COLOR' in env
const forcedColor = 'FORCE_COLOR' in env
const windowsColor = process.platform === 'win32'
const terminalColor = isatty(1) && env.TERM && env.TERM !== 'dumb'
const ciColor = 'CI' in env && ('GITHUB_ACTIONS' in env || 'GITLAB_CI' in env || 'CIRCLECI' in env)

let enabled = !disabled && (forcedColor || windowsColor || terminalColor || ciColor)

export function enableColor() {
  if (!disabled) enabled = true
}

const color = code => value => {
  const text = String(value)
  const open = `\x1b[${code}m`
  // Restore the enclosing color after a nested foreground-color reset.
  return enabled ? open + text.replaceAll('\x1b[39m', open) + '\x1b[39m' : text
}

export const red = color(31)
export const green = color(32)
export const yellow = color(33)
export const cyan = color(36)
export const gray = color(90)
