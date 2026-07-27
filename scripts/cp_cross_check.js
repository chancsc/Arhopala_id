#!/usr/bin/env node
/**
 * Systematic C&P key vs Feature Scoring cross-check.
 *
 * For each species, walks their C&P key path (id_key.json species_paths),
 * translates each lead number into an expected FS question answer, then
 * compares against the species' actual feature matrix (canonical path +
 * result-node overrides from tree.json).  Mismatches are reported.
 *
 * Usage:
 *   node scripts/cp_cross_check.js
 *   node scripts/cp_cross_check.js "Arhopala acta"    # single species
 *   node scripts/cp_cross_check.js --all              # include "match" rows too
 */

'use strict';
const fs = require('fs');
const path = require('path');
const pu = require('../js/path-utils.js');

const args = process.argv.slice(2);
const targetSpecies = args.find(a => !a.startsWith('--'));
const showAll = args.includes('--all');

const tree = JSON.parse(fs.readFileSync('data/tree.json', 'utf8'));
const idKey = JSON.parse(fs.readFileSync('data/id_key.json', 'utf8'));
const nodes = tree.nodes;

// ── Build question numbers (DFS order) ─────────────────────────────────────
const qNums = pu.buildQuestionNumbers(tree);
const numToQ = new Map([...qNums.entries()].map(([q, n]) => [n, q]));

// ── Build lead→couplet map ──────────────────────────────────────────────────
// leadToCouplet[lead] = { idx, side:'A'|'B', label:'K1'..., aText, bText }
const leadToCouplet = {};
for (let i = 0; i < idKey.couplets.length; i++) {
  const cp = idKey.couplets[i];
  const base = { idx: i, label: cp.label, aText: cp.a_text, bText: cp.b_text };
  leadToCouplet[cp.num_a] = { ...base, side: 'A', sideText: cp.a_text };
  leadToCouplet[cp.num_b] = { ...base, side: 'B', sideText: cp.b_text };
}

// ── C&P lead → expected FS answer ──────────────────────────────────────────
// Format: leadNumber → [ { qSub: substring of FS question, aSub: substring of expected answer } ]
// qSub is matched case-insensitively against the full FS question text.
// aSub is matched case-insensitively against the stored choice text.
// Multiple entries are supported for leads that imply multiple FS facts.
const LEAD_TO_EXPECTED = {
  // K1: tail at vein 3?
  1:   [{ qSub: 'tail located at vein 3',            aSub: 'No — tail at the usual vein 2' }],
  212: [{ qSub: 'tail located at vein 3',            aSub: 'Yes — short white-tipped tail at vein 3' }],

  // K6 B: HW spot 6 widely out of line (touching/overlapping bar)
  // Only B is reliable; K6-A covers the whole echelon group including sub-cases
  95:  [{ qSub: 'postdiscal spot in space 6 positioned roughly midway',
          aSub: 'No — spot 6 displaced past midway' }],

  // K8: tailless vs tailed (within echelon branch – still definitive for Q1)
  11:  [{ qSub: 'Does the hindwing have a tail',      aSub: 'No — hindwing is tailless' }],
  16:  [{ qSub: 'Does the hindwing have a tail',      aSub: 'Yes — hindwing is tailed' }],

  // K11: FW spot at base of space 10 (within epimuta branch)
  17:  [{ qSub: 'spot at the extreme base of forewing underside space 10',
          aSub: 'No — no spot at extreme base' }],
  18:  [{ qSub: 'spot at the extreme base of forewing underside space 10',
          aSub: 'Yes — spot present at extreme base' }],

  // K12: FW postdiscal band only partially vs completely dislocated at vein 4
  19:  [{ qSub: 'postdiscal band only partially dislocated at vein 4',  aSub: 'Yes' }],
  22:  [{ qSub: 'postdiscal band only partially dislocated at vein 4',  aSub: 'No' }],

  // K14: FW dark area under cell = FW space 1b dark patch
  24:  [{ qSub: 'restricted dark patch in FW space 1b', aSub: 'Yes — restricted dark patch present' }],
  45:  [{ qSub: 'restricted dark patch in FW space 1b', aSub: 'No — no dark patch present' }],

  // K15: HW without vs with spot at extreme base of space 6 (or mid-space 8)
  25:  [{ qSub: 'spot at the extreme base of hindwing space 6',  aSub: 'No' }],
  // lead 40 includes "OR mid-space 8", so only flag if Q95 explicitly says No:
  // 40 → Q95 = Yes is plausible; we skip it to avoid false positives

  // K23 B: explicitly without spot at extreme base of space 6
  44:  [{ qSub: 'spot at the extreme base of hindwing space 6',  aSub: 'No' }],

  // K34: HW cilia white spot in space 1a
  64:  [{ qSub: 'distinct white patch on the hindwing cilia',  aSub: 'Yes — white patch on HW cilia' }],
  71:  [{ qSub: 'distinct white patch on the hindwing cilia',  aSub: 'No — no white patch' }],

  // K56: HW spot 6 outwardly concave vs straight
  102: [{ qSub: 'outer edge of hindwing postdiscal spot 6 outwardly concave',
          aSub: 'Yes — outer edge of spot 6 outwardly concave' }],
  103: [{ qSub: 'outer edge of hindwing postdiscal spot 6 outwardly concave',
          aSub: 'No — outer edge of spot 6 outwardly straight' }],

  // K57: FW spot at extreme base of space 10 (within widely-out-of-line branch)
  104: [{ qSub: 'spot at the extreme base of forewing underside space 10',
          aSub: 'No — no spot at extreme base' }],
  113: [{ qSub: 'spot at the extreme base of forewing underside space 10',
          aSub: 'Yes — spot present at extreme base' }],

  // K97: tail 5 mm vs 3 mm (within eumolphus/aedias group)
  183: [{ qSub: 'tail very long and thread-like',  aSub: 'Yes — tail very long' }],
  184: [{ qSub: 'tail very long and thread-like',  aSub: 'No — tail moderate or typical' }],

  // K101: tail filamentous 3.5 mm vs short stout ~2 mm (corinda vs aurea group)
  192: [{ qSub: 'hindwing tail long and filamentous',  aSub: 'Long and filamentous, about 3.5 mm' }],
  193: [{ qSub: 'hindwing tail long and filamentous',  aSub: 'Short and stout, just under 2 mm' }],

  // K102: markings complete vs incomplete
  201: [{ qSub: 'Are the underside markings almost entirely suppressed',  aSub: 'Yes' }],
  194: [{ qSub: 'Are the underside markings almost entirely suppressed',  aSub: 'No' }],
};

// ── Build result node map ─────────────────────────────────────────────────
// Match result node IDs (r_acta, r_ace_ace, …) to FS species names.
// Strategy: strip "r_" prefix, replace "_" with " " → "acta", "ace ace", …
// Then find the FS species whose simplified name matches or starts-with the base.
function buildResultNodeMap(fsSpeciesNames) {
  const m = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (node.type !== 'result') continue;
    const base = id.replace(/^r_/, '').replace(/_/g, ' ').toLowerCase();
    const match = fsSpeciesNames.find(sp => {
      const sp2 = sp.replace(/^Arhopala /, '').toLowerCase();
      return sp2 === base || sp2.startsWith(base + ' ') || base.startsWith(sp2 + ' ') ||
             sp2 === base.replace(/ /g, '');
    });
    if (match) m[match] = id;
  }
  return m;
}

// Build feature matrix: canonical path answers + result-node features overrides
function buildFeatureMatrix(speciesName, resultNodeMap) {
  const paths = pathsMap.get(speciesName);
  if (!paths || paths.length === 0) return null;

  const canonRaw = pu.pickCanonicalPath(paths, '', {}) || [];
  const featureMap = new Map();

  for (const { question: q, choice: c, group } of canonRaw) {
    if (q && c && !c.startsWith('Cannot determine') && !group) {
      if (!featureMap.has(q)) featureMap.set(q, c);
    }
  }

  const resultNodeId = resultNodeMap[speciesName];
  if (resultNodeId) {
    const rNode = nodes[resultNodeId];
    const feats = rNode ? (rNode.features || {}) : {};
    for (const [q, val] of Object.entries(feats)) {
      if (!val || val.startsWith('Cannot determine')) {
        featureMap.delete(q);
      } else {
        featureMap.set(q, val); // override or add
      }
    }
  }

  return featureMap;
}

// ── Main ───────────────────────────────────────────────────────────────────
const pathsMap = pu.buildTreePaths(tree);
const speciesNames = [...pathsMap.keys()];

console.log('Building result node map...');
const resultNodeMap = buildResultNodeMap(speciesNames);

console.log('Ready. Checking ' + speciesNames.length + ' species...');

// Map FS question substring → full question text (for lookup)
const allQTexts = [...qNums.keys()];

function findQText(qSub) {
  const sub = qSub.toLowerCase();
  return allQTexts.find(q => q.toLowerCase().includes(sub));
}

// Precompute full question texts for all LEAD_TO_EXPECTED entries
const leadToFull = {};
for (const [lead, entries] of Object.entries(LEAD_TO_EXPECTED)) {
  leadToFull[lead] = entries.map(e => {
    const fullQ = findQText(e.qSub);
    return { ...e, fullQ };
  });
}

let totalChecked = 0;
let totalMismatches = 0;
const report = [];

const speciesToCheck = targetSpecies
  ? speciesNames.filter(n => n.toLowerCase().includes(targetSpecies.toLowerCase()))
  : speciesNames;

if (speciesToCheck.length === 0) {
  console.log('No species matched: ' + targetSpecies);
  process.exit(1);
}

for (const spName of speciesToCheck) {
  // Find in id_key.json — may be stored without subspecies
  const cpName = Object.keys(idKey.species_paths).find(k =>
    k.toLowerCase() === spName.toLowerCase() ||
    spName.toLowerCase().startsWith(k.toLowerCase() + ' ') ||
    k.toLowerCase().startsWith(spName.toLowerCase() + ' ')
  );

  const cpPath = cpName ? idKey.species_paths[cpName] : null;
  if (!cpPath) continue; // Species not in C&P key (group placeholder, etc.)

  const featureMap = buildFeatureMatrix(spName, resultNodeMap);
  if (!featureMap) continue;

  const spReport = [];

  for (const lead of cpPath) {
    const expectations = leadToFull[lead];
    if (!expectations) continue;

    const couplet = leadToCouplet[lead];
    const kLabel = couplet ? couplet.label : '?';

    for (const { qSub, aSub, fullQ } of expectations) {
      if (!fullQ) {
        // Question not found in FS tree — note it
        if (showAll) {
          spReport.push({ status: 'NOQS', kLabel, lead, qSub, aSub, stored: null });
        }
        continue;
      }

      totalChecked++;
      const storedAnswer = featureMap.get(fullQ);
      const aSubLc = aSub.toLowerCase();

      if (!storedAnswer) {
        // Question not in feature matrix at all — might be OK (question not applicable)
        // but flag it for awareness
        if (showAll) {
          spReport.push({ status: 'ABSENT', kLabel, lead, qSub: fullQ.substring(0,70), aSub, stored: null });
        }
        continue;
      }

      const storedLc = storedAnswer.toLowerCase();
      const matches = storedLc.includes(aSubLc) || aSubLc.includes(storedLc.substring(0, 30));

      if (!matches) {
        totalMismatches++;
        spReport.push({
          status: 'MISMATCH',
          kLabel,
          lead,
          q: fullQ.substring(0, 80),
          expected: aSub,
          stored: storedAnswer.substring(0, 100),
        });
      } else if (showAll) {
        spReport.push({
          status: 'OK',
          kLabel,
          lead,
          q: fullQ.substring(0, 80),
          expected: aSub,
          stored: storedAnswer.substring(0, 100),
        });
      }
    }
  }

  if (spReport.length > 0) {
    report.push({ species: spName, cpName, checks: spReport });
  }
}

// ── Print report ───────────────────────────────────────────────────────────
if (report.length === 0) {
  console.log('\n✓ All C&P checks passed! (' + totalChecked + ' comparisons, 0 mismatches)\n');
} else {
  const mismatches = report.filter(r => r.checks.some(c => c.status === 'MISMATCH'));
  console.log('\n══ C&P Cross-Check Report ══════════════════════════════════════');
  console.log('Total comparisons: ' + totalChecked + ' | Mismatches: ' + totalMismatches);
  console.log('');

  for (const { species, cpName, checks } of report) {
    const hasMismatch = checks.some(c => c.status === 'MISMATCH');
    if (!hasMismatch && !showAll) continue;

    console.log('  ' + species + (cpName !== species ? ' (key: ' + cpName + ')' : ''));
    for (const c of checks) {
      const prefix = c.status === 'MISMATCH' ? '  ✗ MISMATCH' :
                     c.status === 'ABSENT'   ? '  · absent  ' :
                     c.status === 'NOQS'     ? '  ? noFSQ   ' :
                                               '  ✓ ok      ';
      if (c.status === 'MISMATCH') {
        console.log(prefix + ' [' + c.kLabel + '/lead' + c.lead + ']');
        console.log('       Q: ' + c.q);
        console.log('       C&P expects: ' + c.expected);
        console.log('       FS has:      ' + c.stored);
      } else if (showAll) {
        console.log(prefix + ' [' + c.kLabel + '/lead' + c.lead + '] ' +
          (c.q || c.qSub || '').substring(0, 60));
      }
    }
    console.log('');
  }
}

// Also print any species where C&P says something that contradicts feature matrix
// Final summary
console.log('══ Summary ═══════════════════════════════════════════════════════');
console.log('Species checked: ' + speciesToCheck.filter(n =>
  Object.keys(idKey.species_paths).some(k =>
    k.toLowerCase() === n.toLowerCase() ||
    n.toLowerCase().startsWith(k.toLowerCase() + ' ') ||
    k.toLowerCase().startsWith(n.toLowerCase() + ' ')
  )).length);
console.log('FS comparisons:  ' + totalChecked);
console.log('Mismatches:      ' + totalMismatches);
if (totalMismatches === 0) console.log('\n✓ All checked entries agree with C&P.\n');
else console.log('\n✗ ' + totalMismatches + ' mismatch(es) require investigation.\n');
