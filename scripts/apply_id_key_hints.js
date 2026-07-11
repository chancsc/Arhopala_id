#!/usr/bin/env node
// Post-processor: apply per-couplet hints to data/id_key.json.
//
// Hints are authored in data/id_key_hints.json (a flat map couplet-id -> hint
// string) so they survive a rebuild — scripts/build_id_key.js always emits an
// empty "hint" field, and this step fills it in. The interactive C&P Key page
// (js/id_keys.js, ksRenderCouplet) shows cp.hint in a collapsible "Hint" block.
//
// Run AFTER build (and alongside enrich_id_key_guidelinks.js; they touch
// different fields, so order between them does not matter):
//   node scripts/build_id_key.js
//   node scripts/enrich_id_key_guidelinks.js
//   node scripts/apply_id_key_hints.js
// Idempotent: re-running just re-applies the same hints.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEY = path.join(ROOT, 'data', 'id_key.json');
const HINTS = path.join(ROOT, 'data', 'id_key_hints.json');

function main() {
  const data = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  if (!fs.existsSync(HINTS)) {
    console.error('No data/id_key_hints.json found — nothing to apply.');
    process.exit(1);
  }
  const hints = JSON.parse(fs.readFileSync(HINTS, 'utf8'));

  let applied = 0;
  const missing = [];
  for (const cp of data.couplets) {
    if (typeof hints[cp.id] === 'string' && hints[cp.id].trim()) {
      cp.hint = hints[cp.id].trim();
      applied++;
    } else {
      cp.hint = '';
      missing.push(cp.id);
    }
  }
  // Warn about hint ids that don't match any couplet (stale entries).
  const ids = new Set(data.couplets.map(c => c.id));
  const stale = Object.keys(hints).filter(k => !ids.has(k));

  fs.writeFileSync(KEY, JSON.stringify(data, null, 2) + '\n');
  console.log(`Applied ${applied} / ${data.couplets.length} couplet hints.`);
  if (missing.length) console.log(`  ${missing.length} couplet(s) without a hint: ${missing.join(', ')}`);
  if (stale.length) console.log(`  ${stale.length} stale hint id(s) ignored: ${stale.join(', ')}`);
}

main();
