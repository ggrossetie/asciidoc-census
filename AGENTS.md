# AGENTS.md

AsciiDoc Census measures how AsciiDoc is written in real-world repositories, so that decisions on the
[AsciiDoc Language Specification](https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-lang) are backed by data.
The most common task is adding a **study** that answers one question raised by a specification discussion
(usually an SDR). Read `README.adoc` for the overall design.

## Setup and commands

The project requires Node.js 20 or later and Git. It has no dependencies, so don't add any.

```console
$ npm test                                              # node --test, runs test/*.test.js
$ node bin/adoc-census.js list                          # available studies
$ node bin/adoc-census.js fetch                         # clone sources.txt into .cache/repos (once, slow)
$ node bin/adoc-census.js run <study>                   # analyze .cache/repos
$ node bin/adoc-census.js run <study> path/to/docs      # or any files/directories
$ node bin/adoc-census.js run <study> -f adoc -o out.adoc   # formats are text, adoc, html and json
```

Before running a study on the full corpus, try it on a small directory of hand-written documents.
The `json` format is the easiest to inspect programmatically.

## Writing a study

A study is a module in `lib/studies/` that default-exports an object, registered in `lib/studies/index.js`.
`lib/studies/ifeval.js` is the reference example.

```js
export default {
  name: 'my-study',                 // used on the command line
  description: 'One sentence describing what is measured',
  dimensions: [                     // one table per dimension in the report
    { key: 'case', title: 'Cases', describe: (value) => CASES[value] },
  ],
  matrices: [],                     // optional cross tables, see ifeval.js
  createContext: () => ({}),        // optional, one context per repository
  observe (line, ctx) {},           // optional, called for every line of every document of the repository
  extract (line) {},                // either this...
  extractDocument (lines) {},       // ...or this
  classify (record, ctx) {},        // returns { [dimension key]: value or array of values }
}
```

How the engine runs a study (see `lib/census.js`):

1. Files are grouped by repository. Files with identical content (forks, vendored copies) are only read once.
2. For each repository, `createContext()` is called, then every line of every document goes through `observe`.
3. Records are extracted from each document, with one of these two functions.
   - `extract(line)` is called for each line and returns a record, or `undefined` when the line is not relevant.
   - `extractDocument(lines)` receives all the lines of a document (trailing whitespace already removed)
     and returns an array of `{ line, record }`, where `line` is the **1-based** line number the record points at.
     Use it whenever the question depends on more than one line, such as the document header, a block and its
     delimiters, or a list and its continuations.
4. Once the whole repository has been observed, `classify(record, ctx)` is called for each record.
   The context therefore contains information gathered from all the documents of the repository
   (e.g. every attribute definition), not only the ones before the record.
5. Each value returned by `classify` is aggregated per dimension, counting repositories, files and occurrences,
   and keeping a few examples from distinct repositories.

The line a record points at is shown in the report as an example, with a link to the source.
Choose the line that best illustrates the case (e.g. the attribute entry that ends up outside the header, not the document title).

## Conventions

- **Mirror Asciidoctor's behavior.** When a study decides whether something is "valid" or how it is parsed,
  follow Asciidoctor (the latest release) and cite the relevant part of its source in a comment, as `ifeval.js` does.
  When you're unsure about the behavior, check it with Asciidoctor rather than guessing.
- **Count repositories, not only occurrences.** A single project can repeat a pattern thousands of times.
  Order and interpret figures by number of repositories.
- **Report ambiguous and malformed usages** in a dedicated value instead of discarding them.
  They are often the most useful input for the specification.
- **Name values with short kebab-case keys** and explain them with `describe`, so the report is self-explanatory.
- **Remember that most files are not standalone documents.** Many are partials that are included elsewhere
  (Antora pages and partials, chapters of a book), so they have no document header. Decide explicitly how the
  study handles them and report them separately when it matters.
- **Keep studies independent.** A study may reuse functions exported by another study (like `parseLine` from
  `ifeval.js`), but shouldn't change the engine for a single question. When the engine really needs to evolve,
  change it in a separate commit with its own tests.

## Tests

Each study has a test file in `test/` that uses `node:test` and `node:assert/strict`.
Test `extract`/`extractDocument` and `classify` directly with small inline examples, covering each value of each
dimension, including edge cases and invalid input. Use `runStudy` with `test/fixtures/` for an end-to-end test.

## Reporting results

Results usually end up in an SDR merge request or a Zulip discussion. When sharing them:

- give the corpus size (repositories and files) and the commit of the census used, so results can be reproduced;
- start with the figures that answer the question, then the details;
- quote a few examples with their links, since they make the figures concrete;
- state the study's limitations (e.g. what it can't detect, or how partials were handled).

Also document the new study in the "Studies" section of `README.adoc`.
