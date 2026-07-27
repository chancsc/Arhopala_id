#!/usr/bin/env node
'use strict';
/**
 * Generate docs/validation-reference.html — the Feature Scoring Q/A Validation Reference.
 *
 * For each species, lists every question/answer pair in its feature matrix,
 * tagged as "canonical" (from the tree path) or "override" (from result.features).
 * Q numbers use buildQuestionNumbers (DFS tree order), matching trace_scoring.js.
 *
 * Usage: node scripts/gen_validation_reference.js
 */

const fs   = require('fs');
const path = require('path');
const {
  buildTreePaths,
  buildQuestionNumbers,
  pickCanonicalPath,
} = require('../js/path-utils.js');

const TREE_PATH   = path.join(__dirname, '../data/tree.json');
const OUTPUT_PATH = path.join(__dirname, '../docs/validation-reference.html');

const treeData = JSON.parse(fs.readFileSync(TREE_PATH, 'utf8'));
const nodes    = treeData.nodes;
const pathsMap = buildTreePaths(treeData);
const qNums    = buildQuestionNumbers(treeData);

// ── Build per-species feature entries ────────────────────────────────────────
const allSpecies = [];

for (const [name, paths] of pathsMap) {
  const resultNode = Object.values(nodes).find(n => n.type === 'result' && n.name === name);
  if (!resultNode) continue;

  const note = resultNode.note || '';
  const rf   = resultNode.features || {};

  const canonical = pickCanonicalPath(paths, note, rf) || [];

  // Canonical path features (before overrides)
  const canonicalMap = new Map();
  for (const { question: q, choice: c } of canonical) {
    if (q && c && !c.startsWith('Cannot determine')) canonicalMap.set(q, c);
  }

  // Final feature matrix: canonical merged with overrides
  const finalMap = new Map(canonicalMap);
  for (const [q, c] of Object.entries(rf)) {
    if (c.startsWith('Cannot determine')) {
      finalMap.delete(q);
    } else {
      finalMap.set(q, c);
    }
  }

  // Build row list, sorted by Q number
  const rows = [];
  for (const [q, c] of finalMap) {
    const qn  = qNums.get(q) || 9999;
    const isOverride = Object.prototype.hasOwnProperty.call(rf, q) &&
                       (canonicalMap.get(q) !== rf[q]);
    rows.push({ qn, q, c, src: isOverride ? 'override' : 'canonical' });
  }
  rows.sort((a, b) => a.qn - b.qn);

  const overrideCount = rows.filter(r => r.src === 'override').length;
  allSpecies.push({ name, rows, overrideCount, note });
}

allSpecies.sort((a, b) => a.name.localeCompare(b.name));

const totalOverrides = allSpecies.reduce((s, sp) => s + sp.overrideCount, 0);
const dataJson = JSON.stringify(
  Object.fromEntries(allSpecies.map(sp => [sp.name, sp.rows]))
);

// ── HTML template ─────────────────────────────────────────────────────────────
const generated = new Date().toISOString().slice(0, 10);
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arhopala Feature Scoring — Validation Reference</title>
<style>
:root {
  --ground:        #F4F1EB;
  --surface:       #FFFFFF;
  --surface-alt:   #EDEAE2;
  --ink:           #231F1A;
  --ink-mid:       #6B6259;
  --ink-faint:     #BEB5AA;
  --accent:        #3D6B3A;
  --accent-soft:   #E8F0E6;
  --accent-text:   #2A5028;
  --override-bg:   #F9EDE8;
  --override-text: #7A2E14;
  --override-tag:  #C9623F;
  --divider:       #D8D3CB;
  --row-hover:     #EDE9E1;
  --shadow:        0 1px 3px rgba(35,31,26,.10);
  --font-heading:  Georgia, "Times New Roman", serif;
  --font-body:     system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono:     Menlo, Consolas, "Courier New", monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground:#1A1815;--surface:#26231F;--surface-alt:#2E2B27;
    --ink:#EDE8DF;--ink-mid:#A09590;--ink-faint:#534D48;
    --accent:#6FA36A;--accent-soft:#1F2E1E;--accent-text:#9DD198;
    --override-bg:#2C1A15;--override-text:#E07A5A;--override-tag:#E07A5A;
    --divider:#3A3630;--row-hover:#302D28;--shadow:0 1px 3px rgba(0,0,0,.35);
  }
}
:root[data-theme="light"] {
  --ground:#F4F1EB;--surface:#FFFFFF;--surface-alt:#EDEAE2;
  --ink:#231F1A;--ink-mid:#6B6259;--ink-faint:#BEB5AA;
  --accent:#3D6B3A;--accent-soft:#E8F0E6;--accent-text:#2A5028;
  --override-bg:#F9EDE8;--override-text:#7A2E14;--override-tag:#C9623F;
  --divider:#D8D3CB;--row-hover:#EDE9E1;--shadow:0 1px 3px rgba(35,31,26,.10);
}
:root[data-theme="dark"] {
  --ground:#1A1815;--surface:#26231F;--surface-alt:#2E2B27;
  --ink:#EDE8DF;--ink-mid:#A09590;--ink-faint:#534D48;
  --accent:#6FA36A;--accent-soft:#1F2E1E;--accent-text:#9DD198;
  --override-bg:#2C1A15;--override-text:#E07A5A;--override-tag:#E07A5A;
  --divider:#3A3630;--row-hover:#302D28;--shadow:0 1px 3px rgba(0,0,0,.35);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{height:100%;font-size:14px}
body{height:100%;background:var(--ground);color:var(--ink);font-family:var(--font-body);line-height:1.5;display:flex;flex-direction:column}
.topbar{background:var(--surface);border-bottom:1px solid var(--divider);padding:10px 20px;display:flex;align-items:baseline;gap:14px;flex-shrink:0;box-shadow:var(--shadow);z-index:10}
.topbar h1{font-family:var(--font-heading);font-size:1rem;font-weight:normal;color:var(--ink);letter-spacing:.02em;white-space:nowrap}
.topbar h1 em{color:var(--accent);font-style:italic}
.topbar-meta{font-size:.75rem;color:var(--ink-mid);white-space:nowrap}
.topbar-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.theme-btn{background:none;border:1px solid var(--divider);color:var(--ink-mid);font-size:.75rem;padding:3px 8px;cursor:pointer;font-family:var(--font-body);border-radius:2px}
.theme-btn:hover{color:var(--ink);border-color:var(--ink-faint)}
.main{display:flex;flex:1;min-height:0}
.species-panel{width:230px;flex-shrink:0;border-right:1px solid var(--divider);background:var(--surface);display:flex;flex-direction:column;overflow:hidden}
.search-wrap{padding:10px 12px 8px;border-bottom:1px solid var(--divider)}
.search-input{width:100%;padding:5px 8px;border:1px solid var(--divider);background:var(--ground);color:var(--ink);font-family:var(--font-body);font-size:.82rem;outline:none;border-radius:2px}
.search-input:focus{border-color:var(--accent)}
.search-input::placeholder{color:var(--ink-faint)}
.species-count{font-size:.7rem;color:var(--ink-mid);padding:4px 12px 2px;letter-spacing:.04em;text-transform:uppercase}
.species-list{overflow-y:auto;flex:1;padding:4px 0 8px}
.sp-item{padding:5px 14px;font-size:.82rem;cursor:pointer;color:var(--ink);border-left:2px solid transparent;display:flex;align-items:center;justify-content:space-between;gap:4px}
.sp-item:hover{background:var(--row-hover)}
.sp-item.active{background:var(--accent-soft);border-left-color:var(--accent);color:var(--accent-text);font-weight:600}
.sp-dot{width:5px;height:5px;border-radius:50%;background:var(--override-tag);flex-shrink:0;display:none}
.sp-item.has-overrides .sp-dot{display:block}
.sp-name{font-style:italic}
.detail-panel{flex:1;display:flex;flex-direction:column;overflow:hidden}
.detail-header{padding:12px 24px 10px;border-bottom:1px solid var(--divider);background:var(--surface);flex-shrink:0}
.detail-header h2{font-family:var(--font-heading);font-size:1.1rem;font-weight:normal;font-style:italic;color:var(--ink)}
.detail-meta{font-size:.74rem;color:var(--ink-mid);margin-top:3px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.note-text{font-size:.74rem;color:var(--ink-mid);margin-top:4px;line-height:1.45;font-style:italic}
.legend{display:flex;gap:12px;align-items:center;margin-left:auto}
.legend-item{display:flex;align-items:center;gap:5px;font-size:.7rem;color:var(--ink-mid);letter-spacing:.04em;text-transform:uppercase}
.legend-dot{width:8px;height:8px;border-radius:50%}
.legend-dot.canonical{background:var(--accent)}
.legend-dot.override{background:var(--override-tag)}
.table-wrap{overflow:auto;flex:1;padding:0 0 24px}
table{width:100%;border-collapse:collapse;font-size:.82rem}
thead th{position:sticky;top:0;background:var(--surface-alt);padding:7px 14px;text-align:left;font-family:var(--font-body);font-weight:600;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-mid);border-bottom:1px solid var(--divider);white-space:nowrap;z-index:2}
thead th:first-child{width:52px;text-align:center}
thead th:nth-child(2){width:36%}
thead th:last-child{width:80px;text-align:center}
tbody tr{border-bottom:1px solid var(--divider)}
tbody tr:hover{background:var(--row-hover)}
tbody tr.override{background:var(--override-bg)}
tbody tr.override:hover{filter:brightness(.97)}
td{padding:7px 14px;vertical-align:top}
.qnum{font-family:var(--font-mono);font-size:.78rem;color:var(--ink-mid);text-align:center;font-variant-numeric:tabular-nums}
.qtext{color:var(--ink-mid);line-height:1.45}
.ans{color:var(--ink);line-height:1.45}
tbody tr.override .ans{color:var(--override-text)}
.src-tag{display:inline-block;font-size:.62rem;font-family:var(--font-body);font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:2px 5px;border-radius:2px;text-align:center}
.src-tag.canonical{background:var(--accent-soft);color:var(--accent-text)}
.src-tag.override{background:var(--override-bg);color:var(--override-tag);border:1px solid var(--override-tag)}
.placeholder{padding:48px 32px;color:var(--ink-faint);font-style:italic;font-family:var(--font-heading);font-size:.9rem;text-align:center}
</style>
</head>
<body>
<div class="topbar">
  <h1><em>Arhopala</em> Feature Scoring — Validation Reference</h1>
  <span class="topbar-meta" id="topbar-stats">${allSpecies.length} species · ${totalOverrides} overrides · generated ${generated}</span>
  <div class="topbar-right">
    <button class="theme-btn" id="theme-toggle">Dark</button>
  </div>
</div>
<div class="main">
  <aside class="species-panel">
    <div class="search-wrap">
      <input class="search-input" id="search" type="search" placeholder="Filter species…" autocomplete="off">
    </div>
    <div class="species-count" id="sp-count"></div>
    <div class="species-list" id="species-list"></div>
  </aside>
  <section class="detail-panel">
    <div class="detail-header" id="detail-header">
      <div class="placeholder">Select a species from the list to review its feature scoring Q/A pairs.</div>
    </div>
    <div class="table-wrap" id="table-wrap" style="display:none">
      <table>
        <thead>
          <tr>
            <th>Q#</th>
            <th>Question</th>
            <th>Answer in Feature Scoring</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody id="feature-tbody"></tbody>
      </table>
    </div>
  </section>
</div>
<script>
const DATA = ${dataJson};
const NOTES = ${JSON.stringify(Object.fromEntries(allSpecies.map(sp => [sp.name, sp.note])))};

// ── Theme toggle ──────────────────────────────────────────────────────────────
const root = document.documentElement;
const btn  = document.getElementById('theme-toggle');
let darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
function applyTheme() {
  root.dataset.theme = darkMode ? 'dark' : 'light';
  btn.textContent = darkMode ? 'Light' : 'Dark';
}
applyTheme();
btn.addEventListener('click', () => { darkMode = !darkMode; applyTheme(); });

// ── Species list ──────────────────────────────────────────────────────────────
const spList  = document.getElementById('species-list');
const spCount = document.getElementById('sp-count');
const search  = document.getElementById('search');
const tbody   = document.getElementById('feature-tbody');
const header  = document.getElementById('detail-header');
const tableW  = document.getElementById('table-wrap');

const species = Object.keys(DATA).sort();
let activeSpecies = null;

function renderSpeciesList(filter) {
  const f = (filter || '').toLowerCase();
  const visible = species.filter(s => s.toLowerCase().includes(f));
  spCount.textContent = visible.length + ' of ' + species.length;
  spList.innerHTML = '';
  for (const name of visible) {
    const hasOverrides = DATA[name].some(r => r.src === 'override');
    const li = document.createElement('div');
    li.className = 'sp-item' + (hasOverrides ? ' has-overrides' : '') + (name === activeSpecies ? ' active' : '');
    li.dataset.name = name;
    li.innerHTML = '<span class="sp-name">' + name + '</span><span class="sp-dot"></span>';
    li.addEventListener('click', () => selectSpecies(name));
    spList.appendChild(li);
  }
}

function selectSpecies(name) {
  activeSpecies = name;
  renderSpeciesList(search.value);
  const rows = DATA[name] || [];
  const note = NOTES[name] || '';
  const overrides = rows.filter(r => r.src === 'override').length;
  header.innerHTML =
    '<h2>' + name + '</h2>' +
    '<div class="detail-meta">' +
      '<span>' + rows.length + ' features</span>' +
      '<span>' + overrides + ' override' + (overrides !== 1 ? 's' : '') + '</span>' +
      '<div class="legend">' +
        '<span class="legend-item"><span class="legend-dot canonical"></span>Canonical</span>' +
        '<span class="legend-item"><span class="legend-dot override"></span>Override</span>' +
      '</div>' +
    '</div>' +
    (note ? '<div class="note-text">' + escHtml(note) + '</div>' : '');
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.className = r.src === 'override' ? 'override' : '';
    tr.innerHTML =
      '<td class="qnum">Q' + r.qn + '</td>' +
      '<td class="qtext">' + escHtml(r.q) + '</td>' +
      '<td class="ans">'  + escHtml(r.c) + '</td>' +
      '<td><span class="src-tag ' + r.src + '">' + r.src + '</span></td>';
    tbody.appendChild(tr);
  }
  tableW.style.display = '';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

search.addEventListener('input', () => renderSpeciesList(search.value));
renderSpeciesList('');
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, html);
console.log('Written:', OUTPUT_PATH);
console.log('Species:', allSpecies.length, '| Overrides:', totalOverrides);
