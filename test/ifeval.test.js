import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runStudy } from '../lib/census.js'
import ifeval, { analyzeOperand, classify, parseLine } from '../lib/studies/ifeval.js'

const fixtures = fileURLToPath(new URL('fixtures/sample', import.meta.url))

describe('ifeval', () => {
  it('ignores lines that are not ifeval directives', () => {
    assert.equal(parseLine('ifdef::foo[]'), undefined)
    assert.equal(parseLine(' ifeval::["a" == "b"]'), undefined)
  })

  it('reports invalid directives', () => {
    assert.equal(parseLine('ifeval::[]').reason, 'missing-expression')
    assert.equal(parseLine('ifeval::foo["a" == "b"]').reason, 'target-not-permitted')
    assert.equal(parseLine('ifeval::[{foo}]').reason, 'invalid-expression')
    assert.equal(parseLine('ifeval::[{foo} = 1]').reason, 'invalid-expression')
    assert.equal(parseLine('ifeval::["a" == "b"] trailing').reason, 'not-a-directive')
    assert.equal(parseLine('\\ifeval::["a" == "b"]').status, 'escaped')
  })

  it('splits the expression like Asciidoctor', () => {
    const p = parseLine('ifeval::[ {a}>=1 ]')
    assert.equal(p.op, '>=')
    assert.equal(p.lhs.raw, '{a}')
    assert.equal(p.rhs.raw, '1')
    assert.ok(classify(p).flags.includes('whitespace-around-operator'))
  })

  it('classifies operands', () => {
    const shape = (s) => analyzeOperand(s).shape
    assert.equal(shape('"{backend}"'), '"{attr}"')
    assert.equal(shape('"html5"'), '"text"')
    assert.equal(shape('"{a}-{b}"'), '"…{attr}…"')
    assert.equal(shape("'x'"), "'text'")
    assert.equal(shape('""'), '""')
    assert.equal(shape('{a}'), '{attr}')
    assert.equal(shape('{a}.{b}'), '…{attr}…')
    assert.equal(shape('12'), 'integer')
    assert.equal(shape('1.5'), 'decimal')
    assert.equal(shape('1.5.8'), 'version')
    assert.equal(shape('true'), 'true')
    assert.equal(shape('html5'), 'word')
    assert.equal(shape('"html5'), 'unbalanced')
  })

  it('builds patterns and flags', () => {
    const c = (line) => classify(parseLine(line))
    assert.equal(c('ifeval::["{backend}" == "html5"]').pattern, '"{attr}" == "text"')
    assert.deepEqual(c('ifeval::["{backend}" == "html5"]').flags, [])
    assert.ok(c("ifeval::['a' == \"a\"]").flags.includes('mixed-quote-styles'))
    assert.ok(c('ifeval::["1" == 1]').flags.includes('type-mismatch'))
    assert.ok(c('ifeval::["a" < "b"]').flags.includes('string-ordering'))
    assert.ok(c('ifeval::[{x} == foo]').flags.includes('bare-word'))
    assert.ok(c('ifeval::[{x} == 1]').flags.includes('attribute-defined-externally'))
    assert.ok(!c('ifeval::[{backend} == 1]').flags.includes('attribute-defined-externally'))
  })

  it('aggregates a corpus and skips duplicate files', () => {
    const result = runStudy(ifeval, [fixtures])
    assert.equal(result.totals.files, 1)
    assert.equal(result.totals.duplicateFiles, 1)
    const dim = (key) => Object.fromEntries(result.dimensions.find((d) => d.key === key).rows.map((r) => [r.value, r.occurrences]))
    assert.deepEqual(dim('status'), { valid: 5, invalid: 4, escaped: 1 })
    assert.equal(dim('pattern')['"{attr}" == "text"'], 1)
    assert.equal(dim('pattern')['{attr} < version'], 1)
    const flags = dim('flags')
    assert.equal(flags['attribute-value-has-quotes'], 1) // {product} is defined as "Acme"
    assert.equal(flags['version-number'], 1)
    assert.equal(flags['attribute-defined-externally'], undefined) // backend, sectnums, asciidoctor-version are built-in
  })
})
