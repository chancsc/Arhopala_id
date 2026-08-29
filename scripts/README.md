# Scripts — Validation & Tooling Reference

Quick map of every script in this directory, what it checks, when to run it, and how it fits into the pipeline.

---

## The validation pipeline

There are two independent identification systems in this repo — the **C&P Decision-Tree Key** and **Feature Scoring** — each with its own build and validation pipeline.

```
Feature Scoring pipeline
─────────────────────────────────────────────────────────
data/tree.json
    │
    ├─ compute_sim_cd_paths.js        →  data/sim_cd_paths.json
    ├─ compute_feature_scoring_paths.js → data/feature_scoring_paths.json
    │
    ├─ validate_sim_cd_paths.js       (script ↔ stored, no browser)
    │
    ├─ verify_sim_cd_paths.js         (stored path ↔ live browser, Playwright)
    ├─ verify_fs_paths.js             (stored FS path ↔ live browser, Playwright)
    │
    ├─ walk_sim_cd_paths.js           (browser-generated path ↔ stored, Playwright)
    │                                  [covers all species, not just stored set]
    │
    ├─ fs_regress.js                  (convergence: species reaches #1 in browser)
    └─ trace_scoring.js               (single-species debug: step-by-step ranks)

C&P Key pipeline
─────────────────────────────────────────────────────────
notebook_data/keys.txt
    │
    ├─ build_id_key.js + helpers      →  data/id_key.json
    │
    ├─ validate_id_key.js             (structural: every species_path reaches its terminal)
    └─ audit_id_key_scoring.js        (scoring: species ranks #1 on its key path)
```

`npm run regen-validate` runs the full Feature Scoring pipeline (compute → script-validate → browser-verify) and is mandatory after any change to `data/tree.json` or `js/path-utils.js`.

---

## Feature Scoring scripts

### `compute_sim_cd_paths.js`

**What:** Generates `data/sim_cd_paths.json`.

For each species in the feature matrix, simulates the live Feature Scoring checklist using **underside-only** answers:
- Upperside features and FW spaces 1–3 → "Cannot determine"
- All other features → the species' canonical answer

The simulation calls `scoreAllPure` and `getDisplayQuestionsPure` from `js/path-utils.js` directly, so it is guaranteed to mirror the browser's sort order. Only stores paths that *differ* from the canonical (upperside-answered) path; species whose underside-only path is identical to their canonical path are omitted (the browser uses the tree-walk path for them instead).

**Run:** `npm run regen` or `npm run regen-validate`

**Output:** `data/sim_cd_paths.json`

---

### `compute_feature_scoring_paths.js`

**What:** Generates `data/feature_scoring_paths.json`.

Same simulation as above but with *all* features answered (upperside included). Produces the canonical Feature Scoring path shown in the result card's "Feature Scoring path" section.

**Run:** `npm run regen` or `npm run regen-validate`

**Output:** `data/feature_scoring_paths.json`

---

### `validate_sim_cd_paths.js`

**What:** Script-level gate — re-runs `compute_sim_cd_paths.js`'s logic independently and diffs every species against `data/sim_cd_paths.json`. No browser required; fast (~2 s).

This is the first gate in `regen-validate`. If it fails, the stored file is stale and needs regeneration. The `computeSimCdPath` function inside this file must stay **byte-identical** to the one in `compute_sim_cd_paths.js` — any divergence between the two makes this gate meaningless.

**Run:** `npm run validate` or `npm run regen-validate`

**Exits:** 0 if all paths match, 1 if any differ.

---

### `verify_sim_cd_paths.js`

**What:** Playwright gate — plays back each stored path from `sim_cd_paths.json` step-by-step in a real Chromium browser and confirms the stored question is the first unanswered question in the live display order at each step.

This catches divergences that the script simulation misses — re-sort-on-every-answer, gate-followup injection, CD-followup insertion — but only for species that have a stored path (~42 species currently). Non-divergent species are not tested here; use `walk_sim_cd_paths.js` for full coverage.

**Run:** `npm run verify-sim-cd-paths` or `npm run regen-validate`

**Exits:** 0 if all stored paths replay faithfully, non-zero if any diverge.

**Note:** Do NOT click `#cl-show-more` before reading the question order — it fires the CD-followup insertion branch and produces false divergences. The script only expands when a target button is beyond the 15-question cap.

---

### `verify_fs_paths.js`

**What:** Same as `verify_sim_cd_paths.js` but for the full Feature Scoring paths (`data/feature_scoring_paths.json`) — upperside answers included.

Run after any change that might affect the FS path display order in the result card.

**Run:** `npm run verify-fs-paths`

**Exits:** 0 if all stored FS paths replay faithfully.

---

### `walk_sim_cd_paths.js`

**What:** Browser-native path recorder — the most authoritative validator for the underside-only path.

Unlike `verify_sim_cd_paths.js` (which plays back a stored file), this script **generates** the underside-only path live in the browser for every species. At each step it reads the top unanswered question from the DOM and decides the answer from the species' feature matrix. The browser-generated path is then compared against the stored path (or tree-walk path for non-divergent species).

This covers the full species set (~113), not just the stored subset. It catches:
- Feature value / tree-choice label mismatches (the button exists but with a different label)
- Species that should be divergent (stored) but are not, or vice versa
- Questions that surface with no valid answer for the species

**Run:**
```bash
# one batch of 20, useful for CI
node scripts/walk_sim_cd_paths.js --batch-size 20 --batch-index 0

# named species or file
node scripts/walk_sim_cd_paths.js "Arhopala selta" "Arhopala opalina"
node scripts/walk_sim_cd_paths.js --file species_list.txt

# full run (all species, ~10 min)
node scripts/walk_sim_cd_paths.js --all
```

**Exits:** 0 if all browser-generated paths match stored, non-zero if any differ.

---

### `fs_regress.js`

**What:** Convergence check — the **authoritative user-facing** gate for a species-targeted fix.

For each named species, builds the full underside-only answer set (all underside features truthful, all upperside / FW space-1–3 → "Cannot determine"), drives `checklist.html` as a thorough user (applies every answer whenever it surfaces, clicking "Show more" each round), and checks the species ranks 🥇 #1.

A green `npm run regen-validate` is necessary but **not sufficient** — the scripted simulation and the real browser can diverge. This harness closes that gap. Per the testing policy in `CLAUDE.md`, run this as the **final step** of any species-targeted fix.

**Run:**
```bash
npm run fs-regress -- "Arhopala opalina azata" "Arhopala selta selta"
node scripts/fs_regress.js --file my_list.txt
```

**Exits:** 0 if all named species rank #1, non-zero otherwise.

See `README-fs-regress.md` for full details and environment variables.

---

### `trace_scoring.js`

**What:** Single-species debugging tool.

Runs the Feature Scoring simulation for one species, printing each step with:
- The question text and the answer chosen
- The species' rank before and after answering
- Whether the step is a "Cannot determine" (CD) answer

At the end, compares the live-computed path against the stored `sim_cd_paths.json` entry and reports any mismatches.

**Run:**
```bash
node scripts/trace_scoring.js "Arhopala opalina azata"
# or via skill:
/trace-species "Arhopala opalina azata"
```

Use this to investigate why a species doesn't converge, or to diagnose a mismatch between the stored path and the current simulation.

---

### `gen_validation_reference.js`

**What:** Generates `docs/validation-reference.html` — a browsable HTML page listing every question/answer pair in every species' feature matrix, tagged as "canonical" (from the tree path) or "override" (from a result-node `features` entry).

Useful when auditing a group of species or reviewing the effect of adding/removing a feature override.

**Run:** `npm run gen-validation-ref`

---

## C&P Decision-Tree Key scripts

### `build_id_key.js` (+ `enrich_id_key_guidelinks.js`, `apply_id_key_hints.js`, `move_fwl_to_hint.js`)

**What:** Builds `data/id_key.json` from `notebook_data/keys.txt` (the raw C&P couplet text), then enriches it with guide links, hint text, and forewing-length annotations.

**Run:** `npm run build-key`

---

### `validate_id_key.js`

**What:** Structural validator for `data/id_key.json`. Replays every `species_paths` entry through the couplet model and asserts it reaches exactly the correct terminal lead. Also checks couplet ordering and completeness.

**Run:** `npm run validate-key` or `npm run build-validate-key`

**Exits:** 0 if valid, 1 on any structural failure.

---

### `audit_id_key_scoring.js`

**What:** Scoring audit for `data/id_key.json`. Replays each species' key path through the live scoring logic (`js/id_keys.js`) and asserts the species ranks #1. Also reports the rank drop when any uppside-or-skippable couplet is answered "Skip" — so a change that makes a couplet skippable can't silently break rank.

**Run:** `npm run audit-key` or `npm run build-validate-key`

**Exits:** 0 if every species ranks #1 on its full path.

---

## Quick reference — when to run what

| Situation | Command |
|---|---|
| Any change to `data/tree.json` or `js/path-utils.js` | `npm run regen-validate` |
| Species-targeted fix (final gate) | `npm run fs-regress -- "Arhopala <name>"` |
| Full underside-path fidelity audit (all species) | `node scripts/walk_sim_cd_paths.js --all` |
| Single-species convergence investigation | `node scripts/trace_scoring.js "<name>"` |
| Any change to `data/id_key.json` or key build scripts | `npm run build-validate-key` |
| Reviewing feature matrix for a group | `npm run gen-validation-ref` (then open `docs/validation-reference.html`) |
