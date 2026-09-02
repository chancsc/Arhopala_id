#!/usr/bin/env node
'use strict';
/**
 * Validate that data/sim_cd_paths.json matches the live Feature Scoring simulation.
 *
 * Re-runs the same computation as compute_sim_cd_paths.js and diffs the result
 * against the stored file.  Exits 0 if everything matches, 1 if any paths differ.
 *
 * Run after any change to data/tree.json or js/path-utils.js:
 *   node scripts/validate_sim_cd_paths.js
 */

const fs   = require('fs');
const path = require('path');

const {
  isSimCdQuestion,
  scoreAllPure,
  getDisplayQuestionsPure,
  buildTreePaths,
  buildQuestionNumbers,
  pickCanonicalPath,
} = require('../js/path-utils.js');

const TREE_PATH   = path.join(__dirname, '../data/tree.json');
const STORED_PATH = path.join(__dirname, '../data/sim_cd_paths.json');

// ── Copied from compute_sim_cd_paths.js (must stay in sync) ──────────────────

function buildFeatureMatrix(treeData, pathsMap) {
  const nodes = treeData.nodes;
  const qMeta = new Map();
  const qCov  = new Map();
  const resultNotes    = new Map();
  const resultFeatures = new Map();

  for (const node of Object.values(nodes)) {
    if (node.type === 'question') {
      const choices = (node.choices || []).map(c => c.label);
      if (!qMeta.has(node.question)) {
        qMeta.set(node.question, { choices, hint: node.hint || '' });
      } else {
        const ex = qMeta.get(node.question);
        for (const l of choices) if (!ex.choices.includes(l)) ex.choices.push(l);
      }
    }
    if (node.type === 'result' && node.name) {
      resultNotes.set(node.name, node.note || '');
      if (node.features) resultFeatures.set(node.name, node.features);
    }
  }

  const matrix    = new Map();
  const rawMatrix = new Map(); // canonical-path answers BEFORE result-node feature overrides
  for (const [name, paths] of pathsMap) {
    const note = resultNotes.get(name) || '';
    const rf   = resultFeatures.get(name) || {};
    const canonical = pickCanonicalPath(paths, note, rf) || [];
    const features = new Map();
    const covSeen  = new Set();
    for (const step of canonical) {
      const { question: q, choice: c } = step;
      if (q && c && !c.startsWith('Cannot determine') && !step.group) {
        features.set(q, c);
        if (!covSeen.has(q)) { covSeen.add(q); qCov.set(q, (qCov.get(q) || 0) + 1); }
      }
    }
    // Snapshot raw (pre-override) answers — used for divergence detection below.
    rawMatrix.set(name, new Map(features));
    for (const [q, c] of Object.entries(rf)) {
      if (c.startsWith('Cannot determine')) { features.delete(q); }
      else {
        if (!features.has(q)) qCov.set(q, (qCov.get(q) || 0) + 1);
        features.set(q, c);
      }
    }
    matrix.set(name, features);
  }
  return { matrix, rawMatrix, qMeta, qCov, resultNotes };
}

function getCdLabel(nodes, questionText) {
  for (const node of Object.values(nodes)) {
    if (node.type === 'question' && node.question === questionText) {
      const c = (node.choices || []).find(c => c.label && c.label.startsWith('Cannot determine'));
      if (c) return c.label;
    }
  }
  return null;
}

function computeSimCdPath(resultName, matrix, treeNodes, canonicalAnswers, rawCanonicalAnswers) {
  if (!canonicalAnswers || canonicalAnswers.size === 0) return null;

  // Result node id(s) for this species — used to detect a terminal direct exit.
  const targetResultIds = new Set();
  for (const [id, node] of Object.entries(treeNodes))
    if (node && node.type === 'result' && node.name === resultName) targetResultIds.add(id);

  // Questions flagged ("hideOrphanInPath") to omit from the displayed sim-CD
  // path when answered only via the orphan-fallback. Must stay in sync with
  // compute_sim_cd_paths.js.
  const hideOrphanQs = new Set();
  for (const node of Object.values(treeNodes))
    if (node && node.type === 'question' && node.hideOrphanInPath && node.question) hideOrphanQs.add(node.question);

  const qChoicesMap = new Map();
  for (const node of Object.values(treeNodes)) {
    if (node.type === 'question' && !qChoicesMap.has(node.question))
      qChoicesMap.set(node.question, node.choices || []);
  }
  // Second pass: features-only questions (matrix but no tree node) get synthetic
  // choices from their distinct feature values — mirrors checklist.js's second pass.
  function _featureChoiceRank(c) {
    if (/^Yes\b/i.test(c)) return 0;
    if (/^No\b/i.test(c))  return 1;
    if (/^Cannot determine/i.test(c)) return 2;
    return 3;
  }
  for (const [, features] of matrix) {
    for (const q of features.keys()) {
      if (qChoicesMap.has(q)) continue;
      const vals = new Set();
      for (const [, f2] of matrix) if (f2.has(q)) vals.add(f2.get(q));
      if (vals.size > 0)
        qChoicesMap.set(q, [...vals].sort((a, b) => _featureChoiceRank(a) - _featureChoiceRank(b)).map(label => ({ label })));
    }
  }

  const simAnswers = new Map();
  for (const [q, answer] of canonicalAnswers) {
    if (isSimCdQuestion(q, qChoicesMap.get(q))) {
      const cdLabel = getCdLabel(treeNodes, q);
      simAnswers.set(q, cdLabel || answer);
    } else {
      simAnswers.set(q, answer);
    }
  }

  // NOTE: no CD-followup answer inference here — kept in sync with
  // compute_sim_cd_paths.js. Pre-filling a followup's answer skipped it from the
  // stored path while the live checklist still presents it (the step-9 Q79/Q80
  // divergence). Followups now surface naturally in the step loop below.

  const answers       = new Map();
  let   questionOrder = [];
  const simPath       = [];
  const simCdQs       = new Set([...simAnswers.entries()]
    .filter(([, a]) => a.startsWith('Cannot determine')).map(([q]) => q));
  // Orphan questions defaulted to choices[0] (no clear negative choice exists) —
  // tracked separately so they're excluded from the displayed simPath while
  // still advancing the simulation. Must stay in sync with compute_sim_cd_paths.js.
  const orphanNoDisplay = new Set();

  for (let step = 0; step < 50; step++) {
    // Re-sort the display on every answer, mirroring the live checklist
    // (js/checklist.js sets cs.questionOrder = null after each answer, so
    // getDisplayQuestionsPure rebuilds a fresh sort). A persistent order here
    // would diverge from what the user actually sees, leaving the stored
    // Underside-only path out of step with the live Feature Scoring flow.
    questionOrder = [];
    const scores = scoreAllPure(answers, matrix);
    getDisplayQuestionsPure(answers, scores, matrix, treeNodes, questionOrder);

    let nextQ = null, nextAns = null, seen = 0;
    for (const q of questionOrder) {
      if (answers.has(q)) continue;
      if (++seen > 15) break;
      if (simAnswers.has(q)) { nextQ = q; nextAns = simAnswers.get(q); break; }
      if (isSimCdQuestion(q, qChoicesMap.get(q))) {
        const cdLabel = getCdLabel(treeNodes, q);
        if (cdLabel) { nextQ = q; nextAns = cdLabel; simCdQs.add(q); break; }
      }
      // Orphan question: appears in the window because it distinguishes other
      // top-tier candidates, but resultName has no recorded answer for it (so
      // neither choice changes resultName's own score). Default to a clear
      // negative choice when one exists (a real, meaningful answer); for
      // multi-way classification questions with no negative/not-applicable
      // choice, still default to choices[0] to keep the simulation moving,
      // but suppress it from the displayed path since it would fabricate an
      // answer unrelated to the species' real morphology.
      const choices = qChoicesMap.get(q) || [];
      if (choices.length >= 2) {
        // Show whatever we pick (the live checklist shows every window question).
        //   1. "No"/"None", 2. trunk-continuing "none of these", 3. choices[0].
        let chosen = choices.find(c => /^(No|None)\b/i.test(c.label));
        if (!chosen) chosen = choices.find(c => { const nx = treeNodes[c.next]; return nx && nx.type === 'question'; });
        if (!chosen) chosen = choices[0];
        nextQ = q; nextAns = chosen.label;
        if (hideOrphanQs.has(nextQ)) orphanNoDisplay.add(nextQ);
        break;
      }
    }
    // Second pass: when the 15-cap window yielded nothing, scan ALL remaining
    // questions for real (simAnswers) features — models a user who clicks
    // "Show all features" to see the full list. CD/orphan answers are NOT
    // extended beyond the cap; only real own-features are added here.
    if (nextQ === null) {
      for (const q of questionOrder) {
        if (answers.has(q)) continue;
        if (simAnswers.has(q)) { nextQ = q; nextAns = simAnswers.get(q); break; }
      }
      if (nextQ === null) break;
    }

    answers.set(nextQ, nextAns);
    if (!orphanNoDisplay.has(nextQ)) simPath.push({ question: nextQ, choice: nextAns });

    // Terminal direct exit: when the species' own (real) answer to this question
    // routes straight to its result node, it is definitively identified — stop.
    // Must stay in sync with compute_sim_cd_paths.js.
    if (canonicalAnswers.get(nextQ) === nextAns) {
      let hitTargetResult = false;
      for (const node of Object.values(treeNodes)) {
        if (node.type === 'question' && node.question === nextQ) {
          const ch = (node.choices || []).find(c => c.label === nextAns);
          if (ch && targetResultIds.has(ch.next)) { hitTargetResult = true; break; }
        }
      }
      if (hitTargetResult) {
        // Only stop at the tree's terminal exit when the species is already
        // uniquely #1 by ≥2. If still tied (e.g. opalina/aedias), let the
        // convergence check below continue to separate them.
        const exitScores = scoreAllPure(answers, matrix);
        if (exitScores[0]?.name === resultName &&
            (exitScores.length < 2 || exitScores[0].score >= exitScores[1].score + 2)) {
          break;
        }
      }
    }

    const newScores = scoreAllPure(answers, matrix);
    if (newScores.length > 0 && newScores[0].name === resultName &&
        (newScores.length < 2 || newScores[0].score >= newScores[1].score + 2)) {
      if ([...simCdQs].every(q => answers.has(q))) {
        questionOrder = [];
        getDisplayQuestionsPure(answers, newScores, matrix, treeNodes, questionOrder);
        const ownLeft = questionOrder
          .filter(q => !answers.has(q)).slice(0, 15)
          .filter(q => simAnswers.has(q)).length;
        if (ownLeft === 0) break;
      }
    }
  }

  if (simPath.length === 0) return null;

  const refAnswers = rawCanonicalAnswers || canonicalAnswers;
  const referencePath = simPath
    .filter(s => refAnswers.has(s.question))
    .map(s => ({ question: s.question, choice: refAnswers.get(s.question) }));
  if (JSON.stringify(simPath) === JSON.stringify(referencePath)) return null;

  return simPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const treeData = JSON.parse(fs.readFileSync(TREE_PATH, 'utf8'));
  const stored   = JSON.parse(fs.readFileSync(STORED_PATH, 'utf8'));
  const qNumbers = buildQuestionNumbers(treeData);

  const pathsMap   = buildTreePaths(treeData);
  const { matrix, rawMatrix } = buildFeatureMatrix(treeData, pathsMap);
  const treeNodes  = treeData.nodes;

  let pass = 0, fail = 0;
  const failures = [];

  // All species in either computed or stored set
  const allNames = new Set([...matrix.keys(), ...Object.keys(stored)]);

  for (const name of allNames) {
    const canonicalAnswers    = matrix.get(name);
    const rawCanonicalAnswers = rawMatrix.get(name);
    const live = canonicalAnswers
      ? computeSimCdPath(name, matrix, treeNodes, canonicalAnswers, rawCanonicalAnswers)
      : null;
    const storedPath = stored[name] || null;

    const liveStr   = JSON.stringify(live);
    const storedStr = JSON.stringify(storedPath);

    if (liveStr === storedStr) {
      pass++;
    } else {
      fail++;
      const short = name.replace('Arhopala ', '');
      const liveLen   = live   ? live.length   : 0;
      const storedLen = storedPath ? storedPath.length : 0;
      failures.push({ name: short, liveLen, storedLen, live, storedPath });
    }
  }

  if (fail === 0) {
    console.log(`✓  All ${pass} sim-CD paths match the live simulation.`);
    process.exit(0);
  }

  console.error(`✗  ${fail} of ${pass + fail} sim-CD paths differ from the live simulation:\n`);

  for (const { name, liveLen, storedLen, live, storedPath } of failures) {
    console.error(`  ${name}  (live: ${liveLen} steps, stored: ${storedLen} steps)`);

    // Show first mismatch
    const maxLen = Math.max(liveLen, storedLen);
    for (let i = 0; i < maxLen; i++) {
      const l = live   ? live[i]        : null;
      const s = storedPath ? storedPath[i] : null;
      const lKey = l ? `Q${qNumbers.get(l.question)||'?'} ${l.choice.slice(0,30)}` : '(missing)';
      const sKey = s ? `Q${qNumbers.get(s.question)||'?'} ${s.choice.slice(0,30)}` : '(missing)';
      if (JSON.stringify(l) !== JSON.stringify(s)) {
        console.error(`    step ${i+1}: live=[${lKey}]  stored=[${sKey}]  ← first diff`);
        break;
      }
    }
  }

  console.error('\nRun: node scripts/compute_sim_cd_paths.js   to regenerate.');
  process.exit(1);
}

main();
