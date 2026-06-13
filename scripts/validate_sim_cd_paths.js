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
    for (const [q, c] of Object.entries(rf)) {
      if (c.startsWith('Cannot determine')) { features.delete(q); }
      else {
        if (!features.has(q)) qCov.set(q, (qCov.get(q) || 0) + 1);
        features.set(q, c);
      }
    }
    matrix.set(name, features);
  }
  return { matrix, qMeta, qCov, resultNotes };
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
// (must stay in sync with compute_sim_cd_paths.js)
const Q31_TEXT = 'Are the underside markings macular — composed of separated lines and dots rather than continuous solid bands?';
const Q70_TEXT = 'Is there a whitish streak on the hindwing underside running from the base of the dorsum to the apex?';
const DEMOCRITUS_NAMES = new Set(['Arhopala democritus democritus', 'Arhopala democritus lycaenaria']);

function computeSimCdPath(resultName, matrix, treeNodes, canonicalAnswers) {
  if (!canonicalAnswers || canonicalAnswers.size === 0) return null;

  const qChoicesMap = new Map();
  for (const node of Object.values(treeNodes)) {
    if (node.type === 'question' && !qChoicesMap.has(node.question))
      qChoicesMap.set(node.question, node.choices || []);
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
    if (isSimCdQuestion(followQText, followNode.choices || [])) continue;
    for (const fc of (followNode.choices || [])) {
      if (fc.next === canonicalNext && !(fc.label && fc.label.startsWith('Cannot determine'))) {
        simAnswers.set(followQText, fc.label);
        break;
      }
    }
  }

  const answers       = new Map();
  const questionOrder = [];
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

    // Group-confirmation early exit (must stay in sync with compute_sim_cd_paths.js).
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

    const newScores = scoreAllPure(answers, matrix);
    if (newScores.length > 0 && newScores[0].name === resultName &&
        (newScores.length < 2 || newScores[0].score >= newScores[1].score + 2)) {
      if ([...simCdQs].every(q => answers.has(q))) {
        const atMax = newScores[0].score >= newScores[0].max;
        if (atMax) break;
        getDisplayQuestionsPure(answers, newScores, matrix, treeNodes, questionOrder);
        const ownLeft = questionOrder
          .filter(q => !answers.has(q)).slice(0, 15)
          .filter(q => simAnswers.has(q)).length;
        if (ownLeft === 0) break;
      }
    }
  }

  if (simPath.length === 0) return null;

  const canonicalPath = simPath
    .filter(s => canonicalAnswers.has(s.question))
    .map(s => ({ question: s.question, choice: canonicalAnswers.get(s.question) }));
  if (JSON.stringify(simPath) === JSON.stringify(canonicalPath)) return null;

  return simPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const treeData = JSON.parse(fs.readFileSync(TREE_PATH, 'utf8'));
  const stored   = JSON.parse(fs.readFileSync(STORED_PATH, 'utf8'));
  const qNumbers = buildQuestionNumbers(treeData);

  const pathsMap   = buildTreePaths(treeData);
  const { matrix } = buildFeatureMatrix(treeData, pathsMap);
  const treeNodes  = treeData.nodes;

  let pass = 0, fail = 0;
  const failures = [];

  // All species in either computed or stored set
  const allNames = new Set([...matrix.keys(), ...Object.keys(stored)]);

  for (const name of allNames) {
    const canonicalAnswers = matrix.get(name);
    const live = canonicalAnswers
      ? computeSimCdPath(name, matrix, treeNodes, canonicalAnswers)
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
