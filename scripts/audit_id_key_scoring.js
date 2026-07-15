#!/usr/bin/env node
'use strict';
/**
 * Audit the C&P Key SCORING (not just navigation): replay every species' stored
 * key path, score each answered couplet exactly as the live page does
 * (js/id_keys.js ksScoreAll + sort), and assert the species ends up ranked #1.
 *
 * Also reports, for every couplet on a path that can be Skipped (upperside or
 * skippable), what rank the species falls to if that couplet is skipped instead
 * of answered — so a change that makes an important couplet skippable can't
 * silently drop a species out of the top spot unnoticed.
 *
 * Run after ANY change to data/id_key.json (or the scripts that build it):
 *   node scripts/audit_id_key_scoring.js
 * Exit code 0 = every species reaches #1 on its full path.
 */
const fs = require('fs');
const path = require('path');

const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'id_key.json'), 'utf8'));
const leads = d.leads, couplets = d.couplets;
const present = t => leads[String(t)] !== undefined;
const isTerminal = t => (leads[String(t)] || '').includes('Arhopala');
const coupletNodes = new Set(couplets.map(c => c.num_a));
const cpByNode = new Map(couplets.map(c => [c.num_a, c]));
const cpById = new Map(couplets.map(c => [c.id, c]));

function resolve(t) {
  let s = 0;
  while (present(t)) {
    if (coupletNodes.has(t)) return { couplet: cpByNode.get(t) };
    if (isTerminal(t)) return { terminal: t };
    t += 1; if (++s > 500) break;
  }
  return {};
}
function choose(cp, choice) {
  if (choice === 'A') return isTerminal(cp.num_a) ? { terminal: cp.num_a } : resolve(cp.num_a + 1);
  return resolve(cp.num_b);
}

// Walk a species' stored path → ordered [{cp, choice 'A'|'B'}]
function pathAnswers(leadNums) {
  const out = [];
  let cp = couplets[0];
  for (const lead of leadNums) {
    if (!cp) break;
    const choice = lead === cp.num_a ? 'A' : lead === cp.num_b ? 'B' : null;
    if (!choice) break;
    out.push({ cp, choice });
    const r = choose(cp, choice);
    if (r.terminal != null) break;
    if (!r.couplet) break;
    cp = r.couplet;
  }
  return out;
}

// Score exactly like js/id_keys.js ksScoreAll (+ the score-primary sort).
function rankOf(answers, target) {
  const nonSkip = answers.filter(a => a.choice !== 'skip');
  const names = new Set();
  for (const a of nonSkip) { for (const n of a.cp.species_a) names.add(n); for (const n of a.cp.species_b) names.add(n); }
  const scores = [...names].map(name => {
    let score = 0, max = 0;
    for (const a of nonSkip) {
      const inA = a.cp.species_a.includes(name), inB = a.cp.species_b.includes(name);
      if (!inA && !inB) continue;
      max++;
      if (inA && a.choice === 'A') score++;
      else if (inA && a.choice === 'B') score--;
      else if (inB && a.choice === 'B') score++;
      else if (inB && a.choice === 'A') score--;
    }
    return { name, score, max, pct: max > 0 ? score / max : 0 };
  }).sort((x, y) => y.score - x.score || y.pct - x.pct || x.name.localeCompare(y.name));
  const idx = scores.findIndex(s => s.name === target);
  return { rank: idx + 1, self: scores[idx], top: scores[0] };
}

let pass = 0; const fails = []; const skipNotes = [];
for (const [name, leadNums] of Object.entries(d.species_paths)) {
  const sp2 = name.split(' ').slice(0, 2).join(' ');
  const answers = pathAnswers(leadNums);
  const r = rankOf(answers, sp2Matches(answers, sp2));
  if (r.rank === 1) pass++;
  else fails.push(`${name.replace('Arhopala ', '')}: #${r.rank} (self ${fmt(r.self)}, #1 ${r.top.name.replace('Arhopala ', '')} ${fmt(r.top)})`);

  // Skip sensitivity: for each answerable couplet on the path that is upperside
  // or skippable, re-rank with that couplet skipped.
  for (let i = 0; i < answers.length; i++) {
    const cp = answers[i].cp;
    if (!(cp.upperside || cp.skippable)) continue;
    const alt = answers.map((a, j) => j === i ? { cp: a.cp, choice: 'skip' } : a);
    const rr = rankOf(alt, sp2Matches(answers, sp2));
    if (rr.rank !== 1) skipNotes.push(`${name.replace('Arhopala ', '')} drops to #${rr.rank} if Key ${cp.num_a} skipped`);
  }
}

function sp2Matches(answers, sp2) {
  // the target name as it appears in species_a/b (base binomial)
  const all = new Set(answers.flatMap(a => [...a.cp.species_a, ...a.cp.species_b]));
  for (const n of all) if (n.split(' ').slice(0, 2).join(' ') === sp2) return n;
  return sp2;
}
function fmt(s) { return s ? `${s.score >= 0 ? '+' : ''}${s.score}/${s.max}` : 'n/a'; }

console.log(`C&P key SCORING audit: ${pass}/${Object.keys(d.species_paths).length} species rank #1 at end of their full path.`);
if (fails.length) { console.log('\n✗ NOT #1 on full path:'); fails.forEach(f => console.log('  ' + f)); }
if (skipNotes.length) {
  console.log('\nℹ Skip sensitivity (species that fall from #1 when a skippable/upperside couplet on their path is skipped):');
  skipNotes.forEach(n => console.log('  ' + n));
}
process.exit(fails.length ? 1 : 0);
