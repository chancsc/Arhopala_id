#!/usr/bin/env node
'use strict';
/**
 * Trace Feature Scoring flow step by step for a species and compare
 * against its stored sim_cd path.
 * Usage: node scripts/trace_scoring.js "Arhopala myrzala lammas"
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

const treeData   = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/tree.json')));
const simCdPaths = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/sim_cd_paths.json')));

// ── Build feature matrix (same as compute_sim_cd_paths.js) ────────────────────
function buildFeatureMatrix(treeData, pathsMap) {
  const nodes          = treeData.nodes;
  const resultFeatures = new Map();
  const resultNotes    = new Map();
  const qCov           = new Map();

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
  return { matrix, qCov };
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

// ── Main ──────────────────────────────────────────────────────────────────────
const targetArg = process.argv[2];
if (!targetArg) { console.error('Usage: node trace_scoring.js "<species name>"'); process.exit(1); }

const pathsMap = buildTreePaths(treeData);
const { matrix } = buildFeatureMatrix(treeData, pathsMap);
const qNumbers   = buildQuestionNumbers(treeData);
const treeNodes  = treeData.nodes;

// Question → choices lookup so isSimCdQuestion can inspect CD choice labels
const questionChoicesMap = new Map();
for (const node of Object.values(treeNodes)) {
  if (node.type === 'question' && !questionChoicesMap.has(node.question))
    questionChoicesMap.set(node.question, node.choices || []);
}

// Find species (case-insensitive partial match)
const targetName = [...matrix.keys()].find(n => n.toLowerCase().includes(targetArg.toLowerCase()));
if (!targetName) {
  console.error(`Species not found: ${targetArg}`);
  console.error('Available:', [...matrix.keys()].filter(n => n.toLowerCase().includes('arho')).slice(0,5));
  process.exit(1);
}

const canonicalAnswers = matrix.get(targetName);
console.log(`\n=== Tracing Feature Scoring for: ${targetName} ===`);
console.log(`Canonical features: ${canonicalAnswers.size} questions\n`);

// Build sim-CD answer map
const simAnswers = new Map();
for (const [q, ans] of canonicalAnswers) {
  if (isSimCdQuestion(q, questionChoicesMap.get(q))) {
    const cd = getCdLabel(treeNodes, q);
    simAnswers.set(q, cd || ans);
  } else {
    simAnswers.set(q, ans);
  }
}

// Load stored path early so window-question fallback can use it during simulation
const stored        = simCdPaths[targetName];
const storedAnswerMap = new Map((stored || []).map(s => [s.question, s.choice]));

// Simulate step by step
const answers       = new Map();
const questionOrder = [];
const simPath       = [];
// Track sim-CD questions encountered during simulation (mirrors compute_sim_cd_paths.js)
const simCdQs = new Set([...simAnswers.entries()]
  .filter(([, a]) => a.startsWith('Cannot determine')).map(([q]) => q));

for (let step = 0; step < 50; step++) {
  const scores = scoreAllPure(answers, matrix);
  getDisplayQuestionsPure(answers, scores, matrix, treeNodes, questionOrder);

  // Pull Q31 forward to right after Q70 for the democritus pair (see comment above).
  if (DEMOCRITUS_NAMES.has(targetName) && answers.has(Q70_TEXT) && !answers.has(Q31_TEXT)) {
    const q70Idx = questionOrder.indexOf(Q70_TEXT);
    const q31Idx = questionOrder.indexOf(Q31_TEXT);
    if (q70Idx !== -1 && q31Idx > q70Idx + 1) {
      questionOrder.splice(q31Idx, 1);
      questionOrder.splice(q70Idx + 1, 0, Q31_TEXT);
    }
  }

  // Stop once species is uniquely #1 AND all sim-CD questions have been answered.
  // After gap >= 2, also continue while own canonical features remain in the window
  // and the species hasn't reached max score (prevents premature stops like Q34 for agaba).
  if (scores.length > 0 && scores[0].name === targetName &&
      (scores.length < 2 || scores[0].score >= scores[1].score + 2)) {
    if ([...simCdQs].every(q => answers.has(q))) {
      const atMax = scores[0].score >= scores[0].max;
      const ownLeft = atMax ? 0 : questionOrder
        .filter(q => !answers.has(q)).slice(0, 15)
        .filter(q => simAnswers.has(q)).length;
      if (atMax || ownLeft === 0) {
        const rank2 = scores[1] ? `  #2: ${scores[1].name.replace('Arhopala ','')} ${scores[1].score}/${scores[1].max}` : '';
        console.log(`  → STOP: ${targetName.replace('Arhopala ','')} is #1 (${scores[0].score}/${scores[0].max})${rank2}`);
        break;
      }
    }
  }

  // Find next answerable question in the window (cap 15).
  // For questions that appear in the window but are not in this species' own
  // feature set (e.g. questions owned by neighbouring candidates), look up the
  // answer in the stored sim_cd path so the simulation stays on-track.
  let nextQ = null, nextAns = null;
  let seen = 0;
  for (const q of questionOrder) {
    if (answers.has(q)) continue;
    if (++seen > 15) break;
    if (simAnswers.has(q)) { nextQ = q; nextAns = simAnswers.get(q); break; }
    if (isSimCdQuestion(q, questionChoicesMap.get(q))) {
      const cd = getCdLabel(treeNodes, q);
      if (cd) { nextQ = q; nextAns = cd; simCdQs.add(q); break; }
    }
    // Window question not in this species' features — use stored path answer if present
    if (storedAnswerMap.has(q)) { nextQ = q; nextAns = storedAnswerMap.get(q); break; }
    // Orphan question: neither choice changes this species' own score (see
    // compute_sim_cd_paths.js). Default to the non-"Yes" choice so the
    // simulation keeps moving, matching the live page which keeps presenting
    // questions until the window is exhausted.
    const choices = questionChoicesMap.get(q) || [];
    if (choices.length >= 2) {
      const noChoice = choices.find(c => !c.label.startsWith('Yes')) || choices[0];
      nextQ = q; nextAns = noChoice.label; break;
    }
  }
  if (nextQ === null) { console.log('  (no more answerable questions in window)'); break; }

  answers.set(nextQ, nextAns);
  simPath.push({ question: nextQ, choice: nextAns });

  const rank = scores.findIndex(s => s.name === targetName) + 1;
  const qn   = qNumbers.get(nextQ) || '?';
  const cd   = nextAns.startsWith('Cannot determine') ? ' [CD]' : '';
  console.log(`Step ${step+1}  Q${qn}${cd}: ${nextQ.slice(0, 65)}`);
  console.log(`         -> ${nextAns.slice(0, 65)}`);
  const newScores = scoreAllPure(answers, matrix);
  const newRank   = newScores.findIndex(s => s.name === targetName) + 1;
  console.log(`         (was #${rank} → now #${newRank})\n`);

  // Group-confirmation early exit (must stay in sync with compute_sim_cd_paths.js).
  let groupExit = false;
  if (!nextAns.startsWith('Cannot determine')) for (const node of Object.values(treeNodes)) {
    if (node.type !== 'question' || node.question !== nextQ) continue;
    const choice = (node.choices || []).find(c => c.label === nextAns);
    if (!choice || !choice.next) continue;
    const target = treeNodes[choice.next];
    if (!target || target.type !== 'group') continue;
    const reachable = reachableResults(treeNodes, choice.next);
    if (reachable.size <= 2 && reachable.has(targetName)) {
      const ext = walkForwardCanonical(treeNodes, choice.next, canonicalAnswers);
      if (ext) {
        simPath.push(...ext);
        for (const s of ext) {
          if (s.group) console.log(`  → [group: ${s.group}]`);
          else {
            const eqn = qNumbers.get(s.question) || '?';
            console.log(`  → Q${eqn}: ${s.question.slice(0, 65)}\n         -> ${s.choice.slice(0, 65)}`);
          }
        }
        console.log(`  → STOP: group-confirmation early exit (reachable result set <= 2, includes ${targetName.replace('Arhopala ','')})`);
        groupExit = true;
        break;
      }
    }
  }
  if (groupExit) break;
}

// Apply same canonical-equality suppression as compute_sim_cd_paths.js:
// if simPath is identical to the canonical path, treat it as null (nothing to show).
const canonicalPath = simPath
  .filter(s => canonicalAnswers.has(s.question))
  .map(s => ({ question: s.question, choice: canonicalAnswers.get(s.question) }));
const live = JSON.stringify(simPath) === JSON.stringify(canonicalPath) ? null : simPath;

// Compare with stored sim_cd path
console.log('\n=== Stored sim_cd path ===');
if (!stored) {
  console.log('  (none stored)');
} else {
  stored.forEach((s, i) => {
    if (s.group) { console.log(`  ${i+1}. [group: ${s.group}]`); return; }
    const qn = qNumbers.get(s.question) || '?';
    const cd = s.choice.startsWith('Cannot determine') ? ' [CD]' : '';
    console.log(`  ${i+1}. Q${qn}${cd}: ${s.question.slice(0,65)}`);
    console.log(`       -> ${s.choice.slice(0,65)}`);
  });
}

console.log('\n=== Comparison ===');
const maxLen = Math.max(live ? live.length : 0, stored ? stored.length : 0);
let match = true;
if (maxLen === 0) {
  console.log('  (both null — no sim-CD difference for this species)');
} else {
  for (let i = 0; i < maxLen; i++) {
    const l = live   ? live[i]   : null;
    const s = stored ? stored[i] : null;
    const lKey = l ? (l.group ? `[group: ${l.group}]` : `Q${qNumbers.get(l.question)||'?'} ${l.choice.slice(0,30)}`) : '(missing)';
    const sKey = s ? (s.group ? `[group: ${s.group}]` : `Q${qNumbers.get(s.question)||'?'} ${s.choice.slice(0,30)}`) : '(missing)';
    const ok = !!l && !!s && (l.group ? l.group === s.group : (l.question === s.question && l.choice === s.choice));
    if (!ok) match = false;
    console.log(`  Step ${i+1}: live=[${lKey}]  stored=[${sKey}]  ${ok ? '✓' : '✗ MISMATCH'}`);
  }
}
if (match) console.log('\n  ✓ Paths match exactly');
else        console.log('\n  ✗ Paths differ — stored sim_cd path needs updating');
