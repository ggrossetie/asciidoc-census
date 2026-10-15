const pad = (s, n, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n))

function cellCount (matrix, row, col) {
  const cell = matrix.cells.find((c) => c.row === row && c.col === col)
  return cell ? cell.occurrences : 0
}

function summary (result) {
  const t = result.totals
  return `${t.occurrences} occurrence(s) in ${t.reposWithOccurrences} of ${t.repos} repositories ` +
    `(${t.files} files scanned, ${t.duplicateFiles} duplicate files skipped)`
}

export function toText (result, { limit = 20 } = {}) {
  const out = [`${result.study}: ${result.description}`, summary(result), '']
  if (result.sources?.length) {
    out.push('== Corpus sources', '')
    const width = Math.max(10, ...result.sources.map((s) => s.repo.length))
    out.push(`  ${pad('', width)}  ${pad('commit', 10)}  ${pad('scanned', 7, true)} ${pad('w/ occ.', 7, true)} ${pad('occ.', 6, true)}`)
    for (const s of result.sources) {
      out.push(`  ${pad(s.repo, width)}  ${pad(s.commit?.slice(0, 10) ?? '', 10)}  ` +
        `${pad(s.files, 7, true)} ${pad(s.filesWithOccurrences, 7, true)} ${pad(s.occurrences, 6, true)}`)
    }
    out.push('')
  }
  for (const dim of result.dimensions) {
    if (!dim.rows.length) continue
    out.push(`== ${dim.title}`, '')
    const rows = dim.rows.slice(0, limit)
    const width = Math.min(60, Math.max(5, ...rows.map((r) => String(r.value).length)))
    out.push(`  ${pad('', width)}  ${pad('repos', 6, true)} ${pad('files', 6, true)} ${pad('occ.', 6, true)}`)
    for (const r of rows) {
      out.push(`  ${pad(r.value, width)}  ${pad(r.repos, 6, true)} ${pad(r.files, 6, true)} ${pad(r.occurrences, 6, true)}`)
      if (r.description) out.push(`      ${r.description}`)
      for (const e of r.examples) out.push(`      ${e.text}`, `        ↳ ${e.location}`)
    }
    if (dim.rows.length > limit) out.push(`  … ${dim.rows.length - limit} more`)
    out.push('')
  }
  for (const m of result.matrices) {
    if (!m.cells.length) continue
    out.push(`== ${m.title}`, '')
    const w = Math.max(...m.rows.map((r) => r.length), 2)
    const cw = m.cols.map((c) => Math.max(c.length, 5))
    out.push(`  ${pad('', w)}  ${m.cols.map((c, i) => pad(c, cw[i], true)).join('  ')}`)
    for (const row of m.rows) {
      out.push(`  ${pad(row, w)}  ${m.cols.map((c, i) => pad(cellCount(m, row, c), cw[i], true)).join('  ')}`)
    }
    out.push('')
  }
  return out.join('\n')
}

// AsciiDoc output: values are wrapped in passthrough monospace so that they are never interpreted
const lit = (s) => `+${String(s).replace(/\+/g, '{plus}')}+`
const cellText = (s) => String(s).replace(/\|/g, '{vbar}')

export function toAsciiDoc (result, { limit = 50 } = {}) {
  const out = [`= Census: ${result.study}`, '', result.description + '.', '', summary(result) + '.', '']
  if (result.sources?.length) {
    out.push(`.Corpus sources (${result.sources.length} repositories)`, '[%collapsible]', '====', '[cols="4,2,1,1,1"]', '|===', '|Repository |Commit |Files scanned |Files with occ. |Occ.', '')
    for (const s of result.sources) {
      out.push(`|${s.url ? `${s.url}[${cellText(s.repo)}]` : cellText(lit(s.repo))}`, `|${s.commit ? `\`${s.commit.slice(0, 10)}\`` : ''}`, `|${s.files}`, `|${s.filesWithOccurrences}`, `|${s.occurrences}`, '')
    }
    out.push('|===', '====', '')
  }
  for (const dim of result.dimensions) {
    if (!dim.rows.length) continue
    out.push(`== ${dim.title}`, '', '[cols="3,1,1,1,6"]', '|===', '|Value |Repos |Files |Occ. |Examples', '')
    for (const r of dim.rows.slice(0, limit)) {
      const examples = r.examples.map((e) => {
        const ref = e.location.startsWith('https://') ? `${e.location}[${cellText(e.path)}:${e.line}]` : cellText(e.location)
        return `* \`${cellText(lit(e.text))}\` (${ref})`
      })
      const desc = r.description ? ` +\n${cellText(r.description)}` : ''
      out.push(`|\`${cellText(lit(r.value))}\`${desc}`, `|${r.repos}`, `|${r.files}`, `|${r.occurrences}`, `a|${examples.join('\n')}`, '')
    }
    out.push('|===', '')
    if (dim.rows.length > limit) out.push(`_${dim.rows.length - limit} more value(s) not shown._`, '')
  }
  for (const m of result.matrices) {
    if (!m.cells.length) continue
    out.push(`== ${m.title}`, '', `[cols="2,${m.cols.map(() => '1').join(',')}"]`, '|===')
    out.push(`| ${m.cols.map((c) => `|${cellText(c)}`).join(' ')}`, '')
    for (const row of m.rows) out.push(`|\`${lit(row)}\` ${m.cols.map((c) => `|${cellCount(m, row, c)}`).join(' ')}`)
    out.push('|===', '')
  }
  return out.join('\n')
}

// HTML output: a self-contained summary page (no external resources)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const fmt = (n) => n.toLocaleString('en-US')
const percent = (n, total) => (total ? `${Math.round((n / total) * 100)}%` : '–')

const HTML_STYLE = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;
--border:rgba(11,11,11,.10);--bar:#2a78d6;--track:#f0efec;--seq-lo:#e6f0fc;--seq-hi:#0d366b;--on-hi:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;
--ink-2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--border:rgba(255,255,255,.10);--bar:#3987e5;--track:#262624;--seq-lo:#1d2a3a;--seq-hi:#86b6ef;--on-hi:#0b0b0b}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink-2:#c3c2b7;--muted:#898781;
--grid:#2c2c2a;--border:rgba(255,255,255,.10);--bar:#3987e5;--track:#262624;--seq-lo:#1d2a3a;--seq-hi:#86b6ef;--on-hi:#0b0b0b}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:0 0 4px}
.lede{color:var(--ink-2);margin:0 0 24px}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
a{color:inherit}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.tile,.card{background:var(--surface);border:1px solid var(--border);border-radius:12px}
.tile{padding:16px}
.tile .v{font-size:30px;font-weight:600;line-height:1.1}
.tile .l{color:var(--ink-2);font-size:13px;margin-top:4px}
.toolbar{display:flex;gap:8px;align-items:center;margin:0 0 16px;flex-wrap:wrap;color:var(--ink-2);font-size:13px}
.toolbar button{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:4px 12px;cursor:pointer}
.toolbar button[aria-pressed="true"]{background:var(--ink);color:var(--surface)}
.grid{display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:16px}
.card{padding:20px;min-width:0}
.card.wide{grid-column:1/-1}
.card .sub{color:var(--muted);font-size:13px;margin:0 0 12px}
.row{border-top:1px solid var(--grid)}
.row:first-of-type{border-top:0}
.row summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:8px 0;align-items:center}
.row summary::-webkit-details-marker{display:none}
.row summary:hover .label{text-decoration:underline}
.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.num{font-variant-numeric:tabular-nums;color:var(--ink-2);font-size:13px;text-align:right;white-space:nowrap}
.num b{color:var(--ink);font-weight:600}
.track{display:block;grid-column:1/-1;height:8px;background:var(--track);border-radius:4px;overflow:hidden}
.fill{display:block;width:0;height:100%;background:var(--bar);border-radius:0 4px 4px 0;transition:width .25s}
.detail{padding:4px 0 12px;font-size:13px;color:var(--ink-2)}
.detail ul{margin:6px 0 0;padding-left:18px}
.detail li{margin:4px 0;word-break:break-all}
.more{color:var(--muted);font-size:13px;margin-top:8px}
.heat{width:100%;border-collapse:separate;border-spacing:2px;font-variant-numeric:tabular-nums;font-size:13px}
.heat th{font-weight:500;color:var(--ink-2);padding:4px 6px;text-align:center}
.heat th[scope=row]{text-align:left}
.heat td{text-align:center;padding:10px 6px;border-radius:4px;min-width:56px}
.heat td.zero{color:var(--muted);background:var(--track)}
.scroll{overflow-x:auto}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--surface);font-size:12px;padding:6px 8px;border-radius:6px;opacity:0;transition:opacity .1s;max-width:280px;z-index:10}
.eyebrow{color:var(--muted);font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin:0 0 4px}
.sources{margin:0 0 24px;padding:0}
.sources>summary{cursor:pointer;padding:14px 20px;font-weight:600}
.sources>summary span{color:var(--muted);font-weight:400;font-size:13px;margin-left:6px}
.sources .scroll{padding:0 20px 16px}
.src{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.src th{color:var(--ink-2);font-weight:500;text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid)}
.src td{padding:6px 8px;border-bottom:1px solid var(--grid)}
.src th.n,.src td.n{text-align:right}
.src tr.none td{color:var(--muted)}
footer{color:var(--muted);font-size:12px;margin-top:32px}
`

const HTML_SCRIPT = `
const metrics = { repos: 'repos', files: 'files', occurrences: 'occ.' }
function show (metric) {
  document.querySelectorAll('.toolbar button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.metric === metric))
  document.querySelectorAll('.card[data-dim]').forEach((card) => {
    const rows = [...card.querySelectorAll('.row')]
    const max = Math.max(1, ...rows.map((r) => Number(r.dataset[metric])))
    rows.forEach((r) => { r.querySelector('.fill').style.width = (Number(r.dataset[metric]) / max * 100) + '%' })
  })
  try { localStorage.setItem('census-metric', metric) } catch {}
}
document.querySelectorAll('.toolbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.metric)))
let saved
try { saved = localStorage.getItem('census-metric') } catch {}
show(saved in metrics ? saved : 'repos')
const tip = document.getElementById('tip')
document.addEventListener('pointerover', (e) => {
  const t = e.target.closest('[data-tip]')
  if (!t) { tip.style.opacity = 0; return }
  tip.textContent = t.dataset.tip
  tip.style.opacity = 1
})
document.addEventListener('pointermove', (e) => {
  tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'
  tip.style.top = (e.clientY + 14) + 'px'
})
`

function htmlDimension (dim, limit) {
  const rows = dim.rows.slice(0, limit).map((r) => {
    const examples = r.examples.map((e) => {
      const where = e.location.startsWith('https://')
        ? `<a href="${esc(e.location)}">${esc(e.repo)} › ${esc(e.path)}:${e.line}</a>`
        : esc(e.location)
      return `<li><code>${esc(e.text)}</code><br>${where}</li>`
    })
    return `<details class="row" data-repos="${r.repos}" data-files="${r.files}" data-occurrences="${r.occurrences}">
<summary><span class="label" title="${esc(r.value)}"><code>${esc(r.value)}</code></span>
<span class="num"><b>${fmt(r.repos)}</b> repos · ${fmt(r.files)} files · ${fmt(r.occurrences)} occ.</span>
<span class="track"><span class="fill"></span></span></summary>
<div class="detail">${r.description ? esc(r.description) : ''}${examples.length ? `<ul>${examples.join('')}</ul>` : ''}</div></details>`
  })
  const more = dim.rows.length > limit ? `<p class="more">… ${dim.rows.length - limit} more value(s) not shown</p>` : ''
  return `<section class="card" data-dim="${esc(dim.key)}"><h2>${esc(dim.title)}</h2>
<p class="sub">${dim.rows.length} distinct value(s) — click a row for examples</p>${rows.join('\n')}${more}</section>`
}

function htmlMatrix (m) {
  const max = Math.max(1, ...m.cells.map((c) => c.occurrences))
  const head = `<tr><th></th>${m.cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr>`
  const body = m.rows.map((row) => {
    const cells = m.cols.map((col) => {
      const cell = m.cells.find((c) => c.row === row && c.col === col)
      if (!cell) return '<td class="zero">0</td>'
      // log scale: counts typically span several orders of magnitude
      const t = Math.log1p(cell.occurrences) / Math.log1p(max)
      const tip = `${row} × ${col}: ${fmt(cell.occurrences)} occurrence(s) in ${fmt(cell.repos)} repo(s)`
      return `<td style="background:color-mix(in oklab,var(--seq-hi) ${Math.round(15 + t * 85)}%,var(--seq-lo));color:${t > 0.45 ? 'var(--on-hi)' : 'var(--ink)'}" data-tip="${esc(tip)}">${fmt(cell.occurrences)}</td>`
    })
    return `<tr><th scope="row"><code>${esc(row)}</code></th>${cells.join('')}</tr>`
  })
  return `<section class="card wide"><h2>${esc(m.title)}</h2><p class="sub">Occurrences; color on a log scale. Hover a cell for repository counts.</p>
<div class="scroll"><table class="heat">${head}${body.join('')}</table></div></section>`
}

function htmlSources (result) {
  const sources = result.sources ?? []
  if (!sources.length) return ''
  const rows = sources.map((s) => {
    const name = s.url ? `<a href="${esc(s.url)}">${esc(s.repo)}</a>` : esc(s.repo)
    const commit = s.commit ? `<code>${esc(s.commit.slice(0, 10))}</code>` : '–'
    return `<tr${s.occurrences ? '' : ' class="none"'}><td>${name}</td><td>${commit}</td><td class="n">${fmt(s.files)}</td><td class="n">${fmt(s.filesWithOccurrences)}</td><td class="n">${fmt(s.occurrences)}</td></tr>`
  })
  return `<details class="card sources"><summary>Corpus sources<span>${sources.length} repositories, ${fmt(result.totals.files)} unique files</span></summary>
<div class="scroll"><table class="src"><tr><th>Repository</th><th>Commit</th><th class="n">Files scanned</th><th class="n">Files with occ.</th><th class="n">Occurrences</th></tr>
${rows.join('\n')}</table></div></details>`
}

export function toHtml (result, { limit = 15 } = {}) {
  const t = result.totals
  const tiles = [
    [fmt(t.occurrences), 'occurrences'],
    [`${fmt(t.reposWithOccurrences)} / ${fmt(t.repos)}`, `repositories using it (${percent(t.reposWithOccurrences, t.repos)})`],
    [fmt(t.files), 'files scanned'],
    [fmt(t.duplicateFiles), 'duplicate files skipped'],
  ].map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`)
  const dims = result.dimensions.filter((d) => d.rows.length).map((d) => htmlDimension(d, limit))
  const matrices = result.matrices.filter((m) => m.cells.length).map(htmlMatrix)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>asciidoc-census: ${esc(result.study)}</title><style>${HTML_STYLE}</style></head>
<body><main>
<p class="eyebrow">asciidoc-census</p>
<h1>Study: <code>${esc(result.study)}</code></h1>
<p class="lede">${esc(result.description)}.</p>
<div class="tiles">${tiles.join('')}</div>
${htmlSources(result)}
<div class="toolbar">Bar length:
<button data-metric="repos">repositories</button><button data-metric="files">files</button><button data-metric="occurrences">occurrences</button></div>
<div class="grid">${matrices.join('\n')}${dims.join('\n')}</div>
<footer>Generated by asciidoc-census. Counts are deduplicated by repository; examples come from distinct repositories.</footer>
</main><div id="tip" role="tooltip"></div><script>${HTML_SCRIPT}</script></body></html>`
}

export const formats = {
  text: toText,
  adoc: toAsciiDoc,
  html: toHtml,
  json: (result) => JSON.stringify(result, null, 2),
}
