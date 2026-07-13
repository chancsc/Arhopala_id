#!/usr/bin/env node
// Post-processor: move the forewing-length ("Fwl … mm") clause out of each C&P
// couplet's displayed statement and into its hint. Forewing length can't be
// judged from a field photo, so it should not sit in the Yes/No question — but
// it stays available as reference in the collapsible Hint.
//
// Display only: edits couplet.a_text (the shown statement) and couplet.hint in
// data/id_key.json. The `leads` dictionary keeps the full verbatim text.
//
// Run LAST in the pipeline (after the hint text is in place):
//   node scripts/build_id_key.js
//   node scripts/enrich_id_key_guidelinks.js
//   node scripts/apply_id_key_hints.js
//   node scripts/move_fwl_to_hint.js
// Idempotent: once the Fwl is stripped from a_text there is nothing left to move.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'id_key.json');
// "Fwl 20.0 mm" | "Fwl 18.0-22.0 mm" | "Fwl 21–24 mm" | "Fwl 28-29 mm."
const FWL_RE = /\s*Fwl\s+([\d.]+(?:\s*[-–]\s*[\d.]+)?)\s*mm\.?/i;

function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let moved = 0, appended = 0;

  for (const cp of data.couplets) {
    const m = cp.a_text && cp.a_text.match(FWL_RE);
    if (!m) continue;
    const val = m[1].replace(/\s+/g, ''); // e.g. "20.0-21.0"

    // Strip the Fwl clause from the shown statement and collapse the gap it left.
    cp.a_text = cp.a_text
      .replace(FWL_RE, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    moved++;

    // Add the length to the hint, unless that exact value is already there.
    if (!cp.hint.includes(val)) {
      const note = `Forewing length ${val} mm — not judgeable from a field photo.`;
      cp.hint = cp.hint ? `${cp.hint.trim()} ${note}` : note;
      appended++;
    }
  }

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`Moved Fwl out of ${moved} statements; appended it to ${appended} hints.`);
}

main();
