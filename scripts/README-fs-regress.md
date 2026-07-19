# Feature-Scoring browser regression harness (`fs_regress.js`)

The authoritative **user-facing** check for a species-targeted Feature-Scoring
fix. A green `npm run regen-validate` is necessary but **not sufficient** — the
scripted simulation and the real browser can diverge (window dynamics,
CD-followup, re-sort-on-every-answer). This harness closes that gap by driving
the actual `checklist.html` page in Chromium.

## What it does

For each species you name it:

1. **Builds a full-matrix underside-only answer set** — every real underside
   feature answered *truthfully*, every upperside / FW space-1–3 question
   answered *"Cannot determine"*. This mirrors `js/checklist.js`'s feature-matrix
   construction exactly (`pickCanonicalPath` with the species' real note +
   result-node `features` overrides, then `isSimCdQuestion` → CD). It is the
   **correct** test — not a truncated stored sim-path.
2. **Serves the repo** on a built-in Node static server (no python needed).
3. **Drives `checklist.html` as a *thorough* user** — a robust driver that
   applies each answer whenever it surfaces, clicking "Show more" each round,
   until no more answers can be placed. (The old fixed-order single-pass driver
   produced false "missed" failures; this one represents a real user who keeps
   answering.)
4. **Reports rank + margin** — pass = the target species is 🥇 #1, with the
   score gap over #2.

Exit code is non-zero if any species fails to rank #1, so it can gate CI.

## Usage

```bash
# one or more species (full "Arhopala <name>" — subspecies auto-resolved)
node scripts/fs_regress.js "Arhopala eumolphus" "Arhopala silhetensis"

# via npm (note the -- before args)
npm run fs-regress -- "Arhopala eumolphus" "Arhopala athada"

# from a file, one species per line
node scripts/fs_regress.js --file my_species_list.txt
```

Example output:

```
✓ Arhopala eumolphus     🥇 #1 (+5)  [eumolphus maxwelli +54 | horsfieldi basiviridis +49 | hellenore siroes +47]
✓ Arhopala silhetensis   🥇 #1 (+6)  [silhetensis adorea +46 | athada athada +40 | zambra zambra +37]

2/2 ranked #1.
```

## Environment overrides

| Variable | Purpose | Default |
|---|---|---|
| `FS_REGRESS_PORT` | static-server port | `8137` |
| `PLAYWRIGHT_MODULE` | path to the `playwright` module (it's not a repo dep — it lives in the environment's global `node_modules`) | auto-detected (`playwright`, then `/opt/node22/lib/node_modules/playwright`, …) |
| `PLAYWRIGHT_CHROMIUM` | explicit Chromium executable path | Playwright's own (`/opt/pw-browsers` in this environment) |
| `FS_REGRESS_KEEP_OPEN` | leave the server running after the run for manual inspection | unset |

In this environment Playwright is at `/opt/node22/lib/node_modules/playwright`
and Chromium at `/opt/pw-browsers`; both are auto-detected, so no overrides are
normally needed.

## Reading the results

- **`🥇 #1 (+N)`** — target ranks first with margin `N` over the runner-up. Pass.
- **`❌ #k`** — target ranks `k`th. Investigate: the fix didn't hold in the
  browser even if the script gates were green.
- The `never-surfaced` count (internal) is the set of upperside / space-1–3 CD
  questions that never render on the underside-only checklist — expected and
  constant, not a miss.

## When to run it

- After any `data/tree.json` edit that touches a species' path, re-gate, or a
  `features` override.
- As the **final** step of a species-targeted fix, after `npm run regen-validate`
  passes (per the testing policy in `CLAUDE.md`).
- On the fragile convergers named in past fix commits (e.g. `silhetensis`,
  `hypomuta hypomuta`, `kinabala`, `pseudomuta`) whenever the cleander /
  eumolphus / tailless trunk is touched.
