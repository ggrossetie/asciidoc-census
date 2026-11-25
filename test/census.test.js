import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { extractRecords, runStudy } from '../lib/census.js'

const fixtures = fileURLToPath(new URL('fixtures/sample', import.meta.url))

// reports the first empty line after a document title
const headerEnd = {
  name: 'header-end',
  description: 'First empty line after the document title',
  dimensions: [{ key: 'title', title: 'Titles' }],
  extractDocument (lines) {
    const title = lines.findIndex((l) => l.startsWith('= '))
    if (title < 0) return []
    const end = lines.indexOf('', title)
    return end < 0 ? [] : [{ line: end + 1, record: { title: lines[title].slice(2) } }]
  },
  classify: (record) => ({ title: record.title }),
}

describe('extractRecords', () => {
  it('extracts records line by line with extract', () => {
    const study = { extract: (l) => (l.startsWith(':') ? { l } : undefined) }
    assert.deepEqual(extractRecords(study, ['a', ':b:', 'c']), [{ line: 2, record: { l: ':b:' } }])
  })

  it('extracts records from the whole document with extractDocument', () => {
    assert.deepEqual(extractRecords(headerEnd, ['= T', ':a:', '', 'x']), [{ line: 3, record: { title: 'T' } }])
    assert.deepEqual(extractRecords(headerEnd, ['no title']), [])
  })

  it('skips records without a value', () => {
    const study = { extractDocument: () => [{ line: 1, record: undefined }] }
    assert.deepEqual(extractRecords(study, ['a']), [])
  })

  it('rejects records without a valid line number', () => {
    for (const line of [0, 3, 1.5, undefined]) {
      const study = { name: 'bad', extractDocument: () => [{ line, record: {} }] }
      assert.throws(() => extractRecords(study, ['a', 'b']), /bad: extractDocument must return records with a line/)
    }
  })
})

describe('runStudy', () => {
  it('runs a study that extracts records from the whole document', () => {
    const result = runStudy(headerEnd, [fixtures])
    const titles = result.dimensions[0].rows
    assert.deepEqual(titles.map((r) => r.value), ['Sample'])
    const [example] = titles[0].examples
    assert.equal(example.line, 4)
    assert.equal(example.text, '')
  })
})
