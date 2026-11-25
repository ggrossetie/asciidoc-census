import path from 'node:path'
import { collectCorpus, readDocuments, repoLink, sourceLink } from './corpus.js'

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? [...new Set(v)] : [v])

class Bucket {
  occurrences = 0
  files = new Set()
  repos = new Set()
  examples = []

  add (occurrence, maxExamples) {
    this.occurrences++
    this.files.add(`${occurrence.repo}\0${occurrence.path}`)
    this.repos.add(occurrence.repo)
    // favor examples coming from distinct repositories
    if (this.examples.length < maxExamples && !this.examples.some((e) => e.repo === occurrence.repo)) {
      this.examples.push(occurrence)
    }
  }

  toJSON () {
    return { occurrences: this.occurrences, files: this.files.size, repos: this.repos.size, examples: this.examples }
  }
}

/**
 * Returns the records a study extracts from a document, as { line, record } with a 1-based line number.
 * A study extracts records either line by line (extract) or from the whole document (extractDocument).
 */
export function extractRecords (study, lines) {
  if (study.extractDocument) {
    const found = [...(study.extractDocument(lines) ?? [])]
    for (const r of found) {
      if (!Number.isInteger(r?.line) || r.line < 1 || r.line > lines.length) {
        throw new Error(`${study.name}: extractDocument must return records with a line between 1 and ${lines.length}, got ${JSON.stringify(r?.line)}`)
      }
    }
    return found.filter((r) => r.record)
  }
  return lines.flatMap((text, idx) => {
    const record = study.extract(text)
    return record ? [{ line: idx + 1, record }] : []
  })
}

const byRepos =(a, b) => b.repos - a.repos || b.occurrences - a.occurrences || String(a.value).localeCompare(String(b.value))

/**
 * Runs a study against every AsciiDoc document found under the given paths.
 */
export function runStudy (study, paths, { examples = 3 } = {}) {
  const stats = { repos: 0, files: 0, duplicateFiles: 0, occurrences: 0 }
  const reposWithOccurrences = new Set()
  const dimensions = Object.fromEntries(study.dimensions.map((d) => [d.key, new Map()]))
  const matrices = (study.matrices ?? []).map(() => new Map())
  const seenHashes = new Set()
  const sources = []
  const bucket = (map, key) => map.get(key) ?? map.set(key, new Bucket()).get(key)

  for (const repo of collectCorpus(paths)) {
    stats.repos++
    const ctx = study.createContext?.() ?? {}
    const records = []
    const filesBefore = stats.files
    for (const doc of readDocuments(repo, seenHashes, stats)) {
      if (study.observe) for (const text of doc.lines) study.observe(text, ctx)
      for (const { line, record } of extractRecords(study, doc.lines)) {
        records.push({ record, file: doc.file, path: doc.relPath, line, text: doc.lines[line - 1] })
      }
    }
    sources.push({
      repo: repo.key,
      commit: repo.commit,
      url: repoLink(repo),
      files: stats.files - filesBefore,
      filesWithOccurrences: new Set(records.map((r) => r.path)).size,
      occurrences: records.length,
    })
    // classification happens once the whole repository has been observed (e.g. attribute definitions)
    for (const { record, file, path: relPath, line, text } of records) {
      const classification = study.classify(record, ctx)
      const link = sourceLink(repo, relPath, line)
      const location = link ?? `${path.relative(process.cwd(), file)}:${line}`
      const occurrence = { repo: repo.key, path: relPath, line, text, location }
      stats.occurrences++
      reposWithOccurrences.add(repo.key)
      for (const { key } of study.dimensions) {
        for (const value of asArray(classification[key])) bucket(dimensions[key], value).add(occurrence, examples)
      }
      study.matrices?.forEach(({ rows, cols }, i) => {
        for (const r of asArray(classification[rows])) {
          for (const c of asArray(classification[cols])) bucket(matrices[i], `${r}\0${c}`).add(occurrence, 0)
        }
      })
    }
  }

  return {
    study: study.name,
    description: study.description,
    totals: { ...stats, reposWithOccurrences: reposWithOccurrences.size },
    sources: sources.sort((a, b) => b.occurrences - a.occurrences || b.files - a.files || a.repo.localeCompare(b.repo)),
    dimensions: study.dimensions.map(({ key, title, describe }) => ({
      key,
      title,
      rows: [...dimensions[key]].map(([value, b]) => ({ value, description: describe?.(value), ...b.toJSON() })).sort(byRepos),
    })),
    matrices: (study.matrices ?? []).map(({ title, rowOrder = [], colOrder = [] }, i) => {
      const cells = [...matrices[i]].map(([k, b]) => {
        const [row, col] = k.split('\0')
        return { row, col, occurrences: b.occurrences, repos: b.repos.size }
      })
      // declared values first (even when unused), then any other value found
      const order = (axis, preferred) => [...new Set([...preferred, ...cells.map((c) => c[axis]).sort()])]
      return { title, rows: order('row', rowOrder), cols: order('col', colOrder), cells }
    }),
  }
}
