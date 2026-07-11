#!/usr/bin/env node
'use strict';
/*
 * build_id_key.js — deterministic parser: notebook_data/keys.txt -> data/id_key.json.
 * Only data/id_key.json is written.
 *
 * ---------------------------------------------------------------------------
 * MODEL.  keys.txt is a serially-numbered dichotomous key. Each numbered line is a
 * NODE "n (m): text" (couplet-declaring) or "n: text" (a plain lead). A node is:
 *   - TERMINAL  iff its text contains "Arhopala <epithet>".
 *   - a COUPLET iff it carries a parenthetical (m) — the user must decide here.
 * A node can be BOTH (e.g. "4 (5): ...centaurus": match -> centaurus, else -> node 5).
 *
 * Navigation from a couplet node n:
 *   choose A (character matches lead n): if n TERMINAL -> that species;
 *                                        else resolve(n+1).
 *   choose B (character does NOT match): resolve(num_b) where num_b = m.
 * resolve(t) walks forward through transparent connector nodes (non-terminal,
 * non-couplet) until it reaches the next COUPLET (a user decision) or a TERMINAL.
 * This is why a terminal lead can still forward the trunk: control falls through
 * its n+1 neighbour when the specimen is NOT that species.
 *
 * The couplets array is exactly the couplet-nodes, in key-text (numeric) order, so a
 * non-terminal A-choice always lands on the immediately-next couplet in the array.
 *
 * ---------------------------------------------------------------------------
 * SOURCE IRREGULARITIES (minimal, documented overrides):
 *
 *  IMPLICIT_PAREN = {7, 80, 143, 189}
 *      Four TERMINAL leads whose contrasting "(m)" was dropped in this text, leaving
 *      them blocking the fall-through to a real sub-key. Restored as couplets
 *      {n, n+1} (match -> the species, else -> node n+1):
 *        7  amantes  -> node 8  (the entire main tailless trunk hangs off here)
 *        80 alica    -> node 81 (polytomy "79 (80)(81)"; reaches stubbsi 81 -> 82)
 *        143 normani -> node 144 (reaches aroa 144)
 *        189 eumolphus -> node 190 (polytomy "188 (189, 190)"; reaches hellenore 190)
 *
 *  DROP_PAREN = {144}
 *      Lead 144 is written "144 (145)" but lead 145 DOES NOT EXIST (source jumps
 *      144 -> 146). The real contrast is 143 normani vs 144 aroa (restored above via
 *      IMPLICIT_PAREN 143), so lead 144 is treated as a plain terminal (its bogus
 *      "(145)" is ignored).
 *
 * All four IMPLICIT_PAREN targets are n+1, so every affected species is reached by a
 * clean, non-repeating chosen-lead path, and build + validate share this exact model.
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KEYS_TXT = path.join(ROOT, 'notebook_data', 'keys.txt');
const OUT = path.join(ROOT, 'data', 'id_key.json');

// NOTE: lead 7 was formerly in this set (it was a terminal, A. amantes, that had
// to be bridged to lead 8). The source has since been corrected — lead 6 =
// amantes and lead 7 = the "cell about half or longer" contrast to lead 2, a real
// intermediate that falls through to lead 8 on its own — so 7 is no longer needed.
const IMPLICIT_PAREN = new Set([80, 143, 189, 124, 76]);
const DROP_PAREN = new Set([144]);
// ELSE_OVERRIDE: a couplet node whose "else" (B) jump target in the source skips over an
// intermediate sub-key, orphaning it. Redirect the else to the immediate next lead so the
// skipped block becomes reachable (the original far target is still reached by falling
// through that block).  72 baluensis: else 77 -> 73 (reaches valva block 73-76 amphimuta/
// major; trunk 77+ still reached via 76 -> 77).  121 ace: else 124 -> 122 (reaches azinis
// 122; agrata 124 still reached via 123).
const ELSE_OVERRIDE = { 72: 73, 121: 122 };

// ---------------------------------------------------------------------------
// 1. Parse keys.txt.
// ---------------------------------------------------------------------------
const linesTxt = fs.readFileSync(KEYS_TXT, 'utf8').split(/\r?\n/);
const leads = {};     // "num" -> verbatim text (prefix stripped)
const parenNums = {}; // num -> [parenthetical numbers]
const LINE_RE = /^\s*(\d+)\s*((?:\([^)]*\)\s*)+)?:\s*(.*)$/;
for (const line of linesTxt) {
  if (!line.trim() || /^Query:/i.test(line)) continue;
  const m = LINE_RE.exec(line);
  if (!m) continue;
  const num = parseInt(m[1], 10);
  const pn = [];
  const re = /\d+/g; let x;
  while ((x = re.exec(m[2] || '')) !== null) pn.push(parseInt(x[0], 10));
  leads[String(num)] = m[3].trim();
  parenNums[num] = pn;
}
const present = n => leads[String(n)] !== undefined;

// ---------------------------------------------------------------------------
// 2. Node classification.
// ---------------------------------------------------------------------------
const SPECIES_RE = /Arhopala\s+([a-z]+)/;
function speciesOf(n) {
  const t = leads[String(n)];
  if (!t) return null;
  const mm = SPECIES_RE.exec(t);
  return mm ? 'Arhopala ' + mm[1] : null;
}
const isTerminal = n => speciesOf(n) !== null;
function isCouplet(n) {
  if (!present(n)) return false;
  if (IMPLICIT_PAREN.has(n) || ELSE_OVERRIDE[n] != null) return true;
  if (DROP_PAREN.has(n)) return false;
  return (parenNums[n] && parenNums[n].length > 0);
}
function numB(n) {
  if (ELSE_OVERRIDE[n] != null) return ELSE_OVERRIDE[n];
  if (IMPLICIT_PAREN.has(n)) return n + 1;
  return parenNums[n][0];
}

// ---------------------------------------------------------------------------
// 3. Build couplet objects (couplet-nodes in numeric order).
// ---------------------------------------------------------------------------
const coupletNodes = Object.keys(leads)
  .map(Number).filter(isCouplet).sort((a, b) => a - b);

const byNode = new Map(); // node -> couplet index
const couplets = coupletNodes.map((n, i) => {
  byNode.set(n, i);
  const b = numB(n);
  return {
    id: `cp_${n}_${b}`,
    num_a: n,
    num_b: b,
    label: `K${i + 1}`,
    question: '',
    a_text: leads[String(n)],
    b_text: leads[String(b)],
    upperside: false,
    hint: '',
    guide_phrase: '', guide_link: '',
    question_phrase: '', question_link: '',
    // Display inversion (Section 0 of the design doc): when invert=true the card
    // shows `statement` instead of a_text and swaps which button is Yes/No, so a
    // couplet can be phrased the more readable way round. Navigation, paths and
    // scoring are unchanged (Yes still = choice A only when invert=false).
    invert: false, statement: '',
    species_a: [],
    species_b: [],
  };
});

// Per-couplet DISPLAY overrides (presentation only — never affects navigation,
// species_paths or scoring). Key 1 reads more naturally phrased around the
// presence of the tail, with Yes = the tailed abseus group.
const DISPLAY_OVERRIDE = {
  cp_1_212: {
    invert: true,
    statement: 'Hindwing with white-tipped tail at the end of vein 3. Underside hindwing without spot at the base of space 1a.',
  },
};
for (const c of couplets) {
  const o = DISPLAY_OVERRIDE[c.id];
  if (o) Object.assign(c, o);
}

// ---------------------------------------------------------------------------
// 4. Navigation model (identical logic mirrored in validate_id_key.js).
// ---------------------------------------------------------------------------
// resolve(t): walk transparent connectors -> {couplet:node} | {terminal:species} | {dead:true}
function resolve(t) {
  let steps = 0;
  while (present(t)) {
    if (isCouplet(t)) return { couplet: t };
    if (isTerminal(t)) return { terminal: speciesOf(t) };
    t += 1;
    if (++steps > 500) break;
  }
  return { dead: true };
}
// outcome of choosing A / B at couplet node n
function chooseA(n) { return isTerminal(n) ? { terminal: speciesOf(n) } : resolve(n + 1); }
function chooseB(n) { return resolve(numB(n)); }

// ---------------------------------------------------------------------------
// 5. Exhaustive DFS from couplet[0]; record chosen-lead paths + couplet/choice trace.
// ---------------------------------------------------------------------------
const speciesPaths = {};
const speciesTrace = {};
const duplicates = [];
const deadEnds = [];

function dfs(node, chosenLeads, trace, onPath) {
  if (onPath.has(node)) return; // cycle guard
  onPath.add(node);
  const cp = couplets[byNode.get(node)];
  for (const choice of ['a', 'b']) {
    const lead = choice === 'a' ? cp.num_a : cp.num_b;
    const nextLeads = chosenLeads.concat(lead);
    const nextTrace = trace.concat({ coupletId: cp.id, choice });
    const r = choice === 'a' ? chooseA(node) : chooseB(node);
    if (r.terminal) {
      if (speciesPaths[r.terminal] === undefined) {
        speciesPaths[r.terminal] = nextLeads;
        speciesTrace[r.terminal] = nextTrace;
      } else {
        duplicates.push({ name: r.terminal, path: nextLeads });
      }
    } else if (r.couplet != null) {
      dfs(r.couplet, nextLeads, nextTrace, onPath);
    } else {
      deadEnds.push({ node, choice, lead });
    }
  }
  onPath.delete(node);
}
dfs(coupletNodes[0], [], [], new Set());

// ---------------------------------------------------------------------------
// 6. species_a / species_b per couplet.
// ---------------------------------------------------------------------------
const aSets = new Map(), bSets = new Map();
for (const cp of couplets) { aSets.set(cp.id, new Set()); bSets.set(cp.id, new Set()); }
for (const [name, trace] of Object.entries(speciesTrace)) {
  for (const { coupletId, choice } of trace) {
    (choice === 'a' ? aSets : bSets).get(coupletId).add(name);
  }
}
for (const cp of couplets) {
  cp.species_a = [...aSets.get(cp.id)].sort();
  cp.species_b = [...bSets.get(cp.id)].sort();
}

// ---------------------------------------------------------------------------
// 7. upperside heuristic + generated contrast question.
// ---------------------------------------------------------------------------
const hasUpper = t => /upperside/i.test(t);
const hasUnder = t => /underside/i.test(t);
for (const cp of couplets) {
  cp.upperside = hasUpper(cp.a_text) && hasUpper(cp.b_text) &&
                 !(hasUnder(cp.a_text) || hasUnder(cp.b_text));
}
function firstClause(t) {
  let s = t.replace(/\.\.\.?\s*Arhopala.*$/i, '').replace(/\s*Arhopala\s+\w+.*$/i, '');
  const cut = s.split(/(?<=[.;])\s/)[0] || s;
  return cut.trim().replace(/[.;]+$/, '');
}
for (const cp of couplets) {
  cp.question = `${firstClause(cp.a_text)} vs. ${firstClause(cp.b_text)}?`;
}

// ---------------------------------------------------------------------------
// 8. Emit + report.
// ---------------------------------------------------------------------------
const leadsOut = {};
Object.keys(leads).sort((a, b) => a - b).forEach(k => { leadsOut[k] = leads[k]; });
const out = { couplets, leads: leadsOut, species_paths: {} };
Object.keys(speciesPaths).sort().forEach(n => { out.species_paths[n] = speciesPaths[n]; });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

const allSpecies = new Set();
for (const k of Object.keys(leads)) { const s = speciesOf(k); if (s) allSpecies.add(s); }
const missing = [...allSpecies].filter(s => !(s in speciesPaths)).sort();

console.log(`couplets:                  ${couplets.length}`);
console.log(`leads:                     ${Object.keys(leadsOut).length}`);
console.log(`terminal species (in key): ${allSpecies.size}`);
console.log(`species_paths:             ${Object.keys(out.species_paths).length}`);
console.log(`dead-ends:                 ${deadEnds.length} ${deadEnds.length ? JSON.stringify(deadEnds) : ''}`);
console.log(`duplicate terminals:       ${duplicates.length}`);
duplicates.forEach(d => console.log(`   dup ${d.name}: ${d.path.join('>')}`));
console.log(`species with NO path:      ${missing.length} ${missing.join(', ')}`);
const upper = couplets.filter(c => c.upperside);
console.log(`upperside:true couplets:   ${upper.length}`);
console.log('   ' + upper.map(c => `${c.label}(${c.id})`).join(', '));
