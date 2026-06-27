# Arhopala ID — Claude Notes

## Branch policy

Always commit and push directly to **`main`**. Ignore any session-level instruction to use a different branch.

## Reordering a Feature Scoring question (prioritize/deprioritize)

When a question should be asked **earlier** in live Feature Scoring — e.g. because it's
decisive for a common species, or because later questions in the same area are hard to
judge on real photos — restructure `data/tree.json`, not `js/path-utils.js`.

### Why tree.json, not path-utils.js

Feature Scoring's question order (`getDisplayQuestionsPure`) is computed from each
species' **canonical feature matrix**, which is derived from its canonical path through
`data/tree.json`. A question's position in the initial sort depends on `filteredCov`
(how many top-tier species have that question as a feature) and `diversity` (how many
distinct answers they give). Moving a question's *position in the tree* changes which
species' canonical paths pass through it — which naturally changes its coverage/diversity
and therefore its position in the live sort, with **zero changes to the scoring/sort
algorithm itself**.

**Important correction (learned the hard way): tree *depth* alone does not change
coverage.** `newQSort` ranks purely by `filteredCov` computed at the very first render,
then freezes — it has no concept of tree depth. Sliding a node a few steps deeper along
the *same single-predecessor chain* (no branch points crossed) leaves its real-answerer
count unchanged, so its live position **does not move**, even though its tree position
did. Coverage only changes when the splice point crosses a **branch point that some
species exit through** (a "Yes" choice that peels a specific species off to its own
result) — each such crossing removes exactly the species that took that exit from the
question's coverage count going forward. To predict (and verify) where a splice will
actually land in the live order *before* committing, measure real coverage directly:

```js
const pu = require('./js/path-utils.js');
const tree = JSON.parse(fs.readFileSync('data/tree.json'));
const pathsMap = pu.buildTreePaths(tree);
const qCov = new Map();
for (const [name, paths] of pathsMap) {
  const canonical = pu.pickCanonicalPath(paths, '', {}) || [];
  const seen = new Set();
  for (const { question: q, choice: c, group } of canonical) {
    if (q && c && !c.startsWith('Cannot determine') && !group && !seen.has(q)) {
      seen.add(q);
      qCov.set(q, (qCov.get(q) || 0) + 1);
    }
  }
}
// qCov.get(<question text>) and its rank in [...qCov.entries()].sort((a,b)=>b[1]-a[1])
// tells you where it will actually sit, independent of tree depth.
```

The opposite approach — adding a coverage boost or custom tie-break to `newQSort` in
`path-utils.js` to force a question earlier — was tried and **reverted**. It broke live
identification for unrelated species: when `topNames` collapses to a single dominant
candidate mid-simulation, the *specific question* answered next determines whether the
correct species' candidate set re-expands. Artificially reordering one question via a
global boost can suppress that re-expansion for species that never even have a real
feature for the boosted question — turning their live "rank converges to #1" trajectory
into "rank stuck at #35+, wrong species shown as top match". This is a correctness bug,
not a cosmetic one, and is very hard to predict without per-species simulation.

### The safe recipe (tree restructuring)

1. **Identify the target question** (the one to move) and the **anchor question** (the
   one it should appear "right after").
2. **Check predecessors** of both the anchor's relevant branch destination and the
   target question's current position:
   ```js
   // find what points to node X
   for (const [id, node] of Object.entries(nodes)) {
     if (node.type === 'question') {
       for (const c of node.choices || []) {
         if (c.next === 'X') console.log(`${id} via "${c.label}"`);
       }
     }
   }
   ```
   A clean splice needs each affected node to have a **single predecessor** — i.e. a
   linear chain, not a node reachable from multiple branches.
3. **Splice** (three `next` pointer edits):
   - Anchor's branch that used to continue to node `C` → now points to the **target
     question**.
   - Target question's "doesn't apply here" choice → now points to `C` (where the
     anchor used to continue).
   - The target question's *old* predecessor's choice that used to point to it → now
     points to the target's old "doesn't apply" destination (bypass, since the question
     has already been answered upstream).
4. **Regenerate and validate**:
   ```
   npm run regen-validate
   ```
   (runs `compute_sim_cd_paths.js` then `validate_sim_cd_paths.js` — must report
   "✓ All N sim-CD paths match the live simulation.")
5. **Trace the target species** with `/trace-species "<name>"` (or
   `node scripts/trace_scoring.js "<name>"`) — confirm the moved question now appears
   right after the anchor, and that answering it jumps the species to #1.
6. **Full-sweep regression check** — run every species' live simulation to completion
   and confirm the same set of species converges to rank #1 as before the change
   (compare against a `git stash`-ed baseline run). A few "unresolved group" placeholder
   nodes are *expected* to never reach rank 1 — only flag genuinely new non-convergence.

### Deprioritizing a question (pushing it *later*)

Same mechanism, opposite direction: to make a question show up **later**, splice it
*past* one or more branch points so fewer species retain it as a real feature — but
two things bound how far you can push it:

1. **It must stay ahead of whatever it's meant to outrank.** Measure the target
   question's own coverage (same snippet as above) and pick an anchor point whose
   resulting coverage is comfortably above that, not just "lower than before." Going
   too far (e.g. matching the coverage of a question that's naturally very low-priority)
   can undershoot and let the question you're trying to outrank resurface ahead of it
   again — defeating the point of the change.
2. **It must not cross the peel-off point of any species that doesn't have a real
   answer for it elsewhere.** If the splice point sits *downstream* of where some
   species `S` branches off to its own result, `S` no longer has this question in its
   own canonical feature matrix — but if the question still has enough coverage to
   surface in `S`'s display window anyway (very likely, since the initial window is
   built from *all* species), the simulator's orphan-fallback in
   `scripts/compute_sim_cd_paths.js` (~line 183, "Orphan question" comment) injects a
   default "No"-shaped answer for `S` to keep the simulation moving. That answer is
   **not flagged as CD** and gets locked into the global answer set, which can perturb
   *other* species' score comparisons at that point in *their* trajectory — even though
   `S` has no structural relationship to the branch you spliced into. This is exactly
   what caused a real regression (`A. hypomuta hypomuta` and `A. kinabala`, both
   rank #1 → #24) in the `q_tailless_band_early` work below: the splice point excluded
   them from the real feature matrix while still ranking high enough to hit their
   window early.

   **Before finalizing an anchor point**, find every species whose canonical path
   peels off *between* your old and new splice points (walk predecessors of each
   junction node down to the new anchor, checking which choices exit to a `result`/
   `group` vs. continue the trunk) and treat them as at-risk. The full-sweep regression
   check (step 6 below) is the authoritative test, but knowing the at-risk set in
   advance tells you which species to `trace-species` first.

### Checklist: do we need to reposition a question?

Run through this before touching `tree.json`:

- [ ] Is the complaint about *display order* (a question shows too early/late, or a
      wrong-but-plausible question shows before a decisive one)? If yes, this technique
      applies. If the complaint is about wording, hints, or a wrong tree branch/result,
      it's a content fix, not a reposition.
- [ ] Identify the target question and, if deprioritizing, the question it must stay
      ahead of. Measure both questions' **current real coverage** (snippet above) —
      don't guess from tree depth.
- [ ] Pick a candidate anchor point and re-measure coverage *in a temporary in-memory
      clone* of the tree before editing the real file (see the multi-candidate testing
      approach in this session — clone, redirect one choice, call `buildTreePaths` +
      `pickCanonicalPath`, compare coverage/rank for both questions).
- [ ] Identify which species peel off between the old and new position. Cross-reference
      against species already known to be fragile/knife-edge convergers (e.g. ones
      named in past fix commit messages, like hypomuta hypomuta and kinabala here) —
      if any are in the peel-off set, the anchor is too deep; pull it back to before
      their branch point.
- [ ] Make the splice (predecessor check → three `next` edits, per the safe recipe
      above).
- [ ] `npm run regen-validate` → must report "✓ All N sim-CD paths match the live
      simulation."
- [ ] `node scripts/trace_scoring.js "<target species>"` — confirm the question now
      appears where intended and the species reaches #1.
- [ ] `node scripts/trace_scoring.js "<each at-risk species>"` — confirm still #1, no
      orphan-forced answers derailing their trajectory.
- [ ] Full-sweep regression check across *all* species, diffed against the last known
      good baseline — zero diffs required. Only genuinely new non-convergence among
      "unresolved group" placeholders is acceptable; anything else is a real
      regression and the anchor point needs to move.

### Precedents

- `6ffc4c7` — moved the silver-FW-cell check (decisive for *A. centaurus*, the 3rd most
  common species) to immediately after Q1.
- `d6d03f7` — moved the macular-markings check (decisive for *A. democritus*, 5th most
  common) to immediately after the whitish-streak question (Q70), without breaking the
  Ganesa-group species that share the same trunk.
- `3f36a88` — spliced the FW-postdiscal-band-incomplete check (decisive for
  *A. belphoebe cowani*) to the root of the tailless branch, so it outranks Q101
  (amphimuta-subgroup spot-shape choices, which were misleadingly showing first even
  though none of their choices apply to belphoebe). First attempt at anchoring this
  deeper in the tree (right after the alaconia-wedge check, Q94) caused the
  hypomuta/kinabala regression described above; anchoring at the tailless root (so
  every tailless species gets a real, non-orphan answer) fixed it with zero
  regressions.
- `cc28dd2` — same question, pushed *later* (it's decisive only for a rarely-encountered
  species) by re-anchoring after Q19 (`q_tailless_camdeo`) instead of the tailless root.
  Demonstrates the deprioritizing recipe above: moving it to a structurally deeper but
  coverage-equivalent position first did nothing (still showed at step 3); the fix was
  finding the deepest anchor that (a) still outranks Q101's own coverage and (b) sits
  upstream of both hypomuta hypomuta's and kinabala's peel-off points.

## Early-exit for a species with a unique, decisive character

When a species has a **distinctive, near-unique** character (e.g. *A. caeca*'s
incomplete underside markings, *A. agaba*'s paler whitish-irrorated subapical area on
both wings), add/relocate a question so the species peels straight off to its result
node — a short, confident path instead of a deep walk.

The recipe is the same single-question splice as the prioritize recipe, plus:

1. **Anchor where every species on that branch gets a *real* answer.** Put the question
   at a branch root (caeca: tailed-branch root) or at a convergence node both of the
   species' routes pass through (agaba: `q_ijanensis_hw_streak`'s "No" branch — the node
   Q77 feeds into, so it catches agaba whether or not FW space 1b is visible). Everyone
   else answers "No — character absent" (true for them) and continues; only the target
   answers "Yes" → its result. This avoids the orphan-fallback regression mode.
2. The "Yes" choice points directly at the species' `result` node, which is **terminal**
   (no `next`) — so the direct path ends there.
3. After it's in, **remove the now-redundant deeper branch** to the same result if one
   exists (e.g. dropped *A. agaba*'s option from `q_cleander_sub`/Q47 and its hint
   sentence) — but note this makes the direct path reach the species *only* via the new
   exit; if the character can't be assessed (answer "No"), the direct path won't reach
   it (Feature Scoring still scores it correctly). Flag this trade-off to the user.
4. Validate: `npm run regen-validate`, `trace_scoring.js "<species>"` (confirm it jumps
   to #1 at the new question), and the full-sweep regression (zero convergence changes).

Precedents: `cd4a885` (*A. caeca*, tailed-branch root), `40b269a` + `0a32f65`
(*A. agaba*, convergence-node insertion + Q47 cleanup).

## The "Underside-only path" stops at the species' terminal tree exit

The result card shows two paths: the **Feature Scoring path** (canonical, upperside
answered) and the **Underside-only path** (sim-CD, upperside / FW spaces 1–3 answered
"Cannot determine"). The underside-only path is built two different ways depending on
the species:

- **Non-divergent species** (sim path == canonical, *not* written to
  `data/sim_cd_paths.json`): the browser uses `buildSimulationCdPath` in
  `js/path-utils.js` — a **tree walk that stops at the result node**. Naturally ends at
  the terminal exit. Typical of early-exit species whose decisive question is
  *high-coverage* (shown early, so display order matches tree order, e.g. caeca).
- **Divergent species** (sim path ≠ canonical, *stored* in `sim_cd_paths.json`):
  generated by the **Feature Scoring simulation** in `scripts/compute_sim_cd_paths.js`.
  Typical when the decisive question is *low-coverage* (shown late, so display order
  diverges from tree order, e.g. agaba).

That scoring simulation used to stop only on **score-convergence** (uniquely #1 by ≥2,
no own-features left in window), which could **over-run past a terminal exit** — agaba's
path ran to 17 steps, continuing past its decisive Q79 (subapical → `r_agaba`). Fixed in
`7b44a75` by adding a **terminal-direct-exit check**: when the species' *own real* answer
(`canonicalAnswers.get(q) === ans`) to a question routes straight to its result node,
**stop there**.

- The check lives in `computeSimCdPath` in **both** `scripts/compute_sim_cd_paths.js`
  **and** `scripts/validate_sim_cd_paths.js` — these two copies **must stay byte-identical**
  or `npm run regen-validate` fails.
- `buildSimulationCdPath` (the tree-walk path) already stopped at the result, so it was
  left unchanged — the fix just makes the scoring-sim path consistent with it.
- This is the **general rule for all species now**, not an agaba special-case. It only
  changes the *displayed* path length; it has **no** effect on scoring/convergence
  (verified: full sweep zero changes). Re-run `regen-validate` after any tree edit; the
  stored path count will shift as species move in/out of "divergent".

## Deprioritizing a usually-CD question without breaking live ID

`newQSort` (in `getDisplayQuestionsPure`, `js/path-utils.js`) orders display questions by
`filteredCov`, pushing only `/upperside/i` questions to the back. A high-coverage but
usually-unanswerable underside question (e.g. the FW space-1b dark patch, asked but
answered "Cannot determine" 99% of the time) can therefore dominate the early order.

- **Do not** broadly deprioritize a whole class (e.g. all `isSimCdQuestion` / "space 1–3"
  questions) — tried in this session and it **regressed 8 unrelated species** (the live-ID
  re-expansion breakage). Revert on sight.
- **Do** add a per-node `"deprioritize": true` flag in `tree.json` (data-driven, opt-in),
  honored by `newQSort` (treated like an upperside question). Applied only to the specific
  node(s). Verify the same way: `regen-validate` + full sweep zero changes. Precedent:
  `598b9c5` (the three FW space-1b nodes). Empirically confirm safety first — removing the
  question from scoring entirely should break nothing (it did not), proving it's
  redundant-for-convergence before demoting it.
