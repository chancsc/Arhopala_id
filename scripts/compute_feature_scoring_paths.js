#!/usr/bin/env node
'use strict';
/**
 * Compute Simulation CD paths for all species via Feature Scoring simulation.
 *
 * For each species, simulates the Feature Scoring flow answering:
 *   • "Cannot determine" for any question about upperside features or spaces 1–3
 *   • The canonical answer for all other questions
 *
 * Outputs data/feature_scoring_paths.json — a dict keyed by result name, each value a list
 * of {question, choice} steps in the order Feature Scoring would present them.
 *
 * Shares scoreAllPure and getDisplayQuestionsPure directly from js/path-utils.js,
 * so the simulation is guaranteed to mirror the live browser behaviour exactly.
 *
 * Usage: node scripts/compute_sim_cd_paths.js
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
const OUTPUT_PATH = path.join(__dirname, '../data/feature_scoring_paths.json');

// ── Feature matrix ────────────────────────────────────────────────────────────

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

  const matrix = new Map();
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
    // Apply explicit features override from result node
    for (const [q, c] of Object.entries(rf)) {
      if (c.startsWith('Cannot determine')) {
        features.delete(q);
      } else {
        if (!features.has(q)) qCov.set(q, (qCov.get(q) || 0) + 1);
        features.set(q, c);
      }
    }
    matrix.set(name, features);
  }

  return { matrix, qMeta, qCov, resultNotes };
}

// ── Sim-CD path computation ───────────────────────────────────────────────────

function getCdLabel(nodes, questionText) {
  for (const node of Object.values(nodes)) {
    if (node.type === 'question' && node.question === questionText) {
      const c = (node.choices || []).find(c => c.label && c.label.startsWith('Cannot determine'));
      if (c) return c.label;
    }
  }
  return null;
}

function computeFeatureScoringPath(resultName, matrix, treeNodes, canonicalAnswers) {
  if (!canonicalAnswers || canonicalAnswers.size === 0) return null;

  // Result node id(s) for this species — used to detect a terminal direct exit.
  const targetResultIds = new Set();
  for (const [id, node] of Object.entries(treeNodes))
    if (node && node.type === 'result' && node.name === resultName) targetResultIds.add(id);

  // Questions flagged ("hideOrphanInPath") to omit from the displayed sim-CD
  // path when answered only via the orphan-fallback — avoids showing a default
  // "No" that can contradict a real answer to a sibling question about the same
  // character (e.g. the corinda HW-cell-length gate vs the aurea cell question).
  const hideOrphanQs = new Set();
  for (const node of Object.values(treeNodes))
    if (node && node.type === 'question' && node.hideOrphanInPath && node.question) hideOrphanQs.add(node.question);

  // Build question → choices lookup so isSimCdQuestion can inspect CD choice labels
  const qChoicesMap = new Map();
  for (const node of Object.values(treeNodes)) {
    if (node.type === 'question' && !qChoicesMap.has(node.question))
      qChoicesMap.set(node.question, node.choices || []);
  }

  // Feature Scoring path (full information): answer the species' own features
  // TRUTHFULLY, including upperside / space-1–3 features — NO CD masking. This
  // is the difference from the Underside-only (sim-CD) path, which masks those
  // to "Cannot determine". Orphan questions the species has no feature for are
  // still handled in the loop below (CD if upperside/space, else a "No"-shaped
  // default), exactly as in the sim so the order mirrors the live checklist.
  const simAnswers = new Map(canonicalAnswers);

  // Simulate Feature Scoring using the same functions as the browser
  const answers       = new Map();
  let   questionOrder = [];           // mutable state for getDisplayQuestionsPure
  const simPath       = [];
  const simCdQs       = new Set([...simAnswers.entries()]
    .filter(([, a]) => a.startsWith('Cannot determine')).map(([q]) => q));
  // Orphan questions defaulted to choices[0] (no clear negative choice exists) —
  // tracked separately so they're excluded from the displayed simPath while
  // still advancing the simulation. See orphan-question comment below.
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

    // Find the first unanswered question in the visible 15-cap window that
    // this species can answer — either from simAnswers or as a sim-CD question
    // that the user can't see (upperside / space 1–3).
    let nextQ = null, nextAns = null, seen = 0;
    for (const q of questionOrder) {
      if (answers.has(q)) continue;
      if (++seen > 15) break;
      if (simAnswers.has(q)) {
        nextQ = q; nextAns = simAnswers.get(q); break;
      }
      if (isSimCdQuestion(q, qChoicesMap.get(q))) {
        const cdLabel = getCdLabel(treeNodes, q);
        if (cdLabel) { nextQ = q; nextAns = cdLabel; simCdQs.add(q); break; }
      }
      // Orphan question: appears in the window because it distinguishes other
      // top-tier candidates, but resultName has no recorded answer for it (so
      // neither choice changes resultName's own score). The live Feature
      // Scoring page still presents it and waits for an answer, so default to
      // the answer a specimen of resultName actually gives for a character it
      // does not possess — and SHOW it, because the live checklist shows it too
      // (this is a Feature-Scoring path; unlike the Underside-only path we do
      // not suppress multi-way orphans). Preference order:
      //   1. a "No"/"None" choice (genuinely binary),
      //   2. the multi-way "none of these apply" choice that CONTINUES the key
      //      (its next is another question, not a result/group peel-off) — e.g.
      //      Q62 "Neither of these" → the next trunk question, which is exactly
      //      what a live user with none of the listed characters clicks,
      //   3. choices[0] as a last resort.
      const choices = qChoicesMap.get(q) || [];
      if (choices.length >= 2) {
        let chosen = choices.find(c => /^(No|None)\b/i.test(c.label));
        if (!chosen) chosen = choices.find(c => { const nx = treeNodes[c.next]; return nx && nx.type === 'question'; });
        if (!chosen) chosen = choices[0];
        nextQ = q; nextAns = chosen.label;
        if (hideOrphanQs.has(nextQ)) orphanNoDisplay.add(nextQ);
        break;
      }
    }
    if (nextQ === null) break;

    answers.set(nextQ, nextAns);
    if (!orphanNoDisplay.has(nextQ)) simPath.push({ question: nextQ, choice: nextAns });

    // Terminal direct exit: when the species' own (real) answer to this question
    // routes straight to its result node in the tree, it is definitively
    // identified — stop here instead of continuing to ask confirmatory scoring
    // questions (which would extend the displayed path past the actual ID point,
    // e.g. A. agaba's paler-subapical-area question → r_agaba).
    if (canonicalAnswers.get(nextQ) === nextAns) {
      let hitTargetResult = false;
      for (const node of Object.values(treeNodes)) {
        if (node.type === 'question' && node.question === nextQ) {
          const ch = (node.choices || []).find(c => c.label === nextAns);
          if (ch && targetResultIds.has(ch.next)) { hitTargetResult = true; break; }
        }
      }
      if (hitTargetResult) break;
    }

    // Stop once species is uniquely #1 by at least 2 points, all sim-CD questions
    // answered, and no more of the species' own canonical features remain visible
    // in the window. This mirrors live Feature Scoring, which keeps presenting
    // confirmatory own-feature questions (e.g. Q84/Q87/Q19 for A. myrzalina) even
    // after the species has already clinched #1.
    const newScores = scoreAllPure(answers, matrix);
    if (newScores.length > 0 && newScores[0].name === resultName &&
        (newScores.length < 2 || newScores[0].score >= newScores[1].score + 2)) {
      if ([...simCdQs].every(q => answers.has(q))) {
        // Refresh window so questions unlocked by the last answer are visible.
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

  // Store the Feature-Scoring path for every species (the card always renders
  // the faithful live sequence, so we don't skip "same as canonical" cases —
  // the live order differs from the plain tree walk for most species anyway,
  // and the live flow has no group markers).
  return simPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const treeData = JSON.parse(fs.readFileSync(TREE_PATH, 'utf8'));

  console.log('Building tree paths and feature matrix...');
  const pathsMap = buildTreePaths(treeData);
  const { matrix, qMeta, resultNotes } = buildFeatureMatrix(treeData, pathsMap);
  console.log(`  ${matrix.size} species, ${qMeta.size} questions`);

  const treeNodes = treeData.nodes;
  const qNumbers  = buildQuestionNumbers(treeData);

  const fsPaths = {};
  let hasPath = 0;

  // Iterate in DFS encounter order (stable across runs)
  const seenNames = new Set();
  for (const node of Object.values(treeNodes)) {
    if (node.type !== 'result' || !node.name || seenNames.has(node.name)) continue;
    seenNames.add(node.name);

    const canonicalAnswers = matrix.get(node.name);
    if (!canonicalAnswers) continue;

    const p = computeFeatureScoringPath(node.name, matrix, treeNodes, canonicalAnswers);
    if (p) { fsPaths[node.name] = p; hasPath++; }
  }

  console.log(`\nFeature Scoring paths: ${hasPath} of ${seenNames.size} species\n`);

  // Sample printout
  const sample = 'Arhopala moorei busa';
  if (fsPaths[sample]) {
    console.log(`=== Sample: ${sample} ===`);
    for (const s of fsPaths[sample]) {
      const qn = qNumbers.get(s.question) || '?';
      const cd = s.choice.startsWith('Cannot determine') ? ' [CD]' : '';
      console.log(`  Q${qn}: ${s.question.slice(0, 65)}${cd}`);
      console.log(`       -> ${s.choice.slice(0, 70)}`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(fsPaths, null, 2));
  console.log(`\nWrote ${Object.keys(fsPaths).length} paths to ${OUTPUT_PATH}`);
}

main();
