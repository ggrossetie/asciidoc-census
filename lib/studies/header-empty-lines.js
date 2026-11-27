// Measures the documents whose document header changes under SDR-12 (Allow Empty Lines in the Document Header):
// empty lines between header lines are ignored, above and below the document title, and the header ends at the
// first line that is neither empty nor a header line.
//
// The current behavior mirrors Asciidoctor 2.0.26 (lib/asciidoctor/parser.rb):
// - Parser.parse_document_header calls parse_block_metadata_lines above the title, which skips empty lines,
//   comments, attribute entries, block anchors, block attribute lists, and block titles in any order.
//   Attribute entries read there are header entries, whether a document title follows or not.
// - Parser.parse_header_metadata, below the title, calls process_attribute_entries, which reads attribute entries
//   and comments but stops at the first empty line. Then any non-empty line is the author line, and the next one
//   is the revision line if it matches RevisionInfoLineRx, each optionally preceded by attribute entries.

// Ruby's \p{Word}, \p{Alpha}, and \p{Alnum}
const W = '\\p{L}\\p{M}\\p{N}\\p{Pc}'
const ALPHA = '\\p{L}\\p{M}'
const ALNUM = '\\p{L}\\p{M}\\p{N}'

// lib/asciidoctor/rx.rb
const AttributeEntryRx = new RegExp(`^:(!?[${W}][^:]*):(?:[ \\t]+(.*))?$`, 'u')
const BlockAnchorRx = new RegExp(`^\\[\\[(?:|([${ALPHA}_:][${W}\\-:.]*)(?:, *(.+))?)\\]\\]$`, 'u')
const BlockAttributeListRx = new RegExp(`^\\[(|[${W}.#%{,"'].*)\\]$`, 'u')
const BlockTitleRx = /^\.(\.?[^ \t.].*)$/u
// Compliance.markdown_syntax is enabled by default, so a level-0 title also starts with #
const ExtAtxSectionTitleRx = /^(=={0,5}|##{0,5})[ \t]+(.+?)(?:[ \t]+\1)?$/u
const SetextSectionTitleRx = new RegExp(`^((?!\\.).*?[${ALNUM}].*)$`, 'u')
const RevisionInfoLineRx = /^(?:[^\d{]*(.*?),)? *(?!:)(.*?)(?: *(?!^),?: *(.*))?$/u
const AuthorInfoLineRx = new RegExp(`^([${W}][${W}\\-'.]*)(?: +([${W}][${W}\\-'.]*))?(?: +([${W}][${W}\\-'.]*))?(?: +<([^>]+)>)?$`, 'u')
const AuthorDelimiterRx = /;(?: |$)/
const ConditionalDirectiveRx = /^(ifdef|ifndef|ifeval|endif)::(\S*?(?:([,+])\S*?)?)\[(.+)?\]$/u
const IncludeDirectiveRx = /^include::([^\s[](?:[^[]*[^\s[])?)\[(.+)?\]$/u

// Attributes marked "Header Only" in the Document Attributes Reference of the AsciiDoc language documentation
// (docs/modules/attributes/pages/document-attributes-ref.adoc), plus the modifiable intrinsic attributes that
// aren't API/CLI only. Setting or unsetting one of them in the body has no effect.
export const HEADER_ONLY = new Set(`
  backend docdate docdatetime doctime docyear localdate localdatetime localtime localyear outfilesuffix
  compat-mode experimental reproducible skip-front-matter lang last-update-label manname-title nolang toc-title
  untitled-label version-label app-name author authorinitials authors copyright doctitle description email
  firstname keywords lastname middlename orgname revdate revremark revnumber title title-separator toc toclevels
  fragment asset-uri-scheme cache-uri data-uri docinfo docinfodir docinfosubs doctype eqnums media nofooter
  nofootnotes noheader notitle pagewidth showtitle stem webfonts iconfont-cdn iconfont-name iconfont-remote icons
  coderay-css coderay-unavailable highlightjsdir highlightjs-theme prettifydir prettify-theme pygments-css
  pygments-style pygments-unavailable rouge-css rouge-style rouge-unavailable source-highlighter copycss
  css-signature linkcss max-width stylesdir stylesheet toc-class mantitle manvolnum manname manpurpose
  man-linkstyle mansource manmanual allow-uri-read max-attribute-value-size max-include-depth
`.trim().split(/\s+/))

// Antora only reads page attributes (page-*) from the document header.
export const isHeaderOnly = (name) => HEADER_ONLY.has(name) || name.startsWith('page-')

const CHANGES = {
  'entries-after-empty-line-below-title': 'attribute entries after an empty line below the title, before any other content: body entries today, header entries under SDR-12',
  'include-after-empty-line-below-title': 'an include directive after an empty line below the title, before any other content: header entries under SDR-12 if the included file only contains attribute entries and comments',
  'comments-after-empty-line-below-title': 'only comments after an empty line below the title, before any other content: they move to the header, without any effect',
  'entry-before-author-line': 'attribute entries or comments between the title and the line Asciidoctor reads as the author line: a paragraph under SDR-12',
  'include-before-author-line': 'an include directive between the title and the line Asciidoctor reads as the author line: a paragraph under SDR-12',
  'entry-before-revision-line': 'attribute entries or comments between the author line and the line Asciidoctor reads as the revision line: a paragraph under SDR-12',
  'entries-after-block-metadata-untitled': 'in a document without a title, attribute entries after the first block metadata line: header entries today, body entries under SDR-12',
}

const EFFECTS = {
  'header-only': 'sets or unsets an attribute that only takes effect in the header (or an Antora page-* attribute)',
  'anywhere-only': 'only sets attributes that take effect anywhere: same output, except where the header attributes are read (metadata, APIs)',
}

const AUTHOR_LINES = {
  'author-like': 'the line matches the author line syntax (names, optional email)',
  'not-author-like': "the line doesn't look like an author line (e.g. a paragraph or a block): Asciidoctor still reads it as one",
}

const DOCUMENTS = {
  titled: 'documents with a document title',
  'untitled-with-header': 'documents without a title that start with attribute entries (header entries for Asciidoctor; often partials)',
  untitled: 'documents without a title or leading attribute entries (mostly partials)',
  'empty-lines-above-title': 'documents with a title and an empty line between header lines above it (ignored by Asciidoctor)',
  'title-metadata-separated': 'documents with block metadata for the title separated from it by empty lines or attribute entries',
  'block-title-above-title': 'documents with a block title above the document title (Asciidoctor drops the document title)',
}

const isUniform = (line, ch) => line.length > 0 && [...line].every((c) => c === ch)
const length = (line) => [...line].length
const isCommentLine = (line) => line.startsWith('//') && !line.startsWith('///')
const isCommentBlockDelimiter = (line) => line.length > 3 && isUniform(line, '/')
const attributeName = (match) => match[1].replace(/^!|!$/g, '').toLowerCase()

/**
 * Returns the level-0 title at index i (atx or setext) and the number of lines it spans, or undefined.
 * Mirrors Parser.is_next_line_doctitle? without leveloffset.
 */
export function doctitleAt (lines, i) {
  const line = lines[i]?.text
  if (line === undefined) return undefined
  const atx = ExtAtxSectionTitleRx.exec(line)
  if (atx) return atx[1].length === 1 ? 1 : undefined
  const underline = lines[i + 1]?.text
  if (underline && isUniform(underline, '=') && SetextSectionTitleRx.test(line) && Math.abs(length(line) - length(underline)) < 2) {
    return 2
  }
  return undefined
}

const isAuthorLike = (line) => line.split(AuthorDelimiterRx).every((entry) => AuthorInfoLineRx.test(entry.trim()))

/**
 * Reads the attribute entry at index i, with its continuation lines.
 * Returns the index of the last line of the entry. Mirrors Parser.process_attribute_entry.
 */
function skipEntry (lines, i, match) {
  const value = match[2] ?? ''
  const con = value.endsWith(' +') ? ' +' : value.endsWith(' \\') ? ' \\' : undefined
  if (!con) return i
  while (i + 1 < lines.length && lines[i + 1].text !== '') {
    i++
    if (!lines[i].text.endsWith(con)) break
  }
  return i
}

// Returns the index of the closing delimiter of the comment block opened at index i (or the last line).
function skipCommentBlock (lines, i) {
  const delimiter = lines[i].text
  for (let j = i + 1; j < lines.length; j++) if (lines[j].text === delimiter) return j
  return lines.length - 1
}

/**
 * Reads attribute entries, comment lines, and comment blocks from index i, without skipping empty lines.
 * Mirrors Parser.process_attribute_entries. Include directives are assumed to only contain attribute entries.
 */
function processAttributeEntries (lines, i) {
  const found = { entries: [], comments: 0, includes: 0 }
  while (i < lines.length) {
    const text = lines[i].text
    const match = AttributeEntryRx.exec(text)
    if (isCommentLine(text)) found.comments++
    else if (isCommentBlockDelimiter(text)) {
      i = skipCommentBlock(lines, i)
      found.comments++
    } else if (match) {
      found.entries.push({ name: attributeName(match), line: lines[i].line })
      i = skipEntry(lines, i, match)
    } else if (IncludeDirectiveRx.test(text)) found.includes++
    else break
    i++
  }
  return { ...found, next: i }
}

const skipBlankLines = (lines, i) => {
  while (i < lines.length && lines[i].text === '') i++
  return i
}

/**
 * Analyzes the header of a document. Returns what changes under SDR-12, as records pointing at a line.
 */
export function analyze (rawLines) {
  // preprocessor conditionals are transparent (all branches are assumed to be enabled)
  const lines = rawLines.map((text, idx) => ({ text, line: idx + 1 })).filter((l) => !ConditionalDirectiveRx.test(l.text))
  const document = []
  const changes = []
  let i = skipBlankLines(lines, 0)
  if (i === lines.length) return { document: ['untitled'], changes }

  // above the title: Parser.parse_block_metadata_lines
  // metadata holds the indexes of block metadata lines
  const above = { entries: [], metadata: [], blockTitle: false, emptyBetween: false }
  let emptyBefore = false
  while (i < lines.length) {
    const text = lines[i].text
    const match = AttributeEntryRx.exec(text)
    if (text.startsWith('[[')) {
      if (!BlockAnchorRx.test(text)) break
      above.metadata.push(i)
    } else if (text.startsWith('[') && text.endsWith(']') && BlockAttributeListRx.test(text)) {
      above.metadata.push(i)
    } else if (text.startsWith('.') && BlockTitleRx.test(text)) {
      above.metadata.push(i)
      above.blockTitle = true
    } else if (isCommentLine(text)) {
      // comment line
    } else if (isCommentBlockDelimiter(text)) {
      i = skipCommentBlock(lines, i)
    } else if (match) {
      above.entries.push({ name: attributeName(match), line: lines[i].line, afterMetadata: above.metadata.length > 0 })
      i = skipEntry(lines, i, match)
    } else if (IncludeDirectiveRx.test(text)) {
      // assumed to only contain attribute entries
    } else {
      break
    }
    if (emptyBefore) above.emptyBetween = true
    const next = skipBlankLines(lines, i + 1)
    emptyBefore = next > i + 1
    i = next
  }

  const titleLines = doctitleAt(lines, i)
  if (titleLines && above.blockTitle) return { document: ['block-title-above-title'], changes }

  if (!titleLines) {
    document.push(above.entries.length ? 'untitled-with-header' : 'untitled')
    const moved = above.entries.filter((e) => e.afterMetadata)
    if (moved.length) changes.push({ change: 'entries-after-block-metadata-untitled', line: moved[0].line, attributes: moved.map((e) => e.name) })
    return { document, changes }
  }

  document.push('titled')
  if (above.emptyBetween || (emptyBefore && (above.entries.length || above.metadata.length))) document.push('empty-lines-above-title')
  // title metadata is separated when anything other than block metadata sits between the first one and the title
  if (above.metadata.length && i - above.metadata[0] > above.metadata.length) document.push('title-metadata-separated')

  // below the title: Parser.parse_header_metadata
  i += titleLines
  const beforeAuthor = processAttributeEntries(lines, i)
  i = beforeAuthor.next
  if (i < lines.length && lines[i].text !== '') {
    const author = lines[i]
    if (beforeAuthor.entries.length || beforeAuthor.comments || beforeAuthor.includes) {
      changes.push({
        change: beforeAuthor.entries.length || beforeAuthor.comments ? 'entry-before-author-line' : 'include-before-author-line',
        line: author.line,
        authorLine: isAuthorLike(author.text) ? 'author-like' : 'not-author-like',
      })
    }
    const beforeRevision = processAttributeEntries(lines, i + 1)
    i = beforeRevision.next
    if (i < lines.length && lines[i].text !== '' && RevisionInfoLineRx.test(lines[i].text)) {
      if (beforeRevision.entries.length || beforeRevision.comments) {
        changes.push({ change: 'entry-before-revision-line', line: lines[i].line })
      }
      i = processAttributeEntries(lines, i + 1).next
    }
  }

  // after the header: what SDR-12 adds to it
  const start = skipBlankLines(lines, i)
  if (start > i) {
    const moved = { entries: [], comments: 0, includes: 0, firstInclude: undefined, firstComment: undefined }
    for (let j = start; j < lines.length; j++) {
      const text = lines[j].text
      const match = AttributeEntryRx.exec(text)
      if (text === '') continue
      if (isCommentLine(text)) {
        moved.comments++
        moved.firstComment ??= lines[j].line
      } else if (isCommentBlockDelimiter(text)) {
        moved.firstComment ??= lines[j].line
        j = skipCommentBlock(lines, j)
        moved.comments++
      } else if (match) {
        moved.entries.push({ name: attributeName(match), line: lines[j].line })
        j = skipEntry(lines, j, match)
      } else if (IncludeDirectiveRx.test(text)) {
        moved.includes++
        moved.firstInclude ??= lines[j].line
      } else {
        break
      }
    }
    if (moved.entries.length) {
      changes.push({ change: 'entries-after-empty-line-below-title', line: moved.entries[0].line, attributes: moved.entries.map((e) => e.name) })
    } else if (moved.includes) {
      changes.push({ change: 'include-after-empty-line-below-title', line: moved.firstInclude })
    } else if (moved.comments) {
      changes.push({ change: 'comments-after-empty-line-below-title', line: moved.firstComment })
    }
  }
  return { document, changes }
}

export function extractDocument (lines) {
  if (!lines.length) return []
  const { document, changes } = analyze(lines)
  return [
    { line: 1, record: { kind: 'document', document } },
    ...changes.map(({ line, ...change }) => ({ line, record: { kind: 'change', ...change } })),
  ]
}

export function classify (record) {
  if (record.kind === 'document') return { document: record.document }
  const attributes = record.attributes ?? []
  const headerOnly = attributes.filter(isHeaderOnly)
  return {
    change: record.change,
    effect: record.attributes ? (headerOnly.length ? 'header-only' : 'anywhere-only') : undefined,
    'header-only': headerOnly,
    attribute: attributes,
    'author-line': record.authorLine,
  }
}

export default {
  name: 'header-empty-lines',
  description: 'Documents whose header changes when empty lines are allowed in the document header (SDR-12)',
  dimensions: [
    { key: 'change', title: 'Changes under SDR-12', describe: (v) => CHANGES[v] },
    { key: 'effect', title: 'Effect of the moved attribute entries', describe: (v) => EFFECTS[v] },
    { key: 'header-only', title: 'Header-only attributes among the moved entries' },
    { key: 'attribute', title: 'Attributes of the moved entries' },
    { key: 'author-line', title: 'Lines read as the author line after attribute entries or comments', describe: (v) => AUTHOR_LINES[v] },
    { key: 'document', title: 'Documents', describe: (v) => DOCUMENTS[v] },
  ],
  matrices: [
    {
      title: 'Changes × effect',
      rows: 'change',
      cols: 'effect',
      rowOrder: ['entries-after-empty-line-below-title', 'entries-after-block-metadata-untitled'],
      colOrder: ['header-only', 'anywhere-only'],
    },
  ],
  extractDocument,
  classify,
}
