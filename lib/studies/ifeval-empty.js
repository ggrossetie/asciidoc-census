// Finds ifeval::[] expressions whose result depends on how an unquoted operand that resolves to nothing
// (a missing attribute, or one set to an empty value) is treated: as the empty string, or as a distinct
// "no value" (like Asciidoctor's nil). Both options give the same result everywhere else.

import { parseLine } from './ifeval.js'

const AttributeEntryRx = /^:(!?\w[\w-]*!?):(?:[ \t]+(.*))?$/
// only attribute references, so the operand resolves to nothing when they are all missing or empty
const ReferencesOnlyRx = /^(?:\{\w[\w-]*\})+$/

const CASES = {
  'equals-empty-string': 'an unquoted reference compared with == or != to "" (empty string: true, no value: false)',
  'equals-quoted-reference': 'an unquoted reference compared with == or != to a quoted operand that may be empty, like "{attr}"',
  'equals-unquoted-reference': 'two unquoted references compared with == or != (both may resolve to nothing)',
  'ordering-string': 'an unquoted reference ordered (<, <=, >, >=) against a string or another reference ("" < "abc" is true, no value gives false)',
  'same-result': 'an unquoted reference compared to a non-empty value or ordered against a number: same result under both options',
}

const DEFINITIONS = {
  'defined-empty': 'a referenced attribute is defined with an empty value in the repository documents',
  'defined-non-empty': 'the referenced attributes are only defined with non-empty values in the repository documents',
  'defined-externally': 'a referenced attribute is never defined in the repository documents (CLI, build or Antora configuration, or undefined)',
}

const mayBeEmpty = (operand) => ReferencesOnlyRx.test(operand.raw)
const isQuoted = (operand) => operand.type.endsWith('-string')
const quotedMayBeEmpty = (operand) => isQuoted(operand) && (operand.raw.length === 2 || ReferencesOnlyRx.test(operand.raw.slice(1, -1)))

/**
 * Returns the parsed expression when at least one operand is unquoted and made only of attribute references.
 */
export function extract (line) {
  const parsed = parseLine(line)
  if (parsed?.status !== 'valid') return undefined
  return mayBeEmpty(parsed.lhs) || mayBeEmpty(parsed.rhs) ? parsed : undefined
}

export function caseOf ({ op, lhs, rhs }) {
  const equality = op === '==' || op === '!='
  for (const [operand, other] of [[lhs, rhs], [rhs, lhs]]) {
    if (!mayBeEmpty(operand)) continue
    if (equality) {
      if (isQuoted(other) && other.raw.length === 2) return 'equals-empty-string'
      if (quotedMayBeEmpty(other)) return 'equals-quoted-reference'
      if (mayBeEmpty(other)) return 'equals-unquoted-reference'
    } else if (other.type !== 'number') {
      // quoted strings, bare words, booleans (text under SDR-9) and references
      return 'ordering-string'
    }
  }
  return 'same-result'
}

export function classify (parsed, ctx = { definitions: new Map() }) {
  const attributes = [...new Set([...parsed.lhs.attributes, ...parsed.rhs.attributes].map((a) => a.toLowerCase()))]
  const values = attributes.map((name) => ctx.definitions.get(name))
  let definition
  if (values.some((v) => v?.has(''))) definition = 'defined-empty'
  else if (values.some((v) => !v)) definition = 'defined-externally'
  else definition = 'defined-non-empty'
  const operand = (o) => (mayBeEmpty(o) ? '{attr}' : o.shape)
  return {
    case: caseOf(parsed),
    pattern: `${operand(parsed.lhs)} ${parsed.op} ${operand(parsed.rhs)}`,
    definition,
    attribute: attributes,
  }
}

export default {
  name: 'ifeval-empty',
  description: 'ifeval::[] expressions whose result depends on how an unquoted operand that resolves to nothing is treated',
  dimensions: [
    { key: 'case', title: 'Cases', describe: (v) => CASES[v] },
    { key: 'pattern', title: 'Patterns' },
    { key: 'definition', title: 'Attribute definitions', describe: (v) => DEFINITIONS[v] },
    { key: 'attribute', title: 'Referenced attributes' },
  ],
  createContext: () => ({ definitions: new Map() }),
  observe (line, ctx) {
    const m = AttributeEntryRx.exec(line)
    if (!m || m[1].includes('!')) return
    const name = m[1].toLowerCase()
    if (!ctx.definitions.has(name)) ctx.definitions.set(name, new Set())
    ctx.definitions.get(name).add(m[2] ?? '')
  },
  extract,
  classify,
}
