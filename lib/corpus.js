import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const ADOC_EXTENSIONS = new Set(['.adoc', '.asciidoc', '.asc', '.ad'])
const IGNORED_DIRS = new Set(['node_modules', 'bower_components', 'target', 'build', 'dist'])
// hidden directories are ignored, except these ones (e.g. elastic/go-elasticsearch keeps its docs in .doc)
const INCLUDED_HIDDEN_DIRS = new Set(['.doc'])

function git (cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

// Normalizes a remote URL so that SSH and HTTPS clones of the same repository share a key.
export function normalizeRemote (url) {
  if (!url) return undefined
  const m = url.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/i)
  return m ? `${m[1].toLowerCase()}/${m[2]}` : url
}

// Forgejo/Gitea instances (links use /src/commit/)
const FORGEJO_HOSTS = new Set(['forge.fedoraproject.org', 'codeberg.org'])

export function sourceLink (repo, relPath, line) {
  if (!repo.remote || !repo.commit) return undefined
  const [host, ...rest] = repo.remote.split('/')
  const slug = rest.join('/')
  const file = relPath.split(path.sep).map(encodeURIComponent).join('/')
  if (host === 'github.com') return `https://github.com/${slug}/blob/${repo.commit}/${file}#L${line}`
  if (host.startsWith('gitlab.')) return `https://${host}/${slug}/-/blob/${repo.commit}/${file}#L${line}`
  if (FORGEJO_HOSTS.has(host)) return `https://${host}/${slug}/src/commit/${repo.commit}/${file}#L${line}`
  return undefined
}

// Link to the repository tree at the analyzed commit.
export function repoLink (repo) {
  if (!repo.remote || !repo.commit) return undefined
  const [host, ...rest] = repo.remote.split('/')
  const slug = rest.join('/')
  if (host === 'github.com') return `https://github.com/${slug}/tree/${repo.commit}`
  if (host.startsWith('gitlab.')) return `https://${host}/${slug}/-/tree/${repo.commit}`
  if (FORGEJO_HOSTS.has(host)) return `https://${host}/${slug}/src/commit/${repo.commit}`
  return undefined
}

class RepoResolver {
  #byRoot = new Map()
  #rootOf = new Map()

  rootOf (dir) {
    if (this.#rootOf.has(dir)) return this.#rootOf.get(dir)
    const parent = path.dirname(dir)
    const root = existsSync(path.join(dir, '.git')) ? dir : parent === dir ? undefined : this.rootOf(parent)
    this.#rootOf.set(dir, root)
    return root
  }

  resolve (file, fallbackRoot) {
    const root = this.rootOf(path.dirname(file)) ?? fallbackRoot
    let repo = this.#byRoot.get(root)
    if (!repo) {
      const isGit = existsSync(path.join(root, '.git'))
      const remote = isGit ? normalizeRemote(git(root, 'remote', 'get-url', 'origin')) : undefined
      const commit = isGit ? git(root, 'rev-parse', 'HEAD') : undefined
      repo = { root, remote, commit, key: remote ?? `local:${root}` }
      this.#byRoot.set(root, repo)
    }
    return repo
  }
}

function * walk (dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if ((entry.name.startsWith('.') && !INCLUDED_HIDDEN_DIRS.has(entry.name)) || IGNORED_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield * walk(full)
    else if (entry.isFile() && ADOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield full
  }
}

/**
 * Yields the AsciiDoc documents found under the given paths, grouped by repository.
 * Files whose content was already seen (forks, vendored copies) are skipped and counted.
 */
export function collectCorpus (paths) {
  const resolver = new RepoResolver()
  const repos = new Map()
  for (const p of paths) {
    const abs = path.resolve(p)
    const files = statSync(abs).isDirectory() ? walk(abs) : [abs]
    const fallbackRoot = statSync(abs).isDirectory() ? abs : path.dirname(abs)
    for (const file of files) {
      const repo = resolver.resolve(file, fallbackRoot)
      if (!repos.has(repo.key)) repos.set(repo.key, { ...repo, files: [] })
      repos.get(repo.key).files.push(file)
    }
  }
  return [...repos.values()]
}

export function * readDocuments (repo, seenHashes, stats) {
  for (const file of repo.files) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const hash = createHash('sha1').update(content).digest('hex')
    if (seenHashes.has(hash)) {
      stats.duplicateFiles++
      continue
    }
    seenHashes.add(hash)
    stats.files++
    const relPath = path.relative(repo.root, file)
    // like Asciidoctor, trailing whitespace is ignored
    const lines = content.split(/\r?\n/).map((l) => l.trimEnd())
    yield { file, relPath, lines }
  }
}
