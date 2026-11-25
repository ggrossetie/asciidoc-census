import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import ifevalEmpty, { caseOf, extract } from '../lib/studies/ifeval-empty.js'

describe('ifeval-empty', () => {
  it('only extracts expressions with an unquoted operand made of attribute references', () => {
    assert.equal(extract('ifeval::["{a}" == ""]'), undefined)
    assert.equal(extract('ifeval::[{a}.{b} == 1]'), undefined)
    assert.equal(extract('ifeval::[{a} = 1]'), undefined)
    assert.equal(extract('ifdef::a[]'), undefined)
    assert.ok(extract('ifeval::[{a} == 1]'))
    assert.ok(extract('ifeval::[1 == {a}{b}]'))
  })

  it('identifies the expressions whose result differs', () => {
    const c = (line) => caseOf(extract(line))
    assert.equal(c('ifeval::[{a} == ""]'), 'equals-empty-string')
    assert.equal(c("ifeval::['' != {a}]"), 'equals-empty-string')
    assert.equal(c('ifeval::[{a} == "{b}"]'), 'equals-quoted-reference')
    assert.equal(c('ifeval::[{a} == {b}]'), 'equals-unquoted-reference')
    assert.equal(c('ifeval::[{a} < "abc"]'), 'ordering-string')
    assert.equal(c('ifeval::[{a} >= abc]'), 'ordering-string')
    assert.equal(c('ifeval::[{a} > {b}]'), 'ordering-string')
    assert.equal(c('ifeval::[{a} == true]'), 'same-result')
    assert.equal(c('ifeval::[{a} != 0]'), 'same-result')
    assert.equal(c('ifeval::[{a} == "{b}-x"]'), 'same-result')
    assert.equal(c('ifeval::[{a} < 20]'), 'same-result')
  })

  it('reports how the referenced attributes are defined', () => {
    const ctx = ifevalEmpty.createContext()
    for (const line of [':empty:', ':full: yes']) ifevalEmpty.observe(line, ctx)
    const d = (line) => ifevalEmpty.classify(extract(line), ctx).definition
    assert.equal(d('ifeval::[{empty} == ""]'), 'defined-empty')
    assert.equal(d('ifeval::[{full} == ""]'), 'defined-non-empty')
    assert.equal(d('ifeval::[{other} == ""]'), 'defined-externally')
    assert.equal(ifevalEmpty.classify(extract('ifeval::[{full} == ""]'), ctx).pattern, '{attr} == ""')
  })
})
