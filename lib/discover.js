import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { normalizeRemote } from './corpus.js'

const AdocPathRx = /\.(adoc|asciidoc|ad)$/i

function gh (endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }))
  } catch {
    return undefined
  }
}

// Reads the result of queries/asciidoc-repositories.sql, exported as CSV or JSON (repo_name, files, owned_files).
export function readCandidates (file) {
  const content = readFileSync(file, 'utf8')
  let rows
  if (content.trimStart().startsWith('[')) {
    rows = JSON.parse(content)
  } else {
    const [header, ...lines] = content.split(/\r?\n/).filter(Boolean)
    const cols = header.split(',').map((c) => c.trim())
    rows = lines.map((line) => {
      const values = line.split(',')
      return Object.fromEntries(cols.map((c, i) => [c, values[i]?.trim()]))
    })
  }
  return rows.map((row) => ({ repo: row.repo_name, snapshotFiles: Number(row.owned_files ?? row.files) }))
}

// Code search is slower and rate limited, it is only used when the tree is too large to be listed.
function searchCount (fullName) {
  let total = 0
  for (const ext of ['adoc', 'asciidoc', 'ad']) {
    const result = gh(`search/code?q=${encodeURIComponent(`repo:${fullName} extension:${ext}`)}&per_page=1`)
    if (!result) return undefined
    total += result.total_count
  }
  return total
}

function countAsciiDocFiles (repo) {
  const tree = gh(`repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`)
  if (!tree) return undefined
  if (tree.truncated) return searchCount(repo.full_name)
  return tree.tree.filter((e) => e.type === 'blob' && AdocPathRx.test(e.path)).length
}

/**
 * Checks candidate repositories against the GitHub API, since the BigQuery snapshot is old:
 * forks, archived and missing repositories are skipped, and AsciiDoc files are counted at the current HEAD.
 * Yields the repositories that still have at least `min` AsciiDoc files.
 */
export function * discover (candidates, { known = [], min = 50, limit = 100, log = console.error } = {}) {
  const seen = new Set(known.map(normalizeRemote))
  let checked = 0
  for (const { repo: name, snapshotFiles } of candidates) {
    if (checked >= limit) break
    if (seen.has(normalizeRemote(`https://github.com/${name}`))) continue
    checked++
    let repo = gh(`repos/${name}`)
    if (!repo) {
      log(`skip ${name}: not found`)
      continue
    }
    // the snapshot query may attribute the files to a fork (when it has more files than the original):
    // the original repository is proposed instead
    if (repo.fork && repo.source) {
      log(`replace ${repo.full_name}: fork of ${repo.source.full_name}`)
      repo = repo.source
    }
    // renamed or transferred repositories are reported under their current name
    const url = repo.html_url
    if (seen.has(normalizeRemote(url))) continue
    seen.add(normalizeRemote(url))
    if (repo.fork || repo.archived) {
      log(`skip ${repo.full_name}: ${repo.fork ? 'fork' : 'archived'}`)
      continue
    }
    const files = countAsciiDocFiles(repo)
    if (files === undefined) {
      log(`skip ${repo.full_name}: cannot count files`)
      continue
    }
    if (files < min) {
      log(`skip ${repo.full_name}: ${files} AsciiDoc file(s) now (${snapshotFiles} in the snapshot)`)
      continue
    }
    yield { url, files, snapshotFiles, description: repo.description ?? '' }
  }
}
