#!/usr/bin/env node
'use strict';
/**
 * Verify the stored Underside-only paths (data/sim_cd_paths.json) are FAITHFUL to
 * the live checklist.html flow, for EVERY species.
 *
 * The Underside-only path is the sim-CD path: upperside / FW-space-1–3 features
 * answered "Cannot determine", everything else truthful. For each species this
 * steps through checklist.html and, at each step, confirms the stored question is
 * the first UNANSWERED question in the live display order, then clicks the stored
 * answer. Any divergence = FAIL (the result card's Underside-only path would show
 * something different from what the user actually encounters). Non-zero exit if
 * any species diverges.
 *
 * This is the underside-only counterpart to scripts/verify_fs_paths.js.
 *
 * IMPORTANT — do NOT expand the list before reading the order. Clicking
 * "#cl-show-more" re-renders through getDisplayQuestionsPure's ELSE branch
 * (questionOrder is not nulled), which fires the CD-followup INSERTION and
 * reorders the unanswered tail (e.g. jumps a CD question's followup up next to
 * it). A normal question-by-question user never sees that view — every answer
 * sets cs.questionOrder = null, so the next render takes the fresh-sort branch.
 * We therefore read the order from the post-answer render and only expand when a
 * target button sits beyond the 15-question cap (order already captured).
 *
 * Prereq: serve the repo on http://localhost:8137 (e.g. `python3 -m http.server
 * 8137` from the repo root, or the built-in server in scripts/fs_regress.js).
 *
 * Usage: node scripts/verify_sim_cd_paths.js
 *
 * Env: PLAYWRIGHT_MODULE (default /opt/node22/lib/node_modules/playwright),
 *      FS_VERIFY_PORT (default 8137).
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const pu = require(path.join(REPO, 'js', 'path-utils.js'));

function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_MODULE, 'playwright',
                   '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(c); } catch (_) {}
  }
  throw new Error('Playwright not found — set PLAYWRIGHT_MODULE');
}

(async () => {
  const { chromium } = loadPlaywright();
  const port = process.env.FS_VERIFY_PORT || '8137';
  const tree = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'tree.json')));
  const nums = pu.buildQuestionNumbers(tree);
  const paths = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'sim_cd_paths.json')));

  const b = await chromium.launch({ headless: true });
  const pg = await b.newPage();
  const names = Object.keys(paths);
  let pass = 0; const fails = [];

  for (const name of names) {
    const p = paths[name];
    await pg.goto(`http://localhost:${port}/checklist.html`, { waitUntil: 'networkidle' });
    await pg.evaluate(() => localStorage.clear());
    await pg.reload({ waitUntil: 'networkidle' });
    let ok = true, failAt = null;
    const answered = [];
    for (let i = 0; i < p.length; i++) {
      const { question, choice } = p[i];
      // Read the fresh post-answer order WITHOUT expanding (see header note).
      const top = await pg.evaluate((ans) => {
        const done = new Set(ans);
        const btns = [...document.querySelectorAll('button.cl-cbtn')];
        const order = []; for (const bb of btns) if (!order.includes(bb.dataset.q)) order.push(bb.dataset.q);
        return order.find(q => !done.has(q)) || null;
      }, answered);
      if (top !== question) { ok = false; failAt = { step: i + 1, expected: question, got: top }; break; }
      let clicked = await pg.evaluate(([q, c]) => {
        const bb = [...document.querySelectorAll('button.cl-cbtn')].find(x => x.dataset.q === q && x.dataset.c === c);
        if (bb) { bb.click(); return true; } return false;
      }, [question, choice]);
      if (!clicked) {
        // Target button beyond the 15-cap — expand, then click (order already read).
        const more = await pg.$('#cl-show-more'); if (more) await more.click();
        clicked = await pg.evaluate(([q, c]) => {
          const bb = [...document.querySelectorAll('button.cl-cbtn')].find(x => x.dataset.q === q && x.dataset.c === c);
          if (bb) { bb.click(); return true; } return false;
        }, [question, choice]);
      }
      if (!clicked) { ok = false; failAt = { step: i + 1, expected: question, note: 'answer not clickable: ' + choice }; break; }
      answered.push(question);
      await pg.waitForTimeout(10);
    }
    if (ok) { pass++; console.log(`✓ ${name}  (${p.length} steps)`); }
    else { fails.push({ name, failAt }); const g = failAt.got ? 'Q' + (nums.get(failAt.got) || '?') : (failAt.note || '?'); console.log(`✗ ${name}  @step ${failAt.step}: expected Q${nums.get(failAt.expected) || '?'}, live top = ${g}`); }
  }
  await b.close();

  console.log(`\n${pass}/${names.length} species: card Underside-only path == live browser flow`);
  if (fails.length) { console.log('Diverged: ' + fails.map(f => f.name.replace('Arhopala ', '')).join(', ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(2); });
