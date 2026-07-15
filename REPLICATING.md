# Replicating for another genus

The app is genus-agnostic at the data layer: `index.html`, `checklist.html`, `species.html`, `guide.html`, `id_keys.html`, and the shared scoring engine in `js/path-utils.js` work entirely from `data/tree.json`, `data/species.json`, and (for the C&P Key) `data/id_key.json`. To adapt the project for a different genus (or a different region):

## 1. Get the project into your own repo

1. **Download this project locally**:
   ```
   git clone https://github.com/chancsc/Arhopala_id.git my-genus-id
   cd my-genus-id
   ```
   To start from a clean history rather than a fork, drop the existing git history: `rm -rf .git`.

2. **Create a new, empty GitHub repository** for your project (e.g. `my-genus-id`). Don't initialize it with a README, `.gitignore`, or license — leave it empty so the push below doesn't conflict.

3. **Point the local copy at your new repo and push**:
   ```
   git init                     # only needed if you removed .git above
   git add -A
   git commit -m "Initial import from Arhopala_id"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

4. **Work with Claude on the new repo** from here. Open a Claude Code session in the project directory (or connect it to your new GitHub repo), describe your genus's identification key and reference material, and work through steps 2–8 below conversationally — Claude can edit `data/tree.json`, run the validation scripts, build the C&P Key data and Visual Guide, and commit/push to `main` as the work progresses.

## 2. Rebrand

"Arhopala" / "Arhopala ID" are hardcoded as page titles, headings, and menu labels in `index.html`, `about.html`, `checklist.html`, `guide.html`, `species.html`, `id_keys.html`, `key.html`. Search-and-replace:

- `Arhopala ID` → your app name
- `Arhopala` → your genus name (also used as the default iNaturalist search term in `js/app.js`)
- `js/checklist.js`'s `ANSWERS_KEY` localStorage key (`'arhopala-cl-answers'`) — rename so saved answers don't collide if both apps share a domain
- `js/id_keys.js`'s `ANSWERS_KEY` (`'arhopala-ks-answers-v1'`) and `GENUS_MARKER` (`'Arhopala'`) — see section 6

## 3. Regenerate `data/species.json`

Edit `scripts/fetch_species.py`:

- `get_arhopala_taxon_id()` — change the `q` param from `"Arhopala"` to your genus name
- `MALAYSIA_PLACE_ID` — change to your target region's iNaturalist place ID (look up via `https://api.inaturalist.org/v1/places/autocomplete?q=<region>`)
- Update the `User-Agent` header to point at your fork

Then run `python scripts/fetch_species.py` to generate `data/species.json`.

## 4. Build `data/tree.json` from your identification key

This is the bulk of the work — transcribe your morphological key into the flat node-map format described in the [Data](README.md#data) section of the README: `question`, `result`, and `group` node types. Each `result` node's `taxon_id` must match an entry in `data/species.json`.

Tips:

- Keep each question scoped to a single observable character, so Feature Scoring can score it independently of the others.
- Give any question whose feature is hard to see in typical photos (e.g. upperside-only characters) a "Cannot determine — ..." choice, so the ID Key can offer a fallback path and Feature Scoring can skip it without penalising candidates.
- For species pairs the key can't separate from photographs alone, route both into a `group` node with a descriptive `group_name`.

## 5. Validate the tree

```
python scripts/audit_paths.py            # canonical path quality, CD coverage, orphans
node scripts/compute_sim_cd_paths.js      # regenerate data/sim_cd_paths.json
node scripts/validate_sim_cd_paths.js     # confirm it matches the live simulation
```

Run all three after any edit to `data/tree.json` — see the `scripts/audit_paths.py` section of the README for what each check covers.

## 6. (Optional) Build the C&P Key from a numbered-lead dichotomous key

If you have a numbered-lead (Corbet & Pendlebury–style) dichotomous key for your genus, the app can present it interactively at `id_keys.html` and show each species' key route on its Species Search page. This is independent of `data/tree.json` — it is driven entirely by `data/id_key.json`. If you don't have such a key, skip this section; the C&P Key page and the per-species "C&P key path" simply won't appear.

1. **Put the key text in `notebook_data/keys.txt`** — one lead per line in the numbered-lead format `N (M): text …`, where `N` is the lead number, `(M)` its paired/alternative lead, and terminal leads end with the taxon name (`… Genus species`). See `notebook_data/how_to_use_id_key.txt` for the format.

2. **Generate and validate the data:**
   ```
   node scripts/build_id_key.js               # parse keys.txt → data/id_key.json
   node scripts/enrich_id_key_guidelinks.js   # add Visual-Guide links to couplets
   node scripts/apply_id_key_hints.js         # fill each couplet's Yes/No hint
   node scripts/move_fwl_to_hint.js           # move "Fwl … mm" from statement → hint
   node scripts/validate_id_key.js            # replay every species_path; correct terminal
   node scripts/audit_id_key_scoring.js       # replay + score every path; each species → #1
   ```
   Or in one step: `npm run build-validate-key` (build → validate → audit). Run the
   **scoring audit after any change to `data/id_key.json`** — `validate_id_key.js` only
   checks that each path reaches the right *terminal*; `audit_id_key_scoring.js` also
   confirms each species ends up ranked **#1** in the +1/−1 scoring, and reports which
   species fall from #1 when a Skippable/upperside couplet on their path is skipped (a
   decisive upperside couplet legitimately costs the top spot when skipped — that's not a
   failure, just surfaced so a change can't silently bury a species).
   `data/id_key.json` has three parts: `couplets[]` (each `{num_a, num_b, question, a_text, b_text, upperside, species_a, species_b, guide_phrase/guide_link, question_phrase/question_link}`), `leads{}` (lead number → full text), and `species_paths{}` (species → ordered list of chosen lead numbers). `species_a`/`species_b` list the taxa reachable on each side of a couplet — this is what the +1/−1 scoring uses; a taxon absent from a couplet is neutral for it.

3. **Set the genus in `js/id_keys.js`:**
   - `GENUS_MARKER` (default `'Arhopala'`) — the string used to detect terminal leads and extract the species name.
   - `ANSWERS_KEY` (default `'arhopala-ks-answers-v1'`) — rename to avoid localStorage collisions.

   The species-page C&P key path (`buildCPKeyPath` in `js/app.js`) reimplements the same A/B navigation model — keep the two in sync if you change the routing rules.

4. **Guide links:** `scripts/enrich_id_key_guidelinks.js` maps character phrases → `guide.html#anchor`. Edit its `PHRASE_MAP` for your key's characters (same anchors as section 7). Re-run it after any `build_id_key.js` run, since the build step resets the links (the two together are idempotent).

5. **Hints:** each couplet shows a collapsible "Hint" that helps the user decide Yes/No. The hint text lives in `data/id_key_hints.json` (a flat map couplet-id → hint string) and is applied by `scripts/apply_id_key_hints.js` (the build always emits an empty `hint`, so re-run this after any `build_id_key.js` run). Author hints by synthesising the lead texts with the per-species notes in `notebook_data/arhopala_<epithet>.txt` — a good hint clarifies the character, says which species/group each answer heads toward, and adds one distinguishing detail where a couplet separates named species. Then `scripts/move_fwl_to_hint.js` strips the forewing-length clause ("Fwl … mm") out of each couplet's displayed statement and appends it to the hint, since length can't be judged from a field photo — run it LAST (after the hint text is in place).

6. **Upperside Skip:** set `upperside: true` on any couplet whose character needs the specimen's upperside. `id_keys.js` then offers a *Skip* button (when at least one branch continues) so underside-only photos can proceed; a skipped couplet is neutral in scoring.

Notes on the parser: `scripts/build_id_key.js` handles numbered-lead quirks — multi-sibling parentheticals (`79 (80)(81)`) and serial/fall-through leads where a lead both names a species *and* forwards the trunk (so a couplet-node lead wins over a terminal). If your key has structural irregularities that leave a terminal unreachable, add small targeted overrides in the builder (see its header comments) until `validate_id_key.js` passes with every terminal reachable and each species ranking #1 at the end of its own path.

## 7. Build the Visual Guide

`guide.html` is a series of self-contained `<section class="guide-section" id="...">` blocks, each pairing an annotated photo with a `guide-terms` definition list. Add one section per diagnostic character your key relies on, then link to it from the relevant question in `data/tree.json` via `question_link` (inline text link) or `guide_link` (standalone button), and add a matching entry to the `GUIDE_LINKS` map in `js/checklist.js` so Feature Scoring's question text links to the same section. The C&P Key couplets link to these same anchors via the `PHRASE_MAP` in `scripts/enrich_id_key_guidelinks.js` (section 6).

## 8. Deploy

Enable GitHub Pages on `main` (root). All asset paths are relative, so the app works under any repo subpath.
