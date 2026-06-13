#!/usr/bin/env node
'use strict';
/**
 * Compute Simulation CD paths for all species via Feature Scoring simulation.
 *
 * For each species, simulates the Feature Scoring flow answering:
 *   • "Cannot determine" for any question about upperside features or spaces 1–3
 *   • The canonical answer for all other questions
 *
 * Outputs data/sim_cd_paths.json — a dict keyed by result name, each value a list
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
const OUTPUT_PATH = path.join(__dirname, '../data/sim_cd_paths.json');

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

// Set of result names reachable from a given node, following all branches.
function reachableResults(treeNodes, nodeId, visited = new Set()) {
  if (visited.has(nodeId)) return new Set();
  visited.add(nodeId);
  const node = treeNodes[nodeId];
  if (!node) return new Set();
  if (node.type === 'result') return new Set(node.name ? [node.name] : []);
  if (node.type === 'question') {
    const out = new Set();
    for (const c of (node.choices || [])) {
      if (!c.next) continue;
      for (const r of reachableResults(treeNodes, c.next, visited)) out.add(r);
    }
    return out;
  }
  if (node.type === 'group') {
    const out = new Set();
    if (node.next) for (const r of reachableResults(treeNodes, node.next, visited)) out.add(r);
    if (node.member_results) for (const rid of node.member_results) {
      const rn = treeNodes[rid];
      if (rn && rn.name) out.add(rn.name);
    }
    return out;
  }
  return new Set();
}

// Walk forward from a group/question node using resultName's own canonical
// answers, collecting {group}/{question, choice} steps. Returns the step
// array only if the walk reaches a result node (a complete resolution);
// returns null if it dead-ends (e.g. no canonical answer recorded for the
// within-group differentiator), so the caller can leave the simulation alone.
function walkForwardCanonical(treeNodes, startId, canonicalAnswers) {
  const steps = [];
  let current = startId;
  while (current) {
    const node = treeNodes[current];
    if (!node) return null;
    if (node.type === 'result') return steps;
    if (node.type === 'group') {
      steps.push({ group: node.group_name });
      if (node.next) { current = node.next; continue; }
      if (node.member_results && node.member_results.length === 1) { current = node.member_results[0]; continue; }
      return null;
    }
    if (node.type === 'question') {
      const ans = canonicalAnswers.get(node.question);
      if (!ans) return null;
      const choice = (node.choices || []).find(c => c.label === ans);
      if (!choice) return null;
      steps.push({ question: node.question, choice: ans });
      current = choice.next || null;
      continue;
    }
    return null;
  }
  return null;
}

// democritus democritus/lycaenaria: Q31 (macular underside markings) is
// group-diagnostic for this pair — answering it "Yes" routes straight to
// g_democritus (size-2 group), triggering the group-confirmation early exit.
// It sorts late by coverage (cov 47, after Q70/Q71 at 59), so once Q70 has
// been answered, pull it forward to run immediately for this pair only —
// avoids reordering it for the ~44 other species that answer "No" to Q31.
const Q31_TEXT = 'Are the underside markings macular — composed of separated lines and dots rather than continuous solid bands?';
const Q70_TEXT = 'Is there a whitish streak on the hindwing underside running from the base of the dorsum to the apex?';
const DEMOCRITUS_NAMES = new Set(['Arhopala democritus democritus', 'Arhopala democritus lycaenaria']);

function computeSimCdPath(resultName, matrix, treeNodes, canonicalAnswers) {
  if (!canonicalAnswers || canonicalAnswers.size === 0) return null;

  // Build question → choices lookup so isSimCdQuestion can inspect CD choice labels
  const qChoicesMap = new Map();
  for (const node of Object.values(treeNodes)) {
    if (node.type === 'question' && !qChoicesMap.has(node.question))
      qChoicesMap.set(node.question, node.choices || []);
  }

  // Build sim-CD answers: replace sim-CD questions with their CD label
  const simAnswers = new Map();
  for (const [q, answer] of canonicalAnswers) {
    if (isSimCdQuestion(q, qChoicesMap.get(q))) {
      const cdLabel = getCdLabel(treeNodes, q);
      simAnswers.set(q, cdLabel || answer);
    } else {
      simAnswers.set(q, answer);
    }
  }

  // Augment simAnswers with inferred answers for CD-followup questions.
  // When a sim-CD question Q has canonical answer C → node X, and Q's CD branch
  // leads to followup question F whose non-CD choice also → X, add that choice
  // for F.  This handles cases like Q88[CD] → Q89 (FW apex check): non-corinda
  // species answer Q88 "No" → Q80, so when Q88 is answered CD, we can infer
  // Q89 "No" (also → Q80) and include it in the sim path.
  for (const node of Object.values(treeNodes)) {
    if (node.type !== 'question') continue;
    const qText = node.question;
    if (!simAnswers.has(qText)) continue;
    if (!simAnswers.get(qText).startsWith('Cannot determine')) continue;
    const canonicalAns = canonicalAnswers.get(qText);
    if (!canonicalAns || canonicalAns.startsWith('Cannot determine')) continue;
    const canonicalChoice = (node.choices || []).find(c => c.label === canonicalAns);
    if (!canonicalChoice || !canonicalChoice.next) continue;
    const canonicalNext = canonicalChoice.next;
    const cdChoice = (node.choices || []).find(c => c.label && c.label.startsWith('Cannot determine'));
    if (!cdChoice || !cdChoice.next) continue;
    const followNode = treeNodes[cdChoice.next];
    if (!followNode || followNode.type !== 'question') continue;
    const followQText = followNode.question;
    if (simAnswers.has(followQText)) continue;
    // Don't pre-fill answers for follow questions that are themselves sim-CD
    if (isSimCdQuestion(followQText, followNode.choices || [])) continue;
    for (const fc of (followNode.choices || [])) {
      if (fc.next === canonicalNext && !(fc.label && fc.label.startsWith('Cannot determine'))) {
        simAnswers.set(followQText, fc.label);
        break;
      }
    }
  }

  // Simulate Feature Scoring using the same functions as the browser
  const answers       = new Map();
  const questionOrder = [];           // mutable state for getDisplayQuestionsPure
  const simPath       = [];
  const simCdQs       = new Set([...simAnswers.entries()]
    .filter(([, a]) => a.startsWith('Cannot determine')).map(([q]) => q));

  for (let step = 0; step < 50; step++) {
    const scores = scoreAllPure(answers, matrix);
    getDisplayQuestionsPure(answers, scores, matrix, treeNodes, questionOrder);

    // Pull Q31 forward to right after Q70 for the democritus pair (see comment above).
    if (DEMOCRITUS_NAMES.has(resultName) && answers.has(Q70_TEXT) && !answers.has(Q31_TEXT)) {
      const q70Idx = questionOrder.indexOf(Q70_TEXT);
      const q31Idx = questionOrder.indexOf(Q31_TEXT);
      if (q70Idx !== -1 && q31Idx > q70Idx + 1) {
        questionOrder.splice(q31Idx, 1);
        questionOrder.splice(q70Idx + 1, 0, Q31_TEXT);
      }
    }

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
      // the non-"Yes" choice — the answer a specimen of resultName would give
      // for a feature it does not possess — and keep the simulation moving.
      const choices = qChoicesMap.get(q) || [];
      if (choices.length >= 2) {
        const noChoice = choices.find(c => !c.label.startsWith('Yes')) || choices[0];
        nextQ = q; nextAns = noChoice.label; break;
      }
    }
    if (nextQ === null) break;

    answers.set(nextQ, nextAns);
    simPath.push({ question: nextQ, choice: nextAns });

    // Group-confirmation early exit: if this (non-CD) answer routes, in the
    // tree, to a group whose total reachable result set is small (<=2) and
    // contains resultName, the tree has already deterministically narrowed
    // to resultName and at most one sibling — the remaining Feature Scoring
    // questions are moot. Finish resultName's own canonical path through
    // that group (the within-group differentiator) and stop.
    let groupExit = false;
    if (!nextAns.startsWith('Cannot determine')) for (const node of Object.values(treeNodes)) {
      if (node.type !== 'question' || node.question !== nextQ) continue;
      const choice = (node.choices || []).find(c => c.label === nextAns);
      if (!choice || !choice.next) continue;
      const target = treeNodes[choice.next];
      if (!target || target.type !== 'group') continue;
      const reachable = reachableResults(treeNodes, choice.next);
      if (reachable.size <= 2 && reachable.has(resultName)) {
        const ext = walkForwardCanonical(treeNodes, choice.next, canonicalAnswers);
        if (ext) {
          simPath.push(...ext);
          groupExit = true;
          break;
        }
      }
    }
    if (groupExit) break;

    // Stop once species is uniquely #1 by at least 2 points and all sim-CD questions answered.
    // After the gap >= 2 threshold is met, also continue if the species hasn't reached its
    // maximum possible score yet AND there are still unanswered own-feature questions visible
    // in the window. This ensures that confirmatory features (e.g. Q38–Q41 for A. agaba) are
    // included without inflating paths for species already at max score.
    const newScores = scoreAllPure(answers, matrix);
    if (newScores.length > 0 && newScores[0].name === resultName &&
        (newScores.length < 2 || newScores[0].score >= newScores[1].score + 2)) {
      if ([...simCdQs].every(q => answers.has(q))) {
        const atMax = newScores[0].score >= newScores[0].max;
        if (atMax) break;
        // Refresh window so questions unlocked by the last answer are visible.
        getDisplayQuestionsPure(answers, newScores, matrix, treeNodes, questionOrder);
        const ownLeft = questionOrder
          .filter(q => !answers.has(q)).slice(0, 15)
          .filter(q => simAnswers.has(q)).length;
        if (ownLeft === 0) break;
      }
    }
  }

  if (simPath.length === 0) return null;

  // If identical to the direct canonical path, nothing to show
  const canonicalPath = simPath
    .filter(s => canonicalAnswers.has(s.question))
    .map(s => ({ question: s.question, choice: canonicalAnswers.get(s.question) }));
  if (JSON.stringify(simPath) === JSON.stringify(canonicalPath)) return null;

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

  const simCdPaths = {};
  let hasPath = 0;

  // Iterate in DFS encounter order (stable across runs)
  const seenNames = new Set();
  for (const node of Object.values(treeNodes)) {
    if (node.type !== 'result' || !node.name || seenNames.has(node.name)) continue;
    seenNames.add(node.name);

    const canonicalAnswers = matrix.get(node.name);
    if (!canonicalAnswers) continue;

    const p = computeSimCdPath(node.name, matrix, treeNodes, canonicalAnswers);
    if (p) { simCdPaths[node.name] = p; hasPath++; }
  }

  console.log(`\nSim-CD paths: ${hasPath} of ${seenNames.size} species\n`);

  // Sample printout
  const sample = 'Arhopala major major';
  if (simCdPaths[sample]) {
    console.log(`=== Sample: ${sample} ===`);
    for (const s of simCdPaths[sample]) {
      const qn = qNumbers.get(s.question) || '?';
      const cd = s.choice.startsWith('Cannot determine') ? ' [CD]' : '';
      console.log(`  Q${qn}: ${s.question.slice(0, 65)}${cd}`);
      console.log(`       -> ${s.choice.slice(0, 70)}`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(simCdPaths, null, 2));
  console.log(`\nWrote ${Object.keys(simCdPaths).length} paths to ${OUTPUT_PATH}`);
}

main();
