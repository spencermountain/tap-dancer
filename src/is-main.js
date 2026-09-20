import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// npm installs command-line entry points as symlinks on Unix.
export function isMain(url) {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(url)
  } catch {
    return false
  }
}
