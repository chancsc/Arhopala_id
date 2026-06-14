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

### Precedents

- `6ffc4c7` — moved the silver-FW-cell check (decisive for *A. centaurus*, the 3rd most
  common species) to immediately after Q1.
- `d6d03f7` — moved the macular-markings check (decisive for *A. democritus*, 5th most
  common) to immediately after the whitish-streak question (Q70), without breaking the
  Ganesa-group species that share the same trunk.
