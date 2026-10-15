// Classifies ifeval::[] expressions.
// The parsing mirrors Asciidoctor (lib/asciidoctor/reader.rb and rx.rb) so that "valid" means
// "accepted by Asciidoctor", and flags point at behaviors that depend on implementation details.

// same as Asciidoctor's ConditionalDirectiveRx, restricted to ifeval
const DirectiveRx = /^(\\)?ifeval::(\S*?(?:([,+])\S*?)?)\[(.+)?\]$/
const EvalExpressionRx = /^(.+?) *([=!><]=|[><]) *(.+)$/
const AttributeReferenceRx = /(\\)?\{(\w[\w-]*|(?:set|counter2?):.+?)(\\)?\}/g
const AttributeEntryRx = /^:(!?\w[\w-]*!?):(?:[ \t]+(.*))?$/

export const OPERATORS = ['==', '!=', '<', '<=', '>', '>=']

// attributes provided by the processor; they are always defined
const BUILTIN_ATTRIBUTES = new Set([
  'asciidoctor', 'asciidoctor-version', 'backend', 'basebackend', 'docdate', 'docdatetime', 'docdir', 'docfile',
  'docfilesuffix', 'docname', 'doctime', 'doctitle', 'doctype', 'docyear', 'embedded', 'env', 'filetype',
  'htmlsyntax', 'localdate', 'localdatetime', 'localtime', 'localyear', 'outdir', 'outfile', 'outfilesuffix',
  'safe-mode-level', 'safe-mode-name', 'safe-mode-unsafe', 'safe-mode-safe', 'safe-mode-server', 'safe-mode-secure',
  'user-home', 'attribute-missing', 'attribute-undefined', 'doctype-article', 'doctype-book', 'doctype-manpage',
  'doctype-inline', 'backend-html5', 'backend-docbook5', 'backend-pdf', 'basebackend-html', 'basebackend-docbook',
  'notitle', 'showtitle', 'linkcss', 'imagesdir', 'iconsdir', 'stylesdir', 'toc', 'sectnums', 'experimental',
  'idprefix', 'idseparator', 'max-include-depth', 'lang', 'nofooter', 'webfonts', 'stylesheet', 'source-highlighter',
  'icons', 'leveloffset', 'partnums', 'chapter-signifier', 'appendix-caption', 'page-component-name',
  'page-component-version', 'page-component-display-version', 'page-version', 'page-module', 'page-relative-src-path',
  'page-origin-branch', 'page-origin-url', 'site-url', 'site-title', 'env-github', 'env-gitlab', 'env-site',
  'env-browser', 'env-vscode', 'env-idea', 'site-gen', 'site-gen-antora', 'antora-version',
  'gh-repo', 'gh-org', 'manname', 'manvolnum', 'mantitle', 'manpurpose', 'revnumber', 'revdate', 'revremark',
  'author', 'email', 'authors', 'firstname', 'lastname', 'authorinitials', 'description', 'keywords',
])

const OPERAND_TYPES = {
  'dq-string': 'double-quoted string',
  'sq-string': 'single-quoted string',
  number: 'bare number',
  attribute: 'bare attribute reference',
  boolean: 'boolean',
  other: 'other',
}

const FLAGS = {
  'unquoted-attribute-ref': 'an unquoted attribute reference is coerced (empty → nil, "x.y" → Float, otherwise Integer)',
  'bare-word': 'an unquoted literal that is neither a number nor a boolean is coerced to an Integer (usually 0)',
  'compound-unquoted': 'an unquoted operand mixes attribute references and text',
  'type-mismatch': 'operands resolve to different types (== is always false, ordering raises and the block is skipped)',
  'mixed-quote-styles': 'one operand is single-quoted and the other double-quoted (Asciidoctor keeps the closing quote, so they never compare equal)',
  'string-ordering': 'a <, <=, > or >= comparison between strings (lexicographic)',
  'version-number': 'a bare version number like 1.5.8 is truncated to a Float (1.5)',
  'unbalanced-quotes': 'an operand starts or ends with a quote but not both',
  'empty-string': 'an operand is an empty quoted string',
  'escaped-attribute-ref': 'an operand contains an escaped attribute reference',
  'counter-or-set': 'an operand uses {counter:...} or {set:...} (side effects)',
  'attribute-defined-externally': 'a referenced attribute is not built-in and never defined in the repository documents (CLI, build or Antora configuration, or undefined)',
  'attribute-value-has-quotes': 'a referenced attribute is defined somewhere with a value that contains a quote',
  'whitespace-around-operator': 'non-standard whitespace around the operator (none, or more than one space)',
}

const INVALID = {
  'missing-expression': 'ifeval::[] without an expression',
  'target-not-permitted': 'ifeval::target[...] has a target',
  'invalid-expression': 'the expression has no comparison operator',
  'not-a-directive': 'starts with ifeval:: but does not match the directive syntax (line ignored by Asciidoctor)',
  escaped: 'escaped directive (\\ifeval::)',
}

function attributeRefs (text) {
  return [...text.matchAll(AttributeReferenceRx)].map((m) => ({ name: m[2], escaped: !!(m[1] || m[3]) }))
}

function isQuoted (s) {
  return (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
}

/**
 * Describes an operand: its coarse type (as in the README matrix), its shape (used to build patterns),
 * the type it resolves to at runtime when known, and the flags it raises.
 */
export function analyzeOperand (raw) {
  const refs = attributeRefs(raw)
  const flags = []
  if (refs.some((r) => r.escaped)) flags.push('escaped-attribute-ref')
  if (refs.some((r) => /^(set|counter2?):/.test(r.name))) flags.push('counter-or-set')
  const names = refs.filter((r) => !r.escaped && !r.name.includes(':')).map((r) => r.name)

  if (isQuoted(raw)) {
    const q = raw[0]
    const inner = raw.length > 1 ? raw.slice(1, -1) : ''
    let shape
    if (inner === '') {
      shape = `${q}${q}`
      flags.push('empty-string')
    } else if (refs.length === 1 && inner === `{${refs[0].name}}`) shape = `${q}{attr}${q}`
    else if (refs.length) shape = `${q}…{attr}…${q}`
    else shape = `${q}text${q}`
    return { raw, type: q === '"' ? 'dq-string' : 'sq-string', resolves: 'string', shape, flags, attributes: names }
  }

  if (/^["']|["']$/.test(raw)) flags.push('unbalanced-quotes')
  if (raw === 'true' || raw === 'false') return { raw, type: 'boolean', resolves: 'boolean', shape: raw, flags, attributes: names }
  if (/^[-+]?\d+$/.test(raw)) return { raw, type: 'number', resolves: 'number', shape: 'integer', flags, attributes: names }
  if (/^[-+]?\d*\.\d+$/.test(raw)) return { raw, type: 'number', resolves: 'number', shape: 'decimal', flags, attributes: names }
  if (/^[-+]?\d+(\.\d+){2,}$/.test(raw)) {
    flags.push('version-number')
    return { raw, type: 'number', resolves: 'number', shape: 'version', flags, attributes: names }
  }
  if (refs.length === 1 && raw === `{${refs[0].name}}`) {
    flags.push('unquoted-attribute-ref')
    return { raw, type: 'attribute', resolves: undefined, shape: '{attr}', flags, attributes: names }
  }
  if (refs.length) {
    flags.push('unquoted-attribute-ref', 'compound-unquoted')
    return { raw, type: 'other', resolves: undefined, shape: '…{attr}…', flags, attributes: names }
  }
  if (!flags.includes('unbalanced-quotes')) flags.push('bare-word')
  return { raw, type: 'other', resolves: 'number', shape: flags.includes('unbalanced-quotes') ? 'unbalanced' : 'word', flags, attributes: names }
}

/**
 * Parses a line. Returns undefined when the line is not an ifeval directive.
 */
export function parseLine (line) {
  if (!/^\\?ifeval::/.test(line)) return undefined
  const m = DirectiveRx.exec(line)
  if (!m) return { status: 'invalid', reason: 'not-a-directive' }
  const [, escaped, target, , text] = m
  if (escaped) return { status: 'escaped', reason: 'escaped' }
  if (target) return { status: 'invalid', reason: 'target-not-permitted' }
  if (!text) return { status: 'invalid', reason: 'missing-expression' }
  const expression = text.trim()
  const e = EvalExpressionRx.exec(expression)
  if (!e) return { status: 'invalid', reason: 'invalid-expression', expression }
  const [, lhs, op, rhs] = e
  const spacing = expression.slice(lhs.length, expression.length - rhs.length)
  return { status: 'valid', expression, op, lhs: analyzeOperand(lhs), rhs: analyzeOperand(rhs), spacing }
}

export function classify (parsed, ctx = { definitions: new Map() }) {
  if (parsed.status !== 'valid') {
    return { status: parsed.status, pattern: `(${parsed.reason})`, invalid: parsed.status === 'invalid' ? parsed.reason : undefined }
  }
  const { op, lhs, rhs, spacing } = parsed
  const flags = [...lhs.flags, ...rhs.flags]
  if (lhs.resolves && rhs.resolves && lhs.resolves !== rhs.resolves) flags.push('type-mismatch')
  if (new Set([lhs.type, rhs.type]).size === 2 && [lhs.type, rhs.type].every((t) => t.endsWith('-string'))) {
    flags.push('mixed-quote-styles')
  }
  if (op !== '==' && op !== '!=' && lhs.resolves === 'string' && rhs.resolves === 'string') flags.push('string-ordering')
  if (spacing !== ` ${op} `) flags.push('whitespace-around-operator')

  const attributes = [...new Set([...lhs.attributes, ...rhs.attributes])]
  for (const name of attributes) {
    const key = name.toLowerCase()
    const values = ctx.definitions.get(key)
    if (!values && !BUILTIN_ATTRIBUTES.has(key)) flags.push('attribute-defined-externally')
    if (values && [...values].some((v) => /["']/.test(v))) flags.push('attribute-value-has-quotes')
  }

  return {
    status: 'valid',
    pattern: `${lhs.shape} ${op} ${rhs.shape}`,
    operator: op,
    operandType: [OPERAND_TYPES[lhs.type], OPERAND_TYPES[rhs.type]],
    typePair: `${OPERAND_TYPES[lhs.type]} ${op} ${OPERAND_TYPES[rhs.type]}`,
    flags,
    attribute: attributes.map((a) => a.toLowerCase()),
  }
}

export default {
  name: 'ifeval',
  description: 'Operators and operand types used in ifeval::[] expressions',
  dimensions: [
    { key: 'status', title: 'Status' },
    { key: 'pattern', title: 'Patterns' },
    { key: 'operator', title: 'Operators' },
    { key: 'typePair', title: 'Operand type combinations' },
    { key: 'flags', title: 'Notable behaviors', describe: (v) => FLAGS[v] },
    { key: 'invalid', title: 'Invalid usages', describe: (v) => INVALID[v] },
    { key: 'attribute', title: 'Referenced attributes' },
  ],
  matrices: [
    { title: 'Operator × operand type (each operand counted)', rows: 'operator', cols: 'operandType', rowOrder: OPERATORS, colOrder: Object.values(OPERAND_TYPES) },
  ],
  createContext: () => ({ definitions: new Map() }),
  observe (line, ctx) {
    const m = AttributeEntryRx.exec(line)
    if (!m || m[1].includes('!')) return
    const name = m[1].toLowerCase()
    if (!ctx.definitions.has(name)) ctx.definitions.set(name, new Set())
    ctx.definitions.get(name).add(m[2] ?? '')
  },
  extract: parseLine,
  classify,
}
