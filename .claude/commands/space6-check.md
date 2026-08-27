Cross-check Feature Scoring HW space-6 spot position and shape against C&P key characters for a batch of species.

## Purpose

For each species in the batch, compare:
1. What C&P key couplets say about HW postdiscal spot 6 (position, shape, orientation) on the species' path through `data/id_key.json`
2. What Feature Scoring currently captures — from `data/feature_scoring_paths.json` (canonical FS path) and result node `features` in `data/tree.json`

Report each species as: **✓ Match**, **⚠ Gap** (C&P character absent from FS), **✗ Mismatch** (FS contradicts C&P), or **○ Not in C&P path** (FS has a character C&P doesn't explicitly state for this species).

## How to run

Specify the species batch using $ARGUMENTS (comma-separated names, or a count like "next 10"):

```
/space6-check "Arhopala corinda acestes, Arhopala democritus democritus, ..."
```

## Procedure

1. **Get C&P paths**: for each species, look up its couplet path in `data/id_key.json` → `species_paths`.
2. **Read C&P couplet text**: relevant couplets from `notebook_data/keys.txt` (read-only — never modify).
   - Always prioritise C&P key text over any other source if conflict.
   - Key couplets for spot-6 shape: 95 (9B arrangement), 102/103 (concave vs straight), 115/116 (pseudomuta vs alitaeus), 150/151/152 (athada vs silhetensis).
3. **Get FS coverage**: from `data/feature_scoring_paths.json` — scan the canonical path for Q13 and any spot-6 shape/position questions. Also check result node `features` in `data/tree.json`.
4. **Cross-check**: for each C&P character about spot 6, determine if FS covers it.
5. **Report findings**: present a table (artifact or markdown) with species, C&P path, C&P characters, FS status, and assessment.

## Implementing gaps found

For species with **⚠ Gap**:

1. Identify which C&P couplet(s) the species passes through and what character is missing.
2. Check `data/tree.json` for an existing question covering that character.
   - If an existing question covers it: add it to the species' result node `features` with the matching choice label.
   - If no existing question covers it: create a **features-only discriminator** — add it to all relevant species' result node `features` with appropriate Yes/No answer strings. The checklist auto-generates buttons from distinct values across result nodes.
3. When adding a features-only discriminator, add it to **both sides** (the species with the character AND species where it's absent) so it acts as a real scoring discriminator.
4. Run validation: `npm run regen-validate` — must report "✓ All N sim-CD paths match the live simulation." and exit 0.
5. Commit: `git add data/tree.json && git commit`.

## Key data sources (never modify keys.txt)

- `notebook_data/keys.txt` — C&P couplet text (read-only reference)
- `data/id_key.json` → `species_paths` — couplet numbers for each species' C&P path
- `data/tree.json` — result node `features` to edit; question nodes to check
- `data/feature_scoring_paths.json` — canonical FS paths (auto-generated, do not edit directly)

## Precedents

- Batch 1 (2026-08-27): 5 species (corinda, democritus, athada, silhetensis, pseudomuta).
  - democritus: couplet 102 "concave outer edge" → added features-only Q1 (concave/straight) to democritus + 9 alitaeus-group species
  - silhetensis: couplet 152 "sinuous outer edge, oblique spots 6-7" → added features-only Q3 to silhetensis + athada
  - pseudomuta: couplets 103+115 "straight/convex, slightly oblique, not overlapping bar" → added Q1 + features-only Q2 (overlap/oblique) to pseudomuta + alitaeus
  - athada: full match (all couplet 151 characters already in FS)
  - corinda: spot-6 character in FS but not explicitly stated by C&P (no change)
