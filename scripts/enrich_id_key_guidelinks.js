#!/usr/bin/env node
// Post-processor: add Visual-Guide links to data/id_key.json couplets.
// Mirrors the Feature-Scoring convention (guide.html#anchor) so the C&P key
// couplets link the same illustrated characters. Navigation/scoring are
// unaffected — this only sets guide_phrase/guide_link (and question_phrase/
// question_link where the authored question contains a mapped phrase).
//
// Run AFTER data/id_key.json is generated:  node scripts/enrich_id_key_guidelinks.js
// Idempotent: re-running just recomputes the same links.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'id_key.json');

// Priority-ordered phrase → guide anchor map. For each couplet, the FIRST
// phrase (top to bottom) found verbatim in a_text (preferred) or b_text is
// linked. Phrases must be exact substrings of the lead text.
const PHRASE_MAP = [
  ['cell spots outlined greenish silver', 'guide.html#fw-cell-silver'],
  ['cell spots not outlined greenish silver', 'guide.html#fw-cell-silver'],
  ['postdiscal spots in spaces 7, 6 and 5', 'guide.html#hw-spot6-position'],
  ['postdiscal spot in space 6', 'guide.html#hw-spot6-position'],
  ['spot in space 6', 'guide.html#hw-spot6-position'],
  ['spot at extreme base of space 10', 'guide.html#fw-space10-base-spot'],
  ['spot at base of space 10', 'guide.html#fw-space10-base-spot'],
  ['base of space 10', 'guide.html#fw-space10-base-spot'],
  ['spot in space 11', 'guide.html#fw-space-11'],
  ['spots in space 11', 'guide.html#fw-space-11'],
  ['space 11', 'guide.html#fw-space-11'],
  ['postdiscal spot in space 4 shifted distad', 'guide.html#fw-spot4-distad'],
  ['spot in space 4 shifted distad', 'guide.html#fw-spot4-distad'],
  ['spot in space 4 shifted outwards', 'guide.html#fw-spot4-distad'],
  ['postdiscal band completely dislocated at vein 4', 'guide.html#fw-band-vein4'],
  ['dislocated at vein 4', 'guide.html#fw-band-vein4'],
  ['central cell spot', 'guide.html#hw-central-cell-spot'],
  ['end-cell bar', 'guide.html#spot6-end-cell-bar'],
  ['spot at base of space 6', 'guide.html#hw-space6-basal-spot'],
  ['base of space 6', 'guide.html#hw-space6-basal-spot'],
  ['tornal green scales', 'guide.html#wing-regions'],
  ['tornus rounded', 'guide.html#hw-tornus-rounded'],
  ['tornal lobe', 'guide.html#hw-tornus-rounded'],
  ['white tipped tail at vein 3', 'guide.html#tail-vein2-vs-vein3'],
  ['tail at the end of vein 3', 'guide.html#tail-vein2-vs-vein3'],
  ['cell about half length of wing', 'guide.html#hindwing-cell'],
  ['cell not longer than half the wing', 'guide.html#hindwing-cell'],
  ['cell longer than half the wing', 'guide.html#hindwing-cell'],
  ['hindwing cell', 'guide.html#hindwing-cell'],
];

function firstMatch(text) {
  if (!text) return null;
  for (const [phrase, url] of PHRASE_MAP) {
    if (text.includes(phrase)) return { phrase, url };
  }
  return null;
}

function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let linked = 0, qLinked = 0;

  for (const cp of data.couplets) {
    // Button-text guide link: prefer a_text, fall back to b_text.
    const m = firstMatch(cp.a_text) || firstMatch(cp.b_text);
    if (m) {
      cp.guide_phrase = m.phrase;
      cp.guide_link = m.url;
      linked++;
    } else {
      cp.guide_phrase = '';
      cp.guide_link = '';
    }

    // Question-level link: only if the authored question contains a mapped phrase.
    const qm = firstMatch(cp.question);
    if (qm) {
      cp.question_phrase = qm.phrase;
      cp.question_link = qm.url;
      qLinked++;
    } else {
      cp.question_phrase = '';
      cp.question_link = '';
    }
  }

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`Enriched ${data.couplets.length} couplets: ${linked} with a button guide link, ${qLinked} with a question guide link.`);
}

main();
