#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { runStudy } from '../lib/census.js'
import { fetchSources, readSources } from '../lib/fetch.js'
import { formats } from '../lib/report.js'
import { studies } from '../lib/studies/index.js'

const DEFAULT_CACHE = '.cache/repos'

const USAGE = `Usage:
  adoc-census list
      List available studies.
  adoc-census fetch [--sources sources.txt] [--cache ${DEFAULT_CACHE}] [--update]
      Shallow-clone the repositories listed in the sources file (AsciiDoc files only).
  adoc-census run <study> [path...] [--format text|adoc|html|json] [--examples 3] [--limit 20] [--output file]
      Run a study on the given files/directories (default: ${DEFAULT_CACHE}).`

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sources: { type: 'string', default: 'sources.txt' },
    cache: { type: 'string', default: DEFAULT_CACHE },
    update: { type: 'boolean', default: false },
    format: { type: 'string', short: 'f', default: 'text' },
    examples: { type: 'string', default: '3' },
    limit: { type: 'string' },
    output: { type: 'string', short: 'o' },
    help: { type: 'boolean', short: 'h' },
  },
})

const [command, ...args] = positionals

function fail (message) {
  console.error(message)
  process.exit(1)
}

if (opts.help || !command) {
  console.log(USAGE)
} else if (command === 'list') {
  for (const s of studies.values()) console.log(`${s.name}\t${s.description}`)
} else if (command === 'fetch') {
  fetchSources(readSources(opts.sources), opts.cache, { update: opts.update })
} else if (command === 'run') {
  const [name, ...paths] = args
  const study = studies.get(name) ?? fail(`unknown study: ${name ?? ''}\n\n${USAGE}`)
  const format = formats[opts.format] ?? fail(`unknown format: ${opts.format} (expected ${Object.keys(formats).join(', ')})`)
  const result = runStudy(study, paths.length ? paths : [opts.cache], { examples: Number(opts.examples) })
  const output = format(result, opts.limit ? { limit: Number(opts.limit) } : {})
  if (opts.output) writeFileSync(opts.output, output + '\n')
  else console.log(output)
} else {
  fail(`unknown command: ${command}\n\n${USAGE}`)
}
