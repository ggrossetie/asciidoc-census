import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ADOC_EXTENSIONS } from './corpus.js'

export function readSources (file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
}

export function cloneDir (cacheDir, url) {
  const m = url.match(/^(?:https?:\/\/|git@)([^/:]+)[:/](.+?)(?:\.git)?\/?$/)
  if (!m) throw new Error(`unsupported repository URL: ${url}`)
  return path.join(cacheDir, m[1], ...m[2].split('/'))
}

/**
 * Shallow, sparse clone of each repository: only AsciiDoc files are checked out.
 * Repositories already present in the cache are left untouched unless `update` is set.
 */
export function fetchSources (urls, cacheDir, { update = false, log = console.error } = {}) {
  const patterns = [...ADOC_EXTENSIONS].map((ext) => `*${ext}`)
  const run = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
  for (const url of urls) {
    const dir = cloneDir(cacheDir, url)
    try {
      if (existsSync(path.join(dir, '.git'))) {
        if (!update) {
          log(`skip ${url} (cached)`)
          continue
        }
        log(`update ${url}`)
        run(['fetch', '--depth', '1', 'origin', 'HEAD'], dir)
        run(['reset', '--hard', 'FETCH_HEAD'], dir)
        continue
      }
      log(`clone ${url}`)
      mkdirSync(path.dirname(dir), { recursive: true })
      run(['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--no-checkout', url, dir])
      run(['sparse-checkout', 'set', '--no-cone', ...patterns], dir)
      run(['checkout', '--quiet'], dir)
    } catch (err) {
      log(`error ${url}: ${err.stderr?.toString().trim() || err.message}`)
    }
  }
}
