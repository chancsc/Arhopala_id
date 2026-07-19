#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Feature-Scoring browser regression harness
//
// For each named species this builds a FULL-MATRIX underside-only answer set
// (every real underside feature answered truthfully; every upperside / FW
// space-1–3 question answered "Cannot determine"), serves the repo, drives
// checklist.html in a real Chromium via Playwright as a *thorough* user
// (applies each answer whenever it surfaces, clicking "Show more" as needed),
// and reports whether the species ends up ranked #1 with its margin.
//
// This is the authoritative user-facing check required by CLAUDE.md: a green
// `npm run regen-validate` is necessary but NOT sufficient — the browser and
// the scripted simulation can diverge, so a species-targeted fix must finish
// with a Playwright run of checklist.html.
//
// Usage:
//   node scripts/fs_regress.js "Arhopala eumolphus" "Arhopala silhetensis" ...
//   npm run fs-regress -- "Arhopala eumolphus" "Arhopala athada"
//   node scripts/fs_regress.js --file species_list.txt   # one species per line
//
// Exit code is non-zero if any species fails to rank #1 (useful in CI-style
// gating). Set FS_REGRESS_KEEP_OPEN=1 to leave the server running for manual
// inspection.
//
// Environment overrides:
//   FS_REGRESS_PORT        static-server port           (default 8137)
//   PLAYWRIGHT_MODULE      path to the playwright module (auto-detected)
//   PLAYWRIGHT_CHROMIUM    explicit chromium executable  (optional)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..');
const pu = require(path.join(REPO, 'js', 'path-utils.js'));

// ── Playwright module resolution ────────────────────────────────────────────
// Playwright is not a repo dependency (browser-only project); it lives in the
// environment's global node_modules. Try a few known locations, overridable.
function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/node22/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright',
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* keep trying */ }
  }
  throw new Error(
    'Could not load Playwright. Set PLAYWRIGHT_MODULE to its path, e.g.\n' +
    '  PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright node scripts/fs_regress.js ...'
  );
}

// ── Full-matrix answer-set builder ──────────────────────────────────────────
// Mirrors js/checklist.js's feature-matrix construction: canonical path
// features (via pickCanonicalPath with the species' real note + result-node
// `features` overrides), then every isSimCdQuestion answered "Cannot determine".
function buildBuilder() {
  const tree = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'tree.json')));
  const nodes = tree.nodes;
  const pathsMap = pu.buildTreePaths(tree);

  const resultNotes = new Map(), rfMap = new Map();
  for (const node of Object.values(nodes)) {
    if (node.type === 'result' && node.name) {
      resultNotes.set(node.name, node.note || '');
      if (node.features) rfMap.set(node.name, node.features);
    }
  }

  const cdChoice = new Map(), questionChoices = new Map();
  for (const node of Object.values(nodes)) {
    if (node.type !== 'question') continue;
    questionChoices.set(node.question, node.choices || []);
    for (const c of node.choices || [])
      if (c.label && c.label.startsWith('Cannot determine')) cdChoice.set(node.question, c.label);
  }

  return function buildAnswers(fullName) {
    let key = fullName;
    if (!pathsMap.has(key)) {
      for (const k of pathsMap.keys()) if (k.startsWith(fullName)) { key = k; break; }
    }
    const paths = pathsMap.get(key);
    if (!paths) throw new Error('No tree paths for species: ' + fullName);

    const note = resultNotes.get(key) || '';
    const rf = rfMap.get(key) || {};
    const canonical = pu.pickCanonicalPath(paths, note, rf) || [];

    const feats = new Map();
    for (const step of canonical)
      if (step.question && step.choice && !step.choice.startsWith('Cannot determine'))
        feats.set(step.question, step.choice);
    for (const [q, c] of Object.entries(rf)) {
      if (c.startsWith('Cannot determine')) feats.delete(q);
      else feats.set(q, c);
    }

    const ans = [];
    for (const [q, c] of feats) ans.push({ q, c });                 // real features, truthful
    for (const [q, choices] of questionChoices) {                   // upperside / space 1–3 → CD
      if (feats.has(q)) continue;
      if (pu.isSimCdQuestion(q, choices)) {
        const cd = cdChoice.get(q);
        if (cd) ans.push({ q, c: cd });
      }
    }
    return { key, ans };
  };
}

// ── Minimal static file server (no python dependency) ───────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
function startServer(port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(REPO, p);
    if (!file.startsWith(REPO)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// ── The robust "thorough user" driver ───────────────────────────────────────
// Applies each answer whenever it surfaces (clicking Show-more each round);
// keeps going until no more answers can be placed. Returns the top-3 ranking.
async function drivePage(page, port, ans) {
  await page.goto(`http://localhost:${port}/checklist.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const amap = new Map(ans.map(a => [a.q, a.c]));
  let progress = true;
  while (progress && amap.size) {
    progress = false;
    const more = await page.$('#cl-show-more');
    if (more) await more.click();
    const picked = await page.evaluate((arr) => {
      const m = new Map(arr);
      const btns = [...document.querySelectorAll('button.cl-cbtn')];
      const order = [];
      for (const b of btns) if (!order.includes(b.dataset.q)) order.push(b.dataset.q);
      for (const q of order) {
        if (m.has(q)) {
          const b = btns.find(x => x.dataset.q === q && x.dataset.c === m.get(q));
          if (b) { b.click(); return q; }
        }
      }
      return null;
    }, [...amap]);
    if (picked) { amap.delete(picked); progress = true; await page.waitForTimeout(15); }
  }

  const top = await page.evaluate(() =>
    [...document.querySelectorAll('.cl-cand')].slice(0, 3).map(el => ({
      name: (el.querySelector('.cl-sci')?.innerText || '').replace('Arhopala ', ''),
      score: parseInt((el.querySelector('.cl-score-num')?.innerText || '0').replace(/[^\-0-9]/g, ''), 10) || 0,
    })));
  return { top, neverSurfaced: [...amap.keys()].length };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  let args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1) {
    const listFile = args[fileIdx + 1];
    args = fs.readFileSync(listFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  }
  if (!args.length) {
    console.error('Usage: node scripts/fs_regress.js "Arhopala <species>" ...  (or --file list.txt)');
    process.exit(2);
  }

  const port = parseInt(process.env.FS_REGRESS_PORT || '8137', 10);
  const { chromium } = loadPlaywright();
  const buildAnswers = buildBuilder();

  const server = await startServer(port);
  const launchOpts = process.env.PLAYWRIGHT_CHROMIUM
    ? { headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM }
    : { headless: true };
  const browser = await chromium.launch(launchOpts);

  const results = [];
  try {
    for (const species of args) {
      let row;
      try {
        const { key, ans } = buildAnswers(species);
        const page = await browser.newPage();
        const { top, neverSurfaced } = await drivePage(page, port, ans);
        await page.close();
        const target = top.find(t => key.startsWith('Arhopala ' + t.name) || ('Arhopala ' + t.name) === key);
        const rank = target ? top.indexOf(target) + 1 : null;
        const isTop = rank === 1;
        const margin = (isTop && top[1]) ? top[0].score - top[1].score : null;
        row = { species, key, isTop, rank, top, margin, neverSurfaced };
      } catch (e) {
        row = { species, error: e.message };
      }
      results.push(row);
      // stream a line as we go
      if (row.error) {
        console.log(`✗ ${row.species.padEnd(22)} ERROR: ${row.error}`);
      } else {
        const badge = row.isTop ? '🥇 #1' : `❌ #${row.rank ?? '?'}`;
        const marg = row.margin != null ? ` (+${row.margin})` : '';
        const t = row.top.map(x => `${x.name} ${x.score >= 0 ? '+' : ''}${x.score}`).join(' | ');
        console.log(`${row.isTop ? '✓' : '✗'} ${row.species.padEnd(22)} ${badge}${marg}  [${t}]`);
      }
    }
  } finally {
    await browser.close();
    if (process.env.FS_REGRESS_KEEP_OPEN) {
      console.log(`\nServer left running on http://localhost:${port} (FS_REGRESS_KEEP_OPEN set).`);
    } else {
      server.close();
    }
  }

  const failed = results.filter(r => r.error || !r.isTop);
  console.log(`\n${results.length - failed.length}/${results.length} ranked #1.`);
  if (failed.length) {
    console.log('Not #1: ' + failed.map(r => r.species.replace('Arhopala ', '')).join(', '));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
