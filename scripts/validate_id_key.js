#!/usr/bin/env node
'use strict';
/*
 * validate_id_key.js — independent validator for data/id_key.json.
 *
 * Re-derives the navigation model from the emitted couplets + leads ALONE (it does not
 * import build_id_key.js), then:
 *   1. Replays every species_path through the model and asserts it reaches exactly the
 *      terminal lead naming that species.
 *   2. Asserts every couplet's num_a / num_b exist in leads.
 *   3. Asserts every terminal species in keys.txt has a species_path.
 *   4. Asserts couplets are ordered so a non-terminal num_a's A-choice advances to the
 *      immediately-next couplet in the array.
 *   5. Prints counts and "✓ id_key.json valid".
 * Exit 0 on success, 1 on any failure.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'id_key.json'), 'utf8'));
const keysTxt = fs.readFileSync(path.join(ROOT, 'notebook_data', 'keys.txt'), 'utf8');

const { couplets, leads, species_paths } = data;
const errors = [];
const fail = m => errors.push(m);

// --- model derived from output ---------------------------------------------
const present = n => leads[String(n)] !== undefined;
const SPECIES_RE = /Arhopala\s+([a-z]+)/;
function speciesOf(n) {
  const t = leads[String(n)];
  if (!t) return null;
  const m = SPECIES_RE.exec(t);
  return m ? 'Arhopala ' + m[1] : null;
}
const isTerminal = n => speciesOf(n) !== null;

const coupletNodes = new Set(couplets.map(c => c.num_a));
const cpByNode = new Map(couplets.map(c => [c.num_a, c]));

// resolve(t): couplet-node set takes priority over terminal (mirrors the builder)
function resolve(t) {
  let steps = 0;
  while (present(t)) {
    if (coupletNodes.has(t)) return { couplet: t };
    if (isTerminal(t)) return { terminal: speciesOf(t) };
    t += 1;
    if (++steps > 500) break;
  }
  return { dead: true };
}
function chooseA(cp) { return isTerminal(cp.num_a) ? { terminal: speciesOf(cp.num_a) } : resolve(cp.num_a + 1); }
function chooseB(cp) { return resolve(cp.num_b); }

// --- check 2: num_a / num_b exist in leads ---------------------------------
for (const cp of couplets) {
  if (!present(cp.num_a)) fail(`[C2] ${cp.id}: num_a ${cp.num_a} not in leads`);
  if (!present(cp.num_b)) fail(`[C2] ${cp.id}: num_b ${cp.num_b} not in leads`);
}

// --- check 4: A-choice advances to the next array index --------------------
for (let i = 0; i < couplets.length; i++) {
  const cp = couplets[i];
  if (isTerminal(cp.num_a)) continue;            // terminal A ends the path
  const r = chooseA(cp);
  if (r.couplet == null) { fail(`[C4] ${cp.id}: non-terminal A does not resolve to a couplet`); continue; }
  const target = cpByNode.get(r.couplet);
  if (target !== couplets[i + 1]) {
    fail(`[C4] ${cp.id}: A advances to ${r.couplet} (${target && target.id}), not next array couplet ${couplets[i + 1] && couplets[i + 1].id}`);
  }
}

// --- check 1: replay every species_path ------------------------------------
if (!couplets.length) fail('[C1] no couplets');
for (const [name, leadsSeq] of Object.entries(species_paths)) {
  if (!Array.isArray(leadsSeq) || leadsSeq.length === 0) { fail(`[C1] ${name}: empty path`); continue; }
  let cp = couplets[0];
  let ok = true;
  for (let i = 0; i < leadsSeq.length; i++) {
    const L = leadsSeq[i];
    let choice;
    if (L === cp.num_a) choice = 'a';
    else if (L === cp.num_b) choice = 'b';
    else { fail(`[C1] ${name}: lead ${L} at step ${i} is neither num_a(${cp.num_a}) nor num_b(${cp.num_b}) of ${cp.id}`); ok = false; break; }
    const r = choice === 'a' ? chooseA(cp) : chooseB(cp);
    const last = i === leadsSeq.length - 1;
    if (r.terminal) {
      if (!last) { fail(`[C1] ${name}: reached terminal ${r.terminal} at step ${i} before path end`); ok = false; }
      else if (r.terminal !== name) { fail(`[C1] ${name}: path ends at ${r.terminal}, expected ${name}`); ok = false; }
      break;
    } else if (r.couplet != null) {
      if (last) { fail(`[C1] ${name}: path ended on a couplet (${cpByNode.get(r.couplet).id}), not a terminal`); ok = false; break; }
      cp = cpByNode.get(r.couplet);
    } else {
      fail(`[C1] ${name}: dead-end at step ${i} (${cp.id} choice ${choice})`); ok = false; break;
    }
  }
  void ok;
}

// --- check 3: every terminal species in keys.txt has a path ----------------
const keySpecies = new Set();
for (const line of keysTxt.split(/\r?\n/)) {
  if (!/^\s*\d+\s*(?:\([^)]*\)\s*)*:/.test(line)) continue; // only numbered lead lines
  const m = SPECIES_RE.exec(line);
  if (m) keySpecies.add('Arhopala ' + m[1]);
}
for (const s of keySpecies) {
  if (!(s in species_paths)) fail(`[C3] terminal species ${s} has no species_path`);
}

// --- report ----------------------------------------------------------------
const terminalCount = keySpecies.size;
console.log(`#couplets:        ${couplets.length}`);
console.log(`#leads:           ${Object.keys(leads).length}`);
console.log(`#terminal species: ${terminalCount}`);
console.log(`#species_paths:   ${Object.keys(species_paths).length}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} error(s):`);
  for (const e of errors.slice(0, 50)) console.error('  ' + e);
  process.exit(1);
}
console.log('✓ id_key.json valid');
