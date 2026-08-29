#!/usr/bin/env node
'use strict';
/**
 * walk_sim_cd_paths.js — Browser-native underside-only path recorder.
 *
 * For every species, drives checklist.html step-by-step in a real Chromium
 * browser, answering underside-only questions (upperside / FW space-1–3 → CD,
 * everything else → canonical answer or orphan default), records the actual
 * question sequence as encountered, and compares it against the stored path
 * in data/sim_cd_paths.json (or the tree-walk null for non-divergent species).
 *
 * Unlike verify_sim_cd_paths.js (which plays back a STORED path and confirms
 * the browser agrees), this script GENERATES the path from the browser's actual
 * question order — it covers ALL species, not just the ~42 stored subset.  If
 * the generated path differs from the stored one, or if a species becomes newly
 * divergent (was non-stored but browser path ≠ tree-walk), it is flagged.
 *
 * Additionally catches feature / tree-choice label mismatches: if the intended
 * answer button is not found in the browser DOM, it is reported as a LABEL
 * MISMATCH so the feature can be corrected before it silently breaks scoring.
 *
 * Usage:
 *   node scripts/walk_sim_cd_paths.js --all
 *   node scripts/walk_sim_cd_paths.js --batch-size 20 --batch-index 0
 *   node scripts/walk_sim_cd_paths.js "Arhopala selta" "Arhopala opalina azata"
 *   node scripts/walk_sim_cd_paths.js --file species_list.txt
 *
 * Env:
 *   PLAYWRIGHT_MODULE   path to the playwright module (auto-detected)
 *   FS_VERIFY_PORT      static-server port (default 8137)
 */

const fs   = require('fs');
const http = require('http');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const pu   = require(path.join(REPO, 'js', 'path-utils.js'));

const TREE_PATH   = path.join(REPO, 'data', 'tree.json');
const STORED_PATH = path.join(REPO, 'data', 'sim_cd_paths.json');

// ── Playwright ────────────────────────────────────────────────────────────────

function loadPlaywright() {
  for (const c of [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/node22/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright',
  ].filter(Boolean)) {
    try { return require(c); } catch (_) {}
  }
  throw new Error('Playwright not found — set PLAYWRIGHT_MODULE');
}

// ── Static server ─────────────────────────────────────────────────────────────

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

// ── Feature matrix ────────────────────────────────────────────────────────────

function buildFeatureMatrix(treeData, pathsMap) {
  const nodes = treeData.nodes;
  const resultNotes = new Map(), resultFeatures = new Map();
  for (const node of Object.values(nodes)) {
    if (node.type === 'result' && node.name) {
      resultNotes.set(node.name, node.note || '');
      if (node.features) resultFeatures.set(node.name, node.features);
    }
  }
  const matrix = new Map();
  for (const [name, paths] of pathsMap) {
    const note = resultNotes.get(name) || '';
    const rf   = resultFeatures.get(name) || {};
    const canonical = pu.pickCanonicalPath(paths, note, rf) || [];
    const features = new Map();
    for (const { question: q, choice: c, group } of canonical)
      if (q && c && !c.startsWith('Cannot determine') && !group) features.set(q, c);
    for (const [q, c] of Object.entries(rf)) {
      if (c.startsWith('Cannot determine')) features.delete(q);
      else features.set(q, c);
    }
    matrix.set(name, features);
  }
  return matrix;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCdLabel(nodes, questionText) {
  for (const node of Object.values(nodes)) {
    if (node.type === 'question' && node.question === questionText) {
      const c = (node.choices || []).find(c => c.label && c.label.startsWith('Cannot determine'));
      if (c) return c.label;
    }
  }
  return null;
}

function buildQChoicesMap(treeNodes, matrix) {
  const qChoicesMap = new Map();
  for (const node of Object.values(treeNodes))
    if (node.type === 'question' && !qChoicesMap.has(node.question))
      qChoicesMap.set(node.question, node.choices || []);
  // Second pass: features-only questions get synthetic choices from distinct values
  function rank(c) {
    if (/^Yes\b/i.test(c)) return 0; if (/^No\b/i.test(c)) return 1;
    if (/^Cannot determine/i.test(c)) return 2; return 3;
  }
  for (const [, features] of matrix) {
    for (const q of features.keys()) {
      if (qChoicesMap.has(q)) continue;
      const vals = new Set();
      for (const [, f2] of matrix) if (f2.has(q)) vals.add(f2.get(q));
      if (vals.size > 0)
        qChoicesMap.set(q, [...vals].sort((a, b) => rank(a) - rank(b)).map(l => ({ label: l })));
    }
  }
  return qChoicesMap;
}

// ── Walk a single species in the browser ─────────────────────────────────────
// Returns { path: [{question, choice}], labelMismatches: [questionText] }

async function walkSpecies(pg, port, resultName, matrix, treeNodes, simAnswers, qChoicesMap, hideOrphanQs) {
  await pg.goto(`http://localhost:${port}/checklist.html`, { waitUntil: 'networkidle' });
  await pg.evaluate(() => localStorage.clear());
  await pg.reload({ waitUntil: 'networkidle' });

  const targetResultIds = new Set();
  for (const [id, node] of Object.entries(treeNodes))
    if (node && node.type === 'result' && node.name === resultName) targetResultIds.add(id);

  const canonicalAnswers = matrix.get(resultName);
  const answers          = new Map();
  const walkPath         = [];
  const labelMismatches  = [];
  const orphanNoDisplay  = new Set();
  const simCdQs          = new Set([...simAnswers.entries()]
    .filter(([, a]) => a.startsWith('Cannot determine')).map(([q]) => q));
  const answeredQ        = [];   // question texts answered so far (for DOM query)

  for (let step = 0; step < 50; step++) {
    // ── Ask the browser: what is the top unanswered question? ─────────────────
    // Read WITHOUT expanding — same rule as verify_sim_cd_paths.js: expanding
    // triggers the CD-followup insertion branch (else-branch of
    // getDisplayQuestionsPure) that a normal answer-by-answer user never sees.
    const topQ = await pg.evaluate((done) => {
      const btns = [...document.querySelectorAll('button.cl-cbtn')];
      const order = [];
      for (const b of btns) if (!order.includes(b.dataset.q)) order.push(b.dataset.q);
      const doneSet = new Set(done);
      return order.find(q => !doneSet.has(q)) || null;
    }, answeredQ);

    if (topQ === null) break;   // no more questions in window

    // ── Determine the answer for this species ─────────────────────────────────
    let nextAns = null;
    let isOrphan = false;

    if (simAnswers.has(topQ)) {
      nextAns = simAnswers.get(topQ);
    } else if (pu.isSimCdQuestion(topQ, qChoicesMap.get(topQ))) {
      const cdLabel = getCdLabel(treeNodes, topQ);
      if (cdLabel) { nextAns = cdLabel; simCdQs.add(topQ); }
    }

    if (nextAns === null) {
      // Orphan: appears because a competing candidate needs it; this species has
      // no feature for it. Mirror compute_sim_cd_paths.js's orphan fallback.
      isOrphan = true;
      const choices = qChoicesMap.get(topQ) || [];
      if (choices.length >= 2) {
        let chosen = choices.find(c => /^(No|None)\b/i.test(c.label));
        if (!chosen) chosen = choices.find(c => { const nx = treeNodes[c.next]; return nx && nx.type === 'question'; });
        if (!chosen) chosen = choices[0];
        nextAns = chosen.label;
        if (hideOrphanQs.has(topQ)) orphanNoDisplay.add(topQ);
      } else {
        break;   // can't advance
      }
    }

    // ── Click the answer button in the browser ────────────────────────────────
    let clicked = await pg.evaluate(([q, c]) => {
      const b = [...document.querySelectorAll('button.cl-cbtn')]
        .find(x => x.dataset.q === q && x.dataset.c === c);
      if (b) { b.click(); return true; } return false;
    }, [topQ, nextAns]);

    if (!clicked) {
      // Button not found — expand and try once more (may be beyond 15-cap)
      const more = await pg.$('#cl-show-more');
      if (more) await more.click();
      clicked = await pg.evaluate(([q, c]) => {
        const b = [...document.querySelectorAll('button.cl-cbtn')]
          .find(x => x.dataset.q === q && x.dataset.c === c);
        if (b) { b.click(); return true; } return false;
      }, [topQ, nextAns]);
    }

    if (!clicked) {
      // Label mismatch: the intended answer has no matching button.
      // Record the mismatch, skip this question, and advance — the walk
      // continues to expose downstream effects.
      labelMismatches.push({ question: topQ, expectedChoice: nextAns });
      answeredQ.push(topQ);   // mark as "handled" so the loop doesn't retry it
      continue;
    }

    answers.set(topQ, nextAns);
    answeredQ.push(topQ);
    if (!orphanNoDisplay.has(topQ)) walkPath.push({ question: topQ, choice: nextAns });
    await pg.waitForTimeout(10);

    // ── Convergence checks (Node-side, mirroring compute_sim_cd_paths.js) ─────

    // Terminal direct exit: own real answer routes straight to result node
    if (canonicalAnswers && canonicalAnswers.get(topQ) === nextAns) {
      let hitTargetResult = false;
      for (const node of Object.values(treeNodes)) {
        if (node.type === 'question' && node.question === topQ) {
          const ch = (node.choices || []).find(c => c.label === nextAns);
          if (ch && targetResultIds.has(ch.next)) { hitTargetResult = true; break; }
        }
      }
      if (hitTargetResult) {
        const exitScores = pu.scoreAllPure(answers, matrix);
        if (exitScores[0]?.name === resultName &&
            (exitScores.length < 2 || exitScores[0].score >= exitScores[1].score + 2)) break;
      }
    }

    // Score-convergence: #1 by ≥2, all CD questions answered, no own-features left
    const scores = pu.scoreAllPure(answers, matrix);
    if (scores.length > 0 && scores[0].name === resultName &&
        (scores.length < 2 || scores[0].score >= scores[1].score + 2)) {
      if ([...simCdQs].every(q => answers.has(q))) {
        // Read current window from browser (without expanding) to check own-features
        const windowQs = await pg.evaluate((done) => {
          const btns = [...document.querySelectorAll('button.cl-cbtn')];
          const order = [];
          for (const b of btns) if (!order.includes(b.dataset.q)) order.push(b.dataset.q);
          const doneSet = new Set(done);
          return order.filter(q => !doneSet.has(q)).slice(0, 15);
        }, answeredQ);
        const ownLeft = windowQs.filter(q => simAnswers.has(q)).length;
        if (ownLeft === 0) break;
      }
    }
  }

  // Apply canonical-equality suppression: if walkPath == canonical, store null
  if (canonicalAnswers) {
    const canonPath = walkPath
      .filter(s => canonicalAnswers.has(s.question))
      .map(s => ({ question: s.question, choice: canonicalAnswers.get(s.question) }));
    if (JSON.stringify(walkPath) === JSON.stringify(canonPath)) {
      return { path: null, labelMismatches };
    }
  }

  return { path: walkPath.length ? walkPath : null, labelMismatches };
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { all: false, batchSize: null, batchIndex: null, file: null, names: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all')          { opts.all = true; }
    else if (args[i] === '--batch-size')  { opts.batchSize  = parseInt(args[++i], 10); }
    else if (args[i] === '--batch-index') { opts.batchIndex = parseInt(args[++i], 10); }
    else if (args[i] === '--file')    { opts.file = args[++i]; }
    else                              { opts.names.push(args[i]); }
  }
  return opts;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const opts = parseArgs(process.argv);

  const treeData  = JSON.parse(fs.readFileSync(TREE_PATH, 'utf8'));
  const stored    = JSON.parse(fs.readFileSync(STORED_PATH, 'utf8'));
  const treeNodes = treeData.nodes;
  const qNumbers  = pu.buildQuestionNumbers(treeData);
  const pathsMap  = pu.buildTreePaths(treeData);
  const matrix    = buildFeatureMatrix(treeData, pathsMap);
  const qChoicesMap = buildQChoicesMap(treeNodes, matrix);

  const hideOrphanQs = new Set();
  for (const node of Object.values(treeNodes))
    if (node && node.type === 'question' && node.hideOrphanInPath && node.question)
      hideOrphanQs.add(node.question);

  // Determine which species to walk
  let allNames = [...matrix.keys()];

  let targetNames;
  if (opts.file) {
    targetNames = fs.readFileSync(opts.file, 'utf8').split('\n')
      .map(s => s.trim()).filter(Boolean);
  } else if (opts.names.length) {
    targetNames = opts.names.map(n => {
      const found = allNames.find(k => k.toLowerCase().includes(n.toLowerCase()));
      if (!found) { console.error(`Species not found: ${n}`); process.exit(2); }
      return found;
    });
  } else if (opts.all || opts.batchSize !== null) {
    targetNames = allNames;
  } else {
    console.error(
      'Usage:\n' +
      '  node scripts/walk_sim_cd_paths.js --all\n' +
      '  node scripts/walk_sim_cd_paths.js --batch-size 20 --batch-index 0\n' +
      '  node scripts/walk_sim_cd_paths.js "Arhopala selta" "Arhopala opalina"\n' +
      '  node scripts/walk_sim_cd_paths.js --file list.txt'
    );
    process.exit(2);
  }

  // Apply batch slicing
  if (opts.batchSize !== null) {
    const idx   = opts.batchIndex || 0;
    const start = idx * opts.batchSize;
    targetNames = targetNames.slice(start, start + opts.batchSize);
    if (!targetNames.length) { console.log(`Batch ${idx}: no species in range.`); process.exit(0); }
    console.log(`Batch ${idx}: species ${start}–${start + targetNames.length - 1} of ${allNames.length} (${targetNames.length} this batch)`);
  }

  const port = parseInt(process.env.FS_VERIFY_PORT || '8137', 10);
  const { chromium } = loadPlaywright();
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true });

  let pass = 0, fail = 0;
  const failures = [], mismatches = [];

  for (const name of targetNames) {
    const canonicalAnswers = matrix.get(name);
    if (!canonicalAnswers || canonicalAnswers.size === 0) {
      console.log(`⊘ ${name}  (no features — skipped)`);
      continue;
    }

    // Build simAnswers (underside-only: CD substitutions for upperside / space 1–3)
    const simAnswers = new Map();
    for (const [q, answer] of canonicalAnswers) {
      if (pu.isSimCdQuestion(q, qChoicesMap.get(q))) {
        const cdLabel = getCdLabel(treeNodes, q);
        simAnswers.set(q, cdLabel || answer);
      } else {
        simAnswers.set(q, answer);
      }
    }

    const pg = await browser.newPage();
    let result;
    try {
      result = await walkSpecies(pg, port, name, matrix, treeNodes, simAnswers, qChoicesMap, hideOrphanQs);
    } catch (err) {
      console.error(`✗ ${name}  ERROR: ${err.message}`);
      fail++;
      failures.push({ name, error: err.message });
      await pg.close();
      continue;
    }
    await pg.close();

    const { path: livePath, labelMismatches: lm } = result;
    const storedPath = stored[name] || null;

    const liveStr   = JSON.stringify(livePath);
    const storedStr = JSON.stringify(storedPath);

    if (lm.length) {
      for (const { question, expectedChoice } of lm)
        mismatches.push({ name, question, expectedChoice });
    }

    if (liveStr === storedStr) {
      const tag = livePath ? `(${livePath.length} steps)` : '(non-divergent)';
      const mm  = lm.length ? `  ⚠ ${lm.length} label-mismatch(es)` : '';
      console.log(`✓ ${name}  ${tag}${mm}`);
      pass++;
    } else {
      fail++;
      const liveLen   = livePath   ? livePath.length   : 0;
      const storedLen = storedPath ? storedPath.length : 0;
      const mm = lm.length ? `  ⚠ ${lm.length} label-mismatch(es)` : '';
      console.log(`✗ ${name}  live: ${liveLen} steps, stored: ${storedLen} steps${mm}`);

      // Show first diverging step
      const maxLen = Math.max(liveLen, storedLen);
      for (let i = 0; i < maxLen; i++) {
        const l = livePath   ? livePath[i]   : null;
        const s = storedPath ? storedPath[i] : null;
        if (JSON.stringify(l) !== JSON.stringify(s)) {
          const lKey = l ? `Q${qNumbers.get(l.question) || '?'} ${l.choice.slice(0, 35)}` : '(missing)';
          const sKey = s ? `Q${qNumbers.get(s.question) || '?'} ${s.choice.slice(0, 35)}` : '(missing)';
          console.log(`    first diff at step ${i + 1}: browser=[${lKey}]  stored=[${sKey}]`);
          break;
        }
      }
      failures.push({ name, liveLen, storedLen, livePath, storedPath });
    }
  }

  await browser.close();
  server.close();

  console.log(`\n${pass + fail}/${targetNames.length} walked — ${pass} match, ${fail} differ`);

  if (mismatches.length) {
    console.log('\nLabel mismatches (feature value has no matching button):');
    for (const { name, question, expectedChoice } of mismatches)
      console.log(`  ${name.replace('Arhopala ', '')}: Q${qNumbers.get(question) || '?'} "${expectedChoice.slice(0, 60)}"`);
    console.log('  → Fix: update the result node feature to match the tree choice label.');
  }

  if (failures.length) {
    console.log('\nDiverged:');
    for (const f of failures)
      console.log('  ' + f.name.replace('Arhopala ', '') + (f.error ? `  ERROR: ${f.error}` : ''));
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(2); });
