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

function computeSimCdPath(resultName, matrix, treeNodes, canonicalAnswers) {
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

  // NOTE: no CD-followup answer inference here. Pre-filling a followup question's
  // answer (because its sim-CD parent was CD'd) made the stored path SKIP that
  // followup, but the live checklist still presents it — the underside-only user
  // can see the followup character and answers it in order. Inferring it ahead of
  // time desynced the stored path from the live flow (the systematic step-9
  // Q79/Q80 divergence). Instead, followup questions surface naturally in the
  // step loop below: on the species' own feature (simAnswers) or via the orphan
  // "doesn't-apply / No" default — matching exactly what the live user clicks.

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
      // a "doesn't apply here" choice — the answer a specimen of resultName
      // would give for a feature it does not possess — and keep the
      // simulation moving. For genuinely binary questions this is a real,
      // meaningful negative answer (e.g. "No — hindwing is tailless") and is
      // safe to show in the stored path. For multi-way classification
      // questions with no clear negative/not-applicable choice (e.g. "which
      // subgroup best fits the specimen?" with 5 mutually exclusive
      // subgroups), there is no sensible default — picking choices[0] would
      // fabricate an answer unrelated to the species' real morphology, so we
      // still pick it to keep the simulation progressing but suppress it from
      // the displayed path.
      const choices = qChoicesMap.get(q) || [];
      if (choices.length >= 2) {
        // Orphan default = the answer a specimen with none of the listed
        // characters gives live, and SHOW it (the live checklist shows it too):
        //   1. a "No"/"None" choice (genuinely binary), else
        //   2. the multi-way "none of these apply" choice that CONTINUES the key
        //      (its next is another question, not a result/group peel-off) — e.g.
        //      Q62 "Neither of these" continues the trunk, exactly what a live
        //      underside-only user with none of the listed characters clicks, else
        //   3. choices[0] as a last resort.
        // The live checklist SHOWS every question in the window, so to stay
        // faithful we show whatever we pick here too (the earlier attempt to
        // suppress the case-3 classification fallback desynced A. major, whose
        // window genuinely includes such a question). Preference:
        //   1. a "No"/"None" choice (genuinely binary),
        //   2. the "none of these apply" choice that CONTINUES the trunk (its
        //      next is another question) — e.g. Q62 "Neither of these", exactly
        //      what a live underside-only user with none of the characters clicks,
        //   3. choices[0] as a last resort for a pure classification orphan.
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
