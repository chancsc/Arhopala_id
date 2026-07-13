#!/usr/bin/env node
// Post-processor: apply per-couplet hints to data/id_key.json.
//
// Hints are authored in data/id_key_hints.json (a flat map couplet-id -> hint)
// so they survive a rebuild — scripts/build_id_key.js always emits an empty
// "hint" field, and this step fills it in. The interactive C&P Key page
// (js/id_keys.js, ksRenderCouplet) shows cp.hint in a collapsible "Hint" block.
//
// A hint value is normally a plain string. It may instead be an object
//   { "text": "...", "group": { "side": "a"|"b", "label": "..." } }
// to also annotate the couplet with a group species list: this step copies
// `group` onto cp.hint_group, and the C&P Key page renders the named side's
// species (cp.species_a / cp.species_b) as iNaturalist links under the hint.
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

  let applied = 0, groups = 0;
  const missing = [];
  for (const cp of data.couplets) {
    delete cp.hint_group; // rebuilt fresh from the hints file each run
    const h = hints[cp.id];
    const text = typeof h === 'string' ? h : (h && typeof h.text === 'string' ? h.text : '');
    if (text.trim()) {
      cp.hint = text.trim();
      applied++;
    } else {
      cp.hint = '';
      missing.push(cp.id);
    }
    if (h && typeof h === 'object' && h.group && (h.group.side === 'a' || h.group.side === 'b')) {
      cp.hint_group = { side: h.group.side, label: (h.group.label || '').trim() };
      groups++;
    }
  }
  // Warn about hint ids that don't match any couplet (stale entries).
  const ids = new Set(data.couplets.map(c => c.id));
  const stale = Object.keys(hints).filter(k => !ids.has(k));

  fs.writeFileSync(KEY, JSON.stringify(data, null, 2) + '\n');
  console.log(`Applied ${applied} / ${data.couplets.length} couplet hints (${groups} with a group list).`);
  if (missing.length) console.log(`  ${missing.length} couplet(s) without a hint: ${missing.join(', ')}`);
  if (stale.length) console.log(`  ${stale.length} stale hint id(s) ignored: ${stale.join(', ')}`);
}

main();
