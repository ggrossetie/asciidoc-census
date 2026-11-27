import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runStudy } from '../lib/census.js'
import headerEmptyLines, { analyze, classify, extractDocument, isHeaderOnly } from '../lib/studies/header-empty-lines.js'

const fixtures = fileURLToPath(new URL('fixtures/header-empty-lines', import.meta.url))
const doc = (text) => text.split('\n')
const changesOf = (text) => analyze(doc(text)).changes
const documentOf = (text) => analyze(doc(text)).document

describe('header-empty-lines', () => {
  describe('below the title', () => {
    it('finds attribute entries after an empty line, before any other content', () => {
      assert.deepEqual(changesOf('= T\n:description: D\n\n:doctype: book\n:toc: left\n\n:icons: font\n\n== S'), [
        { change: 'entries-after-empty-line-below-title', line: 4, attributes: ['doctype', 'toc', 'icons'] },
      ])
      assert.deepEqual(changesOf('= T\n\n:toc!:\n'), [{ change: 'entries-after-empty-line-below-title', line: 3, attributes: ['toc'] }])
      // the header also ends with an empty line after the author and revision lines
      assert.deepEqual(changesOf('= T\nDoc Writer\nv1.0\n\n:sectnums:\n\npara'), [
        { change: 'entries-after-empty-line-below-title', line: 5, attributes: ['sectnums'] },
      ])
    })

    it('stops at the first line that is neither empty nor a header line', () => {
      assert.deepEqual(changesOf('= T\n\npara\n\n:toc:'), [])
      assert.deepEqual(changesOf('= T\n\n[abstract]\n:toc:\npara'), [])
      assert.deepEqual(changesOf('= T\n:toc:\n\n== S\n\n:sectnums:'), [])
    })

    it('reads continuation lines and comment blocks as part of the header lines', () => {
      assert.deepEqual(changesOf('= T\n\n:description: a \\\n  b\n////\n:not-an-entry:\n\npara\n////\n:toc:\n\npara'), [
        { change: 'entries-after-empty-line-below-title', line: 3, attributes: ['description', 'toc'] },
      ])
    })

    it('reports include directives and comments that move to the header', () => {
      assert.deepEqual(changesOf('= T\n\ninclude::attributes.adoc[]\n\n== S'), [{ change: 'include-after-empty-line-below-title', line: 3 }])
      assert.deepEqual(changesOf('= T\n\n// a comment\n\npara'), [{ change: 'comments-after-empty-line-below-title', line: 3 }])
    })

    it('ignores preprocessor conditionals', () => {
      assert.deepEqual(changesOf('= T\n\nifdef::env-github[]\n:toc: macro\nendif::[]\n\npara'), [
        { change: 'entries-after-empty-line-below-title', line: 4, attributes: ['toc'] },
      ])
    })
  })

  describe('author and revision lines', () => {
    it('finds attribute entries or comments between the title and the author line', () => {
      assert.deepEqual(changesOf('= T\n:toc:\nDoc Writer\n\npara'), [
        { change: 'entry-before-author-line', line: 3, authorLine: 'author-like' },
      ])
      assert.deepEqual(changesOf('= T\n// comment\nThis paragraph is read as the author line.'), [
        { change: 'entry-before-author-line', line: 3, authorLine: 'not-author-like' },
      ])
      assert.deepEqual(changesOf('= T\ninclude::attrs.adoc[]\nDoc Writer <doc@example.org>'), [
        { change: 'include-before-author-line', line: 3, authorLine: 'author-like' },
      ])
      assert.deepEqual(changesOf('= T\nDoc Writer\n\npara'), [])
    })

    it('finds attribute entries between the author line and the revision line', () => {
      assert.deepEqual(changesOf('= T\nDoc Writer\n:toc:\nv1.0, 2026-11-26\n\npara'), [{ change: 'entry-before-revision-line', line: 4 }])
      assert.deepEqual(changesOf('= T\nDoc Writer\nv1.0, 2026-11-26\n:toc:\n\npara'), [])
    })
  })

  describe('documents without a title', () => {
    it('finds attribute entries after block metadata', () => {
      assert.deepEqual(changesOf('[#intro.big]\n:toc: left\n\n== S'), [
        { change: 'entries-after-block-metadata-untitled', line: 2, attributes: ['toc'] },
      ])
      assert.deepEqual(changesOf(':a: b\n\n.Title\n\n:c: d\npara'), [
        { change: 'entries-after-block-metadata-untitled', line: 5, attributes: ['c'] },
      ])
      assert.deepEqual(changesOf(':a: b\n\n:c: d\n[#intro]\npara'), [])
    })

    it('keeps entries between title metadata and the title in the header', () => {
      assert.deepEqual(changesOf('[#doc.big]\n:toc: left\n\n= T\n\npara'), [])
      assert.deepEqual(documentOf('[#doc.big]\n:toc: left\n\n= T\n\npara'), ['titled', 'empty-lines-above-title', 'title-metadata-separated'])
      assert.deepEqual(documentOf('[[doc]]\n[.big]\n= T'), ['titled'])
    })
  })

  describe('documents', () => {
    it('recognizes atx, Markdown, and setext document titles', () => {
      assert.deepEqual(documentOf('= T'), ['titled'])
      assert.deepEqual(documentOf('# T'), ['titled'])
      assert.deepEqual(documentOf('Title\n====='), ['titled'])
      assert.deepEqual(documentOf('Title\n========'), ['untitled'])
      assert.deepEqual(documentOf('== Section'), ['untitled'])
      assert.deepEqual(documentOf(':a: b\n\npara'), ['untitled-with-header'])
      assert.deepEqual(documentOf(''), ['untitled'])
    })

    it('reports empty lines between header lines above the title', () => {
      assert.deepEqual(documentOf('\n\n= T'), ['titled'])
      assert.deepEqual(documentOf(':a: b\n\n:c: d\n= T'), ['titled', 'empty-lines-above-title'])
      assert.deepEqual(documentOf(':a: b\n:c: d\n\n= T'), ['titled', 'empty-lines-above-title'])
      assert.deepEqual(documentOf(':a: b\n:c: d\n= T'), ['titled'])
    })

    it('reports a block title above the document title', () => {
      assert.deepEqual(documentOf('.Caption\n= T\n\n:toc:'), ['block-title-above-title'])
      assert.deepEqual(changesOf('.Caption\n= T\n\n:toc:'), [])
    })
  })

  it('classifies the effect of the moved attribute entries', () => {
    assert.equal(isHeaderOnly('toc'), true)
    assert.equal(isHeaderOnly('page-layout'), true)
    assert.equal(isHeaderOnly('sectnums'), false)
    const [, header, anywhere] = extractDocument(doc('= T\n\n:toc:\n:sectnums:\n\npara'))
      .concat(extractDocument(doc('= T\n\n:sectnums:\n\npara')).slice(1))
    assert.deepEqual(classify(header.record), {
      change: 'entries-after-empty-line-below-title',
      effect: 'header-only',
      'header-only': ['toc'],
      attribute: ['toc', 'sectnums'],
      'author-line': undefined,
    })
    assert.equal(classify(anywhere.record).effect, 'anywhere-only')
    assert.equal(classify(extractDocument(doc('= T\n:toc:\nDoc Writer'))[1].record).effect, undefined)
    assert.deepEqual(classify(extractDocument(doc('= T'))[0].record), { document: ['titled'] })
  })

  it('runs on documents', () => {
    const result = runStudy(headerEmptyLines, [fixtures])
    const rows = (key) => Object.fromEntries(result.dimensions.find((d) => d.key === key).rows.map((r) => [r.value, r.files]))
    assert.deepEqual(rows('change'), { 'entries-after-empty-line-below-title': 1, 'entries-after-block-metadata-untitled': 1 })
    assert.deepEqual(rows('document'), { titled: 1, 'untitled-with-header': 1 })
    const example = (value) => result.dimensions.find((d) => d.key === 'change').rows.find((r) => r.value === value).examples[0]
    assert.equal(example('entries-after-empty-line-below-title').text, ':doctype: book')
    assert.equal(example('entries-after-block-metadata-untitled').text, ':toc: left')
  })
})
