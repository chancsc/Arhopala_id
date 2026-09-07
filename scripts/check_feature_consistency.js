#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Feature-consistency checker
//
// Detects two classes of bug that cause script-vs-browser divergence:
//
//  [ORPHAN]  A question appears in a species' FS sim path (feature_scoring_paths.json)
//            answered as a default (not a real feature). The script converges, but
//            the browser never answers that question — the species may mis-rank.
//            Fix: add the answer as an explicit result-node feature.
//
//  [CONTRADICT]  A result-node feature override gives a different answer than the
//                species' canonical tree path for the same question text.
//                Fix: verify which answer is biologically correct and reconcile.
//
// Usage:
//   node scripts/check_feature_consistency.js          # all species
//   node scripts/check_feature_consistency.js kurzi    # filter by name fragment
//   node scripts/check_feature_consistency.js --orphans-only
//   node scripts/check_feature_consistency.js --contradictions-only
//
// Exit code 0 always (advisory only — does not block CI).
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const pu   = require(path.join(REPO, 'js', 'path-utils.js'));

// ── Load data ────────────────────────────────────────────────────────────────
const tree     = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'tree.json')));
const nodes    = tree.nodes;
const simPaths = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'feature_scoring_paths.json')));
const pathsMap = pu.buildTreePaths(tree);

// Build maps from tree
const resultNotes = new Map(), rfMap = new Map();
for (const node of Object.values(nodes)) {
  if (node.type === 'result' && node.name) {
    resultNotes.set(node.name, node.note || '');
    if (node.features) rfMap.set(node.name, node.features);
  }
}

// ── Parse CLI ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const orphansOnly       = args.includes('--orphans-only');
const contradictOnly    = args.includes('--contradictions-only');
const filterFragments   = args.filter(a => !a.startsWith('--'));

// ── Build real feature matrix for a species (mirrors buildAnswers in fs_regress) ─
function buildRealFeats(name) {
  const paths = pathsMap.get(name);
  if (!paths) return null;
  const note = resultNotes.get(name) || '';
  const rf   = rfMap.get(name) || {};
  const canonical = pu.pickCanonicalPath(paths, note, rf) || [];

  const feats = new Map();
  for (const step of canonical)
    if (step.question && step.choice && !step.choice.startsWith('Cannot determine'))
      feats.set(step.question, step.choice);
  for (const [q, c] of Object.entries(rf)) {
    if (c.startsWith('Cannot determine')) feats.delete(q);
    else feats.set(q, c);
  }
  return feats;
}

// ── Build canonical path answers (tree-walk only, no rf override) ────────────
function buildCanonicalPathAnswers(name) {
  const paths = pathsMap.get(name);
  if (!paths) return null;
  const note = resultNotes.get(name) || '';
  const rf   = rfMap.get(name) || {};
  const canonical = pu.pickCanonicalPath(paths, note, rf) || [];

  const pathAnswers = new Map(); // question → LAST choice on canonical path
  for (const step of canonical)
    if (step.question && step.choice)
      pathAnswers.set(step.question, step.choice);
  return pathAnswers;
}

// ── Main analysis ─────────────────────────────────────────────────────────────
const allNames = [...pathsMap.keys()];
const names = filterFragments.length
  ? allNames.filter(n => filterFragments.some(f => n.toLowerCase().includes(f.toLowerCase())))
  : allNames;

let orphanCount = 0, contradictCount = 0;
const orphanFindings = [], contradictFindings = [];

for (const name of names) {
  const simPath = simPaths[name];
  if (!simPath) continue;

  const realFeats = buildRealFeats(name);
  if (!realFeats) continue;

  const rf = rfMap.get(name) || {};
  const pathAnswers = buildCanonicalPathAnswers(name);
  if (!pathAnswers) continue;

  // ── [ORPHAN] check ──────────────────────────────────────────────────────────
  // Each step in the FS sim path should have a real feature backing it.
  // If not, it was answered as an orphan default → browser won't answer it.
  if (!orphansOnly || !contradictOnly) {
    for (const step of simPath) {
      const q = step.question;
      const c = step.choice;
      if (!q || !c || c.startsWith('Cannot determine')) continue;
      if (!realFeats.has(q)) {
        orphanCount++;
        orphanFindings.push({ name, question: q, simAnswer: c });
      }
    }
  }

  // ── [CONTRADICT] check ──────────────────────────────────────────────────────
  // A result-node feature that contradicts the canonical tree path answer for
  // the same question text.
  if (!orphansOnly) {
    for (const [q, rfAnswer] of Object.entries(rf)) {
      if (rfAnswer.startsWith('Cannot determine')) continue;
      const pathAnswer = pathAnswers.get(q);
      if (pathAnswer && pathAnswer !== rfAnswer && !pathAnswer.startsWith('Cannot determine')) {
        contradictCount++;
        contradictFindings.push({ name, question: q, pathAnswer, featureAnswer: rfAnswer });
      }
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
const showOrphans      = !contradictOnly;
const showContradicts  = !orphansOnly;

if (showOrphans) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`[ORPHAN] Questions in FS sim path but NOT in browser answer set`);
  console.log(`         These are answered by script default; browser leaves them blank.`);
  console.log(`         Fix: add the answer as an explicit result-node feature.`);
  console.log(`${'═'.repeat(72)}`);
  if (orphanFindings.length === 0) {
    console.log('  ✓ None found.');
  } else {
    // Group by question text for easy scanning
    const byQ = new Map();
    for (const f of orphanFindings) {
      if (!byQ.has(f.question)) byQ.set(f.question, []);
      byQ.get(f.question).push(f);
    }
    for (const [q, entries] of byQ) {
      console.log(`\n  Q: ${q.substring(0, 90)}`);
      for (const e of entries) {
        console.log(`     ${e.name.replace('Arhopala ', '')}`);
        console.log(`       sim answer: "${e.simAnswer.substring(0, 70)}"`);
      }
    }
  }
  console.log(`\n  Total orphan-in-sim findings: ${orphanCount}`);
}

if (showContradicts) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`[CONTRADICT] Result-node feature contradicts canonical tree-path answer`);
  console.log(`             Both answers exist; likely one is biologically wrong.`);
  console.log(`             Fix: verify C&P and reconcile tree path or feature.`);
  console.log(`${'═'.repeat(72)}`);
  if (contradictFindings.length === 0) {
    console.log('  ✓ None found.');
  } else {
    for (const f of contradictFindings) {
      console.log(`\n  ${f.name}`);
      console.log(`  Q: ${f.question.substring(0, 90)}`);
      console.log(`     tree path says: "${f.pathAnswer.substring(0, 70)}"`);
      console.log(`     feature says:   "${f.featureAnswer.substring(0, 70)}"`);
    }
  }
  console.log(`\n  Total contradiction findings: ${contradictCount}`);
}

console.log('');
